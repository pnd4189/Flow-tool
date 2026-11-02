import { Flow } from 'flow-sdk';
import { RefImage, RefKind } from '../types';
import { logDiag } from './diagnostics';

export const MAX_FACE_REFS = 3;
export const MAX_OUTFIT_REFS = 4;

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

export function validateFile(file: { name: string; type: string; size: number }): { ok: true } | { ok: false; error: string } {
  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  const cleanType = file.type.toLowerCase();

  if (!allowed.includes(cleanType)) {
    return {
      ok: false,
      error: 'Định dạng tệp không được hỗ trợ. Vui lòng chọn tệp ảnh PNG, JPEG hoặc WebP.',
    };
  }

  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: 'Dung lượng tệp vượt quá giới hạn 12 MB. Vui lòng chọn ảnh nhỏ hơn 12 MB.',
    };
  }

  return { ok: true };
}

export function fitWithin(
  width: number,
  height: number,
  maxSide: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: maxSide, height: maxSide };
  }

  if (width <= maxSide && height <= maxSide) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  if (width > height) {
    const scale = maxSide / width;
    return {
      width: Math.round(maxSide),
      height: Math.max(1, Math.round(height * scale)),
    };
  } else {
    const scale = maxSide / height;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.round(maxSide),
    };
  }
}

function renderToJpegData(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  quality: number
): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, targetW);
  canvas.height = Math.max(1, targetH);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, targetW, targetH);
  }
  return canvas.toDataURL('image/jpeg', quality);
}

export async function prepareRefImage(
  input: File | { base64: string; mimeType: string; name?: string; mediaId?: string },
  kind: RefKind
): Promise<RefImage> {
  const id = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  if (input instanceof File) {
    const bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
    const srcW = bitmap.width;
    const srcH = bitmap.height;

    // Downscaled main image (max side 1536)
    const fittedMain = fitWithin(srcW, srcH, 1536);
    const mainDataUrl = renderToJpegData(bitmap, srcW, srcH, fittedMain.width, fittedMain.height, 0.92);
    const base64 = mainDataUrl.split(',')[1] || '';

    // Thumbnail (max side 160)
    const fittedThumb = fitWithin(srcW, srcH, 160);
    const thumbDataUrl = renderToJpegData(bitmap, srcW, srcH, fittedThumb.width, fittedThumb.height, 0.85);

    bitmap.close();

    return {
      id,
      kind,
      name: input.name || `ref_${kind}.jpg`,
      thumb: thumbDataUrl,
      base64,
      mimeType: 'image/jpeg',
      mediaId: null,
      source: 'file',
      status: 'ready',
    };
  }

  // Object input from Flow library or pre-encoded source
  const name = input.name || `library_ref_${kind}.jpg`;
  const mediaId = input.mediaId || null;
  const mimeType = input.mimeType || 'image/jpeg';
  const rawBase64 = input.base64;

  // Generate 160px thumb from base64
  const thumbDataUrl = await new Promise<string>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const fitted = fitWithin(img.naturalWidth || 160, img.naturalHeight || 160, 160);
      const canvas = document.createElement('canvas');
      canvas.width = fitted.width;
      canvas.height = fitted.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(img, 0, 0, fitted.width, fitted.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } else {
        resolve(`data:${mimeType};base64,${rawBase64}`);
      }
    };
    img.onerror = () => {
      resolve(`data:${mimeType};base64,${rawBase64}`);
    };
    img.src = `data:${mimeType};base64,${rawBase64}`;
  });

  return {
    id,
    kind,
    name,
    thumb: thumbDataUrl,
    base64: rawBase64,
    mimeType,
    mediaId,
    source: 'library',
    status: 'ready',
  };
}

export async function ensureUploaded(ref: RefImage): Promise<RefImage> {
  if (ref.mediaId) {
    logDiag('info', 'upload.skip', `Already uploaded mediaId=${ref.mediaId} name=${ref.name}`);
    return ref;
  }

  const uploadName = ref.name || `ref_${ref.kind}.jpg`;
  const base64Len = ref.base64.length;

  logDiag(
    'call',
    'upload',
    `name="${uploadName}" kind=${ref.kind} mimeType=${ref.mimeType} base64Length=${base64Len}`
  );
  const startTime = Date.now();

  try {
    const uploadResult = await Flow.upload({
      base64: ref.base64,
      mimeType: ref.mimeType as 'image/png' | 'image/jpeg',
      name: uploadName,
    });

    const durationMs = Date.now() - startTime;
    logDiag(
      'ok',
      'upload',
      `duration=${durationMs}ms mediaId=${uploadResult.mediaId} name="${uploadName}"`
    );

    return {
      ...ref,
      mediaId: uploadResult.mediaId,
      status: 'ready',
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    logDiag('error', 'upload', `duration=${durationMs}ms name="${uploadName}" error="${errorMsg}"`);
    throw err;
  }
}
