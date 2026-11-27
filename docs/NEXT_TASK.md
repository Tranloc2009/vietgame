# Điểm tiếp tục

Mốc **T08 (AI 3 cấp độ khó, Phá dỡ công trình hoàn 40%, Báo chí lọc theo ngày & phân loại, Cảnh báo tinh thần trực tiếp trên bản đồ, Phím tắt chỉ huy, Mobile Safe-Area, HTTP Security Headers, Fuzzing bảo mật & Benchmark WebSocket thực)** đã hoàn thành và kiểm thử thực chạy trên **71/71** bài tự động cùng cả 3 bộ kiểm thử trình duyệt Microsoft Edge (`1440×900`, `390×844` cảm ứng, `844×390` cảm ứng) và hồi quy đầy đủ cho chơi đơn IndexedDB + `/rooms.html`.

Dự án hiện đạt trạng thái **Release Candidate 2 (RC2)** sẵn sàng triển khai staging/production trên nhánh `development/operation-ww3`. Các bước kiểm chứng thực địa cuối cùng (yêu cầu phần cứng / môi trường triển khai thật ngoài workspace):

1. **Kiểm thử thực địa trên thiết bị di động vật lý (iOS Safari / Android Chrome):** Đo FPS vẽ bản đồ Canvas, cử chỉ chạm đa điểm (pinch/pan) và vùng an toàn notch/gesture bar trên điện thoại thật.
2. **Triển khai Staging HTTPS/WSS & chạy ngâm đồng hồ tường:** Cấu hình theo `docs/DEPLOYMENT.md` sau Caddy hoặc Nginx, theo dõi `/api/metrics`, xác minh cron `npm run backup:db` và reconnect WebSocket trên mạng di động thật.
3. **Kiểm toán xâm nhập (pentest) độc lập trước public launch** và mở rộng tính năng hậu phát hành (nếu cần: trực thăng vận tải, tàu sân bay, đặc vụ tình báo, hoặc mùa giải xếp hạng).
