import { Flow } from 'flow-sdk';
import { AgeGroup, CharacterConfig, FaceDna, RefImage } from '../types';
import { logDiag } from './diagnostics';

const TIMEOUT_MS = 60000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(errorMsg));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

function emptyFaceDna(): FaceDna {
  return {
    summary: '',
    genderImpression: '',
    ageGroupGuess: '',
    details: {
      faceShape: '',
      eyes: '',
      brows: '',
      nose: '',
      lips: '',
      skinTone: '',
      hair: '',
      facialHair: '',
      ageImpression: '',
      distinctiveMarks: '',
    },
  };
}

const VALID_AGE_GROUPS: AgeGroup[] = ['child', 'teen', 'young_adult', 'middle_aged', 'elderly'];

export async function describeFace(refs: RefImage[]): Promise<FaceDna> {
  if (!refs || refs.length === 0) {
    logDiag('info', 'faceDna.describeFace', 'No face reference images supplied');
    return emptyFaceDna();
  }

  const systemInstruction =
    'Describe only visible facial features for an illustrator, neutral and factual, no names, no guesses about who the person is; reply with ONLY a JSON object with keys summary (one English sentence), genderImpression (one of "male", "female", "ambiguous" based on apparent gender presentation only), ageGroupGuess (one of "child", "teen", "young_adult", "middle_aged", "elderly"), faceShape, eyes, brows, nose, lips, skinTone, hair, facialHair, ageImpression, distinctiveMarks.';

  const images = refs.map((r) => ({
    base64: r.base64,
    mimeType: r.mimeType,
  }));

  const refSummary = refs.map((r) => `id=${r.id} mediaId=${r.mediaId ?? 'null'} len=${r.base64.length}`).join('; ');
  logDiag('call', 'faceDna.describeFace', `imageCount=${refs.length} refs=[${refSummary}]`);
  const startTime = Date.now();

  try {
    const callPromise = Flow.generate.text(
      'Please analyze the face in the reference image(s) and provide the JSON object describing visible facial features, apparent gender impression, and age group guess.',
      {
        systemInstruction,
        thinkingLevel: 'low',
        images,
      }
    );

    const res = await withTimeout(
      callPromise,
      TIMEOUT_MS,
      'TIMEOUT: Phân tích diện mạo khuôn mặt vượt quá 60 giây.'
    );

    const durationMs = Date.now() - startTime;
    let raw = res.text || '';
    // Strip code fences and outer trim
    raw = raw
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/```/g, '')
      .trim();

    try {
      const parsed = JSON.parse(raw);
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';

      // Normalize genderImpression
      let genderImpression: 'male' | 'female' | 'ambiguous' | '' = '';
      const rawGender = typeof parsed.genderImpression === 'string' ? parsed.genderImpression.toLowerCase().trim() : '';
      if (rawGender === 'male' || rawGender === 'female' || rawGender === 'ambiguous') {
        genderImpression = rawGender;
      }

      // Normalize ageGroupGuess
      let ageGroupGuess: AgeGroup | '' = '';
      const rawAgeGroup = typeof parsed.ageGroupGuess === 'string' ? parsed.ageGroupGuess.toLowerCase().trim() : '';
      if (VALID_AGE_GROUPS.includes(rawAgeGroup as AgeGroup)) {
        ageGroupGuess = rawAgeGroup as AgeGroup;
      }

      const result: FaceDna = {
        summary,
        genderImpression,
        ageGroupGuess,
        details: {
          faceShape: typeof parsed.faceShape === 'string' ? parsed.faceShape.trim() : '',
          eyes: typeof parsed.eyes === 'string' ? parsed.eyes.trim() : '',
          brows: typeof parsed.brows === 'string' ? parsed.brows.trim() : '',
          nose: typeof parsed.nose === 'string' ? parsed.nose.trim() : '',
          lips: typeof parsed.lips === 'string' ? parsed.lips.trim() : '',
          skinTone: typeof parsed.skinTone === 'string' ? parsed.skinTone.trim() : '',
          hair: typeof parsed.hair === 'string' ? parsed.hair.trim() : '',
          facialHair: typeof parsed.facialHair === 'string' ? parsed.facialHair.trim() : '',
          ageImpression: typeof parsed.ageImpression === 'string' ? parsed.ageImpression.trim() : '',
          distinctiveMarks: typeof parsed.distinctiveMarks === 'string' ? parsed.distinctiveMarks.trim() : '',
        },
      };

      logDiag(
        'ok',
        'faceDna.describeFace',
        `duration=${durationMs}ms summaryChars=${summary.length} gender=${genderImpression} ageGroup=${ageGroupGuess}`
      );

      return result;
    } catch {
      logDiag('error', 'faceDna.describeFace.parse', `duration=${durationMs}ms JSON parse failed on raw text`);
      return emptyFaceDna();
    }
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    logDiag('error', 'faceDna.describeFace', `duration=${durationMs}ms error="${errorMsg}"`);
    throw err;
  }
}

/**
 * Returns a partial CharacterConfig patch from analyzed FaceDna:
 * Sets gender if 'male' or 'female' (ambiguous or '' changes nothing).
 * Sets ageGroup if valid.
 * Sets numericAge: null so the general age group drives the sheet unless explicitly typed.
 */
export function faceDnaToConfigPatch(dna: FaceDna | null): Partial<CharacterConfig> {
  if (!dna) return {};
  const patch: Partial<CharacterConfig> = {};

  const g = dna.genderImpression;
  if (g === 'male' || g === 'female') {
    patch.gender = g;
  }

  const a = dna.ageGroupGuess;
  if (a && VALID_AGE_GROUPS.includes(a)) {
    patch.ageGroup = a;
    patch.numericAge = null;
  }

  return patch;
}

export function applyFaceDnaToConfig(config: CharacterConfig, dna: FaceDna | null): CharacterConfig {
  if (config.faceSource !== 'upload') return config;
  const patch = faceDnaToConfigPatch(dna);
  return Object.keys(patch).length === 0 ? config : { ...config, ...patch };
}

export async function describeOutfit(refs: RefImage[]): Promise<string> {
  if (!refs || refs.length === 0) {
    logDiag('info', 'outfitDna.describeOutfit', 'No outfit reference images supplied');
    return '';
  }

  const systemInstruction =
    'Describe the outfit for an illustrator in one English paragraph about garments, colours, materials, accessories and footwear (no names, no identities). Do NOT use markdown fences or quotes.';

  const images = refs.map((r) => ({
    base64: r.base64,
    mimeType: r.mimeType,
  }));

  const refSummary = refs.map((r) => `id=${r.id} mediaId=${r.mediaId ?? 'null'} len=${r.base64.length}`).join('; ');
  logDiag('call', 'outfitDna.describeOutfit', `imageCount=${refs.length} refs=[${refSummary}]`);
  const startTime = Date.now();

  try {
    const callPromise = Flow.generate.text(
      'Please describe the outfit and garments visible in the reference image(s).',
      {
        systemInstruction,
        thinkingLevel: 'low',
        images,
      }
    );

    const res = await withTimeout(
      callPromise,
      TIMEOUT_MS,
      'TIMEOUT: Phân tích trang phục vượt quá 60 giây.'
    );

    const durationMs = Date.now() - startTime;
    let raw = res.text || '';
    raw = raw
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/```/g, '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .replace(/\r?\n+/g, ' ')
      .trim();

    logDiag('ok', 'outfitDna.describeOutfit', `duration=${durationMs}ms resultChars=${raw.length}`);
    return raw;
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    logDiag('error', 'outfitDna.describeOutfit', `duration=${durationMs}ms error="${errorMsg}"`);
    throw err;
  }
}

/**
 * Clips text to maxLen at a word boundary.
 */
function clipWordBoundary(str: string, maxLen: number): string {
  if (!str) return '';
  const trimmed = str.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 0) {
    return cut.slice(0, lastSpace).trim();
  }
  return cut.trim();
}

/**
 * formatFaceDna returns at most 420 characters:
 * summary first, then non-empty details in order:
 * distinctiveMarks, hair, skinTone, eyes, faceShape, nose, lips, brows, facialHair, ageImpression.
 * Each as "key: value", clipped at a word boundary so summary is the last thing cut.
 */
export function formatFaceDna(dna: FaceDna): string {
  if (!dna) return '';

  const summary = (dna.summary || '').trim();
  const d = dna.details || {};

  const detailEntries: Array<[string, string]> = [
    ['distinctive marks', d.distinctiveMarks],
    ['hair', d.hair],
    ['skin tone', d.skinTone],
    ['eyes', d.eyes],
    ['face shape', d.faceShape],
    ['nose', d.nose],
    ['lips', d.lips],
    ['brows', d.brows],
    ['facial hair', d.facialHair],
    ['age impression', d.ageImpression],
  ];

  const detailPairs: string[] = [];
  for (const [k, v] of detailEntries) {
    if (v && v.trim()) {
      detailPairs.push(`${k}: ${v.trim()}`);
    }
  }

  // Construct components starting with summary
  let result = summary;
  for (const pair of detailPairs) {
    const candidate = result ? `${result}; ${pair}` : pair;
    if (candidate.length <= 420) {
      result = candidate;
    } else {
      break;
    }
  }

  if (result.length > 420) {
    result = clipWordBoundary(result, 420);
  }

  return result;
}
