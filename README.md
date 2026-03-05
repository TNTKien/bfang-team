# BFANG Manga Platform

Nền tảng đọc truyện tranh của BFANG Team, xây bằng Node.js + Express + PostgreSQL.

Ứng dụng gồm 3 phần chính:
- Site đọc truyện + tài khoản người dùng.
- Khu quản trị nội dung (admin CMS).
- Module mở rộng theo cờ tính năng: Tin tức (`/tin-tuc`) và Diễn đàn (`/forum`).

## Tính năng nổi bật

- Đọc manga: trang chủ, thư viện, trang chi tiết, trang đọc chapter.
- Bình luận theo nhánh, mention người dùng, stream thông báo realtime (SSE).
- Tài khoản người dùng với OAuth (Google/Discord), hồ sơ và lịch sử đọc.
- Team dịch: quản lý thành viên, vai trò, khu chat nội bộ.
- Admin CMS: quản lý manga/chapter/genre/comment/member/badge/homepage/team.
- Upload ảnh chapter/forum lên object storage S3-compatible.
- Tuỳ biến thương hiệu bằng `config.json` (tên web, SEO, nội dung trang chủ, nhãn admin).

## Tech stack

- Backend: Node.js, Express, EJS.
- Database: PostgreSQL (`pg`).
- Session: `express-session` + bảng `web_sessions` trong Postgres.
- Auth: Passport OAuth2 (Google + Discord).
- Upload/Image: `multer`, `sharp`.
- Storage: AWS SDK S3 client (tương thích S3/B2/MinIO).
- CSS: Tailwind build từ `public/styles.source.css` ra `public/styles.css`.
- Forum frontend (tuỳ chọn): React + Vite + TypeScript trong `sampleforum/`.

## Kiến trúc nhanh

- `server.js`: entrypoint, gọi `createApp()` và `startServer()`.
- `app.js`: composition root, tạo app Express, wire domain/routes, khởi tạo DB/runtime.
- `src/domains/`: domain logic (DB init, auth user, manga, storage, notification, security-session).
- `src/routes/`: route modules cho site/admin/forum/news.
- `views/`: EJS templates.
- `public/`: static assets (CSS/JS/images/service worker).
- `scripts/`: script vận hành (backup/restore, cleanup, forum smoke check, audit/fix).

## Yêu cầu hệ thống

- Node.js 20+.
- PostgreSQL 14+ (hoặc tương đương).
- Tuỳ chọn cho backup/restore: `pg_dump`, `pg_restore`, `psql`.
- Tuỳ chọn cho upload ảnh: object storage S3-compatible.

## Cài đặt local

### 1) Cài dependencies

```bash
npm install
```

Nếu dùng forum frontend riêng:

```bash
npm --prefix sampleforum install
```

### 2) Tạo `.env`

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

### 3) Cấu hình tối thiểu

```env
PORT=3000
DATABASE_URL=postgresql://postgres:password@localhost:5432/your_db
SESSION_SECRET=mot_chuoi_bi_mat_dai_it_nhat_32_ky_tu
APP_ENV=development
```

### 4) (Tuỳ chọn) bật forum UI

Khi `FORUM_PAGE_ENABLED=true`, backend sẽ serve `sampleforum/dist` tại `/forum`.

```bash
npm --prefix sampleforum run build
```

### 5) Chạy app

```bash
npm run dev
```

Mở nhanh:
- Site: `http://localhost:3000`
- Admin login: `http://localhost:3000/admin/login`
- News: `http://localhost:3000/tin-tuc` (khi bật)
- Forum: `http://localhost:3000/forum` (khi bật + đã build)

## Tuỳ biến thương hiệu (`config.json`)

Ứng dụng đọc cấu hình site từ `config.json` tại thư mục gốc, gồm:
- `branding`: tên site, brand mark/submark, footer.
- `homepage`: nội dung hero, giới thiệu, contact links.
- `seo`: mô tả/keywords mặc định.
- `admin`: nhãn hiển thị trong khu quản trị.

Sau khi sửa `config.json`, khởi động lại server để áp dụng ổn định.

## Biến môi trường chính

### Core

- `PORT`: cổng chạy app (mặc định `3000`).
- `DATABASE_URL`: Postgres URL chính (bắt buộc).
- `APP_ENV`: `development` hoặc `production`.
- `SITE_URL`, `PUBLIC_SITE_URL`, `APP_DOMAIN`: hỗ trợ xác định public origin.
- `JS_MINIFY_ENABLED`: bật/tắt prebuild JS minified khi startup (`1`/`0`).

### Feature flags

- `NEWS_PAGE_ENABLED`: bật/tắt module tin tức (`on/off`).
- `FORUM_PAGE_ENABLED`: bật/tắt module diễn đàn (`true/false`).
- `NEWS_DATABASE_URL`: DB URL riêng cho news.
- `NEWS_DATABASE_NAME`: thay DB name trên `DATABASE_URL` cho module news.

### Auth + admin + session + security

- `ADMIN_USER`, `ADMIN_PASS`: đăng nhập admin mật khẩu.
- `ADMIN_PASSWORD_LOGIN_ENABLED`: `0` để tắt login mật khẩu admin.
- `SESSION_SECRET`: secret cho session cookie.
- `TRUST_PROXY`: `1` nếu chạy sau reverse proxy.
- `SESSION_COOKIE_SECURE`: ép secure cookie.
- `CSP_ENABLED`, `CSP_REPORT_ONLY`: cấu hình CSP header.

### OAuth

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.
- `OAUTH_CALLBACK_BASE_URL`: ép callback URL về domain cố định.

### Turnstile (anti-bot comment)

- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

### S3-compatible storage

- `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE`
- `CHAPTER_CDN_BASE_URL`
- `S3_CHAPTER_PREFIX`, `S3_FORUM_PREFIX`, `S3_FORUM_CDN_BASE_URL`

Storage domain cũng tương thích một số alias env cũ (`B2_*`, `AWS_*`, `BUCKET`, `ENDPOINT`, ...).

## Scripts

### Root scripts

- `npm run dev`: chạy server (`predev` tự build CSS).
- `npm run start`: chạy server (`prestart` tự build CSS).
- `npm run styles:build`: build CSS production từ `public/styles.source.css`.
- `npm run styles:watch`: watch CSS khi phát triển giao diện.
- `npm run test:forum:unit`: chạy unit test forum frontend.
- `npm run test:forum:smoke`: smoke check forum API.
- `npm run test:forum`: unit + smoke.
- `npm run forum:cleanup:image-posts`: dọn post ảnh forum lỗi.
- `npm run forum:scope:audit`: audit scope comment forum.
- `npm run forum:scope:fix`: apply fix scope comment forum.
- `npm run forum:notifications:fix`: sửa link notification forum legacy.
- `npm run purge:tmp`: dọn tmp local + DB draft + tmp remote storage.
- `npm run backup:db`: backup Postgres.
- `npm run restore:db`: restore Postgres.

### Forum frontend (`sampleforum`)

- `npm --prefix sampleforum run dev`
- `npm --prefix sampleforum run build`
- `npm --prefix sampleforum run preview`
- `npm --prefix sampleforum run test`
- `npm --prefix sampleforum run qa:forum-images`

## Runtime flow

Khi khởi động:
1. Load `.env` và `config.json`.
2. Khởi tạo pool Postgres chính (và pool news nếu có cấu hình).
3. Cấu hình security headers, CSP nonce, compression, static serving.
4. Cấu hình session store trong bảng `web_sessions`.
5. Mount route modules (site/admin/engagement/forum/news theo feature flags).
6. Chạy `initDb()` để tạo/migrate schema và normalize dữ liệu.
7. Prebuild JS minified (nếu bật).
8. Start các job cleanup/background cần thiết.

## Các route tiêu biểu

- Public: `/`, `/manga`, `/manga/:slug`, `/manga/:slug/chapters/:number`.
- Auth/account: `/auth/*`, `/account`, `/account/history`, `/account/me`.
- Comment/notification: `/comments/*`, `/notifications`, `/notifications/stream`.
- Admin: `/admin/*` (login/logout + CMS routes).
- News: `/tin-tuc`, `/tin-tuc/:id`, `/tin-tuc/api/news` (khi bật).
- Forum: `/forum` + `/forum/api/*` (khi bật).

## Bảo mật và vận hành

- Security headers mặc định: `X-Frame-Options`, `X-Content-Type-Options`, `Permissions-Policy`, `COOP`.
- Session trong Postgres, có cơ chế cleanup định kỳ.
- Rate limiter cho admin login/SSO và anti-abuse cho bình luận.
- Comment có idempotency key, cooldown, duplicate-window, và Turnstile (khi cấu hình).

Checklist production gợi ý:
1. `APP_ENV=production`
2. `SESSION_SECRET` mạnh (>=32 ký tự)
3. `SESSION_COOKIE_SECURE=true`
4. `TRUST_PROXY=1` (nếu sau reverse proxy)
5. Cấu hình OAuth callback đúng domain
6. Cấu hình S3-compatible storage
7. Build forum frontend nếu bật forum
8. Thiết lập lịch backup DB định kỳ

## Sự cố thường gặp

- `DATABASE_URL chưa được cấu hình`: thiếu biến bắt buộc.
- Không vào được `/forum`: chưa bật `FORUM_PAGE_ENABLED=true` hoặc chưa có `sampleforum/dist`.
- OAuth callback lỗi: sai `OAUTH_CALLBACK_BASE_URL` hoặc redirect URI provider.
- Upload ảnh lỗi: thiếu/sai `S3_*` hoặc quyền bucket.
- Backup/restore lỗi binary: thiếu `pg_dump`/`pg_restore`/`psql` hoặc chưa set biến binary tương ứng.

## Lưu ý repository

- Không commit `.env`, DB dump/file nhạy cảm, hoặc dữ liệu upload runtime.
- Không chỉnh sửa `node_modules/` và thư mục runtime upload trong quá trình phát triển tính năng.
