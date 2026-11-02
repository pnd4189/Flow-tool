import { useState, useCallback, useRef } from 'react';
import { Flow } from 'flow-sdk';
import { FaceDna, RefImage, RefKind } from '../types';
import {
  MAX_FACE_REFS,
  MAX_OUTFIT_REFS,
  validateFile,
  prepareRefImage,
  ensureUploaded,
} from '../services/refImages';
import { describeFace, describeOutfit } from '../services/faceDna';

export function useReferences() {
  const [faceRefs, setFaceRefs] = useState<RefImage[]>([]);
  const [outfitRefs, setOutfitRefs] = useState<RefImage[]>([]);
  const [faceDna, setFaceDnaState] = useState<FaceDna | null>(null);
  const [outfitDna, setOutfitDnaState] = useState<string>('');
  const [faceLocked, setFaceLockedState] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronous mirrors for state accessed asynchronously
  const faceRefsRef = useRef<RefImage[]>([]);
  const outfitRefsRef = useRef<RefImage[]>([]);
  const faceLockedRef = useRef<boolean>(false);
  const faceDnaRef = useRef<FaceDna | null>(null);

  const commitFaceRefs = useCallback((next: RefImage[]) => {
    faceRefsRef.current = next;
    setFaceRefs(next);
  }, []);

  const commitOutfitRefs = useCallback((next: RefImage[]) => {
    outfitRefsRef.current = next;
    setOutfitRefs(next);
  }, []);

  const setFaceLocked = useCallback((locked: boolean) => {
    faceLockedRef.current = locked;
    setFaceLockedState(locked);
  }, []);

  const setFaceDna = useCallback((dna: FaceDna | null) => {
    faceDnaRef.current = dna;
    setFaceDnaState(dna);
  }, []);

  const setOutfitDna = useCallback((dna: string) => {
    setOutfitDnaState(dna);
  }, []);

  /**
   * Clears face and outfit reference images (used when loading a saved session).
   */
  const clearRefs = useCallback(() => {
    commitFaceRefs([]);
    commitOutfitRefs([]);
  }, [commitFaceRefs, commitOutfitRefs]);

  /**
   * Applies prepared references and face DNA returned from prepareGenerationRefs or lockFace,
   * automatically setting faceLocked to true if faceDna came back.
   */
  const applyPrepared = useCallback(
    (prepared: { faceRefs: RefImage[]; outfitRefs: RefImage[]; faceDna: FaceDna | null }) => {
      commitFaceRefs(prepared.faceRefs);
      commitOutfitRefs(prepared.outfitRefs);
      if (prepared.faceDna) {
        setFaceDna(prepared.faceDna);
        setFaceLocked(true);
      }
    },
    [commitFaceRefs, commitOutfitRefs, setFaceDna, setFaceLocked]
  );

  /**
   * Adds files from local machine, validates them, respects limits, and prepares them.
   */
  const addFiles = useCallback(async (kind: RefKind, files: File[]) => {
    setError(null);
    if (!files || files.length === 0) return;

    const rejectedFiles: string[] = [];
    const validFiles: File[] = [];

    const currentList = kind === 'face' ? faceRefsRef.current : outfitRefsRef.current;
    const maxLimit = kind === 'face' ? MAX_FACE_REFS : MAX_OUTFIT_REFS;
    const remainingSlots = maxLimit - currentList.length;

    if (remainingSlots <= 0) {
      setError(
        kind === 'face'
          ? `Đã đạt tối đa ${MAX_FACE_REFS} ảnh khuôn mặt tham chiếu.`
          : `Đã đạt tối đa ${MAX_OUTFIT_REFS} ảnh trang phục tham chiếu.`
      );
      return;
    }

    const filesToProcess = files.slice(0, remainingSlots);
    for (const file of filesToProcess) {
      const check = validateFile(file);
      if (!check.ok) {
        rejectedFiles.push(`${file.name}: ${check.error}`);
      } else {
        validFiles.push(file);
      }
    }

    if (rejectedFiles.length > 0) {
      setError(rejectedFiles.join(' | '));
    }

    if (validFiles.length === 0) return;

    try {
      const preparedList = await Promise.all(
        validFiles.map((f) => prepareRefImage(f, kind))
      );

      if (kind === 'face') {
        const next = [...faceRefsRef.current, ...preparedList].slice(0, MAX_FACE_REFS);
        commitFaceRefs(next);
      } else {
        const next = [...outfitRefsRef.current, ...preparedList].slice(0, MAX_OUTFIT_REFS);
        commitOutfitRefs(next);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi chuẩn bị ảnh tham chiếu.';
      setError(msg);
    }
  }, [commitFaceRefs, commitOutfitRefs]);

  /**
   * Selects an image from Flow library and prepares it.
   */
  const addFromLibrary = useCallback(async (kind: RefKind) => {
    setError(null);

    const currentList = kind === 'face' ? faceRefsRef.current : outfitRefsRef.current;
    const maxLimit = kind === 'face' ? MAX_FACE_REFS : MAX_OUTFIT_REFS;

    if (currentList.length >= maxLimit) {
      setError(
        kind === 'face'
          ? `Đã đạt tối đa ${MAX_FACE_REFS} ảnh khuôn mặt tham chiếu.`
          : `Đã đạt tối đa ${MAX_OUTFIT_REFS} ảnh trang phục tham chiếu.`
      );
      return;
    }

    try {
      const media = await Flow.media.select({ filter: 'image' });
      if (!media || !media.base64) return;

      const prepared = await prepareRefImage(
        {
          base64: media.base64,
          mimeType: media.mimeType,
          name: media.name || `gallery_${kind}.jpg`,
          mediaId: media.mediaId,
        },
        kind
      );

      if (kind === 'face') {
        const next = [...faceRefsRef.current, prepared].slice(0, MAX_FACE_REFS);
        commitFaceRefs(next);
      } else {
        const next = [...outfitRefsRef.current, prepared].slice(0, MAX_OUTFIT_REFS);
        commitOutfitRefs(next);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi chọn ảnh từ thư viện.';
      setError(msg);
    }
  }, [commitFaceRefs, commitOutfitRefs]);

  /**
   * Removes a reference image by id.
   */
  const remove = useCallback((id: string) => {
    commitFaceRefs(faceRefsRef.current.filter((r) => r.id !== id));
    commitOutfitRefs(outfitRefsRef.current.filter((r) => r.id !== id));
  }, [commitFaceRefs, commitOutfitRefs]);

  /**
   * Locks face: ensures every face ref is uploaded, extracts face DNA via describeFace,
   * sets faceDna and faceLocked. Returns { faceRefs, faceDna } on success and null on failure.
   */
  const lockFace = useCallback(async (): Promise<{ faceRefs: RefImage[]; faceDna: FaceDna } | null> => {
    setError(null);

    const currentFaces = faceRefsRef.current;

    if (currentFaces.length === 0) {
      setError('Vui lòng thêm ít nhất 1 ảnh khuôn mặt trước khi khóa nhận diện.');
      return null;
    }

    try {
      // 1. Ensure all face refs have a mediaId sequentially
      const uploadedRefs: RefImage[] = [];
      for (const r of currentFaces) {
        if (!r.mediaId) {
          const uploaded = await ensureUploaded(r);
          uploadedRefs.push(uploaded);
        } else {
          uploadedRefs.push(r);
        }
      }
      commitFaceRefs(uploadedRefs);

      // 2. Describe face DNA
      const dna = await describeFace(uploadedRefs);
      setFaceDna(dna);
      setFaceLocked(true);
      return { faceRefs: uploadedRefs, faceDna: dna };
    } catch (err: unknown) {
      setFaceLocked(false);
      const msg = err instanceof Error ? err.message : 'Không thể phân tích và khóa diện mạo khuôn mặt.';
      setError(msg);
      return null;
    }
  }, [commitFaceRefs, setFaceDna, setFaceLocked]);

  /**
   * Unlocks face.
   */
  const unlockFace = useCallback(() => {
    setFaceLocked(false);
  }, [setFaceLocked]);

  /**
   * Analyzes outfit references: ensures uploaded + describeOutfit.
   */
  const analyzeOutfit = useCallback(async () => {
    setError(null);

    const currentOutfits = outfitRefsRef.current;

    if (currentOutfits.length === 0) {
      setError('Vui lòng thêm ít nhất 1 ảnh trang phục trước khi phân tích.');
      return;
    }

    try {
      const uploadedRefs: RefImage[] = [];
      for (const r of currentOutfits) {
        if (!r.mediaId) {
          const uploaded = await ensureUploaded(r);
          uploadedRefs.push(uploaded);
        } else {
          uploadedRefs.push(r);
        }
      }
      commitOutfitRefs(uploadedRefs);

      const dnaText = await describeOutfit(uploadedRefs);
      setOutfitDna(dnaText);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể phân tích trang phục.';
      setError(msg);
    }
  }, [commitOutfitRefs, setOutfitDna]);

  return {
    faceRefs,
    outfitRefs,
    faceDna,
    outfitDna,
    faceLocked,
    error,
    addFiles,
    addFromLibrary,
    remove,
    clearRefs,
    lockFace,
    unlockFace,
    setFaceDna,
    setOutfitDna,
    analyzeOutfit,
    applyPrepared,
  };
}
