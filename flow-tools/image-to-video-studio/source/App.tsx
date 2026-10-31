import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Flow } from 'flow-sdk';
import { Scene, BatchSettings, BatchState, AspectRatio, VideoJob } from './types';
import { parseScenes, detectSeparator } from './services/parser';
import { upscaleImage, makeThumbnail } from './services/image';
import {
  UsageState,
  initUsageState,
  rolloverUsage,
  recordImage,
  recordVideoCredits,
  calibrateCredits,
  setTodayImages,
  resetTodayImages,
  updateSettings as updateUsageSettings,
  imagesLeftToday,
  creditsLeft,
} from './services/usage';
import {
  DownloadItem,
  isDownloadBusy,
  subscribe as subscribeDownloads,
  runDownloads,
  resetRunTag,
  buildImageDownloadFilename,
} from './services/downloadQueue';
import {
  isPolicyBlockError,
  buildImagePrompt,
  rewritePromptForPolicy,
} from './services/safety';
import { SectionLabel, PillButton, FieldDropdown, DragNumberField } from './components/Primitives';
import { ImageEditor } from './components/ImageEditor';
import { VideoStudio } from './components/VideoStudio';
import { ScriptSplitter } from './components/ScriptSplitter';
import { DownloadCenter } from './components/DownloadCenter';

const MODELS = ['🍌 Nano Banana 2.1', '🍌 Nano Banana Pro', '🍌 Nano Banana 2 Lite'];
const DEFAULT_MODEL = '🍌 Nano Banana 2.1';
const RATIOS: AspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const RESOLUTIONS = ['Full HD', '2K', '4K'] as const;

/** Helper để encode chuỗi Unicode sang base64 một cách an toàn không dùng window.btoa trực tiếp trên chuỗi utf-16 */
function unicodeToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/** Format byte size to readable text (e.g. 0.8 MB) */
function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0.0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

/** Format mime type readable label */
function formatMimeLabel(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'JPEG';
  if (mimeType.includes('png')) return 'PNG';
  if (mimeType.includes('webp')) return 'WEBP';
  return mimeType.split('/')[1]?.toUpperCase() || 'IMG';
}

/** Check if error is transient / temporary */
function isTransientError(msg: string): boolean {
  const lower = msg.toLowerCase();
  const transientTokens = [
    'tạm thời không hoạt động',
    'unavailable',
    'busy',
    'overloaded',
    'rate limit',
    'timed out',
    'timeout',
    'failed to fetch',
    'network'
  ];
  return transientTokens.some(token => lower.includes(token));
}

/** Check if error indicates quota or credit limit exhausted */
function isQuotaError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('quota') || lower.includes('credit');
}

/** Check if error is safety/policy violation */
function isSafetyError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('safety') || lower.includes('policy') || lower.includes('blocked');
}

export default function App() {
  // Usage State: hoàn toàn trong bộ nhớ của phiên
  const [usageState, setUsageState] = useState<UsageState>(() => initUsageState());
  const usageStateRef = useRef<UsageState>(usageState);
  usageStateRef.current = usageState;

  // Usage Adjustment Panel open/close
  const [showUsageAdjust, setShowUsageAdjust] = useState(false);
  const [customDailyCap, setCustomDailyCap] = useState(String(usageState.dailyImageCap));
  const [customMonthlyBudget, setCustomMonthlyBudget] = useState(String(usageState.monthlyCreditBudget));
  const [customResetDay, setCustomResetDay] = useState(String(usageState.cycleResetDay));
  const [calibrateInput, setCalibrateInput] = useState(String(creditsLeft(usageState)));
  const [manualImagesInput, setManualImagesInput] = useState(String(usageState.imageCount));

  // Thông báo phiên (Lưu/Mở phiên)
  const [sessionNotice, setSessionNotice] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const sessionFileInputRef = useRef<HTMLInputElement>(null);

  const [inputText, setInputText] = useState('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const scenesRef = useRef<Scene[]>(scenes);
  scenesRef.current = scenes;

  const [activeTab, setActiveTab] = useState<'input' | 'batch' | 'video' | 'gallery' | 'download'>('input');
  
  // Settings
  const [settings, setSettings] = useState<BatchSettings>({
    modelDisplayName: DEFAULT_MODEL,
    aspectRatio: '16:9',
    resolution: 'Full HD',
    delaySeconds: 1,
  });

  // Batch Control
  const [batch, setBatch] = useState<BatchState>({
    isRunning: false,
    isPaused: false,
    completedInRun: 0,
    totalInRun: 0,
  });

  // Shared generation flag for single or batch image runs
  const [isGenerating, setIsGenerating] = useState(false);

  // Cờ báo hiệu VideoStudio đang chạy tạo video để vô hiệu hoá batch tạo ảnh
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);

  // Danh sách video jobs dùng chung cho VideoStudio và DownloadCenter
  const [sharedVideoJobs, setSharedVideoJobs] = useState<VideoJob[]>([]);

  // 2-step confirmation for Regenerate All button
  const [confirmRegenAll, setConfirmRegenAll] = useState(false);
  const regenTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Gallery Selection State
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(new Set());

  // Trạng thái bận của hàng đợi tải singleton
  const [isDownloadQueueBusy, setIsDownloadQueueBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeDownloads(prog => {
      setIsDownloadQueueBusy(prog.isBusy);
    });
    return unsub;
  }, []);

  // UI State
  const [editingImage, setEditingImage] = useState<null | { sceneId: string; base64: string; mimeType: string; name: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotaStopNotice, setQuotaStopNotice] = useState<string | null>(null);
  const stopBatchRef = useRef(false);
  const pauseBatchRef = useRef(false);

  // Helper to record image in usage state
  const handleRecordImage = (success: boolean, model: string) => {
    const nextState = recordImage(usageStateRef.current, success, model);
    usageStateRef.current = nextState;
    setUsageState(nextState);
  };

  // Helper to record video credits in usage state
  const handleRecordVideoCredits = (credits: number, model: string, note?: string) => {
    const nextState = recordVideoCredits(usageStateRef.current, credits, model, note);
    usageStateRef.current = nextState;
    setUsageState(nextState);
  };

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .animate-dropdown { animation: dropdown-enter 0.15s ease-out forwards; }
      @keyframes dropdown-enter { from { opacity: 0; transform: scale(0.95) translateY(-5px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      .dark-scrollbar { scrollbar-width: thin; scrollbar-color: #595959 transparent; }
      .dark-scrollbar::-webkit-scrollbar { width: 6px; }
      .dark-scrollbar::-webkit-scrollbar-thumb { background: #595959; border-radius: 10px; }
      @keyframes pulse-white { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      .animate-pulse-white { animation: pulse-white 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
    `;
    document.head.appendChild(style);
  }, []);

  // Handler: Lưu phiên ra file JSON qua Flow.download
  const handleSaveSession = async () => {
    try {
      setSessionNotice(null);
      const now = new Date();
      const YYYY = now.getFullYear();
      const MM = String(now.getMonth() + 1).padStart(2, '0');
      const DD = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const filename = `batch-session_${YYYY}${MM}${DD}_${hh}${mm}.json`;

      const sessionPayload = {
        version: 1,
        savedAt: now.toISOString(),
        inputText,
        settings,
        scenes: scenes.map(s => ({
          title: s.title,
          prompt: s.prompt,
          negativePrompt: s.negativePrompt,
          aspectRatio: s.aspectRatio,
          motionPrompt: s.motionPrompt,
          originalPrompt: s.originalPrompt,
          safetyNote: s.safetyNote,
        })),
        usage: usageStateRef.current,
      };

      const jsonString = JSON.stringify(sessionPayload, null, 2);
      const base64 = unicodeToBase64(jsonString);

      await Flow.download({
        base64,
        mimeType: 'application/json',
        filename,
      });

      setSessionNotice({
        message: `Đã lưu phiên thành công vào file "${filename}"!`,
        type: 'success',
      });
    } catch (err: any) {
      setSessionNotice({
        message: `Lỗi khi lưu phiên: ${err?.message || 'Không thể tạo file tải về'}`,
        type: 'error',
      });
    }
  };

  // Handler: Mở phiên từ file JSON
  const handleOpenSessionFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSessionNotice(null);

    try {
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('File không phải định dạng JSON hợp lệ.');
      }

      if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
        throw new Error('Định dạng phiên không tương thích (cần file phiên version 1).');
      }

      if (typeof parsed.inputText === 'string') {
        setInputText(parsed.inputText);
      }

      if (parsed.settings && typeof parsed.settings === 'object') {
        const safeModel = MODELS.includes(parsed.settings.modelDisplayName) ? parsed.settings.modelDisplayName : DEFAULT_MODEL;
        const safeAR = RATIOS.includes(parsed.settings.aspectRatio) ? parsed.settings.aspectRatio : '16:9';
        const safeRes = RESOLUTIONS.includes(parsed.settings.resolution) ? parsed.settings.resolution : 'Full HD';
        const safeDelay = typeof parsed.settings.delaySeconds === 'number' && parsed.settings.delaySeconds >= 0 ? parsed.settings.delaySeconds : 1;

        setSettings({
          modelDisplayName: safeModel,
          aspectRatio: safeAR as AspectRatio,
          resolution: safeRes as any,
          delaySeconds: safeDelay,
        });
      }

      let restoredScenesCount = 0;
      if (Array.isArray(parsed.scenes)) {
        const restored: Scene[] = parsed.scenes.map((s: any, idx: number) => ({
          id: crypto.randomUUID(),
          title: typeof s.title === 'string' ? s.title : `Scene ${idx + 1}`,
          prompt: typeof s.prompt === 'string' ? s.prompt : '',
          negativePrompt: typeof s.negativePrompt === 'string' ? s.negativePrompt : undefined,
          aspectRatio: RATIOS.includes(s.aspectRatio) ? (s.aspectRatio as AspectRatio) : '16:9',
          motionPrompt: typeof s.motionPrompt === 'string' ? s.motionPrompt : undefined,
          originalPrompt: typeof s.originalPrompt === 'string' ? s.originalPrompt : undefined,
          safetyNote: typeof s.safetyNote === 'string' ? s.safetyNote : undefined,
          status: 'pending',
        }));
        setScenes(restored);
        restoredScenesCount = restored.length;
        setSelectedSceneIds(new Set());
      }

      if (parsed.usage && typeof parsed.usage === 'object') {
        const restoredUsage: UsageState = {
          version: 1,
          calibrated: true,
          dailyImageCap: typeof parsed.usage.dailyImageCap === 'number' && parsed.usage.dailyImageCap > 0 ? parsed.usage.dailyImageCap : 1000,
          imageDate: typeof parsed.usage.imageDate === 'string' ? parsed.usage.imageDate : usageStateRef.current.imageDate,
          imageCount: typeof parsed.usage.imageCount === 'number' && parsed.usage.imageCount >= 0 ? parsed.usage.imageCount : 0,
          imageFailed: typeof parsed.usage.imageFailed === 'number' && parsed.usage.imageFailed >= 0 ? parsed.usage.imageFailed : 0,
          monthlyCreditBudget: typeof parsed.usage.monthlyCreditBudget === 'number' && parsed.usage.monthlyCreditBudget >= 0 ? parsed.usage.monthlyCreditBudget : 6000,
          creditBaseline: typeof parsed.usage.creditBaseline === 'number' && parsed.usage.creditBaseline >= 0 ? parsed.usage.creditBaseline : 6000,
          creditSpent: typeof parsed.usage.creditSpent === 'number' && parsed.usage.creditSpent >= 0 ? parsed.usage.creditSpent : 0,
          cycleResetDay: typeof parsed.usage.cycleResetDay === 'number' && parsed.usage.cycleResetDay >= 1 && parsed.usage.cycleResetDay <= 28 ? parsed.usage.cycleResetDay : 1,
          cycleStartDate: typeof parsed.usage.cycleStartDate === 'string' ? parsed.usage.cycleStartDate : usageStateRef.current.cycleStartDate,
          log: Array.isArray(parsed.usage.log) ? parsed.usage.log.slice(0, 50) : [],
        };

        const rolled = rolloverUsage(restoredUsage);
        usageStateRef.current = rolled;
        setUsageState(rolled);
        setCustomDailyCap(String(rolled.dailyImageCap));
        setCustomMonthlyBudget(String(rolled.monthlyCreditBudget));
        setCustomResetDay(String(rolled.cycleResetDay));
        setCalibrateInput(String(creditsLeft(rolled)));
        setManualImagesInput(String(rolled.imageCount));
      }

      setSessionNotice({
        message: `Đã khôi phục ${restoredScenesCount} scene và số đếm. Ảnh đã tạo không nằm trong file; ảnh gốc vẫn có trong thư viện Flow.`,
        type: 'success',
      });
    } catch (err: any) {
      setSessionNotice({
        message: `Không thể mở file phiên: ${err?.message || 'Lỗi đọc file'}`,
        type: 'error',
      });
    } finally {
      if (sessionFileInputRef.current) {
        sessionFileInputRef.current.value = '';
      }
    }
  };

  const handleParse = () => {
    if (!inputText.trim()) return;
    try {
      const parsed = parseScenes(inputText, settings.aspectRatio);
      setScenes(parsed);
      setSelectedSceneIds(new Set());
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to parse scenes');
    }
  };

  /** Callback áp dụng cảnh tạo từ AI Script Splitter */
  const handleApplyAIScenes = (newAIScenes: Scene[], mode: 'replace' | 'append') => {
    if (mode === 'replace') {
      setScenes(newAIScenes);
      setSelectedSceneIds(new Set());
    } else {
      setScenes(prev => [...prev, ...newAIScenes]);
    }
  };

  const updateScene = (id: string, updates: Partial<Scene>) => {
    setScenes(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  /** Change Aspect Ratio from Right Panel: updates settings and non-success scenes */
  const handleAspectRatioChange = (newRatio: AspectRatio) => {
    setSettings(prev => ({ ...prev, aspectRatio: newRatio }));
    setScenes(prev => prev.map(s => {
      if (s.status !== 'success') {
        return { ...s, aspectRatio: newRatio };
      }
      return s;
    }));
  };

  /** Interruptible wait respecting pause and stop flags */
  const interruptibleWait = async (durationMs: number): Promise<boolean> => {
    const step = 200;
    let elapsed = 0;
    while (elapsed < durationMs) {
      if (stopBatchRef.current) return false;
      while (pauseBatchRef.current && !stopBatchRef.current) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (stopBatchRef.current) return false;
      await new Promise(r => setTimeout(r, Math.min(step, durationMs - elapsed)));
      elapsed += step;
    }
    return !stopBatchRef.current;
  };

  /**
   * Core generator function for a single scene có thang xử lý chính sách (policyLevel a->b->c):
   */
  const executeSceneGeneration = async (scene: Scene): Promise<{ success: boolean; isQuotaError?: boolean; capReached?: boolean }> => {
    if (usageStateRef.current.imageCount >= usageStateRef.current.dailyImageCap) {
      const capMsg = `Đã chạm hạn mức ${usageStateRef.current.dailyImageCap} ảnh hôm nay (do tool đếm). Tăng hạn mức trong mục Usage nếu Flow vẫn cho phép.`;
      setQuotaStopNotice(capMsg);
      updateScene(scene.id, { status: 'pending', retryInfo: undefined });
      return { success: false, capReached: true };
    }

    const maxRetries = 2;
    const retryDelays = [8000, 20000];
    let attempt = 0;

    let policyLevel = 0;
    let currentWorkingPrompt = scene.prompt;
    let safePromptForSave: string | undefined = undefined;

    while (true) {
      if (stopBatchRef.current) {
        updateScene(scene.id, { status: 'pending', retryInfo: undefined });
        return { success: false };
      }

      while (pauseBatchRef.current && !stopBatchRef.current) {
        await new Promise(r => setTimeout(r, 300));
      }
      if (stopBatchRef.current) {
        updateScene(scene.id, { status: 'pending', retryInfo: undefined });
        return { success: false };
      }

      updateScene(scene.id, { 
        status: 'generating', 
        errorMessage: undefined, 
      });

      const promptForTry = buildImagePrompt(currentWorkingPrompt, scene.negativePrompt, policyLevel);

      try {
        const generatePromise = Flow.generate.image({
          prompt: promptForTry,
          aspectRatio: scene.aspectRatio,
          modelDisplayName: settings.modelDisplayName
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Request timed out (180s)')), 180000);
        });

        const result = await Promise.race([generatePromise, timeoutPromise]);

        // Record successful generation in usage
        handleRecordImage(true, settings.modelDisplayName);

        // Chuẩn bị cập nhật prompt và safetyNote nếu đã qua thang chính sách
        const scenePatch: Partial<Scene> = {
          errorMessage: undefined,
          retryInfo: undefined,
        };

        if (policyLevel === 1) {
          scenePatch.safetyNote = 'Đã bỏ negative để qua bộ lọc';
        } else if (policyLevel >= 2 && safePromptForSave) {
          scenePatch.originalPrompt = scene.originalPrompt || scene.prompt;
          scenePatch.prompt = safePromptForSave;
          scenePatch.safetyNote = policyLevel === 2
            ? 'AI đã chỉnh prompt cho an toàn (lần 1)'
            : 'AI đã chỉnh prompt cho an toàn (lần 2)';
        }

        // Upscale and save result
        updateScene(scene.id, { status: 'upscaling', ...scenePatch });
        try {
          const upscaled = await upscaleImage(result.base64, result.mimeType, settings.resolution, scene.aspectRatio);
          const bytes = Math.round(upscaled.base64.length * 0.75);

          updateScene(scene.id, { 
            status: 'success', 
            ...scenePatch,
            result: { 
              base64: upscaled.base64, 
              thumbBase64: upscaled.thumbBase64,
              mimeType: 'image/jpeg',
              mediaId: result.mediaId,
              width: upscaled.width,
              height: upscaled.height,
              bytes: bytes
            } 
          });
        } catch (upscaleErr) {
          updateScene(scene.id, {
            status: 'success',
            ...scenePatch,
            result: {
              base64: result.base64,
              thumbBase64: undefined,
              mimeType: result.mimeType || 'image/jpeg',
              mediaId: result.mediaId,
              bytes: Math.round(result.base64.length * 0.75)
            }
          });
        }

        return { success: true };
      } catch (err: any) {
        const rawMsg = err?.message || 'Generation failed';

        // 1. Quota error -> dừng ngay
        if (isQuotaError(rawMsg)) {
          if (!stopBatchRef.current) {
            handleRecordImage(false, settings.modelDisplayName);
          }
          updateScene(scene.id, { status: 'error', errorMessage: 'Hết hạn mức tạo ảnh - đã dừng batch', retryInfo: undefined });
          return { success: false, isQuotaError: true };
        }

        // 2. Thang xử lý chính sách / an toàn (KHÔNG tính vào maxRetries lỗi tạm thời, KHÔNG ghi nhận handleRecordImage(false))
        if (isPolicyBlockError(rawMsg)) {
          if (policyLevel === 0) {
            // Bước a: thử lại ngay bỏ Avoid
            policyLevel = 1;
            updateScene(scene.id, {
              retryInfo: 'Bị chặn vì chính sách → thử lại không kèm negative',
            });
            await new Promise(r => setTimeout(r, 600));
            continue;
          }

          if (policyLevel === 1) {
            // Bước b: AI viết lại prompt lần 1
            policyLevel = 2;
            updateScene(scene.id, {
              retryInfo: 'Bị chặn → AI đang chỉnh prompt cho đúng quy định (1/2)',
            });
            try {
              const rewritten = await rewritePromptForPolicy(scene.prompt, 1);
              currentWorkingPrompt = rewritten;
              safePromptForSave = rewritten;
              updateScene(scene.id, {
                retryInfo: 'Đã chỉnh prompt (1/2) → đang thử tạo lại...',
              });
              await new Promise(r => setTimeout(r, 600));
              continue;
            } catch (rewriteErr: any) {
              const rwMsg = rewriteErr?.message || 'Lỗi chỉnh prompt';
              updateScene(scene.id, {
                status: 'error',
                errorMessage: `Bị chặn vì chính sách. AI không thể chỉnh prompt: ${rwMsg}`,
                retryInfo: undefined,
              });
              return { success: false };
            }
          }

          if (policyLevel === 2) {
            // Bước c: AI viết lại prompt lần 2 (bảo thủ hơn)
            policyLevel = 3;
            updateScene(scene.id, {
              retryInfo: 'Bị chặn → AI đang chỉnh prompt cho đúng quy định (2/2)',
            });
            try {
              const rewritten = await rewritePromptForPolicy(currentWorkingPrompt, 2);
              currentWorkingPrompt = rewritten;
              safePromptForSave = rewritten;
              updateScene(scene.id, {
                retryInfo: 'Đã chỉnh prompt (2/2) → đang thử tạo lại...',
              });
              await new Promise(r => setTimeout(r, 600));
              continue;
            } catch (rewriteErr: any) {
              const rwMsg = rewriteErr?.message || 'Lỗi chỉnh prompt';
              updateScene(scene.id, {
                status: 'error',
                errorMessage: `Bị chặn vì chính sách. AI không thể chỉnh prompt: ${rwMsg}`,
                retryInfo: undefined,
              });
              return { success: false };
            }
          }

          // Bước d: đã thử 2 lần chỉnh prompt mà vẫn bị chặn
          updateScene(scene.id, {
            status: 'error',
            errorMessage: 'Bị chặn vì chính sách sau 2 lần AI chỉnh prompt. Sửa prompt tay rồi bấm tạo lại.',
            retryInfo: undefined,
          });
          return { success: false };
        }

        // 3. Nếu rơi vào isSafetyError khác mà không bắt bởi isPolicyBlockError
        if (isSafetyError(rawMsg)) {
          updateScene(scene.id, { status: 'error', errorMessage: rawMsg, retryInfo: undefined });
          return { success: false };
        }

        // 4. Lỗi tạm thời (transient error)
        if (!stopBatchRef.current) {
          handleRecordImage(false, settings.modelDisplayName);
        }

        if (isTransientError(rawMsg) && attempt < maxRetries) {
          const nextWaitSec = Math.round(retryDelays[attempt] / 1000);
          updateScene(scene.id, { 
            retryInfo: `Retrying (${attempt + 1}/${maxRetries}) in ${nextWaitSec}s` 
          });

          const ok = await interruptibleWait(retryDelays[attempt]);
          if (!ok) {
            updateScene(scene.id, { status: 'pending', retryInfo: undefined });
            return { success: false };
          }
          attempt++;
          continue;
        }

        const finalMsg = isTransientError(rawMsg)
          ? 'Flow đang quá tải, đã tự thử lại 2 lần. Bấm Retry failed sau ít phút.'
          : rawMsg;

        updateScene(scene.id, { status: 'error', errorMessage: finalMsg, retryInfo: undefined });
        return { success: false };
      }
    }
  };

  /**
   * Run batch targeting scenes
   */
  const startBatch = async (mode: 'uncompleted' | 'all' | 'failed' = 'uncompleted') => {
    try {
      if (isVideoGenerating) {
        setError('Video Studio đang tạo video. Vui lòng đợi hoặc dừng tạo video trước khi chạy batch ảnh.');
        return;
      }

      setError(null);
      setQuotaStopNotice(null);

      if (usageStateRef.current.imageCount >= usageStateRef.current.dailyImageCap) {
        setQuotaStopNotice(`Đã chạm hạn mức ${usageStateRef.current.dailyImageCap} ảnh hôm nay (do tool đếm). Tăng hạn mức trong mục Usage nếu Flow vẫn cho phép.`);
        return;
      }

      stopBatchRef.current = false;
      pauseBatchRef.current = false;
      setActiveTab('batch');

      let targetIds: string[] = [];

      if (mode === 'all') {
        setScenes(prev => prev.map(s => ({ ...s, status: 'pending', errorMessage: undefined, retryInfo: undefined })));
        targetIds = scenesRef.current.map(s => s.id);
      } else if (mode === 'failed') {
        targetIds = scenesRef.current.filter(s => s.status === 'error').map(s => s.id);
      } else {
        targetIds = scenesRef.current.filter(s => s.status === 'pending' || s.status === 'error').map(s => s.id);
      }

      if (targetIds.length === 0) return;

      setIsGenerating(true);
      setBatch({
        isRunning: true,
        isPaused: false,
        completedInRun: 0,
        totalInRun: targetIds.length,
      });

      for (let i = 0; i < targetIds.length; i++) {
        if (stopBatchRef.current) break;

        if (usageStateRef.current.imageCount >= usageStateRef.current.dailyImageCap) {
          setQuotaStopNotice(`Đã chạm hạn mức ${usageStateRef.current.dailyImageCap} ảnh hôm nay (do tool đếm). Tăng hạn mức trong mục Usage nếu Flow vẫn cho phép.`);
          break;
        }

        while (pauseBatchRef.current && !stopBatchRef.current) {
          await new Promise(r => setTimeout(r, 500));
        }
        if (stopBatchRef.current) break;

        const currentId = targetIds[i];
        // Luôn lấy scene mới nhất từ state (qua scenesRef) theo id thay cho bản chụp cũ
        const currentTarget = scenesRef.current.find(s => s.id === currentId);
        if (!currentTarget) continue;

        const res = await executeSceneGeneration(currentTarget);

        setBatch(prev => ({ ...prev, completedInRun: i + 1 }));

        if (res.capReached) {
          break;
        }

        if (res.isQuotaError) {
          setQuotaStopNotice('Hết hạn mức tạo ảnh - đã dừng batch. Các scene còn lại được giữ nguyên.');
          break;
        }

        if (i < targetIds.length - 1 && settings.delaySeconds > 0 && !stopBatchRef.current) {
          await interruptibleWait(settings.delaySeconds * 1000);
        }
      }
    } catch (globalErr: any) {
      setError(globalErr.message || 'Critical batch error');
    } finally {
      setIsGenerating(false);
      setBatch(prev => ({ ...prev, isRunning: false }));
    }
  };

  /** Single scene regeneration from Gallery card */
  const handleRegenerateSingle = async (scene: Scene) => {
    if (isGenerating || isVideoGenerating) return;
    setError(null);
    setQuotaStopNotice(null);

    if (usageStateRef.current.imageCount >= usageStateRef.current.dailyImageCap) {
      setQuotaStopNotice(`Đã chạm hạn mức ${usageStateRef.current.dailyImageCap} ảnh hôm nay (do tool đếm). Tăng hạn mức trong mục Usage nếu Flow vẫn cho phép.`);
      return;
    }

    stopBatchRef.current = false;
    pauseBatchRef.current = false;
    setIsGenerating(true);
    try {
      // Lấy scene mới nhất từ ref
      const freshScene = scenesRef.current.find(s => s.id === scene.id) || scene;
      updateScene(freshScene.id, { status: 'pending', errorMessage: undefined, retryInfo: undefined });
      await executeSceneGeneration(freshScene);
    } catch (err: any) {
      setError(err?.message || 'Regeneration failed');
    } finally {
      setIsGenerating(false);
    }
  };

  /** 2-step button handler for Regenerate All */
  const handleRegenerateAllClick = () => {
    if (isGenerating || isVideoGenerating) return;
    if (!confirmRegenAll) {
      setConfirmRegenAll(true);
      if (regenTimeoutRef.current) clearTimeout(regenTimeoutRef.current);
      regenTimeoutRef.current = setTimeout(() => {
        setConfirmRegenAll(false);
      }, 3000);
    } else {
      setConfirmRegenAll(false);
      if (regenTimeoutRef.current) clearTimeout(regenTimeoutRef.current);
      startBatch('all').catch(e => setError(e.message));
    }
  };

  const sceneNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    scenes.forEach((s, idx) => {
      map.set(s.id, idx + 1);
    });
    return map;
  }, [scenes]);

  const completedScenes = useMemo(() => {
    return scenes.filter(s => !!s.result);
  }, [scenes]);

  const pendingScenesCount = useMemo(() => {
    return scenes.filter(s => s.status === 'pending' || s.status === 'error').length;
  }, [scenes]);

  const failedScenesCount = useMemo(() => {
    return scenes.filter(s => s.status === 'error').length;
  }, [scenes]);

  const successScenesCount = useMemo(() => {
    return scenes.filter(s => s.status === 'success').length;
  }, [scenes]);

  // Usage derived stats
  const remainingImagesToday = imagesLeftToday(usageState);
  const remainingCredits = creditsLeft(usageState);
  const imagePercent = usageState.dailyImageCap > 0 ? (usageState.imageCount / usageState.dailyImageCap) * 100 : 0;
  const creditPercent = usageState.monthlyCreditBudget > 0 ? (remainingCredits / usageState.monthlyCreditBudget) * 100 : 0;

  const getImageProgressColor = (pct: number) => {
    if (pct >= 100) return 'bg-red-500';
    if (pct >= 80) return 'bg-amber-400';
    return 'bg-emerald-400';
  };

  const getPillBadgeColor = () => {
    if (imagePercent >= 100) return 'border-red-500/50 bg-red-500/10 text-red-400';
    if (imagePercent >= 80) return 'border-amber-400/50 bg-amber-400/10 text-amber-300';
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  };

  /**
   * Chuyển các scene thành DownloadItem và gửi tới downloadQueue singleton
   */
  const downloadScenesViaQueue = async (targetScenes: Scene[]) => {
    if (targetScenes.length === 0 || isDownloadQueueBusy) return;

    const items: DownloadItem[] = targetScenes.map(scene => {
      const sceneNum = sceneNumberMap.get(scene.id) || 1;
      const mimeType = (scene.result?.mimeType as any) || 'image/jpeg';
      const filename = buildImageDownloadFilename(sceneNum, scene.title, mimeType);
      const approxBytes = scene.result?.bytes || Math.round((scene.result?.base64?.length || 0) * 0.75);

      return {
        key: `img_${scene.id}`,
        kind: 'image',
        filename,
        mimeType,
        sceneNumber: sceneNum,
        label: `Ảnh Cảnh #${sceneNum}: ${scene.title}`,
        approxBytes,
        getBase64: async () => scene.result!.base64,
      };
    });

    try {
      await runDownloads(items);
    } catch (e: any) {
      console.error('Gallery download error:', e);
    }
  };

  const handleDownloadAllCompleted = () => {
    downloadScenesViaQueue(completedScenes);
  };

  const handleDownloadSelected = () => {
    const selected = completedScenes.filter(s => selectedSceneIds.has(s.id));
    downloadScenesViaQueue(selected);
  };

  const handleDownloadSingle = (scene: Scene) => {
    if (!scene.result) return;
    downloadScenesViaQueue([scene]);
  };

  const toggleSelectScene = (id: string) => {
    setSelectedSceneIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllCompleted = () => {
    const all = new Set<string>();
    completedScenes.forEach(s => all.add(s.id));
    setSelectedSceneIds(all);
  };

  const clearSelection = () => {
    setSelectedSceneIds(new Set());
  };

  const selectedCount = completedScenes.filter(s => selectedSceneIds.has(s.id)).length;

  const batchProgressPercent = batch.totalInRun > 0 
    ? Math.round((batch.completedInRun / batch.totalInRun) * 100) 
    : 0;

  const willExceedToday = pendingScenesCount > remainingImagesToday;

  return (
    <div className="flex h-screen w-screen bg-[#0e0e0e] text-white font-sans overflow-hidden">
      
      {/* Ẩn input file để mở phiên */}
      <input 
        ref={sessionFileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleOpenSessionFile}
      />

      {/* Left Navigation với 5 tabs: input, batch, video, gallery, download */}
      <div className="w-[60px] border-r border-[#595959] flex flex-col items-center py-6 gap-6 z-20 bg-[#0e0e0e]">
        <button
          onClick={() => setActiveTab('input')}
          className={`p-2 rounded-xl transition-colors ${activeTab === 'input' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
          title="Prompt Editor"
        >
          <span className="material-symbols-outlined">edit_note</span>
        </button>
        <button
          onClick={() => setActiveTab('batch')}
          className={`p-2 rounded-xl transition-colors ${activeTab === 'batch' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
          title="Batch Processing"
        >
          <span className="material-symbols-outlined">play_circle</span>
        </button>
        <button
          onClick={() => setActiveTab('video')}
          className={`p-2 rounded-xl transition-colors ${activeTab === 'video' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
          title="Video Studio"
        >
          <span className="material-symbols-outlined">movie</span>
        </button>
        <button
          onClick={() => setActiveTab('gallery')}
          className={`p-2 rounded-xl transition-colors ${activeTab === 'gallery' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
          title="Results Gallery"
        >
          <span className="material-symbols-outlined">photo_library</span>
        </button>
        <button
          onClick={() => setActiveTab('download')}
          className={`p-2 rounded-xl transition-colors relative ${activeTab === 'download' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
          title="Trung tâm Tải xuống"
        >
          <span className="material-symbols-outlined">download</span>
          {isDownloadQueueBusy && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          )}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Tab Header with Usage Pill Badge */}
        <div className="min-h-[60px] border-b border-[#595959] flex items-center px-6 justify-between flex-wrap gap-3 py-2 z-10 bg-[#0e0e0e]">
           <div className="flex items-center gap-3">
             <h1 className="text-sm font-medium tracking-wide uppercase opacity-60">
               {activeTab === 'input'
                 ? 'Prompt Editor'
                 : activeTab === 'batch'
                 ? 'Batch Processing'
                 : activeTab === 'video'
                 ? 'Video Studio'
                 : activeTab === 'gallery'
                 ? 'Results Gallery'
                 : 'Trung tâm Tải xuống'}
             </h1>
             {activeTab === 'gallery' && completedScenes.length > 0 && (
               <span className="text-[11px] text-white/40 font-mono">
                 ({completedScenes.length} photos)
               </span>
             )}
             {activeTab === 'video' && completedScenes.length > 0 && (
               <span className="text-[11px] text-white/40 font-mono">
                 ({completedScenes.length} ảnh nguồn)
               </span>
             )}

             {/* Pill nhỏ cố định ở thanh tiêu đề */}
             <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono transition-colors ${getPillBadgeColor()}`} title={`Hôm nay đã tạo ${usageState.imageCount}/${usageState.dailyImageCap} ảnh • Credit video: ${remainingCredits}${!usageState.calibrated ? ' (chưa hiệu chỉnh)' : ''}`}>
               <span className="material-symbols-outlined text-[13px]">analytics</span>
               <span>Ảnh {usageState.imageCount}/{usageState.dailyImageCap}</span>
               <span className="opacity-40">•</span>
               <span>Credit {remainingCredits}</span>
               {!usageState.calibrated && (
                 <span className="text-amber-400 font-bold" title="Chưa hiệu chỉnh với Flow">*</span>
               )}
             </div>

             {/* Chỉ báo trạng thái tải nếu hàng đợi đang chạy */}
             {isDownloadQueueBusy && (
               <button
                 type="button"
                 onClick={() => setActiveTab('download')}
                 className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[10px] font-medium transition-colors hover:bg-emerald-500/20"
               >
                 <span className="material-symbols-outlined text-[13px] animate-spin">progress_activity</span>
                 <span>Đang tải ở Trung tâm tải xuống</span>
               </button>
             )}
           </div>

           {activeTab === 'gallery' && completedScenes.length > 0 && (
             <div className="flex items-center gap-3 flex-wrap">
                {/* Selection controls */}
                <div className="flex items-center gap-1.5 border border-[#595959] rounded-xl p-1 bg-[#141414]">
                  <button 
                    onClick={selectedCount === completedScenes.length ? clearSelection : selectAllCompleted}
                    disabled={isDownloadQueueBusy}
                    className="px-2 py-1 text-[11px] rounded-lg text-white/80 hover:bg-white/10 disabled:opacity-40 transition-colors"
                  >
                    {selectedCount === completedScenes.length ? 'Clear' : 'Select all'}
                  </button>
                  <span className="text-[10px] text-white/40 font-mono px-1">
                    {selectedCount} selected
                  </span>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  <PillButton 
                    variant="outline" 
                    disabled={isDownloadQueueBusy || selectedCount === 0}
                    icon={<span className="material-symbols-outlined text-[18px]">download</span>} 
                    onClick={handleDownloadSelected}
                    title={isDownloadQueueBusy ? 'Đang tải ở Trung tâm tải xuống' : undefined}
                  >
                    Download selected ({selectedCount})
                  </PillButton>
                  <PillButton 
                    variant="solid" 
                    disabled={isDownloadQueueBusy || completedScenes.length === 0}
                    icon={<span className="material-symbols-outlined text-[18px]">download_for_offline</span>} 
                    onClick={handleDownloadAllCompleted}
                    title={isDownloadQueueBusy ? 'Đang tải ở Trung tâm tải xuống' : undefined}
                  >
                    Download all ({completedScenes.length})
                  </PillButton>
                </div>
             </div>
           )}
        </div>

        {/* Thông báo phiên (Lưu phiên / Mở phiên) */}
        {sessionNotice && (
          <div className="px-6 pt-4">
            <div className={`rounded-xl p-3 flex items-center justify-between text-xs border ${
              sessionNotice.type === 'success' 
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' 
                : 'bg-red-500/15 border-red-500/40 text-red-300'
            }`}>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base">
                  {sessionNotice.type === 'success' ? 'check_circle' : 'error'}
                </span>
                <span className="font-medium">{sessionNotice.message}</span>
              </div>
              <button onClick={() => setSessionNotice(null)} className="p-1 opacity-60 hover:opacity-100">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          </div>
        )}

        {/* Quota / Daily Cap Stop Banner */}
        {quotaStopNotice && (
          <div className="px-6 pt-4">
            <div className="bg-red-500/15 border border-red-500/40 rounded-xl p-3 flex items-center justify-between text-xs text-red-300">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-red-400">block</span>
                <span className="font-medium">{quotaStopNotice}</span>
              </div>
              <button onClick={() => setQuotaStopNotice(null)} className="text-red-300/60 hover:text-white p-1">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          </div>
        )}

        {/* VideoStudio Component: LUÔN ĐƯỢC MOUNT để giữ nguyên trạng thái */}
        <div className={`flex-1 h-full overflow-hidden ${activeTab === 'video' ? 'flex flex-col' : 'hidden'}`}>
          <VideoStudio
            scenes={scenes}
            usageState={usageState}
            isImageGenerating={isGenerating}
            onUpdateSceneMotionPrompt={(sceneId, motionPrompt) => updateScene(sceneId, { motionPrompt })}
            onVideoSuccess={handleRecordVideoCredits}
            onVideoGeneratingStateChange={setIsVideoGenerating}
            onJobsSync={setSharedVideoJobs}
          />
        </div>

        {/* DownloadCenter Component: LUÔN ĐƯỢC MOUNT để giữ trạng thái */}
        <div className={`flex-1 h-full overflow-hidden ${activeTab === 'download' ? 'flex flex-col' : 'hidden'}`}>
          <DownloadCenter
            scenes={scenes}
            videoJobs={sharedVideoJobs}
          />
        </div>

        {/* Vùng cuộn của 3 Tabs còn lại (input, batch, gallery) */}
        <div className={`flex-1 overflow-y-auto dark-scrollbar p-6 ${activeTab === 'video' || activeTab === 'download' ? 'hidden' : ''}`}>
          
          {/* View: Input */}
          {activeTab === 'input' && (
            <div className="max-w-4xl mx-auto flex flex-col gap-6">
               <ScriptSplitter
                 defaultAspectRatio={settings.aspectRatio}
                 onApplyScenes={handleApplyAIScenes}
                 disabled={isGenerating || isVideoGenerating}
               />

               <div className="flex flex-col gap-4">
                  <SectionLabel>Scene List / Script</SectionLabel>
                  <div className="relative group">
                    <textarea 
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Paste your scenes here..."
                      className="w-full h-[300px] bg-[#1a1a1a] border border-[#595959] rounded-2xl p-4 text-sm font-mono leading-relaxed focus:outline-none focus:border-[#969696] transition-colors resize-none placeholder:opacity-30"
                    />
                    <div className="absolute top-4 right-4 flex gap-2">
                       <input 
                         type="file" 
                         id="file-upload" 
                         className="hidden" 
                         accept=".txt,.md"
                         onChange={async (e) => {
                           try {
                             const file = e.target.files?.[0];
                             if (file) setInputText(await file.text());
                           } catch (err: any) {
                             setError(err.message);
                           }
                         }}
                       />
                       <label htmlFor="file-upload" className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs hover:bg-white/10 cursor-pointer transition-colors">
                          <span className="material-symbols-outlined text-sm">upload_file</span>
                          Import File
                       </label>
                    </div>
                  </div>
                  <PillButton variant="filled" className="w-full h-12 rounded-2xl" icon={<span className="material-symbols-outlined">splitscreen</span>} onClick={handleParse}>
                    Parse & Preview Scenes
                  </PillButton>
               </div>

               {scenes.length > 0 && (
                 <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex items-center justify-between">
                      <SectionLabel>Detected Scenes ({scenes.length})</SectionLabel>
                      <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded text-white/40 border border-white/10 italic">
                        Using {detectSeparator(inputText).name}
                      </span>
                    </div>
                    <div className="flex flex-col gap-3">
                      {scenes.map((scene, i) => (
                        <div key={scene.id} className="bg-[#1a1a1a] border border-[#595959] rounded-xl p-4 flex flex-col gap-2 group hover:border-[#969696] transition-colors">
                           <div className="flex justify-between items-start">
                             <div className="flex items-center gap-2 w-2/3">
                               <input 
                                 value={scene.title}
                                 onChange={(e) => updateScene(scene.id, { title: e.target.value })}
                                 className="bg-transparent border-none p-0 m-0 font-medium text-xs focus:outline-none w-full"
                               />
                               {scene.safetyNote && (
                                 <span 
                                   className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-mono whitespace-nowrap cursor-help flex-shrink-0"
                                   title={scene.originalPrompt ? `Prompt gốc: ${scene.originalPrompt}` : scene.safetyNote}
                                 >
                                   AI đã chỉnh prompt
                                 </span>
                               )}
                             </div>
                             <div className="flex gap-2 items-center">
                               {scene.originalPrompt && (
                                 <button
                                   type="button"
                                   onClick={() => updateScene(scene.id, {
                                     prompt: scene.originalPrompt,
                                     originalPrompt: undefined,
                                     safetyNote: undefined,
                                   })}
                                   className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/80 transition-colors"
                                   title="Khôi phục lại prompt gốc trước khi AI chỉnh"
                                 >
                                   Khôi phục prompt gốc
                                 </button>
                               )}
                               <span className="text-[10px] text-white/30 font-mono">#{i+1}</span>
                               <button onClick={() => setScenes(scenes.filter(s => s.id !== scene.id))} className="opacity-0 group-hover:opacity-100 material-symbols-outlined text-sm text-red-400">delete</button>
                             </div>
                           </div>
                           <textarea 
                             value={scene.prompt}
                             onChange={(e) => updateScene(scene.id, { prompt: e.target.value })}
                             className="bg-transparent border-none p-0 m-0 text-xs text-white/70 focus:outline-none w-full resize-none h-auto font-mono"
                             rows={2}
                             placeholder="Prompt..."
                           />
                           
                           <div className="flex items-center gap-2 pt-1">
                             <span className="text-[10px] text-white/40 uppercase tracking-tight flex-shrink-0 font-medium">Negative:</span>
                             <input
                               type="text"
                               value={scene.negativePrompt || ''}
                               onChange={(e) => updateScene(scene.id, { negativePrompt: e.target.value || undefined })}
                               placeholder="Elements to avoid (optional)..."
                               className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-[11px] text-white/70 focus:outline-none focus:border-white/30 w-full"
                             />
                           </div>

                           {scene.errorMessage && (
                             <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 mt-1 font-mono">
                                {scene.errorMessage}
                             </div>
                           )}
                           <div className="flex gap-3 pt-2 border-t border-white/5 mt-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-white/30 uppercase tracking-tighter">Aspect</span>
                                <select 
                                  value={scene.aspectRatio}
                                  onChange={(e) => updateScene(scene.id, { aspectRatio: e.target.value as AspectRatio })}
                                  className="bg-white/5 text-[10px] border-none rounded p-0.5 focus:outline-none"
                                >
                                  {RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </div>
                           </div>
                        </div>
                      ))}
                    </div>
                 </div>
               )}
            </div>
          )}

          {/* View: Batch Progress */}
          {activeTab === 'batch' && (
            <div className="max-w-4xl mx-auto flex flex-col gap-10">
               <div className="bg-[#1a1a1a] border border-[#595959] rounded-2xl p-8 flex flex-col items-center gap-8 shadow-xl">
                 <div className="flex flex-col items-center gap-2">
                    <span className="text-xs uppercase tracking-widest text-white/30 font-semibold">Current Status</span>
                    <h2 className="text-2xl font-light">
                      {batch.isRunning ? (batch.isPaused ? 'Paused' : 'Generating & Upscaling...') : 'Idle'}
                    </h2>
                 </div>

                 <div className="w-full max-w-md h-2 bg-white/5 rounded-full overflow-hidden border border-white/5 relative">
                    <div 
                      className="absolute top-0 left-0 h-full bg-white transition-all duration-500 ease-out shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                      style={{ width: `${batchProgressPercent}%` }}
                    />
                 </div>

                 <div className="grid grid-cols-3 gap-12 text-center w-full max-w-lg">
                    <div className="flex flex-col gap-1">
                      <span className="text-2xl font-light">{scenes.length}</span>
                      <span className="text-[10px] uppercase text-white/30 font-bold">Total</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-2xl font-light text-green-400">{successScenesCount}</span>
                      <span className="text-[10px] uppercase text-white/30 font-bold">Success</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-2xl font-light text-red-400">{failedScenesCount}</span>
                      <span className="text-[10px] uppercase text-white/30 font-bold">Failed</span>
                    </div>
                 </div>

                 <div className="flex flex-col items-center gap-1 text-xs">
                    <span className={willExceedToday ? 'text-amber-400 font-medium' : 'text-white/60'}>
                      Sẽ tạo {pendingScenesCount} ảnh — hôm nay còn {remainingImagesToday}
                    </span>
                    {willExceedToday && (
                      <span className="text-[11px] text-amber-400/80">
                        (Số ảnh cần tạo vượt hạn mức hôm nay {usageState.dailyImageCap})
                      </span>
                    )}
                 </div>

                 <div className="flex flex-wrap items-center justify-center gap-3">
                   {!batch.isRunning ? (
                     <>
                        <PillButton 
                          variant="solid" 
                          className="min-w-44 h-12" 
                          icon={<span className="material-symbols-outlined">play_arrow</span>} 
                          disabled={isGenerating || isVideoGenerating || pendingScenesCount === 0}
                          onClick={() => startBatch('uncompleted').catch(e => setError(e.message))}
                        >
                          Start ({pendingScenesCount} pending)
                        </PillButton>

                        <PillButton 
                          variant={confirmRegenAll ? 'danger' : 'outline'} 
                          className="min-w-44 h-12" 
                          icon={<span className="material-symbols-outlined">{confirmRegenAll ? 'warning' : 'restart_alt'}</span>} 
                          disabled={isGenerating || isVideoGenerating || scenes.length === 0}
                          onClick={handleRegenerateAllClick}
                        >
                          {confirmRegenAll ? 'Click again to confirm' : 'Regenerate all'}
                        </PillButton>

                        {failedScenesCount > 0 && (
                          <PillButton 
                            variant="outline" 
                            className="min-w-44 h-12" 
                            icon={<span className="material-symbols-outlined">replay</span>} 
                            disabled={isGenerating || isVideoGenerating}
                            onClick={() => startBatch('failed').catch(e => setError(e.message))}
                          >
                            Retry failed ({failedScenesCount})
                          </PillButton>
                        )}
                     </>
                   ) : (
                     <>
                        <PillButton 
                          variant="outline" 
                          className="w-40 h-12" 
                          icon={<span className="material-symbols-outlined">{batch.isPaused ? 'play_arrow' : 'pause'}</span>} 
                          onClick={() => {
                            pauseBatchRef.current = !pauseBatchRef.current;
                            setBatch(prev => ({ ...prev, isPaused: !prev.isPaused }));
                          }}
                        >
                          {batch.isPaused ? 'Resume' : 'Pause'}
                        </PillButton>
                        <PillButton variant="danger" className="w-40 h-12" icon={<span className="material-symbols-outlined">stop</span>} onClick={() => stopBatchRef.current = true}>
                          Stop
                        </PillButton>
                     </>
                   )}
                 </div>
               </div>

               <div className="flex flex-col gap-4">
                  <SectionLabel>Live Execution Log</SectionLabel>
                  <div className="flex flex-col gap-2">
                    {scenes.filter(s => s.status !== 'pending' || s.retryInfo).slice(-5).reverse().map(scene => (
                      <div key={scene.id} className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl animate-in fade-in slide-in-from-top-2">
                         <div className="flex items-center gap-3">
                            <span className={`material-symbols-outlined text-sm ${
                              scene.status === 'success' ? 'text-green-400' : 
                              scene.status === 'error' ? 'text-red-400' : 'animate-spin text-white/30'
                            }`}>
                              {scene.status === 'success' ? 'check_circle' : 
                               scene.status === 'error' ? 'error' : 'progress_activity'}
                            </span>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium truncate max-w-[200px]">{scene.title}</span>
                                {scene.safetyNote && (
                                  <span 
                                    className="px-1.5 py-0.2 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[9px] font-mono cursor-help"
                                    title={scene.originalPrompt ? `Prompt gốc: ${scene.originalPrompt}` : scene.safetyNote}
                                  >
                                    AI đã chỉnh prompt
                                  </span>
                                )}
                              </div>
                              <span className="text-[9px] text-white/40 uppercase">
                                {scene.retryInfo ? scene.retryInfo : scene.status === 'upscaling' ? 'Applying Lanczos...' : scene.status}
                              </span>
                            </div>
                         </div>
                         {scene.errorMessage && (
                           <span className="text-[9px] text-red-400/80 font-mono truncate max-w-[280px]" title={scene.errorMessage}>
                             {scene.errorMessage}
                           </span>
                         )}
                      </div>
                    ))}
                  </div>
               </div>
            </div>
          )}

          {/* View: Gallery */}
          {activeTab === 'gallery' && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
               {completedScenes.map(scene => {
                 const isChecked = selectedSceneIds.has(scene.id);
                 const resWidth = scene.result?.width || (scene.aspectRatio === '16:9' ? 1920 : 1080);
                 const resHeight = scene.result?.height || (scene.aspectRatio === '16:9' ? 1080 : 1920);
                 const mimeLabel = formatMimeLabel(scene.result?.mimeType || 'image/jpeg');
                 const sizeLabel = formatFileSize(scene.result?.bytes);
                 const displaySrc = `data:image/jpeg;base64,${scene.result?.thumbBase64 || scene.result?.base64}`;

                 return (
                   <div 
                     key={scene.id} 
                     className={`flex flex-col bg-[#1a1a1a] border rounded-2xl overflow-hidden group transition-all animate-in zoom-in-95 ${
                       isChecked ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.15)]' : 'border-[#595959] hover:border-[#969696]'
                     }`}
                   >
                      <div className="aspect-video relative overflow-hidden bg-black flex items-center justify-center">
                         <img 
                           src={displaySrc} 
                           alt={scene.title}
                           loading="lazy"
                           className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                         />

                         <div className="absolute top-2.5 left-2.5 z-10">
                            <label className="flex items-center justify-center w-6 h-6 rounded-lg bg-black/60 border border-white/20 hover:border-white/60 cursor-pointer backdrop-blur-sm transition-colors">
                               <input 
                                 type="checkbox"
                                 checked={isChecked}
                                 onChange={() => toggleSelectScene(scene.id)}
                                 className="w-3.5 h-3.5 accent-white cursor-pointer"
                               />
                            </label>
                         </div>

                         {scene.safetyNote && (
                           <div 
                             className="absolute bottom-2.5 left-2.5 z-10 px-2 py-0.5 rounded bg-amber-500/80 border border-amber-400 text-black text-[9px] font-mono font-bold shadow backdrop-blur-sm cursor-help"
                             title={scene.originalPrompt ? `Prompt gốc: ${scene.originalPrompt}` : scene.safetyNote}
                           >
                             AI đã chỉnh prompt
                           </div>
                         )}

                         <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleRegenerateSingle(scene)}
                              disabled={isGenerating || isVideoGenerating}
                              className="w-7 h-7 rounded-lg bg-black/60 border border-white/20 hover:bg-white/20 flex items-center justify-center text-white backdrop-blur-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Tạo lại riêng ảnh này (dùng settings hiện tại)"
                            >
                               <span className="material-symbols-outlined text-[16px]">refresh</span>
                            </button>

                            <button
                              onClick={() => handleDownloadSingle(scene)}
                              disabled={isDownloadQueueBusy}
                              className="w-7 h-7 rounded-lg bg-black/60 border border-white/20 hover:bg-white/20 flex items-center justify-center text-white backdrop-blur-sm transition-colors disabled:opacity-40"
                              title={isDownloadQueueBusy ? 'Đang tải ở Trung tâm tải xuống' : 'Tải riêng ảnh này'}
                            >
                               <span className="material-symbols-outlined text-[16px]">download</span>
                            </button>
                         </div>

                         <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                            <button 
                              onClick={() => setEditingImage({ 
                                sceneId: scene.id, 
                                base64: scene.result!.base64, 
                                mimeType: scene.result!.mimeType, 
                                name: scene.title 
                              })}
                              className="pointer-events-auto w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-110 transition-transform shadow-lg"
                              title="Chỉnh sửa ảnh (ảnh gốc full-size)"
                            >
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                         </div>
                      </div>

                      <div className="p-3 flex flex-col gap-1.5">
                         <span className="text-[10px] font-medium text-white truncate" title={scene.title}>
                           {scene.title}
                         </span>
                         
                         <div className="flex items-center justify-between">
                           <span className="text-[9px] text-white/50 tracking-wider font-mono truncate mr-1">
                             {scene.aspectRatio} • {resWidth}×{resHeight} • {mimeLabel} • {sizeLabel}
                           </span>
                           <button 
                             onClick={() => updateScene(scene.id, { result: undefined, status: 'pending' })}
                             className="text-red-400/50 hover:text-red-400 p-0.5 transition-colors flex-shrink-0"
                             title="Xoá kết quả"
                           >
                             <span className="material-symbols-outlined text-[15px]">delete</span>
                           </button>
                         </div>
                      </div>
                   </div>
                 );
               })}
            </div>
          )}

        </div>
      </div>

      {/* Right Panel */}
      <div className="w-[310px] border-l border-[#595959] flex flex-col justify-between bg-[#0e0e0e] h-full overflow-hidden">
        
        {/* Scrollable Upper Area */}
        <div className="flex-1 overflow-y-auto dark-scrollbar p-[12px] flex flex-col gap-[20px]">
          
          {/* 1. Generator Settings */}
          <div className="flex flex-col gap-2 w-full">
            <SectionLabel>Generator Settings</SectionLabel>
            <div className="flex flex-col gap-1.5">
              <FieldDropdown 
                label="Model" 
                value={settings.modelDisplayName} 
                options={MODELS} 
                onChange={(v) => setSettings(s => ({ ...s, modelDisplayName: v }))} 
              />
              <div className="flex gap-1">
                <FieldDropdown 
                  label="Aspect Ratio" 
                  value={settings.aspectRatio} 
                  options={RATIOS} 
                  onChange={(v) => handleAspectRatioChange(v as AspectRatio)} 
                  className="flex-1"
                />
                <FieldDropdown 
                  label="Resolution (Lanczos)" 
                  value={settings.resolution} 
                  options={Array.from(RESOLUTIONS)} 
                  onChange={(v) => setSettings(s => ({ ...s, resolution: v as any }))} 
                  className="flex-1"
                />
              </div>
              <DragNumberField 
                label="Batch Delay" 
                value={settings.delaySeconds} 
                min={0} max={60} suffix="s" 
                onChange={(v) => setSettings(s => ({ ...s, delaySeconds: v }))} 
              />
            </div>
          </div>

          {/* 2. Batch Stats */}
          <div className="flex flex-col gap-2 w-full">
            <SectionLabel>Batch Stats</SectionLabel>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col gap-2.5">
               <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/40">
                  <span>Queue Size</span>
                  <span className="text-white">{scenes.length}</span>
               </div>
               <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/40">
                  <span>Generated</span>
                  <span className="text-white">{successScenesCount}</span>
               </div>
               <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/40">
                  <span>Pending / Error</span>
                  <span className="text-amber-400/90">{pendingScenesCount}</span>
               </div>
               <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-white/40 transition-all duration-300" 
                    style={{ width: `${scenes.length > 0 ? (successScenesCount / scenes.length) * 100 : 0}%` }}
                  />
               </div>
            </div>
          </div>

          {/* 3. Usage Card */}
          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center justify-between">
              <SectionLabel>Usage Tracker</SectionLabel>
              <button 
                onClick={() => {
                  setCustomDailyCap(String(usageState.dailyImageCap));
                  setCustomMonthlyBudget(String(usageState.monthlyCreditBudget));
                  setCustomResetDay(String(usageState.cycleResetDay));
                  setCalibrateInput(String(creditsLeft(usageState)));
                  setManualImagesInput(String(usageState.imageCount));
                  setShowUsageAdjust(!showUsageAdjust);
                }}
                className="text-[10px] text-white/70 hover:text-white px-2 py-0.5 rounded-lg border border-white/20 hover:border-white/40 transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[12px]">tune</span>
                <span>{showUsageAdjust ? 'Đóng' : 'Điều chỉnh'}</span>
              </button>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col gap-3">
              
              {/* Hai nút Lưu phiên / Mở phiên bằng file JSON */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleSaveSession}
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-white/10 hover:bg-white/15 border border-white/20 rounded-xl text-[11px] font-medium text-white transition-colors cursor-pointer"
                  title="Tải toàn bộ kịch bản, cấu hình và số đếm về máy thành file JSON"
                >
                  <span className="material-symbols-outlined text-[15px]">file_download</span>
                  <span>Lưu phiên</span>
                </button>
                <button
                  type="button"
                  onClick={() => sessionFileInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-white/10 hover:bg-white/15 border border-white/20 rounded-xl text-[11px] font-medium text-white transition-colors cursor-pointer"
                  title="Khôi phục kịch bản, cấu hình và số đếm từ file JSON đã lưu"
                >
                  <span className="material-symbols-outlined text-[15px]">file_upload</span>
                  <span>Mở phiên</span>
                </button>
              </div>

              {/* (1) Ảnh hôm nay */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-white/60">Ảnh hôm nay:</span>
                  <span className="font-mono text-white font-medium">
                    {usageState.imageCount} / {usageState.dailyImageCap}
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ${getImageProgressColor(imagePercent)}`}
                    style={{ width: `${Math.min(100, imagePercent)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-white/40 font-mono">
                  <span>Còn {remainingImagesToday} ảnh</span>
                  <span>Lỗi hôm nay: {usageState.imageFailed}</span>
                </div>
              </div>

              {/* (2) Credit video kèm trạng thái hiệu chỉnh */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
                <div className="flex justify-between items-center text-[11px]">
                  <div className="flex items-center gap-1">
                    <span className="text-white/60">Credit video:</span>
                    {!usageState.calibrated && (
                      <span className="text-[10px] text-amber-400 font-medium">
                        (chưa hiệu chỉnh)
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-white font-medium">
                    {remainingCredits} / {usageState.monthlyCreditBudget}
                  </span>
                </div>

                {!usageState.calibrated && (
                  <p className="text-[10px] text-amber-400/90 leading-tight">
                    Nhập số credit còn lại ở góc trên phải Flow rồi bấm Hiệu chỉnh.
                  </p>
                )}

                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-400 transition-all duration-300"
                    style={{ width: `${Math.min(100, creditPercent)}%` }}
                  />
                </div>
                <div className="text-[10px] text-white/40 font-mono">
                  Đã dùng qua tool: {usageState.creditSpent}
                </div>
              </div>

              {/* (3) Khu chỉnh sửa nếu bấm "Điều chỉnh" */}
              {showUsageAdjust && (
                <div className="pt-3 border-t border-white/10 flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-1">
                  
                  {/* Ô đặt tay số ảnh đã tạo hôm nay */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-white/50">Số ảnh đã tạo hôm nay:</label>
                    <div className="flex gap-1.5">
                      <input 
                        type="number"
                        min={0}
                        max={100000}
                        value={manualImagesInput}
                        onChange={(e) => setManualImagesInput(e.target.value)}
                        className="flex-1 bg-[#141414] border border-[#595959] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-white/50 font-mono"
                      />
                      <button 
                        type="button"
                        onClick={() => {
                          const val = parseInt(manualImagesInput, 10);
                          if (!isNaN(val) && val >= 0) {
                            const next = setTodayImages(usageStateRef.current, val);
                            usageStateRef.current = next;
                            setUsageState(next);
                          }
                        }}
                        className="px-2.5 py-1 text-[10px] bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        Đặt
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-white/50">Hạn mức ảnh / ngày:</label>
                    <input 
                      type="number"
                      min={1}
                      max={100000}
                      value={customDailyCap}
                      onChange={(e) => setCustomDailyCap(e.target.value)}
                      onBlur={() => {
                        const val = parseInt(customDailyCap, 10);
                        if (!isNaN(val) && val > 0) {
                          const next = updateUsageSettings(usageStateRef.current, { dailyImageCap: val });
                          usageStateRef.current = next;
                          setUsageState(next);
                        }
                      }}
                      className="bg-[#141414] border border-[#595959] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-white/50 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-white/50">Credit / tháng:</label>
                      <input 
                        type="number"
                        min={0}
                        value={customMonthlyBudget}
                        onChange={(e) => setCustomMonthlyBudget(e.target.value)}
                        onBlur={() => {
                          const val = parseInt(customMonthlyBudget, 10);
                          if (!isNaN(val) && val >= 0) {
                            const next = updateUsageSettings(usageStateRef.current, { monthlyCreditBudget: val });
                            usageStateRef.current = next;
                            setUsageState(next);
                          }
                        }}
                        className="bg-[#141414] border border-[#595959] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-white/50 font-mono"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-white/50">Ngày reset (1-28):</label>
                      <input 
                        type="number"
                        min={1}
                        max={28}
                        value={customResetDay}
                        onChange={(e) => setCustomResetDay(e.target.value)}
                        onBlur={() => {
                          const val = parseInt(customResetDay, 10);
                          if (!isNaN(val) && val >= 1 && val <= 28) {
                            const next = updateUsageSettings(usageStateRef.current, { cycleResetDay: val });
                            usageStateRef.current = next;
                            setUsageState(next);
                          }
                        }}
                        className="bg-[#141414] border border-[#595959] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-white/50 font-mono"
                      />
                    </div>
                  </div>

                  <button 
                    type="button"
                    onClick={() => {
                      const next = resetTodayImages(usageStateRef.current);
                      usageStateRef.current = next;
                      setUsageState(next);
                      setManualImagesInput('0');
                    }}
                    className="w-full py-1 text-[10px] border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 rounded-lg transition-colors"
                  >
                    Reset đếm ảnh hôm nay về 0
                  </button>

                  <div className="flex flex-col gap-1 pt-1">
                    <label className="text-[10px] text-white/50">Credit còn lại hiện tại trên Flow:</label>
                    <div className="flex gap-1.5">
                      <input 
                        type="number"
                        min={0}
                        value={calibrateInput}
                        onChange={(e) => setCalibrateInput(e.target.value)}
                        className="flex-1 bg-[#141414] border border-[#595959] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-white/50 font-mono"
                      />
                      <button 
                        type="button"
                        onClick={() => {
                          const val = parseInt(calibrateInput, 10);
                          if (!isNaN(val) && val >= 0) {
                            const next = calibrateCredits(usageStateRef.current, val);
                            usageStateRef.current = next;
                            setUsageState(next);
                          }
                        }}
                        className="px-2.5 py-1 text-[10px] bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        Hiệu chỉnh
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* (4) Ghi chú lưu trữ phiên */}
              <div className="pt-2 border-t border-white/5 flex items-start gap-1.5 text-[10px] text-white/60">
                <span className="material-symbols-outlined text-[13px] text-amber-400 mt-0.5 flex-shrink-0">info</span>
                <span>
                  Số đếm chỉ lưu trong phiên này (Flow xoá bộ nhớ của tool mỗi lần tải lại). Dùng Lưu phiên / Mở phiên để giữ lại.
                </span>
              </div>

              {/* (5) Ghi chú nhỏ */}
              <p className="text-[9px] text-white/40 leading-relaxed border-t border-white/5 pt-2">
                Chỉ đếm hoạt động của tool này, không gồm ảnh/video tạo trực tiếp trên Flow hay thiết bị khác. Số dư thật xem ở góc trên phải của Flow. Hạn mức ảnh/ngày do bạn tự đặt (Google không công bố).
              </p>
            </div>
          </div>

        </div>

        {/* Sticky Bottom Actions */}
        <div className="p-[12px] border-t border-white/10 flex flex-col gap-2 bg-[#0e0e0e] flex-shrink-0">
           <div className="flex justify-between items-center text-[10px] px-1 font-mono">
             <span className={willExceedToday ? 'text-amber-400 font-medium' : 'text-white/60'}>
               Sẽ tạo {pendingScenesCount} ảnh — hôm nay còn {remainingImagesToday}
             </span>
             {willExceedToday && (
               <span className="text-amber-400 font-bold">⚠️ Vượt cap</span>
             )}
           </div>

           <PillButton 
             variant="outline" 
             className="w-full" 
             icon={<span className="material-symbols-outlined text-[18px]">clear_all</span>}
             onClick={() => {
               setScenes([]);
               setInputText('');
               setActiveTab('input');
               setError(null);
               resetRunTag();
             }}
           >
             Clear Session
           </PillButton>
           <PillButton 
             variant="solid" 
             className="w-full" 
             icon={<span className="material-symbols-outlined text-[18px]">play_arrow</span>}
             onClick={() => startBatch('uncompleted').catch(e => setError(e.message))}
             disabled={isGenerating || isVideoGenerating || pendingScenesCount === 0}
           >
             Launch Batch ({pendingScenesCount})
           </PillButton>
        </div>
      </div>

      {editingImage && (
        <ImageEditor 
          image={{ base64: editingImage.base64, mimeType: editingImage.mimeType, name: editingImage.name }}
          onClose={() => setEditingImage(null)}
          onSave={async (res) => {
            const bytes = Math.round(res.base64.length * 0.75);
            try {
              const thumbInfo = await makeThumbnail(res.base64, res.mimeType);
              updateScene(editingImage.sceneId, { 
                result: { 
                  base64: res.base64, 
                  thumbBase64: thumbInfo.thumbBase64,
                  mimeType: 'image/jpeg', 
                  mediaId: '',
                  width: thumbInfo.width,
                  height: thumbInfo.height,
                  bytes: bytes
                } 
              });
            } catch {
              updateScene(editingImage.sceneId, { 
                result: { 
                  base64: res.base64, 
                  mimeType: 'image/jpeg', 
                  mediaId: '',
                  bytes: bytes
                } 
              });
            }
            setEditingImage(null);
          }}
        />
      )}

      {error && (
        <div className="fixed bottom-6 right-6 z-[100] bg-red-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-right-4 max-w-md">
           <span className="material-symbols-outlined text-2xl">error</span>
           <div className="flex flex-col gap-0.5">
             <span className="text-[13px] font-bold">Runtime Error</span>
             <span className="text-xs opacity-90 leading-tight">{error}</span>
           </div>
           <button onClick={() => setError(null)} className="material-symbols-outlined text-lg opacity-60 hover:opacity-100 ml-auto">close</button>
        </div>
      )}
    </div>
  );
}
