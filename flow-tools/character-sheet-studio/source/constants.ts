import {
  CharacterConfig,
  VisualStyleId,
  SheetLayoutId,
  Ethnicity,
  AgeGroup,
  BodyType,
  HairStyle,
  FacialExpression,
  Accessory,
  OutfitPreset,
  Footwear,
  AspectRatioOption,
  BackgroundType,
  CharacterPose,
  ImageModel,
} from './types';

export interface StyleOption {
  id: VisualStyleId;
  labelKey: string;
  descKey: string;
  icon: string;
  badgeKey: string;
}

export const VISUAL_STYLES: StyleOption[] = [
  {
    id: 'modern_anime',
    labelKey: 'style_modern_anime',
    descKey: 'style_modern_anime_desc',
    icon: 'palette',
    badgeKey: 'style_badge_popular',
  },
  {
    id: 'photorealistic',
    labelKey: 'style_photorealistic',
    descKey: 'style_photorealistic_desc',
    icon: 'photo_camera',
    badgeKey: 'style_badge_cinematic',
  },
  {
    id: '2d_animation',
    labelKey: 'style_2d_animation',
    descKey: 'style_2d_animation_desc',
    icon: 'auto_awesome_motion',
    badgeKey: 'style_badge_animation',
  },
  {
    id: 'manga_bw',
    labelKey: 'style_manga_bw',
    descKey: 'style_manga_bw_desc',
    icon: 'draw',
    badgeKey: 'style_badge_ink',
  },
  {
    id: 'us_comic',
    labelKey: 'style_us_comic',
    descKey: 'style_us_comic_desc',
    icon: 'menu_book',
    badgeKey: 'style_badge_comic',
  },
  {
    id: 'watercolor',
    labelKey: 'style_watercolor',
    descKey: 'style_watercolor_desc',
    icon: 'format_paint',
    badgeKey: 'style_badge_art',
  },
  {
    id: '3d_animation',
    labelKey: 'style_3d_animation',
    descKey: 'style_3d_animation_desc',
    icon: 'view_in_ar',
    badgeKey: 'style_badge_3d',
  },
  {
    id: 'chibi',
    labelKey: 'style_chibi',
    descKey: 'style_chibi_desc',
    icon: 'sentiment_very_satisfied',
    badgeKey: 'style_badge_cute',
  },
];

export interface LayoutOption {
  id: SheetLayoutId;
  tag: string;
  labelKey: string;
  descKey: string;
  compositionKey: string;
}

export const SHEET_LAYOUTS: LayoutOption[] = [
  {
    id: 'layout_a',
    tag: 'A',
    labelKey: 'layout_a_title',
    descKey: 'layout_a_desc',
    compositionKey: 'layout_a_composition',
  },
  {
    id: 'layout_b',
    tag: 'B',
    labelKey: 'layout_b_title',
    descKey: 'layout_b_desc',
    compositionKey: 'layout_b_composition',
  },
  {
    id: 'layout_c',
    tag: 'C',
    labelKey: 'layout_c_title',
    descKey: 'layout_c_desc',
    compositionKey: 'layout_c_composition',
  },
  {
    id: 'layout_d',
    tag: 'D',
    labelKey: 'layout_d_title',
    descKey: 'layout_d_desc',
    compositionKey: 'layout_d_composition',
  },
  {
    id: 'layout_e',
    tag: 'E',
    labelKey: 'layout_e_title',
    descKey: 'layout_e_desc',
    compositionKey: 'layout_e_composition',
  },
  {
    id: 'layout_f',
    tag: 'F',
    labelKey: 'layout_f_title',
    descKey: 'layout_f_desc',
    compositionKey: 'layout_f_composition',
  },
];

export const ETHNICITY_OPTIONS: { id: Ethnicity; labelKey: string }[] = [
  { id: 'vietnamese', labelKey: 'eth_vietnamese' },
  { id: 'east_asian', labelKey: 'eth_east_asian' },
  { id: 'southeast_asian', labelKey: 'eth_southeast_asian' },
  { id: 'south_asian', labelKey: 'eth_south_asian' },
  { id: 'middle_eastern', labelKey: 'eth_middle_eastern' },
  { id: 'african', labelKey: 'eth_african' },
  { id: 'european', labelKey: 'eth_european' },
  { id: 'latino', labelKey: 'eth_latino' },
  { id: 'mixed', labelKey: 'eth_mixed' },
];

export const AGE_GROUP_OPTIONS: { id: AgeGroup; labelKey: string }[] = [
  { id: 'child', labelKey: 'age_child' },
  { id: 'teen', labelKey: 'age_teen' },
  { id: 'young_adult', labelKey: 'age_young_adult' },
  { id: 'middle_aged', labelKey: 'age_middle_aged' },
  { id: 'elderly', labelKey: 'age_elderly' },
];

export const BODY_TYPE_OPTIONS: { id: BodyType; labelKey: string }[] = [
  { id: 'slender', labelKey: 'body_slender' },
  { id: 'balanced', labelKey: 'body_balanced' },
  { id: 'muscular', labelKey: 'body_muscular' },
  { id: 'full_figured', labelKey: 'body_full_figured' },
];

export const HAIR_STYLE_OPTIONS: { id: HairStyle; labelKey: string }[] = [
  { id: 'auto', labelKey: 'hair_auto' },
  { id: 'short', labelKey: 'hair_short' },
  { id: 'undercut', labelKey: 'hair_undercut' },
  { id: 'long_straight', labelKey: 'hair_long_straight' },
  { id: 'long_wavy', labelKey: 'hair_long_wavy' },
  { id: 'bun', labelKey: 'hair_bun' },
  { id: 'ponytail', labelKey: 'hair_ponytail' },
  { id: 'braided', labelKey: 'hair_braided' },
  { id: 'bald', labelKey: 'hair_bald' },
];

export const EXPRESSION_OPTIONS: { id: FacialExpression; labelKey: string }[] = [
  { id: 'original', labelKey: 'expr_original' },
  { id: 'neutral', labelKey: 'expr_neutral' },
  { id: 'gentle_smile', labelKey: 'expr_gentle_smile' },
  { id: 'stern', labelKey: 'expr_stern' },
  { id: 'laughing', labelKey: 'expr_laughing' },
  { id: 'angry', labelKey: 'expr_angry' },
  { id: 'sad', labelKey: 'expr_sad' },
  { id: 'surprised', labelKey: 'expr_surprised' },
];

export const ACCESSORY_OPTIONS: { id: Accessory; labelKey: string; icon: string }[] = [
  { id: 'glasses', labelKey: 'acc_glasses', icon: 'eyeglasses' },
  { id: 'earrings', labelKey: 'acc_earrings', icon: 'circle' },
  { id: 'beard', labelKey: 'acc_beard', icon: 'face' },
  { id: 'scar', labelKey: 'acc_scar', icon: 'reorder' },
  { id: 'tattoo', labelKey: 'acc_tattoo', icon: 'brush' },
  { id: 'hat', labelKey: 'acc_hat', icon: 'theater_comedy' },
  { id: 'facemask', labelKey: 'acc_facemask', icon: 'masks' },
];

export const OUTFIT_PRESET_OPTIONS: { id: OutfitPreset; labelKey: string }[] = [
  { id: 'casual', labelKey: 'outfit_casual' },
  { id: 'business', labelKey: 'outfit_business' },
  { id: 'school_uniform', labelKey: 'outfit_school_uniform' },
  { id: 'ao_dai', labelKey: 'outfit_ao_dai' },
  { id: 'ao_ba_ba', labelKey: 'outfit_ao_ba_ba' },
  { id: 'streetwear', labelKey: 'outfit_streetwear' },
  { id: 'fantasy_armor', labelKey: 'outfit_fantasy_armor' },
  { id: 'scifi_suit', labelKey: 'outfit_scifi_suit' },
  { id: 'custom', labelKey: 'outfit_custom' },
];

export const FOOTWEAR_OPTIONS: { id: Footwear; labelKey: string }[] = [
  { id: 'sneakers', labelKey: 'footwear_sneakers' },
  { id: 'leather_shoes', labelKey: 'footwear_leather_shoes' },
  { id: 'boots', labelKey: 'footwear_boots' },
  { id: 'sandals', labelKey: 'footwear_sandals' },
  { id: 'barefoot', labelKey: 'footwear_barefoot' },
  { id: 'high_heels', labelKey: 'footwear_high_heels' },
  { id: 'armor_boots', labelKey: 'footwear_armor_boots' },
];

export const ASPECT_RATIOS: AspectRatioOption[] = ['16:9', '4:3', '1:1', '3:4', '9:16'];

export const BACKGROUND_OPTIONS: { id: BackgroundType; labelKey: string }[] = [
  { id: 'studio_gray', labelKey: 'bg_studio_gray' },
  { id: 'pure_white', labelKey: 'bg_pure_white' },
  { id: 'chroma_green', labelKey: 'bg_chroma_green' },
];

export const POSE_OPTIONS: { id: CharacterPose; labelKey: string }[] = [
  { id: 'natural', labelKey: 'pose_natural' },
  { id: 'a_pose', labelKey: 'pose_a_pose' },
  { id: 't_pose', labelKey: 'pose_t_pose' },
];

export const MODEL_OPTIONS: ImageModel[] = [
  '🍌 Nano Banana Pro',
  '🍌 Nano Banana 2.1',
  '🍌 Nano Banana 2 Lite',
];

export const PRESET_HAIR_COLORS = [
  { labelKey: 'hair_color_black', hex: '#1a181b' },
  { labelKey: 'hair_color_dark_brown', hex: '#3e2723' },
  { labelKey: 'hair_color_chestnut', hex: '#795548' },
  { labelKey: 'hair_color_platinum', hex: '#eceff1' },
  { labelKey: 'hair_color_straw', hex: '#ffd54f' },
  { labelKey: 'hair_color_burgundy', hex: '#b71c1c' },
  { labelKey: 'hair_color_azure', hex: '#0288d1' },
];

export const INITIAL_CONFIG: CharacterConfig = {
  tag: 'main_character',
  displayName: 'Minh Trí',
  gender: 'male',
  ageGroup: 'young_adult',
  numericAge: 24,
  bodyType: 'balanced',
  roleOccupation: '',

  faceSource: 'ai',
  faceFidelity: 'balanced',
  ethnicity: 'vietnamese',

  styleId: 'modern_anime',

  hairStyle: 'undercut',
  hairColor: '#1a181b',
  expression: 'neutral',
  accessories: [],
  distinctiveFeatures: '',

  outfitPreset: 'custom',
  outfitDescription: '',
  colorPalette: '',
  footwear: 'sneakers',

  layoutId: 'layout_a',
  aspectRatio: '16:9',
  background: 'studio_gray',
  pose: 'natural',
  extraNotes: '',
  qcEnabled: true,
  qcMaxRetries: 1,
  qcCandidates: 1,

  imageCount: 1,
  model: '🍌 Nano Banana Pro',
};
