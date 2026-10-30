---
phase: 3
title: "AI Studio Automation Engine"
status: pending
effort: ""
priority: P1
dependencies: [1, 2]
---

# Phase 3: AI Studio Automation Engine

## Overview

Content script điều khiển DOM playground AI Studio để sinh 1 ảnh từ 1 prompt: set model/aspect/size, điền prompt, submit, đợi hoàn tất, harvest bytes ảnh full-res. Đây là lõi thay thế `/api/generate-image` cũ — nhưng qua UI, không API.

## Requirements

- Functional: `generateOne(prompt, negativePrompt, settings) → Blob` chạy hoàn toàn trong tab AI Studio, dùng session quota Ultra.
- Non-functional: phát hiện trạng thái xong/đang chạy/lỗi chắc chắn; tách selector ra 1 module dễ update khi Google đổi UI.

## Architecture

- **`src/content/selectors.ts`** — TẤT CẢ selector tập trung 1 chỗ (từ selector map Phase 1). Ưu tiên aria-label/role/text, fallback nhiều lớp.
- **`src/content/driver.ts`** — hàm thao tác: `setModel()`, `setAspectRatio()`, `setSize()`, `typePrompt()`, `clickRun()`, `waitForResult()`, `harvestImage()`.
- **Phát hiện hoàn tất:** MutationObserver trên container kết quả; resolve khi ảnh mới xuất hiện, reject khi thấy error/safety message hoặc timeout (~120s).
- **Harvest:** lấy ảnh full-res theo đường xác định ở Phase 1 (download button → intercept blob, hoặc fetch img src → Blob). Convert sang Blob (không base64 dataURL để tránh OOM — theo audit M2/H7).
- Inject negative prompt theo cách playground hỗ trợ (append "Avoid: ..." nếu không có field riêng).

## Related Code Files

- Create: `src/content/selectors.ts`, `src/content/driver.ts`, `src/content/index.ts` (content script entry + message handler).
- Modify: `src/background/service-worker.ts` (route generate request → content script).
- Reference: `reports/phase-01-probe-findings.md` (selector map).

## Implementation Steps

1. Viết `selectors.ts` từ selector map Phase 1; mỗi selector có fallback chain + hàm `waitFor(selector, timeout)`.
2. Viết `driver.ts`: set model/aspect/size (idempotent — chỉ đổi khi khác giá trị hiện tại để giảm thao tác).
3. `typePrompt()`: clear ô prompt, set value, dispatch input events React nhận diện (native setter + InputEvent).
4. `waitForResult()`: MutationObserver + timeout; phân biệt success / safety-block / rate-limit / generic error.
5. `harvestImage()`: lấy Blob ảnh full-res; verify kích thước khớp size yêu cầu (2K/4K).
6. Map lỗi: safety→`failed:safety`, rate-limit→`failed:rate-limit` (Phase 4 xử lý backoff), timeout→`failed:timeout`.
7. Test thủ công: chạy `generateOne` cho 3-5 prompt khác nhau (aspect/size khác nhau), verify ảnh đúng.

## Success Criteria

- [ ] `generateOne` trả Blob ảnh đúng prompt, đúng aspect/size, qua session quota (no API).
- [ ] Phân biệt đúng 4 trạng thái: success / safety / rate-limit / timeout.
- [ ] Selector tập trung 1 file, có fallback, update được mà không sửa driver.
- [ ] Không tạo base64 dataURL full-res (dùng Blob).

## Risk Assessment

- **React controlled input không nhận `.value=`:** mitigation — dùng native value setter + dispatch `input`/`change` (kỹ thuật React-compatible đã biết).
- **UI đổi giữa chừng:** mitigation — selector module + health-check khi khởi động; báo lỗi rõ "selector X không tìm thấy, cần cập nhật".
- **Harvest nhầm ảnh cũ:** mitigation — đánh dấu/đếm ảnh trước khi submit, chỉ lấy ảnh mới xuất hiện.
