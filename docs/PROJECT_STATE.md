# Trạng thái Dự án & Điểm mốc — VIETNAM: THE DIVIDED NATION

## 1. Điểm mốc (Checkpoints) Chính thức

| Checkpoint | Phạm vi bao gồm | Trạng thái phê duyệt | Ghi chú |
| --- | --- | --- | --- |
| **`P01-COMPLETE`** | `P01-01`, `P01-02`, `P01-03` | Nghiệm thu nội bộ kèm `P02-COMPLETE` | Nền tảng kiến trúc, Hợp đồng dữ liệu `1.0.0`, Simulation Engine thuần túy & Replay SHA-256 |
| **`P02-COMPLETE`** | `P02-01`, `P02-02`, `P02-03`, `P02-04`, `P02-05` | **APPROVED BY GAME DIRECTOR** (*Geographic Map Foundation*) | Hoàn tất Multiplayer 2 slot Bắc/Nam + NPC độc lập, SQLite persistent + UTC Scheduler, Bản đồ địa lý 72 vùng chân thực |
| **`P03-01..03`** | Giai đoạn 03 — Kinh tế 8 Tài nguyên, Ngân sách (Laffer/Nợ có Trần) & 8 Công trình/Nhà máy | **IMPLEMENTED — CHỜ GAME DIRECTOR NGHIỆM THU** | Hoàn tất đủ `P03-01`, `P03-02`, `P03-03` tương thích ngược 100%, 40/40 bài kiểm thử tự động pass, đối soát 8/8 & replay SHA-256 sau restart |

> **Ghi chú trung thực về Git:** Môi trường Google AI Studio Build hiện không có thư mục `.git` được khởi tạo sẵn; điểm mốc **`P02-COMPLETE`** và báo cáo nghiệm thu **Giai đoạn 03 (`P03-01`, `P03-02`, `P03-03`)** được chốt trong hệ thống tài liệu nguồn sự thật (`docs/PROJECT_STATE.md`, `docs/PROGRESS.md`, `docs/ADR/0005-phase03-economy-budget-facilities.md`) và Game Director có thể tạo snapshot / đồng bộ GitHub bằng giao diện AI Studio.

---

## 2. Tài sản Cốt lõi Đang được Bảo toàn Nguyên vẹn

- **Cơ sở dữ liệu SQLite:** `./data/vdn-preview.sqlite` (Preview) — bảo toàn toàn bộ bảng & bản ghi từ Migration `001_initial_foundation`, `002_phase02_multiplayer_clock`, và `003_match_scoped_log_uniqueness`, không xóa dữ liệu, không phá tương thích ngược.
- **Bản đồ & Dữ liệu Địa lý (`P02-05`):**
  - Chính xác **72 `RegionId`** bất biến (`reg_vn_01`..`reg_vn_72`).
  - Chính xác **98 hành lang giao thông** 4 cấp (`PRIMARY_ROAD`, `SECONDARY_ROAD`, `RAILWAY`, `RIVER_CROSSING`).
  - Chính xác **24 thành phố**, **6 đỉnh núi**, **66 đoạn sông**, **5 quốc gia bối cảnh** (`CHN`, `KHM`, `LAO`, `THA`, `MMR`), **13 đảo ven bờ**.
  - Kiểm chứng tự động **0 sai lệch** giữa dữ liệu hiển thị (`WORLD_MAP_72_GEOJSON` / `WORLD_GEO_LAYERS`) và dữ liệu gameplay authoritative (`createWorld72MatchState()`).
- **Bộ kiểm thử tự động:** Bảo toàn toàn bộ **33 bài kiểm thử nền tảng (P01 + P02 + legacy economy)** và bổ sung **7 bài kiểm thử chuyên sâu Phase 03** (`src/simulation/phase03.test.ts`) → tổng **40/40 pass**.
- **Không dùng AI API trả phí:** `0` lời gọi Gemini/LLM API trong toàn bộ mã nguồn runtime.

---

## Bản tích hợp sau `eaadb11` — P03-01 đến P03-03

Kho và sổ cái, ngân sách, xây dựng và sản xuất đã được kết nối vào menu **Kinh tế** của phòng đấu. Từ bảng vùng đang kiểm soát, người chơi mở thẳng tab **Công trình** với vùng đặt sẵn. Các lệnh dùng cùng đường kiểm quyền và xác nhận của máy chủ. Báo cáo và sự kiện kinh tế riêng được lọc theo phe trên snapshot, đồng bộ và WebSocket. Không thêm migration hoặc thay đổi dữ liệu 72 vùng, 98 hành lang, 24 thành phố.

**Bằng chứng:** TypeScript và build đạt. 48/48 test tự động đạt, gồm kinh tế, replay và phục hồi qua restart. Chrome ở 1440×900 và 390×844 với hai phiên xác thực đã đọc 8 dòng sổ cái, mở dự báo ngân sách, đặt và hủy công trình từ đúng vùng. Phiên đối phương nhận delta theo sequence và không nhận dữ liệu lệnh xây. Các thử nghiệm trình duyệt dùng SVG dự phòng và SQLite test. Production chưa phát hành.

## 3. Hạng mục Đã Chuyển sang Backlog (Không Triển khai Sớm)

- **Backlog `P11` (Operation Immersion):** Toàn bộ nâng cấp đồ họa bản đồ cao cấp (hillshade DEM đa góc, texture cartography lịch sử, bathymetry Biển Đông, tuyến hậu cần/tiền tuyến động, LOD WebGL đa tầng, lớp thời tiết trực quan) đã được lưu chi tiết tại `docs/GEO_DATA_PROVENANCE.md` mục 3.
- **Nhiệm vụ tiếp theo sau khi Game Director phê duyệt Giai đoạn 03 (`P03-01..03`):** Giai đoạn 04 (`P04-01` — Quân sự, Hậu cần & Di chuyển trên mạng 98 hành lang) — **CHƯA triển khai**, dừng chờ quyết định của Game Director.
