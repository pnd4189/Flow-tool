export type ProjectMode = 'long' | 'short';

export type VideoModel =
  | 'Omni 1.1 Flash'
  | 'Veo 3.1 - Lite'
  | 'Veo 3.1 - Fast'
  | 'Veo 3.1 - Quality';

export type ImageModel =
  | '🍌 Nano Banana 2.1'
  | '🍌 Nano Banana Pro';

export type VideoResolution = '360p' | '720p';

export interface ProjectConfig {
  mode: ProjectMode;
  targetShots: number;
  videoModel: VideoModel;
  imageModel: ImageModel;
  resolution: VideoResolution;
  durationSeconds: number; // 4, 6, 8, 10
  aspectRatio: '16:9' | '9:16';
  lookId: string; // id trong LOOKS (mặc định 'anime_cel')
  customStyle: string; // Phong cách tùy chỉnh ngắn
}

// 8 trường DNA nhân vật 2D hoạt hình (Bắt buộc tiếng Anh cho prompt model)
export interface CharacterDNA {
  faceShape: string;       // Khuôn mặt & đầu (English)
  eyes: string;            // Mắt (hình dạng, màu) (English)
  hairstyle: string;       // Tóc (kiểu, màu) (English)
  skinTone: string;        // Màu da (English)
  outfit: string;          // Trang phục (English)
  accessories: string;     // Phụ kiện (English)
  proportions: string;     // Tỉ lệ cơ thể (VD: 6 heads tall, chibi 2 heads) (English)
  palette: string;         // Màu chủ đạo (VD: #1E3A8A navy, #F5B301 amber) (English)
  facialStructure?: string;
}

export interface Character {
  id: string;
  name: string;
  dna: CharacterDNA;
  mediaId?: string;
  thumbBase64?: string;
  mimeType?: string;
  locked: boolean;
  createdAt: number;
}

export interface KeyframeInfo {
  mediaId: string;
  thumbBase64: string; // JPEG <= 420px, 0.8
  promptUsed?: string;
  aspectRatio?: '16:9' | '9:16'; // Tỉ lệ khung hình lúc tạo để phát hiện khi đổi Long/Short
}

// Kết quả kiểm tra chất lượng AI (services/qcService.ts, 0 credit)
export interface QCResult {
  onModel: number;       // 0-100: nhân vật đúng thiết kế, màu, trang phục
  style2D: number;       // 0-100: giữ nét vẽ 2D phẳng
  continuity: number;    // 0-100: khung đầu/cuối khớp keyframe
  action: number;        // 0-100: đúng hành động mô tả
  totalScore: number;    // Điểm trung bình 4 tiêu chí
  artifacts: string[];   // lỗi tiếng Việt ngắn: tay lỗi, mặt méo, chữ lạ...
  verdict: 'ok' | 'review' | 'rerender';
  note: string;          // nhận xét tiếng Việt <= 20 từ
  checkedAt: number;
}

// Bản ghi một lần quay video (Take)
export interface VideoTake {
  id: string;
  mediaId: string;
  blobUrl?: string;
  sizeBytes: number;
  model: VideoModel;
  durationSeconds: number;
  resolution: VideoResolution;
  aspectRatio: '16:9' | '9:16';
  creditCost: number;
  renderedAt: number;
  promptUsed: string;
  firstFrameMediaId?: string;
  lastFrameMediaId?: string;
  qc?: QCResult;
  stale?: boolean; // Đánh dấu lệch mạch khi keyframe hiện tại của shot đã đổi
}

// Bản khoá shot (Chống lệch kịch bản)
export interface ShotLock {
  prompt: string;
  firstFrameMediaId?: string;
  lastFrameMediaId?: string;
  model: VideoModel;
  durationSeconds: number;
  resolution: VideoResolution;
  lockedAt: number;
}

// Tương thích ngược VideoRenderInfo đơn
export interface VideoRenderInfo {
  mediaId: string;
  blobUrl: string;
  mimeType: string;
  model: VideoModel;
  durationSeconds: number;
  resolution: VideoResolution;
  aspectRatio: '16:9' | '9:16';
  creditCost: number;
  sizeBytes: number;
  renderedAt: number;
}

export interface Scene {
  id: string;
  title: string;
  environment: string;      // Tiếng Anh (dùng trong prompt hình ảnh/video)
  environmentVi?: string;    // Tiếng Việt (chỉ dùng để hiển thị giao diện)
  timeOfDay: string;        // Tiếng Anh (Daylight, Golden hour, Night...)
  ambientDefault: string;
  lightingDefault: string;
  weather?: string; // id trong WEATHERS
  locationRef?: {
    mediaId: string;
    thumbBase64: string;
  };
}

export interface Shot {
  id: string;
  sceneId: string;
  order: number; // 1-based order
  actionBeat: string;       // Tiếng Việt hiển thị
  action?: string;           // Mô tả hành động bằng tiếng Anh dùng cho video; trống thì dùng actionBeat
  actionVi?: string;         // Mô tả hiển thị tiếng Việt
  subject?: string;          // Tiếng Anh (chủ thể)
  characterIds: string[];    // ID các nhân vật trong Vault
  characterNames?: string[]; // Tên nhân vật do kịch bản/AI ghi nhận (lưu lại để auto-bind khi vault cập nhật)
  shotSize: string; // id thư viện
  cameraAngle: string;
  cameraMovement: string;
  lens: string; // PERSPECTIVE id
  lighting: string;
  weather?: string; // id trong WEATHERS
  effects: string[]; // mảng id trong EFFECTS (tối đa 3)
  transitionIn: 'chain' | 'cut';
  audioDialogue: string;
  audioSfx: string;          // Tiếng Anh (sfx prompt)
  ambient: string;           // Tiếng Anh (ambient prompt)
  startPose: string;         // Tiếng Anh (start pose prompt)
  endPose: string;           // Tiếng Anh (end pose prompt)

  narration?: string;        // Lời dẫn giọng đọc off-screen (theo ngôn ngữ đã chọn)
  eraLabel?: string;         // Nhãn thời đại (VD: "London, 1890") - chỉ hiển thị/hậu kỳ, cấm đưa vào prompt
  factNote?: string;         // Ghi chú sự thật lịch sử để người dùng kiểm chứng

  startKeyframe?: KeyframeInfo;
  endKeyframe?: KeyframeInfo;

  // NHIỀU LẦN QUAY (TAKES) & KHOÁ SHOT
  takes?: VideoTake[];
  activeTakeId?: string;
  lock?: ShotLock;

  // Model override riêng cho shot
  modelOverride?: VideoModel;
  durationOverride?: number;
  resolutionOverride?: VideoResolution;

  // Cờ đánh dấu người dùng đã chỉnh tay camera/shotSize (variety.ts không tự đổi)
  userEdited?: boolean;

  // Tương thích ngược phiên cũ
  video?: VideoRenderInfo;
  renderStatus?: 'idle' | 'rendering' | 'done' | 'error';
  renderError?: string;
}

export type ShotsUpdateFn = (prev: Shot[]) => Shot[];
export type ShotsUpdate = Shot[] | ShotsUpdateFn;

export type ShotPatch = Partial<Shot> | ((s: Shot) => Shot);

/** Helper lấy take active của một shot, fallback tương thích video đơn */
export function getActiveTake(shot: Shot): VideoTake | undefined {
  if (shot.takes && shot.takes.length > 0) {
    if (shot.activeTakeId) {
      const found = shot.takes.find((t) => t.id === shot.activeTakeId);
      if (found) return found;
    }
    return shot.takes[shot.takes.length - 1];
  }

  // Tương thích ngược phiên cũ lưu qua shot.video
  if (shot.video) {
    return {
      id: `legacy_${shot.id}`,
      mediaId: shot.video.mediaId,
      blobUrl: shot.video.blobUrl,
      sizeBytes: shot.video.sizeBytes || 0,
      model: shot.video.model,
      durationSeconds: shot.video.durationSeconds,
      resolution: shot.video.resolution,
      aspectRatio: shot.video.aspectRatio,
      creditCost: shot.video.creditCost,
      renderedAt: shot.video.renderedAt,
      promptUsed: shot.action || shot.actionBeat,
      firstFrameMediaId: shot.startKeyframe?.mediaId,
      lastFrameMediaId: shot.endKeyframe?.mediaId,
    };
  }

  return undefined;
}
