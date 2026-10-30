import { Flow } from 'flow-sdk';
import { VideoModel } from './types';

export interface DownloadItem {
  id: string;
  filename: string;
  blobUrl?: string;
  base64?: string; // Nếu đã có sẵn base64 (ví dụ thumbnail keyframe)
  mimeType: 'video/mp4' | 'image/jpeg';
  sizeBytes: number;
  status: 'pending' | 'downloading' | 'done' | 'error';
  errorMessage?: string;
}

export function getModelSlug(model: VideoModel): string {
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
      return 'omni-flash';
  }
}

export function sanitizeActionBeatSlug(text: string): string {
  if (!text) return 'shot';

  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  const capped = normalized.slice(0, 30);
  return capped || 'shot';
}

export function generateVideoFilename(
  order: number,
  actionBeat: string,
  model: VideoModel,
  durationSeconds: number
): string {
  const nnn = String(order).padStart(3, '0');
  const slug = sanitizeActionBeatSlug(actionBeat);
  const modelSlug = getModelSlug(model);
  return `${nnn}_${slug}_${modelSlug}_${durationSeconds}s.mp4`;
}

/** Đọc blobUrl thành chuỗi base64 qua FileReader ngay khi tải xuống */
export async function readBlobUrlToBase64(blobUrl: string): Promise<string> {
  const res = await fetch(blobUrl);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function executeDownloadQueue(
  items: DownloadItem[],
  onProgress: (status: {
    currentIndex: number;
    total: number;
    currentItem?: DownloadItem;
    downloadedCount: number;
    errorCount: number;
    items: DownloadItem[];
  }) => void,
  shouldCancel: () => boolean
): Promise<{ downloadedCount: number; errors: DownloadItem[] }> {
  const currentItems = [...items];
  let downloadedCount = 0;

  for (let i = 0; i < currentItems.length; i++) {
    if (shouldCancel()) break;

    const item = currentItems[i];
    item.status = 'downloading';
    item.errorMessage = undefined;

    onProgress({
      currentIndex: i + 1,
      total: currentItems.length,
      currentItem: item,
      downloadedCount,
      errorCount: currentItems.filter((it) => it.status === 'error').length,
      items: [...currentItems],
    });

    const retryDelays = [1500, 3000];
    let attempt = 0;
    let success = false;

    while (!success && attempt <= 2) {
      if (shouldCancel()) break;

      try {
        let base64Data = item.base64;
        if (!base64Data && item.blobUrl) {
          base64Data = await readBlobUrlToBase64(item.blobUrl);
        }

        if (!base64Data) {
          throw new Error('Không có dữ liệu base64 để tải');
        }

        await Flow.download({
          base64: base64Data,
          mimeType: item.mimeType,
          filename: item.filename,
        });
        success = true;
        item.status = 'done';
        downloadedCount++;
      } catch (err: unknown) {
        attempt++;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempt <= 2) {
          await sleep(retryDelays[attempt - 1]);
        } else {
          item.status = 'error';
          item.errorMessage = errMsg;
        }
      }
    }

    onProgress({
      currentIndex: i + 1,
      total: currentItems.length,
      currentItem: item,
      downloadedCount,
      errorCount: currentItems.filter((it) => it.status === 'error').length,
      items: [...currentItems],
    });

    if (i < currentItems.length - 1 && !shouldCancel()) {
      await sleep(1500); // Nghỉ 1500ms giữa các file tuần tự
    }
  }

  const errors = currentItems.filter((it) => it.status === 'error');
  return { downloadedCount, errors };
}
