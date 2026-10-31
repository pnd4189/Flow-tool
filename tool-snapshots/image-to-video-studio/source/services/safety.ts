import { Flow } from 'flow-sdk';

/**
 * Kiểm tra xem thông báo lỗi có phải là lỗi bị chặn bởi bộ lọc nội dung / an toàn / chính sách không.
 * Hỗ trợ cả tiếng Việt ("vi phạm", "chính sách", "không an toàn"...) và tiếng Anh.
 */
export function isPolicyBlockError(msg: string): boolean {
  if (!msg || typeof msg !== 'string') return false;
  const lower = msg.toLowerCase();
  const policyTokens = [
    'vi phạm',
    'chính sách',
    'không an toàn',
    'safety',
    'policy',
    'blocked',
    'sensitive',
    'prohibited',
    'responsible ai',
  ];
  return policyTokens.some(token => lower.includes(token));
}

/**
 * Regex lọc các từ khóa nhạy cảm thường gây kích hoạt nhầm bộ lọc an toàn khi nằm trong negative prompt
 * (như: nudity, gore, blood, violence, corpse, minor...).
 */
const SENSITIVE_NEGATIVE_REGEX = /nud|naked|sex|suggestive|explicit|gore|blood|violen|corpse|dead|kill|weapon|celebrit|public figure|real person|minor|child/i;

/**
 * Lọc bỏ các cụm từ nhạy cảm khỏi negative prompt.
 * Tách theo dấu phẩy, chấm phẩy hoặc xuống dòng; loại bỏ các mục khớp regex; ghép lại bằng ", ".
 * Trả về undefined nếu rỗng.
 */
export function sanitizeNegative(neg?: string): string | undefined {
  if (!neg || typeof neg !== 'string') return undefined;
  const parts = neg.split(/[,;\n]+/);
  const cleanParts = parts
    .map(p => p.trim())
    .filter(p => p.length > 0 && !SENSITIVE_NEGATIVE_REGEX.test(p));

  if (cleanParts.length === 0) return undefined;
  return cleanParts.join(', ');
}

/**
 * Dựng prompt hoàn chỉnh gửi vào bộ tạo ảnh theo cấp độ an toàn:
 * - level 0: prompt gốc + (nếu sanitizeNegative có giá trị thì thêm "\n\nAvoid: " + sanitized)
 * - level >= 1: chỉ prompt gốc/đã chỉnh (bỏ hoàn toàn phần Avoid)
 */
export function buildImagePrompt(prompt: string, negative?: string, level: number = 0): string {
  const base = (prompt || '').trim();
  if (level >= 1) {
    return base;
  }
  const sanitized = sanitizeNegative(negative);
  if (sanitized) {
    return `${base}\n\nAvoid: ${sanitized}`;
  }
  return base;
}

/**
 * Gọi Flow.generate.text để AI viết lại prompt bị chặn an toàn hơn,
 * giữ nguyên nhân vật, bối cảnh, ánh sáng, phong cách, chuyển các yếu tố nhạy cảm/máu me/gợi cảm sang ngụ ý hoặc loại bỏ.
 * Timeout tối đa 60 giây qua Promise.race.
 */
export async function rewritePromptForPolicy(prompt: string, round: 1 | 2): Promise<string> {
  const basePrompt = (prompt || '').trim();
  if (!basePrompt) {
    throw new Error('Prompt rỗng, không thể chỉnh sửa.');
  }

  let sysInstruction = [
    'You rewrite image-generation prompts that were blocked by a content-safety filter so they pass while keeping the same scene.',
    "Keep: characters' appearance, setting, composition, camera, lighting, color palette, art style and mood.",
    'Replace or soften anything graphic or sensitive: blood, gore, wounds, corpses and death become implied (shadows, aftermath hints, fallen objects, frightened reactions); sexual or suggestive cues, nudity, love-hotel/bedroom intimacy become neutral and fully clothed; real people or celebrities become fictional characters; weapons aimed at people become non-threatening.',
    'Never add words like nudity, gore, blood, sex, kill in any form, not even as negatives.',
    'Output English only, one paragraph, no quotes, no markdown, no explanation.',
  ].join(' ');

  if (round === 2) {
    sysInstruction += ' The previous rewrite was still blocked: be clearly more conservative, keep only the safe visual essentials.';
  }

  const callPromise = Flow.generate.text(basePrompt, {
    systemInstruction: sysInstruction,
    thinkingLevel: 'low',
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('AI chỉnh prompt quá thời gian chờ (60s).'));
    }, 60000);
  });

  const res = await Promise.race([callPromise, timeoutPromise]);
  let rewritten = (res.text || '').trim();

  // Bỏ ngoặc kép và code fence markdown nếu có
  rewritten = rewritten.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '');
  rewritten = rewritten.replace(/^["']|["']$/g, '').trim();

  if (!rewritten) {
    throw new Error('AI không trả về nội dung prompt đã chỉnh.');
  }

  return rewritten;
}
