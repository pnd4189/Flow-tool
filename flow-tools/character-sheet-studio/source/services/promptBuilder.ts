import { AspectRatioOption, CharacterConfig, PromptRefs, SheetLayoutId, VisualStyleId } from '../types';

export const MAX_PROMPT_CHARS = 3400;

export const FINAL_NO_TEXT_SENTENCE =
  'Absolutely no text, no captions, no callouts, no arrows, no handwriting, no labels, no watermarks, no rulers.';

/**
 * Sanitizes tag to lowercase a-z, 0-9, and underscore with max 24 chars.
 */
export function sanitizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24);
}

/**
 * Determines orientation group from aspect ratio.
 */
export function orientationOf(aspect: AspectRatioOption): 'landscape' | 'square' | 'portrait' {
  if (aspect === '16:9' || aspect === '4:3') return 'landscape';
  if (aspect === '1:1') return 'square';
  return 'portrait';
}

interface PresetColorTarget {
  name: string;
  r: number;
  g: number;
  b: number;
}

const PRESET_COLOR_TARGETS: PresetColorTarget[] = [
  { name: 'jet black', r: 0x1a, g: 0x18, b: 0x1b },
  { name: 'deep brown', r: 0x3e, g: 0x27, b: 0x23 },
  { name: 'chestnut brown', r: 0x79, g: 0x55, b: 0x48 },
  { name: 'platinum blonde', r: 0xec, g: 0xef, b: 0xf1 },
  { name: 'straw blonde', r: 0xff, g: 0xd5, b: 0x4f },
  { name: 'burgundy red', r: 0xb7, g: 0x1c, b: 0x1c },
  { name: 'azure blue', r: 0x02, g: 0x88, b: 0xd1 },
];

/**
 * Maps a hex string to one of the 7 predefined descriptive color phrases using nearest RGB Euclidean distance.
 */
export function describeHairColor(hex: string): string {
  if (!hex) return 'natural dark';
  const cleanHex = hex.trim().replace(/^#/, '');
  let r = 0;
  let g = 0;
  let b = 0;

  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    r = isNaN(r) ? 0 : r;
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    g = isNaN(g) ? 0 : g;
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
    b = isNaN(b) ? 0 : b;
  } else if (cleanHex.length === 6) {
    r = parseInt(cleanHex.slice(0, 2), 16);
    g = parseInt(cleanHex.slice(2, 4), 16);
    b = parseInt(cleanHex.slice(4, 6), 16);
  } else {
    return 'natural dark';
  }

  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return 'natural dark';
  }

  let best = PRESET_COLOR_TARGETS[0].name;
  let minDistance = Infinity;

  for (const target of PRESET_COLOR_TARGETS) {
    const dr = r - target.r;
    const dg = g - target.g;
    const db = b - target.b;
    const distSq = dr * dr + dg * dg + db * db;
    if (distSq < minDistance) {
      minDistance = distSq;
      best = target.name;
    }
  }

  return best;
}

/**
 * Clips text at a word boundary to stay within maxChars.
 */
export function clipWordBoundary(str: string, maxChars: number): string {
  if (!str) return '';
  const trimmed = str.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const sliced = trimmed.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace > 0) {
    return sliced.slice(0, lastSpace).trim();
  }
  return sliced.trim();
}

/**
 * Maps ethnicity to concise English descriptor.
 */
export function getEthnicityDescription(ethnicity: CharacterConfig['ethnicity']): string {
  switch (ethnicity) {
    case 'vietnamese':
      return 'Vietnamese heritage with natural Southeast Asian facial features';
    case 'east_asian':
      return 'East Asian heritage';
    case 'southeast_asian':
      return 'Southeast Asian heritage';
    case 'south_asian':
      return 'South Asian heritage';
    case 'middle_eastern':
      return 'Middle Eastern heritage';
    case 'african':
      return 'African heritage';
    case 'european':
      return 'European heritage';
    case 'latino':
      return 'Latino heritage';
    case 'mixed':
      return 'Multiracial mixed heritage';
    default:
      return 'Vietnamese heritage';
  }
}

/**
 * Maps age group & optional exact age to English.
 */
export function getAgeDescription(ageGroup: CharacterConfig['ageGroup'], numericAge?: number | null): string {
  const ageExact = numericAge && numericAge > 0 ? `, age ${numericAge}` : '';
  switch (ageGroup) {
    case 'child':
      return `child (8-12 years old${ageExact})`;
    case 'teen':
      return `teenager (15-18 years old${ageExact})`;
    case 'young_adult':
      return `young adult in 20s${ageExact}`;
    case 'middle_aged':
      return `middle-aged adult in 40s-50s${ageExact}`;
    case 'elderly':
      return `elderly senior citizen in late 60s-70s${ageExact}`;
    default:
      return `young adult${ageExact}`;
  }
}

/**
 * Maps body types to concise English.
 */
export function getBodyDescription(bodyType: CharacterConfig['bodyType']): string {
  switch (bodyType) {
    case 'slender':
      return 'slender lean build';
    case 'muscular':
      return 'athletic muscular build';
    case 'full_figured':
      return 'stout full-figured build';
    case 'balanced':
    default:
      return 'balanced average build';
  }
}

/**
 * Maps visual style to concise rendering instructions.
 * Must keep "not photorealistic" in the 2D styles.
 */
export function getStyleSnippet(styleId: VisualStyleId): string {
  switch (styleId) {
    case 'photorealistic':
      return 'photorealistic studio photo, 8k cinematic studio light, authentic skin texture, realistic cloth microfibers';
    case 'modern_anime':
      return 'Strictly 2D hand-drawn illustration, modern anime style, crisp line art, flat cel colouring, expressive animated eyes, not photorealistic, no 3D rendering';
    case '2d_animation':
      return 'Strictly 2D hand-drawn animation visual development, clear silhouette lines, flat painted cel colours, clean graphic shapes, not photorealistic, no 3D rendering';
    case 'manga_bw':
      return 'Strictly authentic black and white Japanese manga art, fine screentone halftones, bold black ink linework, zero color, pure monochrome inked aesthetics, not photorealistic';
    case 'us_comic':
      return 'Classic comic book illustration, dynamic contour inks, dramatic chiaroscuro comic shadows, vintage Ben-Day dot palette, not photorealistic';
    case 'watercolor':
      return 'Traditional watercolor concept art, wet-on-wet paint pooling, organic paper tooth texture, delicate washes, not photorealistic';
    case '3d_animation':
      return 'Stylized 3D cinematic animation feature film quality, subsurface scattering skin, tactile shaders';
    case 'chibi':
      return 'Super-deformed chibi character design, cute oversized head, tiny simplified body, sparkling eyes, not photorealistic';
    default:
      return 'Strictly 2D hand-drawn illustration, clean line art, flat cel colouring, not photorealistic, no 3D rendering';
  }
}

/**
 * Describes the exact layout template for the sheet canvas.
 */
export function getLayoutDescription(layoutId: SheetLayoutId, aspect: AspectRatioOption): string {
  const orientation = orientationOf(aspect);

  if (orientation === 'landscape') {
    switch (layoutId) {
      case 'layout_a':
        return 'Model Sheet Layout A: Left 40% large head-and-shoulders portrait showing the collar and upper garment; Right 60% three full-body orthographic turnaround views (front, 90-degree profile, rear view) side-by-side at identical scale, feet aligned on ground plane.';
      case 'layout_b':
        return 'Model Sheet Layout B: Left 40% large head-and-shoulders portrait showing the collar and upper garment; Right 60% in two rows: the top row has three facial angle close-ups side by side (3/4 left, profile, 3/4 right), the bottom row has three full-body views (front, profile, back) side by side at identical scale with feet aligned on ground plane. No panel overlaps another.';
      case 'layout_c':
        return 'Model Sheet Layout C: Large head-and-shoulders portrait showing the collar and upper garment on the left; the three full-body views (front, side profile, back) at identical scale and feet aligned on ground plane top right; the four expression vignettes (neutral, joyful smile, serious, surprise) of the same face in one row at the bottom right.';
      case 'layout_d':
        return 'Model Sheet Layout D: Five synchronized full-body views evenly across canvas (front A-pose, front 3/4, profile, rear 3/4, rear), identical height guides, same proportions.';
      case 'layout_e':
        return 'Model Sheet Layout E: Exactly three head-and-shoulders bust studies side by side on one canvas: three-quarter view, front view and profile view, all at the same scale and cropped at the chest. Busts only: no full-body figure, no legs, no extra panels.';
      case 'layout_f':
        return 'Model Sheet Layout F: A grid of exactly six equal panels in two rows of three columns; each panel shows one head-and-shoulders bust of the same face in this order: neutral, smile, stern, laughter, sadness, surprise. Exactly six panels: no seventh or eighth panel, no full-body figure.';
      default:
        return 'Model Sheet Layout A: Left 40% large head-and-shoulders portrait showing the collar and upper garment, Right 60% three full-body views (front, profile, back) at identical scale with feet aligned on ground level.';
    }
  }

  // Square and Portrait: NO left/right keywords
  switch (layoutId) {
    case 'layout_a':
      return 'Model Sheet Layout A: Top ~35% large head-and-shoulders portrait showing the collar and upper garment; bottom ~65% three full-body views in a row (front, profile, back), identical scale, feet aligned on ground plane.';
    case 'layout_b':
      return 'Model Sheet Layout B: Top section has a large head-and-shoulders portrait showing the collar and upper garment; the middle row has three facial angle close-ups side by side (3/4 left, profile, 3/4 right); the bottom row has three full-body views (front, profile, back) side by side at identical scale with feet aligned on ground plane. No panel overlaps another.';
    case 'layout_c':
      return 'Model Sheet Layout C: Large head-and-shoulders portrait showing the collar and upper garment on top; the three full-body views (front, side profile, back) in a row below at identical scale and feet aligned on ground plane; the four expression vignettes (neutral, joyful smile, serious, surprise) of the same face in one row at the bottom.';
    case 'layout_d':
      return 'Model Sheet Layout D: Five synchronized full-body views in two tiers (three upper, two lower, centred), identical height and scale.';
    case 'layout_e':
      return 'Model Sheet Layout E: Exactly three head-and-shoulders bust studies in one column: three-quarter view on top, front view in the middle, profile view at the bottom, all at the same scale and cropped at the chest. Busts only: no full-body figure, no legs, no extra panels.';
    case 'layout_f':
      return 'Model Sheet Layout F: A grid of exactly six equal panels in three rows of two columns; each panel shows one head-and-shoulders bust of the same face in this order: neutral, smile, stern, laughter, sadness, surprise. Exactly six panels: no seventh or eighth panel, no full-body figure.';
    default:
      return 'Model Sheet Layout A: Top ~35% large head-and-shoulders portrait showing the collar and upper garment; bottom ~65% three full-body views in a row (front, profile, back), identical scale, feet aligned on ground level.';
  }
}

/**
 * Background descriptor.
 */
export function getBackgroundDescription(bg: CharacterConfig['background']): string {
  switch (bg) {
    case 'pure_white':
      return 'solid pure neutral white background (#ffffff), clean studio void without clutter';
    case 'chroma_green':
      return 'solid even chroma green backdrop (#00FF00) for clean silhouette separation';
    case 'studio_gray':
    default:
      return 'neutral matte light gray studio backdrop (#e2e4e8) with soft floor ambient shadow';
  }
}

/**
 * Pose descriptor.
 */
export function getPoseDescription(pose: CharacterConfig['pose']): string {
  switch (pose) {
    case 'a_pose':
      return 'standard model sheet A-pose with arms relaxed at 45 degrees, palms inward, feet shoulder-width apart';
    case 't_pose':
      return 'reference T-pose with arms extended horizontal, palms down, spine upright, feet facing forward';
    case 'natural':
    default:
      return 'natural relaxed standing posture, arms at sides, shoulders relaxed';
  }
}

/**
 * Hair style descriptor.
 */
export function getHairDescription(
  hairStyle: CharacterConfig['hairStyle'],
  hairColor: string,
  hasFacePhoto: boolean
): string {
  const isColorEmpty = !hairColor || !hairColor.trim();

  if (hasFacePhoto) {
    if (hairStyle === 'auto') {
      if (isColorEmpty) {
        return 'hair exactly as in the reference photo (style, length and colour)';
      }
      const colorName = describeHairColor(hairColor);
      return `hair style and length matching the reference photo, but colored ${colorName}`;
    }
  }

  const effectiveColor = isColorEmpty ? '#1a181b' : hairColor;
  const colorName = describeHairColor(effectiveColor);
  const colorPhrase = `${colorName} colored`;

  switch (hairStyle) {
    case 'short':
      return `short-cut ${colorPhrase} hair with tapered sides`;
    case 'undercut':
      return `textured undercut with ${colorPhrase} volume on top`;
    case 'long_straight':
      return `long straight ${colorPhrase} hair past shoulders`;
    case 'long_wavy':
      return `long wavy ${colorPhrase} hair with soft curls`;
    case 'bun':
      return `high hair bun with loose ${colorPhrase} strands framing face`;
    case 'ponytail':
      return `high ponytail of ${colorPhrase} hair`;
    case 'braided':
      return `braided ${colorPhrase} hair`;
    case 'bald':
      return 'bald clean-shaven head';
    case 'auto':
    default:
      return `signature ${colorPhrase} hairstyle`;
  }
}

/**
 * Expression descriptor.
 */
export function getExpressionDescription(
  expr: CharacterConfig['expression'],
  hasFacePhoto: boolean
): string {
  if (expr === 'original') {
    if (hasFacePhoto) {
      return 'keep the natural expression of the reference photo for the portrait, relaxed neutral in the full-body views';
    }
    return 'neutral calm resting expression, steady eye contact';
  }

  switch (expr) {
    case 'gentle_smile':
      return 'gentle warm smile with kind eyes';
    case 'stern':
      return 'stern resolute expression, focused gaze';
    case 'laughing':
      return 'joyful laughing expression, beaming eyes';
    case 'angry':
      return 'determined scowl with furrowed brow';
    case 'sad':
      return 'melancholic solemn expression, slightly downcast eyes';
    case 'surprised':
      return 'alert eyes and slightly parted lips expressing surprise';
    case 'neutral':
    default:
      return 'neutral calm resting expression, steady eye contact';
  }
}

/**
 * Accessories descriptor.
 */
export function getAccessoriesDescription(accessories: CharacterConfig['accessories']): string {
  if (!accessories || accessories.length === 0) return '';
  const map: Record<string, string> = {
    glasses: 'wire-rim eyeglasses',
    earrings: 'silver stud earrings',
    beard: 'trimmed beard and mustache',
    scar: 'distinct scar over one eyebrow',
    tattoo: 'ink tattoo peeking out',
    hat: 'fitting headwear',
    facemask: 'fitted face mask',
  };
  const list = accessories.map((a) => map[a] || a).filter(Boolean);
  return list.join(', ');
}

/**
 * Outfit descriptor.
 */
export function getOutfitDescription(config: CharacterConfig, outfitDesc: string, paletteStr: string): string {
  const priorityDetails = outfitDesc
    ? ` Wherever these details conflict with the base garments, draw only these details: ${outfitDesc}.`
    : '';
  const palette = paletteStr ? ` Palette: ${paletteStr}.` : '';
  const footwearMap: Record<string, string> = {
    sneakers: 'athletic sneakers',
    leather_shoes: 'formal leather oxford shoes',
    boots: 'utility combat boots',
    sandals: 'minimalist sandals',
    barefoot: 'bare feet',
    high_heels: 'pointed-toe dress heels',
    armor_boots: 'metal sabatons',
  };
  const shoes = footwearMap[config.footwear] || 'matching footwear';

  let baseOutfit = '';
  switch (config.outfitPreset) {
    case 'ao_dai':
      return `Traditional Vietnamese Áo Dài with high collar, flowing twin silk flaps, fitted trousers, and ${shoes}.${priorityDetails}${palette}`;
    case 'ao_ba_ba':
      return `Traditional southern Vietnamese Áo Bà Ba silk tunic, loose trousers, paired with ${shoes}.${priorityDetails}${palette}`;
    case 'school_uniform':
      return `School uniform with collared shirt, blazer or tie, pleated skirt or trousers, paired with ${shoes}.${priorityDetails}${palette}`;
    case 'business':
      return `Executive business suit with dress shirt, formal lapels, trousers, paired with ${shoes}.${priorityDetails}${palette}`;
    case 'streetwear':
      return `Streetwear outfit featuring oversized hoodie, cargo pants, utility straps, paired with ${shoes}.${priorityDetails}${palette}`;
    case 'fantasy_armor':
      return `Fantasy armor with pauldrons, etched cuirass, leather straps, paired with ${shoes}.${priorityDetails}${palette}`;
    case 'scifi_suit':
      return `Sci-fi flight suit with telemetry seams, carbon plating, paired with ${shoes}.${priorityDetails}${palette}`;
    case 'casual':
      baseOutfit = 'Casual wardrobe: fitted t-shirt, overshirt, denim jeans';
      return `${baseOutfit}, wearing ${shoes}.${priorityDetails}${palette}`;
    case 'custom':
    default:
      baseOutfit = outfitDesc
        ? `Wardrobe: ${outfitDesc}`
        : 'Distinctive character wardrobe';
      return `${baseOutfit}, wearing ${shoes}.${palette}`;
  }
}

interface AssemblyOptions {
  includeRole: boolean;
  includeDistinctive: boolean;
  includeAccessories: boolean;
  includeOutfitDnaDetails: boolean;
  includeExtraNotes: boolean;
}

/**
 * Internal assemble helper to build the prompt with selectively toggled optional clauses.
 */
function assemblePrompt(
  config: CharacterConfig,
  refs: PromptRefs | undefined,
  clipped: {
    role: string;
    distinctive: string;
    outfitDesc: string;
    colorPalette: string;
    extraNotes: string;
    faceDna: string;
    outfitDna: string;
  },
  opts: AssemblyOptions
): string {
  const parts: string[] = [];

  const faceRefsActive = config.faceSource === 'upload' && Boolean(refs && refs.faceCount > 0);
  const faceCount = faceRefsActive && refs ? refs.faceCount : 0;
  const fidelity = config.faceFidelity || 'balanced';

  // Strict face fidelity moves identity instruction to START of prompt
  if (faceRefsActive && fidelity === 'strict') {
    const refRefStr =
      faceCount > 1
        ? 'Reference image 1 (and the other face references) is the identity reference'
        : 'Reference image 1 is the identity reference';
    parts.push(
      `${refRefStr}: the face must be unmistakably the same person: keep face shape, eye shape and spacing, nose, lips, jawline, skin tone and hairline; do not idealise or change apparent ancestry.`
    );
  }

  // 1. Core Header
  const nameStr = config.displayName ? `named "${config.displayName}"` : 'original character';
  const roleStr = opts.includeRole && clipped.role ? `, who serves as ${clipped.role}` : '';
  const genderStr =
    config.gender === 'male'
      ? 'a male'
      : config.gender === 'female'
      ? 'a female'
      : 'an androgynous';
  const ageStr = getAgeDescription(config.ageGroup, config.numericAge);
  const bodyStr = getBodyDescription(config.bodyType);

  const is2dStyle = [
    'modern_anime',
    '2d_animation',
    'manga_bw',
    'us_comic',
    'watercolor',
    'chibi',
  ].includes(config.styleId);

  let faceStr = '';
  if (faceRefsActive) {
    if (fidelity === 'strict') {
      faceStr =
        'Preserve the facial identity from the reference photo across all views without idealisation.';
      if (clipped.faceDna) {
        faceStr += ` Facial traits to preserve: ${clipped.faceDna}`;
      }
    } else if (fidelity === 'stylized') {
      const faceRefLabel =
        faceCount === 1
          ? "Reference image 1 shows the person's face"
          : `Reference images 1-${faceCount} show the person's face`;
      faceStr = `${faceRefLabel}; render a stylised interpretation that stays recognisable in the chosen art style.`;
      if (clipped.faceDna) {
        faceStr += ` Facial traits to preserve: ${clipped.faceDna}`;
      }
    } else {
      // balanced
      const faceRefLabel =
        faceCount === 1
          ? "Reference image 1 shows the person's real face"
          : `Reference images 1-${faceCount} show the person's real face`;

      let translationDirective =
        'reproduce that face faithfully (face shape, eyes, nose, lips, skin tone, hairline) in the chosen style, recognisable at first glance';

      if (is2dStyle) {
        translationDirective +=
          ', translating the real features into the style while keeping them recognisable';
      }

      faceStr = `${faceRefLabel}; ${translationDirective}.`;
      if (clipped.faceDna) {
        faceStr += ` Facial traits to preserve: ${clipped.faceDna}`;
      }
    }
  } else if (config.faceSource === 'upload') {
    faceStr =
      'Face strictly matches the provided reference photo face geometry, eye shape, and nose features identically across all frames.';
  } else {
    faceStr = `${getEthnicityDescription(config.ethnicity)}, striking facial harmony, believable bone structure.`;
  }

  parts.push(
    `Official master character design sheet for film and animation of ${genderStr} character ${nameStr}${roleStr}. Character age: ${ageStr}, with a ${bodyStr}.`
  );

  // 2. Face, Hair & Expression
  const hairStr = getHairDescription(config.hairStyle, config.hairColor, faceRefsActive);
  const exprStr = getExpressionDescription(config.expression, faceRefsActive);
  const accList = opts.includeAccessories ? getAccessoriesDescription(config.accessories) : '';
  const distinctStr =
    opts.includeDistinctive && clipped.distinctive
      ? ` Visual details to draw as features of the character only (never as labels or writing): ${clipped.distinctive}.`
      : '';

  parts.push(
    `Face details: ${faceStr} Hairstyle: ${hairStr}. Facial expression: ${exprStr}.${accList ? ` Distinctive accessories: ${accList}.` : ''}${distinctStr}`
  );

  // 3. Costume & Footwear (with optional outfit reference numbering)
  let outfitClause = `Costume design: ${getOutfitDescription(config, clipped.outfitDesc, clipped.colorPalette)}`;
  if (refs && refs.outfitCount > 0) {
    const startIdx = faceCount + 1;
    const endIdx = faceCount + refs.outfitCount;
    const outfitRefLabel =
      startIdx === endIdx
        ? `Reference image ${startIdx} shows the outfit`
        : `Reference images ${startIdx}..${endIdx} show the outfit`;

    let outfitRefText = `${outfitRefLabel}; recreate the same garments, colours and details faithfully.`;
    if (opts.includeOutfitDnaDetails && clipped.outfitDna) {
      outfitRefText += ` Outfit reference details: ${clipped.outfitDna}`;
    }
    outfitClause += ` ${outfitRefText}`;
  }
  parts.push(outfitClause);

  // 4. Sheet Canvas Architecture & Canvas Aspect Ratio (MANDATORY EXACT SENTENCE)
  parts.push(
    `Sheet layout specifications: ${getLayoutDescription(config.layoutId, config.aspectRatio)} Canvas aspect ratio ${config.aspectRatio}.`
  );

  // 5. Pose & Staging Environment
  parts.push(
    `Posing & Stage: Character displayed in ${getPoseDescription(config.pose)}. Canvas background is a ${getBackgroundDescription(config.background)}.`
  );

  // 6. Style & Medium snippet
  parts.push(`Artistic rendering medium: ${getStyleSnippet(config.styleId)}.`);

  // 7. Consistency Rules
  parts.push(
    `Critical model sheet consistency rules: The exact same individual across every single viewpoint. Perfect continuity in facial anatomy, hairstyle, hair color, garment seams, cloth folds, color balance, and proportion ratios. Soft diffused neutral three-point studio lighting with balanced key and rim highlights, uniform illumination without harsh cast shadows.`
  );

  // 8. Composition Notes
  parts.push(
    `Composition notes: Clean isolated design turnaround on a single unified canvas. High resolution concept art. No distorted anatomy, no duplicate asymmetric limbs.`
  );

  if (opts.includeExtraNotes && clipped.extraNotes) {
    parts.push(
      `Additional visual requirements (follow silently; never write them as text in the image): ${clipped.extraNotes}`
    );
  }

  // 9. Final absolute no-text sentence (MANDATORY LAST SENTENCE)
  parts.push(FINAL_NO_TEXT_SENTENCE);

  return parts.join(' ');
}

/**
 * Pure function to construct a production-ready character design sheet prompt in English.
 * Supports optional PromptRefs. Enforces MAX_PROMPT_CHARS = 3400.
 */
export function buildSheetPrompt(config: CharacterConfig, refs?: PromptRefs): string {
  // Pre-clip inputs at word boundaries
  const clipped = {
    role: clipWordBoundary(config.roleOccupation || '', 80),
    distinctive: clipWordBoundary(config.distinctiveFeatures || '', 160),
    outfitDesc: clipWordBoundary(config.outfitDescription || '', 240),
    colorPalette: clipWordBoundary(config.colorPalette || '', 80),
    extraNotes: clipWordBoundary(config.extraNotes || '', 240),
    faceDna: clipWordBoundary(refs?.faceDna || '', 420),
    outfitDna: clipWordBoundary(refs?.outfitDna || '', 360),
  };

  // Base assembly options (everything enabled)
  const opts: AssemblyOptions = {
    includeRole: true,
    includeDistinctive: true,
    includeAccessories: true,
    includeOutfitDnaDetails: true,
    includeExtraNotes: true,
  };

  let prompt = assemblePrompt(config, refs, clipped, opts);
  if (prompt.length <= MAX_PROMPT_CHARS) {
    return prompt;
  }

  // Shedding step 1: drop extraNotes
  opts.includeExtraNotes = false;
  prompt = assemblePrompt(config, refs, clipped, opts);
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;

  // Shedding step 2: drop outfitDna details
  opts.includeOutfitDnaDetails = false;
  prompt = assemblePrompt(config, refs, clipped, opts);
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;

  // Shedding step 3: drop accessories
  opts.includeAccessories = false;
  prompt = assemblePrompt(config, refs, clipped, opts);
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;

  // Shedding step 4: drop distinctive features
  opts.includeDistinctive = false;
  prompt = assemblePrompt(config, refs, clipped, opts);
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;

  // Shedding step 5: drop role
  opts.includeRole = false;
  prompt = assemblePrompt(config, refs, clipped, opts);

  return prompt;
}
