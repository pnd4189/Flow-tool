# Image to Video Studio

Flow Tool, id `88a10ec3-c82f-40ee-a0e3-4daa8d43bfe8`, dự án "Youtube studio". Tên gốc "Batch Scene Image Generator", user đổi tên ngày 2026-10-29. Trong danh sách Tools còn một bản "Remix of Batch Scene Image Generator" là bản sao cũ, không phải tool đang dùng.

## Làm gì

Sinh ảnh hàng loạt từ kịch bản hoặc danh sách prompt, xem lại, sinh lại, chỉnh sửa, tải về; tab Video Studio biến ảnh thành video (tốn credit).

## Thành phần (`tool-snapshots/image-to-video-studio/source`)

| File | Việc |
|---|---|
| `App.tsx`, `services/image.ts`, `services/parser.ts` | Hàng đợi sinh ảnh, tách prompt |
| `components/ScriptSplitter.tsx`, `services/storyboard.ts` | Tách kịch bản thành cảnh |
| `components/ImageEditor.tsx` | Chỉnh sửa ảnh |
| `components/VideoStudio.tsx`, `services/video.ts` | Ảnh → video |
| `services/usage.ts` | Bộ đếm sử dụng do tool tự đếm (SDK không có API credit); mặc định 6000 credit/tháng, trần ảnh mềm 1000/ngày |
| `components/DownloadCenter.tsx`, `services/downloadQueue.ts` | Một hàng đợi tải chung cho ảnh và video. Tên file `<runTag>_<NNN>_<slug>[_v#_model_Ns]`, tải lại thì thêm `_dl2` |
| `services/autoPick.ts`, `imageScore.ts`, `aiPicker.ts` | Tự chọn ảnh tốt để làm video (ví dụ 120 ảnh chọn 5/10/…), AI chấm ảnh |

## Đã kiểm thật (2026-10-29)

- Sinh ảnh với 3 model Nano Banana, 0 credit.
- Tải hàng loạt bằng nhiều lần `Flow.download` tuần tự (ZIP bị từ chối).
- Video Omni 1.1 Flash 360p 4 s từ ảnh: ~40 s, trừ đúng 4 credit, mp4 640×360 24 fps có tiếng.
- Trạng thái không sống qua lần tải lại; tool có Lưu phiên / Mở phiên bằng file JSON.

## Chưa kiểm

Veo; 720p; clip 8/10 s; 9:16 kèm cắt + `Flow.upload`; nhiều biến thể mỗi ảnh.

## Prompt đã dùng (`flow-builder/prompts/image-to-video-studio/`)

| File | Nội dung |
|---|---|
| `prompt-a` | Sửa các yêu cầu ban đầu |
| `prompt-b1`…`b3` | Ổn định khi chạy hàng loạt |
| `prompt-q3`, `sdk-qa/` | Hỏi builder về SDK (chỉ trả lời, không sửa code) |
| `prompt-u1`, `u2` | Bộ đếm sử dụng, tự lưu nháp |
| `prompt-v1a`…`v1c`, `v2` | Tab Video Studio; 2 tính năng AI dùng `Flow.generate.text` |
| `prompt-d1` | Làm lại tải xuống cho ảnh và video (một hàng đợi chung) |
| `prompt-s1`, `s2` | Chế độ tự chọn ảnh làm video |
