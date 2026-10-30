import { Scene, AspectRatio } from '../types';

export const SEPARATOR_TYPES = [
  { id: 'marker', name: 'Scene Markers', pattern: /(?:--- SCENE \d+ ---|SCENE \d+:|\[CẢNH \d+\]|PHÂN CẢNH \d+|PROMPT \d+)/i },
  { id: 'markdown', name: 'Markdown Headings', pattern: /^#{1,6}\s+.+$/m },
  { id: 'divider', name: 'Dividers', pattern: /^(?:-{3,}|={3,}|\*{3,}|_{3,})[ \t]*$/m },
  { id: 'list', name: 'Lists', pattern: /^(?:\d+[\.\)]\s+|[ \t]*[\-\*•]\s+)/m },
  { id: 'newline', name: 'Blank Lines', pattern: /\n\s*\n/ },
];

export const STRUCTURED_KEYS = new Set([
  'subject',
  'action',
  'action/energy',
  'energy',
  'setting',
  'style',
  'lighting',
  'lighting/color',
  'color',
  'atmosphere',
  'composition',
  'camera',
  'negative',
  'avoid',
  'aspect ratio',
  'ar',
  'chủ thể',
  'hành động',
  'bối cảnh',
  'phong cách',
  'ánh sáng',
  'màu sắc',
  'không khí',
  'bố cục',
  'máy ảnh',
  'tránh'
]);

export function detectSeparator(text: string) {
  for (const sep of SEPARATOR_TYPES) {
    if (sep.pattern.test(text)) return sep;
  }
  return SEPARATOR_TYPES[SEPARATOR_TYPES.length - 1]; // Default to newline
}

function cleanTitle(raw: string, sepId: string, index: number): string {
  let cleaned = raw.trim();
  if (sepId === 'divider') {
    return `Scene ${index + 1}`;
  }
  if (sepId === 'marker') {
    // Strip leading/trailing dashes, brackets, colons, spaces
    cleaned = cleaned.replace(/^[\s\-_:\[\]]+|[\s\-_:\[\]]+$/g, '').trim();
    return cleaned || `Scene ${index + 1}`;
  }
  if (sepId === 'markdown') {
    // Remove leading # characters and spaces
    cleaned = cleaned.replace(/^#+\s*/, '').trim();
    return cleaned || `Scene ${index + 1}`;
  }
  return cleaned.length < 50 ? cleaned : `Scene ${index + 1}`;
}

export function parseScenes(text: string, defaultAR: AspectRatio): Scene[] {
  const sep = detectSeparator(text);
  let blocks: string[] = [];

  if (sep.id === 'newline') {
    blocks = text.split(/\n\s*\n/).filter(b => b.trim().length > 0);
  } else if (sep.id === 'divider') {
    const dividerRegex = /^(?:-{3,}|={3,}|\*{3,}|_{3,})[ \t]*$/gm;
    blocks = text.split(dividerRegex).filter(b => b.trim().length > 0);
  } else {
    // Use new RegExp with 'gmi' to ensure case-insensitive matching across entire string
    const matchRegex = new RegExp(sep.pattern.source, 'gmi');
    const matches = Array.from(text.matchAll(matchRegex));
    if (matches.length === 0) {
      blocks = [text];
    } else {
      let lastIdx = 0;
      matches.forEach((match, i) => {
        const start = match.index!;
        if (i > 0) {
          const slice = text.slice(lastIdx, start).trim();
          if (slice) blocks.push(slice);
        }
        lastIdx = start;
      });
      const finalSlice = text.slice(lastIdx).trim();
      if (finalSlice) blocks.push(finalSlice);
    }
  }

  return blocks.filter(b => b.trim()).map((block, index) => {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const rawTitle = lines[0] || `Scene ${index + 1}`;
    const title = cleanTitle(rawTitle, sep.id, index);

    let promptParts: string[] = [];
    let negativePrompt = '';
    let detectedAR: AspectRatio = defaultAR;
    let foundAR = false;

    // Scan every line of the block for aspect ratio first: /\b(16:9|9:16|4:3|3:4|1:1)\b/
    for (const line of lines) {
      const arMatch = line.match(/\b(16:9|9:16|4:3|3:4|1:1)\b/);
      if (arMatch) {
        detectedAR = arMatch[1] as AspectRatio;
        foundAR = true;
        break;
      }
    }

    const structuredFields: Record<string, string> = {};
    const contentLines = (sep.id === 'marker' || sep.id === 'markdown') && lines.length > 1 ? lines.slice(1) : lines;

    contentLines.forEach(line => {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const possibleKey = line.slice(0, colonIdx).trim().toLowerCase();
        const possibleVal = line.slice(colonIdx + 1).trim();

        if (STRUCTURED_KEYS.has(possibleKey)) {
          if (possibleKey === 'negative' || possibleKey === 'avoid' || possibleKey === 'tránh') {
            negativePrompt = possibleVal;
          } else if (possibleKey === 'aspect ratio' || possibleKey === 'ar') {
            if (!foundAR) {
              const innerAr = possibleVal.match(/\b(16:9|9:16|4:3|3:4|1:1)\b/);
              if (innerAr) {
                detectedAR = innerAr[1] as AspectRatio;
                foundAR = true;
              }
            }
          } else {
            structuredFields[possibleKey] = possibleVal;
          }
          return;
        }
      }

      // If not recognized as structured key, it is normal prompt line
      promptParts.push(line);
    });

    const mergedStructured = Object.entries(structuredFields)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    const finalPrompt = [mergedStructured, ...promptParts].filter(p => p).join(' ').trim();

    return {
      id: crypto.randomUUID(),
      title,
      prompt: finalPrompt || block.trim(),
      negativePrompt: negativePrompt || undefined,
      aspectRatio: detectedAR,
      status: 'pending'
    };
  });
}
