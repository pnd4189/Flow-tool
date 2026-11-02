import React from 'react';
import {
  CharacterConfig,
  AspectRatioOption,
  BackgroundType,
  CharacterPose,
  Language,
} from '../types';
import { t } from '../services/i18n';
import {
  SHEET_LAYOUTS,
  ASPECT_RATIOS,
  BACKGROUND_OPTIONS,
  POSE_OPTIONS,
} from '../constants';

interface SectionFramingProps {
  config: CharacterConfig;
  lang: Language;
  onChange: (patch: Partial<CharacterConfig>) => void;
}

export const SectionFraming: React.FC<SectionFramingProps> = ({ config, lang, onChange }) => {
  const handleRetriesChange = (delta: number) => {
    const next = Math.max(0, Math.min(2, (config.qcMaxRetries ?? 1) + delta));
    onChange({ qcMaxRetries: next });
  };

  const handleCandidatesChange = (delta: number) => {
    const next = Math.max(1, Math.min(4, (config.qcCandidates ?? 1) + delta));
    onChange({ qcCandidates: next });
  };

  return (
    <div className="space-y-4 text-xs text-[#e6e9ef]">
      {/* Layout Tiles A - F */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-2">
          {t(lang, 'lbl_layout_template')}
        </label>
        <div className="space-y-2">
          {SHEET_LAYOUTS.map((layout) => {
            const active = config.layoutId === layout.id;
            return (
              <button
                key={layout.id}
                type="button"
                onClick={() => onChange({ layoutId: layout.id })}
                className={`w-full p-2.5 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                  active
                    ? 'bg-[#7c9cff]/10 border-[#7c9cff] ring-1 ring-[#7c9cff]'
                    : 'bg-[#0e1014] border-[#262c36] hover:border-[#8b93a1]/40'
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs shrink-0 ${
                    active
                      ? 'bg-[#7c9cff] text-[#0e1014]'
                      : 'bg-[#161a21] text-[#7c9cff] border border-[#262c36]'
                  }`}
                >
                  {layout.tag}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4
                      className={`text-xs font-bold leading-tight ${
                        active ? 'text-[#7c9cff]' : 'text-[#e6e9ef]'
                      }`}
                    >
                      {t(lang, layout.labelKey)}
                    </h4>
                  </div>
                  <p className="text-[10px] text-[#8b93a1] mt-0.5 leading-snug">
                    {t(lang, layout.descKey)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Aspect Ratio */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1.5">
          {t(lang, 'lbl_aspect_ratio')}
        </label>
        <div className="grid grid-cols-5 gap-1 bg-[#0e1014] p-1 rounded-xl border border-[#262c36]">
          {ASPECT_RATIOS.map((ratio) => {
            const active = config.aspectRatio === ratio;
            return (
              <button
                key={ratio}
                type="button"
                onClick={() => onChange({ aspectRatio: ratio })}
                className={`py-1.5 text-xs font-semibold rounded-lg font-mono transition-all ${
                  active
                    ? 'bg-[#7c9cff] text-[#0e1014] shadow-sm'
                    : 'text-[#8b93a1] hover:text-[#e6e9ef]'
                }`}
              >
                {ratio}
              </button>
            );
          })}
        </div>
      </div>

      {/* Background & Pose 2-column */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
            {t(lang, 'lbl_background')}
          </label>
          <select
            value={config.background}
            onChange={(e) => onChange({ background: e.target.value as BackgroundType })}
            className="w-full px-2.5 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
          >
            {BACKGROUND_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(lang, opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
            {t(lang, 'lbl_pose')}
          </label>
          <select
            value={config.pose}
            onChange={(e) => onChange({ pose: e.target.value as CharacterPose })}
            className="w-full px-2.5 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
          >
            {POSE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(lang, opt.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Extra Director Notes */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_extra_notes')}
        </label>
        <textarea
          rows={2}
          value={config.extraNotes}
          onChange={(e) => onChange({ extraNotes: e.target.value })}
          className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none resize-none placeholder-[#8b93a1]/40"
          placeholder={t(lang, 'placeholder_extra_notes')}
        />
      </div>

      {/* QC & Automatic Retry Controls */}
      <div className="pt-2 border-t border-[#262c36] space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex flex-col pr-2">
            <span className="text-[11px] font-semibold text-[#e6e9ef]">
              {t(lang, 'lbl_qc_switch')}
            </span>
            <span className="text-[10px] text-[#8b93a1] leading-tight">
              {t(lang, 'hint_qc_switch')}
            </span>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={config.qcEnabled}
              onChange={(e) => onChange({ qcEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-[#0e1014] border border-[#262c36] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[#8b93a1] peer-checked:after:bg-[#0e1014] peer-checked:bg-[#7c9cff] after:border-transparent after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
          </label>
        </div>

        {/* Retries Stepper */}
        <div
          className={`flex items-center justify-between p-2 rounded-xl bg-[#0e1014] border border-[#262c36] transition-opacity ${
            config.qcEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'
          }`}
        >
          <span className="text-[11px] text-[#8b93a1]">
            {t(lang, 'lbl_qc_retries')}
          </span>

          <div className="flex items-center bg-[#161a21] rounded-lg border border-[#262c36] p-0.5">
            <button
              type="button"
              disabled={!config.qcEnabled || (config.qcMaxRetries ?? 1) <= 0}
              onClick={() => handleRetriesChange(-1)}
              className="w-6 h-6 flex items-center justify-center text-[#8b93a1] hover:text-[#e6e9ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <span className="material-symbols-outlined text-xs">remove</span>
            </button>
            <span className="w-6 text-center text-xs font-mono font-bold text-[#e6e9ef]">
              {config.qcMaxRetries ?? 1}
            </span>
            <button
              type="button"
              disabled={!config.qcEnabled || (config.qcMaxRetries ?? 1) >= 2}
              onClick={() => handleRetriesChange(1)}
              className="w-6 h-6 flex items-center justify-center text-[#8b93a1] hover:text-[#e6e9ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <span className="material-symbols-outlined text-xs">add</span>
            </button>
          </div>
        </div>

        {/* Candidates Stepper */}
        <div
          title={t(lang, 'hint_qc_candidates')}
          className={`flex items-center justify-between p-2 rounded-xl bg-[#0e1014] border border-[#262c36] transition-opacity ${
            config.qcEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'
          }`}
        >
          <span className="text-[11px] text-[#8b93a1]">
            {t(lang, 'lbl_qc_candidates')}
          </span>

          <div className="flex items-center bg-[#161a21] rounded-lg border border-[#262c36] p-0.5">
            <button
              type="button"
              disabled={!config.qcEnabled || (config.qcCandidates ?? 1) <= 1}
              onClick={() => handleCandidatesChange(-1)}
              className="w-6 h-6 flex items-center justify-center text-[#8b93a1] hover:text-[#e6e9ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <span className="material-symbols-outlined text-xs">remove</span>
            </button>
            <span className="w-6 text-center text-xs font-mono font-bold text-[#e6e9ef]">
              {config.qcCandidates ?? 1}
            </span>
            <button
              type="button"
              disabled={!config.qcEnabled || (config.qcCandidates ?? 1) >= 4}
              onClick={() => handleCandidatesChange(1)}
              className="w-6 h-6 flex items-center justify-center text-[#8b93a1] hover:text-[#e6e9ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <span className="material-symbols-outlined text-xs">add</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
