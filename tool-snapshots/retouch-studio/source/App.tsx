import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  DecodedImage,
  ActiveTool,
  CandidateMask,
  CandidatePreview,
  CandidateApplyMode,
  EditHistoryItem,
  DiagnosticLog,
  ColorAdjustmentParams,
  CropRect,
} from './types';
import {
  decodeUploadedFile,
  createEmptyMaskCanvas,
  countNonZeroPixels,
  invertMaskCanvas,
  clearMaskCanvas,
  featherMaskCanvas,
  dilateMaskCanvas,
  cloneCanvas,
  createThumbnailUrl,
  canvasToCompressedBlob,
  blobToCanvas,
  applyCandidateToMask,
  fillSmallHolesInMask,
  subtractProtectionFromMask,
} from './services/imageUtils';
import {
  segmentCandidatesAtPoint,
  invalidateSegmentationCache,
} from './services/segmentationService';
import {
  detectFacesWithAI,
  buildPreciseSemanticFaceProtection,
} from './services/faceProtectionService';
import {
  DEFAULT_COLOR_PARAMS,
  hasActiveAdjustments,
  processColorAndQuality,
} from './services/colorQualityService';
import {
  exportSessionFile,
  parseAndValidateSessionFile,
} from './services/sessionService';
import { TopBar } from './components/TopBar';
import { LeftToolbar } from './components/LeftToolbar';
import { ViewportCanvas } from './components/ViewportCanvas';
import { RightSidebar } from './components/RightSidebar';
import { HistoryBar } from './components/HistoryBar';
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer';

const MAX_HISTORY = 10;
const MAX_STORAGE_BYTES = 200 * 1024 * 1024;

export default function App() {
  const [originalImage, setOriginalImage] = useState<DecodedImage | null>(null);
  const [currentImage, setCurrentImage] = useState<DecodedImage | null>(null);
  const [documentRevision, setDocumentRevision] = useState(0);

  const documentRevisionRef = useRef(0);
  const updateRevision = useCallback(() => {
    const nextRev = documentRevisionRef.current + 1;
    documentRevisionRef.current = nextRev;
    setDocumentRevision(nextRev);
    return nextRev;
  }, []);

  const activeBusyTokenRef = useRef(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');

  const acquireBusy = (msg: string): number => {
    const token = ++activeBusyTokenRef.current;
    setIsProcessing(true);
    setProcessingMessage(msg);
    return token;
  };

  const releaseBusy = (token: number) => {
    if (activeBusyTokenRef.current === token) {
      setIsProcessing(false);
      setProcessingMessage('');
    }
  };

  const [diagnosticLogs, setDiagnosticLogs] = useState<DiagnosticLog[]>([]);
  const logDiagnostic = useCallback(
    (type: DiagnosticLog['type'], message: string, details?: string) => {
      const log: DiagnosticLog = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        type,
        message,
        details,
      };
      setDiagnosticLogs((prev) => [log, ...prev].slice(0, 100));
    },
    []
  );

  // BASE MASK STORAGE: authoritatively holds raw drawn pixels & candidate selections
  const baseSelectionMaskRef = useRef<HTMLCanvasElement | null>(null);
  const [baseSelectionMaskState, setBaseSelectionMaskState] = useState<HTMLCanvasElement | null>(null);
  const [effectiveSelectionMask, setEffectiveSelectionMask] = useState<HTMLCanvasElement | null>(null);
  const [protectionMask, setProtectionMask] = useState<HTMLCanvasElement | null>(null);
  const [selectionPixels, setSelectionPixels] = useState(0);
  const [protectionPixels, setProtectionPixels] = useState(0);

  const [candidatePreview, setCandidatePreview] = useState<CandidatePreview | null>(null);

  const [candidateMasks, setCandidateMasks] = useState<CandidateMask[] | null>(null);
  const [candidateClickPoint, setCandidateClickPoint] = useState<{ x: number; y: number } | null>(
    null
  );

  const [activeTool, setActiveTool] = useState<ActiveTool>('brush_add');
  const [brushRadius, setBrushRadius] = useState(25);
  // Default generic mask dilation is 0px so background cutouts do not gain an unwanted rim
  const [dilationRadius, setDilationRadius] = useState(0);
  const [featherRadius, setFeatherRadius] = useState(0);
  const [showSelectionOverlay, setShowSelectionOverlay] = useState(true);
  const [showProtectionOverlay, setShowProtectionOverlay] = useState(true);
  const [showEditableOverlay, setShowEditableOverlay] = useState(false);

  // Color & Quality adjustments
  const [colorParams, setColorParams] = useState<ColorAdjustmentParams>(DEFAULT_COLOR_PARAMS);

  // Real Crop State
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [isCropActive, setIsCropActive] = useState(false);

  const [protectFaceToggle, setProtectFaceToggle] = useState(true);
  const [isDetectingFaces, setIsDetectingFaces] = useState(false);
  const hasDetectedFacesOnceRef = useRef(false);

  const [historyStack, setHistoryStack] = useState<EditHistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [totalStorageBytes, setTotalStorageBytes] = useState(0);

  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Mobile / compact responsive panel toggle
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 3500);
  };

  /**
   * REBUILD EFFECTIVE MASK FROM BASE:
   * Base mask -> Dilation (0..30px) -> Feather (0..20px) -> Subtract Protection LAST.
   */
  const rebuildEffectiveMask = useCallback(
    (
      baseMask: HTMLCanvasElement | null,
      protMask: HTMLCanvasElement | null,
      dilation: number,
      feather: number
    ): HTMLCanvasElement | null => {
      if (!baseMask) return null;

      let current = dilation > 0 ? dilateMaskCanvas(baseMask, dilation) : cloneCanvas(baseMask);

      if (feather > 0) {
        current = featherMaskCanvas(current, feather);
      }

      if (protMask) {
        current = subtractProtectionFromMask(current, protMask);
      }

      return current;
    },
    []
  );

  const updateMaskState = useCallback(
    (baseMask: HTMLCanvasElement | null, protMask: HTMLCanvasElement | null, d = dilationRadius, f = featherRadius) => {
      baseSelectionMaskRef.current = baseMask;
      setBaseSelectionMaskState(baseMask);
      const eff = rebuildEffectiveMask(baseMask, protMask, d, f);
      setEffectiveSelectionMask(eff);
      setSelectionPixels(eff ? countNonZeroPixels(eff) : 0);
      setProtectionPixels(protMask ? countNonZeroPixels(protMask) : 0);
    },
    [dilationRadius, featherRadius, rebuildEffectiveMask]
  );

  const handleDilationChange = (val: number) => {
    setDilationRadius(val);
    updateMaskState(baseSelectionMaskRef.current, protectionMask, val, featherRadius);
  };

  const handleFeatherChange = (val: number) => {
    setFeatherRadius(val);
    updateMaskState(baseSelectionMaskRef.current, protectionMask, dilationRadius, val);
  };

  const pushHistoryState = async (
    name: string,
    acceptedCanvas: HTMLCanvasElement,
    customSelMask?: HTMLCanvasElement,
    customProtMask?: HTMLCanvasElement
  ) => {
    const selToSave = customSelMask || baseSelectionMaskRef.current || effectiveSelectionMask;
    const protToSave = customProtMask || protectionMask;
    if (!selToSave || !protToSave) return;

    try {
      const [imgBlob, selBlob, protBlob, thumbUrl] = await Promise.all([
        canvasToCompressedBlob(acceptedCanvas),
        canvasToCompressedBlob(selToSave),
        canvasToCompressedBlob(protToSave),
        createThumbnailUrl(acceptedCanvas),
      ]);

      const sizeBytes = imgBlob.size + selBlob.size + protBlob.size;

      const item: EditHistoryItem = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: Date.now(),
        name,
        thumbnailUrl: thumbUrl,
        imageBlob: imgBlob,
        selectionBlob: selBlob,
        protectionBlob: protBlob,
        width: acceptedCanvas.width,
        height: acceptedCanvas.height,
        sizeBytes,
      };

      setHistoryStack((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        let nextStack = [...sliced, item];

        while (nextStack.length > MAX_HISTORY && nextStack.length > 1) {
          const evicted = nextStack.splice(1, 1)[0];
          try {
            URL.revokeObjectURL(evicted.thumbnailUrl);
          } catch {}
        }

        let total = nextStack.reduce((acc, h) => acc + h.sizeBytes, 0);
        while (total > MAX_STORAGE_BYTES && nextStack.length > 2) {
          const evicted = nextStack.splice(1, 1)[0];
          total -= evicted.sizeBytes;
          try {
            URL.revokeObjectURL(evicted.thumbnailUrl);
          } catch {}
        }

        setTotalStorageBytes(total);
        return nextStack;
      });

      setHistoryIndex((idx) => Math.min(idx + 1, MAX_HISTORY - 1));
    } catch (err) {
      console.warn('Lỗi lưu lịch sử:', err);
    }
  };

  const pushMaskStateToHistory = async (actionName: string) => {
    if (!currentImage || !baseSelectionMaskRef.current || !protectionMask) return;
    await pushHistoryState(actionName, currentImage.canvas, baseSelectionMaskRef.current, protectionMask);
  };

  /**
   * Action 'Mở vùng chỉnh dáng' for reshape_body:
   * Synchronously acquires busy token before any async await to prevent race condition
   * with immediate 'Thực hiện' execution. Finds bounding box of current selection,
   * expands with 12% width and 4% height padding, fills rectangle on BASE mask,
   * subtracts protection, updates effective mask, and records history.
   * Releases busy token in try/finally on all return paths.
   */
  const handleExpandReshapeSelection = async () => {
    if (!currentImage || !baseSelectionMaskRef.current || !protectionMask || isProcessing) return;

    // Acquire busy synchronously BEFORE any await (including history push)
    const token = acquireBusy('Đang mở rộng vùng chỉnh dáng...');

    try {
      const base = baseSelectionMaskRef.current;
      const w = currentImage.width;
      const h = currentImage.height;

      const bCtx = base.getContext('2d', { willReadFrequently: true });
      if (!bCtx) return;
      const bData = bCtx.getImageData(0, 0, w, h).data;

      let minX = w;
      let minY = h;
      let maxX = -1;
      let maxY = -1;
      let count = 0;

      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const idx = (row + x) * 4;
          if (bData[idx] > 0) {
            count++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (count === 0 || maxX < minX || maxY < minY) {
        showToast('Vui lòng chọn hoặc quét cọ một vùng eo/thân trước khi mở vùng chỉnh dáng.');
        return;
      }

      // Order: snapshot history before mutating mask state
      await pushMaskStateToHistory('Mở vùng chỉnh dáng');

      // Horizontal padding: 12% width; Vertical padding: 4% height
      const padX = Math.round(w * 0.12);
      const padY = Math.round(h * 0.04);

      const rectX = Math.max(0, minX - padX);
      const rectY = Math.max(0, minY - padY);
      const rectRight = Math.min(w, maxX + 1 + padX);
      const rectBottom = Math.min(h, maxY + 1 + padY);
      const rectW = Math.max(1, rectRight - rectX);
      const rectH = Math.max(1, rectBottom - rectY);

      // Fill expanded rectangle into BASE mask
      bCtx.fillStyle = '#ffffff';
      bCtx.fillRect(rectX, rectY, rectW, rectH);

      // Subtract protection and update effective mask consistently (no documentRevision increment for selection edits)
      updateMaskState(base, protectionMask);

      showToast('Bao gồm eo, viền áo và một ít nền; vùng mặt vẫn khóa.');
      logDiagnostic(
        'info',
        `Đã mở vùng chỉnh dáng: [${rectX}, ${rectY}, ${rectW}x${rectH}], phủ ${((rectW * rectH / (w * h)) * 100).toFixed(1)}% ảnh.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Lỗi mở vùng chỉnh dáng: ${msg}`);
      logDiagnostic('error', 'Lỗi mở vùng chỉnh dáng', msg);
    } finally {
      releaseBusy(token);
    }
  };

  const loadNewDocument = async (decoded: DecodedImage) => {
    const rev = updateRevision();
    const token = acquireBusy('Đang nạp ảnh...');
    try {
      if (currentImage?.blobUrl && currentImage.blobUrl !== decoded.blobUrl) {
        URL.revokeObjectURL(currentImage.blobUrl);
      }
      invalidateSegmentationCache();
      setCandidatePreview(null);
      setCandidateMasks(null);
      setCandidateClickPoint(null);
      setColorParams(DEFAULT_COLOR_PARAMS);
      setCropRect(null);
      setIsCropActive(false);
      hasDetectedFacesOnceRef.current = false;

      setOriginalImage(decoded);
      setCurrentImage(decoded);

      setDilationRadius(0);
      setFeatherRadius(0);

      const selMask = createEmptyMaskCanvas(decoded.width, decoded.height);
      const protMask = createEmptyMaskCanvas(decoded.width, decoded.height);
      setProtectionMask(protMask);
      updateMaskState(selMask, protMask, 0, 0);

      const [imgBlob, selBlob, protBlob, thumbUrl] = await Promise.all([
        canvasToCompressedBlob(decoded.canvas),
        canvasToCompressedBlob(selMask),
        canvasToCompressedBlob(protMask),
        createThumbnailUrl(decoded.canvas),
      ]);

      if (documentRevisionRef.current !== rev) return;

      const initialItem: EditHistoryItem = {
        id: 'original',
        timestamp: Date.now(),
        name: 'Ảnh gốc ban đầu',
        thumbnailUrl: thumbUrl,
        imageBlob: imgBlob,
        selectionBlob: selBlob,
        protectionBlob: protBlob,
        width: decoded.width,
        height: decoded.height,
        sizeBytes: imgBlob.size + selBlob.size + protBlob.size,
      };

      setHistoryStack([initialItem]);
      setHistoryIndex(0);
      setTotalStorageBytes(initialItem.sizeBytes);

      showToast(`Đã mở: ${decoded.width} × ${decoded.height} px`);
      logDiagnostic('success', `Đã mở ảnh: ${decoded.name} (${decoded.width}x${decoded.height})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Lỗi: ${msg}`);
    } finally {
      releaseBusy(token);
    }
  };

  const handleFileSelect = async (file: File) => {
    try {
      const decoded = await decodeUploadedFile(file);
      await loadNewDocument(decoded);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Lỗi mở ảnh: ${msg}`);
    }
  };

  const handleResetToOriginal = async () => {
    if (!originalImage) return;
    const rev = updateRevision();
    const token = acquireBusy('Đang đưa về ảnh gốc ban đầu...');
    try {
      setCandidatePreview(null);
      setCandidateMasks(null);
      setCandidateClickPoint(null);
      setColorParams(DEFAULT_COLOR_PARAMS);
      setCropRect(null);
      setIsCropActive(false);

      setDilationRadius(0);
      setFeatherRadius(0);

      const restoredCanvas = cloneCanvas(originalImage.canvas);
      const selMask = createEmptyMaskCanvas(originalImage.width, originalImage.height);
      const protMask = createEmptyMaskCanvas(originalImage.width, originalImage.height);

      const blob = await new Promise<Blob | null>((res) => restoredCanvas.toBlob(res, 'image/png'));
      const blobUrl = blob ? URL.createObjectURL(blob) : originalImage.blobUrl;

      const resetImage: DecodedImage = {
        canvas: restoredCanvas,
        width: originalImage.width,
        height: originalImage.height,
        blobUrl,
        name: originalImage.name,
        mimeType: 'image/png',
      };

      setCurrentImage(resetImage);
      setProtectionMask(protMask);
      updateMaskState(selMask, protMask, 0, 0);

      await pushHistoryState('Trở về ảnh gốc', restoredCanvas, selMask, protMask);
      showToast('Đã khôi phục về ảnh gốc nguyên bản.');
      logDiagnostic('info', 'Người dùng đã đặt lại về ảnh gốc.');
    } catch (err: any) {
      showToast(`Lỗi đặt lại: ${err?.message || err}`);
    } finally {
      releaseBusy(token);
    }
  };

  const handleSaveSession = async () => {
    if (!currentImage || !originalImage || !baseSelectionMaskRef.current || !protectionMask) {
      showToast('Chưa có ảnh nào để lưu phiên.');
      return;
    }

    const token = acquireBusy('Đang tạo tệp phiên làm việc JSON...');
    try {
      const baseMask = baseSelectionMaskRef.current;
      const filename = await exportSessionFile({
        name: currentImage.name || 'retouch_session',
        originalImage,
        currentImage,
        selectionMask: baseMask,
        protectionMask,
        protectFaceToggle,
        hasDetectedFacesOnce: hasDetectedFacesOnceRef.current,
        brushRadius,
        dilationRadius,
        featherRadius,
        colorParams,
      });

      showToast(`Đã lưu phiên: ${filename}`);
      logDiagnostic('success', `Đã lưu phiên làm việc vào tệp: ${filename}`);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Lỗi lưu phiên: ${msg}`);
      logDiagnostic('error', 'Lỗi lưu phiên JSON', msg);
    } finally {
      releaseBusy(token);
    }
  };

  const handleOpenSessionSelect = async (file: File) => {
    const token = acquireBusy('Đang kiểm tra và giải mã tệp phiên...');
    try {
      const restored = await parseAndValidateSessionFile(file);
      const rev = updateRevision();

      if (currentImage?.blobUrl) {
        try {
          URL.revokeObjectURL(currentImage.blobUrl);
        } catch {}
      }

      invalidateSegmentationCache();
      setCandidatePreview(null);
      setCandidateMasks(null);
      setCandidateClickPoint(null);
      setCropRect(null);
      setIsCropActive(false);

      setOriginalImage(restored.originalImage);
      setCurrentImage(restored.currentImage);
      setProtectionMask(restored.protectionMask);
      setBrushRadius(restored.settings.brushRadius);
      setDilationRadius(restored.settings.dilationRadius);
      setFeatherRadius(restored.settings.featherRadius);
      setColorParams(restored.settings.colorParams);
      setProtectFaceToggle(restored.faceAnalysis.protectFaceToggle);
      hasDetectedFacesOnceRef.current = restored.faceAnalysis.hasDetectedFacesOnce;

      updateMaskState(
        restored.selectionMask,
        restored.protectionMask,
        restored.settings.dilationRadius,
        restored.settings.featherRadius
      );

      const [imgBlob, selBlob, protBlob, thumbUrl] = await Promise.all([
        canvasToCompressedBlob(restored.currentImage.canvas),
        canvasToCompressedBlob(restored.selectionMask),
        canvasToCompressedBlob(restored.protectionMask),
        createThumbnailUrl(restored.currentImage.canvas),
      ]);

      const initialSessionItem: EditHistoryItem = {
        id: 'session_init',
        timestamp: Date.now(),
        name: `Phiên mở: ${file.name.replace(/\.[^/.]+$/, '')}`,
        thumbnailUrl: thumbUrl,
        imageBlob: imgBlob,
        selectionBlob: selBlob,
        protectionBlob: protBlob,
        width: restored.currentImage.width,
        height: restored.currentImage.height,
        sizeBytes: imgBlob.size + selBlob.size + protBlob.size,
      };

      setHistoryStack([initialSessionItem]);
      setHistoryIndex(0);
      setTotalStorageBytes(initialSessionItem.sizeBytes);

      showToast(`Đã mở phiên: ${restored.currentImage.width} × ${restored.currentImage.height} px (Lịch sử mới bắt đầu)`);
      logDiagnostic(
        'success',
        `Mở phiên thành công: ${file.name} (${restored.currentImage.width}x${restored.currentImage.height}).`
      );
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Tệp phiên không hợp lệ: ${msg}`);
      logDiagnostic('error', 'Lỗi giải mã tệp phiên (Tài liệu hiện tại được giữ nguyên)', msg);
    } finally {
      releaseBusy(token);
    }
  };

  const restoreHistoryAtIndex = async (targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= historyStack.length) return;
    const item = historyStack[targetIndex];

    const rev = updateRevision();
    const token = acquireBusy('Đang khôi phục...');
    try {
      setCandidatePreview(null);
      setCandidateMasks(null);
      setCandidateClickPoint(null);
      setColorParams(DEFAULT_COLOR_PARAMS);
      setCropRect(null);
      setIsCropActive(false);

      const [restoredCanvas, restoredSel, restoredProt] = await Promise.all([
        blobToCanvas(item.imageBlob, item.width, item.height),
        blobToCanvas(item.selectionBlob, item.width, item.height),
        blobToCanvas(item.protectionBlob, item.width, item.height),
      ]);

      if (documentRevisionRef.current !== rev) return;

      const blobUrl = URL.createObjectURL(item.imageBlob);
      const restoredImage: DecodedImage = {
        canvas: restoredCanvas,
        width: item.width,
        height: item.height,
        blobUrl,
        name: originalImage?.name || 'image',
        mimeType: 'image/png',
      };

      setCurrentImage(restoredImage);
      setProtectionMask(restoredProt);
      updateMaskState(restoredSel, restoredProt);
      setHistoryIndex(targetIndex);

      showToast(`Đã khôi phục: ${item.name}`);
      logDiagnostic('info', `Khôi phục lịch sử bước ${targetIndex + 1}: ${item.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Lỗi khôi phục: ${msg}`);
    } finally {
      releaseBusy(token);
    }
  };

  const triggerFaceDetectionAI = async (): Promise<{
    success: boolean;
    effectiveMask: HTMLCanvasElement | null;
  }> => {
    if (!currentImage || !protectionMask) {
      return { success: false, effectiveMask: null };
    }

    const currentDocRev = documentRevisionRef.current;
    setIsDetectingFaces(true);
    const token = acquireBusy('Đang phát hiện khuôn mặt...');

    try {
      const boxes = await detectFacesWithAI(currentImage.canvas, (msg) => {
        setProcessingMessage(msg);
      });

      if (documentRevisionRef.current !== currentDocRev) {
        return { success: false, effectiveMask: null };
      }

      if (boxes.length > 0) {
        setProcessingMessage('Đang trích xuất pixel mặt bằng SlimSAM...');
        const semanticResult = await buildPreciseSemanticFaceProtection(
          currentImage.canvas,
          protectionMask,
          boxes,
          currentDocRev,
          (msg) => setProcessingMessage(msg)
        );

        if (documentRevisionRef.current !== currentDocRev) {
          return { success: false, effectiveMask: null };
        }

        const count = countNonZeroPixels(protectionMask);
        setProtectionPixels(count);
        updateMaskState(baseSelectionMaskRef.current, protectionMask);
        showToast(semanticResult.message);
        logDiagnostic('success', semanticResult.message);
      } else {
        showToast('Không phát hiện khuôn mặt nào trong ảnh.');
        logDiagnostic('info', 'Không phát hiện khuôn mặt nào.');
      }

      hasDetectedFacesOnceRef.current = true;
      return { success: true, effectiveMask: protectionMask };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Phân tích khuôn mặt thất bại: ${msg}`);
      logDiagnostic('error', 'Lỗi phân tích khuôn mặt', msg);
      return { success: false, effectiveMask: null };
    } finally {
      setIsDetectingFaces(false);
      releaseBusy(token);
    }
  };

  const ensureFaceProtectionPreflight = async (): Promise<{
    success: boolean;
    effectiveMask: HTMLCanvasElement | null;
  }> => {
    if (!currentImage || !protectionMask) {
      return { success: false, effectiveMask: null };
    }

    if (!protectFaceToggle) {
      return { success: true, effectiveMask: protectionMask };
    }

    const manualCount = countNonZeroPixels(protectionMask);
    if (hasDetectedFacesOnceRef.current || manualCount > 0) {
      return { success: true, effectiveMask: protectionMask };
    }

    return await triggerFaceDetectionAI();
  };

  const handleSmartSelectClick = async (
    normX: number,
    normY: number,
    screenX: number,
    screenY: number
  ) => {
    if (!currentImage) return;

    const opRev = documentRevisionRef.current;
    const token = acquireBusy('Đang phân tích vùng chọn bằng SlimSAM...');

    try {
      const candidates = await segmentCandidatesAtPoint(
        currentImage.canvas,
        normX,
        normY,
        (msg) => {
          setProcessingMessage(msg);
        },
        opRev
      );

      if (documentRevisionRef.current !== opRev) {
        return;
      }

      if (candidates.length > 0) {
        setCandidateMasks(candidates);
        setCandidateClickPoint({ x: screenX, y: screenY });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg);
      logDiagnostic('error', 'Lỗi SlimSAM', msg);
    } finally {
      releaseBusy(token);
    }
  };

  const handleApplyCandidateMask = async (candidate: CandidateMask, mode: CandidateApplyMode) => {
    if (!currentImage || !baseSelectionMaskRef.current) return;

    await pushMaskStateToHistory(`Vùng chọn (${mode === 'add' ? 'Thêm' : mode === 'subtract' ? 'Bớt' : 'Thay thế'})`);

    const base = baseSelectionMaskRef.current;
    applyCandidateToMask(base, candidate.canvas, mode);
    updateMaskState(base, protectionMask);

    setCandidateMasks(null);
    setCandidateClickPoint(null);
    const modeLabel = mode === 'add' ? 'Đã thêm' : mode === 'subtract' ? 'Đã bớt' : 'Đã chọn';
    showToast(`${modeLabel}: ${candidate.label}`);
  };

  const handleFillSmallHoles = async () => {
    if (!baseSelectionMaskRef.current || !currentImage) return;

    await pushMaskStateToHistory('Lấp lỗ nhỏ vùng chọn');

    const result = fillSmallHolesInMask(baseSelectionMaskRef.current, 5000);
    updateMaskState(baseSelectionMaskRef.current, protectionMask);

    if (result.holesFilled > 0) {
      showToast(`Đã lấp ${result.holesFilled} lỗ nhỏ (${result.pixelsFilled.toLocaleString()} px).`);
      logDiagnostic('info', `Lấp lỗ nhỏ: ${result.holesFilled} lỗ (${result.pixelsFilled} px).`);
    } else {
      showToast('Không có lỗ nhỏ khép kín nào dưới 5.000 px cần lấp.');
    }
  };

  const handleSetCandidatePreview = (preview: CandidatePreview | null) => {
    if (preview) {
      if (preview.sourceRevision !== documentRevisionRef.current) {
        showToast('Kết quả xem trước thuộc phiên bản cũ đã bị loại bỏ.');
        return;
      }
    }
    setCandidatePreview(preview);
  };

  const handleApplyCandidatePreview = async () => {
    if (!candidatePreview || !currentImage) return;

    if (
      candidatePreview.sourceRevision !== undefined &&
      candidatePreview.sourceRevision !== documentRevisionRef.current
    ) {
      showToast('Xem trước này thuộc phiên bản ảnh trước đó và không thể áp dụng.');
      setCandidatePreview(null);
      return;
    }

    const currentPreview = candidatePreview;
    setCandidatePreview(null);

    if (currentPreview.type === 'color_quality' && currentPreview.previewDimensions) {
      await handleApplyColorAdjustments();
      return;
    }

    const nextRev = updateRevision();
    const token = acquireBusy('Đang áp dụng thay đổi...');

    try {
      const acceptedCanvas = cloneCanvas(currentPreview.canvas);
      const blob = await new Promise<Blob | null>((res) =>
        acceptedCanvas.toBlob(res, 'image/png')
      );
      const blobUrl = blob ? URL.createObjectURL(blob) : currentImage.blobUrl;

      if (documentRevisionRef.current !== nextRev) return;

      const newAcceptedImage: DecodedImage = {
        canvas: acceptedCanvas,
        width: acceptedCanvas.width,
        height: acceptedCanvas.height,
        blobUrl,
        name: currentImage.name,
        mimeType: 'image/png',
      };

      let finalSel = baseSelectionMaskRef.current || effectiveSelectionMask;
      let finalProt = protectionMask;

      if (currentPreview.selectionMaskCanvas && currentPreview.protectionMaskCanvas) {
        finalSel = cloneCanvas(currentPreview.selectionMaskCanvas);
        finalProt = cloneCanvas(currentPreview.protectionMaskCanvas);
        setProtectionMask(finalProt);
        updateMaskState(finalSel, finalProt);
      } else if (
        currentPreview.canvas.width !== currentImage.width ||
        currentPreview.canvas.height !== currentImage.height
      ) {
        finalSel = createEmptyMaskCanvas(acceptedCanvas.width, acceptedCanvas.height);
        finalProt = createEmptyMaskCanvas(acceptedCanvas.width, acceptedCanvas.height);
        setProtectionMask(finalProt);
        updateMaskState(finalSel, finalProt);
      }

      setCurrentImage(newAcceptedImage);
      await pushHistoryState(currentPreview.title, acceptedCanvas, finalSel || undefined, finalProt || undefined);
      invalidateSegmentationCache();
      showToast(`Đã áp dụng: ${currentPreview.title}`);
      logDiagnostic('success', `Đã áp dụng chỉnh sửa vào ảnh: ${currentPreview.title} (${acceptedCanvas.width}x${acceptedCanvas.height})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Lỗi áp dụng: ${msg}`);
      logDiagnostic('error', 'Lỗi áp dụng xem trước', msg);
    } finally {
      releaseBusy(token);
    }
  };

  const handleCancelCandidatePreview = () => {
    setCandidatePreview(null);
    setColorParams(DEFAULT_COLOR_PARAMS);
    setIsCropActive(false);
    showToast('Đã hủy xem trước.');
  };

  const colorDebounceTimerRef = useRef<any>(null);

  const handleColorParamsChange = (newParams: ColorAdjustmentParams) => {
    setColorParams(newParams);

    if (!hasActiveAdjustments(newParams)) {
      if (candidatePreview?.type === 'color_quality') {
        setCandidatePreview(null);
      }
      return;
    }

    if (!currentImage) return;

    if (colorDebounceTimerRef.current) {
      clearTimeout(colorDebounceTimerRef.current);
    }

    colorDebounceTimerRef.current = setTimeout(async () => {
      if (!currentImage) return;
      const targetRev = documentRevisionRef.current;

      try {
        const preflight = await ensureFaceProtectionPreflight();
        if (!preflight.success || !preflight.effectiveMask) {
          showToast('Phân tích bảo vệ khuôn mặt không thành công. Đã dừng xem trước màu.');
          logDiagnostic('error', 'Lỗi kiểm tra bảo vệ mặt trong điều chỉnh màu sắc. Dừng xử lý.');
          setCandidatePreview(null);
          return;
        }

        const effectiveProt = preflight.effectiveMask;
        const effMask = selectionPixels > 0 ? effectiveSelectionMask : null;

        const previewCanvas = await processColorAndQuality(
          currentImage.canvas,
          effMask,
          effectiveProt,
          newParams,
          { maxDim: 1200 }
        );

        if (documentRevisionRef.current !== targetRev) return;

        setCandidatePreview({
          type: 'color_quality',
          canvas: previewCanvas,
          title: 'Hiệu chỉnh màu & nét',
          description: `Phạm vi: ${effMask ? 'Vùng đang chọn' : 'Toàn bộ ảnh'} (Bảo vệ giữ nguyên).`,
          sourceRevision: targetRev,
          previewDimensions: { width: previewCanvas.width, height: previewCanvas.height },
        });
      } catch (err) {
        console.warn('Lỗi hiển thị xem trước màu:', err);
      }
    }, 40);
  };

  const handleResetColorParams = () => {
    setColorParams(DEFAULT_COLOR_PARAMS);
    if (candidatePreview?.type === 'color_quality') {
      setCandidatePreview(null);
    }
  };

  const handleApplyColorAdjustments = async () => {
    if (!currentImage || !hasActiveAdjustments(colorParams)) return;

    const targetRev = documentRevisionRef.current;
    const token = acquireBusy('Đang tính toán màu & nét ở độ phân giải gốc...');

    try {
      const preflight = await ensureFaceProtectionPreflight();
      if (!preflight.success || !preflight.effectiveMask) {
        showToast('Bảo vệ khuôn mặt thất bại. Không thể áp dụng màu.');
        logDiagnostic('error', 'Áp dụng màu bị dừng do xác thực khuôn mặt thất bại.');
        return;
      }

      const effectiveProt = preflight.effectiveMask;
      const effMask = selectionPixels > 0 ? effectiveSelectionMask : null;

      const fullCanvas = await processColorAndQuality(
        currentImage.canvas,
        effMask,
        effectiveProt,
        colorParams
      );

      if (documentRevisionRef.current !== targetRev) return;

      const nextRev = updateRevision();
      const blob = await new Promise<Blob | null>((res) => fullCanvas.toBlob(res, 'image/png'));
      const blobUrl = blob ? URL.createObjectURL(blob) : currentImage.blobUrl;

      const newAcceptedImage: DecodedImage = {
        canvas: fullCanvas,
        width: fullCanvas.width,
        height: fullCanvas.height,
        blobUrl,
        name: currentImage.name,
        mimeType: 'image/png',
      };

      setCurrentImage(newAcceptedImage);
      await pushHistoryState('Hiệu chỉnh màu & nét', fullCanvas);
      setCandidatePreview(null);
      setColorParams(DEFAULT_COLOR_PARAMS);

      showToast(`Đã áp dụng màu & nét vào ảnh (${fullCanvas.width}×${fullCanvas.height} px).`);
      logDiagnostic('success', 'Đã lưu bước hiệu chỉnh màu & nét vào ảnh gốc ở độ phân giải gốc.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Lỗi: ${msg}`);
      logDiagnostic('error', 'Lỗi áp dụng màu & nét', msg);
    } finally {
      releaseBusy(token);
    }
  };

  const handleCancelColorAdjustments = () => {
    handleResetColorParams();
    showToast('Đã hủy thay đổi màu & nét.');
  };

  const handleMaskModified = useCallback(() => {
    if (candidatePreview) {
      setCandidatePreview(null);
    }
    updateMaskState(baseSelectionMaskRef.current, protectionMask);
  }, [candidatePreview, protectionMask, updateMaskState]);

  const handleClearSelection = async () => {
    if (baseSelectionMaskRef.current && currentImage) {
      await pushMaskStateToHistory('Xóa vùng chọn');
      clearMaskCanvas(baseSelectionMaskRef.current);
      updateMaskState(baseSelectionMaskRef.current, protectionMask);
      setCandidateMasks(null);
      setCandidateClickPoint(null);
      showToast('Đã xóa vùng chọn.');
    }
  };

  const handleInvertSelection = async () => {
    if (baseSelectionMaskRef.current && currentImage) {
      await pushMaskStateToHistory('Đảo ngược vùng chọn');
      invertMaskCanvas(baseSelectionMaskRef.current);
      updateMaskState(baseSelectionMaskRef.current, protectionMask);
      showToast('Đã đảo ngược vùng chọn.');
    }
  };

  const handleClearProtection = async () => {
    if (protectionMask && currentImage) {
      await pushMaskStateToHistory('Xóa vùng bảo vệ');
      clearMaskCanvas(protectionMask);
      setProtectionPixels(0);
      updateMaskState(baseSelectionMaskRef.current, protectionMask);
      showToast('Đã xóa vùng bảo vệ.');
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const isInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.isContentEditable);

      if (isInput) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (historyIndex < historyStack.length - 1) {
            restoreHistoryAtIndex(historyIndex + 1);
          }
        } else {
          if (historyIndex > 0) {
            restoreHistoryAtIndex(historyIndex - 1);
          }
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (historyIndex < historyStack.length - 1) {
          restoreHistoryAtIndex(historyIndex + 1);
        }
      } else if (e.key === 'Escape') {
        if (candidatePreview) {
          setCandidatePreview(null);
        }
        if (candidateMasks) {
          setCandidateMasks(null);
          setCandidateClickPoint(null);
        }
        if (isCropActive) {
          setIsCropActive(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, historyStack, candidatePreview, candidateMasks, isCropActive]);

  return (
    <div className="flex flex-col h-full w-full bg-[#16181b] text-zinc-100 font-sans select-none overflow-hidden">
      <TopBar
        imageName={currentImage?.name || null}
        imageDimensions={
          currentImage ? { width: currentImage.width, height: currentImage.height } : null
        }
        onFileSelect={handleFileSelect}
        onOpenSessionSelect={handleOpenSessionSelect}
        onSaveSession={handleSaveSession}
        onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < historyStack.length - 1}
        onUndo={() => restoreHistoryAtIndex(historyIndex - 1)}
        onRedo={() => restoreHistoryAtIndex(historyIndex + 1)}
        onResetToOriginal={handleResetToOriginal}
        canResetToOriginal={Boolean(originalImage && historyIndex > 0)}
        isProcessing={isProcessing}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <LeftToolbar
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          brushRadius={brushRadius}
          onChangeBrushRadius={setBrushRadius}
          dilationRadius={dilationRadius}
          onChangeDilationRadius={handleDilationChange}
          featherRadius={featherRadius}
          onChangeFeatherRadius={handleFeatherChange}
          showSelectionOverlay={showSelectionOverlay}
          onToggleSelectionOverlay={() => setShowSelectionOverlay((v) => !v)}
          showProtectionOverlay={showProtectionOverlay}
          onToggleProtectionOverlay={() => setShowProtectionOverlay((v) => !v)}
          showEditableOverlay={showEditableOverlay}
          onToggleEditableOverlay={() => setShowEditableOverlay((v) => !v)}
          onClearSelection={handleClearSelection}
          onInvertSelection={handleInvertSelection}
          onClearProtection={handleClearProtection}
          onFillSmallHoles={handleFillSmallHoles}
          hasSelection={selectionPixels > 0}
          hasProtection={protectionPixels > 0}
          isProcessing={isProcessing}
        />

        <ViewportCanvas
          originalImage={originalImage}
          currentImage={currentImage}
          candidatePreview={candidatePreview}
          activeTool={activeTool}
          brushRadius={brushRadius}
          effectiveSelectionMaskCanvas={effectiveSelectionMask}
          baseSelectionMaskCanvas={baseSelectionMaskState}
          protectionMaskCanvas={protectionMask}
          showSelectionOverlay={showSelectionOverlay}
          showProtectionOverlay={showProtectionOverlay}
          showEditableOverlay={showEditableOverlay}
          onToggleEditableOverlay={() => setShowEditableOverlay((v) => !v)}
          onSmartSelectClick={handleSmartSelectClick}
          candidateMasks={candidateMasks}
          onApplyCandidateMask={handleApplyCandidateMask}
          onCloseCandidateMenu={() => {
            setCandidateMasks(null);
            setCandidateClickPoint(null);
          }}
          candidateClickPoint={candidateClickPoint}
          onMaskModified={handleMaskModified}
          isProcessing={isProcessing}
          processingMessage={processingMessage}
          isCropActive={isCropActive}
          cropRect={cropRect}
          onChangeCropRect={setCropRect}
        />

        {/* Collapsible toggle button for narrow viewports */}
        <button
          type="button"
          onClick={() => setIsRightPanelCollapsed((v) => !v)}
          className="md:hidden absolute top-2 right-2 z-30 p-1.5 rounded-full bg-[#1a1d21] border border-[#2b3036] text-zinc-300 shadow-lg"
          title="Đóng / mở thanh tác vụ"
        >
          <span className="material-symbols-outlined text-[16px]">
            {isRightPanelCollapsed ? 'menu_open' : 'close'}
          </span>
        </button>

        <RightSidebar
          image={currentImage}
          selectionMask={effectiveSelectionMask}
          protectionMask={protectionMask}
          selectionPixels={selectionPixels}
          protectionPixels={protectionPixels}
          protectFaceToggle={protectFaceToggle}
          onToggleProtectFace={setProtectFaceToggle}
          onDetectFacesAI={triggerFaceDetectionAI}
          ensureFaceProtectionPreflight={ensureFaceProtectionPreflight}
          isDetectingFaces={isDetectingFaces}
          hasDetectedFacesOnce={hasDetectedFacesOnceRef.current}
          candidatePreview={candidatePreview}
          onSetCandidatePreview={handleSetCandidatePreview}
          onApplyCandidatePreview={handleApplyCandidatePreview}
          onCancelCandidatePreview={handleCancelCandidatePreview}
          isProcessing={isProcessing}
          onInvertSelection={handleInvertSelection}
          currentRevision={documentRevision}
          onLogDiagnostic={logDiagnostic}
          onRequestBusyToken={acquireBusy}
          onReleaseBusyToken={releaseBusy}
          onShowToast={showToast}
          colorParams={colorParams}
          onChangeColorParams={handleColorParamsChange}
          onResetColorParams={handleResetColorParams}
          onApplyColorAdjustments={handleApplyColorAdjustments}
          onCancelColorAdjustments={handleCancelColorAdjustments}
          cropRect={cropRect}
          onChangeCropRect={setCropRect}
          isCropActive={isCropActive}
          onToggleCropActive={setIsCropActive}
          isCollapsed={isRightPanelCollapsed}
          onToggleCollapse={() => setIsRightPanelCollapsed((v) => !v)}
          dilationRadius={dilationRadius}
          onChangeDilationRadius={handleDilationChange}
          onExpandReshapeSelection={handleExpandReshapeSelection}
        />
      </div>

      <HistoryBar
        history={historyStack}
        currentIndex={historyIndex}
        onRestoreHistory={restoreHistoryAtIndex}
        totalStorageBytes={totalStorageBytes}
      />

      <DiagnosticsDrawer
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        currentImage={currentImage}
        selectionMask={effectiveSelectionMask}
        protectionMask={protectionMask}
        candidatePreview={candidatePreview}
        documentRevision={documentRevision}
        externalLogs={diagnosticLogs}
        onLoadImageDocument={loadNewDocument}
        onApplyDiagnosticMask={(mask) => {
          if (baseSelectionMaskRef.current) {
            const ctx = baseSelectionMaskRef.current.getContext('2d');
            if (ctx) {
              ctx.drawImage(mask, 0, 0);
              updateMaskState(baseSelectionMaskRef.current, protectionMask);
            }
          }
        }}
      />

      {toastMessage && (
        <div className="fixed bottom-18 left-1/2 -translate-x-1/2 bg-[#191d22] text-zinc-100 text-xs px-3.5 py-1.5 rounded border border-[#2b333c] shadow-2xl z-50 flex items-center gap-1.5 animate-fade-in">
          <span className="material-symbols-outlined text-[#55c7b0] text-[16px]">info</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
