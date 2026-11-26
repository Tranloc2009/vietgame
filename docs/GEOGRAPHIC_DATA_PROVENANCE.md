# Xác minh Nguồn Dữ liệu Địa lý & Quy trình Xử lý (P02-05 / P02-COMPLETE)

Tài liệu này ghi nhận nguồn gốc, phiên bản, giấy phép, mã kiểm toàn vẹn và phương pháp xử lý của toàn bộ dữ liệu địa lý đang được đóng gói tĩnh trong `src/content/geo/vietnam72WorldData.json`.

## 1. Thông tin gói dữ liệu đã đóng gói

- **Đường dẫn tệp:** `src/content/geo/vietnam72WorldData.json`
- **Phiên bản nội bộ:** `2.0.0-p02-05`
- **Kích thước:** `194,845 bytes`
- **SHA-256:** `963eca2b519e75380bc52170e1aae5fe77ae5bd3c0bccff3bad212dd93d38b23`
- **Script tái lập tất định:** `scripts/buildGeographicMapData.ts` (`npx tsx scripts/buildGeographicMapData.ts`)
- **Phạm vi địa lý chiến trường (WGS84):** Kinh độ `98.6°E – 113.8°E`, Vĩ độ `6.2°N – 25.2°N`

## 2. Nguồn dữ liệu đã xác minh & Giấy phép

| Lớp dữ liệu | Nguồn dữ liệu chính thức | Điểm truy xuất / Phiên bản | Giấy phép | Phạm vi sử dụng thực tế |
| --- | --- | --- | --- | --- |
| **Đường bờ biển Việt Nam, 13 đảo ven bờ & 5 quốc gia lân cận (`LAO`, `KHM`, `CHN`, `THA`, `MMR`)** | Natural Earth 1:10m Cultural Vectors (`ne_10m_admin_0_countries`) | `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson` (tỷ lệ 1:10m) | **Public Domain (CC0 / No Rights Reserved)** | Đường bờ biển tự nhiên của đất liền Việt Nam, 13 đảo ngoài khơi (Phú Quốc, Côn Đảo, Cát Bà...) và đường bao bối cảnh Lào, Campuchia, miền nam Trung Quốc (kèm Hải Nam), Thái Lan, Myanmar |
| **Hệ thống sông chính** | Natural Earth 1:10m Physical Vectors (`ne_10m_rivers_lake_centerlines`) | `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson` (tỷ lệ 1:10m) | **Public Domain (CC0 / No Rights Reserved)** | 57 đoạn sông lớn trực tiếp từ Natural Earth + 9 đoạn sông nhánh tham chiếu khu vực gắn nhãn tường minh `SUPPLEMENTARY_HYDROGRAPHIC_REFERENCE` (tổng 66 đoạn) |
| **Độ cao địa hình 72 tâm vùng & 6 đỉnh núi tiêu biểu** | NASA SRTM 90m DEM (SRTMGL3) | Truy vấn tại thời điểm build qua `https://api.opentopodata.org/v1/srtm90m` (đóng gói tĩnh, không gọi mạng ngoài khi runtime) | **Public Domain (NASA / USGS)** | Độ cao trung bình & độ cao đỉnh (`elevationSource: "NASA_SRTM_90M_PUBLIC_DOMAIN"`) cho toàn bộ 72 vùng và 6 đỉnh núi (Fansipan 3104m, Pu Si Lung 3007m, Ngọc Linh 2499m, Chư Yang Sin 2245m, Langbiang 1922m, Bà Đen 401m) |
| **Tọa độ 24 thành phố / đô thị trọng điểm** | Tọa độ địa lý WGS84 công cộng | Ánh xạ vào đúng `regionId` thuộc `reg_vn_01`..`reg_vn_72` | **Public Domain geographic coordinates** | 24 đô thị (2 thủ đô, đô thị lớn và thị xã chiến lược) gắn cờ cảng biển & độ cao SRTM |

## 3. Phương pháp xử lý dữ liệu

1. **Cắt khung chiến trường & đơn giản hóa đường bao:** Đa giác quốc gia lân cận được cắt theo khung `[98.6..113.8, 6.2..25.2]` bằng `polygon-clipping`, đơn giản hóa bằng thuật toán Douglas–Peucker (dung sai `0.014°` cho nước lân cận), chuẩn hóa vòng khép kín ngược chiều kim đồng hồ (RFC 7946 CCW) và làm tròn tọa độ 4 chữ số thập phân.
2. **Phân vùng 72 khu vực hữu cơ bảo toàn tuyệt đối ID cũ:**
   - Từ 72 điểm neo tọa độ thực trải dọc lãnh thổ Việt Nam (`23.1°N` tới `8.65°N`), sử dụng `d3-delaunay` sinh tế bào Voronoi.
   - Các cạnh Voronoi nội bộ được làm cong hữu cơ tất định (`organicEdgePoints`) theo hướng chuẩn hóa để hai vùng kề nhau chia sẻ đúng cùng chuỗi đỉnh ngược chiều (không khe hở, không chồng lấn).
   - Toàn bộ 72 tế bào được cắt giao chính xác bằng đường bờ biển thực tế của Việt Nam (`polygon-clipping.intersection`) và giữ nguyên toàn bộ 72 mã `reg_vn_01`..`reg_vn_72` (từ 13 đến 106 đỉnh mỗi vùng).
3. **Đồ thị liên thông & 98 hành lang giao thông 4 cấp:**
   - Sinh quan hệ kề đối xứng giữa các vùng kề Voronoi + bổ sung cầu nối đảm bảo đồ thị liên thông 72/72 vùng (0 vùng mồ côi).
   - Gắn 98 hành lang vector (`PRIMARY_ROAD`: 37, `SECONDARY_ROAD`: 31, `RAILWAY`: 22, `RIVER_CROSSING`: 8) cùng `movementModifierFp` và `movementCostFp` phục vụ Movement Engine tương lai.

## 4. Ranh giới giữa Dữ liệu Địa lý Thực và Dữ liệu Gameplay Hư cấu

- **Địa lý tự nhiên thực tế:** Đường bờ biển Việt Nam, lãnh thổ bối cảnh Lào/Campuchia/miền nam Trung Quốc/Thái Lan/Myanmar, hệ thống sông chính, độ cao NASA SRTM 90m và vị trí địa lý các đỉnh núi/đô thị.
- **Dữ liệu gameplay lịch sử thay thế hư cấu (1955):** Phân vùng 72 khu vực, tên gọi chiến lược, 98 hành lang giao thông 4 cấp, chỉ số sản lượng/hạ tầng/hậu cần ban đầu và phe kiểm soát khởi điểm.
- **Khẳng định bắt buộc trong hợp đồng:**
  - `eraLabel = "ALTERNATE_HISTORY_1955_FICTIONAL_NETWORK"`
  - `modernRoadsUsedAsHistorical = false`
  - `modernAdminBordersUsedAsHistorical = false`
- Không sử dụng địa giới hành chính hiện đại hay đường cao tốc hiện đại làm dữ kiện lịch sử đã được xác minh.
