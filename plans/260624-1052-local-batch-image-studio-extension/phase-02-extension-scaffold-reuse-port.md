---
phase: 2
title: "Extension Scaffold & Reuse Port"
status: pending
effort: ""
priority: P1
dependencies: [1]
---

# Phase 2: Extension Scaffold & Reuse Port

## Overview

Dựng skeleton Chrome Extension MV3 (build bằng Vite + CRXJS), port nguyên `parser.ts`/`types.ts` (thuần, no DOM/API) và canvas processors. Dựng UI control panel (side panel / popup) tái dùng layout React batch hiện có. Chưa nối automation thật.

## Requirements

- Functional: load extension vào Chrome (dev mode), mở control panel, nhập/upload prompt, thấy danh sách scene parse đúng (parser cũ chạy y nguyên).
- Non-functional: MV3 compliant, build reproducible, không bundle `@google/genai`.

## Architecture

- **Build:** Vite 6 + `@crxjs/vite-plugin` (HMR cho MV3). TS + React 19 + Tailwind v4 (giữ stack cũ).
- **Cấu trúc extension:**
  - `manifest.json` (MV3): `host_permissions: ["https://aistudio.google.com/*"]`, `content_scripts` inject vào playground, `side_panel` cho UI control, `background` service worker điều phối.
  - `src/content/` — content script chạy trong tab AI Studio (Phase 3).
  - `src/panel/` — UI React control panel (port từ `App.tsx` UI, BỎ phần gọi `/api/generate-image`).
  - `src/background/` — service worker: message bus giữa panel ↔ content script, quản lý queue state.
  - `src/shared/` — port `parser.ts`, `types.ts` (sửa `ImageSize` "512px"→"512" theo audit H1; bỏ `GeminiModel` API-specific, đổi thành model UI label).
  - `src/processing/` — port `imageProcessor.ts`, `imageCompressor.ts` (Phase 5 thay phần ESRGAN giả).
- Reuse component `ImageStudio.tsx` cho edit/upscale từng ảnh (Phase 5 nối WASM).

## Related Code Files

- Create: `manifest.json`, `vite.config.ts`, `src/panel/*`, `src/background/service-worker.ts`, `src/shared/parser.ts` (port), `src/shared/types.ts` (port+sửa), `src/processing/*` (port).
- Reuse (copy/adapt): `ai-batch-image-generator-and-editor/src/utils/parser.ts`, `types.ts`, `utils/imageProcessor.ts`, `utils/imageCompressor.ts`, `components/ImageStudio.tsx`, UI từ `App.tsx`.
- Delete/bỏ: `server.ts`, mọi import `@google/genai`, `dotenv`, `GEMINI_API_KEY`.

## Implementation Steps

1. Tạo project extension mới (thư mục riêng, vd `ai-studio-batch-extension/`); init Vite + CRXJS + React + Tailwind v4.
2. Viết `manifest.json` MV3 với host_permissions AI Studio, side_panel, background, content_scripts.
3. Port `parser.ts` + `types.ts` vào `src/shared/`; sửa `ImageSize` "512px"→"512"; thay `GeminiModel` API enum bằng UI model label ("Nano Banana Pro"|"Nano Banana 2").
4. Port `imageProcessor.ts`/`imageCompressor.ts` vào `src/processing/` (giữ Lanczos/canvas adjustments; đánh dấu ESRGAN-giả để Phase 5 thay).
5. Dựng UI panel: ô text + upload `.txt`/`.md`, settings (model/aspect/size/delay), danh sách scene preview, nút Start/Pause/Resume/Stop (chưa nối logic thật).
6. Wire message bus panel ↔ background (skeleton); load extension, verify parse + UI render.

## Success Criteria

- [ ] Extension load không lỗi trong `chrome://extensions` (dev mode).
- [ ] Nhập text + upload `.txt`/`.md` → parser tách scene đúng như app cũ (so sánh output).
- [ ] Settings UI đầy đủ: model, aspect, size (2K/4K/Full HD), delay.
- [ ] Build sạch (`tsc --noEmit` + `vite build`), 0 reference `@google/genai`.
- [ ] Side panel mở được khi đang ở tab aistudio.google.com.

## Risk Assessment

- **Tailwind v4 trong MV3 content/panel:** mitigation — build CSS qua Vite, inject vào shadow DOM nếu cần tránh xung đột style với trang AI Studio.
- **CRXJS tương thích Vite 6:** mitigation — pin version đã verified; nếu vỡ, fallback `vite build` + manifest thủ công.
