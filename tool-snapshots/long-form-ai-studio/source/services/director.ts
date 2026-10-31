import { Flow } from 'flow-sdk';
import { Shot, Scene, Character } from './types';
import {
  SHOT_SIZES,
  CAMERA_ANGLES,
  CAMERA_MOVES,
  PERSPECTIVES,
  LIGHTINGS,
  WEATHERS,
  EFFECTS,
  LookItem,
} from './library';
import { enforceVariety } from './variety';

export interface DirectorSuggestion {
  order: number;
  shotSize?: string;
  cameraAngle?: string;
  cameraMovement?: string;
  lens?: string;
  lighting?: string;
  weather?: string;
  effects?: string[];
  startPose?: string;
  endPose?: string;
  ambient?: string;
  sfx?: string;
}

export interface DirectorComparisonRow {
  shot: Shot;
  changes: Array<{
    field: string;
    label: string;
    oldVal: string;
    newVal: string;
  }>;
  suggestion: DirectorSuggestion;
}

const VALID_SHOT_SIZES = new Set(SHOT_SIZES.map((s) => s.id));
const VALID_ANGLES = new Set(CAMERA_ANGLES.map((a) => a.id));
const VALID_MOVES = new Set(CAMERA_MOVES.map((m) => m.id));
const VALID_PERSPECTIVES = new Set(PERSPECTIVES.map((p) => p.id));
const VALID_LIGHTINGS = new Set(LIGHTINGS.map((l) => l.id));
const VALID_WEATHERS = new Set(WEATHERS.map((w) => w.id));
const VALID_EFFECTS = new Set(EFFECTS.map((e) => e.id));

export async function runAIDirectorForShots(params: {
  targetShots: Shot[];
  allScenes: Scene[];
  allCharacters: Character[];
  look: LookItem;
  genreAtmosphere?: string;
}): Promise<DirectorSuggestion[]> {
  const { targetShots, allScenes, allCharacters, look, genreAtmosphere } = params;

  if (targetShots.length === 0) return [];

  const BATCH_SIZE = 15;
  const batches: Shot[][] = [];
  for (let i = 0; i < targetShots.length; i += BATCH_SIZE) {
    batches.push(targetShots.slice(i, i + BATCH_SIZE));
  }

  const allSuggestions: DirectorSuggestion[] = [];

  for (const batch of batches) {
    const sceneSummary = allScenes.map((s) => ({
      id: s.id,
      title: s.title,
      environment: s.environment,
      timeOfDay: s.timeOfDay,
      lightingDefault: s.lightingDefault,
      weather: s.weather,
    }));

    const shotSummary = batch.map((sh) => ({
      order: sh.order,
      sceneId: sh.sceneId,
      action: sh.action || sh.actionBeat,
      narration: sh.narration || '',
      eraLabel: sh.eraLabel || '',
      characters: sh.characterIds
        .map((cId) => allCharacters.find((c) => c.id === cId)?.name)
        .filter(Boolean),
      transitionIn: sh.transitionIn,
      current: {
        shotSize: sh.shotSize,
        cameraAngle: sh.cameraAngle,
        cameraMovement: sh.cameraMovement,
        lens: sh.lens,
        lighting: sh.lighting,
        weather: sh.weather,
      },
    }));

    const systemInstruction = `You are a master 2D Anime/Animation Film Director and Storyboard Artist specializing in documentary, educational, and eccentric inventions storytelling.
Direct the provided shots with cinema logic tailored to 2D animation style (${look.label}).

DIRECTING RULES:
1. Scene pacing: The first shot of each scene should be an establishing shot (extreme_wide or wide).
2. Eccentric Inventions / History Specific Rules:
   - For machine parts, gear mechanisms, or patent blueprints -> prioritize shotSize="insert" or "close_up".
   - For invention reveal / breakthrough eureka moments -> prioritize cameraMovement="push_in".
   - For inspecting blueprints or workshop panorama -> prioritize cameraMovement="pan_slow".
   - For comedic failed test runs, smoke explosions, or crash collisions -> prioritize cameraMovement="impact_shake", shotSize="medium_wide", effects=["emotion_marks" or "paper_grain"].
3. Camera variety: NEVER use the exact same cameraMovement for more than 2 consecutive shots.
4. Continuity poses:
   - startPose and endPose must be concise English descriptions of 2D character poses.
   - If a shot has transitionIn == 'chain', its startPose MUST match the endPose of the preceding shot.
5. Audio:
   - ambient and sfx should be short English sound descriptions matching the era (steam hiss, gear ticking, clockwork).
6. Effects:
   - effects array must have AT MOST 3 items from the valid effects list.
7. CRITICAL: You must ONLY return IDs from the valid lists below. Any other string will be discarded.

VALID SHOT SIZES: [${Array.from(VALID_SHOT_SIZES).join(', ')}]
VALID CAMERA ANGLES: [${Array.from(VALID_ANGLES).join(', ')}]
VALID MOVES: [${Array.from(VALID_MOVES).join(', ')}]
VALID PERSPECTIVES (lens): [${Array.from(VALID_PERSPECTIVES).join(', ')}]
VALID LIGHTINGS: [${Array.from(VALID_LIGHTINGS).join(', ')}]
VALID WEATHERS: [${Array.from(VALID_WEATHERS).join(', ')}]
VALID EFFECTS: [${Array.from(VALID_EFFECTS).join(', ')}]

OUTPUT FORMAT: Return STRICT RAW JSON ONLY. A JSON array of objects:
[
  {
    "order": 1,
    "shotSize": "...",
    "cameraAngle": "...",
    "cameraMovement": "...",
    "lens": "...",
    "lighting": "...",
    "weather": "...",
    "effects": ["..."],
    "startPose": "...",
    "endPose": "...",
    "ambient": "...",
    "sfx": "..."
  }
]`;

    const userPrompt = `Direct these ${batch.length} shots.
Look: ${look.label} (${look.imagePrompt})
Genre / Atmosphere: ${genreAtmosphere?.trim() || 'Weird inventions and historical documentary storytelling with comedic beats'}
Scenes: ${JSON.stringify(sceneSummary)}
Shots to direct: ${JSON.stringify(shotSummary)}`;

    let responseText = '';
    try {
      const { text } = await Flow.generate.text(userPrompt, {
        systemInstruction,
        thinkingLevel: 'low',
      });
      responseText = text;
    } catch (err: unknown) {
      throw new Error(`AI Director failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const cleanJson = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsedArray: any;
    try {
      parsedArray = JSON.parse(cleanJson);
    } catch (err) {
      const snippet = responseText.slice(0, 200);
      throw new Error(
        `Parse AI Director response failed (${err instanceof Error ? err.message : 'JSON error'}). Raw: "${snippet}"`
      );
    }

    if (!Array.isArray(parsedArray)) {
      const snippet = responseText.slice(0, 200);
      throw new Error(`AI Director did not return a JSON array. Raw: "${snippet}"`);
    }

    for (const item of parsedArray) {
      if (typeof item.order !== 'number') continue;

      // 6. Nếu AI trả id hiệu ứng không hợp lệ thì lọc lấy các id hợp lệ; nếu mảng rỗng do lọc thì đặt undefined (để GIỮ hiệu ứng cũ của shot)
      let validEffects: string[] | undefined = undefined;
      if (Array.isArray(item.effects)) {
        const filtered = item.effects.filter((e: string) => VALID_EFFECTS.has(e)).slice(0, 3);
        if (filtered.length > 0) {
          validEffects = filtered;
        }
      }

      const sanitized: DirectorSuggestion = {
        order: item.order,
        shotSize: VALID_SHOT_SIZES.has(item.shotSize) ? item.shotSize : undefined,
        cameraAngle: VALID_ANGLES.has(item.cameraAngle) ? item.cameraAngle : undefined,
        cameraMovement: VALID_MOVES.has(item.cameraMovement) ? item.cameraMovement : undefined,
        lens: VALID_PERSPECTIVES.has(item.lens) ? item.lens : undefined,
        lighting: VALID_LIGHTINGS.has(item.lighting) ? item.lighting : undefined,
        weather: VALID_WEATHERS.has(item.weather) ? item.weather : undefined,
        effects: validEffects,
        startPose: typeof item.startPose === 'string' ? item.startPose.trim() : undefined,
        endPose: typeof item.endPose === 'string' ? item.endPose.trim() : undefined,
        ambient: typeof item.ambient === 'string' ? item.ambient.trim() : undefined,
        sfx: typeof item.sfx === 'string' ? item.sfx.trim() : undefined,
      };

      allSuggestions.push(sanitized);
    }
  }

  return allSuggestions;
}

export function buildComparisonRows(
  targetShots: Shot[],
  suggestions: DirectorSuggestion[]
): DirectorComparisonRow[] {
  const sugMap = new Map<number, DirectorSuggestion>();
  suggestions.forEach((s) => sugMap.set(s.order, s));

  const rows: DirectorComparisonRow[] = [];

  for (const shot of targetShots) {
    const sug = sugMap.get(shot.order);
    if (!sug) continue;

    const changes: Array<{ field: string; label: string; oldVal: string; newVal: string }> = [];

    if (sug.shotSize && sug.shotSize !== shot.shotSize) {
      changes.push({ field: 'shotSize', label: 'Cỡ cảnh', oldVal: shot.shotSize, newVal: sug.shotSize });
    }
    if (sug.cameraAngle && sug.cameraAngle !== shot.cameraAngle) {
      changes.push({ field: 'cameraAngle', label: 'Góc máy', oldVal: shot.cameraAngle, newVal: sug.cameraAngle });
    }
    if (sug.cameraMovement && sug.cameraMovement !== shot.cameraMovement) {
      changes.push({ field: 'cameraMovement', label: 'Chuyển động', oldVal: shot.cameraMovement, newVal: sug.cameraMovement });
    }
    if (sug.lens && sug.lens !== shot.lens) {
      changes.push({ field: 'lens', label: 'Phối cảnh', oldVal: shot.lens, newVal: sug.lens });
    }
    if (sug.lighting && sug.lighting !== shot.lighting) {
      changes.push({ field: 'lighting', label: 'Ánh sáng', oldVal: shot.lighting || 'mặc định', newVal: sug.lighting });
    }
    if (sug.weather && sug.weather !== shot.weather) {
      changes.push({ field: 'weather', label: 'Thời tiết', oldVal: shot.weather || 'clear', newVal: sug.weather });
    }
    if (sug.effects && sug.effects.length > 0) {
      const oldEff = (shot.effects || []).join(', ') || 'none';
      const newEff = sug.effects.join(', ') || 'none';
      if (oldEff !== newEff) {
        changes.push({ field: 'effects', label: 'Hiệu ứng', oldVal: oldEff, newVal: newEff });
      }
    }
    if (sug.startPose && sug.startPose !== shot.startPose) {
      changes.push({ field: 'startPose', label: 'Start Pose', oldVal: shot.startPose || '—', newVal: sug.startPose });
    }
    if (sug.endPose && sug.endPose !== shot.endPose) {
      changes.push({ field: 'endPose', label: 'End Pose', oldVal: shot.endPose || '—', newVal: sug.endPose });
    }
    if (sug.ambient && sug.ambient !== shot.ambient) {
      changes.push({ field: 'ambient', label: 'Ambient', oldVal: shot.ambient || '—', newVal: sug.ambient });
    }
    if (sug.sfx && sug.sfx !== shot.audioSfx) {
      changes.push({ field: 'sfx', label: 'SFX', oldVal: shot.audioSfx || '—', newVal: sug.sfx });
    }

    if (changes.length > 0) {
      rows.push({ shot, changes, suggestion: sug });
    }
  }

  return rows;
}

export function applySuggestionsToShots(
  allShots: Shot[],
  suggestions: DirectorSuggestion[]
): Shot[] {
  const sugMap = new Map<number, DirectorSuggestion>();
  suggestions.forEach((s) => sugMap.set(s.order, s));

  const applied = allShots.map((sh) => {
    const sug = sugMap.get(sh.order);
    if (!sug) return sh;

    return {
      ...sh,
      shotSize: sug.shotSize || sh.shotSize,
      cameraAngle: sug.cameraAngle || sh.cameraAngle,
      cameraMovement: sug.cameraMovement || sh.cameraMovement,
      lens: sug.lens || sh.lens,
      lighting: sug.lighting !== undefined ? sug.lighting : sh.lighting,
      weather: sug.weather !== undefined ? sug.weather : sh.weather,
      effects: sug.effects !== undefined ? sug.effects : sh.effects,
      startPose: sug.startPose !== undefined ? sug.startPose : sh.startPose,
      endPose: sug.endPose !== undefined ? sug.endPose : sh.endPose,
      ambient: sug.ambient !== undefined ? sug.ambient : sh.ambient,
      audioSfx: sug.sfx !== undefined ? sug.sfx : sh.audioSfx,
      userEdited: true,
    };
  });

  // Sau khi áp dụng đề xuất của Đạo diễn AI, chạy thêm enforceVariety để loại bỏ lặp góc máy/cỡ cảnh
  const { shots: finalShots } = enforceVariety(applied);
  return finalShots;
}
