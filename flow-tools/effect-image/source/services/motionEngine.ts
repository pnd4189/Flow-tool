import type { EffectConfig, CameraMoveType, ColorPaletteInfo } from '../types';
import { renderSingleOverlay, extractColorPalette } from './overlays';

export interface RenderAssets {
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  palette?: ColorPaletteInfo;
  // Tài nguyên 2 lớp Parallax (nếu sẵn sàng)
  parallaxLayers?: {
    bgImage?: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
    subjectImage?: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
    isReady: boolean;
  };
}

/**
 * Hàm Easing mượt mà
 */
export function easeInOutQuad(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/**
 * Tính toán ma trận biến đổi Camera (scale, translate, rotate)
 * LUÔN đảm bảo phủ kín khung hình (không lộ viền đen bất kể pan hay xoay)
 */
export function calculateCameraTransform(
  move: CameraMoveType,
  intensity: number,
  easing: 'easeInOut' | 'linear',
  progress: number, // 0.0 -> 1.0
  focus: { x: number; y: number } = { x: 0.5, y: 0.5 },
  seed: number = 42,
  t: number = 0,
  hasParallax: boolean = false
): { scale: number; transX: number; transY: number; rotateRad: number } {
  const normProgress = Math.max(0, Math.min(1, progress));
  const p = easing === 'easeInOut' ? easeInOutQuad(normProgress) : normProgress;
  const clampedIntensity = Math.max(0, Math.min(1, intensity));

  let scale = 1.0;
  let transX = 0; // Tỷ lệ dịch chuyển so với w (-0.5 -> 0.5)
  let transY = 0; // Tỷ lệ dịch chuyển so với h
  let rotateRad = 0;

  switch (move) {
    case 'none':
      scale = 1.0;
      transX = 0;
      transY = 0;
      break;

    case 'zoom_in':
      scale = 1.0 + 0.18 * clampedIntensity * p;
      break;

    case 'zoom_out':
      scale = 1.0 + 0.18 * clampedIntensity * (1 - p);
      break;

    case 'pan_left': {
      const maxShift = 0.08 * clampedIntensity;
      scale = 1.0 + maxShift * 2.0;
      transX = maxShift * (0.5 - p);
      break;
    }

    case 'pan_right': {
      const maxShift = 0.08 * clampedIntensity;
      scale = 1.0 + maxShift * 2.0;
      transX = maxShift * (p - 0.5);
      break;
    }

    case 'pan_up': {
      const maxShift = 0.08 * clampedIntensity;
      scale = 1.0 + maxShift * 2.0;
      transY = maxShift * (0.5 - p);
      break;
    }

    case 'pan_down': {
      const maxShift = 0.08 * clampedIntensity;
      scale = 1.0 + maxShift * 2.0;
      transY = maxShift * (p - 0.5);
      break;
    }

    case 'push_to_focus': {
      const maxZoom = 0.22 * clampedIntensity;
      scale = 1.0 + maxZoom * p;
      transX = (0.5 - focus.x) * (scale - 1);
      transY = (0.5 - focus.y) * (scale - 1);
      break;
    }

    case 'orbit_sway': {
      const angleDeg = Math.sin(t * 1.5 + seed) * (1.2 * clampedIntensity);
      rotateRad = (angleDeg * Math.PI) / 180;
      const rotationBuffer = Math.abs(rotateRad) * 1.2;
      scale = 1.0 + 0.05 * clampedIntensity + rotationBuffer + Math.sin(t * 1.0) * (0.02 * clampedIntensity);
      transX = Math.cos(t * 1.2 + seed) * (0.015 * clampedIntensity);
      break;
    }

    case 'handheld': {
      const jitterX =
        (Math.sin(t * 2.1 + seed) * 0.6 + Math.sin(t * 5.3 + seed * 2) * 0.4) * (0.025 * clampedIntensity);
      const jitterY =
        (Math.cos(t * 1.8 + seed * 3) * 0.6 + Math.cos(t * 4.7 + seed * 4) * 0.4) * (0.025 * clampedIntensity);
      const angleDeg = Math.sin(t * 2.4 + seed) * (0.45 * clampedIntensity);
      rotateRad = (angleDeg * Math.PI) / 180;

      scale = 1.0 + 0.06 * clampedIntensity;
      transX = jitterX;
      transY = jitterY;
      break;
    }

    case 'dolly_zoom':
      // Khi có parallax: vertigo được xử lý riêng rẽ ở 2 lớp; khi không có parallax thì zoom in nhẹ
      scale = hasParallax ? 1.0 : 1.0 + 0.18 * clampedIntensity * p;
      break;
  }

  scale = Math.max(1.0, scale);
  return { scale, transX, transY, rotateRad };
}

/**
 * Tính toán độ dịch chuyển riêng của 2 lớp Parallax (Nền & Chủ thể)
 * Theo đặc tả Đợt 2B:
 * - Nền dịch theo direction biên độ depth * 3%
 * - Chủ thể dịch ngược lại depth * 5%
 * - Direction 'in': nền scale 1.0 -> 1.06, chủ thể scale 1.0 -> 1.12
 * - subjectBreath: scale 1 -> 1.012 theo sin chu kỳ 3s (2π*t / 3)
 * - subjectFloat: dịch dọc ±0.6% chu kỳ 4s (2π*t / 4)
 * - dolly_zoom: nền scale 1.0 -> 1.15 trong khi chủ thể giữ nguyên kích thước
 */
export function calculateParallaxOffsets(
  config: EffectConfig['parallax'],
  progress: number,
  t: number,
  cameraMove: CameraMoveType
): {
  bgShiftX: number;
  bgShiftY: number;
  bgScale: number;
  subjectShiftX: number;
  subjectShiftY: number;
  subjectScale: number;
} {
  const depth = Math.max(0, Math.min(1, config.depth ?? 0.5));
  const dir = config.direction || 'in';

  let bgShiftX = 0;
  let bgShiftY = 0;
  let bgScale = 1.0;

  let subjectShiftX = 0;
  let subjectShiftY = 0;
  let subjectScale = 1.0;

  // 1. Chuyển động hướng (direction)
  const normP = progress; // 0 -> 1

  if (dir === 'in') {
    // Nền scale 1.0 -> 1.0 + 0.06 * depth
    bgScale = 1.0 + 0.06 * depth * normP;
    // Chủ thể scale 1.0 -> 1.0 + 0.12 * depth
    subjectScale = 1.0 + 0.12 * depth * normP;
  } else if (dir === 'left') {
    // Dịch sang trái: nền dịch cùng hướng depth * 3%, chủ thể ngược lại depth * 5%
    bgShiftX = -0.03 * depth * normP;
    subjectShiftX = 0.05 * depth * normP;
  } else if (dir === 'right') {
    bgShiftX = 0.03 * depth * normP;
    subjectShiftX = -0.05 * depth * normP;
  } else if (dir === 'up') {
    bgShiftY = -0.03 * depth * normP;
    subjectShiftY = 0.05 * depth * normP;
  } else if (dir === 'down') {
    bgShiftY = 0.03 * depth * normP;
    subjectShiftY = -0.05 * depth * normP;
  }

  // 2. Chế độ Vertigo của Dolly Zoom
  if (cameraMove === 'dolly_zoom') {
    // Nền phóng to 1.0 -> 1.15 trong khi chủ thể giữ nguyên kích thước
    bgScale *= 1.0 + 0.15 * normP;
  }

  // 3. Hiệu ứng thở (subjectBreath) chu kỳ 3s (sin 0->1->0)
  if (config.subjectBreath) {
    const breathCycle = (Math.sin((2 * Math.PI * t) / 3) + 1) / 2; // 0 -> 1
    const breathScale = 1.0 + 0.012 * breathCycle;
    subjectScale *= breathScale;
  }

  // 4. Hiệu ứng lơ lửng (subjectFloat) dịch dọc ±0.6% chu kỳ 4s
  if (config.subjectFloat) {
    const floatOffset = Math.sin((2 * Math.PI * t) / 4) * 0.006;
    subjectShiftY += floatOffset;
  }

  // Nền luôn cần scale đệm để không bao giờ lộ viền khi dịch
  const bgPaddingScale = 1.0 + Math.max(Math.abs(bgShiftX), Math.abs(bgShiftY)) * 2.2 + 0.04;
  bgScale *= bgPaddingScale;

  return {
    bgShiftX,
    bgShiftY,
    bgScale,
    subjectShiftX,
    subjectShiftY,
    subjectScale,
  };
}

/**
 * HÀM THUẦN DỰNG 1 KHUNG HÌNH (RENDER FRAME)
 * Không phụ thuộc React, dùng chung cho cả PreviewPlayer và Bước 4 Xuất MP4.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  assets: RenderAssets,
  config: EffectConfig,
  t: number,
  w: number,
  h: number
): void {
  const durationSec = Math.max(1, config.durationSec || 6);
  const clampedT = Math.max(0, Math.min(durationSec, t));
  const progress = clampedT / durationSec;

  // 1. Chuẩn bị bảng màu
  const palette = assets.palette || extractColorPalette(assets.image);

  const isParallaxActive = !!(
    config.parallax.enabled &&
    assets.parallaxLayers?.isReady &&
    assets.parallaxLayers.bgImage &&
    assets.parallaxLayers.subjectImage
  );

  // 2. Tính toán ma trận biến đổi Camera chung (áp lên cả 2 lớp)
  const cameraTransform = calculateCameraTransform(
    config.camera.move,
    config.camera.intensity,
    config.camera.easing,
    progress,
    config.camera.focus || { x: 0.5, y: 0.5 },
    config.seed || 42,
    clampedT,
    isParallaxActive
  );

  // 3. Xoá canvas nền đen
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 4. ÁP DỤNG BIẾN ĐỔI CHUNG CỦA MÁY QUAY
  ctx.save();
  ctx.translate(w / 2 + cameraTransform.transX * w, h / 2 + cameraTransform.transY * h);
  if (cameraTransform.rotateRad !== 0) {
    ctx.rotate(cameraTransform.rotateRad);
  }
  ctx.scale(cameraTransform.scale, cameraTransform.scale);
  ctx.translate(-w / 2, -h / 2);

  if (isParallaxActive && assets.parallaxLayers?.bgImage && assets.parallaxLayers?.subjectImage) {
    // ==========================================
    // CHẾ ĐỘ 2 LỚP PARALLAX (ĐỢT 2B)
    // ==========================================
    const pOffset = calculateParallaxOffsets(config.parallax, progress, clampedT, config.camera.move);

    // --- LỚP 1: NỀN (BACKGROUND) ---
    ctx.save();
    ctx.translate(w / 2 + pOffset.bgShiftX * w, h / 2 + pOffset.bgShiftY * h);
    ctx.scale(pOffset.bgScale, pOffset.bgScale);
    ctx.translate(-w / 2, -h / 2);
    drawImageCover(ctx, assets.parallaxLayers.bgImage, w, h);
    ctx.restore();

    // --- LỚP 2: CHỦ THỂ (SUBJECT) KÈM BÓNG ĐỔ MỀM RẤT NHẸ ---
    ctx.save();
    ctx.translate(w / 2 + pOffset.subjectShiftX * w, h / 2 + pOffset.subjectShiftY * h);
    ctx.scale(pOffset.subjectScale, pOffset.subjectScale);
    ctx.translate(-w / 2, -h / 2);

    // Bóng đổ mềm rất nhẹ để tách bạch lớp
    ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;

    drawImageCover(ctx, assets.parallaxLayers.subjectImage, w, h);
    ctx.restore();
  } else {
    // ==========================================
    // CHẾ ĐỘ 1 LỚP ẢNH GỐC CŨ
    // ==========================================
    drawImageCover(ctx, assets.image, w, h);
  }

  ctx.restore(); // Kết thúc ma trận camera chung

  // 5. Vẽ lần lượt các hiệu ứng phủ (tối đa 3 loại)
  if (config.overlays && config.overlays.length > 0) {
    const activeOverlays = config.overlays.slice(0, 3);
    for (const ov of activeOverlays) {
      renderSingleOverlay(ctx, ov, clampedT, durationSec, config.seed, w, h, palette);
    }
  }

  // 6. Fade In / Out từ đen (0.3s đầu và 0.3s cuối)
  if (config.fadeInOut) {
    const fadeDuration = 0.3;
    let fadeAlpha = 0;

    if (clampedT < fadeDuration) {
      fadeAlpha = 1 - clampedT / fadeDuration;
    } else if (clampedT > durationSec - fadeDuration) {
      fadeAlpha = (clampedT - (durationSec - fadeDuration)) / fadeDuration;
    }

    if (fadeAlpha > 0) {
      ctx.fillStyle = '#000000';
      ctx.globalAlpha = Math.max(0, Math.min(1, fadeAlpha));
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1.0;
    }
  }

  ctx.restore();
}

/**
 * Vẽ ảnh vừa khít tỷ lệ cover vào khung w, h
 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  w: number,
  h: number
) {
  const imgW = (image as any).naturalWidth || image.width || w;
  const imgH = (image as any).naturalHeight || image.height || h;
  const imgRatio = imgW / imgH;
  const canvasRatio = w / h;

  let sW = imgW;
  let sH = imgH;
  let sx = 0;
  let sy = 0;

  if (imgRatio > canvasRatio) {
    sW = imgH * canvasRatio;
    sx = (imgW - sW) / 2;
  } else {
    sH = imgW / canvasRatio;
    sy = (imgH - sH) / 2;
  }

  ctx.drawImage(image as any, sx, sy, sW, sH, 0, 0, w, h);
}

/**
 * Cấu hình hiệu ứng mặc định
 */
export function createDefaultEffectConfig(seed = 12345): EffectConfig {
  return {
    camera: {
      move: 'zoom_in',
      intensity: 0.4,
      easing: 'easeInOut',
      focus: { x: 0.5, y: 0.5 },
    },
    parallax: {
      enabled: false,
      direction: 'in',
      depth: 0.5,
      subjectBreath: true,
      subjectFloat: false,
    },
    overlays: [
      {
        id: 'dust_motes',
        intensity: 0.3,
      },
    ],
    durationSec: 6,
    fadeInOut: true,
    seed: seed || Math.floor(Math.random() * 100000),
    source: 'default',
  };
}
