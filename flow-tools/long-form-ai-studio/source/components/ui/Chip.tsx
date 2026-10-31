import React from 'react';

export interface ChipProps {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  onRemove?: () => void;
  className?: string;
}

export const Chip: React.FC<ChipProps> = ({
  active = false,
  onClick,
  children,
  onRemove,
  className = '',
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono transition border ${
        active
          ? 'bg-[#f5b301]/20 text-[#f5b301] border-[#f5b301]/60 font-medium'
          : 'bg-[#1b1b20] text-[#9a9aa3] border-[#26262b] hover:text-[#ececef] hover:border-[#36363f]'
      } ${className}`}
    >
      {children}
      {onRemove && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:text-white ml-0.5"
        >
          <span className="material-symbols-outlined text-[12px]">close</span>
        </span>
      )}
    </button>
  );
};
