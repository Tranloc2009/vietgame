# Kế hoạch phát triển trên bản đồ Việt Nam

Nhánh `development/operation-ww3` chứa nền máy chủ SQLite + WebSocket dùng chung cho cả phòng 1955 hồi quy (`/rooms.html`) và kịch bản chiến dịch Việt Nam hiện đại (`vietnam_campaign_v1`) mở trực tiếp tại trang chủ `/` (`campaign/` → `index.html`). Tiến độ chi tiết từng nhiệm vụ nằm ở `DEVELOPMENT_PROGRESS.md`.

| ID | Hạng mục | Phụ thuộc | Ưu tiên | Trạng thái | Điều kiện nghiệm thu còn phải đáp ứng hoặc duy trì |
|---|---|---|---|---|---|
| P01 | Máy trận | — | P0 | IMPLEMENTED | Phát lại cùng nhật ký cho cùng kết quả sau khởi động lại (đã kiểm chứng trên cả `vietnam_1955` và `vietnam_campaign_v1`) |
| P02 | Bản đồ | P01 | P0 | PARTIAL | Bảo toàn bản đồ Việt Nam mới (63 vùng, 60 thành phố) tại `/` và bản đồ 1955 (72 vùng) tại `/rooms.html`; cần đo hiển thị trên thiết bị thật |
| P03 | Đơn vị | P01–02 | P0 | PARTIAL | Đã chọn quân mới sinh, di chuyển/dừng/đổi đích trên máy chủ ở `/`; cần mở rộng quân chủng và gộp/tách đội hình |
| P04 | Giao tranh | P03 | P0 | MISSING | Giải quyết giao tranh mô phỏng và cập nhật quyền kiểm soát thành phố xác định |
| P05 | Kinh tế | P01 | P0 | PARTIAL | Duy trì kinh tế 7 tài nguyên máy chủ cho `vietnam_campaign_v1` và 8 tài nguyên P03 cho `/rooms.html` |
| P06 | Công trình | P05 | P1 | PARTIAL | Xây và hủy Xưởng công nghiệp, Văn phòng tuyển dụng qua máy chủ ở từng thành phố hợp lệ; cần mở rộng thêm công trình WW3 |
| P07 | Nghiên cứu | P01, P05 | P0 | PARTIAL | Đã hoàn thành máy chủ cho Cơ giới I/II (giá/thời gian/điều kiện/hủy hoàn trả theo tiến độ/tác dụng mở khóa & giảm tốc độ di chuyển); cần mở rộng đủ cây công nghệ WW3 |
| P08 | Huy động | P03, P06–07 | P0 | PARTIAL | Đã hoàn thành máy chủ cho Đội dự bị & Bộ binh cơ giới (kiểm tra quyền thành phố, văn phòng, công nghệ, tài nguyên, hàng đợi, sinh đúng 1 quân mã ổn định sau restart); cần mở rộng thêm quân chủng |
| P09 | Ngoại giao | P01, P12 | P1 | PARTIAL | Hiệp ước tình báo hai bên đã chạy ở máy chủ. Cần giao diện ngoại giao, tuyên chiến/hòa bình và liên minh ngay trên bản đồ Việt Nam mới |
| P10 | Tình báo | P02–03, P09 | P1 | PARTIAL | Đã lọc tầm nhìn và ẩn hoàn toàn hàng đợi, kho, lệnh quân đối phương theo phe trên máy chủ; cần thêm trinh sát chuyên biệt |
| P11 | Phe máy | P03–05 | P2 | UNKNOWN | Kiểm chứng phe máy tự ra quyết định trong một trận hoàn chỉnh |
| P12 | Nhiều người chơi | P01 | P0 | PARTIAL | Hai tài khoản độc lập chạy thật trên `/` và `/rooms.html`, sống sót qua reload & restart; cần thử tải nhiều phòng và ngắt kết nối dài |
| P13 | Tin trong trận | P09, P12 | P1 | PARTIAL | Nhật ký sự kiện lọc theo phe đã có thật; cần nhật báo theo ngày và tin chiến sự |
| P14 | Chiến thắng | P04 | P1 | PARTIAL | Có đầu hàng; cần điểm lãnh thổ/thành phố và màn hình kết trận |
| P15 | Giao diện | P02–03 | P1 | PARTIAL | Đã giữ giao diện chiến dịch Việt Nam tại `/` và tích hợp bảng Phòng mạng; cần tiếp tục mở rộng đủ các bảng WW3 |
| P16 | Điện thoại | P15 | P1 | PARTIAL | Đã kiểm chứng 390×844 và 844×390 giả lập cảm ứng; cần đo trên thiết bị thật |
| P17 | Âm thanh | P03, P13 | P2 | UNKNOWN | Kiểm kê nguồn âm có phép và nghe thử theo từng hành động |
| P18 | Hướng dẫn | P07–08, P15 | P2 | UNKNOWN | Người mới hoàn thành luồng đầu tiên bằng hướng dẫn tương tác trong trận |
| P19 | Cân bằng | P04–08, P14 | P2 | MISSING | Chạy nhiều trận và định lượng thời gian, tài nguyên, kết quả |
| P20 | Hiệu năng và bảo mật | P12, P15 | P0 | PARTIAL | Đã kiểm tra quyền, idempotency và lọc dữ liệu theo phe cho toàn bộ lệnh `CAMPAIGN_*`; cần thêm rate-limiting và đo tải |
