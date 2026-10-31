/**
 * Resizes a base64 image (PNG or JPEG) to exactly 1920x1080 and compresses it as JPEG
 * @param base64Str The original base64 image data URL
 * @returns A Promise resolving to the compressed JPEG base64 data URL
 */
export function resizeAndCompressToFullHD(base64Str: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Could not get 2D canvas context");
        }

        // Fit/fill the image to exactly 1920x1080
        // Since we requested 16:9 aspect ratio from Gemini, drawing directly covers it perfectly.
        // If there's slight mismatch, drawing directly will fit it to 1920x1080.
        ctx.drawImage(img, 0, 0, 1920, 1080);

        // Convert to compressed JPEG (quality 0.85 offers great compression and crisp detail)
        const compressedBase64 = canvas.toDataURL("image/jpeg", 0.85);
        resolve(compressedBase64);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      reject(new Error("Failed to load image for resizing"));
    };
    img.src = base64Str;
  });
}
