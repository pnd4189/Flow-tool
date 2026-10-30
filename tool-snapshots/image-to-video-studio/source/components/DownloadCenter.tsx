import React, { useState, useEffect, useMemo } from 'react';
import { Scene, VideoJob } from '../types';
import {
  DownloadItem,
  DownloadQueueProgress,
  runDownloads,
  cancelDownloads,
  isDownloadBusy,
  subscribe,
  buildImageDownloadFilename,
  buildVideoDownloadFilename,
} from '../services/downloadQueue';
import { blobToBase64 } from '../services/video';

interface DownloadCenterProps {
  scenes: Scene[];
  videoJobs: VideoJob[];
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0.0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export const DownloadCenter: React.FC<DownloadCenterProps> = ({ scenes, videoJobs }) => {
  // Trạng thái hàng đợi singleton
  const [queueProgress, setQueueProgress] = useState<DownloadQueueProgress>(() => ({
    isBusy: isDownloadBusy(),
    current: 0,
    total: 0,
    percent: 0,
    currentFilename: '',
    currentApproxBytes: 0,
    failedItems: [],
  }));

  useEffect(() => {
    const unsubscribe = subscribe(progress => {
      setQueueProgress({ ...progress });
    });
    return unsubscribe;
  }, []);

  // Map số cảnh 1-based
  const sceneNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    scenes.forEach((s, idx) => {
      map.set(s.id, idx + 1);
    });
    return map;
  }, [scenes]);

  // Bộ lọc các cảnh đã có ảnh hoặc video
  const completedScenesWithMedia = useMemo(() => {
    return scenes.filter(s => {
      const hasImage = !!s.result?.base64;
      const hasVideos = videoJobs.some(j => j.sceneId === s.id && j.status === 'success' && !!j.result?.blobUrl);
      return hasImage || hasVideos;
    });
  }, [scenes, videoJobs]);

  // Bộ chọn mục: key = `img_${sceneId}` hoặc `vid_${jobId}`
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Tự động chọn tất cả khi có scene mới hoàn thành nếu trước đó chưa chọn
  useEffect(() => {
    setSelectedKeys(prev => {
      const next = new Set<string>();
      scenes.forEach(s => {
        if (s.result?.base64) {
          const key = `img_${s.id}`;
          if (prev.has(key) || prev.size === 0) next.add(key);
        }
      });
      videoJobs.forEach(j => {
        if (j.status === 'success' && j.result?.blobUrl) {
          const key = `vid_${j.id}`;
          if (prev.has(key) || prev.size === 0) next.add(key);
        }
      });
      return next.size > 0 ? next : prev;
    });
  }, [scenes, videoJobs]);

  const toggleKey = (key: string) => {
    if (queueProgress.isBusy) return;
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    if (queueProgress.isBusy) return;
    const next = new Set<string>();
    scenes.forEach(s => {
      if (s.result?.base64) next.add(`img_${s.id}`);
    });
    videoJobs.forEach(j => {
      if (j.status === 'success' && j.result?.blobUrl) next.add(`vid_${j.id}`);
    });
    setSelectedKeys(next);
  };

  const clearSelection = () => {
    if (queueProgress.isBusy) return;
    setSelectedKeys(new Set());
  };

  const selectOnlyImages = () => {
    if (queueProgress.isBusy) return;
    const next = new Set<string>();
    scenes.forEach(s => {
      if (s.result?.base64) next.add(`img_${s.id}`);
    });
    setSelectedKeys(next);
  };

  const selectOnlyVideos = () => {
    if (queueProgress.isBusy) return;
    const next = new Set<string>();
    videoJobs.forEach(j => {
      if (j.status === 'success' && j.result?.blobUrl) next.add(`vid_${j.id}`);
    });
    setSelectedKeys(next);
  };

  // Tạo DownloadItem cho 1 ảnh
  const makeImageDownloadItem = (scene: Scene): DownloadItem => {
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
  };

  // Tạo DownloadItem cho 1 video
  const makeVideoDownloadItem = (job: VideoJob): DownloadItem => {
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
        const res = await fetch(job.result.blobUrl);
        const blob = await res.blob();
        return await blobToBase64(blob);
      },
    };
  };

  /**
   * Gom các items theo đúng thứ tự:
   * Sắp xếp theo số cảnh (1, 2, 3...), trong mỗi cảnh: ảnh trước rồi mới tới các video của cảnh đó.
   */
  const compileDownloadItems = (filterKeys?: Set<string>): DownloadItem[] => {
    const items: DownloadItem[] = [];

    scenes.forEach(scene => {
      const sceneNum = sceneNumberMap.get(scene.id) || 1;
      const imgKey = `img_${scene.id}`;
      if (scene.result?.base64 && (!filterKeys || filterKeys.has(imgKey))) {
        items.push(makeImageDownloadItem(scene));
      }

      // Các video của cảnh này
      const sceneVideos = videoJobs.filter(
        j => j.sceneId === scene.id && j.status === 'success' && !!j.result?.blobUrl
      );
      sceneVideos.forEach(job => {
        const vidKey = `vid_${job.id}`;
        if (!filterKeys || filterKeys.has(vidKey)) {
          items.push(makeVideoDownloadItem(job));
        }
      });
    });

    return items;
  };

  // Tính tổng dung lượng các mục đang chọn
  const { totalSelectedBytes, selectedItemsCount } = useMemo(() => {
    let bytes = 0;
    let count = 0;
    scenes.forEach(s => {
      if (s.result?.base64 && selectedKeys.has(`img_${s.id}`)) {
        bytes += s.result.bytes || Math.round((s.result.base64.length || 0) * 0.75);
        count++;
      }
    });
    videoJobs.forEach(j => {
      if (j.status === 'success' && j.result?.blobUrl && selectedKeys.has(`vid_${j.id}`)) {
        bytes += j.result.bytes || 5 * 1024 * 1024;
        count++;
      }
    });
    return { totalSelectedBytes: bytes, selectedItemsCount: count };
  }, [scenes, videoJobs, selectedKeys]);

  const isOver300MB = totalSelectedBytes > 300 * 1024 * 1024;

  const handleStartDownload = async (items: DownloadItem[]) => {
    if (queueProgress.isBusy || items.length === 0) return;
    try {
      await runDownloads(items);
    } catch (e: any) {
      console.error('Download error:', e);
    }
  };

  const handleDownloadAll = () => {
    const all = compileDownloadItems();
    handleStartDownload(all);
  };

  const handleDownloadOnlyImages = () => {
    const imgKeys = new Set<string>();
    scenes.forEach(s => {
      if (s.result?.base64) imgKeys.add(`img_${s.id}`);
    });
    const items = compileDownloadItems(imgKeys);
    handleStartDownload(items);
  };

  const handleDownloadOnlyVideos = () => {
    const vidKeys = new Set<string>();
    videoJobs.forEach(j => {
      if (j.status === 'success' && j.result?.blobUrl) vidKeys.add(`vid_${j.id}`);
    });
    const items = compileDownloadItems(vidKeys);
    handleStartDownload(items);
  };

  const handleDownloadSelected = () => {
    const items = compileDownloadItems(selectedKeys);
    handleStartDownload(items);
  };

  const handleRetryFailed = () => {
    if (!queueProgress.failedItems || queueProgress.failedItems.length === 0) return;
    const retryItems = queueProgress.failedItems.map(f => f.item);
    handleStartDownload(retryItems);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0e0e0e] text-white">
      {/* Scrollable Container */}
      <div className="flex-1 overflow-y-auto dark-scrollbar p-6 max-w-6xl mx-auto w-full flex flex-col gap-6">
        
        {/* Header Action Bar */}
        <div className="bg-[#141414] border border-[#595959] rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2.5">
              <span className="material-symbols-outlined text-emerald-400 text-2xl">cloud_download</span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold uppercase tracking-wider text-white">
                  Trung tâm Tải xuống (Download Center)
                </span>
                <span className="text-[11px] text-white/50">
                  Hàng đợi duy nhất không xung đột • Đặt tên theo phiên và số cảnh đồng bộ
                </span>
              </div>
            </div>

            {/* Thống kê dung lượng */}
            <div className="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 font-mono text-xs">
              <span className="text-white/60">Đã chọn:</span>
              <b className="text-white">{selectedItemsCount} mục</b>
              <span className="text-white/30">•</span>
              <b className={isOver300MB ? 'text-amber-400 font-bold' : 'text-emerald-300'}>
                {formatBytes(totalSelectedBytes)}
              </b>
            </div>
          </div>

          {/* Cảnh báo dung lượng > 300MB */}
          {isOver300MB && (
            <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl flex items-start gap-2.5 text-xs text-amber-200">
              <span className="material-symbols-outlined text-base text-amber-400 flex-shrink-0 mt-0.5">warning</span>
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">Tổng dung lượng vượt quá 300 MB ({formatBytes(totalSelectedBytes)})</span>
                <span className="text-[11px] text-amber-200/90 leading-relaxed">
                  Chrome có thể hỏi cho phép tải nhiều file liên tiếp. Vui lòng bấm <b>Cho phép (Allow)</b> để không bị chặn giữa chừng.
                </span>
              </div>
            </div>
          )}

          {/* Bộ nút chọn & nút tải */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-white/5">
            {/* Bộ chọn */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={queueProgress.isBusy}
                onClick={selectAll}
                className="px-2.5 py-1.5 rounded-xl border border-[#595959] hover:bg-white/10 text-xs text-white/80 transition-colors disabled:opacity-40"
              >
                Select all
              </button>
              <button
                type="button"
                disabled={queueProgress.isBusy}
                onClick={clearSelection}
                className="px-2.5 py-1.5 rounded-xl border border-[#595959] hover:bg-white/10 text-xs text-white/80 transition-colors disabled:opacity-40"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={queueProgress.isBusy}
                onClick={selectOnlyImages}
                className="px-2.5 py-1.5 rounded-xl border border-white/20 hover:bg-white/10 text-xs text-white/80 transition-colors disabled:opacity-40"
              >
                Chỉ ảnh
              </button>
              <button
                type="button"
                disabled={queueProgress.isBusy}
                onClick={selectOnlyVideos}
                className="px-2.5 py-1.5 rounded-xl border border-white/20 hover:bg-white/10 text-xs text-white/80 transition-colors disabled:opacity-40"
              >
                Chỉ video
              </button>
            </div>

            {/* Các nút tải */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={queueProgress.isBusy || selectedItemsCount === 0}
                onClick={handleDownloadSelected}
                className="px-4 py-2 rounded-xl bg-white text-black hover:bg-gray-200 text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow"
              >
                <span className="material-symbols-outlined text-base">download</span>
                <span>Tải đã chọn ({selectedItemsCount})</span>
              </button>

              <button
                type="button"
                disabled={queueProgress.isBusy}
                onClick={handleDownloadOnlyImages}
                className="px-3 py-2 rounded-xl border border-white/20 hover:bg-white/10 text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-base">image</span>
                <span>Chỉ ảnh</span>
              </button>

              <button
                type="button"
                disabled={queueProgress.isBusy}
                onClick={handleDownloadOnlyVideos}
                className="px-3 py-2 rounded-xl border border-white/20 hover:bg-white/10 text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-base">movie</span>
                <span>Chỉ video</span>
              </button>

              <button
                type="button"
                disabled={queueProgress.isBusy || completedScenesWithMedia.length === 0}
                onClick={handleDownloadAll}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow"
              >
                <span className="material-symbols-outlined text-base">download_for_offline</span>
                <span>Tải tất cả (ảnh + video)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Thanh tiến trình đang tải */}
        {queueProgress.isBusy && (
          <div className="bg-[#141414] border border-emerald-500/40 rounded-2xl p-4 flex flex-col gap-3 shadow-2xl animate-in fade-in">
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400 text-base animate-spin">progress_activity</span>
                <span className="text-white font-medium">
                  Đang tải <b>{queueProgress.current}/{queueProgress.total}</b> - <span className="font-mono text-emerald-300">{queueProgress.currentFilename}</span>
                  {queueProgress.currentApproxBytes > 0 && ` - ${formatBytes(queueProgress.currentApproxBytes)}`}
                </span>
              </div>
              <button
                type="button"
                onClick={cancelDownloads}
                className="px-3 py-1 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-all duration-300 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
                style={{ width: `${queueProgress.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Báo cáo tóm tắt & lỗi sau khi tải xong */}
        {queueProgress.summaryMessage && !queueProgress.isBusy && (
          <div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex flex-col gap-3 text-xs">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`material-symbols-outlined text-lg ${
                    queueProgress.failedItems.length > 0 ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  {queueProgress.failedItems.length > 0 ? 'warning' : 'check_circle'}
                </span>
                <span className="font-medium text-white text-sm">
                  {queueProgress.summaryMessage}
                </span>
                {queueProgress.failedItems.length > 0 && (
                  <span className="text-red-400 font-mono">
                    ({queueProgress.failedItems.length} mục gặp lỗi)
                  </span>
                )}
              </div>

              {queueProgress.failedItems.length > 0 && (
                <button
                  type="button"
                  onClick={handleRetryFailed}
                  className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 font-medium transition-colors flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">replay</span>
                  <span>Tải lại mục lỗi ({queueProgress.failedItems.length})</span>
                </button>
              )}
            </div>

            {/* Chi tiết lỗi */}
            {queueProgress.failedItems.length > 0 && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex flex-col gap-1.5 max-h-48 overflow-y-auto dark-scrollbar">
                <span className="text-[11px] font-semibold text-red-300 uppercase tracking-wide">
                  Chi tiết lỗi từ trình duyệt / Flow:
                </span>
                {queueProgress.failedItems.map((fail, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-3 text-[11px] font-mono">
                    <span className="text-white/80 truncate">{fail.filename}</span>
                    <span className="text-red-400 text-right truncate max-w-md">{fail.errorMessage}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* DANH SÁCH LIỆT KÊ THEO CẢNH */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider font-semibold text-white/60">
              Danh sách theo cảnh ({completedScenesWithMedia.length} cảnh có dữ liệu)
            </span>
            <span className="text-[11px] text-white/40">
              Thứ tự tải: Cảnh 1 (ảnh → video), Cảnh 2 (ảnh → video)...
            </span>
          </div>

          {completedScenesWithMedia.length === 0 ? (
            <div className="p-12 border border-dashed border-[#595959] rounded-2xl flex flex-col items-center justify-center gap-3 text-center bg-[#141414]">
              <span className="material-symbols-outlined text-4xl text-white/20">cloud_download</span>
              <p className="text-sm text-white/60 font-medium">Chưa có ảnh hoặc video nào để tải.</p>
              <p className="text-xs text-white/40 max-w-md">
                Hãy tạo ảnh trong tab <b>Batch Processing</b> hoặc tạo video trong tab <b>Video Studio</b> trước.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {completedScenesWithMedia.map(scene => {
                const sceneNum = sceneNumberMap.get(scene.id) || 1;
                const hasImage = !!scene.result?.base64;
                const imgKey = `img_${scene.id}`;
                const isImgChecked = selectedKeys.has(imgKey);
                const imgBytes = scene.result?.bytes || Math.round((scene.result?.base64?.length || 0) * 0.75);

                const sceneVideos = videoJobs.filter(
                  j => j.sceneId === scene.id && j.status === 'success' && !!j.result?.blobUrl
                );

                return (
                  <div
                    key={scene.id}
                    className="bg-[#141414] border border-[#595959] rounded-2xl p-4 flex flex-col gap-3 hover:border-[#888] transition-colors"
                  >
                    {/* Hàng tiêu đề cảnh */}
                    <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono px-2 py-0.5 rounded bg-white/10 text-white font-semibold">
                          #{String(sceneNum).padStart(3, '0')}
                        </span>
                        <span className="text-xs font-medium text-white truncate max-w-md" title={scene.title}>
                          {scene.title}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/40 font-mono">
                        {hasImage ? '1 ảnh' : '0 ảnh'} • {sceneVideos.length} video
                      </span>
                    </div>

                    {/* Danh sách mục của cảnh này */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      
                      {/* Ảnh của cảnh */}
                      {hasImage && (
                        <div
                          onClick={() => toggleKey(imgKey)}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer select-none transition-all ${
                            isImgChecked
                              ? 'bg-white/10 border-white text-white'
                              : 'bg-black/30 border-[#444] text-white/60 hover:border-[#666]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={isImgChecked}
                              onChange={() => {}}
                              className="w-4 h-4 accent-white cursor-pointer rounded flex-shrink-0"
                            />
                            <div className="w-12 h-9 bg-black rounded overflow-hidden flex-shrink-0 border border-white/10">
                              <img
                                src={`data:image/jpeg;base64,${scene.result?.thumbBase64 || scene.result?.base64}`}
                                alt="Thumb"
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-medium text-white truncate">Ảnh chính</span>
                              <span className="text-[10px] text-white/40 font-mono">
                                {scene.aspectRatio} • {formatBytes(imgBytes)}
                              </span>
                            </div>
                          </div>

                          <span className="material-symbols-outlined text-sm opacity-60">image</span>
                        </div>
                      )}

                      {/* Các video của cảnh */}
                      {sceneVideos.map(job => {
                        const vidKey = `vid_${job.id}`;
                        const isVidChecked = selectedKeys.has(vidKey);
                        const vidBytes = job.result?.bytes || 5 * 1024 * 1024;

                        return (
                          <div
                            key={job.id}
                            onClick={() => toggleKey(vidKey)}
                            className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer select-none transition-all ${
                              isVidChecked
                                ? 'bg-white/10 border-white text-white'
                                : 'bg-black/30 border-[#444] text-white/60 hover:border-[#666]'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={isVidChecked}
                                onChange={() => {}}
                                className="w-4 h-4 accent-white cursor-pointer rounded flex-shrink-0"
                              />
                              <div className="w-12 h-9 bg-black rounded overflow-hidden flex-shrink-0 border border-white/10 flex items-center justify-center">
                                <video
                                  src={job.result?.blobUrl}
                                  className="w-full h-full object-cover pointer-events-none"
                                />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-medium text-white truncate">
                                  Video v{job.variant} ({job.durationSeconds}s)
                                </span>
                                <span className="text-[10px] text-white/40 font-mono">
                                  {job.model} • {formatBytes(vidBytes)}
                                </span>
                              </div>
                            </div>

                            <span className="material-symbols-outlined text-sm opacity-60">movie</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
