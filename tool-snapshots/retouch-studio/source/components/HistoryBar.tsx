import React from 'react';
import { EditHistoryItem } from '../types';

interface HistoryBarProps {
  history: EditHistoryItem[];
  currentIndex: number;
  onRestoreHistory: (index: number) => void;
  totalStorageBytes: number;
}

export const HistoryBar: React.FC<HistoryBarProps> = ({
  history,
  currentIndex,
  onRestoreHistory,
  totalStorageBytes,
}) => {
  if (history.length === 0) return null;

  const storageMb = (totalStorageBytes / (1024 * 1024)).toFixed(1);

  return (
    <footer className="h-16 bg-[#121416] border-t border-[#23262a] px-3 flex items-center gap-3 select-none shrink-0 z-10 overflow-x-auto text-xs">
      <div className="flex items-center gap-1.5 text-zinc-400 shrink-0 font-medium">
        <span className="material-symbols-outlined text-[16px] text-[#55c7b0]">history</span>
        <span>Lịch sử ({history.length}):</span>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto py-1">
        {history.map((item, idx) => {
          const isActive = idx === currentIndex;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onRestoreHistory(idx)}
              className={`flex items-center gap-2 px-2 py-1 rounded border transition-all shrink-0 ${
                isActive
                  ? 'bg-[#1b2522] border-[#55c7b0] text-[#55c7b0] shadow-sm'
                  : 'bg-[#181a1d] border-[#292d33] text-zinc-400 hover:text-zinc-200 hover:bg-[#202328]'
              }`}
            >
              {item.thumbnailUrl && (
                <img
                  src={item.thumbnailUrl}
                  alt={item.name}
                  className="w-7 h-7 object-cover rounded border border-[#2b3036]"
                />
              )}
              <div className="flex flex-col text-left leading-tight">
                <span className="font-medium text-[11px] truncate max-w-[100px]">{item.name}</span>
                <span className="text-[9px] font-mono opacity-60">
                  {new Date(item.timestamp).toLocaleTimeString('vi-VN', {
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="ml-auto text-[10px] font-mono text-zinc-500 shrink-0">
        Bộ nhớ: {storageMb} MB / 200 MB
      </div>
    </footer>
  );
};
