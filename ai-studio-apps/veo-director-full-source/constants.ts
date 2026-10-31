import { VeoModelUI, VeoSDKModel } from './types';

export const VEO_MODEL_COSTS: Record<VeoModelUI, number> = {
  'Veo 3.1 - Lite [Lower Priority]': 0,
  'Veo 3.1 - Lite': 10,
  'Veo 3.1 - Fast': 20,
  'Omni Flash': 30,
  'Veo 3.1 - Quality': 200,
};

export const UI_TO_SDK_MODEL: Record<VeoModelUI, VeoSDKModel> = {
  'Veo 3.1 - Lite [Lower Priority]': 'Veo 3.1 - Lite',
  'Veo 3.1 - Lite': 'Veo 3.1 - Lite',
  'Veo 3.1 - Fast': 'Veo 3.1 - Fast',
  'Veo 3.1 - Quality': 'Veo 3.1 - Quality',
  'Omni Flash': 'Omni Flash',
};

export const MODEL_OPTIONS: VeoModelUI[] = [
  'Veo 3.1 - Lite [Lower Priority]',
  'Veo 3.1 - Lite',
  'Veo 3.1 - Fast',
  'Omni Flash',
  'Veo 3.1 - Quality'
];

export const MODELS_SUPPORTING_R2V: VeoModelUI[] = [
  'Veo 3.1 - Lite',
  'Veo 3.1 - Fast',
  'Omni Flash',
  'Veo 3.1 - Lite [Lower Priority]'
];

export const STYLE_PRESETS = [
  { label: 'Điện ảnh (Cinematic)', value: 'Cinematic, 4k, professional color grade, high dynamic range, detailed textures' },
  { label: 'Tiên Hiệp (Xianxia)', value: 'Xianxia aesthetic, ethereal Chinese fantasy, flying immortal swords, celestial mountain palaces, glowing daoist magic, flowing silk robes, mystical clouds, elegant' },
  { label: 'Huyền Huyễn (Xuanhuan)', value: 'Eastern fantasy, mythical beasts, divine martial arts energy, grand ancient architecture, powerful qi effects, epic scale, magical aura' },
  { label: 'Wukong (Dark Myth)', value: 'Black Myth Wukong style, gritty dark Chinese mythology, hyper-realistic, intricate ancient armor, atmospheric fog, cinematic cinematic lighting, dramatic shadows, epic scale' },
  { label: 'Võ Hiệp (Wuxia)', value: 'Traditional Wuxia style, Chinese martial arts, bamboo forest, ancient tea houses, dynamic combat poses, historical garments, cinematic period drama' },
  { label: 'Thủy Mặc (Ink Wash)', value: 'Traditional Chinese ink wash painting, high contrast black ink, calligraphic brushstrokes, shan shui landscape, artistic paper texture, minimalist' },
  { label: 'Hoạt hình 3D (Pixar)', value: '3D stylized animation, soft rounded shapes, vibrant colors, expressive character lighting, high-end CGI, cute aesthetic' },
  { label: 'Anime / Ghibli', value: 'Studio Ghibli style, vibrant watercolor, clean lines, whimsical atmosphere, hand-drawn look, nostalgic' },
  { label: 'Cyberpunk', value: 'Futuristic cyberpunk, neon lights, rainy city streets, high tech low life, dark teal and orange color palette, glowing details' },
  { label: 'Phim Noir (1940s)', value: '1940s film noir, high contrast, black and white, dramatic shadows, moody atmosphere, cinematic smoke' },
  { label: 'Tranh Sơn Dầu', value: 'Classical oil painting, visible thick brushstrokes, rich textures, dramatic chiaroscuro lighting, masterpiece' },
  { label: 'VHS Retro', value: '1990s VHS home video, tracking lines, color bleeding, nostalgic, low fidelity, analog grain, vintage' },
  { label: 'Tối giản (Minimalist)', value: 'Modern minimalist, clean aesthetic, soft natural lighting, pastel colors, spacious composition, zen' },
  { label: 'Phác thảo (Sketch)', value: 'Rough charcoal sketch, expressive pencil lines, paper texture, artistic hand-drawn, graphite style' }
];