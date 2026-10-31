import { Flow } from 'flow-sdk';
import { Shot, Scene, Character, ProjectConfig, KeyframeInfo } from './types';
import { compileKeyframePrompt, compileLocationRefPrompt } from './shotengine';
import { getLook } from './library';
import { makeThumbnail } from './imageUtils';

export interface KeyframeSlot {
  slotId: string;
  label: string;
  shotOrder: number;
  type: 'start' | 'end' | 'shared';
  connectedShotOrders: number[];
  prompt: string;
  referenceMediaIds: string[];
  refSummary: string;
  currentKeyframe?: KeyframeInfo;
  hasContinuityRef: boolean;
  needsSyncWarning?: boolean;
  status: 'idle' | 'pending' | 'done' | 'error';
  errorMessage?: string;
}

function buildRefSummary(charCount: number, hasContinuity: boolean, hasLocation: boolean): string {
  const parts: string[] = [];
  if (charCount > 0) parts.push(`nhân vật 2D ×${charCount}`);
  if (hasContinuity) parts.push('keyframe trước');
  if (hasLocation) parts.push('bối cảnh');
  return parts.length > 0 ? parts.join(' + ') : 'không tham chiếu';
}

export function buildKeyframeSlots(
  shots: Shot[],
  scenes: Scene[],
  characters: Character[],
  config: ProjectConfig
): KeyframeSlot[] {
  if (shots.length === 0) return [];

  const sceneMap = new Map<string, Scene>();
  scenes.forEach((s) => sceneMap.set(s.id, s));

  const shotByOrder = new Map<number, Shot>();
  shots.forEach((sh) => shotByOrder.set(sh.order, sh));

  const look = getLook(config.lookId);
  const slots: KeyframeSlot[] = [];

  for (let i = 0; i < shots.length; i++) {
    const currShot = shots[i];
    const currScene = sceneMap.get(currShot.sceneId);

    // Xử lý START của currShot
    if (i === 0 || currShot.transitionIn === 'cut') {
      const charMediaIds = characters
        .filter((c) => currShot.characterIds.includes(c.id) && c.mediaId)
        .map((c) => c.mediaId!);

      const refs = [...charMediaIds];
      let hasLocation = false;
      if (currScene?.locationRef?.mediaId && !refs.includes(currScene.locationRef.mediaId)) {
        refs.push(currScene.locationRef.mediaId);
        hasLocation = true;
      }

      slots.push({
        slotId: `shot_${currShot.order}_start`,
        label: i === 0 ? `K1 • #1 START (mở đầu)` : `#${currShot.order} START (cắt cảnh)`,
        shotOrder: currShot.order,
        type: 'start',
        connectedShotOrders: [currShot.order],
        prompt: compileKeyframePrompt(currShot, currScene, characters, 'start', look, config.customStyle, false),
        referenceMediaIds: refs.slice(0, 10),
        refSummary: buildRefSummary(charMediaIds.length, false, hasLocation),
        currentKeyframe: currShot.startKeyframe,
        hasContinuityRef: false,
        status: currShot.startKeyframe ? 'done' : 'idle',
      });
    }

    // Xử lý END của currShot và ranh giới với shot tiếp theo (nếu có)
    const nextShot = i < shots.length - 1 ? shots[i + 1] : undefined;

    if (nextShot) {
      if (nextShot.transitionIn === 'chain') {
        const existing = currShot.endKeyframe || nextShot.startKeyframe;
        const charIdsSet = new Set([...currShot.characterIds, ...nextShot.characterIds]);
        const charMediaIds = characters
          .filter((c) => charIdsSet.has(c.id) && c.mediaId)
          .map((c) => c.mediaId!);

        const prevSlotWithKf = [...slots].reverse().find((s) => {
          if (!s.currentKeyframe?.mediaId) return false;
          const ownerShot = shotByOrder.get(s.shotOrder);
          return ownerShot?.sceneId === currShot.sceneId;
        });

        const refs = [...charMediaIds];
        let hasContinuity = false;

        if (prevSlotWithKf?.currentKeyframe?.mediaId && !refs.includes(prevSlotWithKf.currentKeyframe.mediaId)) {
          refs.push(prevSlotWithKf.currentKeyframe.mediaId);
          hasContinuity = true;
        }

        let hasLocation = false;
        if (currScene?.locationRef?.mediaId && !refs.includes(currScene.locationRef.mediaId)) {
          refs.push(currScene.locationRef.mediaId);
          hasLocation = true;
        }

        slots.push({
          slotId: `boundary_${currShot.order}_${nextShot.order}`,
          label: `K${slots.length + 1} • cuối #${currShot.order} / đầu #${nextShot.order} (liền mạch)`,
          shotOrder: currShot.order,
          type: 'shared',
          connectedShotOrders: [currShot.order, nextShot.order],
          prompt: compileKeyframePrompt(currShot, currScene, characters, 'end', look, config.customStyle, hasContinuity),
          referenceMediaIds: refs.slice(0, 10),
          refSummary: buildRefSummary(charMediaIds.length, hasContinuity, hasLocation),
          currentKeyframe: existing,
          hasContinuityRef: hasContinuity,
          status: existing ? 'done' : 'idle',
        });
      } else {
        const charMediaIds = characters
          .filter((c) => currShot.characterIds.includes(c.id) && c.mediaId)
          .map((c) => c.mediaId!);

        const prevSlotWithKf = [...slots].reverse().find((s) => {
          if (!s.currentKeyframe?.mediaId) return false;
          const ownerShot = shotByOrder.get(s.shotOrder);
          return ownerShot?.sceneId === currShot.sceneId;
        });

        const refs = [...charMediaIds];
        let hasContinuity = false;

        if (prevSlotWithKf?.currentKeyframe?.mediaId && !refs.includes(prevSlotWithKf.currentKeyframe.mediaId)) {
          refs.push(prevSlotWithKf.currentKeyframe.mediaId);
          hasContinuity = true;
        }

        let hasLocation = false;
        if (currScene?.locationRef?.mediaId && !refs.includes(currScene.locationRef.mediaId)) {
          refs.push(currScene.locationRef.mediaId);
          hasLocation = true;
        }

        slots.push({
          slotId: `shot_${currShot.order}_end`,
          label: `#${currShot.order} END (kết thúc shot)`,
          shotOrder: currShot.order,
          type: 'end',
          connectedShotOrders: [currShot.order],
          prompt: compileKeyframePrompt(currShot, currScene, characters, 'end', look, config.customStyle, hasContinuity),
          referenceMediaIds: refs.slice(0, 10),
          refSummary: buildRefSummary(charMediaIds.length, hasContinuity, hasLocation),
          currentKeyframe: currShot.endKeyframe,
          hasContinuityRef: hasContinuity,
          status: currShot.endKeyframe ? 'done' : 'idle',
        });
      }
    } else {
      const charMediaIds = characters
        .filter((c) => currShot.characterIds.includes(c.id) && c.mediaId)
        .map((c) => c.mediaId!);

      const prevSlotWithKf = [...slots].reverse().find((s) => {
        if (!s.currentKeyframe?.mediaId) return false;
        const ownerShot = shotByOrder.get(s.shotOrder);
        return ownerShot?.sceneId === currShot.sceneId;
      });

      const refs = [...charMediaIds];
      let hasContinuity = false;

      if (prevSlotWithKf?.currentKeyframe?.mediaId && !refs.includes(prevSlotWithKf.currentKeyframe.mediaId)) {
        refs.push(prevSlotWithKf.currentKeyframe.mediaId);
        hasContinuity = true;
      }

      let hasLocation = false;
      if (currScene?.locationRef?.mediaId && !refs.includes(currScene.locationRef.mediaId)) {
        refs.push(currScene.locationRef.mediaId);
        hasLocation = true;
      }

      slots.push({
        slotId: `shot_${currShot.order}_end`,
        label: `K${slots.length + 1} • #${currShot.order} END (hạ màn)`,
        shotOrder: currShot.order,
        type: 'end',
        connectedShotOrders: [currShot.order],
        prompt: compileKeyframePrompt(currShot, currScene, characters, 'end', look, config.customStyle, hasContinuity),
        referenceMediaIds: refs.slice(0, 10),
        refSummary: buildRefSummary(charMediaIds.length, hasContinuity, hasLocation),
        currentKeyframe: currShot.endKeyframe,
        hasContinuityRef: hasContinuity,
        status: currShot.endKeyframe ? 'done' : 'idle',
      });
    }
  }

  return slots;
}

export function isTransientError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('tạm thời không hoạt động') ||
    lower.includes('unavailable') ||
    lower.includes('busy') ||
    lower.includes('overloaded') ||
    lower.includes('rate limit') ||
    lower.includes('timeout')
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateSingleKeyframeWithRetry(
  prompt: string,
  config: ProjectConfig,
  referenceImageMediaIds: string[]
): Promise<KeyframeInfo> {
  const retryDelays = [8000, 20000];
  let attempt = 0;

  const aspectRatio = config.mode === 'long' ? '16:9' : '9:16';
  const cleanRefs = Array.from(new Set(referenceImageMediaIds.filter(Boolean))).slice(0, 10);

  const options: {
    prompt: string;
    modelDisplayName: string;
    aspectRatio: '16:9' | '9:16';
    referenceImageMediaIds?: string[];
  } = {
    prompt,
    modelDisplayName: config.imageModel,
    aspectRatio,
  };

  if (cleanRefs.length > 0) {
    options.referenceImageMediaIds = cleanRefs;
  }

  while (true) {
    try {
      const res = await Flow.generate.image(options);
      const dataUrl = `data:${res.mimeType};base64,${res.base64}`;
      const thumbBase64 = await makeThumbnail(dataUrl, 420);

      return {
        mediaId: res.mediaId,
        thumbBase64,
        promptUsed: prompt,
        aspectRatio,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < retryDelays.length && isTransientError(errMsg)) {
        await sleep(retryDelays[attempt]);
        attempt++;
      } else {
        throw new Error(errMsg);
      }
    }
  }
}

/** Sinh ảnh bối cảnh không người 2D cho scene */
export async function generateSceneLocationRef(
  scene: Scene,
  config: ProjectConfig
): Promise<{ mediaId: string; thumbBase64: string }> {
  const look = getLook(config.lookId);
  const prompt = compileLocationRefPrompt(scene, look);
  const aspectRatio = config.mode === 'long' ? '16:9' : '9:16';

  const res = await Flow.generate.image({
    prompt,
    modelDisplayName: config.imageModel,
    aspectRatio,
  });

  const dataUrl = `data:${res.mimeType};base64,${res.base64}`;
  const thumbBase64 = await makeThumbnail(dataUrl, 360);

  return { mediaId: res.mediaId, thumbBase64 };
}

export function applyKeyframeToShots(
  shots: Shot[],
  slot: KeyframeSlot,
  keyframe: KeyframeInfo | undefined
): Shot[] {
  return shots.map((s) => {
    let next = { ...s };
    if (slot.type === 'start' && s.order === slot.shotOrder) {
      next.startKeyframe = keyframe;
    } else if (slot.type === 'end' && s.order === slot.shotOrder) {
      next.endKeyframe = keyframe;
    } else if (slot.type === 'shared') {
      const [orderA, orderB] = slot.connectedShotOrders;
      if (s.order === orderA) {
        next.endKeyframe = keyframe;
      }
      if (s.order === orderB) {
        next.startKeyframe = keyframe;
      }
    }
    return next;
  });
}
