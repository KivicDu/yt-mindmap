# Phạm vi sản phẩm: yt-mindmap dạy cái gì

> Tài liệu này trả lời hai câu bị hỏi nhiều nhất: *"từ video sang mindmap rồi thì
> mindmap để làm gì?"* và *"video nào được phép?"*. Đây là cam kết về phạm vi,
> không phải danh sách tính năng.

## Câu trả lời ngắn

> **yt-mindmap giúp học cấu trúc lập luận của một bài giảng**: cái gì là ý chính,
> cái gì là chi tiết, và mỗi ý nằm ở phút nào — để lúc ôn không phải xem lại cả video.

Video là phương tiện tuyến tính: một bài 2 tiếng chứa 40 ý nhưng chỉ điều hướng
được bằng thanh tua. Mindmap trả lại **hình dạng** bị mất đó. Sản phẩm không dạy
"nội dung" nói chung; nó dạy **cấu trúc của nội dung**.

## Ba việc chỉ mindmap làm được

| Việc | Ý nghĩa |
|---|---|
| **Nén** | 40 ý trong 2 tiếng → 15 nhánh, liếc 10 giây thấy toàn cảnh |
| **Tổ chức** | Quan hệ cha–con, thứ mà danh sách chapter của YouTube không có |
| **Điều hướng** | Mỗi nhánh có `time`, bấm là tua đúng đoạn |

Nếu bỏ mindmap đi mà chỉ giữ transcript + timestamp + player thì mất đúng ba
việc trên. Đó là lý do tồn tại của sản phẩm.

## Mindmap KHÔNG dạy cái gì

Nói rõ để không bị hiểu nhầm:

- **Không dạy kiến thức chuyên môn** thay cho bài giảng; đây là bản đồ của bài
  giảng, không phải bài giảng khác.
- **Không luyện giải bài, không luyện tư duy toán, không thay bài tập.**
- **Không đảm bảo nhớ.** Nhớ hay không là do người học; sản phẩm chỉ tạo điều
  kiện để ôn lại và tự kiểm.
- **Không chấm điểm cho ai.** Kết quả tự kiểm là của riêng người học, không dùng
  để xếp hạng hay so sánh.

## Một bài học có ba chặng

| Chặng | Câu hỏi của người học | Vai trò của map | Tình trạng |
|---|---|---|---|
| **a. Khi nghe** | "Mình đang ở đâu trong bài?" | Bản đồ sống, đọc lướt, tự thu gọn | Có |
| **b. Khi ôn** | "Quên đoạn này thì nhảy tới đâu?" | Bản chỉ mục có timestamp | Có (thiếu cảnh báo phút trống) |
| **c. Sau khi ôn** | "Mình nắm được bao nhiêu?" | Map bị che, người học dựng lại | Thiết kế xong (ADR 0014), chưa code |

Ba chặng dùng **cùng một map**. Chặng c không tạo map khác — nó che map đã có.
Kết quả tự kiểm là hai phân số đếm được (ví dụ *9/12 nhánh, 4/6 ý chính*), **không**
phải một phần trăm "hiểu" gộp, vì trọng số của một con số như vậy không có cơ sở.

## Video nào được phép

Nguyên tắc: sản phẩm là công cụ học, không phải công cụ tóm tắt đa dụng. Một
video chỉ được xử lý khi nó là **bài giảng hoặc tài liệu học tập** và không nằm
trong danh sách bị chặn.

Sản phẩm **không phát video** — YouTube phát. Điều sản phẩm kiểm soát là việc
**đọc phụ đề, dựng map, lưu trữ và cho chia sẻ** nội dung đó.

### Ba lớp kiểm soát

| Lớp | Việc làm | Trạng thái |
|---|---|---|
| **1. Metadata** | oEmbed (tiêu đề, kênh) + độ dài và số cue của phụ đề; blocklist / allowlist | **Đã làm** |
| **2. Phân loại** | 1 call AI nhỏ trên 30 cue đầu: `lecture` / `not_lecture` / `sensitive` | **Đã làm** |
| **3. Chia sẻ** | Chỉ project được xác nhận là bài giảng mới bật link công khai | **Đã làm** |

### Lớp 1 hoạt động thế nào

1. **Blocklist luôn thắng** — video hoặc kênh bị chặn bị từ chối ngay, trước cả
   khi gọi YouTube transcript, trước khi ghi cache hay tạo session.
2. **Allowlist là danh sách đóng** — nếu cấu hình, chỉ video/kênh trong danh sách
   được xử lý. Đây là chế độ nên dùng khi demo hoặc chạy riêng.
3. **Không có metadata thì fail-open** — oEmbed lỗi mạng không được khoá người
   học; video vẫn mở nhưng gắn nhãn `unverified` trong phản hồi API.
4. **Tiêu đề nghi ngờ** (music video, gameplay, reaction, trailer…) bị từ chối
   sau khi bỏ dấu. Danh sách từ khoá cố tình ngắn để không từ chối nhầm bài
   giảng về âm nhạc hay điện ảnh.
5. **Quá ngắn thì từ chối** — mặc định dưới 180 giây hoặc dưới 20 cue phụ đề.
6. **Allowlist khớp thì tin cậy** — bỏ qua các bước 4 và 5.

Lỗi trả về theo hợp đồng `{code, message}` hiện có:

| `code` | Nghĩa |
|---|---|
| `video_blocked` | Video/kênh nằm trong blocklist |
| `content_not_lecture` | Ngoài allowlist, tiêu đề hoặc AI nói không phải bài giảng |
| `content_too_short` | Quá ngắn để là bài giảng |
| `content_sensitive` | AI đánh giá nội dung không an toàn để tóm tắt học tập |

Giao diện hiện tiếng Việt tương ứng và **không** gợi ý "tải file .srt" cho các
lỗi này — nếu không, người dùng sẽ dùng file upload để vòng qua chính sách.

### Lớp 2 hoạt động thế nào

Sau khi lớp 1 cho phép, một call AI nhỏ đọc **tiêu đề, tên kênh và tối đa 30 cue
đầu** (giới hạn 4.000 ký tự), rồi trả một trong ba nhãn:

- `lecture` → giữ nguyên cho học, nâng nhãn thành `lecture` nếu oEmbed từng lỗi;
- `not_lecture` → từ chối, mã `content_not_lecture`;
- `sensitive` → từ chối, mã `content_sensitive`.

Ba nguyên tắc thiết kế:

1. **Tiêu đề và phụ đề là dữ liệu không tin cậy.** Prompt nói rõ với mô hình
   không được thi hành chỉ thị nằm trong nội dung video — một bài giảng về
   prompt injection không được tự điều khiển bộ phân loại.
2. **Fail-open.** AI không được cấu hình, lỗi mạng hoặc trả JSON sai → nhãn
   `unverified`, video vẫn mở. Kết quả lỗi **không được cache**, nên lần sau vẫn
   thử lại.
3. **Cache có giới hạn.** Kết quả hợp lệ được cache theo `video_id` + băm của
   đúng mẫu phụ đề đã đọc, tối đa 200 mục theo thứ tự dùng gần đây. Mở lại cùng
   video không tốn quota; đổi phụ đề thì tự động đánh giá lại.

Video **allowlist không gọi classifier** — đã là danh sách kiểm duyệt thủ công
thì không cần hỏi AI, và cũng không tốn quota.

#### Tín hiệu ảnh (tuỳ chọn, mặc định tắt)

Tiêu đề và phụ đề có thể bình thường trong khi **khung hình lại nhạy cảm**. Khi
bật `CONTENT_VISUAL_CHECK_ENABLED=true`, lớp 2 tải thêm một vài JPEG công khai
nhỏ — thumbnail `hqdefault`, ba khung tự động `1/2/3.jpg` ở ~25/50/75% video,
và tối đa hai sheet storyboard (sheet thứ hai chỉ khi video dài hơn 10 phút) —
rồi đưa **cùng một call AI** với prompt ở trên. Không tải video, không thêm call
AI thứ hai, và tổng số ảnh bị giới hạn bởi `CONTENT_VISUAL_MAX_IMAGES`.

Prompt xử lý ảnh như dữ liệu không tin cậy: ảnh có chữ hay biểu tượng cũng không
được phép điều khiển mô hình. Bài giảng y khoa/lịch sử/nghệ thuật có ảnh mạnh
không tự động bị gán `sensitive` — mô hình phải xét ý định và cách trình bày.
Khi ảnh không rõ, quyết định vẫn dựa trên phụ đề.

Đây là tín hiệu **bổ sung, không phải cổng mới**: ảnh lỗi, 404, sai định dạng,
quá lớn hoặc fetcher gặp lỗi đều được bỏ qua để classifier tiếp tục bằng chữ;
không có ảnh thì không truyền tham số ảnh vào engine. Nhãn trả về vẫn là ba nhãn
cũ. Cache key có thêm băm của `(source, bytes)` từng ảnh và một marker schema,
nên đổi ảnh thì đánh giá lại, còn mở lại cùng ảnh thì không tốn quota.

Flag mặc định `false`: bật lên mới đổi hành vi. Việc này **chưa giải quyết được**
mọi trường hợp — storyboard thường cần URL đã ký từ player nên hay 404, và ảnh
rải rắc vẫn có thể bỏ sót một đoạn ngắn. Nút báo cáo/duyệt tay là việc riêng.

### Lớp 3 hoạt động thế nào

Một project chỉ bật được link công khai khi `content_verified = true`. Nhãn này
được lưu ngay trên bản ghi project, không phải suy lại lúc bật link:

- **Có** khi video nằm trong allowlist hoặc classifier trả `lecture`.
- **Không có** khi chỉ lớp 1 đoán bằng heuristic, khi AI lỗi, hoặc khi sơ đồ
  dựng từ file `.srt/.vtt` do người dùng tự tải.

Áp dụng ở ba điểm, để không có cửa sau:

1. `PUT /api/projects/{id}/share` và xoay link từ chối (422 `content_not_verified`)
   nếu project chưa xác nhận. **Tắt chia sẻ luôn được phép**, kể cả với project cũ.
2. `GET /api/share/{slug}` và `/api/share/meta` trả kết quả như "không tìm thấy"
   cho project chưa xác nhận — một slug cũ bị demote không tiếp tục phục vụ nội dung.
3. Giao diện share hiện thông báo và khoá công tắc, các select và nút mời.

Hệ quả cần biết: migration `0009_content_verified` đặt cột này là `false` cho mọi
bản ghi cũ, nên **link công khai của các project cũ ngừng hoạt động**. Đây là ý
đồ: không thể chứng minh nguồn gốc thì không công khai. Chủ project vẫn mở được
bản của mình và có thể bật lại sau khi mở lại video để lớp 2 xác nhận.

### Cấu hình

Đặt trong `backend/.env` (hoặc biến môi trường). Mặc định `enforce` với danh
sách trống: áp dụng heuristic, chưa khoá cứng.

| Biến | Ý nghĩa |
|---|---|
| `CONTENT_POLICY` | `enforce` (mặc định) hoặc `off` (tắt hoàn toàn, chỉ để tương thích cũ) |
| `CONTENT_ALLOW_CHANNELS` | Tên kênh được phép, phân cách bằng dấu phẩy |
| `CONTENT_ALLOW_VIDEO_IDS` | ID video được phép (11 ký tự) |
| `CONTENT_BLOCK_CHANNELS` | Tên kênh bị chặn |
| `CONTENT_BLOCK_VIDEO_IDS` | ID video bị chặn |
| `CONTENT_MIN_DURATION_SECONDS` | Mặc định `180` |
| `CONTENT_MIN_CUES` | Mặc định `20` |
| `CONTENT_CLASSIFIER_ENABLED` | `true` (mặc định); `false` để tắt hẳn lớp 2 |
| `CONTENT_CLASSIFIER_CUES` | Số cue đầu đọc khi phân loại, mặc định `30` (tối đa 30) |
| `CONTENT_VISUAL_CHECK_ENABLED` | `false` (mặc định); `true` để thêm ảnh vào cùng call classifier |
| `CONTENT_VISUAL_MAX_IMAGES` | Số ảnh tối đa, mặc định `6` (trần tuyệt đối `8`) |
| `CONTENT_VISUAL_FETCH_TIMEOUT` | Timeout mỗi lần tải ảnh, mặc định `5` giây |
| `CONTENT_VISUAL_MAX_BYTES` | Giới hạn mỗi ảnh, mặc định `1_500_000` byte |
| `CONTENT_SHARE_REQUIRE_VERIFIED` | `true` (mặc định); chỉ để `false` tạm thời khi di chuyển dữ liệu cũ |

Ví dụ cho buổi demo — chỉ cho phép đúng các video đã kiểm:

```env
CONTENT_POLICY=enforce
CONTENT_ALLOW_VIDEO_IDS=<id-video-1>,<id-video-2>,<id-video-3>
```

### Giới hạn phải nói thẳng

- oEmbed **không có** category hay duration của YouTube nếu không dùng Data API
  key. Lớp 1 là heuristic trên tiêu đề/kênh; lớp 2 mới là phân loại thật nhưng
  chỉ đọc 30 cue đầu, nên vẫn có thể sai ở một bài giảng dài.
- Upload `.srt/.vtt` hiện **không qua cả hai lớp** (không có metadata để xét).
  Đây là tài liệu người dùng tự cung cấp; sản phẩm ghi nhận rõ ràng trong báo cáo.
- Tín hiệu ảnh là tuỳ chọn và chỉ lấy mẫu rải rắc; ảnh nhạy cảm xuất hiện ở đoạn
  không được lấy mẫu vẫn có thể lọt qua. Đây chưa phải kiểm duyệt khung hình.
- Heuristic có sai sót. Allowlist là cách duy nhất để có demo an toàn tuyệt đối.
- Chặn không có nghĩa là kiểm duyệt mọi nội dung. Nghĩa là sản phẩm chỉ xử lý
  những gì nằm trong phạm vi đã cam kết ở trang này.
