import { Flow } from 'flow-sdk';

export interface FaceContour {
  noseX: number;  // pixel
  leftX: number;  // pixel (outer cheek/jaw edge at mouth level)
  rightX: number; // pixel
  eyeY: number;   // pixel (mid-eye horizontal line)
  chinY: number;  // pixel (bottom of chin)
  mouthLeftX?: number;  // pixel (left mouth corner, optional)
  mouthRightX?: number; // pixel (right mouth corner, optional)
  width: number;  // pixel
  height: number; // pixel
}

interface RawNormalizedFaceContour {
  noseX: number;
  leftX: number;
  rightX: number;
  eyeY: number;
  chinY: number;
  mouthLeftX?: number;
  mouthRightX?: number;
}

export interface FaceSlimResult {
  outputCanvas: HTMLCanvasElement;
  changedPixelCount: number;
  coreCount: number;
  coreChanged: number;
  skippedSides: number;
  skippedFace?: boolean;
}

const contourCache = new WeakMap<HTMLCanvasElement, { w: number; h: number; promise: Promise<FaceContour[]> }>();

/**
 * Phát hiện đường viền khuôn mặt (Face Contours) bằng Flow.generate.text.
 * Thu nhỏ ảnh cạnh dài <= 1024 JPEG, timeout 90s, thinkingLevel 'low'.
 * Yêu cầu mảng JSON toạ độ chuẩn hóa 0..1000 bao gồm toạ độ khoé miệng trái/phải.
 */
export async function detectFaceContours(
  sourceCanvas: HTMLCanvasElement,
  onProgress?: (msg: string) => void
): Promise<FaceContour[]> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (w <= 0 || h <= 0) {
    throw new Error('Kích thước ảnh không hợp lệ.');
  }

  const cached = contourCache.get(sourceCanvas);
  if (cached && cached.w === w && cached.h === h) {
    onProgress?.('Dùng lại mốc khuôn mặt đã nhận diện cho ảnh này.');
    return cached.promise;
  }

  const taskPromise = (async (): Promise<FaceContour[]> => {
    onProgress?.('Đang chuẩn bị ảnh phân tích đường viền khuôn mặt...');

    const maxDim = 1024;
    let sampleCanvas = sourceCanvas;
    if (Math.max(w, h) > maxDim) {
      const scale = maxDim / Math.max(w, h);
      sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = Math.max(1, Math.round(w * scale));
      sampleCanvas.height = Math.max(1, Math.round(h * scale));
      const sCtx = sampleCanvas.getContext('2d');
      if (sCtx) {
        sCtx.drawImage(sourceCanvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
      }
    }

    const dataUrl = sampleCanvas.toDataURL('image/jpeg', 0.88);
    const base64 = dataUrl.split(',')[1];

    onProgress?.('AI đang xác định đường viền má, hàm, cằm, mắt và khoé miệng (Flow text)...');

    const prompt = `Phát hiện đường viền giải phẫu của tất cả khuôn mặt người trong ảnh.
Yêu cầu: CHỈ TRẢ VỀ DUY NHẤT một mảng JSON thuần túy (không markdown, không code block, không giải thích) theo mẫu:
[
  {"noseX": 500, "leftX": 420, "rightX": 580, "eyeY": 340, "chinY": 560, "mouthLeftX": 470, "mouthRightX": 530}
]
Toạ độ chuẩn hoá từ 0 đến 1000:
- leftX: mép da ngoài cùng của má/hàm bên trái (ngang tầm miệng), KHÔNG tính tai và tóc. Nếu không vẽ miệng, lấy ngang khoảng 2/3 đường từ mắt xuống đáy cằm.
- rightX: mép da ngoài cùng của má/hàm bên phải (ngang tầm miệng), KHÔNG tính tai và tóc. Nếu không vẽ miệng, lấy ngang khoảng 2/3 đường từ mắt xuống đáy cằm.
- eyeY: đường nằm ngang đi qua chính giữa hai mắt.
- chinY: điểm thấp nhất của hình khuôn mặt (đáy cằm, ngay trên cổ). Với tranh vẽ/hoạt hình không vẽ miệng hoặc cằm, vẫn lấy đáy của hình khuôn mặt, không lấy ngang hàm.
- noseX: đường sống mũi (trục giữa khuôn mặt).
- mouthLeftX: khoé miệng bên trái (phía bên trái ảnh, nằm giữa leftX và noseX).
- mouthRightX: khoé miệng bên phải (phía bên phải ảnh, nằm giữa noseX và rightX).
Nếu không thấy mặt nào, trả về đúng: []`;

    const systemInstruction =
      'Bạn là chuyên gia phân tích đường viền nhân trắc học khuôn mặt. Chỉ trả về JSON mảng toạ độ 0-1000.';

    const TIMEOUT_MS = 90000;
    let timeoutId: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Yêu cầu nhận diện đường viền khuôn mặt quá thời gian 90 giây.'));
      }, TIMEOUT_MS);
    });

    const requestPromise = Flow.generate.text(prompt, {
      systemInstruction,
      thinkingLevel: 'low',
      images: [{ base64, mimeType: 'image/jpeg' }],
    });

    let response: { text: string };
    try {
      response = await Promise.race([requestPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = (response.text || '').trim();
    onProgress?.('Đang thẩm định tính hợp lệ của đường viền...');

    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Không xác định được đường viền mặt. Hãy dùng ảnh rõ mặt hơn.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Không xác định được đường viền mặt. Hãy dùng ảnh rõ mặt hơn.');
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Không xác định được đường viền mặt. Hãy dùng ảnh rõ mặt hơn.');
    }

    const validContours: FaceContour[] = [];

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as RawNormalizedFaceContour;
      const { noseX: nX, leftX: lX, rightX: rX, eyeY: eY, chinY: cY, mouthLeftX: mlX, mouthRightX: mrX } = raw;

      if (
        typeof nX !== 'number' || !Number.isFinite(nX) ||
        typeof lX !== 'number' || !Number.isFinite(lX) ||
        typeof rX !== 'number' || !Number.isFinite(rX) ||
        typeof eY !== 'number' || !Number.isFinite(eY) ||
        typeof cY !== 'number' || !Number.isFinite(cY)
      ) {
        continue;
      }

      // Đổi ra toạ độ pixel thực
      const noseX = (nX / 1000) * w;
      const leftX = (lX / 1000) * w;
      const rightX = (rX / 1000) * w;
      const eyeY = (eY / 1000) * h;
      const chinY = (cY / 1000) * h;

      // Kiểm tra hợp lệ: leftX < noseX < rightX, eyeY < chinY, bề rộng mặt từ 2% tới 60% chiều rộng ảnh
      if (!(leftX < noseX && noseX < rightX)) continue;
      if (!(eyeY < chinY)) continue;

      const faceWidth = rightX - leftX;
      const widthRatio = faceWidth / w;
      if (widthRatio < 0.02 || widthRatio > 0.60) continue;

      // Thẩm định khoé miệng nếu có: leftX < mouthLeftX < noseX < mouthRightX < rightX
      let mouthLeftX: number | undefined = undefined;
      let mouthRightX: number | undefined = undefined;

      if (
        typeof mlX === 'number' && Number.isFinite(mlX) &&
        typeof mrX === 'number' && Number.isFinite(mrX)
      ) {
        const pxML = (mlX / 1000) * w;
        const pxMR = (mrX / 1000) * w;
        if (leftX < pxML && pxML < noseX && noseX < pxMR && pxMR < rightX) {
          mouthLeftX = pxML;
          mouthRightX = pxMR;
        }
      }

      validContours.push({
        noseX,
        leftX,
        rightX,
        eyeY,
        chinY,
        mouthLeftX,
        mouthRightX,
        width: faceWidth,
        height: chinY - eyeY,
      });
    }

    if (validContours.length === 0) {
      throw new Error('Không xác định được đường viền mặt. Hãy dùng ảnh rõ mặt hơn.');
    }

    // Sắp xếp theo bề rộng giảm dần (mặt lớn nhất trước)
    validContours.sort((a, b) => b.width - a.width);

    return validContours;
  })();

  contourCache.set(sourceCanvas, { w, h, promise: taskPromise });
  taskPromise.catch(() => {
    const cur = contourCache.get(sourceCanvas);
    if (cur && cur.promise === taskPromise) {
      contourCache.delete(sourceCanvas);
    }
  });

  return taskPromise;
}

function smoothstep(minVal: number, maxVal: number, x: number): number {
  if (maxVal <= minVal) return x >= maxVal ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - minVal) / (maxVal - minVal)));
  return t * t * (3 - 2 * t);
}

/**
 * Thuật toán Face-Aware Liquify nắn thon má/hàm mượt mà, không khấc và không méo vai:
 * - cx = noseX, E = eyeY, C = chinY, D = C - E.
 * - Dải dọc: startY = floor(E + 0.12*D), endY = min(h - 1, ceil(C + 0.05*D)) (dừng tại cằm, không kéo xuống vai).
 *   vy = smoothstep(E + 0.12*D, C - 0.3*D, y) * (1 - smoothstep(C - 0.3*D, C + 0.05*D, y));
 *   A = s * F_side * vy (s = strengthPercent / 100).
 * - Hai bên tính riêng: F_side = cx - leftX (trái) hoặc rightX - cx (phải);
 *   Lõi Cc (sàn 0.65*F_side, trần 0.8*F_side, mở rộng theo khoé miệng nếu hợp lệ).
 *   c_side = 1.8 * F_side; nếu có khoảng cách tới mặt khác (room) thì c_side = Math.min(1.8 * F_side, room - 0.05 * F_side).
 *   Nếu c_side < 1.2 * F_side: bỏ qua cả mặt (skippedFace = true).
 *   wf_side = Math.min(0.6 * F_side, c_side - 0.9 * F_side); b_side = c_side - wf_side.
 * - Với 0 <= d <= c_side (d = |x - cx|):
 *   * d <= Cc: giữ nguyên pixel nguồn 100% (bảo vệ mắt, mũi, miệng), đếm coreCount.
 *   * Còn lại: P = smoothstep(Cc, 0.9 * F_side, d) * (1 - smoothstep(b_side, c_side, d));
 *     srcD = d + A * P (ánh xạ luôn đơn điệu, không khấc). Lấy mẫu nguồn tại cx ∓ srcD bằng nội suy premultiplied alpha.
 */
export function applyFaceSlim(
  srcCanvas: HTMLCanvasElement,
  face: FaceContour,
  strengthPercent: number, // 1..15
  otherFaces?: FaceContour[]
): FaceSlimResult {
  const sClamped = Math.max(1, Math.min(15, strengthPercent));
  const s = sClamped / 100;

  const w = srcCanvas.width;
  const h = srcCanvas.height;
  if (w <= 0 || h <= 0) {
    throw new Error('Kích thước ảnh nguồn không hợp lệ.');
  }

  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error('Không thể đọc ngữ cảnh canvas.');
  const src = srcCtx.getImageData(0, 0, w, h).data;

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = w;
  outputCanvas.height = h;
  const outCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) throw new Error('Không thể tạo canvas kết quả.');
  const outImgData = outCtx.createImageData(w, h);
  const out = outImgData.data;
  out.set(src);

  const cx = face.noseX;
  const E = face.eyeY;
  const C = face.chinY;
  const D = C - E;

  // Dải dọc: dừng ngay tại cằm để không kéo méo vai áo
  const startY = Math.max(0, Math.floor(E + 0.12 * D));
  const endY = Math.min(h - 1, Math.ceil(C + 0.05 * D));

  const F_left = Math.max(1, cx - face.leftX);
  const F_right = Math.max(1, face.rightX - cx);

  // Lõi Cc mỗi bên tính theo base = 0.65 * F_left và mở rộng thêm đệm an toàn khoé miệng
  const hasMouthLeft = typeof face.mouthLeftX === 'number' && Number.isFinite(face.mouthLeftX);
  const base_left = 0.65 * F_left;
  const Cc_left = hasMouthLeft
    ? Math.min(0.8 * F_left, Math.max(base_left, Math.abs(face.mouthLeftX! - cx) + 0.15 * F_left))
    : base_left;

  const hasMouthRight = typeof face.mouthRightX === 'number' && Number.isFinite(face.mouthRightX);
  const base_right = 0.65 * F_right;
  const Cc_right = hasMouthRight
    ? Math.min(0.8 * F_right, Math.max(base_right, Math.abs(face.mouthRightX! - cx) + 0.15 * F_right))
    : base_right;

  // Lọc các mặt khác có khoảng dọc giao với [startY, endY]
  const relevantOtherFaces = (otherFaces || []).filter((o) => {
    const oD = o.chinY - o.eyeY;
    const oStartY = o.eyeY - 0.3 * oD;
    const oEndY = o.chinY + 0.35 * oD;
    return oStartY <= endY && oEndY >= startY;
  });

  // Bên phải: khoảng cách tới mép trái của mặt khác nằm bên phải (o.leftX > cx), có tính thêm phần tai/tóc 0.2*ow
  let roomRight = Infinity;
  for (const o of relevantOtherFaces) {
    if (o.leftX > cx) {
      const ow = o.rightX - o.leftX;
      roomRight = Math.min(roomRight, (o.leftX - 0.2 * ow) - cx);
    }
  }

  // Bên trái: khoảng cách tới mép phải của mặt khác nằm bên trái (o.rightX < cx), có tính thêm phần tai/tóc 0.2*ow
  let roomLeft = Infinity;
  for (const o of relevantOtherFaces) {
    if (o.rightX < cx) {
      const ow = o.rightX - o.leftX;
      roomLeft = Math.min(roomLeft, cx - (o.rightX + 0.2 * ow));
    }
  }

  let c_left = 1.8 * F_left;
  if (roomLeft !== Infinity) {
    c_left = Math.min(1.8 * F_left, roomLeft - 0.05 * F_left);
  }

  let c_right = 1.8 * F_right;
  if (roomRight !== Infinity) {
    c_right = Math.min(1.8 * F_right, roomRight - 0.05 * F_right);
  }

  // Nếu một bên không đủ khoảng không an toàn thì bỏ qua cả mặt để đảm bảo cân đối
  if (c_left < 1.2 * F_left || c_right < 1.2 * F_right) {
    outCtx.putImageData(outImgData, 0, 0);
    return {
      outputCanvas,
      changedPixelCount: 0,
      coreCount: 0,
      coreChanged: 0,
      skippedSides: 2,
      skippedFace: true,
    };
  }

  const wf_left = Math.min(0.6 * F_left, c_left - 0.9 * F_left);
  const b_left = c_left - wf_left;

  const wf_right = Math.min(0.6 * F_right, c_right - 0.9 * F_right);
  const b_right = c_right - wf_right;

  let changedPixelCount = 0;
  let coreCount = 0;
  let coreChanged = 0;

  for (let y = startY; y <= endY; y++) {
    const vy =
      smoothstep(E + 0.12 * D, C - 0.3 * D, y) *
      (1 - smoothstep(C - 0.3 * D, C + 0.05 * D, y));

    if (vy <= 0) continue;

    const rowOffset = y * w;

    const A_left = s * F_left * vy;
    const A_right = s * F_right * vy;

    // Xử lý bên trái (x <= cx, d = cx - x)
    const leftLimitX = Math.max(0, Math.floor(cx - c_left));
    for (let x = leftLimitX; x <= cx; x++) {
      const d = cx - x;
      if (d > c_left) continue;

      const idx = (rowOffset + x) * 4;

      // Pixel thuộc lõi (d <= Cc): KHÔNG nội suy, giữ nguyên pixel nguồn
      if (d <= Cc_left) {
        coreCount++;
        out[idx] = src[idx];
        out[idx + 1] = src[idx + 1];
        out[idx + 2] = src[idx + 2];
        out[idx + 3] = src[idx + 3];
        continue;
      }

      // Ánh xạ đơn điệu mượt mà
      const P =
        smoothstep(Cc_left, 0.9 * F_left, d) *
        (1 - smoothstep(b_left, c_left, d));
      const srcD = d + A_left * P;

      const sx = cx - srcD;
      const clampedSx = Math.max(0, Math.min(w - 1, sx));
      const x0 = Math.floor(clampedSx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fracX = clampedSx - x0;

      const idx0 = (rowOffset + x0) * 4;
      const idx1 = (rowOffset + x1) * 4;

      const a0 = src[idx0 + 3] / 255;
      const a1 = src[idx1 + 3] / 255;

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

    // Xử lý bên phải (x > cx, d = x - cx)
    const rightLimitX = Math.min(w - 1, Math.ceil(cx + c_right));
    const startRightX = Math.floor(cx) + 1;

    for (let x = startRightX; x <= rightLimitX; x++) {
      const d = x - cx;
      if (d > c_right) continue;

      const idx = (rowOffset + x) * 4;

      // Pixel thuộc lõi (d <= Cc): KHÔNG nội suy, giữ nguyên pixel nguồn
      if (d <= Cc_right) {
        coreCount++;
        out[idx] = src[idx];
        out[idx + 1] = src[idx + 1];
        out[idx + 2] = src[idx + 2];
        out[idx + 3] = src[idx + 3];
        continue;
      }

      // Ánh xạ đơn điệu mượt mà
      const P =
        smoothstep(Cc_right, 0.9 * F_right, d) *
        (1 - smoothstep(b_right, c_right, d));
      const srcD = d + A_right * P;

      const sx = cx + srcD;
      const clampedSx = Math.max(0, Math.min(w - 1, sx));
      const x0 = Math.floor(clampedSx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fracX = clampedSx - x0;

      const idx0 = (rowOffset + x0) * 4;
      const idx1 = (rowOffset + x1) * 4;

      const a0 = src[idx0 + 3] / 255;
      const a1 = src[idx1 + 3] / 255;

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

  // Rào chắn toán học tuyệt đối: vùng lõi mắt-mũi-miệng phải có sai khác = 0
  if (coreChanged !== 0) {
    throw new Error(
      `Phát hiện sai lệch tại vùng mắt-mũi-miệng (${coreChanged} px). Đã hủy thao tác để bảo vệ gương mặt.`
    );
  }

  outCtx.putImageData(outImgData, 0, 0);

  return {
    outputCanvas,
    changedPixelCount,
    coreCount,
    coreChanged,
    skippedSides: 0,
    skippedFace: false,
  };
}
