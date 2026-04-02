# Mòe Truyện Monorepo

## 1) Repo này có gì?

Monorepo gồm 4 phần chính:

- **Web chính** (Express + EJS): đọc truyện, bình luận, admin.
- **Forum frontend** (`sampleforum`, tùy chọn): build ra static và web chính serve ở `/forum`.
- **API server upload** (`api_server`, tùy chọn): API cho app desktop upload chapter hàng loạt.
- **App desktop** (`app_desktop`, tùy chọn): Electron app upload chapter.

## 2) Yêu cầu hệ thống

Tối thiểu để chạy web chính:

- Node.js **20+**
- npm **10+**
- PostgreSQL **16+**

Nếu dùng upload ảnh/chapter/forum:

- S3-compatible storage (AWS S3 / Cloudflare R2 / MinIO / B2 S3 API)

Nếu dùng backup/restore:

- `pg_dump`, `pg_restore`, `psql`

## 3) Cách cài đặt (TL;DR)

### Cách 1: setup tự động (khuyên dùng)

```powershell
npm run setup:all
npm run dev
```

### Cách 2: setup thủ công

```powershell
npm install
Copy-Item .env.example .env
# sửa DATABASE_URL, ADMIN_USER, ADMIN_PASS trong .env
npm run db:bootstrap
npm run dev
```

macOS/Linux:

```bash
npm install
cp .env.example .env
npm run db:bootstrap
npm run dev
```

Web mặc định: `http://127.0.0.1:3000`

## 4) Hướng dẫn cài đặt ban đầu (project trắng)

### Bước 1 - Lấy source

```powershell
git clone <REPO_URL>
cd web1
```

### Bước 2 - Cài dependencies

```powershell
npm install
```

### Bước 3 - Tạo database PostgreSQL

Vào `psql` bằng user admin (thường là `postgres`), rồi tạo user + db:

```sql
CREATE USER bfang WITH PASSWORD '12345';
CREATE DATABASE bfang OWNER bfang;
```

### Bước 4 - Tạo file `.env`

```powershell
Copy-Item .env.example .env
```

Set tối thiểu:

```env
PORT=3000
APP_ENV=development
DATABASE_URL=postgresql://bfang:12345@localhost:5432/bfang

SESSION_SECRET=<chuoi-ngau-nhien-it-nhat-32-ky-tu>
ADMIN_USER=admin
ADMIN_PASS=12345
ADMIN_PASSWORD_LOGIN_ENABLED=1

NEWS_PAGE_ENABLED=off
FORUM_PAGE_ENABLED=false
```

### Bước 5 - Bootstrap schema + dữ liệu cần thiết

```powershell
npm run db:bootstrap
```

Lệnh này sẽ:

- sync schema DB,
- repair dữ liệu forum legacy,
- verify lại forum storage,
- cập nhật snapshot schema vào `db.json`.

### Bước 6 - Chạy server

```powershell
npm run dev
```

### Bước 7 - Smoke test

- `/`
- `/manga`
- `/manga/:slug`
- `/manga/:slug/chapters/:number`
- `/admin/login`

## 5) Hướng dẫn cập nhật project có sẵn (production hoặc staging)

Quy trình khuyên dùng:

### Bước 1 - Backup trước khi update

```powershell
npm run backup:db
```

### Bước 2 - Pull code mới + cài lại deps

```powershell
git pull
npm install
```

Nếu có module tùy chọn:

```powershell
npm --prefix api_server install
npm --prefix sampleforum install
npm --prefix app_desktop install
```

### Bước 3 - Soát biến môi trường mới

- Mở `.env.example` mới nhất.
- Bổ sung biến mới vào `.env` đang chạy.
- Không xóa secret cũ nếu hệ thống vẫn dùng.

### Bước 4 - Chạy migration/sync DB

```powershell
npm run db:bootstrap
```

Nếu cần chạy schema destructive (rất cẩn thận):

```powershell
npm run db:bootstrap:strict
```

### Bước 5 - Build lại assets tùy chọn

```powershell
npm run styles:build
npm --prefix sampleforum run build
```

### Bước 6 - Restart service + smoke test

Kiểm tra lại các route chính và login admin.

## 6) `db.json` và quy tắc đồng bộ schema

Project dùng `db.json` làm snapshot cấu trúc DB (table/cột/type/nullability) để các script setup/sync đối chiếu.

- Sync snapshot từ DB thực tế:

```powershell
npm run db:schema:json:sync
```

- Sync toàn bộ table hiện có trong schema hiện tại:

```powershell
npm run db:schema:json:sync:all
```

- Sync schema theo code + kiểm tra với `db.json`:

```powershell
npm run db:schema:sync
```

**Quy tắc bắt buộc khi sửa cấu trúc DB** (thêm/sửa bảng hoặc cột):

1. Sửa code schema.
2. Chạy `npm run db:schema:sync`.
3. Chạy `npm run db:schema:json:sync`.
4. Commit code + `db.json` cùng nhau.

## 7) Hướng dẫn lấy biến môi trường từ gốc (env acquisition)

Phần này trả lời câu hỏi "lấy từng biến ở đâu".

### 7.1 Nhóm core bắt buộc

- `DATABASE_URL`: lấy từ PostgreSQL bạn đang dùng.
  - Format: `postgresql://<user>:<pass>@<host>:<port>/<db>`
- `SESSION_SECRET`: tự sinh chuỗi ngẫu nhiên dài (>= 32 ký tự).
- `ADMIN_USER`, `ADMIN_PASS`: do bạn tự đặt.

### 7.1.1 Redis cache (key nghiệp vụ)

Điền trực tiếp vào file **`.env` ở thư mục gốc web** (`web1/.env`):

- `REDIS_URL`: URL kết nối Redis (ví dụ: `redis://127.0.0.1:6379/0`)
- `REDIS_CACHE_ENABLED`: bật/tắt Redis helper tổng thể (`true/false`)
- `REDIS_PREFIX`: prefix key (mặc định `bfang`)
- `REDIS_DEFAULT_TTL_SECONDS`: TTL mặc định cho helper Redis
- `REDIS_CONNECT_TIMEOUT_MS`: timeout kết nối Redis
- `REDIS_RECONNECT_RETRY_MS`: chu kỳ retry reconnect

Biến bật/tắt business-key cache + version invalidation:

- `REDIS_BUSINESS_CACHE_ENABLED`
- `REDIS_CACHE_VERSION_REFRESH_MS`

> Tương thích ngược: có thể dùng biến cũ `SQL_REDIS_CACHE_ENABLED` và `SQL_REDIS_CACHE_VERSION_REFRESH_MS`.

Business key hiện dùng dạng dễ debug/xóa cache, ví dụ:

- `bfang:endpoint:manga:list:...`
- `bfang:endpoint:manga:{slug}:...`
- `bfang:endpoint:chapter:{slug}:{number}:...`
- `bfang:endpoint:homepage:{audience}`

Server log sẽ ghi rõ `CACHE HIT` / `CACHE MISS` cho endpoint cache.

Biến TTL endpoint-level cache (nghiệp vụ):

- `ENDPOINT_CACHE_HOMEPAGE_TTL_SECONDS`
- `ENDPOINT_CACHE_MANGA_LIST_TTL_SECONDS`
- `ENDPOINT_CACHE_MANGA_DETAIL_TTL_SECONDS`
- `ENDPOINT_CACHE_CHAPTER_DETAIL_TTL_SECONDS`
- `ENDPOINT_CACHE_FORUM_HOME_TTL_SECONDS`

Ví dụ nhanh:

```env
REDIS_CACHE_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379/0
REDIS_PREFIX=bfang
REDIS_DEFAULT_TTL_SECONDS=30
REDIS_CONNECT_TIMEOUT_MS=5000
REDIS_RECONNECT_RETRY_MS=15000

REDIS_BUSINESS_CACHE_ENABLED=true
REDIS_CACHE_VERSION_REFRESH_MS=1500

ENDPOINT_CACHE_HOMEPAGE_TTL_SECONDS=45
ENDPOINT_CACHE_MANGA_LIST_TTL_SECONDS=180
ENDPOINT_CACHE_MANGA_DETAIL_TTL_SECONDS=300
ENDPOINT_CACHE_CHAPTER_DETAIL_TTL_SECONDS=450
ENDPOINT_CACHE_FORUM_HOME_TTL_SECONDS=45
```

### 7.2 MinIO / S3-compatible (ảnh chapter/forum)

Biến liên quan:

- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE`
- `CHAPTER_CDN_BASE_URL`
- `S3_CHAPTER_PREFIX`

#### Setup MinIO local nhanh

Ví dụ chạy MinIO bằng Docker:

```powershell
docker run -d --name minio -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin quay.io/minio/minio server /data --console-address ":9001"
```

Vào Console: `http://127.0.0.1:9001` (user/pass: `minioadmin` / `minioadmin`)

Tạo bucket (ví dụ `bfang`), rồi set:

```env
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=bfang
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
S3_CHAPTER_PREFIX=chapters
CHAPTER_CDN_BASE_URL=http://127.0.0.1:9000/bfang
```

### 7.3 Google OAuth login (web)

Biến:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Các bước lấy:

1. Vào Google Cloud Console, tạo project.
2. Enable API: **Google People API** (hoặc API profile cần dùng).
3. Tạo OAuth consent screen.
4. Tạo OAuth Client ID (Web application).
5. Thêm Redirect URI theo domain chạy web, ví dụ:
   - `http://127.0.0.1:3000/auth/google/callback`
   - `https://your-domain/auth/google/callback`
6. Copy Client ID/Secret vào `.env`.

### 7.4 Discord OAuth login (web)

Biến:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`

Các bước lấy:

1. Vào Discord Developer Portal.
2. Tạo application.
3. Vào OAuth2, thêm Redirect URI callback tương ứng domain.
4. Copy client id/secret vào `.env`.

### 7.5 Google Drive API (upload ảnh bình luận/tin nhắn)

Biến:

- `GOOGLE_DRIVE_UPLOAD_ENABLED`
- `COMMENT_IMAGE_UPLOAD_ENABLED`
- `MESSAGE_IMAGE_UPLOAD_ENABLED`
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`

Các bước lấy:

1. Tạo project trên Google Cloud Console.
2. Enable **Google Drive API**.
3. Tạo OAuth Client ID + Client Secret.
4. Lấy refresh token (thường qua OAuth flow hoặc OAuth Playground).
5. Tạo thư mục trong Drive, lấy `folderId` từ URL.
6. Set biến:

```env
GOOGLE_DRIVE_UPLOAD_ENABLED=true
COMMENT_IMAGE_UPLOAD_ENABLED=true
MESSAGE_IMAGE_UPLOAD_ENABLED=true
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DRIVE_REFRESH_TOKEN=...
GOOGLE_DRIVE_FOLDER_ID=...
```

### 7.6 Auth và URL base liên quan callback

Biến thường cần set đúng theo môi trường:

- `APP_ENV`
- `APP_DOMAIN`
- `SITE_URL`
- `PUBLIC_SITE_URL`
- `OAUTH_CALLBACK_BASE_URL`
- `TRUST_PROXY`
- `SESSION_COOKIE_SECURE`

Gợi ý:

- Local: `APP_ENV=development`, `SESSION_COOKIE_SECURE=false`
- Production HTTPS: `APP_ENV=production`, `SESSION_COOKIE_SECURE=true`, `TRUST_PROXY=1`

## 8) Chạy module tùy chọn

### 8.1 Forum frontend (`sampleforum`)

```powershell
npm --prefix sampleforum install
npm --prefix sampleforum run build
```

Set `.env`:

```env
FORUM_PAGE_ENABLED=true
```

### 8.2 News module

Set `.env`:

```env
NEWS_PAGE_ENABLED=on
```

Nếu dùng DB news riêng thì set thêm `NEWS_DATABASE_URL`.

### 8.3 `api_server` cho desktop uploader

```powershell
npm --prefix api_server install
Copy-Item api_server/.env.example api_server/.env
npm --prefix api_server run start
```

Lưu ý quan trọng: `API_KEY_SECRET` của `api_server` phải trùng `SESSION_SECRET` web chính.

### 8.4 `app_desktop`

```powershell
npm --prefix app_desktop install
npm --prefix app_desktop run start
```

Tài liệu chi tiết: `app_desktop/HUONG_DAN_SU_DUNG.md`

### 8.5 `config.json`

`config.json` có tác dụng cấu hình nội dung hiển thị cho web.

Các nhóm cấu hình chính:

- `branding`: `siteName`, `brandMark`, `brandSubmark`, `aboutNavLabel`, `heroKicker`, `updateTag`, `footerYear`
- `homepage`: `welcomeMessage`, `introduction`, `aboutTitle`, `foundedYear`, `contentStandardsTitle`, `contentStandards[]`, `contactTitle`
- `contact`: `facebookUrl`, `facebookLabel`, `discordUrl`, `discordLabel`
- `SEO`: `defaultDescription`, `homepageTitle`, `homepageDescription`
- `admin`: `teamManageLabel`, `adminLabel`, `loginNote`

Lưu ý:

- Sửa `config.json` xong cần restart server để thấy thay đổi.

## 9) Danh sách lệnh chính

| Lệnh | Mục đích |
| --- | --- |
| `npm run dev` | Chạy web ở chế độ dev |
| `npm run start` | Chạy web ở chế độ start |
| `npm run setup:all` | Setup tự động toàn project |
| `npm run styles:build` | Build CSS |
| `npm run db:bootstrap` | Sync schema + repair forum + sync `db.json` |
| `npm run db:bootstrap:strict` | Bootstrap strict/destructive |
| `npm run db:schema:sync` | Sync schema theo code và đối chiếu `db.json` |
| `npm run db:schema:sync:strict` | Sync schema destructive |
| `npm run db:schema:json:sync` | Sync snapshot schema về `db.json` |
| `npm run db:schema:json:sync:all` | Snapshot từ toàn bộ table trong schema |
| `npm run db:forum:repair` | Audit forum storage |
| `npm run db:forum:repair:apply` | Apply forum storage repair |
| `npm run backup:db` | Backup DB |
| `npm run restore:db` | Restore DB |

## 10) Troubleshooting nhanh

### `DATABASE_URL is required`

- Chưa tạo `.env` hoặc chưa set `DATABASE_URL` đúng format.

### Login admin không được

- Kiểm tra `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_PASSWORD_LOGIN_ENABLED`.

### Bật forum mà `/forum` không chạy

Đảm bảo đủ 3 điều kiện:

1. `FORUM_PAGE_ENABLED=true`
2. Đã build `sampleforum`
3. Có `sampleforum/dist/index.html`

### API key ở desktop báo invalid/revoked

- Tạo lại API key trên web.
- Đảm bảo `api_server/.env` có `API_KEY_SECRET` trùng `SESSION_SECRET` web.

### Upload xong nhưng ảnh không hiện

- Kiểm tra `CHAPTER_CDN_BASE_URL`.
- Kiểm tra object tồn tại đúng bucket/prefix.
- Purge cache CDN/proxy nếu vừa đổi hạ tầng.

## 11) Security và hygiene

Không commit:

- `.env`, `api_server/.env`, `app_desktop/.env`
- `uploads/`
- `backups/`
- build artifacts (`sampleforum/dist`, `app_desktop/dist`)

Khuyến nghị production:

- `APP_ENV=production`
- `SESSION_SECRET` mạnh
- `SESSION_COOKIE_SECURE=true`
- `TRUST_PROXY=1` (nếu chạy sau reverse proxy)

---

Nếu bạn muốn chạy tối thiểu chỉ để đọc truyện local: chỉ cần **web chính + PostgreSQL**. Các module `api_server`, `app_desktop`, `sampleforum`, upload cloud có thể bật sau.
