# Hợp đồng Dữ liệu & Quyền sở hữu Module (P01-02)

- **Contract Schema Version hiện hành:** `1.0.0`
- **Simulation Engine Version hiện hành:** `1.0.0`
- **Quy tắc tương thích phiên bản:** Major phải khớp tuyệt đối (`received.major === supported.major`), và `received.minor <= supported.minor`. Mọi phiên bản không tương thích bị từ chối với lỗi `IncompatibleSchemaVersionError` (`code: "INCOMPATIBLE_SCHEMA_VERSION"`).

## 1. Định danh bất biến (Immutable Branded IDs)

Mỗi thực thể sử dụng tiền tố cố định, ký tự thường `[a-z0-9_-]`, độ dài phần thân 3–63 ký tự:

| Kiểu | Tiền tố | Ví dụ |
| --- | --- | --- |
| `MatchId` | `mch_` | `mch_preview_alt_1955` |
| `NationId` | `nat_` | `nat_north_dir` |
| `RegionId` | `reg_` | `reg_north_delta` |
| `ActorId` | `act_` | `act_human_north` |
| `UnitId` | `unt_` | `unt_north_corps_01` |
| `CommandId` | `cmd_` | `cmd_fx_001` |
| `EventId` | `evt_` | `evt_v1_s000001` |
| `JobId` | `job_` | `job_alpha_south` |
| `PolicyId` | `pol_` | `pol_logistics_01` |
| `TreatyId` | `trt_` | `trt_corridor_01` |
| `IdempotencyKey` | 8–128 ký tự `[A-Za-z0-9:_-]` | `idem_fx_001_north_job` |

## 2. Thời gian UTC & Số nguyên Fixed-Point

- **`UtcEpochMs`**: số nguyên an toàn không âm (`ms` kể từ Unix epoch UTC). Thời gian production khóa cứng `REALTIME_SECONDS_PER_GAME_DAY = 86400` và `allowFastForward = false`.
- **`FixedPointInt`**: số nguyên an toàn không âm với `FIXED_POINT_SCALE = 1000` (tức `1.000` đơn vị = `1000`). Mọi số thực dấu phẩy động (`12.5`), `NaN`, `Infinity` hoặc số âm đều bị schema từ chối ngay tại runtime.
- **`SignedFixedPointInt`**: số nguyên an toàn có dấu dùng cho độ lệch/hiệu ứng (ví dụ `stabilityDeltaFp`).

## 3. Thực thể miền cốt lõi

Được định nghĩa và xác thực bằng Zod `.strict()` trong `src/contracts/entities.ts`:

- **`MatchState`**: trạng thái authoritative toàn phần trên server (`config`, `actors`, `nations`, `regions`, `units`, `jobs`, `policies`, `treaties`, `resourceAudit`, `events`, `idempotencyReceipts`, `serverPrivate`).
- **`ClientMatchView`**: hình chiếu an toàn cho client, lược bỏ tuyệt đối `serverPrivate` và gắn kèm `stateHash` SHA-256.
- **`Nation`**: thuộc slot `NORTH`, `SOUTH` hoặc `NPC`; sở hữu `ResourceLedger` (`food`, `industrial`, `treasury`, `manpower`, `politicalCapital`) và nhãn `ALTERNATE_HISTORY_ABSTRACT_GAMEPLAY`.
- **`Actor`**: vai trò `HUMAN_PLAYER` (đúng 2 slot `NORTH` và `SOUTH`), `INDEPENDENT_NPC` (`NPC`), hoặc `SYSTEM`.
- **`Region` / `Unit` / `Job` / `Policy` / `Treaty`**: các thực thể trừu tượng với liên kết tham chiếu được kiểm tra bởi `assertSimulationInvariants`.
- **`Command`**: envelope gồm `schemaVersion`, `commandId`, `matchId`, `actorId`, `idempotencyKey`, `sequence`, `expectedVersion`, `issuedAtUtc`, và union payload (`TRANSFER_RESOURCE`, `MOVE_UNIT`, `ENACT_POLICY`, `PROPOSE_TREATY`, `SCHEDULE_JOB`, `ADVANCE_REALTIME_TICK`).
- **`DomainEvent`**: sự kiện bất biến với `sequence`, `occurredAtUtc`, `tieBreakPriority`, `causedByCommandId` và union payload tương ứng.

## 4. Serialize / Deserialize & Thứ tự tất định

- `serializeContract(kind, payload)` validate payload trước khi xuất JSON chuẩn hóa theo khóa sắp xếp đệ quy (`canonicalStringify`).
- `deserializeContract(rawJson)` kiểm tra cú pháp JSON, kiểm tra tương thích `schemaVersion`, sau đó parse nghiêm ngặt theo schema tương ứng.
- Khi nhiều sự kiện có cùng `occurredAtUtc`, thứ tự được cố định bằng khóa so sánh:
  `(occurredAtUtc ASC, tieBreakPriority ASC, tieBreakKey / sequence ASC, eventId ASC)`.

## 5. Quyền sở hữu Module

- Chỉ `src/contracts/` được quyền thay đổi cấu trúc schema và tăng `CONTRACT_SCHEMA_VERSION`.
- Mọi thay đổi phá vỡ tương thích ngược bắt buộc tăng **Major version** và ghi **ADR** được chủ dự án duyệt trước khi triển khai.
- `src/web/` chỉ được đọc `ClientMatchView` / `FilteredClientMatchView` và gửi `Command`, không bao giờ tự suy diễn hoặc ghi đè trạng thái authoritative.

## 6. Mở rộng Hợp đồng Giai đoạn 02 (`src/contracts/rooms.ts`)

Các hợp đồng mới bổ sung tương thích ngược hoàn toàn với `CONTRACT_SCHEMA_VERSION = "1.0.0"`:

- **`UserId`**: branded ID tiền tố `usr_` (`^usr_[a-z0-9][a-z0-9_-]{2,62}$`).
- **`InviteCode`**: định dạng `VDN-XXXX-XXXX`.
- **`MatchRoomSummary`**: mô tả phòng đấu 2 slot (`NORTH` / `SOUTH`), trạng thái `LOBBY | ACTIVE | ENDED`, thời điểm khóa slot `lockedAtUtc`, `winnerSlot`, `endedReason`, và thông tin slot người xem (`viewerSlot`, `viewerActorId`, `viewerNationId`).
- **`RegionGeoMetadata`**: mô tả từng vùng trên bản đồ 72 vùng gồm `terrain`, `terrainFeatures`, `elevationMeters`, `elevationPeakMeters`, `elevationSource` (`NASA_SRTM_90M_PUBLIC_DOMAIN`), `movementCostFp`, `forestCoverFp`, `urbanizationFp`, `hasCoastline`, `hasMajorRiver`, `economicOutputFp`, `infrastructureFp`, `supplyCapacityFp`, `centroid`, `dataSource`, `eraLabel: "ALTERNATE_HISTORY_1955_FICTIONAL_NETWORK"`, `modernRoadsUsedAsHistorical: false` và `modernAdminBordersUsedAsHistorical: false` (toàn bộ trường `P02-05` bổ sung tương thích ngược).
- **`WorldCity` / `WorldPeak` / `TransportCorridor`**: danh mục thành phố tọa độ thực, đỉnh núi SRTM và 4 cấp hành lang giao thông (`PRIMARY_ROAD`, `SECONDARY_ROAD`, `RAILWAY`, `RIVER_CROSSING`) có `movementModifierFp` phục vụ Movement Engine tương lai; API `GET /api/world/map` trả `{ ok, geojson, layers }` giữ nguyên trường `geojson` để tương thích ngược tuyệt đối.
- **`PlannedFutureLayerMode`**: khai báo trước các khe lớp `MILITARY`, `WEATHER`, `POLITICAL_INFLUENCE` ở mức kiến trúc (chưa triển khai cơ chế chiến đấu).
- **`FilteredClientMatchView`** (`projectMatchForViewer`): mở rộng `ClientMatchView`, lược bỏ `serverPrivate` và ẩn `readinessFp`/`supplyFp` của đơn vị không thuộc `viewerNationId` (ghi nhận trong `redactedUnitIds`).
- **`MatchDeltaEnvelope`**: khung sự kiện đồng bộ WebSocket `room:delta` gồm `matchId`, `fromSequence`, `toSequence`, `version`, `stateHash`, `events`, `serverUtc`.
- **Tương thích `P02-06` (Strategic Map Engine 2.0):** Không thay đổi hay phá vỡ bất kỳ trường hợp đồng nào của `CONTRACT_SCHEMA_VERSION = "1.0.0"`. Toàn bộ biên giới động, phân cấp 24 đô thị, Map Mode Registry 2.0 (4 chế độ hoạt động + 8 chế độ lộ trình khóa), nền tảng hiển thị quân sự tuân thủ `redactedUnitIds`, và các mức chất lượng đồ họa chỉ tiêu thụ `FilteredClientMatchView` và payload `GET /api/world/map` hiện hành ở phía client.
