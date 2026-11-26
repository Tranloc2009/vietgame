# Nhật ký tiến độ dự án — VIETNAM: THE DIVIDED NATION

## Trạng thái tổng quan

| Mã nhiệm vụ | Tên nhiệm vụ | Phụ thuộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- |
| **P01-01** | Khởi tạo repository | Không | COMPLETED (Chờ duyệt) | Cấu trúc module, Express + WebSocket `/ws`, SQLite persistent + migration `001_initial_foundation`, màn hình khởi đầu tối giản, scripts `dev/build/typecheck/test` |
| **P01-02** | Hợp đồng dữ liệu | P01-01 | COMPLETED (Chờ duyệt) | Branded IDs, Zod runtime schema `1.0.0`, fixed-point int `x1000`, UTC epoch, lossless canonical JSON, `projectMatchForClient`, `docs/CONTRACTS.md`, `ADR-0001` |
| **P01-03** | Quy tắc mô phỏng | P01-02 | COMPLETED (Chờ duyệt) | Pure reducer, injectable `SimulationClock`, server-only seeded PRNG (Mulberry32), idempotency key, sequence & `expectedVersion`, simultaneous event tie-breaking, invariants, SHA-256 replay verifier, fixture 2 phe + NPC độc lập |
| **P02-01** | Phòng đấu và danh tính | P01-03 | COMPLETED (Chờ duyệt) | Đăng ký/đăng nhập `scrypt` + Bearer token (chỉ lưu RAM client), phòng đấu mã mời `VDN-XXXX-XXXX`, cưỡng chế đúng 2 slot `NORTH`/`SOUTH`, `ready`, `start` khóa slot, `reconnect` giữ nguyên slot, `surrender`, chặn giả mạo `actorId`/`nationId` & chặn người thứ 3 |
| **P02-02** | Lưu trữ và đồng hồ | P02-01 | COMPLETED (Chờ duyệt) | Migration `002_phase02_multiplayer_clock`, `match_snapshots`, `match_worker_locks`, `scheduled_ticks`, `MatchClockScheduler` UTC (tick 60s / hạn job sớm nhất, catch-up theo lô, an toàn khi restart giữa job), `exportMatchBackup`/`restoreMatchBackup` khớp SHA-256 |
| **P02-03** | Bản đồ nền | P02-02 | COMPLETED (Chờ duyệt) | MapLibre GL + tự động dự phòng vector SVG kéo-thả/phóng-thu, 72 vùng GeoJSON RFC 7946 liên thông (0 vùng mồ côi), địa hình & độ cao tham chiếu Natural Earth/SRTM, mạng di chuyển hư cấu (`modernRoadsUsedAsHistorical: false`) |
| **P02-04** | Đồng bộ và lớp bản đồ | P02-03 | COMPLETED (Chờ duyệt) | Snapshot lọc quyền (`projectMatchForViewer` ẩn `serverPrivate` + fog-of-war đơn vị đối thủ), delta theo `sequence`, phát hiện gap & `room:resync` + `/api/rooms/:matchId/sync`, reconnect exponential backoff, 4 lớp bản đồ (`POLITICAL`, `TERRAIN`, `ECONOMY`, `INFRASTRUCTURE`), panel thông tin vùng desktop/mobile |
| **P02-05** | Nền tảng bản đồ địa lý chân thực | P02-04 | COMPLETED (Chờ duyệt) | Natural Earth 1:10m + NASA SRTM 90m DEM (Public Domain); 72 đa giác hữu cơ cắt theo bờ biển Việt Nam thực tế bảo toàn nguyên `reg_vn_01`..`reg_vn_72`; bối cảnh Lào/Campuchia/Nam Trung Quốc/Thái Lan/Biển Đông; 66 đoạn sông, 24 thành phố, 6 đỉnh núi, 98 hành lang giao thông 4 cấp (`movementCostFp`/`movementModifierFp` sẵn sàng Movement Engine); MapLibre GL chiếm diện tích chủ đạo + dự phòng SVG đầy đủ địa lý; tách biệt địa lý thực & gameplay hư cấu 1955 |


## Ghi chú môi trường & kiểm chứng

- Môi trường không có kho `.git` được khởi tạo sẵn; chủ dự án tự lưu checkpoint / xuất GitHub bằng giao diện Google AI Studio sau khi duyệt.
- Không sử dụng Gemini API hay bất kỳ API AI trả phí nào trong mã nguồn thực thi gameplay.
- Dữ liệu preview được tách riêng trong `./data/vdn-preview.sqlite` (`APP_ENV=preview`); migration `002_phase02_multiplayer_clock` bổ sung tiến tới và bảo toàn 100% dữ liệu P01 (`mch_preview_alt_1955`). Chế độ `production` khóa cứng endpoint fixture và bắt buộc cấu hình `SQLITE_DB_PATH`.

