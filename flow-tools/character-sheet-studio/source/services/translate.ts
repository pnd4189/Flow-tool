import { Flow } from 'flow-sdk';
import { CharacterConfig } from '../types';
import { logDiag } from './diagnostics';

/**
 * Returns true if the text contains non-ASCII letters (e.g. Vietnamese accents).
 */
export function needsTranslation(text: string): boolean {
  if (!text || !text.trim()) return false;
  // Non-ASCII character test
  return /[^\x00-\x7F]/.test(text);
}

interface TranslatableFields {
  roleOccupation: string;
  distinctiveFeatures: string;
  outfitDescription: string;
  colorPalette: string;
  extraNotes: string;
}

// In-memory translation cache keyed by JSON of the 5 fields
const translationCache = new Map<string, TranslatableFields>();

/**
 * Translates free-text config fields into concrete visual English descriptions.
 * Only translates fields that contain non-ASCII characters.
 * displayName and tag are NEVER translated.
 * Makes at most ONE Flow.generate.text call with 30s timeout. Never throws.
 */
export async function translateConfigFields(config: CharacterConfig): Promise<CharacterConfig> {
  const currentFields: TranslatableFields = {
    roleOccupation: config.roleOccupation || '',
    distinctiveFeatures: config.distinctiveFeatures || '',
    outfitDescription: config.outfitDescription || '',
    colorPalette: config.colorPalette || '',
    extraNotes: config.extraNotes || '',
  };

  const fieldsToTranslate: Partial<Record<keyof TranslatableFields, string>> = {};
  if (needsTranslation(currentFields.roleOccupation)) {
    fieldsToTranslate.roleOccupation = currentFields.roleOccupation;
  }
  if (needsTranslation(currentFields.distinctiveFeatures)) {
    fieldsToTranslate.distinctiveFeatures = currentFields.distinctiveFeatures;
  }
  if (needsTranslation(currentFields.outfitDescription)) {
    fieldsToTranslate.outfitDescription = currentFields.outfitDescription;
  }
  if (needsTranslation(currentFields.colorPalette)) {
    fieldsToTranslate.colorPalette = currentFields.colorPalette;
  }
  if (needsTranslation(currentFields.extraNotes)) {
    fieldsToTranslate.extraNotes = currentFields.extraNotes;
  }

  // If nothing needs translation, return original config as-is without API call
  const fieldKeys = Object.keys(fieldsToTranslate);
  if (fieldKeys.length === 0) {
    logDiag('info', 'translate.skip', 'No non-ASCII fields requiring translation');
    return { ...config };
  }

  const cacheKey = JSON.stringify(currentFields);
  if (translationCache.has(cacheKey)) {
    logDiag('info', 'translate.cache_hit', `Cached fields: ${fieldKeys.join(',')}`);
    const cached = translationCache.get(cacheKey)!;
    return {
      ...config,
      ...cached,
    };
  }

  const systemInstruction = `Translate each field into plain English describing only what can be drawn (colours, garments, marks, props), at most 25 words per field, no quotes, no real people's names; reply with ONLY a JSON object using the same keys.`;

  const userPrompt = `Translate these fields into plain English visual descriptions for character illustration:\n${JSON.stringify(
    fieldsToTranslate,
    null,
    2
  )}`;

  logDiag(
    'call',
    'translate.config',
    `fields=${fieldKeys.join(',')} promptChars=${userPrompt.length}`
  );

  const startTime = Date.now();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('TIMEOUT: Translation exceeded 30 seconds.'));
    }, 30000);
  });

  try {
    const callPromise = Flow.generate.text(userPrompt, {
      systemInstruction,
      thinkingLevel: 'low',
    });

    const res = await Promise.race([callPromise, timeoutPromise]);
    const durationMs = Date.now() - startTime;
    let rawText = res.text || '';

    // Strip markdown code fences if present
    rawText = rawText
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/```/g, '')
      .trim();

    const parsed = JSON.parse(rawText) as Record<string, string>;

    const translatedFields: TranslatableFields = {
      roleOccupation:
        typeof parsed.roleOccupation === 'string' && parsed.roleOccupation.trim()
          ? parsed.roleOccupation.trim()
          : currentFields.roleOccupation,
      distinctiveFeatures:
        typeof parsed.distinctiveFeatures === 'string' && parsed.distinctiveFeatures.trim()
          ? parsed.distinctiveFeatures.trim()
          : currentFields.distinctiveFeatures,
      outfitDescription:
        typeof parsed.outfitDescription === 'string' && parsed.outfitDescription.trim()
          ? parsed.outfitDescription.trim()
          : currentFields.outfitDescription,
      colorPalette:
        typeof parsed.colorPalette === 'string' && parsed.colorPalette.trim()
          ? parsed.colorPalette.trim()
          : currentFields.colorPalette,
      extraNotes:
        typeof parsed.extraNotes === 'string' && parsed.extraNotes.trim()
          ? parsed.extraNotes.trim()
          : currentFields.extraNotes,
    };

    translationCache.set(cacheKey, translatedFields);

    logDiag(
      'ok',
      'translate.config',
      `duration=${durationMs}ms translatedCount=${Object.keys(translatedFields).length}`
    );

    return {
      ...config,
      ...translatedFields,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    logDiag('error', 'translate.config', `duration=${durationMs}ms error="${errorMsg}"`);
    // On any failure (timeout, API error, parse failure), return original config safely without throwing
    return { ...config };
  }
}
