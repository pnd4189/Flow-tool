import React, { useState, useRef, useEffect } from 'react';
import { Shot, Scene, Character, ProjectConfig, KeyframeInfo } from '../services/types';
import {
  KeyframeSlot,
  buildKeyframeSlots,
  generateSingleKeyframeWithRetry,
  applyKeyframeToShots,
  generateSceneLocationRef,
} from '../services/keyframeService';

interface StoryboardGridProps {
  shots: Shot[];
  scenes: Scene[];
  characters: Character[];
  config: ProjectConfig;
  onUpdateShots: (updatedShots: Shot[]) => void;
  onUpdateScenes?: (updatedScenes: Scene[]) => void;
}

export const StoryboardGrid: React.FC<StoryboardGridProps> = ({
  shots,
  scenes,
  characters,
  config,
  onUpdateShots,
  onUpdateScenes,
}) => {
  const [slots, setSlots] = useState<KeyframeSlot[]>([]);
  const [autoGenLocationRef, setAutoGenLocationRef] = useState(true);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSlotId, setCurrentSlotId] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string>('');

  const [confirmRegenAll, setConfirmRegenAll] = useState(false);
  const [lightboxSlot, setLightboxSlot] = useState<KeyframeSlot | null>(null);

  const stopRequestedRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const shotsRef = useRef<Shot[]>(shots);
  shotsRef.current = shots;

  // Sync slots khi props thay đổi
  useEffect(() => {
    const nextSlots = buildKeyframeSlots(shots, scenes, characters, config);
    setSlots(nextSlots);
  }, [shots, scenes, characters, config]);

  const totalSlots = slots.length;
  const completedSlots = slots.filter((s) => s.currentKeyframe).length;

  const handleStartBatchGeneration = async (mode: 'missing_only' | 'all') => {
    if (totalSlots === 0) return;

    stopRequestedRef.current = false;
    pauseRequestedRef.current = false;
    setIsGenerating(true);
    setIsPaused(false);

    let currentShots = [...shotsRef.current];
    let currentScenes = [...scenes];

    // Tự sinh ảnh bối cảnh cho các scene chưa có nếu bật tùy chọn
    if (autoGenLocationRef) {
      for (let sIdx = 0; sIdx < currentScenes.length; sIdx++) {
        if (!currentScenes[sIdx].locationRef) {
          try {
            setProgressText(`Đang tạo ảnh bối cảnh cho ${currentScenes[sIdx].title}...`);
            const loc = await generateSceneLocationRef(currentScenes[sIdx], config);
            currentScenes[sIdx] = { ...currentScenes[sIdx], locationRef: loc };
            if (onUpdateScenes) onUpdateScenes(currentScenes);
          } catch (e) {
            console.error('Lỗi sinh ảnh bối cảnh:', e);
          }
        }
      }
    }

    // Xác định danh sách slotId cần sinh lúc bắt đầu
    const initialSlots = buildKeyframeSlots(currentShots, currentScenes, characters, config);
    const targetSlotIds: string[] = [];
    initialSlots.forEach((s) => {
      if (mode === 'all' || !s.currentKeyframe) {
        targetSlotIds.push(s.slotId);
      }
    });

    if (targetSlotIds.length === 0) {
      setIsGenerating(false);
      return;
    }

    for (let i = 0; i < targetSlotIds.length; i++) {
      if (stopRequestedRef.current) break;

      while (pauseRequestedRef.current) {
        await new Promise((r) => setTimeout(r, 400));
        if (stopRequestedRef.current) break;
      }
      if (stopRequestedRef.current) break;

      const targetId = targetSlotIds[i];

      // TÍNH LẠI SLOTS từ currentShots và currentScenes mới nhất để lấy đúng prompt + refMediaIds kế thừa
      const freshSlots = buildKeyframeSlots(currentShots, currentScenes, characters, config);
      const slot = freshSlots.find((s) => s.slotId === targetId);

      if (!slot) continue;

      setCurrentSlotId(targetId);
      setProgressText(`Đang sinh ${i + 1}/${targetSlotIds.length}: ${slot.label}`);

      setSlots((prev) =>
        prev.map((s) =>
          s.slotId === targetId ? { ...s, status: 'pending', errorMessage: undefined } : s
        )
      );

      try {
        const kf: KeyframeInfo = await generateSingleKeyframeWithRetry(
          slot.prompt,
          config,
          slot.referenceMediaIds
        );

        // Áp dụng keyframe vào currentShots để lượt kế tiếp kế thừa
        currentShots = applyKeyframeToShots(currentShots, slot, kf);
        onUpdateShots(currentShots);

        // Tính lại slots hiển thị bao gồm refSummary mới
        const updatedSlots = buildKeyframeSlots(currentShots, currentScenes, characters, config);
        setSlots(updatedSlots);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setSlots((prev) =>
          prev.map((s) =>
            s.slotId === targetId ? { ...s, status: 'error', errorMessage: errorMsg } : s
          )
        );
      }
    }

    setIsGenerating(false);
    setIsPaused(false);
    setCurrentSlotId(null);
    setProgressText('');
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

  const handleStop = () => {
    stopRequestedRef.current = true;
    pauseRequestedRef.current = false;
    setIsPaused(false);
  };

  const handleRegenerateSingle = async (targetSlotId: string) => {
    // Tính slots mới nhất
    const freshSlots = buildKeyframeSlots(shotsRef.current, scenes, characters, config);
    const slot = freshSlots.find((s) => s.slotId === targetSlotId);
    if (!slot) return;

    setSlots((prev) =>
      prev.map((s) =>
        s.slotId === targetSlotId ? { ...s, status: 'pending', errorMessage: undefined } : s
      )
    );

    try {
      const kf = await generateSingleKeyframeWithRetry(
        slot.prompt,
        config,
        slot.referenceMediaIds
      );
      const updatedShots = applyKeyframeToShots(shotsRef.current, slot, kf);
      onUpdateShots(updatedShots);

      const nextSlots = buildKeyframeSlots(updatedShots, scenes, characters, config);
      const slotIndex = nextSlots.findIndex((s) => s.slotId === targetSlotId);

      // Đánh dấu chấm vàng cho các slot kế tiếp trong cùng scene có hasContinuityRef
      setSlots(
        nextSlots.map((s, idx) => {
          if (s.slotId === targetSlotId) {
            return { ...s, needsSyncWarning: false };
          }
          if (idx > slotIndex && s.hasContinuityRef) {
            return { ...s, needsSyncWarning: true };
          }
          return s;
        })
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setSlots((prev) =>
        prev.map((s) =>
          s.slotId === targetSlotId ? { ...s, status: 'error', errorMessage: errorMsg } : s
        )
      );
    }
  };

  const handleDeleteSlotKeyframe = (targetSlotId: string) => {
    const slot = slots.find((s) => s.slotId === targetSlotId);
    if (!slot) return;

    const updatedShots = applyKeyframeToShots(shotsRef.current, slot, undefined);
    onUpdateShots(updatedShots);

    const nextSlots = buildKeyframeSlots(updatedShots, scenes, characters, config);
    setSlots(nextSlots);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d0d0d] overflow-hidden select-none">
      {/* Top Toolbar */}
      <div className="p-3 bg-[#141414] border-b border-[#595959]/50 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-amber-400 text-lg">grid_view</span>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-100">
              Storyboard Grid (Slots)
            </span>
          </div>

          <div className="flex items-center gap-1.5 bg-[#1f1f1f] px-2 py-0.5 rounded border border-[#595959]/40 text-xs font-mono">
            <span className="text-slate-400">Tiến độ:</span>
            <span className="text-emerald-400 font-bold">
              {completedSlots}/{totalSlots} keyframes
            </span>
            <span className="text-[10px] text-amber-400/90 font-mono">(0 credit)</span>
          </div>

          {/* Tùy chọn tự tạo ảnh bối cảnh */}
          <label className="flex items-center gap-1.5 text-xs text-slate-300 font-mono cursor-pointer bg-[#1c1c1c] px-2 py-0.5 rounded border border-[#595959]/30">
            <input
              type="checkbox"
              checked={autoGenLocationRef}
              onChange={(e) => setAutoGenLocationRef(e.target.checked)}
              className="accent-amber-500 rounded"
            />
            <span>Tự tạo ảnh bối cảnh cho mỗi scene</span>
          </label>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {isGenerating ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePauseToggle}
                className="px-2.5 py-1 rounded bg-[#2b2b2b] hover:bg-[#353535] text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center gap-1 transition"
              >
                <span className="material-symbols-outlined text-[15px]">
                  {isPaused ? 'play_arrow' : 'pause'}
                </span>
                {isPaused ? 'Tiếp tục' : 'Tạm dừng'}
              </button>
              <button
                type="button"
                onClick={handleStop}
                className="px-2.5 py-1 rounded bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-500/40 text-xs font-semibold flex items-center gap-1 transition"
              >
                <span className="material-symbols-outlined text-[15px]">stop</span>
                Dừng
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={shots.length === 0}
                onClick={() => handleStartBatchGeneration('missing_only')}
                className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold text-xs flex items-center gap-1.5 transition shadow"
              >
                <span className="material-symbols-outlined text-[15px]">auto_fix_high</span>
                Sinh còn thiếu (0 credit)
              </button>

              {confirmRegenAll ? (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmRegenAll(false);
                    handleStartBatchGeneration('all');
                  }}
                  className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center gap-1 animate-pulse transition"
                >
                  <span className="material-symbols-outlined text-[15px]">warning</span>
                  Xác nhận sinh lại tất cả!
                </button>
              ) : (
                <button
                  type="button"
                  disabled={shots.length === 0}
                  onClick={() => {
                    setConfirmRegenAll(true);
                    setTimeout(() => setConfirmRegenAll(false), 3500);
                  }}
                  className="px-2.5 py-1.5 rounded bg-[#252525] hover:bg-[#303030] disabled:opacity-40 text-slate-300 border border-[#595959]/40 text-xs flex items-center gap-1 transition"
                  title="Sinh lại toàn bộ ảnh (xác nhận 2 bước)"
                >
                  <span className="material-symbols-outlined text-[15px]">restart_alt</span>
                  Sinh lại tất cả
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {isGenerating && (
        <div className="bg-[#1b1b1b] border-b border-amber-500/40 px-3 py-1.5 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-amber-300">
            <span className="material-symbols-outlined text-[16px] animate-spin">
              progress_activity
            </span>
            <span>{progressText}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>Kế thừa bối cảnh trong cùng scene (tối đa 10 refs)</span>
            {isPaused && (
              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                ĐANG TẠM DỪNG
              </span>
            )}
          </div>
        </div>
      )}

      {/* Grid Gallery Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {slots.length === 0 ? (
          <div className="h-64 rounded-xl border border-dashed border-[#595959]/40 flex flex-col items-center justify-center p-6 text-center text-slate-500 space-y-2">
            <span className="material-symbols-outlined text-4xl text-amber-500/60">
              image_not_supported
            </span>
            <h3 className="text-sm font-semibold text-slate-300">
              Chưa có dữ liệu Shot nào trong kịch bản
            </h3>
            <p className="text-xs text-slate-500 max-w-sm">
              Chuyển sang tab "Script Engine" để dán kịch bản và tách shot trước.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5">
            {slots.map((slot) => {
              const isSelected = currentSlotId === slot.slotId;
              const hasImage = Boolean(slot.currentKeyframe);

              return (
                <div
                  key={slot.slotId}
                  className={`group rounded-lg bg-[#141414] border transition flex flex-col overflow-hidden relative ${
                    isSelected
                      ? 'border-amber-400 ring-2 ring-amber-400/40 shadow-lg'
                      : hasImage
                      ? 'border-emerald-500/70 hover:border-emerald-400 shadow-sm'
                      : slot.status === 'error'
                      ? 'border-red-500/80 bg-red-950/10'
                      : 'border-[#595959]/50 hover:border-slate-400'
                  }`}
                >
                  {/* Card Header Label + refSummary */}
                  <div className="px-2 py-1.5 bg-[#1c1c1c] border-b border-[#595959]/30 flex flex-col gap-0.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-amber-300 truncate max-w-[170px]" title={slot.label}>
                        {slot.label}
                      </span>
                      {slot.needsSyncWarning && (
                        <span
                          className="w-2 h-2 rounded-full bg-amber-400 animate-ping"
                          title="Nên sinh lại để khớp bối cảnh mới"
                        />
                      )}
                    </div>
                    {/* Dòng nhỏ refSummary kế thừa */}
                    <div
                      className="text-[9px] font-mono text-slate-400 truncate flex items-center gap-1"
                      title={`Kế thừa từ: ${slot.refSummary}`}
                    >
                      <span className="material-symbols-outlined text-[10px] text-amber-400/80">link</span>
                      <span className="text-slate-300">{slot.refSummary}</span>
                    </div>
                  </div>

                  {/* Image View / Placeholder */}
                  <div
                    onClick={() => {
                      if (hasImage) setLightboxSlot(slot);
                    }}
                    className={`aspect-video w-full bg-[#0a0a0a] relative flex items-center justify-center overflow-hidden ${
                      hasImage ? 'cursor-pointer' : ''
                    }`}
                  >
                    {slot.currentKeyframe ? (
                      <>
                        <img
                          src={`data:image/jpeg;base64,${slot.currentKeyframe.thumbBase64}`}
                          alt={slot.label}
                          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="p-1 rounded-full bg-black/70 text-white flex items-center justify-center">
                            <span className="material-symbols-outlined text-[18px]">zoom_in</span>
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-600 gap-1 p-2 text-center">
                        <span className="material-symbols-outlined text-2xl">
                          {slot.status === 'pending'
                            ? 'progress_activity'
                            : slot.status === 'error'
                            ? 'error'
                            : 'image'}
                        </span>
                        <span className="text-[10px] font-mono">
                          {slot.status === 'pending'
                            ? 'Đang sinh ảnh...'
                            : slot.status === 'error'
                            ? 'Lỗi sinh ảnh'
                            : 'Chưa có ảnh'}
                        </span>
                      </div>
                    )}

                    <div className="absolute bottom-1 left-1 flex items-center gap-1">
                      {hasImage && (
                        <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-500/50 text-[9px] font-mono px-1 rounded">
                          DONE
                        </span>
                      )}
                      {slot.status === 'pending' && (
                        <span className="bg-amber-950/80 text-amber-300 border border-amber-500/50 text-[9px] font-mono px-1 rounded animate-pulse">
                          GEN...
                        </span>
                      )}
                      {slot.status === 'error' && (
                        <span className="bg-red-950/80 text-red-300 border border-red-500/50 text-[9px] font-mono px-1 rounded">
                          ERROR
                        </span>
                      )}
                    </div>
                  </div>

                  {slot.errorMessage && (
                    <div className="p-1.5 bg-red-950/80 border-t border-red-500/50 text-red-300 text-[10px] font-mono break-words">
                      {slot.errorMessage}
                    </div>
                  )}

                  {/* Prompt preview */}
                  <div className="p-2 text-[10px] text-slate-400 font-mono bg-[#141414] border-t border-[#595959]/20 flex-1 flex flex-col justify-between">
                    <p
                      className="line-clamp-2 leading-tight text-slate-300 select-text"
                      title={slot.prompt}
                    >
                      {slot.prompt}
                    </p>

                    <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-[#595959]/20">
                      <span className="text-[9px] text-slate-500">
                        {slot.referenceMediaIds.length > 0
                          ? `@${slot.referenceMediaIds.length} refs`
                          : 'No ref'}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={isGenerating}
                          onClick={() => handleRegenerateSingle(slot.slotId)}
                          className="p-1 rounded bg-[#222] hover:bg-[#303030] text-slate-300 hover:text-amber-300 transition"
                          title="Sinh lại keyframe này"
                        >
                          <span className="material-symbols-outlined text-[13px]">refresh</span>
                        </button>
                        {hasImage && (
                          <button
                            type="button"
                            disabled={isGenerating}
                            onClick={() => handleDeleteSlotKeyframe(slot.slotId)}
                            className="p-1 rounded bg-[#222] hover:bg-red-950/70 text-slate-400 hover:text-red-400 transition"
                            title="Xoá keyframe này"
                          >
                            <span className="material-symbols-outlined text-[13px]">delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {lightboxSlot && lightboxSlot.currentKeyframe && (
        <div
          onClick={() => setLightboxSlot(null)}
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-4xl w-full bg-[#141414] border border-[#595959] rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="p-3 bg-[#1e1e1e] border-b border-[#595959]/50 flex items-center justify-between">
              <div>
                <span className="font-mono font-bold text-amber-300 text-sm block">
                  {lightboxSlot.label}
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  Nguồn kế thừa: {lightboxSlot.refSummary}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLightboxSlot(null)}
                className="p-1 rounded hover:bg-[#333] text-slate-400 hover:text-white transition"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="flex-1 bg-black flex items-center justify-center p-2 overflow-hidden">
              <img
                src={`data:image/jpeg;base64,${lightboxSlot.currentKeyframe.thumbBase64}`}
                alt={lightboxSlot.label}
                className="max-w-full max-h-[60vh] object-contain rounded"
              />
            </div>

            <div className="p-3 bg-[#181818] border-t border-[#595959]/40 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>Prompt sử dụng ({lightboxSlot.referenceMediaIds.length} refs):</span>
                <span className="text-emerald-400">mediaId: {lightboxSlot.currentKeyframe.mediaId}</span>
              </div>
              <p className="p-2 rounded bg-[#0e0e0e] border border-[#595959]/30 text-slate-300 text-[11px] font-mono leading-relaxed select-text">
                {lightboxSlot.prompt}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
