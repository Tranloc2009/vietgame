# ADR-0003: Nền tảng Bản đồ Địa lý Chân thực 72 Vùng (P02-05)

- **Trạng thái:** Đã triển khai (Chờ Game Director nghiệm thu)
- **Ngày:** 2026-11-26
- **Phạm vi:** `scripts/buildGeographicMapData.ts`, `src/content/geo/vietnam72WorldData.json`, `src/content/worldMap72.ts`, `src/contracts/rooms.ts`, `src/web/mapLayerRegistry.ts`, `src/web/StrategicMap.tsx`

## 1. Bối cảnh & Mục tiêu

Ở `P02-03` và `P02-04`, bản đồ 72 vùng sử dụng đa giác ô lưới hình chữ nhật để xác minh hợp đồng GeoJSON, liên thông đồ thị và 4 lớp hiển thị. Ở `P02-05`, mục tiêu là nâng cấp trực tiếp thành bản đồ địa lý chiến lược chân thực (phong cách bản đồ chiến lược lịch sử — quân sự lấy cảm hứng bố cục từ Supremacy WW3, không sao chép mã nguồn hay tài sản độc quyền) mà **không làm vỡ** bất kỳ bất biến, ID vùng, API hay dữ liệu SQLite hiện có.

## 2. Quyết định kiến trúc

1. **Nguồn dữ liệu địa lý mở, giấy phép rõ ràng (Public Domain):**
   - Đường bờ biển Việt Nam, quần đảo ven bờ và lãnh thổ bối cảnh (Lào, Campuchia, miền nam Trung Quốc, Thái Lan, Myanmar): **Natural Earth 1:10m Cultural Vectors (`ne_10m_admin_0_countries`)**, giấy phép **Public Domain**.
   - Hệ thống sông chính (Sông Hồng, Sông Đà, Sông Lô, Sông Mê Kông, v.v.): **Natural Earth 1:10m Physical Vectors (`ne_10m_rivers_lake_centerlines`)**, giấy phép **Public Domain**, kết hợp nhãn tham chiếu phụ cho một số nhánh sông nội địa.
   - Độ cao địa hình (72 tâm vùng + 6 đỉnh núi tiêu biểu): **NASA SRTM 90m DEM** (Public Domain, truy vấn một lần tại bước build qua OpenTopoData và đóng gói tĩnh vào `src/content/geo/vietnam72WorldData.json` để runtime không phụ thuộc mạng ngoài và tất định 100%).

2. **Tách biệt rạch ròi Địa lý tự nhiên vs Gameplay lịch sử thay thế 1955:**
   - Đường bờ biển, độ cao SRTM, đỉnh núi và dòng sông lớn là dữ liệu địa lý tự nhiên.
   - Ranh giới 72 vùng chiến lược (`reg_vn_01`..`reg_vn_72`) được tạo từ phân vùng hữu cơ Voronoi cắt theo đường bờ biển thực tế của Việt Nam, **không dùng địa giới hành chính hiện đại làm dữ kiện lịch sử** (`modernAdminBordersUsedAsHistorical: false`).
   - 98 hành lang giao thông 4 cấp (`PRIMARY_ROAD`, `SECONDARY_ROAD`, `RAILWAY`, `RIVER_CROSSING`) mô hình hóa mạng di chuyển hư cấu bối cảnh 1955 (`modernRoadsUsedAsHistorical: false`, `eraLabel: "ALTERNATE_HISTORY_1955_FICTIONAL_NETWORK"`).

3. **Bảo toàn 100% tương thích ngược & Chuẩn bị Movement Engine:**
   - Giữ nguyên tuyệt đối 72 `RegionId` (`reg_vn_01`..`reg_vn_72`), hợp đồng `CONTRACT_SCHEMA_VERSION = "1.0.0"`, toàn bộ Game Engine, SQLite database và các bài test hiện có.
   - Bổ sung trường additive cho Movement Engine tương lai (`movementCostFp`, `terrainFeatures`, `forestCoverFp`, `urbanizationFp`, `movementModifierFp`) mà **không** xây dựng Combat Engine trước lộ trình.
   - Tách `src/web/mapLayerRegistry.ts` với 4 lớp hoạt động (`POLITICAL`, `TERRAIN`, `ECONOMY`, `INFRASTRUCTURE`) và các khe chờ kiến trúc (`MILITARY`, `WEATHER`, `POLITICAL_INFLUENCE`).

4. **Hiển thị tự chứa & Dự phòng SVG tương đương địa lý:**
   - MapLibre GL sử dụng style vector tự chứa 100% (không gọi tile server hay glyph server bên ngoài dễ lỗi CORS/mạng) và chiếu nhãn tiếng Việt sắc nét đồng bộ qua `map.project()`.
   - Chế độ dự phòng SVG kết xuất cùng bộ đa giác hữu cơ 72 vùng, quốc gia lân cận, sông, 4 cấp đường giao thông và 24 thành phố, bảo đảm trải nghiệm tương tác đầy đủ trên cả desktop và mobile không có WebGL.

## 3. Hệ quả

- Dung lượng gói dữ liệu tĩnh `vietnam72WorldData.json` khoảng ~190 KB, nạp nhanh dưới vài chục mili-giây cả khi không có internet ngoài.
- Khi cần tái tạo dữ liệu địa lý hoặc cập nhật độ phân giải, chạy lại `npx tsx scripts/buildGeographicMapData.ts`.
