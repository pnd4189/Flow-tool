// ============================================================
// FULL CODE — Paste this entire file into Flow to build the tool.
// Each section is separated by === FILE: path === markers.
// ============================================================


// === FILE: types.ts ===

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export interface Scene {
  id: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AspectRatio;
  status: 'pending' | 'generating' | 'upscaling' | 'success' | 'error';
  result?: {
    base64: string;
    mimeType: string;
    mediaId: string;
  };
  errorMessage?: string;
}

export interface BatchSettings {
  modelDisplayName: string;
  aspectRatio: AspectRatio;
  resolution: 'Full HD' | '2K' | '4K';
  delaySeconds: number;
}

export interface BatchState {
  isRunning: boolean;
  isPaused: boolean;
  currentIndex: number;
  total: number;
  successCount: number;
  failedCount: number;
}

export interface DownloadProgress {
  isProcessing: boolean;
  percent: number;
  message: string;
}


// === FILE: services/parser.ts ===

import { Scene, AspectRatio } from '../types';

// Shared aspect-ratio matcher — used by both the structured `aspect ratio:` field
// and inline prose, so the two paths agree on all five ratios.
const AR_PATTERN = /\b(16:9|9:16|1:1|4:3|3:4)\b/i;
function matchAR(value: string): AspectRatio | null {
  const m = value.match(AR_PATTERN);
  return m ? (m[1] as AspectRatio) : null;
}

// crypto.randomUUID requires a secure context (HTTPS). Flow runs on HTTPS so it is
// available, but guard with a fallback so a non-secure embed (e.g. file:// preview)
// does not throw and break scene parsing entirely.
function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const SEPARATOR_TYPES = [
  // No `g` flag here: these patterns are reused with .test() in detectSeparator,
  // and a `g` flag would make .test() stateful (lastIndex carryover between calls,
  // producing non-deterministic separator detection). parseScenes builds its own
  // global clone for matchAll, so `g` is not needed on the source patterns.
  { id: 'marker', name: 'Scene Markers', pattern: /--- SCENE \d+ ---|SCENE \d+:|\[CẢNH \d+\]|PHÂN CẢNH \d+|PROMPT \d+/i },
  { id: 'markdown', name: 'Markdown Headings', pattern: /^#{1,6}\s+.+$/m },
  { id: 'divider', name: 'Dividers', pattern: /^-{3,}|={3,}|\*{3,}|_{3,}$/m },
  { id: 'list', name: 'Lists', pattern: /^\d+[\.\\)]\s+|^\s*[\-\*•]\s+/m },
  { id: 'newline', name: 'Blank Lines', pattern: /\n\s*\n/ },
];

export function detectSeparator(text: string) {
  for (const sep of SEPARATOR_TYPES) {
    if (sep.pattern.test(text)) return sep;
  }
  return SEPARATOR_TYPES[SEPARATOR_TYPES.length - 1]; // Default to newline
}

export function parseScenes(text: string, defaultAR: AspectRatio): Scene[] {
  const sep = detectSeparator(text);
  let blocks: string[] = [];

  if (sep.id === 'newline') {
    blocks = text.split(/\n\s*\n/).filter(b => b.trim().length > 0);
  } else {
    // Build a global clone for matchAll, preserving the original flags (i for
    // case-insensitive markers, m for ^/$ anchors) and adding `g`. Previously this
    // rebuilt with hardcoded 'gm', dropping the `i` flag so lowercase Vietnamese
    // markers like [cảnh 1] never matched and the whole input became one scene.
    const globalPattern = new RegExp(
      sep.pattern.source,
      sep.pattern.flags + (sep.pattern.flags.includes('g') ? '' : 'g')
    );
    const matches = Array.from(text.matchAll(globalPattern));
    if (matches.length === 0) {
      blocks = [text];
    } else if (sep.id === 'marker' || sep.id === 'markdown') {
      // The matched token is the block's label (title): each block starts at its
      // own marker and ends at the next. Preamble before the first marker is not a
      // scene and is dropped.
      let lastIdx = matches[0].index;
      for (let i = 1; i < matches.length; i++) {
        blocks.push(text.slice(lastIdx, matches[i].index).trim());
        lastIdx = matches[i].index;
      }
      blocks.push(text.slice(lastIdx).trim());
    } else {
      // The matched token is a pure delimiter (divider/list): each block is the
      // content between delimiters, the delimiter itself is excluded, and the
      // preamble before the first delimiter is kept as the first scene. Previously
      // the preamble was dropped and the delimiter line leaked into the next block.
      let prevEnd = 0;
      for (const m of matches) {
        blocks.push(text.slice(prevEnd, m.index).trim());
        prevEnd = m.index + m[0].length;
      }
      blocks.push(text.slice(prevEnd).trim());
    }
  }

  return blocks.filter(b => b.trim()).map((block, index) => {
    const lines = block.split('\n').map(l => l.trim());

    // For marker/markdown blocks the first line is the label. Extract just the
    // matched marker/heading as the title and keep any trailing text on that line
    // as prompt content, so "SCENE 1: A sunset" does not lose "A sunset". Other
    // separators treat every line as content.
    let title = `Scene ${index + 1}`;
    let contentLines = lines;

    if (sep.id === 'marker' || sep.id === 'markdown') {
      const first = lines[0] || '';
      const m = first.match(sep.pattern);
      if (m && m.index !== undefined) {
        const label = m[0];
        const remainder = first.slice(m.index + label.length).trim();
        title = label.length <= 50 ? label : `Scene ${index + 1}`;
        contentLines = [remainder, ...lines.slice(1)].filter(l => l.length > 0);
      }
    }

    let promptParts: string[] = [];
    let negativePrompt = '';
    let detectedAR: AspectRatio = defaultAR;

    // Structured parsing
    const structuredFields: Record<string, string> = {};

    contentLines.forEach(line => {
      // Require whitespace after the colon so a ratio like "4:3" (colon with no
      // following space) is not misparsed as a "key: value" pair and can still be
      // detected by the inline AR matcher below.
      const match = line.match(/^([^:]+):\s+(.*)$/i);
      if (match) {
        const key = match[1].toLowerCase().trim();
        const val = match[2].trim();

        if (key === 'negative' || key === 'avoid') {
          negativePrompt = val;
        } else if (key === 'aspect ratio' || key === 'ar') {
          const ar = matchAR(val);
          if (ar) detectedAR = ar;
        } else {
          structuredFields[key] = val;
        }
      } else {
        // Look for inline AR phrases (all five ratios)
        const ar = matchAR(line);
        if (ar) detectedAR = ar;

        promptParts.push(line);
      }
    });

    // Merge structured fields into prompt if not empty
    const mergedStructured = Object.entries(structuredFields)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    const finalPrompt = [mergedStructured, ...promptParts].filter(p => p).join(' ').trim();

    return {
      id: genId(),
      title,
      prompt: finalPrompt || block.trim(),
      negativePrompt: negativePrompt || undefined,
      aspectRatio: detectedAR,
      status: 'pending'
    };
  });
}


// === FILE: services/image.ts ===

import pica from 'pica';

const resizer = pica();

export const RESOLUTION_MAP = {
  'Full HD': 1080,
  '2K': 1440,
  '4K': 2160,
};

/**
 * Upscales a base64 image to a target resolution using Lanczos resampling.
 * Anchors the resolution to the height (e.g., 1080p, 1440p, 2160p).
 */
export async function upscaleImage(
  base64: string, 
  mimeType: string, 
  targetResolution: keyof typeof RESOLUTION_MAP
): Promise<{ base64: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const targetHeight = RESOLUTION_MAP[targetResolution];
        const aspectRatio = img.width / img.height;
        const targetWidth = Math.round(targetHeight * aspectRatio);

        // Create offscreen canvas for source
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = img.width;
        srcCanvas.height = img.height;
        const srcCtx = srcCanvas.getContext('2d');
        if (!srcCtx) throw new Error('Failed to get source context');
        srcCtx.drawImage(img, 0, 0);

        // Create offscreen canvas for destination
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = targetWidth;
        dstCanvas.height = targetHeight;

        // Use Pica for high-quality Lanczos resampling
        await resizer.resize(srcCanvas, dstCanvas, {
          unsharpAmount: 80,
          unsharpRadius: 0.6,
          unsharpThreshold: 2,
        });

        const resultBase64 = dstCanvas.toDataURL(mimeType, 0.92).split(',')[1];
        resolve({ base64: resultBase64 });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for upscaling'));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}


// === FILE: components/Primitives.tsx ===

import React, { useState, useRef, useEffect } from 'react';

export const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center px-2">
    <span className="text-[11px] font-medium text-[rgba(218,220,224,0.9)] tracking-[0.1px] normal-case">
      {children}
    </span>
  </div>
);

export const PillButton: React.FC<{
  icon?: React.ReactNode;
  children: React.ReactNode;
  variant?: 'filled' | 'outline' | 'solid' | 'danger';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}> = ({ icon, children, variant = 'filled', onClick, disabled, className = '' }) => {
  const base = 'flex items-center gap-[2px] justify-center h-[34px] rounded-xl font-medium tracking-[0.1px] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  const variants: Record<string, string> = {
    filled: 'bg-[#969696] hover:bg-[#a6a6a6] active:bg-[#868686] text-black text-[11px] pl-[8px] pr-[24px] py-1 select-none',
    outline: 'border border-[#595959] hover:bg-white/5 active:bg-white/10 backdrop-blur-[40px] text-[12px] pl-[8px] pr-[16px] py-2 text-white select-none',
    solid: 'bg-white hover:bg-gray-200 active:bg-gray-300 text-black text-[12px] pl-[8px] pr-[16px] py-2 select-none',
    danger: 'bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 text-red-400 text-[12px] pl-[8px] pr-[16px] py-2 select-none',
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} onClick={onClick} disabled={disabled}>
      {icon && <span className="flex items-center justify-center w-6 h-6">{icon}</span>}
      <span>{children}</span>
    </button>
  );
};

export const FieldDropdown: React.FC<{
  label: string; value: string; options: string[];
  onChange: (val: string) => void; className?: string;
}> = ({ label, value, options, onChange, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setIsOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left border border-[#595959] hover:border-[#7a7a7a] transition-colors rounded-xl flex flex-col gap-0.5 justify-center pb-2 pl-2.5 pr-1 pt-[5px] select-none focus:outline-none h-[49px]">
        <p className="text-[11px] font-medium text-[rgba(255,255,255,0.35)] tracking-[0.1px]">{label}</p>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-white tracking-[0.1px] truncate pr-2">{value}</span>
          <span className={`material-symbols-outlined text-[16px] text-[rgba(218,220,224,0.5)] mr-1 transition-transform ${isOpen ? 'rotate-180' : ''}`}>keyboard_arrow_down</span>
        </div>
      </button>
      {isOpen && (
        <div className="absolute z-50 top-[calc(100%+4px)] left-0 w-full bg-[#0e0e0e] border border-[#595959] rounded-xl overflow-hidden shadow-xl backdrop-blur-md animate-dropdown origin-top max-h-60 overflow-y-auto">
          {options.map((opt) => (
            <button key={opt} type="button"
              className={`w-full text-left px-2.5 py-2 text-[11px] font-medium tracking-[0.1px] hover:bg-[#1a1a1a] transition-colors ${value === opt ? 'bg-[#1a1a1a] text-white' : 'text-[rgba(218,220,224,0.9)]'}`}
              onClick={() => { onChange(opt); setIsOpen(false); }}>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const DragNumberField: React.FC<{
  label: string; value: number; min?: number; max?: number;
  step?: number; suffix?: string; onChange: (val: number) => void; className?: string;
}> = ({ label, value, min = 0, max = 999, step = 1, suffix = 'px', onChange, className = '' }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ startY: number; startVal: number; moved: boolean } | null>(null);
  // Hold the active drag listeners so they can be torn down on unmount mid-drag
  // (otherwise mousemove/mouseup leak onto document and the cursor stays ns-resize).
  const dragListenersRef = useRef<{ move: ((e: MouseEvent) => void) | null; up: ((e: MouseEvent) => void) | null }>({ move: null, up: null });

  useEffect(() => {
    return () => {
      if (dragListenersRef.current.move) document.removeEventListener('mousemove', dragListenersRef.current.move);
      if (dragListenersRef.current.up) document.removeEventListener('mouseup', dragListenersRef.current.up);
      document.body.style.cursor = '';
    };
  }, []);

  const commitEdit = (raw: string) => {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) onChange(Math.min(max, Math.max(min, Math.round(parsed / step) * step)));
    setIsEditing(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isEditing) return;
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startVal: value, moved: false };
    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      if (Math.abs(ev.clientY - dragRef.current.startY) > 3) dragRef.current.moved = true;
      if (dragRef.current.moved) {
        const delta = dragRef.current.startY - ev.clientY;
        const newVal = Math.round((dragRef.current.startVal + delta * step) / step) * step;
        onChange(Math.min(max, Math.max(min, newVal)));
        document.body.style.cursor = 'ns-resize';
      }
    };
    const handleMouseUp = () => {
      const wasDrag = dragRef.current?.moved;
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      dragListenersRef.current = { move: null, up: null };
      document.body.style.cursor = '';
      if (!wasDrag) {
        setEditValue(String(value));
        setIsEditing(true);
        setTimeout(() => inputRef.current?.select(), 0);
      }
    };
    dragListenersRef.current = { move: handleMouseMove, up: handleMouseUp };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className={`border border-[#595959] hover:border-[#7a7a7a] rounded-xl flex flex-col gap-0.5 justify-center pb-2 pl-2.5 pr-1 pt-[5px] select-none transition-colors h-[49px] ${isEditing ? '' : 'cursor-ns-resize'} ${className}`}
      onMouseDown={handleMouseDown}>
      <p className="text-[11px] font-medium text-[rgba(255,255,255,0.35)] tracking-[0.1px]">{label}</p>
      <div className="flex items-center justify-between">
        {isEditing ? (
          <input ref={inputRef} type="text" value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(editValue); if (e.key === 'Escape') setIsEditing(false); }}
            onBlur={() => commitEdit(editValue)}
            className="bg-transparent text-[11px] font-medium text-white tracking-[0.1px] outline-none w-full border-none p-0 m-0" autoFocus />
        ) : (
          <>
            <span className="text-[11px] font-medium text-white tracking-[0.1px] cursor-text">{value}{suffix}</span>
            <div className="flex flex-col items-center mr-1.5 -gap-px text-white/40">
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M5 0L9 5H1L5 0Z" fill="currentColor"/></svg>
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M5 6L1 1H9L5 6Z" fill="currentColor"/></svg>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const RangeSlider: React.FC<{
  label: string; value: number; min: number; max: number;
  step?: number; formatValue?: (val: number) => string;
  onChange: (val: number) => void;
}> = ({ label, value, min, max, step = 1, formatValue = (v) => String(v), onChange }) => (
  <div className="flex flex-col gap-2 pt-2 pb-[5px] w-full">
    <div className="flex items-center justify-between px-2 select-none">
      <span className="text-[11px] font-medium text-[rgba(218,220,224,0.9)] tracking-[0.1px]">{label}</span>
      <span className="text-[11px] font-medium text-[#c7c9cd] tracking-[0.1px]">{formatValue(value)}</span>
    </div>
    <div className="px-2 w-full flex items-center h-2">
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer accent-white" />
    </div>
  </div>
);


// === FILE: components/ImageEditor.tsx ===

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Flow } from 'flow-sdk';
import { PillButton, SectionLabel, DragNumberField, RangeSlider } from './Primitives';

interface EditorProps {
  image: { base64: string; mimeType: string; name: string };
  onClose: () => void;
  onSave: (result: { base64: string; mimeType: string }) => void;
}

// Undo/Redo snapshot: the filter parameters that produce a distinct canvas output.
// Stored as lightweight plain objects (not pixel buffers) so history stays cheap
// and Undo/Redo just restores the values, which re-render via applyFilters.
type FilterSnapshot = {
  brightness: number;
  contrast: number;
  blur: number;
  sharpen: number;
  grayscale: boolean;
  invert: boolean;
  edgeDetect: boolean;
  width: number;
  height: number;
};

// Module-level OpenCV loader: dedupes across editor mounts (so re-opening the editor
// does not inject a second <script> tag) and surfaces CDN/runtime errors instead of
// leaving cvReady false forever with the spinner stuck on "Loading".
let cvReadyPromise: Promise<void> | null = null;
function loadOpenCV(): Promise<void> {
  if ((window as any).cv?.Mat) return Promise.resolve();
  if (!cvReadyPromise) {
    cvReadyPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js/dist/opencv.js';
      script.async = true;
      script.onload = () => {
        const cv = (window as any).cv;
        if (cv.onRuntimeInitialized) cv.onRuntimeInitialized = () => resolve();
        else if (cv.Mat) resolve();
        else reject(new Error('OpenCV runtime did not initialize'));
      };
      script.onerror = () => {
        cvReadyPromise = null; // allow a later retry
        reject(new Error('Failed to load OpenCV.js from CDN'));
      };
      document.body.appendChild(script);
    });
  }
  return cvReadyPromise;
}

export const ImageEditor: React.FC<EditorProps> = ({ image, onClose, onSave }) => {
  const [cvReady, setCvReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cvError, setCvError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);

  // Adjustments
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [blur, setBlur] = useState(0);
  const [sharpen, setSharpen] = useState(0);
  const [grayscale, setGrayscale] = useState(false);
  const [invert, setInvert] = useState(false);
  const [edgeDetect, setEdgeDetect] = useState(false);

  // Size
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(1);
  const [lockAR, setLockAR] = useState(true);

  // History for Undo/Redo — refs mirror state so handlers read fresh values
  // without stale closures; the state copies drive button disabled flags.
  const [history, setHistory] = useState<FilterSnapshot[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const historyRef = useRef<FilterSnapshot[]>([]);
  const historyIdxRef = useRef(-1);
  const skipSnapshotRef = useRef(false);

  const setHist = (h: FilterSnapshot[]) => {
    historyRef.current = h;
    setHistory(h);
  };
  const setIdx = (v: number) => {
    historyIdxRef.current = v;
    setHistoryIdx(v);
  };

  const snapshot = (): FilterSnapshot => ({
    brightness,
    contrast,
    blur,
    sharpen,
    grayscale,
    invert,
    edgeDetect,
    width,
    height,
  });

  const restoreSnapshot = (s: FilterSnapshot) => {
    skipSnapshotRef.current = true;
    setBrightness(s.brightness);
    setContrast(s.contrast);
    setBlur(s.blur);
    setSharpen(s.sharpen);
    setGrayscale(s.grayscale);
    setInvert(s.invert);
    setEdgeDetect(s.edgeDetect);
    setWidth(s.width);
    setHeight(s.height);
  };

  const undo = () => {
    if (historyIdxRef.current <= 0) return;
    restoreSnapshot(historyRef.current[historyIdxRef.current - 1]);
    setIdx(historyIdxRef.current - 1);
  };
  const redo = () => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    restoreSnapshot(historyRef.current[historyIdxRef.current + 1]);
    setIdx(historyIdxRef.current + 1);
  };

  useEffect(() => {
    let cancelled = false;
    loadOpenCV()
      .then(() => { if (!cancelled) setCvReady(true); })
      .catch((err) => { if (!cancelled) setCvError(err.message || 'OpenCV failed to load'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      sourceImageRef.current = img;
      setWidth(img.width);
      setHeight(img.height);
      setAspectRatio(img.width / img.height);
      setLoading(false);
    };
    // A corrupt/unsupported image would otherwise leave the editor stuck on the
    // "Loading Editor..." spinner forever (onload was the only path that cleared it).
    img.onerror = () => {
      if (cancelled) return;
      setLoadError('Failed to decode the image. It may be corrupt or an unsupported format.');
      setLoading(false);
    };
    img.src = `data:${image.mimeType || 'image/jpeg'};base64,${image.base64}`;
    // If the editor closes mid-load, do not setState on an unmounted component.
    return () => { cancelled = true; };
  }, [image]);

  const applyFilters = useCallback(() => {
    if (!sourceImageRef.current || !canvasRef.current || !cvReady) return;

    const cv = (window as any).cv;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Resize the source into the working canvas. imageSmoothingQuality='high'
    //    uses the browser's best interpolation for the interactive preview; for
    //    full Lanczos at export the app already has services/image.ts (Pica).
    canvas.width = width || sourceImageRef.current.width;
    canvas.height = height || sourceImageRef.current.height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceImageRef.current, 0, 0, canvas.width, canvas.height);

    // 2. OpenCV processing. Every Mat is declared up front and freed in finally,
    //    so an exception mid-pipeline no longer leaks WASM heap memory.
    let src: any = null;
    let dst: any = null;
    let edges: any = null;
    let blurred: any = null;
    try {
      src = cv.imread(canvas);
      dst = new cv.Mat();

      // Brightness & Contrast: new_img = alpha*img + beta
      const alpha = (contrast + 100) / 100;
      src.convertTo(dst, -1, alpha, brightness);

      if (grayscale) {
        cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY);
        cv.cvtColor(dst, dst, cv.COLOR_GRAY2RGBA);
      }
      if (invert) {
        cv.bitwise_not(dst, dst);
      }
      if (edgeDetect) {
        edges = new cv.Mat();
        cv.cvtColor(dst, edges, cv.COLOR_RGBA2GRAY);
        cv.Canny(edges, edges, 50, 150);
        cv.cvtColor(edges, dst, cv.COLOR_GRAY2RGBA);
      }
      if (blur > 0) {
        const ksize = Math.floor(blur) * 2 + 1;
        cv.GaussianBlur(dst, dst, new cv.Size(ksize, ksize), 0, 0, cv.BORDER_DEFAULT);
      }
      if (sharpen > 0) {
        blurred = new cv.Mat();
        const ksize = 5;
        cv.GaussianBlur(dst, blurred, new cv.Size(ksize, ksize), 0, 0, cv.BORDER_DEFAULT);
        cv.addWeighted(dst, 1 + sharpen / 50, blurred, -sharpen / 50, 0, dst);
      }

      cv.imshow(canvas, dst);
    } catch (e) {
      console.error("OpenCV error", e);
    } finally {
      if (src) src.delete();
      if (dst) dst.delete();
      if (edges) edges.delete();
      if (blurred) blurred.delete();
    }
  }, [cvReady, width, height, brightness, contrast, grayscale, invert, edgeDetect, blur, sharpen]);

  useEffect(() => {
    if (cvReady && sourceImageRef.current) applyFilters();
  }, [applyFilters, cvReady]);

  // Debounced snapshot of the current filter state for Undo/Redo. Skipped while
  // restoring a snapshot so undo/redo themselves are not recorded as new states.
  useEffect(() => {
    if (!cvReady || loading) return;
    if (skipSnapshotRef.current) {
      skipSnapshotRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      const snap = {
        brightness, contrast, blur, sharpen, grayscale, invert, edgeDetect, width, height,
      };
      const truncated = historyRef.current.slice(0, historyIdxRef.current + 1);
      const last = truncated[truncated.length - 1];
      if (last && JSON.stringify(last) === JSON.stringify(snap)) return;
      const next = [...truncated, snap].slice(-20); // cap history at 20 entries
      setHist(next);
      setIdx(next.length - 1);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvReady, loading, brightness, contrast, blur, sharpen, grayscale, invert, edgeDetect, width, height]);

  const handleWidthChange = (val: number) => {
    setWidth(val);
    if (lockAR) setHeight(Math.round(val / aspectRatio));
  };

  const handleHeightChange = (val: number) => {
    setHeight(val);
    if (lockAR) setWidth(Math.round(val * aspectRatio));
  };

  // Presets set exact dimensions directly. Going through handleWidthChange would
  // re-derive the other axis from aspectRatio while lockAR is still true in the
  // closure (setLockAR(false) is batched), so a 1:1 image clicked "1080p" would
  // end up 1080x1080 instead of 1920x1080.
  const applyPreset = (w: number, h: number) => {
    setLockAR(false);
    setWidth(w);
    setHeight(h);
  };

  const handleExport = async (mode: 'save' | 'download') => {
    if (!canvasRef.current) return;
    // Keep the source format so PNG transparency is preserved instead of being
    // flattened to lossy JPEG.
    const exportMime = image.mimeType || 'image/jpeg';
    const dataUrl = canvasRef.current.toDataURL(exportMime, 0.92);
    const base64 = dataUrl.split(',')[1];
    const ext = exportMime.split('/')[1] || 'jpg';
    const baseName = image.name.replace(/\.[^/.]+$/, "");

    if (mode === 'save') {
      onSave({ base64, mimeType: exportMime });
    } else {
      // Flow.download is awaited in an async onClick with no surrounding try/catch —
      // a failure would become an unhandled rejection. Guard it so the user sees the
      // error instead of a silent no-op.
      try {
        await Flow.download({
          base64,
          mimeType: exportMime,
          filename: `edited_${baseName}.${ext}`
        });
      } catch (err) {
        console.error(err);
        alert('Failed to download the edited image.');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 lg:p-8">
      <div className="bg-[#0e0e0e] border border-[#595959] rounded-2xl w-full h-full flex flex-col lg:flex-row overflow-hidden shadow-2xl">

        {/* Preview Area */}
        <div className="flex-1 relative flex items-center justify-center p-4 bg-[#1a1a1a] overflow-hidden">
          {loadError ? (
            <div className="flex flex-col items-center gap-4 max-w-md text-center">
              <span className="material-symbols-outlined text-4xl text-red-400">error</span>
              <span className="text-white/60 text-sm">{loadError}</span>
              <PillButton variant="outline" onClick={onClose}>Close</PillButton>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center gap-4">
              <span className="material-symbols-outlined text-4xl animate-spin text-white/20">progress_activity</span>
              <span className="text-white/40 text-sm">Loading Editor...</span>
            </div>
          ) : cvError ? (
            <div className="flex flex-col items-center gap-4 max-w-md text-center">
              <span className="material-symbols-outlined text-4xl text-red-400">error</span>
              <span className="text-white/60 text-sm">{cvError}</span>
              <PillButton variant="outline" onClick={onClose}>Close</PillButton>
            </div>
          ) : (
            <div className="max-w-full max-h-full overflow-auto dark-scrollbar flex items-center justify-center">
              <canvas ref={canvasRef} className="shadow-2xl border border-white/10" style={{ maxWidth: '100%', maxHeight: '100%', height: 'auto' }} />
            </div>
          )}

          {/* Top Bar inside Preview */}
          <div className="absolute top-4 left-4 right-4 flex justify-between items-center pointer-events-none">
             <div className="flex gap-2 pointer-events-auto">
                <PillButton variant="outline" icon={<span className="material-symbols-outlined text-[18px]">undo</span>} onClick={undo} disabled={historyIdx <= 0}>Undo</PillButton>
                <PillButton variant="outline" icon={<span className="material-symbols-outlined text-[18px]">redo</span>} onClick={redo} disabled={historyIdx >= history.length - 1}>Redo</PillButton>
             </div>
             <button onClick={onClose} className="pointer-events-auto w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-colors">
                <span className="material-symbols-outlined">close</span>
             </button>
          </div>
        </div>

        {/* Controls Panel */}
        <div className="w-full lg:w-[320px] h-full border-l border-[#595959] flex flex-col bg-[#0e0e0e]">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6 dark-scrollbar">

            {/* Dimensions */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                 <SectionLabel>Dimensions</SectionLabel>
                 <button onClick={() => setLockAR(!lockAR)} className={`text-[18px] material-symbols-outlined ${lockAR ? 'text-white' : 'text-white/20'}`}>
                   {lockAR ? 'link' : 'link_off'}
                 </button>
              </div>
              <div className="flex gap-2">
                <DragNumberField label="Width" value={width} onChange={handleWidthChange} className="flex-1" />
                <DragNumberField label="Height" value={height} onChange={handleHeightChange} className="flex-1" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <PillButton variant="outline" onClick={() => applyPreset(1920, 1080)}>1080p</PillButton>
                <PillButton variant="outline" onClick={() => applyPreset(2560, 1440)}>2K</PillButton>
                <PillButton variant="outline" onClick={() => applyPreset(3840, 2160)}>4K</PillButton>
                <PillButton variant="outline" onClick={() => { setLockAR(false); setWidth(sourceImageRef.current?.width || 0); setHeight(sourceImageRef.current?.height || 0); }}>Original</PillButton>
              </div>
            </div>

            {/* Adjustments */}
            <div className="flex flex-col gap-2">
              <SectionLabel>Adjustments</SectionLabel>
              <RangeSlider label="Brightness" value={brightness} min={-100} max={100} onChange={setBrightness} />
              <RangeSlider label="Contrast" value={contrast} min={-100} max={100} onChange={setContrast} />
              <RangeSlider label="Blur" value={blur} min={0} max={20} step={0.5} onChange={setBlur} />
              <RangeSlider label="Sharpen" value={sharpen} min={0} max={100} onChange={setSharpen} />
            </div>

            {/* Effects */}
            <div className="flex flex-col gap-2">
              <SectionLabel>Filters</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <PillButton variant={grayscale ? 'filled' : 'outline'} onClick={() => setGrayscale(!grayscale)}>Grayscale</PillButton>
                <PillButton variant={invert ? 'filled' : 'outline'} onClick={() => setInvert(!invert)}>Invert</PillButton>
                <PillButton variant={edgeDetect ? 'filled' : 'outline'} onClick={() => setEdgeDetect(!edgeDetect)}>Edges</PillButton>
                <PillButton variant="outline" onClick={() => {
                  setBrightness(0); setContrast(0); setBlur(0); setSharpen(0);
                  setGrayscale(false); setInvert(false); setEdgeDetect(false);
                }}>Reset</PillButton>
              </div>
            </div>

          </div>

          {/* Action Footer */}
          <div className="p-4 border-t border-[#595959] flex flex-col gap-2">
             <PillButton variant="outline" icon={<span className="material-symbols-outlined text-[18px]">download</span>} onClick={() => handleExport('download')}>
               Download
             </PillButton>
             <PillButton variant="solid" icon={<span className="material-symbols-outlined text-[18px]">save</span>} onClick={() => handleExport('save')}>
               Save to Gallery
             </PillButton>
          </div>
        </div>
      </div>
    </div>
  );
};


// === FILE: App.tsx ===

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Flow } from 'flow-sdk';
import JSZip from 'jszip';
import { Scene, BatchSettings, BatchState, AspectRatio, DownloadProgress } from './types';
import { parseScenes, detectSeparator } from './services/parser';
import { upscaleImage } from './services/image';
import { SectionLabel, PillButton, FieldDropdown, DragNumberField } from './components/Primitives';
import { ImageEditor } from './components/ImageEditor';

const MODELS = ['🍌 Nano Banana Pro', '🍌 Nano Banana 2'];
const RATIOS: AspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const RESOLUTIONS = ['Full HD', '2K', '4K'] as const;

// Guard against a hung generation/upscale call. The Flow SDK and Pica have no
// per-request timeout, so without this a stalled request would block the batch
// loop and Stop could not interrupt the in-flight await; the scene would stay
// "generating"/"upscaling" forever.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Image generation timed out')), ms)
    ),
  ]);
}

export default function App() {
  const [inputText, setInputText] = useState('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeTab, setActiveTab] = useState<'input' | 'batch' | 'gallery'>('input');

  // Settings
  const [settings, setSettings] = useState<BatchSettings>({
    modelDisplayName: '🍌 Nano Banana Pro',
    aspectRatio: '16:9',
    resolution: 'Full HD',
    delaySeconds: 1,
  });

  // Batch Control
  const [batch, setBatch] = useState<BatchState>({
    isRunning: false,
    isPaused: false,
    currentIndex: -1,
    total: 0,
    successCount: 0,
    failedCount: 0,
  });

  // Download State
  const [dlProgress, setDlProgress] = useState<DownloadProgress>({
    isProcessing: false,
    percent: 0,
    message: '',
  });

  // UI State
  const [editingImage, setEditingImage] = useState<null | { sceneId: string; base64: string; mimeType: string; name: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const stopBatchRef = useRef(false);
  const pauseBatchRef = useRef(false);
  // Synchronous re-entry guard for startBatch: batch.isRunning is async state, so a
  // rapid double-click on Start/Launch/Retry before re-render would spawn two loops
  // racing on the same scenes. The ref flips synchronously and is reset when the
  // loop ends (normal completion, early empty return, or Stop).
  const runningRef = useRef(false);

  // detectSeparator runs five regexes over the whole input; memoize so a per-keystroke
  // re-render (e.g. editing a scene title) does not re-run it on every paint.
  const sepName = useMemo(() => detectSeparator(inputText).name, [inputText]);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .animate-dropdown { animation: dropdown-enter 0.15s ease-out forwards; }
      @keyframes dropdown-enter { from { opacity: 0; transform: scale(0.95) translateY(-5px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      .dark-scrollbar { scrollbar-width: thin; scrollbar-color: #595959 transparent; }
      .dark-scrollbar::-webkit-scrollbar { width: 6px; }
      .dark-scrollbar::-webkit-scrollbar-thumb { background: #595959; border-radius: 10px; }
      @keyframes pulse-white { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      .animate-pulse-white { animation: pulse-white 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
    `;
    document.head.appendChild(style);
  }, []);

  const handleParse = () => {
    if (!inputText.trim()) return;
    // Re-parsing replaces the scenes array and would discard any already-generated
    // images. Confirm before destroying results so a stray edit does not lose a long run.
    if (scenes.some(s => s.result) && !window.confirm('Re-parsing will discard generated images. Continue?')) {
      return;
    }
    const parsed = parseScenes(inputText, settings.aspectRatio);
    setScenes(parsed);
    setError(null);
  };

  const updateScene = (id: string, updates: Partial<Scene>) => {
    setScenes(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const startBatch = async (resumeOnlyFailed = false) => {
    // Re-entry guard: a second click before React re-renders would start a parallel
    // loop over the same scenes. The ref flips synchronously here.
    if (runningRef.current) return;
    runningRef.current = true;
    stopBatchRef.current = false;
    pauseBatchRef.current = false;
    setActiveTab('batch');

    const targetScenes = resumeOnlyFailed
      ? scenes.filter(s => s.status === 'error' || s.status === 'pending')
      : scenes;

    // Nothing to run (e.g. Retry Failed with no failures, or Start with empty list):
    // bail out and release the guard so the user is not stuck with Start hidden.
    if (targetScenes.length === 0) {
      runningRef.current = false;
      return;
    }

    setBatch(prev => ({
      ...prev,
      isRunning: true,
      isPaused: false,
      total: targetScenes.length,
      currentIndex: 0,
      successCount: resumeOnlyFailed ? prev.successCount : 0,
      failedCount: 0
    }));

    for (let i = 0; i < targetScenes.length; i++) {
      if (stopBatchRef.current) break;
      while (pauseBatchRef.current && !stopBatchRef.current) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (stopBatchRef.current) break;

      const scene = targetScenes[i];
      setBatch(prev => ({ ...prev, currentIndex: i + 1 }));
      updateScene(scene.id, { status: 'generating', errorMessage: undefined });

      try {
        // 1. Generation — fold the negative prompt into the prompt text, since the
        //    Flow image SDK exposes no separate negativePrompt field. Wrapped in
        //    withTimeout so a stalled request fails (and becomes retryable) instead
        //    of hanging the whole batch.
        const fullPrompt = scene.negativePrompt
          ? `${scene.prompt}\n\nAvoid: ${scene.negativePrompt}`
          : scene.prompt;
        const result = await withTimeout(
          Flow.generate.image({
            prompt: fullPrompt,
            aspectRatio: scene.aspectRatio,
            modelDisplayName: settings.modelDisplayName
          }),
          180000
        );

        // 2. High-Quality Lanczos Upscaling — also guarded by a timeout so a hung Pica
        //    resize (WASM/memory pressure at 4K) cannot block the batch loop and Stop.
        updateScene(scene.id, { status: 'upscaling' });
        const upscaled = await withTimeout(
          upscaleImage(result.base64, result.mimeType, settings.resolution),
          180000
        );

        updateScene(scene.id, {
          status: 'success',
          result: { base64: upscaled.base64, mimeType: result.mimeType || 'image/jpeg', mediaId: result.mediaId }
        });
        setBatch(prev => ({ ...prev, successCount: prev.successCount + 1 }));
      } catch (err: any) {
        updateScene(scene.id, { status: 'error', errorMessage: err.message });
        setBatch(prev => ({ ...prev, failedCount: prev.failedCount + 1 }));
      }

      if (i < targetScenes.length - 1 && settings.delaySeconds > 0) {
        await new Promise(r => setTimeout(r, settings.delaySeconds * 1000));
      }
    }

    setBatch(prev => ({ ...prev, isRunning: false }));
    runningRef.current = false;
  };

  const handleDownloadAll = async () => {
    setDlProgress({ isProcessing: true, percent: 0, message: 'Preparing assets...' });

    const zip = new JSZip();
    const readyScenes = scenes.filter(s => s.result);

    if (readyScenes.length === 0) {
      setDlProgress({ isProcessing: false, percent: 0, message: '' });
      return;
    }
    // Building a single ZIP in memory with many 4K images can OOM the Flow tab.
    // Warn past 50 so the user can opt out and download in smaller batches instead.
    if (readyScenes.length > 50 && !window.confirm(
      `Building a ZIP with ${readyScenes.length} images at once may run out of memory. Continue?`
    )) {
      setDlProgress({ isProcessing: false, percent: 0, message: '' });
      return;
    }

    readyScenes.forEach((s, i) => {
      const mime = s.result!.mimeType || 'image/jpeg';
      const ext = mime.split('/')[1] || 'jpg';
      const safeTitle = s.title.replace(/[^a-z0-9]/gi, '_');
      zip.file(`${safeTitle}_${i + 1}.${ext}`, s.result!.base64, { base64: true });
    });

    try {
      const content = await zip.generateAsync(
        { type: 'blob' },
        (metadata) => {
          setDlProgress({
            isProcessing: true,
            percent: metadata.percent,
            message: `Compressing images... ${Math.round(metadata.percent)}%`
          });
        }
      );

      setDlProgress(prev => ({ ...prev, message: 'Starting download...' }));

      const reader = new FileReader();
      reader.onload = async () => {
        // Flow.download runs in this async onload callback, outside the surrounding
        // try/catch, so it needs its own guard — otherwise a download failure leaves
        // the progress bar stuck on "Processing..." forever.
        try {
          const base64 = (reader.result as string).split(',')[1];
          await Flow.download({
            base64,
            mimeType: 'application/zip',
            filename: `batch_upscaled_${settings.resolution.replace(' ', '_')}.zip`
          });
        } catch (err) {
          console.error(err);
          setError('Failed to download ZIP file.');
        } finally {
          setDlProgress({ isProcessing: false, percent: 0, message: '' });
        }
      };
      // If readAsDataURL itself fails (blob too large / unreadable), reset the
      // progress UI instead of leaving the Download button stuck on "Processing...".
      reader.onerror = () => {
        console.error('FileReader error', reader.error);
        setError('Failed to read the ZIP for download.');
        setDlProgress({ isProcessing: false, percent: 0, message: '' });
      };
      reader.readAsDataURL(content);
    } catch (err) {
      console.error(err);
      setError('Failed to create ZIP file.');
      setDlProgress({ isProcessing: false, percent: 0, message: '' });
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#0e0e0e] text-white font-sans overflow-hidden">

      {/* Left Navigation */}
      <div className="w-[60px] border-r border-[#595959] flex flex-col items-center py-6 gap-6">
        <button onClick={() => setActiveTab('input')} className={`p-2 rounded-xl transition-colors ${activeTab === 'input' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}>
          <span className="material-symbols-outlined">edit_note</span>
        </button>
        <button onClick={() => setActiveTab('batch')} className={`p-2 rounded-xl transition-colors ${activeTab === 'batch' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}>
          <span className="material-symbols-outlined">play_circle</span>
        </button>
        <button onClick={() => setActiveTab('gallery')} className={`p-2 rounded-xl transition-colors ${activeTab === 'gallery' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}>
          <span className="material-symbols-outlined">photo_library</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Tab Header */}
        <div className="h-[60px] border-b border-[#595959] flex items-center px-6 justify-between">
           <h1 className="text-sm font-medium tracking-wide uppercase opacity-60">
             {activeTab === 'input' ? 'Prompt Editor' : activeTab === 'batch' ? 'Batch Processing' : 'Results Gallery'}
           </h1>
           {activeTab === 'gallery' && scenes.some(s => s.result) && (
             <div className="flex items-center gap-4">
                {dlProgress.isProcessing && (
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] text-white/40 font-medium animate-pulse-white">{dlProgress.message}</span>
                    <div className="w-32 h-1 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-white transition-all duration-300" style={{ width: `${dlProgress.percent}%` }} />
                    </div>
                  </div>
                )}
                <PillButton
                  variant="solid"
                  disabled={dlProgress.isProcessing}
                  icon={<span className="material-symbols-outlined">zip_box</span>}
                  onClick={handleDownloadAll}
                >
                  {dlProgress.isProcessing ? 'Processing...' : 'Download All (ZIP)'}
                </PillButton>
             </div>
           )}
        </div>

        <div className="flex-1 overflow-y-auto dark-scrollbar p-6">

          {/* View: Input */}
          {activeTab === 'input' && (
            <div className="max-w-4xl mx-auto flex flex-col gap-8">
               <div className="flex flex-col gap-4">
                  <SectionLabel>Scene List / Script</SectionLabel>
                  <div className="relative group">
                    <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Paste your scenes here..."
                      className="w-full h-[300px] bg-[#1a1a1a] border border-[#595959] rounded-2xl p-4 text-sm font-mono leading-relaxed focus:outline-none focus:border-[#969696] transition-colors resize-none placeholder:opacity-30"
                    />
                    <div className="absolute top-4 right-4 flex gap-2">
                       <input
                         type="file"
                         id="file-upload"
                         className="hidden"
                         accept=".txt,.md"
                         onChange={async (e) => {
                           const file = e.target.files?.[0];
                           if (!file) return;
                           try {
                             setInputText(await file.text());
                           } catch (err) {
                             console.error(err);
                             setError('Failed to read the selected file. Use a plain .txt or .md file.');
                           }
                           // Reset so selecting the same file again re-fires onChange.
                           e.target.value = '';
                         }}
                       />
                       <label htmlFor="file-upload" className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs hover:bg-white/10 cursor-pointer transition-colors">
                          <span className="material-symbols-outlined text-sm">upload_file</span>
                          Import File
                       </label>
                    </div>
                  </div>
                  <PillButton variant="filled" className="w-full h-12 rounded-2xl" icon={<span className="material-symbols-outlined">splitscreen</span>} onClick={handleParse}>
                    Parse & Preview Scenes
                  </PillButton>
               </div>

               {scenes.length > 0 && (
                 <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex items-center justify-between">
                      <SectionLabel>Detected Scenes ({scenes.length})</SectionLabel>
                      <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded text-white/40 border border-white/10 italic">
                        Using {sepName}
                      </span>
                    </div>
                    <div className="flex flex-col gap-3">
                      {scenes.map((scene, i) => (
                        <div key={scene.id} className="bg-[#1a1a1a] border border-[#595959] rounded-xl p-4 flex flex-col gap-2 group hover:border-[#969696] transition-colors">
                           <div className="flex justify-between items-start">
                             <input
                               value={scene.title}
                               onChange={(e) => updateScene(scene.id, { title: e.target.value })}
                               className="bg-transparent border-none p-0 m-0 font-medium text-xs focus:outline-none w-2/3"
                             />
                             <div className="flex gap-2">
                               <span className="text-[10px] text-white/30 font-mono">#{i+1}</span>
                               <button onClick={() => setScenes(scenes.filter(s => s.id !== scene.id))} className="opacity-0 group-hover:opacity-100 material-symbols-outlined text-sm text-red-400">delete</button>
                             </div>
                           </div>
                           <textarea
                             value={scene.prompt}
                             onChange={(e) => updateScene(scene.id, { prompt: e.target.value })}
                             className="bg-transparent border-none p-0 m-0 text-xs text-white/70 focus:outline-none w-full resize-none h-auto"
                             rows={2}
                           />
                           {scene.negativePrompt && (
                             <input
                               value={scene.negativePrompt}
                               onChange={(e) => updateScene(scene.id, { negativePrompt: e.target.value })}
                               placeholder="Avoid (negative prompt)..."
                               className="bg-white/5 border border-white/10 rounded p-1 text-[10px] text-red-300/80 focus:outline-none w-full"
                             />
                           )}
                           <div className="flex gap-3 pt-2 border-t border-white/5 mt-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-white/30 uppercase tracking-tighter">Aspect</span>
                                <select
                                  value={scene.aspectRatio}
                                  onChange={(e) => updateScene(scene.id, { aspectRatio: e.target.value as AspectRatio })}
                                  className="bg-white/5 text-[10px] border-none rounded p-0.5 focus:outline-none"
                                >
                                  {RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </div>
                           </div>
                        </div>
                      ))}
                    </div>
                 </div>
               )}
            </div>
          )}

          {/* View: Batch Progress */}
          {activeTab === 'batch' && (
            <div className="max-w-4xl mx-auto flex flex-col gap-10">
               <div className="bg-[#1a1a1a] border border-[#595959] rounded-2xl p-8 flex flex-col items-center gap-8 shadow-xl">
                 <div className="flex flex-col items-center gap-2">
                    <span className="text-xs uppercase tracking-widest text-white/30 font-semibold">Current Status</span>
                    <h2 className="text-2xl font-light">
                      {batch.isRunning ? (batch.isPaused ? 'Paused' : 'Generating & Upscaling...') : 'Idle'}
                    </h2>
                 </div>

                 <div className="w-full max-w-md h-2 bg-white/5 rounded-full overflow-hidden border border-white/5 relative">
                    <div
                      className="absolute top-0 left-0 h-full bg-white transition-all duration-500 ease-out shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                      style={{ width: `${batch.total > 0 ? (batch.currentIndex / batch.total) * 100 : 0}%` }}
                    />
                 </div>

                 <div className="grid grid-cols-3 gap-12 text-center w-full max-w-lg">
                    <div className="flex flex-col gap-1">
                      <span className="text-2xl font-light">{batch.total}</span>
                      <span className="text-[10px] uppercase text-white/30 font-bold">Total</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-2xl font-light text-green-400">{batch.successCount}</span>
                      <span className="text-[10px] uppercase text-white/30 font-bold">Success</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-2xl font-light text-red-400">{batch.failedCount}</span>
                      <span className="text-[10px] uppercase text-white/30 font-bold">Failed</span>
                    </div>
                 </div>

                 <div className="flex gap-3">
                   {!batch.isRunning ? (
                     <>
                        <PillButton variant="solid" className="w-40 h-12" icon={<span className="material-symbols-outlined">play_arrow</span>} onClick={() => startBatch()} disabled={scenes.length === 0}>
                          Start Batch
                        </PillButton>
                        {batch.failedCount > 0 && (
                          <PillButton variant="outline" className="w-40 h-12" icon={<span className="material-symbols-outlined">replay</span>} onClick={() => startBatch(true)}>
                            Retry Failed
                          </PillButton>
                        )}
                     </>
                   ) : (
                     <>
                        <PillButton
                          variant="outline"
                          className="w-40 h-12"
                          icon={<span className="material-symbols-outlined">{batch.isPaused ? 'play_arrow' : 'pause'}</span>}
                          onClick={() => {
                            pauseBatchRef.current = !pauseBatchRef.current;
                            setBatch(prev => ({ ...prev, isPaused: !prev.isPaused }));
                          }}
                        >
                          {batch.isPaused ? 'Resume' : 'Pause'}
                        </PillButton>
                        <PillButton variant="danger" className="w-40 h-12" icon={<span className="material-symbols-outlined">stop</span>} onClick={() => stopBatchRef.current = true}>
                          Stop
                        </PillButton>
                     </>
                   )}
                 </div>
               </div>

               <div className="flex flex-col gap-4">
                  <SectionLabel>Live Execution Log</SectionLabel>
                  <div className="flex flex-col gap-2">
                    {scenes.filter(s => s.status !== 'pending').slice(-5).reverse().map(scene => (
                      <div key={scene.id} className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl animate-in fade-in slide-in-from-top-2">
                         <div className="flex items-center gap-3">
                            <span className={`material-symbols-outlined text-sm ${
                              scene.status === 'success' ? 'text-green-400' :
                              scene.status === 'error' ? 'text-red-400' : 'animate-spin text-white/30'
                            }`}>
                              {scene.status === 'success' ? 'check_circle' :
                               scene.status === 'error' ? 'error' : 'progress_activity'}
                            </span>
                            <div className="flex flex-col">
                              <span className="text-xs font-medium truncate max-w-[200px]">{scene.title}</span>
                              <span className={`text-[9px] uppercase truncate max-w-[220px] ${scene.status === 'error' ? 'text-red-400' : 'text-white/40'}`}>
                                {scene.status === 'upscaling' ? 'Applying Lanczos...' : scene.status === 'error' && scene.errorMessage ? scene.errorMessage : scene.status}
                              </span>
                            </div>
                         </div>
                      </div>
                    ))}
                  </div>
               </div>
            </div>
          )}

          {/* View: Gallery */}
          {activeTab === 'gallery' && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
               {scenes.filter(s => s.result).map(scene => (
                 <div key={scene.id} className="flex flex-col bg-[#1a1a1a] border border-[#595959] rounded-2xl overflow-hidden group hover:border-[#969696] transition-all animate-in zoom-in-95">
                    <div className="aspect-video relative overflow-hidden bg-black flex items-center justify-center">
                       <img
                         src={`data:${scene.result!.mimeType || 'image/jpeg'};base64,${scene.result!.base64}`}
                         alt={scene.title}
                         loading="lazy"
                         className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                       />
                       <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <button
                            onClick={() => setEditingImage({
                              sceneId: scene.id,
                              base64: scene.result!.base64,
                              mimeType: scene.result!.mimeType,
                              name: scene.title
                            })}
                            className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-110 transition-transform"
                          >
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                       </div>
                    </div>
                    <div className="p-3 flex flex-col gap-1">
                       <span className="text-[10px] font-medium text-white truncate">{scene.title}</span>
                       <div className="flex justify-between items-center">
                         <span className="text-[8px] text-white/30 uppercase tracking-widest font-mono">
                           {scene.aspectRatio} • {settings.resolution}
                         </span>
                         <button
                           onClick={() => updateScene(scene.id, { result: undefined, status: 'pending' })}
                           className="text-red-400/50 hover:text-red-400"
                         >
                           <span className="material-symbols-outlined text-[16px]">delete</span>
                         </button>
                       </div>
                    </div>
                 </div>
               ))}
            </div>
          )}

        </div>
      </div>

      {/* Right Panel */}
      <div className="w-[300px] border-l border-[#595959] flex flex-col items-start justify-between p-[12px] bg-[#0e0e0e]">
        <div className="flex flex-col gap-[24px] items-start w-full">

          <div className="flex flex-col gap-2 w-full">
            <SectionLabel>Generator Settings</SectionLabel>
            <div className="flex flex-col gap-1.5">
              <FieldDropdown
                label="Model"
                value={settings.modelDisplayName}
                options={MODELS}
                onChange={(v) => setSettings(s => ({ ...s, modelDisplayName: v }))}
              />
              <div className="flex gap-1">
                <FieldDropdown
                  label="Aspect Ratio"
                  value={settings.aspectRatio}
                  options={RATIOS}
                  onChange={(v) => setSettings(s => ({ ...s, aspectRatio: v as AspectRatio }))}
                  className="flex-1"
                />
                <FieldDropdown
                  label="Resolution (Lanczos)"
                  value={settings.resolution}
                  options={Array.from(RESOLUTIONS)}
                  onChange={(v) => setSettings(s => ({ ...s, resolution: v as any }))}
                  className="flex-1"
                />
              </div>
              <DragNumberField
                label="Batch Delay"
                value={settings.delaySeconds}
                min={0} max={60} suffix="s"
                onChange={(v) => setSettings(s => ({ ...s, delaySeconds: v }))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 w-full">
            <SectionLabel>Batch Stats</SectionLabel>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3">
               <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/40">
                  <span>Queue Size</span>
                  <span className="text-white">{scenes.length}</span>
               </div>
               <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/40">
                  <span>Generated</span>
                  <span className="text-white">{scenes.filter(s => s.status === 'success').length}</span>
               </div>
               <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/40 transition-all duration-300"
                    style={{ width: `${scenes.length > 0 ? (scenes.filter(s => s.status === 'success').length / scenes.length) * 100 : 0}%` }}
                  />
               </div>
            </div>
          </div>

        </div>

        <div className="flex flex-col gap-[8px] items-start w-full pt-4 border-t border-white/5">
           <PillButton
             variant="outline"
             className="w-full"
             icon={<span className="material-symbols-outlined text-[18px]">clear_all</span>}
             onClick={() => {
               // Signal a running batch to stop too, otherwise the loop keeps calling
               // Flow.generate on the now-cleared scenes (zombie loop).
               stopBatchRef.current = true;
               pauseBatchRef.current = false;
               setScenes([]);
               setInputText('');
               setBatch(prev => ({ ...prev, isRunning: false, isPaused: false }));
               setActiveTab('input');
             }}
           >
             Clear Session
           </PillButton>
           <PillButton
             variant="solid"
             className="w-full"
             icon={<span className="material-symbols-outlined text-[18px]">play_arrow</span>}
             onClick={() => startBatch()}
             disabled={batch.isRunning || scenes.length === 0}
           >
             Launch Batch
           </PillButton>
        </div>
      </div>

      {editingImage && (
        <ImageEditor
          image={{ base64: editingImage.base64, mimeType: editingImage.mimeType, name: editingImage.name }}
          onClose={() => setEditingImage(null)}
          onSave={(res) => {
            updateScene(editingImage.sceneId, { result: { ...res, mediaId: '' } });
            setEditingImage(null);
          }}
        />
      )}

      {error && (
        <div className="fixed bottom-6 right-6 z-[100] bg-red-500 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-right-4">
           <span className="material-symbols-outlined">error</span>
           <span className="text-sm font-medium">{error}</span>
           <button onClick={() => setError(null)} className="material-symbols-outlined text-lg opacity-60 hover:opacity-100">close</button>
        </div>
      )}
    </div>
  );
}
