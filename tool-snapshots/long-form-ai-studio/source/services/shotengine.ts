import { Flow } from 'flow-sdk';
import {
  Scene,
  Shot,
  Character,
  CharacterDNA,
} from './types';
import {
  SHOT_SIZES,
  CAMERA_ANGLES,
  CAMERA_MOVES,
  PERSPECTIVES,
  LIGHTINGS,
  WEATHERS,
  EFFECTS,
  getItem,
  LookItem,
} from './library';

/** Format DNA nhân vật 2D đầy đủ 8 trường */
export function compileCharacterDNAString(char: Character): string {
  const dna = char.dna;
  const faceShape = dna.faceShape || dna.facialStructure || '';
  const parts = [
    faceShape && `Face: ${faceShape}`,
    dna.eyes && `Eyes: ${dna.eyes}`,
    dna.hairstyle && `Hair: ${dna.hairstyle}`,
    dna.skinTone && `Skin: ${dna.skinTone}`,
    dna.outfit && `Outfit: ${dna.outfit}`,
    dna.accessories && `Accessories: ${dna.accessories}`,
    dna.proportions && `Proportions: ${dna.proportions}`,
    dna.palette && `Palette: ${dna.palette}`,
  ].filter(Boolean);
  return `${char.name} (${parts.join(', ')})`;
}

/** Format DNA nhân vật rút gọn cho Video (tên + tóc + mắt + trang phục + bảng màu) */
export function compileCharacterDNACompact(char: Character): string {
  const dna = char.dna;
  const parts = [
    char.name,
    dna.hairstyle && `${dna.hairstyle} hair`,
    dna.eyes && `${dna.eyes} eyes`,
    dna.outfit && `wearing ${dna.outfit}`,
    dna.palette && `color theme ${dna.palette}`,
  ].filter(Boolean);
  return parts.join(', ');
}

/** Kiểm tra xem chuỗi pose có phải là text placeholder mặc định không */
function isGenericPosePlaceholder(text?: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^(start|end) pose for (shot\s*)?#?\d+$/i.test(trimmed);
}

/** Cắt dấu chấm câu hoặc khoảng trắng cuối chuỗi để tránh dấu chấm kép .. */
export function stripTrailingPunctuation(str?: string): string {
  if (!str) return '';
  return str.trim().replace(/[.,;!?]+$/, '').trim();
}

/**
 * Trình biên dịch prompt Keyframe 2D:
 * - Keyframe luôn có chủ thể và khoảnh khắc: sau phần pose thêm " Moment: {action || actionBeat}."
 * - Nếu shot không gắn nhân vật trong Vault nhưng có subject thì chèn "{subject}." trước pose.
 * - Cắt dấu chấm câu cuối của action/pose trước khi nối thêm dấu chấm để không còn "..".
 * - QUAN TRỌNG: narration và eraLabel TUYỆT ĐỐI KHÔNG ĐƯỢC đưa vào prompt keyframe (prompt cấm chữ).
 */
export function compileKeyframePrompt(
  shot: Shot,
  scene: Scene | undefined,
  characters: Character[],
  which: 'start' | 'end',
  look: LookItem,
  customStyle?: string,
  hasContinuityRef = false
): string {
  const shotSizeItem = getItem(SHOT_SIZES, shot.shotSize);
  const cameraAngleItem = getItem(CAMERA_ANGLES, shot.cameraAngle);
  const perspectiveItem = getItem(PERSPECTIVES, shot.lens);
  const lightingItem = getItem(LIGHTINGS, shot.lighting || scene?.lightingDefault);
  const weatherItem = getItem(WEATHERS, shot.weather || scene?.weather);

  const selectedChars = characters.filter((c) => shot.characterIds.includes(c.id));
  const charsDesc = selectedChars.length > 0
    ? selectedChars.map(compileCharacterDNAString).map((s) => stripTrailingPunctuation(s) + '.').join(' ')
    : '';

  const rawAction = shot.action?.trim() || shot.actionBeat?.trim() || 'engaging in the scene';
  const effectiveAction = stripTrailingPunctuation(rawAction);

  const rawPose = which === 'start' ? shot.startPose?.trim() : shot.endPose?.trim();
  let pose = isGenericPosePlaceholder(rawPose) ? '' : stripTrailingPunctuation(rawPose);

  if (!pose) {
    pose = which === 'start'
      ? `beginning moment of: ${effectiveAction}`
      : `ending pose after completing: ${effectiveAction}`;
  }

  // Nếu shot không gắn nhân vật trong Vault nhưng có subject thì chèn "{subject}." trước pose
  if (selectedChars.length === 0 && shot.subject?.trim()) {
    const cleanSubject = stripTrailingPunctuation(shot.subject.trim());
    pose = `${cleanSubject}. ${pose}`;
  }

  // Sau phần pose thêm " Moment: {action || actionBeat}."
  const momentClause = `Moment: ${effectiveAction}.`;

  const env = scene?.environment?.trim();
  const envPart = env ? `, in ${stripTrailingPunctuation(env)}` : '';
  const tod = scene?.timeOfDay?.trim() ? `, ${stripTrailingPunctuation(scene.timeOfDay.trim())}` : '';
  const weatherPart = weatherItem.prompt ? `, ${stripTrailingPunctuation(weatherItem.prompt)}` : '';
  const stylePart = customStyle?.trim() ? `, ${stripTrailingPunctuation(customStyle.trim())}` : '';

  const cinematography = [shotSizeItem.prompt, cameraAngleItem.prompt, perspectiveItem.prompt]
    .filter(Boolean)
    .join(', ');

  const lightingPart = lightingItem.prompt ? `Lighting: ${stripTrailingPunctuation(lightingItem.prompt)}.` : '';

  const continuityClause = hasContinuityRef
    ? 'Keep exactly the same location, background art, color palette, line style and character design as the reference frame; only the pose and framing change.'
    : '';

  const promptParts = [
    `${stripTrailingPunctuation(look.imagePrompt)}${stylePart}.`,
    stripTrailingPunctuation(look.guard) + '.',
    cinematography ? `${stripTrailingPunctuation(cinematography)}.` : '',
    charsDesc,
    `${pose}${envPart}${tod}${weatherPart}.`,
    momentClause,
    lightingPart,
    continuityClause,
    'Keep the character on-model. No text, no captions, no watermark.',
  ].filter(Boolean);

  // Khử dấu chấm kép .. hoặc khoảng trắng thừa
  return promptParts.join(' ').replace(/\s*\.\s*\./g, '.').replace(/\s+/g, ' ').trim();
}

export interface VideoPromptResult {
  prompt: string;
  isTooLong: boolean;
  length: number;
}

/**
 * Trình biên dịch prompt Video 2D:
 * - Nếu có narration thì thêm câu 'A warm narrator voice-over (off-screen) says: "{narration}".' TRƯỚC SFX.
 * - Nếu cùng lúc có dialogue thì giữ cả hai, narration trước dialogue.
 * - eraLabel KHÔNG đưa vào prompt video (vì prompt cấm chữ).
 */
export function compileVideoPrompt(
  shot: Shot,
  scene: Scene | undefined,
  characters: Character[],
  look: LookItem,
  customStyle?: string
): VideoPromptResult {
  const shotSizeItem = getItem(SHOT_SIZES, shot.shotSize);
  const cameraAngleItem = getItem(CAMERA_ANGLES, shot.cameraAngle);
  const perspectiveItem = getItem(PERSPECTIVES, shot.lens);
  const cameraMovementItem = getItem(CAMERA_MOVES, shot.cameraMovement);
  const lightingItem = getItem(LIGHTINGS, shot.lighting || scene?.lightingDefault);
  const weatherItem = getItem(WEATHERS, shot.weather || scene?.weather);

  const stylePart = customStyle?.trim() ? `, ${stripTrailingPunctuation(customStyle.trim())}` : '';

  const cinematography = [
    shotSizeItem.prompt,
    cameraAngleItem.prompt,
    perspectiveItem.prompt,
    cameraMovementItem.prompt,
  ].filter(Boolean).join(', ');

  const selectedChars = characters.filter((c) => shot.characterIds.includes(c.id));
  const charsDesc = selectedChars.length > 0
    ? selectedChars.map(compileCharacterDNACompact).join('; ') + '.'
    : (shot.subject ? `${stripTrailingPunctuation(shot.subject)}.` : '');

  const effectiveAction = stripTrailingPunctuation(shot.action?.trim() || shot.actionBeat?.trim() || 'character animates smoothly within frame');

  const settingParts = [
    scene?.environment?.trim(),
    scene?.timeOfDay?.trim(),
    weatherItem.prompt,
  ].filter(Boolean).map(stripTrailingPunctuation);
  const settingClause = settingParts.length > 0 ? `Setting: ${settingParts.join(', ')}.` : '';

  // Effects (tối đa 3)
  const effectsPrompts = (shot.effects || [])
    .slice(0, 3)
    .map((effId) => getItem(EFFECTS, effId).prompt)
    .filter(Boolean)
    .map(stripTrailingPunctuation);
  const effectsClause = effectsPrompts.length > 0 ? `Effects: ${effectsPrompts.join(', ')}.` : '';

  const lightingClause = lightingItem.prompt ? `Lighting: ${stripTrailingPunctuation(lightingItem.prompt)}.` : '';

  const frameBinding = 'The animation starts exactly on the provided first frame and ends exactly on the provided last frame; keep the character on-model with identical line art, colors and outfit.';

  const ambientClause = shot.ambient?.trim() ? `Ambient sound: ${stripTrailingPunctuation(shot.ambient.trim())}.` : '';

  // Xử lý Lời dẫn (Narration) và Dialogue:
  // Nếu có narration -> 'A warm narrator voice-over (off-screen) says: "{narration}".' TRƯỚC SFX
  let narrationClause = '';
  if (shot.narration?.trim()) {
    narrationClause = `A warm narrator voice-over (off-screen) says: "${stripTrailingPunctuation(shot.narration.trim())}".`;
  }

  let dialogueClause = '';
  if (shot.audioDialogue?.trim()) {
    const speakerName = selectedChars[0]?.name || shot.subject || 'The character';
    dialogueClause = `${speakerName} says: "${stripTrailingPunctuation(shot.audioDialogue.trim())}".`;
  }

  const sfxClause = shot.audioSfx?.trim() ? `SFX: ${stripTrailingPunctuation(shot.audioSfx.trim())}.` : '';

  const promptParts = [
    `${stripTrailingPunctuation(look.videoPrompt)}${stylePart}.`,
    stripTrailingPunctuation(look.guard) + '.',
    cinematography ? `${stripTrailingPunctuation(cinematography)}.` : '',
    charsDesc,
    `${effectiveAction}.`,
    settingClause,
    effectsClause,
    lightingClause,
    frameBinding,
    ambientClause,
    narrationClause,
    dialogueClause,
    sfxClause,
    '(no subtitles)',
  ].filter(Boolean);

  const cleanPrompt = promptParts.join(' ').replace(/\s*\.\s*\./g, '.').replace(/\s+/g, ' ').trim();
  const length = cleanPrompt.length;
  const isTooLong = length > 1500;

  return { prompt: cleanPrompt, isTooLong, length };
}

/**
 * Trình biên dịch ảnh bối cảnh (LocationRef 2D)
 */
export function compileLocationRefPrompt(scene: Scene, look: LookItem): string {
  const lightingItem = getItem(LIGHTINGS, scene.lightingDefault);
  const weatherItem = getItem(WEATHERS, scene.weather);

  const env = scene.environment || 'painted environment';
  const tod = scene.timeOfDay || 'daylight';
  const wea = weatherItem.prompt || 'clear sky';
  const light = lightingItem.prompt || 'natural light';

  return `${stripTrailingPunctuation(look.imagePrompt)}. ${stripTrailingPunctuation(look.guard)}. Empty background art of ${env}, ${tod}, ${wea}. Lighting: ${light}. No characters, no text.`.replace(/\s*\.\s*\./g, '.');
}

/**
 * Model sheet nhân vật 2D (16:9)
 */
export function compileCharacterSheetPrompt(char: Character, look: LookItem): string {
  const dnaStr = compileCharacterDNAString(char);
  return `${stripTrailingPunctuation(look.imagePrompt)}. ${stripTrailingPunctuation(look.guard)}. Character model sheet of ${char.name}: ${dnaStr}. Full-body turnaround (front, three-quarter, side, back) and four facial expressions (neutral, happy, sad, angry), consistent proportions, flat colors, color palette swatches, plain white background, clean line art, no text.`.replace(/\s*\.\s*\./g, '.');
}

/** Gợi ý DNA 8 trường bằng AI (Flow.generate.text, 0 credit) */
export async function suggestCharacterDNAWithAI(
  userDescription: string,
  look: LookItem
): Promise<CharacterDNA> {
  const systemInstruction = `You are a character designer for high-end 2D animation.
Given a character description, generate an 8-field character DNA JSON for a 2D animation model sheet.
Return STRICT RAW JSON only matching this schema:
{
  "faceShape": "...",
  "eyes": "...",
  "hairstyle": "...",
  "skinTone": "...",
  "outfit": "...",
  "accessories": "...",
  "proportions": "...",
  "palette": "..."
}
Rules:
- Values must be concise English suitable for 2D animation style (${look.label}).
- proportions example: "6 heads tall, slender anime proportions" or "chibi 2 heads tall"
- palette example: "#1E3A8A navy, #F5B301 amber, #FFFFFF clean white"
- No markdown, no commentary, strictly the JSON object.`;

  const { text } = await Flow.generate.text(
    `Character description: ${userDescription}\nStyle: ${look.label}`,
    {
      systemInstruction,
      thinkingLevel: 'low',
    }
  );

  const clean = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed = JSON.parse(clean);
  return {
    faceShape: parsed.faceShape || 'Oval face with soft anime chin',
    eyes: parsed.eyes || 'Large expressive anime eyes',
    hairstyle: parsed.hairstyle || 'Stylized parted bob',
    skinTone: parsed.skinTone || 'Fair peach skin',
    outfit: parsed.outfit || 'Signature school uniform or stylized traveler coat',
    accessories: parsed.accessories || 'Subtle hair ribbon',
    proportions: parsed.proportions || '6 heads tall anime proportions',
    palette: parsed.palette || '#2563EB cobalt, #F5B301 amber, #FFFFFF white',
  };
}

/** Helper derive scene title */
function getSceneTitleFromBeat(firstBeat: string, sceneIndex: number): string {
  const cleaned = firstBeat.replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(Boolean).slice(0, 6).join(' ');
  const truncated = words.length > 40 ? words.slice(0, 37) + '...' : words;
  return truncated || `Scene 0${sceneIndex}`;
}

/** Tách kịch bản thủ công 2D */
export function parseScriptToShots(
  rawText: string,
  _targetShots: number,
  defaultCharacterId?: string
): { scenes: Scene[]; shots: Shot[] } {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let finalBeats: string[] = [];

  if (lines.length === 0) {
    return { scenes: [], shots: [] };
  } else if (lines.length === 1 && lines[0].length > 180) {
    const sentences = lines[0]
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    finalBeats = sentences.length > 0 ? sentences : lines;
  } else {
    finalBeats = lines;
  }

  const SHOTS_PER_SCENE = 4;
  const scenes: Scene[] = [];
  const shots: Shot[] = [];

  const defaultCharIds = defaultCharacterId ? [defaultCharacterId] : [];
  let globalOrder = 1;

  for (let i = 0; i < finalBeats.length; i += SHOTS_PER_SCENE) {
    const chunk = finalBeats.slice(i, i + SHOTS_PER_SCENE);
    const sceneIndex = scenes.length + 1;
    const sceneId = `scene_${Date.now()}_${sceneIndex}`;
    const sceneTitle = getSceneTitleFromBeat(chunk[0] || '', sceneIndex);

    const scene: Scene = {
      id: sceneId,
      title: sceneTitle,
      environment: '',
      timeOfDay: 'Daylight',
      ambientDefault: '',
      lightingDefault: 'day_flat',
      weather: 'clear',
    };
    scenes.push(scene);

    chunk.forEach((beat, sIdx) => {
      const shotSizes = ['wide', 'medium', 'close_up', 'ots'];
      const shotMoves = ['push_in', 'pan_slow', 'parallax_truck', 'hold'];
      const isFirstShotOverall = globalOrder === 1;
      const isFirstShotInScene = sIdx === 0;

      const transitionIn: 'chain' | 'cut' = isFirstShotOverall || isFirstShotInScene ? 'cut' : 'chain';

      shots.push({
        id: `shot_${Date.now()}_${globalOrder}`,
        sceneId: scene.id,
        order: globalOrder,
        actionBeat: beat,
        action: beat,
        subject: '',
        characterIds: [...defaultCharIds],
        shotSize: shotSizes[sIdx % shotSizes.length],
        cameraAngle: 'eye_level',
        cameraMovement: shotMoves[sIdx % shotMoves.length],
        lens: 'normal',
        lighting: 'day_flat',
        weather: 'clear',
        effects: [],
        transitionIn,
        audioDialogue: '',
        audioSfx: '',
        ambient: '',
        startPose: '',
        endPose: '',
      });

      globalOrder++;
    });
  }

  return { scenes, shots };
}
