export interface PromptItem {
  id: string;
  index: number;
  title: string;
  originalText: string;
  cleanedPrompt: string;
  negativePrompt: string;
  aspectRatio: string;
  status: "idle" | "queued" | "generating" | "success" | "failed";
  imageUrl?: string;
  error?: string;
}

export type GeminiModel = 
  | "gemini-2.5-flash-image" 
  | "gemini-3.1-flash-image" 
  | "gemini-3-pro-image" 
  | "imagen-4.0-generate-001";

export type ImageSize = "512px" | "1K" | "2K" | "4K" | "1920x1080";

export interface GenerationSettings {
  model: GeminiModel;
  aspectRatio: string;
  imageSize: ImageSize;
  delaySeconds: number;
  negativePrompt: string;
}

export interface ImageEditState {
  width: number;
  height: number;
  lockAspectRatio: boolean;
  resamplingAlgorithm: "lanczos" | "real-esrgan" | "bicubic" | "nearest";
  brightness: number; // 0 to 200 (100 is default)
  contrast: number; // 0 to 200 (100 is default)
  saturation: number; // 0 to 200 (100 is default)
  hue: number; // -180 to 180 (0 is default)
  exposure: number; // -100 to 100 (0 is default)
  vignette: number; // 0 to 100 (0 is default)
  blur: number; // 0 to 100 (0 is default)
  sharpen: number; // 0 to 100 (0 is default)
  grayscale: boolean;
  sepia: boolean;
  invert: boolean;
  edgeDetect: boolean;
  denoise: boolean;
}
