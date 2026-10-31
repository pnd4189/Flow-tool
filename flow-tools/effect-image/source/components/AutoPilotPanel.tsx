import React, { useState, useMemo } from 'react';
import { Flow } from 'flow-sdk';
import type {
  AutoPilotItemProgress,
  AutoPilotSummary,
  AutoPilotStatus,
  AutoPilotConfig,
  MemoryStats,
  QueueItem,
} from '../types';
import { TwoStepButton } from './ui/TwoStepButton';
import { VirtualList } from './VirtualList';
import { formatDurationHuman } from '../services/autoPilot';

interface AutoPilotPanelProps {
  status: AutoPilotStatus;
  items: AutoPilotItemProgress[];
  counts: {
    genDone: number;
    effectDone: number;
    layerDone: number;
    renderDone: number;
    downloadDone: number;
    total: number;
    memoryStats?: MemoryStats;
  };
  summary: AutoPilotSummary | null;
  config: AutoPilotConfig;
  elapsedSec: number;
  estRemainingSec: number;
  consecutiveErrorAlert?: string | null;
  queue?: QueueItem[];
  setQueue?: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRetryErrors: () => void;
  onDownloadAllAgain?: () => void;
  onOpenStep3: () => void;
  onOpenStep4?: () => void;
  onMinimize: () => void;
}

const AutoPilotRowMemo = React.memo<{
  item: AutoPilotItemProgress;
  onPreviewThumb: (url: string) => void;
  onReloadImage: (item: AutoPilotItemProgress) => void;
}>(({ item, onPreviewThumb, onReloadImage }) => {
  const isDone = item.stage === 'downloaded' || item.stage === 'released';

  return (
    <div
      className={`h-[68px] p-2.5 mx-2 my-1 rounded-xl border transition-all flex items-center justify-between gap-3 select-none ${
        item.stage === 'error'
          ? 'bg-rose-950/20 border-rose-500/40'
          : item.stage === 'not_started'
          ? 'bg-zinc-900/60 border-zinc-700/50 opacity-75'
          : isDone
          ? 'bg-[#131714] border-emerald-500/30'
          : item.stage === 'skipped'
          ? 'bg-purple-950/20 border-purple-500/30'
          : item.stage === 'rendering' || item.stage === 'generating' || item.stage === 'separating'
          ? 'bg-[#181822] border-amber-500/40'
          : 'bg-[#141417] border-[#22222a]'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          onClick={() => item.thumbnailUrl && onPreviewThumb(item.thumbnailUrl)}
          className={`w-12 h-12 rounded-lg bg-black overflow-hidden flex-shrink-0 flex items-center justify-center relative border border-[#2b2b35] ${
            item.thumbnailUrl ? 'cursor-pointer hover:border-[#f5b301]' : ''
          }`}
        >
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt="Thumb"
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="material-symbols-outlined text-zinc-600 text-[18px]">photo</span>
          )}
          {item.isMemoryReleased && (
            <span className="absolute bottom-0 inset-x-0 bg-zinc-800/90 text-zinc-300 text-[7px] font-mono text-center">
              RAM ✓
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-100 truncate">
              #{item.order}. {item.title}
            </span>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#1e1e26] text-zinc-400">
              {item.aspectRatio}
            </span>

            {item.stage === 'not_started' && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-zinc-800 text-zinc-400 border border-zinc-700">
                Chưa chạy
              </span>
            )}
            {item.stage === 'generating' && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                Sinh ảnh
              </span>
            )}
            {item.stage === 'inspecting' && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-sky-500/20 text-sky-300">
                Soi ảnh
              </span>
            )}
            {item.stage === 'directing' && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-indigo-500/20 text-indigo-300">
                Chọn hiệu ứng
              </span>
            )}
            {item.stage === 'separating' && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-teal-500/20 text-teal-300 animate-pulse">
                Tách lớp (2 luồng)
              </span>
            )}
            {item.stage === 'rendering' && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-yellow-500/20 text-yellow-300 font-bold">
                Dựng {item.stageProgressPercent || 0}%
              </span>
            )}
            {item.stage === 'downloading' && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-blue-500/20 text-blue-300 animate-pulse">
                Đang tải
              </span>
            )}
            {isDone && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold">
                Đã tải ✓
              </span>
            )}
            {item.stage === 'error' && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold" title={item.error}>
                Lỗi
              </span>
            )}
          </div>

          <p className="text-[11px] text-zinc-400 line-clamp-1">
            {item.prompt}
          </p>

          {item.aiReason && (
            <div className="text-[10px] text-sky-300 font-mono truncate">
              AI: {item.aiReason}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right text-[11px] font-mono text-zinc-400">
          {item.cameraMove && (
            <div className="text-zinc-300">
              Máy quay: <strong className="text-amber-400">{item.cameraMove}</strong>
            </div>
          )}
          {item.downloadedFilename && (
            <div className="text-emerald-400 truncate max-w-[180px]" title={item.downloadedFilename}>
              {item.downloadedFilename}
            </div>
          )}
        </div>

        {item.isMemoryReleased && (
          <button
            type="button"
            onClick={() => onReloadImage(item)}
            className="px-2 py-0.5 rounded bg-[#1e1e24] hover:bg-[#282830] text-zinc-300 border border-[#2d2d35] text-[10px] font-medium"
            title="Nạp lại ảnh gốc từ thư viện"
          >
            Nạp lại
          </button>
        )}
      </div>
    </div>
  );
});

export const AutoPilotPanel: React.FC<AutoPilotPanelProps> = ({
  status,
  items,
  counts,
  summary,
  config,
  elapsedSec,
  estRemainingSec,
  consecutiveErrorAlert,
  queue,
  setQueue,
  onPause,
  onResume,
  onStop,
  onRetryErrors,
  onOpenStep3,
  onOpenStep4,
  onMinimize,
}) => {
  const [selectedPreviewImg, setSelectedPreviewImg] = useState<string | null>(null);

  const [filterType, setFilterType] = useState<'all' | 'running' | 'error' | 'done'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(true);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  const handleReloadImage = async (item: AutoPilotItemProgress) => {
    try {
      const selected = await Flow.media.select({ filter: 'image' });
      if (!selected || !setQueue) return;

      const blobUrl = `data:${selected.mimeType};base64,${selected.base64}`;

      setQueue((prev) =>
        prev.map((q) => {
          if (q.id === item.id) {
            const v = q.variants[0];
            return {
              ...q,
              isMemoryReleased: false,
              variants: v
                ? [{ ...v, blobUrl, mediaId: selected.mediaId, isMemoryReleased: false }]
                : [],
            };
          }
          return q;
        })
      );
    } catch (err) {
      console.warn('Không chọn ảnh nạp lại:', err);
    }
  };

  // Lọc: Bộ lọc 'error' không tính mục not_started (Đợt 7A)
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (filterType === 'running') {
        const isRunning = it.stage === 'generating' || it.stage === 'inspecting' || it.stage === 'directing' || it.stage === 'separating' || it.stage === 'rendering' || it.stage === 'downloading';
        if (!isRunning) return false;
      } else if (filterType === 'error') {
        if (it.stage !== 'error') return false;
      } else if (filterType === 'done') {
        if (it.stage !== 'downloaded' && it.stage !== 'released' && it.stage !== 'skipped') return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchOrder = String(it.order) === q || `#${it.order}` === q;
        const matchPrompt = it.prompt.toLowerCase().includes(q) || it.title.toLowerCase().includes(q);
        if (!matchOrder && !matchPrompt) return false;
      }

      return true;
    });
  }, [items, filterType, searchQuery]);

  const activeRunningIndex = useMemo(() => {
    return filteredItems.findIndex(
      (it) => it.stage === 'rendering' || it.stage === 'generating' || it.stage === 'separating'
    );
  }, [filteredItems]);

  const isCompleted = status === 'completed';
  const isStopped = status === 'stopped';
  const isPaused = status === 'paused';
  const isEnded = isCompleted || isStopped;

  // errorCount: CHỈ đếm stage === 'error', không tính 'not_started' (Đợt 7A)
  const errorCount = useMemo(() => {
    return items.filter((it) => it.stage === 'error').length;
  }, [items]);

  // unstartedCount: đếm stage === 'not_started' (Đợt 7A)
  const unstartedCount = useMemo(() => {
    if (summary && summary.unstartedCount !== undefined) {
      return summary.unstartedCount;
    }
    return items.filter((it) => it.stage === 'not_started').length;
  }, [items, summary]);

  const skippedCount = useMemo(() => {
    return items.filter((it) => it.stage === 'skipped').length;
  }, [items]);

  const memoryStats = counts.memoryStats;

  const estDiskGb = useMemo(() => {
    const N = counts.total;
    const mbPerItem = config.mode === 'images_only'
      ? 2.0
      : config.resolution === '1080p'
      ? 9.5
      : 4.5;
    const gb = (N * mbPerItem) / 1024;
    return Math.max(0.1, Math.round(gb * 10) / 10);
  }, [counts.total, config.mode, config.resolution]);

  // Dòng trạng thái đầu bảng (estHeaderMsg) khi kết thúc (Đợt 7A):
  // dừng vì hạn mức -> "Đã dừng vì hết hạn mức"
  // người dùng dừng -> "Bạn đã dừng"
  // có lỗi -> "Xong, có E mục lỗi"
  // còn lại -> "Đã hoàn tất tất cả mục"
  const estHeaderMsg = useMemo(() => {
    const sumAny = summary as any;
    if (isEnded) {
      if (sumAny?.stoppedByQuota) {
        return 'Đã dừng vì hết hạn mức';
      }
      if (sumAny?.stoppedByUser || isStopped) {
        return 'Bạn đã dừng';
      }
      if (errorCount > 0) {
        return `Xong, có ${errorCount} mục lỗi`;
      }
      return 'Đã hoàn tất tất cả mục';
    }

    if (isPaused) return 'Đang tạm dừng — ước tính dừng đếm';
    const finishDate = new Date(Date.now() + estRemainingSec * 1000);
    const timeFormatted = `${String(finishDate.getHours()).padStart(2, '0')}:${String(finishDate.getMinutes()).padStart(2, '0')}`;
    return `Còn ${formatDurationHuman(estRemainingSec)} • dự kiến xong lúc ${timeFormatted}`;
  }, [isEnded, isPaused, isStopped, summary, errorCount, estRemainingSec]);

  // Thông tin lý do kết thúc lượt chạy
  const endReasonText = useMemo(() => {
    const sumAny = summary as any;
    if (sumAny?.stoppedByQuota) {
      // Số prompt chưa chạy lấy đúng summary.unstartedCount (kể cả khi bằng 0 không dùng dự phòng) (Đợt 7A)
      const count = summary?.unstartedCount !== undefined ? summary.unstartedCount : unstartedCount;
      return `Hết hạn mức: còn ${count} prompt chưa chạy, dùng 'Chạy tiếp từ manifest' sau`;
    }
    if (sumAny?.stoppedByUser || isStopped) {
      return 'Bạn đã dừng';
    }
    return null;
  }, [summary, isStopped, unstartedCount]);

  // Tổng số mục cần chạy lại (lỗi + chưa chạy)
  const totalRetryableCount = errorCount + unstartedCount;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0b0d] text-zinc-200 overflow-hidden">
      {/* 1. THANH HEADER TIẾN TRÌNH AUTOPILOT */}
      <div className="p-3.5 border-b border-[#26262b] bg-[#141418] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-400 text-black flex items-center justify-center font-bold shadow-md">
            <span className="material-symbols-outlined text-[20px]">bolt</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-wide text-zinc-100 uppercase">
                {config.mode === 'full'
                  ? 'Auto đầy đủ'
                  : config.mode === 'no_parallax'
                  ? 'Auto không parallax'
                  : config.mode === 'camera_only'
                  ? 'Chỉ máy quay'
                  : 'Chỉ sinh ảnh'}
              </h2>
              <span className="px-2 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40">
                Lô {config.batchSize}/lần
              </span>
            </div>
            <p className="text-xs text-amber-300 font-mono mt-0.5">
              {estHeaderMsg}
            </p>
          </div>
        </div>

        {/* Nút điều khiển */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMinimize}
            className="px-2.5 py-1.5 rounded-lg bg-[#1e1e24] hover:bg-[#282830] text-zinc-300 border border-[#2d2d35] text-xs font-medium flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">close_fullscreen</span>
            <span>Thu nhỏ</span>
          </button>

          {!isEnded && (
            <>
              {isPaused ? (
                <button
                  type="button"
                  onClick={onResume}
                  className="px-3.5 py-1.5 bg-[#f5b301] text-black font-semibold text-xs rounded-lg hover:bg-[#ffbe1a] transition-all flex items-center gap-1 shadow-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                  <span>Tiếp tục</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPause}
                  className="px-3 py-1.5 bg-[#1e1e24] hover:bg-[#282830] text-zinc-200 border border-[#2d2d35] text-xs font-medium rounded-lg flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">pause</span>
                  <span>Tạm dừng</span>
                </button>
              )}

              <TwoStepButton
                initialLabel="Dừng"
                confirmLabel="Nhấn lần nữa để dừng"
                icon="stop"
                variant="danger"
                onConfirm={onStop}
              />
            </>
          )}

          {isEnded && (
            <button
              type="button"
              onClick={onOpenStep3}
              className="px-3 py-1.5 bg-[#1e1e24] hover:bg-[#282830] text-zinc-200 border border-[#2d2d35] rounded-lg text-xs font-semibold flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">auto_awesome_motion</span>
              <span>Mở bước 3 để chỉnh</span>
            </button>
          )}
        </div>
      </div>

      {consecutiveErrorAlert && (
        <div className="p-3 bg-rose-950/80 border-b border-rose-500 text-rose-100 flex items-center justify-between text-xs animate-pulse">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-400 text-[20px]">cloud_off</span>
            <span className="font-semibold">{consecutiveErrorAlert}</span>
          </div>
          <button
            type="button"
            onClick={onResume}
            className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs"
          >
            Thử tiếp tục lại
          </button>
        </div>
      )}

      {/* DÒNG NHẮC NHỞ TRÊN BẢNG TIẾN TRÌNH */}
      <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 text-[11px] text-amber-300">
        <span className="material-symbols-outlined text-[15px] text-amber-400 shrink-0">info</span>
        <span>
          Giữ tab Flow mở. Tắt chế độ ngủ và khoá màn hình của máy. Cần trống khoảng <strong>{estDiskGb} GB</strong> ổ đĩa. Lần đầu Chrome có thể hỏi cho phép tải nhiều tệp, chọn Cho phép.
        </span>
      </div>

      {/* THẺ TỔNG KẾT KHI LƯỢT CHẠY KẾT THÚC */}
      {isEnded && (
        <div className="p-4 bg-[#181822] border-b border-amber-400/30 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                <span className="material-symbols-outlined text-amber-400 text-[20px]">task_alt</span>
                <span>
                  Xong {counts.downloadDone}/{counts.total} • lỗi {errorCount} • bỏ qua {skippedCount} từ lượt trước • tổng thời gian {formatTime(elapsedSec)}
                </span>
              </div>
              {endReasonText && (
                <div className="text-xs font-mono text-amber-300 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px]">info</span>
                  <span>{endReasonText}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Nút chạy lại mục lỗi / chạy nốt N mục (Đợt 7A) */}
              {totalRetryableCount > 0 && (
                <button
                  type="button"
                  onClick={onRetryErrors}
                  className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">replay</span>
                  <span>
                    {unstartedCount > 0
                      ? `Chạy nốt ${totalRetryableCount} mục`
                      : `Chạy lại mục lỗi (${errorCount})`}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (onOpenStep4) onOpenStep4();
                  else onMinimize();
                }}
                className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs rounded-lg flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined text-[16px]">movie</span>
                <span>Mở bước 4</span>
              </button>

              <button
                type="button"
                onClick={onOpenStep3}
                className="px-3.5 py-1.5 bg-[#1e1e26] hover:bg-[#282835] text-zinc-200 border border-[#3a3a4c] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-all"
              >
                <span className="material-symbols-outlined text-[16px]">auto_awesome_motion</span>
                <span>Mở bước 3 để chỉnh</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. KHỐI THÔNG TIN BỘ NHỚ & ĐỒNG HỒ */}
      <div className="px-4 py-2 bg-[#14141c] border-b border-[#26262b] flex flex-wrap items-center justify-between text-xs text-zinc-400 gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-400 text-[18px]">memory</span>
          <span>
            Bộ nhớ RAM: <strong className="text-zinc-200">~{memoryStats?.estimatedMemoryMB || 20} MB</strong>
            {memoryStats && memoryStats.releasedCount > 0 && (
              <span className="text-emerald-400 ml-1">
                • Đã giải phóng {memoryStats.releasedCount} clip & lớp
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span>Đã chạy: <strong className="text-zinc-200">{formatTime(elapsedSec)}</strong></span>
          <span className="text-amber-300 font-bold">{estHeaderMsg}</span>
        </div>
      </div>

      {/* 3. NĂM CỘT TIẾN TRÌNH KHÂU */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 md:px-4 bg-[#111115] border-b border-[#26262b]">
        <div className="p-2.5 rounded-lg bg-[#18181f] border border-[#26262b] flex items-center justify-between">
          <div>
            <div className="text-[10px] text-zinc-500 font-mono">1. SINH ẢNH</div>
            <div className="text-sm font-bold text-zinc-200 mt-0.5">
              {counts.genDone}/{counts.total}
            </div>
          </div>
          <span className="material-symbols-outlined text-amber-400 text-[20px]">photo_camera</span>
        </div>

        <div className="p-2.5 rounded-lg bg-[#18181f] border border-[#26262b] flex items-center justify-between">
          <div>
            <div className="text-[10px] text-zinc-500 font-mono">2. HIỆU ỨNG</div>
            <div className="text-sm font-bold text-zinc-200 mt-0.5">
              {config.mode === 'images_only' ? 'Bỏ qua' : `${counts.effectDone}/${counts.total}`}
            </div>
          </div>
          <span className="material-symbols-outlined text-sky-400 text-[20px]">psychology</span>
        </div>

        <div className="p-2.5 rounded-lg bg-[#18181f] border border-[#26262b] flex items-center justify-between">
          <div>
            <div className="text-[10px] text-zinc-500 font-mono">3. TÁCH LỚP</div>
            <div className="text-sm font-bold text-zinc-200 mt-0.5">
              {config.mode !== 'full' ? 'Tắt' : `${counts.layerDone}/${counts.total}`}
            </div>
          </div>
          <span className="material-symbols-outlined text-teal-400 text-[20px]">layers</span>
        </div>

        <div className="p-2.5 rounded-lg bg-[#18181f] border border-[#26262b] flex items-center justify-between">
          <div>
            <div className="text-[10px] text-zinc-500 font-mono">4. DỰNG MP4</div>
            <div className="text-sm font-bold text-zinc-200 mt-0.5">
              {config.mode === 'images_only' ? 'Bỏ qua' : `${counts.renderDone}/${counts.total}`}
            </div>
          </div>
          <span className="material-symbols-outlined text-yellow-400 text-[20px]">movie</span>
        </div>

        <div className="p-2.5 rounded-lg bg-[#18181f] border border-[#26262b] flex items-center justify-between col-span-2 sm:col-span-1">
          <div>
            <div className="text-[10px] text-zinc-500 font-mono">5. ĐÃ TẢI LƯU</div>
            <div className="text-sm font-bold text-emerald-400 mt-0.5">
              {counts.downloadDone}/{counts.total}
            </div>
          </div>
          <span className="material-symbols-outlined text-emerald-400 text-[20px]">download_done</span>
        </div>
      </div>

      {/* 4. THANH BỘ LỌC NHANH & TÌM KIẾM */}
      <div className="p-2.5 px-4 bg-[#14141a] border-b border-[#26262b] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-zinc-500 text-[11px] font-mono mr-1">Lọc:</span>
          {(['all', 'running', 'error', 'done'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                filterType === t
                  ? 'bg-amber-400 text-black font-bold'
                  : 'bg-[#1e1e24] text-zinc-400 hover:text-white'
              }`}
            >
              {t === 'all'
                ? `Tất cả (${items.length})`
                : t === 'running'
                ? 'Đang chạy'
                : t === 'error'
                ? `Lỗi (${errorCount})`
                : 'Đã xong'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Tìm theo STT (#1) hoặc chữ trong prompt..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-56 px-2.5 py-1 text-xs bg-[#0b0b0d] border border-[#2d2d38] rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1.5 text-zinc-500 hover:text-white text-[12px]"
              >
                ✕
              </button>
            )}
          </div>

          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScrollEnabled}
              onChange={(e) => setAutoScrollEnabled(e.target.checked)}
              className="accent-amber-400 w-3.5 h-3.5 rounded"
            />
            <span>Tự cuộn tới mục đang chạy</span>
          </label>
        </div>
      </div>

      {/* 5. DANH SÁCH ẢO HOÁ TIẾN TRÌNH AUTOPILOT */}
      <div className="flex-1 overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-xs">
            Không tìm thấy mục nào khớp với bộ lọc.
          </div>
        ) : (
          <VirtualList<AutoPilotItemProgress>
            items={filteredItems}
            itemHeight={72}
            className="h-full"
            buffer={10}
            scrollToIndex={activeRunningIndex >= 0 ? activeRunningIndex : undefined}
            autoScrollEnabled={autoScrollEnabled}
            renderItem={(item) => (
              <AutoPilotRowMemo
                item={item}
                onPreviewThumb={setSelectedPreviewImg}
                onReloadImage={handleReloadImage}
              />
            )}
          />
        )}
      </div>

      {/* MODAL XEM ẢNH */}
      {selectedPreviewImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedPreviewImg(null)}
        >
          <div className="max-w-xl max-h-[80vh] bg-[#141417] p-2 rounded-xl border border-[#26262b]">
            <img src={selectedPreviewImg} alt="Preview" className="max-w-full max-h-[75vh] object-contain rounded-lg" />
          </div>
        </div>
      )}
    </div>
  );
};
