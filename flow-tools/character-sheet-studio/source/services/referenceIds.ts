import { RefImage } from '../types';

export function buildReferenceIds(faceRefs: RefImage[], outfitRefs: RefImage[]): string[] {
  const ids: string[] = [];

  // Face references first
  for (const ref of faceRefs) {
    if (ref && ref.mediaId && typeof ref.mediaId === 'string' && ref.mediaId.trim()) {
      const clean = ref.mediaId.trim();
      if (!ids.includes(clean)) {
        ids.push(clean);
      }
    }
  }

  // Outfit references second
  for (const ref of outfitRefs) {
    if (ref && ref.mediaId && typeof ref.mediaId === 'string' && ref.mediaId.trim()) {
      const clean = ref.mediaId.trim();
      if (!ids.includes(clean)) {
        ids.push(clean);
      }
    }
  }

  // At most 10 unique IDs
  return ids.slice(0, 10);
}
