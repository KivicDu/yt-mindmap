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
| **2. Phân loại** | 1 call AI nhỏ trên 30 cue đầu: `lecture` / `not_lecture` / `sensitive` | Chưa làm |
| **3. Chia sẻ** | Chỉ project được xác nhận là bài giảng mới bật link công khai | Chưa làm |

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
| `content_not_lecture` | Ngoài allowlist hoặc tiêu đề không phải bài giảng |
| `content_too_short` | Quá ngắn để là bài giảng |

Giao diện hiện tiếng Việt tương ứng và **không** gợi ý "tải file .srt" cho các
lỗi này — nếu không, người dùng sẽ dùng file upload để vòng qua chính sách.

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

Ví dụ cho buổi demo — chỉ cho phép đúng các video đã kiểm:

```env
CONTENT_POLICY=enforce
CONTENT_ALLOW_VIDEO_IDS=<id-video-1>,<id-video-2>,<id-video-3>
```

### Giới hạn phải nói thẳng

- oEmbed **không có** category hay duration của YouTube nếu không dùng Data API
  key. "Thể loại" ở đây là heuristic trên tiêu đề/kênh, không phải category chính
  thức. Lớp 2 mới là phân loại thật.
- Upload `.srt/.vtt` hiện **không qua gate** (không có metadata để xét). Đây là
  tài liệu người dùng tự cung cấp; sản phẩm ghi nhận rõ ràng trong báo cáo.
- Heuristic có sai sót. Allowlist là cách duy nhất để có demo an toàn tuyệt đối.
- Chặn không có nghĩa là kiểm duyệt mọi nội dung. Nghĩa là sản phẩm chỉ xử lý
  những gì nằm trong phạm vi đã cam kết ở trang này.
