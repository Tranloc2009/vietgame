# VIETNAM: THE DIVIDED NATION

## Cập nhật mốc T07 · 27/11/2026 (Release Candidate — Tinh thần & Nổi dậy, SAM phòng không, Tàu ngầm tàng hình, Bảng xếp hạng, Metrics, Hot Backup SQLite, Stress Test 12 phòng & Soak Test 72h)

Mở trang chủ `/` (hoặc mở trực tiếp [index.html](index.html) khi chơi ngoại tuyến) để chơi chiến dịch Việt Nam trên bản đồ mới gồm 63 vùng hành chính lịch sử và 60 điểm dân cư (26 thành phố ven biển). Mã nguồn, dữ liệu địa lý và hướng dẫn đóng gói nằm trong [campaign](campaign/NGUON.md).

- **Chơi đơn ngoại tuyến (IndexedDB):** giữ nguyên bản lưu cũ (tự động nâng cấp dữ liệu mới) cùng đủ 7 công trình, 9 công nghệ 5 nhánh (Lục/Không/Hải quân gồm SAM & Tàu ngầm), gộp/tách đạo quân, tinh thần thành phố, âm thanh Web Audio và hướng dẫn nhiệm vụ tương tác.
- **Phòng trực tuyến & Đấu với Máy (AI) trên bản đồ Việt Nam mới (`vietnam_campaign_v1`):** bấm nút **Phòng mạng** ngay trên trang chủ `/` khi chạy máy chủ để chơi 2 người (tạo/vào phòng bằng mã mời), xem **Bảng xếp hạng chỉ huy** (`GET /api/leaderboard`), hoặc bấm **Đấu với Máy (AI)** để mở trận tức thì với Bộ Tư Lệnh Máy tất định trên máy chủ (không dùng AI API trả phí, khớp replay SHA-256 sau khởi động lại). Toàn bộ vòng lặp WW3 chạy trên máy chủ SQLite WAL + WebSocket (bảo vệ rate-limiting HTTP/WS, giám sát `GET /api/metrics` và sao lưu nóng `npm run backup:db`):
  - **Cây công nghệ 5 nhánh (9 đề tài) & 7 công trình:** Bộ binh cơ giới I/II, Xe trinh sát (`2.25°` radar), Xe tăng chủ lực, Pháo binh dã chiến (`1.25°` pháo kích), **Tên lửa phòng không SAM I** (`+6` đánh chặn không kích & tên lửa tầm xa `1.6°` chuyên trị không quân), Tiêm kích đánh chặn (`14s` bay thẳng, không kích `2.0°`, radar `2.6°`), Tàu hộ vệ tên lửa (`28s` tuyến Biển Đông, hải pháo `1.5°`, chỉ cơ động ven biển) và **Tàu ngầm tấn công I** (tàng hình ngoài tầm phát hiện `1.0°`, phóng ngư lôi `1.35°` ưu tiên hải quân); cùng Xưởng công nghiệp, Văn phòng tuyển dụng, Căn cứ lục quân, Hầm công sự (thủ tới `+60%`), Bệnh viện quân y (hồi máu `30s`), Căn cứ không quân và Quân cảng (chỉ xây tại 26 thành phố ven biển).
  - **Đạo quân hợp thành & Tinh thần thành phố:** Gộp/tách nhiều đơn vị cùng vị trí thành đạo quân hành quân đồng bộ theo tốc độ đơn vị chậm nhất; quản lý chỉ số `Tinh thần` (chiếm thành hạ tinh thần xuống `35%`, siết sản lượng, cần đồn trú hoặc công trình để ổn định nếu không sẽ nổi dậy ở `<= 20%`).
  - **Ngoại giao, Chiến tranh, Chiếm đóng & Kết trận:** Hòa bình / Tuyên chiến / Đình chiến / Chia sẻ tình báo trong mục **Ngoại giao**; giao tranh cận chiến, pháo kích, phòng không SAM, hải pháo, ngư lôi & không kích; luật chỉ bộ binh chiếm thành phố, xóa hàng đợi địch; Nhật báo & Báo cáo chiến đấu trong mục **Báo chí**; kết trận nguyên tử khi đạt `400 VP` / tổng chiếm đóng / đầu hàng, hiện bảng kết trận và cập nhật Bảng xếp hạng.
- **Phòng 1955 cũ (`/rooms.html`) & Vận hành Production:** giữ nguyên kịch bản 72 vùng, dữ liệu, migration (`001`–`004`) và bộ hồi quy (bundle ứng dụng tách gọn còn `259 kB`). Xem chi tiết nghiệm thu (`67/67` bài tự động + stress test 12 phòng + soak test 72h + 3 bộ Edge E2E) tại [báo cáo kiểm thử](docs/TEST_REPORT.md), hướng dẫn triển khai tại [cẩm nang vận hành](docs/DEPLOYMENT.md) và [mốc kế tiếp](docs/NEXT_TASK.md).

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
npm run backup:db  # Sao lưu nóng SQLite (VACUUM INTO) + kiểm tra integrity & replay
```

## Tài liệu tham chiếu

- [Kiến trúc hệ thống](docs/ARCHITECTURE.md)
- [Hợp đồng dữ liệu & Quyền sở hữu module](docs/CONTRACTS.md)
- [Cẩm nang triển khai & vận hành Production](docs/DEPLOYMENT.md)
- [ADR 0001 — Module Ownership & Contract Versioning](docs/ADR/0001-module-ownership-and-contracts.md)
- [Nhật ký tiến độ](docs/PROGRESS.md)
