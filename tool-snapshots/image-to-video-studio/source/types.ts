export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export interface Scene {
  id: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AspectRatio;
  motionPrompt?: string;
  status: 'pending' | 'generating' | 'upscaling' | 'success' | 'error';
  result?: {
    base64: string;
    thumbBase64?: string;
    mimeType: string;
    mediaId: string;
    width?: number;
    height?: number;
    bytes?: number;
  };
  errorMessage?: string;
  retryInfo?: string;
  originalPrompt?: string;
  safetyNote?: string;
}

export type VideoModelId = 'Omni 1.1 Flash' | 'Veo 3.1 - Lite' | 'Veo 3.1 - Fast' | 'Veo 3.1 - Quality';
export type VideoResolution = '360p' | '720p';
export type VideoAspect = '16:9' | '9:16';

export interface VideoSettings {
  model: VideoModelId;
  resolution: VideoResolution;
  durationSeconds: number;
  aspect: VideoAspect;
  variants: number; // 1-4
  styleId: string;
  cameraId: string;
}

export interface VideoJob {
  id: string;
  sceneId: string;
  sceneNumber: number;
  title: string;
  variant: number;
  motionPrompt: string;
  model: VideoModelId;
  resolution: VideoResolution;
  durationSeconds: number;
  aspect: VideoAspect;
  creditEstimate: number;
  status: 'pending' | 'preparing' | 'generating' | 'success' | 'error';
  errorMessage?: string;
  retryInfo?: string;
  result?: {
    blobUrl: string;
    bytes: number;
    mediaId: string;
    width?: number;
    height?: number;
  };
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
  completedInRun: number;
  totalInRun: number;
}

export interface DownloadErrorItem {
  filename: string;
  error: string;
  item: DownloadTarget;
}

export interface DownloadTarget {
  sceneId: string;
  sceneNumber: number;
  title: string;
  base64: string;
  mimeType: string;
}

export interface DownloadProgress {
  isProcessing: boolean;
  current: number;
  total: number;
  percent: number;
  filename: string;
  summaryMessage?: string;
  failedItems?: DownloadErrorItem[];
}
