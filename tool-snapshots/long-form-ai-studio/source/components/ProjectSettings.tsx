import React from 'react';
import { ProjectConfig, VideoModel, ImageModel, VideoResolution, ProjectMode } from '../services/types';
import { LOOKS } from '../services/library';

interface ProjectSettingsProps {
  config: ProjectConfig;
  onChange: (updated: ProjectConfig) => void;
}

export const ProjectSettings: React.FC<ProjectSettingsProps> = ({ config, onChange }) => {
  const handleModeChange = (mode: ProjectMode) => {
    if (mode === 'long') {
      onChange({
        ...config,
        mode: 'long',
        aspectRatio: '16:9',
        targetShots: 35,
      });
    } else {
      onChange({
        ...config,
        mode: 'short',
        aspectRatio: '9:16',
        targetShots: 6,
      });
    }
  };

  const handleModelChange = (model: VideoModel) => {
    const isVeo = model.startsWith('Veo');
    let nextRes: VideoResolution = config.resolution;
    let nextDuration = config.durationSeconds;

    if (isVeo) {
      nextRes = '720p';
      if (nextDuration === 10) {
        nextDuration = 8;
      }
    }

    onChange({
      ...config,
      videoModel: model,
      resolution: nextRes,
      durationSeconds: nextDuration,
    });
  };

  const isOmni = config.videoModel === 'Omni 1.1 Flash';

  const group2D = LOOKS.filter((l) => l.group === '2D');
  const groupStylized = LOOKS.filter((l) => l.group === 'Stylized');

  return (
    <div className="p-3 bg-[#141414] border-b border-[#595959]/50 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Cài đặt dự án Hoạt Hình 2D
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
          {config.aspectRatio}
        </span>
      </div>

      {/* Mode Switcher */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#0a0a0a] rounded border border-[#595959]/40 text-xs">
        <button
          type="button"
          onClick={() => handleModeChange('long')}
          className={`py-1.5 px-2 rounded font-medium transition flex items-center justify-center gap-1.5 ${
            config.mode === 'long'
              ? 'bg-[#2b2b2b] text-white shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-[15px]">movie</span>
          Long (16:9)
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('short')}
          className={`py-1.5 px-2 rounded font-medium transition flex items-center justify-center gap-1.5 ${
            config.mode === 'short'
              ? 'bg-[#2b2b2b] text-white shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-[15px]">stay_current_portrait</span>
          Short (9:16)
        </button>
      </div>

      {/* Look & Style Selector */}
      <div className="space-y-1.5 bg-[#0e0e0e] p-2 rounded border border-[#595959]/40">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold text-amber-400/90 flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px]">palette</span>
            Look / Phong cách hoạt hình 2D
          </label>
          <span className="text-[9px] font-mono text-slate-500">19 phong cách</span>
        </div>
        <select
          value={config.lookId || 'anime_cel'}
          onChange={(e) => onChange({ ...config, lookId: e.target.value })}
          className="w-full bg-[#1c1c1c] border border-[#595959]/60 text-white rounded px-2 py-1 text-xs focus:border-amber-400 focus:outline-none"
        >
          <optgroup label="2D Animation">
            {group2D.map((lk) => (
              <option key={lk.id} value={lk.id}>
                {lk.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Stylized Animation">
            {groupStylized.map((lk) => (
              <option key={lk.id} value={lk.id}>
                {lk.label}
              </option>
            ))}
          </optgroup>
        </select>
        <input
          type="text"
          value={config.customStyle || ''}
          onChange={(e) => onChange({ ...config, customStyle: e.target.value })}
          placeholder="Style tùy chỉnh (VD: soft watercolor wash, thick ink outlines...)"
          className="w-full bg-[#181818] border border-[#595959]/40 text-slate-200 rounded px-2 py-0.5 text-[11px] placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
        />
      </div>

      {/* Target Shots Slider */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-slate-300">
          <span>Số shot mục tiêu:</span>
          <span className="font-mono text-amber-400 font-bold">
            {config.targetShots} shots ({config.targetShots * config.durationSeconds}s)
          </span>
        </div>
        <input
          type="range"
          min={config.mode === 'long' ? 20 : 4}
          max={config.mode === 'long' ? 40 : 10}
          value={config.targetShots}
          onChange={(e) => onChange({ ...config, targetShots: Number(e.target.value) })}
          className="w-full accent-amber-500 bg-[#2b2b2b] h-1.5 rounded cursor-pointer"
        />
      </div>

      {/* Video Model Dropdown */}
      <div className="space-y-1">
        <label className="text-[11px] text-slate-400 block">Video Model</label>
        <select
          value={config.videoModel}
          onChange={(e) => handleModelChange(e.target.value as VideoModel)}
          className="w-full bg-[#1e1e1e] border border-[#595959]/60 text-white rounded px-2.5 py-1.5 text-xs focus:border-amber-400 focus:outline-none"
        >
          <option value="Omni 1.1 Flash">Omni 1.1 Flash (Mặc định)</option>
          <option value="Veo 3.1 - Lite">Veo 3.1 - Lite</option>
          <option value="Veo 3.1 - Fast">Veo 3.1 - Fast</option>
          <option value="Veo 3.1 - Quality">Veo 3.1 - Quality</option>
        </select>
      </div>

      {/* Resolution & Duration */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] text-slate-400 block">Resolution</label>
          {isOmni ? (
            <select
              value={config.resolution}
              onChange={(e) => onChange({ ...config, resolution: e.target.value as VideoResolution })}
              className="w-full bg-[#1e1e1e] border border-[#595959]/60 text-white rounded px-2.5 py-1.5 text-xs focus:border-amber-400 focus:outline-none"
            >
              <option value="720p">720p</option>
              <option value="360p">360p (nháp)</option>
            </select>
          ) : (
            <div className="bg-[#1a1a1a] border border-[#595959]/30 text-slate-400 rounded px-2 py-1.5 text-xs flex items-center justify-between">
              <span>720p</span>
              <span className="text-[10px] text-slate-500 font-mono">Cố định</span>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-[11px] text-slate-400 block">Duration (giây)</label>
          <select
            value={config.durationSeconds}
            onChange={(e) => onChange({ ...config, durationSeconds: Number(e.target.value) })}
            className="w-full bg-[#1e1e1e] border border-[#595959]/60 text-white rounded px-2.5 py-1.5 text-xs focus:border-amber-400 focus:outline-none"
          >
            <option value={4}>4s</option>
            <option value={6}>6s</option>
            <option value={8}>8s (chuẩn)</option>
            {isOmni && <option value={10}>10s</option>}
          </select>
        </div>
      </div>

      {/* Image Model for Keyframes */}
      <div className="space-y-1 pt-1 border-t border-[#595959]/30">
        <label className="text-[11px] text-slate-400 block flex items-center justify-between">
          <span>Image Model (Keyframes 2D)</span>
          <span className="text-[9px] text-emerald-400 font-mono">0 credit</span>
        </label>
        <select
          value={config.imageModel}
          onChange={(e) => onChange({ ...config, imageModel: e.target.value as ImageModel })}
          className="w-full bg-[#1e1e1e] border border-[#595959]/60 text-white rounded px-2.5 py-1.5 text-xs focus:border-amber-400 focus:outline-none"
        >
          <option value="🍌 Nano Banana 2.1">🍌 Nano Banana 2.1 (Mặc định)</option>
          <option value="🍌 Nano Banana Pro">🍌 Nano Banana Pro</option>
        </select>
      </div>
    </div>
  );
};
