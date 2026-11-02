import React from 'react';
import { HistoryItem, Language, QcReport } from '../types';
import { t } from '../services/i18n';

interface HistoryStripProps {
  history: HistoryItem[];
  selectedId: string | null;
  lang: Language;
  onSelect: (id: string) => void;
}

function getQcBadgeColor(qc?: QcReport, pending?: boolean): { bg: string; text: string; label: string } {
  if (!qc && pending) {
    return { bg: 'bg-[#262c36]/80 animate-pulse', text: 'text-[#8b93a1]', label: '…' };
  }
  if (!qc || !qc.available) {
    return { bg: 'bg-[#8b93a1]/20 border-[#8b93a1]/40', text: 'text-[#8b93a1]', label: 'n/a' };
  }
  if (qc.score >= 80) {
    return { bg: 'bg-[#22c55e]/20 border-[#22c55e]/50', text: 'text-[#4ade80]', label: `${qc.score}` };
  }
  if (qc.score >= 65) {
    return { bg: 'bg-[#f59e0b]/20 border-[#f59e0b]/50', text: 'text-[#fbbf24]', label: `${qc.score}` };
  }
  return { bg: 'bg-[#ef4444]/20 border-[#ef4444]/50', text: 'text-[#f87171]', label: `${qc.score}` };
}

function buildQcTooltip(qc: QcReport | undefined, lang: Language, changesSummary?: string): string {
  const parts: string[] = [];

  if (changesSummary) {
    parts.push(`[${t(lang, 'badge_variant_tag')}]: ${changesSummary}`);
  }

  if (!qc || !qc.available) {
    parts.push(t(lang, 'tooltip_qc_na'));
    return parts.join('\n');
  }

  parts.push(
    t(lang, 'tooltip_qc_score', { score: qc.score }),
    t(lang, 'tooltip_qc_views', { found: qc.viewCount, expected: qc.expectedViews })
  );

  if (qc.hasText) {
    const words = qc.textFound && qc.textFound.length > 0 ? qc.textFound.join(', ') : '...';
    parts.push(t(lang, 'tooltip_qc_hastext', { words }));
  } else {
    parts.push(t(lang, 'tooltip_qc_notext'));
  }

  if (qc.faceMatch !== null) {
    parts.push(t(lang, 'tooltip_qc_facematch', { match: qc.faceMatch }));
  }

  if (qc.issues && qc.issues.length > 0) {
    parts.push(`Issues: ${qc.issues.join('; ')}`);
  }

  return parts.join('\n');
}

export const HistoryStrip: React.FC<HistoryStripProps> = ({
  history,
  selectedId,
  lang,
  onSelect,
}) => {
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };

  return (
    <div className="border-t border-[#262c36] bg-[#161a21]/80 p-3 shrink-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm text-[#7c9cff]">history</span>
          <h3 className="text-xs font-bold text-[#e6e9ef] uppercase tracking-wider">
            {t(lang, 'history_title')}
          </h3>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#0e1014] border border-[#262c36] text-[#8b93a1]">
          {t(lang, 'history_badge', { count: history.length })}
        </span>
      </div>

      {history.length === 0 ? (
        <div className="py-3 px-4 rounded-xl border border-[#262c36] bg-[#0e1014]/50 flex items-center justify-center text-center">
          <span className="text-xs text-[#8b93a1]">{t(lang, 'history_empty')}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none no-scrollbar">
          {history.map((item, idx) => {
            const isSelected = item.id === selectedId;
            const itemNumber = history.length - idx;
            const qcStyle = getQcBadgeColor(item.qc, item.qcPending);
            const tooltipText = buildQcTooltip(item.qc, lang, item.changesSummary);

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                title={tooltipText}
                className={`group relative shrink-0 rounded-xl overflow-hidden border-2 transition-all p-0.5 text-left flex flex-col ${
                  isSelected
                    ? 'border-[#7c9cff] ring-2 ring-[#7c9cff]/30 scale-[1.02] shadow-lg shadow-[#7c9cff]/20'
                    : 'border-[#262c36] hover:border-[#8b93a1]/60'
                }`}
              >
                {/* Thumbnail */}
                <div className="w-20 h-14 bg-[#0e1014] rounded-lg overflow-hidden relative">
                  <img
                    src={item.thumb}
                    alt={`Render #${itemNumber}`}
                    className="w-full h-full object-cover object-center"
                    loading="lazy"
                  />

                  {/* QC Badge */}
                  <div
                    className={`absolute top-1 left-1 px-1 py-0.2 rounded text-[9px] font-mono font-bold border backdrop-blur-sm ${qcStyle.bg} ${qcStyle.text}`}
                  >
                    {qcStyle.label}
                  </div>

                  {/* Favorite mark badge */}
                  {item.favorite && (
                    <div className="absolute top-1 right-1 text-[#fbbf24] drop-shadow-md">
                      <span className="material-symbols-outlined text-xs">star</span>
                    </div>
                  )}

                  {/* Small "Biến thể" tag with tooltip */}
                  {item.parentId && (
                    <div
                      title={item.changesSummary || t(lang, 'badge_variant_tag')}
                      className="absolute bottom-1 right-1 px-1 rounded bg-[#7c9cff] text-[8px] font-bold text-[#0e1014] shadow-sm flex items-center gap-0.5"
                    >
                      <span className="material-symbols-outlined text-[9px] leading-none">auto_fix_high</span>
                      <span>{t(lang, 'badge_variant_tag')}</span>
                    </div>
                  )}

                  {/* Red hasText warning tag */}
                  {item.qc?.hasText && (
                    <div className="absolute bottom-1 left-1 px-1 rounded bg-[#ef4444] text-[8px] font-bold text-white shadow-sm">
                      TXT
                    </div>
                  )}

                  {/* Policy rewritten icon */}
                  {item.rewriteRound > 0 && !item.parentId && (
                    <div className="absolute bottom-1 right-1 px-1 rounded bg-[#0e1014]/80 text-[8px] font-mono text-[#fbbf24] border border-[#fbbf24]/30">
                      R{item.rewriteRound}
                    </div>
                  )}
                </div>

                {/* Info row */}
                <div className="flex items-center justify-between px-1 py-1 text-[10px] font-mono text-[#8b93a1] bg-[#161a21]">
                  <span className="font-bold text-[#e6e9ef]">#{itemNumber}</span>
                  <span>{formatTime(item.createdAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
