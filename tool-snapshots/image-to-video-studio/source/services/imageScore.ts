export interface ImageQualityMetrics {
  sharpness: number;    // Phương sai Laplacian trên ảnh xám
  contrast: number;     // Độ lệch chuẩn độ sáng
  exposure: number;     // Điểm phơi sáng (phạt khi quá tối/sáng, lý tưởng quanh 0.45)
  colorfulness: number; // Hasler-Süsstrunk colorfulness
}

export interface ImageScoreResult {
  sceneId: string;
  rawMetrics: ImageQualityMetrics;
  score: number;        // Điểm 0 - 100 sau khi chuẩn hoá min-max trong tập
  dHash: string;        // 64-bit dHash dạng hex chuỗi 16 ký tự
}

// Bộ nhớ cache cục bộ theo key = `${sceneId}_${sig}`
interface CacheEntry {
  rawMetrics: ImageQualityMetrics;
  dHash: string;
}

const scoreCache = new Map<string, CacheEntry>();

/**
 * Tạo chữ ký ngắn cho ảnh từ độ dài và một số byte mẫu để kiểm tra thay đổi
 */
function getImageSignature(base64: string): string {
  const len = base64.length;
  if (len < 64) return base64;
  const head = base64.slice(0, 16);
  const mid = base64.slice(Math.floor(len / 2) - 8, Math.floor(len / 2) + 8);
  const tail = base64.slice(-16);
  return `${len}_${head}_${mid}_${tail}`;
}

/**
 * Tải ảnh vào HTMLImageElement
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không thể tải ảnh để chấm điểm'));
    img.src = src;
  });
}

/**
 * Tính dHash 64-bit từ canvas 9x8 ảnh xám.
 * Mỗi hàng so sánh pixel[x] > pixel[x+1] để tạo 8 bit -> 8 hàng = 64 bit -> 16 ký tự hex.
 */
function computeDHash(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '0000000000000000';

  ctx.drawImage(img, 0, 0, 9, 8);
  const imgData = ctx.getImageData(0, 0, 9, 8);
  const data = imgData.data;

  // Chuyển sang ảnh xám 9x8
  const gray: number[][] = [];
  for (let y = 0; y < 8; y++) {
    const row: number[] = [];
    for (let x = 0; x < 9; x++) {
      const idx = (y * 9 + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // Luminance Y = 0.299R + 0.587G + 0.114B
      row.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
    gray.push(row);
  }

  canvas.width = 0;
  canvas.height = 0;

  // Tạo 64 bit
  let hexResult = '';
  for (let y = 0; y < 8; y++) {
    let byteVal = 0;
    for (let x = 0; x < 8; x++) {
      if (gray[y][x] > gray[y][x + 1]) {
        byteVal |= 1 << (7 - x);
      }
    }
    hexResult += byteVal.toString(16).padStart(2, '0');
  }

  return hexResult;
}

/**
 * Tính khoảng cách Hamming giữa hai chuỗi dHash 16 ký tự hex (64 bit)
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (!hash1 || !hash2) return 64;
  let dist = 0;
  const len = Math.min(hash1.length, hash2.length);
  for (let i = 0; i < len; i += 2) {
    const b1 = parseInt(hash1.slice(i, i + 2), 16) || 0;
    const b2 = parseInt(hash2.slice(i, i + 2), 16) || 0;
    let xor = b1 ^ b2;
    // Đếm số bit 1
    while (xor > 0) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

/**
 * Tính các chỉ số thô (sharpness, contrast, exposure, colorfulness) bằng cách vẽ vào canvas chiều rộng 160px
 */
function analyzeImagePixels(img: HTMLImageElement): { rawMetrics: ImageQualityMetrics; dHash: string } {
  const dHash = computeDHash(img);

  const targetW = 160;
  const targetH = Math.max(1, Math.round((targetW * img.naturalHeight) / img.naturalWidth));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      rawMetrics: { sharpness: 0, contrast: 0, exposure: 0.5, colorfulness: 0 },
      dHash,
    };
  }

  ctx.drawImage(img, 0, 0, targetW, targetH);
  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const data = imgData.data;
  const pixelCount = targetW * targetH;

  // 1. Phơi sáng & Độ tương phản & Màu sắc (Hasler-Süsstrunk)
  let sumL = 0;
  let sumL2 = 0;

  // rgb rg, yb diffs for colorfulness
  // Hasler-Süsstrunk: rg = R - G, yb = 0.5*(R + G) - B
  let sumRg = 0;
  let sumRg2 = 0;
  let sumYb = 0;
  let sumYb2 = 0;

  const grayGrid: Float32Array = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    grayGrid[i] = lum;

    sumL += lum;
    sumL2 += lum * lum;

    const rg = r - g;
    const yb = 0.5 * (r + g) - b;

    sumRg += rg;
    sumRg2 += rg * rg;
    sumYb += yb;
    sumYb2 += yb * yb;
  }

  const meanL = sumL / pixelCount;
  const varianceL = Math.max(0, sumL2 / pixelCount - meanL * meanL);
  const stdL = Math.sqrt(varianceL); // Contrast

  // Điểm phơi sáng: phạt khi meanL xa mốc lý tưởng 0.45 (0.0 đến 1.0)
  // Exposure score = max(0, 1 - 2.5 * |meanL - 0.45|)
  const exposureScore = Math.max(0, 1 - 2.5 * Math.abs(meanL - 0.45));

  // Colorfulness Hasler-Süsstrunk:
  // sigma_rg = std(rg), mu_rg = mean(rg)
  // sigma_yb = std(yb), mu_yb = mean(yb)
  // colorfulness = sqrt(sigma_rg^2 + sigma_yb^2) + 0.3 * sqrt(mu_rg^2 + mu_yb^2)
  const meanRg = sumRg / pixelCount;
  const varRg = Math.max(0, sumRg2 / pixelCount - meanRg * meanRg);
  const stdRg = Math.sqrt(varRg);

  const meanYb = sumYb / pixelCount;
  const varYb = Math.max(0, sumYb2 / pixelCount - meanYb * meanYb);
  const stdYb = Math.sqrt(varYb);

  const sigmaRgyb = Math.sqrt(stdRg * stdRg + stdYb * stdYb);
  const muRgyb = Math.sqrt(meanRg * meanRg + meanYb * meanYb);
  const colorfulness = sigmaRgyb + 0.3 * muRgyb;

  // 2. Độ nét: Phương sai của toán tử Laplacian trên ảnh xám
  // Kernel 3x3:
  // [  0,  1,  0 ]
  // [  1, -4,  1 ]
  // [  0,  1,  0 ]
  let sumLap = 0;
  let sumLap2 = 0;
  let lapCount = 0;

  for (let y = 1; y < targetH - 1; y++) {
    const rowOffset = y * targetW;
    for (let x = 1; x < targetW - 1; x++) {
      const idx = rowOffset + x;
      const center = grayGrid[idx];
      const top = grayGrid[idx - targetW];
      const bottom = grayGrid[idx + targetW];
      const left = grayGrid[idx - 1];
      const right = grayGrid[idx + 1];

      const lap = top + bottom + left + right - 4 * center;
      sumLap += lap;
      sumLap2 += lap * lap;
      lapCount++;
    }
  }

  const meanLap = lapCount > 0 ? sumLap / lapCount : 0;
  const laplaceVariance = lapCount > 0 ? Math.max(0, sumLap2 / lapCount - meanLap * meanLap) : 0;

  canvas.width = 0;
  canvas.height = 0;

  return {
    rawMetrics: {
      sharpness: laplaceVariance * 1000, // Nhân scale cho dễ nhìn
      contrast: stdL,
      exposure: exposureScore,
      colorfulness: colorfulness,
    },
    dHash,
  };
}

/**
 * Chấm điểm chất lượng từng ảnh thô hoặc lấy từ cache
 */
export async function getSingleImageRawMetrics(
  sceneId: string,
  base64OrThumb: string,
  mimeType: string = 'image/jpeg'
): Promise<{ rawMetrics: ImageQualityMetrics; dHash: string }> {
  const sig = getImageSignature(base64OrThumb);
  const cacheKey = `${sceneId}_${sig}`;

  const cached = scoreCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const src = base64OrThumb.startsWith('data:')
    ? base64OrThumb
    : `data:${mimeType};base64,${base64OrThumb}`;

  const img = await loadImage(src);
  const result = analyzeImagePixels(img);

  scoreCache.set(cacheKey, result);
  return result;
}

/**
 * Chấm điểm toàn bộ danh sách ảnh theo từng đợt (batch) để nhường luồng UI,
 * sau đó chuẩn hoá điểm min-max trên toàn tập:
 * Trọng số: nét 0.4, tương phản 0.25, phơi sáng 0.2, màu 0.15.
 * Trả về Map<sceneId, ImageScoreResult>.
 */
export async function evaluateScenesQuality(
  scenes: Array<{ id: string; result?: { base64: string; thumbBase64?: string; mimeType: string } }>,
  options?: {
    batchSize?: number;
    onProgress?: (current: number, total: number) => void;
    signal?: { aborted: boolean };
  }
): Promise<Map<string, ImageScoreResult>> {
  const validScenes = scenes.filter(s => !!s.result);
  const total = validScenes.length;
  const resultMap = new Map<string, ImageScoreResult>();

  if (total === 0) return resultMap;

  const batchSize = options?.batchSize || 6;
  const rawList: Array<{ sceneId: string; rawMetrics: ImageQualityMetrics; dHash: string }> = [];

  for (let i = 0; i < total; i += batchSize) {
    if (options?.signal?.aborted) {
      throw new Error('Đã huỷ chấm điểm ảnh');
    }

    const chunk = validScenes.slice(i, i + batchSize);
    await Promise.all(
      chunk.map(async scene => {
        const base64Data = scene.result!.thumbBase64 || scene.result!.base64;
        const metrics = await getSingleImageRawMetrics(scene.id, base64Data, scene.result!.mimeType);
        rawList.push({
          sceneId: scene.id,
          rawMetrics: metrics.rawMetrics,
          dHash: metrics.dHash,
        });
      })
    );

    if (options?.onProgress) {
      options.onProgress(Math.min(i + batchSize, total), total);
    }

    // Nhường luồng giao diện để browser vẽ và xử lý tương tác
    await new Promise(r => setTimeout(r, 20));
  }

  // Chuẩn hoá min-max trên toàn tập cho từng metric
  let minSharp = Infinity, maxSharp = -Infinity;
  let minCont = Infinity, maxCont = -Infinity;
  let minExp = Infinity, maxExp = -Infinity;
  let minColor = Infinity, maxColor = -Infinity;

  rawList.forEach(item => {
    const { sharpness, contrast, exposure, colorfulness } = item.rawMetrics;
    if (sharpness < minSharp) minSharp = sharpness;
    if (sharpness > maxSharp) maxSharp = sharpness;

    if (contrast < minCont) minCont = contrast;
    if (contrast > maxCont) maxCont = contrast;

    if (exposure < minExp) minExp = exposure;
    if (exposure > maxExp) maxExp = exposure;

    if (colorfulness < minColor) minColor = colorfulness;
    if (colorfulness > maxColor) maxColor = colorfulness;
  });

  const norm = (val: number, min: number, max: number): number => {
    if (max - min < 1e-6) return 0.5; // Nếu bằng nhau cho 0.5
    return Math.max(0, Math.min(1, (val - min) / (max - min)));
  };

  rawList.forEach(item => {
    const sNorm = norm(item.rawMetrics.sharpness, minSharp, maxSharp);
    const cNorm = norm(item.rawMetrics.contrast, minCont, maxCont);
    const eNorm = norm(item.rawMetrics.exposure, minExp, maxExp);
    const colNorm = norm(item.rawMetrics.colorfulness, minColor, maxColor);

    // Trọng số: nét 0.4, tương phản 0.25, phơi sáng 0.2, màu 0.15
    const combined = sNorm * 0.4 + cNorm * 0.25 + eNorm * 0.2 + colNorm * 0.15;
    const finalScore = Math.round(combined * 100);

    resultMap.set(item.sceneId, {
      sceneId: item.sceneId,
      rawMetrics: item.rawMetrics,
      score: Math.max(1, Math.min(100, finalScore)),
      dHash: item.dHash,
    });
  });

  return resultMap;
}
