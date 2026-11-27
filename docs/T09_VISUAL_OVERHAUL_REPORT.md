# OPERATION WW3 — T09: Báo cáo Nâng cấp Đồ họa Quân chủng (Military Visual Overhaul)

- **Nhánh phát triển riêng:** `development/t09-military-visual-overhaul`
- **Mốc nền (baseline):** `development/operation-ww3` @ `fbafe0bd1d92ec3c2e64d096c7d8adc3b97ebd0a`
- **Nguyên tắc bảo toàn:** Giữ nguyên 100% nền tảng gameplay T01–T08, SQLite, IndexedDB, WebSocket, migration `001`–`004`, sương mù chiến tranh (Fog of War), replay SHA-256 và phòng 1955 cũ `/rooms.html`.

---

## 1. Bảng đối chiếu Trước (T08) và Sau (T09)

| Hạng mục | Trước nâng cấp (T08) | Sau nâng cấp (T09) |
|---|---|---|
| Biểu diễn quân chủng trên bản đồ | Ô chữ nhật 2D phẳng (`.armyPin`) kèm ký tự Unicode (`■`, `◈`, `◆`, `◎`) | **Lớp phủ WebGL 2.5D Three.js (`#unit3d`)** đồng bộ khung hình với bản đồ Canvas 2D, hiển thị trực tiếp **36 mô hình GLB PBR** (12 dòng khí tài × 3 LOD) kèm đổ bóng mặt đất, vòng chọn phát sáng và vòng phe Bắc/Nam |
| Phân biệt phe Bắc & phe Nam | Chỉ khác màu nền đỏ/xanh của ô ký tự | **Khí tài & quân phục riêng biệt theo phe:** Phương Bắc (`pavn_infantry`, `btr40`, `btr60pb`, `pt76`, `howitzer_m30_122mm`, `t54_55` — giáp 4BO, sao vàng đỏ) đối lập Phương Nam (`arvn_infantry`, `m113_apc`, `m113_acav`, `v100_commando`, `howitzer_m101_105mm`, `m48a3_patton` — giáp OD/cát) |
| Nâng cấp công nghệ Cơ giới II (`motor2`) | Chỉ giảm thời gian di chuyển (`32s → 24s`) & `+20%` hỏa lực; ngoại hình giữ nguyên | **Tự động nâng cấp mô hình 3D & ảnh đại diện:** Bắc `BTR-40 (Cấp I)` → **`BTR-60PB (Cấp II)`**; Nam `M113 APC (Cấp I)` → **`M113 ACAV (Cấp II)`** kèm huy hiệu `Cấp II` |
| Hệ thống LOD theo mức zoom | Không có LOD | **4 mức LOD tự động:** `zoom < 1.55` → `SYMBOL` (`0` draw call 3D, biểu tượng chiến thuật nhẹ); `1.55–2.45` → `LOD2`; `2.45–3.60` → `LOD1`; `>= 3.60` → `LOD0` chi tiết đầy đủ |
| Thanh HP & số lượng đơn vị | Chỉ ghi chữ trong tooltip/bảng dưới | **Thanh HP trực quan đổi màu** (xanh `>= 65%`, vàng `35–64%`, đỏ `< 35%`) + nhãn số lượng (`×3` / `#1`) ngay dưới bóng quân 3D và thanh HP lớn trong thẻ quân |
| Animation & Hiệu ứng chiến trường | Tĩnh, không hướng di chuyển | **Xoay mũi xe (`+Z`) mượt theo hướng tuyến**, đội hình 3 chiến sĩ bộ binh hành quân nhấp nhô, giật lùi nòng + chớp đầu nòng khi `inCombat`, cột khói tối khi bị thương (`HP < 65%`), sóng xung kích khi chiếm thành phố |
| Đường hành quân | Đường nét đứt đơn sắc không mũi tên | **Đường nét đứt chuyển động kèm mũi tên định hướng & vòng đích** phân biệt màu: vàng (chuyển quân), đỏ (tiến công), xanh da trời (không quân), xanh ngọc (tuyến Biển Đông) |
| Bảng thông tin quân chủng & Huy động | Thuần chữ | **Ảnh đại diện 3D render trực tiếp từ GLB (`144×96`)** (hoặc SVG chiến thuật nguyên bản khi offline/no-WebGL) hiển thị trong `#army`, danh sách `#menuUnits` và thẻ **Huy động** |
| Tương thích WebGL / Ngoại tuyến | Không dùng WebGL | Có nút bật/tắt `Mô hình quân chủng 3D` trong `#settings`; **tự chuyển fallback 2D/SVG sạch** khi `file://`, `?nowebgl=1` hoặc sự kiện `webglcontextlost`, và tự phục hồi khi `webglcontextrestored` |

---

## 2. Kết quả Kiểm định & Danh sách Asset đã tích hợp (36/36 GLB đạt chuẩn)

Đã chạy trình kiểm định nhị phân độc lập (`scripts/audit-glb-assets.mts`, kiểm chứng trong `src/server/vietnamCampaignT09.test.ts`):
- **Tổng số file kiểm định:** `36` file GLB (tổng dung lượng `7.105 kB` ~ `6,94 MB`; riêng bộ `LOD2` chỉ `1.399 kB`).
- **Định dạng & cấu trúc:** `36/36` hợp lệ glTF 2.0, `mesh = 1` đã hợp nhất gọn theo `4–9` vật liệu PBR + `2–3` texture PNG nhúng sẵn, `0` lỗi cấu trúc.
- **Pivot, tỷ lệ & hướng:** `36/36` đặt chuẩn chân chạm đất (`minY = 0`), căn giữa trục ngang (`centerXZ ≈ [0, 0]`), hướng mũi tiến thống nhất `+Z` (xác minh theo tọa độ `HeadlightLens`, `GunmetalSteel` và `GoldEmblem`).
- **Animation nhúng sẵn:** `0` clip animation trong GLB → đã bổ sung animation hành quân, giật nòng và hiệu ứng chiến đấu bằng ma trận `InstancedMesh` tại runtime.
- **Giảm đa giác theo LOD:** `12/12` dòng đều đảm bảo nghiêm ngặt `triangles(LOD0) > triangles(LOD1) > triangles(LOD2)`.

### 2.1. Danh sách 12 dòng quân đã tích hợp đầy đủ GLB (36 file — Trạng thái: `READY`)

| Mã | Phe | `unitKey` | Cấp công nghệ | Mô hình GLB | LOD0 (tri / kB) | LOD1 (tri / kB) | LOD2 (tri / kB) | Vật liệu / Tex |
|---|---|---|---|---|---:|---:|---:|---:|
| `N-INF-01` | Phương Bắc | `reserve` | Cấp I | `pavn_infantry` (Bộ binh QĐNDVN · đội 3 chiến sĩ) | 3.120 / 172 | 1.872 / 124 | 1.040 / 88 | 9 / 2 PNG |
| `N-APC-01` | Phương Bắc | `motor` | `motor` (Cấp I) | `btr40` (BTR-40) | 3.700 / 246 | 1.540 / 114 | 816 / 85 | 7 / 3 PNG |
| `N-APC-02` | Phương Bắc | `motor` | `motor2` (Cấp II) | `btr60pb` (BTR-60PB nâng cấp) | 6.892 / 427 | 2.660 / 167 | 1.388 / 120 | 7 / 3 PNG |
| `N-REC-01` | Phương Bắc | `recon` | `recon` | `pt76` (Xe tăng lội nước PT-76) | 6.648 / 459 | 3.100 / 221 | 2.160 / 166 | 6 / 3 PNG |
| `N-ART-01` | Phương Bắc | `artillery` | `artillery` | `howitzer_m30_122mm` (Lựu pháo 122mm M-30) | 2.236 / 153 | 1.036 / 80 | 444 / 57 | 4 / 3 PNG |
| `N-MBT-01` | Phương Bắc | `tank` | `tank` | `t54_55` (Xe tăng chủ lực T-54/55) | 6.612 / 455 | 3.120 / 223 | 2.196 / 168 | 6 / 3 PNG |
| `S-INF-01` | Phương Nam | `reserve` | Cấp I | `arvn_infantry` (Bộ binh QLVNCH · đội 3 chiến sĩ) | 3.008 / 162 | 1.772 / 114 | 988 / 81 | 6 / 2 PNG |
| `S-APC-01` | Phương Nam | `motor` | `motor` (Cấp I) | `m113_apc` (M113 APC) | 5.712 / 403 | 2.784 / 205 | 1.932 / 152 | 7 / 3 PNG |
| `S-APC-02` | Phương Nam | `motor` | `motor2` (Cấp II) | `m113_acav` (M113 ACAV nâng cấp) | 5.868 / 414 | 2.940 / 216 | 2.040 / 160 | 7 / 3 PNG |
| `S-REC-01` | Phương Nam | `recon` | `recon` | `v100_commando` (V-100 Commando) | 3.744 / 247 | 1.560 / 112 | 896 / 86 | 6 / 3 PNG |
| `S-ART-01` | Phương Nam | `artillery` | `artillery` | `howitzer_m101_105mm` (Lựu pháo 105mm M101A1) | 2.020 / 138 | 892 / 69 | 396 / 51 | 4 / 3 PNG |
| `S-MBT-01` | Phương Nam | `tank` | `tank` | `m48a3_patton` (Xe tăng chủ lực M48A3 Patton) | 7.644 / 521 | 3.832 / 265 | 2.484 / 185 | 6 / 3 PNG |

### 2.2. Thống kê Asset GLB còn thiếu (8 slot — Trạng thái: `MISSING_GLB`, KHÔNG đánh dấu hoàn thành)

Các quân chủng dưới đây chưa có file GLB trong bộ 36 file bàn giao; trong `src/content/campaignAssetManifest.ts` đều đánh dấu rõ `glbStatus: 'MISSING_GLB'` và tạm dùng mô hình dự phòng 2.5D/SVG nguyên bản để không làm gián đoạn gameplay:

| Mã slot | Phe | `unitKey` | Quân chủng | Trạng thái GLB | Phương án tạm thời |
|---|---|---|---|---|---|
| `N-SAM-01` | Phương Bắc | `sam` | Tên lửa phòng không SAM | **MISSING_GLB** | Hình khối 3D/SVG dự phòng (màu Bắc) |
| `S-SAM-01` | Phương Nam | `sam` | Tên lửa phòng không SAM | **MISSING_GLB** | Hình khối 3D/SVG dự phòng (màu Nam) |
| `N-AIR-01` | Phương Bắc | `fighter` | Tiêm kích đánh chặn | **MISSING_GLB** | Hình khối 3D/SVG dự phòng (bay nâng + bóng đổ) |
| `S-AIR-01` | Phương Nam | `fighter` | Tiêm kích đánh chặn | **MISSING_GLB** | Hình khối 3D/SVG dự phòng (bay nâng + bóng đổ) |
| `N-NAV-01` | Phương Bắc | `corvette` | Tàu hộ vệ tên lửa | **MISSING_GLB** | Hình khối 3D/SVG dự phòng (màu hải quân) |
| `S-NAV-01` | Phương Nam | `corvette` | Tàu hộ vệ tên lửa | **MISSING_GLB** | Hình khối 3D/SVG dự phòng (màu hải quân) |
| `N-SUB-01` | Phương Bắc | `submarine` | Tàu ngầm tấn công | **MISSING_GLB** | Hình khối 3D/SVG dự phòng (màu tàu ngầm) |
| `S-SUB-01` | Phương Nam | `submarine` | Tàu ngầm tấn công | **MISSING_GLB** | Hình khối 3D/SVG dự phòng (màu tàu ngầm) |

---

## 3. Báo cáo Hiệu năng Thực đo (Microsoft Edge · Three.js `InstancedMesh`)

Đo thực chạy bằng `scripts/t09-visual-benchmark-test.mts` trên Microsoft Edge (`kiem-thu/ket-qua-t09-benchmark.json`), trộn đầy đủ cả 9 loại quân × 2 phe, di chuyển + giao tranh + khói hư hại đồng thời trên màn hình (`LOD2` chiến dịch ở mức zoom `2.0–2.2`):

| Kịch bản đo | Mức LOD | FPS thực đo | Thời gian khung (`avgFrameMs`) | Thời gian submit WebGL (`avgRenderSubmitMs`) | Draw Calls | Số tam giác | Số đối tượng 3D | Geometries / Textures GPU | JS Heap |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Desktop `1440×900` · 50 quân** | `LOD2` | **60,0 FPS** | 16,66 ms | 3,43 ms | 110 | 51.832 | 56 | 205 / 64 | 28,6 MB |
| **Desktop `1440×900` · 100 quân** | `LOD2` | **60,0 FPS** | 16,67 ms | 3,84 ms | 110 | 99.464 | 112 | 205 / 64 | 26,9 MB |
| **Desktop `1440×900` · 200 quân** | `LOD2` | **48,5 FPS** | 20,63 ms | 5,53 ms | 110 | 197.412 | 223 | 205 / 64 | 29,0 MB |
| **Mobile `390×844` · 50 quân** | `LOD2` | **60,0 FPS** | 16,67 ms | 2,74 ms | 110 | 51.912 | 56 | 162 / 47 | 33,0 MB |
| **Mobile `390×844` · 100 quân** | `LOD2` | **49,3 FPS** | 20,26 ms | 5,56 ms | 110 | 99.364 | 112 | 162 / 47 | 28,2 MB |
| **Mobile `390×844` · 200 quân** | `LOD2` | **54,1 FPS** | 18,49 ms | 4,85 ms | 110 | 197.492 | 223 | 162 / 47 | 33,6 MB |
| **Thu nhỏ toàn quốc (`zoom < 1.55`)** | `SYMBOL` | **60,0 FPS** | — | 0 ms | **0** | **0** | 0 | — | — |

- **Thời gian tải toàn bộ 12 mô hình `LOD2` + tạo 12 ảnh đại diện 3D ban đầu:** `732,3 ms` trên desktop (`1.073 ms` trên mobile viewport).
- **Nhận xét trung thực về mục tiêu FPS:** Nhờ batching bằng `THREE.InstancedMesh`, số `drawCalls` giữ cố định ở `110` cho dù tăng từ 50 lên 200 quân (18 loại hình khối × ~5–6 vật liệu/mẫu + 5 lớp hiệu ứng dùng chung). Desktop đạt tròn **60 FPS** ở 50 và 100 quân, đạt **48,5 FPS** ở 200 quân hiển thị đồng thời trên 1 khung hình (do trình duyệt Windows máy phát triển đang dựng ~197k tam giác + composite cùng Canvas 2D; mục tiêu 60 FPS tuyệt đối ở mốc 200 quân trên GPU tích hợp có thể tối ưu thêm bằng cách hạ ngưỡng `SYMBOL` khi mật độ > 150 quân nếu cần). Khung mobile giả lập đạt **49,3–60 FPS** (vượt xa ngưỡng 30 FPS).

---

## 4. Kiểm chứng Vòng đời, Sương mù chiến tranh & Hồi quy

- **74/74 bài kiểm thử tự động ĐẠT** (toàn bộ 71/71 hồi quy T01–T08 + 3/3 bài kiểm định T09 trong `src/server/vietnamCampaignT09.test.ts`).
- **4/4 bộ kiểm thử trình duyệt Microsoft Edge ĐẠT** (`0` lỗi JS, `0` lỗi mạng):
  1. `scripts/t09-visual-benchmark-test.mts`: kiểm chứng 36 GLB tải thực, chuyển đổi `SYMBOL → LOD2 → LOD1 → LOD0`, nâng cấp trực tiếp `BTR-40 → BTR-60PB` khi học `motor2`, cách ly Fog of War (quân địch ở Cà Mau không bao giờ rò sang lớp 3D), resize viewport `1440×900 → 1024×768 → 1440×900`, `webglcontextlost` → fallback 2D → `webglcontextrestored`, `?nowebgl=1` và mở ngoại tuyến `file:///.../index.html`.
  2. `scripts/campaign-online-browser-test.mts`: hồi quy 2 tài khoản đầy đủ T04–T08 trên cả 3 khung (`1440×900`, `390×844`, `844×390`).
  3. `campaign/forces-test.cjs`: hồi quy chơi đơn IndexedDB ngoại tuyến trên 3 khung.
  4. `scripts/room-browser-test.cjs`: hồi quy phòng 1955 `/rooms.html` trên 2 khung.
- **Ảnh chụp nghiệm thu đã kiểm tra trực tiếp:** `kiem-thu/t09-3d-desktop-war.png`, `kiem-thu/t09-3d-desktop-zoom.png`, `kiem-thu/t09-3d-mobile-doc.png`, `kiem-thu/t09-fallback-nowebgl.png`.

---

## 5. Phần chưa xác minh (NOT VERIFIED)

1. **8 slot GLB Không quân / Hải quân / Phòng không (`sam`, `fighter`, `corvette`, `submarine` × Bắc & Nam):** Chưa có mô hình GLB thật từ Military 3D Asset Studio; đang ghi nhận `MISSING_GLB` trong manifest và hiển thị hình khối dự phòng 2.5D/SVG.
2. **Thiết bị di động vật lý (iOS Safari / Android Chrome GPU thật):** Benchmark mobile `390×844` chạy trong Microsoft Edge giả lập cảm ứng trên Windows, chưa đo trên phần cứng điện thoại vật lý (nhiệt độ GPU, VRAM di động, tần số quét thật).
3. **Animation xương (Skeletal Animation) cho bộ binh:** Cả 36 file GLB hiện có `0` clip animation nhúng sẵn; chuyển động bước đi/rung xích/giật nòng hiện dùng animation thủ tục theo ma trận trên runtime.
4. **Mốc 200 quân đồng thời 60 FPS cứng trên desktop GPU tích hợp:** Đạt tròn `60,0 FPS` tại 50 và 100 quân, và `48,5 FPS` tại 200 quân đồng thời ở mức zoom `LOD2` trên máy phát triển hiện tại.
