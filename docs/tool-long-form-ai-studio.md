# Long-Form AI Studio

Flow Tool, id `008c934c-cfac-4f75-ad99-c492960ce1ce`, dự án "Youtube studio". Tên hiển thị trong tool là "Anime 2D Film Studio". Bản v2, build ngày 2026-10-30.

## Làm gì

Dựng phim hoạt hình 2D dài (4–5 phút) hoặc Short dọc từ nhiều cảnh 4–10 giây nối nhau. Mỗi cảnh có keyframe đầu/cuối làm từ ảnh (0 credit), rồi mới gọi model video (tốn credit). Hướng của user: **chỉ hoạt hình 2D, không người thật**; loạt chính là truyện có lời dẫn về các phát minh kỳ lạ trong lịch sử. Mỗi prompt đều kèm câu chặn "Strictly 2D hand-drawn animation, not photorealistic, no 3D CGI rendering, no real people." Model mặc định Omni 1.1 Flash.

## Bố cục

Header + 6 bước (Nhân vật, Kịch bản, Đạo diễn, Storyboard, Render, Xuất) + dòng thời gian cảnh ở dưới (bấm biểu tượng xích/kéo giữa 2 cảnh để nối liền hay cắt cảnh).

## Thành phần chính (`tool-snapshots/long-form-ai-studio/source`)

| File | Việc |
|---|---|
| `services/library.ts` | 19 phong cách (anime_cel, patent_blueprint, victorian_engraving, edu_1950s…), chuyển động máy quay kiểu anime, góc nhìn, hiệu ứng 2D, 10 công thức cảnh |
| `services/shotengine.ts` | Ghép prompt theo công thức Veo |
| `services/keyframeService.ts` | Keyframe tham chiếu keyframe trước cùng cảnh + ảnh nền chung, giữ bối cảnh liền mạch |
| `services/director.ts`, `variety.ts` | AI tự đạo diễn, làm đa dạng góc máy |
| `services/scriptImport.ts`, `scriptWriter.ts` | Nạp kịch bản .txt/.md/.fountain/.srt/.csv/.json; AI viết kịch bản 2 bước; thể loại "truyện phát minh" có lời dẫn, nhãn thời đại, ghi chú sự thật |
| `services/renderService.ts`, `qcService.ts` | Take, khoá take, đánh dấu "lệch mạch", AI chấm 3 khung hình |
| `services/exportKit.ts`, `components/ExportStep.tsx` | Bộ xuất cho hậu kỳ: clip + `edit_manifest.json` + `concat_list.txt` + `narration.txt` + `storyboard.md` |
| `services/sessionService.ts` | Lưu/mở phiên v2 (không kèm file; nút "Nạp lại từ thư viện" ở bước Xuất) |
| `services/pricing.ts`, `components/CreditEstimator.tsx` | Ước tính credit |

## Đã kiểm thật (2026-10-30, tốn 12 credit: Omni 360p 4 s × 3)

- Keyframe giữ đúng một bối cảnh suốt cả cảnh.
- Hàng đợi tự chạy từ cảnh 1 sang cảnh 2.
- Quay lại take dùng đúng prompt đã khoá và đúng cả 2 keyframe.
- Tạo lại một keyframe dùng chung thì 2 cảnh hai bên bị đánh dấu "lệch mạch".
- Ghi chú chấm điểm khớp với khung hình (điểm hay dồn quanh 72, sau đó đã thêm mốc hiệu chỉnh).
- Tên file trong bộ xuất khớp nhau; `ffmpeg -f concat` nối được các clip.
- Mở phiên v2 khôi phục đúng take, điểm chấm, cờ lệch mạch.

## Chưa kiểm

Các model Veo; 720p và clip 8–10 s; Short 9:16; tạo bảng nhân vật từ Character Vault ở v2; chất lượng lời đọc tiếng Việt; đợt sửa cuối p7 (thống nhất `projectSlug`, bỏ qua take không có file khi tải, hiệu chỉnh điểm chấm) đã có trong code nhưng chưa chạy lại.

## Prompt đã dùng (`flow-builder/prompts/long-form-ai-studio/`)

| File | Nội dung |
|---|---|
| `p1`, `p1fix`, `p1fix2` | Thư viện điện ảnh, prompt chuẩn Veo, keyframe liền mạch, sửa bộ nhớ |
| `p2` | Giao diện studio |
| `p3` | Chuyển trọng tâm sang hoạt hình 2D, thư viện đạo diễn, AI đạo diễn |
| `p4`, `p4fix`, `p4b` | Kịch bản: tải lên, AI viết, AI hoàn thiện |
| `p5` | Render lại không lệch kịch bản (take, khoá, lệch mạch, AI chấm) |
| `p6` | Bộ xuất cho hậu kỳ + phiên v2 |
| `p7` | 4 lỗi nhỏ phát hiện khi chạy thử đầu-cuối |
| `sdk-qa/` | Câu hỏi/đáp với builder về SDK video |

## Gợi ý còn treo

Thêm chế độ "chuyển động 0 credit" (dùng lại máy quay + hiệu ứng phủ của Effect-Image thay cho model video); ghép hậu kỳ bằng ffmpeg/Remotion (dựng nặng chạy Colab). User chưa quyết.
