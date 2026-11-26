# ADR-0004: Nền tảng Kinh tế Authoritative & Sổ cái Tài nguyên Bảo toàn (P03-01)

- **Trạng thái:** Accepted (Triển khai cho `P03-01`, chờ Game Director nghiệm thu)
- **Ngày:** 2026-11-26
- **Liên quan:** `P03-01`, `VIETNAM ENGINEERING PROTOCOL 1.0` (Mục 11 — Economy Integrity), `ADR-0001`, `ADR-0002`

## 1. Bối cảnh

Sau khi chốt điểm mốc `P02-COMPLETE`, dự án bước vào Giai đoạn 03 — Nền tảng Kinh tế (`P03-01`). Hệ thống cần vận hành vòng thu–chi tài nguyên theo thời gian thực (`24 giờ thực = 1 ngày game`, không tua) mà vẫn bảo toàn tuyệt đối các bất biến lõi:

1. **Bảo toàn tài nguyên tuyệt đối:** `activeTotals + reservedJobs + burnedTotal === initialTotal + mintedTotal` sau mọi lệnh.
2. **Không dùng số thực dấu phẩy động** và không có số dư âm.
3. **Truy vết giao dịch đầy đủ** nhưng không làm rò rỉ sổ cái nội bộ của phe đối thủ.
4. **Tương thích ngược 100%** với mọi bản ghi SQLite và bài kiểm thử từ Giai đoạn 01 và 02 (không tăng Major version của `CONTRACT_SCHEMA_VERSION = "1.0.0"`).

## 2. Quyết định Kiến trúc

### 2.1. Nhịp tất toán kinh tế theo giờ thực (`settlementIntervalMs = 3_600_000 ms`)
- Một ngày game kéo dài `86_400` giây thực được chia thành **24 chu kỳ giờ đều nhau** (`3_600_000 ms/chu kỳ`).
- Khi `ADVANCE_REALTIME_TICK` (do `MatchClockScheduler` UTC gọi định kỳ hoặc catch-up sau restart) đi qua `k >= 1` mốc giờ hoàn chỉnh kể từ `economicState.lastSettlementUtc`, hàm thuần túy `settleDueEconomicCycles()` trong `src/simulation/economy.ts` tự động tất toán tuần tự `k` chu kỳ theo thứ tự `nationId` sắp xếp tăng dần.
- Lựa chọn nhịp 1 giờ giữ nguyên hành vi của các bài test ngắn hạn (15 phút) trong P02-02, đồng thời bảo đảm cập nhật tài nguyên tự nhiên suốt 24 giờ thực.

### 2.2. Bảo toàn số nguyên cố định, Trần kho & Xử lý thiếu hụt
- Toàn bộ sản lượng vùng (`food`, `industrial`, `treasury`, `manpower`, `politicalCapital`) được tính bằng `BigInt` chia nguyên từ `economicOutputFp`, `infrastructureFp`, `supplyCapacityFp`, độ ổn định quốc gia và thuế suất `taxRateBps` (`1000..4000`, mặc định `2000` = 20%).
- **Trần kho (`stockpileCaps`):** Lượng phát hành (`minted`) bị kẹp bởi `min(grossPerCycle, max(0, cap - balance))`; đúng lượng thực phát hành đó được cộng đồng thời vào `nation.resources` và `resourceAudit.mintedTotal`.
- **Chi phí duy trì (`upkeep`) & Thiếu hụt:** Lượng tiêu hủy bị kẹp bởi `min(balance, upkeepPerCycle)` nên số dư **không bao giờ âm**. Nếu thiếu hụt `food` hoặc `treasury`, `shortfallNationIds` được ghi nhận trong sự kiện `ECONOMY_CYCLE_SETTLED` và áp dụng hình phạt ổn định có giới hạn `-1.000` (`>= 0`).

### 2.3. Điều chỉnh Thuế suất (`SET_TAX_RATE`) & Hủy tác vụ Hoàn 80% (`CANCEL_JOB`)
- `SET_TAX_RATE`: đánh đổi chiến lược có kiểm soát — thuế suất cao (tới 40%) tăng mạnh nguồn thu `treasury` nhưng giảm nhẹ `industrial` và `politicalCapital`.
- `CANCEL_JOB`: chỉ áp dụng cho tác vụ thuộc chính quốc gia đó đang ở trạng thái `SCHEDULED`. Sử dụng `computeJobCancellationSplit()`:
  - `refund = fpMulRatio(reserved, 800)` (80%) hoàn lại kho quốc gia.
  - `burn = fpSub(reserved, refund)` (phần dư chính xác ~20%) chuyển vào `resourceAudit.burnedTotal`.
  - Đảm bảo `refund + burn === reserved` tuyệt đối, triệt tiêu mọi sai số làm tròn 1 micro-unit và ngăn hoàn tiền 2 lần.

### 2.4. Sổ cái Giao dịch Riêng & Phân quyền Máy chủ
- Mỗi biến động tài nguyên (thu chu kỳ, chi duy trì, chuyển khoản, đặt lịch, hủy tác vụ, hoàn tất tác vụ, ban hành chính sách) tạo mã `LedgerTransactionId` (`txn_v<ver>_<seq>`) tất định.
- `projectMatchForViewer()` và endpoint mới `GET /api/rooms/:matchId/economy` lọc cứng `entry.nationId === viewerNationId` trên server — người chơi chỉ thấy dự báo thu–chi và sổ cái giao dịch của phe mình, tuyệt đối không thấy dữ liệu đối thủ hoặc `serverPrivate`.

## 3. Hệ quả

- **Tích cực:** Hoàn toàn thuần túy (0 `Date.now()`, 0 `Math.random()`), replay SHA-256 khớp bit-for-bit, 100% tương thích ngược với dữ liệu SQLite P01/P02.
- **Đánh đổi:** Bảng `economicLedger` trong `MatchState` được giới hạn kích thước trượt (`ledgerCap = 250` giao dịch gần nhất) để tránh phình snapshot JSON trong trận kéo dài nhiều ngày; lịch sử toàn phần luôn có thể tái dựng bất cứ lúc nào từ `command_log`.
