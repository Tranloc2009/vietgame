# Checkpoint phát triển

| Nhiệm vụ | Phụ thuộc | Ưu tiên | Kết quả nghiệm thu | Tệp chính | Kiểm thử | Commit |
|---|---|---|---|---|---|---|
| T01 Hợp nhất công việc cũ | eaadb11 | P0 | IMPLEMENTED. Phần xem tuyến và kinh tế cùng có trên nhánh riêng | src/web, src/server, src/simulation | Bộ hồi quy chung | 9b3fc12, a770d98, 4a73e47 |
| T02 Hành quân | T01 | P0 | VERIFIED. Lệnh từ chủ quân, trừ tiếp tế theo chặng, dừng và đến nơi theo thời gian | src/simulation/reducer.ts, src/server/createApp.ts, src/web/components/MovementPreviewPanel.tsx | API, replay, hai trình duyệt | 2271053 |
| T03 Hiệp ước tình báo | T02 | P1 | VERIFIED. Hai bên có quyền khác nhau, chỉ thấy liên hệ ở phạm vi cho phép, có thể kết thúc hoặc hết hạn | src/contracts/rooms.ts, src/simulation/reducer.ts, src/web/DiplomacyDrawer.tsx | simulation.test.ts và room-browser-test.cjs | ce31a2b |

| T02b Đổi đích nguyên tử | T02 | P0 | VERIFIED. Xem trước và hủy đổi đích giữ tuyến đang chạy. Xác nhận thay thế tuyến bằng một lệnh | MovementPreviewPanel.tsx, reducer.ts, createApp.ts | API kiểm tra giữ nguyên trạng thái khi lệnh lỗi, hai trình duyệt đổi đích rồi dừng | 1aebb13 |

Mốc đối chiếu của bản chơi đơn gồm file HTML và nguồn trong ../ban-do ở ngoài repo này. Phần nghiên cứu và huy động tại đó đã được kiểm lại riêng. Xem TEST_REPORT.md và NEXT_TASK.md.
