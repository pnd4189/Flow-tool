import { Flow } from 'flow-sdk';

export interface StoryboardSceneItem {
  title: string;
  imagePrompt: string;
  motionPrompt: string;
}

/**
 * Xây dựng system instruction cho model chia kịch bản:
 * Chỉ trả về mảng JSON hợp lệ, không markdown hay giải thích.
 * title cùng ngôn ngữ với kịch bản (<= 40 ký tự).
 * imagePrompt và motionPrompt viết bằng tiếng Anh.
 */
export function buildStoryboardSystemInstruction(
  sceneCountHint?: number | 'auto',
  styleNote?: string
): string {
  const countInstruction =
    typeof sceneCountHint === 'number' && sceneCountHint > 0
      ? `Break the script into approximately ${sceneCountHint} cohesive cinematic scenes.`
      : 'Break the script into an optimal number of cohesive cinematic scenes based on narrative beats.';

  const styleInstruction =
    styleNote && styleNote.trim()
      ? `Visual style note to strictly incorporate into every imagePrompt: "${styleNote.trim()}".`
      : 'Maintain a visually striking, coherent cinematic visual style across all scenes.';

  return [
    'You are a professional film director and storyboard concept artist.',
    'Your task is to analyze the user-provided story/script and break it down into sequential scenes.',
    countInstruction,
    styleInstruction,
    'OUTPUT REQUIREMENT: You MUST respond with ONLY a valid, raw JSON array of objects. NO markdown formatting, NO ```json code fence, NO explanations before or after.',
    'Each object in the array must strictly have these 3 fields:',
    '1. "title": A short scene title (maximum 40 characters). MUST BE in the same language as the input script.',
    '2. "imagePrompt": A highly detailed visual description of the very first keyframe of this scene, written strictly in ENGLISH. CRITICAL: REPEAT key character visual identifiers (facial features, clothing, hairstyle, colors) and environmental landmarks across every scene to ensure maximum visual consistency.',
    '3. "motionPrompt": 1 to 2 concise sentences describing the physical motion of the primary subject and environmental elements (e.g. wind, lighting changes, background movement) for a short video shot, written strictly in ENGLISH. DO NOT describe camera movements (no pan, zoom, tilt, crane).',
    'Example JSON format: [{"title": "Khởi hành", "imagePrompt": "A young Asian woman with short black hair wearing a red trench coat standing on a misty platform...", "motionPrompt": "She looks up slowly as the train lights cut through the drifting fog and wind flutters her coat."}]',
  ].join('\n');
}

/**
 * Tách kịch bản thành các khối nhỏ theo đoạn văn (paragraph) nếu vượt quá maxChars (mặc định 6000),
 * không cắt ngang đoạn văn.
 */
export function chunkScript(text: string, maxChars: number = 6000): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const paragraphs = trimmed.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    const candidate = currentChunk ? `${currentChunk}\n\n${para}` : para;
    if (candidate.length <= maxChars) {
      currentChunk = candidate;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      if (para.length > maxChars) {
        // Đoạn văn đơn lẻ quá dài: cắt theo câu hoặc dòng
        const lines = para.split('\n');
        let subChunk = '';
        for (const line of lines) {
          const subCandidate = subChunk ? `${subChunk}\n${line}` : line;
          if (subCandidate.length <= maxChars) {
            subChunk = subCandidate;
          } else {
            if (subChunk) chunks.push(subChunk.trim());
            if (line.length > maxChars) {
              // Cắt cưỡng bức nếu 1 dòng quá dài
              for (let i = 0; i < line.length; i += maxChars) {
                chunks.push(line.slice(i, i + maxChars).trim());
              }
              subChunk = '';
            } else {
              subChunk = line;
            }
          }
        }
        if (subChunk.trim()) {
          currentChunk = subChunk;
        } else {
          currentChunk = '';
        }
      } else {
        currentChunk = para;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 0);
}

/**
 * Bóc tách và kiểm tra JSON trả về từ model:
 * Bỏ hàng rào markdown, cắt từ '[' đầu tới ']' cuối, parse và chuẩn hoá.
 * Ném lỗi kèm 200 ký tự đầu của phản hồi gốc nếu không hợp lệ.
 */
export function parseStoryboardJson(raw: string): StoryboardSceneItem[] {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Phản hồi từ AI rỗng.');
  }

  let cleaned = raw.trim();
  // Bỏ ```json hoặc ``` ở đầu/cuối
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const startIdx = cleaned.indexOf('[');
  const endIdx = cleaned.lastIndexOf(']');

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    const preview = raw.slice(0, 200).replace(/\n/g, ' ');
    throw new Error(`AI không trả về mảng JSON hợp lệ. Đầu phản hồi: "${preview}"`);
  }

  const jsonSnippet = cleaned.slice(startIdx, endIdx + 1);
  let parsed: any;
  try {
    parsed = JSON.parse(jsonSnippet);
  } catch (err: any) {
    const preview = raw.slice(0, 200).replace(/\n/g, ' ');
    throw new Error(`Lỗi parse JSON (${err?.message || 'sai cú pháp'}). Đầu phản hồi: "${preview}"`);
  }

  if (!Array.isArray(parsed)) {
    const preview = raw.slice(0, 200).replace(/\n/g, ' ');
    throw new Error(`Dữ liệu JSON không phải mảng danh sách cảnh. Đầu phản hồi: "${preview}"`);
  }

  const results: StoryboardSceneItem[] = [];
  parsed.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const imagePrompt = typeof item.imagePrompt === 'string' ? item.imagePrompt.trim() : '';
    if (!imagePrompt) return;

    let title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Cảnh ${idx + 1}`;
    if (title.length > 40) {
      title = title.slice(0, 40).trim();
    }

    const motionPrompt = typeof item.motionPrompt === 'string' ? item.motionPrompt.trim() : '';

    results.push({
      title,
      imagePrompt,
      motionPrompt,
    });
  });

  if (results.length === 0) {
    const preview = raw.slice(0, 200).replace(/\n/g, ' ');
    throw new Error(`Mảng JSON không chứa cảnh hợp lệ có imagePrompt. Đầu phản hồi: "${preview}"`);
  }

  return results;
}

/**
 * Chia kịch bản bằng AI có hỗ trợ chunking tuần tự nếu văn bản dài,
 * phân bổ số cảnh mục tiêu theo tỷ lệ chiều dài từng phần,
 * và truyền danh sách title các cảnh đã có để giữ mạch nối.
 */
export async function splitScriptWithAI(params: {
  script: string;
  sceneCountTarget?: number | 'auto';
  styleNote?: string;
  onProgress?: (currentPart: number, totalParts: number) => void;
  signal?: { aborted: boolean };
}): Promise<StoryboardSceneItem[]> {
  const { script, sceneCountTarget, styleNote, onProgress, signal } = params;
  const chunks = chunkScript(script, 6000);
  if (chunks.length === 0) {
    throw new Error('Kịch bản rỗng, vui lòng nhập nội dung.');
  }

  const totalParts = chunks.length;
  const allScenes: StoryboardSceneItem[] = [];

  // Tính số cảnh phân bổ cho từng chunk nếu người dùng chọn số cố định
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const targetTotal = typeof sceneCountTarget === 'number' && sceneCountTarget > 0 ? sceneCountTarget : null;

  let allocatedScenes: number[] = [];
  if (targetTotal) {
    let allocatedSum = 0;
    allocatedScenes = chunks.map((c, i) => {
      if (i === chunks.length - 1) {
        return Math.max(1, targetTotal - allocatedSum);
      }
      const share = Math.max(1, Math.round((c.length / totalLength) * targetTotal));
      allocatedSum += share;
      return share;
    });
  }

  for (let i = 0; i < totalParts; i++) {
    if (signal?.aborted) {
      throw new Error('Thao tác đã bị huỷ bởi người dùng.');
    }

    if (onProgress) {
      onProgress(i + 1, totalParts);
    }

    const chunkText = chunks[i];
    const chunkTarget = targetTotal ? allocatedScenes[i] : 'auto';
    const sysInstruction = buildStoryboardSystemInstruction(chunkTarget, styleNote);

    const existingTitles = allScenes.map((s, idx) => `${idx + 1}. ${s.title}`).join(', ');
    const previousContext = existingTitles
      ? `Previous scenes already created: [${existingTitles}]. Ensure continuity and do NOT duplicate previous moments.`
      : '';

    const prompt = [
      `Story excerpt (Part ${i + 1}/${totalParts}):`,
      '---',
      chunkText,
      '---',
      previousContext,
      'Break this excerpt into sequential cinematic scenes now.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const res = await Flow.generate.text(prompt, {
      systemInstruction: sysInstruction,
      thinkingLevel: 'low',
    });

    const parsedChunkScenes = parseStoryboardJson(res.text);
    allScenes.push(...parsedChunkScenes);
  }

  return allScenes;
}

/**
 * System instruction cho model tạo gợi ý motion prompt từ ảnh thật và prompt gốc.
 */
export function buildMotionSystemInstruction(): string {
  return [
    'You are a cinematic motion director for AI video generation.',
    'Your goal is to suggest a concise, natural motion description to bring a static image to life as a short video.',
    'RULES:',
    '1. Write strictly in ENGLISH.',
    '2. Exactly 1 to 2 sentences describing the physical motion of the subject and the surrounding environment.',
    '3. Do NOT change the core composition or subject identity.',
    '4. Do NOT mention camera motion (no pan, zoom, tilt, rotate, camera angle) because camera movements will be added separately.',
    '5. Do NOT use markdown, quotes, bullet points, or commentary.',
    '6. Return ONLY the plain motion description text.',
  ].join('\n');
}

/**
 * Gợi ý motion prompt cho 1 cảnh bằng Flow.generate.text với multimodal ảnh (nếu có thumbBase64)
 */
export async function generateMotionSuggestion(params: {
  imagePrompt: string;
  thumbBase64?: string;
}): Promise<string> {
  const { imagePrompt, thumbBase64 } = params;
  const systemInstruction = buildMotionSystemInstruction();

  const userPrompt = [
    'Original image prompt:',
    imagePrompt || 'Cinematic shot of subject in scene.',
    'Describe the natural physical motion for the subject and environment in 1-2 sentences.',
  ].join('\n\n');

  const options: {
    systemInstruction: string;
    thinkingLevel: 'low';
    images?: Array<{ base64: string; mimeType?: string }>;
  } = {
    systemInstruction,
    thinkingLevel: 'low',
  };

  if (thumbBase64 && thumbBase64.trim().length > 0) {
    options.images = [{ base64: thumbBase64, mimeType: 'image/jpeg' }];
  }

  const res = await Flow.generate.text(userPrompt, options);

  let cleaned = (res.text || '').trim();
  // Loại bỏ markdown quote hoặc code block nếu có
  cleaned = cleaned.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '');
  cleaned = cleaned.replace(/^["']|["']$/g, '').trim();

  return cleaned;
}
