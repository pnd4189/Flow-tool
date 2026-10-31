import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Flow } from 'flow-sdk';
import {
  Scene,
  VideoSettings,
  VideoModelId,
  VideoAspect,
  VideoJob,
} from '../types';
import {
  UsageState,
  estimateVideoCredits,
  creditsLeft,
} from '../services/usage';
import {
  VIDEO_MODELS,
  STYLE_PRESETS,
  CAMERA_PRESETS,
  composeMotionPrompt,
  defaultMotionPrompt,
  getOrCreateFirstFrameMediaId,
  base64ToBlob,
  blobToBase64,
  checkVideoErrorType,
  clearFirstFrameCache,
} from '../services/video';
import {
  DownloadItem,
  isDownloadBusy,
  subscribe as subscribeDownloads,
  runDownloads,
  buildVideoDownloadFilename,
} from '../services/downloadQueue';
import { generateMotionSuggestion } from '../services/storyboard';
import { evaluateScenesQuality, ImageScoreResult } from '../services/imageScore';
import { pickScenes, AutoPickStrategy } from '../services/autoPick';
import { aiRateScenes, AIRatingItem } from '../services/aiPicker';

export type CameraStrategy = 'fixed' | 'cycle' | 'ai';

interface VideoStudioProps {
  scenes: Scene[];
  usageState: UsageState;
  isImageGenerating: boolean;
  onUpdateSceneMotionPrompt?: (sceneId: string, motionPrompt: string) => void;
  onVideoSuccess: (credits: number, model: string, note?: string) => void;
  onVideoGeneratingStateChange: (isGenerating: boolean) => void;
  onJobsSync?: (jobs: VideoJob[]) => void;
}

export const VideoStudio: React.FC<VideoStudioProps> = ({
  scenes,
  usageState,
  isImageGenerating,
  onUpdateSceneMotionPrompt,
  onVideoSuccess,
  onVideoGeneratingStateChange,
  onJobsSync,
}) => {
  const usageStateRef = useRef<UsageState>(usageState);
  usageStateRef.current = usageState;

  const completedScenes = useMemo(() => {
    return scenes.filter(s => !!s.result);
  }, [scenes]);

  const sceneNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    scenes.forEach((s, idx) => {
      map.set(s.id, idx + 1);
    });
    return map;
  }, [scenes]);

  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(new Set());

  // ----------------------------------------------------
  // CHẾ ĐỘ CHỌN ẢNH & CHIẾN LƯỢC CHẤM ĐIỂM
  // ----------------------------------------------------
  const [pickMode, setPickMode] = useState<'manual' | 'auto'>('manual');
  const [targetVideoCount, setTargetVideoCount] = useState<number>(10);
  const [useBudgetCap, setUseBudgetCap] = useState<boolean>(false);
  const [maxBudgetInput, setMaxBudgetInput] = useState<string>('');
  const [autoStrategy, setAutoStrategy] = useState<AutoPickStrategy>('ai');
  const [keepFirstLast, setKeepFirstLast] = useState<boolean>(false);
  const [dedupeEnabled, setDedupeEnabled] = useState<boolean>(true);

  const [filterOnlySelected, setFilterOnlySelected] = useState<boolean>(false);

  // Điểm cục bộ & Điểm AI
  const [localScores, setLocalScores] = useState<Map<string, ImageScoreResult>>(new Map());
  const [aiScores, setAiScores] = useState<Map<string, AIRatingItem>>(new Map());
  const [finalScoreMap, setFinalScoreMap] = useState<Map<string, number>>(new Map());

  // Tiến trình chấm điểm
  const [scoringProgress, setScoringProgress] = useState<{
    isRunning: boolean;
    text: string;
    current: number;
    total: number;
  }>({
    isRunning: false,
    text: '',
    current: 0,
    total: 0,
  });
  const abortScoringRef = useRef<{ aborted: boolean }>({ aborted: false });

  // Map số video cho từng scene khi K > N
  const [customVariantsMap, setCustomVariantsMap] = useState<Record<string, number>>({});

  // ----------------------------------------------------
  // CHIẾN LƯỢC CAMERA & STYLE
  // ----------------------------------------------------
  const [cameraStrategy, setCameraStrategy] = useState<CameraStrategy>('ai');
  const [cycledCameraIds, setCycledCameraIds] = useState<string[]>([
    'push_in',
    'pan_left',
    'pan_right',
    'drone',
    'orbit',
    'tilt_up',
  ]);
  // Camera cụ thể của từng scene: sceneId -> cameraId
  const [sceneCameraMap, setSceneCameraMap] = useState<Record<string, string>>({});

  // Style Strategy
  const [cycleStylesEnabled, setCycleStylesEnabled] = useState<boolean>(false);
  const [cycledStyleIds, setCycledStyleIds] = useState<string[]>([
    'cinematic',
    'realistic',
    'dreamy',
  ]);

  // Cấu hình video cơ bản
  const [settings, setSettings] = useState<VideoSettings>({
    model: 'Omni 1.1 Flash',
    resolution: '360p',
    durationSeconds: 4,
    aspect: '16:9',
    variants: 1,
    styleId: 'none',
    cameraId: 'push_in',
  });

  const costPerVideo = useMemo(() => {
    return estimateVideoCredits(settings.model, settings.resolution, settings.durationSeconds, 1);
  }, [settings.model, settings.resolution, settings.durationSeconds]);

  useEffect(() => {
    if (!maxBudgetInput) {
      setMaxBudgetInput(String(creditsLeft(usageState)));
    }
  }, [usageState, maxBudgetInput]);

  const effectiveTargetCount = useMemo(() => {
    let k = Math.max(1, Math.min(200, targetVideoCount || 1));
    if (useBudgetCap) {
      const budgetNum = parseInt(maxBudgetInput, 10);
      if (!isNaN(budgetNum) && budgetNum > 0 && costPerVideo > 0) {
        const maxAffordable = Math.floor(budgetNum / costPerVideo);
        k = Math.max(1, Math.min(k, maxAffordable));
      }
    }
    return k;
  }, [targetVideoCount, useBudgetCap, maxBudgetInput, costPerVideo]);

  const wasReducedByBudget = useBudgetCap && effectiveTargetCount < targetVideoCount;

  // Tính camera cho 1 scene theo thứ tự hoặc AI
  const resolveSceneCamera = (
    sceneId: string,
    orderIndex: number,
    aiItem?: AIRatingItem
  ): string => {
    if (cameraStrategy === 'fixed') {
      return settings.cameraId || 'push_in';
    }
    if (cameraStrategy === 'ai') {
      if (aiItem && aiItem.camera) {
        return aiItem.camera;
      }
      // Thiếu AI camera: xoay vòng
      const validCycle = cycledCameraIds.length > 0 ? cycledCameraIds : ['push_in'];
      return validCycle[orderIndex % validCycle.length];
    }
    // 'cycle'
    const validCycle = cycledCameraIds.length > 0 ? cycledCameraIds : ['push_in'];
    return validCycle[orderIndex % validCycle.length];
  };

  // Toggle tick camera xoay vòng
  const toggleCycleCamera = (camId: string) => {
    setCycledCameraIds(prev => {
      if (prev.includes(camId)) {
        if (prev.length <= 1) return prev; // giữ ít nhất 1
        return prev.filter(id => id !== camId);
      }
      return [...prev, camId];
    });
  };

  // Toggle tick style xoay vòng
  const toggleCycleStyle = (styleId: string) => {
    setCycledStyleIds(prev => {
      if (prev.includes(styleId)) {
        if (prev.length <= 1) return prev;
        return prev.filter(id => id !== styleId);
      }
      return [...prev, styleId];
    });
  };

  // ----------------------------------------------------
  // THỰC HIỆN TỰ ĐỘNG CHỌN (CHẤM ĐIỂM CỤC BỘ + AI)
  // ----------------------------------------------------
  const [autoSummaryNotice, setAutoSummaryNotice] = useState<string | null>(null);

  const handleRunAutoPick = async () => {
    if (completedScenes.length === 0) return;

    abortScoringRef.current = { aborted: false };
    setAutoSummaryNotice(null);

    try {
      // BƯỚC 1: Chấm điểm cục bộ
      setScoringProgress({
        isRunning: true,
        text: 'Đang chấm điểm cục bộ...',
        current: 0,
        total: completedScenes.length,
      });

      const localMap = await evaluateScenesQuality(completedScenes, {
        batchSize: 6,
        onProgress: (cur, tot) => {
          setScoringProgress(prev => ({
            ...prev,
            text: `Chấm điểm cục bộ ${cur}/${tot}...`,
            current: cur,
            total: tot,
          }));
        },
        signal: abortScoringRef.current,
      });
      setLocalScores(localMap);

      // BƯỚC 2: Chấm điểm bằng AI nếu chiến lược là 'ai'
      let aiMap = aiScores;
      if (autoStrategy === 'ai') {
        setScoringProgress({
          isRunning: true,
          text: 'AI đang phân tích và chấm điểm...',
          current: 0,
          total: completedScenes.length,
        });

        const itemsToRate = completedScenes.map(s => ({
          id: s.id,
          prompt: s.prompt,
          thumbBase64: s.result?.thumbBase64,
          base64: s.result?.base64,
          mimeType: s.result?.mimeType,
        }));

        aiMap = await aiRateScenes(itemsToRate, {
          batchSize: 12,
          onProgress: (curBatch, totBatches, statusText) => {
            setScoringProgress({
              isRunning: true,
              text: `${statusText} (${curBatch}/${totBatches})`,
              current: curBatch,
              total: totBatches,
            });
          },
          signal: abortScoringRef.current,
        });
        setAiScores(aiMap);
      }

      // BƯỚC 3: Tính điểm cuối cùng
      const finalMap = new Map<string, number>();
      const hashMap = new Map<string, string>();

      completedScenes.forEach(s => {
        const loc = localMap.get(s.id);
        const locScore = loc ? loc.score : 50;
        if (loc) hashMap.set(s.id, loc.dHash);

        if (autoStrategy === 'ai') {
          const aiItem = aiMap.get(s.id);
          if (aiItem && aiItem.isAiRated) {
            const combined = Math.round(0.6 * aiItem.score + 0.4 * locScore);
            finalMap.set(s.id, combined);
          } else {
            finalMap.set(s.id, locScore);
          }
        } else {
          finalMap.set(s.id, locScore);
        }
      });
      setFinalScoreMap(finalMap);

      // BƯỚC 4: Chọn K ảnh
      const pickRes = pickScenes({
        scenes: completedScenes,
        scores: finalMap,
        hashes: hashMap,
        count: effectiveTargetCount,
        strategy: autoStrategy,
        keepFirstLast,
        dedupeThreshold: dedupeEnabled ? 6 : 0,
      });

      setSelectedSceneIds(new Set(pickRes.selectedSceneIds));
      setCustomVariantsMap(pickRes.variantsPerScene);

      // BƯỚC 5: Gán camera theo chiến lược cho các cảnh được chọn
      const nextCameraMap: Record<string, string> = { ...sceneCameraMap };
      pickRes.selectedSceneIds.forEach((sId, idx) => {
        const aiItem = aiMap.get(sId);
        nextCameraMap[sId] = resolveSceneCamera(sId, idx, aiItem);
      });
      setSceneCameraMap(nextCameraMap);

      // Tính tổng credit ước tính
      let totalVids = 0;
      pickRes.selectedSceneIds.forEach(sId => {
        totalVids += pickRes.variantsPerScene[sId] || settings.variants;
      });
      const estimatedCredits = totalVids * costPerVideo;

      setAutoSummaryNotice(
        `Đã chọn ${pickRes.selectedSceneIds.length}/${completedScenes.length} ảnh (${totalVids} video) - ước tính ${estimatedCredits} credit.`
      );
    } catch (err: any) {
      if (err?.message !== 'Đã huỷ chấm điểm ảnh' && err?.message !== 'Đã huỷ chấm điểm bằng AI') {
        console.error('Lỗi tự động chọn ảnh:', err);
      }
    } finally {
      setScoringProgress({
        isRunning: false,
        text: '',
        current: 0,
        total: 0,
      });
    }
  };

  const handleCancelScoring = () => {
    abortScoringRef.current.aborted = true;
    setScoringProgress({
      isRunning: false,
      text: '',
      current: 0,
      total: 0,
    });
  };

  const selectedOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    let order = 1;
    completedScenes.forEach(s => {
      if (selectedSceneIds.has(s.id)) {
        map.set(s.id, order++);
      }
    });
    return map;
  }, [completedScenes, selectedSceneIds]);

  // Motion prompt riêng cho từng cảnh
  const [localMotionPrompts, setLocalMotionPrompts] = useState<Record<string, string>>({});
  const [motionErrors, setMotionErrors] = useState<Record<string, string>>({});

  const [motionSuggestingState, setMotionSuggestingState] = useState<{
    isRunning: boolean;
    current: number;
    total: number;
    currentSceneTitle?: string;
  }>({
    isRunning: false,
    current: 0,
    total: 0,
  });
  const stopMotionSuggestionRef = useRef(false);

  useEffect(() => {
    setLocalMotionPrompts(prev => {
      let changed = false;
      const next = { ...prev };
      scenes.forEach(s => {
        if (s.motionPrompt && next[s.id] === undefined) {
          next[s.id] = s.motionPrompt;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [scenes]);

  const handleMotionPromptChange = (sceneId: string, val: string) => {
    setLocalMotionPrompts(prev => ({ ...prev, [sceneId]: val }));
    if (onUpdateSceneMotionPrompt) {
      onUpdateSceneMotionPrompt(sceneId, val);
    }
  };

  const currentModelConfig = useMemo(() => {
    return VIDEO_MODELS.find(m => m.id === settings.model) || VIDEO_MODELS[0];
  }, [settings.model]);

  const handleModelChange = (newModelId: VideoModelId) => {
    const config = VIDEO_MODELS.find(m => m.id === newModelId) || VIDEO_MODELS[0];
    let nextRes = settings.resolution;
    if (!config.resolutions.includes(nextRes)) {
      nextRes = config.resolutions[0];
    }
    let nextDur = settings.durationSeconds;
    if (!config.durations.includes(nextDur)) {
      nextDur = config.durations[0];
    }

    setSettings(prev => ({
      ...prev,
      model: newModelId,
      resolution: nextRes,
      durationSeconds: nextDur,
    }));
  };

  const toggleSelectScene = (id: string) => {
    setSelectedSceneIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        if (!sceneCameraMap[id]) {
          const aiItem = aiScores.get(id);
          const assigned = resolveSceneCamera(id, next.size - 1, aiItem);
          setSceneCameraMap(m => ({ ...m, [id]: assigned }));
        }
      }
      return next;
    });
  };

  const selectAll = () => {
    const next = new Set<string>();
    const nextCam = { ...sceneCameraMap };
    completedScenes.forEach((s, idx) => {
      next.add(s.id);
      if (!nextCam[s.id]) {
        nextCam[s.id] = resolveSceneCamera(s.id, idx, aiScores.get(s.id));
      }
    });
    setSelectedSceneIds(next);
    setSceneCameraMap(nextCam);
  };

  const clearSelection = () => {
    setSelectedSceneIds(new Set());
  };

  const activeSelectedScenes = useMemo(() => {
    return completedScenes.filter(s => selectedSceneIds.has(s.id));
  }, [completedScenes, selectedSceneIds]);

  const totalVideosToMake = useMemo(() => {
    if (pickMode === 'auto' && Object.keys(customVariantsMap).length > 0) {
      let sum = 0;
      activeSelectedScenes.forEach(s => {
        sum += customVariantsMap[s.id] || settings.variants;
      });
      return sum;
    }
    return activeSelectedScenes.length * settings.variants;
  }, [pickMode, customVariantsMap, activeSelectedScenes, settings.variants]);

  const totalCreditsNeeded = totalVideosToMake * costPerVideo;
  const currentRemainingCredits = creditsLeft(usageState);
  const creditsAfterRun = currentRemainingCredits - totalCreditsNeeded;
  const isOverBudget = totalCreditsNeeded > currentRemainingCredits;

  const displayedScenes = useMemo(() => {
    if (filterOnlySelected) {
      return completedScenes.filter(s => selectedSceneIds.has(s.id));
    }
    return completedScenes;
  }, [completedScenes, filterOnlySelected, selectedSceneIds]);

  // Gợi ý chuyển động AI
  const handleSuggestSingleMotion = async (scene: Scene) => {
    if (motionSuggestingState.isRunning) return;
    setMotionErrors(prev => {
      const next = { ...prev };
      delete next[scene.id];
      return next;
    });

    try {
      const suggestion = await generateMotionSuggestion({
        imagePrompt: scene.prompt,
        thumbBase64: scene.result?.thumbBase64,
      });
      handleMotionPromptChange(scene.id, suggestion);
    } catch (err: any) {
      setMotionErrors(prev => ({
        ...prev,
        [scene.id]: err?.message || 'Không thể gợi ý chuyển động',
      }));
    }
  };

  const handleSuggestAllMotion = async () => {
    if (activeSelectedScenes.length === 0 || motionSuggestingState.isRunning) return;

    stopMotionSuggestionRef.current = false;
    const total = activeSelectedScenes.length;
    setMotionSuggestingState({
      isRunning: true,
      current: 0,
      total,
    });

    try {
      for (let i = 0; i < total; i++) {
        if (stopMotionSuggestionRef.current) break;

        const scene = activeSelectedScenes[i];
        setMotionSuggestingState({
          isRunning: true,
          current: i + 1,
          total,
          currentSceneTitle: scene.title,
        });

        setMotionErrors(prev => {
          const next = { ...prev };
          delete next[scene.id];
          return next;
        });

        try {
          const suggestion = await generateMotionSuggestion({
            imagePrompt: scene.prompt,
            thumbBase64: scene.result?.thumbBase64,
          });
          handleMotionPromptChange(scene.id, suggestion);
        } catch (err: any) {
          setMotionErrors(prev => ({
            ...prev,
            [scene.id]: err?.message || 'Lỗi gợi ý chuyển động',
          }));
        }

        if (i < total - 1 && !stopMotionSuggestionRef.current) {
          await new Promise(r => setTimeout(r, 300));
        }
      }
    } finally {
      setMotionSuggestingState({
        isRunning: false,
        current: 0,
        total: 0,
      });
    }
  };

  const handleStopMotionSuggestion = () => {
    stopMotionSuggestionRef.current = true;
  };

  // ----------------------------------------------------
  // QUẢN LÝ JOBS & TIẾN TRÌNH TẠO VIDEO TUẦN TỰ
  // ----------------------------------------------------
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const jobsRef = useRef<VideoJob[]>([]);
  jobsRef.current = jobs;

  useEffect(() => {
    if (onJobsSync) {
      onJobsSync(jobs);
    }
  }, [jobs, onJobsSync]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const stopRequestedRef = useRef(false);
  const pauseRequestedRef = useRef(false);

  useEffect(() => {
    onVideoGeneratingStateChange(isProcessing);
  }, [isProcessing, onVideoGeneratingStateChange]);

  const [confirmPending, setConfirmPending] = useState(false);
  const confirmTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [bannerNotice, setBannerNotice] = useState<{ message: string; type: 'error' | 'warning' | 'info' } | null>(null);
  const [selectedVideoJobIds, setSelectedVideoJobIds] = useState<Set<string>>(new Set());

  const [isDownloadQueueBusy, setIsDownloadQueueBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeDownloads(prog => {
      setIsDownloadQueueBusy(prog.isBusy);
    });
    return unsub;
  }, []);

  useEffect(() => {
    return () => {
      jobsRef.current.forEach(j => {
        if (j.result?.blobUrl) {
          URL.revokeObjectURL(j.result.blobUrl);
        }
      });
      clearFirstFrameCache();
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const updateJob = (id: string, patch: Partial<VideoJob>) => {
    jobsRef.current = jobsRef.current.map(j => (j.id === id ? { ...j, ...patch } : j));
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)));
  };

  const runSingleJob = async (job: VideoJob): Promise<{ success: boolean; shouldStopQueue?: boolean }> => {
    const parentScene = scenes.find(s => s.id === job.sceneId);
    if (!parentScene || !parentScene.result) {
      updateJob(job.id, {
        status: 'error',
        errorMessage: 'Ảnh gốc của cảnh không còn tồn tại trong phiên.',
      });
      return { success: false };
    }

    updateJob(job.id, { status: 'preparing', errorMessage: undefined, retryInfo: undefined });
    let firstFrameId = '';
    try {
      firstFrameId = await getOrCreateFirstFrameMediaId(parentScene, job.aspect);
    } catch (err: any) {
      updateJob(job.id, {
        status: 'error',
        errorMessage: `Lỗi chuẩn bị khung đầu: ${err?.message || 'Không thể upload ảnh'}`,
      });
      return { success: false };
    }

    if (stopRequestedRef.current) {
      updateJob(job.id, { status: 'pending' });
      return { success: false, shouldStopQueue: true };
    }

    const maxTries = 2;
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      if (stopRequestedRef.current) {
        updateJob(job.id, { status: 'pending' });
        return { success: false, shouldStopQueue: true };
      }

      while (pauseRequestedRef.current && !stopRequestedRef.current) {
        await new Promise(r => setTimeout(r, 400));
      }
      if (stopRequestedRef.current) {
        updateJob(job.id, { status: 'pending' });
        return { success: false, shouldStopQueue: true };
      }

      updateJob(job.id, {
        status: 'generating',
        errorMessage: undefined,
        retryInfo: attempt > 1 ? 'Đang thử lại lần 2 sau lỗi tạm thời...' : undefined,
      });

      const isVeo = job.model.startsWith('Veo');
      const resolvedResolution: '360p' | '720p' = isVeo ? '720p' : job.resolution;

      try {
        const videoPromise = Flow.generate.video({
          prompt: job.motionPrompt,
          modelDisplayName: job.model,
          aspectRatio: job.aspect,
          durationSeconds: job.durationSeconds,
          resolution: resolvedResolution,
          firstFrameImageMediaId: firstFrameId,
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            const timeoutErr = new Error('Quá thời gian chờ; video có thể vẫn được tạo, hãy kiểm tra thư viện Flow.');
            (timeoutErr as any).isTimeout = true;
            reject(timeoutErr);
          }, 600000);
        });

        const genResult = await Promise.race([videoPromise, timeoutPromise]);

        const blob = base64ToBlob(genResult.base64, genResult.mimeType || 'video/mp4');
        const blobUrl = URL.createObjectURL(blob);
        const bytes = blob.size;

        updateJob(job.id, {
          status: 'success',
          errorMessage: undefined,
          retryInfo: undefined,
          result: {
            blobUrl,
            bytes,
            mediaId: genResult.mediaId,
          },
        });

        onVideoSuccess(
          job.creditEstimate,
          job.model,
          `Video #${job.sceneNumber} v${job.variant} (${job.durationSeconds}s)`
        );

        return { success: true };
      } catch (err: any) {
        const rawMsg = err?.message || 'Tạo video không thành công';
        const isTimeout = !!err?.isTimeout || rawMsg.includes('Quá thời gian chờ');

        if (isTimeout) {
          updateJob(job.id, {
            status: 'error',
            errorMessage: 'Quá thời gian chờ; video có thể vẫn được tạo, hãy kiểm tra thư viện Flow.',
            retryInfo: undefined,
          });
          return { success: false };
        }

        const { isTransient, isQuota, isSafety } = checkVideoErrorType(rawMsg);

        if (isQuota) {
          updateJob(job.id, {
            status: 'error',
            errorMessage: rawMsg,
            retryInfo: undefined,
          });
          setBannerNotice({
            message: 'Hết hạn mức hoặc credit của tài khoản - đã dừng hàng đợi tạo video.',
            type: 'error',
          });
          return { success: false, shouldStopQueue: true };
        }

        if (isSafety) {
          updateJob(job.id, {
            status: 'error',
            errorMessage: rawMsg,
            retryInfo: undefined,
          });
          return { success: false };
        }

        if (isTransient && attempt < maxTries) {
          updateJob(job.id, {
            retryInfo: 'Flow đang bận, sẽ tự thử lại sau 20s...',
          });
          for (let s = 0; s < 20; s++) {
            if (stopRequestedRef.current) {
              updateJob(job.id, { status: 'pending', retryInfo: undefined });
              return { success: false, shouldStopQueue: true };
            }
            await new Promise(r => setTimeout(r, 1000));
          }
          continue;
        }

        updateJob(job.id, {
          status: 'error',
          errorMessage: rawMsg,
          retryInfo: undefined,
        });
        return { success: false };
      }
    }

    return { success: false };
  };

  const processQueue = async (initialJobs?: VideoJob[]) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setIsPaused(false);
    stopRequestedRef.current = false;
    pauseRequestedRef.current = false;
    setBannerNotice(null);

    const queueList = initialJobs || jobsRef.current;

    try {
      for (const currentJob of queueList) {
        if (stopRequestedRef.current) break;

        const freshJob = jobsRef.current.find(j => j.id === currentJob.id);
        if (!freshJob || freshJob.status !== 'pending') continue;

        const remainingNow = creditsLeft(usageStateRef.current);
        if (freshJob.creditEstimate > remainingNow) {
          setBannerNotice({
            message: `Không đủ credit để tiếp tục tạo video (cần ${freshJob.creditEstimate}, còn ${remainingNow}). Đã dừng hàng đợi.`,
            type: 'warning',
          });
          break;
        }

        const res = await runSingleJob(freshJob);

        if (res.shouldStopQueue) {
          break;
        }

        if (!stopRequestedRef.current) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } finally {
      setIsProcessing(false);
      setIsPaused(false);
      const cleaned = jobsRef.current.map(j => {
        if (j.status === 'generating' || j.status === 'preparing') {
          return { ...j, status: 'pending' as const, retryInfo: undefined };
        }
        return j;
      });
      jobsRef.current = cleaned;
      setJobs(cleaned);
    }
  };

  const handleStartGeneration = () => {
    if (isImageGenerating) {
      setBannerNotice({
        message: 'Batch tạo ảnh đang chạy. Vui lòng đợi hoặc dừng batch tạo ảnh trước khi tạo video.',
        type: 'warning',
      });
      return;
    }

    if (activeSelectedScenes.length === 0) {
      setBannerNotice({
        message: 'Vui lòng chọn ít nhất 1 ảnh nguồn.',
        type: 'warning',
      });
      return;
    }

    if (totalCreditsNeeded > currentRemainingCredits) {
      setBannerNotice({
        message: `Tổng ước tính (${totalCreditsNeeded} credit) vượt quá số dư còn lại (${currentRemainingCredits} credit). Không thể chạy!`,
        type: 'error',
      });
      return;
    }

    const needsTwoStep =
      totalCreditsNeeded >= 200 ||
      (currentRemainingCredits > 0 && totalCreditsNeeded > currentRemainingCredits * 0.5);

    if (needsTwoStep && !confirmPending) {
      setConfirmPending(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmPending(false);
      }, 3000);
      return;
    }

    setConfirmPending(false);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);

    const newJobs: VideoJob[] = [];
    activeSelectedScenes.forEach((scene, sceneIdx) => {
      const sceneNum = sceneNumberMap.get(scene.id) || 1;
      const baseMotion =
        localMotionPrompts[scene.id] !== undefined
          ? localMotionPrompts[scene.id]
          : defaultMotionPrompt(scene);

      const sceneCam = sceneCameraMap[scene.id] || settings.cameraId || 'none';

      let sceneStyle = settings.styleId;
      if (cycleStylesEnabled && cycledStyleIds.length > 0) {
        sceneStyle = cycledStyleIds[sceneIdx % cycledStyleIds.length];
      }

      const motionPrompt = composeMotionPrompt(baseMotion, sceneStyle, sceneCam);

      const variantsCount =
        pickMode === 'auto' && customVariantsMap[scene.id]
          ? customVariantsMap[scene.id]
          : settings.variants;

      for (let v = 1; v <= variantsCount; v++) {
        newJobs.push({
          id: crypto.randomUUID(),
          sceneId: scene.id,
          sceneNumber: sceneNum,
          title: scene.title,
          variant: v,
          motionPrompt,
          model: settings.model,
          resolution: settings.resolution,
          durationSeconds: settings.durationSeconds,
          aspect: settings.aspect,
          creditEstimate: costPerVideo,
          status: 'pending',
        });
      }
    });

    jobsRef.current = [...jobsRef.current, ...newJobs];
    setJobs(jobsRef.current);
    processQueue(newJobs);
  };

  const handleRetryJob = async (job: VideoJob) => {
    if (isProcessing) {
      setBannerNotice({
        message: 'Hàng đợi video đang xử lý, vui lòng chờ.',
        type: 'warning',
      });
      return;
    }

    const remainingNow = creditsLeft(usageStateRef.current);
    if (job.creditEstimate > remainingNow) {
      setBannerNotice({
        message: `Không đủ credit để thử lại job này (cần ${job.creditEstimate}, còn ${remainingNow}).`,
        type: 'error',
      });
      return;
    }

    updateJob(job.id, { status: 'pending', errorMessage: undefined, retryInfo: undefined });
    setIsProcessing(true);
    try {
      await runSingleJob(job);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
    setBannerNotice({
      message: 'Đang dừng hàng đợi... (Video đang tạo sẽ được hoàn tất để không lãng phí credit đã trừ).',
      type: 'info',
    });
  };

  const handleTogglePause = () => {
    if (isPaused) {
      pauseRequestedRef.current = false;
      setIsPaused(false);
    } else {
      pauseRequestedRef.current = true;
      setIsPaused(true);
    }
  };

  const handleDeleteJob = (jobId: string) => {
    const target = jobsRef.current.find(j => j.id === jobId);
    if (target?.result?.blobUrl) {
      URL.revokeObjectURL(target.result.blobUrl);
    }
    const filtered = jobsRef.current.filter(j => j.id !== jobId);
    jobsRef.current = filtered;
    setJobs(filtered);
    setSelectedVideoJobIds(prev => {
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
  };

  const handleClearCompletedJobs = () => {
    jobsRef.current.forEach(j => {
      if (j.result?.blobUrl) {
        URL.revokeObjectURL(j.result.blobUrl);
      }
    });
    jobsRef.current = [];
    setJobs([]);
    setSelectedVideoJobIds(new Set());
    clearFirstFrameCache();
  };

  const successfulJobs = useMemo(() => {
    return jobs.filter(j => j.status === 'success' && !!j.result?.blobUrl);
  }, [jobs]);

  const handleDownloadVideosViaQueue = async (targets: VideoJob[]) => {
    if (targets.length === 0 || isDownloadQueueBusy) return;

    const items: DownloadItem[] = targets.map(job => {
      const filename = buildVideoDownloadFilename({
        sceneNumber: job.sceneNumber,
        title: job.title,
        variant: job.variant,
        model: job.model,
        durationSeconds: job.durationSeconds,
        mimeType: 'video/mp4',
      });
      const approxBytes = job.result?.bytes || 5 * 1024 * 1024;

      return {
        key: `vid_${job.id}`,
        kind: 'video',
        filename,
        mimeType: 'video/mp4',
        sceneNumber: job.sceneNumber,
        label: `Video Cảnh #${job.sceneNumber} v${job.variant} (${job.durationSeconds}s)`,
        approxBytes,
        getBase64: async () => {
          if (!job.result?.blobUrl) throw new Error('Blob URL không khả dụng');
          const response = await fetch(job.result.blobUrl);
          const blob = await response.blob();
          return await blobToBase64(blob);
        },
      };
    });

    try {
      await runDownloads(items);
    } catch (e: any) {
      console.error('Lỗi khi gửi video sang downloadQueue:', e);
    }
  };

  const pendingJobsCount = jobs.filter(j => j.status === 'pending').length;
  const runningJobsCount = jobs.filter(j => j.status === 'preparing' || j.status === 'generating').length;
  const successJobsCount = successfulJobs.length;
  const errorJobsCount = jobs.filter(j => j.status === 'error').length;
  const totalJobsCount = jobs.length;
  const progressPercent = totalJobsCount > 0 ? Math.round((successJobsCount / totalJobsCount) * 100) : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0e0e0e] text-white">
      <div className="flex-1 overflow-y-auto dark-scrollbar p-6 pb-32 flex flex-col gap-6 max-w-6xl mx-auto w-full">
        
        {bannerNotice && (
          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs animate-in fade-in ${
              bannerNotice.type === 'error'
                ? 'bg-red-500/15 border-red-500/40 text-red-300'
                : bannerNotice.type === 'warning'
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-blue-500/15 border-blue-500/40 text-blue-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-base">
                {bannerNotice.type === 'error' ? 'error' : bannerNotice.type === 'warning' ? 'warning' : 'info'}
              </span>
              <span>{bannerNotice.message}</span>
            </div>
            <button
              onClick={() => setBannerNotice(null)}
              className="p-1 opacity-60 hover:opacity-100"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        )}

        {isDownloadQueueBusy && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between text-xs text-emerald-300">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
              <span>Đang tải file ở Trung tâm tải xuống... Các thao tác tải khác đang tạm khóa.</span>
            </div>
          </div>
        )}

        {/* KHU VỰC 0: CHẾ ĐỘ CHỌN ẢNH & CHIẾN LƯỢC AI */}
        <div className="bg-[#141414] border border-[#595959] rounded-2xl p-5 shadow-lg flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2 border-b border-white/5 pb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400 text-lg">auto_awesome</span>
              <span className="text-xs uppercase tracking-wider font-semibold text-white/90">
                Chế độ chọn ảnh làm video
              </span>
            </div>

            <div className="flex items-center bg-[#1c1c1c] border border-[#444] rounded-xl p-1">
              <button
                type="button"
                onClick={() => setPickMode('manual')}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                  pickMode === 'manual'
                    ? 'bg-white text-black shadow'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Thủ công
              </button>
              <button
                type="button"
                onClick={() => setPickMode('auto')}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                  pickMode === 'auto'
                    ? 'bg-white text-black shadow'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Tự động chọn
              </button>
            </div>
          </div>

          {pickMode === 'auto' && (
            <div className="flex flex-col gap-4 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-white/70">
                    Số video cần tạo (1-200):
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={targetVideoCount}
                    onChange={(e) => setTargetVideoCount(Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 1)))}
                    className="bg-[#1f1f1f] border border-[#595959] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-white font-mono"
                  />
                  <div className="flex items-center gap-1 pt-0.5">
                    {[5, 10, 15, 20, 30].map(cnt => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setTargetVideoCount(cnt)}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                          targetVideoCount === cnt
                            ? 'bg-white/20 border-white text-white font-bold'
                            : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                        }`}
                      >
                        {cnt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-white/70 flex items-center justify-between">
                    <span>Giới hạn ngân sách credit:</span>
                    <input
                      type="checkbox"
                      checked={useBudgetCap}
                      onChange={(e) => setUseBudgetCap(e.target.checked)}
                      className="accent-white cursor-pointer"
                    />
                  </label>
                  <input
                    type="number"
                    min={1}
                    disabled={!useBudgetCap}
                    value={maxBudgetInput}
                    onChange={(e) => setMaxBudgetInput(e.target.value)}
                    placeholder={`Mặc định: ${currentRemainingCredits}`}
                    className="bg-[#1f1f1f] border border-[#595959] disabled:opacity-30 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-white font-mono"
                  />
                  {wasReducedByBudget && (
                    <span className="text-[10px] text-amber-300 font-mono">
                      ⚠️ Giảm còn {effectiveTargetCount} video (do ngân sách)
                    </span>
                  )}
                </div>

                {/* Chiến lược chọn ảnh */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-white/70 flex items-center justify-between">
                    <span>Chiến lược chọn ảnh:</span>
                    {autoStrategy === 'ai' && (
                      <span className="text-[10px] text-emerald-400 font-mono">0 credit AI</span>
                    )}
                  </label>
                  <select
                    value={autoStrategy}
                    onChange={(e) => setAutoStrategy(e.target.value as AutoPickStrategy)}
                    className="bg-[#1f1f1f] border border-[#595959] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-white"
                  >
                    <option value="ai">AI chọn (đa dạng + dễ chuyển động)</option>
                    <option value="balanced">Cân bằng (cục bộ)</option>
                    <option value="coverage">Phủ đều cốt truyện</option>
                    <option value="top">Điểm cao nhất</option>
                  </select>
                  <span className="text-[10px] text-white/40">
                    {autoStrategy === 'ai'
                      ? 'AI chấm độ nét, chủ thể, tiềm năng chuyển động; điểm cuối = 0.6×AI + 0.4×cục bộ'
                      : autoStrategy === 'balanced'
                      ? 'Nửa đều theo mạch truyện, nửa chọn ảnh nét nhất (chấm cục bộ)'
                      : autoStrategy === 'coverage'
                      ? 'Chia đều timeline kịch bản thành K đoạn'
                      : 'Lấy các ảnh chất lượng tốt nhất, giãn cách vị trí'}
                  </span>
                </div>

                <div className="flex flex-col justify-between gap-2">
                  <div className="flex flex-col gap-1 text-[11px]">
                    <label className="flex items-center gap-1.5 cursor-pointer text-white/80">
                      <input
                        type="checkbox"
                        checked={keepFirstLast}
                        onChange={(e) => setKeepFirstLast(e.target.checked)}
                        className="accent-white cursor-pointer"
                      />
                      <span>Luôn gồm cảnh đầu và cuối</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-white/80">
                      <input
                        type="checkbox"
                        checked={dedupeEnabled}
                        onChange={(e) => setDedupeEnabled(e.target.checked)}
                        className="accent-white cursor-pointer"
                      />
                      <span>Loại ảnh gần giống nhau (dHash)</span>
                    </label>
                  </div>

                  {scoringProgress.isRunning ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 py-1.5 px-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between font-mono">
                        <span className="flex items-center gap-1.5 truncate">
                          <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                          <span className="truncate">{scoringProgress.text}</span>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCancelScoring}
                        className="px-2.5 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 text-xs font-medium"
                      >
                        Huỷ
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRunAutoPick}
                      disabled={completedScenes.length === 0}
                      className="w-full py-2 rounded-xl bg-white hover:bg-gray-200 text-black text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                      <span>{selectedSceneIds.size > 0 ? 'Chọn lại tự động' : 'Chọn tự động'}</span>
                    </button>
                  )}
                </div>

              </div>

              {autoSummaryNotice && (
                <div className="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-xl flex items-center justify-between text-xs text-emerald-200 animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-emerald-400">task_alt</span>
                    <span className="font-mono font-medium">{autoSummaryNotice}</span>
                  </div>
                  <button onClick={() => setAutoSummaryNotice(null)} className="opacity-60 hover:opacity-100">
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              )}

              <div className="p-3 bg-black/40 border border-white/5 rounded-xl flex items-center justify-between flex-wrap gap-2 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-400 text-base">check_circle</span>
                  <span>
                    Đã chọn <b className="text-white">{selectedSceneIds.size}/{completedScenes.length}</b> ảnh
                    {effectiveTargetCount > completedScenes.length && (
                      <span className="text-amber-300 text-[11px] ml-1">
                        (Mục tiêu {effectiveTargetCount} video &gt; {completedScenes.length} ảnh: tự nhân bản biến thể cho ảnh điểm cao)
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-white/70">
                  <span>Ước tính: <b className="text-emerald-300">{totalCreditsNeeded} credit</b></span>
                  <span>•</span>
                  <span>Còn lại: <b className={creditsAfterRun < 0 ? 'text-red-400 font-bold' : 'text-white'}>{creditsAfterRun}</b></span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* KHU VỰC A: ẢNH NGUỒN */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-white/60 text-lg">image</span>
              <span className="text-xs uppercase tracking-wider font-semibold text-white/70">
                1. Danh sách ảnh nguồn ({completedScenes.length} ảnh)
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-white/80">
                {selectedSceneIds.size} đã chọn
              </span>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs text-white/70 select-none">
                <input
                  type="checkbox"
                  checked={filterOnlySelected}
                  onChange={(e) => setFilterOnlySelected(e.target.checked)}
                  className="accent-white cursor-pointer"
                />
                <span>Chỉ hiện ảnh đã chọn ({selectedSceneIds.size})</span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={completedScenes.length === 0}
                  className="px-2.5 py-1 text-[11px] rounded-lg border border-[#595959] hover:bg-white/10 disabled:opacity-40 transition-colors"
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selectedSceneIds.size === 0}
                  className="px-2.5 py-1 text-[11px] rounded-lg border border-[#595959] hover:bg-white/10 disabled:opacity-40 transition-colors"
                >
                  Bỏ chọn
                </button>
              </div>
            </div>
          </div>

          {completedScenes.length === 0 ? (
            <div className="p-8 border border-dashed border-[#595959] rounded-2xl flex flex-col items-center justify-center gap-2 text-center bg-[#141414]">
              <span className="material-symbols-outlined text-3xl text-white/30">photo_library</span>
              <p className="text-xs text-white/60 font-medium">Chưa có cảnh nào tạo ảnh thành công.</p>
              <p className="text-[11px] text-white/40">
                Vui lòng qua tab <b>Prompt Editor</b> và <b>Batch Processing</b> để tạo ảnh trước khi chuyển sang làm video.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {displayedScenes.map(scene => {
                const isSelected = selectedSceneIds.has(scene.id);
                const displaySrc = `data:image/jpeg;base64,${scene.result?.thumbBase64 || scene.result?.base64}`;
                const diffRatio = scene.aspectRatio !== settings.aspect;
                const sceneNum = sceneNumberMap.get(scene.id) || 1;
                const pickOrder = selectedOrderMap.get(scene.id);
                const customVariant = customVariantsMap[scene.id];

                const aiItem = aiScores.get(scene.id);
                const locItem = localScores.get(scene.id);
                const displayScore = finalScoreMap.get(scene.id) ?? (aiItem?.score || locItem?.score);

                return (
                  <div
                    key={scene.id}
                    onClick={() => toggleSelectScene(scene.id)}
                    className={`relative rounded-xl border overflow-hidden cursor-pointer bg-[#141414] group transition-all select-none flex flex-col ${
                      isSelected
                        ? 'border-white shadow-[0_0_12px_rgba(255,255,255,0.2)]'
                        : 'border-[#444] opacity-60 hover:opacity-100 hover:border-[#777]'
                    }`}
                  >
                    <div className="aspect-video relative bg-black flex items-center justify-center overflow-hidden">
                      <img
                        src={displaySrc}
                        alt={scene.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />

                      <div className="absolute top-2 left-2 z-10">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="w-4 h-4 accent-white cursor-pointer rounded"
                        />
                      </div>

                      {isSelected && pickOrder !== undefined && (
                        <div className="absolute top-2 left-8 z-10 px-1.5 py-0.5 rounded bg-emerald-500 text-black text-[9px] font-mono font-bold shadow">
                          #{pickOrder}
                        </div>
                      )}

                      {displayScore !== undefined && (
                        <div
                          className={`absolute bottom-2 left-2 z-10 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold backdrop-blur-md border ${
                            displayScore >= 70
                              ? 'bg-emerald-500/80 text-black border-emerald-400'
                              : displayScore >= 45
                              ? 'bg-amber-500/80 text-black border-amber-400'
                              : 'bg-red-500/80 text-white border-red-400'
                          }`}
                          title={`Điểm kết hợp: ${displayScore}/100${aiItem?.isAiRated ? ` (AI: ${aiItem.score}, Cục bộ: ${locItem?.score ?? 'N/A'})` : ' (dùng điểm cục bộ)'}`}
                        >
                          ★ {displayScore}
                        </div>
                      )}

                      {customVariant && customVariant > 1 && (
                        <div className="absolute bottom-2 right-2 z-10 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[9px] font-mono font-bold shadow">
                          {customVariant} videos
                        </div>
                      )}

                      <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-mono text-white/80">
                        Cảnh #{sceneNum}
                      </div>
                    </div>

                    <div className="p-2 flex flex-col gap-1 bg-[#181818] flex-1 justify-between">
                      <div>
                        <span className="text-[10px] font-medium text-white truncate block" title={scene.title}>
                          {scene.title}
                        </span>

                        {aiItem?.reason ? (
                          <p
                            className="text-[9px] text-amber-300/90 leading-tight truncate mt-0.5 font-sans"
                            title={aiItem.reason}
                          >
                            💡 {aiItem.reason}
                          </p>
                        ) : aiItem?.error ? (
                          <p className="text-[9px] text-white/40 italic leading-tight mt-0.5 truncate" title={aiItem.error}>
                            dùng điểm cục bộ
                          </p>
                        ) : null}
                      </div>

                      <div className="flex items-center justify-between text-[9px] font-mono text-white/40 pt-1 border-t border-white/5">
                        <span>{scene.aspectRatio}</span>
                        {diffRatio && (
                          <span className="text-amber-400/90 text-[8px]" title={`Ảnh tỷ lệ ${scene.aspectRatio} sẽ được cắt giữa thành ${settings.aspect}`}>
                            Cắt {settings.aspect}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* KHU VỰC B: CÀI ĐẶT VIDEO & CHIẾN LƯỢC CAMERA / STYLE */}
        <div className="flex flex-col gap-4 bg-[#141414] border border-[#595959] rounded-2xl p-5 shadow-lg">
          <div className="flex items-center gap-2 border-b border-white/5 pb-3">
            <span className="material-symbols-outlined text-white/60 text-lg">tune</span>
            <span className="text-xs uppercase tracking-wider font-semibold text-white/70">
              2. Cài đặt video & Chiến lược chuyển động
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            
            {/* Model */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-white/60 flex items-center justify-between">
                <span>Model AI</span>
                <span className="text-white/40 font-mono text-[10px]">
                  {costPerVideo} credit / video
                </span>
              </label>
              <select
                value={settings.model}
                disabled={isProcessing}
                onChange={(e) => handleModelChange(e.target.value as VideoModelId)}
                className="bg-[#1f1f1f] border border-[#595959] hover:border-[#888] focus:border-white rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition-colors disabled:opacity-40"
              >
                {VIDEO_MODELS.map(m => {
                  const mCost = estimateVideoCredits(m.id, settings.resolution, settings.durationSeconds, 1);
                  return (
                    <option key={m.id} value={m.id}>
                      {m.label} · {mCost} credit
                    </option>
                  );
                })}
              </select>
              <p className="text-[10px] text-white/40 italic">
                {currentModelConfig.note}
              </p>
            </div>

            {/* Độ dài */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-white/60">
                Độ dài video
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {currentModelConfig.durations.map(sec => (
                  <button
                    key={sec}
                    type="button"
                    disabled={isProcessing}
                    onClick={() => setSettings(s => ({ ...s, durationSeconds: sec }))}
                    className={`py-2 rounded-xl text-xs font-mono font-medium transition-all disabled:opacity-40 ${
                      settings.durationSeconds === sec
                        ? 'bg-white text-black shadow'
                        : 'bg-[#1f1f1f] border border-[#595959] text-white/70 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>

            {/* Độ phân giải */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-white/60">
                Độ phân giải
              </label>
              <div className="grid grid-cols-2 gap-2">
                {currentModelConfig.resolutions.map(res => (
                  <button
                    key={res}
                    type="button"
                    disabled={isProcessing}
                    onClick={() => setSettings(s => ({ ...s, resolution: res }))}
                    className={`py-2 rounded-xl text-xs font-mono font-medium transition-all disabled:opacity-40 ${
                      settings.resolution === res
                        ? 'bg-white text-black shadow'
                        : 'bg-[#1f1f1f] border border-[#595959] text-white/70 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            {/* Tỷ lệ */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-white/60">
                Tỷ lệ khung hình (Aspect)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['16:9', '9:16'] as VideoAspect[]).map(ar => (
                  <button
                    key={ar}
                    type="button"
                    disabled={isProcessing}
                    onClick={() => setSettings(s => ({ ...s, aspect: ar }))}
                    className={`py-2 rounded-xl text-xs font-mono font-medium transition-all disabled:opacity-40 ${
                      settings.aspect === ar
                        ? 'bg-white text-black shadow'
                        : 'bg-[#1f1f1f] border border-[#595959] text-white/70 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {ar} {ar === '16:9' ? '(Ngang)' : '(Dọc)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Biến thể */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-white/60">
                Số biến thể mỗi cảnh (1-4)
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map(num => (
                  <button
                    key={num}
                    type="button"
                    disabled={isProcessing}
                    onClick={() => {
                      setSettings(s => ({ ...s, variants: num }));
                      setCustomVariantsMap({});
                    }}
                    className={`py-2 rounded-xl text-xs font-mono font-medium transition-all disabled:opacity-40 ${
                      settings.variants === num
                        ? 'bg-white text-black shadow'
                        : 'bg-[#1f1f1f] border border-[#595959] text-white/70 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Phong cách (Style) & Tuỳ chọn xoay vòng */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-white/60">
                  Phong cách (Style)
                </label>
                <label className="flex items-center gap-1 cursor-pointer text-[10px] text-white/70 select-none">
                  <input
                    type="checkbox"
                    checked={cycleStylesEnabled}
                    onChange={(e) => setCycleStylesEnabled(e.target.checked)}
                    className="accent-white cursor-pointer"
                  />
                  <span>Xoay vòng kiểu</span>
                </label>
              </div>

              {!cycleStylesEnabled ? (
                <select
                  value={settings.styleId}
                  disabled={isProcessing}
                  onChange={(e) => setSettings(s => ({ ...s, styleId: e.target.value }))}
                  className="bg-[#1f1f1f] border border-[#595959] hover:border-[#888] focus:border-white rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition-colors disabled:opacity-40"
                >
                  {STYLE_PRESETS.map(preset => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex flex-wrap gap-1 p-2 bg-[#1b1b1b] border border-[#444] rounded-xl max-h-28 overflow-y-auto dark-scrollbar">
                  {STYLE_PRESETS.filter(s => s.id !== 'none').map(st => {
                    const isTicked = cycledStyleIds.includes(st.id);
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => toggleCycleStyle(st.id)}
                        className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                          isTicked
                            ? 'bg-white text-black border-white font-medium'
                            : 'bg-white/5 text-white/50 border-white/10 hover:text-white'
                        }`}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* CHIẾN LƯỢC CAMERA */}
            <div className="flex flex-col gap-2 md:col-span-2 lg:col-span-3 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="text-[11px] font-medium text-white/80 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-amber-400">videocam</span>
                  <span>Chiến lược Camera cho các video:</span>
                </label>

                <select
                  value={cameraStrategy}
                  disabled={isProcessing}
                  onChange={(e) => {
                    const nextStrat = e.target.value as CameraStrategy;
                    setCameraStrategy(nextStrat);
                    const updatedMap: Record<string, string> = {};
                    activeSelectedScenes.forEach((s, idx) => {
                      if (nextStrat === 'fixed') {
                        updatedMap[s.id] = settings.cameraId;
                      } else if (nextStrat === 'ai') {
                        const aiCam = aiScores.get(s.id)?.camera;
                        updatedMap[s.id] = aiCam || resolveSceneCamera(s.id, idx);
                      } else {
                        updatedMap[s.id] = resolveSceneCamera(s.id, idx);
                      }
                    });
                    setSceneCameraMap(prev => ({ ...prev, ...updatedMap }));
                  }}
                  className="bg-[#1f1f1f] border border-[#595959] hover:border-[#888] focus:border-white rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none transition-colors disabled:opacity-40 font-medium"
                >
                  <option value="fixed">Một kiểu cố định</option>
                  <option value="cycle">Xoay vòng giữa các kiểu đã tick</option>
                  <option value="ai">AI chọn theo ảnh (tự động)</option>
                </select>
              </div>

              {cameraStrategy === 'fixed' && (
                <div className="flex flex-col gap-1">
                  <select
                    value={settings.cameraId}
                    disabled={isProcessing}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSettings(s => ({ ...s, cameraId: val }));
                      const updated: Record<string, string> = {};
                      activeSelectedScenes.forEach(s => {
                        updated[s.id] = val;
                      });
                      setSceneCameraMap(prev => ({ ...prev, ...updated }));
                    }}
                    className="bg-[#1f1f1f] border border-[#595959] hover:border-[#888] focus:border-white rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition-colors disabled:opacity-40"
                  >
                    {CAMERA_PRESETS.map(cam => (
                      <option key={cam.id} value={cam.id}>
                        {cam.label} {cam.text ? `(${cam.text})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {cameraStrategy === 'cycle' && (
                <div className="flex flex-col gap-1.5 p-3 bg-[#181818] border border-[#333] rounded-xl">
                  <span className="text-[10px] text-white/50">
                    Tick các kiểu camera muốn xoay vòng lần lượt theo thứ tự cảnh:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {CAMERA_PRESETS.filter(c => c.id !== 'none').map(cam => {
                      const isTicked = cycledCameraIds.includes(cam.id);
                      return (
                        <button
                          key={cam.id}
                          type="button"
                          onClick={() => toggleCycleCamera(cam.id)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors flex items-center gap-1 ${
                            isTicked
                              ? 'bg-white text-black border-white font-medium'
                              : 'bg-white/5 text-white/50 border-white/10 hover:text-white'
                          }`}
                        >
                          {isTicked && <span className="material-symbols-outlined text-[13px]">check</span>}
                          <span>{cam.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {cameraStrategy === 'ai' && (
                <div className="p-3 bg-[#181818] border border-[#333] rounded-xl flex items-center justify-between text-xs text-white/70">
                  <span>
                    🤖 AI sẽ tự phân tích phối cảnh ảnh để chọn camera tốt nhất (ví dụ: chân dung → Push-in, phong cảnh rộng → Drone / Pan). Cảnh nào thiếu AI sẽ xoay vòng.
                  </span>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* KHU VỰC C: THIẾT LẬP PROMPT & CAMERA TỪNG CẢNH */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-white/60 text-lg">videocam</span>
              <span className="text-xs uppercase tracking-wider font-semibold text-white/70">
                3. Thiết lập Motion Prompt & Camera từng cảnh ({activeSelectedScenes.length} cảnh)
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {motionSuggestingState.isRunning ? (
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-1 text-xs">
                  <span className="material-symbols-outlined text-amber-400 text-sm animate-spin">progress_activity</span>
                  <span className="text-amber-200 font-mono text-[11px]">
                    Gợi ý {motionSuggestingState.current}/{motionSuggestingState.total}
                  </span>
                  <button
                    type="button"
                    onClick={handleStopMotionSuggestion}
                    className="ml-1 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] font-medium transition-colors"
                  >
                    Dừng
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleSuggestAllMotion}
                  disabled={activeSelectedScenes.length === 0 || isProcessing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-sm">auto_awesome</span>
                  <span>Gợi ý chuyển động bằng AI ({activeSelectedScenes.length})</span>
                </button>
              )}

              <span className="text-[11px] text-white/40">
                Tổng video: <b className="text-white font-mono">{totalVideosToMake}</b>
              </span>
            </div>
          </div>

          {activeSelectedScenes.length === 0 ? (
            <div className="p-6 border border-[#333] rounded-2xl bg-[#141414] text-center text-xs text-white/40">
              Chưa chọn cảnh nào ở bước 1. Hãy tích chọn ít nhất 1 ảnh nguồn ở trên hoặc bấm "Chọn tự động".
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {activeSelectedScenes.map((scene, sceneIdx) => {
                const baseMotion = localMotionPrompts[scene.id] !== undefined
                  ? localMotionPrompts[scene.id]
                  : defaultMotionPrompt(scene);

                const currentCam = sceneCameraMap[scene.id] || settings.cameraId || 'none';
                let sceneStyle = settings.styleId;
                if (cycleStylesEnabled && cycledStyleIds.length > 0) {
                  sceneStyle = cycledStyleIds[sceneIdx % cycledStyleIds.length];
                }

                const finalPrompt = composeMotionPrompt(baseMotion, sceneStyle, currentCam);
                const displaySrc = `data:image/jpeg;base64,${scene.result?.thumbBase64 || scene.result?.base64}`;
                const sceneNum = sceneNumberMap.get(scene.id) || 1;
                const sceneErr = motionErrors[scene.id];
                const aiItem = aiScores.get(scene.id);

                return (
                  <div
                    key={scene.id}
                    className="bg-[#141414] border border-[#595959] rounded-xl p-4 flex flex-col md:flex-row gap-4 hover:border-[#888] transition-colors"
                  >
                    <div className="w-full md:w-36 flex-shrink-0 flex flex-col gap-1.5">
                      <div className="aspect-video bg-black rounded-lg overflow-hidden border border-white/10 relative">
                        <img
                          src={displaySrc}
                          alt={scene.title}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-mono text-white/80">
                          #{sceneNum}
                        </div>
                      </div>
                      <span className="text-[11px] font-medium text-white truncate" title={scene.title}>
                        {scene.title}
                      </span>

                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-white/40 uppercase font-semibold">Camera cảnh:</span>
                        <select
                          value={currentCam}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSceneCameraMap(prev => ({ ...prev, [scene.id]: val }));
                          }}
                          className="bg-[#1f1f1f] border border-[#444] rounded-lg px-1.5 py-1 text-[11px] text-amber-300 focus:outline-none"
                        >
                          {CAMERA_PRESETS.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {aiItem?.reason && (
                        <p className="text-[9px] text-amber-300/80 leading-tight italic truncate" title={aiItem.reason}>
                          💡 {aiItem.reason}
                        </p>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col gap-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-[11px] font-medium text-white/70">
                          Motion Prompt (hành động, bối cảnh):
                        </span>
                        
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleSuggestSingleMotion(scene)}
                            disabled={motionSuggestingState.isRunning || isProcessing}
                            className="flex items-center gap-1 text-[10px] text-amber-300 hover:text-amber-200 px-2 py-0.5 rounded bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 transition-colors disabled:opacity-40"
                          >
                            <span className="material-symbols-outlined text-[13px]">auto_awesome</span>
                            <span>Gợi ý AI</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleMotionPromptChange(scene.id, 'Subtle natural motion bringing the scene to life.')}
                            className="text-[10px] text-white/40 hover:text-white/80 transition-colors"
                          >
                            Mặc định
                          </button>
                        </div>
                      </div>

                      <textarea
                        value={baseMotion}
                        onChange={(e) => handleMotionPromptChange(scene.id, e.target.value)}
                        placeholder="Miêu tả chuyển động của nhân vật, camera hoặc bối cảnh (người dùng vẫn sửa được)..."
                        className="w-full bg-[#1b1b1b] border border-[#444] rounded-lg p-2.5 text-xs text-white/90 focus:outline-none focus:border-white resize-none font-mono"
                        rows={2}
                      />

                      {sceneErr && (
                        <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 flex items-center justify-between">
                          <span className="truncate mr-2 font-mono">Lỗi gợi ý: {sceneErr}</span>
                          <button
                            type="button"
                            onClick={() => handleSuggestSingleMotion(scene)}
                            className="text-[9px] text-red-300 underline hover:text-white flex-shrink-0"
                          >
                            Thử lại
                          </button>
                        </div>
                      )}

                      <div className="bg-black/40 border border-white/5 rounded-lg p-2 flex flex-col gap-1">
                        <span className="text-[9px] text-white/40 uppercase font-semibold tracking-wider">
                          Prompt cuối sẽ gửi cho AI:
                        </span>
                        <p className="text-[11px] text-emerald-300 font-mono break-words leading-relaxed">
                          {finalPrompt}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* KHU VỰC D: TIẾN TRÌNH & DANH SÁCH JOBS TẠO VIDEO */}
        {jobs.length > 0 && (
          <div className="flex flex-col gap-4 bg-[#141414] border border-[#595959] rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between flex-wrap gap-2 border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-white/60 text-lg">format_list_bulleted</span>
                <span className="text-xs uppercase tracking-wider font-semibold text-white/70">
                  4. Hàng đợi Video Jobs ({jobs.length} jobs)
                </span>
                <span className="text-[11px] font-mono text-white/50">
                  {successJobsCount} xong • {errorJobsCount} lỗi • {pendingJobsCount} chờ
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isProcessing ? (
                  <>
                    <button
                      type="button"
                      onClick={handleTogglePause}
                      className="px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/10 text-xs font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">
                        {isPaused ? 'play_arrow' : 'pause'}
                      </span>
                      <span>{isPaused ? 'Resume' : 'Pause'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleStop}
                      className="px-3 py-1.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">stop</span>
                      <span>Stop sau video này</span>
                    </button>
                  </>
                ) : (
                  <>
                    {pendingJobsCount > 0 && (
                      <button
                        type="button"
                        onClick={() => processQueue()}
                        disabled={isImageGenerating}
                        className="px-3 py-1.5 rounded-xl bg-white text-black hover:bg-gray-200 text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-sm">play_arrow</span>
                        <span>Tiếp tục chạy ({pendingJobsCount})</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleClearCompletedJobs}
                      className="px-2.5 py-1.5 rounded-xl border border-[#595959] hover:bg-white/10 text-[11px] text-white/60 hover:text-white transition-colors"
                    >
                      Xóa danh sách
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-white/50 font-mono">
                <span>Tiến trình hoàn thành</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-400 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 max-h-96 overflow-y-auto dark-scrollbar pr-1">
              {jobs.map(job => {
                const isSuccess = job.status === 'success';
                const isError = job.status === 'error';
                const isGenerating = job.status === 'generating' || job.status === 'preparing';

                return (
                  <div
                    key={job.id}
                    className="p-3 rounded-xl border border-white/10 bg-[#191919] flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`material-symbols-outlined text-base flex-shrink-0 ${
                          isSuccess
                            ? 'text-emerald-400'
                            : isError
                            ? 'text-red-400'
                            : isGenerating
                            ? 'text-indigo-400 animate-spin'
                            : 'text-white/30'
                        }`}
                      >
                        {isSuccess
                          ? 'check_circle'
                          : isError
                          ? 'error'
                          : isGenerating
                          ? 'progress_activity'
                          : 'schedule'}
                      </span>

                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-white truncate max-w-[200px]" title={job.title}>
                            #{job.sceneNumber}. {job.title}
                          </span>
                          <span className="text-[10px] font-mono text-white/40">
                            v{job.variant} • {job.model} • {job.durationSeconds}s • {job.aspect} • {job.creditEstimate}c
                          </span>
                        </div>

                        {job.retryInfo && (
                          <span className="text-[10px] text-amber-300 italic">
                            {job.retryInfo}
                          </span>
                        )}

                        {job.errorMessage && (
                          <span className="text-[10px] text-red-400 font-mono break-words">
                            Lỗi: {job.errorMessage}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${
                          isSuccess
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : isError
                            ? 'bg-red-500/20 text-red-400'
                            : isGenerating
                            ? 'bg-indigo-500/20 text-indigo-300'
                            : 'bg-white/5 text-white/40'
                        }`}
                      >
                        {job.status}
                      </span>

                      {isError && (
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => handleRetryJob(job)}
                          className="px-2.5 py-1 text-[11px] rounded-lg border border-red-500/40 hover:bg-red-500/20 text-red-300 transition-colors disabled:opacity-40"
                        >
                          Thử lại
                        </button>
                      )}

                      {!isGenerating && (
                        <button
                          type="button"
                          onClick={() => handleDeleteJob(job.id)}
                          className="p-1 text-white/40 hover:text-white transition-colors"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* KHU VỰC E: THƯ VIỆN VIDEO ĐÃ TẠO */}
        {successfulJobs.length > 0 && (
          <div className="flex flex-col gap-4 bg-[#141414] border border-[#595959] rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between flex-wrap gap-2 border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-white/60 text-lg">movie</span>
                <span className="text-xs uppercase tracking-wider font-semibold text-white/70">
                  5. Thư viện Video đã tạo ({successfulJobs.length} video)
                </span>
                <span className="text-[11px] font-mono text-white/40">
                  ({selectedVideoJobIds.size} đã chọn)
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set<string>();
                    successfulJobs.forEach(j => next.add(j.id));
                    setSelectedVideoJobIds(next);
                  }}
                  disabled={isDownloadQueueBusy}
                  className="px-2.5 py-1 text-[11px] rounded-lg border border-[#595959] hover:bg-white/10 transition-colors disabled:opacity-40"
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedVideoJobIds(new Set())}
                  disabled={isDownloadQueueBusy}
                  className="px-2.5 py-1 text-[11px] rounded-lg border border-[#595959] hover:bg-white/10 transition-colors disabled:opacity-40"
                >
                  Bỏ chọn
                </button>
                <button
                  type="button"
                  disabled={isDownloadQueueBusy || selectedVideoJobIds.size === 0}
                  onClick={() => {
                    const targets = successfulJobs.filter(j => selectedVideoJobIds.has(j.id));
                    handleDownloadVideosViaQueue(targets);
                  }}
                  className="px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/10 text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  <span>Download selected ({selectedVideoJobIds.size})</span>
                </button>
                <button
                  type="button"
                  disabled={isDownloadQueueBusy || successfulJobs.length === 0}
                  onClick={() => handleDownloadVideosViaQueue(successfulJobs)}
                  className="px-3 py-1.5 rounded-xl bg-white text-black hover:bg-gray-200 text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-sm">download_for_offline</span>
                  <span>Download all ({successfulJobs.length})</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {successfulJobs.map(job => {
                const isChecked = selectedVideoJobIds.has(job.id);
                const mbSize = job.result?.bytes ? (job.result.bytes / (1024 * 1024)).toFixed(1) : '1.0';

                return (
                  <div
                    key={job.id}
                    className={`rounded-2xl border overflow-hidden bg-[#181818] flex flex-col transition-all group ${
                      isChecked
                        ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.15)]'
                        : 'border-[#444] hover:border-[#777]'
                    }`}
                  >
                    <div className="relative bg-black flex items-center justify-center overflow-hidden aspect-video">
                      <video
                        controls
                        muted
                        loop
                        preload="metadata"
                        src={job.result?.blobUrl}
                        className="w-full h-full object-cover"
                      />

                      <div className="absolute top-2.5 left-2.5 z-10 pointer-events-auto">
                        <label className="flex items-center justify-center w-6 h-6 rounded-lg bg-black/70 border border-white/20 hover:border-white/60 cursor-pointer backdrop-blur-sm transition-colors">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setSelectedVideoJobIds(prev => {
                                const next = new Set(prev);
                                if (next.has(job.id)) next.delete(job.id);
                                else next.add(job.id);
                                return next;
                              });
                            }}
                            className="w-3.5 h-3.5 accent-white cursor-pointer"
                          />
                        </label>
                      </div>

                      <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => handleDownloadVideosViaQueue([job])}
                          disabled={isDownloadQueueBusy}
                          className="w-7 h-7 rounded-lg bg-black/70 border border-white/20 hover:bg-white/20 flex items-center justify-center text-white backdrop-blur-sm transition-colors disabled:opacity-40"
                          title="Tải video này"
                        >
                          <span className="material-symbols-outlined text-[16px]">download</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteJob(job.id)}
                          className="w-7 h-7 rounded-lg bg-black/70 border border-white/20 hover:bg-red-500/30 flex items-center justify-center text-red-400 backdrop-blur-sm transition-colors"
                          title="Xóa video khỏi tool"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>
                    </div>

                    <div className="p-3 flex flex-col gap-1.5 bg-[#161616]">
                      <span className="text-[11px] font-medium text-white truncate" title={job.title}>
                        #{job.sceneNumber}. {job.title} (v{job.variant})
                      </span>
                      <p className="text-[10px] text-white/50 font-mono truncate">
                        {job.model} • {job.durationSeconds}s • {job.resolution} • {job.aspect} • {mbSize} MB • {job.creditEstimate} credit
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* THANH ĐIỀU KHIỂN CỐ ĐỊNH Ở DƯỚI */}
      <div className="fixed bottom-0 left-[60px] right-0 bg-[#121212]/95 backdrop-blur-md border-t border-[#595959] px-6 py-3 z-30 flex items-center justify-between flex-wrap gap-4 shadow-2xl">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-mono text-white/90">
              <b>{totalVideosToMake}</b> video × <b>{costPerVideo}</b> credit ={' '}
              <b className={`text-sm ${isOverBudget ? 'text-red-400 font-bold' : 'text-emerald-300'}`}>
                {totalCreditsNeeded} credit
              </b>
            </span>
            <span className="text-white/30">•</span>
            <span className="font-mono text-white/70">
              Credit còn lại: <b>{currentRemainingCredits}</b>
              {!usageState.calibrated && (
                <span className="text-amber-400 ml-1 font-sans text-[11px]" title="Chưa hiệu chỉnh với Flow">
                  (chưa hiệu chỉnh)
                </span>
              )}
            </span>
            <span className="text-white/30">→</span>
            <span className={`font-mono font-medium ${isOverBudget ? 'text-red-400' : 'text-white'}`}>
              sau khi chạy: <b>{creditsAfterRun}</b>
            </span>
          </div>

          {isOverBudget && (
            <p className="text-[10px] text-red-400 font-medium">
              ⚠️ Số credit cần ({totalCreditsNeeded}) vượt quá số dư hiện tại ({currentRemainingCredits}). Vui lòng giảm số cảnh hoặc chọn Omni 360p.
            </p>
          )}

          {isImageGenerating && (
            <p className="text-[10px] text-amber-400 font-medium">
              ⚠️ Batch tạo ảnh đang chạy. Bạn có thể thiết lập thông số nhưng cần đợi batch tạo ảnh dừng trước khi tạo video.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={
              isProcessing ||
              isImageGenerating ||
              totalVideosToMake === 0 ||
              isOverBudget
            }
            onClick={handleStartGeneration}
            title={
              isImageGenerating
                ? 'Batch tạo ảnh đang chạy'
                : isOverBudget
                ? 'Vượt quá credit còn lại'
                : undefined
            }
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-xs select-none shadow transition-all ${
              confirmPending
                ? 'bg-amber-500 hover:bg-amber-400 text-black font-bold animate-pulse'
                : 'bg-white hover:bg-gray-200 active:bg-gray-300 text-black disabled:bg-white/20 disabled:text-white/40 disabled:cursor-not-allowed'
            }`}
          >
            <span className="material-symbols-outlined text-base">
              {confirmPending ? 'warning' : 'movie_creation'}
            </span>
            <span>
              {confirmPending
                ? 'Click again to confirm (3s)'
                : isProcessing
                ? `Đang tạo video (${runningJobsCount}/${totalJobsCount})...`
                : `Tạo video (${totalVideosToMake})`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
