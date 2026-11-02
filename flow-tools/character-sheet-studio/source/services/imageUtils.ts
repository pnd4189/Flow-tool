/**
 * Maps MIME type to safe filename extension.
 */
export function extForMime(mime: string): string {
  const clean = mime.toLowerCase();
  if (clean.includes('png')) return 'png';
  if (clean.includes('webp')) return 'webp';
  if (clean.includes('jpeg') || clean.includes('jpg')) return 'jpg';
  return 'png';
}

/**
 * Builds standard output filename: ${tag}_${layoutId}_${YYYYMMDD-HHmmss}.${ext}
 */
export function buildFilename(
  tag: string,
  layoutId: string,
  mime: string,
  date: Date = new Date()
): string {
  const safeTag = (tag || 'character')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 24);

  const safeLayout = (layoutId || 'sheet')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  const timestamp = `${year}${month}${day}-${hours}${minutes}${seconds}`;
  const ext = extForMime(mime);

  return `${safeTag}_${safeLayout}_${timestamp}.${ext}`;
}

/**
 * Creates a resized JPEG thumbnail data URL (max side: 420px) from a base64 image.
 */
export function makeThumbnail(
  base64: string,
  mimeType: string,
  maxSide: number = 420
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let width = img.width || maxSide;
      let height = img.height || maxSide;

      if (width > height) {
        if (width > maxSide) {
          height = Math.round((height * maxSide) / width);
          width = maxSide;
        }
      } else {
        if (height > maxSide) {
          width = Math.round((width * maxSide) / height);
          height = maxSide;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve(dataUrl);
      } else {
        // Fallback: raw data URL
        resolve(`data:${mimeType};base64,${base64}`);
      }
    };
    img.onerror = () => {
      // Fallback
      resolve(`data:${mimeType};base64,${base64}`);
    };
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

/**
 * Creates a JPEG copy no larger than 1280px on its longest side for QC inspection.
 * Returns raw base64 string and mimeType 'image/jpeg'.
 */
export function makeQcImage(
  base64: string,
  mimeType: string,
  maxSide: number = 1280
): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let width = img.width || maxSide;
      let height = img.height || maxSide;

      if (width > maxSide || height > maxSide) {
        if (width > height) {
          height = Math.round((height * maxSide) / width);
          width = maxSide;
        } else {
          width = Math.round((width * maxSide) / height);
          height = maxSide;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        const cleanBase64 = dataUrl.split(',')[1] || base64;
        resolve({ base64: cleanBase64, mimeType: 'image/jpeg' });
      } else {
        resolve({ base64, mimeType });
      }
    };
    img.onerror = () => {
      resolve({ base64, mimeType });
    };
    img.src = `data:${mimeType};base64,${base64}`;
  });
}
