import { Flow } from 'flow-sdk';
import type {
  CameraMoveType,
  OverlayId,
  OverlayConfig,
  EffectConfig,
  QueueItem,
} from '../types';
import { thumbnailFromUrl, withTimeout } from './genQueue';
import { OVERLAY_DEFINITIONS } from './overlays';

export const VALID_CAMERA_MOVES: CameraMoveType[] = [
  'none',
  'zoom_in',
  'zoom_out',
  'pan_left',
  'pan_right',
  'pan_up',
  'pan_down',
  'push_to_focus',
  'orbit_sway',
  'handheld',
  'dolly_zoom',
];

export const VALID_OVERLAY_IDS: OverlayId[] = OVERLAY_DEFINITIONS.map((o) => o.id);

export interface AiDirectorDecision {
  camera: {
    move: CameraMoveType;
    intensity: number; // 0 - 1
    focus?: { x: number; y: number };
  };
  parallax: {
    enabled: boolean;
    direction: 'left' | 'right' | 'up' | 'down' | 'in';
    depth: number;
  };
  overlays: OverlayConfig[]; // 0 - 3 mục
  durationSec: number;
  reason: string; // tiếng Việt <= 20 từ
}

export interface DirectEffectsResult {
  decision: AiDirectorDecision;
  ok: boolean;
  error?: string;
}

/**
 * Xếp họ máy quay:
 * - zoom: zoom_in, push_to_focus
 * - pan: pan_left, pan_right, pan_up, pan_down
 * - các kiểu còn lại mỗi kiểu 1 họ riêng
 */
export function getCameraMoveFamily(move: CameraMoveType): string {
  if (move === 'zoom_in' || move === 'push_to_focus') return 'zoom';
  if (move === 'pan_left' || move === 'pan_right' || move === 'pan_up' || move === 'pan_down') return 'pan';
  return move;
}

/**
 * Đa dạng hoá chuyển động máy quay theo 6 clip gần nhất (Đợt 7B):
 * - recentMoves là 6 clip gần nhất theo thứ tự xử lý.
 * - Chỉ áp cho mục source 'ai'; 'none' và dolly_zoom không bị đổi. Nếu đổi thì aiReason giữ nguyên.
 * - Nếu họ của aiMove xuất hiện >= 3 lần trong recentMoves, chọn kiểu đầu tiên trong vòng
 *   [pan_right, zoom_out, pan_left, orbit_sway, pan_up, handheld, pan_down] mà họ của nó
 *   xuất hiện ít nhất trong recentMoves và không trùng clip liền trước.
 * - Giữ nguyên intensity (handheld thì tối đa 0.5).
 */
export function chooseVariedMove(
  aiMove: CameraMoveType,
  recentMoves: CameraMoveType[]
): CameraMoveType {
  if (aiMove === 'none' || aiMove === 'dolly_zoom') {
    return aiMove;
  }

  const last6 = recentMoves.slice(-6);
  const targetFamily = getCameraMoveFamily(aiMove);
  const countFamily = last6.filter((m) => getCameraMoveFamily(m) === targetFamily).length;

  if (countFamily < 3) {
    return aiMove;
  }

  const candidates: CameraMoveType[] = [
    'pan_right',
    'zoom_out',
    'pan_left',
    'orbit_sway',
    'pan_up',
    'handheld',
    'pan_down',
  ];

  const lastMove = last6.length > 0 ? last6[last6.length - 1] : undefined;

  // Tính số lần xuất hiện của mỗi họ trong last6
  const familyCountMap: Record<string, number> = {};
  for (const m of last6) {
    const fam = getCameraMoveFamily(m);
    familyCountMap[fam] = (familyCountMap[fam] || 0) + 1;
  }

  // Tìm mức xuất hiện họ tối thiểu trong các candidate không trùng lastMove
  let minCount = Infinity;
  for (const c of candidates) {
    if (c === lastMove) continue;
    const fam = getCameraMoveFamily(c);
    const cnt = familyCountMap[fam] || 0;
    if (cnt < minCount) {
      minCount = cnt;
    }
  }

  // Chọn kiểu đầu tiên đạt minCount và không trùng lastMove
  for (const c of candidates) {
    if (c === lastMove) continue;
    const fam = getCameraMoveFamily(c);
    const cnt = familyCountMap[fam] || 0;
    if (cnt === minCount) {
      return c;
    }
  }

  return aiMove;
}

/**
 * Chu trình đổi kiểu máy quay đa dạng hoá khi trùng 2 ảnh trước
 */
export function getNextDiverseCameraMove(currentMove: CameraMoveType): CameraMoveType {
  const cycle: CameraMoveType[] = [
    'zoom_in',
    'pan_right',
    'push_to_focus',
    'pan_left',
    'zoom_out',
    'orbit_sway',
    'pan_up',
  ];
  const idx = cycle.indexOf(currentMove);
  if (idx === -1) {
    return 'pan_right';
  }
  return cycle[(idx + 1) % cycle.length];
}

/**
 * Phân tích ảnh từ imageUrl bằng Flow.generate.text (Gemini Vision)
 * Có timeout 60s qua withTimeout.
 */
export async function directEffectsForImage(
  imageUrl: string,
  promptText: string
): Promise<DirectEffectsResult> {
  const runDirect = async (): Promise<DirectEffectsResult> => {
    const thumb = await thumbnailFromUrl(imageUrl, 768);

    const systemInstruction = `Bạn là đạo diễn hình ảnh và chuyên gia kỹ xảo (VFX/Camera Director) chuyên nghiệp.
Nhiệm vụ: Nhìn kỹ bức ảnh thực tế và đọc prompt của ảnh để chọn chuyển động máy quay (camera) và hiệu ứng phủ (overlays) PHÙ HỢP TUYỆT ĐỐI với bối cảnh thật nhìn thấy.

QUY TẮC BẮT BUỘC:
1. CHỈ TRẢ VỀ DUY NHẤT một chuỗi JSON hợp lệ (không kèm lời chào hay giải thích ngoài JSON):
{
  "camera": {
    "move": string,
    "intensity": number (0.1 - 1.0),
    "focus": { "x": number (0-1), "y": number (0-1) }
  },
  "parallax": {
    "enabled": boolean,
    "direction": "in" | "left" | "right" | "up" | "down",
    "depth": number (0.2 - 0.9)
  },
  "overlays": [
    { "id": string, "intensity": number (0.1 - 1.0) }
  ],
  "durationSec": number (4 - 8),
  "reason": string (tiếng Việt <= 20 từ)
}

2. DANH SÁCH 15 OVERLAY IDS HỢP LỆ (CHỈ CHỌN 0 ĐẾN TỐI ĐA 3 HIỆU ỨNG TỪ ĐÚNG DANH SÁCH NÀY):
- dust_motes: Bụi lơ lửng phát sáng
- bokeh: Đốm sáng bokeh mờ ảo
- sparkles: Lấp lánh sao
- snow: Tuyết rơi
- rain: Mưa rơi
- petals: Cánh hoa rơi
- embers: Tàn than lửa bốc lên
- fog: Sương khói trôi
- light_rays: Tia sáng chéo rọi
- light_leak: Vệt rò sáng ấm
- lens_flare: Vệt lóa ống kính
- film_grain: Hạt phim cổ điển (chỉ dùng nhẹ <= 0.4)
- vignette: Viền tối 4 góc (chỉ dùng nhẹ <= 0.4)
- flicker: Chập chờn ánh nến/đèn
- fireflies: Đom đóm đêm

3. QUY TẮC NỘI DUNG VÀ KHÔNG GIAN:
- KHÔNG BAO GIỜ thêm thời tiết trái ngược với nội dung ảnh:
  * KHÔNG tuyết ở cảnh mùa hè, biển, sa mạc, phòng khách ấm cúng.
  * KHÔNG mưa ở trong nhà kín khô ráo, phòng ngủ hay xưởng xe.
  * Cảnh bão/biển động: chỉ dùng rain + fog; KHÔNG tuyết hay đom đóm.
- Quy tắc gợi ý bối cảnh:
  * Rừng / nắng xuyên: dust_motes, light_rays, fog
  * Đêm mưa / phố đêm: rain, flicker, bokeh
  * Mùa đông / băng giá: snow
  * Lửa / chiến đấu / lò rèn: embers
  * Lãng mạn / mùa xuân: petals, bokeh, light_leak
  * Đêm đồng quê / ven sông: fireflies
  * Kỳ ảo / phép thuật: sparkles, bokeh
  * Trong nhà ấm cúng: dust_motes, light_leak
  * Xưởng cơ khí / steampunk: dust_motes, embers nhẹ, film_grain
- Chọn camera.move theo bố cục ảnh, cảnh rộng ngang ưu tiên pan_left/pan_right/zoom_out, cảnh cao/dọc ưu tiên pan_up/pan_down, chỉ dùng push_to_focus khi có chủ thể nhỏ cần nhấn, không mặc định zoom_in.
- Chuyển động máy quay (camera.move chỉ chọn từ: "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down", "push_to_focus", "orbit_sway", "handheld", "dolly_zoom", "none"):
  * Cảnh tĩnh lặng/êm đềm: chuyển động chậm (zoom_in / pan), intensity 0.3 - 0.5.
  * Cảnh kịch tính, hành động, sinh động: intensity 0.6 - 0.9 hoặc handheld.
- Parallax: bật "enabled: true" khi có chủ thể rõ ràng (người, động vật, robot, vật thể lớn) tách biệt khỏi hậu cảnh. Nếu là cảnh phong cảnh phẳng, góc rộng mênh mông không có chủ thể rõ thì "enabled: false".
- Lý do (reason): Viết bằng tiếng Việt súc tích, giải thích vì sao chọn hiệu ứng đó (tối đa 20 từ).`;

    const promptInspection = `Hãy xem xét kỹ ảnh này cùng prompt: "${promptText}". Hãy quyết định camera, parallax và overlays phù hợp nhất.`;

    const res = await Flow.generate.text(promptInspection, {
      systemInstruction,
      thinkingLevel: 'low',
      images: [
        {
          base64: thumb.base64,
          mimeType: thumb.mimeType,
        },
      ],
    });

    const raw = (res.text || '').trim();
    const validated = sanitizeAndValidateDecision(raw);
    if (!validated) {
      const errMsg = 'JSON phản hồi từ AI không hợp lệ';
      return {
        decision: getFallbackDecision(`AI lỗi: ${errMsg} — dùng mặc định`),
        ok: false,
        error: errMsg,
      };
    }

    return {
      decision: validated,
      ok: true,
    };
  };

  try {
    return await withTimeout(runDirect(), 60000, 'directEffectsForImage');
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn('Lỗi gọi AI Director:', errMsg);
    return {
      decision: getFallbackDecision(`AI lỗi: ${errMsg.slice(0, 50)} — dùng mặc định`),
      ok: false,
      error: errMsg,
    };
  }
}

/**
 * Xử lý bóc tách JSON an toàn, chịu rào markdown ```json ... ``` và kẹp khoảng giá trị
 */
export function sanitizeAndValidateDecision(rawText: string): AiDirectorDecision | null {
  let cleaned = rawText
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  let move: CameraMoveType = 'zoom_in';
  if (parsed.camera?.move && VALID_CAMERA_MOVES.includes(parsed.camera.move)) {
    move = parsed.camera.move;
  }

  let camIntensity = 0.4;
  if (typeof parsed.camera?.intensity === 'number') {
    camIntensity = Math.max(0.1, Math.min(1.0, parsed.camera.intensity));
  }

  let focus: { x: number; y: number } | undefined = undefined;
  if (
    parsed.camera?.focus &&
    typeof parsed.camera.focus.x === 'number' &&
    typeof parsed.camera.focus.y === 'number'
  ) {
    focus = {
      x: Math.max(0.05, Math.min(0.95, parsed.camera.focus.x)),
      y: Math.max(0.05, Math.min(0.95, parsed.camera.focus.y)),
    };
  }

  const parallaxEnabled = !!parsed.parallax?.enabled;
  const validDirs = ['in', 'left', 'right', 'up', 'down'];
  const dir = validDirs.includes(parsed.parallax?.direction)
    ? parsed.parallax.direction
    : 'in';
  const depth = typeof parsed.parallax?.depth === 'number'
    ? Math.max(0.1, Math.min(1.0, parsed.parallax.depth))
    : 0.5;

  const validOverlays: OverlayConfig[] = [];
  if (Array.isArray(parsed.overlays)) {
    for (const ov of parsed.overlays) {
      if (ov && ov.id && VALID_OVERLAY_IDS.includes(ov.id)) {
        if (!validOverlays.some((existing) => existing.id === ov.id)) {
          let inten = typeof ov.intensity === 'number' ? Math.max(0.1, Math.min(1.0, ov.intensity)) : 0.35;
          if (ov.id === 'vignette' || ov.id === 'film_grain') {
            inten = Math.min(0.4, inten);
          }
          validOverlays.push({
            id: ov.id,
            intensity: Math.round(inten * 100) / 100,
          });
          if (validOverlays.length >= 3) break;
        }
      }
    }
  }

  let durationSec = 6;
  if (typeof parsed.durationSec === 'number') {
    durationSec = Math.max(3, Math.min(10, Math.round(parsed.durationSec)));
  }

  let reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
  if (!reason) {
    reason = 'AI đã phân tích bố cục và màu sắc để chọn hiệu ứng phù hợp.';
  } else {
    const words = reason.split(/\s+/);
    if (words.length > 20) {
      reason = words.slice(0, 20).join(' ') + '...';
    }
  }

  return {
    camera: {
      move,
      intensity: Math.round(camIntensity * 100) / 100,
      focus,
    },
    parallax: {
      enabled: parallaxEnabled,
      direction: dir as any,
      depth: Math.round(depth * 100) / 100,
    },
    overlays: validOverlays,
    durationSec,
    reason,
  };
}

export function getFallbackDecision(reason = 'Hiệu ứng mặc định: zoom nhẹ và hạt bụi'): AiDirectorDecision {
  return {
    camera: {
      move: 'zoom_in',
      intensity: 0.4,
      focus: { x: 0.5, y: 0.5 },
    },
    parallax: {
      enabled: false,
      direction: 'in',
      depth: 0.5,
    },
    overlays: [
      {
        id: 'dust_motes',
        intensity: 0.3,
      },
    ],
    durationSec: 6,
    reason,
  };
}

export function diversifyCameraMoves(items: QueueItem[]): QueueItem[] {
  const result: QueueItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    if (!current.effectConfig) {
      result.push(current);
      continue;
    }

    const prev1Move = result[i - 1]?.effectConfig?.camera.move;
    const prev2Move = result[i - 2]?.effectConfig?.camera.move;
    const currentMove = current.effectConfig.camera.move;
    const isAiSource = current.effectConfig.source === 'ai';

    if (
      isAiSource &&
      i >= 2 &&
      prev1Move &&
      prev2Move &&
      prev1Move === currentMove &&
      prev2Move === currentMove
    ) {
      const replacementMove = getNextDiverseCameraMove(currentMove);
      result.push({
        ...current,
        effectConfig: {
          ...current.effectConfig,
          camera: {
            ...current.effectConfig.camera,
            move: replacementMove,
          },
        },
      });
    } else {
      result.push(current);
    }
  }

  return result;
}

export function applyAiDecisionToQueueItem(
  item: QueueItem,
  decisionResult: DirectEffectsResult
): QueueItem {
  const { decision, ok, error } = decisionResult;
  const seed = item.effectConfig?.seed || Math.floor(Math.random() * 1000000);

  const sourceVal: 'ai' | 'default' = ok ? 'ai' : 'default';
  const reasonVal = ok
    ? decision.reason
    : `AI lỗi: ${error || 'không thể phân tích'} — dùng mặc định`;

  const nextConfig: EffectConfig = {
    camera: {
      move: decision.camera.move,
      intensity: decision.camera.intensity,
      easing: 'easeInOut',
      focus: decision.camera.focus || item.parallaxLayers?.subjectCenter || { x: 0.5, y: 0.5 },
    },
    parallax: {
      enabled: decision.parallax.enabled,
      direction: decision.parallax.direction,
      depth: decision.parallax.depth,
      subjectBreath: true,
      subjectFloat: false,
      disabledReason: undefined,
    },
    overlays: decision.overlays,
    durationSec: decision.durationSec,
    fadeInOut: true,
    seed,
    source: sourceVal,
    aiReason: reasonVal,
  };

  const currentLayers = item.parallaxLayers || { status: 'none' };

  return {
    ...item,
    effectConfig: nextConfig,
    parallaxLayers: currentLayers,
  };
}
