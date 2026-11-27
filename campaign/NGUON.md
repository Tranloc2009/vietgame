# Bản đồ Việt Nam

Mở index.html ở gốc repository bằng trình duyệt. Tệp đã đóng gói chứa địa hình, hình học, giao diện và mã tương tác. Bản mã nguồn cũng chạy trực tiếp từ index.html. Các tệp trong thư mục assets được dùng khi mở bản mã nguồn.

## Dữ liệu

| Thành phần | Đầu vào dùng để dựng bản giao |
|---|---|
| Địa hình và đáy biển | [Natural Earth II, raster NE2_HR_LC_SR_W](https://naturalearth.s3.amazonaws.com/10m_raster/NE2_HR_LC_SR_W.zip). Nền tô bóng dựng sẵn, có lớp phủ bề mặt. Cắt khung 86–128°Đ, 1–32°B và chỉnh sắc độ theo pixel. |
| Hình học vùng | [Natural Earth v5.1.2, Admin 1](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson). Lọc adm0_a3 bằng VNM. Bộ dữ liệu lưu 63 đối tượng lịch sử. |
| Điểm dân cư | [Natural Earth v5.1.2, Populated Places](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places_simple.geojson). Lọc iso_a2 bằng VN. Tên tiếng Việt được chuẩn hóa trong prepare.cjs. |
| Sông | [Natural Earth v5.1.2, sông và tim hồ](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_rivers_lake_centerlines.geojson). |
| Nền biên giới quốc gia | [World Atlas 2.0.2, chuyển đổi từ Natural Earth](https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json). |

Natural Earth công bố dữ liệu raster và vector thuộc phạm vi công cộng. Nền tô bóng cho thấy hình thái địa hình, chưa có chức năng truy vấn độ cao. Bản đồ khái quát phụ thuộc tỷ lệ dữ liệu nguồn, nhất là với đảo nhỏ. [Điều khoản Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)

## Tạo lại bản giao

Chạy `node build.cjs` từ thư mục chứa mã để đóng gói bản HTML độc lập từ các tài nguyên đã kèm. Chạy `node test.cjs` với thư viện Playwright và Microsoft Edge để kiểm tra tệp đã đóng gói. Ảnh và kết quả JSON được ghi vào thư mục kiem-thu bên cạnh campaign.

Để dựng lại dữ liệu từ đầu, từ thư mục workspace, lưu năm đầu vào phía trên lần lượt thành work/NE2_HR_LC_SR_W.tif (giải nén), work/areas.json, work/towns.json, work/data2.json và work/world.json. Chạy `node campaign/prepare.cjs` với thư viện sharp rồi chạy lại build.cjs. Bộ dữ liệu đóng gói sẵn dùng được ngoại tuyến.

## Mốc giao diện

Bản desktop dùng màn hình Classic trong wiki, phiên bản tài liệu ngày 17/05/2019. Ảnh tổng quan trong thư mục bang-chung chỉ dùng để đối chiếu. Số build client trong ảnh chưa xác định. [Wiki giao diện](https://wiki.conflictnations.com/User_Interface)

Thông tin quốc gia nằm ở góc trái trên, lẫy mở danh sách nằm cạnh phải, thông tin vùng chọn ở cạnh dưới và cụm bản đồ ở góc phải dưới. Bản thử dành thanh trên cho hai lớp bản đồ theo phạm vi Việt Nam. Giao diện điện thoại có ngăn địa danh mở từ dưới và hỗ trợ chụm hai ngón. Độ tương đồng với client mobile gốc chưa được xác minh.

Dữ liệu địa lý trong bản thử độc lập với 72 vùng, 24 thành phố và 98 kết nối gameplay của dự án VIETNAM. Bản thử chỉ xử lý địa danh và vùng Việt Nam. Các nước lân cận chỉ hiện trên nền.

## Giao diện trong trận

Menu quốc gia có Thành phố, Kho và Sự kiện. Bấm biểu tượng tài nguyên để xem thu và chi. Bấm điểm dân cư để quản lý sản xuất, xây dựng hoặc huy động. Từng thành phố có một hàng xây và một hàng huy động, có thể hoạt động đồng thời. Chuyển sang vùng địa lý sẽ đóng bảng thành phố.

Đây là chiến dịch chơi đơn ngoại tuyến. Số dư khởi đầu, loại tài nguyên phân bổ cho 60 điểm dân cư, chi phí, tốc độ và cơ chế hoàn tiền là tham số riêng của bản Việt Nam. Một cấp xưởng tăng 5 đơn vị sản phẩm địa phương mỗi giờ. Một cấp văn phòng tăng 2 nhân lực mỗi giờ và cấp đầu mở huy động. Mỗi đội dự bị tiêu thụ 1 tiếp tế và 2 tiền mỗi giờ. Dữ liệu lưu bằng IndexedDB của trình duyệt. Khi mở lại, mỗi lệnh được giải quyết theo thời điểm hoàn thành trước khi cộng phần thu nhập tiếp theo.

Ảnh thanh quản lý Classic dùng để đối chiếu tên thành phố, sản lượng mỗi ngày, chuyển thành phố và các lệnh xây dựng, huy động. Mốc tham chiếu có thêm tinh thần dân cư, đặc vụ, phá dỡ, điểm tập kết và thị trường giao dịch. Các hệ thống này còn ngoài phạm vi bản giao. [Wiki giao diện](https://wiki.conflictnations.com/User_Interface)

## Nghiên cứu, huy động và di chuyển

Menu Nghiên cứu mở nhánh Bộ binh cơ giới với hai cấp nối tiếp. Cấp I mở huy động ở thành phố có văn phòng tuyển dụng. Cấp II áp dụng cho lệnh di chuyển mới của cả đơn vị cơ giới đã có và đơn vị tạo sau. Hủy đề tài đang chạy hoàn lại phần chi phí tương ứng với thời gian còn lại, làm tròn xuống từng tài nguyên.

Khi huy động hoàn tất, mở Tổng quan hoặc Huy động của thành phố rồi bấm tên đơn vị. Cũng có thể bấm quân hiệu trên bản đồ hay chọn từ menu Đơn vị. Nếu nhiều đội cùng đóng tại một thành phố, quân hiệu hiện số lượng và mỗi lần bấm chọn đội kế tiếp. Chọn Di chuyển rồi bấm điểm dân cư hoặc chọn thành phố trong danh sách. Trên máy tính có thể bấm chuột phải lên địa danh khi đã chọn quân. Bảng lệnh hiển thị đích đến và thời gian còn lại. Dừng lại giữ vị trí hiện tại; đổi đích bắt đầu hành trình mới từ vị trí đó.

Bản lưu cũ được chuyển từng đội dự bị thành một đơn vị có mã riêng. Mỗi lần đọc lại trận, các lệnh hết hạn được xử lý và các đội đến nơi xuất hiện ở thành phố đích. Đường nét đứt nối các nút của kịch bản, thời gian do loại quân và cấp nghiên cứu quyết định. Checkpoint chỉ gồm nhánh lục quân trên và điều khiển di chuyển trong chiến dịch chơi đơn.

Cơ chế mở loại quân và điều kiện tiên quyết đối chiếu với [Research](https://wiki.conflictnations.com/Research). Hiển thị đích đến và thời gian còn lại đối chiếu với [Units](https://wiki.conflictnations.com/Units). Chi phí, các nút di chuyển, thời gian và cây hai cấp là cấu hình riêng của bản Việt Nam.
