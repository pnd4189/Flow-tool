import React, { useState, useRef } from 'react';
import { AspectRatio, Scene } from '../types';
import { splitScriptWithAI } from '../services/storyboard';
import { PillButton } from './Primitives';

interface ScriptSplitterProps {
  defaultAspectRatio: AspectRatio;
  onApplyScenes: (newScenes: Scene[], mode: 'replace' | 'append') => void;
  disabled?: boolean;
}

const SCENE_COUNT_OPTIONS: Array<{ label: string; value: number | 'auto' }> = [
  { label: 'Tự động', value: 'auto' },
  { label: '3 cảnh', value: 3 },
  { label: '5 cảnh', value: 5 },
  { label: '8 cảnh', value: 8 },
  { label: '10 cảnh', value: 10 },
  { label: '15 cảnh', value: 15 },
  { label: '20 cảnh', value: 20 },
  { label: '30 cảnh', value: 30 },
];

export const ScriptSplitter: React.FC<ScriptSplitterProps> = ({
  defaultAspectRatio,
  onApplyScenes,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [scriptText, setScriptText] = useState('');
  const [sceneCount, setSceneCount] = useState<number | 'auto'>('auto');
  const [styleNote, setStyleNote] = useState('');
  const [applyMode, setApplyMode] = useState<'append' | 'replace'>('append');

  // Trạng thái chạy AI
  const [isRunning, setIsRunning] = useState(false);
  const [progressText, setProgressText] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const abortSignalRef = useRef<{ aborted: boolean }>({ aborted: false });

  const handleRunSplit = async () => {
    if (!scriptText.trim()) {
      setErrorMsg('Vui lòng nhập nội dung kịch bản hoặc câu chuyện.');
      return;
    }

    setErrorMsg(null);
    setSuccessNotice(null);
    setIsRunning(true);
    setProgressText('Đang phân tích kịch bản...');
    abortSignalRef.current = { aborted: false };

    try {
      const items = await splitScriptWithAI({
        script: scriptText,
        sceneCountTarget: sceneCount,
        styleNote,
        onProgress: (current, total) => {
          if (total > 1) {
            setProgressText(`Đang chia phần ${current}/${total}...`);
          } else {
            setProgressText('Đang chia kịch bản bằng AI...');
          }
        },
        signal: abortSignalRef.current,
      });

      const newScenes: Scene[] = items.map(item => ({
        id: crypto.randomUUID(),
        title: item.title,
        prompt: item.imagePrompt,
        aspectRatio: defaultAspectRatio,
        motionPrompt: item.motionPrompt || undefined,
        status: 'pending',
      }));

      onApplyScenes(newScenes, applyMode);
      setSuccessNotice(`Đã tạo ${newScenes.length} cảnh thành công!`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Có lỗi xảy ra khi chia kịch bản.');
    } finally {
      setIsRunning(false);
      setProgressText('');
    }
  };

  const handleCancel = () => {
    abortSignalRef.current.aborted = true;
    setIsRunning(false);
    setProgressText('');
    setErrorMsg('Đã huỷ chia kịch bản.');
  };

  return (
    <div className="bg-[#141414] border border-[#595959] rounded-2xl overflow-hidden transition-all shadow-md">
      {/* Header bar có thể thu gọn */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-[#181818] hover:bg-[#1f1f1f] text-left transition-colors select-none focus:outline-none"
      >
        <div className="flex items-center gap-2.5">
          <span className="material-symbols-outlined text-amber-400 text-xl">auto_stories</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-white">
            Tự chia kịch bản (AI)
          </span>
          <span className="text-[10px] text-white/40 font-mono hidden sm:inline">
            Flow.generate.text
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="text-[11px] text-amber-300 font-mono flex items-center gap-1.5 animate-pulse">
              <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              <span>{progressText}</span>
            </span>
          )}
          <span className={`material-symbols-outlined text-white/50 text-xl transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
            expand_more
          </span>
        </div>
      </button>

      {/* Nội dung khi mở rộng */}
      {isOpen && (
        <div className="p-4 flex flex-col gap-4 border-t border-white/5 animate-in fade-in slide-in-from-top-1">
          {/* Thông báo thành công */}
          {successNotice && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base">check_circle</span>
                <span>{successNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setSuccessNotice(null)}
                className="opacity-60 hover:opacity-100"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}

          {/* Thông báo lỗi thật */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-base text-red-400 flex-shrink-0">error</span>
                <span className="break-words font-mono text-[11px]">{errorMsg}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleRunSplit}
                  disabled={isRunning || disabled}
                  className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-[10px] font-medium transition-colors"
                >
                  Thử lại
                </button>
                <button
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  className="opacity-60 hover:opacity-100 p-0.5"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
            </div>
          )}

          {/* Ô nhập Kịch bản / câu chuyện tự do */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-white/70 flex items-center justify-between">
              <span>Kịch bản / câu chuyện tự do:</span>
              <span className="text-[10px] text-white/40 font-mono">
                {scriptText.length > 0 ? `${scriptText.length} ký tự` : ''}
              </span>
            </label>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              disabled={isRunning || disabled}
              placeholder="Dán câu chuyện, kịch bản phân cảnh, hoặc dàn ý của bạn vào đây. AI sẽ tự đọc hiểu nội dung, phân tích diễn biến và tách thành từng cảnh nhất quán nhân vật..."
              className="w-full h-32 bg-[#1a1a1a] border border-[#595959] rounded-xl p-3 text-xs text-white/90 font-mono leading-relaxed focus:outline-none focus:border-white transition-colors resize-y placeholder:opacity-30 disabled:opacity-50"
            />
          </div>

          {/* Cấu hình hàng ngang: Số cảnh, Ghi chú phong cách */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Số cảnh dropdown */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-white/70">
                Số cảnh:
              </label>
              <select
                value={String(sceneCount)}
                onChange={(e) => {
                  const val = e.target.value;
                  setSceneCount(val === 'auto' ? 'auto' : Number(val));
                }}
                disabled={isRunning || disabled}
                className="bg-[#1f1f1f] border border-[#595959] hover:border-[#888] focus:border-white rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition-colors disabled:opacity-50"
              >
                {SCENE_COUNT_OPTIONS.map(opt => (
                  <option key={String(opt.value)} value={String(opt.value)}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Ghi chú phong cách hình ảnh */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-white/70">
                Ghi chú phong cách hình ảnh (tuỳ chọn):
              </label>
              <input
                type="text"
                value={styleNote}
                onChange={(e) => setStyleNote(e.target.value)}
                disabled={isRunning || disabled}
                placeholder="Ví dụ: Pixar 3D, màu ấm, điện ảnh 35mm..."
                className="bg-[#1f1f1f] border border-[#595959] hover:border-[#888] focus:border-white rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition-colors placeholder:opacity-30 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Tuỳ chọn Thay thế / Thêm vào cuối */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-4 text-xs select-none">
              <span className="text-white/60 text-[11px]">Chế độ áp dụng:</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="applyMode"
                  value="append"
                  checked={applyMode === 'append'}
                  onChange={() => setApplyMode('append')}
                  disabled={isRunning || disabled}
                  className="accent-white cursor-pointer"
                />
                <span className={applyMode === 'append' ? 'text-white font-medium' : 'text-white/60'}>
                  Thêm vào cuối
                </span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="applyMode"
                  value="replace"
                  checked={applyMode === 'replace'}
                  onChange={() => setApplyMode('replace')}
                  disabled={isRunning || disabled}
                  className="accent-white cursor-pointer"
                />
                <span className={applyMode === 'replace' ? 'text-white font-medium' : 'text-white/60'}>
                  Thay thế danh sách scene
                </span>
              </label>
            </div>

            {/* Nút hành động */}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              {isRunning ? (
                <PillButton
                  variant="danger"
                  icon={<span className="material-symbols-outlined text-[18px]">cancel</span>}
                  onClick={handleCancel}
                >
                  Huỷ bỏ
                </PillButton>
              ) : (
                <PillButton
                  variant="solid"
                  icon={<span className="material-symbols-outlined text-[18px]">auto_fix_high</span>}
                  onClick={handleRunSplit}
                  disabled={disabled || !scriptText.trim()}
                >
                  Chia kịch bản bằng AI
                </PillButton>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
