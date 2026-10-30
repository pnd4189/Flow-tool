import { Flow } from 'flow-sdk';
import { Scene, Shot, Character, CharacterDNA } from './types';
import {
  SHOT_SIZES,
  CAMERA_ANGLES,
  CAMERA_MOVES,
  PERSPECTIVES,
  LIGHTINGS,
  WEATHERS,
  EFFECTS,
} from './library';

export interface ScriptOutlineCharacter {
  name: string;
  faceShape: string;
  eyes: string;
  hairstyle: string;
  skinTone: string;
  outfit: string;
  accessories: string;
  proportions: string;
  palette: string;
}

export interface ScriptOutlineScene {
  title: string;
  environment: string;      // MUST BE ENGLISH
  environmentVi?: string;    // Vietnamese for display
  timeOfDay: string;        // MUST BE ENGLISH
  weather: string;
  lighting: string;
  beats: string[];
  shotCount: number;
}

export interface ScriptOutline {
  title: string;
  logline: string;
  characters?: ScriptOutlineCharacter[];
  scenes: ScriptOutlineScene[];
}

export interface ScriptDetailedShot {
  action: string;            // MUST BE ENGLISH
  actionVi: string;          // Vietnamese for UI display
  subject: string;           // MUST BE ENGLISH
  characterNames: string[];
  dialogue: string;
  narration?: string;        // Lời dẫn giọng đọc off-screen theo ngôn ngữ đã chọn
  eraLabel?: string;         // Nhãn thời đại (VD: "London, 1890") - cấm đưa vào prompt
  factNote?: string;         // Ghi chú sự thật lịch sử kiểm chứng
  startPose: string;         // MUST BE ENGLISH
  endPose: string;           // MUST BE ENGLISH
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  lens: string;
  effects: string[];
  ambient: string;           // MUST BE ENGLISH
  sfx: string;               // MUST BE ENGLISH
  transitionIn: 'chain' | 'cut';
}

const VALID_SHOT_SIZES = new Set(SHOT_SIZES.map((s) => s.id));
const VALID_ANGLES = new Set(CAMERA_ANGLES.map((a) => a.id));
const VALID_MOVES = new Set(CAMERA_MOVES.map((m) => m.id));
const VALID_PERSPECTIVES = new Set(PERSPECTIVES.map((p) => p.id));
const VALID_LIGHTINGS = new Set(LIGHTINGS.map((l) => l.id));
const VALID_WEATHERS = new Set(WEATHERS.map((w) => w.id));
const VALID_EFFECTS = new Set(EFFECTS.map((e) => e.id));

/** Tính giới hạn số từ lời dẫn an toàn theo thời lượng shot (≈ 2.7 từ/giây) */
export function getMaxNarrationWords(durationSeconds: number): number {
  switch (durationSeconds) {
    case 4: return 11;
    case 6: return 16;
    case 10: return 27;
    case 8:
    default:
      return 22;
  }
}

/** Đếm số từ */
export function countWords(str?: string): number {
  if (!str) return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
}

/** BƯỚC 1: TẠO DÀN Ý KỊCH BẢN HOẠT HÌNH 2D (1 lần gọi Gemini) */
export async function generateScriptOutline(params: {
  idea: string;
  genre: string;
  audience: string;
  structure: string;
  dialogueLanguage: string;
  targetShots: number;
  projectMode: 'long' | 'short';
  existingCharacters: Character[];
  // Các trường mở rộng cho thể loại Kể chuyện phát minh / Lịch sử:
  inventionTopic?: string;
  inventionCount?: number;
  narratorCharacterName?: string;
}): Promise<ScriptOutline> {
  const isVaultEmpty = params.existingCharacters.length === 0;
  const isHistoryOrInvention =
    params.genre === 'Kể chuyện phát minh kỳ lạ' ||
    params.genre === 'Lịch sử thú vị';

  const systemInstruction = `You are a professional 2D historical animation and documentary storyteller, writing engaging cartoon episodes about weird/historical inventions.
Generate a structured narrative outline for a 2D animation film.
The sum of shotCount across all scenes MUST EXACTLY equal ${params.targetShots}.

${isHistoryOrInvention ? `HISTORICAL / INVENTIONS SPECIAL INSTRUCTIONS:
- Topic / Invention: "${params.inventionTopic || params.idea}"
- Inventions per episode: ${params.inventionCount || 1}
- Narrator mascot/host: ${params.narratorCharacterName || 'Animated historic guide'}
- Real historical accuracy: The inventions and inventors must be REAL historical facts. If an exact detail is not 100% verified, note it as "(cần kiểm chứng)" instead of inventing falsehoods.
- Respect real historical figures: No defamation or disrespectful satire.
- Structure guidance:
  * For Long form: Curiosity hook -> Historical era & context -> Eccentric inventor & crazy idea -> Comedic failed test -> Breakthrough success -> Modern legacy & impact -> Surprising punchline twist.
  * For Short form: 3-second hook question -> Weird invention reveal -> How it works -> Shocking true fact -> Final punchline.` : ''}

CRITICAL LANGUAGE SPECIFICATIONS:
- All character DNA fields (faceShape, eyes, hairstyle, skinTone, outfit, accessories, proportions, palette) MUST be written in concise professional ENGLISH because they feed directly into image generation prompts.
- Scene "environment" and "timeOfDay" MUST be written in ENGLISH with precise era & mechanical descriptions (e.g. "Victorian workshop cluttered with brass gears and steam boilers, foggy London morning").
- Scene "environmentVi" is a short Vietnamese description strictly for display in the UI.
- Scene "title", film "title", and "logline" may be in Vietnamese or the user's primary language.

Return STRICT RAW JSON only matching this schema:
{
  "title": "...",
  "logline": "...",
  ${isVaultEmpty ? `"characters": [
    {
      "name": "...",
      "faceShape": "Oval face with sharp anime chin (in English)",
      "eyes": "Expressive amber anime eyes (in English)",
      "hairstyle": "Textured bob with bangs (in English)",
      "skinTone": "Light peach anime skin tone (in English)",
      "outfit": "Stylized 19th-century inventor coat with goggles (in English)",
      "accessories": "Brass pocket watch (in English)",
      "proportions": "6 heads tall, slender anime proportions (in English)",
      "palette": "#1E3A8A navy, #F5B301 amber, #FFFFFF clean white (in English)"
    }
  ],` : ''}
  "scenes": [
    {
      "title": "...",
      "environment": "English description of environment for generative background prompt",
      "environmentVi": "Tiếng Việt ngắn gọn mô tả bối cảnh để hiển thị",
      "timeOfDay": "Daylight / Golden Hour / Blue Hour / Night",
      "weather": "clear",
      "lighting": "day_flat",
      "beats": ["beat 1", "beat 2"],
      "shotCount": 4
    }
  ]
}

RULES:
- Genre: ${params.genre}
- Target Audience: ${params.audience}
- Narrative Structure: ${params.structure}
- Total Target Shots: ${params.targetShots}
${isVaultEmpty ? '- Suggest maximum 1-3 essential characters (e.g. Narrator host, Inventor).' : `- Use existing character names: ${params.existingCharacters.map((c) => c.name).join(', ')}`}
- weather must be one of: [${Array.from(VALID_WEATHERS).join(', ')}]
- lighting must be one of: [${Array.from(VALID_LIGHTINGS).join(', ')}]
- Sum of scene shotCounts must equal ${params.targetShots}.`;

  const userPrompt = `Story Idea / Premise: ${params.idea}
${isHistoryOrInvention ? `Invention Topic: ${params.inventionTopic || params.idea}\nInventions Count: ${params.inventionCount || 1}` : ''}`;

  const { text } = await Flow.generate.text(userPrompt, {
    systemInstruction,
    thinkingLevel: 'low',
  });

  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch (err: unknown) {
    throw new Error(`Parse JSON dàn ý thất bại: ${err instanceof Error ? err.message : String(err)}. Phản hồi: ${text.slice(0, 200)}`);
  }

  // Chuẩn hóa shotCount
  if (Array.isArray(parsed.scenes)) {
    let currentTotal = parsed.scenes.reduce((sum: number, sc: any) => sum + (Number(sc.shotCount) || 1), 0);
    if (currentTotal !== params.targetShots && parsed.scenes.length > 0) {
      const diff = params.targetShots - currentTotal;
      parsed.scenes[parsed.scenes.length - 1].shotCount = Math.max(1, (parsed.scenes[parsed.scenes.length - 1].shotCount || 1) + diff);
    }
  }

  return parsed;
}

/** BƯỚC 2: VIẾT CHI TIẾT TỪNG SCENE (Tuần tự từng scene) */
export async function generateSceneDetailedShots(params: {
  outline: ScriptOutline;
  sceneIndex: number;
  dialogueLanguage: string;
  characters: Array<{ id: string; name: string }>;
  previousScenesSummary?: string;
  genre?: string;
  durationSeconds?: number;
  onAbortSignal?: () => boolean;
}): Promise<ScriptDetailedShot[]> {
  const currentScene = params.outline.scenes[params.sceneIndex];
  if (!currentScene) return [];

  const maxWords = getMaxNarrationWords(params.durationSeconds || 8);
  const isHistoryOrInvention =
    params.genre === 'Kể chuyện phát minh kỳ lạ' ||
    params.genre === 'Lịch sử thú vị';

  const systemInstruction = `You are a master 2D animation director, documentary scriptwriter and layout artist.
Detail the shots for Scene ${params.sceneIndex + 1}: "${currentScene.title}".
Target shot count for this scene: EXACTLY ${currentScene.shotCount} shots.

CRITICAL LANGUAGE & STORYTELLING RULES:
1. "action" MUST be in detailed, observable ENGLISH describing machinery, characters, and physics (never Vietnamese). Describe machine shapes specifically in English so generative models draw the era correctly.
2. "subject" MUST be in concise ENGLISH (e.g. "Early steam contraption on three wheels", "Eccentric Victorian inventor").
3. "startPose" and "endPose" MUST be in concise observable ENGLISH.
4. "ambient" and "sfx" MUST be in concise ENGLISH (e.g. "steam hissing, ticking gears", "metallic clang, engine sputter").
5. "actionVi" is in Vietnamese (under 15 words) strictly for UI display to the user.
6. "narration" (Voice-Over):
   - Written in ${params.dialogueLanguage}.
   - MUST be concise, strictly under ${maxWords} words per shot (approx 2.7 words/second for ${params.durationSeconds || 8}s shot).
   - Engaging narrator voice explaining the invention, historical context, or comical failure.
7. "eraLabel": Short era indicator (e.g. "London, 1890", "Paris, 1769", "Thế kỷ 19"). NOTE: eraLabel is strictly for video editing metadata and UI; it will NOT be injected into image/video prompts because prompts forbid text.
8. "factNote": 1 sentence historical fact note for user verification (in ${params.dialogueLanguage}). If unverified, include "(cần kiểm chứng)".
9. "dialogue": For historical/invention narration genre, dialogue is usually empty "" unless a character exclaims a quick phrase (<= 8 words). The narrator handles narration.

CAMERA & PACING RECOMMENDATIONS:
- Prefer insert/close_up when inspecting complex machines, patent drawings, or gears.
- Prefer push_in when revealing the finished invention or an idea eureka moment.
- Prefer pan_slow for scrolling blueprints or workshop setups.
- Prefer impact_shake or comedy framing for test explosions, smoke, or comedic failures.

Return STRICT RAW JSON ONLY. An array of shot objects matching this structure:
[
  {
    "action": "Detailed observable action description in English for AI video generator",
    "actionVi": "Tiếng Việt ngắn gọn mô tả hành động (dưới 15 từ) để hiển thị trong app",
    "subject": "Main subject or invention in English",
    "characterNames": ["Narrator"],
    "dialogue": "",
    "narration": "Lời dẫn giọng đọc bằng ${params.dialogueLanguage} (dưới ${maxWords} từ)",
    "eraLabel": "London, 1890",
    "factNote": "Sự thật lịch sử để kiểm chứng (ghi rõ chi tiết có thật)",
    "startPose": "Clear English start pose",
    "endPose": "Clear English end pose",
    "shotSize": "insert",
    "cameraAngle": "eye_level",
    "cameraMovement": "push_in",
    "lens": "normal",
    "effects": ["paper_grain"],
    "ambient": "steam hiss, clinking gears",
    "sfx": "loud steam release, metallic pop",
    "transitionIn": "chain"
  }
]

RULES:
1. The first shot of the scene MUST have transitionIn = "cut" and be an establishing framing (wide, extreme_wide, or patent insert).
2. Subsequent shots should usually have transitionIn = "chain" (continuity).
3. If transitionIn == "chain", startPose of shot N MUST match endPose of shot N-1.
4. narration word count MUST NOT exceed ${maxWords} words.
5. shotSize MUST be in: [${Array.from(VALID_SHOT_SIZES).join(', ')}]
6. cameraAngle MUST be in: [${Array.from(VALID_ANGLES).join(', ')}]
7. cameraMovement MUST be in: [${Array.from(VALID_MOVES).join(', ')}]
8. lens MUST be in: [${Array.from(VALID_PERSPECTIVES).join(', ')}]
9. effects (max 3) MUST be in: [${Array.from(VALID_EFFECTS).join(', ')}]
10. EXACTLY ${currentScene.shotCount} shots in the array.`;

  const userPrompt = `Logline: ${params.outline.logline}
Genre: ${params.genre || 'Kể chuyện phát minh kỳ lạ'}
Previous Scenes Context: ${params.previousScenesSummary || 'Beginning of the film.'}
Current Scene:
- Title: ${currentScene.title}
- Environment (English): ${currentScene.environment}
- Time of Day (English): ${currentScene.timeOfDay}
- Beats: ${JSON.stringify(currentScene.beats)}
- Characters available: ${params.characters.map((c) => c.name).join(', ')}
- Required shots: ${currentScene.shotCount}`;

  const { text } = await Flow.generate.text(userPrompt, {
    systemInstruction,
    thinkingLevel: 'low',
  });

  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch (err: unknown) {
    throw new Error(`Parse chi tiết Scene ${params.sceneIndex + 1} thất bại: ${err instanceof Error ? err.message : String(err)}. Phản hồi: ${text.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Scene ${params.sceneIndex + 1} không trả về mảng shot. Phản hồi: ${text.slice(0, 200)}`);
  }

  return parsed.map((sh: any, sIdx: number) => {
    const isFirst = sIdx === 0;
    return {
      action: typeof sh.action === 'string' ? sh.action.trim() : 'character moves within frame',
      actionVi: typeof sh.actionVi === 'string' ? sh.actionVi.trim() : (sh.action || `Shot ${sIdx + 1}`),
      subject: typeof sh.subject === 'string' ? sh.subject.trim() : '',
      characterNames: Array.isArray(sh.characterNames) ? sh.characterNames : [],
      dialogue: typeof sh.dialogue === 'string' ? sh.dialogue.trim() : '',
      narration: typeof sh.narration === 'string' ? sh.narration.trim() : undefined,
      eraLabel: typeof sh.eraLabel === 'string' ? sh.eraLabel.trim() : undefined,
      factNote: typeof sh.factNote === 'string' ? sh.factNote.trim() : undefined,
      startPose: typeof sh.startPose === 'string' ? sh.startPose.trim() : '',
      endPose: typeof sh.endPose === 'string' ? sh.endPose.trim() : '',
      shotSize: VALID_SHOT_SIZES.has(sh.shotSize) ? sh.shotSize : (isFirst ? 'wide' : 'medium'),
      cameraAngle: VALID_ANGLES.has(sh.cameraAngle) ? sh.cameraAngle : 'eye_level',
      cameraMovement: VALID_MOVES.has(sh.cameraMovement) ? sh.cameraMovement : 'pan_slow',
      lens: VALID_PERSPECTIVES.has(sh.lens) ? sh.lens : 'normal',
      effects: Array.isArray(sh.effects) ? sh.effects.filter((e: string) => VALID_EFFECTS.has(e)).slice(0, 3) : [],
      ambient: typeof sh.ambient === 'string' ? sh.ambient.trim() : '',
      sfx: typeof sh.sfx === 'string' ? sh.sfx.trim() : '',
      transitionIn: isFirst ? 'cut' : (sh.transitionIn === 'cut' ? 'cut' : 'chain'),
    };
  });
}

/** C. AI HOÀN THIỆN KỊCH BẢN (Dành cho kịch bản tay/tải lên/dịch sang tiếng Anh & sinh lời dẫn, 0 credit, lô <= 15 shot) */
export interface ScriptPolishedShotUpdate {
  order: number;
  action: string;            // ENGLISH
  actionVi?: string;         // Vietnamese for UI
  subject: string;           // ENGLISH
  characterNames: string[];
  narration?: string;        // Voice-over text
  eraLabel?: string;
  factNote?: string;
  startPose: string;         // ENGLISH
  endPose: string;           // ENGLISH
  ambient: string;           // ENGLISH
  sfx: string;               // ENGLISH
}

export interface ScriptPolishedSceneUpdate {
  sceneId: string;
  environment: string;       // ENGLISH
  environmentVi?: string;    // Vietnamese
  timeOfDay: string;         // ENGLISH
  weather: string;
  lighting: string;
}

export interface ScriptPolishResult {
  shots: ScriptPolishedShotUpdate[];
  scenes: ScriptPolishedSceneUpdate[];
}

export async function polishScriptWithAI(params: {
  shots: Shot[];
  scenes: Scene[];
  characters: Character[];
  translatePromptFieldsToEnglish?: boolean;
  generateNarrationIfEmpty?: boolean;
  dialogueLanguage?: string;
  durationSeconds?: number;
}): Promise<ScriptPolishResult> {
  const {
    shots,
    scenes,
    characters,
    translatePromptFieldsToEnglish = true,
    generateNarrationIfEmpty = true,
    dialogueLanguage = 'Tiếng Việt',
    durationSeconds = 8,
  } = params;
  if (shots.length === 0) return { shots: [], scenes: [] };

  const maxWords = getMaxNarrationWords(durationSeconds);
  const sceneMap = new Map<string, Scene>();
  scenes.forEach((s) => sceneMap.set(s.id, s));

  // Chạy theo lô <= 15 shot
  const BATCH_SIZE = 15;
  const batches: Shot[][] = [];
  for (let i = 0; i < shots.length; i += BATCH_SIZE) {
    batches.push(shots.slice(i, i + BATCH_SIZE));
  }

  const polishedShots: ScriptPolishedShotUpdate[] = [];
  const polishedScenesMap = new Map<string, ScriptPolishedSceneUpdate>();

  for (const batch of batches) {
    const shotData = batch.map((sh) => {
      const sc = sceneMap.get(sh.sceneId);
      return {
        order: sh.order,
        sceneId: sh.sceneId,
        sceneTitle: sc?.title || '',
        sceneEnvironment: sc?.environment || '',
        actionBeat: sh.actionBeat,
        existingAction: sh.action || '',
        existingNarration: sh.narration || '',
        existingEra: sh.eraLabel || '',
        subject: sh.subject || '',
        dialogue: sh.audioDialogue,
        assignedCharacters: sh.characterIds.map((id) => characters.find((c) => c.id === id)?.name).filter(Boolean),
        characterNamesRecorded: sh.characterNames || [],
      };
    });

    const systemInstruction = `You are a script polisher, translator, and storyboard continuity specialist for 2D animation and historical storytelling.

TASK:
1. Translate and optimize all generation-bound fields into clear, professional, concise ENGLISH:
   - "action": English visual action description suitable for text-to-video / image-to-video models.
   - "subject": English subject name / descriptor.
   - "startPose" and "endPose": English descriptive poses.
   - "ambient": English soundscape (e.g. "steam hiss, bustling workshop").
   - "sfx": English sound effects (e.g. "footsteps, gear turn").
2. ${generateNarrationIfEmpty ? `Generate engaging voice-over "narration" in ${dialogueLanguage} if existingNarration is empty or incomplete. The narration MUST NOT exceed ${maxWords} words per shot.` : 'Keep existing narration or leave empty.'}
3. If an era is evident, populate "eraLabel" (e.g. "London, 1890") and "factNote" for historical authenticity.
4. Detect character names in the beat or dialogue that match the vault characters or should be tracked: [${characters.map((c) => c.name).join(', ')}]. Put them into "characterNames".
5. For scenes: Translate or create "environment" in ENGLISH, keep/create "environmentVi" in Vietnamese, and set "timeOfDay" in ENGLISH ("Daylight", "Golden Hour", "Dusk", "Night").
6. "actionVi": Keep or provide a concise Vietnamese action beat (< 15 words) for user UI display.

VALID WEATHERS: [${Array.from(VALID_WEATHERS).join(', ')}]
VALID LIGHTINGS: [${Array.from(VALID_LIGHTINGS).join(', ')}]

Return STRICT RAW JSON only matching this schema:
{
  "shots": [
    {
      "order": 1,
      "action": "English visual action description...",
      "actionVi": "Tiếng Việt hiển thị...",
      "subject": "English subject...",
      "characterNames": ["Narrator"],
      "narration": "Lời dẫn (dưới ${maxWords} từ)...",
      "eraLabel": "Paris, 1769",
      "factNote": "Sự thật lịch sử cần kiểm chứng...",
      "startPose": "English start pose...",
      "endPose": "English end pose...",
      "ambient": "English ambient...",
      "sfx": "English sfx..."
    }
  ],
  "scenes": [
    {
      "sceneId": "...",
      "environment": "English environment description for prompt",
      "environmentVi": "Mô tả bối cảnh tiếng Việt",
      "timeOfDay": "Daylight",
      "weather": "clear",
      "lighting": "day_flat"
    }
  ]
}`;

    const userPrompt = `Polish and translate prompt fields to English for these ${batch.length} shots (translatePromptFieldsToEnglish: ${translatePromptFieldsToEnglish}, generateNarrationIfEmpty: ${generateNarrationIfEmpty}):\n${JSON.stringify(shotData)}`;

    let responseText = '';
    try {
      const { text } = await Flow.generate.text(userPrompt, {
        systemInstruction,
        thinkingLevel: 'low',
      });
      responseText = text;
    } catch (err: unknown) {
      throw new Error(`AI hoàn thiện thất bại: ${err instanceof Error ? err.message : String(err)}`);
    }

    const clean = responseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch (err) {
      throw new Error(`Parse AI Polish JSON thất bại: ${err instanceof Error ? err.message : String(err)}. Phản hồi: ${responseText.slice(0, 200)}`);
    }

    if (Array.isArray(parsed.shots)) {
      parsed.shots.forEach((ps: any) => {
        if (typeof ps.order === 'number') {
          polishedShots.push({
            order: ps.order,
            action: typeof ps.action === 'string' ? ps.action.trim() : '',
            actionVi: typeof ps.actionVi === 'string' ? ps.actionVi.trim() : undefined,
            subject: typeof ps.subject === 'string' ? ps.subject.trim() : '',
            characterNames: Array.isArray(ps.characterNames) ? ps.characterNames : [],
            narration: typeof ps.narration === 'string' ? ps.narration.trim() : undefined,
            eraLabel: typeof ps.eraLabel === 'string' ? ps.eraLabel.trim() : undefined,
            factNote: typeof ps.factNote === 'string' ? ps.factNote.trim() : undefined,
            startPose: typeof ps.startPose === 'string' ? ps.startPose.trim() : '',
            endPose: typeof ps.endPose === 'string' ? ps.endPose.trim() : '',
            ambient: typeof ps.ambient === 'string' ? ps.ambient.trim() : '',
            sfx: typeof ps.sfx === 'string' ? ps.sfx.trim() : '',
          });
        }
      });
    }

    if (Array.isArray(parsed.scenes)) {
      parsed.scenes.forEach((sc: any) => {
        if (sc.sceneId && !polishedScenesMap.has(sc.sceneId)) {
          polishedScenesMap.set(sc.sceneId, {
            sceneId: sc.sceneId,
            environment: typeof sc.environment === 'string' ? sc.environment.trim() : '',
            environmentVi: typeof sc.environmentVi === 'string' ? sc.environmentVi.trim() : undefined,
            timeOfDay: typeof sc.timeOfDay === 'string' ? sc.timeOfDay.trim() : 'Daylight',
            weather: VALID_WEATHERS.has(sc.weather) ? sc.weather : 'clear',
            lighting: VALID_LIGHTINGS.has(sc.lighting) ? sc.lighting : 'day_flat',
          });
        }
      });
    }
  }

  return {
    shots: polishedShots,
    scenes: Array.from(polishedScenesMap.values()),
  };
}
