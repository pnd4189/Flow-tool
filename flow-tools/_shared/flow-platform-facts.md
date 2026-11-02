# Flow Tool — những điều đã kiểm chứng về nền tảng

Ghi ngày 2026-10-30 (một phần từ 2026-10-29), từ các phép thử thật trên tài khoản Ultra của user. Mục nào ghi "chưa kiểm" là chưa chạy thật.

## Flow Tool là gì

- Mini app chạy trong iframe trên flow.google.com, dùng SDK `flow-sdk` (`import { Flow } from 'flow-sdk'`). Chạy bằng gói Google của user, không cần API key.
- Code của tool nằm trong Flow, không nằm trong repo. Cách duy nhất để sửa là chat "Trình tạo công cụ" ở chế độ "Chỉnh sửa". Tab "Mã" chỉ đọc.
- Dự án Flow dùng để làm việc: "Youtube studio", id `6c4180b7-8276-4ff6-aa71-0d0abbdcd3a6`. Mọi ảnh/video sinh ra đều tự lưu vào thư viện dự án; tool không xoá được, user phải tự chuyển vào Thùng rác.

## Giới hạn của sandbox (iframe)

- Cờ sandbox: `allow-same-origin allow-scripts allow-forms allow-popups`. Không có `allow-downloads` và `allow-modals`:
  - không dùng `window.confirm/alert/prompt` (xác nhận bằng nút 2 bước "bấm lần nữa để xác nhận", 3 giây);
  - không dùng `<a download>` hay blob để tải.
- Tải file chỉ qua `Flow.download({ base64, mimeType, filename })`. Danh sách cho phép: `image/*`, `video/mp4`, `video/webm`, audio, `text/plain`, `text/markdown`, `text/csv`, `application/json`; đuôi file phải khớp mime. **Không có ZIP** (kể cả ZIP 1 ảnh bị từ chối). Tải hàng loạt = tải tuần tự từng file (đang để cách nhau 1,2 s). File về `~/Bản tải về`; lần đầu Chrome có thể hỏi cho phép tải nhiều tệp.
- Trạng thái không sống qua lần tải lại: origin của iframe đổi ngẫu nhiên mỗi lần, nên `localStorage` luôn trống. Muốn giữ trạng thái phải xuất/nhập file JSON.
- iframe khác origin: `agent-browser eval` không chạm vào được bên trong. Vẫn dùng được `frame @<ref iframe>` + `upload` vào ô nhập file ẩn (đã kiểm).
- Không có API cho: số dư credit, số ảnh đã tạo trong ngày, đổi tên/xoá media, Scenebuilder, kéo dài video, seed, negative prompt. Số dư thật chỉ xem được ở menu tài khoản trên trang Flow (chụp màn hình; chữ không có trong snapshot).
- Chrome giãn `setInterval` khi tab chạy nền quá ~5 phút (còn khoảng 1 lần/phút; suy từ cách Chrome hoạt động, chưa đo riêng). Vòng lặp dùng `await` thì không bị chậm: 30 prompt chạy với tab ẩn 10 phút vẫn ~20 giây/clip. Đồng hồ đếm ngược phải tính theo mốc thời gian (`Date.now()`), không đếm số nhịp.
- `navigator.wakeLock` có thể bị từ chối trong iframe này (suy luận, chưa kiểm). Nhắc user tắt chế độ ngủ của máy.
- Phiên Chrome profile pndhtcv dùng cho Retouch Studio trả `null` cho cả WebGL1/WebGL2. MediaPipe phân vùng không chạy được kể cả một số đường CPU vì vẫn cần dịch vụ GPU; đây là trạng thái môi trường này, không phải giới hạn mọi tài khoản Flow. SlimSAM qua Transformers.js/ONNX WASM CPU một luồng đã chạy thật trong tool; xem `tool-retouch-studio.md`.

## SDK đã dùng

- `Flow.generate.image({ prompt, modelDisplayName, aspectRatio, referenceImageMediaIds? })` → `{ base64, mimeType, mediaId }`. 0 credit. `aspectRatio`: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`. Truyền 1 ảnh gốc làm tham chiếu (tối đa 10) kèm prompt mô tả thay đổi = chỉnh sửa ảnh. Ảnh 16:9 ra 1376×768, không đúng 1920×1080.
- Model ảnh hợp lệ: `🍌 Nano Banana 2.1` (~23 s), `🍌 Nano Banana Pro` (~25 s), `🍌 Nano Banana 2 Lite` (~12 s). **Imagen không dùng được**: `Imagen 4`, `Imagen 4 Ultra`, `Imagen 4 Fast`, `Imagen 3`, `🖼️ Imagen 4` đều bị từ chối dưới 1 giây với "Dịch vụ tạo hình ảnh không hoạt động". Google đã ngừng Imagen giữa 2026.
- `Flow.generate.text(prompt, { systemInstruction, thinkingLevel, images, videos, audios })` → `{ text }`. 0 credit. Đã dùng để dịch prompt, chấm điểm ảnh (nhìn ảnh, ~9 s), tách prompt, chọn hiệu ứng.
- `Flow.upload({ base64, mimeType, name })`: `image/png`, `image/jpeg`, `video/mp4`; 0 credit; vào thư viện dự án. Tool Effect-Image có tuỳ chọn "Lưu clip vào thư viện Flow" nhưng kết quả upload chưa kiểm.
- `Flow.media.select` / `selectMultiple`: chọn từ thư viện dự án (dùng để nạp lại ảnh đã giải phóng bộ nhớ).
- `Flow.generate.video({ prompt, modelDisplayName, aspectRatio, durationSeconds, resolution, firstFrameImageMediaId, lastFrameImageMediaId, sourceVideoMediaId, sourceVideoMode, audioReferenceMediaIds })`:
  - model: `Omni 1.1 Flash`, `Veo 3.1 - Lite`, `Veo 3.1 - Fast`, `Veo 3.1 - Quality`; `aspectRatio` chỉ `16:9` hoặc `9:16`; `resolution` `360p` hoặc `720p`;
  - ảnh đầu/cuối và ảnh tham chiếu loại trừ nhau;
  - đã kiểm thật: Omni 360p 4 s với ảnh đầu = mediaId của ảnh, ~40 s, trả mp4 h264 640×360 24 fps có tiếng AAC, 1,5 MB, trừ 4 credit. Chưa kiểm: Veo, 720p, 8–10 s, 9:16 kèm cắt, nhiều biến thể.

- **Độ dài prompt ảnh có giới hạn.** Đo 2026-11-02 trên `Flow.generate.image` (Nano Banana Pro, có 1 ảnh tham chiếu): prompt 3.097 ký tự chạy bình thường (~28 s), prompt 4.190 và 4.300 ký tự bị từ chối sau 9–15 ms với thông báo chung "Dịch vụ tạo hình ảnh không hoạt động. Hãy thử lại." (cùng thông báo như khi dùng model Imagen không tồn tại). Giữ prompt dưới khoảng 3.400 ký tự; ranh giới chính xác nằm giữa 3.097 và 4.190, chưa đo.
- Ảnh tham chiếu: ảnh người dùng tải lên qua `Flow.upload` (JPEG) lấy `mediaId` rồi truyền vào `referenceImageMediaIds` chạy được; `mediaId` của ảnh Flow tạo ra trước đó cũng dùng làm tham chiếu được. `Flow.generate.text` nhận ảnh trong `options.images` (không phải đối số thứ 3).
- Ảnh bị chặn vì chính sách báo bằng tiếng Việt: "Lượt tạo này có thể vi phạm các chính sách của chúng tôi…". Bộ dò lỗi phải khớp "vi phạm"/"chính sách", không chỉ 'safety'/'policy'. Nối danh sách negative có chữ nudity/gore/blood/celebrity vào prompt (`Avoid: …`) gây chặn oan (đo 2026-10-31). Prompt tả máu me trực tiếp lại không bị chặn, nên đừng đoán bộ lọc theo mức độ nội dung.

## Credit (Ultra)

| Việc | Credit |
|---|---|
| Ảnh, text, upload | 0 |
| Omni 360p, 4 / 6 / 8 / 10 s | 4 / 5 / 6 / 7 |
| Omni 720p, 4 / 6 / 8 / 10 s | 7 / 10 / 12 / 15 |
| Veo Lite / Fast / Quality | 5 / 10 / 100 |
| Omni chỉnh video (edit) | 40 |

- Ngân sách của user: 6000 credit/tháng. Menu Flow hiện pool gia đình khoảng 25.000; đó không phải số dư của user.
- "50" là credit miễn phí hằng ngày, không phải giá.
- Giới hạn ảnh mỗi ngày: Google không công bố cho Flow. Con số "1000/ngày" là của ứng dụng Gemini cũ, không phải Flow (bằng chứng trong `research/`). Bộ đếm "Ảnh hôm nay x/1000" trong tool chỉ là số tự đếm. Người dùng từng tạo khoảng 1000 ảnh/ngày không bị chặn (chỉ là cận dưới).

## Làm trong trình duyệt, không tốn credit

- Mã hoá MP4 H.264 ngay trong tool: `VideoEncoder` (WebCodecs) + thư viện `mp4-muxer` (`ArrayBufferTarget`, `fastStart: 'in-memory'`). Codec đã dùng: `avc1.42001f` (720p), `avc1.4d401f`, `avc1.640028` (1080p). Dựng clip 6 s 1080p mất ~8 s, ~9 MB. Tải thẳng ra MP4, không cần đổi định dạng. Dự phòng `MediaRecorder` VP9 → WebM (chưa kiểm).
- Tách lớp parallax: sinh ảnh nền bằng Nano Banana (xoá chủ thể, giữ bố cục) và ảnh chủ thể trên nền xanh `#00FF00`, rồi tách nền xanh bằng chroma key (khử ám xanh, làm mềm viền). Mất ~30–50 s/ảnh (2 lần sinh). Tự tắt khi diện tích chủ thể dưới 1% hoặc trên 65% khung.
- Chuyển động máy quay, hiệu ứng phủ: vẽ trên canvas, hàm thuần theo thời gian `t` (cùng seed + cùng `t` ra đúng cùng một khung) nên xem trước và xuất ra giống hệt nhau.

## Công thức prompt Veo (dùng cho tool video)

`[Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]`, thêm phần tiếng: `Ambient noise:`, `SFX:`, `X says: "…"`. Tránh chỉ dẫn mâu thuẫn nhau. Với video 2D, mỗi prompt kèm câu chặn: "Strictly 2D hand-drawn animation, not photorealistic, no 3D CGI rendering, no real people."

## Chọn model video cho hoạt hình 2D (nguồn công khai, 10/2026)

Arena image-to-video: MiniMax H3 hạng 1 (1495), Omni 1.1 Flash hạng 2 (1488), coi như hoà. Omni đứng đầu text-to-video, bám prompt và lời thoại chính xác từng chữ nhất, hợp truyện kể có lời dẫn. H3 có clip 4–15 s, 6 tỉ lệ, 2K nhưng bị báo lỗi vật lý ở cảnh hành động mạnh, và **không có trong Flow**.
