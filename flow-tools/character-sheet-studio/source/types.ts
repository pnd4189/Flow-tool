export type Language = 'vi' | 'en';

export type Gender = 'male' | 'female' | 'other';

export type AgeGroup = 'child' | 'teen' | 'young_adult' | 'middle_aged' | 'elderly';

export type BodyType = 'slender' | 'balanced' | 'muscular' | 'full_figured';

export type FaceSource = 'ai' | 'upload';

export type FaceFidelity = 'stylized' | 'balanced' | 'strict';

export type Ethnicity =
  | 'vietnamese'
  | 'east_asian'
  | 'southeast_asian'
  | 'south_asian'
  | 'middle_eastern'
  | 'african'
  | 'european'
  | 'latino'
  | 'mixed';

export type VisualStyleId =
  | 'photorealistic'
  | 'modern_anime'
  | '2d_animation'
  | 'manga_bw'
  | 'us_comic'
  | 'watercolor'
  | '3d_animation'
  | 'chibi';

export type HairStyle =
  | 'auto'
  | 'short'
  | 'undercut'
  | 'long_straight'
  | 'long_wavy'
  | 'bun'
  | 'ponytail'
  | 'braided'
  | 'bald';

export type FacialExpression =
  | 'original'
  | 'neutral'
  | 'gentle_smile'
  | 'stern'
  | 'laughing'
  | 'angry'
  | 'sad'
  | 'surprised';

export type Accessory =
  | 'glasses'
  | 'earrings'
  | 'beard'
  | 'scar'
  | 'tattoo'
  | 'hat'
  | 'facemask';

export type OutfitPreset =
  | 'casual'
  | 'business'
  | 'school_uniform'
  | 'ao_dai'
  | 'ao_ba_ba'
  | 'streetwear'
  | 'fantasy_armor'
  | 'scifi_suit'
  | 'custom';

export type Footwear =
  | 'sneakers'
  | 'leather_shoes'
  | 'boots'
  | 'sandals'
  | 'barefoot'
  | 'high_heels'
  | 'armor_boots';

export type SheetLayoutId = 'layout_a' | 'layout_b' | 'layout_c' | 'layout_d' | 'layout_e' | 'layout_f';

export type AspectRatioOption = '16:9' | '4:3' | '1:1' | '3:4' | '9:16';

export type BackgroundType = 'studio_gray' | 'pure_white' | 'chroma_green';

export type CharacterPose = 'natural' | 'a_pose' | 't_pose';

export type ImageModel =
  | '🍌 Nano Banana Pro'
  | '🍌 Nano Banana 2.1'
  | '🍌 Nano Banana 2 Lite';

export type RefKind = 'face' | 'outfit';

export interface RefImage {
  id: string;
  kind: RefKind;
  name: string;
  thumb: string; // JPEG data URL, 160 px
  base64: string; // downscaled JPEG
  mimeType: string;
  mediaId: string | null;
  source: 'file' | 'library';
  status: 'ready' | 'uploading' | 'error';
  error?: string;
}

export interface FaceDna {
  summary: string;
  genderImpression?: 'male' | 'female' | 'ambiguous' | '';
  ageGroupGuess?: AgeGroup | '';
  details: {
    faceShape: string;
    eyes: string;
    brows: string;
    nose: string;
    lips: string;
    skinTone: string;
    hair: string;
    facialHair: string;
    ageImpression: string;
    distinctiveMarks: string;
  };
}

export interface PromptRefs {
  faceCount: number;
  faceDna?: string;
  outfitCount: number;
  outfitDna?: string;
}

export interface QcReport {
  available: boolean;
  score: number;
  viewCount: number;
  expectedViews: number;
  hasText: boolean;
  textFound: string[];
  layoutOk: boolean;
  faceMatch: number | null;
  issues: string[];
  verdict: 'ok' | 'retry';
}

export interface CharacterConfig {
  // Section 1: Character
  tag: string;
  displayName: string;
  gender: Gender;
  ageGroup: AgeGroup;
  numericAge?: number | null;
  bodyType: BodyType;
  roleOccupation: string;

  // Section 2: Face
  faceSource: FaceSource;
  faceFidelity: FaceFidelity;
  ethnicity: Ethnicity;

  // Section 3: Visual Style
  styleId: VisualStyleId;

  // Section 4: Appearance
  hairStyle: HairStyle;
  hairColor: string; // '' means "as in the photo"
  expression: FacialExpression;
  accessories: Accessory[];
  distinctiveFeatures: string;

  // Section 5: Outfit
  outfitPreset: OutfitPreset;
  outfitDescription: string;
  colorPalette: string;
  footwear: Footwear;

  // Section 6: Framing & Sheet Canvas
  layoutId: SheetLayoutId;
  aspectRatio: AspectRatioOption;
  background: BackgroundType;
  pose: CharacterPose;
  extraNotes: string;
  qcEnabled: boolean;
  qcMaxRetries: number; // 0-2
  qcCandidates?: number; // 1-4, 1 = off

  // Footer generation meta
  imageCount: number;
  model: ImageModel;
}

export interface HistoryItem {
  id: string;
  createdAt: number;
  config: CharacterConfig; // Snapshot of configuration used
  promptUsed: string;
  mediaId: string;
  mimeType: string;
  base64: string | null; // Full raw base64 image; null once evicted (keeps newest 12)
  thumb: string; // JPEG data URL
  rewriteRound: number; // 0 = original prompt, 1 or 2 = sanitized
  favorite: boolean;
  refMediaIds?: string[]; // Flow media IDs of references passed to Flow.generate.image
  qc?: QcReport;
  qcAttempts?: number;
  qcPending?: boolean;
  parentId?: string;
  changesSummary?: string;
}

export type GenerationStage =
  | 'translating'
  | 'uploading'
  | 'analyzing'
  | 'generating'
  | 'retrying'
  | 'rewriting'
  | 'inspecting';

export interface GenerationJob {
  total: number;
  done: number;
  stage: GenerationStage;
  stageDetail?: string; // e.g. retry/rewrite round or attempt number
  startedAt: number;
  error?: string | null;
}
