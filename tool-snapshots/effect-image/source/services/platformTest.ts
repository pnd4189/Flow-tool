import { Flow } from 'flow-sdk';
import type { ModelTestResult, AiVisionResult } from '../types';
import { chromaKeyExtract, calculateSubjectOffset } from './chromaKey';

export const TEST_PROMPT =
  'A cute 2D anime fox sitting on a mossy rock in a misty forest, clean line art, flat cel shading';

export const IMAGE_MODELS_TO_TEST = [
  '🍌 Nano Banana 2.1',
  '🍌 Nano Banana Pro',
  '🍌 Nano Banana 2 Lite',
  'Imagen 4',
  'Imagen 4 Ultra',
  'Imagen 4 Fast',
  'Imagen 3',
  '🖼️ Imagen 4',
];

/**
 * Phép thử A: Gọi Flow.generate.image cho từng model
 */
export async function testSingleModel(
  modelDisplayName: string,
  onStart?: () => void
): Promise<ModelTestResult> {
  if (onStart) onStart();
  const start = performance.now();

  try {
    const res = await Flow.generate.image({
      prompt: TEST_PROMPT,
      modelDisplayName,
      aspectRatio: '16:9',
    });

    // Lấy kích thước ảnh tự nhiên
    const dims = await getImageDimensions(res.base64, res.mimeType);

    return {
      modelName: modelDisplayName,
      status: 'success',
      durationMs: Math.round(performance.now() - start),
      base64: res.base64,
      mimeType: res.mimeType || 'image/jpeg',
      mediaId: res.mediaId,
      width: dims.width,
      height: dims.height,
    };
  } catch (err: any) {
    return {
      modelName: modelDisplayName,
      status: 'error',
      durationMs: Math.round(performance.now() - start),
      errorMessage: err?.message || String(err),
    };
  }
}

/**
 * Phép thử C: Tách lớp Parallax (Nền & Chủ thể xanh lá -> chroma key)
 */
export async function testParallaxLayers(
  baseImage: { base64: string; mimeType: string; mediaId: string; modelName: string }
): Promise<{
  bgBase64: string;
  bgMediaId: string;
  subjectRawBase64: string;
  subjectCutoutBase64: string;
  subjectCutoutDataUrl: string;
  offsetPx: { dx: number; dy: number; total: number };
  durationMs: number;
}> {
  const startTime = performance.now();

  // Model ưu tiên model đã thành công của ảnh gốc hoặc fallback Nano Banana 2.1
  const modelToUse = baseImage.modelName || '🍌 Nano Banana 2.1';

  // 1. Sinh lớp nền (Background fill)
  const bgPrompt =
    'Remove the main subject completely and fill the area with matching background. Keep the exact same composition, camera angle, colors and art style. No subject, no text.';

  // 2. Sinh lớp chủ thể (Subject with pure green screen)
  const subjectPrompt =
    'Keep only the main subject exactly as it is, same size, same position and same pose; replace everything else with a perfectly flat solid pure green background (#00FF00). No shadows on the background, no text.';

  // Gọi tuần tự
  const bgRes = await Flow.generate.image({
    prompt: bgPrompt,
    referenceImageMediaIds: [baseImage.mediaId],
    modelDisplayName: modelToUse,
    aspectRatio: '16:9',
  });

  const subjectRes = await Flow.generate.image({
    prompt: subjectPrompt,
    referenceImageMediaIds: [baseImage.mediaId],
    modelDisplayName: modelToUse,
    aspectRatio: '16:9',
  });

  // Tách chroma key từ subject raw base64
  const { cutoutBase64, cutoutDataUrl } = await chromaKeyExtract(
    `data:${subjectRes.mimeType || 'image/jpeg'};base64,${subjectRes.base64}`
  );

  // Tính độ lệch tâm
  const offset = await calculateSubjectOffset(
    `data:${baseImage.mimeType};base64,${baseImage.base64}`,
    `data:${bgRes.mimeType || 'image/jpeg'};base64,${bgRes.base64}`,
    cutoutDataUrl
  );

  return {
    bgBase64: bgRes.base64,
    bgMediaId: bgRes.mediaId,
    subjectRawBase64: subjectRes.base64,
    subjectCutoutBase64: cutoutBase64,
    subjectCutoutDataUrl: cutoutDataUrl,
    offsetPx: offset,
    durationMs: Math.round(performance.now() - startTime),
  };
}

/**
 * Phép thử D: AI Soi Ảnh (Flow.generate.text với hình thu nhỏ)
 */
export async function testAiVision(
  imageBase64: string,
  imageMimeType: string = 'image/jpeg'
): Promise<AiVisionResult> {
  const startTime = performance.now();
  try {
    // Thu nhỏ về JPEG 768px để tối ưu băng thông và tốc độ
    const resized = await resizeImageToJpeg(imageBase64, imageMimeType, 768);

    const systemInstruction =
      'You are a strict creative AI quality inspector. Analyze the provided image against the prompt. Respond ONLY with valid raw JSON (no markdown formatting, no backticks, no extra text): {"matchesPrompt": number (0-100), "artifacts": string[], "hasText": boolean, "verdict": "ok"|"regenerate", "note": string}';

    const promptText = `Evaluate this image against the user prompt: "${TEST_PROMPT}". Does it match faithfully? Are there any anatomical distortions, unwanted text or blurriness?`;

    const res = await Flow.generate.text(promptText, {
      systemInstruction,
      thinkingLevel: 'low',
      images: [
        {
          base64: resized.base64,
          mimeType: resized.mimeType,
        },
      ],
    });

    const raw = (res.text || '').trim();
    // Parse JSON an toàn (loại bỏ markdown nếu có)
    const jsonCleaned = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(jsonCleaned);

    return {
      status: 'success',
      durationMs: Math.round(performance.now() - startTime),
      parsedJson: parsed,
      rawText: raw,
    };
  } catch (err: any) {
    return {
      status: 'error',
      durationMs: Math.round(performance.now() - startTime),
      errorMessage: err?.message || String(err),
    };
  }
}

/**
 * Helper: Lấy width & height của ảnh base64
 */
function getImageDimensions(base64: string, mimeType: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

/**
 * Helper: Resize ảnh về max 768px và trả về JPEG base64
 */
function resizeImageToJpeg(
  base64: string,
  mimeType: string,
  maxDim: number
): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let w = img.naturalWidth || 640;
      let h = img.naturalHeight || 360;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve({ base64, mimeType });
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve({
        base64: dataUrl.split(',')[1],
        mimeType: 'image/jpeg',
      });
    };
    img.onerror = () => resolve({ base64, mimeType });
    img.src = base64.startsWith('data:') ? base64 : `data:${mimeType};base64,${base64}`;
  });
}
