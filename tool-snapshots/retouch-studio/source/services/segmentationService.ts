import { CandidateMask } from '../types';

export const SLIMSAM_MODEL_ID = 'Xenova/slimsam-77-uniform';
export const SLIMSAM_REVISION = '5850ab45f587c112167512ffef949107115e26a0';
export const TRANSFORMERS_BUNDLE_URL =
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

interface TransformersModule {
  SamModel: {
    from_pretrained(modelId: string, options?: Record<string, unknown>): Promise<any>;
  };
  AutoProcessor: {
    from_pretrained(modelId: string, options?: Record<string, unknown>): Promise<any>;
  };
  RawImage: {
    read(urlOrBlob: string | Blob): Promise<any>;
    fromCanvas?(canvas: HTMLCanvasElement): Promise<any>;
  };
  env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    backends: {
      onnx: {
        wasm: {
          numThreads: number;
          wasmPaths?: string | Record<string, string>;
        };
      };
    };
  };
}

let transformersModulePromise: Promise<TransformersModule> | null = null;

async function loadTransformersModule(): Promise<TransformersModule> {
  if (!transformersModulePromise) {
    transformersModulePromise = (async () => {
      const moduleUrl = TRANSFORMERS_BUNDLE_URL;
      const mod = await import(/* @vite-ignore */ moduleUrl);

      if (!mod.SamModel || !mod.AutoProcessor || !mod.RawImage) {
        throw new Error('Gói transformers không chứa SamModel, AutoProcessor hoặc RawImage.');
      }

      mod.env.allowLocalModels = false;
      mod.env.useBrowserCache = false;
      if (mod.env.backends?.onnx?.wasm) {
        mod.env.backends.onnx.wasm.numThreads = 1;
        mod.env.backends.onnx.wasm.wasmPaths =
          'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';
      }

      return mod as TransformersModule;
    })().catch((err) => {
      transformersModulePromise = null;
      throw err;
    });
  }
  return transformersModulePromise;
}

let samModel: any = null;
let samProcessor: any = null;
let loadPromise: Promise<{ model: any; processor: any; RawImage: any }> | null = null;
let inferenceQueue: Promise<unknown> = Promise.resolve();

interface CachedImageEmbedding {
  sourceRef: HTMLCanvasElement;
  revision: string | number;
  imageBlobUrl: string;
  rawImage: any;
  embeddingsObject: {
    image_embeddings: any;
    image_positional_embeddings?: any;
    [key: string]: any;
  };
  reshaped_input_sizes: any;
  original_sizes: any;
  processedW: number;
  processedH: number;
  scaleX: number;
  scaleY: number;
}

let currentImageCache: CachedImageEmbedding | null = null;

function disposeTensor(t: any): void {
  if (t && typeof t.dispose === 'function') {
    try {
      t.dispose();
    } catch {
      // ignore
    }
  }
}

export function invalidateSegmentationCache(): void {
  if (currentImageCache) {
    if (currentImageCache.imageBlobUrl) {
      try {
        URL.revokeObjectURL(currentImageCache.imageBlobUrl);
      } catch {
        // ignore
      }
    }
    if (currentImageCache.embeddingsObject) {
      for (const key of Object.keys(currentImageCache.embeddingsObject)) {
        disposeTensor(currentImageCache.embeddingsObject[key]);
      }
    }
    currentImageCache = null;
  }
}

let lastReportedProgressPct = -1;
let lastReportedFile = '';

export async function getSlimSamEngine(
  onProgress?: (msg: string) => void
): Promise<{ model: any; processor: any; RawImage: any }> {
  if (samModel && samProcessor) {
    const mod = await loadTransformersModule();
    return { model: samModel, processor: samProcessor, RawImage: mod.RawImage };
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      onProgress?.('Đang tải Transformers.js Web runtime (WASM CPU)...');
      const mod = await loadTransformersModule();

      const options = {
        revision: SLIMSAM_REVISION,
        device: 'wasm',
        dtype: 'q8',
        progress_callback: (item: any) => {
          if (!item) return;
          if (item.status === 'progress' && item.file && typeof item.progress === 'number') {
            const pct = Math.round(item.progress);
            if (item.file !== lastReportedFile || pct >= lastReportedProgressPct + 5 || pct === 100) {
              lastReportedFile = item.file;
              lastReportedProgressPct = pct;
              onProgress?.(`Đang tải ${item.file}: ${pct}%`);
            }
          } else if (item.status === 'initiate') {
            lastReportedProgressPct = -1;
            lastReportedFile = item.file || '';
            onProgress?.(`Bắt đầu tải ${item.file || 'mô hình'}...`);
          } else if (item.status === 'done') {
            onProgress?.(`Hoàn thành ${item.file || 'mô hình'}.`);
          }
        },
      };

      onProgress?.('Đang tải mô hình SlimSAM (vision_encoder_quantized & prompt_decoder)...');
      const [model, processor] = await Promise.all([
        mod.SamModel.from_pretrained(SLIMSAM_MODEL_ID, options),
        mod.AutoProcessor.from_pretrained(SLIMSAM_MODEL_ID, options),
      ]);

      samModel = model;
      samProcessor = processor;
      onProgress?.('Khởi tạo SlimSAM CPU thành công.');

      return { model: samModel, processor: samProcessor, RawImage: mod.RawImage };
    } catch (err) {
      loadPromise = null;
      samModel = null;
      samProcessor = null;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Không thể khởi tạo mô hình SlimSAM WASM CPU: ${msg}`);
    }
  })();

  return loadPromise;
}

function prepareInferenceCanvas(
  sourceCanvas: HTMLCanvasElement,
  maxDim = 768
): { canvas: HTMLCanvasElement; width: number; height: number; scaleX: number; scaleY: number } {
  const origW = sourceCanvas.width;
  const origH = sourceCanvas.height;

  if (Math.max(origW, origH) <= maxDim) {
    return { canvas: sourceCanvas, width: origW, height: origH, scaleX: 1, scaleY: 1 };
  }

  const scale = maxDim / Math.max(origW, origH);
  const targetW = Math.max(1, Math.round(origW * scale));
  const targetH = Math.max(1, Math.round(origH * scale));

  const scaled = document.createElement('canvas');
  scaled.width = targetW;
  scaled.height = targetH;
  const ctx = scaled.getContext('2d');
  if (!ctx) throw new Error('Không thể tạo canvas nội suy ảnh cho SlimSAM');
  ctx.drawImage(sourceCanvas, 0, 0, targetW, targetH);

  return {
    canvas: scaled,
    width: targetW,
    height: targetH,
    scaleX: targetW / origW,
    scaleY: targetH / origH,
  };
}

/**
 * Decodes all actual candidate masks produced by SlimSAM's 3-level prompt decoder
 * (small / medium / large) for the given point click.
 * Hỗ trợ tham số tuỳ chọn extraPoints (chuẩn hoá 0..1) cho multi-point prompt.
 */
export async function segmentCandidatesAtPoint(
  sourceCanvas: HTMLCanvasElement,
  normX: number,
  normY: number,
  onStatus?: (msg: string) => void,
  documentRevision: string | number = 0,
  extraPoints?: Array<{ x: number; y: number }>
): Promise<CandidateMask[]> {
  const origW = sourceCanvas.width;
  const origH = sourceCanvas.height;

  if (origW <= 0 || origH <= 0) {
    throw new Error('Kích thước ảnh gốc không hợp lệ.');
  }

  const clampedNormX = Math.min(Math.max(normX, 0), 1);
  const clampedNormY = Math.min(Math.max(normY, 0), 1);

  const runSerialized = async (): Promise<CandidateMask[]> => {
    const { model, processor, RawImage } = await getSlimSamEngine(onStatus);

    const prep = prepareInferenceCanvas(sourceCanvas, 768);
    const pixelX = Math.round(clampedNormX * prep.width);
    const pixelY = Math.round(clampedNormY * prep.height);

    const isCacheValid =
      currentImageCache &&
      currentImageCache.sourceRef === sourceCanvas &&
      currentImageCache.revision === documentRevision;

    if (!isCacheValid) {
      invalidateSegmentationCache();
    }

    let cachedRawImage: any = null;
    let cachedEmbeddingsObject: Record<string, any> = {};
    let reshapedInputSizes: any = null;
    let originalSizes: any = null;

    if (currentImageCache) {
      onStatus?.('Đang dùng lại embedding ảnh...');
      cachedRawImage = currentImageCache.rawImage;
      cachedEmbeddingsObject = currentImageCache.embeddingsObject;
      reshapedInputSizes = currentImageCache.reshaped_input_sizes;
      originalSizes = currentImageCache.original_sizes;
    } else {
      onStatus?.('Đang mã hóa đặc trưng ảnh (Vision Encoder CPU)...');
      const blob = await new Promise<Blob | null>((resolve) =>
        prep.canvas.toBlob(resolve, 'image/jpeg', 0.95)
      );
      if (!blob) throw new Error('Không thể tạo blob ảnh');
      const blobUrl = URL.createObjectURL(blob);

      try {
        const raw = await RawImage.read(blobUrl);
        const inputs = await processor(raw);

        const embeddingsResult = await model.get_image_embeddings({
          pixel_values: inputs.pixel_values,
        });

        reshapedInputSizes = inputs.reshaped_input_sizes;
        originalSizes = inputs.original_sizes;
        cachedRawImage = raw;
        cachedEmbeddingsObject = embeddingsResult;

        currentImageCache = {
          sourceRef: sourceCanvas,
          revision: documentRevision,
          imageBlobUrl: blobUrl,
          rawImage: raw,
          embeddingsObject: embeddingsResult,
          reshaped_input_sizes: reshapedInputSizes,
          original_sizes: originalSizes,
          processedW: prep.width,
          processedH: prep.height,
          scaleX: prep.scaleX,
          scaleY: prep.scaleY,
        };
      } catch (err) {
        URL.revokeObjectURL(blobUrl);
        throw err;
      }
    }

    onStatus?.('Đang giải mã 3 tầng mặt nạ SlimSAM (Chi tiết / Vừa / Vùng lớn)...');

    let promptInputs: any;
    if (extraPoints && extraPoints.length > 0) {
      const pointsList: Array<[number, number]> = [[pixelX, pixelY]];
      for (const pt of extraPoints) {
        const px = Math.round(Math.min(Math.max(pt.x, 0), 1) * prep.width);
        const py = Math.round(Math.min(Math.max(pt.y, 0), 1) * prep.height);
        pointsList.push([px, py]);
      }
      const labelsList = new Array(pointsList.length).fill(1);

      promptInputs = await processor(cachedRawImage, {
        input_points: [pointsList],
        input_labels: [labelsList],
      });
    } else {
      promptInputs = await processor(cachedRawImage, {
        input_points: [[[pixelX, pixelY]]],
      });
    }

    const decoderOutputs = await model({
      ...promptInputs,
      ...cachedEmbeddingsObject,
    });

    const masks = await processor.post_process_masks(
      decoderOutputs.pred_masks,
      originalSizes,
      reshapedInputSizes
    );

    if (!masks || masks.length === 0) {
      throw new Error('SlimSAM không trả về mặt nạ hợp lệ.');
    }

    const maskTensor = masks[0];
    const dims = maskTensor.dims;
    const numCandidates = dims.length === 4 ? dims[1] : dims[0];
    const maskH = dims.length === 4 ? dims[2] : dims[1];
    const maskW = dims.length === 4 ? dims[3] : dims[2];
    const maskData = maskTensor.data as Uint8Array | boolean[] | number[];

    const iouScoresTensor = decoderOutputs.iou_scores;
    const iouScoresData = iouScoresTensor?.data || [0, 0, 0];
    const planeSize = maskH * maskW;

    const rawCandidates: {
      index: number;
      canvas: HTMLCanvasElement;
      pixelCount: number;
      iouScore: number;
    }[] = [];

    for (let c = 0; c < numCandidates; c++) {
      const planeStart = c * planeSize;
      let nonZeroCount = 0;

      const inter = document.createElement('canvas');
      inter.width = maskW;
      inter.height = maskH;
      const interCtx = inter.getContext('2d');
      if (!interCtx) continue;
      const imgData = interCtx.createImageData(maskW, maskH);

      for (let i = 0; i < planeSize; i++) {
        const val = maskData[planeStart + i];
        const isFg = Boolean(val);
        const gray = isFg ? 255 : 0;
        if (isFg) nonZeroCount++;

        const pIdx = i * 4;
        imgData.data[pIdx] = gray;
        imgData.data[pIdx + 1] = gray;
        imgData.data[pIdx + 2] = gray;
        imgData.data[pIdx + 3] = 255;
      }
      interCtx.putImageData(imgData, 0, 0);

      // Rescale to native image resolution
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = origW;
      finalCanvas.height = origH;
      const fCtx = finalCanvas.getContext('2d');
      if (fCtx) {
        fCtx.imageSmoothingEnabled = true;
        fCtx.drawImage(inter, 0, 0, origW, origH);
      }

      rawCandidates.push({
        index: c,
        canvas: finalCanvas,
        pixelCount: nonZeroCount,
        iouScore: Number(iouScoresData[c] ?? 0),
      });
    }

    // Sort by pixel count ascending: small, medium, large
    rawCandidates.sort((a, b) => a.pixelCount - b.pixelCount);

    const labels: Array<{ id: 'small' | 'medium' | 'large'; label: string }> = [
      { id: 'small', label: 'Chi tiết nhỏ' },
      { id: 'medium', label: 'Bộ phận vừa' },
      { id: 'large', label: 'Vùng lớn' },
    ];

    const results: CandidateMask[] = rawCandidates.map((c, idx) => ({
      id: labels[idx]?.id || 'medium',
      label: labels[idx]?.label || `Mặt nạ ${idx + 1}`,
      canvas: c.canvas,
      pixelCount: c.pixelCount,
      iouScore: c.iouScore,
    }));

    return results;
  };

  const currentOp = inferenceQueue.then(runSerialized);
  inferenceQueue = currentOp.catch(() => {});
  return currentOp;
}

/**
 * Backward compatible single-point segmentation: picks the best candidate mask.
 */
export async function segmentAtPoint(
  sourceCanvas: HTMLCanvasElement,
  normX: number,
  normY: number,
  onStatus?: (msg: string) => void,
  documentRevision: string | number = 0
): Promise<HTMLCanvasElement> {
  const candidates = await segmentCandidatesAtPoint(
    sourceCanvas,
    normX,
    normY,
    onStatus,
    documentRevision
  );
  if (candidates.length === 0) {
    throw new Error('SlimSAM không tìm thấy mặt nạ nào.');
  }
  // Medium or highest IoU
  const preferred = candidates.find((c) => c.id === 'medium') || candidates[0];
  return preferred.canvas;
}

export async function runSlimSamCpuProbe(
  sourceCanvas: HTMLCanvasElement,
  normX: number,
  normY: number,
  onProgress?: (msg: string) => void,
  documentRevision: string | number = 0
): Promise<HTMLCanvasElement> {
  onProgress?.('Bắt đầu thử nghiệm SlimSAM WASM CPU...');
  return segmentAtPoint(sourceCanvas, normX, normY, onProgress, documentRevision);
}
