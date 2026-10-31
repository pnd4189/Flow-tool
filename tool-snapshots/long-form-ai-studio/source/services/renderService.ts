import { Flow } from 'flow-sdk';
import {
  Shot,
  Scene,
  Character,
  ProjectConfig,
  VideoTake,
  ShotLock,
  VideoModel,
  VideoResolution,
} from './types';
import { compileVideoPrompt } from './shotengine';
import { getLook } from './library';
import { getShotCreditCost } from './pricing';
import { evaluateTakeQC } from './qcService';

export interface ShotKeyframePair {
  firstFrameMediaId?: string;
  lastFrameMediaId?: string;
  isReady: boolean;
  missingDescription?: string;
}

/**
 * Lấy cặp keyframe cho một shot dựa theo transitionIn và liên kết:
 * - firstFrame: shot.startKeyframe, nếu không có và shot.transitionIn === 'chain' thì lấy endKeyframe của shot trước.
 * - lastFrame: shot.endKeyframe, nếu không có và shot sau transitionIn === 'chain' thì lấy startKeyframe của shot sau.
 */
export function getShotKeyframes(
  shot: Shot,
  shots: Shot[]
): ShotKeyframePair {
  const index = shots.findIndex((s) => s.id === shot.id);

  let firstMediaId: string | undefined = shot.startKeyframe?.mediaId;
  if (!firstMediaId && index > 0 && shot.transitionIn === 'chain') {
    firstMediaId = shots[index - 1].endKeyframe?.mediaId;
  }

  let lastMediaId: string | undefined = shot.endKeyframe?.mediaId;
  if (!lastMediaId && index < shots.length - 1 && shots[index + 1].transitionIn === 'chain') {
    lastMediaId = shots[index + 1].startKeyframe?.mediaId;
  }

  const missing: string[] = [];
  if (!firstMediaId) missing.push('khung đầu (start)');
  if (!lastMediaId) missing.push('khung cuối (end)');

  return {
    firstFrameMediaId: firstMediaId,
    lastFrameMediaId: lastMediaId,
    isReady: Boolean(firstMediaId && lastMediaId),
    missingDescription: missing.length > 0 ? `Thiếu ${missing.join(' & ')}` : undefined,
  };
}

/**
 * Lấy cấu hình render hiệu lực của shot (tính cả override riêng từng shot)
 */
export function getEffectiveShotRenderConfig(shot: Shot, config: ProjectConfig): {
  model: VideoModel;
  durationSeconds: number;
  resolution: VideoResolution;
  cost: number;
} {
  const model = shot.modelOverride || config.videoModel;
  const isVeo = model.startsWith('Veo');

  let durationSeconds = shot.durationOverride || config.durationSeconds;
  let resolution = shot.resolutionOverride || config.resolution;

  if (isVeo) {
    resolution = '720p';
    if (durationSeconds === 10) durationSeconds = 8;
  }

  const cost = getShotCreditCost(model, resolution, durationSeconds);
  return { model, durationSeconds, resolution, cost };
}

/**
 * Kiểm tra xem take active có bị lệch mạch (stale) so với keyframe hiện tại hay không
 */
export function checkTakeStaleness(
  take: VideoTake,
  currentKeyframes: ShotKeyframePair
): boolean {
  if (!take.firstFrameMediaId || !take.lastFrameMediaId) return false;
  if (
    take.firstFrameMediaId !== currentKeyframes.firstFrameMediaId ||
    take.lastFrameMediaId !== currentKeyframes.lastFrameMediaId
  ) {
    return true;
  }
  return false;
}

/**
 * Kiểm tra xem shot có bị sửa đổi sau khi khoá hay không
 */
export function isShotModifiedAfterLock(
  shot: Shot,
  scene: Scene | undefined,
  characters: Character[],
  config: ProjectConfig,
  currentKeyframes: ShotKeyframePair
): boolean {
  if (!shot.lock) return false;

  const look = getLook(config.lookId);
  const currentPrompt = compileVideoPrompt(shot, scene, characters, look, config.customStyle).prompt;

  if (shot.lock.prompt !== currentPrompt) return true;
  if (shot.lock.firstFrameMediaId !== currentKeyframes.firstFrameMediaId) return true;
  if (shot.lock.lastFrameMediaId !== currentKeyframes.lastFrameMediaId) return true;

  const eff = getEffectiveShotRenderConfig(shot, config);
  if (shot.lock.model !== eff.model) return true;
  if (shot.lock.durationSeconds !== eff.durationSeconds) return true;
  if (shot.lock.resolution !== eff.resolution) return true;

  return false;
}

export function isTransientVideoError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('tạm thời không hoạt động') ||
    lower.includes('unavailable') ||
    lower.includes('busy') ||
    lower.includes('overloaded') ||
    lower.includes('rate limit')
  );
}

export function isQuotaOrCreditError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('quota') ||
    lower.includes('credit') ||
    lower.includes('insufficient') ||
    lower.includes('hạn mức') ||
    lower.includes('không đủ') ||
    lower.includes('hết credit') ||
    lower.includes('tín dụng') ||
    lower.includes('số dư')
  );
}

export function isSafetyOrPolicyError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('safety') ||
    lower.includes('policy') ||
    lower.includes('blocked') ||
    lower.includes('vi phạm') ||
    lower.includes('chính sách') ||
    lower.includes('không an toàn') ||
    lower.includes('sensitive') ||
    lower.includes('prohibited')
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Viết lại prompt video cho an toàn qua Flow.generate.text (thinkingLevel: 'low', timeout: 60s)
 */
async function rewritePromptForSafety(originalPrompt: string): Promise<string> {
  const systemInstruction = `You are an expert prompt safety engineer for generative AI video models.
Rewrite the provided video generation prompt so that it strictly adheres to all safety, policy, and content moderation rules.
Rules:
- Preserve the 2D animation style, characters, setting, and the core visual action intent.
- Tone down or remove graphic violence, dangerous weapons, sensitive themes, real person names, or explicit words.
- Use softer, cinematic, stylized animation terminology.
- Output ONLY the rewritten English prompt text without quotes, commentary, or markdown.`;

  const textPromise = Flow.generate.text(
    `Rewrite this video prompt to be completely policy-safe:\n${originalPrompt}`,
    {
      systemInstruction,
      thinkingLevel: 'low',
    }
  );

  const timeoutPromise = new Promise<{ text: string }>((_, reject) => {
    setTimeout(() => reject(new Error('AI rewrite prompt timed out (60s)')), 60000);
  });

  const { text } = await Promise.race([textPromise, timeoutPromise]);
  const cleaned = text.trim().replace(/^["']|["']$/g, '');
  return cleaned || originalPrompt;
}

/**
 * Render một Take mới cho shot:
 * - Chỉ dùng lock khi useLock && shot.lock && shot.lock.firstFrameMediaId === currentKeyframes.firstFrameMediaId && shot.lock.lastFrameMediaId === currentKeyframes.lastFrameMediaId
 * - Nếu keyframe đã đổi, biên dịch lại prompt + keyframe hiện tại và trả về lock MỚI.
 * - Timeout 900 giây (chỉ tính thời gian Flow.generate.video). Ném lỗi bắt đầu 'TIMEOUT:'
 * - Policy error: tự động rewrite prompt qua AI và thử lại đúng 1 lần.
 */
export async function renderShotTake(params: {
  shot: Shot;
  scene: Scene | undefined;
  characters: Character[];
  config: ProjectConfig;
  currentKeyframes: ShotKeyframePair;
  useLock?: boolean;
  enableQC?: boolean;
}): Promise<{ take: VideoTake; lock: ShotLock }> {
  const { shot, scene, characters, config, currentKeyframes, useLock = false, enableQC = true } = params;

  let promptToUse: string;
  let firstMediaId: string;
  let lastMediaId: string;
  let modelToUse: VideoModel;
  let durationToUse: number;
  let resolutionToUse: VideoResolution;

  const canUseLock =
    useLock &&
    Boolean(shot.lock) &&
    shot.lock?.firstFrameMediaId === currentKeyframes.firstFrameMediaId &&
    shot.lock?.lastFrameMediaId === currentKeyframes.lastFrameMediaId;

  if (canUseLock && shot.lock) {
    promptToUse = shot.lock.prompt;
    firstMediaId = shot.lock.firstFrameMediaId || currentKeyframes.firstFrameMediaId!;
    lastMediaId = shot.lock.lastFrameMediaId || currentKeyframes.lastFrameMediaId!;
    modelToUse = shot.lock.model;
    durationToUse = shot.lock.durationSeconds;
    resolutionToUse = shot.lock.resolution;
  } else {
    const look = getLook(config.lookId);
    promptToUse = compileVideoPrompt(shot, scene, characters, look, config.customStyle).prompt;
    firstMediaId = currentKeyframes.firstFrameMediaId!;
    lastMediaId = currentKeyframes.lastFrameMediaId!;
    const eff = getEffectiveShotRenderConfig(shot, config);
    modelToUse = eff.model;
    durationToUse = eff.durationSeconds;
    resolutionToUse = eff.resolution;
  }

  const creditCost = getShotCreditCost(modelToUse, resolutionToUse, durationToUse);

  let attempt = 0;
  const maxTransientRetries = 1;
  let hasTriedSafetyRewrite = false;

  while (true) {
    // Timeout 900 giây chỉ tính riêng cho Flow.generate.video
    const videoCallPromise = Flow.generate.video({
      prompt: promptToUse,
      modelDisplayName: modelToUse,
      aspectRatio: config.aspectRatio,
      durationSeconds: durationToUse,
      resolution: resolutionToUse,
      firstFrameImageMediaId: firstMediaId,
      lastFrameImageMediaId: lastMediaId,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('TIMEOUT: Quá 15 phút chưa nhận được video; có thể Flow vẫn tạo xong và đã trừ credit. Kiểm tra thư viện Flow (Nạp lại từ thư viện) trước khi render lại.'));
      }, 900000);
    });

    let videoRes: { base64: string; mimeType: string; mediaId: string };
    try {
      videoRes = await Promise.race([videoCallPromise, timeoutPromise]);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);

      if (rawMsg.startsWith('TIMEOUT:')) {
        throw new Error(rawMsg);
      }

      if (isQuotaOrCreditError(rawMsg)) {
        throw new Error(`QUOTA_ERROR: ${rawMsg}`);
      }

      // Xử lý bị chặn vì chính sách: thử rewrite an toàn qua AI đúng 1 lần
      if (isSafetyOrPolicyError(rawMsg)) {
        if (!hasTriedSafetyRewrite) {
          hasTriedSafetyRewrite = true;
          try {
            promptToUse = await rewritePromptForSafety(promptToUse);
            continue; // Thử lại đúng 1 lần với prompt mới
          } catch (rewriteErr) {
            throw new Error(`Bị chặn vì chính sách sau khi AI chỉnh prompt; sửa hành động/lời thoại của shot rồi render lại (${rewriteErr instanceof Error ? rewriteErr.message : String(rewriteErr)})`);
          }
        } else {
          throw new Error('Bị chặn vì chính sách sau khi AI chỉnh prompt; sửa hành động/lời thoại của shot rồi render lại');
        }
      }

      if (attempt < maxTransientRetries && isTransientVideoError(rawMsg)) {
        attempt++;
        await sleep(20000);
        continue;
      }

      throw new Error(rawMsg);
    }

    // Xử lý tạo Blob và video take sau khi đã hoàn tất Flow.generate.video
    const binaryString = atob(videoRes.base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      const end = Math.min(i + chunkSize, len);
      for (let j = i; j < end; j++) {
        bytes[j] = binaryString.charCodeAt(j);
      }
    }

    const mimeType = 'video/mp4';
    const blob = new Blob([bytes], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    const takeId = `take_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const newTake: VideoTake = {
      id: takeId,
      mediaId: videoRes.mediaId,
      blobUrl,
      sizeBytes: blob.size,
      model: modelToUse,
      durationSeconds: durationToUse,
      resolution: resolutionToUse,
      aspectRatio: config.aspectRatio,
      creditCost,
      renderedAt: Date.now(),
      promptUsed: promptToUse,
      firstFrameMediaId: firstMediaId,
      lastFrameMediaId: lastMediaId,
    };

    // Tạo lock mới nếu cấu hình/keyframe thay đổi hoặc chưa có
    const effectiveLock: ShotLock = {
      prompt: promptToUse,
      firstFrameMediaId: firstMediaId,
      lastFrameMediaId: lastMediaId,
      model: modelToUse,
      durationSeconds: durationToUse,
      resolution: resolutionToUse,
      lockedAt: Date.now(),
    };

    // QC chạy sau video generation độc lập ngoài timeout 900s
    if (enableQC) {
      try {
        const look = getLook(config.lookId);
        const qc = await evaluateTakeQC({
          take: newTake,
          actionText: shot.action || shot.actionBeat,
          lookLabel: look.label,
          characters: characters.filter((c) => shot.characterIds.includes(c.id)),
          startKeyframe: shot.startKeyframe,
          endKeyframe: shot.endKeyframe,
        });
        newTake.qc = qc;
      } catch (qcErr) {
        console.warn('QC failed without blocking render:', qcErr);
        newTake.qc = {
          onModel: 70,
          style2D: 70,
          continuity: 70,
          action: 70,
          totalScore: 70,
          artifacts: [],
          verdict: 'review',
          note: `QC lỗi: ${qcErr instanceof Error ? qcErr.message : String(qcErr)}`.slice(0, 100),
          checkedAt: Date.now(),
        };
      }
    }

    return { take: newTake, lock: effectiveLock };
  }
}
