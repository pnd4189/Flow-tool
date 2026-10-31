# Image to Video Studio

Flow Tool, id `88a10ec3-c82f-40ee-a0e3-4daa8d43bfe8`, dự án "Youtube studio". Tên gốc "Batch Scene Image Generator", user đổi tên ngày 2026-10-29. Trong danh sách Tools còn một bản "Remix of Batch Scene Image Generator" là bản sao cũ, không phải tool đang dùng.

## Làm gì

Sinh ảnh hàng loạt từ kịch bản hoặc danh sách prompt, xem lại, sinh lại, chỉnh sửa, tải về; tab Video Studio biến ảnh thành video (tốn credit).

## Thành phần (`flow-tools/image-to-video-studio/source`)

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

## Prompt đã dùng (`flow-tools/image-to-video-studio/prompts/`)

| File | Nội dung |
|---|---|
| `prompt-a` | Sửa các yêu cầu ban đầu |
| `prompt-b1`…`b3` | Ổn định khi chạy hàng loạt |
| `prompt-q3`, `sdk-qa/` | Hỏi builder về SDK (chỉ trả lời, không sửa code) |
| `prompt-u1`, `u2` | Bộ đếm sử dụng, tự lưu nháp |
| `prompt-v1a`…`v1c`, `v2` | Tab Video Studio; 2 tính năng AI dùng `Flow.generate.text` |
| `prompt-d1` | Làm lại tải xuống cho ảnh và video (một hàng đợi chung) |
| `prompt-s1`, `s2` | Chế độ tự chọn ảnh làm video |
| `prompt-f1-safety`, `f1b-syntax` | Tự xử lý ảnh bị chặn vì chính sách; sửa 1 dòng ternary builder làm hỏng |

## Ảnh bị chặn vì chính sách — sửa 2026-10-31

- Nguyên nhân đo thật: Flow trả "Lượt tạo này có thể vi phạm các chính sách của chúng tôi…", tool cũ không nhận ra câu tiếng Việt này. Tool còn nối nguyên dòng `Negative:` ("no nudity…, no graphic gore or blood…, no celebrity face…") thành `Avoid:` vào prompt. Lô 8 cảnh của KTT_T04 lỗi 4 cảnh; bỏ `Avoid:` thì cả 5 cảnh nghi bị chặn đều tạo được. Thử lại hay đổi model đều gửi y nguyên prompt nên vẫn bị chặn.
- Cách sửa (`services/safety.ts`): lọc bỏ mục nhạy cảm khỏi negative; nếu vẫn bị chặn thì lần lượt thử bỏ hẳn `Avoid:`, rồi AI viết lại prompt (tối đa 2 lần, lần 2 dè dặt hơn), sau đó mới báo lỗi. Thẻ ảnh có nhãn "AI đã chỉnh prompt" và nút "Khôi phục prompt gốc". Retry/tạo lại dùng prompt mới nhất trong state.
- Đã chạy thật: 16 cảnh đầu KTT_T04 kèm nguyên dòng Negative → 16/16 thành công; cảnh 014 qua ở bước bỏ `Avoid:`. Bước AI viết lại chưa được kích hoạt thật (prompt thử nặng tay vẫn không bị chặn), mới kiểm bằng đọc code.

## Sửa nhỏ 2026-10-31 tối (`prompt-f2-pill-title`)

- Nút `PillButton` không nhận `title`, nên chú thích "Đang tải ở Trung tâm tải xuống" trên nút Download không bao giờ hiện. Đã thêm prop `title`.
- `services/video.ts` sửa kiểu `BlobPart[]`. Tool giờ 0 lỗi kiểu.
- `test-scripts/safety.test.ts` kiểm các hàm an toàn (nhận lỗi chặn tiếng Việt, lọc negative KTT, thang thử lại, AI viết lại prompt) với Flow giả lập. Bước AI viết lại prompt khi bị chặn thật trên Flow vẫn chưa gặp.
