import React, { useState, useEffect, useMemo } from 'react';
import { Flow } from 'flow-sdk';
import { Language } from '../types';
import { t } from '../services/i18n';
import {
  DiagEntry,
  DiagKind,
  clearDiag,
  formatDiag,
  getDiag,
  subscribeDiag,
} from '../services/diagnostics';

interface DiagnosticsDrawerProps {
  isOpen: boolean;
  lang: Language;
  onClose: () => void;
}

const KIND_BADGE_STYLES: Record<DiagKind, { bg: string; text: string; border: string }> = {
  call: {
    bg: 'bg-[#0288d1]/15',
    text: 'text-[#38bdf8]',
    border: 'border-[#0288d1]/30',
  },
  ok: {
    bg: 'bg-[#22c55e]/15',
    text: 'text-[#4ade80]',
    border: 'border-[#22c55e]/30',
  },
  error: {
    bg: 'bg-[#ef4444]/15',
    text: 'text-[#f87171]',
    border: 'border-[#ef4444]/30',
  },
  info: {
    bg: 'bg-[#7c9cff]/15',
    text: 'text-[#7c9cff]',
    border: 'border-[#7c9cff]/30',
  },
};

export const DiagnosticsDrawer: React.FC<DiagnosticsDrawerProps> = ({ isOpen, lang, onClose }) => {
  const [entries, setEntries] = useState<DiagEntry[]>(() => getDiag());
  const [clearConfirm, setClearConfirm] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Live update subscription
  useEffect(() => {
    const unsub = subscribeDiag(() => {
      setEntries(getDiag());
    });
    return unsub;
  }, []);

  // Sync entries on drawer open
  useEffect(() => {
    if (isOpen) {
      setEntries(getDiag());
      setClearConfirm(false);
    }
  }, [isOpen]);

  // Esc key closes drawer
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Two-step clear reset timer (3s)
  useEffect(() => {
    if (!clearConfirm) return;
    const timer = setTimeout(() => {
      setClearConfirm(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [clearConfirm]);

  const handleClearClick = () => {
    if (clearConfirm) {
      clearDiag();
      setClearConfirm(false);
    } else {
      setClearConfirm(true);
    }
  };

  const handleDownloadLog = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const fullText = formatDiag(getDiag());
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const filename = `character-sheet-log-${y}${m}${d}-${hh}${mm}${ss}.txt`;

      // UTF-8 safe base64
      const base64 = btoa(unescape(encodeURIComponent(fullText)));

      await Flow.download({
        base64,
        mimeType: 'text/plain',
        filename,
      });
    } catch {
      // download error
    } finally {
      setDownloading(false);
    }
  };

  // Display newest first
  const reversedEntries = useMemo(() => [...entries].reverse(), [entries]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in-50 duration-150">
      {/* Drawer Panel */}
      <div className="w-full max-w-xl h-full bg-[#161a21] border-l border-[#262c36] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-[#262c36] flex items-center justify-between shrink-0 bg-[#161a21]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#7c9cff]/10 text-[#7c9cff] border border-[#7c9cff]/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-base">bug_report</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#e6e9ef] leading-tight">
                  {t(lang, 'diag_drawer_title')}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#0e1014] text-[#7c9cff] border border-[#262c36]">
                  {t(lang, 'diag_entries_count', { count: entries.length })}
                </span>
              </div>
              <p className="text-[11px] text-[#8b93a1] leading-tight">
                {t(lang, 'diag_drawer_subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#8b93a1] hover:text-[#e6e9ef] hover:bg-[#262c36] flex items-center justify-center transition-colors"
            title={t(lang, 'diag_close')}
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-2.5 border-b border-[#262c36] bg-[#0e1014]/60 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={handleClearClick}
            disabled={entries.length === 0}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              clearConfirm
                ? 'bg-[#ef4444] text-white shadow-md shadow-[#ef4444]/30 animate-pulse'
                : 'bg-[#161a21] border border-[#262c36] text-[#8b93a1] hover:text-[#ef4444] disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            <span className="material-symbols-outlined text-xs">delete_sweep</span>
            <span>{clearConfirm ? t(lang, 'diag_clear_confirm') : t(lang, 'diag_clear')}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadLog}
            disabled={downloading || entries.length === 0}
            className="px-3 py-1.5 rounded-lg bg-[#7c9cff]/10 border border-[#7c9cff]/30 text-[#7c9cff] hover:bg-[#7c9cff]/20 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
          >
            <span className="material-symbols-outlined text-xs">
              {downloading ? 'sync' : 'download'}
            </span>
            <span>{downloading ? t(lang, 'diag_downloading') : t(lang, 'diag_download')}</span>
          </button>
        </div>

        {/* Log Entries List (Newest first) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs select-text">
          {reversedEntries.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#8b93a1]">
              <span className="material-symbols-outlined text-3xl mb-2 text-[#8b93a1]/40">
                notes
              </span>
              <p className="text-xs">{t(lang, 'diag_empty')}</p>
            </div>
          ) : (
            reversedEntries.map((item, idx) => {
              const badgeStyle = KIND_BADGE_STYLES[item.kind] || KIND_BADGE_STYLES.info;
              const timeStr = new Date(item.t).toLocaleTimeString(undefined, {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3,
              });

              return (
                <div
                  key={`${item.t}_${idx}`}
                  className="p-2.5 rounded-xl bg-[#0e1014] border border-[#262c36] space-y-1.5 hover:border-[#8b93a1]/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                      >
                        {item.kind}
                      </span>
                      <span className="font-bold text-[#e6e9ef] truncate">{item.name}</span>
                    </div>
                    <span className="text-[10px] text-[#8b93a1] shrink-0">{timeStr}</span>
                  </div>

                  <div className="text-[11px] text-[#cbd5e1] break-all leading-relaxed whitespace-pre-wrap bg-[#161a21]/60 p-2 rounded-lg border border-[#262c36]/60">
                    {item.detail}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
