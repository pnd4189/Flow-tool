# Quy trình làm tool bằng chat builder của Flow

Rút ra từ 3 tool đã làm (Image to Video Studio, Long-Form AI Studio, Effect-Image). Thông số nền tảng nằm ở `flow-platform-facts.md`.

## Nguyên tắc

1. Tool chỉ sửa qua chat "Trình tạo công cụ" (chế độ "Chỉnh sửa"). Mình không đụng vào code trực tiếp được.
2. Builder là AI: viết code nhanh nhưng hay sai và hay làm mất tính năng. Mọi bản build đều phải **đọc code và chạy thử thật** trước khi tin.
3. Bản sao code trong `tool-snapshots/` chỉ để đọc và sao lưu; sửa ở đó không làm gì cả.

## Vòng làm việc

1. **Kiểm chứng nền tảng trước khi thiết kế (pha 0).** Nhờ builder dựng một bảng thử nhỏ chạy các phép thử thật (tên model ảnh nào chạy, mã hoá MP4 có chạy không, tách lớp, nhìn ảnh bằng AI…). Ở Effect-Image nhờ bước này mới biết Imagen không dùng được và MP4 mã hoá được ngay trong tool. Mẫu: `flow-builder/prompts/effect-image/p0.txt`.
2. **Viết prompt nhỏ, một nhóm tính năng mỗi lần.** Mỗi prompt dưới ~5.000 ký tự cho dễ kiểm. Prompt 9.200 ký tự (p2) bị builder báo lỗi, nhưng một prompt 1.500 ký tự gửi ngay sau đó cũng lỗi rồi treo 23 phút, nên đó là trục trặc phía Flow chứ chưa chắc do kích thước; sau khi tải lại trang, các bản chia nhỏ p2a–p2d đều build trong 1,5–2,5 phút. Mỗi prompt nên có:
   - tên file nào được tạo/sửa, và câu "giữ nguyên phần còn lại, **chỉ sửa đúng chỗ nêu, không viết lại file**";
   - ràng buộc sandbox (không `confirm/alert/prompt`, không `<a download>`, không `localStorage`, không ZIP);
   - số liệu cụ thể (ngưỡng, thời gian chờ, tên file mẫu) thay vì mô tả chung chung;
   - mục "KIỂM TRA" cuối cùng: làm gì thì thấy gì.
3. **Gửi và chờ** bằng `send-watch.sh` (báo khi builder treo). Bản build thường mất 1–3,5 phút.
4. **Sau mỗi build:**
   - Tool còn chạy không? Nếu hiện "Không chạy được công cụ", đọc lỗi ở "View error details" (ví dụ `The character ">" is not valid inside a JSX element` hay `subjectCutoutDataUrl is not defined`). Nút đỏ "Sửa lỗi" tự gửi lỗi cho builder nhưng có lần sửa trượt (ReferenceError); khi đó tìm đúng dòng trong tab "Mã" và gửi prompt sửa đúng 1 dòng đó.
   - Chạy `FLOW_TOOL_ID=<id> flow-builder/scripts/verify-build.sh <tool-slug>`: chụp code, liệt kê file đổi kèm số dòng, kiểm tra kiểu (tsc) và chạy `test-scripts/*.test.ts` của tool. Builder hay tự đổi tên trường, xoá chú thích, quên bước ghi canvas; tsc và bài kiểm tra bắt được, đọc tóm tắt của builder thì không. Đọc diff rồi mới chép code vào `tool-snapshots/<slug>/source`.
   - Chụp code bằng `extract-code.sh`, so **số dòng từng file** với lần trước và `grep` các tính năng chủ chốt. Builder đã nhiều lần viết lại cả file và âm thầm mất tính năng: bộ nhận dạng prompt mất bước bỏ cờ Midjourney; Step3Effects từ 1382 xuống 594 dòng, Step4Export từ 978 xuống 406 dòng khi thêm danh sách ảo hoá.
5. **Chạy thử thật, ưu tiên cách 0 credit.** Ảnh và text miễn phí; video tốn credit nên thử bản rẻ nhất và báo user số credit đã tốn.
6. **Đừng chỉ đếm file.** Mở file manifest/kết quả kiểm nội dung. Các lỗi nặng của Effect-Image chỉ lộ ra khi đọc nội dung: manifest tổng ghi cả prompt chưa chạy (chạy tiếp sẽ bỏ sót), prompt vẫn còn cờ `--v 6 --style raw`, tab dừng nhưng clip cuối không vào manifest.

## Khi builder trục trặc

- Báo "Đã xảy ra lỗi" trong vài giây, hoặc chỉ hiện 3 chấm quá ~5 phút (bình thường 1–3,5 phút): bấm Dừng, **tải lại trang tool**, đợi ~15 giây, gửi lại. Cách này đã cứu 2 lần. Nếu muốn phân biệt lỗi do Flow hay do prompt quá lớn, gửi thử một prompt nhỏ.
- Menu "Trình đơn gỡ lỗi" của builder chỉ giả lập lỗi cho tin nhắn gửi builder, không ảnh hưởng lời gọi `Flow.generate.*` trong tool. Muốn thử lỗi lúc chạy phải làm bảng giả lập lỗi ngay trong tool (đã có ở Effect-Image: `inject-fault.sh`). Để menu ở "None (real BE)".
- Lỗi build hay gặp: ký tự `>` hoặc `<` trần trong chữ JSX; tên biến viết tắt sai trong object; icon Material Symbols không tồn tại (hiện thành chữ).

## Điều khiển Chrome an toàn

- Dùng `agent-browser --auto-connect --pin-tab`. Mỗi phiên Chrome mới phải duyệt kết nối gỡ lỗi (remote debugging) một lần; khi chưa duyệt, mọi lệnh báo "Chrome is waiting for remote-debugging approval" và các script dừng thay vì chạy bừa.
- **Luôn kiểm tra URL của tab đang gắn trước mỗi lần điền hoặc bấm** (`guard` trong `common.sh`). Sự cố đã xảy ra: tab Vercel OAuth cướp tab hiện hành và chữ đã được điền vào ô Email của Vercel (chưa bấm nút nào, đã xoá).
- **Dừng nếu không tìm ra ref.** `fill "@"` với ref rỗng ghi vào ô đang focus. Từng có 4 prompt bị dán nhầm vào ô chat builder; đã xoá sạch trước khi gửi.
- Đừng khớp chữ không phân biệt hoa thường với "dừng": trúng cả "Tạm dừng". Nút Dừng của Effect-Image cần bấm hai lần liên tiếp.

## Mẹo kiểm thử

- Chụp màn hình khi iframe khác origin: đặt `document.documentElement.style.zoom='0.55'` (trên trang Flow), chụp, rồi trả về `''`.
- Thẻ chọn chế độ không phải `button`: `scrollintoview` nút Chạy, rồi `mouse move/down/up` theo toạ độ nhìn trên ảnh chụp.
- Nạp file vào tool: `frame @<ref iframe>` → `upload 'input[type="file"][multiple]' file...` → `frame main`.
- Thử tab chạy nền: `tab new about:blank`, đo bằng thư mục tải về (`watch-downloads.sh`), xong `tab close` rồi `tab t<id>` để gắn lại tab Flow.
- Sau khi tải lại trang, tool cần ~15 giây mới sẵn sàng; chờ ô nhập của tool xuất hiện (`wait-tool-textbox.sh`) rồi mới điền.
- Xoá file thử trong `~/Bản tải về` khi xong (đã xoá 131 file ngày 2026-10-30).

## Trước khi giao một tool dài hơi

- Chạy một lượt dài vừa đủ (30+ prompt) với tab nền, không chỉ vài prompt.
- Thử các đường lỗi: lỗi tạm thời nhiều lần liên tiếp, hết hạn mức, bấm Dừng giữa chừng, chạy tiếp sau khi dừng.
- Kiểm tra ước tính thời gian bằng số đo thật (từng lệch gần 2 lần).
- Nói rõ cho user phần nào đã chạy thật, phần nào chưa.

## Bảng script (`flow-builder/scripts/`)

| Script | Việc |
|---|---|
| `common.sh` | Nạp bằng `source`. Gắn `agent-browser` vào một tab, `guard` từ chối tab khác, `ref` lấy ref từ snapshot. Cần `FLOW_TOOL_ID`. |
| `send-watch.sh <file> <vài từ cuối prompt>` | Gửi prompt cho builder, chờ xong; báo lỗi (4) hoặc treo (5). Cách dùng chính. |
| `send-prompt.sh <file> <vài từ đầu prompt>` | Như trên nhưng tự bấm "Thử lại" khi builder báo lỗi; không phát hiện được treo. |
| `extract-code.sh <thư mục>` | Chụp toàn bộ code từ tab "Mã" về thư mục (giữ thư mục con). |
| `tooltext.py <snapshot>` | Rút chữ trong iframe của tool từ một snapshot. |
| `verify-build.sh <tool-slug>` | Sau mỗi build: chụp code vào `$FLOW_WORK/verify/<slug>`, so với bản trong repo, rồi chạy `check-snapshot.sh`. Không sửa repo. Cần `FLOW_TOOL_ID`. |
| `check-snapshot.sh <thư mục tool>` | Kiểm tra kiểu `source/` (stub cho react, flow-sdk, JSX) và chạy từng `test-scripts/*.test.ts` bằng node qua esbuild. Lỗi kiểu có sẵn từ trước ghi ở `test-scripts/tsc-known-errors.txt` được bỏ qua, chỉ lỗi mới làm trượt. Lần đầu `npx` tải typescript 5.9.3 và esbuild 0.27.0. |

Script riêng cho Effect-Image nằm ở `tool-snapshots/effect-image/test-scripts/`.

Bài kiểm tra của từng tool (`tool-snapshots/<slug>/test-scripts/`):
- Effect-Image `prompt-parser.test.ts`: đếm prompt trên các file mẫu ở `test-data/`, gồm 10 cảnh KTT dạng `--- SCENE ---` và file KTT_T04 120 cảnh nếu ổ Drive có gắn.
- Long-Form `script-import.test.ts`: tách shot và lời thoại khi nạp kịch bản.
- Retouch `request-router.test.ts`: câu yêu cầu tiếng Việt chạy đúng thuật toán, mặt chỉ bị sửa khi câu nhắc tới mặt.
- Retouch `body-reshape-browser-probe.js`: cần canvas thật nên chạy trong một tab `about:blank` của Chrome, không chạy bằng node. Bundle bằng esbuild `--format=iife --global-name=RetouchReshapeProbe --alias:flow-sdk=flow-builder/scripts/flow-sdk-stub.js`, rồi `eval` gọi `RetouchReshapeProbe.runBodyReshapeChecks()`. Dùng phiên agent-browser `flow-builder`: mở phiên mới sẽ làm Chrome hiện hộp hỏi quyền. Sau `tab close` phải `tab t2` để gắn lại tab Flow.
