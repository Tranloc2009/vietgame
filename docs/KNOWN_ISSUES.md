# Hạng mục còn mở

- **P1 — 8 slot asset GLB Không quân / Hải quân / Phòng không còn thiếu (`MISSING_GLB`):** Chưa có mô hình GLB thật cho `sam`, `fighter`, `corvette`, `submarine` của cả hai phe Bắc/Nam (`src/content/campaignAssetManifest.ts`); hiện hiển thị bằng hình khối 3D/SVG dự phòng.
- **P1 — Kiểm thử thiết bị di động vật lý & GPU thật:** Đã đo benchmark 3D 50/100/200 quân (`49–60 FPS`) trên Microsoft Edge giả lập `390×844` kèm `env(safe-area-inset-*)`; chưa đo trên điện thoại iOS/Android vật lý.
- **P1 — Mốc 200 quân 3D đồng thời trên desktop GPU tích hợp:** Đạt tròn `60,0 FPS` tại 50 và 100 quân, đạt `48,5 FPS` tại 200 quân đồng thời (`197.412` tam giác); cân nhắc hạ LOD tự động khi mật độ đơn vị trong khung nhìn `> 150`.
- **P1 — Chạy ngâm đồng hồ tường & kiểm thử staging thực tế sau HTTPS/WSS:** Đã chạy stress test 12 phòng, soak test 72h (`ManualClock`), fuzzing bảo mật & benchmark WebSocket thực trên localhost (`74/74` PASS); chưa chạy ngâm đồng hồ tường dài giờ sau reverse proxy Caddy/Nginx trên môi trường Internet thật.
- **P1 — Ràng buộc cổng lệnh cũ thời P01:** Các lệnh tương thích cũ (`SCHEDULE_JOB`, `ENACT_POLICY` trên phòng 1955) còn nhận tham số chi phí từ payload; toàn bộ lệnh `CAMPAIGN_*` trên `vietnam_campaign_v1` đã khóa 100% giá, điều kiện và thời gian ở danh mục máy chủ.
- **P2 — Cảnh báo chunk `vendor-maplibre` (> 650 kB):** Đã tách `dist/assets/rooms-*.js` xuống `259,7 kB` (`gzip: 66,8 kB`); riêng thư viện bản đồ WebGL `vendor-maplibre` (`1.053 kB`, gzip `291 kB`) là kích thước gốc của `maplibre-gl` chỉ tải khi mở `/rooms.html`.
