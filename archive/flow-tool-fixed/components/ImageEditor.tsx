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