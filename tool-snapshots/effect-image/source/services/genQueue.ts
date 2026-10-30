import { Flow } from 'flow-sdk';
import type {
  QueueItem,
  GenerationSettings,
  GeneratedImageVariant,
  QCResult,
  DebugSimulationMode,
  MockErrorConfig,
} from '../types';
import { translatePromptToEnglish as rawTranslatePromptToEnglish } from './promptParser';

/**
 * Hàm dùng chung: Nạp lại ảnh từ Flow Media Gallery khi ảnh đã giải phóng bộ nhớ.
 * Được dùng ở cả AutoPilotPanel và Step3Effects.
 */
export async function reloadImageFromGallery(): Promise<{
  mediaId: string;
  blobUrl: string;
  mimeType: string;
} | null> {
  try {
    const selected = await Flow.media.select({ filter: 'image' });
    if (!selected || !selected.base64) return null;

    const mimeType = selected.mimeType || 'image/jpeg';
    const blobUrl = `data:${mimeType};base64,${selected.base64}`;

    return {
      mediaId: selected.mediaId,
      blobUrl,
      mimeType,
    };
  } catch (err) {
    console.warn('Không chọn ảnh nạp lại từ Flow Gallery:', err);
    return null;
  }
}

/**
 * Hạn giờ một Promise bất kỳ. Nếu quá ms, ném Error với nhãn phù hợp để isTemporaryError bắt được.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const sec = Math.round(ms / 1000);
  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timeout sau ${sec}s`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function getNextFallbackModel(currentModel: string): string {
  if (currentModel === '🍌 Nano Banana Pro') return '🍌 Nano Banana 2.1';
  if (currentModel === '🍌 Nano Banana 2.1') return '🍌 Nano Banana 2 Lite';
  return '🍌 Nano Banana Pro';
}

/**
 * Nạp ảnh từ blob/object URL hoặc URL thông thường, vẽ lên Canvas và trả về thumbnail JPEG base64
 * Đặc biệt: KHÔNG đặt crossOrigin cho URL bắt đầu bằng blob: để tránh lỗi bảo mật sandbox.
 */
export async function thumbnailFromUrl(
  url: string,
  maxDimension = 768
): Promise<{ base64: string; mimeType: 'image/jpeg'; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    if (!url) {
      return reject(new Error('URL ảnh trống, không thể tạo thumbnail.'));
    }

    const img = new Image();
    // TUYỆT ĐỐI không đặt crossOrigin cho blob: URL vì trình duyệt sẽ chặn hoặc hỏng nạp
    if (!url.startsWith('blob:') && !url.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width || maxDimension;
        let h = img.naturalHeight || img.height || maxDimension;

        if (w > maxDimension || h > maxDimension) {
          if (w > h) {
            h = Math.round((h * maxDimension) / w);
            w = maxDimension;
          } else {
            w = Math.round((w * maxDimension) / h);
            h = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, w);
        canvas.height = Math.max(1, h);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Không thể khởi tạo 2D context cho canvas tạo thumbnail.'));
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const commaIdx = dataUrl.indexOf(',');
        const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : '';

        resolve({
          base64,
          mimeType: 'image/jpeg',
          dataUrl,
        });
      } catch (canvasErr) {
        reject(new Error(`Lỗi vẽ canvas ảnh: ${canvasErr instanceof Error ? canvasErr.message : String(canvasErr)}`));
      }
    };

    img.onerror = () => {
      reject(new Error(`Không thể nạp ảnh từ đường dẫn: ${url.slice(0, 40)}...`));
    };

    img.src = url;
  });
}

/**
 * Kiểm tra lỗi Quota exceeded thuần túy (không chứa 'per minute')
 * Lỗi này phải DỪNG hàng đợi ngay lập tức, không được thử lại!
 */
export function isPureQuotaExceededError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('quota exceeded') && !m.includes('per minute');
}

export function isTemporaryError(message: string): boolean {
  const m = message.toLowerCase();
  // Nếu là quota thuần túy thì không xếp vào temporary để retry
  if (isPureQuotaExceededError(message)) {
    return false;
  }
  return (
    m.includes('tạm thời không hoạt động') ||
    m.includes('dịch vụ tạo hình ảnh không hoạt động') ||
    m.includes('không hoạt động') ||
    m.includes('unavailable') ||
    m.includes('busy') ||
    m.includes('overloaded') ||
    m.includes('rate limit') ||
    m.includes('quota exceeded per minute') ||
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('failed to fetch') ||
    m.includes('network')
  );
}

export function isSafetyPolicyError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('safety') ||
    m.includes('policy') ||
    m.includes('generation blocked by safety policy') ||
    m.includes('blocked') ||
    m.includes('vi phạm') ||
    m.includes('không an toàn') ||
    m.includes('sensitive')
  );
}

/**
 * Đảm bảo chuỗi kết thúc bằng dấu chấm câu (. ! ?)
 */
function ensureTerminalPunctuation(str: string): string {
  const trimmed = str.trim();
  if (!trimmed) return '';
  if (/[.!?]$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.`;
}

// Xây dựng prompt gửi đi, trả về cả prompt hoàn chỉnh và bản đã dịch (nếu có)
export async function constructSentPrompt(
  promptItemText: string,
  settings: GenerationSettings,
  negative?: string
): Promise<{ finalPrompt: string; translatedPrompt?: string }> {
  let promptText = promptItemText.trim();
  let translatedText: string | undefined = undefined;

  // Dịch tiếng Việt nếu bật (có timeout 60s)
  if (settings.translateVietnamese) {
    try {
      const translated = await withTimeout(
        rawTranslatePromptToEnglish(promptText),
        60000,
        'translatePromptToEnglish'
      );
      if (translated && translated !== promptText) {
        translatedText = translated;
        promptText = translated;
      }
    } catch (err) {
      console.warn('Dịch prompt lỗi/timeout, dùng prompt gốc:', err);
    }
  }

  // Luôn kết thúc câu chính bằng dấu câu (. ! ?) trước khi nối tiếp
  promptText = ensureTerminalPunctuation(promptText);

  // Thêm hậu tố phong cách chung
  if (settings.styleSuffix.trim()) {
    const suffix = ensureTerminalPunctuation(settings.styleSuffix.trim());
    promptText = `${promptText} ${suffix}`;
  }

  // Thêm Avoid: {negative}
  if (negative && negative.trim()) {
    const negClean = ensureTerminalPunctuation(negative.trim());
    promptText = `${ensureTerminalPunctuation(promptText)} Avoid: ${negClean}`;
  }

  // Thêm No text, no captions, no watermark (nếu prompt không đòi hỏi text/logo/typography)
  const demandsText = /\b(text|word|words|letter|letters|font|logo|caption|typography|chữ|tiêu đề)\b/i.test(
    promptText
  );
  if (settings.addNoWatermark && !demandsText) {
    promptText = `${ensureTerminalPunctuation(promptText)} No text, no captions, no watermark.`;
  }

  return {
    finalPrompt: promptText.trim(),
    translatedPrompt: translatedText,
  };
}

// Viết lại prompt khi dính Safety (có timeout 60s)
export async function rewritePromptForSafety(unsafePrompt: string): Promise<string> {
  const callRewrite = async () => {
    const systemInstruction = `You are a creative prompt safety optimizer.
The user's image generation prompt was flagged by content safety filters.
Rewrite the prompt to make it 100% compliant with standard safety guidelines.
Keep the core subject, composition, mood, colors, and art style intact.
Remove all potentially sensitive, violent, or policy-violating phrasing.
Return ONLY the rewritten prompt string with no quotes or explanations.`;

    const res = await Flow.generate.text(`Rewrite safely: "${unsafePrompt}"`, {
      systemInstruction,
      thinkingLevel: 'low',
    });

    return (res.text || '').trim().replace(/^["']|["']$/g, '') || unsafePrompt;
  };

  return await withTimeout(callRewrite(), 60000, 'rewritePromptForSafety');
}

// AI Soi ảnh (Strict Image QA 0 credit) với timeout 60s
export async function inspectImageQc(
  imageBase64: string,
  imageMimeType: string,
  promptText: string
): Promise<QCResult> {
  const callInspect = async () => {
    const thumb = await createResizedThumbnail(imageBase64, imageMimeType, 768);

    const systemInstruction = `You are a strict creative AI quality inspector.
Analyze the provided image against the prompt.
Respond ONLY with valid JSON:
{
  "matchesPrompt": number (0-100),
  "artifacts": string[] (short Vietnamese items: tay thừa ngón, mặt méo, chữ vô nghĩa, watermark, vật thể dính nhau, sai chủ thể...),
  "hasUnwantedText": boolean,
  "verdict": "ok"|"regenerate",
  "note": string (Vietnamese <= 20 words)
}
Grading scale: 95 perfect, 85 very minor flaws, 75 acceptable minor flaws, 60 noticeable defects, 40 broken.`;

    const promptInspection = `Prompt: "${promptText}". Check match accuracy, defects, unwanted text and provide verdict.`;

    const res = await Flow.generate.text(promptInspection, {
      systemInstruction,
      thinkingLevel: 'low',
      images: [{ base64: thumb.base64, mimeType: thumb.mimeType }],
    });

    const cleaned = (res.text || '')
      .trim()
      .replace(/^```json/i, '')
      .replace(/^```/, '')
      .replace(/```$/, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    return {
      matchesPrompt: typeof parsed.matchesPrompt === 'number' ? parsed.matchesPrompt : 80,
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
      hasUnwantedText: !!parsed.hasUnwantedText,
      verdict: parsed.verdict === 'regenerate' ? 'regenerate' : 'ok',
      note: parsed.note || 'Ảnh đã được AI kiểm định.',
    };
  };

  return await withTimeout(callInspect(), 60000, 'inspectImageQc');
}

/**
 * Sinh 1 ảnh với timeout 120s và xử lý giả lập lỗi kiểm thử (mock error)
 */
export async function generateSingleImageWithTimeout(
  prompt: string,
  modelDisplayName: string,
  aspectRatio: string,
  debugMode: DebugSimulationMode = 'none',
  mockErrorConfigRef?: { current: MockErrorConfig },
  onMockErrorConsumed?: (remaining: number) => void
): Promise<{ base64: string; mimeType: string; mediaId: string }> {
  // 1. Kiểm tra Giả lập lỗi sinh ảnh
  if (mockErrorConfigRef && mockErrorConfigRef.current.active && mockErrorConfigRef.current.remainingCount > 0) {
    const errorType = mockErrorConfigRef.current.type;
    const nextRemaining = mockErrorConfigRef.current.remainingCount - 1;
    mockErrorConfigRef.current.remainingCount = nextRemaining;
    if (nextRemaining <= 0) {
      mockErrorConfigRef.current.active = false;
    }
    if (onMockErrorConsumed) {
      onMockErrorConsumed(nextRemaining);
    }

    if (errorType === 'temporary') {
      throw new Error('Dịch vụ tạm thời không hoạt động. Hãy thử lại.');
    }
    if (errorType === 'image_service') {
      throw new Error('Dịch vụ tạo hình ảnh không hoạt động. Hãy thử lại.');
    }
    if (errorType === 'safety') {
      throw new Error('Generation blocked by safety policy');
    }
    if (errorType === 'quota') {
      throw new Error('Quota exceeded');
    }
    if (errorType === 'timeout') {
      // Treo giả lập đúng 120s rồi ném timeout
      await new Promise((resolve) => setTimeout(resolve, 120000));
      throw new Error('Flow.generate.image timeout sau 120s');
    }
  }

  // 2. Kiểm tra chế độ gỡ lỗi cũ
  if (debugMode === 'high_traffic') {
    throw new Error('503 Service Unavailable: High traffic queue busy (Simulated Debug Error)');
  }
  if (debugMode === 'unsafe_prompt') {
    throw new Error('Safety policy violation: Content blocked by safety filter (Simulated Debug Error)');
  }

  const genPromise = Flow.generate.image({
    prompt,
    modelDisplayName,
    aspectRatio: aspectRatio as any,
  });

  return await withTimeout(genPromise, 120000, 'Flow.generate.image');
}

// Chuyển base64 sang Blob + Object URL (giải phóng memory)
export function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

// Tạo thumbnail 512px từ base64
export async function createResizedThumbnail(
  base64: string,
  mimeType: string,
  maxDimension = 512
): Promise<{ base64: string; mimeType: string; dataUrl: string }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let w = img.naturalWidth || 512;
      let h = img.naturalHeight || 512;
      if (w > maxDimension || h > maxDimension) {
        if (w > h) {
          h = Math.round((h * maxDimension) / w);
          w = maxDimension;
        } else {
          w = Math.round((w * maxDimension) / h);
          h = maxDimension;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve({ base64, mimeType, dataUrl: `data:${mimeType};base64,${base64}` });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      resolve({
        base64: dataUrl.split(',')[1],
        mimeType: 'image/jpeg',
        dataUrl,
      });
    };
    img.onerror = () => resolve({ base64, mimeType, dataUrl: `data:${mimeType};base64,${base64}` });
    img.src = `data:${mimeType};base64,${base64}`;
  });
}
