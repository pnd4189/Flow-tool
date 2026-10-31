import React, { useState, useRef, useEffect } from 'react';
import {
  DecodedImage,
  RightTab,
  CandidatePreview,
  AiEditMode,
  SupportedImageModel,
  ColorAdjustmentParams,
  CropRect,
} from '../types';
import {
  AI_EDIT_MODES_CONFIG,
  computeEditableBoundingBox,
  calculateCropAndPaddingTransform,
  preparePaddedReferences,
  mapGeneratedCropToSource,
  compositeAiEditResult,
  analyzeEditArtifacts,
  inspectAiEditPreview,
} from '../services/aiEditService';
import {
  applyLocalWaistSlimming,
} from '../services/bodyReshapeService';
import {
  generateAiBackdrop,
  AiBackgroundOptions,
} from '../services/aiBackgroundService';
import {
  previewRemoveBackground,
  previewSolidColorBackground,
  previewGradientBackground,
  previewImageReplaceBackground,
  previewBlurBackground,
} from '../services/backgroundToolsService';
import {
  DEFAULT_COLOR_PARAMS,
  hasActiveAdjustments,
  processColorAndQuality,
} from '../services/colorQualityService';
import {
  detectFaceContours,
  applyFaceSlim,
} from '../services/faceSlimService';
import {
  autoEnhance,
} from '../services/autoEnhanceService';
import {
  routeByRules,
  routeWithAI,
  RoutedOp,
} from '../services/requestRouter';
import {
  autoSelectPersonMask,
} from '../services/personPointsService';
import { ColorQualityPanel } from './ColorQualityPanel';
import { CompositionPanel } from './CompositionPanel';
import { BackgroundPanel } from './BackgroundPanel';
import { QuickFixPanel } from './QuickFixPanel';
import { Flow } from 'flow-sdk';

interface RightSidebarProps {
  image: DecodedImage | null;
  selectionMask: HTMLCanvasElement | null;
  protectionMask: HTMLCanvasElement | null;
  selectionPixels: number;
  protectionPixels: number;
  protectFaceToggle: boolean;
  onToggleProtectFace: (checked: boolean) => void;
  onDetectFacesAI: () => Promise<{ success: boolean; effectiveMask: HTMLCanvasElement | null }>;
  ensureFaceProtectionPreflight: () => Promise<{ success: boolean; effectiveMask: HTMLCanvasElement | null }>;
  isDetectingFaces: boolean;
  hasDetectedFacesOnce: boolean;
  candidatePreview: CandidatePreview | null;
  onSetCandidatePreview: (preview: CandidatePreview | null) => void;
  onApplyCandidatePreview: () => void;
  onCancelCandidatePreview: () => void;
  isProcessing: boolean;
  onInvertSelection: () => void;
  currentRevision: number;
  onLogDiagnostic: (type: 'info' | 'success' | 'warn' | 'error', msg: string, details?: string) => void;
  onRequestBusyToken: (msg: string) => number;
  onReleaseBusyToken: (token: number) => void;
  onShowToast: (msg: string) => void;
  colorParams: ColorAdjustmentParams;
  onChangeColorParams: (params: ColorAdjustmentParams) => void;
  onResetColorParams: () => void;
  onApplyColorAdjustments: () => Promise<void>;
  onCancelColorAdjustments: () => void;
  cropRect: CropRect | null;
  onChangeCropRect: (rect: CropRect | null) => void;
  isCropActive: boolean;
  onToggleCropActive: (active: boolean) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  dilationRadius?: number;
  onChangeDilationRadius?: (r: number) => void;
  onExpandReshapeSelection?: () => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  image,
  selectionMask,
  protectionMask,
  selectionPixels,
  protectionPixels,
  protectFaceToggle,
  onToggleProtectFace,
  onDetectFacesAI,
  ensureFaceProtectionPreflight,
  isDetectingFaces,
  candidatePreview,
  onSetCandidatePreview,
  onApplyCandidatePreview,
  onCancelCandidatePreview,
  isProcessing,
  onInvertSelection,
  currentRevision,
  onLogDiagnostic,
  onRequestBusyToken,
  onReleaseBusyToken,
  onShowToast,
  colorParams,
  onChangeColorParams,
  onResetColorParams,
  onApplyColorAdjustments,
  onCancelColorAdjustments,
  cropRect,
  onChangeCropRect,
  isCropActive,
  onToggleCropActive,
  isCollapsed = false,
  onToggleCollapse,
  dilationRadius = 0,
  onChangeDilationRadius,
  onExpandReshapeSelection,
}) => {
  const [activeTab, setActiveTab] = useState<RightTab>('xoa_sua');

  // AI / Edit State - default is prompt_edit
  const [aiMode, setAiMode] = useState<AiEditMode>('prompt_edit');
  const [userPrompt, setUserPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<SupportedImageModel>('🍌 Nano Banana Pro');
  const [localBlendStrength, setLocalBlendStrength] = useState(100);

  // Deterministic Local Waist Slimming state (0..30%, default 15)
  const [waistSlimmingStrength, setWaistSlimmingStrength] = useState(15);

  // Synchronous execution tracking ref & state to prevent duplicate submissions
  const isExecutingAiRef = useRef(false);
  const [isExecutingAiState, setIsExecutingAiState] = useState(false);
  const [aiExecutionStage, setAiExecutionStage] = useState<string>('');

  const currentAiRequestIdRef = useRef<string | null>(null);

  // AI Background State
  const [aiBgPrompt, setAiBgPrompt] = useState('');
  const [aiBgModel, setAiBgModel] = useState<SupportedImageModel>('🍌 Nano Banana Pro');
  const [castContactShadow, setCastContactShadow] = useState(false);
  const [shadowIntensity, setShadowIntensity] = useState(35);
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);

  // Classic Background States
  const [solidColor, setSolidColor] = useState('#ffffff');
  const [gradColor1, setGradColor1] = useState('#2563eb');
  const [gradColor2, setGradColor2] = useState('#ec4899');
  const [gradDir, setGradDir] = useState<'to-bottom' | 'to-right' | 'diagonal'>('diagonal');
  const [blurRadius, setBlurRadius] = useState(14);
  const [replaceFitMode, setReplaceFitMode] = useState<'cover' | 'contain'>('cover');

  // Stored uploaded custom background image canvas & preview data
  const uploadedBgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [uploadedBgFilename, setUploadedBgFilename] = useState<string | null>(null);
  const [uploadedBgThumbnail, setUploadedBgThumbnail] = useState<string | null>(null);

  // Export parameters
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg'>('png');
  const [exportMatteColor, setExportMatteColor] = useState('#ffffff');
  const [exportQuality, setExportQuality] = useState(92);
  const [exportFilename, setExportFilename] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isSavingToFlow, setIsSavingToFlow] = useState(false);

  // Persistent actionable error message
  const [persistentErrorMessage, setPersistentErrorMessage] = useState<string | null>(null);
  // Zero pixel changed persistent warning
  const [zeroChangeWarning, setZeroChangeWarning] = useState<string | null>(null);

  const totalPixels = image ? image.width * image.height : 0;
  const selectionPercent = totalPixels > 0 ? ((selectionPixels / totalPixels) * 100).toFixed(1) : '0';
  const protectionPercent = totalPixels > 0 ? ((protectionPixels / totalPixels) * 100).toFixed(1) : '0';

  const editableBox =
    image && selectionMask && protectionMask
      ? computeEditableBoundingBox(selectionMask, protectionMask)
      : null;
  const hasEditableSelection = editableBox !== null;

  // Synchronize percentage entered in prompt with waist slimming slider
  const handlePromptChange = (val: string) => {
    setUserPrompt(val);
    if (aiMode === 'reshape_body') {
      const match = val.match(/(\d+(?:\.\d+)?)\s*%/);
      if (match) {
        const parsed = Math.round(parseFloat(match[1]));
        const clamped = Math.max(0, Math.min(30, parsed));
        setWaistSlimmingStrength(clamped);
      }
    }
    if (persistentErrorMessage && val.trim()) {
      setPersistentErrorMessage(null);
    }
  };

  // Helper chuyển đổi tên op thành nhãn hiển thị tiếng Việt
  const getOpDisplayName = (op: RoutedOp): string => {
    switch (op.op) {
      case 'face_slim':
        return `Gọn mặt (${op.strength}%)`;
      case 'body_slim':
        return `Thon gọn thân (${op.strength}%)`;
      case 'auto_enhance':
        return 'Tự động làm đẹp';
      case 'color': {
        const parts: string[] = [];
        if (op.params.exposure) parts.push(op.params.exposure > 0 ? `Sáng +${op.params.exposure}` : `Tối ${op.params.exposure}`);
        if (op.params.contrast) parts.push(`Tương phản +${op.params.contrast}`);
        if (op.params.temperature) parts.push(op.params.temperature > 0 ? `Ấm +${op.params.temperature}` : `Lạnh ${op.params.temperature}`);
        if (op.params.saturation) parts.push(op.params.saturation > 0 ? `Rực +${op.params.saturation}` : `Nhạt ${op.params.saturation}`);
        if (op.params.sharpen) parts.push(`Nét +${op.params.sharpen}`);
        if (op.params.denoise) parts.push(`Giảm nhiễu ${op.params.denoise}`);
        return parts.length > 0 ? parts.join(', ') : 'Chỉnh màu/nét';
      }
      case 'blur_background':
        return `Làm mờ phông (${op.radius}px)`;
      case 'remove_background':
        return 'Tách nền';
      case 'ai_edit':
        return `AI sửa ảnh (${op.reason})`;
    }
  };

  // Calculate disabled reason for "Thực hiện" button
  const getExecuteDisabledReason = (): string | null => {
    if (!image) return 'Chưa có ảnh trong studio';
    if (isExecutingAiState || isExecutingAiRef.current) return 'Đang xử lý yêu cầu...';
    if (isProcessing) return 'Hệ thống đang bận';
    if (aiMode === 'prompt_edit') {
      if (!userPrompt.trim()) {
        return 'Vui lòng nhập mô tả yêu cầu chỉnh sửa vào ô prompt';
      }
      return null;
    }
    if (!hasEditableSelection) return 'Chưa có vùng chọn hợp lệ (hoặc vùng chọn đã bị khóa bảo vệ)';
    if (aiMode === 'reshape_body') {
      if (waistSlimmingStrength <= 0) return 'Độ thu gọn eo đang ở mức 0%';
    } else {
      if (localBlendStrength <= 0) return 'Cường độ hòa trộn đang ở mức 0%';
    }
    return null;
  };

  const executeDisabledReason = getExecuteDisabledReason();
  const canExecute = executeDisabledReason === null;

  const handleEnhancePrompt = async () => {
    if (!aiBgPrompt.trim()) return;
    setIsEnhancingPrompt(true);
    try {
      const res = await Flow.generate.text(
        `Mở rộng và tối ưu hóa mô tả cảnh nền sau thành một câu prompt súc tích, giữ nguyên phong cách nghệ thuật gốc của ảnh (nếu là tranh vẽ giữ tranh vẽ, nếu là ảnh thật giữ ảnh thật), không có người:\n"${aiBgPrompt}"`,
        {
          systemInstruction:
            'Chỉ trả về 1 câu prompt tiếng Anh súc tích, không thêm từ khóa photographic nếu ảnh không phải ảnh chụp.',
          thinkingLevel: 'low',
        }
      );
      if (res.text) {
        setAiBgPrompt(res.text.trim());
      }
    } catch (err) {
      console.warn('Không thể mở rộng prompt:', err);
    } finally {
      setIsEnhancingPrompt(false);
    }
  };

  const handleGenerateAiEditPreview = async () => {
    // Synchronous guard against double submission
    if (isExecutingAiRef.current) return;
    isExecutingAiRef.current = true;
    setIsExecutingAiState(true);
    setPersistentErrorMessage(null);
    setZeroChangeWarning(null);

    if (!image) {
      isExecutingAiRef.current = false;
      setIsExecutingAiState(false);
      setPersistentErrorMessage('Vui lòng mở một hình ảnh hợp lệ.');
      return;
    }

    if (aiMode === 'prompt_edit' && !userPrompt.trim()) {
      isExecutingAiRef.current = false;
      setIsExecutingAiState(false);
      setPersistentErrorMessage('Chế độ "Chỉnh theo prompt" yêu cầu nhập mô tả cụ thể trước khi thực hiện.');
      return;
    }

    const requestSourceRevision = currentRevision;
    const requestId = Math.random().toString(36).substring(2, 9);
    currentAiRequestIdRef.current = requestId;

    let token = 0;
    try {
      // =========================================================================
      // NHÁNH 1: ĐỊNH TUYẾN YÊU CẦU THÔNG MINH CHO aiMode === 'prompt_edit'
      // =========================================================================
      if (aiMode === 'prompt_edit') {
        setAiExecutionStage('Đang phân tích yêu cầu...');
        token = onRequestBusyToken('Đang phân loại yêu cầu...');

        let ops = routeByRules(userPrompt);
        if (!ops) {
          setAiExecutionStage('Đang định tuyến yêu cầu bằng AI...');
          ops = await routeWithAI(userPrompt);
        }

        const opLabels = ops.map(getOpDisplayName).join(' → ');
        setAiExecutionStage(`Sẽ dùng: ${opLabels}`);
        onLogDiagnostic('info', `Định tuyến yêu cầu: ${opLabels}`);

        const aiEditOp = ops.find((o) => o.op === 'ai_edit') as { op: 'ai_edit'; reason: string } | undefined;

        if (aiEditOp) {
          setAiExecutionStage(`Dùng AI vì: ${aiEditOp.reason}. Đang kiểm tra bảo vệ mặt...`);
          onReleaseBusyToken(token);
          token = onRequestBusyToken('Đang kiểm tra bảo vệ mặt...');

          const preflight = await ensureFaceProtectionPreflight();
          if (!preflight.success || !preflight.effectiveMask) {
            throw new Error('Bảo vệ khuôn mặt không thành công. Quá trình dừng để bảo vệ nhận diện gốc.');
          }

          const effectiveProtMask = preflight.effectiveMask;

          let currentEditableBox = selectionMask
            ? computeEditableBoundingBox(selectionMask, effectiveProtMask)
            : null;

          let targetSelMask = selectionMask;
          if (!currentEditableBox || !targetSelMask) {
            targetSelMask = document.createElement('canvas');
            targetSelMask.width = image.width;
            targetSelMask.height = image.height;
            const tCtx = targetSelMask.getContext('2d');
            if (tCtx) {
              tCtx.fillStyle = '#ffffff';
              tCtx.fillRect(0, 0, image.width, image.height);
            }
            currentEditableBox = computeEditableBoundingBox(targetSelMask, effectiveProtMask);
          }

          if (!currentEditableBox) {
            throw new Error('Toàn bộ vùng ảnh đã bị khóa bảo vệ. Vui lòng mở bớt vùng chọn.');
          }

          setAiExecutionStage('Đang tải ảnh tham chiếu lên Flow...');
          onReleaseBusyToken(token);
          token = onRequestBusyToken('Đang tải ảnh tham chiếu...');

          const transform = calculateCropAndPaddingTransform(image.width, image.height, currentEditableBox);
          const { unmarkedCanvas } = preparePaddedReferences(
            image.canvas,
            targetSelMask,
            effectiveProtMask,
            transform
          );

          const uBase64 = unmarkedCanvas.toDataURL('image/png').split(',')[1];
          const uploadedSource = await Flow.upload({
            base64: uBase64,
            mimeType: 'image/png',
            name: `source_crop_${requestId}.png`,
          });

          const boxLeftNorm = Math.round(
            ((transform.offsetX + (currentEditableBox.minX - transform.cropX)) / transform.paddedW) * 1000
          );
          const boxTopNorm = Math.round(
            ((transform.offsetY + (currentEditableBox.minY - transform.cropY)) / transform.paddedH) * 1000
          );
          const boxRightNorm = Math.round(
            ((transform.offsetX + (currentEditableBox.maxX + 1 - transform.cropX)) / transform.paddedW) * 1000
          );
          const boxBottomNorm = Math.round(
            ((transform.offsetY + (currentEditableBox.maxY + 1 - transform.cropY)) / transform.paddedH) * 1000
          );
          const normBoxDesc = `[ymin: ${boxTopNorm}, xmin: ${boxLeftNorm}, ymax: ${boxBottomNorm}, xmax: ${boxRightNorm}]`;

          const finalPrompt = `The reference image is the clean authentic source image.
The intended editable region is located inside the normalized bounding rectangle: ${normBoxDesc}.
User specific instruction: ${userPrompt.trim()}
STRICT REQUIREMENTS:
1. Apply exactly the requested visual modification within the specified rectangle.
2. Return ONLY a pristine, clean edited image with zero annotations or borders.
3. Preserve the exact person identity, faces, clothing, lighting, camera angle, and original artistic medium.
4. Seamless integration.`;

          setAiExecutionStage(`Đang gọi AI (${selectedModel})... Quá trình có thể mất 30-50s.`);
          onReleaseBusyToken(token);
          token = onRequestBusyToken(`Đang gọi AI (${selectedModel})...`);

          const startTime = Date.now();
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Yêu cầu AI quá thời gian 120 giây.')), 120000);
          });

          const genPromise = Flow.generate.image({
            prompt: finalPrompt,
            referenceImageMediaIds: [uploadedSource.mediaId],
            modelDisplayName: selectedModel,
            aspectRatio: transform.aspectRatio,
          });

          const result: any = await Promise.race([genPromise, timeoutPromise]);

          const { decodeBase64ToImage } = await import('../services/imageUtils');
          const decodedAi = await decodeBase64ToImage(result.base64, result.mimeType, `ai_edit_${requestId}.png`);
          const mappedAiCanvas = mapGeneratedCropToSource(image.canvas, decodedAi.canvas, transform);

          const compositeResult = compositeAiEditResult(
            image.canvas,
            mappedAiCanvas,
            targetSelMask,
            effectiveProtMask,
            localBlendStrength / 100
          );

          const durationMs = Date.now() - startTime;
          const changedCount = compositeResult.changedPixelCount;

          const preview: CandidatePreview = {
            type: 'ai_edit',
            canvas: compositeResult.compositedCanvas,
            title: `AI sửa ảnh (Bản xem trước)`,
            description: `Dùng AI vì: ${aiEditOp.reason}. Mô hình: ${selectedModel}. Đã đổi ${changedCount.toLocaleString()} px (${(durationMs / 1000).toFixed(1)}s).`,
            sourceRevision: requestSourceRevision,
            diagnostics: {
              durationMs,
              modelUsed: selectedModel,
              protectedPreservedPixels: compositeResult.protectedPreservedCount,
              outsideMaskPreservedPixels: compositeResult.outsideMaskPreservedCount,
              editablePixels: compositeResult.editableCount,
              changedPixelCount: changedCount,
              sourceDimensions: { width: image.width, height: image.height },
              outputDimensions: { width: decodedAi.width, height: decodedAi.height },
              mappingInfo: `Crop ${transform.cropW}x${transform.cropH} mapped back. Dùng AI vì: ${aiEditOp.reason}`,
            },
          };

          onSetCandidatePreview(preview);
          return;
        }

        // CHẠY LẦN LƯỢT CÁC THUẬT TOÁN CỤC BỘ
        setAiExecutionStage('Đang kiểm tra bảo vệ khuôn mặt...');
        const preflight = await ensureFaceProtectionPreflight();
        if (!preflight.success || !preflight.effectiveMask) {
          throw new Error('Bảo vệ khuôn mặt không thành công. Quá trình dừng để bảo vệ nhận diện gốc.');
        }

        const effectiveProtMask = preflight.effectiveMask;
        let runningCanvas: HTMLCanvasElement = image.canvas;
        const executedDescriptions: string[] = [];

        for (const op of ops) {
          if (op.op === 'face_slim') {
            setAiExecutionStage(`Đang nắn gọn mặt (${op.strength}%)...`);
            const contours = await detectFaceContours(runningCanvas);
            const targetFace = contours[0];
            const slimRes = applyFaceSlim(runningCanvas, targetFace, op.strength, contours.slice(1));
            if (slimRes.skippedFace) {
              executedDescriptions.push('Bỏ qua gọn mặt: mặt quá sát người khác (giữ nguyên để an toàn)');
            } else {
              runningCanvas = slimRes.outputCanvas;
              executedDescriptions.push(`Gọn mặt ${op.strength}% (${slimRes.changedPixelCount.toLocaleString()} px)`);
            }
          } else if (op.op === 'body_slim') {
            setAiExecutionStage(`Đang thon gọn thân (${op.strength}%)...`);
            let targetSel = selectionMask;
            if (!targetSel || selectionPixels === 0) {
              const contours = await detectFaceContours(runningCanvas).catch(() => []);
              if (contours.length > 0) {
                const f = contours[0];
                const D = f.chinY - f.eyeY;
                const faceW = f.rightX - f.leftX;
                const bodyTop = Math.max(0, Math.floor(f.chinY + 0.1 * D));
                const bodyBottom = Math.min(image.height - 1, Math.ceil(f.chinY + 6.0 * D));

                let usedPersonMask = false;
                try {
                  const personMask = await autoSelectPersonMask(
                    runningCanvas,
                    currentRevision,
                    (msg) => onLogDiagnostic('info', msg)
                  );

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
                    targetSel = bodyMask;
                    usedPersonMask = true;
                    onLogDiagnostic('info', 'Thon gọn thân: dùng mặt nạ người tự khoanh');
                  } else {
                    throw new Error('Mặt nạ thân người còn dưới 2% số pixel ảnh.');
                  }
                } catch {
                  const bodyLeft = Math.max(0, Math.floor(f.noseX - 1.75 * faceW));
                  const bodyRight = Math.min(image.width - 1, Math.ceil(f.noseX + 1.75 * faceW));

                  const bodyMask = document.createElement('canvas');
                  bodyMask.width = image.width;
                  bodyMask.height = image.height;
                  const bCtx = bodyMask.getContext('2d');
                  if (bCtx) {
                    bCtx.fillStyle = '#000000';
                    bCtx.fillRect(0, 0, image.width, image.height);
                    bCtx.fillStyle = '#ffffff';
                    bCtx.fillRect(bodyLeft, bodyTop, bodyRight - bodyLeft + 1, bodyBottom - bodyTop + 1);
                  }
                  targetSel = bodyMask;
                  onLogDiagnostic('info', 'Thon gọn thân: dùng khung ước lượng từ mặt');
                }
              } else {
                const bodyMask = document.createElement('canvas');
                bodyMask.width = image.width;
                bodyMask.height = image.height;
                const bCtx = bodyMask.getContext('2d');
                if (bCtx) {
                  bCtx.fillStyle = '#000000';
                  bCtx.fillRect(0, 0, image.width, image.height);
                  bCtx.fillStyle = '#ffffff';
                  bCtx.fillRect(Math.round(image.width * 0.2), Math.round(image.height * 0.35), Math.round(image.width * 0.6), Math.round(image.height * 0.6));
                }
                targetSel = bodyMask;
                onLogDiagnostic('info', 'Thon gọn thân: dùng khung ước lượng từ mặt');
              }
            }

            const bodyRes = applyLocalWaistSlimming(runningCanvas, targetSel, effectiveProtMask, {
              strengthPercent: op.strength,
            });
            runningCanvas = bodyRes.outputCanvas;
            executedDescriptions.push(`Thon gọn thân ${op.strength}% (${bodyRes.changedPixelCount.toLocaleString()} px)`);
          } else if (op.op === 'auto_enhance') {
            setAiExecutionStage('Đang tự động làm đẹp ảnh...');
            runningCanvas = await autoEnhance(runningCanvas, effectiveProtMask);
            executedDescriptions.push('Tự động làm đẹp ảnh (cân bằng sáng/màu)');
          } else if (op.op === 'color') {
            setAiExecutionStage('Đang hiệu chỉnh màu & ánh sáng...');
            const defaultParams: ColorAdjustmentParams = {
              brightness: 0,
              exposure: 0,
              contrast: 0,
              saturation: 0,
              temperature: 0,
              tint: 0,
              highlights: 0,
              shadows: 0,
              sharpen: 0,
              denoise: 0,
              ...op.params,
            };
            const effSel = selectionPixels > 0 ? selectionMask : null;
            runningCanvas = await processColorAndQuality(
              runningCanvas,
              effSel,
              effectiveProtMask,
              defaultParams
            );
            executedDescriptions.push(getOpDisplayName(op));
          } else if (op.op === 'blur_background') {
            setAiExecutionStage('Đang làm mờ hậu cảnh...');
            const selToUse = selectionMask || effectiveProtMask;
            const blurRes = previewBlurBackground(runningCanvas, selToUse, effectiveProtMask, { radius: op.radius });
            runningCanvas = blurRes.canvas;
            executedDescriptions.push(`Làm mờ phông ${op.radius}px`);
          } else if (op.op === 'remove_background') {
            setAiExecutionStage('Đang tách nền...');
            const selToUse = selectionMask || effectiveProtMask;
            const rmRes = previewRemoveBackground(runningCanvas, selToUse, effectiveProtMask);
            runningCanvas = rmRes.canvas;
            executedDescriptions.push('Tách nền trong suốt');
          }
        }

        const preview: CandidatePreview = {
          type: 'ai_edit',
          canvas: runningCanvas,
          title: 'Kết quả xử lý theo prompt (Thuật toán có sẵn)',
          description: `Đã thực hiện: ${executedDescriptions.join(' • ')}. Khuôn mặt được bảo vệ tuyệt đối.`,
          sourceRevision: requestSourceRevision,
        };

        onSetCandidatePreview(preview);
        onShowToast('Đã áp dụng các thuật toán tương ứng theo prompt.');
        onLogDiagnostic('success', `Hoàn thành chỉnh theo prompt: ${executedDescriptions.join(', ')}`);
        return;
      }

      // =========================================================================
      // NHÁNH 2: CÁC CHẾ ĐỘ CỤC BỘ / CHỈ ĐỊNH KHÁC (reshape_body, remove_object...)
      // =========================================================================
      if (!selectionMask || !protectionMask) {
        throw new Error('Chưa có vùng chọn hợp lệ.');
      }

      setAiExecutionStage('Đang kiểm tra và bảo vệ khuôn mặt...');
      token = onRequestBusyToken('Đang kiểm tra và bảo vệ khuôn mặt...');

      const preflight = await ensureFaceProtectionPreflight();
      if (!preflight.success || !preflight.effectiveMask) {
        throw new Error('Bảo vệ khuôn mặt không thành công. Quá trình xử lý đã dừng để bảo vệ nhận diện gốc.');
      }

      if (currentAiRequestIdRef.current !== requestId || currentRevision !== requestSourceRevision) {
        throw new Error('Yêu cầu đã bị hủy hoặc phiên bản ảnh đã thay đổi.');
      }

      const effectiveProtMask = preflight.effectiveMask;
      const currentEditableBox = computeEditableBoundingBox(selectionMask, effectiveProtMask);
      if (!currentEditableBox) {
        throw new Error('Toàn bộ vùng chọn đã được bảo vệ hoặc không có điểm ảnh cần sửa. Vui lòng mở rộng vùng chọn.');
      }

      if (aiMode === 'reshape_body') {
        setAiExecutionStage('Đang xử lý thu gọn eo cục bộ...');
        const startTime = Date.now();

        const reshapeRes = applyLocalWaistSlimming(
          image.canvas,
          selectionMask,
          effectiveProtMask,
          { strengthPercent: waistSlimmingStrength }
        );

        const durationMs = Date.now() - startTime;
        const changedCount = reshapeRes.changedPixelCount;

        if (changedCount === 0) {
          setZeroChangeWarning('Thu gọn eo chưa tạo thay đổi điểm ảnh. Hãy tăng độ thu gọn hoặc mở rộng vùng chọn.');
          onLogDiagnostic('warn', 'Thu gọn eo hoàn tất nhưng không có điểm ảnh nào thay đổi.');
        }

        const preview: CandidatePreview = {
          type: 'ai_edit',
          canvas: reshapeRes.outputCanvas,
          title: 'Thu gọn eo (Bản xem trước)',
          description: `Thu gọn cục bộ: ${waistSlimmingStrength}%. Độ phân giải gốc ${image.width}×${image.height} px. Đã đổi ${changedCount.toLocaleString()} / ${reshapeRes.editableCount.toLocaleString()} px (${durationMs}ms).`,
          sourceRevision: requestSourceRevision,
          diagnostics: {
            durationMs,
            modelUsed: 'Thu gọn cục bộ (Deterministic local warp)',
            protectedPreservedPixels: reshapeRes.protectedPreservedCount,
            outsideMaskPreservedPixels: reshapeRes.outsidePreservedCount,
            editablePixels: reshapeRes.editableCount,
            changedPixelCount: changedCount,
            sourceDimensions: { width: image.width, height: image.height },
            outputDimensions: { width: image.width, height: image.height },
            mappingInfo: `Local inverse coordinate warp, strength ${waistSlimmingStrength}%`,
          },
        };

        onSetCandidatePreview(preview);
        return;
      }

      setAiExecutionStage('Đang chuẩn bị và tải ảnh tham chiếu lên Flow...');
      onReleaseBusyToken(token);
      token = onRequestBusyToken('Đang tải ảnh tham chiếu lên Flow...');

      const transform = calculateCropAndPaddingTransform(image.width, image.height, currentEditableBox);
      const { unmarkedCanvas, markedGuideCanvas } = preparePaddedReferences(
        image.canvas,
        selectionMask,
        effectiveProtMask,
        transform
      );

      const uBase64 = unmarkedCanvas.toDataURL('image/png').split(',')[1];
      const uploadedSource = await Flow.upload({
        base64: uBase64,
        mimeType: 'image/png',
        name: `source_crop_${requestId}.png`,
      });

      const referenceMediaIds: string[] = [uploadedSource.mediaId];
      const mBase64 = markedGuideCanvas.toDataURL('image/png').split(',')[1];
      const uploadedGuide = await Flow.upload({
        base64: mBase64,
        mimeType: 'image/png',
        name: `guide_crop_${requestId}.png`,
      });
      referenceMediaIds.push(uploadedGuide.mediaId);

      const modeSpec = AI_EDIT_MODES_CONFIG[aiMode];
      const userInstruction = userPrompt.trim()
        ? `User specific direction: ${userPrompt.trim()}`
        : 'User specific direction: Follow natural seamless integration matching source context.';

      const finalPrompt = `The first reference image is the authentic source context. The second reference image is an editing guide where pure MAGENTA color identifies the exact editable region to alter.
Action: ${modeSpec.defaultInstruction}
${userInstruction}
STRICT INVARIANTS:
1. Alter ONLY the region indicated by magenta in the guide.
2. Preserve camera angle, background layout, lighting direction, and art medium.
3. Absolutely NO magenta or guide marker color in the final output.
4. Absolutely NO change to human faces outside the intended edit.
5. Crisp seamless edge integration.`;

      setAiExecutionStage(`Đang gọi AI (${selectedModel})... Quá trình có thể mất 30-50s.`);
      onReleaseBusyToken(token);
      token = onRequestBusyToken(`Đang xử lý tạo AI với ${selectedModel}...`);

      const startTime = Date.now();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Yêu cầu AI quá thời gian 120 giây.')), 120000);
      });

      const genPromise = Flow.generate.image({
        prompt: finalPrompt,
        referenceImageMediaIds: referenceMediaIds,
        modelDisplayName: selectedModel,
        aspectRatio: transform.aspectRatio,
      });

      const result: any = await Promise.race([genPromise, timeoutPromise]);

      setAiExecutionStage('Đang hòa trộn pixel và kiểm tra biên độ...');
      onReleaseBusyToken(token);
      token = onRequestBusyToken('Đang hòa trộn pixel...');

      const { decodeBase64ToImage } = await import('../services/imageUtils');
      const decodedAi = await decodeBase64ToImage(result.base64, result.mimeType, `ai_edit_${requestId}.png`);
      const mappedAiCanvas = mapGeneratedCropToSource(image.canvas, decodedAi.canvas, transform);

      const compositeResult = compositeAiEditResult(
        image.canvas,
        mappedAiCanvas,
        selectionMask,
        effectiveProtMask,
        localBlendStrength / 100
      );

      const durationMs = Date.now() - startTime;
      const changedCount = compositeResult.changedPixelCount;

      const preview: CandidatePreview = {
        type: 'ai_edit',
        canvas: compositeResult.compositedCanvas,
        title: `${modeSpec.title} (Bản xem trước)`,
        description: `Mô hình: ${selectedModel}. Đã đổi ${changedCount.toLocaleString()} / ${compositeResult.editableCount.toLocaleString()} px (${(durationMs / 1000).toFixed(1)}s).`,
        sourceRevision: requestSourceRevision,
        diagnostics: {
          durationMs,
          modelUsed: selectedModel,
          protectedPreservedPixels: compositeResult.protectedPreservedCount,
          outsideMaskPreservedPixels: compositeResult.outsideMaskPreservedCount,
          editablePixels: compositeResult.editableCount,
          changedPixelCount: changedCount,
          sourceDimensions: { width: image.width, height: image.height },
          outputDimensions: { width: decodedAi.width, height: decodedAi.height },
          mappingInfo: `Crop ${transform.cropW}x${transform.cropH} padded to ${transform.paddedW}x${transform.paddedH}`,
        },
      };

      onSetCandidatePreview(preview);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setPersistentErrorMessage(msg);
      onLogDiagnostic('error', 'Lỗi xử lý chỉnh sửa', msg);
    } finally {
      if (token) onReleaseBusyToken(token);
      isExecutingAiRef.current = false;
      setIsExecutingAiState(false);
      setAiExecutionStage('');
    }
  };

  const handleCancelAiRequest = () => {
    currentAiRequestIdRef.current = null;
    onCancelCandidatePreview();
    onLogDiagnostic('warn', 'Đã hủy xem trước.');
  };

  const handleGenerateAiBackground = async () => {
    if (!image || !selectionMask || !protectionMask || selectionPixels === 0) {
      setPersistentErrorMessage('Vui lòng chọn chủ thể trước khi tạo cảnh nền AI.');
      return;
    }
    if (!aiBgPrompt.trim()) {
      setPersistentErrorMessage('Vui lòng nhập mô tả bối cảnh nền mong muốn.');
      return;
    }

    const requestSourceRevision = currentRevision;
    const { success, effectiveMask } = await ensureFaceProtectionPreflight();
    if (!success || !effectiveMask) {
      setPersistentErrorMessage('Phân tích khuôn mặt thất bại. Đã dừng tạo nền.');
      return;
    }

    if (currentRevision !== requestSourceRevision) {
      setPersistentErrorMessage('Tài liệu đã thay đổi trong lúc phân tích.');
      return;
    }

    const requestId = Math.random().toString(36).substring(2, 9);
    currentAiRequestIdRef.current = requestId;

    const token = onRequestBusyToken('Đang tạo cảnh nền bằng AI...');
    try {
      const options: AiBackgroundOptions = {
        prompt: aiBgPrompt.trim(),
        model: aiBgModel,
        castContactShadow,
        shadowIntensity,
        shadowOffsetY: 8,
      };

      const preview = await generateAiBackdrop(
        image.canvas,
        selectionMask,
        effectiveMask,
        options,
        requestSourceRevision,
        (msg) => onLogDiagnostic('info', msg)
      );

      if (currentAiRequestIdRef.current !== requestId || currentRevision !== requestSourceRevision) {
        return;
      }

      onSetCandidatePreview(preview);
      onLogDiagnostic('success', 'Đã tạo xong cảnh nền AI.', `Mô hình: ${aiBgModel}`);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setPersistentErrorMessage(`Lỗi tạo nền AI: ${msg}`);
      onLogDiagnostic('error', 'Lỗi tạo nền AI', msg);
    } finally {
      onReleaseBusyToken(token);
    }
  };

  const executeWithPreflight = async (
    generator: (effectiveProtMask: HTMLCanvasElement) => Omit<CandidatePreview, 'sourceRevision'>
  ) => {
    if (!image || !selectionMask || !protectionMask) return;
    const requestSourceRevision = currentRevision;

    const { success, effectiveMask } = await ensureFaceProtectionPreflight();
    if (!success || !effectiveMask) {
      setPersistentErrorMessage('Bảo vệ khuôn mặt không thành công. Đã hủy thao tác.');
      return;
    }

    if (currentRevision !== requestSourceRevision) return;

    onSetCandidatePreview({
      ...generator(effectiveMask),
      sourceRevision: requestSourceRevision,
    });
  };

  const handleRemoveBg = async () => {
    await executeWithPreflight((effectiveProt) =>
      previewRemoveBackground(image!.canvas, selectionMask!, effectiveProt)
    );
  };

  const handleSolidBg = async () => {
    await executeWithPreflight((effectiveProt) =>
      previewSolidColorBackground(image!.canvas, selectionMask!, effectiveProt, {
        color: solidColor,
      })
    );
  };

  const handleGradientBg = async () => {
    await executeWithPreflight((effectiveProt) =>
      previewGradientBackground(image!.canvas, selectionMask!, effectiveProt, {
        color1: gradColor1,
        color2: gradColor2,
        direction: gradDir,
      })
    );
  };

  const handleBlurBg = async () => {
    await executeWithPreflight((effectiveProt) =>
      previewBlurBackground(image!.canvas, selectionMask!, effectiveProt, {
        radius: blurRadius,
      })
    );
  };

  const handleUploadBgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !image || !selectionMask || !protectionMask) return;
    const file = e.target.files[0];
    const { decodeUploadedFile, createThumbnailUrl } = await import('../services/imageUtils');

    try {
      const decodedBg = await decodeUploadedFile(file);
      uploadedBgCanvasRef.current = decodedBg.canvas;
      setUploadedBgFilename(file.name);

      const thumbUrl = await createThumbnailUrl(decodedBg.canvas, 64);
      setUploadedBgThumbnail((prev) => {
        if (prev) {
          try {
            URL.revokeObjectURL(prev);
          } catch {}
        }
        return thumbUrl;
      });

      if (decodedBg.blobUrl) {
        setTimeout(() => {
          try {
            URL.revokeObjectURL(decodedBg.blobUrl);
          } catch {}
        }, 5000);
      }

      await executeWithPreflight((effectiveProt) =>
        previewImageReplaceBackground(image.canvas, selectionMask, effectiveProt, {
          bgImage: decodedBg.canvas,
          fitMode: replaceFitMode,
        })
      );
      onShowToast(`Đã nạp ảnh nền: ${file.name}`);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setPersistentErrorMessage(`Lỗi đọc tệp nền: ${msg}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleReapplyCustomBg = async () => {
    if (!uploadedBgCanvasRef.current || !image || !selectionMask || !protectionMask) return;
    await executeWithPreflight((effectiveProt) =>
      previewImageReplaceBackground(image.canvas, selectionMask, effectiveProt, {
        bgImage: uploadedBgCanvasRef.current!,
        fitMode: replaceFitMode,
      })
    );
  };

  const handleDownloadPreview = async () => {
    if (!candidatePreview || !image) return;
    setPersistentErrorMessage(null);
    try {
      let exportCanvas = candidatePreview.canvas;

      if (candidatePreview.type === 'color_quality' && candidatePreview.previewDimensions) {
        const effMask = selectionPixels > 0 ? selectionMask : null;
        exportCanvas = await processColorAndQuality(
          image.canvas,
          effMask,
          protectionMask,
          colorParams
        );
      }

      const dataUrl = exportCanvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      const filename = `xem_truoc_${candidatePreview.type}_${exportCanvas.width}x${exportCanvas.height}.png`;
      await Flow.download({
        base64,
        mimeType: 'image/png',
        filename,
      });
      onShowToast(
        `Đã tải bản xem trước: ${filename} (${exportCanvas.width}×${exportCanvas.height})`
      );
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setPersistentErrorMessage(`Lỗi tải xem trước: ${msg}`);
    }
  };

  const handleExportAccepted = async () => {
    if (!image) return;
    if (candidatePreview) {
      setPersistentErrorMessage('Áp dụng kết quả trước khi xuất, hoặc Tải xem trước.');
      return;
    }

    setIsExporting(true);
    setPersistentErrorMessage(null);
    try {
      const targetCanvas = image.canvas;
      const w = targetCanvas.width;
      const h = targetCanvas.height;

      let exportCanvas = targetCanvas;

      if (exportFormat === 'jpeg') {
        exportCanvas = document.createElement('canvas');
        exportCanvas.width = w;
        exportCanvas.height = h;
        const eCtx = exportCanvas.getContext('2d');
        if (eCtx) {
          eCtx.fillStyle = exportMatteColor;
          eCtx.fillRect(0, 0, w, h);
          eCtx.drawImage(targetCanvas, 0, 0);
        }
      }

      const mimeType = exportFormat === 'png' ? 'image/png' : 'image/jpeg';
      const qualityFloat = Math.max(0.5, Math.min(1.0, exportQuality / 100));
      const dataUrl = exportCanvas.toDataURL(mimeType, qualityFloat);
      const base64 = dataUrl.split(',')[1];

      const defaultBase = (image.name || 'retouch').replace(/\.[^/.]+$/, '');
      const cleanName = (exportFilename || defaultBase)
        .replace(/[^a-zA-Z0-9_\-]/g, '_')
        .slice(0, 35);
      const filename = `${cleanName || 'output'}_da_nhan_${w}x${h}.${
        exportFormat === 'png' ? 'png' : 'jpg'
      }`;

      await Flow.download({
        base64,
        mimeType: exportFormat === 'png' ? 'image/png' : 'image/jpeg',
        filename,
      });
      onShowToast(`Đã xuất ảnh: ${filename}`);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setPersistentErrorMessage(`Lỗi xuất tệp: ${msg}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveToFlowGallery = async () => {
    if (!image) return;
    if (candidatePreview) {
      setPersistentErrorMessage('Áp dụng kết quả trước khi xuất, hoặc Tải xem trước.');
      return;
    }

    setIsSavingToFlow(true);
    setPersistentErrorMessage(null);
    try {
      const base64 = image.canvas.toDataURL('image/png').split(',')[1];
      const res = await Flow.upload({
        base64,
        mimeType: 'image/png',
        name: `${image.name || 'retouch_studio'}_accepted.png`,
      });

      if (res && res.mediaId) {
        onShowToast(`Đã lưu thành công vào thư viện Flow (ID: ${res.mediaId.slice(0, 8)}...)`);
        onLogDiagnostic('success', `Đã lưu ảnh vào Flow Gallery với mediaId: ${res.mediaId}`);
      } else {
        throw new Error('Máy chủ Flow không trả về mã mediaId xác nhận.');
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setPersistentErrorMessage(`Lưu vào Flow thất bại: ${msg}`);
    } finally {
      setIsSavingToFlow(false);
    }
  };

  return (
    <aside
      data-no-canvas-click="true"
      onPointerDown={(e) => e.stopPropagation()}
      className={`bg-[#131517] border-l border-[#24282c] flex flex-col select-none shrink-0 overflow-hidden z-10 text-xs text-zinc-300 transition-all ${
        isCollapsed ? 'w-0 hidden md:flex md:w-80' : 'w-80'
      }`}
    >
      {/* Candidate Preview Bar */}
      {candidatePreview && (
        <div className="bg-[#172027] border-b border-[#293644] p-2.5 flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-amber-300 flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px]">visibility</span>
              <span className="truncate max-w-[150px]">Bản xem trước — chưa áp dụng</span>
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleDownloadPreview}
                className="px-1.5 py-0.5 bg-[#1e252c] hover:bg-[#28323c] text-zinc-300 rounded text-[10px] flex items-center gap-0.5 border border-[#2b3744]"
                title="Tải riêng bản xem trước này về máy tính"
              >
                <span className="material-symbols-outlined text-[12px]">download</span>
                <span>Tải xem trước</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
            <span>
              Kích thước: <b className="text-zinc-200">{candidatePreview.canvas.width} × {candidatePreview.canvas.height}</b> px
            </span>
            {candidatePreview.diagnostics?.changedPixelCount !== undefined && (
              <span className="text-[#55c7b0]">
                Đổi: {candidatePreview.diagnostics.changedPixelCount.toLocaleString()} px
              </span>
            )}
          </div>

          <p className="text-[11px] text-zinc-300 leading-snug">{candidatePreview.description}</p>

          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={onApplyCandidatePreview}
              disabled={isProcessing || isExecutingAiState}
              className="flex-1 py-1.5 bg-[#55c7b0] hover:bg-[#48b7a0] active:bg-[#3ea590] disabled:opacity-50 text-[#0d1815] font-bold rounded text-xs transition-colors flex items-center justify-center gap-1 shadow"
            >
              <span className="material-symbols-outlined text-[15px]">check</span>
              <span>Áp dụng vào ảnh</span>
            </button>
            <button
              type="button"
              onClick={handleCancelAiRequest}
              disabled={isProcessing || isExecutingAiState}
              className="px-3 py-1.5 bg-[#202428] hover:bg-[#282d33] disabled:opacity-50 text-zinc-300 rounded text-xs transition-colors flex items-center justify-center gap-1 border border-[#2b3036]"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
              <span>Hủy</span>
            </button>
          </div>
        </div>
      )}

      {/* Persistent Actionable Error Banner */}
      {persistentErrorMessage && (
        <div className="m-2 p-2 bg-rose-950/80 border border-rose-700 rounded text-rose-200 text-[11px] flex items-start justify-between gap-1.5">
          <div className="flex items-start gap-1.5">
            <span className="material-symbols-outlined text-rose-400 text-[15px] shrink-0 mt-0.5">error</span>
            <span className="leading-snug">{persistentErrorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setPersistentErrorMessage(null)}
            className="text-rose-400 hover:text-white shrink-0 p-0.5"
            title="Đóng thông báo"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {/* Zero Pixel Changed Warning Banner */}
      {zeroChangeWarning && (
        <div className="m-2 p-2 bg-amber-950/80 border border-amber-600 rounded text-amber-200 text-[11px] flex items-start justify-between gap-1.5">
          <div className="flex items-start gap-1.5">
            <span className="material-symbols-outlined text-amber-400 text-[15px] shrink-0 mt-0.5">warning</span>
            <span className="leading-snug">{zeroChangeWarning}</span>
          </div>
          <button
            type="button"
            onClick={() => setZeroChangeWarning(null)}
            className="text-amber-400 hover:text-white shrink-0 p-0.5"
            title="Đóng thông báo"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="flex border-b border-[#24282c] bg-[#111315] shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('xoa_sua')}
          className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'xoa_sua'
              ? 'border-[#55c7b0] text-[#55c7b0]'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Xóa & sửa
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('nen')}
          className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'nen'
              ? 'border-[#55c7b0] text-[#55c7b0]'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Nền
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('mau_net')}
          className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'mau_net'
              ? 'border-[#55c7b0] text-[#55c7b0]'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Màu & nét
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('bo_cuc')}
          className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'bo_cuc'
              ? 'border-[#55c7b0] text-[#55c7b0]'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Bố cục
        </button>
      </div>

      {/* Tab Contents: Scrollable area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-3.5">
        {/* TAB: XÓA & SỬA */}
        {activeTab === 'xoa_sua' && (
          <div className="space-y-3">
            {/* Thẻ Sửa nhanh 1 click đặt ĐẦU tab Xóa & sửa */}
            <QuickFixPanel
              image={image}
              selectionMask={selectionMask}
              protectionMask={protectionMask}
              selectionPixels={selectionPixels}
              currentRevision={currentRevision}
              onSetCandidatePreview={onSetCandidatePreview}
              ensureFaceProtectionPreflight={ensureFaceProtectionPreflight}
              isProcessing={isProcessing}
              onRequestBusyToken={onRequestBusyToken}
              onReleaseBusyToken={onReleaseBusyToken}
              onShowToast={onShowToast}
              onLogDiagnostic={onLogDiagnostic}
            />

            {/* Top reachable Mode selector */}
            <div className="bg-[#181b1e] p-2.5 rounded border border-[#272b31] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-200 flex items-center gap-1.5 text-xs">
                  <span className="material-symbols-outlined text-[15px] text-[#55c7b0]">auto_fix_high</span>
                  <span>Chế độ chỉnh sửa</span>
                </span>
                {aiMode === 'prompt_edit' && (
                  <span className="text-[9px] font-mono text-[#55c7b0] bg-[#1a2b25] px-1.5 py-0.5 rounded border border-[#55c7b0]/30">
                    Tự định tuyến
                  </span>
                )}
                {aiMode === 'reshape_body' && (
                  <span className="text-[9px] font-mono text-cyan-300 bg-[#122b2f] px-1.5 py-0.5 rounded border border-cyan-500/30">
                    Xử lý cục bộ
                  </span>
                )}
              </div>

              <select
                value={aiMode}
                disabled={isExecutingAiState}
                onChange={(e) => {
                  setAiMode(e.target.value as AiEditMode);
                  setPersistentErrorMessage(null);
                  setZeroChangeWarning(null);
                }}
                className="w-full bg-[#121416] border border-[#282d33] rounded px-2 py-1.5 text-zinc-200 text-xs font-medium focus:border-[#55c7b0] outline-none disabled:opacity-50"
              >
                {Object.entries(AI_EDIT_MODES_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>
                    {cfg.title}
                  </option>
                ))}
              </select>

              <p className="text-[11px] text-zinc-400 leading-snug">
                {aiMode === 'prompt_edit'
                  ? 'Gõ yêu cầu: tool tự chọn thuật toán sẵn có (gọn mặt, thon eo, làm đẹp, màu/nét, nền); ca khó mới gửi AI.'
                  : aiMode === 'reshape_body'
                  ? 'Bấm chọn phần thân/bụng, chỉnh thanh mức độ rồi Thực hiện.'
                  : AI_EDIT_MODES_CONFIG[aiMode].tooltip}
              </p>

              {/* reshape_body SPECIFIC CONTROLS */}
              {aiMode === 'reshape_body' ? (
                <div className="pt-2 border-t border-[#25282c] space-y-2.5">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-300 font-medium">Độ thu gọn eo:</span>
                      <span className="font-mono text-[#55c7b0] font-bold text-xs">{waistSlimmingStrength}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="30"
                      value={waistSlimmingStrength}
                      disabled={isExecutingAiState}
                      onChange={(e) => setWaistSlimmingStrength(Number(e.target.value))}
                      className="w-full accent-[#55c7b0] cursor-pointer disabled:opacity-50 h-1.5"
                    />
                    <div className="flex justify-between text-[9px] font-mono text-zinc-500">
                      <span>0%</span>
                      <span>15%</span>
                      <span>30%</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isProcessing || isExecutingAiState || !hasEditableSelection}
                    onClick={() => {
                      if (onExpandReshapeSelection) {
                        onExpandReshapeSelection();
                      }
                    }}
                    className="w-full py-1.5 px-2 bg-[#1b2a26] hover:bg-[#233833] disabled:opacity-40 disabled:cursor-not-allowed text-[#55c7b0] border border-[#55c7b0]/40 rounded text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[15px]">aspect_ratio</span>
                    <span>Mở vùng chỉnh dáng</span>
                  </button>
                </div>
              ) : null}

              {/* Quick Preset 'Nới 3px' for Object Removal */}
              {aiMode === 'remove_object' && onChangeDilationRadius && (
                <div className="flex items-center justify-between bg-[#141618] p-1.5 rounded border border-[#262c33] text-[10.5px]">
                  <span className="text-zinc-400">Nới viền xóa vật thể:</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onChangeDilationRadius(0)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                        dilationRadius === 0
                          ? 'bg-[#1b2622] border-[#55c7b0] text-[#55c7b0]'
                          : 'bg-[#191d21] border-[#292f36] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Nới 0px
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeDilationRadius(3)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                        dilationRadius === 3
                          ? 'bg-[#1b2622] border-[#55c7b0] text-[#55c7b0] font-bold'
                          : 'bg-[#191d21] border-[#292f36] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Nới 3px
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Prompt input */}
            <div className="bg-[#181b1e] p-2.5 rounded border border-[#272b31] space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-zinc-200">
                  {aiMode === 'prompt_edit'
                    ? 'Mô tả chỉnh sửa (Tự chọn thuật toán):'
                    : aiMode === 'reshape_body'
                    ? 'Ghi chú dáng người / phần trăm (Tùy chọn):'
                    : 'Mô tả chi tiết bổ sung (Tùy chọn):'}
                </span>
                {aiMode === 'prompt_edit' && !userPrompt.trim() && (
                  <span className="text-rose-400 text-[9.5px]">Chưa nhập</span>
                )}
              </div>
              <textarea
                value={userPrompt}
                disabled={isExecutingAiState}
                onChange={(e) => handlePromptChange(e.target.value)}
                placeholder={
                  aiMode === 'prompt_edit'
                    ? 'Ví dụ: làm mặt gọn hơn 10%, bụng gọn lại, ảnh sáng hơn...'
                    : aiMode === 'reshape_body'
                    ? 'Ví dụ: thu gọn 15% eo hai bên...'
                    : AI_EDIT_MODES_CONFIG[aiMode].samplePlaceholder
                }
                rows={aiMode === 'reshape_body' ? 2 : 3}
                className="w-full bg-[#121416] border border-[#282d33] rounded p-2 text-zinc-200 text-xs focus:border-[#55c7b0] outline-none resize-none leading-relaxed disabled:opacity-50"
              />
            </div>

            {/* Model & Blend Strength: ONLY for AI modes (hidden for local reshape_body) */}
            {aiMode !== 'reshape_body' && (
              <>
                <div className="bg-[#181b1e] p-2.5 rounded border border-[#272b31] space-y-1.5">
                  <span className="font-semibold text-zinc-200 text-[11px]">Mô hình AI (dùng khi ca khó):</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={isExecutingAiState}
                      onClick={() => setSelectedModel('🍌 Nano Banana Pro')}
                      className={`py-1 px-1.5 rounded text-left border transition-all ${
                        selectedModel === '🍌 Nano Banana Pro'
                          ? 'bg-[#182621] border-[#55c7b0] text-[#55c7b0]'
                          : 'bg-[#141618] border-[#262a30] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div className="font-semibold text-[10px]">🍌 Nano Banana Pro</div>
                      <div className="text-[8.5px] opacity-70">Mặc định • Độ nét cao</div>
                    </button>
                    <button
                      type="button"
                      disabled={isExecutingAiState}
                      onClick={() => setSelectedModel('🍌 Nano Banana 2.1')}
                      className={`py-1 px-1.5 rounded text-left border transition-all ${
                        selectedModel === '🍌 Nano Banana 2.1'
                          ? 'bg-[#182621] border-[#55c7b0] text-[#55c7b0]'
                          : 'bg-[#141618] border-[#262a30] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div className="font-semibold text-[10px]">🍌 Nano Banana 2.1</div>
                      <div className="text-[8.5px] opacity-70">Xem thử nhanh</div>
                    </button>
                  </div>
                </div>

                <div className="bg-[#181b1e] p-2.5 rounded border border-[#272b31] space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-300">Cường độ hòa trộn:</span>
                    <span className="font-mono text-[#55c7b0]">{localBlendStrength}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={localBlendStrength}
                    disabled={isExecutingAiState}
                    onChange={(e) => setLocalBlendStrength(Number(e.target.value))}
                    className="w-full accent-[#55c7b0] cursor-pointer disabled:opacity-50"
                  />
                </div>
              </>
            )}

            <div className="bg-[#15171a] p-2 rounded border border-[#24282e] flex items-center justify-between text-[11px]">
              <span className="text-zinc-400">Vùng sửa:</span>
              <span className={`font-semibold ${hasEditableSelection ? 'text-[#55c7b0]' : 'text-zinc-400'}`}>
                {hasEditableSelection
                  ? `${(editableBox!.width * editableBox!.height).toLocaleString()} px`
                  : aiMode === 'prompt_edit'
                  ? 'Tự động theo yêu cầu'
                  : 'Chưa có vùng chọn'}
              </span>
            </div>
          </div>
        )}

        {/* TAB: NỀN */}
        {activeTab === 'nen' && (
          <BackgroundPanel
            selectionPixels={selectionPixels}
            isProcessing={isProcessing}
            onInvertSelection={onInvertSelection}
            solidColor={solidColor}
            onChangeSolidColor={setSolidColor}
            onPreviewSolidBg={handleSolidBg}
            gradColor1={gradColor1}
            onChangeGradColor1={setGradColor1}
            gradColor2={gradColor2}
            onChangeGradColor2={setGradColor2}
            gradDir={gradDir}
            onChangeGradDir={setGradDir}
            onPreviewGradientBg={handleGradientBg}
            uploadedBgFilename={uploadedBgFilename}
            uploadedBgThumbnail={uploadedBgThumbnail}
            replaceFitMode={replaceFitMode}
            onChangeReplaceFitMode={setReplaceFitMode}
            onUploadBgFile={handleUploadBgFile}
            onReapplyCustomBg={handleReapplyCustomBg}
            blurRadius={blurRadius}
            onChangeBlurRadius={setBlurRadius}
            onPreviewBlurBg={handleBlurBg}
            onRemoveBg={handleRemoveBg}
            aiBgPrompt={aiBgPrompt}
            onChangeAiBgPrompt={setAiBgPrompt}
            aiBgModel={aiBgModel}
            onChangeAiBgModel={setAiBgModel}
            castContactShadow={castContactShadow}
            onChangeCastContactShadow={setCastContactShadow}
            shadowIntensity={shadowIntensity}
            onChangeShadowIntensity={setShadowIntensity}
            onGenerateAiBg={handleGenerateAiBackground}
            onEnhanceAiPrompt={handleEnhancePrompt}
            isEnhancingPrompt={isEnhancingPrompt}
          />
        )}

        {/* TAB: MÀU & NÉT */}
        {activeTab === 'mau_net' && (
          <ColorQualityPanel
            params={colorParams}
            onChangeParams={onChangeColorParams}
            onResetParams={onResetColorParams}
            hasSelection={selectionPixels > 0}
            isProcessing={isProcessing}
            onApply={onApplyColorAdjustments}
            onCancel={onCancelColorAdjustments}
            isPreviewActive={Boolean(candidatePreview && candidatePreview.type === 'color_quality')}
          />
        )}

        {/* TAB: BỐ CỤC */}
        {activeTab === 'bo_cuc' && (
          <CompositionPanel
            image={image}
            selectionMask={selectionMask}
            protectionMask={protectionMask}
            currentRevision={currentRevision}
            candidatePreview={candidatePreview}
            onSetCandidatePreview={onSetCandidatePreview}
            onApplyCandidatePreview={onApplyCandidatePreview}
            onCancelCandidatePreview={onCancelCandidatePreview}
            isProcessing={isProcessing}
            onRequestBusyToken={onRequestBusyToken}
            onReleaseBusyToken={onReleaseBusyToken}
            onShowToast={onShowToast}
            onLogDiagnostic={onLogDiagnostic}
            cropRect={cropRect}
            onChangeCropRect={onChangeCropRect}
            isCropActive={isCropActive}
            onToggleCropActive={onToggleCropActive}
          />
        )}

        {/* SECTION: BẢO VỆ KHUÔN MẶT */}
        <div className="bg-[#181b1e] p-2.5 rounded border border-[#272b31] space-y-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="protect-face-chk"
              className="font-semibold text-zinc-200 flex items-center gap-1.5 cursor-pointer text-xs"
            >
              <span className="material-symbols-outlined text-amber-400 text-[16px]">lock</span>
              <span>Bảo vệ mặt</span>
            </label>
            <input
              id="protect-face-chk"
              type="checkbox"
              checked={protectFaceToggle}
              onChange={(e) => onToggleProtectFace(e.target.checked)}
              className="accent-amber-400 cursor-pointer"
            />
          </div>

          <button
            type="button"
            onClick={onDetectFacesAI}
            disabled={!image || isDetectingFaces || isProcessing}
            className="w-full py-1 bg-[#251e12] hover:bg-[#342a1a] disabled:opacity-50 text-amber-300 font-medium rounded text-[11px] border border-amber-600/40 flex items-center justify-center gap-1 transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">
              {isDetectingFaces ? 'hourglass_empty' : 'face'}
            </span>
            <span>{isDetectingFaces ? 'Đang phân tích...' : 'AI tìm khuôn mặt'}</span>
          </button>

          <div className="text-[10px] text-zinc-400 flex items-center justify-between pt-1 border-t border-[#23272d]">
            <span>Độ phủ bảo vệ:</span>
            <span className="font-mono text-amber-400">
              {protectionPixels.toLocaleString()} px ({protectionPercent}%)
            </span>
          </div>
        </div>

        {/* SECTION: XUẤT ẢNH */}
        <div className="bg-[#181b1e] p-2.5 rounded border border-[#272b31] space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-200 flex items-center gap-1.5 text-xs">
              <span className="material-symbols-outlined text-[15px] text-[#55c7b0]">download</span>
              <span>Xuất ảnh đã nhận</span>
            </span>
            {image && (
              <span className="font-mono text-[10px] text-zinc-400">
                {image.width} × {image.height} px
              </span>
            )}
          </div>

          {candidatePreview && (
            <div className="p-1.5 rounded bg-amber-950/40 border border-amber-600/40 text-amber-300 text-[10px]">
              Đang có bản xem trước chưa áp dụng. Hãy "Áp dụng vào ảnh" trước khi xuất, hoặc bấm "Tải xem trước" ở trên.
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setExportFormat('png')}
              className={`flex-1 py-1 rounded text-[11px] font-medium border ${
                exportFormat === 'png'
                  ? 'bg-[#55c7b0] text-black border-[#55c7b0] font-bold'
                  : 'bg-[#141618] text-zinc-400 border-[#272b30]'
              }`}
            >
              PNG (Trong suốt)
            </button>
            <button
              type="button"
              onClick={() => setExportFormat('jpeg')}
              className={`flex-1 py-1 rounded text-[11px] font-medium border ${
                exportFormat === 'jpeg'
                  ? 'bg-[#55c7b0] text-black border-[#55c7b0] font-bold'
                  : 'bg-[#141618] text-zinc-400 border-[#272b30]'
              }`}
            >
              JPEG (Lót nền)
            </button>
          </div>

          {exportFormat === 'jpeg' && (
            <div className="space-y-2 pt-1 border-t border-[#25282c]">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">Màu nền lót (Matte):</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={exportMatteColor}
                    onChange={(e) => setExportMatteColor(e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer bg-transparent border border-[#2a2f36]"
                  />
                  <span className="font-mono text-[10px] text-zinc-300">{exportMatteColor}</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-zinc-400">Chất lượng nén JPEG:</span>
                  <span className="font-mono text-[#55c7b0] font-bold">{exportQuality}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="100"
                  value={exportQuality}
                  onChange={(e) => setExportQuality(Number(e.target.value))}
                  className="w-full accent-[#55c7b0] cursor-pointer h-1"
                />
              </div>

              <p className="text-[10px] text-zinc-500 leading-tight">
                * Định dạng JPEG không hỗ trợ kênh trong suốt Alpha. Vùng trong suốt sẽ được phủ bằng màu nền lót đã chọn.
              </p>
            </div>
          )}

          <input
            type="text"
            value={exportFilename}
            onChange={(e) => setExportFilename(e.target.value)}
            placeholder={
              image?.name ? `${image.name.replace(/\.[^/.]+$/, '')}_retouch` : 'retouch_export'
            }
            className="w-full bg-[#121416] border border-[#282d33] rounded px-2 py-1 text-zinc-200 text-xs"
          />

          <button
            type="button"
            onClick={handleExportAccepted}
            disabled={!image || isExporting || isProcessing || Boolean(candidatePreview)}
            className="w-full py-1.5 bg-[#55c7b0] hover:bg-[#48b59f] active:bg-[#3fa08a] disabled:opacity-40 disabled:cursor-not-allowed text-[#0d1815] font-bold rounded text-xs transition-colors flex items-center justify-center gap-1 shadow"
          >
            <span className="material-symbols-outlined text-[15px]">
              {isExporting ? 'hourglass_empty' : 'save_alt'}
            </span>
            <span>
              {isExporting
                ? 'Đang xuất tệp...'
                : `Tải ảnh đã nhận (${exportFormat.toUpperCase()})`}
            </span>
          </button>

          <button
            type="button"
            onClick={handleSaveToFlowGallery}
            disabled={!image || isSavingToFlow || isProcessing || Boolean(candidatePreview)}
            className="w-full py-1 bg-[#1a2522] hover:bg-[#20322c] disabled:opacity-40 disabled:cursor-not-allowed text-[#55c7b0] rounded text-[11px] font-medium border border-[#55c7b0]/40 flex items-center justify-center gap-1 transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">cloud_upload</span>
            <span>{isSavingToFlow ? 'Đang lưu...' : 'Lưu vào thư viện Flow'}</span>
          </button>
        </div>
      </div>

      {/* Pinned Prominent Footer for Xóa & sửa */}
      {activeTab === 'xoa_sua' && (
        <div className="p-2.5 bg-[#141618] border-t border-[#272b31] shrink-0 space-y-1.5 z-20 shadow-lg">
          {aiExecutionStage && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-300 bg-[#251e12] px-2 py-1 rounded border border-amber-600/30">
              <div className="w-2.5 h-2.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="truncate">{aiExecutionStage}</span>
            </div>
          )}

          {!canExecute && executeDisabledReason && !isExecutingAiState && (
            <div className="text-[10px] text-amber-400 bg-[#1c1914] px-2 py-0.5 rounded border border-[#352c1e] flex items-center gap-1 truncate">
              <span className="material-symbols-outlined text-[12px] shrink-0">info</span>
              <span className="truncate" title={executeDisabledReason}>{executeDisabledReason}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerateAiEditPreview}
            disabled={!canExecute}
            className="w-full py-2.5 bg-[#55c7b0] hover:bg-[#48b59f] active:bg-[#3ea08b] disabled:opacity-40 disabled:cursor-not-allowed text-[#0d1815] font-bold rounded text-xs transition-colors flex items-center justify-center gap-2 shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">
              {isExecutingAiState
                ? 'hourglass_top'
                : aiMode === 'reshape_body'
                ? 'tune'
                : aiMode === 'prompt_edit'
                ? 'route'
                : 'auto_fix_high'}
            </span>
            <span className="text-[13px] tracking-wide">
              {isExecutingAiState
                ? 'Đang thực hiện...'
                : aiMode === 'reshape_body'
                ? `Thực hiện · Thu gọn eo (${waistSlimmingStrength}%)`
                : aiMode === 'prompt_edit'
                ? 'Thực hiện theo prompt'
                : 'Thực hiện'}
            </span>
          </button>
        </div>
      )}
    </aside>
  );
};
