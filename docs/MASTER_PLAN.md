# Kế hoạch phát triển trên bản đồ Việt Nam

Nhánh development/operation-ww3 được tạo trong bản sao riêng. Nền nhiều người chơi sử dụng bản đồ 1955 đã nghiệm thu. Bản chơi đơn hiện đại độc lập nằm ở ../BAN-DO-VIET-NAM.html tính từ thư mục gốc của bản sao. Các mốc dưới đây áp dụng cho bản nhiều người chơi. Nhóm thử nghiệm, tệp và commit đã hoàn thành được ghi ở DEVELOPMENT_PROGRESS.md. Dấu — biểu thị hạng mục chưa có commit triển khai được xác minh ở nhánh này.

| ID | Hạng mục | Phụ thuộc | Ưu tiên | Trạng thái | Điều kiện nghiệm thu còn phải đáp ứng hoặc duy trì |
|---|---|---|---|---|---|
| P01 | Máy trận | — | P0 | IMPLEMENTED | Phát lại cùng nhật ký cho cùng kết quả sau khởi động lại |
| P02 | Bản đồ | P01 | P0 | PARTIAL | Bảo toàn 72 vùng, 24 thành phố, 98 cạnh và đo hiển thị WebGL trên thiết bị |
| P03 | Đơn vị | P01–02 | P0 | PARTIAL | Chọn quân mới, gộp/tách và khôi phục lệnh |
| P04 | Giao tranh | P03 | P0 | MISSING | Giải quyết giao tranh mô phỏng và cập nhật quyền kiểm soát xác định |
| P05 | Kinh tế | P01 | P0 | PARTIAL | Duy trì đối soát sổ cái cho các lệnh mới |
| P06 | Công trình | P05 | P1 | PARTIAL | Xây, hủy và hoàn thành qua máy chủ ở từng thành phố hợp lệ |
| P07 | Nghiên cứu | P01, P05 | P0 | MISSING | Máy chủ kiểm tra điều kiện, trừ chi phí đúng một lần, cấp mở khóa |
| P08 | Huy động | P03, P06–07 | P0 | MISSING | Hoàn tất hàng đợi tạo đúng một đơn vị có thể chọn trên bản đồ |
| P09 | Ngoại giao | P01, P12 | P1 | PARTIAL | Hiệp ước tình báo hai bên đã chạy. Liên minh nhiều bên còn thiếu |
| P10 | Tình báo | P02–03, P09 | P1 | PARTIAL | Kiểm soát tầm nhìn cả khi nối lại. Chưa có trinh sát chuyên biệt |
| P11 | Phe máy | P03–05 | P2 | UNKNOWN | Kiểm chứng phe máy tự ra quyết định trong một trận hoàn chỉnh |
| P12 | Nhiều người chơi | P01 | P0 | PARTIAL | Hai phiên thật đã chạy. Cần thử tải và ngắt kết nối dài |
| P13 | Tin trong trận | P09, P12 | P1 | PARTIAL | Nhật ký ngoại giao có thật. Cần báo theo ngày và tin kinh tế |
| P14 | Chiến thắng | P04 | P1 | PARTIAL | Có đầu hàng. Cần điểm lãnh thổ và báo cáo kết trận |
| P15 | Giao diện | P02–03 | P1 | PARTIAL | Đối chiếu màn hình chính và bảng lệnh với client có phiên bản |
| P16 | Điện thoại | P15 | P1 | PARTIAL | Đo chạm, safe area, tốc độ và xoay máy trên thiết bị thật |
| P17 | Âm thanh | P03, P13 | P2 | UNKNOWN | Kiểm kê nguồn âm có phép và nghe thử theo từng hành động |
| P18 | Hướng dẫn | P07–08, P15 | P2 | UNKNOWN | Người mới hoàn thành luồng đầu tiên bằng hướng dẫn trong trận |
| P19 | Cân bằng | P04–08, P14 | P2 | MISSING | Chạy nhiều trận và định lượng thời gian, tài nguyên, kết quả |
| P20 | Hiệu năng và bảo mật | P12, P15 | P0 | PARTIAL | Đo tải có mục tiêu, kiểm tra quyền cho mọi nhóm lệnh và dữ liệu đồng bộ |
