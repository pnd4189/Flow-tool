import React from 'react';
import { CharacterConfig, Language } from '../types';
import { t } from '../services/i18n';
import {
  VISUAL_STYLES,
  SHEET_LAYOUTS,
  ETHNICITY_OPTIONS,
  HAIR_STYLE_OPTIONS,
  EXPRESSION_OPTIONS,
  OUTFIT_PRESET_OPTIONS,
  FOOTWEAR_OPTIONS,
} from '../constants';

interface ConfigChipsProps {
  config: CharacterConfig;
  lang: Language;
  faceLocked?: boolean;
  faceRefCount?: number;
  outfitRefCount?: number;
  onJumpToSection: (sectionNumber: number) => void;
}

export const ConfigChips: React.FC<ConfigChipsProps> = ({
  config,
  lang,
  faceLocked = false,
  faceRefCount = 0,
  outfitRefCount = 0,
  onJumpToSection,
}) => {
  const currentStyle = VISUAL_STYLES.find((s) => s.id === config.styleId);
  const currentLayout = SHEET_LAYOUTS.find((l) => l.id === config.layoutId);
  const currentEth = ETHNICITY_OPTIONS.find((e) => e.id === config.ethnicity);
  const currentHair = HAIR_STYLE_OPTIONS.find((h) => h.id === config.hairStyle);
  const currentExpr = EXPRESSION_OPTIONS.find((e) => e.id === config.expression);
  const currentOutfit = OUTFIT_PRESET_OPTIONS.find((o) => o.id === config.outfitPreset);
  const currentFootwear = FOOTWEAR_OPTIONS.find((f) => f.id === config.footwear);

  const genderLabel =
    config.gender === 'male'
      ? t(lang, 'gender_male')
      : config.gender === 'female'
      ? t(lang, 'gender_female')
      : t(lang, 'gender_other');

  const faceSourceLabel =
    config.faceSource === 'ai' ? t(lang, 'face_source_ai') : t(lang, 'face_source_upload');

  // Base chips
  const chips = [
    {
      section: 1,
      icon: 'badge',
      label: config.displayName || t(lang, 'chip_default_character'),
      value: genderLabel,
    },
    {
      section: 2,
      icon: faceLocked ? 'lock' : 'face',
      label: faceSourceLabel,
      value: currentEth ? t(lang, currentEth.labelKey) : config.ethnicity,
    },
    {
      section: 3,
      icon: 'palette',
      label: currentStyle ? t(lang, currentStyle.labelKey) : t(lang, 'chip_default_style'),
      value: currentStyle ? t(lang, currentStyle.badgeKey) : '',
    },
    {
      section: 4,
      icon: 'style',
      label: currentHair ? t(lang, currentHair.labelKey) : config.hairStyle,
      value: currentExpr ? t(lang, currentExpr.labelKey) : config.expression,
    },
    {
      section: 5,
      icon: 'checkroom',
      label: currentOutfit ? t(lang, currentOutfit.labelKey) : config.outfitPreset,
      value: currentFootwear ? t(lang, currentFootwear.labelKey) : config.footwear,
    },
    {
      section: 6,
      icon: 'grid_view',
      label: currentLayout ? `${t(lang, 'chip_layout_prefix')} ${currentLayout.tag}` : t(lang, 'chip_layout_fallback'),
      value: config.aspectRatio,
    },
  ];

  // Reference images count chip when any ref image exists
  const totalRefs = faceRefCount + outfitRefCount;
  const refJumpSection = faceRefCount > 0 ? 2 : 5;

  return (
    <div className="p-3 border-b border-[#262c36] bg-[#161a21]/50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#8b93a1]">
          {t(lang, 'config_strip_title')}
        </span>
        <span className="text-[10px] text-[#7c9cff] font-mono">
          {t(lang, 'config_strip_count')}
        </span>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none no-scrollbar">
        {/* Optional reference images badge chip */}
        {totalRefs > 0 && (
          <button
            type="button"
            onClick={() => onJumpToSection(refJumpSection)}
            className="group flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#7c9cff]/10 border border-[#7c9cff]/50 hover:border-[#7c9cff] text-left shrink-0 transition-all active:scale-95"
            title={t(lang, 'chip_jump_tooltip', { section: refJumpSection })}
          >
            <span className="material-symbols-outlined text-xs text-[#7c9cff] group-hover:scale-110 transition-transform">
              perm_media
            </span>
            <div className="flex flex-col text-[11px] leading-tight">
              <span className="font-semibold text-[#7c9cff] whitespace-nowrap">
                {t(lang, 'chip_ref_images', { count: totalRefs })}
              </span>
              <span className="text-[9px] text-[#8b93a1] font-mono">
                {faceRefCount > 0 ? `Face: ${faceRefCount}` : ''} {outfitRefCount > 0 ? `Outfit: ${outfitRefCount}` : ''}
              </span>
            </div>
          </button>
        )}

        {chips.map((chip) => (
          <button
            key={chip.section}
            type="button"
            onClick={() => onJumpToSection(chip.section)}
            className="group flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#0e1014] border border-[#262c36] hover:border-[#7c9cff]/50 text-left shrink-0 transition-all active:scale-95"
            title={t(lang, 'chip_jump_tooltip', { section: chip.section })}
          >
            <span className="material-symbols-outlined text-xs text-[#7c9cff] group-hover:scale-110 transition-transform">
              {chip.icon}
            </span>
            <div className="flex flex-col text-[11px] leading-tight">
              <span className="font-semibold text-[#e6e9ef] whitespace-nowrap max-w-[90px] truncate">
                {chip.label}
              </span>
              <span className="text-[9px] text-[#8b93a1] font-mono truncate max-w-[80px]">
                {chip.value}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
