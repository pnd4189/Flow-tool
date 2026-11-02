import { CharacterConfig, Language } from '../types';
import {
  getAgeDescription,
  getBodyDescription,
  getEthnicityDescription,
  getHairDescription,
  getExpressionDescription,
  getAccessoriesDescription,
  getOutfitDescription,
  getStyleSnippet,
} from './promptBuilder';

export interface CharacterPackContext {
  faceDna?: string;
  outfitDna?: string;
}

/**
 * Builds a structured, production-ready Character Pack text document in English with localized headings.
 * Ends with a newline character.
 */
export function buildCharacterPack(
  config: CharacterConfig,
  ctx: CharacterPackContext,
  lang: Language
): string {
  const isVi = lang === 'vi';

  // Section headings follow UI language
  const hCharacter = isVi ? 'NHÂN VẬT' : 'CHARACTER';
  const hIdentity = isVi ? 'NHẬN DẠNG' : 'IDENTITY';
  const hOutfit = isVi ? 'TRANG PHỤC' : 'OUTFIT';
  const hStyle = isVi ? 'PHONG CÁCH' : 'STYLE';
  const hHowToUse = isVi ? 'CÁCH DÙNG' : 'HOW TO USE';

  // Demographic values (English)
  const tagStr = `@${config.tag || 'character'}`;
  const nameStr = config.displayName ? `"${config.displayName}"` : 'Original Character';
  const genderStr =
    config.gender === 'male' ? 'male' : config.gender === 'female' ? 'female' : 'androgynous';
  const genderHeading =
    config.gender === 'male' ? 'Male' : config.gender === 'female' ? 'Female' : 'Androgynous';
  const ageStr = getAgeDescription(config.ageGroup, config.numericAge);
  const buildStr = getBodyDescription(config.bodyType);
  const roleStr = config.roleOccupation ? config.roleOccupation : 'Unspecified';

  // Sectioned Identity values (preserves labels: Heritage:, Hair:, Expression:, Accessories:, Distinctive marks:)
  let identityDetails = '';
  if (ctx.faceDna && ctx.faceDna.trim()) {
    identityDetails = ctx.faceDna.trim();
  } else {
    const ethnicity = getEthnicityDescription(config.ethnicity);
    const hair = getHairDescription(config.hairStyle, config.hairColor, config.faceSource === 'upload');
    const expr = getExpressionDescription(config.expression, false);
    const acc = getAccessoriesDescription(config.accessories);
    const dist = config.distinctiveFeatures ? config.distinctiveFeatures.trim() : '';

    const parts = [
      `Heritage: ${ethnicity}`,
      `Hair: ${hair}`,
      `Expression: ${expr}`,
    ];
    if (acc) parts.push(`Accessories: ${acc}`);
    if (dist) parts.push(`Distinctive marks: ${dist}`);
    identityDetails = parts.join('; ');
  }

  // Outfit values
  let outfitDetails = '';
  if (ctx.outfitDna && ctx.outfitDna.trim()) {
    outfitDetails = ctx.outfitDna.trim();
  } else {
    outfitDetails = getOutfitDescription(
      config,
      config.outfitDescription || '',
      config.colorPalette || ''
    );
  }

  // Style snippet
  const styleSnippet = getStyleSnippet(config.styleId);

  // Clean prose prose components for the CHARACTER block without internal section labels or double full stops.
  // Order: name and @tag, gender, age and build, face (the face description, or ethnicity words), hair, expression, accessories and distinctive marks, outfit, style.
  const hairDesc = getHairDescription(config.hairStyle, config.hairColor, config.faceSource === 'upload');
  const exprDesc = getExpressionDescription(config.expression, false);
  const accDesc = getAccessoriesDescription(config.accessories);
  const distDesc = config.distinctiveFeatures ? config.distinctiveFeatures.trim().replace(/\.+$/, '') : '';

  // Face descriptor: use Face DNA summary if present, otherwise ethnicity words
  let faceDesc = '';
  if (ctx.faceDna && ctx.faceDna.trim()) {
    faceDesc = ctx.faceDna.trim().replace(/\.+$/, '');
  } else {
    faceDesc = getEthnicityDescription(config.ethnicity).replace(/\.+$/, '');
  }

  // Accessories and distinctive marks combined
  const extraFeatures: string[] = [];
  if (accDesc) {
    extraFeatures.push(`wearing ${accDesc}`);
  }
  if (distDesc) {
    extraFeatures.push(`distinctive details: ${distDesc}`);
  }
  const accAndDistClause = extraFeatures.length > 0 ? extraFeatures.join(', ') : '';

  const proseParts = [
    `${nameStr} (${tagStr}), a ${genderStr} character, ${ageStr}, with a ${buildStr}`,
    faceDesc,
    `featuring ${hairDesc}`,
    `showing a ${exprDesc}`,
    accAndDistClause,
    `dressed in ${outfitDetails.replace(/\.+$/, '')}`,
    `rendered in ${styleSnippet.replace(/\.+$/, '')}`,
  ]
    .filter(Boolean)
    .join(', ');

  // Normalize any accidental double full stops or comma collisions
  const cleanProse = proseParts
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s*\.\s*\.+/g, '.')
    .replace(/\s*\.\s*,/g, ',')
    .replace(/\.+$/, '')
    .trim();

  const oneParagraphBlock = `CHARACTER: ${cleanProse}.`;

  // How to use lines
  const usageLines = isVi
    ? [
        '- Đính kèm bảng thiết kế nhân vật (Character Sheet) làm ảnh tham chiếu (Image Reference) hoặc khung đầu tiên (First Frame).',
        '- Dán đoạn "CHARACTER:" ở trên vào đầu mỗi câu lệnh video prompt để khóa tính nhất quán.',
        '- Giữ nguyên câu từ miêu tả trang phục để AI không thay đổi phục trang giữa các cảnh quay.',
      ]
    : [
        '- Attach the character sheet as the reference image or first frame.',
        '- Paste the "CHARACTER:" block above at the start of every video prompt.',
        '- Keep the outfit wording identical across all shots to maintain costume continuity.',
      ];

  const sections = [
    `=== ${hCharacter} ===`,
    `Tag: ${tagStr}`,
    `Display Name: ${nameStr}`,
    `Gender: ${genderHeading}`,
    `Age: ${ageStr}`,
    `Build: ${buildStr}`,
    `Role: ${roleStr}`,
    '',
    `=== ${hIdentity} ===`,
    identityDetails,
    '',
    `=== ${hOutfit} ===`,
    outfitDetails,
    '',
    `=== ${hStyle} ===`,
    styleSnippet,
    '',
    `=== VIDEO PROMPT BLOCK ===`,
    oneParagraphBlock,
    '',
    `=== ${hHowToUse} ===`,
    usageLines.join('\n'),
  ];

  return sections.join('\n') + '\n';
}
