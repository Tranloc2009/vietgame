# Kiến trúc hệ thống — VIETNAM: THE DIVIDED NATION

## 1. Tổng quan phân lớp

Ứng dụng giữ nguyên entrypoint tương thích Google AI Studio Build (`index.html`, `src/main.tsx`, `src/App.tsx`, `server.ts` trên cổng `3000`) và tách rạch ròi 6 miền trách nhiệm theo thư mục:

| Module | Đường dẫn | Trách nhiệm chính | Ràng buộc phụ thuộc |
| --- | --- | --- | --- |
| **Contracts** | `src/contracts/` | ID bất biến, Zod runtime schema, semver compatibility, fixed-point int, canonical JSON, client projection | Không phụ thuộc `server`, `simulation`, `web` |
| **Simulation** | `src/simulation/` | Pure reducer, `SimulationClock` injectable, server-only seeded PRNG, invariants, SHA-256 hash, replay | Chỉ phụ thuộc `contracts` và `node:crypto` |
| **Content** | `src/content/` | Dữ liệu kịch bản lịch sử thay thế trừu tượng & fixture 2 phe + NPC | Chỉ phụ thuộc `contracts` và `simulation` |
| **Server** | `src/server/`, `server.ts` | Config loader, SQLite persistent + migrations, Express HTTP API, WebSocket `/ws` | Phụ thuộc `contracts`, `simulation`, `content` |
| **Web UI** | `src/web/`, `src/App.tsx` | Màn hình khởi đầu tối giản, trạng thái kết nối thực, kiểm chứng lệnh & replay | Chỉ phụ thuộc `contracts` (kiểu public & formatter), không import `server`/`simulation` |
| **Docs** | `docs/`, `README.md` | Kiến trúc, hợp đồng, ADR, tiến độ | Tài liệu nguồn sự thật |

## 2. Luồng xử lý lệnh Authoritative

```
Client UI (header x-actor-id + Command JSON)
  │
  ▼ POST /api/matches/:matchId/commands
Express API (src/server/createApp.ts)
  ├── 1. Kiểm tra x-actor-id khớp command.actorId (chặn giả mạo actor)
  ├── 2. Parse & validate Zod schema + Contract Semver (P01-02)
  ▼
SQLite Transaction (src/server/db/sqliteStore.ts)
  ├── 3. Đọc MatchState authoritative từ bảng `matches`
  ├── 4. Gọi pure reducer `reduceCommand(state, command, pinnedClock)` (P01-03)
  │     ├── Kiểm tra idempotencyKey + payloadDigest
  │     ├── Kiểm tra expectedVersion & actor.lastSequence
  │     ├── Kiểm tra quyền sở hữu phe & số dư fixed-point
  │     ├── Chuyển trạng thái bất biến + sắp xếp sự kiện đồng thời ổn định
  │     └── Xác minh toàn bộ `assertSimulationInvariants(nextState)`
  ├── 5. Ghi nguyên tử vào `matches`, `command_log`, `event_log`
  ▼
WebSocket Broadcast (/ws)
  └── 6. Phát `match:events` tới các client đang kết nối (đã lọc bỏ `serverPrivate`)
```

## 3. Lưu trữ bền vững & Migration (SQLite)

- Sử dụng `better-sqlite3` với `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`.
- Bảng `schema_migrations` đảm bảo mọi migration chạy một lần và idempotent.
- **Migration `001_initial_foundation`**:
  - `matches`: lưu `initial_state_json`, `current_state_json`, `version`, `state_hash`.
  - `command_log`: lưu chuỗi lệnh đã commit kèm `applied_at_utc` và khóa duy nhất `(match_id, idempotency_key)` phục vụ deterministic replay.
  - `event_log`: lưu toàn bộ sự kiện domain theo thứ tự `sequence`.
  - `health_probes`: phục vụ kiểm tra khả năng ghi thực tế của DB qua `/api/health`.
- Tách biệt môi trường:
  - `APP_ENV=preview` mặc định ghi vào `./data/vdn-preview.sqlite` và cho phép tạo fixture kiểm thử.
  - `APP_ENV=production` bắt buộc cấu hình tường minh `SQLITE_DB_PATH` (không chấp nhận `:memory:` hoặc rỗng) và khóa cứng endpoint tạo fixture (`403 PREVIEW_FIXTURE_DISABLED`).

## 4. Ranh giới bảo mật & Bí mật

- `serverPrivate` (bao gồm `initialSeed`, `rngState`, `hiddenIntelDigest`) chỉ tồn tại trên server và trong SQLite. Mọi response API/WebSocket đều đi qua `projectMatchForClient` hoặc `projectMatchForViewer` để loại bỏ hoàn toàn trường này.
- Mọi truy vấn SQL đều dùng prepared statements có tham số hóa.
- Không tồn tại lời gọi tới Gemini API hay bất kỳ dịch vụ AI trả phí nào trong mã nguồn runtime.

## 5. Mở rộng Giai đoạn 02 — Phòng đấu, Đồng hồ UTC, Bản đồ 72 vùng & Đồng bộ lọc quyền

- **Xác thực & Phòng đấu 2 slot (`P02-01`):**
  - Tài khoản lưu mật khẩu băm `scrypt` kèm salt ngẫu nhiên (`users`), phiên dùng Bearer token lưu hash SHA-256 trong `user_sessions` (client chỉ giữ token trong RAM React state, không ghi `localStorage`/`sessionStorage`).
  - Mỗi phòng đấu (`match_rooms`) sinh mã mời `VDN-XXXX-XXXX`, cưỡng chế tối đa đúng 2 slot người thật (`NORTH` / `SOUTH`). Khi cả 2 slot đã `ready` và `start`, phòng chuyển sang `ACTIVE` và khóa slot (`locked_at_utc`). Người chơi thứ 3 bị từ chối (`403 ROOM_FULL` / `SLOTS_LOCKED`), trong khi thành viên cũ kết nối lại luôn giữ nguyên slot gốc.
  - Mọi lệnh gửi qua `POST /api/rooms/:matchId/commands` được server đối chiếu `userId -> locked slot -> actorId & nationId`, chặn tuyệt đối mạo danh phe đối phương hoặc lệnh `ADVANCE_REALTIME_TICK` từ client.
- **Migration `002_phase02_multiplayer_clock` & Scheduler (`P02-02`):**
  - Bổ sung bảng `users`, `user_sessions`, `match_rooms`, `match_snapshots`, `match_worker_locks`, `scheduled_ticks` (forward-only, giữ nguyên 100% dữ liệu P01).
  - `MatchClockScheduler` (`src/server/scheduler.ts`) tiến hành catch-up theo đồng hồ UTC server (tick `60s` hoặc hạn `completesAtUtc` sớm nhất), dùng lease lock theo từng trận (`match_worker_locks`) và `idempotencyKey` tất định (`idem_tick_<matchId>_<targetUtc>`) nên khởi động lại giữa chừng không mất hoặc lặp tác vụ.
  - `SqliteMatchStore.exportMatchBackup` / `restoreMatchBackup` xác minh toàn bộ replay SHA-256 trước khi khôi phục nguyên tử; route client `GET /api/rooms/:matchId/backup-summary` chỉ trả tóm tắt không bí mật (`secretsIncluded: false`).
- **Bản đồ nền 72 vùng (`P02-03`):**
  - `src/content/worldMap72.ts` sinh tập 72 đa giác GeoJSON hợp lệ (RFC 7946, ngược chiều kim đồng hồ, liên thông 100%, không vùng mồ côi) với siêu dữ liệu địa hình/độ cao tham chiếu Natural Earth & NASA SRTM DEM (Public Domain), và gắn cờ tường minh `modernRoadsUsedAsHistorical: false`.
  - UI `src/web/StrategicMap.tsx` dùng MapLibre GL và tự động dự phòng bằng bản đồ vector SVG có kéo-thả/phóng-thu nếu WebGL hoặc tile gặp lỗi.
- **Đồng bộ thời gian thực & 4 lớp bản đồ (`P02-04`):**
  - WebSocket `/ws` hỗ trợ `room:subscribe` (xác thực Bearer token + thành viên phòng), đẩy `room:snapshot` đã lọc qua `projectMatchForViewer` (ẩn `serverPrivate` và che chỉ số `readinessFp`/`supplyFp` của đơn vị phe đối lập theo fog-of-war), phát `room:delta` theo `sequence`, và hỗ trợ `room:resync` / `GET /api/rooms/:matchId/sync?sinceSequence=...`.
  - Client `src/web/syncClient.ts` phát hiện thiếu sequence (gap), đệm delta lệch thứ tự, tự kích hoạt resync và dùng exponential backoff khi reconnect.
- **Nền tảng Bản đồ Địa lý Chân thực (`P02-05`):**
  - Pipeline tái lập `scripts/buildGeographicMapData.ts` tải trực tiếp dữ liệu nguồn mở **Natural Earth 1:10m** (Public Domain: đường biên quốc gia & hệ thống sông chính) và **NASA SRTM 90m DEM** (Public Domain) để tạo gói dữ liệu tĩnh `src/content/geo/vietnam72WorldData.json`.
  - Bảo toàn 100% 72 định danh `reg_vn_01`..`reg_vn_72`, nâng cấp hình học từ ô vuông sang đa giác hữu cơ cắt theo đường bờ biển thực tế của Việt Nam, bổ sung bối cảnh Lào, Campuchia, miền nam Trung Quốc, Thái Lan, Myanmar, quần đảo ven bờ và Biển Đông.
  - Bổ sung 24 thành phố tọa độ thực, 6 đỉnh núi tiêu biểu (SRTM), 66 đoạn sông và 98 hành lang giao thông vector 4 cấp (`PRIMARY_ROAD`, `SECONDARY_ROAD`, `RAILWAY`, `RIVER_CROSSING`) có hệ số `movementModifierFp` và `movementCostFp` sẵn sàng cho Movement Engine tương lai — tách biệt tường minh với biên giới/tuyến đường hiện đại (`modernRoadsUsedAsHistorical: false`, `modernAdminBordersUsedAsHistorical: false`).
  - `src/web/mapLayerRegistry.ts` tổ chức kiến trúc lớp mở rộng gồm 4 lớp đang hoạt động (`POLITICAL`, `TERRAIN`, `ECONOMY`, `INFRASTRUCTURE`) và các khe chờ kiến trúc (`MILITARY`, `WEATHER`, `POLITICAL_INFLUENCE`) chưa kích hoạt cơ chế chiến đấu trước lộ trình.
  - `src/web/StrategicMap.tsx` hiển thị bản đồ chiến lược chiếm diện tích chủ đạo của viewport bằng MapLibre GL (tự chứa 100%, nhãn tiếng Việt đồng bộ qua `map.project`) và giữ nguyên bản đồ vector SVG dự phòng đầy đủ địa lý thực tế.
- **Bản đồ Sống — Strategic Map Engine 2.0 (`P02-06`, xem `docs/ADR/0004-p02-06-living-map-engine-2.md`):**
  - Toàn bộ giao diện trận đấu chuyển sang **Fullscreen Strategic Workspace** (`h-dvh w-screen overflow-hidden`, tách riêng Developer/Diagnostics workspace cho công cụ `P01`).
  - Tách 6 module logic bản đồ thuần có thể kiểm thử đơn vị trong `src/web/map/` (`designTokens.ts`, `cameraEngine.ts`, `graphicsSettings.ts`, `settlementCatalog.ts`, `terrainRelief.ts`, `militaryAdapter.ts`) và 7 thành phần HUD thích ứng trong `src/web/components/` (`TopCommandBar`, `LeftNavRail`, `ContextualInspector`, `StrategicMinimap`, `BottomModeDock`, `MapControlsCluster`, `SvgFallbackMap`, `MapSideDrawers`).
  - Hệ thống camera 5 cấp Semantic Zoom (`L1`–`L5`), 7 preset chiến lược, bảo toàn camera khi đổi chế độ bản đồ, bóng đổ địa hình 2D nội suy từ NASA SRTM 90m cắt mặt nạ theo đường bờ biển Việt Nam, biên giới quốc gia & biên giới phe tính động từ trạng thái server authoritative, bộ lọc chất lượng đồ họa (`LOW`/`MEDIUM`/`HIGH`/`ULTRA`), nền tảng hiển thị quân sự tương lai tuân thủ fog-of-war (không tạo đơn vị giả) và bộ điều hợp khí quyển chỉ mang tính trang trí (`NONE_COSMETIC_ONLY`).
