import React, { useState, useEffect, useRef } from 'react';
import type {
  QueueItem,
  GenerationSettings,
  GeneratedImageVariant,
  DebugSimulationMode,
  MockErrorConfig,
  AttemptRecord,
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
} from '../services/genQueue';
import { VirtualList } from './VirtualList';

interface Step2Props {
  queue: QueueItem[];
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  settings: GenerationSettings;
  setSettings: React.Dispatch<React.SetStateAction<GenerationSettings>>;
  todaySuccessCount: number;
  setTodaySuccessCount: React.Dispatch<React.SetStateAction<number>>;
  debugMode: DebugSimulationMode;
  mockErrorConfig: MockErrorConfig;
  setMockErrorConfig: React.Dispatch<React.SetStateAction<MockErrorConfig>>;
  onAddToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

// React.memo cho từng dòng hàng đợi Bước 2
const QueueItemRowMemo = React.memo<{
  item: QueueItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
}>(({ item, isSelected, onSelect }) => {
  const hasImage = item.variants.length > 0;
  const currentVar = item.variants[item.selectedVariantIndex] || item.variants[0];
  const isWaitingRetry = item.retryWaitUntil !== undefined && item.retryWaitUntil > Date.now();
  const remainingRetrySec = isWaitingRetry
    ? Math.max(1, Math.ceil((item.retryWaitUntil! - Date.now()) / 1000))
    : 0;

  return (
    <div
      onClick={() => onSelect(item.id)}
      className={`h-[84px] p-2 mx-1.5 my-1 rounded-lg cursor-pointer transition-all border flex gap-2.5 select-none ${
        isSelected
          ? 'bg-[#1c1c24] border-[#f5b301]/50 shadow-sm'
          : 'bg-[#141417] border-[#22222a] hover:bg-[#18181f]'
      }`}
    >
      <div className="w-16 h-16 bg-black rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center relative border border-[#2b2b35]">
        {hasImage && currentVar ? (
          <>
            <img
              src={currentVar.thumbnailUrl || currentVar.blobUrl}
              alt="Thumb"
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
            {item.safetyRewritten && (
              <span className="absolute bottom-0 inset-x-0 bg-amber-500/90 text-black text-[7px] font-bold text-center py-0.2 leading-tight">
                AI đã chỉnh prompt
              </span>
            )}
          </>
        ) : isWaitingRetry ? (
          <div className="flex flex-col items-center gap-0.5 p-1 text-center">
            <span className="material-symbols-outlined text-amber-400 text-[16px] animate-pulse">
              hourglass_empty
            </span>
            <span className="text-[9px] font-mono text-amber-300 font-bold leading-tight">
              Chờ {remainingRetrySec}s
            </span>
          </div>
        ) : item.status === 'generating' ? (
          <div className="flex flex-col items-center gap-1">
            <span className="w-4 h-4 border-2 border-[#f5b301] border-t-transparent rounded-full animate-spin" />
            <span className="text-[9px] font-mono text-zinc-400">Đang sinh...</span>
          </div>
        ) : item.status === 'qc' ? (
          <div className="flex flex-col items-center gap-1">
            <span className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[9px] font-mono text-sky-400">Đang soi...</span>
          </div>
        ) : item.status === 'modified_safety' ? (
          <div className="flex flex-col items-center gap-0.5 p-1 text-center">
            <span className="material-symbols-outlined text-amber-400 text-[16px] animate-spin">
              auto_fix_high
            </span>
            <span className="text-[8px] font-mono text-amber-300 leading-tight">
              Chỉnh an toàn
            </span>
          </div>
        ) : item.status === 'error' ? (
          <span className="material-symbols-outlined text-rose-400 text-[18px]">
            cancel
          </span>
        ) : (
          <span className="text-[10px] font-mono text-zinc-600">Chờ</span>
        )}

        {currentVar?.qc && (
          <span
            className={`absolute top-0.5 right-0.5 px-1 py-0.2 rounded text-[8px] font-bold font-mono ${
              currentVar.qc.matchesPrompt >= 80
                ? 'bg-emerald-500 text-black'
                : currentVar.qc.matchesPrompt >= 60
                ? 'bg-amber-500 text-black'
                : 'bg-rose-500 text-white'
            }`}
          >
            {currentVar.qc.matchesPrompt}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className="text-xs font-semibold text-zinc-200 truncate">
              #{item.promptItem.order}. {item.promptItem.title}
            </span>
            <span className="text-[10px] font-mono text-zinc-500">
              {item.promptItem.aspectRatio}
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 line-clamp-1 leading-relaxed">
            {item.promptItem.prompt}
          </p>
        </div>

        <div className="flex items-center justify-between gap-1 mt-1">
          <span className="text-[10px] font-mono">
            {isWaitingRetry ? (
              <span className="text-amber-400 font-semibold flex items-center gap-1 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Chờ thử lại {remainingRetrySec}s (lần {item.retryCount}/3)
              </span>
            ) : item.status === 'pending' ? (
              <span className="text-zinc-500">Chờ lượt</span>
            ) : item.status === 'generating' ? (
              <span className="text-[#f5b301] animate-pulse">Đang gọi model...</span>
            ) : item.status === 'qc' ? (
              <span className="text-sky-400">AI đang soi ảnh</span>
            ) : item.status === 'done' ? (
              <span className="text-emerald-400 flex items-center gap-1">
                Xong ✓
                {item.safetyRewritten && (
                  <span className="text-amber-300 text-[9px]">(AI đã chỉnh)</span>
                )}
              </span>
            ) : item.status === 'modified_safety' ? (
              <span className="text-amber-300 animate-pulse font-semibold">
                Bị chặn → AI đang chỉnh prompt
              </span>
            ) : item.status === 'error' ? (
              <span className="text-rose-400">Lỗi sinh ảnh</span>
            ) : null}
          </span>

          {item.variants.length > 1 && (
            <span className="text-[10px] font-mono px-1 rounded bg-[#2b2b35] text-zinc-300">
              {item.variants.length} bản
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

export const Step2ImageGen: React.FC<Step2Props> = ({
  queue,
  setQueue,
  settings,
  setSettings,
  todaySuccessCount,
  setTodaySuccessCount,
  debugMode,
  mockErrorConfig,
  setMockErrorConfig,
  onAddToast,
}) => {
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isStopped, setIsStopped] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const [, setClockTick] = useState<number>(0);
  useEffect(() => {
    const timer = setInterval(() => setClockTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const completionTimesRef = useRef<number[]>([]);
  const consecutiveFailuresRef = useRef<Record<string, number>>({});

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const isStoppedRef = useRef(isStopped);
  isStoppedRef.current = isStopped;

  const mockErrorConfigRef = useRef(mockErrorConfig);
  mockErrorConfigRef.current = mockErrorConfig;

  useEffect(() => {
    if (queue.length > 0 && !selectedQueueId) {
      setSelectedQueueId(queue[0].id);
    }
  }, [queue, selectedQueueId]);

  const updateQueueItem = (id: string, updater: (prev: QueueItem) => QueueItem) => {
    const updatedList = queueRef.current.map((item) => (item.id === id ? updater(item) : item));
    queueRef.current = updatedList;
    setQueue(updatedList);
  };

  const handleStartQueue = () => {
    if (isRunning) return;
    setIsStopped(false);
    setIsPaused(false);
    isStoppedRef.current = false;
    isPausedRef.current = false;
    setIsRunning(true);
    runWorkerPool();
  };

  const handlePauseResume = () => {
    setIsPaused((prev) => {
      const next = !prev;
      isPausedRef.current = next;
      if (!next && isRunning) {
        runWorkerPool();
      }
      return next;
    });
  };

  const handleStop = () => {
    setIsStopped(true);
    isStoppedRef.current = true;

    setQueue((prev) => {
      const reset = prev.map((q) => {
        if (q.retryWaitUntil && q.retryWaitUntil > Date.now()) {
          return {
            ...q,
            status: 'pending' as const,
            retryWaitUntil: undefined,
            retryTimer: undefined,
          };
        }
        return q;
      });
      queueRef.current = reset;
      return reset;
    });

    onAddToast('Đã dừng hàng đợi. Các mục đang chờ thử lại đã trở về trạng thái Chờ.', 'info');
  };

  const handleMockErrorConsumed = (remaining: number) => {
    setMockErrorConfig((prev) => ({
      ...prev,
      remainingCount: remaining,
      active: remaining > 0,
    }));
  };

  const processQueueItem = async (itemId: string): Promise<void> => {
    const item = queueRef.current.find((q) => q.id === itemId);
    if (!item) return;

    let currentModel = item.activeModel || settingsRef.current.modelName;
    const promptItem = item.promptItem;
    const startTime = performance.now();

    const { finalPrompt: constructedPrompt, translatedPrompt } = await constructSentPrompt(
      promptItem.prompt,
      settingsRef.current,
      promptItem.negative
    );

    let finalPrompt = constructedPrompt;
    let attempt = item.retryCount || 0;
    const maxRetries = 3;
    let success = false;
    let safetyRewritten = false;
    let originalPromptBeforeSafety: string | undefined = undefined;
    let safetyRounds = 0;

    while (attempt <= maxRetries && !success) {
      if (isStoppedRef.current) {
        updateQueueItem(itemId, (prev) => ({
          ...prev,
          status: 'pending',
          retryWaitUntil: undefined,
          retryTimer: undefined,
        }));
        return;
      }

      try {
        const genResult = await generateSingleImageWithTimeout(
          finalPrompt,
          currentModel,
          promptItem.aspectRatio,
          debugMode,
          mockErrorConfigRef,
          handleMockErrorConsumed
        );

        const blobUrl = base64ToBlobUrl(genResult.base64, genResult.mimeType || 'image/jpeg');
        const thumb = await createResizedThumbnail(genResult.base64, genResult.mimeType || 'image/jpeg', 512);

        const newVariant: GeneratedImageVariant = {
          id: `var_${Date.now()}`,
          blobUrl,
          thumbnailUrl: thumb.dataUrl,
          mediaId: genResult.mediaId,
          modelUsed: currentModel,
          sentPrompt: finalPrompt,
          translatedPrompt,
          qcStatus: settingsRef.current.autoQcInspection ? 'running' : 'idle',
          attemptCount: attempt + 1,
          createdAt: Date.now(),
        };

        updateQueueItem(itemId, (prev) => ({
          ...prev,
          status: settingsRef.current.autoQcInspection ? 'qc' : 'done',
          variants: [...prev.variants, newVariant],
          sentPrompt: finalPrompt,
          translatedPrompt,
          safetyRewritten,
          originalPromptBeforeSafety,
          completedAt: Date.now(),
          retryWaitUntil: undefined,
          retryTimer: undefined,
          error: undefined,
        }));

        setTodaySuccessCount((c) => c + 1);
        consecutiveFailuresRef.current[currentModel] = 0;
        completionTimesRef.current.push(performance.now() - startTime);
        success = true;

        if (settingsRef.current.autoQcInspection) {
          inspectAndHandleQc(itemId, newVariant, genResult.base64, genResult.mimeType || 'image/jpeg', finalPrompt);
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        const newRecord: AttemptRecord = { at: Date.now(), message: errMsg };

        if (isPureQuotaExceededError(errMsg)) {
          setIsStopped(true);
          isStoppedRef.current = true;
          setIsRunning(false);

          updateQueueItem(itemId, (prev) => ({
            ...prev,
            status: 'error',
            error: errMsg,
            retryCount: attempt,
            retryWaitUntil: undefined,
            retryTimer: undefined,
            attempts: [...(prev.attempts || []), newRecord],
          }));

          onAddToast(
            `HÀNG ĐỢI ĐÃ DỪNG: Đã vượt quá hạn mức sử dụng (Quota exceeded). Vui lòng thử lại sau!`,
            'error'
          );
          return;
        }

        // Xử lý chặn an toàn (Safety Policy): thử tối đa 2 lần viết lại, không tính vào attempt lỗi tạm thời
        if (isSafetyPolicyError(errMsg)) {
          if (safetyRounds < 2) {
            safetyRounds++;
            const roundLabel = `${safetyRounds}/2`;
            onAddToast(`Bị chặn → AI đang chỉnh prompt (${roundLabel}) cho #${promptItem.order}...`, 'warning');

            if (!originalPromptBeforeSafety) {
              originalPromptBeforeSafety = finalPrompt;
            }

            updateQueueItem(itemId, (prev) => ({
              ...prev,
              status: 'modified_safety',
              attempts: [...(prev.attempts || []), newRecord],
            }));

            try {
              finalPrompt = await rewritePromptForSafety(finalPrompt, safetyRounds as 1 | 2);
              safetyRewritten = true;
              updateQueueItem(itemId, (prev) => ({
                ...prev,
                status: 'generating',
                sentPrompt: finalPrompt,
                translatedPrompt,
                safetyRewritten: true,
                originalPromptBeforeSafety,
              }));
              continue;
            } catch (rewriteErr) {
              console.warn('AI viết lại prompt lỗi:', rewriteErr);
            }
          }

          // Đã thử 2 lần viết lại vẫn bị chặn: dừng với lỗi cuối
          const finalSafetyError = 'Bị chặn vì chính sách sau 2 lần AI chỉnh prompt. Sửa prompt tay rồi tạo lại.';
          updateQueueItem(itemId, (prev) => ({
            ...prev,
            status: 'error',
            error: finalSafetyError,
            attempts: [...(prev.attempts || []), { at: Date.now(), message: finalSafetyError }],
          }));
          onAddToast(`#${promptItem.order}: ${finalSafetyError}`, 'error');
          return;
        }

        // Lỗi tạm thời (dịch vụ, mạng, busy, quota per minute)
        attempt++;

        if (isTemporaryError(errMsg) && attempt <= maxRetries) {
          const delays = [5000, 15000, 40000];
          const delayBase = delays[attempt - 1] || 40000;
          const jitter = Math.random() * 2000;
          const waitTime = Math.round(delayBase + jitter);
          const waitUntil = Date.now() + waitTime;

          onAddToast(
            `#${promptItem.order}: Quá tải/gián đoạn. Chờ ${Math.round(waitTime / 1000)}s rồi thử lại lần ${attempt}/${maxRetries}...`,
            'info'
          );

          updateQueueItem(itemId, (prev) => ({
            ...prev,
            retryCount: attempt,
            retryTimer: waitTime,
            retryWaitUntil: waitUntil,
            error: errMsg,
            attempts: [...(prev.attempts || []), newRecord],
          }));

          const checkInterval = 250;
          let remainingWait = waitTime;
          while (remainingWait > 0) {
            if (isStoppedRef.current) {
              updateQueueItem(itemId, (prev) => ({
                ...prev,
                status: 'pending',
                retryWaitUntil: undefined,
                retryTimer: undefined,
              }));
              return;
            }
            await new Promise((r) => setTimeout(r, Math.min(checkInterval, remainingWait)));
            remainingWait -= checkInterval;
          }

          updateQueueItem(itemId, (prev) => ({
            ...prev,
            retryWaitUntil: undefined,
            retryTimer: undefined,
          }));

          continue;
        }

        consecutiveFailuresRef.current[currentModel] = (consecutiveFailuresRef.current[currentModel] || 0) + 1;

        if (
          settingsRef.current.autoFallbackModel &&
          consecutiveFailuresRef.current[currentModel] >= 3 &&
          !isSafetyPolicyError(errMsg)
        ) {
          const nextModel = getNextFallbackModel(currentModel);
          onAddToast(
            `Model ${currentModel} gặp 3 lỗi liên tiếp. Tự động chuyển các ảnh tiếp theo sang ${nextModel}!`,
            'warning'
          );
          currentModel = nextModel;
          consecutiveFailuresRef.current[nextModel] = 0;
        }

        if (attempt > maxRetries) {
          updateQueueItem(itemId, (prev) => ({
            ...prev,
            status: 'error',
            error: errMsg,
            retryCount: attempt,
            retryWaitUntil: undefined,
            retryTimer: undefined,
            attempts: [...(prev.attempts || []), newRecord],
          }));
          break;
        }
      }
    }
  };

  const inspectAndHandleQc = async (
    itemId: string,
    variant: GeneratedImageVariant,
    base64: string,
    mimeType: string,
    promptText: string
  ) => {
    try {
      const qcRes = await inspectImageQc(base64, mimeType, promptText);

      updateQueueItem(itemId, (prev) => {
        const updatedVars = prev.variants.map((v) =>
          v.id === variant.id ? { ...v, qc: qcRes, qcStatus: 'done' as const } : v
        );
        return { ...prev, status: 'done', variants: updatedVars };
      });

      const demandsText = /\b(text|word|logo|caption|chữ)\b/i.test(promptText);
      const shouldRegen =
        (qcRes.verdict === 'regenerate' ||
          (qcRes.hasUnwantedText && !demandsText) ||
          qcRes.matchesPrompt < 60) &&
        !variant.qcRetried;

      if (shouldRegen && !isStoppedRef.current) {
        onAddToast(
          `Ảnh #${queueRef.current.find((q) => q.id === itemId)?.promptItem.order} có điểm QC thấp (${qcRes.matchesPrompt}%). Tự động sinh thêm 1 biến thể so sánh...`,
          'info'
        );

        const secondGen = await generateSingleImageWithTimeout(
          promptText,
          variant.modelUsed,
          queueRef.current.find((q) => q.id === itemId)?.promptItem.aspectRatio || '16:9'
        );

        const secondBlobUrl = base64ToBlobUrl(secondGen.base64, secondGen.mimeType || 'image/jpeg');
        const secondThumb = await createResizedThumbnail(secondGen.base64, secondGen.mimeType || 'image/jpeg', 512);
        const secondQc = await inspectImageQc(secondGen.base64, secondGen.mimeType || 'image/jpeg', promptText);

        const secondVariant: GeneratedImageVariant = {
          id: `var_retry_${Date.now()}`,
          blobUrl: secondBlobUrl,
          thumbnailUrl: secondThumb.dataUrl,
          mediaId: secondGen.mediaId,
          modelUsed: variant.modelUsed,
          sentPrompt: promptText,
          translatedPrompt: variant.translatedPrompt,
          qc: secondQc,
          qcStatus: 'done',
          qcRetried: true,
          attemptCount: 1,
          createdAt: Date.now(),
        };

        updateQueueItem(itemId, (prev) => {
          const list = [...prev.variants, secondVariant];
          const bestIndex = secondQc.matchesPrompt > qcRes.matchesPrompt ? list.length - 1 : 0;
          return {
            ...prev,
            variants: list,
            selectedVariantIndex: bestIndex,
          };
        });
      }
    } catch (qcErr) {
      console.warn('AI QC Inspection failed:', qcErr);
      updateQueueItem(itemId, (prev) => {
        const updatedVars = prev.variants.map((v) =>
          v.id === variant.id ? { ...v, qcStatus: 'error' as const } : v
        );
        return { ...prev, status: 'done', variants: updatedVars };
      });
    }
  };

  const runWorkerPool = async () => {
    while (true) {
      if (isPausedRef.current) break;

      const activeItems = queueRef.current.filter(
        (item) => item.status === 'generating' || item.status === 'qc' || item.status === 'modified_safety'
      );

      if (isStoppedRef.current) {
        if (activeItems.length > 0) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        } else {
          setIsRunning(false);
          break;
        }
      }

      const pendingItems = queueRef.current.filter((item) => item.status === 'pending');

      if (pendingItems.length === 0) {
        if (activeItems.length > 0) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        setIsRunning(false);
        onAddToast('Hoàn tất tiến trình sinh ảnh!', 'success');
        break;
      }

      const activeGeneratingCount = queueRef.current.filter((item) => item.status === 'generating' || item.status === 'modified_safety').length;
      const availableSlots = Math.max(0, settingsRef.current.concurrency - activeGeneratingCount);

      if (availableSlots <= 0) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }

      const itemsToLaunch = pendingItems.slice(0, availableSlots);

      itemsToLaunch.forEach((it) => {
        updateQueueItem(it.id, (prev) => ({
          ...prev,
          status: 'generating',
          startedAt: Date.now(),
          error: undefined,
          retryWaitUntil: undefined,
        }));
      });

      itemsToLaunch.forEach((it) => {
        processQueueItem(it.id);
      });

      await new Promise((r) => setTimeout(r, 800));
    }
  };

  const handleRetryFailedItems = () => {
    setQueue((prev) => {
      const list = prev.map((item) =>
        item.status === 'error'
          ? {
              ...item,
              status: 'pending' as const,
              error: undefined,
              retryWaitUntil: undefined,
              retryTimer: undefined,
            }
          : item
      );
      queueRef.current = list;
      return list;
    });
    if (!isRunning) handleStartQueue();
  };

  const handleRetrySingleItem = (id: string) => {
    updateQueueItem(id, (prev) => ({
      ...prev,
      status: 'pending',
      error: undefined,
      retryWaitUntil: undefined,
      retryTimer: undefined,
    }));
    if (!isRunning) handleStartQueue();
  };

  const totalItems = queue.length;
  const completedItems = queue.filter((item) => item.status === 'done').length;
  const failedItems = queue.filter((item) => item.status === 'error').length;
  const remainingCount = totalItems - completedItems - failedItems;

  const avgDurationMs =
    completionTimesRef.current.length > 0
      ? completionTimesRef.current.reduce((a, b) => a + b, 0) / completionTimesRef.current.length
      : 15000;
  const estRemainingMinutes = Math.max(
    0,
    Math.round(((remainingCount * avgDurationMs) / (settings.concurrency * 60000)) * 10) / 10
  );

  const selectedItem = queue.find((q) => q.id === selectedQueueId) || null;
  const activeVariant =
    selectedItem && selectedItem.variants.length > 0
      ? selectedItem.variants[selectedItem.selectedVariantIndex] || selectedItem.variants[0]
      : null;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0b0d] text-zinc-200 overflow-hidden">
      {/* 1. THANH CÀI ĐẶT & ĐIỀU KHIỂN BƯỚC 2 */}
      <div className="p-3 border-b border-[#26262b] bg-[#141417] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <div className="flex items-center gap-1.5 bg-[#18181f] px-2.5 py-1 rounded-lg border border-[#26262b]">
              <span className="text-[11px] text-zinc-400">Model:</span>
              <select
                value={settings.modelName}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, modelName: e.target.value as any }))
                }
                className="bg-transparent text-xs font-semibold text-[#f5b301] focus:outline-none"
              >
                <option value="🍌 Nano Banana 2.1">🍌 Nano Banana 2.1 (Cân bằng, khuyên dùng)</option>
                <option value="🍌 Nano Banana Pro">🍌 Nano Banana Pro (Chi tiết cao, chậm hơn)</option>
                <option value="🍌 Nano Banana 2 Lite">🍌 Nano Banana 2 Lite (Nhanh nhất)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 bg-[#18181f] px-2.5 py-1 rounded-lg border border-[#26262b]">
              <span className="text-[11px] text-zinc-400">Luồng song song:</span>
              <select
                value={settings.concurrency}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, concurrency: parseInt(e.target.value, 10) }))
                }
                className="bg-transparent text-xs font-semibold text-zinc-200 focus:outline-none font-mono"
              >
                <option value={1}>1 luồng (tuần tự)</option>
                <option value={2}>2 luồng (khuyên dùng)</option>
                <option value={3}>3 luồng (tối đa)</option>
              </select>
            </div>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer text-zinc-300">
              <input
                type="checkbox"
                checked={settings.autoFallbackModel}
                onChange={(e) => setSettings((s) => ({ ...s, autoFallbackModel: e.target.checked }))}
                className="accent-[#f5b301] w-3.5 h-3.5"
              />
              <span>Tự đổi model dự phòng</span>
            </label>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer text-zinc-300">
              <input
                type="checkbox"
                checked={settings.autoQcInspection}
                onChange={(e) => setSettings((s) => ({ ...s, autoQcInspection: e.target.checked }))}
                className="accent-[#f5b301] w-3.5 h-3.5"
              />
              <span>AI Soi ảnh (0 credit)</span>
            </label>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer text-zinc-300">
              <input
                type="checkbox"
                checked={settings.addNoWatermark}
                onChange={(e) => setSettings((s) => ({ ...s, addNoWatermark: e.target.checked }))}
                className="accent-[#f5b301] w-3.5 h-3.5"
              />
              <span>Thêm "no watermark"</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            {failedItems > 0 && (
              <button
                type="button"
                onClick={handleRetryFailedItems}
                className="px-2.5 py-1.5 bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20 text-xs font-medium rounded-lg flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[15px]">replay</span>
                <span>Sinh lại {failedItems} ảnh lỗi</span>
              </button>
            )}

            {!isRunning ? (
              <button
                type="button"
                onClick={handleStartQueue}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#f5b301] text-black font-semibold text-xs rounded-lg hover:bg-[#ffbe1a] transition-all active:scale-95 shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                <span>Bắt đầu sinh ảnh</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handlePauseResume}
                  className="px-3 py-1.5 bg-[#1e1e24] hover:bg-[#282830] text-zinc-200 border border-[#2d2d35] text-xs font-medium rounded-lg flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {isPaused ? 'play_arrow' : 'pause'}
                  </span>
                  <span>{isPaused ? 'Tiếp tục' : 'Tạm dừng'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleStop}
                  className="px-3 py-1.5 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30 text-xs font-medium rounded-lg flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[15px]">stop</span>
                  <span>Dừng hàng đợi</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1 border-t border-[#26262b]/60">
          <span className="text-[11px] text-zinc-400 whitespace-nowrap">Hậu tố phong cách:</span>
          <input
            type="text"
            placeholder="Ví dụ: 2D anime illustration, clean line art (nối vào cuối mọi prompt)"
            value={settings.styleSuffix}
            onChange={(e) => setSettings((s) => ({ ...s, styleSuffix: e.target.value }))}
            className="flex-1 px-2.5 py-1 text-xs bg-[#18181f] border border-[#26262b] rounded-md text-zinc-200 focus:outline-none focus:border-[#f5b301]"
          />
        </div>

        <div className="flex items-center justify-between text-xs font-mono text-zinc-400 pt-1">
          <div className="flex items-center gap-2">
            <span>
              Đã xong: <strong className="text-emerald-400">{completedItems}</strong>/{totalItems}
            </span>
            {failedItems > 0 && <span className="text-rose-400">• Lỗi: {failedItems}</span>}
            {isRunning && remainingCount > 0 && (
              <span>• Ước tính còn ~{estRemainingMinutes} phút</span>
            )}
          </div>

          <div className="w-48 bg-[#1f1f26] h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-[#f5b301] h-full transition-all duration-300"
              style={{
                width: `${totalItems > 0 ? (completedItems / totalItems) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* 2. VÙNG CHÍNH 2 KHUNG CUỘN ĐỘC LẬP - BƯỚC 2 VIRTUALLIST */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* KHUNG TRÁI: VIRTUALLIST THUMBNAIL */}
        <div className="w-full md:w-[380px] md:min-w-[380px] border-r border-[#26262b] flex flex-col h-full bg-[#111114]">
          <div className="p-2.5 border-b border-[#26262b] bg-[#141417] text-xs font-semibold text-zinc-300 flex items-center justify-between">
            <span>Danh sách hàng đợi ({queue.length})</span>
            <span className="text-[11px] font-mono text-zinc-500">Mượt 300+ mục</span>
          </div>

          <div className="flex-1 overflow-hidden">
            <VirtualList<QueueItem>
              items={queue}
              itemHeight={88}
              className="h-full"
              buffer={10}
              renderItem={(item) => (
                <QueueItemRowMemo
                  item={item}
                  isSelected={item.id === selectedQueueId}
                  onSelect={setSelectedQueueId}
                />
              )}
            />
          </div>
        </div>

        {/* KHUNG PHẢI: XEM ẢNH LỚN + CHI TIẾT */}
        <div className="flex-1 flex flex-col h-full bg-[#0b0b0d] overflow-y-auto p-4 md:p-6">
          {selectedItem ? (
            <div className="max-w-4xl w-full mx-auto space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#26262b] pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-md bg-[#f5b301] text-black font-bold text-xs flex items-center justify-center">
                    #{selectedItem.promptItem.order}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      {selectedItem.promptItem.title}
                    </h3>
                    <div className="text-[11px] font-mono text-zinc-400 flex items-center gap-2">
                      <span>Tỷ lệ: {selectedItem.promptItem.aspectRatio}</span>
                      <span>•</span>
                      <span>Model dùng: <strong className="text-[#f5b301]">{activeVariant?.modelUsed || selectedItem.activeModel}</strong></span>
                      {selectedItem.safetyRewritten && (
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold text-[10px]">
                          AI đã chỉnh prompt
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRetrySingleItem(selectedItem.id)}
                    className="px-3 py-1.5 bg-[#1e1e24] hover:bg-[#282830] text-zinc-200 border border-[#2d2d35] rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[15px]">refresh</span>
                    <span>Sinh lại mục này</span>
                  </button>
                </div>
              </div>

              <div className="relative aspect-video max-w-2xl mx-auto bg-black rounded-lg overflow-hidden border border-[#26262b] shadow-xl flex items-center justify-center">
                {activeVariant ? (
                  <div className="relative w-full h-full">
                    <img
                      src={activeVariant.blobUrl}
                      alt="Ảnh sinh được"
                      className="w-full h-full object-contain"
                    />
                    {selectedItem.safetyRewritten && (
                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/75 backdrop-blur-xs text-[10px] font-mono text-amber-300 border border-amber-400/40 font-semibold flex items-center gap-1 shadow-md">
                        <span className="material-symbols-outlined text-[13px] text-amber-400">auto_fix_high</span>
                        AI đã chỉnh prompt
                      </span>
                    )}
                  </div>
                ) : selectedItem.retryWaitUntil && selectedItem.retryWaitUntil > Date.now() ? (
                  <div className="flex flex-col items-center gap-2 text-amber-300 text-xs p-4 text-center">
                    <span className="material-symbols-outlined text-[32px] text-amber-400 animate-pulse">
                      hourglass_bottom
                    </span>
                    <div className="font-semibold text-sm">
                      Đang chờ thử lại sau {Math.max(1, Math.ceil((selectedItem.retryWaitUntil - Date.now()) / 1000))}s
                    </div>
                    <p className="text-[11px] text-zinc-400 max-w-sm">
                      Lần thử {selectedItem.retryCount}/3 sau khi gặp lỗi mạng/dịch vụ tạm thời.
                    </p>
                  </div>
                ) : selectedItem.status === 'modified_safety' ? (
                  <div className="flex flex-col items-center gap-2 text-amber-300 text-xs p-4 text-center animate-pulse">
                    <span className="material-symbols-outlined text-[32px] text-amber-400 animate-spin">
                      auto_fix_high
                    </span>
                    <div className="font-semibold text-sm">
                      Bị chặn → AI đang chỉnh prompt an toàn...
                    </div>
                    <p className="text-[11px] text-zinc-400 max-w-sm">
                      Giữ nguyên bối cảnh, nhân vật và phong cách trong khi làm dịu các yếu tố nhạy cảm.
                    </p>
                  </div>
                ) : selectedItem.status === 'generating' ? (
                  <div className="flex flex-col items-center gap-2 text-zinc-400 text-xs">
                    <span className="w-8 h-8 border-3 border-[#f5b301] border-t-transparent rounded-full animate-spin" />
                    <span>Đang gọi model AI để sinh ảnh...</span>
                  </div>
                ) : selectedItem.status === 'error' ? (
                  <div className="p-6 text-center text-rose-400 text-xs max-w-md">
                    <span className="material-symbols-outlined text-[28px] mb-2">warning</span>
                    <p className="font-mono text-[11px] bg-black/60 p-3 rounded text-rose-300 leading-relaxed">
                      {selectedItem.error}
                    </p>
                  </div>
                ) : (
                  <span className="text-zinc-600 text-xs font-mono">Đang chờ khởi chạy</span>
                )}
              </div>

              {selectedItem.attempts && selectedItem.attempts.length > 0 && (
                <div className="p-3.5 rounded-lg bg-[#181822] border border-[#2d2d3d] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px]">history</span>
                      Lịch sử thử lại ({selectedItem.attempts.length} lần thử)
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400">
                      Số lần thử: <strong className="text-amber-400">{selectedItem.retryCount || selectedItem.attempts.length}</strong>
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {selectedItem.attempts.map((att, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded bg-black/40 border border-[#26262b] text-[11px] font-mono text-zinc-300 flex items-start justify-between gap-2"
                      >
                        <div className="flex items-start gap-1.5 flex-1 min-w-0">
                          <span className="text-rose-400 font-bold">#{idx + 1}:</span>
                          <span className="text-rose-300 break-words flex-1">{att.message}</span>
                        </div>
                        <span className="text-zinc-500 text-[10px] whitespace-nowrap">
                          {new Date(att.at).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedItem.variants.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto p-2 bg-[#141417] rounded-lg border border-[#26262b]">
                  <span className="text-xs text-zinc-400 whitespace-nowrap">Chọn biến thể chính:</span>
                  {selectedItem.variants.map((v, vIdx) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() =>
                        updateQueueItem(selectedItem.id, (prev) => ({
                          ...prev,
                          selectedVariantIndex: vIdx,
                        }))
                      }
                      className={`relative w-16 h-12 rounded overflow-hidden border transition-all ${
                        selectedItem.selectedVariantIndex === vIdx
                          ? 'border-[#f5b301] scale-105'
                          : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img src={v.thumbnailUrl || v.blobUrl} alt="Variant" className="w-full h-full object-cover" />
                      {v.qc && (
                        <span className="absolute bottom-0 right-0 px-1 text-[8px] font-bold bg-black/80 text-white">
                          {v.qc.matchesPrompt}%
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {activeVariant?.qc && (
                <div className="p-3.5 rounded-lg bg-[#141417] border border-[#26262b] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-sky-400 text-[18px]">
                        psychology
                      </span>
                      <span className="text-xs font-semibold text-zinc-200">
                        Kết quả AI Soi ảnh (Strict Quality Assurance):
                      </span>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                        activeVariant.qc.matchesPrompt >= 80
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : activeVariant.qc.matchesPrompt >= 60
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      Điểm: {activeVariant.qc.matchesPrompt}/100 • Verdict: {activeVariant.qc.verdict}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-300 leading-relaxed italic">
                    "{activeVariant.qc.note}"
                  </p>

                  <div className="flex flex-wrap gap-2 text-[11px] pt-1 border-t border-[#26262b]">
                    {activeVariant.qc.hasUnwantedText && (
                      <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                        ⚠ Có chữ rác
                      </span>
                    )}
                    {activeVariant.qc.artifacts?.map((art, aIdx) => (
                      <span
                        key={aIdx}
                        className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono"
                      >
                        {art}
                      </span>
                    ))}
                    {activeVariant.qc.artifacts?.length === 0 && !activeVariant.qc.hasUnwantedText && (
                      <span className="text-emerald-400 font-mono text-[11px]">
                        ✓ Không phát hiện dị tật nào
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="p-3.5 rounded-lg bg-[#141417] border border-[#26262b] space-y-3">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px] text-[#f5b301]">edit_note</span>
                      Prompt gốc:
                    </span>
                    {selectedItem.promptItem.hasVietnamese && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                        Tiếng Việt
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-zinc-300 bg-black/40 p-2.5 rounded border border-[#26262b] whitespace-pre-wrap leading-relaxed">
                    {selectedItem.promptItem.prompt}
                  </p>
                </div>

                {selectedItem.sentPrompt && selectedItem.sentPrompt !== selectedItem.promptItem.prompt && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px]">send</span>
                      Prompt thực tế đã gửi (Model AI):
                    </div>
                    <p className="text-xs font-mono text-amber-200/90 bg-amber-950/20 p-2.5 rounded border border-amber-800/30 whitespace-pre-wrap leading-relaxed">
                      {selectedItem.sentPrompt}
                    </p>
                  </div>
                )}

                {(selectedItem.translatedPrompt || activeVariant?.translatedPrompt) && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-sky-300 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px]">translate</span>
                      Bản dịch tiếng Anh (AI Gemini):
                    </div>
                    <p className="text-xs font-mono text-sky-200/90 bg-sky-950/20 p-2.5 rounded border border-sky-800/30 whitespace-pre-wrap leading-relaxed">
                      {selectedItem.translatedPrompt || activeVariant?.translatedPrompt}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-xs">
              <span>Chọn một ảnh trong danh sách hàng đợi bên trái để xem kết quả chi tiết</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
