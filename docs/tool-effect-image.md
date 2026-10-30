# Effect-Image

Flow Tool, id `bf210f9d-931f-4d71-9d71-451672734a0c`, trong dự án "Youtube studio". Mọi thứ đều 0 credit.

## Làm gì

Nạp file chứa nhiều prompt → tự tách từng prompt → sinh ảnh hàng loạt → gắn hiệu ứng máy quay, parallax, hiệu ứng phủ (AI tự chọn theo từng ảnh) → dựng MP4 ngay trong trình duyệt → tải về. User dán prompt, bấm một nút, chờ lấy file.

## 4 chế độ tự động (bước 1)

| Chế độ | Làm gì | Ước tính 300 prompt (2 luồng, 1080p) |
|---|---|---|
| 1. Auto đầy đủ | Máy quay + hiệu ứng phủ + parallax | ~1 giờ 55 phút |
| 2. Auto không parallax | Máy quay + hiệu ứng phủ | ~1 giờ 40 phút |
| 3. Chỉ chuyển động máy quay | Không parallax, không hiệu ứng phủ | ~1 giờ 40 phút |
| 4. Chỉ sinh ảnh | Tải ảnh gốc + manifest, không dựng video | ~1 giờ 40 phút |

Ước tính 300 prompt được nhân từ số đo ở 30 prompt, chưa chạy thật ở quy mô đó. Mỗi thẻ trong tool hiện thời lượng và giờ xong dự kiến, và tính lại theo tốc độ thật khi đang chạy. Tuỳ chỉnh: model, số luồng (1–3), độ phân giải 720p/1080p, FPS 24/30, thời lượng (AI chọn hoặc cố định 3–10 s), hậu tố phong cách, tải kèm ảnh gốc, ghép thành 1 video (2–30 clip), kích thước lô manifest (mặc định 10), tên dự án.

Chạy thủ công 4 bước vẫn giữ nguyên: 1 Nhập prompt, 2 Sinh ảnh, 3 Hiệu ứng, 4 Xuất.

## Tính năng chính

- **Nhập prompt:** nhận dạng JSON, CSV, marker ("Prompt 3:", "Ảnh 4:", "Scene 6:"…), danh sách đánh số, tiêu đề markdown, dòng phân cách, đoạn cách dòng trống, mỗi dòng một prompt. Tách `--ar`, `Negative:`, `--no`; bỏ cờ Midjourney (`--v`, `--style`…); dịch prompt tiếng Việt sát nghĩa (không thêm chi tiết); phát hiện trùng; nút "AI tách lại"; file lớn xử lý theo từng đoạn.
- **Sinh ảnh:** 3 model Nano Banana; thử lại lỗi tạm thời (5 s, 15 s, 40 s); lỗi an toàn thì AI viết lại prompt 1 lần; tự đổi model sau 3 lỗi liên tiếp; AI chấm ảnh (dưới 60 điểm thì sinh lại 1 lần); timeout 120 s; Tạm dừng/Dừng.
- **Hiệu ứng:** 11 kiểu máy quay; 15 hiệu ứng phủ vẽ trên canvas có seed; parallax 2 lớp; AI nhìn ảnh rồi chọn hiệu ứng khớp nội dung (không cho tuyết ở cảnh hè, mưa trong nhà…) và có hàm làm đa dạng máy quay.
- **Xuất:** dựng MP4 bằng WebCodecs, tải tuần tự, manifest JSON, tuỳ chọn ảnh gốc, ghép video, lưu thư viện Flow.
- **Chạy bền:** dây chuyền theo từng ảnh; manifest từng lô; "Chạy tiếp từ manifest" nhận nhiều file manifest; 5 mục lỗi liên tiếp thì tự nghỉ 3 phút rồi thử lại (tối đa 5 vòng, đồng hồ tính theo mốc thời gian); hết hạn mức thì ngừng sinh ảnh mới, làm nốt ảnh đã có và báo còn bao nhiêu prompt chưa chạy; giải phóng bộ nhớ sau khi tải xong từng clip; Dừng vẫn ghi manifest lô dở.
- **Bảng "Chẩn đoán":** nút `monitor_heart` ở header; có phép thử nền tảng và "Giả lập lỗi sinh ảnh" (tạm thời, dịch vụ ảnh, an toàn, hạn mức, timeout; số lần 1, 2, 3, 5, 10, 20, 30).

## Số đo thật (2026-10-30)

| Lượt chạy | Thời gian |
|---|---|
| Chế độ 1, 4 prompt | ~2 phút 50 giây (lần đo đầu, trước các đợt tối ưu: 4 phút 43 giây) |
| Chế độ 2, 4 prompt | 1 phút 44 giây |
| Chế độ 3, 11 clip | 236 giây (~21 giây/clip) |
| Chế độ 2, 30 prompt, tab ẩn | 10 phút 1 giây, 0 lỗi |
| Chế độ 1, 12 prompt, 3 luồng, tab ẩn | 5 phút 30 giây |
| 6 prompt, 1 luồng, 20 lỗi giả lập liên tiếp, tab ẩn | 12 phút 10 giây, tự phục hồi, 6/6 clip |

Mỗi clip 1080p ~9 MB, dựng ~8 s. Clip 16:9 ra 1920×1080, 9:16 ra 1080×1920, 24 fps.

## Đã kiểm thật

4 chế độ; prompt bỏ tick không chạy; hậu tố phong cách vào `sentPrompt`; thời lượng cố định; ảnh gốc; ghép video (tự động và thủ công); 720p; bước 3 và 4 thủ công; 5 và 20 lỗi tạm thời liên tiếp; hết hạn mức; manifest tổng chỉ chứa clip đã xong; chạy tiếp giữ nguyên số thứ tự; Dừng ghi đủ manifest.

## Chưa kiểm

Lượt chạy 300 prompt (dài nhất mới 30); Flow có giới hạn ảnh mỗi ngày hay không; phiên đăng nhập hết hạn giữa chừng; tab Chrome sập; kết quả "Lưu clip vào thư viện Flow"; WebM dự phòng; thấy tận mắt việc tự đổi model khi lỗi.

## Lưu ý khi dùng

- Thư viện Flow phình nhanh: chế độ 1 với 300 prompt thêm khoảng 750 mục (ảnh, 2 lớp parallax, ảnh sinh lại); các chế độ khác khoảng 300–330. Nên dùng một dự án Flow riêng.
- 300 clip 1080p cần ~2,8 GB ổ trống. Giữ tab Flow mở, tắt chế độ ngủ.
- Mỗi lượt nên đặt "Tên dự án" khác nhau (trùng tên thì Chrome thêm " (1)").
- Lần đầu chạy file thật nên là 50–100 prompt.

## Cấu trúc code (`tool-snapshots/effect-image/source`)

`types.ts`; `App.tsx` (ghép bố cục + state); `services/`: `promptParser`, `genQueue`, `effectDirector`, `layerService`, `motionEngine`, `overlays`, `exportService`, `downloadQueue`, `autoPilot` (đường ống dây chuyền, ước tính, lô, phục hồi), `chromaKey`, `mp4Encoder`, `platformTest`; `components/`: `Step1PromptInput`, `Step2ImageGen`, `Step3Effects`, `Step4Export`, `PreviewPlayer`, `AutoPilotPanel`, `VirtualList`, `PlatformTest`, `ui/*`.

## Prompt đã dùng để build (`flow-builder/prompts/effect-image/`)

| File | Nội dung |
|---|---|
| `p0`, `p0fix`, `p0fix2` | Khung giao diện + pha 0 kiểm tra nền tảng |
| `p1`, `p1fix`, `p1fix2` | Nhập prompt thông minh + hàng đợi sinh ảnh an toàn |
| `p2` | Bản gộp đợt 2 (~9.200 ký tự), builder báo lỗi đúng lúc Flow đang trục trặc (chưa rõ do kích thước hay do Flow), không dùng nguyên bản → chia thành `p2a` (máy quay, hiệu ứng phủ, xem trước), `p2b` (parallax), `p2c` (AI chọn hiệu ứng), `p2d` (dịch sát nghĩa, bàn phím, giả lập lỗi), rồi `p2fix` (AI chọn hiệu ứng gọi sai tham số) |
| `p3a`, `p3b`, `p3fix` | Bước 4 xuất video; chế độ tự động; tên file/manifest |
| `p4a`, `p4afix`, `p4b` | 4 chế độ + chạy bền; sửa lỗi build; giao diện 300+ mục, ước tính |
| `p5a`, `p5b`, `p5c` | Sửa lỗi đã đo; chống treo; tổng kết, nhắc nhở, ước tính |
| `p6a`, `p6b` | Khôi phục bước 3; hoàn thiện chế độ tự động |
| `p7a`, `p7b`, `p7c` | Manifest khi chạy dở; đa dạng máy quay, số lô; chỉnh ước tính |
| `p8`, `p9` | Khôi phục bước 4 thủ công; đồng hồ nghỉ theo mốc thời gian |

Dữ liệu thử: `test-data/prompts300.txt` (300 prompt dạng "N. nội dung", mỗi prompt thứ 10 có `--ar 9:16`), `test-data/test_prompts.txt` (4 prompt trộn nhiều kiểu định dạng). `prompts300.txt` có 8 prompt trùng nhau (do sinh ngẫu nhiên), tiện để thử nút "Xoá trùng".
