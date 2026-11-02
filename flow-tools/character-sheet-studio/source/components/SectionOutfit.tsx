import React, { useState } from 'react';
import { CharacterConfig, Footwear, Language, OutfitPreset, RefImage } from '../types';
import { t } from '../services/i18n';
import { FOOTWEAR_OPTIONS, OUTFIT_PRESET_OPTIONS } from '../constants';
import { RefDropZone } from './RefDropZone';

interface ReferencesOutfitContext {
  outfitRefs: RefImage[];
  outfitDna: string;
  error: string | null;
  addFiles: (kind: 'face' | 'outfit', files: File[]) => Promise<void>;
  addFromLibrary: (kind: 'face' | 'outfit') => Promise<void>;
  remove: (id: string) => void;
  setOutfitDna: (dna: string) => void;
  analyzeOutfit: () => Promise<void>;
}

interface SectionOutfitProps {
  config: CharacterConfig;
  lang: Language;
  refs: ReferencesOutfitContext;
  onChange: (patch: Partial<CharacterConfig>) => void;
}

export const SectionOutfit: React.FC<SectionOutfitProps> = ({
  config,
  lang,
  refs,
  onChange,
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleFiles = async (files: File[]) => {
    await refs.addFiles('outfit', files);
  };

  const handleLibrary = async () => {
    await refs.addFromLibrary('outfit');
  };

  const handleAnalyzeOutfit = async () => {
    if (refs.outfitRefs.length === 0 || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      await refs.analyzeOutfit();
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-3.5 text-xs text-[#e6e9ef]">
      {/* Preset select */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_outfit_preset')}
        </label>
        <select
          value={config.outfitPreset}
          onChange={(e) => onChange({ outfitPreset: e.target.value as OutfitPreset })}
          className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
        >
          {OUTFIT_PRESET_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {t(lang, opt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* Free text outfit description */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_outfit_desc')}
        </label>
        <textarea
          rows={2}
          value={config.outfitDescription}
          onChange={(e) => onChange({ outfitDescription: e.target.value })}
          className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none resize-none placeholder-[#8b93a1]/40"
          placeholder={t(lang, 'placeholder_outfit_desc')}
        />
      </div>

      {/* Color Palette */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_color_palette')}
        </label>
        <input
          type="text"
          value={config.colorPalette}
          onChange={(e) => onChange({ colorPalette: e.target.value })}
          className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none placeholder-[#8b93a1]/40"
          placeholder={t(lang, 'placeholder_color_palette')}
        />
      </div>

      {/* Footwear select */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_footwear')}
        </label>
        <select
          value={config.footwear}
          onChange={(e) => onChange({ footwear: e.target.value as Footwear })}
          className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
        >
          {FOOTWEAR_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {t(lang, opt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* Outfit Reference DropZone (max 4) */}
      <div className="pt-2 border-t border-[#262c36] space-y-3">
        <RefDropZone
          kind="outfit"
          items={refs.outfitRefs}
          max={4}
          lang={lang}
          disabled={isAnalyzing}
          onFiles={handleFiles}
          onLibrary={handleLibrary}
          onRemove={refs.remove}
        />

        {/* Analyze Outfit Button */}
        {refs.outfitRefs.length > 0 && (
          <div>
            <button
              type="button"
              onClick={handleAnalyzeOutfit}
              disabled={isAnalyzing}
              className="w-full py-2 px-3 rounded-xl bg-[#0e1014] border border-[#7c9cff]/40 text-[#7c9cff] hover:bg-[#7c9cff]/10 text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? (
                <>
                  <span className="material-symbols-outlined text-sm animate-spin">autorenew</span>
                  <span>{t(lang, 'btn_analyzing_outfit')}</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                  <span>{t(lang, 'btn_analyze_outfit')}</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Editable Outfit DNA description */}
        {(refs.outfitDna || refs.outfitRefs.length > 0) && (
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-[#8b93a1]">
              {t(lang, 'lbl_outfit_dna')}
            </label>
            <textarea
              rows={3}
              value={refs.outfitDna}
              onChange={(e) => refs.setOutfitDna(e.target.value)}
              className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none resize-none leading-relaxed"
              placeholder="e.g. Black windbreaker jacket, grey hoodie, tactical cargo pants..."
            />
            <p className="text-[10px] text-[#8b93a1] leading-tight">
              {t(lang, 'hint_outfit_dna')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
