import React, { useRef } from 'react';
import { Language } from '../types';
import { t } from '../services/i18n';

interface HeaderProps {
  lang: Language;
  onToggleLang: (lang: Language) => void;
  onOpenDiagnostics: () => void;
  onSaveSession: () => void;
  onOpenSessionFile: (file: File) => void;
  onDownloadPack: () => void;
  isDownloadingPack?: boolean;
  tag: string;
}

export const Header: React.FC<HeaderProps> = ({
  lang,
  onToggleLang,
  onOpenDiagnostics,
  onSaveSession,
  onOpenSessionFile,
  onDownloadPack,
  isDownloadingPack = false,
  tag,
}) => {
  const sessionFileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenClick = () => {
    if (sessionFileInputRef.current) {
      sessionFileInputRef.current.value = '';
      sessionFileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onOpenSessionFile(e.target.files[0]);
    }
  };

  return (
    <header className="h-16 px-4 md:px-6 bg-[#161a21] border-b border-[#262c36] flex items-center justify-between shrink-0 select-none z-20">
      {/* Hidden session file picker */}
      <input
        ref={sessionFileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex items-center gap-3">
        {/* Logo badge */}
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7c9cff] to-[#4f46e5] flex items-center justify-center font-black text-white text-sm tracking-wider shadow-md shadow-[#7c9cff]/20 border border-[#7c9cff]/30">
          CS
        </div>

        {/* Title and subtitle */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-base md:text-lg font-bold text-[#e6e9ef] tracking-tight leading-tight">
              {t(lang, 'app_title')}
            </h1>
            <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#7c9cff]/10 text-[#7c9cff] border border-[#7c9cff]/20">
              Studio v1.0
            </span>
          </div>
          <span className="text-[11px] text-[#8b93a1] leading-none hidden sm:block">
            {t(lang, 'app_subtitle')}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Sanitized character tag chip */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#0e1014] border border-[#262c36] text-xs font-mono text-[#7c9cff]">
          <span className="text-[#8b93a1]">@</span>
          <span className="font-semibold">{tag || 'character'}</span>
        </div>

        {/* Lưu phiên (Save session) */}
        <button
          type="button"
          onClick={onSaveSession}
          className="w-8 h-8 rounded-xl bg-[#0e1014] border border-[#262c36] hover:border-[#7c9cff] text-[#8b93a1] hover:text-[#7c9cff] flex items-center justify-center transition-colors"
          title={t(lang, 'tooltip_save_session')}
        >
          <span className="material-symbols-outlined text-sm">save</span>
        </button>

        {/* Mở phiên (Open session) */}
        <button
          type="button"
          onClick={handleOpenClick}
          className="w-8 h-8 rounded-xl bg-[#0e1014] border border-[#262c36] hover:border-[#7c9cff] text-[#8b93a1] hover:text-[#7c9cff] flex items-center justify-center transition-colors"
          title={t(lang, 'tooltip_open_session')}
        >
          <span className="material-symbols-outlined text-sm">folder_open</span>
        </button>

        {/* Gói nhân vật (Character pack) */}
        <button
          type="button"
          onClick={onDownloadPack}
          disabled={isDownloadingPack}
          className={`w-8 h-8 rounded-xl bg-[#0e1014] border transition-colors flex items-center justify-center ${
            isDownloadingPack
              ? 'border-[#7c9cff] text-[#7c9cff] cursor-wait'
              : 'border-[#262c36] hover:border-[#7c9cff] text-[#8b93a1] hover:text-[#7c9cff]'
          }`}
          title={t(lang, 'tooltip_character_pack')}
        >
          <span className={`material-symbols-outlined text-sm ${isDownloadingPack ? 'animate-spin' : ''}`}>
            {isDownloadingPack ? 'sync' : 'description'}
          </span>
        </button>

        {/* Diagnostics button */}
        <button
          type="button"
          onClick={onOpenDiagnostics}
          className="w-8 h-8 rounded-xl bg-[#0e1014] border border-[#262c36] hover:border-[#7c9cff] text-[#8b93a1] hover:text-[#7c9cff] flex items-center justify-center transition-colors"
          title={t(lang, 'tooltip_diagnostics')}
        >
          <span className="material-symbols-outlined text-sm">bug_report</span>
        </button>

        {/* Bilingual VI | EN toggle */}
        <div className="flex items-center bg-[#0e1014] p-0.5 rounded-xl border border-[#262c36]">
          <button
            type="button"
            onClick={() => onToggleLang('vi')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
              lang === 'vi'
                ? 'bg-[#7c9cff] text-[#0e1014] shadow-sm'
                : 'text-[#8b93a1] hover:text-[#e6e9ef]'
            }`}
          >
            {t(lang, 'lang_vi')}
          </button>
          <button
            type="button"
            onClick={() => onToggleLang('en')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
              lang === 'en'
                ? 'bg-[#7c9cff] text-[#0e1014] shadow-sm'
                : 'text-[#8b93a1] hover:text-[#e6e9ef]'
            }`}
          >
            {t(lang, 'lang_en')}
          </button>
        </div>
      </div>
    </header>
  );
};
