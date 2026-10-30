---
phase: 1
title: "Probe & Feasibility Gate"
status: pending
effort: ""
priority: P1
dependencies: []
---

# Phase 1: Probe & Feasibility Gate

## Overview

Cổng feasibility BẮT BUỘC trước khi viết code build. Verify trên AI Studio THẬT (tài khoản Ultra đã login): (a) playground sinh ảnh dùng quota subscription no-API; (b) DOM automation submit prompt + harvest ảnh khả thi; (c) map selector ổn định. Nếu fail → DỪNG, báo user.

## Requirements

- Functional: chứng minh được 1 vòng end-to-end thủ-công-bằng-script: mở playground → chọn model image → điền prompt → submit → ảnh xuất hiện → lấy được bytes ảnh full-res, KHÔNG gọi API key.
- Non-functional: xác định rate thực tế (req/phút), giới hạn ngày, hành vi khi vượt quota (fallback Flash), độ ổn định selector.

## Architecture

- Dùng `chrome-profile` skill / Chrome DevTools MCP (hoặc `agent-browser`) lái Chrome đã login Ultra.
- Probe thủ công trước bằng DevTools: tìm selector ổn định cho: ô prompt, nút model picker, chọn aspect/size, nút Run, vùng ảnh kết quả, nút download ảnh.
- Ưu tiên harvest ảnh từ DOM `<img>`/blob URL hoặc nút download của playground; ghi lại đường lấy full-res (2K/4K).

## Related Code Files

- Create: `plans/260624-1052-local-batch-image-studio-extension/reports/phase-01-probe-findings.md` (selector map + screenshots + kết luận GO/NO-GO).
- Không sửa code sản phẩm ở phase này.

## Implementation Steps

1. Mở `aistudio.google.com` trong Chrome profile Ultra; xác nhận model image (Nano Banana Pro) chọn được trong playground và sinh ảnh KHÔNG yêu cầu API key.
2. Generate 1 ảnh thủ công; mở DevTools, ghi lại: DOM path ô prompt, model selector, aspect/size control, nút Run, container ảnh kết quả, cách lấy bytes (img src / blob / download button).
3. Thử lấy ảnh ở 2K và 4K; ghi max size thực tế playground hỗ trợ + định dạng (PNG/JPEG).
4. Verify quota: sinh vài ảnh liên tiếp, quan sát rate-limit message; tra cứu/ghi lại ngưỡng ngày Ultra + hành vi vượt quota (fallback Nano Banana 2 Flash?).
5. Đánh giá độ bền selector: reload trang, kiểm tra selector có ổn định/cần data-attr fallback.
6. Viết `reports/phase-01-probe-findings.md` với selector map + GO/NO-GO + risks. **Nếu NO-GO: DỪNG HẲN, báo user quyết định** (không tự ý đổi sang surface khác như app Gemini hay quay lại API key — đó là quyết định của user). <!-- Updated: Validation Session 1 - NO-GO = stop & report, no auto-fallback -->

> **Quyết định validate:** chỉ nhắm playground `aistudio.google.com`. Nếu playground bất khả (không no-API được hoặc bị chặn automation), KHÔNG tự fallback — dừng và trình bày tình huống + lựa chọn (Gemini surface / API key / hủy) cho user chọn.

## Success Criteria

- [ ] Sinh được ảnh trên playground bằng session Ultra, xác nhận no API key trong network tab (không có call tới `generativelanguage.googleapis.com` với key).
- [ ] Lấy được bytes ảnh full-res (≥2K) qua DOM/download.
- [ ] Selector map đầy đủ cho mọi control cần automation, có ghi chú độ ổn định.
- [ ] Ghi rõ quota ngày + hành vi vượt quota.
- [ ] Kết luận GO/NO-GO rõ ràng trong report.

## Risk Assessment

- **Selector mong manh / obfuscated class:** mitigation — ưu tiên aria-label, role, text content, data-test attr thay class hash.
- **Playground KHÔNG dùng subscription quota (chỉ app Gemini):** mitigation — ghi nhận trong report là NO-GO và DỪNG, trình bày cho user các lựa chọn (probe Gemini surface / chấp nhận API key / hủy). Không tự ý chuyển surface.
- **Cloudflare/bot detection:** mitigation — pacing người-thật, dùng profile thật đã login, không headless.
