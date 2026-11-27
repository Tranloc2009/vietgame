# Điểm tiếp tục

Mốc **T04 (Nghiên cứu → Huy động → Điều khiển quân trên máy chủ ngay trên bản đồ Việt Nam mới ở `/`)** đã hoàn thành và kiểm thử đầy đủ trên 55 bài tự động cùng 3 khung trình duyệt Edge (desktop và cảm ứng). Đang dừng tại mốc này để Game Director nghiệm thu trước khi bước sang T05.

**T05 · P0 · Giao tranh trên máy chủ, chiếm đóng thành phố và điểm chiến thắng cho kịch bản Việt Nam (`vietnam_campaign_v1`)**

Phụ thuộc T04. Tiếp tục phát triển trực tiếp trên bản đồ Việt Nam mới (`campaign/` + `src/simulation/vietnamCampaignEngine.ts`).

1. **Combat Engine trên máy chủ:** Mở rộng lệnh di chuyển cho phép tiến vào thành phố/vị trí đối phương khi ở trạng thái chiến tranh; thêm chỉ số chiến đấu (HP, tấn công, phòng thủ, tầm phát hiện, tầm đánh) trong danh mục máy chủ và xử lý giao tranh theo tick tất định.
2. **Chiếm đóng lãnh thổ & thành phố:** Cập nhật `ownerNationId` của thành phố khi đơn vị có quyền chiếm đóng giành thắng lợi, hủy/xử lý an toàn hàng đợi của chủ cũ, cập nhật lại sản lượng kinh tế, màu đánh dấu trên bản đồ và thông báo nhật ký.
3. **Điểm chiến thắng & kết trận:** Tính Victory Points từ thành phố và thủ đô, hiển thị bảng xếp hạng/mục tiêu chiến thắng trên HUD, và kết thúc trận tất định khi đạt ngưỡng thắng hoặc đầu hàng.
4. **Mở rộng cây công nghệ & công trình theo tham chiếu Supremacy WW3:** Bổ sung căn cứ lục quân, trinh sát/xe thiết giáp/pháo binh, gộp/tách đội hình (stack/split) và ngoại giao tuyên chiến/hòa bình trực tiếp trên bản đồ Việt Nam mới.
