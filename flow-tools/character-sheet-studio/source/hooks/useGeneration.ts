import { useState, useRef, useCallback } from 'react';
import { CharacterConfig, FaceDna, GenerationJob, HistoryItem, QcReport, RefImage } from '../types';
import { buildSheetPrompt } from '../services/promptBuilder';
import { generateSheetImage } from '../services/generation';
import { makeQcImage, makeThumbnail } from '../services/imageUtils';
import { translateConfigFields } from '../services/translate';
import { prepareGenerationRefs } from '../services/referencePipeline';
import { appendRetryAddendum, buildRetryAddendum, decideRetry, inspectSheet } from '../services/qc';
import { logDiag } from '../services/diagnostics';
import { runBestOf, runTake, runWithConcurrency, TakeSheet, TakeQcUpdate } from '../services/takePipeline';
import { applyFaceDnaToConfig } from '../services/faceDna';
import {
  applyVariantChanges,
  buildVariantPrompt,
  describeVariantChanges,
  hasVariantChanges,
  VariantChanges,
} from '../services/variant';

export interface GenerationRefsContext {
  faceRefs: RefImage[];
  outfitRefs: RefImage[];
  faceDna: FaceDna | null;
  outfitDna: string;
  faceLocked: boolean;
  applyPrepared: (prepared: {
    faceRefs: RefImage[];
    outfitRefs: RefImage[];
    faceDna: FaceDna | null;
  }) => void;
}

export function useGeneration() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Cancellation ref flag
  const abortRequestedRef = useRef<boolean>(false);
  const isRunningRef = useRef<boolean>(false);

  const selectedItem = history.find((item) => item.id === selectedId) || history[0] || null;

  /**
   * Run image generation in parallel with immediate first image display and background QC checks.
   */
  const run = useCallback(async (config: CharacterConfig, refs?: GenerationRefsContext) => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    abortRequestedRef.current = false;
    setErrorBanner(null);

    const total = Math.max(1, Math.min(4, config.imageCount));
    const startedAt = Date.now();

    // Set initial 'translating' stage while preparing English prompt
    setJob({
      total,
      done: 0,
      stage: 'translating',
      startedAt,
      error: null,
    });

    try {
      // Step 1: Translate non-ASCII config fields once per run
      const promptReadyConfig = await translateConfigFields(config);

      // Check if stop was requested while translating
      if (abortRequestedRef.current) {
        isRunningRef.current = false;
        setJob(null);
        return;
      }

      // Step 2: Prepare references ONCE per run (sequential upload + face analysis if needed)
      let referenceMediaIds: string[] = [];
      let promptRefsParam: Parameters<typeof buildSheetPrompt>[1] = undefined;
      let preparedFaceDna: FaceDna | null = null;

      if (refs) {
        const prepResult = await prepareGenerationRefs({
          faceSource: config.faceSource,
          faceRefs: refs.faceRefs,
          outfitRefs: refs.outfitRefs,
          faceDna: refs.faceDna,
          outfitDna: refs.outfitDna,
          faceLocked: refs.faceLocked,
          onStage: (stage) => {
            setJob((prev) => (prev ? { ...prev, stage } : null));
          },
        });

        preparedFaceDna = prepResult.faceDna;

        // Store prepared refs and face DNA back into useReferences state
        refs.applyPrepared({
          faceRefs: prepResult.faceRefs,
          outfitRefs: prepResult.outfitRefs,
          faceDna: prepResult.faceDna,
        });

        referenceMediaIds = prepResult.referenceMediaIds;
        promptRefsParam = prepResult.promptRefs;
      }

      if (abortRequestedRef.current) {
        isRunningRef.current = false;
        setJob(null);
        return;
      }

      // Step 3: Build the clean English prompt with reference clauses
      const basePrompt = buildSheetPrompt(applyFaceDnaToConfig(promptReadyConfig, preparedFaceDna), promptRefsParam);

      // Helper face refs for QC face match inspection
      const faceRefForQc =
        config.faceSource === 'upload' && refs && refs.faceRefs.length > 0
          ? [{ base64: refs.faceRefs[0].base64, mimeType: refs.faceRefs[0].mimeType }]
          : undefined;

      const candidates = config.qcEnabled ? Math.max(1, Math.min(4, config.qcCandidates ?? 1)) : 1;

      // Step 4: Parallel generation via runWithConcurrency and runTake / runBestOf
      setJob((prev) =>
        prev
          ? {
              ...prev,
              stage: 'generating',
              stageDetail:
                candidates > 1
                  ? `${candidates} bản thử mỗi ảnh, chọn bản tốt nhất`
                  : total > 1
                  ? `${total} ảnh song song`
                  : undefined,
            }
          : null
      );

      const pendingQc: Promise<void>[] = [];

      // Local helper to build and insert the history item
      const insertHistoryItem = (
        itemId: string,
        sheet: TakeSheet,
        thumb: string,
        qcReport: QcReport | undefined,
        qcAttempts: number,
        qcPending: boolean
      ) => {
        const newItem: HistoryItem = {
          id: itemId,
          createdAt: Date.now(),
          config: { ...config },
          promptUsed: sheet.promptUsed,
          mediaId: sheet.mediaId,
          mimeType: sheet.mimeType,
          base64: sheet.base64,
          thumb,
          rewriteRound: sheet.rewriteRound,
          favorite: false,
          refMediaIds: referenceMediaIds,
          qc: qcReport,
          qcAttempts,
          qcPending,
        };

        setHistory((prev) => {
          const updated = [newItem, ...prev].slice(0, 40);
          return updated.map((item, idx) => {
            if (idx >= 12 && item.base64 !== null) {
              return { ...item, base64: null };
            }
            return item;
          });
        });

        setSelectedId(itemId);
        setJob((prev) => (prev ? { ...prev, done: prev.done + 1 } : null));
      };

      const concurrencyLimit =
        candidates > 1 ? Math.max(1, Math.floor(4 / candidates)) : total;

      const settled = await runWithConcurrency(total, concurrencyLimit, (index) => {
        return new Promise<void>((resolve, reject) => {
          if (abortRequestedRef.current) {
            resolve();
            return;
          }

          const takeNumber = index + 1;
          let takePrompt = basePrompt;
          if (total > 1) {
            takePrompt = `${basePrompt} Alternative take ${takeNumber} of ${total}: vary pose and lighting slightly, keep the exact same character design.`;
          }

          const itemId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

          const deps = {
            generate: (prompt: string) =>
              generateSheetImage({
                prompt,
                model: config.model,
                aspectRatio: config.aspectRatio,
                referenceMediaIds: referenceMediaIds.length > 0 ? referenceMediaIds : undefined,
                onStage: (stage, detail) => {
                  setJob((prev) => (prev ? { ...prev, stage, stageDetail: detail } : null));
                },
              }),
            inspect: async (sheet: TakeSheet) => {
              const q = await makeQcImage(sheet.base64, sheet.mimeType, 1280);
              return inspectSheet({
                base64: q.base64,
                mimeType: q.mimeType,
                layoutId: config.layoutId,
                faceRefs: faceRefForQc,
              });
            },
          };

          if (candidates > 1) {
            runBestOf(deps, {
              prompt: takePrompt,
              count: candidates,
              minScore: 65,
              strictFace: config.faceFidelity === 'strict',
              isAborted: () => abortRequestedRef.current,
            }).then(
              async (best) => {
                try {
                  const thumb = await makeThumbnail(best.sheet.base64, best.sheet.mimeType, 420);
                  insertHistoryItem(
                    itemId,
                    best.sheet,
                    thumb,
                    best.report ?? undefined,
                    candidates - 1,
                    false
                  );
                  resolve();
                } catch (err) {
                  reject(err);
                }
              },
              (error) => {
                reject(error);
              }
            );
          } else {
            const options = {
              prompt: takePrompt,
              qcEnabled: config.qcEnabled,
              maxRetries: config.qcMaxRetries ?? 1,
              minScore: 65,
              strictFace: config.faceFidelity === 'strict',
              isAborted: () => abortRequestedRef.current,
              onRetry: (attempt: number, reasons: string[]) => {
                logDiag(
                  'info',
                  'qc.retry',
                  `take=${takeNumber} retryAttempt=${attempt}/${config.qcMaxRetries ?? 1} reasons="${reasons.join('; ')}"`
                );
              },
              onQcError: (error: unknown) => {
                logDiag(
                  'error',
                  'qc.exception',
                  `QC exception caught: ${error instanceof Error ? error.message : String(error)}`
                );
              },
              onFirstImage: async (sheet: TakeSheet) => {
                const thumb = await makeThumbnail(sheet.base64, sheet.mimeType, 420);
                insertHistoryItem(
                  itemId,
                  sheet,
                  thumb,
                  undefined,
                  0,
                  config.qcEnabled
                );
                resolve();
              },
              onQc: async (update: TakeQcUpdate) => {
                let newThumb: string | undefined = undefined;
                if (update.changed) {
                  newThumb = await makeThumbnail(update.sheet.base64, update.sheet.mimeType, 420);
                }
                setHistory((prev) =>
                  prev.map((item) =>
                    item.id === itemId
                      ? {
                          ...item,
                          qc: update.report,
                          qcAttempts: update.attempts,
                          ...(update.changed && newThumb
                            ? {
                                mediaId: update.sheet.mediaId,
                                mimeType: update.sheet.mimeType,
                                base64: item.base64 === null ? null : update.sheet.base64,
                                thumb: newThumb,
                                promptUsed: update.sheet.promptUsed,
                                rewriteRound: update.sheet.rewriteRound,
                              }
                            : {}),
                        }
                      : item
                  )
                );
              },
            };

            const clearPending = () => {
              setHistory((prev) =>
                prev.map((item) => (item.id === itemId ? { ...item, qcPending: false } : item))
              );
            };

            const takePromise = runTake(deps, options);
            pendingQc.push(
              takePromise.then(clearPending, (error) => {
                reject(error);
                clearPending();
              })
            );
          }
        });
      });

      const rejections = settled.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );

      if (rejections.length === total) {
        throw rejections[0].reason;
      } else if (rejections.length > 0) {
        const firstErr = rejections[0].reason;
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        setErrorBanner(msg);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Đã xảy ra lỗi không xác định khi tạo ảnh.';
      setErrorBanner(msg);
      setJob((prev) => (prev ? { ...prev, error: msg } : null));
    } finally {
      isRunningRef.current = false;
      setJob(null);
    }
  }, []);

  /**
   * Run variant generation for an approved sheet.
   * item.mediaId is reference 1, followed by real face references if faceSource is 'upload'.
   */
  const runVariant = useCallback(
    async (
      item: HistoryItem,
      changes: VariantChanges,
      refs?: GenerationRefsContext,
      count: number = 1
    ) => {
      if (isRunningRef.current) return;
      if (!item.mediaId || !item.mediaId.trim()) {
        setErrorBanner('Không thể tạo biến thể vì ảnh nguồn chưa có mã lưu trữ (mediaId).');
        return;
      }

      if (!hasVariantChanges(changes)) {
        return;
      }

      isRunningRef.current = true;
      abortRequestedRef.current = false;
      setErrorBanner(null);

      const total = Math.max(1, Math.min(2, count));
      const startedAt = Date.now();

      setJob({
        total,
        done: 0,
        stage: 'translating',
        startedAt,
        error: null,
      });

      try {
        // Step 1: Translate free-text changes using translateConfigFields
        const dummyConfigForTranslate: CharacterConfig = {
          ...item.config,
          outfitDescription: changes.outfitDescription || '',
          extraNotes: changes.extra || '',
        };
        const translatedDummy = await translateConfigFields(dummyConfigForTranslate);

        const translatedChanges: VariantChanges = {
          ...changes,
          outfitDescription: changes.outfitDescription
            ? translatedDummy.outfitDescription
            : undefined,
          extra: changes.extra ? translatedDummy.extraNotes : undefined,
        };

        if (abortRequestedRef.current) {
          isRunningRef.current = false;
          setJob(null);
          return;
        }

        // Step 2: Build the new CharacterConfig with applied changes
        const newConfig = applyVariantChanges(item.config, translatedChanges);

        // Step 3: Prepare face references only when item.config.faceSource is 'upload' (outfit images not used)
        let faceMediaIds: string[] = [];
        let faceRefsCount = 0;

        if (item.config.faceSource === 'upload' && refs && refs.faceRefs.length > 0) {
          const prepResult = await prepareGenerationRefs({
            faceSource: 'upload',
            faceRefs: refs.faceRefs,
            outfitRefs: [], // outfit images not used in variant
            faceDna: refs.faceDna,
            outfitDna: '',
            faceLocked: refs.faceLocked,
            onStage: (stage) => {
              setJob((prev) => (prev ? { ...prev, stage } : null));
            },
          });

          refs.applyPrepared({
            faceRefs: prepResult.faceRefs,
            outfitRefs: refs.outfitRefs,
            faceDna: prepResult.faceDna,
          });

          faceMediaIds = prepResult.referenceMediaIds;
          faceRefsCount = prepResult.promptRefs.faceCount;
        }

        // Reference Media IDs = [item.mediaId, ...faceMediaIds] (max 10)
        const combinedRefIds = Array.from(
          new Set([item.mediaId, ...faceMediaIds].filter(Boolean))
        ).slice(0, 10);

        // Step 4: Build variant prompt
        const variantBasePrompt = buildVariantPrompt(newConfig, translatedChanges, {
          faceCount: faceRefsCount,
        });

        const faceRefForQc =
          item.config.faceSource === 'upload' && refs && refs.faceRefs.length > 0
            ? [{ base64: refs.faceRefs[0].base64, mimeType: refs.faceRefs[0].mimeType }]
            : undefined;

        const summaryForHistory = describeVariantChanges(changes);

        // Step 5: Sequential take generation
        for (let i = 1; i <= total; i++) {
          if (abortRequestedRef.current) break;

          let takePrompt = variantBasePrompt;
          if (total > 1) {
            takePrompt = `${variantBasePrompt} Variant take ${i} of ${total}: slight variation in pose.`;
          }

          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  done: i - 1,
                  stage: 'generating',
                  stageDetail: total > 1 ? `Biến thể ${i}/${total}` : undefined,
                }
              : null
          );

          let bestResult = await generateSheetImage({
            prompt: takePrompt,
            model: newConfig.model,
            aspectRatio: newConfig.aspectRatio,
            referenceMediaIds: combinedRefIds,
            onStage: (stage, detail) => {
              setJob((prev) => (prev ? { ...prev, stage, stageDetail: detail } : null));
            },
          });

          let bestReport: QcReport | undefined = undefined;
          let attemptsCount = 0;

          if (newConfig.qcEnabled) {
            setJob((prev) => (prev ? { ...prev, stage: 'inspecting', stageDetail: undefined } : null));

            try {
              const qcImage = await makeQcImage(bestResult.base64, bestResult.mimeType, 1280);
              bestReport = await inspectSheet({
                base64: qcImage.base64,
                mimeType: qcImage.mimeType,
                layoutId: newConfig.layoutId,
                faceRefs: faceRefForQc,
              });

              const maxRetries = newConfig.qcMaxRetries ?? 1;
              let currentAttemptPrompt = takePrompt;

              while (attemptsCount < maxRetries && !abortRequestedRef.current) {
                const decision = decideRetry(bestReport, {
                  minScore: 65,
                  strictFace: newConfig.faceFidelity === 'strict',
                });

                if (!decision.retry) break;

                attemptsCount += 1;
                const addendum = buildRetryAddendum(bestReport);
                currentAttemptPrompt = appendRetryAddendum(currentAttemptPrompt, addendum);

                setJob((prev) =>
                  prev
                    ? {
                        ...prev,
                        stage: 'generating',
                        stageDetail: 'Tạo lại do kiểm tra chất lượng',
                      }
                    : null
                );

                const retryResult = await generateSheetImage({
                  prompt: currentAttemptPrompt,
                  model: newConfig.model,
                  aspectRatio: newConfig.aspectRatio,
                  referenceMediaIds: combinedRefIds,
                  onStage: (stage, detail) => {
                    setJob((prev) => (prev ? { ...prev, stage, stageDetail: detail } : null));
                  },
                });

                setJob((prev) => (prev ? { ...prev, stage: 'inspecting', stageDetail: undefined } : null));

                const retryQcImage = await makeQcImage(retryResult.base64, retryResult.mimeType, 1280);
                const retryReport = await inspectSheet({
                  base64: retryQcImage.base64,
                  mimeType: retryQcImage.mimeType,
                  layoutId: newConfig.layoutId,
                  faceRefs: faceRefForQc,
                });

                if (retryReport.score >= bestReport.score) {
                  bestResult = retryResult;
                  bestReport = retryReport;
                }
              }
            } catch (qcErr: unknown) {
              logDiag(
                'error',
                'qc.exception_variant',
                `QC error on variant: ${qcErr instanceof Error ? qcErr.message : String(qcErr)}`
              );
            }
          }

          const thumb = await makeThumbnail(bestResult.base64, bestResult.mimeType, 420);

          const newItem: HistoryItem = {
            id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            createdAt: Date.now(),
            config: newConfig,
            promptUsed: bestResult.promptUsed,
            mediaId: bestResult.mediaId,
            mimeType: bestResult.mimeType,
            base64: bestResult.base64,
            thumb,
            rewriteRound: bestResult.rewriteRound,
            favorite: false,
            refMediaIds: combinedRefIds,
            qc: bestReport,
            qcAttempts: attemptsCount,
            parentId: item.id,
            changesSummary: summaryForHistory,
          };

          setHistory((prev) => {
            const updated = [newItem, ...prev].slice(0, 40);
            return updated.map((entry, idx) => {
              if (idx >= 12 && entry.base64 !== null) {
                return { ...entry, base64: null };
              }
              return entry;
            });
          });

          setSelectedId(newItem.id);
          setJob((prev) => (prev ? { ...prev, done: i } : null));

          if (abortRequestedRef.current) break;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Đã xảy ra lỗi khi tạo biến thể.';
        setErrorBanner(msg);
        setJob((prev) => (prev ? { ...prev, error: msg } : null));
      } finally {
        isRunningRef.current = false;
        setJob(null);
      }
    },
    []
  );

  /**
   * Stop signal finishes current API call and cancels subsequent images.
   */
  const stop = useCallback(() => {
    abortRequestedRef.current = true;
  }, []);

  /**
   * Toggle favorite status.
   */
  const toggleFavorite = useCallback((id: string) => {
    setHistory((prev) =>
      prev.map((item) => (item.id === id ? { ...item, favorite: !item.favorite } : item))
    );
  }, []);

  /**
   * Delete item from history.
   */
  const deleteItem = useCallback((id: string) => {
    setHistory((prev) => {
      const remaining = prev.filter((item) => item.id !== id);
      return remaining;
    });
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  return {
    history,
    setHistory,
    selectedItem,
    selectedId,
    setSelectedId,
    job,
    isRunning: isRunningRef.current || job !== null,
    errorBanner,
    setErrorBanner,
    run,
    runVariant,
    stop,
    toggleFavorite,
    deleteItem,
  };
}
