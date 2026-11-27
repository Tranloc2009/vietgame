# Điểm tiếp tục

Mốc **T09 (Military Visual Overhaul — Lớp hiển thị quân chủng 2.5D Three.js cho 36 file GLB Bắc/Nam, nâng cấp hình ảnh Cơ giới II, hệ thống LOD 4 tầng, ảnh đại diện quân chủng 3D, thanh HP & hiệu ứng chiến trường, fallback WebGL/Offline)** đã hoàn thành trên nhánh riêng `development/t09-military-visual-overhaul` và vượt qua **74/74** bài kiểm thử tự động + **4/4** bộ kiểm thử Microsoft Edge (gồm benchmark 50/100/200 đơn vị).

Chờ Game Director nghiệm thu trực tiếp trên Live Preview trước khi merge nhánh `development/t09-military-visual-overhaul` vào `development/operation-ww3`. Các bước tiếp theo sau nghiệm thu T09:

1. **Bổ sung 8 mô hình GLB còn thiếu (24 file LOD0–LOD2):** Hoàn thiện trong Military 3D Asset Studio cho `sam`, `fighter`, `corvette`, `submarine` của cả Phương Bắc & Phương Nam, cập nhật trạng thái từ `MISSING_GLB` → `READY` trong `src/content/campaignAssetManifest.ts`.
2. **Tối ưu thêm mật độ siêu cao (>150 quân trên desktop GPU tích hợp) & đo trên điện thoại vật lý:** Kiểm chứng FPS/nhiệt độ trên iOS Safari / Android Chrome thật.
3. **Triển khai Staging HTTPS/WSS & chạy ngâm đồng hồ tường** theo `docs/DEPLOYMENT.md`.
