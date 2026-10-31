/**
 * Invariants enforced by compositing:
 * 1. For raster edits: an editable area is strictly (selectionMask > 0 && protectionMask == 0).
 *    Protection wins completely: if protectionMask > 0, source accepted pixel is preserved untouched.
 *    No partial recoloring or antialiasing blend applies to protected pixels.
 * 2. Pixels outside selectionMask are never modified in raster edits.
 * 3. For subject cutout: protection preserves the subject/face rather than punching a hole.
 *    Retained opacity is max(selection, protection) multiplied by original alpha.
 *    Protected pixels retain their exact original RGBA color untouched.
 */

export interface CompositeOptions {
  baseImage: HTMLCanvasElement;
  editCandidate?: HTMLCanvasElement;
  selectionMask: HTMLCanvasElement;
  protectionMask: HTMLCanvasElement;
}

/**
 * Creates a pixel-perfect composited image where modifications only apply to
 * (selection > 0 && protection == 0). Any protection > 0 copies exact source RGBA.
 */
export function compositeImage(options: CompositeOptions): HTMLCanvasElement {
  const { baseImage, editCandidate, selectionMask, protectionMask } = options;
  const width = baseImage.width;
  const height = baseImage.height;

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) throw new Error('Không thể khởi tạo ngữ cảnh vẽ');

  const baseCtx = baseImage.getContext('2d', { willReadFrequently: true });
  if (!baseCtx) throw new Error('Không thể đọc dữ liệu ảnh gốc');
  const baseData = baseCtx.getImageData(0, 0, width, height);

  const selCtx = selectionMask.getContext('2d', { willReadFrequently: true });
  const selData = selCtx ? selCtx.getImageData(0, 0, width, height).data : null;

  const protCtx = protectionMask.getContext('2d', { willReadFrequently: true });
  const protData = protCtx ? protCtx.getImageData(0, 0, width, height).data : null;

  const candCtx = editCandidate?.getContext('2d', { willReadFrequently: true });
  const candData = candCtx ? candCtx.getImageData(0, 0, width, height).data : null;

  const outData = outCtx.createImageData(width, height);
  const totalPixels = width * height;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;

    const protVal = protData ? protData[idx] : 0;
    // Strict invariant: any protection value > 0 preserves exact source RGBA
    if (protVal > 0) {
      outData.data[idx] = baseData.data[idx];
      outData.data[idx + 1] = baseData.data[idx + 1];
      outData.data[idx + 2] = baseData.data[idx + 2];
      outData.data[idx + 3] = baseData.data[idx + 3];
      continue;
    }

    const selVal = selData ? selData[idx] : 0;
    if (selVal > 0 && candData) {
      // Linear blend based on selection confidence for unprotected pixels only
      const alphaNorm = selVal / 255;
      outData.data[idx] = Math.round(baseData.data[idx] * (1 - alphaNorm) + candData[idx] * alphaNorm);
      outData.data[idx + 1] = Math.round(baseData.data[idx + 1] * (1 - alphaNorm) + candData[idx + 1] * alphaNorm);
      outData.data[idx + 2] = Math.round(baseData.data[idx + 2] * (1 - alphaNorm) + candData[idx + 2] * alphaNorm);
      outData.data[idx + 3] = baseData.data[idx + 3];
    } else {
      // Untouched pixel outside selection
      outData.data[idx] = baseData.data[idx];
      outData.data[idx + 1] = baseData.data[idx + 1];
      outData.data[idx + 2] = baseData.data[idx + 2];
      outData.data[idx + 3] = baseData.data[idx + 3];
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return outputCanvas;
}

/**
 * Creates a transparent PNG cutout of the selected area.
 * Protection preserves the subject/features rather than punching a hole.
 * Retained opacity = max(selection, protection) * original alpha.
 * Protected pixels keep their exact original RGBA from source.
 */
export function createCutoutCanvas(
  sourceCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement
): HTMLCanvasElement {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  const cutout = document.createElement('canvas');
  cutout.width = width;
  cutout.height = height;
  const ctx = cutout.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể khởi tạo cutout canvas');

  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error('Không thể đọc source canvas');

  const srcData = srcCtx.getImageData(0, 0, width, height);
  const selCtx = selectionMask.getContext('2d', { willReadFrequently: true });
  const selData = selCtx ? selCtx.getImageData(0, 0, width, height).data : null;

  const protCtx = protectionMask.getContext('2d', { willReadFrequently: true });
  const protData = protCtx ? protCtx.getImageData(0, 0, width, height).data : null;

  const outData = ctx.createImageData(width, height);
  const total = width * height;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const protVal = protData ? protData[idx] : 0;
    const selVal = selData ? selData[idx] : 0;

    // Strict rule: if protected, always keep full original pixel RGBA
    if (protVal > 0) {
      outData.data[idx] = srcData.data[idx];
      outData.data[idx + 1] = srcData.data[idx + 1];
      outData.data[idx + 2] = srcData.data[idx + 2];
      outData.data[idx + 3] = srcData.data[idx + 3];
      continue;
    }

    if (selVal > 0) {
      outData.data[idx] = srcData.data[idx];
      outData.data[idx + 1] = srcData.data[idx + 1];
      outData.data[idx + 2] = srcData.data[idx + 2];
      outData.data[idx + 3] = Math.round((srcData.data[idx + 3] * selVal) / 255);
    } else {
      outData.data[idx] = 0;
      outData.data[idx + 1] = 0;
      outData.data[idx + 2] = 0;
      outData.data[idx + 3] = 0;
    }
  }

  ctx.putImageData(outData, 0, 0);
  return cutout;
}
