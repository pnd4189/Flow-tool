---
phase: 6
title: "Hardening & QA"
status: pending
effort: ""
priority: P2
dependencies: [4, 5]
---

# Phase 6: Hardening & QA

## Overview

Hoàn thiện độ bền: selector health-check, pacing chống flag, xử lý lỗi rõ ràng, persist/resume, và QA end-to-end thật trên AI Studio với batch 50-200. Đóng gói extension để cài.

## Requirements

- Functional: chạy trọn batch 50-200 ảnh thật trên tài khoản Ultra, pause/resume/stop/retry, export ZIP, upscale — không lỗi chặn.
- Non-functional: thông báo lỗi dễ hiểu; không bị Google flag trong test bình thường; extension cài được qua "Load unpacked".

## Architecture

- **Selector health-check** khi panel mở: verify mọi selector tồn tại; nếu thiếu → banner "AI Studio đã đổi UI, cần cập nhật selector X".
- **Pacing chống flag:** jitter ngẫu nhiên quanh delay, min-interval guard, giới hạn req/phút theo Phase 1.
- **Error surface:** mỗi ảnh failed có lý do (safety/rate-limit/timeout/selector); panel hiển thị + cho retry.
- **Persist:** queue state + ảnh sống qua reload/worker-restart (đã làm Phase 4) — verify kỹ.

## Related Code Files

- Modify: `src/content/selectors.ts` (health-check), `src/background/queue.ts` (jitter/pacing), `src/panel/*` (error UI, health banner).
- Create: `reports/phase-06-qa-e2e-findings.md` (kết quả QA thật), `README.md` (cách cài + dùng + cảnh báo ToS/rủi ro).

## Implementation Steps

1. Thêm selector health-check + banner cảnh báo khi UI đổi.
2. Thêm jitter pacing + min-interval guard chống flag.
3. Chuẩn hóa error surface mọi nhánh failed; verify retry từng loại.
4. QA E2E thật: batch ~50 ảnh (đủ aspect/size 2K/4K/Full HD), đo tỉ lệ thành công, pause/resume/stop, retry-failed, ZIP, upscale.
5. Test cận biên: tab đóng giữa batch, reload panel giữa batch, vượt quota ngày (nếu chạm).
6. Viết README: cài "Load unpacked", yêu cầu login Ultra, cảnh báo rủi ro selector/ToS/pacing.
7. Ghi `reports/phase-06-qa-e2e-findings.md`.

## Success Criteria

- [ ] Batch 50 ảnh thật pass E2E, tỉ lệ thành công ghi nhận, no API key (verify network).
- [ ] Pause/resume/stop/retry-failed/per-image hoạt động trong điều kiện thật.
- [ ] Export ZIP + upscale WASM hoạt động end-to-end.
- [ ] Selector health-check + error messages rõ ràng.
- [ ] README hướng dẫn cài + cảnh báo rủi ro đầy đủ.

## Risk Assessment

- **Google bot detection/flag tài khoản:** mitigation — pacing người-thật, jitter, không chạy tốc độ máy; cảnh báo user trong README; đây là rủi ro tồn dư không loại bỏ hoàn toàn (vùng xám ToS).
- **Selector vỡ sau update Google:** mitigation — health-check + module selector tập trung; chấp nhận cần maintain định kỳ.
- **Quota ngày giới hạn batch lớn:** mitigation — fallback Flash + resume hôm sau (Phase 4).
