import React, { useState, useMemo } from 'react';
import {
  Shot,
  Scene,
  ProjectConfig,
  getActiveTake,
  ShotsUpdate,
} from '../services/types';
import { getShotKeyframes, checkTakeStaleness } from '../services/renderService';
import {
  generateTakeExportFilename,
  downloadPostProductionKit,
  downloadSingleKitFile,
} from '../services/exportKit';
import {
  DownloadItem,
  executeDownloadQueue,
} from '../services/downloadQueue';
import { reloadTakeBlobFromGallery } from '../services/sessionService';

interface ExportStepProps {
  projectTitle: string;
  config: ProjectConfig;
  scenes: Scene[];
  shots: Shot[];
  onUpdateShots: (update: ShotsUpdate) => void;
  onShowToast: (text: string, type?: 'success' | 'error' | 'info') => void;
}

export const ExportStep: React.FC<ExportStepProps> = ({
  projectTitle,
  config,
  scenes,
  shots,
  onUpdateShots,
  onShowToast,
}) => {
  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(new Set());
  const [includeKeyframeThumbs, setIncludeKeyframeThumbs] = useState<boolean>(false);

  // Trạng thái tải clip qua hàng đợi
  const [isDownloadingClips, setIsDownloadingClips] = useState(false);
  const [clipDownloadProgress, setClipDownloadProgress] = useState<string>('');

  // Trạng thái tải gói hậu kỳ 4 file
  const [isDownloadingKit, setIsDownloadingKit] = useState(false);
  const [kitDownloadProgress, setKitDownloadProgress] = useState<string>('');
  const [kitFailedFiles, setKitFailedFiles] = useState<Array<{
    filename: string;
    error: string;
    content: string;
    mimeType: 'application/json' | 'text/plain' | 'text/markdown';
  }>>([]);
  const [retryingFileName, setRetryingFileName] = useState<string | null>(null);

  // Nạp lại blob cho take
  const [reloadingShotId, setReloadingShotId] = useState<string | null>(null);

  // Hộp thoại cảnh báo chọn mediaId khác
  const [pendingReloadConflict, setPendingReloadConflict] = useState<{
    shotId: string;
    shotOrder: number;
    takeIndex: number;
    expectedMediaId?: string;
    selectedMediaId: string;
    blobUrl: string;
    sizeBytes: number;
  } | null>(null);

  // Đánh dấu các shot cần nạp lại blob sau khi người dùng bấm tải
  const [highlightNeedReloadIds, setHighlightNeedReloadIds] = useState<Set<string>>(new Set());

  const sceneMap = useMemo(() => {
    const map = new Map<string, Scene>();
    scenes.forEach((s) => map.set(s.id, s));
    return map;
  }, [scenes]);

  // Kiểm tra cảnh báo (không chặn)
  const warningStats = useMemo(() => {
    let missingVideoCount = 0;
    let staleCount = 0;
    let redQCCount = 0;

    shots.forEach((sh) => {
      const take = getActiveTake(sh);
      if (!take) {
        missingVideoCount++;
      } else {
        const kf = getShotKeyframes(sh, shots);
        if (checkTakeStaleness(take, kf)) {
          staleCount++;
        }
        if (take.qc && take.qc.verdict === 'rerender') {
          redQCCount++;
        }
      }
    });

    return {
      missingVideoCount,
      staleCount,
      redQCCount,
      hasWarnings: missingVideoCount > 0 || staleCount > 0 || redQCCount > 0,
    };
  }, [shots]);

  const toggleSelectShot = (shotId: string) => {
    setSelectedShotIds((prev) => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedShotIds.size === shots.length) {
      setSelectedShotIds(new Set());
    } else {
      setSelectedShotIds(new Set(shots.map((s) => s.id)));
    }
  };

  // Helper thực hiện áp dụng video đã nạp vào state mới nhất bằng onUpdateShots(prev => ...)
  const applyReloadedVideoToShot = (
    shotId: string,
    mediaId: string,
    blobUrl: string,
    sizeBytes: number
  ) => {
    onUpdateShots((prevShots: Shot[]) =>
      prevShots.map((s) => {
        if (s.id !== shotId) return s;
        const currentActive = getActiveTake(s);
        const updatedTakes = (s.takes || []).map((t) => {
          if (currentActive && t.id === currentActive.id) {
            return {
              ...t,
              mediaId,
              blobUrl,
              sizeBytes,
            };
          }
          return t;
        });

        return {
          ...s,
          takes: updatedTakes,
          video: s.video
            ? {
                ...s.video,
                mediaId,
                blobUrl,
                sizeBytes,
              }
            : undefined,
        };
      })
    );

    setHighlightNeedReloadIds((prev) => {
      const next = new Set(prev);
      next.delete(shotId);
      return next;
    });
  };

  // Nạp lại blob cho take từ thư viện Flow
  const handleReloadBlobForTake = async (shot: Shot) => {
    const activeTake = getActiveTake(shot);
    if (!activeTake) return;

    setReloadingShotId(shot.id);
    try {
      const reloaded = await reloadTakeBlobFromGallery();
      const takeIdx = (shot.takes && activeTake)
        ? Math.max(1, shot.takes.findIndex((t) => t.id === activeTake.id) + 1)
        : 1;

      // Nếu video chọn có mediaId khác take.mediaId thì KHÔNG ghi đè ngay, hiện cảnh báo
      if (activeTake.mediaId && reloaded.mediaId !== activeTake.mediaId) {
        setPendingReloadConflict({
          shotId: shot.id,
          shotOrder: shot.order,
          takeIndex: takeIdx,
          expectedMediaId: activeTake.mediaId,
          selectedMediaId: reloaded.mediaId,
          blobUrl: reloaded.blobUrl,
          sizeBytes: reloaded.sizeBytes,
        });
        return;
      }

      // Khớp mediaId -> Áp dụng ngay
      applyReloadedVideoToShot(shot.id, reloaded.mediaId, reloaded.blobUrl, reloaded.sizeBytes);
      onShowToast(`Đã nạp lại video cho Shot #${shot.order} từ thư viện Flow!`, 'success');
    } catch (err: unknown) {
      onShowToast(err instanceof Error ? err.message : 'Nạp lại video thất bại', 'error');
    } finally {
      setReloadingShotId(null);
    }
  };

  const handleConfirmConflictUse = () => {
    if (!pendingReloadConflict) return;
    const { shotId, shotOrder, selectedMediaId, blobUrl, sizeBytes } = pendingReloadConflict;
    applyReloadedVideoToShot(shotId, selectedMediaId, blobUrl, sizeBytes);
    onShowToast(`Đã gán video mới cho Shot #${shotOrder}!`, 'success');
    setPendingReloadConflict(null);
  };

  const handleCancelConflict = () => {
    if (pendingReloadConflict?.blobUrl) {
      URL.revokeObjectURL(pendingReloadConflict.blobUrl);
    }
    setPendingReloadConflict(null);
  };

  /**
   * Tải danh sách clip:
   * - Bỏ qua các take khôi phục không có blobUrl
   * - Hiện toast cảnh báo: "N clip cần 'Nạp lại từ thư viện' trước khi tải: #1, #2"
   * - Đánh dấu viền các dòng đó
   * - Chỉ tải các clip có blobUrl
   */
  const handleDownloadClips = async (targetShotList: Shot[]) => {
    if (targetShotList.length === 0 || isDownloadingClips) return;

    const shotsNeedingReload: Shot[] = [];
    const validItemsToDownload: DownloadItem[] = [];

    for (const sh of targetShotList) {
      const activeTake = getActiveTake(sh);
      const sc = sceneMap.get(sh.sceneId);
      const takeIdx = (sh.takes && activeTake)
        ? Math.max(1, sh.takes.findIndex((t) => t.id === activeTake.id) + 1)
        : 1;

      const clipFilename = generateTakeExportFilename({
        projectTitle,
        order: sh.order,
        sceneTitle: sc?.title || 'Scene',
        actionBeat: sh.actionBeat || 'shot',
        takeIndex: takeIdx,
      });

      if (activeTake) {
        if (activeTake.blobUrl) {
          validItemsToDownload.push({
            id: `clip_${sh.id}`,
            filename: clipFilename,
            blobUrl: activeTake.blobUrl,
            mimeType: 'video/mp4',
            sizeBytes: activeTake.sizeBytes || 0,
            status: 'pending',
          });
        } else {
          // Take khôi phục từ file phiên chưa nạp lại blob
          shotsNeedingReload.push(sh);
        }
      }

      // Tùy chọn kèm keyframe (.jpg) thumbnail nếu có
      if (includeKeyframeThumbs) {
        if (sh.startKeyframe?.thumbBase64) {
          const kfName = clipFilename.replace(/\.mp4$/i, '_start_thumb.jpg');
          validItemsToDownload.push({
            id: `kf_start_${sh.id}`,
            filename: kfName,
            base64: sh.startKeyframe.thumbBase64,
            mimeType: 'image/jpeg',
            sizeBytes: 15000,
            status: 'pending',
          });
        }
        if (sh.endKeyframe?.thumbBase64 && sh.endKeyframe !== sh.startKeyframe) {
          const kfName = clipFilename.replace(/\.mp4$/i, '_end_thumb.jpg');
          validItemsToDownload.push({
            id: `kf_end_${sh.id}`,
            filename: kfName,
            base64: sh.endKeyframe.thumbBase64,
            mimeType: 'image/jpeg',
            sizeBytes: 15000,
            status: 'pending',
          });
        }
      }
    }

    // Nếu có shot cần nạp lại blob -> cảnh báo toast và đánh dấu dòng
    if (shotsNeedingReload.length > 0) {
      const missingList = shotsNeedingReload.map((s) => `#${s.order}`).join(', ');
      setHighlightNeedReloadIds(new Set(shotsNeedingReload.map((s) => s.id)));
      onShowToast(
        `${shotsNeedingReload.length} clip cần "Nạp lại từ thư viện" trước khi tải: ${missingList}`,
        'info'
      );
    }

    if (validItemsToDownload.length === 0) {
      if (shotsNeedingReload.length === 0) {
        onShowToast('Không có clip nào có sẵn file để tải.', 'info');
      }
      return;
    }

    setIsDownloadingClips(true);
    setClipDownloadProgress(`Đang tải ${validItemsToDownload.length} file có sẵn...`);

    try {
      const result = await executeDownloadQueue(
        validItemsToDownload,
        (status) => {
          if (status.currentItem) {
            setClipDownloadProgress(
              `Đang tải ${status.currentIndex}/${status.total}: ${status.currentItem.filename} (${status.downloadedCount} thành công)`
            );
          }
        },
        () => false
      );

      if (result.errors.length > 0) {
        onShowToast(`Đã tải ${result.downloadedCount}/${validItemsToDownload.length} file (có ${result.errors.length} file lỗi).`, 'error');
      } else {
        onShowToast(`Đã tải xong ${result.downloadedCount} clip có sẵn về máy!`, 'success');
      }
    } catch (err: unknown) {
      onShowToast(err instanceof Error ? err.message : 'Tải clip thất bại', 'error');
    } finally {
      setIsDownloadingClips(false);
      setClipDownloadProgress('');
    }
  };

  // Tải gói hậu kỳ 4 file
  const handleDownloadPostKit = async () => {
    if (isDownloadingKit) return;
    setIsDownloadingKit(true);
    setKitDownloadProgress('Đang tạo và tải 4 file hậu kỳ...');
    setKitFailedFiles([]);

    try {
      const res = await downloadPostProductionKit({
        projectTitle,
        config,
        scenes,
        shots,
        onProgress: (idx, total, fname) => {
          setKitDownloadProgress(`Đang tải file ${idx}/${total}: ${fname}`);
        },
      });

      if (res.failedFiles.length > 0) {
        setKitFailedFiles(res.failedFiles);
        onShowToast(`Đã tải ${res.downloadedFiles.length} file; còn ${res.failedFiles.length} file lỗi cần tải lại.`, 'error');
      } else {
        onShowToast(`Đã tải đủ 4 file Gói Hậu Kỳ (${res.downloadedFiles.join(', ')})`, 'success');
      }
    } catch (err: unknown) {
      onShowToast(err instanceof Error ? err.message : 'Tải gói hậu kỳ thất bại', 'error');
    } finally {
      setIsDownloadingKit(false);
      setKitDownloadProgress('');
    }
  };

  // Tải lại riêng 1 file hậu kỳ bị lỗi
  const handleRetrySingleKitFile = async (failedFile: {
    filename: string;
    error: string;
    content: string;
    mimeType: 'application/json' | 'text/plain' | 'text/markdown';
  }) => {
    setRetryingFileName(failedFile.filename);
    try {
      await downloadSingleKitFile(failedFile);
      setKitFailedFiles((prev) => prev.filter((f) => f.filename !== failedFile.filename));
      onShowToast(`Đã tải lại thành công ${failedFile.filename}!`, 'success');
    } catch (err: unknown) {
      onShowToast(`Tải lại thất bại: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setRetryingFileName(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0b0d] overflow-y-auto p-4 md:p-6 space-y-6 select-none">
      <div className="max-w-5xl mx-auto w-full space-y-6">
        {/* Banner cảnh báo không chặn */}
        {warningStats.hasWarnings && (
          <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/50 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-2 text-amber-300">
              <span className="material-symbols-outlined text-base">warning</span>
              <span className="font-bold">Cảnh báo kiểm tra hậu kỳ:</span>
              <div className="flex items-center gap-2 text-[11px] text-slate-300 flex-wrap">
                {warningStats.missingVideoCount > 0 && (
                  <span className="text-amber-400">• {warningStats.missingVideoCount} shot thiếu video</span>
                )}
                {warningStats.staleCount > 0 && (
                  <span className="text-amber-400">• {warningStats.staleCount} shot lệch mạch</span>
                )}
                {warningStats.redQCCount > 0 && (
                  <span className="text-red-400">• {warningStats.redQCCount} shot QC đỏ</span>
                )}
              </div>
            </div>
            <span className="text-[10px] text-slate-400 italic">
              (Không chặn xuất bản — bạn vẫn có thể tải các clip hiện có)
            </span>
          </div>
        )}

        {/* Modal cảnh báo xung đột mediaId khi nạp lại từ thư viện */}
        {pendingReloadConflict && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="max-w-md w-full bg-[#18181d] border border-amber-500/60 rounded-xl p-4 shadow-2xl space-y-3 font-mono text-xs">
              <div className="flex items-center gap-2 text-amber-300 font-bold text-sm border-b border-[#26262b] pb-2">
                <span className="material-symbols-outlined text-lg">warning</span>
                <span>Cảnh báo khớp video Take</span>
              </div>

              <p className="text-slate-200 text-[12px] font-sans leading-relaxed">
                Video vừa chọn có mã ID <span className="font-mono text-amber-300">...{pendingReloadConflict.selectedMediaId.slice(-8)}</span>,
                không phải take #{pendingReloadConflict.takeIndex} của shot #{pendingReloadConflict.shotOrder} (mã cũ: <span className="font-mono text-slate-400">...{pendingReloadConflict.expectedMediaId?.slice(-8) || 'chưa có'}</span>).
              </p>

              <div className="p-2.5 rounded bg-[#101014] border border-[#26262b] text-[11px] text-slate-300 space-y-1">
                <div>• Dung lượng: {(pendingReloadConflict.sizeBytes / (1024 * 1024)).toFixed(1)} MB</div>
                <div className="text-slate-400 italic font-sans">
                  Bạn có chắc muốn dùng video này làm clip của shot #{pendingReloadConflict.shotOrder}?
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#26262b]">
                <button
                  type="button"
                  onClick={handleCancelConflict}
                  className="px-3 py-1.5 rounded bg-[#25252b] hover:bg-[#303038] text-slate-300 font-medium transition"
                >
                  Huỷ
                </button>
                <button
                  type="button"
                  onClick={handleConfirmConflictUse}
                  className="px-3.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold transition shadow"
                >
                  Vẫn dùng video này
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= KHỐI 1: CLIP THEO THỨ TỰ ================= */}
        <section className="bg-[#141417] border border-[#26262b] rounded-xl overflow-hidden shadow-lg space-y-0">
          <div className="p-3.5 bg-[#18181d] border-b border-[#26262b] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f5b301] text-lg">format_list_numbered</span>
              <h3 className="font-bold text-sm text-[#ececef] uppercase tracking-wide">
                1. Clip Theo Thứ Tự ({shots.length} shots)
              </h3>
            </div>

            {/* Bộ công cụ tải clip */}
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-slate-300 font-mono cursor-pointer bg-[#1c1c22] px-2.5 py-1 rounded border border-[#26262b]">
                <input
                  type="checkbox"
                  checked={includeKeyframeThumbs}
                  onChange={(e) => setIncludeKeyframeThumbs(e.target.checked)}
                  className="accent-amber-500 rounded"
                />
                <span>Kèm keyframe (.jpg)</span>
                <span className="text-[10px] text-slate-500">(ảnh thu nhỏ)</span>
              </label>

              <button
                type="button"
                disabled={isDownloadingClips || shots.length === 0}
                onClick={() => handleDownloadClips(shots)}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-1.5 transition shadow"
              >
                <span className="material-symbols-outlined text-[15px]">download</span>
                Tải tất cả clip ({shots.length})
              </button>

              <button
                type="button"
                disabled={isDownloadingClips || selectedShotIds.size === 0}
                onClick={() => handleDownloadClips(shots.filter((s) => selectedShotIds.has(s.id)))}
                className="px-3 py-1.5 rounded bg-[#202026] hover:bg-[#282832] disabled:opacity-40 text-amber-300 border border-amber-500/40 font-semibold text-xs flex items-center gap-1.5 transition"
              >
                <span className="material-symbols-outlined text-[15px]">done</span>
                Tải đã chọn ({selectedShotIds.size})
              </button>
            </div>
          </div>

          {isDownloadingClips && (
            <div className="p-2.5 bg-emerald-950/60 border-b border-emerald-500/40 text-emerald-300 text-xs font-mono flex items-center gap-2 animate-pulse">
              <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
              <span>{clipDownloadProgress}</span>
            </div>
          )}

          {/* Bảng danh sách shot */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-[#26262b]">
              <thead className="bg-[#121215] text-[10px] uppercase font-mono text-slate-400">
                <tr>
                  <th className="py-2.5 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedShotIds.size === shots.length && shots.length > 0}
                      onChange={handleSelectAll}
                      className="accent-amber-500 rounded"
                    />
                  </th>
                  <th className="py-2.5 px-3 w-12">#</th>
                  <th className="py-2.5 px-3 w-20">Thumb</th>
                  <th className="py-2.5 px-3 min-w-[200px]">Tên File Xuất / Hành Động</th>
                  <th className="py-2.5 px-3 w-24">Thời lượng</th>
                  <th className="py-2.5 px-3 w-28">QC</th>
                  <th className="py-2.5 px-3 w-32">Trạng thái clip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26262b] font-mono text-[11px]">
                {shots.map((sh) => {
                  const activeTake = getActiveTake(sh);
                  const sc = sceneMap.get(sh.sceneId);
                  const isSelected = selectedShotIds.has(sh.id);

                  const takeIdx = (sh.takes && activeTake)
                    ? Math.max(1, sh.takes.findIndex((t) => t.id === activeTake.id) + 1)
                    : 1;

                  const fileName = generateTakeExportFilename({
                    projectTitle,
                    order: sh.order,
                    sceneTitle: sc?.title || 'Scene',
                    actionBeat: sh.actionBeat || 'shot',
                    takeIndex: takeIdx,
                  });

                  const currentKf = getShotKeyframes(sh, shots);
                  const isStale = activeTake ? checkTakeStaleness(activeTake, currentKf) : false;

                  let qcBadge = <span className="text-slate-500 text-[10px]">Chưa QC</span>;
                  if (activeTake?.qc) {
                    if (activeTake.qc.verdict === 'ok') {
                      qcBadge = (
                        <span className="px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
                          OK ({activeTake.qc.totalScore})
                        </span>
                      );
                    } else if (activeTake.qc.verdict === 'review') {
                      qcBadge = (
                        <span className="px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-500/40 text-[10px] font-bold">
                          Xem lại ({activeTake.qc.totalScore})
                        </span>
                      );
                    } else {
                      qcBadge = (
                        <span className="px-1.5 py-0.2 rounded bg-red-950/80 text-red-300 border border-red-500/40 text-[10px] font-bold">
                          Đỏ ({activeTake.qc.totalScore})
                        </span>
                      );
                    }
                  }

                  const hasBlob = Boolean(activeTake?.blobUrl);
                  const isReloading = reloadingShotId === sh.id;
                  const isNeedsReloadHighlight = highlightNeedReloadIds.has(sh.id) && !hasBlob;

                  return (
                    <tr
                      key={sh.id}
                      className={`hover:bg-[#181820] transition ${
                        isNeedsReloadHighlight
                          ? 'bg-amber-500/10 border-l-2 border-l-amber-400'
                          : isSelected
                          ? 'bg-amber-500/5'
                          : ''
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectShot(sh.id)}
                          className="accent-amber-500 rounded"
                        />
                      </td>

                      <td className="py-2.5 px-3 font-bold text-amber-400">
                        #{sh.order}
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="w-16 h-10 rounded bg-black overflow-hidden border border-[#26262b] flex items-center justify-center">
                          {sh.startKeyframe?.thumbBase64 ? (
                            <img
                              src={`data:image/jpeg;base64,${sh.startKeyframe.thumbBase64}`}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-[9px] text-slate-600">No KF</span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 font-sans">
                        <div className="font-mono text-emerald-400 text-[11px] font-semibold truncate max-w-md" title={fileName}>
                          {fileName}
                        </div>
                        <div className="text-[11px] text-slate-300 line-clamp-1 mt-0.5" title={sh.actionBeat}>
                          {sh.actionBeat}
                        </div>
                        {isStale && (
                          <div className="text-[10px] text-amber-400 font-mono mt-0.5 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">warning</span>
                            Cờ lệch mạch (keyframe đã đổi)
                          </div>
                        )}
                        {isNeedsReloadHighlight && (
                          <div className="text-[10px] text-amber-300 font-mono mt-0.5 flex items-center gap-1 animate-pulse">
                            <span className="material-symbols-outlined text-[12px]">cloud_sync</span>
                            Cần nạp lại từ thư viện trước khi tải file này
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-slate-300 font-mono">
                        {activeTake?.durationSeconds || sh.durationOverride || config.durationSeconds}s
                      </td>

                      <td className="py-2.5 px-3">
                        {qcBadge}
                      </td>

                      <td className="py-2.5 px-3">
                        {activeTake ? (
                          hasBlob ? (
                            <span className="text-emerald-400 text-[10px] flex items-center gap-1">
                              <span className="material-symbols-outlined text-[13px]">check_circle</span>
                              Sẵn sàng
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <span className="text-amber-400 text-[10px] block">Cần nạp blob</span>
                              <button
                                type="button"
                                disabled={isReloading}
                                onClick={() => handleReloadBlobForTake(sh)}
                                className="px-2 py-0.5 rounded bg-[#25252b] hover:bg-[#303038] text-amber-300 border border-amber-500/30 text-[10px] flex items-center gap-1 transition"
                              >
                                <span className={`material-symbols-outlined text-[11px] ${isReloading ? 'animate-spin' : ''}`}>
                                  {isReloading ? 'progress_activity' : 'cloud_download'}
                                </span>
                                {isReloading ? 'Đang nạp...' : 'Nạp lại từ thư viện'}
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="text-red-400 text-[10px]">Thiếu video</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ================= KHỐI 2: GÓI HẬU KỲ (4 FILE) ================= */}
        <section className="bg-[#141417] border border-[#26262b] rounded-xl p-4 space-y-3 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#26262b] pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f5b301] text-lg">inventory_2</span>
              <h3 className="font-bold text-sm text-[#ececef] uppercase tracking-wide">
                2. Gói Hậu Kỳ (4 File Chuẩn)
              </h3>
            </div>

            <button
              type="button"
              disabled={isDownloadingKit || shots.length === 0}
              onClick={handleDownloadPostKit}
              className="px-4 py-1.5 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold text-xs flex items-center gap-1.5 transition shadow"
            >
              <span className={`material-symbols-outlined text-[16px] ${isDownloadingKit ? 'animate-spin' : ''}`}>
                {isDownloadingKit ? 'progress_activity' : 'folder_zip'}
              </span>
              Tải gói hậu kỳ (4 file)
            </button>
          </div>

          {isDownloadingKit && (
            <div className="p-2.5 bg-amber-950/60 border border-amber-500/40 rounded text-amber-300 text-xs font-mono flex items-center gap-2 animate-pulse">
              <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
              <span>{kitDownloadProgress}</span>
            </div>
          )}

          {/* Danh sách file hậu kỳ bị lỗi kèm nút tải lại riêng */}
          {kitFailedFiles.length > 0 && (
            <div className="p-3 bg-red-950/40 border border-red-500/50 rounded-lg space-y-2 font-mono text-xs">
              <div className="flex items-center gap-2 text-red-300 font-bold">
                <span className="material-symbols-outlined text-base">error</span>
                <span>Có {kitFailedFiles.length} file chưa tải được:</span>
              </div>
              <div className="space-y-1.5">
                {kitFailedFiles.map((ff) => (
                  <div
                    key={ff.filename}
                    className="flex items-center justify-between p-2 rounded bg-[#16161b] border border-[#26262b] text-[11px]"
                  >
                    <div>
                      <span className="text-white font-semibold">{ff.filename}</span>
                      <span className="text-red-400 block text-[10px] mt-0.5">Lỗi: {ff.error}</span>
                    </div>
                    <button
                      type="button"
                      disabled={retryingFileName === ff.filename}
                      onClick={() => handleRetrySingleKitFile(ff)}
                      className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center gap-1 transition shadow"
                    >
                      <span className={`material-symbols-outlined text-[13px] ${retryingFileName === ff.filename ? 'animate-spin' : ''}`}>
                        {retryingFileName === ff.filename ? 'progress_activity' : 'refresh'}
                      </span>
                      Tải lại file này
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-2.5 rounded bg-[#101014] border border-[#26262b] space-y-1">
              <div className="text-amber-300 font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">data_object</span>
                <span>edit_manifest.json</span>
              </div>
              <p className="text-[11px] text-slate-400 font-sans">
                Chứa cấu trúc dự án, danh sách scene, shot với tên file clip, thời lượng, chuyển cảnh, lời dẫn, SFX, hiệu ứng, và điểm QC.
              </p>
            </div>

            <div className="p-2.5 rounded bg-[#101014] border border-[#26262b] space-y-1">
              <div className="text-amber-300 font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">terminal</span>
                <span>concat_list.txt</span>
              </div>
              <p className="text-[11px] text-slate-400 font-sans">
                Mỗi dòng `file '&lt;fileName&gt;'` theo đúng thứ tự để nối nhanh bằng lệnh ffmpeg concat mà không cần render lại.
              </p>
            </div>

            <div className="p-2.5 rounded bg-[#101014] border border-[#26262b] space-y-1">
              <div className="text-amber-300 font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">subtitles</span>
                <span>narration.txt</span>
              </div>
              <p className="text-[11px] text-slate-400 font-sans">
                Lời dẫn giọng đọc theo mốc thời gian cộng dồn `[00:08.0 – 00:16.0] #2 ...` để thu âm hoặc tạo voice-over.
              </p>
            </div>

            <div className="p-2.5 rounded bg-[#101014] border border-[#26262b] space-y-1">
              <div className="text-amber-300 font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">table_chart</span>
                <span>storyboard.md</span>
              </div>
              <p className="text-[11px] text-slate-400 font-sans">
                Bảng markdown tổng hợp (#, Scene, Tên clip, Máy quay, Lời dẫn, Ghi chú sự thật) để đọc, duyệt và phân phối kịch bản.
              </p>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 italic pt-1">
            * Gửi thư mục chứa clip + gói hậu kỳ cho trợ lý dựng phim để ghép, thêm chuyển cảnh, tiêu đề, nhạc và hiệu ứng tự động.
          </p>
        </section>

        {/* ================= KHỐI 3: GHÉP NHANH TRONG FLOW (SCENEBUILDER) ================= */}
        <section className="bg-[#141417] border border-[#26262b] rounded-xl p-4 space-y-3 shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#26262b] pb-2.5">
            <span className="material-symbols-outlined text-[#f5b301] text-lg">movie_filter</span>
            <h3 className="font-bold text-sm text-[#ececef] uppercase tracking-wide">
              3. Ghép Nhanh Trong Flow (Scenebuilder)
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 rounded bg-[#101014] border border-[#26262b] space-y-1">
              <span className="w-5 h-5 rounded-full bg-amber-500 text-black font-bold font-mono flex items-center justify-center text-[10px]">
                1
              </span>
              <div className="font-semibold text-white">Mở thư viện dự án</div>
              <p className="text-[11px] text-slate-400">
                Mở thư viện Flow trong thanh công cụ bên ngoài của dự án.
              </p>
            </div>

            <div className="p-2.5 rounded bg-[#101014] border border-[#26262b] space-y-1">
              <span className="w-5 h-5 rounded-full bg-amber-500 text-black font-bold font-mono flex items-center justify-center text-[10px]">
                2
              </span>
              <div className="font-semibold text-white">Di chuột lên clip &gt; More</div>
              <p className="text-[11px] text-slate-400">
                Tìm clip video theo danh sách thứ tự và mediaId rút gọn bên dưới.
              </p>
            </div>

            <div className="p-2.5 rounded bg-[#101014] border border-[#26262b] space-y-1">
              <span className="w-5 h-5 rounded-full bg-amber-500 text-black font-bold font-mono flex items-center justify-center text-[10px]">
                3
              </span>
              <div className="font-semibold text-white">Add to Scene</div>
              <p className="text-[11px] text-slate-400">
                Bấm Add to Scene theo đúng thứ tự shot 1, 2, 3... để đưa vào timeline Scenebuilder.
              </p>
            </div>

            <div className="p-2.5 rounded bg-[#101014] border border-[#26262b] space-y-1">
              <span className="w-5 h-5 rounded-full bg-amber-500 text-black font-bold font-mono flex items-center justify-center text-[10px]">
                4
              </span>
              <div className="font-semibold text-white">Kéo cắt & Download Scene</div>
              <p className="text-[11px] text-slate-400">
                Cắt chỉnh đầu/đuôi nếu cần rồi bấm Download scene để tải video hoàn chỉnh.
              </p>
            </div>
          </div>

          {/* Danh sách thứ tự + mediaId rút gọn để dò */}
          <div className="space-y-1.5 pt-2">
            <span className="text-[11px] font-bold text-slate-300 font-mono uppercase block">
              Danh sách thứ tự shot & mediaId rút gọn để dò trong thư viện Flow:
            </span>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-2 rounded bg-[#0d0d10] border border-[#26262b]">
              {shots.map((sh) => {
                const take = getActiveTake(sh);
                const mediaIdShort = take?.mediaId ? take.mediaId.slice(-6) : 'chưa có';
                return (
                  <span
                    key={sh.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#181820] border border-[#26262b] text-[10px] font-mono text-slate-300"
                  >
                    <b className="text-amber-400">#{sh.order}</b>
                    <span className="text-slate-500">•</span>
                    <span className={take?.mediaId ? 'text-emerald-400' : 'text-slate-600'}>
                      ID: {mediaIdShort}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>

          <div className="p-2.5 rounded bg-[#181820] border border-[#26262b] text-[11px] text-slate-400 italic">
            * Ghi chú: Tool không thể tự thêm clip vào Scenebuilder (SDK không hỗ trợ).
          </div>
        </section>
      </div>
    </div>
  );
};
