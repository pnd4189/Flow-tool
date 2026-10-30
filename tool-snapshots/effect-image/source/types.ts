export type SupportedAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export interface PromptItem {
  id: string;
  order: number;
  title: string;
  prompt: string;
  aspectRatio: SupportedAspectRatio;
  negative?: string;
  originalText?: string;
  selected: boolean;
  warnings: string[];
  duplicateOf?: number; // Order của prompt trùng
  hasVietnamese?: boolean;
}

export interface QCResult {
  matchesPrompt: number;
  artifacts: string[];
  hasUnwantedText: boolean;
  verdict: 'ok' | 'regenerate';
  note: string;
}

export interface GeneratedImageVariant {
  id: string;
  blobUrl: string;
  thumbnailUrl: string;
  mediaId: string;
  modelUsed: string;
  sentPrompt: string;
  translatedPrompt?: string;
  qc?: QCResult;
  qcStatus: 'idle' | 'running' | 'done' | 'error';
  qcRetried?: boolean;
  attemptCount: number;
  createdAt: number;
  // Khi giải phóng bộ nhớ cho file lớn:
  isMemoryReleased?: boolean;
}

// ==========================================
// CẤU HÌNH HIỆU ỨNG (EFFECT CONFIG) - BƯỚC 3
// ==========================================
export type CameraMoveType =
  | 'none'
  | 'zoom_in'
  | 'zoom_out'
  | 'pan_left'
  | 'pan_right'
  | 'pan_up'
  | 'pan_down'
  | 'push_to_focus'
  | 'orbit_sway'
  | 'handheld'
  | 'dolly_zoom';

export type OverlayId =
  | 'dust_motes'
  | 'bokeh'
  | 'sparkles'
  | 'snow'
  | 'rain'
  | 'petals'
  | 'embers'
  | 'fog'
  | 'light_rays'
  | 'light_leak'
  | 'lens_flare'
  | 'film_grain'
  | 'vignette'
  | 'flicker'
  | 'fireflies';

export interface OverlayConfig {
  id: OverlayId;
  intensity: number; // 0 - 1
  color?: string; // Tùy chọn, mặc định tự trích xuất từ bảng màu ảnh
}

export interface EffectConfig {
  camera: {
    move: CameraMoveType;
    intensity: number; // 0 - 1
    easing: 'easeInOut' | 'linear';
    focus?: { x: number; y: number }; // 0 - 1 (mặc định tâm {x: 0.5, y: 0.5})
  };
  parallax: {
    enabled: boolean;
    direction: 'left' | 'right' | 'up' | 'down' | 'in';
    depth: number; // 0 - 1
    subjectBreath: boolean;
    subjectFloat: boolean;
    disabledReason?: string; // Lý do tự tắt tiếng Việt
  };
  overlays: OverlayConfig[]; // Tối đa 3 hiệu ứng
  durationSec: number; // 3 - 10, mặc định 6
  fadeInOut: boolean; // mặc định true (0.3s mờ từ/về đen)
  seed: number;
  source: 'ai' | 'user' | 'default';
  aiReason?: string;
}

export interface ColorPaletteInfo {
  avgLuminance: number; // 0 - 255
  highlightColor: string; // Hex string e.g. '#ffe8b3'
  warmOrCool: 'warm' | 'cool';
}

// Trạng thái tách 2 lớp Parallax (Đợt 2B & Đợt 4A: lưu Blob, không giữ base64 lớn)
export type ParallaxLayerStatus = 'none' | 'generating' | 'ready' | 'disabled';

export interface ParallaxLayerData {
  status: ParallaxLayerStatus;
  bgBlob?: Blob;
  bgBlobUrl?: string;
  bgMediaId?: string;
  subjectCutoutBlob?: Blob;
  subjectCutoutBlobUrl?: string;
  subjectCutoutDataUrl?: string; // Thumbnail preview nhẹ
  subjectAreaRatio?: number; // 0 - 1 (alpha > 0.5)
  subjectCenter?: { x: number; y: number }; // 0 - 1
  disabledReason?: string;
  error?: string;
  updatedAt?: number;
}

export interface AttemptRecord {
  at: number;
  message: string;
}

export interface QueueItem {
  id: string;
  promptItem: PromptItem;
  status: 'pending' | 'generating' | 'qc' | 'done' | 'error' | 'modified_safety';
  variants: GeneratedImageVariant[];
  selectedVariantIndex: number;
  activeModel: string;
  sentPrompt?: string;
  translatedPrompt?: string;
  safetyRewritten?: boolean;
  originalPromptBeforeSafety?: string;
  error?: string;
  retryCount: number;
  retryTimer?: number;
  retryWaitUntil?: number; // timestamp khi kết thúc đếm ngược
  attempts?: AttemptRecord[]; // Lịch sử các lần thử bị lỗi
  startedAt?: number;
  completedAt?: number;
  // Cấu hình hiệu ứng Bước 3 cho ảnh chính
  effectConfig?: EffectConfig;
  // Dữ liệu 2 lớp Parallax
  parallaxLayers?: ParallaxLayerData;
  // Đợt 4A: Đánh dấu giải phóng bộ nhớ & hoàn thành từ manifest
  isMemoryReleased?: boolean;
  completedFromManifest?: boolean;
}

export interface GenerationSettings {
  modelName: '🍌 Nano Banana 2.1' | '🍌 Nano Banana Pro' | '🍌 Nano Banana 2 Lite';
  defaultAspectRatio: SupportedAspectRatio;
  variantsPerPrompt: number; // 1 - 4
  concurrency: number; // 1 - 3
  styleSuffix: string;
  addNoWatermark: boolean; // default true
  translateVietnamese: boolean; // default true
  autoFallbackModel: boolean; // default true
  autoQcInspection: boolean; // default true
}

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  message: string;
  timestamp: number;
}

export type DebugSimulationMode = 'none' | 'high_traffic' | 'unsafe_prompt';

export type MockErrorType = 'temporary' | 'image_service' | 'safety' | 'quota' | 'timeout';

export interface MockErrorConfig {
  active: boolean;
  type: MockErrorType;
  remainingCount: number;
}

// Chẩn đoán hệ thống (Phase 0)
export interface ModelTestResult {
  modelName: string;
  status: 'idle' | 'running' | 'success' | 'error';
  durationMs?: number;
  width?: number;
  height?: number;
  mimeType?: string;
  base64?: string;
  mediaId?: string;
  errorMessage?: string;
}

export interface VideoCodecSupport {
  hasVideoEncoder: boolean;
  h264_720p: boolean;
  h264_1080p: boolean;
  mediaRecorderVp9: boolean;
  mediaRecorderWebm: boolean;
}

export interface VideoTestResult {
  status: 'idle' | 'running' | 'success' | 'error';
  encoderUsed: 'VideoEncoder (H.264 mp4-muxer)' | 'MediaRecorder (WebM VP9)' | 'MediaRecorder (WebM)' | 'None';
  durationMs?: number;
  videoBase64?: string;
  mimeType?: 'video/mp4' | 'video/webm';
  videoUrl?: string;
  errorMessage?: string;
  supportDetails?: VideoCodecSupport;
}

export interface ParallaxLayerResult {
  status: 'idle' | 'running' | 'success' | 'error';
  durationMs?: number;
  bgBase64?: string;
  bgMediaId?: string;
  subjectRawBase64?: string;
  subjectCutoutBase64?: string;
  subjectCutoutDataUrl?: string;
  offsetPx?: { dx: number; dy: number; total: number };
  errorMessage?: string;
}

export interface AiVisionResult {
  status: 'idle' | 'running' | 'success' | 'error';
  durationMs?: number;
  parsedJson?: {
    matchesPrompt: number;
    artifacts: string[];
    hasText: boolean;
    verdict: 'ok' | 'regenerate';
    note: string;
  };
  rawText?: string;
  errorMessage?: string;
}

export interface Phase0State {
  modelTests: Record<string, ModelTestResult>;
  videoTest: VideoTestResult;
  parallaxTest: ParallaxLayerResult;
  aiVisionTest: AiVisionResult;
  isRunningAll: boolean;
}

// ==========================================
// ĐỢT 3A & 4A: BƯỚC 4 XUẤT VIDEO (EXPORT VIDEO)
// ==========================================
export type ExportResolution = '720p' | '1080p';
export type ExportFps = 24 | 30;

export type ExportClipStatus =
  | 'idle'           // Chờ
  | 'rendering'      // Đang dựng X%
  | 'rendered'       // Đã dựng xong (giữ Blob trong bộ nhớ)
  | 'downloading'    // Đang tải
  | 'downloaded'     // Đã tải
  | 'needs_rerender' // Cần dựng lại (do đổi EffectConfig ở bước 3)
  | 'released'       // Đã giải phóng bộ nhớ
  | 'error';         // Lỗi

export interface ExportSettings {
  projectName: string;
  resolution: ExportResolution;
  fps: ExportFps;
  downloadClips: boolean;       // Tải từng clip (mặc định bật)
  mergeClips: boolean;          // Ghép thành 1 video (mặc định tắt)
  downloadOriginalImages: boolean; // Tải ảnh gốc (mặc định tắt)
  downloadManifest: boolean;    // Tải manifest.json (mặc định bật)
  uploadToFlow: boolean;        // Lưu clip vào thư viện Flow (mặc định tắt)
}

export interface ExportClipItem {
  id: string;                   // queueItem.id
  order: number;
  title: string;
  aspectRatio: SupportedAspectRatio;
  durationSec: number;
  status: ExportClipStatus;
  progressPercent: number;      // 0 - 100
  expectedFilename: string;
  blob?: Blob;
  blobUrl?: string;
  base64?: string;
  mimeType?: 'video/mp4' | 'video/webm';
  sizeBytes?: number;
  renderTimeMs?: number;
  error?: string;
  selected: boolean;            // checkbox chọn
  uploadedToFlow?: boolean;
  uploadedMediaId?: string;
  configHash?: string;
  isMemoryReleased?: boolean;
}

export interface ExportManifestItem {
  order: number;
  promptKey?: string;           // Prompt gốc chuẩn hoá cho chạy bền
  file: string;
  stillFile?: string;
  title: string;
  originalPrompt: string;
  sentPrompt: string;
  model: string;
  mediaId: string;
  aspectRatio: string;
  dimensions: { width: number; height: number };
  fps: number;
  durationSec: number;
  effectConfig?: EffectConfig;
  qc?: QCResult;
  sizeBytes?: number;
  renderTimeMs?: number;
}

// ==========================================
// ĐỢT 4A & 5A: 4 CHẾ ĐỘ TỰ ĐỘNG + CHẠY BỀN CHO FILE LỚN
// ==========================================
export type AutoPilotMode =
  | 'full'               // 1. "Auto đầy đủ": AI chọn camera + overlays + parallax (khi AI bật)
  | 'no_parallax'       // 2. "Auto không parallax": AI chọn camera + overlays; parallax luôn tắt
  | 'camera_only'       // 3. "Auto chỉ chuyển động máy quay": AI chỉ chọn camera; overlays = [], parallax tắt
  | 'images_only';      // 4. "Chỉ sinh ảnh": sinh ảnh + QC, không hiệu ứng, không dựng video, tải ảnh gốc + manifest

export type AutoPilotStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'completed';

export type AutoPilotItemStage =
  | 'waiting'          // Chờ
  | 'not_started'      // Chưa chạy (do dừng bởi hạn mức)
  | 'skipped'          // Đã xong (từ manifest)
  | 'generating'       // Sinh ảnh
  | 'inspecting'       // Soi ảnh (QC)
  | 'directing'        // Chọn hiệu ứng
  | 'separating'       // Tách lớp
  | 'rendering'        // Dựng X%
  | 'downloading'      // Đang tải
  | 'downloaded'       // Đã tải ✓
  | 'released'         // Đã giải phóng bộ nhớ
  | 'error';           // Lỗi

export interface AutoPilotItemProgress {
  id: string;
  order: number;
  promptKey?: string;
  title: string;
  prompt: string;
  aspectRatio: SupportedAspectRatio;
  stage: AutoPilotItemStage;
  stageProgressPercent?: number; // khi đang render 0-100
  thumbnailUrl?: string;
  blobUrl?: string;
  aiReason?: string;
  cameraMove?: CameraMoveType;
  parallaxReady?: boolean;
  renderedBlobUrl?: string;
  downloadedFilename?: string;
  sizeBytes?: number;
  renderTimeMs?: number;
  isMemoryReleased?: boolean;
  error?: string;
  errorStage?: AutoPilotItemStage;
  stageStartTime?: number;
  durationMs?: number;
}

export interface AutoPilotConfig {
  mode: AutoPilotMode; // 1 trong 4 chế độ
  modelName: '🍌 Nano Banana 2.1' | '🍌 Nano Banana Pro' | '🍌 Nano Banana 2 Lite';
  concurrency: number; // 1 - 3, mặc định 2
  batchSize: 10 | 25 | 50; // Kích thước lô, mặc định 25
  autoQc: boolean; // AI soi ảnh + tự sinh lại ảnh lỗi (mặc định bật)
  effectMode: 'ai' | 'fixed'; // 'AI chọn theo từng ảnh' (mặc định) | 'Cố định'
  fixedCameraMove?: CameraMoveType;
  fixedOverlays?: OverlayId[];
  parallaxMode: 'ai' | 'off'; // 'Theo AI' (mặc định) | 'Tắt'
  durationMode: 'ai' | 'fixed'; // 'Theo AI' (mặc định) | 'fixed'
  fixedDurationSec: number; // 3 - 10, mặc định 6
  resolution: ExportResolution; // 720p / 1080p, mặc định 1080p
  fps: ExportFps; // 24 / 30, mặc định 24
  downloadClips: boolean; // mặc định bật
  mergeClips: boolean; // mặc định tắt
  downloadOriginalImages: boolean; // mặc định tắt
  downloadManifest: boolean; // mặc định bật
  uploadToFlow: boolean; // mặc định tắt
  projectName: string;
  // Cài đặt sinh ảnh người dùng (Đợt 5A)
  styleSuffix: string;
  addNoWatermark: boolean;
  translateVietnamese: boolean;
}

export interface AutoPilotSummary {
  mode: AutoPilotMode;
  completedClips: number;
  totalClips: number;
  skippedClips?: number;
  unstartedCount?: number;
  errorCount: number;
  totalTimeMs: number;
  batchesCompleted: number;
  mergedVideoDownloaded?: boolean;
}

export interface MemoryStats {
  activeBlobsCount: number;
  estimatedMemoryMB: number;
  releasedCount: number;
}
