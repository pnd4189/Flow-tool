# Mega-prompt — Google Flow Tools (Unified Pipeline: Script → Images → Videos)

> **Nền tảng:** Google Flow → **Tools → Create Tool**. Dùng Flow credits = quota Ultra, no API key. Dán khối ``` → Generate → Remix tinh chỉnh.
> **Quyết định kỹ thuật (đã chọn phương án tối ưu):** Lanczos upscale chạy NGAY sau mỗi ảnh thành công (không để tới lúc zip); lưu ảnh native gốc để re-derive khi đổi target; bắt model xuất native cao nhất trước rồi mới Lanczos về đúng pixel.
> **Giá credit video tham chiếu (Ultra, 2026-06-24):** Lite [Lower Priority] ≈0 (chậm) · Lite 5 · Fast 10 · Quality 100 · Omni Flash 15/20/25/30 (4/6/8/10s) · 4K upscale 50. Bắt tool đọc credit LIVE từ banner Flow.

---

```
Create a Tool called "Story Pipeline Studio: Script -> Images -> Videos".

PURPOSE: One seamless pipeline that turns a written script / prompt list into a consistent set of images, then animates those images into videos — keeping the same characters, art style, and story continuity throughout. Output both images and videos, each downloadable as a ZIP with a visible compression progress bar.

=== NON-NEGOTIABLE CONSISTENCY RULES (apply across the WHOLE pipeline) ===
- Treat the input as ONE continuous script/storyboard: scenes are sequential and share the same characters, world, setting, color grade, and ART STYLE.
- Character consistency: keep each named character visually identical across every scene (face, hair, outfit, proportions, colors). Let me define one or more character reference images (generate once in the tool or upload), and use them as references for every scene image and every video.
- STYLE LOCK (critical): each video MUST match the exact art style of its source image. If the image is 2D anime, the video must stay 2D anime. NEVER convert to photorealistic, live-action, or real humans. Inject into EVERY video generation: "Preserve the exact art style, linework, shading and palette of the input image; animated/2D stays animated/2D; absolutely do NOT photorealize and do NOT render real humans." Always use the source image as the first frame so the video inherits its style.

=== STAGE 1 — TEXT TO IMAGE (batch) ===
- Input: paste prompts in a text box, OR upload a .txt/.md file. Auto-detect how prompts are separated, in priority order: scene markers ("--- SCENE 001 ---", "SCENE 1:", "[CANH 2]", "PHAN CANH 3", "PROMPT 4"); Markdown headings (# to ######); horizontal dividers (---, ===, ***, ___); numbered lists (1. or 1)); bullet lists (-, *, •); otherwise split on blank lines. Show the detected separator, the scene count, and an editable preview list (title, prompt, optional negative prompt, optional aspect ratio).
- Support structured "key: value" blocks (Subject, Action/Energy, Setting, Style, Lighting/Color, Atmosphere, Composition, Camera, Negative): merge into one strong prompt; treat "Negative:"/"Avoid:" as the negative prompt. Apply the global art style + character references to every scene.
- Image model selector: "Nano Banana Pro" and "Nano Banana". Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4.
- EXACT download resolution (fix the current low ~1376x768 output): Full HD = 1920x1080, 2K = 2560x1440, 4K = 3840x2160. For each image: first generate at the model's HIGHEST available native resolution, then resample to the EXACT chosen target using a high-quality LANCZOS algorithm so the saved file is exactly those pixel dimensions. Preserve the source aspect ratio (fit within the target; pad rather than stretch when the ratio differs). Keep the original native image stored so that changing the target later re-derives from the original (never upscale an already-upscaled image).
- Run the Lanczos upscale RIGHT AFTER each image is generated successfully (per image, during the batch) so previews and single-image downloads are already at the correct resolution and there is no large freeze at zip time.
- Gallery: thumbnail grid, each labelled with scene title + final resolution. Per image: regenerate, delete.
- "Download images (ZIP)" button, enabled as soon as Stage 1 finishes (do NOT wait for videos). Show a visible percent progress bar for the zip compression that updates until the archive is ready, then auto-download.

=== STAGE 2 — IMAGE TO VIDEO (batch, optional) ===
- Select which Stage-1 images to animate (all or a subset). Do NOT re-upload — use the generated images directly as the first frame.
- Per scene, build the motion from the scene's own script text (animate the action/camera the scene describes) PLUS the global STYLE LOCK rule above.
- Video model selector with live Flow credit cost shown next to each: "Veo 3.1 Lite [Lower Priority]" (slow, lowest/zero credits), "Veo 3.1 Lite", "Veo 3.1 Fast", "Veo 3.1 Quality", "Gemini Omni Flash". Reference Ultra costs as of 2026-06-24: Lite [Lower Priority] ~0, Lite 5, Fast 10, Quality 100; Omni Flash 15/20/25/30 for 4/6/8/10s. Read the real cost from Flow's banner; do not trust hardcoded numbers.
- Duration: 4s/6s/8s (Veo 3.1, max 8s, Extend available) or up to 10s (Omni Flash). Aspect ratio 16:9/9:16/1:1; audio on/off. Optional 4K upscale (50 credits, Ultra) shown as a surcharge.
- Per video: regenerate; if a video fails, let me Retry (skipping the videos that already succeeded), Skip it, or Download whatever already succeeded — failures must never block downloading the good outputs.

=== BUDGET OPTIMIZER (video stage) ===
- Let me enter a total credit budget for the session and (if accessible) show my remaining monthly Flow credits.
- Before running, show an estimate table across ALL video models: how many videos the budget affords and the total cost for my chosen count (include 4K surcharge).
- Optimization goal selector: "Maximize number of videos", "Maximize quality", or "Balanced" — recommend model + duration + count within budget.
- AFTER the optimizer recommends a default, let me still OVERRIDE the model PER SCENE (a model dropdown on each scene), and recompute the running budget live as I change them.
- Enforce the budget as a hard cap: warn at 80% and 100%, pause before any generation that would exceed it. Show live credits spent / remaining.

=== OUTPUT & DOWNLOAD ===
- Combined gallery pairing each image with its video (thumbnail + playback + duration + credit cost).
- "Download all (images + videos) (ZIP)" after the video stage — show a visible percent progress bar for the zip compression that updates until ready, then auto-download.
- Single-item download (image or video) at any time.

=== BATCH CONTROLS (shared by both stages) ===
- Sequential processing, one job at a time, honoring a user-set delay (seconds) between generations.
- Start, Pause, Resume, Stop. "Retry failed" re-runs only failed jobs and skips successful ones, for both stages.
- Live progress: done/total, success, failed, current item, credits used / remaining.

UX: clean, responsive; always show credit costs and resolutions; clear empty/loading/error states; confirm before any run that would exceed a credit threshold I set.

Build as much of this as the platform supports. Where a capability is not available (bulk upload, custom Lanczos resampling to exact pixels, zip progress bar, per-scene model override, live credit readout, image->video state handoff in one tool), build the closest equivalent and tell me EXACTLY what was substituted or skipped.
```

---

## Đánh giá rủi ro thành thật (đọc trước khi kỳ vọng)
Flow Tools là trình tạo tool điều phối AI của Flow + UI; **một số yêu cầu cần CHẠY CODE TÙY BIẾN trong tool**, chưa chắc Flow hỗ trợ:

| Tính năng | Rủi ro Flow dựng nổi | Nếu không được |
|---|---|---|
| Style-lock + character consistency | ✅ thấp (Veo lấy ảnh làm frame đầu → kế thừa style; có Ingredients/reference) | prompt-injection vẫn giữ được phần lớn |
| Pipeline ảnh→video 1 tool, state handoff | ⚠️ trung | fallback 2 tool xích |
| **Lanczos upscale về ĐÚNG pixel (1920×1080/2560×1440/3840×2160)** | 🔴 **CAO** (cần JS xử lý pixel tùy biến) | bắt model xuất native 2K/4K; nếu không, dùng plan extension cho Lanczos thật |
| **Zip + progress bar %** | 🔴 CAO (cần code nén client) | tải lẻ / multi-select; hoặc extension |
| Bulk upload + batch 200 | ⚠️ trung | chia nhiều đợt vào 1 queue |
| Per-scene model override sau optimizer | ✅ thấp–trung | chỉnh global rồi chạy lại nhóm |

**Điểm mấu chốt:** 2 thứ đỏ (Lanczos đúng-pixel + zip progress bar) là phần Flow Tools **dễ làm KHÔNG được nhất** vì là code xử lý ảnh/nén tùy biến, không phải "điều phối model AI". Nếu Flow từ chối → đây chính là lý do plan **extension `260624-1052`** tồn tại (Lanczos/ImageMagick/ZIP thật chạy client). Khi đó: dùng Flow cho sinh ảnh/video (quota Ultra), dùng extension/tool local cho upscale + nén.

## Lưu ý chất lượng upscale
- Lanczos **không tạo thêm chi tiết** — kéo 1376×768 → 4K sẽ mềm. Vì vậy prompt bắt **xuất native cao nhất trước** (2K/4K nếu Nano Banana Pro cho), rồi mới resample. Muốn nét hơn nữa khi phóng to mạnh → cần AI super-resolution (Real-ESRGAN), nặng hơn, thuộc phạm vi extension.

## Unresolved (verify khi chạy thật trên Flow)
1. Flow Tool có chạy được Lanczos resampling tùy biến về đúng pixel không, hay chỉ resize cơ bản của Flow?
2. Nano Banana trong Flow xuất native tối đa bao nhiêu (có đạt 2K/4K trước upscale không)?
3. Zip + progress bar % có khả thi trong Flow Tool không?
4. Giữ state ảnh→video + bulk 200 ảnh trong 1 tool tới đâu?
5. Veo 3.1 Lite [Lower Priority] credit thật = 0 hay 5 (xác nhận trên nút generate).
6. Credit/ảnh của Nano Banana trong Flow (để tính budget gộp ảnh + video).
