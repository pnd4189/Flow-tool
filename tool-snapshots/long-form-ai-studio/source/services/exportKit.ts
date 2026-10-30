import { Flow } from 'flow-sdk';
import { Shot, Scene, ProjectConfig, getActiveTake } from './types';
import { getLook } from './library';

/**
 * Hàm DUY NHẤT để tạo slug dự án thống nhất:
 * - Cắt tối đa 24 ký tự
 * - Bỏ dấu tiếng Việt, chuyển chữ thường
 * - Ký tự ngoài [a-z0-9] chuyển thành '_'
 * - Dùng chung cho mọi tên file (clip, keyframe, manifest, concat_list, narration, storyboard, session)
 */
export function projectSlug(title?: string, defaultFallback = 'project'): string {
  if (!title) return defaultFallback;
  const normalized = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  const capped = normalized.slice(0, 24);
  return capped || defaultFallback;
}

/** Chuẩn hoá chuỗi slug nhỏ (cho scene, shot) */
export function sanitizeSlug(text: string, defaultFallback = 'shot', maxLen = 20): string {
  if (!text) return defaultFallback;
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  const capped = normalized.slice(0, maxLen);
  return capped || defaultFallback;
}

/** Tên file clip chuẩn dùng projectSlug chung: ${pSlug}_${NNN}_${sceneSlug}_${shotSlug}_t${takeIndex}.mp4 */
export function generateTakeExportFilename(params: {
  projectTitle: string;
  order: number;
  sceneTitle: string;
  actionBeat: string;
  takeIndex: number;
}): string {
  const pSlug = projectSlug(params.projectTitle);
  const nnn = String(params.order).padStart(3, '0');
  const sceneSlug = sanitizeSlug(params.sceneTitle, 'sc', 15);
  const shotSlug = sanitizeSlug(params.actionBeat, 'shot', 20);
  const tIdx = Math.max(1, params.takeIndex);
  return `${pSlug}_${nnn}_${sceneSlug}_${shotSlug}_t${tIdx}.mp4`;
}

/** Format giây thành chuỗi thời gian [MM:SS.S] */
export function formatTimestampMMSS(seconds: number): string {
  const totalTenths = Math.round(seconds * 10);
  const totalSecs = Math.floor(totalTenths / 10);
  const tenths = totalTenths % 10;
  const mm = String(Math.floor(totalSecs / 60)).padStart(2, '0');
  const ss = String(totalSecs % 60).padStart(2, '0');
  return `${mm}:${ss}.${tenths}`;
}

export interface EditManifest {
  version: 1;
  title: string;
  mode: string;
  aspectRatio: string;
  look: {
    id: string;
    label: string;
  };
  createdAt: number;
  totalDurationSeconds: number;
  scenes: Array<{
    id: string;
    title: string;
    eraLabel?: string;
    environment: string;
  }>;
  shots: Array<{
    order: number;
    fileName: string;
    durationSeconds: number;
    sceneTitle: string;
    transitionIn: string;
    narration?: string;
    dialogue?: string;
    eraLabel?: string;
    factNote?: string;
    ambient?: string;
    sfx?: string;
    effects?: string[];
    cameraMovement?: string;
    qc?: {
      score: number;
      verdict: string;
    };
    takeIndex: number;
    mediaId?: string;
  }>;
}

/** Tạo đối tượng Manifest Hậu kỳ v1 - fileName của shots luôn khớp với generateTakeExportFilename */
export function buildEditManifest(params: {
  projectTitle: string;
  config: ProjectConfig;
  scenes: Scene[];
  shots: Shot[];
}): EditManifest {
  const { projectTitle, config, scenes, shots } = params;
  const look = getLook(config.lookId);
  const sceneMap = new Map<string, Scene>();
  scenes.forEach((s) => sceneMap.set(s.id, s));

  let totalDuration = 0;

  const manifestShots = shots.map((sh) => {
    const activeTake = getActiveTake(sh);
    const takeIndex = (sh.takes && activeTake)
      ? Math.max(1, sh.takes.findIndex((t) => t.id === activeTake.id) + 1)
      : 1;

    const sc = sceneMap.get(sh.sceneId);
    const duration = activeTake?.durationSeconds || sh.durationOverride || config.durationSeconds;
    totalDuration += duration;

    const fileName = generateTakeExportFilename({
      projectTitle,
      order: sh.order,
      sceneTitle: sc?.title || 'Scene',
      actionBeat: sh.actionBeat || 'shot',
      takeIndex,
    });

    return {
      order: sh.order,
      fileName,
      durationSeconds: duration,
      sceneTitle: sc?.title || 'Scene',
      transitionIn: sh.transitionIn,
      narration: sh.narration?.trim() || undefined,
      dialogue: sh.audioDialogue?.trim() || undefined,
      eraLabel: sh.eraLabel?.trim() || undefined,
      factNote: sh.factNote?.trim() || undefined,
      ambient: sh.ambient?.trim() || undefined,
      sfx: sh.audioSfx?.trim() || undefined,
      effects: sh.effects && sh.effects.length > 0 ? sh.effects : undefined,
      cameraMovement: sh.cameraMovement,
      qc: activeTake?.qc
        ? {
            score: activeTake.qc.totalScore,
            verdict: activeTake.qc.verdict,
          }
        : undefined,
      takeIndex,
      mediaId: activeTake?.mediaId,
    };
  });

  return {
    version: 1,
    title: projectTitle,
    mode: config.mode,
    aspectRatio: config.aspectRatio,
    look: {
      id: look.id,
      label: look.label,
    },
    createdAt: Date.now(),
    totalDurationSeconds: totalDuration,
    scenes: scenes.map((s) => ({
      id: s.id,
      title: s.title,
      environment: s.environment,
    })),
    shots: manifestShots,
  };
}

/** Sinh nội dung concat list cho ffmpeg: mỗi dòng `file '<fileName>'`, khớp 100% tên file clip thật */
export function buildConcatListText(manifest: EditManifest): string {
  const lines = manifest.shots.map((sh) => `file '${sh.fileName}'`);
  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

/** Sinh danh sách lời dẫn cộng dồn thời lượng: [00:08.0 – 00:16.0] #2 Paris, 1769 — <narration> */
export function buildNarrationTimelineText(manifest: EditManifest): string {
  const lines: string[] = [];
  let currentTime = 0;

  for (const sh of manifest.shots) {
    const startTime = currentTime;
    const endTime = currentTime + sh.durationSeconds;
    currentTime = endTime;

    if (sh.narration && sh.narration.trim().length > 0) {
      const startStr = formatTimestampMMSS(startTime);
      const endStr = formatTimestampMMSS(endTime);
      const eraPart = sh.eraLabel ? ` ${sh.eraLabel} — ` : ' — ';
      lines.push(`[${startStr} – ${endStr}] #${sh.order}${eraPart}${sh.narration.trim()}`);
    }
  }

  if (lines.length === 0) {
    return 'Chưa có shot nào có lời dẫn (narration).\n';
  }

  return lines.join('\n\n') + '\n';
}

/** Sinh bảng storyboard markdown | # | Scene | Tên clip | Máy quay | Lời dẫn | Ghi chú sự thật | */
export function buildStoryboardMarkdown(manifest: EditManifest): string {
  const rows: string[] = [
    `# Bảng Storyboard Hậu Kỳ: ${manifest.title}`,
    `*Thời lượng ước tính: ${manifest.totalDurationSeconds}s • Tỉ lệ: ${manifest.aspectRatio} • Phong cách: ${manifest.look.label}*`,
    '',
    '| # | Scene | Tên clip | Máy quay | Lời dẫn | Ghi chú sự thật |',
    '|---|---|---|---|---|---|',
  ];

  for (const sh of manifest.shots) {
    const cleanNarration = (sh.narration || '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const cleanFact = (sh.factNote || '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const camera = `${sh.cameraMovement || '—'}`;

    rows.push(
      `| ${sh.order} | ${sh.sceneTitle} | ${sh.fileName} | ${camera} | ${cleanNarration} | ${cleanFact} |`
    );
  }

  return rows.join('\n') + '\n';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chuyển text UTF-8 sang raw base64 an toàn */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Tải lần lượt 4 file trong Gói Hậu Kỳ (dùng projectSlug chung):
 * 1. ${pSlug}_edit_manifest.json (application/json)
 * 2. ${pSlug}_concat_list.txt (text/plain)
 * 3. ${pSlug}_narration.txt (text/plain)
 * 4. ${pSlug}_storyboard.md (text/markdown)
 */
export async function downloadPostProductionKit(params: {
  projectTitle: string;
  config: ProjectConfig;
  scenes: Scene[];
  shots: Shot[];
  onProgress?: (fileIndex: number, totalFiles: number, filename: string) => void;
}): Promise<{ downloadedFiles: string[] }> {
  const { projectTitle, config, scenes, shots, onProgress } = params;
  const pSlug = projectSlug(projectTitle);

  const manifest = buildEditManifest({ projectTitle, config, scenes, shots });
  const concatText = buildConcatListText(manifest);
  const narrationText = buildNarrationTimelineText(manifest);
  const storyboardMd = buildStoryboardMarkdown(manifest);

  const kitFiles: Array<{ filename: string; mimeType: 'application/json' | 'text/plain' | 'text/markdown'; content: string }> = [
    {
      filename: `${pSlug}_edit_manifest.json`,
      mimeType: 'application/json',
      content: JSON.stringify(manifest, null, 2),
    },
    {
      filename: `${pSlug}_concat_list.txt`,
      mimeType: 'text/plain',
      content: concatText,
    },
    {
      filename: `${pSlug}_narration.txt`,
      mimeType: 'text/plain',
      content: narrationText,
    },
    {
      filename: `${pSlug}_storyboard.md`,
      mimeType: 'text/markdown',
      content: storyboardMd,
    },
  ];

  const downloadedFiles: string[] = [];

  for (let i = 0; i < kitFiles.length; i++) {
    const file = kitFiles[i];
    if (onProgress) onProgress(i + 1, kitFiles.length, file.filename);

    const base64 = utf8ToBase64(file.content);
    await Flow.download({
      base64,
      mimeType: file.mimeType,
      filename: file.filename,
    });

    downloadedFiles.push(file.filename);
    if (i < kitFiles.length - 1) {
      await sleep(1000);
    }
  }

  return { downloadedFiles };
}
