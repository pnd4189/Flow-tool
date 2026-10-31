import React, { useState, useRef, useMemo, useEffect } from 'react';
import type {
  PromptItem,
  SupportedAspectRatio,
  AutoPilotConfig,
  AutoPilotMode,
} from '../types';
import { parsePromptTextAsync, aiResplitPrompts, VALID_ASPECT_RATIOS } from '../services/promptParser';
import { normalizePromptKey } from '../services/downloadQueue';
import { estimateRun, formatFinishTime, type StageBreakdownEstimate } from '../services/autoPilot';
import { VirtualList } from './VirtualList';

interface Step1Props {
  prompts: PromptItem[];
  setPrompts: React.Dispatch<React.SetStateAction<PromptItem[]>>;
  defaultRatio: SupportedAspectRatio;
  setDefaultRatio: (r: SupportedAspectRatio) => void;
  translateVietnamese: boolean;
  setTranslateVietnamese: (val: boolean) => void;
  onProceedToStep2: () => void;
  onStartAutoPilot?: (config: AutoPilotConfig) => void;
  autoPilotConfig?: AutoPilotConfig;
  setAutoPilotConfig?: React.Dispatch<React.SetStateAction<AutoPilotConfig>>;
  styleSuffix?: string;
  setStyleSuffix?: (val: string) => void;
  addNoWatermark?: boolean;
  setAddNoWatermark?: (val: boolean) => void;
  onAddToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onBatchIndexLoaded?: (maxBatchIndex: number) => void;
}

const PromptRowMemo = React.memo<{
  prompt: PromptItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string, checked: boolean) => void;
}>(({ prompt, isSelected, onSelect, onToggleCheck }) => {
  const isFromManifest = prompt.warnings.includes('Đã xong (từ manifest)');

  return (
    <div
      onClick={() => onSelect(prompt.id)}
      className={`h-[76px] p-2 mx-1.5 my-1 rounded-md cursor-pointer transition-all flex items-start gap-2.5 border select-none ${
        isSelected
          ? 'bg-[#1e1e26] border-[#f5b301]/50 shadow-sm'
          : isFromManifest
          ? 'bg-purple-950/15 border-purple-500/20 opacity-80'
          : 'bg-[#141417] border-[#22222a] hover:bg-[#18181f]'
      }`}
    >
      <input
        type="checkbox"
        checked={prompt.selected}
        onChange={(e) => {
          e.stopPropagation();
          onToggleCheck(prompt.id, e.target.checked);
        }}
        className="mt-1 accent-[#f5b301] w-3.5 h-3.5 rounded cursor-pointer"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="text-xs font-semibold text-zinc-200 truncate">
            #{prompt.order}. {prompt.title}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#26262f] text-zinc-300">
            {prompt.aspectRatio}
          </span>
        </div>

        <p className="text-[11px] text-zinc-400 line-clamp-1 leading-relaxed">
          {prompt.prompt}
        </p>

        <div className="flex flex-wrap gap-1 mt-1">
          {isFromManifest && (
            <span className="text-[9px] font-mono px-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
              Đã xong (từ manifest)
            </span>
          )}
          {prompt.negative && (
            <span className="text-[9px] font-mono px-1 rounded bg-rose-500/15 text-rose-300 border border-rose-500/25 truncate max-w-[140px]">
              Tránh: {prompt.negative}
            </span>
          )}
          {prompt.duplicateOf !== undefined && (
            <span className="text-[9px] font-mono px-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
              Trùng #{prompt.duplicateOf}
            </span>
          )}
          {prompt.hasVietnamese && (
            <span className="text-[9px] font-mono px-1 rounded bg-sky-500/20 text-sky-300">
              Tiếng Việt
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

export const Step1PromptInput: React.FC<Step1Props> = ({
  prompts,
  setPrompts,
  defaultRatio,
  setDefaultRatio,
  translateVietnamese,
  setTranslateVietnamese,
  onProceedToStep2,
  onStartAutoPilot,
  autoPilotConfig,
  setAutoPilotConfig,
  styleSuffix = '',
  setStyleSuffix,
  addNoWatermark = true,
  setAddNoWatermark,
  onAddToast,
  onBatchIndexLoaded,
}) => {
  const [rawText, setRawText] = useState<string>('');
  const [detectedLabel, setDetectedLabel] = useState<string>('');
  const [parsingProgress, setParsingProgress] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [isAiSplitting, setIsAiSplitting] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const manifestFileInputRef = useRef<HTMLInputElement | null>(null);

  const [resumedFromManifestCount, setResumedFromManifestCount] = useState<number>(0);
  const [showAutoPilotConfigModal, setShowAutoPilotConfigModal] = useState<boolean>(false);
  const [selectedBreakdownMode, setSelectedBreakdownMode] = useState<AutoPilotMode | null>(null);

  const [, setClockTick] = useState<number>(0);
  useEffect(() => {
    const timer = setInterval(() => setClockTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const [localAutoConfig, setLocalAutoConfig] = useState<AutoPilotConfig>(
    autoPilotConfig || {
      mode: 'full',
      modelName: '🍌 Nano Banana 2.1',
      concurrency: 2,
      batchSize: 10,
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
      styleSuffix: styleSuffix,
      addNoWatermark: addNoWatermark,
      translateVietnamese: translateVietnamese,
    }
  );

  const activeConfig = autoPilotConfig || localAutoConfig;
  const updateConfig = (updater: (prev: AutoPilotConfig) => AutoPilotConfig) => {
    if (setAutoPilotConfig) {
      setAutoPilotConfig(updater);
    } else {
      setLocalAutoConfig(updater);
    }
  };

  const handleTextChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setRawText(val);
    if (!val.trim()) {
      setPrompts([]);
      setDetectedLabel('');
      setSelectedPromptId(null);
      setResumedFromManifestCount(0);
      setParsingProgress(null);
      return;
    }

    if (val.length > 200000) {
      setParsingProgress('Đang phân tích… 0%');
    }

    const { detectedFormat, items } = await parsePromptTextAsync(
      val,
      defaultRatio,
      (pct, msg) => setParsingProgress(msg)
    );

    setParsingProgress(null);
    setPrompts(items);
    setDetectedLabel(detectedFormat);
    if (items.length > 0 && !selectedPromptId) {
      setSelectedPromptId(items[0].id);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setParsingProgress('Đang nạp file…');
      const content = await file.text();
      setRawText(content);
      const { detectedFormat, items } = await parsePromptTextAsync(
        content,
        defaultRatio,
        (pct, msg) => setParsingProgress(msg)
      );
      setParsingProgress(null);
      setPrompts(items);
      setDetectedLabel(`${detectedFormat} (từ ${file.name})`);
      if (items.length > 0) setSelectedPromptId(items[0].id);
      onAddToast(`Đã nhập ${items.length} prompt từ file ${file.name}`, 'success');
    } catch (err: any) {
      setParsingProgress(null);
      onAddToast(`Không thể đọc file: ${err?.message || err}`, 'error');
    }
  };

  /**
   * Sửa handleManifestFilesUpload (Đợt 7B):
   * Lấy max của batchIndex và lastBatchIndex (từ manifest tổng) để chạy tiếp không đặt lại tên manifest_lo01.
   */
  const handleManifestFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const completedPromptKeys = new Set<string>();
      let foundProjectName = '';
      let maxBatchIdx = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const text = await file.text();
        const json = JSON.parse(text);

        if (json.projectName && !foundProjectName) {
          foundProjectName = json.projectName;
        }

        // Lấy max của batchIndex và lastBatchIndex (manifest tổng)
        if (typeof json.batchIndex === 'number' && json.batchIndex > maxBatchIdx) {
          maxBatchIdx = json.batchIndex;
        }
        if (typeof json.lastBatchIndex === 'number' && json.lastBatchIndex > maxBatchIdx) {
          maxBatchIdx = json.lastBatchIndex;
        }

        const matchName = file.name.match(/manifest_lo(\d+)/i);
        if (matchName) {
          const parsedIdx = parseInt(matchName[1], 10);
          if (parsedIdx > maxBatchIdx) maxBatchIdx = parsedIdx;
        }

        const clips = json.clips || [];
        clips.forEach((c: any) => {
          if (c.promptKey) {
            completedPromptKeys.add(c.promptKey);
          }
        });
      }

      if (foundProjectName) {
        updateConfig((prev) => ({ ...prev, projectName: foundProjectName }));
      }

      if (onBatchIndexLoaded && maxBatchIdx > 0) {
        onBatchIndexLoaded(maxBatchIdx);
      }

      let matchedCount = 0;
      setPrompts((prev) =>
        prev.map((p) => {
          const key = normalizePromptKey(p.prompt);
          if (completedPromptKeys.has(key)) {
            matchedCount++;
            return {
              ...p,
              selected: false,
              warnings: [...p.warnings, 'Đã xong (từ manifest)'],
            };
          }
          return p;
        })
      );

      setResumedFromManifestCount(matchedCount);
      onAddToast(
        `Đã đọc ${files.length} manifest: Đã xong ${matchedCount}/${prompts.length} • còn lại ${prompts.length - matchedCount} (lô kế tiếp sẽ từ lô ${String(maxBatchIdx + 1).padStart(2, '0')})`,
        'success'
      );
    } catch (err: any) {
      onAddToast(`Lỗi đọc manifest: ${err?.message || err}`, 'error');
    }
  };

  const handleAiResplit = async () => {
    if (!rawText.trim()) {
      onAddToast('Vui lòng nhập nội dung prompt trước khi tách bằng AI', 'warning');
      return;
    }
    setIsAiSplitting(true);
    try {
      const aiItems = await aiResplitPrompts(rawText, defaultRatio);
      setPrompts(aiItems);
      onAddToast(`AI đã phân tích và tìm thấy ${aiItems.length} prompt`, 'info');
    } catch (err: any) {
      onAddToast(`AI tách lỗi: ${err?.message || err}`, 'error');
    } finally {
      setIsAiSplitting(false);
    }
  };

  const handleRemoveDuplicates = () => {
    const deduped = prompts.filter((p) => p.duplicateOf === undefined);
    const removedCount = prompts.length - deduped.length;
    setPrompts(deduped);
    if (removedCount > 0) {
      onAddToast(`Đã xoá ${removedCount} prompt bị trùng lặp`, 'success');
    } else {
      onAddToast('Không có prompt nào bị trùng', 'info');
    }
  };

  const handleToggleSelectAll = (select: boolean) => {
    setPrompts((prev) => prev.map((p) => ({ ...p, selected: select })));
  };

  const currentPrompt = useMemo(
    () => prompts.find((p) => p.id === selectedPromptId) || null,
    [prompts, selectedPromptId]
  );

  const updateCurrentPrompt = (fields: Partial<PromptItem>) => {
    if (!selectedPromptId) return;
    setPrompts((prev) =>
      prev.map((p) => (p.id === selectedPromptId ? { ...p, ...fields } : p))
    );
  };

  const targetPromptsCount = useMemo(() => {
    return prompts.filter((p) => p.selected && !p.warnings.includes('Đã xong (từ manifest)')).length;
  }, [prompts]);

  // Đếm số prompt trùng lặp (Đợt 7B)
  const duplicatePromptsCount = useMemo(() => {
    return prompts.filter((p) => p.duplicateOf !== undefined).length;
  }, [prompts]);

  const selectedCount = prompts.filter((p) => p.selected).length;
  const remainingCount = prompts.length - resumedFromManifestCount;

  const estDiskGb = useMemo(() => {
    const N = targetPromptsCount;
    const mbPerItem = activeConfig.mode === 'images_only'
      ? 2.0
      : activeConfig.resolution === '1080p'
      ? 9.5
      : 4.5;
    const gb = (N * mbPerItem) / 1024;
    return Math.max(0.1, Math.round(gb * 10) / 10);
  }, [targetPromptsCount, activeConfig.mode, activeConfig.resolution]);

  const estimatesByMode = useMemo<Record<AutoPilotMode, StageBreakdownEstimate>>(() => {
    const N = targetPromptsCount;
    return {
      full: estimateRun('full', N, activeConfig),
      no_parallax: estimateRun('no_parallax', N, activeConfig),
      camera_only: estimateRun('camera_only', N, activeConfig),
      images_only: estimateRun('images_only', N, activeConfig),
    };
  }, [targetPromptsCount, activeConfig]);

  const breakdownDetail = selectedBreakdownMode ? estimatesByMode[selectedBreakdownMode] : null;

  const currentSuffix = (activeConfig.styleSuffix !== undefined ? activeConfig.styleSuffix : styleSuffix).trim();

  const isMergeSupported = targetPromptsCount >= 2 && targetPromptsCount <= 30;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0b0d] text-zinc-200 overflow-hidden">
      {/* 1. THANH ĐIỀU KHIỂN TRÊN CÙNG */}
      <div className="p-3 border-b border-[#26262b] bg-[#141417] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={translateVietnamese}
              onChange={(e) => setTranslateVietnamese(e.target.checked)}
              className="accent-[#f5b301] w-4 h-4 rounded"
            />
            <span className="font-medium text-zinc-300">
              Dịch prompt tiếng Việt sang tiếng Anh khi sinh (giữ bản gốc)
            </span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={manifestFileInputRef}
            onChange={handleManifestFilesUpload}
            accept=".json"
            multiple
            className="hidden"
          />
          <button
            type="button"
            onClick={() => manifestFileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#181824] hover:bg-[#222232] text-purple-300 border border-purple-500/40 font-medium text-xs rounded-lg transition-all"
            title="Đọc các file manifest để bỏ qua prompt đã làm xong"
          >
            <span className="material-symbols-outlined text-[16px]">history</span>
            <span>Chạy tiếp từ manifest…</span>
          </button>

          {parsingProgress && (
            <span className="text-xs font-mono px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
              {parsingProgress}
            </span>
          )}

          {detectedLabel && !parsingProgress && (
            <span className="text-xs font-mono px-2.5 py-1 rounded bg-[#1e1e24] text-[#f5b301] border border-[#2d2d35]">
              {detectedLabel}
            </span>
          )}

          <button
            type="button"
            onClick={onProceedToStep2}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#1e1e24] hover:bg-[#282830] text-zinc-200 border border-[#2d2d35] font-medium text-xs rounded-lg transition-all disabled:opacity-40"
          >
            <span>Sang bước 2 thủ công ({selectedCount})</span>
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </button>
        </div>
      </div>

      {resumedFromManifestCount > 0 && (
        <div className="px-4 py-2 bg-purple-950/40 border-b border-purple-500/30 flex items-center justify-between text-xs text-purple-200">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-purple-400">check_circle</span>
            <span>
              Đã xong <strong>{resumedFromManifestCount}/{prompts.length}</strong> từ lượt trước • Còn lại <strong>{remainingCount}</strong> prompt cần chạy
            </span>
          </div>
          <span className="text-[11px] font-mono text-purple-300">
            Dự án: {activeConfig.projectName}
          </span>
        </div>
      )}

      {/* 2. KHỐI 4 CHẾ ĐỘ TỰ ĐỘNG */}
      {prompts.length > 0 && (
        <div className="px-4 py-3 bg-[#111116] border-b border-amber-500/30 space-y-2.5 shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-300 uppercase tracking-wide flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[18px] text-amber-400">bolt</span>
                4 CHẾ ĐỘ TỰ ĐỘNG 100% (CHỌN 1 TRONG 4 ĐỂ CHẠY CHO {targetPromptsCount} PROMPT ĐÃ CHỌN)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {currentSuffix && (
                <span className="text-[11px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30 max-w-[200px] truncate" title={`Hậu tố: ${currentSuffix}`}>
                  + "{currentSuffix}"
                </span>
              )}

              <span className="text-[11px] font-mono text-zinc-400 bg-[#18181f] px-2.5 py-1 rounded border border-[#26262b]">
                {activeConfig.concurrency} luồng • {activeConfig.resolution}
                {activeConfig.durationMode === 'fixed' && ` • ${activeConfig.fixedDurationSec || 6}s`}
                {activeConfig.mode !== 'images_only' && activeConfig.downloadOriginalImages && ' • + ảnh gốc'}
                {activeConfig.mode !== 'images_only' && activeConfig.mergeClips && ' • + ghép video'}
              </span>

              <button
                type="button"
                onClick={() => setShowAutoPilotConfigModal(true)}
                className="px-2.5 py-1 rounded-lg bg-[#1e1e26] hover:bg-[#282835] text-zinc-200 border border-[#3a3a4c] text-xs font-medium flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">tune</span>
                <span>Tuỳ chỉnh</span>
              </button>
            </div>
          </div>

          {/* DÒNG NHẮC NHỞ TRƯỚC KHI CHẠY */}
          <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center gap-2 text-[11px] text-amber-300">
            <span className="material-symbols-outlined text-[15px] text-amber-400 shrink-0">info</span>
            <span>
              Giữ tab Flow mở. Tắt chế độ ngủ và khoá màn hình của máy. Cần trống khoảng <strong>{estDiskGb} GB</strong> ổ đĩa. Lần đầu Chrome có thể hỏi cho phép tải nhiều tệp, chọn Cho phép.
            </span>
          </div>

          {/* CẢNH BÁO PROMPT TRÙNG (ĐỢT 7B - YÊU CẦU 4) */}
          {duplicatePromptsCount > 0 && (
            <div className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/50 flex items-center justify-between gap-2 text-xs text-amber-300 animate-in fade-in duration-200">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-amber-400 shrink-0">warning</span>
                <span className="font-semibold">
                  Có {duplicatePromptsCount} prompt trùng nhau
                </span>
              </div>
              <button
                type="button"
                onClick={handleRemoveDuplicates}
                className="px-3 py-1 bg-amber-400 hover:bg-amber-300 text-black font-bold text-xs rounded-md shadow-sm transition-all flex items-center gap-1 shrink-0"
              >
                <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
                <span>Xoá trùng</span>
              </button>
            </div>
          )}

          {/* LƯỚI 4 THẺ CHẾ ĐỘ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[
              {
                id: 'full' as AutoPilotMode,
                title: '1. Auto đầy đủ',
                icon: 'auto_awesome',
                desc: 'AI chọn máy quay + overlays + parallax 2 lớp (khi AI bật).',
                tag: 'Đẹp nhất',
              },
              {
                id: 'no_parallax' as AutoPilotMode,
                title: '2. Auto không parallax',
                icon: 'videocam',
                desc: 'AI chọn máy quay + overlays; parallax luôn tắt (nhanh hơn).',
                tag: 'Nhanh & Mượt',
              },
              {
                id: 'camera_only' as AutoPilotMode,
                title: '3. Chỉ chuyển động máy quay',
                icon: 'crop_free',
                desc: 'AI chỉ chọn máy quay + thời lượng; overlays = [], parallax tắt.',
                tag: 'Tối giản',
              },
              {
                id: 'images_only' as AutoPilotMode,
                title: '4. Chỉ sinh ảnh',
                icon: 'photo_library',
                desc: 'Sinh ảnh + AI soi ảnh, không dựng video; tải ảnh gốc + manifest.',
                tag: 'Chỉ ảnh gốc',
              },
            ].map((card) => {
              const isSelected = activeConfig.mode === card.id;
              const est = estimatesByMode[card.id];

              return (
                <div
                  key={card.id}
                  onClick={() => updateConfig((c) => ({ ...c, mode: card.id }))}
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2.5 ${
                    isSelected
                      ? 'bg-[#1e1c26] border-amber-400 shadow-md ring-1 ring-amber-400'
                      : 'bg-[#14141a] border-[#282835] hover:bg-[#181822] hover:border-zinc-600'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-zinc-100">
                        <span className="material-symbols-outlined text-[16px] text-amber-400">
                          {card.icon}
                        </span>
                        <span>{card.title}</span>
                      </div>
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-zinc-800 text-amber-300">
                        {card.tag}
                      </span>
                    </div>

                    <p className="text-[11px] text-zinc-400 leading-snug">
                      {card.desc}
                    </p>
                  </div>

                  {/* 2 DÒNG ƯỚC TÍNH THỜI GIAN */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedBreakdownMode(card.id);
                    }}
                    className="p-2 rounded bg-black/40 border border-[#2d2d3d] hover:border-amber-400/50 space-y-0.5 transition-colors group"
                    title="Bấm để xem chi tiết thời gian từng khâu và nút cổ chai"
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-300">
                      <span className="text-amber-300 font-bold group-hover:underline">
                        {est.durationFormatted} cho {targetPromptsCount} prompt
                      </span>
                      <span className="material-symbols-outlined text-[14px] text-zinc-500 group-hover:text-amber-300">
                        info
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-zinc-400">
                      Xong khoảng <strong className="text-zinc-200">{est.finishTimeFormatted}</strong> nếu bắt đầu bây giờ
                    </div>
                  </div>

                  {isSelected && onStartAutoPilot && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartAutoPilot(activeConfig);
                      }}
                      disabled={targetPromptsCount === 0}
                      className="w-full py-1.5 rounded bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all disabled:opacity-40"
                    >
                      <span>Chạy tự động ngay ({targetPromptsCount} prompt)</span>
                      <span className="material-symbols-outlined text-[15px]">play_arrow</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VÙNG CHÍNH CHIA 2 KHUNG CUỘN ĐỘC LẬP */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* KHUNG TRÁI: Ô nhập văn bản + VirtualList */}
        <div className="w-full md:w-[380px] md:min-w-[380px] border-r border-[#26262b] flex flex-col h-full bg-[#111114]">
          <div className="p-3 border-b border-[#26262b] bg-[#141417]/80 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px]">edit_note</span>
                Dán prompt (hỗ trợ 300–1000 mục)
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".txt,.md,.csv,.json"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] px-2 py-0.5 rounded bg-[#1e1e24] hover:bg-[#282830] text-zinc-300 border border-[#2d2d35] flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[13px]">upload_file</span>
                  File
                </button>
                <button
                  type="button"
                  onClick={handleAiResplit}
                  disabled={isAiSplitting || !rawText.trim()}
                  className="text-[11px] px-2 py-0.5 rounded bg-[#f5b301]/10 text-[#f5b301] border border-[#f5b301]/30 hover:bg-[#f5b301]/20 flex items-center gap-1 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[13px]">
                    {isAiSplitting ? 'hourglass_top' : 'psychology'}
                  </span>
                  AI tách
                </button>
              </div>
            </div>

            <textarea
              value={rawText}
              onChange={handleTextChange}
              placeholder="Dán danh sách prompt (300-1000 mục)... Tự động xử lý từng đoạn, không treo tab."
              className="w-full h-24 p-2 text-xs font-mono bg-[#0b0b0d] border border-[#26262b] rounded-md text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#f5b301]/60 resize-none"
            />
          </div>

          <div className="px-3 py-2 border-b border-[#26262b] bg-[#141417] flex items-center justify-between text-[11px] text-zinc-400">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleToggleSelectAll(true)}
                className="hover:text-zinc-200"
              >
                Chọn hết
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => handleToggleSelectAll(false)}
                className="hover:text-zinc-200"
              >
                Bỏ chọn
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={handleRemoveDuplicates}
                className="hover:text-[#f5b301]"
              >
                Xoá trùng
              </button>
            </div>
            <span className="font-mono">
              {selectedCount}/{prompts.length} đã chọn
            </span>
          </div>

          {/* DANH SÁCH ẢO HOÁ VIRTUALLIST */}
          <div className="flex-1 overflow-hidden">
            {prompts.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 text-xs">
                Chưa có prompt nào. Dán văn bản hoặc bấm chọn file để bắt đầu!
              </div>
            ) : (
              <VirtualList<PromptItem>
                items={prompts}
                itemHeight={80}
                className="h-full"
                buffer={10}
                renderItem={(item) => (
                  <PromptRowMemo
                    prompt={item}
                    isSelected={item.id === selectedPromptId}
                    onSelect={setSelectedPromptId}
                    onToggleCheck={(id, checked) => {
                      setPrompts((prev) =>
                        prev.map((it) => (it.id === id ? { ...it, selected: checked } : it))
                      );
                    }}
                  />
                )}
              />
            )}
          </div>
        </div>

        {/* KHUNG PHẢI: Chi tiết prompt */}
        <div className="flex-1 flex flex-col h-full bg-[#0b0b0d] overflow-y-auto p-4 md:p-6">
          {currentPrompt ? (
            <div className="max-w-3xl w-full mx-auto space-y-4">
              <div className="flex items-center justify-between border-b border-[#26262b] pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#f5b301]/10 text-[#f5b301] flex items-center justify-center font-mono font-bold text-xs">
                    {currentPrompt.order}
                  </span>
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Chỉnh sửa Prompt #{currentPrompt.order}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400">Tỷ lệ:</span>
                  <select
                    value={currentPrompt.aspectRatio}
                    onChange={(e) =>
                      updateCurrentPrompt({ aspectRatio: e.target.value as SupportedAspectRatio })
                    }
                    className="bg-[#18181f] border border-[#2d2d35] rounded px-2 py-1 text-xs font-mono text-[#f5b301] focus:outline-none"
                  >
                    {VALID_ASPECT_RATIOS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-400">Tiêu đề (Title):</label>
                <input
                  type="text"
                  value={currentPrompt.title}
                  onChange={(e) => updateCurrentPrompt({ title: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-[#141417] border border-[#26262b] rounded-lg text-zinc-200 focus:outline-none focus:border-[#f5b301]"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-zinc-400">Nội dung Prompt:</label>
                  <span className="text-[11px] font-mono text-zinc-500">
                    {currentPrompt.prompt.length} ký tự
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={currentPrompt.prompt}
                  onChange={(e) => updateCurrentPrompt({ prompt: e.target.value })}
                  className="w-full p-3 text-xs font-mono leading-relaxed bg-[#141417] border border-[#26262b] rounded-lg text-zinc-200 focus:outline-none focus:border-[#f5b301] resize-y"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-400">
                  Negative Prompt (Tránh):
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: text, watermark, blurry, extra fingers"
                  value={currentPrompt.negative || ''}
                  onChange={(e) => updateCurrentPrompt({ negative: e.target.value || undefined })}
                  className="w-full px-3 py-1.5 text-xs bg-[#141417] border border-[#26262b] rounded-lg text-zinc-200 focus:outline-none focus:border-[#f5b301]"
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-xs">
              <span className="material-symbols-outlined text-[32px] mb-2 opacity-50">
                touch_app
              </span>
              <span>Chọn một prompt ở danh sách bên trái để chỉnh sửa chi tiết</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. MODAL CHI TIẾT ƯỚC TÍNH THỜI GIAN THEO KHÂU */}
      {selectedBreakdownMode && breakdownDetail && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#141417] border border-[#26262b] rounded-xl overflow-hidden shadow-2xl flex flex-col">
            <div className="p-3.5 border-b border-[#26262b] bg-[#18181f] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-[20px]">schedule</span>
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-100">
                  Chi tiết Ước tính Thời gian ({breakdownDetail.durationFormatted})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBreakdownMode(null)}
                className="text-zinc-400 hover:text-white p-1 rounded"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-0.5">
                <div className="font-bold flex items-center justify-between">
                  <span>Dự kiến hoàn thành: {breakdownDetail.finishTimeFormatted}</span>
                  <span className="font-mono text-[11px]">{targetPromptsCount} prompt</span>
                </div>
                <div className="text-[11px] text-amber-300/80">
                  Nút cổ chai đang là: <strong>{breakdownDetail.bottleneckStageName}</strong> ({breakdownDetail.bottleneckSecPerItem}s / mục)
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-zinc-400 uppercase">Thời gian từng khâu (trung bình mỗi mục):</div>
                <div className="space-y-1 bg-[#181822] p-2.5 rounded-lg border border-[#282838] font-mono text-[11px]">
                  <div className="flex justify-between py-1 border-b border-zinc-800">
                    <span className="text-zinc-300">1. Nhịp luồng sinh ảnh ({activeConfig.concurrency} luồng, gồm soi ảnh & 5% retry):</span>
                    <span className="text-amber-400">{breakdownDetail.genSecPerItem}s</span>
                  </div>
                  {breakdownDetail.qcSecPerItem > 0 && (
                    <div className="flex justify-between py-1 border-b border-zinc-800 text-zinc-400">
                      <span className="text-zinc-400 pl-3">↳ Trong đó thời gian soi ảnh QC:</span>
                      <span>~{breakdownDetail.qcSecPerItem}s</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-b border-zinc-800">
                    <span className="text-zinc-300">2. AI chọn hiệu ứng:</span>
                    <span className="text-indigo-400">{breakdownDetail.effectSecPerItem}s</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800">
                    <span className="text-zinc-300">3. Tách lớp Parallax (25s × tỷ lệ bật):</span>
                    <span className="text-teal-400">{breakdownDetail.layerSecPerItem}s</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800">
                    <span className="text-zinc-300">4. Dựng MP4 ({activeConfig.resolution}):</span>
                    <span className="text-yellow-400">{breakdownDetail.renderSecPerItem}s</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-zinc-300">5. Tải file về máy:</span>
                    <span className="text-emerald-400">{breakdownDetail.downloadSecPerItem}s</span>
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-zinc-500 italic">
                Công thức: Độ trễ mục đầu ({breakdownDetail.firstItemLatencySec}s) + ({targetPromptsCount} - 1) × {breakdownDetail.bottleneckSecPerItem}s (khâu {breakdownDetail.bottleneckStageName}). Soi ảnh chạy trực tiếp trong luồng sinh ảnh.
              </div>
            </div>

            <div className="p-3 border-t border-[#26262b] bg-[#18181f] flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedBreakdownMode(null)}
                className="px-4 py-1.5 bg-[#1e1e26] hover:bg-[#282835] text-zinc-200 font-semibold rounded-lg text-xs"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. MODAL TUỲ CHỈNH CÀI ĐẶT */}
      {showAutoPilotConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#141417] border border-[#26262b] rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-3.5 border-b border-[#26262b] bg-[#18181f] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-[20px]">tune</span>
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-100">
                  Tuỳ chỉnh Cài đặt Chế độ Tự động
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowAutoPilotConfigModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="p-4 md:p-5 overflow-y-auto space-y-4 text-xs">
              {/* THỜI LƯỢNG */}
              <div className="p-3 rounded-lg bg-[#181822] border border-[#2d2d3d] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-amber-400">timer</span>
                      <span>Thời lượng clip:</span>
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      "Theo AI" để AI tự chọn cho từng ảnh (4-8s) hoặc số giây cố định (3-10s)
                    </div>
                  </div>
                  <div className="flex items-center bg-[#14141a] p-0.5 rounded-lg border border-[#333346]">
                    <button
                      type="button"
                      onClick={() => updateConfig((c) => ({ ...c, durationMode: 'ai' }))}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                        activeConfig.durationMode !== 'fixed'
                          ? 'bg-amber-400 text-black'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Theo AI
                    </button>
                    <button
                      type="button"
                      onClick={() => updateConfig((c) => ({ ...c, durationMode: 'fixed' }))}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                        activeConfig.durationMode === 'fixed'
                          ? 'bg-amber-400 text-black'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Cố định
                    </button>
                  </div>
                </div>

                {activeConfig.durationMode === 'fixed' && (
                  <div className="pt-2 border-t border-[#262636] space-y-1.5">
                    <div className="flex justify-between text-xs font-medium text-zinc-300">
                      <span>Số giây cố định cho mọi clip:</span>
                      <span className="font-mono text-amber-400 font-bold">
                        {activeConfig.fixedDurationSec || 6} giây
                      </span>
                    </div>
                    <input
                      type="range"
                      min={3}
                      max={10}
                      step={1}
                      value={activeConfig.fixedDurationSec || 6}
                      onChange={(e) =>
                        updateConfig((c) => ({ ...c, fixedDurationSec: parseInt(e.target.value, 10) }))
                      }
                      className="w-full h-1.5 bg-[#2a2434] rounded appearance-none cursor-pointer accent-amber-400"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                      <span>3s</span>
                      <span>4s</span>
                      <span>5s</span>
                      <span>6s</span>
                      <span>7s</span>
                      <span>8s</span>
                      <span>9s</span>
                      <span>10s</span>
                    </div>
                  </div>
                )}
              </div>

              {/* TẢI KÈM ẢNH GỐC */}
              {activeConfig.mode !== 'images_only' && (
                <div className="p-3 rounded-lg bg-[#181822] border border-[#2d2d3d] flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-amber-400">image</span>
                      <span>Tải kèm ảnh gốc:</span>
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      Tải thêm file ảnh tĩnh cùng tên với clip (.jpg/.png) và ghi stillFile vào manifest
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer bg-[#14141a] px-3 py-1 rounded-lg border border-[#333346]">
                    <input
                      type="checkbox"
                      checked={!!activeConfig.downloadOriginalImages}
                      onChange={(e) => {
                        const val = e.target.checked;
                        updateConfig((c) => ({ ...c, downloadOriginalImages: val }));
                      }}
                      className="accent-amber-400 w-4 h-4 rounded"
                    />
                    <span className="text-xs font-semibold text-zinc-200">
                      {activeConfig.downloadOriginalImages ? 'Bật' : 'Tắt'}
                    </span>
                  </label>
                </div>
              )}

              {/* GHÉP THÀNH 1 VIDEO */}
              {activeConfig.mode !== 'images_only' && (
                <div className="p-3 rounded-lg bg-[#181822] border border-[#2d2d3d] space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-amber-400">movie</span>
                        <span>Ghép thành 1 video:</span>
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        Ghép nối các clip hoàn tất thành "{activeConfig.projectName}_ghep.mp4" ở cuối lượt
                      </div>
                    </div>
                    <label
                      className={`flex items-center gap-2 px-3 py-1 rounded-lg border ${
                        !isMergeSupported
                          ? 'bg-[#14141a] border-zinc-700 opacity-50 cursor-not-allowed'
                          : 'bg-[#14141a] border-[#333346] cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!isMergeSupported}
                        checked={!!activeConfig.mergeClips && isMergeSupported}
                        onChange={(e) => {
                          const val = e.target.checked;
                          updateConfig((c) => ({ ...c, mergeClips: val }));
                        }}
                        className="accent-amber-400 w-4 h-4 rounded disabled:cursor-not-allowed"
                      />
                      <span className="text-xs font-semibold text-zinc-200">
                        {activeConfig.mergeClips && isMergeSupported ? 'Bật' : 'Tắt'}
                      </span>
                    </label>
                  </div>

                  {!isMergeSupported && (
                    <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px] shrink-0">warning</span>
                      <span>
                        {targetPromptsCount > 30
                          ? 'Trên 30 clip file ghép quá nặng cho trình duyệt, hãy ghép bằng phần mềm dựng.'
                          : 'Cần ít nhất 2 prompt được chọn để sử dụng tính năng ghép video.'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1 p-3 rounded-lg bg-[#181822] border border-[#2d2d3d]">
                <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-amber-400">palette</span>
                  <span>Hậu tố phong cách (nối vào cuối mọi prompt):</span>
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: 2D anime illustration, clean line art, flat cel shading"
                  value={activeConfig.styleSuffix !== undefined ? activeConfig.styleSuffix : styleSuffix}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateConfig((c) => ({ ...c, styleSuffix: val }));
                    if (setStyleSuffix) setStyleSuffix(val);
                  }}
                  className="w-full p-2 rounded-lg bg-[#14141a] border border-[#2f2f3d] text-zinc-100 text-xs focus:outline-none focus:border-amber-400 font-mono"
                />
                <p className="text-[11px] text-zinc-400 mt-1">
                  Được tự động nối vào cuối mọi prompt khi sinh ảnh và ghi nhận vào sentPrompt của manifest.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-[#181822] border border-[#2d2d3d] flex items-center justify-between">
                <div>
                  <div className="font-semibold text-zinc-200">Thêm "no watermark":</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Tự động thêm câu "No text, no captions, no watermark." vào cuối prompt khi ảnh không yêu cầu chữ
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer bg-[#14141a] px-3 py-1 rounded-lg border border-[#333346]">
                  <input
                    type="checkbox"
                    checked={activeConfig.addNoWatermark !== undefined ? activeConfig.addNoWatermark : addNoWatermark}
                    onChange={(e) => {
                      const val = e.target.checked;
                      updateConfig((c) => ({ ...c, addNoWatermark: val }));
                      if (setAddNoWatermark) setAddNoWatermark(val);
                    }}
                    className="accent-amber-400 w-4 h-4 rounded"
                  />
                  <span className="text-xs font-semibold text-zinc-200">
                    {(activeConfig.addNoWatermark !== undefined ? activeConfig.addNoWatermark : addNoWatermark) ? 'Bật' : 'Tắt'}
                  </span>
                </label>
              </div>

              <div className="p-3 rounded-lg bg-[#181822] border border-[#2d2d3d] flex items-center justify-between">
                <div>
                  <div className="font-semibold text-zinc-200">Kích thước lô (Batch Size):</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Tự động tải manifest_lo{'{STT}'}.json sau mỗi khi hoàn tất đủ 1 lô
                  </div>
                </div>
                <select
                  value={activeConfig.batchSize}
                  onChange={(e) => updateConfig((c) => ({ ...c, batchSize: parseInt(e.target.value, 10) as any }))}
                  className="p-1.5 rounded-lg bg-[#14141a] border border-[#2f2f3d] text-amber-300 font-mono font-bold focus:outline-none"
                >
                  <option value={10}>10 mục / lô (Mặc định)</option>
                  <option value={25}>25 mục / lô</option>
                  <option value={50}>50 mục / lô</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-300">Model sinh ảnh:</label>
                  <select
                    value={activeConfig.modelName}
                    onChange={(e) => updateConfig((c) => ({ ...c, modelName: e.target.value as any }))}
                    className="w-full p-2 rounded-lg bg-[#1a1a22] border border-[#2f2f3d] text-amber-400 font-semibold focus:outline-none"
                  >
                    <option value="🍌 Nano Banana 2.1">🍌 Nano Banana 2.1 (Mặc định)</option>
                    <option value="🍌 Nano Banana Pro">🍌 Nano Banana Pro</option>
                    <option value="🍌 Nano Banana 2 Lite">🍌 Nano Banana 2 Lite</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-300">Số luồng sinh ảnh:</label>
                  <select
                    value={activeConfig.concurrency}
                    onChange={(e) => updateConfig((c) => ({ ...c, concurrency: parseInt(e.target.value, 10) }))}
                    className="w-full p-2 rounded-lg bg-[#1a1a22] border border-[#2f2f3d] text-zinc-100 font-mono focus:outline-none"
                  >
                    <option value={1}>1 luồng</option>
                    <option value={2}>2 luồng (Mặc định)</option>
                    <option value={3}>3 luồng</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-zinc-300">Tên dự án:</label>
                <input
                  type="text"
                  value={activeConfig.projectName}
                  onChange={(e) => updateConfig((c) => ({ ...c, projectName: e.target.value }))}
                  className="w-full p-2 rounded-lg bg-[#1a1a22] border border-[#2f2f3d] text-zinc-100 font-mono text-xs focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-300">Độ phân giải xuất:</label>
                  <select
                    value={activeConfig.resolution}
                    onChange={(e) => updateConfig((c) => ({ ...c, resolution: e.target.value as any }))}
                    className="w-full p-2 rounded-lg bg-[#1a1a22] border border-[#2f2f3d] text-zinc-100"
                  >
                    <option value="1080p">1080p Full HD</option>
                    <option value="720p">720p HD</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-300">Khung hình (FPS):</label>
                  <select
                    value={activeConfig.fps}
                    onChange={(e) => updateConfig((c) => ({ ...c, fps: parseInt(e.target.value, 10) as any }))}
                    className="w-full p-2 rounded-lg bg-[#1a1a22] border border-[#2f2f3d] text-zinc-100 font-mono"
                  >
                    <option value={24}>24 fps</option>
                    <option value={30}>30 fps</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="p-3 border-t border-[#26262b] bg-[#18181f] flex justify-end">
              <button
                type="button"
                onClick={() => setShowAutoPilotConfigModal(false)}
                className="px-4 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-bold rounded-lg text-xs"
              >
                Lưu cài đặt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
