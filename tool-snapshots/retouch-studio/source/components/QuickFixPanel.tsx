import React, { useState } from 'react';
import { DecodedImage, CandidatePreview, ColorAdjustmentParams } from '../types';
import { autoEnhance } from '../services/autoEnhanceService';
import { detectFaceContours, applyFaceSlim, FaceContour } from '../services/faceSlimService';
import { applyLocalWaistSlimming } from '../services/bodyReshapeService';
import { previewBlurBackground, previewRemoveBackground } from '../services/backgroundToolsService';
import { processColorAndQuality } from '../services/colorQualityService';
import { autoSelectPersonMask } from '../services/personPointsService';

interface QuickFixPanelProps {
  image: DecodedImage | null;
  selectionMask: HTMLCanvasElement | null;
  protectionMask: HTMLCanvasElement | null;
  selectionPixels: number;
  currentRevision: number;
  onSetCandidatePreview: (preview: CandidatePreview | null) => void;
  ensureFaceProtectionPreflight: () => Promise<{ success: boolean; effectiveMask: HTMLCanvasElement | null }>;
  isProcessing: boolean;
  onRequestBusyToken: (msg: string) => number;
  onReleaseBusyToken: (token: number) => void;
  onShowToast: (msg: string) => void;
  onLogDiagnostic: (type: 'info' | 'success' | 'warn' | 'error', msg: string, details?: string) => void;
}

export const QuickFixPanel: React.FC<QuickFixPanelProps> = ({
  image,
  selectionMask,
  protectionMask,
  selectionPixels,
  currentRevision,
  onSetCandidatePreview,
  ensureFaceProtectionPreflight,
  isProcessing,
  onRequestBusyToken,
  onReleaseBusyToken,
  onShowToast,
  onLogDiagnostic,
}) => {
  // Gọn mặt params: mặc định đổi từ 8 thành 12 (thanh vẫn 1..15%)
  const [faceSlimStrength, setFaceSlimStrength] = useState(12);
  const [faceTargetMode, setFaceTargetMode] = useState<'largest' | 'all'>('largest');

  // Thon gọn thân params
  const [bodySlimStrength, setBodySlimStrength] = useState(15); // 0..30, default 15%

  const [activeAction, setActiveAction] = useState<string | null>(null);

  // 1. Tự động làm đẹp ảnh (autoEnhance)
  const handleAutoEnhance = async () => {
    if (!image) return;
    setActiveAction('enhance');
    const token = onRequestBusyToken('Đang tự động cân bằng sáng, màu sắc và độ tương phản...');
    try {
      const preflight = await ensureFaceProtectionPreflight();
      if (!preflight.success || !preflight.effectiveMask) {
        throw new Error('Bảo vệ khuôn mặt không thành công.');
      }

      const enhancedCanvas = await autoEnhance(
        image.canvas,
        preflight.effectiveMask,
        (pct) => onLogDiagnostic('info', `Tự động chỉnh ảnh: ${pct}%`)
      );

      const preview: CandidatePreview = {
        type: 'color_quality',
        canvas: enhancedCanvas,
        title: 'Tự động làm đẹp ảnh (1-Click)',
        description: 'Tự động giãn mức sáng, cân bằng trắng gray-world và gamma; khuôn mặt được khóa nguyên vẹn 100%.',
        sourceRevision: currentRevision,
      };

      onSetCandidatePreview(preview);
      onShowToast('Đã tạo bản xem trước làm đẹp ảnh.');
      onLogDiagnostic('success', 'Hoàn tất tự động làm đẹp ảnh (không thay đổi khuôn mặt bảo vệ).');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      onShowToast(`Lỗi: ${msg}`);
      onLogDiagnostic('error', 'Lỗi tự động làm đẹp', msg);
    } finally {
      onReleaseBusyToken(token);
      setActiveAction(null);
    }
  };

  // 2. Gọn mặt (Face-Aware Liquify)
  const handleFaceSlim = async () => {
    if (!image) return;
    setActiveAction('face_slim');
    const token = onRequestBusyToken('Đang nhận diện giải phẫu viền má/hàm...');
    try {
      const contours = await detectFaceContours(image.canvas, (msg) => {
        onLogDiagnostic('info', msg);
      });

      const facesToProcess: FaceContour[] =
        faceTargetMode === 'largest' ? [contours[0]] : contours;

      let currentCanvas = image.canvas;
      let totalChanged = 0;
      let totalCore = 0;
      let skippedFacesCount = 0;
      let hasMouthDetected = false;

      for (let i = 0; i < facesToProcess.length; i++) {
        const face = facesToProcess[i];
        if (typeof face.mouthLeftX === 'number' || typeof face.mouthRightX === 'number') {
          hasMouthDetected = true;
        }
        onLogDiagnostic('info', `Đang nắn gọn má/hàm mặt ${i + 1}/${facesToProcess.length}...`);
        const otherFaces = contours.filter((c) => c !== face);
        const res = applyFaceSlim(currentCanvas, face, faceSlimStrength, otherFaces);
        if (res.skippedFace) {
          skippedFacesCount++;
        } else {
          currentCanvas = res.outputCanvas;
          totalChanged += res.changedPixelCount;
          totalCore += res.coreCount;
        }
      }

      if (skippedFacesCount === facesToProcess.length) {
        throw new Error('Không thể gọn mặt an toàn: mặt quá sát người khác. Hãy khoanh vùng thủ công.');
      }

      const mouthNote = hasMouthDetected ? ', lõi mở tới khoé miệng' : '';
      const skippedNote =
        skippedFacesCount > 0
          ? ` Bỏ qua ${skippedFacesCount} mặt vì sát mặt người khác (tránh làm lệch mặt và chạm người bên cạnh).`
          : '';

      const preview: CandidatePreview = {
        type: 'ai_edit',
        canvas: currentCanvas,
        title: `Gọn mặt (${faceSlimStrength}%)`,
        description: `Giữ nguyên 100% vùng mắt-mũi-miệng (${totalCore.toLocaleString()} px${mouthNote}). Đã gọn viền má/hàm (${totalChanged.toLocaleString()} px).${skippedNote}`,
        sourceRevision: currentRevision,
        diagnostics: {
          durationMs: 0,
          modelUsed: 'Face-Aware Liquify (Biên giải phẫu má/hàm)',
          protectedPreservedPixels: totalCore,
          outsideMaskPreservedPixels: 0,
          editablePixels: totalChanged,
          changedPixelCount: totalChanged,
          sourceDimensions: { width: image.width, height: image.height },
          outputDimensions: { width: image.width, height: image.height },
          mappingInfo: `Face-Aware Liquify: ${facesToProcess.length} khuôn mặt, cường độ ${faceSlimStrength}%, skippedFaces: ${skippedFacesCount}`,
        },
      };

      onSetCandidatePreview(preview);
      onShowToast(`Đã nắn gọn mặt (${faceSlimStrength}%). Lõi mắt-mũi-miệng giữ nguyên 100%.`);
      onLogDiagnostic(
        'success',
        `Hoàn tất Gọn mặt: ${facesToProcess.length} mặt, đổi ${totalChanged.toLocaleString()} px viền, 0 px vùng lõi, bỏ qua ${skippedFacesCount} mặt sát người khác.`
      );
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      onShowToast(`Lỗi gọn mặt: ${msg}`);
      onLogDiagnostic('error', 'Lỗi gọn mặt', msg);
    } finally {
      onReleaseBusyToken(token);
      setActiveAction(null);
    }
  };

  // 3. Thon gọn thân
  const handleBodySlim = async () => {
    if (!image) return;
    setActiveAction('body_slim');
    const token = onRequestBusyToken('Đang chuẩn bị vùng thân...');
    try {
      const preflight = await ensureFaceProtectionPreflight();
      if (!preflight.success || !preflight.effectiveMask) {
        throw new Error('Bảo vệ khuôn mặt không thành công.');
      }
      const effectiveProt = preflight.effectiveMask;

      let targetSelMask: HTMLCanvasElement;

      // Nếu đã có vùng chọn, dùng vùng chọn hiện có
      if (selectionPixels > 0 && selectionMask) {
        targetSelMask = selectionMask;
      } else {
        // Lấy mặt lớn nhất f, D, dải dọc bodyTop = chinY + 0.1*D, bodyBottom = chinY + 6.0*D
        const contours = await detectFaceContours(image.canvas);
        const f = contours[0];
        const D = f.chinY - f.eyeY;
        const faceW = f.rightX - f.leftX;
        const bodyTop = Math.max(0, Math.floor(f.chinY + 0.1 * D));
        const bodyBottom = Math.min(image.height - 1, Math.ceil(f.chinY + 6.0 * D));

        let usedPersonMask = false;
        try {
          const personMask = await autoSelectPersonMask(
            image.canvas,
            currentRevision,
            (msg) => onLogDiagnostic('info', msg)
          );

          // Tạo bodyMask = personMask nhưng tô đen mọi hàng ngoài [bodyTop, bodyBottom]
          const bodyMask = document.createElement('canvas');
          bodyMask.width = image.width;
          bodyMask.height = image.height;
          const bCtx = bodyMask.getContext('2d', { willReadFrequently: true });
          if (!bCtx) throw new Error('Không thể tạo bộ đệm mặt nạ thân.');
          bCtx.drawImage(personMask, 0, 0);

          const bImgData = bCtx.getImageData(0, 0, image.width, image.height);
          const bData = bImgData.data;
          let remainingPixels = 0;

          for (let y = 0; y < image.height; y++) {
            const rowOffset = y * image.width;
            const inRange = y >= bodyTop && y <= bodyBottom;
            for (let x = 0; x < image.width; x++) {
              const idx = (rowOffset + x) * 4;
              if (!inRange) {
                bData[idx] = 0;
                bData[idx + 1] = 0;
                bData[idx + 2] = 0;
                bData[idx + 3] = 255;
              } else if (bData[idx] > 127) {
                remainingPixels++;
              }
            }
          }
          bCtx.putImageData(bImgData, 0, 0);

          const totalImgPixels = image.width * image.height;
          if (remainingPixels >= 0.02 * totalImgPixels) {
            targetSelMask = bodyMask;
            usedPersonMask = true;
            onLogDiagnostic('info', 'Thon gọn thân: dùng mặt nạ người tự khoanh');
          } else {
            throw new Error('Mặt nạ thân người còn dưới 2% số pixel ảnh.');
          }
        } catch {
          // Khung chữ nhật dự phòng
          const bodyLeft = Math.max(0, Math.floor(f.noseX - 1.75 * faceW));
          const bodyRight = Math.min(image.width - 1, Math.ceil(f.noseX + 1.75 * faceW));

          const bodyMask = document.createElement('canvas');
          bodyMask.width = image.width;
          bodyMask.height = image.height;
          const bCtx = bodyMask.getContext('2d');
          if (!bCtx) throw new Error('Không thể tạo bộ đệm mặt nạ thân.');
          bCtx.fillStyle = '#000000';
          bCtx.fillRect(0, 0, image.width, image.height);
          bCtx.fillStyle = '#ffffff';
          bCtx.fillRect(bodyLeft, bodyTop, bodyRight - bodyLeft + 1, bodyBottom - bodyTop + 1);

          targetSelMask = bodyMask;
          onLogDiagnostic('info', 'Thon gọn thân: dùng khung ước lượng từ mặt');
        }
      }

      const res = applyLocalWaistSlimming(image.canvas, targetSelMask, effectiveProt, {
        strengthPercent: bodySlimStrength,
      });

      const preview: CandidatePreview = {
        type: 'ai_edit',
        canvas: res.outputCanvas,
        title: `Thon gọn thân (${bodySlimStrength}%)`,
        description: `Thu gọn thân tự nhiên: ${bodySlimStrength}%. Đã đổi ${res.changedPixelCount.toLocaleString()} px. Mặt được bảo vệ tuyệt đối.`,
        sourceRevision: currentRevision,
        diagnostics: {
          durationMs: 0,
          modelUsed: 'Nắn thon gọn thân cục bộ (Local waist slimming)',
          protectedPreservedPixels: res.protectedPreservedCount,
          outsideMaskPreservedPixels: res.outsidePreservedCount,
          editablePixels: res.editableCount,
          changedPixelCount: res.changedPixelCount,
          sourceDimensions: { width: image.width, height: image.height },
          outputDimensions: { width: image.width, height: image.height },
          mappingInfo: `Thon gọn thân ${bodySlimStrength}%`,
        },
      };

      onSetCandidatePreview(preview);
      onShowToast(`Đã tạo bản xem trước thon gọn thân (${bodySlimStrength}%).`);
      onLogDiagnostic('success', `Hoàn tất thon gọn thân: ${res.changedPixelCount.toLocaleString()} px.`);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      onShowToast(`Lỗi thon gọn thân: ${msg}`);
      onLogDiagnostic('error', 'Lỗi thon gọn thân', msg);
    } finally {
      onReleaseBusyToken(token);
      setActiveAction(null);
    }
  };

  // Helper tách người tự động nếu chưa có vùng chọn
  const ensurePersonSelection = async (effectiveProt: HTMLCanvasElement): Promise<HTMLCanvasElement> => {
    if (selectionPixels > 0 && selectionMask) {
      return selectionMask;
    }
    if (!image) throw new Error('Chưa có ảnh.');

    return await autoSelectPersonMask(
      image.canvas,
      currentRevision,
      (msg) => onLogDiagnostic('info', msg)
    );
  };

  // 4. Làm mờ phông (radius 14)
  const handleBlurBackground = async () => {
    if (!image) return;
    setActiveAction('blur_bg');
    const token = onRequestBusyToken('Đang xử lý làm mờ hậu cảnh...');
    try {
      const preflight = await ensureFaceProtectionPreflight();
      if (!preflight.success || !preflight.effectiveMask) {
        throw new Error('Bảo vệ khuôn mặt không thành công.');
      }
      const effectiveProt = preflight.effectiveMask;
      const targetSel = await ensurePersonSelection(effectiveProt);

      const res = previewBlurBackground(image.canvas, targetSel, effectiveProt, { radius: 14 });
      onSetCandidatePreview({ ...res, sourceRevision: currentRevision });
      onShowToast('Đã tạo bản xem trước làm mờ phông (14px).');
      onLogDiagnostic('success', 'Hoàn tất tạo bản xem trước làm mờ phông.');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      onShowToast(`Lỗi làm mờ phông: ${msg}`);
      onLogDiagnostic('error', 'Lỗi làm mờ phông', msg);
    } finally {
      onReleaseBusyToken(token);
      setActiveAction(null);
    }
  };

  // 5. Tách nền (PNG Alpha)
  const handleRemoveBackground = async () => {
    if (!image) return;
    setActiveAction('remove_bg');
    const token = onRequestBusyToken('Đang tách chủ thể khỏi nền...');
    try {
      const preflight = await ensureFaceProtectionPreflight();
      if (!preflight.success || !preflight.effectiveMask) {
        throw new Error('Bảo vệ khuôn mặt không thành công.');
      }
      const effectiveProt = preflight.effectiveMask;
      const targetSel = await ensurePersonSelection(effectiveProt);

      const res = previewRemoveBackground(image.canvas, targetSel, effectiveProt);
      onSetCandidatePreview({ ...res, sourceRevision: currentRevision });
      onShowToast('Đã tạo bản xem trước tách nền trong suốt.');
      onLogDiagnostic('success', 'Hoàn tất tách nền.');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      onShowToast(`Lỗi tách nền: ${msg}`);
      onLogDiagnostic('error', 'Lỗi tách nền', msg);
    } finally {
      onReleaseBusyToken(token);
      setActiveAction(null);
    }
  };

  // 6. Làm nét nhẹ (sharpen 25)
  const handleLightSharpen = async () => {
    if (!image) return;
    setActiveAction('sharpen');
    const token = onRequestBusyToken('Đang xử lý làm nét nhẹ ảnh...');
    try {
      const preflight = await ensureFaceProtectionPreflight();
      if (!preflight.success || !preflight.effectiveMask) {
        throw new Error('Bảo vệ khuôn mặt không thành công.');
      }
      const params: ColorAdjustmentParams = {
        brightness: 0,
        exposure: 0,
        contrast: 0,
        saturation: 0,
        temperature: 0,
        tint: 0,
        highlights: 0,
        shadows: 0,
        sharpen: 25,
        denoise: 0,
      };

      const effMask = selectionPixels > 0 ? selectionMask : null;
      const resCanvas = await processColorAndQuality(
        image.canvas,
        effMask,
        preflight.effectiveMask,
        params
      );

      const preview: CandidatePreview = {
        type: 'color_quality',
        canvas: resCanvas,
        title: 'Làm nét nhẹ (Sharpen +25)',
        description: 'Tăng chi tiết các cạnh và nếp nhăn tự nhiên, giữ nguyên khuôn mặt được bảo vệ.',
        sourceRevision: currentRevision,
      };

      onSetCandidatePreview(preview);
      onShowToast('Đã tạo bản xem trước làm nét nhẹ.');
      onLogDiagnostic('success', 'Hoàn tất làm nét nhẹ.');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      onShowToast(`Lỗi: ${msg}`);
      onLogDiagnostic('error', 'Lỗi làm nét', msg);
    } finally {
      onReleaseBusyToken(token);
      setActiveAction(null);
    }
  };

  // 7. Giảm nhiễu (denoise 30)
  const handleDenoise = async () => {
    if (!image) return;
    setActiveAction('denoise');
    const token = onRequestBusyToken('Đang khử nhiễu hạt bảo toàn cạnh...');
    try {
      const preflight = await ensureFaceProtectionPreflight();
      if (!preflight.success || !preflight.effectiveMask) {
        throw new Error('Bảo vệ khuôn mặt không thành công.');
      }
      const params: ColorAdjustmentParams = {
        brightness: 0,
        exposure: 0,
        contrast: 0,
        saturation: 0,
        temperature: 0,
        tint: 0,
        highlights: 0,
        shadows: 0,
        sharpen: 0,
        denoise: 30,
      };

      const effMask = selectionPixels > 0 ? selectionMask : null;
      const resCanvas = await processColorAndQuality(
        image.canvas,
        effMask,
        preflight.effectiveMask,
        params
      );

      const preview: CandidatePreview = {
        type: 'color_quality',
        canvas: resCanvas,
        title: 'Giảm nhiễu (Denoise 30)',
        description: 'Lọc mịn nhiễu hạt cảm biến nhưng bảo toàn đường viền chi tiết, mặt được bảo vệ.',
        sourceRevision: currentRevision,
      };

      onSetCandidatePreview(preview);
      onShowToast('Đã tạo bản xem trước giảm nhiễu.');
      onLogDiagnostic('success', 'Hoàn tất giảm nhiễu.');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      onShowToast(`Lỗi: ${msg}`);
      onLogDiagnostic('error', 'Lỗi giảm nhiễu', msg);
    } finally {
      onReleaseBusyToken(token);
      setActiveAction(null);
    }
  };

  const isBusy = isProcessing || activeAction !== null;

  return (
    <div className="bg-[#181b1e] p-2.5 rounded border border-[#272b31] space-y-2.5">
      <div className="flex items-center justify-between border-b border-[#24282c] pb-1.5">
        <span className="font-semibold text-zinc-100 flex items-center gap-1.5 text-xs">
          <span className="material-symbols-outlined text-[16px] text-[#55c7b0]">flash_on</span>
          <span>Sửa nhanh 1 click</span>
        </span>
        <span className="text-[9.5px] font-mono text-[#55c7b0] bg-[#1a2b25] px-1.5 py-0.5 rounded border border-[#55c7b0]/30">
          Instant
        </span>
      </div>

      {/* Button 1: Tự động làm đẹp ảnh */}
      <button
        type="button"
        disabled={!image || isBusy}
        onClick={handleAutoEnhance}
        className="w-full py-2 px-2.5 bg-[#1f2b26] hover:bg-[#283d35] active:bg-[#182420] disabled:opacity-40 text-[#55c7b0] border border-[#55c7b0]/40 rounded text-xs font-semibold flex items-center justify-between transition-colors shadow-sm"
      >
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">auto_fix_high</span>
          <span>Tự động làm đẹp ảnh</span>
        </div>
        <span className="text-[10px] text-zinc-400 font-mono">Khóa mặt 100%</span>
      </button>

      {/* Control 2: Gọn mặt (Face-Aware Liquify) */}
      <div className="bg-[#141618] p-2 rounded border border-[#272b31] space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-200 font-medium flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-rose-400">face</span>
            <span>Gọn mặt (Face-Aware)</span>
          </span>
          <span className="font-mono text-rose-300 font-bold text-xs">{faceSlimStrength}%</span>
        </div>

        <input
          type="range"
          min="1"
          max="15"
          value={faceSlimStrength}
          disabled={isBusy}
          onChange={(e) => setFaceSlimStrength(Number(e.target.value))}
          className="w-full accent-rose-400 cursor-pointer h-1.5"
        />

        <div className="flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setFaceTargetMode('largest')}
              className={`px-1.5 py-0.5 rounded border text-[9.5px] transition-colors ${
                faceTargetMode === 'largest'
                  ? 'bg-rose-950/60 border-rose-500/60 text-rose-300 font-semibold'
                  : 'bg-[#181a1d] border-[#292d33] text-zinc-400'
              }`}
            >
              Mặt lớn nhất
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setFaceTargetMode('all')}
              className={`px-1.5 py-0.5 rounded border text-[9.5px] transition-colors ${
                faceTargetMode === 'all'
                  ? 'bg-rose-950/60 border-rose-500/60 text-rose-300 font-semibold'
                  : 'bg-[#181a1d] border-[#292d33] text-zinc-400'
              }`}
            >
              Tất cả mặt
            </button>
          </div>

          <button
            type="button"
            disabled={!image || isBusy}
            onClick={handleFaceSlim}
            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-bold rounded text-[10.5px] transition-colors shadow"
          >
            Gọn mặt
          </button>
        </div>

        <p className="text-[9.5px] text-zinc-500 leading-tight">
          * Nắn viền má/hàm. Lõi mắt, lông mày, mũi, miệng giữ nguyên pixel 100%.
        </p>
      </div>

      {/* Control 3: Thon gọn thân */}
      <div className="bg-[#141618] p-2 rounded border border-[#272b31] space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-200 font-medium flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-cyan-400">accessibility_new</span>
            <span>Thon gọn thân</span>
          </span>
          <span className="font-mono text-cyan-300 font-bold text-xs">{bodySlimStrength}%</span>
        </div>

        <input
          type="range"
          min="1"
          max="30"
          value={bodySlimStrength}
          disabled={isBusy}
          onChange={(e) => setBodySlimStrength(Number(e.target.value))}
          className="w-full accent-cyan-400 cursor-pointer h-1.5"
        />

        <div className="flex items-center justify-between text-[10px]">
          <span className="text-zinc-500 text-[9.5px]">
            {selectionPixels > 0 ? 'Dùng vùng chọn' : 'Tự dựng khung thân'}
          </span>
          <button
            type="button"
            disabled={!image || isBusy}
            onClick={handleBodySlim}
            className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-black font-bold rounded text-[10.5px] transition-colors shadow"
          >
            Thon gọn thân
          </button>
        </div>
      </div>

      {/* Grid 4 nút tiện ích: Làm mờ phông, Tách nền, Làm nét nhẹ, Giảm nhiễu */}
      <div className="grid grid-cols-2 gap-1.5 pt-1">
        <button
          type="button"
          disabled={!image || isBusy}
          onClick={handleBlurBackground}
          className="py-1.5 px-2 bg-[#1b2025] hover:bg-[#242b32] disabled:opacity-40 text-zinc-200 rounded text-[11px] font-medium border border-[#2c333c] flex items-center justify-center gap-1 transition-colors"
          title="Làm mờ phông (radius 14, tự chọn người nếu chưa chọn)"
        >
          <span className="material-symbols-outlined text-[14px] text-indigo-400">blur_on</span>
          <span>Làm mờ phông</span>
        </button>

        <button
          type="button"
          disabled={!image || isBusy}
          onClick={handleRemoveBackground}
          className="py-1.5 px-2 bg-[#1b2025] hover:bg-[#242b32] disabled:opacity-40 text-zinc-200 rounded text-[11px] font-medium border border-[#2c333c] flex items-center justify-center gap-1 transition-colors"
          title="Tách nền trong suốt Alpha (tự chọn người nếu chưa chọn)"
        >
          <span className="material-symbols-outlined text-[14px] text-pink-400">crop_free</span>
          <span>Tách nền</span>
        </button>

        <button
          type="button"
          disabled={!image || isBusy}
          onClick={handleLightSharpen}
          className="py-1.5 px-2 bg-[#1b2025] hover:bg-[#242b32] disabled:opacity-40 text-zinc-200 rounded text-[11px] font-medium border border-[#2c333c] flex items-center justify-center gap-1 transition-colors"
          title="Làm nét nhẹ (+25 sharpen, khóa mặt bảo vệ)"
        >
          <span className="material-symbols-outlined text-[14px] text-amber-400">high_density</span>
          <span>Làm nét nhẹ</span>
        </button>

        <button
          type="button"
          disabled={!image || isBusy}
          onClick={handleDenoise}
          className="py-1.5 px-2 bg-[#1b2025] hover:bg-[#242b32] disabled:opacity-40 text-zinc-200 rounded text-[11px] font-medium border border-[#2c333c] flex items-center justify-center gap-1 transition-colors"
          title="Giảm nhiễu hạt (+30 denoise, khóa mặt bảo vệ)"
        >
          <span className="material-symbols-outlined text-[14px] text-emerald-400">tune</span>
          <span>Giảm nhiễu</span>
        </button>
      </div>
    </div>
  );
};
