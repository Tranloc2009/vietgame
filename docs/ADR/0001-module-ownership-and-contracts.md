# ADR-0001: Phân tách Module, Hợp đồng Dữ liệu và Mô phỏng Tất định

- **Trạng thái:** Accepted (Áp dụng từ P01-01 đến P01-03)
- **Ngày:** 2026-11-26
- **Phạm vi:** `src/contracts/`, `src/simulation/`, `src/server/`, `src/web/`, `src/content/`

## Bối cảnh

Dự án **VIETNAM: THE DIVIDED NATION** được xây dựng trực tiếp trên môi trường Google AI Studio Build (Node.js + Express + Vite + React), đòi hỏi:
1. Giữ nguyên entrypoint preview của nền tảng (`index.html`, `src/main.tsx`, `server.ts` trên cổng 3000) để build/preview sạch ngay từ clone mới.
2. Đảm bảo tính server-authoritative, lưu trữ bền vững SQLite, replay tất định tuyệt đối và tách biệt dữ liệu bí mật khỏi client.

## Quyết định

1. **Giữ kiến trúc single-package phân tách module theo thư mục `src/*`:**
   - Thay vì chuyển đổi ngay sang monorepo nhiều `package.json` có nguy cơ phá vỡ preview/build của AI Studio, hệ thống tách rạch ròi quyền sở hữu qua thư mục `src/contracts`, `src/simulation`, `src/content`, `src/server`, `src/web` và kiểm soát chiều phụ thuộc một chiều.
   - Chỉ xem xét tách monorepo sau khi có nhu cầu deploy độc lập và đã xác minh đầy đủ quy trình preview/build.

2. **Schema Runtime bằng Zod kết hợp Semver & Fixed-Point Integer:**
   - Toàn bộ thực thể và lệnh sử dụng `.strict()` để từ chối trường lạ từ client.
   - Mọi tài nguyên và tỉ lệ gameplay dùng số nguyên fixed-point (`scale = 1000`) thay cho float để loại bỏ sai số dấu phẩy động giữa các môi trường chạy.
   - Phiên bản hợp đồng `1.0.0` áp dụng kiểm tra major-match / minor-backward-compatible; mọi thay đổi phá vỡ tương thích buộc phải tạo ADR mới và nâng major version.

3. **Reducer thuần túy + Injectable Clock + Server-Only Seeded PRNG:**
   - Reducer (`src/simulation/reducer.ts`) không được gọi `Date.now()` hay `Math.random()`.
   - Thời gian được bơm qua `SimulationClock`; tính ngẫu nhiên sử dụng Mulberry32 với trạng thái `rngState` lưu trong `serverPrivate` và bị tước bỏ qua `projectMatchForClient` trước khi ra khỏi server.
   - Mỗi lần thực thi lệnh trên server chạy trong một SQLite transaction nguyên tử ghi đồng thời `matches`, `command_log` (kèm `applied_at_utc`) và `event_log`, đảm bảo replay từ seed ban đầu + `command_log` luôn khớp 100% SHA-256 hash.

## Hệ quả

- **Tích cực:** Build sạch, test chạy nhanh trong vài trăm mili-giây bằng `node:test`, replay xác minh được trực tiếp từ DB thật, không phụ thuộc AI API.
- **Đánh đổi:** Mọi tính năng mới trong các giai đoạn sau (P02+) phải cập nhật schema trong `src/contracts/` trước, sau đó triển khai reducer thuần túy trong `src/simulation/` rồi mới mở rộng API/UI.
