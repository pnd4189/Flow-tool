import { Flow } from 'flow-sdk';
import type { ParallaxLayerData, SupportedAspectRatio } from '../types';
import { chromaKeyExtract } from './chromaKey';
import { withTimeout, isTemporaryError } from './genQueue';

// Bộ nhớ đệm cache theo mediaId - CHỈ lưu kết quả ready hoặc disabled hợp lệ, KHÔNG lưu lỗi tạm thời
const LAYER_CACHE = new Map<string, ParallaxLayerData>();

export interface LayerGenerationOptions {
  mediaId: string;
  modelName: string;
  aspectRatio: SupportedAspectRatio;
  originalBase64?: string;
}

export interface LayerInspectionResult {
  isValid: boolean;
  subjectAreaRatio: number;
  center: { x: number; y: number };
  reasonVi?: string;
}

/**
 * Chuyển đổi base64 sang Blob (giải phóng chuỗi base64 khỏi RAM)
 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Kiểm tra chất lượng lớp chủ thể từ chuỗi dataUrl / canvas
 */
export async function inspectSubjectAlphaLayer(
  cutoutDataUrl: string
): Promise<LayerInspectionResult> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = (e) => reject(new Error('Không thể tải dữ liệu chủ thể để kiểm định alpha.'));
    el.src = cutoutDataUrl;
  });

  const w = img.naturalWidth || img.width || 640;
  const h = img.naturalHeight || img.height || 360;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return {
      isValid: false,
      subjectAreaRatio: 0,
      center: { x: 0.5, y: 0.5 },
      reasonVi: 'Lỗi bộ đệm đồ họa không đọc được kênh alpha',
    };
  }

  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  let activePixelCount = 0;
  let sumX = 0;
  let sumY = 0;

  const step = 2;
  let sampleCount = 0;

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      sampleCount++;
      const idx = (y * w + x) * 4;
      const alpha = data[idx + 3];
      if (alpha > 128) {
        activePixelCount++;
        sumX += x;
        sumY += y;
      }
    }
  }

  const subjectAreaRatio = sampleCount > 0 ? activePixelCount / sampleCount : 0;
  const centerX = activePixelCount > 0 ? (sumX / activePixelCount) / w : 0.5;
  const centerY = activePixelCount > 0 ? (sumY / activePixelCount) / h : 0.5;

  if (subjectAreaRatio < 0.01) {
    return {
      isValid: false,
      subjectAreaRatio,
      center: { x: 0.5, y: 0.5 },
      reasonVi: 'Ảnh phong cảnh không có chủ thể rõ — dùng máy quay thường',
    };
  }

  if (subjectAreaRatio > 0.65) {
    return {
      isValid: false,
      subjectAreaRatio,
      center: { x: Math.max(0, Math.min(1, centerX)), y: Math.max(0, Math.min(1, centerY)) },
      reasonVi: 'Chủ thể quá lớn chiếm >65% khung hình — không phù hợp tách lớp parallax',
    };
  }

  return {
    isValid: true,
    subjectAreaRatio,
    center: {
      x: Math.max(0.05, Math.min(0.95, centerX)),
      y: Math.max(0.05, Math.min(0.95, centerY)),
    },
  };
}

/**
 * Sinh ảnh với timeout 120s và thử lại tối đa 2 lần khi gặp lỗi tạm thời (chờ 5s, 15s)
 */
async function generateLayerImageWithRetry(
  prompt: string,
  mediaId: string,
  modelName: string,
  aspectRatio: SupportedAspectRatio,
  label: string
): Promise<{ base64: string; mimeType?: string; mediaId: string }> {
  let attempt = 0;
  const maxRetries = 2;
  const retryDelays = [5000, 15000];

  while (true) {
    try {
      const call = Flow.generate.image({
        prompt,
        referenceImageMediaIds: [mediaId],
        modelDisplayName: modelName,
        aspectRatio: aspectRatio as any,
      });
      return await withTimeout(call, 120000, `Flow.generate.image [${label}]`);
    } catch (err: any) {
      attempt++;
      const errMsg = err?.message || String(err);
      if (attempt <= maxRetries && isTemporaryError(errMsg)) {
        const delay = retryDelays[attempt - 1] || 15000;
        console.warn(`Tách lớp [${label}] tạm thời gián đoạn (${errMsg}), thử lại lần ${attempt}/${maxRetries} sau ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Đợt 5B: Tạo 2 lớp Parallax, timeout 120s, retry 2 lần cho lỗi tạm thời.
 * Lưu dưới dạng Blob + ObjectURL, KHÔNG giữ subjectCutoutDataUrl hay chuỗi base64 lớn.
 * KHÔNG lưu kết quả lỗi vào LAYER_CACHE.
 */
export async function generateParallaxLayers(
  options: LayerGenerationOptions
): Promise<ParallaxLayerData> {
  const { mediaId, modelName, aspectRatio } = options;

  // Kiểm tra cache trước: chỉ lấy khi đã ready hoặc disabled do phân tích alpha
  if (LAYER_CACHE.has(mediaId)) {
    const cached = LAYER_CACHE.get(mediaId)!;
    if (cached.status === 'ready' || cached.status === 'disabled') {
      return cached;
    }
  }

  const promptBg =
    'Remove the main subject completely and fill the area with matching background. Keep the exact same composition, camera angle, colors and art style. No subject, no text.';

  const promptSubject =
    'Keep only the main subject exactly as it is, same size, same position and same pose; replace everything else with a perfectly flat solid pure green background (#00FF00). No shadows on the background, no text.';

  try {
    // 1. Sinh nền (có timeout 120s và retry 2 lần)
    const bgRes = await generateLayerImageWithRetry(
      promptBg,
      mediaId,
      modelName,
      aspectRatio,
      'Nền parallax'
    );

    const bgBlob = base64ToBlob(bgRes.base64, bgRes.mimeType || 'image/jpeg');
    const bgBlobUrl = URL.createObjectURL(bgBlob);

    // 2. Sinh chủ thể nền xanh #00FF00 (có timeout 120s và retry 2 lần)
    const subjectRes = await generateLayerImageWithRetry(
      promptSubject,
      mediaId,
      modelName,
      aspectRatio,
      'Chủ thể parallax'
    );

    // 3. Tách Chroma Key
    const { cutoutBase64, cutoutDataUrl } = await chromaKeyExtract(
      `data:${subjectRes.mimeType || 'image/jpeg'};base64,${subjectRes.base64}`
    );

    const subjectCutoutBlob = base64ToBlob(cutoutBase64, 'image/png');
    const subjectCutoutBlobUrl = URL.createObjectURL(subjectCutoutBlob);

    // 4. Kiểm định alpha
    const inspection = await inspectSubjectAlphaLayer(cutoutDataUrl);

    if (!inspection.isValid) {
      const disabledResult: ParallaxLayerData = {
        status: 'disabled',
        bgBlob,
        bgBlobUrl,
        bgMediaId: bgRes.mediaId,
        subjectCutoutBlob,
        subjectCutoutBlobUrl,
        subjectAreaRatio: inspection.subjectAreaRatio,
        subjectCenter: inspection.center,
        disabledReason: inspection.reasonVi,
        updatedAt: Date.now(),
      };
      LAYER_CACHE.set(mediaId, disabledResult);
      return disabledResult;
    }

    const readyResult: ParallaxLayerData = {
      status: 'ready',
      bgBlob,
      bgBlobUrl,
      bgMediaId: bgRes.mediaId,
      subjectCutoutBlob,
      subjectCutoutBlobUrl,
      subjectAreaRatio: inspection.subjectAreaRatio,
      subjectCenter: inspection.center,
      updatedAt: Date.now(),
    };

    LAYER_CACHE.set(mediaId, readyResult);
    return readyResult;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    // KHÔNG lưu kết quả lỗi vào LAYER_CACHE để lần sau còn có cơ hội chạy lại
    const failedResult: ParallaxLayerData = {
      status: 'disabled',
      disabledReason: `Lỗi tách lớp: ${errorMsg}`,
      error: errorMsg,
      updatedAt: Date.now(),
    };
    return failedResult;
  }
}

/**
 * Xóa cache cho 1 mediaId và giải phóng URL
 */
export function invalidateLayerCache(mediaId: string): void {
  const cached = LAYER_CACHE.get(mediaId);
  if (cached) {
    if (cached.bgBlobUrl) URL.revokeObjectURL(cached.bgBlobUrl);
    if (cached.subjectCutoutBlobUrl) URL.revokeObjectURL(cached.subjectCutoutBlobUrl);
    LAYER_CACHE.delete(mediaId);
  }
}

export function getCachedLayerData(mediaId: string): ParallaxLayerData | undefined {
  return LAYER_CACHE.get(mediaId);
}
