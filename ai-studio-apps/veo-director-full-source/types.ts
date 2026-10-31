export type SceneComplexity = 'simple' | 'medium' | 'complex' | 'combat';

export type SceneStatus = 'pending' | 'generating' | 'success' | 'failed' | 'skipped';

export type VeoModelUI = 
  | 'Omni Flash'
  | 'Veo 3.1 - Lite [Lower Priority]'
  | 'Veo 3.1 - Lite'
  | 'Veo 3.1 - Fast'
  | 'Veo 3.1 - Quality';

export type VeoSDKModel = 
  | 'Omni Flash'
  | 'Veo 3.1 - Lite'
  | 'Veo 3.1 - Fast'
  | 'Veo 3.1 - Quality';

export interface CharacterProfile {
  id: string;
  name: string;
  age: string;
  physique: string;
  hair: string;
  face: string;
  clothing: string;
  accessories: string;
  isLocked: boolean;
  imageMediaId?: string;
  imageBase64?: string;
}

export interface Scene {
  id: string;
  sceneNumber: number;
  title: string;
  rawText: string;
  cinematography: string;
  subject: string;
  action: string;
  context: string;
  styleAmbiance: string;
  charactersDetected: string[];
  complexityScore: number;
  complexityTag: SceneComplexity;
  recommendedModel: VeoModelUI;
  selectedModel: VeoModelUI;
  status: SceneStatus;
  outputBase64?: string;
  mediaId?: string;
  error?: string;
  retryCount: number;
  finalPrompt?: string;
  isSafetyFlagged?: boolean;
}

export interface ProjectSettings {
  name: string;
  delayMs: number;
  consistencyMode: 'strict' | 'balanced' | 'loose';
  globalStyleAnchor: string;
  negativeConsistencyPrompt: string;
  optimizePrompts: boolean;
  creditLimit: number | null;
  autoRemoveWatermark: boolean;
}

export interface QueueState {
  isProcessing: boolean;
  isPaused: boolean;
  currentIndex: number;
  startTime?: number;
  logs: LogEntry[];
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}