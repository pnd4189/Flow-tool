import { Flow } from 'flow-sdk';
import { detectFaceContours } from './faceSlimService';
import { segmentCandidatesAtPoint } from './segmentationService';

export interface BodyPoint {
  x: number; // 0..1
  y: number; // 0..1
}

const pointsCache = new WeakMap<HTMLCanvasElement, { w: number; h: number; promise: Promise<BodyPoint[]> }>();

/**
 * Phát hiện các điểm then chốt bên trong thân người chính:
 * Thu nhỏ ảnh tối đa 1024px JPEG, gọi Flow.generate.text với thinkingLevel 'low', timeout 60s.
 * Nhận 4-6 điểm bên trong cơ thể (ngực, bụng, đùi trái/phải, cánh tay trên trái/phải).
 * Chuyển đổi về toạ độ chuẩn hoá 0..1, tối đa 6 điểm.
 * Lỗi hoặc timeout trả về [] (không throw).
 */
export async function detectPersonBodyPoints(
  sourceCanvas: HTMLCanvasElement
): Promise<BodyPoint[]> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (w <= 0 || h <= 0) return [];

  const cached = pointsCache.get(sourceCanvas);
  if (cached && cached.w === w && cached.h === h) {
    return cached.promise;
  }

  const taskPromise = (async (): Promise<BodyPoint[]> => {
    try {
      const maxDim = 1024;
      let sampleCanvas = sourceCanvas;
      if (Math.max(w, h) > maxDim) {
        const scale = maxDim / Math.max(w, h);
        sampleCanvas = document.createElement('canvas');
        sampleCanvas.width = Math.max(1, Math.round(w * scale));
        sampleCanvas.height = Math.max(1, Math.round(h * scale));
        const sCtx = sampleCanvas.getContext('2d');
        if (sCtx) {
          sCtx.drawImage(sourceCanvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
        }
      }

      const dataUrl = sampleCanvas.toDataURL('image/jpeg', 0.88);
      const base64 = dataUrl.split(',')[1];

      const prompt = `Xác định các điểm toạ độ nằm CHẮC CHẮN bên trong thân người chính (người to nhất/trung tâm) trong ảnh.
Trả về DUY NHẤT một mảng JSON thuần túy theo mẫu (không markdown, không code block, không giải thích):
[
  {"x": 500, "y": 450}
]
Toạ độ x, y chuẩn hoá từ 0 đến 1000 theo chiều rộng và chiều cao ảnh.
Cần 4 đến 6 điểm nằm sâu bên trong cơ thể:
- giữa ngực
- giữa bụng
- giữa đùi trái (nếu có trong ảnh)
- giữa đùi phải (nếu có trong ảnh)
- giữa cánh tay trên trái / bắp tay trái (nếu có trong ảnh)
- giữa cánh tay trên phải / bắp tay phải (nếu có trong ảnh)
Bỏ qua bất kỳ bộ phận nào bị khuất hoặc nằm ngoài khung hình.
Mỗi điểm phải cách mép/viền cơ thể ít nhất 3-5% để đảm bảo 100% nằm trúng người, không rơi vào nền.
Nếu không có người trong ảnh, trả về đúng: []`;

      const systemInstruction =
        'Bạn là chuyên gia phân tích tư thế người và thị giác máy tính. Chỉ trả về JSON mảng toạ độ x, y từ 0 đến 1000.';

      const TIMEOUT_MS = 60000;
      let timeoutId: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('Hết thời gian phát hiện điểm thân người (60s).'));
        }, TIMEOUT_MS);
      });

      const requestPromise = Flow.generate.text(prompt, {
        systemInstruction,
        thinkingLevel: 'low',
        images: [{ base64, mimeType: 'image/jpeg' }],
      });

      let response: { text: string };
      try {
        response = await Promise.race([requestPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }

      const rawText = (response.text || '').trim();
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed) || parsed.length === 0) return [];

      const points: BodyPoint[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const x = (item as any).x;
        const y = (item as any).y;
        if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
          if (x >= 0 && x <= 1000 && y >= 0 && y <= 1000) {
            points.push({
              x: x / 1000,
              y: y / 1000,
            });
          }
        }
      }

      return points.slice(0, 6);
    } catch {
      return [];
    }
  })();

  pointsCache.set(sourceCanvas, { w, h, promise: taskPromise });

  taskPromise.then((pts) => {
    if (pts.length === 0) {
      const cur = pointsCache.get(sourceCanvas);
      if (cur && cur.promise === taskPromise) {
        pointsCache.delete(sourceCanvas);
      }
    }
  }).catch(() => {
    const cur = pointsCache.get(sourceCanvas);
    if (cur && cur.promise === taskPromise) {
      pointsCache.delete(sourceCanvas);
    }
  });

  return taskPromise;
}

/**
 * Tự động khoanh toàn thân người bằng SlimSAM kết hợp điểm mốc mặt và điểm thân người.
 * Dùng chung giữa QuickFixPanel và RightSidebar.
 */
export async function autoSelectPersonMask(
  sourceCanvas: HTMLCanvasElement,
  documentRevision: string | number,
  onLog: (msg: string) => void
): Promise<HTMLCanvasElement> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (w <= 0 || h <= 0) throw new Error('Chưa có ảnh.');

  onLog('Chưa có vùng chọn: đang tự động quét người và các điểm thân thể...');
  let normX = 0.5;
  let normY = 0.55;

  // Chạy song song phát hiện đường viền mặt và các điểm thân thể (Promise.allSettled)
  const [faceSettled, bodyPointsSettled] = await Promise.allSettled([
    detectFaceContours(sourceCanvas),
    detectPersonBodyPoints(sourceCanvas),
  ]);

  if (faceSettled.status === 'fulfilled' && faceSettled.value.length > 0) {
    const f = faceSettled.value[0];
    const D = f.chinY - f.eyeY;
    normX = f.noseX / w;
    normY = Math.min(0.9, (f.chinY + 1.5 * D) / h);
  }

  const bodyPoints =
    bodyPointsSettled.status === 'fulfilled' ? bodyPointsSettled.value : [];

  const totalImagePixels = w * h;
  const maxAllowedPixels = totalImagePixels * 0.85;

  try {
    if (bodyPoints.length > 0) {
      onLog(`Đã phát hiện ${bodyPoints.length} điểm thân người. Đang gọi SlimSAM phân đoạn toàn thân...`);
      const candidates = await segmentCandidatesAtPoint(
        sourceCanvas,
        normX,
        normY,
        (msg) => onLog(msg),
        documentRevision,
        bodyPoints
      );

      if (candidates.length === 0) {
        throw new Error('SlimSAM không tìm thấy vùng người.');
      }

      // Tạo danh sách tất cả các điểm prompt (điểm chính + các điểm thân)
      const allPromptPoints = [{ x: normX, y: normY }, ...bodyPoints];
      const nPoints = allPromptPoints.length;

      // Đếm số điểm prompt được chứa và đếm nativeCount ở độ phân giải gốc
      interface EvaluatedCandidate {
        candidate: (typeof candidates)[0];
        containedCount: number;
        nativeCount: number;
      }

      const evaluated: EvaluatedCandidate[] = candidates.map((cand) => {
        const cCtx = cand.canvas.getContext('2d', { willReadFrequently: true });
        if (!cCtx) {
          return { candidate: cand, containedCount: 0, nativeCount: 0 };
        }
        const cData = cCtx.getImageData(0, 0, w, h).data;
        let contained = 0;
        let nativeCount = 0;

        // Đếm pixel > 127 trên toàn bộ ảnh gốc
        for (let i = 0; i < cData.length; i += 4) {
          if (cData[i] > 127) {
            nativeCount++;
          }
        }

        // Đếm số điểm prompt được chứa
        for (const pt of allPromptPoints) {
          const px = Math.round(Math.min(Math.max(pt.x, 0), 1) * (w - 1));
          const py = Math.round(Math.min(Math.max(pt.y, 0), 1) * (h - 1));
          const idx = (py * w + px) * 4;
          if (cData[idx] > 127) {
            contained++;
          }
        }

        return {
          candidate: cand,
          containedCount: contained,
          nativeCount,
        };
      });

      // Lọc các ứng viên có diện tích < 85% ảnh dựa trên nativeCount
      const eligibleCandidates = evaluated.filter((e) => e.nativeCount < maxAllowedPixels);
      const pool = eligibleCandidates.length > 0 ? eligibleCandidates : evaluated;

      // Sắp xếp: chứa nhiều điểm prompt nhất trước; nếu hoà lấy diện tích lớn hơn theo nativeCount
      pool.sort((a, b) => {
        if (b.containedCount !== a.containedCount) {
          return b.containedCount - a.containedCount;
        }
        return b.nativeCount - a.nativeCount;
      });

      const chosen = pool[0];
      const ratioPercent = ((chosen.nativeCount / totalImagePixels) * 100).toFixed(1);

      onLog(
        `Tự khoanh người: ${nPoints} điểm, mặt nạ ${ratioPercent}% ảnh, chứa ${chosen.containedCount}/${nPoints} điểm`
      );

      return chosen.candidate.canvas;
    } else {
      // Fallback: không có điểm thân (AI lỗi/timeout) -> chạy phân đoạn 1 điểm chính
      onLog('Không có điểm thân: chạy phân đoạn 1 điểm chính...');
      const candidates = await segmentCandidatesAtPoint(
        sourceCanvas,
        normX,
        normY,
        (msg) => onLog(msg),
        documentRevision
      );

      if (candidates.length === 0) {
        throw new Error('SlimSAM không tìm thấy vùng người.');
      }

      // Đếm nativeCount cho từng ứng viên ở độ phân giải gốc
      interface EvaluatedSingleCandidate {
        candidate: (typeof candidates)[0];
        nativeCount: number;
      }

      const evaluatedSingle: EvaluatedSingleCandidate[] = candidates.map((cand) => {
        const cCtx = cand.canvas.getContext('2d', { willReadFrequently: true });
        if (!cCtx) {
          return { candidate: cand, nativeCount: 0 };
        }
        const cData = cCtx.getImageData(0, 0, w, h).data;
        let nativeCount = 0;
        for (let i = 0; i < cData.length; i += 4) {
          if (cData[i] > 127) {
            nativeCount++;
          }
        }
        return { candidate: cand, nativeCount };
      });

      const eligible = evaluatedSingle.filter((c) => c.nativeCount < maxAllowedPixels);
      const pool = eligible.length > 0 ? eligible : evaluatedSingle;
      const largest = pool.reduce((max, c) => (c.nativeCount > max.nativeCount ? c : max), pool[0]);

      const ratioPercent = ((largest.nativeCount / totalImagePixels) * 100).toFixed(1);
      onLog(`Tự khoanh người: 1 điểm, mặt nạ ${ratioPercent}% ảnh`);

      return largest.candidate.canvas;
    }
  } catch (err: any) {
    throw new Error(
      `Không thể tự động chọn người: ${err?.message || err}. Vui lòng dùng cọ hoặc Bút chọn để chọn chủ thể trước.`
    );
  }
}
