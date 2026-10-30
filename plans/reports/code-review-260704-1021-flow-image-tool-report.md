# Code Review — Flow "Batch Scene Image Generator & Editor"

- **Target:** `/home/dung/cloud/gdrive/3. KHÁC/1. FLOW TOOLS/1. Tool image flow` (code thủ công copy từ Google Flow mini app)
- **Scope:** 6 file — `App.tsx`, `components/ImageEditor.tsx`, `components/Primitives.tsx`, `services/image.ts`, `services/parser.ts`, `types.ts`
- **Effort:** max (5+5 angles + verify + sweep)
- **Date:** 2026-07-04
- **Verified bằng node:** regex statefulness, flag `i` drop, preset dimension drift

## File map (copy artifact → real module)
| Copy file | Real module |
|---|---|
| `App.tsx.txt` | `App.tsx` |
| `components_Image_editor.tsx.txt` | `components/ImageEditor.tsx` |
| `components_Primitives.tsx.txt` | `components/Primitives.tsx` |
| `services_image.ts.txt` | `services/image.ts` |
| `services_parser.ts.txt` | `services/parser.ts` (bỏ transcript chat phía sau) |
| `type.ts.txt` | `types.ts` (xem câu hỏi mở #1) |

## Tóm tắt đánh giá tối ưu
Codebase **chưa tối ưu**, dính nhiều bug correctness ở parser và ImageEditor. Kiến trúc gọn (6 file, tách service/component hợp lý), UX ổn, nhưng có bug regex làm hỏng tính năng cốt lõi (split scene), bug upscale preset sai dimension, negative prompt bị vứt, memory blowup với ảnh 4K, và vài tính năng spec bị stub (Undo/Redo, negative prompt UI).

## Findings (15, rank theo severity)

### Correctness (đã verify)
1. **`detectSeparator` regex statefulness** — `services/parser.ts:11-16` (patterns `:4-8`). Các pattern có flag `g` (marker) + `.test()` giữ `lastIndex` giữa các lần gọi → kết quả không deterministic. Verified: gọi 5 lần, lần 3 trả "Dividers" thay vì "Marker". UI label flicker + parse sai separator.
2. **`parseScenes` mất flag `i`** — `services/parser.ts:26`. `new RegExp(sep.pattern, 'gm')` build từ source của pattern `/.../gi`, đánh mất case-insensitive → marker tiếng Việt viết thường `[cảnh 1]` không match → `matches.length===0` → toàn bộ input thành 1 scene. Verified via node.
3. **Preset 1080p/2K/4K sai dimension cho ảnh non-16:9** — `components/ImageEditor.tsx:220-222`. Gọi `handleWidthChange(1920); handleHeightChange(1080)` khi `lockAR` vẫn true (closure stale, `setLockAR(false)` chạy sau) → width bị re-derive theo AR. Verified: ảnh 1:1 ra 1080x1080, 9:16 ra 608x1080, 4:3 ra 1440x1080 (đều sai 1920x1080).
4. **`negativePrompt` parse nhưng không truyền model** — `App.tsx:107-111`. `Flow.generate.image` chỉ nhận `prompt/aspectRatio/modelDisplayName`; `scene.negativePrompt` bị vứt. Spec yêu cầu dùng negative prompt.
5. **Title<50 guard làm mất content** — `services/parser.ts:44,52`. Với marker/markdown, `contentLines=lines.slice(1)` luôn bỏ dòng đầu; nếu dòng đầu >50 char → title thành "Scene N" generic VÀ dòng đó mất khỏi prompt. Vd `SCENE 1: A sunset` → "A sunset" biến mất.
6. **`Flow.download` ngoài try/catch → progress stuck** — `App.tsx:166-176`. `reader.onload` async, `await Flow.download` nằm ngoài try/catch bao quanh; nếu download throw, `setDlProgress(isProcessing:false)` không chạy → nút "Processing..." stuck vĩnh viễn.
7. **`toDataURL` luôn JPEG** — `components/ImageEditor.tsx:160`. Hardcode `image/jpeg` bất kể mimeType gốc → PNG có alpha bị flatten mất transparency, nén lossy.
8. **Inline AR detection thiếu 4:3/3:4/1:1** — `services/parser.ts:73-74`. Structured `aspect ratio:` field (62-67) bắt đủ 5 ratio, nhưng inline prose chỉ bắt 16:9/9:16 → "compose in 4:3" bị default 16:9.
9. **Negative prompt không hiển thị trong preview UI** — `App.tsx:288-293`. Preview chỉ show title+prompt+AR; spec (line 108) yêu cầu "title + prompt + optional negative prompt + optional AR".

### Robustness (plausible)
10. **Không có timeout per-scene; Stop không hủy generation in-flight** — `App.tsx:107`. Nếu `Flow.generate.image` hang, loop kẹt ở await, `stopBatchRef` không được check → scene stuck 'generating', batch hung, Retry Failed bỏ qua scene đó.
11. **OpenCV Mat leak trên exception** — `components/ImageEditor.tsx:131-133`. Catch chỉ log, không `src.delete()/dst.delete()/edges/blurred.delete()` → leak WASM heap khi lỗi pipeline.
12. **Memory blowup 4K base64 trong React state + DOM** — `App.tsx:16,414`. Mỗi ảnh 4K JPEG base64 ~3-7MB; 50 scene → 150-350MB trong state + thêm bản DOM `<img src=data:>` → OOM trên máy yếu.

### Cleanup / altitude / missing feature
13. **Dead state `saturation`/`hue` + block vô dụng alloc 50MB** — `components/ImageEditor.tsx:20-21,137-141`. Không có slider nào set 2 state; block `if(saturation!==0||hue!==0)` chỉ gọi `getImageData` rồi bỏ → mỗi lần kéo slider allocate ~50MB ImageData (4K) rồi discard.
14. **Editor dùng `ctx.drawImage` (bilinear) thay vì reuse Pica `upscaleImage`** — `components/ImageEditor.tsx:79` vs `services/image.ts`. 2 đường upscale khác chất lượng trong 1 app (gallery Lanczos, editor bilinear) → output không nhất quán, maintain 2 thuật toán.
15. **Undo/Redo stub disabled, spec feature chưa implement** — `components/ImageEditor.tsx:35-36,194-195`. `history`/`historyIdx` state khai báo nhưng never used; 2 nút Undo/Redo render `disabled` với `onClick={()=>{}}`. Spec yêu cầu Undo/Redo.

## Câu hỏi mở (cần user xác nhận)
1. **Tên file types**: code import `./types` (số nhiều) nhưng file copy là `type.ts.txt` (số ít). Nếu file thật trên Flow là `type.ts` → toàn bộ import fail (app không build). Nếu là `types.ts` và bạn rename khi copy → không phải bug. Hãy check tên file thật trong project Flow.
2. **Dead ternary** `failedCount: resumeOnlyFailed ? 0 : 0` (`App.tsx:91`) — 2 nhánh giống nhau (0:0). Có vẻ intent là giữ failedCount cũ khi retry, nhưng viết nhầm. Xác nhận logic mong muốn.
3. **`SegmentedToggle` export nhưng không import ở đâu** (`Primitives.tsx:160`) — dead export.

## Câu hỏi Imagen 4 (trả lời riêng, see chat)
Flow mini app (Flow Tools) chỉ expose Gemini Image models (Nano Banana) qua subscription, không có Imagen 4. Imagen 4 đang bị Google retire. Chi tiết trong chat.

## Nguồn (Imagen 4)
- Firebase AI Logic migration guide (firebase.google.com/docs/ai-logic/imagen-models-migration): "All Imagen models are deprecated and will shut down as early as June 30, 2026." → migrate sang Gemini 3.x Image (Nano Banana).
- YingTu comparison: `imagen-4.0-generate-001` etc. — Firebase shutdown 24/6/2026, Gemini API endpoint 17/8/2026. Hôm nay 4/7/2026 đã qua mốc Firebase.
- labs.google/fx/tools/flow: Flow = AI Creative Studio by DeepMind (Veo + Nano Banana).
- YouTube "Google Flow Tools Create Your Own AI Image Apps with Nano Banana": Flow Tools feature dùng Nano Banana, không API key.