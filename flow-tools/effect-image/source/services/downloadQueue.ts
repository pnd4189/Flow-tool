import { Flow } from 'flow-sdk';
import { withTimeout } from './genQueue';

export interface DownloadTask {
  id: string;
  base64: string;
  mimeType:
    | 'image/jpeg'
    | 'image/jpg'
    | 'image/png'
    | 'image/webp'
    | 'video/mp4'
    | 'video/webm'
    | 'application/json'
    | 'text/plain';
  filename: string;
  onProgress?: (status: 'downloading' | 'done' | 'error', error?: string) => void;
}

/**
 * Chuẩn hoá promptKey cho chạy bền và manifest lô:
 * Chữ thường, gộp khoảng trắng, bỏ dấu câu cuối (. ! ? , ;)
 */
export function normalizePromptKey(promptText: string): string {
  if (!promptText) return '';
  return promptText
    .toLowerCase()
    .replace(/[.!?\,;:\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chuyển đổi chuỗi thành slug: không dấu tiếng Việt, chữ thường, gạch nối, tối đa maxLength ký tự
 */
export function slugify(str: string, maxLength = 40): string {
  if (!str) return '';
  const slug = str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Bỏ dấu tiếng Việt
    .toLowerCase()
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9]+/g, '-') // Đổi ký tự đặc biệt sang '-'
    .replace(/^-+|-+$/g, '') // Bỏ gạch nối ở đầu/cuối
    .slice(0, maxLength)
    .replace(/-+$/, ''); // Bỏ gạch nối ở đuôi nếu bị cắt ngang

  return slug;
}

/**
 * Kiểm tra xem title có phải là tên tự đặt mặc định (ví dụ "Prompt 1", "Prompt #2", "Ảnh 3", "Image 4"...) hay không
 */
export function isDefaultAutoTitle(title: string): boolean {
  if (!title) return true;
  const t = title.trim();
  return /^(?:prompt|ảnh|hình|image|cảnh|scene)\s*(?:#|\b)?\d+$/i.test(t);
}

/**
 * Lấy slug đại diện nhận diện được cho file:
 * - Nếu title là tên riêng do người dùng đặt -> dùng slug của title
 * - Nếu title chỉ là tên tự đặt (Prompt N / Ảnh N...) -> lấy slug từ 6 từ đầu của prompt (ưu tiên promptEn nếu có)
 * Giới hạn tối đa 40 ký tự.
 */
export function resolveItemSlug(title: string, promptText?: string, promptEn?: string): string {
  if (title && !isDefaultAutoTitle(title)) {
    const s = slugify(title, 40);
    if (s) return s;
  }

  // Ưu tiên prompt tiếng Anh nếu có, sau đó là prompt gốc
  const sourceText = (promptEn && promptEn.trim()) || (promptText && promptText.trim()) || '';
  if (sourceText) {
    // Tách lấy 6 từ đầu tiên
    const words = sourceText
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 6)
      .join(' ');

    const s = slugify(words, 40);
    if (s) return s;
  }

  return slugify(title || 'clip', 40) || 'clip';
}

/**
 * Đợt 4A: STT trong tên file dùng 3 chữ số khi N >= 100 (001…300) và 2 chữ số khi N < 100 (01...99).
 * Luôn là số thứ tự prompt trong file gốc, không đổi khi chạy tiếp.
 * "{projectName}_{STT}_{slug}.{ext}"
 */
export function buildFilename(
  projectName: string,
  order: number,
  title: string,
  ext: string,
  promptText?: string,
  promptEn?: string,
  totalPromptCount = 10
): string {
  const safeProject = slugify(projectName || 'effect-image', 30) || 'effect-image';
  const padLength = totalPromptCount >= 100 ? 3 : 2;
  const padOrder = String(order).padStart(padLength, '0');
  const safeSlug = resolveItemSlug(title, promptText, promptEn);
  return `${safeProject}_${padOrder}_${safeSlug}.${ext}`;
}

/**
 * Hàm tải dữ liệu JSON UTF-8 an toàn qua Flow.download với timeout 90s
 */
export async function downloadJsonFile(filename: string, data: any): Promise<boolean> {
  try {
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const bytes = new TextEncoder().encode(jsonStr);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    const base64 = btoa(binary);

    await withTimeout(
      Flow.download({
        base64,
        mimeType: 'application/json',
        filename,
      }),
      90000,
      `downloadJsonFile (${filename})`
    );
    return true;
  } catch (err) {
    console.error('Lỗi khi tải file json:', filename, err);
    return false;
  }
}

/**
 * Hàng đợi tải xuống tuần tự:
 * - Mỗi file cách nhau 1.2s
 * - Thử lại tối đa 2 lần khi gặp lỗi
 * - Hạn giờ 90s mỗi lời gọi Flow.download
 * - Có phương thức waitIdle() để đợi tải hết sạch hàng đợi
 */
class DownloadQueueManager {
  private queue: DownloadTask[] = [];
  private isProcessing = false;
  private cancelRequested = false;
  private idleResolvers: (() => void)[] = [];

  public enqueue(task: DownloadTask): void {
    this.queue.push(task);
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  public cancelAll(): void {
    this.cancelRequested = true;
    this.queue = [];
    this.isProcessing = false;
    this.notifyIdle();
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public isBusy(): boolean {
    return this.isProcessing || this.queue.length > 0;
  }

  /**
   * Đợi cho tới khi hàng đợi tải đã xả hết sạch
   */
  public async waitIdle(): Promise<void> {
    if (!this.isBusy()) return;
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private notifyIdle(): void {
    if (this.idleResolvers.length > 0) {
      const resolvers = [...this.idleResolvers];
      this.idleResolvers = [];
      resolvers.forEach((r) => r());
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.cancelRequested = false;

    while (this.queue.length > 0) {
      if (this.cancelRequested) {
        this.queue = [];
        break;
      }

      const task = this.queue.shift();
      if (!task) continue;

      if (task.onProgress) {
        task.onProgress('downloading');
      }

      let success = false;
      let lastError = '';
      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (this.cancelRequested) break;

        try {
          await withTimeout(
            Flow.download({
              base64: task.base64,
              mimeType: task.mimeType as any,
              filename: task.filename,
            }),
            90000,
            `Flow.download (${task.filename})`
          );
          success = true;
          break;
        } catch (err: any) {
          lastError = err instanceof Error ? err.message : String(err);
          console.warn(`Tải file ${task.filename} thất bại lần ${attempt + 1}:`, lastError);
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 800));
          }
        }
      }

      if (success) {
        if (task.onProgress) task.onProgress('done');
      } else {
        if (task.onProgress) task.onProgress('error', lastError);
      }

      // Giãn cách tuần tự 1.2s giữa các lần tải
      if (this.queue.length > 0 && !this.cancelRequested) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    this.isProcessing = false;
    this.notifyIdle();
  }
}

export const downloadQueue = new DownloadQueueManager();

/**
 * Tải file trực tiếp đơn lẻ có thử lại 2 lần kèm timeout 90s
 */
export async function downloadWithRetry(
  base64: string,
  mimeType:
    | 'image/jpeg'
    | 'image/jpg'
    | 'image/png'
    | 'image/webp'
    | 'video/mp4'
    | 'video/webm'
    | 'application/json'
    | 'text/plain',
  filename: string
): Promise<{ ok: boolean; error?: string }> {
  let lastErr = '';
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      await withTimeout(
        Flow.download({
          base64,
          mimeType: mimeType as any,
          filename,
        }),
        90000,
        `Flow.download (${filename})`
      );
      return { ok: true };
    } catch (err: any) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  return { ok: false, error: lastErr };
}
