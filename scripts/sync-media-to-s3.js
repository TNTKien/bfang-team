#!/usr/bin/env node

"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { Pool } = require("pg");
const {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} = require("@aws-sdk/client-s3");

const APPLY = process.argv.includes("--apply");
const DATABASE_URL = (process.env.DATABASE_URL || "").toString().trim();
const S3_ENDPOINT = (process.env.S3_ENDPOINT || "").toString().trim();
const S3_REGION = (process.env.S3_REGION || "us-east-1").toString().trim() || "us-east-1";
const S3_ACCESS_KEY_ID = (process.env.S3_ACCESS_KEY_ID || "").toString().trim();
const S3_SECRET_ACCESS_KEY = (process.env.S3_SECRET_ACCESS_KEY || "").toString().trim();
const S3_FORCE_PATH_STYLE = ["1", "true", "yes", "on"].includes(
  (process.env.S3_FORCE_PATH_STYLE || "true").toString().trim().toLowerCase()
);
const S3_MEDIA_BUCKET = (process.env.S3_MEDIA_BUCKET || process.env.S3_BUCKET || "").toString().trim();
const S3_MEDIA_PREFIX = normalizeS3Key((process.env.S3_MEDIA_PREFIX || "uploads").toString().trim() || "uploads");
const MEDIA_CDN_BASE_URL = normalizeBaseUrl(
  process.env.MEDIA_CDN_BASE_URL || process.env.CHAPTER_CDN_BASE_URL || process.env.S3_ENDPOINT || ""
);

const projectRoot = path.resolve(__dirname, "..");
const uploadsDir = path.join(projectRoot, "uploads");
const avatarsDir = path.join(uploadsDir, "avatars");
const coversDir = path.join(uploadsDir, "covers");

const COVER_VARIANTS = Object.freeze([
  { suffix: "-md", width: 262, height: 349, quality: 95 },
  { suffix: "-sm", width: 132, height: 176, quality: 92 }
]);
const PROGRESS_LOG_INTERVAL = 25;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required in .env");
  process.exit(1);
}

if (!S3_MEDIA_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  console.error("S3_MEDIA_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required in .env");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT || undefined,
  forcePathStyle: S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY
  }
});

function normalizeBaseUrl(value) {
  const raw = (value == null ? "" : String(value)).trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname || ""}`.replace(/\/+$/, "");
  } catch (_err) {
    return "";
  }
}

function normalizeS3Key(value) {
  return (value == null ? "" : String(value))
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/+/g, "/")
    .trim();
}

function inferContentType(fileName) {
  const lower = (fileName || "").toString().trim().toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".avif")) return "image/avif";
  return "application/octet-stream";
}

function buildMediaS3Key(relativePath) {
  const safePath = normalizeS3Key(relativePath);
  if (!safePath) return "";
  return normalizeS3Key(`${S3_MEDIA_PREFIX}/${safePath}`);
}

function logPhaseStart(label, total, unit) {
  const safeLabel = (label || "phase").toString().trim();
  const safeUnit = (unit || "item").toString().trim() || "item";
  const safeTotal = Number.isFinite(Number(total)) && Number(total) >= 0 ? Math.floor(Number(total)) : 0;
  const suffix = safeTotal === 1 ? "" : "s";
  console.log(`\n[${safeLabel}] ${safeTotal} ${safeUnit}${suffix} queued`);
}

function logPhaseProgress(label, current, total, extra = "") {
  const safeCurrent = Number(current);
  const safeTotal = Number(total);
  if (!Number.isFinite(safeCurrent) || !Number.isFinite(safeTotal) || safeCurrent <= 0 || safeTotal <= 0) {
    return;
  }

  const normalizedCurrent = Math.min(Math.floor(safeCurrent), Math.floor(safeTotal));
  const normalizedTotal = Math.floor(safeTotal);
  const shouldLog =
    normalizedCurrent === 1 ||
    normalizedCurrent === normalizedTotal ||
    normalizedCurrent % PROGRESS_LOG_INTERVAL === 0;
  if (!shouldLog) return;

  const percent = Math.floor((normalizedCurrent / normalizedTotal) * 100);
  const suffix = (extra || "").toString().trim();
  console.log(
    `[${label}] ${normalizedCurrent}/${normalizedTotal} (${percent}%)${suffix ? ` - ${suffix}` : ""}`
  );
}

function extractUploadPathFromUrl(value) {
  const raw = (value == null ? "" : String(value)).trim();
  if (!raw) return "";

  if (raw.startsWith("/uploads/")) {
    return raw.split("?")[0].split("#")[0].replace(/^\/+/, "");
  }

  try {
    const parsed = new URL(raw);
    const pathname = (parsed.pathname || "").split("?")[0].split("#")[0];
    if (!pathname.startsWith("/uploads/")) return "";
    return pathname.replace(/^\/+/, "");
  } catch (_err) {
    return "";
  }
}

function toRelativeMediaUrlFromUploadPath(uploadPath, _originalValue) {
  const safePath = normalizeS3Key(uploadPath);
  if (!safePath) return "";
  return `/${safePath}`;
}

async function listFilesInDirectory(directoryPath) {
  try {
    const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    return entries.filter((entry) => entry && entry.isFile && entry.isFile());
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function uploadFileToS3({ localPath, s3Key }) {
  const body = await fs.promises.readFile(localPath);
  const contentType = inferContentType(localPath);

  if (!APPLY) {
    return { uploaded: false, bytes: body.length };
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: S3_MEDIA_BUCKET,
      Key: s3Key,
      Body: body,
      ContentType: contentType
    })
  );

  return { uploaded: true, bytes: body.length };
}

async function uploadBufferToS3({ buffer, s3Key, contentType = "image/webp" }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { uploaded: false, bytes: 0 };
  }

  if (!APPLY) {
    return { uploaded: false, bytes: buffer.length };
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: S3_MEDIA_BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType
    })
  );

  return { uploaded: true, bytes: buffer.length };
}

async function pruneLegacyCoverVariantKeys() {
  const prefix = buildMediaS3Key("covers");
  if (!prefix) return 0;

  let continuationToken = "";
  let totalDeleted = 0;
  let scannedPages = 0;
  let foundCandidates = 0;

  do {
    scannedPages += 1;
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_MEDIA_BUCKET,
        Prefix: `${prefix}/`,
        ContinuationToken: continuationToken || undefined,
        MaxKeys: 1000
      })
    );

    const candidates = (Array.isArray(page && page.Contents) ? page.Contents : [])
      .map((item) => (item && item.Key ? String(item.Key) : ""))
      .filter(Boolean)
      .filter((key) => {
        const lower = key.toLowerCase();
        const fileName = lower.split("/").pop() || "";
        if (lower.includes("/.variants/")) return true;
        if (/\.[a-f0-9]{16}\.webp$/i.test(fileName)) return true;
        return false;
      });

    foundCandidates += candidates.length;
    console.log(
      `[legacy-cover-prune] page ${scannedPages} scanned - ${foundCandidates} legacy object(s) found so far`
    );

    if (candidates.length && APPLY) {
      for (let index = 0; index < candidates.length; index += 1000) {
        const chunk = candidates.slice(index, index + 1000);
        const chunkNumber = Math.floor(index / 1000) + 1;
        const totalChunks = Math.ceil(candidates.length / 1000);
        console.log(`[legacy-cover-prune] deleting chunk ${chunkNumber}/${totalChunks} from page ${scannedPages}`);
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: S3_MEDIA_BUCKET,
            Delete: {
              Objects: chunk.map((key) => ({ Key: key }))
            }
          })
        );
      }
    }

    totalDeleted += candidates.length;
    continuationToken = page && page.IsTruncated ? String(page.NextContinuationToken || "") : "";
  } while (continuationToken);

  return totalDeleted;
}

async function syncAvatarFiles() {
  const entries = await listFilesInDirectory(avatarsDir);
  let uploadedCount = 0;
  let uploadedBytes = 0;

   logPhaseStart("avatars", entries.length, "file");

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const localPath = path.join(avatarsDir, entry.name);
    const s3Key = buildMediaS3Key(`avatars/${entry.name}`);
    if (!s3Key) continue;
    const result = await uploadFileToS3({ localPath, s3Key });
    uploadedCount += 1;
    uploadedBytes += result.bytes;
    logPhaseProgress("avatars", index + 1, entries.length, `${uploadedBytes} bytes scanned`);
  }

  return { uploadedCount, uploadedBytes };
}

async function syncCoverFiles() {
  const entries = await listFilesInDirectory(coversDir);
  let uploadedCount = 0;
  let uploadedBytes = 0;

  logPhaseStart("covers", entries.length, "file");

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const lowerName = (entry.name || "").toLowerCase();
    if (!lowerName || lowerName.endsWith(".tmp") || lowerName.startsWith(".")) {
      logPhaseProgress("covers", index + 1, entries.length, `${uploadedCount} uploadable file(s)`);
      continue;
    }
    const localPath = path.join(coversDir, entry.name);
    const s3Key = buildMediaS3Key(`covers/${entry.name}`);
    if (!s3Key) {
      logPhaseProgress("covers", index + 1, entries.length, `${uploadedCount} uploadable file(s)`);
      continue;
    }
    const result = await uploadFileToS3({ localPath, s3Key });
    uploadedCount += 1;
    uploadedBytes += result.bytes;
    logPhaseProgress("covers", index + 1, entries.length, `${uploadedBytes} bytes scanned`);
  }

  return { uploadedCount, uploadedBytes };
}

async function syncMangaCoverVariants(client) {
  const rows = await client.query(
    `
      SELECT id, cover
      FROM manga
      WHERE cover IS NOT NULL
        AND BTRIM(cover) <> ''
      ORDER BY id ASC
    `
  );

  const items = Array.isArray(rows && rows.rows) ? rows.rows : [];
  let processed = 0;
  let generated = 0;

  logPhaseStart("cover-variants", items.length, "manga row");

  for (let index = 0; index < items.length; index += 1) {
    const row = items[index];
    const uploadPath = extractUploadPathFromUrl(row && row.cover ? row.cover : "");
    if (!uploadPath.startsWith("uploads/covers/")) {
      logPhaseProgress("cover-variants", index + 1, items.length, `${processed} eligible, ${generated} generated`);
      continue;
    }
    const fileName = uploadPath.slice("uploads/covers/".length);
    if (!/\.webp$/i.test(fileName) || /-md\.webp$/i.test(fileName) || /-sm\.webp$/i.test(fileName)) {
      logPhaseProgress("cover-variants", index + 1, items.length, `${processed} eligible, ${generated} generated`);
      continue;
    }

    const localPath = path.join(coversDir, fileName);
    let sourceBuffer = null;
    try {
      sourceBuffer = await fs.promises.readFile(localPath);
    } catch (_err) {
      logPhaseProgress("cover-variants", index + 1, items.length, `${processed} eligible, ${generated} generated`);
      continue;
    }

    processed += 1;
    const baseName = fileName.replace(/\.webp$/i, "");

    for (const variant of COVER_VARIANTS) {
      const variantFileName = `${baseName}${variant.suffix}.webp`;
      const variantKey = buildMediaS3Key(`covers/${path.basename(variantFileName)}`);
      if (!variantKey) continue;

      const variantBuffer = await sharp(sourceBuffer)
        .rotate()
        .resize({
          width: variant.width,
          height: variant.height,
          fit: "cover",
          position: "centre",
          kernel: sharp.kernel.lanczos3,
          fastShrinkOnLoad: false,
          withoutEnlargement: true
        })
        .webp({ quality: variant.quality, effort: 5, smartSubsample: true, preset: "picture" })
        .toBuffer();

      await uploadBufferToS3({ buffer: variantBuffer, s3Key: variantKey, contentType: "image/webp" });
      generated += 1;
    }

    logPhaseProgress("cover-variants", index + 1, items.length, `${processed} eligible, ${generated} generated`);
  }

  return { processed, generated };
}

async function rewriteTableUploadUrls(client, { tableName, idColumn, columns }) {
  const selectColumns = [idColumn, ...columns].join(", ");
  const rows = await client.query(`SELECT ${selectColumns} FROM ${tableName}`);
  const items = Array.isArray(rows && rows.rows) ? rows.rows : [];
  let updated = 0;

  logPhaseStart(`rewrite:${tableName}`, items.length, "row");

  for (let index = 0; index < items.length; index += 1) {
    const row = items[index];
    const assignments = [];
    const values = [];

    columns.forEach((columnName) => {
      const currentValue = row && row[columnName] != null ? String(row[columnName]).trim() : "";
      if (!currentValue) return;

      const uploadPath = extractUploadPathFromUrl(currentValue);
      if (!uploadPath.startsWith("uploads/")) return;
      const nextValue = toRelativeMediaUrlFromUploadPath(uploadPath, currentValue);
      if (!nextValue || nextValue === currentValue) return;

      assignments.push(`${columnName} = $${assignments.length + 1}`);
      values.push(nextValue);
    });

    if (!assignments.length) {
      logPhaseProgress(`rewrite:${tableName}`, index + 1, items.length, `${updated} row(s) changed`);
      continue;
    }

    const idValue = row && row[idColumn] != null ? row[idColumn] : null;
    if (idValue == null) continue;
    values.push(idValue);

    if (APPLY) {
      await client.query(
        `UPDATE ${tableName} SET ${assignments.join(", ")} WHERE ${idColumn} = $${values.length}`,
        values
      );
    }

    updated += 1;
    logPhaseProgress(`rewrite:${tableName}`, index + 1, items.length, `${updated} row(s) changed`);
  }

  return updated;
}

async function main() {
  const client = await pool.connect();
  try {
    console.log("Sync media to S3");
    console.log(`- dry run: ${APPLY ? "no" : "yes"}`);
    console.log(`- media bucket: ${S3_MEDIA_BUCKET}`);
    console.log(`- media prefix: ${S3_MEDIA_PREFIX}`);
    console.log(`- media CDN: ${MEDIA_CDN_BASE_URL || "(not configured)"}`);

    const avatarStats = await syncAvatarFiles();
    const coverStats = await syncCoverFiles();
    const variantStats = await syncMangaCoverVariants(client);
    const deletedLegacyVariants = await pruneLegacyCoverVariantKeys();

    if (APPLY) {
      await client.query("BEGIN");
    }

    const usersUpdated = await rewriteTableUploadUrls(client, {
      tableName: "users",
      idColumn: "id",
      columns: ["avatar_url"]
    });
    const teamsUpdated = await rewriteTableUploadUrls(client, {
      tableName: "translation_teams",
      idColumn: "id",
      columns: ["avatar_url", "cover_url"]
    });
    const mangaUpdated = await rewriteTableUploadUrls(client, {
      tableName: "manga",
      idColumn: "id",
      columns: ["cover"]
    });

    if (APPLY) {
      await client.query("COMMIT");
    }

    console.log("\nSummary");
    console.log(`- avatar files scanned/uploaded: ${avatarStats.uploadedCount} (${avatarStats.uploadedBytes} bytes)`);
    console.log(`- cover files scanned/uploaded: ${coverStats.uploadedCount} (${coverStats.uploadedBytes} bytes)`);
    console.log(`- manga covers processed for 3-size variants: ${variantStats.processed}`);
    console.log(`- generated cover variant objects (-md/-sm): ${variantStats.generated}`);
    console.log(`- pruned legacy cover variant keys: ${deletedLegacyVariants}`);
    console.log(`- users rows rewritten: ${usersUpdated}`);
    console.log(`- translation_teams rows rewritten: ${teamsUpdated}`);
    console.log(`- manga rows rewritten: ${mangaUpdated}`);

    if (!APPLY) {
      console.log("\nDry run only. Re-run with --apply to execute uploads and DB updates.");
    }
  } catch (error) {
    if (APPLY) {
      try {
        await client.query("ROLLBACK");
      } catch (_rollbackError) {
        // ignore rollback failure
      }
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Media sync to S3 failed.");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
