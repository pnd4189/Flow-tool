import type { OverlayId, OverlayConfig, ColorPaletteInfo } from '../types';

export interface OverlayDefinition {
  id: OverlayId;
  nameVi: string;
  icon: string;
  description: string;
  defaultIntensity: number;
}

export const OVERLAY_DEFINITIONS: OverlayDefinition[] = [
  { id: 'dust_motes', nameVi: 'Bụi lơ lửng', icon: 'grain', description: 'Hạt bụi phát sáng li ti trôi bồng bềnh', defaultIntensity: 0.35 },
  { id: 'bokeh', nameVi: 'Đốm sáng Bokeh', icon: 'blur_on', description: 'Đốm tròn mờ ảo trôi êm đềm', defaultIntensity: 0.4 },
  { id: 'sparkles', nameVi: 'Lấp lánh sao', icon: 'auto_awesome', description: 'Sao 4 cánh nhấp nháy phát sáng', defaultIntensity: 0.45 },
  { id: 'snow', nameVi: 'Tuyết rơi', icon: 'ac_unit', description: 'Tuyết nhiều tầng rơi theo chiều gió', defaultIntensity: 0.5 },
  { id: 'rain', nameVi: 'Mưa rơi', icon: 'water_drop', description: 'Vệt mưa chéo và gợn sáng động', defaultIntensity: 0.45 },
  { id: 'petals', nameVi: 'Cánh hoa rơi', icon: 'spa', description: 'Cánh hoa mềm mại chao liệng xoay tròn', defaultIntensity: 0.4 },
  { id: 'embers', nameVi: 'Tàn lửa bốc lên', icon: 'local_fire_department', description: 'Tàn than hồng rực bay lên', defaultIntensity: 0.5 },
  { id: 'fog', nameVi: 'Sương khói trôi', icon: 'cloud', description: 'Lớp màng sương mờ dập dềnh ngang', defaultIntensity: 0.4 },
  { id: 'light_rays', nameVi: 'Tia sáng chéo', icon: 'wb_sunny', description: 'Luồng ánh sáng mặt trời rọi qua khe', defaultIntensity: 0.4 },
  { id: 'light_leak', nameVi: 'Vệt rò sáng', icon: 'gradient', description: 'Vệt rò rỉ ánh sáng ấm áp góc khung', defaultIntensity: 0.45 },
  { id: 'lens_flare', nameVi: 'Vệt lóa ống kính', icon: 'flare', description: 'Vệt flare điện ảnh quét nhẹ', defaultIntensity: 0.4 },
  { id: 'film_grain', nameVi: 'Hạt phim', icon: 'texture', description: 'Độ nhám hạt phim điện ảnh 35mm', defaultIntensity: 0.25 },
  { id: 'vignette', nameVi: 'Viền tối Vignette', icon: 'vignette', description: 'Làm tối 4 góc tăng chiều sâu', defaultIntensity: 0.5 },
  { id: 'flicker', nameVi: 'Chập chờn nhẹ', icon: 'brightness_6', description: 'Ánh sáng rung rinh tự nhiên như ánh nến', defaultIntensity: 0.3 },
  { id: 'fireflies', nameVi: 'Đom đóm bay', icon: 'emoji_objects', description: 'Đom đóm lập lòe uốn lượn huyền ảo', defaultIntensity: 0.4 },
];

/**
 * Trình sinh số ngẫu nhiên giả lập nhanh Mulberry32
 * Cùng seed + cùng index -> luôn trả về cùng 1 số float [0, 1)
 */
export function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Trích xuất bảng màu từ ảnh (tính 1 lần duy nhất khi nạp ảnh)
 */
export function extractColorPalette(
  img: HTMLImageElement | HTMLCanvasElement | ImageBitmap
): ColorPaletteInfo {
  const canvas = document.createElement('canvas');
  const w = 64;
  const h = 64;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { avgLuminance: 128, highlightColor: '#ffd79e', warmOrCool: 'warm' };
  }

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h).data;

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let totalLum = 0;
  const count = w * h;

  let highR = 255;
  let highG = 220;
  let highB = 160;
  let maxWeight = 0;

  for (let i = 0; i < imgData.length; i += 4) {
    const r = imgData[i];
    const g = imgData[i + 1];
    const b = imgData[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    totalR += r;
    totalG += g;
    totalB += b;
    totalLum += lum;

    // Tìm vùng sáng có màu sắc nổi bật
    if (lum > 140 && lum > maxWeight) {
      maxWeight = lum;
      highR = r;
      highG = g;
      highB = b;
    }
  }

  const avgR = totalR / count;
  const avgB = totalB / count;
  const warmOrCool = avgR >= avgB ? 'warm' : 'cool';
  const toHex = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');
  const highlightColor = `#${toHex(highR)}${toHex(highG)}${toHex(highB)}`;

  return {
    avgLuminance: Math.round(totalLum / count),
    highlightColor,
    warmOrCool,
  };
}

/**
 * Vẽ 1 hiệu ứng phủ cụ thể lên Canvas Context tại thời điểm t
 * @param ctx Context 2D
 * @param cfg Cấu hình hiệu ứng {id, intensity, color}
 * @param t Thời gian hiện tại tính bằng giây (0 -> durationSec)
 * @param durationSec Tổng thời lượng
 * @param seed Seed ngẫu nhiên
 * @param w Chiều rộng canvas
 * @param h Chiều cao canvas
 * @param palette Bảng màu trích xuất từ ảnh
 */
export function renderSingleOverlay(
  ctx: CanvasRenderingContext2D,
  cfg: OverlayConfig,
  t: number,
  durationSec: number,
  seed: number,
  w: number,
  h: number,
  palette: ColorPaletteInfo
): void {
  const intensity = Math.max(0.01, Math.min(1, cfg.intensity));
  const baseColor = cfg.color || palette.highlightColor;
  const pTime = t / Math.max(0.1, durationSec); // 0.0 -> 1.0

  ctx.save();

  switch (cfg.id) {
    case 'dust_motes': {
      // Hạt bụi lơ lửng phát sáng nhẹ
      const particleCount = Math.round(35 + intensity * 65);
      const prng = mulberry32(seed + 101);

      for (let i = 0; i < particleCount; i++) {
        const initX = prng();
        const initY = prng();
        const size = 1.0 + prng() * 2.8 * (0.6 + intensity * 0.4);
        const speedX = (prng() - 0.5) * 0.04;
        const speedY = -0.02 - prng() * 0.05;
        const phase = prng() * Math.PI * 2;

        const curX = ((initX + speedX * t + Math.sin(t * 0.8 + phase) * 0.015) % 1 + 1) % 1;
        const curY = ((initY + speedY * t) % 1 + 1) % 1;

        const pulse = 0.3 + 0.7 * Math.sin(t * 2.5 + phase);
        const alpha = Math.max(0, pulse * (0.2 + intensity * 0.5));

        ctx.fillStyle = baseColor;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(curX * w, curY * h, size, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'bokeh': {
      // Đốm sáng Bokeh mờ ảo trôi chậm
      const bokehCount = Math.round(10 + intensity * 20);
      const prng = mulberry32(seed + 202);

      for (let i = 0; i < bokehCount; i++) {
        const initX = prng();
        const initY = prng();
        const radius = (15 + prng() * 45) * (0.7 + intensity * 0.5);
        const speedY = -0.01 - prng() * 0.03;
        const sway = (prng() - 0.5) * 0.03;
        const phase = prng() * Math.PI * 2;

        const curX = ((initX + Math.sin(t * 0.5 + phase) * sway) % 1 + 1) % 1;
        const curY = ((initY + speedY * t) % 1 + 1) % 1;

        const alpha = (0.08 + 0.15 * Math.sin(t * 1.2 + phase)) * intensity;

        const grad = ctx.createRadialGradient(
          curX * w,
          curY * h,
          radius * 0.1,
          curX * w,
          curY * h,
          radius
        );
        grad.addColorStop(0, baseColor);
        grad.addColorStop(0.7, baseColor);
        grad.addColorStop(1, 'transparent');

        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(curX * w, curY * h, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'sparkles': {
      // Sao 4 cánh lấp lánh nhấp nháy
      const starCount = Math.round(15 + intensity * 35);
      const prng = mulberry32(seed + 303);

      for (let i = 0; i < starCount; i++) {
        const px = prng() * w;
        const py = prng() * h;
        const baseSize = (5 + prng() * 12) * (0.6 + intensity * 0.6);
        const freq = 1.5 + prng() * 3.5;
        const phase = prng() * Math.PI * 2;

        const twinkle = Math.pow(Math.max(0, Math.sin(t * freq + phase)), 3);
        if (twinkle < 0.05) continue;

        const size = baseSize * (0.4 + twinkle * 0.6);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate((t * 0.2 + phase) % (Math.PI * 2));
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = Math.min(1, twinkle * (0.4 + intensity * 0.6));

        // Vẽ chữ thập 4 cánh nhọn
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.quadraticCurveTo(0, 0, size * 0.25, 0);
        ctx.quadraticCurveTo(0, 0, 0, size);
        ctx.quadraticCurveTo(0, 0, -size * 0.25, 0);
        ctx.quadraticCurveTo(0, 0, 0, -size);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(-size, 0);
        ctx.quadraticCurveTo(0, 0, 0, size * 0.25);
        ctx.quadraticCurveTo(0, 0, size, 0);
        ctx.quadraticCurveTo(0, 0, 0, -size * 0.25);
        ctx.quadraticCurveTo(0, 0, -size, 0);
        ctx.fill();
        ctx.restore();
      }
      break;
    }

    case 'snow': {
      // Tuyết rơi nhiều lớp
      const flakeCount = Math.round(50 + intensity * 120);
      const prng = mulberry32(seed + 404);

      for (let i = 0; i < flakeCount; i++) {
        const initX = prng();
        const initY = prng();
        const depth = prng(); // 0 (xa/nhỏ) -> 1 (gần/lớn)
        const size = 1.2 + depth * 3.2;
        const fallSpeed = 0.08 + depth * 0.16;
        const wind = 0.03 + depth * 0.04;
        const swayAmp = 0.015 + depth * 0.02;

        const curY = ((initY + fallSpeed * t) % 1 + 1) % 1;
        const curX = ((initX + wind * t + Math.sin(t * 1.5 + initY * 10) * swayAmp) % 1 + 1) % 1;

        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = (0.3 + depth * 0.6) * (0.4 + intensity * 0.6);
        ctx.beginPath();
        ctx.arc(curX * w, curY * h, size, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'rain': {
      // Vệt mưa nghiêng
      const dropCount = Math.round(70 + intensity * 150);
      const prng = mulberry32(seed + 505);

      ctx.strokeStyle = '#cce3f5';
      ctx.lineWidth = 1.2;

      for (let i = 0; i < dropCount; i++) {
        const initX = prng();
        const initY = prng();
        const speed = 0.7 + prng() * 0.5;
        const len = (15 + prng() * 25) * (0.6 + intensity * 0.6);

        const curY = ((initY + speed * t) % 1 + 1) % 1;
        const curX = ((initX + speed * 0.25 * t) % 1 + 1) % 1;

        const x1 = curX * w;
        const y1 = curY * h;
        const x2 = x1 + len * 0.25;
        const y2 = y1 + len;

        ctx.globalAlpha = (0.2 + prng() * 0.4) * (0.4 + intensity * 0.6);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      break;
    }

    case 'petals': {
      // Cánh hoa rơi lượn
      const petalCount = Math.round(15 + intensity * 25);
      const prng = mulberry32(seed + 606);

      for (let i = 0; i < petalCount; i++) {
        const initX = prng();
        const initY = prng();
        const speedY = 0.05 + prng() * 0.08;
        const speedX = 0.02 + prng() * 0.04;
        const phase = prng() * Math.PI * 2;
        const size = (6 + prng() * 8) * (0.7 + intensity * 0.5);

        const curY = ((initY + speedY * t) % 1 + 1) % 1;
        const curX = ((initX + speedX * t + Math.sin(t * 1.8 + phase) * 0.03) % 1 + 1) % 1;
        const rot = t * 1.5 + phase;

        ctx.save();
        ctx.translate(curX * w, curY * h);
        ctx.rotate(rot);
        ctx.scale(1, 0.5 + 0.4 * Math.sin(t * 2 + phase));

        ctx.fillStyle = '#ffb3c6';
        ctx.globalAlpha = (0.5 + 0.3 * Math.sin(phase)) * (0.5 + intensity * 0.5);
        ctx.beginPath();
        ctx.ellipse(0, 0, size, size * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }

    case 'embers': {
      // Tàn than lửa bốc lên
      const emberCount = Math.round(25 + intensity * 60);
      const prng = mulberry32(seed + 707);

      for (let i = 0; i < emberCount; i++) {
        const initX = prng();
        const initY = prng();
        const speedY = -0.1 - prng() * 0.15;
        const sway = (prng() - 0.5) * 0.05;
        const phase = prng() * Math.PI * 2;
        const size = 1.2 + prng() * 3.0;

        const curY = ((initY + speedY * t) % 1 + 1) % 1;
        const curX = ((initX + Math.sin(t * 2.5 + phase) * sway) % 1 + 1) % 1;

        const flicker = 0.4 + 0.6 * Math.sin(t * 6 + phase);
        ctx.fillStyle = prng() > 0.4 ? '#ff6b2b' : '#ffb03b';
        ctx.globalAlpha = Math.max(0, flicker * (0.3 + intensity * 0.7));

        ctx.beginPath();
        ctx.arc(curX * w, curY * h, size, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'fog': {
      // Sương trôi ngang nhiều lớp
      const layerCount = 3;
      const prng = mulberry32(seed + 808);

      for (let l = 0; l < layerCount; l++) {
        const speed = (0.015 + l * 0.01) * (l % 2 === 0 ? 1 : -0.7);
        const yPos = h * (0.3 + l * 0.25);
        const shiftX = (((prng() + speed * t) % 1 + 1) % 1) * w;

        const grad = ctx.createLinearGradient(0, yPos - 120, 0, yPos + 120);
        grad.addColorStop(0, 'rgba(230,235,245,0)');
        grad.addColorStop(0.5, `rgba(230,235,245,${0.18 * intensity})`);
        grad.addColorStop(1, 'rgba(230,235,245,0)');

        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 0.4 + l);
        ctx.fillStyle = grad;
        ctx.fillRect(0, yPos - 120, w, 240);
      }
      break;
    }

    case 'light_rays': {
      // Tia sáng chéo rọi từ góc
      const rayCount = 5;
      const prng = mulberry32(seed + 909);
      const angle = 0.65; // rad

      for (let r = 0; r < rayCount; r++) {
        const offset = (r / rayCount) * w * 0.8;
        const breath = 0.4 + 0.6 * Math.sin(t * 1.2 + r * 1.5);
        const rayWidth = (w * 0.12) * (0.7 + intensity * 0.6);

        ctx.save();
        ctx.translate(offset, 0);
        ctx.rotate(angle);

        const grad = ctx.createLinearGradient(0, 0, w * 1.2, 0);
        grad.addColorStop(0, `rgba(255,245,210,${0.25 * intensity * breath})`);
        grad.addColorStop(0.7, `rgba(255,245,210,${0.08 * intensity * breath})`);
        grad.addColorStop(1, 'rgba(255,245,210,0)');

        ctx.fillStyle = grad;
        ctx.fillRect(-rayWidth / 2, -h, rayWidth, h * 3);
        ctx.restore();
      }
      break;
    }

    case 'light_leak': {
      // Vệt sáng ấm ở mép khung
      const cycle = Math.sin(t * 0.6 + seed);
      const leakX = (0.1 + 0.15 * Math.sin(t * 0.4)) * w;
      const leakY = (0.1 + 0.15 * Math.cos(t * 0.3)) * h;
      const radius = Math.max(w, h) * 0.6;

      const grad = ctx.createRadialGradient(leakX, leakY, 0, leakX, leakY, radius);
      grad.addColorStop(0, `rgba(255,140,50,${0.35 * intensity * (0.6 + 0.4 * cycle)})`);
      grad.addColorStop(0.5, `rgba(255,210,120,${0.15 * intensity})`);
      grad.addColorStop(1, 'rgba(255,210,120,0)');

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      break;
    }

    case 'lens_flare': {
      // Vệt flare lướt nhẹ qua 1 lần hoặc theo chu kỳ
      const flareProgress = (pTime * 1.3) % 1.5; // lướt từ 0 -> 1 rồi nghỉ
      if (flareProgress <= 1.0) {
        const fx = flareProgress * w * 1.2 - w * 0.1;
        const fy = h * 0.35 + Math.sin(flareProgress * Math.PI) * 40;
        const flareAlpha = Math.sin(flareProgress * Math.PI) * intensity;

        // Vòng tròn flare
        const grad = ctx.createRadialGradient(fx, fy, 2, fx, fy, 140);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(0.2, 'rgba(120,200,255,0.4)');
        grad.addColorStop(0.6, 'rgba(255,180,80,0.15)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.globalAlpha = Math.min(1, flareAlpha * 0.8);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(fx, fy, 140, 0, Math.PI * 2);
        ctx.fill();

        // Đường streak ngang
        ctx.strokeStyle = 'rgba(160,220,255,0.5)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(fx - 220, fy);
        ctx.lineTo(fx + 220, fy);
        ctx.stroke();
      }
      break;
    }

    case 'film_grain': {
      // Hạt phim điện ảnh động xác định theo frame/seed
      const grainIntensity = intensity * 0.12;
      const grainSeed = Math.floor(t * 24) + seed;
      const prng = mulberry32(grainSeed);

      // Dựng mẫu hạt nhanh bằng ImageData nhỏ
      const gw = 128;
      const gh = 128;
      const gCanvas = document.createElement('canvas');
      gCanvas.width = gw;
      gCanvas.height = gh;
      const gCtx = gCanvas.getContext('2d');
      if (gCtx) {
        const imgData = gCtx.createImageData(gw, gh);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const val = Math.floor(prng() * 255);
          d[i] = val;
          d[i + 1] = val;
          d[i + 2] = val;
          d[i + 3] = Math.floor(prng() * 255 * grainIntensity);
        }
        gCtx.putImageData(imgData, 0, 0);

        ctx.globalAlpha = 1.0;
        const pattern = ctx.createPattern(gCanvas, 'repeat');
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, w, h);
        }
      }
      break;
    }

    case 'vignette': {
      // Viền tối cổ điển 4 góc
      const maxDist = Math.hypot(w / 2, h / 2);
      const grad = ctx.createRadialGradient(
        w / 2,
        h / 2,
        maxDist * 0.35,
        w / 2,
        h / 2,
        maxDist
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.7, `rgba(0,0,0,${0.35 * intensity})`);
      grad.addColorStop(1, `rgba(0,0,0,${0.85 * intensity})`);

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      break;
    }

    case 'flicker': {
      // Ánh sáng rung rinh nhẹ toàn khung
      const flickerVal = Math.sin(t * 8 + seed) * Math.cos(t * 14 + seed * 2);
      const alpha = Math.abs(flickerVal) * 0.08 * intensity;

      ctx.fillStyle = flickerVal > 0 ? '#fff8e7' : '#000000';
      ctx.globalAlpha = alpha;
      ctx.fillRect(0, 0, w, h);
      break;
    }

    case 'fireflies': {
      // Đom đóm bay lượn uốn éo
      const bugCount = Math.round(10 + intensity * 20);
      const prng = mulberry32(seed + 1010);

      for (let i = 0; i < bugCount; i++) {
        const initX = prng();
        const initY = prng();
        const freqX = 0.5 + prng() * 1.5;
        const freqY = 0.5 + prng() * 1.5;
        const phaseX = prng() * Math.PI * 2;
        const phaseY = prng() * Math.PI * 2;
        const glowFreq = 2 + prng() * 4;

        const curX = ((initX + Math.sin(t * freqX + phaseX) * 0.08) % 1 + 1) % 1;
        const curY = ((initY + Math.cos(t * freqY + phaseY) * 0.08) % 1 + 1) % 1;

        const glow = Math.pow(Math.max(0, Math.sin(t * glowFreq + phaseX)), 2);
        if (glow < 0.05) continue;

        const radius = (6 + glow * 8) * (0.6 + intensity * 0.5);
        const grad = ctx.createRadialGradient(
          curX * w,
          curY * h,
          0,
          curX * w,
          curY * h,
          radius
        );
        grad.addColorStop(0, '#cfff45');
        grad.addColorStop(0.3, 'rgba(180,255,50,0.6)');
        grad.addColorStop(1, 'rgba(180,255,50,0)');

        ctx.globalAlpha = Math.min(1, glow * (0.4 + intensity * 0.6));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(curX * w, curY * h, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }

  ctx.restore();
}
