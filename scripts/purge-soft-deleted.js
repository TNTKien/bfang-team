#!/usr/bin/env node

"use strict";

require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const sharp = require("sharp");
const { google } = require("googleapis");
const {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");

const createStorageDomain = require("../src/domains/storage-domain");
const { parseEnvBoolean } = require("../src/utils/env");

const DATABASE_URL = (process.env.DATABASE_URL || "").toString().trim();
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required in .env");
  process.exit(1);
}

const GOOGLE_DRIVE_CLIENT_ID = (process.env.GOOGLE_DRIVE_CLIENT_ID || "").toString().trim();
const GOOGLE_DRIVE_CLIENT_SECRET = (process.env.GOOGLE_DRIVE_CLIENT_SECRET || "").toString().trim();
const GOOGLE_DRIVE_REFRESH_TOKEN = (process.env.GOOGLE_DRIVE_REFRESH_TOKEN || "").toString().trim();
const GOOGLE_DRIVE_IMAGE_SIZE_RAW = Number((process.env.GOOGLE_DRIVE_IMAGE_SIZE || "").toString().trim());
const GOOGLE_DRIVE_IMAGE_SIZE =
  Number.isFinite(GOOGLE_DRIVE_IMAGE_SIZE_RAW) && GOOGLE_DRIVE_IMAGE_SIZE_RAW >= 0
    ? Math.min(Math.floor(GOOGLE_DRIVE_IMAGE_SIZE_RAW), 4096)
    : 1600;
const coversDir = path.join(__dirname, "..", "uploads", "covers");
const coversUrlPrefix = "/uploads/covers/";

const normalizeBaseUrl = (value) => (value || "").toString().trim().replace(/\/+$/, "");
const normalizePathPrefix = (value) =>
  (value || "").toString().trim().replace(/^\/+/, "").replace(/\/+$/, "");

const toPgQuery = (sql, params) => {
  const text = (sql || "").toString();
  if (!Array.isArray(params) || params.length === 0) {
    return { text, values: [] };
  }

  let index = 0;
  return {
    text: text.replace(/\?/g, () => {
      index += 1;
      return `$${index}`;
    }),
    values: params,
  };
};

const maybeAddReturningId = (sql) => {
  const text = (sql || "").toString();
  const trimmed = text.trim();
  const compact = trimmed.replace(/\s+/g, " ");
  if (!/^insert\s+into\s+/i.test(compact) || /\breturning\b/i.test(compact)) {
    return { sql: text, wantsId: false };
  }
  const withoutSemi = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
  return { sql: `${withoutSemi} RETURNING id`, wantsId: true };
};

const pgPool = new Pool({ connectionString: DATABASE_URL });

const dbQuery = async (sql, params = [], client = null) => {
  const payload = toPgQuery(sql, params);
  const executor = client || pgPool;
  return executor.query(payload.text, payload.values);
};

const dbAll = async (sql, params = [], client = null) => {
  const result = await dbQuery(sql, params, client);
  return result.rows || [];
};

const dbGet = async (sql, params = [], client = null) => {
  const rows = await dbAll(sql, params, client);
  return rows.length ? rows[0] : null;
};

const dbRun = async (sql, params = [], client = null) => {
  const payload = maybeAddReturningId(sql);
  const result = await dbQuery(payload.sql, params, client);
  return {
    changes: typeof result.rowCount === "number" ? result.rowCount : 0,
    lastID: payload.wantsId && result.rows && result.rows[0] ? result.rows[0].id : undefined,
    rows: result.rows || [],
  };
};

const withTransaction = async (fn) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn({
      dbAll: (sql, params = []) => dbAll(sql, params, client),
      dbGet: (sql, params = []) => dbGet(sql, params, client),
      dbRun: (sql, params = []) => dbRun(sql, params, client),
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const storageDomain = createStorageDomain({
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  crypto,
  dbAll,
  dbGet,
  dbRun,
  normalizeBaseUrl,
  normalizePathPrefix,
  parseEnvBoolean,
  withTransaction,
  sharp,
});

const {
  b2DeleteAllByPrefix,
  buildChapterDraftPrefix,
  getB2Config,
  getChapterDraft,
  isB2Ready,
  isChapterDraftTokenValid,
} = storageDomain;

let googleDriveApiClient = null;

const buildGoogleDriveImageUrl = (fileId, sizeValue = GOOGLE_DRIVE_IMAGE_SIZE) => {
  const safeFileId = (fileId || "").toString().trim();
  if (!/^[A-Za-z0-9_-]+$/.test(safeFileId)) return "";

  const parsedSize = Number(sizeValue);
  const safeSize =
    Number.isFinite(parsedSize) && parsedSize >= 0
      ? Math.min(Math.floor(parsedSize), 4096)
      : GOOGLE_DRIVE_IMAGE_SIZE;
  return `https://lh3.googleusercontent.com/d/${safeFileId}=s${safeSize}`;
};

const normalizeUploadedImageUrl = (value) => {
  const raw = (value || "").toString().trim();
  if (!raw || raw.length > 512) return "";

  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "https:" && protocol !== "http:") return "";

    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "drive.google.com") {
      const pathname = parsed.pathname || "";
      const viewMatch = pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)\/view$/i);
      if (viewMatch) return buildGoogleDriveImageUrl(viewMatch[1]);

      if (/^\/uc$/i.test(pathname)) {
        const id = (parsed.searchParams.get("id") || "").toString().trim();
        const exportMode = (parsed.searchParams.get("export") || "").toString().trim().toLowerCase();
        if (/^[A-Za-z0-9_-]+$/.test(id) && (exportMode === "view" || exportMode === "download")) {
          return buildGoogleDriveImageUrl(id);
        }
      }
    }

    if (hostname === "lh3.googleusercontent.com") {
      const pathname = parsed.pathname || "";
      const lh3Match = pathname.match(/^\/d\/([A-Za-z0-9_-]+)=s([0-9]+)$/i);
      if (lh3Match) return buildGoogleDriveImageUrl(lh3Match[1], lh3Match[2]);
    }
  } catch (_error) {
    return "";
  }

  return "";
};

const extractGoogleDriveFileIdFromImageUrl = (value) => {
  const normalized = normalizeUploadedImageUrl(value);
  if (!normalized) return "";
  const match = normalized.match(/^https?:\/\/lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]+)=s[0-9]+$/i);
  return match && match[1] ? String(match[1]).trim() : "";
};

const isGoogleDriveConfigured = () =>
  Boolean(GOOGLE_DRIVE_CLIENT_ID && GOOGLE_DRIVE_CLIENT_SECRET && GOOGLE_DRIVE_REFRESH_TOKEN);

const getGoogleDriveApiClient = () => {
  if (googleDriveApiClient) return googleDriveApiClient;
  if (!isGoogleDriveConfigured()) {
    throw new Error("Google Drive chưa được cấu hình đầy đủ.");
  }

  const oauth2Client = new google.auth.OAuth2(GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_DRIVE_REFRESH_TOKEN });
  googleDriveApiClient = google.drive({ version: "v3", auth: oauth2Client });
  return googleDriveApiClient;
};

const deleteGoogleDriveImageByFileId = async (fileId) => {
  const safeFileId = (fileId || "").toString().trim();
  if (!/^[A-Za-z0-9_-]+$/.test(safeFileId)) return false;

  const drive = getGoogleDriveApiClient();
  try {
    await drive.files.delete({ fileId: safeFileId, supportsAllDrives: true });
    return true;
  } catch (error) {
    const statusCode = Number(
      error && (error.statusCode || error.code || (error.response && error.response.status ? error.response.status : 0))
    );
    if (statusCode === 404) return false;
    throw error;
  }
};

const extractLocalCoverFilename = (coverUrl) => {
  if (!coverUrl || typeof coverUrl !== "string") return "";
  if (coverUrl.startsWith(coversUrlPrefix)) {
    return coverUrl.slice(coversUrlPrefix.length).split("?")[0].split("#")[0].trim();
  }
  try {
    const parsed = new URL(coverUrl);
    const pathname = (parsed.pathname || "").toString();
    if (!pathname.startsWith(coversUrlPrefix)) return "";
    return pathname.slice(coversUrlPrefix.length).split("?")[0].split("#")[0].trim();
  } catch (_error) {
    return "";
  }
};

const deleteFileIfExists = async (filePath) => {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
};

const printUsage = () => {
  console.log(`Usage:
  node scripts/purge-soft-deleted.js --manga-id 12
  node scripts/purge-soft-deleted.js --chapter-id 34
  node scripts/purge-soft-deleted.js --all-manga
  node scripts/purge-soft-deleted.js --all-chapters

Options:
  --manga-id <ids>       Manga id, comma-separated or repeated
  --chapter-id <ids>     Chapter id, comma-separated or repeated
  --all-manga            Purge every soft-deleted manga
  --all-chapters         Purge every soft-deleted chapter not already covered by manga purge
  --include-active       Allow purging rows that are not soft-deleted yet
  --dry-run              Show what would be deleted without mutating data
  --help                 Show this help
`);
};

const parseIdFlags = (args, flagName) => {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = String(args[index] || "");
    if (current === flagName) {
      values.push(String(args[index + 1] || ""));
      index += 1;
      continue;
    }
    if (current.startsWith(`${flagName}=`)) {
      values.push(current.slice(flagName.length + 1));
    }
  }

  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value || "").split(","))
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value))
    )
  );
};

const doesTableExist = async (tableName, dbGetFn = dbGet) => {
  const row = await dbGetFn("SELECT to_regclass(?) AS oid", [tableName]);
  return Boolean(row && row.oid);
};

const chunk = (list, size = 200) => {
  const output = [];
  for (let index = 0; index < list.length; index += size) {
    output.push(list.slice(index, index + size));
  }
  return output;
};

const deleteByIds = async ({ tableName, columnName, ids, dbRunFn }) => {
  const safeIds = Array.isArray(ids) ? ids : [];
  for (const batch of chunk(safeIds)) {
    if (!batch.length) continue;
    const placeholders = batch.map(() => "?").join(",");
    await dbRunFn(`DELETE FROM ${tableName} WHERE ${columnName} IN (${placeholders})`, batch);
  }
};

const collectDriveFileIds = (rows) =>
  Array.from(
    new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => extractGoogleDriveFileIdFromImageUrl(row && row.image_url ? row.image_url : ""))
        .filter(Boolean)
    )
  );

const collectChapterStoragePrefixes = async (chapterRow) => {
  if (!chapterRow) return [];
  const prefixes = new Set();
  const storedPrefix = (chapterRow.pages_prefix || "").toString().trim();
  const processingToken = (chapterRow.processing_draft_token || "").toString().trim();

  if (storedPrefix) prefixes.add(storedPrefix);

  const config = getB2Config();
  const finalPrefix = `${config.chapterPrefix}/manga-${chapterRow.manga_id}/ch-${String(chapterRow.number)}`;
  if (finalPrefix) prefixes.add(finalPrefix);

  if (processingToken && isChapterDraftTokenValid(processingToken)) {
    const draft = await getChapterDraft(processingToken);
    const draftPrefix = draft && draft.pages_prefix
      ? String(draft.pages_prefix).trim()
      : buildChapterDraftPrefix(chapterRow.manga_id, processingToken);
    if (draftPrefix) prefixes.add(draftPrefix);
  }

  return Array.from(prefixes).filter(Boolean);
};

const collectMangaStoragePrefixes = async (mangaId) => {
  const config = getB2Config();
  const safeMangaId = Math.floor(Number(mangaId));
  const rootPrefix = `${config.chapterPrefix}/manga-${safeMangaId}`;
  const tmpPrefix = `${config.chapterPrefix}/tmp/manga-${safeMangaId}`;
  const prefixes = new Set([rootPrefix, tmpPrefix]);

  const storedPrefixes = await dbAll(
    "SELECT DISTINCT pages_prefix FROM chapters WHERE manga_id = ? AND pages_prefix IS NOT NULL AND TRIM(pages_prefix) <> ''",
    [safeMangaId]
  );
  storedPrefixes.forEach((row) => {
    const prefix = row && row.pages_prefix != null ? String(row.pages_prefix).trim() : "";
    if (prefix) prefixes.add(prefix);
  });

  const draftPrefixes = await dbAll(
    "SELECT DISTINCT pages_prefix FROM chapter_drafts WHERE manga_id = ? AND pages_prefix IS NOT NULL AND TRIM(pages_prefix) <> ''",
    [safeMangaId]
  ).catch(() => []);
  draftPrefixes.forEach((row) => {
    const prefix = row && row.pages_prefix != null ? String(row.pages_prefix).trim() : "";
    if (prefix) prefixes.add(prefix);
  });

  return Array.from(prefixes).filter(Boolean);
};

const removeMangaIdFromHomepageFeatured = async ({ mangaId, dbGetFn, dbRunFn }) => {
  const homepageRow = await dbGetFn("SELECT featured_ids FROM homepage WHERE id = 1 LIMIT 1").catch(() => null);
  if (!homepageRow) return 0;

  const nextFeaturedIds = (homepageRow.featured_ids || "")
    .toString()
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value))
    .filter((value, index, list) => list.indexOf(value) === index)
    .filter((value) => value !== Math.floor(Number(mangaId)));

  await dbRunFn("UPDATE homepage SET featured_ids = ?, updated_at = ? WHERE id = 1", [
    nextFeaturedIds.join(","),
    new Date().toISOString(),
  ]).catch(() => null);
  return 1;
};

const ensureExternalCleanupReady = ({ storagePrefixes, driveFileIds, dryRun }) => {
  if (dryRun) return;

  if (storagePrefixes.length && !isB2Ready(getB2Config())) {
    throw new Error("Cannot hard delete because storage assets exist but S3/B2 credentials are missing.");
  }

  if (driveFileIds.length && !isGoogleDriveConfigured()) {
    throw new Error("Cannot hard delete because comment images exist but Google Drive credentials are missing.");
  }
};

const deleteStoragePrefixes = async (prefixes) => {
  let deleted = 0;
  for (const prefix of prefixes) {
    deleted += await b2DeleteAllByPrefix(prefix);
  }
  return deleted;
};

const deleteDriveFiles = async (fileIds) => {
  let deleted = 0;
  for (const fileId of fileIds) {
    await deleteGoogleDriveImageByFileId(fileId);
    deleted += 1;
  }
  return deleted;
};

const purgeChapter = async ({ chapterRow, dryRun }) => {
  const safeChapterId = Math.floor(Number(chapterRow.id));
  const safeMangaId = Math.floor(Number(chapterRow.manga_id));
  const chapterNumber = Number(chapterRow.number);
  const commentScopeIsNull = Boolean(chapterRow.manga_is_oneshot) && Boolean(chapterRow.is_oneshot);
  const processingToken = (chapterRow.processing_draft_token || "").toString().trim();

  const commentRows = await dbAll(
    `
      SELECT id, image_url
      FROM comments
      WHERE manga_id = ?
        AND ${commentScopeIsNull ? "chapter_number IS NULL" : "chapter_number = ?"}
    `,
    commentScopeIsNull ? [safeMangaId] : [safeMangaId, chapterNumber]
  );
  const commentIds = commentRows
    .map((row) => Number(row && row.id))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value));
  const driveFileIds = collectDriveFileIds(commentRows);
  const storagePrefixes = await collectChapterStoragePrefixes(chapterRow);

  ensureExternalCleanupReady({ storagePrefixes, driveFileIds, dryRun });

  if (dryRun) {
    return {
      chapterId: safeChapterId,
      mangaId: safeMangaId,
      commentCount: commentIds.length,
      storagePrefixCount: storagePrefixes.length,
      driveFileCount: driveFileIds.length,
    };
  }

  const chapterViewStatsExists = await doesTableExist("chapter_view_stats");
  await withTransaction(async ({ dbRun: txRun }) => {
    await txRun("DELETE FROM chapter_reports WHERE chapter_id = ? OR (manga_id = ? AND chapter_number = ?)", [
      safeChapterId,
      safeMangaId,
      chapterNumber,
    ]);
    await txRun("DELETE FROM reading_history WHERE manga_id = ? AND chapter_number = ?", [safeMangaId, chapterNumber]);
    await txRun("DELETE FROM notifications WHERE manga_id = ? AND chapter_number = ?", [safeMangaId, chapterNumber]);
    if (chapterViewStatsExists) {
      await txRun("DELETE FROM chapter_view_stats WHERE chapter_id = ?", [safeChapterId]);
    }
    if (commentIds.length) {
      await deleteByIds({ tableName: "comment_likes", columnName: "comment_id", ids: commentIds, dbRunFn: txRun });
      await deleteByIds({ tableName: "comment_reports", columnName: "comment_id", ids: commentIds, dbRunFn: txRun });
      await deleteByIds({ tableName: "notifications", columnName: "comment_id", ids: commentIds, dbRunFn: txRun });
    }
    await txRun(
      `DELETE FROM comments WHERE manga_id = ? AND ${commentScopeIsNull ? "chapter_number IS NULL" : "chapter_number = ?"}`,
      commentScopeIsNull ? [safeMangaId] : [safeMangaId, chapterNumber]
    );
    if (processingToken && isChapterDraftTokenValid(processingToken)) {
      await txRun("DELETE FROM chapter_drafts WHERE token = ?", [processingToken]).catch(() => null);
    }
    await txRun("DELETE FROM chapters WHERE id = ?", [safeChapterId]);
    await txRun("UPDATE manga SET updated_at = ? WHERE id = ? AND COALESCE(is_deleted, false) = false", [
      new Date().toISOString(),
      safeMangaId,
    ]);
  });

  const deletedStorageFiles = await deleteStoragePrefixes(storagePrefixes);
  const deletedDriveFiles = await deleteDriveFiles(driveFileIds);

  return {
    chapterId: safeChapterId,
    mangaId: safeMangaId,
    commentCount: commentIds.length,
    storagePrefixCount: storagePrefixes.length,
    deletedStorageFiles,
    deletedDriveFiles,
  };
};

const purgeManga = async ({ mangaRow, dryRun }) => {
  const safeMangaId = Math.floor(Number(mangaRow.id));
  const chapterRows = await dbAll(
    `
      SELECT
        c.id,
        c.manga_id,
        c.number,
        c.pages_prefix,
        c.processing_draft_token,
        COALESCE(c.is_oneshot, false) AS is_oneshot,
        COALESCE(m.is_oneshot, false) AS manga_is_oneshot
      FROM chapters c
      LEFT JOIN manga m ON m.id = c.manga_id
      WHERE c.manga_id = ?
    `,
    [safeMangaId]
  );
  const chapterIds = chapterRows
    .map((row) => Number(row && row.id))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value));
  const commentRows = await dbAll("SELECT id, image_url FROM comments WHERE manga_id = ?", [safeMangaId]);
  const commentIds = commentRows
    .map((row) => Number(row && row.id))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value));
  const driveFileIds = collectDriveFileIds(commentRows);
  const storagePrefixes = await collectMangaStoragePrefixes(safeMangaId);
  const localCoverFilename = extractLocalCoverFilename(mangaRow.cover || "");

  ensureExternalCleanupReady({ storagePrefixes, driveFileIds, dryRun });

  if (dryRun) {
    return {
      mangaId: safeMangaId,
      chapterCount: chapterIds.length,
      commentCount: commentIds.length,
      storagePrefixCount: storagePrefixes.length,
      driveFileCount: driveFileIds.length,
      localCoverFilename,
    };
  }

  const chapterViewStatsExists = await doesTableExist("chapter_view_stats");
  const legacyBookmarksExist = await doesTableExist("manga_bookmarks");
  await withTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
    await removeMangaIdFromHomepageFeatured({ mangaId: safeMangaId, dbGetFn: txGet, dbRunFn: txRun });
    await txRun("DELETE FROM reading_history WHERE manga_id = ?", [safeMangaId]);
    await txRun("DELETE FROM notifications WHERE manga_id = ?", [safeMangaId]);
    await txRun("DELETE FROM manga_bookmark_list_items WHERE manga_id = ?", [safeMangaId]);
    if (legacyBookmarksExist) {
      await txRun("DELETE FROM manga_bookmarks WHERE manga_id = ?", [safeMangaId]);
    }
    await txRun("DELETE FROM manga_view_daily_stats WHERE manga_id = ?", [safeMangaId]).catch(() => null);
    await txRun("DELETE FROM manga_translation_teams WHERE manga_id = ?", [safeMangaId]).catch(() => null);
    await txRun("DELETE FROM manga_genres WHERE manga_id = ?", [safeMangaId]).catch(() => null);
    await txRun("DELETE FROM chapter_reports WHERE manga_id = ?", [safeMangaId]);
    if (chapterViewStatsExists && chapterIds.length) {
      await deleteByIds({ tableName: "chapter_view_stats", columnName: "chapter_id", ids: chapterIds, dbRunFn: txRun });
    }
    if (commentIds.length) {
      await deleteByIds({ tableName: "comment_likes", columnName: "comment_id", ids: commentIds, dbRunFn: txRun });
      await deleteByIds({ tableName: "comment_reports", columnName: "comment_id", ids: commentIds, dbRunFn: txRun });
      await deleteByIds({ tableName: "notifications", columnName: "comment_id", ids: commentIds, dbRunFn: txRun });
    }
    await txRun("DELETE FROM comments WHERE manga_id = ?", [safeMangaId]);
    await txRun("DELETE FROM chapter_drafts WHERE manga_id = ?", [safeMangaId]).catch(() => null);
    await txRun("DELETE FROM chapters WHERE manga_id = ?", [safeMangaId]);
    await txRun("DELETE FROM manga WHERE id = ?", [safeMangaId]);
  });

  const deletedStorageFiles = await deleteStoragePrefixes(storagePrefixes);
  const deletedDriveFiles = await deleteDriveFiles(driveFileIds);
  if (localCoverFilename) {
    await deleteFileIfExists(path.join(coversDir, localCoverFilename));
  }

  return {
    mangaId: safeMangaId,
    chapterCount: chapterIds.length,
    commentCount: commentIds.length,
    storagePrefixCount: storagePrefixes.length,
    deletedStorageFiles,
    deletedDriveFiles,
    localCoverFilename,
  };
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    printUsage();
    return;
  }

  const dryRun = args.includes("--dry-run");
  const includeActive = args.includes("--include-active");
  const allManga = args.includes("--all-manga");
  const allChapters = args.includes("--all-chapters");
  const mangaIds = parseIdFlags(args, "--manga-id");
  const chapterIds = parseIdFlags(args, "--chapter-id");

  if (!allManga && !allChapters && !mangaIds.length && !chapterIds.length) {
    printUsage();
    process.exit(1);
  }

  const mangaConditions = [];
  const mangaParams = [];
  if (allManga) {
    mangaConditions.push("1 = 1");
  }
  if (mangaIds.length) {
    mangaConditions.push(`id IN (${mangaIds.map(() => "?").join(",")})`);
    mangaParams.push(...mangaIds);
  }
  if (!includeActive) {
    mangaConditions.push("COALESCE(is_deleted, false) = true");
  }
  const mangaRows = mangaConditions.length
    ? await dbAll(
        `SELECT id, cover, COALESCE(is_deleted, false) AS is_deleted FROM manga WHERE ${mangaConditions.join(" AND ")} ORDER BY id ASC`,
        mangaParams
      )
    : [];

  const mangaTargetIds = new Set(mangaRows.map((row) => Math.floor(Number(row.id))));

  const chapterConditions = [];
  const chapterParams = [];
  if (allChapters) {
    chapterConditions.push("1 = 1");
  }
  if (chapterIds.length) {
    chapterConditions.push(`c.id IN (${chapterIds.map(() => "?").join(",")})`);
    chapterParams.push(...chapterIds);
  }
  if (!includeActive) {
    chapterConditions.push("COALESCE(c.is_deleted, false) = true");
  }
  const rawChapterRows = chapterConditions.length
    ? await dbAll(
        `
          SELECT
            c.id,
            c.manga_id,
            c.number,
            c.pages_prefix,
            c.processing_draft_token,
            COALESCE(c.is_deleted, false) AS is_deleted,
            COALESCE(c.is_oneshot, false) AS is_oneshot,
            COALESCE(m.is_oneshot, false) AS manga_is_oneshot
          FROM chapters c
          LEFT JOIN manga m ON m.id = c.manga_id
          WHERE ${chapterConditions.join(" AND ")}
          ORDER BY c.manga_id ASC, c.number ASC, c.id ASC
        `,
        chapterParams
      )
    : [];
  const chapterRows = rawChapterRows.filter((row) => !mangaTargetIds.has(Math.floor(Number(row.manga_id))));

  console.log(`Hard purge plan (${dryRun ? "dry-run" : "apply"})`);
  console.log(`- manga targets: ${mangaRows.length}`);
  console.log(`- chapter targets: ${chapterRows.length}`);

  const mangaResults = [];
  for (const mangaRow of mangaRows) {
    const summary = await purgeManga({ mangaRow, dryRun });
    mangaResults.push(summary);
    console.log(`purged manga #${summary.mangaId} (chapters: ${summary.chapterCount}, comments: ${summary.commentCount})`);
  }

  const chapterResults = [];
  for (const chapterRow of chapterRows) {
    const summary = await purgeChapter({ chapterRow, dryRun });
    chapterResults.push(summary);
    console.log(`purged chapter #${summary.chapterId} of manga #${summary.mangaId} (comments: ${summary.commentCount})`);
  }

  console.log("Done.");
  console.log(
    JSON.stringify(
      {
        dryRun,
        includeActive,
        mangaPurged: mangaResults.length,
        chapterPurged: chapterResults.length,
        mangaResults,
        chapterResults,
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgPool.end().catch(() => null);
  });
