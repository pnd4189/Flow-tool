import { Flow } from 'flow-sdk';
import {
  AiEditMode,
  InspectionReport,
} from '../types';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export const AI_EDIT_MODES_CONFIG: Record<
  AiEditMode,
  {
    title: string;
    description: string;
    defaultInstruction: string;
    tooltip: string;
    samplePlaceholder: string;
    requiresPrompt?: boolean;
  }
> = {
  prompt_edit: {
    title: 'Chỉnh theo prompt',
    description: 'Chỉnh sửa chính xác vùng chọn theo mô tả chi tiết của bạn mà không có ngầm định xóa.',
    defaultInstruction:
      'Apply exactly the user\'s requested edit inside the intended editable region, keeping unrelated content unchanged.',
    tooltip: 'Chỉnh sửa trực tiếp theo mô tả của bạn trong vùng chọn. Bắt buộc nhập mô tả.',
    samplePlaceholder: 'Ví dụ: làm thon gọn eo tự nhiên 1-2cm, chỉnh lại nếp nhăn áo phía hông, giữ nguyên tư thế và nền...',
    requiresPrompt: true,
  },
  reshape_body: {
    title: 'Chỉnh dáng / thon gọn',
    description: 'Tinh chỉnh đường cong cơ thể, vòng eo, hông tự nhiên, bảo toàn giải phẫu, trang phục và khuôn mặt.',
    defaultInstruction:
      'Perform realistic, subtle anatomical body reshaping and waistline/abdomen contour slimming within the marked magenta region. Seamlessly adjust body silhouette contours while strictly preserving the person identity, authentic skin texture, clothing fabric weave, original pose, natural anatomy, and surrounding background geometry. NEVER erase the subject or replace with an empty background. Strictly protect original facial features and proportions.',
    tooltip: 'Chỉnh thon gọn eo, hông, vóc dáng tự nhiên, giữ nguyên trang phục và cấu trúc người.',
    samplePlaceholder: 'Ví dụ: làm gọn đường viền eo hai bên 5%, giữ nếp vải tự nhiên và background...',
    requiresPrompt: false,
  },
  remove_object: {
    title: 'Xóa đối tượng / người',
    description: 'Xóa sạch đối tượng đã chọn và tái tạo liền mạch nền xung quanh.',
    defaultInstruction:
      'Seamlessly remove the selected object/person marked in the editing guide. Fill the area naturally with continuation of the surrounding background textures, lighting, patterns, and style of the original image without altering the medium.',
    tooltip: 'Xóa sạch đối tượng, người hoặc rác thừa, giữ nguyên cấu trúc nền phía sau.',
    samplePlaceholder: 'Ví dụ: xóa người đi đường ở phía sau, giữ nguyên cấu trúc gạch lát...',
  },
  remove_text: {
    title: 'Xóa chữ không mong muốn',
    description: 'Xóa sạch văn bản, hình mờ, logo hoặc nhãn dán trong vùng chọn.',
    defaultInstruction:
      'Remove all text, watermarks, typography, and lettering from the marked region. Reconstruct the clean underlying surface, grain, and ambient shading matching the source art style with zero typographic artifacts.',
    tooltip: 'Làm sạch watermark, phụ đề, tem nhãn không mong muốn mà không làm mờ nền.',
    samplePlaceholder: 'Ví dụ: xóa số ngày tháng ở góc, khôi phục bề mặt...',
  },
  repair_damage: {
    title: 'Phục hồi vùng hỏng / trầy xước',
    description: 'Khôi phục vết rách, ố vàng, bụi bẩn hoặc trầy xước.',
    defaultInstruction:
      'Repair and restore the damaged or scratched area within the marked region. Reconstruct original pristine texture, smooth gradients, and source fidelity without changing style or medium.',
    tooltip: 'Khôi phục ảnh cũ, làm mờ vết xước hoặc đốm ố thời gian.',
    samplePlaceholder: 'Ví dụ: làm lành vết xước nứt trên áo khoác...',
  },
  replace_object: {
    title: 'Thay thế vật thể',
    description: 'Thay vật thể trong vùng chọn bằng một đối tượng hoàn toàn mới.',
    defaultInstruction:
      'Replace the object inside the marked region with the requested replacement. The replacement must match the scene lighting angle, shadow color, perspective, scale, medium, and rendering style of the source image perfectly.',
    tooltip: 'Thay thế túi xách, cốc nước, mũ, hoặc đồ trang sức bằng vật thể khác theo ý bạn.',
    samplePlaceholder: 'Ví dụ: thay chiếc balo đỏ bằng một cặp da công sở màu nâu cổ điển...',
  },
  add_object: {
    title: 'Thêm vật thể mới',
    description: 'Thêm đối tượng mới tự nhiên vào khoảng trống được chọn.',
    defaultInstruction:
      'Integrate the requested new object into the marked area. Cast realistic contact shadows onto the ground/surface, match ambient lighting, reflections, perspective, and original art medium.',
    tooltip: 'Thêm hoa, đồ vật trang trí hoặc đạo cụ vào vị trí bạn đã khoanh vùng.',
    samplePlaceholder: 'Ví dụ: thêm một bình hoa nhỏ đặt trên mặt bàn...',
  },
  change_material: {
    title: 'Đổi chất liệu / bề mặt',
    description: 'Biến đổi chất liệu (gỗ, da, kim loại, lụa, kính) nhưng giữ nguyên hình khối.',
    defaultInstruction:
      'Transform the surface material of the selected object inside the marked region. Keep exact form, contours, creases, and proportions while applying the new material finish matching the source medium.',
    tooltip: 'Đổi vải áo cotton thành lụa satin, vỏ điện thoại nhôm thành kính bóng mờ...',
    samplePlaceholder: 'Ví dụ: đổi áo len thành áo da bò đen bóng nhẹ có đường vân...',
  },
  recolor_local: {
    title: 'Đổi màu cục bộ chính xác',
    description: 'Thay đổi màu sắc cụ thể mà vẫn bảo toàn độ sáng tối và chi tiết.',
    defaultInstruction:
      'Recolor the marked region accurately with the requested hue and saturation. Retain original luminance values, highlights, wrinkles, shadows, and subtle textural nuances precisely within the existing art style.',
    tooltip: 'Đổi màu áo, màu xe, màu giày hoặc tóc mà giữ nguyên độ bóng và nếp gấp.',
    samplePlaceholder: 'Ví dụ: đổi màu váy từ trắng sang xanh ngọc lục bảo thẫm...',
  },
};

/**
 * Calculates the bounding box of effective editable pixels: (selection > 0 && protection == 0)
 */
export function computeEditableBoundingBox(
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement
): BoundingBox | null {
  const w = selectionMask.width;
  const h = selectionMask.height;

  const selCtx = selectionMask.getContext('2d', { willReadFrequently: true });
  const protCtx = protectionMask.getContext('2d', { willReadFrequently: true });
  if (!selCtx || !protCtx) return null;

  const selData = selCtx.getImageData(0, 0, w, h).data;
  const protData = protCtx.getImageData(0, 0, w, h).data;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = (row + x) * 4;
      const s = selData[idx];
      const p = protData[idx];

      if (s > 0 && p === 0) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (count === 0 || maxX < minX || maxY < minY) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

const SUPPORTED_ASPECTS: Array<{
  ratio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  numeric: number;
}> = [
  { ratio: '1:1', numeric: 1.0 },
  { ratio: '4:3', numeric: 4 / 3 },
  { ratio: '3:4', numeric: 3 / 4 },
  { ratio: '16:9', numeric: 16 / 9 },
  { ratio: '9:16', numeric: 9 / 16 },
];

export interface PaddedCropTransform {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  paddedW: number;
  paddedH: number;
  offsetX: number;
  offsetY: number;
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
}

export function calculateCropAndPaddingTransform(
  sourceW: number,
  sourceH: number,
  box: BoundingBox
): PaddedCropTransform {
  const padRatio = 0.35;
  const padX = Math.round(box.width * padRatio);
  const padY = Math.round(box.height * padRatio);

  const cropX = Math.max(0, box.minX - padX);
  const cropY = Math.max(0, box.minY - padY);
  const cropRight = Math.min(sourceW, box.maxX + 1 + padX);
  const cropBottom = Math.min(sourceH, box.maxY + 1 + padY);

  const cropW = Math.max(1, cropRight - cropX);
  const cropH = Math.max(1, cropBottom - cropY);

  const rawRatio = cropW / cropH;

  let bestAspect = SUPPORTED_ASPECTS[0];
  let minDiff = Math.abs(rawRatio - bestAspect.numeric);
  for (let i = 1; i < SUPPORTED_ASPECTS.length; i++) {
    const diff = Math.abs(rawRatio - SUPPORTED_ASPECTS[i].numeric);
    if (diff < minDiff) {
      minDiff = diff;
      bestAspect = SUPPORTED_ASPECTS[i];
    }
  }

  const targetRatio = bestAspect.numeric;
  let paddedW = cropW;
  let paddedH = cropH;

  if (rawRatio < targetRatio) {
    paddedW = Math.round(cropH * targetRatio);
  } else {
    paddedH = Math.round(cropW / targetRatio);
  }

  const offsetX = Math.round((paddedW - cropW) / 2);
  const offsetY = Math.round((paddedH - cropH) / 2);

  return {
    cropX,
    cropY,
    cropW,
    cropH,
    paddedW,
    paddedH,
    offsetX,
    offsetY,
    aspectRatio: bestAspect.ratio,
  };
}

export function preparePaddedReferences(
  sourceCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  transform: PaddedCropTransform
): { unmarkedCanvas: HTMLCanvasElement; markedGuideCanvas: HTMLCanvasElement } {
  const unmarkedCanvas = document.createElement('canvas');
  unmarkedCanvas.width = transform.paddedW;
  unmarkedCanvas.height = transform.paddedH;
  const uCtx = unmarkedCanvas.getContext('2d', { willReadFrequently: true });
  if (!uCtx) throw new Error('Không thể khởi tạo unmarked canvas');

  uCtx.fillStyle = '#181a1d';
  uCtx.fillRect(0, 0, transform.paddedW, transform.paddedH);

  uCtx.drawImage(
    sourceCanvas,
    transform.cropX,
    transform.cropY,
    transform.cropW,
    transform.cropH,
    transform.offsetX,
    transform.offsetY,
    transform.cropW,
    transform.cropH
  );

  const markedGuideCanvas = document.createElement('canvas');
  markedGuideCanvas.width = transform.paddedW;
  markedGuideCanvas.height = transform.paddedH;
  const mCtx = markedGuideCanvas.getContext('2d', { willReadFrequently: true });
  if (!mCtx) throw new Error('Không thể khởi tạo marked guide canvas');

  mCtx.drawImage(unmarkedCanvas, 0, 0);

  const sCtx = selectionMask.getContext('2d', { willReadFrequently: true });
  const pCtx = protectionMask.getContext('2d', { willReadFrequently: true });
  if (sCtx && pCtx) {
    const sData = sCtx.getImageData(
      transform.cropX,
      transform.cropY,
      transform.cropW,
      transform.cropH
    ).data;
    const pData = pCtx.getImageData(
      transform.cropX,
      transform.cropY,
      transform.cropW,
      transform.cropH
    ).data;

    const guideImgData = mCtx.getImageData(
      transform.offsetX,
      transform.offsetY,
      transform.cropW,
      transform.cropH
    );
    const gd = guideImgData.data;

    for (let i = 0; i < sData.length; i += 4) {
      const s = sData[i];
      const p = pData[i];
      if (s > 0 && p === 0) {
        const alpha = 0.85;
        gd[i] = Math.round(gd[i] * (1 - alpha) + 255 * alpha);
        gd[i + 1] = Math.round(gd[i + 1] * (1 - alpha) + 0 * alpha);
        gd[i + 2] = Math.round(gd[i + 2] * (1 - alpha) + 255 * alpha);
      }
    }
    mCtx.putImageData(guideImgData, transform.offsetX, transform.offsetY);
  }

  return { unmarkedCanvas, markedGuideCanvas };
}

/**
 * Maps generated crop back to source canvas with ratio verification.
 * Rejects severely mismatched generated aspect ratios before mapping.
 */
export function mapGeneratedCropToSource(
  sourceCanvas: HTMLCanvasElement,
  generatedCanvas: HTMLCanvasElement,
  transform: PaddedCropTransform
): HTMLCanvasElement {
  const genW = generatedCanvas.width;
  const genH = generatedCanvas.height;

  const expectedRatio = transform.paddedW / transform.paddedH;
  const actualRatio = genW / genH;

  // Check for severe aspect ratio mismatch (> 18% difference)
  if (Math.abs(expectedRatio - actualRatio) / expectedRatio > 0.18) {
    throw new Error(
      `Tỷ lệ ảnh AI trả về (${genW}x${genH}) không khớp với khung tham chiếu yêu cầu (${transform.paddedW}x${transform.paddedH}).`
    );
  }

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = sourceCanvas.width;
  fullCanvas.height = sourceCanvas.height;
  const fCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
  if (!fCtx) throw new Error('Không thể khởi tạo canvas map-back');

  fCtx.drawImage(sourceCanvas, 0, 0);

  const scaleX = genW / transform.paddedW;
  const scaleY = genH / transform.paddedH;

  const srcGenCropX = Math.round(transform.offsetX * scaleX);
  const srcGenCropY = Math.round(transform.offsetY * scaleY);
  const srcGenCropW = Math.round(transform.cropW * scaleX);
  const srcGenCropH = Math.round(transform.cropH * scaleY);

  fCtx.imageSmoothingEnabled = true;
  fCtx.drawImage(
    generatedCanvas,
    srcGenCropX,
    srcGenCropY,
    srcGenCropW,
    srcGenCropH,
    transform.cropX,
    transform.cropY,
    transform.cropW,
    transform.cropH
  );

  return fullCanvas;
}

/**
 * Strict composite enforcing invariants:
 * - Any protectionMask > 0 copies exact source RGBA verbatim.
 * - Outside selectionMask copies exact source RGBA verbatim.
 * - Feathering applies only to editable unprotected edges.
 * - Measures exact changed pixels via any RGBA inequality between composited output and source bytes.
 */
export function compositeAiEditResult(
  sourceCanvas: HTMLCanvasElement,
  mappedAiCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  blendStrength = 1.0
): {
  compositedCanvas: HTMLCanvasElement;
  protectedPreservedCount: number;
  outsideMaskPreservedCount: number;
  editableCount: number;
  changedPixelCount: number;
} {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  const output = document.createElement('canvas');
  output.width = w;
  output.height = h;
  const oCtx = output.getContext('2d', { willReadFrequently: true });
  if (!oCtx) throw new Error('Lỗi khởi tạo output canvas');

  const srcData = sourceCanvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const aiData = mappedAiCanvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const selData = selectionMask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const protData = protectionMask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;

  const outImgData = oCtx.createImageData(w, h);
  const out = outImgData.data;

  let protectedPreservedCount = 0;
  let outsideMaskPreservedCount = 0;
  let editableCount = 0;
  let changedPixelCount = 0;

  const total = w * h;
  const strengthClamped = Math.max(0, Math.min(1, blendStrength));

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const p = protData[idx];

    // INVARIANT 1: Any protection value > 0 preserves exact source RGBA
    if (p > 0) {
      protectedPreservedCount++;
      out[idx] = srcData[idx];
      out[idx + 1] = srcData[idx + 1];
      out[idx + 2] = srcData[idx + 2];
      out[idx + 3] = srcData[idx + 3];
      continue;
    }

    const s = selData[idx];
    // INVARIANT 2: Outside selection preserves exact source RGBA
    if (s === 0) {
      outsideMaskPreservedCount++;
      out[idx] = srcData[idx];
      out[idx + 1] = srcData[idx + 1];
      out[idx + 2] = srcData[idx + 2];
      out[idx + 3] = srcData[idx + 3];
      continue;
    }

    // Editable pixel: s > 0 && p === 0. Feather applies here only.
    editableCount++;
    const alphaNorm = (s / 255) * strengthClamped;

    const newR = Math.round(srcData[idx] * (1 - alphaNorm) + aiData[idx] * alphaNorm);
    const newG = Math.round(srcData[idx + 1] * (1 - alphaNorm) + aiData[idx + 1] * alphaNorm);
    const newB = Math.round(srcData[idx + 2] * (1 - alphaNorm) + aiData[idx + 2] * alphaNorm);
    const newA = srcData[idx + 3];

    out[idx] = newR;
    out[idx + 1] = newG;
    out[idx + 2] = newB;
    out[idx + 3] = newA;

    // Exact changed pixel count using actual composited output bytes vs source bytes (any RGBA inequality)
    if (
      out[idx] !== srcData[idx] ||
      out[idx + 1] !== srcData[idx + 1] ||
      out[idx + 2] !== srcData[idx + 2] ||
      out[idx + 3] !== srcData[idx + 3]
    ) {
      changedPixelCount++;
    }
  }

  oCtx.putImageData(outImgData, 0, 0);

  return {
    compositedCanvas: output,
    protectedPreservedCount,
    outsideMaskPreservedCount,
    editableCount,
    changedPixelCount,
  };
}

export function analyzeEditArtifacts(
  canvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement
): { hasMagentaArtifacts: boolean; magentaCount: number } {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const selCtx = selectionMask.getContext('2d', { willReadFrequently: true });
  if (!ctx || !selCtx) return { hasMagentaArtifacts: false, magentaCount: 0 };

  const data = ctx.getImageData(0, 0, w, h).data;
  const selData = selCtx.getImageData(0, 0, w, h).data;
  let magentaCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (selData[i] > 0) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 210 && b > 210 && g < 40) {
        magentaCount++;
      }
    }
  }

  return {
    hasMagentaArtifacts: magentaCount > 15,
    magentaCount,
  };
}

/**
 * Honest AI inspection report:
 * Sends actual before and after thumbnails with the real user request.
 * On failure or parse error, returns status 'UNAVAILABLE' with score: null,
 * no fabricated scores and no false claims of "no seams".
 * Pixel preservation is verified by direct numerical comparison.
 */
export async function inspectAiEditPreview(
  beforeCanvas: HTMLCanvasElement,
  afterCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  protectionMask: HTMLCanvasElement,
  mode: AiEditMode,
  userPrompt: string
): Promise<InspectionReport> {
  // Step 1: Direct pixel verification by comparison
  const w = beforeCanvas.width;
  const h = beforeCanvas.height;
  const bData = beforeCanvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const aData = afterCanvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const pData = protectionMask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const sData = selectionMask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;

  let protectedModified = 0;
  let outsideModified = 0;
  let editableModified = 0;

  const total = w * h;
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const isDifferent =
      Math.abs(bData[idx] - aData[idx]) > 2 ||
      Math.abs(bData[idx + 1] - aData[idx + 1]) > 2 ||
      Math.abs(bData[idx + 2] - aData[idx + 2]) > 2;

    if (pData[idx] > 0) {
      if (isDifferent) protectedModified++;
    } else if (sData[idx] === 0) {
      if (isDifferent) outsideModified++;
    } else {
      if (isDifferent) editableModified++;
    }
  }

  const pixelComparison = {
    protectedModified,
    outsideModified,
    editableModified,
  };

  try {
    const maxDim = 512;
    const scale = Math.min(1, maxDim / Math.max(w, h));

    const makeThumb = (source: HTMLCanvasElement): string => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(source.width * scale));
      c.height = Math.max(1, Math.round(source.height * scale));
      const ctx = c.getContext('2d');
      if (ctx) ctx.drawImage(source, 0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1];
    };

    const beforeBase64 = makeThumb(beforeCanvas);
    const afterBase64 = makeThumb(afterCanvas);

    const prompt = `So sánh ảnh TRƯỚC (hình 1) và ảnh SAU (hình 2) cho tác vụ chỉnh sửa "${AI_EDIT_MODES_CONFIG[mode].title}".
Yêu cầu của người dùng: "${userPrompt.trim() || AI_EDIT_MODES_CONFIG[mode].defaultInstruction}".
Đánh giá khách quan chất lượng hòa trộn, đường viền, và tính tự nhiên của vùng sửa.
Trả về KẾT QUẢ DUY NHẤT là 1 đối tượng JSON thuần túy (không kèm markdown):
{
  "score": 88,
  "summary": "Mô tả ngắn gọn khách quan",
  "hasMagentaArtifacts": false,
  "hasSeamsDetected": false,
  "alignmentRating": "EXCELLENT",
  "advice": "Gợi ý nếu cần"
}
alignmentRating chỉ có thể là: "EXCELLENT" | "FAIR" | "POOR".`;

    const res = await Flow.generate.text(prompt, {
      systemInstruction: 'Bạn là chuyên gia kiểm tra chất lượng xử lý ảnh kỹ thuật số. Luôn trả về JSON hợp lệ.',
      thinkingLevel: 'low',
      images: [
        { base64: beforeBase64, mimeType: 'image/png' },
        { base64: afterBase64, mimeType: 'image/png' },
      ],
    });

    const match = (res.text || '').match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (
        typeof parsed.score === 'number' &&
        parsed.score >= 0 &&
        parsed.score <= 100 &&
        ['EXCELLENT', 'FAIR', 'POOR'].includes(parsed.alignmentRating)
      ) {
        return {
          score: parsed.score,
          status: 'VERIFIED',
          summary: parsed.summary || 'Đã phân tích kiểm tra trực quan.',
          hasMagentaArtifacts: Boolean(parsed.hasMagentaArtifacts),
          hasSeamsDetected: Boolean(parsed.hasSeamsDetected),
          alignmentRating: parsed.alignmentRating,
          advice: parsed.advice || undefined,
          pixelComparison,
        };
      }
    }
  } catch (err) {
    console.warn('Advisory inspection API failed or returned invalid format:', err);
  }

  // Explicit unavailable report on failure — NO fabricated scores
  return {
    score: null,
    status: 'UNAVAILABLE',
    summary: 'Đánh giá AI tự động chưa khả dụng cho lần tạo này. Tính bất biến pixel được bảo đảm bởi mã nguồn.',
    hasMagentaArtifacts: false,
    hasSeamsDetected: false,
    alignmentRating: 'UNKNOWN',
    advice: 'Vui lòng phóng to kiểm tra vùng sửa trước khi Áp dụng.',
    pixelComparison,
  };
}
