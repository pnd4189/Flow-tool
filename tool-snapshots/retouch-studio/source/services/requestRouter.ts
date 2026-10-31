import { Flow } from 'flow-sdk';
import { ColorAdjustmentParams } from '../types';

export type RoutedOp =
  | { op: 'face_slim'; strength: number } // 3..15
  | { op: 'body_slim'; strength: number } // 5..30
  | { op: 'auto_enhance' }
  | { op: 'color'; params: Partial<ColorAdjustmentParams> }
  | { op: 'blur_background'; radius: number }
  | { op: 'remove_background' }
  | { op: 'ai_edit'; reason: string };

/**
 * Trích xuất số phần trăm N% (nếu có) từ chuỗi văn bản
 */
export function extractPercentage(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (match) {
    const val = parseFloat(match[1]);
    if (!Number.isNaN(val)) return Math.round(val);
  }
  return null;
}

/**
 * Helper so NGUYÊN TỪ hỗ trợ Unicode (giữ nguyên có dấu, không match chuỗi con)
 */
export const hasWord = (s: string, words: string[]): boolean => {
  if (words.length === 0) return false;
  // Sắp xếp từ dài trước để ưu tiên so sánh cụm nhiều từ
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const pattern = `(?<![\\p{L}\\p{M}\\d])(?:${sorted.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{M}\\d])`;
  return new RegExp(pattern, 'iu').test(s);
};

// Từ khóa mặt
const FACE_WORDS = [
  'mặt',
  'khuôn mặt',
  'gương mặt',
  'má',
  'gò má',
  'cằm',
  'hàm',
  'quai hàm',
  'face',
  'cheek',
  'cheeks',
  'jaw',
  'jawline',
  'chin',
  'v-line',
  'vline',
];

// Cụm từ loại trừ khi "mặt" nằm trong ngữ cảnh khác (không phải mặt người)
const FACE_EXCLUSION_PHRASES = [
  'mặt trời',
  'mặt nước',
  'mặt đất',
  'mặt bàn',
  'mặt hồ',
  'mặt biển',
  'bề mặt',
  'mặt tiền',
];

// Từ khóa thon gọn
const SLIM_WORDS = [
  'gọn',
  'gọn lại',
  'gọn hơn',
  'thon',
  'thon gọn',
  'nhỏ lại',
  'nhỏ hơn',
  'bớt béo',
  'đỡ béo',
  'bớt mập',
  'đỡ mập',
  'slim',
  'slimmer',
  'thin',
  'thinner',
  'v-line',
  'vline',
];

// Từ khóa thân
const BODY_WORDS = [
  'bụng',
  'eo',
  'vòng eo',
  'thân',
  'thân hình',
  'dáng',
  'người',
  'body',
  'waist',
  'belly',
  'tummy',
];

/**
 * Kiểm tra xem trong một đoạn văn bản (đã loại trừ ngữ cảnh phi-mặt) có chứa từ chỉ mặt người hay không
 */
export function hasFaceContext(text: string): boolean {
  let cleaned = text.normalize('NFC').toLowerCase();
  for (const phrase of FACE_EXCLUSION_PHRASES) {
    cleaned = cleaned.replaceAll(phrase, ' ');
  }
  return hasWord(cleaned, FACE_WORDS);
}

/**
 * Định tuyến theo luật (Rule-based routing):
 * 1. Chuẩn hóa text = raw.normalize('NFC').toLowerCase().
 * 2. Tách câu thành các vế theo /[,;.\n]+|\s+và\s+|\s+and\s+/; mỗi vế xét riêng, gộp kết quả.
 * 3. face_slim: CHỈ khi trong CÙNG một vế có từ mặt VÀ từ thon gọn (sau khi loại trừ mặt trời, mặt đất,...).
 * 4. body_slim: chỉ khi CÙNG vế có từ thân VÀ từ thon gọn, VÀ vế đó KHÔNG có từ mặt.
 * 5. Các nhóm màu/nền/tự động dùng hasWord trên chuỗi có dấu.
 */
export function routeByRules(text: string): RoutedOp[] | null {
  const raw = text.trim();
  if (!raw) return null;

  const normalized = raw.normalize('NFC').toLowerCase();

  // Tách các vế theo dấu phẩy, chấm, chấm phẩy, xuống dòng, liên từ 'và', 'and'
  const clauses = normalized
    .split(/[,;.\n]+|\s+và\s+|\s+and\s+/iu)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (clauses.length === 0) return null;

  let hasFaceSlim = false;
  let faceSlimStrength = 8;

  let hasBodySlim = false;
  let bodySlimStrength = 15;

  let hasAutoEnhance = false;

  const colorParams: Partial<ColorAdjustmentParams> = {};
  let hasColor = false;

  let hasBlurBg = false;
  let hasRemoveBg = false;

  for (const clause of clauses) {
    const clausePct = extractPercentage(clause);

    // Tiền xử lý vế: loại trừ các cụm "mặt trời", "mặt nước", "mặt đất",...
    let clauseForFace = clause;
    for (const phrase of FACE_EXCLUSION_PHRASES) {
      clauseForFace = clauseForFace.replaceAll(phrase, ' ');
    }

    const clauseHasFace = hasWord(clauseForFace, FACE_WORDS);
    const clauseHasSlim = hasWord(clause, SLIM_WORDS);
    const clauseHasBody = hasWord(clause, BODY_WORDS);

    // 1. Mặt (face_slim): CHỈ khi trong CÙNG một vế có từ mặt VÀ từ thon gọn
    if (clauseHasFace && clauseHasSlim) {
      hasFaceSlim = true;
      if (clausePct !== null) {
        faceSlimStrength = Math.max(3, Math.min(15, clausePct));
      }
    }

    // 2. Thân (body_slim): chỉ khi trong CÙNG vế có từ thân VÀ từ thon gọn, VÀ vế đó KHÔNG có từ mặt
    if (clauseHasBody && clauseHasSlim && !clauseHasFace) {
      hasBodySlim = true;
      if (clausePct !== null) {
        bodySlimStrength = Math.max(5, Math.min(30, clausePct));
      }
    }

    // 3. Đẹp tổng thể (auto_enhance)
    if (
      hasWord(clause, [
        'tự động',
        'làm đẹp',
        'đẹp hơn',
        'chỉnh màu tự động',
        'auto enhance',
        'cân bằng',
        'cân bằng sáng',
      ])
    ) {
      hasAutoEnhance = true;
    }

    // 4. Màu & ánh sáng
    // Sáng hơn / tối hơn
    if (hasWord(clause, ['sáng hơn', 'sáng lên', 'tăng sáng', 'brighten', 'sáng'])) {
      colorParams.exposure = (colorParams.exposure || 0) + 20;
      hasColor = true;
    } else if (hasWord(clause, ['tối hơn', 'tối đi', 'giảm sáng', 'darker', 'tối'])) {
      colorParams.exposure = (colorParams.exposure || 0) - 20;
      hasColor = true;
    }

    // Tương phản / rõ hơn
    if (hasWord(clause, ['tương phản', 'rõ hơn', 'rõ nét', 'contrast'])) {
      colorParams.contrast = (colorParams.contrast || 0) + 20;
      hasColor = true;
    }

    // Ấm hơn / lạnh hơn
    if (hasWord(clause, ['ấm hơn', 'ấm lên', 'warmer', 'ấm'])) {
      colorParams.temperature = (colorParams.temperature || 0) + 20;
      hasColor = true;
    } else if (hasWord(clause, ['lạnh hơn', 'mát hơn', 'cooler', 'lạnh', 'mát'])) {
      colorParams.temperature = (colorParams.temperature || 0) - 20;
      hasColor = true;
    }

    // Rực / tươi màu / nhạt màu
    if (hasWord(clause, ['rực hơn', 'rực rỡ', 'rực', 'tươi màu', 'đậm màu', 'saturate', 'saturated'])) {
      colorParams.saturation = (colorParams.saturation || 0) + 20;
      hasColor = true;
    } else if (hasWord(clause, ['nhạt màu', 'giảm màu', 'desaturate', 'desaturated'])) {
      colorParams.saturation = (colorParams.saturation || 0) - 20;
      hasColor = true;
    }

    // Làm nét
    if (hasWord(clause, ['nét hơn', 'sắc nét', 'làm nét', 'sharpen'])) {
      colorParams.sharpen = 30;
      hasColor = true;
    }

    // Giảm nhiễu / mịn ảnh
    if (hasWord(clause, ['giảm nhiễu', 'khử nhiễu', 'mịn ảnh', 'denoise'])) {
      colorParams.denoise = 30;
      hasColor = true;
    }

    // 5. Nền (Background)
    if (hasWord(clause, ['tách nền', 'xoá nền', 'xóa nền', 'remove background', 'nền trong suốt'])) {
      hasRemoveBg = true;
    } else {
      const isBlurAction = hasWord(clause, ['mờ', 'xoá phông', 'xóa phông', 'bokeh', 'blur']);
      const isBgTarget = hasWord(clause, ['nền', 'phông', 'hậu cảnh', 'background']);
      if (isBlurAction && isBgTarget) {
        hasBlurBg = true;
      }
    }
  }

  const ops: RoutedOp[] = [];

  if (hasFaceSlim) {
    ops.push({ op: 'face_slim', strength: faceSlimStrength });
  }

  if (hasBodySlim) {
    ops.push({ op: 'body_slim', strength: bodySlimStrength });
  }

  if (hasAutoEnhance) {
    ops.push({ op: 'auto_enhance' });
  }

  if (hasColor) {
    ops.push({ op: 'color', params: colorParams });
  }

  if (hasRemoveBg) {
    ops.push({ op: 'remove_background' });
  } else if (hasBlurBg) {
    ops.push({ op: 'blur_background', radius: 14 });
  }

  return ops.length > 0 ? ops : null;
}

/**
 * Định tuyến bằng Flow.generate.text khi không khớp các quy tắc regex có sẵn.
 * Sau khi nhận JSON, nếu có op 'face_slim' mà văn bản gốc không có từ mặt thì BỎ op đó
 * (AI tuyệt đối không được tự ý sửa mặt khi người dùng không yêu cầu).
 */
export async function routeWithAI(text: string): Promise<RoutedOp[]> {
  const prompt = `Phân loại yêu cầu chỉnh sửa ảnh sau thành danh sách thao tác (JSON array):
Yêu cầu: "${text}"

Các kiểu thao tác có sẵn:
1. {"op": "face_slim", "strength": number (3..15)}: Làm thon gọn mặt, cằm, má, V-line. CHỈ CHỌN KHI YÊU CẦU NÊU RÕ VÙNG MẶT/MÁ/CẰM/HÀM.
2. {"op": "body_slim", "strength": number (5..30)}: Thon gọn eo, bụng, thân người.
3. {"op": "auto_enhance"}: Tự động cân bằng sáng/màu/tương phản.
4. {"op": "color", "params": { "exposure": number (-100..100), "contrast": number, "saturation": number, "temperature": number, "sharpen": number (0..100), "denoise": number (0..100) }}: Chỉnh màu sắc hoặc độ nét.
5. {"op": "blur_background", "radius": 14}: Làm mờ phông nền/bokeh.
6. {"op": "remove_background"}: Tách nền trong suốt.
7. {"op": "ai_edit", "reason": "..."}: Yêu cầu vẽ thêm, xóa vật thể, thay đổi trang phục, đổi kiểu tóc, sửa chi tiết phức tạp mà các bộ lọc trên không thể làm được.

YÊU CẦU QUAN TRỌNG:
- CHỈ trả về mảng JSON thuần túy (không markdown, không giải thích).
- Ví dụ: [{"op": "face_slim", "strength": 8}] hoặc [{"op": "ai_edit", "reason": "Xóa cột điện"}]`;

  const TIMEOUT_MS = 30000;
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Phân loại AI quá thời gian 30s.')), TIMEOUT_MS);
  });

  try {
    const resPromise = Flow.generate.text(prompt, {
      systemInstruction: 'Bạn là bộ định tuyến tác vụ ảnh. Chỉ trả về JSON mảng thao tác hợp lệ.',
      thinkingLevel: 'low',
    });

    const res = await Promise.race([resPromise, timeoutPromise]);
    const rawText = (res.text || '').trim();
    const match = rawText.match(/\[[\s\S]*\]/);
    if (!match) {
      return [{ op: 'ai_edit', reason: 'yêu cầu phức tạp cần AI xử lý' }];
    }

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{ op: 'ai_edit', reason: 'không phân loại được' }];
    }

    // Kiểm tra xem văn bản gốc có thực sự đề cập đến mặt người hay không
    const userMentionedFace = hasFaceContext(text);

    const validated: RoutedOp[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const op = item.op;
      if (op === 'face_slim') {
        // Bắt buộc bỏ face_slim nếu người dùng không yêu cầu sửa mặt
        if (!userMentionedFace) {
          continue;
        }
        const s = typeof item.strength === 'number' ? Math.max(3, Math.min(15, Math.round(item.strength))) : 8;
        validated.push({ op: 'face_slim', strength: s });
      } else if (op === 'body_slim') {
        const s = typeof item.strength === 'number' ? Math.max(5, Math.min(30, Math.round(item.strength))) : 15;
        validated.push({ op: 'body_slim', strength: s });
      } else if (op === 'auto_enhance') {
        validated.push({ op: 'auto_enhance' });
      } else if (op === 'color') {
        const p = item.params || {};
        validated.push({
          op: 'color',
          params: {
            exposure: typeof p.exposure === 'number' ? Math.max(-100, Math.min(100, p.exposure)) : undefined,
            contrast: typeof p.contrast === 'number' ? Math.max(-100, Math.min(100, p.contrast)) : undefined,
            saturation: typeof p.saturation === 'number' ? Math.max(-100, Math.min(100, p.saturation)) : undefined,
            temperature: typeof p.temperature === 'number' ? Math.max(-100, Math.min(100, p.temperature)) : undefined,
            sharpen: typeof p.sharpen === 'number' ? Math.max(0, Math.min(100, p.sharpen)) : undefined,
            denoise: typeof p.denoise === 'number' ? Math.max(0, Math.min(100, p.denoise)) : undefined,
          },
        });
      } else if (op === 'blur_background') {
        validated.push({ op: 'blur_background', radius: 14 });
      } else if (op === 'remove_background') {
        validated.push({ op: 'remove_background' });
      } else if (op === 'ai_edit') {
        validated.push({ op: 'ai_edit', reason: String(item.reason || 'yêu cầu tạo/vẽ mới chi tiết') });
      }
    }

    return validated.length > 0 ? validated : [{ op: 'ai_edit', reason: 'không phân loại được' }];
  } catch {
    return [{ op: 'ai_edit', reason: 'không phân loại được' }];
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
