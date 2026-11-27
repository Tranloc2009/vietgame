# Đối chiếu chức năng đã khảo sát

Nguồn tương ứng từng mục được liên kết trong `SUPREMACY_REFERENCE_ANALYSIS.md`. Trạng thái VERIFIED ở báo cáo kiểm thử xác nhận hành vi thực chạy của bản Việt Nam.

| ID | Nguồn và hành vi mốc | Bản đã chạy | Sai khác và lý do | Trạng thái | Kiểm thử | Ưu tiên |
|---|---|---|---|---|---|---|
| UI-CITY | Giao diện Classic, bấm thành phố mở bảng | Bảng thành phố tại `/` hoạt động ở cả chơi đơn và phòng mạng (sản lượng, xây dựng, huy động, quân đồn trú, khóa thao tác trên thành phố đối phương) | Chưa có tinh thần dân cư, đặc vụ, phá dỡ, huy động hàng loạt | PARTIAL | Edge 3 khung (solo & 2 tài khoản) | P1 |
| TEC-01 | Wiki Research, mở quân theo công nghệ | Máy chủ kiểm tra và xử lý Cơ giới I (mở huy động) và Cơ giới II (giảm lệnh mới từ 32s xuống 24s), hỗ trợ hủy hoàn trả làm tròn xuống theo thời gian còn lại | Hai cấp cơ giới cho mốc T04; chưa mở rộng đủ các nhánh khác của WW3 | VERIFIED (mốc T04) / PARTIAL (toàn cây WW3) | `vietnamCampaign.test.ts` & Edge 2 tài khoản | P0 |
| UNIT-01 | Wiki Units, đơn vị và lệnh di chuyển | Máy chủ kiểm tra quyền thành phố, văn phòng, công nghệ, tài nguyên, sinh đúng 1 đơn vị mã ổn định `unt_vn_0001`, chọn từ bảng thành phố hoặc quân hiệu bản đồ, di chuyển/dừng/đổi đích theo tuyến Việt Nam | Chưa có giao tranh, chiếm đóng và gộp/tách đội hình | VERIFIED (mốc T04) / PARTIAL (toàn hệ thống quân) | `vietnamCampaign.test.ts` & Edge 2 tài khoản | P0 |
| VIS-01 | Wiki Field of View, thông tin phụ thuộc quan sát | Máy chủ ẩn hoàn toàn kho, nghiên cứu, hàng đợi thành phố và sự kiện của đối phương; ẩn quân hậu phương và cắt bỏ tuyến/đích (`trip: null`) với liên hệ biên giới | Phạm vi quan sát `1.25°` theo vị trí thành phố/quân là quy tắc mô phỏng của kịch bản Việt Nam | PARTIAL | `vietnamCampaign.test.ts` & Edge 2 tài khoản | P1 |
| DIP-01 | Wiki Diplomatic Status, quan hệ ảnh hưởng chia sẻ thông tin | Hiệp ước tình báo hai bên đã chạy ở máy chủ (`SHARED_INTEL`) và `/rooms.html` | Chưa có giao diện ngoại giao và tuyên chiến trực tiếp trong HUD `/` | PARTIAL | Hai phiên trên `/rooms.html` & unit test | P1 |
| NEWS-01 | Wiki News, sự kiện trong trận | Nhật ký sự kiện lọc theo phe hoạt động cả chơi đơn và phòng mạng | Chưa phân trang nhật báo theo ngày | PARTIAL | Kiểm chứng qua E2E | P2 |
| MOB-01 | Client mobile hiện hành | Giao diện `/` đã kiểm thử cảm ứng ở `390×844` và `844×390` không tràn ngang, không chồng lấn | Chưa thử trên thiết bị di động vật lý | PARTIAL | Edge giả lập cảm ứng | P1 |
