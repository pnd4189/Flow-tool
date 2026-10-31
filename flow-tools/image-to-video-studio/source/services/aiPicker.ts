import { Flow } from 'flow-sdk';
import { CAMERA_PRESETS } from './video';

export interface AIRatingItem {
  sceneId: string;
  score: number;           // 0 - 100
  camera?: string;         // id kiểu camera hợp lệ trong CAMERA_PRESETS (khác 'none')
  reason: string;          // tối đa 12 từ
  error?: string;
  isAiRated: boolean;
}

export interface AIRateOptions {
  batchSize?: number;
  onProgress?: (currentBatch: number, totalBatches: number, statusText: string) => void;
  signal?: { aborted: boolean };
}

// Cache kết quả AI theo key: `${sceneId}_${sig}`
const aiScoreCache = new Map<string, { score: number; camera?: string; reason: string }>();

function getImageSignature(base64: string): string {
  const len = base64.length;
  if (len < 64) return base64;
  const head = base64.slice(0, 16);
  const mid = base64.slice(Math.floor(len / 2) - 8, Math.floor(len / 2) + 8);
  const tail = base64.slice(-16);
  return `${len}_${head}_${mid}_${tail}`;
}

const VALID_CAMERA_IDS = new Set(
  CAMERA_PRESETS.map(c => c.id).filter(id => id !== 'none')
);

const CAMERA_LIST_DOC = CAMERA_PRESETS
  .filter(c => c.id !== 'none')
  .map(c => `- "${c.id}": ${c.label} (${c.text})`)
  .join('\n');

function buildAIRatingSystemInstruction(): string {
  return [
    'You are a cinematic film director and AI video production director.',
    'Your task is to analyze batches of candidate scene keyframe images and evaluate their quality, visual clarity, composition, and kinetic motion potential for video generation.',
    'SCORING CRITERIA (0 to 100):',
    '- Visual fidelity: sharp, clean, no distorted anatomy/limbs/hands, no malformed text/watermarks.',
    '- Clear visual focal point & depth: prominent subject, coherent lighting.',
    '- Motion potential: dynamic cinematic composition that will animate smoothly and impressively in video (push-in, pan, tracking, tilt, drone, etc.).',
    '',
    'CAMERA PRESETS ALLOWLIST (You must choose the best matching camera id from ONLY this list):',
    CAMERA_LIST_DOC,
    '',
    'OUTPUT REQUIREMENT:',
    'Return ONLY a valid raw JSON array of objects. NO markdown formatting, NO code blocks, NO preamble or explanation.',
    'Each object in the array MUST have exactly these 4 keys:',
    '- "i": integer (0-based index of the image in the current batch, matching the order provided)',
    '- "score": integer 0-100',
    '- "camera": string (must be one of the valid camera preset ids above, e.g. "push_in", "pan_left", "drone", "orbit", "tilt_up", "tracking", "static")',
    '- "reason": short explanation string in Vietnamese, strictly maximum 12 words (e.g. "Ánh sáng đẹp, tiền cảnh rõ, tiềm năng zoom chậm tốt")',
  ].join('\n');
}

function parseAIResponseJson(rawText: string): Array<{ i: number; score: number; camera?: string; reason?: string }> {
  if (!rawText || typeof rawText !== 'string') return [];
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const startIdx = cleaned.indexOf('[');
  const endIdx = cleaned.lastIndexOf(']');
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return [];
  }

  const snippet = cleaned.slice(startIdx, endIdx + 1);
  try {
    const parsed = JSON.parse(snippet);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Đánh giá các cảnh bằng AI theo lô tối đa 12 ảnh.
 * Trả về Map<sceneId, AIRatingItem>.
 */
export async function aiRateScenes(
  items: Array<{
    id: string;
    prompt: string;
    thumbBase64?: string;
    base64?: string;
    mimeType?: string;
  }>,
  options?: AIRateOptions
): Promise<Map<string, AIRatingItem>> {
  const resultMap = new Map<string, AIRatingItem>();
  const total = items.length;
  if (total === 0) return resultMap;

  const BATCH_SIZE = Math.min(12, Math.max(1, options?.batchSize || 12));
  const totalBatches = Math.ceil(total / BATCH_SIZE);

  const sysInstruction = buildAIRatingSystemInstruction();

  for (let b = 0; b < totalBatches; b++) {
    if (options?.signal?.aborted) {
      throw new Error('Đã huỷ chấm điểm bằng AI');
    }

    const start = b * BATCH_SIZE;
    const batchItems = items.slice(start, start + BATCH_SIZE);

    if (options?.onProgress) {
      options.onProgress(b + 1, totalBatches, `AI chấm điểm lô ${b + 1}/${totalBatches}...`);
    }

    // Kiểm tra cache trước cho các ảnh trong lô
    const uncachedBatchIndices: number[] = [];
    batchItems.forEach((item, localIdx) => {
      const b64 = item.thumbBase64 || item.base64 || '';
      const sig = getImageSignature(b64);
      const cacheKey = `${item.id}_${sig}`;
      const cached = aiScoreCache.get(cacheKey);
      if (cached) {
        resultMap.set(item.id, {
          sceneId: item.id,
          score: cached.score,
          camera: cached.camera,
          reason: cached.reason,
          isAiRated: true,
        });
      } else {
        uncachedBatchIndices.push(localIdx);
      }
    });

    // Nếu cả lô đã có trong cache thì bỏ qua gọi API
    if (uncachedBatchIndices.length === 0) {
      continue;
    }

    // Chuẩn bị ảnh và prompt cho các ảnh chưa cache trong lô
    const imagesPayload: Array<{ base64: string; mimeType: string }> = [];
    const promptLines: string[] = ['Danh sách ảnh cần chấm điểm:'];

    uncachedBatchIndices.forEach((localIdx, subIndex) => {
      const item = batchItems[localIdx];
      const rawBase64 = item.thumbBase64 || item.base64 || '';
      const cleanBase64 = rawBase64.includes(',') ? rawBase64.split(',')[1] : rawBase64;
      imagesPayload.push({
        base64: cleanBase64,
        mimeType: 'image/jpeg',
      });

      const promptClip = (item.prompt || 'Cinematic scene').trim().slice(0, 200);
      promptLines.push(`- Ảnh ${subIndex}: "${promptClip}"`);
    });

    const userPrompt = [
      promptLines.join('\n'),
      '',
      'Hãy chấm điểm từng ảnh theo đúng thứ tự mảng ảnh từ 0 đến ' + (imagesPayload.length - 1) + '. Trả về JSON array duy nhất.',
    ].join('\n');

    try {
      const res = await Flow.generate.text(userPrompt, {
        systemInstruction: sysInstruction,
        thinkingLevel: 'low',
        images: imagesPayload,
      });

      const parsedArray = parseAIResponseJson(res.text || '');
      const parsedMap = new Map<number, { score: number; camera?: string; reason?: string }>();
      parsedArray.forEach(p => {
        if (typeof p.i === 'number') {
          parsedMap.set(p.i, p);
        }
      });

      uncachedBatchIndices.forEach((localIdx, subIndex) => {
        const item = batchItems[localIdx];
        const match = parsedMap.get(subIndex);
        if (match && typeof match.score === 'number' && !isNaN(match.score)) {
          const clampedScore = Math.max(0, Math.min(100, Math.round(match.score)));
          let cameraValid: string | undefined = undefined;
          if (match.camera && VALID_CAMERA_IDS.has(match.camera)) {
            cameraValid = match.camera;
          }

          let reasonTrimmed = (match.reason || '').trim();
          const words = reasonTrimmed.split(/\s+/);
          if (words.length > 12) {
            reasonTrimmed = words.slice(0, 12).join(' ') + '...';
          }
          if (!reasonTrimmed) {
            reasonTrimmed = 'AI đánh giá bố cục và độ nét phù hợp';
          }

          // Lưu cache
          const b64 = item.thumbBase64 || item.base64 || '';
          const sig = getImageSignature(b64);
          aiScoreCache.set(`${item.id}_${sig}`, {
            score: clampedScore,
            camera: cameraValid,
            reason: reasonTrimmed,
          });

          resultMap.set(item.id, {
            sceneId: item.id,
            score: clampedScore,
            camera: cameraValid,
            reason: reasonTrimmed,
            isAiRated: true,
          });
        } else {
          resultMap.set(item.id, {
            sceneId: item.id,
            score: 0,
            reason: 'dùng điểm cục bộ',
            error: 'AI không trả về điểm cho ảnh này',
            isAiRated: false,
          });
        }
      });
    } catch (batchErr: any) {
      // Ghi lỗi trên các ảnh của lô và tiếp tục các lô khác
      const errMsg = batchErr?.message || 'Lỗi gọi AI chấm điểm';
      uncachedBatchIndices.forEach(localIdx => {
        const item = batchItems[localIdx];
        resultMap.set(item.id, {
          sceneId: item.id,
          score: 0,
          reason: 'dùng điểm cục bộ',
          error: errMsg,
          isAiRated: false,
        });
      });
    }

    // Nhường luồng giữa các lô
    if (b < totalBatches - 1) {
      await new Promise(r => setTimeout(r, 60));
    }
  }

  return resultMap;
}
