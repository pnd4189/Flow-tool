import React, { useState } from 'react';
import { CharacterConfig, Language } from '../types';
import { buildSheetPrompt } from '../services/promptBuilder';
import { t } from '../services/i18n';

interface PromptModalProps {
  config: CharacterConfig;
  lang: Language;
  isOpen: boolean;
  onClose: () => void;
}

export const PromptModal: React.FC<PromptModalProps> = ({ config, lang, isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const promptText = buildSheetPrompt(config);
  const wordCount = promptText.trim().split(/\s+/).length;
  const charCount = promptText.length;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in-50 duration-200">
      <div className="bg-[#161a21] border border-[#262c36] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal header */}
        <div className="p-4 md:p-5 border-b border-[#262c36] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#7c9cff]/10 text-[#7c9cff] border border-[#7c9cff]/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-base">terminal</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#e6e9ef] leading-tight">
                {t(lang, 'modal_title')}
              </h3>
              <p className="text-[11px] text-[#8b93a1] leading-tight">
                {t(lang, 'modal_subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#8b93a1] hover:text-[#e6e9ef] hover:bg-[#262c36] flex items-center justify-center transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 md:p-5 overflow-y-auto space-y-4 text-xs">
          {/* Notice */}
          <div className="p-3 rounded-xl bg-[#0e1014] border border-[#262c36] text-[11px] text-[#8b93a1] flex items-start gap-2">
            <span className="material-symbols-outlined text-[#7c9cff] text-base shrink-0 mt-0.5">
              info
            </span>
            <span>{t(lang, 'modal_notice')}</span>
          </div>

          {/* Generated prompt box */}
          <div className="relative">
            <textarea
              readOnly
              rows={11}
              value={promptText}
              className="w-full p-3.5 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs font-mono text-[#e6e9ef] leading-relaxed focus:outline-none resize-none select-all"
            />
          </div>

          {/* Meta metrics */}
          <div className="flex items-center justify-between text-[11px] text-[#8b93a1] font-mono px-1">
            <span>
              {wordCount} {t(lang, 'modal_stats_words')} · {charCount}{' '}
              {t(lang, 'modal_stats_chars')}
            </span>
            <span className="text-[#7c9cff]">Mô hình: {config.model}</span>
          </div>
        </div>

        {/* Modal footer */}
        <div className="p-4 border-t border-[#262c36] bg-[#0e1014]/50 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[#8b93a1] hover:text-[#e6e9ef] transition-colors"
          >
            {t(lang, 'modal_close')}
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md active:scale-95 ${
              copied
                ? 'bg-[#4ade80] text-[#0e1014]'
                : 'bg-[#7c9cff] text-[#0e1014] hover:brightness-110'
            }`}
          >
            <span className="material-symbols-outlined text-sm">
              {copied ? 'check' : 'content_copy'}
            </span>
            <span>{copied ? t(lang, 'modal_copied') : t(lang, 'modal_copy')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
