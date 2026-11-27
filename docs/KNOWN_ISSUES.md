# Hạng mục còn mở

- **P1 — Gộp/tách đội hình (Stack/Split) & Nhánh Không quân / Hải quân WW3:** Mốc T05 đã hoàn thiện 3 nhánh Lục quân (`motor`, `motor2`, `recon`, `tank`, `artillery`), 5 công trình (`factory`, `office`, `base`, `bunker`, `hospital`), ngoại giao, giao tranh cận chiến + pháo kích, chiếm đóng và điểm chiến thắng. Gộp/tách quân, sân bay/quân cảng và lực lượng không quân/hải quân thuộc mốc T06.
- **P1 — Phe máy (AI/NPC) trên `vietnam_campaign_v1`:** Trận mạng `vietnam_campaign_v1` hiện hỗ trợ 2 người chơi thật (`NORTH` vs `SOUTH`); chưa có bộ lập kế hoạch AI tất định cho các vùng trung lập hoặc chế độ 1 người đấu máy.
- **P1 — Kiểm thử thiết bị di động vật lý & dung lượng bundle:** Cảm ứng đã kiểm thử thực chạy trên Edge giả lập (`390×844` và `844×390`); chưa đo trên điện thoại iOS/Android thật. `dist/assets/rooms-*.js` còn cảnh báo kích thước > 500 kB của Vite.
- **P1 — Thử tải nhiều phòng đồng thời, soak test đồng hồ thực & rate-limiting:** Chưa chạy stress test nhiều phòng đồng thời, chưa chạy ngâm nhiều giờ đồng hồ tường, và chưa thêm rate-limit ở tầng HTTP/WS.
- **P1 — Ràng buộc cổng lệnh cũ thời P01:** Các lệnh tương thích cũ (`SCHEDULE_JOB`, `ENACT_POLICY` trên phòng 1955) còn nhận tham số chi phí từ payload; toàn bộ lệnh `CAMPAIGN_*` trên `vietnam_campaign_v1` đã khóa 100% giá, điều kiện và thời gian ở danh mục máy chủ.
- **P2 — Âm thanh phản hồi, hướng dẫn tương tác và phân trang nhật báo theo ngày:** Nhật báo chiến sự và báo cáo chiến đấu đã hoạt động trực tuyến; âm thanh hợp pháp và hướng dẫn tương tác thuộc T06.
