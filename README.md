# BFANG Manga Platform

Nền tảng đọc manga của BFANG Team, viết bằng **Node.js + Express + PostgreSQL** với:
- Trang công khai đọc truyện.
- Hệ thống tài khoản OAuth (Google/Discord).
- Bình luận, mention, thông báo realtime.
- Khu quản trị nội dung đầy đủ.
- Module **News** (`/tin-tuc`) bật/tắt bằng env.
- Module **Forum** (`/forum`) gồm API backend + frontend React/Vite.

## Tính năng chính

- Đọc manga: trang chủ, thư viện, trang chi tiết truyện, trang đọc chapter.
- Hồ sơ người dùng: avatar, bio, liên kết mạng xã hội, lịch sử đọc.
- Bình luận theo nhánh, chống spam, idempotency request, lọc từ cấm.
- Mention người dùng + notification stream (SSE) + polling fallback.
- Team dịch: tạo team, duyệt thành viên, phân quyền leader/member, chat nội bộ.
- Admin CMS: manga/chapter/genre/comment/member/badge/homepage/team.
- Upload ảnh chapter và ảnh forum lên storage S3-compatible.

## Tech stack

- **Backend**: Node.js, Express, EJS
- **Database**: PostgreSQL (`pg`)
- **Session**: `express-session` + bảng `web_sessions` trong Postgres
- **Auth**: Passport OAuth2 (Google, Discord)
- **Image/Upload**: `multer`, `sharp`
- **Object storage**: AWS SDK S3 client (dùng được với S3/B2/MinIO)
- **Styling server-rendered**: Tailwind CSS + Flowbite
- **Forum frontend**: React 18 + Vite + TypeScript + shadcn/ui + TanStack Query

## Yêu cầu hệ thống

- Node.js 20+ (khuyến nghị LTS mới)
- PostgreSQL 14+ (hoặc tương đương)
- (Tùy chọn) PostgreSQL client tools: `pg_dump`, `pg_restore`, `psql` cho backup/restore
- (Tùy chọn) S3-compatible object storage cho ảnh chapter/forum

## Cài đặt local

### 1) Cài dependencies

```bash
npm install
```

Nếu dùng forum UI React trong `sampleforum`:

```bash
npm --prefix sampleforum install
```

### 2) Tạo file môi trường

```bash
cp .env.example .env
```

Trên Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### 2.1) Tuỳ biến thương hiệu bằng `config.json`

Toàn bộ thông tin nhận diện site được gom vào `config.json` ở thư mục gốc:

- Tên web và brand text (`siteName`, `brandMark`, `brandSubmark`)
- Nội dung trang chủ (câu chào mừng, giới thiệu, năm thành lập, tiêu chuẩn nội dung)
- Link liên hệ Facebook/Discord
- Một số SEO text mặc định
- Nhãn hiển thị khu admin

Bạn chỉ cần sửa `config.json`, khởi động lại server là giao diện sẽ đọc dữ liệu mới.

### 3) Cấu hình tối thiểu trong `.env`

```env
PORT=3000
DATABASE_URL=postgresql://postgres:password@localhost:5432/your_db
SESSION_SECRET=mot_chuoi_ngau_nhien_it_nhat_32_ky_tu
APP_ENV=development
```

### 4) (Tùy chọn) Build forum frontend

Nếu bật `FORUM_PAGE_ENABLED=true`, backend sẽ phục vụ file build tại `sampleforum/dist`.
Hãy build trước:

```bash
npm --prefix sampleforum run build
```

### 5) Chạy app

```bash
npm run dev
```

Mở:
- Site chính: `http://localhost:3000`
- Admin login: `http://localhost:3000/admin/login`
- Forum: `http://localhost:3000/forum` (khi bật forum + có build dist)
- News: `http://localhost:3000/tin-tuc` (khi bật news)

## Biến môi trường

### Nhóm core

- `PORT` (default `3000`): cổng server.
- `DATABASE_URL` (bắt buộc): Postgres connection string chính.
- `APP_ENV`: `development` hoặc `production`.
- `APP_DOMAIN`: domain public (fallback để build URL).
- `SITE_URL`, `PUBLIC_SITE_URL`: override public origin.
- `OAUTH_CALLBACK_BASE_URL`: ép callback OAuth về domain cố định.
- `JS_MINIFY_ENABLED` (default `1`): bật prebuild/minify JS public.

### Feature flags

- `NEWS_PAGE_ENABLED` (default code: `on`): bật/tắt module news.
- `FORUM_PAGE_ENABLED` (default code: `false`): bật/tắt module forum.
- `NEWS_DATABASE_URL`: DB URL riêng cho news.
- `NEWS_DATABASE_NAME`: nếu không có `NEWS_DATABASE_URL`, thay db name trên `DATABASE_URL`.

### Auth, admin, session, security

- `ADMIN_USER`, `ADMIN_PASS`: tài khoản admin password.
- `ADMIN_PASSWORD_LOGIN_ENABLED` (default `1`): tắt để chỉ cho admin badge qua OAuth.
- `SESSION_SECRET`: bắt buộc ở production, nên >= 32 ký tự.
- `TRUST_PROXY`: đặt `1` nếu chạy sau reverse proxy.
- `SESSION_COOKIE_SECURE`: ép secure cookie (default theo `APP_ENV`).
- `CSP_ENABLED` (default `true`): bật CSP header.
- `CSP_REPORT_ONLY` (default `false`): CSP report-only mode.

### OAuth providers

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`

### Anti-bot comment (Turnstile)

- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

### Object storage (S3-compatible)

- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_REGION` (default `us-east-1`)
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE` (default `true`)
- `CHAPTER_CDN_BASE_URL`
- `S3_CHAPTER_PREFIX` (default `chapters`)
- `S3_FORUM_PREFIX` (default `forum`)
- `S3_FORUM_CDN_BASE_URL` (optional)
- `IMAGE_CACHE_CONTROL`, `CHAPTER_IMAGE_CACHE_CONTROL` (optional)

Storage layer cũng hỗ trợ alias env cũ (`B2_*`, `AWS_*`, `BUCKET`, `ENDPOINT`, ...).

### Seed/audit chuyên biệt

- `FORUM_SAMPLE_SEED_ENABLED` (default `false`)
- `FORUM_SAMPLE_TARGET_TOPICS` (default `36`)
- `FORUM_SCOPE_AUDIT_SAMPLE_LIMIT` (default script: `20`)

### Env cho scripts backup/restore

- Backup: `BACKUP_DIR`, `BACKUP_PREFIX`, `BACKUP_FORMAT`, `BACKUP_SCHEMA`, `BACKUP_COMPRESS_LEVEL`, `BACKUP_KEEP_LAST`, `BACKUP_VERBOSE`, `PG_DUMP_BIN`
- Restore: `RESTORE_FILE`, `RESTORE_FORMAT`, `RESTORE_MODE`, `RESTORE_SCHEMA`, `RESTORE_JOBS`, `RESTORE_VERBOSE`, `RESTORE_YES`, `PG_RESTORE_BIN`, `PSQL_BIN`

## Scripts

### Root (`package.json`)

- `npm run dev`: build CSS rồi chạy server.
- `npm run start`: build CSS rồi chạy server.
- `npm run styles:build`: build `public/styles.css` từ `public/styles.source.css`.
- `npm run styles:watch`: watch Tailwind CSS.
- `npm run test:forum:unit`: chạy unit tests trong `sampleforum`.
- `npm run test:forum:smoke`: smoke check API forum.
- `npm run test:forum`: unit + smoke.
- `npm run forum:cleanup:image-posts`: dọn forum post ảnh lỗi trong DB.
- `npm run forum:scope:audit`: audit phạm vi dữ liệu forum comment.
- `npm run forum:scope:fix`: apply fix scope forum comment.
- `npm run forum:notifications:fix`: tách link notification forum khỏi ngữ cảnh manga.
- `npm run purge:tmp`: dọn tmp local + DB draft + tmp remote storage.
- `npm run backup:db`: backup Postgres.
- `npm run restore:db`: restore Postgres (bắt buộc xác nhận `--yes`).

### Forum frontend (`sampleforum/package.json`)

- `npm --prefix sampleforum run dev`
- `npm --prefix sampleforum run build`
- `npm --prefix sampleforum run preview`
- `npm --prefix sampleforum run test`
- `npm --prefix sampleforum run qa:forum-images`

### Scripts nâng cao (gọi trực tiếp)

- `node scripts/split-styles.js`: tách `public/styles.source.css` thành module CSS.
- `node scripts/purge-css.js`: purge selector thừa trong module CSS + tạo report.
- `node scripts/remove-forum-tags-meta.js`: chuẩn hóa/xóa forum meta tags legacy trong `comments`.

## Kiến trúc runtime

### Luồng startup

1. Load `.env`.
2. Khởi tạo Postgres pool chính (+ pool news nếu có).
3. Cấu hình security headers, CSP nonce, compression, static assets.
4. Cấu hình session store Postgres (`web_sessions`).
5. Wire domains + routes qua dependency injection style.
6. `initDb()` chạy DDL/migrate/normalize dữ liệu.
7. Prebuild JS minified (nếu bật).
8. Start background cleanup/resume jobs.

### Domain layer

- `init-db-domain`: tạo/migrate bảng, index, chuẩn hóa dữ liệu legacy, seed mặc định.
- `auth-user-domain`: user profile, OAuth identity, badge permission, session user.
- `manga-domain`: genre/oneshot/forbidden words và helper liên quan manga.
- `storage-domain`: upload/copy/delete object, draft chapter, queue xử lý ảnh chapter.
- `security-session-domain`: rate limiter login/sso admin + session version.
- `mention-notification-domain`: mention parsing, notification mapping, SSE push.

### Route modules

- `site-routes`: web public + auth/account/team/chat + manga đọc + comment tạo mới.
- `admin-and-engagement-routes`: toàn bộ admin CMS + moderation + team admin.
- `engagement-routes`: reaction/edit/delete comment + notifications stream/read.
- `forum-api-routes`: API forum + forum admin API + image draft/finalize flow.
- `news-routes`: module tin tức `/tin-tuc` + sitemap/news API/news assets.

## Mô hình dữ liệu chính

Các bảng quan trọng được tạo/migrate khi startup:

- `manga`, `chapters`, `genres`, `manga_genres`
- `comments`, `forum_posts`
- `notifications`, `comment_likes`, `comment_reports`, `forbidden_words`
- `users`, `auth_identities`, `badges`, `user_badges`, `reading_history`
- `translation_teams`, `translation_team_members`
- `chat_threads`, `chat_thread_members`, `chat_messages`
- `chapter_drafts`, `web_sessions`, `homepage`
- `forum_post_bookmarks`

Ghi chú:
- `forum_post_image_drafts` được đảm bảo bởi forum API khi cần upload ảnh local->remote.
- DB news dùng bảng `news` trên kết nối `NEWS_DATABASE_URL` (hoặc `NEWS_DATABASE_NAME`).

## Các endpoint tiêu biểu

### Public/site

- `GET /`, `GET /amp`
- `GET /manga`, `GET /manga/:slug`, `GET /manga/:slug/chapters/:number`
- `GET /privacy-policy`, `GET /terms-of-service`, `GET /sitemap.xml`

### Auth/account/team/chat

- `GET /auth/session`, `POST /auth/logout`, `POST /auth/profile`
- `GET /auth/google`, `GET /auth/google/callback`
- `GET /auth/discord`, `GET /auth/discord/callback`
- `GET /account`, `GET /account/history`, `GET /account/me`
- `GET/POST /account/reading-history`
- `POST /account/avatar/upload`, `POST /account/profile/sync`
- `GET /publish`, `GET /messages`, `GET /messages/stream`

### Comment/notification

- `POST /manga/:slug/comments`
- `POST /manga/:slug/chapters/:number/comments`
- `POST /comments/:id/edit|delete|like|report`
- `GET /notifications/stream`, `GET /notifications`, `POST /notifications/read-all`

### Admin

- `GET/POST /admin/login`, `POST /admin/sso`, `POST /admin/logout`
- Manga/chapter moderation routes dưới `/admin/manga`, `/admin/chapters`
- Member/badge/genre/team routes dưới `/admin/members`, `/admin/badges`, `/admin/genres`, `/admin/teams`

### Forum API

- `GET /forum/api/home`, `GET /forum/api/posts/:id`, `POST /forum/api/posts`
- `POST /forum/api/posts/:id/replies`
- `POST /forum/api/post-drafts`, `POST /forum/api/post-drafts/:token/images`, `POST /forum/api/post-drafts/:token/finalize`
- `GET /forum/api/admin/*`, `PATCH/DELETE /forum/api/admin/*`

### News (`NEWS_PAGE_ENABLED=on`)

- `GET /tin-tuc`
- `GET /tin-tuc/:id`
- `GET /tin-tuc/api/news`
- `GET /tin-tuc/sitemap.xml`

## Testing

Hiện tại test tự động tập trung ở forum frontend/API contract:

```bash
npm run test:forum:unit
npm run test:forum:smoke
```

Lưu ý:
- `test:forum:smoke` cần endpoint `/forum/api/home` hoạt động.
- Nếu smoke bằng server local spawn, hãy đảm bảo env phù hợp (đặc biệt `FORUM_PAGE_ENABLED=true` khi cần full flow).

## Bảo mật và hiệu năng đã có trong code

- Security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Permissions-Policy`, `COOP`.
- CSP nonce-based (bật/tắt qua env).
- Same-origin guard cho các route ghi dữ liệu nhạy cảm.
- Session store trong Postgres, có cleanup định kỳ.
- Rate limiter cho admin login/sso.
- Comment anti-abuse: cooldown, duplicate window, idempotency key, Turnstile challenge.
- Minify JS runtime + minify CSS production + ETag/Last-Modified + cache headers.
- Cover image variant resize on-demand, cache tại `uploads/covers/.variants`.

## Vận hành production (checklist)

1. `APP_ENV=production`
2. `SESSION_SECRET` mạnh (>=32 ký tự)
3. `SESSION_COOKIE_SECURE=true`
4. `TRUST_PROXY=1` nếu đi qua reverse proxy/load balancer
5. Tắt admin password nếu muốn chỉ badge-admin OAuth:
   `ADMIN_PASSWORD_LOGIN_ENABLED=0`
6. Cấu hình OAuth callback đúng domain thật.
7. Cấu hình storage S3-compatible cho chapter/forum image.
8. Build forum frontend nếu bật forum:
   `npm --prefix sampleforum run build`
9. Thiết lập backup định kỳ:
   `npm run backup:db`

## Sự cố thường gặp

- `DATABASE_URL chưa được cấu hình`: thiếu biến bắt buộc.
- Không vào được `/forum`: chưa bật `FORUM_PAGE_ENABLED=true` hoặc chưa có `sampleforum/dist`.
- OAuth callback lỗi: sai `OAUTH_CALLBACK_BASE_URL` hoặc cấu hình redirect URI phía provider.
- Upload chapter/forum ảnh lỗi: thiếu/sai `S3_*` hoặc quyền bucket.
- Backup/restore lỗi binary: thiếu `pg_dump` / `pg_restore` / `psql` hoặc chưa set `PG_*_BIN`.

## Ghi chú

- App backend hiện không dùng migration framework riêng; schema/migration được xử lý trong `initDb()` lúc startup.
- Có thể dùng module News/Forum độc lập theo feature flag để triển khai theo pha.
