import { QcReport } from '../types';
import { appendRetryAddendum, buildRetryAddendum, decideRetry } from './qc';

export interface TakeSheet { base64: string; mimeType: string; mediaId: string; promptUsed: string; rewriteRound: number; }
export interface TakeDeps { generate: (prompt: string) => Promise<TakeSheet>; inspect: (sheet: TakeSheet) => Promise<QcReport>; }
export interface TakeQcUpdate { sheet: TakeSheet; report: QcReport; attempts: number; changed: boolean; }
export interface TakeOptions {
  prompt: string; qcEnabled: boolean; maxRetries: number; minScore: number; strictFace: boolean;
  isAborted: () => boolean;
  onFirstImage: (sheet: TakeSheet) => void | Promise<void>;
  onQc: (update: TakeQcUpdate) => void | Promise<void>;
  onQcError?: (error: unknown) => void;
  onRetry?: (attempt: number, reasons: string[]) => void;
}

export async function runTake(deps: TakeDeps, options: TakeOptions): Promise<void> {
  const first = await deps.generate(options.prompt);
  await options.onFirstImage(first);
  if (!options.qcEnabled) return;
  try {
    let best = first;
    let report = await deps.inspect(best);
    let attempts = 0;
    await options.onQc({ sheet: best, report, attempts, changed: false });
    let currentPrompt = options.prompt;
    while (attempts < options.maxRetries && !options.isAborted()) {
      const decision = decideRetry(report, { minScore: options.minScore, strictFace: options.strictFace });
      if (!decision.retry) break;
      attempts += 1;
      options.onRetry?.(attempts, decision.reasons);
      currentPrompt = appendRetryAddendum(currentPrompt, buildRetryAddendum(report));
      const retry = await deps.generate(currentPrompt);
      const retryReport = await deps.inspect(retry);
      const keepRetry = retryReport.score >= report.score;
      if (keepRetry) { best = retry; report = retryReport; }
      await options.onQc({ sheet: best, report, attempts, changed: keepRetry });
    }
  } catch (error) {
    options.onQcError?.(error);
  }
}

export async function runWithConcurrency<T>(count: number, limit: number, task: (index: number) => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(count);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, count));
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const index = next;
      next += 1;
      try { results[index] = { status: 'fulfilled', value: await task(index) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

export interface BestOfOptions { prompt: string; count: number; minScore: number; strictFace: boolean; isAborted: () => boolean; }
export interface BestOfResult { sheet: TakeSheet; report: QcReport | null; candidates: number; }

export function rankCandidate(report: QcReport | null, opts: { minScore: number; strictFace: boolean }): number {
  if (!report || !report.available) return 0;
  const flagged = decideRetry(report, { minScore: opts.minScore, strictFace: opts.strictFace }).retry;
  const quality = report.faceMatch !== null ? report.faceMatch + report.score * 0.2 : report.score;
  return (flagged ? 0 : 1000) + quality;
}

export async function runBestOf(deps: TakeDeps, options: BestOfOptions): Promise<BestOfResult> {
  const count = Math.max(1, Math.floor(options.count));
  const settled = await runWithConcurrency(count, count, async () => {
    const sheet = await deps.generate(options.prompt);
    let report: QcReport | null = null;
    if (!options.isAborted()) {
      try { report = await deps.inspect(sheet); } catch { report = null; }
    }
    return { sheet, report };
  });
  const made: Array<{ sheet: TakeSheet; report: QcReport | null }> = [];
  let firstError: unknown = null;
  for (const item of settled) {
    if (item.status === 'fulfilled') made.push(item.value);
    else if (firstError === null) firstError = item.reason;
  }
  if (made.length === 0) throw firstError ?? new Error('No candidate was generated');
  let best = made[0];
  let bestRank = rankCandidate(best.report, options);
  for (const candidate of made.slice(1)) {
    const rank = rankCandidate(candidate.report, options);
    if (rank > bestRank) { best = candidate; bestRank = rank; }
  }
  return { sheet: best.sheet, report: best.report, candidates: made.length };
}
