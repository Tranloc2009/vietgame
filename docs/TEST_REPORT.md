# Kết quả kiểm thử ngày 27/11/2026 (Mốc T09 — Military Visual Overhaul: 36 GLB 2.5D Three.js, LOD, Ảnh đại diện quân chủng, Hiệu ứng chiến trường & Benchmark 50/100/200 quân)

Sau khi hoàn thiện mốc **T09** trên nhánh riêng `development/t09-military-visual-overhaul` (tách từ `development/operation-ww3` @ `fbafe0b`), đã chạy đầy đủ quy trình đóng gói `unit3d.bundle.js` + `campaign/build.cjs` + `vite build`, kiểm tra TypeScript nghiêm ngặt, toàn bộ **74 bài kiểm thử tự động** (71 bài hồi quy T01–T08 + 3 bài kiểm định 36 GLB & Asset Manifest T09) và cả **4 bộ kiểm thử trình duyệt Microsoft Edge thực tế**.

| Kiểm tra | Kết quả thực chạy |
|---|---|
| TypeScript (`tsc --noEmit`) | **ĐẠT** (`0` lỗi kiểu trên toàn bộ `src/`, `server.ts`, `scripts/`) |
| Đóng gói 3D & Production Build (`build-unit3d.cjs` + `campaign/build.cjs` + `vite build`) | **ĐẠT**. Gói `public/assets/unit3d.bundle.js` (`641,1 kB`, tải bất đồng bộ trên HTTP, bỏ qua khi `file://` hoặc No-WebGL); `dist/assets/rooms-*.js` giữ gọn `259,7 kB` (`gzip: 66,8 kB`); `dist/index.html` ~1,95 MB |
| Kiểm định nhị phân 36 file GLB (`scripts/audit-glb-assets.mts`) | **36/36 ĐẠT** (`0` lỗi). Tất cả đều chuẩn glTF 2.0, `mesh = 1`, `4–9` vật liệu PBR + `2–3` PNG textures, `minY = 0`, căn giữa XZ, hướng `+Z`, giảm đa giác nghiêm ngặt `LOD0 > LOD1 > LOD2`. Ghi nhận trung thực **8 slot còn thiếu GLB** (`sam`, `fighter`, `corvette`, `submarine` × Bắc & Nam) ở trạng thái `MISSING_GLB` |
| Bộ kiểm thử tự động (`bun test --timeout 30000`, 14 tệp) | **74/74 ĐẠT** (`0` lỗi): toàn bộ 71/71 bài hồi quy T01–T08 + 3/3 bài mới trong `src/server/vietnamCampaignT09.test.ts` (kiểm định 36 GLB, phân biệt Bắc/Nam, nâng cấp `BTR-40 → BTR-60PB` & `M113 APC → M113 ACAV` theo `motor2`, chuyển đổi LOD, toàn vẹn bundle & fallback) |
| Edge T09 Visual, GPU Benchmark & Resilience (`scripts/t09-visual-benchmark-test.mts`) | **ĐẠT** (`0` lỗi JS, `0` lỗi mạng): tải thực 12 mẫu `LOD2` + 12 ảnh đại diện 3D trong `732,3 ms`; xác minh chuyển đổi `SYMBOL (0 draw calls) → LOD2 → LOD1 → LOD0`; nâng cấp trực tiếp `BTR-40 → BTR-60PB` khi học `motor2`; cách ly tuyệt đối Fog of War (quân địch ở Cà Mau không lọt vào lớp 3D); kiểm chứng resize, `webglcontextlost`/`webglcontextrestored`, `?nowebgl=1` và mở ngoại tuyến `file://`. **Benchmark:** Desktop `1440×900` đạt **60 FPS** (50 quân), **60 FPS** (100 quân), **48,5 FPS** (200 quân · `110` draw calls cố định · `29 MB` heap); Mobile `390×844` đạt **60 / 49,3 / 54,1 FPS** (50 / 100 / 200 quân) |
| Edge phòng mạng bản đồ Việt Nam mới (`scripts/campaign-online-browser-test.mts`) | **ĐẠT** hồi quy T04–T08 trên cả 3 khung (`1440×900`, `390×844` cảm ứng, `844×390` cảm ứng · `0` lỗi JS, `0` tràn ngang) |
| Edge chơi đơn bản đồ Việt Nam (`campaign/forces-test.cjs`) | **ĐẠT** hồi quy IndexedDB trên cả 3 khung (`1440×900`, `390×844`, `844×390`) |
| Edge phòng mạng 1955 cũ (`scripts/room-browser-test.cjs`) | **ĐẠT** hồi quy ở `1440×900` và `390×844` trên `/rooms.html` (`0` lỗi JS) |
| Kiểm tra trực quan ảnh chụp màn hình | Đã xem trực tiếp `kiem-thu/t09-3d-desktop-war.png`, `t09-3d-desktop-zoom.png`, `t09-3d-mobile-doc.png`, `t09-fallback-nowebgl.png` (đã sửa lỗi nền đỏ `.armyPin.enemy` đè xe tăng Nam và nâng sáng `RoomEnvironment` PBR cho toàn bộ mô hình & ảnh đại diện) |

Chi tiết đối chiếu trước/sau, bảng 36 GLB và 8 asset còn thiếu xem tại [T09_VISUAL_OVERHAUL_REPORT.md](T09_VISUAL_OVERHAUL_REPORT.md).

## Phần chưa xác minh (NOT VERIFIED)

- **8 asset GLB Không quân / Hải quân / Phòng không (`sam`, `fighter`, `corvette`, `submarine` × Bắc & Nam):** Chưa có file GLB từ studio; đang ở trạng thái `MISSING_GLB` và hiển thị hình khối 2.5D/SVG dự phòng.
- **Thiết bị di động vật lý & GPU thật:** Kiểm thử cảm ứng và benchmark mobile chạy trong Microsoft Edge giả lập (`hasTouch: true`, `390×844`), chưa đo FPS/VRAM/nhiệt trên điện thoại iOS/Android vật lý.
- **Mốc 200 quân đồng thời đạt tròn 60 FPS trên desktop GPU tích hợp:** Đạt `60,0 FPS` ở 50 & 100 quân, `48,5 FPS` ở 200 quân đồng thời (`197.412` tam giác) trên máy phát triển.
- **Chạy ngâm đồng hồ tường dài giờ sau reverse proxy HTTPS/WSS thật & pentest độc lập:** Giữ nguyên ghi nhận từ T08.
