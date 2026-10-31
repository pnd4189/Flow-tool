export interface BodyReshapeOptions {
  strengthPercent: number; // 0..30 (%)
}

export interface BodyReshapeResult {
  outputCanvas: HTMLCanvasElement;
  changedPixelCount: number;
  protectedPreservedCount: number;
  outsidePreservedCount: number;
  editableCount: number;
}

/**
 * Thuật toán nắn thon gọn thân & bụng cục bộ:
 * - Khung thân = bounding box các pixel (sel > 0 && prot === 0).
 * - B = nửa bề rộng thân * 1.02, dải nền hai bên H = min(B + 0.30*(maxX - minX), cx, w - 1 - cx).
 * - Cả thân trong [-B, B] co đều về giữa theo hệ số (1 - sy) nên đường viền dịch vào thật.
 * - Dải nền hai bên [B, H] giãn ra lấp chỗ trống; tại d = H ánh xạ là đồng nhất nên không có đường nối.
 * - Pixel bảo vệ (prot > 0) giữ nguyên nguồn 100%. Áp dụng cho mọi pixel không bị bảo vệ trong vùng làm việc.
 * - Nội suy ngang với premultiplied alpha tại tọa độ nguồn sx.
 */
export function applyLocalWaistSlimming(
  sourceCanvas: HTMLCanvasElement,
  effectiveSelectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  options: BodyReshapeOptions
): BodyReshapeResult {
  const strengthRaw = options.strengthPercent;
  if (!Number.isFinite(strengthRaw) || strengthRaw <= 0) {
    throw new Error('Độ thu gọn eo phải là số thực dương lớn hơn 0% (tối đa 30%).');
  }

  const strength = Math.min(Math.max(strengthRaw / 100, 0), 0.3);
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (w <= 0 || h <= 0) {
    throw new Error('Kích thước ảnh không hợp lệ.');
  }

  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const selCtx = effectiveSelectionMask.getContext('2d', { willReadFrequently: true });
  const protCtx = protectionMask.getContext('2d', { willReadFrequently: true });
  if (!srcCtx || !selCtx || !protCtx) {
    throw new Error('Không thể khởi tạo ngữ cảnh vẽ để xử lý thu gọn eo.');
  }

  const src = srcCtx.getImageData(0, 0, w, h).data;
  const sel = selCtx.getImageData(0, 0, w, h).data;
  const prot = protCtx.getImageData(0, 0, w, h).data;

  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  let totalSelectedPixels = 0;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const idx = (rowOffset + x) * 4;
      if (sel[idx] > 0 && prot[idx] === 0) {
        totalSelectedPixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (totalSelectedPixels === 0 || maxX < minX || maxY < minY) {
    throw new Error('Vùng chọn chỉnh dáng rỗng hoặc đã bị lớp bảo vệ phủ kín.');
  }

  const cx = (minX + maxX) / 2;
  const spanX = maxX - minX;
  const B = (spanX / 2) * 1.02;
  const pad = 0.30 * spanX;
  const H = Math.min(B + pad, cx, w - 1 - cx);

  if (H <= B + 2) {
    throw new Error('Thân quá sát mép ảnh, không còn chỗ nền để thu gọn.');
  }

  const xa = Math.max(0, Math.ceil(cx - H));
  const xb = Math.min(w - 1, Math.floor(cx + H));

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = w;
  outputCanvas.height = h;
  const outCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) throw new Error('Không thể tạo bộ đệm kết quả.');

  const outImgData = outCtx.createImageData(w, h);
  const out = outImgData.data;
  out.set(src);

  const smoothstep = (minEdge: number, maxEdge: number, xVal: number) => {
    const tVal = Math.max(0, Math.min(1, (xVal - minEdge) / (maxEdge - minEdge)));
    return tVal * tVal * (3 - 2 * tVal);
  };

  let changedPixelCount = 0;
  let editableCount = 0;

  for (let y = minY; y <= maxY; y++) {
    const rowOffset = y * w;
    const t = (y - minY) / Math.max(1, maxY - minY);
    const vw = smoothstep(0, 0.3, t) * smoothstep(0, 0.3, 1 - t);
    const sy = strength * vw;
    if (sy <= 0) {
      // Đếm pixel không bị bảo vệ trong vùng làm việc của hàng này
      for (let x = xa; x <= xb; x++) {
        const idx = (rowOffset + x) * 4;
        if (prot[idx] === 0) {
          editableCount++;
        }
      }
      continue;
    }

    const Bp = B * (1 - sy);

    for (let x = xa; x <= xb; x++) {
      const idx = (rowOffset + x) * 4;
      const pVal = prot[idx];
      if (pVal > 0) {
        // Pixel bị bảo vệ giữ nguyên nguồn
        continue;
      }

      editableCount++;

      const d = Math.abs(x - cx);
      const sign = x < cx ? -1 : 1;

      let srcD: number;
      if (d <= Bp) {
        srcD = d / (1 - sy);
      } else {
        srcD = B + ((d - Bp) * (H - B)) / (H - Bp);
      }

      const sx = cx + sign * srcD;
      const clampedSx = Math.max(0, Math.min(w - 1, sx));
      const x0 = Math.floor(clampedSx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fracX = clampedSx - x0;

      const idx0 = (rowOffset + x0) * 4;
      const idx1 = (rowOffset + x1) * 4;

      const a0 = src[idx0 + 3] / 255;
      const a1 = src[idx1 + 3] / 255;

      // Premultiplied alpha interpolation
      const pmR = src[idx0] * a0 * (1 - fracX) + src[idx1] * a1 * fracX;
      const pmG = src[idx0 + 1] * a0 * (1 - fracX) + src[idx1 + 1] * a1 * fracX;
      const pmB = src[idx0 + 2] * a0 * (1 - fracX) + src[idx1 + 2] * a1 * fracX;
      const interpA = src[idx0 + 3] * (1 - fracX) + src[idx1 + 3] * fracX;

      const normA = interpA / 255;
      const finalR = normA > 0 ? Math.round(pmR / normA) : 0;
      const finalG = normA > 0 ? Math.round(pmG / normA) : 0;
      const finalB = normA > 0 ? Math.round(pmB / normA) : 0;
      const finalA = Math.round(interpA);

      out[idx] = finalR;
      out[idx + 1] = finalG;
      out[idx + 2] = finalB;
      out[idx + 3] = finalA;

      if (
        finalR !== src[idx] ||
        finalG !== src[idx + 1] ||
        finalB !== src[idx + 2] ||
        finalA !== src[idx + 3]
      ) {
        changedPixelCount++;
      }
    }
  }

  // Đếm số pixel được bảo vệ và số pixel ngoài vùng làm việc
  let protectedPreservedCount = 0;
  let outsidePreservedCount = 0;
  const totalPixels = w * h;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    const inWorkY = y >= minY && y <= maxY;
    for (let x = 0; x < w; x++) {
      const idx = (rowOffset + x) * 4;
      if (prot[idx] > 0) {
        protectedPreservedCount++;
      } else {
        const inWorkX = x >= xa && x <= xb;
        if (!inWorkY || !inWorkX) {
          outsidePreservedCount++;
        }
      }
    }
  }

  outCtx.putImageData(outImgData, 0, 0);

  return {
    outputCanvas,
    changedPixelCount,
    protectedPreservedCount,
    outsidePreservedCount,
    editableCount,
  };
}
