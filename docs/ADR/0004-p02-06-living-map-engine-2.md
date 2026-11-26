# ADR-0004: P02-06 — Operation Living Map (Strategic Map Engine 2.0)

- **Trạng thái:** Đề xuất & Đã triển khai (Chờ Game Director duyệt)
- **Ngày:** 2026-11-26
- **Liên quan:** `P02-05` (`ADR-0003`), `P02-04`, `P02-03`, `P01-02` (`ADR-0001`)

## 1. Bối cảnh & Mục tiêu

Sau `P02-05`, ứng dụng đã sở hữu tập dữ liệu địa lý thực tế (72 đa giác hữu cơ cắt theo đường bờ biển Natural Earth 1:10m, độ cao NASA SRTM 90m, 24 thành phố, 6 đỉnh núi, 66 đoạn sông và 98 hành lang giao thông 4 cấp), nhưng bản đồ vẫn được trình bày trong giao diện dạng tài liệu có cuộn dọc, nhiều thẻ trắng và thiếu trải nghiệm workspace chiến lược toàn màn hình trên desktop & di động.

`P02-06` nâng cấp tầng hiển thị lên **Strategic Map Engine 2.0** với các nguyên tắc bắt buộc:
1. **Bảo toàn tuyệt đối 100% bất biến nền tảng `P01-01` → `P02-05`:** đúng 2 người chơi thật (`NORTH`/`SOUTH`), NPC độc lập, kiến trúc server-authoritative, đồng hồ UTC 1:1 (không tua nhanh), SQLite migrations `001` & `002` không reset, 72 mã vùng `reg_vn_01`..`reg_vn_72`, 98 hành lang, 24 thành phố, 27 bài kiểm thử hồi quy gốc, không rò rỉ `serverPrivate`, không dùng API AI/bản đồ trả phí.
2. **Không gian làm việc chiến lược toàn màn hình (`h-dvh w-screen overflow-hidden`):** bản đồ là giao diện trung tâm duy nhất; công cụ chẩn đoán kỹ thuật P01 (`SystemStatusPanel`, `MatchSimulationPanel`) được tách sang Developer/Diagnostics workspace độc lập nhưng vẫn đầy đủ chức năng.
3. **Thẩm mỹ Bản đồ Chiến lược Quân sự (Cartographic Military Atlas):** loại bỏ màu neon/glassmorphism; xây dựng bảng màu bản đồ địa hình kết hợp lớp phủ chính trị bán trong suốt (`terrainBlendOpacity`) để luôn nhìn thấy địa hình bên dưới chủ quyền.

## 2. Quyết định Kiến trúc

### 2.1. Phân tách Pure Engine Modules (`src/web/map/`)
Toàn bộ logic bản đồ không phụ thuộc DOM được tách thành các module thuần có thể kiểm thử đơn vị bằng `node:test`:
- `src/web/map/designTokens.ts`: hệ thống token bản đồ & giao diện phòng tác chiến (`MAP_TOKENS`, `getFactionVisual`).
- `src/web/map/cameraEngine.ts`: phân cấp **Semantic Zoom 5 cấp (`L1`–`L5`)**, 7 preset camera chiến lược (`INDOCHINA_OVERVIEW`, `VIETNAM_NATIONAL`, `NORTH_VIETNAM`, `CENTRAL_VIETNAM`, `SOUTH_VIETNAM`, `CAPITAL_NORTH`, `CAPITAL_SOUTH`), kẹp giới hạn `PLAYABLE_MAX_BOUNDS` (`[[88.0, 3.0], [124.0, 29.0]]`) và lưu vị trí camera theo phiên RAM (`saveSessionCamera`/`loadSessionCamera`).
- `src/web/map/graphicsSettings.ts`: 4 mức chất lượng đồ họa (`LOW`, `MEDIUM`, `HIGH`, `ULTRA`), tự động chọn theo khả năng thiết bị/viewport/reduced-motion, và bộ điều hợp khí quyển/thời tiết **chỉ mang tính trang trí (`gameplayEffect: 'NONE_COSMETIC_ONLY'`)**.
- `src/web/map/settlementCatalog.ts`: phân cấp 24 thành phố (`NATIONAL_CAPITAL`, `MAJOR_CITY`, `PORT_CITY`, `TRANSPORT_HUB`, `REGIONAL_CITY`, `STRATEGIC_SETTLEMENT`), thuật toán tránh va chạm nhãn theo độ ưu tiên (`resolveLabelCollisions`) và tìm kiếm tiếng Việt không dấu (`searchMapEntities`).
- `src/web/map/terrainRelief.ts`:
  - Trình tạo bóng đổ địa hình 2D hướng Tây Bắc 315° (`generateSrtmHillshadeDataUrl`) nội suy IDW từ 72 điểm độ cao vùng & 6 đỉnh núi **NASA SRTM 90m**, cắt mặt nạ chính xác theo 72 đa giác đường bờ biển Việt Nam (`source-in`) để không lem sang Biển Đông hoặc các quốc gia lân cận.
  - Bộ trích xuất biên giới quốc gia & biên giới phe động (`extractDynamicNationalBorders`) tính trực tiếp từ `match.regions[regionId].controllerNationId` — **tuyệt đối không hardcode đường biên chính trị vào hình học tĩnh**.
- `src/web/map/militaryAdapter.ts`: nền tảng hiển thị quân sự tương lai (`MILITARY_ICON_REGISTRY`, `projectAuthorizedMilitaryEntities`) tuân thủ tuyệt đối fog-of-war (`redactedUnitIds`) và **không bao giờ tạo đơn vị giả** khi trận đấu chưa kích hoạt.

### 2.2. Map Mode Registry 2.0 (`src/web/mapLayerRegistry.ts`)
Giữ nguyên 100% chữ ký xuất của `P02-05`, đồng thời nâng cấp metadata cho 4 chế độ đang hoạt động (`POLITICAL`, `TERRAIN`, `INFRASTRUCTURE`, `ECONOMY`) gồm `terrainBlendOpacity`, `dataRequirements`, `visibilityRules`, `authorizationRules`, `layerOrdering`, `fallbackBehavior`, `updateStrategy`, và đăng ký tường minh 8 chế độ khóa lộ trình tương lai (`MILITARY`, `SUPPLY_LOGISTICS`, `DIPLOMACY`, `INTELLIGENCE_FOG`, `POLITICAL_STABILITY`, `REBELLION_RESISTANCE`, `NAVAL_AIR_CONTROL`, `WEATHER`).

### 2.3. Chu trình Kết xuất MapLibre GL Hiệu năng cao & Dự phòng SVG
- `src/web/StrategicMap.tsx` khởi tạo đối tượng `maplibregl.Map` **đúng 1 lần** theo vòng đời dữ liệu/renderer. Mọi thay đổi lớp bản đồ, chọn vùng, cập nhật WebSocket delta chỉ cập nhật nguồn GeoJSON (`setData`) và thuộc tính sơn (`setPaintProperty`/`setLayoutProperty`) tăng dần — không bao giờ tái tạo bản đồ hay đặt lại camera.
- Hiệu ứng hover trên desktop dùng MapLibre `setFeatureState` (không tái tạo GeoJSON trên `mousemove`).
- Xử lý sự kiện `webglcontextlost` và lỗi WebGL bằng chuyển đổi tự động sang `src/web/components/SvgFallbackMap.tsx` — bản đồ vector SVG tương tác đầy đủ (kéo-thả, phóng-thu, chọn vùng/đô thị, cả 4 chế độ, biên giới động, sông ngòi, 98 hành lang 4 cấp).
- Không sử dụng `backdrop-filter`/`backdrop-blur` phía trên canvas WebGL để giữ hiệu năng ổn định trên thiết bị tầm trung và di động.

### 2.4. Kiến trúc Giao diện Thích ứng (Desktop / Tablet / Mobile)
- **Desktop (`>= 768px`):** `TopCommandBar` (`h-11`), `LeftNavRail` dọc (`w-14`), `ContextualInspector` bên phải có thể thu gọn + accordion, `StrategicMinimap` SVG nhẹ góc dưới-trái có khung viewport trực tiếp và kéo/nhấn điều hướng, `BottomModeDock` giữa-dưới, `MapControlsCluster` góc dưới-phải, phím tắt (`1`–`4`, `+`/`-`, `0`, `/`, `Esc`, `F`).
- **Mobile (`< 768px`):** bản đồ tràn mép toàn màn hình (`touch-action: none` trên canvas), thanh tài nguyên gọn, điều hướng dưới có hỗ trợ `env(safe-area-inset-bottom)` cho iPhone, `ContextualInspector` dạng **Bottom Sheet 3 trạng thái (`collapsed` / `half` / `full`)** hỗ trợ vuốt chạm, ẩn minimap trên màn hình nhỏ, đảm bảo `scrollWidth <= innerWidth` ở cả chế độ dọc (`390×844`, `375×667`) và ngang (`844×390`).

## 3. Đường ống Dữ liệu & Minh bạch Nguồn gốc (Asset & Provenance Disclosure)

- **Hệ quy chiếu tọa độ (CRS):** WGS84 (`EPSG:4326`) cho GeoJSON, chiếu Web Mercator (`EPSG:3857`) trong MapLibre GL và chiếu equirectangular chuẩn hóa trong SVG Fallback & Minimap.
- **Dữ liệu địa lý tự nhiên (Public Domain):**
  - **Natural Earth 1:10m** (Public Domain): biên giới quốc gia bối cảnh Đông Dương (Việt Nam, Lào, Campuchia, Thái Lan, Nam Trung Quốc, Myanmar), đường bờ biển thực tế, quần đảo ven bờ và 66 đoạn sông chính/phụ.
  - **NASA SRTM 90m DEM** (Public Domain): giá trị độ cao trung bình & độ cao đỉnh của 72 vùng chiến lược và 6 đỉnh núi tiêu biểu (Fansipan, Pu Si Lung, Ngọc Linh, Chư Yang Sin, Langbiang, Bà Đen).
- **Công bố minh bạch về xấp xỉ trực quan:**
  - **Bóng đổ địa hình (Hillshade):** do môi trường offline-first không đóng gói bộ raster DEM 30m toàn quốc, lớp bóng đổ là *Cartographic Hillshade Approximation* 2D nội suy từ 72 điểm độ cao vùng + 6 đỉnh núi SRTM 90m, cắt mặt nạ theo đường bờ biển thực tế; không trình bày là mô hình DEM 30m liên tục.
  - **Đổ bóng ven bờ (Coastal Shading):** các dải halo xanh ven bờ là hiệu ứng thẩm mỹ bản đồ học (*visual cartographic styling*), không phải dữ liệu đo sâu thủy văn (*scientific bathymetry*).
  - **Tách biệt Lịch sử thay thế 1955:** 72 vùng lãnh thổ và 98 hành lang giao thông 4 cấp là đồ thị gameplay lịch sử thay thế trừu tượng (`modernRoadsUsedAsHistorical: false`, `modernAdminBordersUsedAsHistorical: false`).

## 4. Hệ quả & Khả năng Mở rộng
- Sẵn sàng gắn trực tiếp **Phase 03** (Combat / Movement / Diplomacy / Logistics / Fog-of-War) thông qua `militaryAdapter.ts`, `FUTURE_MAP_MODES_REGISTRY`, và hệ thống biên giới động mà không cần thay đổi cấu trúc camera, contract `1.0.0`, hay schema SQLite.
