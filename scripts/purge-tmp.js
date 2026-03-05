#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const { parseEnvBoolean } = require("../src/utils/env");
const {
  S3Client,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");

require("dotenv").config();

const DATABASE_URL = (process.env.DATABASE_URL || "").toString().trim();

const createDatabasePool = () => {
  if (!DATABASE_URL) return null;
  return new Pool({ connectionString: DATABASE_URL });
};

const getRowCount = (result) =>
  result && typeof result.rowCount === "number" && Number.isFinite(result.rowCount) ? result.rowCount : 0;

const doesTableExist = async (pool, regclassName) => {
  if (!pool || !regclassName) return false;
  const result = await pool.query("SELECT to_regclass($1) AS oid", [regclassName]);
  const row = Array.isArray(result && result.rows) ? result.rows[0] : null;
  return Boolean(row && row.oid);
};

const normalizePathPrefix = (value) =>
  (value || "").toString().trim().replace(/^\/+/, "").replace(/\/+$/, "");

const getB2Config = () => ({
  bucketId: (
    process.env.S3_BUCKET || process.env.BUCKET || process.env.B2_BUCKET || process.env.B2_BUCKET_ID || ""
  ).trim(),
  keyId: (
    process.env.S3_ACCESS_KEY_ID ||
    process.env.S3_ACCESS_KEY ||
    process.env.ACCESS_KEY ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.B2_KEY_ID ||
    ""
  ).trim(),
  applicationKey: (
    process.env.S3_SECRET_ACCESS_KEY ||
    process.env.S3_SECRET_KEY ||
    process.env.SECRET_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    process.env.B2_APPLICATION_KEY ||
    ""
  ).trim(),
  region: (
    process.env.S3_REGION || process.env.REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1"
  ).trim() || "us-east-1",
  endpoint: (process.env.S3_ENDPOINT || process.env.ENDPOINT || process.env.B2_ENDPOINT || "").trim(),
  forcePathStyle: parseEnvBoolean(process.env.S3_FORCE_PATH_STYLE, true),
  chapterPrefix:
    normalizePathPrefix(process.env.S3_CHAPTER_PREFIX || process.env.B2_CHAPTER_PREFIX || "chapters") ||
    "chapters",
  forumPrefix:
    normalizePathPrefix(process.env.S3_FORUM_PREFIX || process.env.B2_FORUM_PREFIX || "forum") || "forum"
});

const isB2Ready = (config) => Boolean(config && config.bucketId && config.keyId && config.applicationKey);

const normalizeB2FileKey = (value) => (value || "").toString().trim().replace(/^\/+/, "");

const buildB2DirPrefix = (value) => {
  const trimmed = normalizeB2FileKey(value).replace(/\/+$/, "");
  if (!trimmed) return "";
  return `${trimmed}/`;
};

let storageClientCache = null;

const getStorageClient = () => {
  const config = getB2Config();
  if (!isB2Ready(config)) {
    throw new Error("Missing storage credentials in .env");
  }

  const cacheKey = [
    config.endpoint || "",
    config.region || "",
    config.bucketId,
    config.keyId,
    config.forcePathStyle ? "1" : "0"
  ].join("|");
  if (storageClientCache && storageClientCache.cacheKey === cacheKey) {
    return storageClientCache.client;
  }

  const options = {
    region: config.region || "us-east-1",
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.applicationKey
    }
  };
  if (config.endpoint) {
    options.endpoint = config.endpoint;
  }

  const client = new S3Client(options);
  storageClientCache = {
    cacheKey,
    client
  };
  return client;
};

const isStorageVersionListingUnsupported = (err) => {
  const code = (err && (err.Code || err.code || err.name) ? String(err.Code || err.code || err.name) : "")
    .trim()
    .toLowerCase();
  const status = Number(err && err.$metadata ? err.$metadata.httpStatusCode : NaN);
  return (
    code === "notimplemented" ||
    code === "notsupported" ||
    code === "methodnotallowed" ||
    status === 405 ||
    status === 501
  );
};

const b2ListFileVersionsByPrefix = async (prefix) => {
  const config = getB2Config();
  if (!config.bucketId) {
    throw new Error("Missing S3_BUCKET in .env");
  }

  const prefixKey = normalizeB2FileKey(prefix);
  if (!prefixKey) return [];

  const s3 = getStorageClient();
  const versions = [];
  let keyMarker = "";
  let versionIdMarker = "";

  const readVersions = async () => {
    while (true) {
      const payload = {
        Bucket: config.bucketId,
        Prefix: prefixKey,
        MaxKeys: 1000
      };
      if (keyMarker) {
        payload.KeyMarker = keyMarker;
      }
      if (versionIdMarker) {
        payload.VersionIdMarker = versionIdMarker;
      }

      const data = await s3.send(new ListObjectVersionsCommand(payload));
      const versionRows = Array.isArray(data && data.Versions) ? data.Versions : [];
      const markerRows = Array.isArray(data && data.DeleteMarkers) ? data.DeleteMarkers : [];
      const rows = versionRows.concat(markerRows);
      rows.forEach((file) => {
        const fileName = file && typeof file.Key === "string" ? file.Key : "";
        const versionId = file && file.VersionId != null ? String(file.VersionId) : "";
        if (!fileName || !fileName.startsWith(prefixKey)) return;
        versions.push({ fileName, fileId: fileName, versionId });
      });

      const nextKey = data && typeof data.NextKeyMarker === "string" ? data.NextKeyMarker : "";
      const nextVersionId =
        data && data.NextVersionIdMarker != null ? String(data.NextVersionIdMarker) : "";
      const isTruncated = Boolean(data && data.IsTruncated);
      if (!isTruncated || !nextKey) break;
      if (nextKey === keyMarker && nextVersionId === versionIdMarker) break;
      keyMarker = nextKey;
      versionIdMarker = nextVersionId;
    }
  };

  try {
    await readVersions();
    return versions;
  } catch (err) {
    if (!isStorageVersionListingUnsupported(err)) {
      throw err;
    }
  }

  const files = await b2ListFileNamesByPrefix(prefixKey);
  return files.map((file) => ({
    fileName: file.fileName,
    fileId: file.fileId,
    versionId: ""
  }));
};

const b2DeleteFileVersions = async (versions) => {
  if (!Array.isArray(versions) || versions.length === 0) return 0;

  const config = getB2Config();
  if (!isB2Ready(config)) return 0;

  const s3 = getStorageClient();
  let deleted = 0;
  for (const version of versions) {
    const fileName = version && typeof version.fileName === "string" ? version.fileName : "";
    if (!fileName) continue;

    const versionId = version && version.versionId != null ? String(version.versionId).trim() : "";
    const payload = {
      Bucket: config.bucketId,
      Key: fileName
    };
    if (versionId) {
      payload.VersionId = versionId;
    }

    await s3.send(new DeleteObjectCommand(payload));
    deleted += 1;
  }
  return deleted;
};

const b2DeleteAllByPrefix = async (prefix) => {
  const config = getB2Config();
  if (!isB2Ready(config)) {
    return 0;
  }

  const prefixDir = buildB2DirPrefix(prefix);
  if (!prefixDir) return 0;
  const versions = await b2ListFileVersionsByPrefix(prefixDir);
  return b2DeleteFileVersions(versions);
};

const b2ListFileNamesByPrefix = async (prefix) => {
  const config = getB2Config();
  if (!config.bucketId) {
    throw new Error("Missing S3 bucket in .env");
  }

  const prefixKey = normalizeB2FileKey(prefix);
  if (!prefixKey) return [];

  const s3 = getStorageClient();
  const files = [];
  let continuationToken = "";

  while (true) {
    const payload = {
      Bucket: config.bucketId,
      Prefix: prefixKey,
      MaxKeys: 1000
    };
    if (continuationToken) {
      payload.ContinuationToken = continuationToken;
    }

    const data = await s3.send(new ListObjectsV2Command(payload));
    const batch = Array.isArray(data && data.Contents) ? data.Contents : [];
    batch.forEach((file) => {
      const fileName = file && typeof file.Key === "string" ? file.Key : "";
      if (!fileName || !fileName.startsWith(prefixKey)) return;
      files.push({ fileName, fileId: fileName });
    });

    const nextToken = data && typeof data.NextContinuationToken === "string" ? data.NextContinuationToken : "";
    const isTruncated = Boolean(data && data.IsTruncated);
    if (!isTruncated || !nextToken) break;
    if (nextToken === continuationToken) break;
    continuationToken = nextToken;
  }

  return files;
};

const purgeCoverTmpDir = async () => {
  const coversTmpDir = path.join(__dirname, "..", "uploads", "covers", "tmp");
  let entries = [];
  try {
    entries = await fs.promises.readdir(coversTmpDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return 0;
    throw err;
  }

  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(coversTmpDir, entry.name);
    try {
      await fs.promises.unlink(fullPath);
      deleted += 1;
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
  }
  return deleted;
};

const purgeChapterDraftRows = async (pool) => {
  if (!pool) return 0;
  if (!(await doesTableExist(pool, "public.chapter_drafts"))) return 0;
  const result = await pool.query("DELETE FROM chapter_drafts");
  return getRowCount(result);
};

const purgeForumDraftRows = async (pool) => {
  if (!pool) return 0;
  if (!(await doesTableExist(pool, "public.forum_post_image_drafts"))) return 0;
  const result = await pool.query("DELETE FROM forum_post_image_drafts");
  return getRowCount(result);
};

const clearChapterProcessingDraftTokens = async (pool) => {
  if (!pool) return 0;
  if (!(await doesTableExist(pool, "public.chapters"))) return 0;
  const result = await pool.query(
    `
      UPDATE chapters
      SET processing_draft_token = NULL
      WHERE processing_draft_token IS NOT NULL
        AND TRIM(processing_draft_token) <> ''
    `
  );
  return getRowCount(result);
};

const main = async () => {
  const started = Date.now();
  console.log("Purging tmp assets...");

  let coverTmpDeleted = 0;
  let chapterDraftRowsDeleted = 0;
  let forumDraftRowsDeleted = 0;
  let chapterProcessingTokensCleared = 0;
  let storageDeleted = 0;

  coverTmpDeleted = await purgeCoverTmpDir();

  const dbPool = createDatabasePool();
  if (dbPool) {
    try {
      try {
        forumDraftRowsDeleted = await purgeForumDraftRows(dbPool);
      } catch (err) {
        console.warn("WARN: Failed to delete forum_post_image_drafts rows:", err && err.message ? err.message : err);
      }

      try {
        chapterDraftRowsDeleted = await purgeChapterDraftRows(dbPool);
      } catch (err) {
        console.warn("WARN: Failed to delete chapter_drafts rows:", err && err.message ? err.message : err);
      }

      try {
        chapterProcessingTokensCleared = await clearChapterProcessingDraftTokens(dbPool);
      } catch (err) {
        console.warn(
          "WARN: Failed to clear chapters.processing_draft_token values:",
          err && err.message ? err.message : err
        );
      }
    } finally {
      await dbPool.end().catch(() => null);
    }
  } else {
    console.log("DATABASE_URL not configured; skipping database tmp purge.");
  }

  const b2Config = getB2Config();
  if (isB2Ready(b2Config)) {
    const tmpPrefixes = Array.from(
      new Set([
        `${b2Config.chapterPrefix}/tmp`,
        `${b2Config.forumPrefix}/tmp`
      ])
    );
    for (const tmpPrefix of tmpPrefixes) {
      try {
        storageDeleted += await b2DeleteAllByPrefix(tmpPrefix);
      } catch (err) {
        console.warn(
          `WARN: Failed to delete storage tmp prefix (${tmpPrefix}):`,
          err && err.message ? err.message : err
        );
      }
    }
  } else {
    console.log("Storage not configured; skipping remote tmp purge.");
  }

  const elapsedMs = Date.now() - started;
  console.log("Done.");
  console.log(`- Local cover tmp files deleted: ${coverTmpDeleted}`);
  console.log(`- forum_post_image_drafts rows deleted: ${forumDraftRowsDeleted}`);
  console.log(`- chapter_drafts rows deleted: ${chapterDraftRowsDeleted}`);
  console.log(`- chapters.processing_draft_token cleared: ${chapterProcessingTokensCleared}`);
  console.log(`- Remote files deleted under <chapterPrefix>/tmp and <forumPrefix>/tmp: ${storageDeleted}`);
  console.log(`- Elapsed: ${Math.round(elapsedMs / 10) / 100}s`);
};

main().catch((err) => {
  console.error("Purge failed:");
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
