import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { EffectConfig, SupportedAspectRatio, ParallaxLayerData } from '../types';
import { renderFrame, type RenderAssets } from '../services/motionEngine';
import { extractColorPalette } from '../services/overlays';

interface PreviewPlayerProps {
  imageSrc: string;
  aspectRatio: SupportedAspectRatio;
  effectConfig: EffectConfig;
  parallaxLayers?: ParallaxLayerData;
  onChangeFocus?: (focus: { x: number; y: number }) => void;
}

export const PreviewPlayer: React.FC<PreviewPlayerProps> = ({
  imageSrc,
  aspectRatio,
  effectConfig,
  parallaxLayers,
  onChangeFocus,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [resolution, setResolution] = useState<'480p' | '720p'>('480p');
  const [fps, setFps] = useState<number>(60);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // Asset đã nạp
  const assetsRef = useRef<RenderAssets | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const fpsCounterRef = useRef<{ frames: number; lastTime: number }>({ frames: 0, lastTime: performance.now() });

  // Refs giữ state mới nhất cho animation loop
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const isLoopingRef = useRef(isLooping);
  isLoopingRef.current = isLooping;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const configRef = useRef(effectConfig);
  configRef.current = effectConfig;

  // Tỷ lệ kích thước canvas theo resolution và aspect ratio
  const getCanvasDimensions = useCallback((): { width: number; height: number } => {
    const is720 = resolution === '720p';
    switch (aspectRatio) {
      case '16:9':
        return is720 ? { width: 1280, height: 720 } : { width: 854, height: 480 };
      case '9:16':
        return is720 ? { width: 720, height: 1280 } : { width: 480, height: 854 };
      case '1:1':
        return is720 ? { width: 720, height: 720 } : { width: 480, height: 480 };
      case '4:3':
        return is720 ? { width: 960, height: 720 } : { width: 640, height: 480 };
      case '3:4':
        return is720 ? { width: 720, height: 960 } : { width: 480, height: 640 };
      default:
        return { width: 854, height: 480 };
    }
  }, [aspectRatio, resolution]);

  // Nạp ảnh gốc và 2 lớp Parallax nếu có
  useEffect(() => {
    if (!imageSrc) return;
    setIsLoaded(false);

    let isCancelled = false;

    const loadImages = async () => {
      // 1. Tải ảnh gốc
      const baseImg = await loadImageElement(imageSrc);
      if (isCancelled) return;
      const palette = extractColorPalette(baseImg);

      let pAssets: RenderAssets['parallaxLayers'] = undefined;

      // 2. Nếu parallax ready thì tải thêm bg và cutout subject
      if (
        parallaxLayers &&
        parallaxLayers.status === 'ready' &&
        (parallaxLayers.bgBlobUrl || parallaxLayers.bgBase64) &&
        (parallaxLayers.subjectCutoutDataUrl || parallaxLayers.subjectCutoutBase64)
      ) {
        try {
          const bgSrc =
            parallaxLayers.bgBlobUrl ||
            `data:image/jpeg;base64,${parallaxLayers.bgBase64}`;
          const subSrc =
            parallaxLayers.subjectCutoutDataUrl ||
            `data:image/png;base64,${parallaxLayers.subjectCutoutBase64}`;

          const [bgImg, subImg] = await Promise.all([
            loadImageElement(bgSrc),
            loadImageElement(subSrc),
          ]);

          if (!isCancelled) {
            pAssets = {
              bgImage: bgImg,
              subjectImage: subImg,
              isReady: true,
            };
          }
        } catch (layerErr) {
          console.warn('Lỗi nạp ảnh 2 lớp parallax, dùng ảnh gốc:', layerErr);
        }
      }

      if (isCancelled) return;

      assetsRef.current = {
        image: baseImg,
        palette,
        parallaxLayers: pAssets,
      };

      setIsLoaded(true);

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          renderFrame(ctx, assetsRef.current, configRef.current, currentTimeRef.current, canvas.width, canvas.height);
        }
      }
    };

    loadImages();

    return () => {
      isCancelled = true;
    };
  }, [imageSrc, parallaxLayers]);

  // Cập nhật kích thước canvas khi đổi resolution hoặc aspect ratio
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = getCanvasDimensions();
    canvas.width = width;
    canvas.height = height;

    if (assetsRef.current) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        renderFrame(ctx, assetsRef.current, configRef.current, currentTimeRef.current, width, height);
      }
    }
  }, [getCanvasDimensions]);

  // Vẽ lại khi tạm dừng nhưng thay đổi thời gian hoặc cấu hình hiệu ứng
  useEffect(() => {
    if (!isPlaying && assetsRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        renderFrame(ctx, assetsRef.current, configRef.current, currentTime, canvasRef.current.width, canvasRef.current.height);
      }
    }
  }, [currentTime, effectConfig, isPlaying]);

  // Tạm dừng khi chuyển tab (visibilitychange)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        setIsPlaying(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Vòng lặp animation frame
  useEffect(() => {
    if (!isPlaying || !isLoaded) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    lastFrameTimeRef.current = performance.now();

    const loop = (now: number) => {
      const deltaSec = (now - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = now;

      // Đo FPS thực tế
      fpsCounterRef.current.frames++;
      if (now - fpsCounterRef.current.lastTime >= 1000) {
        setFps(fpsCounterRef.current.frames);
        fpsCounterRef.current.frames = 0;
        fpsCounterRef.current.lastTime = now;
      }

      const totalDur = configRef.current.durationSec || 6;
      let nextTime = currentTimeRef.current + deltaSec;

      if (nextTime >= totalDur) {
        if (isLoopingRef.current) {
          nextTime = nextTime % totalDur;
        } else {
          nextTime = totalDur;
          setIsPlaying(false);
        }
      }

      currentTimeRef.current = nextTime;
      setCurrentTime(nextTime);

      const canvas = canvasRef.current;
      if (canvas && assetsRef.current) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          renderFrame(ctx, assetsRef.current, configRef.current, nextTime, canvas.width, canvas.height);
        }
      }

      if (isPlayingRef.current) {
        animationFrameRef.current = requestAnimationFrame(loop);
      }
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, isLoaded]);

  // Bấm lên khung để đặt focus khi camera là push_to_focus
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (effectConfig.camera.move !== 'push_to_focus' || !onChangeFocus) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const x = Math.max(0, Math.min(1, clientX / rect.width));
    const y = Math.max(0, Math.min(1, clientY / rect.height));
    onChangeFocus({ x, y });
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    currentTimeRef.current = val;
    if (assetsRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        renderFrame(ctx, assetsRef.current, configRef.current, val, canvasRef.current.width, canvasRef.current.height);
      }
    }
  };

  const togglePlay = () => {
    if (!isPlaying && currentTime >= (effectConfig.durationSec || 6)) {
      setCurrentTime(0);
      currentTimeRef.current = 0;
    }
    setIsPlaying((prev) => !prev);
  };

  const focusPoint = effectConfig.camera.focus || { x: 0.5, y: 0.5 };
  const isPushToFocus = effectConfig.camera.move === 'push_to_focus';
  const isParallaxOn = !!(effectConfig.parallax.enabled && parallaxLayers?.status === 'ready');

  return (
    <div className="flex flex-col h-full w-full bg-[#0a0a0d] border border-[#26262b] rounded-xl overflow-hidden shadow-2xl">
      {/* Vùng hiển thị Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative bg-black flex items-center justify-center p-2 min-h-[280px] overflow-hidden select-none"
      >
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className={`max-w-full max-h-full object-contain rounded shadow-lg transition-transform ${
            isPushToFocus ? 'cursor-crosshair' : 'cursor-default'
          }`}
        />

        {/* Dấu chữ thập tâm Focus nếu là push_to_focus */}
        {isPushToFocus && (
          <div
            className="absolute pointer-events-none transition-all duration-75"
            style={{
              left: `${focusPoint.x * 100}%`,
              top: `${focusPoint.y * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className="relative w-8 h-8 flex items-center justify-center">
              <span className="material-symbols-outlined text-[#f5b301] text-[28px] drop-shadow-md animate-pulse">
                adjust
              </span>
              <span className="absolute -bottom-4 text-[10px] font-mono text-[#f5b301] bg-black/80 px-1 py-0.2 rounded whitespace-nowrap">
                Focus ({Math.round(focusPoint.x * 100)}%, {Math.round(focusPoint.y * 100)}%)
              </span>
            </div>
          </div>
        )}

        {/* Badge trạng thái góc trên */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 pointer-events-none">
          <span className="px-2 py-0.5 rounded bg-black/75 backdrop-blur-xs text-[10px] font-mono text-zinc-300 border border-[#2b2b35]">
            {aspectRatio}
          </span>
          <span className="px-2 py-0.5 rounded bg-black/75 backdrop-blur-xs text-[10px] font-mono text-[#f5b301] border border-[#2b2b35]">
            {fps} FPS
          </span>
          {isParallaxOn && (
            <span className="px-2 py-0.5 rounded bg-[#22c55e]/20 text-[#22c55e] text-[10px] font-semibold font-mono border border-[#22c55e]/40 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-ping" />
              Parallax 2 lớp
            </span>
          )}
          {isPushToFocus && (
            <span className="px-2 py-0.5 rounded bg-[#f5b301]/20 text-[#f5b301] text-[10px] font-medium border border-[#f5b301]/40 animate-pulse">
              Bấm để đặt điểm Focus
            </span>
          )}
        </div>
      </div>

      {/* Thanh điều khiển phát (Controls Bar) */}
      <div className="p-3 bg-[#141417] border-t border-[#26262b] flex flex-col gap-2">
        {/* Thanh tua thời gian (Seek Bar) */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-zinc-400 w-10 text-right">
            {currentTime.toFixed(1)}s
          </span>
          <input
            type="range"
            min={0}
            max={effectConfig.durationSec || 6}
            step={0.05}
            value={currentTime}
            onChange={handleSeek}
            className="flex-1 h-1.5 bg-[#26262f] rounded-lg appearance-none cursor-pointer accent-[#f5b301]"
          />
          <span className="text-[11px] font-mono text-zinc-400 w-10">
            {(effectConfig.durationSec || 6).toFixed(1)}s
          </span>
        </div>

        {/* Các nút phát, lặp lại, chất lượng */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="w-8 h-8 rounded-lg bg-[#f5b301] text-black flex items-center justify-center font-bold hover:bg-[#ffbe1a] transition-all active:scale-95 shadow-sm"
              title={isPlaying ? 'Tạm dừng (Space)' : 'Phát (Space)'}
            >
              <span className="material-symbols-outlined text-[20px]">
                {isPlaying ? 'pause' : 'play_arrow'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCurrentTime(0);
                currentTimeRef.current = 0;
              }}
              className="w-8 h-8 rounded-lg bg-[#1e1e24] text-zinc-300 hover:text-white hover:bg-[#282830] border border-[#2d2d35] flex items-center justify-center transition-colors"
              title="Về đầu (0s)"
            >
              <span className="material-symbols-outlined text-[17px]">replay</span>
            </button>

            <button
              type="button"
              onClick={() => setIsLooping((l) => !l)}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors border ${
                isLooping
                  ? 'bg-[#f5b301]/15 text-[#f5b301] border-[#f5b301]/30'
                  : 'bg-[#1e1e24] text-zinc-500 border-[#2d2d35] hover:text-zinc-300'
              }`}
              title={isLooping ? 'Đang bật lặp lại' : 'Tắt lặp lại'}
            >
              <span className="material-symbols-outlined text-[17px]">repeat</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#18181f] p-0.5 rounded-lg border border-[#26262b] text-[11px] font-mono">
              <button
                type="button"
                onClick={() => setResolution('480p')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  resolution === '480p'
                    ? 'bg-[#f5b301] text-black font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                480p
              </button>
              <button
                type="button"
                onClick={() => setResolution('720p')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  resolution === '720p'
                    ? 'bg-[#f5b301] text-black font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                720p
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = (e) => reject(e);
    el.src = src;
  });
}
