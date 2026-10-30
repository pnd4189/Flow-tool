---
phase: 5
title: "WASM Upscale & Export"
status: pending
effort: ""
priority: P2
dependencies: [2]
---

# Phase 5: WASM Upscale & Export

## Overview

Thay phần "Real-ESRGAN giả" (audit C2/H5) bằng upscale WASM thật in-browser: Real-ESRGAN (ONNX Runtime Web/WASM), ImageMagick WASM cho resize/convert, Lanczos JS giữ lại. Sửa các bug edit hiện có (H5 sharpen/blur/denoise, H6 undo/redo, M1 Full HD stretch méo). Export ZIP toàn bộ ảnh.

## Requirements

- Functional: upscale 1 ảnh 1K→2K/4K bằng Real-ESRGAN WASM; resize/convert qua ImageMagick WASM; Full HD = 1920×1080 JPEG GIỮ tỉ lệ (không stretch); export all → 1 ZIP.
- Non-functional: chạy trong Web Worker để không freeze UI (audit C2); 4K không treo tab quá lâu.

## Architecture

- **`src/processing/upscale-worker.ts`** — Web Worker: nhận ImageBitmap/Blob, chạy Real-ESRGAN ONNX (onnxruntime-web WASM backend) hoặc Lanczos tùy chọn; transfer buffer về (audit C2 fix).
- **ImageMagick WASM** (`@imagemagick/magick-wasm`) cho resize/format/JPEG nén; thay `imageCompressor.ts` stretch (M1) → tính w/h từ natural ratio capped 1920×1080.
- Giữ Lanczos JS từ `imageProcessor.ts` làm option nhẹ; cap GPU drawImage cho ảnh rất lớn.
- **Sửa edit bugs (validate: IMPLEMENT ĐẦY ĐỦ):** implement thật sharpen/blur/denoise bằng convolution (H5); undo/redo nối nút + history thật (H6); history lưu Blob+objectURL không PNG dataURL (H7). <!-- Updated: Validation Session 1 - implement fully, not delete -->
- **Export ZIP:** dùng thư viện zip client (vd `fflate`) gom Blob từ IndexedDB → 1 file tải về.

## Related Code Files

- Create: `src/processing/upscale-worker.ts`, `src/processing/imagemagick.ts`, `src/processing/zip-export.ts`.
- Modify: `src/processing/imageProcessor.ts` (bỏ ESRGAN giả, gọi worker), `src/processing/imageCompressor.ts` (M1 fix ratio), `src/components/ImageStudio.tsx` (H5/H6/H7 + nối WASM, sửa setTimeout hack M10/M11).
- Reference: audit findings C2, H5, H6, H7, M1, M10, M11 trong `plans/reports/aistudio-stability-audit-260624-0941-ai-batch-image-generator-report.md`.

## Implementation Steps

1. Thêm `onnxruntime-web` + chọn model Real-ESRGAN ONNX (x2/x4) phù hợp WASM; host model trong extension assets.
2. Viết `upscale-worker.ts`: Lanczos + Real-ESRGAN(ONNX) trong Worker; transfer buffer (fix freeze C2).
3. Tích hợp `@imagemagick/magick-wasm`: resize/convert/JPEG; benchmark 2K/4K time+memory.
4. Sửa `imageCompressor.ts`: Full HD 1920×1080 JPEG tính theo natural ratio (fit, không stretch — M1).
5. ImageStudio: nối upscale worker; IMPLEMENT THẬT sharpen/blur/denoise (convolution, H5) + undo/redo history (H6); history dùng Blob (H7); bỏ setTimeout hack.
6. Viết `zip-export.ts` (fflate): gom Blob từ IndexedDB → ZIP; nút "Download all".
7. Test: upscale 1K→4K không freeze; Full HD đúng tỉ lệ; ZIP mở được đủ ảnh.

## Success Criteria

- [ ] Real-ESRGAN WASM upscale thật chạy trong Worker, UI không freeze ở 4K.
- [ ] ImageMagick WASM resize/convert hoạt động; Lanczos vẫn là option.
- [ ] Full HD 1920×1080 JPEG GIỮ tỉ lệ gốc (không méo ảnh non-16:9).
- [ ] sharpen/blur/denoise + undo/redo: IMPLEMENT THẬT, đổi control thấy hiệu ứng, undo/redo hoạt động (không còn control chết).
- [ ] "Download all" tạo 1 ZIP chứa toàn bộ ảnh.

## Risk Assessment

- **Real-ESRGAN ONNX nặng/chậm ở 4K trong browser:** mitigation — benchmark sớm (step 3); fallback Lanczos/ImageMagick nếu quá chậm; cho user chọn chất lượng vs tốc độ.
- **Model ONNX size lớn vượt giới hạn extension:** mitigation — lazy-load model on demand; hoặc tải model lần đầu cache IndexedDB.
- **Pillow không có (WASM zero-install):** đã chấp nhận đánh đổi ở brainstorm; ImageMagick WASM phủ phần lớn nhu cầu Pillow.
