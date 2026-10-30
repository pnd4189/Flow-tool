# Handoff — các Flow Tool đã build ngày 2026-10-30

Chuyển giao việc xây Flow Tool từ project IdeaFlow sang project này. Đọc file này trước, rồi mở các file được liên kết khi cần.

## 1. Hiện có gì

Cả 3 tool nằm trong dự án Flow "Youtube studio" (`6c4180b7-8276-4ff6-aa71-0d0abbdcd3a6`). Code của chúng chỉ tồn tại trong Flow; `tool-snapshots/` là bản sao để đọc và sao lưu. URL mở tool: `https://flow.google.com/project/<project id>/tool/<tool id>?mode=EDIT`.

| Tool | Tool id | Dùng để | Bản sao code |
|---|---|---|---|
| Effect-Image | `bf210f9d-931f-4d71-9d71-451672734a0c` | Nạp file prompt → sinh ảnh hàng loạt → AI chọn hiệu ứng máy quay/parallax/phủ → dựng MP4 → tải về. 4 chế độ tự động. 0 credit. Chi tiết: `docs/tool-effect-image.md` | `tool-snapshots/effect-image/source` |
| Long-Form AI Studio | `008c934c-cfac-4f75-ad99-c492960ce1ce` | Làm phim hoạt hình 2D từ nhiều cảnh 8 giây nối nhau (kịch bản tải lên hoặc AI viết, take/khoá/kiểm tra, bộ xuất cho hậu kỳ). Mặc định Omni 1.1 Flash. Chi tiết: `docs/tool-long-form-ai-studio.md` | `tool-snapshots/long-form-ai-studio/source` |
| Image to Video Studio | `88a10ec3-c82f-40ee-a0e3-4daa8d43bfe8` | Sinh ảnh hàng loạt + Video Studio (ảnh → video), bộ đếm sử dụng, trung tâm tải xuống, tự chọn ảnh, AI chấm ảnh. Chi tiết: `docs/tool-image-to-video-studio.md` | `tool-snapshots/image-to-video-studio/source` |

Định hướng của user: chỉ làm **hoạt hình 2D, không người thật**; loạt video dự kiến là truyện có lời dẫn về các phát minh kỳ lạ trong lịch sử. Ngân sách 6000 credit/tháng.

Cả 3 bản sao code đã chụp lại ngày 2026-10-30 lúc ~19:45 và khớp với bản đang chạy trên Flow.

## 2. Bản đồ thư mục (phần mới thêm hôm nay)

```
HANDOFF.md                         file này
docs/flow-platform-facts.md        sandbox, SDK, credit, giới hạn đã kiểm chứng
docs/builder-workflow.md           quy trình làm tool bằng chat builder, mẹo kiểm thử, sự cố đã gặp
docs/tool-effect-image.md          tài liệu Effect-Image
docs/tool-long-form-ai-studio.md   tài liệu Long-Form AI Studio
docs/tool-image-to-video-studio.md tài liệu Image to Video Studio
docs/research/                     bằng chứng về giới hạn ảnh/ngày (câu trả lời của Pi, trang Google lưu)
flow-builder/scripts/              common.sh, send-watch.sh, send-prompt.sh, extract-code.sh, tooltext.py
flow-builder/prompts/<tool>/       mọi prompt đã gửi cho builder (+ sdk-qa/: hỏi đáp về SDK)
tool-snapshots/<tool>/source       bản sao code
tool-snapshots/effect-image/       test-data/ (file 300 prompt mẫu) và test-scripts/
```

Các thư mục có từ trước (`ai-batch-image-generator-and-editor`, `flow-tool-fixed`, `veo-director-full-source`, `plans/`) là công việc đời đầu, mình không đụng tới. Mọi thứ trong thư mục này **chưa commit** vào git.

## 3. Bắt đầu một phiên làm việc

1. Mở Chrome với tab Flow của tool. Chrome sẽ hỏi cho phép kết nối gỡ lỗi (remote debugging) ở mỗi phiên mới; **user phải bấm Cho phép**, nếu chưa thì mọi lệnh bị từ chối.
2. Trong thư mục này:

```bash
export FLOW_TOOL_ID=bf210f9d-931f-4d71-9d71-451672734a0c   # id của tool đang làm
source flow-builder/scripts/common.sh
guard && echo OK                                           # chỉ chạy tiếp khi in OK
bash flow-builder/scripts/send-watch.sh <file prompt> "<vài từ cuối prompt>"
bash flow-builder/scripts/extract-code.sh <thư mục đích>   # chụp code sau mỗi build
```

Mở tab tool trước bằng `agent-browser --auto-connect --pin-tab open <URL>`; `guard` từ chối mọi tab khác.

## 4. Những điều bắt buộc nhớ

- Tool chỉ sửa được qua chat builder; builder hay viết lại cả file và làm mất tính năng. Sau mỗi build phải so số dòng và kiểm tính năng (xem `docs/builder-workflow.md`).
- Sandbox không có ZIP, `confirm/alert/prompt`, `localStorage` bền; ảnh/text miễn phí, video tốn credit (xem `docs/flow-platform-facts.md`).
- Imagen **không** dùng được trong Flow; chỉ 3 model Nano Banana.
- Luôn kiểm tab bằng `guard` và dừng nếu không tìm ra ref (đã có sự cố điền nhầm vào tab khác).

## 5. Việc còn dở

1. Chạy thật Effect-Image với file 50–100 prompt trước, rồi mới 300 (dài nhất mới kiểm 30 prompt). Chưa kiểm: phiên đăng nhập hết hạn, tab sập, "Lưu clip vào thư viện Flow", WebM dự phòng, giới hạn ảnh/ngày của Flow.
2. Long-Form AI Studio chưa kiểm: mô hình Veo, 720p và clip 8–10 giây, bản Short 9:16, tạo bảng nhân vật, chất lượng lời đọc tiếng Việt; 4 sửa lỗi ở p7 đã có trong code nhưng chưa chạy lại.
3. Image to Video Studio chưa kiểm: Veo, 720p, clip 8/10 giây, 9:16 kèm cắt + `Flow.upload`, nhiều biến thể.
4. Đề xuất đã nêu nhưng user chưa quyết: thêm chế độ "chuyển động 0 credit" cho Long-Form (tái dùng máy quay/hiệu ứng phủ của Effect-Image); ghép hậu kỳ clip bằng ffmpeg/Remotion (dựng nặng chạy trên Colab theo quy tắc của user).

## 6. Dọn dẹp

- Đã xoá 131 file thử trong `~/Bản tải về` (giải phóng 789 MB).
- Ảnh/video thử còn trong thư viện dự án "Youtube studio". Tool không xoá được; user tự chuyển vào Thùng rác trong Flow.

## 7. Project cũ

IdeaFlow (`/home/dung/VIBE_CODING/1. OTHERS/IdeaFlow`) là project khác, không liên quan và không bị sửa gì trong công việc này.
