# Hướng dẫn Triển khai & Vận hành Production (Release Candidate)

Tài liệu này mô tả quy trình đóng gói, chạy production, cấu hình reverse-proxy HTTPS/WSS, sao lưu nóng SQLite WAL và giám sát hệ thống cho **VIETNAM: THE DIVIDED NATION** (`vietnam_campaign_v1` tại `/` và `/rooms.html`).

---

## 1. Biến môi trường bắt buộc ở Production

| Biến | Giá trị mẫu | Ý nghĩa |
|---|---|---|
| `NODE_ENV` | `production` | Phục vụ gói tĩnh đã build trong `dist/` thay vì Vite middleware |
| `APP_ENV` | `production` | Khóa endpoint preview fixture (`POST /api/matches/fixture` trả `403`) và ép buộc phải khai báo `SQLITE_DB_PATH` |
| `PORT` | `3000` | Cổng HTTP + WebSocket (`/ws`) nội bộ |
| `HOST` | `127.0.0.1` | Khuyến nghị bind loopback phía sau Nginx/Caddy |
| `SQLITE_DB_PATH` | `/var/lib/vietgame/vdn-prod.sqlite` | Đường dẫn tệp SQLite bền vững (chế độ WAL tự động bật) |

> **Lưu ý:** Không cần bất kỳ API key trả phí nào (`aiApiDependency: false`). Toàn bộ chiến dịch, Bộ Tư Lệnh Máy (AI) và lưu trữ vận hành 100% nội bộ.

---

## 2. Quy trình Build & Khởi chạy

```bash
npm ci
npm run typecheck
npm run build
npm run test

NODE_ENV=production \
APP_ENV=production \
HOST=127.0.0.1 \
PORT=3000 \
SQLITE_DB_PATH=/var/lib/vietgame/vdn-prod.sqlite \
npm run start
```

---

## 3. Reverse Proxy HTTPS & WebSocket (`/ws`)

### Ví dụ cấu hình Caddy (tự động cấp chứng chỉ TLS)
```caddyfile
game.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

### Ví dụ cấu hình Nginx
```nginx
server {
  listen 443 ssl http2;
  server_name game.example.com;

  location /ws {
    proxy_pass http://127.0.0.1:3000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

---

## 4. Sao lưu nóng SQLite (Hot Backup) & Kiểm chứng phục hồi

Máy chủ dùng SQLite WAL nên **không sao chép thô tệp `.sqlite`** khi đang ghi. Luôn dùng lệnh `VACUUM INTO` có sẵn:

```bash
npm run backup:db -- --db /var/lib/vietgame/vdn-prod.sqlite --out /var/backups/vietgame/vdn-$(date +%F).sqlite
```

Script [scripts/backup-sqlite.mts](../scripts/backup-sqlite.mts) sẽ tự động:
1. Tạo bản sao lưu nguyên tử bằng `VACUUM INTO` khi server vẫn đang chạy.
2. Chạy `PRAGMA integrity_check` trên tệp backup.
3. Phát lại nhật ký lệnh (`verifyMatchReplay`) cho **toàn bộ các trận** trong bản backup và xuất mã băm SHA-256 kiểm chứng.

Khuyến nghị đặt lịch cron chạy mỗi 6 giờ và giữ bản sao lưu tối thiểu 14 ngày.

---

## 5. Giám sát & Bảo mật vận hành

- **Health Check:** `GET /api/health` (kiểm tra ghi thực lên SQLite, danh sách migration `001`–`004`, trạng thái kết nối WebSocket).
- **Operational Metrics:** `GET /api/metrics` (uptime, số phòng `ACTIVE`/`ENDED`, số kết nối WS, số lệnh xử lý/từ chối, số lần chạm rate-limit, chế độ WAL, kích thước DB và bộ nhớ RSS).
- **Bảng xếp hạng:** `GET /api/leaderboard` (tổng hợp thực từ `match_rooms` + `matches`, không chứa dữ liệu nhạy cảm).
- **Rate-Limiting tích hợp:**
  - `/api/auth/register`, `/api/auth/login`: tối đa 40 yêu cầu / 60 giây / IP (`429 RATE_LIMITED` + `Retry-After`).
  - `/api/rooms/:matchId/commands`: tối đa 180 lệnh / 60 giây / tài khoản.
  - WebSocket `/ws`: tối đa 120 khung tin / 10 giây / kết nối, giới hạn payload 32 KB.
