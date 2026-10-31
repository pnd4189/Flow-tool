import { CandidatePreview } from '../types';
import { createCutoutCanvas } from './compositingService';

export interface SolidColorOptions {
  color: string; // hex or rgb
}

export interface GradientOptions {
  color1: string;
  color2: string;
  direction: 'to-bottom' | 'to-right' | 'diagonal';
}

export interface ImageReplaceOptions {
  bgImage: HTMLCanvasElement;
  fitMode: 'cover' | 'contain';
}

export interface BlurOptions {
  radius: number; // 2..40
}

/**
 * Creates candidate preview for removing background (pure transparent outside foreground).
 */
export function previewRemoveBackground(
  sourceCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement
): Omit<CandidatePreview, 'sourceRevision'> {
  const cutout = createCutoutCanvas(sourceCanvas, selectionMask, protectionMask);

  return {
    type: 'bg_remove',
    canvas: cutout,
    title: 'Xóa nền (Alpha)',
    description: 'Nền trở thành trong suốt, giữ nguyên chủ thể và các vùng bảo vệ.',
  };
}

/**
 * Creates candidate preview for solid background color.
 */
export function previewSolidColorBackground(
  sourceCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  options: SolidColorOptions
): Omit<CandidatePreview, 'sourceRevision'> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể khởi tạo canvas');

  // Fill background solid color
  ctx.fillStyle = options.color;
  ctx.fillRect(0, 0, w, h);

  // Composite foreground on top preserving soft edges and protection
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const srcData = srcCtx?.getImageData(0, 0, w, h).data;
  const selData = selectionMask.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h).data;
  const protData = protectionMask.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h).data;

  const bgData = ctx.getImageData(0, 0, w, h);
  const out = bgData.data;

  if (srcData && selData) {
    const total = w * h;
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const sVal = selData[idx];
      const pVal = protData ? protData[idx] : 0;
      const fgFactor = Math.max(sVal, pVal) / 255;
      const srcAlpha = (srcData[idx + 3] / 255) * fgFactor;

      if (srcAlpha > 0) {
        out[idx] = Math.round(srcData[idx] * srcAlpha + out[idx] * (1 - srcAlpha));
        out[idx + 1] = Math.round(srcData[idx + 1] * srcAlpha + out[idx + 1] * (1 - srcAlpha));
        out[idx + 2] = Math.round(srcData[idx + 2] * srcAlpha + out[idx + 2] * (1 - srcAlpha));
        out[idx + 3] = 255;
      }
    }
    ctx.putImageData(bgData, 0, 0);
  }

  return {
    type: 'bg_color',
    canvas,
    title: 'Đổi màu nền đơn sắc',
    description: `Màu nền: ${options.color}`,
    params: { color: options.color },
  };
}

/**
 * Creates candidate preview for 2-color linear gradient background.
 */
export function previewGradientBackground(
  sourceCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  options: GradientOptions
): Omit<CandidatePreview, 'sourceRevision'> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể khởi tạo canvas');

  let grad: CanvasGradient;
  if (options.direction === 'to-right') {
    grad = ctx.createLinearGradient(0, 0, w, 0);
  } else if (options.direction === 'diagonal') {
    grad = ctx.createLinearGradient(0, 0, w, h);
  } else {
    grad = ctx.createLinearGradient(0, 0, 0, h);
  }
  grad.addColorStop(0, options.color1);
  grad.addColorStop(1, options.color2);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const srcData = srcCtx?.getImageData(0, 0, w, h).data;
  const selData = selectionMask.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h).data;
  const protData = protectionMask.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h).data;

  const bgData = ctx.getImageData(0, 0, w, h);
  const out = bgData.data;

  if (srcData && selData) {
    const total = w * h;
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const sVal = selData[idx];
      const pVal = protData ? protData[idx] : 0;
      const fgFactor = Math.max(sVal, pVal) / 255;
      const srcAlpha = (srcData[idx + 3] / 255) * fgFactor;

      if (srcAlpha > 0) {
        out[idx] = Math.round(srcData[idx] * srcAlpha + out[idx] * (1 - srcAlpha));
        out[idx + 1] = Math.round(srcData[idx + 1] * srcAlpha + out[idx + 1] * (1 - srcAlpha));
        out[idx + 2] = Math.round(srcData[idx + 2] * srcAlpha + out[idx + 2] * (1 - srcAlpha));
        out[idx + 3] = 255;
      }
    }
    ctx.putImageData(bgData, 0, 0);
  }

  return {
    type: 'bg_gradient',
    canvas,
    title: 'Đổi nền chuyển sắc Gradient',
    description: `${options.color1} → ${options.color2} (${options.direction})`,
    params: { ...options },
  };
}

/**
 * Creates candidate preview for replacing background with an uploaded image.
 */
export function previewImageReplaceBackground(
  sourceCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  options: ImageReplaceOptions
): Omit<CandidatePreview, 'sourceRevision'> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể khởi tạo canvas');

  // Draw replacement background using explicit cover or contain
  const bg = options.bgImage;
  const bgRatio = bg.width / bg.height;
  const canvasRatio = w / h;

  let drawW = w;
  let drawH = h;
  let dx = 0;
  let dy = 0;

  if (options.fitMode === 'cover') {
    if (bgRatio > canvasRatio) {
      drawH = h;
      drawW = h * bgRatio;
      dx = (w - drawW) / 2;
    } else {
      drawW = w;
      drawH = w / bgRatio;
      dy = (h - drawH) / 2;
    }
  } else {
    // contain
    ctx.fillStyle = '#141618';
    ctx.fillRect(0, 0, w, h);
    if (bgRatio > canvasRatio) {
      drawW = w;
      drawH = w / bgRatio;
      dy = (h - drawH) / 2;
    } else {
      drawH = h;
      drawW = h * bgRatio;
      dx = (w - drawW) / 2;
    }
  }

  ctx.drawImage(bg, dx, dy, drawW, drawH);

  // Composite foreground on top
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const srcData = srcCtx?.getImageData(0, 0, w, h).data;
  const selData = selectionMask.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h).data;
  const protData = protectionMask.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h).data;

  const bgData = ctx.getImageData(0, 0, w, h);
  const out = bgData.data;

  if (srcData && selData) {
    const total = w * h;
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const sVal = selData[idx];
      const pVal = protData ? protData[idx] : 0;
      const fgFactor = Math.max(sVal, pVal) / 255;
      const srcAlpha = (srcData[idx + 3] / 255) * fgFactor;

      if (srcAlpha > 0) {
        out[idx] = Math.round(srcData[idx] * srcAlpha + out[idx] * (1 - srcAlpha));
        out[idx + 1] = Math.round(srcData[idx + 1] * srcAlpha + out[idx + 1] * (1 - srcAlpha));
        out[idx + 2] = Math.round(srcData[idx + 2] * srcAlpha + out[idx + 2] * (1 - srcAlpha));
        out[idx + 3] = 255;
      }
    }
    ctx.putImageData(bgData, 0, 0);
  }

  return {
    type: 'bg_image',
    canvas,
    title: 'Thay ảnh nền',
    description: `Khớp ảnh: ${options.fitMode === 'cover' ? 'Tràn khung (Cover)' : 'Vừa khung (Contain)'}`,
    params: { fitMode: options.fitMode },
  };
}

/**
 * Creates candidate preview for smooth background blur (Bokeh/Blur) without foreground bleed.
 * Strategy:
 * 1. Build background-only buffer where foreground pixels (selection or protection) are masked out.
 * 2. Inpaint/dilate background colors into the foreground gap so foreground colors never bleed outward.
 * 3. Blur the infilled background.
 * 4. Composite the unblurred foreground/face cleanly on top.
 * Protected face pixels are never blurred.
 */
export function previewBlurBackground(
  sourceCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  options: BlurOptions
): Omit<CandidatePreview, 'sourceRevision'> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const rad = Math.max(2, Math.min(40, options.radius));

  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const selCtx = selectionMask.getContext('2d', { willReadFrequently: true });
  const protCtx = protectionMask.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error('Không thể đọc source canvas');

  const srcData = srcCtx.getImageData(0, 0, w, h).data;
  const selData = selCtx ? selCtx.getImageData(0, 0, w, h).data : null;
  const protData = protCtx ? protCtx.getImageData(0, 0, w, h).data : null;

  // Step 1: Create background-only canvas. Where foreground exists, alpha is 0.
  const bgOnlyCanvas = document.createElement('canvas');
  bgOnlyCanvas.width = w;
  bgOnlyCanvas.height = h;
  const bgCtx = bgOnlyCanvas.getContext('2d', { willReadFrequently: true });
  if (!bgCtx) throw new Error('Không thể khởi tạo bg canvas');

  const bgImgData = bgCtx.createImageData(w, h);
  const bgD = bgImgData.data;
  const total = w * h;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const sVal = selData ? selData[idx] : 0;
    const pVal = protData ? protData[idx] : 0;
    const fgCoverage = Math.max(sVal, pVal);

    if (fgCoverage < 200) {
      // Background pixel
      bgD[idx] = srcData[idx];
      bgD[idx + 1] = srcData[idx + 1];
      bgD[idx + 2] = srcData[idx + 2];
      bgD[idx + 3] = 255;
    } else {
      // Foreground pixel: exclude to avoid foreground color smearing into blurred background
      bgD[idx] = 0;
      bgD[idx + 1] = 0;
      bgD[idx + 2] = 0;
      bgD[idx + 3] = 0;
    }
  }
  bgCtx.putImageData(bgImgData, 0, 0);

  // Step 2: Infill transparent holes with nearest background pixels via simple downscale / upscale
  // or multi-pass blur so blur doesn't produce dark rims
  const infilledCanvas = document.createElement('canvas');
  infilledCanvas.width = w;
  infilledCanvas.height = h;
  const infCtx = infilledCanvas.getContext('2d', { willReadFrequently: true });
  if (!infCtx) throw new Error('Không thể khởi tạo infilled canvas');

  // Fill default with blurred source to avoid void, then draw bg-only
  infCtx.filter = `blur(${rad * 2}px)`;
  infCtx.drawImage(bgOnlyCanvas, 0, 0);
  infCtx.filter = 'none';
  infCtx.drawImage(bgOnlyCanvas, 0, 0);

  // Step 3: Now apply desired blur to the sanitized background
  const blurredBgCanvas = document.createElement('canvas');
  blurredBgCanvas.width = w;
  blurredBgCanvas.height = h;
  const bCtx = blurredBgCanvas.getContext('2d', { willReadFrequently: true });
  if (!bCtx) throw new Error('Không thể khởi tạo blur canvas');

  bCtx.filter = `blur(${rad}px)`;
  bCtx.drawImage(infilledCanvas, 0, 0);
  bCtx.filter = 'none';

  // Step 4: Composite unblurred original foreground and face cleanly on top
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể khởi tạo canvas kết quả');

  ctx.drawImage(blurredBgCanvas, 0, 0);

  const outImgData = ctx.getImageData(0, 0, w, h);
  const outD = outImgData.data;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const sVal = selData ? selData[idx] : 0;
    const pVal = protData ? protData[idx] : 0;

    // Effective foreground factor: protection is 100% authoritative and never blurred
    const fgFactor = Math.max(sVal, pVal) / 255;
    const srcAlpha = (srcData[idx + 3] / 255) * fgFactor;

    if (srcAlpha > 0) {
      outD[idx] = Math.round(srcData[idx] * srcAlpha + outD[idx] * (1 - srcAlpha));
      outD[idx + 1] = Math.round(srcData[idx + 1] * srcAlpha + outD[idx + 1] * (1 - srcAlpha));
      outD[idx + 2] = Math.round(srcData[idx + 2] * srcAlpha + outD[idx + 2] * (1 - srcAlpha));
      outD[idx + 3] = 255;
    }
  }

  ctx.putImageData(outImgData, 0, 0);

  return {
    type: 'bg_blur',
    canvas,
    title: 'Làm mờ hậu cảnh (Bokeh/Blur)',
    description: `Bán kính mờ: ${rad}px (Không lem màu chủ thể)`,
    params: { radius: rad },
  };
}
