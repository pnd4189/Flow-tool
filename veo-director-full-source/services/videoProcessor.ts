import { 
  Input, Output, Conversion, 
  Mp4OutputFormat, BufferTarget, BlobSource, ALL_FORMATS,
  VideoSample
} from 'mediabunny';
import { registerAc3Decoder, registerAc3Encoder } from '@mediabunny/ac3';

let encodersInitialized = false;

async function initEncoders() {
  if (encodersInitialized) return;
  try {
    registerAc3Decoder();
    registerAc3Encoder();
    encodersInitialized = true;
  } catch (e) {
    console.warn('Encoder initialization skipped', e);
  }
}

export async function cropWatermark(
  base64: string,
  onProgress: (p: number) => void
): Promise<string> {
  await initEncoders();

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'video/mp4' });

  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  const TARGET_W = 1280;
  const TARGET_H = 720;
  const SAFE_W = TARGET_W - 120;
  const SAFE_H = TARGET_H - 65;

  let ctx: OffscreenCanvasRenderingContext2D | null = null;

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      width: TARGET_W,
      height: TARGET_H,
      fit: 'fill', 
      process: (sample: VideoSample) => {
        if (!ctx) {
          const canvas = new OffscreenCanvas(TARGET_W, TARGET_H);
          ctx = canvas.getContext('2d')!;
        }
        const scaleX = TARGET_W / SAFE_W;
        const scaleY = TARGET_H / SAFE_H;
        const scale = Math.max(scaleX, scaleY);
        ctx.clearRect(0, 0, TARGET_W, TARGET_H);
        sample.draw(ctx, 0, 0, TARGET_W * scale, TARGET_H * scale);
        return ctx.canvas;
      }
    }
  });

  if (!conversion.isValid) throw new Error('Init failed.');
  conversion.onProgress = onProgress;
  await conversion.execute();
  
  const buffer = output.target.buffer!;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(new Blob([buffer], { type: 'video/mp4' }));
  });
}