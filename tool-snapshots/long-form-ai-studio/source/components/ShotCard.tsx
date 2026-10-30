import React, { useState } from 'react';
import {
  Shot,
  Scene,
  Character,
  ProjectConfig,
  KeyframeInfo,
} from '../services/types';
import {
  SHOT_SIZES,
  CAMERA_ANGLES,
  CAMERA_MOVES,
  PERSPECTIVES,
  LIGHTINGS,
  WEATHERS,
  EFFECTS,
  SHOT_RECIPES,
  getLook,
} from '../services/library';
import {
  compileVideoPrompt,
  compileKeyframePrompt,
} from '../services/shotengine';
import { generateSingleKeyframeWithRetry } from '../services/keyframeService';

interface ShotCardProps {
  shot: Shot;
  scene?: Scene;
  characters: Character[];
  config: ProjectConfig;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (updated: Shot) => void;
  onDelete: (shotId: string) => void;
  onMoveUp: (shotId: string) => void;
  onMoveDown: (shotId: string) => void;
}

export const ShotCard: React.FC<ShotCardProps> = ({
  shot,
  scene,
  characters,
  config,
  isFirst,
  isLast,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
}) => {
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [isCharDropdownOpen, setIsCharDropdownOpen] = useState(false);
  const [generatingStart, setGeneratingStart] = useState(false);
  const [generatingEnd, setGeneratingEnd] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState('');

  const look = getLook(config.lookId);
  const videoPromptInfo = compileVideoPrompt(shot, scene, characters, look, config.customStyle);
  const startPrompt = compileKeyframePrompt(shot, scene, characters, 'start', look, config.customStyle, false);
  const endPrompt = compileKeyframePrompt(shot, scene, characters, 'end', look, config.customStyle, true);

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
    const exists = shot.characterIds.includes(charId);
    const nextCharIds = exists
      ? shot.characterIds.filter((id) => id !== charId)
      : [...shot.characterIds, charId];
    onUpdate({ ...shot, characterIds: nextCharIds });
  };

  const toggleEffect = (effectId: string) => {
    const current = shot.effects || [];
    const exists = current.includes(effectId);
    if (exists) {
      onUpdate({ ...shot, effects: current.filter((id) => id !== effectId) });
    } else {
      if (current.length >= 3) return; // giới hạn tối đa 3 effect
      onUpdate({ ...shot, effects: [...current, effectId] });
    }
  };

  const handleApplyRecipe = (recipeId: string) => {
    const recipe = SHOT_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return;
    onUpdate({
      ...shot,
      shotSize: recipe.shotSize,
      cameraAngle: recipe.cameraAngle,
      cameraMovement: recipe.cameraMovement,
      lens: recipe.lens,
      lighting: recipe.lighting !== undefined ? recipe.lighting : shot.lighting,
      effects: [...recipe.effects],
    });
    setSelectedRecipe(recipeId);
  };

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

      const prompt = type === 'start' ? startPrompt : endPrompt;
      const kf: KeyframeInfo = await generateSingleKeyframeWithRetry(prompt, config, refs);

      if (type === 'start') {
        onUpdate({ ...shot, startKeyframe: kf });
      } else {
        onUpdate({ ...shot, endKeyframe: kf });
      }
    } catch (err: unknown) {
      setFrameError(err instanceof Error ? err.message : 'Sinh keyframe thất bại');
    } finally {
      if (type === 'start') setGeneratingStart(false);
      else setGeneratingEnd(false);
    }
  };

  return (
    <div className="bg-[#121212] border border-[#595959]/50 hover:border-slate-400/50 rounded-lg p-3 space-y-3 transition shadow-sm">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between border-b border-[#595959]/30 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-amber-500 text-black">
            #{shot.order}
          </span>
          <span className="text-xs font-semibold text-slate-200">
            Shot {shot.order} (2D)
          </span>
          {scene && (
            <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
              ({scene.title})
            </span>
          )}

          {/* Quick Recipe selector */}
          <div className="flex items-center gap-1 bg-[#1c1c1c] border border-[#595959]/40 rounded px-1.5 py-0.5 text-[10px]">
            <span className="text-amber-400">Công thức:</span>
            <select
              value={selectedRecipe}
              onChange={(e) => handleApplyRecipe(e.target.value)}
              className="bg-transparent text-slate-300 focus:outline-none cursor-pointer"
            >
              <option value="" disabled className="bg-[#1c1c1c]">Chọn...</option>
              {SHOT_RECIPES.map((r) => (
                <option key={r.id} value={r.id} className="bg-[#1c1c1c]">{r.label}</option>
              ))}
            </select>
          </div>

          {/* Ranh giới chuyển cảnh transitionIn */}
          {!isFirst && (
            <div className="flex items-center gap-1 text-[10px] font-mono">
              <span className="text-slate-500">Nối:</span>
              <button
                type="button"
                onClick={() =>
                  onUpdate({
                    ...shot,
                    transitionIn: shot.transitionIn === 'chain' ? 'cut' : 'chain',
                  })
                }
                className={`px-1.5 py-0.5 rounded border transition flex items-center gap-1 ${
                  shot.transitionIn === 'chain'
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50'
                    : 'bg-indigo-950/80 text-indigo-300 border-indigo-500/50'
                }`}
                title="Bấm để đổi cách nối với shot trước (Liền mạch hoặc Cắt cảnh)"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    shot.transitionIn === 'chain' ? 'bg-emerald-400' : 'bg-indigo-400'
                  }`}
                />
                {shot.transitionIn === 'chain' ? 'Liền mạch (chain)' : 'Cắt cảnh (cut)'}
              </button>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 text-slate-400">
          <button
            type="button"
            disabled={isFirst}
            onClick={() => onMoveUp(shot.id)}
            className="p-1 rounded hover:bg-[#222] hover:text-white disabled:opacity-30 transition"
            title="Di chuyển lên"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
          </button>
          <button
            type="button"
            disabled={isLast}
            onClick={() => onMoveDown(shot.id)}
            className="p-1 rounded hover:bg-[#222] hover:text-white disabled:opacity-30 transition"
            title="Di chuyển xuống"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
          </button>
          <button
            type="button"
            onClick={() => onDelete(shot.id)}
            className="p-1 rounded hover:bg-red-950/60 hover:text-red-400 text-slate-500 transition ml-1"
            title="Xoá shot này"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </div>

      {/* Frame Preview: START & END frames */}
      <div className="grid grid-cols-2 gap-2 text-center text-xs">
        {/* START FRAME */}
        <div
          className={`h-24 rounded overflow-hidden relative border transition flex flex-col items-center justify-center p-1 ${
            shot.startKeyframe
              ? 'border-emerald-500 bg-[#0a0a0a]'
              : 'border-dashed border-amber-500/40 bg-amber-500/5'
          }`}
        >
          {shot.startKeyframe ? (
            <>
              <img
                src={`data:image/jpeg;base64,${shot.startKeyframe.thumbBase64}`}
                alt="Start Keyframe"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
              <div className="absolute top-1 left-1 bg-black/70 px-1 py-0.2 rounded text-[8px] font-mono text-emerald-300 border border-emerald-500/40">
                START • 2D
              </div>
              <button
                type="button"
                disabled={generatingStart}
                onClick={() => handleRegenerateFrame('start')}
                className="absolute top-1 right-1 p-1 rounded bg-black/70 hover:bg-black text-white hover:text-amber-300 transition"
                title="Sinh lại keyframe này"
              >
                <span className={`material-symbols-outlined text-[14px] ${generatingStart ? 'animate-spin' : ''}`}>
                  refresh
                </span>
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-amber-300/80 w-full h-full">
              <div className="flex items-center gap-1 text-[11px] font-mono font-semibold">
                <span className="material-symbols-outlined text-[15px]">
                  {generatingStart ? 'sync' : 'photo_camera'}
                </span>
                START (2D)
              </div>
              <button
                type="button"
                disabled={generatingStart}
                onClick={() => handleRegenerateFrame('start')}
                className="mt-1 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-[9px] flex items-center gap-0.5 transition"
              >
                <span className={`material-symbols-outlined text-[11px] ${generatingStart ? 'animate-spin' : ''}`}>
                  refresh
                </span>
                {generatingStart ? 'Đang tạo...' : 'Sinh ảnh (0 cr)'}
              </button>
            </div>
          )}
        </div>

        {/* END FRAME */}
        <div
          className={`h-24 rounded overflow-hidden relative border transition flex flex-col items-center justify-center p-1 ${
            shot.endKeyframe
              ? 'border-emerald-500 bg-[#0a0a0a]'
              : 'border-dashed border-cyan-500/40 bg-cyan-500/5'
          }`}
        >
          {shot.endKeyframe ? (
            <>
              <img
                src={`data:image/jpeg;base64,${shot.endKeyframe.thumbBase64}`}
                alt="End Keyframe"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
              <div className="absolute top-1 left-1 bg-black/70 px-1 py-0.2 rounded text-[8px] font-mono text-emerald-300 border border-emerald-500/40">
                END • 2D
              </div>
              <button
                type="button"
                disabled={generatingEnd}
                onClick={() => handleRegenerateFrame('end')}
                className="absolute top-1 right-1 p-1 rounded bg-black/70 hover:bg-black text-white hover:text-cyan-300 transition"
                title="Sinh lại keyframe này"
              >
                <span className={`material-symbols-outlined text-[14px] ${generatingEnd ? 'animate-spin' : ''}`}>
                  refresh
                </span>
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-cyan-300/80 w-full h-full">
              <div className="flex items-center gap-1 text-[11px] font-mono font-semibold">
                <span className="material-symbols-outlined text-[15px]">
                  {generatingEnd ? 'sync' : 'crop_original'}
                </span>
                END (2D)
              </div>
              <button
                type="button"
                disabled={generatingEnd}
                onClick={() => handleRegenerateFrame('end')}
                className="mt-1 px-2 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 text-[9px] flex items-center gap-0.5 transition"
              >
                <span className={`material-symbols-outlined text-[11px] ${generatingEnd ? 'animate-spin' : ''}`}>
                  refresh
                </span>
                {generatingEnd ? 'Đang tạo...' : 'Sinh ảnh (0 cr)'}
              </button>
            </div>
          )}
        </div>
      </div>

      {frameError && (
        <div className="p-1.5 rounded bg-red-950/60 border border-red-500/40 text-red-300 text-[10px] font-mono">
          {frameError}
        </div>
      )}

      {/* Character Selector Dropdown / Badges */}
      <div className="space-y-1 relative">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400 flex items-center gap-1 font-mono">
            <span className="material-symbols-outlined text-[13px] text-amber-400">face</span>
            @Character(s) 2D
          </span>
          <button
            type="button"
            onClick={() => setIsCharDropdownOpen(!isCharDropdownOpen)}
            className="text-[10px] text-amber-300 hover:underline flex items-center gap-0.5"
          >
            <span>{isCharDropdownOpen ? 'Đóng menu' : '+ Gắn nhân vật'}</span>
            <span className="material-symbols-outlined text-[12px]">expand_more</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1 min-h-[22px]">
          {shot.characterIds.length === 0 ? (
            <span className="text-[10px] text-slate-500 italic">
              Chưa gắn nhân vật (Shot phong cảnh 2D)
            </span>
          ) : (
            shot.characterIds.map((cId) => {
              const char = characters.find((c) => c.id === cId);
              if (!char) return null;
              return (
                <span
                  key={cId}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  {char.name}
                  <button
                    type="button"
                    onClick={() => toggleCharacter(cId)}
                    className="hover:text-white"
                  >
                    <span className="material-symbols-outlined text-[11px]">close</span>
                  </button>
                </span>
              );
            })
          )}
        </div>

        {isCharDropdownOpen && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-[#595959] rounded-lg p-2 shadow-xl space-y-1 text-xs">
            <span className="text-[10px] uppercase text-slate-400 font-mono block mb-1">
              Chọn từ Character Vault 2D:
            </span>
            {characters.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic">
                Vault đang trống. Tạo nhân vật ở cột trái trước.
              </p>
            ) : (
              characters.map((char) => {
                const isSelected = shot.characterIds.includes(char.id);
                return (
                  <button
                    key={char.id}
                    type="button"
                    onClick={() => toggleCharacter(char.id)}
                    className={`w-full text-left px-2 py-1 rounded flex items-center justify-between text-xs transition ${
                      isSelected
                        ? 'bg-amber-500/20 text-amber-300 font-medium'
                        : 'hover:bg-[#252525] text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                      {char.name}
                    </span>
                    <span className="material-symbols-outlined text-[14px]">
                      {isSelected ? 'check_box' : 'check_box_outline_blank'}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Action Beat & Action English */}
      <div className="space-y-1.5">
        <div>
          <label className="text-[10px] uppercase font-mono text-slate-400 flex items-center justify-between">
            <span>Action Beat (Kịch bản gốc)</span>
          </label>
          <input
            type="text"
            value={shot.actionBeat}
            onChange={(e) => onUpdate({ ...shot, actionBeat: e.target.value })}
            placeholder="VD: Mira quay đầu lại, gió thổi tóc bay nhẹ dưới tán cây"
            className="w-full bg-[#181818] border border-[#595959]/50 rounded px-2.5 py-1 text-white text-xs focus:border-amber-400 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase font-mono text-amber-400/90 flex items-center justify-between">
            <span>Action English (Dùng cho Video 2D Prompt)</span>
            <span className="text-[9px] text-slate-500">Anime motion</span>
          </label>
          <textarea
            rows={1}
            value={shot.action || ''}
            onChange={(e) => onUpdate({ ...shot, action: e.target.value })}
            placeholder="E.g.: Character turns around with fluttering hair as petals drift past"
            className="w-full bg-[#181818] border border-[#595959]/50 rounded px-2.5 py-1 text-white text-xs focus:border-amber-400 focus:outline-none font-sans"
          />
        </div>
      </div>

      {/* Start Pose & End Pose Continuity fields */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 block font-mono">
            Start Pose (Tư thế đầu)
          </label>
          <input
            type="text"
            value={shot.startPose}
            onChange={(e) => onUpdate({ ...shot, startPose: e.target.value })}
            placeholder="Standing still, profile view"
            className="w-full bg-[#181818] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px] focus:border-amber-400 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 block font-mono">
            End Pose (Tư thế cuối)
          </label>
          <input
            type="text"
            value={shot.endPose}
            onChange={(e) => onUpdate({ ...shot, endPose: e.target.value })}
            placeholder="Looking up toward the sky"
            className="w-full bg-[#181818] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px] focus:border-amber-400 focus:outline-none"
          />
        </div>
      </div>

      {/* 6 Cinema Dropdowns 2D */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div className="space-y-0.5">
          <label className="text-[9px] text-slate-400 block">Shot Size (Cỡ cảnh)</label>
          <select
            value={shot.shotSize}
            onChange={(e) => onUpdate({ ...shot, shotSize: e.target.value })}
            className="w-full bg-[#1c1c1c] border border-[#595959]/50 text-white rounded px-1.5 py-1 text-[11px] focus:border-amber-400 focus:outline-none"
          >
            {SHOT_SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-0.5">
          <label className="text-[9px] text-slate-400 block">Góc máy (Angle)</label>
          <select
            value={shot.cameraAngle}
            onChange={(e) => onUpdate({ ...shot, cameraAngle: e.target.value })}
            className="w-full bg-[#1c1c1c] border border-[#595959]/50 text-white rounded px-1.5 py-1 text-[11px] focus:border-amber-400 focus:outline-none"
          >
            {CAMERA_ANGLES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-0.5">
          <label className="text-[9px] text-slate-400 block">Chuyển động (Movement 2D)</label>
          <select
            value={shot.cameraMovement}
            onChange={(e) => onUpdate({ ...shot, cameraMovement: e.target.value })}
            className="w-full bg-[#1c1c1c] border border-[#595959]/50 text-white rounded px-1.5 py-1 text-[11px] focus:border-amber-400 focus:outline-none"
          >
            {CAMERA_MOVES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-0.5">
          <label className="text-[9px] text-slate-400 block">Phối cảnh (Perspective)</label>
          <select
            value={shot.lens}
            onChange={(e) => onUpdate({ ...shot, lens: e.target.value })}
            className="w-full bg-[#1c1c1c] border border-[#595959]/50 text-white rounded px-1.5 py-1 text-[11px] focus:border-amber-400 focus:outline-none"
          >
            {PERSPECTIVES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-0.5">
          <label className="text-[9px] text-slate-400 block">Ánh sáng 2D</label>
          <select
            value={shot.lighting || ''}
            onChange={(e) => onUpdate({ ...shot, lighting: e.target.value })}
            className="w-full bg-[#1c1c1c] border border-[#595959]/50 text-white rounded px-1.5 py-1 text-[11px] focus:border-amber-400 focus:outline-none"
          >
            <option value="">Theo Scene ({scene?.lightingDefault || 'Ban ngày trong trẻo'})</option>
            {LIGHTINGS.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-0.5">
          <label className="text-[9px] text-slate-400 block">Thời tiết (Weather)</label>
          <select
            value={shot.weather || 'clear'}
            onChange={(e) => onUpdate({ ...shot, weather: e.target.value })}
            className="w-full bg-[#1c1c1c] border border-[#595959]/50 text-white rounded px-1.5 py-1 text-[11px] focus:border-amber-400 focus:outline-none"
          >
            {WEATHERS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Hiệu ứng 2D (Tối đa 3 effect) */}
      <div className="space-y-1">
        <label className="text-[10px] text-slate-400 font-mono flex items-center justify-between">
          <span>Hiệu ứng hoạt hình 2D (chọn {(shot.effects || []).length}/3):</span>
          <span className="text-[9px] text-amber-400/80">Tối đa 3</span>
        </label>
        <div className="flex flex-wrap gap-1">
          {EFFECTS.map((eff) => {
            const isSelected = (shot.effects || []).includes(eff.id);
            return (
              <button
                key={eff.id}
                type="button"
                onClick={() => toggleEffect(eff.id)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition border ${
                  isSelected
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                    : 'bg-[#181818] text-slate-400 border-[#595959]/30 hover:border-slate-500'
                }`}
              >
                {eff.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Audio SFX, Dialogue & Ambient */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="space-y-0.5">
          <label className="text-[9px] text-slate-400 block">Audio SFX</label>
          <input
            type="text"
            value={shot.audioSfx}
            onChange={(e) => onUpdate({ ...shot, audioSfx: e.target.value })}
            placeholder="E.g. Anime swoosh"
            className="w-full bg-[#1c1c1c] border border-[#595959]/50 text-white rounded px-2 py-1 text-[11px] focus:border-amber-400 focus:outline-none"
          />
        </div>

        <div className="space-y-0.5">
          <label className="text-[9px] text-slate-400 block">Dialogue (Lời thoại)</label>
          <input
            type="text"
            value={shot.audioDialogue}
            onChange={(e) => onUpdate({ ...shot, audioDialogue: e.target.value })}
            placeholder='E.g. "We must go."'
            className="w-full bg-[#181818] border border-[#595959]/50 text-white rounded px-2 py-1 text-[11px] focus:border-amber-400 focus:outline-none"
          />
        </div>

        <div className="space-y-0.5">
          <label className="text-[9px] text-slate-400 block">Ambient Audio</label>
          <input
            type="text"
            value={shot.ambient}
            onChange={(e) => onUpdate({ ...shot, ambient: e.target.value })}
            placeholder="E.g. Summer cicadas"
            className="w-full bg-[#181818] border border-[#595959]/50 text-white rounded px-2 py-1 text-[11px] focus:border-amber-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Compiled Prompts Preview: Keyframes & Video */}
      <div className="bg-[#0b0b0b] rounded p-2.5 border border-[#595959]/40 space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono text-amber-400 flex items-center gap-1 font-semibold">
            <span className="material-symbols-outlined text-[13px]">code</span>
            Compiled 2D Prompts:
          </span>
          <span className="text-[10px] font-mono text-slate-400">
            Look: {look.label}
          </span>
        </div>

        {videoPromptInfo.isTooLong && (
          <div className="p-1.5 rounded bg-amber-950/70 border border-amber-500/50 text-amber-300 text-[10px] font-mono flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px]">warning</span>
            <span>Prompt dài ({videoPromptInfo.length} ký tự), có thể bị cắt bớt bởi model.</span>
          </div>
        )}

        <div className="space-y-1.5 text-[10px] font-mono">
          <div className="p-1.5 rounded bg-[#141414] border border-[#595959]/30">
            <div className="flex justify-between items-center text-slate-400 mb-0.5">
              <span className="text-amber-300 font-semibold">• Keyframe START (2D):</span>
              <button
                type="button"
                onClick={() => handleCopyText(startPrompt, 'start')}
                className="hover:text-white"
              >
                {copiedType === 'start' ? '✓ Đã copy' : 'Copy'}
              </button>
            </div>
            <p className="line-clamp-2 text-slate-300 select-text">{startPrompt}</p>
          </div>

          <div className="p-1.5 rounded bg-[#141414] border border-[#595959]/30">
            <div className="flex justify-between items-center text-slate-400 mb-0.5">
              <span className="text-cyan-300 font-semibold">• Keyframe END (2D):</span>
              <button
                type="button"
                onClick={() => handleCopyText(endPrompt, 'end')}
                className="hover:text-white"
              >
                {copiedType === 'end' ? '✓ Đã copy' : 'Copy'}
              </button>
            </div>
            <p className="line-clamp-2 text-slate-300 select-text">{endPrompt}</p>
          </div>

          <div className="p-1.5 rounded bg-[#141414] border border-[#595959]/30">
            <div className="flex justify-between items-center text-slate-400 mb-0.5">
              <span className="text-emerald-300 font-semibold">• Video 2D Prompt ({videoPromptInfo.length} ký tự):</span>
              <button
                type="button"
                onClick={() => handleCopyText(videoPromptInfo.prompt, 'video')}
                className="hover:text-white"
              >
                {copiedType === 'video' ? '✓ Đã copy' : 'Copy'}
              </button>
            </div>
            <p className="line-clamp-3 text-slate-300 select-text">{videoPromptInfo.prompt}</p>
          </div>
        </div>
      </div>

      {/* Video Status Chip */}
      <div className="flex items-center justify-between pt-1 border-t border-[#595959]/20 text-[10px] font-mono">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[13px] text-slate-400">videocam</span>
          <span className="text-slate-400">Trạng thái video 2D:</span>
        </div>

        {shot.video ? (
          <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            video: done ({shot.video.creditCost} cr)
          </span>
        ) : shot.renderStatus === 'rendering' ? (
          <span className="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/40 flex items-center gap-1 animate-pulse font-semibold">
            <span className="material-symbols-outlined text-[11px] animate-spin">progress_activity</span>
            video: đang render...
          </span>
        ) : shot.renderStatus === 'error' ? (
          <span
            className="px-2 py-0.5 rounded bg-red-950/80 text-red-300 border border-red-500/40 flex items-center gap-1 font-semibold truncate max-w-[200px]"
            title={shot.renderError || 'Lỗi render'}
          >
            <span className="material-symbols-outlined text-[11px]">error</span>
            video: error
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded bg-[#1c1c1c] text-slate-400 border border-[#595959]/30">
            video: chưa render
          </span>
        )}
      </div>
    </div>
  );
};
