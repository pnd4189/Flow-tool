import { FaceDna, PromptRefs, RefImage } from '../types';
import { ensureUploaded } from './refImages';
import { describeFace, formatFaceDna } from './faceDna';
import { buildReferenceIds } from './referenceIds';
import { logDiag } from './diagnostics';

export interface PrepareGenerationRefsInput {
  faceSource: 'ai' | 'upload';
  faceRefs: RefImage[];
  outfitRefs: RefImage[];
  faceDna: FaceDna | null;
  outfitDna: string;
  faceLocked: boolean;
  onStage?: (stage: 'uploading' | 'analyzing') => void;
}

export interface PrepareGenerationRefsResult {
  referenceMediaIds: string[];
  promptRefs: PromptRefs;
  faceRefs: RefImage[];
  outfitRefs: RefImage[];
  faceDna: FaceDna | null;
}

export async function prepareGenerationRefs(
  input: PrepareGenerationRefsInput
): Promise<PrepareGenerationRefsResult> {
  const {
    faceSource,
    faceRefs: initialFaceRefs,
    outfitRefs: initialOutfitRefs,
    faceDna: initialFaceDna,
    outfitDna,
    faceLocked,
    onStage,
  } = input;

  const usedFaces = faceSource === 'upload' ? [...initialFaceRefs] : [];
  const usedOutfits = [...initialOutfitRefs];

  logDiag(
    'info',
    'referencePipeline.start',
    `faceSource=${faceSource} faceCount=${usedFaces.length} outfitCount=${usedOutfits.length} faceLocked=${faceLocked}`
  );

  // 1. Determine which references need uploading
  const faceNeedsUpload = usedFaces.some((r) => !r.mediaId);
  const outfitNeedsUpload = usedOutfits.some((r) => !r.mediaId);

  if (faceNeedsUpload || outfitNeedsUpload) {
    logDiag('info', 'referencePipeline.stage', 'stage=uploading');
    onStage?.('uploading');
  }

  // Upload sequentially, one at a time; errors propagate
  const uploadedFaces: RefImage[] = [];
  for (const ref of usedFaces) {
    if (!ref.mediaId) {
      const uploaded = await ensureUploaded(ref);
      uploadedFaces.push(uploaded);
    } else {
      uploadedFaces.push(ref);
    }
  }

  const uploadedOutfits: RefImage[] = [];
  for (const ref of usedOutfits) {
    if (!ref.mediaId) {
      const uploaded = await ensureUploaded(ref);
      uploadedOutfits.push(uploaded);
    } else {
      uploadedOutfits.push(ref);
    }
  }

  // 2. Face DNA analysis if faces are used and not locked or faceDna is null
  let finalFaceDna: FaceDna | null = initialFaceDna;

  if (faceSource === 'upload' && uploadedFaces.length > 0) {
    if (!faceLocked || !finalFaceDna) {
      logDiag('info', 'referencePipeline.stage', 'stage=analyzing');
      onStage?.('analyzing');
      finalFaceDna = await describeFace(uploadedFaces);
    } else {
      logDiag('info', 'referencePipeline.faceDna_locked', 'Using existing locked face DNA');
    }
  }

  // 3. Build ordered reference IDs: face first, outfits second, empty IDs dropped
  const referenceMediaIds = buildReferenceIds(uploadedFaces, uploadedOutfits);

  // 4. Derive promptRefs counts strictly from the IDs actually present in referenceMediaIds
  const faceIdSet = new Set(
    uploadedFaces
      .map((f) => f.mediaId)
      .filter((id): id is string => Boolean(id && id.trim()))
  );
  const outfitIdSet = new Set(
    uploadedOutfits
      .map((o) => o.mediaId)
      .filter((id): id is string => Boolean(id && id.trim()))
  );

  let activeFaceCount = 0;
  let activeOutfitCount = 0;

  for (const id of referenceMediaIds) {
    if (faceIdSet.has(id)) {
      activeFaceCount++;
    } else if (outfitIdSet.has(id)) {
      activeOutfitCount++;
    }
  }

  const promptRefs: PromptRefs = {
    faceCount: activeFaceCount,
    outfitCount: activeOutfitCount,
  };

  if (activeFaceCount > 0 && finalFaceDna) {
    const formattedDna = formatFaceDna(finalFaceDna);
    if (formattedDna.trim()) {
      promptRefs.faceDna = formattedDna;
    }
  }

  if (activeOutfitCount > 0 && outfitDna && outfitDna.trim()) {
    promptRefs.outfitDna = outfitDna.trim();
  }

  logDiag(
    'ok',
    'referencePipeline.finish',
    `referenceMediaIdsCount=${referenceMediaIds.length} activeFaceCount=${activeFaceCount} activeOutfitCount=${activeOutfitCount}`
  );

  return {
    referenceMediaIds,
    promptRefs,
    faceRefs: faceSource === 'upload' ? uploadedFaces : initialFaceRefs,
    outfitRefs: uploadedOutfits,
    faceDna: finalFaceDna,
  };
}
