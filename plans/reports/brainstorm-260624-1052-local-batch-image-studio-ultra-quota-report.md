# Brainstorm — Local Batch Image Studio (Ultra quota, no-API)

**Ngày:** 2026-06-24 · **Scope:** `ai-batch-image-generator-and-editor/` → pivot kiến trúc
**Nguồn:** report audit `aistudio-stability-audit-260624-0941` + web research (Ultra limits, AI Studio subscription, Flow).

---

## Problem statement

App hiện tại (React 19 + Express + `@google/genai`) **gọi Gemini Developer API bằng `GEMINI_API_KEY`** — đúng cái user cấm tuyệt đối ("không gọi API, phải dùng quota tài khoản Ultra"). Đồng thời user muốn deploy lên AI Studio để chạy ổn định.

**Hai yêu cầu loại trừ lẫn nhau.** Brainstorm xác định đường khả thi duy nhất.

## Research findings (verified)

- **Ultra = 1000 ảnh/ngày** (Nano Banana Pro), hết thì fallback Nano Banana 2 Flash tới reset 24h. Pro ~100, Free 20. **Quota này chỉ áp UI tương tác (Gemini app + playground AI Studio), KHÔNG áp app deploy.**
- **Link subscription vào AI Studio (20/04/2026):** chỉ tăng limit khi prototyping trong Studio + **$100/tháng API credit** (Ultra) cho app deploy. **App deploy VẪN chạy bằng API key**, không rút từ quota 1000/ngày.
- **Flow (labs.google/flow):** xài session quota không API key **vì là app FIRST-PARTY của Google** — frontend gọi endpoint nội bộ, auth bằng session cookie, trừ subscription credit. **Không thể tái lập trong app third-party deploy.**
- **Real-ESRGAN / Pillow / ImageMagick:** binary/Python native, **không chạy trong sandbox app deploy AI Studio**. Code hiện tại chỉ mô phỏng JS (giả).

**Kết luận:** cả 2 trụ cột (quota Ultra không-API + upscale binary thật) **chỉ đạt được khi app chạy LOCAL**. "Deploy AI Studio" là yêu cầu mâu thuẫn, phải bỏ.

---

## ⭐ UPDATE 2026-06-24 12:08 — Flow Tools là HƯỚNG CHÍNH (research bổ sung)

Research lại thời-gian-thực phát hiện thông tin SAU cutoff làm đảo hướng:

- **Google Flow Tools (ra mắt I/O 2026, ~tháng 5/2026):** Flow giờ cho **tạo mini-app/Tool bằng ngôn ngữ tự nhiên, chạy trực tiếp trong Flow**. Mô tả → Flow tự viết code + dựng UI. Media generation dùng **Flow credits = quota subscription (Ultra $200 = 25.000 credits/tháng), KHÔNG API key**. Tạo tool chỉ cho tài khoản trả phí; có quota số tool tạo/ngày; web & PC only.
- **AI Studio Playground (verify lại):** interactive = **no-API + quota Ultra ✅** nhưng **KHÔNG batch-from-file native** (mỗi lần 1 prompt; batch phải qua API key hoặc automation extension). Build/deploy/"Get code" = API key.

**Hệ quả — xếp hạng lại phương án:**

| Phương án | no-API + quota Ultra | Batch theo file | Chạy đâu | Verdict |
|---|---|---|---|---|
| **D. Flow Tools** (MỚI, CHÍNH) | ✅ Flow credits 25k/tháng | ✅ tự dựng tool (cần verify) | Trên Flow, không dev local | 🥇 **Thử trước** |
| B. Extension automating Playground | ✅ session quota | ✅ (tự code) | Local, mong manh | 🥈 Dự phòng nếu Flow thiếu |
| A. AI Studio Build deploy | ❌ API key | ✅ | AI Studio | 🥉 Chỉ khi 2 trên fail |

**Mega-prompts đã viết:** `flow-tools-mega-prompt.md` (hướng chính), `ai-studio-build-mega-prompt.md` (dự phòng API key) trong `plans/260624-1052-local-batch-image-studio-extension/`.

**Plan extension `260624-1052` → hạ xuống DỰ PHÒNG**, chỉ thực thi nếu Flow Tools không đủ tính năng (batch lớn / upload file / ZIP / Real-ESRGAN).

---

## Approaches đã cân nhắc (bản gốc — đọc cùng UPDATE ở trên)

| | A. Deploy AI Studio + API key | B. Local browser-automation | C. Hybrid |
|---|---|---|---|
| Quota Ultra không-API | ❌ (phải dùng API key) | ✅ session quota Ultra | ⚠️ chỉ khi local |
| Deploy AI Studio | ✅ | ❌ | ⚠️ |
| Real-ESRGAN/Pillow/ImageMagick thật | ❌ sandbox | ✅ child process local | ✅ |
| Độ ổn định | cao (API) | trung (selector mong manh) | thấp (maintain 2 đường) |
| Phù hợp ràng buộc user | vi phạm "no-API" | thỏa cả 3 trụ cột | phức tạp nhất |

> **Lưu ý:** lúc brainstorm gốc chưa biết Flow Tools tồn tại nên chọn B. Sau UPDATE 12:08, **Flow Tools (D) thay B làm hướng chính**; B thành dự phòng.

## Recommended solution (gốc) — B: Chrome Extension automating AI Studio playground

**Form factor chốt: Chrome Extension** (không phải web+driver). Bằng chứng feasibility: **BatchBeam** (Chrome Web Store) đã làm chính xác spec này — extension chạy trong tab AI Studio đã login, queue/retry/save, dùng session quota Ultra, no API key.

- **Engine tạo ảnh:** content script automating DOM **bên trong tab aistudio.google.com playground** (Nano Banana Pro): điền prompt, chọn aspect/size, submit, harvest ảnh. Dùng session quota Ultra (~500–1000/ngày, Ultra 4× limit, ~15 req/phút), **KHÔNG API key**.
- **Reuse từ code cũ (~50%):** `parser.ts` (tách scene), logic queue pause/resume/stop/retry-failed, nén ZIP, ImageStudio UI (icon retry/xóa từng ảnh), input text + upload .txt/.md → port vào extension panel/popup.
- **Upscale: WASM in-browser (zero-install)** — Real-ESRGAN (ONNX/WASM) + ImageMagick (WASM) + Lanczos JS. **Không có Pillow** (Python không chạy trong extension); chấp nhận đánh đổi để zero-install.
- **Bỏ hẳn:** `@google/genai`, `GEMINI_API_KEY`, Express `server.ts`, convention deploy AI Studio Build.

### Form factor đã loại
- ~~Web localhost + Chrome DevTools driver~~: thêm 1 lớp driver mong manh hơn extension; extension chạy native trong tab ổn định hơn.
- ~~Companion native-messaging host chạy binary thật~~: mạnh hơn nhưng phải cài thêm; user chọn WASM zero-install.

## Quyết định chốt với user

- Hướng: **B — Chrome Extension automating AI Studio playground**, bỏ deploy AI Studio + bỏ API key.
- Bả mặt: **Playground aistudio.google.com**, session quota Ultra no-API (verify thực tế; fallback Gemini app nếu quota không áp ở playground).
- Upscale: **WASM in-browser** (Real-ESRGAN ONNX/WASM + ImageMagick WASM + Lanczos JS), zero-install, không Pillow.
- Quy mô batch: **50–200 ảnh/lần** → Blob/objectURL + revoke, pacing delay (~15 req/phút), theo dõi tiến độ bền.

## Risks

- Selector UI Google đổi → gãy automation (cần layer selector tách biệt, dễ update).
- Chậm: mỗi ảnh vài chục giây + delay pacing; batch 200 có thể chạy lâu.
- Pacing để tránh rate-limit/flag tài khoản.
- Automation UI Google = vùng xám ToS (rủi ro thấp cá nhân, có thật).
- Cần Chrome thật mở + đăng nhập Ultra sẵn (không headless ẩn).

## Acceptance criteria (cho plan)

1. Nhập prompt qua textarea HOẶC upload .txt/.md; parser tự tách scene chuẩn.
2. Chọn model (Nano Banana Pro/2), aspect ratio, size (2K/4K/Full HD 1920×1080 JPEG), delay giữa prompt.
3. Tạo ảnh hàng loạt qua quota Ultra (KHÔNG API key), có pause/resume/stop.
4. Retry-failed tự bỏ qua ảnh đã thành công; icon retry/xóa từng ảnh.
5. Tải toàn bộ ảnh thành 1 ZIP.
6. Upscale/resize bằng Real-ESRGAN/Lanczos/Pillow/ImageMagick thật (local).
7. Batch 50–200 không OOM tab.

## Unresolved questions (giải ở plan phase)

1. Quota 1000/ngày có áp ở **playground aistudio.google.com** không, hay chỉ app Gemini? → probe thực tế.
2. Harvest ảnh full-res ở playground: download path + max size (2K/4K) như nào?
3. Form factor cuối: web localhost + Chrome riêng, hay Electron đóng gói?
4. Cơ chế chống flag tài khoản khi automation tốc độ cao (pacing tối thiểu).
