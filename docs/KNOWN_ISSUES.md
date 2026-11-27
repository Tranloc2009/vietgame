# Hạng mục còn mở

- **P1 — Kiểm thử thiết bị di động vật lý & GPU thật:** Cảm ứng đã kiểm thử thực chạy trên Microsoft Edge giả lập (`390×844` và `844×390`) cùng kiểm tra ảnh chụp thực tế; chưa đo trên điện thoại iOS/Android vật lý.
- **P1 — Chạy ngâm đồng hồ tường & kiểm thử staging thực tế sau HTTPS/WSS:** Đã chạy stress test 12 phòng đồng thời và soak test 72 giờ bằng `ManualClock` ở T07 (`67/67` PASS); chưa chạy ngâm đồng hồ tường nhiều giờ liên tục sau reverse proxy Caddy/Nginx trên môi trường production thật.
- **P1 — Ràng buộc cổng lệnh cũ thời P01:** Các lệnh tương thích cũ (`SCHEDULE_JOB`, `ENACT_POLICY` trên phòng 1955) còn nhận tham số chi phí từ payload; toàn bộ lệnh `CAMPAIGN_*` trên `vietnam_campaign_v1` đã khóa 100% giá, điều kiện và thời gian ở danh mục máy chủ.
- **P2 — Cảnh báo chunk `vendor-maplibre` (> 650 kB):** Đã tách `dist/assets/rooms-*.js` xuống `259 kB` (`gzip: 66,7 kB`); riêng thư viện bản đồ WebGL `vendor-maplibre` (`1.053 kB`, gzip `291 kB`) là kích thước gốc của `maplibre-gl` chỉ tải khi mở `/rooms.html`.
- **P2 — Tiện ích hậu RC1:** Phân trang nhật báo theo từng ngày game, nhiều mức độ khó AI, phá dỡ công trình và kiểm toán pentest độc lập.
