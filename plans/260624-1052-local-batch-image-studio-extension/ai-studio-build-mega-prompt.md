# Mega-prompt — AI Studio Build (Batch Image Generator & Editor)

> **Lưu ý:** prompt này build app trên **AI Studio Build**. App chạy bằng `GEMINI_API_KEY` (API key, ăn $100/tháng credit Ultra rồi metered) — KHÔNG dùng quota 1000 ảnh/ngày subscription. Muốn no-API thật → dùng plan extension `260624-1052`. Google Flow không build/host app được.

Dán phần dưới (trong khối ```) vào ô prompt của AI Studio Build:

---

```
Build a production-quality, single-page web app: a BATCH IMAGE GENERATOR & EDITOR that turns prompt files into images using Google's native image models, with a built-in image editor/upscaler.

## Tech & deploy constraints (MUST follow AI Studio Build conventions)
- Stack: React 19 + Vite 6 + TypeScript + Tailwind v4 frontend, plus an Express backend in `server.ts`.
- Backend port MUST be hardcoded `const PORT = 3000` (do NOT read process.env.PORT). Listen on "0.0.0.0".
- Image generation MUST happen server-side via `@google/genai`, reading the key from `process.env.GEMINI_API_KEY` (injected via the AI Studio Secrets panel). Never expose the key to the client.
- Build: `vite build` + esbuild bundle `server.ts` -> `dist/server.cjs` with `--packages=external`; start with `node dist/server.cjs`. Serve static `dist` and SPA-fallback in production.
- Gate `dotenv.config()` to non-production only.

## Models (user-selectable dropdown) — expose ONLY these two image models
- "Nano Banana Pro"  -> model id `gemini-3-pro-image`
- "Nano Banana 2"    -> model id `gemini-3.1-flash-image`
(Do NOT include Imagen — it is deprecated.)

## CRITICAL generation-correctness rules (bake these in)
- For these gemini native-image models, call `ai.models.generateContent` with `config.responseModalities = ['TEXT','IMAGE']` (TEXT listed first). Without this the model may return text-only and the app wrongly reports a "safety filter" error.
- `config.imageConfig.aspectRatio` = the chosen aspect ratio.
- `config.imageConfig.imageSize` accepts ONLY "512" | "1K" | "2K" | "4K" (use "512", NOT "512px").
- Parse the response by iterating `response.candidates[0].content.parts`; collect `part.inlineData.data` (base64) for the image and `part.text` for feedback. If no inlineData, surface the text as the error.
- Construct the GoogleGenAI client once at module scope (not per request).
- Set `httpOptions.timeout` ≈ 120000ms on the client (or use AbortController) so long calls fail cleanly; map a timeout to HTTP 504.
- Auto-retry with exponential backoff on 429 / 5xx / network errors (max ~3 tries). Relay the ORIGINAL status code to the client (429 stays 429); map safety/finishReason blocks to 422 with a clear message.
- Allowlist the two model ids server-side; reject anything else with 400.
- Keep request body limit modest (~2mb).

## Input panel
- A large textarea to paste prompts, AND a file upload accepting `.txt` and `.md`.
- AUTO-DETECT the delimiter between prompts/scenes, supporting (in priority order): custom scene markers (e.g. "--- SCENE 001 ---", "SCENE 1:", "[CẢNH 2]", "PHÂN CẢNH 3", "PROMPT 4"), Markdown headings (`#`..`######`), horizontal dividers (`---`, `===`, `***`, `___`), numbered lists (`1.` / `1)`), bullet lists (`-`, `*`, `•`), and finally double-newline paragraph splits.
- Show the detected strategy + scene count, and a live preview list of parsed scenes (title + cleaned prompt + detected negative prompt + detected aspect ratio).
- Support structured prompt blocks with key:value lines (Subject, Action/Energy, Setting, Style, Lighting/Color, Atmosphere, Composition, Camera, Negative) — combine into one high-quality prompt; lines starting with "Negative:" or "Avoid:" become the negative prompt. Detect aspect ratio from "<W:H> aspect ratio/ratio" or a bare "16:9 / 9:16 / 4:3 / 3:4" mention.

## Generation settings
- Model selector (the two above).
- Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4.
- Resolution / size: "Full HD (1920x1080, JPEG)", 2K, 4K, 1K, 512. For "Full HD": request 2K@16:9 then resize/compress client-side to exactly 1920x1080 as JPEG — BUT preserve the source aspect ratio (fit within 1920x1080, do NOT stretch non-16:9 images).
- Per-run delay (seconds) between consecutive prompts (user-set).

## Batch queue controls
- Start, Pause, Resume, Stop. Pause/Stop must abort the in-flight request via AbortController (one controller per run), not just set a flag.
- Process scenes sequentially honoring the delay.
- "Retry failed" button: re-run ONLY the scenes whose status is failed; automatically SKIP already-successful ones.
- Per-image icon buttons on every generated thumbnail: (a) regenerate this one image, (b) delete this image.
- Live progress: done/total, success/failed counts, current scene.

## Storage / performance
- Store generated images as Blob + objectURL (NOT base64 data URLs in React state) to avoid tab OOM on 50-200 image batches; revoke objectURLs when images are deleted/replaced.

## Download
- "Download all" button: zip every successful image into a single .zip (client-side, e.g. fflate or jszip) and download it.

## Image editor / upscaler (open from any thumbnail)
- Resize with width/height + lock-aspect-ratio.
- Resampling algorithm choice: Lanczos (implement real Lanczos resampling), plus a Real-ESRGAN-style enhancement option. Run heavy pixel work in a Web Worker (transfer the buffer) so the UI never freezes at 2K/4K. (Note: true native Real-ESRGAN/ImageMagick/Pillow binaries cannot run in this sandbox; use a browser/WASM or canvas-based implementation and label it accordingly.)
- Adjustments that ACTUALLY take effect: brightness, contrast, saturation, hue, exposure, vignette, blur, sharpen, denoise, grayscale, sepia, invert, edge-detect. Each control must visibly change the image (implement sharpen/blur/denoise via convolution).
- Working Undo/Redo with visible buttons (store history as Blob/objectURL or as serialized edit-state, not full-res PNG data URLs).
- Save (apply edits back to the gallery) and Download (single image) using `canvas.toBlob` (async), not `toDataURL`, for large canvases.

## UX
- Clean, responsive Tailwind UI, dark-friendly. Clear empty/loading/error states. Define any custom animation (e.g. fade-in) via Tailwind v4 `@theme` keyframes (don't reference undefined classes).

Deliver complete, working, type-checking code (tsc clean) with all of the above wired end-to-end.
```

---

## Sau khi build xong trên AI Studio
1. AI Studio → Settings → **Application secrets** → set `GEMINI_API_KEY` (nếu không có, mọi call ảnh trả 500).
2. Test từng model + từng size (512/1K/2K/4K + Full HD) + từng aspect ratio.
3. Nếu báo "safety filter" sai dù prompt hợp lệ → kiểm tra `responseModalities` đã có chưa.

## Unresolved / honest caveats
- App này **dùng API key**, không phải quota subscription Ultra. Đây là giới hạn nền tảng, không sửa được bằng prompt.
- Real-ESRGAN/ImageMagick/Pillow **native không chạy** trong sandbox AI Studio → bản build chỉ upscale bằng Lanczos/WASM client-side.
- Muốn no-API thật + binary upscale thật → đường extension (plan `260624-1052`).
