import React, { useState } from 'react';
import { CharacterConfig, GenerationJob, HistoryItem, Language } from '../types';
import { t } from '../services/i18n';
import { VISUAL_STYLES, SHEET_LAYOUTS } from '../constants';
import { ImageViewer } from './ImageViewer';
import { HistoryStrip } from './HistoryStrip';
import { ProgressPanel } from './ProgressPanel';
import { VariantChanges } from '../services/variant';

interface ViewerPanelProps {
  config: CharacterConfig;
  lang: Language;
  history: HistoryItem[];
  selectedItem: HistoryItem | null;
  selectedId: string | null;
  job: GenerationJob | null;
  isRunning?: boolean;
  onOpenPrompt: () => void;
  onGenerate: () => void;
  onSelectHistory: (id: string) => void;
  onRegenerate: (item: HistoryItem) => void;
  onDeleteHistory: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onCreateVariant?: (item: HistoryItem, changes: VariantChanges, count: number) => void;
}

export const ViewerPanel: React.FC<ViewerPanelProps> = ({
  config,
  lang,
  history,
  selectedItem,
  selectedId,
  job,
  isRunning = false,
  onOpenPrompt,
  onGenerate,
  onSelectHistory,
  onRegenerate,
  onDeleteHistory,
  onToggleFavorite,
  onCreateVariant,
}) => {
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);

  const currentStyle = VISUAL_STYLES.find((s) => s.id === config.styleId);
  const currentLayout = SHEET_LAYOUTS.find((l) => l.id === config.layoutId);

  // If compare mode is turned on and no compare item is selected, choose another from history
  const effectiveCompareItem = React.useMemo(() => {
    if (!isCompareMode) return null;
    if (compareId) {
      const found = history.find((h) => h.id === compareId);
      if (found) return found;
    }
    const other = history.find((h) => h.id !== selectedId);
    return other || null;
  }, [isCompareMode, compareId, history, selectedId]);

  const handleHistorySelect = (id: string) => {
    if (isCompareMode) {
      if (id !== selectedId) {
        setCompareId(id);
      }
    } else {
      onSelectHistory(id);
    }
  };

  const handleToggleCompare = () => {
    setIsCompareMode((prev) => {
      const next = !prev;
      if (next && !compareId) {
        const other = history.find((h) => h.id !== selectedId);
        if (other) setCompareId(other.id);
      }
      return next;
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0e1014] overflow-hidden">
      {/* Top Progress bar when generating */}
      {job && <ProgressPanel job={job} lang={lang} />}

      {/* Main Viewport: ImageViewer if history exists, else empty state */}
      {selectedItem ? (
        <ImageViewer
          item={selectedItem}
          history={history}
          compareItem={effectiveCompareItem}
          isCompareMode={isCompareMode}
          onToggleCompare={handleToggleCompare}
          onSelectCompareItem={setCompareId}
          lang={lang}
          isRunning={isRunning}
          onRegenerate={onRegenerate}
          onDelete={onDeleteHistory}
          onToggleFavorite={onToggleFavorite}
          onCreateVariant={onCreateVariant}
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 text-center overflow-y-auto">
          <div className="max-w-md w-full bg-[#161a21] border border-[#262c36] rounded-2xl p-6 md:p-8 shadow-2xl relative overflow-hidden">
            {/* Subtle background glow */}
            <div className="absolute -top-16 -right-16 w-36 h-36 bg-[#7c9cff]/10 rounded-full blur-3xl pointer-events-none" />

            {/* Central artistic sheet mockup icon */}
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#161a21] to-[#0e1014] border border-[#262c36] flex items-center justify-center text-[#7c9cff] mx-auto mb-4 shadow-lg shadow-black/40">
              <span className="material-symbols-outlined text-3xl">art_track</span>
            </div>

            <h2 className="text-lg font-bold text-[#e6e9ef] mb-1.5">
              {t(lang, 'viewer_empty_title')}
            </h2>
            <p className="text-xs text-[#8b93a1] leading-relaxed mb-6">
              {t(lang, 'viewer_empty_desc')}
            </p>

            {/* 3-Step Guided flow */}
            <div className="text-left space-y-2.5 bg-[#0e1014] p-4 rounded-xl border border-[#262c36] mb-6">
              <div className="flex items-start gap-2.5 text-xs text-[#8b93a1]">
                <span className="material-symbols-outlined text-sm text-[#7c9cff] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>{t(lang, 'hint_step_1')}</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-[#8b93a1]">
                <span className="material-symbols-outlined text-sm text-[#7c9cff] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>{t(lang, 'hint_step_2')}</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-[#8b93a1]">
                <span className="material-symbols-outlined text-sm text-[#7c9cff] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span>{t(lang, 'hint_step_3')}</span>
              </div>
            </div>

            {/* Quick summary of the configured character sheet */}
            <div className="grid grid-cols-2 gap-2 text-left text-xs mb-6">
              <div className="p-2.5 rounded-lg bg-[#0e1014]/60 border border-[#262c36]/60">
                <span className="text-[10px] text-[#8b93a1] uppercase block">Phong cách:</span>
                <span className="font-semibold text-[#e6e9ef]">
                  {currentStyle ? t(lang, currentStyle.labelKey) : config.styleId}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0e1014]/60 border border-[#262c36]/60">
                <span className="text-[10px] text-[#8b93a1] uppercase block">Bố cục:</span>
                <span className="font-semibold text-[#e6e9ef]">
                  {currentLayout ? `Mẫu ${currentLayout.tag}` : config.layoutId}
                </span>
              </div>
            </div>

            {/* Generate Action Button */}
            <button
              type="button"
              onClick={onGenerate}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#7c9cff] to-[#6366f1] text-[#0e1014] font-bold text-xs tracking-wide shadow-lg shadow-[#7c9cff]/20 hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mb-2"
            >
              <span className="material-symbols-outlined text-base">auto_awesome</span>
              <span>{t(lang, 'btn_generate_sheet')}</span>
            </button>

            {/* Inspect Prompt Button */}
            <button
              type="button"
              onClick={onOpenPrompt}
              className="w-full py-2 px-3 text-[#8b93a1] hover:text-[#e6e9ef] text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">code</span>
              <span>{t(lang, 'btn_view_prompt')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom history strip */}
      <HistoryStrip
        history={history}
        selectedId={selectedId}
        lang={lang}
        onSelect={handleHistorySelect}
      />
    </div>
  );
};
