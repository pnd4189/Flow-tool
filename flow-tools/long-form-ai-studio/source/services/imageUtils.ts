/**
 * Scales an image data URL down to a max width of 360px and encodes to JPEG quality 0.8.
 */
export async function makeThumbnail(dataUrl: string, maxWidth = 360): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl.split(',')[1] || dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const thumbData = canvas.toDataURL('image/jpeg', 0.8);
      resolve(thumbData.split(',')[1]);
    };
    img.onerror = () => {
      resolve(dataUrl.split(',')[1] || dataUrl);
    };
    img.src = dataUrl;
  });
}
