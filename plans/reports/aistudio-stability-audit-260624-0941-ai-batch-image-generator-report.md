# AI Batch Image Generator & Editor — Audit ổn định trên Google AI Studio

**Ngày:** 2026-06-24 · **Scope:** `ai-batch-image-generator-and-editor/` (~2.500 dòng: React 19 + Vite 6 + Tailwind v4 + Express `server.ts` gọi `@google/genai` server-side)
**Phương pháp:** Đọc toàn bộ source + build/TSC thực tế + grep SDK thật + workflow 5-agent (2 research web, 3 adversarial code review, ~313K tokens).

---

## TL;DR

- Code **build sạch** (`tsc --noEmit` exit 0; `vite build` + `esbuild server.cjs` OK) và **về cơ bản đã tuân thủ convention AI Studio Build** (PORT 3000, `vite+esbuild→dist/server.cjs`, `NODE_ENV`/`DISABLE_HMR`, GEMINI_API_KEY qua Secrets).
- **Nhưng sẽ KHÔNG chạy ổn định như-is** vì một bug CRITICAL ở backend và nhiều bug HIGH ở flow batch. Nguyên nhân khả nghi nhất của việc "chạy không ổn định": **thiếu `responseModalities: ['TEXT','IMAGE']`** ở nhánh `generateContent` → model image có thể chỉ trả text → app ném lỗi "safety filters" nhầm.
- Đã **bác bỏ 2 nghi vấn ban đầu**: (1) PORT=3000 **không phải bug** cho AI Studio (infrastructure hardcode, AI Studio cấm đọc `process.env.PORT`); (2) các model ID `gemini-3.1-flash-image` / `gemini-3-pro-image` / `gemini-2.5-flash-image` **đều thật, GA 2026-05-28** — không phải hallucinate.

---

## Trạng thái deploy AI Studio (đã verify)

| Mục | Kết luận |
|---|---|
| PORT=3000 hardcode (`server.ts:11`) | **ĐÚNG cho AI Studio** (nginx reverse-proxy hardcode 3000, cấm đọc `process.env.PORT`). Chỉ **break nếu export ra standalone Cloud Run**. → Giữ 3000; nếu muốn tương thích Cloud Run độc lập: `const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;` (LOW). |
| `GEMINI_API_KEY` | Inject runtime qua **Secrets panel** (env var), **không** từ `.env`. `dotenv` là no-op ở prod. Đúng. |
| Build/start (`vite build && esbuild → dist/server.cjs`; `node dist/server.cjs`) | Khớp convention AI Studio. `--packages=external` đúng. |
| `NODE_ENV`/`DISABLE_HMR` | Xử lý đúng. |
| `.gitignore` | Đúng (ignore `.env*`, giữ `.env.example`). |

> **Lưu ý cấu hình (không phải code):** trước khi deploy, phải set `GEMINI_API_KEY` trong **AI Studio → Settings → Application secrets**, nếu không mọi call `/api/generate-image` trả 500.

---

## CRITICAL (chặn chạy ổn định)

### C1 — Thiếu `responseModalities: ['TEXT','IMAGE']` ở nhánh Gemini image
- **File:** `server.ts:79-93` (config chỉ có `imageConfig`, không set `responseModalities`).
- **Hiệu ứng:** mọi ví dụ chính thức của Google cho `gemini-*.1-flash-image` / `gemini-3-pro-image` đều yêu cầu `config.responseModalities = ['TEXT','IMAGE']` (TEXT trước). Không có → model có thể trả TEXT-only → for-loop (`server.ts:102-108`) không thấy `inlineData` → ném lỗi "safety filters" **nhầm** (`server.ts:111`) dù prompt hợp lệ. **Đây là nguyên nhân khả nghi #1 của "chạy không ổn định".**
- **Fix:** thêm `responseModalities: ['TEXT', 'IMAGE']` vào `config` (server.ts ~79) cho mọi model Gemini native-image. (Verdict: high confidence, có nguồn docs; nên verify thực tế với API key thật.)

### C2 — Image Studio xử lý pixel nặng trên main thread → freeze UI ở 2K/4K
- **File:** `imageProcessor.ts:32-77` (`resampleLanczos` O(dest_px·support²)) và `86-201` (`applyRealESRGANSimulation`: bilateral denoise + unsharp trên ảnh đã upscale).
- **Hiệu ứng:** 4K (3840×2160 ≈ 8.3M px) ≈ 3e9 FLOP, đồng bộ trên main thread → tab **đóng băng vài giây–chục giây** (spinner cũng không animate). `setTimeout(150)` (`ImageStudio.tsx:171`) chỉ hoãn lúc bắt đầu, không chống freeze.
- **Fix:** chuyển `resampleLanczos` + `applyRealESRGANSimulation` vào **Web Worker** (transfer `Uint8ClampedArray.buffer`); hoặc cap Lanczos ≤1080p và dùng `ctx.drawImage(imageSmoothingQuality='high')` GPU cho lớn hơn.

---

## HIGH

| # | Vấn đề | Bằng chứng | Fix |
|---|---|---|---|
| H1 | `imageSize:"512px"` **không hợp lệ** → giá trị đúng là `"512"` | `types.ts:20`, `App.tsx:564`, `server.ts:85-87`; SDK enum `ImageConfigImageSize="1K"\|"2K"\|"4K"\|"512"` (genai.d.ts:6697) | Đổi `"512px"`→`"512"` ở type + option; (giữ 1K/2K/4K) |
| H2 | **Không timeout** cho Gemini call | `server.ts:53,89` không `httpOptions.timeout`/AbortSignal; Cloud Run cap 5 phút | Set `httpOptions.timeout` (~120s) khi construct `GoogleGenAI`; hoặc AbortController; map timeout→504 |
| H3 | **Không auto-retry / không xử lý 429** dù là batch | `App.tsx` startQueue fail ngay; `server.ts:121-124` gộp mọi lỗi thành 500 | Thêm retry có backoff cho 429/5xx/network; backend relay status code gốc (429→429) |
| H4 | **Không AbortController** trên fetch → Pause không hủy request đang chạy | `App.tsx:177,259`; `stopQueue` chỉ set flag | 1 AbortController/run, `controller.abort()` trong stopQueue; `Promise.race` timeout ~90s |
| H5 | `sharpen`/`blur`/`denoise` có state + UI **nhưng không implement** → đổi không thấy hiệu ứng | `types.ts`, `ImageStudio.tsx:485-492`; `applyCanvasAdjustments` đọc nhưng không dùng (`imageProcessor.ts:222/221/227`); thiếu trong deps array (`ImageStudio.tsx:107-120`) | Implement convolution hoặc **xóa** control để không gây hiểu nhầm |
| H6 | **Undo/Redo khai báo nhưng không có UI/logic** | import `Undo2`/`RotateCw` (`ImageStudio.tsx:13-14`), state `history` (`59-60`), push (`218-219`) — nhưng 0 nút, 0 đọc lại | Thêm nút Undo/Redo hoặc **xóa** state/import (an toàn hơn khi chưa build xong) |
| H7 | History lưu **PNG dataURL full-res** → OOM | `ImageStudio.tsx:217-219` (`canvas.toDataURL('image/png')` cho canvas 4K ~33MB) | Lưu `Blob`+objectURL, hoặc chỉ snapshot `editState` rồi re-derive; cap length |

---

## MODERATE

- **M1 — `resizeAndCompressToFullHD` stretch méo:** `imageCompressor.ts:13-23` force-fill 1920×1080 bỏ qua aspect ratio gốc → méo mọi ảnh non-16:9 (1:1, 9:16, 4:3, 3:4). Tính target w/h từ `naturalWidth/Height` capped 1920×1080.
- **M2 — Memory blowup batch lớn:** mọi ảnh lưu base64 dataURL trong `prompts` state (`App.tsx:203,282-286`); 50–100 scene × 2–8MB → OOM tab. Dùng Blob/objectURL (`URL.createObjectURL`), revoke khi xóa.
- **M3 — Static path dùng `process.cwd()/dist` fragile:** `server.ts:135-139`. Đổi thành `__dirname` (server.cjs nằm cạnh index.html trong dist/), cwd-independent.
- **M4 — Client kiểm soát `model`, không allowlist:** `server.ts:18,90` truyền thẳng vào SDK. Endpoint public, không auth → probe model tùy ý / tốn chi phí. Allowlist 4 model, reject остальные → 400.
- **M5 — Lỗi 429/safety bị gộp thành 500 chung:** `server.ts:121-124` chỉ `error.message`; mất status code + `finishReason` (safety). Đọc `error.status`/`candidates[0].finishReason`, map 429→429, safety→422.
- **M6 — Body limit 50mb + không rate-limit/auth:** `server.ts:13`; endpoint billable public. Giảm limit (~1mb), thêm `express-rate-limit`.
- **M7 — `animate-fade-in` dùng nhưng không định nghĩa:** Tailwind v4 không ship; không có `@keyframes` trong `index.css`. Thêm `--animate-fade-in` + `@keyframes fade-in` trong `@theme`, hoặc bỏ class.
- **M8 — `ImageStudioProps` interface dead:** `ImageStudio.tsx:23-28` khác signature thực (`url`/`onSave`/`onClose`, `isOpen`/`imageUrl` không dùng). Xóa.
- **M9 — `imagen-4.0-generate-001` đang deprecated** (shutdown ~2026-08-17, thay bằng `gemini-3.1-flash-image`). Xóa option hoặc gắn cảnh báo. Label "Imagen 4.0 Pro Engine" cũng sai (không có biến thể "Pro").
- **M10 — `setTimeout(150/100)` hack:** `ImageStudio.tsx:79,171` đua với canvas/render, stale-closure cho filter pass đầu. Dùng layout effect / Worker.
- **M11 — `canvas.toDataURL('image/png')` cho canvas lớn chậm:** `ImageStudio.tsx:234,240` (Download + Save). Dùng `canvas.toBlob` async + objectURL.
- **M12 — `dotenv.config()` chạy trong bundle prod CJS:** `server.ts:7`. Gate `if (NODE_ENV !== 'production')`.

---

## LOW

- **L1 Dead code:** `queueStateRef`/`setPromptsSafe`/`promptsRef` (`App.tsx:213,326,323`); `ImageStudioProps`; `denoiseAmountFactor`/`denicityScale` (`imageProcessor.ts:204-205`, identity funcs). Xóa.
- **L2 Express wildcard:** `app.get('*')` (`server.ts:137`) chỉ hợp lệ Express 4; Express 5 cần named pattern. Pin `express ~4.21.2`.
- **L3 `GoogleGenAI` khởi tạo mỗi request:** `server.ts:31-38`. Hoist lên module scope (key theo apiKey).
- **L4 Không `engines`:** thêm `"engines":{"node":">=18"}` (guard rail).
- **L5 StrictMode double-parse on mount:** `App.tsx:101-103`. Đổi sang `useMemo` trên `inputText`.
- **L6 Parser ratio detection substring:** `parser.ts:337-345` match "16:9" ở đâu cũng được (kể cả trong Negative). Anchor regex `(?:aspect ratio|ratio)[:\-]?\s*(\d+:\d+)`, chỉ quét positive fields.
- **L7 Vignette loop `Math.sqrt`/pixel + tempCanvas alloc:** `imageProcessor.ts:325-340,96-102`. Precompute `1/maxDistance`; dùng `new ImageData(new Uint8ClampedArray(pixels),w,h)`.

---

## Đã verify KHÔNG phải bug (bác bỏ nghi vấn)

- **PORT=3000** đúng cho AI Studio (xem bảng trên). Nghi vấn CRITICAL ban đầu sai cho path AI Studio-hosted.
- **3 model ID Gemini image đều thật & GA** (`gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-2.5-flash-image`, GA 2026-05-28). Nghi vấn "hallucinate" dựa trên info cũ → sai.
- **`imageConfig.imageSize` là field hợp lệ** (SDK genai.d.ts:4807/6647/6654). Chỉ **giá trị** "512px" sai.
- **aspectRatio values** (1:1, 16:9, 9:16, 4:3, 3:4) đều hợp lệ cho cả Gemini lẫn Imagen.
- **Build/TSC sạch** (npm install 229 pkg 0 vuln; tsc exit 0; build exit 0).

---

## Roadmap hoàn thiện (theo ưu tiên)

**P0 — để chạy được ổn định (làm trước):**
1. C1: thêm `responseModalities: ['TEXT','IMAGE']` (server.ts).
2. H1: sửa `"512px"`→`"512"` (types.ts, App.tsx, server.ts normalize).
3. H2+H3+H4: timeout server-side + auto-retry/backoff + AbortController + relay 429.
4. Verify thực tế trên AI Studio với API key thật (test từng model + 512/1K/2K/4K).

**P1 — ổn định batch lớn & UX:**
5. M1 (aspect ratio resize), M2 (Blob thay dataURL), M4 (model allowlist), M5 (error mapping).
6. C2: chuyển DSP sang Web Worker (Lanczos/ESRGAN). H5/H6: implement hoặc xóa sharpen/blur/denoise/undo-redo. H7: history Blob.
7. M3 (__dirname), M7 (fade-in keyframes), M9 (Imagen warning/remove).

**P2 — dọn dẹp & hardening:**
8. L1–L7 (dead code, express pin, engines, useMemo, parser regex, perf micro).
9. M6 (rate-limit), M10–M12.

---

## Unresolved questions
1. **C1 cần verify thực tế:** `responseModalities` có thực sự bắt buộc với SDK 2.4 + các model này không? (Docs nói có; test với key thật trên AI Studio.)
2. **M9 ngày shutdown Imagen:** agent report nội bộ mâu thuẫn (Một chỗ nói "June 24, 2026", deprecation table nói "2026-08-17"). Xác nhận lại tại https://ai.google.dev/gemini-api/docs/deprecations.
3. Có cần hỗ trợ **standalone Cloud Run** (ngoài AI Studio)? Quyết định fix PORT (L7).
4. Batch tối đa bao nhiêu scene cần hỗ trợ? (Ảnh hưởng M2/H7 — quyết định chiến lược lưu trữ Blob vs dataURL.)
