import React from 'react';

export interface BadgeProps {
  variant?: 'amber' | 'green' | 'red' | 'blue' | 'yellow' | 'neutral';
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  children,
  dot = false,
  className = '',
}) => {
  const styles = {
    amber: 'bg-[#f5b301]/15 text-[#f5b301] border-[#f5b301]/30',
    green: 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30',
    red: 'bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/30',
    blue: 'bg-[#60a5fa]/15 text-[#60a5fa] border-[#60a5fa]/30',
    yellow: 'bg-[#eab308]/15 text-[#eab308] border-[#eab308]/30',
    neutral: 'bg-[#1b1b20] text-[#9a9aa3] border-[#26262b]',
  }[variant];

  const dotColors = {
    amber: 'bg-[#f5b301]',
    green: 'bg-[#22c55e]',
    red: 'bg-[#ef4444]',
    blue: 'bg-[#60a5fa]',
    yellow: 'bg-[#eab308]',
    neutral: 'bg-[#9a9aa3]',
  }[variant];

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${styles} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors}`} />}
      {children}
    </span>
  );
};
