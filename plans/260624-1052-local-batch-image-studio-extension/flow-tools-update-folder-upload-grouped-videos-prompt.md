# Prompt UPDATE (Remix) — Flow Tool: folder/zip image upload + N-videos-from-M-images

> **Cách dùng:** mở tool đã tạo trên Flow → **Remix / Edit** → dán khối ``` để yêu cầu Flow cập nhật code. Đây là prompt SỬA tool hiện có, không tạo mới.
> **Trọng tâm mới:** upload folder/zip >100 ảnh dùng TẠM (không lưu vào gallery Flow) → nhóm ảnh theo kịch bản → tạo ĐÚNG số video user chọn (vd 25 video từ 119 ảnh), không phải 1 ảnh = 1 video.

---

```
Update this tool with the following changes. Keep all existing features working; only add/modify what is described here.

=== 1. NEW INPUT: upload a folder of images OR a .zip of images ===
- Add an input mode where I upload either a whole folder of images or a single .zip file containing images. Support large sets (more than 100 images, e.g. 119).
- Accept jpg, jpeg, png, webp. If a .zip, extract the images from it (including images inside sub-folders).
- Treat these uploaded images as a TEMPORARY working set used only to make videos in this session. Do NOT save them into my Flow gallery/project library; they are inputs, not generated assets.
- Sort the images by filename in natural order (so file_001, file_002 ... become the storyboard order).
- Robust load-error handling: skip any file that is corrupt, unreadable, zero-byte, or an unsupported format; do NOT abort the whole upload. After loading, show a summary: how many images loaded successfully, how many were skipped, and the exact filenames that failed and why. Let me continue with the images that loaded.

=== 2. CHOOSE HOW MANY VIDEOS TO CREATE (not 1 image = 1 video) ===
- Add a numeric option "Number of videos to create" (for example I upload 119 images but only want 25 videos).
- IMPORTANT: I do NOT want one video per image. I want a chosen number of videos generated FROM the whole image set, by grouping consecutive images into scenes.
- Optional "Auto-recommend" toggle: suggest a video count based on the image count and my session credit budget, but my manual number always wins when set.

=== 3. IMAGE-GROUPING ALGORITHM (weave images into N video scenes) ===
- Given M loaded images (in filename order) and a target of N videos:
  - base = floor(M / N); remainder = M mod N.
  - The first `remainder` videos each get (base + 1) images; the remaining videos each get `base` images. Group images CONSECUTIVELY so each video covers a continuous slice of the storyboard.
  - Example: 119 images, 25 videos -> 19 videos of 5 images + 6 videos of 4 images = 119 images, no leftovers.
- Each video is built from its group of images used as ordered keyframes, producing ONE coherent clip that moves through that group's scene in order. If the video model only accepts a first and last frame, use the group's first image as the start frame and its last image as the end frame, and (when supported) pass the in-between images as reference/ingredient frames to keep characters and style consistent through the clip.
- Preserve the global STYLE LOCK and character-consistency rules already in the tool: the video must keep the exact art style of the source images (e.g. anime stays anime, never photorealistic / never real humans).
- Before generating, show an editable GROUPING PREVIEW: list each planned video with the images assigned to it (thumbnails), the per-video credit cost, and total. Let me move images between videos, merge or split groups, and adjust the video count, with the budget recomputed live. Then confirm to start.

=== 4. BATCH + DOWNLOAD (apply to these grouped videos) ===
- Generate the N videos sequentially with the existing delay / Start / Pause / Resume / Stop controls.
- "Retry failed" re-runs only the videos that failed and skips the ones that already succeeded; also let me Skip a failing video or just download the successful ones — a failure must never block downloading good output.
- "Download all (ZIP)" must show a visible PERCENT progress bar for the compression that updates from 0% to 100% while the archive is being built, and only then trigger the download, so I can follow the zipping. Also allow downloading a single video at any time.

=== 5. REPORT WHAT YOU CHANGED ===
- After updating, tell me exactly which of these were implemented natively and which were substituted or are not supported by the platform (especially: folder upload, .zip extraction, treating uploads as temporary/not-saved, >100 image handling, multi-image-per-clip keyframing, and the zip progress bar).
```

---

## Giải thích thuật toán nhóm (để bạn kiểm khi Flow chạy)
- 119 ảnh, 25 video → base=4, dư=19 → **19 video ×5 ảnh + 6 video ×4 ảnh = 119** (không sót ảnh).
- Nhóm **liên tiếp theo thứ tự filename** ⟹ mỗi video phủ 1 lát kịch bản liền mạch.
- Mỗi video dùng nhóm ảnh làm keyframe theo thứ tự. Nếu model chỉ nhận first/last frame → lấy ảnh đầu + ảnh cuối của nhóm làm 2 keyframe, ảnh giữa làm reference giữ style/nhân vật.

## Nói thẳng — chỗ rủi ro Flow có thể làm KHÔNG được
| Yêu cầu | Rủi ro | Nếu Flow từ chối |
|---|---|---|
| Upload **folder / .zip >100 ảnh** | 🔴 cao (Flow Tool có thể giới hạn upload, không giải nén zip) | upload nhiều đợt vào 1 queue; hoặc dùng extension local |
| Ảnh upload **không lưu vào gallery** | ⚠️ trung (Flow có thể tự lưu input) | chấp nhận Flow lưu, xóa thủ công sau |
| **Nhiều ảnh → 1 video** (keyframe nhóm) | ⚠️ trung (Veo native thường first+last frame, hoặc Ingredients) | mỗi clip dùng first+last của nhóm + ingredients; chất lượng "lồng kịch bản" phụ thuộc khả năng Veo |
| **Zip + progress bar %** | 🔴 cao (code nén client tùy biến) | tải lẻ / multi-select; hoặc extension |

→ 2 chỗ đỏ (zip upload >100 + zip progress bar) là phần Flow Tools dễ vướng nhất; nếu vướng thì đây đúng là phần **plan extension `260624-1052`** xử lý (đọc folder local, giải nén, nén zip có progress thật).

## Unresolved (verify khi Remix trên Flow)
1. Flow Tool có nhận folder upload / giải nén .zip không, giới hạn số ảnh bao nhiêu?
2. Veo trong Flow nhận tối đa mấy keyframe/clip (chỉ first+last, hay nhiều ingredient)? → ảnh hưởng chất lượng "lồng ghép kịch bản nhiều ảnh thành 1 video".
3. Upload có thật sự ở chế độ tạm (không vào gallery) được không?
4. Zip progress bar % có khả thi trong Flow Tool không?
