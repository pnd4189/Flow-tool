import { Flow } from 'flow-sdk';
import {
  DecodedImage,
  ColorAdjustmentParams,
  RetouchSessionPayload,
  RestoredSessionResult,
} from '../types';
import { blobToCanvas, countNonZeroPixels } from './imageUtils';

export const SESSION_FORMAT_ID = 'retouch_studio_session';
export const CURRENT_SESSION_VERSION = 1;
export const MAX_SAFE_TOTAL_SESSION_BYTES = 50 * 1024 * 1024; // 50MB max JSON text size
export const MAX_SAFE_IMAGE_PIXELS = 16_000_000; // 16MP limit guard

/**
 * Encodes canvas to lossless PNG Base64 string (without data URL prefix).
 */
async function canvasToPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  const dataUrl = canvas.toDataURL('image/png');
  const commaIdx = dataUrl.indexOf(',');
  return commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
}

/**
 * Creates and exports a session JSON file using Flow.download.
 */
export async function exportSessionFile(options: {
  name: string;
  originalImage: DecodedImage;
  currentImage: DecodedImage;
  selectionMask: HTMLCanvasElement;
  protectionMask: HTMLCanvasElement;
  protectFaceToggle: boolean;
  hasDetectedFacesOnce: boolean;
  brushRadius: number;
  dilationRadius: number;
  featherRadius: number;
  colorParams: ColorAdjustmentParams;
}): Promise<string> {
  const {
    name,
    originalImage,
    currentImage,
    selectionMask,
    protectionMask,
    protectFaceToggle,
    hasDetectedFacesOnce,
    brushRadius,
    dilationRadius,
    featherRadius,
    colorParams,
  } = options;

  const [origBase64, currBase64, selBase64, protBase64] = await Promise.all([
    canvasToPngBase64(originalImage.canvas),
    canvasToPngBase64(currentImage.canvas),
    canvasToPngBase64(selectionMask),
    canvasToPngBase64(protectionMask),
  ]);

  const selCount = countNonZeroPixels(selectionMask);
  const protCount = countNonZeroPixels(protectionMask);

  const payload: RetouchSessionPayload = {
    format: SESSION_FORMAT_ID,
    version: CURRENT_SESSION_VERSION,
    name: name || currentImage.name || 'retouch_session',
    savedAt: Date.now(),
    dimensions: {
      width: currentImage.width,
      height: currentImage.height,
    },
    originalDimensions: {
      width: originalImage.width,
      height: originalImage.height,
    },
    images: {
      originalPngBase64: origBase64,
      currentPngBase64: currBase64,
    },
    masks: {
      selectionPngBase64: selBase64,
      protectionPngBase64: protBase64,
      selectionPixels: selCount,
      protectionPixels: protCount,
    },
    faceAnalysis: {
      hasDetectedFacesOnce,
      protectFaceToggle,
    },
    settings: {
      brushRadius,
      dilationRadius,
      featherRadius,
      colorParams,
    },
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  const bytes = new TextEncoder().encode(jsonStr);
  const base64Data = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));

  const baseClean = (name || 'retouch_session')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 30);
  const filename = `${baseClean || 'retouch_session'}.json`;

  await Flow.download({
    base64: base64Data,
    mimeType: 'application/json',
    filename,
  });

  return filename;
}

/**
 * Decodes a raw base64 PNG string to HTMLCanvasElement.
 */
async function decodeBase64ToCanvas(base64: string): Promise<HTMLCanvasElement> {
  const byteChars = atob(base64);
  const byteNumbers = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([byteNumbers], { type: 'image/png' });
  const imgBitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = imgBitmap.width;
  canvas.height = imgBitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    imgBitmap.close();
    throw new Error('Không thể khởi tạo bộ đệm canvas cho phiên làm việc.');
  }
  ctx.drawImage(imgBitmap, 0, 0);
  imgBitmap.close();
  return canvas;
}

/**
 * Strictly parses, validates schema/dimensions/payload, and decodes a session file.
 * Throws on any validation or dimension mismatch so the calling app can leave
 * current document state completely untouched.
 */
export async function parseAndValidateSessionFile(file: File): Promise<RestoredSessionResult> {
  if (file.size > MAX_SAFE_TOTAL_SESSION_BYTES) {
    throw new Error(
      `Tệp phiên vượt quá kích thước an toàn (${(file.size / (1024 * 1024)).toFixed(1)} MB > 50 MB).`
    );
  }

  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Tệp không đúng định dạng JSON hợp lệ.');
  }

  if (!json || typeof json !== 'object') {
    throw new Error('Nội dung tệp JSON không phải là đối tượng cấu trúc.');
  }

  const p = json as Partial<RetouchSessionPayload>;

  if (p.format !== SESSION_FORMAT_ID) {
    throw new Error(`Định dạng tệp không khớp (yêu cầu '${SESSION_FORMAT_ID}').`);
  }

  if (typeof p.version !== 'number' || p.version !== 1) {
    throw new Error(`Phiên bản tệp không được hỗ trợ (version=${p.version}).`);
  }

  if (
    !p.dimensions ||
    typeof p.dimensions.width !== 'number' ||
    typeof p.dimensions.height !== 'number' ||
    !Number.isFinite(p.dimensions.width) ||
    !Number.isFinite(p.dimensions.height) ||
    p.dimensions.width <= 0 ||
    p.dimensions.height <= 0
  ) {
    throw new Error('Kích thước ảnh hiện tại trong tệp phiên không hợp lệ.');
  }

  const currentW = Math.round(p.dimensions.width);
  const currentH = Math.round(p.dimensions.height);

  if (currentW * currentH > MAX_SAFE_IMAGE_PIXELS) {
    throw new Error('Kích thước ảnh trong phiên vượt quá giới hạn an toàn 16 MP.');
  }

  if (
    !p.originalDimensions ||
    typeof p.originalDimensions.width !== 'number' ||
    typeof p.originalDimensions.height !== 'number' ||
    !Number.isFinite(p.originalDimensions.width) ||
    !Number.isFinite(p.originalDimensions.height) ||
    p.originalDimensions.width <= 0 ||
    p.originalDimensions.height <= 0
  ) {
    throw new Error('Kích thước ảnh gốc trong tệp phiên không hợp lệ.');
  }

  const origW = Math.round(p.originalDimensions.width);
  const origH = Math.round(p.originalDimensions.height);

  if (!p.images || !p.images.originalPngBase64 || !p.images.currentPngBase64) {
    throw new Error('Thiếu dữ liệu ảnh gốc hoặc ảnh hiện tại trong tệp phiên.');
  }

  if (!p.masks || !p.masks.selectionPngBase64 || !p.masks.protectionPngBase64) {
    throw new Error('Thiếu dữ liệu mặt nạ vùng chọn hoặc bảo vệ trong tệp phiên.');
  }

  // Decode canvases and verify matching dimensions
  const [origCanvas, currCanvas, selCanvas, protCanvas] = await Promise.all([
    decodeBase64ToCanvas(p.images.originalPngBase64),
    decodeBase64ToCanvas(p.images.currentPngBase64),
    decodeBase64ToCanvas(p.masks.selectionPngBase64),
    decodeBase64ToCanvas(p.masks.protectionPngBase64),
  ]);

  if (origCanvas.width !== origW || origCanvas.height !== origH) {
    throw new Error(
      `Kích thước ảnh gốc được giải mã (${origCanvas.width}x${origCanvas.height}) không khớp khai báo (${origW}x${origH}).`
    );
  }

  if (currCanvas.width !== currentW || currCanvas.height !== currentH) {
    throw new Error(
      `Kích thước ảnh hiện tại được giải mã (${currCanvas.width}x${currCanvas.height}) không khớp khai báo (${currentW}x${currentH}).`
    );
  }

  if (selCanvas.width !== currentW || selCanvas.height !== currentH) {
    throw new Error(
      `Kích thước mặt nạ vùng chọn (${selCanvas.width}x${selCanvas.height}) không khớp ảnh hiện tại (${currentW}x${currentH}).`
    );
  }

  if (protCanvas.width !== currentW || protCanvas.height !== currentH) {
    throw new Error(
      `Kích thước mặt nạ bảo vệ (${protCanvas.width}x${protCanvas.height}) không khớp ảnh hiện tại (${currentW}x${currentH}).`
    );
  }

  const origBlob = await new Promise<Blob | null>((res) => origCanvas.toBlob(res, 'image/png'));
  const currBlob = await new Promise<Blob | null>((res) => currCanvas.toBlob(res, 'image/png'));

  if (!origBlob || !currBlob) {
    throw new Error('Không thể tạo bộ nhớ Blob cho ảnh đã giải mã.');
  }

  const origDecoded: DecodedImage = {
    canvas: origCanvas,
    width: origW,
    height: origH,
    blobUrl: URL.createObjectURL(origBlob),
    name: p.name || 'original.png',
    mimeType: 'image/png',
  };

  const currDecoded: DecodedImage = {
    canvas: currCanvas,
    width: currentW,
    height: currentH,
    blobUrl: URL.createObjectURL(currBlob),
    name: p.name || 'current.png',
    mimeType: 'image/png',
  };

  const defaultColorParams: ColorAdjustmentParams = {
    brightness: 0,
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    sharpen: 0,
    denoise: 0,
  };

  const restoredColorParams = p.settings?.colorParams
    ? { ...defaultColorParams, ...p.settings.colorParams }
    : defaultColorParams;

  const selCount = countNonZeroPixels(selCanvas);
  const protCount = countNonZeroPixels(protCanvas);

  return {
    originalImage: origDecoded,
    currentImage: currDecoded,
    selectionMask: selCanvas,
    protectionMask: protCanvas,
    selectionPixels: selCount,
    protectionPixels: protCount,
    faceAnalysis: {
      hasDetectedFacesOnce: Boolean(p.faceAnalysis?.hasDetectedFacesOnce),
      protectFaceToggle: p.faceAnalysis?.protectFaceToggle !== false,
    },
    settings: {
      brushRadius: typeof p.settings?.brushRadius === 'number' ? Math.max(3, Math.min(120, p.settings.brushRadius)) : 25,
      dilationRadius: typeof p.settings?.dilationRadius === 'number' ? Math.max(0, Math.min(30, p.settings.dilationRadius)) : 3,
      featherRadius: typeof p.settings?.featherRadius === 'number' ? Math.max(0, Math.min(20, p.settings.featherRadius)) : 0,
      colorParams: restoredColorParams,
    },
  };
}
