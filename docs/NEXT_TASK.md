# Điểm tiếp tục

Mốc **T07 (Tinh thần thành phố & Nổi dậy, SAM phòng không, Tàu ngầm tàng hình, Bảng xếp hạng chỉ huy, Metrics vận hành, Hot Backup SQLite, Tài liệu triển khai Production, Stress Test 12 phòng đồng thời & Soak Test 72 giờ)** đã hoàn thành và kiểm thử thực chạy trên **67/67** bài tự động, CLI hot backup trực tiếp trên DB WAL đang mở và cả 3 bộ kiểm thử trình duyệt Microsoft Edge (`1440×900`, `390×844` cảm ứng, `844×390` cảm ứng) cùng hồi quy đầy đủ cho chơi đơn IndexedDB + `/rooms.html`.

Dự án hiện đạt trạng thái **Release Candidate (RC1)** trên nhánh `development/operation-ww3`. Các bước kiểm chứng thực địa trước khi phát hành production công khai:

1. **Kiểm thử thực địa trên thiết bị di động vật lý (iOS Safari / Android Chrome):** Đo FPS vẽ bản đồ Canvas, cử chỉ chạm đa điểm (pinch/pan), độ dễ bấm của thanh lệnh 7 nút và vùng an toàn notch/gesture bar trên máy thật.
2. **Chạy thử nghiệm staging theo đồng hồ tường & reverse proxy HTTPS/WSS:** Triển khai theo `docs/DEPLOYMENT.md` sau Caddy hoặc Nginx, giám sát `/api/metrics`, kiểm thử WebSocket reconnect qua mạng di động thật và xác minh cron `npm run backup:db`.
3. **Kiểm toán bảo mật độc lập trước public launch:** Rà soát pentest/fuzzing cho auth, WebSocket và rate-limiter; mở rộng phân trang nhật báo hoặc bảng mùa giải (nếu sản phẩm yêu cầu ở bản sau RC1).
