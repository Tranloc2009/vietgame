# ADR-0002: Kiến trúc Phòng đấu 2 Slot, Đồng hồ UTC, Bản đồ 72 Vùng và Đồng bộ Lọc quyền (Phase 02)

- **Trạng thái:** Accepted (Tương thích ngược hoàn toàn với `CONTRACT_SCHEMA_VERSION = 1.0.0` và toàn bộ API/DB Giai đoạn 01)
- **Phạm vi:** `P02-01`, `P02-02`, `P02-03`, `P02-04`

## Bối cảnh

Giai đoạn 02 mở rộng nền tảng single-fixture ở Giai đoạn 01 thành thế giới multiplayer 2 người chơi thật (`NORTH` / `SOUTH`), có lưu trữ SQLite an toàn khi khởi động lại, đồng hồ UTC authoritative trên server, bản đồ 72 vùng bằng MapLibre GL và đồng bộ WebSocket lọc quyền.

## Quyết định

1. **Danh tính & Bảo mật phiên (`P02-01`):**
   - Dùng `crypto.scryptSync` + salt ngẫu nhiên 16 byte cho mật khẩu; không dùng thư viện mã hóa ngoài.
   - Phiên dùng opaque Bearer token 256-bit lưu dưới dạng hash SHA-256 trong bảng `user_sessions`. Client giữ token hoàn toàn trong React memory state (không ghi `localStorage`/`sessionStorage`).
   - Toàn bộ route phòng đấu nằm ở `/api/rooms/*` và khóa chặt các trận thuộc `match_rooms` khỏi route P01 `/api/matches/:matchId/commands`.

2. **Migration tiến tới `002_phase02_multiplayer_clock` & Scheduler (`P02-02`):**
   - Thêm 6 bảng mới (`users`, `user_sessions`, `match_rooms`, `match_snapshots`, `match_worker_locks`, `scheduled_ticks`) mà không sửa hay xóa dữ liệu P01.
   - `MatchClockScheduler` sử dụng lease lock trên SQLite và `idempotencyKey` tất định `idem_tick_<matchId>_<targetUtc>` để bảo đảm không mất và không chạy trùng job khi khởi động lại.
   - `exportMatchBackup` / `restoreMatchBackup` chạy ở tầng server; endpoint client `/api/rooms/:matchId/backup-summary` không bao giờ trả `serverPrivate`.

3. **Bản đồ 72 vùng tự chứa & Dự phòng SVG (`P02-03`):**
   - Dùng 72 đa giác GeoJSON RFC 7946 liên thông 100% đặt trên MapLibre GL với style tự chứa (không phụ thuộc tile bên thứ 3 dễ lỗi CORS/mạng) kèm cơ chế tự chuyển sang SVG vector có kéo-thả/phóng-thu khi thiết bị không có WebGL.
   - Ghi rõ siêu dữ liệu `modernRoadsUsedAsHistorical: false` và nguồn tham chiếu Natural Earth / NASA SRTM DEM (Public Domain).

4. **Đồng bộ lọc quyền & Gap Resync (`P02-04`):**
   - `projectMatchForViewer` vừa cắt `serverPrivate`, vừa ẩn `readinessFp`/`supplyFp` của đơn vị đối phương (fog-of-war).
   - `src/web/syncClient.ts` tách rời logic xử lý `room:delta` thành hàm thuần túy để dễ unit test phát hiện gap, đệm delta lệch thứ tự và exponential backoff.

## Hệ quả

- Toàn bộ 16 test Giai đoạn 01 tiếp tục chạy xanh không cần chỉnh sửa hợp đồng.
- Có đầy đủ test tự động phủ quy trình 2 người chơi, chặn người thứ 3, chặn giả mạo, khởi động lại giữa job, backup/restore SHA-256, đồ thị 72 vùng và đồng bộ fog-of-war.
