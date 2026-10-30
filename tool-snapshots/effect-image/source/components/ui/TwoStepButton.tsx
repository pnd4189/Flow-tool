import React, { useState, useEffect } from 'react';

interface TwoStepButtonProps {
  initialLabel: string;
  confirmLabel?: string;
  icon?: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: 'danger' | 'primary' | 'secondary';
  className?: string;
}

export const TwoStepButton: React.FC<TwoStepButtonProps> = ({
  initialLabel,
  confirmLabel = 'Nhấn lần nữa để xác nhận (3s)',
  icon,
  onConfirm,
  disabled = false,
  variant = 'secondary',
  className = '',
}) => {
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!isConfirming) return;
    const timer = setTimeout(() => {
      setIsConfirming(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [isConfirming]);

  const handleClick = () => {
    if (disabled) return;
    if (isConfirming) {
      setIsConfirming(false);
      onConfirm();
    } else {
      setIsConfirming(true);
    }
  };

  const baseStyle =
    'relative inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all select-none active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none';

  let colorStyle = 'bg-[#1a1a20] text-zinc-300 border border-[#2b2b34] hover:bg-[#22222a]';
  if (variant === 'danger' && !isConfirming) {
    colorStyle = 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20';
  } else if (variant === 'primary' && !isConfirming) {
    colorStyle = 'bg-[#f5b301] text-black font-semibold hover:bg-[#ffbe1a] shadow-sm';
  }

  if (isConfirming) {
    colorStyle = 'bg-amber-500 text-black font-bold animate-pulse shadow-md';
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`${baseStyle} ${colorStyle} ${className}`}
    >
      {icon && (
        <span className="material-symbols-outlined text-[16px]">
          {isConfirming ? 'warning' : icon}
        </span>
      )}
      <span>{isConfirming ? confirmLabel : initialLabel}</span>
    </button>
  );
};
