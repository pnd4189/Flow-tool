import pica from 'pica';
import { AspectRatio } from '../types';

const resizer = pica();

export const RESOLUTION_MAP = {
  'Full HD': 1080,
  '2K': 1440,
  '4K': 2160,
};

/** Standard aspect ratio multipliers (w / h) */
const ASPECT_RATIO_VALUES: Record<AspectRatio, { w: number; h: number }> = {
  '1:1': { w: 1, h: 1 },
  '16:9': { w: 16, h: 9 },
  '9:16': { w: 9, h: 16 },
  '4:3': { w: 4, h: 3 },
  '3:4': { w: 3, h: 4 },
};

/**
 * Computes exact target dimensions based on standard aspectRatio and resolution tier:
 * S = RESOLUTION_MAP[targetResolution] (1080 / 1440 / 2160).
 * - w > h (landscape): height = S, width = round(S * w / h) -> 16:9 = 1920x1080 / 2560x1440 / 3840x2160; 4:3 = 1440x1080
 * - w < h (portrait): width = S, height = round(S * h / w) -> 9:16 = 1080x1920; 3:4 = 1080x1440
 * - 1:1 (square): width = S, height = S -> 1080x1080
 */
export function getStandardDimensions(
  aspectRatio: AspectRatio,
  targetResolution: keyof typeof RESOLUTION_MAP
): { width: number; height: number } {
  const S = RESOLUTION_MAP[targetResolution];
  const { w, h } = ASPECT_RATIO_VALUES[aspectRatio] || { w: 16, h: 9 };

  if (w > h) {
    return {
      width: Math.round((S * w) / h),
      height: S,
    };
  } else if (w < h) {
    return {
      width: S,
      height: Math.round((S * h) / w),
    };
  } else {
    return {
      width: S,
      height: S,
    };
  }
}

/**
 * Creates an optimized thumbnail (max 480px width) and returns real natural dimensions of the image.
 * Does NOT resize the full image.
 */
export async function makeThumbnail(
  base64: string,
  mimeType: string
): Promise<{ thumbBase64: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      let srcCanvas: HTMLCanvasElement | null = null;
      let thumbCanvas: HTMLCanvasElement | null = null;
      try {
        const origWidth = img.naturalWidth || img.width;
        const origHeight = img.naturalHeight || img.height;
        const aspectRatio = origWidth / origHeight;

        const maxThumbWidth = 480;
        const thumbWidth = Math.min(maxThumbWidth, origWidth);
        const thumbHeight = Math.max(1, Math.round(thumbWidth / aspectRatio));

        srcCanvas = document.createElement('canvas');
        srcCanvas.width = origWidth;
        srcCanvas.height = origHeight;
        const srcCtx = srcCanvas.getContext('2d');
        if (!srcCtx) throw new Error('Failed to get source context');
        srcCtx.drawImage(img, 0, 0);

        thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = thumbWidth;
        thumbCanvas.height = thumbHeight;

        await resizer.resize(srcCanvas, thumbCanvas, {
          unsharpAmount: 40,
          unsharpRadius: 0.5,
          unsharpThreshold: 2,
        });

        const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);
        const thumbBase64 = thumbDataUrl.split(',')[1];

        resolve({
          thumbBase64,
          width: origWidth,
          height: origHeight,
        });
      } catch (err) {
        reject(err);
      } finally {
        if (srcCanvas) {
          srcCanvas.width = 0;
          srcCanvas.height = 0;
        }
        if (thumbCanvas) {
          thumbCanvas.width = 0;
          thumbCanvas.height = 0;
        }
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for thumbnail creation'));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

/**
 * Upscales a base64 image to target resolution using Lanczos resampling.
 * Anchors resolution to the standard dimensions defined by target aspectRatio and resolution tier:
 * - 16:9 -> 1920x1080 (Full HD), 2560x1440 (2K), 3840x2160 (4K)
 * - 4:3  -> 1440x1080 (Full HD), 1920x1440 (2K), 2880x2160 (4K)
 * - 9:16 -> 1080x1920 (Full HD), 1440x2560 (2K), 2160x3840 (4K)
 * - 3:4  -> 1080x1440 (Full HD), 1440x1920 (2K), 2160x2880 (4K)
 * - 1:1  -> 1080x1080 (Full HD), 1440x1440 (2K), 2160x2160 (4K)
 *
 * If source image aspect ratio differs from target aspect ratio, center-crops (cover) the source
 * image to match target aspect ratio BEFORE resizing, preventing any stretching.
 * Always exports JPEG with quality 0.92 and mimeType 'image/jpeg'.
 * Generates an optimized thumbnail (max 480px width, JPEG 0.8 quality).
 * Canvas memory is explicitly released (width = height = 0).
 */
export async function upscaleImage(
  base64: string, 
  mimeType: string, 
  targetResolution: keyof typeof RESOLUTION_MAP,
  aspectRatio: AspectRatio = '16:9'
): Promise<{ base64: string; thumbBase64: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      let srcCanvas: HTMLCanvasElement | null = null;
      let dstCanvas: HTMLCanvasElement | null = null;
      let thumbCanvas: HTMLCanvasElement | null = null;

      try {
        const { width: targetWidth, height: targetHeight } = getStandardDimensions(aspectRatio, targetResolution);
        const targetAR = targetWidth / targetHeight;

        const origWidth = img.naturalWidth || img.width;
        const origHeight = img.naturalHeight || img.height;
        const origAR = origWidth / origHeight;

        // Calculate center-crop coordinates (cover mode) so source matches targetAR exactly without stretching
        let cropX = 0;
        let cropY = 0;
        let cropW = origWidth;
        let cropH = origHeight;

        if (Math.abs(origAR - targetAR) > 0.001) {
          if (origAR > targetAR) {
            // Source is wider than target: trim left and right
            cropW = Math.round(origHeight * targetAR);
            cropH = origHeight;
            cropX = Math.round((origWidth - cropW) / 2);
            cropY = 0;
          } else {
            // Source is taller than target: trim top and bottom
            cropW = origWidth;
            cropH = Math.round(origWidth / targetAR);
            cropX = 0;
            cropY = Math.round((origHeight - cropH) / 2);
          }
        }

        // 1. Source canvas holding the center-cropped region
        srcCanvas = document.createElement('canvas');
        srcCanvas.width = cropW;
        srcCanvas.height = cropH;
        const srcCtx = srcCanvas.getContext('2d');
        if (!srcCtx) throw new Error('Failed to get source context');

        // Draw cropped area into srcCanvas
        srcCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        // 2. Full-size destination canvas for exact standard dimensions
        dstCanvas = document.createElement('canvas');
        dstCanvas.width = targetWidth;
        dstCanvas.height = targetHeight;

        // Pica Lanczos resize
        await resizer.resize(srcCanvas, dstCanvas, {
          unsharpAmount: 80,
          unsharpRadius: 0.6,
          unsharpThreshold: 2,
        });

        // Always export full-size as JPEG quality 0.92
        const fullDataUrl = dstCanvas.toDataURL('image/jpeg', 0.92);
        const resultBase64 = fullDataUrl.split(',')[1];

        // 3. Create thumbnail with max width 480px, maintaining target aspect ratio
        const maxThumbWidth = 480;
        let thumbWidth: number;
        let thumbHeight: number;

        if (targetWidth >= targetHeight) {
          thumbWidth = Math.min(maxThumbWidth, targetWidth);
          thumbHeight = Math.max(1, Math.round(thumbWidth / targetAR));
        } else {
          thumbWidth = Math.min(maxThumbWidth, targetWidth);
          thumbHeight = Math.max(1, Math.round(thumbWidth / targetAR));
        }

        thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = thumbWidth;
        thumbCanvas.height = thumbHeight;

        await resizer.resize(dstCanvas, thumbCanvas, {
          unsharpAmount: 40,
          unsharpRadius: 0.5,
          unsharpThreshold: 2,
        });

        const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);
        const thumbBase64 = thumbDataUrl.split(',')[1];

        resolve({
          base64: resultBase64,
          thumbBase64,
          width: targetWidth,
          height: targetHeight,
        });
      } catch (err) {
        reject(err);
      } finally {
        // Explicitly release canvas GPU/memory
        if (srcCanvas) {
          srcCanvas.width = 0;
          srcCanvas.height = 0;
        }
        if (dstCanvas) {
          dstCanvas.width = 0;
          dstCanvas.height = 0;
        }
        if (thumbCanvas) {
          thumbCanvas.width = 0;
          thumbCanvas.height = 0;
        }
      }
    };

    img.onerror = () => reject(new Error('Failed to load image for upscaling'));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}
