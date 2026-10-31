import React, { useRef, useState } from 'react';
import { SupportedImageModel } from '../types';

interface BackgroundPanelProps {
  selectionPixels: number;
  isProcessing: boolean;
  onInvertSelection: () => void;
  // Solid color
  solidColor: string;
  onChangeSolidColor: (c: string) => void;
  onPreviewSolidBg: () => void;
  // Gradient
  gradColor1: string;
  onChangeGradColor1: (c: string) => void;
  gradColor2: string;
  onChangeGradColor2: (c: string) => void;
  gradDir: 'to-bottom' | 'to-right' | 'diagonal';
  onChangeGradDir: (dir: 'to-bottom' | 'to-right' | 'diagonal') => void;
  onPreviewGradientBg: () => void;
  // Custom image
  uploadedBgFilename: string | null;
  uploadedBgThumbnail: string | null;
  replaceFitMode: 'cover' | 'contain';
  onChangeReplaceFitMode: (mode: 'cover' | 'contain') => void;
  onUploadBgFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onReapplyCustomBg: () => void;
  // Blur
  blurRadius: number;
  onChangeBlurRadius: (r: number) => void;
  onPreviewBlurBg: () => void;
  // Remove background
  onRemoveBg: () => void;
  // AI Backdrop
  aiBgPrompt: string;
  onChangeAiBgPrompt: (p: string) => void;
  aiBgModel: SupportedImageModel;
  onChangeAiBgModel: (m: SupportedImageModel) => void;
  castContactShadow: boolean;
  onChangeCastContactShadow: (val: boolean) => void;
  shadowIntensity: number;
  onChangeShadowIntensity: (val: number) => void;
  onGenerateAiBg: () => void;
  onEnhanceAiPrompt?: () => void;
  isEnhancingPrompt?: boolean;
}

const SOLID_PRESETS = [
  '#ffffff',
  '#f3f4f6',
  '#090a0f',
  '#1e293b',
  '#2563eb',
  '#0d9488',
  '#16a34a',
  '#ea580c',
  '#db2777',
  '#7c3aed',
];

const GRADIENT_PRESETS = [
  { c1: '#2563eb', c2: '#ec4899', dir: 'diagonal' as const, label: 'Xanh - Hồng' },
  { c1: '#0f172a', c2: '#334155', dir: 'to-bottom' as const, label: 'Xám studio' },
  { c1: '#f59e0b', c2: '#ef4444', dir: 'to-right' as const, label: 'Hoàng hôn' },
  { c1: '#06b6d4', c2: '#3b82f6', dir: 'diagonal' as const, label: 'Đại dương' },
];

export const BackgroundPanel: React.FC<BackgroundPanelProps> = ({
  selectionPixels,
  isProcessing,
  onInvertSelection,
  solidColor,
  onChangeSolidColor,
  onPreviewSolidBg,
  gradColor1,
  onChangeGradColor1,
  gradColor2,
  onChangeGradColor2,
  gradDir,
  onChangeGradDir,
  onPreviewGradientBg,
  uploadedBgFilename,
  uploadedBgThumbnail,
  replaceFitMode,
  onChangeReplaceFitMode,
  onUploadBgFile,
  onReapplyCustomBg,
  blurRadius,
  onChangeBlurRadius,
  onPreviewBlurBg,
  onRemoveBg,
  aiBgPrompt,
  onChangeAiBgPrompt,
  aiBgModel,
  onChangeAiBgModel,
  castContactShadow,
  onChangeCastContactShadow,
  shadowIntensity,
  onChangeShadowIntensity,
  onGenerateAiBg,
  onEnhanceAiPrompt,
  isEnhancingPrompt = false,
}) => {
  // Collapsible sections state
  const [openSections, setOpenSections] = useState<{
    solid: boolean;
    gradient: boolean;
    customImg: boolean;
    blur: boolean;
    aiBg: boolean;
  }>({
    solid: false,
    gradient: false,
    customImg: false,
    blur: false,
    aiBg: true, // open AI backdrop by default
  });

  const toggleSection = (sec: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // HEX input local validation state
  const [solidHexInput, setSolidHexInput] = useState(solidColor);
  const [grad1HexInput, setGrad1HexInput] = useState(gradColor1);
  const [grad2HexInput, setGrad2HexInput] = useState(gradColor2);

  const isValidHex = (hex: string) => /^#([0-9A-Fa-f]{3}){1,2}$/.test(hex);

  const handleSolidHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSolidHexInput(val);
    if (isValidHex(val)) {
      onChangeSolidColor(val);
    }
  };

  const handleGrad1HexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setGrad1HexInput(val);
    if (isValidHex(val)) {
      onChangeGradColor1(val);
    }
  };

  const handleGrad2HexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setGrad2HexInput(val);
    if (isValidHex(val)) {
      onChangeGradColor2(val);
    }
  };

  const hasSelection = selectionPixels > 0;

  return (
    <div className="space-y-2.5 text-xs text-zinc-300">
      {/* Selection notice & Invert quick trigger */}
      <div className="bg-[#16181b] p-2 rounded border border-[#24282c] flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 truncate">
          <span
            className={`material-symbols-outlined text-[15px] ${
              hasSelection ? 'text-[#55c7b0]' : 'text-amber-400'
            }`}
          >
            {hasSelection ? 'check_circle' : 'warning'}
          </span>
          <span className="truncate">
            {hasSelection
              ? `Chủ thể: ${selectionPixels.toLocaleString()} px`
              : 'Chưa có vùng chọn chủ thể'}
          </span>
        </div>
        <button
          type="button"
          onClick={onInvertSelection}
          disabled={!hasSelection || isProcessing}
          className="px-2 py-0.5 bg-[#1f2226] hover:bg-[#282d33] disabled:opacity-40 text-zinc-300 rounded text-[10px] flex items-center gap-1 border border-[#2b3036] shrink-0"
          title="Đảo ngược vùng chọn giữa chủ thể và nền"
        >
          <span className="material-symbols-outlined text-[12px]">swap_horiz</span>
          <span>Đảo ngược</span>
        </button>
      </div>

      {/* QUICK ACTION: REMOVE BACKGROUND (PNG ALPHA) */}
      <div className="bg-[#181b1e] p-2.5 rounded border border-[#272b31] flex items-center justify-between">
        <div className="flex flex-col">
          <span className="font-semibold text-zinc-200 text-xs flex items-center gap-1">
            <span className="material-symbols-outlined text-[15px] text-[#55c7b0]">crop_free</span>
            <span>Xóa nền trong suốt (PNG Alpha)</span>
          </span>
          <span className="text-[10px] text-zinc-400">
            Cắt rời chủ thể, nền thành kênh trong suốt Alpha.
          </span>
        </div>
        <button
          type="button"
          onClick={onRemoveBg}
          disabled={!hasSelection || isProcessing}
          className="px-2.5 py-1.5 bg-[#1a2b25] hover:bg-[#223d34] disabled:opacity-40 text-[#55c7b0] font-semibold rounded text-[11px] border border-[#55c7b0]/40 flex items-center gap-1 shrink-0 transition-colors"
        >
          <span>Xem trước</span>
        </button>
      </div>

      {/* SECTION 1: SOLID COLOR */}
      <div className="bg-[#181b1e] rounded border border-[#272b31] overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection('solid')}
          className="w-full p-2.5 flex items-center justify-between bg-[#15171a] hover:bg-[#1a1c20] transition-colors text-left"
        >
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5 text-xs">
            <span className="material-symbols-outlined text-[15px] text-[#55c7b0]">palette</span>
            <span>Nền màu đơn sắc</span>
          </span>
          <div className="flex items-center gap-2">
            <div
              className="w-3.5 h-3.5 rounded border border-white/20"
              style={{ backgroundColor: solidColor }}
              title={`Màu hiện tại: ${solidColor}`}
            />
            <span className="material-symbols-outlined text-[16px] text-zinc-500">
              {openSections.solid ? 'expand_less' : 'expand_more'}
            </span>
          </div>
        </button>

        {openSections.solid && (
          <div className="p-2.5 space-y-2.5 border-t border-[#23272d]">
            <div className="flex items-center gap-2">
              <label className="relative cursor-pointer shrink-0">
                <input
                  type="color"
                  value={solidColor}
                  onChange={(e) => {
                    onChangeSolidColor(e.target.value);
                    setSolidHexInput(e.target.value);
                  }}
                  className="w-8 h-8 rounded cursor-pointer border border-[#2e343b] bg-transparent p-0 block"
                />
              </label>

              <div className="flex-1 flex items-center bg-[#121416] border border-[#282d33] rounded px-2 py-1">
                <span className="text-zinc-500 font-mono text-[11px] mr-1">HEX</span>
                <input
                  type="text"
                  value={solidHexInput}
                  onChange={handleSolidHexChange}
                  maxLength={7}
                  placeholder="#ffffff"
                  className="w-full bg-transparent text-zinc-200 font-mono text-[11px] outline-none"
                />
              </div>

              <button
                type="button"
                onClick={onPreviewSolidBg}
                disabled={!hasSelection || isProcessing}
                className="px-2.5 py-1.5 bg-[#55c7b0] hover:bg-[#47b59f] disabled:opacity-40 text-[#0d1815] font-bold rounded text-[11px] transition-colors shrink-0"
              >
                Xem trước
              </button>
            </div>

            {/* Presets palette */}
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-400">Mẫu màu sẵn:</span>
              <div className="flex flex-wrap gap-1.5">
                {SOLID_PRESETS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => {
                      onChangeSolidColor(hex);
                      setSolidHexInput(hex);
                    }}
                    className={`w-5 h-5 rounded-full border transition-transform ${
                      solidColor.toLowerCase() === hex.toLowerCase()
                        ? 'border-[#55c7b0] scale-110 shadow-sm'
                        : 'border-[#2d3238] hover:scale-105'
                    }`}
                    style={{ backgroundColor: hex }}
                    title={hex}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: GRADIENT */}
      <div className="bg-[#181b1e] rounded border border-[#272b31] overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection('gradient')}
          className="w-full p-2.5 flex items-center justify-between bg-[#15171a] hover:bg-[#1a1c20] transition-colors text-left"
        >
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5 text-xs">
            <span className="material-symbols-outlined text-[15px] text-[#55c7b0]">gradient</span>
            <span>Nền chuyển sắc (Gradient)</span>
          </span>
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-3.5 rounded border border-white/20"
              style={{
                background: `linear-gradient(${
                  gradDir === 'to-right'
                    ? 'to right'
                    : gradDir === 'to-bottom'
                    ? 'to bottom'
                    : '135deg'
                }, ${gradColor1}, ${gradColor2})`,
              }}
            />
            <span className="material-symbols-outlined text-[16px] text-zinc-500">
              {openSections.gradient ? 'expand_less' : 'expand_more'}
            </span>
          </div>
        </button>

        {openSections.gradient && (
          <div className="p-2.5 space-y-2.5 border-t border-[#23272d]">
            <div className="grid grid-cols-2 gap-2">
              {/* Color 1 */}
              <div className="space-y-1">
                <span className="text-[10px] text-zinc-400">Màu 1 (Bắt đầu):</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={gradColor1}
                    onChange={(e) => {
                      onChangeGradColor1(e.target.value);
                      setGrad1HexInput(e.target.value);
                    }}
                    className="w-6 h-6 rounded cursor-pointer border border-[#2e343b] bg-transparent p-0 block shrink-0"
                  />
                  <input
                    type="text"
                    value={grad1HexInput}
                    onChange={handleGrad1HexChange}
                    maxLength={7}
                    className="w-full bg-[#121416] border border-[#282d33] rounded px-1.5 py-1 text-zinc-200 font-mono text-[10px] outline-none"
                  />
                </div>
              </div>

              {/* Color 2 */}
              <div className="space-y-1">
                <span className="text-[10px] text-zinc-400">Màu 2 (Kết thúc):</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={gradColor2}
                    onChange={(e) => {
                      onChangeGradColor2(e.target.value);
                      setGrad2HexInput(e.target.value);
                    }}
                    className="w-6 h-6 rounded cursor-pointer border border-[#2e343b] bg-transparent p-0 block shrink-0"
                  />
                  <input
                    type="text"
                    value={grad2HexInput}
                    onChange={handleGrad2HexChange}
                    maxLength={7}
                    className="w-full bg-[#121416] border border-[#282d33] rounded px-1.5 py-1 text-zinc-200 font-mono text-[10px] outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Direction */}
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-400">Hướng chuyển sắc:</span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'diagonal', label: 'Chéo góc' },
                    { id: 'to-bottom', label: 'Dọc xuống' },
                    { id: 'to-right', label: 'Ngang qua' },
                  ] as const
                ).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onChangeGradDir(d.id)}
                    className={`py-1 rounded text-[10px] font-medium border transition-colors ${
                      gradDir === d.id
                        ? 'bg-[#1b2622] border-[#55c7b0] text-[#55c7b0]'
                        : 'bg-[#141618] border-[#292f36] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Gradient Presets */}
            <div className="flex items-center gap-1 overflow-x-auto py-0.5">
              {GRADIENT_PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    onChangeGradColor1(p.c1);
                    setGrad1HexInput(p.c1);
                    onChangeGradColor2(p.c2);
                    setGrad2HexInput(p.c2);
                    onChangeGradDir(p.dir);
                  }}
                  className="px-2 py-0.5 bg-[#141618] hover:bg-[#1f2226] border border-[#2a2f36] rounded text-[9.5px] text-zinc-300 shrink-0"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onPreviewGradientBg}
              disabled={!hasSelection || isProcessing}
              className="w-full py-1.5 bg-[#55c7b0] hover:bg-[#47b59f] disabled:opacity-40 text-[#0d1815] font-bold rounded text-[11px] transition-colors"
            >
              Xem trước nền Gradient
            </button>
          </div>
        )}
      </div>

      {/* SECTION 3: USER BACKGROUND IMAGE */}
      <div className="bg-[#181b1e] rounded border border-[#272b31] overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection('customImg')}
          className="w-full p-2.5 flex items-center justify-between bg-[#15171a] hover:bg-[#1a1c20] transition-colors text-left"
        >
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5 text-xs">
            <span className="material-symbols-outlined text-[15px] text-[#55c7b0]">image</span>
            <span>Ảnh nền riêng</span>
          </span>
          <div className="flex items-center gap-1.5">
            {uploadedBgFilename && (
              <span className="text-[10px] text-[#55c7b0] font-mono truncate max-w-[80px]">
                {uploadedBgFilename}
              </span>
            )}
            <span className="material-symbols-outlined text-[16px] text-zinc-500">
              {openSections.customImg ? 'expand_less' : 'expand_more'}
            </span>
          </div>
        </button>

        {openSections.customImg && (
          <div className="p-2.5 space-y-2.5 border-t border-[#23272d]">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onUploadBgFile}
              className="hidden"
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!hasSelection || isProcessing}
                className="flex-1 py-1.5 px-2 bg-[#1f2327] hover:bg-[#282d33] disabled:opacity-40 text-zinc-200 font-medium rounded text-xs border border-[#2e343b] flex items-center justify-center gap-1.5 transition-colors"
                title="Tải ảnh nền từ máy (PNG, JPEG, WebP)"
              >
                <span className="material-symbols-outlined text-[15px] text-[#55c7b0]">
                  upload_file
                </span>
                <span>Dùng ảnh nền riêng</span>
              </button>
            </div>

            {/* Selected thumbnail & filename */}
            {uploadedBgFilename && (
              <div className="flex items-center gap-2 bg-[#141618] p-1.5 rounded border border-[#272b31]">
                {uploadedBgThumbnail && (
                  <img
                    src={uploadedBgThumbnail}
                    alt="Nền đã tải"
                    className="w-8 h-8 object-cover rounded border border-[#2b3036] shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[10.5px] font-medium text-zinc-200 truncate">
                    {uploadedBgFilename}
                  </div>
                  <div className="text-[9px] text-zinc-500">Đã nạp sẵn bộ nhớ</div>
                </div>
              </div>
            )}

            {/* Fit mode choices: Cover vs Contain */}
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-400">Chế độ khớp khung:</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onChangeReplaceFitMode('cover')}
                  className={`py-1 rounded text-[10px] font-medium border transition-colors ${
                    replaceFitMode === 'cover'
                      ? 'bg-[#1b2622] border-[#55c7b0] text-[#55c7b0] font-bold'
                      : 'bg-[#141618] border-[#292f36] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Tràn khung (Cover)
                </button>
                <button
                  type="button"
                  onClick={() => onChangeReplaceFitMode('contain')}
                  className={`py-1 rounded text-[10px] font-medium border transition-colors ${
                    replaceFitMode === 'contain'
                      ? 'bg-[#1b2622] border-[#55c7b0] text-[#55c7b0] font-bold'
                      : 'bg-[#141618] border-[#292f36] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Vừa khung (Contain)
                </button>
              </div>
            </div>

            {uploadedBgFilename && (
              <button
                type="button"
                onClick={onReapplyCustomBg}
                disabled={!hasSelection || isProcessing}
                className="w-full py-1.5 bg-[#55c7b0] hover:bg-[#47b59f] disabled:opacity-40 text-[#0d1815] font-bold rounded text-[11px] transition-colors"
              >
                Xem trước lại với chế độ {replaceFitMode.toUpperCase()}
              </button>
            )}
          </div>
        )}
      </div>

      {/* SECTION 4: BACKGROUND BLUR */}
      <div className="bg-[#181b1e] rounded border border-[#272b31] overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection('blur')}
          className="w-full p-2.5 flex items-center justify-between bg-[#15171a] hover:bg-[#1a1c20] transition-colors text-left"
        >
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5 text-xs">
            <span className="material-symbols-outlined text-[15px] text-[#55c7b0]">blur_on</span>
            <span>Làm mờ hậu cảnh (Bokeh)</span>
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-[#55c7b0]">{blurRadius}px</span>
            <span className="material-symbols-outlined text-[16px] text-zinc-500">
              {openSections.blur ? 'expand_less' : 'expand_more'}
            </span>
          </div>
        </button>

        {openSections.blur && (
          <div className="p-2.5 space-y-2.5 border-t border-[#23272d]">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">Bán kính mờ (Radius):</span>
                <span className="font-mono text-[#55c7b0] font-semibold">{blurRadius} px</span>
              </div>
              <input
                type="range"
                min="2"
                max="40"
                value={blurRadius}
                onChange={(e) => onChangeBlurRadius(Number(e.target.value))}
                className="w-full accent-[#55c7b0] cursor-pointer"
              />
              <div className="flex justify-between text-[9px] font-mono text-zinc-500">
                <span>2px (Nhẹ)</span>
                <span>14px (Vừa)</span>
                <span>40px (Mạnh)</span>
              </div>
            </div>

            <p className="text-[10px] text-zinc-500 leading-normal italic">
              * Khử lem màu chủ thể vào vùng mờ, bảo toàn tuyệt đối các vùng mặt được bảo vệ.
            </p>

            <button
              type="button"
              onClick={onPreviewBlurBg}
              disabled={!hasSelection || isProcessing}
              className="w-full py-1.5 bg-[#55c7b0] hover:bg-[#47b59f] disabled:opacity-40 text-[#0d1815] font-bold rounded text-[11px] transition-colors"
            >
              Xem trước làm mờ ({blurRadius}px)
            </button>
          </div>
        )}
      </div>

      {/* SECTION 5: AI BACKDROP */}
      <div className="bg-[#181b1e] rounded border border-[#272b31] overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection('aiBg')}
          className="w-full p-2.5 flex items-center justify-between bg-[#15171a] hover:bg-[#1a1c20] transition-colors text-left"
        >
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5 text-xs">
            <span className="material-symbols-outlined text-[15px] text-purple-400">wallpaper</span>
            <span>Tạo cảnh nền bằng AI</span>
          </span>
          <span className="material-symbols-outlined text-[16px] text-zinc-500">
            {openSections.aiBg ? 'expand_less' : 'expand_more'}
          </span>
        </button>

        {openSections.aiBg && (
          <div className="p-2.5 space-y-2.5 border-t border-[#23272d]">
            {/* Model Selector Buttons */}
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-400">Mô hình tạo ảnh:</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onChangeAiBgModel('🍌 Nano Banana Pro')}
                  className={`py-1 px-1.5 rounded text-left border transition-all ${
                    aiBgModel === '🍌 Nano Banana Pro'
                      ? 'bg-[#182621] border-[#55c7b0] text-[#55c7b0]'
                      : 'bg-[#141618] border-[#262a30] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="font-semibold text-[10px]">🍌 Nano Banana Pro</div>
                  <div className="text-[8.5px] opacity-70">Mặc định • Chất lượng cao</div>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeAiBgModel('🍌 Nano Banana 2.1')}
                  className={`py-1 px-1.5 rounded text-left border transition-all ${
                    aiBgModel === '🍌 Nano Banana 2.1'
                      ? 'bg-[#182621] border-[#55c7b0] text-[#55c7b0]'
                      : 'bg-[#141618] border-[#262a30] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="font-semibold text-[10px]">🍌 Nano Banana 2.1</div>
                  <div className="text-[8.5px] opacity-70">Tốc độ • Xem thử nhanh</div>
                </button>
              </div>
            </div>

            {/* Prompt textarea */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Mô tả bối cảnh nền:</span>
                {onEnhanceAiPrompt && (
                  <button
                    type="button"
                    onClick={onEnhanceAiPrompt}
                    disabled={!aiBgPrompt.trim() || isEnhancingPrompt}
                    className="text-[9.5px] text-purple-400 hover:text-purple-300 disabled:opacity-40 flex items-center gap-0.5"
                    title="Dùng Gemini tối ưu hóa mô tả prompt"
                  >
                    <span className="material-symbols-outlined text-[11px]">auto_fix_high</span>
                    <span>{isEnhancingPrompt ? 'Đang mở rộng...' : 'Mở rộng prompt'}</span>
                  </button>
                )}
              </div>
              <textarea
                value={aiBgPrompt}
                onChange={(e) => onChangeAiBgPrompt(e.target.value)}
                placeholder="Ví dụ: bãi biển nhiệt đới hoàng hôn dịu nhẹ, sóng lăn tăn..."
                rows={2}
                className="w-full bg-[#121416] border border-[#282d33] rounded p-2 text-zinc-200 text-xs focus:border-[#55c7b0] outline-none resize-none"
              />
            </div>

            {/* Contact Shadow Toggle & Intensity slider (default OFF) */}
            <div className="space-y-1.5 bg-[#141618] p-2 rounded border border-[#262a30]">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={castContactShadow}
                    onChange={(e) => onChangeCastContactShadow(e.target.checked)}
                    className="accent-[#55c7b0]"
                  />
                  <span className="text-[11px]">Bóng tiếp xúc mặt đất</span>
                </label>
                <span className="text-[9px] text-zinc-500 font-mono">
                  {castContactShadow ? `${shadowIntensity}%` : 'TẮT'}
                </span>
              </div>

              {castContactShadow && (
                <div className="space-y-1 pt-1 border-t border-[#23272d]">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-zinc-400">Độ đậm bóng (Intensity):</span>
                    <span className="font-mono text-[#55c7b0]">{shadowIntensity}%</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    value={shadowIntensity}
                    onChange={(e) => onChangeShadowIntensity(Number(e.target.value))}
                    className="w-full accent-[#55c7b0] cursor-pointer h-1"
                  />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onGenerateAiBg}
              disabled={!hasSelection || !aiBgPrompt.trim() || isProcessing}
              className="w-full py-2 bg-[#6d28d9] hover:bg-[#5b21b6] disabled:opacity-40 text-white rounded text-xs font-semibold border border-purple-500/40 flex items-center justify-center gap-1.5 shadow"
            >
              <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
              <span>{isProcessing ? 'Đang tạo nền AI...' : 'Tạo cảnh nền AI'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
