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

## Sửa lỗi 2026-10-31 (`p8a`, `p8a2`, `p8b`, `p8b2`, `p8c`)

Soát code tìm ra 6 lỗi nặng và 14 lỗi vừa/nhẹ; đã sửa hết qua builder:
- **Render và credit.** Bước Storyboard và Render luôn được dựng sẵn, chỉ ẩn đi, nên rời bước không làm mất tiến trình và nút Dừng. Mọi chỗ ghi shot dùng cập nhật theo id từ state mới nhất, không còn ghi đè take/chỉnh sửa. Shot đang `rendering` không bị gửi lại. ShotInspector có kiểm tra/trừ credit. "Render lại lệch mạch" dùng keyframe mới và tạo lock mới.
- **Timeout.** Chỉ tính thời gian chờ video, nâng lên 900 giây. Shot có lỗi `TIMEOUT:` không bị lô "Render lỗi" gửi lại; vẫn render tay được.
- **Lỗi tiếng Việt và chính sách.** Nhận ra lỗi quota/chính sách tiếng Việt. Bị chặn thì AI viết lại prompt video và thử lại đúng 1 lần.
- **Nạp kịch bản.** File dạng `--- SCENE 001 ---` + các dòng nhãn được tách mỗi khối thành 1 shot. "Camera:", "Năm 1876:" không còn bị coi là lời thoại. Viết kịch bản AI lỗi giữa chừng không xoá storyboard; có nút "Thêm scene đã viết" và "Thử lại từ scene lỗi".
- **Xuất và nối cảnh.** `concat_list` chỉ gồm shot đã render. Tên file tải ở bước Render khớp danh sách ghép. "Nạp lại từ thư viện" cảnh báo khi chọn nhầm video. Đổi cut→chain dùng keyframe chung và đánh dấu take lệch mạch. Đổi 16:9↔9:16 cảnh báo và đánh dấu take. Director không xoá hiệu ứng khi AI trả id sai.

Đã kiểm:
- Kiểm tra kiểu TypeScript (khai báo giả cho React/SDK) trên toàn bộ code: 0 lỗi.
- Parser: chạy bằng node trên file KTT_T04 thật ra 120 shot.
- Chạy thật trên Flow, chỉ đường 0 credit: nạp 3 cảnh → 3 scene/3 shot; tạo 6/6 keyframe, keyframe cuối tham chiếu đúng keyframe trước; rời bước giữa chừng rồi quay lại vẫn còn tiến trình và nút Dừng; nút render bị khoá khi đang tạo keyframe.

Render video thật đã chạy ở mục dưới. Còn chưa gặp thật: timeout 900 s, AI viết lại prompt video khi bị chặn, credit trừ ở ShotInspector.

## Nạp kịch bản và render thật — 2026-10-31 tối (`p9`, `p9b`)

- **Kịch bản dạng thường:**
  - Cảnh mở đầu bằng câu thoại ("LAN: Chào anh") không còn bị đưa vào action thành nội dung hình. Câu thoại tạo shot "LAN nói" kèm lời thoại.
  - Thoại không còn gắn nhầm sang shot của cảnh trước, hai câu thoại liên tiếp không còn ghi đè nhau.
  - Dòng nhãn ("Camera: slow push in") gắn vào shot đang có thay vì tạo shot riêng. Cảnh chỉ toàn nhãn vẫn tạo được 1 shot.
- **File chỉ có một khối `--- SCENE 001 ---`** từng báo "Không tìm thấy shot nào". Đây là lỗi do bản `p9` gây ra, lộ ra khi chạy thật; đã sửa, giờ ra 1 shot.
- **Bài kiểm tra:** `test-scripts/script-import.test.ts`, chạy bằng `flow-builder/scripts/check-snapshot.sh`. Có thêm file KTT_T04 đủ 120 shot khi ổ Drive có gắn.
- **Render thật (tốn 4 credit, user đồng ý):**
  - Nạp 1 khối → 1 shot. Tạo 2/2 keyframe (0 credit). Đặt Omni 1.1 Flash 360p 4 s; nút ghi "Quay (4 cr)".
  - Take #1 xong sau ~41 s. AI chấm 75 điểm. Bộ đếm ngân sách 6.000 → 5.996.
  - "Tải tất cả clip" ra `long_form_ai_studio_001_…_t1.mp4`: h264 640×360, 24 fps, có AAC, 4,03 s, 1,6 MB. Nội dung đúng kịch bản (cáo 2D quay tay quay, máy bay giấy bay lên).
  - Ảnh và video thử đã chuyển vào Thùng rác của Flow.
