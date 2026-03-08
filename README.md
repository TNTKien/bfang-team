# Mòe Truyện / BFANG Monorepo

Monorepo này chứa toàn bộ hệ sinh thái của web đọc truyện:

- Web chính (Express + EJS) cho người dùng và admin.
- Forum frontend React build ra `/forum` (tùy chọn).
- API server riêng cho desktop uploader (tùy chọn).
- App desktop Electron để upload chapter hàng loạt (tùy chọn).

README này ưu tiên hướng dẫn theo kiểu "copy-paste được ngay", kể cả cho người chưa biết code.

## 1) Thành phần trong repo

- `app.js`, `server.js`: server web chính.
- `src/`: domain logic + routes backend.
- `views/`: EJS cho trang public/admin.
- `public/`: CSS/JS tĩnh.
- `config.json`: cấu hình branding + SEO + text hiển thị.
- `api_server/`: API upload độc lập cho desktop app.
- `app_desktop/`: app Electron upload chapter hàng loạt.
- `sampleforum/`: forum frontend (Vite + React), build thành `sampleforum/dist` để web serve ở `/forum`.

## 2) Yêu cầu hệ thống

Tối thiểu để chạy web chính:

- Node.js LTS `20+`
- npm `10+` (đi kèm Node)
- PostgreSQL `16+`

Nếu dùng upload ảnh/chapter/forum:

- S3-compatible object storage (AWS S3 / Cloudflare R2 / MinIO / Backblaze B2 S3 API...)

Nếu dùng backup/restore script:

- `pg_dump`, `pg_restore`, `psql` (thường cài cùng PostgreSQL client tools)

## 3) Chạy nhanh web chính (TL;DR)

Lựa chọn nhanh nhất (1 lệnh setup từ đầu):

```powershell
npm run setup:all
```

Sau khi script xong, chạy web:

```powershell
npm run dev
```

Nếu muốn script setup xong tự chạy server ngay:

```powershell
npm run setup:all -- --start
```

```powershell
# 1) Cài dependencies
npm install

# 2) Tạo file môi trường
Copy-Item .env.example .env

# 3) Sửa DATABASE_URL, ADMIN_USER, ADMIN_PASS trong .env

# 4) Khởi tạo schema (khuyến nghị chạy lần đầu)
npm run db:bootstrap

# 5) Chạy server
npm run dev
```

macOS/Linux có thể thay `Copy-Item` bằng:

```bash
cp .env.example .env
```

Mở trình duyệt:

- Web: `http://127.0.0.1:3000`
- Admin login: `http://127.0.0.1:3000/admin/login`

## 4) Hướng dẫn chi tiết từ môi trường trắng (cho người mới)

Phần này giả định máy bạn chưa có gì ngoài Windows mới.

### Script setup tự động cho Windows/Ubuntu

Script `scripts/setup-all.js` chạy được trên cả Windows và Ubuntu (yêu cầu đã có Node.js).

- Script sẽ kiểm tra cứng: Node.js LTS 20+ và PostgreSQL 16+.
- Mặc định script chạy ở chế độ tương tác và sẽ hỏi lần lượt từng thông số setup.
- Script giả định database đã tồn tại và KHÔNG hỏi tài khoản PostgreSQL admin để tạo DB.
- Mặc định tài khoản DB gợi ý là `postgres` / `12345`.
- Ngay sau khi nhập xong thông số SQL, script sẽ test kết nối PostgreSQL (fail sớm nếu sai user/pass/host/port/db).
- Wizard sẽ hỏi thêm bạn có muốn setup ngay S3, Google OAuth, Discord OAuth hay không.
- Nếu bỏ qua các mục trên, script sẽ nhắc bạn cấu hình lại sau trong `.env`.

- Chạy mặc định:

```powershell
npm run setup:all
```

- Ví dụ chỉ định thông số DB:

```powershell
npm run setup:all -- --db-host=127.0.0.1 --db-port=5432 --db-name=moetruyen --db-user=postgres --db-pass=12345
```

- Non-interactive, đồng thời bỏ qua setup S3/Google/Discord lúc này:

```powershell
npm run setup:all -- --non-interactive --setup-s3=false --setup-google=false --setup-discord=false
```

### Bước 0 - Cài phần mềm nền

1. Cài Node.js LTS 20+ từ trang chính thức: `https://nodejs.org/`
2. Cài PostgreSQL 16+ (khuyến nghị bản 16), nhớ lưu mật khẩu user `postgres` khi installer hỏi.
3. (Khuyên dùng) Cài Git: `https://git-scm.com/download/win`

Kiểm tra sau khi cài xong (mở PowerShell mới):

```powershell
node -v
npm -v
psql --version
```

Nếu `psql` chưa nhận, mở lại máy hoặc thêm PostgreSQL `bin` vào `PATH`.

### Bước 1 - Lấy source code

Có 2 cách:

- Dùng Git:

```powershell
git clone <URL_REPO>
cd web1
```

- Hoặc tải ZIP, giải nén, rồi mở thư mục project `web1`.

### Bước 2 - Tạo database PostgreSQL

Cách nhanh bằng `psql`:

```sql
CREATE USER moetruyen WITH PASSWORD '12345';
CREATE DATABASE moetruyen OWNER moetruyen;
```

Nếu đã có user riêng rồi, chỉ cần tạo database và cấp quyền cho user đó.

### Bước 3 - Tạo file `.env`

Trong thư mục gốc repo:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

Mở `.env` bằng Notepad/VS Code và chỉnh tối thiểu:

```env
PORT=3000
APP_ENV=development

DATABASE_URL=postgresql://moetruyen:12345@localhost:5432/moetruyen

SESSION_SECRET=thay-bang-chuoi-ngau-nhien-toi-thieu-32-ky-tu
ADMIN_USER=admin
ADMIN_PASS=12345
ADMIN_PASSWORD_LOGIN_ENABLED=1

NEWS_PAGE_ENABLED=off
FORUM_PAGE_ENABLED=false
```

Lưu ý:

- Nếu password DB có ký tự đặc biệt (`@`, `:`, `/`, `#`, `%`...), cần URL-encode trong `DATABASE_URL`.
- Dù dev có thể chạy thiếu `SESSION_SECRET`, bạn vẫn nên set để session ổn định khi restart.

### Bước 4 - Cài dependencies

```powershell
npm install
```

### Bước 5 - Khởi tạo schema database

Chạy một lần sau khi tạo DB mới:

```powershell
npm run db:bootstrap
```

Script này sẽ:

- Sync schema DB.
- Repair dữ liệu forum legacy (nếu có).
- Verify trạng thái forum storage.

### Bước 6 - Chạy web

```powershell
npm run dev
```

Server mặc định chạy ở `http://127.0.0.1:3000`.

### Bước 7 - Smoke test cơ bản

Truy cập các URL sau để xác nhận web hoạt động:

- `/`
- `/manga`
- `/manga/:slug`
- `/manga/:slug/chapters/:number`
- `/admin/login`

## 5) Cấu hình `.env` cho web chính (root)

### Nhóm bắt buộc/khuyến nghị

| Biến | Bắt buộc | Mặc định | Mô tả |
| --- | --- | --- | --- |
| `DATABASE_URL` | Có | - | Chuỗi kết nối PostgreSQL cho web chính |
| `PORT` | Không | `3000` | Port web server |
| `APP_ENV` | Không | `development` | `development` hoặc `production` |
| `SESSION_SECRET` | Khuyến nghị mạnh | random tạm ở dev | Bắt buộc ở production, nên >= 32 ký tự |
| `ADMIN_USER` | Khuyến nghị | rỗng | Tài khoản admin password login |
| `ADMIN_PASS` | Khuyến nghị | rỗng | Mật khẩu admin password login |
| `ADMIN_PASSWORD_LOGIN_ENABLED` | Không | `1` | Tắt (`0`) nếu chỉ login admin bằng badge |

### Feature flags

| Biến | Mặc định code | Mô tả |
| --- | --- | --- |
| `NEWS_PAGE_ENABLED` | `true` | Bật/tắt module Tin tức (`/tin-tuc`) |
| `FORUM_PAGE_ENABLED` | `false` | Bật/tắt forum (`/forum`) |
| `JS_MINIFY_ENABLED` | `true` | Minify JS asset ở startup |

### URL/SEO/OAuth

| Biến | Mô tả |
| --- | --- |
| `APP_DOMAIN` | Domain chính của app |
| `SITE_URL`, `PUBLIC_SITE_URL` | URL public để build canonical/callback |
| `OAUTH_CALLBACK_BASE_URL` | Ép base URL callback OAuth |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Discord OAuth |

### Security/cookie/CSP

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `TRUST_PROXY` | `false` | Bật nếu chạy sau Nginx/Cloudflare/Render |
| `SESSION_COOKIE_SECURE` | theo `APP_ENV` | Cookie secure flag |
| `CSP_ENABLED` | `true` | Bật Content Security Policy |
| `CSP_REPORT_ONLY` | `false` | CSP report-only mode |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | rỗng | Cloudflare Turnstile |

### Storage (S3-compatible, dùng cho upload/chapter/forum)

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `S3_BUCKET` | - | Bucket name |
| `S3_ACCESS_KEY_ID` | - | Access key |
| `S3_SECRET_ACCESS_KEY` | - | Secret key |
| `S3_ENDPOINT` | rỗng | Endpoint S3-compatible |
| `S3_REGION` | `us-east-1` | Region |
| `S3_FORCE_PATH_STYLE` | `true` | Path-style URL |
| `S3_CHAPTER_PREFIX` | `chapters` | Prefix object cho chapter |
| `S3_FORUM_PREFIX` | `forum` | Prefix object cho forum |
| `CHAPTER_CDN_BASE_URL` | fallback endpoint | Base URL render ảnh chapter |
| `S3_FORUM_CDN_BASE_URL` | rỗng | Base URL render ảnh forum |

Ghi chú tương thích:

- Code vẫn hỗ trợ alias env kiểu B2 cũ (`B2_*`, `BUCKET`, `ENDPOINT`...).

## 6) Cấu hình `config.json` (branding + text + SEO)

File `config.json` cho phép đổi tên site, text trang chủ, nhãn admin, SEO mặc định.

Ví dụ các key thường chỉnh:

- `branding.siteName`, `branding.brandMark`, `branding.brandSubmark`
- `homepage.welcomeMessage`, `homepage.introduction`
- `seo.homepageTitle`, `seo.homepageDescription`

Sau khi sửa `config.json`, restart server để áp dụng.

## 7) Bật tính năng tùy chọn

### 7.1 Bật module Tin tức (`/tin-tuc`)

1. Trong `.env` set:

```env
NEWS_PAGE_ENABLED=true
```

2. Cấu hình DB tin tức bằng một trong 2 cách:

- Cách A: set full URL

```env
NEWS_DATABASE_URL=postgresql://user:pass@host:5432/news_db
```

- Cách B: dùng chung host/user/pass với `DATABASE_URL`, chỉ đổi tên DB

```env
NEWS_DATABASE_NAME=news_db
```

3. Restart server.

### 7.2 Bật Forum (`/forum`)

Forum cần build frontend từ `sampleforum`.

```powershell
npm --prefix sampleforum install
npm --prefix sampleforum run build
```

Trong `.env`:

```env
FORUM_PAGE_ENABLED=true
```

Restart web server, truy cập `http://127.0.0.1:3000/forum`.

Lưu ý:

- Nếu bật `FORUM_PAGE_ENABLED=true` mà chưa có `sampleforum/dist/index.html`, server sẽ cảnh báo và forum page không hoạt động.

### 7.3 Bật upload ảnh/chapter/forum qua S3

Không bắt buộc để chạy web read-only, nhưng bắt buộc cho các luồng upload/processing.

Ví dụ local MinIO:

```env
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=moetruyen
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true

CHAPTER_CDN_BASE_URL=http://127.0.0.1:9000/moetruyen
S3_CHAPTER_PREFIX=chapters
S3_FORUM_PREFIX=forum
```

## 8) Chạy `api_server` (API upload độc lập cho desktop)

`api_server` chạy riêng cổng (mặc định `3001`), dùng chung DB + storage với web.

### Cài và cấu hình

```powershell
npm --prefix api_server install
Copy-Item api_server/.env.example api_server/.env
```

macOS/Linux:

```bash
npm --prefix api_server install
cp api_server/.env.example api_server/.env
```

Tối thiểu trong `api_server/.env`:

```env
PORT=3001
DATABASE_URL=postgresql://moetruyen:12345@localhost:5432/moetruyen
API_KEY_SECRET=phai-trung-voi-SESSION_SECRET-cua-web
WEB_BASE_URL=http://127.0.0.1:3000

S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=...
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_CHAPTER_PREFIX=chapters
```

### Chạy và kiểm tra

```powershell
npm --prefix api_server run start
curl -i http://127.0.0.1:3001/health
```

Main endpoints:

- `GET /health`
- `GET /v1/bootstrap`
- `GET /v1/manga/:mangaId/chapters`
- `POST /v1/uploads/start`
- `POST /v1/uploads/:sessionId/pages`
- `POST /v1/uploads/:sessionId/complete`
- `DELETE /v1/uploads/:sessionId`

## 9) Chạy `app_desktop` (Electron bulk uploader)

```powershell
npm --prefix app_desktop install
npm --prefix app_desktop run start
```

Trong app:

1. Nhập API endpoint (ví dụ `http://127.0.0.1:3001`).
2. Nhập API key từ trang account web.
3. Chọn truyện và thư mục chapter để upload hàng loạt.

Tài liệu chi tiết: `app_desktop/HUONG_DAN_SU_DUNG.md`.

Build `.exe`:

```powershell
npm --prefix app_desktop run build:win
```

## 10) Scripts quan trọng (root)

| Lệnh | Mục đích |
| --- | --- |
| `npm run dev` | Chạy web ở chế độ dev (`predev` tự build CSS) |
| `npm run start` | Chạy web ở chế độ start (`prestart` tự build CSS) |
| `npm run setup:all` | Setup từ đầu: env + deps + db bootstrap + build assets |
| `npm run styles:build` | Build `public/styles.css` từ `public/styles.source.css` |
| `npm run styles:watch` | Watch và build CSS liên tục |
| `npm run db:schema:sync` | Sync schema an toàn (không destructive) |
| `npm run db:schema:sync:strict` | Sync schema có destructive update |
| `npm run db:forum:repair` | Audit forum storage (dry-run) |
| `npm run db:forum:repair:apply` | Apply forum storage repair |
| `npm run db:bootstrap` | Sync schema + repair forum + verify |
| `npm run db:bootstrap:strict` | Bootstrap ở strict mode |
| `npm run backup:db` | Backup DB bằng `pg_dump` |
| `npm run restore:db` | Restore DB bằng `pg_restore`/`psql` |
| `npm run purge:tmp` | Dọn tmp local + db + remote storage |
| `npm run test:forum:unit` | Chạy unit test trong `sampleforum` |
| `npm run test:forum:smoke` | Smoke test forum API |
| `npm run test:forum` | Chạy unit + smoke forum |
| `npm run forum:scope:audit` | Audit scope dữ liệu forum/comments |
| `npm run forum:scope:fix` | Apply scope fix cho forum/comments |
| `npm run forum:notifications:fix` | Fix link notification forum |
| `npm run forum:cleanup:image-posts` | Cleanup forum image posts |

## 11) Cấu trúc thư mục

```text
.
├─ app.js
├─ server.js
├─ config.json
├─ src/
│  ├─ app/
│  ├─ config/
│  ├─ domains/
│  ├─ routes/
│  └─ news/
├─ views/
│  ├─ admin/
│  └─ partials/
├─ public/
├─ scripts/
├─ api_server/
├─ app_desktop/
└─ sampleforum/
```

## 12) Smoke checklist sau khi cài

### Public

- `/` hiển thị trang chủ.
- `/manga` lọc/tìm kiếm hoạt động.
- `/manga/:slug` hiển thị detail + chapter list.
- `/manga/:slug/chapters/:number` đọc ảnh chapter.

### Account/Admin

- `/account` vào được khi login.
- `/admin/login` login bằng `ADMIN_USER` / `ADMIN_PASS`.
- `/admin` vào dashboard.

### Optional

- Nếu bật forum: `/forum` và `/forum/post/:id`.
- Nếu bật news: `/tin-tuc`.

## 13) Backup/Restore database

Backup nhanh:

```powershell
npm run backup:db
```

Restore (bắt buộc xác nhận `--yes`):

```powershell
npm run restore:db -- --file backups/<ten_file>.dump --yes
```

Lưu ý:

- Restore mode mặc định là `replace` (phá dữ liệu cũ trong schema đích).
- Đọc help trước khi restore:

```powershell
node scripts/restore-db.js --help
```

## 14) Sự cố thường gặp

### `DATABASE_URL chưa được cấu hình trong .env`

- Bạn chưa tạo/chỉnh `.env` hoặc chuỗi kết nối DB sai.

### Không login được admin

- Kiểm tra `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_PASSWORD_LOGIN_ENABLED`.

### Không thấy `/forum`

Kiểm tra đủ 3 điều kiện:

1. `.env` có `FORUM_PAGE_ENABLED=true`
2. Đã build forum: `npm --prefix sampleforum run build`
3. Có file `sampleforum/dist/index.html`

### `401 API key invalid/revoked` ở desktop/api_server

- `API_KEY_SECRET` của `api_server` phải trùng `SESSION_SECRET` của web.
- Tạo lại API key trên trang account nếu key cũ đã revoke.

### Upload xong nhưng web không hiện ảnh

- Kiểm tra `CHAPTER_CDN_BASE_URL` / `S3_FORUM_CDN_BASE_URL`.
- Kiểm tra object có tồn tại đúng prefix (`chapters/...`, `forum/...`).
- Purge cache CDN/proxy nếu vừa đổi hạ tầng.

### Backup/restore báo thiếu binary

- Cài PostgreSQL client tools hoặc set `PG_DUMP_BIN` / `PG_RESTORE_BIN` / `PSQL_BIN`.

## 15) Bảo mật và workspace hygiene

Không commit các file nhạy cảm hoặc runtime data:

- `.env`, `api_server/.env`, `app_desktop/.env`
- `uploads/`
- `backups/`
- `app_desktop/dist/`
- `sampleforum/dist/`

Khuyến nghị production:

- `APP_ENV=production`
- `SESSION_SECRET` mạnh (>=32 ký tự)
- `SESSION_COOKIE_SECURE=true`
- `TRUST_PROXY=1` (nếu chạy sau reverse proxy)
- Bật CSP (`CSP_ENABLED=true`)

---

Nếu bạn chỉ muốn chạy bản tối thiểu để đọc truyện local, chỉ cần web chính + PostgreSQL.
`api_server`, `app_desktop`, `sampleforum` có thể bật sau khi hệ thống lõi đã chạy ổn định.
