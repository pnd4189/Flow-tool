import React, { useState, useEffect, useRef } from 'react';
import {
  DecodedImage,
  CropRect,
  CropAspectPreset,
  ExpandAnchor,
  SupportedImageModel,
  CandidatePreview,
} from '../types';
import {
  applyCrop,
  applyRotate90OrFlip,
  applyStraighten,
  generateAiCanvasExpansion,
  checkMemoryLimit,
  MAX_SAFE_IMAGE_PIXELS,
  calculateAnchorOffset,
} from '../services/compositionService';

interface CompositionPanelProps {
  image: DecodedImage | null;
  selectionMask: HTMLCanvasElement | null;
  protectionMask: HTMLCanvasElement | null;
  currentRevision: number;
  candidatePreview: CandidatePreview | null;
  onSetCandidatePreview: (preview: CandidatePreview | null) => void;
  onApplyCandidatePreview: () => void;
  onCancelCandidatePreview: () => void;
  isProcessing: boolean;
  onRequestBusyToken: (msg: string) => number;
  onReleaseBusyToken: (token: number) => void;
  onShowToast: (msg: string) => void;
  onLogDiagnostic: (type: 'info' | 'success' | 'warn' | 'error', msg: string, details?: string) => void;
  cropRect: CropRect | null;
  onChangeCropRect: (rect: CropRect | null) => void;
  isCropActive: boolean;
  onToggleCropActive: (active: boolean) => void;
}

export const CompositionPanel: React.FC<CompositionPanelProps> = ({
  image,
  selectionMask,
  protectionMask,
  currentRevision,
  candidatePreview,
  onSetCandidatePreview,
  onApplyCandidatePreview,
  onCancelCandidatePreview,
  isProcessing,
  onRequestBusyToken,
  onReleaseBusyToken,
  onShowToast,
  onLogDiagnostic,
  cropRect,
  onChangeCropRect,
  isCropActive,
  onToggleCropActive,
}) => {
  const [subSection, setSubSection] = useState<'crop_rotate' | 'ai_expand'>('crop_rotate');

  // Real Crop State
  const [cropPreset, setCropPreset] = useState<CropAspectPreset>('free');

  // Straighten State (-15..15)
  const [straightenAngle, setStraightenAngle] = useState(0);

  // AI Expand State
  const [expandPreset, setExpandPreset] = useState<'16:9' | '9:16' | '1:1' | '4:3' | 'custom'>('16:9');
  const [targetWidth, setTargetWidth] = useState(1920);
  const [targetHeight, setTargetHeight] = useState(1080);
  const [expandAnchor, setExpandAnchor] = useState<ExpandAnchor>('center');
  const [expandPrompt, setExpandPrompt] = useState('');
  const [expandModel, setExpandModel] = useState<SupportedImageModel>('🍌 Nano Banana Pro');

  // AI Expand active request tracking and cancellation
  const [isExpanding, setIsExpanding] = useState(false);
  const expandRequestIdRef = useRef<string | null>(null);
  const activeTokenRef = useRef<number | null>(null);

  // Synchronize target dimensions when image loads or preset changes
  useEffect(() => {
    if (!image) return;
    const w = image.width;
    const h = image.height;

    if (expandPreset === '16:9') {
      const minW = Math.max(w, Math.round(h * (16 / 9)));
      const minH = Math.max(h, Math.round(w / (16 / 9)));
      if (minW / h >= 16 / 9) {
        setTargetWidth(minW);
        setTargetHeight(h);
      } else {
        setTargetWidth(w);
        setTargetHeight(minH);
      }
    } else if (expandPreset === '9:16') {
      const minH = Math.max(h, Math.round(w * (16 / 9)));
      setTargetWidth(w);
      setTargetHeight(minH);
    } else if (expandPreset === '1:1') {
      const maxDim = Math.max(w, h);
      setTargetWidth(maxDim);
      setTargetHeight(maxDim);
    } else if (expandPreset === '4:3') {
      const minW = Math.max(w, Math.round(h * (4 / 3)));
      const minH = Math.max(h, Math.round(w / (4 / 3)));
      if (minW / h >= 4 / 3) {
        setTargetWidth(minW);
        setTargetHeight(h);
      } else {
        setTargetWidth(w);
        setTargetHeight(minH);
      }
    }
  }, [image, expandPreset]);

  const handleStartCrop = () => {
    if (!image) return;
    const w = image.width;
    const h = image.height;

    const initW = Math.round(w * 0.85);
    const initH = Math.round(h * 0.85);
    const initX = Math.round((w - initW) / 2);
    const initY = Math.round((h - initH) / 2);

    onChangeCropRect({ x: initX, y: initY, width: initW, height: initH });
    onToggleCropActive(true);
  };

  const handleApplyPresetToRect = (preset: CropAspectPreset) => {
    setCropPreset(preset);
    if (!image || !cropRect) return;

    const w = image.width;
    const h = image.height;

    let targetRatio: number | null = null;
    if (preset === 'original') targetRatio = w / h;
    else if (preset === '1:1') targetRatio = 1.0;
    else if (preset === '4:3') targetRatio = 4 / 3;
    else if (preset === '16:9') targetRatio = 16 / 9;
    else if (preset === '9:16') targetRatio = 9 / 16;

    if (targetRatio === null) return;

    let newW = cropRect.width;
    let newH = Math.round(newW / targetRatio);

    if (newH > h) {
      newH = h;
      newW = Math.round(newH * targetRatio);
    }

    const newX = Math.max(0, Math.min(cropRect.x, w - newW));
    const newY = Math.max(0, Math.min(cropRect.y, h - newH));

    onChangeCropRect({
      x: newX,
      y: newY,
      width: newW,
      height: newH,
    });
  };

  const handlePreviewCrop = () => {
    if (!image || !selectionMask || !protectionMask || !cropRect) return;

    try {
      const res = applyCrop(image.canvas, selectionMask, protectionMask, cropRect);

      const preview: CandidatePreview = {
        type: 'crop',
        canvas: res.croppedImage,
        selectionMaskCanvas: res.croppedSelectionMask,
        protectionMaskCanvas: res.croppedProtectionMask,
        title: 'Cắt khung hình (Crop)',
        description: `Từ ${image.width}×${image.height} → ${res.croppedImage.width}×${res.croppedImage.height} px. Tọa độ: (${cropRect.x}, ${cropRect.y}).`,
        sourceRevision: currentRevision,
        compositionInfo: {
          originalDimensions: { width: image.width, height: image.height },
          newDimensions: { width: res.croppedImage.width, height: res.croppedImage.height },
          operation: 'crop',
          isResampled: false,
        },
      };

      onSetCandidatePreview(preview);
      onToggleCropActive(false);
      onShowToast(`Xem trước cắt: ${res.croppedImage.width} × ${res.croppedImage.height} px`);
    } catch (err: any) {
      onShowToast(`Lỗi cắt ảnh: ${err?.message || err}`);
    }
  };

  const handleRotateOrFlip = (action: 'rotate_90_cw' | 'rotate_90_ccw' | 'flip_h' | 'flip_v') => {
    if (!image || !selectionMask || !protectionMask) return;

    const res = applyRotate90OrFlip(image.canvas, selectionMask, protectionMask, action);

    const labels = {
      rotate_90_cw: 'Xoay 90° theo chiều kim đồng hồ',
      rotate_90_ccw: 'Xoay 90° ngược chiều kim đồng hồ',
      flip_h: 'Lật ngang (Flip H)',
      flip_v: 'Lật dọc (Flip V)',
    };

    const preview: CandidatePreview = {
      type: 'rotate_flip',
      canvas: res.transformedImage,
      selectionMaskCanvas: res.transformedSelectionMask,
      protectionMaskCanvas: res.transformedProtectionMask,
      title: labels[action],
      description: `Kích thước: ${res.transformedImage.width}×${res.transformedImage.height} px. Điểm ảnh giữ nguyên vị trí tái định hướng.`,
      sourceRevision: currentRevision,
      compositionInfo: {
        originalDimensions: { width: image.width, height: image.height },
        newDimensions: { width: res.transformedImage.width, height: res.transformedImage.height },
        operation: 'rotate_flip',
        isResampled: false,
      },
    };

    onSetCandidatePreview(preview);
    onShowToast(`Xem trước: ${labels[action]}`);
  };

  const handlePreviewStraighten = () => {
    if (!image || !selectionMask || !protectionMask) return;
    if (straightenAngle === 0) {
      onShowToast('Góc căn chỉnh đang bằng 0°. Vui lòng chọn góc khác.');
      return;
    }

    const res = applyStraighten(image.canvas, selectionMask, protectionMask, straightenAngle);

    const preview: CandidatePreview = {
      type: 'straighten',
      canvas: res.straightenedImage,
      selectionMaskCanvas: res.straightenedSelectionMask,
      protectionMaskCanvas: res.straightenedProtectionMask,
      title: `Căn thẳng góc (${straightenAngle > 0 ? `+${straightenAngle}` : straightenAngle}°)`,
      description: `Khung sau căn: ${res.cropDimensions.width}×${res.cropDimensions.height} px (Nội suy mượt khử răng cưa).`,
      sourceRevision: currentRevision,
      compositionInfo: {
        originalDimensions: { width: image.width, height: image.height },
        newDimensions: { width: res.cropDimensions.width, height: res.cropDimensions.height },
        operation: 'straighten',
        isResampled: true,
      },
    };

    onSetCandidatePreview(preview);
    onShowToast(`Xem trước căn thẳng: ${straightenAngle}°`);
  };

  const handleCancelAiExpand = () => {
    if (expandRequestIdRef.current) {
      expandRequestIdRef.current = null;
      setIsExpanding(false);
      if (activeTokenRef.current !== null) {
        onReleaseBusyToken(activeTokenRef.current);
        activeTokenRef.current = null;
      }
      onLogDiagnostic('warn', 'Người dùng đã hủy yêu cầu mở rộng khung ảnh AI.');
      onShowToast('Đã hủy yêu cầu mở rộng AI (quá trình ngầm có thể vẫn chạy xong trong Flow).');
    }
  };

  const handleGenerateAiExpand = async () => {
    if (!image || !selectionMask || !protectionMask) return;

    if (targetWidth < image.width || targetHeight < image.height) {
      onShowToast('Kích thước mở rộng phải lớn hơn hoặc bằng kích thước ảnh hiện tại.');
      return;
    }

    if (targetWidth === image.width && targetHeight === image.height) {
      onShowToast('Vui lòng tăng kích thước rộng hoặc cao để mở rộng khung ảnh.');
      return;
    }

    const mem = checkMemoryLimit(targetWidth, targetHeight);
    if (!mem.safe) {
      onShowToast(mem.message || 'Kích thước vượt giới hạn an toàn.');
      return;
    }

    const requestId = Math.random().toString(36).substring(2, 9);
    expandRequestIdRef.current = requestId;
    setIsExpanding(true);

    const requestSourceRevision = currentRevision;
    const token = onRequestBusyToken('Đang mở rộng khung ảnh bằng AI...');
    activeTokenRef.current = token;

    try {
      onLogDiagnostic(
        'info',
        `Bắt đầu mở rộng khung ảnh AI [${requestId}] từ ${image.width}x${image.height} lên ${targetWidth}x${targetHeight}...`
      );

      const cancelControl = {
        requestId,
        isCancelled: () => expandRequestIdRef.current !== requestId || currentRevision !== requestSourceRevision,
      };

      const preview = await generateAiCanvasExpansion(
        image.canvas,
        selectionMask,
        protectionMask,
        {
          targetWidth,
          targetHeight,
          anchor: expandAnchor,
          userPrompt: expandPrompt,
          model: expandModel,
        },
        requestSourceRevision,
        (msg) => onLogDiagnostic('info', msg),
        cancelControl
      );

      if (expandRequestIdRef.current !== requestId || currentRevision !== requestSourceRevision) {
        onLogDiagnostic('warn', `Kết quả mở rộng [${requestId}] bị loại bỏ vì đã bị hủy hoặc ảnh đã đổi phiên bản.`);
        return;
      }

      onSetCandidatePreview(preview);
      onShowToast(`Đã tạo xong khung mở rộng ${targetWidth} × ${targetHeight} px.`);
      onLogDiagnostic('success', `Mở rộng khung AI thành công: ${targetWidth}x${targetHeight} px.`);
    } catch (err: any) {
      if (expandRequestIdRef.current === requestId) {
        const msg = err instanceof Error ? err.message : String(err);
        onLogDiagnostic('error', 'Lỗi mở rộng khung ảnh AI', msg);
        onShowToast(`Lỗi: ${msg}`);
      }
    } finally {
      if (expandRequestIdRef.current === requestId) {
        expandRequestIdRef.current = null;
        setIsExpanding(false);
        if (activeTokenRef.current === token) {
          onReleaseBusyToken(token);
          activeTokenRef.current = null;
        }
      }
    }
  };

  const memCheck = checkMemoryLimit(targetWidth, targetHeight);
  const targetPixels = targetWidth * targetHeight;

  const anchorOffset = image
    ? calculateAnchorOffset(image.width, image.height, targetWidth, targetHeight, expandAnchor)
    : { offsetX: 0, offsetY: 0 };

  return (
    <div className="space-y-4">
      {/* Sub-tabs: Cắt & Xoay vs Mở rộng AI */}
      <div className="flex bg-[#16181b] p-0.5 rounded border border-[#272b31]">
        <button
          type="button"
          disabled={isExpanding}
          onClick={() => {
            setSubSection('crop_rotate');
            onCancelCandidatePreview();
          }}
          className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
            subSection === 'crop_rotate'
              ? 'bg-[#55c7b0] text-[#0d1815] font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Cắt, Xoay & Căn góc
        </button>
        <button
          type="button"
          disabled={isExpanding}
          onClick={() => {
            setSubSection('ai_expand');
            onToggleCropActive(false);
            onCancelCandidatePreview();
          }}
          className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
            subSection === 'ai_expand'
              ? 'bg-[#55c7b0] text-[#0d1815] font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Mở rộng khung AI
        </button>
      </div>

      {/* SECTION 1: CẮT, XOAY & CĂN GÓC */}
      {subSection === 'crop_rotate' && (
        <div className="space-y-3.5">
          {/* 1. Real Crop Panel */}
          <div className="bg-[#191c20] p-3 rounded border border-[#272b31] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[#55c7b0] text-[16px]">crop</span>
                <span>Cắt khung hình (Crop)</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400">Exact Mask Alignment</span>
            </div>

            <p className="text-[11px] text-zinc-400 leading-snug">
              Kéo chỉnh khung hình chữ nhật trực tiếp hoặc nhập tọa độ. Mặt nạ chọn & bảo vệ được cắt chuẩn xác cùng tọa độ.
            </p>

            <div className="space-y-1">
              <span className="text-[10px] text-zinc-400">Tỷ lệ khung cắt:</span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'free', label: 'Tự do' },
                    { id: 'original', label: 'Gốc' },
                    { id: '1:1', label: '1:1 Vuông' },
                    { id: '4:3', label: '4:3 Ngang' },
                    { id: '16:9', label: '16:9 Rộng' },
                    { id: '9:16', label: '9:16 Dọc' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPresetToRect(preset.id)}
                    className={`py-1 rounded text-[10px] font-medium border transition-colors ${
                      cropPreset === preset.id
                        ? 'bg-[#1b2622] border-[#55c7b0] text-[#55c7b0]'
                        : 'bg-[#141618] border-[#292d33] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {cropRect && (
              <div className="bg-[#141618] p-2 rounded border border-[#282d33] space-y-1.5">
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">X:</span>
                    <input
                      type="number"
                      value={cropRect.x}
                      onChange={(e) =>
                        onChangeCropRect({ ...cropRect, x: Math.max(0, Number(e.target.value)) })
                      }
                      className="w-16 bg-[#1a1d21] border border-[#2d3238] rounded px-1.5 py-0.5 text-zinc-200 text-right"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Y:</span>
                    <input
                      type="number"
                      value={cropRect.y}
                      onChange={(e) =>
                        onChangeCropRect({ ...cropRect, y: Math.max(0, Number(e.target.value)) })
                      }
                      className="w-16 bg-[#1a1d21] border border-[#2d3238] rounded px-1.5 py-0.5 text-zinc-200 text-right"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Rộng:</span>
                    <input
                      type="number"
                      value={cropRect.width}
                      onChange={(e) =>
                        onChangeCropRect({ ...cropRect, width: Math.max(10, Number(e.target.value)) })
                      }
                      className="w-16 bg-[#1a1d21] border border-[#2d3238] rounded px-1.5 py-0.5 text-zinc-200 text-right text-[#55c7b0]"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Cao:</span>
                    <input
                      type="number"
                      value={cropRect.height}
                      onChange={(e) =>
                        onChangeCropRect({ ...cropRect, height: Math.max(10, Number(e.target.value)) })
                      }
                      className="w-16 bg-[#1a1d21] border border-[#2d3238] rounded px-1.5 py-0.5 text-zinc-200 text-right text-[#55c7b0]"
                    />
                  </div>
                </div>

                <div className="pt-1 border-t border-[#23272d] flex items-center justify-between text-[10px]">
                  <span className="text-zinc-400">Kích thước sau cắt:</span>
                  <span className="font-mono text-[#55c7b0] font-semibold">
                    {cropRect.width} × {cropRect.height} px
                  </span>
                </div>
              </div>
            )}

            {!isCropActive ? (
              <button
                type="button"
                onClick={handleStartCrop}
                disabled={!image || isProcessing}
                className="w-full py-1.5 bg-[#22252a] hover:bg-[#2a2f35] text-zinc-200 rounded text-xs font-semibold border border-[#30353c] flex items-center justify-center gap-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px] text-[#55c7b0]">crop_free</span>
                <span>Bật khung cắt trên ảnh</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreviewCrop}
                  disabled={!cropRect || isProcessing}
                  className="flex-1 py-1.5 bg-[#55c7b0] hover:bg-[#48b59f] text-[#0d1815] rounded text-xs font-bold transition-colors flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">visibility</span>
                  <span>Xem trước cắt</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onToggleCropActive(false);
                    onChangeCropRect(null);
                  }}
                  className="px-3 py-1.5 bg-[#22252a] hover:bg-[#2b3036] text-zinc-300 rounded text-xs border border-[#2e333a]"
                >
                  Hủy
                </button>
              </div>
            )}
          </div>

          {/* 2. Rotate 90 & Flip */}
          <div className="bg-[#191c20] p-3 rounded border border-[#272b31] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-amber-400 text-[16px]">rotate_right</span>
                <span>Xoay 90° & Lật đối xứng</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-500">Lossless Geometry</span>
            </div>

            <p className="text-[11px] text-zinc-400 leading-snug">
              Thay đổi hướng ảnh và mặt nạ bảo vệ/chọn đồng bộ 100%. Không làm mờ hay thay đổi giá trị điểm ảnh.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleRotateOrFlip('rotate_90_ccw')}
                disabled={!image || isProcessing}
                className="py-1.5 bg-[#17191c] hover:bg-[#22252a] disabled:opacity-50 text-zinc-200 rounded text-[11px] font-medium border border-[#2b2f35] flex items-center justify-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">rotate_left</span>
                <span>Xoay trái 90°</span>
              </button>
              <button
                type="button"
                onClick={() => handleRotateOrFlip('rotate_90_cw')}
                disabled={!image || isProcessing}
                className="py-1.5 bg-[#17191c] hover:bg-[#22252a] disabled:opacity-50 text-zinc-200 rounded text-[11px] font-medium border border-[#2b2f35] flex items-center justify-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">rotate_right</span>
                <span>Xoay phải 90°</span>
              </button>
              <button
                type="button"
                onClick={() => handleRotateOrFlip('flip_h')}
                disabled={!image || isProcessing}
                className="py-1.5 bg-[#17191c] hover:bg-[#22252a] disabled:opacity-50 text-zinc-200 rounded text-[11px] font-medium border border-[#2b2f35] flex items-center justify-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                <span>Lật ngang</span>
              </button>
              <button
                type="button"
                onClick={() => handleRotateOrFlip('flip_v')}
                disabled={!image || isProcessing}
                className="py-1.5 bg-[#17191c] hover:bg-[#22252a] disabled:opacity-50 text-zinc-200 rounded text-[11px] font-medium border border-[#2b2f35] flex items-center justify-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">swap_vert</span>
                <span>Lật dọc</span>
              </button>
            </div>
          </div>

          {/* 3. Straighten (-15..15) */}
          <div className="bg-[#191c20] p-3 rounded border border-[#272b31] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-indigo-400 text-[16px]">straighten</span>
                <span>Căn thẳng đường chân trời</span>
              </span>
              <span className="font-mono text-indigo-400 text-[11px]">
                {straightenAngle > 0 ? `+${straightenAngle}` : straightenAngle}°
              </span>
            </div>

            <p className="text-[11px] text-zinc-400 leading-snug">
              Xoay tinh chỉnh góc nghiêng (-15° đến +15°) và tự động cắt nội tiếp để loại bỏ viền đen.
            </p>

            <div className="space-y-1">
              <input
                type="range"
                min="-15"
                max="15"
                step="0.5"
                value={straightenAngle}
                onChange={(e) => setStraightenAngle(Number(e.target.value))}
                className="w-full accent-indigo-400 cursor-pointer"
              />
              <div className="flex justify-between text-[9px] font-mono text-zinc-500">
                <span>-15°</span>
                <button
                  type="button"
                  onClick={() => setStraightenAngle(0)}
                  className="text-zinc-400 hover:text-white"
                >
                  0° (Đặt lại)
                </button>
                <span>+15°</span>
              </div>
            </div>

            <div className="p-2 rounded bg-[#15181c] border border-[#282d33] text-[10px] text-zinc-400 flex items-start gap-1.5">
              <span className="material-symbols-outlined text-[14px] text-amber-400 shrink-0 mt-0.5">
                info
              </span>
              <span>
                <b>Lưu ý kỹ thuật:</b> Thao tác xoay góc tự do đòi hỏi nội suy lại điểm ảnh (resampling) để khử răng cưa và cắt viền, không thể giữ nguyên 100% pixel gốc như phép xoay 90°.
              </span>
            </div>

            <button
              type="button"
              onClick={handlePreviewStraighten}
              disabled={!image || straightenAngle === 0 || isProcessing}
              className="w-full py-1.5 bg-[#22252a] hover:bg-[#2b3036] disabled:opacity-50 text-zinc-200 rounded text-xs font-medium border border-[#30353c] flex items-center justify-center gap-1"
            >
              <span>Xem trước căn thẳng ({straightenAngle}°)</span>
            </button>
          </div>
        </div>
      )}

      {/* SECTION 2: MỞ RỘNG KHUNG AI (OUTPAINT) */}
      {subSection === 'ai_expand' && (
        <div className="space-y-3.5">
          <div className="bg-[#1b2520] p-2.5 rounded border border-[#2d4036] flex items-start gap-2 text-[11px] text-[#55c7b0]">
            <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">verified</span>
            <div className="leading-snug">
              <b>Bảo toàn nguyên bản:</b> Khung ảnh chỉ mở rộng ra ngoài mà không thu nhỏ hay cắt ảnh gốc. Từng điểm ảnh RGBA của ảnh gốc được bảo tồn nguyên vẹn 100% tại vị trí neo đã chọn.
            </div>
          </div>

          {/* Aspect & Target Size Presets */}
          <div className="bg-[#191c20] p-3 rounded border border-[#272b31] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-200 text-[11px]">Tỷ lệ đích:</span>
              <span className="text-[10px] font-mono text-[#55c7b0]">Canvas Outpaint</span>
            </div>

            <div className="grid grid-cols-5 gap-1 text-[10px] font-medium">
              {(
                [
                  { id: '16:9', label: '16:9' },
                  { id: '9:16', label: '9:16' },
                  { id: '1:1', label: '1:1' },
                  { id: '4:3', label: '4:3' },
                  { id: 'custom', label: 'Tự chọn' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={isExpanding}
                  onClick={() => setExpandPreset(p.id)}
                  className={`py-1 rounded border transition-colors ${
                    expandPreset === p.id
                      ? 'bg-[#1b2622] border-[#55c7b0] text-[#55c7b0]'
                      : 'bg-[#141618] border-[#292d33] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Numeric Size Inputs */}
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1">
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Rộng (px):</label>
                <input
                  type="number"
                  disabled={isExpanding}
                  min={image?.width || 100}
                  value={targetWidth}
                  onChange={(e) => {
                    setExpandPreset('custom');
                    setTargetWidth(Math.max(image?.width || 1, Number(e.target.value)));
                  }}
                  className="w-full bg-[#141618] border border-[#2d3238] rounded px-2 py-1 text-zinc-100 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Cao (px):</label>
                <input
                  type="number"
                  disabled={isExpanding}
                  min={image?.height || 100}
                  value={targetHeight}
                  onChange={(e) => {
                    setExpandPreset('custom');
                    setTargetHeight(Math.max(image?.height || 1, Number(e.target.value)));
                  }}
                  className="w-full bg-[#141618] border border-[#2d3238] rounded px-2 py-1 text-zinc-100 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Before vs After dimensions and safe memory check */}
            <div className="bg-[#141618] p-2 rounded border border-[#282d33] space-y-1 text-[10px]">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Gốc:</span>
                <span className="font-mono text-zinc-300">
                  {image?.width || 0} × {image?.height || 0} px
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Đích mở rộng:</span>
                <span className={`font-mono font-semibold ${memCheck.safe ? 'text-[#55c7b0]' : 'text-rose-400'}`}>
                  {targetWidth} × {targetHeight} px ({(targetPixels / 1_000_000).toFixed(1)} MP)
                </span>
              </div>
              {!memCheck.safe && (
                <div className="text-rose-400 pt-1 border-t border-[#352528] leading-tight">
                  {memCheck.message}
                </div>
              )}
            </div>
          </div>

          {/* Anchor Matrix Selector (3x3 grid) */}
          <div className="bg-[#191c20] p-3 rounded border border-[#272b31] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-200 text-[11px]">Vị trí neo ảnh gốc:</span>
              <span className="text-[10px] font-mono text-zinc-400">
                Lệch ({anchorOffset.offsetX}, {anchorOffset.offsetY}) px
              </span>
            </div>

            <div className="flex items-center justify-center py-1">
              <div className="grid grid-cols-3 gap-1 bg-[#141618] p-1.5 rounded border border-[#282d33]">
                {(
                  [
                    'top-left',
                    'top',
                    'top-right',
                    'left',
                    'center',
                    'right',
                    'bottom-left',
                    'bottom',
                    'bottom-right',
                  ] as ExpandAnchor[]
                ).map((anchor) => (
                  <button
                    key={anchor}
                    type="button"
                    disabled={isExpanding}
                    onClick={() => setExpandAnchor(anchor)}
                    className={`w-7 h-7 rounded flex items-center justify-center transition-all ${
                      expandAnchor === anchor
                        ? 'bg-[#55c7b0] text-[#0d1815] shadow-sm'
                        : 'bg-[#1e2226] text-zinc-400 hover:text-zinc-200 hover:bg-[#252a30]'
                    } disabled:opacity-50`}
                    title={`Neo tại: ${anchor}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-current" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* AI Model & Direction */}
          <div className="bg-[#191c20] p-3 rounded border border-[#272b31] space-y-2">
            <span className="font-semibold text-zinc-200 text-[11px]">Mô hình AI:</span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={isExpanding}
                onClick={() => setExpandModel('🍌 Nano Banana Pro')}
                className={`py-1.5 px-2 rounded text-left border transition-all ${
                  expandModel === '🍌 Nano Banana Pro'
                    ? 'bg-[#1b2722] border-[#55c7b0] text-[#55c7b0]'
                    : 'bg-[#16181b] border-[#292d33] text-zinc-400 hover:text-zinc-200'
                } disabled:opacity-50`}
              >
                <div className="font-semibold text-[10px]">🍌 Nano Banana Pro</div>
                <div className="text-[9px] opacity-70">Mặc định • Độ nét cao</div>
              </button>
              <button
                type="button"
                disabled={isExpanding}
                onClick={() => setExpandModel('🍌 Nano Banana 2.1')}
                className={`py-1.5 px-2 rounded text-left border transition-all ${
                  expandModel === '🍌 Nano Banana 2.1'
                    ? 'bg-[#1b2722] border-[#55c7b0] text-[#55c7b0]'
                    : 'bg-[#16181b] border-[#292d33] text-zinc-400 hover:text-zinc-200'
                } disabled:opacity-50`}
              >
                <div className="font-semibold text-[10px]">🍌 Nano Banana 2.1</div>
                <div className="text-[9px] opacity-70">Tùy chọn nhanh</div>
              </button>
            </div>
          </div>

          {/* User Prompt */}
          <div className="bg-[#191c20] p-3 rounded border border-[#272b31] space-y-2">
            <span className="font-semibold text-zinc-200 text-[11px]">
              Chỉ dẫn bối cảnh mở rộng (Tùy chọn):
            </span>
            <textarea
              disabled={isExpanding}
              value={expandPrompt}
              onChange={(e) => setExpandPrompt(e.target.value)}
              placeholder="Ví dụ: mở rộng thêm bầu trời nắng xanh ở trên và bãi cát ở hai bên..."
              rows={2}
              className="w-full bg-[#141618] border border-[#2d3238] rounded p-2 text-zinc-200 text-xs focus:border-[#55c7b0] outline-none resize-none disabled:opacity-50"
            />
          </div>

          {/* Action Buttons: Generate & Visible Cancel */}
          {!isExpanding ? (
            <button
              type="button"
              onClick={handleGenerateAiExpand}
              disabled={!image || isProcessing || !memCheck.safe}
              className="w-full py-2 bg-[#55c7b0] hover:bg-[#48b59f] disabled:opacity-50 text-[#0d1815] font-bold rounded text-xs transition-colors flex items-center justify-center gap-1.5 shadow-lg"
            >
              <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
              <span>Tạo mở rộng khung hình AI</span>
            </button>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 p-2 bg-[#1a232c] border border-[#2f3f50] rounded text-xs text-zinc-200">
                <div className="w-4 h-4 border-2 border-[#55c7b0] border-t-transparent rounded-full animate-spin shrink-0" />
                <span className="truncate">Đang tạo mở rộng khung ảnh...</span>
              </div>
              <button
                type="button"
                onClick={handleCancelAiExpand}
                className="w-full py-2 bg-rose-950/70 hover:bg-rose-900 border border-rose-700/80 text-rose-200 font-semibold rounded text-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">cancel</span>
                <span>Hủy tiến trình mở rộng AI</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
