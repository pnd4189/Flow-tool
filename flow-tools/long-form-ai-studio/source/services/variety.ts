import { Shot } from './types';

/**
 * Bảng thay thế chuyển động máy quay theo chuỗi nhịp nhàng 2D:
 * push_in → pan_slow → parallax_truck → pull_out → tilt_up → follow
 */
const CAMERA_MOVE_CYCLE = [
  'push_in',
  'pan_slow',
  'parallax_truck',
  'pull_out',
  'tilt_up',
  'follow',
];

/**
 * Các chuyển động giữ nguyên nếu shot có hành động mạnh / va đập / giật gân
 */
const HIGH_ACTION_MOVES = new Set(['impact_shake', 'whip_pan', 'snap_zoom']);

/**
 * Chu kỳ cỡ cảnh 2D: wide → medium → close_up
 */
const SHOT_SIZE_CYCLE = ['wide', 'medium', 'close_up', 'medium_wide', 'ots'];

/**
 * Kiểm tra xem shot có mô tả hành động mạnh hay không
 */
function isHighActionBeat(actionText?: string): boolean {
  if (!actionText) return false;
  const lower = actionText.toLowerCase();
  return (
    lower.includes('crash') ||
    lower.includes('explode') ||
    lower.includes('rầm') ||
    lower.includes('đâm') ||
    lower.includes('nổ') ||
    lower.includes('va chạm') ||
    lower.includes('chạy') ||
    lower.includes('tốc độ') ||
    lower.includes('burst') ||
    lower.includes('fall') ||
    lower.includes('ngã')
  );
}

/**
 * Tìm camera movement kế tiếp trong chu kỳ khác với giá trị hiện tại
 */
function getNextMovement(current: string): string {
  const idx = CAMERA_MOVE_CYCLE.indexOf(current);
  if (idx === -1) return 'pan_slow';
  return CAMERA_MOVE_CYCLE[(idx + 1) % CAMERA_MOVE_CYCLE.length];
}

/**
 * Tìm shotSize kế tiếp theo nhịp wide → medium → close_up
 */
function getNextShotSize(current: string): string {
  const idx = SHOT_SIZE_CYCLE.indexOf(current);
  if (idx === -1) return 'medium';
  return SHOT_SIZE_CYCLE[(idx + 1) % SHOT_SIZE_CYCLE.length];
}

export interface VarietyResult {
  shots: Shot[];
  modifiedCount: number;
}

/**
 * Đa dạng hoá máy quay (enforceVariety):
 * - Nếu cùng cameraMovement xuất hiện ở 3 shot liên tiếp: đổi shot thứ 3
 *   (trừ khi là high action move trên shot hành động mạnh).
 * - Nếu cùng shotSize xuất hiện ở 4 shot liên tiếp: đổi shot thứ 4 theo nhịp wide → medium → close_up.
 * - Shot có cờ userEdited === true được BẢO TỒN NGUYÊN VẸN không bao giờ bị đổi.
 */
export function enforceVariety(shots: Shot[]): VarietyResult {
  if (shots.length === 0) return { shots, modifiedCount: 0 };

  let modifiedCount = 0;
  const nextShots = shots.map((sh) => ({ ...sh }));

  // 1. Kiểm tra lặp cameraMovement (3 shot liên tiếp)
  for (let i = 2; i < nextShots.length; i++) {
    const s0 = nextShots[i - 2];
    const s1 = nextShots[i - 1];
    const s2 = nextShots[i];

    if (
      s0.cameraMovement &&
      s0.cameraMovement === s1.cameraMovement &&
      s1.cameraMovement === s2.cameraMovement
    ) {
      // Nếu shot đã được người dùng chỉnh tay -> bỏ qua
      if (s2.userEdited) continue;

      // Nếu là move hành động mạnh và shot hành động mạnh -> giữ nguyên
      if (HIGH_ACTION_MOVES.has(s2.cameraMovement) && isHighActionBeat(s2.action || s2.actionBeat)) {
        continue;
      }

      const nextMove = getNextMovement(s2.cameraMovement);
      if (nextMove !== s2.cameraMovement) {
        s2.cameraMovement = nextMove;
        modifiedCount++;
      }
    }
  }

  // 2. Kiểm tra lặp shotSize (4 shot liên tiếp)
  for (let i = 3; i < nextShots.length; i++) {
    const s0 = nextShots[i - 3];
    const s1 = nextShots[i - 2];
    const s2 = nextShots[i - 1];
    const s3 = nextShots[i];

    if (
      s0.shotSize &&
      s0.shotSize === s1.shotSize &&
      s1.shotSize === s2.shotSize &&
      s2.shotSize === s3.shotSize
    ) {
      if (s3.userEdited) continue;

      const nextSize = getNextShotSize(s3.shotSize);
      if (nextSize !== s3.shotSize) {
        s3.shotSize = nextSize;
        modifiedCount++;
      }
    }
  }

  return {
    shots: nextShots,
    modifiedCount,
  };
}
