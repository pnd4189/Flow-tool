import React from 'react';
import { ActiveTool } from '../types';

interface LeftToolbarProps {
  activeTool: ActiveTool;
  onSelectTool: (tool: ActiveTool) => void;
  brushRadius: number;
  onChangeBrushRadius: (r: number) => void;
  dilationRadius: number;
  onChangeDilationRadius: (r: number) => void;
  featherRadius: number;
  onChangeFeatherRadius: (r: number) => void;
  showSelectionOverlay: boolean;
  onToggleSelectionOverlay: () => void;
  showProtectionOverlay: boolean;
  onToggleProtectionOverlay: () => void;
  showEditableOverlay: boolean;
  onToggleEditableOverlay: () => void;
  onClearSelection: () => void;
  onInvertSelection: () => void;
  onClearProtection: () => void;
  onFillSmallHoles: () => void;
  hasSelection: boolean;
  hasProtection: boolean;
  isProcessing: boolean;
}

export const LeftToolbar: React.FC<LeftToolbarProps> = ({
  activeTool,
  onSelectTool,
  brushRadius,
  onChangeBrushRadius,
  dilationRadius,
  onChangeDilationRadius,
  featherRadius,
  onChangeFeatherRadius,
  showSelectionOverlay,
  onToggleSelectionOverlay,
  showProtectionOverlay,
  onToggleProtectionOverlay,
  showEditableOverlay,
  onToggleEditableOverlay,
  onClearSelection,
  onInvertSelection,
  onClearProtection,
  onFillSmallHoles,
  hasSelection,
  hasProtection,
  isProcessing,
}) => {
  return (
    <aside
      data-no-canvas-click="true"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="w-13 bg-[#131517] border-r border-[#24282c] flex flex-col items-center py-1.5 select-none shrink-0 z-10 overflow-y-auto"
    >
      <div className="flex flex-col items-center gap-1 w-full px-1">
        {/* Smart Click Selector */}
        <button
          type="button"
          disabled={isProcessing}
          onClick={(e) => {
            e.stopPropagation();
            onSelectTool('smart_select');
          }}
          className={`w-9 h-9 rounded flex flex-col items-center justify-center transition-colors ${
            activeTool === 'smart_select'
              ? 'bg-[#1a332d] text-[#55c7b0] border border-[#55c7b0]/50'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1c2024]'
          }`}
          title="Chọn vùng thông minh: Bấm vào vật thể để tự động tách vùng"
        >
          <span className="material-symbols-outlined text-[19px]">auto_fix_high</span>
          <span className="text-[7.5px] font-mono leading-none mt-0.5">Chọn</span>
        </button>

        <div className="w-5 h-px bg-[#262a30] my-0.5" />

        {/* Selection Brush Add */}
        <button
          type="button"
          disabled={isProcessing}
          onClick={(e) => {
            e.stopPropagation();
            onSelectTool('brush_add');
          }}
          className={`w-9 h-9 rounded flex flex-col items-center justify-center transition-colors ${
            activeTool === 'brush_add'
              ? 'bg-[#1a332d] text-[#55c7b0] border border-[#55c7b0]/50'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1c2024]'
          }`}
          title="Bút thêm vùng chọn (Màu ngọc)"
        >
          <span className="material-symbols-outlined text-[19px]">brush</span>
          <span className="text-[7.5px] font-mono leading-none mt-0.5">+Chọn</span>
        </button>

        {/* Selection Brush Erase */}
        <button
          type="button"
          disabled={isProcessing}
          onClick={(e) => {
            e.stopPropagation();
            onSelectTool('brush_erase');
          }}
          className={`w-9 h-9 rounded flex flex-col items-center justify-center transition-colors ${
            activeTool === 'brush_erase'
              ? 'bg-[#1a332d] text-[#55c7b0] border border-[#55c7b0]/50'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1c2024]'
          }`}
          title="Tẩy bớt vùng chọn"
        >
          <span className="material-symbols-outlined text-[19px]">format_paint</span>
          <span className="text-[7.5px] font-mono leading-none mt-0.5">-Chọn</span>
        </button>

        <div className="w-5 h-px bg-[#262a30] my-0.5" />

        {/* Protection Brush Add */}
        <button
          type="button"
          disabled={isProcessing}
          onClick={(e) => {
            e.stopPropagation();
            onSelectTool('protect_add');
          }}
          className={`w-9 h-9 rounded flex flex-col items-center justify-center transition-colors ${
            activeTool === 'protect_add'
              ? 'bg-[#352712] text-amber-400 border border-amber-500/50'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1c2024]'
          }`}
          title="Bút bảo vệ tuyệt đối: Điểm ảnh bất biến 100% (Màu cam)"
        >
          <span className="material-symbols-outlined text-[19px]">lock</span>
          <span className="text-[7.5px] font-mono leading-none mt-0.5">+B.Vệ</span>
        </button>

        {/* Protection Brush Erase */}
        <button
          type="button"
          disabled={isProcessing}
          onClick={(e) => {
            e.stopPropagation();
            onSelectTool('protect_erase');
          }}
          className={`w-9 h-9 rounded flex flex-col items-center justify-center transition-colors ${
            activeTool === 'protect_erase'
              ? 'bg-[#352712] text-amber-400 border border-amber-500/50'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1c2024]'
          }`}
          title="Tẩy vùng bảo vệ"
        >
          <span className="material-symbols-outlined text-[19px]">lock_open</span>
          <span className="text-[7.5px] font-mono leading-none mt-0.5">-B.Vệ</span>
        </button>
      </div>

      {/* Sliders: Cỡ cọ, Nới viền, Làm mềm */}
      <div className="mt-2 flex flex-col items-center gap-1.5 w-full px-1">
        <div className="flex flex-col items-center" title={`Cỡ cọ: ${brushRadius}px`}>
          <span className="text-[7.5px] font-mono text-zinc-400 leading-none">Cọ {brushRadius}</span>
          <input
            type="range"
            min="3"
            max="120"
            value={brushRadius}
            onChange={(e) => onChangeBrushRadius(Number(e.target.value))}
            className="w-9 h-1 mt-1 accent-[#55c7b0] cursor-pointer"
          />
        </div>

        <div className="flex flex-col items-center" title={`Nới vùng chọn: ${dilationRadius}px`}>
          <div className="flex items-center justify-between w-full px-0.5">
            <span className="text-[7.5px] font-mono text-emerald-400 leading-none font-semibold">
              Nới {dilationRadius}
            </span>
            {dilationRadius !== 3 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChangeDilationRadius(3);
                }}
                className="text-[6.5px] font-mono px-0.5 bg-[#172722] hover:bg-[#203932] text-emerald-300 rounded border border-emerald-500/30"
                title="Đặt nhanh nới 3px (khuyên dùng khi xóa đối tượng)"
              >
                +3px
              </button>
            )}
          </div>
          <input
            type="range"
            min="0"
            max="30"
            value={dilationRadius}
            onChange={(e) => onChangeDilationRadius(Number(e.target.value))}
            className="w-9 h-1 mt-1 accent-emerald-400 cursor-pointer"
          />
        </div>

        <div className="flex flex-col items-center" title={`Mềm viền: ${featherRadius}px`}>
          <span className="text-[7.5px] font-mono text-indigo-400 leading-none">
            Mềm {featherRadius}
          </span>
          <input
            type="range"
            min="0"
            max="20"
            value={featherRadius}
            onChange={(e) => onChangeFeatherRadius(Number(e.target.value))}
            className="w-9 h-1 mt-1 accent-indigo-400 cursor-pointer"
          />
        </div>
      </div>

      {/* Layer Toggles */}
      <div className="mt-2 flex flex-col items-center gap-1 w-full px-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelectionOverlay();
          }}
          className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
            showSelectionOverlay ? 'text-[#55c7b0] bg-[#1a2b25]' : 'text-zinc-600 hover:text-zinc-400'
          }`}
          title={showSelectionOverlay ? 'Ẩn lớp vùng chọn' : 'Hiện lớp vùng chọn'}
        >
          <span className="material-symbols-outlined text-[15px]">
            {showSelectionOverlay ? 'visibility' : 'visibility_off'}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleProtectionOverlay();
          }}
          className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
            showProtectionOverlay ? 'text-amber-400 bg-[#2d2315]' : 'text-zinc-600 hover:text-zinc-400'
          }`}
          title={showProtectionOverlay ? 'Ẩn lớp bảo vệ' : 'Hiện lớp bảo vệ'}
        >
          <span className="material-symbols-outlined text-[15px]">
            {showProtectionOverlay ? 'lock' : 'lock_open'}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleEditableOverlay();
          }}
          className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
            showEditableOverlay ? 'text-pink-400 bg-[#351724]' : 'text-zinc-600 hover:text-zinc-400'
          }`}
          title="Xem vùng sửa thực tế (Chọn trừ Bảo vệ)"
        >
          <span className="material-symbols-outlined text-[15px]">palette</span>
        </button>
      </div>

      {/* Refine and Clear Actions */}
      <div className="mt-auto flex flex-col items-center gap-1 w-full px-1 pt-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onFillSmallHoles();
          }}
          disabled={!hasSelection || isProcessing}
          className="w-9 h-7 rounded flex flex-col items-center justify-center text-zinc-300 hover:text-[#55c7b0] hover:bg-[#1c2024] disabled:text-zinc-700 disabled:hover:bg-transparent"
          title="Lấp lỗ nhỏ bên trong vùng chọn"
        >
          <span className="material-symbols-outlined text-[15px]">format_color_fill</span>
          <span className="text-[7px] font-mono leading-none">Lấp</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onInvertSelection();
          }}
          disabled={!hasSelection || isProcessing}
          className="w-9 h-6 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-[#1c2024] disabled:text-zinc-700"
          title="Đảo ngược vùng chọn"
        >
          <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClearSelection();
          }}
          disabled={!hasSelection || isProcessing}
          className="w-9 h-6 rounded flex items-center justify-center text-zinc-400 hover:text-rose-400 hover:bg-[#1c2024] disabled:text-zinc-700"
          title="Xóa vùng chọn"
        >
          <span className="material-symbols-outlined text-[16px]">layers_clear</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClearProtection();
          }}
          disabled={!hasProtection || isProcessing}
          className="w-9 h-6 rounded flex items-center justify-center text-zinc-400 hover:text-amber-400 hover:bg-[#1c2024] disabled:text-zinc-700"
          title="Xóa vùng bảo vệ"
        >
          <span className="material-symbols-outlined text-[16px]">clear</span>
        </button>
      </div>
    </aside>
  );
};
