import { Flow } from 'flow-sdk';
import type {
  QueueItem,
  AutoPilotConfig,
  AutoPilotItemProgress,
  AutoPilotItemStage,
  EffectConfig,
  AutoPilotSummary,
  MockErrorConfig,
  DebugSimulationMode,
  ExportManifestItem,
  MemoryStats,
  CameraMoveType,
  GeneratedImageVariant,
} from '../types';
import {
  constructSentPrompt,
  generateSingleImageWithTimeout,
  rewritePromptForSafety,
  inspectImageQc,
  isTemporaryError,
  isSafetyPolicyError,
  isPureQuotaExceededError,
  getNextFallbackModel,
  base64ToBlobUrl,
  createResizedThumbnail,
  withTimeout,
} from './genQueue';
import {
  directEffectsForImage,
  applyAiDecisionToQueueItem,
  chooseVariedMove,
} from './effectDirector';
import {
  generateParallaxLayers,
  invalidateLayerCache,
} from './layerService';
import {
  renderClipToMp4,
  renderMergedVideo,
  buildManifestJson,
  getExportDimensions,
} from './exportService';
import {
  downloadQueue,
  buildFilename,
  slugify,
  normalizePromptKey,
  downloadJsonFile,
} from './downloadQueue';
import { createDefaultEffectConfig } from './motionEngine';

export interface StageBreakdownEstimate {
  genSecPerItem: number;
  qcSecPerItem: number;
  effectSecPerItem: number;
  layerSecPerItem: number;
  renderSecPerItem: number;
  downloadSecPerItem: number;
  firstItemLatencySec: number;
  bottleneckStageName: string;
  bottleneckSecPerItem: number;
  totalSec: number;
  finishTimeFormatted: string;
  isTomorrow: boolean;
  durationFormatted: string;
}

export interface AutoPilotCallbacks {
  onItemUpdate: (item: AutoPilotItemProgress) => void;
  onOverallUpdate: (counts: {
    genDone: number;
    effectDone: number;
    layerDone: number;
    renderDone: number;
    downloadDone: number;
    total: number;
    memoryStats: MemoryStats;
    currentSpeedMsg?: string;
  }) => void;
  onGlobalError?: (msg: string) => void;
  onAutoPausedForConsecutiveErrors?: (msg: string) => void;
  onCooldownStatus?: (msg: string | null) => void;
  onFinished: (summary: AutoPilotSummary) => void;
  onSyncBackToState: (items: QueueItem[], completedCountThisTurn?: number) => void;
}

export function formatDurationHuman(sec: number): string {
  const rounded = Math.round(sec);
  if (rounded < 60) return `~${Math.max(1, rounded)} giây`;
  const m = Math.floor(rounded / 60);
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h > 0) {
    if (remM === 0) return `~${h} giờ`;
    return `~${h} giờ ${remM} phút`;
  }
  return `~${m} phút`;
}

export function formatFinishTime(secFromNow: number, fromDate = new Date()): { timeStr: string; isTomorrow: boolean } {
  const targetMs = fromDate.getTime() + secFromNow * 1000;
  const targetDate = new Date(targetMs);
  const hours = String(targetDate.getHours()).padStart(2, '0');
  const mins = String(targetDate.getMinutes()).padStart(2, '0');
  const isTomorrow = targetDate.getDate() !== fromDate.getDate() || targetDate.getMonth() !== fromDate.getMonth();
  const timeStr = `${hours}:${mins}${isTomorrow ? ' (ngày mai)' : ''}`;
  return { timeStr, isTomorrow };
}

export function estimateRun(
  mode: AutoPilotConfig['mode'],
  N: number,
  cfg: Partial<AutoPilotConfig>,
  measuredAverages?: {
    genSec?: number;
    qcSec?: number;
    effectSec?: number;
    layerSec?: number;
    renderSec?: number;
  }
): StageBreakdownEstimate {
  if (N <= 0) {
    return {
      genSecPerItem: 0,
      qcSecPerItem: 0,
      effectSecPerItem: 0,
      layerSecPerItem: 0,
      renderSecPerItem: 0,
      downloadSecPerItem: 0,
      firstItemLatencySec: 0,
      bottleneckStageName: 'Không có',
      bottleneckSecPerItem: 0,
      totalSec: 0,
      finishTimeFormatted: 'ngay bây giờ',
      isTomorrow: false,
      durationFormatted: '0 giây',
    };
  }

  const concurrency = Math.max(1, cfg.concurrency || 2);
  const is1080 = (cfg.resolution || '1080p') === '1080p';
  const autoQc = cfg.autoQc !== false;

  const baseGenTurnTime = measuredAverages?.genSec !== undefined
    ? (autoQc ? (measuredAverages.genSec + (measuredAverages.qcSec ?? 9)) * 1.05 : measuredAverages.genSec)
    : (autoQc ? (28 + 9) * 1.05 : 28);

  const genSec = baseGenTurnTime / concurrency;
  const qcSecDisplay = autoQc ? (measuredAverages?.qcSec ?? 9) : 0;

  const rawEffect = measuredAverages?.effectSec ?? 9;
  const rawRender = measuredAverages?.renderSec ?? (is1080 ? 8 : 4);
  const rawDownload = 1.5;

  let effectSec = rawEffect;
  let layerSec = mode === 'full' ? (measuredAverages?.layerSec !== undefined ? measuredAverages.layerSec * 0.75 : 30 * 0.75) : 0;
  let renderSec = rawRender;
  let dlSec = rawDownload;

  if (mode === 'no_parallax') {
    layerSec = 0;
  } else if (mode === 'camera_only') {
    layerSec = 0;
    effectSec = Math.min(rawEffect, 7);
  } else if (mode === 'images_only') {
    effectSec = 0;
    layerSec = 0;
    renderSec = 0;
    dlSec = 1.0;
  }

  const firstItemLatencySec = baseGenTurnTime + (mode !== 'images_only' ? effectSec + layerSec + renderSec : 0) + dlSec;

  const pipelineStages: { name: string; sec: number }[] = [
    { name: 'Sinh ảnh', sec: genSec },
  ];
  if (effectSec > 0) pipelineStages.push({ name: 'Chọn hiệu ứng', sec: effectSec });
  if (layerSec > 0) pipelineStages.push({ name: 'Tách lớp Parallax', sec: layerSec });
  if (renderSec > 0) pipelineStages.push({ name: 'Dựng video MP4', sec: renderSec });
  pipelineStages.push({ name: 'Tải file', sec: dlSec });

  let bottleneck = pipelineStages[0];
  for (const st of pipelineStages) {
    if (st.sec > bottleneck.sec) {
      bottleneck = st;
    }
  }

  const totalSec = Math.round(firstItemLatencySec + Math.max(0, N - 1) * bottleneck.sec);
  const { timeStr, isTomorrow } = formatFinishTime(totalSec);
  const durationFormatted = formatDurationHuman(totalSec);

  return {
    genSecPerItem: Math.round(genSec * 10) / 10,
    qcSecPerItem: Math.round(qcSecDisplay * 10) / 10,
    effectSecPerItem: Math.round(effectSec * 10) / 10,
    layerSecPerItem: Math.round(layerSec * 10) / 10,
    renderSecPerItem: Math.round(renderSec * 10) / 10,
    downloadSecPerItem: Math.round(dlSec * 10) / 10,
    firstItemLatencySec: Math.round(firstItemLatencySec),
    bottleneckStageName: bottleneck.name,
    bottleneckSecPerItem: Math.round(bottleneck.sec * 10) / 10,
    totalSec,
    finishTimeFormatted: timeStr,
    isTomorrow,
    durationFormatted,
  };
}

function getImageDimensionsFromBase64(base64: string, mimeType: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1024, height: img.naturalHeight || 1024 });
    img.onerror = () => resolve({ width: 1024, height: 1024 });
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

export class AutoPilotPipeline {
  private config: AutoPilotConfig;
  private queueItems: QueueItem[];
  private itemsProgress: Map<string, AutoPilotItemProgress> = new Map();
  private callbacks: AutoPilotCallbacks;

  // Điều khiển
  private isPaused = false;
  private isStopped = false;
  private isRunning = false;
  private isQuotaStopped = false;
  private startTime = 0;
  private wakeLockSentinel: any = null;

  // Mock error ref & debug mode
  private mockErrorConfigRef?: { current: MockErrorConfig };
  private debugMode: DebugSimulationMode = 'none';

  // Thống kê đếm
  private genDoneCount = 0;
  private effectDoneCount = 0;
  private layerDoneCount = 0;
  private renderDoneCount = 0;
  private downloadDoneCount = 0;
  private skippedCount = 0;
  private successImagesThisTurn = 0;

  // Đo lường thực tế
  private recentGenTimes: number[] = [];
  private recentQcTimes: number[] = [];
  private recentEffectTimes: number[] = [];
  private recentLayerTimes: number[] = [];
  private recentRenderTimes: number[] = [];
  private completionTimestamps: number[] = [];

  // Gom cập nhật tiến trình
  private pendingItemUpdates: Map<string, AutoPilotItemProgress> = new Map();
  private isBatchUpdateScheduled = false;
  private lastOverallUpdateTime = 0;

  // Ổn định & tự phục hồi
  private effectiveConcurrency: number;
  private currentActiveModel: string;
  private rateLimitTimestamps: number[] = [];
  private lastThrottleDownTime = 0;
  private consecutiveFailedItems = 0;
  private cooldownRounds = 0;
  private isCoolingDown = false;
  private cooldownTimer: any = null;

  // Lịch sử chuyển động camera (6 clip gần nhất theo thứ tự xử lý)
  private recentProcessedMoves: CameraMoveType[] = [];

  // Hàng đợi tuần tự
  private effectQueue: string[] = [];
  private isEffectWorkerRunning = false;

  // Tách lớp 2 luồng
  private layerQueue: string[] = [];
  private activeLayerCount = 0;

  // Dựng tuần tự
  private renderQueue: string[] = [];
  private isRenderWorkerRunning = false;

  // Chia lô & Manifest
  private batchSize: number;
  private currentBatchIndex = 1;
  private itemsInCurrentBatch: ExportManifestItem[] = [];

  // Mảng lưu riêng tất cả các clip hoàn tất cho manifest tổng
  private completedManifestItems: ExportManifestItem[] = [];

  // Quản lý bộ nhớ
  private clipFormatMap: Record<string, 'mp4' | 'webm'> = {};
  private activeObjectUrls: Set<string> = new Set();
  private releasedItemsCount = 0;

  // Lưu trữ base64 gốc thực tế của các ảnh thắng QC
  private finalImageRawBytes: Map<string, { base64: string; mimeType: string }> = new Map();

  // Tổng số prompt của file gốc
  private totalOriginalPromptsCount: number;

  constructor(
    queueItems: QueueItem[],
    config: AutoPilotConfig,
    callbacks: AutoPilotCallbacks,
    mockErrorConfigRef?: { current: MockErrorConfig },
    debugMode: DebugSimulationMode = 'none',
    totalOriginalPromptsCount?: number,
    initialBatchIndex = 1
  ) {
    this.queueItems = [...queueItems];
    this.config = { ...config };
    this.callbacks = callbacks;
    this.mockErrorConfigRef = mockErrorConfigRef;
    this.debugMode = debugMode;
    this.totalOriginalPromptsCount = totalOriginalPromptsCount || queueItems.length;

    this.effectiveConcurrency = config.concurrency || 2;
    this.currentActiveModel = config.modelName || '🍌 Nano Banana 2.1';
    this.batchSize = config.batchSize || 10;
    this.currentBatchIndex = Math.max(1, initialBatchIndex);

    this.queueItems.forEach((q) => {
      const pKey = normalizePromptKey(q.promptItem.prompt);
      const isAlreadyDone = !!q.completedFromManifest;
      if (isAlreadyDone) this.skippedCount++;

      const p: AutoPilotItemProgress = {
        id: q.id,
        order: q.promptItem.order,
        promptKey: pKey,
        title: q.promptItem.title,
        prompt: q.promptItem.prompt,
        aspectRatio: q.promptItem.aspectRatio,
        stage: isAlreadyDone ? 'skipped' : 'waiting',
      };
      this.itemsProgress.set(q.id, p);
    });
  }

  public getProgressList(): AutoPilotItemProgress[] {
    return Array.from(this.itemsProgress.values()).sort((a, b) => a.order - b.order);
  }

  public pause(): void {
    this.isPaused = true;
    this.releaseWakeLock();
    this.flushBatchedUpdates();
  }

  public resume(): void {
    if (!this.isPaused && !this.isCoolingDown) return;
    this.isPaused = false;
    this.isCoolingDown = false;
    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    if (this.callbacks.onCooldownStatus) {
      this.callbacks.onCooldownStatus(null);
    }
    this.consecutiveFailedItems = 0;
    this.cooldownRounds = 0;
    this.requestWakeLock();
    this.pumpGenerators();
    this.processEffectQueue();
    this.pumpLayerWorkers();
    this.processRenderQueue();
  }

  public async stop(): Promise<void> {
    this.isStopped = true;
    this.isRunning = false;
    this.releaseWakeLock();

    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    if (this.callbacks.onCooldownStatus) {
      this.callbacks.onCooldownStatus(null);
    }

    while (this.isRenderWorkerRunning) {
      await new Promise((r) => setTimeout(r, 150));
    }

    await downloadQueue.waitIdle();

    this.flushPartialBatch();
    this.flushBatchedUpdates();

    const totalTimeMs = Math.round(performance.now() - this.startTime);
    const errorCount = Array.from(this.itemsProgress.values()).filter((it) => it.stage === 'error').length;
    const unstartedCount = Array.from(this.itemsProgress.values()).filter((it) => it.stage === 'not_started').length;

    const summary: AutoPilotSummary & { stoppedByUser?: boolean; unstartedCount?: number } = {
      mode: this.config.mode,
      completedClips: this.downloadDoneCount,
      totalClips: this.queueItems.length,
      skippedClips: this.skippedCount,
      unstartedCount: unstartedCount > 0 ? unstartedCount : undefined,
      errorCount,
      totalTimeMs,
      batchesCompleted: this.currentBatchIndex - 1,
      stoppedByUser: true,
    } as any;

    this.callbacks.onFinished(summary);
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isStopped = false;
    this.isPaused = false;
    this.isQuotaStopped = false;
    this.startTime = performance.now();

    await this.requestWakeLock();
    this.notifyOverallImmediate();

    const waitingOrRunning = Array.from(this.itemsProgress.values()).some(
      (it) => it.stage === 'waiting'
    );
    if (!waitingOrRunning) {
      this.checkAllCompleted();
      return;
    }

    this.pumpGenerators();
  }

  private async requestWakeLock(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // bỏ qua
    }
  }

  private releaseWakeLock(): void {
    try {
      if (this.wakeLockSentinel) {
        this.wakeLockSentinel.release();
        this.wakeLockSentinel = null;
      }
    } catch {
      // bỏ qua
    }
  }

  private scheduleBatchedUpdate(id: string): void {
    const item = this.itemsProgress.get(id);
    if (item) {
      this.pendingItemUpdates.set(id, { ...item });
    }

    if (!this.isBatchUpdateScheduled) {
      this.isBatchUpdateScheduled = true;
      setTimeout(() => {
        this.flushBatchedUpdates();
      }, 250);
    }
  }

  private flushBatchedUpdates(): void {
    this.isBatchUpdateScheduled = false;
    if (this.pendingItemUpdates.size > 0) {
      this.pendingItemUpdates.forEach((updatedItem) => {
        this.callbacks.onItemUpdate(updatedItem);
      });
      this.pendingItemUpdates.clear();
      this.callbacks.onSyncBackToState([...this.queueItems], this.successImagesThisTurn);
    }
    this.notifyOverallThrottled();
  }

  public getMemoryStats(): MemoryStats {
    const activeBlobsCount = this.activeObjectUrls.size;
    const estimatedMemoryMB = Math.round((activeBlobsCount * 12) + (this.queueItems.length - this.releasedItemsCount) * 1.5);
    return {
      activeBlobsCount,
      estimatedMemoryMB,
      releasedCount: this.releasedItemsCount,
    };
  }

  private notifyOverallThrottled(): void {
    const now = Date.now();
    if (now - this.lastOverallUpdateTime >= 250) {
      this.notifyOverallImmediate();
    }
  }

  private notifyOverallImmediate(): void {
    this.lastOverallUpdateTime = Date.now();
    this.callbacks.onOverallUpdate({
      genDone: this.genDoneCount,
      effectDone: this.effectDoneCount,
      layerDone: this.layerDoneCount,
      renderDone: this.renderDoneCount,
      downloadDone: this.downloadDoneCount,
      total: this.queueItems.length,
      memoryStats: this.getMemoryStats(),
    });
  }

  private pushRecentMetric(arr: number[], valueSec: number): void {
    arr.push(valueSec);
    if (arr.length > 10) arr.shift();
  }

  public getLiveRunEstimate(): StageBreakdownEstimate {
    const remaining = this.queueItems.length - (this.downloadDoneCount + this.skippedCount);
    if (remaining <= 0) {
      return estimateRun(this.config.mode, 0, this.config);
    }

    if (this.completionTimestamps.length >= 5) {
      const recent = this.completionTimestamps.slice(-10);
      const diffsSec: number[] = [];
      for (let i = 1; i < recent.length; i++) {
        const d = (recent[i] - recent[i - 1]) / 1000;
        if (d > 0 && d < 600) {
          diffsSec.push(d);
        }
      }

      if (diffsSec.length >= 4) {
        const avgIntervalSec = diffsSec.reduce((a, b) => a + b, 0) / diffsSec.length;
        const totalRemainingSec = Math.round(remaining * avgIntervalSec);
        const { timeStr, isTomorrow } = formatFinishTime(totalRemainingSec);
        const durationFormatted = formatDurationHuman(totalRemainingSec);

        const baseEst = estimateRun(this.config.mode, remaining, this.config);
        return {
          ...baseEst,
          totalSec: totalRemainingSec,
          finishTimeFormatted: timeStr,
          isTomorrow,
          durationFormatted,
          bottleneckSecPerItem: Math.round(avgIntervalSec * 10) / 10,
        };
      }
    }

    return estimateRun(this.config.mode, Math.max(0, remaining), this.config);
  }

  public getEstimatedRemainingSec(): number {
    return this.getLiveRunEstimate().totalSec;
  }

  public flushPartialBatch(): void {
    if (this.itemsInCurrentBatch.length === 0) return;

    const batchNumStr = String(this.currentBatchIndex).padStart(2, '0');
    const safeProject = slugify(this.config.projectName || 'effect-image', 30);
    const batchFilename = `${safeProject}_manifest_lo${batchNumStr}.json`;

    const batchManifestContent = {
      projectName: this.config.projectName,
      mode: this.config.mode,
      batchIndex: this.currentBatchIndex,
      batchSize: this.batchSize,
      itemCount: this.itemsInCurrentBatch.length,
      isPartial: true,
      exportedAt: new Date().toISOString(),
      clips: this.itemsInCurrentBatch,
    };

    downloadJsonFile(batchFilename, batchManifestContent);
    this.currentBatchIndex++;
    this.itemsInCurrentBatch = [];
  }

  private recordItemFailed(isSafety = false): void {
    if (isSafety) return;

    this.consecutiveFailedItems++;

    if (this.consecutiveFailedItems >= 3 && this.config.autoFallbackModel !== false) {
      const nextModel = getNextFallbackModel(this.currentActiveModel);
      if (nextModel !== this.currentActiveModel) {
        this.currentActiveModel = nextModel;
        if (this.callbacks.onGlobalError) {
          this.callbacks.onGlobalError(
            `Đã gặp 3 mục lỗi liên tiếp. Tự động chuyển model sang ${nextModel} cho các mục tiếp theo!`
          );
        }
      }
    }

    if (this.consecutiveFailedItems >= 5) {
      this.handleFiveConsecutiveErrors();
    }
  }

  private handleFiveConsecutiveErrors(): void {
    if (this.isCoolingDown) return;

    this.cooldownRounds++;
    if (this.cooldownRounds > 5) {
      this.pause();
      if (this.callbacks.onAutoPausedForConsecutiveErrors) {
        this.callbacks.onAutoPausedForConsecutiveErrors(
          'Đã thử tự phục hồi 5 vòng nhưng dịch vụ vẫn gặp sự cố liên tục. Vui lòng kiểm tra lại kết nối hoặc tài khoản Flow.'
        );
      }
      return;
    }

    this.flushPartialBatch();

    this.isCoolingDown = true;
    const deadline = Date.now() + 180000;
    let remainingSec = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

    const round = this.cooldownRounds;
    const formatCooldown = (s: number) => {
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return `Tự nghỉ, thử lại sau ${m}:${rem < 10 ? '0' : ''}${rem} (vòng ${round}/5)`;
    };

    if (this.callbacks.onCooldownStatus) {
      this.callbacks.onCooldownStatus(formatCooldown(remainingSec));
    }

    this.cooldownTimer = setInterval(() => {
      remainingSec = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (this.callbacks.onCooldownStatus) {
        this.callbacks.onCooldownStatus(formatCooldown(remainingSec));
      }

      if (Date.now() >= deadline) {
        clearInterval(this.cooldownTimer);
        this.cooldownTimer = null;
        this.isCoolingDown = false;
        if (this.callbacks.onCooldownStatus) {
          this.callbacks.onCooldownStatus(null);
        }

        this.autoRetryRecentFailedItems();
      }
    }, 1000);
  }

  /**
   * Sửa autoRetryRecentFailedItems (Đợt 7B):
   * Mục đã có ảnh (q.variants.length > 0) thì chuyển sang 'directing'
   * và đẩy vào effectQueue.
   */
  private autoRetryRecentFailedItems(): void {
    this.consecutiveFailedItems = 0;
    this.queueItems.forEach((q) => {
      const p = this.itemsProgress.get(q.id);
      if (p && (p.stage === 'error' || p.stage === 'not_started')) {
        p.error = undefined;
        p.errorStage = undefined;
        if (q.variants.length > 0) {
          p.stage = 'directing';
          this.scheduleBatchedUpdate(q.id);
          this.enqueueEffect(q.id);
        } else {
          p.stage = 'waiting';
          this.scheduleBatchedUpdate(q.id);
        }
      }
    });

    this.pumpGenerators();
  }

  private recordOverloadRateLimit(): void {
    const now = Date.now();
    this.rateLimitTimestamps.push(now);
    this.rateLimitTimestamps = this.rateLimitTimestamps.filter((t) => now - t <= 120000);

    if (this.rateLimitTimestamps.length >= 3 && this.effectiveConcurrency > 1) {
      this.effectiveConcurrency = 1;
      this.lastThrottleDownTime = now;
      if (this.callbacks.onGlobalError) {
        this.callbacks.onGlobalError('Phát hiện quá tải/rate limit liên tiếp. Tự động giảm xuống 1 luồng sinh ảnh để đảm bảo an toàn.');
      }
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailedItems = 0;
    const now = Date.now();
    if (this.effectiveConcurrency < this.config.concurrency && this.lastThrottleDownTime > 0) {
      if (now - this.lastThrottleDownTime >= 300000) {
        this.effectiveConcurrency = this.config.concurrency;
        this.lastThrottleDownTime = 0;
        this.rateLimitTimestamps = [];
      }
    }
  }

  private releaseItemMemory(qItem: QueueItem, progress: AutoPilotItemProgress): void {
    if (progress.renderedBlobUrl) {
      URL.revokeObjectURL(progress.renderedBlobUrl);
      this.activeObjectUrls.delete(progress.renderedBlobUrl);
      progress.renderedBlobUrl = undefined;
    }

    if (this.config.mergeClips) {
      progress.stage = 'released';
      this.scheduleBatchedUpdate(qItem.id);
      return;
    }

    if (progress.blobUrl) {
      URL.revokeObjectURL(progress.blobUrl);
      this.activeObjectUrls.delete(progress.blobUrl);
      progress.blobUrl = undefined;
    }

    if (qItem.variants.length > 0) {
      const v = qItem.variants[0];
      if (v.mediaId) {
        invalidateLayerCache(v.mediaId);
      }
      if (v.blobUrl) {
        URL.revokeObjectURL(v.blobUrl);
        this.activeObjectUrls.delete(v.blobUrl);
        v.blobUrl = '';
      }
      v.isMemoryReleased = true;
    }

    if (qItem.parallaxLayers) {
      if (qItem.parallaxLayers.bgBlobUrl) {
        URL.revokeObjectURL(qItem.parallaxLayers.bgBlobUrl);
        this.activeObjectUrls.delete(qItem.parallaxLayers.bgBlobUrl);
        qItem.parallaxLayers.bgBlobUrl = undefined;
        qItem.parallaxLayers.bgBlob = undefined;
      }
      if (qItem.parallaxLayers.subjectCutoutBlobUrl) {
        URL.revokeObjectURL(qItem.parallaxLayers.subjectCutoutBlobUrl);
        this.activeObjectUrls.delete(qItem.parallaxLayers.subjectCutoutBlobUrl);
        qItem.parallaxLayers.subjectCutoutBlobUrl = undefined;
        qItem.parallaxLayers.subjectCutoutBlob = undefined;
      }
    }

    this.finalImageRawBytes.delete(qItem.id);
    qItem.isMemoryReleased = true;
    progress.isMemoryReleased = true;
    progress.stage = 'released';
    this.releasedItemsCount++;
    this.scheduleBatchedUpdate(qItem.id);
  }

  private releaseAllRetainedAssets(): void {
    this.queueItems.forEach((qItem) => {
      const progress = this.itemsProgress.get(qItem.id);
      if (progress) {
        if (progress.blobUrl) {
          URL.revokeObjectURL(progress.blobUrl);
          this.activeObjectUrls.delete(progress.blobUrl);
          progress.blobUrl = undefined;
        }
      }
      if (qItem.variants.length > 0) {
        const v = qItem.variants[0];
        if (v.mediaId) invalidateLayerCache(v.mediaId);
        if (v.blobUrl) {
          URL.revokeObjectURL(v.blobUrl);
          this.activeObjectUrls.delete(v.blobUrl);
          v.blobUrl = '';
        }
        v.isMemoryReleased = true;
      }
      if (qItem.parallaxLayers) {
        if (qItem.parallaxLayers.bgBlobUrl) {
          URL.revokeObjectURL(qItem.parallaxLayers.bgBlobUrl);
          this.activeObjectUrls.delete(qItem.parallaxLayers.bgBlobUrl);
          qItem.parallaxLayers.bgBlobUrl = undefined;
        }
        if (qItem.parallaxLayers.subjectCutoutBlobUrl) {
          URL.revokeObjectURL(qItem.parallaxLayers.subjectCutoutBlobUrl);
          this.activeObjectUrls.delete(qItem.parallaxLayers.subjectCutoutBlobUrl);
          qItem.parallaxLayers.subjectCutoutBlobUrl = undefined;
        }
      }
      this.finalImageRawBytes.delete(qItem.id);
      qItem.isMemoryReleased = true;
      if (progress) {
        progress.isMemoryReleased = true;
        progress.stage = 'released';
      }
    });
    this.releasedItemsCount = this.queueItems.length;
  }

  private checkBatchCompletion(manifestItem: ExportManifestItem): void {
    this.itemsInCurrentBatch.push(manifestItem);
    this.completedManifestItems.push(manifestItem);

    if (this.isStopped) {
      this.flushPartialBatch();
      return;
    }

    if (this.itemsInCurrentBatch.length >= this.batchSize) {
      const batchNumStr = String(this.currentBatchIndex).padStart(2, '0');
      const safeProject = slugify(this.config.projectName || 'effect-image', 30);
      const batchFilename = `${safeProject}_manifest_lo${batchNumStr}.json`;

      const batchManifestContent = {
        projectName: this.config.projectName,
        mode: this.config.mode,
        batchIndex: this.currentBatchIndex,
        batchSize: this.batchSize,
        itemCount: this.itemsInCurrentBatch.length,
        exportedAt: new Date().toISOString(),
        clips: this.itemsInCurrentBatch,
      };

      downloadJsonFile(batchFilename, batchManifestContent);

      this.currentBatchIndex++;
      this.itemsInCurrentBatch = [];
    }
  }

  private checkAllCompleted(): void {
    const allFinished = Array.from(this.itemsProgress.values()).every(
      (it) => it.stage === 'downloaded' || it.stage === 'released' || it.stage === 'skipped' || it.stage === 'error' || it.stage === 'not_started'
    );

    if (allFinished && this.isRunning) {
      this.isRunning = false;
      this.finalizePipeline();
    }
  }

  // ==========================================
  // KHÂU 1: SINH ẢNH
  // ==========================================
  private activeGenCount = 0;

  private pumpGenerators(): void {
    if (this.isStopped || this.isPaused || this.isCoolingDown || this.isQuotaStopped) return;

    const concurrency = this.effectiveConcurrency;
    const waitingItems = this.queueItems.filter((q) => {
      const p = this.itemsProgress.get(q.id);
      return p && p.stage === 'waiting';
    });

    while (this.activeGenCount < concurrency && waitingItems.length > 0) {
      const itemToGen = waitingItems.shift()!;
      this.activeGenCount++;
      this.runGenerateSingle(itemToGen.id).finally(() => {
        this.activeGenCount--;
        this.pumpGenerators();
      });
    }
  }

  private async runGenerateSingle(id: string): Promise<void> {
    const qItem = this.queueItems.find((q) => q.id === id);
    const progress = this.itemsProgress.get(id);
    if (!qItem || !progress || this.isStopped) return;

    progress.stage = 'generating';
    progress.stageStartTime = Date.now();
    this.scheduleBatchedUpdate(id);

    try {
      const stepStart = performance.now();
      let currentModel = this.currentActiveModel || this.config.modelName || '🍌 Nano Banana 2.1';
      const promptItem = qItem.promptItem;

      const effectiveSettings: any = {
        modelName: currentModel,
        defaultAspectRatio: promptItem.aspectRatio,
        variantsPerPrompt: 1,
        concurrency: 1,
        styleSuffix: this.config.styleSuffix || '',
        addNoWatermark: this.config.addNoWatermark !== undefined ? this.config.addNoWatermark : true,
        translateVietnamese: this.config.translateVietnamese !== undefined ? this.config.translateVietnamese : true,
        autoFallbackModel: true,
        autoQcInspection: this.config.autoQc,
      };

      const { finalPrompt: constructedPrompt, translatedPrompt } = await constructSentPrompt(
        promptItem.prompt,
        effectiveSettings,
        promptItem.negative
      );

      let finalPrompt = constructedPrompt;
      let attempt = 0;
      const maxRetries = 3;
      let success = false;
      let safetyRewritten = false;
      let originalPromptBeforeSafety: string | undefined = undefined;
      let safetyRounds = 0;

      while (attempt <= maxRetries && !success) {
        if (this.isStopped) return;
        while ((this.isPaused || this.isCoolingDown) && !this.isStopped) {
          await new Promise((r) => setTimeout(r, 400));
        }

        try {
          const genResult = await generateSingleImageWithTimeout(
            finalPrompt,
            currentModel,
            promptItem.aspectRatio,
            this.debugMode,
            this.mockErrorConfigRef
          );

          this.finalImageRawBytes.set(qItem.id, {
            base64: genResult.base64,
            mimeType: genResult.mimeType || 'image/jpeg',
          });

          const blobUrl = base64ToBlobUrl(genResult.base64, genResult.mimeType || 'image/jpeg');
          this.activeObjectUrls.add(blobUrl);
          const thumb = await createResizedThumbnail(genResult.base64, genResult.mimeType || 'image/jpeg', 512);

          const newVariant: GeneratedImageVariant = {
            id: `var_auto_${Date.now()}`,
            blobUrl,
            thumbnailUrl: thumb.dataUrl,
            mediaId: genResult.mediaId,
            modelUsed: currentModel,
            sentPrompt: finalPrompt,
            translatedPrompt,
            qcStatus: this.config.autoQc ? ('running' as const) : ('idle' as const),
            attemptCount: attempt + 1,
            createdAt: Date.now(),
          };

          qItem.variants = [newVariant];
          qItem.selectedVariantIndex = 0;
          qItem.status = 'done';
          qItem.sentPrompt = finalPrompt;
          qItem.translatedPrompt = translatedPrompt;
          qItem.safetyRewritten = safetyRewritten;
          qItem.originalPromptBeforeSafety = originalPromptBeforeSafety;

          progress.thumbnailUrl = thumb.dataUrl;
          progress.blobUrl = blobUrl;

          // Auto QC
          if (this.config.autoQc) {
            progress.stage = 'inspecting';
            this.scheduleBatchedUpdate(id);

            const qcStart = performance.now();
            try {
              const qcRes = await inspectImageQc(
                genResult.base64,
                genResult.mimeType || 'image/jpeg',
                finalPrompt
              );
              newVariant.qc = qcRes;
              newVariant.qcStatus = 'done';
              this.pushRecentMetric(this.recentQcTimes, (performance.now() - qcStart) / 1000);

              if ((qcRes.verdict === 'regenerate' || qcRes.matchesPrompt < 60) && !this.isStopped) {
                try {
                  const secondGen = await generateSingleImageWithTimeout(
                    finalPrompt,
                    currentModel,
                    promptItem.aspectRatio
                  );
                  const secondBlobUrl = base64ToBlobUrl(secondGen.base64, secondGen.mimeType || 'image/jpeg');
                  this.activeObjectUrls.add(secondBlobUrl);
                  const secondThumb = await createResizedThumbnail(secondGen.base64, secondGen.mimeType || 'image/jpeg', 512);
                  const secondQc = await inspectImageQc(secondGen.base64, secondGen.mimeType || 'image/jpeg', finalPrompt);

                  if (secondQc.matchesPrompt > qcRes.matchesPrompt) {
                    URL.revokeObjectURL(blobUrl);
                    this.activeObjectUrls.delete(blobUrl);

                    this.finalImageRawBytes.set(qItem.id, {
                      base64: secondGen.base64,
                      mimeType: secondGen.mimeType || 'image/jpeg',
                    });

                    qItem.variants[0] = {
                      ...newVariant,
                      blobUrl: secondBlobUrl,
                      thumbnailUrl: secondThumb.dataUrl,
                      mediaId: secondGen.mediaId,
                      qc: secondQc,
                    };
                    progress.thumbnailUrl = secondThumb.dataUrl;
                    progress.blobUrl = secondBlobUrl;
                  } else {
                    URL.revokeObjectURL(secondBlobUrl);
                  }
                } catch {
                  // bỏ qua
                }
              }
            } catch {
              newVariant.qcStatus = 'error';
            }
          }

          success = true;
          this.recordSuccess();
          this.genDoneCount++;
          this.successImagesThisTurn++;
          this.pushRecentMetric(this.recentGenTimes, (performance.now() - stepStart) / 1000);
          this.scheduleBatchedUpdate(id);

          if (this.config.mode === 'images_only') {
            await this.handleDirectImageDownload(qItem, progress);
            return;
          }

          this.enqueueEffect(id);
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          const isRateLimit = isTemporaryError(errMsg) && (errMsg.includes('rate limit') || errMsg.includes('busy') || errMsg.includes('quá tải'));
          const isSafety = isSafetyPolicyError(errMsg);

          if (isRateLimit) {
            this.recordOverloadRateLimit();
          }

          if (isPureQuotaExceededError(errMsg)) {
            this.isQuotaStopped = true;
            progress.stage = 'error';
            progress.error = errMsg;
            progress.errorStage = 'generating';
            qItem.status = 'error';
            qItem.error = errMsg;
            this.scheduleBatchedUpdate(id);

            const unstartedItems = this.queueItems.filter((q) => {
              const p = this.itemsProgress.get(q.id);
              return p && p.stage === 'waiting';
            });

            if (this.callbacks.onGlobalError) {
              this.callbacks.onGlobalError(
                `Đã vượt hạn mức (Quota exceeded). Đã ngừng sinh ảnh mới; các ảnh đã sinh sẽ tiếp tục dựng clip và lưu manifest (${unstartedItems.length} prompt chưa chạy).`
              );
            }

            unstartedItems.forEach((q) => {
              const p = this.itemsProgress.get(q.id);
              if (p) {
                p.stage = 'not_started';
                p.error = undefined;
                p.errorStage = undefined;
                this.scheduleBatchedUpdate(q.id);
              }
            });

            this.checkAllCompleted();
            return;
          }

          // Xử lý chặn an toàn (Safety Policy): hỗ trợ 2 vòng viết lại, không tính vào attempt lỗi tạm thời
          if (isSafety) {
            if (safetyRounds < 2) {
              safetyRounds++;
              if (!originalPromptBeforeSafety) {
                originalPromptBeforeSafety = finalPrompt;
              }

              if (this.callbacks.onGlobalError) {
                this.callbacks.onGlobalError(
                  `#${promptItem.order}: Bị chặn → AI đang chỉnh prompt (${safetyRounds}/2)`
                );
              }

              try {
                finalPrompt = await rewritePromptForSafety(finalPrompt, safetyRounds as 1 | 2);
                safetyRewritten = true;
                continue;
              } catch (rewriteErr) {
                console.warn('AI viết lại prompt lỗi:', rewriteErr);
              }
            }

            // Sau 2 lần viết lại vẫn bị chặn: lỗi cuối
            const finalSafetyError = 'Bị chặn vì chính sách sau 2 lần AI chỉnh prompt. Sửa prompt tay rồi tạo lại.';
            progress.stage = 'error';
            progress.error = finalSafetyError;
            progress.errorStage = 'generating';
            qItem.status = 'error';
            qItem.error = finalSafetyError;
            this.scheduleBatchedUpdate(id);
            this.checkAllCompleted();
            return;
          }

          // Lỗi tạm thời (dịch vụ, mạng, timeout)
          attempt++;

          if (isTemporaryError(errMsg) && attempt <= maxRetries) {
            const waitTime = attempt === 1 ? 4000 : attempt === 2 ? 10000 : 25000;
            await new Promise((r) => setTimeout(r, waitTime));
            continue;
          }

          if (attempt > maxRetries) {
            this.recordItemFailed(isSafety);
            progress.stage = 'error';
            progress.error = errMsg;
            progress.errorStage = 'generating';
            qItem.status = 'error';
            qItem.error = errMsg;
            this.scheduleBatchedUpdate(id);
            this.checkAllCompleted();
            return;
          }
        }
      }
    } catch (unhandledErr: any) {
      const msg = unhandledErr?.message || String(unhandledErr);
      progress.stage = 'error';
      progress.error = msg;
      progress.errorStage = 'generating';
      qItem.status = 'error';
      this.recordItemFailed(false);
      this.scheduleBatchedUpdate(id);
      this.checkAllCompleted();
    }
  }

  private async handleDirectImageDownload(
    qItem: QueueItem,
    progress: AutoPilotItemProgress
  ): Promise<void> {
    progress.stage = 'downloading';
    this.scheduleBatchedUpdate(qItem.id);

    const activeVar = qItem.variants[0];
    const rawData = this.finalImageRawBytes.get(qItem.id);

    if (!activeVar || !rawData) {
      progress.stage = 'error';
      progress.error = 'Không tìm thấy dữ liệu ảnh để tải';
      progress.errorStage = 'downloading';
      this.scheduleBatchedUpdate(qItem.id);
      this.checkAllCompleted();
      return;
    }

    const mimeType = rawData.mimeType || 'image/jpeg';
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';

    const filename = buildFilename(
      this.config.projectName,
      qItem.promptItem.order,
      qItem.promptItem.title,
      ext,
      qItem.promptItem.prompt,
      qItem.translatedPrompt,
      this.totalOriginalPromptsCount
    );
    progress.downloadedFilename = filename;

    const dims = await getImageDimensionsFromBase64(rawData.base64, mimeType);

    downloadQueue.enqueue({
      id: qItem.id,
      base64: rawData.base64,
      mimeType: mimeType as any,
      filename,
      onProgress: (dlStatus, dlErr) => {
        if (dlStatus === 'done') {
          progress.stage = 'downloaded';
          this.downloadDoneCount++;
          this.completionTimestamps.push(Date.now());

          const manifestItem: ExportManifestItem = {
            order: qItem.promptItem.order,
            promptKey: progress.promptKey,
            file: filename,
            stillFile: filename,
            title: qItem.promptItem.title,
            originalPrompt: qItem.promptItem.prompt,
            sentPrompt: qItem.sentPrompt || qItem.promptItem.prompt,
            model: activeVar.modelUsed || this.currentActiveModel,
            mediaId: activeVar.mediaId || '',
            aspectRatio: qItem.promptItem.aspectRatio,
            dimensions: dims,
            fps: 0,
            durationSec: 0,
            qc: activeVar.qc,
          };

          this.checkBatchCompletion(manifestItem);
          this.releaseItemMemory(qItem, progress);
          this.checkAllCompleted();
        } else if (dlStatus === 'error') {
          progress.stage = 'error';
          progress.error = dlErr || 'Lỗi tải ảnh';
          progress.errorStage = 'downloading';
          this.scheduleBatchedUpdate(qItem.id);
          this.checkAllCompleted();
        }
      },
    });
  }

  // ==========================================
  // KHÂU 2: AI CHỌN HIỆU ỨNG (ÁP DỤNG CHOOSEVARIEDMOVE)
  // ==========================================
  private enqueueEffect(id: string): void {
    this.effectQueue.push(id);
    this.processEffectQueue();
  }

  private async processEffectQueue(): Promise<void> {
    if (this.isEffectWorkerRunning || this.isStopped) return;
    this.isEffectWorkerRunning = true;

    try {
      while (this.effectQueue.length > 0) {
        if (this.isStopped) break;
        while ((this.isPaused || this.isCoolingDown) && !this.isStopped) {
          await new Promise((r) => setTimeout(r, 400));
        }

        const id = this.effectQueue.shift()!;
        try {
          await this.runEffectSingle(id);
        } catch (itemErr: any) {
          const p = this.itemsProgress.get(id);
          if (p) {
            p.stage = 'error';
            p.error = itemErr?.message || 'Lỗi chọn hiệu ứng';
            p.errorStage = 'directing';
            this.scheduleBatchedUpdate(id);
          }
          this.checkAllCompleted();
        }
      }
    } finally {
      this.isEffectWorkerRunning = false;
    }
  }

  private async runEffectSingle(id: string): Promise<void> {
    const qItem = this.queueItems.find((q) => q.id === id);
    const progress = this.itemsProgress.get(id);
    if (!qItem || !progress) return;

    progress.stage = 'directing';
    this.scheduleBatchedUpdate(id);

    const stepStart = performance.now();
    const variant = qItem.variants[0];
    const imageUrl = variant?.blobUrl || variant?.thumbnailUrl || '';
    const mode = this.config.mode;

    if (mode === 'camera_only') {
      try {
        const directResult = await directEffectsForImage(
          imageUrl,
          qItem.sentPrompt || qItem.promptItem.prompt
        );
        const updatedQ = applyAiDecisionToQueueItem(qItem, directResult);
        qItem.effectConfig = updatedQ.effectConfig;

        if (qItem.effectConfig) {
          qItem.effectConfig.overlays = [];
          qItem.effectConfig.parallax.enabled = false;
          qItem.effectConfig.fadeInOut = true;
        }
      } catch {
        const def = createDefaultEffectConfig();
        def.overlays = [];
        def.parallax.enabled = false;
        qItem.effectConfig = def;
      }
    } else {
      try {
        const directResult = await directEffectsForImage(
          imageUrl,
          qItem.sentPrompt || qItem.promptItem.prompt
        );
        const updatedQ = applyAiDecisionToQueueItem(qItem, directResult);
        qItem.effectConfig = updatedQ.effectConfig;

        if (mode === 'no_parallax' && qItem.effectConfig) {
          qItem.effectConfig.parallax.enabled = false;
        }
      } catch (err: any) {
        const def = createDefaultEffectConfig();
        if (mode === 'no_parallax') {
          def.parallax.enabled = false;
        }
        qItem.effectConfig = def;
      }
    }

    if (this.config.durationMode === 'fixed' && this.config.fixedDurationSec && qItem.effectConfig) {
      qItem.effectConfig.durationSec = this.config.fixedDurationSec;
    }

    // ĐA DẠNG MÁY QUAY: ÁP DỤNG chooseVariedMove
    if (qItem.effectConfig) {
      const curMove = qItem.effectConfig.camera.move;
      const isAiSource = qItem.effectConfig.source === 'ai';

      if (isAiSource) {
        const variedMove = chooseVariedMove(curMove, this.recentProcessedMoves);
        if (variedMove !== curMove) {
          qItem.effectConfig.camera.move = variedMove;
          if (variedMove === 'handheld' && qItem.effectConfig.camera.intensity > 0.5) {
            qItem.effectConfig.camera.intensity = 0.5;
          }
        }
      }

      this.recentProcessedMoves.push(qItem.effectConfig.camera.move);
      if (this.recentProcessedMoves.length > 6) {
        this.recentProcessedMoves.shift();
      }

      progress.cameraMove = qItem.effectConfig.camera.move;
      progress.aiReason = qItem.effectConfig.aiReason;
    }

    this.effectDoneCount++;
    this.pushRecentMetric(this.recentEffectTimes, (performance.now() - stepStart) / 1000);
    this.scheduleBatchedUpdate(id);

    const needsParallax =
      !this.isQuotaStopped &&
      mode === 'full' &&
      this.config.parallaxMode !== 'off' &&
      qItem.effectConfig?.parallax.enabled &&
      variant?.mediaId;

    if (needsParallax) {
      this.enqueueLayer(id);
    } else {
      this.enqueueRender(id);
    }
  }

  // ==========================================
  // KHÂU 3: TÁCH LỚP PARALLAX
  // ==========================================
  private enqueueLayer(id: string): void {
    this.layerQueue.push(id);
    this.pumpLayerWorkers();
  }

  private pumpLayerWorkers(): void {
    if (this.isStopped || this.isPaused || this.isCoolingDown) return;

    const maxLayerWorkers = 2;
    while (this.activeLayerCount < maxLayerWorkers && this.layerQueue.length > 0) {
      const id = this.layerQueue.shift()!;
      this.activeLayerCount++;
      this.runLayerSingle(id).finally(() => {
        this.activeLayerCount--;
        this.pumpLayerWorkers();
      });
    }
  }

  private async runLayerSingle(id: string): Promise<void> {
    const qItem = this.queueItems.find((q) => q.id === id);
    const progress = this.itemsProgress.get(id);
    if (!qItem || !progress || this.isStopped) return;

    progress.stage = 'separating';
    this.scheduleBatchedUpdate(id);

    try {
      const stepStart = performance.now();
      const variant = qItem.variants[0];

      try {
        const layerRes = await generateParallaxLayers({
          mediaId: variant.mediaId,
          modelName: variant.modelUsed || this.currentActiveModel || '🍌 Nano Banana 2.1',
          aspectRatio: qItem.promptItem.aspectRatio,
        });

        qItem.parallaxLayers = layerRes;

        if (layerRes.bgBlobUrl) this.activeObjectUrls.add(layerRes.bgBlobUrl);
        if (layerRes.subjectCutoutBlobUrl) this.activeObjectUrls.add(layerRes.subjectCutoutBlobUrl);

        if (layerRes.status === 'ready') {
          progress.parallaxReady = true;
          if (layerRes.subjectCenter && qItem.effectConfig) {
            qItem.effectConfig.camera.focus = layerRes.subjectCenter;
          }
        } else {
          progress.parallaxReady = false;
          if (qItem.effectConfig) {
            qItem.effectConfig.parallax.enabled = false;
          }
        }
      } catch {
        if (qItem.effectConfig) {
          qItem.effectConfig.parallax.enabled = false;
        }
        progress.parallaxReady = false;
      }

      this.layerDoneCount++;
      this.pushRecentMetric(this.recentLayerTimes, (performance.now() - stepStart) / 1000);
      this.scheduleBatchedUpdate(id);
      this.enqueueRender(id);
    } catch (unhandledErr: any) {
      progress.stage = 'error';
      progress.error = unhandledErr?.message || 'Lỗi tách lớp';
      progress.errorStage = 'separating';
      this.scheduleBatchedUpdate(id);
      this.checkAllCompleted();
    }
  }

  // ==========================================
  // KHÂU 4: DỰNG MP4
  // ==========================================
  private enqueueRender(id: string): void {
    this.renderQueue.push(id);
    this.processRenderQueue();
  }

  private async processRenderQueue(): Promise<void> {
    if (this.isRenderWorkerRunning || this.isStopped) return;
    this.isRenderWorkerRunning = true;

    try {
      while (this.renderQueue.length > 0) {
        if (this.isStopped) break;
        while ((this.isPaused || this.isCoolingDown) && !this.isStopped) {
          await new Promise((r) => setTimeout(r, 400));
        }

        const id = this.renderQueue.shift()!;
        try {
          await this.runRenderSingle(id);
        } catch (itemErr: any) {
          const p = this.itemsProgress.get(id);
          if (p) {
            p.stage = 'error';
            p.error = itemErr?.message || 'Lỗi dựng video';
            p.errorStage = 'rendering';
            this.scheduleBatchedUpdate(id);
          }
          this.checkAllCompleted();
        }
      }
    } finally {
      this.isRenderWorkerRunning = false;
    }
  }

  private async runRenderSingle(id: string): Promise<void> {
    const qItem = this.queueItems.find((q) => q.id === id);
    const progress = this.itemsProgress.get(id);
    if (!qItem || !progress) return;

    progress.stage = 'rendering';
    progress.stageProgressPercent = 0;
    this.scheduleBatchedUpdate(id);

    const stepStart = performance.now();
    const abortCtrl = new AbortController();

    try {
      const renderPromise = renderClipToMp4(
        qItem,
        {
          resolution: this.config.resolution,
          fps: this.config.fps,
        },
        (percent) => {
          progress.stageProgressPercent = percent;
          this.scheduleBatchedUpdate(id);
        },
        abortCtrl.signal
      );

      const renderRes = await withTimeout(renderPromise, 180000, `renderClipToMp4 (#${qItem.promptItem.order})`);

      const blobUrl = URL.createObjectURL(renderRes.blob);
      this.activeObjectUrls.add(blobUrl);

      progress.renderedBlobUrl = blobUrl;
      progress.sizeBytes = renderRes.sizeBytes;
      progress.renderTimeMs = renderRes.renderTimeMs;

      this.renderDoneCount++;
      this.pushRecentMetric(this.recentRenderTimes, (performance.now() - stepStart) / 1000);

      const ext = renderRes.mimeType === 'video/mp4' ? 'mp4' : 'webm';
      this.clipFormatMap[qItem.id] = ext;

      progress.stage = 'downloading';
      this.scheduleBatchedUpdate(id);

      const filename = buildFilename(
        this.config.projectName,
        qItem.promptItem.order,
        qItem.promptItem.title,
        ext,
        qItem.promptItem.prompt,
        qItem.translatedPrompt,
        this.totalOriginalPromptsCount
      );
      progress.downloadedFilename = filename;

      let stillFilename: string | undefined = undefined;
      const rawImg = this.finalImageRawBytes.get(qItem.id);
      if (this.config.downloadOriginalImages && rawImg) {
        const stillMime = rawImg.mimeType || 'image/jpeg';
        const stillExt = stillMime === 'image/png' ? 'png' : 'jpg';
        stillFilename = buildFilename(
          this.config.projectName,
          qItem.promptItem.order,
          qItem.promptItem.title,
          stillExt,
          qItem.promptItem.prompt,
          qItem.translatedPrompt,
          this.totalOriginalPromptsCount
        );

        downloadQueue.enqueue({
          id: `${qItem.id}_still`,
          base64: rawImg.base64,
          mimeType: stillMime as any,
          filename: stillFilename,
        });
      }

      downloadQueue.enqueue({
        id: qItem.id,
        base64: renderRes.base64,
        mimeType: renderRes.mimeType,
        filename,
        onProgress: (dlStatus, dlErr) => {
          if (dlStatus === 'done') {
            progress.stage = 'downloaded';
            this.downloadDoneCount++;
            this.completionTimestamps.push(Date.now());

            const manifestItem: ExportManifestItem = {
              order: qItem.promptItem.order,
              promptKey: progress.promptKey,
              file: filename,
              stillFile: stillFilename,
              title: qItem.promptItem.title,
              originalPrompt: qItem.promptItem.prompt,
              sentPrompt: qItem.sentPrompt || qItem.promptItem.prompt,
              model: qItem.variants[0]?.modelUsed || this.currentActiveModel,
              mediaId: qItem.variants[0]?.mediaId || '',
              aspectRatio: qItem.promptItem.aspectRatio,
              dimensions: { width: renderRes.width, height: renderRes.height },
              fps: this.config.fps,
              durationSec: renderRes.durationSec,
              effectConfig: qItem.effectConfig,
              qc: qItem.variants[0]?.qc,
              sizeBytes: renderRes.sizeBytes,
              renderTimeMs: renderRes.renderTimeMs,
            };

            this.checkBatchCompletion(manifestItem);
            this.releaseItemMemory(qItem, progress);
            this.checkAllCompleted();
          } else if (dlStatus === 'error') {
            progress.stage = 'error';
            progress.error = dlErr || 'Lỗi tải tệp';
            progress.errorStage = 'downloading';
            this.scheduleBatchedUpdate(qItem.id);
            this.checkAllCompleted();
          }
        },
      });
    } catch (err: any) {
      abortCtrl.abort();
      progress.stage = 'error';
      progress.error = err?.message || 'Lỗi dựng video';
      progress.errorStage = 'rendering';
      this.scheduleBatchedUpdate(id);
      this.checkAllCompleted();
    }
  }

  // ==========================================
  // KẾT THÚC TIẾN TRÌNH & GHÉP VIDEO & MANIFEST TỔNG
  // ==========================================
  private async finalizePipeline(): Promise<void> {
    const totalTimeMs = Math.round(performance.now() - this.startTime);
    this.releaseWakeLock();

    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    if (this.callbacks.onCooldownStatus) {
      this.callbacks.onCooldownStatus(null);
    }

    let mergedVideoDownloaded = false;
    let mergedVideoFilename: string | undefined = undefined;

    if (this.config.mergeClips && this.config.mode !== 'images_only' && !this.isStopped) {
      const successfulItems = this.queueItems
        .filter((q) => {
          const p = this.itemsProgress.get(q.id);
          return (p?.stage === 'downloaded' || p?.stage === 'released') && q.variants.length > 0;
        })
        .sort((a, b) => a.promptItem.order - b.promptItem.order);

      if (successfulItems.length >= 2) {
        const mergeAbortController = new AbortController();
        const mergeTimeoutMs = 120000 + successfulItems.length * 20000;

        try {
          if (this.callbacks.onCooldownStatus) {
            this.callbacks.onCooldownStatus(`Đang ghép ${successfulItems.length} clip thành 1 video...`);
          }

          const mergePromise = renderMergedVideo(
            successfulItems,
            {
              resolution: this.config.resolution,
              fps: this.config.fps,
            },
            (overallPct) => {
              if (this.callbacks.onCooldownStatus) {
                this.callbacks.onCooldownStatus(`Đang ghép 1 video: ${overallPct}%...`);
              }
            },
            mergeAbortController.signal
          );

          const mergedResult = await withTimeout(
            mergePromise,
            mergeTimeoutMs,
            `renderMergedVideo (${successfulItems.length} clips)`
          );

          const safeProject = slugify(this.config.projectName || 'effect-image', 30);
          mergedVideoFilename = `${safeProject}_ghep.mp4`;

          await downloadQueue.waitIdle();

          downloadQueue.enqueue({
            id: 'merged_video_output',
            base64: mergedResult.base64,
            mimeType: 'video/mp4',
            filename: mergedVideoFilename,
          });

          mergedVideoDownloaded = true;
        } catch (mergeErr: any) {
          mergeAbortController.abort();
          console.warn('Ghép video thành 1 file gặp lỗi:', mergeErr);
          if (this.callbacks.onGlobalError) {
            this.callbacks.onGlobalError(
              `Ghép 1 video không thành công (${mergeErr?.message || mergeErr}). Các clip lẻ vẫn an toàn!`
            );
          }
        } finally {
          if (this.callbacks.onCooldownStatus) {
            this.callbacks.onCooldownStatus(null);
          }
        }
      }
    }

    if (this.config.mergeClips) {
      this.releaseAllRetainedAssets();
    }

    this.flushPartialBatch();
    this.flushBatchedUpdates();

    // TÌM CÁC STT CHƯA XONG
    const completedOrdersSet = new Set<number>(this.completedManifestItems.map((c) => c.order));
    const notCompletedOrders: number[] = [];
    this.queueItems.forEach((q) => {
      const p = this.itemsProgress.get(q.id);
      if (p && p.stage !== 'skipped' && !completedOrdersSet.has(q.promptItem.order)) {
        notCompletedOrders.push(q.promptItem.order);
      }
    });
    notCompletedOrders.sort((a, b) => a - b);

    // Xuất manifest tổng
    if (this.config.downloadManifest && !this.isStopped) {
      try {
        const sortedCompletedClips = [...this.completedManifestItems].sort((a, b) => a.order - b.order);
        const lastBatchRecorded = Math.max(0, this.currentBatchIndex - 1);

        const manifestSummaryContent: any = {
          projectName: this.config.projectName,
          generatedAt: new Date().toISOString(),
          resolution: this.config.resolution,
          fps: this.config.fps,
          mode: this.config.mode,
          totalClips: sortedCompletedClips.length,
          skippedClips: this.skippedCount,
          lastBatchIndex: lastBatchRecorded,
          notCompletedOrders: notCompletedOrders,
          clips: sortedCompletedClips,
        };

        if (this.isQuotaStopped) {
          manifestSummaryContent.stoppedByQuota = true;
        }
        if (mergedVideoDownloaded && mergedVideoFilename) {
          manifestSummaryContent.mergedVideoFile = mergedVideoFilename;
        }

        const safeProject = slugify(this.config.projectName || 'effect-image', 30);
        downloadJsonFile(`${safeProject}_manifest.json`, manifestSummaryContent);
      } catch (manErr) {
        console.warn('Lỗi xuất manifest tổng:', manErr);
      }
    }

    const errorCount = Array.from(this.itemsProgress.values()).filter(
      (it) => it.stage === 'error'
    ).length;

    const unstartedCount = Array.from(this.itemsProgress.values()).filter(
      (it) => it.stage === 'not_started'
    ).length;

    const summary: AutoPilotSummary & { stoppedByQuota?: boolean; unstartedCount?: number } = {
      mode: this.config.mode,
      completedClips: this.downloadDoneCount,
      totalClips: this.queueItems.length,
      skippedClips: this.skippedCount,
      errorCount,
      totalTimeMs,
      batchesCompleted: this.currentBatchIndex - 1,
      mergedVideoDownloaded,
      stoppedByQuota: this.isQuotaStopped,
      unstartedCount: unstartedCount > 0 ? unstartedCount : (this.isQuotaStopped ? notCompletedOrders.length : undefined),
    } as any;

    this.callbacks.onFinished(summary);
  }

  public retryFailedStages(): void {
    const candidateItems = Array.from(this.itemsProgress.values()).filter(
      (it) => it.stage === 'error' || it.stage === 'not_started'
    );

    if (candidateItems.length === 0) return;

    this.isStopped = false;
    this.isPaused = false;
    this.isRunning = true;
    this.isQuotaStopped = false;
    this.consecutiveFailedItems = 0;
    this.cooldownRounds = 0;
    this.requestWakeLock();

    candidateItems.forEach((it) => {
      it.error = undefined;
      it.errorStage = undefined;
      const qItem = this.queueItems.find((q) => q.id === it.id);
      if (!qItem) return;

      qItem.error = undefined;
      qItem.status = 'pending';

      if (qItem.variants.length > 0) {
        it.stage = 'waiting';
        this.enqueueEffect(it.id);
      } else {
        it.stage = 'waiting';
      }
      this.scheduleBatchedUpdate(it.id);
    });

    this.pumpGenerators();
  }
}
