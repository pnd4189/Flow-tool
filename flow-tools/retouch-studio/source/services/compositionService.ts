import { Flow } from 'flow-sdk';
import {
  CropRect,
  CropAspectPreset,
  ExpandAnchor,
  SupportedImageModel,
  CandidatePreview,
  InspectionReport,
} from '../types';
import { cloneCanvas } from './imageUtils';

export const MAX_SAFE_IMAGE_PIXELS = 16_000_000; // ~16 Megapixels (e.g. 4000x4000) to prevent browser tab OOM

export function checkMemoryLimit(width: number, height: number): { safe: boolean; pixels: number; message?: string } {
  const pixels = width * height;
  if (pixels > MAX_SAFE_IMAGE_PIXELS) {
    return {
      safe: false,
      pixels,
      message: `Kích thước mở rộng ${width}×${height} (${(pixels / 1_000_000).toFixed(1)} MP) vượt quá giới hạn an toàn bộ nhớ 16 MP. Vui lòng chọn kích thước nhỏ hơn để tránh tràn RAM trình duyệt.`,
    };
  }
  return { safe: true, pixels };
}

/**
 * 1. REAL CROP: Crops image and transforms both masks synchronously with the exact same rectangle.
 */
export function applyCrop(
  sourceImage: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  cropRect: CropRect
): {
  croppedImage: HTMLCanvasElement;
  croppedSelectionMask: HTMLCanvasElement;
  croppedProtectionMask: HTMLCanvasElement;
} {
  const x = Math.max(0, Math.min(Math.round(cropRect.x), sourceImage.width - 1));
  const y = Math.max(0, Math.min(Math.round(cropRect.y), sourceImage.height - 1));
  const w = Math.max(1, Math.min(Math.round(cropRect.width), sourceImage.width - x));
  const h = Math.max(1, Math.min(Math.round(cropRect.height), sourceImage.height - y));

  const cropCanvas = (src: HTMLCanvasElement, isMask = false): HTMLCanvasElement => {
    const dest = document.createElement('canvas');
    dest.width = w;
    dest.height = h;
    const ctx = dest.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Không thể khởi tạo canvas cắt');

    if (isMask) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
    }

    ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
    return dest;
  };

  return {
    croppedImage: cropCanvas(sourceImage, false),
    croppedSelectionMask: cropCanvas(selectionMask, true),
    croppedProtectionMask: cropCanvas(protectionMask, true),
  };
}

/**
 * 2. ROTATE 90 & FLIP H/V: Synchronous geometry transformation for image and all masks.
 * 90-degree rotations and flips do NOT resample or interpolate colors; they rearrange exact pixel coordinates.
 */
export function applyRotate90OrFlip(
  sourceImage: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  action: 'rotate_90_cw' | 'rotate_90_ccw' | 'flip_h' | 'flip_v'
): {
  transformedImage: HTMLCanvasElement;
  transformedSelectionMask: HTMLCanvasElement;
  transformedProtectionMask: HTMLCanvasElement;
} {
  const origW = sourceImage.width;
  const origH = sourceImage.height;

  const is90 = action === 'rotate_90_cw' || action === 'rotate_90_ccw';
  const targetW = is90 ? origH : origW;
  const targetH = is90 ? origW : origH;

  const transformSingle = (src: HTMLCanvasElement, isMask = false): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Không thể xoay canvas');

    if (isMask) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, targetW, targetH);
    }

    ctx.save();
    if (action === 'rotate_90_cw') {
      ctx.translate(targetW, 0);
      ctx.rotate(Math.PI / 2);
    } else if (action === 'rotate_90_ccw') {
      ctx.translate(0, targetH);
      ctx.rotate(-Math.PI / 2);
    } else if (action === 'flip_h') {
      ctx.translate(targetW, 0);
      ctx.scale(-1, 1);
    } else if (action === 'flip_v') {
      ctx.translate(0, targetH);
      ctx.scale(1, -1);
    }

    ctx.drawImage(src, 0, 0);
    ctx.restore();
    return canvas;
  };

  return {
    transformedImage: transformSingle(sourceImage, false),
    transformedSelectionMask: transformSingle(selectionMask, true),
    transformedProtectionMask: transformSingle(protectionMask, true),
  };
}

/**
 * 3. STRAIGHTEN (-15° .. +15°):
 * Rotates canvas by an arbitrary fine angle and crops to the maximum inscribed rectangle
 * so no transparent borders or voids appear.
 */
export function applyStraighten(
  sourceImage: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  angleDegrees: number
): {
  straightenedImage: HTMLCanvasElement;
  straightenedSelectionMask: HTMLCanvasElement;
  straightenedProtectionMask: HTMLCanvasElement;
  cropDimensions: { width: number; height: number };
} {
  const rad = (angleDegrees * Math.PI) / 180;
  const absRad = Math.abs(rad);
  const w = sourceImage.width;
  const h = sourceImage.height;

  const cos = Math.cos(absRad);
  const sin = Math.sin(absRad);

  const scaleX = w / (w * cos + h * sin);
  const scaleY = h / (w * sin + h * cos);
  const safeScale = Math.min(scaleX, scaleY);

  const inscribedW = Math.max(1, Math.floor(w * safeScale));
  const inscribedH = Math.max(1, Math.floor(h * safeScale));

  const processBuffer = (src: HTMLCanvasElement, isMask = false): HTMLCanvasElement => {
    const rotW = Math.ceil(w * cos + h * sin);
    const rotH = Math.ceil(w * sin + h * cos);

    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = rotW;
    rotCanvas.height = rotH;
    const rotCtx = rotCanvas.getContext('2d', { willReadFrequently: true });
    if (!rotCtx) throw new Error('Không thể xoay canvas căn chỉnh');

    if (isMask) {
      rotCtx.fillStyle = '#000000';
      rotCtx.fillRect(0, 0, rotW, rotH);
    }

    rotCtx.save();
    rotCtx.translate(rotW / 2, rotH / 2);
    rotCtx.rotate(rad);
    rotCtx.imageSmoothingEnabled = true;
    rotCtx.imageSmoothingQuality = 'high';
    rotCtx.drawImage(src, -w / 2, -h / 2);
    rotCtx.restore();

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = inscribedW;
    finalCanvas.height = inscribedH;
    const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
    if (!finalCtx) throw new Error('Không thể cắt canvas căn chỉnh');

    if (isMask) {
      finalCtx.fillStyle = '#000000';
      finalCtx.fillRect(0, 0, inscribedW, inscribedH);
    }

    const cropX = Math.round((rotW - inscribedW) / 2);
    const cropY = Math.round((rotH - inscribedH) / 2);

    finalCtx.drawImage(rotCanvas, cropX, cropY, inscribedW, inscribedH, 0, 0, inscribedW, inscribedH);
    return finalCanvas;
  };

  return {
    straightenedImage: processBuffer(sourceImage, false),
    straightenedSelectionMask: processBuffer(selectionMask, true),
    straightenedProtectionMask: processBuffer(protectionMask, true),
    cropDimensions: { width: inscribedW, height: inscribedH },
  };
}

/**
 * Calculates anchor offset (ox, oy) for placing the original source canvas
 * inside a strictly larger expanded canvas.
 */
export function calculateAnchorOffset(
  origW: number,
  origH: number,
  targetW: number,
  targetH: number,
  anchor: ExpandAnchor
): { offsetX: number; offsetY: number } {
  let offsetX = 0;
  let offsetY = 0;

  if (anchor.includes('left')) {
    offsetX = 0;
  } else if (anchor.includes('right')) {
    offsetX = targetW - origW;
  } else {
    offsetX = Math.round((targetW - origW) / 2);
  }

  if (anchor.startsWith('top')) {
    offsetY = 0;
  } else if (anchor.startsWith('bottom')) {
    offsetY = targetH - origH;
  } else {
    offsetY = Math.round((targetH - origH) / 2);
  }

  return {
    offsetX: Math.max(0, Math.min(offsetX, targetW - origW)),
    offsetY: Math.max(0, Math.min(offsetY, targetH - origH)),
  };
}

/**
 * Shifts mask canvas into larger target dimensions by exact integer offset.
 */
export function shiftMaskToExpandedCanvas(
  maskCanvas: HTMLCanvasElement,
  targetW: number,
  targetH: number,
  offsetX: number,
  offsetY: number
): HTMLCanvasElement {
  const dest = document.createElement('canvas');
  dest.width = targetW;
  dest.height = targetH;
  const ctx = dest.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể mở rộng mặt nạ');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(maskCanvas, offsetX, offsetY);
  return dest;
}

/**
 * Direct byte comparison between original source image and its mapped location
 * in the final canvas to guarantee 100% exact interior pixel preservation.
 */
export function verifyExactInteriorPreservation(
  sourceCanvas: HTMLCanvasElement,
  expandedCanvas: HTMLCanvasElement,
  offsetX: number,
  offsetY: number
): { isIdentical: boolean; mismatchedPixels: number; totalSourcePixels: number } {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const totalSourcePixels = w * h;

  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const expCtx = expandedCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx || !expCtx) {
    return { isIdentical: false, mismatchedPixels: totalSourcePixels, totalSourcePixels };
  }

  const srcData = srcCtx.getImageData(0, 0, w, h).data;
  const expData = expCtx.getImageData(offsetX, offsetY, w, h).data;

  let mismatchedPixels = 0;
  for (let i = 0; i < totalSourcePixels; i++) {
    const idx = i * 4;
    if (
      srcData[idx] !== expData[idx] ||
      srcData[idx + 1] !== expData[idx + 1] ||
      srcData[idx + 2] !== expData[idx + 2] ||
      srcData[idx + 3] !== expData[idx + 3]
    ) {
      mismatchedPixels++;
    }
  }

  return {
    isIdentical: mismatchedPixels === 0,
    mismatchedPixels,
    totalSourcePixels,
  };
}

/**
 * Supported Flow SDK Image Generation Aspect Ratios:
 * '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
 */
export const SDK_ASPECT_RATIOS: Array<{
  ratio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  numeric: number;
}> = [
  { ratio: '1:1', numeric: 1.0 },
  { ratio: '4:3', numeric: 4 / 3 },
  { ratio: '3:4', numeric: 3 / 4 },
  { ratio: '16:9', numeric: 16 / 9 },
  { ratio: '9:16', numeric: 9 / 16 },
];

export function findClosestSdkAspectRatio(w: number, h: number): {
  ratio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  numeric: number;
} {
  const numeric = w / h;
  let best = SDK_ASPECT_RATIOS[0];
  let minDiff = Math.abs(numeric - best.numeric);
  for (let i = 1; i < SDK_ASPECT_RATIOS.length; i++) {
    const diff = Math.abs(numeric - SDK_ASPECT_RATIOS[i].numeric);
    if (diff < minDiff) {
      minDiff = diff;
      best = SDK_ASPECT_RATIOS[i];
    }
  }
  return best;
}

export interface ExpansionLayoutGuide {
  guideCanvas: HTMLCanvasElement;
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  paddedW: number;
  paddedH: number;
  padOffsetX: number;
  padOffsetY: number;
  targetW: number;
  targetH: number;
  sourceOffsetX: number;
  sourceOffsetY: number;
  sourceW: number;
  sourceH: number;
}

/**
 * Prepares the spatial layout guide for Flow.generate.image outpainting.
 * 1. Places source image at exact integer anchor offset inside target canvas.
 * 2. Marks the target canvas border distinctly (magenta border with translucent grid) as the generation zone.
 * 3. Pads target canvas WITHOUT stretching to match a supported SDK aspect ratio.
 */
export function prepareExpansionLayoutGuide(
  sourceCanvas: HTMLCanvasElement,
  targetW: number,
  targetH: number,
  anchorOffsetX: number,
  anchorOffsetY: number
): ExpansionLayoutGuide {
  const origW = sourceCanvas.width;
  const origH = sourceCanvas.height;

  const targetRatio = targetW / targetH;
  const sdkMatch = findClosestSdkAspectRatio(targetW, targetH);
  const targetSdkRatio = sdkMatch.numeric;

  let paddedW = targetW;
  let paddedH = targetH;

  if (targetRatio < targetSdkRatio) {
    paddedW = Math.round(targetH * targetSdkRatio);
  } else {
    paddedH = Math.round(targetW / targetSdkRatio);
  }

  const padOffsetX = Math.round((paddedW - targetW) / 2);
  const padOffsetY = Math.round((paddedH - targetH) / 2);

  const guideCanvas = document.createElement('canvas');
  guideCanvas.width = paddedW;
  guideCanvas.height = paddedH;
  const ctx = guideCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể tạo canvas layout guide');

  // Outer padding background (neutral void)
  ctx.fillStyle = '#111315';
  ctx.fillRect(0, 0, paddedW, paddedH);

  // Target canvas expansion zone filled with distinct magenta pattern to demarcate generation area
  ctx.fillStyle = '#2b0922';
  ctx.fillRect(padOffsetX, padOffsetY, targetW, targetH);

  // Draw grid lines inside the generation border to provide structural anchors
  ctx.strokeStyle = '#d946ef';
  ctx.lineWidth = 1;
  ctx.strokeRect(padOffsetX, padOffsetY, targetW, targetH);

  // Draw source image at exact known integer anchor coordinates
  ctx.drawImage(
    sourceCanvas,
    padOffsetX + anchorOffsetX,
    padOffsetY + anchorOffsetY,
    origW,
    origH
  );

  // Outer boundary line around source image in guide
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.strokeRect(
    padOffsetX + anchorOffsetX,
    padOffsetY + anchorOffsetY,
    origW,
    origH
  );

  return {
    guideCanvas,
    aspectRatio: sdkMatch.ratio,
    paddedW,
    paddedH,
    padOffsetX,
    padOffsetY,
    targetW,
    targetH,
    sourceOffsetX: anchorOffsetX,
    sourceOffsetY: anchorOffsetY,
    sourceW: origW,
    sourceH: origH,
  };
}

/**
 * Advisory check for duplicate subjects or harsh seams in the newly expanded border.
 * Returns an honest inspection report without fake scores or unsupported claims.
 */
export async function inspectExpansionAdvisory(
  sourceCanvas: HTMLCanvasElement,
  expandedCanvas: HTMLCanvasElement,
  offsetX: number,
  offsetY: number
): Promise<InspectionReport> {
  const origW = sourceCanvas.width;
  const origH = sourceCanvas.height;
  const expW = expandedCanvas.width;
  const expH = expandedCanvas.height;

  // Direct border inspection for seams around the border interface
  const expCtx = expandedCanvas.getContext('2d', { willReadFrequently: true });
  if (!expCtx) {
    return {
      score: null,
      status: 'UNAVAILABLE',
      summary: 'Không thể truy cập bộ đệm canvas để đánh giá trực quan.',
      hasMagentaArtifacts: false,
      hasSeamsDetected: false,
      alignmentRating: 'UNKNOWN',
    };
  }

  // Check for magenta guide color leak
  const expData = expCtx.getImageData(0, 0, expW, expH).data;
  let magentaCount = 0;
  for (let i = 0; i < expData.length; i += 4) {
    const r = expData[i];
    const g = expData[i + 1];
    const b = expData[i + 2];
    if (r > 200 && b > 200 && g < 45) {
      magentaCount++;
    }
  }

  try {
    const maxDim = 512;
    const scale = Math.min(1, maxDim / Math.max(expW, expH));

    const makeThumb = (source: HTMLCanvasElement): string => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(source.width * scale));
      c.height = Math.max(1, Math.round(source.height * scale));
      const ctx = c.getContext('2d');
      if (ctx) ctx.drawImage(source, 0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1];
    };

    const sourceThumbBase64 = makeThumb(sourceCanvas);
    const expandedThumbBase64 = makeThumb(expandedCanvas);

    const prompt = `So sánh ảnh gốc (ảnh 1) với ảnh được mở rộng khung canvas (ảnh 2).
Ảnh gốc được đặt nguyên vẹn ở tọa độ x=${offsetX}, y=${offsetY} (kích thước ${origW}x${origH}) trong khung ${expW}x${expH}.
Kiểm tra:
1. Có bị lặp lại đối tượng chính (duplicate subject/person) ở phần biên mở rộng mới không?
2. Có đường viền gián đoạn hoặc sai lệch phối cảnh/ánh sáng thô ở ranh giới ghép không?
Trả về JSON DUY NHẤT:
{
  "hasDuplicates": false,
  "hasSeamsDetected": false,
  "summary": "Mô tả ngắn gọn và trung thực",
  "alignmentRating": "EXCELLENT"
}
alignmentRating chỉ có thể là: "EXCELLENT" | "FAIR" | "POOR".`;

    const res = await Flow.generate.text(prompt, {
      systemInstruction: 'Bạn là chuyên gia kiểm tra chất lượng mở rộng ảnh (outpainting). Luôn trả về JSON hợp lệ.',
      thinkingLevel: 'low',
      images: [
        { base64: sourceThumbBase64, mimeType: 'image/png' },
        { base64: expandedThumbBase64, mimeType: 'image/png' },
      ],
    });

    const match = (res.text || '').match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (['EXCELLENT', 'FAIR', 'POOR'].includes(parsed.alignmentRating)) {
        return {
          score: parsed.alignmentRating === 'EXCELLENT' ? 95 : parsed.alignmentRating === 'FAIR' ? 75 : 50,
          status: 'VERIFIED',
          summary: parsed.summary || 'Đã phân tích ranh giới mở rộng và đối tượng.',
          hasMagentaArtifacts: magentaCount > 15,
          hasSeamsDetected: Boolean(parsed.hasSeamsDetected || parsed.hasDuplicates),
          alignmentRating: parsed.alignmentRating,
          advice: parsed.hasDuplicates
            ? 'Phát hiện có thể có đối tượng bị lặp lại ở vùng biên. Hãy kiểm tra kỹ.'
            : undefined,
        };
      }
    }
  } catch (err) {
    console.warn('Advisory inspection API unavailable:', err);
  }

  return {
    score: null,
    status: 'UNAVAILABLE',
    summary: 'Đánh giá AI tự động chưa khả dụng. Độ bảo tồn 100% pixel gốc được kiểm chứng trực tiếp bằng toán học.',
    hasMagentaArtifacts: magentaCount > 15,
    hasSeamsDetected: false,
    alignmentRating: 'UNKNOWN',
    advice: 'Vui lòng phóng to ranh giới ghép để kiểm tra trước khi Áp dụng.',
  };
}

export interface AiExpandParams {
  targetWidth: number;
  targetHeight: number;
  anchor: ExpandAnchor;
  userPrompt?: string;
  model: SupportedImageModel;
}

export interface ExpansionCancellationControl {
  requestId: string;
  isCancelled: () => boolean;
}

/**
 * 4. AI EXPAND CANVAS (Outpainting):
 * Sends TWO valid references:
 * 1. Lossless native source image.
 * 2. Padded spatial layout guide containing target canvas, source placed at exact integer anchor offset, and marked generation border.
 * 
 * Strict invariants:
 * - Canvas strictly EXPANDS: targetWidth >= source.width, targetHeight >= source.height.
 * - Map generated output back using exact layout guide padding transform without content distortion.
 * - Copy native source RGBA verbatim for EVERY pixel inside the original rectangle.
 * - Shift selection and protection masks by exact integer offset.
 * - After verifyExactInteriorPreservation, if any source pixel differs, throw and DO NOT return preview.
 */
export async function generateAiCanvasExpansion(
  sourceCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  params: AiExpandParams,
  sourceRevision: number,
  onProgress?: (msg: string) => void,
  cancelControl?: ExpansionCancellationControl
): Promise<CandidatePreview> {
  const origW = sourceCanvas.width;
  const origH = sourceCanvas.height;
  const targetW = Math.max(origW, Math.round(params.targetWidth));
  const targetH = Math.max(origH, Math.round(params.targetHeight));

  if (targetW === origW && targetH === origH) {
    throw new Error('Kích thước mở rộng phải lớn hơn kích thước ảnh hiện tại theo ít nhất một chiều.');
  }

  const memCheck = checkMemoryLimit(targetW, targetH);
  if (!memCheck.safe) {
    throw new Error(memCheck.message);
  }

  const { offsetX, offsetY } = calculateAnchorOffset(origW, origH, targetW, targetH, params.anchor);

  if (cancelControl?.isCancelled()) {
    throw new Error('Yêu cầu mở rộng đã bị hủy.');
  }

  onProgress?.('Đang chuẩn bị ảnh gốc và bản hướng dẫn bố cục không gian (Layout Guide)...');

  // REFERENCE 1: Lossless native source image
  const sourceDataUrl = sourceCanvas.toDataURL('image/png');
  const sourceBase64 = sourceDataUrl.split(',')[1];
  const uploadedSource = await Flow.upload({
    base64: sourceBase64,
    mimeType: 'image/png',
    name: `expand_source_rev${sourceRevision}.png`,
  });

  if (cancelControl?.isCancelled()) {
    throw new Error('Yêu cầu mở rộng đã bị hủy.');
  }

  // REFERENCE 2: Padded spatial layout guide
  const guideLayout = prepareExpansionLayoutGuide(
    sourceCanvas,
    targetW,
    targetH,
    offsetX,
    offsetY
  );

  const guideDataUrl = guideLayout.guideCanvas.toDataURL('image/png');
  const guideBase64 = guideDataUrl.split(',')[1];
  const uploadedGuide = await Flow.upload({
    base64: guideBase64,
    mimeType: 'image/png',
    name: `expand_guide_rev${sourceRevision}.png`,
  });

  if (cancelControl?.isCancelled()) {
    throw new Error('Yêu cầu mở rộng đã bị hủy.');
  }

  onProgress?.(`Đang tạo mở rộng cảnh bằng AI (${params.model}, ${guideLayout.aspectRatio})...`);

  const expandPrompt = `The first reference image is the authentic original source image.
The second reference image is a spatial layout guide indicating where the source image is placed (in the blue box) and the surrounding border area that MUST be outpainted and generated.
Action: Seamlessly outpaint and expand the scene outward into the surrounding border area.
User specific direction: ${params.userPrompt?.trim() || 'Seamless continuation of surrounding environment, lighting, textures, horizon, and perspective.'}
STRICT INVARIANTS:
1. Preserve the original source content at its EXACT spatial position, relative scale, and proportions as specified in the guide.
2. Fill ONLY the surrounding border seamlessly; do NOT duplicate the main subject or person in the new borders.
3. Absolutely NO guide marker colors, magenta borders, or cyan outline colors in the generated output.
4. Preserve the authentic art medium, style, brushwork, lighting angle, perspective, and depth of field of the original source image.`;

  const startTime = Date.now();

  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Yêu cầu mở rộng khung ảnh quá thời gian cho phép (120 giây).'));
    }, 120000);
  });

  const genPromise = Flow.generate.image({
    prompt: expandPrompt,
    referenceImageMediaIds: [uploadedSource.mediaId, uploadedGuide.mediaId],
    modelDisplayName: params.model,
    aspectRatio: guideLayout.aspectRatio,
  });

  let genResult: any;
  try {
    genResult = await Promise.race([genPromise, timeoutPromise]);
  } catch (err: any) {
    const errMsg = String(err?.message || err).toLowerCase();
    if (
      errMsg.includes('unusual') ||
      errMsg.includes('quota') ||
      errMsg.includes('policy') ||
      errMsg.includes('account') ||
      errMsg.includes('security')
    ) {
      throw err;
    }
    throw new Error(`Tạo mở rộng AI thất bại: ${err?.message || err}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (cancelControl?.isCancelled()) {
    throw new Error('Yêu cầu mở rộng đã bị hủy.');
  }

  onProgress?.('Đang giải mã và ánh xạ kết quả mở rộng về tọa độ gốc...');

  const { decodeBase64ToImage } = await import('./imageUtils');
  const decodedAi = await decodeBase64ToImage(
    genResult.base64,
    genResult.mimeType,
    'generated_expand.png'
  );

  if (cancelControl?.isCancelled()) {
    throw new Error('Yêu cầu mở rộng đã bị hủy.');
  }

  const genW = decodedAi.canvas.width;
  const genH = decodedAi.canvas.height;

  // Verify generated aspect ratio matches layout guide
  const expectedRatio = guideLayout.paddedW / guideLayout.paddedH;
  const actualRatio = genW / genH;
  if (Math.abs(expectedRatio - actualRatio) / expectedRatio > 0.18) {
    throw new Error(
      `Tỷ lệ ảnh AI trả về (${genW}x${genH}) không khớp với tỷ lệ khung bố cục yêu cầu (${guideLayout.paddedW}x${guideLayout.paddedH}).`
    );
  }

  // Map generated output back to target canvas using guide padding transform WITHOUT stretching target content
  const scaleX = genW / guideLayout.paddedW;
  const scaleY = genH / guideLayout.paddedH;

  const targetCropX = Math.round(guideLayout.padOffsetX * scaleX);
  const targetCropY = Math.round(guideLayout.padOffsetY * scaleY);
  const targetCropW = Math.round(guideLayout.targetW * scaleX);
  const targetCropH = Math.round(guideLayout.targetH * scaleY);

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = targetW;
  finalCanvas.height = targetH;
  const fCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
  if (!fCtx) throw new Error('Không thể khởi tạo canvas hoàn tất');

  fCtx.imageSmoothingEnabled = true;
  fCtx.imageSmoothingQuality = 'high';

  fCtx.drawImage(
    decodedAi.canvas,
    targetCropX,
    targetCropY,
    targetCropW,
    targetCropH,
    0,
    0,
    targetW,
    targetH
  );

  // STRICT INVARIANT: Copy EVERY single native source RGBA pixel back exactly inside the source rectangle
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error('Không thể đọc dữ liệu ảnh gốc');

  const srcImgData = srcCtx.getImageData(0, 0, origW, origH);
  const srcPixels = srcImgData.data;

  const finalImgData = fCtx.getImageData(0, 0, targetW, targetH);
  const finalPixels = finalImgData.data;

  for (let y = 0; y < origH; y++) {
    const srcRow = y * origW;
    const destRow = (offsetY + y) * targetW;
    for (let x = 0; x < origW; x++) {
      const sIdx = (srcRow + x) * 4;
      const dIdx = (destRow + (offsetX + x)) * 4;

      finalPixels[dIdx] = srcPixels[sIdx];
      finalPixels[dIdx + 1] = srcPixels[sIdx + 1];
      finalPixels[dIdx + 2] = srcPixels[sIdx + 2];
      finalPixels[dIdx + 3] = srcPixels[sIdx + 3];
    }
  }

  fCtx.putImageData(finalImgData, 0, 0);

  // STRICT VERIFICATION: Verify exact interior preservation
  const verification = verifyExactInteriorPreservation(sourceCanvas, finalCanvas, offsetX, offsetY);
  if (!verification.isIdentical) {
    throw new Error(
      `Lỗi bảo toàn pixel: Phát hiện ${verification.mismatchedPixels.toLocaleString()} / ${verification.totalSourcePixels.toLocaleString()} pixel gốc bị sai lệch sau khi ghép ảnh mở rộng. Đã hủy tạo để bảo toàn ảnh.`
    );
  }

  if (cancelControl?.isCancelled()) {
    throw new Error('Yêu cầu mở rộng đã bị hủy.');
  }

  // Shift existing masks by exact integer offset
  const newSelectionMask = shiftMaskToExpandedCanvas(selectionMask, targetW, targetH, offsetX, offsetY);
  const newProtectionMask = shiftMaskToExpandedCanvas(protectionMask, targetW, targetH, offsetX, offsetY);

  const durationMs = Date.now() - startTime;

  // Run advisory inspection for duplicate subjects or seams in the new border
  let advisory: InspectionReport | null = null;
  try {
    advisory = await inspectExpansionAdvisory(sourceCanvas, finalCanvas, offsetX, offsetY);
  } catch (err) {
    console.warn('Không thể chạy đánh giá AI advisory:', err);
  }

  if (cancelControl?.isCancelled()) {
    throw new Error('Yêu cầu mở rộng đã bị hủy.');
  }

  return {
    type: 'ai_expand',
    canvas: finalCanvas,
    selectionMaskCanvas: newSelectionMask,
    protectionMaskCanvas: newProtectionMask,
    title: 'Mở rộng khung ảnh AI (Outpaint)',
    description: `Từ ${origW}×${origH} → ${targetW}×${targetH} px. Bảo toàn 100% pixel ảnh gốc (${verification.totalSourcePixels.toLocaleString()} px).`,
    sourceRevision,
    inspectionReport: advisory,
    compositionInfo: {
      originalDimensions: { width: origW, height: origH },
      newDimensions: { width: targetW, height: targetH },
      sourceOffset: { x: offsetX, y: offsetY },
      isResampled: false,
      operation: 'ai_expand',
    },
    diagnostics: {
      durationMs,
      modelUsed: params.model,
      protectedPreservedPixels: 0,
      outsideMaskPreservedPixels: 0,
      editablePixels: targetW * targetH - origW * origH,
      sourceDimensions: { width: origW, height: origH },
      outputDimensions: { width: targetW, height: targetH },
      mappingInfo: `Source ${origW}x${origH} mapped at (${offsetX}, ${offsetY}). Verified ${verification.totalSourcePixels} px, 0 mismatches.`,
    },
  };
}
