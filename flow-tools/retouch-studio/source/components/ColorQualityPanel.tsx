import React from 'react';
import { ColorAdjustmentParams } from '../types';
import { DEFAULT_COLOR_PARAMS, hasActiveAdjustments } from '../services/colorQualityService';

interface ColorQualityPanelProps {
  params: ColorAdjustmentParams;
  onChangeParams: (newParams: ColorAdjustmentParams) => void;
  onResetParams: () => void;
  hasSelection: boolean;
  isProcessing: boolean;
  onApply: () => void;
  onCancel: () => void;
  isPreviewActive: boolean;
}

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (val: number) => void;
  disabled?: boolean;
}

const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  min,
  max,
  unit = '',
  onChange,
  disabled = false,
}) => {
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 font-medium">{label}</span>
        <div className="flex items-center gap-1">
          <span
            className={`font-mono text-[10px] ${
              value !== 0 ? 'text-[#55c7b0] font-bold' : 'text-zinc-500'
            }`}
          >
            {value > 0 && min < 0 ? `+${value}` : value}
            {unit}
          </span>
          {value !== 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(0)}
              className="text-zinc-500 hover:text-zinc-300 text-[10px]"
              title="Đặt lại về 0"
            >
              <span className="material-symbols-outlined text-[12px]">refresh</span>
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-[#252a30] rounded-lg appearance-none cursor-pointer accent-[#55c7b0] disabled:opacity-50"
      />
    </div>
  );
};

export const ColorQualityPanel: React.FC<ColorQualityPanelProps> = ({
  params,
  onChangeParams,
  onResetParams,
  hasSelection,
  isProcessing,
  onApply,
  onCancel,
  isPreviewActive,
}) => {
  const isDirty = hasActiveAdjustments(params);

  const updateParam = (key: keyof ColorAdjustmentParams, value: number) => {
    onChangeParams({
      ...params,
      [key]: value,
    });
  };

  return (
    <div className="space-y-4">
      {/* Scope notice: selection or full image */}
      <div className="bg-[#181c20] p-2.5 rounded border border-[#282d33] flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[#55c7b0] text-[16px]">
            {hasSelection ? 'select_all' : 'fullscreen'}
          </span>
          <div className="flex flex-col">
            <span className="text-zinc-400">Phạm vi tác động:</span>
            <span className="font-semibold text-zinc-200">
              {hasSelection ? 'Vùng đang chọn (trừ bảo vệ)' : 'Toàn bộ bức ảnh (trừ bảo vệ)'}
            </span>
          </div>
        </div>
        {isDirty && (
          <button
            type="button"
            onClick={onResetParams}
            disabled={isProcessing}
            className="px-2 py-0.5 bg-[#20252a] hover:bg-[#282f36] text-zinc-400 hover:text-zinc-200 rounded text-[10px] border border-[#2b333c]"
          >
            Đặt lại
          </button>
        )}
      </div>

      {/* Tone & Exposure Section */}
      <div className="bg-[#191c20] p-3 rounded border border-[#272b31] space-y-3">
        <div className="flex items-center justify-between border-b border-[#25282c] pb-1.5">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-amber-400">wb_sunny</span>
            <span>Ánh sáng & Phơi sáng</span>
          </span>
          <span className="text-[10px] font-mono text-zinc-500">Pixel Tone</span>
        </div>

        <SliderControl
          label="Độ sáng (Brightness)"
          value={params.brightness}
          min={-100}
          max={100}
          onChange={(v) => updateParam('brightness', v)}
          disabled={isProcessing}
        />

        <SliderControl
          label="Phơi sáng (Exposure)"
          value={params.exposure}
          min={-100}
          max={100}
          onChange={(v) => updateParam('exposure', v)}
          disabled={isProcessing}
        />

        <SliderControl
          label="Độ tương phản (Contrast)"
          value={params.contrast}
          min={-100}
          max={100}
          onChange={(v) => updateParam('contrast', v)}
          disabled={isProcessing}
        />

        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#23272d]">
          <SliderControl
            label="Vùng sáng (Highlights)"
            value={params.highlights}
            min={-100}
            max={100}
            onChange={(v) => updateParam('highlights', v)}
            disabled={isProcessing}
          />
          <SliderControl
            label="Vùng tối (Shadows)"
            value={params.shadows}
            min={-100}
            max={100}
            onChange={(v) => updateParam('shadows', v)}
            disabled={isProcessing}
          />
        </div>
      </div>

      {/* Color Balance & Saturation */}
      <div className="bg-[#191c20] p-3 rounded border border-[#272b31] space-y-3">
        <div className="flex items-center justify-between border-b border-[#25282c] pb-1.5">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-rose-400">palette</span>
            <span>Màu sắc & Cân bằng trắng</span>
          </span>
          <span className="text-[10px] font-mono text-zinc-500">Color Balance</span>
        </div>

        <SliderControl
          label="Độ bão hòa (Saturation)"
          value={params.saturation}
          min={-100}
          max={100}
          onChange={(v) => updateParam('saturation', v)}
          disabled={isProcessing}
        />

        <SliderControl
          label="Nhiệt độ màu (Temperature: Xanh ↔ Vàng)"
          value={params.temperature}
          min={-100}
          max={100}
          onChange={(v) => updateParam('temperature', v)}
          disabled={isProcessing}
        />

        <SliderControl
          label="Sắc thái (Tint: Xanh lá ↔ Hồng tím)"
          value={params.tint}
          min={-100}
          max={100}
          onChange={(v) => updateParam('tint', v)}
          disabled={isProcessing}
        />
      </div>

      {/* Quality & Detail Section */}
      <div className="bg-[#191c20] p-3 rounded border border-[#272b31] space-y-3">
        <div className="flex items-center justify-between border-b border-[#25282c] pb-1.5">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-cyan-400">auto_fix_normal</span>
            <span>Chi tiết & Độ nét</span>
          </span>
          <span className="text-[10px] font-mono text-zinc-500">Quality</span>
        </div>

        <SliderControl
          label="Làm nét ảnh (Sharpen)"
          value={params.sharpen}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => updateParam('sharpen', v)}
          disabled={isProcessing}
        />

        <SliderControl
          label="Khử nhiễu bảo toàn cạnh (Denoise)"
          value={params.denoise}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => updateParam('denoise', v)}
          disabled={isProcessing}
        />

        <p className="text-[10px] text-zinc-500 leading-normal italic">
          * Xử lý thuần pixel kỹ thuật số: Không làm sáp mịn da (no waxy skin), không tự chế chi tiết ảo, bảo toàn 100% hình khối gốc.
        </p>
      </div>

      {/* Action buttons */}
      {isDirty && (
        <div className="flex items-center gap-2 pt-1 sticky bottom-0 bg-[#141618] py-2 border-t border-[#25282c] z-10">
          <button
            type="button"
            onClick={onApply}
            disabled={isProcessing}
            className="flex-1 py-2 bg-[#55c7b0] hover:bg-[#48b59f] active:bg-[#3fa08a] disabled:opacity-50 text-[#0d1815] font-bold rounded text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md"
          >
            <span className="material-symbols-outlined text-[16px]">check</span>
            <span>Áp dụng vào ảnh</span>
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="px-3 py-2 bg-[#22252a] hover:bg-[#2b3036] text-zinc-300 rounded text-xs transition-colors flex items-center justify-center gap-1 border border-[#2d3238]"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
            <span>Hủy</span>
          </button>
        </div>
      )}
    </div>
  );
};
