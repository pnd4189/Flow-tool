import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type {
  QueueItem,
  EffectConfig,
  CameraMoveType,
  OverlayId,
  OverlayConfig,
  ParallaxLayerData,
} from '../types';
import { OVERLAY_DEFINITIONS } from '../services/overlays';
import { createDefaultEffectConfig } from '../services/motionEngine';
import { PreviewPlayer } from './PreviewPlayer';
import { generateParallaxLayers, invalidateLayerCache } from '../services/layerService';
import {
  directEffectsForImage,
  applyAiDecisionToQueueItem,
  diversifyCameraMoves,
} from '../services/effectDirector';
import { reloadImageFromGallery } from '../services/genQueue';
import { VirtualList } from './VirtualList';

interface Step3EffectsProps {
  queue: QueueItem[];
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  onProceedToStep4?: () => void;
  onAddToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const CAMERA_MOVES: { type: CameraMoveType; nameVi: string; icon: string; desc: string }[] = [
  { type: 'none', nameVi: 'Đứng yên (Tĩnh)', icon: 'crop_free', desc: 'Máy quay cố định, chỉ hiển thị hiệu ứng phủ' },
  { type: 'zoom_in', nameVi: 'Thu phóng vào (Zoom In)', icon: 'zoom_in', desc: 'Tiến chậm dần vào trung tâm khung cảnh' },
  { type: 'zoom_out', nameVi: 'Thu phóng ra (Zoom Out)', icon: 'zoom_out', desc: 'Lùi rộng dần mở ra toàn cảnh' },
  { type: 'pan_left', nameVi: 'Quét sang trái (Pan Left)', icon: 'arrow_back', desc: 'Máy quay lướt ngang mượt mà sang trái' },
  { type: 'pan_right', nameVi: 'Quét sang phải (Pan Right)', icon: 'arrow_forward', desc: 'Máy quay lướt ngang mượt mà sang phải' },
  { type: 'pan_up', nameVi: 'Quét lên trên (Pan Up)', icon: 'arrow_upward', desc: 'Máy quay trôi nhẹ nhàng từ dưới lên trên' },
  { type: 'pan_down', nameVi: 'Quét xuống dưới (Pan Down)', icon: 'arrow_downward', desc: 'Máy quay trôi nhẹ nhàng từ trên xuống dưới' },
  { type: 'push_to_focus', nameVi: 'Đẩy vào điểm nhấn (Focus)', icon: 'center_focus_strong', desc: 'Zoom vào điểm bạn bấm chọn hoặc tâm chủ thể alpha' },
  { type: 'orbit_sway', nameVi: 'Lắc lư điện ảnh (Orbit Sway)', icon: 'motion_photos_on', desc: 'Xoay nhẹ ±1.2° kèm trôi sin bồng bềnh' },
  { type: 'handheld', nameVi: 'Cầm tay rung nhẹ (Handheld)', icon: 'vibration', desc: 'Mô phỏng máy quay cầm tay tự nhiên' },
  { type: 'dolly_zoom', nameVi: 'Dolly Zoom điện ảnh', icon: 'camera', desc: 'Hiệu ứng Vertigo: nền zoom trong khi chủ thể giữ nguyên' },
];

function getSourceBadge(source?: 'ai' | 'user' | 'default', aiReason?: string): { label: string; className: string } {
  if (source === 'user') {
    return {
      label: 'Chỉnh tay',
      className: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    };
  }
  if (source === 'ai') {
    return {
      label: 'AI chọn',
      className: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    };
  }
  if (aiReason && aiReason.startsWith('AI lỗi')) {
    return {
      label: 'AI lỗi',
      className: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    };
  }
  return {
    label: 'Mặc định',
    className: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/40',
  };
}

// React.memo cho từng dòng ảnh Bước 3 (Yêu cầu 9)
const EffectRowMemo = React.memo<{
  item: QueueItem;
  isSelected: boolean;
  isChecked: boolean;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string) => void;
}>(({ item, isSelected, isChecked, onSelect, onToggleCheck }) => {
  const activeVar = item.variants[item.selectedVariantIndex] || item.variants[0];
  const conf = item.effectConfig || createDefaultEffectConfig();
  const camDef = CAMERA_MOVES.find((c) => c.type === conf.camera.move);
  const layerStatus = item.parallaxLayers?.status || 'none';
  const needLayer = conf.parallax.enabled && layerStatus !== 'ready';
  const badge = getSourceBadge(conf.source, conf.aiReason);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(item.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={handleKeyDown}
      className={`h-[76px] p-2 mx-1.5 my-1 rounded-lg cursor-pointer transition-all border flex gap-2.5 select-none focus:outline-none focus:ring-1 focus:ring-[#f5b301] ${
        isSelected
          ? 'bg-[#1c1c24] border-[#f5b301]/60 shadow-sm'
          : 'bg-[#141417] border-[#22222a] hover:bg-[#18181f]'
      }`}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggleCheck(item.id);
        }}
        className="self-center p-0.5 cursor-pointer"
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => {}}
          className="accent-[#f5b301] w-3.5 h-3.5 rounded pointer-events-none"
        />
      </div>

      <div className="w-14 h-14 bg-black rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center relative border border-[#2b2b35]">
        {activeVar?.thumbnailUrl || activeVar?.blobUrl ? (
          <img
            src={activeVar.thumbnailUrl || activeVar.blobUrl}
            alt="Thumb"
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="material-symbols-outlined text-zinc-600 text-[18px]">image</span>
        )}

        {conf.parallax.enabled && (
          <span
            className={`absolute bottom-0 inset-x-0 text-[7px] font-mono text-center py-0.2 font-bold ${
              layerStatus === 'ready'
                ? 'bg-emerald-600/90 text-white'
                : layerStatus === 'generating'
                ? 'bg-amber-500/90 text-black animate-pulse'
                : 'bg-indigo-600/90 text-white'
            }`}
          >
            {layerStatus === 'ready' ? 'PARALLAX' : 'TÁCH LỚP'}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className="text-xs font-semibold text-zinc-200 truncate">
              #{item.promptItem.order}. {item.promptItem.title}
            </span>
            <span className={`text-[9px] font-mono px-1 py-0.2 rounded border shrink-0 ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          <div className="text-[11px] font-mono text-[#f5b301] truncate flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px]">
              {camDef?.icon || 'movie'}
            </span>
            <span>{camDef?.nameVi || conf.camera.move}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 mt-0.5">
          {conf.parallax.enabled && (
            <span
              className={`text-[9px] font-mono px-1 py-0.2 rounded border ${
                needLayer
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              }`}
            >
              {needLayer ? 'Cần lớp' : '2 Lớp'}
            </span>
          )}
          {conf.overlays.slice(0, 2).map((ov) => {
            const ovDef = OVERLAY_DEFINITIONS.find((d) => d.id === ov.id);
            return (
              <span
                key={ov.id}
                className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#22222a] text-zinc-300 border border-[#2d2d38]"
              >
                {ovDef?.nameVi || ov.id}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export const Step3Effects: React.FC<Step3EffectsProps> = ({
  queue,
  setQueue,
  onProceedToStep4,
  onAddToast,
}) => {
  const validItems = useMemo(
    () => queue.filter((item) => item.variants.length > 0 || item.status === 'done'),
    [queue]
  );

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());

  // Trạng thái tách lớp hàng loạt cho các ảnh cần (Yêu cầu 1)
  const [isBatchSeparating, setIsBatchSeparating] = useState<boolean>(false);
  const [batchLayerProgressText, setBatchLayerProgressText] = useState<string>('');
  const cancelBatchLayerRef = useRef<boolean>(false);

  // Trạng thái AI chọn hiệu ứng cho tất cả (Yêu cầu 1)
  const [isAiDirectingAll, setIsAiDirectingAll] = useState<boolean>(false);
  const [aiDirectProgressText, setAiDirectProgressText] = useState<string>('');
  const [overwriteUserEdited, setOverwriteUserEdited] = useState<boolean>(false);
  const cancelAiDirectorRef = useRef<boolean>(false);

  // Trạng thái AI chọn lại cho riêng ảnh hiện tại (Yêu cầu 2)
  const [isAiDirectingSingle, setIsAiDirectingSingle] = useState<boolean>(false);

  const queueRef = useRef(queue);
  queueRef.current = queue;

  // Khởi tạo effectConfig mặc định nếu chưa có
  useEffect(() => {
    let hasUpdates = false;
    const updated = queue.map((item) => {
      let changed = false;
      let conf = item.effectConfig;
      if (!conf) {
        conf = createDefaultEffectConfig(Math.floor(Math.random() * 100000));
        changed = true;
      }
      if (changed) {
        hasUpdates = true;
        return { ...item, effectConfig: conf };
      }
      return item;
    });

    if (hasUpdates) setQueue(updated);
  }, [queue, setQueue]);

  // Tự động chọn mục đầu tiên nếu chưa chọn
  useEffect(() => {
    if (validItems.length > 0 && !selectedItemId) {
      setSelectedItemId(validItems[0].id);
    }
  }, [validItems, selectedItemId]);

  const currentItem = useMemo(
    () => queue.find((q) => q.id === selectedItemId) || null,
    [queue, selectedItemId]
  );

  const currentVariant = useMemo(() => {
    if (!currentItem || currentItem.variants.length === 0) return null;
    return currentItem.variants[currentItem.selectedVariantIndex] || currentItem.variants[0];
  }, [currentItem]);

  const currentConfig: EffectConfig = currentItem?.effectConfig || createDefaultEffectConfig();
  const currentLayers: ParallaxLayerData = currentItem?.parallaxLayers || { status: 'none' };

  // Danh sách các ảnh đã bật parallax mà chưa có lớp sẵn sàng (Yêu cầu 1)
  const itemsNeedingLayers = useMemo(() => {
    return validItems.filter((item) => {
      const conf = item.effectConfig || createDefaultEffectConfig();
      const status = item.parallaxLayers?.status || 'none';
      return conf.parallax.enabled && status !== 'ready';
    });
  }, [validItems]);

  const updateCurrentConfig = useCallback((updater: (prev: EffectConfig) => EffectConfig) => {
    if (!selectedItemId) return;
    setQueue((prev) =>
      prev.map((item) => {
        if (item.id === selectedItemId) {
          const oldConfig = item.effectConfig || createDefaultEffectConfig();
          const newConfig = updater(oldConfig);
          return {
            ...item,
            effectConfig: { ...newConfig, source: 'user' },
          };
        }
        return item;
      })
    );
  }, [selectedItemId, setQueue]);

  const updateItemLayers = useCallback((id: string, layerData: ParallaxLayerData) => {
    setQueue((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const next = { ...item, parallaxLayers: layerData };
          if (layerData.status === 'ready' && layerData.subjectCenter && item.effectConfig) {
            next.effectConfig = {
              ...item.effectConfig,
              camera: {
                ...item.effectConfig.camera,
                focus: layerData.subjectCenter,
              },
            };
          }
          return next;
        }
        return item;
      })
    );
  }, [setQueue]);

  // Phím mũi tên lên/xuống chuyển mục (Yêu cầu 9)
  const selectedIndex = useMemo(() => {
    return validItems.findIndex((it) => it.id === selectedItemId);
  }, [validItems, selectedItemId]);

  const handleListKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (validItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = Math.min(validItems.length - 1, selectedIndex + 1);
      setSelectedItemId(validItems[nextIdx].id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = Math.max(0, selectedIndex - 1);
      setSelectedItemId(validItems[prevIdx].id);
    }
  }, [validItems, selectedIndex]);

  // 1. Tạo lớp parallax cho các ảnh cần hàng loạt (Yêu cầu 1)
  const handleBatchGenerateLayers = async () => {
    if (isBatchSeparating || itemsNeedingLayers.length === 0) return;

    setIsBatchSeparating(true);
    cancelBatchLayerRef.current = false;
    const total = itemsNeedingLayers.length;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < total; i++) {
      if (cancelBatchLayerRef.current) break;
      const item = itemsNeedingLayers[i];
      setBatchLayerProgressText(`Đang tách lớp ${i + 1}/${total}`);

      const variant = item.variants[item.selectedVariantIndex] || item.variants[0];
      if (!variant || !variant.mediaId) {
        failCount++;
        continue;
      }

      updateItemLayers(item.id, { status: 'generating' });

      try {
        const res = await generateParallaxLayers({
          mediaId: variant.mediaId,
          modelName: variant.modelUsed || '🍌 Nano Banana 2.1',
          aspectRatio: item.promptItem.aspectRatio,
        });
        updateItemLayers(item.id, res);
        if (res.status === 'ready') successCount++;
        else failCount++;
      } catch (err: any) {
        failCount++;
        updateItemLayers(item.id, { status: 'disabled', disabledReason: err?.message });
      }

      await new Promise((r) => setTimeout(r, 200));
    }

    setIsBatchSeparating(false);
    setBatchLayerProgressText('');

    if (cancelBatchLayerRef.current) {
      onAddToast(`Đã dừng tách lớp: xong ${successCount} ảnh, chưa xong ${total - successCount}`, 'info');
    } else if (failCount > 0) {
      onAddToast(`Tách lớp xong: ${successCount} thành công • ${failCount} không tách được`, 'warning');
    } else {
      onAddToast(`Đã tạo xong lớp parallax cho ${successCount} ảnh ✓`, 'success');
    }
  };

  // 2. AI chọn hiệu ứng cho tất cả (Yêu cầu 1)
  const handleAiDirectAll = async () => {
    if (isAiDirectingAll) return;
    const targetItems = validItems.filter((item) => {
      if (!overwriteUserEdited && item.effectConfig?.source === 'user') return false;
      return true;
    });

    if (targetItems.length === 0) {
      onAddToast('Tất cả ảnh đã được chỉnh tay. Tick "Ghi đè cả ảnh đã chỉnh tay" nếu muốn AI chọn lại!', 'info');
      return;
    }

    setIsAiDirectingAll(true);
    cancelAiDirectorRef.current = false;
    const total = targetItems.length;
    let successCount = 0;
    let errorCount = 0;
    let updatedList = [...queueRef.current];

    for (let i = 0; i < total; i++) {
      if (cancelAiDirectorRef.current) break;
      const item = targetItems[i];
      setAiDirectProgressText(`AI đang chọn hiệu ứng ${i + 1}/${total}`);

      const variant = item.variants[item.selectedVariantIndex] || item.variants[0];
      if (!variant) continue;

      const imageUrl = variant.blobUrl || variant.thumbnailUrl;
      const directResult = await directEffectsForImage(
        imageUrl,
        item.sentPrompt || item.promptItem.prompt
      );

      if (directResult.ok) successCount++;
      else errorCount++;

      updatedList = updatedList.map((q) =>
        q.id === item.id ? applyAiDecisionToQueueItem(q, directResult) : q
      );
      queueRef.current = updatedList;
      setQueue(updatedList);
      await new Promise((r) => setTimeout(r, 200));
    }

    const diversified = diversifyCameraMoves(updatedList);
    queueRef.current = diversified;
    setQueue(diversified);

    setIsAiDirectingAll(false);
    setAiDirectProgressText('');

    if (errorCount > 0) {
      onAddToast(`AI chọn xong ${successCount}/${total} ảnh • lỗi ${errorCount}`, 'warning');
    } else {
      onAddToast(`AI chọn xong ${successCount}/${total} ảnh ✓`, 'success');
    }
  };

  // 3. AI chọn lại cho riêng ảnh hiện tại (Yêu cầu 2)
  const handleAiDirectSingle = async () => {
    if (!currentItem || isAiDirectingSingle) return;
    const variant = currentItem.variants[currentItem.selectedVariantIndex] || currentItem.variants[0];
    if (!variant) return;

    setIsAiDirectingSingle(true);
    try {
      const imageUrl = variant.blobUrl || variant.thumbnailUrl;
      const directResult = await directEffectsForImage(
        imageUrl,
        currentItem.sentPrompt || currentItem.promptItem.prompt
      );

      setQueue((prev) =>
        prev.map((q) => (q.id === currentItem.id ? applyAiDecisionToQueueItem(q, directResult) : q))
      );

      if (directResult.ok) {
        onAddToast(`AI đã chọn lại hiệu ứng cho #${currentItem.promptItem.order} ✓`, 'success');
      } else {
        onAddToast(`AI chọn lại lỗi: ${directResult.error || 'Dùng mặc định'}`, 'warning');
      }
    } catch (err: any) {
      onAddToast(`Lỗi: ${err?.message || err}`, 'error');
    } finally {
      setIsAiDirectingSingle(false);
    }
  };

  // 4. Đổi seed ngẫu nhiên (Yêu cầu 2)
  const handleRandomizeSeed = () => {
    const newSeed = Math.floor(Math.random() * 1000000);
    updateCurrentConfig((prev) => ({
      ...prev,
      seed: newSeed,
    }));
    onAddToast(`Đã đổi hạt giống hiệu ứng ngẫu nhiên: ${newSeed}`, 'info');
  };

  // 5. Sinh lớp parallax đơn lẻ
  const handleGenerateLayersSingle = async (item: QueueItem, forceRegen = false) => {
    const variant = item.variants[item.selectedVariantIndex] || item.variants[0];
    if (!variant || !variant.mediaId) return;

    if (forceRegen) invalidateLayerCache(variant.mediaId);
    updateItemLayers(item.id, { status: 'generating' });

    try {
      const res = await generateParallaxLayers({
        mediaId: variant.mediaId,
        modelName: variant.modelUsed || '🍌 Nano Banana 2.1',
        aspectRatio: item.promptItem.aspectRatio,
      });
      updateItemLayers(item.id, res);
      if (res.status === 'ready') {
        onAddToast(`Đã tách lớp parallax thành công cho #${item.promptItem.order} ✓`, 'success');
      } else {
        onAddToast(`Không thể tách lớp: ${res.disabledReason || 'Chủ thể không rõ'}`, 'warning');
      }
    } catch (err: any) {
      updateItemLayers(item.id, { status: 'disabled', disabledReason: err?.message });
      onAddToast(`Lỗi tách lớp: ${err?.message || err}`, 'error');
    }
  };

  const handleToggleParallaxEnabled = async (enabled: boolean) => {
    if (!currentItem) return;
    updateCurrentConfig((prev) => ({
      ...prev,
      parallax: { ...prev.parallax, enabled },
    }));
    if (enabled && (!currentLayers || currentLayers.status === 'none')) {
      handleGenerateLayersSingle(currentItem);
    }
  };

  // 6. Hiệu ứng phủ: giới hạn 3, toast khi chọn thứ 4 (Yêu cầu 6)
  const handleToggleOverlay = (ovId: OverlayId) => {
    const existing = currentConfig.overlays.find((o) => o.id === ovId);
    if (existing) {
      updateCurrentConfig((prev) => ({
        ...prev,
        overlays: prev.overlays.filter((o) => o.id !== ovId),
      }));
    } else {
      if (currentConfig.overlays.length >= 3) {
        onAddToast('Chỉ được chọn tối đa 3 hiệu ứng phủ cùng lúc', 'warning');
        return;
      }
      const def = OVERLAY_DEFINITIONS.find((d) => d.id === ovId);
      updateCurrentConfig((prev) => ({
        ...prev,
        overlays: [...prev.overlays, { id: ovId, intensity: def?.defaultIntensity || 0.4 }],
      }));
    }
  };

  const handleOverlayIntensityChange = (ovId: OverlayId, val: number) => {
    updateCurrentConfig((prev) => ({
      ...prev,
      overlays: prev.overlays.map((o) => (o.id === ovId ? { ...o, intensity: val } : o)),
    }));
  };

  // 7. Nạp lại ảnh từ thư viện cho ảnh đã giải phóng bộ nhớ (Yêu cầu 8)
  const handleReloadMemoryReleasedImage = async () => {
    if (!currentItem) return;
    const reloaded = await reloadImageFromGallery();
    if (!reloaded) return;

    setQueue((prev) =>
      prev.map((q) => {
        if (q.id === currentItem.id) {
          const v = q.variants[currentItem.selectedVariantIndex] || q.variants[0];
          const newVariant = v
            ? {
                ...v,
                blobUrl: reloaded.blobUrl,
                mediaId: reloaded.mediaId,
                isMemoryReleased: false,
              }
            : {
                id: `var_reload_${Date.now()}`,
                blobUrl: reloaded.blobUrl,
                thumbnailUrl: reloaded.blobUrl,
                mediaId: reloaded.mediaId,
                modelUsed: q.activeModel || '🍌 Nano Banana 2.1',
                sentPrompt: q.sentPrompt || q.promptItem.prompt,
                qcStatus: 'idle' as const,
                attemptCount: 1,
                createdAt: Date.now(),
                isMemoryReleased: false,
              };

          return {
            ...q,
            isMemoryReleased: false,
            variants: [newVariant],
            selectedVariantIndex: 0,
          };
        }
        return q;
      })
    );
    onAddToast(`Đã nạp lại ảnh cho #${currentItem.promptItem.order} thành công ✓`, 'success');
  };

  // Áp cấu hình hiện tại cho các ảnh được tick
  const handleApplyToBulkSelected = () => {
    if (bulkSelectedIds.size === 0) return;
    setQueue((prev) =>
      prev.map((item) => {
        if (bulkSelectedIds.has(item.id)) {
          return {
            ...item,
            effectConfig: {
              ...currentConfig,
              seed: Math.floor(Math.random() * 1000000),
              source: 'user',
            },
          };
        }
        return item;
      })
    );
    onAddToast(`Đã áp dụng cấu hình cho ${bulkSelectedIds.size} ảnh đã chọn`, 'success');
  };

  const isMemoryReleased = !!(currentItem?.isMemoryReleased || !currentVariant?.blobUrl);
  const selectedCamDef = CAMERA_MOVES.find((c) => c.type === currentConfig.camera.move);
  const currentBadge = getSourceBadge(currentConfig.source, currentConfig.aiReason);

  return (
    <div
      className="flex-1 flex flex-col h-full bg-[#0b0b0d] text-zinc-200 overflow-hidden"
      onKeyDown={handleListKeyDown}
    >
      {/* 1. THANH TRÊN CÙNG (Yêu cầu 1) */}
      <div className="p-3 border-b border-[#26262b] bg-[#141417] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#f5b301]/10 border border-[#f5b301]/30 flex items-center justify-center text-[#f5b301]">
            <span className="material-symbols-outlined text-[20px]">layers</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-zinc-100 uppercase tracking-wide">
                BƯỚC 3: HIỆU ỨNG MÁY QUAY & AI GIÁM ĐỐC VFX
              </h2>
              <span className="px-2 py-0.2 rounded text-[10px] font-mono font-semibold bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30">
                0 credit
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              AI phân tích ảnh chọn hiệu ứng chuẩn bối cảnh • Parallax 2 lớp
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Nút Tạo lớp parallax cho các ảnh cần (n) */}
          {!isBatchSeparating ? (
            <button
              type="button"
              onClick={handleBatchGenerateLayers}
              disabled={itemsNeedingLayers.length === 0}
              className="px-3 py-1.5 bg-[#181822] hover:bg-[#20202e] text-teal-300 border border-teal-500/40 font-semibold text-xs rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
              title="Tách 2 lớp cho các ảnh đã bật Parallax nhưng chưa có lớp"
            >
              <span className="material-symbols-outlined text-[16px] text-teal-400">auto_fix_high</span>
              <span>Tạo lớp parallax cho các ảnh cần ({itemsNeedingLayers.length})</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-[#181822] px-3 py-1.5 rounded-lg border border-teal-500/40">
              <span className="w-3.5 h-3.5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-mono text-teal-300 font-semibold">{batchLayerProgressText}</span>
              <button
                type="button"
                onClick={() => (cancelBatchLayerRef.current = true)}
                className="ml-1 text-[11px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 font-medium"
              >
                Huỷ
              </button>
            </div>
          )}

          <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer bg-[#18181f] px-2.5 py-1 rounded-lg border border-[#26262b]">
            <input
              type="checkbox"
              checked={overwriteUserEdited}
              onChange={(e) => setOverwriteUserEdited(e.target.checked)}
              className="accent-[#f5b301] w-3.5 h-3.5 rounded"
            />
            <span>Ghi đè cả ảnh đã chỉnh tay</span>
          </label>

          {/* Nút AI chọn hiệu ứng cho tất cả */}
          {!isAiDirectingAll ? (
            <button
              type="button"
              onClick={handleAiDirectAll}
              disabled={validItems.length === 0}
              className="px-3.5 py-1.5 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs rounded-lg transition-all flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">smart_toy</span>
              <span>AI chọn hiệu ứng cho tất cả</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-[#18181f] px-3 py-1.5 rounded-lg border border-sky-500/40">
              <span className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-mono text-sky-300 font-semibold">{aiDirectProgressText}</span>
              <button
                type="button"
                onClick={() => (cancelAiDirectorRef.current = true)}
                className="ml-1 text-[11px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
              >
                Huỷ
              </button>
            </div>
          )}

          {onProceedToStep4 && (
            <button
              type="button"
              onClick={onProceedToStep4}
              className="px-3.5 py-1.5 bg-[#f5b301] text-black font-semibold text-xs rounded-lg hover:bg-[#ffbe1a] transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
            >
              <span>Sang bước 4: Xuất video</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* 2. KHUNG TRÁI: VIRTUALLIST (Yêu cầu 9) */}
        <div className="w-full md:w-[340px] md:min-w-[340px] border-r border-[#26262b] flex flex-col h-full bg-[#111114]">
          <div className="p-2.5 border-b border-[#26262b] bg-[#141417] text-xs font-semibold text-zinc-300 flex items-center justify-between">
            <span>Danh sách ảnh ({validItems.length})</span>
            <button
              type="button"
              onClick={() => {
                if (bulkSelectedIds.size === validItems.length) setBulkSelectedIds(new Set());
                else setBulkSelectedIds(new Set(validItems.map((v) => v.id)));
              }}
              className="text-[11px] text-zinc-400 hover:text-[#f5b301]"
            >
              {bulkSelectedIds.size === validItems.length ? 'Bỏ chọn hết' : 'Tích tất cả'}
            </button>
          </div>

          <div className="flex-1 overflow-hidden" tabIndex={0}>
            <VirtualList<QueueItem>
              items={validItems}
              itemHeight={80}
              className="h-full focus:outline-none"
              buffer={10}
              scrollToIndex={selectedIndex >= 0 ? selectedIndex : undefined}
              autoScrollEnabled={true}
              renderItem={(item) => (
                <EffectRowMemo
                  item={item}
                  isSelected={item.id === selectedItemId}
                  isChecked={bulkSelectedIds.has(item.id)}
                  onSelect={setSelectedItemId}
                  onToggleCheck={(id) => {
                    setBulkSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                />
              )}
            />
          </div>

          <div className="p-2.5 border-t border-[#26262b] bg-[#141417] flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono text-zinc-400">
              Đã tích: <strong>{bulkSelectedIds.size}</strong> ảnh
            </span>
            <button
              type="button"
              onClick={handleApplyToBulkSelected}
              disabled={bulkSelectedIds.size === 0}
              className="px-2.5 py-1 bg-[#1e1e24] hover:bg-[#282830] text-[#f5b301] border border-[#f5b301]/30 rounded text-xs font-medium flex items-center gap-1 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[14px]">content_copy</span>
              <span>Áp cấu hình này</span>
            </button>
          </div>
        </div>

        {/* 3. KHUNG PHẢI: CHI TIẾT & CẤU HÌNH HIỆU ỨNG */}
        <div className="flex-1 flex flex-col h-full bg-[#0b0b0d] overflow-y-auto p-4 md:p-6 space-y-4">
          {currentItem && currentVariant ? (
            <div className="max-w-4xl w-full mx-auto space-y-4">
              {/* Đầu khung phải: #STT Tiêu đề, Tỷ lệ, Nguồn, Nút AI chọn lại & Đổi seed (Yêu cầu 2) */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#26262b] pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-md bg-[#f5b301] text-black font-bold text-xs flex items-center justify-center shrink-0">
                      #{currentItem.promptItem.order}
                    </span>
                    <h3 className="text-sm font-semibold text-zinc-100 truncate max-w-md">
                      {currentItem.promptItem.title}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                    <span>Tỷ lệ: <strong className="text-zinc-200">{currentItem.promptItem.aspectRatio}</strong></span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      Nguồn:
                      <span className={`px-1.5 py-0.2 rounded border font-semibold ${currentBadge.className}`}>
                        {currentBadge.label}
                      </span>
                    </span>
                    <span>•</span>
                    <span>Seed: <strong className="text-amber-400">{currentConfig.seed}</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAiDirectSingle}
                    disabled={isAiDirectingSingle}
                    className="px-3 py-1.5 bg-[#181822] hover:bg-[#20202e] text-sky-300 border border-sky-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
                    title="Gọi AI phân tích lại ảnh này để chọn hiệu ứng"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {isAiDirectingSingle ? 'hourglass_top' : 'psychology'}
                    </span>
                    <span>{isAiDirectingSingle ? 'Đang chọn lại...' : 'AI chọn lại'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRandomizeSeed}
                    className="px-3 py-1.5 bg-[#1e1e24] hover:bg-[#282830] text-zinc-300 border border-[#2d2d35] rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all"
                    title="Đổi seed mới để ngẫu nhiên hoá lại vị trí và chuyển động hạt"
                  >
                    <span className="material-symbols-outlined text-[16px]">casino</span>
                    <span>Đổi seed</span>
                  </button>
                </div>
              </div>

              {/* KHUNG XEM TRƯỚC: Nếu giải phóng bộ nhớ thì không nạp URL rỗng (Yêu cầu 8) */}
              {isMemoryReleased ? (
                <div className="p-6 rounded-xl bg-[#141417] border border-[#26262b] flex flex-col items-center justify-center text-center space-y-3">
                  {currentVariant?.thumbnailUrl && (
                    <img
                      src={currentVariant.thumbnailUrl}
                      alt="Thumbnail"
                      className="w-48 h-28 object-cover rounded-lg border border-[#2d2d38] opacity-80"
                    />
                  )}
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-amber-300 flex items-center justify-center gap-1.5">
                      <span className="material-symbols-outlined text-[18px]">memory</span>
                      Ảnh đã tải xong và được giải phóng bộ nhớ
                    </div>
                    <p className="text-[11px] text-zinc-400 max-w-sm">
                      Dữ liệu ảnh gốc không còn trong RAM để tiết kiệm tài nguyên. Bạn có thể chọn lại ảnh từ thư viện Flow để xem trước và tinh chỉnh.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleReloadMemoryReleasedImage}
                    className="px-4 py-1.5 bg-[#f5b301] text-black font-semibold text-xs rounded-lg hover:bg-[#ffbe1a] transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[16px]">photo_library</span>
                    <span>Nạp lại ảnh</span>
                  </button>
                </div>
              ) : (
                <div className="w-full">
                  <PreviewPlayer
                    imageSrc={currentVariant.blobUrl}
                    aspectRatio={currentItem.promptItem.aspectRatio}
                    effectConfig={currentConfig}
                    parallaxLayers={currentItem.parallaxLayers}
                    onChangeFocus={(focus) =>
                      updateCurrentConfig((prev) => ({
                        ...prev,
                        camera: { ...prev.camera, focus },
                      }))
                    }
                  />
                </div>
              )}

              {/* DƯỚI PREVIEW: Thẻ Lý do AI chọn hiệu ứng (Yêu cầu 3) */}
              {currentConfig.aiReason && (
                <div className="p-3 rounded-lg bg-[#141620] border border-sky-500/30 flex items-start gap-2.5 text-xs text-sky-200">
                  <span className="material-symbols-outlined text-sky-400 text-[18px] shrink-0 mt-0.5">
                    psychology
                  </span>
                  <div className="space-y-0.5">
                    <span className="font-semibold text-sky-300">Lý do AI chọn hiệu ứng:</span>
                    <p className="text-[11px] leading-relaxed italic text-sky-100/90">
                      "{currentConfig.aiReason}"
                    </p>
                  </div>
                </div>
              )}

              {/* THẺ PARALLAX ĐẦY ĐỦ 4 TRẠNG THÁI (Yêu cầu 4) */}
              <div className="p-4 rounded-xl bg-[#141417] border border-[#26262b] space-y-3.5">
                <div className="flex items-center justify-between border-b border-[#26262b] pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-teal-400 text-[18px]">layers</span>
                    <h4 className="text-xs font-semibold text-zinc-100 uppercase">
                      Parallax 2 Lớp (Độ sâu tách biệt)
                    </h4>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer bg-[#181820] px-3 py-1 rounded-lg border border-[#2f2f3d]">
                    <input
                      type="checkbox"
                      checked={currentConfig.parallax.enabled}
                      onChange={(e) => handleToggleParallaxEnabled(e.target.checked)}
                      className="accent-[#22c55e] w-4 h-4 rounded"
                    />
                    <span className="text-xs font-semibold text-zinc-200">
                      {currentConfig.parallax.enabled ? 'Đã bật' : 'Bật Parallax'}
                    </span>
                  </label>
                </div>

                {/* 4 kiểu trạng thái lớp */}
                <div className="p-3 rounded-lg bg-[#181822] border border-[#282838] space-y-3">
                  {/* Trạng thái 1: Chưa tạo lớp */}
                  {currentLayers.status === 'none' && (
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-zinc-400">
                        Chưa tạo lớp tách nền & chủ thể cho ảnh này.
                      </span>
                      <button
                        type="button"
                        onClick={() => handleGenerateLayersSingle(currentItem)}
                        className="px-3 py-1 bg-teal-600 hover:bg-teal-500 text-white font-semibold text-xs rounded-lg transition-all flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[15px]">auto_fix_high</span>
                        <span>Tạo lớp</span>
                      </button>
                    </div>
                  )}

                  {/* Trạng thái 2: Đang tạo lớp */}
                  {currentLayers.status === 'generating' && (
                    <div className="flex items-center gap-2 text-xs font-mono text-amber-300">
                      <span className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                      <span>Đang tạo lớp nền inpaint và chủ thể chroma key...</span>
                    </div>
                  )}

                  {/* Trạng thái 3: Sẵn sàng */}
                  {currentLayers.status === 'ready' && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-semibold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Sẵn sàng
                          </span>
                          {currentLayers.subjectAreaRatio !== undefined && (
                            <span className="text-[11px] font-mono text-zinc-400">
                              Diện tích chủ thể: <strong className="text-zinc-200">{Math.round(currentLayers.subjectAreaRatio * 100)}%</strong>
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleGenerateLayersSingle(currentItem, true)}
                          className="text-[11px] px-2.5 py-1 rounded bg-[#22222c] hover:bg-[#2c2c38] text-zinc-300 border border-[#333344] font-medium flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[14px]">refresh</span>
                          <span>Tạo lại lớp</span>
                        </button>
                      </div>

                      {/* 2 ô thu nhỏ: Lớp nền & Lớp chủ thể trên nền caro */}
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div className="space-y-1">
                          <div className="text-[10px] font-mono text-zinc-400">1. Lớp nền (Inpaint)</div>
                          <div className="aspect-video bg-black rounded-lg overflow-hidden border border-[#2d2d3d] flex items-center justify-center">
                            {currentLayers.bgBlobUrl ? (
                              <img
                                src={currentLayers.bgBlobUrl}
                                alt="Background Layer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-[10px] text-zinc-600 font-mono">Trống</span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="text-[10px] font-mono text-zinc-400">2. Lớp chủ thể (Chroma Key)</div>
                          <div
                            className="aspect-video rounded-lg overflow-hidden border border-[#2d2d3d] flex items-center justify-center relative"
                            style={{
                              backgroundImage: `linear-gradient(45deg, #222 25%, transparent 25%), linear-gradient(-45deg, #222 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #222 75%), linear-gradient(-45deg, transparent 75%, #222 75%)`,
                              backgroundSize: '14px 14px',
                              backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0px',
                              backgroundColor: '#111',
                            }}
                          >
                            {currentLayers.subjectCutoutBlobUrl ? (
                              <img
                                src={currentLayers.subjectCutoutBlobUrl}
                                alt="Subject Cutout"
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <span className="text-[10px] text-zinc-600 font-mono">Trống</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Trạng thái 4: Đã tắt */}
                  {currentLayers.status === 'disabled' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="space-y-0.5">
                        <span className="text-amber-400 font-semibold">Đã tắt Parallax cho ảnh này</span>
                        <div className="text-[11px] text-zinc-400 italic">
                          {currentLayers.disabledReason || 'Không tách được chủ thể rõ ràng'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleGenerateLayersSingle(currentItem, true)}
                        className="px-3 py-1 bg-[#22222c] hover:bg-[#2c2c38] text-zinc-200 border border-[#383848] rounded-lg text-xs font-medium"
                      >
                        Thử tạo lại
                      </button>
                    </div>
                  )}

                  {/* Tuỳ chọn tham số Parallax: Hướng, Độ sâu, Thở nhẹ, Lơ lửng */}
                  {currentConfig.parallax.enabled && (
                    <div className="pt-2 border-t border-[#2d2d3d] space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-300">Hướng Parallax:</label>
                          <select
                            value={currentConfig.parallax.direction}
                            onChange={(e) =>
                              updateCurrentConfig((prev) => ({
                                ...prev,
                                parallax: { ...prev.parallax, direction: e.target.value as any },
                              }))
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-[#14141a] border border-[#2f2f3d] text-xs text-zinc-200 font-medium focus:outline-none"
                          >
                            <option value="in">Phóng vào (In)</option>
                            <option value="left">Trái (Left)</option>
                            <option value="right">Phải (Right)</option>
                            <option value="up">Lên (Up)</option>
                            <option value="down">Xuống (Down)</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-zinc-300 font-medium">
                            <span>Độ sâu (Depth):</span>
                            <span className="font-mono text-teal-400">{Math.round((currentConfig.parallax.depth || 0.5) * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={currentConfig.parallax.depth || 0.5}
                            onChange={(e) =>
                              updateCurrentConfig((prev) => ({
                                ...prev,
                                parallax: { ...prev.parallax, depth: parseFloat(e.target.value) },
                              }))
                            }
                            className="w-full h-1.5 bg-[#22222a] rounded-lg appearance-none cursor-pointer accent-teal-400"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 pt-1">
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                          <input
                            type="checkbox"
                            checked={!!currentConfig.parallax.subjectBreath}
                            onChange={(e) =>
                              updateCurrentConfig((prev) => ({
                                ...prev,
                                parallax: { ...prev.parallax, subjectBreath: e.target.checked },
                              }))
                            }
                            className="accent-teal-400 w-3.5 h-3.5 rounded"
                          />
                          <span>Thở nhẹ (3s sin)</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                          <input
                            type="checkbox"
                            checked={!!currentConfig.parallax.subjectFloat}
                            onChange={(e) =>
                              updateCurrentConfig((prev) => ({
                                ...prev,
                                parallax: { ...prev.parallax, subjectFloat: e.target.checked },
                              }))
                            }
                            className="accent-teal-400 w-3.5 h-3.5 rounded"
                          />
                          <span>Lơ lửng (±0.6% dọc)</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* THẺ MÁY QUAY: intensity, easing, push_to_focus hint (Yêu cầu 5) */}
              <div className="p-4 rounded-xl bg-[#141417] border border-[#26262b] space-y-3.5">
                <div className="flex items-center justify-between border-b border-[#26262b] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-amber-400 text-[18px]">videocam</span>
                    <h4 className="text-xs font-semibold text-zinc-200 uppercase">Chuyển động máy quay</h4>
                  </div>
                  {selectedCamDef && (
                    <span className="text-[11px] font-mono text-amber-400">
                      {selectedCamDef.nameVi}
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <select
                      value={currentConfig.camera.move}
                      onChange={(e) =>
                        updateCurrentConfig((prev) => ({
                          ...prev,
                          camera: { ...prev.camera, move: e.target.value as CameraMoveType },
                        }))
                      }
                      className="w-full px-3 py-1.5 rounded-lg bg-[#18181f] border border-[#2d2d35] text-xs font-semibold text-[#f5b301] focus:outline-none"
                    >
                      {CAMERA_MOVES.map((m) => (
                        <option key={m.type} value={m.type}>
                          {m.nameVi}
                        </option>
                      ))}
                    </select>
                    {selectedCamDef && (
                      <p className="text-[11px] text-zinc-400 mt-1 leading-snug">
                        {selectedCamDef.desc}
                      </p>
                    )}
                    {currentConfig.camera.move === 'push_to_focus' && (
                      <div className="mt-1.5 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[15px]">center_focus_strong</span>
                        <span>Bấm lên khung xem trước để đặt điểm nhấn</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-[#26262b]">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-zinc-300 font-medium">
                        <span>Cường độ máy quay (Intensity):</span>
                        <span className="font-mono text-amber-400">{Math.round((currentConfig.camera.intensity || 0.4) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={currentConfig.camera.intensity || 0.4}
                        onChange={(e) =>
                          updateCurrentConfig((prev) => ({
                            ...prev,
                            camera: { ...prev.camera, intensity: parseFloat(e.target.value) },
                          }))
                        }
                        className="w-full h-1.5 bg-[#22222a] rounded-lg appearance-none cursor-pointer accent-[#f5b301]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-zinc-300">Độ mượt (Easing):</label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateCurrentConfig((prev) => ({
                              ...prev,
                              camera: { ...prev.camera, easing: 'easeInOut' },
                            }))
                          }
                          className={`flex-1 py-1 px-2.5 rounded-lg text-xs font-medium border transition-colors ${
                            currentConfig.camera.easing === 'easeInOut'
                              ? 'bg-amber-400/20 text-amber-300 border-amber-400/50 font-bold'
                              : 'bg-[#18181f] text-zinc-400 border-[#2d2d35]'
                          }`}
                        >
                          Mượt (Ease In Out)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateCurrentConfig((prev) => ({
                              ...prev,
                              camera: { ...prev.camera, easing: 'linear' },
                            }))
                          }
                          className={`flex-1 py-1 px-2.5 rounded-lg text-xs font-medium border transition-colors ${
                            currentConfig.camera.easing === 'linear'
                              ? 'bg-amber-400/20 text-amber-300 border-amber-400/50 font-bold'
                              : 'bg-[#18181f] text-zinc-400 border-[#2d2d35]'
                          }`}
                        >
                          Đều (Linear)
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* THẺ HIỆU ỨNG PHỦ: n/3, toast cảnh báo thứ 4, thanh cường độ ngay trong ô (Yêu cầu 6) */}
              <div className="p-4 rounded-xl bg-[#141417] border border-[#26262b] space-y-3">
                <div className="flex items-center justify-between border-b border-[#26262b] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-400 text-[18px]">auto_awesome</span>
                    <h4 className="text-xs font-semibold text-zinc-200 uppercase">Hiệu ứng phủ (Overlays)</h4>
                  </div>
                  <span className="text-xs font-mono font-bold text-amber-400">
                    Đã chọn {currentConfig.overlays.length}/3
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                  {OVERLAY_DEFINITIONS.map((ov) => {
                    const activeOv = currentConfig.overlays.find((o) => o.id === ov.id);
                    const isActive = !!activeOv;

                    return (
                      <div
                        key={ov.id}
                        className={`p-2.5 rounded-lg border transition-all flex flex-col justify-between gap-1.5 ${
                          isActive
                            ? 'bg-[#1e1c24] border-amber-400 shadow-sm'
                            : 'bg-[#18181f] border-[#26262b] hover:border-zinc-600'
                        }`}
                      >
                        <div
                          onClick={() => handleToggleOverlay(ov.id)}
                          className="cursor-pointer space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="material-symbols-outlined text-[18px] text-[#f5b301]">
                              {ov.icon}
                            </span>
                            <span
                              className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] ${
                                isActive ? 'bg-amber-400 border-amber-400 text-black font-bold' : 'border-zinc-600'
                              }`}
                            >
                              {isActive ? '✓' : ''}
                            </span>
                          </div>
                          <span className="text-xs font-semibold text-zinc-100 block truncate">
                            {ov.nameVi}
                          </span>
                          <p className="text-[10px] text-zinc-400 line-clamp-2 leading-tight">
                            {ov.description}
                          </p>
                        </div>

                        {isActive && (
                          <div className="pt-1.5 border-t border-[#2e2a38] space-y-1">
                            <div className="flex justify-between text-[10px] font-mono text-zinc-300">
                              <span>Cường độ:</span>
                              <span className="text-amber-400">{Math.round(activeOv.intensity * 100)}%</span>
                            </div>
                            <input
                              type="range"
                              min={0.1}
                              max={1}
                              step={0.05}
                              value={activeOv.intensity}
                              onChange={(e) => handleOverlayIntensityChange(ov.id, parseFloat(e.target.value))}
                              className="w-full h-1.5 bg-[#2a2434] rounded appearance-none cursor-pointer accent-[#f5b301]"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* THẺ CUỐI: Thời lượng 3-10 giây & Công tắc Fade (Yêu cầu 7) */}
              <div className="p-4 rounded-xl bg-[#141417] border border-[#26262b] flex flex-wrap items-center justify-between gap-4">
                <div className="flex-1 min-w-[240px] space-y-1.5">
                  <div className="flex justify-between text-xs font-medium text-zinc-300">
                    <span className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-amber-400">timer</span>
                      <span>Thời lượng clip (Duration):</span>
                    </span>
                    <span className="font-mono text-amber-400 font-bold">
                      {currentConfig.durationSec || 6} giây
                    </span>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={10}
                    step={1}
                    value={currentConfig.durationSec || 6}
                    onChange={(e) =>
                      updateCurrentConfig((prev) => ({
                        ...prev,
                        durationSec: parseInt(e.target.value, 10),
                      }))
                    }
                    className="w-full h-1.5 bg-[#22222a] rounded-lg appearance-none cursor-pointer accent-[#f5b301]"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                    <span>3s (Nhanh)</span>
                    <span>6s (Mặc định)</span>
                    <span>10s (Dài)</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 pl-4 border-l border-[#26262b]">
                  <label className="flex items-center gap-2 cursor-pointer bg-[#18181f] px-3.5 py-2 rounded-lg border border-[#26262b] hover:border-zinc-600 transition-colors">
                    <input
                      type="checkbox"
                      checked={!!currentConfig.fadeInOut}
                      onChange={(e) =>
                        updateCurrentConfig((prev) => ({
                          ...prev,
                          fadeInOut: e.target.checked,
                        }))
                      }
                      className="accent-[#f5b301] w-4 h-4 rounded"
                    />
                    <div className="text-left">
                      <div className="text-xs font-semibold text-zinc-200">Fade In / Out</div>
                      <div className="text-[10px] text-zinc-400">0.3s mờ từ/về đen</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-xs">
              <span className="material-symbols-outlined text-[32px] mb-2 opacity-50">
                auto_awesome_motion
              </span>
              <span>Chọn một ảnh bên trái để xem trước và tinh chỉnh hiệu ứng</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
