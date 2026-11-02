import {
  Accessory,
  AgeGroup,
  AspectRatioOption,
  BackgroundType,
  BodyType,
  CharacterConfig,
  CharacterPose,
  Ethnicity,
  FaceDna,
  FaceFidelity,
  FaceSource,
  FacialExpression,
  Footwear,
  HairStyle,
  HistoryItem,
  ImageModel,
  OutfitPreset,
  QcReport,
  SheetLayoutId,
  VisualStyleId,
} from '../types';
import {
  ACCESSORY_OPTIONS,
  AGE_GROUP_OPTIONS,
  ASPECT_RATIOS,
  BACKGROUND_OPTIONS,
  BODY_TYPE_OPTIONS,
  ETHNICITY_OPTIONS,
  EXPRESSION_OPTIONS,
  FOOTWEAR_OPTIONS,
  HAIR_STYLE_OPTIONS,
  INITIAL_CONFIG,
  MODEL_OPTIONS,
  OUTFIT_PRESET_OPTIONS,
  POSE_OPTIONS,
  SHEET_LAYOUTS,
  VISUAL_STYLES,
} from '../constants';
import { sanitizeTag } from './promptBuilder';

export const SESSION_VERSION = 1;

export interface SessionData {
  config: CharacterConfig;
  faceDna: FaceDna | null;
  outfitDna: string;
  history: HistoryItem[];
}

export type ParseSessionResult =
  | { ok: true; config: CharacterConfig; faceDna: FaceDna | null; outfitDna: string; history: HistoryItem[] }
  | { ok: false; error: string };

function clipText(val: unknown, maxChars: number = 1000): string {
  if (typeof val !== 'string') return '';
  return val.slice(0, maxChars);
}

const VALID_GENDERS: Array<CharacterConfig['gender']> = ['male', 'female', 'other'];
const VALID_AGE_GROUPS = new Set<string>(AGE_GROUP_OPTIONS.map((o) => o.id));
const VALID_BODY_TYPES = new Set<string>(BODY_TYPE_OPTIONS.map((o) => o.id));
const VALID_ETHNICITIES = new Set<string>(ETHNICITY_OPTIONS.map((o) => o.id));
const VALID_STYLES = new Set<string>(VISUAL_STYLES.map((o) => o.id));
const VALID_HAIR_STYLES = new Set<string>(HAIR_STYLE_OPTIONS.map((o) => o.id));
const VALID_EXPRESSIONS = new Set<string>(EXPRESSION_OPTIONS.map((o) => o.id));
const VALID_ACCESSORIES = new Set<string>(ACCESSORY_OPTIONS.map((o) => o.id));
const VALID_OUTFITS = new Set<string>(OUTFIT_PRESET_OPTIONS.map((o) => o.id));
const VALID_FOOTWEAR = new Set<string>(FOOTWEAR_OPTIONS.map((o) => o.id));
const VALID_LAYOUTS = new Set<string>(SHEET_LAYOUTS.map((o) => o.id));
const VALID_ASPECTS = new Set<string>(ASPECT_RATIOS);
const VALID_BACKGROUNDS = new Set<string>(BACKGROUND_OPTIONS.map((o) => o.id));
const VALID_POSES = new Set<string>(POSE_OPTIONS.map((o) => o.id));
const VALID_MODELS = new Set<string>(MODEL_OPTIONS);
const VALID_FACE_FIDELITIES: Set<string> = new Set(['stylized', 'balanced', 'strict']);

export function validateAndMergeConfig(raw: any): CharacterConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...INITIAL_CONFIG };
  }

  const base = { ...INITIAL_CONFIG };

  // Tag
  if (typeof raw.tag === 'string') {
    base.tag = sanitizeTag(raw.tag);
  }

  // Display Name
  if (typeof raw.displayName === 'string') {
    base.displayName = clipText(raw.displayName, 100);
  }

  // Gender
  if (VALID_GENDERS.includes(raw.gender)) {
    base.gender = raw.gender;
  }

  // Age group
  if (VALID_AGE_GROUPS.has(raw.ageGroup)) {
    base.ageGroup = raw.ageGroup as AgeGroup;
  }

  // Numeric age
  if (typeof raw.numericAge === 'number' && !isNaN(raw.numericAge)) {
    base.numericAge = Math.max(1, Math.min(120, Math.round(raw.numericAge)));
  } else if (raw.numericAge === null) {
    base.numericAge = null;
  }

  // Body type
  if (VALID_BODY_TYPES.has(raw.bodyType)) {
    base.bodyType = raw.bodyType as BodyType;
  }

  // Role
  if (typeof raw.roleOccupation === 'string') {
    base.roleOccupation = clipText(raw.roleOccupation, 1000);
  }

  // Face source
  if (raw.faceSource === 'ai' || raw.faceSource === 'upload') {
    base.faceSource = raw.faceSource as FaceSource;
  }

  // Face fidelity
  if (VALID_FACE_FIDELITIES.has(raw.faceFidelity)) {
    base.faceFidelity = raw.faceFidelity as FaceFidelity;
  }

  // Ethnicity
  if (VALID_ETHNICITIES.has(raw.ethnicity)) {
    base.ethnicity = raw.ethnicity as Ethnicity;
  }

  // Visual style
  if (VALID_STYLES.has(raw.styleId)) {
    base.styleId = raw.styleId as VisualStyleId;
  }

  // Hair style
  if (VALID_HAIR_STYLES.has(raw.hairStyle)) {
    base.hairStyle = raw.hairStyle as HairStyle;
  }

  // Hair color
  if (typeof raw.hairColor === 'string') {
    base.hairColor = clipText(raw.hairColor, 30);
  }

  // Expression
  if (VALID_EXPRESSIONS.has(raw.expression)) {
    base.expression = raw.expression as FacialExpression;
  }

  // Accessories
  if (Array.isArray(raw.accessories)) {
    base.accessories = raw.accessories.filter((a: unknown): a is Accessory =>
      typeof a === 'string' && VALID_ACCESSORIES.has(a)
    );
  }

  // Distinctive features
  if (typeof raw.distinctiveFeatures === 'string') {
    base.distinctiveFeatures = clipText(raw.distinctiveFeatures, 1000);
  }

  // Outfit preset
  if (VALID_OUTFITS.has(raw.outfitPreset)) {
    base.outfitPreset = raw.outfitPreset as OutfitPreset;
  }

  // Outfit description
  if (typeof raw.outfitDescription === 'string') {
    base.outfitDescription = clipText(raw.outfitDescription, 1000);
  }

  // Color palette
  if (typeof raw.colorPalette === 'string') {
    base.colorPalette = clipText(raw.colorPalette, 500);
  }

  // Footwear
  if (VALID_FOOTWEAR.has(raw.footwear)) {
    base.footwear = raw.footwear as Footwear;
  }

  // Layout
  if (VALID_LAYOUTS.has(raw.layoutId)) {
    base.layoutId = raw.layoutId as SheetLayoutId;
  }

  // Aspect ratio
  if (VALID_ASPECTS.has(raw.aspectRatio)) {
    base.aspectRatio = raw.aspectRatio as AspectRatioOption;
  }

  // Background
  if (VALID_BACKGROUNDS.has(raw.background)) {
    base.background = raw.background as BackgroundType;
  }

  // Pose
  if (VALID_POSES.has(raw.pose)) {
    base.pose = raw.pose as CharacterPose;
  }

  // Extra notes
  if (typeof raw.extraNotes === 'string') {
    base.extraNotes = clipText(raw.extraNotes, 1000);
  }

  // QC settings
  if (typeof raw.qcEnabled === 'boolean') {
    base.qcEnabled = raw.qcEnabled;
  }
  if (typeof raw.qcMaxRetries === 'number' && !isNaN(raw.qcMaxRetries)) {
    base.qcMaxRetries = Math.max(0, Math.min(2, Math.round(raw.qcMaxRetries)));
  }
  if (typeof raw.qcCandidates === 'number' && !isNaN(raw.qcCandidates)) {
    base.qcCandidates = Math.max(1, Math.min(4, Math.round(raw.qcCandidates)));
  }

  // Batch count
  if (typeof raw.imageCount === 'number' && !isNaN(raw.imageCount)) {
    base.imageCount = Math.max(1, Math.min(4, Math.round(raw.imageCount)));
  }

  // Model
  if (VALID_MODELS.has(raw.model)) {
    base.model = raw.model as ImageModel;
  }

  return base;
}

export function normalizeFaceDna(raw: any): FaceDna | null {
  if (!raw || typeof raw !== 'object') return null;

  const summary = clipText(raw.summary, 1000);
  let genderImpression: 'male' | 'female' | 'ambiguous' | '' = '';
  if (raw.genderImpression === 'male' || raw.genderImpression === 'female' || raw.genderImpression === 'ambiguous') {
    genderImpression = raw.genderImpression;
  }

  let ageGroupGuess: AgeGroup | '' = '';
  if (raw.ageGroupGuess && VALID_AGE_GROUPS.has(raw.ageGroupGuess)) {
    ageGroupGuess = raw.ageGroupGuess as AgeGroup;
  }

  const d = raw.details && typeof raw.details === 'object' ? raw.details : {};

  return {
    summary,
    genderImpression,
    ageGroupGuess,
    details: {
      faceShape: clipText(d.faceShape, 300),
      eyes: clipText(d.eyes, 300),
      brows: clipText(d.brows, 300),
      nose: clipText(d.nose, 300),
      lips: clipText(d.lips, 300),
      skinTone: clipText(d.skinTone, 300),
      hair: clipText(d.hair, 300),
      facialHair: clipText(d.facialHair, 300),
      ageImpression: clipText(d.ageImpression, 300),
      distinctiveMarks: clipText(d.distinctiveMarks, 300),
    },
  };
}

function normalizeQc(raw: any): QcReport | undefined {
  if (!raw || typeof raw !== 'object' || typeof raw.available !== 'boolean') {
    return undefined;
  }

  return {
    available: Boolean(raw.available),
    score: typeof raw.score === 'number' && !isNaN(raw.score) ? Math.max(0, Math.min(100, Math.round(raw.score))) : 0,
    viewCount: typeof raw.viewCount === 'number' && !isNaN(raw.viewCount) ? Math.max(0, Math.round(raw.viewCount)) : 0,
    expectedViews: typeof raw.expectedViews === 'number' && !isNaN(raw.expectedViews) ? Math.max(1, Math.round(raw.expectedViews)) : 4,
    hasText: raw.hasText === true,
    textFound: Array.isArray(raw.textFound)
      ? raw.textFound.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 10)
      : [],
    layoutOk: typeof raw.layoutOk === 'boolean' ? raw.layoutOk : true,
    faceMatch: typeof raw.faceMatch === 'number' && !isNaN(raw.faceMatch) ? Math.max(0, Math.min(100, Math.round(raw.faceMatch))) : null,
    issues: Array.isArray(raw.issues)
      ? raw.issues.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 5)
      : [],
    verdict: raw.verdict === 'retry' ? 'retry' : 'ok',
  };
}

/**
 * Serializes work session into a JSON string. Drops full base64 images to keep file lightweight.
 */
export function serializeSession(data: SessionData): string {
  const strippedHistory = (data.history || []).slice(0, 40).map((item) => ({
    id: String(item.id),
    createdAt: Number(item.createdAt) || Date.now(),
    config: item.config,
    promptUsed: String(item.promptUsed || ''),
    mediaId: String(item.mediaId || ''),
    mimeType: String(item.mimeType || 'image/jpeg'),
    thumb: typeof item.thumb === 'string' && item.thumb.startsWith('data:image/') ? item.thumb : '',
    rewriteRound: typeof item.rewriteRound === 'number' ? item.rewriteRound : 0,
    favorite: Boolean(item.favorite),
    qc: item.qc,
    qcAttempts: typeof item.qcAttempts === 'number' ? item.qcAttempts : 0,
    parentId: item.parentId ? String(item.parentId) : undefined,
    changesSummary: item.changesSummary ? String(item.changesSummary) : undefined,
    refMediaIds: Array.isArray(item.refMediaIds)
      ? item.refMediaIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : undefined,
  }));

  const payload = {
    app: 'character-sheet-studio',
    version: SESSION_VERSION,
    savedAt: new Date().toISOString(),
    config: data.config,
    faceDna: data.faceDna,
    outfitDna: data.outfitDna || '',
    history: strippedHistory,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Parses and validates an uploaded session JSON. Never throws; returns Vietnamese error message on failure.
 */
export function parseSession(text: string): ParseSessionResult {
  if (!text || typeof text !== 'string') {
    return { ok: false, error: 'Tệp phiên làm việc trống hoặc không hợp lệ.' };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Tệp không phải định dạng JSON hợp lệ hoặc đã bị lỗi cú pháp.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Dữ liệu phiên làm việc không đúng cấu trúc.' };
  }

  if (parsed.app !== 'character-sheet-studio') {
    return { ok: false, error: 'Tệp này không phải phiên làm việc của Character Sheet Studio.' };
  }

  if (typeof parsed.version !== 'number' || parsed.version > SESSION_VERSION || parsed.version < 1) {
    return { ok: false, error: `Phiên bản tệp (${parsed.version}) không được hỗ trợ bởi phiên bản hiện tại.` };
  }

  const config = validateAndMergeConfig(parsed.config);
  const faceDna = normalizeFaceDna(parsed.faceDna);
  const outfitDna = clipText(parsed.outfitDna, 1000);

  const rawHistory = Array.isArray(parsed.history) ? parsed.history : [];
  const history: HistoryItem[] = [];

  for (const item of rawHistory) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.id !== 'string' || !item.id.trim()) continue;
    if (typeof item.mediaId !== 'string' || !item.mediaId.trim()) continue;

    const itemConfig = validateAndMergeConfig(item.config);
    const thumb = typeof item.thumb === 'string' && item.thumb.startsWith('data:image/') ? item.thumb : '';
    const mimeType = typeof item.mimeType === 'string' && item.mimeType.trim() ? item.mimeType : 'image/jpeg';
    const promptUsed = typeof item.promptUsed === 'string' ? item.promptUsed : '';
    const createdAt = typeof item.createdAt === 'number' && !isNaN(item.createdAt) ? item.createdAt : Date.now();
    const rewriteRound = typeof item.rewriteRound === 'number' ? Math.max(0, Math.min(2, Math.round(item.rewriteRound))) : 0;
    const favorite = Boolean(item.favorite);
    const qc = normalizeQc(item.qc);
    const qcAttempts = typeof item.qcAttempts === 'number' ? Math.max(0, Math.round(item.qcAttempts)) : 0;
    const parentId = typeof item.parentId === 'string' && item.parentId.trim() ? item.parentId : undefined;
    const changesSummary = typeof item.changesSummary === 'string' && item.changesSummary.trim() ? item.changesSummary : undefined;
    const refMediaIds = Array.isArray(item.refMediaIds)
      ? item.refMediaIds.filter((m: unknown): m is string => typeof m === 'string' && m.trim().length > 0)
      : undefined;

    history.push({
      id: item.id,
      createdAt,
      config: itemConfig,
      promptUsed,
      mediaId: item.mediaId,
      mimeType,
      base64: null, // Full base64 always evicted for imported sessions
      thumb,
      rewriteRound,
      favorite,
      qc,
      qcAttempts,
      parentId,
      changesSummary,
      refMediaIds,
    });

    if (history.length >= 40) {
      break;
    }
  }

  return {
    ok: true,
    config,
    faceDna,
    outfitDna,
    history,
  };
}
