import React from 'react';

interface BadgeProps {
  status: 'idle' | 'running' | 'success' | 'error';
  label?: string;
  durationMs?: number;
}

export const Badge: React.FC<BadgeProps> = ({ status, label, durationMs }) => {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
        Đang chạy...
      </span>
    );
  }

  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        <span className="material-symbols-outlined text-[13px]">check_circle</span>
        {label || 'OK'}
        {durationMs !== undefined && <span className="opacity-75">({durationMs}ms)</span>}
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30">
        <span className="material-symbols-outlined text-[13px]">cancel</span>
        {label || 'LỖI'}
        {durationMs !== undefined && <span className="opacity-75">({durationMs}ms)</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-[#1e1e24] text-zinc-400 border border-[#2d2d35]">
      Chưa chạy
    </span>
  );
};
