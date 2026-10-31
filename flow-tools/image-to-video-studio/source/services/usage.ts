export interface UsageEvent {
  ts: number;
  type: 'image' | 'image_failed' | 'video';
  model: string;
  credits: number;
  note?: string;
}

export interface UsageState {
  version: 1;
  calibrated: boolean; // false: chưa hiệu chỉnh với Flow
  dailyImageCap: number; // Mặc định 1000
  imageDate: string; // YYYY-MM-DD theo giờ máy
  imageCount: number;
  imageFailed: number;
  monthlyCreditBudget: number; // Mặc định 6000
  creditBaseline: number; // Mặc định = monthlyCreditBudget
  creditSpent: number; // Credit tool đã dùng kể từ lần hiệu chỉnh gần nhất
  cycleResetDay: number; // 1-28, mặc định 1
  cycleStartDate: string; // YYYY-MM-DD
  log: UsageEvent[]; // Tối đa 50 mục mới nhất
}

/** Helper lấy YYYY-MM-DD theo local time */
export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Tính ngày bắt đầu chu kỳ gần nhất dựa trên cycleResetDay (1-28) */
export function getCycleStartDate(cycleResetDay: number, now: Date = new Date()): string {
  const safeResetDay = Math.min(28, Math.max(1, Math.floor(cycleResetDay || 1)));
  const currentDay = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based

  let cycleDate: Date;
  if (currentDay >= safeResetDay) {
    cycleDate = new Date(year, month, safeResetDay);
  } else {
    // Tháng trước
    cycleDate = new Date(year, month - 1, safeResetDay);
  }
  return getLocalDateString(cycleDate);
}

export function getDefaultUsageState(): UsageState {
  const today = getLocalDateString();
  const cycleStart = getCycleStartDate(1);
  return {
    version: 1,
    calibrated: false,
    dailyImageCap: 1000,
    imageDate: today,
    imageCount: 0,
    imageFailed: 0,
    monthlyCreditBudget: 6000,
    creditBaseline: 6000,
    creditSpent: 0,
    cycleResetDay: 1,
    cycleStartDate: cycleStart,
    log: [],
  };
}

/** Tự rollover khi sang ngày mới hoặc chu kỳ mới */
export function rolloverUsage(state: UsageState, now: Date = new Date()): UsageState {
  let next = { ...state };
  const today = getLocalDateString(now);

  // 1. Rollover ngày ảnh
  if (next.imageDate !== today) {
    next.imageDate = today;
    next.imageCount = 0;
    next.imageFailed = 0;
  }

  // 2. Rollover chu kỳ credit
  const expectedCycleStart = getCycleStartDate(next.cycleResetDay, now);
  if (next.cycleStartDate !== expectedCycleStart) {
    next.cycleStartDate = expectedCycleStart;
    next.creditBaseline = next.monthlyCreditBudget;
    next.creditSpent = 0;
    next.calibrated = false;
  }

  return next;
}

/** Khởi tạo state trong bộ nhớ của phiên (đã áp dụng rollover theo ngày) */
export function initUsageState(): UsageState {
  return rolloverUsage(getDefaultUsageState());
}

/** Ghi nhận 1 lần tạo ảnh (thành công hoặc lỗi) */
export function recordImage(state: UsageState, success: boolean, model: string): UsageState {
  const current = rolloverUsage(state);
  const event: UsageEvent = {
    ts: Date.now(),
    type: success ? 'image' : 'image_failed',
    model,
    credits: 0,
  };

  const nextLog = [event, ...current.log].slice(0, 50);

  return {
    ...current,
    imageCount: success ? current.imageCount + 1 : current.imageCount,
    imageFailed: success ? current.imageFailed : current.imageFailed + 1,
    log: nextLog,
  };
}

/** Ghi nhận credit video đã dùng */
export function recordVideoCredits(state: UsageState, credits: number, model: string, note?: string): UsageState {
  const current = rolloverUsage(state);
  const cost = Math.max(0, credits);
  const event: UsageEvent = {
    ts: Date.now(),
    type: 'video',
    model,
    credits: cost,
    note,
  };

  const nextLog = [event, ...current.log].slice(0, 50);

  return {
    ...current,
    creditSpent: current.creditSpent + cost,
    log: nextLog,
  };
}

/** Hiệu chỉnh số credit còn lại trên Flow */
export function calibrateCredits(state: UsageState, remainingNow: number): UsageState {
  const current = rolloverUsage(state);
  return {
    ...current,
    calibrated: true,
    creditBaseline: Math.max(0, remainingNow),
    creditSpent: 0,
  };
}

/** Đặt số ảnh đã tạo hôm nay bằng tay */
export function setTodayImages(state: UsageState, count: number): UsageState {
  const current = rolloverUsage(state);
  return {
    ...current,
    imageCount: Math.max(0, Math.floor(count)),
  };
}

/** Reset đếm ảnh hôm nay */
export function resetTodayImages(state: UsageState): UsageState {
  const current = rolloverUsage(state);
  return {
    ...current,
    imageCount: 0,
    imageFailed: 0,
  };
}

/** Cập nhật cài đặt usage */
export function updateSettings(state: UsageState, partial: Partial<UsageState>): UsageState {
  const current = rolloverUsage(state);
  const next = { ...current, ...partial };

  // Khi thay đổi "Credit/tháng" thì cập nhật luôn creditBaseline = giá trị mới nếu creditSpent đang bằng 0 và chưa hiệu chỉnh
  if (partial.monthlyCreditBudget !== undefined && !current.calibrated && current.creditSpent === 0) {
    next.creditBaseline = partial.monthlyCreditBudget;
  }

  // Nếu cycleResetDay thay đổi thì cập nhật lại cycleStartDate
  if (partial.cycleResetDay !== undefined && partial.cycleResetDay !== current.cycleResetDay) {
    next.cycleStartDate = getCycleStartDate(partial.cycleResetDay);
  }

  return next;
}

// Selectors
export function imagesLeftToday(state: UsageState): number {
  return Math.max(0, state.dailyImageCap - state.imageCount);
}

export function creditsLeft(state: UsageState): number {
  return Math.max(0, state.creditBaseline - state.creditSpent);
}

/*
 * Bảng chi phí credit video cho gói ULTRA:
 */
export const VIDEO_CREDIT_COSTS: Record<string, { perLength?: Record<number, number>; flat?: number; resolutions?: Record<'720p' | '360p', Record<number, number>> }> = {
  'Veo 3.1 - Lite': { flat: 5 },
  'Veo 3.1 - Fast': { flat: 10 },
  'Veo 3.1 - Quality': { flat: 100 },
  'Omni 1.1 Flash': {
    resolutions: {
      '720p': { 4: 7, 6: 10, 8: 12, 10: 15 },
      '360p': { 4: 4, 6: 5, 8: 6, 10: 7 },
    },
  },
};

/** Ước tính số credit video cho gói Ultra */
export function estimateVideoCredits(
  model: string,
  resolution: '720p' | '360p' = '720p',
  seconds: number = 4,
  count: number = 1
): number {
  const cfg = VIDEO_CREDIT_COSTS[model];
  if (!cfg) return 0;

  let unitCost = 0;
  if (typeof cfg.flat === 'number') {
    unitCost = cfg.flat;
  } else if (cfg.resolutions) {
    const resMap = cfg.resolutions[resolution] || cfg.resolutions['720p'];
    unitCost = resMap[seconds] || resMap[4] || 7;
  }

  return Math.max(0, unitCost * Math.max(1, count));
}
