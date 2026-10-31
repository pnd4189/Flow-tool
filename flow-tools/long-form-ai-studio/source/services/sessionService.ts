import { Flow } from 'flow-sdk';
import {
  ProjectConfig,
  Character,
  Scene,
  Shot,
  VideoModel,
  ImageModel,
  VideoResolution,
  VideoTake,
  ShotLock,
  QCResult,
} from './types';
import { LOOKS } from './library';
import { projectSlug } from './exportKit';

export interface StudioSessionDataV2 {
  version: 2;
  savedAt: number;
  projectTitle: string;
  runTag?: string;
  config: ProjectConfig;
  characters: Array<{
    id: string;
    name: string;
    dna: Character['dna'];
    mediaId?: string;
    thumbBase64?: string;
    mimeType?: string;
    locked: boolean;
    createdAt: number;
  }>;
  scenes: Array<{
    id: string;
    title: string;
    environment: string;
    environmentVi?: string;
    timeOfDay: string;
    ambientDefault: string;
    lightingDefault: string;
    weather?: string;
    locationRef?: {
      mediaId: string;
      thumbBase64: string;
    };
  }>;
  shots: Array<{
    id: string;
    sceneId: string;
    order: number;
    actionBeat: string;
    action?: string;
    actionVi?: string;
    subject?: string;
    characterIds: string[];
    characterNames?: string[];
    shotSize: string;
    cameraAngle: string;
    cameraMovement: string;
    lens: string;
    lighting: string;
    weather?: string;
    effects?: string[];
    transitionIn?: 'chain' | 'cut';
    audioDialogue: string;
    audioSfx: string;
    ambient: string;
    startPose: string;
    endPose: string;
    narration?: string;
    eraLabel?: string;
    factNote?: string;
    modelOverride?: VideoModel;
    durationOverride?: number;
    resolutionOverride?: VideoResolution;
    userEdited?: boolean;
    startKeyframe?: {
      mediaId: string;
      thumbBase64: string;
      promptUsed?: string;
    };
    endKeyframe?: {
      mediaId: string;
      thumbBase64: string;
      promptUsed?: string;
    };
    lock?: ShotLock;
    activeTakeId?: string;
    takes?: Array<{
      id: string;
      mediaId: string;
      sizeBytes: number;
      model: VideoModel;
      durationSeconds: number;
      resolution: VideoResolution;
      aspectRatio: '16:9' | '9:16';
      creditCost: number;
      renderedAt: number;
      promptUsed: string;
      firstFrameMediaId?: string;
      lastFrameMediaId?: string;
      qc?: QCResult;
      stale?: boolean;
    }>;
  }>;
  credit: {
    budget: number;
    spent: number;
    calibrated: boolean;
  };
}

const VALID_VIDEO_MODELS: VideoModel[] = [
  'Omni 1.1 Flash',
  'Veo 3.1 - Lite',
  'Veo 3.1 - Fast',
  'Veo 3.1 - Quality',
];

const VALID_IMAGE_MODELS: ImageModel[] = [
  '🍌 Nano Banana 2.1',
  '🍌 Nano Banana Pro',
];

const VALID_RESOLUTIONS: VideoResolution[] = ['360p', '720p'];

export function formatSessionFilenameTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}${mm}${dd}_${hh}${min}`;
}

export function jsonToBase64(jsonString: string): string {
  const bytes = new TextEncoder().encode(jsonString);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/** Xuất phiên v2 đầy đủ - dùng projectSlug thống nhất cho tên file */
export async function exportStudioSession(params: {
  projectTitle?: string;
  runTag?: string;
  config: ProjectConfig;
  characters: Character[];
  scenes: Scene[];
  shots: Shot[];
  creditBudget: number;
  creditsUsed: number;
  isCalibrated: boolean;
}): Promise<string> {
  const cleanShots = params.shots.map((sh) => {
    const cleanTakes = (sh.takes || []).map((t) => ({
      id: t.id,
      mediaId: t.mediaId,
      sizeBytes: t.sizeBytes || 0,
      model: t.model,
      durationSeconds: t.durationSeconds,
      resolution: t.resolution,
      aspectRatio: t.aspectRatio,
      creditCost: t.creditCost,
      renderedAt: t.renderedAt,
      promptUsed: t.promptUsed,
      firstFrameMediaId: t.firstFrameMediaId,
      lastFrameMediaId: t.lastFrameMediaId,
      qc: t.qc,
      stale: t.stale,
    }));

    return {
      id: sh.id,
      sceneId: sh.sceneId,
      order: sh.order,
      actionBeat: sh.actionBeat,
      action: sh.action || '',
      actionVi: sh.actionVi || '',
      subject: sh.subject || '',
      characterIds: sh.characterIds || [],
      characterNames: sh.characterNames || [],
      shotSize: sh.shotSize,
      cameraAngle: sh.cameraAngle,
      cameraMovement: sh.cameraMovement,
      lens: sh.lens,
      lighting: sh.lighting,
      weather: sh.weather || 'clear',
      effects: (sh.effects || []).slice(0, 3),
      transitionIn: sh.transitionIn || 'chain',
      audioDialogue: sh.audioDialogue || '',
      audioSfx: sh.audioSfx || '',
      ambient: sh.ambient || '',
      startPose: sh.startPose || '',
      endPose: sh.endPose || '',
      narration: sh.narration || '',
      eraLabel: sh.eraLabel || '',
      factNote: sh.factNote || '',
      modelOverride: sh.modelOverride,
      durationOverride: sh.durationOverride,
      resolutionOverride: sh.resolutionOverride,
      userEdited: sh.userEdited,
      startKeyframe: sh.startKeyframe
        ? {
            mediaId: sh.startKeyframe.mediaId,
            thumbBase64: sh.startKeyframe.thumbBase64,
            promptUsed: sh.startKeyframe.promptUsed,
          }
        : undefined,
      endKeyframe: sh.endKeyframe
        ? {
            mediaId: sh.endKeyframe.mediaId,
            thumbBase64: sh.endKeyframe.thumbBase64,
            promptUsed: sh.endKeyframe.promptUsed,
          }
        : undefined,
      lock: sh.lock,
      activeTakeId: sh.activeTakeId,
      takes: cleanTakes.length > 0 ? cleanTakes : undefined,
    };
  });

  const cleanCharacters = params.characters.map((c) => ({
    id: c.id,
    name: c.name,
    dna: {
      faceShape: c.dna.faceShape || c.dna.facialStructure || '',
      eyes: c.dna.eyes || '',
      hairstyle: c.dna.hairstyle || '',
      skinTone: c.dna.skinTone || '',
      outfit: c.dna.outfit || '',
      accessories: c.dna.accessories || '',
      proportions: c.dna.proportions || '6 heads tall anime proportions',
      palette: c.dna.palette || '#1E3A8A navy, #F5B301 amber',
    },
    mediaId: c.mediaId,
    thumbBase64: c.thumbBase64,
    mimeType: c.mimeType || 'image/jpeg',
    locked: c.locked ?? true,
    createdAt: c.createdAt || Date.now(),
  }));

  const cleanScenes = params.scenes.map((sc) => ({
    id: sc.id,
    title: sc.title,
    environment: sc.environment,
    environmentVi: sc.environmentVi || sc.environment,
    timeOfDay: sc.timeOfDay,
    ambientDefault: sc.ambientDefault,
    lightingDefault: sc.lightingDefault,
    weather: sc.weather,
    locationRef: sc.locationRef,
  }));

  const sessionPayload: StudioSessionDataV2 = {
    version: 2,
    savedAt: Date.now(),
    projectTitle: params.projectTitle || 'Long-Form AI Studio',
    runTag: params.runTag || 'v2',
    config: params.config,
    characters: cleanCharacters,
    scenes: cleanScenes,
    shots: cleanShots,
    credit: {
      budget: params.creditBudget,
      spent: params.creditsUsed,
      calibrated: params.isCalibrated,
    },
  };

  const jsonStr = JSON.stringify(sessionPayload, null, 2);
  const base64 = jsonToBase64(jsonStr);
  const pSlug = projectSlug(params.projectTitle || 'long_form_ai_studio');
  const filename = `${pSlug}_session_v2_${formatSessionFilenameTimestamp()}.json`;

  await Flow.download({
    base64,
    mimeType: 'application/json',
    filename,
  });

  return filename;
}

export interface RestoredSessionResult {
  version: number;
  projectTitle?: string;
  config: ProjectConfig;
  characters: Character[];
  scenes: Scene[];
  shots: Shot[];
  creditBudget: number;
  creditsUsed: number;
  isCalibrated: boolean;
}

/** Nhập và khôi phục phiên: chấp nhận cả version 1 và version 2 */
export function importStudioSession(jsonText: string): RestoredSessionResult {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Tập tin không phải là JSON hợp lệ.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Dữ liệu phiên không đúng định dạng.');
  }

  const fileVersion = parsed.version || 1;
  if (fileVersion !== 1 && fileVersion !== 2) {
    throw new Error(`Phiên bản file (${fileVersion}) không được hỗ trợ (chỉ nhận v1 hoặc v2).`);
  }

  const rawConfig = parsed.config || {};
  const validLookIds = new Set(LOOKS.map((l) => l.id));
  const effectiveLookId = validLookIds.has(rawConfig.lookId) ? rawConfig.lookId : 'anime_cel';

  const config: ProjectConfig = {
    mode: rawConfig.mode === 'short' ? 'short' : 'long',
    targetShots: typeof rawConfig.targetShots === 'number' ? rawConfig.targetShots : 35,
    videoModel: VALID_VIDEO_MODELS.includes(rawConfig.videoModel) ? rawConfig.videoModel : 'Omni 1.1 Flash',
    imageModel: VALID_IMAGE_MODELS.includes(rawConfig.imageModel) ? rawConfig.imageModel : '🍌 Nano Banana 2.1',
    resolution: VALID_RESOLUTIONS.includes(rawConfig.resolution) ? rawConfig.resolution : '720p',
    durationSeconds: typeof rawConfig.durationSeconds === 'number' ? rawConfig.durationSeconds : 8,
    aspectRatio: rawConfig.aspectRatio === '9:16' ? '9:16' : '16:9',
    lookId: effectiveLookId,
    customStyle: rawConfig.customStyle || '',
  };

  const characters: Character[] = Array.isArray(parsed.characters)
    ? parsed.characters.map((c: any) => {
        const rawDna = c.dna || {};
        return {
          id: c.id || `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: c.name || 'Unnamed',
          dna: {
            faceShape: rawDna.faceShape || rawDna.facialStructure || '',
            eyes: rawDna.eyes || '',
            hairstyle: rawDna.hairstyle || '',
            skinTone: rawDna.skinTone || '',
            outfit: rawDna.outfit || '',
            accessories: rawDna.accessories || '',
            proportions: rawDna.proportions || '6 heads tall anime proportions',
            palette: rawDna.palette || '#1E3A8A navy, #F5B301 amber',
          },
          mediaId: c.mediaId,
          thumbBase64: c.thumbBase64,
          mimeType: c.mimeType || 'image/jpeg',
          locked: c.locked ?? true,
          createdAt: c.createdAt || Date.now(),
        };
      })
    : [];

  const scenes: Scene[] = Array.isArray(parsed.scenes)
    ? parsed.scenes.map((sc: any, idx: number) => ({
        id: sc.id || `scene_${Date.now()}_${idx + 1}`,
        title: sc.title || `Scene 0${idx + 1}`,
        environment: sc.environment || '',
        environmentVi: sc.environmentVi || sc.environment || '',
        timeOfDay: sc.timeOfDay || 'Daylight',
        ambientDefault: sc.ambientDefault || '',
        lightingDefault: sc.lightingDefault || 'day_flat',
        weather: sc.weather || 'clear',
        locationRef: sc.locationRef,
      }))
    : [];

  const shots: Shot[] = Array.isArray(parsed.shots)
    ? parsed.shots.map((sh: any, idx: number) => {
        let takes: VideoTake[] | undefined = undefined;

        if (Array.isArray(sh.takes) && sh.takes.length > 0) {
          takes = sh.takes.map((t: any) => ({
            id: t.id || `take_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            mediaId: t.mediaId,
            blobUrl: undefined,
            sizeBytes: t.sizeBytes || 0,
            model: VALID_VIDEO_MODELS.includes(t.model) ? t.model : config.videoModel,
            durationSeconds: t.durationSeconds || config.durationSeconds,
            resolution: VALID_RESOLUTIONS.includes(t.resolution) ? t.resolution : config.resolution,
            aspectRatio: t.aspectRatio || config.aspectRatio,
            creditCost: t.creditCost || 12,
            renderedAt: t.renderedAt || Date.now(),
            promptUsed: t.promptUsed || sh.action || sh.actionBeat || '',
            firstFrameMediaId: t.firstFrameMediaId,
            lastFrameMediaId: t.lastFrameMediaId,
            qc: t.qc,
            stale: t.stale,
          }));
        } else if (sh.video) {
          takes = [
            {
              id: `take_migrated_${sh.id}`,
              mediaId: sh.video.mediaId,
              blobUrl: undefined,
              sizeBytes: sh.video.sizeBytes || 0,
              model: sh.video.model || config.videoModel,
              durationSeconds: sh.video.durationSeconds || config.durationSeconds,
              resolution: sh.video.resolution || config.resolution,
              aspectRatio: sh.video.aspectRatio || config.aspectRatio,
              creditCost: sh.video.creditCost || 12,
              renderedAt: sh.video.renderedAt || Date.now(),
              promptUsed: sh.action || sh.actionBeat || '',
              firstFrameMediaId: sh.startKeyframe?.mediaId,
              lastFrameMediaId: sh.endKeyframe?.mediaId,
            },
          ];
        }

        const isFirstInScene = idx === 0 || sh.transitionIn === 'cut';
        const defaultTransition = isFirstInScene ? 'cut' : (sh.transitionIn || 'chain');

        return {
          id: sh.id || `shot_${Date.now()}_${idx + 1}`,
          sceneId: sh.sceneId || (scenes[0]?.id ?? 'scene_default'),
          order: typeof sh.order === 'number' ? sh.order : idx + 1,
          actionBeat: sh.actionBeat || '',
          action: sh.action || '',
          actionVi: sh.actionVi || '',
          subject: sh.subject || '',
          characterIds: Array.isArray(sh.characterIds) ? sh.characterIds : [],
          characterNames: Array.isArray(sh.characterNames) ? sh.characterNames : [],
          shotSize: sh.shotSize || 'medium',
          cameraAngle: sh.cameraAngle || 'eye_level',
          cameraMovement: sh.cameraMovement || 'pan_slow',
          lens: sh.lens || 'normal',
          lighting: sh.lighting || 'day_flat',
          weather: sh.weather || 'clear',
          effects: Array.isArray(sh.effects) ? sh.effects.slice(0, 3) : [],
          transitionIn: defaultTransition,
          audioDialogue: sh.audioDialogue || '',
          audioSfx: sh.audioSfx || '',
          ambient: sh.ambient || '',
          startPose: sh.startPose || '',
          endPose: sh.endPose || '',
          narration: sh.narration || '',
          eraLabel: sh.eraLabel || '',
          factNote: sh.factNote || '',
          modelOverride: sh.modelOverride,
          durationOverride: sh.durationOverride,
          resolutionOverride: sh.resolutionOverride,
          userEdited: sh.userEdited,
          startKeyframe: sh.startKeyframe,
          endKeyframe: sh.endKeyframe,
          lock: sh.lock,
          takes,
          activeTakeId: sh.activeTakeId || (takes ? takes[takes.length - 1]?.id : undefined),
          renderStatus: takes && takes.length > 0 ? 'done' : 'idle',
          renderError: undefined,
        };
      })
    : [];

  const creditBudget = typeof parsed.credit?.budget === 'number' ? parsed.credit.budget : 6000;
  const creditsUsed = typeof parsed.credit?.spent === 'number' ? parsed.credit.spent : 0;
  const isCalibrated = Boolean(parsed.credit?.calibrated);

  return {
    version: fileVersion,
    projectTitle: parsed.projectTitle,
    config,
    characters,
    scenes,
    shots,
    creditBudget,
    creditsUsed,
    isCalibrated,
  };
}

/**
 * Nạp lại clip video từ thư viện Flow cho một take khôi phục bị thiếu blobUrl
 */
export async function reloadTakeBlobFromGallery(): Promise<{
  mediaId: string;
  blobUrl: string;
  sizeBytes: number;
}> {
  const media = await Flow.media.select({ filter: 'video' });
  if (!media || !media.base64) {
    throw new Error('Không nhận được dữ liệu video từ thư viện.');
  }

  const binaryString = atob(media.base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const end = Math.min(i + chunkSize, len);
    for (let j = i; j < end; j++) {
      bytes[j] = binaryString.charCodeAt(j);
    }
  }

  const mimeType = media.mimeType || 'video/mp4';
  const blob = new Blob([bytes], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);

  return {
    mediaId: media.mediaId,
    blobUrl,
    sizeBytes: blob.size,
  };
}
