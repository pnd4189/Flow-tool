import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { VideoCodecSupport } from '../types';

/**
 * Kiểm tra khả năng hỗ trợ phần cứng VideoEncoder & MediaRecorder
 */
export async function checkCodecCapabilities(): Promise<VideoCodecSupport> {
  const result: VideoCodecSupport = {
    hasVideoEncoder: typeof window !== 'undefined' && 'VideoEncoder' in window,
    h264_720p: false,
    h264_1080p: false,
    mediaRecorderVp9: false,
    mediaRecorderWebm: false,
  };

  if (result.hasVideoEncoder) {
    try {
      const res720 = await VideoEncoder.isConfigSupported({
        codec: 'avc1.42001f', // H.264 Baseline Profile level 3.1
        width: 1280,
        height: 720,
        bitrate: 6_000_000,
        framerate: 24,
      });
      result.h264_720p = !!res720.supported;
    } catch {
      result.h264_720p = false;
    }

    try {
      const res1080 = await VideoEncoder.isConfigSupported({
        codec: 'avc1.640028', // H.264 High Profile level 4.0
        width: 1920,
        height: 1080,
        bitrate: 10_000_000,
        framerate: 24,
      });
      result.h264_1080p = !!res1080.supported;
    } catch {
      result.h264_1080p = false;
    }
  }

  if (typeof window !== 'undefined' && 'MediaRecorder' in window) {
    result.mediaRecorderVp9 = MediaRecorder.isTypeSupported('video/webm;codecs=vp9');
    result.mediaRecorderWebm = MediaRecorder.isTypeSupported('video/webm');
  }

  return result;
}

/**
 * Dựng 3 giây (72 frames @ 24fps) với hiệu ứng slow zoom 1.0 -> 1.15
 * và đóng gói thành MP4 bằng WebCodecs + mp4-muxer, hoặc fallback WebM
 */
export async function renderAndEncodeTestVideo(
  imageBase64: string,
  imageMimeType: string = 'image/png'
): Promise<{
  videoBase64: string;
  mimeType: 'video/mp4' | 'video/webm';
  videoUrl: string;
  encoderUsed: 'VideoEncoder (H.264 mp4-muxer)' | 'MediaRecorder (WebM VP9)' | 'MediaRecorder (WebM)';
  durationMs: number;
}> {
  const startTime = performance.now();
  const support = await checkCodecCapabilities();

  // Chuẩn bị ảnh
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = (e) => reject(new Error('Không thể tải ảnh nguồn để render video.'));
    el.src = imageBase64.startsWith('data:') ? imageBase64 : `data:${imageMimeType};base64,${imageBase64}`;
  });

  const width = 1280;
  const height = 720;
  const fps = 24;
  const durationSec = 3;
  const totalFrames = fps * durationSec; // 72 frames

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Không thể tạo 2D context cho canvas render.');

  // Hàm vẽ 1 khung hình với zoom 1.0 -> 1.15
  const drawFrame = (frameIndex: number) => {
    const progress = frameIndex / (totalFrames - 1);
    const scale = 1.0 + 0.15 * progress;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-width / 2, -height / 2);

    // Vẽ ảnh vừa khít 16:9 với crop cover
    const imgRatio = (img.naturalWidth || width) / (img.naturalHeight || height);
    const canvasRatio = width / height;
    let sWidth = img.naturalWidth || width;
    let sHeight = img.naturalHeight || height;
    let sx = 0;
    let sy = 0;

    if (imgRatio > canvasRatio) {
      sWidth = (img.naturalHeight || height) * canvasRatio;
      sx = ((img.naturalWidth || width) - sWidth) / 2;
    } else {
      sHeight = (img.naturalWidth || width) / canvasRatio;
      sy = ((img.naturalHeight || height) - sHeight) / 2;
    }

    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, width, height);
    ctx.restore();
  };

  // 1. Thử dùng WebCodecs H.264 + mp4-muxer nếu hỗ trợ
  if (support.hasVideoEncoder && support.h264_720p) {
    try {
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
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
          encodeError = e instanceof Error ? e : new Error(String(e));
        },
      });

      encoder.configure({
        codec: 'avc1.42001f',
        width,
        height,
        bitrate: 6_000_000,
        framerate: fps,
      });

      for (let i = 0; i < totalFrames; i++) {
        if (encodeError) throw encodeError;
        drawFrame(i);
        const timestamp = (i * 1_000_000) / fps; // microsecond
        const frame = new VideoFrame(canvas, {
          timestamp,
          duration: 1_000_000 / fps,
        });
        const keyFrame = i % 24 === 0;
        encoder.encode(frame, { keyFrame });
        frame.close();
      }

      await encoder.flush();
      encoder.close();
      muxer.finalize();

      const buffer = muxer.target.buffer;
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
      }
      const videoBase64 = btoa(binary);
      const blob = new Blob([buffer], { type: 'video/mp4' });
      const videoUrl = URL.createObjectURL(blob);
      const durationMs = Math.round(performance.now() - startTime);

      return {
        videoBase64,
        mimeType: 'video/mp4',
        videoUrl,
        encoderUsed: 'VideoEncoder (H.264 mp4-muxer)',
        durationMs,
      };
    } catch (err) {
      console.warn('WebCodecs H.264 failed, falling back to MediaRecorder:', err);
    }
  }

  // 2. Fallback MediaRecorder WebM (VP9 hoặc chuẩn WebM)
  const mimeTypeChoice = support.mediaRecorderVp9
    ? 'video/webm;codecs=vp9'
    : support.mediaRecorderWebm
    ? 'video/webm'
    : 'video/webm';

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: mimeTypeChoice });
  const chunks: Blob[] = [];

  const recordPromise = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };
    recorder.onerror = (e) => reject((e as any).error || new Error('MediaRecorder lỗi.'));
  });

  recorder.start();

  // Render từng frame khớp thời gian
  for (let i = 0; i < totalFrames; i++) {
    drawFrame(i);
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }

  recorder.stop();
  const webmBlob = await recordPromise;

  const arrayBuffer = await webmBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  const videoBase64 = btoa(binary);
  const videoUrl = URL.createObjectURL(webmBlob);
  const durationMs = Math.round(performance.now() - startTime);

  return {
    videoBase64,
    mimeType: 'video/webm',
    videoUrl,
    encoderUsed: support.mediaRecorderVp9 ? 'MediaRecorder (WebM VP9)' : 'MediaRecorder (WebM)',
    durationMs,
  };
}
