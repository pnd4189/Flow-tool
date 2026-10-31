import { ColorAdjustmentParams } from '../types';

export const DEFAULT_COLOR_PARAMS: ColorAdjustmentParams = {
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

export function hasActiveAdjustments(params: ColorAdjustmentParams): boolean {
  return (
    params.brightness !== 0 ||
    params.exposure !== 0 ||
    params.contrast !== 0 ||
    params.saturation !== 0 ||
    params.temperature !== 0 ||
    params.tint !== 0 ||
    params.highlights !== 0 ||
    params.shadows !== 0 ||
    params.sharpen !== 0 ||
    params.denoise !== 0
  );
}

/**
 * Helper to yield execution to browser event loop during heavy operations
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Fast LUT builder for tonal and color adjustments
 */
function buildToneLookupTable(params: ColorAdjustmentParams) {
  // Pre-calculate scalars
  // Exposure: -100..100 -> factor 2^(exposure / 50)
  const exposureFactor = Math.pow(2, params.exposure / 50);
  // Brightness: -100..100 -> shift -100..100
  const brightnessOffset = params.brightness * 1.28;
  // Contrast: -100..100 -> factor
  const contrastFactor =
    params.contrast >= 0
      ? (100 + params.contrast * 1.5) / 100
      : (100 + params.contrast) / 100;

  // Temperature (Warm amber vs cool blue)
  const temp = params.temperature / 100;
  const rTemp = temp > 0 ? 1 + temp * 0.28 : 1;
  const bTemp = temp < 0 ? 1 - temp * 0.28 : 1;

  // Tint (Magenta vs Green)
  const tint = params.tint / 100;
  const gTint = tint < 0 ? 1 - tint * 0.2 : 1;
  const mTint = tint > 0 ? 1 + tint * 0.2 : 1;

  return {
    exposureFactor,
    brightnessOffset,
    contrastFactor,
    rTemp,
    bTemp,
    gTint,
    mTint,
  };
}

/**
 * Real pixel-level adjustment engine:
 * 1. Bounded preview support (fast downscale for responsive dragging).
 * 2. Native resolution processing with chunked row execution (yielding to avoid frozen frames).
 * 3. Applies strictly to (selection > 0 && protection == 0) if selection exists, otherwise full image (protection still strictly subtracted).
 * 4. Zero face beautification, zero geometry changes, zero waxy blurring.
 */
export async function processColorAndQuality(
  sourceCanvas: HTMLCanvasElement,
  effectiveMask: HTMLCanvasElement | null,
  protectionMask: HTMLCanvasElement | null,
  params: ColorAdjustmentParams,
  options?: {
    maxDim?: number; // for bounded real-time drag preview
    onProgress?: (progressPct: number) => void;
  }
): Promise<HTMLCanvasElement> {
  const origW = sourceCanvas.width;
  const origH = sourceCanvas.height;

  // Check if downscaling for interactive preview
  const maxDim = options?.maxDim;
  const isBounded = Boolean(maxDim && (origW > maxDim || origH > maxDim));
  const scale = isBounded ? maxDim! / Math.max(origW, origH) : 1;
  const w = isBounded ? Math.max(1, Math.round(origW * scale)) : origW;
  const h = isBounded ? Math.max(1, Math.round(origH * scale)) : origH;

  // Render downscaled source if needed
  let inputCanvas = sourceCanvas;
  if (isBounded) {
    inputCanvas = document.createElement('canvas');
    inputCanvas.width = w;
    inputCanvas.height = h;
    const iCtx = inputCanvas.getContext('2d');
    if (iCtx) {
      iCtx.drawImage(sourceCanvas, 0, 0, w, h);
    }
  }

  const inCtx = inputCanvas.getContext('2d', { willReadFrequently: true });
  if (!inCtx) throw new Error('Không thể đọc dữ liệu ảnh nguồn.');
  const inImgData = inCtx.getImageData(0, 0, w, h);
  const src = inImgData.data;

  // Read masks at target resolution
  let maskData: Uint8ClampedArray | null = null;
  if (effectiveMask) {
    let mCanvas = effectiveMask;
    if (isBounded) {
      mCanvas = document.createElement('canvas');
      mCanvas.width = w;
      mCanvas.height = h;
      const mCtx = mCanvas.getContext('2d');
      if (mCtx) mCtx.drawImage(effectiveMask, 0, 0, w, h);
    }
    const mCtx = mCanvas.getContext('2d', { willReadFrequently: true });
    if (mCtx) maskData = mCtx.getImageData(0, 0, w, h).data;
  }

  let protData: Uint8ClampedArray | null = null;
  if (protectionMask) {
    let pCanvas = protectionMask;
    if (isBounded) {
      pCanvas = document.createElement('canvas');
      pCanvas.width = w;
      pCanvas.height = h;
      const pCtx = pCanvas.getContext('2d');
      if (pCtx) pCtx.drawImage(protectionMask, 0, 0, w, h);
    }
    const pCtx = pCanvas.getContext('2d', { willReadFrequently: true });
    if (pCtx) protData = pCtx.getImageData(0, 0, w, h).data;
  }

  // Target output
  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) throw new Error('Không thể khởi tạo output canvas.');
  const outImgData = outCtx.createImageData(w, h);
  const out = outImgData.data;

  const {
    exposureFactor,
    brightnessOffset,
    contrastFactor,
    rTemp,
    bTemp,
    gTint,
    mTint,
  } = buildToneLookupTable(params);

  const satFactor = (100 + params.saturation) / 100;
  const hiFactor = params.highlights / 100;
  const shFactor = params.shadows / 100;

  const total = w * h;
  const chunkSize = isBounded ? total : 25000; // chunk for large images

  for (let i = 0; i < total; i++) {
    const idx = i * 4;

    // Check protection first: strict invariant, protection copies exact source
    const pVal = protData ? protData[idx] : 0;
    if (pVal > 0) {
      out[idx] = src[idx];
      out[idx + 1] = src[idx + 1];
      out[idx + 2] = src[idx + 2];
      out[idx + 3] = src[idx + 3];
      continue;
    }

    // Check selection weight: if effectiveMask provided, use its weight; else full image
    let weight = 1.0;
    if (maskData) {
      weight = maskData[idx] / 255;
    }

    if (weight <= 0) {
      out[idx] = src[idx];
      out[idx + 1] = src[idx + 1];
      out[idx + 2] = src[idx + 2];
      out[idx + 3] = src[idx + 3];
      continue;
    }

    let r = src[idx];
    let g = src[idx + 1];
    let b = src[idx + 2];
    const a = src[idx + 3];

    // 1. Exposure
    if (params.exposure !== 0) {
      r = r * exposureFactor;
      g = g * exposureFactor;
      b = b * exposureFactor;
    }

    // 2. Brightness
    if (params.brightness !== 0) {
      r += brightnessOffset;
      g += brightnessOffset;
      b += brightnessOffset;
    }

    // 3. Contrast (around midpoint 128)
    if (params.contrast !== 0) {
      r = (r - 128) * contrastFactor + 128;
      g = (g - 128) * contrastFactor + 128;
      b = (b - 128) * contrastFactor + 128;
    }

    // 4. Highlights & Shadows (calculated via luminance)
    if (params.highlights !== 0 || params.shadows !== 0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (params.shadows !== 0) {
        // shadows weight is higher at low luminance
        const shadowWeight = Math.max(0, 1 - lum / 128);
        const sDelta = shFactor * shadowWeight * 40;
        r += sDelta;
        g += sDelta;
        b += sDelta;
      }
      if (params.highlights !== 0) {
        // highlights weight is higher at high luminance
        const highlightWeight = Math.max(0, (lum - 128) / 127);
        const hDelta = hiFactor * highlightWeight * 40;
        r += hDelta;
        g += hDelta;
        b += hDelta;
      }
    }

    // 5. Temperature & Tint
    if (params.temperature !== 0) {
      r *= rTemp;
      b *= bTemp;
    }
    if (params.tint !== 0) {
      g *= gTint;
      r *= mTint;
      b *= mTint;
    }

    // 6. Saturation (in Rec.601 RGB space)
    if (params.saturation !== 0) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * satFactor;
      g = gray + (g - gray) * satFactor;
      b = gray + (b - gray) * satFactor;
    }

    // Clamp values 0..255
    const finalR = Math.max(0, Math.min(255, Math.round(r)));
    const finalG = Math.max(0, Math.min(255, Math.round(g)));
    const finalB = Math.max(0, Math.min(255, Math.round(b)));

    // Linear blend with original based on selection weight
    if (weight < 1.0) {
      out[idx] = Math.round(src[idx] * (1 - weight) + finalR * weight);
      out[idx + 1] = Math.round(src[idx + 1] * (1 - weight) + finalG * weight);
      out[idx + 2] = Math.round(src[idx + 2] * (1 - weight) + finalB * weight);
      out[idx + 3] = a;
    } else {
      out[idx] = finalR;
      out[idx + 1] = finalG;
      out[idx + 2] = finalB;
      out[idx + 3] = a;
    }

    if (!isBounded && i % chunkSize === 0) {
      await yieldToMain();
    }
  }

  // 7. Conservative Unsharp Mask Sharpening
  // Applies standard 3x3 high-pass sharpening without halos or facial distortion
  if (params.sharpen > 0) {
    const sharpenStrength = (params.sharpen / 100) * 0.75; // conservative max 0.75
    const tempBuffer = new Uint8ClampedArray(out);

    for (let y = 1; y < h - 1; y++) {
      const rowOffset = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = (rowOffset + x) * 4;

        // Skip protected
        if (protData && protData[idx] > 0) continue;

        // Mask weight
        const weight = maskData ? maskData[idx] / 255 : 1.0;
        if (weight <= 0) continue;

        for (let c = 0; c < 3; c++) {
          const center = tempBuffer[idx + c];
          const north = tempBuffer[((y - 1) * w + x) * 4 + c];
          const south = tempBuffer[((y + 1) * w + x) * 4 + c];
          const west = tempBuffer[(rowOffset + x - 1) * 4 + c];
          const east = tempBuffer[(rowOffset + x + 1) * 4 + c];

          const laplacian = 4 * center - (north + south + west + east);
          // Apply conservative high-pass with thresholding to prevent amplifying sensor noise
          if (Math.abs(laplacian) > 3) {
            const delta = Math.round(laplacian * sharpenStrength * weight);
            out[idx + c] = Math.max(0, Math.min(255, center + delta));
          }
        }
      }
      if (!isBounded && y % 80 === 0) {
        await yieldToMain();
      }
    }
  }

  // 8. Conservative Edge-Preserving Denoise
  // Small 3x3 bilateral-style range filter: smooths only pixels with small color variance
  if (params.denoise > 0) {
    const denoiseStrength = (params.denoise / 100);
    const rangeThreshold = 18; // edge preservation threshold
    const tempBuffer = new Uint8ClampedArray(out);

    for (let y = 1; y < h - 1; y++) {
      const rowOffset = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = (rowOffset + x) * 4;

        if (protData && protData[idx] > 0) continue;
        const weight = maskData ? maskData[idx] / 255 : 1.0;
        if (weight <= 0) continue;

        const cR = tempBuffer[idx];
        const cG = tempBuffer[idx + 1];
        const cB = tempBuffer[idx + 2];

        let sumR = cR;
        let sumG = cG;
        let sumB = cB;
        let totalW = 1.0;

        // 4-neighborhood
        const neighbors = [
          ((y - 1) * w + x) * 4,
          ((y + 1) * w + x) * 4,
          (rowOffset + x - 1) * 4,
          (rowOffset + x + 1) * 4,
        ];

        for (let k = 0; k < 4; k++) {
          const nIdx = neighbors[k];
          const nR = tempBuffer[nIdx];
          const nG = tempBuffer[nIdx + 1];
          const nB = tempBuffer[nIdx + 2];

          const diff = Math.max(
            Math.abs(nR - cR),
            Math.abs(nG - cG),
            Math.abs(nB - cB)
          );

          if (diff < rangeThreshold) {
            const wN = (1 - diff / rangeThreshold) * denoiseStrength;
            sumR += nR * wN;
            sumG += nG * wN;
            sumB += nB * wN;
            totalW += wN;
          }
        }

        out[idx] = Math.round(cR * (1 - weight) + (sumR / totalW) * weight);
        out[idx + 1] = Math.round(cG * (1 - weight) + (sumG / totalW) * weight);
        out[idx + 2] = Math.round(cB * (1 - weight) + (sumB / totalW) * weight);
      }
      if (!isBounded && y % 80 === 0) {
        await yieldToMain();
      }
    }
  }

  outCtx.putImageData(outImgData, 0, 0);

  // If this was a full export or bounded preview, return outCanvas
  if (!isBounded) {
    return outCanvas;
  }

  // If bounded preview was generated, return as-is for screen rendering
  return outCanvas;
}
