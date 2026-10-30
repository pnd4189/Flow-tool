import { Flow } from 'flow-sdk';
import { VideoModelId, VideoResolution, VideoAspect, Scene } from '../types';

export interface VideoModelConfig {
  id: VideoModelId;
  label: string;
  resolutions: VideoResolution[];
  durations: number[];
  note: string;
}

export const VIDEO_MODELS: VideoModelConfig[] = [
  {
    id: 'Omni 1.1 Flash',
    label: 'Omni 1.1 Flash',
    resolutions: ['360p', '720p'],
    durations: [4, 6, 8, 10],
    note: 'Rẻ nhất ở 360p (bản nháp)',
  },
  {
    id: 'Veo 3.1 - Lite',
    label: 'Veo 3.1 - Lite',
    resolutions: ['720p'],
    durations: [4, 6, 8],
    note: 'Giá rẻ, chất lượng khá',
  },
  {
    id: 'Veo 3.1 - Fast',
    label: 'Veo 3.1 - Fast',
    resolutions: ['720p'],
    durations: [4, 6, 8],
    note: 'Nhanh, cân bằng',
  },
  {
    id: 'Veo 3.1 - Quality',
    label: 'Veo 3.1 - Quality',
    resolutions: ['720p'],
    durations: [4, 6, 8],
    note: 'Chất lượng cao nhất, rất đắt',
  },
];

export interface PresetItem {
  id: string;
  label: string;
  text: string;
}

export const STYLE_PRESETS: PresetItem[] = [
  { id: 'none', label: 'Không (Mặc định)', text: '' },
  { id: 'cinematic', label: 'Cinematic', text: 'cinematic film look, shallow depth of field, soft film grain, smooth motion' },
  { id: 'documentary', label: 'Documentary', text: 'documentary handheld feel, natural light, subtle camera shake' },
  { id: 'anime', label: 'Anime', text: '2D anime style animation, fluid motion, vibrant colors' },
  { id: 'realistic', label: 'Realistic', text: 'photorealistic, natural physics, realistic motion' },
  { id: 'dreamy', label: 'Dreamy', text: 'dreamy soft focus, gentle floating motion, pastel glow' },
  { id: 'timelapse', label: 'Time-lapse', text: 'time-lapse, accelerated motion of clouds, light and shadows' },
  { id: 'product', label: 'Product Shot', text: 'smooth studio product shot, slow rotating reveal, clean highlights' },
  { id: 'vintage', label: 'Vintage 8mm', text: 'vintage 8mm film look, warm tone, light flicker' },
];

export const CAMERA_PRESETS: PresetItem[] = [
  { id: 'none', label: 'Không (Tự do)', text: '' },
  { id: 'static', label: 'Static (Cố định)', text: 'static locked-off camera' },
  { id: 'push_in', label: 'Push-in (Tiến gần)', text: 'slow push-in toward the subject' },
  { id: 'pull_out', label: 'Pull-out (Lùi xa)', text: 'slow pull-out revealing the scene' },
  { id: 'pan_left', label: 'Pan Left (Quét trái)', text: 'smooth pan to the left' },
  { id: 'pan_right', label: 'Pan Right (Quét phải)', text: 'smooth pan to the right' },
  { id: 'tilt_up', label: 'Tilt Up (Hất lên)', text: 'slow tilt up' },
  { id: 'tilt_down', label: 'Tilt Down (Hạ xuống)', text: 'slow tilt down' },
  { id: 'orbit', label: 'Orbit (Xoay tròn)', text: 'slow orbit around the subject' },
  { id: 'handheld', label: 'Handheld (Cầm tay)', text: 'handheld camera with natural sway' },
  { id: 'drone', label: 'Drone (Bay trên cao)', text: 'aerial drone flyover' },
  { id: 'tracking', label: 'Tracking (Bám theo)', text: 'tracking shot following the subject' },
];

/** Ghép motion prompt: `${base} Camera: ${cameraText}. Style: ${styleText}.`, cắt tối đa 900 ký tự */
export function composeMotionPrompt(base: string, styleId: string, cameraId: string): string {
  const parts: string[] = [];
  const trimmedBase = (base || '').trim();
  if (trimmedBase) {
    parts.push(trimmedBase);
  }

  const cameraPreset = CAMERA_PRESETS.find(p => p.id === cameraId);
  if (cameraPreset && cameraPreset.text) {
    parts.push(`Camera: ${cameraPreset.text}.`);
  }

  const stylePreset = STYLE_PRESETS.find(p => p.id === styleId);
  if (stylePreset && stylePreset.text) {
    parts.push(`Style: ${stylePreset.text}.`);
  }

  const combined = parts.join(' ').replace(/\s+/g, ' ').trim();
  return combined.slice(0, 900);
}

/** Trả về default motion prompt cho 1 scene */
export function defaultMotionPrompt(scene: Scene): string {
  if (scene.motionPrompt && scene.motionPrompt.trim().length > 0) {
    return scene.motionPrompt.trim();
  }
  return 'Subtle natural motion bringing the scene to life.';
}

/** Chuyển tiếng Việt có dấu sang slug an toàn cho tên file video */
export function slugForFile(text: string): string {
  if (!text) return 'scene';
  const normalized = text
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const trimmed = normalized.slice(0, 40);
  return trimmed || 'scene';
}

/** Map Model sang modelSlug chuẩn cho tên file */
export function getModelSlug(model: VideoModelId): string {
  switch (model) {
    case 'Omni 1.1 Flash':
      return 'omni-flash';
    case 'Veo 3.1 - Lite':
      return 'veo31-lite';
    case 'Veo 3.1 - Fast':
      return 'veo31-fast';
    case 'Veo 3.1 - Quality':
      return 'veo31-quality';
    default:
      return 'omni-flash';
  }
}

/** Cache mediaId của ảnh đầu video theo `${sceneId}_${aspect}` để tránh upload lại */
const firstFrameCache = new Map<string, string>();

export function clearFirstFrameCache(): void {
  firstFrameCache.clear();
}

/**
 * Chuẩn bị firstFrameImageMediaId cho video:
 * - Nếu scene.result.mediaId khác rỗng VÀ tỷ lệ scene trùng tỷ lệ video => dùng thẳng scene.result.mediaId
 * - Ngược lại: cắt giữa ảnh full-size bằng canvas cho đúng tỷ lệ video (16:9 hoặc 9:16), xuất JPEG 0.92,
 *   gọi Flow.upload({ base64, mimeType: 'image/jpeg', name: `${slug}_frame` }) lấy mediaId.
 * - Cache theo `${scene.id}_${aspect}`.
 */
export async function getOrCreateFirstFrameMediaId(scene: Scene, videoAspect: VideoAspect): Promise<string> {
  if (!scene.result) {
    throw new Error('Cảnh chưa có ảnh kết quả.');
  }

  // Khớp tỷ lệ và đã có mediaId (chưa bị xóa do chỉnh sửa canvas)
  if (scene.result.mediaId && scene.result.mediaId.trim().length > 0 && scene.aspectRatio === videoAspect) {
    return scene.result.mediaId;
  }

  const cacheKey = `${scene.id}_${videoAspect}`;
  const cached = firstFrameCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const targetRatio = videoAspect === '16:9' ? 16 / 9 : 9 / 16;
  const slug = slugForFile(scene.title);

  const base64Jpeg = await new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let canvas: HTMLCanvasElement | null = null;
      try {
        const origW = img.naturalWidth || img.width;
        const origH = img.naturalHeight || img.height;
        const origRatio = origW / origH;

        let cropX = 0;
        let cropY = 0;
        let cropW = origW;
        let cropH = origH;

        if (origRatio > targetRatio) {
          // Rộng hơn đích -> cắt bớt trái/phải
          cropW = Math.round(origH * targetRatio);
          cropH = origH;
          cropX = Math.round((origW - cropW) / 2);
          cropY = 0;
        } else {
          // Cao hơn đích -> cắt bớt trên/dưới
          cropW = origW;
          cropH = Math.round(origW / targetRatio);
          cropX = 0;
          cropY = Math.round((origH - cropH) / 2);
        }

        canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Không thể khởi tạo 2D canvas context.');
        }

        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        const rawBase64 = dataUrl.split(',')[1];
        resolve(rawBase64);
      } catch (e) {
        reject(e);
      } finally {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    };
    img.onerror = () => reject(new Error('Không thể tải ảnh để cắt tỷ lệ video.'));
    img.src = `data:${scene.result!.mimeType || 'image/jpeg'};base64,${scene.result!.base64}`;
  });

  const uploadResult = await Flow.upload({
    base64: base64Jpeg,
    mimeType: 'image/jpeg',
    name: `${slug}_frame`,
  });

  if (!uploadResult?.mediaId) {
    throw new Error('Flow.upload không trả về mediaId.');
  }

  firstFrameCache.set(cacheKey, uploadResult.mediaId);
  return uploadResult.mediaId;
}

/**
 * Đổi chuỗi base64 mp4 thành Blob bằng cách giải mã atob theo từng đoạn nhỏ (chunk)
 * để tránh vượt quá bộ nhớ chuỗi của JavaScript khi video nặng.
 */
export function base64ToBlob(base64Data: string, mimeType: string = 'video/mp4'): Blob {
  // Bỏ prefix data:video/...;base64, nếu có
  const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const binaryString = atob(cleanBase64);
  const len = binaryString.length;
  const chunkSize = 32768; // 32KB chunk
  const chunks: Uint8Array[] = [];

  for (let offset = 0; offset < len; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, len);
    const chunkLength = end - offset;
    const bytes = new Uint8Array(chunkLength);
    for (let i = 0; i < chunkLength; i++) {
      bytes[i] = binaryString.charCodeAt(offset + i);
    }
    chunks.push(bytes);
  }

  return new Blob(chunks, { type: mimeType });
}

/**
 * Đọc Blob sang base64 thuần (không có prefix data:) để truyền vào Flow.download
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (!result) {
        reject(new Error('Lỗi chuyển Blob sang Base64'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('FileReader gặp lỗi khi đọc file video'));
    reader.readAsDataURL(blob);
  });
}

/** Phân loại lỗi khi tạo video */
export function checkVideoErrorType(msg: string): {
  isTransient: boolean;
  isQuota: boolean;
  isSafety: boolean;
} {
  const lower = (msg || '').toLowerCase();
  const isTransient = [
    'tạm thời không hoạt động',
    'unavailable',
    'busy',
    'overloaded',
    'rate limit',
  ].some(t => lower.includes(t));

  const isQuota = lower.includes('quota') || lower.includes('credit');
  const isSafety = lower.includes('safety') || lower.includes('policy') || lower.includes('blocked');

  return { isTransient, isQuota, isSafety };
}
