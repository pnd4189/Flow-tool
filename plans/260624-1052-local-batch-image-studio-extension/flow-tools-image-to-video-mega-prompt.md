# Mega-prompt — Google Flow Tools (Batch Image-to-Video Studio, budget-aware)

> **Nền tảng:** Google Flow → **Tools → Create Tool**. Chạy trong Flow, dùng **Flow credits = quota subscription Ultra**, KHÔNG API key.
> **Cách dùng:** Flow → mở/tạo project → panel **Tools** → **Create Tool** → dán khối ``` → Generate. Chưa đạt phần nào thì **Remix** tinh chỉnh.

## Giá credit tham chiếu (Flow Help, cập nhật 2026-06-24 — giá Ultra)
| Model video | Credit / clip | Ghi chú |
|---|---|---|
| Veo 3.1 Lite (4/6/8s) | 10 (Ultra **5**) | rẻ nhất |
| Veo 3.1 Fast (4/6/8s) | 20 (Ultra **10**) | cân bằng |
| Veo 3.1 Quality (8s) | **100** | đẹp nhất, mọi user |
| Gemini Omni Flash | 15 / 20 / 25 / 30 (4/6/8/10s) | edit = 40 |
| Upscale 1080p | free (Plus/Pro/Ultra) | |
| Upscale 4K | 50 (chỉ Ultra) | |
Quota/tháng: Free 50/ngày · Plus 200 · Pro 1.000 · Ultra$100 10.000 · Ultra$200 **25.000**. Mỗi clip Veo 3.1 tối đa 8s (Extend được); Omni Flash tối đa 10s.

---

```
Create a Tool called "Batch Image-to-Video Studio".

PURPOSE: From a large set of uploaded images (up to 200), generate one or more videos per image in batch, where each video animates the scene depicted in its source image. Include a session credit-budget optimizer so I never overspend my Flow credits.

INPUTS:
- A bulk image upload field that accepts many images at once (target up to 200; jpg, png, webp). If there is a per-upload limit, let me add images in several batches that all go into one queue.
- A global motion/style prompt applied to every image (e.g. "natural cinematic camera movement and subject motion consistent with the scene shown").
- Optional per-image motion note: if I upload a .txt or .md file of motion prompts, pair each line/section to an image by order or by matching filename. When an image has no note, automatically animate the scene the image depicts (motion, camera, and action that match what is in the image — treat the image as the script/storyboard frame).

VIDEO SETTINGS (show the live Flow credit cost next to each option; read the real cost from Flow's credit banner, do not trust hardcoded numbers):
- Model selector: "Veo 3.1 Lite" (cheapest), "Veo 3.1 Fast" (balanced), "Veo 3.1 Quality" (best), "Gemini Omni Flash". Reference costs per clip for an Ultra account as of 2026-06-24: Lite 5, Fast 10, Quality 100; Omni Flash 15/20/25/30 for 4/6/8/10s. Always display the model's current credit cost.
- Duration: 4s / 6s / 8s for Veo 3.1 (max 8s per clip, Extend available); up to 10s for Omni Flash.
- Aspect ratio: 16:9, 9:16, 1:1. Audio on/off if the model supports it.
- Output resolution with optional upscale: 1080p (free on my plan) and 4K (50 credits, Ultra only) — show the extra credit cost when 4K is selected.
- "Videos per image": how many videos to create from each image (default 1). And an overall "total videos to generate" cap.

AUTO-RECOMMEND COUNT (a toggle):
- When enabled, recommend how many videos to generate based on my session budget and the selected model's per-clip cost: recommended_count = min(number_of_images x videos_per_image, floor(session_budget / cost_per_clip)). Show the arithmetic and let me accept or override.

SESSION CREDIT-BUDGET OPTIMIZER:
- Let me enter a total credit budget for this session. If accessible, also show my remaining monthly Flow credits.
- Before running, show an estimate table comparing ALL models: for my budget, how many videos each model affords and the total credit cost for my chosen count. Include the 4K upscale surcharge when selected.
- Let me pick an optimization goal: "Maximize number of videos within budget", "Maximize quality within budget", or "Balanced". Recommend the model + duration + count that best meets the goal without exceeding the budget.
- Enforce the budget as a hard cap: warn at 80% and 100%, and pause the batch before any generation that would exceed the budget.
- Show a live running total during the batch: credits spent, credits remaining in budget, and videos completed.

BATCH BEHAVIOR:
- Generate videos sequentially, one job at a time, honoring a user-set delay (in seconds) between generations.
- Controls: Start, Pause, Resume, Stop.
- "Retry failed": re-run only the failed jobs; automatically skip the ones that already succeeded.
- Live progress: done/total, success count, failed count, current image, credits used / remaining.

RESULTS GALLERY:
- A grid of generated clips. For each: a thumbnail with playback, its source image, duration, and the credits it cost.
- On each clip: a button to regenerate just that clip, and a button to delete it.
- "Download all" that packages every clip into a single ZIP. If a ZIP is not possible, let me multi-select and download together. Also allow downloading a single clip.

UX: clean, responsive layout; always show credit costs; require a confirmation before any run that would spend more than a threshold I set; clear empty/loading/error states.

Build as much of this as the platform supports. Where a capability (bulk 200-image upload, batch loop, ZIP, 4K upscale, live credit readout) is not available, build the closest equivalent and tell me exactly what was substituted or skipped.
```

---

## Logic budget (để đối chiếu khi tool chạy)
- `chi phí 1 clip` = credit theo model + (duration tier nếu Omni Flash) + (50 nếu 4K upscale).
- `recommend số video` = min( số_ảnh × video_mỗi_ảnh , floor( budget / chi_phí_1_clip ) ).
- Tối đa video trong budget → chọn Lite; tối đa chất lượng → Quality; cân bằng → Fast.
- Ví dụ Ultra$200 (25.000/tháng), 200 ảnh×1: Lite 1.000cr · Fast 2.000cr · Quality 20.000cr · OmniFlash 8s 5.000cr.

## Caveat thành thật
- Flow vốn mạnh về **image-to-video (Veo "Frames to Video")** nên tool này hợp tạng Flow hơn cả tool ảnh.
- CHƯA chắc Flow Tools cho **upload 200 ảnh/lần** + **batch loop 200 job** + **ZIP** + **đọc credit live trong tool** — phần nào thiếu thì Remix hoặc tách tool. Verify khi chạy thật.
- Giá credit có thể đổi → tool phải đọc từ banner Flow; bảng trên chỉ là snapshot 2026-06-24.

## Unresolved (xác minh khi dùng thật trên Flow)
1. Giới hạn số ảnh upload 1 lần trong 1 Flow Tool? (200 có vượt không)
2. Flow Tool có chạy được vòng lặp batch nhiều job tuần tự, hay mỗi lần 1 video?
3. Tool có đọc được số credit còn lại / chi phí live để optimize budget không, hay chỉ ước lượng tĩnh?
4. ZIP download + multi-select trong Flow Tool có hỗ trợ không?
5. Omni Flash giá image-to-video có khác text-to-video không (Flow Help mới list theo độ dài, chưa tách i2v).
