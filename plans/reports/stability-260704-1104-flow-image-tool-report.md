# Stability Optimization — Flow Batch Image Tool (round 3)

- **Date:** 2026-07-04
- **Method:** ultracode workflow — 6-dimension audit × 8 findings → adversarial verify → synthesize. 36 findings verified real. Synthesizer drifted to wrong codebase; patches written manually from verified findings.
- **Output locations (both synced, identical):**
  - Local (reliable, real module structure): `/home/dung/VIBE_CODING/1. OTHERS/Flow-tool/flow-tool-fixed/` — `App.tsx`, `types.ts`, `components/{ImageEditor,Primitives}.tsx`, `services/{image,parser}.ts`
  - Gdrive (original location): `/home/dung/cloud/gdrive/3. KHÁC/1. FLOW TOOLS/1. Tool image flow/*.txt`
- **Verification:** `tsc --noEmit` clean (0 code errors; 3 "Cannot find module 'react'" = test-setup noise). Parser 26/26 node tests pass. genId verified.

## ⚠️ Gdrive note
During editing, `App.tsx.txt` was truncated to 0 bytes twice by the gdrive FUSE mount (Edit tool writes triggered sync corruption). Final sync via `cp` (not Edit) succeeded — all 6 gdrive files now non-zero and byte-identical to local. **If you re-edit on gdrive, use `cp` from local or write fresh; avoid the Edit tool on this mount.** Local `flow-tool-fixed/` is the reliable source of truth.

## Patches applied (from 36 verified findings)

### App.tsx
- **Re-entry guard** (`runningRef`): double-click Start/Launch/Retry no longer spawns 2 racing batch loops. Ref flips synchronously, resets on completion/Stop/empty.
- **Start Batch disabled** when `scenes.length === 0` (no-op run).
- **handleParse confirm** before discarding already-generated images.
- **file-import try/catch** + input reset (unhandled rejection on bad file; re-select same file fires onChange).
- **upscaleImage wrapped in `withTimeout`** (180s) — hung Pica resize can't block batch.
- **mimeType fallback** (`|| 'image/jpeg'`) when storing result + in gallery `<img src>` + download ext — prevents TypeError crash if Flow omits mimeType.
- **Download All >50 confirm** — warns before building a ZIP that may OOM the tab.
- **FileReader.onerror** — failed read no longer leaves Download button stuck on "Processing...".
- **errorMessage rendered** in Live Execution Log (red, truncated) — user sees rate-limit/safety-filter/network cause instead of bare red icon.
- **detectSeparator memoized** (`useMemo`) — 5 regexes no longer re-run on every keystroke.
- **Clear Session signals Stop** + resets batch state — no zombie loop on cleared scenes.
- **gallery `<img loading="lazy">`** — decode only visible images.

### components/ImageEditor.tsx
- **Module-level `loadOpenCV()`** dedupes the CDN `<script>` across editor mounts (no double-injection) + `onerror` surfaces CDN/runtime failure (was: spinner stuck on "Loading Editor..." forever if CDN blocked or cv never ready).
- **Source-image `onerror` + `loadError` UI** — corrupt/unsupported image shows error + Close instead of infinite spinner.
- **Source-image effect cleanup** (`cancelled` flag) — unmount mid-load no longer setState on unmounted component.
- **handleExport('download') try/catch** — Flow.download rejection no longer unhandled rejection (alert on failure).
- *(round 1)* try/finally Mat cleanup, imageSmoothingQuality='high', source-mime export, applyPreset, Undo/Redo.

### components/Primitives.tsx
- **DragNumberField unmount cleanup** (`dragListenersRef` + `useEffect` return) — mousemove/mouseup removed + cursor reset if component unmounts mid-drag (was: leaked listeners + stuck ns-resize cursor).

### services/parser.ts
- **`genId()` fallback** for `crypto.randomUUID` — non-secure embed (file://) no longer throws and breaks parsing. (Flow is HTTPS so randomUUID is used; fallback is a guard.)
- *(round 1)* regex determinism, flag-i preservation, marker trailing-content, inline AR all 5, divider/list split fix, `:\s+` structured regex.

## Not applied (deferred, documented)
- **#12 full blob/object-URL storage** (drop base64 from state): the real OOM fix for hundreds of 4K, but a 3-file architectural refactor (Scene.result shape, editor interface, download path) that can't be runtime-tested on Flow — risk of broken images/leaks outweighs benefit for typical use. Mitigations applied instead: `loading="lazy"`, >50 ZIP confirm. **Recommend doing this as a focused, separately-tested pass if you regularly batch 100+ 4K images.**
- **#14 full Lanczos in editor via Pica**: `applyFilters` is sync; Pica is async → race with Undo/Redo snapshot + OpenCV. Kept `imageSmoothingQuality='high'` (round 1). A separate export-time Lanczos pass is the clean path if needed.

## Verification detail
- `tsc --noEmit` on both local and gdrive-sourced copies: 0 code/type errors (3 = missing @types/react noise).
- Parser node tests (26/26): regex determinism, case-insensitive marker split, trailing-content preservation, inline AR 5 ratios, structured AR, divider preamble, list split, single scene, negative prompt.
- genId: UUID path verified; fallback correct by inspection (WebCrypto.randomUUID is non-deletable in node so the fallback path couldn't be force-tested, but the code is trivial and correct).

## Unresolved questions
1. Do you regularly batch 100+ 4K images in one session? If yes, authorize the full object-URL storage refactor (#12) as a focused pass — it's the only remaining OOM risk.
2. The synthesizer agent drifted to a different project (`ai-batch-image-generator-and-editor/`) in this repo and emitted misaligned patches — discarded. That other project exists in the repo (`?? ai-batch-image-generator-and-editor/` per git status); unrelated to this Flow tool.