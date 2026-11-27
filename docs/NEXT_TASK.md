# Điểm tiếp tục

Mốc **T05 (Cây công nghệ WW3, Ngoại giao, Combat Engine, Chiếm đóng thành phố, Nhật báo/Báo cáo chiến đấu & Điểm chiến thắng trên bản đồ Việt Nam mới ở `/`)** đã hoàn thành và kiểm thử thực chạy trên **58/58** bài tự động cùng 3 khung trình duyệt Edge (`1440×900`, `390×844` cảm ứng, `844×390` cảm ứng) và hồi quy đầy đủ cho chơi đơn IndexedDB + `/rooms.html`.

**T06 · P1 · Gộp/tách đội hình (Stack/Split), Nhánh Không quân – Hải quân, Phe máy (AI/NPC) & Trải nghiệm hoàn thiện sản phẩm**

Phụ thuộc T05. Tiếp tục mở rộng trực tiếp trên `vietnam_campaign_v1` (`campaign/` + `src/simulation/vietnamCampaignEngine.ts`) mà không phá vỡ bất kỳ bất biến nào của T01–T05.

1. **Gộp & tách đội hình (Army Stack / Split) + Tập hợp điểm đóng quân:** Cho phép gom nhiều đơn vị đồng minh cùng tọa độ thành một đạo quân có chỉ số tổng hợp, tách chọn lọc từng đơn vị ra khỏi đội hình, và hiển thị huy hiệu số lượng/tổng HP rõ ràng trên bản đồ.
2. **Mở rộng nhánh Không quân & Hải quân WW3:** Bổ sung công trình Căn cứ không quân (`airbase`) và Quân cảng (`naval_base`, chỉ xây ở thành phố ven biển), công nghệ & đơn vị Tiêm kích đánh chặn, Trực thăng vũ trang, Tàu hộ vệ tên lửa với luật hành trình đường không/đường biển và tầm tác chiến riêng.
3. **Phe máy (AI/NPC) & Chế độ luyện tập trên máy chủ:** Triển khai bộ lập kế hoạch AI tất định (không dùng API trả phí, không dùng `Math.random()`) cho các tỉnh trung lập hoặc chế độ đấu với máy (1 người chơi + 1 AI).
4. **Hiệu năng, Bảo mật & Hoàn thiện phát hành:** Bổ sung rate-limiting ở tầng HTTP/WS, tối ưu chia gói bundle (`dist/assets/rooms-*.js`), phản hồi âm thanh hợp pháp (tắt/bật được), hướng dẫn tương tác cho người mới, và đo hiệu năng trên thiết bị di động thật.
