import { Flow } from 'flow-sdk';
import { AspectRatioOption, ImageModel } from '../types';
import { isPolicyBlockError, isTransientError, rewritePromptForPolicy } from './safety';
import { logDiag } from './diagnostics';

export interface GenerateSheetImageOptions {
  prompt: string;
  model: ImageModel;
  aspectRatio: AspectRatioOption;
  referenceMediaIds?: string[];
  onStage?: (stage: 'generating' | 'retrying' | 'rewriting', detail?: string) => void;
}

export interface GenerateSheetImageResult {
  base64: string;
  mimeType: string;
  mediaId: string;
  promptUsed: string;
  rewriteRound: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Invokes Flow.generate.image with a 150-second timeout per call.
 */
async function callImageApiWithTimeout(
  prompt: string,
  model: ImageModel,
  aspectRatio: AspectRatioOption,
  referenceImageMediaIds?: string[]
) {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('TIMEOUT: Quá thời gian tạo ảnh 150s từ máy chủ.'));
    }, 150000);
  });

  const options: Parameters<typeof Flow.generate.image>[0] = {
    prompt,
    modelDisplayName: model,
    aspectRatio,
  };

  if (referenceImageMediaIds && referenceImageMediaIds.length > 0) {
    options.referenceImageMediaIds = referenceImageMediaIds.slice(0, 10);
  }

  const generatePromise = Flow.generate.image(options);
  return Promise.race([generatePromise, timeoutPromise]);
}

/**
 * Generates a character sheet image handling transient retries (8s, 20s) and policy rewrite ladder (Rounds 1 and 2).
 */
export async function generateSheetImage(
  options: GenerateSheetImageOptions
): Promise<GenerateSheetImageResult> {
  const { prompt: initialPrompt, model, aspectRatio, referenceMediaIds, onStage } = options;

  // Filter 1-10 unique ids
  const validRefIds = referenceMediaIds
    ? Array.from(new Set(referenceMediaIds.filter(Boolean))).slice(0, 10)
    : [];
  const refIdsToPass = validRefIds.length > 0 ? validRefIds : undefined;

  let currentPrompt = initialPrompt;
  let rewriteRound = 0; // 0 = original, 1 = round 1, 2 = round 2

  // Loop through policy ladder: attempt original, then round 1, then round 2
  while (rewriteRound <= 2) {
    let transientAttempt = 0;
    const maxTransientRetries = 2; // attempts: 0 (initial), 1 (after 8s), 2 (after 20s)

    while (transientAttempt <= maxTransientRetries) {
      if (transientAttempt > 0) {
        onStage?.('retrying', `Lần ${transientAttempt}/2`);
        logDiag(
          'call',
          'image.generate.retry',
          `attempt=${transientAttempt}/2 model=${model} wait_done=true`
        );
      } else if (rewriteRound > 0) {
        onStage?.('generating', `Prompt an toàn vòng ${rewriteRound}`);
      } else {
        onStage?.('generating');
      }

      const refCount = refIdsToPass ? refIdsToPass.length : 0;
      const refIdsStr = refIdsToPass && refIdsToPass.length > 0 ? refIdsToPass.join(',') : 'none';
      const promptChars = currentPrompt.length;

      logDiag(
        'call',
        'image.generate',
        `model=${model} aspect=${aspectRatio} promptChars=${promptChars} refCount=${refCount} refIds=${refIdsStr} rewriteRound=${rewriteRound}`
      );

      const startTime = Date.now();

      try {
        const res = await callImageApiWithTimeout(
          currentPrompt,
          model,
          aspectRatio,
          refIdsToPass
        );

        const durationMs = Date.now() - startTime;
        logDiag(
          'ok',
          'image.generate',
          `duration=${durationMs}ms mediaId=${res.mediaId} mimeType=${res.mimeType} base64Chars=${res.base64?.length ?? 0}`
        );

        return {
          base64: res.base64,
          mimeType: res.mimeType,
          mediaId: res.mediaId,
          promptUsed: currentPrompt,
          rewriteRound,
        };
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const errorMsg = err instanceof Error ? err.message : String(err);

        logDiag(
          'error',
          'image.generate',
          `duration=${durationMs}ms error="${errorMsg}"`
        );

        // Check if transient
        if (isTransientError(errorMsg) && transientAttempt < maxTransientRetries) {
          transientAttempt += 1;
          const waitTimeMs = transientAttempt === 1 ? 8000 : 20000;
          onStage?.('retrying', `Chờ ${waitTimeMs / 1000}s trước khi thử lại...`);
          logDiag(
            'info',
            'image.generate.transient_wait',
            `attempt=${transientAttempt} waitingMs=${waitTimeMs}`
          );
          await sleep(waitTimeMs);
          continue; // retry call
        }

        // Check if policy block
        if (isPolicyBlockError(errorMsg)) {
          if (rewriteRound < 2) {
            rewriteRound += 1;
            onStage?.('rewriting', `Viết lại prompt an toàn lần ${rewriteRound}/2...`);
            logDiag(
              'info',
              'image.generate.policy_rewrite_round',
              `triggerError="${errorMsg}" nextRound=${rewriteRound}`
            );
            currentPrompt = await rewritePromptForPolicy(initialPrompt, rewriteRound as 1 | 2);
            logDiag(
              'ok',
              'image.generate.policy_rewrite_done',
              `round=${rewriteRound} newPromptChars=${currentPrompt.length}`
            );
            // Break from transient loop to attempt newly rewritten prompt
            break;
          } else {
            throw new Error(
              'Prompt vi phạm chính sách an toàn nội dung và vẫn bị chặn sau 2 lần viết lại tự động.'
            );
          }
        }

        // Other non-transient, non-policy error
        throw err;
      }
    }

    // If we exited the inner loop due to breaking for policy rewrite, continue while loop
    // If we exhausted transient retries without policy error, throw
    if (rewriteRound === 0 && transientAttempt > maxTransientRetries) {
      throw new Error('Máy chủ quá tải hoặc không phản hồi sau 2 lần thử lại.');
    }
  }

  throw new Error('Không thể tạo ảnh do chính sách an toàn.');
}
