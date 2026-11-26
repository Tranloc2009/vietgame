# ADR-0004: Động cơ Kinh tế Tất định & Sổ cái Tài nguyên Truy vết (P03-01)

- **Trạng thái:** Đã triển khai (Chờ Game Director phê duyệt)
- **Ngày:** 2026-11-26
- **Phạm vi:** `src/contracts/primitives.ts`, `src/contracts/entities.ts`, `src/contracts/rooms.ts`, `src/simulation/economy.ts`, `src/simulation/reducer.ts`, `src/simulation/invariants.ts`, `src/server/createApp.ts`, `src/web/EconomyLedgerPanel.tsx`, `src/web/MultiplayerWorkspace.tsx`

## 1. Bối cảnh & Mục tiêu

Sau checkpoint **`P02-COMPLETE`**, Giai đoạn 03 (`Economic Foundation`) bắt đầu bằng nhiệm vụ **`P03-01`**: xây dựng nền tảng kinh tế server-authoritative có sổ cái truy vết giao dịch (traceable ledger), chu kỳ sản xuất – duy trì theo thời gian thực 24 giờ/ngày (không tua nhanh), cấu hình phân bổ ngân sách – thuế suất có kiểm chứng server, quy tắc hoàn trả rõ ràng khi hủy tác vụ đã đặt lịch, và bảo toàn tuyệt đối tài nguyên.

## 2. Quyết định kiến trúc

1. **Chu kỳ quyết toán kinh tế theo khung giờ UTC tất định (`ECONOMY_SETTLEMENT_INTERVAL_MS = 3_600_000 ms`, 24 kỳ / ngày game 24h):**
   - Trong `ADVANCE_REALTIME_TICK`, bất kỳ khi nào `targetUtc` vượt qua một hoặc nhiều ranh giới giờ kể từ `createdAtUtc` (`targetPeriodCount = floor((targetUtc - createdAtUtc) / 3_600_000)`), reducer tuần tự quyết toán từng kỳ còn thiếu theo thứ tự thời gian.
   - Ưu điểm toán học: dù trận đấu chạy 60 tick mỗi phút hay chạy catch-up 1 tick sau khi server khởi động lại, tổng sản lượng tạo mới (`mintedTotal`), chi phí duy trì (`burnedTotal`) và `stateHash` SHA-256 đều **khớp bit 100%**, không bao giờ sai lệch do làm tròn hay quyết toán trùng.

2. **Số liệu cân bằng hư cấu hướng dữ liệu (Data-Driven Balance Config):**
   - Tách riêng hằng số cân bằng vào `ECONOMY_BALANCE_CONFIG` trong `src/simulation/economy.ts` (không rải rác trong UI hay server).
   - Sản lượng 24h của mỗi quốc gia (cả 2 phe người chơi Bắc/Nam và các NPC độc lập) được tính thuần từ danh sách vùng kiểm soát thực tế (`regions` authoritative kết hợp hồ sơ kinh tế vùng `WORLD_REGION_METADATA_BY_ID`), độ ổn định quốc gia (`stabilityFp`), thuế suất (`taxRateBps`: `500..4000`, tức 5%–40%), và phân bổ 4 lĩnh vực (`agricultureBps`, `industryBps`, `civilServiceBps`, `reserveBps` luôn có tổng chính xác `10000`).
   - Toàn bộ con số được gắn nhãn cơ chế trò chơi lịch sử thay thế trừu tượng, không phải thống kê lịch sử.

3. **Bảo toàn tài nguyên tuyệt đối & Chống số dư âm (Protocol Section 11):**
   - Mọi sản lượng sinh ra đều cộng đồng thời vào `nation.resources` và `resourceAudit.mintedTotal`.
   - Mọi chi phí duy trì đơn vị/chính sách và chi phí thực thi đều cộng vào `resourceAudit.burnedTotal`.
   - Nếu tồn kho + sản lượng < chi phí duy trì, hệ thống chỉ trừ tối đa về `0` (không bao giờ tạo số dư âm), ghi nhận chính xác phần thiếu hụt vào `deficitFp` và `shortfallCount`.
   - Bất biến `active + reserved + burned === initial + minted` tiếp tục được `assertSimulationInvariants` kiểm chứng sau mọi lệnh.

4. **Sổ cái truy vết giao dịch (Traceable Ledger) & Quy tắc Hủy/Hoàn tác vụ (`CANCEL_JOB`):**
   - Mỗi biến động tài nguyên (`PRODUCTION_MINT`, `UPKEEP_BURN`, `TRANSFER_OUT`, `TRANSFER_IN`, `JOB_RESERVE`, `JOB_REFUND`, `JOB_COMPLETE_BURN`, `POLICY_BURN`) ghi một bản ghi bất biến có `txId` (`tx_...`), `nationId`, `counterpartyNationId`, `resource`, `amountFp`, `direction`, `balanceAfterFp`, `causedByCommandId`, `occurredAtUtc`.
   - Giữ cửa sổ xoay vòng tối đa `200` bản ghi gần nhất trong `state.economy.recentLedger` để tránh phình payload theo thời gian, trong khi `resourceAudit` bảo toàn tổng tích lũy cả trận 120 ngày.
   - Quy tắc hủy dự án đang chờ (`CANCEL_JOB`): hoàn lại chính xác **80%** (`800/1000`) phần `reservedCost` về kho quốc gia và ghi nhận **20%** còn lại (`fpSub(reserved, refund)`) vào `burnedTotal` (chi phí huy động đã phát sinh), đảm bảo bảo toàn từng micro-unit.

5. **Tương thích ngược `1.0.0` & Lọc quyền Fog-of-War:**
   - Trường `economy` trên `MatchStateSchema` là optional với khởi tạo tất định thuần (`resolveMatchEconomyState`) để toàn bộ bản ghi SQLite và test từ Phase 01/02 hoạt động không cần migration phá vỡ.
   - `projectMatchForViewer` và endpoint mới `GET /api/rooms/:matchId/economy` lọc bỏ hoàn toàn sổ cái giao dịch chi tiết và thiết lập thuế/phân bổ nội bộ của phe đối phương trước khi gửi xuống client.

## 3. Ranh giới phạm vi `P03-01`

- Không triển khai xây dựng công trình theo vùng (`P03-02`), dây chuyền sản xuất trang bị (`P03-03`) hay viện trợ/nợ công ngoại giao (`P03-04`) trong phạm vi `P03-01`.
