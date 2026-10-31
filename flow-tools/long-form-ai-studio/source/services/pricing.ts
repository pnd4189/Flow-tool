import { VideoModel, VideoResolution } from './types';

// Pricing benchmarks (Ultra tier - 2026-10-29)
// Omni 360p: 4s=4, 6s=5, 8s=6, 10s=7
// Omni 720p: 4s=7, 6s=10, 8s=12, 10s=15
// Veo Lite: 5 (all durations, 720p only)
// Veo Fast: 10 (all durations, 720p only)
// Veo Quality: 100 (all durations, 720p only)

export function getShotCreditCost(
  model: VideoModel,
  resolution: VideoResolution,
  durationSeconds: number
): number {
  if (model === 'Omni 1.1 Flash') {
    if (resolution === '360p') {
      switch (durationSeconds) {
        case 4: return 4;
        case 6: return 5;
        case 8: return 6;
        case 10: return 7;
        default: return 6;
      }
    } else {
      // 720p
      switch (durationSeconds) {
        case 4: return 7;
        case 6: return 10;
        case 8: return 12;
        case 10: return 15;
        default: return 12;
      }
    }
  }

  if (model === 'Veo 3.1 - Lite') {
    return 5;
  }

  if (model === 'Veo 3.1 - Fast') {
    return 10;
  }

  if (model === 'Veo 3.1 - Quality') {
    return 100;
  }

  return 12;
}

export function getAllModelCosts(
  resolution: VideoResolution,
  durationSeconds: number,
  targetShots: number
): Array<{
  model: VideoModel;
  perShot: number;
  totalCost: number;
  isAvailableForConfig: boolean;
}> {
  const models: VideoModel[] = [
    'Omni 1.1 Flash',
    'Veo 3.1 - Lite',
    'Veo 3.1 - Fast',
    'Veo 3.1 - Quality',
  ];

  return models.map((m) => {
    // Veo does not support 360p or 10s
    const isVeo = m.startsWith('Veo');
    const isAvailableForConfig = !(isVeo && (resolution === '360p' || durationSeconds === 10));

    // For comparison table, fallback to valid Veo parameters (720p, capped duration) if current config is Omni-only
    const effectiveRes: VideoResolution = isVeo ? '720p' : resolution;
    const effectiveDur = isVeo && durationSeconds === 10 ? 8 : durationSeconds;

    const perShot = getShotCreditCost(m, effectiveRes, effectiveDur);
    const totalCost = perShot * targetShots;

    return {
      model: m,
      perShot,
      totalCost,
      isAvailableForConfig,
    };
  });
}
