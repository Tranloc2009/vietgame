# Conflict of Nations: World War 3 — tài liệu tham chiếu cho Antigravity

**Nhiệm vụ tiếp theo là nối nghiên cứu và huy động với máy chủ ngay trên bản đồ Việt Nam mới ở trang chủ.** Mốc mã đã chơi thử là `5339a60`. Mã bản đồ và giao diện nằm trong `campaign/`. Phòng lịch sử ở `/rooms.html` cung cấp các phần máy chủ có thể tái sử dụng. [Mã chiến dịch](../campaign/) · [Nhiệm vụ bàn giao](NEXT_TASK.md)

## Những hành vi có bằng chứng từ trò chơi

| Khi người chơi… | Trò chơi tham chiếu thể hiện điều gì? | Áp dụng ở mốc bàn giao |
|---|---|---|
| Mở nghiên cứu | Từ hồ sơ người chơi có thể vào bảng nghiên cứu. Công nghệ mở loại quân hoặc nâng cấp quân hiện có. Cấp cao phụ thuộc cấp trước. Ngày trận và học thuyết ảnh hưởng lựa chọn. Có thể hủy nghiên cứu đang chạy và nhận hoàn trả theo tiến độ. [Research](https://wiki.conflictnations.com/Research) | Giữ menu Nghiên cứu và hai cấp cơ giới của bản Việt Nam. Để máy chủ quyết định đề tài nào được bắt đầu, hủy hoặc hoàn tất. |
| Bấm một thành phố | Thanh ngữ cảnh chuyển sang thông tin vùng hoặc thành phố. Người chơi xem sản lượng, công trình, tiến độ, rồi chọn xây hoặc huy động. Trong giao diện Classic, danh sách thành phố còn hỗ trợ đặt cùng một lệnh cho nhiều thành phố. [User Interface, mục E và F](https://wiki.conflictnations.com/User_Interface) | Giữ thành phố đang chọn khi bắt đầu lệnh. Hiển thị hàng đợi và quân hoàn thành trong bảng thành phố đó. Huy động hàng loạt chưa thuộc mốc này. |
| Chọn loại quân để huy động | Loại quân có yêu cầu công nghệ và công trình tại thành phố. Quyền huy động còn phụ thuộc trạng thái thành phố, chẳng hạn thành phố chiếm được chưa sáp nhập. [Units, phần Overview](https://wiki.conflictnations.com/Units) · [City Panel](https://wiki.conflictnations.com/User_Interface) | Với cơ giới I, kiểm tra riêng ba điều kiện gồm quyền sở hữu thành phố, nghiên cứu đã xong và văn phòng đạt cấp 1. Sau đó kiểm tra tài nguyên và hàng huy động tại thành phố. |
| Bấm quân trên bản đồ | Thanh ngữ cảnh đổi sang quân đã chọn. Khi quân di chuyển, bảng hoạt động cho biết vị trí, đích cuối, thời gian đi và giờ đến dự kiến. [Units, phần Basic Unit Stats](https://wiki.conflictnations.com/Units) | Một đơn vị vừa hoàn tất phải chọn được qua cả bảng thành phố lẫn quân hiệu. Hai cách chọn phải trỏ đến cùng một đơn vị trên máy chủ. |
| Xem tài nguyên | Trong Classic, rê chuột lên tài nguyên cho biết khoản tiêu thụ và tốc độ tiêu thụ. [User Interface, mục G](https://wiki.conflictnations.com/User_Interface) | Bản Việt Nam cho bấm tài nguyên để xem thu và chi trên cả chuột lẫn cảm ứng. Cập nhật số dư sau khi máy chủ chấp thuận lệnh. |

**Mốc hình ảnh.** Trang User Interface chứa ảnh tổng quan cùng ảnh chi tiết thanh quân, thanh vùng và bảng thành phố. Trang ghi lần sửa cuối ngày 17/05/2019. Trang Research ghi ngày 05/06/2020. Đây là ngày tài liệu, số build của client trong ảnh chưa xác định. Các vị trí đã ghi nhận ở desktop Classic gồm hồ sơ góc trên trái, thanh đối tượng ở cạnh dưới và cụm điều khiển bản đồ ở phía dưới bên phải. Bằng chứng hiện có chưa đủ để kết luận bố cục mobile hiện hành hoặc độ tương đồng theo pixel. [Ảnh giao diện trong wiki](https://wiki.conflictnations.com/User_Interface) · [Ảnh nghiên cứu trong wiki](https://wiki.conflictnations.com/Research)

## Quy tắc của bản Việt Nam cần giữ khi chuyển lên máy chủ

Các con số dưới đây lấy từ mã chơi đơn tại mốc bàn giao. Đây là cấu hình do dự án Việt Nam đặt. [Danh mục và lệnh nghiên cứu](../campaign/forces.js) · [Kinh tế và hàng đợi thành phố](../campaign/economy.js)

| Hành động | Điều kiện và kết quả trong bản Việt Nam |
|---|---|
| Nghiên cứu cơ giới I | Mất 45 giây. Chi 180 tiếp tế, 80 vật liệu hiếm, 240 tiền. Hoàn tất sẽ mở huy động cơ giới. |
| Xây văn phòng tuyển dụng cấp 1 | Mất 45 giây. Chi 150 tiếp tế, 60 linh kiện, 200 tiền. Văn phòng thuộc thành phố đặt lệnh. |
| Huy động một đơn vị cơ giới | Mất 50 giây. Chi 170 tiếp tế, 90 linh kiện, 40 nhiên liệu, 85 nhân lực, 220 tiền. Quân xuất hiện tại thành phố đã huy động. |
| Nghiên cứu cơ giới II | Cần cấp I. Mất 65 giây và tiêu tốn 240 tiếp tế, 120 vật liệu hiếm, 360 tiền. Lệnh di chuyển cơ giới mới giảm từ 32 xuống 24 giây. |
| Hàng đợi và hủy | Chiến dịch có một đề tài nghiên cứu đang chạy. Mỗi thành phố có một hàng xây và một hàng huy động riêng. Khi hủy nghiên cứu, tính hoàn trả theo phần thời gian còn lại rồi làm tròn xuống từng tài nguyên. |

## Một lượt chơi để Antigravity kiểm tra

1. Mở trang chủ, chọn **Nghiên cứu → Bộ binh cơ giới I**. Trước khi hoàn tất, thành phố phải thể hiện điều kiện còn thiếu khi chọn huy động cơ giới.
2. Chọn **Đà Nẵng → Xây dựng → Văn phòng tuyển dụng**. Khi đã đủ cả công nghệ và công trình, mở **Huy động**. Đặt một đơn vị, kiểm tra số dư và thời gian còn lại. Tải lại trang khi đang chờ.
3. Khi hết thời gian, chọn quân vừa tạo ngay trong bảng Đà Nẵng. Đóng bảng và chọn lại bằng quân hiệu. Ra lệnh di chuyển tới một điểm hợp lệ trên bản đồ mới. Kiểm tra đích và thời gian, sau đó thử đổi đích.
4. Với bản phòng mạng sắp triển khai, thử thêm đăng nhập lại, khởi động lại máy chủ và gửi lại cùng một lệnh. Kết quả phải có đúng một lần trừ tiền và một đơn vị. Tài khoản thứ hai không được điều khiển quân đó. Đây là tiêu chí nghiệm thu của dự án Việt Nam. [Kịch bản đã kiểm thử ở chơi đơn](../campaign/forces-test.cjs) · [Phần máy chủ cần làm](NEXT_TASK.md)

## Các nguồn khác đã dùng

Ảnh desktop lưu trong thư mục bằng chứng của workspace là giao diện Classic. Không xác định được số bản dựng từ ảnh. Bài wiki mô tả cơ chế công khai. Chưa có bản ghi thao tác của một client hiện hành đã đăng nhập ở cả desktop và điện thoại.

| Phần | Đối chiếu công khai | Áp dụng trong bản Việt Nam |
|---|---|---|
| Quản lý thành phố | [Giao diện](https://wiki.conflictnations.com/User_Interface) | Chơi đơn có bảng thành phố, xây và huy động |
| Nghiên cứu | [Nghiên cứu](https://wiki.conflictnations.com/Research) | Chơi đơn có hai cấp cơ giới và điều kiện mở khóa |
| Điều khiển quân | [Đơn vị](https://wiki.conflictnations.com/Units) | Chọn đơn vị, đặt đích và theo dõi thời gian |
| Quan hệ và thông tin | [Trạng thái ngoại giao](https://wiki.conflictnations.com/Diplomatic_Status), [Tầm nhìn](https://wiki.conflictnations.com/Field_of_View) | Máy chủ ghép vùng quan sát khi cả hai bên đồng ý |
| Liên lạc và báo chí | [Tin nhắn](https://wiki.conflictnations.com/Messages), [Tin tức](https://wiki.conflictnations.com/News) | Nhật ký mới chỉ bao quát hiệp ước tình báo |

Thời hạn một ngày trận, luật hiển thị theo vùng kề, các chi phí và thời gian hành quân là thiết kế mô phỏng riêng. Chưa có phép đo sai lệch theo pixel hoặc bằng chứng xác nhận hệ số chính thức.
