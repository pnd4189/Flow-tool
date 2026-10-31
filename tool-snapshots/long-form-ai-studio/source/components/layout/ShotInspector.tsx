import React, { useState, useEffect } from 'react';
import {
  Shot,
  Scene,
  Character,
  ProjectConfig,
  KeyframeInfo,
  VideoModel,
  VideoResolution,
  VideoTake,
  getActiveTake,
  ShotPatch,
} from '../../services/types';
import {
  SHOT_SIZES,
  CAMERA_ANGLES,
  CAMERA_MOVES,
  PERSPECTIVES,
  LIGHTINGS,
  WEATHERS,
  EFFECTS,
  SHOT_RECIPES,
  ShotRecipe,
  getLook,
} from '../../services/library';
import {
  compileVideoPrompt,
  compileKeyframePrompt,
} from '../../services/shotengine';
import { generateSingleKeyframeWithRetry } from '../../services/keyframeService';
import {
  getShotKeyframes,
  getEffectiveShotRenderConfig,
  isShotModifiedAfterLock,
  checkTakeStaleness,
  renderShotTake,
} from '../../services/renderService';
import { evaluateTakeQC } from '../../services/qcService';
import { getMaxNarrationWords, countWords } from '../../services/scriptWriter';
import { Select } from '../ui/Select';
import { Chip } from '../ui/Chip';
import { Button } from '../ui/Button';

interface ShotInspectorProps {
  shot: Shot;
  scene?: Scene;
  characters: Character[];
  config: ProjectConfig;
  allShots?: Shot[];
  hasPrevShot: boolean;
  hasNextShot: boolean;
  onPrevShot: () => void;
  onNextShot: () => void;
  onPatchShot: (shotId: string, patch: ShotPatch) => void;
  onApplyRecipeToMultiple?: (recipe: ShotRecipe) => void;
  creditRemaining?: number;
  onDeductCredits?: (amount: number) => void;
  isGeneratingKeyframes?: boolean;
  onRenderingChange?: (delta: number) => void;
}

export const ShotInspector: React.FC<ShotInspectorProps> = ({
  shot,
  scene,
  characters,
  config,
  allShots = [],
  hasPrevShot,
  hasNextShot,
  onPrevShot,
  onNextShot,
  onPatchShot,
  creditRemaining = 6000,
  onDeductCredits,
  isGeneratingKeyframes = false,
  onRenderingChange,
}) => {
  const [collapsed, setCollapsed] = useState({
    render: false,
    takes: false,
    action: false,
    camera: false,
    light: false,
    effects: false,
    audio: false,
    prompts: false,
  });

  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('');
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [generatingStart, setGeneratingStart] = useState(false);
  const [generatingEnd, setGeneratingEnd] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [recipeNotice, setRecipeNotice] = useState<string | null>(null);

  // Take rendering & QC state
  const [isRenderingTake, setIsRenderingTake] = useState(false);
  const [takeNotice, setTakeNotice] = useState<string | null>(null);
  const [recheckingQCId, setRecheckingQCId] = useState<string | null>(null);

  // 2-step confirmations
  const [confirmUpdateLock, setConfirmUpdateLock] = useState(false);
  const [confirmDeleteTakeId, setConfirmDeleteTakeId] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }
      if (e.key === 'ArrowLeft' && hasPrevShot) {
        onPrevShot();
      } else if (e.key === 'ArrowRight' && hasNextShot) {
        onNextShot();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasPrevShot, hasNextShot, onPrevShot, onNextShot]);

  const toggleGroup = (key: keyof typeof collapsed) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const look = getLook(config.lookId);
  const videoPromptInfo = compileVideoPrompt(shot, scene, characters, look, config.customStyle);
  const startPrompt = compileKeyframePrompt(shot, scene, characters, 'start', look, config.customStyle, false);
  const endPrompt = compileKeyframePrompt(shot, scene, characters, 'end', look, config.customStyle, true);

  const maxNarrationWords = getMaxNarrationWords(config.durationSeconds);
  const narrationWordCount = countWords(shot.narration);
  const isNarrationTooLong = narrationWordCount > maxNarrationWords;

  // Render & Lock status
  const currentKeyframes = getShotKeyframes(shot, allShots.length > 0 ? allShots : [shot]);
  const effRender = getEffectiveShotRenderConfig(shot, config);
  const isModifiedAfterLock = isShotModifiedAfterLock(shot, scene, characters, config, currentKeyframes);
  const activeTake = getActiveTake(shot);
  const isTakeStale = activeTake ? checkTakeStaleness(activeTake, currentKeyframes) : false;

  const handleCopyText = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      // ignore
    }
  };

  const toggleCharacter = (charId: string) => {
    onPatchShot(shot.id, (s) => {
      const exists = s.characterIds.includes(charId);
      const nextCharIds = exists
        ? s.characterIds.filter((id) => id !== charId)
        : [...s.characterIds, charId];
      return { ...s, characterIds: nextCharIds, userEdited: true };
    });
  };

  const toggleEffect = (effectId: string) => {
    onPatchShot(shot.id, (s) => {
      const current = s.effects || [];
      const exists = current.includes(effectId);
      if (exists) {
        return { ...s, effects: current.filter((id) => id !== effectId), userEdited: true };
      } else {
        if (current.length >= 3) {
          setRecipeNotice('Mỗi shot chỉ chọn tối đa 3 hiệu ứng!');
          setTimeout(() => setRecipeNotice(null), 2500);
          return s;
        }
        return { ...s, effects: [...current, effectId], userEdited: true };
      }
    });
  };

  const handleApplyRecipe = (recipeId: string) => {
    const recipe = SHOT_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return;

    onPatchShot(shot.id, (s) => ({
      ...s,
      shotSize: recipe.shotSize,
      cameraAngle: recipe.cameraAngle,
      cameraMovement: recipe.cameraMovement,
      lens: recipe.lens,
      lighting: recipe.lighting !== undefined ? recipe.lighting : s.lighting,
      effects: [...recipe.effects],
      userEdited: true,
    }));
    setSelectedRecipeId(recipeId);
    setRecipeNotice(`Đã áp công thức: ${recipe.label}`);
    setTimeout(() => setRecipeNotice(null), 2500);
  };

  // 4. Nối cảnh (chain): Tạo lại keyframe đầu/cuối của một shot chain
  // Cập nhật cả slot dùng chung (start của shot sau / end của shot trước),
  // truyền keyframe của shot liền kề làm ảnh tham chiếu khi hasContinuityRef = true.
  // Shot liền kề đã có take thì đánh dấu stale.
  const handleRegenerateFrame = async (type: 'start' | 'end') => {
    setFrameError(null);
    if (type === 'start') setGeneratingStart(true);
    else setGeneratingEnd(true);

    try {
      const charMediaIds = characters
        .filter((c) => shot.characterIds.includes(c.id) && c.mediaId)
        .map((c) => c.mediaId!);

      const refs = [...charMediaIds];
      if (scene?.locationRef?.mediaId && !refs.includes(scene.locationRef.mediaId)) {
        refs.push(scene.locationRef.mediaId);
      }

      const shotIndex = allShots.findIndex((s) => s.id === shot.id);
      const prevShot = shotIndex > 0 ? allShots[shotIndex - 1] : undefined;
      const nextShot = shotIndex < allShots.length - 1 ? allShots[shotIndex + 1] : undefined;

      let promptToUse = type === 'start' ? startPrompt : endPrompt;

      // Nếu tạo startKeyframe và shot này chain với prevShot: kế thừa tham chiếu từ prevShot
      if (type === 'start' && shot.transitionIn === 'chain' && prevShot) {
        if (prevShot.endKeyframe?.mediaId && !refs.includes(prevShot.endKeyframe.mediaId)) {
          refs.push(prevShot.endKeyframe.mediaId);
        }
        promptToUse = compileKeyframePrompt(shot, scene, characters, 'start', look, config.customStyle, true);
      }

      // Nếu tạo endKeyframe: truyền keyframe start của chính shot làm tham chiếu continuity
      if (type === 'end') {
        const startKfMediaId = shot.startKeyframe?.mediaId || (shot.transitionIn === 'chain' ? prevShot?.endKeyframe?.mediaId : undefined);
        if (startKfMediaId && !refs.includes(startKfMediaId)) {
          refs.push(startKfMediaId);
        }
        promptToUse = compileKeyframePrompt(shot, scene, characters, 'end', look, config.customStyle, true);
      }

      const kf: KeyframeInfo = await generateSingleKeyframeWithRetry(promptToUse, config, refs);

      if (type === 'start') {
        // Cập nhật startKeyframe cho shot hiện tại
        onPatchShot(shot.id, (s) => {
          const updatedTakes = (s.takes || []).map((t) =>
            t.id === (s.activeTakeId || s.takes![s.takes!.length - 1].id) ? { ...t, stale: true } : t
          );
          return { ...s, startKeyframe: kf, takes: updatedTakes.length > 0 ? updatedTakes : s.takes };
        });

        // Nếu shot này chain với prevShot: cập nhật luôn endKeyframe của prevShot và đánh dấu stale take của prevShot
        if (shot.transitionIn === 'chain' && prevShot) {
          onPatchShot(prevShot.id, (ps) => {
            const psTakes = (ps.takes || []).map((t) =>
              t.id === (ps.activeTakeId || ps.takes![ps.takes!.length - 1].id) ? { ...t, stale: true } : t
            );
            return {
              ...ps,
              endKeyframe: kf,
              takes: psTakes.length > 0 ? psTakes : ps.takes,
            };
          });
        }
      } else {
        // type === 'end': Cập nhật endKeyframe cho shot hiện tại
        onPatchShot(shot.id, (s) => {
          const updatedTakes = (s.takes || []).map((t) =>
            t.id === (s.activeTakeId || s.takes![s.takes!.length - 1].id) ? { ...t, stale: true } : t
          );
          return { ...s, endKeyframe: kf, takes: updatedTakes.length > 0 ? updatedTakes : s.takes };
        });

        // Nếu shot tiếp theo chain với shot này (nextShot.transitionIn === 'chain'): cập nhật startKeyframe của nextShot và đánh dấu stale take của nextShot
        if (nextShot && nextShot.transitionIn === 'chain') {
          onPatchShot(nextShot.id, (ns) => {
            const nsTakes = (ns.takes || []).map((t) =>
              t.id === (ns.activeTakeId || ns.takes![ns.takes!.length - 1].id) ? { ...t, stale: true } : t
            );
            return {
              ...ns,
              startKeyframe: kf,
              takes: nsTakes.length > 0 ? nsTakes : ns.takes,
            };
          });
        }
      }
    } catch (err: unknown) {
      setFrameError(err instanceof Error ? err.message : 'Sinh keyframe thất bại');
    } finally {
      if (type === 'start') setGeneratingStart(false);
      else setGeneratingEnd(false);
    }
  };

  // Render take mới
  const handleRenderNewTake = async (useLockedInputs: boolean) => {
    if (isRenderingTake || shot.renderStatus === 'rendering') return;
    if (isGeneratingKeyframes) {
      setTakeNotice('Đang trong quá trình sinh keyframe hàng loạt, vui lòng chờ.');
      return;
    }
    if (!currentKeyframes.isReady && !shot.lock) {
      setTakeNotice('Chưa đủ 2 keyframe đầu/cuối để render take mới.');
      return;
    }

    if (effRender.cost > creditRemaining) {
      setTakeNotice(`Không đủ credit! Cần ${effRender.cost} cr, hiện còn ${creditRemaining} cr.`);
      return;
    }

    setIsRenderingTake(true);
    setTakeNotice(null);
    if (onRenderingChange) onRenderingChange(1);

    // Đặt renderStatus 'rendering'
    onPatchShot(shot.id, { renderStatus: 'rendering', renderError: undefined });

    try {
      const { take, lock } = await renderShotTake({
        shot,
        scene,
        characters,
        config,
        currentKeyframes,
        useLock: useLockedInputs,
        enableQC: true,
      });

      if (onDeductCredits) {
        onDeductCredits(take.creditCost);
      }

      onPatchShot(shot.id, (s) => ({
        ...s,
        takes: [...(s.takes || []), take],
        activeTakeId: take.id,
        lock,
        renderStatus: 'done',
        renderError: undefined,
      }));

      setTakeNotice(`Đã render thành công Take #${(shot.takes?.length || 0) + 1}!`);
      setTimeout(() => setTakeNotice(null), 3000);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      onPatchShot(shot.id, { renderStatus: 'error', renderError: errMsg });
      setTakeNotice(`Lỗi render take: ${errMsg}`);
    } finally {
      setIsRenderingTake(false);
      if (onRenderingChange) onRenderingChange(-1);
    }
  };

  // Cập nhật khoá theo nội dung mới (2 bước)
  const handleUpdateLockToCurrent = () => {
    if (confirmUpdateLock) {
      const newLock = {
        prompt: videoPromptInfo.prompt,
        firstFrameMediaId: currentKeyframes.firstFrameMediaId,
        lastFrameMediaId: currentKeyframes.lastFrameMediaId,
        model: effRender.model,
        durationSeconds: effRender.durationSeconds,
        resolution: effRender.resolution,
        lockedAt: Date.now(),
      };
      onPatchShot(shot.id, { lock: newLock });
      setConfirmUpdateLock(false);
      setTakeNotice('Đã cập nhật bản khoá theo nội dung mới!');
      setTimeout(() => setTakeNotice(null), 3000);
    } else {
      setConfirmUpdateLock(true);
      setTimeout(() => setConfirmUpdateLock(false), 3500);
    }
  };

  // Xoá một Take (thu hồi URL)
  const handleDeleteTake = (takeId: string) => {
    if (confirmDeleteTakeId === takeId) {
      const target = (shot.takes || []).find((t) => t.id === takeId);
      if (target?.blobUrl) {
        URL.revokeObjectURL(target.blobUrl);
      }
      onPatchShot(shot.id, (s) => {
        const nextTakes = (s.takes || []).filter((t) => t.id !== takeId);
        const nextActiveId = s.activeTakeId === takeId
          ? (nextTakes[nextTakes.length - 1]?.id || undefined)
          : s.activeTakeId;
        return {
          ...s,
          takes: nextTakes,
          activeTakeId: nextActiveId,
        };
      });
      setConfirmDeleteTakeId(null);
    } else {
      setConfirmDeleteTakeId(takeId);
      setTimeout(() => setConfirmDeleteTakeId((c) => (c === takeId ? null : c)), 3000);
    }
  };

  // Kiểm tra lại QC cho một Take
  const handleRecheckQC = async (take: VideoTake) => {
    setRecheckingQCId(take.id);
    try {
      const qc = await evaluateTakeQC({
        take,
        actionText: shot.action || shot.actionBeat,
        lookLabel: look.label,
        characters: characters.filter((c) => shot.characterIds.includes(c.id)),
        startKeyframe: shot.startKeyframe,
        endKeyframe: shot.endKeyframe,
      });

      onPatchShot(shot.id, (s) => ({
        ...s,
        takes: (s.takes || []).map((t) => (t.id === take.id ? { ...t, qc } : t)),
      }));
    } catch (err: unknown) {
      setTakeNotice(`QC lỗi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRecheckingQCId(null);
    }
  };

  const isRenderDisabled =
    isRenderingTake ||
    shot.renderStatus === 'rendering' ||
    isGeneratingKeyframes ||
    (!currentKeyframes.isReady && !shot.lock) ||
    effRender.cost > creditRemaining;

  const renderDisabledReason =
    shot.renderStatus === 'rendering'
      ? 'Shot này đang được render'
      : isGeneratingKeyframes
      ? 'Đang tạo keyframe hàng loạt'
      : effRender.cost > creditRemaining
      ? `Không đủ credit (cần ${effRender.cost} cr, còn ${creditRemaining} cr)`
      : !currentKeyframes.isReady && !shot.lock
      ? 'Thiếu keyframe đầu/cuối'
      : undefined;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#141417] overflow-y-auto min-h-0 p-4 space-y-4 select-none">
      {/* Top Header & Navigation */}
      <div className="flex items-center justify-between border-b border-[#26262b] pb-2.5 flex-wrap gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-[#f5b301] text-black">
            Shot #{shot.order}
          </span>
          <span className="font-bold text-sm text-[#ececef]">
            {shot.actionBeat || `Shot #${shot.order}`}
          </span>
          {shot.eraLabel && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
              ⏳ {shot.eraLabel}
            </span>
          )}
          {shot.lock && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">lock</span>
              Đã khoá
            </span>
          )}
          {isTakeStale && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/50 flex items-center gap-1 animate-pulse">
              <span className="material-symbols-outlined text-[13px]">warning</span>
              Keyframe đã đổi — clip không còn khớp mạch
            </span>
          )}
        </div>

        {/* Recipe Dropdown & Navigation Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 bg-[#1b1b20] border border-[#26262b] rounded px-1.5 py-0.5 text-xs">
            <span className="material-symbols-outlined text-[13px] text-[#f5b301]">auto_stories</span>
            <select
              value={selectedRecipeId}
              onChange={(e) => {
                if (e.target.value) handleApplyRecipe(e.target.value);
              }}
              className="bg-transparent text-[#ececef] text-[11px] focus:outline-none cursor-pointer"
            >
              <option value="" disabled className="bg-[#1b1b20]">
                Áp công thức cảnh...
              </option>
              {SHOT_RECIPES.map((rcp) => (
                <option key={rcp.id} value={rcp.id} className="bg-[#1b1b20]">
                  {rcp.label}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="secondary"
            size="xs"
            disabled={!hasPrevShot}
            onClick={onPrevShot}
            icon="arrow_back"
          >
            Trước
          </Button>
          <Button
            variant="secondary"
            size="xs"
            disabled={!hasNextShot}
            onClick={onNextShot}
          >
            Sau
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </Button>
        </div>
      </div>

      {recipeNotice && (
        <div className="p-1.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-mono flex items-center gap-1.5 flex-shrink-0 animate-fade-in">
          <span className="material-symbols-outlined text-[14px]">check_circle</span>
          {recipeNotice}
        </div>
      )}

      {takeNotice && (
        <div className="p-2 rounded bg-amber-950/70 border border-amber-500/50 text-amber-300 text-xs font-mono flex items-center gap-1.5 flex-shrink-0">
          <span className="material-symbols-outlined text-[15px]">info</span>
          {takeNotice}
        </div>
      )}

      {/* CẢNH BÁO ĐÃ SỬA SAU KHI KHOÁ & 2 NÚT HÀNH ĐỘNG */}
      {isModifiedAfterLock && (
        <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/60 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-amber-300 font-bold">
            <span className="material-symbols-outlined text-[16px]">edit_notifications</span>
            <span>Đã sửa sau khi khoá</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isRenderDisabled}
              onClick={() => handleRenderNewTake(true)}
              className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-[11px] transition shadow"
              title={renderDisabledReason}
            >
              Quay theo bản khoá
            </button>

            <button
              type="button"
              onClick={handleUpdateLockToCurrent}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition border ${
                confirmUpdateLock
                  ? 'bg-red-600 text-white border-red-500 animate-pulse'
                  : 'bg-[#222] hover:bg-[#333] text-amber-300 border-amber-500/50'
              }`}
            >
              {confirmUpdateLock ? 'Xác nhận cập nhật khoá!' : 'Cập nhật khoá theo nội dung mới'}
            </button>
          </div>
        </div>
      )}

      {/* GROUP 0: CÀI ĐẶT RENDER CHO SHOT (MODEL OVERRIDE) */}
      <div className="bg-[#1b1b20] border border-[#26262b] rounded-lg overflow-hidden flex-shrink-0">
        <button
          type="button"
          onClick={() => toggleGroup('render')}
          className="w-full h-8 px-3 bg-[#18181d] border-b border-[#26262b] flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.06em] text-[#ececef]"
        >
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-[#f5b301]">tune</span>
            Cài đặt Render cho Shot
            {shot.modelOverride && (
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">
                Override: {shot.modelOverride}
              </span>
            )}
          </span>
          <span className="material-symbols-outlined text-[16px] text-[#9a9aa3]">
            {collapsed.render ? 'expand_more' : 'expand_less'}
          </span>
        </button>

        {!collapsed.render && (
          <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <div>
              <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block mb-1">
                Model Video
              </label>
              <select
                value={shot.modelOverride || ''}
                onChange={(e) => {
                  const val = e.target.value as VideoModel | '';
                  onPatchShot(shot.id, { modelOverride: val || undefined });
                }}
                className="w-full bg-[#141417] border border-[#26262b] text-[#ececef] rounded h-7 px-2 text-xs focus:border-[#f5b301] focus:outline-none"
              >
                <option value="">Theo dự án ({config.videoModel})</option>
                <option value="Omni 1.1 Flash">Omni 1.1 Flash</option>
                <option value="Veo 3.1 - Lite">Veo 3.1 - Lite</option>
                <option value="Veo 3.1 - Fast">Veo 3.1 - Fast</option>
                <option value="Veo 3.1 - Quality">Veo 3.1 - Quality</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block mb-1">
                Thời lượng (Duration)
              </label>
              <select
                value={shot.durationOverride || ''}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : undefined;
                  onPatchShot(shot.id, { durationOverride: val });
                }}
                className="w-full bg-[#141417] border border-[#26262b] text-[#ececef] rounded h-7 px-2 text-xs focus:border-[#f5b301] focus:outline-none"
              >
                <option value="">Theo dự án ({config.durationSeconds}s)</option>
                <option value={4}>4s</option>
                <option value={6}>6s</option>
                <option value={8}>8s</option>
                {effRender.model === 'Omni 1.1 Flash' && <option value={10}>10s</option>}
              </select>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block mb-1">
                Độ phân giải
              </label>
              {effRender.model === 'Omni 1.1 Flash' ? (
                <select
                  value={shot.resolutionOverride || ''}
                  onChange={(e) => {
                    const val = e.target.value as VideoResolution | '';
                    onPatchShot(shot.id, { resolutionOverride: val || undefined });
                  }}
                  className="w-full bg-[#141417] border border-[#26262b] text-[#ececef] rounded h-7 px-2 text-xs focus:border-[#f5b301] focus:outline-none"
                >
                  <option value="">Theo dự án ({config.resolution})</option>
                  <option value="720p">720p</option>
                  <option value="360p">360p</option>
                </select>
              ) : (
                <div className="bg-[#141417] border border-[#26262b] text-[#9a9aa3] rounded h-7 px-2 flex items-center justify-between text-xs">
                  <span>720p</span>
                  <span className="text-[10px] font-mono">Cố định Veo</span>
                </div>
              )}
            </div>

            <div className="sm:col-span-3 pt-1 border-t border-[#26262b] flex items-center justify-between font-mono text-[11px] text-slate-400">
              <span>Chi phí tính cho shot này:</span>
              <span className="text-amber-400 font-bold">{effRender.cost} cr/take</span>
            </div>
          </div>
        )}
      </div>

      {/* GROUP TAKES: QUẢN LÝ NHIỀU LẦN QUAY & KHOÁ SHOT */}
      <div className="bg-[#1b1b20] border border-[#26262b] rounded-lg overflow-hidden flex-shrink-0">
        <button
          type="button"
          onClick={() => toggleGroup('takes')}
          className="w-full h-8 px-3 bg-[#18181d] border-b border-[#26262b] flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.06em] text-[#ececef]"
        >
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-[#f5b301]">movie_edit</span>
            Nhiều lần quay (Takes) & Khoá Shot
            <span className="font-mono text-amber-400">({shot.takes?.length || 0} takes)</span>
          </span>
          <span className="material-symbols-outlined text-[16px] text-[#9a9aa3]">
            {collapsed.takes ? 'expand_more' : 'expand_less'}
          </span>
        </button>

        {!collapsed.takes && (
          <div className="p-3 space-y-3 text-xs">
            {/* Thanh nút bấm quay take mới */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isRenderDisabled}
                  onClick={() => handleRenderNewTake(Boolean(shot.lock))}
                  className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold text-xs flex items-center gap-1.5 transition shadow"
                  title={renderDisabledReason}
                >
                  <span className={`material-symbols-outlined text-[15px] ${isRenderingTake ? 'animate-spin' : ''}`}>
                    {isRenderingTake ? 'progress_activity' : 'videocam'}
                  </span>
                  {isRenderingTake
                    ? 'Đang render take mới...'
                    : shot.lock
                    ? `Quay take mới theo bản khoá (${effRender.cost} cr)`
                    : `Quay take đầu tiên & Khoá shot (${effRender.cost} cr)`}
                </button>
                {renderDisabledReason && (
                  <span className="text-[10px] text-amber-400 font-mono">
                    ({renderDisabledReason})
                  </span>
                )}
              </div>

              {shot.lock && (
                <div className="text-[10px] font-mono text-slate-400">
                  Khoá lúc: {new Date(shot.lock.lockedAt).toLocaleTimeString()}
                </div>
              )}
            </div>

            {/* Danh sách các takes */}
            {(!shot.takes || shot.takes.length === 0) ? (
              <div className="p-4 rounded border border-dashed border-[#26262b] text-center text-slate-500 font-mono text-xs">
                Chưa có take nào. Bấm "Quay take" để bắt đầu.
              </div>
            ) : (
              <div className="space-y-2">
                {shot.takes.map((tk, idx) => {
                  const isActive = tk.id === shot.activeTakeId || (!shot.activeTakeId && idx === shot.takes!.length - 1);
                  const isConfirmingDelete = confirmDeleteTakeId === tk.id;
                  const mb = (tk.sizeBytes / (1024 * 1024)).toFixed(1);

                  let qcBadgeClass = 'bg-[#6b6b75]/20 text-slate-400 border-slate-600';
                  let qcLabel = 'Chưa QC';
                  if (tk.qc) {
                    if (tk.qc.totalScore >= 80) {
                      qcBadgeClass = 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50';
                      qcLabel = `OK (${tk.qc.totalScore})`;
                    } else if (tk.qc.totalScore >= 60) {
                      qcBadgeClass = 'bg-amber-950/80 text-amber-300 border-amber-500/50';
                      qcLabel = `Xem lại (${tk.qc.totalScore})`;
                    } else {
                      qcBadgeClass = 'bg-red-950/80 text-red-300 border-red-500/50';
                      qcLabel = `Nên quay lại (${tk.qc.totalScore})`;
                    }
                  }

                  return (
                    <div
                      key={tk.id}
                      className={`p-2.5 rounded-lg border transition space-y-2 ${
                        isActive
                          ? 'bg-[#181822] border-amber-500/60 shadow'
                          : 'bg-[#121215] border-[#26262b]'
                      }`}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onPatchShot(shot.id, { activeTakeId: tk.id })}
                            className={`px-2 py-0.5 rounded font-mono text-xs font-bold transition ${
                              isActive
                                ? 'bg-amber-500 text-black'
                                : 'bg-[#222] text-slate-300 hover:text-white'
                            }`}
                          >
                            Take #{idx + 1} {isActive ? '(Active)' : ''}
                          </button>

                          <span className="font-mono text-[11px] text-slate-400">
                            {tk.model} • {tk.durationSeconds}s • {mb} MB
                          </span>

                          {tk.stale && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              ⚠ Lệch mạch
                            </span>
                          )}
                        </div>

                        {/* QC Badge với hover note & artifacts */}
                        <div className="flex items-center gap-2">
                          {tk.qc && (
                            <div className="relative group">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border cursor-help ${qcBadgeClass}`}
                              >
                                QC: {qcLabel}
                              </span>
                              <div className="absolute right-0 bottom-full mb-1.5 hidden group-hover:block z-30 p-2.5 rounded-lg bg-[#0d0d10] border border-[#26262b] text-[10px] font-mono shadow-2xl w-64 text-slate-300 space-y-1">
                                <div className="text-amber-400 font-bold">Chi tiết kiểm tra:</div>
                                <div>• On-model: {tk.qc.onModel}/100</div>
                                <div>• 2D Style: {tk.qc.style2D}/100</div>
                                <div>• Continuity: {tk.qc.continuity}/100</div>
                                <div>• Action: {tk.qc.action}/100</div>
                                {tk.qc.artifacts.length > 0 && (
                                  <div className="text-red-300">• Lỗi: {tk.qc.artifacts.join(', ')}</div>
                                )}
                                <div className="text-slate-400 italic">"{tk.qc.note}"</div>
                              </div>
                            </div>
                          )}

                          <button
                            type="button"
                            disabled={recheckingQCId === tk.id}
                            onClick={() => handleRecheckQC(tk)}
                            className="p-1 rounded bg-[#222] hover:bg-[#333] text-slate-300 text-[10px] font-mono transition"
                            title="Kiểm tra lại QC (0 credit)"
                          >
                            <span className={`material-symbols-outlined text-[13px] ${recheckingQCId === tk.id ? 'animate-spin' : ''}`}>
                              refresh
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteTake(tk.id)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${
                              isConfirmingDelete
                                ? 'bg-red-600 text-white font-bold animate-pulse'
                                : 'text-slate-500 hover:text-red-400'
                            }`}
                            title="Xoá take này"
                          >
                            {isConfirmingDelete ? 'Click lại để xoá' : 'Xoá'}
                          </button>
                        </div>
                      </div>

                      {/* Video Player */}
                      {tk.blobUrl && (
                        <div className="aspect-video bg-black rounded overflow-hidden relative">
                          <video
                            controls
                            muted
                            preload="metadata"
                            src={tk.blobUrl}
                            className="w-full h-full object-contain"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Keyframe Dual Preview Banner (16:9) */}
      <div className="grid grid-cols-2 gap-3 text-xs flex-shrink-0">
        {/* START FRAME */}
        <div
          className={`aspect-video rounded-lg overflow-hidden relative border transition flex flex-col items-center justify-center p-1.5 ${
            shot.startKeyframe
              ? 'border-[#22c55e]/60 bg-[#0b0b0d]'
              : 'border-dashed border-[#f5b301]/40 bg-[#f5b301]/5'
          }`}
        >
          {shot.startKeyframe ? (
            <>
              <img
                src={`data:image/jpeg;base64,${shot.startKeyframe.thumbBase64}`}
                alt="Start Keyframe"
                className="w-full h-full object-cover rounded"
              />
              <div className="absolute top-1.5 left-1.5 bg-black/75 px-1.5 py-0.5 rounded text-[9px] font-mono text-[#22c55e] border border-[#22c55e]/30">
                START • DONE
              </div>
              <button
                type="button"
                disabled={generatingStart}
                onClick={() => handleRegenerateFrame('start')}
                className="absolute top-1.5 right-1.5 p-1 rounded bg-black/75 hover:bg-black text-[#ececef] hover:text-[#f5b301] transition"
                title="Sinh lại keyframe này"
              >
                <span className={`material-symbols-outlined text-[14px] ${generatingStart ? 'animate-spin' : ''}`}>
                  refresh
                </span>
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-[#f5b301]/90 gap-1">
              <span className="material-symbols-outlined text-[18px]">photo_camera</span>
              <span className="text-[11px] font-mono font-semibold">START FRAME (2D)</span>
              <Button
                variant="amber"
                size="xs"
                loading={generatingStart}
                onClick={() => handleRegenerateFrame('start')}
              >
                Sinh ảnh (0 cr)
              </Button>
            </div>
          )}
        </div>

        {/* END FRAME */}
        <div
          className={`aspect-video rounded-lg overflow-hidden relative border transition flex flex-col items-center justify-center p-1.5 ${
            shot.endKeyframe
              ? 'border-[#22c55e]/60 bg-[#0b0b0d]'
              : 'border-dashed border-[#60a5fa]/40 bg-[#60a5fa]/5'
          }`}
        >
          {shot.endKeyframe ? (
            <>
              <img
                src={`data:image/jpeg;base64,${shot.endKeyframe.thumbBase64}`}
                alt="End Keyframe"
                className="w-full h-full object-cover rounded"
              />
              <div className="absolute top-1.5 left-1.5 bg-black/75 px-1.5 py-0.5 rounded text-[9px] font-mono text-[#22c55e] border border-[#22c55e]/30">
                END • DONE
              </div>
              <button
                type="button"
                disabled={generatingEnd}
                onClick={() => handleRegenerateFrame('end')}
                className="absolute top-1.5 right-1.5 p-1 rounded bg-black/75 hover:bg-black text-[#ececef] hover:text-[#60a5fa] transition"
                title="Sinh lại keyframe này"
              >
                <span className={`material-symbols-outlined text-[14px] ${generatingEnd ? 'animate-spin' : ''}`}>
                  refresh
                </span>
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-[#60a5fa]/90 gap-1">
              <span className="material-symbols-outlined text-[18px]">crop_original</span>
              <span className="text-[11px] font-mono font-semibold">END FRAME (2D)</span>
              <Button
                variant="secondary"
                size="xs"
                loading={generatingEnd}
                onClick={() => handleRegenerateFrame('end')}
                className="text-[#60a5fa] border-[#60a5fa]/40"
              >
                Sinh ảnh (0 cr)
              </Button>
            </div>
          )}
        </div>
      </div>

      {frameError && (
        <div className="p-2 rounded bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#ef4444] text-[11px] font-mono flex-shrink-0">
          {frameError}
        </div>
      )}

      {/* GROUP 1: HÀNH ĐỘNG & NHÂN VẬT 2D */}
      <div className="bg-[#1b1b20] border border-[#26262b] rounded-lg overflow-hidden flex-shrink-0">
        <button
          type="button"
          onClick={() => toggleGroup('action')}
          className="w-full h-8 px-3 bg-[#18181d] border-b border-[#26262b] flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.06em] text-[#ececef]"
        >
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-[#f5b301]">person</span>
            Hành động, Chủ thể & Thời đại
          </span>
          <span className="material-symbols-outlined text-[16px] text-[#9a9aa3]">
            {collapsed.action ? 'expand_more' : 'expand_less'}
          </span>
        </button>

        {!collapsed.action && (
          <div className="p-3 space-y-3 text-xs">
            {/* Characters Vault tag selector */}
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block">
                Nhân vật / Người dẫn chuyện tham gia shot:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {characters.length === 0 ? (
                  <span className="text-[11px] text-[#6b6b75] italic">
                    Chưa có nhân vật trong Vault.
                  </span>
                ) : (
                  characters.map((char) => {
                    const isSelected = shot.characterIds.includes(char.id);
                    return (
                      <Chip
                        key={char.id}
                        active={isSelected}
                        onClick={() => toggleCharacter(char.id)}
                      >
                        {char.name}
                      </Chip>
                    );
                  })
                )}
              </div>
            </div>

            {/* Action beat & Era label */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block">
                  Action Beat (Kịch bản gốc):
                </label>
                <input
                  type="text"
                  value={shot.actionBeat}
                  onChange={(e) => onPatchShot(shot.id, { actionBeat: e.target.value, userEdited: true })}
                  className="w-full bg-[#141417] border border-[#26262b] rounded px-2.5 py-1 text-xs text-[#ececef] focus:border-[#f5b301] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-[0.06em] text-amber-400 font-medium block flex items-center justify-between">
                  <span>Thời đại (eraLabel):</span>
                  <span className="text-[9px] text-slate-500 font-mono">chỉ hiển thị</span>
                </label>
                <input
                  type="text"
                  value={shot.eraLabel || ''}
                  onChange={(e) => onPatchShot(shot.id, { eraLabel: e.target.value, userEdited: true })}
                  placeholder="VD: London, 1890"
                  className="w-full bg-[#141417] border border-[#26262b] rounded px-2.5 py-1 text-xs text-[#ececef] focus:border-[#f5b301] focus:outline-none"
                />
              </div>
            </div>

            {/* Action English (Video prompt) */}
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-[0.06em] text-[#f5b301] font-medium flex justify-between">
                <span>Action English (Dành cho Video 2D Prompt):</span>
                <span className="text-[10px] text-[#9a9aa3] font-mono">Mô tả máy móc/đồ vật cụ thể bằng English</span>
              </label>
              <textarea
                rows={2}
                value={shot.action || ''}
                onChange={(e) => onPatchShot(shot.id, { action: e.target.value, userEdited: true })}
                placeholder="E.g.: A bicycle-powered contraption with giant canvas wings attempts to lift off on a grassy hill"
                className="w-full bg-[#141417] border border-[#26262b] rounded px-2.5 py-1 text-xs text-[#ececef] focus:border-[#f5b301] focus:outline-none"
              />
            </div>

            {/* Start pose & End pose */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block">
                  Start Pose (Tư thế đầu)
                </label>
                <input
                  type="text"
                  value={shot.startPose}
                  onChange={(e) => onPatchShot(shot.id, { startPose: e.target.value, userEdited: true })}
                  placeholder="Seated on the bicycle pedals, gripping wooden handlebar"
                  className="w-full bg-[#141417] border border-[#26262b] rounded px-2 py-1 text-[11px] text-[#ececef] focus:border-[#f5b301] focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block">
                  End Pose (Tư thế cuối)
                </label>
                <input
                  type="text"
                  value={shot.endPose}
                  onChange={(e) => onPatchShot(shot.id, { endPose: e.target.value, userEdited: true })}
                  placeholder="Pedaling furiously as wheels leave the grass momentarily"
                  className="w-full bg-[#141417] border border-[#26262b] rounded px-2 py-1 text-[11px] text-[#ececef] focus:border-[#f5b301] focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* GROUP 2: MÁY QUAY & PHỐI CẢNH 2D */}
      <div className="bg-[#1b1b20] border border-[#26262b] rounded-lg overflow-hidden flex-shrink-0">
        <button
          type="button"
          onClick={() => toggleGroup('camera')}
          className="w-full h-8 px-3 bg-[#18181d] border-b border-[#26262b] flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.06em] text-[#ececef]"
        >
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-[#f5b301]">videocam</span>
            Máy quay & Phối cảnh 2D
          </span>
          <span className="material-symbols-outlined text-[16px] text-[#9a9aa3]">
            {collapsed.camera ? 'expand_more' : 'expand_less'}
          </span>
        </button>

        {!collapsed.camera && (
          <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <Select
              label="Cỡ cảnh (Shot Size)"
              value={shot.shotSize}
              onChange={(e) => onPatchShot(shot.id, { shotSize: e.target.value, userEdited: true })}
            >
              {SHOT_SIZES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </Select>

            <Select
              label="Góc máy (Angle)"
              value={shot.cameraAngle}
              onChange={(e) => onPatchShot(shot.id, { cameraAngle: e.target.value, userEdited: true })}
            >
              {CAMERA_ANGLES.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </Select>

            <Select
              label="Chuyển động (Movement 2D)"
              value={shot.cameraMovement}
              onChange={(e) => onPatchShot(shot.id, { cameraMovement: e.target.value, userEdited: true })}
            >
              {CAMERA_MOVES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </Select>

            <Select
              label="Phối cảnh (Perspective)"
              value={shot.lens}
              onChange={(e) => onPatchShot(shot.id, { lens: e.target.value, userEdited: true })}
            >
              {PERSPECTIVES.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {/* GROUP 3: ÁNH SÁNG & THỜI TIẾT 2D */}
      <div className="bg-[#1b1b20] border border-[#26262b] rounded-lg overflow-hidden flex-shrink-0">
        <button
          type="button"
          onClick={() => toggleGroup('light')}
          className="w-full h-8 px-3 bg-[#18181d] border-b border-[#26262b] flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.06em] text-[#ececef]"
        >
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-[#f5b301]">wb_sunny</span>
            Ánh sáng & Thời tiết (2D)
          </span>
          <span className="material-symbols-outlined text-[16px] text-[#9a9aa3]">
            {collapsed.light ? 'expand_more' : 'expand_less'}
          </span>
        </button>

        {!collapsed.light && (
          <div className="p-3 grid grid-cols-2 gap-2.5 text-xs">
            <Select
              label="Ánh sáng 2D"
              value={shot.lighting || ''}
              onChange={(e) => onPatchShot(shot.id, { lighting: e.target.value, userEdited: true })}
            >
              <option value="">Theo Scene ({scene?.lightingDefault || 'Ban ngày trong trẻo'})</option>
              {LIGHTINGS.map((lt) => (
                <option key={lt.id} value={lt.id}>{lt.label}</option>
              ))}
            </Select>

            <Select
              label="Thời tiết (Weather)"
              value={shot.weather || 'clear'}
              onChange={(e) => onPatchShot(shot.id, { weather: e.target.value, userEdited: true })}
            >
              {WEATHERS.map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {/* GROUP 4: HIỆU ỨNG 2D (TỐI ĐA 3) */}
      <div className="bg-[#1b1b20] border border-[#26262b] rounded-lg overflow-hidden flex-shrink-0">
        <button
          type="button"
          onClick={() => toggleGroup('effects')}
          className="w-full h-8 px-3 bg-[#18181d] border-b border-[#26262b] flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.06em] text-[#ececef]"
        >
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-[#f5b301]">auto_awesome</span>
            Hiệu ứng 2D (chọn {(shot.effects || []).length}/3)
          </span>
          <span className="material-symbols-outlined text-[16px] text-[#9a9aa3]">
            {collapsed.effects ? 'expand_more' : 'expand_less'}
          </span>
        </button>

        {!collapsed.effects && (
          <div className="p-3 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {EFFECTS.map((eff) => {
                const isSelected = (shot.effects || []).includes(eff.id);
                return (
                  <Chip
                    key={eff.id}
                    active={isSelected}
                    onClick={() => toggleEffect(eff.id)}
                  >
                    {eff.label}
                  </Chip>
                );
              })}
            </div>
            <span className="text-[10px] font-mono text-slate-500 block">
              * Giới hạn tối đa 3 hiệu ứng cho mỗi shot để giữ tính nhất quán hoạt hình.
            </span>
          </div>
        )}
      </div>

      {/* GROUP 5: ÂM THANH & LỜI DẪN (NARRATION) */}
      <div className="bg-[#1b1b20] border border-[#26262b] rounded-lg overflow-hidden flex-shrink-0">
        <button
          type="button"
          onClick={() => toggleGroup('audio')}
          className="w-full h-8 px-3 bg-[#18181d] border-b border-[#26262b] flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.06em] text-[#ececef]"
        >
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-[#f5b301]">record_voice_over</span>
            Âm thanh, Lời dẫn (Narration) & Thoại
          </span>
          <span className="material-symbols-outlined text-[16px] text-[#9a9aa3]">
            {collapsed.audio ? 'expand_more' : 'expand_less'}
          </span>
        </button>

        {!collapsed.audio && (
          <div className="p-3 space-y-3 text-xs">
            {/* Ô LỜI DẪN (NARRATION) KÈM BỘ ĐẾM TỪ & CẢNH BÁO */}
            <div className="p-2.5 rounded-lg bg-[#141417] border border-[#26262b] space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] uppercase tracking-[0.06em] text-amber-400 font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">volume_up</span>
                  Lời dẫn (Narration)
                </label>
                <div className="flex items-center gap-1.5 text-[10px] font-mono">
                  <span className={`px-1.5 py-0.2 rounded font-bold ${
                    isNarrationTooLong
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                      : 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                  }`}>
                    {narrationWordCount} / {maxNarrationWords} từ ({config.durationSeconds}s)
                  </span>
                </div>
              </div>

              <textarea
                rows={2}
                value={shot.narration || ''}
                onChange={(e) => onPatchShot(shot.id, { narration: e.target.value, userEdited: true })}
                placeholder="VD: Vào năm 1890, một phát minh kỳ lạ bằng bánh răng hơi nước đã làm rung chuyển cả London..."
                className="w-full bg-[#18181d] border border-[#26262b] rounded px-2.5 py-1.5 text-xs text-[#ececef] focus:border-[#f5b301] focus:outline-none"
              />

              {isNarrationTooLong && (
                <div className="p-1.5 rounded bg-amber-950/70 border border-amber-500/50 text-amber-300 text-[10px] font-mono flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">warning</span>
                  <span>
                    Cảnh báo tốc độ đọc: Shot {config.durationSeconds}s nên ≤ {maxNarrationWords} từ (≈ 2.7 từ/giây). Hiện đang có {narrationWordCount} từ, người dẫn có thể bị hụt hơi.
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block">
                  Lời thoại nhân vật (Dialogue)
                </label>
                <input
                  type="text"
                  value={shot.audioDialogue}
                  onChange={(e) => onPatchShot(shot.id, { audioDialogue: e.target.value, userEdited: true })}
                  placeholder='E.g. "It is going to fly!"'
                  className="w-full bg-[#141417] border border-[#26262b] rounded px-2 py-1 text-xs text-[#ececef] focus:border-[#f5b301] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block">
                  Audio SFX (Tiếng động)
                </label>
                <input
                  type="text"
                  value={shot.audioSfx}
                  onChange={(e) => onPatchShot(shot.id, { audioSfx: e.target.value, userEdited: true })}
                  placeholder="E.g. Steam whoosh, gear ticking"
                  className="w-full bg-[#141417] border border-[#26262b] rounded px-2 py-1 text-xs text-[#ececef] focus:border-[#f5b301] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block">
                  Ambient (Tiếng nền)
                </label>
                <input
                  type="text"
                  value={shot.ambient}
                  onChange={(e) => onPatchShot(shot.id, { ambient: e.target.value, userEdited: true })}
                  placeholder="E.g. Victorian street murmurs, wind"
                  className="w-full bg-[#141417] border border-[#26262b] rounded px-2 py-1 text-xs text-[#ececef] focus:border-[#f5b301] focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* GROUP 6: PROMPT ĐÃ BIÊN DỊCH (2D) */}
      <div className="bg-[#1b1b20] border border-[#26262b] rounded-lg overflow-hidden flex-shrink-0">
        <button
          type="button"
          onClick={() => toggleGroup('prompts')}
          className="w-full h-8 px-3 bg-[#18181d] border-b border-[#26262b] flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.06em] text-[#ececef]"
        >
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-[#f5b301]">code</span>
            Prompt 2D đã biên dịch ({videoPromptInfo.length} ký tự)
          </span>
          <span className="material-symbols-outlined text-[16px] text-[#9a9aa3]">
            {collapsed.prompts ? 'expand_more' : 'expand_less'}
          </span>
        </button>

        {!collapsed.prompts && (
          <div className="p-3 space-y-2 text-[10px] font-mono">
            {videoPromptInfo.isTooLong && (
              <div className="p-1.5 rounded bg-[#f5b301]/10 border border-[#f5b301]/40 text-[#f5b301] flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">warning</span>
                <span>Prompt dài ({videoPromptInfo.length} ký tự), có thể bị cắt bớt bởi model.</span>
              </div>
            )}

            {/* Video Prompt 2D */}
            <div className="p-2 rounded bg-[#141417] border border-[#26262b]">
              <div className="flex justify-between items-center text-[#9a9aa3] mb-1">
                <span className="text-[#22c55e] font-semibold">• Video 2D Animation Prompt (chứa narrator voice-over):</span>
                <button
                  type="button"
                  onClick={() => handleCopyText(videoPromptInfo.prompt, 'video')}
                  className="hover:text-white"
                >
                  {copiedType === 'video' ? '✓ Đã copy' : 'Copy'}
                </button>
              </div>
              <p className="line-clamp-3 text-[#ececef] select-text">{videoPromptInfo.prompt}</p>
            </div>

            {/* Keyframe Start */}
            <div className="p-2 rounded bg-[#141417] border border-[#26262b]">
              <div className="flex justify-between items-center text-[#9a9aa3] mb-1">
                <span className="text-[#f5b301] font-semibold">• Keyframe START 2D Prompt (KHÔNG chứa narration/eraLabel):</span>
                <button
                  type="button"
                  onClick={() => handleCopyText(startPrompt, 'start')}
                  className="hover:text-white"
                >
                  {copiedType === 'start' ? '✓ Đã copy' : 'Copy'}
                </button>
              </div>
              <p className="line-clamp-2 text-[#ececef] select-text">{startPrompt}</p>
            </div>

            {/* Keyframe End */}
            <div className="p-2 rounded bg-[#141417] border border-[#26262b]">
              <div className="flex justify-between items-center text-[#9a9aa3] mb-1">
                <span className="text-[#60a5fa] font-semibold">• Keyframe END 2D Prompt (KHÔNG chứa narration/eraLabel):</span>
                <button
                  type="button"
                  onClick={() => handleCopyText(endPrompt, 'end')}
                  className="hover:text-white"
                >
                  {copiedType === 'end' ? '✓ Đã copy' : 'Copy'}
                </button>
              </div>
              <p className="line-clamp-2 text-[#ececef] select-text">{endPrompt}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
