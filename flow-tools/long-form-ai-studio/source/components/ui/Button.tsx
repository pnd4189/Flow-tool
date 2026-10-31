import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'amber';
  size?: 'xs' | 'sm' | 'md';
  icon?: string;
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'sm',
  icon,
  loading = false,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const base = 'inline-flex items-center justify-center font-medium rounded transition select-none disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-[#f5b301]/50';

  const sizeStyles = {
    xs: 'h-6 px-2 text-[11px] gap-1',
    sm: 'h-7 px-2.5 text-[12px] gap-1.5',
    md: 'h-8 px-3 text-[13px] gap-2',
  }[size];

  const variantStyles = {
    primary: 'bg-[#f5b301] hover:bg-[#e0a400] text-black font-semibold shadow-sm',
    amber: 'bg-[#f5b301]/15 hover:bg-[#f5b301]/25 text-[#f5b301] border border-[#f5b301]/40',
    secondary: 'bg-[#1b1b20] hover:bg-[#25252d] text-[#ececef] border border-[#26262b]',
    ghost: 'bg-transparent hover:bg-[#1b1b20] text-[#9a9aa3] hover:text-[#ececef]',
    danger: 'bg-[#ef4444]/15 hover:bg-[#ef4444]/25 text-[#ef4444] border border-[#ef4444]/40',
  }[variant];

  return (
    <button
      className={`${base} ${sizeStyles} ${variantStyles} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span>
      ) : icon ? (
        <span className="material-symbols-outlined text-[15px]">{icon}</span>
      ) : null}
      {children}
    </button>
  );
};
