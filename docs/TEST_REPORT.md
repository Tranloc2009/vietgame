# Kết quả kiểm thử ngày 27/11/2026

Sau khi đổi bản đồ mặc định, đã chạy lại TypeScript, build và đủ 50 bài hồi quy. Bộ trình duyệt mở trực tiếp trang chủ của bản build, thực hiện nghiên cứu, huy động, chọn quân và đổi đích trên cả ba kích thước. Hai phiên nhiều người chơi mở từ /rooms.html cũng vượt qua bộ kiểm thử ở 1440 và 390 px.

| Kiểm tra | Kết quả quan sát |
|---|---|
| TypeScript | Đạt khi chạy tsc --noEmit |
| Build Vite | Đạt. Gói JavaScript chính khoảng 1,63 MB trước gzip. Có cảnh báo kích thước |
| Hợp đồng, mô phỏng, máy chủ, bản đồ | 50/50 đạt. Bao gồm replay, clock, quyền, phòng, lệnh hành quân, chấp nhận và hết hạn hiệp ước |
| Edge nhiều người chơi | Hai ngữ cảnh người dùng độc lập ở 1440 và 390 px. Tạo phòng, xây và hủy, hành quân và dừng, đề nghị và chấp nhận, kiểm tra liên hệ xuất hiện rồi mất khi chấm dứt. Không ghi nhận lỗi JavaScript trong luồng |
| Edge chơi đơn | 1440×900, 390×844, 844×390. Nghiên cứu, hủy, mở khóa, huy động, chọn quân, đổi đích, dừng, tải lại và đến nơi đều đạt |
| Đối chiếu giao diện | Đã có ảnh kết quả ở thư mục kiem-thu trong workspace. Chưa đo so sánh từng màn hình với client WW3 hiện hành |
| Hiệu năng và bảo mật | Kiểm thử quyền và dữ liệu đã lọc theo phe. Chưa thử tải nhiều phòng, kiểm toán toàn bộ hoặc đo GPU thật |

Đã chạy lại bộ 50 bài và cả hai kích thước trình duyệt sau khi thêm lệnh đổi đích. Kiểm thử API xác nhận một đích không hợp lệ giữ nguyên mã băm của trận. Trình duyệt kiểm tra thao tác giữ tuyến cũ, xác nhận đích mới và dừng ở vùng hiện tại.

Bộ trình duyệt phòng mạng tắt WebGL và dùng đường hiển thị dự phòng. Kết quả cảm ứng được đo trong trình duyệt giả lập. Kiểm thử chơi đơn dùng đồng hồ điều khiển được để đi qua các hàng đợi.
