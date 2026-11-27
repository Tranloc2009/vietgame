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
| **P02-06** | Operation Living Map — Strategic Map Engine 2.0 | P02-05 | COMPLETED (Chờ duyệt) | Không gian chiến lược toàn màn hình thích ứng Desktop/Tablet/Mobile (`h-dvh`, không cuộn dọc, hỗ trợ iPhone safe-area, tách riêng Developer/Diagnostics workspace cho P01); 6 module engine thuần `src/web/map/` (design tokens, Semantic Zoom L1–L5 + 7 preset + bảo toàn camera, 4 mức đồ họa `LOW`/`MEDIUM`/`HIGH`/`ULTRA`, danh mục 24 đô thị + tránh va chạm nhãn + tìm kiếm tiếng Việt, bóng đổ 2D SRTM 90m cắt mặt nạ bờ biển Việt Nam + biên giới quốc gia động từ server state, nền tảng hiển thị quân sự tương lai tôn trọng fog-of-war không tạo đơn vị giả); Map Mode Registry 2.0 (4 chế độ hoạt động + 8 chế độ lộ trình khóa); Inspector accordion desktop + Bottom Sheet 3 trạng thái di động; Minimap SVG tương tác; SVG fallback tương tác đầy đủ; 34/34 bài kiểm thử đạt (27 hồi quy + 7 mới) & kiểm chứng Playwright 7 viewport / 15 ảnh chụp thực tế |


## Tích hợp luồng chơi P03 trên checkpoint `eaadb11`

- Nối màn Kinh tế vào danh mục điều hướng và bảng vùng, dùng sẵn API báo cáo và lệnh Phase 03; HUD ưu tiên kho khả dụng từ Phase 03.
- Lọc sự kiện kinh tế riêng theo phe ở đầu ra phòng, bảo toàn sequence để client vẫn đồng bộ. Route chẩn đoán nền tảng chỉ trả trận độc lập, còn phòng 2 người dùng route theo thành viên. Không đổi schema SQLite.
- Đưa trạng thái chờ vẽ vùng và tự chuyển SVG vào checkpoint mới. Giữ cảnh quan, địa giới, lịch 1:1 và chế độ hiển thị của dự án.
- Kiểm thử mặc định bao gồm hai bộ test kinh tế. Kiểm tra thực chạy: `bun run typecheck`, `bun run test` (48/48), `bun run build`, Chrome desktop và mobile với hai tài khoản thử.
- Nghiệm thu tại máy: hai bên vào cùng phòng và bắt đầu; bên Bắc vào **Kinh tế**, đọc 8 tài nguyên và ngân sách, đóng bảng, mở **Xem công trình có thể xây** tại Hà Nội, đặt và hủy Cơ sở Y tế. Bên Nam xem tab của mình và không thấy lệnh của Bắc.

## Ghi chú môi trường & kiểm chứng

- Môi trường không có kho `.git` được khởi tạo sẵn; chủ dự án tự lưu checkpoint / xuất GitHub bằng giao diện Google AI Studio sau khi duyệt (mốc đề xuất: `P02-06-LIVING-MAP`).
- Không sử dụng Gemini API hay bất kỳ API AI trả phí nào trong mã nguồn thực thi gameplay.
- Dữ liệu preview được tách riêng trong `./data/vdn-preview.sqlite` (`APP_ENV=preview`); migrations `001` và `002` được giữ nguyên hoàn toàn không reset. Chế độ `production` khóa cứng endpoint fixture và bắt buộc cấu hình `SQLITE_DB_PATH`.
- Kiểm thử trình duyệt di động (`390×844`, `375×667`, `844×390`) được thực hiện bằng Chromium mobile viewport emulation (Playwright); môi trường Linux container không có trình duyệt Safari/WebKit hay thiết bị iPhone vật lý.



## Bản làm việc — xem trước tuyến và trạng thái bản đồ

Bắt đầu từ `c3ea772` (P02-06) và giữ nguyên các ID nhiệm vụ. Phòng đã bắt đầu có thể xem trước tuyến của đơn vị cùng phe từ bảng khu vực. Máy chủ tính thời gian trên các cạnh kịch bản trong lãnh thổ cùng phe, dùng 10 phút/cạnh làm chuẩn thử nghiệm, nhân hệ số địa hình đích và hành lang nếu có. Kết quả chỉ đọc, tính theo giờ máy chủ, không ghi lệnh hoặc thay đổi hash. Không có migration. Bộ kiểm thử tích hợp xác nhận quyền, ETA, kết quả lặp lại và state hash.

Bản đồ WebGL chỉ báo sẵn sàng khi có polygon vùng đã render. Khi các lớp vùng chưa xuất hiện, hiển thị trạng thái tải và chuyển sang SVG sau 12 giây. Inspector, chế độ lớp và dữ liệu địa lý hiện có vẫn dùng cùng hợp đồng. Điều phối lệnh di chuyển bền vững và ETA thực tế thuộc milestone tiếp theo.
