export interface CinemaItem {
  id: string;
  label: string;
  prompt: string;
}

export interface LookItem {
  id: string;
  label: string;
  group: '2D' | 'Stylized';
  imagePrompt: string;
  videoPrompt: string;
  guard: string;
}

export interface ShotRecipe {
  id: string;
  label: string;
  description: string;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  lens: string;
  lighting?: string; // nếu không set thì giữ nguyên
  effects: string[];
}

export const GUARD_2D = 'Strictly 2D hand-drawn animation, not photorealistic, no 3D CGI rendering, no real people.';
export const GUARD_STYLIZED = 'Stylized animation, not photorealistic, no real people.';

export const LOOKS: LookItem[] = [
  // Nhóm 2D
  {
    id: 'anime_cel',
    label: 'Anime cel-shading (mặc định)',
    group: '2D',
    imagePrompt: '2D anime illustration, clean confident line art, flat cel shading with two-tone shadows, vibrant colors, detailed painted background',
    videoPrompt: '2D hand-drawn anime animation, clean line art, flat cel shading, vibrant colors, painted backgrounds',
    guard: GUARD_2D,
  },
  // 3 Look mới hợp chủ đề phát minh / lịch sử (Đợt 4B)
  {
    id: 'patent_blueprint',
    label: 'Bản vẽ sáng chế cổ (Patent Blueprint)',
    group: '2D',
    imagePrompt: 'vintage patent drawing style animation, precise ink line art on aged cream paper, numbered labels without readable text, subtle sepia wash, technical cutaway details',
    videoPrompt: 'animated vintage patent drawing, ink line art on aged paper, mechanical parts moving precisely',
    guard: GUARD_2D,
  },
  {
    id: 'victorian_engraving',
    label: 'Tranh khắc thời Victoria',
    group: '2D',
    imagePrompt: 'Victorian engraving illustration style, fine crosshatched ink lines, muted sepia and cream palette, 19th-century newspaper print texture',
    videoPrompt: 'Victorian engraving illustration style, fine crosshatched ink lines, muted sepia and cream palette, 19th-century newspaper print texture',
    guard: GUARD_2D,
  },
  {
    id: 'edu_1950s',
    label: 'Hoạt hình giáo dục thập niên 50',
    group: '2D',
    imagePrompt: '1950s educational cartoon style, cheerful rounded characters, flat mid-century colors, simple painted backgrounds, slight film grain',
    videoPrompt: '1950s educational cartoon style, cheerful rounded characters, flat mid-century colors, simple painted backgrounds, slight film grain',
    guard: GUARD_2D,
  },
  {
    id: 'anime_feature',
    label: 'Anime chiếu rạp',
    group: '2D',
    imagePrompt: 'high-budget 2D anime feature film style, delicate line art, soft cel shading with subtle gradients, luminous painted skies, richly detailed hand-painted backgrounds',
    videoPrompt: 'high-budget 2D anime feature film style, delicate line art, soft cel shading with subtle gradients, luminous painted skies, richly detailed hand-painted backgrounds',
    guard: GUARD_2D,
  },
  {
    id: 'pastoral_handdrawn',
    label: 'Vẽ tay đồng quê ấm áp',
    group: '2D',
    imagePrompt: 'hand-drawn 2D animation in a warm pastoral style, soft watercolor-painted backgrounds, gentle expressive linework, natural pastel palette',
    videoPrompt: 'hand-drawn 2D animation in a warm pastoral style, soft watercolor-painted backgrounds, gentle expressive linework, natural pastel palette',
    guard: GUARD_2D,
  },
  {
    id: 'shonen_action',
    label: 'Anime hành động (Shonen)',
    group: '2D',
    imagePrompt: 'dynamic shonen anime style, bold thick outlines, high-contrast cel shading, intense dramatic poses',
    videoPrompt: 'dynamic shonen anime style, bold thick outlines, high-contrast cel shading, intense dramatic poses',
    guard: GUARD_2D,
  },
  {
    id: 'anime_90s',
    label: 'Anime thập niên 90',
    group: '2D',
    imagePrompt: '1990s retro anime cel style, hand-painted cels, slightly muted colors, soft film grain',
    videoPrompt: '1990s retro anime cel style, hand-painted cels, slightly muted colors, soft film grain',
    guard: GUARD_2D,
  },
  {
    id: 'lofi_anime',
    label: 'Lo-fi anime chill',
    group: '2D',
    imagePrompt: 'cozy lo-fi anime aesthetic, soft muted colors, warm lamp light, gentle grain',
    videoPrompt: 'cozy lo-fi anime aesthetic, soft muted colors, warm lamp light, gentle grain',
    guard: GUARD_2D,
  },
  {
    id: 'chibi',
    label: 'Chibi dễ thương',
    group: '2D',
    imagePrompt: 'cute chibi 2D style, oversized heads, simple rounded shapes, soft pastel colors, thin clean outlines',
    videoPrompt: 'cute chibi 2D style, oversized heads, simple rounded shapes, soft pastel colors, thin clean outlines',
    guard: GUARD_2D,
  },
  {
    id: 'cartoon_tv',
    label: 'Cartoon nét đậm (TV)',
    group: '2D',
    imagePrompt: 'modern 2D TV cartoon style, thick uniform outlines, flat bright colors, simple geometric shapes, minimal shading',
    videoPrompt: 'modern 2D TV cartoon style, thick uniform outlines, flat bright colors, simple geometric shapes, minimal shading',
    guard: GUARD_2D,
  },
  {
    id: 'flat_vector',
    label: 'Vector phẳng (Motion graphics)',
    group: '2D',
    imagePrompt: 'flat vector illustration, no outlines, geometric shapes, limited color palette, subtle grain texture, clean motion-graphics look',
    videoPrompt: 'flat vector illustration, no outlines, geometric shapes, limited color palette, subtle grain texture, clean motion-graphics look',
    guard: GUARD_2D,
  },
  {
    id: 'storybook',
    label: 'Sách tranh màu nước',
    group: '2D',
    imagePrompt: "children's picture book illustration, soft watercolor washes, colored pencil linework, visible paper texture",
    videoPrompt: "children's picture book illustration, soft watercolor washes, colored pencil linework, visible paper texture",
    guard: GUARD_2D,
  },
  {
    id: 'manga_ink',
    label: 'Manga đen trắng',
    group: '2D',
    imagePrompt: 'black and white manga style, crisp ink linework, screentone shading, high contrast',
    videoPrompt: 'black and white manga style, crisp ink linework, screentone shading, high contrast',
    guard: GUARD_2D,
  },
  {
    id: 'comic_western',
    label: 'Truyện tranh Âu Mỹ',
    group: '2D',
    imagePrompt: 'western comic book style, bold inked outlines, halftone dots, saturated flat colors',
    videoPrompt: 'western comic book style, bold inked outlines, halftone dots, saturated flat colors',
    guard: GUARD_2D,
  },
  {
    id: 'ink_wash',
    label: 'Thủy mặc Á Đông',
    group: '2D',
    imagePrompt: 'East Asian ink wash painting style, flowing brush strokes, rice paper texture, muted colors with red accents',
    videoPrompt: 'East Asian ink wash painting style, flowing brush strokes, rice paper texture, muted colors with red accents',
    guard: GUARD_2D,
  },
  {
    id: 'paper_cutout',
    label: 'Cắt giấy nhiều lớp',
    group: '2D',
    imagePrompt: 'layered paper cut-out style, visible paper textures and torn edges, soft drop shadows between layers',
    videoPrompt: 'layered paper cut-out style, visible paper textures and torn edges, soft drop shadows between layers',
    guard: GUARD_2D,
  },
  {
    id: 'rubberhose_1930',
    label: 'Cartoon cổ điển 1930',
    group: '2D',
    imagePrompt: '1930s rubber-hose cartoon style, black and white with slight sepia, pie-cut eyes, bouncy rounded shapes, old film grain',
    videoPrompt: '1930s rubber-hose cartoon style, black and white with slight sepia, pie-cut eyes, bouncy rounded shapes, old film grain',
    guard: GUARD_2D,
  },
  {
    id: 'pixel_art',
    label: 'Pixel art 16-bit',
    group: '2D',
    imagePrompt: 'detailed 16-bit pixel art, limited palette, crisp pixels, no anti-aliasing',
    videoPrompt: 'detailed 16-bit pixel art, limited palette, crisp pixels, no anti-aliasing',
    guard: GUARD_2D,
  },
  {
    id: 'parallax_25d',
    label: '2.5D nhiều lớp (Multiplane)',
    group: '2D',
    imagePrompt: '2.5D layered illustration with multiplane depth, flat painted layers separated in depth',
    videoPrompt: '2.5D layered illustration with multiplane depth, flat painted layers separated in depth',
    guard: GUARD_2D,
  },
  // Nhóm Stylized
  {
    id: 'stylized_3d',
    label: 'Hoạt hình 3D stylized',
    group: 'Stylized',
    imagePrompt: 'stylized 3D animated film look, soft global illumination, expressive cartoon proportions',
    videoPrompt: 'stylized 3D animated film look, soft global illumination, expressive cartoon proportions',
    guard: GUARD_STYLIZED,
  },
  {
    id: 'claymation',
    label: 'Đất sét (Claymation)',
    group: 'Stylized',
    imagePrompt: 'claymation stop-motion look, handmade clay textures, visible fingerprints, miniature sets',
    videoPrompt: 'claymation stop-motion look, handmade clay textures, visible fingerprints, miniature sets',
    guard: GUARD_STYLIZED,
  },
];

export const SHOT_SIZES: CinemaItem[] = [
  { id: 'extreme_wide', label: 'Toàn cảnh rất rộng (Extreme Wide)', prompt: 'extreme wide establishing shot' },
  { id: 'wide', label: 'Toàn cảnh (Wide)', prompt: 'wide shot' },
  { id: 'full', label: 'Toàn thân (Full Shot)', prompt: 'full body shot' },
  { id: 'medium_wide', label: 'Trung toàn (Medium Wide)', prompt: 'medium wide shot from the knees up' },
  { id: 'medium', label: 'Trung cảnh (Medium)', prompt: 'medium shot from the waist up' },
  { id: 'medium_close', label: 'Cận trung (Medium Close-Up)', prompt: 'medium close-up from the chest up' },
  { id: 'close_up', label: 'Cận cảnh (Close-Up)', prompt: 'close-up on the face' },
  { id: 'extreme_close', label: 'Đặc tả (Extreme Close-Up)', prompt: 'extreme close-up on the eyes' },
  { id: 'insert', label: 'Cận chi tiết (Insert)', prompt: 'detail insert shot' },
  { id: 'pov', label: 'Góc nhìn nhân vật (POV)', prompt: 'first-person POV shot' },
  { id: 'ots', label: 'Qua vai (Over-the-Shoulder)', prompt: 'over-the-shoulder shot' },
  { id: 'two_shot', label: 'Hai người (Two-Shot)', prompt: 'two-shot framing both characters' },
];

export const CAMERA_ANGLES: CinemaItem[] = [
  { id: 'eye_level', label: 'Ngang tầm mắt', prompt: 'eye-level angle' },
  { id: 'low', label: 'Góc thấp (Low Angle)', prompt: 'low-angle shot looking up' },
  { id: 'high', label: 'Góc cao (High Angle)', prompt: 'high-angle shot looking down' },
  { id: 'top_down', label: 'Từ trên xuống (Top-Down)', prompt: "overhead bird's-eye view" },
  { id: 'worms_eye', label: 'Sát đất (Worm\'s-Eye)', prompt: "worm's-eye view from the ground" },
  { id: 'dutch', label: 'Nghiêng (Dutch Angle)', prompt: 'dutch tilted angle' },
  { id: 'profile', label: 'Nghiêng mặt (Profile)', prompt: 'side profile view' },
  { id: 'back', label: 'Sau lưng (Back View)', prompt: 'view from behind' },
];

export const CAMERA_MOVES: CinemaItem[] = [
  { id: 'hold', label: 'Giữ khung (Hold)', prompt: 'held frame with only subtle character animation' },
  { id: 'pan_slow', label: 'Lia chậm (Pan)', prompt: 'slow background pan' },
  { id: 'pan_fast', label: 'Lia nhanh', prompt: 'fast pan with motion blur' },
  { id: 'parallax_truck', label: 'Parallax trượt ngang nhiều lớp', prompt: 'multiplane parallax camera truck, foreground, midground and background layers moving at different speeds' },
  { id: 'push_in', label: 'Tiến vào (Push-In)', prompt: 'slow push-in toward the character' },
  { id: 'pull_out', label: 'Lùi mở cảnh (Pull-Out)', prompt: 'slow pull-out revealing the wider scene' },
  { id: 'snap_zoom', label: 'Zoom giật (Snap Zoom)', prompt: 'sudden snap zoom onto the character\'s face' },
  { id: 'tilt_up', label: 'Ngước lên', prompt: 'slow tilt up revealing the sky' },
  { id: 'tilt_down', label: 'Hạ xuống', prompt: 'slow tilt down from the sky to the character' },
  { id: 'crane_reveal', label: 'Bay lên lộ cảnh (Crane Reveal)', prompt: 'rising camera that reveals the vast painted landscape' },
  { id: 'follow', label: 'Bám theo', prompt: 'tracking camera following the character' },
  { id: 'run_cycle_bg', label: 'Chạy cảnh lặp (Background Slide)', prompt: 'classic anime run cycle with looping background slide' },
  { id: 'rotate_bg', label: 'Xoay nền quanh nhân vật', prompt: 'anime-style rotating background around the character' },
  { id: 'dolly_zoom', label: 'Dolly Zoom (Vertigo)', prompt: 'dolly zoom vertigo effect' },
  { id: 'whip_pan', label: 'Whip pan chuyển cảnh', prompt: 'fast whip pan with smear blur' },
  { id: 'impact_shake', label: 'Rung khung (Impact Shake)', prompt: 'camera shake on impact' },
  { id: 'focus_pull', label: 'Chuyển tiêu điểm giữa lớp', prompt: 'focus pull from the foreground layer to the character' },
  { id: 'aerial_sweep', label: 'Lướt trên cao', prompt: 'sweeping aerial view over the painted landscape' },
];

export const PERSPECTIVES: CinemaItem[] = [
  { id: 'normal', label: 'Phối cảnh thường', prompt: 'natural perspective' },
  { id: 'flat_stage', label: 'Dàn cảnh phẳng', prompt: 'flat orthographic staging' },
  { id: 'wide_dramatic', label: 'Phối cảnh rộng kịch tính', prompt: 'dramatic wide-angle perspective with strong foreshortening' },
  { id: 'fisheye', label: 'Mắt cá (Fisheye)', prompt: 'fisheye distortion' },
  { id: 'tele_compressed', label: 'Nén hậu cảnh (Tele)', prompt: 'telephoto-like compressed background' },
  { id: 'depth_blur', label: 'Nền mờ chiều sâu', prompt: 'soft background blur as in anime compositing' },
];

export const LENSES = PERSPECTIVES;

export const LIGHTINGS: CinemaItem[] = [
  { id: 'day_flat', label: 'Ban ngày trong trẻo', prompt: 'bright clear daylight' },
  { id: 'golden_glow', label: 'Hoàng hôn vàng', prompt: 'warm golden sunset glow' },
  { id: 'blue_hour', label: 'Chạng vạng xanh', prompt: 'cool blue dusk' },
  { id: 'overcast', label: 'Trời âm u dịu', prompt: 'soft overcast light' },
  { id: 'moonlit', label: 'Đêm trăng', prompt: 'cool moonlit night' },
  { id: 'neon_city', label: 'Thành phố neon', prompt: 'neon city night glow in magenta and cyan' },
  { id: 'warm_interior', label: 'Đèn trong nhà ấm', prompt: 'warm interior lamplight' },
  { id: 'candle', label: 'Ánh nến', prompt: 'flickering candlelight' },
  { id: 'magic_glow', label: 'Ánh sáng phép thuật', prompt: 'glowing magical light' },
  { id: 'rim_dramatic', label: 'Viền sáng kịch tính', prompt: 'dramatic rim light' },
  { id: 'silhouette', label: 'Ngược sáng bóng đổ', prompt: 'strong backlight silhouette' },
  { id: 'light_beams', label: 'Tia nắng anime', prompt: 'anime-style light beams through windows or trees' },
];

export const WEATHERS: CinemaItem[] = [
  { id: 'clear', label: 'Quang đãng', prompt: '' },
  { id: 'cherry_blossom', label: 'Hoa anh đào bay', prompt: 'drifting cherry blossom petals' },
  { id: 'light_rain', label: 'Mưa nhẹ', prompt: 'light rain' },
  { id: 'heavy_rain', label: 'Mưa lớn', prompt: 'heavy rain' },
  { id: 'snow', label: 'Tuyết rơi', prompt: 'gentle snowfall' },
  { id: 'fog', label: 'Sương mù', prompt: 'drifting fog and mist' },
  { id: 'dust', label: 'Bụi gió', prompt: 'wind-blown dust' },
  { id: 'wind', label: 'Gió mạnh', prompt: 'strong wind moving hair and clothes' },
  { id: 'smoke', label: 'Khói mờ', prompt: 'hazy atmospheric smoke' },
];

export const EFFECTS: CinemaItem[] = [
  { id: 'speed_lines', label: 'Đường tốc độ', prompt: 'anime speed lines' },
  { id: 'impact_frame', label: 'Impact frame', prompt: 'high-contrast impact frame flash' },
  { id: 'sparkles', label: 'Lấp lánh', prompt: 'sparkling glints and twinkles' },
  { id: 'light_bloom', label: 'Phát sáng mềm', prompt: 'soft anime light bloom' },
  { id: 'anime_flare', label: 'Vệt lóa anime', prompt: 'anime-style lens flare streaks' },
  { id: 'smear', label: 'Smear frame', prompt: 'fluid smear frames on fast motion' },
  { id: 'on_twos', label: 'Nhịp vẽ tay (on twos)', prompt: 'animated on twos with a hand-drawn cadence' },
  { id: 'emotion_marks', label: 'Ký hiệu cảm xúc', prompt: 'anime emotion marks such as sweat drops and blush lines' },
  { id: 'dust_motes', label: 'Hạt bụi trong nắng', prompt: 'floating dust motes in the light' },
  { id: 'rain_streaks', label: 'Vệt mưa', prompt: 'stylized rain streaks' },
  { id: 'magic_particles', label: 'Hạt phép thuật', prompt: 'glowing magic particles' },
  { id: 'wind_lines', label: 'Đường gió', prompt: 'wind lines and fluttering cloth' },
  { id: 'petals', label: 'Cánh hoa bay', prompt: 'drifting flower petals' },
  { id: 'paper_grain', label: 'Hạt giấy', prompt: 'subtle paper grain texture' },
  { id: 'vignette', label: 'Viền tối (Vignette)', prompt: 'soft vignette' },
];

export const SHOT_RECIPES: ShotRecipe[] = [
  {
    id: 'patent_reveal',
    label: 'Tiết lộ sáng chế (Bản vẽ)',
    description: 'Cận chi tiết máy móc, lia chậm hoặc đẩy vào, hạt giấy và viền tối',
    shotSize: 'insert',
    cameraAngle: 'eye_level',
    cameraMovement: 'pan_slow',
    lens: 'flat_stage',
    effects: ['paper_grain', 'vignette'],
  },
  {
    id: 'machine_closeup',
    label: 'Đặc tả cơ cấu máy móc',
    description: 'Cận chi tiết bánh răng, trục xoay cơ khí, ánh viền kịch tính',
    shotSize: 'insert',
    cameraAngle: 'low',
    cameraMovement: 'push_in',
    lens: 'depth_blur',
    lighting: 'rim_dramatic',
    effects: ['dust_motes'],
  },
  {
    id: 'experiment_fail',
    label: 'Thử nghiệm thất bại hài hước',
    description: 'Rung lắc rung khung impact shake, khói bụi, góc nghiêng dutch',
    shotSize: 'medium_wide',
    cameraAngle: 'dutch',
    cameraMovement: 'impact_shake',
    lens: 'wide_dramatic',
    effects: ['emotion_marks'],
  },
  {
    id: 'establishing',
    label: 'Mở cảnh hoành tráng',
    description: 'Toàn cảnh từ trên cao với tia sáng và bụi nắng',
    shotSize: 'extreme_wide',
    cameraAngle: 'high',
    cameraMovement: 'crane_reveal',
    lens: 'normal',
    lighting: 'light_beams',
    effects: ['dust_motes'],
  },
  {
    id: 'hero_intro',
    label: 'Giới thiệu nhân vật',
    description: 'Toàn thân góc thấp, camera tiến vào, ánh viền sáng',
    shotSize: 'full',
    cameraAngle: 'low',
    cameraMovement: 'push_in',
    lens: 'wide_dramatic',
    lighting: 'rim_dramatic',
    effects: ['sparkles'],
  },
  {
    id: 'emotional_close',
    label: 'Cận cảm xúc',
    description: 'Cận mặt, nền mờ chiều sâu, ánh hoàng hôn dịu',
    shotSize: 'close_up',
    cameraAngle: 'eye_level',
    cameraMovement: 'push_in',
    lens: 'depth_blur',
    lighting: 'golden_glow',
    effects: ['light_bloom'],
  },
  {
    id: 'dialogue_ots',
    label: 'Đối thoại qua vai',
    description: 'Qua vai nhân vật, giữ khung, nền mờ chiều sâu',
    shotSize: 'ots',
    cameraAngle: 'eye_level',
    cameraMovement: 'hold',
    lens: 'depth_blur',
    effects: [],
  },
  {
    id: 'action_burst',
    label: 'Hành động bùng nổ',
    description: 'Trung toàn góc nghiêng, whip pan, đường tốc độ & impact frame',
    shotSize: 'medium_wide',
    cameraAngle: 'dutch',
    cameraMovement: 'whip_pan',
    lens: 'wide_dramatic',
    lighting: 'rim_dramatic',
    effects: ['speed_lines', 'impact_frame', 'smear'],
  },
  {
    id: 'sprint',
    label: 'Chạy nước rút',
    description: 'Toàn thân chạy lặp nền anime, đường gió và tốc độ',
    shotSize: 'full',
    cameraAngle: 'eye_level',
    cameraMovement: 'run_cycle_bg',
    lens: 'normal',
    effects: ['speed_lines', 'wind_lines'],
  },
  {
    id: 'magic_transform',
    label: 'Biến hình phép thuật',
    description: 'Trung cảnh góc thấp xoay nền, hạt phép thuật và phát sáng',
    shotSize: 'medium',
    cameraAngle: 'low',
    cameraMovement: 'rotate_bg',
    lens: 'wide_dramatic',
    lighting: 'magic_glow',
    effects: ['magic_particles', 'light_bloom'],
  },
  {
    id: 'comedy_beat',
    label: 'Khoảnh khắc hài',
    description: 'Cận trung snap zoom với ký hiệu cảm xúc anime',
    shotSize: 'medium_close',
    cameraAngle: 'eye_level',
    cameraMovement: 'snap_zoom',
    lens: 'normal',
    effects: ['emotion_marks'],
  },
  {
    id: 'flashback',
    label: 'Hồi tưởng',
    description: 'Dàn cảnh phẳng, ánh u tối, hiệu ứng hạt giấy & viền tối',
    shotSize: 'medium',
    cameraAngle: 'eye_level',
    cameraMovement: 'hold',
    lens: 'flat_stage',
    lighting: 'overcast',
    effects: ['paper_grain', 'vignette'],
  },
  {
    id: 'quiet_ending',
    label: 'Kết lắng đọng',
    description: 'Toàn cảnh lùi mở, hoàng hôn với cánh hoa và bụi nắng',
    shotSize: 'wide',
    cameraAngle: 'eye_level',
    cameraMovement: 'pull_out',
    lens: 'normal',
    lighting: 'golden_glow',
    effects: ['dust_motes', 'petals'],
  },
];

export function getItem(list: CinemaItem[], idOrText?: string): CinemaItem {
  if (!idOrText) {
    return { id: '', label: '', prompt: '' };
  }
  const found = list.find((item) => item.id === idOrText);
  if (found) return found;

  return { id: idOrText, label: idOrText, prompt: idOrText };
}

export function getLook(lookId?: string): LookItem {
  const defaultLook = LOOKS[0]; // anime_cel
  if (!lookId) return defaultLook;
  return LOOKS.find((l) => l.id === lookId) || defaultLook;
}
