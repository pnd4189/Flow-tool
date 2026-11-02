import React, { useState, useEffect } from 'react';
import { GenerationJob, Language } from '../types';
import { t } from '../services/i18n';

interface ProgressPanelProps {
  job: GenerationJob;
  lang: Language;
}

export const ProgressPanel: React.FC<ProgressPanelProps> = ({ job, lang }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000)));
    }, 500);
    return () => clearInterval(interval);
  }, [job.startedAt]);

  const currentItemIndex = Math.min(job.total, job.done + 1);

  let stageLabel = t(lang, 'stage_generating');
  if (job.stage === 'translating') {
    stageLabel = t(lang, 'stage_translating');
  } else if (job.stage === 'uploading') {
    stageLabel = t(lang, 'stage_uploading');
  } else if (job.stage === 'analyzing') {
    stageLabel = t(lang, 'stage_analyzing');
  } else if (job.stage === 'inspecting') {
    stageLabel = t(lang, 'stage_inspecting');
  } else if (job.stage === 'retrying') {
    stageLabel = job.stageDetail || t(lang, 'stage_retrying', { attempt: 1 });
  } else if (job.stage === 'rewriting') {
    stageLabel = job.stageDetail || t(lang, 'stage_rewriting', { round: 1 });
  } else if (job.stageDetail) {
    stageLabel = `${t(lang, 'stage_generating')} (${job.stageDetail})`;
  }

  let progressPercent = 0;
  if (job.stage === 'translating') {
    progressPercent = 10;
  } else if (job.stage === 'uploading') {
    progressPercent = 20;
  } else if (job.stage === 'analyzing') {
    progressPercent = 30;
  } else if (job.stage === 'inspecting') {
    progressPercent = Math.min(95, Math.round(((job.done + 0.85) / job.total) * 100));
  } else {
    progressPercent = Math.min(
      100,
      Math.round(((job.done + 0.35) / job.total) * 100)
    );
  }

  return (
    <div className="p-3.5 bg-[#161a21] border-b border-[#262c36] flex flex-col gap-2 shrink-0">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-[#7c9cff]/20 text-[#7c9cff] flex items-center justify-center animate-spin">
            <span className="material-symbols-outlined text-sm">autorenew</span>
          </div>
          <span className="font-semibold text-[#e6e9ef]">{stageLabel}</span>
          <span className="px-2 py-0.5 rounded-full bg-[#0e1014] text-[10px] font-mono text-[#7c9cff] border border-[#262c36]">
            {currentItemIndex}/{job.total}
          </span>
        </div>

        <span className="font-mono text-[11px] text-[#8b93a1]">
          {t(lang, 'elapsed_time', { sec: elapsed })}
        </span>
      </div>

      {/* Progress track */}
      <div className="w-full bg-[#0e1014] rounded-full h-1.5 overflow-hidden border border-[#262c36]">
        <div
          className="bg-gradient-to-r from-[#7c9cff] to-[#6366f1] h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
};
