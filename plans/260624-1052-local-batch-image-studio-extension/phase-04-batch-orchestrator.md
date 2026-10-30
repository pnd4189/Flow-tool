---
phase: 4
title: "Batch Orchestrator"
status: pending
effort: ""
priority: P1
dependencies: [3]
---

# Phase 4: Batch Orchestrator

## Overview

Queue điều phối batch 50-200 prompt: tuần tự gọi `generateOne` với delay/pacing, hỗ trợ pause/resume/stop, retry-failed (bỏ qua ảnh đã success), xử lý rate-limit/quota, lưu Blob bền. Port logic queue từ `App.tsx` cũ nhưng thay backend bằng content-script driver.

## Requirements

- Functional: chạy danh sách `PromptItem[]`, mỗi item → success/failed; pause/resume/stop tức thời; retry chỉ item failed; tiến độ hiển thị realtime.
- Non-functional: không OOM ở 200 ảnh; pacing tôn trọng ~15 req/phút; resume sống qua reload panel.

## Architecture

- **State machine** trong background service worker (sống lâu hơn panel): `idle → running → paused → stopped/done`. Panel chỉ là view, gửi command + nhận progress qua message bus.
- **Lưu ảnh:** mỗi success → Blob lưu vào IndexedDB (key theo prompt id) + tạo objectURL cho preview; revoke khi xóa (audit M2/H7). IndexedDB cho phép resume qua reload + batch lớn không giữ hết trong RAM.
- **Pacing:** delay người dùng chọn + min-interval guard (đảm bảo ≤ rate limit). Khi gặp `failed:rate-limit` → exponential backoff, không tính là fail vĩnh viễn.
- **Quota vượt ngày:** nếu phát hiện fallback Flash / quota message → đánh dấu, hỏi user tiếp tục với Flash hay dừng (theo lựa chọn batch "Vừa 50-200").
- **Retry-failed:** lọc `status==="failed"`, chạy lại, giữ nguyên success.
- **Icon từng ảnh:** retry 1 ảnh, xóa 1 ảnh (revoke objectURL + xóa IndexedDB record).

## Related Code Files

- Create: `src/background/queue.ts` (state machine), `src/shared/image-store.ts` (IndexedDB Blob store).
- Modify: `src/panel/*` (nối nút Start/Pause/Resume/Stop/Retry-failed + progress + grid ảnh với icon retry/xóa), `src/background/service-worker.ts`.
- Reference reuse: queue logic trong `ai-batch-image-generator-and-editor/src/App.tsx` (pause/resume/stop/retry pattern).

## Implementation Steps

1. Viết `image-store.ts`: put/get/delete Blob theo prompt id (IndexedDB); helper tạo/revoke objectURL.
2. Viết `queue.ts`: vòng lặp tuần tự gọi driver qua message; honor delay + pacing guard + abort flag (pause/stop).
3. Pause: dừng sau item hiện tại; Stop: abort + giữ kết quả đã có; Resume: tiếp từ item kế.
4. Rate-limit backoff: bắt `failed:rate-limit`, chờ backoff, retry cùng item (không tăng fail count vĩnh viễn).
5. Quota-exceeded: phát hiện → emit event panel hỏi "tiếp với Flash / dừng".
6. Retry-failed: action chạy lại chỉ item failed; per-image retry/delete.
7. Progress: emit `{done, total, success, failed, current}` realtime cho panel.
8. Test: batch 50 + 200 prompt (giả lập driver nếu cần tránh tốn quota), verify không OOM, pause/resume/stop/retry đúng.

## Success Criteria

- [ ] Batch 200 prompt chạy không OOM tab (Blob ở IndexedDB, objectURL revoke đúng).
- [ ] Pause/Resume/Stop hoạt động tức thời, không mất kết quả đã có.
- [ ] Retry-failed chỉ chạy lại item failed, giữ success.
- [ ] Per-image retry + delete hoạt động (revoke + xóa store).
- [ ] Rate-limit → backoff tự động; quota-exceeded → hỏi user.
- [ ] Resume sống qua reload panel (state ở background + IndexedDB).

## Risk Assessment

- **Service worker MV3 bị kill khi idle:** mitigation — persist queue state vào `chrome.storage`/IndexedDB; khôi phục khi worker respawn; dùng alarms/port keep-alive khi đang chạy.
- **Tab AI Studio bị đóng giữa batch:** mitigation — detect tab close, pause batch, báo user mở lại.
- **objectURL leak:** mitigation — revoke tập trung khi xóa/replace ảnh; cap số objectURL sống đồng thời.
