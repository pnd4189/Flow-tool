import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Flow } from 'flow-sdk';
import { HistoryItem, Language, QcReport } from '../types';
import { t } from '../services/i18n';
import { buildFilename } from '../services/imageUtils';
import { VariantPanel } from './VariantPanel';
import { VariantChanges } from '../services/variant';
import {
  ViewState,
  resetView,
  zoomAt,
  panBy,
} from '../services/viewport';

interface ImageViewerProps {
  item: HistoryItem;
  history?: HistoryItem[];
  compareItem?: HistoryItem | null;
  isCompareMode?: boolean;
  onToggleCompare?: () => void;
  onSelectCompareItem?: (id: string) => void;
  lang: Language;
  isRunning?: boolean;
  onRegenerate: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onCreateVariant?: (item: HistoryItem, changes: VariantChanges, count: number) => void;
}

function getQcBadgeColor(qc?: QcReport, pending?: boolean): { bg: string; text: string; label: string } {
  if (!qc && pending) {
    return { bg: 'bg-[#262c36]/80 animate-pulse', text: 'text-[#8b93a1]', label: 'QC: …' };
  }
  if (!qc || !qc.available) {
    return { bg: 'bg-[#8b93a1]/20 border-[#8b93a1]/40', text: 'text-[#8b93a1]', label: 'QC: n/a' };
  }
  if (qc.score >= 80) {
    return { bg: 'bg-[#22c55e]/20 border-[#22c55e]/50', text: 'text-[#4ade80]', label: `QC: ${qc.score}` };
  }
  if (qc.score >= 65) {
    return { bg: 'bg-[#f59e0b]/20 border-[#f59e0b]/50', text: 'text-[#fbbf24]', label: `QC: ${qc.score}` };
  }
  return { bg: 'bg-[#ef4444]/20 border-[#ef4444]/50', text: 'text-[#f87171]', label: `QC: ${qc.score}` };
}

function buildQcTooltip(qc: QcReport | undefined, lang: Language): string {
  if (!qc || !qc.available) {
    return t(lang, 'tooltip_qc_na');
  }

  const parts = [
    t(lang, 'tooltip_qc_score', { score: qc.score }),
    t(lang, 'tooltip_qc_views', { found: qc.viewCount, expected: qc.expectedViews }),
  ];

  if (qc.hasText) {
    const words = qc.textFound && qc.textFound.length > 0 ? qc.textFound.join(', ') : '...';
    parts.push(t(lang, 'tooltip_qc_hastext', { words }));
  } else {
    parts.push(t(lang, 'tooltip_qc_notext'));
  }

  if (qc.faceMatch !== null) {
    parts.push(t(lang, 'tooltip_qc_facematch', { match: qc.faceMatch }));
  }

  if (qc.issues && qc.issues.length > 0) {
    parts.push(`Issues: ${qc.issues.join('; ')}`);
  }

  return parts.join('\n');
}

export const ImageViewer: React.FC<ImageViewerProps> = ({
  item,
  history = [],
  compareItem = null,
  isCompareMode = false,
  onToggleCompare,
  lang,
  isRunning = false,
  onRegenerate,
  onDelete,
  onToggleFavorite,
  onCreateVariant,
}) => {
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isVariantOpen, setIsVariantOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Synchronized view state for zoom and pan
  const [viewState, setViewState] = useState<ViewState>(resetView());

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset view state when selected item changes
  useEffect(() => {
    setViewState(resetView());
    setIsVariantOpen(false);
  }, [item.id]);

  // Reset delete confirmation after 3s
  useEffect(() => {
    if (!deleteConfirm) return;
    const timer = setTimeout(() => {
      setDeleteConfirm(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [deleteConfirm]);

  // Escape key closes fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  const getContainerSize = useCallback(() => {
    if (containerRef.current) {
      return {
        width: containerRef.current.clientWidth || 800,
        height: containerRef.current.clientHeight || 600,
      };
    }
    return { width: 800, height: 600 };
  }, []);

  // Zoom helpers
  const handleZoomIn = () => {
    const size = getContainerSize();
    setViewState((prev) =>
      zoomAt(prev, { x: size.width / 2, y: size.height / 2 }, 1.3, size)
    );
  };

  const handleZoomOut = () => {
    const size = getContainerSize();
    setViewState((prev) =>
      zoomAt(prev, { x: size.width / 2, y: size.height / 2 }, 1 / 1.3, size)
    );
  };

  const handleResetFit = () => {
    setViewState(resetView());
  };

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const size = getContainerSize();
    setViewState((prev) => zoomAt(prev, point, factor, size));
  };

  // Mouse drag pan
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };

    if (viewState.scale > 1) {
      const size = getContainerSize();
      setViewState((prev) => panBy(prev, dx, dy, size));
    }
  };

  const handleMouseUpOrLeave = () => {
    isDraggingRef.current = false;
  };

  // Double click toggle between 1x and 2x
  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    const size = getContainerSize();

    setViewState((prev) => {
      if (prev.scale > 1.2) {
        return resetView();
      }
      return zoomAt(prev, point, 2 / prev.scale, size);
    });
  };

  // Keyboard navigation when viewer has focus: +, -, 0
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      handleZoomIn();
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      handleZoomOut();
    } else if (e.key === '0') {
      e.preventDefault();
      handleResetFit();
    }
  };

  const handleDownload = async () => {
    if (downloadState === 'downloading') return;
    setDownloadState('downloading');

    try {
      const dataToDownload = item.base64 ? item.base64 : item.thumb;
      const filename = buildFilename(
        item.config.tag,
        item.config.layoutId,
        item.mimeType,
        new Date(item.createdAt)
      );

      await Flow.download({
        base64: dataToDownload,
        mimeType: item.mimeType as any,
        filename,
      });

      setDownloadState('done');
      setTimeout(() => setDownloadState('idle'), 2500);
    } catch {
      setDownloadState('error');
      setTimeout(() => setDownloadState('idle'), 3000);
    }
  };

  const handleDeleteClick = () => {
    if (deleteConfirm) {
      onDelete(item.id);
      setDeleteConfirm(false);
    } else {
      setDeleteConfirm(true);
    }
  };

  const handleVariantSubmit = (changes: VariantChanges, count: number) => {
    if (onCreateVariant) {
      onCreateVariant(item, changes, count);
    }
  };

  const isEvicted = item.base64 === null;
  const imageSrc = item.base64
    ? `data:${item.mimeType};base64,${item.base64}`
    : item.thumb;

  const compareIsEvicted = compareItem && compareItem.base64 === null;
  const compareImageSrc = compareItem
    ? compareItem.base64
      ? `data:${compareItem.mimeType};base64,${compareItem.base64}`
      : compareItem.thumb
    : null;

  // History index numbers
  const itemIndex = history.findIndex((h) => h.id === item.id);
  const itemNumber = itemIndex >= 0 ? history.length - itemIndex : 1;

  const compareIndex = compareItem ? history.findIndex((h) => h.id === compareItem.id) : -1;
  const compareNumber = compareIndex >= 0 ? history.length - compareIndex : null;

  const qcBadge = getQcBadgeColor(item.qc, item.qcPending);
  const qcTooltip = buildQcTooltip(item.qc, lang);

  // Transform style for canvas/image zoom & pan
  const transformStyle: React.CSSProperties = {
    transform: `translate(${viewState.x}px, ${viewState.y}px) scale(${viewState.scale})`,
    transformOrigin: '0 0',
    transition: isDraggingRef.current ? 'none' : 'transform 0.08s ease-out',
    cursor: viewState.scale > 1 ? (isDraggingRef.current ? 'grabbing' : 'grab') : 'default',
  };

  // Reusable image canvas display element
  const renderCanvasContent = (fullOverlay: boolean = false) => {
    const isShowingCompare = isCompareMode && compareItem;

    return (
      <div
        ref={containerRef}
        tabIndex={0}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        className={`flex-1 relative flex items-center justify-center bg-[#0a0c0f] overflow-hidden select-none outline-none ${
          fullOverlay ? 'w-full h-full p-4 md:p-8' : 'p-3 md:p-4'
        }`}
      >
        {/* Subtle grid backdrop */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(#7c9cff 1px, transparent 1px), linear-gradient(90deg, #7c9cff 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* Viewport Floating Zoom Toolbar */}
        <div className="absolute top-3 right-3 z-30 flex items-center gap-1 bg-[#161a21]/90 backdrop-blur-md p-1 rounded-xl border border-[#262c36] shadow-xl">
          <button
            type="button"
            onClick={handleZoomIn}
            className="w-7 h-7 rounded-lg hover:bg-[#262c36] text-[#e6e9ef] flex items-center justify-center text-xs transition-colors"
            title={t(lang, 'btn_zoom_in')}
          >
            <span className="material-symbols-outlined text-sm">zoom_in</span>
          </button>
          <span className="text-[10px] font-mono font-bold text-[#7c9cff] px-1 select-none min-w-[34px] text-center">
            {Math.round(viewState.scale * 100)}%
          </span>
          <button
            type="button"
            onClick={handleZoomOut}
            className="w-7 h-7 rounded-lg hover:bg-[#262c36] text-[#e6e9ef] flex items-center justify-center text-xs transition-colors"
            title={t(lang, 'btn_zoom_out')}
          >
            <span className="material-symbols-outlined text-sm">zoom_out</span>
          </button>
          <button
            type="button"
            onClick={handleResetFit}
            className="px-2 h-7 rounded-lg bg-[#0e1014] hover:bg-[#262c36] text-[11px] font-semibold text-[#8b93a1] hover:text-[#e6e9ef] flex items-center gap-1 transition-colors border border-[#262c36]"
            title={t(lang, 'btn_fit_frame')}
          >
            <span className="material-symbols-outlined text-xs">fit_screen</span>
            <span className="hidden sm:inline">{t(lang, 'btn_fit_frame')}</span>
          </button>
        </div>

        {/* Single Image View or Side-by-Side Compare */}
        {!isShowingCompare ? (
          <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden">
            <div
              style={transformStyle}
              className="relative max-w-full max-h-full flex items-center justify-center shadow-2xl rounded-xl border border-[#262c36] bg-[#161a21] overflow-hidden"
            >
              <img
                src={imageSrc}
                alt={item.config.displayName || 'Character Sheet'}
                className="max-h-[calc(100vh-270px)] max-w-full object-contain pointer-events-none select-none"
                draggable={false}
              />

              {/* Notice if evicted */}
              {isEvicted && (
                <div className="absolute bottom-3 left-3 right-3 p-2 rounded-lg bg-black/85 backdrop-blur-sm border border-[#262c36] text-[11px] text-[#fbbf24] flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm shrink-0">info</span>
                  <span>{t(lang, 'evicted_image_notice')}</span>
                </div>
              )}
            </div>

            <div className="absolute bottom-2 left-3 px-2 py-0.5 rounded-md bg-[#0e1014]/80 backdrop-blur-sm border border-[#262c36] text-[10px] font-mono text-[#8b93a1]">
              #{itemNumber} · {item.config.aspectRatio}
            </div>
          </div>
        ) : (
          <div className="relative w-full h-full grid grid-cols-2 gap-3 items-center justify-center overflow-hidden">
            {/* Left Image: Selected Item */}
            <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden">
              <div
                style={transformStyle}
                className="relative max-w-full max-h-full flex items-center justify-center shadow-2xl rounded-xl border border-[#262c36] bg-[#161a21] overflow-hidden"
              >
                <img
                  src={imageSrc}
                  alt="Left Sheet"
                  className="max-h-[calc(100vh-270px)] max-w-full object-contain pointer-events-none select-none"
                  draggable={false}
                />
                {isEvicted && (
                  <div className="absolute bottom-2 left-2 right-2 p-1.5 rounded-lg bg-black/85 backdrop-blur-sm border border-[#262c36] text-[10px] text-[#fbbf24] flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs shrink-0">info</span>
                    <span className="truncate">{t(lang, 'evicted_image_notice')}</span>
                  </div>
                )}
              </div>
              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-[#0e1014]/80 backdrop-blur-sm border border-[#262c36] text-[10px] font-mono text-[#7c9cff] font-bold">
                #{itemNumber} ({t(lang, 'compare_left_label')})
              </div>
            </div>

            {/* Right Image: Compare Item */}
            <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden">
              <div
                style={transformStyle}
                className="relative max-w-full max-h-full flex items-center justify-center shadow-2xl rounded-xl border border-[#262c36] bg-[#161a21] overflow-hidden"
              >
                <img
                  src={compareImageSrc || ''}
                  alt="Right Compare Sheet"
                  className="max-h-[calc(100vh-270px)] max-w-full object-contain pointer-events-none select-none"
                  draggable={false}
                />
                {compareIsEvicted && (
                  <div className="absolute bottom-2 left-2 right-2 p-1.5 rounded-lg bg-black/85 backdrop-blur-sm border border-[#262c36] text-[10px] text-[#fbbf24] flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs shrink-0">info</span>
                    <span className="truncate">{t(lang, 'evicted_image_notice')}</span>
                  </div>
                )}
              </div>
              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-[#0e1014]/80 backdrop-blur-sm border border-[#262c36] text-[10px] font-mono text-[#fbbf24] font-bold">
                #{compareNumber} ({t(lang, 'compare_right_label')})
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0e1014] overflow-hidden">
      {/* Top action toolbar */}
      <div className="p-3 bg-[#161a21] border-b border-[#262c36] flex items-center justify-between gap-2 shrink-0 z-10 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="px-2 py-0.5 rounded-lg bg-[#0e1014] border border-[#262c36] text-[11px] font-mono text-[#7c9cff] font-bold">
            @{item.config.tag || 'character'}
          </div>
          <span className="text-xs text-[#8b93a1] truncate hidden sm:inline">
            {item.config.displayName}
          </span>

          {/* Variant tag if item is a variant */}
          {item.parentId && (
            <span
              title={item.changesSummary || ''}
              className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#7c9cff]/20 text-[#7c9cff] border border-[#7c9cff]/40 flex items-center gap-1 cursor-help"
            >
              <span className="material-symbols-outlined text-xs">auto_fix_high</span>
              <span>{t(lang, 'badge_variant_tag')}</span>
            </span>
          )}

          {/* QC Badge */}
          <div
            title={qcTooltip}
            className={`cursor-help px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold border backdrop-blur-sm flex items-center gap-1 ${qcBadge.bg} ${qcBadge.text}`}
          >
            <span className="material-symbols-outlined text-xs">verified</span>
            <span>{qcBadge.label}</span>
          </div>

          {/* Warning badge when hasText is true */}
          {item.qc?.hasText && (
            <span
              title={item.qc.textFound && item.qc.textFound.length > 0 ? item.qc.textFound.join(', ') : ''}
              className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/40 flex items-center gap-1 cursor-help"
            >
              <span className="material-symbols-outlined text-xs">warning</span>
              <span>{t(lang, 'badge_qc_text_warning')}</span>
            </span>
          )}

          {item.rewriteRound > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fbbf24]/10 text-[#fbbf24] border border-[#fbbf24]/20 hidden md:inline">
              {t(lang, 'badge_sanitized', { round: item.rewriteRound })}
            </span>
          )}
        </div>

        {/* Toolbar Buttons */}
        <div className="flex items-center gap-1.5">
          {/* So sánh toggle button */}
          <button
            type="button"
            onClick={onToggleCompare}
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isCompareMode
                ? 'bg-[#7c9cff] text-[#0e1014] border-[#7c9cff] shadow-sm font-bold'
                : 'bg-[#0e1014] border-[#262c36] hover:border-[#7c9cff] text-[#e6e9ef]'
            }`}
            title={t(lang, 'btn_compare_hint')}
          >
            <span className="material-symbols-outlined text-sm">compare</span>
            <span>{t(lang, 'btn_compare')}</span>
          </button>

          {/* Fullscreen button (CSS only) */}
          <button
            type="button"
            onClick={() => setIsFullscreen(true)}
            className="p-2 rounded-xl bg-[#0e1014] border border-[#262c36] hover:border-[#7c9cff] text-[#8b93a1] hover:text-[#e6e9ef] transition-colors"
            title={t(lang, 'btn_fullscreen')}
          >
            <span className="material-symbols-outlined text-base">fullscreen</span>
          </button>

          {/* Biến thể button */}
          <button
            type="button"
            onClick={() => setIsVariantOpen((prev) => !prev)}
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isVariantOpen
                ? 'bg-[#7c9cff] text-[#0e1014] border-[#7c9cff] shadow-sm shadow-[#7c9cff]/20 font-bold'
                : 'bg-[#0e1014] border-[#262c36] hover:border-[#7c9cff] text-[#e6e9ef]'
            }`}
            title={t(lang, 'btn_variant')}
          >
            <span className="material-symbols-outlined text-sm">auto_fix_high</span>
            <span>{t(lang, 'btn_variant')}</span>
          </button>

          {/* Favorite star */}
          <button
            type="button"
            onClick={() => onToggleFavorite(item.id)}
            className={`p-2 rounded-xl border transition-all ${
              item.favorite
                ? 'bg-[#fbbf24]/10 border-[#fbbf24]/40 text-[#fbbf24]'
                : 'bg-[#0e1014] border-[#262c36] text-[#8b93a1] hover:text-[#e6e9ef]'
            }`}
            title={item.favorite ? t(lang, 'tooltip_unfavorite') : t(lang, 'tooltip_favorite')}
          >
            <span className="material-symbols-outlined text-base">
              {item.favorite ? 'star' : 'star_border'}
            </span>
          </button>

          {/* Regenerate with same config */}
          <button
            type="button"
            onClick={() => onRegenerate(item)}
            className="px-2.5 py-1.5 rounded-xl bg-[#0e1014] border border-[#262c36] hover:border-[#7c9cff] text-[#e6e9ef] text-xs font-semibold flex items-center gap-1.5 transition-all"
            title={t(lang, 'btn_regenerate')}
          >
            <span className="material-symbols-outlined text-sm text-[#7c9cff]">refresh</span>
            <span className="hidden sm:inline">{t(lang, 'btn_regenerate')}</span>
          </button>

          {/* Two-step delete button */}
          <button
            type="button"
            onClick={handleDeleteClick}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 transition-all ${
              deleteConfirm
                ? 'bg-[#ef4444] text-white shadow-md shadow-[#ef4444]/30 animate-pulse'
                : 'bg-[#0e1014] border border-[#262c36] text-[#8b93a1] hover:text-[#ef4444]'
            }`}
            title={t(lang, 'btn_delete')}
          >
            <span className="material-symbols-outlined text-sm">delete</span>
            <span>{deleteConfirm ? t(lang, 'btn_delete_confirm') : t(lang, 'btn_delete')}</span>
          </button>

          {/* Download button */}
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloadState === 'downloading'}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md ${
              downloadState === 'done'
                ? 'bg-[#4ade80] text-[#0e1014]'
                : downloadState === 'error'
                ? 'bg-[#ef4444] text-white'
                : 'bg-[#7c9cff] text-[#0e1014] hover:brightness-110 active:scale-95'
            }`}
          >
            <span className="material-symbols-outlined text-sm">
              {downloadState === 'done'
                ? 'check'
                : downloadState === 'downloading'
                ? 'sync'
                : 'download'}
            </span>
            <span>
              {downloadState === 'downloading'
                ? t(lang, 'btn_downloading')
                : downloadState === 'done'
                ? t(lang, 'btn_downloaded')
                : t(lang, 'btn_download')}
            </span>
          </button>
        </div>
      </div>

      {/* Collapsible Variant Panel */}
      {isVariantOpen && (
        <VariantPanel
          lang={lang}
          isRunning={isRunning}
          onSubmit={handleVariantSubmit}
          onClose={() => setIsVariantOpen(false)}
        />
      )}

      {/* Main Image Display Area */}
      {renderCanvasContent(false)}

      {/* Full-Window CSS-Only Fullscreen Overlay (NO Fullscreen API) */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-[#07090c]/98 backdrop-blur-xl flex flex-col animate-in fade-in-50 duration-150">
          {/* Fullscreen Overlay Header */}
          <div className="px-4 py-3 bg-[#161a21]/80 border-b border-[#262c36] flex items-center justify-between z-20">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-0.5 rounded-lg bg-[#0e1014] text-xs font-mono text-[#7c9cff] font-bold border border-[#262c36]">
                @{item.config.tag || 'character'}
              </span>
              <span className="text-sm font-bold text-[#e6e9ef]">
                {item.config.displayName}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="px-3 py-1.5 rounded-xl bg-[#262c36] hover:bg-[#333b47] text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
                title={t(lang, 'btn_close_fullscreen')}
              >
                <span className="material-symbols-outlined text-sm">close</span>
                <span>{t(lang, 'btn_close_fullscreen')}</span>
              </button>
            </div>
          </div>

          {/* Fullscreen Canvas Content */}
          <div className="flex-1 w-full h-full overflow-hidden flex items-center justify-center">
            {renderCanvasContent(true)}
          </div>
        </div>
      )}
    </div>
  );
};
