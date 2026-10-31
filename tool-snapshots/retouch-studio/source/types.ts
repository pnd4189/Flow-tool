export type ActiveTool =
  | 'smart_select'
  | 'brush_add'
  | 'brush_erase'
  | 'protect_add'
  | 'protect_erase';

export type RightTab = 'xoa_sua' | 'nen' | 'mau_net' | 'bo_cuc';

export type CandidateApplyMode = 'replace' | 'add' | 'subtract';

export type AiEditMode =
  | 'prompt_edit'       // Chỉnh theo prompt (DEFAULT)
  | 'reshape_body'      // Chỉnh dáng / thon gọn
  | 'remove_object'     // Xóa đối tượng / người
  | 'remove_text'       // Xóa chữ không mong muốn
  | 'repair_damage'     // Phục hồi vùng hỏng / trầy xước
  | 'replace_object'    // Thay thế vật thể
  | 'add_object'        // Thêm vật thể mới
  | 'change_material'   // Đổi chất liệu / bề mặt
  | 'recolor_local';    // Đổi màu cục bộ chính xác

export type SupportedImageModel = '🍌 Nano Banana Pro' | '🍌 Nano Banana 2.1';

export type CropAspectPreset = 'free' | 'original' | '1:1' | '4:3' | '16:9' | '9:16';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ExpandAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export interface ColorAdjustmentParams {
  brightness: number;   // -100..100 (default 0)
  exposure: number;     // -100..100 (default 0)
  contrast: number;     // -100..100 (default 0)
  saturation: number;   // -100..100 (default 0)
  temperature: number;  // -100..100 (default 0) (blue <-> amber)
  tint: number;         // -100..100 (default 0) (green <-> magenta)
  highlights: number;   // -100..100 (default 0)
  shadows: number;      // -100..100 (default 0)
  sharpen: number;      // 0..100 (default 0)
  denoise: number;      // 0..100 (default 0)
}

export interface DecodedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  blobUrl: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface MaskBuffers {
  selectionCanvas: HTMLCanvasElement;
  protectionCanvas: HTMLCanvasElement;
  width: number;
  height: number;
  selectionNonZeroCount: number;
  protectionNonZeroCount: number;
}

export interface NormalizedFaceBox {
  ymin: number; // 0..1000
  xmin: number; // 0..1000
  ymax: number; // 0..1000
  xmax: number; // 0..1000
  confidence?: number;
}

export interface CandidateMask {
  id: 'small' | 'medium' | 'large';
  label: string;
  canvas: HTMLCanvasElement;
  pixelCount: number;
  iouScore: number;
}

export interface EditHistoryItem {
  id: string;
  timestamp: number;
  name: string;
  thumbnailUrl: string;
  imageBlob: Blob;
  selectionBlob: Blob;
  protectionBlob: Blob;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface InspectionReport {
  score: number | null; // 0..100 or null if inspection unavailable
  status: 'VERIFIED' | 'UNAVAILABLE';
  summary: string;
  hasMagentaArtifacts: boolean;
  hasSeamsDetected: boolean;
  alignmentRating: 'EXCELLENT' | 'FAIR' | 'POOR' | 'UNKNOWN';
  advice?: string;
  pixelComparison?: {
    protectedModified: number;
    outsideModified: number;
    editableModified: number;
  };
}

export interface CandidatePreview {
  type:
    | 'bg_remove'
    | 'bg_color'
    | 'bg_gradient'
    | 'bg_image'
    | 'bg_blur'
    | 'bg_ai'
    | 'ai_edit'
    | 'color_quality'
    | 'crop'
    | 'rotate_flip'
    | 'straighten'
    | 'ai_expand';
  canvas: HTMLCanvasElement;
  selectionMaskCanvas?: HTMLCanvasElement;
  protectionMaskCanvas?: HTMLCanvasElement;
  title: string;
  description: string;
  params?: Record<string, unknown>;
  sourceRevision: number;
  inspectionReport?: InspectionReport | null;
  previewDimensions?: { width: number; height: number };
  compositionInfo?: {
    originalDimensions: { width: number; height: number };
    newDimensions: { width: number; height: number };
    sourceOffset?: { x: number; y: number };
    isResampled?: boolean;
    operation: 'crop' | 'rotate_flip' | 'straighten' | 'ai_expand';
  };
  diagnostics?: {
    durationMs: number;
    modelUsed: string;
    protectedPreservedPixels: number;
    outsideMaskPreservedPixels: number;
    editablePixels: number;
    changedPixelCount?: number;
    sourceDimensions: { width: number; height: number };
    outputDimensions: { width: number; height: number };
    mappingInfo: string;
  };
}

export interface DiagnosticLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
  details?: string;
}

export interface DiagnosticTestResult {
  name: string;
  status: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL';
  summary: string;
  details?: string;
}

// Session persistence schema definitions
export interface RetouchSessionPayload {
  format: 'retouch_studio_session';
  version: 1;
  name: string;
  savedAt: number;
  dimensions: {
    width: number;
    height: number;
  };
  originalDimensions: {
    width: number;
    height: number;
  };
  images: {
    originalPngBase64: string;
    currentPngBase64: string;
  };
  masks: {
    selectionPngBase64: string;
    protectionPngBase64: string;
    selectionPixels: number;
    protectionPixels: number;
  };
  faceAnalysis: {
    hasDetectedFacesOnce: boolean;
    protectFaceToggle: boolean;
  };
  settings: {
    brushRadius: number;
    dilationRadius: number;
    featherRadius: number;
    colorParams: ColorAdjustmentParams;
  };
}

export interface RestoredSessionResult {
  originalImage: DecodedImage;
  currentImage: DecodedImage;
  selectionMask: HTMLCanvasElement;
  protectionMask: HTMLCanvasElement;
  selectionPixels: number;
  protectionPixels: number;
  faceAnalysis: {
    hasDetectedFacesOnce: boolean;
    protectFaceToggle: boolean;
  };
  settings: {
    brushRadius: number;
    dilationRadius: number;
    featherRadius: number;
    colorParams: ColorAdjustmentParams;
  };
}
