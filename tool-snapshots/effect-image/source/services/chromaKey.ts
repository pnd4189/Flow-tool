/**
 * Tách nền xanh lá (#00FF00) với thuật toán 2 ngưỡng mềm và khử ám xanh (despill)
 */
export async function chromaKeyExtract(
  imageSource: string | HTMLImageElement
): Promise<{ cutoutBase64: string; cutoutDataUrl: string; width: number; height: number }> {
  const img = await resolveImage(imageSource);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể khởi tạo Canvas 2D context cho chroma key.');

  ctx.drawImage(img, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Thuật toán: Khoảng cách màu tới chuẩn green (0, 255, 0)
  // và so sánh tỷ lệ kênh Green so với Max(Red, Blue)
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Tính độ trội của màu xanh lá
    const maxOther = Math.max(r, b);
    const greenDiff = g - maxOther;

    // Ngưỡng phát hiện green screen
    // Ngưỡng cứng: xanh lá vượt trội rõ rệt
    if (g > 90 && greenDiff > 45 && g > r * 1.3 && g > b * 1.3) {
      // Hoàn toàn trong suốt
      data[i + 3] = 0;
    } else if (g > 60 && greenDiff > 15) {
      // Vùng mềm chuyển tiếp (feather zone)
      const alphaFactor = 1 - Math.min(1, Math.max(0, (greenDiff - 15) / 30));
      data[i + 3] = Math.round(data[i + 3] * alphaFactor);

      // Khử ám xanh (Green Despill): ép kênh G về max(R, B)
      if (data[i + 1] > maxOther) {
        data[i + 1] = maxOther;
      }
    } else {
      // Nếu pixel không phải nền xanh nhưng có viền ám xanh nhẹ ở mép
      if (g > maxOther + 10) {
        data[i + 1] = Math.round((g + maxOther) / 2);
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Nhẹ nhàng làm mềm viền (feather/blur 1px bằng composite blur nếu cần)
  const cutoutDataUrl = canvas.toDataURL('image/png');
  const cutoutBase64 = cutoutDataUrl.split(',')[1];

  return { cutoutBase64, cutoutDataUrl, width, height };
}

/**
 * Đo độ lệch tâm giữa chủ thể được tách và sự khác biệt giữa ảnh gốc & nền
 */
export async function calculateSubjectOffset(
  originalSrc: string,
  bgSrc: string,
  cutoutSrc: string
): Promise<{ dx: number; dy: number; total: number }> {
  const [origImg, bgImg, cutImg] = await Promise.all([
    resolveImage(originalSrc),
    resolveImage(bgSrc),
    resolveImage(cutoutSrc),
  ]);

  const w = origImg.naturalWidth || 640;
  const h = origImg.naturalHeight || 360;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { dx: 0, dy: 0, total: 0 };

  // 1. Tìm tâm của Cutout Subject (dựa trên alpha channel)
  ctx.drawImage(cutImg, 0, 0, w, h);
  const cutData = ctx.getImageData(0, 0, w, h).data;
  let cutSumX = 0;
  let cutSumY = 0;
  let cutCount = 0;

  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const idx = (y * w + x) * 4;
      if (cutData[idx + 3] > 60) {
        cutSumX += x;
        cutSumY += y;
        cutCount++;
      }
    }
  }

  const cutCenterX = cutCount > 0 ? cutSumX / cutCount : w / 2;
  const cutCenterY = cutCount > 0 ? cutSumY / cutCount : h / 2;

  // 2. Tìm tâm của vùng khác biệt giữa Original & Background
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(origImg, 0, 0, w, h);
  const origData = ctx.getImageData(0, 0, w, h).data;

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bgImg, 0, 0, w, h);
  const bgData = ctx.getImageData(0, 0, w, h).data;

  let diffSumX = 0;
  let diffSumY = 0;
  let diffCount = 0;

  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const idx = (y * w + x) * 4;
      const dr = Math.abs(origData[idx] - bgData[idx]);
      const dg = Math.abs(origData[idx + 1] - bgData[idx + 1]);
      const db = Math.abs(origData[idx + 2] - bgData[idx + 2]);
      const diff = dr + dg + db;
      if (diff > 80) {
        diffSumX += x;
        diffSumY += y;
        diffCount++;
      }
    }
  }

  const diffCenterX = diffCount > 0 ? diffSumX / diffCount : cutCenterX;
  const diffCenterY = diffCount > 0 ? diffSumY / diffCount : cutCenterY;

  const dx = Math.round(cutCenterX - diffCenterX);
  const dy = Math.round(cutCenterY - diffCenterY);
  const total = Math.round(Math.hypot(dx, dy));

  return { dx, dy, total };
}

function resolveImage(source: string | HTMLImageElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof source !== 'string') {
      if (source.complete) resolve(source);
      else {
        source.onload = () => resolve(source);
        source.onerror = (e) => reject(e);
      }
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = source.startsWith('data:') ? source : `data:image/png;base64,${source}`;
  });
}
