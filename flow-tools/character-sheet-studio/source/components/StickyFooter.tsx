import React, { useState, useEffect } from 'react';
import { CharacterConfig, GenerationJob, ImageModel, Language } from '../types';
import { t } from '../services/i18n';
import { MODEL_OPTIONS } from '../constants';

interface StickyFooterProps {
  config: CharacterConfig;
  lang: Language;
  job: GenerationJob | null;
  isRunning: boolean;
  hasFaceImages?: boolean;
  onChange: (patch: Partial<CharacterConfig>) => void;
  onOpenPrompt: () => void;
  onGenerate: () => void;
  onStop: () => void;
}

export const StickyFooter: React.FC<StickyFooterProps> = ({
  config,
  lang,
  job,
  isRunning,
  hasFaceImages = true,
  onChange,
  onOpenPrompt,
  onGenerate,
  onStop,
}) => {
  const [stopConfirm, setStopConfirm] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // When faceSource is 'upload' and there is no face image, primary generation is blocked
  const isFaceUploadMissing = config.faceSource === 'upload' && !hasFaceImages;

  // Timer for elapsed seconds while running
  useEffect(() => {
    if (!isRunning || !job) {
      setElapsed(0);
      setStopConfirm(false);
      return;
    }

    const interval = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000)));
    }, 500);

    return () => clearInterval(interval);
  }, [isRunning, job]);

  // Two-step stop timeout (3 seconds)
  useEffect(() => {
    if (!stopConfirm) return;
    const timer = setTimeout(() => {
      setStopConfirm(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [stopConfirm]);

  const handleStopClick = () => {
    if (stopConfirm) {
      onStop();
      setStopConfirm(false);
    } else {
      setStopConfirm(true);
    }
  };

  const handleCountChange = (delta: number) => {
    const next = Math.max(1, Math.min(4, config.imageCount + delta));
    onChange({ imageCount: next });
  };

  // Estimated generation time per model: Pro ~25s, 2.1 ~23s, Lite ~12s
  const getEstimatedSecPerImage = (model: ImageModel): number => {
    if (model.includes('Lite')) return 12;
    if (model.includes('2.1')) return 23;
    return 25; // Pro
  };

  const estSec = getEstimatedSecPerImage(config.model);

  const subtitleText = t(lang, 'footer_subtitle', {
    aspect: config.aspectRatio,
    model: config.model.replace('🍌 ', ''),
    est: estSec,
  });

  return (
    <div className="sticky bottom-0 bg-[#161a21] border-t border-[#262c36] p-3.5 space-y-2.5 z-20 shadow-xl shadow-black/50">
      {/* Controls row */}
      <div className="flex items-center justify-between gap-2">
        {/* Stepper 1-4 */}
        <div className="flex items-center bg-[#0e1014] rounded-xl border border-[#262c36] p-0.5">
          <button
            type="button"
            onClick={() => handleCountChange(-1)}
            disabled={isRunning || config.imageCount <= 1}
            className="w-7 h-7 flex items-center justify-center text-[#8b93a1] hover:text-[#e6e9ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <span className="material-symbols-outlined text-sm">remove</span>
          </button>
          <span className="w-8 text-center text-xs font-mono font-bold text-[#e6e9ef]">
            {config.imageCount}
          </span>
          <button
            type="button"
            onClick={() => handleCountChange(1)}
            disabled={isRunning || config.imageCount >= 4}
            className="w-7 h-7 flex items-center justify-center text-[#8b93a1] hover:text-[#e6e9ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <span className="material-symbols-outlined text-sm">add</span>
          </button>
        </div>

        {/* Aspect chip */}
        <div className="px-2.5 py-1 rounded-xl bg-[#0e1014] border border-[#262c36] text-xs font-mono text-[#7c9cff] font-semibold">
          {config.aspectRatio}
        </div>

        {/* Model selector */}
        <div className="flex-1 max-w-[170px]">
          <select
            value={config.model}
            disabled={isRunning}
            onChange={(e) => onChange({ model: e.target.value as ImageModel })}
            className="w-full px-2 py-1.5 bg-[#0e1014] border border-[#262c36] rounded-xl text-[11px] text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none truncate disabled:opacity-50"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {/* Quick prompt preview button */}
          <button
            type="button"
            onClick={onOpenPrompt}
            disabled={isRunning}
            className="px-3 py-2.5 rounded-xl bg-[#0e1014] border border-[#262c36] hover:border-[#7c9cff] text-[#e6e9ef] text-xs font-bold flex items-center gap-1.5 transition-all shrink-0 active:scale-95 disabled:opacity-40"
            title={t(lang, 'btn_view_prompt')}
          >
            <span className="material-symbols-outlined text-base text-[#7c9cff]">visibility</span>
            <span>{t(lang, 'btn_view_prompt')}</span>
          </button>

          {/* Primary Action Button or Running Stop Control */}
          {!isRunning ? (
            <div className="relative flex-1">
              <button
                type="button"
                onClick={onGenerate}
                disabled={isFaceUploadMissing}
                className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs flex flex-col items-center justify-center transition-all ${
                  isFaceUploadMissing
                    ? 'bg-[#262c36] text-[#8b93a1] opacity-60 cursor-not-allowed shadow-none'
                    : 'bg-gradient-to-r from-[#7c9cff] to-[#6366f1] text-[#0e1014] shadow-lg shadow-[#7c9cff]/20 hover:brightness-110 active:scale-[0.98]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm font-black">auto_awesome</span>
                  <span>{t(lang, 'btn_generate_sheet')}</span>
                  <span className="text-[10px] font-mono opacity-80">(Ctrl+↵)</span>
                </div>
                <span className="text-[10px] opacity-85 font-normal leading-none mt-0.5">
                  {config.imageCount} {subtitleText}
                </span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              {/* Running status badge */}
              <div className="flex-1 py-2 px-3 rounded-xl bg-[#0e1014] border border-[#7c9cff]/40 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-[#7c9cff] animate-ping" />
                  <span className="font-bold text-[#e6e9ef] truncate">
                    {t(lang, 'generating_status', {
                      done: (job?.done ?? 0) + 1,
                      total: job?.total ?? config.imageCount,
                    })}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-[#7c9cff] ml-2 shrink-0">
                  {elapsed}s
                </span>
              </div>

              {/* Two-step stop button */}
              <button
                type="button"
                onClick={handleStopClick}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1 shrink-0 ${
                  stopConfirm
                    ? 'bg-[#ef4444] text-white shadow-lg shadow-[#ef4444]/30 animate-pulse'
                    : 'bg-[#262c36] text-[#e6e9ef] hover:bg-[#333b47]'
                }`}
              >
                <span className="material-symbols-outlined text-sm">
                  {stopConfirm ? 'warning' : 'stop'}
                </span>
                <span>{stopConfirm ? t(lang, 'btn_stop_confirm') : t(lang, 'btn_stop')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Hint when face image is required under upload mode */}
        {isFaceUploadMissing && (
          <p className="text-[11px] text-[#fbbf24] text-center px-1 animate-in fade-in-50">
            {t(lang, 'footer_face_required_hint')}
          </p>
        )}
      </div>
    </div>
  );
};
