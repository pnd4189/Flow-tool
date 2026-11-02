# Character Sheet Studio (Xưởng Thiết Kế Nhân Vật)

- Dùng: https://flow.google.com/project/6c4180b7-8276-4ff6-aa71-0d0abbdcd3a6/tool/7f6b7c90-d45c-47f1-be2d-4c440a467e09?mode=APP
- Tool id `7f6b7c90-d45c-47f1-be2d-4c440a467e09`, dự án "Youtube studio". Tạo ngày 2026-11-01/02 qua builder.
- Làm từ một bài Facebook của Phúc Anh Mrt (nhóm "Cộng đồng Claude AI Việt Nam") giới thiệu tool mẫu "Xưởng Bảng Nhân Vật", cộng 3 ảnh chụp màn hình tool mẫu. Bài viết được lấy bằng Pi CLI (`search-gw`); chỉ xem ảnh và mô tả của tool mẫu, không nạp hay sao chép tool đó vào dự án.

## Làm gì

Tạo **bảng thiết kế nhân vật** (character sheet) cho phim và hoạt hình: một ảnh có chân dung lớn và các góc toàn thân (trước, nghiêng, sau), có thể kèm góc mặt hoặc biểu cảm. Dùng được ảnh khuôn mặt thật hoặc ảnh trang phục của user làm tham chiếu. Ảnh miễn phí (0 credit).

## So với tool mẫu

| Tool mẫu | Tool này |
|---|---|
| 6 mục cấu hình, chip tóm tắt, VI/EN | Có đủ; chip bấm nhảy tới mục, tên chip dịch theo ngôn ngữ |
| Tải ảnh mặt, "khoá khuôn mặt" | Tải tới 3 ảnh hoặc chọn từ thư viện Flow; AI mô tả khuôn mặt (sửa được), tự điền giới tính/độ tuổi theo ảnh; mức giống Cách điệu / Cân bằng / Rất giống; tóc, biểu cảm có tuỳ chọn "theo ảnh gốc" |
| Ảnh trang phục | Tải tới 4 ảnh, AI mô tả trang phục (sửa được) |
| Phong cách 2D hoặc ảnh thật | 8 phong cách |
| Góc mặt thêm | 6 bố cục (A–F) theo hướng khung ảnh; 5 tỉ lệ khung |
| Lịch sử | Lịch sử, yêu thích, xoá 2 bước, tải về, tải lại |
| — | **Biến thể từ ảnh đã chọn**: đổi trang phục, tóc, biểu cảm, phông nền mà giữ nguyên nhân vật |
| — | **Tự kiểm tra chất lượng** (chữ lọt vào ảnh, đủ số góc nhìn, khớp khuôn mặt) và tạo lại tối đa 2 lần; huy hiệu điểm trên mỗi ảnh |
| — | Tự dịch các ô tiếng Việt sang tiếng Anh trước khi tạo; tự viết lại prompt khi bị Flow chặn (2 vòng) |
| — | Trình xem: phóng to/kéo, toàn màn hình, so sánh 2 ảnh |
| — | Lưu và mở phiên làm việc (JSON); **Gói nhân vật** (.txt) có đoạn `CHARACTER:` dán vào prompt video |
| — | Nhật ký chẩn đoán (từng lệnh gọi Flow, thời gian, lỗi gốc) |

## Số đo thật (2026-11-02, Nano Banana Pro)

- Tạo 1 bảng: ~28 s, thêm ~4 s dịch và ~8 s kiểm tra chất lượng. Khoá khuôn mặt từ ảnh: ~16 s. Phân tích trang phục: ~6 s.
- Prompt gửi Flow phải **dưới khoảng 3.400 ký tự**: prompt 3.097 ký tự chạy được, 4.190 và 4.300 ký tự bị từ chối sau vài mili giây với thông báo chung "Dịch vụ tạo hình ảnh không hoạt động". Bộ dựng prompt có hạn mức 3.400 và tự cắt phần phụ.
- Ảnh tham chiếu qua `Flow.upload` (JPEG) rồi `referenceImageMediaIds` chạy được; ảnh của chính tool (mediaId của lần tạo trước) dùng làm tham chiếu cho Biến thể cũng chạy được.
- Chất lượng: ảnh phụ nữ trung niên (ảnh công khai NASA) ở mức "Rất giống" ra nhân vật 2D giữ đúng tóc nâu xoăn ngắn, nụ cười, tuổi; biến thể đổi sang vest công sở giữ cùng khuôn mặt và nốt ruồi.

## Cấu trúc

`source/` (40 file): `App.tsx`, `types.ts`, `constants.ts`; `services/` (`promptBuilder`, `generation`, `safety`, `translate`, `refImages`, `faceDna`, `referencePipeline`, `referenceIds`, `qc`, `variant`, `session`, `pack`, `viewport`, `configRules`, `diagnostics`, `imageUtils`, `i18n`); `hooks/` (`useGeneration`, `useReferences`); `components/` (6 mục cấu hình, chip, trình xem, lịch sử, biến thể, nhật ký…).

`prompts/` có 30 prompt đã gửi builder theo thứ tự `p0` → `p3r`. `test-scripts/` có 12 bài kiểm tra chạy bằng node:

```bash
bash flow-tools/_shared/scripts/check-snapshot.sh flow-tools/character-sheet-studio
```

Tool này bật `strictNullChecks` (file `test-scripts/strict-null-checks`). Bài `source-lint` bắt: API bị cấm trong sandbox, đọc state qua hàm cập nhật setState, chuỗi rẽ nhánh ngôn ngữ trong component.

## So sánh trực tiếp với tool mẫu chạy thật (2026-11-02)

Cách đo (hai đợt, mỗi đợt dùng một dự án trống tạm, đã xoá): nạp tool mẫu vào dự án tạm, điền mã kích hoạt đang hiện sẵn trên màn hình (theo đồng ý của user), rồi chạy cùng tài khoản, cùng model Nano Banana Pro, 16:9, 1 ảnh mỗi lần, chỉ ảnh (0 credit). Ba cấu hình lấy từ 3 ảnh chụp: nam 2D cardigan đỏ rượu (A), nữ 60 tuổi ảnh thật cardigan navy (C), nam ảnh thật măng tô xám (B).

| | Tool mẫu | Tool này (bản cuối) |
|---|---|---|
| Số lần chạy | 11 (A 3, B 4, C 2, 3 ảnh 2) | 18 (A 8, B 6, C 2, 3 ảnh 2) |
| Lỗi giữa chừng | 0 | 0 |
| 1 ảnh: từ bấm đến có ảnh | 27 đến 33 s, trung bình ~29,6 s (9 lần) | 25,4 / 28,1 / 29,2 s, trung bình ~27,6 s (3 lần); huy hiệu chất lượng đến sau ~35 đến 38 s, chạy nền |
| 3 ảnh một lần bấm: ảnh đầu / đủ 3 ảnh | 29,7 / 84,1 s và 27,5 / 84,5 s (tuần tự, ~28 s mỗi ảnh) | 27,7 / 30,2 s và 27,2 / 27,2 s (song song, đủ 3 ảnh gần bằng thời gian 1 ảnh) |
| 4 ảnh một lần bấm: ảnh đầu / đủ 4 ảnh | chưa đo | 28,4 / 29,2 s và 27,0 / 28,6 s (không lỗi; đủ 4 ảnh gần bằng thời gian 1 ảnh) |
| Đúng bố cục | 9/9 (lần 3 ảnh không xét) | 13/13 trên bản cuối (riêng B ban đầu chỉ 1/2, xem dưới) |
| Chất lượng ảnh | Ngang nhau, không bên nào rõ ràng đẹp hơn | |

Nói thẳng: với 1 ảnh, **tốc độ ngang nhau** (tool này nhỉnh ~2 s, trong khoảng nhiễu của phép đo); khác biệt thật nằm ở **nhiều ảnh một lần: ~28 s so với ~84 s** (nhanh gấp ~3), và ở chỗ kiểm tra chất lượng không còn làm chậm ảnh đầu. **Ảnh không đẹp hơn.** Bản đầu của tool này chậm hơn mẫu ~6 đến 9 s vì kiểm tra chất lượng chạy trước khi hiện ảnh; đã đổi thành hiện ảnh ngay rồi chấm nền. Trên giao diện thật, tool mẫu có: 6 mục, 3 phong cách, 4 bố cục, 5 tỉ lệ, 3 model, tải ảnh mặt và ảnh trang phục, 5 bộ trang phục gợi ý cộng tự nhập, lịch sử, tải xuống, phóng to, VI/EN, nút xin ủng hộ. Không thấy trên giao diện của nó: kiểm tra chất lượng, biến thể, lưu/mở phiên, gói nhân vật, xem prompt, so sánh hai ảnh, nhật ký chẩn đoán. Tool này có đủ các mục đó, cộng 8 phong cách, 6 bố cục, mô tả khuôn mặt/trang phục từ ảnh, mức giống khuôn mặt, tự dịch ô tiếng Việt và tự viết lại prompt khi bị chặn.

Việc đặt hai bên cạnh nhau lộ ra các điểm yếu của tool này, đã sửa và có test:

- Bố cục B chỉ đúng 1/2 lần (3 ảnh góc mặt bị vẽ chồng lên chân dung) trong khi tool mẫu đúng 4/4. Nguyên nhân: câu mô tả không nói 3 ảnh góc mặt nằm ở đâu. Nay ghi rõ "hàng trên là 3 góc mặt cạnh nhau, hàng dưới là 3 góc toàn thân, không ô nào chồng lên ô khác": 6/6 lần đúng (4 ảnh thật, 2 anime).
- Mặc định ngầm: tool luôn mang sẵn nốt ruồi, kính, vai trò "Kỹ sư công nghệ & Thám tử tự do" (model vẽ thêm chiếc cặp), ghi chú "tỷ lệ đầu 7.5, viền nét 2px" (chỉ hợp 2D, rơi cả vào ảnh thật), áo techwear và bảng màu neon. Nay các ô đều rỗng, không phụ kiện.
- Trang phục gõ tay bị trộn với bộ mẫu: mặc định là streetwear, nên cardigan đỏ rượu từng bị vẽ chồng hoodie đen, quai balo và quần túi hộp. Nay bộ mặc định là "Tự miêu tả tùy chỉnh" (gõ gì vẽ nấy); với bộ mẫu khác, câu trong prompt là "chỗ nào mâu thuẫn thì chỉ vẽ phần mô tả này". Ép streetwear rồi gõ cardigan, chạy 3 lần: 2 sạch, 1 còn dây đeo tiện ích của streetwear. Mẫu quá nhỏ để nói thành tỉ lệ.
- Kiểm tra chất lượng chạy TRƯỚC khi hiện ảnh (+~8 s) và nhiều ảnh chạy tuần tự (3 ảnh ~100 s). Nay ảnh hiện ngay khi tạo xong, chấm chất lượng và tạo lại (nếu cần) chạy nền, huy hiệu "…" đổi thành điểm khi xong; nhiều ảnh chạy song song (không lỗi ở 3 ảnh). Logic nằm trong `services/takePipeline.ts` và có bài test riêng. Chỉ áp dụng cho lần tạo chính; luồng Biến thể vẫn chấm trước khi hiện.
- Chân dung bố cục A, B chỉ có đầu và cổ nên mất trang phục trong cận cảnh; nay là "đầu và vai, thấy cổ áo và phần áo trên".

## Độ đúng của từng bố cục (ảnh thật, Nano Banana Pro, 16:9)

Đếm bằng mắt trên ảnh thật, mỗi ảnh là một lần tạo:

| Bố cục | Đúng bố cục (bản cuối) | Trước khi sửa |
|---|---|---|
| A chân dung + 3 góc toàn thân | 13/13 | |
| B + 3 góc mặt | 6/6 | 1/2 (3 ảnh góc mặt vẽ chồng lên chân dung) |
| C + 4 biểu cảm | 2/2 | chỉ 2 góc toàn thân |
| D 5 góc toàn thân | 3/3 (QC đếm 5/5) | chưa kiểm hàng loạt |
| E 3 ảnh bán thân | 6/6 | 1/3 (2/3 vẽ thừa một người toàn thân, QC vẫn đếm 3/3 nên không bắt được) |
| F lưới 6 biểu cảm | 6/6, đúng 2 hàng x 3 cột | 0/6 (luôn vẽ 7 đến 8 ô) |

Cả ba lần sửa (B, E, F) đều là sửa câu mô tả: nêu rõ vị trí từng ô, số lượng chính xác và điều cấm ("không ô nào chồng lên ô khác", "không có người toàn thân", "không ô thứ bảy hay thứ tám"). Ở E, hai trong sáu ảnh vẽ phần bán thân như tượng cắt rời, đúng số lượng nhưng hơi lạ. QC hiện đếm số hình chứ không phân biệt toàn thân hay bán thân, nên ca "thừa người toàn thân" ở E chỉ được bắt nhờ câu mô tả, chưa nhờ QC.

## Chọn bản tốt nhất trong K bản thử (tuỳ chọn, mặc định tắt)

Ở mục 6, cạnh "Số lần tạo lại tối đa": đặt K từ 1 đến 4. Với K lớn hơn 1, tool tạo K ảnh cùng lúc, chấm chất lượng từng ảnh và chỉ giữ ảnh tốt nhất (ảnh không dính cờ lỗi thắng trước, rồi tới điểm; khi có ảnh tham chiếu thì điểm khớp khuôn mặt được ưu tiên). Logic nằm trong `runBestOf` và `rankCandidate` của `services/takePipeline.ts`, có test riêng.

Đo thật (ảnh nữ phi hành gia NASA làm tham chiếu, 2D, mức Rất giống, điểm khớp mặt do chính QC chấm trên thang 0 đến 100):

| | Điểm khớp mặt | Thời gian một ảnh |
|---|---|---|
| K=1, 6 ảnh độc lập | 58, 62, 58, 62, 62, 65 (trung bình 61,2) | ~35 s |
| K=3, 3 lần chọn | tool giữ 65, 68, 65 (trung bình 66); các ứng viên 63/62/65, 52/68/68, 52/65/65 | 120 đến 128 s |

Nói thẳng: **lợi ích nhỏ** (khoảng +5 điểm trên thang QC, 3 lần chọn so với 6 ảnh lẻ, điểm do chính model chấm nên có phần vòng vo) và **đắt về thời gian** (chậm gấp ~3,5, không phải "20 đến 40 s" như dòng gợi ý đầu tiên ghi; đã sửa). Dùng khi cần một ảnh thật giống và chấp nhận chờ. Điểm QC tổng chỉ dao động 68 đến 76 nên phần chọn chủ yếu loại ảnh dính cờ lỗi và chọn ảnh khớp mặt hơn. Chưa kiểm K=2 và K=4.

## Khoá khuôn mặt: so trực tiếp với tool mẫu (2026-11-02)

Cách đo: một ảnh chân dung AI (người nữ khoảng 60 tuổi, tóc đen dài gợn sóng, do chính tool này sinh ra, không phải người thật; user đồng ý tích ô xác nhận của tool mẫu), cùng ảnh thật, nữ, 1 ảnh mỗi lần. Tool mẫu: 3 lần, 26 đến 28 s mỗi ảnh, giữ đúng người lớn tuổi 3/3 (có thêm hoa tai không có trong ảnh gốc). **Lần chạy thứ 3 của tool mẫu thất bại một lần** với thông báo của Flow "Chúng tôi nhận thấy có hoạt động bất thường nào đó" (tool chỉ có nút "Thử lại", bấm thì ra ảnh sau 26 s); đây là lỗi duy nhất trong 14 lần chạy của tool mẫu, tool này chưa gặp lỗi nào ở các lần chạy khác, cỡ mẫu quá nhỏ để nói tỉ lệ.

Tool này lần đầu: 2/3 ảnh giống ảnh gốc, **1/3 ra người trẻ hơn rõ rệt** (QC vẫn chấm khớp mặt 74, tức điểm khớp mặt của QC không đáng tin để đo độ giống). Nguyên nhân: kết quả phân tích khuôn mặt (giới tính, nhóm tuổi) chỉ được áp vào cấu hình khi bấm "Khoá khuôn mặt"; bấm tạo thẳng thì prompt vẫn ghi tuổi mặc định "young adult in 20s, age 24". Đã sửa (`applyFaceDnaToConfig`, có test): khi tạo từ ảnh, giới tính và nhóm tuổi theo phân tích ảnh. Sau khi sửa: **6/6 ảnh đều là người lớn tuổi giống ảnh gốc**. Nhược điểm còn lại: nơ cổ của ảnh gốc lọt sang 2/6 ảnh dù trang phục gõ là áo măng tô xanh rêu và áo len kem, nghĩa là ảnh khuôn mặt còn kéo theo một phần quần áo.

Vì điểm khớp mặt của QC không phân biệt được người trẻ với người lớn tuổi, phép đo "chọn bản tốt nhất" ở trên (+5 điểm) chỉ mang tính tham khảo yếu.

## Bài học khi làm tool này

- Bắt buộc có **nhật ký chẩn đoán** sớm: lỗi "không hoạt động" chung chung chỉ lộ nguyên nhân (prompt quá dài, nhanh 9 ms) khi nhìn số liệu từng lệnh gọi.
- Ô tiếng Việt chèn vào prompt dưới dạng "ghi chú" bị model **vẽ thẳng vào ảnh**; chữ "Director notes", "Identifying marks" là thủ phạm. Dịch sang tiếng Anh dạng mô tả hình ảnh và để câu "không chữ" ở cuối prompt.
- Builder đã tự gây ra: đọc state qua hàm cập nhật setState (nút khoá khuôn mặt luôn lỗi), chuyển `images` ra đối số thứ 3 của `Flow.generate.text` (ảnh không được gửi), bản sao câu "không chữ" trùng lặp. Cả ba bị `tsc` hoặc bài kiểm tra bắt. Lần khác builder tự sửa thêm một dòng ngoài yêu cầu (`isNaN(g)` thành `isNaN(r)` trong `describeHairColor`); bài kiểm tra mới bắt được, nên **luôn diff bản vừa trích với bản trước** và gửi yêu cầu sửa đúng một dòng.
- Tính năng chỉ chạy qua một nút (khoá khuôn mặt) mà đường tạo thẳng bỏ qua là loại lỗi khó thấy: README từng ghi "tự điền độ tuổi theo ảnh" trong khi tạo thẳng không làm vậy. Nên kiểm cả hai đường (bấm khoá rồi tạo, và tạo thẳng) bằng ảnh thật.
- Khi điều khiển bằng agent-browser, `fill @ref ""` **không xoá** được ô nhập của React (state vẫn giữ chữ cũ). Dùng click, `Control+a`, `Backspace`. Suýt kết luận nhầm là tool giữ mặc định.

## Đã kiểm thật thêm (2026-11-02)

- **Cả 6 bố cục A–F đã chạy thật** (Nano Banana Pro, 38–80 s): C (đã sửa sau lần đầu chỉ ra 2 góc toàn thân) có chân dung, 3 góc toàn thân và 4 biểu cảm, kiểm chất lượng đếm đủ 8/8 hình, D có 5 góc toàn thân, E có chân dung 3/4 cùng mặt trước và nghiêng, F có lưới 6 biểu cảm. Lúc đó F bị model vẽ thừa hình (xem "Độ đúng của từng bố cục" bên dưới, đã sửa).
- **Khung dọc 9:16 và vuông 1:1** (bố cục A) ra đúng cách xếp theo hướng khung (chân dung phía trên, 3 góc toàn thân phía dưới). 4:3 và 3:4 chưa chạy.
- **Nút EN**: toàn bộ nhãn, nút và thanh công cụ đổi sang tiếng Anh.
- **Phân tích trang phục** từ ảnh: 6,4 s; ảnh trang phục dùng làm tham chiếu cho kết quả giống áo gốc.

## Giới hạn đã biết

- **Vòng viết lại prompt khi Flow chặn chính sách chưa chạy thật trong tool này.** Đã thử gõ đúng các từ từng làm Flow chặn oan ("no nudity, no gore or blood, no celebrity face"): Flow không chặn, ảnh ra bình thường. Chặn không có tính xác định và không nên cố ép bằng nội dung nhạy cảm. Vòng này được kiểm bằng Flow giả lập (`generation.test.ts`); cùng thiết kế chạy thật 10/10 ở Effect-Image.
- **Điểm QC ít phân hoá**: qua 10 lần chấm, điểm nằm trong khoảng 68–74 dù ảnh khác chất lượng. Phần có ích là các cờ riêng (chữ trong ảnh, số góc nhìn, bố cục, khớp mặt) quyết định tạo lại; điểm số mới chỉ là chỉ báo thô.
- **Cỡ mẫu của phép so sánh nhỏ** (11 lần của tool mẫu, 18 lần của tool này): đủ để thấy hai bên ngang nhau về lỗi và bố cục, chưa đủ để nói tỉ lệ lỗi thấp tới mức nào hay nhỉnh ~2 s ở 1 ảnh có ổn định không (2 lần ở chế độ 3 ảnh cho cùng kết quả ~28 s so với ~84 s). Tạo song song chạy được không lỗi ở 3 và 4 ảnh (mỗi mức 2 lần); chưa biết Flow có giới hạn số lệnh song song khi dùng nhiều tab hay nhiều người cùng lúc. Khi tạo song song, mỗi lệnh chấm chất lượng chậm hơn (11 đến 34 s thay vì ~8 s), nên huy hiệu đến muộn hơn (52 đến 63 s ở bố cục F có tạo lại).
- **Nhánh tạo lại ở cơ chế mới đã chạy thật** (bố cục F, 3 ảnh x 2 lần): nhật ký ghi `qc.retry` cho cả 3 ảnh với lý do "Layout composition incorrect" và "Quality score below threshold (58 < 65)", QC đếm 7 đến 8 hình thay vì 6. Tạo lại tối đa 2 lần không cứu được vì lỗi nằm ở câu mô tả bố cục F (đã sửa ngay sau đó, xem dưới); tool giữ bản tốt nhất và gắn huy hiệu đỏ 58, không huy hiệu nào bị treo.
- **Khoá khuôn mặt chỉ đo được phía tool này**: cùng một ảnh nữ phi hành gia (ảnh công khai NASA), 3 lần tạo 2D ở mức Cân bằng (2 lần) và Rất giống đều giữ tóc nâu sáng ngắn, nụ cười, mắt nâu, nét tuổi trung niên, bỏ đồ phi hành gia và phông nền; 26 đến 53 s. Phía tool mẫu chưa đo được vì nó đòi tích ô "Tôi xác nhận đây là ảnh của tôi hoặc người đã đồng ý cho sử dụng" và đó là lời xác nhận của user, tôi không tích hộ với ảnh người thật. Cấu hình ảnh 2 trên tool mẫu dùng tóc "Ngang vai mái thưa" (cú chọn "Dài uốn sóng" không ăn), khác tóc dài gợn sóng của tool này, nên ảnh không giống hệt về tóc.
- Bài Facebook chỉ đọc được phần xem không đăng nhập: nội dung bài và 13 trong 42 bình luận. Pi CLI đọc bài; opencode báo "Reconnect OpenCode Console" (cần user đăng nhập lại) nên không dùng được. Pi không đọc 3 ảnh; ảnh do mình xem trực tiếp.
- Chưa kiểm: nhiều khuôn mặt trong một ảnh tham chiếu; Lưu/Mở phiên với phiên có ảnh khuôn mặt.
- Chưa làm: tạo từng góc rồi ghép lại bằng canvas (chính xác hơn, chậm hơn), tạo hàng loạt từ danh sách nhân vật.
