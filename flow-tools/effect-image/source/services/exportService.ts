import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type {
  QueueItem,
  SupportedAspectRatio,
  ExportResolution,
  ExportFps,
  EffectConfig,
  ExportManifestItem,
} from '../types';
import { renderFrame, type RenderAssets } from './motionEngine';
import { extractColorPalette } from './overlays';
import { checkCodecCapabilities } from './mp4Encoder';
import { buildFilename } from './downloadQueue';

export interface RenderClipOptions {
  resolution: ExportResolution;
  fps: ExportFps;
}

export interface RenderResult {
  blob: Blob;
  base64: string;
  mimeType: 'video/mp4' | 'video/webm';
  durationSec: number;
  frames: number;
  sizeBytes: number;
  renderTimeMs: number;
  width: number;
  height: number;
}

export function getExportDimensions(
  aspectRatio: SupportedAspectRatio,
  resolution: ExportResolution
): { width: number; height: number } {
  const is1080 = resolution === '1080p';
  switch (aspectRatio) {
    case '16:9':
      return is1080 ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
    case '9:16':
      return is1080 ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
    case '1:1':
      return is1080 ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
    case '4:3':
      return is1080 ? { width: 1440, height: 1080 } : { width: 960, height: 720 };
    case '3:4':
      return is1080 ? { width: 1080, height: 1440 } : { width: 720, height: 960 };
    default:
      return is1080 ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  }
}

export function yieldThread(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

export async function loadDecodedImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  if (!src.startsWith('blob:') && !src.startsWith('data:')) {
    img.crossOrigin = 'anonymous';
  }
  img.src = src;
  if ('decode' in img) {
    await img.decode();
  } else {
    await new Promise((resolve, reject) => {
      const el = img as HTMLImageElement;
      el.onload = () => resolve(img);
      el.onerror = reject;
    });
  }
  return img;
}

export async function prepareRenderAssets(item: QueueItem): Promise<RenderAssets> {
  const variant = item.variants[item.selectedVariantIndex] || item.variants[0];
  if (!variant) {
    throw new Error(`Mục #${item.promptItem.order} không có dữ liệu ảnh để dựng video.`);
  }

  const baseSrc = variant.blobUrl || variant.thumbnailUrl;
  const baseImg = await loadDecodedImage(baseSrc);
  const palette = extractColorPalette(baseImg);

  let pAssets: RenderAssets['parallaxLayers'] = undefined;

  const isParallaxEnabled = item.effectConfig?.parallax.enabled;
  const layers = item.parallaxLayers;

  if (
    isParallaxEnabled &&
    layers &&
    layers.status === 'ready' &&
    layers.bgBlobUrl &&
    (layers.subjectCutoutBlobUrl || layers.subjectCutoutDataUrl)
  ) {
    try {
      const bgSrc = layers.bgBlobUrl;
      const subSrc = layers.subjectCutoutBlobUrl || layers.subjectCutoutDataUrl!;

      const [bgImg, subImg] = await Promise.all([
        loadDecodedImage(bgSrc),
        loadDecodedImage(subSrc),
      ]);

      pAssets = {
        bgImage: bgImg,
        subjectImage: subImg,
        isReady: true,
      };
    } catch (layerErr) {
      console.warn('Lỗi nạp lớp parallax cho xuất video, dùng ảnh gốc:', layerErr);
    }
  }

  return {
    image: baseImg,
    palette,
    parallaxLayers: pAssets,
  };
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

export async function renderClipToMp4(
  item: QueueItem,
  opts: RenderClipOptions,
  onProgress?: (percent: number, frameIndex: number, totalFrames: number) => void,
  signal?: AbortSignal
): Promise<RenderResult> {
  const startTime = performance.now();
  if (signal?.aborted) throw new Error('Tiến trình dựng đã bị huỷ.');

  const config: EffectConfig = item.effectConfig || {
    camera: { move: 'zoom_in', intensity: 0.4, easing: 'easeInOut' },
    parallax: { enabled: false, direction: 'in', depth: 0.5, subjectBreath: true, subjectFloat: false },
    overlays: [],
    durationSec: 6,
    fadeInOut: true,
    seed: 12345,
    source: 'default',
  };

  const durationSec = Math.max(1, config.durationSec || 6);
  const fps = opts.fps || 24;
  const totalFrames = Math.round(durationSec * fps);
  const { width, height } = getExportDimensions(item.promptItem.aspectRatio, opts.resolution);

  const assets = await prepareRenderAssets(item);
  if (signal?.aborted) throw new Error('Tiến trình dựng đã bị huỷ.');

  let canvas: OffscreenCanvas | HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  if (!ctx) throw new Error('Không thể khởi tạo Canvas 2D context cho xuất video.');

  const support = await checkCodecCapabilities();
  const hasVideoEncoder = support.hasVideoEncoder;

  if (hasVideoEncoder) {
    try {
      const is1080 = opts.resolution === '1080p';
      const bitrate = is1080 ? 12_000_000 : 6_000_000;
      const codecCandidate = is1080
        ? 'avc1.640028'
        : support.h264_720p
        ? 'avc1.4d401f'
        : 'avc1.42001f';

      let chosenCodec = codecCandidate;
      try {
        const testRes = await VideoEncoder.isConfigSupported({
          codec: chosenCodec,
          width,
          height,
          bitrate,
          framerate: fps,
        });
        if (!testRes.supported) {
          chosenCodec = 'avc1.42001f';
        }
      } catch {
        chosenCodec = 'avc1.42001f';
      }

      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: 'avc',
          width,
          height,
        },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });

      let encodeError: Error | null = null;
      let dequeueResolve: (() => void) | null = null;

      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (err) => {
          encodeError = err instanceof Error ? err : new Error(String(err));
        },
      });

      encoder.ondequeue = () => {
        if (encoder.encodeQueueSize <= 8 && dequeueResolve) {
          dequeueResolve();
          dequeueResolve = null;
        }
      };

      encoder.configure({
        codec: chosenCodec,
        width,
        height,
        bitrate,
        framerate: fps,
      });

      for (let i = 0; i < totalFrames; i++) {
        if (signal?.aborted) {
          encoder.close();
          throw new Error('Tiến trình dựng đã bị huỷ.');
        }
        if (encodeError) throw encodeError;

        if (encoder.encodeQueueSize > 8) {
          await new Promise<void>((resolve) => {
            dequeueResolve = resolve;
          });
        }

        const t = i / fps;
        renderFrame(ctx as any, assets, config, t, width, height);

        const timestampMicros = Math.round((i * 1_000_000) / fps);
        const durationMicros = Math.round(1_000_000 / fps);

        const videoFrame = new VideoFrame(canvas as any, {
          timestamp: timestampMicros,
          duration: durationMicros,
        });

        const isKeyframe = i % (fps * 2) === 0;
        encoder.encode(videoFrame, { keyFrame: isKeyframe });
        videoFrame.close();

        if (onProgress) {
          const percent = Math.round(((i + 1) / totalFrames) * 100);
          onProgress(percent, i + 1, totalFrames);
        }

        if (i % 6 === 0) {
          await yieldThread();
        }
      }

      await encoder.flush();
      encoder.close();
      muxer.finalize();

      const buffer = muxer.target.buffer;
      const blob = new Blob([buffer], { type: 'video/mp4' });
      const base64 = arrayBufferToBase64(buffer);
      const renderTimeMs = Math.round(performance.now() - startTime);

      return {
        blob,
        base64,
        mimeType: 'video/mp4',
        durationSec,
        frames: totalFrames,
        sizeBytes: buffer.byteLength,
        renderTimeMs,
        width,
        height,
      };
    } catch (encErr) {
      console.warn('WebCodecs H.264 gặp lỗi, chuyển sang fallback MediaRecorder WebM:', encErr);
    }
  }

  return await renderWithMediaRecorder(canvas, ctx as any, assets, config, width, height, fps, durationSec, onProgress, signal, startTime);
}

async function renderWithMediaRecorder(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  assets: RenderAssets,
  config: EffectConfig,
  width: number,
  height: number,
  fps: number,
  durationSec: number,
  onProgress?: (percent: number, frameIndex: number, totalFrames: number) => void,
  signal?: AbortSignal,
  startTime: number = performance.now()
): Promise<RenderResult> {
  let domCanvas: HTMLCanvasElement;
  if ('transferToImageBitmap' in canvas) {
    domCanvas = document.createElement('canvas');
    domCanvas.width = width;
    domCanvas.height = height;
  } else {
    domCanvas = canvas as HTMLCanvasElement;
  }
  const domCtx = domCanvas.getContext('2d', { willReadFrequently: true })!;

  const mimeChoice = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const stream = domCanvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: mimeChoice });
  const chunks: Blob[] = [];

  const recordPromise = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    recorder.onerror = (e) => reject((e as any).error || new Error('MediaRecorder lỗi.'));
  });

  recorder.start();
  const totalFrames = Math.round(durationSec * fps);
  const frameIntervalMs = 1000 / fps;

  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) {
      recorder.stop();
      throw new Error('Tiến trình dựng đã bị huỷ.');
    }

    const t = i / fps;
    renderFrame(domCtx, assets, config, t, width, height);

    if (onProgress) {
      const percent = Math.round(((i + 1) / totalFrames) * 100);
      onProgress(percent, i + 1, totalFrames);
    }

    await new Promise((r) => setTimeout(r, frameIntervalMs));
  }

  recorder.stop();
  const webmBlob = await recordPromise;
  const arrayBuffer = await webmBlob.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  const renderTimeMs = Math.round(performance.now() - startTime);

  return {
    blob: webmBlob,
    base64,
    mimeType: 'video/webm',
    durationSec,
    frames: totalFrames,
    sizeBytes: arrayBuffer.byteLength,
    renderTimeMs,
    width,
    height,
  };
}

export function getDominantAspectRatio(items: QueueItem[]): SupportedAspectRatio {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const ar = item.promptItem.aspectRatio;
    counts[ar] = (counts[ar] || 0) + 1;
  }
  let maxCount = 0;
  let dominant: SupportedAspectRatio = '16:9';
  for (const [ar, cnt] of Object.entries(counts)) {
    if (cnt > maxCount) {
      maxCount = cnt;
      dominant = ar as SupportedAspectRatio;
    }
  }
  return dominant;
}

export async function renderMergedVideo(
  items: QueueItem[],
  opts: RenderClipOptions,
  onProgress?: (overallPercent: number, clipIndex: number, totalClips: number) => void,
  signal?: AbortSignal
): Promise<RenderResult> {
  const startTime = performance.now();
  if (signal?.aborted) throw new Error('Tiến trình ghép đã bị huỷ.');
  if (items.length === 0) throw new Error('Không có clip nào để ghép.');

  const dominantAspect = getDominantAspectRatio(items);
  const { width: targetWidth, height: targetHeight } = getExportDimensions(dominantAspect, opts.resolution);
  const fps = opts.fps || 24;

  const mainCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const mainCtx = mainCanvas.getContext('2d', { willReadFrequently: true })!;

  const is1080 = opts.resolution === '1080p';
  const bitrate = is1080 ? 12_000_000 : 6_000_000;
  const codec = is1080 ? 'avc1.640028' : 'avc1.42001f';

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: targetWidth,
      height: targetHeight,
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encodeError: Error | null = null;
  let dequeueResolve: (() => void) | null = null;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encodeError = err instanceof Error ? err : new Error(String(err));
    },
  });

  encoder.ondequeue = () => {
    if (encoder.encodeQueueSize <= 8 && dequeueResolve) {
      dequeueResolve();
      dequeueResolve = null;
    }
  };

  encoder.configure({
    codec,
    width: targetWidth,
    height: targetHeight,
    bitrate,
    framerate: fps,
  });

  let globalFrameIndex = 0;
  let totalCalculatedDuration = 0;
  const totalClips = items.length;

  for (let clipIdx = 0; clipIdx < totalClips; clipIdx++) {
    if (signal?.aborted) {
      encoder.close();
      throw new Error('Tiến trình ghép đã bị huỷ.');
    }
    if (encodeError) throw encodeError;

    const item = items[clipIdx];
    const config: EffectConfig = item.effectConfig || {
      camera: { move: 'zoom_in', intensity: 0.4, easing: 'easeInOut' },
      parallax: { enabled: false, direction: 'in', depth: 0.5, subjectBreath: true, subjectFloat: false },
      overlays: [],
      durationSec: 6,
      fadeInOut: true,
      seed: 12345,
      source: 'default',
    };

    const durationSec = Math.max(1, config.durationSec || 6);
    totalCalculatedDuration += durationSec;
    const clipFrames = Math.round(durationSec * fps);

    const { width: clipW, height: clipH } = getExportDimensions(item.promptItem.aspectRatio, opts.resolution);
    const clipCanvas = new OffscreenCanvas(clipW, clipH);
    const clipCtx = clipCanvas.getContext('2d', { willReadFrequently: true })!;

    const assets = await prepareRenderAssets(item);

    for (let f = 0; f < clipFrames; f++) {
      if (signal?.aborted) {
        encoder.close();
        throw new Error('Tiến trình ghép đã bị huỷ.');
      }
      if (encodeError) throw encodeError;

      if (encoder.encodeQueueSize > 8) {
        await new Promise<void>((resolve) => {
          dequeueResolve = resolve;
        });
      }

      const t = f / fps;
      renderFrame(clipCtx as any, assets, config, t, clipW, clipH);

      mainCtx.save();
      mainCtx.fillStyle = '#000000';
      mainCtx.fillRect(0, 0, targetWidth, targetHeight);

      if (clipW === targetWidth && clipH === targetHeight) {
        mainCtx.drawImage(clipCanvas, 0, 0);
      } else {
        mainCtx.save();
        mainCtx.filter = 'blur(30px) brightness(0.6)';
        const bgScale = Math.max(targetWidth / clipW, targetHeight / clipH) * 1.15;
        const bgW = clipW * bgScale;
        const bgH = clipH * bgScale;
        mainCtx.drawImage(
          clipCanvas,
          (targetWidth - bgW) / 2,
          (targetHeight - bgH) / 2,
          bgW,
          bgH
        );
        mainCtx.restore();

        const fitScale = Math.min(targetWidth / clipW, targetHeight / clipH);
        const fitW = clipW * fitScale;
        const fitH = clipH * fitScale;
        const fitX = (targetWidth - fitW) / 2;
        const fitY = (targetHeight - fitH) / 2;

        mainCtx.drawImage(clipCanvas, fitX, fitY, fitW, fitH);
      }
      mainCtx.restore();

      const timestampMicros = Math.round((globalFrameIndex * 1_000_000) / fps);
      const durationMicros = Math.round(1_000_000 / fps);

      const videoFrame = new VideoFrame(mainCanvas, {
        timestamp: timestampMicros,
        duration: durationMicros,
      });

      const isKeyframe = globalFrameIndex % (fps * 2) === 0;
      encoder.encode(videoFrame, { keyFrame: isKeyframe });
      videoFrame.close();

      globalFrameIndex++;

      if (globalFrameIndex % 6 === 0) {
        await yieldThread();
      }
    }

    if (onProgress) {
      const overallPercent = Math.round(((clipIdx + 1) / totalClips) * 100);
      onProgress(overallPercent, clipIdx + 1, totalClips);
    }
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const buffer = muxer.target.buffer;
  const blob = new Blob([buffer], { type: 'video/mp4' });
  const base64 = arrayBufferToBase64(buffer);
  const renderTimeMs = Math.round(performance.now() - startTime);

  return {
    blob,
    base64,
    mimeType: 'video/mp4',
    durationSec: totalCalculatedDuration,
    frames: globalFrameIndex,
    sizeBytes: buffer.byteLength,
    renderTimeMs,
    width: targetWidth,
    height: targetHeight,
  };
}

/**
 * Tạo nội dung Manifest JSON cho dự án (Đợt 5A: truyền totalPromptCount đúng để STT khớp 100% với tên file tải)
 */
export function buildManifestJson(
  projectName: string,
  items: QueueItem[],
  opts: RenderClipOptions,
  includeStillFiles = false,
  formatMap?: Record<string, 'mp4' | 'webm'>,
  totalPromptCount = 10
): string {
  const manifestItems: ExportManifestItem[] = items.map((item) => {
    const variant = item.variants[item.selectedVariantIndex] || item.variants[0];
    const { width, height } = getExportDimensions(item.promptItem.aspectRatio, opts.resolution);
    const config = item.effectConfig || {
      camera: { move: 'zoom_in', intensity: 0.4, easing: 'easeInOut' },
      parallax: { enabled: false, direction: 'in', depth: 0.5, subjectBreath: true, subjectFloat: false },
      overlays: [],
      durationSec: 6,
      fadeInOut: true,
      seed: 12345,
      source: 'default',
    };

    const ext = (formatMap && formatMap[item.id]) || 'mp4';
    const actualVideoFile = buildFilename(
      projectName,
      item.promptItem.order,
      item.promptItem.title,
      ext,
      item.promptItem.prompt,
      item.translatedPrompt || variant?.translatedPrompt,
      totalPromptCount
    );

    const actualStillFile = includeStillFiles
      ? buildFilename(
          projectName,
          item.promptItem.order,
          item.promptItem.title,
          'jpg',
          item.promptItem.prompt,
          item.translatedPrompt || variant?.translatedPrompt,
          totalPromptCount
        )
      : undefined;

    return {
      order: item.promptItem.order,
      file: actualVideoFile,
      stillFile: actualStillFile,
      title: item.promptItem.title,
      originalPrompt: item.promptItem.prompt,
      sentPrompt: item.sentPrompt || item.promptItem.prompt,
      model: variant?.modelUsed || item.activeModel,
      mediaId: variant?.mediaId || '',
      aspectRatio: item.promptItem.aspectRatio,
      dimensions: { width, height },
      fps: opts.fps,
      durationSec: config.durationSec || 6,
      effectConfig: config,
      qc: variant?.qc,
    };
  });

  const manifest = {
    projectName,
    generatedAt: new Date().toISOString(),
    resolution: opts.resolution,
    fps: opts.fps,
    totalClips: manifestItems.length,
    clips: manifestItems,
  };

  return JSON.stringify(manifest, null, 2);
}
