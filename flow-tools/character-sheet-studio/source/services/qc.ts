import { Flow } from 'flow-sdk';
import { QcReport, SheetLayoutId } from '../types';
import { logDiag } from './diagnostics';
import { FINAL_NO_TEXT_SENTENCE, MAX_PROMPT_CHARS } from './promptBuilder';

/**
 * Expected distinct figures a correct character sheet layout shows:
 * layout_a: 4 (1 head portrait + 3 full-body views)
 * layout_b: 7 (1 portrait + 3 face close-ups + 3 full-body views)
 * layout_c: 8 (1 head portrait + 3 full-body views + 4 expression vignettes)
 * layout_d: 5 (5 synchronized full-body views)
 * layout_e: 3 (3 bust/portrait studies)
 * layout_f: 6 (2x3 grid of 6 emotion busts)
 */
export function expectedViewCount(layoutId: SheetLayoutId): number {
  switch (layoutId) {
    case 'layout_a':
      return 4;
    case 'layout_b':
      return 7;
    case 'layout_c':
      return 8;
    case 'layout_d':
      return 5;
    case 'layout_e':
      return 3;
    case 'layout_f':
      return 6;
    default:
      return 4;
  }
}

/**
 * Parses raw JSON reply from Flow.generate.text into a validated QcReport.
 * Never throws. On failure, returns available: false, score: 0, verdict: 'ok'.
 */
export function parseQc(text: string, layoutId: SheetLayoutId): QcReport {
  const expectedViews = expectedViewCount(layoutId);

  const fallback: QcReport = {
    available: false,
    score: 0,
    viewCount: 0,
    expectedViews,
    hasText: false,
    textFound: [],
    layoutOk: true,
    faceMatch: null,
    issues: [],
    verdict: 'ok',
  };

  if (!text || typeof text !== 'string') {
    return fallback;
  }

  // Strip markdown code fences if present
  let clean = text
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .trim();

  // Find JSON object boundaries
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }

  try {
    const raw = JSON.parse(clean);
    if (!raw || typeof raw !== 'object') {
      return fallback;
    }

    const rawScore = typeof raw.score === 'number' && !isNaN(raw.score) ? raw.score : 0;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    const viewCount =
      typeof raw.viewCount === 'number' && !isNaN(raw.viewCount)
        ? Math.max(0, Math.round(raw.viewCount))
        : 0;

    // Strict boolean check
    const hasText = raw.hasText === true;

    const textFound = Array.isArray(raw.textFound)
      ? raw.textFound.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];

    const layoutOk = typeof raw.layoutOk === 'boolean' ? raw.layoutOk : true;

    let faceMatch: number | null = null;
    if (typeof raw.faceMatch === 'number' && !isNaN(raw.faceMatch)) {
      faceMatch = Math.max(0, Math.min(100, Math.round(raw.faceMatch)));
    }

    const issues = Array.isArray(raw.issues)
      ? raw.issues
          .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
          .slice(0, 3)
      : [];

    const preliminaryReport: QcReport = {
      available: true,
      score,
      viewCount,
      expectedViews,
      hasText,
      textFound,
      layoutOk,
      faceMatch,
      issues,
      verdict: 'ok',
    };

    // Calculate verdict
    const decision = decideRetry(preliminaryReport, { minScore: 65 });
    preliminaryReport.verdict = decision.retry ? 'retry' : 'ok';

    return preliminaryReport;
  } catch {
    return fallback;
  }
}

/**
 * Decides whether an image should be retried based on quality rules.
 */
export function decideRetry(
  report: QcReport,
  opts: { minScore: number; strictFace?: boolean }
): { retry: boolean; reasons: string[] } {
  if (!report.available) {
    return { retry: false, reasons: [] };
  }

  const reasons: string[] = [];

  if (report.hasText) {
    reasons.push('Text or typography painted in picture');
  }

  if (!report.layoutOk) {
    reasons.push('Layout composition incorrect');
  }

  if (report.viewCount < report.expectedViews) {
    reasons.push(`Incomplete view count (${report.viewCount}/${report.expectedViews})`);
  }

  if (report.score < opts.minScore) {
    reasons.push(`Quality score below threshold (${report.score} < ${opts.minScore})`);
  }

  if (opts.strictFace && report.faceMatch !== null && report.faceMatch < 50) {
    reasons.push(`Face likeness below 50% (${report.faceMatch}%)`);
  }

  return {
    retry: reasons.length > 0,
    reasons,
  };
}

/**
 * Builds an addendum string to steer the retry prompt towards fixing flaws.
 * Max 300 characters.
 */
export function buildRetryAddendum(report: QcReport): string {
  const parts: string[] = [];

  if (report.hasText) {
    parts.push('no text, words or labels anywhere (remove all writing)');
  }

  if (report.viewCount < report.expectedViews) {
    parts.push(`strictly draw exactly ${report.expectedViews} distinct character figures`);
  }

  if (report.issues && report.issues.length > 0) {
    const cleanIssues = report.issues.slice(0, 3).map((iss) => iss.trim()).filter(Boolean);
    if (cleanIssues.length > 0) {
      parts.push(`fix previous defects: ${cleanIssues.join('; ')}`);
    }
  }

  let text = parts.join(', ');
  if (!text) {
    text = 'improve character turnaround clarity and ensure zero text or labels';
  }

  const prefix = 'CRITICAL CORRECTION FOR THIS RETRY: ';
  let full = `${prefix}${text}.`;
  if (full.length > 300) {
    full = full.slice(0, 297) + '...';
  }
  return full;
}

/**
 * Appends the retry addendum immediately BEFORE the final mandatory no-text sentence,
 * keeping the entire prompt within MAX_PROMPT_CHARS (trimming the addendum if needed, never the final sentence).
 * If the prompt does not end with FINAL_NO_TEXT_SENTENCE, appends the addendum at the end within MAX_PROMPT_CHARS.
 */
export function appendRetryAddendum(prompt: string, addendum: string): string {
  const cleanPrompt = prompt.trim();
  let base = cleanPrompt;
  let hasFinalSentence = false;

  if (cleanPrompt.endsWith(FINAL_NO_TEXT_SENTENCE)) {
    base = cleanPrompt.slice(0, -FINAL_NO_TEXT_SENTENCE.length).trim();
    hasFinalSentence = true;
  }

  const spaceBefore = base.length > 0 ? ' ' : '';
  const spaceAfter = hasFinalSentence ? ' ' : '';
  const finalPart = hasFinalSentence ? FINAL_NO_TEXT_SENTENCE : '';

  // Max characters available for addendum
  const availableChars = MAX_PROMPT_CHARS - (base.length + spaceBefore.length + spaceAfter.length + finalPart.length);

  let safeAddendum = addendum.trim();
  if (availableChars <= 0) {
    // Cannot fit addendum without exceeding max characters
    return hasFinalSentence ? `${base}${spaceAfter}${finalPart}` : base;
  }

  if (safeAddendum.length > availableChars) {
    safeAddendum = safeAddendum.slice(0, Math.max(0, availableChars - 3)).trim() + '...';
  }

  return `${base}${spaceBefore}${safeAddendum}${spaceAfter}${finalPart}`;
}

export interface InspectSheetOptions {
  base64: string;
  mimeType: string;
  layoutId: SheetLayoutId;
  faceRefs?: { base64: string; mimeType: string }[];
}

/**
 * Inspects a generated character sheet via Flow.generate.text.
 * Never throws: on failure returns available: false.
 */
export async function inspectSheet(options: InspectSheetOptions): Promise<QcReport> {
  const { base64, mimeType, layoutId, faceRefs } = options;
  const expectedViews = expectedViewCount(layoutId);

  const images: Array<{ base64: string; mimeType?: string }> = [
    { base64, mimeType },
  ];

  const hasFaceRef = faceRefs && faceRefs.length > 0 && faceRefs[0].base64;
  if (hasFaceRef) {
    images.push({
      base64: faceRefs[0].base64,
      mimeType: faceRefs[0].mimeType || 'image/jpeg',
    });
  }

  const systemInstruction = `You inspect a character design sheet.
The sheet must display exactly ${expectedViews} distinct character figures according to layout ${layoutId}.
Check carefully whether any written words, labels, titles, callouts, letters, or numbers are painted anywhere in the image.
Reply with ONLY a valid JSON object with keys:
- score: number 0-100 (overall production quality, consistency, and cleanliness)
- viewCount: number of distinct figures/portraits visible
- hasText: boolean (true if ANY written text, words, captions, or typography exist in the image)
- textFound: string[] (list of any words or letters seen)
- layoutOk: boolean (true if composition follows model sheet conventions)
- faceMatch: number 0-100 or null (similarity of the character's face to the reference face, provided only when a reference face image is given)
- issues: string[] (max 3 short English problems, e.g. "painted text banner", "missing profile view", "blurry face")`;

  const userPrompt = `Inspect this character sheet image for layout adherence (${expectedViews} expected views), painted text artifacts, and face consistency. Return ONLY JSON.`;

  logDiag(
    'call',
    'qc.inspect',
    `layoutId=${layoutId} expectedViews=${expectedViews} hasFaceRef=${Boolean(hasFaceRef)}`
  );

  const startTime = Date.now();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('TIMEOUT: QC inspection exceeded 60s.'));
    }, 60000);
  });

  try {
    const callPromise = Flow.generate.text(userPrompt, {
      systemInstruction,
      thinkingLevel: 'low',
      images,
    });

    const res = await Promise.race([callPromise, timeoutPromise]);
    const durationMs = Date.now() - startTime;
    const rawText = res.text || '';

    const report = parseQc(rawText, layoutId);

    logDiag(
      'ok',
      'qc.inspect',
      `duration=${durationMs}ms score=${report.score} views=${report.viewCount}/${report.expectedViews} hasText=${report.hasText} faceMatch=${report.faceMatch} verdict=${report.verdict}`
    );

    return report;
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    logDiag('error', 'qc.inspect', `duration=${durationMs}ms error="${errorMsg}"`);

    return {
      available: false,
      score: 0,
      viewCount: 0,
      expectedViews,
      hasText: false,
      textFound: [],
      layoutOk: true,
      faceMatch: null,
      issues: [],
      verdict: 'ok',
    };
  }
}
