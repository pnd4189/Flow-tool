import { DecodedImage, CandidateApplyMode } from '../types';

/**
 * Decodes an uploaded File into native resolution canvas with correct orientation.
 */
export async function decodeUploadedFile(file: File): Promise<DecodedImage> {
  const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    throw new Error('Định dạng tệp không hợp lệ. Vui lòng tải lên PNG, JPEG hoặc WebP.');
  }

  let imageBitmap: ImageBitmap | null = null;
  try {
    imageBitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    imageBitmap = await createImageBitmap(file);
  }

  const width = imageBitmap.width;
  const height = imageBitmap.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể khởi tạo bộ đệm canvas');

  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();

  // Internal storage is strictly lossless PNG to avoid compression artifacts across edit cycles
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Không thể tạo bộ nhớ Blob');
  const blobUrl = URL.createObjectURL(blob);

  return {
    canvas,
    width,
    height,
    blobUrl,
    name: file.name,
    mimeType: 'image/png',
  };
}

/**
 * Decodes a raw base64 data string (from Flow SDK generation or API) into a DecodedImage.
 */
export async function decodeBase64ToImage(
  base64: string,
  mimeType: string,
  name: string
): Promise<DecodedImage> {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });

  const imageBitmap = await createImageBitmap(blob);
  const width = imageBitmap.width;
  const height = imageBitmap.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể khởi tạo bộ đệm canvas cho ảnh AI');

  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();

  // Lossless PNG for internal state
  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  const blobUrl = pngBlob ? URL.createObjectURL(pngBlob) : URL.createObjectURL(blob);

  return {
    canvas,
    width,
    height,
    blobUrl,
    name,
    mimeType: 'image/png',
  };
}

/**
 * Creates an empty grayscale mask canvas of given size with RGB=0 and A=255.
 */
export function createEmptyMaskCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}

/**
 * Counts non-zero pixels in a grayscale mask canvas.
 */
export function countNonZeroPixels(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 0) count++;
  }
  return count;
}

/**
 * Inverts a mask canvas in-place, keeping Alpha=255.
 */
export function invertMaskCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const inv = 255 - d[i];
    d[i] = inv;
    d[i + 1] = inv;
    d[i + 2] = inv;
    d[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Clears a mask canvas to all zeroes, keeping Alpha=255.
 */
export function clearMaskCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

/**
 * Clones a canvas into a new HTMLCanvasElement.
 */
export function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const ctx = copy.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, 0, 0);
  }
  return copy;
}

/**
 * Applies candidate mask to existing mask with specified combine mode:
 * - 'replace': existing = candidate
 * - 'add': existing = max(existing, candidate)
 * - 'subtract': existing = max(0, existing - candidate)
 * Pure grayscale RGB with alpha=255 guaranteed.
 */
export function applyCandidateToMask(
  targetMaskCanvas: HTMLCanvasElement,
  candidateMaskCanvas: HTMLCanvasElement,
  mode: CandidateApplyMode
): void {
  const w = targetMaskCanvas.width;
  const h = targetMaskCanvas.height;

  const tCtx = targetMaskCanvas.getContext('2d', { willReadFrequently: true });
  const cCtx = candidateMaskCanvas.getContext('2d', { willReadFrequently: true });
  if (!tCtx || !cCtx) return;

  const tData = tCtx.getImageData(0, 0, w, h);
  const cData = cCtx.getImageData(0, 0, w, h);
  const td = tData.data;
  const cd = cData.data;

  const total = w * h;
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const existingVal = td[idx];
    const candVal = cd[idx];

    let resultVal = 0;
    if (mode === 'replace') {
      resultVal = candVal;
    } else if (mode === 'add') {
      resultVal = Math.max(existingVal, candVal);
    } else if (mode === 'subtract') {
      resultVal = Math.max(0, existingVal - candVal);
    }

    td[idx] = resultVal;
    td[idx + 1] = resultVal;
    td[idx + 2] = resultVal;
    td[idx + 3] = 255;
  }

  tCtx.putImageData(tData, 0, 0);
}

/**
 * 'Lấp lỗ nhỏ' (Mask Refinement):
 * Uses connected-components labeling on unselected pixels (mask == 0).
 * Any enclosed component that DOES NOT touch the border of the canvas AND
 * has area <= maxHolePixels is filled as selected (255).
 * The exterior background component touches the border, so it is never filled.
 * Returns the number of enclosed holes filled and total filled pixels.
 */
export function fillSmallHolesInMask(
  maskCanvas: HTMLCanvasElement,
  maxHolePixels = 5000
): { holesFilled: number; pixelsFilled: number } {
  const w = maskCanvas.width;
  const h = maskCanvas.height;
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || w <= 0 || h <= 0) return { holesFilled: 0, pixelsFilled: 0 };

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const total = w * h;

  // 0 = unselected, 1 = selected (> 127)
  const isSelected = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    isSelected[i] = data[i * 4] > 127 ? 1 : 0;
  }

  // Label array for connected components of unselected pixels
  // -1 = unvisited, >= 0 = component ID
  const visited = new Int32Array(total);
  visited.fill(-1);

  let holesFilled = 0;
  let totalPixelsFilled = 0;

  // Breadth-first flood fill queues
  const queueX = new Int32Array(total);
  const queueY = new Int32Array(total);

  // Iterate over all pixels
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (isSelected[idx] === 1 || visited[idx] !== -1) {
        continue; // Selected or already visited
      }

      // Start new connected component of unselected pixels
      let head = 0;
      let tail = 0;
      queueX[tail] = x;
      queueY[tail] = y;
      tail++;
      visited[idx] = 1;

      let touchesBorder = false;
      let componentSize = 0;

      while (head < tail) {
        const cx = queueX[head];
        const cy = queueY[head];
        head++;
        componentSize++;

        if (cx === 0 || cx === w - 1 || cy === 0 || cy === h - 1) {
          touchesBorder = true;
        }

        // 4-neighborhood
        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];

        for (let n = 0; n < 4; n++) {
          const nx = neighbors[n][0];
          const ny = neighbors[n][1];
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nIdx = ny * w + nx;
            if (isSelected[nIdx] === 0 && visited[nIdx] === -1) {
              visited[nIdx] = 1;
              queueX[tail] = nx;
              queueY[tail] = ny;
              tail++;
            }
          }
        }
      }

      // If it DOES NOT touch the border, it is an interior enclosed hole!
      if (!touchesBorder && componentSize <= maxHolePixels) {
        holesFilled++;
        totalPixelsFilled += componentSize;
        // Fill all pixels in this component with 255
        for (let k = 0; k < tail; k++) {
          const px = queueX[k];
          const py = queueY[k];
          const pIdx = (py * w + px) * 4;
          data[pIdx] = 255;
          data[pIdx + 1] = 255;
          data[pIdx + 2] = 255;
          data[pIdx + 3] = 255;
        }
      }
    }
  }

  if (totalPixelsFilled > 0) {
    ctx.putImageData(imgData, 0, 0);
  }

  return { holesFilled, pixelsFilled: totalPixelsFilled };
}

/**
 * 'Nới vùng chọn' (Morphological Dilation):
 * Dilates the binary/grayscale mask by `radius` native pixels using circular or Euclidean distance / separable max passes.
 * Uses Euclidean radius for natural expansion without square artifacts.
 * Always rebuilds freshly from base mask to avoid cumulative expansion.
 */
export function dilateMaskCanvas(sourceMask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const r = Math.max(0, Math.min(30, Math.round(radius)));
  if (r === 0) return cloneCanvas(sourceMask);

  const w = sourceMask.width;
  const h = sourceMask.height;
  const ctx = sourceMask.getContext('2d', { willReadFrequently: true });
  if (!ctx) return cloneCanvas(sourceMask);

  const src = ctx.getImageData(0, 0, w, h).data;
  const total = w * h;

  // Binary flag array: 1 if pixel is selected (> 100)
  const isFg = new Uint8Array(total);
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    isFg[j] = src[i] > 100 ? 1 : 0;
  }

  // Precompute circular neighborhood offsets
  const r2 = r * r;
  const offsets: Array<{ dx: number; dy: number }> = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) {
        offsets.push({ dx, dy });
      }
    }
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) return cloneCanvas(sourceMask);

  const outImgData = outCtx.createImageData(w, h);
  const out = outImgData.data;

  // Initialize output with black alpha 255
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    out[idx] = 0;
    out[idx + 1] = 0;
    out[idx + 2] = 0;
    out[idx + 3] = 255;
  }

  // For every foreground pixel, splat the circular footprint
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      if (isFg[rowOffset + x] === 1) {
        for (let k = 0; k < offsets.length; k++) {
          const nx = x + offsets[k].dx;
          const ny = y + offsets[k].dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nIdx = (ny * w + nx) * 4;
            out[nIdx] = 255;
            out[nIdx + 1] = 255;
            out[nIdx + 2] = 255;
          }
        }
      }
    }
  }

  outCtx.putImageData(outImgData, 0, 0);
  return outCanvas;
}

/**
 * Fast 2-pass separable 1D box blur for grayscale masks (feathering 0-20px).
 * Always preserves Alpha=255 and operates on native image resolution.
 */
export function featherMaskCanvas(sourceMask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const r = Math.max(0, Math.min(20, Math.round(radius)));
  if (r === 0) return cloneCanvas(sourceMask);

  const w = sourceMask.width;
  const h = sourceMask.height;
  const ctx = sourceMask.getContext('2d', { willReadFrequently: true });
  if (!ctx) return cloneCanvas(sourceMask);

  const src = ctx.getImageData(0, 0, w, h).data;
  const bufferA = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    bufferA[j] = src[i];
  }

  const bufferB = new Uint8Array(w * h);

  // Horizontal box pass
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    let sum = 0;
    const windowSize = 2 * r + 1;

    for (let x = -r; x <= r; x++) {
      const clampedX = Math.min(Math.max(x, 0), w - 1);
      sum += bufferA[rowOffset + clampedX];
    }
    bufferB[rowOffset] = Math.round(sum / windowSize);

    for (let x = 1; x < w; x++) {
      const prevX = Math.max(x - 1 - r, 0);
      const nextX = Math.min(x + r, w - 1);
      sum += bufferA[rowOffset + nextX] - bufferA[rowOffset + prevX];
      bufferB[rowOffset + x] = Math.round(sum / windowSize);
    }
  }

  // Vertical box pass
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = w;
  resultCanvas.height = h;
  const resCtx = resultCanvas.getContext('2d', { willReadFrequently: true });
  if (!resCtx) return cloneCanvas(sourceMask);

  const outData = resCtx.createImageData(w, h);
  const out = outData.data;

  for (let x = 0; x < w; x++) {
    let sum = 0;
    const windowSize = 2 * r + 1;

    for (let y = -r; y <= r; y++) {
      const clampedY = Math.min(Math.max(y, 0), h - 1);
      sum += bufferB[clampedY * w + x];
    }
    const idx0 = (0 * w + x) * 4;
    const v0 = Math.round(sum / windowSize);
    out[idx0] = v0;
    out[idx0 + 1] = v0;
    out[idx0 + 2] = v0;
    out[idx0 + 3] = 255;

    for (let y = 1; y < h; y++) {
      const prevY = Math.max(y - 1 - r, 0);
      const nextY = Math.min(y + r, h - 1);
      sum += bufferB[nextY * w + x] - bufferB[prevY * w + x];
      const val = Math.round(sum / windowSize);
      const outIdx = (y * w + x) * 4;
      out[outIdx] = val;
      out[outIdx + 1] = val;
      out[outIdx + 2] = val;
      out[outIdx + 3] = 255;
    }
  }

  resCtx.putImageData(outData, 0, 0);
  return resultCanvas;
}

/**
 * Subtracts protection mask from selection mask in-place:
 * effectiveMask = max(0, selectionMask - protectionMask).
 * Alpha is guaranteed 255.
 */
export function subtractProtectionFromMask(
  selectionCanvas: HTMLCanvasElement,
  protectionCanvas: HTMLCanvasElement
): HTMLCanvasElement {
  const w = selectionCanvas.width;
  const h = selectionCanvas.height;

  const result = document.createElement('canvas');
  result.width = w;
  result.height = h;
  const rCtx = result.getContext('2d', { willReadFrequently: true });
  const sCtx = selectionCanvas.getContext('2d', { willReadFrequently: true });
  const pCtx = protectionCanvas.getContext('2d', { willReadFrequently: true });
  if (!rCtx || !sCtx || !pCtx) return cloneCanvas(selectionCanvas);

  const sData = sCtx.getImageData(0, 0, w, h).data;
  const pData = pCtx.getImageData(0, 0, w, h).data;
  const rImg = rCtx.createImageData(w, h);
  const rd = rImg.data;
  const total = w * h;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const s = sData[idx];
    const p = pData[idx];
    const eff = p > 0 ? 0 : s; // Strict protection: any p > 0 subtracts completely
    rd[idx] = eff;
    rd[idx + 1] = eff;
    rd[idx + 2] = eff;
    rd[idx + 3] = 255;
  }

  rCtx.putImageData(rImg, 0, 0);
  return result;
}

/**
 * Creates a small thumbnail canvas for edit history.
 */
export async function createThumbnailUrl(canvas: HTMLCanvasElement, maxDim = 80): Promise<string> {
  const aspect = canvas.width / canvas.height;
  let tw = maxDim;
  let th = maxDim / aspect;
  if (th > maxDim) {
    th = maxDim;
    tw = maxDim * aspect;
  }
  const thumb = document.createElement('canvas');
  thumb.width = Math.max(1, Math.round(tw));
  thumb.height = Math.max(1, Math.round(th));
  const tCtx = thumb.getContext('2d');
  if (tCtx) {
    tCtx.imageSmoothingEnabled = true;
    tCtx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  }
  const blob = await new Promise<Blob | null>((res) => thumb.toBlob(res, 'image/jpeg', 0.8));
  return blob ? URL.createObjectURL(blob) : '';
}

/**
 * Converts a canvas to an efficient lossless PNG Blob for undo/redo and accepted edits.
 */
export async function canvasToCompressedBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Không thể nén canvas thành Blob'));
      },
      'image/png'
    );
  });
}

/**
 * Restores a canvas from a stored Blob.
 */
export async function blobToCanvas(blob: Blob, width: number, height: number): Promise<HTMLCanvasElement> {
  const imgBitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.drawImage(imgBitmap, 0, 0, width, height);
  }
  imgBitmap.close();
  return canvas;
}
