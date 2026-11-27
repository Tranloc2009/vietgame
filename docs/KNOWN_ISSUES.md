# Hạng mục còn mở

- **P0 — Giao tranh, chiếm đóng lãnh thổ và điểm chiến thắng:** Kịch bản `vietnam_campaign_v1` đã có nghiên cứu, xây văn phòng, huy động và điều quân trên máy chủ trong phạm vi thành phố kiểm soát; chưa có chiến đấu mô phỏng, chiếm thành phố đối phương và thắng bằng điểm (thuộc T05).
- **P0 — Cây công nghệ và danh mục quân đầy đủ WW3:** Mới triển khai nhánh Bộ binh cơ giới (Cấp I, Cấp II), Đội dự bị, Xưởng công nghiệp và Văn phòng tuyển dụng theo đúng cấu hình chiến dịch Việt Nam; các nhánh thiết giáp, pháo, không quân, hải quân còn ở pha kế tiếp.
- **P0 — Ràng buộc cổng lệnh cũ thời P01:** Các lệnh tương thích cũ (`SCHEDULE_JOB`, `ENACT_POLICY` trên phòng 1955) còn nhận tham số chi phí từ payload; mọi lệnh mới `CAMPAIGN_*` trên `vietnam_campaign_v1` đã khóa 100% giá và thời gian ở danh mục máy chủ.
- **P1 — Kiểm thử thiết bị di động thật & dung lượng bundle:** Cảm ứng đã kiểm thử trên Edge giả lập (`390×844` và `844×390`); chưa đo trên điện thoại thật hoặc GPU thật. `dist/assets/rooms-*.js` còn cảnh báo kích thước > 500 kB của Vite.
- **P1 — Thử tải nhiều phòng đồng thời & rate-limiting:** Chưa chạy stress test nhiều phòng đồng thời và chưa thêm rate-limit ở tầng HTTP/WS.
- **P2 — Âm thanh, hướng dẫn tương tác và nhật báo theo ngày:** Chưa triển khai.
