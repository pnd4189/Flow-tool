import React, { useState, useRef } from 'react';
import { ProjectConfig, Character, Scene, Shot } from '../services/types';
import { exportStudioSession, importStudioSession } from '../services/sessionService';

interface SessionCardProps {
  config: ProjectConfig;
  characters: Character[];
  scenes: Scene[];
  shots: Shot[];
  creditBudget: number;
  creditsUsed: number;
  isCalibrated: boolean;
  onRestoreSession: (data: {
    config: ProjectConfig;
    characters: Character[];
    scenes: Scene[];
    shots: Shot[];
    creditBudget: number;
    creditsUsed: number;
    isCalibrated: boolean;
  }) => void;
  onResetStoryboard: () => void;
}

export const SessionCard: React.FC<SessionCardProps> = ({
  config,
  characters,
  scenes,
  shots,
  creditBudget,
  creditsUsed,
  isCalibrated,
  onRestoreSession,
  onResetStoryboard,
}) => {
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // 2-step reset storyboard confirmation
  const [confirmReset, setConfirmReset] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveSession = async () => {
    setSaveState('saving');
    setSaveMsg(null);
    try {
      const filename = await exportStudioSession({
        config,
        characters,
        scenes,
        shots,
        creditBudget,
        creditsUsed,
        isCalibrated,
      });
      setSaveState('saved');
      setSaveMsg(`Đã lưu phiên (${filename})`);
      setTimeout(() => {
        setSaveState('idle');
        setSaveMsg(null);
      }, 4000);
    } catch (err: unknown) {
      setSaveState('error');
      setSaveMsg(err instanceof Error ? err.message : 'Lỗi khi lưu phiên');
      setTimeout(() => {
        setSaveState('idle');
      }, 4000);
    }
  };

  const handleOpenButtonClick = () => {
    setOpenError(null);
    setOpenMsg(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOpenError(null);
    setOpenMsg(null);

    try {
      const text = await file.text();
      const restored = importStudioSession(text);
      onRestoreSession(restored);
      setOpenMsg(
        'Đã khôi phục phiên thành công! (Lưu ý: Video đã render không nằm trong file phiên; ảnh gốc và video vẫn còn trong thư viện Flow).'
      );
      setTimeout(() => {
        setOpenMsg(null);
      }, 7000);
    } catch (err: unknown) {
      setOpenError(err instanceof Error ? err.message : 'Đọc file phiên thất bại.');
    }
  };

  const handleResetClick = () => {
    if (confirmReset) {
      onResetStoryboard();
      setConfirmReset(false);
    } else {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3500);
    }
  };

  return (
    <div className="p-3 bg-[#141414] border-b border-[#595959]/50 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-amber-400 text-base">folder_special</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Lưu / Mở phiên làm việc
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-500">v1.0 JSON</span>
      </div>

      <p className="text-[11px] text-slate-400 leading-tight">
        Lưu toàn bộ kịch bản, DNA nhân vật, keyframe và credit vào máy dưới dạng JSON.
      </p>

      {/* Hidden file input for open session */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={saveState === 'saving'}
          onClick={handleSaveSession}
          className={`py-1.5 px-2 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition border ${
            saveState === 'saved'
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50'
              : saveState === 'error'
              ? 'bg-red-950/80 text-red-300 border-red-500/50'
              : 'bg-[#202020] hover:bg-[#2b2b2b] text-slate-200 border-[#595959]/50'
          }`}
        >
          <span className={`material-symbols-outlined text-[15px] ${saveState === 'saving' ? 'animate-spin' : ''}`}>
            {saveState === 'saving'
              ? 'progress_activity'
              : saveState === 'saved'
              ? 'check_circle'
              : 'save'}
          </span>
          {saveState === 'saving'
            ? 'Đang lưu...'
            : saveState === 'saved'
            ? 'Đã lưu phiên ✓'
            : 'Lưu phiên'}
        </button>

        <button
          type="button"
          onClick={handleOpenButtonClick}
          className="py-1.5 px-2 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
        >
          <span className="material-symbols-outlined text-[15px]">file_open</span>
          Mở phiên
        </button>
      </div>

      {/* Reset storyboard button (keeps vault and credits) */}
      <div className="pt-1 flex items-center justify-between border-t border-[#595959]/20 text-[10px]">
        <span className="text-slate-500 font-mono">Xoá bảng storyboard:</span>
        <button
          type="button"
          onClick={handleResetClick}
          className={`px-2 py-0.5 rounded transition font-mono ${
            confirmReset
              ? 'bg-red-600 text-white font-bold animate-pulse'
              : 'bg-red-950/30 hover:bg-red-900/40 text-red-400 border border-red-500/20'
          }`}
          title="Xoá tất cả scene & shot, giữ nguyên Character Vault và Credit"
        >
          {confirmReset ? 'Xác nhận xoá storyboard!' : 'Tạo mới storyboard'}
        </button>
      </div>

      {/* Notifications */}
      {saveMsg && (
        <div
          className={`p-2 rounded text-[11px] font-mono ${
            saveState === 'error'
              ? 'bg-red-950/60 border border-red-500/40 text-red-300'
              : 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300'
          }`}
        >
          {saveMsg}
        </div>
      )}

      {openMsg && (
        <div className="p-2 rounded bg-emerald-950/70 border border-emerald-500/40 text-emerald-200 text-[11px] font-mono leading-tight space-y-1">
          <div className="flex items-center gap-1 text-emerald-400 font-semibold">
            <span className="material-symbols-outlined text-[14px]">check</span>
            Khôi phục thành công!
          </div>
          <p className="text-[10px] text-slate-300">
            Video đã render không nằm trong file phiên; ảnh gốc và video vẫn còn trong thư viện Flow.
          </p>
        </div>
      )}

      {openError && (
        <div className="p-2 rounded bg-red-950/70 border border-red-500/40 text-red-300 text-[11px] font-mono leading-tight">
          Lỗi mở phiên: {openError}
        </div>
      )}
    </div>
  );
};
