# Kế hoạch phát triển trên bản đồ Việt Nam

Nhánh `development/operation-ww3` chứa nền máy chủ SQLite + WebSocket dùng chung cho cả phòng 1955 hồi quy (`/rooms.html`) và kịch bản chiến dịch Việt Nam hiện đại (`vietnam_campaign_v1`) mở trực tiếp tại trang chủ `/` (`campaign/` → `index.html`). Tiến độ chi tiết từng nhiệm vụ nằm ở `DEVELOPMENT_PROGRESS.md`.

| ID | Hạng mục | Phụ thuộc | Ưu tiên | Trạng thái | Điều kiện nghiệm thu còn phải đáp ứng hoặc duy trì |
|---|---|---|---|---|---|
| P01 | Máy trận | — | P0 | IMPLEMENTED | Phát lại cùng nhật ký cho cùng kết quả SHA-256 sau khởi động lại (đã kiểm chứng trên `vietnam_1955`, `vietnam_campaign_v1` 2 người và đấu máy AI) |
| P02 | Bản đồ | P01 | P0 | PARTIAL | Bản đồ Việt Nam mới (63 vùng, 60 thành phố gồm 26 thành phố ven biển, vòng radar & tầm đánh Lục/Không/Hải quân, tuyến tiến công đỏ, đường bay thẳng & tuyến Biển Đông) tại `/` và bản đồ 1955 tại `/rooms.html`; cần đo hiển thị trên thiết bị thật |
| P03 | Đơn vị | P01–02 | P0 | IMPLEMENTED | 7 quân chủng đủ 3 quân binh chủng Lục/Không/Hải quân (`reserve`, `motor`, `recon`, `tank`, `artillery`, `fighter`, `corvette`) cùng gộp/tách đạo quân (`CAMPAIGN_GROUP_UNITS`) và hành quân đồng bộ theo tốc độ đơn vị chậm nhất |
| P04 | Giao tranh | P03 | P0 | IMPLEMENTED | Combat Engine tất định tick 10s (cận chiến theo tỷ lệ HP & công sự tới 60%, pháo kích/hải pháo 0 phản công, không kích kèm phòng không đáp trả 25%, bệnh viện hồi máu 30s, chỉ bộ binh chiếm thành) |
| P05 | Kinh tế | P01 | P0 | IMPLEMENTED | Kinh tế 7 tài nguyên máy chủ (gồm bảo dưỡng tiếp tế/nhiên liệu/tiền cho cả thiết giáp, tiêm kích, tàu chiến) cho `vietnam_campaign_v1` và 8 tài nguyên P03 cho `/rooms.html` |
| P06 | Công trình | P05 | P1 | IMPLEMENTED | 7 công trình máy chủ (`factory`, `office`, `base`, `bunker`, `hospital`, `airbase`, `port` giới hạn thành phố ven biển) kèm cấp tối đa và hiệu lực thực |
| P07 | Nghiên cứu | P01, P05 | P0 | IMPLEMENTED | Cây công nghệ 5 nhánh WW3 (`INFANTRY`, `ARMORED`, `SUPPORT`, `AIR`, `NAVAL` — 7 đề tài) kiểm chứng giá/điều kiện/hủy hoàn trả trên máy chủ |
| P08 | Huy động | P03, P06–07 | P0 | IMPLEMENTED | Máy chủ kiểm tra đầy đủ quyền thành phố, Văn phòng, Căn cứ lục/không quân, Quân cảng, công nghệ, tài nguyên, hàng đợi; sinh đúng 1 đơn vị mã ổn định sau restart |
| P09 | Ngoại giao | P01, P12 | P1 | IMPLEMENTED | Bảng Ngoại giao ngay trên `/` (`PEACE`, `DECLARE_WAR`, `PROPOSE_PEACE`/`ACCEPT_PEACE`, `PROPOSE_INTEL`/`ACCEPT_INTEL`/`END_INTEL`), đồng bộ tức thì và dừng tiến công khi đình chiến |
| P10 | Tình báo | P02–03, P09 | P1 | IMPLEMENTED | Tầm nhìn theo đơn vị (`2.6°` Tiêm kích, `2.25°` Trinh sát, `2.0°` Tàu hộ vệ, `1.45°` Pháo, `1.35°` Cơ giới/Tăng, `1.25°` Dự bị/Thành phố), `SHARED_INTEL`, ẩn hàng đợi, 7 loại công trình và tuyến hành quân đối phương |
| P11 | Phe máy | P03–05 | P2 | IMPLEMENTED | Bộ Tư Lệnh Máy (AI) tất định 100% trên máy chủ (`aiOpponent: true`, không API trả phí, không `Math.random()`), tự nghiên cứu, xây hạ tầng biên giới, huy động, tuyên chiến, tiến công và rút lui hồi máu; khớp replay SHA-256 sau restart |
| P12 | Nhiều người chơi | P01 | P0 | PARTIAL | Hai tài khoản độc lập + chế độ 1 người đấu AI chạy trọn vòng đời chiến dịch trên `/` và `/rooms.html`, sống sót qua reload & restart; cần stress test nhiều phòng đồng thời |
| P13 | Tin trong trận | P09, P12 | P1 | IMPLEMENTED | Nhật báo chiến sự, Báo cáo chiến đấu (`MELEE`, `BOMBARDMENT`, `AIRSTRIKE`) lọc theo phe và Nhật ký chỉ huy trong mục **Báo chí** trên `/` |
| P14 | Chiến thắng | P04 | P1 | IMPLEMENTED | Điểm chiến thắng động (`320 → 400 VP`, thành phố `+10`, thủ đô `+30`), tổng chiếm đóng, đầu hàng; cập nhật `match_rooms.status = 'ENDED'` nguyên tử trong SQLite và hiển thị `#victoryBanner` |
| P15 | Giao diện | P02–03 | P1 | IMPLEMENTED | Giao diện chiến dịch WW3 hoàn chỉnh tại `/`: thanh 7 lệnh, Ngoại giao, Báo chí, Đạo quân gộp/tách, 1-click Đấu với Máy AI, âm thanh, hướng dẫn nhiệm vụ tương tác và bảng kết trận |
| P16 | Điện thoại | P15 | P1 | PARTIAL | Kiểm chứng thực chạy `390×844` và `844×390` giả lập cảm ứng cùng kiểm tra trực quan 3 ảnh chụp; cần đo trên thiết bị vật lý |
| P17 | Âm thanh | P03, P13 | P2 | IMPLEMENTED | Bộ tổng hợp âm thanh Web Audio API gốc 100% (`campaign/audio.js`, không tài sản bản quyền) cho từng loại lệnh, tuyên chiến, chiến thắng; có nút bật/tắt `#soundToggle` lưu trong `localStorage` |
| P18 | Hướng dẫn | P07–08, P15 | P2 | IMPLEMENTED | Bảng Hướng dẫn & Nhiệm vụ tương tác 5 bước (`#guideBody`) tự động theo dõi tiến độ thực của người chơi kèm nút thao tác nhanh |
| P19 | Cân bằng | P04–08, P14 | P2 | PARTIAL | Khởi đầu đối xứng 320/320 VP (30/30 thành phố), công thức sát thương HP + công sự + phòng không; cần chạy thêm nhiều trận thử nghiệm dài hạn (T07) |
| P20 | Hiệu năng và bảo mật | P12, P15 | P0 | PARTIAL | Đã khóa quyền sở hữu, idempotency, invariants, replay hash, tách chunk Vite (`rooms-*.js` `259 kB`) và rate-limiting HTTP/WS (`429 RATE_LIMITED`); cần stress test nhiều phòng đồng thời và kiểm toán pentest (T07) |
