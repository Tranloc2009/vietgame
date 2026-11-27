# Hạng mục còn mở

- **P1 — Kiểm thử thiết bị di động vật lý & GPU thật:** Cảm ứng đã kiểm thử thực chạy trên Microsoft Edge giả lập (`390×844` và `844×390`) cùng kiểm tra ảnh chụp thực tế; chưa đo trên điện thoại iOS/Android vật lý.
- **P1 — Thử tải nhiều phòng đồng thời & soak test đồng hồ tường:** Đã bổ sung rate-limiting HTTP/WS ở mốc T06; chưa chạy stress test nhiều phòng đồng thời và soak test đồng hồ tường nhiều giờ.
- **P1 — Ràng buộc cổng lệnh cũ thời P01:** Các lệnh tương thích cũ (`SCHEDULE_JOB`, `ENACT_POLICY` trên phòng 1955) còn nhận tham số chi phí từ payload; toàn bộ lệnh `CAMPAIGN_*` trên `vietnam_campaign_v1` đã khóa 100% giá, điều kiện và thời gian ở danh mục máy chủ.
- **P2 — Cảnh báo chunk `vendor-maplibre` (> 650 kB):** Đã tách `dist/assets/rooms-*.js` xuống `259 kB` (`gzip: 66,7 kB`); riêng thư viện bản đồ WebGL `vendor-maplibre` (`1.053 kB`, gzip `291 kB`) là kích thước gốc của `maplibre-gl` chỉ tải khi mở `/rooms.html`.
- **P2 — Chiều sâu mở rộng tiếp theo (T07):** Tinh thần dân cư thành phố (morale), phòng không chuyên biệt, tàu ngầm, phân trang nhật báo theo từng ngày game và bảng xếp hạng người chơi.
