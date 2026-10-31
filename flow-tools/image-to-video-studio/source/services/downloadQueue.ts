import { Flow } from 'flow-sdk';
import { VideoModelId } from '../types';

export interface DownloadItem {
  key: string;
  kind: 'image' | 'video';
  filename: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4';
  sceneNumber: number;
  label: string;
  approxBytes: number;
  getBase64: () => Promise<string>;
}

export interface DownloadQueueProgress {
  isBusy: boolean;
  current: number;
  total: number;
  percent: number;
  currentFilename: string;
  currentApproxBytes: number;
  summaryMessage?: string;
  failedItems: Array<{
    item: DownloadItem;
    filename: string;
    errorMessage: string;
  }>;
}

export type QueueListener = (progress: DownloadQueueProgress) => void;

/**
 * Format runTag = YYYYMMDD-HHmm theo giờ địa phương hiện tại.
 */
export function createRunTag(): string {
  const now = new Date();
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${YYYY}${MM}${DD}-${HH}${mm}`;
}

let activeRunTag = createRunTag();

/**
 * Làm mới runTag khi người dùng bấm Clear Session.
 */
export function resetRunTag(): void {
  activeRunTag = createRunTag();
  downloadedFilenamesInSession.clear();
}

export function getActiveRunTag(): string {
  return activeRunTag;
}

/** Chuyển tiếng Việt có dấu sang slug an toàn */
export function slugifyTitle(title: string): string {
  if (!title) return 'scene';
  const normalized = title
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const trimmed = normalized.slice(0, 40);
  return trimmed || 'scene';
}

/** Map Model sang modelSlug chuẩn cho tên file */
export function getModelSlug(model: VideoModelId | string): string {
  switch (model) {
    case 'Omni 1.1 Flash':
      return 'omni-flash';
    case 'Veo 3.1 - Lite':
      return 'veo31-lite';
    case 'Veo 3.1 - Fast':
      return 'veo31-fast';
    case 'Veo 3.1 - Quality':
      return 'veo31-quality';
    default:
      return 'video-model';
  }
}

/** Extension allowlist mapping */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

/** Bộ theo dõi số lần tên file đã được tải thành công trong phiên hiện tại để thêm hậu tố _dl2, _dl3... */
const downloadedFilenamesInSession = new Map<string, number>();

/**
 * Tạo tên file ảnh thống nhất:
 * ${runTag}_${NNN}_${slug}.jpg
 */
export function buildImageDownloadFilename(sceneNumber: number, title: string, mimeType: string = 'image/jpeg'): string {
  const nnn = String(sceneNumber).padStart(3, '0');
  const slug = slugifyTitle(title);
  const ext = MIME_TO_EXT[mimeType] || (mimeType.includes('png') ? 'png' : 'jpg');
  const baseName = `${activeRunTag}_${nnn}_${slug}`;

  const currentCount = downloadedFilenamesInSession.get(baseName) || 0;
  if (currentCount === 0) {
    return `${baseName}.${ext}`;
  }
  return `${baseName}_dl${currentCount + 1}.${ext}`;
}

/**
 * Tạo tên file video thống nhất:
 * ${runTag}_${NNN}_${slug}_v${variant}_${modelSlug}_${sec}s.mp4
 */
export function buildVideoDownloadFilename(params: {
  sceneNumber: number;
  title: string;
  variant: number;
  model: VideoModelId | string;
  durationSeconds: number;
  mimeType?: string;
}): string {
  const { sceneNumber, title, variant, model, durationSeconds, mimeType = 'video/mp4' } = params;
  const nnn = String(sceneNumber).padStart(3, '0');
  const slug = slugifyTitle(title);
  const mSlug = getModelSlug(model);
  const ext = MIME_TO_EXT[mimeType] || 'mp4';
  const baseName = `${activeRunTag}_${nnn}_${slug}_v${variant}_${mSlug}_${durationSeconds}s`;

  const currentCount = downloadedFilenamesInSession.get(baseName) || 0;
  if (currentCount === 0) {
    return `${baseName}.${ext}`;
  }
  return `${baseName}_dl${currentCount + 1}.${ext}`;
}

/** Đăng ký ghi nhận file đã tải xong để kích hoạt _dl2, _dl3 nếu tải lại */
function markFilenameDownloaded(filename: string): void {
  // Tách đuôi file và hậu tố _dlX nếu có
  const withoutExt = filename.replace(/\.[^/.]+$/, '');
  const baseName = withoutExt.replace(/_dl\d+$/, '');
  const count = downloadedFilenamesInSession.get(baseName) || 0;
  downloadedFilenamesInSession.set(baseName, count + 1);
}

// ----------------------------------------------------
// SINGLETON QUEUE STATE
// ----------------------------------------------------
let isQueueBusy = false;
let cancelRequested = false;
const listeners = new Set<QueueListener>();

let currentProgress: DownloadQueueProgress = {
  isBusy: false,
  current: 0,
  total: 0,
  percent: 0,
  currentFilename: '',
  currentApproxBytes: 0,
  failedItems: [],
};

function notifyListeners(): void {
  listeners.forEach(fn => {
    try {
      fn(currentProgress);
    } catch (e) {
      console.error('Error notifying downloadQueue listener:', e);
    }
  });
}

export function isDownloadBusy(): boolean {
  return isQueueBusy;
}

export function subscribe(listener: QueueListener): () => void {
  listeners.add(listener);
  listener(currentProgress);
  return () => {
    listeners.delete(listener);
  };
}

export function cancelDownloads(): void {
  cancelRequested = true;
}

export function getCurrentProgress(): DownloadQueueProgress {
  return currentProgress;
}

/**
 * Chạy danh sách items tải xuống qua Flow.download tuần tự,
 * đảm bảo chỉ có 1 Flow.download chạy tại một thời điểm trên toàn tool.
 */
export async function runDownloads(
  items: DownloadItem[],
  options?: {
    onProgress?: (progress: DownloadQueueProgress) => void;
    signal?: { aborted: boolean };
  }
): Promise<DownloadQueueProgress> {
  if (items.length === 0) {
    return currentProgress;
  }

  if (isQueueBusy) {
    throw new Error('Hàng đợi tải xuống đang bận xử lý đợt tải khác.');
  }

  isQueueBusy = true;
  cancelRequested = false;

  const total = items.length;
  let successCount = 0;
  const failedList: Array<{ item: DownloadItem; filename: string; errorMessage: string }> = [];

  currentProgress = {
    isBusy: true,
    current: 0,
    total,
    percent: 0,
    currentFilename: '',
    currentApproxBytes: 0,
    summaryMessage: undefined,
    failedItems: [],
  };
  notifyListeners();
  if (options?.onProgress) options.onProgress(currentProgress);

  try {
    for (let i = 0; i < total; i++) {
      if (cancelRequested || options?.signal?.aborted) {
        break;
      }

      const item = items[i];
      const filename = item.filename;

      currentProgress = {
        ...currentProgress,
        isBusy: true,
        current: i + 1,
        total,
        percent: Math.round(((i + 1) / total) * 100),
        currentFilename: filename,
        currentApproxBytes: item.approxBytes,
      };
      notifyListeners();
      if (options?.onProgress) options.onProgress(currentProgress);

      let downloaded = false;
      let lastErrorMessage = '';

      // Thử lại tối đa 2 lần (3 lần thử tổng cộng: ban đầu, chờ 1.5s, chờ 3s)
      const delays = [0, 1500, 3000];

      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelRequested || options?.signal?.aborted) {
          break;
        }

        if (attempt > 0) {
          await new Promise(r => setTimeout(r, delays[attempt]));
        }

        try {
          // Lấy base64 ngay trước khi tải và không lưu giữ sau khi tải
          let base64Data = await item.getBase64();
          if (base64Data.includes(',')) {
            base64Data = base64Data.split(',')[1];
          }

          await Flow.download({
            base64: base64Data,
            mimeType: item.mimeType as any,
            filename: filename,
          });

          // Giải phóng ngay chuỗi base64 khỏi phạm vi
          base64Data = '';
          downloaded = true;
          successCount++;
          markFilenameDownloaded(filename);
          break;
        } catch (err: any) {
          lastErrorMessage = err?.message || 'Lỗi tải xuống không xác định';
        }
      }

      if (!downloaded && !cancelRequested && !options?.signal?.aborted) {
        failedList.push({
          item,
          filename,
          errorMessage: lastErrorMessage || 'Tải thất bại',
        });
      }

      // Nghỉ giữa các file: ảnh 700ms, video 1500ms
      if (i < total - 1 && !cancelRequested && !options?.signal?.aborted) {
        const sleepTime = item.kind === 'video' ? 1500 : 700;
        await new Promise(r => setTimeout(r, sleepTime));
      }
    }
  } finally {
    isQueueBusy = false;
    currentProgress = {
      isBusy: false,
      current: total,
      total,
      percent: 100,
      currentFilename: '',
      currentApproxBytes: 0,
      summaryMessage: cancelRequested
        ? `Đã dừng hàng đợi tải. Hoàn thành ${successCount}/${total} mục.`
        : `Đã tải ${successCount}/${total} mục.`,
      failedItems: failedList,
    };
    notifyListeners();
    if (options?.onProgress) options.onProgress(currentProgress);
  }

  return currentProgress;
}
