import React, { useState } from 'react';
import { ProjectConfig } from '../services/types';
import { getAllModelCosts } from '../services/pricing';

interface CreditEstimatorProps {
  config: ProjectConfig;
  creditBudget: number;
  creditsUsed: number;
  isCalibrated: boolean;
  realShotsCount: number;
  daisyChainActive?: boolean;
  onCalibrate: (newBudget: number) => void;
}

export const CreditEstimator: React.FC<CreditEstimatorProps> = ({
  config,
  creditBudget,
  creditsUsed,
  isCalibrated,
  realShotsCount,
  daisyChainActive = true,
  onCalibrate,
}) => {
  const [inputVal, setInputVal] = useState<string>(creditBudget.toString());

  const currentRemaining = Math.max(0, creditBudget - creditsUsed);

  // When real shots exist in the storyboard, use real shots count instead of slider
  const effectiveShots = realShotsCount > 0 ? realShotsCount : config.targetShots;
  const isUsingRealShots = realShotsCount > 0;

  // Keyframes count: N+1 if daisy-chain on, 2N if off
  const keyframesCount = daisyChainActive ? effectiveShots + 1 : effectiveShots * 2;

  const handleCalibrateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(inputVal, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      onCalibrate(parsed);
    }
  };

  const modelComparisons = getAllModelCosts(
    config.resolution,
    config.durationSeconds,
    effectiveShots
  );

  return (
    <div className="p-3 bg-[#141414] border-b border-[#595959]/50 space-y-3">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-amber-400 text-base">savings</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Credit Estimator
          </span>
        </div>
        {!isCalibrated && (
          <span className="text-[10px] font-mono text-amber-400 bg-amber-950/60 border border-amber-500/30 px-1.5 py-0.5 rounded">
            (chưa hiệu chỉnh)
          </span>
        )}
      </div>

      {/* Baseline Calibration Control */}
      <form onSubmit={handleCalibrateSubmit} className="space-y-1.5 bg-[#0e0e0e] p-2.5 rounded border border-[#595959]/40">
        <div className="flex items-center justify-between text-[11px] text-slate-300">
          <span>Credit còn lại hiện tại:</span>
          <span className="font-mono font-bold text-emerald-400 text-xs">
            {currentRemaining.toLocaleString()}
          </span>
        </div>
        <div className="flex gap-1.5">
          <input
            type="number"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            className="flex-1 bg-[#1c1c1c] border border-[#595959]/60 rounded px-2 py-1 text-white text-xs font-mono focus:border-amber-400 focus:outline-none"
            placeholder="6000"
          />
          <button
            type="submit"
            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs rounded transition flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[13px]">tune</span>
            Hiệu chỉnh
          </button>
        </div>
      </form>

      {/* Model Comparison Table */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] uppercase font-semibold text-slate-400">
          <span>Bảng so sánh theo model</span>
          <span className="font-mono text-amber-300">
            {effectiveShots} {isUsingRealShots ? 'shot thật' : 'shots (mục tiêu)'} ({config.durationSeconds}s)
          </span>
        </div>

        <div className="space-y-1 text-xs">
          {modelComparisons.map((row) => {
            const isSelected = row.model === config.videoModel;
            const remainingAfter = currentRemaining - row.totalCost;
            const isOverBudget = remainingAfter < 0;

            return (
              <div
                key={row.model}
                className={`p-2 rounded border transition text-[11px] ${
                  isSelected
                    ? 'bg-amber-500/10 border-amber-500/60 shadow-sm'
                    : 'bg-[#181818] border-[#595959]/30'
                } ${isOverBudget ? 'bg-red-950/20 border-red-500/40' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {isSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    )}
                    <span className={`font-medium ${isSelected ? 'text-amber-300 font-semibold' : 'text-slate-200'}`}>
                      {row.model}
                    </span>
                  </div>
                  <span className="font-mono text-slate-400 text-[10px]">
                    {row.perShot} cr/shot
                  </span>
                </div>

                <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
                  <span className="text-slate-400">
                    Tổng: <b className="text-slate-200">{row.totalCost} cr</b>
                  </span>
                  {isOverBudget ? (
                    <span className="text-red-400 font-bold bg-red-950/70 px-1 py-0.5 rounded border border-red-500/30">
                      vượt ngân sách ({remainingAfter})
                    </span>
                  ) : (
                    <span className="text-emerald-400">
                      còn lại: {remainingAfter.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pha 3: Keyframe 0 credit info banner */}
        <div className="p-1.5 bg-[#0e0e0e] rounded border border-emerald-500/30 flex items-center justify-between text-[10px] font-mono text-slate-300">
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="material-symbols-outlined text-[13px]">image</span>
            {keyframesCount} keyframe
          </span>
          <span className="text-emerald-400 font-bold bg-emerald-950/70 px-1.5 py-0.2 rounded border border-emerald-500/20">
            0 credit
          </span>
        </div>
      </div>

      {/* Benchmark Note */}
      <p className="text-[10px] text-slate-500 italic leading-tight">
        * Giá Ultra, đo 2026-10-29; Google có thể đổi.
      </p>
    </div>
  );
};
