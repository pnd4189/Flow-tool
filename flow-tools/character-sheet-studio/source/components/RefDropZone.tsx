import React, { useRef, useState } from 'react';
import { Language, RefImage, RefKind } from '../types';
import { t } from '../services/i18n';

interface RefDropZoneProps {
  kind: RefKind;
  items: RefImage[];
  max: number;
  lang: Language;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  onLibrary: () => void;
  onRemove: (id: string) => void;
}

export const RefDropZone: React.FC<RefDropZoneProps> = ({
  kind,
  items,
  max,
  lang,
  disabled = false,
  onFiles,
  onLibrary,
  onRemove,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const atLimit = items.length >= max;
  const isInactive = disabled || atLimit;

  const handleBoxClick = () => {
    if (isInactive) return;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      onFiles(filesArray);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isInactive) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (isInactive) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files);
      onFiles(filesArray);
    }
  };

  const promptTextKey =
    kind === 'face' ? 'dropzone_prompt_face' : 'dropzone_prompt_outfit';

  return (
    <div className="space-y-2.5">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Dashed drop area */}
      <div
        onClick={handleBoxClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`p-3.5 rounded-xl border-2 border-dashed text-center transition-all select-none ${
          isInactive
            ? 'border-[#262c36] bg-[#0e1014]/50 opacity-60 cursor-not-allowed'
            : isDragOver
            ? 'border-[#7c9cff] bg-[#7c9cff]/10 scale-[1.01] cursor-pointer'
            : 'border-[#262c36] bg-[#0e1014] hover:border-[#7c9cff]/60 hover:bg-[#161a21]/50 cursor-pointer'
        }`}
      >
        <div className="flex flex-col items-center justify-center gap-1.5 pointer-events-none">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              isDragOver
                ? 'bg-[#7c9cff] text-[#0e1014]'
                : 'bg-[#161a21] text-[#7c9cff] border border-[#262c36]'
            }`}
          >
            <span className="material-symbols-outlined text-base">
              {kind === 'face' ? 'face' : 'checkroom'}
            </span>
          </div>

          <p className="text-xs font-semibold text-[#e6e9ef] leading-tight px-2">
            {atLimit ? t(lang, 'dropzone_limit_reached') : t(lang, promptTextKey)}
          </p>

          <span className="text-[10px] text-[#8b93a1]">
            {t(lang, 'dropzone_formats_hint')}
          </span>
        </div>
      </div>

      {/* Secondary library button & Counter row */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onLibrary}
          disabled={isInactive}
          className="px-3 py-1.5 rounded-lg bg-[#161a21] border border-[#262c36] text-[#e6e9ef] text-xs font-semibold hover:border-[#7c9cff]/60 hover:text-[#7c9cff] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 active:scale-95"
        >
          <span className="material-symbols-outlined text-sm text-[#7c9cff]">perm_media</span>
          <span>{t(lang, 'btn_select_from_library')}</span>
        </button>

        {/* Counter n/max */}
        <span className="text-xs font-mono font-bold text-[#8b93a1] bg-[#0e1014] px-2 py-0.5 rounded-md border border-[#262c36]">
          <span className={items.length > 0 ? 'text-[#7c9cff]' : 'text-[#8b93a1]'}>
            {items.length}
          </span>
          /{max}
        </span>
      </div>

      {/* Thumbnail Grid (72px squares) */}
      {items.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {items.map((item, idx) => {
            // Status dot color mapping:
            // grey = not uploaded yet (mediaId null, status ready)
            // amber = uploading
            // green = uploaded (mediaId present)
            // red = error
            let dotBg = 'bg-[#8b93a1]';
            let dotTitleKey = 'status_dot_ready';

            if (item.status === 'uploading') {
              dotBg = 'bg-[#f59e0b] animate-ping';
              dotTitleKey = 'status_dot_uploading';
            } else if (item.status === 'error') {
              dotBg = 'bg-[#ef4444]';
              dotTitleKey = 'status_dot_error';
            } else if (item.mediaId) {
              dotBg = 'bg-[#22c55e]';
              dotTitleKey = 'status_dot_uploaded';
            }

            return (
              <div
                key={item.id}
                className="relative w-[72px] h-[72px] rounded-xl overflow-hidden border border-[#262c36] bg-[#0e1014] group shadow-sm shrink-0"
              >
                <img
                  src={item.thumb}
                  alt={item.name || `ref-${idx}`}
                  className="w-full h-full object-cover"
                />

                {/* Status Dot */}
                <div
                  className="absolute top-1 left-1 flex items-center justify-center"
                  title={t(lang, dotTitleKey)}
                >
                  <span className={`w-2 h-2 rounded-full ${dotBg} shadow-sm ring-1 ring-black/50`} />
                </div>

                {/* Remove button (X) */}
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/75 hover:bg-[#ef4444] text-white flex items-center justify-center transition-colors shadow-sm"
                  title={t(lang, 'btn_remove_ref')}
                >
                  <span className="material-symbols-outlined text-xs leading-none">close</span>
                </button>

                {/* Image index tag */}
                <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5 text-[9px] font-mono text-[#8b93a1] text-center truncate">
                  #{idx + 1}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legal & copyright note */}
      <p className="text-[10px] text-[#8b93a1] leading-tight">
        {t(lang, 'dropzone_legal_note')}
      </p>
    </div>
  );
};
