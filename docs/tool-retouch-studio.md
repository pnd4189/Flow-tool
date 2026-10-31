# Retouch Studio

Tool mới trong dự án Flow **Youtube studio**, id `11f70fa9-de9d-4918-8c64-e8f4d9e77644`.

- Dùng: https://flow.google.com/project/6c4180b7-8276-4ff6-aa71-0d0abbdcd3a6/tool/11f70fa9-de9d-4918-8c64-e8f4d9e77644?mode=APP
- Builder: cùng URL với `mode=EDIT`.
- Source sao lưu: `tool-snapshots/retouch-studio/source/`.
- Prompt đã gửi: `flow-builder/prompts/retouch-studio/`.
- Kế hoạch và bằng chứng: `plans/20261030-2017-retouch-studio/plan.md`, `tool-snapshots/retouch-studio/test-results/`.

## Cách dùng

1. **Thêm ảnh** PNG/JPEG/WebP từ máy. Ảnh chụp và tranh 2D đều được; giữ nguyên kích thước nguồn.
2. Bấm vật thể, chọn vùng nhỏ/vừa/lớn phù hợp. Dùng Thêm/Bớt hoặc cọ để sửa vùng, nới vùng chọn và làm mềm viền. Khi xóa vật thể, chọn cả viền và bóng đổ.
3. Trong **Xóa & sửa**, mặc định là **Chỉnh theo prompt**; nhập yêu cầu rồi bấm nút **Thực hiện** ở chân bảng. Khi chỉnh eo/bụng, chọn **Chỉnh dáng / thon gọn**, khoanh vùng thân và bấm **Mở vùng chỉnh dáng** để lấy cả viền áo và một ít nền; chỉnh thanh **Độ thu gọn eo** rồi thực hiện. Phần trăm trong ghi chú chỉnh dáng đồng bộ vào thanh trượt; yêu cầu tự do khác dùng **Chỉnh theo prompt**. Các tab **Nền**, **Màu & nét**, **Bố cục** có thao tác riêng.
4. Tool hiển thị tiến trình và lỗi thật. Kết quả mới là **Bản xem trước — chưa áp dụng**: so sánh rồi chọn **Áp dụng vào ảnh** hoặc **Hủy**. Có thể tải riêng bản xem trước; xuất/lưu ảnh đã nhận bị chặn khi còn bản xem trước để tránh tải nhầm ảnh cũ. Có hoàn tác/làm lại.
5. Xuất PNG trong suốt hoặc JPEG có màu lót nền. **Lưu phiên** ra JSON trước khi tải lại tab; **Mở phiên** khôi phục ảnh và mặt nạ, bắt đầu lịch sử mới.

## Cơ chế và giới hạn

- Chọn vật thể dùng SlimSAM chạy WASM CPU qua Transformers.js 3.8.1, model revision `5850ab45f587c112167512ffef949107115e26a0`. Tải mô hình lần đầu, tái dùng embedding cho cùng ảnh/revision. Chrome hiện tại không có WebGL; các đường MediaPipe đã thử đều không chạy ổn định, nên không dùng.
- Khóa mặt mặc định bật. AI thị giác tìm mặt, kết hợp vùng đầu từ mô hình chọn vật thể để tránh giữ cả một vành nền cũ. Hiển thị mặt nạ thật; người dùng có thể bổ sung bằng cọ. Phát hiện mặt có thể bỏ sót, đặc biệt tranh vẽ, góc khó hoặc nhiều người; cần xem lại vùng bảo vệ.
- Chỉnh vùng bằng AI dùng tham chiếu ảnh gốc rồi ghép **chỉ vùng được phép sửa** vào ảnh hiện tại. Vùng bảo vệ được chép nguyên RGBA. Giữ phong cách gốc; không tự chuyển 2D thành ảnh thật.
- **Chỉnh theo prompt** dùng ảnh tham chiếu sạch cùng tọa độ vùng sửa; không gửi lớp màu hướng dẫn để tránh AI vẽ nét đánh dấu lên ảnh. Những chế độ xóa/thay vật thể vẫn dùng ảnh nguồn và hướng dẫn. Số pixel thay đổi đo từ kết quả ghép, không phải bằng chứng rằng AI đã hiểu đúng yêu cầu; vẫn cần xem ảnh.
- **Chỉnh dáng / thon gọn** nắn pixel cục bộ ở độ phân giải gốc, có thanh mức độ 0–30%; không sinh lại mặt hoặc nếp vải bằng AI. Biến đổi giảm dần về biên vùng chọn, giữ nguyên pixel ngoài vùng và trong mặt nạ bảo vệ. Nội suy có xét alpha; ánh xạ giữ thứ tự cả ở mức tối đa.
- Chỉnh màu, nền đơn/gradient/nền tải lên, làm mờ và hình học xử lý bằng canvas. Nền trong suốt là alpha thật. PNG giữ được phép so pixel; JPEG là nén mất dữ liệu.
- Chất lượng AI không được bảo đảm chỉ bằng prompt. Có thể còn mép, bóng cũ, hoặc sai chi tiết; phải chọn đủ vùng và xem trước. Đánh giá AI chỉ tham khảo; nếu phân tích lỗi thì hiển thị chưa xác định, không bịa điểm đạt.
- Flow có thể từ chối lời gọi vì hoạt động bất thường, hạn mức hoặc chính sách. Giữ ảnh gốc và báo lỗi thật; tải lại trang bình thường đã khôi phục được một lần trong QA. Không vượt cơ chế xác minh của Google.
- Hủy sẽ bỏ kết quả; yêu cầu đang chạy có thể vẫn hoàn tất và lưu vào thư viện Flow. Không có API xóa media từ tool.
- Phiên JSON giới hạn 50 MB; mở rộng khung giới hạn 16 MP. Không lưu bền bằng localStorage, không ZIP, không API key ngoài.

## Đã kiểm thực tế

- Chọn vùng trên ảnh chân dung, tái dùng embedding, xuất cutout PNG 512×512: 252.913 pixel trong suốt, 9.231 pixel giữ lại khớp RGBA hoàn toàn.
- Đổi nền đen trên chân dung: vùng mặt kiểm tra không đổi; hoàn tác khôi phục toàn bộ ảnh gốc, làm lại khôi phục đúng bản đổi nền.
- Chỉnh sáng có khóa mặt: ảnh 512×512 và 1800×1200 giữ nguyên kích thước xuất, vùng mặt kiểm tra có 0 pixel đổi.
- Chỉnh vùng AI trên tranh 900×600: phần nhân vật ngoài vùng sửa khớp toàn bộ; đánh giá AI báo đúng khi chọn sai vùng hoặc còn mép/bóng.
- Xóa balo cùng bóng bằng vùng cọ mở rộng: kết quả 900×600 không còn vật thể/bóng; toàn bộ phần nhân vật bên trái khớp pixel gốc.
- Xoay 90° ra 600×900 và cắt 510×510: khớp từng pixel với phép biến đổi chuẩn trên ảnh mẫu.
- Lưu/mở phiên sau xoay: ảnh hiện tại, mặt nạ chọn và mặt nạ bảo vệ khớp hoàn toàn; kích thước đúng.
- Mở rộng AI 900×600 → 1200×800, neo giữa (150,100): toàn bộ 540.000 pixel gốc có 0 sai lệch trong ảnh xuất.
- Thay nền AI cho nhân vật 2D: xuất 900×600, vùng mặt kiểm tra có 0 sai lệch.
- Điều khiển nền khôi phục đầy đủ: nhập HEX `#123456` cho pixel nền đúng RGBA (18,52,86,255); ảnh nền riêng 600×900 được Cover vào 900×600, vùng mặt kiểm tra không đổi.
- PNG tách nền ở bản cuối có 467.197 pixel alpha=0; JPEG cùng ảnh ra RGB 900×600 và lót trắng ở phần trong suốt.
- File phiên có kích thước không hợp lệ bị từ chối, ảnh hiện tại còn nguyên. Tải lại Flow, mở phiên đã lưu và xuất PNG: ảnh khớp toàn bộ bản trước tải lại.
- Bản bàn giao ban đầu gồm 21 file TS/TSX, browser bundle qua với 0 cảnh báo. Phần sửa ngày 2026-10-31 bổ sung module nắn eo, tổng 22 file; xem kết quả kiểm tra cuối bên dưới.

Chưa kiểm kỹ: ảnh 4K/16 MP, tóc/lông phức tạp, vật trong suốt, nhiều khuôn mặt/góc nghiêng khó, mọi giá trị của bộ lọc và mọi chế độ AI trên ảnh thật. Các kết quả trên không bảo đảm mọi ảnh đều đạt ngay một lần. Bằng chứng ảnh mẫu và số đo nằm trong `test-results/`; ảnh riêng của user được lưu ngoài Git.

## Sửa luồng thực hiện và kiểm ảnh thật — 2026-10-31

- Thêm nút **Thực hiện** cố định, mặc định chỉnh theo prompt, chế độ chỉnh dáng và mở vùng quanh viền cơ thể. Có tiến trình thật, lỗi lưu trên bảng, đo pixel thay đổi và chặn xuất ảnh cũ khi chưa áp dụng kết quả mới.
- Sửa cuộc đua mở vùng chọn/chạy AI: khóa thao tác trước khi lưu lịch sử bất đồng bộ. Bấm nhanh đã được thử lại: nút chạy bị vô hiệu hóa trong lúc cập nhật vùng và không bắt đầu yêu cầu với mặt nạ cũ.
- Kiểm ảnh chụp user cung cấp, kích thước 1920×2560: chỉnh eo/bụng bằng chế độ chỉnh dáng, tách người ra PNG trong suốt, thay trời xám bằng trời xanh có mây. Đã mở và kiểm ảnh xuất thật; ảnh riêng được giữ ngoài Git.
- Hai bản chỉnh dáng bằng AI đổi nhiều pixel nhưng chủ yếu đổi nếp áo, chưa thu eo đủ rõ; không xem chúng là bằng chứng đạt yêu cầu. Đã chuyển chế độ thon gọn sang nắn pixel cục bộ: thử mức 20% xử lý 119 ms, thay đổi đường viền thật và 931.113 pixel. Bản đổi trời đổi 1.830.671 pixel. Cả hai giữ nguyên toàn bộ 81.360 pixel vùng mặt được khóa.
- PNG tách nền có 4.173.863 pixel alpha=0; toàn bộ 728.440 pixel hoàn toàn đục giữ nguyên RGB nguồn. Vùng mặt khóa giữ nguyên RGBA.
- Bản xem trước chỉnh dáng và ảnh đã áp dụng/xuất khớp hoàn toàn. Hoàn tác sau đổi trời khôi phục đúng ảnh nguồn, làm lại khôi phục đúng bản đổi trời. Nút thực hiện vẫn nhìn thấy ở viewport 1328×567; prompt trống bị chặn với lý do rõ ràng.
- Kiểm tra TypeScript phát hiện biến tham chiếu chưa khai báo và năm kiểu trả về nền thiếu revision. Đã sửa: preview nháp dùng kiểu không có revision, helper thêm revision đã chụp trước khi nhận kết quả; không nới lỏng hợp đồng preview đã nhận. Kiểm tra kiểu nội bộ qua trên 22 tệp và browser bundle qua, 0 cảnh báo; khai báo module React/Flow SDK chưa được kiểm tra đầy đủ tại máy.

- Bảy bài kiểm tra trên canvas thật của Chrome qua: kích thước/nguồn bất biến, bảo toàn vùng khóa/ngoài chọn, đếm pixel, không gấp ảnh ở mức tối đa, đường viền hẹp đi thật, mép alpha không tối và từ chối đầu vào không hợp lệ. Bài kiểm tra: `tool-snapshots/retouch-studio/test-scripts/body-reshape-browser-probe.js`; bundle dạng IIFE bằng esbuild rồi chạy `RetouchReshapeProbe.runBodyReshapeChecks()` trong Chrome. Không mock canvas hoặc SDK.

Thanh phần trăm là cường độ nắn ảnh, không phải phép đo vòng eo. Mức lớn có thể uốn nền trong vùng chọn; cần xem trước và chọn mức phù hợp. Mép tóc/cây tương phản cao có thể cần tinh chỉnh mặt nạ. Không suy từ ba phép thử này rằng mọi chế độ đều đã được kiểm lại trên ảnh thật.

Ảnh kết quả riêng của user đã lưu tại `My Drive/2. test/Ảnh/retouch-studio-results-20261031/`: `thon-eo-20.png`, `xoa-nen.png`, `doi-bau-troi.png`. Ảnh gốc không bị ghi đè. Thư mục này ở Drive, không nằm trong repository.

## Sửa thon gọn thật — 2026-10-31 (`p15-real-slimming`)

- Lỗi user gặp: gõ "chỉnh bụng gọn lại" ở chế độ mặc định thì yêu cầu đi đường AI, mà AI chỉ đổi nếp áo. Thuật toán nắn cũ ép mạnh ở giữa vùng chọn, giảm về 0 ở mép, nên đường viền thân gần như không dịch (`thon-eo-20.png` gần như không khác ảnh gốc).
- Thuật toán mới: khung của vùng chọn là thân, thân co đều về giữa; dải nền rộng 30% bề rộng thân ở hai bên giãn ra lấp chỗ trống, kể cả pixel ngoài vùng chọn. Vùng bảo vệ giữ nguyên. Yêu cầu chứa bụng/eo/thon/béo/slim… ở chế độ prompt tự chuyển sang nắn dáng, và lấy luôn số N% trong prompt. Không cần bước "Mở vùng chỉnh dáng". Mặc định 15%.
- Đã chạy thật trên ảnh 1920×2560 của user: chọn "Vùng lớn", gõ "chỉnh bụng gọn lại 20%", xử lý 178 ms; thân và bụng gọn thấy rõ, lõi vùng mặt 0 pixel đổi. File thử `belly_da_nhan_1920x2560.png` nằm trong `~/Bản tải về`.

## Sửa nhanh 1 click, gọn mặt và bộ định tuyến — 2026-10-31 (`p16`–`p22`)

- **Thẻ "Sửa nhanh 1 click"** (đầu tab Xóa & sửa), tất cả là thuật toán, không AI sửa ảnh: Tự động làm đẹp ảnh (giãn mức sáng, cân bằng trắng, gamma, mặt khoá), Gọn mặt (0–15%, mặc định 12%), Thon gọn thân (tự dựng khung thân từ mặt nếu chưa chọn vùng), Làm mờ phông, Tách nền, Làm nét nhẹ, Giảm nhiễu.
- **Gọn mặt kiểu Face-Aware Liquify.** AI chỉ trả mốc khuôn mặt (sống mũi, mép má, mắt, cằm, khoé miệng); phần nắn là thuật toán. Chỉ nắn viền má/hàm từ dưới mắt tới cằm. Lõi quanh sống mũi rộng ít nhất 0.65×nửa mặt, mở tới khoé miệng + đệm, chép nguyên pixel; đổi dù 1 pixel lõi thì huỷ thao tác.
- **Bộ định tuyến** (`services/requestRouter.ts`): gõ yêu cầu → so nguyên từ tiếng Việt có dấu, tách vế theo dấu phẩy/"và" → chạy thuật toán tương ứng; câu không khớp thì hỏi AI phân loại; chỉ việc vẽ/xoá/thay vật mới gửi AI sửa ảnh (khoá mặt bắt buộc). Gọn mặt chỉ chạy khi câu có từ chỉ mặt, kể cả khi AI phân loại.
- **Lỗi đã sửa trong lúc làm:**
  - So chuỗi bỏ dấu làm "chỉnh bụng…" kích hoạt gọn mặt ("chinh" chứa "chin").
  - Xem trước loại màu của nút 1 click khi Áp dụng/Tải bị tính lại từ thanh trượt đang bằng 0 nên không đổi gì.
  - Khoé miệng bị nắn khi đầu nghiêng.
  - Builder đổi nhầm tên trường chẩn đoán.
- **Đã kiểm trên ảnh thật 1920×2560:**
  - Gọn mặt 12%: miệng và mũi 0 pixel đổi, viền hàm hẹp rõ.
  - "chỉnh bụng nhân vật gọn lại" khi chưa chọn vùng: thân gọn, vùng mặt 0 pixel đổi.
  - Tự động làm đẹp: bản xem trước và ảnh đã áp dụng giống nhau, mắt/miệng 0 pixel đổi.
  - Bộ định tuyến đúng 15/15 câu thử (chạy bằng node).
  - `test-scripts/body-reshape-browser-probe.js` đã viết lại theo thuật toán mới và thêm 4 bài cho gọn mặt: 12/12 đạt trên canvas thật của Chrome. Bundle bằng esbuild với `--alias:flow-sdk=<stub>` vì faceSlimService có import SDK.
- **Chưa kiểm thật (cập nhật ở mục dưới):** mặt góc nghiêng mạnh, tranh 2D.

## Tự khoanh người và ảnh nhiều mặt — 2026-10-31 (`p23`–`p24d`)

- **Tự khoanh người khi chưa chọn vùng** (Làm mờ phông, Tách nền). Bản cũ chấm 1 điểm ở ngực nên SlimSAM bỏ sót chân và bàn tay phải, hai chỗ đó bị làm mờ như phông. Bản mới: `services/personPointsService.ts` hỏi AI 4–6 điểm nằm trong thân (ngực, bụng, hai đùi, hai bắp tay). Tất cả điểm vào một lần giải mã SlimSAM (`segmentCandidatesAtPoint(..., extraPoints)`). Chọn mặt nạ chứa nhiều điểm nhất, dưới 85% ảnh, diện tích đếm trên độ phân giải gốc. AI lỗi thì quay về cách 1 điểm.
- **Gọn mặt khi có nhiều mặt.** Bản cũ kéo giãn dải nền tới 1.45×nửa mặt mà không biết mặt khác, nên chạm má/tai người bên cạnh, kể cả ở chế độ "mặt lớn nhất". Bản mới truyền mọi mặt khác vào `applyFaceSlim(..., otherFaces)`. Dải nắn dừng trước mép mặt khác, có nới thêm 0.2×bề rộng mặt cho tai/tóc. Nếu một bên má không đủ chỗ thì bỏ qua cả mặt đó để mặt không lệch. Tất cả mặt bị bỏ qua thì báo lỗi rõ ràng.
- **Lỗi builder bắt được khi soát diff:**
  - Lại đổi tên trường chẩn đoán (`p24b`, tsc báo TS2353).
  - Nhánh bỏ qua mặt trả canvas trước khi `putImageData`, nên đường gõ prompt ra ảnh trống (`p24d`; bài kiểm tra "mặt sát nhau" bắt được).
- **Đã kiểm thật trên Flow:**
  - Làm mờ phông khi chưa chọn vùng: hai chân, hai tay, hai bàn tay đều nét; hoa giữa hai chân mờ đúng.
  - Tách nền khi chưa chọn vùng: cắt sạch đủ người.
  - Ảnh hai người cách nhau: mặt được chọn gọn 22.860 px, mặt kia 0 px đổi.
  - Ảnh hai người áp má nhau: từ chối an toàn.
  - Ảnh một người: vẫn gọn bình thường.
- **Bộ kiểm tra trên Chrome:** 15/15 đạt. Có bài đối chứng: không truyền mặt bên cạnh thì đầu người kia bị đổi, truyền vào thì không; mặt sát nhau thì ảnh giữ nguyên.
- **Còn chưa kiểm:** mặt nghiêng mạnh, tranh 2D. Ảnh nhiều người thật (không phải ảnh ghép) mới thử bằng ảnh ghép từ ảnh của user.

## Nhớ mốc nhận diện và khoanh thân — 2026-10-31 tối (`p25`)

- **Nhớ kết quả AI theo từng canvas.** Mốc khuôn mặt và điểm thân được lưu theo đối tượng canvas: mỗi lần áp dụng chỉnh sửa tạo canvas mới, nên không bao giờ dùng nhầm kết quả cũ. Lỗi thì xoá khỏi bộ nhớ, điểm thân rỗng thì không lưu.
- **Đo thật trên ảnh 1920×2560:**
  - Lần đầu (Thon gọn thân) 25 s.
  - Sau đó Làm mờ phông 3 s (trước 16–20 s), Tách nền 3 s, Gọn mặt 2 s.
  - Log ghi "Dùng lại mốc khuôn mặt đã nhận diện cho ảnh này".
- **Thon gọn thân khi chưa chọn vùng** dùng mặt nạ người tự khoanh (`autoSelectPersonMask`, chuyển sang `personPointsService.ts`), cắt theo dải từ cằm+0.1D tới cằm+6D. Lỗi hoặc mặt nạ dưới 2% ảnh thì quay về khung chữ nhật cũ.
  - So trên ảnh của user: bề rộng thân sau khi thon y hệt cách cũ (ví dụ 577 → 490 px).
  - Tâm người lệch 1,5 px so với ảnh gốc, cách cũ lệch 7,5 px.
  - Mặt 0 px đổi.
- **Bài kiểm tra:** probe Chrome 15/15; `request-router.test.ts` chạy bằng `check-snapshot.sh`.

## Gọn mặt trên tranh 2D — 2026-10-31 đêm (`p26`, `p27`)

- **Lỗi trên tranh 2D:**
  - Mặt tròn hoạt hình bị lõm khấc ở má và vai áo bị kéo méo.
  - Nguyên nhân thứ nhất: lượng nắn cũ hình chóp, mạnh nhất đúng tại mép má AI đo (`d = F`). Hàng nào viền thật trùng F thì bị kéo nhiều nhất, viền thành hình chữ S.
  - Nguyên nhân thứ hai: dải dọc kéo tới cằm+0.35D nên trúng vai khi cổ ngắn.
- **Thuật toán mới (`p26`):**
  - Lượng nắn trơn `srcD = d + A·P(d)`, với `P = smoothstep(Cc, 0.9F, d)·(1 − smoothstep(b, c, d))` và `c = 1.8F`, thu ngắn khi có mặt người bên cạnh.
  - Mạnh nhất ở quai hàm: `vy` tăng từ mắt+0.12D tới cằm−0.3D, tắt hẳn ở cằm+0.05D.
  - Mặt người bên cạnh vẫn 0 px; không đủ chỗ (`c < 1.2F`) thì bỏ qua cả mặt.
- **`p27`:** dặn AI đặt cằm ở đáy hình mặt kể cả khi tranh không vẽ miệng. Log chẩn đoán ghi "Mốc mặt N: …" để thấy AI đo sai chỗ nào. Trên tranh hoạt hình, cằm AI đặt từ quá cao thành y=546 (thật 545).
- **Bài kiểm tra Chrome (17/17):** thêm "viền mặt tròn phải lồi đều" và "dưới cằm không đổi". Cả hai trượt với thuật toán cũ, đạt với thuật toán mới.
- **Đã kiểm thật trên Flow:**

  | Ảnh | Kết quả |
  |---|---|
  | Ảnh của user | 26.388 px viền, môi/mũi/mắt 0 px đổi |
  | Ảnh ghép 2 người cách nhau | người bên cạnh 0 px đổi |
  | Tranh KTT "Man explaining occult phenomenon" (3 mặt, 1 mặt gần quay nghiêng hẳn), chế độ "Mặt lớn nhất" | chỉ mặt giữa đổi |
  | Cùng tranh, chế độ "Tất cả mặt" | cả 3 gọn tự nhiên |
  | Tranh hoạt hình | hết khấc, vai 0 px đổi |

- **Giới hạn còn lại:** mặt tròn hoạt hình không vẽ miệng vẫn hơi phình ở quai hàm sát cằm. Ở đó viền mặt nằm sát vùng lõi 0.65F được bảo vệ, nên ít được nắn. Thu hẹp lõi dưới môi (đã thử bằng numpy) không đổi được kết quả. Muốn khắc phục phải ước lượng độ thon của mặt theo từng hàng; chưa làm.
