import React from 'react';

export type StudioStep = 'cast' | 'script' | 'direct' | 'storyboard' | 'render' | 'export';

export interface StepNavProps {
  currentStep: StudioStep;
  onStepChange: (step: StudioStep) => void;
  isCastReady: boolean;
  isScriptReady: boolean;
  isDirectReady: boolean;
  isStoryboardReady: boolean;
  isRenderReady: boolean;
  isExportReady: boolean;
}

export const StepNav: React.FC<StepNavProps> = ({
  currentStep,
  onStepChange,
  isCastReady,
  isScriptReady,
  isDirectReady,
  isStoryboardReady,
  isRenderReady,
  isExportReady,
}) => {
  const steps: Array<{
    id: StudioStep;
    num: number;
    label: string;
    sub: string;
    ready: boolean;
  }> = [
    { id: 'cast', num: 1, label: 'Nhân vật', sub: 'Cast', ready: isCastReady },
    { id: 'script', num: 2, label: 'Kịch bản', sub: 'Script', ready: isScriptReady },
    { id: 'direct', num: 3, label: 'Đạo diễn', sub: 'Direct', ready: isDirectReady },
    { id: 'storyboard', num: 4, label: 'Storyboard', sub: 'Frames', ready: isStoryboardReady },
    { id: 'render', num: 5, label: 'Render', sub: 'Queue', ready: isRenderReady },
    { id: 'export', num: 6, label: 'Xuất', sub: 'Export', ready: isExportReady },
  ];

  const currentIndex = steps.findIndex((s) => s.id === currentStep);
  const nextStep = steps[currentIndex + 1]?.id;

  return (
    <nav className="h-[36px] bg-[#0e0e11] border-b border-[#26262b] px-3 flex items-center justify-between flex-shrink-0 select-none overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-1 sm:gap-2">
        {steps.map((st) => {
          const isActive = currentStep === st.id;
          return (
            <button
              key={st.id}
              type="button"
              onClick={() => onStepChange(st.id)}
              className={`h-7 px-2 sm:px-2.5 rounded text-[11px] font-medium flex items-center gap-1.5 transition ${
                isActive
                  ? 'bg-[#f5b301]/20 text-[#f5b301] border border-[#f5b301]/50 font-semibold'
                  : 'text-[#9a9aa3] hover:text-[#ececef] hover:bg-[#141417]'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono ${
                  isActive
                    ? 'bg-[#f5b301] text-black font-bold'
                    : st.ready
                    ? 'bg-[#22c55e]/20 text-[#22c55e]'
                    : 'bg-[#1b1b20] text-[#9a9aa3]'
                }`}
              >
                {st.ready && !isActive ? '✓' : st.num}
              </span>
              <span>{st.label}</span>
              <span className="hidden lg:inline opacity-60 text-[10px]">({st.sub})</span>
            </button>
          );
        })}
      </div>

      {nextStep && (
        <button
          type="button"
          onClick={() => onStepChange(nextStep)}
          className="h-7 px-2.5 rounded bg-[#1b1b20] hover:bg-[#25252d] text-[#ececef] hover:text-[#f5b301] border border-[#26262b] text-[11px] font-semibold flex items-center gap-1 transition ml-2 flex-shrink-0"
        >
          <span>Tiếp</span>
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </button>
      )}
    </nav>
  );
};
