import { Flow } from 'flow-sdk';
import { NormalizedFaceBox } from '../types';
import { segmentCandidatesAtPoint } from './segmentationService';

/**
 * Analyzes an image with Flow.generate.text to locate all faces (real or drawn)
 * and returns validated normalized bounding boxes (0..1000 coordinate space).
 * Throws an Error if JSON is malformed, request times out, or coordinates are invalid.
 * Empty array [] is ONLY returned if the model explicitly returned valid JSON [] (no faces detected).
 */
export async function detectFacesWithAI(
  sourceCanvas: HTMLCanvasElement,
  onProgress?: (msg: string) => void
): Promise<NormalizedFaceBox[]> {
  onProgress?.('Đang chuẩn bị ảnh gửi phân tích khuôn mặt...');

  // Scale down for fast responsive vision analysis (max 1024px)
  const maxDim = 1024;
  let sampleCanvas = sourceCanvas;
  if (Math.max(sourceCanvas.width, sourceCanvas.height) > maxDim) {
    const scale = maxDim / Math.max(sourceCanvas.width, sourceCanvas.height);
    sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = Math.round(sourceCanvas.width * scale);
    sampleCanvas.height = Math.round(sourceCanvas.height * scale);
    const sCtx = sampleCanvas.getContext('2d');
    if (sCtx) {
      sCtx.drawImage(sourceCanvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
    }
  }

  const dataUrl = sampleCanvas.toDataURL('image/jpeg', 0.88);
  const base64 = dataUrl.split(',')[1];

  onProgress?.('AI đang phân tích nhận diện khuôn mặt (Flow text vision)...');

  const prompt = `Phát hiện TẤT CẢ khuôn mặt người (kể cả ảnh thật, tranh vẽ, hoạt hình, góc nghiêng hoặc xa).
Trả về KẾT QUẢ DUY NHẤT là một mảng JSON thuần túy (không kèm giải thích markdown, không code block) theo mẫu:
[
  {"ymin": 120, "xmin": 340, "ymax": 480, "xmax": 620}
]
Toạ độ ymin, xmin, ymax, xmax chuẩn hóa từ 0 đến 1000 theo chiều cao và chiều rộng của ảnh.
Nếu không có khuôn mặt nào, trả về đúng: []`;

  const systemInstruction =
    'Bạn là chuyên gia thị giác máy tính chuyên phát hiện vùng khuôn mặt. Chỉ trả về JSON mảng toạ độ 0-1000.';

  // 120s timeout enforcement
  const TIMEOUT_MS = 120000;
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Yêu cầu phân tích khuôn mặt quá thời gian cho phép (120s).'));
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
  onProgress?.('Đang xác thực toạ độ khuôn mặt...');

  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Dữ liệu phân tích khuôn mặt không đúng định dạng JSON: ' + rawText.slice(0, 80));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error('Không thể phân tích cú pháp JSON khuôn mặt: ' + (err instanceof Error ? err.message : String(err)));
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Dữ liệu phân tích khuôn mặt không phải là danh sách mảng JSON.');
  }

  // If explicit empty array [], it means none detected legitimately
  if (parsed.length === 0) {
    return [];
  }

  const validatedBoxes: NormalizedFaceBox[] = [];

  for (let idx = 0; idx < parsed.length; idx++) {
    const item = parsed[idx];
    if (!item || typeof item !== 'object') {
      throw new Error(`Phần tử thứ ${idx + 1} trong danh sách khuôn mặt không hợp lệ.`);
    }

    const { ymin, xmin, ymax, xmax } = item as any;

    if (
      typeof ymin !== 'number' || !Number.isFinite(ymin) ||
      typeof xmin !== 'number' || !Number.isFinite(xmin) ||
      typeof ymax !== 'number' || !Number.isFinite(ymax) ||
      typeof xmax !== 'number' || !Number.isFinite(xmax)
    ) {
      throw new Error(`Toạ độ khuôn mặt ở vị trí ${idx + 1} chứa giá trị không hợp lệ hoặc thiếu.`);
    }

    const boundedYmin = Math.max(0, Math.min(1000, ymin));
    const boundedXmin = Math.max(0, Math.min(1000, xmin));
    const boundedYmax = Math.max(0, Math.min(1000, ymax));
    const boundedXmax = Math.max(0, Math.min(1000, xmax));

    if (boundedYmax <= boundedYmin || boundedXmax <= boundedXmin) {
      throw new Error(`Toạ độ hộp khuôn mặt ${idx + 1} có kích thước rỗng hoặc nghịch đảo.`);
    }

    validatedBoxes.push({
      ymin: boundedYmin,
      xmin: boundedXmin,
      ymax: boundedYmax,
      xmax: boundedXmax,
    });
  }

  return validatedBoxes;
}

/**
 * Builds high-fidelity semantic face protection mask by:
 * 1. Running the already-working SlimSAM at the center of each face box on the SAME source/revision.
 * 2. Reusing cached embeddings.
 * 3. Combining valid head/face candidates containing the point, constrained to the conservative face region.
 * 4. Excluding original BACKGROUND pixels while preserving original facial pixels.
 * 5. Authoritative manual protection strokes are preserved and never silently trimmed.
 *
 * If SlimSAM segmentation fails for a face, it signals refinement needed without painting a fake successful mask.
 */
export async function buildPreciseSemanticFaceProtection(
  sourceCanvas: HTMLCanvasElement,
  existingProtectionCanvas: HTMLCanvasElement,
  boxes: NormalizedFaceBox[],
  documentRevision: string | number,
  onProgress?: (msg: string) => void
): Promise<{
  success: boolean;
  facesProtected: number;
  needsManualRefinement: boolean;
  message: string;
}> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const ctx = existingProtectionCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || w <= 0 || h <= 0) {
    return {
      success: false,
      facesProtected: 0,
      needsManualRefinement: true,
      message: 'Không thể khởi tạo lớp bảo vệ.',
    };
  }

  // Preserve existing authoritative manual strokes
  const existingData = ctx.getImageData(0, 0, w, h);
  const ed = existingData.data;

  // New automatic mask buffer initialized to 0
  const autoCanvas = document.createElement('canvas');
  autoCanvas.width = w;
  autoCanvas.height = h;
  const autoCtx = autoCanvas.getContext('2d', { willReadFrequently: true });
  if (!autoCtx) {
    return {
      success: false,
      facesProtected: 0,
      needsManualRefinement: true,
      message: 'Lỗi bộ nhớ canvas.',
    };
  }
  const autoData = autoCtx.createImageData(w, h);
  const ad = autoData.data;

  let facesProtected = 0;
  let needsManualRefinement = false;

  for (let bIdx = 0; bIdx < boxes.length; bIdx++) {
    const box = boxes[bIdx];
    const normCenterX = (box.xmin + box.xmax) / 2000;
    const normCenterY = (box.ymin + box.ymax) / 2000;

    onProgress?.(`Đang phân tích chi tiết khuôn mặt ${bIdx + 1}/${boxes.length} bằng SlimSAM CPU...`);

    try {
      // Run SlimSAM at the face-box center on the SAME source/revision to reuse embeddings
      const candidates = await segmentCandidatesAtPoint(
        sourceCanvas,
        normCenterX,
        normCenterY,
        onProgress,
        documentRevision
      );

      if (!candidates || candidates.length === 0) {
        needsManualRefinement = true;
        continue;
      }

      // Conservative spatial bounds for face region: expand box slightly (25%) but not full background
      const boxW = ((box.xmax - box.xmin) / 1000) * w;
      const boxH = ((box.ymax - box.ymin) / 1000) * h;
      const cX = normCenterX * w;
      const cY = normCenterY * h;

      const conservativeHalfW = (boxW / 2) * 1.35;
      const conservativeHalfH = (boxH / 2) * 1.45;

      const minX = Math.max(0, Math.floor(cX - conservativeHalfW));
      const maxX = Math.min(w - 1, Math.ceil(cX + conservativeHalfW));
      const minY = Math.max(0, Math.floor(cY - conservativeHalfH));
      const maxY = Math.min(h - 1, Math.ceil(cY + conservativeHalfH));

      // Choose candidates that contain the face point:
      // small/medium represent face parts; large represents head/body.
      // We combine valid face candidates and intersect with conservative spatial window
      // so semantic support strictly excludes original BACKGROUND.
      const candidateContexts = candidates.map((c) =>
        c.canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h)
      );

      // We verify the candidate actually selected the center pixel
      const centerPixelIdx = (Math.round(cY) * w + Math.round(cX)) * 4;
      let validFound = false;

      for (let y = minY; y <= maxY; y++) {
        const rowOffset = y * w;
        for (let x = minX; x <= maxX; x++) {
          const idx = (rowOffset + x) * 4;

          // Check if distance from center conforms to face oval
          const dx = (x - cX) / conservativeHalfW;
          const dy = (y - cY) / conservativeHalfH;
          const insideConservativeOval = dx * dx + dy * dy <= 1.0;

          if (!insideConservativeOval) continue;

          // Combine support from candidates that cover the center point
          let semanticSupport = 0;
          for (let ci = 0; ci < candidates.length; ci++) {
            const candImg = candidateContexts[ci];
            if (!candImg) continue;
            // Only consider candidates that actually segment the face center
            if (candImg.data[centerPixelIdx] > 100) {
              const val = candImg.data[idx];
              if (val > semanticSupport) {
                semanticSupport = val;
              }
            }
          }

          // If semantic segmentation covers this pixel inside conservative face boundary,
          // protect it! Background is excluded because candidates drop off at the head/hair boundary.
          if (semanticSupport > 50) {
            ad[idx] = 255;
            ad[idx + 1] = 255;
            ad[idx + 2] = 255;
            ad[idx + 3] = 255;
            validFound = true;
          }
        }
      }

      if (validFound) {
        facesProtected++;
      } else {
        // If SAM produced no semantic overlap at center, mark manual refinement needed;
        // Never paint a fake successful mask or rectangular fallback.
        needsManualRefinement = true;
      }
    } catch {
      needsManualRefinement = true;
    }
  }

  // Combine automatic protection with pre-existing authoritative manual protection strokes:
  // Manual strokes are preserved and never trimmed.
  const total = w * h;
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const manualVal = ed[idx];
    const autoVal = ad[idx];
    const combinedVal = Math.max(manualVal, autoVal);

    ed[idx] = combinedVal;
    ed[idx + 1] = combinedVal;
    ed[idx + 2] = combinedVal;
    ed[idx + 3] = 255;
  }

  ctx.putImageData(existingData, 0, 0);

  let msg = `Đã bảo vệ ngữ nghĩa cho ${facesProtected}/${boxes.length} khuôn mặt.`;
  if (needsManualRefinement) {
    msg += ' Một số vùng đầu cần tinh chỉnh thêm bằng bút +B.Vệ.';
  }

  return {
    success: facesProtected > 0 || !needsManualRefinement,
    facesProtected,
    needsManualRefinement,
    message: msg,
  };
}
