import React from 'react';
import { CharacterConfig, HairStyle, FacialExpression, Accessory, Language } from '../types';
import { t } from '../services/i18n';
import {
  HAIR_STYLE_OPTIONS,
  EXPRESSION_OPTIONS,
  ACCESSORY_OPTIONS,
  PRESET_HAIR_COLORS,
} from '../constants';

interface SectionAppearanceProps {
  config: CharacterConfig;
  lang: Language;
  onChange: (patch: Partial<CharacterConfig>) => void;
}

export const SectionAppearance: React.FC<SectionAppearanceProps> = ({ config, lang, onChange }) => {
  const toggleAccessory = (acc: Accessory) => {
    const exists = config.accessories.includes(acc);
    const updated = exists
      ? config.accessories.filter((a) => a !== acc)
      : [...config.accessories, acc];
    onChange({ accessories: updated });
  };

  const isPhotoHairColor = !config.hairColor || config.hairColor.trim() === '';

  return (
    <div className="space-y-3.5 text-xs text-[#e6e9ef]">
      {/* Hair style select */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_hair_style')}
        </label>
        <select
          value={config.hairStyle}
          onChange={(e) => onChange({ hairStyle: e.target.value as HairStyle })}
          className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
        >
          {HAIR_STYLE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {t(lang, opt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* Hair Color Swatches + Hex */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] font-semibold text-[#8b93a1]">
            {t(lang, 'lbl_hair_color')}
          </label>
          {isPhotoHairColor && (
            <span className="text-[10px] text-[#7c9cff] font-mono">
              ({t(lang, 'hair_color_photo')})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {/* Theo ảnh gốc chip */}
          <button
            type="button"
            onClick={() => onChange({ hairColor: '' })}
            className={`px-2 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1 transition-all ${
              isPhotoHairColor
                ? 'bg-[#7c9cff] text-[#0e1014] border-[#7c9cff] shadow-sm'
                : 'bg-[#0e1014] text-[#8b93a1] border-[#262c36] hover:border-[#8b93a1]'
            }`}
          >
            <span className="material-symbols-outlined text-xs">photo_camera</span>
            <span>{t(lang, 'hair_color_photo')}</span>
          </button>

          {PRESET_HAIR_COLORS.map((c) => {
            const colorTitle = t(lang, c.labelKey);
            const isSelected = !isPhotoHairColor && config.hairColor.toLowerCase() === c.hex.toLowerCase();
            return (
              <button
                key={c.hex}
                type="button"
                onClick={() => onChange({ hairColor: c.hex })}
                className={`w-6 h-6 rounded-full border transition-all ${
                  isSelected
                    ? 'border-[#7c9cff] ring-2 ring-[#7c9cff]/40 scale-110'
                    : 'border-[#262c36] hover:scale-105'
                }`}
                style={{ backgroundColor: c.hex }}
                title={colorTitle}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={config.hairColor && config.hairColor.startsWith('#') ? config.hairColor : '#1a181b'}
            onChange={(e) => onChange({ hairColor: e.target.value })}
            className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0 p-0"
          />
          <input
            type="text"
            value={config.hairColor}
            onChange={(e) => onChange({ hairColor: e.target.value })}
            className="flex-1 px-3 py-1.5 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs font-mono text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none placeholder-[#8b93a1]/50"
            placeholder={t(lang, 'hair_color_photo')}
          />
        </div>
      </div>

      {/* Expression */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_expression')}
        </label>
        <select
          value={config.expression}
          onChange={(e) => onChange({ expression: e.target.value as FacialExpression })}
          className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
        >
          {EXPRESSION_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {t(lang, opt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* Accessory chips multi-select */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1.5">
          {t(lang, 'lbl_accessories')}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {ACCESSORY_OPTIONS.map((acc) => {
            const isSelected = config.accessories.includes(acc.id);
            return (
              <button
                key={acc.id}
                type="button"
                onClick={() => toggleAccessory(acc.id)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-medium border flex items-center gap-1 transition-all ${
                  isSelected
                    ? 'bg-[#7c9cff] text-[#0e1014] border-[#7c9cff] font-semibold'
                    : 'bg-[#0e1014] text-[#8b93a1] border-[#262c36] hover:border-[#8b93a1]'
                }`}
              >
                <span className="material-symbols-outlined text-xs">{acc.icon}</span>
                {t(lang, acc.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Distinctive Features */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_distinctive_features')}
        </label>
        <textarea
          rows={2}
          value={config.distinctiveFeatures}
          onChange={(e) => onChange({ distinctiveFeatures: e.target.value })}
          className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none resize-none placeholder-[#8b93a1]/40"
          placeholder={t(lang, 'placeholder_distinctive_features')}
        />
      </div>
    </div>
  );
};
