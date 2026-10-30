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
  return lower.includes('quota') || lower.includes('credit') || lower.includes('insufficient');
}

export function isSafetyOrPolicyError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('safety') || lower.includes('policy') || lower.includes('blocked');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Render một Take mới cho shot:
 * - Nếu dùng bản khoá (useLock = true), dùng đúng prompt, 2 keyframe, model, duration, resolution trong lock.
 * - Nếu không khoá, tự động tạo ShotLock lần đầu.
 * - Tự động chạy QC bằng Gemini (0 credit) nếu enableQC = true.
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

  if (useLock && shot.lock) {
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

  while (true) {
    const renderPromise = (async () => {
      const videoRes = await Flow.generate.video({
        prompt: promptToUse,
        modelDisplayName: modelToUse,
        aspectRatio: config.aspectRatio,
        durationSeconds: durationToUse,
        resolution: resolutionToUse,
        firstFrameImageMediaId: firstMediaId,
        lastFrameImageMediaId: lastMediaId,
      });

      // Tạo Blob và blobUrl
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

      // Tạo hoặc cập nhật lock
      const effectiveLock: ShotLock = shot.lock && useLock
        ? shot.lock
        : {
            prompt: promptToUse,
            firstFrameMediaId: firstMediaId,
            lastFrameMediaId: lastMediaId,
            model: modelToUse,
            durationSeconds: durationToUse,
            resolution: resolutionToUse,
            lockedAt: Date.now(),
          };

      // Chạy QC nếu được kích hoạt
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
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('TIMEOUT_600S'));
      }, 600000);
    });

    try {
      const result = await Promise.race([renderPromise, timeoutPromise]);
      return result;
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);

      if (rawMsg === 'TIMEOUT_600S') {
        throw new Error('Quá thời gian chờ (600s); video có thể vẫn được tạo, kiểm tra thư viện Flow');
      }

      if (isQuotaOrCreditError(rawMsg)) {
        throw new Error(`QUOTA_ERROR: ${rawMsg}`);
      }

      if (isSafetyOrPolicyError(rawMsg)) {
        throw new Error(`SAFETY_ERROR: ${rawMsg}`);
      }

      if (attempt < maxTransientRetries && isTransientVideoError(rawMsg)) {
        attempt++;
        await sleep(20000);
      } else {
        throw new Error(rawMsg);
      }
    }
  }
}
