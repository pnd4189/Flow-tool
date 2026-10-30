import React, { useState, useRef, useEffect } from 'react';
import type {
  PromptItem,
  QueueItem,
  GenerationSettings,
  SupportedAspectRatio,
  ToastMessage,
  DebugSimulationMode,
  MockErrorConfig,
  AutoPilotConfig,
  AutoPilotStatus,
  AutoPilotItemProgress,
  AutoPilotSummary,
  MemoryStats,
} from './types';
import { Step1PromptInput } from './components/Step1PromptInput';
import { Step2ImageGen } from './components/Step2ImageGen';
import { Step3Effects } from './components/Step3Effects';
import { Step4Export } from './components/Step4Export';
import { PlatformTest } from './components/PlatformTest';
import { AutoPilotPipeline } from './services/autoPilot';
import { AutoPilotPanel } from './components/AutoPilotPanel';
import { normalizePromptKey } from './services/downloadQueue';

export function App() {
  const [activeStep, setActiveStep] = useState<number>(1);

  // Modal Chẩn đoán hệ thống
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);

  // Debug simulation mode
  const [debugMode, setDebugMode] = useState<DebugSimulationMode>('none');
  const [showDebugMenu, setShowDebugMenu] = useState<boolean>(false);

  // Quản lý Mock Error Config (Giả lập lỗi sinh ảnh)
  const [mockErrorConfig, setMockErrorConfig] = useState<MockErrorConfig>({
    active: false,
    type: 'temporary',
    remainingCount: 0,
  });
  const mockErrorConfigRef = useRef(mockErrorConfig);
  mockErrorConfigRef.current = mockErrorConfig;

  // Bộ đếm ảnh hôm nay (tự đếm theo phiên, cộng dồn)
  const [todaySuccessCount, setTodaySuccessCount] = useState<number>(0);

  // Danh sách Prompt Bước 1
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [defaultRatio, setDefaultRatio] = useState<SupportedAspectRatio>('16:9');
  const [translateVietnamese, setTranslateVietnamese] = useState<boolean>(true);

  // Danh sách Hàng đợi Bước 2 & Bước 3 & Bước 4
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [settings, setSettings] = useState<GenerationSettings>({
    modelName: '🍌 Nano Banana 2.1',
    defaultAspectRatio: '16:9',
    variantsPerPrompt: 1,
    concurrency: 2,
    styleSuffix: '',
    addNoWatermark: true,
    translateVietnamese: true,
    autoFallbackModel: true,
    autoQcInspection: true,
  });

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Đợt 5B: Lưu max batch index nạp từ manifest
  const [maxLoadedBatchIndex, setMaxLoadedBatchIndex] = useState<number>(0);

  // ==========================================
  // ĐỢT 4A & 5A & 5B: STATE CHẾ ĐỘ TỰ ĐỘNG (AUTOPILOT)
  // ==========================================
  const [autoPilotStatus, setAutoPilotStatus] = useState<AutoPilotStatus>('idle');
  const [isAutoPilotMinimized, setIsAutoPilotMinimized] = useState<boolean>(false);
  const [autoPilotProgressItems, setAutoPilotProgressItems] = useState<AutoPilotItemProgress[]>([]);
  const [consecutiveErrorAlert, setConsecutiveErrorAlert] = useState<string | null>(null);
  const [cooldownStatusText, setCooldownStatusText] = useState<string | null>(null);

  const [autoPilotCounts, setAutoPilotCounts] = useState<{
    genDone: number;
    effectDone: number;
    layerDone: number;
    renderDone: number;
    downloadDone: number;
    total: number;
    memoryStats?: MemoryStats;
  }>({
    genDone: 0,
    effectDone: 0,
    layerDone: 0,
    renderDone: 0,
    downloadDone: 0,
    total: 0,
  });

  const [autoPilotSummary, setAutoPilotSummary] = useState<AutoPilotSummary | null>(null);
  const [autoPilotElapsedSec, setAutoPilotElapsedSec] = useState<number>(0);
  const [autoPilotEstRemainingSec, setAutoPilotEstRemainingSec] = useState<number>(0);

  const [autoPilotConfig, setAutoPilotConfig] = useState<AutoPilotConfig>({
    mode: 'full',
    modelName: '🍌 Nano Banana 2.1',
    concurrency: 2,
    batchSize: 10, // Đợt 5C: mặc định 10
    autoQc: true,
    effectMode: 'ai',
    parallaxMode: 'ai',
    durationMode: 'ai',
    fixedDurationSec: 6,
    resolution: '1080p',
    fps: 24,
    downloadClips: true,
    mergeClips: false,
    downloadOriginalImages: false,
    downloadManifest: true,
    uploadToFlow: false,
    projectName: 'effect-image',
    styleSuffix: '',
    addNoWatermark: true,
    translateVietnamese: true,
  });

  const autoPipelineRef = useRef<AutoPilotPipeline | null>(null);

  // Đồng hồ đếm thời gian AutoPilot & cập nhật ước tính thời gian thực
  useEffect(() => {
    let timer: any = null;
    if (autoPilotStatus === 'running') {
      timer = setInterval(() => {
        setAutoPilotElapsedSec((s) => s + 1);
        if (autoPipelineRef.current) {
          setAutoPilotEstRemainingSec(autoPipelineRef.current.getEstimatedRemainingSec());
        }
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [autoPilotStatus]);

  const addToast = (
    message: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info',
    title?: string
  ) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newToast: ToastMessage = { id, message, type, title, timestamp: Date.now() };
    setToasts((prev) => [...prev, newToast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const handleProceedToStep2 = () => {
    const selectedPrompts = prompts.filter((p) => p.selected);
    if (selectedPrompts.length === 0) {
      addToast('Vui lòng chọn ít nhất 1 prompt để sinh ảnh', 'warning');
      return;
    }

    const newQueue: QueueItem[] = selectedPrompts.map((p) => ({
      id: `queue_${p.id}`,
      promptItem: p,
      status: 'pending',
      variants: [],
      selectedVariantIndex: 0,
      activeModel: settings.modelName,
      retryCount: 0,
    }));

    setQueue(newQueue);
    setActiveStep(2);
    addToast(`Đã chuyển ${selectedPrompts.length} prompt sang Bước 2: Sinh ảnh`, 'success');
  };

  // KHỞI ĐỘNG CHẾ ĐỘ TỰ ĐỘNG
  const handleStartAutoPilot = (cfg: AutoPilotConfig) => {
    if (autoPilotStatus === 'running') {
      addToast('Tiến trình tự động đang chạy!', 'warning');
      return;
    }

    const activePrompts = prompts.filter(
      (p) => p.selected || p.warnings.includes('Đã xong (từ manifest)')
    );

    const targetPromptsToRun = prompts.filter(
      (p) => p.selected && !p.warnings.includes('Đã xong (từ manifest)')
    );

    if (targetPromptsToRun.length === 0) {
      addToast('Không có prompt nào được chọn cần chạy!', 'warning');
      return;
    }

    const initialQueue: QueueItem[] = activePrompts.map((p) => {
      const isDoneFromManifest = p.warnings.includes('Đã xong (từ manifest)');
      return {
        id: `queue_${p.id}`,
        promptItem: p,
        status: isDoneFromManifest ? ('done' as const) : ('pending' as const),
        variants: [],
        selectedVariantIndex: 0,
        activeModel: cfg.modelName,
        retryCount: 0,
        completedFromManifest: isDoneFromManifest,
      };
    });

    const mergedConfig: AutoPilotConfig = {
      ...cfg,
      translateVietnamese: translateVietnamese,
      styleSuffix: cfg.styleSuffix !== undefined ? cfg.styleSuffix : settings.styleSuffix,
      addNoWatermark: cfg.addNoWatermark !== undefined ? cfg.addNoWatermark : settings.addNoWatermark,
    };

    setQueue(initialQueue);
    setAutoPilotSummary(null);
    setAutoPilotElapsedSec(0);
    setConsecutiveErrorAlert(null);
    setCooldownStatusText(null);
    setAutoPilotStatus('running');
    setIsAutoPilotMinimized(false);

    let previousTurnSyncDoneCount = 0;
    const startBatchIndex = maxLoadedBatchIndex > 0 ? maxLoadedBatchIndex + 1 : 1;

    const pipeline = new AutoPilotPipeline(
      initialQueue,
      mergedConfig,
      {
        onItemUpdate: (updatedItem) => {
          setAutoPilotProgressItems((prev) => {
            const idx = prev.findIndex((x) => x.id === updatedItem.id);
            if (idx !== -1) {
              const next = [...prev];
              next[idx] = updatedItem;
              return next;
            }
            return [...prev, updatedItem];
          });
        },
        onOverallUpdate: (counts) => {
          setAutoPilotCounts(counts);
        },
        onGlobalError: (msg) => {
          addToast(msg, 'error');
        },
        onAutoPausedForConsecutiveErrors: (msg) => {
          setConsecutiveErrorAlert(msg);
          setAutoPilotStatus('paused');
          addToast(msg, 'error');
        },
        onCooldownStatus: (msg) => {
          setCooldownStatusText(msg);
        },
        onFinished: (summary: any) => {
          setAutoPilotStatus(summary.stoppedByUser ? 'stopped' : 'completed');
          setAutoPilotSummary(summary);
          setCooldownStatusText(null);
          const stopMsg = summary.stoppedByUser
            ? `Đã dừng: đã tải xong ${summary.completedClips} clip (lô dở đã lưu)!`
            : summary.stoppedByQuota
            ? `Hoàn tất trước hạn mức: ${summary.completedClips} clip thành công (${summary.unstartedCount || 0} prompt chưa sinh)!`
            : `Tự động hoàn tất: ${summary.completedClips}/${summary.totalClips} mục (${summary.batchesCompleted} lô đã lưu)!`;
          addToast(stopMsg, summary.errorCount > 0 ? 'warning' : 'success');
        },
        onSyncBackToState: (syncedQueue, completedCountThisTurn = 0) => {
          setQueue(syncedQueue);
          if (completedCountThisTurn > previousTurnSyncDoneCount) {
            const diff = completedCountThisTurn - previousTurnSyncDoneCount;
            setTodaySuccessCount((prev) => prev + diff);
            previousTurnSyncDoneCount = completedCountThisTurn;
          }
        },
      },
      mockErrorConfigRef,
      debugMode,
      prompts.length,
      startBatchIndex
    );

    autoPipelineRef.current = pipeline;
    setAutoPilotProgressItems(pipeline.getProgressList());
    setAutoPilotEstRemainingSec(pipeline.getEstimatedRemainingSec());
    pipeline.start();

    addToast(`⚡ Đã khởi động ${cfg.mode} cho ${targetPromptsToRun.length} prompt đã chọn`, 'info');
  };

  const handlePauseAutoPilot = () => {
    if (autoPipelineRef.current) {
      autoPipelineRef.current.pause();
      setAutoPilotStatus('paused');
      addToast('Đã tạm dừng tiến trình tự động', 'info');
    }
  };

  const handleResumeAutoPilot = () => {
    if (autoPipelineRef.current) {
      setConsecutiveErrorAlert(null);
      setCooldownStatusText(null);
      autoPipelineRef.current.resume();
      setAutoPilotStatus('running');
      addToast('Tiếp tục tiến trình tự động', 'info');
    }
  };

  const handleStopAutoPilot = async () => {
    if (autoPipelineRef.current) {
      addToast('Đang đợi các file tải xong và lưu manifest lô dở...', 'info');
      await autoPipelineRef.current.stop();
      setAutoPilotStatus('stopped');
      setCooldownStatusText(null);
      addToast('Đã dừng tiến trình tự động và lưu lô dở an toàn.', 'info');
    }
  };

  const handleRetryAutoPilotErrors = () => {
    if (autoPipelineRef.current) {
      setConsecutiveErrorAlert(null);
      setCooldownStatusText(null);
      autoPipelineRef.current.retryFailedStages();
      setAutoPilotStatus('running');
      addToast('Đang chạy lại các mục bị lỗi...', 'info');
    }
  };

  const handleOpenStep4FromAutoPilot = () => {
    setIsAutoPilotMinimized(true);
    setActiveStep(4);
    addToast('Chuyển sang Bước 4: Danh sách clip xuất', 'info');
  };

  const completedImagesCount = queue.filter((q) => q.status === 'done' || q.variants.length > 0).length;

  return (
    <div className="flex flex-col h-full w-full bg-[#0b0b0d] text-[#ececef] select-none font-sans text-[12px] md:text-[13px] antialiased">
      {/* 1. HEADER 44px */}
      <header className="h-[44px] min-h-[44px] px-3 md:px-4 bg-[#141417] border-b border-[#26262b] flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-[#f5b301] text-black flex items-center justify-center font-bold text-sm shadow-sm">
            <span className="material-symbols-outlined text-[18px]">burst_mode</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-[14px] tracking-tight text-white">Effect-Image</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30">
              0 credit
            </span>
          </div>
        </div>

        {/* Khu vực giữa/phải header */}
        <div className="flex items-center gap-2.5">
          {cooldownStatusText && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-mono font-semibold animate-pulse">
              <span className="material-symbols-outlined text-[15px] text-amber-400">hourglass_top</span>
              <span>{cooldownStatusText}</span>
              <button
                type="button"
                onClick={handleResumeAutoPilot}
                className="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-amber-400 text-black font-bold hover:bg-amber-300"
              >
                Chạy ngay
              </button>
            </div>
          )}

          {autoPilotStatus !== 'idle' && isAutoPilotMinimized && (
            <button
              type="button"
              onClick={() => setIsAutoPilotMinimized(false)}
              className="flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-400/15 border border-amber-400/40 text-amber-300 text-xs font-semibold hover:bg-amber-400/25 transition-all shadow-sm animate-pulse"
              title="Nhấn để mở lại bảng tiến trình Tự động"
            >
              <span className="material-symbols-outlined text-[16px] text-amber-400">bolt</span>
              <span>
                Tự động:{' '}
                {autoPilotStatus === 'completed'
                  ? `Xong ${autoPilotCounts.downloadDone}/${autoPilotCounts.total} ✓`
                  : autoPilotStatus === 'stopped'
                  ? 'Đã dừng'
                  : autoPilotStatus === 'paused'
                  ? 'Tạm dừng'
                  : `Đang chạy (${autoPilotCounts.downloadDone}/${autoPilotCounts.total})`}
              </span>
              <span className="material-symbols-outlined text-[14px]">open_in_full</span>
            </button>
          )}

          {mockErrorConfig.active && mockErrorConfig.remainingCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[11px] font-mono font-bold animate-pulse">
              <span className="material-symbols-outlined text-[15px] text-rose-400">warning</span>
              <span>
                ĐANG GIẢ LẬP LỖI ({mockErrorConfig.remainingCount} lần)
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#18181f] border border-[#26262b] text-[11px] font-mono text-zinc-300">
            <span className="material-symbols-outlined text-[14px] text-[#f5b301]">photo_library</span>
            <span>
              Ảnh hôm nay: <strong className="text-zinc-100">{todaySuccessCount}</strong>
            </span>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDebugMenu((prev) => !prev)}
              className="p-1.5 rounded hover:bg-[#202028] text-zinc-400 transition-colors"
              title="Trình đơn gỡ lỗi giả lập"
            >
              <span className="material-symbols-outlined text-[18px]">bug_report</span>
            </button>

            {showDebugMenu && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-[#18181f] border border-[#2d2d35] rounded-lg shadow-xl p-2 z-50 text-xs space-y-1">
                <div className="text-[10px] font-mono text-zinc-400 px-1 pb-1 border-b border-[#26262b]">
                  GIẢ LẬP LỖI
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDebugMode('none');
                    setShowDebugMenu(false);
                    addToast('Đã tắt chế độ gỡ lỗi', 'info');
                  }}
                  className={`w-full text-left px-2 py-1 rounded text-xs ${
                    debugMode === 'none' ? 'bg-[#f5b301] text-black font-semibold' : 'text-zinc-300 hover:bg-[#22222a]'
                  }`}
                >
                  Bình thường (None)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDebugMode('high_traffic');
                    setShowDebugMenu(false);
                    addToast('Đã bật giả lập lỗi High Traffic', 'warning');
                  }}
                  className={`w-full text-left px-2 py-1 rounded text-xs ${
                    debugMode === 'high_traffic' ? 'bg-[#f5b301] text-black font-semibold' : 'text-zinc-300 hover:bg-[#22222a]'
                  }`}
                >
                  Giả lập: High Traffic
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowDiagnostics(true)}
            className="p-1.5 rounded hover:bg-[#202028] text-zinc-400 hover:text-zinc-200 transition-colors flex items-center justify-center"
            title="Chẩn đoán hệ thống"
          >
            <span className="material-symbols-outlined text-[18px]">monitor_heart</span>
          </button>
        </div>
      </header>

      {/* 2. THANH 4 BƯỚC THỦ CÔNG */}
      <nav className="h-[38px] min-h-[38px] px-3 md:px-4 bg-[#111114] border-b border-[#26262b] flex items-center justify-between text-xs overflow-x-auto gap-2">
        <div className="flex items-center gap-1.5 md:gap-2">
          <button
            type="button"
            onClick={() => {
              if (autoPilotStatus !== 'idle') setIsAutoPilotMinimized(true);
              setActiveStep(1);
            }}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              activeStep === 1 && (autoPilotStatus === 'idle' || isAutoPilotMinimized)
                ? 'bg-[#1e1e26] text-[#f5b301] font-semibold border border-[#f5b301]/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#18181f]'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">edit_note</span>
            <span>1 Nhập prompt</span>
            {prompts.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#282832] text-zinc-300">
                {prompts.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              if (autoPilotStatus !== 'idle') setIsAutoPilotMinimized(true);
              setActiveStep(2);
            }}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              activeStep === 2 && (autoPilotStatus === 'idle' || isAutoPilotMinimized)
                ? 'bg-[#1e1e26] text-[#f5b301] font-semibold border border-[#f5b301]/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#18181f]'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">photo_library</span>
            <span>2 Sinh ảnh</span>
            {queue.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#282832] text-zinc-300">
                {completedImagesCount}/{queue.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              if (autoPilotStatus !== 'idle') setIsAutoPilotMinimized(true);
              setActiveStep(3);
            }}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              activeStep === 3 && (autoPilotStatus === 'idle' || isAutoPilotMinimized)
                ? 'bg-[#1e1e26] text-[#f5b301] font-semibold border border-[#f5b301]/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#18181f]'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">auto_awesome_motion</span>
            <span>3 Hiệu ứng</span>
            {completedImagesCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#282832] text-emerald-400">
                {completedImagesCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              if (autoPilotStatus !== 'idle') setIsAutoPilotMinimized(true);
              setActiveStep(4);
            }}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              activeStep === 4 && (autoPilotStatus === 'idle' || isAutoPilotMinimized)
                ? 'bg-[#1e1e26] text-[#f5b301] font-semibold border border-[#f5b301]/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#18181f]'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">movie</span>
            <span>4 Xuất</span>
          </button>
        </div>

        <div className="text-[11px] font-mono text-zinc-500 hidden md:block">
          Chạy bền ≥ 300 prompt
        </div>
      </nav>

      {/* 3. VÙNG NỘI DUNG CHÍNH */}
      <main className="flex-1 overflow-hidden flex flex-col relative">
        {autoPilotStatus !== 'idle' && !isAutoPilotMinimized ? (
          <AutoPilotPanel
            status={autoPilotStatus}
            items={autoPilotProgressItems}
            counts={autoPilotCounts}
            summary={autoPilotSummary}
            config={autoPilotConfig}
            elapsedSec={autoPilotElapsedSec}
            estRemainingSec={autoPilotEstRemainingSec}
            consecutiveErrorAlert={consecutiveErrorAlert}
            queue={queue}
            setQueue={setQueue}
            onPause={handlePauseAutoPilot}
            onResume={handleResumeAutoPilot}
            onStop={handleStopAutoPilot}
            onRetryErrors={handleRetryAutoPilotErrors}
            onOpenStep3={() => {
              setIsAutoPilotMinimized(true);
              setActiveStep(3);
            }}
            onOpenStep4={handleOpenStep4FromAutoPilot}
            onMinimize={() => setIsAutoPilotMinimized(true)}
          />
        ) : (
          <>
            {activeStep === 1 && (
              <Step1PromptInput
                prompts={prompts}
                setPrompts={setPrompts}
                defaultRatio={defaultRatio}
                setDefaultRatio={setDefaultRatio}
                translateVietnamese={translateVietnamese}
                setTranslateVietnamese={setTranslateVietnamese}
                onProceedToStep2={handleProceedToStep2}
                onStartAutoPilot={handleStartAutoPilot}
                autoPilotConfig={autoPilotConfig}
                setAutoPilotConfig={setAutoPilotConfig}
                styleSuffix={settings.styleSuffix}
                setStyleSuffix={(val) => setSettings((s) => ({ ...s, styleSuffix: val }))}
                addNoWatermark={settings.addNoWatermark}
                setAddNoWatermark={(val) => setSettings((s) => ({ ...s, addNoWatermark: val }))}
                onAddToast={addToast}
                onBatchIndexLoaded={(maxIdx) => setMaxLoadedBatchIndex(maxIdx)}
              />
            )}

            {activeStep === 2 && (
              <Step2ImageGen
                queue={queue}
                setQueue={setQueue}
                settings={settings}
                setSettings={setSettings}
                todaySuccessCount={todaySuccessCount}
                setTodaySuccessCount={setTodaySuccessCount}
                debugMode={debugMode}
                mockErrorConfig={mockErrorConfig}
                setMockErrorConfig={setMockErrorConfig}
                onAddToast={addToast}
              />
            )}

            {activeStep === 3 && (
              <Step3Effects
                queue={queue}
                setQueue={setQueue}
                onProceedToStep4={() => {
                  setActiveStep(4);
                  addToast('Chuyển sang Bước 4: Xuất video', 'info');
                }}
                onAddToast={addToast}
              />
            )}

            {activeStep === 4 && (
              <Step4Export
                queue={queue}
                setQueue={setQueue}
                onAddToast={addToast}
                onBackToStep3={() => setActiveStep(3)}
                totalPromptCount={prompts.length}
              />
            )}
          </>
        )}
      </main>

      {/* 4. MODAL CHẨN ĐOÁN HỆ THỐNG */}
      {showDiagnostics && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
          <div className="w-full max-w-5xl h-[85vh] bg-[#0b0b0d] border border-[#26262b] rounded-xl flex flex-col overflow-hidden shadow-2xl">
            <div className="p-3 border-b border-[#26262b] bg-[#141417] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#f5b301] text-[20px]">
                  monitor_heart
                </span>
                <span className="font-semibold text-xs text-zinc-200 uppercase tracking-wide">
                  Chẩn đoán hệ thống
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowDiagnostics(false)}
                className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-[#26262b]"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              <PlatformTest
                mockErrorConfig={mockErrorConfig}
                setMockErrorConfig={setMockErrorConfig}
                onNotify={addToast}
              />
            </div>
          </div>
        </div>
      )}

      {/* 5. TOAST NOTIFICATIONS */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-3 rounded-lg border shadow-xl flex items-start gap-2.5 transition-all text-xs animate-in slide-in-from-bottom-2 ${
              toast.type === 'success'
                ? 'bg-[#121c15] border-emerald-500/40 text-emerald-300'
                : toast.type === 'warning'
                ? 'bg-[#1f1b12] border-amber-500/40 text-amber-300'
                : toast.type === 'error'
                ? 'bg-[#211316] border-rose-500/40 text-rose-300'
                : 'bg-[#15151c] border-zinc-700 text-zinc-200'
            }`}
          >
            <span className="material-symbols-outlined text-[17px] mt-0.5">
              {toast.type === 'success'
                ? 'check_circle'
                : toast.type === 'warning'
                ? 'warning'
                : toast.type === 'error'
                ? 'error'
                : 'info'}
            </span>
            <div className="flex-1 min-w-0">
              {toast.title && <div className="font-semibold mb-0.5">{toast.title}</div>}
              <div className="leading-snug">{toast.message}</div>
            </div>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-zinc-400 hover:text-zinc-200"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
