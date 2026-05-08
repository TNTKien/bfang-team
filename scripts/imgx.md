# Hướng dẫn dùng IMGX `.js` / `.bin` cho chapter ảnh

IMGX trong project lưu **payload binary đã mã hoá/obfuscate** từ WebP nén sẵn. Đuôi file chỉ là cách đặt tên object trong S3/CDN:

- **IMGX `.js`**: file giả đuôi JavaScript, DB `pages_ext = 'js'`, `page_delivery_mode = 'imgx'`.
- **IMGX `.bin`**: định dạng cũ, DB `pages_ext = 'bin'`, `page_delivery_mode = 'imgx'`.
- **Legacy `.webp`**: ảnh WebP trực tiếp, DB `pages_ext = 'webp'`, `page_delivery_mode = 'legacy'`.

> `.js` không phải DRM tuyệt đối. Reader vẫn phải `fetch(...).arrayBuffer()` và decode ở client, nên user kiểm soát trình duyệt vẫn có thể phân tích nếu đủ quyết tâm. Mục tiêu là tăng friction cho copy/download phổ thông.

## 1. Env quan trọng

Web server và `api_server` nên dùng cùng cấu hình:

```env
IMGX_ENABLED=true
IMGX_UPLOAD_MODE=imgx
IMGX_STORAGE_EXT=js
IMGX_SECRET=<secret-imgx>
IMGX_SESSION_HMAC_SECRET=<hmac-secret>
```

- `IMGX_STORAGE_EXT=js`: chapter IMGX mới upload sẽ lưu `001.js`, `002.js`, ... nhưng nội dung vẫn là binary IMGX.
- `IMGX_STORAGE_EXT=bin`: rollback để upload IMGX mới theo đuôi `.bin` cũ.
- Chapter `.bin` cũ vẫn đọc được dù `IMGX_STORAGE_EXT=js`.
- Nếu `IMGX_ENABLED=false`, upload mới sẽ về legacy `.webp`, nhưng chapter đã là `.js/.bin` vẫn hiển thị được nếu `IMGX_SECRET` và `IMGX_SESSION_HMAC_SECRET` còn đúng.

## 2. CDN/S3 rule bắt buộc khi dùng fake `.js`

Object IMGX `.js` phải được coi là binary, không phải JavaScript thật:

- Upload/serve với `Content-Type: application/octet-stream`.
- Không minify, bundle, rewrite, cache-transform hay nén hỏng byte với path chapter, ví dụ exclude `chapters/**`.
- Cache-bust vẫn dùng `?t=pages_updated_at`, giống WebP cũ.

## 3. Script chuyển đổi

Script: `scripts/convert-chapter-imgx.js`

Target hợp lệ:

| Lệnh | Kết quả |
|---|---|
| `--to imgx-js` hoặc `--to js` | chuyển sang IMGX `.js` |
| `--to imgx-bin` hoặc `--to bin` | chuyển sang IMGX `.bin` |
| `--to imgx` | dùng `IMGX_STORAGE_EXT`, mặc định `.js` |
| `--to legacy` hoặc `--to webp` | chuyển về `.webp` |

Script mặc định là **dry-run**. Muốn ghi S3 và update DB phải thêm `--apply`.

## 4. Chuyển 1 chapter

Dry-run `.webp/.bin -> .js` theo env/default:

```powershell
node scripts/convert-chapter-imgx.js --to imgx --chapter-id 123
```

Áp dụng sang fake `.js`:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --chapter-id 123 --apply
```

Áp dụng sang `.bin` cũ:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-bin --chapter-id 123 --apply
```

Chuyển ngược `.js/.bin -> .webp`:

```powershell
node scripts/convert-chapter-imgx.js --to legacy --chapter-id 123 --apply
```

## 5. Chuyển nhiều chapter hoặc manga

Nhiều chapter:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --chapter-id 123,124,125 --apply
```

Một truyện:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --manga-id 45 --skip-missing --skip-errors --resume --apply
```

Từ manga id 1 đến 100:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --manga-id-from 1 --manga-id-to 100 --skip-missing --skip-errors --resume --apply
```

100 truyện active đầu tiên, không phải 100 chapter:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --all --manga-limit 100 --skip-missing --skip-errors --resume --apply
```

100 truyện đầu tiên trong khoảng id 500..2000:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --manga-id-from 500 --manga-id-to 2000 --manga-limit 100 --skip-missing --skip-errors --resume --apply
```

Toàn bộ web sang `.js`:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --all --skip-missing --skip-errors --resume --apply
```

Toàn bộ web về `.webp`:

```powershell
node scripts/convert-chapter-imgx.js --to legacy --all --skip-missing --skip-errors --resume --apply
```

## 6. Checkpoint / resume

Mặc định khi `--apply` hoặc `--resume`, checkpoint nằm ở:

```text
.omx/state/convert-chapter-imgx-checkpoint.json
```

Chạy tiếp sau khi bị tắt giữa chừng:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --all --skip-missing --skip-errors --resume --apply
```

Dùng checkpoint riêng:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --manga-id-from 1 --manga-id-to 100 --checkpoint .omx/state/imgx-js-1-100.json --skip-missing --skip-errors --resume --apply
```

Reset checkpoint cũ:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --manga-id-from 1 --manga-id-to 100 --reset-checkpoint --skip-missing --skip-errors --apply
```

## 7. Cleanup an toàn

Mặc định có cleanup sau khi target đã convert/validate xong:

- Target `.js`: xoá `.webp` cũ và `.bin` cũ trong prefix đó; giữ `.js` đúng số trang; dọn preview dư.
- Target `.bin`: xoá `.webp` cũ và `.js` cũ; giữ `.bin` đúng số trang; dọn preview dư.
- Target `.webp`: xoá `.js`, `.bin`, `.preview.webp`.

Giữ file cũ để kiểm tra thủ công:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --chapter-id 123 --apply --keep-old
```

Nếu prefix bị share giữa nhiều chapter active, script sẽ từ chối cleanup. Chỉ dùng khi chắc chắn:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --chapter-id 123 --allow-shared-cleanup --apply
```

## 8. Chuyển đổi giữa `.bin` và `.js`

Không copy raw `.bin -> .js`. Script sẽ decode rồi encode lại vì key decode phụ thuộc storage key.

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --chapter-id 123 --force --apply
node scripts/convert-chapter-imgx.js --to imgx-bin --chapter-id 123 --force --apply
```

## 9. Khi có chapter lỗi/mất ảnh

Bỏ qua page/chapter lỗi và tiếp tục batch:

```powershell
node scripts/convert-chapter-imgx.js --to imgx-js --all --skip-missing --skip-errors --resume --apply
```

- `--skip-missing`: bỏ qua chapter/page thiếu object.
- `--skip-errors`: ghi lỗi vào checkpoint và chạy tiếp chapter/manga tiếp theo.

## 10. api_server xử lý ảnh

Nếu cấu hình:

```env
CHAPTER_IMAGE_PROCESSING_API_URL=http://127.0.0.1:3001
CHAPTER_UPLOAD_SHARED_SECRET=<same-secret>
```

Web server sẽ ưu tiên gọi `api_server` qua `/v1/internal/chapter-pages/transfer` cho tác vụ nặng như `.webp -> .js`, `.bin -> .js`, `.js -> .webp`. Nếu không cấu hình, web server tự xử lý local.

## 11. Kiểm tra sau migrate

1. DB chapter đúng:
   - `.js`: `pages_ext='js'`, `page_delivery_mode='imgx'`.
   - `.bin`: `pages_ext='bin'`, `page_delivery_mode='imgx'`.
   - `.webp`: `pages_ext='webp'`, `page_delivery_mode='legacy'`.
2. S3/CDN prefix chỉ còn file đúng target nếu không dùng `--keep-old`.
3. Reader load URL dạng `001.js?t=...` bằng `fetch` binary, không chạy script.
4. Chapter `.bin` cũ vẫn đọc được.
