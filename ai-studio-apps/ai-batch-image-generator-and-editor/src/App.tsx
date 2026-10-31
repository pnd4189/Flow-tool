import React, { useState, useRef, useEffect } from "react";
import { 
  Sparkles, 
  Play, 
  Pause, 
  RefreshCw, 
  Trash2, 
  Download, 
  Upload, 
  Settings, 
  HelpCircle, 
  CheckCircle2, 
  AlertCircle, 
  Image as ImageIcon, 
  Eye, 
  ChevronRight,
  Maximize2,
  FileText
} from "lucide-react";
import JSZip from "jszip";
import { parsePromptText, detectParsingStrategy, ParsingStrategy } from "./utils/parser";
import { resizeAndCompressToFullHD } from "./utils/imageCompressor";
import { PromptItem, GeminiModel, ImageSize, GenerationSettings } from "./types";
import ImageStudio from "./components/ImageStudio";

// Prefilled sample screenplay from user request
const SAMPLE_SCREENPLAY = `--- SCENE 001 ---

Camera: Ultra-wide establishing shot, 16:9, static wide angle, full environment reveal.
Story DNA: Chapter 3 beat — Moonlit exterior of the old two-story haunted house at night, overgrown courtyard, dim window glow
Setting: Foreground: cracked concrete steps and rusted iron railing. Midground: two-story rural Chinese house with fresh whitewash on walls but peeling exterior, dim yellow light from ground-floor windows. Background: dark village skyline under a waning moon, distant hills silhouetted against deep indigo sky. Overgrown weeds push through broken tiles in the courtyard.
Style: dark-fantasy Chinese donghua look, 2D cel characters over detailed 3D sets, moody low-key lighting, ornate robes, drifting resentful-energy smoke, blood-red and ink-black accents, original character faces, 16:9 aspect ratio.
Lighting / Color: Primary light: cold silver moonlight from above, casting long sharp shadows across the courtyard. Fill: dim warm glow from ground-floor window. Palette: ink-black sky, cold moonlight blue, ash-grey walls, faint warm amber from within.
Atmosphere: Unsettling stillness of a haunted space. Every shadow seems to hide intent, every silence seems deliberate.
Negative: no Western medieval armor, no European castle, no blonde hair, no blue eyes, no Viking horns, no plate mail, no Celtic knots, no Gothic cathedral, no yaoguai with Western demon horns, no Chinese dragon with bat wings, no qipao sexualized, no watermark, no text overlay, no artist signature, no UI element, no frame border, no split-screen

--- SCENE 002 ---

Camera: Medium two-shot or over-the-shoulder, intimate framing at conversation distance.
Story DNA: Chapter 3 beat — Mã Lực Thuật and Tam Nương sit chatting in the living room, she laughs at his jokes
Subject: Mã Lực Thuật — 26 years old, average slightly lanky build, short messy black hair unkempt, square jaw with stubble, narrow tired eyes with dark circles, lion-shaped jade pendant on a red cord at the throat, faded knockoff sportswear tracksuit. Tam Nương — 25 years old, slender curvaceous build, wavy curled hair cascading to shoulders deep chestnut brown, large almond eyes behind oversized sunglasses, red cheongsam (sườn xám) with side slit, strappy heels.
Style: dark-fantasy Chinese donghua look, 2D cel characters over detailed 3D sets, moody low-key lighting, ornate robes, drifting resentful-energy smoke, blood-red and ink-black accents, original character faces, 16:9 aspect ratio.
Lighting / Color: Primary light: single harsh fluorescent tube overhead, casting flat unflattering light with buzzing flicker. Fill: cold moonlight through window gaps. Palette: sickly yellow-white artificial light, deep ink-black shadows in corners.
Atmosphere: Tense conversational atmosphere, words hanging in the air between sips of beer.
Negative: no Western medieval armor, no European castle, no blonde hair, no blue eyes, no Viking horns, no plate mail, no Celtic knots, no Gothic cathedral, no yaoguai with Western demon horns, no Chinese dragon with bat wings, no qipao sexualized, no watermark, no text overlay, no artist signature, no UI element, no frame border

--- SCENE 003 ---

Camera: Low angle hero shot, energy effects radiating from subject, dramatic scale.
Story DNA: Chapter 3 beat — The jade pendant blazes green, Tỳ Hưu leaps out in lion form snarling at Tam Nương
Subject: Mã Lực Thuật — 26 years old, average slightly lanky build, short messy black hair unkempt, square jaw with stubble. Tỳ Hưu — unknown age, compact lion-like quadruped muscular build, wild flowing golden-brown mane, broad snout with fierce fangs, glowing amber eyes, lion-shaped jade form matching the pendant no horns.
Action / Energy: Mystical energy surge. The jade pendant blazes green, Tỳ Hưu leaps out in lion form snarling at Tam Nương.
Style: dark-fantasy Chinese donghua look, 2D cel characters over detailed 3D sets, moody low-key lighting, ornate robes, drifting resentful-energy smoke, blood-red and ink-black accents, original character faces.
Lighting / Color: Primary light: jade-green supernatural glow emanating from the pendant, casting emerald highlights on nearby surfaces. Fill: cold moonlight blue from window.
Atmosphere: Mystical tension between the mundane and supernatural. Ancient power hums through the jade artifact.
Negative: no Western medieval armor, no European castle, no blonde hair, no blue eyes, no Viking horns, no plate mail, no Celtic knots, no Gothic cathedral, no yaoguai with Western demon horns, no Chinese dragon with bat wings, no qipao sexualized, no watermark, no text overlay, no artist signature, no UI element, no frame border

--- SCENE 004 ---

Camera: Close-up or medium close-up, shallow depth of field, face and expression focus.
Story DNA: Chapter 4 beat — Tears stream from the ghost's hollow eyes, all murderous intent vanishes from her form
Subject: Nữ quỷ giày đỏ — 20 years old, slim young female semi-transparent build, long disheveled black hair matted with dried blood, pale bloodless face, vengeful hollow dark eyes, bright red high-heeled shoes, blood trickling down calves, blood-soaked torn white dress.
Style: dark-fantasy Chinese donghua look, 2D cel characters over detailed 3D sets, moody low-key lighting, ornate robes, drifting resentful-energy smoke, blood-red and ink-black accents.
Lighting / Color: Primary light: cold blue-white ghostly luminescence from the spectral figure, casting unnatural shadows. Fill: blood-red ambient glow seeping from below.
Atmosphere: Oppressive supernatural dread permeates every surface.
Negative: no Western medieval armor, no European castle, no blonde hair, no blue eyes, no Viking horns, no plate mail, no Celtic knots, no Gothic cathedral, no yaoguai with Western demon horns, no Chinese dragon with bat wings, no qipao sexualized, no watermark, no text overlay, no artist signature, no UI element, no frame border`;

export default function App() {
  const [inputText, setInputText] = useState(SAMPLE_SCREENPLAY);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [activePromptIndex, setActivePromptIndex] = useState<number>(-1);
  const [isQueueRunning, setIsQueueRunning] = useState(false);
  const [settings, setSettings] = useState<GenerationSettings>({
    model: "gemini-3.1-flash-image",
    aspectRatio: "16:9",
    imageSize: "1K",
    delaySeconds: 2,
    negativePrompt: "low quality, blurry, worst quality, text overlays, watermark, signatures, cropped frame",
  });

  // UI state for image editing studio modal
  const [editingImage, setEditingImage] = useState<{ id: string; url: string } | null>(null);
  
  // File upload ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Drag and drop states
  const [isDragging, setIsDragging] = useState(false);
  const [detectedStrategy, setDetectedStrategy] = useState<ParsingStrategy | null>(null);

  // Sync real-time detection label when input changes
  useEffect(() => {
    if (inputText) {
      setDetectedStrategy(detectParsingStrategy(inputText));
    } else {
      setDetectedStrategy(null);
    }
  }, [inputText]);

  // Parse prompts on mount
  useEffect(() => {
    handleParse();
  }, []);

  const handleParse = () => {
    const parsed = parsePromptText(inputText);
    setPrompts(parsed);
  };

  const processFileContent = (text: string) => {
    setInputText(text);
    const parsed = parsePromptText(text);
    setPrompts(parsed);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        processFileContent(text);
      }
    };
    reader.readAsText(file);
  };

  // Drag and drop event handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    // We can support reading any file type as text (e.g. .txt, .md, .mk, .markdown)
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        processFileContent(text);
      }
    };
    reader.readAsText(file);
  };

  const updatePromptStatus = (id: string, status: PromptItem["status"], imageUrl?: string, error?: string) => {
    setPrompts((prev) =>
      prev.map((p) => {
        if (p.id === id) {
          return {
            ...p,
            status,
            ...(imageUrl ? { imageUrl } : {}),
            ...(error ? { error } : { error: undefined }),
          };
        }
        return p;
      })
    );
  };

  const generateSingleImage = async (promptItem: PromptItem): Promise<boolean> => {
    updatePromptStatus(promptItem.id, "generating");
    try {
      // Create request payload
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptItem.cleanedPrompt,
          negativePrompt: promptItem.negativePrompt || settings.negativePrompt,
          model: settings.model,
          aspectRatio: promptItem.aspectRatio || settings.aspectRatio,
          imageSize: settings.imageSize,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Server failed to generate image");
      }

      let finalImageData = data.imageData;
      if (settings.imageSize === "1920x1080") {
        try {
          finalImageData = await resizeAndCompressToFullHD(data.imageData);
        } catch (resizeErr) {
          console.error("Failed to resize to 1920x1080, falling back to original high-res image", resizeErr);
        }
      }

      updatePromptStatus(promptItem.id, "success", finalImageData);
      return true;
    } catch (err: any) {
      console.error(`Error generating prompt ${promptItem.index}:`, err);
      updatePromptStatus(promptItem.id, "failed", undefined, err.message || "Failed to call Gemini API");
      return false;
    }
  };

  // Sequential queue batch execution with delay settings
  const queueStateRef = useRef({ isRunning: false, currentIndex: 0 });

  useEffect(() => {
    queueStateRef.current.isRunning = isQueueRunning;
  }, [isQueueRunning]);

  const startQueue = async (retryOnly: boolean = false) => {
    if (isQueueRunning) return;
    setIsQueueRunning(true);
    queueStateRef.current.isRunning = true;

    // Filter which items need generation
    const itemsToProcess = prompts.filter((p) => {
      if (retryOnly) {
        return p.status === "failed" || p.status === "idle";
      }
      return p.status !== "success"; // Process failed, queued, or idle items
    });

    if (itemsToProcess.length === 0) {
      setIsQueueRunning(false);
      return;
    }

    // Set statuses to queued
    setPrompts((prev) =>
      prev.map((p) => {
        const shouldQueue = itemsToProcess.some((item) => item.id === p.id);
        if (shouldQueue && p.status !== "generating") {
          return { ...p, status: "queued" };
        }
        return p;
      })
    );

    for (const item of itemsToProcess) {
      if (!queueIsRunningRef.current) break;

      // Mark active card
      setPrompts((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, status: "generating" } : p))
      );

      // Call API
      let success = false;
      try {
        const res = await fetch("/api/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: item.cleanedPrompt,
            negativePrompt: item.negativePrompt || settingsRef.current.negativePrompt,
            model: settingsRef.current.model,
            aspectRatio: item.aspectRatio || settingsRef.current.aspectRatio,
            imageSize: settingsRef.current.imageSize,
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          let finalImageData = data.imageData;
          if (settingsRef.current.imageSize === "1920x1080") {
            try {
              finalImageData = await resizeAndCompressToFullHD(data.imageData);
            } catch (resizeErr) {
              console.error("Failed to resize to 1920x1080, falling back to original high-res image", resizeErr);
            }
          }

          setPrompts((prev) =>
            prev.map((p) =>
              p.id === item.id ? { ...p, status: "success", imageUrl: finalImageData } : p
            )
          );
          success = true;
        } else {
          setPrompts((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? { ...p, status: "failed", error: data.error || "Generation failed" }
                : p
            )
          );
        }
      } catch (err: any) {
        setPrompts((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? { ...p, status: "failed", error: err.message || "Failed to reach server" }
              : p
          )
        );
      }

      // If we have more items and queue is running, apply the delay interval
      if (queueIsRunningRef.current && settingsRef.current.delaySeconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, settingsRef.current.delaySeconds * 1000));
      }
    }

    setIsQueueRunning(false);
  };

  // Keep references updated for the queue loop
  const queueIsRunningRef = useRef(isQueueRunning);
  queueIsRunningRef.current = isQueueRunning;
  
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  
  const promptsRef = useRef(prompts);
  promptsRef.current = prompts;

  const setPromptsSafe = (fn: (prev: PromptItem[]) => PromptItem[]) => {
    setPrompts(fn);
  };

  const stopQueue = () => {
    setIsQueueRunning(false);
  };

  const handleDownloadZip = async () => {
    const successPrompts = prompts.filter((p) => p.status === "success" && p.imageUrl);
    if (successPrompts.length === 0) {
      alert("No successfully generated images to compress.");
      return;
    }

    setLoadingZip(true);
    try {
      const zip = new JSZip();
      
      for (const p of successPrompts) {
        if (!p.imageUrl) continue;
        const base64Data = p.imageUrl.split(",")[1];
        const isPng = p.imageUrl.startsWith("data:image/png");
        const filename = `${String(p.index).padStart(3, "0")}_${p.title.replace(/[^a-zA-Z0-9]/g, "_")}.${isPng ? "png" : "jpeg"}`;
        zip.file(filename, base64Data, { base64: true });
      }

      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      link.download = "batch_generated_images.zip";
      link.click();
    } catch (err) {
      console.error("Error creating ZIP", err);
      alert("Failed to build ZIP file.");
    } finally {
      setLoadingZip(false);
    }
  };

  const [loadingZip, setLoadingZip] = useState(false);

  const deletePrompt = (id: string) => {
    setPrompts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleStudioSave = (newUrl: string) => {
    if (!editingImage) return;
    setPrompts((prev) =>
      prev.map((p) => {
        if (p.id === editingImage.id) {
          return { ...p, imageUrl: newUrl, status: "success" };
        }
        return p;
      })
    );
    setEditingImage(null);
  };

  const successCount = prompts.filter(p => p.status === "success").length;
  const failedCount = prompts.filter(p => p.status === "failed").length;
  const totalCount = prompts.length;
  const progressPercent = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans flex flex-col antialiased">
      {/* Editorial Header */}
      <header className="border-b border-brand-border bg-brand-bg px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="logo font-display italic text-4xl font-black text-white tracking-tight">
            GEN.STUDIO
          </div>
          <div className="h-6 w-px bg-brand-border hidden md:block"></div>
          <div className="hidden md:block">
            <p className="text-[10px] tracking-widest text-neutral-400 font-mono font-bold uppercase">
              AI BATCH IMAGE STUDIO & UPSCALER • NANO BANANA PRO
            </p>
          </div>
        </div>

        {/* Global Controls & Stats */}
        <div className="flex items-center gap-6">
          <div className="hidden sm:flex items-center gap-4 text-xs font-mono">
            <div className="bg-brand-panel border border-brand-border px-3 py-1.5 flex items-center gap-4">
              <div>Total: <span className="text-white font-bold">{totalCount}</span></div>
              <div className="text-neutral-600">|</div>
              <div>Success: <span className="text-[#00FF41] font-bold">{successCount}</span></div>
              <div className="text-neutral-600">|</div>
              <div>Failed: <span className="text-brand-accent font-bold">{failedCount}</span></div>
            </div>
          </div>

          <button
            onClick={handleDownloadZip}
            disabled={loadingZip || successCount === 0}
            className="bg-brand-accent hover:bg-[#ff621e] disabled:opacity-30 disabled:hover:bg-brand-accent disabled:cursor-not-allowed text-white font-semibold uppercase tracking-wider text-xs py-2.5 px-6 rounded-none transition duration-150 cursor-pointer flex items-center gap-2"
          >
            {loadingZip ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Download ZIP
          </button>
        </div>
      </header>

      {/* Main Grid Layout */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar: Workspace / Raw Text Inputs */}
        <div 
          className={`w-96 border-r border-brand-border bg-[#0E0E0E] p-6 flex flex-col space-y-5 overflow-y-auto transition-all duration-200 ${
            isDragging ? "bg-[#141210] border-brand-accent/50" : ""
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="space-y-1.5">
            <h3 className="text-[10px] font-bold text-neutral-400 tracking-widest uppercase font-mono flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-accent" />
              PROMPT WORKSPACE
            </h3>
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              Type, paste, or drop a <strong className="text-neutral-300">.txt</strong>, <strong className="text-neutral-300">.md</strong>, or <strong className="text-neutral-300">.mk</strong> file here. The engine auto-detects scene splitting delimiters.
            </p>
          </div>

          {/* Text Area Drop Zone Wrapper */}
          <div className="flex-1 relative flex flex-col min-h-[300px]">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className={`flex-1 w-full bg-brand-bg border rounded-none p-4 text-xs font-mono text-neutral-300 focus:outline-none focus:border-brand-accent resize-none leading-relaxed transition-colors duration-150 ${
                isDragging ? "border-brand-accent bg-[#18110D]" : "border-brand-border"
              }`}
              placeholder="Enter screenplay details, markdown scenes, numbered lists, or simple prompts separated by double enters..."
            />
            {isDragging && (
              <div className="absolute inset-0 bg-brand-bg/95 border-2 border-dashed border-brand-accent flex flex-col items-center justify-center p-6 text-center z-10 pointer-events-none animate-fade-in">
                <Upload className="w-8 h-8 text-brand-accent animate-bounce mb-3" />
                <p className="text-xs font-bold text-white uppercase font-mono tracking-wider">
                  Drop Prompt File Here
                </p>
                <p className="text-[10px] text-neutral-500 font-mono mt-1">
                  Supports .txt, .md, .mk, .markdown
                </p>
              </div>
            )}
          </div>

          {/* Auto-detected Delimiter Badge Panel */}
          {detectedStrategy && (
            <div className="bg-brand-panel/60 border border-brand-border/80 px-3.5 py-3 rounded-none flex flex-col gap-1.5 text-xs">
              <div className="text-[10px] font-bold font-mono tracking-wider uppercase text-neutral-400 flex items-center justify-between">
                <span>Structure Analysis</span>
                <span className="text-brand-accent font-bold">Auto-Detected</span>
              </div>
              <div className="font-mono text-[11px] text-[#00FF41] font-bold flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00FF41]"></span>
                {detectedStrategy.label}
              </div>
              <p className="text-[10px] text-neutral-500 leading-snug">
                Identified <strong className="text-neutral-300">{detectedStrategy.count}</strong> scenes/prompt segments based on structural cues.
              </p>
            </div>
          )}

          {/* Load Sample + Upload Controls */}
          <div className="grid grid-cols-2 gap-2 text-xs font-mono uppercase tracking-wider">
            <button
              onClick={() => {
                setInputText(SAMPLE_SCREENPLAY);
                setPrompts(parsePromptText(SAMPLE_SCREENPLAY));
              }}
              className="bg-brand-panel hover:bg-neutral-800 border border-brand-border text-brand-text py-2.5 px-3 rounded-none transition duration-150 cursor-pointer"
            >
              Reset Sample
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-brand-panel hover:bg-neutral-800 border border-brand-border text-brand-text py-2.5 px-3 rounded-none flex items-center justify-center gap-1.5 transition duration-150 cursor-pointer"
              title="Upload text or markdown prompts file"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload .txt / .mk
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".txt,.md,.mk,.markdown"
              className="hidden"
            />
          </div>

          <button
            onClick={handleParse}
            className="w-full bg-brand-accent hover:bg-[#ff621e] text-white font-bold py-3 px-4 text-xs tracking-wider uppercase font-mono transition duration-150 cursor-pointer flex items-center justify-center gap-2"
          >
            Parse Workspace Text
          </button>
        </div>

        {/* Right Side: Generation Settings & Queue Grid */}
        <div className="flex-1 bg-brand-bg flex flex-col overflow-hidden">
          
          {/* Settings Console bar */}
          <div className="p-5 border-b border-brand-border bg-brand-panel/40 grid grid-cols-5 gap-4 items-end text-xs">
            
            {/* Model Selection */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-neutral-400 font-mono tracking-wider uppercase flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-brand-accent" />
                ACTIVE ENGINE
              </label>
              <select
                value={settings.model}
                onChange={(e) => setSettings(prev => ({ ...prev, model: e.target.value as GeminiModel }))}
                className="w-full bg-brand-panel border border-brand-border p-2.5 font-mono text-xs text-white focus:outline-none focus:border-brand-accent rounded-sm"
              >
                <option value="gemini-3.1-flash-image">Nano Banana 2 (3.1-Flash)</option>
                <option value="gemini-3-pro-image">Nano Banana Pro (3-Pro)</option>
                <option value="gemini-2.5-flash-image">Nano Banana (2.5-Flash)</option>
                <option value="imagen-4.0-generate-001">Imagen 4.0 Pro Engine</option>
              </select>
            </div>

            {/* Resolution Selector */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-neutral-400 font-mono tracking-wider uppercase">RESOLUTION SIZE</label>
              <select
                value={settings.imageSize}
                onChange={(e) => setSettings(prev => ({ ...prev, imageSize: e.target.value as ImageSize }))}
                className="w-full bg-brand-panel border border-brand-border p-2.5 font-mono text-xs text-white focus:outline-none focus:border-brand-accent rounded-sm"
              >
                <option value="512px">512px (Fast draft)</option>
                <option value="1K">1K (Standard Ultra HD)</option>
                <option value="1920x1080">Full HD (1920x1080 & nén JPEG)</option>
                <option value="2K">2K (High Resolution)</option>
                <option value="4K">4K (Maximum Details)</option>
              </select>
            </div>

            {/* Default Aspect Ratio */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-neutral-400 font-mono tracking-wider uppercase">ASPECT RATIO</label>
              <select
                value={settings.aspectRatio}
                onChange={(e) => setSettings(prev => ({ ...prev, aspectRatio: e.target.value }))}
                className="w-full bg-brand-panel border border-brand-border p-2.5 font-mono text-xs text-white focus:outline-none focus:border-brand-accent rounded-sm"
              >
                <option value="1:1">Square 1:1</option>
                <option value="16:9">Wide 16:9</option>
                <option value="9:16">Portrait 9:16</option>
                <option value="4:3">Photo 4:3</option>
                <option value="3:4">Portrait 3:4</option>
              </select>
            </div>

            {/* Delay interval between prompts */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-neutral-400 font-mono tracking-wider uppercase">DELAY INTERVAL</label>
              <select
                value={settings.delaySeconds}
                onChange={(e) => setSettings(prev => ({ ...prev, delaySeconds: parseInt(e.target.value) }))}
                className="w-full bg-brand-panel border border-brand-border p-2.5 font-mono text-xs text-white focus:outline-none focus:border-brand-accent rounded-sm"
              >
                <option value="0">No Delay (Instant)</option>
                <option value="1">1 Second Delay</option>
                <option value="2">2 Seconds Delay</option>
                <option value="5">5 Seconds Delay</option>
                <option value="10">10 Seconds Delay</option>
              </select>
            </div>

            {/* Core Action Console buttons */}
            <div className="flex gap-2">
              {isQueueRunning ? (
                <button
                  onClick={stopQueue}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2.5 px-3 text-xs tracking-wider uppercase font-mono transition cursor-pointer"
                >
                  <Pause className="w-4 h-4 mr-1 inline" />
                  Pause
                </button>
              ) : (
                <button
                  onClick={() => startQueue(false)}
                  disabled={totalCount === 0}
                  className="flex-1 bg-brand-accent hover:bg-[#ff621e] disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold py-2.5 px-3 text-xs tracking-wider uppercase font-mono transition cursor-pointer"
                >
                  <Play className="w-4 h-4 mr-1 inline" />
                  Run All
                </button>
              )}
              
              <button
                onClick={() => startQueue(true)}
                disabled={isQueueRunning || totalCount === 0 || failedCount === 0}
                className="bg-brand-panel hover:bg-neutral-800 disabled:opacity-30 border border-brand-border text-neutral-300 px-3 py-2.5 text-xs tracking-wider uppercase font-mono transition cursor-pointer"
                title="Retry failed items only"
              >
                <RefreshCw className="w-4 h-4 mr-1 inline" />
                Retry
              </button>
            </div>

          </div>

          {/* Main Cards list container with Editorial radial gradient */}
          <div className="flex-1 overflow-y-auto p-8 bg-[radial-gradient(circle_at_top_right,#161616_0%,#0c0c0c_100%)]">
            {totalCount === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 max-w-md mx-auto">
                <ImageIcon className="w-12 h-12 text-neutral-700 stroke-[1.5] mb-4" />
                <h3 className="font-display italic text-lg text-neutral-300 font-bold">No scene prompts parsed</h3>
                <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                  Enter screenplay texts on the left and click "Parse Workspace Text" to see your scenes automatically structured into batch generation items.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {prompts.map((prompt) => {
                  const isSuccess = prompt.status === "success";
                  const isGenerating = prompt.status === "generating";
                  const isFailed = prompt.status === "failed";
                  const isQueued = prompt.status === "queued";

                  return (
                    <div 
                      key={prompt.id} 
                      className={`group border transition-all duration-300 flex flex-col relative rounded-sm ${
                        isGenerating ? "border-brand-accent shadow-[0_0_15px_rgba(255,78,0,0.1)] bg-[#1A1A1A]" :
                        isSuccess ? "border-brand-border hover:border-neutral-700 bg-brand-panel/40" :
                        isFailed ? "border-brand-accent/50 bg-[#1F1212]" : "border-brand-border hover:border-neutral-800 bg-[#121212]/80"
                      }`}
                    >
                      {/* Card Header information */}
                      <div className="p-4 border-b border-brand-border/60 flex items-start justify-between bg-brand-panel/20">
                        <div className="space-y-1 pr-2">
                          <div className="flex items-center gap-2.5">
                            <span className="font-mono text-brand-accent font-bold text-xs bg-brand-accent/10 px-2 py-0.5 border border-brand-accent/10">
                              #{String(prompt.index).padStart(3, "0")}
                            </span>
                            <span className="font-bold text-white text-xs uppercase tracking-wider">{prompt.title}</span>
                          </div>
                          
                          {/* Aspect Ratio Badge */}
                          <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 font-mono">
                            <span>Target ratio: {prompt.aspectRatio || settings.aspectRatio}</span>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div>
                          {isSuccess && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#00FF41] bg-[#00FF41]/10 px-2.5 py-0.5 font-mono border border-[#00FF41]/15">
                              ● READY
                            </span>
                          )}
                          {isGenerating && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-accent bg-brand-accent/10 px-2.5 py-0.5 font-mono border border-brand-accent/15">
                              ● COMPILING
                            </span>
                          )}
                          {isFailed && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-accent bg-brand-accent/10 px-2.5 py-0.5 font-mono border border-brand-accent/15">
                              ● ERROR
                            </span>
                          )}
                          {isQueued && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-neutral-400 bg-neutral-800 px-2.5 py-0.5 font-mono border border-neutral-700">
                              QUEUED
                            </span>
                          )}
                          {prompt.status === "idle" && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-neutral-500 bg-neutral-900 px-2.5 py-0.5 font-mono">
                              IDLE
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Content body */}
                      <div className="p-4 flex-1 flex flex-col md:flex-row gap-4">
                        
                        {/* Left half: Prompt descriptors */}
                        <div className="flex-1 space-y-3 flex flex-col justify-between">
                          <div className="space-y-1.5">
                            <p className="text-xs text-neutral-300 leading-relaxed max-h-32 overflow-y-auto pr-1 font-sans">
                              {prompt.cleanedPrompt}
                            </p>
                            {prompt.negativePrompt && (
                              <p className="text-[10px] text-brand-accent/80 font-mono leading-relaxed bg-brand-accent/5 p-2 rounded-none border border-brand-accent/10">
                                <span className="font-bold uppercase text-[9px] block text-brand-accent/50 mb-0.5">Avoid negative:</span>
                                {prompt.negativePrompt}
                              </p>
                            )}
                          </div>

                          {/* Individual Controls */}
                          <div className="flex items-center gap-1 pt-2 border-t border-brand-border/30">
                            <button
                              onClick={() => generateSingleImage(prompt)}
                              disabled={isGenerating}
                              className="py-1.5 px-3 bg-[#1D1D1D] hover:bg-[#2A2A2A] text-brand-text hover:text-brand-accent border border-brand-border transition text-[11px] font-semibold tracking-wider uppercase font-mono flex items-center gap-1"
                              title="Generate this image single"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                              Run
                            </button>
                            
                            <button
                              onClick={() => deletePrompt(prompt.id)}
                              className="p-1.5 bg-[#1D1D1D] hover:bg-brand-accent/15 text-neutral-400 hover:text-brand-accent border border-brand-border hover:border-brand-accent/20 transition"
                              title="Delete Scene"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Right half: Image output viewport */}
                        <div className="w-full md:w-44 h-44 bg-brand-bg border border-brand-border overflow-hidden relative flex items-center justify-center flex-shrink-0 group-hover:border-neutral-700 transition-all duration-300 rounded-sm">
                          {prompt.imageUrl ? (
                            <>
                              <img 
                                src={prompt.imageUrl} 
                                alt={prompt.title}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                              
                              {/* Hover actions panel */}
                              <div className="absolute inset-0 bg-black/85 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-2 transition-all duration-200">
                                <button
                                  onClick={() => setEditingImage({ id: prompt.id, url: prompt.imageUrl! })}
                                  className="w-32 bg-brand-accent hover:bg-[#ff621e] text-white font-bold py-1.5 px-3 rounded-none flex items-center justify-center gap-1.5 text-xs tracking-wider uppercase font-mono transition cursor-pointer"
                                >
                                  <Maximize2 className="w-3.5 h-3.5" />
                                  Edit & Upscale
                                </button>
                                
                                <a
                                  href={prompt.imageUrl}
                                  download={`scene_${String(prompt.index).padStart(3, "0")}.png`}
                                  className="w-32 bg-neutral-900 hover:bg-neutral-800 text-brand-text border border-brand-border py-1.5 px-3 rounded-none flex items-center justify-center gap-1.5 text-xs tracking-wider uppercase font-mono transition text-center"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  Download PNG
                                </a>
                              </div>
                            </>
                          ) : (
                            <div className="flex flex-col items-center justify-center text-center p-4">
                              {isGenerating ? (
                                <>
                                  <div className="relative w-8 h-8">
                                    <div className="absolute inset-0 rounded-full border-2 border-brand-accent/10"></div>
                                    <div className="absolute inset-0 rounded-full border-2 border-brand-accent border-t-transparent animate-spin"></div>
                                  </div>
                                  <span className="text-[10px] text-brand-accent font-mono mt-2 uppercase tracking-widest animate-pulse">Generating</span>
                                </>
                              ) : isFailed ? (
                                <>
                                  <AlertCircle className="w-6 h-6 text-brand-accent mb-1" />
                                  <span className="text-[10px] text-brand-accent font-bold font-mono">ERROR OCCURRED</span>
                                  <p className="text-[9px] text-neutral-500 mt-1 max-h-16 overflow-y-auto leading-normal px-1 font-mono">
                                    {prompt.error || "Details unavailable"}
                                  </p>
                                </>
                              ) : (
                                <>
                                  <ImageIcon className="w-6 h-6 text-neutral-800 mb-1" />
                                  <span className="text-[9px] text-neutral-600 font-mono uppercase">Waiting</span>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

      </main>

      {/* Editorial Footer status bar */}
      <footer className="h-14 border-t border-brand-border bg-brand-panel flex items-center px-8 justify-between font-mono text-[11px] font-bold text-neutral-400 uppercase tracking-widest">
        <div>Total Queue: {totalCount} Items</div>
        <div className="flex items-center gap-6">
          <span>Batch Progress: {progressPercent}%</span>
          <div className="w-48 h-1 bg-brand-border relative">
            <div className="absolute h-full bg-brand-accent transition-all duration-300" style={{ width: `${progressPercent}%` }}></div>
          </div>
        </div>
        <div>System: v2.5.0-ULTRA • ACTIVE</div>
      </footer>

      {/* Built-in PIL / ImageMagick Editor Modal */}
      {editingImage && (
        <ImageStudio
          url={editingImage.url}
          onSave={handleStudioSave}
          onClose={() => setEditingImage(null)}
        />
      )}
    </div>
  );
}
