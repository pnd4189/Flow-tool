import React from 'react';

export interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom';
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'bottom' }) => {
  const posClass =
    position === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-1.5'
      : 'top-full left-1/2 -translate-x-1/2 mt-1.5';

  return (
    <div className="relative group inline-flex">
      {children}
      <div
        className={`absolute ${posClass} pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 whitespace-nowrap px-2 py-0.5 rounded bg-[#1b1b20] border border-[#26262b] text-[#ececef] text-[10px] font-mono shadow-lg`}
      >
        {content}
      </div>
    </div>
  );
};
