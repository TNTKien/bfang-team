"use strict";

require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const { Pool } = require("pg");
const sharp = require("sharp");
const { createConvertChapterPageToWebp } = require("./utils/chapter-page-webp");
const {
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const PORT = Math.max(1, Math.floor(Number(process.env.PORT) || 3001));
const DATABASE_URL = (process.env.DATABASE_URL || "").toString().trim();
const API_KEY_SECRET = (process.env.API_KEY_SECRET || process.env.SESSION_SECRET || "").toString();
const CHAPTER_UPLOAD_SHARED_SECRET =
  (process.env.CHAPTER_UPLOAD_SHARED_SECRET || API_KEY_SECRET || "").toString();
const WEB_BASE_URL = normalizeBaseUrl(process.env.WEB_BASE_URL || "http://127.0.0.1:3000");
const API_ALLOWED_ORIGINS_RAW = (process.env.API_ALLOWED_ORIGINS || "").toString().trim();

const S3_BUCKET = (process.env.S3_BUCKET || "").toString().trim();
const S3_ACCESS_KEY_ID = (process.env.S3_ACCESS_KEY_ID || "").toString().trim();
const S3_SECRET_ACCESS_KEY = (process.env.S3_SECRET_ACCESS_KEY || "").toString().trim();
const S3_ENDPOINT = (process.env.S3_ENDPOINT || "").toString().trim();
const S3_REGION = (process.env.S3_REGION || "us-east-1").toString().trim() || "us-east-1";
const S3_FORCE_PATH_STYLE = toBooleanFlag(process.env.S3_FORCE_PATH_STYLE, true);
const S3_CHAPTER_PREFIX = normalizeS3Key((process.env.S3_CHAPTER_PREFIX || "chapters").toString().trim() || "chapters");
const CHAPTER_CDN_BASE_URL = normalizeBaseUrl(process.env.CHAPTER_CDN_BASE_URL || S3_ENDPOINT || "");

const API_KEY_TOKEN_PATTERN = /^bfk_[a-f0-9]{16}_[a-f0-9]{48}$/;
const API_KEY_USAGE_TOUCH_INTERVAL_MS = 60 * 1000;
const NOTIFICATION_TYPE_MANGA_BOOKMARK_NEW_CHAPTER = "manga_bookmark_new_chapter";
const CHAPTER_MAX_PAGES = 220;
const CHAPTER_PAGE_MAX_SIZE_BYTES = 12 * 1024 * 1024;
const UPLOAD_SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const UPLOAD_SESSION_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const CHAPTER_DRAFT_TTL_MS = 3 * 60 * 60 * 1000;
const CHAPTER_PAGE_FILE_PREFIX_PATTERN = /^[a-zA-Z]{5}$/;
const CHAPTER_PAGE_FILE_PREFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CHAPTER_PAGE_FILE_PREFIX_LENGTH = 5;
const UPLOAD_PAGE_PRESIGN_EXPIRES_SECONDS = 15 * 60;
const CHAPTER_DRAFT_TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const CHAPTER_DRAFT_PAGE_ID_PATTERN = /^[a-f0-9]{24}$/;
const CHAPTER_DRAFT_PROOF_PATTERN = /^v1\.(\d{10,14})\.([a-f0-9]{64})$/;
const CHAPTER_DRAFT_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/bmp"
]);

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required for api_server");
}

if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  throw new Error("S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required for api_server");
}

if (!API_KEY_SECRET) {
  console.warn("[api_server] API_KEY_SECRET is empty. Falling back to plain SHA-256 hash verification.");
}

const pool = new Pool({ connectionString: DATABASE_URL });
pool.on("error", (err) => {
  console.error("[api_server] Postgres pool error", err);
});

const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT || undefined,
  forcePathStyle: S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY
  }
});

const app = express();
app.disable("x-powered-by");

const convertChapterPageToWebp = createConvertChapterPageToWebp({ sharp });

function normalizeOrigin(value) {
  const raw = (value == null ? "" : String(value)).trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch (_err) {
    return "";
  }
}

function parseAllowedOrigins(value) {
  const raw = (value == null ? "" : String(value)).trim();
  if (!raw) return [];
  const tokens = raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  const result = [];
  const seen = new Set();
  for (const token of tokens) {
    const origin = normalizeOrigin(token);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    result.push(origin);
  }
  return result;
}

function getLoopbackOriginVariants(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return [];

  const variants = new Set([normalized]);
  try {
    const parsed = new URL(normalized);
    const protocol = (parsed.protocol || "").toLowerCase();
    const hostname = (parsed.hostname || "").toLowerCase();
    const portPart = parsed.port ? `:${parsed.port}` : "";
    const add = (hostValue) => {
      variants.add(`${protocol}//${hostValue}${portPart}`.toLowerCase());
    };

    if (hostname === "localhost") {
      add("127.0.0.1");
      add("[::1]");
    } else if (hostname === "127.0.0.1") {
      add("localhost");
      add("[::1]");
    } else if (hostname === "::1") {
      add("localhost");
      add("127.0.0.1");
    }
  } catch (_err) {
    // keep normalized only
  }

  return Array.from(variants);
}

function appendVaryHeader(res, value) {
  const existing = (res.getHeader("Vary") || "").toString();
  if (!existing) {
    res.setHeader("Vary", value);
    return;
  }

  const normalized = existing
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());
  if (!normalized.includes(String(value).toLowerCase())) {
    res.setHeader("Vary", `${existing}, ${value}`);
  }
}

const corsAllowedOrigins = new Set();
parseAllowedOrigins(API_ALLOWED_ORIGINS_RAW).forEach((origin) => {
  getLoopbackOriginVariants(origin).forEach((value) => {
    corsAllowedOrigins.add(value);
  });
});
const defaultWebOrigin = normalizeOrigin(WEB_BASE_URL);
if (defaultWebOrigin) {
  getLoopbackOriginVariants(defaultWebOrigin).forEach((value) => {
    corsAllowedOrigins.add(value);
  });
}
if (!corsAllowedOrigins.size) {
  getLoopbackOriginVariants("http://127.0.0.1:3000").forEach((value) => {
    corsAllowedOrigins.add(value);
  });
}

const CORS_ALLOWED_HEADERS = "Content-Type, X-API-Key, Authorization, X-Chapter-Draft-Proof";
const CORS_ALLOWED_METHODS = "GET, POST, DELETE, OPTIONS";
const CORS_MAX_AGE_SECONDS = "600";

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
  res.setHeader("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
  res.setHeader("Access-Control-Max-Age", CORS_MAX_AGE_SECONDS);

  const method = (req.method || "").toString().toUpperCase();
  const originHeader = (req.get("origin") || "").toString().trim();
  const requestOrigin = normalizeOrigin(originHeader);
  const isCorsRequest = Boolean(originHeader);
  const isAllowedOrigin = Boolean(requestOrigin && corsAllowedOrigins.has(requestOrigin));

  if (isCorsRequest) {
    appendVaryHeader(res, "Origin");
  }

  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
  }

  if (method === "OPTIONS") {
    if (!isCorsRequest || isAllowedOrigin) {
      return res.status(204).end();
    }
    return res.status(403).json({ ok: false, error: "Origin not allowed" });
  }

  if (isCorsRequest && !isAllowedOrigin) {
    return res.status(403).json({ ok: false, error: "Origin not allowed" });
  }

  return next();
});

app.use(express.json({ limit: "2mb" }));

const chapterDraftPageUploadMulter = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CHAPTER_PAGE_MAX_SIZE_BYTES,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    const type = (file && file.mimetype ? String(file.mimetype) : "").trim().toLowerCase();
    if (!CHAPTER_DRAFT_ALLOWED_MIME_TYPES.has(type)) {
      return cb(new Error("Only image/jpeg, image/png, image/webp, image/avif or image/bmp is accepted."));
    }
    return cb(null, true);
  }
}).single("page");

const uploadSessions = new Map();

const jsonError = (res, statusCode, message, extra) =>
  res.status(statusCode).json({
    ok: false,
    error: (message || "Request failed").toString(),
    ...(extra && typeof extra === "object" ? extra : {})
  });

const dbAll = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return Array.isArray(result.rows) ? result.rows : [];
};

const dbGet = async (sql, params = []) => {
  const rows = await dbAll(sql, params);
  return rows.length ? rows[0] : null;
};

const withTransaction = async (runner) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await runner(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackErr) {
      // ignore rollback error
    }
    throw err;
  } finally {
    client.release();
  }
};

const notifyBookmarkedUsersForNewChapter = async ({ mangaId, chapterNumber, createdAtMs }) => {
  const mangaIdValue = Number(mangaId);
  const chapterValue = Number(chapterNumber);
  if (!Number.isFinite(mangaIdValue) || mangaIdValue <= 0) return 0;
  if (!Number.isFinite(chapterValue) || chapterValue < 0) return 0;

  const safeMangaId = Math.floor(mangaIdValue);
  const safeChapterNumber = Math.abs(chapterValue) < 1e-9 ? 0 : chapterValue;
  const safeCreatedAt = Number.isFinite(Number(createdAtMs)) ? Math.floor(Number(createdAtMs)) : Date.now();

  const insertedRows = await dbAll(
    `
      WITH inserted AS (
        INSERT INTO notifications (
          user_id,
          type,
          actor_user_id,
          manga_id,
          chapter_number,
          comment_id,
          content_preview,
          is_read,
          created_at,
          read_at
        )
        SELECT
          src.user_id,
          $1,
          NULL,
          $2,
          $3,
          NULL,
          '',
          false,
          $4,
          NULL
        FROM (
          SELECT mb.user_id
          FROM manga_bookmarks mb
          WHERE mb.manga_id = $2

          UNION

          SELECT l.user_id
          FROM manga_bookmark_lists l
          JOIN manga_bookmark_list_items li ON li.list_id = l.id
          WHERE l.is_default_follow = true
            AND li.manga_id = $2
        ) src
        WHERE src.user_id IS NOT NULL
          AND BTRIM(src.user_id) <> ''
        ON CONFLICT DO NOTHING
        RETURNING user_id
      )
      SELECT DISTINCT user_id
      FROM inserted
      WHERE user_id IS NOT NULL
        AND BTRIM(user_id) <> ''
    `,
    [
      NOTIFICATION_TYPE_MANGA_BOOKMARK_NEW_CHAPTER,
      safeMangaId,
      safeChapterNumber,
      safeCreatedAt
    ]
  );

  return Array.isArray(insertedRows) ? insertedRows.length : 0;
};

function normalizeBaseUrl(value) {
  const raw = (value == null ? "" : String(value)).trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const base = `${parsed.protocol}//${parsed.host}${parsed.pathname || ""}`.replace(/\/+$/, "");
    return base;
  } catch (_err) {
    return "";
  }
}

function toBooleanFlag(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value == null) return Boolean(fallback);
  const text = String(value).trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return Boolean(fallback);
}

function normalizeS3Key(value) {
  return (value == null ? "" : String(value))
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/+/g, "/")
    .trim();
}

function formatChapterNumberValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const rounded = Math.round(number * 1000) / 1000;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(3).replace(/\.?0+$/, "");
}

function parseChapterNumberInput(value) {
  const raw = value == null ? "" : String(value);
  const text = raw.trim();
  if (!text) return null;
  const normalized = text.replace(/,/g, ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed * 1000) / 1000;
  return rounded;
}

function normalizeChapterPageFilePrefix(value) {
  const text = (value == null ? "" : String(value)).trim();
  if (!text) return "";
  return CHAPTER_PAGE_FILE_PREFIX_PATTERN.test(text) ? text : "";
}

function buildRandomChapterPageFilePrefix(length = CHAPTER_PAGE_FILE_PREFIX_LENGTH) {
  const safeLength = Math.max(1, Math.floor(Number(length) || CHAPTER_PAGE_FILE_PREFIX_LENGTH));
  const alphabetLength = CHAPTER_PAGE_FILE_PREFIX_ALPHABET.length;
  let output = "";
  while (output.length < safeLength) {
    const bytes = crypto.randomBytes(Math.max(8, safeLength * 2));
    for (let i = 0; i < bytes.length && output.length < safeLength; i += 1) {
      output += CHAPTER_PAGE_FILE_PREFIX_ALPHABET[bytes[i] % alphabetLength];
    }
  }
  return output;
}

function buildChapterPageFileName({ pageNumber, padLength, extension, pageFilePrefix }) {
  const page = Number(pageNumber);
  if (!Number.isFinite(page) || page <= 0) return "";
  const safePadLength = Math.max(1, Math.floor(Number(padLength) || 0));
  const ext = (extension == null ? "" : String(extension)).trim();
  if (!ext) return "";
  const pageName = String(Math.floor(page)).padStart(safePadLength, "0");
  const suffix = normalizeChapterPageFilePrefix(pageFilePrefix);
  return suffix ? `${pageName}_${suffix}.${ext}` : `${pageName}.${ext}`;
}

function buildUploadSessionTmpPageName({ pageIndex, padLength }) {
  const index = Number(pageIndex);
  if (!Number.isFinite(index) || index <= 0) return "";
  const safePadLength = Math.max(1, Math.floor(Number(padLength) || 0));
  return `${String(Math.floor(index)).padStart(safePadLength, "0")}.webp`;
}

function buildUploadSessionTmpPageKey({ session, pageIndex }) {
  const tmpPrefix = normalizeS3Key(session && session.tmpPrefix ? session.tmpPrefix : "");
  if (!tmpPrefix) return "";
  const pageName = buildUploadSessionTmpPageName({
    pageIndex,
    padLength: session && session.padLength
  });
  if (!pageName) return "";
  return normalizeS3Key(`${tmpPrefix}/${pageName}`);
}

function normalizeS3Etag(value) {
  const text = (value == null ? "" : String(value)).trim();
  if (!text) return "";
  return text.replace(/^"+|"+$/g, "").trim();
}

function parseChapterPageNumberFromFileName({ fileName, expectedPageFilePrefix }) {
  const tail = (fileName == null ? "" : String(fileName)).trim();
  if (!tail) return null;
  const match = tail.match(/^(\d{1,6})(?:_([a-zA-Z]{5}))?\.webp$/i);
  if (!match) return null;
  const matchedPrefix = normalizeChapterPageFilePrefix(match[2]);
  const expectedPrefix = normalizeChapterPageFilePrefix(expectedPageFilePrefix);
  if (expectedPrefix) {
    if (matchedPrefix !== expectedPrefix) return null;
  } else if (matchedPrefix) {
    return null;
  }
  const page = Number(match[1]);
  if (!Number.isFinite(page) || page <= 0) return null;
  return Math.floor(page);
}

function isChapterDraftTokenValid(value) {
  return CHAPTER_DRAFT_TOKEN_PATTERN.test((value == null ? "" : String(value)).trim());
}

function isChapterDraftPageIdValid(value) {
  return CHAPTER_DRAFT_PAGE_ID_PATTERN.test((value == null ? "" : String(value)).trim());
}

function readApiKeyFromRequest(req) {
  const readHeader = (name) => (req && typeof req.get === "function" ? String(req.get(name) || "").trim() : "");

  const direct = normalizeApiKeyToken(readHeader("x-api-key"));
  if (direct) return direct;

  const authorization = readHeader("authorization");
  if (!authorization) return "";

  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch && bearerMatch[1]) {
    const token = normalizeApiKeyToken(bearerMatch[1]);
    if (token) return token;
  }

  const apiKeyMatch = authorization.match(/^ApiKey\s+(.+)$/i);
  if (apiKeyMatch && apiKeyMatch[1]) {
    const token = normalizeApiKeyToken(apiKeyMatch[1]);
    if (token) return token;
  }

  return normalizeApiKeyToken(authorization);
}

function normalizeApiKeyToken(value) {
  const text = (value == null ? "" : String(value)).trim();
  if (!text) return "";
  if (!API_KEY_TOKEN_PATTERN.test(text)) return "";
  return text;
}

function hashApiKeyToken(token) {
  const normalized = normalizeApiKeyToken(token);
  if (!normalized) return "";
  if (API_KEY_SECRET) {
    return crypto.createHmac("sha256", API_KEY_SECRET).update(normalized).digest("hex");
  }
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function readChapterDraftProof(req) {
  if (!req || typeof req.get !== "function") return "";
  return String(req.get("x-chapter-draft-proof") || "").trim();
}

function buildChapterDraftProofSignature(token, expiresAtText) {
  const safeToken = (token == null ? "" : String(token)).trim();
  const safeExpiresAt = (expiresAtText == null ? "" : String(expiresAtText)).trim();
  if (!CHAPTER_UPLOAD_SHARED_SECRET || !isChapterDraftTokenValid(safeToken) || !/^\d{10,14}$/.test(safeExpiresAt)) {
    return "";
  }
  const payload = `${safeToken}.${safeExpiresAt}`;
  return crypto.createHmac("sha256", CHAPTER_UPLOAD_SHARED_SECRET).update(payload).digest("hex");
}

function verifyChapterDraftProof({ token, proof }) {
  const safeToken = (token == null ? "" : String(token)).trim();
  if (!isChapterDraftTokenValid(safeToken)) {
    return { ok: false, statusCode: 404, error: "Draft token is invalid" };
  }

  if (!CHAPTER_UPLOAD_SHARED_SECRET) {
    return { ok: false, statusCode: 503, error: "Draft proof secret is not configured" };
  }

  const rawProof = (proof == null ? "" : String(proof)).trim();
  const matched = CHAPTER_DRAFT_PROOF_PATTERN.exec(rawProof);
  if (!matched) {
    return { ok: false, statusCode: 401, error: "Draft proof is invalid" };
  }

  const expiresAtText = matched[1];
  const providedSignature = matched[2].toLowerCase();
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return { ok: false, statusCode: 401, error: "Draft proof is invalid" };
  }
  if (Date.now() > expiresAt) {
    return { ok: false, statusCode: 401, error: "Draft proof has expired" };
  }

  const expectedSignature = buildChapterDraftProofSignature(safeToken, expiresAtText);
  if (!expectedSignature) {
    return { ok: false, statusCode: 401, error: "Draft proof is invalid" };
  }

  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const providedBuffer = Buffer.from(providedSignature, "hex");
  if (expectedBuffer.length !== providedBuffer.length) {
    return { ok: false, statusCode: 401, error: "Draft proof is invalid" };
  }
  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { ok: false, statusCode: 401, error: "Draft proof is invalid" };
  }

  return { ok: true, expiresAt };
}

function normalizeTeamIdList(values) {
  const list = Array.isArray(values) ? values : [];
  return Array.from(
    new Set(
      list
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value))
    )
  );
}

function isLikelyWebpBuffer(value) {
  if (!Buffer.isBuffer(value) || value.length < 16) return false;
  const riffTag = value.toString("ascii", 0, 4);
  const webpTag = value.toString("ascii", 8, 12);
  const chunkTag = value.toString("ascii", 12, 16);
  if (riffTag !== "RIFF" || webpTag !== "WEBP") return false;
  if (chunkTag !== "VP8 " && chunkTag !== "VP8L" && chunkTag !== "VP8X") return false;
  return true;
}

async function isMangaTaggedWebtoon(mangaId) {
  const safeMangaId = Number(mangaId);
  if (!Number.isFinite(safeMangaId) || safeMangaId <= 0) return false;

  const row = await dbGet(
    `
      SELECT 1 AS is_webtoon
      FROM manga_genres mg
      JOIN genres g ON g.id = mg.genre_id
      WHERE mg.manga_id = $1
        AND lower(trim(g.name)) = $2
      LIMIT 1
    `,
    [Math.floor(safeMangaId), "webtoon"]
  );

  return Boolean(row);
}

function buildTeamMemberPermissionsFromRow(row) {
  const role = (row && row.role ? String(row.role) : "member").trim().toLowerCase();
  if (role === "leader") {
    return {
      canAddChapter: true,
      canEditChapter: true,
      canDeleteChapter: true
    };
  }

  return {
    canAddChapter: toBooleanFlag(row && row.can_add_chapter, true),
    canEditChapter: toBooleanFlag(row && row.can_edit_chapter, true),
    canDeleteChapter: toBooleanFlag(row && row.can_delete_chapter, true)
  };
}

function resolveMangaPermissions({ memberships, linkedTeamIds }) {
  const list = Array.isArray(memberships) ? memberships : [];
  const linkedTeamIdSet = new Set(normalizeTeamIdList(linkedTeamIds));
  if (!linkedTeamIdSet.size) {
    return {
      canAddChapter: false,
      canEditChapter: false,
      canDeleteChapter: false,
      canUploadChapter: false
    };
  }

  let canAddChapter = false;
  let canEditChapter = false;
  let canDeleteChapter = false;

  for (const membership of list) {
    const teamId = Number(membership && membership.teamId);
    if (!Number.isFinite(teamId) || teamId <= 0) continue;
    if (!linkedTeamIdSet.has(Math.floor(teamId))) continue;
    const permissions = membership.permissions || {};
    canAddChapter = canAddChapter || Boolean(permissions.canAddChapter);
    canEditChapter = canEditChapter || Boolean(permissions.canEditChapter);
    canDeleteChapter = canDeleteChapter || Boolean(permissions.canDeleteChapter);
  }

  return {
    canAddChapter,
    canEditChapter,
    canDeleteChapter,
    canUploadChapter: canAddChapter || canEditChapter
  };
}

function buildWebAssetUrl(pathOrUrl, cacheToken) {
  const raw = (pathOrUrl == null ? "" : String(pathOrUrl)).trim();
  if (!raw) return "";
  const hasAbsolute = /^https?:\/\//i.test(raw);
  const base = hasAbsolute ? raw : `${WEB_BASE_URL}${raw.startsWith("/") ? raw : `/${raw}`}`;
  const stamp = Number(cacheToken);
  if (!Number.isFinite(stamp) || stamp <= 0) return base;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}t=${encodeURIComponent(String(Math.floor(stamp)))}`;
}

function encodeS3CopySource(bucket, key) {
  const safeBucket = (bucket || "").trim();
  const safeKey = normalizeS3Key(key);
  if (!safeBucket || !safeKey) return "";
  return `${encodeURIComponent(safeBucket)}/${safeKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

async function listApprovedMemberships(userId) {
  const safeUserId = (userId || "").toString().trim();
  if (!safeUserId) return [];

  const rows = await dbAll(
    `
      SELECT
        tm.team_id,
        tm.role,
        tm.can_add_chapter,
        tm.can_edit_chapter,
        tm.can_delete_chapter,
        t.name as team_name,
        t.slug as team_slug
      FROM translation_team_members tm
      JOIN translation_teams t ON t.id = tm.team_id
      WHERE tm.user_id = $1
        AND tm.status = 'approved'
        AND t.status = 'approved'
      ORDER BY CASE WHEN tm.role = 'leader' THEN 0 ELSE 1 END ASC, tm.reviewed_at DESC, tm.requested_at DESC
    `,
    [safeUserId]
  );

  return rows
    .map((row) => {
      const teamId = Number(row && row.team_id != null ? row.team_id : 0);
      const teamName = (row && row.team_name ? String(row.team_name) : "").replace(/\s+/g, " ").trim();
      if (!Number.isFinite(teamId) || teamId <= 0 || !teamName) return null;
      return {
        teamId: Math.floor(teamId),
        teamName,
        teamSlug: (row && row.team_slug ? String(row.team_slug) : "").trim(),
        role: (row && row.role ? String(row.role) : "member").trim().toLowerCase(),
        permissions: buildTeamMemberPermissionsFromRow(row)
      };
    })
    .filter(Boolean);
}

async function listUserBadges(userId) {
  const safeUserId = (userId || "").toString().trim();
  if (!safeUserId) return [];

  const rows = await dbAll(
    `
      SELECT b.code, b.label, b.color, b.priority
      FROM user_badges ub
      JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = $1
      ORDER BY b.priority DESC, b.id ASC
    `,
    [safeUserId]
  );

  return rows.map((row) => ({
    code: (row && row.code ? String(row.code) : "").trim(),
    label: (row && row.label ? String(row.label) : "").trim(),
    color: (row && row.color ? String(row.color) : "").trim(),
    priority: Number(row && row.priority != null ? row.priority : 0) || 0
  }));
}

async function listAuthorizedManga(memberships) {
  const eligibleMemberships = (Array.isArray(memberships) ? memberships : []).filter((member) => {
    const permissions = member && member.permissions ? member.permissions : null;
    return Boolean(permissions && (permissions.canAddChapter || permissions.canEditChapter));
  });
  const eligibleTeamIds = normalizeTeamIdList(eligibleMemberships.map((member) => member && member.teamId));

  if (!eligibleMemberships.length || !eligibleTeamIds.length) return [];

  const mangaRows = await dbAll(
    `
      SELECT
        m.id,
        m.title,
        m.slug,
        m.author,
        m.group_name,
        m.status,
        m.description,
        m.cover,
        m.cover_updated_at,
        m.updated_at,
        COALESCE(m.is_hidden, 0) as is_hidden,
        COALESCE(m.is_oneshot, false) as is_oneshot,
        array_agg(DISTINCT linked_mtt.team_id ORDER BY linked_mtt.team_id) AS linked_team_ids
      FROM manga m
      JOIN manga_translation_teams linked_mtt ON linked_mtt.manga_id = m.id
      WHERE EXISTS (
        SELECT 1
        FROM manga_translation_teams eligible_mtt
        WHERE eligible_mtt.manga_id = m.id
          AND eligible_mtt.team_id = ANY($1::int[])
      )
      GROUP BY
        m.id,
        m.title,
        m.slug,
        m.author,
        m.group_name,
        m.status,
        m.description,
        m.cover,
        m.cover_updated_at,
        m.updated_at,
        m.is_hidden,
        m.is_oneshot
      ORDER BY m.updated_at DESC, m.id DESC
      LIMIT 900
    `,
    [eligibleTeamIds]
  );

  const filtered = mangaRows
    .map((row) => {
      const permissions = resolveMangaPermissions({
        memberships,
        linkedTeamIds: row && row.linked_team_ids
      });

      if (!permissions.canUploadChapter) return null;
      return {
        row,
        permissions
      };
    })
    .filter(Boolean);

  if (!filtered.length) return [];

  const mangaIds = filtered
    .map((item) => Number(item && item.row && item.row.id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => Math.floor(id));

  const chapterStatsMap = new Map();
  if (mangaIds.length) {
    const statsRows = await dbAll(
      `
        SELECT
          c.manga_id,
          COUNT(*)::int as chapter_count,
          MAX(c.number) as latest_chapter_number
        FROM chapters c
        WHERE c.manga_id = ANY($1::int[])
        GROUP BY c.manga_id
      `,
      [mangaIds]
    );

    statsRows.forEach((row) => {
      const mangaId = Number(row && row.manga_id != null ? row.manga_id : 0);
      if (!Number.isFinite(mangaId) || mangaId <= 0) return;
      chapterStatsMap.set(Math.floor(mangaId), {
        chapterCount: Number(row && row.chapter_count != null ? row.chapter_count : 0) || 0,
        latestChapterNumber:
          row && row.latest_chapter_number != null ? Number(row.latest_chapter_number) || 0 : 0
      });
    });
  }

  return filtered.map((item) => {
    const row = item.row || {};
    const mangaId = Number(row.id);
    const stats = chapterStatsMap.get(Math.floor(mangaId)) || {
      chapterCount: 0,
      latestChapterNumber: 0
    };

    const latestChapterNumber = Number(stats.latestChapterNumber) || 0;
    return {
      id: Number.isFinite(mangaId) && mangaId > 0 ? Math.floor(mangaId) : 0,
      title: (row.title || "").toString(),
      slug: (row.slug || "").toString(),
      author: (row.author || "").toString(),
      groupName: (row.group_name || "").toString(),
      status: (row.status || "").toString(),
      description: (row.description || "").toString(),
      cover: (row.cover || "").toString(),
      coverUrl: buildWebAssetUrl(row.cover || "", row.cover_updated_at),
      coverUpdatedAt: Number(row && row.cover_updated_at != null ? row.cover_updated_at : 0) || 0,
      chapterCount: Number(stats.chapterCount) || 0,
      latestChapterNumber,
      latestChapterNumberText: latestChapterNumber ? formatChapterNumberValue(latestChapterNumber) : "",
      isHidden: Number(row && row.is_hidden != null ? row.is_hidden : 0) === 1,
      isOneshot: toBooleanFlag(row && row.is_oneshot, false),
      permissions: item.permissions
    };
  });
}

async function resolveAuthorizedManga({ userId, mangaId }) {
  const safeUserId = (userId || "").toString().trim();
  const safeMangaId = Number(mangaId);
  if (!safeUserId) {
    return { ok: false, statusCode: 401, error: "Invalid session" };
  }
  if (!Number.isFinite(safeMangaId) || safeMangaId <= 0) {
    return { ok: false, statusCode: 400, error: "Invalid manga id" };
  }

  const manga = await dbGet(
    `
      SELECT
        id,
        title,
        slug,
        author,
        group_name,
        status,
        description,
        cover,
        cover_updated_at,
        updated_at,
        COALESCE(is_hidden, 0) as is_hidden,
        COALESCE(is_oneshot, false) as is_oneshot
      FROM manga
      WHERE id = $1
      LIMIT 1
    `,
    [Math.floor(safeMangaId)]
  );

  if (!manga) {
    return { ok: false, statusCode: 404, error: "Manga not found" };
  }

  const memberships = await listApprovedMemberships(safeUserId);
  const linkedTeamRows = await dbAll(
    `
      SELECT team_id
      FROM manga_translation_teams
      WHERE manga_id = $1
      ORDER BY team_id ASC
    `,
    [Math.floor(safeMangaId)]
  );
  const permissions = resolveMangaPermissions({
    memberships,
    linkedTeamIds: linkedTeamRows.map((row) => row && row.team_id)
  });

  const isHidden = Number(manga && manga.is_hidden != null ? manga.is_hidden : 0) === 1;
  if (isHidden && !permissions.canUploadChapter) {
    return { ok: false, statusCode: 404, error: "Manga not found" };
  }

  if (!permissions.canUploadChapter) {
    return { ok: false, statusCode: 403, error: "No permission to upload chapter for this manga" };
  }

  return {
    ok: true,
    manga,
    memberships,
    permissions
  };
}

async function getChapterDraftByToken(token) {
  const safeToken = (token == null ? "" : String(token)).trim();
  if (!isChapterDraftTokenValid(safeToken)) return null;
  return dbGet("SELECT token, manga_id, pages_prefix, created_at, updated_at FROM chapter_drafts WHERE token = $1", [
    safeToken
  ]);
}

function isChapterDraftExpired(draftRow) {
  const updatedAt = Number(draftRow && draftRow.updated_at != null ? draftRow.updated_at : 0);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return true;
  return Date.now() - updatedAt > CHAPTER_DRAFT_TTL_MS;
}

async function getActiveChapterDraftByToken(token) {
  const draft = await getChapterDraftByToken(token);
  if (!draft || isChapterDraftExpired(draft)) return null;
  return draft;
}

async function touchActiveChapterDraftByToken(token) {
  const safeToken = (token == null ? "" : String(token)).trim();
  if (!isChapterDraftTokenValid(safeToken)) return false;
  const now = Date.now();
  const activeCutoff = now - CHAPTER_DRAFT_TTL_MS;
  const rows = await dbAll(
    "UPDATE chapter_drafts SET updated_at = $1 WHERE token = $2 AND updated_at >= $3 RETURNING token",
    [now, safeToken, activeCutoff]
  );
  return rows.length > 0;
}

async function listObjectsByPrefix(prefix) {
  const safePrefix = normalizeS3Key(prefix);
  if (!safePrefix) return [];

  const result = [];
  let continuationToken = undefined;

  do {
    const output = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: `${safePrefix}/`,
        ContinuationToken: continuationToken
      })
    );

    const items = Array.isArray(output && output.Contents) ? output.Contents : [];
    for (const item of items) {
      const key = item && item.Key ? String(item.Key).trim() : "";
      if (!key) continue;
      result.push({
        key,
        lastModified: item && item.LastModified ? new Date(item.LastModified).getTime() : 0
      });
    }

    continuationToken = output && output.IsTruncated ? output.NextContinuationToken : undefined;
  } while (continuationToken);

  return result;
}

async function deleteObjectsByKeys(keys) {
  const list = Array.isArray(keys)
    ? keys
        .map((value) => normalizeS3Key(value))
        .filter(Boolean)
    : [];
  if (!list.length) return 0;

  let deleted = 0;
  for (let i = 0; i < list.length; i += 1000) {
    const chunk = list.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: {
          Objects: chunk.map((key) => ({ Key: key }))
        }
      })
    );
    deleted += chunk.length;
  }

  return deleted;
}

async function deleteAllByPrefix(prefix) {
  const objects = await listObjectsByPrefix(prefix);
  if (!objects.length) return 0;
  const keys = objects.map((item) => item.key).filter(Boolean);
  return deleteObjectsByKeys(keys);
}

async function putWebpPage({ key, buffer }) {
  const safeKey = normalizeS3Key(key);
  if (!safeKey) {
    throw new Error("Invalid object key");
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: safeKey,
      Body: buffer,
      ContentType: "image/webp"
    })
  );
}

async function headS3Object(key) {
  const safeKey = normalizeS3Key(key);
  if (!safeKey) {
    throw new Error("Invalid object key");
  }
  const output = await s3.send(
    new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: safeKey
    })
  );
  return output && typeof output === "object" ? output : {};
}

async function copyS3Object({ sourceKey, destinationKey }) {
  const safeSource = normalizeS3Key(sourceKey);
  const safeDestination = normalizeS3Key(destinationKey);
  const copySource = encodeS3CopySource(S3_BUCKET, safeSource);
  if (!safeSource || !safeDestination || !copySource) {
    throw new Error("Invalid copy source or destination");
  }

  await s3.send(
    new CopyObjectCommand({
      Bucket: S3_BUCKET,
      Key: safeDestination,
      CopySource: copySource,
      ContentType: "image/webp",
      MetadataDirective: "REPLACE"
    })
  );
}

async function deleteChapterExtraPages({ prefix, keepPages, pageFilePrefix }) {
  const safePrefix = normalizeS3Key(prefix);
  const safeKeepPages = Number(keepPages);
  const normalizedFilePrefix = normalizeChapterPageFilePrefix(pageFilePrefix);
  if (!safePrefix) return 0;
  if (!Number.isFinite(safeKeepPages) || safeKeepPages <= 0) return 0;

  const objects = await listObjectsByPrefix(safePrefix);
  if (!objects.length) return 0;

  const keyPrefix = `${safePrefix}/`;
  const deleteKeys = [];
  for (const item of objects) {
    const key = item && item.key ? String(item.key).trim() : "";
    if (!key || !key.startsWith(keyPrefix)) continue;
    const fileName = key.slice(keyPrefix.length);
    const pageNumber = parseChapterPageNumberFromFileName({
      fileName,
      expectedPageFilePrefix: normalizedFilePrefix
    });
    if (!Number.isFinite(pageNumber) || pageNumber <= safeKeepPages) continue;
    deleteKeys.push(key);
  }

  if (!deleteKeys.length) return 0;
  return deleteObjectsByKeys(deleteKeys);
}

function createUploadSession(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const payloadId = (safePayload.id || "").toString().trim();
  const id = payloadId || crypto.randomBytes(16).toString("hex");
  const now = Date.now();
  const session = {
    ...safePayload,
    id,
    uploadedPages: new Set(),
    createdAt: now,
    updatedAt: now
  };
  uploadSessions.set(id, session);
  return session;
}

function getOwnedUploadSession(sessionId, userId) {
  const safeSessionId = (sessionId || "").toString().trim();
  const safeUserId = (userId || "").toString().trim();
  if (!safeSessionId || !safeUserId) return null;
  const session = uploadSessions.get(safeSessionId);
  if (!session) return null;
  if (session.userId !== safeUserId) return null;
  return session;
}

function parseUploadSessionPageIndex(session, rawPageIndex) {
  const pageIndex = Math.floor(Number(rawPageIndex));
  if (!session) return { ok: false, error: "Upload session not found", statusCode: 404, pageIndex: 0 };
  if (!Number.isFinite(pageIndex) || pageIndex <= 0 || pageIndex > Number(session.totalPages || 0)) {
    return { ok: false, error: "Invalid pageIndex", statusCode: 400, pageIndex: 0 };
  }
  return { ok: true, pageIndex };
}

async function cleanupExpiredUploadSessions() {
  const now = Date.now();
  const sessions = Array.from(uploadSessions.values());
  for (const session of sessions) {
    if (!session || !session.id) continue;
    const updatedAt = Number(session.updatedAt || session.createdAt || 0);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue;
    if (now - updatedAt < UPLOAD_SESSION_TTL_MS) continue;
    uploadSessions.delete(session.id);
    if (session.tmpPrefix) {
      deleteAllByPrefix(session.tmpPrefix).catch(() => null);
    }
  }
}

async function ensureApiSchema() {
  await dbGet("SELECT 1 as ok");
  await dbAll(
    `
      CREATE TABLE IF NOT EXISTS user_api_keys (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        last_used_at BIGINT
      )
    `
  );
  await dbAll("ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS user_id TEXT");
  await dbAll("ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS key_hash TEXT");
  await dbAll("ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS key_prefix TEXT");
  await dbAll("ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbAll("ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS updated_at BIGINT");
  await dbAll("ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS last_used_at BIGINT");
  await dbAll("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_api_keys_hash ON user_api_keys(key_hash)");
  await dbAll("CREATE INDEX IF NOT EXISTS idx_user_api_keys_updated ON user_api_keys(updated_at DESC)");
}

const requireApiKey = async (req, res, next) => {
  try {
    const token = readApiKeyFromRequest(req);
    if (!token) {
      return jsonError(res, 401, "Missing API key");
    }

    const keyHash = hashApiKeyToken(token);
    if (!keyHash) {
      return jsonError(res, 401, "Invalid API key format");
    }

    const row = await dbGet(
      `
        SELECT
          u.id,
          u.email,
          u.username,
          u.display_name,
          u.avatar_url,
          u.created_at,
          k.key_prefix,
          k.last_used_at
        FROM user_api_keys k
        JOIN users u ON u.id = k.user_id
        WHERE k.key_hash = $1
        LIMIT 1
      `,
      [keyHash]
    );

    if (!row || !row.id) {
      return jsonError(res, 401, "API key invalid or revoked");
    }

    const userId = String(row.id).trim();
    const now = Date.now();
    const lastUsedAt = Number(row.last_used_at);
    if (!Number.isFinite(lastUsedAt) || now - lastUsedAt >= API_KEY_USAGE_TOUCH_INTERVAL_MS) {
      dbAll("UPDATE user_api_keys SET last_used_at = $1, updated_at = $2 WHERE user_id = $3", [
        now,
        now,
        userId
      ]).catch(() => null);
    }

    req.actor = {
      userId,
      email: row && row.email ? String(row.email).trim() : "",
      username: row && row.username ? String(row.username).trim() : "",
      displayName: row && row.display_name ? String(row.display_name).trim() : "",
      avatarUrl: row && row.avatar_url ? String(row.avatar_url).trim() : "",
      createdAt: row && row.created_at ? String(row.created_at) : "",
      keyPrefix: row && row.key_prefix ? String(row.key_prefix).trim() : "",
      keyLastUsedAt: Number.isFinite(lastUsedAt) && lastUsedAt > 0 ? Math.floor(lastUsedAt) : 0
    };
    return next();
  } catch (err) {
    console.error("[api_server] auth middleware failed", err);
    return jsonError(res, 500, "Auth failure");
  }
};

function parseRetryCount(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.floor(fallback));
  return Math.floor(parsed);
}

async function runWithRetry(fn, retries = 0) {
  const totalRetries = parseRetryCount(retries, 0);
  let lastError = null;
  for (let attempt = 0; attempt <= totalRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= totalRetries) break;
      await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
    }
  }
  throw lastError || new Error("Operation failed");
}

app.get("/health", async (_req, res) => {
  try {
    await dbGet("SELECT 1 as ok");
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Database unavailable" });
  }
});

app.get("/v1/bootstrap", requireApiKey, async (req, res) => {
  try {
    const memberships = await listApprovedMemberships(req.actor.userId);
    const badges = await listUserBadges(req.actor.userId);
    const manga = await listAuthorizedManga(memberships);

    return res.json({
      ok: true,
      account: {
        id: req.actor.userId,
        username: req.actor.username || "",
        displayName: req.actor.displayName || req.actor.username || req.actor.email || "User",
        email: req.actor.email || "",
        avatarUrl: buildWebAssetUrl(req.actor.avatarUrl || "", 0),
        keyPrefix: req.actor.keyPrefix || "",
        keyLastUsedAt: req.actor.keyLastUsedAt || 0,
        badges
      },
      memberships: memberships.map((member) => ({
        teamId: member.teamId,
        teamName: member.teamName,
        teamSlug: member.teamSlug,
        role: member.role,
        permissions: member.permissions
      })),
      manga
    });
  } catch (err) {
    console.error("[api_server] /v1/bootstrap failed", err);
    return jsonError(res, 500, "Failed to load bootstrap data");
  }
});

app.get("/v1/manga/:mangaId/chapters", requireApiKey, async (req, res) => {
  try {
    const access = await resolveAuthorizedManga({
      userId: req.actor.userId,
      mangaId: req.params.mangaId
    });
    if (!access.ok) {
      return jsonError(res, access.statusCode || 400, access.error || "Manga access denied");
    }

    const chapters = await dbAll(
      `
        SELECT
          id,
          number,
          title,
          pages,
          date,
          pages_prefix,
          pages_ext,
          pages_file_prefix,
          pages_updated_at
        FROM chapters
        WHERE manga_id = $1
        ORDER BY number ASC, id ASC
      `,
      [Number(access.manga.id)]
    );

    return res.json({
      ok: true,
      manga: {
        id: Number(access.manga.id) || 0,
        title: (access.manga.title || "").toString(),
        slug: (access.manga.slug || "").toString(),
        isOneshot: toBooleanFlag(access.manga.is_oneshot, false),
        permissions: access.permissions
      },
      chapters: chapters.map((chapter) => {
        const number = chapter && chapter.number != null ? Number(chapter.number) : NaN;
        return {
          id: chapter && chapter.id != null ? Number(chapter.id) || 0 : 0,
          number: Number.isFinite(number) ? number : null,
          numberText: Number.isFinite(number) ? formatChapterNumberValue(number) : "",
          title: chapter && chapter.title ? String(chapter.title).trim() : "",
          pages: chapter && chapter.pages != null ? Number(chapter.pages) || 0 : 0,
          date: chapter && chapter.date ? String(chapter.date) : "",
          pagesPrefix: chapter && chapter.pages_prefix ? String(chapter.pages_prefix).trim() : "",
          pagesExt: chapter && chapter.pages_ext ? String(chapter.pages_ext).trim() : "",
          pagesFilePrefix: normalizeChapterPageFilePrefix(
            chapter && chapter.pages_file_prefix ? String(chapter.pages_file_prefix) : ""
          ),
          pagesUpdatedAt: chapter && chapter.pages_updated_at != null ? Number(chapter.pages_updated_at) || 0 : 0
        };
      })
    });
  } catch (err) {
    console.error("[api_server] /v1/manga/:mangaId/chapters failed", err);
    return jsonError(res, 500, "Failed to load chapter list");
  }
});

app.post("/v1/chapter-drafts/:token/touch", async (req, res) => {
  try {
    const token = (req.params && req.params.token ? String(req.params.token) : "").trim();
    if (!isChapterDraftTokenValid(token)) {
      return jsonError(res, 404, "Draft token is invalid");
    }

    const proofCheck = verifyChapterDraftProof({ token, proof: readChapterDraftProof(req) });
    if (!proofCheck.ok) {
      return jsonError(res, proofCheck.statusCode || 401, proofCheck.error || "Draft proof is invalid");
    }

    const draft = await getActiveChapterDraftByToken(token);
    if (!draft) {
      return jsonError(res, 404, "Draft not found or expired");
    }

    const touched = await touchActiveChapterDraftByToken(token);
    if (!touched) {
      return jsonError(res, 404, "Draft not found or expired");
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[api_server] /v1/chapter-drafts/:token/touch failed", err);
    return jsonError(res, 500, "Failed to touch draft");
  }
});

app.post(
  "/v1/chapter-drafts/:token/pages/upload",
  (req, res, next) => {
    chapterDraftPageUploadMulter(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return jsonError(res, 400, "Page file exceeds 12MB");
        }
        return jsonError(res, 400, "Page upload failed");
      }
      return jsonError(res, 400, err && err.message ? String(err.message) : "Invalid page upload");
    });
  },
  async (req, res) => {
    try {
      const token = (req.params && req.params.token ? String(req.params.token) : "").trim();
      if (!isChapterDraftTokenValid(token)) {
        return jsonError(res, 404, "Draft token is invalid");
      }

      const proofCheck = verifyChapterDraftProof({ token, proof: readChapterDraftProof(req) });
      if (!proofCheck.ok) {
        return jsonError(res, proofCheck.statusCode || 401, proofCheck.error || "Draft proof is invalid");
      }

      const draft = await getActiveChapterDraftByToken(token);
      if (!draft) {
        return jsonError(res, 404, "Draft not found or expired");
      }

      const pageId = (req.query && req.query.id ? String(req.query.id) : req.body && req.body.id ? String(req.body.id) : "").trim();
      if (!isChapterDraftPageIdValid(pageId)) {
        return jsonError(res, 400, "Invalid page id");
      }

      if (!req.file || !req.file.buffer) {
        return jsonError(res, 400, "Missing page file");
      }

      const draftMangaId = Number(draft && draft.manga_id);
      if (!Number.isFinite(draftMangaId) || draftMangaId <= 0) {
        return jsonError(res, 500, "Draft manga id is invalid");
      }

      const isWebtoonManga = await isMangaTaggedWebtoon(draftMangaId);

      let webpBuffer = null;
      try {
        webpBuffer = await convertChapterPageToWebp(req.file.buffer, { isWebtoon: isWebtoonManga });
      } catch (_err) {
        return jsonError(res, 400, "Invalid image file");
      }
      if (!isLikelyWebpBuffer(webpBuffer)) {
        return jsonError(res, 400, "Failed to convert image to WebP");
      }

      const pagesPrefix = (draft && draft.pages_prefix ? String(draft.pages_prefix) : "").trim();
      if (!pagesPrefix) {
        return jsonError(res, 500, "Draft prefix is invalid");
      }

      const fileName = normalizeS3Key(`${pagesPrefix}/${pageId}.webp`);
      if (!fileName) {
        return jsonError(res, 500, "Draft file key is invalid");
      }

      const touchedBeforeUpload = await touchActiveChapterDraftByToken(token);
      if (!touchedBeforeUpload) {
        return jsonError(res, 404, "Draft not found or expired");
      }

      await runWithRetry(() => putWebpPage({ key: fileName, buffer: webpBuffer }), 2);

      const url = CHAPTER_CDN_BASE_URL ? `${CHAPTER_CDN_BASE_URL}/${fileName}` : "";
      return res.json({ ok: true, id: pageId, fileName, url });
    } catch (err) {
      console.error("[api_server] /v1/chapter-drafts/:token/pages/upload failed", err);
      return jsonError(res, 500, "Failed to upload draft page");
    }
  }
);

app.post("/v1/chapter-drafts/:token/pages/delete", async (req, res) => {
  try {
    const token = (req.params && req.params.token ? String(req.params.token) : "").trim();
    if (!isChapterDraftTokenValid(token)) {
      return jsonError(res, 404, "Draft token is invalid");
    }

    const proofCheck = verifyChapterDraftProof({ token, proof: readChapterDraftProof(req) });
    if (!proofCheck.ok) {
      return jsonError(res, proofCheck.statusCode || 401, proofCheck.error || "Draft proof is invalid");
    }

    const draft = await getActiveChapterDraftByToken(token);
    if (!draft) {
      return jsonError(res, 404, "Draft not found or expired");
    }

    const pageId = (req.body && req.body.id ? String(req.body.id) : req.query && req.query.id ? String(req.query.id) : "").trim();
    if (!isChapterDraftPageIdValid(pageId)) {
      return jsonError(res, 400, "Invalid page id");
    }

    const pagesPrefix = (draft && draft.pages_prefix ? String(draft.pages_prefix) : "").trim();
    if (!pagesPrefix) {
      return jsonError(res, 500, "Draft prefix is invalid");
    }

    const fileName = normalizeS3Key(`${pagesPrefix}/${pageId}.webp`);
    if (!fileName) {
      return jsonError(res, 500, "Draft file key is invalid");
    }

    const touchedBeforeDelete = await touchActiveChapterDraftByToken(token);
    if (!touchedBeforeDelete) {
      return jsonError(res, 404, "Draft not found or expired");
    }

    const deleted = await runWithRetry(() => deleteObjectsByKeys([fileName]), 1);
    return res.json({ ok: true, deleted });
  } catch (err) {
    console.error("[api_server] /v1/chapter-drafts/:token/pages/delete failed", err);
    return jsonError(res, 500, "Failed to delete draft page");
  }
});

app.post("/v1/uploads/start", requireApiKey, async (req, res) => {
  try {
    const access = await resolveAuthorizedManga({
      userId: req.actor.userId,
      mangaId: req.body && req.body.mangaId
    });
    if (!access.ok) {
      return jsonError(res, access.statusCode || 400, access.error || "Manga access denied");
    }

    const mangaId = Number(access.manga.id) || 0;
    const isWebtoonManga = await isMangaTaggedWebtoon(mangaId);
    const isOneshotManga = toBooleanFlag(access.manga.is_oneshot, false);
    const requestedChapterNumber = parseChapterNumberInput(req.body ? req.body.chapterNumber : null);
    const chapterNumber = isOneshotManga ? 0 : requestedChapterNumber;
    if (chapterNumber == null || chapterNumber < 0) {
      return jsonError(res, 400, "Invalid chapter number");
    }

    const chapterNumberText = formatChapterNumberValue(chapterNumber);
    if (!chapterNumberText) {
      return jsonError(res, 400, "Invalid chapter number");
    }

    const totalPages = Math.floor(Number(req.body && req.body.totalPages));
    if (!Number.isFinite(totalPages) || totalPages <= 0 || totalPages > CHAPTER_MAX_PAGES) {
      return jsonError(res, 400, "Invalid totalPages");
    }

    const overwrite = toBooleanFlag(req.body && req.body.overwrite, false);
    const title = (req.body && req.body.title ? String(req.body.title) : "").replace(/\s+/g, " ").trim();

    const existingChapter = await dbGet(
      `
        SELECT id, pages_prefix, pages_file_prefix
        FROM chapters
        WHERE manga_id = $1 AND number = $2
        LIMIT 1
      `,
      [mangaId, chapterNumber]
    );

    if (existingChapter) {
      if (!overwrite) {
        return jsonError(res, 409, "Chapter already exists", {
          exists: true,
          chapterId: Number(existingChapter.id) || 0
        });
      }
      if (!access.permissions.canEditChapter) {
        return jsonError(res, 403, "No permission to overwrite existing chapter");
      }
    } else {
      if (!access.permissions.canAddChapter) {
        return jsonError(res, 403, "No permission to add new chapter");
      }

      if (isOneshotManga) {
        const row = await dbGet("SELECT COUNT(*)::int as count FROM chapters WHERE manga_id = $1", [mangaId]);
        const chapterCount = row ? Number(row.count) || 0 : 0;
        if (chapterCount > 0) {
          return jsonError(res, 409, "Oneshot manga can only have one chapter", { exists: true });
        }
      }
    }

    const sessionId = crypto.randomBytes(16).toString("hex");
    const basePrefix = normalizeS3Key(`${S3_CHAPTER_PREFIX}/manga-${mangaId}`);
    const canonicalPrefix = normalizeS3Key(`${basePrefix}/ch-${chapterNumberText}`);
    const targetPrefix =
      existingChapter && existingChapter.pages_prefix
        ? normalizeS3Key(`${basePrefix}/ch-${chapterNumberText}-${sessionId.slice(0, 8)}`)
        : canonicalPrefix;
    const tmpPrefix = normalizeS3Key(`${S3_CHAPTER_PREFIX}/tmp/desktop/manga-${mangaId}/session-${sessionId}`);
    const padLength = Math.max(3, Math.min(6, String(totalPages).length));
    const existingPageFilePrefix = normalizeChapterPageFilePrefix(
      existingChapter && existingChapter.pages_file_prefix ? String(existingChapter.pages_file_prefix) : ""
    );
    const targetPageFilePrefix = existingChapter ? existingPageFilePrefix : buildRandomChapterPageFilePrefix();

    const session = createUploadSession({
      id: sessionId,
      userId: req.actor.userId,
      mangaId,
      mangaTitle: (access.manga.title || "").toString(),
      chapterNumber,
      chapterNumberText,
      title,
      overwrite,
      totalPages,
      padLength,
      groupName:
        (access.manga.group_name || "").toString().trim() ||
        (access.manga.author || "").toString().trim() ||
        "",
      isOneshot: isOneshotManga,
      existingChapterId: existingChapter && existingChapter.id ? Number(existingChapter.id) || 0 : 0,
      existingPrefix:
        existingChapter && existingChapter.pages_prefix ? String(existingChapter.pages_prefix).trim() : "",
      pageFilePrefix: targetPageFilePrefix,
      targetPrefix,
      tmpPrefix
    });

    return res.json({
      ok: true,
      sessionId: session.id,
      mangaId,
      isWebtoonManga,
      chapterNumber,
      chapterNumberText,
      totalPages,
      overwrite,
      exists: Boolean(existingChapter),
      targetPrefix: session.targetPrefix,
      pageFilePrefix: session.pageFilePrefix,
      pagesFilePrefix: session.pageFilePrefix,
      tmpPrefix: session.tmpPrefix
    });
  } catch (err) {
    console.error("[api_server] /v1/uploads/start failed", err);
    return jsonError(res, 500, "Failed to start upload session");
  }
});

app.post("/v1/uploads/:sessionId/pages", requireApiKey, (_req, res) => {
  return jsonError(res, 410, "Direct relay upload is disabled. Use presigned upload flow.");
});

app.post("/v1/uploads/:sessionId/pages/presign", requireApiKey, async (req, res) => {
  try {
    const session = getOwnedUploadSession(req.params.sessionId, req.actor.userId);
    const pageParse = parseUploadSessionPageIndex(session, req.body && req.body.pageIndex);
    if (!pageParse.ok) {
      return jsonError(res, pageParse.statusCode || 400, pageParse.error || "Invalid pageIndex");
    }
    const pageIndex = pageParse.pageIndex;

    const objectKey = buildUploadSessionTmpPageKey({ session, pageIndex });
    if (!objectKey) {
      return jsonError(res, 500, "Invalid upload target key");
    }

    const requestedExpiresIn = Math.floor(Number(req.body && req.body.expiresIn));
    const expiresIn = Number.isFinite(requestedExpiresIn) && requestedExpiresIn > 0
      ? Math.max(60, Math.min(3600, requestedExpiresIn))
      : UPLOAD_PAGE_PRESIGN_EXPIRES_SECONDS;

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: objectKey,
        ContentType: "image/webp"
      }),
      { expiresIn }
    );

    session.updatedAt = Date.now();

    return res.json({
      ok: true,
      pageIndex,
      totalPages: session.totalPages,
      uploadedPages: session.uploadedPages.size,
      uploadUrl,
      method: "PUT",
      headers: {
        "Content-Type": "image/webp"
      },
      expiresIn,
      key: objectKey
    });
  } catch (err) {
    console.error("[api_server] /v1/uploads/:sessionId/pages/presign failed", err);
    return jsonError(res, 500, "Failed to create page upload URL");
  }
});

app.post("/v1/uploads/:sessionId/pages/ack", requireApiKey, async (req, res) => {
  try {
    const session = getOwnedUploadSession(req.params.sessionId, req.actor.userId);
    const pageParse = parseUploadSessionPageIndex(session, req.body && req.body.pageIndex);
    if (!pageParse.ok) {
      return jsonError(res, pageParse.statusCode || 400, pageParse.error || "Invalid pageIndex");
    }

    const pageIndex = pageParse.pageIndex;

    const objectKey = buildUploadSessionTmpPageKey({ session, pageIndex });
    if (!objectKey) {
      return jsonError(res, 500, "Invalid upload target key");
    }

    const objectHead = await runWithRetry(() => headS3Object(objectKey), 1);
    const objectSize = Number(objectHead && objectHead.ContentLength);
    if (!Number.isFinite(objectSize) || objectSize <= 0) {
      return jsonError(res, 409, "Uploaded page object is missing or empty", {
        pageIndex
      });
    }

    const objectContentType = (objectHead && objectHead.ContentType ? String(objectHead.ContentType) : "").toLowerCase();
    if (!objectContentType.startsWith("image/webp")) {
      return jsonError(res, 409, "Uploaded page object has invalid content type", {
        pageIndex,
        contentType: objectContentType
      });
    }

    const expectedEtag = normalizeS3Etag(req.body && req.body.etag ? req.body.etag : "");
    const actualEtag = normalizeS3Etag(objectHead && objectHead.ETag ? objectHead.ETag : "");
    if (expectedEtag && actualEtag && expectedEtag !== actualEtag) {
      return jsonError(res, 409, "Uploaded page ETag does not match", {
        pageIndex
      });
    }

    session.uploadedPages.add(pageIndex);
    session.updatedAt = Date.now();

    return res.json({
      ok: true,
      pageIndex,
      totalPages: session.totalPages,
      uploadedPages: session.uploadedPages.size
    });
  } catch (err) {
    console.error("[api_server] /v1/uploads/:sessionId/pages/ack failed", err);
    return jsonError(res, 500, "Failed to acknowledge uploaded page");
  }
});

app.post("/v1/uploads/:sessionId/complete", requireApiKey, async (req, res) => {
  const session = getOwnedUploadSession(req.params.sessionId, req.actor.userId);
  if (!session) {
    return jsonError(res, 404, "Upload session not found");
  }

  try {
    for (let index = 1; index <= session.totalPages; index += 1) {
      if (!session.uploadedPages.has(index)) {
        return jsonError(res, 409, "Not all pages have been uploaded", {
          missingPageIndex: index
        });
      }
    }

    for (let index = 1; index <= session.totalPages; index += 1) {
      const sourcePageName = `${String(index).padStart(session.padLength, "0")}.webp`;
      const destinationPageName = buildChapterPageFileName({
        pageNumber: index,
        padLength: session.padLength,
        extension: "webp",
        pageFilePrefix: session.pageFilePrefix
      });
      const sourceKey = normalizeS3Key(`${session.tmpPrefix}/${sourcePageName}`);
      const destinationKey = normalizeS3Key(`${session.targetPrefix}/${destinationPageName}`);
      await runWithRetry(() => copyS3Object({ sourceKey, destinationKey }), 2);
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const result = await withTransaction(async (client) => {
      let chapterId = 0;
      let createdNewChapter = false;
      if (session.existingChapterId > 0) {
        await client.query(
          `
            UPDATE chapters
            SET
              title = $1,
              pages = $2,
              date = $3,
              group_name = $4,
              pages_prefix = $5,
              pages_ext = 'webp',
              pages_file_prefix = $6,
              pages_updated_at = $7,
              is_oneshot = $8,
              processing_state = NULL,
              processing_error = NULL,
              processing_draft_token = NULL,
              processing_pages_json = NULL,
              processing_updated_at = NULL
            WHERE id = $9
          `,
          [
            session.title,
            session.totalPages,
            nowIso,
            session.groupName,
            session.targetPrefix,
            session.pageFilePrefix || null,
            nowMs,
            session.isOneshot,
            session.existingChapterId
          ]
        );
        chapterId = session.existingChapterId;
      } else {
        const insertResult = await client.query(
          `
            INSERT INTO chapters (
              manga_id,
              number,
              title,
              pages,
              date,
              group_name,
              pages_prefix,
              pages_ext,
              pages_file_prefix,
              pages_updated_at,
              is_oneshot,
              processing_state,
              processing_error,
              processing_draft_token,
              processing_pages_json,
              processing_updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'webp', $8, $9, $10, NULL, NULL, NULL, NULL, NULL)
            RETURNING id
          `,
          [
            session.mangaId,
            session.chapterNumber,
            session.title,
            session.totalPages,
            nowIso,
            session.groupName,
            session.targetPrefix,
            session.pageFilePrefix || null,
            nowMs,
            session.isOneshot
          ]
        );
        chapterId =
          insertResult && Array.isArray(insertResult.rows) && insertResult.rows[0] && insertResult.rows[0].id != null
            ? Number(insertResult.rows[0].id) || 0
            : 0;
        createdNewChapter = chapterId > 0;
      }

      await client.query("UPDATE manga SET updated_at = $1 WHERE id = $2", [nowIso, session.mangaId]);

      return {
        chapterId,
        createdNewChapter,
        pagesPrefix: session.targetPrefix,
        pages: session.totalPages,
        pagesFilePrefix: session.pageFilePrefix || ""
      };
    });

    if (result && result.createdNewChapter) {
      notifyBookmarkedUsersForNewChapter({
        mangaId: session.mangaId,
        chapterNumber: session.chapterNumber,
        createdAtMs: nowMs
      }).catch((err) => {
        console.warn("[api_server] failed to notify bookmarked users for new chapter", {
          mangaId: session.mangaId,
          chapterNumber: session.chapterNumber,
          error: err && err.message ? err.message : "unknown"
        });
      });
    }

    await deleteChapterExtraPages({
      prefix: session.targetPrefix,
      keepPages: session.totalPages,
      pageFilePrefix: session.pageFilePrefix
    }).catch(() => null);

    if (session.existingPrefix && session.existingPrefix !== session.targetPrefix) {
      deleteAllByPrefix(session.existingPrefix).catch(() => null);
    }

    deleteAllByPrefix(session.tmpPrefix).catch(() => null);
    uploadSessions.delete(session.id);

    return res.json({
      ok: true,
      chapter: {
        id: result.chapterId,
        mangaId: session.mangaId,
        number: session.chapterNumber,
        numberText: session.chapterNumberText,
        title: session.title,
        pages: result.pages,
        pagesPrefix: result.pagesPrefix,
        pagesExt: "webp",
        pagesFilePrefix: result.pagesFilePrefix || "",
        pageFilePrefix: result.pagesFilePrefix || ""
      }
    });
  } catch (err) {
    console.error("[api_server] /v1/uploads/:sessionId/complete failed", err);
    if (session.targetPrefix && session.targetPrefix !== session.existingPrefix) {
      deleteAllByPrefix(session.targetPrefix).catch(() => null);
    }
    return jsonError(res, 500, "Failed to finalize chapter upload");
  }
});

app.delete("/v1/uploads/:sessionId", requireApiKey, async (req, res) => {
  try {
    const session = getOwnedUploadSession(req.params.sessionId, req.actor.userId);
    if (!session) {
      return res.json({ ok: true });
    }

    uploadSessions.delete(session.id);
    if (session.tmpPrefix) {
      await deleteAllByPrefix(session.tmpPrefix).catch(() => null);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[api_server] DELETE /v1/uploads/:sessionId failed", err);
    return jsonError(res, 500, "Failed to cancel upload session");
  }
});

app.use((err, _req, res, _next) => {
  console.error("[api_server] unhandled route error", err);
  return jsonError(res, 500, "Internal server error");
});

const start = async () => {
  await ensureApiSchema();
  const server = app.listen(PORT, () => {
    console.log(`[api_server] listening on http://127.0.0.1:${PORT}`);
  });

  const cleanupTimer = setInterval(() => {
    cleanupExpiredUploadSessions().catch(() => null);
  }, UPLOAD_SESSION_CLEANUP_INTERVAL_MS);
  if (cleanupTimer && typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }

  const shutdown = async () => {
    console.log("[api_server] shutting down");
    server.close(() => {
      pool.end().catch(() => null);
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

start().catch((err) => {
  console.error("[api_server] failed to start", err);
  process.exit(1);
});
