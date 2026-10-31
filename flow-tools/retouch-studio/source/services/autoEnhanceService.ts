function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Thuật toán "Tự động làm đẹp ảnh" (Deterministic, không AI):
 * - Lấy mẫu ảnh (bỏ qua các pixel có trong protectionMask > 0).
 * - Tính điểm đen/trắng = phân vị 0.5% và 99.5% của độ sáng (giãn mức, hệ số tối đa 1.35).
 * - Cân bằng trắng gray-world (hệ số mỗi kênh kẹp 0.92..1.08).
 * - Gamma đưa trung vị độ sáng về 0.47 (gamma kẹp 0.8..1.25).
 * - Vibrance +10 khi độ bão hoà trung bình thấp.
 * - Dựng LUT từng kênh, áp cho mọi pixel.
 * - Trộn lại pixel gốc theo lớp bảo vệ:
 *   * Pixel trong mặt nạ bảo vệ giữ nguyên tuyệt đối 100%.
 *   * Dải 12px ngay BÊN NGOÀI mặt nạ chuyển tiếp mềm dần sang ảnh đã chỉnh (không có viền cắt cứng).
 * - Xử lý theo khối hàng và nhường luồng (yieldToMain) để không treo tab.
 */
export async function autoEnhance(
  srcCanvas: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement | null,
  onProgress?: (pct: number) => void
): Promise<HTMLCanvasElement> {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  if (w <= 0 || h <= 0) {
    throw new Error('Kích thước ảnh nguồn không hợp lệ.');
  }

  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error('Không thể đọc dữ liệu ảnh nguồn.');
  const src = srcCtx.getImageData(0, 0, w, h).data;

  const protCtx = protectionMask
    ? protectionMask.getContext('2d', { willReadFrequently: true })
    : null;
  const prot = protCtx ? protCtx.getImageData(0, 0, w, h).data : null;

  const total = w * h;

  // Bước 1: Lấy mẫu thống kê các pixel không bị bảo vệ (bước nhảy lấy mẫu 4 để nhanh)
  const step = Math.max(1, Math.floor(Math.sqrt(total / 60000)));
  const lumSamples: number[] = [];
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sampleCount = 0;
  let sumSat = 0;

  for (let i = 0; i < total; i += step) {
    const idx = i * 4;
    if (prot && prot[idx] > 0) continue; // Bỏ pixel bảo vệ

    const r = src[idx];
    const g = src[idx + 1];
    const b = src[idx + 2];

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    lumSamples.push(lum);

    sumR += r;
    sumG += g;
    sumB += b;
    sampleCount++;

    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    sumSat += sat;
  }

  // Nếu toàn bộ ảnh bị bảo vệ, trả về bản sao nguyên bản
  if (sampleCount === 0 || lumSamples.length === 0) {
    const copy = document.createElement('canvas');
    copy.width = w;
    copy.height = h;
    const cCtx = copy.getContext('2d');
    if (cCtx) cCtx.drawImage(srcCanvas, 0, 0);
    return copy;
  }

  lumSamples.sort((a, b) => a - b);
  const p05Idx = Math.floor(lumSamples.length * 0.005);
  const p995Idx = Math.min(lumSamples.length - 1, Math.floor(lumSamples.length * 0.995));
  const blackPoint = lumSamples[p05Idx];
  const whitePoint = lumSamples[p995Idx];

  // Giãn mức: hệ số tối đa 1.35
  const rawStretch = 255 / Math.max(1, whitePoint - blackPoint);
  const stretchFactor = Math.min(1.35, Math.max(1.0, rawStretch));

  // Gray-world white balance: hệ số kẹp 0.92..1.08
  const avgR = sumR / sampleCount;
  const avgG = sumG / sampleCount;
  const avgB = sumB / sampleCount;
  const avgGray = (avgR + avgG + avgB) / 3;

  const rGain = Math.min(1.08, Math.max(0.92, avgR > 0 ? avgGray / avgR : 1));
  const gGain = Math.min(1.08, Math.max(0.92, avgG > 0 ? avgGray / avgG : 1));
  const bGain = Math.min(1.08, Math.max(0.92, avgB > 0 ? avgGray / avgB : 1));

  // Gamma đưa trung vị độ sáng về 0.47 (gamma kẹp 0.8..1.25)
  const medianLum = lumSamples[Math.floor(lumSamples.length / 2)] / 255;
  let gamma = 1.0;
  if (medianLum > 0.05 && medianLum < 0.95) {
    gamma = Math.log(0.47) / Math.log(medianLum);
    gamma = Math.min(1.25, Math.max(0.8, gamma));
  }

  // Vibrance +10 khi độ bão hoà trung bình thấp
  const avgSat = sumSat / sampleCount;
  const applyVibrance = avgSat < 0.35;
  const vibranceFactor = applyVibrance ? 1.10 : 1.0;

  // Bước 2: Dựng LUT 256 mức cho từng kênh R, G, B
  const lutR = new Uint8Array(256);
  const lutG = new Uint8Array(256);
  const lutB = new Uint8Array(256);

  for (let c = 0; c < 256; c++) {
    // Kênh R
    let valR = (c - blackPoint * (stretchFactor - 1) * 0.5) * stretchFactor;
    valR *= rGain;
    valR = Math.max(0, Math.min(255, valR));
    const normR = Math.pow(valR / 255, 1 / gamma);
    lutR[c] = Math.max(0, Math.min(255, Math.round(normR * 255)));

    // Kênh G
    let valG = (c - blackPoint * (stretchFactor - 1) * 0.5) * stretchFactor;
    valG *= gGain;
    valG = Math.max(0, Math.min(255, valG));
    const normG = Math.pow(valG / 255, 1 / gamma);
    lutG[c] = Math.max(0, Math.min(255, Math.round(normG * 255)));

    // Kênh B
    let valB = (c - blackPoint * (stretchFactor - 1) * 0.5) * stretchFactor;
    valB *= bGain;
    valB = Math.max(0, Math.min(255, valB));
    const normB = Math.pow(valB / 255, 1 / gamma);
    lutB[c] = Math.max(0, Math.min(255, Math.round(normB * 255)));
  }

  // Bước 3: Tính bản đồ trọng số bảo vệ với dải chuyển tiếp mềm 12px BÊN NGOÀI mặt nạ
  // weight = 0 (giữ nguyên gốc) cho pixel trong mặt nạ, chuyển dần sang 1 (ảnh chỉnh) sau 12px
  let blendWeights: Float32Array | null = null;
  if (prot) {
    const isProtected = new Uint8Array(total);
    let hasProtPixel = false;
    for (let i = 0; i < total; i++) {
      if (prot[i * 4] > 0) {
        isProtected[i] = 1;
        hasProtPixel = true;
      }
    }

    if (hasProtPixel) {
      // Dùng distance transform gần đúng cho bán kính 12px
      const dist = new Float32Array(total);
      dist.fill(99);

      // Điểm được bảo vệ có dist = 0
      for (let i = 0; i < total; i++) {
        if (isProtected[i] === 1) dist[i] = 0;
      }

      const R_FEATHER = 12;
      // Hai lượt quét hàng ngang và dọc để lan toả khoảng cách lân cận
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 1; x < w; x++) {
          dist[row + x] = Math.min(dist[row + x], dist[row + x - 1] + 1);
        }
        for (let x = w - 2; x >= 0; x--) {
          dist[row + x] = Math.min(dist[row + x], dist[row + x + 1] + 1);
        }
      }

      for (let x = 0; x < w; x++) {
        for (let y = 1; y < h; y++) {
          dist[y * w + x] = Math.min(dist[y * w + x], dist[(y - 1) * w + x] + 1);
        }
        for (let y = h - 2; y >= 0; y--) {
          dist[y * w + x] = Math.min(dist[y * w + x], dist[(y + 1) * w + x] + 1);
        }
      }

      blendWeights = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        const d = dist[i];
        if (d === 0) {
          blendWeights[i] = 0; // Giữ nguyên 100% pixel gốc
        } else if (d >= R_FEATHER) {
          blendWeights[i] = 1; // Áp dụng hoàn toàn ảnh đã chỉnh
        } else {
          // Chuyển tiếp mượt hàm smoothstep
          const t = d / R_FEATHER;
          blendWeights[i] = t * t * (3 - 2 * t);
        }
      }
    }
  }

  // Bước 4: Áp dụng LUT theo khối hàng và nhường luồng
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = w;
  outputCanvas.height = h;
  const outCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) throw new Error('Không thể tạo canvas kết quả.');

  const outImgData = outCtx.createImageData(w, h);
  const out = outImgData.data;

  const rowsPerChunk = 60;
  for (let startRow = 0; startRow < h; startRow += rowsPerChunk) {
    const endRow = Math.min(h, startRow + rowsPerChunk);

    for (let y = startRow; y < endRow; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        const idx = i * 4;

        const origR = src[idx];
        const origG = src[idx + 1];
        const origB = src[idx + 2];
        const origA = src[idx + 3];

        let enhR = lutR[origR];
        let enhG = lutG[origG];
        let enhB = lutB[origB];

        if (applyVibrance) {
          const maxC = Math.max(enhR, enhG, enhB);
          const minC = Math.min(enhR, enhG, enhB);
          const curSat = maxC > 0 ? (maxC - minC) / maxC : 0;
          if (curSat < 0.5) {
            const gray = 0.299 * enhR + 0.587 * enhG + 0.114 * enhB;
            enhR = Math.max(0, Math.min(255, Math.round(gray + (enhR - gray) * vibranceFactor)));
            enhG = Math.max(0, Math.min(255, Math.round(gray + (enhG - gray) * vibranceFactor)));
            enhB = Math.max(0, Math.min(255, Math.round(gray + (enhB - gray) * vibranceFactor)));
          }
        }

        const wBlend = blendWeights ? blendWeights[i] : 1.0;

        if (wBlend === 0) {
          out[idx] = origR;
          out[idx + 1] = origG;
          out[idx + 2] = origB;
          out[idx + 3] = origA;
        } else if (wBlend === 1) {
          out[idx] = enhR;
          out[idx + 1] = enhG;
          out[idx + 2] = enhB;
          out[idx + 3] = origA;
        } else {
          out[idx] = Math.round(origR * (1 - wBlend) + enhR * wBlend);
          out[idx + 1] = Math.round(origG * (1 - wBlend) + enhG * wBlend);
          out[idx + 2] = Math.round(origB * (1 - wBlend) + enhB * wBlend);
          out[idx + 3] = origA;
        }
      }
    }

    if (onProgress) {
      onProgress(Math.round((endRow / h) * 100));
    }
    await yieldToMain();
  }

  outCtx.putImageData(outImgData, 0, 0);
  return outputCanvas;
}
