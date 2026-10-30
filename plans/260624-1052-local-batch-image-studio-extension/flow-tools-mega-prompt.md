# Mega-prompt — Google Flow Tools (Batch Scene Image Generator & Editor)

> **Nền tảng:** Google Flow → **Tools → Create Tool**. Chạy trong Flow, dùng **Flow credits = quota subscription Ultra (25.000/tháng), KHÔNG API key.**
> **Cách dùng:** mở Flow → mở/ tạo project → panel **Tools** bên trái → **Create Tool** → dán phần trong khối ``` → Generate. Sau khi dựng, bấm **Remix** để tinh chỉnh hội thoại phần nào chưa đúng.
> **Lưu ý:** Flow Tools là trình tạo tool bằng ngôn ngữ tự nhiên (chưa rõ giới hạn upload-file/batch/ZIP/upscale). Prompt yêu cầu tối đa; phần nào Flow không dựng được sẽ cần Remix hoặc chấp nhận bản thay thế gần nhất.

---

```
Create a Tool called "Batch Scene Image Generator & Editor".

PURPOSE: Generate high-quality images in bulk from a list or script of scene prompts, then review, regenerate, edit/upscale, and download them — all inside Flow using my subscription image model (no API key).

INPUTS:
- A large text box where I paste multiple image prompts. Also, if supported, an upload field that accepts a .txt or .md file containing the prompts.
- Automatically detect how the prompts are separated and split the text into individual scenes. Support these separators, in priority order: scene markers such as "--- SCENE 001 ---", "SCENE 1:", "[CẢNH 2]", "PHÂN CẢNH 3", "PROMPT 4"; Markdown headings (# to ######); horizontal dividers (---, ===, ***, ___); numbered lists (1. or 1)); bullet lists (-, *, •); otherwise split on blank lines (double newline).
- Show the detected separator type and the number of scenes found, with an editable preview list: scene title + prompt + optional negative prompt + optional aspect ratio detected from the text.
- Support structured prompt blocks with "key: value" lines (Subject, Action/Energy, Setting, Style, Lighting/Color, Atmosphere, Composition, Camera, Negative): merge them into one strong prompt; treat lines starting with "Negative:" or "Avoid:" as the negative prompt. Detect aspect ratio from phrases like "16:9 aspect ratio" or a bare "16:9 / 9:16 / 4:3 / 3:4".

SETTINGS (controls shown in the tool UI):
- Image model selector: "Nano Banana Pro" and "Nano Banana" (use the best Flow image model available to my account).
- Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4.
- Resolution: "Full HD (1920x1080, JPEG)", 2K, 4K. For non-16:9 ratios, keep the original aspect ratio (fit within the size, do not stretch).
- Delay in seconds between each generation.

BATCH BEHAVIOR:
- Generate one image per scene, sequentially, respecting the delay between generations.
- Controls: Start, Pause, Resume, Stop.
- A "Retry failed" action that re-runs only the scenes that failed and automatically skips scenes that already succeeded.
- Live progress: done/total, success count, failed count, and the current scene being generated.

RESULTS GALLERY:
- A thumbnail grid of all generated images, each labelled with its scene title and status.
- On each image: a button to regenerate just that one image, and a button to delete that image.
- A "Download all" button that packages every generated image into a single ZIP file. If a ZIP is not possible, let me select all images and download them together.

IMAGE EDITOR (opens from any image):
- Resize by width/height with a lock-aspect-ratio option, using high-quality Lanczos resampling, plus an AI enhance/upscale option (Real-ESRGAN style) to 2K or 4K.
- Adjustments that visibly change the image: brightness, contrast, saturation, hue, exposure, vignette, blur, sharpen, denoise, grayscale, sepia, invert, edge detect.
- Undo and Redo buttons.
- Save the edited image back into the gallery, and download the single edited image.

UX: clean, responsive layout with clear empty, loading, and error states.

Build as much of this as the platform supports. Where a capability is not available, build the closest equivalent and tell me exactly what was substituted or skipped.
```

---

## Sau khi tạo tool
1. Chạy thử với 3-5 prompt trước khi batch lớn, kiểm mỗi ảnh trừ đúng Flow credits (không hỏi API key).
2. Nếu Flow chưa dựng được: upload file / batch loop / ZIP / Real-ESRGAN → **Remix** và yêu cầu riêng từng phần, hoặc tách thành 2 tool (1 tool sinh batch, 1 tool edit/upscale).
3. Theo dõi credit còn lại (Ultra 25.000/tháng) — batch lớn vẫn rất thoải mái.

## So với các phương án trước
- **Flow Tools** (đây): no-API, quota Ultra, chạy trên Google, không cần dev local. → **Ưu tiên thử trước.**
- Extension automation (plan 260624-1052): no-API nhưng phải dev + cài local, mong manh. → Dự phòng nếu Flow Tools thiếu tính năng.
- AI Studio Build (`ai-studio-build-mega-prompt.md`): chạy được nhưng **dùng API key**. → Chỉ khi 2 cái trên không đủ.

## Unresolved (cần xác minh khi dùng thật)
1. Flow Tool có nhận upload .txt/.md không? (chỉ text-box chắc chắn có).
2. Batch tuần tự 50-200 prompt trong 1 tool có được không, hay phải chạy từng cái?
3. ZIP download + Real-ESRGAN upscale có nằm trong khả năng Flow Tools không?
4. Credit cost mỗi ảnh (để ước lượng số ảnh/tháng từ 25.000 credit).
