import {
  BackgroundType,
  CharacterConfig,
  FacialExpression,
  HairStyle,
  OutfitPreset,
} from '../types';
import {
  clipWordBoundary,
  describeHairColor,
  FINAL_NO_TEXT_SENTENCE,
  getAccessoriesDescription,
  getBackgroundDescription,
  getExpressionDescription,
  getHairDescription,
  getLayoutDescription,
  getOutfitDescription,
  getStyleSnippet,
  MAX_PROMPT_CHARS,
} from './promptBuilder';

export type VariantChanges = {
  outfitPreset?: OutfitPreset;
  outfitDescription?: string;
  hairStyle?: HairStyle;
  hairColor?: string;
  expression?: FacialExpression;
  background?: BackgroundType;
  extra?: string;
};

/**
 * Returns true when at least one field is set and non-blank (blank or whitespace-only text is not a change).
 */
export function hasVariantChanges(c: VariantChanges | null | undefined): boolean {
  if (!c) return false;
  if (c.outfitPreset !== undefined) return true;
  if (c.outfitDescription !== undefined && c.outfitDescription.trim() !== '') return true;
  if (c.hairStyle !== undefined) return true;
  if (c.hairColor !== undefined && c.hairColor.trim() !== '') return true;
  if (c.expression !== undefined) return true;
  if (c.background !== undefined) return true;
  if (c.extra !== undefined && c.extra.trim() !== '') return true;
  return false;
}

/**
 * Returns a NEW config with the set fields applied; never mutates the input;
 * layout, aspect ratio, tag, model and everything unset stay as they were.
 */
export function applyVariantChanges(
  config: CharacterConfig,
  c: VariantChanges
): CharacterConfig {
  const next: CharacterConfig = { ...config };

  if (c.outfitPreset !== undefined) {
    next.outfitPreset = c.outfitPreset;
  }
  if (c.outfitDescription !== undefined && c.outfitDescription.trim() !== '') {
    next.outfitDescription = c.outfitDescription.trim();
  }
  if (c.hairStyle !== undefined) {
    next.hairStyle = c.hairStyle;
  }
  if (c.hairColor !== undefined && c.hairColor.trim() !== '') {
    next.hairColor = c.hairColor.trim();
  }
  if (c.expression !== undefined) {
    next.expression = c.expression;
  }
  if (c.background !== undefined) {
    next.background = c.background;
  }
  if (c.extra !== undefined && c.extra.trim() !== '') {
    next.extraNotes = c.extra.trim();
  }

  return next;
}

/**
 * Short English list of ONLY the changes, for example "outfit: business suit; expression: gentle smile; extra: holding a red umbrella"; '' when nothing changed.
 * Reuses existing wording helpers of promptBuilder.
 */
export function describeVariantChanges(c: VariantChanges): string {
  const parts: string[] = [];

  const hasPreset = c.outfitPreset !== undefined;
  const hasDesc = c.outfitDescription !== undefined && c.outfitDescription.trim() !== '';

  if (hasPreset || hasDesc) {
    const dummyConfig: CharacterConfig = {
      tag: '',
      displayName: '',
      gender: 'other',
      ageGroup: 'young_adult',
      bodyType: 'balanced',
      roleOccupation: '',
      faceSource: 'ai',
      faceFidelity: 'balanced',
      ethnicity: 'vietnamese',
      styleId: 'modern_anime',
      hairStyle: 'auto',
      hairColor: '',
      expression: 'neutral',
      accessories: [],
      distinctiveFeatures: '',
      outfitPreset: c.outfitPreset ?? 'custom',
      outfitDescription: c.outfitDescription?.trim() ?? '',
      colorPalette: '',
      footwear: 'sneakers',
      layoutId: 'layout_a',
      aspectRatio: '16:9',
      background: 'studio_gray',
      pose: 'natural',
      extraNotes: '',
      qcEnabled: true,
      qcMaxRetries: 1,
      imageCount: 1,
      model: '🍌 Nano Banana Pro',
    };
    const outfitWording = getOutfitDescription(
      dummyConfig,
      c.outfitDescription?.trim() ?? '',
      ''
    );
    parts.push(`outfit: ${outfitWording}`);
  }

  const hasHairStyle = c.hairStyle !== undefined;
  const hasHairColor = c.hairColor !== undefined && c.hairColor.trim() !== '';
  if (hasHairStyle || hasHairColor) {
    const style = c.hairStyle ?? 'auto';
    const color = c.hairColor?.trim() ?? '';
    const hairWording = getHairDescription(style, color, false);
    parts.push(`hair: ${hairWording}`);
  }

  if (c.expression !== undefined) {
    const exprWording = getExpressionDescription(c.expression, false);
    parts.push(`expression: ${exprWording}`);
  }

  if (c.background !== undefined) {
    const bgWording = getBackgroundDescription(c.background);
    parts.push(`background: ${bgWording}`);
  }

  if (c.extra !== undefined && c.extra.trim() !== '') {
    parts.push(`extra: ${c.extra.trim()}`);
  }

  return parts.join('; ');
}

/**
 * Builds variant prompt within MAX_PROMPT_CHARS, ending with FINAL_NO_TEXT_SENTENCE.
 * Restates accessories and distinctive features when config has them, keeping FINAL_NO_TEXT_SENTENCE last.
 */
export function buildVariantPrompt(
  config: CharacterConfig,
  changes: VariantChanges,
  refs: { faceCount: number }
): string {
  const parts: string[] = [];

  // 1. Approved reference image note
  parts.push('Reference image 1 is the approved character design sheet.');

  // 2. Extra face references if any
  if (refs.faceCount > 0) {
    if (refs.faceCount === 1) {
      parts.push("Reference image 2 shows the person's real face.");
    } else {
      parts.push(`Reference images 2-${refs.faceCount + 1} show the person's real face.`);
    }
  }

  // 3. Layout description & core character continuity directive
  const layoutDesc = getLayoutDescription(config.layoutId, config.aspectRatio);
  const styleSnippet = getStyleSnippet(config.styleId);
  parts.push(
    `Create a new character design sheet with the same layout (${layoutDesc}) and the same character: identical face, hair unless changed, body proportions, skin tone and art style (${styleSnippet}).`
  );

  // 4. Change-only directive with clipped free text
  const clippedChanges: VariantChanges = {
    ...changes,
    outfitDescription: changes.outfitDescription
      ? clipWordBoundary(changes.outfitDescription, 240)
      : undefined,
    extra: changes.extra ? clipWordBoundary(changes.extra, 240) : undefined,
  };
  const diffSummary = describeVariantChanges(clippedChanges);
  if (diffSummary) {
    parts.push(`Change only: ${diffSummary}. Keep everything else identical.`);
  }

  // 5. Restate unchanged accessories if non-empty
  if (config.accessories && config.accessories.length > 0) {
    const accDesc = getAccessoriesDescription(config.accessories);
    if (accDesc) {
      parts.push(`Keep the same accessories: ${accDesc}.`);
    }
  }

  // 6. Restate unchanged distinctive features if set
  if (config.distinctiveFeatures && config.distinctiveFeatures.trim() !== '') {
    const clippedFeatures = clipWordBoundary(config.distinctiveFeatures, 160);
    if (clippedFeatures) {
      parts.push(`Keep the identifying details: ${clippedFeatures}.`);
    }
  }

  // 7. Canvas aspect ratio sentence
  parts.push(`Canvas aspect ratio ${config.aspectRatio}.`);

  // 8. Background sentence only when background actually changed
  if (changes.background !== undefined) {
    parts.push(`Canvas background is a ${getBackgroundDescription(changes.background)}.`);
  }

  // 9. Mandatory final no-text sentence
  parts.push(FINAL_NO_TEXT_SENTENCE);

  let fullPrompt = parts.join(' ');
  if (fullPrompt.length <= MAX_PROMPT_CHARS) {
    return fullPrompt;
  }

  // If over MAX_PROMPT_CHARS, progressively clip free text in diffSummary and distinctive features
  const shorterChanges: VariantChanges = {
    ...clippedChanges,
    outfitDescription: changes.outfitDescription
      ? clipWordBoundary(changes.outfitDescription, 120)
      : undefined,
    extra: changes.extra ? clipWordBoundary(changes.extra, 120) : undefined,
  };
  const shorterSummary = describeVariantChanges(shorterChanges);

  const accSentence =
    config.accessories && config.accessories.length > 0
      ? `Keep the same accessories: ${getAccessoriesDescription(config.accessories)}.`
      : '';

  const idSentence =
    config.distinctiveFeatures && config.distinctiveFeatures.trim() !== ''
      ? `Keep the identifying details: ${clipWordBoundary(config.distinctiveFeatures, 80)}.`
      : '';

  const fallbackParts = [
    parts[0],
    ...(refs.faceCount > 0 ? [parts[1]] : []),
    `Create a new character design sheet with the same layout (${layoutDesc}) and the same character: identical face, hair unless changed, body proportions, skin tone and art style (${styleSnippet}).`,
    shorterSummary ? `Change only: ${shorterSummary}. Keep everything else identical.` : '',
    accSentence,
    idSentence,
    `Canvas aspect ratio ${config.aspectRatio}.`,
    ...(changes.background !== undefined ? [`Canvas background is a ${getBackgroundDescription(changes.background)}.`] : []),
    FINAL_NO_TEXT_SENTENCE,
  ].filter(Boolean);

  let candidate = fallbackParts.join(' ');
  if (candidate.length <= MAX_PROMPT_CHARS) {
    return candidate;
  }

  // Hard trim preserving final sentence
  const beforeFinal = candidate.slice(0, candidate.length - FINAL_NO_TEXT_SENTENCE.length).trim();
  const allowedLen = MAX_PROMPT_CHARS - FINAL_NO_TEXT_SENTENCE.length - 1;
  const clippedBase = clipWordBoundary(beforeFinal, allowedLen);
  return `${clippedBase} ${FINAL_NO_TEXT_SENTENCE}`;
}
