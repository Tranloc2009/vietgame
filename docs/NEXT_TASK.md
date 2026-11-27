# Điểm tiếp tục

Mốc **T06 (Không/Hải quân, Gộp/Tách đạo quân, Bộ Tư Lệnh Máy AI tất định, Rate-Limiting HTTP/WS, Tối ưu Chunk Vite, Âm thanh tổng hợp Web Audio & Hướng dẫn tương tác trên bản đồ Việt Nam mới ở `/`)** đã hoàn thành và kiểm thử thực chạy trên **62/62** bài tự động cùng cả 3 bộ kiểm thử trình duyệt Microsoft Edge (`1440×900`, `390×844` cảm ứng, `844×390` cảm ứng) và hồi quy đầy đủ cho chơi đơn IndexedDB + `/rooms.html`.

**T07 · P2 · Kiểm thử tải nhiều phòng, Tinh chỉnh cân bằng chiến dịch & Chuẩn bị Release Candidate**

Phụ thuộc T06. Tập trung hoàn thiện chất lượng vận hành sản xuất mà không phá vỡ bất kỳ bất biến nào của T01–T06.

1. **Stress Test & Soak Test máy chủ:** Viết kịch bản tải nhiều phòng đồng thời (10–25 phòng `vietnam_campaign_v1` chạy song song + WebSocket), đo bộ nhớ/CPU/độ trễ SQLite WAL và chạy kiểm chứng ngâm đồng hồ.
2. **Đo đạc trên thiết bị di động vật lý & tối ưu hiệu năng vẽ Canvas:** Kiểm chứng FPS, chạm tay thật và vùng an toàn (safe-area) trên điện thoại iOS/Android thật.
3. **Tinh chỉnh cân bằng & mở rộng sâu WW3:** Bổ sung hệ thống tinh thần dân cư thành phố (morale), phòng không chuyên biệt (SAM / Mobile AA), tàu ngầm, tàu sân bay hoặc chế độ giải đấu/xếp hạng nhiều trận.
4. **Đóng gói phát hành (Release Candidate):** Chuẩn hóa quy trình backup SQLite định kỳ, cấu hình biến môi trường production (HTTPS/WSS reverse proxy, logging có cấu trúc) và tài liệu triển khai vận hành.
