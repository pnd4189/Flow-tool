import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Flow } from 'flow-sdk';
import type {
  QueueItem,
  ExportSettings,
  ExportClipItem,
  ExportResolution,
  ExportFps,
  EffectConfig,
} from '../types';
import {
  renderClipToMp4,
  renderMergedVideo,
  buildManifestJson,
  getExportDimensions,
} from '../services/exportService';
import {
  buildFilename,
  slugify,
  downloadQueue,
  downloadJsonFile,
} from '../services/downloadQueue';
import { VirtualList } from './VirtualList';

interface Step4Props {
  queue: QueueItem[];
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  defaultFps?: ExportFps;
  totalPromptCount?: number;
  onAddToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onBackToStep3: () => void;
}

const ExportClipRowMemo = React.memo<{
  clip: ExportClipItem;
  canRerender: boolean;
  isMemoryReleased: boolean;
  dimensions: { width: number; height: number };
  onToggleCheck: (id: string, checked: boolean) => void;
  onSingleRender: (clip: ExportClipItem) => void;
  onSingleDownload: (clip: ExportClipItem) => void;
  onPreview: (url: string) => void;
}>(({ clip, canRerender, isMemoryReleased, dimensions, onToggleCheck, onSingleRender, onSingleDownload, onPreview }) => {
  return (
    <div
      className={`h-[92px] p-3 mx-1.5 my-1 rounded-xl border transition-all flex items-center justify-between gap-3 select-none ${
        clip.status === 'rendering'
          ? 'bg-[#181824] border-[#f5b301]/40'
          : clip.status === 'downloaded' || clip.status === 'released'
          ? 'bg-[#131714] border-emerald-500/30'
          : clip.status === 'rendered'
          ? 'bg-[#141715] border-emerald-500/30'
          : clip.status === 'needs_rerender'
          ? 'bg-amber-950/20 border-amber-500/40'
          : clip.status === 'error'
          ? 'bg-[#1c1214] border-rose-500/40'
          : 'bg-[#141417] border-[#26262b]'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <input
          type="checkbox"
          checked={clip.selected}
          onChange={(e) => onToggleCheck(clip.id, e.target.checked)}
          className="accent-[#f5b301] w-4 h-4 rounded cursor-pointer"
        />

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-100 truncate">
              #{clip.order}. {clip.title}
            </span>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#1e1e26] text-zinc-300">
              {dimensions.width}×{dimensions.height} ({clip.aspectRatio})
            </span>
          </div>

          <div className="text-[11px] font-mono text-zinc-400 truncate">
            File: <strong className="text-[#f5b301]">{clip.expectedFilename}</strong>
          </div>

          <div className="text-[10px] font-mono text-zinc-500 flex items-center gap-2">
            <span>Thời lượng: {clip.durationSec}s</span>
            {clip.renderTimeMs && (
              <span>• Dựng: {(clip.renderTimeMs / 1000).toFixed(1)}s</span>
            )}
            {clip.sizeBytes && (
              <span>• Dung lượng: {(clip.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
            )}
            {clip.error && (
              <span className="text-rose-400 font-sans truncate max-w-[260px]" title={clip.error}>
                • Lỗi: {clip.error}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          {clip.status === 'downloaded' && (
            <div className="space-y-0.5">
              <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">check_circle</span>
                Đã tải ✓
              </span>
              {clip.renderTimeMs && (
                <div className="text-[10px] font-mono text-zinc-400">
                  {(clip.sizeBytes ? clip.sizeBytes / 1024 / 1024 : 0).toFixed(1)} MB • {(clip.renderTimeMs / 1000).toFixed(1)}s
                </div>
              )}
            </div>
          )}

          {clip.status === 'released' && (
            <div className="space-y-0.5">
              <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700 font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">check</span>
                Đã tải • đã giải phóng
              </span>
              <div className="text-[10px] font-mono text-zinc-500">
                Đã dọn RAM
              </div>
            </div>
          )}

          {clip.status === 'rendered' && (
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              Đã dựng xong
            </span>
          )}

          {clip.status === 'needs_rerender' && (
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold">
              Cần dựng lại
            </span>
          )}

          {clip.status === 'rendering' && (
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
              Đang dựng {clip.progressPercent}%
            </span>
          )}

          {clip.status === 'idle' && (
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#1e1e24] text-zinc-400 border border-[#2d2d35]">
              Chờ dựng
            </span>
          )}

          {clip.status === 'error' && (
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/30">
              Lỗi
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {clip.blobUrl && (
            <button
              type="button"
              onClick={() => onPreview(clip.blobUrl!)}
              className="px-2 py-1 bg-[#1e1e24] hover:bg-[#282830] text-zinc-200 border border-[#2d2d35] rounded-lg text-xs"
            >
              Xem
            </button>
          )}

          {clip.blob && (
            <button
              type="button"
              onClick={() => onSingleDownload(clip)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-[#26262b] transition-colors"
              title="Tải clip này"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onSingleRender(clip)}
            disabled={!canRerender}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-[#26262b] disabled:opacity-30 disabled:pointer-events-none transition-colors"
            title={canRerender ? 'Dựng lại clip này' : 'Không thể dựng lại: Ảnh gốc đã được giải phóng khỏi RAM'}
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
          </button>
        </div>
      </div>
    </div>
  );
});

export const Step4Export: React.FC<Step4Props> = ({
  queue,
  setQueue,
  defaultFps = 24,
  totalPromptCount = 10,
  onAddToast,
  onBackToStep3,
}) => {
  const [settings, setSettings] = useState<ExportSettings>({
    projectName: 'effect-image',
    resolution: '1080p',
    fps: defaultFps,
    downloadClips: true,
    mergeClips: false,
    downloadOriginalImages: false,
    downloadManifest: true,
    uploadToFlow: false,
  });

  const [clipItems, setClipItems] = useState<ExportClipItem[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

  // Lưu trữ format cho từng clip để dựng manifest chính xác
  const clipFormatMapRef = useRef<Record<string, 'mp4' | 'webm'>>({});

  // Lưu cấu hình EffectConfig tại thời điểm đã dựng để phát hiện thay đổi ở Bước 3
  const renderedConfigHashMapRef = useRef<Record<string, string>>({});

  // Đồng bộ kết quả thực tế từ queue vào Bước 4 (giữ lại các hàm, VirtualList, ExportClipRowMemo)
  useEffect(() => {
    const validQueue = queue.filter((q) => q.variants.length > 0 || q.status === 'done');

    setClipItems((prevClips) => {
      return validQueue.map((item) => {
        const existing = prevClips.find((c) => c.id === item.id);
        const duration = item.effectConfig?.durationSec || 6;
        const filename = buildFilename(
          settings.projectName,
          item.promptItem.order,
          item.promptItem.title,
          'mp4',
          item.promptItem.prompt,
          item.translatedPrompt,
          totalPromptCount
        );

        const currentConfigHash = JSON.stringify(item.effectConfig || {});
        const previousRenderedHash = renderedConfigHashMapRef.current[item.id];

        let initialStatus: ExportClipItem['status'] = 'idle';
        let initialBlob = existing?.blob;
        let initialBlobUrl = existing?.blobUrl;
        let initialBase64 = existing?.base64;

        if (item.isMemoryReleased) {
          initialStatus = 'released';
        } else if (
          previousRenderedHash &&
          previousRenderedHash !== currentConfigHash &&
          existing &&
          (existing.status === 'rendered' || existing.status === 'downloaded')
        ) {
          // Yêu cầu 5: Đổi EffectConfig ở bước 3 sau khi đã dựng: chuyển về "Cần dựng lại", xoá blob cũ
          if (existing.blobUrl) {
            URL.revokeObjectURL(existing.blobUrl);
          }
          initialStatus = 'needs_rerender';
          initialBlob = undefined;
          initialBlobUrl = undefined;
          initialBase64 = undefined;
        } else if (existing?.status) {
          initialStatus = existing.status;
        }

        return {
          id: item.id,
          order: item.promptItem.order,
          title: item.promptItem.title,
          aspectRatio: item.promptItem.aspectRatio,
          durationSec: duration,
          status: initialStatus,
          progressPercent: initialStatus === 'released' || initialStatus === 'downloaded' ? 100 : existing?.progressPercent || 0,
          expectedFilename: filename,
          blob: initialBlob,
          blobUrl: initialBlobUrl,
          base64: initialBase64,
          mimeType: existing?.mimeType,
          selected: existing ? existing.selected : true,
          isMemoryReleased: item.isMemoryReleased,
          renderTimeMs: existing?.renderTimeMs,
          sizeBytes: existing?.sizeBytes,
          error: existing?.error,
          configHash: currentConfigHash,
        };
      });
    });
  }, [queue, settings.projectName, totalPromptCount]);

  const updateClip = (id: string, updater: (prev: ExportClipItem) => ExportClipItem) => {
    setClipItems((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  };

  const handleToggleSelectAll = (select: boolean) => {
    setClipItems((prev) => prev.map((c) => ({ ...c, selected: select })));
  };

  // Huỷ quá trình đang dựng (Yêu cầu 2: gọi abortControllerRef, mục đang dựng về Chờ dựng)
  const handleCancelProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setClipItems((prev) =>
      prev.map((c) => (c.status === 'rendering' ? { ...c, status: 'idle', progressPercent: 0 } : c))
    );
    setIsProcessing(false);
    setStatusMessage('');
    onAddToast('Đã huỷ quá trình dựng video.', 'info');
  };

  // Dựng 1 clip đơn lẻ
  const renderSingleClip = async (clip: ExportClipItem, signal: AbortSignal) => {
    const queueItem = queue.find((q) => q.id === clip.id);
    if (!queueItem) return { ok: false };

    updateClip(clip.id, (c) => ({ ...c, status: 'rendering', progressPercent: 0, error: undefined }));

    try {
      const res = await renderClipToMp4(
        queueItem,
        { resolution: settings.resolution, fps: settings.fps },
        (pct) => updateClip(clip.id, (c) => ({ ...c, progressPercent: pct })),
        signal
      );

      const blobUrl = URL.createObjectURL(res.blob);
      const confHash = JSON.stringify(queueItem.effectConfig || {});
      renderedConfigHashMapRef.current[clip.id] = confHash;
      clipFormatMapRef.current[clip.id] = res.mimeType === 'video/mp4' ? 'mp4' : 'webm';

      updateClip(clip.id, (c) => ({
        ...c,
        status: 'rendered',
        blob: res.blob,
        blobUrl,
        base64: res.base64,
        mimeType: res.mimeType,
        sizeBytes: res.sizeBytes,
        renderTimeMs: res.renderTimeMs,
        configHash: confHash,
      }));
      return { ok: true, result: res };
    } catch (err: any) {
      const isAborted = signal.aborted;
      updateClip(clip.id, (c) => ({
        ...c,
        status: isAborted ? 'idle' : 'error',
        progressPercent: 0,
        error: isAborted ? undefined : err?.message || String(err),
      }));
      return { ok: false };
    }
  };

  // Tải trực tiếp 1 clip đã dựng còn trong bộ nhớ
  const handleSingleDownloadClip = (clip: ExportClipItem) => {
    if (!clip.base64 || !clip.mimeType) return;
    downloadQueue.enqueue({
      id: clip.id,
      base64: clip.base64,
      mimeType: clip.mimeType,
      filename: clip.expectedFilename,
      onProgress: (st) => {
        if (st === 'done') {
          updateClip(clip.id, (c) => ({ ...c, status: 'downloaded' }));
        }
      },
    });
    onAddToast(`Đang tải clip ${clip.expectedFilename}...`, 'info');
  };

  // Chuyển blobUrl thành base64 dùng FileReader cho ảnh gốc
  const fetchBlobAsBase64 = async (blobUrl: string): Promise<{ base64: string; mimeType: string }> => {
    if (blobUrl.startsWith('data:')) {
      const match = blobUrl.match(/^data:([^;]+);base64,(.*)$/);
      if (match) return { mimeType: match[1], base64: match[2] };
    }
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();
    const mimeType = blob.type || 'image/jpeg';
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return { base64: btoa(binary), mimeType };
  };

  // Hành vi sau khi dựng xong lượt (Yêu cầu 3)
  const handlePostRenderActions = async (
    successItems: QueueItem[],
    renderedResultsMap: Map<string, { base64: string; mimeType: 'video/mp4' | 'video/webm' }>
  ) => {
    if (successItems.length === 0) return;

    // 1. Tải kèm ảnh gốc
    if (settings.downloadOriginalImages) {
      let releasedImageCount = 0;
      for (const item of successItems) {
        if (item.isMemoryReleased) {
          releasedImageCount++;
          continue;
        }
        const variant = item.variants[item.selectedVariantIndex] || item.variants[0];
        if (!variant || !variant.blobUrl) {
          releasedImageCount++;
          continue;
        }
        try {
          const { base64, mimeType } = await fetchBlobAsBase64(variant.blobUrl);
          const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
          const imgFilename = buildFilename(
            settings.projectName,
            item.promptItem.order,
            item.promptItem.title,
            ext,
            item.promptItem.prompt,
            item.translatedPrompt,
            totalPromptCount
          );

          downloadQueue.enqueue({
            id: `${item.id}_image`,
            base64,
            mimeType: (mimeType as any) || 'image/jpeg',
            filename: imgFilename,
          });
        } catch (imgErr) {
          console.warn('Lỗi đưa ảnh gốc vào downloadQueue:', imgErr);
        }
      }
      if (releasedImageCount > 0) {
        onAddToast(`Ảnh gốc: Đã bỏ qua ${releasedImageCount} mục vì đã giải phóng bộ nhớ.`, 'warning');
      }
    }

    // 2. Lưu clip vào thư viện Flow
    if (settings.uploadToFlow) {
      for (const item of successItems) {
        const rendered = renderedResultsMap.get(item.id);
        if (!rendered) continue;
        try {
          const uploadName = item.promptItem.title
            ? `${settings.projectName}_${item.promptItem.order}_${item.promptItem.title}`
            : `${settings.projectName}_clip_${item.promptItem.order}`;

          await Flow.upload({
            base64: rendered.base64,
            mimeType: (rendered.mimeType as any) || 'video/mp4',
            name: uploadName,
          });
          onAddToast(`Đã lưu #${item.promptItem.order} vào thư viện Flow ✓`, 'success');
        } catch (uploadErr: any) {
          onAddToast(
            `Lưu thư viện Flow lỗi cho #${item.promptItem.order}: ${uploadErr?.message || uploadErr}`,
            'error'
          );
        }
      }
    }

    // 3. Ghép thành 1 video (nếu bật)
    if (settings.mergeClips) {
      const itemsToMerge = successItems
        .filter((it) => !it.isMemoryReleased && it.variants.length > 0 && it.variants[0].blobUrl)
        .sort((a, b) => a.promptItem.order - b.promptItem.order);

      const skippedMergeCount = successItems.length - itemsToMerge.length;
      if (skippedMergeCount > 0) {
        onAddToast(`Ghép video: Đã bỏ qua ${skippedMergeCount} mục đã giải phóng bộ nhớ.`, 'warning');
      }

      if (itemsToMerge.length >= 2) {
        try {
          setStatusMessage(`Đang ghép ${itemsToMerge.length} clip thành 1 video...`);
          const mergeRes = await renderMergedVideo(
            itemsToMerge,
            { resolution: settings.resolution, fps: settings.fps },
            (pct) => setStatusMessage(`Đang ghép video: ${pct}%...`)
          );

          const safeProject = slugify(settings.projectName || 'effect-image', 30);
          const mergeFilename = `${safeProject}_ghep.mp4`;

          downloadQueue.enqueue({
            id: 'manual_merged_video',
            base64: mergeRes.base64,
            mimeType: 'video/mp4',
            filename: mergeFilename,
          });
          onAddToast(`Đã xếp lịch tải video ghép ${mergeFilename} ✓`, 'success');
        } catch (mergeErr: any) {
          onAddToast(`Lỗi khi ghép video: ${mergeErr?.message || mergeErr}`, 'error');
        }
      } else if (itemsToMerge.length === 1) {
        onAddToast('Cần ít nhất 2 clip để ghép thành 1 video.', 'warning');
      }
    }

    // 4. Tải manifest.json
    if (settings.downloadManifest) {
      try {
        const safeProject = slugify(settings.projectName || 'effect-image', 30);
        const manifestFilename = `${safeProject}_manifest.json`;
        const manifestContent = buildManifestJson(
          settings.projectName,
          successItems,
          { resolution: settings.resolution, fps: settings.fps },
          settings.downloadOriginalImages,
          clipFormatMapRef.current,
          totalPromptCount
        );

        await downloadJsonFile(manifestFilename, manifestContent);
        onAddToast(`Đã tải file manifest ${manifestFilename} ✓`, 'success');
      } catch (manErr: any) {
        onAddToast(`Lỗi tạo manifest: ${manErr?.message || manErr}`, 'error');
      }
    }
  };

  // Chạy quy trình dựng tuần tự (render sequential)
  const executeBatchRender = async (targets: ExportClipItem[], shouldDownload: boolean) => {
    if (isProcessing) return;
    if (targets.length === 0) return;

    setIsProcessing(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const successfulQueueItems: QueueItem[] = [];
    const renderedResultsMap = new Map<string, { base64: string; mimeType: 'video/mp4' | 'video/webm' }>();

    try {
      for (let i = 0; i < targets.length; i++) {
        if (controller.signal.aborted) break;
        const target = targets[i];
        setStatusMessage(`Đang dựng clip ${i + 1}/${targets.length}...`);

        const res = await renderSingleClip(target, controller.signal);

        if (res.ok && res.result) {
          const qItem = queue.find((q) => q.id === target.id);
          if (qItem) {
            successfulQueueItems.push(qItem);
            renderedResultsMap.set(target.id, {
              base64: res.result.base64,
              mimeType: res.result.mimeType,
            });
          }

          if (shouldDownload && settings.downloadClips) {
            const r = res.result;
            downloadQueue.enqueue({
              id: target.id,
              base64: r.base64,
              mimeType: r.mimeType,
              filename: target.expectedFilename,
              onProgress: (st) => {
                if (st === 'done') {
                  updateClip(target.id, (c) => ({ ...c, status: 'downloaded' }));
                }
              },
            });
          }
        }
      }

      if (!controller.signal.aborted) {
        setStatusMessage('Đang xử lý tải xuống, ảnh gốc và manifest...');
        await handlePostRenderActions(successfulQueueItems, renderedResultsMap);
      }
    } finally {
      setIsProcessing(false);
      setStatusMessage('');
      abortControllerRef.current = null;
    }
  };

  // Nút 1: "Dựng & tải clip đã chọn"
  const handleRenderAndDownloadAll = async () => {
    const targets = clipItems.filter((c) => c.selected && !c.isMemoryReleased);
    if (targets.length === 0) {
      onAddToast('Vui lòng chọn ít nhất 1 clip hợp lệ để dựng và tải!', 'warning');
      return;
    }
    await executeBatchRender(targets, true);
  };

  // Nút 2: "Chỉ dựng" (dựng tuần tự, không tải)
  const handleOnlyRender = async () => {
    const targets = clipItems.filter((c) => c.selected && !c.isMemoryReleased);
    if (targets.length === 0) {
      onAddToast('Vui lòng chọn ít nhất 1 clip hợp lệ để dựng!', 'warning');
      return;
    }
    await executeBatchRender(targets, false);
  };

  // Nút 3: "Tải lại tất cả" (tải lại các clip đã dựng còn trong bộ nhớ)
  const handleDownloadAllRendered = () => {
    const renderedClips = clipItems.filter(
      (c) => (c.status === 'rendered' || c.status === 'downloaded') && c.base64 && c.mimeType
    );

    if (renderedClips.length === 0) {
      onAddToast('Không có clip nào đã dựng còn trong bộ nhớ để tải lại.', 'info');
      return;
    }

    renderedClips.forEach((c) => {
      downloadQueue.enqueue({
        id: c.id,
        base64: c.base64!,
        mimeType: c.mimeType!,
        filename: c.expectedFilename,
        onProgress: (st) => {
          if (st === 'done') {
            updateClip(c.id, (prev) => ({ ...prev, status: 'downloaded' }));
          }
        },
      });
    });

    onAddToast(`Đã xếp lịch tải lại ${renderedClips.length} clip vào hàng đợi tải ✓`, 'success');
  };

  // Nút 4: "Dựng lại clip lỗi"
  const handleRerenderErrors = async () => {
    const errorClips = clipItems.filter((c) => c.status === 'error' && !c.isMemoryReleased);
    if (errorClips.length === 0) {
      onAddToast('Không có clip lỗi nào có thể dựng lại.', 'info');
      return;
    }
    await executeBatchRender(errorClips, settings.downloadClips);
  };

  const totalClips = clipItems.length;
  const renderedCount = clipItems.filter(
    (c) => c.status === 'rendered' || c.status === 'downloaded' || c.status === 'released'
  ).length;
  const downloadedCount = clipItems.filter((c) => c.status === 'downloaded' || c.status === 'released').length;
  const errorCount = clipItems.filter((c) => c.status === 'error').length;

  const selectedClipsCount = clipItems.filter((c) => c.selected).length;
  const isMergeDisabled = selectedClipsCount > 30;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0b0d] text-zinc-200 overflow-hidden">
      {/* 1. THANH TIÊU ĐỀ TRÊN CÙNG */}
      <div className="p-3 border-b border-[#26262b] bg-[#141417] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#f5b301]/10 border border-[#f5b301]/30 flex items-center justify-center text-[#f5b301]">
            <span className="material-symbols-outlined text-[20px]">movie</span>
          </div>
          <div>
            <h2 className="text-xs font-semibold text-zinc-100 uppercase tracking-wide">
              BƯỚC 4: XUẤT VIDEO MP4 HÀNG LOẠT
            </h2>
            <p className="text-[11px] text-zinc-400">
              Mã hoá H.264 WebCodecs • Quản lý tải xuống, ảnh gốc và ghép video
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onBackToStep3 && (
            <button
              type="button"
              onClick={onBackToStep3}
              disabled={isProcessing}
              className="px-3 py-1.5 rounded-lg bg-[#1e1e24] hover:bg-[#282830] text-zinc-300 border border-[#2d2d35] text-xs disabled:opacity-40"
            >
              Quay lại Bước 3
            </button>
          )}

          {isProcessing ? (
            <button
              type="button"
              onClick={handleCancelProcessing}
              className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[17px]">stop</span>
              <span>Huỷ</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRenderAndDownloadAll}
              className="px-4 py-1.5 rounded-lg bg-[#f5b301] hover:bg-[#ffbe1a] text-black font-semibold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[17px]">download</span>
              <span>Dựng &amp; tải clip đã chọn</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. THANH CÀI ĐẶT TRÊN DANH SÁCH (Yêu cầu 1) */}
      <div className="p-3 bg-[#111116] border-b border-[#26262b] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Ô nhập tên dự án, Độ phân giải, FPS */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 bg-[#181822] px-2.5 py-1 rounded-lg border border-[#282838]">
              <span className="text-[11px] text-zinc-400">Tên dự án:</span>
              <input
                type="text"
                disabled={isProcessing}
                value={settings.projectName}
                onChange={(e) => setSettings((s) => ({ ...s, projectName: e.target.value }))}
                placeholder="effect-image"
                className="bg-transparent text-xs font-mono font-semibold text-[#f5b301] focus:outline-none w-32 disabled:opacity-50"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-[#181822] px-2.5 py-1 rounded-lg border border-[#282838]">
              <span className="text-[11px] text-zinc-400">Độ phân giải:</span>
              <select
                disabled={isProcessing}
                value={settings.resolution}
                onChange={(e) => setSettings((s) => ({ ...s, resolution: e.target.value as ExportResolution }))}
                className="bg-transparent text-xs font-semibold text-zinc-200 focus:outline-none disabled:opacity-50"
              >
                <option value="1080p">1080p Full HD</option>
                <option value="720p">720p HD</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 bg-[#181822] px-2.5 py-1 rounded-lg border border-[#282838]">
              <span className="text-[11px] text-zinc-400">FPS:</span>
              <select
                disabled={isProcessing}
                value={settings.fps}
                onChange={(e) => setSettings((s) => ({ ...s, fps: parseInt(e.target.value, 10) as ExportFps }))}
                className="bg-transparent text-xs font-mono font-semibold text-zinc-200 focus:outline-none disabled:opacity-50"
              >
                <option value={24}>24 FPS</option>
                <option value={30}>30 FPS</option>
              </select>
            </div>
          </div>

          {/* Các nút hành động (Yêu cầu 2: Chỉ dựng, Tải lại tất cả, Dựng lại clip lỗi, Huỷ) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleOnlyRender}
              disabled={isProcessing}
              className="px-3 py-1 bg-[#1e1e26] hover:bg-[#282835] text-zinc-200 border border-[#333346] rounded-lg text-xs font-medium transition-all disabled:opacity-40"
              title="Dựng tuần tự nhưng không tự động tải xuống"
            >
              Chỉ dựng
            </button>

            <button
              type="button"
              onClick={handleDownloadAllRendered}
              disabled={isProcessing}
              className="px-3 py-1 bg-[#1e1e26] hover:bg-[#282835] text-zinc-200 border border-[#333346] rounded-lg text-xs font-medium transition-all disabled:opacity-40"
              title="Tải lại tất cả các clip đã dựng còn trong RAM"
            >
              Tải lại tất cả
            </button>

            {errorCount > 0 && (
              <button
                type="button"
                onClick={handleRerenderErrors}
                disabled={isProcessing}
                className="px-3 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
              >
                Dựng lại clip lỗi ({errorCount})
              </button>
            )}
          </div>
        </div>

        {/* Các công tắc tuỳ chọn */}
        <div className="flex flex-wrap items-center gap-4 pt-1.5 border-t border-[#262636] text-[11px] text-zinc-300">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              disabled={isProcessing}
              checked={settings.downloadClips}
              onChange={(e) => setSettings((s) => ({ ...s, downloadClips: e.target.checked }))}
              className="accent-[#f5b301] w-3.5 h-3.5 rounded disabled:opacity-50"
            />
            <span>Tải từng clip</span>
          </label>

          <label
            className={`flex items-center gap-1.5 ${
              isMergeDisabled ? 'opacity-50 cursor-not-allowed text-zinc-500' : 'cursor-pointer'
            }`}
            title={isMergeDisabled ? 'Khoá ghép vì số clip đã chọn trên 30 (quá nặng cho trình duyệt)' : undefined}
          >
            <input
              type="checkbox"
              disabled={isProcessing || isMergeDisabled}
              checked={settings.mergeClips && !isMergeDisabled}
              onChange={(e) => setSettings((s) => ({ ...s, mergeClips: e.target.checked }))}
              className="accent-[#f5b301] w-3.5 h-3.5 rounded"
            />
            <span>Ghép thành 1 video</span>
            {isMergeDisabled && (
              <span className="text-[10px] text-amber-400 font-mono">
                (Khoá do &gt; 30 clip)
              </span>
            )}
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              disabled={isProcessing}
              checked={settings.downloadOriginalImages}
              onChange={(e) => setSettings((s) => ({ ...s, downloadOriginalImages: e.target.checked }))}
              className="accent-[#f5b301] w-3.5 h-3.5 rounded disabled:opacity-50"
            />
            <span>Tải kèm ảnh gốc</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              disabled={isProcessing}
              checked={settings.downloadManifest}
              onChange={(e) => setSettings((s) => ({ ...s, downloadManifest: e.target.checked }))}
              className="accent-[#f5b301] w-3.5 h-3.5 rounded disabled:opacity-50"
            />
            <span>Tải manifest.json</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              disabled={isProcessing}
              checked={settings.uploadToFlow}
              onChange={(e) => setSettings((s) => ({ ...s, uploadToFlow: e.target.checked }))}
              className="accent-[#f5b301] w-3.5 h-3.5 rounded disabled:opacity-50"
            />
            <span>Lưu clip vào thư viện Flow</span>
          </label>
        </div>
      </div>

      {/* 3. THANH THAO TÁC NHANH TRÊN DANH SÁCH */}
      <div className="p-2.5 bg-[#111115] border-b border-[#26262b] flex items-center justify-between text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => handleToggleSelectAll(true)}
            className="hover:text-white disabled:opacity-50"
          >
            Chọn tất cả
          </button>
          <span>•</span>
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => handleToggleSelectAll(false)}
            className="hover:text-white disabled:opacity-50"
          >
            Bỏ chọn
          </button>
        </div>
        <span className="font-mono">
          Đã chọn: <strong className="text-zinc-200">{selectedClipsCount}</strong>/{totalClips} clip
        </span>
      </div>

      {/* 4. DANH SÁCH ẢO HOÁ VIRTUALLIST */}
      <div className="flex-1 overflow-hidden">
        {clipItems.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-xs">
            Không có clip nào trong hàng đợi để xuất.
          </div>
        ) : (
          <VirtualList<ExportClipItem>
            items={clipItems}
            itemHeight={96}
            className="h-full"
            buffer={10}
            renderItem={(clip) => {
              const queueItem = queue.find((q) => q.id === clip.id);
              const canRerender = !!(
                queueItem &&
                queueItem.variants.length > 0 &&
                !queueItem.isMemoryReleased &&
                queueItem.variants[0].blobUrl &&
                !isProcessing
              );
              const dims = getExportDimensions(clip.aspectRatio, settings.resolution);

              return (
                <ExportClipRowMemo
                  clip={clip}
                  canRerender={canRerender}
                  isMemoryReleased={!!queueItem?.isMemoryReleased}
                  dimensions={dims}
                  onToggleCheck={(id, checked) => updateClip(id, (c) => ({ ...c, selected: checked }))}
                  onSingleRender={() => renderSingleClip(clip, new AbortController().signal)}
                  onSingleDownload={handleSingleDownloadClip}
                  onPreview={setPreviewVideoUrl}
                />
              );
            }}
          />
        )}
      </div>

      {/* 5. THANH TỔNG DƯỚI CÙNG (Yêu cầu 4) */}
      <div className="p-2.5 px-4 bg-[#14141a] border-t border-[#26262b] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3 font-mono">
          <span className="text-zinc-300">
            Đã dựng: <strong className="text-amber-400">{renderedCount}</strong>/{totalClips}
          </span>
          <span className="text-zinc-500">•</span>
          <span className="text-zinc-300">
            Đã tải: <strong className="text-emerald-400">{downloadedCount}</strong>
          </span>
          {errorCount > 0 && (
            <>
              <span className="text-zinc-500">•</span>
              <span className="text-rose-400 font-semibold">
                Lỗi: <strong>{errorCount}</strong>
              </span>
            </>
          )}
        </div>

        {/* Trạng thái statusMessage khi đang chạy */}
        {isProcessing && statusMessage && (
          <div className="flex items-center gap-2 text-amber-300 font-mono text-[11px] animate-pulse">
            <span className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* MODAL XEM VIDEO */}
      {previewVideoUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewVideoUrl(null)}
        >
          <div
            className="max-w-3xl w-full bg-black rounded-xl overflow-hidden border border-[#26262b] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-2.5 bg-[#141417] border-b border-[#26262b] flex justify-between items-center text-xs">
              <span className="font-semibold text-zinc-300">Xem thử clip MP4</span>
              <button
                type="button"
                onClick={() => setPreviewVideoUrl(null)}
                className="text-zinc-400 hover:text-white p-1 rounded"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <video src={previewVideoUrl} controls autoPlay className="w-full h-full object-contain" />
          </div>
        </div>
      )}
    </div>
  );
};
