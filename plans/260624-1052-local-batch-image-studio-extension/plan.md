---
title: "Local Batch Image Studio — Chrome Extension automating AI Studio (Ultra quota, no API)"
description: ""
status: pending
priority: P2
branch: "main"
tags: []
blockedBy: []
blocks: []
created: "2026-06-24T04:09:29.279Z"
createdBy: "ck:plan"
source: skill
---

# Local Batch Image Studio — Chrome Extension automating AI Studio (Ultra quota, no API)

## Overview

> ⚠️ **STATUS UPDATE 2026-06-24 12:08 — Plan này GIỜ LÀ DỰ PHÒNG.**
> Research bổ sung phát hiện **Google Flow Tools** (I/O 2026) cho tạo mini-app batch chạy trực tiếp trên Flow, dùng **quota subscription Ultra (25.000 credits/tháng), no API key, không cần dev local** — thỏa yêu cầu tốt hơn extension. **Hướng chính giờ là Flow Tools** (xem `flow-tools-mega-prompt.md`). Plan extension này **chỉ thực thi nếu Flow Tools không đủ** (batch lớn / upload file .txt-.md / ZIP / Real-ESRGAN). Xác minh năng lực Flow Tools TRƯỚC khi cook plan này.
> Tham chiếu: brainstorm report mục "UPDATE 2026-06-24 12:08", và `ai-studio-build-mega-prompt.md` (dự phòng cuối — dùng API key).
>
> **Đối chiếu nhanh:** AI Studio Playground = no-API + quota Ultra NHƯNG không batch-from-file native (mỗi lần 1 prompt) → đó là lý do cần extension automation HOẶC Flow Tools.

Chrome Extension (MV3) tạo ảnh hàng loạt từ file/text prompt bằng cách **automating UI playground aistudio.google.com** trong tab đã đăng nhập tài khoản Ultra → dùng **session quota Ultra (~500-1000 ảnh/ngày, no API key)**. Reuse `parser.ts`/`types.ts`/canvas processors từ `ai-batch-image-generator-and-editor/`. Upscale bằng **WASM in-browser** (Real-ESRGAN ONNX/WASM + ImageMagick WASM + Lanczos JS), zero-install. Batch 50-200 ảnh, pause/resume/stop/retry-failed, export ZIP.

**Bối cảnh quyết định:** brainstorm chứng minh "deploy AI Studio + dùng quota Ultra không-API" loại trừ lẫn nhau; app deploy bị ép dùng API key. Bằng chứng feasibility: extension **BatchBeam** (Chrome Web Store) đã làm đúng pattern này. Nguồn: `plans/reports/brainstorm-260624-1052-local-batch-image-studio-ultra-quota-report.md`.

**Ràng buộc tuyệt đối:** KHÔNG gọi Gemini API / không dùng `@google/genai` / không API key. Mọi ảnh phải sinh qua UI playground trong session Ultra.

**Acceptance (toàn plan):**
1. Nhập prompt qua textarea HOẶC upload `.txt`/`.md`; parser tự nhận diện delimiter, tách scene chuẩn.
2. Chọn model (Nano Banana Pro / Nano Banana 2), aspect ratio, size (2K/4K/Full HD 1920×1080 JPEG), delay giữa prompt.
3. Tạo ảnh batch qua quota Ultra (no API key) với pause/resume/stop.
4. Retry-failed tự bỏ qua ảnh đã thành công; icon retry/xóa từng ảnh.
5. Tải toàn bộ ảnh thành 1 ZIP.
6. Upscale/resize Real-ESRGAN(WASM)/Lanczos/ImageMagick(WASM) thật.
7. Batch 50-200 ảnh không OOM tab (Blob/objectURL + revoke).

**GATE:** Phase 1 là cổng feasibility. Nếu automation playground hoặc quota no-API không khả thi → DỪNG, báo lại user trước khi build tiếp.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Probe & Feasibility Gate](./phase-01-probe-feasibility-gate.md) | Pending |
| 2 | [Extension Scaffold & Reuse Port](./phase-02-extension-scaffold-reuse-port.md) | Pending |
| 3 | [AI Studio Automation Engine](./phase-03-ai-studio-automation-engine.md) | Pending |
| 4 | [Batch Orchestrator](./phase-04-batch-orchestrator.md) | Pending |
| 5 | [WASM Upscale & Export](./phase-05-wasm-upscale-export.md) | Pending |
| 6 | [Hardening & QA](./phase-06-hardening-qa.md) | Pending |

## Dependencies

- Không có plan nào khác đang chạy (scan `plans/` chỉ thấy plan này + report brainstorm).
- Phase 1 GATE block toàn bộ phase 2-6. Phase 3 phụ thuộc Phase 1 (selector map) + Phase 2 (scaffold). Phase 4 phụ thuộc 3. Phase 5 độc lập tương đối (chỉ cần ảnh đầu ra). Phase 6 sau cùng.
- Codebase nguồn reuse: `ai-batch-image-generator-and-editor/src/utils/parser.ts`, `types.ts`, `utils/imageProcessor.ts`, `utils/imageCompressor.ts`, `components/ImageStudio.tsx`, `App.tsx` (queue logic).

## Open Questions

1. Quota 1000/ngày có áp ở playground `aistudio.google.com` không, hay chỉ app Gemini? → Phase 1 probe thực tế.
2. Harvest ảnh full-res ở playground: download path + max size (2K/4K) ra sao? → Phase 1.
3. Real-ESRGAN WASM/ONNX model nào dùng được client-side ở 4K mà không quá nặng (memory/time)? → Phase 5 benchmark.
4. Cơ chế pacing tối thiểu chống flag tài khoản khi automation (rate ~15 req/phút đã biết). → Phase 4.

## Validation Log

### Session 1 — 2026-06-24

**Verification (Full tier, 6 phases):**
- File reuse claims VERIFIED tồn tại: `parser.ts` (385d), `types.ts` (48d), `imageProcessor.ts` (385d), `imageCompressor.ts` (37d), `ImageStudio.tsx` (711d), `App.tsx` (844d) trong `ai-batch-image-generator-and-editor/src/`.
- Audit report VERIFIED: `plans/reports/aistudio-stability-audit-260624-0941-ai-batch-image-generator-report.md`.
- UNVERIFIED (cố hữu — là lý do Phase 1 là GATE): quota playground no-API, automation khả thi, lib WASM (CRXJS/Vite6, onnxruntime-web, @imagemagick/magick-wasm, fflate). Không verify tĩnh được; Phase 1 + benchmark Phase 5 sẽ kiểm.
- Failed: 0.

**Decisions confirmed:**
1. **Phase 1 NO-GO → DỪNG HẲN, báo user quyết** (không auto-fallback Gemini surface / API key). → propagated Phase 1.
2. **Upscale:** user chọn chất lượng (Real-ESRGAN) vs tốc độ (Lanczos/ImageMagick) từng ảnh. → đã có Phase 5.
3. **H5/H6:** IMPLEMENT ĐẦY ĐỦ sharpen/blur/denoise (convolution) + undo/redo history (không xóa). → propagated Phase 5.
4. **Model scope:** chỉ Nano Banana Pro + Nano Banana 2; bỏ Imagen (deprecated M9). → đã có Phase 2/3.

### Whole-Plan Consistency Sweep
- Đã re-read plan.md + 6 phase. Không còn mâu thuẫn: "implement HOẶC xóa" (H5/H6) đã chốt thành implement; "fallback Gemini" ở Phase 1 đã đổi thành stop&report; model scope nhất quán 2 model across Phase 2/3. Không có draft/contract trùng lặp.
- Unresolved contradictions: 0.
