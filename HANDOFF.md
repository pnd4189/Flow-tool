# Handoff — các Flow Tool, cập nhật 2026-10-31

Chuyển giao việc xây Flow Tool từ project IdeaFlow sang project này. Đọc file này trước, rồi mở các file được liên kết khi cần.

## 1. Hiện có gì

Cả 5 tool nằm trong dự án Flow "Youtube studio" (`6c4180b7-8276-4ff6-aa71-0d0abbdcd3a6`). Code của chúng chỉ tồn tại trong Flow; `flow-tools/` là bản sao để đọc và sao lưu. URL mở tool: `https://flow.google.com/project/<project id>/tool/<tool id>?mode=EDIT` (dùng `mode=APP` để chạy).

| Tool | Tool id | Dùng để | Bản sao code |
|---|---|---|---|
| Effect-Image | `bf210f9d-931f-4d71-9d71-451672734a0c` | Nạp file prompt → sinh ảnh hàng loạt → AI chọn hiệu ứng máy quay/parallax/phủ → dựng MP4 → tải về. 4 chế độ tự động. 0 credit. Chi tiết: `flow-tools/effect-image/README.md` | `flow-tools/effect-image/source` |
| Long-Form AI Studio | `008c934c-cfac-4f75-ad99-c492960ce1ce` | Làm phim hoạt hình 2D từ nhiều cảnh 8 giây nối nhau (kịch bản tải lên hoặc AI viết, take/khoá/kiểm tra, bộ xuất cho hậu kỳ). Mặc định Omni 1.1 Flash. Chi tiết: `flow-tools/long-form-ai-studio/README.md` | `flow-tools/long-form-ai-studio/source` |
| Image to Video Studio | `88a10ec3-c82f-40ee-a0e3-4daa8d43bfe8` | Sinh ảnh hàng loạt + Video Studio (ảnh → video), bộ đếm sử dụng, trung tâm tải xuống, tự chọn ảnh, AI chấm ảnh. Chi tiết: `flow-tools/image-to-video-studio/README.md` | `flow-tools/image-to-video-studio/source` |
| Retouch Studio | `11f70fa9-de9d-4918-8c64-e8f4d9e77644` | Tải ảnh gốc, bấm chọn vùng, xóa/sửa bằng AI, nền ảnh, màu/nét, cắt/xoay/mở rộng khung, bảo vệ mặt, lịch sử và phiên JSON. Chi tiết và phạm vi đã kiểm: `flow-tools/retouch-studio/README.md` | `flow-tools/retouch-studio/source` |
| Character Sheet Studio | `7f6b7c90-d45c-47f1-be2d-4c440a467e09` | Tạo bảng thiết kế nhân vật (chân dung + góc toàn thân/góc mặt/biểu cảm) từ cấu hình hoặc ảnh khuôn mặt/trang phục; khoá khuôn mặt, tự kiểm tra chất lượng, biến thể, gói mô tả cho video. 0 credit. Chi tiết: `flow-tools/character-sheet-studio/README.md` | `flow-tools/character-sheet-studio/source` |

Định hướng của user: chỉ làm **hoạt hình 2D, không người thật**; loạt video dự kiến là truyện có lời dẫn về các phát minh kỳ lạ trong lịch sử. Ngân sách 6000 credit/tháng.

Ba tool đầu được chụp ngày 2026-10-30 lúc ~19:45. Retouch Studio được tạo sau đó trên Chrome profile pndhtcv; prompt và bằng chứng kiểm tra nằm trong `flow-tools/retouch-studio/prompts/`, `flow-tools/retouch-studio/test-results/` và `plans/20261030-2017-retouch-studio/plan.md`. Retouch nhận cả ảnh chụp và tranh 2D do user tải lên.

## 2. Bản đồ thư mục (phần mới thêm hôm nay)

```
HANDOFF.md                                    file này
flow-tools/_shared/builder-workflow.md        quy trình chat builder, mẹo kiểm thử, sự cố đã gặp
flow-tools/_shared/flow-platform-facts.md     sandbox, SDK, credit, giới hạn đã kiểm chứng
flow-tools/_shared/scripts/                   common.sh, send-watch.sh, extract-code.sh, verify-build.sh, check-snapshot.sh, các stub SDK
docs/research/                                bằng chứng về giới hạn ảnh/ngày (câu trả lời của Pi, trang Google lưu)
flow-tools/<tool>/README.md                   tài liệu của từng tool
flow-tools/<tool>/source/                     bản sao code (để đọc và sao lưu; không phải nơi build)
flow-tools/<tool>/prompts/                    mọi prompt đã gửi cho builder
flow-tools/<tool>/test-scripts/, test-data/   bài kiểm tra và file mẫu của tool đó
ai-studio-apps/                               app AI Studio, không phải tool Flow
archive/flow-tool-fixed/                      bản code đời đầu, chỉ để tra cứu
```

Các thư mục trong `ai-studio-apps/` và `archive/` là công việc đời đầu, không thuộc danh sách tool Flow đang dùng. Toàn bộ phần trước Retouch đã commit và push lên `origin/main`, commit cuối `8ef3059`. Phần Retouch mới cần xem `git status` để biết trạng thái lưu Git; không suy từ handoff cũ.

## 3. Bắt đầu một phiên làm việc

1. Mở Chrome với tab Flow của tool. Chrome sẽ hỏi cho phép kết nối gỡ lỗi (remote debugging) ở mỗi phiên mới; **user phải bấm Cho phép**, nếu chưa thì mọi lệnh bị từ chối.
2. Trong thư mục này:

```bash
export FLOW_TOOL_ID=bf210f9d-931f-4d71-9d71-451672734a0c   # id của tool đang làm
source flow-tools/_shared/scripts/common.sh
guard && echo OK                                           # chỉ chạy tiếp khi in OK
bash flow-tools/_shared/scripts/send-watch.sh <file prompt> "<vài từ cuối prompt>"
bash flow-tools/_shared/scripts/verify-build.sh <tool-slug>      # sau mỗi build: chụp code, so diff, tsc, bài kiểm tra
```

Mở tab tool trước bằng `agent-browser --auto-connect --pin-tab open <URL>`; `guard` từ chối mọi tab khác.

## 4. Những điều bắt buộc nhớ

- Tool chỉ sửa được qua chat builder; builder hay viết lại cả file và làm mất tính năng. Sau mỗi build phải so số dòng và kiểm tính năng (xem `flow-tools/_shared/builder-workflow.md`).
- Sandbox không có ZIP, `confirm/alert/prompt`, `localStorage` bền; ảnh/text miễn phí, video tốn credit (xem `flow-tools/_shared/flow-platform-facts.md`).
- Imagen **không** dùng được trong Flow; chỉ 3 model Nano Banana.
- Luôn kiểm tab bằng `guard` và dừng nếu không tìm ra ref (đã có sự cố điền nhầm vào tab khác).
- Retouch chọn vùng bằng SlimSAM WASM CPU vì Chrome hiện tại không có WebGL. Không quay lại MediaPipe chỉ vì ví dụ SDK nói có CPU fallback; các đường đó đã thử và lỗi thật. AI lỗi "hoạt động bất thường" thì giữ ảnh gốc, không lặp gọi dồn; tải lại trang bình thường đã khôi phục dịch vụ trong lần thử này.

## 5. Việc còn dở

1. Chạy thật Effect-Image với file 50–100 prompt trước, rồi mới 300 (dài nhất mới kiểm 30 prompt). Chưa kiểm: phiên đăng nhập hết hạn, tab sập, "Lưu clip vào thư viện Flow", WebM dự phòng, giới hạn ảnh/ngày của Flow.
2. Long-Form AI Studio chưa kiểm: mô hình Veo, 720p và clip 8–10 giây, bản Short 9:16, tạo bảng nhân vật, chất lượng lời đọc tiếng Việt; 4 sửa lỗi ở p7 đã có trong code nhưng chưa chạy lại.
3. Image to Video Studio chưa kiểm: Veo, 720p, clip 8/10 giây, 9:16 kèm cắt + `Flow.upload`, nhiều biến thể.
4. Đề xuất đã nêu nhưng user chưa quyết: thêm chế độ "chuyển động 0 credit" cho Long-Form (tái dùng máy quay/hiệu ứng phủ của Effect-Image); ghép hậu kỳ clip bằng ffmpeg/Remotion (dựng nặng chạy trên Colab theo quy tắc của user).
5. Retouch Studio đã sửa luồng thực hiện ngày 2026-10-31: nút Thực hiện cố định, chỉnh theo prompt/chỉnh dáng, vùng sửa quanh viền, khóa thao tác lúc cập nhật mask, ảnh tham chiếu sạch và chặn xuất nhầm ảnh chưa áp dụng. Source cuối 22 file sau `p14-preview-draft-types.txt`; module nắn eo mới và 7 bài kiểm tra canvas thật đã qua. Chỉnh dáng dùng nắn pixel cục bộ với thanh mức độ, vì hai thử AI chỉ đổi nếp áo quá nhẹ. Đã thử đúng ảnh chụp user cung cấp: chỉnh eo/bụng, tách nền alpha, đổi trời xanh; ảnh xuất 1920×2560, vùng mặt khóa giữ nguyên pixel. Xem `flow-tools/retouch-studio/README.md` và plan. Ảnh riêng/kết quả thử giữ ngoài Git; artifact ảnh trong `test-results/` vẫn chỉ là ảnh mẫu. Chưa kiểm toàn bộ chế độ trên mọi ảnh; tóc/cây tương phản cao có thể cần tinh chỉnh mask. TypeScript nội bộ và browser bundle qua; khai báo React/Flow SDK chưa được kiểm đầy đủ tại máy.

6. Ngày 2026-10-31 (chiều) đã sửa, chi tiết ở phần "Sửa…2026-10-31" trong từng `flow-tools/<tool>/README.md` và `plans/journals/2026-10-31-fix-policy-blocks-prompt-split-and-slimming.md`:
   - Ảnh bị chặn vì chính sách ở Image to Video/Effect-Image: lọc negative, rồi AI viết lại prompt.
   - Effect-Image tách sai số prompt (1200 → 120).
   - Long-Form: 20 lỗi soát code, chưa chạy render video thật.
   - Retouch: sửa nhanh 1 click, gọn mặt kiểu Face-Aware, bộ định tuyến yêu cầu.
7. Tối 2026-10-31:
   - Long-Form: đã render thật 1 shot (4 credit) và sửa nạp kịch bản dạng thường/1 khối.
   - Retouch: tự khoanh người nhiều điểm; gọn mặt an toàn với nhiều mặt; nhớ mốc nhận diện; thon thân dùng mặt nạ người.
   - Effect-Image: bỏ tiêu đề tài liệu khỏi danh sách prompt.
   - Có `verify-build.sh`/`check-snapshot.sh` và `test-scripts/*.test.ts` cho 3 tool.
   - Đêm 2026-10-31:
     - Sửa parallax không vào video xuất (Effect-Image).
     - Sửa chú thích nút (Image to Video).
     - Gọn mặt mượt trên tranh 2D, không chạm vai (Retouch).
     - Cả 4 tool 0 lỗi kiểu.
     - Nhánh lỗi render Long-Form kiểm bằng Flow giả lập.
   - Còn chưa kiểm hoặc chưa làm:
     - Long-Form timeout 900 s chạy thật.
     - MP4 có parallax xuất thật trên Flow.
     - Mặt tròn hoạt hình không vẽ miệng còn hơi phình quai hàm (xem `flow-tools/retouch-studio/README.md`).
8. 2026-11-02, tool mới **Character Sheet Studio** (xem `flow-tools/character-sheet-studio/README.md`): làm từ bài Facebook tham khảo, 30 prompt, 12 bài kiểm tra node, chạy thật 0 credit. Đã chạy thật cả 6 bố cục, khung 9:16 và 1:1, nút EN, và chạy thật chính tool mẫu (nạp vào dự án trống tạm đã xoá, điền mã kích hoạt đang hiện sẵn trên màn hình theo đồng ý của user) để so: 11 lần của nó, 18 lần của tool này, cùng model, 0 lỗi mỗi bên. **Ảnh ngang nhau; 1 ảnh tốc độ ngang nhau (~28 s); 3 ảnh một lần bấm: tool này ~28 s, tool mẫu ~84 s** (sau khi đổi sang hiện ảnh ngay, chấm chất lượng nền, tạo song song). So sánh lộ ra bố cục B kém (1/2 so với 4/4 của mẫu), mặc định ngầm, trang phục bị trộn với bộ mẫu, chân dung không có áo, kiểm tra chất lượng làm chậm ảnh đầu, bố cục E và F sai (E 1/3, F 0/6, nay 6/6 cả hai sau khi nêu rõ số lượng và điều cấm trong câu mô tả). Thêm tuỳ chọn "chọn bản tốt nhất trong K bản thử" (mặc định tắt): đo thật K=3 nâng điểm khớp mặt ~5 điểm nhưng chậm gấp ~3,5, nên chỉ dùng khi cần; đều đã sửa. Còn chưa kiểm hoặc chưa làm: vòng viết lại prompt khi bị chặn chính sách (Flow không chặn khi thử, mới kiểm bằng Flow giả lập), điểm QC ít phân hoá, tạo từng góc rồi ghép bằng canvas, tạo hàng loạt từ danh sách nhân vật.

## 6. Dọn dẹp

- Đã xoá 131 file thử trong `~/Bản tải về` (giải phóng 789 MB).
- Ảnh/video thử còn trong thư viện dự án "Youtube studio". Tool không xoá được.
- Ngày 2026-10-31, mục thử SCENE 900/901 (prompt máu me và người nổi tiếng) và 4 ảnh/video cáo của lần render thử Long-Form đã được chuyển vào Thùng rác qua menu "Tuỳ chọn khác" của từng mục. Chỉ xoá mục mà tìm kiếm trả đúng 1 kết quả khớp tên, vì thư viện lẫn ảnh KTT thật của user.

## 7. Project cũ

IdeaFlow (`/home/dung/VIBE_CODING/1. OTHERS/IdeaFlow`) là project khác, không liên quan và không bị sửa gì trong công việc này.
