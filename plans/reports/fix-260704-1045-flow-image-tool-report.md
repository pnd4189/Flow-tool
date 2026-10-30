# Fix Report — Flow Batch Scene Image Generator & Editor

- **Date:** 2026-07-04
- **Source review:** `plans/reports/code-review-260704-1021-flow-image-tool-report.md`
- **Target:** `/home/dung/cloud/gdrive/3. KHÁC/1. FLOW TOOLS/1. Tool image flow` (code copy từ Flow mini app)
- **Verification:** node behavioral tests (parser 26/26 pass) + `tsc --noEmit` (no syntax/type errors in code; chỉ missing @types/react noise)

## Files đã sửa
| File copy | Module | Thay đổi |
|---|---|---|
| `services_parser.ts.txt` | services/parser.ts | rewrite logic split + AR + title |
| `components_Image_editor.tsx.txt` | components/ImageEditor.tsx | full rewrite |
| `App.tsx.txt` | App.tsx | 5 edits cục bộ |
| `components_Primitives.tsx.txt` | components/Primitives.tsx | remove dead export |
| `services_image.ts.txt`, `type.ts.txt` | — | không đổi |

## Fix chi tiết (theo finding # trong review)

### Correctness (đã verify)
- **#1 regex statefulness** — bỏ flag `g` khỏi pattern marker (`/.../gi` → `/.../i`). `.test()` không còn stateful.
- **#2 mất flag `i` trong matchAll** — `new RegExp(sep.pattern, 'gm')` → `new RegExp(sep.pattern.source, sep.pattern.flags + 'g')`, giữ `i`/`m`, thêm `g`. Marker VN viết thường `[cảnh 1]` match đúng.
- **#3 preset dimension sai** — thêm `applyPreset(w,h)`: `setLockAR(false)` trước, rồi `setWidth/setHeight` trực tiếp (không qua `handleWidthChange` → không re-derive theo AR stale). 1080p luôn ra 1920x1080.
- **#4 negativePrompt bị vứt** — fold vào prompt: `scene.negativePrompt ? \`${prompt}\n\nAvoid: ${negativePrompt}\` : prompt` (Flow SDK không có field negativePrompt riêng).
- **#5 title<50 mất content** — với marker/markdown, extract label (match token) làm title, giữ remainder của dòng đầu làm content. "SCENE 1: A sunset" → title "SCENE 1:", prompt có "A sunset".
- **#6 download stuck** — `Flow.download` trong `reader.onload` wrap try/catch/finally; finally luôn reset `dlProgress.isProcessing=false`.
- **#7 toDataURL luôn JPEG** — dùng `image.mimeType` gốc; PNG giữ alpha, filename ext đúng.
- **#8 inline AR thiếu 4:3/3:4/1:1** — `matchAR()` dùng `/\b(16:9|9:16|1:1|4:3|3:4)\b/i` cho cả structured field lẫn inline. Đổi regex structured `:\s*` → `:\s+` để "4:3" (colon không space) không bị bắt nhầm thành key:value.
- **#9 negative prompt không hiện UI** — thêm input negative prompt trong preview card (hiện khi `scene.negativePrompt` truthy).

### Robustness
- **#10 không timeout per-scene** — thêm `function withTimeout<T>()` (function declaration, tránh ambiguity generic arrow trong .tsx); wrap `Flow.generate.image` với 180s. Hung request → fail → scene 'error' → retry được. (Dùng function declaration thay `<T>(...) =>` để .tsx parser không hiểu nhầm JSX.)
- **#11 OpenCV Mat leak** — declare `src/dst/edges/blurred` ngoài try, `finally` delete tất cả. Exception không leak WASM.
- **#12 memory blowup 4K** — **DEFERRED** (cần refactor sang `URL.createObjectURL` + revoke, rủi ro regression cao, không test được trên Flow). Đã note.

### Cleanup / altitude / missing feature
- **#13 saturation/hue dead state + 50MB ImageData waste** — xóa state `saturation`/`hue` và block `if(saturation!==0||hue!==0)` (block đó chỉ gọi getImageData rồi bỏ, alloc ~50MB mỗi lần kéo slider 4K).
- **#14 editor dùng drawImage thay Pica** — **PARTIAL**: thêm `ctx.imageSmoothingQuality='high'` (browser interpolation tốt hơn) trước drawImage. Full Pica-in-editor DEFERRED (applyFilters sync; Pica async sẽ gây race với snapshot + OpenCV, rủi ro cao).
- **#15 Undo/Redo stub** — implement Undo/Redo via parameter snapshots: `history`/`historyIdx` + ref mirror (tránh stale closure), debounce 400ms, cap 20 entries, `skipSnapshotRef` guard khi restore. Nút Undo/Redo enable theo `historyIdx`.
- **Open Q#2 dead ternary** — `failedCount: resumeOnlyFailed ? 0 : 0` → `failedCount: 0` (logic đúng, 2 nhánh đều 0; giữ successCount khi retry).
- **Open Q#3 SegmentedToggle** — xóa export unused.
- **Bonus (pre-existing bug tìm thấy khi verify):** split logic drop preamble trước separator đầu + include delimiter vào block tiếp theo (divider/list). Fix: tách 2 nhánh — marker/markdown giữ match làm title (drop preamble), divider/list exclude delimiter + giữ preamble làm scene đầu.

### Open Q#1 (types số nhiều)
- User xác nhận file thật là `types.ts` → import `./types` đúng, không phải bug, chỉ là copy artifact. Không đổi code.

## Verification
- **Parser:** 26/26 node test pass (regex determinism, case-insensitive marker, trailing content, inline AR 5 ratios, structured AR, negative prompt, preset dimensions, markdown, divider, list, single scene).
- **TypeScript:** `tsc --noEmit` trên bản copy — 0 lỗi syntax/type trong code (chỉ 3 lỗi "Cannot find module 'react'" do test setup thiếu @types/react).
- **withTimeout:** isolated .tsx test — generic infer đúng, `result.base64/mimeType/mediaId` type-check OK.
- **Lưu ý:** không test được runtime thật (Flow SDK, OpenCV.js, pica chỉ có trên Flow). Verify logic + syntax tới mức có thể.

## Câu hỏi mở / chưa fix
1. **#12 memory blowup** — refactor sang object URL (revoke trên delete/download) là thay đổi kiến trúc, rủi ro regression cao trên code không test được. Có muốn làm không? Cần bạn xác nhận.
2. **#14 full Lanczos in editor** — dùng Pica trong applyFilters (async) sẽ gây race với snapshot Undo/Redo + OpenCV. Đã dùng `imageSmoothingQuality='high'` thay. Có muốn tách export-time Lanczos pass riêng không?

## Gdrive note
Trong quá trình verify, file `services_parser.ts.txt` từng bị truncate về 0 byte (nghi do gdrive FUSE sync khi chạy lệnh `head -n` với biến LINE rỗng). Đã restore lại full code (141 dòng, 5770 bytes). Khuyên: sau khi copy code về Flow, kiểm tra file size trên gdrive để chắc chắn không bị truncate.