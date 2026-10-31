import { Flow } from 'flow-sdk';
import type { PromptItem, SupportedAspectRatio } from '../types';

export const VALID_ASPECT_RATIOS: SupportedAspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];

export function containsVietnamese(str: string): boolean {
  return /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(str);
}

/**
 * Chuẩn hoá O(1) phục vụ Map Deduplication O(n)
 */
export function normalizeForDeduplication(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapToNearestAspectRatio(ratioStr: string): { ratio: SupportedAspectRatio; mappedNote?: string } {
  const clean = ratioStr.trim().replace(/\s+/g, '');
  if (VALID_ASPECT_RATIOS.includes(clean as SupportedAspectRatio)) {
    return { ratio: clean as SupportedAspectRatio };
  }

  const match = clean.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (match) {
    const w = parseFloat(match[1]);
    const h = parseFloat(match[2]);
    const val = w / h;
    const targets: { ratio: SupportedAspectRatio; val: number }[] = [
      { ratio: '1:1', val: 1 },
      { ratio: '16:9', val: 16 / 9 },
      { ratio: '9:16', val: 9 / 16 },
      { ratio: '4:3', val: 4 / 3 },
      { ratio: '3:4', val: 3 / 4 },
    ];
    let closest = targets[0];
    let minDiff = Math.abs(val - closest.val);
    for (const t of targets) {
      const diff = Math.abs(val - t.val);
      if (diff < minDiff) {
        minDiff = diff;
        closest = t;
      }
    }
    return { ratio: closest.ratio, mappedNote: `Đã quy đổi tỷ lệ ${clean} về ${closest.ratio}` };
  }

  return { ratio: '16:9' };
}

export interface ParseResult {
  detectedFormat: string;
  items: PromptItem[];
  confidenceWarning?: string;
}

interface ActiveDraft {
  orderIndex: number;
  titleHint?: string;
  textParts: string[];
  aspectRatio?: SupportedAspectRatio;
  negativeParts: string[];
  warnings: string[];
  rawLines: string[];
}

const EXPLICIT_MARKER_REGEX =
  /^(?:prompt\s*(?:#|\b)?\d+|ảnh\s*(?:#|\b)?\d+|hình\s*(?:#|\b)?\d+|image\s*(?:#|\b)?\d+|scene\s*(?:#|\b)?\d+|cảnh\s*(?:#|\b)?\d+|---\s*scene\s*\d+\s*---|\[\d+\]|#\d+)(?:[:\-\s]|$)/i;

const NUMBERED_LIST_REGEX = /^\s*(\d+)(?:\.|\)|\s+-|\/)\s+/;
const NUMBERED_PAREN_REGEX = /^\s*\(\d+\)\s+/;
const MD_HEADER_REGEX = /^#{1,4}\s+(.+)$/;
const HR_REGEX = /^(?:-{3,}|={3,}|\*{3,}|_{3,})$/;
const PARAM_NEGATIVE_REGEX = /^(?:negative\s*prompt|negative|tránh|avoid)\s*:\s*(.*)$/i;
const PARAM_RATIO_REGEX = /^(?:ratio|aspect\s*ratio|aspect|tỉ\s*lệ|tỷ\s*lệ)\s*:\s*(.*)$/i;

function yieldLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

/**
 * Hỗ trợ phân tích file lớn 300–1000 prompt (<= 2MB)
 * Có hỗ trợ callback onProgress và nhường luồng định kỳ
 */
export async function parsePromptTextAsync(
  rawInput: string,
  defaultRatio: SupportedAspectRatio = '16:9',
  onProgress?: (percent: number, msg: string) => void
): Promise<ParseResult> {
  const text = rawInput.trim();
  if (!text) {
    return { detectedFormat: 'Trống', items: [] };
  }

  // 1. JSON
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const array = Array.isArray(parsed) ? parsed : [parsed];
      const items: PromptItem[] = [];

      for (let idx = 0; idx < array.length; idx++) {
        const entry = array[idx];
        if (!entry) continue;
        let promptVal = '';
        let titleVal = '';
        let ratioVal: SupportedAspectRatio | undefined;
        let negVal: string | undefined;

        if (typeof entry === 'string') {
          promptVal = entry;
        } else if (typeof entry === 'object') {
          promptVal = entry.prompt || entry.text || entry.description || '';
          titleVal = entry.title || entry.name || '';
          if (entry.aspect || entry.ratio || entry.aspectRatio) {
            const mapped = mapToNearestAspectRatio(String(entry.aspect || entry.ratio || entry.aspectRatio));
            ratioVal = mapped.ratio;
          }
          negVal = entry.negative || entry.negativePrompt || undefined;
        }

        if (promptVal && promptVal.trim().length >= 8) {
          items.push(createPromptItem(idx + 1, promptVal, titleVal, ratioVal || defaultRatio, negVal));
        }

        if (idx % 100 === 0 && onProgress) {
          onProgress(Math.round((idx / array.length) * 100), `Đang phân tích JSON… ${Math.round((idx / array.length) * 100)}%`);
          await yieldLoop();
        }
      }

      if (items.length > 0) {
        return { detectedFormat: 'JSON', items: finalizeItems(items) };
      }
    } catch {
      // tiếp tục
    }
  }

  const allLines = rawInput.split(/\r?\n/);
  const totalLines = allLines.length;

  // 2. CSV
  if (allLines.length > 1 && allLines[0].includes(',')) {
    const firstLower = allLines[0].toLowerCase();
    if (firstLower.includes('prompt') || firstLower.includes('text') || firstLower.includes('title')) {
      const csvItems = parseCsvFormat(allLines, defaultRatio);
      if (csvItems.length > 0) {
        return { detectedFormat: 'CSV', items: finalizeItems(csvItems) };
      }
    }
  }

  // 3. Mỗi dòng 1 prompt
  const hasBlankLines = allLines.some((l) => l.trim() === '');
  const hasAnyMarker = allLines.some(
    (l) =>
      EXPLICIT_MARKER_REGEX.test(l.trim()) ||
      NUMBERED_LIST_REGEX.test(l.trim()) ||
      NUMBERED_PAREN_REGEX.test(l.trim()) ||
      MD_HEADER_REGEX.test(l.trim()) ||
      HR_REGEX.test(l.trim())
  );
  const longLinesCount = allLines.filter((l) => l.trim().length >= 20).length;

  if (!hasBlankLines && !hasAnyMarker && allLines.length >= 2 && longLinesCount >= 2) {
    const singleLineItems: PromptItem[] = [];
    for (let idx = 0; idx < allLines.length; idx++) {
      const trimmed = allLines[idx].trim();
      if (trimmed.length >= 8) {
        singleLineItems.push(createPromptItem(idx + 1, trimmed, '', defaultRatio));
      }
      if (idx % 80 === 0 && onProgress) {
        onProgress(Math.round((idx / totalLines) * 100), `Đang phân tích… ${Math.round((idx / totalLines) * 100)}%`);
        await yieldLoop();
      }
    }
    if (singleLineItems.length > 0) {
      return {
        detectedFormat: `Mỗi dòng 1 prompt • ${singleLineItems.length} prompt`,
        items: finalizeItems(singleLineItems),
      };
    }
  }

  // 4. Thuật toán tổng hợp nhường luồng (Chunking)
  const drafts: ActiveDraft[] = [];
  let currentDraft: ActiveDraft | null = null;
  let prevLineWasBlankOrHr = false;
  const encounteredFeatures = new Set<string>();

  const startNewDraft = (titleHint?: string, initialText?: string, rawLine?: string) => {
    if (currentDraft) {
      drafts.push(currentDraft);
    }
    currentDraft = {
      orderIndex: drafts.length + 1,
      titleHint: titleHint || undefined,
      textParts: initialText ? [initialText] : [],
      negativeParts: [],
      warnings: [],
      rawLines: rawLine ? [rawLine] : [],
    };
  };

  const chunkSizeLines = 60;
  const isHeaderOnlyLine = (t: string): boolean => {
    if (MD_HEADER_REGEX.test(t)) return true;
    const m = t.match(EXPLICIT_MARKER_REGEX);
    return !!m && t.slice(m[0].length).trim() === '';
  };
  const headerBlocks = allLines.filter((l) => isHeaderOnlyLine(l.trim())).length >= 2;
  let draftOwnedByHeader = false;

  for (let i = 0; i < totalLines; i++) {
    if (i > 0 && i % chunkSizeLines === 0) {
      if (onProgress) {
        const pct = Math.round((i / totalLines) * 100);
        onProgress(pct, `Đang phân tích… ${pct}%`);
      }
      await yieldLoop();
    }

    const rawLine = allLines[i];
    const trimmed = rawLine.trim();

    if (HR_REGEX.test(trimmed)) {
      encounteredFeatures.add('Dòng phân cách');
      prevLineWasBlankOrHr = true;
      continue;
    }

    if (!trimmed) {
      prevLineWasBlankOrHr = true;
      continue;
    }

    const negMatch = trimmed.match(PARAM_NEGATIVE_REGEX);
    if (negMatch) {
      encounteredFeatures.add('Dòng tham số');
      if (!currentDraft) startNewDraft(undefined, undefined, rawLine);
      const negVal = negMatch[1].trim();
      if (negVal) currentDraft!.negativeParts.push(negVal);
      currentDraft!.rawLines.push(rawLine);
      prevLineWasBlankOrHr = false;
      continue;
    }

    const ratioMatch = trimmed.match(PARAM_RATIO_REGEX);
    if (ratioMatch) {
      encounteredFeatures.add('Dòng tham số');
      if (!currentDraft) startNewDraft(undefined, undefined, rawLine);
      const ratioStr = ratioMatch[1].trim();
      if (ratioStr) {
        const mapped = mapToNearestAspectRatio(ratioStr);
        currentDraft!.aspectRatio = mapped.ratio;
        if (mapped.mappedNote) currentDraft!.warnings.push(mapped.mappedNote);
      }
      currentDraft!.rawLines.push(rawLine);
      prevLineWasBlankOrHr = false;
      continue;
    }

    if (/^--(?:ar|aspect|no|v|style|q|s|chaos|seed|niji)\b/i.test(trimmed)) {
      encounteredFeatures.add('Cờ tham số');
      if (!currentDraft) startNewDraft(undefined, undefined, rawLine);
      applyFlagsToDraft(currentDraft!, trimmed);
      currentDraft!.rawLines.push(rawLine);
      prevLineWasBlankOrHr = false;
      continue;
    }

    let isBoundary = false;
    let titleHint: string | undefined = undefined;
    let lineContent = trimmed;

    if (EXPLICIT_MARKER_REGEX.test(trimmed)) {
      isBoundary = true;
      encounteredFeatures.add('Marker (Prompt/Ảnh)');
      const match = trimmed.match(EXPLICIT_MARKER_REGEX);
      if (match) {
        titleHint = match[0].replace(/^[-\s]+|[:\-\s]+$/g, '').trim();
        lineContent = trimmed.slice(match[0].length).trim();
      }
    } else if (NUMBERED_LIST_REGEX.test(trimmed)) {
      isBoundary = true;
      encounteredFeatures.add('Danh sách đánh số');
      const match = trimmed.match(NUMBERED_LIST_REGEX);
      if (match) {
        titleHint = `Prompt ${match[1]}`;
        lineContent = trimmed.slice(match[0].length).trim();
      }
    } else if (NUMBERED_PAREN_REGEX.test(trimmed)) {
      isBoundary = true;
      encounteredFeatures.add('Danh sách đánh số');
      const match = trimmed.match(NUMBERED_PAREN_REGEX);
      if (match) {
        titleHint = match[0].replace(/[()\s]/g, '').trim();
        lineContent = trimmed.slice(match[0].length).trim();
      }
    } else if (MD_HEADER_REGEX.test(trimmed)) {
      isBoundary = true;
      encounteredFeatures.add('Tiêu đề Markdown');
      const match = trimmed.match(MD_HEADER_REGEX);
      if (match) {
        titleHint = match[1].trim();
        lineContent = '';
      }
    } else if (prevLineWasBlankOrHr && currentDraft && !(headerBlocks && draftOwnedByHeader)) {
      isBoundary = true;
      encounteredFeatures.add('Đoạn văn');
    }

    if (isBoundary || !currentDraft) {
      draftOwnedByHeader = headerBlocks && isHeaderOnlyLine(trimmed);
      startNewDraft(titleHint, lineContent, rawLine);
    } else {
      if (lineContent) {
        currentDraft.textParts.push(lineContent);
      }
      currentDraft.rawLines.push(rawLine);
    }

    prevLineWasBlankOrHr = false;
  }

  if (currentDraft) {
    drafts.push(currentDraft);
  }

  const items: PromptItem[] = [];
  const hasAnyDraftWithBody = drafts.some((d) => d.textParts.join(' ').trim().length > 0);

  drafts.forEach((d) => {
    let combinedText = d.textParts.join(' ').trim();
    if (!combinedText) {
      if (hasAnyDraftWithBody) {
        return;
      }
      if (d.titleHint) {
        combinedText = d.titleHint;
      }
    }
    if (!combinedText) return;

    const { cleanedPrompt, aspectRatio: inlineRatio, negative: inlineNeg, warnings } = extractParametersAndClean(
      combinedText,
      d.aspectRatio || defaultRatio
    );

    const allNegatives: string[] = [];
    if (d.negativeParts.length > 0) allNegatives.push(...d.negativeParts);
    if (inlineNeg) allNegatives.push(inlineNeg);

    const finalNegative = allNegatives.length > 0 ? allNegatives.join(', ') : undefined;
    const finalRatio = d.aspectRatio || inlineRatio;
    const finalWarnings = [...d.warnings, ...warnings];

    if (cleanedPrompt.length > 1500) {
      finalWarnings.push('Cảnh báo: Prompt dài > 1500 ký tự');
    }

    let title = d.titleHint || '';
    if (!title) {
      title = cleanedPrompt.length > 40 ? cleanedPrompt.slice(0, 37) + '...' : cleanedPrompt;
    }

    items.push({
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      order: items.length + 1,
      title,
      prompt: cleanedPrompt,
      aspectRatio: finalRatio,
      negative: finalNegative,
      originalText: d.rawLines.join('\n'),
      selected: true,
      warnings: finalWarnings,
      hasVietnamese: containsVietnamese(cleanedPrompt),
    });
  });

  const finalized = finalizeItems(items);

  let formatLabel = 'Hỗn hợp';
  if (encounteredFeatures.size > 0) {
    formatLabel = Array.from(encounteredFeatures).join(' + ');
  } else {
    formatLabel = 'Văn bản';
  }
  const detectedFormat = `${formatLabel} • ${finalized.length} prompt`;

  return {
    detectedFormat,
    items: finalized,
  };
}

export function parsePromptText(rawInput: string, defaultRatio: SupportedAspectRatio = '16:9'): ParseResult {
  const text = rawInput.trim();
  if (!text) return { detectedFormat: 'Trống', items: [] };

  const allLines = rawInput.split(/\r?\n/);
  const drafts: ActiveDraft[] = [];
  let currentDraft: ActiveDraft | null = null;
  let prevLineWasBlankOrHr = false;
  const encounteredFeatures = new Set<string>();

  const startNewDraft = (titleHint?: string, initialText?: string, rawLine?: string) => {
    if (currentDraft) drafts.push(currentDraft);
    currentDraft = {
      orderIndex: drafts.length + 1,
      titleHint: titleHint || undefined,
      textParts: initialText ? [initialText] : [],
      negativeParts: [],
      warnings: [],
      rawLines: rawLine ? [rawLine] : [],
    };
  };

  for (let i = 0; i < allLines.length; i++) {
    const rawLine = allLines[i];
    const trimmed = rawLine.trim();

    if (HR_REGEX.test(trimmed)) {
      encounteredFeatures.add('Dòng phân cách');
      prevLineWasBlankOrHr = true;
      continue;
    }
    if (!trimmed) {
      prevLineWasBlankOrHr = true;
      continue;
    }

    const negMatch = trimmed.match(PARAM_NEGATIVE_REGEX);
    if (negMatch) {
      if (!currentDraft) startNewDraft(undefined, undefined, rawLine);
      const negVal = negMatch[1].trim();
      if (negVal) currentDraft!.negativeParts.push(negVal);
      currentDraft!.rawLines.push(rawLine);
      prevLineWasBlankOrHr = false;
      continue;
    }

    const ratioMatch = trimmed.match(PARAM_RATIO_REGEX);
    if (ratioMatch) {
      if (!currentDraft) startNewDraft(undefined, undefined, rawLine);
      const ratioStr = ratioMatch[1].trim();
      if (ratioStr) {
        const mapped = mapToNearestAspectRatio(ratioStr);
        currentDraft!.aspectRatio = mapped.ratio;
      }
      currentDraft!.rawLines.push(rawLine);
      prevLineWasBlankOrHr = false;
      continue;
    }

    let isBoundary = false;
    let titleHint: string | undefined = undefined;
    let lineContent = trimmed;

    if (EXPLICIT_MARKER_REGEX.test(trimmed)) {
      isBoundary = true;
      encounteredFeatures.add('Marker');
      const match = trimmed.match(EXPLICIT_MARKER_REGEX);
      if (match) {
        titleHint = match[0].replace(/^[-\s]+|[:\-\s]+$/g, '').trim();
        lineContent = trimmed.slice(match[0].length).trim();
      }
    } else if (NUMBERED_LIST_REGEX.test(trimmed)) {
      isBoundary = true;
      const match = trimmed.match(NUMBERED_LIST_REGEX);
      if (match) {
        titleHint = `Prompt ${match[1]}`;
        lineContent = trimmed.slice(match[0].length).trim();
      }
    } else if (prevLineWasBlankOrHr && currentDraft) {
      isBoundary = true;
      encounteredFeatures.add('Đoạn văn');
    }

    if (isBoundary || !currentDraft) {
      startNewDraft(titleHint, lineContent, rawLine);
    } else {
      if (lineContent) currentDraft.textParts.push(lineContent);
      currentDraft.rawLines.push(rawLine);
    }
    prevLineWasBlankOrHr = false;
  }

  if (currentDraft) drafts.push(currentDraft);

  const items: PromptItem[] = [];
  const hasAnyDraftWithBody = drafts.some((d) => d.textParts.join(' ').trim().length > 0);

  drafts.forEach((d) => {
    let combinedText = d.textParts.join(' ').trim();
    if (!combinedText) {
      if (hasAnyDraftWithBody) {
        return;
      }
      if (d.titleHint) {
        combinedText = d.titleHint;
      }
    }
    if (!combinedText) return;
    const { cleanedPrompt, aspectRatio, negative, warnings } = extractParametersAndClean(combinedText, d.aspectRatio || defaultRatio);
    items.push({
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      order: items.length + 1,
      title: d.titleHint || (cleanedPrompt.length > 40 ? cleanedPrompt.slice(0, 37) + '...' : cleanedPrompt),
      prompt: cleanedPrompt,
      aspectRatio,
      negative,
      originalText: d.rawLines.join('\n'),
      selected: true,
      warnings,
      hasVietnamese: containsVietnamese(cleanedPrompt),
    });
  });

  return {
    detectedFormat: `${items.length} prompt`,
    items: finalizeItems(items),
  };
}

function applyFlagsToDraft(draft: ActiveDraft, flagsLine: string) {
  const arMatch = flagsLine.match(/(?:--ar|--aspect)\s*([0-9]+(?::|\/)[0-9]+|[0-9]+)/i);
  if (arMatch) {
    const mapped = mapToNearestAspectRatio(arMatch[1]);
    draft.aspectRatio = mapped.ratio;
    if (mapped.mappedNote) draft.warnings.push(mapped.mappedNote);
  }

  const noMatch = flagsLine.match(/--no\s+([^-\n]+)/i);
  if (noMatch) {
    const negVal = noMatch[1].trim();
    if (negVal) draft.negativeParts.push(negVal);
  }

  if (/--(?:v\s*\d+|style|q|s|chaos|seed|niji)/i.test(flagsLine)) {
    draft.warnings.push('Đã loại bỏ tham số MJ (--v, --style...)');
  }
}

function parseCsvFormat(lines: string[], defaultRatio: SupportedAspectRatio): PromptItem[] {
  const header = parseCsvRow(lines[0]);
  const promptIdx = header.findIndex((h) => /^(prompt|text|description|nội dung)$/i.test(h.trim()));
  if (promptIdx === -1) return [];

  const titleIdx = header.findIndex((h) => /^(title|name|tiêu đề|tên)$/i.test(h.trim()));
  const ratioIdx = header.findIndex((h) => /^(aspect|ratio|aspect_ratio|tỉ lệ|tỷ lệ)$/i.test(h.trim()));
  const negIdx = header.findIndex((h) => /^(negative|negative_prompt|tránh)$/i.test(h.trim()));

  const items: PromptItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const row = parseCsvRow(line);
    const promptText = row[promptIdx] || '';
    if (promptText.trim().length >= 8) {
      const title = titleIdx !== -1 ? row[titleIdx] : '';
      let ratio = defaultRatio;
      if (ratioIdx !== -1 && row[ratioIdx]) {
        ratio = mapToNearestAspectRatio(row[ratioIdx]).ratio;
      }
      const neg = negIdx !== -1 ? row[negIdx] : undefined;
      items.push(createPromptItem(items.length + 1, promptText, title, ratio, neg));
    }
  }
  return items;
}

function parseCsvRow(row: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cur.trim());
  return result;
}

/**
 * Hàm phân tích và làm sạch tham số prompt cốt lõi (Đợt 5A sửa lỗi đo được)
 */
export function extractParametersAndClean(
  rawText: string,
  fallbackRatio: SupportedAspectRatio
): {
  cleanedPrompt: string;
  aspectRatio: SupportedAspectRatio;
  negative?: string;
  warnings: string[];
} {
  let prompt = rawText.trim();
  const warnings: string[] = [];
  let aspectRatio = fallbackRatio;
  let negative: string | undefined = undefined;

  // 1. Xử lý --ar hoặc --aspect
  const arRegex = /(?:--ar|--aspect)\s*([0-9]+(?::|\/)[0-9]+|[0-9]+)/i;
  const arMatch = prompt.match(arRegex);
  if (arMatch) {
    const mapped = mapToNearestAspectRatio(arMatch[1]);
    aspectRatio = mapped.ratio;
    if (mapped.mappedNote) warnings.push(mapped.mappedNote);
    prompt = prompt.replace(arRegex, ' ').trim();
  } else {
    // Sau khi xử lý --ar: nếu không có --ar thì đọc tỷ lệ trong ngoặc: (16:9), (1:1), v.v.
    const bracketMatch = prompt.match(/\(([0-9]+:[0-9]+)\)/i);
    if (bracketMatch) {
      const mapped = mapToNearestAspectRatio(bracketMatch[1]);
      aspectRatio = mapped.ratio;
      if (mapped.mappedNote) warnings.push(mapped.mappedNote);
      prompt = prompt.replace(bracketMatch[0], ' ').trim();
    }
  }

  // 2. Xử lý --no
  const noMatch = prompt.match(/--no\s+([^-\n]+(?:\s+[^-\n]+)*?)(?=\s+--|$)/i);
  if (noMatch) {
    negative = noMatch[1].trim();
    prompt = prompt.replace(noMatch[0], ' ').trim();
  }

  // Sau --no: nếu chưa có negative: đọc negative tự nhiên
  if (!negative) {
    const negMatch = prompt.match(/(?:negative\s*prompt|negative|tránh|avoid)\s*:\s*([^-\n]+(?:\s+[^-\n]+)*?)(?=\s+--|$)/i);
    if (negMatch) {
      negative = negMatch[1].trim();
      prompt = prompt.replace(negMatch[0], ' ').trim();
    }
  }

  // 3. Bỏ cờ Midjourney
  const mjFlagsRegex = /--(?:v\s*\d+(?:\.\d+)?|style\s*[\w-]+|q\s*[\d.]+|s\s*\d+|chaos\s*\d+|seed\s*\d+|niji\s*\d*)/gi;
  if (mjFlagsRegex.test(prompt)) {
    warnings.push('Đã loại bỏ tham số MJ (--v, --style...)');
    prompt = prompt.replace(mjFlagsRegex, ' ').trim();
  }

  // 4. Đoạn dọn dẹp cuối
  prompt = prompt
    .replace(/^["'“”‘’]/, '')
    .replace(/["'“”‘’]$/, '')
    .replace(/^[-*•\s]+/, '')
    .replace(/,\s*$/, '') // Xoá dấu phẩy lạc ở cuối
    .replace(/\s+/g, ' ')
    .trim();

  return { cleanedPrompt: prompt, aspectRatio, negative, warnings };
}

function createPromptItem(
  order: number,
  rawPrompt: string,
  rawTitle: string,
  defaultRatio: SupportedAspectRatio,
  predefinedNegative?: string
): PromptItem {
  const { cleanedPrompt, aspectRatio, negative, warnings } = extractParametersAndClean(
    rawPrompt,
    defaultRatio
  );

  return {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    order,
    title: rawTitle.trim() || (cleanedPrompt.length > 40 ? cleanedPrompt.slice(0, 37) + '...' : cleanedPrompt),
    prompt: cleanedPrompt,
    aspectRatio,
    negative: predefinedNegative || negative,
    originalText: rawPrompt,
    selected: true,
    warnings,
    hasVietnamese: containsVietnamese(cleanedPrompt),
  };
}

/**
 * Kiểm tra trùng lặp dùng Map theo khoá chuẩn hoá (O(n))
 */
export function finalizeItems(items: PromptItem[]): PromptItem[] {
  const seenMap = new Map<string, number>();

  return items
    .filter((it) => it.prompt.length >= 8)
    .map((item, index) => {
      const order = index + 1;
      const normalizedKey = normalizeForDeduplication(item.prompt);
      const duplicateOf = seenMap.get(normalizedKey);
      const warnings = [...item.warnings];

      if (duplicateOf !== undefined) {
        warnings.push(`Trùng với prompt #${duplicateOf}`);
      } else {
        seenMap.set(normalizedKey, order);
      }

      return {
        ...item,
        order,
        duplicateOf,
        warnings,
      };
    });
}

export async function aiResplitPrompts(
  rawText: string,
  defaultRatio: SupportedAspectRatio = '16:9'
): Promise<PromptItem[]> {
  const textChunk = rawText.trim().slice(0, 12000);

  const systemInstruction = `You are a strict data separation assistant.
Extract all creative image generation prompts from the given text.
RULES:
1. Return ONLY a valid JSON array of objects: [{"title": string, "prompt": string, "aspectRatio": "16:9"|"9:16"|"1:1"|"4:3"|"3:4", "negative": string|null}].
2. KEEP the prompt text EXACTLY verbatim. DO NOT summarize, rewrite, embellish, or translate the prompt words.
3. Split correctly at the natural scene/prompt boundaries.
4. Output raw JSON only, no conversational text, no markdown backticks.`;

  const promptMessage = `Extract all individual prompts from this content:\n\n${textChunk}`;

  const res = await Flow.generate.text(promptMessage, {
    systemInstruction,
    thinkingLevel: 'low',
  });

  const rawJson = (res.text || '')
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();

  const parsed = JSON.parse(rawJson);
  if (!Array.isArray(parsed)) throw new Error('AI không trả về danh sách prompt hợp lệ.');

  const items: PromptItem[] = parsed.map((entry, idx) => {
    const rawP = entry.prompt || entry.text || '';
    const rawT = entry.title || `Prompt ${idx + 1}`;
    const ratio = mapToNearestAspectRatio(entry.aspectRatio || defaultRatio).ratio;
    return createPromptItem(idx + 1, rawP, rawT, ratio, entry.negative || undefined);
  });

  return finalizeItems(items);
}

export async function translatePromptToEnglish(promptVi: string): Promise<string> {
  if (!containsVietnamese(promptVi)) return promptVi;

  try {
    const systemInstruction = `You are a faithful literal translator.
Translate the following Vietnamese image generation prompt into English strictly word-for-word and concept-for-concept.
STRICT RULES:
1. Translate faithfully and accurately to the original meaning.
2. DO NOT add any extra details, embellishments, modifiers, or atmosphere that were not in the original text.
3. DO NOT add any artist names, studio names, brands, art style tags or rendering buzzwords.
4. Output ONLY the English translation with no quotes, no markdown, and no explanations.`;

    const res = await Flow.generate.text(`Translate literally to English: "${promptVi}"`, {
      systemInstruction,
      thinkingLevel: 'low',
    });

    const translated = (res.text || '').trim().replace(/^["']|["']$/g, '');
    return translated || promptVi;
  } catch (err) {
    console.warn('Translate prompt failed, using original:', err);
    return promptVi;
  }
}
