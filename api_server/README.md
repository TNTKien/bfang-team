## Run

1. Copy env template and fill values:

   - `api_server/.env.example` -> `api_server/.env`
   - `API_KEY_SECRET` must match web server `SESSION_SECRET`
   - `DATABASE_URL` and S3 settings must point to the same DB/storage used by web server
     - `S3_BUCKET` is used for chapter page uploads
     - `S3_MEDIA_BUCKET` is used for avatar/cover uploads
   - `API_ALLOWED_ORIGINS` (optional) can restrict browser CORS origins; defaults to `WEB_BASE_URL`
   - For web-side chapter image conversion offload, set web `.env`:
     - `CHAPTER_UPLOAD_API_URL=http://127.0.0.1:3001`
     - `CHAPTER_IMAGE_PROCESSING_API_URL=http://127.0.0.1:3001` (optional; defaults to `CHAPTER_UPLOAD_API_URL`)
     - `CHAPTER_IMAGE_PROCESSING_API_REQUIRED=true` if you want the web server to fail instead of falling back to local image processing
     - `CHAPTER_UPLOAD_SHARED_SECRET` must match api_server
   - `IMGX_STORAGE_EXT=js` makes new protected chapter payloads use fake `.js` object names while still storing binary IMGX bytes. Use `bin` only for rollback/legacy behavior.
   - If you serve chapter objects through a CDN, exclude `chapters/**` IMGX `.js` files from JavaScript minify/transform and keep their content type as `application/octet-stream`.

2. Install deps:

   ```bash
   npm install
   ```

3. Start:

   ```bash
   npm run start
   ```

API default: `http://127.0.0.1:3001`

## Main endpoints

- `GET /health`
- `GET /v1/bootstrap`
- `GET /v1/manga/:mangaId/chapters`
- `POST /v1/uploads/start`
- `POST /v1/uploads/:sessionId/pages/presign`
- `POST /v1/uploads/:sessionId/pages/ack`
- `POST /v1/uploads/:sessionId/complete`
- `DELETE /v1/uploads/:sessionId`
- `POST /v1/internal/media/upload` (internal proof-based media upload for user/team/manga assets)
- `POST /v1/internal/chapter-pages/transfer` (internal proof-based chapter page copy/transcode: `.webp <-> .js/.bin`)
