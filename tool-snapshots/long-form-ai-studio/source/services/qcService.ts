import { Flow } from 'flow-sdk';
import { QCResult, VideoTake, Character, KeyframeInfo } from './types';

/**
 * Trích 3 khung hình JPEG rộng 512px, chất lượng 0.8 từ blobUrl của video:
 * t = 0.4s, giữa clip (t = duration / 2), t = duration - 0.3s
 */
export async function extractVideoFramesForQC(
  blobUrl: string,
  durationSeconds: number
): Promise<Array<{ base64: string; timestamp: number }>> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    video.style.opacity = '0';
    video.style.position = 'absolute';
    video.style.pointerEvents = 'none';
    video.style.width = '0px';
    video.style.height = '0px';
    video.style.zIndex = '-9999';

    document.body.appendChild(video);

    const cleanup = () => {
      if (video.parentNode) {
        document.body.removeChild(video);
      }
    };

    const timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new Error('Trích khung hình video quá thời gian chờ (15s).'));
    }, 15000);

    video.onloadedmetadata = async () => {
      const dur = video.duration && !isNaN(video.duration) && video.duration > 0
        ? video.duration
        : durationSeconds;

      const t1 = Math.min(0.4, Math.max(0.1, dur * 0.1));
      const t2 = dur / 2;
      const t3 = Math.max(t1 + 0.1, dur - 0.3);

      const targetTimes = [t1, t2, t3];
      const capturedFrames: Array<{ base64: string; timestamp: number }> = [];

      try {
        for (const t of targetTimes) {
          const frameBase64 = await captureFrameAtTime(video, t);
          capturedFrames.push({ base64: frameBase64, timestamp: t });
        }
        clearTimeout(timeoutTimer);
        cleanup();
        resolve(capturedFrames);
      } catch (err) {
        clearTimeout(timeoutTimer);
        cleanup();
        reject(err);
      }
    };

    video.onerror = () => {
      clearTimeout(timeoutTimer);
      cleanup();
      reject(new Error('Không thể tải video để trích khung hình QC.'));
    };

    video.src = blobUrl;
  });
}

function captureFrameAtTime(video: HTMLVideoElement, time: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      try {
        const targetWidth = 512;
        const aspect = video.videoHeight > 0 && video.videoWidth > 0
          ? video.videoHeight / video.videoWidth
          : 9 / 16;
        const targetHeight = Math.round(targetWidth * aspect);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Không khởi tạo được canvas 2D'));
          return;
        }

        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64 = dataUrl.split(',')[1] || '';
        resolve(base64);
      } catch (err) {
        reject(err);
      }
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = Math.max(0, time);
  });
}

/**
 * Đánh giá chất lượng 2D animation bằng Flow.generate.text (Gemini 2.5 Flash, 0 credit)
 * Thang mốc chuẩn:
 * 95 = hoàn hảo có thể phát sóng
 * 85 = lỗi rất nhỏ khó nhận ra
 * 75 = lỗi nhỏ nhìn kỹ mới thấy, chấp nhận được
 * 60 = lỗi thấy rõ (mặt/tay biến dạng, nhân vật đổi màu áo, trôi sang 3D)
 * 40 = hỏng nặng
 */
export async function evaluateTakeQC(params: {
  take: VideoTake;
  actionText: string;
  lookLabel: string;
  characters: Character[];
  startKeyframe?: KeyframeInfo;
  endKeyframe?: KeyframeInfo;
}): Promise<QCResult> {
  const { take, actionText, lookLabel, characters, startKeyframe, endKeyframe } = params;

  if (!take.blobUrl) {
    throw new Error('Take chưa có blobUrl để trích khung hình kiểm tra.');
  }

  // 1. Trích 3 khung hình từ video
  const extracted = await extractVideoFramesForQC(take.blobUrl, take.durationSeconds);
  if (extracted.length < 3) {
    throw new Error('Không trích đủ 3 khung hình từ video.');
  }

  // 2. Chuẩn bị ảnh tham chiếu
  const images: Array<{ base64: string; mimeType: string }> = [];
  const imageLabels: string[] = [];

  characters.forEach((char) => {
    if (char.thumbBase64) {
      images.push({ base64: char.thumbBase64, mimeType: 'image/jpeg' });
      imageLabels.push(`Model Sheet 2D của nhân vật "${char.name}"`);
    }
  });

  if (startKeyframe?.thumbBase64) {
    images.push({ base64: startKeyframe.thumbBase64, mimeType: 'image/jpeg' });
    imageLabels.push('Keyframe đầu (First Frame boundary)');
  }

  if (endKeyframe?.thumbBase64) {
    images.push({ base64: endKeyframe.thumbBase64, mimeType: 'image/jpeg' });
    imageLabels.push('Keyframe cuối (Last Frame boundary)');
  }

  images.push({ base64: extracted[0].base64, mimeType: 'image/jpeg' });
  imageLabels.push(`Khung hình trích tại t=${extracted[0].timestamp.toFixed(2)}s`);

  images.push({ base64: extracted[1].base64, mimeType: 'image/jpeg' });
  imageLabels.push(`Khung hình trích tại t=${extracted[1].timestamp.toFixed(2)}s (giữa clip)`);

  images.push({ base64: extracted[2].base64, mimeType: 'image/jpeg' });
  imageLabels.push(`Khung hình trích tại t=${extracted[2].timestamp.toFixed(2)}s`);

  const systemInstruction = `You are a strict, calibrated 2D animation supervisor and layout QC director.
Evaluate the generated 2D animation clip against the reference model sheets, keyframes, and planned action.
You must return STRICT RAW JSON ONLY matching this exact schema:
{
  "onModel": 92,
  "style2D": 88,
  "continuity": 90,
  "action": 85,
  "artifacts": ["tay thừa ngón", "mặt méo nhẹ"],
  "verdict": "ok",
  "note": "Nhân vật giữ đúng nét 2D, chuyển động mượt."
}

CALIBRATED BENCHMARK SCORING LADDER (0 - 100 each criteria):
- 95 = Hoàn hảo, có thể phát sóng ngay; nét vẽ 2D sắc nét, nhân vật giống hệt sheet, không có biến dạng.
- 85 = Lỗi rất nhỏ khó nhận ra (chỉ nhận thấy khi dừng từng frame); giữ model tốt, nhịp 2D mượt.
- 75 = Lỗi nhỏ nhìn kỹ mới thấy, chấp nhận được (ví dụ viền áo hơi rung, bóng cel lệch nhẹ).
- 60 = Lỗi thấy rõ (mặt hoặc tay biến dạng, nhân vật đổi màu áo, xuất hiện nét trôi sang 3D CGI giả tạo, sai động tác chính).
- 40 = Hỏng nặng (nét vỡ, hình người biến dạng quái dị, lỗi khớp khung trầm trọng).
- 20 = Hoàn toàn sai chủ đề hoặc video bị đen/trắng/loạn hình.

CRITICAL INSTRUCTION ON SPREAD:
- Use the FULL range of the scoring ladder based on evidence. Do NOT cluster or default to ~70-76 points.
- If a clip looks clean, on-model and faithful, give 88-96.
- If it has obvious disfigurement, give 50-65.
- If severely broken, give below 45.

SCORING CRITERIA:
- onModel: Character matches model sheet design, colors, hair, face, outfit. (Give 95-100 if no character was in the shot).
- style2D: Strictly maintains 2D hand-drawn / cel aesthetic. Penalize heavily (score <= 60) if it drifts into 3D CGI or uncanny photorealism.
- continuity: Beginning and end frames match provided keyframes smoothly.
- action: Faithfully depicts the described action beat and intended movement.

VERDICT RULES:
- verdict: 'ok' if average >= 80, 'review' if average between 60 and 79, 'rerender' if average < 60.
- artifacts: array of concise Vietnamese strings naming visible flaws (VD: "tay lỗi", "mặt méo", "chữ lạ / watermark", "nhấp nháy", "nét bị trôi 3D"...). Empty array if clean.
- note: strictly Vietnamese <= 20 words summary.`;

  const prompt = `DANH SÁCH ẢNH GỬI KÈM THEO THỨ TỰ:
${imageLabels.map((lbl, idx) => `[Ảnh ${idx + 1}]: ${lbl}`).join('\n')}

THÔNG TIN SHOT CẦN KIỂM TRA:
- Hành động mô tả (Action): "${actionText}"
- Phong cách dự án (Look): "${lookLabel}"
- Độ dài clip: ${take.durationSeconds}s
- Model sinh video: ${take.model}

Hãy chấm điểm công tâm theo đúng thang mốc chuẩn (95, 85, 75, 60, 40) và trả về kết quả JSON.`;

  const { text } = await Flow.generate.text(prompt, {
    systemInstruction,
    images,
    thinkingLevel: 'low',
  });

  const clean = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error(`Phản hồi QC không phải JSON hợp lệ: ${text.slice(0, 150)}`);
  }

  const onModel = Math.max(0, Math.min(100, Number(parsed.onModel) || 75));
  const style2D = Math.max(0, Math.min(100, Number(parsed.style2D) || 75));
  const continuity = Math.max(0, Math.min(100, Number(parsed.continuity) || 75));
  const action = Math.max(0, Math.min(100, Number(parsed.action) || 75));
  const totalScore = Math.round((onModel + style2D + continuity + action) / 4);

  let verdict: 'ok' | 'review' | 'rerender' = 'ok';
  if (totalScore < 60) verdict = 'rerender';
  else if (totalScore < 80) verdict = 'review';

  return {
    onModel,
    style2D,
    continuity,
    action,
    totalScore,
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.map(String).slice(0, 5) : [],
    verdict,
    note: typeof parsed.note === 'string' ? parsed.note.slice(0, 120) : 'Đã kiểm tra chất lượng hoàn tất.',
    checkedAt: Date.now(),
  };
}
