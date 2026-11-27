# Kế hoạch phát triển trên bản đồ Việt Nam

Nhánh `development/operation-ww3` chứa nền máy chủ SQLite + WebSocket dùng chung cho cả phòng 1955 hồi quy (`/rooms.html`) và kịch bản chiến dịch Việt Nam hiện đại (`vietnam_campaign_v1`) mở trực tiếp tại trang chủ `/` (`campaign/` → `index.html`). Tiến độ chi tiết từng nhiệm vụ nằm ở `DEVELOPMENT_PROGRESS.md`.

| ID | Hạng mục | Phụ thuộc | Ưu tiên | Trạng thái | Điều kiện nghiệm thu còn phải đáp ứng hoặc duy trì |
|---|---|---|---|---|---|
| P01 | Máy trận | — | P0 | IMPLEMENTED | Phát lại cùng nhật ký cho cùng kết quả SHA-256 sau khởi động lại (đã kiểm chứng trên cả `vietnam_1955` và `vietnam_campaign_v1`, kể cả giao tranh, chiếm đóng và kết trận) |
| P02 | Bản đồ | P01 | P0 | PARTIAL | Bảo toàn bản đồ Việt Nam mới (63 vùng, 60 thành phố, vòng radar tầm nhìn/pháo, tuyến tiến công đỏ) tại `/` và bản đồ 1955 (72 vùng) tại `/rooms.html`; cần đo hiển thị trên thiết bị thật |
| P03 | Đơn vị | P01–02 | P0 | PARTIAL | Đã hoàn thiện 5 đơn vị Lục quân (`reserve`, `motor`, `recon`, `tank`, `artillery`) với HP, công mềm/giáp, thủ, tầm nhìn và tốc độ riêng; cần thêm gộp/tách đội hình và Không quân/Hải quân (T06) |
| P04 | Giao tranh | P03 | P0 | IMPLEMENTED | Combat Engine tất định trên máy chủ (cận chiến tick 10s, pháo kích tầm xa `1.25°` không phản công, giảm sát thương công sự tối đa 60%, bệnh viện hồi máu 30s, chỉ bộ binh chiếm thành, xóa hàng đợi địch) đã nghiệm thu tự động & E2E |
| P05 | Kinh tế | P01 | P0 | PARTIAL | Duy trì kinh tế 7 tài nguyên máy chủ (gồm bảo dưỡng tiếp tế/nhiên liệu/tiền theo đơn vị) cho `vietnam_campaign_v1` và 8 tài nguyên P03 cho `/rooms.html` |
| P06 | Công trình | P05 | P1 | PARTIAL | Đã hoàn thiện 5 công trình máy chủ (`factory`, `office`, `base`, `bunker`, `hospital`) kèm cấp tối đa và hiệu lực thực (tuyển quân, phòng thủ, hồi máu); cần bổ sung sân bay/quân cảng (T06) |
| P07 | Nghiên cứu | P01, P05 | P0 | PARTIAL | Đã hoàn thiện cây công nghệ 3 nhánh Lục quân WW3 (`motor`, `motor2`, `recon`, `tank`, `artillery`) kiểm chứng giá/điều kiện/hủy hoàn trả trên máy chủ; cần mở rộng nhánh Không quân & Hải quân (T06) |
| P08 | Huy động | P03, P06–07 | P0 | IMPLEMENTED | Máy chủ kiểm tra đầy đủ quyền thành phố, Văn phòng tuyển dụng, Căn cứ lục quân, công nghệ, tài nguyên, hàng đợi; sinh đúng 1 đơn vị mã ổn định có HP/chỉ số chiến đấu sau restart |
| P09 | Ngoại giao | P01, P12 | P1 | IMPLEMENTED | Đã tích hợp bảng Ngoại giao ngay trên `/` (`PEACE`, `DECLARE_WAR`, `PROPOSE_PEACE`/`ACCEPT_PEACE`, `PROPOSE_INTEL`/`ACCEPT_INTEL`/`END_INTEL`), đồng bộ thời gian thực và dừng tiến công khi đình chiến |
| P10 | Tình báo | P02–03, P09 | P1 | IMPLEMENTED | Tầm nhìn theo đơn vị (`2.25°` Trinh sát, `1.45°` Pháo, `1.35°` Cơ giới/Tăng, `1.25°` Dự bị/Thành phố), hiệp ước `SHARED_INTEL`, ẩn hoàn toàn hàng đợi, cấp công trình (`office`/`base`/`bunker`/`hospital`) và tuyến hành quân đối phương |
| P11 | Phe máy | P03–05 | P2 | NOT IMPLEMENTED | Triển khai bộ lập kế hoạch AI tất định không dùng API trả phí cho chế độ 1 người đấu máy / vùng trung lập (T06) |
| P12 | Nhiều người chơi | P01 | P0 | PARTIAL | Hai tài khoản độc lập chạy trọn vòng đời chiến dịch (tạo phòng → giao tranh → chiếm đất → kết trận) trên `/` và `/rooms.html`, sống sót qua reload & restart; cần thử tải nhiều phòng và soak test |
| P13 | Tin trong trận | P09, P12 | P1 | IMPLEMENTED | Nhật báo chiến sự (tuyên chiến, đình chiến, giao tranh, chiếm đóng, chiến thắng), Báo cáo chiến đấu lọc theo phe tham chiến và Nhật ký chỉ huy ngay trong bảng **Báo chí** trên `/` |
| P14 | Chiến thắng | P04 | P1 | IMPLEMENTED | Điểm chiến thắng động (`320 → 400 VP`, thành phố `+10`, thủ đô `+30`), tổng chiếm đóng, đầu hàng; cập nhật `match_rooms.status = 'ENDED'` nguyên tử trong SQLite và hiển thị `#victoryBanner` trên `/` |
| P15 | Giao diện | P02–03 | P1 | PARTIAL | Đã hoàn thiện thanh 7 lệnh WW3, bảng Ngoại giao, Báo chí, vòng radar/tầm pháo, tuyến tiến công đỏ và bảng kết trận trên `/`; cần bổ sung thao tác gộp/tách quân và âm thanh (T06) |
| P16 | Điện thoại | P15 | P1 | PARTIAL | Đã kiểm chứng thực chạy 390×844 và 844×390 giả lập cảm ứng cùng kiểm tra trực quan ảnh chụp; cần đo trên thiết bị vật lý |
| P17 | Âm thanh | P03, P13 | P2 | NOT IMPLEMENTED | Kiểm kê nguồn âm có phép và thêm phản hồi âm thanh tắt/bật được (T06) |
| P18 | Hướng dẫn | P07–08, P15 | P2 | NOT IMPLEMENTED | Hướng dẫn tương tác trong trận giúp người mới hoàn thành luồng nghiên cứu → huy động → chiếm thành (T06) |
| P19 | Cân bằng | P04–08, P14 | P2 | PARTIAL | Đã cân bằng khởi đầu đối xứng 320/320 VP (30/30 thành phố), công thức sát thương HP + công sự; cần chạy thêm nhiều trận thử nghiệm dài hạn để tinh chỉnh |
| P20 | Hiệu năng và bảo mật | P12, P15 | P0 | PARTIAL | Đã kiểm tra quyền sở hữu, idempotency, invariants, replay hash và lọc dữ liệu theo phe cho toàn bộ lệnh `CAMPAIGN_*`; cần thêm rate-limiting HTTP/WS và stress test |
