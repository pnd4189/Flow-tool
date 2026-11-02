export type DiagKind = 'info' | 'call' | 'ok' | 'error';

export interface DiagEntry {
  t: number;
  kind: DiagKind;
  name: string;
  detail: string;
}

const MAX_ENTRIES = 300;
const ringBuffer: DiagEntry[] = [];
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // ignore subscriber error
    }
  }
}

/**
 * Appends an entry to the ring buffer (max 300 entries, detail capped at 600 chars).
 * Never store base64 data or whole prompts: log lengths and ids only.
 */
export function logDiag(kind: DiagKind, name: string, detail: string): void {
  const safeDetail = (detail || '').slice(0, 600);
  const entry: DiagEntry = {
    t: Date.now(),
    kind,
    name,
    detail: safeDetail,
  };

  if (ringBuffer.length >= MAX_ENTRIES) {
    ringBuffer.shift();
  }
  ringBuffer.push(entry);
  notify();
}

/**
 * Returns diagnostic entries in chronological order (oldest first).
 */
export function getDiag(): DiagEntry[] {
  return [...ringBuffer];
}

/**
 * Subscribes to new diagnostic events. Returns an unsubscribe function.
 */
export function subscribeDiag(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * Clears all diagnostics entries in memory.
 */
export function clearDiag(): void {
  ringBuffer.length = 0;
  notify();
}

/**
 * Formats entries as one line per entry: ISO time, kind, name, detail.
 */
export function formatDiag(entries: DiagEntry[]): string {
  return entries
    .map((e) => {
      const iso = new Date(e.t).toISOString();
      return `[${iso}] [${e.kind.toUpperCase()}] [${e.name}] ${e.detail}`;
    })
    .join('\n');
}
