import React, { useRef, useState } from 'react';

interface TopBarProps {
  imageName: string | null;
  imageDimensions: { width: number; height: number } | null;
  onFileSelect: (file: File) => void;
  onOpenSessionSelect: (file: File) => void;
  onSaveSession: () => void;
  onOpenDiagnostics: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onResetToOriginal: () => void;
  isProcessing: boolean;
  canResetToOriginal: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  imageName,
  imageDimensions,
  onFileSelect,
  onOpenSessionSelect,
  onSaveSession,
  onOpenDiagnostics,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onResetToOriginal,
  isProcessing,
  canResetToOriginal,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionInputRef = useRef<HTMLInputElement>(null);

  // Two-click inline reset confirmation
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
      e.target.value = '';
    }
  };

  const handleSessionFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onOpenSessionSelect(e.target.files[0]);
      e.target.value = '';
    }
  };

  const handleResetClick = () => {
    if (!isConfirmingReset) {
      setIsConfirmingReset(true);
      setTimeout(() => setIsConfirmingReset(false), 4000);
    } else {
      setIsConfirmingReset(false);
      onResetToOriginal();
    }
  };

  return (
    <header className="h-11 bg-[#141618] border-b border-[#24282c] px-2.5 flex items-center justify-between select-none shrink-0 z-20 gap-2">
      {/* Left: App Logo & Actions */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="material-symbols-outlined text-[#55c7b0] text-[19px]">photo_camera</span>
          <span className="text-xs font-semibold tracking-wide text-zinc-100 hidden sm:inline">
            Retouch Studio
          </span>
        </div>

        <div className="h-3.5 w-px bg-[#282d33] shrink-0" />

        {/* Hidden File Inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          disabled={isProcessing}
          onChange={handleImageFileChange}
        />
        <input
          ref={sessionInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          disabled={isProcessing}
          onChange={handleSessionFileChange}
        />

        {/* Thêm ảnh button */}
        <button
          type="button"
          disabled={isProcessing}
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-zinc-200 bg-[#1f2327] hover:bg-[#282d33] active:bg-[#1a1d20] disabled:opacity-50 border border-[#2e343b] rounded transition-colors shrink-0"
          title="Thêm ảnh mới từ máy tính (PNG, JPEG, WebP)"
        >
          <span className="material-symbols-outlined text-[15px] text-[#55c7b0]">add_photo_alternate</span>
          <span>Thêm ảnh</span>
        </button>

        {/* Session Actions: Mở phiên & Lưu phiên (small & unobtrusive) */}
        <button
          type="button"
          disabled={isProcessing}
          onClick={() => sessionInputRef.current?.click()}
          className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-zinc-300 hover:text-white bg-[#1a1d20] hover:bg-[#23272b] disabled:opacity-50 border border-[#2b3036] rounded transition-colors shrink-0"
          title="Mở phiên làm việc từ tệp JSON (tạo lịch sử mới)"
        >
          <span className="material-symbols-outlined text-[14px] text-zinc-400">folder_open</span>
          <span className="hidden md:inline">Mở phiên</span>
        </button>

        {imageDimensions && (
          <button
            type="button"
            disabled={isProcessing}
            onClick={onSaveSession}
            className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-[#55c7b0] hover:text-[#7fe0cb] bg-[#172421] hover:bg-[#1e2f2b] disabled:opacity-50 border border-[#55c7b0]/30 rounded transition-colors shrink-0"
            title="Lưu phiên làm việc hiện tại thành tệp JSON (không lưu lịch sử Undo)"
          >
            <span className="material-symbols-outlined text-[14px]">save</span>
            <span className="hidden md:inline">Lưu phiên</span>
          </button>
        )}

        {/* Current Image Details */}
        {imageDimensions && (
          <div className="hidden lg:flex items-center gap-1 text-[11px] font-mono text-zinc-400 bg-[#17191c] px-2 py-0.5 rounded border border-[#26292d] truncate">
            <span className="text-zinc-400 max-w-[110px] truncate" title={imageName || ''}>
              {imageName}
            </span>
            <span className="text-zinc-600">•</span>
            <span className="text-[#55c7b0] shrink-0">
              {imageDimensions.width} × {imageDimensions.height}
            </span>
          </div>
        )}
      </div>

      {/* Center: Hoàn tác & Làm lại & Về ảnh gốc */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          disabled={!canUndo || isProcessing}
          onClick={onUndo}
          className="flex items-center gap-1 px-1.5 py-1 text-zinc-300 hover:text-white disabled:text-zinc-600 rounded transition-colors disabled:cursor-not-allowed hover:bg-[#202328]"
          title="Hoàn tác (Ctrl+Z)"
        >
          <span className="material-symbols-outlined text-[17px]">undo</span>
          <span className="text-[11px] hidden sm:inline">Hoàn tác</span>
        </button>

        <button
          type="button"
          disabled={!canRedo || isProcessing}
          onClick={onRedo}
          className="flex items-center gap-1 px-1.5 py-1 text-zinc-300 hover:text-white disabled:text-zinc-600 rounded transition-colors disabled:cursor-not-allowed hover:bg-[#202328]"
          title="Làm lại (Ctrl+Y hoặc Ctrl+Shift+Z)"
        >
          <span className="material-symbols-outlined text-[17px]">redo</span>
          <span className="text-[11px] hidden sm:inline">Làm lại</span>
        </button>

        {canResetToOriginal && (
          <button
            type="button"
            disabled={isProcessing}
            onClick={handleResetClick}
            className={`flex items-center gap-1 px-1.5 py-1 text-[11px] rounded transition-colors border ${
              isConfirmingReset
                ? 'bg-rose-950/60 border-rose-600/80 text-rose-300 font-semibold'
                : 'text-zinc-400 hover:text-zinc-200 border-transparent hover:border-[#2f353c]'
            }`}
            title="Khôi phục trạng thái về đúng ảnh gốc ban đầu"
          >
            <span className="material-symbols-outlined text-[14px]">
              {isConfirmingReset ? 'warning' : 'restart_alt'}
            </span>
            <span>{isConfirmingReset ? 'Xác nhận về gốc?' : 'Về ảnh gốc'}</span>
          </button>
        )}
      </div>

      {/* Right: Chẩn đoán trigger (Fixed typo: Chẩn đoán) */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onOpenDiagnostics}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-300 hover:text-zinc-100 hover:bg-[#22252a] active:bg-[#191b1e] rounded border border-transparent hover:border-[#30353c] transition-colors"
          title="Mở bảng chẩn đoán kỹ thuật"
        >
          <span className="material-symbols-outlined text-[15px] text-amber-400">bug_report</span>
          <span className="hidden sm:inline">Chẩn đoán</span>
        </button>
      </div>
    </header>
  );
};
