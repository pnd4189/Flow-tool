export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export interface Scene {
  id: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AspectRatio;
  status: 'pending' | 'generating' | 'upscaling' | 'success' | 'error';
  result?: {
    base64: string;
    mimeType: string;
    mediaId: string;
  };
  errorMessage?: string;
}

export interface BatchSettings {
  modelDisplayName: string;
  aspectRatio: AspectRatio;
  resolution: 'Full HD' | '2K' | '4K';
  delaySeconds: number;
}

export interface BatchState {
  isRunning: boolean;
  isPaused: boolean;
  currentIndex: number;
  total: number;
  successCount: number;
  failedCount: number;
}

export interface DownloadProgress {
  isProcessing: boolean;
  percent: number;
  message: string;
}