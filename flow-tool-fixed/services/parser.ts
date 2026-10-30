import { Scene, AspectRatio } from '../types';

// Shared aspect-ratio matcher — used by both the structured `aspect ratio:` field
// and inline prose, so the two paths agree on all five ratios.
const AR_PATTERN = /\b(16:9|9:16|1:1|4:3|3:4)\b/i;
function matchAR(value: string): AspectRatio | null {
  const m = value.match(AR_PATTERN);
  return m ? (m[1] as AspectRatio) : null;
}

// crypto.randomUUID requires a secure context (HTTPS). Flow runs on HTTPS so it is
// available, but guard with a fallback so a non-secure embed (e.g. file:// preview)
// does not throw and break scene parsing entirely.
function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const SEPARATOR_TYPES = [
  // No `g` flag here: these patterns are reused with .test() in detectSeparator,
  // and a `g` flag would make .test() stateful (lastIndex carryover between calls,
  // producing non-deterministic separator detection). parseScenes builds its own
  // global clone for matchAll, so `g` is not needed on the source patterns.
  { id: 'marker', name: 'Scene Markers', pattern: /--- SCENE \d+ ---|SCENE \d+:|\[CẢNH \d+\]|PHÂN CẢNH \d+|PROMPT \d+/i },
  { id: 'markdown', name: 'Markdown Headings', pattern: /^#{1,6}\s+.+$/m },
  { id: 'divider', name: 'Dividers', pattern: /^-{3,}|={3,}|\*{3,}|_{3,}$/m },
  { id: 'list', name: 'Lists', pattern: /^\d+[\.\)]\s+|^\s*[\-\*•]\s+/m },
  { id: 'newline', name: 'Blank Lines', pattern: /\n\s*\n/ },
];

export function detectSeparator(text: string) {
  for (const sep of SEPARATOR_TYPES) {
    if (sep.pattern.test(text)) return sep;
  }
  return SEPARATOR_TYPES[SEPARATOR_TYPES.length - 1]; // Default to newline
}

export function parseScenes(text: string, defaultAR: AspectRatio): Scene[] {
  const sep = detectSeparator(text);
  let blocks: string[] = [];

  if (sep.id === 'newline') {
    blocks = text.split(/\n\s*\n/).filter(b => b.trim().length > 0);
  } else {
    // Build a global clone for matchAll, preserving the original flags (i for
    // case-insensitive markers, m for ^/$ anchors) and adding `g`. Previously this
    // rebuilt with hardcoded 'gm', dropping the `i` flag so lowercase Vietnamese
    // markers like [cảnh 1] never matched and the whole input became one scene.
    const globalPattern = new RegExp(
      sep.pattern.source,
      sep.pattern.flags + (sep.pattern.flags.includes('g') ? '' : 'g')
    );
    const matches = Array.from(text.matchAll(globalPattern));
    if (matches.length === 0) {
      blocks = [text];
    } else if (sep.id === 'marker' || sep.id === 'markdown') {
      // The matched token is the block's label (title): each block starts at its
      // own marker and ends at the next. Preamble before the first marker is not a
      // scene and is dropped.
      let lastIdx = matches[0].index;
      for (let i = 1; i < matches.length; i++) {
        blocks.push(text.slice(lastIdx, matches[i].index).trim());
        lastIdx = matches[i].index;
      }
      blocks.push(text.slice(lastIdx).trim());
    } else {
      // The matched token is a pure delimiter (divider/list): each block is the
      // content between delimiters, the delimiter itself is excluded, and the
      // preamble before the first delimiter is kept as the first scene. Previously
      // the preamble was dropped and the delimiter line leaked into the next block.
      let prevEnd = 0;
      for (const m of matches) {
        blocks.push(text.slice(prevEnd, m.index).trim());
        prevEnd = m.index + m[0].length;
      }
      blocks.push(text.slice(prevEnd).trim());
    }
  }

  return blocks.filter(b => b.trim()).map((block, index) => {
    const lines = block.split('\n').map(l => l.trim());

    // For marker/markdown blocks the first line is the label. Extract just the
    // matched marker/heading as the title and keep any trailing text on that line
    // as prompt content, so "SCENE 1: A sunset" does not lose "A sunset". Other
    // separators treat every line as content.
    let title = `Scene ${index + 1}`;
    let contentLines = lines;

    if (sep.id === 'marker' || sep.id === 'markdown') {
      const first = lines[0] || '';
      const m = first.match(sep.pattern);
      if (m && m.index !== undefined) {
        const label = m[0];
        const remainder = first.slice(m.index + label.length).trim();
        title = label.length <= 50 ? label : `Scene ${index + 1}`;
        contentLines = [remainder, ...lines.slice(1)].filter(l => l.length > 0);
      }
    }

    let promptParts: string[] = [];
    let negativePrompt = '';
    let detectedAR: AspectRatio = defaultAR;

    // Structured parsing
    const structuredFields: Record<string, string> = {};

    contentLines.forEach(line => {
      // Require whitespace after the colon so a ratio like "4:3" (colon with no
      // following space) is not misparsed as a "key: value" pair and can still be
      // detected by the inline AR matcher below.
      const match = line.match(/^([^:]+):\s+(.*)$/i);
      if (match) {
        const key = match[1].toLowerCase().trim();
        const val = match[2].trim();

        if (key === 'negative' || key === 'avoid') {
          negativePrompt = val;
        } else if (key === 'aspect ratio' || key === 'ar') {
          const ar = matchAR(val);
          if (ar) detectedAR = ar;
        } else {
          structuredFields[key] = val;
        }
      } else {
        // Look for inline AR phrases (all five ratios)
        const ar = matchAR(line);
        if (ar) detectedAR = ar;

        promptParts.push(line);
      }
    });

    // Merge structured fields into prompt if not empty
    const mergedStructured = Object.entries(structuredFields)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    const finalPrompt = [mergedStructured, ...promptParts].filter(p => p).join(' ').trim();

    return {
      id: genId(),
      title,
      prompt: finalPrompt || block.trim(),
      negativePrompt: negativePrompt || undefined,
      aspectRatio: detectedAR,
      status: 'pending'
    };
  });
}