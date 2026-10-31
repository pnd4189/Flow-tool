import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  DecodedImage,
  ActiveTool,
  CandidateMask,
  CandidatePreview,
  CandidateApplyMode,
  CropRect,
} from '../types';

interface ViewportCanvasProps {
  originalImage: DecodedImage | null;
  currentImage: DecodedImage | null;
  candidatePreview: CandidatePreview | null;
  activeTool: ActiveTool;
  brushRadius: number;
  // Effective mask used for display overlay
  effectiveSelectionMaskCanvas: HTMLCanvasElement | null;
  // Base selection mask used for writing/erasing strokes
  baseSelectionMaskCanvas: HTMLCanvasElement | null;
  protectionMaskCanvas: HTMLCanvasElement | null;
  showSelectionOverlay: boolean;
  showProtectionOverlay: boolean;
  showEditableOverlay: boolean;
  onToggleEditableOverlay: () => void;
  onSmartSelectClick: (normX: number, normY: number, screenX: number, screenY: number) => void;
  candidateMasks: CandidateMask[] | null;
  onApplyCandidateMask: (candidate: CandidateMask, mode: CandidateApplyMode) => void;
  onCloseCandidateMenu: () => void;
  candidateClickPoint: { x: number; y: number } | null;
  onMaskModified: () => void;
  isProcessing: boolean;
  processingMessage: string;
  isCropActive?: boolean;
  cropRect?: CropRect | null;
  onChangeCropRect?: (rect: CropRect | null) => void;
}

export const ViewportCanvas: React.FC<ViewportCanvasProps> = ({
  originalImage,
  currentImage,
  candidatePreview,
  activeTool,
  brushRadius,
  effectiveSelectionMaskCanvas,
  baseSelectionMaskCanvas,
  protectionMaskCanvas,
  showSelectionOverlay,
  showProtectionOverlay,
  showEditableOverlay,
  onToggleEditableOverlay,
  onSmartSelectClick,
  candidateMasks,
  onApplyCandidateMask,
  onCloseCandidateMenu,
  candidateClickPoint,
  onMaskModified,
  isProcessing,
  processingMessage,
  isCropActive = false,
  cropRect = null,
  onChangeCropRect,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);

  // View transform
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const isSpacePressedRef = useRef(false);

  // Is user currently in auto-fit mode or manual zoom/pan?
  const isAutoFitModeRef = useRef(true);

  // Compare mode
  const [isHoldingOriginal, setIsHoldingOriginal] = useState(false);
  const [splitSliderPos, setSplitSliderPos] = useState<number | null>(null);

  // Candidate apply mode
  const [candidateApplyMode, setCandidateApplyMode] = useState<CandidateApplyMode>('replace');

  // Painting state
  const isPaintingRef = useRef(false);
  const lastPaintPosRef = useRef<{ x: number; y: number } | null>(null);

  // Interactive Crop handle dragging state
  const isDraggingCropRef = useRef<string | null>(null);
  const cropDragStartRef = useRef<{ x: number; y: number; rect: CropRect }>({
    x: 0,
    y: 0,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  });

  const activeDisplay = candidatePreview
    ? { width: candidatePreview.canvas.width, height: candidatePreview.canvas.height }
    : currentImage;

  const fitToView = useCallback(() => {
    if (!containerRef.current || !activeDisplay) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    if (cw <= 0 || ch <= 0) return;

    const padX = 20;
    const padTop = 16;
    const padBottom = 48;
    const availW = Math.max(10, cw - padX * 2);
    const availH = Math.max(10, ch - (padTop + padBottom));

    const fitScale = Math.min(availW / activeDisplay.width, availH / activeDisplay.height, 1);
    setScale(fitScale);
    setPan({
      x: (cw - activeDisplay.width * fitScale) / 2,
      y: padTop + (availH - activeDisplay.height * fitScale) / 2,
    });
    isAutoFitModeRef.current = true;
  }, [activeDisplay]);

  useEffect(() => {
    isAutoFitModeRef.current = true;
    fitToView();
  }, [fitToView]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (isAutoFitModeRef.current && activeDisplay) {
        fitToView();
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [fitToView, activeDisplay]);

  // Space key tracker: NEVER activate space-pan while user is typing in inputs/textareas/contenteditable
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const isInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.isContentEditable);

      if (e.code === 'Space' && !e.repeat && !isInput) {
        isSpacePressedRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        setIsPanning(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const renderCanvas = useCallback(() => {
    const canvas = displayCanvasRef.current;
    if (!canvas || !currentImage) return;

    if (candidatePreview) {
      const pw = candidatePreview.canvas.width;
      const ph = candidatePreview.canvas.height;
      canvas.width = pw;
      canvas.height = ph;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, pw, ph);

      if (candidatePreview.type === 'ai_expand' && candidatePreview.compositionInfo?.sourceOffset) {
        ctx.drawImage(candidatePreview.canvas, 0, 0);

        const { x: ox, y: oy } = candidatePreview.compositionInfo.sourceOffset;
        const origDim = candidatePreview.compositionInfo.originalDimensions;

        ctx.save();
        ctx.strokeStyle = '#55c7b0';
        ctx.lineWidth = Math.max(1, 1.5 / scale);
        ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.strokeRect(ox, oy, origDim.width, origDim.height);

        ctx.fillStyle = '#55c7b0';
        ctx.font = `${Math.max(9, Math.round(11 / scale))}px monospace`;
        ctx.fillText('ẢNH NGUYÊN BẢN', ox + 6 / scale, oy + 14 / scale);
        ctx.restore();
        return;
      }

      const hasMatchingDimensions = pw === currentImage.width && ph === currentImage.height;

      if (splitSliderPos !== null && hasMatchingDimensions) {
        ctx.drawImage(currentImage.canvas, 0, 0);
        const splitX = (splitSliderPos / 100) * pw;
        ctx.save();
        ctx.beginPath();
        ctx.rect(splitX, 0, pw - splitX, ph);
        ctx.clip();
        ctx.drawImage(candidatePreview.canvas, 0, 0);
        ctx.restore();

        ctx.strokeStyle = '#55c7b0';
        ctx.lineWidth = 2 / scale;
        ctx.beginPath();
        ctx.moveTo(splitX, 0);
        ctx.lineTo(splitX, ph);
        ctx.stroke();
      } else {
        ctx.drawImage(candidatePreview.canvas, 0, 0);
      }
      return;
    }

    const w = currentImage.width;
    const h = currentImage.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    const baseSource = isHoldingOriginal && originalImage ? originalImage.canvas : currentImage.canvas;
    ctx.drawImage(baseSource, 0, 0);

    if (!isHoldingOriginal) {
      if (showEditableOverlay && effectiveSelectionMaskCanvas && protectionMaskCanvas) {
        const sCtx = effectiveSelectionMaskCanvas.getContext('2d', { willReadFrequently: true });
        const pCtx = protectionMaskCanvas.getContext('2d', { willReadFrequently: true });
        if (sCtx && pCtx) {
          const sData = sCtx.getImageData(0, 0, w, h).data;
          const pData = pCtx.getImageData(0, 0, w, h).data;
          const overlayData = ctx.getImageData(0, 0, w, h);
          const d = overlayData.data;

          for (let i = 0; i < sData.length; i += 4) {
            const s = sData[i];
            const p = pData[i];
            if (s > 0 && p === 0) {
              const alpha = (s / 255) * 0.45;
              d[i] = Math.round(d[i] * (1 - alpha) + 236 * alpha);
              d[i + 1] = Math.round(d[i + 1] * (1 - alpha) + 72 * alpha);
              d[i + 2] = Math.round(d[i + 2] * (1 - alpha) + 153 * alpha);
            }
          }
          ctx.putImageData(overlayData, 0, 0);
        }
      }

      if (showSelectionOverlay && effectiveSelectionMaskCanvas && !showEditableOverlay) {
        const selCtx = effectiveSelectionMaskCanvas.getContext('2d', { willReadFrequently: true });
        if (selCtx) {
          const selData = selCtx.getImageData(0, 0, w, h).data;
          const overlayData = ctx.getImageData(0, 0, w, h);
          const d = overlayData.data;

          for (let i = 0; i < selData.length; i += 4) {
            const selVal = selData[i];
            if (selVal > 0) {
              const alpha = (selVal / 255) * 0.45;
              d[i] = Math.round(d[i] * (1 - alpha) + 85 * alpha);
              d[i + 1] = Math.round(d[i + 1] * (1 - alpha) + 199 * alpha);
              d[i + 2] = Math.round(d[i + 2] * (1 - alpha) + 176 * alpha);
            }
          }
          ctx.putImageData(overlayData, 0, 0);
        }
      }

      if (showProtectionOverlay && protectionMaskCanvas) {
        const protCtx = protectionMaskCanvas.getContext('2d', { willReadFrequently: true });
        if (protCtx) {
          const protData = protCtx.getImageData(0, 0, w, h).data;
          const overlayData = ctx.getImageData(0, 0, w, h);
          const d = overlayData.data;

          for (let i = 0; i < protData.length; i += 4) {
            const protVal = protData[i];
            if (protVal > 0) {
              const alpha = (protVal / 255) * 0.55;
              d[i] = Math.round(d[i] * (1 - alpha) + 245 * alpha);
              d[i + 1] = Math.round(d[i + 1] * (1 - alpha) + 158 * alpha);
              d[i + 2] = Math.round(d[i + 2] * (1 - alpha) + 11 * alpha);
            }
          }
          ctx.putImageData(overlayData, 0, 0);
        }
      }
    }
  }, [
    currentImage,
    originalImage,
    candidatePreview,
    splitSliderPos,
    isHoldingOriginal,
    showSelectionOverlay,
    effectiveSelectionMaskCanvas,
    showProtectionOverlay,
    protectionMaskCanvas,
    showEditableOverlay,
    scale,
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const getNativeCoords = (clientX: number, clientY: number) => {
    if (!containerRef.current || !currentImage) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left - pan.x;
    const clickY = clientY - rect.top - pan.y;
    const imgX = clickX / scale;
    const imgY = clickY / scale;

    const targetW = candidatePreview ? candidatePreview.canvas.width : currentImage.width;
    const targetH = candidatePreview ? candidatePreview.canvas.height : currentImage.height;

    if (imgX < 0 || imgX > targetW || imgY < 0 || imgY > targetH) {
      return null;
    }
    return { x: imgX, y: imgY };
  };

  /**
   * Writes paint stroke directly to the base mask (selection) or protection mask,
   * while also updating the live display canvas so strokes render continuously while drawing.
   */
  const paintStroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const isSelection = activeTool === 'brush_add' || activeTool === 'brush_erase';
    const isErase = activeTool === 'brush_erase' || activeTool === 'protect_erase';
    // Base mask is where selection modifications must be written!
    const targetBaseCanvas = isSelection ? baseSelectionMaskCanvas : protectionMaskCanvas;
    if (!targetBaseCanvas) return;

    const ctx = targetBaseCanvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.lineWidth = brushRadius * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isErase) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#000000';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#ffffff';
    }

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();

    // Also mirror stroke to effectiveSelectionMaskCanvas during interactive dragging
    // so user sees immediate feedback before pointerup builds dilated/feathered mask
    if (isSelection && effectiveSelectionMaskCanvas && effectiveSelectionMaskCanvas !== targetBaseCanvas) {
      const effCtx = effectiveSelectionMaskCanvas.getContext('2d');
      if (effCtx) {
        effCtx.save();
        effCtx.lineWidth = brushRadius * 2;
        effCtx.lineCap = 'round';
        effCtx.lineJoin = 'round';
        effCtx.globalCompositeOperation = 'source-over';
        effCtx.strokeStyle = isErase ? '#000000' : '#ffffff';
        effCtx.beginPath();
        effCtx.moveTo(from.x, from.y);
        effCtx.lineTo(to.x, to.y);
        effCtx.stroke();
        effCtx.restore();
      }
    }

    renderCanvas();
  };

  const handleCropPointerDown = (handle: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (!cropRect) return;
    isDraggingCropRef.current = handle;
    cropDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      rect: { ...cropRect },
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!currentImage || isProcessing) return;

    const targetEl = e.target as HTMLElement | null;
    if (
      targetEl &&
      (targetEl.closest('button') ||
        targetEl.closest('input') ||
        targetEl.closest('select') ||
        targetEl.closest('textarea') ||
        targetEl.closest('[data-no-canvas-click="true"]'))
    ) {
      return;
    }

    if (e.button === 1 || isSpacePressedRef.current || e.altKey) {
      setIsPanning(true);
      isAutoFitModeRef.current = false;
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }

    if (e.button !== 0) return;
    if (isCropActive) return;

    const coords = getNativeCoords(e.clientX, e.clientY);
    if (!coords) return;

    if (activeTool === 'smart_select') {
      const rect = containerRef.current?.getBoundingClientRect();
      const screenX = e.clientX - (rect?.left || 0);
      const screenY = e.clientY - (rect?.top || 0);
      onSmartSelectClick(
        coords.x / currentImage.width,
        coords.y / currentImage.height,
        screenX,
        screenY
      );
      return;
    }

    isPaintingRef.current = true;
    lastPaintPosRef.current = coords;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    paintStroke(coords, coords);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDraggingCropRef.current && cropRect && onChangeCropRect && currentImage) {
      const dx = (e.clientX - cropDragStartRef.current.x) / scale;
      const dy = (e.clientY - cropDragStartRef.current.y) / scale;
      const init = cropDragStartRef.current.rect;
      const imgW = currentImage.width;
      const imgH = currentImage.height;

      let { x, y, width, height } = init;
      const handle = isDraggingCropRef.current;

      if (handle === 'move') {
        x = Math.max(0, Math.min(init.x + dx, imgW - init.width));
        y = Math.max(0, Math.min(init.y + dy, imgH - init.height));
      } else {
        if (handle.includes('e')) {
          width = Math.max(20, Math.min(init.width + dx, imgW - init.x));
        }
        if (handle.includes('s')) {
          height = Math.max(20, Math.min(init.height + dy, imgH - init.y));
        }
        if (handle.includes('w')) {
          const newW = Math.max(20, init.width - dx);
          const newX = init.x + (init.width - newW);
          if (newX >= 0) {
            x = newX;
            width = newW;
          }
        }
        if (handle.includes('n')) {
          const newH = Math.max(20, init.height - dy);
          const newY = init.y + (init.height - newH);
          if (newY >= 0) {
            y = newY;
            height = newH;
          }
        }
      }

      onChangeCropRect({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      });
      return;
    }

    if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
      return;
    }

    if (isPaintingRef.current && lastPaintPosRef.current) {
      const coords = getNativeCoords(e.clientX, e.clientY);
      if (coords) {
        paintStroke(lastPaintPosRef.current, coords);
        lastPaintPosRef.current = coords;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDraggingCropRef.current) {
      isDraggingCropRef.current = null;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
    if (isPanning) {
      setIsPanning(false);
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
    if (isPaintingRef.current) {
      isPaintingRef.current = false;
      lastPaintPosRef.current = null;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      // Rebuilds effective mask from modified base mask with dilation & feather
      onMaskModified();
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!currentImage || !containerRef.current) return;
    e.preventDefault();
    isAutoFitModeRef.current = false;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const newScale = Math.min(Math.max(scale * zoomFactor, 0.05), 20);

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const newPanX = mouseX - (mouseX - pan.x) * (newScale / scale);
    const newPanY = mouseY - (mouseY - pan.y) * (newScale / scale);

    setScale(newScale);
    setPan({ x: newPanX, y: newPanY });
  };

  const renderWidth = candidatePreview ? candidatePreview.canvas.width : currentImage?.width || 0;
  const renderHeight = candidatePreview ? candidatePreview.canvas.height : currentImage?.height || 0;

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      className={`flex-1 min-h-0 relative overflow-hidden bg-[#16181b] select-none ${
        isSpacePressedRef.current ? 'cursor-grab' : isCropActive ? 'cursor-default' : 'cursor-crosshair'
      }`}
      style={{
        backgroundImage: `
          linear-gradient(45deg, #1d2024 25%, transparent 25%),
          linear-gradient(-45deg, #1d2024 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #1d2024 75%),
          linear-gradient(-45deg, transparent 75%, #1d2024 75%)
        `,
        backgroundSize: '24px 24px',
        backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
      }}
    >
      {/* Zoom / View controls & Compare bar */}
      <div
        data-no-canvas-click="true"
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute bottom-2.5 left-2.5 z-20 flex items-center gap-1 bg-[#131518]/90 backdrop-blur px-2 py-0.5 rounded border border-[#26292e] text-[11px] font-mono text-zinc-300"
      >
        <button
          type="button"
          onClick={() => {
            isAutoFitModeRef.current = false;
            setScale((s) => Math.max(s * 0.8, 0.05));
          }}
          className="p-0.5 hover:text-[#55c7b0]"
          title="Thu nhỏ"
        >
          <span className="material-symbols-outlined text-[15px]">remove</span>
        </button>
        <span className="px-1 min-w-[38px] text-center">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          onClick={() => {
            isAutoFitModeRef.current = false;
            setScale((s) => Math.min(s * 1.25, 20));
          }}
          className="p-0.5 hover:text-[#55c7b0]"
          title="Phóng to"
        >
          <span className="material-symbols-outlined text-[15px]">add</span>
        </button>
        <div className="w-px h-3 bg-[#2a2f36] mx-0.5" />
        <button
          type="button"
          onClick={() => {
            isAutoFitModeRef.current = true;
            fitToView();
          }}
          className="px-1 py-0.5 hover:text-[#55c7b0]"
          title="Vừa khung nhìn"
        >
          Khung
        </button>
        <button
          type="button"
          onClick={() => {
            isAutoFitModeRef.current = false;
            setScale(1);
            if (containerRef.current && currentImage) {
              setPan({
                x: (containerRef.current.clientWidth - renderWidth) / 2,
                y: (containerRef.current.clientHeight - renderHeight) / 2,
              });
            }
          }}
          className="px-1 py-0.5 hover:text-[#55c7b0]"
          title="Tỷ lệ 1:1"
        >
          100%
        </button>

        <div className="w-px h-3 bg-[#2a2f36] mx-0.5" />

        {/* Intended Editable Overlay Quick Toggle */}
        <button
          type="button"
          onClick={onToggleEditableOverlay}
          className={`px-1.5 py-0.5 rounded flex items-center gap-0.5 transition-colors ${
            showEditableOverlay
              ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40'
              : 'hover:text-pink-300 hover:bg-[#1e2226]'
          }`}
          title="Xem vùng sửa thực tế"
        >
          <span className="material-symbols-outlined text-[13px]">tune</span>
          <span className="hidden sm:inline">Vùng sửa</span>
        </button>

        <div className="w-px h-3 bg-[#2a2f36] mx-0.5" />

        {/* Hold to Compare Original */}
        {originalImage && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              setIsHoldingOriginal(true);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              setIsHoldingOriginal(false);
            }}
            onPointerLeave={() => setIsHoldingOriginal(false)}
            className={`px-1.5 py-0.5 rounded flex items-center gap-0.5 transition-colors ${
              isHoldingOriginal
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'hover:text-[#55c7b0] hover:bg-[#1e2226]'
            }`}
            title="Nhấn và giữ để xem ảnh gốc ban đầu"
          >
            <span className="material-symbols-outlined text-[13px]">visibility</span>
            <span className="hidden md:inline">Xem ảnh gốc</span>
          </button>
        )}

        {/* Split view when previewing candidate with matching geometry */}
        {candidatePreview &&
          currentImage &&
          candidatePreview.canvas.width === currentImage.width &&
          candidatePreview.canvas.height === currentImage.height && (
            <button
              type="button"
              onClick={() => setSplitSliderPos((pos) => (pos === null ? 50 : null))}
              className={`px-1.5 py-0.5 rounded flex items-center gap-0.5 transition-colors ${
                splitSliderPos !== null
                  ? 'bg-[#55c7b0]/20 text-[#55c7b0] border border-[#55c7b0]/40'
                  : 'hover:text-[#55c7b0]'
              }`}
              title="So sánh phân đôi màn hình"
            >
              <span className="material-symbols-outlined text-[13px]">splitscreen</span>
              <span>So sánh</span>
            </button>
          )}
      </div>

      {/* Split Slider Control */}
      {candidatePreview &&
        splitSliderPos !== null &&
        currentImage &&
        candidatePreview.canvas.width === currentImage.width &&
        candidatePreview.canvas.height === currentImage.height && (
          <div
            data-no-canvas-click="true"
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 bg-[#131518]/90 backdrop-blur px-2.5 py-1 rounded-full border border-[#2a2f36] flex items-center gap-2 text-xs"
          >
            <span className="text-zinc-400 text-[10px]">Hiện tại</span>
            <input
              type="range"
              min="0"
              max="100"
              value={splitSliderPos}
              onChange={(e) => setSplitSliderPos(Number(e.target.value))}
              className="w-28 accent-[#55c7b0] cursor-ew-resize"
            />
            <span className="text-[#55c7b0] text-[10px]">Xem trước</span>
          </div>
        )}

      {/* Main Image Layer */}
      {currentImage ? (
        <div
          className="absolute origin-top-left shadow-2xl transition-transform duration-75 ease-out"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0px) scale(${scale})`,
            width: renderWidth,
            height: renderHeight,
          }}
        >
          <canvas
            ref={displayCanvasRef}
            className="block"
            style={{
              width: renderWidth,
              height: renderHeight,
              imageRendering: scale > 2 ? 'pixelated' : 'auto',
            }}
          />

          {/* Interactive Crop Rectangle */}
          {isCropActive && cropRect && !candidatePreview && (
            <div
              className="absolute pointer-events-auto"
              style={{
                left: cropRect.x,
                top: cropRect.y,
                width: cropRect.width,
                height: cropRect.height,
              }}
            >
              <div
                className="absolute inset-0 border-2 border-[#55c7b0] shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] cursor-move"
                onPointerDown={(e) => handleCropPointerDown('move', e)}
              >
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                  <div className="border-r border-b border-[#55c7b0]" />
                  <div className="border-r border-b border-[#55c7b0]" />
                  <div className="border-b border-[#55c7b0]" />
                  <div className="border-r border-b border-[#55c7b0]" />
                  <div className="border-r border-b border-[#55c7b0]" />
                  <div className="border-b border-[#55c7b0]" />
                  <div className="border-r border-b border-[#55c7b0]" />
                  <div className="border-r border-b border-[#55c7b0]" />
                  <div />
                </div>

                <div
                  className="absolute -top-6 left-0 bg-[#141618] text-[#55c7b0] font-mono text-[9px] px-1 py-0.5 rounded border border-[#55c7b0]/50 select-none pointer-events-none whitespace-nowrap"
                  style={{ transform: `scale(${Math.max(0.6, 1 / scale)})`, transformOrigin: 'bottom left' }}
                >
                  {cropRect.width} × {cropRect.height} px
                </div>
              </div>

              {(
                [
                  { id: 'nw', pos: '-top-1.5 -left-1.5 cursor-nwse-resize' },
                  { id: 'n', pos: '-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize' },
                  { id: 'ne', pos: '-top-1.5 -right-1.5 cursor-nesw-resize' },
                  { id: 'e', pos: 'top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize' },
                  { id: 'se', pos: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
                  { id: 's', pos: '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize' },
                  { id: 'sw', pos: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
                  { id: 'w', pos: 'top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize' },
                ] as const
              ).map((h) => (
                <div
                  key={h.id}
                  onPointerDown={(e) => handleCropPointerDown(h.id, e)}
                  className={`absolute w-3 h-3 bg-white border border-[#141618] rounded-sm shadow-md z-10 ${h.pos}`}
                  style={{ transform: `scale(${Math.max(0.6, 1 / scale)})` }}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 gap-2">
          <span className="material-symbols-outlined text-[44px] text-zinc-600">add_photo_alternate</span>
          <p className="text-xs font-medium text-zinc-400">Chưa có ảnh nào trong studio</p>
          <p className="text-[11px] text-zinc-600">
            Bấm "Thêm ảnh" ở thanh trên cùng hoặc mở phiên từ tệp JSON
          </p>
        </div>
      )}

      {/* Candidate Menu */}
      {candidateMasks && candidateClickPoint && (
        <div
          data-no-canvas-click="true"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute z-30 bg-[#16181b] border border-[#2b3036] shadow-2xl rounded-md p-2 text-xs flex flex-col gap-1.5 min-w-[220px]"
          style={{
            left: Math.min(
              candidateClickPoint.x + 8,
              (containerRef.current?.clientWidth || 300) - 240
            ),
            top: Math.min(
              candidateClickPoint.y + 8,
              (containerRef.current?.clientHeight || 300) - 190
            ),
          }}
        >
          <div className="flex items-center justify-between pb-1 border-b border-[#24282c]">
            <span className="text-[10px] font-semibold text-zinc-300">Vùng chọn đề xuất:</span>
            <button
              type="button"
              onClick={onCloseCandidateMenu}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <span className="material-symbols-outlined text-[13px]">close</span>
            </button>
          </div>

          <div className="flex items-center gap-1 bg-[#111315] p-0.5 rounded border border-[#25292f]">
            <button
              type="button"
              onClick={() => setCandidateApplyMode('replace')}
              className={`flex-1 py-0.5 rounded text-[9.5px] font-medium transition-colors ${
                candidateApplyMode === 'replace'
                  ? 'bg-[#55c7b0] text-[#0d1815] font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Thay thế
            </button>
            <button
              type="button"
              onClick={() => setCandidateApplyMode('add')}
              className={`flex-1 py-0.5 rounded text-[9.5px] font-medium transition-colors ${
                candidateApplyMode === 'add'
                  ? 'bg-[#55c7b0] text-[#0d1815] font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Thêm +
            </button>
            <button
              type="button"
              onClick={() => setCandidateApplyMode('subtract')}
              className={`flex-1 py-0.5 rounded text-[9.5px] font-medium transition-colors ${
                candidateApplyMode === 'subtract'
                  ? 'bg-[#55c7b0] text-[#0d1815] font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Bớt -
            </button>
          </div>

          <div className="flex flex-col gap-1">
            {candidateMasks.map((cand) => (
              <button
                key={cand.id}
                type="button"
                onClick={() => onApplyCandidateMask(cand, candidateApplyMode)}
                className="flex items-center justify-between px-2 py-1 rounded bg-[#1e2125] hover:bg-[#262a30] text-zinc-200 hover:text-white transition-colors"
              >
                <div className="flex flex-col text-left">
                  <span className="font-medium text-[10.5px]">{cand.label}</span>
                  <span className="text-[8.5px] text-zinc-400 font-mono">
                    {cand.pixelCount.toLocaleString()} px
                  </span>
                </div>
                <span className="material-symbols-outlined text-[13px] text-zinc-400">
                  {candidateApplyMode === 'add'
                    ? 'add'
                    : candidateApplyMode === 'subtract'
                    ? 'remove'
                    : 'check'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Processing overlay */}
      {isProcessing && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30 flex flex-col items-center justify-center gap-2.5">
          <div className="w-7 h-7 border-2 border-[#55c7b0] border-t-transparent rounded-full animate-spin" />
          <div className="text-xs font-medium text-zinc-200 bg-[#16181b] px-3 py-1.5 rounded border border-[#2b3036] shadow-lg max-w-sm text-center">
            {processingMessage || 'Đang xử lý...'}
          </div>
        </div>
      )}
    </div>
  );
};
