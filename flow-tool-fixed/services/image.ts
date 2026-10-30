import pica from 'pica';

const resizer = pica();

export const RESOLUTION_MAP = {
  'Full HD': 1080,
  '2K': 1440,
  '4K': 2160,
};

/**
 * Upscales a base64 image to a target resolution using Lanczos resampling.
 * Anchors the resolution to the height (e.g., 1080p, 1440p, 2160p).
 */
export async function upscaleImage(
  base64: string, 
  mimeType: string, 
  targetResolution: keyof typeof RESOLUTION_MAP
): Promise<{ base64: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const targetHeight = RESOLUTION_MAP[targetResolution];
        const aspectRatio = img.width / img.height;
        const targetWidth = Math.round(targetHeight * aspectRatio);

        // Create offscreen canvas for source
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = img.width;
        srcCanvas.height = img.height;
        const srcCtx = srcCanvas.getContext('2d');
        if (!srcCtx) throw new Error('Failed to get source context');
        srcCtx.drawImage(img, 0, 0);

        // Create offscreen canvas for destination
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = targetWidth;
        dstCanvas.height = targetHeight;

        // Use Pica for high-quality Lanczos resampling
        await resizer.resize(srcCanvas, dstCanvas, {
          unsharpAmount: 80,
          unsharpRadius: 0.6,
          unsharpThreshold: 2,
        });

        const resultBase64 = dstCanvas.toDataURL(mimeType, 0.92).split(',')[1];
        resolve({ base64: resultBase64 });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for upscaling'));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}