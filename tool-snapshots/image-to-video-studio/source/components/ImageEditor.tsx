import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Flow } from 'flow-sdk';
import { PillButton, SectionLabel, DragNumberField, RangeSlider } from './Primitives';

interface EditorProps {
  image: { base64: string; mimeType: string; name: string };
  onClose: () => void;
  onSave: (result: { base64: string; mimeType: string }) => void;
}

export const ImageEditor: React.FC<EditorProps> = ({ image, onClose, onSave }) => {
  const [cvReady, setCvReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  
  // Adjustments
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [hue, setHue] = useState(0);
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

  useEffect(() => {
    if ((window as any).cv?.Mat) {
      setCvReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js/dist/opencv.js';
    script.async = true;
    script.onload = () => {
      const cv = (window as any).cv;
      if (cv.onRuntimeInitialized) cv.onRuntimeInitialized = () => setCvReady(true);
      else if (cv.Mat) setCvReady(true);
    };
    script.onerror = () => setError('Failed to load CV runtime');
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `data:${image.mimeType};base64,${image.base64}`;
    img.onload = () => {
      sourceImageRef.current = img;
      setWidth(img.width);
      setHeight(img.height);
      setAspectRatio(img.width / img.height);
      setLoading(false);
      applyFilters();
    };
    img.onerror = () => setError('Failed to load source image');
  }, [image]);

  const applyFilters = useCallback(() => {
    if (!sourceImageRef.current || !canvasRef.current || !cvReady) return;
    
    const cv = (window as any).cv;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = width || sourceImageRef.current.width;
    canvas.height = height || sourceImageRef.current.height;
    ctx.drawImage(sourceImageRef.current, 0, 0, canvas.width, canvas.height);

    try {
      const src = cv.imread(canvas);
      const dst = new cv.Mat();

      const alpha = (contrast + 100) / 100;
      src.convertTo(dst, -1, alpha, brightness);

      if (grayscale) {
        cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY);
        cv.cvtColor(dst, dst, cv.COLOR_GRAY2RGBA);
      }

      if (invert) cv.bitwise_not(dst, dst);

      if (edgeDetect) {
        const edges = new cv.Mat();
        cv.cvtColor(dst, edges, cv.COLOR_RGBA2GRAY);
        cv.Canny(edges, edges, 50, 150);
        cv.cvtColor(edges, dst, cv.COLOR_GRAY2RGBA);
        edges.delete();
      }

      if (blur > 0) {
        const ksize = Math.floor(blur) * 2 + 1;
        cv.GaussianBlur(dst, dst, new cv.Size(ksize, ksize), 0, 0, cv.BORDER_DEFAULT);
      }

      if (sharpen > 0) {
        const blurred = new cv.Mat();
        const ksize = 5;
        cv.GaussianBlur(dst, blurred, new cv.Size(ksize, ksize), 0, 0, cv.BORDER_DEFAULT);
        cv.addWeighted(dst, 1 + sharpen / 50, blurred, -sharpen / 50, 0, dst);
        blurred.delete();
      }

      cv.imshow(canvas, dst);
      src.delete();
      dst.delete();
    } catch (e) {
      console.error("OpenCV error", e);
    }
  }, [cvReady, width, height, brightness, contrast, grayscale, invert, edgeDetect, blur, sharpen]);

  useEffect(() => {
    if (cvReady && sourceImageRef.current) applyFilters();
  }, [applyFilters, cvReady]);

  const handleWidthChange = (val: number) => {
    setWidth(val);
    if (lockAR) setHeight(Math.round(val / aspectRatio));
  };

  const handleHeightChange = (val: number) => {
    setHeight(val);
    if (lockAR) setWidth(Math.round(val * aspectRatio));
  };

  const handleExport = async (mode: 'save' | 'download') => {
    try {
      if (!canvasRef.current) return;
      const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.9);
      const base64 = dataUrl.split(',')[1];
      
      if (mode === 'save') {
        onSave({ base64, mimeType: 'image/jpeg' });
      } else {
        await Flow.download({
          base64,
          mimeType: 'image/jpeg',
          filename: `edited_${image.name.replace(/\.[^/.]+$/, "")}.jpg`
        });
      }
    } catch (err: any) {
      setError(err.message || 'Export failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 lg:p-8">
      <div className="bg-[#0e0e0e] border border-[#595959] rounded-2xl w-full h-full flex flex-col lg:flex-row overflow-hidden shadow-2xl">
        
        {/* Preview Area */}
        <div className="flex-1 relative flex items-center justify-center p-4 bg-[#1a1a1a] overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <span className="material-symbols-outlined text-4xl animate-spin text-white/20">progress_activity</span>
              <span className="text-white/40 text-sm">Loading Editor...</span>
            </div>
          ) : (
            <div className="max-w-full max-h-full overflow-auto dark-scrollbar flex items-center justify-center">
              <canvas ref={canvasRef} className="shadow-2xl border border-white/10" style={{ maxWidth: '100%', maxHeight: '100%', height: 'auto' }} />
            </div>
          )}

          {error && (
            <div className="absolute bottom-4 left-4 bg-red-600 text-white px-4 py-2 rounded-lg text-xs shadow-lg animate-in fade-in slide-in-from-bottom-2">
              {error}
            </div>
          )}
          
          <div className="absolute top-4 left-4 right-4 flex justify-between items-center pointer-events-none">
             <div className="flex gap-2 pointer-events-auto">
                <PillButton variant="outline" icon={<span className="material-symbols-outlined text-[18px]">undo</span>} onClick={() => {}} disabled>Undo</PillButton>
                <PillButton variant="outline" icon={<span className="material-symbols-outlined text-[18px]">redo</span>} onClick={() => {}} disabled>Redo</PillButton>
             </div>
             <button onClick={onClose} className="pointer-events-auto w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-colors">
                <span className="material-symbols-outlined">close</span>
             </button>
          </div>
        </div>

        {/* Controls Panel */}
        <div className="w-full lg:w-[320px] h-full border-l border-[#595959] flex flex-col bg-[#0e0e0e]">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6 dark-scrollbar">
            
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
            </div>

            <div className="flex flex-col gap-2">
              <SectionLabel>Adjustments</SectionLabel>
              <RangeSlider label="Brightness" value={brightness} min={-100} max={100} onChange={setBrightness} />
              <RangeSlider label="Contrast" value={contrast} min={-100} max={100} onChange={setContrast} />
              <RangeSlider label="Blur" value={blur} min={0} max={20} step={0.5} onChange={setBlur} />
              <RangeSlider label="Sharpen" value={sharpen} min={0} max={100} onChange={setSharpen} />
            </div>

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

          <div className="p-4 border-t border-[#595959] flex flex-col gap-2">
             <PillButton variant="outline" icon={<span className="material-symbols-outlined text-[18px]">download</span>} onClick={() => handleExport('download')}>
               Download JPG
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
