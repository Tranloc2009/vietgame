# ADR-0005 — Kiến trúc Kinh tế 8 Tài nguyên, Ngân sách (Laffer & Nợ có Trần) và Hệ thống 8 Công trình (`P03-01`, `P03-02`, `P03-03`)

- **Trạng thái:** Accepted (Implemented in Phase 03)
- **Ngày:** 2026-11-26
- **Phạm vi:** `src/contracts/phase03.ts`, `src/simulation/phase03Catalog.ts`, `src/simulation/phase03Engine.ts`, `src/simulation/reducer.ts`, `src/simulation/invariants.ts`, `src/server/createApp.ts`, `src/server/scheduler.ts`, `src/web/EconomyLedgerPanel.tsx`, `src/web/Phase03BudgetFacilities.tsx`

## 1. Bối cảnh
Giai đoạn 03 mở rộng mô hình kinh tế từ 5 tài nguyên cơ bản của nền tảng P01/P02 sang đầy đủ 3 trụ cột kinh tế – sản xuất của VIETNAM: THE DIVIDED NATION:
1. **`P03-01` — Sổ cái 8 tài nguyên:** `money`, `foreignExchange`, `manpower`, `food`, `fuel`, `supplies`, `equipment`, `medical` với trạng thái `available` / `reserved` / `storageCaps` / `debtMoneyFp`, bút toán ghi Nợ/Có có tài khoản nguồn–đích (`STOCK`, `RESERVE`, `FACILITY`, `CREDIT_LINE`, `TAX_OFFICE`, `TREASURY_UPKEEP`) và đối soát bảo toàn tuyệt đối.
2. **`P03-02` — Ngân sách & dân sự:** Cơ sở thuế gắn trực tiếp sản lượng & cơ sở hạ tầng, đường cong Laffer rời rạc bằng số nguyên (chặn thu nhập vô hạn khi kéo thuế quá cao), độ trễ hiệu lực thuế (`2h`) + thời gian hồi (`1h`), phân bổ 4 lĩnh vực tổng bằng đúng `10000 bps`, tín dụng có trần (`creditLimitFp`) + lãi suất giờ, dự báo 24h & cảnh báo có cấu trúc, và quy tắc thắt lưng buộc bụng (`AUSTERITY_THROTTLED` + `activityThrottleBps`) khi chạm trần tín dụng mà vẫn thiếu tiền.
3. **`P03-03` — 8 loại công trình (Cấp I–III) & Hàng đợi Xây dựng / Sản xuất:** Tách bạch tường minh quyền sở hữu công trình (`ownerNationId`, `regionId`) với trạng thái vận hành (`ACTIVE`, `PAUSED_MANUAL`, `PAUSED_NO_INPUTS`, `PAUSED_NO_POWER`, `PAUSED_NO_LABOR`, `PAUSED_AUSTERITY`, `DAMAGED`), hàng đợi xây dựng và sản xuất theo đồng hồ UTC thực, tự động tạm dừng nhà máy & đơn sản xuất khi thiếu điện/lao động/đầu vào, và không bao giờ sản xuất hoặc xây dựng trùng khi server khởi động lại qua hạn chót.

## 2. Quyết định Kiến trúc
1. **Tương thích ngược 100% với Schema `1.0.0` và SQLite hiện có:**
   - Gắn `phase03Economy?: Phase03EconomyState` là trường tùy chọn trên `MatchState` (được khởi tạo mặc định trên mọi trận mới từ `createWorld72MatchState`).
   - Giữ nguyên toàn bộ trường `resources`, `economicState`, `economicLedger`, `jobs` cũ để 100% trận đấu P01/P02 trong SQLite và toàn bộ 33 bài test nền tảng chạy nguyên vẹn không cần xóa dữ liệu hay tăng Major version.
2. **Bảo toàn 8 tài nguyên tuyệt đối bằng `BigInt` & Số nguyên Cố định (`scale = 1000`):**
   - Bất biến đối soát trên mọi tài nguyên `r`:
     `sum(available[r]) + sum(reserved[r]) + burnedTotal[r] === initialTotal[r] + mintedTotal[r] + (r === 'money' ? sum(debtMoneyFp) : 0)`
   - Hai lệnh tranh chấp cùng kho bị chặn ở cả tầng khóa lạc quan (`expectedVersion` -> `VERSION_CONFLICT`) và tầng kiểm tra số dư tuần tự (`INSUFFICIENT_RESOURCES`).
   - Hủy lệnh xây dựng/sản xuất giữa chừng dùng tỷ lệ thời gian hoạt động thực `elapsedActiveMs / durationMs` để quyết toán chính xác phần đã tiêu thụ và hoàn trả phần chưa tiêu thụ (`consumed + refunded === initialReserved`, không thất thoát làm tròn).
3. **Thứ tự tất toán chu kỳ UTC tất định trong `settlePhase03OnRealtimeTick`:**
   - (1) Hoàn tất lệnh xây dựng đến hạn (tính lại trần kho).
   - (2) Chạy tất toán chu kỳ giờ (kích hoạt thuế trễ hạn, tính lãi nợ công, thu thuế Laffer, khấu trừ duy trì/thắt lưng buộc bụng, kiểm tra điện/lao động/vật tư đầu vào từng nhà máy).
   - (3) Tiến triển & hoàn tất hàng đợi sản xuất theo lô — nhà máy vừa bị `PAUSED_NO_INPUTS` / `PAUSED_NO_POWER` / `PAUSED_NO_LABOR` trong chu kỳ sẽ lập tức tạm dừng đơn sản xuất với `pauseReason` tường minh và tạo `0` sản phẩm.
   - `MatchClockScheduler` quét hạn `completesAtUtc` của cả `jobs`, `constructionQueue` và `productionQueue` (nhà máy `ACTIVE`), kết hợp khóa lease SQLite và `idempotencyKey` theo `targetUtc` nên restart qua hạn không bao giờ nhân đôi thành phẩm.
4. **Lọc quyền tuyệt đối trên Server:**
   - Mọi lệnh mới (`RESERVE_RESOURCES`, `COMMIT_RESERVATION`, `RELEASE_RESERVATION`, `UPDATE_BUDGET_POLICY`, `MANAGE_CREDIT`, `QUEUE_CONSTRUCTION`, `CANCEL_CONSTRUCTION`, `QUEUE_PRODUCTION`, `CANCEL_PRODUCTION`, `TOGGLE_FACILITY_PAUSE`) được kiểm tra `nationId === viewerNationId` tại `src/server/createApp.ts`.
   - `projectMatchForViewer` và `GET /api/rooms/:matchId/economy` chỉ trả dữ liệu `phase03Economy` thuộc `viewerNationId`; không bao giờ lộ sổ cái, ngân sách, hàng đợi hay khoản tạm giữ của phe đối lập.

## 3. Hệ quả & Rủi ro tích hợp
- **Lợi ích:** Zero SQLite migration mới (tận dụng cột `current_state_json` và migration `003_match_scoped_log_uniqueness`), 100% deterministic replay SHA-256, 0 gọi AI API trả phí.
- **Lưu ý giai đoạn kế tiếp (Phase 04+):** Khi bổ sung cơ chế quân sự/hậu cần (`P04`) hoặc thương mại/ngoại giao (`P05`), các hệ thống mới chỉ cần tiêu thụ/tạm giữ trực tiếp qua `reserveNationResources` / `settleNationReservation` trong `src/simulation/phase03Engine.ts` để giữ nguyên bất biến đối soát 8/8.
