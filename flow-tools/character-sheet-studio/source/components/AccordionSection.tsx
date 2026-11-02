import React from 'react';

interface AccordionSectionProps {
  id: string;
  sectionNumber: number;
  title: string;
  subtitle: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export const AccordionSection: React.FC<AccordionSectionProps> = ({
  id,
  sectionNumber,
  title,
  subtitle,
  isOpen,
  onToggle,
  children,
}) => {
  return (
    <div
      id={id}
      className={`border-b border-[#262c36] transition-colors ${
        isOpen ? 'bg-[#161a21]/40' : 'bg-transparent hover:bg-[#161a21]/20'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between text-left focus:outline-none focus:ring-1 focus:ring-[#7c9cff]/30 select-none"
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold font-mono transition-colors ${
              isOpen
                ? 'bg-[#7c9cff] text-[#0e1014]'
                : 'bg-[#262c36] text-[#8b93a1]'
            }`}
          >
            {sectionNumber}
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#e6e9ef] leading-snug">{title}</h2>
            <p className="text-[11px] text-[#8b93a1] leading-tight">{subtitle}</p>
          </div>
        </div>

        <span
          className={`material-symbols-outlined text-[#8b93a1] transition-transform duration-200 text-lg ${
            isOpen ? 'rotate-180 text-[#7c9cff]' : ''
          }`}
        >
          expand_more
        </span>
      </button>

      {isOpen && (
        <div className="px-4 pb-5 pt-1 space-y-4 animate-in fade-in-50 duration-150">
          {children}
        </div>
      )}
    </div>
  );
};
