# VIETNAM: THE DIVIDED NATION

## Bàn giao cho Antigravity · 27/11/2026

Mở [index.html](index.html) để chơi chiến dịch Việt Nam, hoặc chạy ứng dụng và mở trang chủ. Đây là bản đồ đã thử với 63 vùng theo bộ dữ liệu lịch sử và 60 điểm dân cư. Mã nguồn, dữ liệu địa lý và hướng dẫn đóng gói nằm trong [campaign](campaign/NGUON.md).

**Luồng đã chạy trong bản chơi đơn:** nghiên cứu Bộ binh cơ giới I, xây văn phòng, huy động tại thành phố, chọn đơn vị, di chuyển, dừng hoặc đổi đích. Cấp II rút ngắn thời gian lệnh mới. Kho, công trình, quân và tiến độ được lưu bằng IndexedDB trên trình duyệt.

**Phòng hai người** có đường vào riêng ở `/rooms.html` khi chạy máy chủ. Bản đồ 1955 đã được gỡ khỏi trang chủ. Phòng hiện dùng dữ liệu kịch bản 72 vùng với hành quân, đổi đích và chia sẻ tầm nhìn qua hiệp ước. Nối nghiên cứu và huy động của chiến dịch Việt Nam với máy chủ là [phần việc kế tiếp](docs/NEXT_TASK.md).

## Nền tảng phòng nhiều người chơi

Nền tảng mô phỏng chiến lược lịch sử thay thế (alternate-history grand strategy) theo kiến trúc **server-authoritative**, lưu trữ bền vững bằng **SQLite**, đồng bộ thời gian thực qua **WebSocket**, không phụ thuộc bất kỳ AI API trả phí nào.

> **Tuyên bố bối cảnh:** Mọi số liệu tài nguyên, thực thể, phe phái và cơ chế xung đột/ảnh hưởng trong ứng dụng là **cơ chế trò chơi trừu tượng thuộc bối cảnh lịch sử thay thế**, không phải dữ kiện lịch sử và không hardcode kết quả lịch sử.

## Bất biến cốt lõi của dự án

1. **Đúng 2 slot người thật (`NORTH` / `SOUTH`)** trong mỗi match, các **NPC hoàn toàn độc lập**.
2. **Server authoritative:** Toàn bộ kiểm tra quyền, bảo toàn tài nguyên, RNG seeded và chuyển trạng thái chỉ chạy trên server. Dữ liệu bí mật (`serverPrivate`) bị tách bỏ hoàn toàn trước khi gửi client.
3. **Thời gian thực production 1:1:** 24 giờ thực = 1 ngày game (`86.400 giây/ngày`), không cho phép tua nhanh (`allowFastForward: false`).
4. **Số nguyên fixed-point & tất định:** Mọi tài nguyên và chỉ số dùng số nguyên an toàn (`scale = 1000`), reducer thuần túy không dùng `Date.now()` hay `Math.random()`.
5. **Không AI API trả phí & không pay-to-win:** Gameplay vận hành độc lập 100%, không cần API key bên ngoài.

## Cấu trúc thư mục

- `server.ts` — Điểm khởi chạy Express + WebSocket `/ws` + Vite middleware (port 3000).
- `src/contracts/` — Hợp đồng dữ liệu bất biến, schema runtime (Zod), kiểm tra tương thích version, fixed-point, serialize/deserialize (P01-02).
- `src/simulation/` — Pure reducer, injectable clock, seeded PRNG chỉ ở server, invariants, canonical SHA-256 hash và replay verifier (P01-03).
- `src/content/` — Nội dung fixture hư cấu 2 phe + NPC độc lập phục vụ kiểm thử nền tảng.
- `src/server/` — Kiểm tra cấu hình, SQLite persistent store kèm migration, Express API và WebSocket runtime (P01-01).
- `src/web/` & `src/App.tsx` — Màn hình khởi đầu tối giản hiển thị phiên bản, trạng thái kết nối thực và bảng kiểm chứng nền tảng.
- `docs/` — Tài liệu kiến trúc (`ARCHITECTURE.md`), hợp đồng (`CONTRACTS.md`), quyết định kiến trúc (`ADR/`) và tiến độ (`PROGRESS.md`).

## Scripts

```bash
npm run dev        # Khởi động Express + WebSocket + Vite middleware tại cổng 3000
npm run build      # Build frontend production vào dist/
npm run start      # Chạy production server từ dist/ (yêu cầu SQLITE_DB_PATH)
npm run typecheck  # Kiểm tra kiểu TypeScript nghiêm ngặt (tsc --noEmit)
npm run test       # Chạy toàn bộ unit & integration test (node:test via tsx)
```

## Tài liệu tham chiếu

- [Kiến trúc hệ thống](docs/ARCHITECTURE.md)
- [Hợp đồng dữ liệu & Quyền sở hữu module](docs/CONTRACTS.md)
- [ADR 0001 — Module Ownership & Contract Versioning](docs/ADR/0001-module-ownership-and-contracts.md)
- [Nhật ký tiến độ](docs/PROGRESS.md)
