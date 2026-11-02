import React, { useState } from 'react';
import {
  BackgroundType,
  FacialExpression,
  HairStyle,
  Language,
  OutfitPreset,
} from '../types';
import { t } from '../services/i18n';
import {
  BACKGROUND_OPTIONS,
  EXPRESSION_OPTIONS,
  HAIR_STYLE_OPTIONS,
  OUTFIT_PRESET_OPTIONS,
  PRESET_HAIR_COLORS,
} from '../constants';
import { hasVariantChanges, VariantChanges } from '../services/variant';

interface VariantPanelProps {
  lang: Language;
  isRunning: boolean;
  onSubmit: (changes: VariantChanges, count: number) => void;
  onClose: () => void;
}

export const VariantPanel: React.FC<VariantPanelProps> = ({
  lang,
  isRunning,
  onSubmit,
  onClose,
}) => {
  const [outfitPreset, setOutfitPreset] = useState<OutfitPreset | 'unchanged'>('unchanged');
  const [outfitDescription, setOutfitDescription] = useState<string>('');
  const [hairStyle, setHairStyle] = useState<HairStyle | 'unchanged'>('unchanged');
  const [hairColor, setHairColor] = useState<string>(''); // '' = unchanged
  const [expression, setExpression] = useState<FacialExpression | 'unchanged'>('unchanged');
  const [background, setBackground] = useState<BackgroundType | 'unchanged'>('unchanged');
  const [extra, setExtra] = useState<string>('');
  const [count, setCount] = useState<number>(1);

  const changes: VariantChanges = {};
  if (outfitPreset !== 'unchanged') {
    changes.outfitPreset = outfitPreset;
  }
  if (outfitDescription.trim() !== '') {
    changes.outfitDescription = outfitDescription.trim();
  }
  if (hairStyle !== 'unchanged') {
    changes.hairStyle = hairStyle;
  }
  if (hairColor.trim() !== '') {
    changes.hairColor = hairColor.trim();
  }
  if (expression !== 'unchanged') {
    changes.expression = expression;
  }
  if (background !== 'unchanged') {
    changes.background = background;
  }
  if (extra.trim() !== '') {
    changes.extra = extra.trim();
  }

  const canSubmit = hasVariantChanges(changes) && !isRunning;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(changes, count);
  };

  return (
    <div className="bg-[#12161d] border-b border-[#262c36] p-4 text-xs text-[#e6e9ef] animate-in fade-in-50 duration-150 select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-[#7c9cff]/20 text-[#7c9cff] flex items-center justify-center border border-[#7c9cff]/30">
            <span className="material-symbols-outlined text-sm">auto_fix_high</span>
          </div>
          <div>
            <h3 className="font-bold text-xs text-[#e6e9ef] leading-tight">
              {t(lang, 'variant_panel_title')}
            </h3>
            <p className="text-[10px] text-[#8b93a1] leading-tight">
              {t(lang, 'variant_panel_subtitle')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-lg text-[#8b93a1] hover:text-[#e6e9ef] hover:bg-[#262c36] flex items-center justify-center transition-colors"
          title={t(lang, 'variant_btn_close')}
        >
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      </div>

      {/* Grid of variant options */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
        {/* 1. Outfit preset */}
        <div>
          <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
            {t(lang, 'variant_lbl_outfit_preset')}
          </label>
          <select
            value={outfitPreset}
            onChange={(e) => setOutfitPreset(e.target.value as OutfitPreset | 'unchanged')}
            className="w-full px-2.5 py-1.5 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
          >
            <option value="unchanged">{t(lang, 'variant_unchanged')}</option>
            {OUTFIT_PRESET_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(lang, opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {/* 2. New outfit description */}
        <div>
          <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
            {t(lang, 'variant_lbl_outfit_desc')}
          </label>
          <input
            type="text"
            value={outfitDescription}
            onChange={(e) => setOutfitDescription(e.target.value)}
            placeholder={t(lang, 'variant_placeholder_outfit_desc')}
            className="w-full px-2.5 py-1.5 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none placeholder-[#8b93a1]/40"
          />
        </div>

        {/* 3. Hair style */}
        <div>
          <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
            {t(lang, 'variant_lbl_hair_style')}
          </label>
          <select
            value={hairStyle}
            onChange={(e) => setHairStyle(e.target.value as HairStyle | 'unchanged')}
            className="w-full px-2.5 py-1.5 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
          >
            <option value="unchanged">{t(lang, 'variant_unchanged')}</option>
            {HAIR_STYLE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(lang, opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {/* 4. Hair colour swatches */}
        <div>
          <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
            {t(lang, 'variant_lbl_hair_color')}
          </label>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setHairColor('')}
              className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
                hairColor === ''
                  ? 'bg-[#7c9cff] text-[#0e1014] border-[#7c9cff]'
                  : 'bg-[#0e1014] text-[#8b93a1] border-[#262c36] hover:border-[#8b93a1]'
              }`}
            >
              {t(lang, 'variant_unchanged')}
            </button>
            {PRESET_HAIR_COLORS.map((c) => {
              const active = hairColor.toLowerCase() === c.hex.toLowerCase();
              return (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setHairColor(c.hex)}
                  title={t(lang, c.labelKey)}
                  className={`w-5 h-5 rounded-full border transition-all ${
                    active
                      ? 'border-[#7c9cff] ring-2 ring-[#7c9cff]/40 scale-110'
                      : 'border-[#262c36] hover:scale-105'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              );
            })}
          </div>
        </div>

        {/* 5. Expression */}
        <div>
          <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
            {t(lang, 'variant_lbl_expression')}
          </label>
          <select
            value={expression}
            onChange={(e) => setExpression(e.target.value as FacialExpression | 'unchanged')}
            className="w-full px-2.5 py-1.5 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
          >
            <option value="unchanged">{t(lang, 'variant_unchanged')}</option>
            {EXPRESSION_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(lang, opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {/* 6. Background */}
        <div>
          <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
            {t(lang, 'variant_lbl_background')}
          </label>
          <select
            value={background}
            onChange={(e) => setBackground(e.target.value as BackgroundType | 'unchanged')}
            className="w-full px-2.5 py-1.5 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
          >
            <option value="unchanged">{t(lang, 'variant_unchanged')}</option>
            {BACKGROUND_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(lang, opt.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Extra changes text area */}
      <div className="mb-3">
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'variant_lbl_extra')}
        </label>
        <input
          type="text"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder={t(lang, 'variant_placeholder_extra')}
          className="w-full px-2.5 py-1.5 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none placeholder-[#8b93a1]/40"
        />
      </div>

      {/* Bottom action row with count stepper 1-2 and primary button */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#262c36]">
        {/* Count stepper 1-2 */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#8b93a1]">{t(lang, 'variant_lbl_count')}</span>
          <div className="flex items-center bg-[#0e1014] rounded-lg border border-[#262c36] p-0.5">
            <button
              type="button"
              disabled={count <= 1 || isRunning}
              onClick={() => setCount(1)}
              className="w-6 h-6 flex items-center justify-center text-[#8b93a1] hover:text-[#e6e9ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <span className="material-symbols-outlined text-xs">remove</span>
            </button>
            <span className="w-6 text-center text-xs font-mono font-bold text-[#e6e9ef]">
              {count}
            </span>
            <button
              type="button"
              disabled={count >= 2 || isRunning}
              onClick={() => setCount(2)}
              className="w-6 h-6 flex items-center justify-center text-[#8b93a1] hover:text-[#e6e9ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <span className="material-symbols-outlined text-xs">add</span>
            </button>
          </div>
        </div>

        {/* Primary action button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md ${
            canSubmit
              ? 'bg-gradient-to-r from-[#7c9cff] to-[#6366f1] text-[#0e1014] hover:brightness-110 active:scale-95 shadow-[#7c9cff]/20'
              : 'bg-[#262c36] text-[#8b93a1] opacity-50 cursor-not-allowed shadow-none'
          }`}
        >
          <span className="material-symbols-outlined text-sm">auto_fix_high</span>
          <span>{t(lang, 'variant_btn_create')}</span>
        </button>
      </div>
    </div>
  );
};
