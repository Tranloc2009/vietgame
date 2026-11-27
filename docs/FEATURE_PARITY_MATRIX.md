# Đối chiếu chức năng đã khảo sát

Nguồn tương ứng từng mục được liên kết trong SUPREMACY_REFERENCE_ANALYSIS.md. Trạng thái VERIFIED ở báo cáo kiểm thử chỉ xác nhận hành vi của bản Việt Nam.

| ID | Nguồn và hành vi mốc | Bản đã chạy | Sai khác và lý do | Trạng thái | Kiểm thử | Ưu tiên |
|---|---|---|---|---|---|---|
| UI-CITY | Giao diện Classic, bấm thành phố mở bảng | Bảng chơi đơn có sản lượng, hàng đợi, quân | Chưa đo toàn bộ nội dung và khoảng cách trên client hiện hành | PARTIAL | Edge 3 kích thước | P1 |
| TEC-01 | Wiki Research, mở quân theo công nghệ | Cơ giới I mở huy động, II đổi thời gian lệnh sau | Hai cấp tự cấu hình. Chưa có cây đầy đủ trên máy chủ | PARTIAL | Edge 3 kích thước | P0 |
| UNIT-01 | Wiki Units, đơn vị và lệnh di chuyển | Chọn quân vừa huy động trong chơi đơn. Phòng mạng chọn quân hiện có và xác nhận tuyến | Chưa nối huy động vào phòng mạng | PARTIAL | Edge và kiểm thử API | P0 |
| VIS-01 | Wiki Field of View, thông tin phụ thuộc quan sát | Máy chủ lọc đơn vị theo vùng và che tuyến của đối tác | Phạm vi quan sát theo đồ thị kịch bản | PARTIAL | Hai phiên độc lập | P1 |
| DIP-01 | Wiki Diplomatic Status, quan hệ ảnh hưởng chia sẻ thông tin | Đề nghị, chấp nhận, chấm dứt, hết hạn | Thời hạn tính từ lúc đề nghị là luật riêng | PARTIAL | Hai phiên và đồng hồ kiểm soát | P1 |
| NEWS-01 | Wiki News, sự kiện trong trận | Nhật ký hiệp ước ghi thời điểm và kết quả | Chưa phân trang báo theo ngày | PARTIAL | Nhật ký xuất hiện trong bảng ngoại giao | P2 |
| MOB-01 | Client mobile hiện hành | Giao diện thử được ở khung nhỏ | Chưa có bản ghi đối chiếu mobile trực tiếp | UNKNOWN | Giả lập cảm ứng | P1 |
