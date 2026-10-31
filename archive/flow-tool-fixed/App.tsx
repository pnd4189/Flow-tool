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