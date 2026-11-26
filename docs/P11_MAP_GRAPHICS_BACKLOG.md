# Backlog Nâng cấp Đồ họa Bản đồ Cao cấp — Phase 11 (Operation Immersion)

> **Trạng thái:** GHI NHẬN VÀO BACKLOG `P11` — **KHÔNG TRIỂN KHAI NGAY**.
> Bản đồ hiện tại (`P02-05`) đã được Game Director nghiệm thu ở cấp độ **Geographic Map Foundation** làm nền tảng phát triển gameplay cho Giai đoạn 03–10.

## Các hạng mục nâng cấp đồ họa bản đồ để dành cho Phase 11

1. **Bản đồ địa hình đổ bóng cao cấp (Hillshade & DEM Relief):**
   - Sinh lớp hillshade / hypsometric tinting độ phân giải cao từ NASA SRTM DEM (mảng màu cổ điển lịch sử), bổ sung đường đồng mức (contour lines) theo mức zoom.
2. **Chất liệu bề mặt & sinh cảnh tự nhiên (Procedural Cartographic Textures):**
   - Kết cấu rừng rậm nhiệt đới, vùng ngập mặn đồng bằng, đất canh tác và nền giấy bản đồ quân sự tinh tế cho từng loại địa hình.
3. **Thủy văn & đường bờ biển nâng cao:**
   - Hiệu ứng thềm lục địa (bathymetry shading) cho Biển Đông, Vịnh Bắc Bộ, Vịnh Thái Lan; nét vẽ đường bờ biển đa tầng kiểu hải đồ lịch sử.
4. **Hệ thống biểu tượng & kiểu chữ bản đồ tùy biến (Custom Vector Sprites & Glyphs):**
   - Bộ biểu tượng riêng cho thủ đô, cảng biển, đầu mối đường sắt, sân bay, công trình kinh tế và nhà máy; glyph vector ngoại tuyến sắc nét cho tiếng Việt đầy đủ dấu không phụ thuộc CDN.
5. **Hoạt ảnh chiến trường & thời tiết theo mùa (Phase 11 Polish):**
   - Hiệu ứng gió mùa / mưa bão (kết hợp lớp `WEATHER`), chuyển động đoàn tàu/vận tải dọc tuyến giao thông và đường tiến quân trực quan khi Movement & Combat Engine hoàn thiện.
6. **Tối ưu LOD (Level of Detail) & hiệu năng di động cao cấp:**
   - Phân tầng chi tiết đường bờ biển, nhãn thành phố và chỉ báo bản đồ mượt mà ở 60fps trên thiết bị di động tầm trung.
