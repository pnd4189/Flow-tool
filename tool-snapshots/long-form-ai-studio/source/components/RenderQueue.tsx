import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Shot,
  Scene,
  Character,
  ProjectConfig,
  VideoTake,
  getActiveTake,
} from '../services/types';
import {
  getShotKeyframes,
  getEffectiveShotRenderConfig,
  checkTakeStaleness,
  renderShotTake,
  isQuotaOrCreditError,
} from '../services/renderService';
import {
  DownloadItem,
  generateVideoFilename,
  executeDownloadQueue,
} from '../services/downloadQueue';

interface RenderQueueProps {
  shots: Shot[];
  scenes: Scene[];
  characters: Character[];
  config: ProjectConfig;
  creditRemaining: number;
  isGeneratingKeyframes: boolean;
  onUpdateShots: (updatedShots: Shot[]) => void;
  onDeductCredits: (amount: number) => void;
}

export const RenderQueue: React.FC<RenderQueueProps> = ({
  shots,
  scenes,
  characters,
  config,
  creditRemaining,
  isGeneratingKeyframes,
  onUpdateShots,
  onDeductCredits,
}) => {
  const [isRendering, setIsRendering] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentRenderingShotId, setCurrentRenderingShotId] = useState<string | null>(null);
  const [renderProgressText, setRenderProgressText] = useState<string>('');
  const [globalRenderError, setGlobalRenderError] = useState<string | null>(null);

  // 2-step confirmation for batch render >= 200 cr
  const [confirmBatchRender, setConfirmBatchRender] = useState(false);
  const [batchActionType, setBatchActionType] = useState<
    'missing' | 'failed' | 'stale' | 'low_qc' | null
  >(null);

  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());

  // Download queue state
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgressText, setDownloadProgressText] = useState<string>('');
  const [downloadSummary, setDownloadSummary] = useState<{
    downloadedCount: number;
    total: number;
    errors: DownloadItem[];
  } | null>(null);

  const stopRequestedRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const cancelDownloadRef = useRef(false);
  const shotsRef = useRef<Shot[]>(shots);
  shotsRef.current = shots;

  const creditRemainingRef = useRef<number>(creditRemaining);
  creditRemainingRef.current = creditRemaining;

  const sceneMap = useMemo(() => {
    const map = new Map<string, Scene>();
    scenes.forEach((s) => map.set(s.id, s));
    return map;
  }, [scenes]);

  // Tính tổng dung lượng tất cả các blobUrl
  const totalBlobSizeBytes = useMemo(() => {
    let bytes = 0;
    shots.forEach((sh) => {
      (sh.takes || []).forEach((tk) => {
        bytes += tk.sizeBytes || 0;
      });
      if (!sh.takes && sh.video) {
        bytes += sh.video.sizeBytes || 0;
      }
    });
    return bytes;
  }, [shots]);

  const totalBlobMB = totalBlobSizeBytes / (1024 * 1024);
  const isMemoryWarning = totalBlobMB > 600;

  // Nhóm các shot theo tiêu chí hàng loạt
  const shotsWithoutVideo = useMemo(() => {
    return shots.filter((s) => !getActiveTake(s));
  }, [shots]);

  const shotsFailed = useMemo(() => {
    return shots.filter((s) => s.renderStatus === 'error' && !getActiveTake(s));
  }, [shots]);

  const shotsStale = useMemo(() => {
    return shots.filter((s) => {
      const take = getActiveTake(s);
      if (!take) return false;
      const kf = getShotKeyframes(s, shots);
      return checkTakeStaleness(take, kf);
    });
  }, [shots]);

  const shotsLowQC = useMemo(() => {
    return shots.filter((s) => {
      const take = getActiveTake(s);
      return Boolean(take?.qc && take.qc.totalScore < 60);
    });
  }, [shots]);

  // Tính chi phí cho từng danh sách
  const calcBatchCost = (targetShots: Shot[]) => {
    return targetShots.reduce((sum, s) => {
      const eff = getEffectiveShotRenderConfig(s, config);
      return sum + eff.cost;
    }, 0);
  };

  const costMissing = calcBatchCost(shotsWithoutVideo);
  const costFailed = calcBatchCost(shotsFailed);
  const costStale = calcBatchCost(shotsStale);
  const costLowQC = calcBatchCost(shotsLowQC);

  const shotsWithVideos = useMemo(() => {
    return shots.filter((sh) => Boolean(getActiveTake(sh)));
  }, [shots]);

  // Render một shot đơn lẻ (thêm take mới)
  const handleRenderSingleTake = async (shot: Shot, useLock = false) => {
    if (isRendering || isGeneratingKeyframes) return;
    const currentKf = getShotKeyframes(shot, shotsRef.current);
    if (!currentKf.isReady && !shot.lock) {
      setGlobalRenderError(`Shot #${shot.order} chưa đủ keyframe đầu/cuối.`);
      return;
    }

    const eff = getEffectiveShotRenderConfig(shot, config);
    if (eff.cost > creditRemainingRef.current) {
      setGlobalRenderError(`Không đủ credit! Cần ${eff.cost} cr, nhưng chỉ còn ${creditRemainingRef.current} cr.`);
      return;
    }

    setGlobalRenderError(null);
    setCurrentRenderingShotId(shot.id);
    setIsRendering(true);
    setRenderProgressText(`Đang quay take mới cho Shot #${shot.order}...`);

    let nextShots = shotsRef.current.map((s) =>
      s.id === shot.id
        ? { ...s, renderStatus: 'rendering' as const, renderError: undefined }
        : s
    );
    shotsRef.current = nextShots;
    onUpdateShots(nextShots);

    try {
      const scene = sceneMap.get(shot.sceneId);
      const { take, lock } = await renderShotTake({
        shot,
        scene,
        characters,
        config,
        currentKeyframes: currentKf,
        useLock,
        enableQC: true,
      });

      onDeductCredits(take.creditCost);
      creditRemainingRef.current -= take.creditCost;

      const existingTakes = shot.takes || [];
      const updatedTakes = [...existingTakes, take];

      nextShots = shotsRef.current.map((s) =>
        s.id === shot.id
          ? {
              ...s,
              takes: updatedTakes,
              activeTakeId: take.id,
              lock,
              renderStatus: 'done' as const,
              renderError: undefined,
            }
          : s
      );
      shotsRef.current = nextShots;
      onUpdateShots(nextShots);
      setSelectedVideoIds((prev) => new Set(prev).add(shot.id));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      nextShots = shotsRef.current.map((s) =>
        s.id === shot.id
          ? { ...s, renderStatus: 'error' as const, renderError: errMsg }
          : s
      );
      shotsRef.current = nextShots;
      onUpdateShots(nextShots);
      setGlobalRenderError(errMsg);
    } finally {
      setIsRendering(false);
      setCurrentRenderingShotId(null);
      setRenderProgressText('');
    }
  };

  // Khởi động render hàng loạt với kiểm tra chi phí và xác nhận 2 bước >= 200 cr
  const handleStartBatchAction = async (
    targetList: Shot[],
    actionType: 'missing' | 'failed' | 'stale' | 'low_qc'
  ) => {
    if (targetList.length === 0 || isRendering || isGeneratingKeyframes) return;

    const totalCost = calcBatchCost(targetList);

    if (totalCost > creditRemainingRef.current) {
      setGlobalRenderError(`Không thể chạy: Tổng chi phí ${totalCost} cr vượt quá ${creditRemainingRef.current} cr.`);
      return;
    }

    if (totalCost >= 200) {
      if (!confirmBatchRender || batchActionType !== actionType) {
        setConfirmBatchRender(true);
        setBatchActionType(actionType);
        setTimeout(() => {
          setConfirmBatchRender(false);
          setBatchActionType(null);
        }, 4000);
        return;
      }
    }

    setConfirmBatchRender(false);
    setBatchActionType(null);
    stopRequestedRef.current = false;
    pauseRequestedRef.current = false;
    setIsRendering(true);
    setIsPaused(false);
    setGlobalRenderError(null);

    const candidateIds = targetList.map((s) => s.id);
    const totalCount = candidateIds.length;

    for (let i = 0; i < totalCount; i++) {
      if (stopRequestedRef.current) break;

      while (pauseRequestedRef.current) {
        await new Promise((r) => setTimeout(r, 400));
        if (stopRequestedRef.current) break;
      }
      if (stopRequestedRef.current) break;

      const targetShotId = candidateIds[i];
      const freshShot = shotsRef.current.find((s) => s.id === targetShotId);
      if (!freshShot) continue;

      const currentKf = getShotKeyframes(freshShot, shotsRef.current);
      if (!currentKf.isReady && !freshShot.lock) continue;

      const eff = getEffectiveShotRenderConfig(freshShot, config);
      if (eff.cost > creditRemainingRef.current) {
        setGlobalRenderError(`DỪNG HÀNG ĐỢI: Không đủ credit cho shot #${freshShot.order}.`);
        break;
      }

      setCurrentRenderingShotId(freshShot.id);
      setRenderProgressText(`Đang render ${i + 1}/${totalCount} (#${freshShot.order})...`);

      try {
        const scene = sceneMap.get(freshShot.sceneId);
        const useLock = Boolean(freshShot.lock);

        const { take, lock } = await renderShotTake({
          shot: freshShot,
          scene,
          characters,
          config,
          currentKeyframes: currentKf,
          useLock,
          enableQC: true,
        });

        onDeductCredits(take.creditCost);
        creditRemainingRef.current -= take.creditCost;

        const updatedTakes = [...(freshShot.takes || []), take];
        const nextList = shotsRef.current.map((s) =>
          s.id === freshShot.id
            ? {
                ...s,
                takes: updatedTakes,
                activeTakeId: take.id,
                lock,
                renderStatus: 'done' as const,
                renderError: undefined,
              }
            : s
        );
        shotsRef.current = nextList;
        onUpdateShots(nextList);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const nextList = shotsRef.current.map((s) =>
          s.id === freshShot.id
            ? { ...s, renderStatus: 'error' as const, renderError: errMsg }
            : s
        );
        shotsRef.current = nextList;
        onUpdateShots(nextList);

        if (isQuotaOrCreditError(errMsg)) {
          setGlobalRenderError(`DỪNG HÀNG ĐỢI: Lỗi quota/credit (${errMsg}).`);
          break;
        }
      }
    }

    setIsRendering(false);
    setIsPaused(false);
    setCurrentRenderingShotId(null);
    setRenderProgressText('');
  };

  const handlePauseToggle = () => {
    if (isPaused) {
      pauseRequestedRef.current = false;
      setIsPaused(false);
    } else {
      pauseRequestedRef.current = true;
      setIsPaused(true);
    }
  };

  const handleStopRender = () => {
    stopRequestedRef.current = true;
    pauseRequestedRef.current = false;
    setIsPaused(false);
  };

  // Chọn take active
  const handleSelectActiveTake = (shotId: string, takeId: string) => {
    const nextShots = shots.map((s) =>
      s.id === shotId ? { ...s, activeTakeId: takeId } : s
    );
    shotsRef.current = nextShots;
    onUpdateShots(nextShots);
  };

  // Tải file qua downloadQueue
  const handleStartDownload = async (targetShotIds: string[]) => {
    if (targetShotIds.length === 0 || isDownloading) return;

    cancelDownloadRef.current = false;
    setIsDownloading(true);
    setDownloadSummary(null);

    const items: DownloadItem[] = [];

    targetShotIds.forEach((id) => {
      const sh = shots.find((s) => s.id === id);
      const activeTake = sh ? getActiveTake(sh) : undefined;
      if (sh && activeTake && activeTake.blobUrl) {
        const filename = generateVideoFilename(
          sh.order,
          sh.actionBeat,
          activeTake.model,
          activeTake.durationSeconds
        );
        items.push({
          id: sh.id,
          filename,
          blobUrl: activeTake.blobUrl,
          mimeType: 'video/mp4',
          sizeBytes: activeTake.sizeBytes,
          status: 'pending',
        });
      }
    });

    const result = await executeDownloadQueue(
      items,
      (status) => {
        if (status.currentItem) {
          const mb = (status.currentItem.sizeBytes / (1024 * 1024)).toFixed(1);
          setDownloadProgressText(
            `Đang tải ${status.currentIndex}/${status.total} — ${status.currentItem.filename} (${mb} MB)`
          );
        }
      },
      () => cancelDownloadRef.current
    );

    setIsDownloading(false);
    setDownloadProgressText('');
    setDownloadSummary({
      downloadedCount: result.downloadedCount,
      total: items.length,
      errors: result.errors,
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0a0a] overflow-hidden select-none">
      {/* Top Pre-Flight & Batch Toolbar */}
      <div className="p-3 bg-[#121212] border-b border-[#595959]/50 flex-shrink-0 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-400 text-lg">queue_play_next</span>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-100">
              Video Render Queue & Takes
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
              {config.videoModel} • {config.resolution} • {config.durationSeconds}s
            </span>
          </div>

          {/* Cảnh báo bộ nhớ blobUrl > 600 MB */}
          {isMemoryWarning && (
            <div className="px-2.5 py-1 rounded bg-amber-950/80 border border-amber-500/50 text-amber-300 text-xs font-mono flex items-center gap-1.5 animate-pulse">
              <span className="material-symbols-outlined text-[15px]">warning</span>
              <span>Tổng dung lượng clip: {totalBlobMB.toFixed(0)} MB. Nên tải về rồi xoá take thừa để giải phóng RAM.</span>
            </div>
          )}
        </div>

        {/* 4 Nút hàng loạt với số lượng & credit tính trước */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
          {/* Nút 1: Chưa có video */}
          <button
            type="button"
            disabled={shotsWithoutVideo.length === 0 || isRendering}
            onClick={() => handleStartBatchAction(shotsWithoutVideo, 'missing')}
            className={`p-2 rounded border text-left transition ${
              batchActionType === 'missing' && confirmBatchRender
                ? 'bg-red-600 text-white border-red-500 animate-pulse font-bold'
                : 'bg-[#181818] border-[#595959]/30 hover:border-amber-400 disabled:opacity-40'
            }`}
          >
            <div className="text-[10px] text-slate-400 uppercase">Render chưa có video</div>
            <div className="text-sm font-bold text-amber-300 mt-0.5">
              {shotsWithoutVideo.length} shots • {costMissing} cr
            </div>
            <div className="text-[9px] text-slate-500">
              {confirmBatchRender && batchActionType === 'missing' ? 'Click xác nhận ≥200 cr' : 'Chạy hàng đợi tuần tự'}
            </div>
          </button>

          {/* Nút 2: Shot lỗi */}
          <button
            type="button"
            disabled={shotsFailed.length === 0 || isRendering}
            onClick={() => handleStartBatchAction(shotsFailed, 'failed')}
            className={`p-2 rounded border text-left transition ${
              batchActionType === 'failed' && confirmBatchRender
                ? 'bg-red-600 text-white border-red-500 animate-pulse font-bold'
                : 'bg-[#181818] border-[#595959]/30 hover:border-amber-400 disabled:opacity-40'
            }`}
          >
            <div className="text-[10px] text-slate-400 uppercase">Render lại shot lỗi</div>
            <div className="text-sm font-bold text-red-400 mt-0.5">
              {shotsFailed.length} shots • {costFailed} cr
            </div>
            <div className="text-[9px] text-slate-500">
              {confirmBatchRender && batchActionType === 'failed' ? 'Click xác nhận ≥200 cr' : 'Thử lại các shot báo error'}
            </div>
          </button>

          {/* Nút 3: Shot lệch mạch */}
          <button
            type="button"
            disabled={shotsStale.length === 0 || isRendering}
            onClick={() => handleStartBatchAction(shotsStale, 'stale')}
            className={`p-2 rounded border text-left transition ${
              batchActionType === 'stale' && confirmBatchRender
                ? 'bg-red-600 text-white border-red-500 animate-pulse font-bold'
                : 'bg-[#181818] border-[#595959]/30 hover:border-amber-400 disabled:opacity-40'
            }`}
          >
            <div className="text-[10px] text-amber-300 uppercase">Render lại lệch mạch</div>
            <div className="text-sm font-bold text-amber-300 mt-0.5">
              {shotsStale.length} shots • {costStale} cr
            </div>
            <div className="text-[9px] text-slate-500">
              {confirmBatchRender && batchActionType === 'stale' ? 'Click xác nhận ≥200 cr' : 'Khớp keyframe vừa sửa'}
            </div>
          </button>

          {/* Nút 4: Điểm QC thấp < 60 */}
          <button
            type="button"
            disabled={shotsLowQC.length === 0 || isRendering}
            onClick={() => handleStartBatchAction(shotsLowQC, 'low_qc')}
            className={`p-2 rounded border text-left transition ${
              batchActionType === 'low_qc' && confirmBatchRender
                ? 'bg-red-600 text-white border-red-500 animate-pulse font-bold'
                : 'bg-[#181818] border-[#595959]/30 hover:border-amber-400 disabled:opacity-40'
            }`}
          >
            <div className="text-[10px] text-slate-400 uppercase">Quay lại QC thấp (&lt; 60)</div>
            <div className="text-sm font-bold text-rose-400 mt-0.5">
              {shotsLowQC.length} shots • {costLowQC} cr
            </div>
            <div className="text-[9px] text-slate-500">
              {confirmBatchRender && batchActionType === 'low_qc' ? 'Click xác nhận ≥200 cr' : 'Dùng bản khoá an toàn'}
            </div>
          </button>
        </div>

        {globalRenderError && (
          <div className="p-2 rounded bg-red-950/70 border border-red-500/50 text-red-200 text-xs font-mono flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-red-400">error</span>
              <span>{globalRenderError}</span>
            </div>
            <button
              type="button"
              onClick={() => setGlobalRenderError(null)}
              className="text-red-400 hover:text-white"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        )}

        {/* Thanh Pause/Stop khi render */}
        {isRendering && (
          <div className="flex items-center justify-between p-2 rounded bg-[#1b1b1b] border border-amber-500/40 text-xs font-mono">
            <div className="flex items-center gap-2 text-amber-300">
              <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
              <span>{renderProgressText || 'Đang render hàng đợi tuần tự...'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePauseToggle}
                className="px-2.5 py-1 rounded bg-[#2b2b2b] hover:bg-[#353535] text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center gap-1 transition"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {isPaused ? 'play_arrow' : 'pause'}
                </span>
                {isPaused ? 'Tiếp tục' : 'Tạm dừng'}
              </button>
              <button
                type="button"
                onClick={handleStopRender}
                className="px-2.5 py-1 rounded bg-red-950/70 hover:bg-red-900 text-red-300 border border-red-500/40 text-xs font-semibold flex items-center gap-1 transition"
              >
                <span className="material-symbols-outlined text-[14px]">stop</span>
                Dừng
              </button>
            </div>
          </div>
        )}
      </div>

      {/* BẢNG RENDER QUEUE GỌN (#, thumb, hành động, model, QC/status, các take chip, nút quay take) */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="rounded-xl bg-[#141414] border border-[#595959]/50 overflow-hidden shadow">
          <div className="bg-[#1c1c1c] border-b border-[#595959]/40 px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400 text-base">table_chart</span>
              <span className="font-bold text-xs uppercase tracking-wide text-slate-200">
                Bảng Hàng Đợi Render & Takes ({shots.length} shots)
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-[#26262b]">
              <thead className="bg-[#161619] text-[10px] uppercase font-mono text-slate-400">
                <tr>
                  <th className="py-2 px-3 w-12">#</th>
                  <th className="py-2 px-3 w-20">Thumb</th>
                  <th className="py-2 px-3 min-w-[200px]">Hành động & Ghi chú</th>
                  <th className="py-2 px-3 w-28">Model</th>
                  <th className="py-2 px-3 w-36">Trạng thái / QC</th>
                  <th className="py-2 px-3 min-w-[160px]">Các Take</th>
                  <th className="py-2 px-3 text-right w-36">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26262b] font-mono text-[11px]">
                {shots.map((shot) => {
                  const activeTake = getActiveTake(shot);
                  const eff = getEffectiveShotRenderConfig(shot, config);
                  const currentKf = getShotKeyframes(shot, shots);
                  const isStale = activeTake ? checkTakeStaleness(activeTake, currentKf) : false;
                  const isCurrentRendering = currentRenderingShotId === shot.id;

                  let qcBadgeClass = 'bg-[#6b6b75]/20 text-slate-400 border-slate-600';
                  let qcText = 'Chưa QC';
                  if (activeTake?.qc) {
                    if (activeTake.qc.totalScore >= 80) {
                      qcBadgeClass = 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50';
                      qcText = `OK (${activeTake.qc.totalScore})`;
                    } else if (activeTake.qc.totalScore >= 60) {
                      qcBadgeClass = 'bg-amber-950/80 text-amber-300 border-amber-500/50';
                      qcText = `Xem lại (${activeTake.qc.totalScore})`;
                    } else {
                      qcBadgeClass = 'bg-red-950/80 text-red-300 border-red-500/50';
                      qcText = `Quay lại (${activeTake.qc.totalScore})`;
                    }
                  }

                  return (
                    <tr
                      key={shot.id}
                      className={`hover:bg-[#18181d] transition ${
                        isCurrentRendering ? 'bg-amber-500/10' : ''
                      }`}
                    >
                      {/* # */}
                      <td className="py-2.5 px-3 font-bold text-amber-400">
                        #{shot.order}
                      </td>

                      {/* Thumb */}
                      <td className="py-2.5 px-3">
                        <div className="w-16 h-10 rounded bg-black overflow-hidden border border-[#26262b] flex items-center justify-center">
                          {shot.startKeyframe?.thumbBase64 ? (
                            <img
                              src={`data:image/jpeg;base64,${shot.startKeyframe.thumbBase64}`}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-[10px] text-slate-600">No KF</span>
                          )}
                        </div>
                      </td>

                      {/* Tóm tắt hành động */}
                      <td className="py-2.5 px-3 font-sans">
                        <div className="font-semibold text-slate-200 line-clamp-1 max-w-sm" title={shot.actionBeat}>
                          {shot.actionBeat}
                        </div>
                        {isStale && (
                          <div className="text-[10px] text-amber-400 font-mono mt-0.5 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">warning</span>
                            ⚠ Keyframe đã đổi — clip không còn khớp mạch
                          </div>
                        )}
                      </td>

                      {/* Model override */}
                      <td className="py-2.5 px-3">
                        <span className="text-slate-300 block truncate" title={eff.model}>
                          {eff.model.split(' ')[0]}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {eff.durationSeconds}s • {eff.resolution}
                        </span>
                      </td>

                      {/* Trạng thái / QC */}
                      <td className="py-2.5 px-3">
                        {isCurrentRendering ? (
                          <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40 text-[10px] animate-pulse">
                            Rendering...
                          </span>
                        ) : activeTake ? (
                          <div className="space-y-0.5">
                            <div className="relative group inline-block">
                              <span className={`px-1.5 py-0.2 rounded text-[10px] border font-bold cursor-help ${qcBadgeClass}`}>
                                {qcText}
                              </span>
                              {activeTake.qc && (
                                <div className="absolute left-0 bottom-full mb-1.5 hidden group-hover:block z-30 p-2.5 rounded bg-[#0d0d10] border border-[#26262b] text-[10px] font-mono shadow-2xl w-56 text-slate-300 space-y-0.5">
                                  <div>• Điểm: {activeTake.qc.totalScore}/100</div>
                                  {activeTake.qc.artifacts.length > 0 && (
                                    <div className="text-red-300">• Lỗi: {activeTake.qc.artifacts.join(', ')}</div>
                                  )}
                                  <div className="italic text-slate-400">"{activeTake.qc.note}"</div>
                                </div>
                              )}
                            </div>
                            <span className="text-[9px] text-slate-500 block">
                              Take #{((shot.takes || []).findIndex((t) => t.id === activeTake.id) + 1) || 1}
                            </span>
                          </div>
                        ) : shot.renderStatus === 'error' ? (
                          <span className="px-1.5 py-0.2 rounded bg-red-950 text-red-300 border border-red-500/40 text-[10px]">
                            Lỗi
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[10px]">Chưa render</span>
                        )}
                      </td>

                      {/* Các Takes (chips) */}
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {(!shot.takes || shot.takes.length === 0) ? (
                            <span className="text-[10px] text-slate-600 italic">—</span>
                          ) : (
                            shot.takes.map((tk, tIdx) => {
                              const isTkActive = tk.id === (shot.activeTakeId || shot.takes![shot.takes!.length - 1].id);
                              return (
                                <button
                                  key={tk.id}
                                  type="button"
                                  onClick={() => handleSelectActiveTake(shot.id, tk.id)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${
                                    isTkActive
                                      ? 'bg-amber-500 text-black font-bold shadow'
                                      : 'bg-[#222] text-slate-400 hover:text-white border border-[#26262b]'
                                  }`}
                                  title={`Take #${tIdx + 1} (${tk.model})`}
                                >
                                  T{tIdx + 1}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </td>

                      {/* Nút Quay take mới (x cr) */}
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          disabled={isRendering || (!currentKf.isReady && !shot.lock)}
                          onClick={() => handleRenderSingleTake(shot, Boolean(shot.lock))}
                          className="px-2.5 py-1 rounded bg-[#222] hover:bg-[#2c2c34] text-amber-300 border border-amber-500/40 text-[10px] font-semibold transition disabled:opacity-30 inline-flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[13px]">videocam</span>
                          <span>Quay ({eff.cost} cr)</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* SECTION 2: TẢI VIDEO XUỐNG */}
        {shotsWithVideos.length > 0 && (
          <div className="p-3 bg-[#141414] border border-[#595959]/50 rounded-xl space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-slate-300 font-bold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-emerald-400 text-base">download_done</span>
                Tải xuống video ({shotsWithVideos.length} clip active)
              </span>

              <button
                type="button"
                disabled={isDownloading}
                onClick={() => handleStartDownload(shotsWithVideos.map((s) => s.id))}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition shadow"
              >
                <span className="material-symbols-outlined text-[15px]">download</span>
                Tải tất cả clip ({shotsWithVideos.length})
              </button>
            </div>

            {isDownloading && (
              <div className="p-2 rounded bg-[#181818] border border-emerald-500/40 text-emerald-300 text-xs">
                {downloadProgressText}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
