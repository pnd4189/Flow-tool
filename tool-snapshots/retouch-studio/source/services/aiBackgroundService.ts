import { Flow } from 'flow-sdk';
import { SupportedImageModel, CandidatePreview } from '../types';

export interface AiBackgroundOptions {
  prompt: string;
  model: SupportedImageModel;
  castContactShadow: boolean;
  shadowIntensity: number; // 0..100
  shadowOffsetY: number;   // 2..40
}

/**
 * Generates an AI backdrop matching scene perspective.
 * Foreground comes strictly from current subject selection + protection and preserves 100% original pixels.
 */
export async function generateAiBackdrop(
  sourceCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  options: AiBackgroundOptions,
  sourceRevision: number,
  onProgress?: (msg: string) => void
): Promise<CandidatePreview> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  // Determine closest aspect ratio
  const ratio = w / h;
  let aspect: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' = '1:1';
  if (Math.abs(ratio - 16 / 9) < 0.25) aspect = '16:9';
  else if (Math.abs(ratio - 9 / 16) < 0.25) aspect = '9:16';
  else if (Math.abs(ratio - 4 / 3) < 0.25) aspect = '4:3';
  else if (Math.abs(ratio - 3 / 4) < 0.25) aspect = '3:4';

  onProgress?.('Đang chuẩn bị ảnh tham chiếu góc chụp và ánh sáng...');
  const uploadDataUrl = sourceCanvas.toDataURL('image/png');
  const uploadBase64 = uploadDataUrl.split(',')[1];

  const uploadResult = await Flow.upload({
    base64: uploadBase64,
    mimeType: 'image/png',
    name: `source_perspective_rev${sourceRevision}.png`,
  });

  onProgress?.(`Đang tạo cảnh nền bằng AI (${options.model})...`);

  // Prompt preserves original medium and style naturally
  const backgroundPrompt = `An environmental background backdrop scene: ${options.prompt}. Perspective, camera focal length, eye-level angle, and light direction matching the reference image. Clean empty space in the center, absolutely NO people, NO duplicate human figures, NO floating text or logos.`;

  const startTime = Date.now();

  // Enforce 120s timeout for AI backdrop generation
  const TIMEOUT_MS = 120000;
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Yêu cầu tạo nền AI quá thời gian 120 giây.'));
    }, TIMEOUT_MS);
  });

  const genPromise = Flow.generate.image({
    prompt: backgroundPrompt,
    referenceImageMediaIds: [uploadResult.mediaId],
    modelDisplayName: options.model,
    aspectRatio: aspect,
  });

  let bgResult: any;
  try {
    bgResult = await Promise.race([genPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }

  const durationMs = Date.now() - startTime;

  // Decode generated backdrop
  const { decodeBase64ToImage } = await import('./imageUtils');
  const decodedBg = await decodeBase64ToImage(
    bgResult.base64,
    bgResult.mimeType,
    'generated_bg.png'
  );

  onProgress?.('Đang hòa trộn chủ thể nguyên bản lên nền mới...');

  // Output canvas matching source native resolution
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể khởi tạo canvas nền AI');

  // Use cover-fit for differing generated background ratios instead of non-uniform stretching
  const bgW = decodedBg.canvas.width;
  const bgH = decodedBg.canvas.height;
  const bgAspect = bgW / bgH;
  const canvasAspect = w / h;

  let drawW = w;
  let drawH = h;
  let drawX = 0;
  let drawY = 0;

  if (bgAspect > canvasAspect) {
    drawH = h;
    drawW = h * bgAspect;
    drawX = (w - drawW) / 2;
  } else {
    drawW = w;
    drawH = w / bgAspect;
    drawY = (h - drawH) / 2;
  }

  ctx.drawImage(decodedBg.canvas, drawX, drawY, drawW, drawH);

  // FIX: Convert grayscale selectionMask to a real alpha silhouette before tint/blur/offset
  // so source-in doesn't flood the whole canvas.
  if (options.castContactShadow && options.shadowIntensity > 0) {
    const silhouetteCanvas = document.createElement('canvas');
    silhouetteCanvas.width = w;
    silhouetteCanvas.height = h;
    const silCtx = silhouetteCanvas.getContext('2d', { willReadFrequently: true });

    const selCtx = selectionMask.getContext('2d', { willReadFrequently: true });
    if (silCtx && selCtx) {
      const selImg = selCtx.getImageData(0, 0, w, h);
      const selData = selImg.data;
      const silImg = silCtx.createImageData(w, h);
      const silData = silImg.data;
      const totalPixels = w * h;

      const shadowAlphaMax = Math.round((options.shadowIntensity / 100) * 115); // max ~0.45 opacity

      for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        const maskVal = selData[idx]; // grayscale intensity
        if (maskVal > 20) {
          silData[idx] = 15;     // dark tint R
          silData[idx + 1] = 20; // dark tint G
          silData[idx + 2] = 25; // dark tint B
          silData[idx + 3] = Math.round((maskVal / 255) * shadowAlphaMax);
        } else {
          silData[idx + 3] = 0;
        }
      }
      silCtx.putImageData(silImg, 0, 0);

      // Render blurred offset silhouette
      ctx.save();
      ctx.filter = 'blur(12px)';
      ctx.drawImage(silhouetteCanvas, 0, options.shadowOffsetY);
      ctx.restore();
    }
  }

  // Composite 100% original subject pixels over the background:
  // Any protectionMask > 0 keeps exact source RGBA.
  const srcData = sourceCanvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const selData = selectionMask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const protData = protectionMask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;

  const outImgData = ctx.getImageData(0, 0, w, h);
  const out = outImgData.data;

  const total = w * h;
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const p = protData[idx];

    // Protected pixels: exact source RGBA
    if (p > 0) {
      out[idx] = srcData[idx];
      out[idx + 1] = srcData[idx + 1];
      out[idx + 2] = srcData[idx + 2];
      out[idx + 3] = srcData[idx + 3];
      continue;
    }

    const s = selData[idx];
    if (s > 0) {
      const fgFactor = s / 255;
      const srcAlpha = (srcData[idx + 3] / 255) * fgFactor;
      out[idx] = Math.round(srcData[idx] * srcAlpha + out[idx] * (1 - srcAlpha));
      out[idx + 1] = Math.round(srcData[idx + 1] * srcAlpha + out[idx + 1] * (1 - srcAlpha));
      out[idx + 2] = Math.round(srcData[idx + 2] * srcAlpha + out[idx + 2] * (1 - srcAlpha));
      out[idx + 3] = 255;
    }
  }
  ctx.putImageData(outImgData, 0, 0);

  return {
    type: 'bg_ai',
    canvas,
    title: 'Nền AI mới',
    description: `Mô hình: ${options.model}. Nền: ${options.prompt}`,
    sourceRevision,
    diagnostics: {
      durationMs,
      modelUsed: options.model,
      protectedPreservedPixels: 0,
      outsideMaskPreservedPixels: 0,
      editablePixels: 0,
      sourceDimensions: { width: w, height: h },
      outputDimensions: { width: decodedBg.width, height: decodedBg.height },
      mappingInfo: `Backdrop ${decodedBg.width}x${decodedBg.height} cover-fit to native ${w}x${h} under original foreground`,
    },
  };
}
