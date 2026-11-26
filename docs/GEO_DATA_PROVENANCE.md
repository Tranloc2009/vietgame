# Nguồn gốc Dữ liệu Địa lý & Backlog Đồ họa Bản đồ (P02-COMPLETE)

- **Checkpoint nền tảng:** `P02-COMPLETE` (Game Director nghiệm thu `P02-05` ở cấp độ *Geographic Map Foundation* — không phải giao diện đồ họa thành phẩm).
- **Gói dữ liệu đã xây dựng:** `src/content/geo/vietnam72WorldData.json` (phiên bản `2.0.0-p02-05`, kích thước 194,845 byte).
- **Script tái lập nguồn:** `scripts/buildGeographicMapData.ts`.

---

## 1. Bảng Xác minh Nguồn Dữ liệu Địa lý

| Hạng mục dữ liệu | Tên bộ dữ liệu nguồn | Phiên bản / Điểm nguồn | URL tham chiếu chính thức | Giấy phép | Phạm vi sử dụng trong dự án |
| --- | --- | --- | --- | --- | --- |
| **Đường bờ biển Việt Nam, 13 đảo ven bờ & 5 quốc gia bối cảnh (`CHN`, `KHM`, `LAO`, `THA`, `MMR`)** | Natural Earth 1:10m Admin-0 Countries (`ne_10m_admin_0_countries`) | Natural Earth Vector `master` (1:10m Cultural Vectors) | `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson` | **Public Domain** (Miễn bản quyền, không yêu cầu trả phí, không ràng buộc thương mại) | Đường bờ biển thực tế Việt Nam làm đa giác cắt cho 72 vùng gameplay; bối cảnh lãnh thổ lân cận & Biển Đông |
| **Hệ thống sông ngòi chính (57 đoạn trực tiếp + 9 đoạn thủy văn bổ sung có nhãn = 66 đoạn)** | Natural Earth 1:10m Rivers & Lake Centerlines (`ne_10m_rivers_lake_centerlines`) + tham chiếu thủy văn bổ sung nội bộ (`SUPPLEMENTARY_HYDROGRAPHIC_REFERENCE`) | Natural Earth Vector `master` (1:10m Physical Vectors) | `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson` | **Public Domain** (Natural Earth) & hình học tham chiếu nguyên bản của dự án | Hiển thị hệ thống sông Hồng, sông Đà, sông Lô, sông Mã, sông Cả, sông Hương, sông Thu Bồn, sông Đồng Nai, sông Tiền, sông Hậu và đánh dấu `hasMajorRiver` |
| **Độ cao địa hình (DEM cho 72 vùng, 24 thành phố & 6 đỉnh núi tiêu biểu)** | NASA SRTM 90m Digital Elevation Model v4.1 qua OpenTopoData | SRTM 90m v4.1 (mẫu truy vấn tọa độ WGS84) | `https://api.opentopodata.org/v1/srtm90m` | **Public Domain** (NASA / USGS SRTM) | Tính `elevationMeters` (trung bình 3 điểm mẫu/vùng), `elevationPeakMeters`, độ cao thành phố và đỉnh núi (`Fansipan`, `Ngọc Linh`, `Lang Biang`, ...) |
| **Phân vùng 72 khu vực chiến lược & 98 hành lang giao thông 4 cấp** | Thiết kế nguyên bản cho kịch bản lịch sử thay thế 1955 | `2.0.0-p02-05` (`ALTERNATE_HISTORY_1955_FICTIONAL_NETWORK`) | Nội bộ dự án (`scripts/buildGeographicMapData.ts`) | **Tài sản nguyên bản của dự án** | 72 đa giác hữu cơ mang mã `reg_vn_01`..`reg_vn_72`, 98 hành lang (`PRIMARY_ROAD`, `SECONDARY_ROAD`, `RAILWAY`, `RIVER_CROSSING`), hệ số `movementCostFp` / `movementModifierFp` |

---

## 2. Phương pháp Xử lý Dữ liệu & Kiểm chứng Toàn vẹn

1. **Sinh đa giác vùng hữu cơ:**
   - Sử dụng `d3-delaunay` (Voronoi) trên 72 hạt giống tọa độ chiến lược phủ kín 3 miền Bắc – Trung – Nam.
   - Cắt (clip) từng ô Voronoi với đa giác lãnh thổ đất liền Việt Nam trích từ Natural Earth 1:10m bằng `polygon-clipping`, đảm bảo bờ biển & biên giới ngoài bám sát địa lý thực tế mà không tạo ô vuông lưới.
2. **Đơn giản hóa & Chuẩn hóa RFC 7946:**
   - Áp dụng thuật toán đơn giản hóa Douglas-Peucker có kiểm soát độ lệch để tối ưu dung lượng WebGL/SVG mà vẫn giữ đường bờ tự nhiên (`>= 6` đỉnh không thẳng hàng trên mỗi đa giác).
   - Chuẩn hóa mọi vòng đa giác khép kín, hướng ngược chiều kim đồng hồ (CCW, diện tích có dấu dương), tọa độ WGS84 trong khung `[102..111, 8..24]`.
3. **Trích xuất đồ thị liên thông & Tách biệt lịch sử:**
   - Quan hệ lân cận `adjacentRegionIds` được rút trích đối xứng 100%, kiểm tra BFS liên thông toàn bộ 72/72 vùng (0 vùng mồ côi).
   - Gắn cờ bất biến `modernRoadsUsedAsHistorical: false` và `modernAdminBordersUsedAsHistorical: false` trên toàn bộ metadata vùng và tệp dữ liệu.
4. **Kiểm tra Đồng nhất Hiển thị ↔ Authoritative Gameplay:**
   - Được khóa bằng bài kiểm thử tự động trong `src/content/worldMap72.test.ts`: xác nhận 0 sai lệch giữa `WORLD_MAP_72_GEOJSON` + `WORLD_GEO_LAYERS` và `createWorld72MatchState().regions` trên toàn bộ **72 vùng**, **98 hành lang giao thông** và **24 thành phố** (bao gồm `regionId`, `code`, `name`, `controllerNationId`, `adjacentRegionIds`, `supplyCapacityFp`, `infrastructureFp`, `economicOutputFp`).

---

## 3. Backlog Nâng cấp Đồ họa Bản đồ Cao cấp — Giai đoạn `P11` (Operation Immersion)

Các hạng mục thẩm mỹ & trình diễn bản đồ cao cấp sau đây **được ghi nhận chính thức vào Backlog `P11` và KHÔNG triển khai trong Giai đoạn 03** để tập trung hoàn toàn vào nền tảng gameplay authoritative:

1. **Đổ bóng địa hình chuyên sâu (Shaded Relief / Hillshade DEM):** Kết xuất bản đồ hillshade nhiều góc chiếu từ raster SRTM kết hợp đường đồng mức mềm.
2. **Chất liệu bản đồ giấy quân sự / cartography lịch sử cao cấp:** Texture nền giấy chỉ huy, hệ thống phân cấp chữ (cartographic typography) đa mức zoom chống đè nhãn tự động.
3. **Biển Đông & Độ sâu thềm lục địa (Bathymetry):** Tầng màu độ sâu biển, đường bờ mềm, hiệu ứng sóng ven bờ tinh tế.
4. **Hoạt ảnh bản đồ & Mũi tên hành quân / Tuyến tiếp vận động:** Hiệu ứng chuyển động quân sự, tuyến hậu cần, tiền tuyến động (frontline rendering) sau khi Combat & Movement Engine hoàn thiện.
5. **Tối ưu LOD (Level of Detail) WebGL đa tầng:** Tách lớp chi tiết sông nhánh, đường sắt, cảng biển và địa danh theo ngưỡng zoom mượt ở 60 FPS.
6. **Hệ thống chủ đề bản đồ (Map Themes) & Lớp thời tiết trực quan:** Lớp mây/mùa gió mùa (kết nối khe `WEATHER` đã chừa sẵn trong `mapLayerRegistry.ts`).
