import React, { useState, useEffect, useRef } from "react";
import { ImageEditState } from "../types";
import { 
  loadImage, 
  resampleLanczos, 
  applyRealESRGANSimulation, 
  applyCanvasAdjustments 
} from "../utils/imageProcessor";
import { 
  Sliders, 
  Sparkles, 
  Maximize2, 
  RotateCw, 
  Undo2, 
  Check, 
  X, 
  Download, 
  RotateCcw,
  Palette,
  Scissors
} from "lucide-react";

interface ImageStudioProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onSave: (newImageUrl: string) => void;
}

export default function ImageStudio({ url, onSave, onClose }: { url: string; onSave: (dataUrl: string) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"upscale" | "adjust" | "filters">("upscale");
  
  const [editState, setEditState] = useState<ImageEditState>({
    width: 1024,
    height: 1024,
    lockAspectRatio: true,
    resamplingAlgorithm: "lanczos",
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hue: 0,
    exposure: 0,
    vignette: 0,
    blur: 0,
    sharpen: 20,
    grayscale: false,
    sepia: false,
    invert: false,
    edgeDetect: false,
    denoise: false,
  });

  const [aspectRatioValue, setAspectRatioValue] = useState(1);

  // History for Undo/Redo
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Load image
  useEffect(() => {
    if (!url) return;
    setLoading(true);
    loadImage(url)
      .then((img) => {
        setOriginalImage(img);
        const ratio = img.width / img.height;
        setAspectRatioValue(ratio);
        
        setEditState((prev) => ({
          ...prev,
          width: img.width,
          height: img.height,
        }));
        
        // Initialize canvas
        setTimeout(() => {
          renderImage(img, img.width, img.height);
        }, 100);
      })
      .catch((err) => {
        console.error("Failed to load image in studio", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [url]);

  const renderImage = (img: HTMLImageElement, w: number, h: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    ctx.drawImage(img, 0, 0, w, h);
    applyCanvasAdjustments(ctx, w, h, editState);
  };

  // Re-render when filters change
  useEffect(() => {
    if (!originalImage) return;
    renderImage(originalImage, editState.width, editState.height);
  }, [
    originalImage,
    editState.brightness,
    editState.contrast,
    editState.saturation,
    editState.hue,
    editState.exposure,
    editState.vignette,
    editState.grayscale,
    editState.sepia,
    editState.invert,
    editState.edgeDetect,
    editState.denoise,
  ]);

  const handleResizeInput = (dimension: "width" | "height", val: number) => {
    if (val <= 0) return;
    setEditState((prev) => {
      let newW = prev.width;
      let newH = prev.height;
      if (dimension === "width") {
        newW = val;
        if (prev.lockAspectRatio) {
          newH = Math.round(val / aspectRatioValue);
        }
      } else {
        newH = val;
        if (prev.lockAspectRatio) {
          newW = Math.round(val * aspectRatioValue);
        }
      }
      return { ...prev, width: newW, height: newH };
    });
  };

  const applyPreset = (preset: "512" | "hd" | "2k" | "4k") => {
    let targetW = 1024;
    switch (preset) {
      case "512":
        targetW = 512;
        break;
      case "hd":
        targetW = 1920;
        break;
      case "2k":
        targetW = 2560;
        break;
      case "4k":
        targetW = 3840;
        break;
    }
    const targetH = Math.round(targetW / aspectRatioValue);
    setEditState((prev) => ({
      ...prev,
      width: targetW,
      height: targetH,
    }));
  };

  // Run the premium upscaling / resampling pipeline (Lanczos-3 / Real-ESRGAN simulation)
  const runUpscaleAndResample = () => {
    if (!canvasRef.current || !originalImage) return;
    setLoading(true);
    
    setTimeout(() => {
      try {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        
        // 1. Draw source at original size to get raw original pixels
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = originalImage.width;
        tempCanvas.height = originalImage.height;
        const tempCtx = tempCanvas.getContext("2d")!;
        tempCtx.drawImage(originalImage, 0, 0);
        const originalData = tempCtx.getImageData(0, 0, originalImage.width, originalImage.height);
        
        let processedData: ImageData;
        
        // 2. Perform Resampling (Lanczos-3 or other algorithms)
        if (editState.resamplingAlgorithm === "lanczos") {
          // Compute high-quality Lanczos resampling
          processedData = resampleLanczos(originalData, editState.width, editState.height);
        } else if (editState.resamplingAlgorithm === "real-esrgan") {
          // Perform Lanczos upscale first, then apply high-frequency ESRGAN details and Bilateral denoise
          const resampled = resampleLanczos(originalData, editState.width, editState.height);
          processedData = applyRealESRGANSimulation(resampled, editState.sharpen, 30);
        } else {
          // Standard bicubic/nearest neighbor simulation via Canvas
          canvas.width = editState.width;
          canvas.height = editState.height;
          if (editState.resamplingAlgorithm === "nearest") {
            ctx.imageSmoothingEnabled = false;
          } else {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
          }
          ctx.drawImage(originalImage, 0, 0, editState.width, editState.height);
          processedData = ctx.getImageData(0, 0, editState.width, editState.height);
        }
        
        // 3. Put pixels back to canvas
        canvas.width = editState.width;
        canvas.height = editState.height;
        ctx.putImageData(processedData, 0, 0);
        
        // 4. Apply extra color/exposure filters on top
        applyCanvasAdjustments(ctx, editState.width, editState.height, editState);
        
        // Push state to history
        const dataUrl = canvas.toDataURL("image/png");
        setHistory((prev) => [...prev.slice(0, historyIndex + 1), dataUrl]);
        setHistoryIndex((prev) => prev + 1);
        
      } catch (err) {
        console.error("Resampling processing error:", err);
        alert("An error occurred during upscaling process.");
      } finally {
        setLoading(false);
      }
    }, 150);
  };

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = `upscaled_image_${editState.width}x${editState.height}.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  };

  const handleSave = () => {
    if (!canvasRef.current) return;
    onSave(canvasRef.current.toDataURL("image/png"));
  };

  const resetAll = () => {
    setEditState((prev) => ({
      ...prev,
      brightness: 100,
      contrast: 100,
      saturation: 100,
      hue: 0,
      exposure: 0,
      vignette: 0,
      blur: 0,
      sharpen: 20,
      grayscale: false,
      sepia: false,
      invert: false,
      edgeDetect: false,
      denoise: false,
    }));
    if (originalImage) {
      setEditState((prev) => ({
        ...prev,
        width: originalImage.width,
        height: originalImage.height,
      }));
      renderImage(originalImage, originalImage.width, originalImage.height);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-brand-bg text-brand-text font-sans overflow-hidden">
      {/* Top indicator bar */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-brand-panel/90 backdrop-blur-md px-4 py-2 border border-brand-border text-xs font-mono text-neutral-400">
        <div className="w-2 h-2 bg-brand-accent animate-pulse"></div>
        IMAGE STUDIO • ADVANCED POST-PROCESSING
      </div>

      {/* Main Workspace (Left Canvas Panel) */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-neutral-900 via-brand-bg to-[#070707] overflow-auto relative">
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 border-4 border-brand-accent/10"></div>
              <div className="absolute inset-0 border-4 border-brand-accent border-t-transparent animate-spin"></div>
            </div>
            <p className="mt-4 text-xs font-medium text-brand-accent font-mono tracking-wider uppercase">
              RUNNING Lanczos-3 / Neural Sharpness UP SAMPLING...
            </p>
          </div>
        )}

        {/* Canvas container with zoom/shadow style */}
        <div className="relative max-w-full max-h-[75vh] flex items-center justify-center shadow-[0_0_50px_rgba(0,0,0,0.9)] border border-brand-border bg-black overflow-hidden">
          <canvas ref={canvasRef} className="max-w-full max-h-[70vh] object-contain" id="studio-canvas" />
        </div>

        {/* Dimensions footer */}
        <div className="mt-6 flex items-center gap-6 bg-brand-panel px-4 py-2 border border-brand-border text-xs font-mono text-neutral-400">
          <div>Original: <span className="text-white font-bold">{originalImage?.width || 0} x {originalImage?.height || 0}</span></div>
          <div className="text-neutral-600">|</div>
          <div>Canvas State: <span className="text-brand-accent font-bold">{editState.width} x {editState.height}</span></div>
          <div className="text-neutral-600">|</div>
          <div>Ratio: <span className="text-white font-bold">{aspectRatioValue.toFixed(2)}</span></div>
        </div>
      </div>

      {/* Right Control Sidebar */}
      <div className="w-96 border-l border-brand-border bg-[#0E0E0E] flex flex-col select-none relative z-10">
        
        {/* Studio Sidebar Header */}
        <div className="p-4 border-b border-brand-border flex items-center justify-between bg-brand-panel/20">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-accent" />
            <h2 className="font-display italic font-black text-base text-neutral-100">Studio Console</h2>
          </div>
          <button 
            onClick={onClose} 
            className="p-1 text-neutral-400 hover:text-white hover:bg-brand-panel transition duration-150 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Studio Navigation Tabs */}
        <div className="flex border-b border-brand-border text-xs">
          <button
            onClick={() => setActiveTab("upscale")}
            className={`flex-1 py-3 text-center border-b-2 font-medium tracking-wide uppercase transition duration-150 cursor-pointer ${
              activeTab === "upscale"
                ? "border-brand-accent text-white bg-brand-panel/30"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Maximize2 className="w-3.5 h-3.5" />
              Upscale (2K/4K)
            </div>
          </button>
          <button
            onClick={() => setActiveTab("adjust")}
            className={`flex-1 py-3 text-center border-b-2 font-medium tracking-wide uppercase transition duration-150 cursor-pointer ${
              activeTab === "adjust"
                ? "border-brand-accent text-white bg-brand-panel/30"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Sliders className="w-3.5 h-3.5" />
              Adjust (Pillow)
            </div>
          </button>
          <button
            onClick={() => setActiveTab("filters")}
            className={`flex-1 py-3 text-center border-b-2 font-medium tracking-wide uppercase transition duration-150 cursor-pointer ${
              activeTab === "filters"
                ? "border-brand-accent text-white bg-brand-panel/30"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Palette className="w-3.5 h-3.5" />
              Filters (IM)
            </div>
          </button>
        </div>

        {/* Controls container */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          
          {/* TAB 1: UPSCALING / RESAMPLING */}
          {activeTab === "upscale" && (
            <div className="space-y-5 animate-fade-in">
              <div className="space-y-2">
                <label className="text-[11px] font-bold tracking-wider text-neutral-400 uppercase font-mono">Resampling Algorithms</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setEditState(prev => ({ ...prev, resamplingAlgorithm: "lanczos" }))}
                    className={`p-2.5 rounded-none border text-left transition duration-150 cursor-pointer ${
                      editState.resamplingAlgorithm === "lanczos"
                        ? "border-brand-accent bg-brand-accent/10 text-white"
                        : "border-brand-border bg-brand-bg text-neutral-400 hover:border-neutral-700"
                    }`}
                  >
                    <div className="font-bold text-xs">Lanczos-3 Filter</div>
                    <div className="text-[10px] text-neutral-500 mt-0.5 font-mono">High precision math resampler</div>
                  </button>
                  <button
                    onClick={() => setEditState(prev => ({ ...prev, resamplingAlgorithm: "real-esrgan" }))}
                    className={`p-2.5 rounded-none border text-left transition duration-150 cursor-pointer ${
                      editState.resamplingAlgorithm === "real-esrgan"
                        ? "border-brand-accent bg-brand-accent/10 text-white"
                        : "border-brand-border bg-brand-bg text-neutral-400 hover:border-neutral-700"
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center gap-1">
                      Real-ESRGAN
                      <span className="bg-brand-accent text-white text-[9px] px-1 rounded-none font-mono font-bold">AI</span>
                    </div>
                    <div className="text-[10px] text-neutral-500 mt-0.5 font-mono">Details and edge sharpness</div>
                  </button>
                  <button
                    onClick={() => setEditState(prev => ({ ...prev, resamplingAlgorithm: "bicubic" }))}
                    className={`p-2.5 rounded-none border text-left transition duration-150 cursor-pointer ${
                      editState.resamplingAlgorithm === "bicubic"
                        ? "border-brand-accent bg-brand-accent/10 text-white"
                        : "border-brand-border bg-brand-bg text-neutral-400 hover:border-neutral-700"
                    }`}
                  >
                    <div className="font-bold text-xs">Bicubic Smooth</div>
                    <div className="text-[10px] text-neutral-500 mt-0.5 font-mono">Standard browser bicubic</div>
                  </button>
                  <button
                    onClick={() => setEditState(prev => ({ ...prev, resamplingAlgorithm: "nearest" }))}
                    className={`p-2.5 rounded-none border text-left transition duration-150 cursor-pointer ${
                      editState.resamplingAlgorithm === "nearest"
                        ? "border-brand-accent bg-brand-accent/10 text-white"
                        : "border-brand-border bg-brand-bg text-neutral-400 hover:border-neutral-700"
                    }`}
                  >
                    <div className="font-bold text-xs">Nearest Neighbor</div>
                    <div className="text-[10px] text-neutral-500 mt-0.5 font-mono">Retro pixel art scaler</div>
                  </button>
                </div>
              </div>

              {/* Resize Resolution Inputs */}
              <div className="space-y-3 bg-brand-panel p-4 border border-brand-border rounded-none">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-neutral-300 font-mono tracking-wider uppercase">DIMENSIONS (px)</span>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-neutral-400 select-none">
                    <input 
                      type="checkbox"
                      checked={editState.lockAspectRatio}
                      onChange={(e) => setEditState(prev => ({ ...prev, lockAspectRatio: e.target.checked }))}
                      className="rounded-none border-brand-border text-brand-accent focus:ring-brand-accent/20"
                    />
                    Lock Ratio
                  </label>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-neutral-500 uppercase font-mono">Width</label>
                    <input
                      type="number"
                      value={editState.width}
                      onChange={(e) => handleResizeInput("width", parseInt(e.target.value) || 0)}
                      className="mt-1 w-full bg-brand-bg border border-brand-border rounded-none px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-brand-accent"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-neutral-500 uppercase font-mono">Height</label>
                    <input
                      type="number"
                      value={editState.height}
                      onChange={(e) => handleResizeInput("height", parseInt(e.target.value) || 0)}
                      className="mt-1 w-full bg-brand-bg border border-brand-border rounded-none px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-brand-accent"
                    />
                  </div>
                </div>

                {/* Preset resolution buttons */}
                <div className="space-y-1.5 mt-2">
                  <label className="text-[10px] text-neutral-500 uppercase font-mono">Quick Upscale Presets</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    <button onClick={() => applyPreset("512")} className="bg-brand-bg hover:bg-neutral-800 border border-brand-border px-2 py-1.5 rounded-none text-[10px] font-mono cursor-pointer transition">512px</button>
                    <button onClick={() => applyPreset("hd")} className="bg-brand-bg hover:bg-neutral-800 border border-brand-border px-2 py-1.5 rounded-none text-[10px] font-mono cursor-pointer transition">Full HD</button>
                    <button onClick={() => applyPreset("2k")} className="bg-brand-bg hover:bg-neutral-800 border border-brand-border px-2 py-1.5 rounded-none text-[10px] font-mono cursor-pointer transition">2K</button>
                    <button onClick={() => applyPreset("4k")} className="bg-brand-bg hover:bg-neutral-800 border border-brand-border px-2 py-1.5 rounded-none text-[10px] font-mono cursor-pointer transition">4K</button>
                  </div>
                </div>
              </div>

              {editState.resamplingAlgorithm === "real-esrgan" && (
                <div className="bg-brand-panel p-4 border border-brand-border space-y-4 animate-fade-in">
                  <h4 className="text-[10px] font-bold text-brand-accent font-mono flex items-center gap-1.5 tracking-wider uppercase">
                    <Sparkles className="w-3.5 h-3.5" />
                    REAL-ESRGAN INTENSITY
                  </h4>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] text-neutral-400 font-mono">
                      <span>Neural Edge Sharpness</span>
                      <span>{editState.sharpen}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={editState.sharpen}
                      onChange={(e) => setEditState(prev => ({ ...prev, sharpen: parseInt(e.target.value) }))}
                      className="w-full h-1 bg-neutral-800 appearance-none cursor-pointer accent-brand-accent"
                    />
                  </div>
                </div>
              )}

              <button
                onClick={runUpscaleAndResample}
                className="w-full bg-brand-accent hover:bg-[#ff621e] text-white font-bold py-3 px-4 rounded-none flex items-center justify-center gap-2 transition duration-150 cursor-pointer uppercase font-mono tracking-wider text-xs"
              >
                <Sparkles className="w-4 h-4" />
                Apply High-Res Upscale
              </button>
            </div>
          )}

          {/* TAB 2: PILLOW ADJUSTMENTS */}
          {activeTab === "adjust" && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center justify-between text-xs text-neutral-400 font-mono border-b border-brand-border pb-2">
                <span>Pillow Image Library</span>
                <span className="text-[10px] bg-brand-bg px-2 py-0.5 border border-brand-border text-neutral-500">PIL equivalent</span>
              </div>

              {/* Exposure */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-300 font-mono">
                  <span>Exposure / Contrast boost</span>
                  <span>{editState.exposure > 0 ? `+${editState.exposure}` : editState.exposure}</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={editState.exposure}
                  onChange={(e) => setEditState(prev => ({ ...prev, exposure: parseInt(e.target.value) }))}
                  className="w-full h-1 bg-neutral-800 appearance-none cursor-pointer accent-brand-accent"
                />
              </div>

              {/* Brightness */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-300 font-mono">
                  <span>Brightness</span>
                  <span>{editState.brightness}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={editState.brightness}
                  onChange={(e) => setEditState(prev => ({ ...prev, brightness: parseInt(e.target.value) }))}
                  className="w-full h-1 bg-neutral-800 appearance-none cursor-pointer accent-brand-accent"
                />
              </div>

              {/* Contrast */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-300 font-mono">
                  <span>Contrast</span>
                  <span>{editState.contrast}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={editState.contrast}
                  onChange={(e) => setEditState(prev => ({ ...prev, contrast: parseInt(e.target.value) }))}
                  className="w-full h-1 bg-neutral-800 appearance-none cursor-pointer accent-brand-accent"
                />
              </div>

              {/* Saturation */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-300 font-mono">
                  <span>Color Saturation</span>
                  <span>{editState.saturation}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={editState.saturation}
                  onChange={(e) => setEditState(prev => ({ ...prev, saturation: parseInt(e.target.value) }))}
                  className="w-full h-1 bg-neutral-800 appearance-none cursor-pointer accent-brand-accent"
                />
              </div>

              {/* Hue */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-300 font-mono">
                  <span>Hue Shift</span>
                  <span>{editState.hue}°</span>
                </div>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  value={editState.hue}
                  onChange={(e) => setEditState(prev => ({ ...prev, hue: parseInt(e.target.value) }))}
                  className="w-full h-1 bg-neutral-800 appearance-none cursor-pointer accent-brand-accent"
                />
              </div>

              {/* Vignette */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-300 font-mono">
                  <span>Vignette Darkness</span>
                  <span>{editState.vignette}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={editState.vignette}
                  onChange={(e) => setEditState(prev => ({ ...prev, vignette: parseInt(e.target.value) }))}
                  className="w-full h-1 bg-neutral-800 appearance-none cursor-pointer accent-brand-accent"
                />
              </div>
            </div>
          )}

          {/* TAB 3: IMAGEMAGICK FILTERS */}
          {activeTab === "filters" && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center justify-between text-xs text-neutral-400 font-mono border-b border-brand-border pb-2">
                <span>ImageMagick Kernels</span>
                <span className="text-[10px] bg-brand-bg px-2 py-0.5 border border-brand-border text-neutral-500">IM equivalent</span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 font-mono uppercase tracking-wider">
                <button
                  onClick={() => setEditState(prev => ({ ...prev, grayscale: !prev.grayscale, sepia: false }))}
                  className={`p-3 rounded-none border flex flex-col items-center justify-center gap-1.5 transition duration-150 cursor-pointer ${
                    editState.grayscale
                      ? "border-brand-accent bg-brand-accent/10 text-white"
                      : "border-brand-border bg-brand-bg text-neutral-400 hover:border-neutral-700"
                  }`}
                >
                  <Palette className="w-5 h-5 text-neutral-400" />
                  <span className="text-[10px] font-bold">Grayscale</span>
                </button>

                <button
                  onClick={() => setEditState(prev => ({ ...prev, sepia: !prev.sepia, grayscale: false }))}
                  className={`p-3 rounded-none border flex flex-col items-center justify-center gap-1.5 transition duration-150 cursor-pointer ${
                    editState.sepia
                      ? "border-brand-accent bg-brand-accent/10 text-white"
                      : "border-brand-border bg-brand-bg text-neutral-400 hover:border-neutral-700"
                  }`}
                >
                  <Palette className="w-5 h-5 text-amber-600" />
                  <span className="text-[10px] font-bold">Warm Sepia</span>
                </button>

                <button
                  onClick={() => setEditState(prev => ({ ...prev, invert: !prev.invert }))}
                  className={`p-3 rounded-none border flex flex-col items-center justify-center gap-1.5 transition duration-150 cursor-pointer ${
                    editState.invert
                      ? "border-brand-accent bg-brand-accent/10 text-white"
                      : "border-brand-border bg-brand-bg text-neutral-400 hover:border-neutral-700"
                  }`}
                >
                  <RotateCcw className="w-5 h-5 text-indigo-400" />
                  <span className="text-[10px] font-bold">Invert Colors</span>
                </button>

                <button
                  onClick={() => setEditState(prev => ({ ...prev, edgeDetect: !prev.edgeDetect }))}
                  className={`p-3 rounded-none border flex flex-col items-center justify-center gap-1.5 transition duration-150 cursor-pointer ${
                    editState.edgeDetect
                      ? "border-brand-accent bg-brand-accent/10 text-white"
                      : "border-brand-border bg-brand-bg text-neutral-400 hover:border-neutral-700"
                  }`}
                >
                  <Scissors className="w-5 h-5 text-rose-400" />
                  <span className="text-[10px] font-bold">Sobel Edges</span>
                </button>
              </div>

              <div className="p-4 bg-brand-bg rounded-none border border-brand-border text-xs text-neutral-400 leading-relaxed space-y-1 font-sans">
                <span className="font-bold text-neutral-300 block font-mono uppercase tracking-wider text-[10px]">Convolution Information</span>
                <span>Applying edge filters recomputes pixel gradients across the local canvas on-the-fly, replicating high-performance ImageMagick CLI convolution kernels.</span>
              </div>
            </div>
          )}

        </div>

        {/* Global Reset and Save bottom buttons */}
        <div className="p-4 border-t border-brand-border bg-brand-panel space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={resetAll}
              className="flex items-center justify-center gap-1 bg-brand-bg hover:bg-neutral-800 text-neutral-300 text-xs font-semibold py-2 px-3 rounded-none border border-brand-border transition duration-150 cursor-pointer font-mono uppercase tracking-wider"
            >
              <RotateCcw className="w-4 h-4" />
              Reset All
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center justify-center gap-1 bg-brand-bg hover:bg-neutral-800 text-neutral-300 text-xs font-semibold py-2 px-3 rounded-none border border-brand-border transition duration-150 cursor-pointer font-mono uppercase tracking-wider"
            >
              <Download className="w-4 h-4" />
              Download PNG
            </button>
          </div>
          
          <button
            onClick={handleSave}
            className="w-full bg-brand-accent hover:bg-[#ff621e] text-white font-bold py-2.5 px-4 rounded-none flex items-center justify-center gap-2 transition duration-150 cursor-pointer text-xs uppercase font-mono tracking-wider shadow-md"
          >
            <Check className="w-4 h-4" />
            Save & Update in Batch
          </button>
        </div>

      </div>
    </div>
  );
}
