const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const compression = require("compression");
const CleanCSS = require("clean-css");
const { minify: minifyJs } = require("terser");
const { Pool, types } = require("pg");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const OAuth2Strategy = require("passport-oauth2").Strategy;
const multer = require("multer");
const sharp = require("sharp");
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
  CopyObjectCommand
} = require("@aws-sdk/client-s3");

const registerSiteRoutes = require("./src/routes/site-routes");
const registerNewsRoutes = require("./src/routes/news-routes");
const registerAdminAndEngagementRoutes = require("./src/routes/admin-and-engagement-routes");
const registerEngagementRoutes = require("./src/routes/engagement-routes");
const registerForumApiRoutes = require("./src/routes/forum-api-routes");
const createStorageDomain = require("./src/domains/storage-domain");
const createMangaDomain = require("./src/domains/manga-domain");
const createSecuritySessionDomain = require("./src/domains/security-session-domain");
const createAuthUserDomain = require("./src/domains/auth-user-domain");
const createMentionNotificationDomain = require("./src/domains/mention-notification-domain");
const createInitDbDomain = require("./src/domains/init-db-domain");
const configureCoreRuntime = require("./src/app/configure-core-runtime");
const { parseEnvBoolean } = require("./src/utils/env");
const viewCoverHelpers = require("./src/utils/view-cover-helpers");
const { loadSiteConfig } = require("./src/config/site-config");
require("dotenv").config();

const app = express();
app.locals.coverHelpers = viewCoverHelpers;
app.locals.isNewsPageEnabled = false;
app.locals.newsPageEnabled = false;
app.locals.isForumPageEnabled = false;
app.locals.forumPageEnabled = false;
const PORT = process.env.PORT || 3000;
const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || "development")
  .toString()
  .trim()
  .toLowerCase();
const isProductionApp = appEnv === "production" || appEnv === "prod";
const siteConfig = loadSiteConfig(path.join(__dirname, "config.json"));
const siteBrandingConfig = siteConfig.branding || {};
const siteSeoConfig = siteConfig.seo || {};
const serverAssetVersion = Date.now();
const serverSessionVersion = String(serverAssetVersion);
const cssMinifier = new CleanCSS({ level: 1, inline: false });
const forumDistIndexPath = path.join(__dirname, "sampleforum", "dist", "index.html");
const isForumFrontendAvailable = fs.existsSync(forumDistIndexPath);

const isJsMinifyEnabled = parseEnvBoolean(process.env.JS_MINIFY_ENABLED, true);
const isNewsPageEnabled = parseEnvBoolean(process.env.NEWS_PAGE_ENABLED, true);
const isForumPageEnabled = parseEnvBoolean(process.env.FORUM_PAGE_ENABLED, false);
const isForumPageAvailable = isForumPageEnabled && isForumFrontendAvailable;
const trustProxy = parseEnvBoolean(process.env.TRUST_PROXY, false);
app.locals.isForumPageEnabled = isForumPageEnabled;
app.locals.isForumPageAvailable = isForumPageAvailable;
app.locals.isNewsPageEnabled = isNewsPageEnabled;
app.locals.newsPageEnabled = isNewsPageEnabled;
app.locals.forumPageEnabled = isForumPageAvailable;

const isTruthyInput = (value) => {
  const raw = (value == null ? "" : String(value)).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const safeCompareText = (leftValue, rightValue) => {
  const left = Buffer.from((leftValue == null ? "" : String(leftValue)).trim());
  const right = Buffer.from((rightValue == null ? "" : String(rightValue)).trim());
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const SEO_SITE_NAME = siteBrandingConfig.siteName || "BFANG Team";
const SEO_DEFAULT_DESCRIPTION =
  siteSeoConfig.defaultDescription || `${SEO_SITE_NAME} - nhóm dịch truyện tranh`;
const SEO_DEFAULT_KEYWORDS = [
  "đọc truyện tranh online",
  "manga tiếng Việt",
  "truyện tranh mới cập nhật",
  "đọc manga miễn phí",
  "truyện tranh hot",
  "manga full chapter",
  "truyện tranh hành động",
  "truyện tranh romance",
  "truyện tranh drama",
  "nhóm dịch truyện tranh",
  SEO_SITE_NAME
];
const SEO_ROBOTS_INDEX = "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";
const SEO_ROBOTS_NOINDEX =
  "noindex,nofollow,noarchive,nosnippet,noimageindex,max-snippet:0,max-image-preview:none,max-video-preview:0";
const FORUM_DEFAULT_SOCIAL_IMAGE_PATH = "/logobfang.svg";
const sitemapCacheTtlMs = 10 * 60 * 1000;
const sitemapCacheByOrigin = new Map();

const normalizeSiteOriginFromEnv = (value) => {
  const raw = (value || "").toString().trim();
  if (!raw) return "";

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_err) {
    return "";
  }
};

const appDomainFromEnv = (process.env.APP_DOMAIN || "").toString().trim();
const appDomainOrigin = normalizeSiteOriginFromEnv(
  appDomainFromEnv
    ? /^https?:\/\//i.test(appDomainFromEnv)
      ? appDomainFromEnv
      : `${isProductionApp ? "https" : "http"}://${appDomainFromEnv}`
    : ""
);

const configuredPublicOrigin = normalizeSiteOriginFromEnv(
  process.env.SITE_URL || process.env.PUBLIC_SITE_URL || appDomainOrigin
);
const localDevOrigin = `http://localhost:${PORT}`;

const normalizeSeoText = (value, maxLength) => {
  const cleaned = (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const safeMax = Number.isFinite(Number(maxLength)) ? Math.max(16, Math.floor(Number(maxLength))) : 0;
  if (!safeMax || cleaned.length <= safeMax) return cleaned;
  return `${cleaned.slice(0, safeMax - 1).trim()}...`;
};

const normalizeSeoKeywords = (value, options = {}) => {
  const maxItems = Number.isFinite(Number(options.maxItems)) ? Math.max(1, Math.floor(Number(options.maxItems))) : 18;
  const maxTokenLength = Number.isFinite(Number(options.maxTokenLength))
    ? Math.max(8, Math.floor(Number(options.maxTokenLength)))
    : 72;
  const rawValues = Array.isArray(value)
    ? value
    : (value == null ? "" : String(value))
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const seen = new Set();
  const normalized = [];

  rawValues.forEach((item) => {
    const token = normalizeSeoText(item, maxTokenLength);
    if (!token) return;
    const key = token.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(token);
  });

  return normalized.slice(0, maxItems);
};

const getPublicOriginFromRequest = (req) => {
  if (configuredPublicOrigin) return configuredPublicOrigin;
  if (!req) return isProductionApp ? "" : localDevOrigin;

  const canUseForwardedHeaders = Boolean(trustProxy || app.get("trust proxy"));
  const forwardedHost = canUseForwardedHeaders
    ? (req.get("x-forwarded-host") || "").toString().split(",")[0].trim()
    : "";
  const host = forwardedHost || (req.get("host") || "").toString().split(",")[0].trim();
  if (!host) return "";

  const forwardedProto = canUseForwardedHeaders
    ? (req.get("x-forwarded-proto") || "").toString().split(",")[0].trim()
    : "";
  const protocol = (forwardedProto || req.protocol || "http").toLowerCase() === "https" ? "https" : "http";
  return `${protocol}://${host}`;
};

const ensureLeadingSlash = (value) => {
  const raw = (value || "").toString().trim();
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
};

const toAbsolutePublicUrl = (req, value) => {
  const raw = (value || "").toString().trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;

  const withSlash = ensureLeadingSlash(raw);
  const origin = getPublicOriginFromRequest(req);
  return origin ? `${origin}${withSlash}` : withSlash;
};

const escapeXml = (value) =>
  (value == null ? "" : String(value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

const toIsoDate = (value) => {
  if (value == null || value === "") return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value > 1e12 ? value : value * 1000);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
};

const buildSeoPayload = (req, options = {}) => {
  const pathValue = ensureLeadingSlash(options.canonicalPath || req.path || "/");
  const canonical = toAbsolutePublicUrl(req, options.canonical || pathValue);
  const ampHtml = toAbsolutePublicUrl(req, options.ampHtml || "");
  const title = normalizeSeoText(options.title || "", 140);
  const description = normalizeSeoText(options.description || SEO_DEFAULT_DESCRIPTION, 190);
  const keywordList = normalizeSeoKeywords(
    options.keywords == null ? SEO_DEFAULT_KEYWORDS : options.keywords
  );
  const robots = normalizeSeoText(options.robots || SEO_ROBOTS_INDEX, 220) || SEO_ROBOTS_INDEX;
  const ogType = normalizeSeoText(options.ogType || "website", 30) || "website";
  const image = toAbsolutePublicUrl(req, options.image || "");
  const twitterCard = image ? "summary_large_image" : "summary";
  const jsonLdList = Array.isArray(options.jsonLd)
    ? options.jsonLd.filter((item) => item && typeof item === "object")
    : [];

  return {
    siteName: SEO_SITE_NAME,
    title,
    description,
    keywords: keywordList.join(", "),
    keywordList,
    canonical,
    ampHtml,
    robots,
    ogType,
    image,
    twitterCard,
    jsonLd: jsonLdList
  };
};

if (trustProxy) {
  app.set("trust proxy", 1);
}
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), gyroscope=(), magnetometer=()"
  );
  res.set("Cross-Origin-Opener-Policy", "same-origin");
  next();
});
const uploadDir = path.join(__dirname, "uploads");
const coversDir = path.join(uploadDir, "covers");
const coversTmpDir = path.join(coversDir, "tmp");
const avatarsDir = path.join(uploadDir, "avatars");
const publicDir = path.join(__dirname, "public");
const stickersDir = path.join(publicDir, "stickers");

const DATABASE_URL = (process.env.DATABASE_URL || "").toString().trim();
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL chưa được cấu hình trong .env");
}

const NEWS_DATABASE_URL = (process.env.NEWS_DATABASE_URL || "").toString().trim();
const NEWS_DATABASE_NAME = (process.env.NEWS_DATABASE_NAME || "").toString().trim();

const buildDatabaseUrlWithDatabaseName = (databaseUrl, databaseName) => {
  const baseUrl = (databaseUrl || "").toString().trim();
  const targetDatabase = (databaseName || "").toString().trim();
  if (!baseUrl || !targetDatabase) return "";

  try {
    const parsed = new URL(baseUrl);
    parsed.pathname = `/${targetDatabase.replace(/^\/+/, "")}`;
    return parsed.toString();
  } catch (_error) {
    return "";
  }
};

const resolvedNewsDatabaseUrl = NEWS_DATABASE_URL || buildDatabaseUrlWithDatabaseName(DATABASE_URL, NEWS_DATABASE_NAME);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(coversDir)) {
  fs.mkdirSync(coversDir, { recursive: true });
}

if (!fs.existsSync(coversTmpDir)) {
  fs.mkdirSync(coversTmpDir, { recursive: true });
}

if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

// pg: by default it returns int8/numeric as strings. We parse them into numbers for
// compatibility with the existing SQLite-based code.
types.setTypeParser(20, (value) => (value == null ? null : Number.parseInt(value, 10))); // int8
types.setTypeParser(1700, (value) => (value == null ? null : Number.parseFloat(value))); // numeric

const pgPool = new Pool({
  connectionString: DATABASE_URL
});

const newsPgPool = resolvedNewsDatabaseUrl
  ? new Pool({
    connectionString: resolvedNewsDatabaseUrl
  })
  : null;
const isNewsDatabaseConfigured = Boolean(newsPgPool);

if (!newsPgPool) {
  console.warn("NEWS_DATABASE_URL/NEWS_DATABASE_NAME chưa cấu hình; mục Tin tức sẽ tạm ẩn dữ liệu.");
}

const toPgQuery = (sql, params) => {
  const text = (sql || "").toString();
  if (!Array.isArray(params) || params.length === 0) {
    return { text, values: [] };
  }

  let index = 0;
  const converted = text.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
  return { text: converted, values: params };
};

const maybeAddReturningId = (sql) => {
  const text = (sql || "").toString();
  const trimmed = text.trim();
  const compact = trimmed.replace(/\s+/g, " ");
  if (!/^insert\s+into\s+(manga|chapters|genres|comments|forum_posts|translation_teams|chat_threads|chat_messages)\b/i.test(compact)) {
    return { sql: text, wantsId: false };
  }
  if (/\breturning\b/i.test(compact)) {
    return { sql: text, wantsId: true };
  }
  const withoutSemi = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
  return { sql: `${withoutSemi} RETURNING id`, wantsId: true };
};

const dbQuery = async (sql, params = [], client = null) => {
  const payload = toPgQuery(sql, params);
  const executor = client || pgPool;
  return executor.query(payload.text, payload.values);
};

const dbRun = async (sql, params = [], client = null) => {
  const { sql: finalSql, wantsId } = maybeAddReturningId(sql);
  const result = await dbQuery(finalSql, params, client);
  const changes = typeof result.rowCount === "number" ? result.rowCount : 0;
  const lastID = wantsId && result.rows && result.rows[0] ? result.rows[0].id : undefined;
  return { changes, lastID, rows: result.rows || [] };
};

const dbGet = async (sql, params = [], client = null) => {
  const rows = await dbAll(sql, params, client);
  return rows && rows.length ? rows[0] : null;
};

const dbAll = async (sql, params = [], client = null) => {
  const result = await dbQuery(sql, params, client);
  return result.rows || [];
};

const newsDbQuery = async (sql, params = [], client = null) => {
  if (!newsPgPool) {
    throw new Error("News database is not configured.");
  }
  const payload = toPgQuery(sql, params);
  const executor = client || newsPgPool;
  return executor.query(payload.text, payload.values);
};

const newsDbAll = async (sql, params = [], client = null) => {
  const result = await newsDbQuery(sql, params, client);
  return result.rows || [];
};

const newsDbGet = async (sql, params = [], client = null) => {
  const rows = await newsDbAll(sql, params, client);
  return rows && rows.length ? rows[0] : null;
};

const withTransaction = async (fn) => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const api = {
      dbRun: (sql, params) => dbRun(sql, params, client),
      dbGet: (sql, params) => dbGet(sql, params, client),
      dbAll: (sql, params) => dbAll(sql, params, client)
    };
    const result = await fn(api);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackErr) {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
};

const sessionTableName = "web_sessions";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const sessionStoreCleanupIntervalMs = 6 * 60 * 60 * 1000;

const resolveSessionExpiryMs = (sessionPayload, fallbackTtlMs = sessionTtlMs) => {
  const fallback = Date.now() + Math.max(60 * 1000, Number(fallbackTtlMs) || sessionTtlMs);
  const payload = sessionPayload && typeof sessionPayload === "object" ? sessionPayload : {};
  const cookie = payload.cookie && typeof payload.cookie === "object" ? payload.cookie : {};

  const expiresRaw = cookie.expires;
  if (expiresRaw) {
    const expiresAt = new Date(expiresRaw).getTime();
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
      return Math.floor(expiresAt);
    }
  }

  const maxAgeRaw = Number(cookie.maxAge);
  if (Number.isFinite(maxAgeRaw) && maxAgeRaw > 0) {
    return Date.now() + Math.floor(maxAgeRaw);
  }

  return Math.floor(fallback);
};

class PgSessionStore extends session.Store {
  constructor({ pool, tableName }) {
    super();
    this.pool = pool;
    this.tableName = (tableName || sessionTableName).toString().trim() || sessionTableName;
  }

  get(sid, callback) {
    const done = typeof callback === "function" ? callback : () => {};
    const sessionId = (sid || "").toString().trim();
    if (!sessionId) {
      done(null, null);
      return;
    }

    this.pool
      .query(
        `SELECT sess FROM ${this.tableName} WHERE sid = $1 AND expire_at > $2 LIMIT 1`,
        [sessionId, Date.now()]
      )
      .then((result) => {
        const row = result && result.rows && result.rows[0] ? result.rows[0] : null;
        if (!row || !row.sess) {
          done(null, null);
          return;
        }

        try {
          done(null, JSON.parse(String(row.sess)));
        } catch (_err) {
          this.destroy(sessionId, () => done(null, null));
        }
      })
      .catch((error) => {
        done(error);
      });
  }

  set(sid, sessionPayload, callback) {
    const done = typeof callback === "function" ? callback : () => {};
    const sessionId = (sid || "").toString().trim();
    if (!sessionId) {
      done(new Error("Invalid session id"));
      return;
    }

    let serialized = "{}";
    try {
      serialized = JSON.stringify(sessionPayload || {});
    } catch (error) {
      done(error);
      return;
    }

    const expireAt = resolveSessionExpiryMs(sessionPayload, sessionTtlMs);
    const now = Date.now();
    this.pool
      .query(
        `
          INSERT INTO ${this.tableName} (sid, sess, expire_at, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (sid)
          DO UPDATE SET
            sess = EXCLUDED.sess,
            expire_at = EXCLUDED.expire_at,
            updated_at = EXCLUDED.updated_at
        `,
        [sessionId, serialized, expireAt, now]
      )
      .then(() => done(null))
      .catch((error) => done(error));
  }

  touch(sid, sessionPayload, callback) {
    const done = typeof callback === "function" ? callback : () => {};
    const sessionId = (sid || "").toString().trim();
    if (!sessionId) {
      done(null);
      return;
    }

    const expireAt = resolveSessionExpiryMs(sessionPayload, sessionTtlMs);
    this.pool
      .query(
        `UPDATE ${this.tableName} SET expire_at = $2, updated_at = $3 WHERE sid = $1`,
        [sessionId, expireAt, Date.now()]
      )
      .then(() => done(null))
      .catch((error) => done(error));
  }

  destroy(sid, callback) {
    const done = typeof callback === "function" ? callback : () => {};
    const sessionId = (sid || "").toString().trim();
    if (!sessionId) {
      done(null);
      return;
    }

    this.pool
      .query(`DELETE FROM ${this.tableName} WHERE sid = $1`, [sessionId])
      .then(() => done(null))
      .catch((error) => done(error));
  }

  async pruneExpired() {
    await this.pool.query(`DELETE FROM ${this.tableName} WHERE expire_at <= $1`, [Date.now()]);
  }
}

const sessionStore = new PgSessionStore({
  pool: pgPool,
  tableName: sessionTableName
});

const scheduleSessionStoreCleanup = () => {
  const run = async () => {
    try {
      await sessionStore.pruneExpired();
    } catch (error) {
      console.warn("Session store cleanup failed", error);
    }
  };

  run();
  const timer = setInterval(run, sessionStoreCleanupIntervalMs);
  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }
};

const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.mimetype)) {
      return cb(new Error("Chỉ hỗ trợ ảnh JPG (.jpg), PNG (.png), WebP (.webp)."));
    }
    return cb(null, true);
  }
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.mimetype)) {
      return cb(new Error("Chỉ hỗ trợ ảnh JPG (.jpg), PNG (.png), WebP (.webp)."));
    }
    return cb(null, true);
  }
});

const TEAM_MEDIA_AVATAR_MAX_SIZE = 2 * 1024 * 1024;
const TEAM_MEDIA_COVER_MAX_SIZE = 5 * 1024 * 1024;

const teamMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: TEAM_MEDIA_COVER_MAX_SIZE,
    files: 2
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.mimetype)) {
      return cb(new Error("Chỉ hỗ trợ ảnh JPG (.jpg), PNG (.png), WebP (.webp)."));
    }
    return cb(null, true);
  }
});

const chapterPagesUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024,
    files: 220
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.mimetype)) {
      return cb(new Error("Chỉ hỗ trợ ảnh JPG (.jpg), PNG (.png), WebP (.webp)."));
    }
    return cb(null, true);
  }
});

const uploadCover = (req, res, next) => {
  coverUpload.single("cover")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).send("Ảnh bìa tối đa 5MB.");
      }
      return res.status(400).send("Upload ảnh bìa thất bại.");
    }
    return res.status(400).send(err.message || "Upload ảnh bìa thất bại.");
  });
};

const uploadAvatar = (req, res, next) => {
  avatarUpload.single("avatar")(req, res, (err) => {
    if (!err) return next();
    const respondError = (statusCode, jsonMessage, textMessage) => {
      if (typeof wantsJson === "function" && wantsJson(req)) {
        return res.status(statusCode).json({ ok: false, error: jsonMessage });
      }
      return res.status(statusCode).send(textMessage || jsonMessage);
    };
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return respondError(400, "Avatar tối đa 2MB.", "Avatar tối đa 2MB.");
      }
      return respondError(400, "Upload avatar thất bại.", "Upload avatar thất bại.");
    }
    const message = err.message || "Upload avatar thất bại.";
    return respondError(400, message, message);
  });
};

const uploadTeamMedia = (req, res, next) => {
  teamMediaUpload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "cover", maxCount: 1 }
  ])(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).send("Ảnh tải lên tối đa 5MB.");
      }
      return res.status(400).send("Upload ảnh nhóm dịch thất bại.");
    }
    if (err) {
      return res.status(400).send(err.message || "Upload ảnh nhóm dịch thất bại.");
    }

    const files = req.files && typeof req.files === "object" ? req.files : {};
    const avatarFile = Array.isArray(files.avatar) ? files.avatar[0] : null;
    if (avatarFile && avatarFile.buffer && avatarFile.buffer.length > TEAM_MEDIA_AVATAR_MAX_SIZE) {
      return res.status(400).send("Avatar tối đa 2MB.");
    }

    const coverFile = Array.isArray(files.cover) ? files.cover[0] : null;
    if (coverFile && coverFile.buffer && coverFile.buffer.length > TEAM_MEDIA_COVER_MAX_SIZE) {
      return res.status(400).send("Ảnh bìa tối đa 5MB.");
    }

    return next();
  });
};

const uploadChapterPages = (req, res, next) => {
  chapterPagesUpload.array("pages", 220)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).send("Ảnh trang tối đa 12MB mỗi file.");
      }
      if (err.code === "LIMIT_FILE_COUNT") {
        return res.status(400).send("Số lượng ảnh trang quá nhiều.");
      }
      return res.status(400).send("Upload ảnh trang thất bại.");
    }
    return res.status(400).send(err.message || "Upload ảnh trang thất bại.");
  });
};

const uploadChapterPage = (req, res, next) => {
  chapterPagesUpload.single("page")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).send("Ảnh trang tối đa 12MB mỗi file.");
      }
      return res.status(400).send("Upload ảnh trang thất bại.");
    }
    return res.status(400).send(err.message || "Upload ảnh trang thất bại.");
  });
};

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
};

const formatDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
};

const formatTimeAgo = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.max(Math.floor(diffMs / 1000), 0);

  if (diffSeconds < 60) return "Vừa xong";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} phút trước`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} ngày trước`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} tháng trước`;
  const diffYears = Math.floor(diffMonths / 12);
  return `${diffYears} năm trước`;
};

const cacheBust = (url, token) => {
  if (!url) return "";
  const separator = url.includes("?") ? "&" : "?";
  const value = token == null || token === "" ? Date.now() : token;
  return `${url}${separator}t=${encodeURIComponent(String(value))}`;
};

const parseChapterNumberInput = (value) => {
  const raw = value == null ? "" : String(value);
  const text = raw.trim();
  if (!text) return null;
  const normalized = text.replace(/,/g, ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  return number;
};

const resolvePaginationParams = ({
  pageInput,
  perPageInput,
  defaultPerPage = 20,
  maxPerPage = 60,
  totalCount = 0
}) => {
  const safeDefaultPerPage = Math.max(1, Math.floor(Number(defaultPerPage) || 20));
  const safeMaxPerPage = Math.max(safeDefaultPerPage, Math.floor(Number(maxPerPage) || safeDefaultPerPage));

  const requestedPage = Number(pageInput);
  const requestedPerPage = Number(perPageInput);

  const perPage = Number.isFinite(requestedPerPage) && requestedPerPage > 0
    ? Math.max(1, Math.min(safeMaxPerPage, Math.floor(requestedPerPage)))
    : safeDefaultPerPage;

  const total = Number.isFinite(Number(totalCount)) ? Math.max(0, Math.floor(Number(totalCount))) : 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Number.isFinite(requestedPage) && requestedPage > 0
    ? Math.min(Math.floor(requestedPage), totalPages)
    : 1;
  const offset = (page - 1) * perPage;

  return {
    page,
    perPage,
    total,
    totalPages,
    offset,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    prevPage: page > 1 ? page - 1 : 1,
    nextPage: page < totalPages ? page + 1 : totalPages
  };
};

const toBooleanFlag = (value) => {
  if (value === true || value === false) return value;
  if (typeof value === "number") return value !== 0;
  const text = (value == null ? "" : String(value)).trim().toLowerCase();
  if (!text) return false;
  return text === "1" || text === "true" || text === "t" || text === "yes" || text === "y" || text === "on";
};

const COMMENT_MAX_LENGTH = 500;
const FORUM_COMMENT_MIN_LENGTH = 3;
const FORUM_POST_MIN_LENGTH = 100;
const FORUM_POST_TITLE_MIN_LENGTH = 5;
const COMMENT_MENTION_FETCH_LIMIT = 3;
const COMMENT_POST_COOLDOWN_MS = 10 * 1000;
const FORUM_REPLY_COOLDOWN_MS = 30 * 1000;
const FORUM_POST_COOLDOWN_MS = 15 * 60 * 1000;
const COMMENT_DUPLICATE_CONTENT_WINDOW_MS = 30 * 1000;
const COMMENT_REQUEST_ID_MAX_LENGTH = 80;
const COMMENT_LINK_LABEL_FETCH_LIMIT = 40;
const COMMENT_BOT_SIGNAL_WINDOW_MS = 2 * 60 * 1000;
const COMMENT_BOT_SIGNAL_THRESHOLD = 3;
const COMMENT_BOT_CHALLENGE_TTL_MS = 15 * 60 * 1000;
const NOTIFICATION_TYPE_MENTION = "mention";
const NOTIFICATION_TYPE_MANGA_BOOKMARK_NEW_CHAPTER = "manga_bookmark_new_chapter";
const FORUM_COMMENT_REQUEST_PREFIX = "forum-";
const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const NOTIFICATION_CLEANUP_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;
const NOTIFICATION_STREAM_HEARTBEAT_MS = 25 * 1000;
const ADMIN_MEMBERS_PER_PAGE = 16;
const FORBIDDEN_WORD_MAX_LENGTH = 80;
const READING_HISTORY_MAX_ITEMS = 10;
const ONESHOT_GENRE_NAME = "Oneshot";
const notificationStreamClientsByUserId = new Map();

const formatChapterNumberValue = (value) => {
  const chapterNumber = Number(value);
  if (!Number.isFinite(chapterNumber)) return "";

  const normalized = Math.abs(chapterNumber) < 1e-9 ? 0 : chapterNumber;
  if (Math.abs(normalized - Math.round(normalized)) < 1e-9) {
    return String(Math.round(normalized));
  }
  return normalized.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
};

const buildCommentChapterContext = ({ chapterNumber, chapterTitle, chapterIsOneshot }) => {
  const chapterValue = chapterNumber == null ? NaN : Number(chapterNumber);
  const title = (chapterTitle || "").toString().replace(/\s+/g, " ").trim();
  const isOneshot = toBooleanFlag(chapterIsOneshot);
  if (!Number.isFinite(chapterValue)) {
    if (isOneshot) {
      const oneshotLabel = title ? `Oneshot - ${title}` : "Oneshot";
      return {
        chapterNumber: null,
        chapterNumberText: "",
        chapterTitle: title,
        chapterIsOneshot: true,
        chapterLabel: oneshotLabel
      };
    }
    return {
      chapterNumber: null,
      chapterNumberText: "",
      chapterTitle: title,
      chapterIsOneshot: false,
      chapterLabel: ""
    };
  }

  const chapterNumberText = formatChapterNumberValue(chapterValue);
  const baseLabel = isOneshot ? "Oneshot" : chapterNumberText ? `Chương ${chapterNumberText}` : "Chương";

  return {
    chapterNumber: chapterValue,
    chapterNumberText,
    chapterTitle: title,
    chapterIsOneshot: isOneshot,
    chapterLabel: title ? `${baseLabel} - ${title}` : baseLabel
  };
};

const commentRequestIdPattern = /^[a-z0-9][a-z0-9._:-]{7,79}$/i;

const readCommentRequestId = (req) => {
  const headerValue = (req.get("idempotency-key") || req.get("x-comment-request-id") || "")
    .toString()
    .trim();
  const bodyValue = (req && req.body && req.body.requestId != null ? req.body.requestId : "")
    .toString()
    .trim();
  const candidate = headerValue || bodyValue;
  if (!candidate) return "";
  if (candidate.length > COMMENT_REQUEST_ID_MAX_LENGTH) return "";
  if (!commentRequestIdPattern.test(candidate)) return "";
  return candidate;
};

const sendCommentRequestIdInvalidResponse = (req, res) => {
  const message = "Yêu cầu bình luận không hợp lệ. Vui lòng tải lại trang rồi thử lại.";
  if (wantsJson(req)) {
    return res.status(400).json({
      error: message,
      code: "COMMENT_REQUEST_ID_INVALID"
    });
  }
  return res.status(400).send(message);
};

const isDuplicateCommentRequestError = (error) => {
  if (!error || error.code !== "23505") return false;
  const constraint = (error.constraint || "").toString().trim().toLowerCase();
  if (constraint === "idx_comments_author_request_id" || constraint === "idx_forum_posts_author_request_id") {
    return true;
  }

  const message = (error.message || "").toString().toLowerCase();
  return (
    message.includes("idx_comments_author_request_id") ||
    message.includes("idx_forum_posts_author_request_id") ||
    message.includes("author_user_id, client_request_id")
  );
};

const sendDuplicateCommentRequestResponse = (req, res) => {
  const message = "Yêu cầu này đã được gửi trước đó. Vui lòng không gửi lặp lại.";
  if (wantsJson(req)) {
    return res.status(409).json({
      error: message,
      code: "COMMENT_REQUEST_REPLAYED"
    });
  }
  return res.status(409).send(message);
};

const commentBotSignalStore = new Map();

const isCommentTurnstileEnabled = () =>
  Boolean(turnstileConfig && turnstileConfig.siteKey && turnstileConfig.secretKey);

const parseCommentCreatedAtMs = (value) => {
  if (value == null || value === "") return NaN;
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
};

const calculateRetryAfterSecondsForWindow = ({ lastCreatedAt, nowMs, windowMs }) => {
  const lastCreatedAtMs = parseCommentCreatedAtMs(lastCreatedAt);
  const safeNowMs = Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
  const ttlMs = Math.max(1000, Number(windowMs) || 0);
  if (!Number.isFinite(lastCreatedAtMs) || !ttlMs) return 0;

  const retryAfterMs = ttlMs - (safeNowMs - lastCreatedAtMs);
  if (retryAfterMs <= 0) return 0;
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
};

const calculateCommentRetryAfterSeconds = ({ lastCreatedAt, nowMs }) =>
  calculateRetryAfterSecondsForWindow({
    lastCreatedAt,
    nowMs,
    windowMs: COMMENT_POST_COOLDOWN_MS
  });

const normalizeCommentContentForDuplicateCheck = (value) =>
  (value == null ? "" : String(value))
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const buildCommentCooldownMessage = (retryAfterSeconds) => {
  const seconds = Number.isFinite(Number(retryAfterSeconds))
    ? Math.max(1, Math.floor(Number(retryAfterSeconds)))
    : 1;
  return `Bạn thao tác quá nhanh, vui lòng chờ ${seconds} giây rồi thử lại.`;
};

const sendCommentCooldownResponse = (req, res, retryAfterSeconds) => {
  const retryAfter = Number.isFinite(Number(retryAfterSeconds))
    ? Math.max(1, Math.floor(Number(retryAfterSeconds)))
    : 1;
  const message = buildCommentCooldownMessage(retryAfter);

  res.set("Retry-After", String(retryAfter));
  if (wantsJson(req)) {
    return res.status(429).json({
      error: message,
      code: "COMMENT_RATE_LIMITED",
      retryAfter
    });
  }

  return res.status(429).send(message);
};

const createCommentCooldownError = (retryAfterSeconds) => {
  const error = new Error("COMMENT_RATE_LIMITED");
  error.code = "COMMENT_RATE_LIMITED";
  error.retryAfterSeconds = Number.isFinite(Number(retryAfterSeconds))
    ? Math.max(1, Math.floor(Number(retryAfterSeconds)))
    : 1;
  return error;
};

const buildCommentDuplicateContentMessage = (retryAfterSeconds) => {
  const seconds = Number.isFinite(Number(retryAfterSeconds))
    ? Math.max(1, Math.floor(Number(retryAfterSeconds)))
    : 1;
  return `Bạn vừa gửi nội dung trùng. Vui lòng chờ ${seconds} giây hoặc chỉnh sửa nội dung rồi thử lại.`;
};

const sendCommentDuplicateContentResponse = (req, res, retryAfterSeconds) => {
  const retryAfter = Number.isFinite(Number(retryAfterSeconds))
    ? Math.max(1, Math.floor(Number(retryAfterSeconds)))
    : 1;
  const message = buildCommentDuplicateContentMessage(retryAfter);

  res.set("Retry-After", String(retryAfter));
  if (wantsJson(req)) {
    return res.status(429).json({
      error: message,
      code: "COMMENT_DUPLICATE_CONTENT",
      retryAfter
    });
  }

  return res.status(429).send(message);
};

const createCommentDuplicateContentError = (retryAfterSeconds) => {
  const error = new Error("COMMENT_DUPLICATE_CONTENT");
  error.code = "COMMENT_DUPLICATE_CONTENT";
  error.retryAfterSeconds = Number.isFinite(Number(retryAfterSeconds))
    ? Math.max(1, Math.floor(Number(retryAfterSeconds)))
    : 1;
  return error;
};

const ensureCommentPostCooldown = async ({
  userId,
  nowMs,
  dbGet,
  dbRun,
  cooldownMs,
  rootOnly,
  replyOnly,
}) => {
  const normalizedUserId = (userId || "").toString().trim();
  if (!normalizedUserId) return;

  if (typeof dbRun === "function") {
    await dbRun("SELECT pg_advisory_xact_lock(hashtext(?), 0)", [`comment-post:${normalizedUserId}`]);
  }

  const readOne = typeof dbGet === "function" ? dbGet : null;
  if (!readOne) return;

  const whereParts = ["author_user_id = ?"];
  if (replyOnly === true) {
    whereParts.push("parent_id IS NOT NULL");
  } else if (rootOnly === true) {
    whereParts.push("parent_id IS NULL");
  }

  const commentWhereClause = whereParts.join(" AND ");
  const forumWhereClause = commentWhereClause.replace(/\bauthor_user_id\b/g, "fp.author_user_id").replace(/\bparent_id\b/g, "fp.parent_id");

  const latestComment = await readOne(
    `
      SELECT created_at
      FROM (
        SELECT c.created_at, c.id
        FROM comments c
        WHERE ${commentWhereClause.replace(/\bauthor_user_id\b/g, "c.author_user_id").replace(/\bparent_id\b/g, "c.parent_id")}

        UNION ALL

        SELECT fp.created_at, fp.id
        FROM forum_posts fp
        WHERE ${forumWhereClause}
      ) recent
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [normalizedUserId, normalizedUserId]
  );

  const safeWindowMs = Number.isFinite(Number(cooldownMs)) && Number(cooldownMs) > 0
    ? Math.floor(Number(cooldownMs))
    : COMMENT_POST_COOLDOWN_MS;
  const retryAfterSeconds = calculateRetryAfterSecondsForWindow({
    lastCreatedAt: latestComment && latestComment.created_at ? latestComment.created_at : null,
    nowMs,
    windowMs: safeWindowMs,
  });
  if (retryAfterSeconds > 0) {
    throw createCommentCooldownError(retryAfterSeconds);
  }
};

const ensureCommentNotDuplicateRecently = async ({ userId, content, nowMs, dbAll }) => {
  const normalizedUserId = (userId || "").toString().trim();
  if (!normalizedUserId) return;

  const normalizedContent = normalizeCommentContentForDuplicateCheck(content);
  if (!normalizedContent) return;

  const safeNowMs = Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
  const windowStartIso = new Date(safeNowMs - COMMENT_DUPLICATE_CONTENT_WINDOW_MS).toISOString();
  const readMany = typeof dbAll === "function" ? dbAll : null;
  if (!readMany) return;

  const recentRows = await readMany(
    `
      SELECT created_at, content, id
      FROM (
        SELECT c.created_at, c.content, c.id
        FROM comments c
        WHERE c.author_user_id = ?
          AND c.created_at >= ?

        UNION ALL

        SELECT fp.created_at, fp.content, fp.id
        FROM forum_posts fp
        WHERE fp.author_user_id = ?
          AND fp.created_at >= ?
      ) recent
      ORDER BY created_at DESC, id DESC
      LIMIT 12
    `,
    [normalizedUserId, windowStartIso, normalizedUserId, windowStartIso]
  );

  for (const row of recentRows || []) {
    const previousContent = normalizeCommentContentForDuplicateCheck(row && row.content ? row.content : "");
    if (!previousContent || previousContent !== normalizedContent) continue;

    const retryAfterSeconds = calculateRetryAfterSecondsForWindow({
      lastCreatedAt: row && row.created_at ? row.created_at : null,
      nowMs: safeNowMs,
      windowMs: COMMENT_DUPLICATE_CONTENT_WINDOW_MS
    });
    throw createCommentDuplicateContentError(Math.max(1, retryAfterSeconds || 1));
  }
};

const pruneCommentBotSignalStore = (nowMs) => {
  const safeNowMs = Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
  for (const [userId, entry] of commentBotSignalStore.entries()) {
    const timestamps = Array.isArray(entry && entry.timestamps)
      ? entry.timestamps.filter(
        (value) => Number.isFinite(value) && safeNowMs - value <= COMMENT_BOT_SIGNAL_WINDOW_MS
      )
      : [];
    const challengeUntil = Number.isFinite(entry && entry.challengeUntil)
      ? Math.floor(entry.challengeUntil)
      : 0;
    if (!timestamps.length && safeNowMs >= challengeUntil) {
      commentBotSignalStore.delete(userId);
      continue;
    }
    commentBotSignalStore.set(userId, {
      timestamps,
      challengeUntil
    });
  }
};

const registerCommentBotSignal = ({ userId, nowMs }) => {
  if (!isCommentTurnstileEnabled()) return;

  const normalizedUserId = (userId || "").toString().trim();
  if (!normalizedUserId) return;

  const safeNowMs = Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
  if (commentBotSignalStore.size > 5000) {
    pruneCommentBotSignalStore(safeNowMs);
  }

  const existing = commentBotSignalStore.get(normalizedUserId);
  const timestamps = Array.isArray(existing && existing.timestamps)
    ? existing.timestamps.filter(
      (value) => Number.isFinite(value) && safeNowMs - value <= COMMENT_BOT_SIGNAL_WINDOW_MS
    )
    : [];
  timestamps.push(safeNowMs);

  let challengeUntil = Number.isFinite(existing && existing.challengeUntil)
    ? Math.floor(existing.challengeUntil)
    : 0;
  if (timestamps.length >= COMMENT_BOT_SIGNAL_THRESHOLD) {
    challengeUntil = Math.max(challengeUntil, safeNowMs + COMMENT_BOT_CHALLENGE_TTL_MS);
    timestamps.length = 0;
  }

  commentBotSignalStore.set(normalizedUserId, {
    timestamps,
    challengeUntil
  });
};

const shouldRequireCommentTurnstile = ({ userId, nowMs }) => {
  if (!isCommentTurnstileEnabled()) return false;

  const normalizedUserId = (userId || "").toString().trim();
  if (!normalizedUserId) return false;

  const safeNowMs = Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
  const existing = commentBotSignalStore.get(normalizedUserId);
  if (!existing) return false;

  const challengeUntil = Number.isFinite(existing.challengeUntil) ? Math.floor(existing.challengeUntil) : 0;
  if (safeNowMs < challengeUntil) {
    return true;
  }

  commentBotSignalStore.delete(normalizedUserId);
  return false;
};

const clearCommentBotSignals = (userId) => {
  const normalizedUserId = (userId || "").toString().trim();
  if (!normalizedUserId) return;
  commentBotSignalStore.delete(normalizedUserId);
};

const readCommentTurnstileToken = (req) => {
  const bodyToken = (req && req.body && req.body.turnstileToken != null ? req.body.turnstileToken : "")
    .toString()
    .trim();
  const fallbackBodyToken =
    (req && req.body && req.body["cf-turnstile-response"] != null
      ? req.body["cf-turnstile-response"]
      : "")
      .toString()
      .trim();
  const headerToken = (req.get("cf-turnstile-response") || "").toString().trim();
  const token = bodyToken || fallbackBodyToken || headerToken;
  if (!token) return "";
  if (token.length > 4096) return "";
  if (/\s/.test(token)) return "";
  return token;
};

const buildCommentTurnstileMessage = () =>
  "Hệ thống cần xác minh bạn không phải robot trước khi tiếp tục bình luận.";

const sendCommentTurnstileRequiredResponse = (req, res, message) => {
  const text = (message || buildCommentTurnstileMessage()).toString().trim() || buildCommentTurnstileMessage();
  if (wantsJson(req)) {
    return res.status(403).json({
      error: text,
      code: "TURNSTILE_REQUIRED",
      turnstileSiteKey: turnstilePublicConfig.siteKey
    });
  }
  return res.status(403).send(text);
};

const verifyCommentTurnstileToken = async ({ token, remoteIp, requestId }) => {
  if (!isCommentTurnstileEnabled()) {
    return { success: true, errorCodes: [] };
  }

  const responseToken = (token || "").toString().trim();
  if (!responseToken) {
    return { success: false, errorCodes: ["missing-input-response"] };
  }

  const params = new URLSearchParams();
  params.set("secret", turnstileConfig.secretKey);
  params.set("response", responseToken);
  const remoteIpText = (remoteIp || "").toString().trim();
  if (remoteIpText) {
    params.set("remoteip", remoteIpText);
  }
  const safeRequestId = (requestId || "").toString().trim();
  if (safeRequestId) {
    params.set("idempotency_key", safeRequestId);
  }

  try {
    const response = await fetch(turnstileConfig.verifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: params
    });

    const payload = await response.json().catch(() => null);
    const success = Boolean(response.ok && payload && payload.success === true);
    const errorCodes = Array.isArray(payload && payload["error-codes"])
      ? payload["error-codes"].map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    return { success, errorCodes };
  } catch (error) {
    console.warn("Turnstile verification request failed", error);
    return { success: false, errorCodes: ["internal-error"] };
  }
};

const ensureCommentTurnstileIfSuspicious = async ({ req, res, userId, nowMs, requestId }) => {
  if (!shouldRequireCommentTurnstile({ userId, nowMs })) {
    return true;
  }

  const token = readCommentTurnstileToken(req);
  if (!token) {
    sendCommentTurnstileRequiredResponse(req, res);
    return false;
  }

  const verification = await verifyCommentTurnstileToken({
    token,
    remoteIp: req.ip || req.socket?.remoteAddress || "",
    requestId
  });
  if (!verification.success) {
    registerCommentBotSignal({ userId, nowMs });
    sendCommentTurnstileRequiredResponse(req, res, "Xác minh bảo mật thất bại. Vui lòng thử lại.");
    return false;
  }

  clearCommentBotSignals(userId);
  return true;
};

const buildChapterTimestampIso = (dateInput) => {
  const now = new Date();
  const raw = dateInput == null ? "" : String(dateInput).trim();
  if (!raw) {
    return now.toISOString();
  }

  // Accept full ISO inputs as-is.
  if (raw.includes("T")) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return now.toISOString();
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
    return now.toISOString();
  }

  const local = new Date(
    year,
    monthIndex,
    day,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );
  if (Number.isNaN(local.getTime())) {
    return now.toISOString();
  }
  return local.toISOString();
};

const slugify = (value) => {
  if (!value) return "";
  return value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
};

const buildMangaSlug = (mangaId, title) => {
  const id = Number(mangaId);
  const base = slugify(title) || "manga";
  if (!Number.isFinite(id) || id <= 0) return base;
  return `${Math.floor(id)}-${base}`;
};

const coversUrlPrefix = "/uploads/covers/";

const extractLocalCoverFilename = (coverUrl) => {
  if (!coverUrl || typeof coverUrl !== "string") return "";
  if (!coverUrl.startsWith(coversUrlPrefix)) return "";
  return coverUrl.slice(coversUrlPrefix.length).split("?")[0].split("#")[0].trim();
};

const deleteFileIfExists = async (filePath) => {
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
};

const buildCoverFilename = (mangaId, title) => `${buildMangaSlug(mangaId, title)}.webp`;

const saveCoverBuffer = async (filename, buffer) => {
  if (!filename || !buffer) return;
  const filePath = path.join(coversDir, filename);
  await deleteFileIfExists(filePath);
  await fs.promises.writeFile(filePath, buffer);
};

const coverTempTokenPattern = /^[a-f0-9]{32}$/;

const createCoverTempToken = () => crypto.randomBytes(16).toString("hex");

const getCoverTempFilePath = (token) => path.join(coversTmpDir, `${token}.webp`);

const isCoverTempTokenValid = (token) => coverTempTokenPattern.test(token || "");

const saveCoverTempBuffer = async (token, buffer) => {
  if (!isCoverTempTokenValid(token) || !buffer) return;
  const filePath = getCoverTempFilePath(token);
  await deleteFileIfExists(filePath);
  await fs.promises.writeFile(filePath, buffer);
};

const loadCoverTempBuffer = async (token) => {
  if (!isCoverTempTokenValid(token)) return null;
  const filePath = getCoverTempFilePath(token);
  try {
    return await fs.promises.readFile(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
};

const deleteCoverTemp = async (token) => {
  if (!isCoverTempTokenValid(token)) return;
  await deleteFileIfExists(getCoverTempFilePath(token));
};

const coverTempTtlMs = 3 * 60 * 60 * 1000;
const coverTempCleanupIntervalMs = 8 * 60 * 60 * 1000;

const cleanupCoverTemps = async () => {
  let entries = [];
  try {
    entries = await fs.promises.readdir(coversTmpDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return 0;
    throw err;
  }

  const now = Date.now();
  let deleted = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".webp")) continue;
    const token = entry.name.slice(0, -5);
    if (!isCoverTempTokenValid(token)) continue;

    const filePath = path.join(coversTmpDir, entry.name);
    let stat = null;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }

    const ageMs = now - Number(stat.mtimeMs || 0);
    if (ageMs <= coverTempTtlMs) continue;
    await deleteFileIfExists(filePath);
    deleted += 1;
  }

  return deleted;
};

const scheduleCoverTempCleanup = () => {
  const run = async () => {
    try {
      await cleanupCoverTemps();
    } catch (err) {
      console.warn("Cover temp cleanup failed", err);
    }
  };

  run();
  const timer = setInterval(run, coverTempCleanupIntervalMs);
  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }
};

const coverMaxBytes = 300 * 1024;

const convertCoverToWebp = async (inputBuffer) => {
  if (!inputBuffer) return null;

  const qualitySteps = [82, 76, 70, 64, 58, 52, 46, 40, 34, 28, 22, 16];
  const maxEdgeSteps = [1600, 1400, 1200, 1000, 850, 700, 600, 520, 450, 380];

  for (const maxEdge of maxEdgeSteps) {
    for (const quality of qualitySteps) {
      const output = await sharp(inputBuffer)
        .rotate()
        .resize({
          width: maxEdge,
          height: maxEdge,
          fit: "inside",
          withoutEnlargement: true
        })
        .webp({ quality, effort: 6 })
        .toBuffer();

      if (output.length <= coverMaxBytes) {
        return output;
      }
    }
  }

  throw new Error("Ảnh bìa sau khi nén vẫn vượt quá 300KB. Vui lòng chọn ảnh nhỏ hơn.");
};

const normalizeBaseUrl = (value) => {
  const trimmed = (value || "").toString().trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
};

const normalizeAbsoluteHttpUrl = (value) => {
  const raw = (value || "").toString().trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    const pathname = parsed.pathname || "/";
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search || ""}${parsed.hash || ""}`;
  } catch (_err) {
    return "";
  }
};

const normalizePathPrefix = (value) =>
  (value || "").toString().trim().replace(/^\/+/, "").replace(/\/+$/, "");

const oauthConfig = {
  callbackBase: normalizeSiteOriginFromEnv(
    process.env.OAUTH_CALLBACK_BASE_URL || process.env.PUBLIC_SITE_URL || process.env.SITE_URL || ""
  ),
  google: {
    clientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").trim()
  },
  discord: {
    clientId: (process.env.DISCORD_CLIENT_ID || "").trim(),
    clientSecret: (process.env.DISCORD_CLIENT_SECRET || "").trim()
  }
};

const isOauthProviderEnabled = (providerKey) => {
  const provider = oauthConfig && oauthConfig[providerKey] ? oauthConfig[providerKey] : null;
  return Boolean(provider && provider.clientId && provider.clientSecret);
};

const resolveOAuthCallbackBase = (req) => {
  if (oauthConfig.callbackBase) return oauthConfig.callbackBase;
  return getPublicOriginFromRequest(req) || "";
};

const buildOAuthCallbackUrl = (req, providerKey) => {
  const provider = (providerKey || "").toString().trim().toLowerCase();
  if (!provider) return "";
  const base = resolveOAuthCallbackBase(req);
  if (!base) return "";
  return `${base}/auth/${provider}/callback`;
};

const getAuthPublicConfigForRequest = (_req) => ({
  providers: {
    google: isOauthProviderEnabled("google"),
    discord: isOauthProviderEnabled("discord")
  },
  sessionVersion: serverSessionVersion
});

app.locals.authPublicConfig = getAuthPublicConfigForRequest(null);
app.locals.newsPageEnabled = isNewsPageEnabled;
app.locals.forumPageEnabled = isForumPageEnabled;

if (!isOauthProviderEnabled("google")) {
  console.warn("Google OAuth chưa cấu hình đủ GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.");
}

if (!isOauthProviderEnabled("discord")) {
  console.warn("Discord OAuth chưa cấu hình đủ DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET.");
}

const AUTH_GOOGLE_STRATEGY = "bfang-google";
const AUTH_DISCORD_STRATEGY = "bfang-discord";

const normalizeForumOnlyNextPath = (value, fallback = "") => {
  const raw = (value || "").toString().trim();
  if (!raw || raw.length > 300) return (fallback || "").toString().trim();

  let parsed = null;
  try {
    parsed = new URL(raw, "http://localhost");
  } catch (_err) {
    return (fallback || "").toString().trim();
  }

  if (parsed.origin !== "http://localhost") return (fallback || "").toString().trim();
  const pathname = parsed.pathname || "/";
  if (!pathname.startsWith("/")) return (fallback || "").toString().trim();
  if (!pathname.startsWith("/forum")) return (fallback || "").toString().trim();
  if (/^\/auth\//i.test(pathname)) return (fallback || "").toString().trim();
  const safe = `${pathname}${parsed.search || ""}`;
  return safe || (fallback || "").toString().trim();
};

const normalizeNextPath = (value) => {
  const raw = (value || "").toString().trim();
  if (!raw || raw.length > 300) return "/";

  let parsed = null;
  try {
    parsed = new URL(raw, "http://localhost");
  } catch (_err) {
    return "/";
  }

  if (parsed.origin !== "http://localhost") return "/";
  const pathname = parsed.pathname || "/";
  if (!pathname.startsWith("/")) return "/";
  if (/^\/auth\//i.test(pathname)) return "/";
  if (/^\/admin\/login/i.test(pathname)) {
    const nextTarget = normalizeForumOnlyNextPath(parsed.searchParams.get("next") || "", "");
    if (nextTarget) {
      const params = new URLSearchParams();
      params.set("next", nextTarget);
      const fallbackTarget = normalizeForumOnlyNextPath(parsed.searchParams.get("fallback") || "", "/forum");
      if (fallbackTarget) {
        params.set("fallback", fallbackTarget);
      }
      return `/admin?${params.toString()}`;
    }
    return "/admin";
  }
  const safe = `${pathname}${parsed.search || ""}`;
  return safe || "/";
};

const readAuthNextPath = (req) => {
  const queryNext = req && req.query && typeof req.query.next === "string" ? req.query.next : "";
  const sessionNext = req && req.session && typeof req.session.authNextPath === "string"
    ? req.session.authNextPath
    : "";
  const resolved = normalizeNextPath(queryNext || sessionNext || "/");
  if (req && req.session) {
    delete req.session.authNextPath;
  }
  return resolved;
};

if (isOauthProviderEnabled("google")) {
  passport.use(
    AUTH_GOOGLE_STRATEGY,
    new GoogleStrategy(
      {
        clientID: oauthConfig.google.clientId,
        clientSecret: oauthConfig.google.clientSecret,
        passReqToCallback: false,
        state: true
      },
      (accessToken, _refreshToken, profile, done) => {
        try {
          const payload = readGoogleProfileData(profile);
          if (!payload.providerUserId) {
            return done(new Error("Google profile không hợp lệ."));
          }
          return done(null, payload);
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

if (isOauthProviderEnabled("discord")) {
  passport.use(
    AUTH_DISCORD_STRATEGY,
    new OAuth2Strategy(
      {
        authorizationURL: "https://discord.com/api/oauth2/authorize",
        tokenURL: "https://discord.com/api/oauth2/token",
        clientID: oauthConfig.discord.clientId,
        clientSecret: oauthConfig.discord.clientSecret,
        scope: ["identify", "email"],
        passReqToCallback: false,
        state: true
      },
      async (accessToken, _refreshToken, params, profileIgnored, done) => {
        try {
          const response = await fetch("https://discord.com/api/users/@me", {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          });
          if (!response.ok) {
            return done(new Error("Không thể lấy thông tin người dùng Discord."));
          }

          const payloadRaw = await response.json().catch(() => null);
          const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
          const displayName = payload.global_name || payload.username || "";
          const avatarHash = payload.avatar ? String(payload.avatar) : "";
          const discordId = payload.id ? String(payload.id) : "";
          const avatarUrl =
            avatarHash && discordId
              ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(discordId)}/${encodeURIComponent(avatarHash)}.png`
              : "";
          const data = extractDiscordProfileData(
            {
              id: discordId,
              displayName,
              _raw: JSON.stringify(payload),
              emails: payload.email ? [{ value: payload.email }] : [],
              photos: avatarUrl ? [{ value: avatarUrl }] : []
            },
            accessToken
          );
          if (!data.providerUserId) {
            return done(new Error("Discord profile không hợp lệ."));
          }
          return done(null, data);
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

const turnstileConfig = {
  siteKey: (process.env.TURNSTILE_SITE_KEY || "").trim(),
  secretKey: (process.env.TURNSTILE_SECRET_KEY || "").trim(),
  verifyUrl: "https://challenges.cloudflare.com/turnstile/v0/siteverify"
};

const turnstilePublicConfig = {
  siteKey: turnstileConfig.siteKey
};

app.locals.turnstilePublicConfig = turnstilePublicConfig;

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
  sharp,
});
const {
  adminJobs,
  adminJobsQueue,
  adminJobsRunning,
  b2CopyFile,
  b2DeleteAllByPrefix,
  b2DeleteChapterExtraPages,
  b2DeleteFileVersions,
  b2ListFileNamesByPrefix,
  b2ListFileVersionsByPrefix,
  b2UploadBuffer,
  buildB2DirPrefix,
  buildChapterDraftPrefix,
  buildChapterExistingPageId,
  chapterDraftCleanupIntervalMs,
  chapterDraftPageIdPattern,
  chapterDraftTokenPattern,
  chapterDraftTtlMs,
  chapterPageMaxHeight,
  chapterPageWebpQuality,
  chapterProcessingQueue,
  chapterProcessingQueued,
  chapterProcessingRunning,
  cleanupChapterDrafts,
  clearChapterProcessing,
  convertChapterPageToWebp,
  createAdminJob,
  createAdminJobId,
  createChapterDraft,
  createChapterDraftToken,
  deleteChapterAndCleanupStorage,
  deleteChapterDraftRow,
  deleteMangaAndCleanupStorage,
  encodeS3CopySource,
  enqueueChapterProcessing,
  getB2Config,
  getChapterDraft,
  getStorageClient,
  isB2Ready,
  isChapterDraftPageIdValid,
  isChapterDraftTokenValid,
  isStorageVersionListingUnsupported,
  normalizeAdminJobError,
  normalizeB2FileKey,
  normalizeJsonString,
  parseChapterPageNumberFromFileName,
  parseJsonArrayOfStrings,
  pruneAdminJobs,
  resumeChapterProcessingJobs,
  runAdminJobsQueue,
  runChapterProcessingJob,
  runChapterProcessingQueue,
  scheduleChapterDraftCleanup,
  storageClientCache,
  touchChapterDraft,
  updateChapterProcessing,
} = storageDomain;
const mangaDomain = createMangaDomain({
  FORBIDDEN_WORD_MAX_LENGTH,
  ONESHOT_GENRE_NAME,
  buildChapterTimestampIso,
  buildMangaSlug,
  dbAll,
  dbGet,
  dbRun,
});
const {
  censorCommentContentByForbiddenWords,
  escapeRegexPattern,
  findGenreRowByNormalizedName,
  forbiddenWordsCache,
  forbiddenWordsCacheTtlMs,
  getForbiddenWords,
  getGenreStats,
  getGenresStringByIds,
  getOneshotGenreId,
  getOrCreateGenreId,
  invalidateForbiddenWordsCache,
  markMangaUpdatedAtForNewChapter,
  migrateLegacyGenres,
  migrateMangaSlugs,
  migrateMangaStatuses,
  normalizeForbiddenWord,
  normalizeForbiddenWordList,
  normalizeGenreList,
  normalizeGenreName,
  normalizeGenresString,
  normalizeIdList,
  parseGenres,
  setMangaGenresByIds,
  setMangaGenresByNames,
} = mangaDomain;
const mapCommentRow = (row, session) => {
  const liked = Boolean(row && row.liked_by_me);
  const reported = Boolean(row && row.reported_by_me);
  const avatarUrl = normalizeAvatarUrl(row && row.author_avatar_url ? row.author_avatar_url : "");
  const authorUserId = row && row.author_user_id ? String(row.author_user_id).trim() : "";

  const rawBadges = row && row.author_badges_json != null ? row.author_badges_json : null;
  let badges = [];
  if (Array.isArray(rawBadges)) {
    badges = rawBadges;
  } else if (typeof rawBadges === "string") {
    try {
      const parsed = JSON.parse(rawBadges);
      if (Array.isArray(parsed)) {
        badges = parsed;
      }
    } catch (_err) {
      badges = [];
    }
  }

  const safeBadges = Array.isArray(badges)
    ? badges
      .map((item) => {
        const label = item && item.label != null ? String(item.label).trim() : "";
        if (!label) return null;
        const code = item && item.code != null ? normalizeBadgeCode(item.code) : "";
        const color = item && item.color != null ? normalizeHexColor(item.color) : "";
        const priorityRaw = item && item.priority != null ? Number(item.priority) : 0;
        const priority = Number.isFinite(priorityRaw) ? Math.floor(priorityRaw) : 0;
        return {
          code: code || "badge",
          label,
          color: color || "#f8f8f2",
          priority
        };
      })
      .filter(Boolean)
    : [];

  const rawMentions = row && row.mention_json != null ? row.mention_json : null;
  let mentions = [];
  if (Array.isArray(rawMentions)) {
    mentions = rawMentions;
  } else if (typeof rawMentions === "string") {
    try {
      const parsed = JSON.parse(rawMentions);
      if (Array.isArray(parsed)) {
        mentions = parsed;
      }
    } catch (_err) {
      mentions = [];
    }
  }

  const safeMentions = Array.isArray(mentions)
    ? mentions
      .map((item) => {
        const username = item && item.username ? String(item.username).trim().toLowerCase() : "";
        if (!/^[a-z0-9_]{1,24}$/.test(username)) return null;
        const userId = item && item.userId ? String(item.userId).trim() : "";
        const rawName = item && item.name ? String(item.name).replace(/\s+/g, " ").trim() : "";
        const name = rawName || `@${username}`;
        const color = item && item.userColor ? normalizeHexColor(item.userColor) : "";
        return {
          userId,
          username,
          name,
          userColor: color || ""
        };
      })
      .filter(Boolean)
    : [];

  const userColorRaw = row && row.author_color != null ? String(row.author_color).trim() : "";
  let userColor = normalizeHexColor(userColorRaw);
  if (!userColor && safeBadges.length) {
    userColor = normalizeHexColor(safeBadges[0].color);
  }
  if (!authorUserId) {
    userColor = "";
  }

  const finalBadges = authorUserId
    ? safeBadges.length
      ? safeBadges
      : [{ code: "member", label: "Member", color: "#f8f8f2", priority: 100 }]
    : [];

  const chapterContext = buildCommentChapterContext({
    chapterNumber: row && row.chapter_number != null ? row.chapter_number : null,
    chapterTitle: row && row.chapter_title ? row.chapter_title : "",
    chapterIsOneshot: row && row.chapter_is_oneshot
  });

  return {
    id: row.id,
    author: row.author,
    authorUserId,
    badges: finalBadges,
    userColor,
    avatarUrl,
    content: row.content,
    mentions: safeMentions,
    createdAt: row.created_at,
    parentId: row.parent_id,
    likeCount: row.like_count || 0,
    reportCount: row.report_count || 0,
    liked: Boolean(liked),
    reported: Boolean(reported),
    chapterNumber: chapterContext.chapterNumber,
    chapterNumberText: chapterContext.chapterNumberText,
    chapterTitle: chapterContext.chapterTitle,
    chapterIsOneshot: chapterContext.chapterIsOneshot,
    chapterLabel: chapterContext.chapterLabel,
    replies: []
  };
};

const buildCommentTree = (rows, session) => {
  const map = new Map();
  const roots = [];

  rows.forEach((row) => {
    map.set(row.id, mapCommentRow(row, session));
  });

  map.forEach((comment) => {
    if (comment.parentId && map.has(comment.parentId)) {
      map.get(comment.parentId).replies.push(comment);
    } else {
      roots.push(comment);
    }
  });

  return { comments: roots, count: rows.length };
};

const compareCommentCreatedAtAsc = (left, right) => {
  const leftTime = left && left.createdAt ? Date.parse(left.createdAt) : NaN;
  const rightTime = right && right.createdAt ? Date.parse(right.createdAt) : NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const leftCreated = left && left.createdAt ? String(left.createdAt) : "";
  const rightCreated = right && right.createdAt ? String(right.createdAt) : "";
  if (leftCreated && rightCreated && leftCreated !== rightCreated) {
    return leftCreated.localeCompare(rightCreated);
  }

  const leftId = left && Number.isFinite(Number(left.id)) ? Math.floor(Number(left.id)) : 0;
  const rightId = right && Number.isFinite(Number(right.id)) ? Math.floor(Number(right.id)) : 0;
  return leftId - rightId;
};

const compareCommentCreatedAtDesc = (left, right) => compareCommentCreatedAtAsc(right, left);

const sortReplyTreeOldestFirst = (comments) => {
  if (!Array.isArray(comments) || !comments.length) return;
  comments.forEach((comment) => {
    if (!comment || !Array.isArray(comment.replies) || !comment.replies.length) return;
    comment.replies.sort(compareCommentCreatedAtAsc);
    sortReplyTreeOldestFirst(comment.replies);
  });
};

const escapeRegexLiteral = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const escapeSqlLikePattern = (value) => String(value || "").replace(/[!%_]/g, "!$&");

const extractForumImageStoragePrefixesFromContent = ({ content, chapterPrefix, forumPrefix }) => {
  const source = String(content || "");
  if (!source) return [];

  const normalizedChapterPrefix = normalizePathPrefix(chapterPrefix || "chapters") || "chapters";
  const normalizedForumPrefix = normalizePathPrefix(forumPrefix || "forum") || "forum";
  const keyPatterns = [
    `${escapeRegexLiteral(normalizedChapterPrefix)}\\/forum-posts\\/[A-Za-z0-9._~!$&'()*+,;=:@%\\/-]+?\\.(?:avif|gif|jpe?g|png|webp)`,
    `${escapeRegexLiteral(normalizedForumPrefix)}\\/posts\\/[A-Za-z0-9._~!$&'()*+,;=:@%\\/-]+?\\.(?:avif|gif|jpe?g|png|webp)`,
  ];

  const prefixes = new Set();
  keyPatterns.forEach((patternText) => {
    const keyPattern = new RegExp(`(${patternText})`, "gi");
    let match = keyPattern.exec(source);
    while (match) {
      const objectKey = (match[1] || "").toString().trim().replace(/^\/+/, "");
      if (objectKey) {
        const prefix = objectKey.split("/").slice(0, -1).join("/");
        if (prefix) prefixes.add(prefix);
      }
      match = keyPattern.exec(source);
    }
  });

  return Array.from(prefixes);
};

const normalizeCommentStorageTableHint = (value) => {
  const text = (value || "").toString().trim().toLowerCase();
  if (text === "forum" || text === "forum_posts" || text === "forum-posts") return "forum_posts";
  if (text === "comment" || text === "comments") return "comments";
  return "";
};

const resolveCommentStorageTableById = async ({ commentId, tableHint }) => {
  const safeId = Number(commentId);
  if (!Number.isFinite(safeId) || safeId <= 0) return "";

  const idValue = Math.floor(safeId);
  const preferred = normalizeCommentStorageTableHint(tableHint);
  const tableOrder = preferred
    ? [preferred, preferred === "forum_posts" ? "comments" : "forum_posts"]
    : ["comments", "forum_posts"];

  for (const tableName of tableOrder) {
    const row = await dbGet(`SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`, [idValue]);
    if (row && row.id != null) {
      return tableName;
    }
  }

  return "";
};

const deleteCommentCascade = async (commentId, options = {}) => {
  const id = Number(commentId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  const safeId = Math.floor(id);

  const tableName = await resolveCommentStorageTableById({
    commentId: safeId,
    tableHint: options && typeof options === "object" ? options.tableHint : "",
  });
  if (!tableName) return 0;

  const deletionResult = await withTransaction(async ({ dbAll: txAll, dbRun: txRun }) => {
    const rows = await txAll(
      `
        WITH RECURSIVE subtree AS (
          SELECT id
          FROM ${tableName}
          WHERE id = ?
          UNION ALL
          SELECT c.id
          FROM ${tableName} c
          JOIN subtree s ON c.parent_id = s.id
        )
        SELECT c.id, c.content
        FROM ${tableName} c
        JOIN subtree s ON c.id = s.id
      `,
      [safeId]
    );

    const ids = Array.from(
      new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => Number(row && row.id))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))
      )
    );
    if (!ids.length) {
      return { deletedCount: 0, rows: [] };
    }

    const placeholders = ids.map(() => "?").join(",");
    await txRun(`DELETE FROM comment_likes WHERE comment_id IN (${placeholders})`, ids);
    await txRun(`DELETE FROM comment_reports WHERE comment_id IN (${placeholders})`, ids);
    await txRun(`DELETE FROM forum_post_bookmarks WHERE comment_id IN (${placeholders})`, ids);
    await txRun(`DELETE FROM notifications WHERE comment_id IN (${placeholders})`, ids);

    const result = await txRun(
      `
        WITH RECURSIVE subtree AS (
          SELECT id
          FROM ${tableName}
          WHERE id = ?
          UNION ALL
          SELECT c.id
          FROM ${tableName} c
          JOIN subtree s ON c.parent_id = s.id
        )
        DELETE FROM ${tableName}
        WHERE id IN (SELECT id FROM subtree)
      `,
      [safeId]
    );

    return {
      deletedCount: result && result.changes ? result.changes : 0,
      rows,
    };
  });

  const deletedCount = deletionResult && deletionResult.deletedCount ? deletionResult.deletedCount : 0;
  const subtreeRows = deletionResult && Array.isArray(deletionResult.rows) ? deletionResult.rows : [];

  if (!deletedCount) return 0;

  const b2Config = typeof getB2Config === "function" ? getB2Config() : null;
  const canCleanupForumStorage =
    typeof b2DeleteAllByPrefix === "function" && typeof isB2Ready === "function" && isB2Ready(b2Config);
  if (!canCleanupForumStorage || !Array.isArray(subtreeRows) || !subtreeRows.length) {
    return deletedCount;
  }

  const candidatePrefixes = new Set();
  subtreeRows.forEach((row) => {
    const prefixes = extractForumImageStoragePrefixesFromContent({
      content: row && row.content ? row.content : "",
      chapterPrefix: b2Config && b2Config.chapterPrefix,
      forumPrefix: b2Config && b2Config.forumPrefix,
    });
    prefixes.forEach((prefix) => {
      candidatePrefixes.add(prefix);
    });
  });

  for (const prefix of candidatePrefixes) {
    const escapedPrefix = escapeSqlLikePattern(prefix);
    const referencedElsewhere = await dbGet(
      `
        SELECT 1 as ok
        FROM (
          SELECT content FROM comments
          UNION ALL
          SELECT content FROM forum_posts
        ) all_comments
        WHERE content ILIKE ? ESCAPE '!'
        LIMIT 1
      `,
      [`%${escapedPrefix}%`]
    );
    if (referencedElsewhere) continue;

    try {
      await b2DeleteAllByPrefix(prefix);
    } catch (err) {
      console.warn("Failed to cleanup forum post image prefix", {
        prefix,
        message: err && err.message ? err.message : "",
      });
    }
  }

  return deletedCount;
};

const resolveCommentScope = ({ mangaId, chapterNumber }) => {
  const mangaValue = Number(mangaId);
  if (!Number.isFinite(mangaValue) || mangaValue <= 0) return null;

  const safeMangaId = Math.floor(mangaValue);
  const chapterValue = chapterNumber == null ? null : Number(chapterNumber);
  const hasChapterScope = Number.isFinite(chapterValue);

  if (hasChapterScope) {
    return {
      mangaId: safeMangaId,
      chapterNumber: chapterValue,
      hasChapterScope: true,
      whereWithoutStatus: "manga_id = ? AND chapter_number = ?",
      whereVisible: "manga_id = ? AND chapter_number = ? AND status = 'visible'",
      params: [safeMangaId, chapterValue]
    };
  }

  return {
    mangaId: safeMangaId,
    chapterNumber: null,
    hasChapterScope: false,
    whereWithoutStatus: "manga_id = ?",
    whereVisible: "manga_id = ? AND status = 'visible'",
    params: [safeMangaId]
  };
};

const getVisibleCommentCount = async ({ mangaId, chapterNumber }) => {
  const scope = resolveCommentScope({ mangaId, chapterNumber });
  if (!scope) return 0;

  const row = await dbGet(`SELECT COUNT(*) as count FROM comments WHERE ${scope.whereVisible}`, scope.params);
  return row ? row.count : 0;
};

const attachAuthorBadgesToCommentRows = async (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];

  const userIds = Array.from(
    new Set(
      list
        .map((row) => (row && row.author_user_id ? String(row.author_user_id).trim() : ""))
        .filter(Boolean)
    )
  );

  if (!userIds.length) {
    return list.map((row) => ({
      ...row,
      author_badges_json: [],
      author_color: "",
      liked_by_me: false,
      reported_by_me: false
    }));
  }

  const placeholders = userIds.map(() => "?").join(",");
  const badgeRows = await dbAll(
    `
    SELECT
      ub.user_id,
      COALESCE(
        json_agg(
          json_build_object(
            'id', b.id,
            'code', b.code,
            'label', b.label,
            'color', b.color,
            'priority', b.priority
          )
          ORDER BY b.priority DESC, b.id ASC
        ),
        '[]'::json
      ) as badges,
      (array_agg(b.color ORDER BY b.priority DESC, b.id ASC))[1] as user_color
    FROM user_badges ub
    JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id IN (${placeholders})
    GROUP BY ub.user_id
  `,
    userIds
  );

  const badgeMap = new Map();
  badgeRows.forEach((row) => {
    const key = row && row.user_id ? String(row.user_id).trim() : "";
    if (!key) return;
    const badges = Array.isArray(row.badges) ? row.badges : [];
    const userColor = row && row.user_color ? String(row.user_color).trim() : "";
    badgeMap.set(key, { badges, userColor });
  });

  return list.map((row) => {
    const userId = row && row.author_user_id ? String(row.author_user_id).trim() : "";
    const context = userId ? badgeMap.get(userId) : null;
    return {
      ...row,
      author_badges_json: context && Array.isArray(context.badges) ? context.badges : [],
      author_color: context && context.userColor ? context.userColor : "",
      liked_by_me: false,
      reported_by_me: false
    };
  });
};

const attachMentionProfilesToCommentRows = async ({ rows, mangaId }) => {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];

  const mentionUsernames = Array.from(
    new Set(
      list
        .flatMap((row) => extractMentionUsernamesFromContent(row && row.content ? row.content : ""))
        .map((value) => (value == null ? "" : String(value)).trim().toLowerCase())
        .filter(Boolean)
    )
  );

  if (!mentionUsernames.length) {
    return list.map((row) => ({
      ...row,
      mention_json: []
    }));
  }

  const mentionProfileMap = await getMentionProfileMapForManga({
    mangaId,
    usernames: mentionUsernames
  });

  return list.map((row) => ({
    ...row,
    mention_json: buildCommentMentionsForContent({
      content: row && row.content ? row.content : "",
      mentionProfileMap
    })
  }));
};

const getPaginatedCommentTree = async ({ mangaId, chapterNumber, page, perPage, session }) => {
  const scope = resolveCommentScope({ mangaId, chapterNumber });
  if (!scope) {
    return {
      comments: [],
      count: 0,
      pagination: {
        page: 1,
        perPage: 20,
        totalPages: 1,
        totalTopLevel: 0,
        hasPrev: false,
        hasNext: false,
        prevPage: 1,
        nextPage: 1
      }
    };
  }

  const perPageValue = Number(perPage);
  const safePerPage = Number.isFinite(perPageValue)
    ? Math.max(1, Math.min(50, Math.floor(perPageValue)))
    : 20;
  const requestedPage = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(page)) : 1;
  const forumRequestPrefixPattern = `${FORUM_COMMENT_REQUEST_PREFIX}%`;

  const totalCountRow = await dbGet(
    `
      SELECT COUNT(*) as count
      FROM comments
      WHERE ${scope.whereVisible}
        AND COALESCE(client_request_id, '') NOT ILIKE ?
    `,
    [...scope.params, forumRequestPrefixPattern]
  );
  const totalCount = totalCountRow ? Number(totalCountRow.count) || 0 : 0;

  const totalPages = Math.max(1, Math.ceil(totalCount / safePerPage));
  const currentPage = Math.min(requestedPage, totalPages);

  if (totalCount <= 0) {
    return {
      comments: [],
      count: 0,
      pagination: {
        page: currentPage,
        perPage: safePerPage,
        totalPages,
        totalTopLevel: 0,
        hasPrev: currentPage > 1,
        hasNext: currentPage < totalPages,
        prevPage: Math.max(1, currentPage - 1),
        nextPage: Math.min(totalPages, currentPage + 1)
      }
    };
  }

  const rootStats = await dbAll(
    `
    WITH RECURSIVE branch AS (
      SELECT
        c.id,
        c.parent_id,
        c.id as root_id
      FROM comments c
      WHERE ${scope.whereVisible}
        AND c.parent_id IS NULL
        AND COALESCE(c.client_request_id, '') NOT ILIKE ?
      UNION ALL
      SELECT
        child.id,
        child.parent_id,
        branch.root_id
      FROM comments child
      JOIN branch ON child.parent_id = branch.id
      WHERE child.status = 'visible'
        AND COALESCE(child.client_request_id, '') NOT ILIKE ?
    )
    SELECT
      branch.root_id,
      COUNT(*) as subtree_count,
      root.created_at as root_created_at
    FROM branch
    JOIN comments root ON root.id = branch.root_id
    GROUP BY branch.root_id, root.created_at
    ORDER BY root_created_at DESC, branch.root_id DESC
  `,
    [...scope.params, forumRequestPrefixPattern, forumRequestPrefixPattern]
  );

  const totalTopLevel = rootStats.length;
  const startIndex = (currentPage - 1) * safePerPage;
  const endIndexExclusive = startIndex + safePerPage;

  let cursor = 0;
  const rootIds = [];
  for (const row of rootStats) {
    const rootIdValue = Number(row.root_id);
    if (!Number.isFinite(rootIdValue) || rootIdValue <= 0) continue;
    const branchCountValue = Number(row.subtree_count);
    const branchCount =
      Number.isFinite(branchCountValue) && branchCountValue > 0 ? Math.floor(branchCountValue) : 1;

    const nextCursor = cursor + branchCount;
    if (nextCursor > startIndex && cursor < endIndexExclusive) {
      rootIds.push(Math.floor(rootIdValue));
    }
    cursor = nextCursor;
    if (cursor >= endIndexExclusive && rootIds.length) {
      break;
    }
  }

  if (!rootIds.length) {
    return {
      comments: [],
      count: totalCount,
      pagination: {
        page: currentPage,
        perPage: safePerPage,
        totalPages,
        totalTopLevel,
        hasPrev: currentPage > 1,
        hasNext: currentPage < totalPages,
        prevPage: Math.max(1, currentPage - 1),
        nextPage: Math.min(totalPages, currentPage + 1)
      }
    };
  }

  const placeholders = rootIds.map(() => "?").join(",");
  const branchRows = await dbAll(
    `
    WITH RECURSIVE branch AS (
      SELECT
        c.id,
        c.author,
        c.author_user_id,
        c.author_avatar_url,
        c.content,
        c.created_at,
        c.parent_id,
        c.like_count,
        c.report_count,
        c.chapter_number,
        COALESCE(ch.title, '') as chapter_title,
        COALESCE(ch.is_oneshot, false) as chapter_is_oneshot
      FROM comments c
      LEFT JOIN chapters ch ON ch.manga_id = c.manga_id
        AND (
          ch.number = c.chapter_number
          OR (c.chapter_number IS NULL AND COALESCE(ch.is_oneshot, false) = true)
        )
      WHERE c.id IN (${placeholders})
      UNION ALL
      SELECT
        child.id,
        child.author,
        child.author_user_id,
        child.author_avatar_url,
        child.content,
        child.created_at,
        child.parent_id,
        child.like_count,
        child.report_count,
        child.chapter_number,
        COALESCE(ch_child.title, '') as chapter_title,
        COALESCE(ch_child.is_oneshot, false) as chapter_is_oneshot
      FROM comments child
      LEFT JOIN chapters ch_child ON ch_child.manga_id = child.manga_id
        AND (
          ch_child.number = child.chapter_number
          OR (child.chapter_number IS NULL AND COALESCE(ch_child.is_oneshot, false) = true)
        )
      JOIN branch b ON child.parent_id = b.id
      WHERE child.status = 'visible'
        AND COALESCE(child.client_request_id, '') NOT ILIKE ?
    )
    SELECT *
    FROM branch
    ORDER BY created_at ASC, id ASC
  `,
    [...rootIds, forumRequestPrefixPattern]
  );

  const decoratedRows = await attachAuthorBadgesToCommentRows(branchRows);
  const mentionReadyRows = await attachMentionProfilesToCommentRows({
    rows: decoratedRows,
    mangaId: scope.mangaId
  });
  const tree = buildCommentTree(mentionReadyRows, session);
  tree.comments.sort(compareCommentCreatedAtDesc);
  sortReplyTreeOldestFirst(tree.comments);

  return {
    comments: tree.comments,
    count: totalCount,
    pagination: {
      page: currentPage,
      perPage: safePerPage,
      totalPages,
      totalTopLevel,
      hasPrev: currentPage > 1,
      hasNext: currentPage < totalPages,
      prevPage: Math.max(1, currentPage - 1),
      nextPage: Math.min(totalPages, currentPage + 1)
    }
  };
};

const team = {
  name: SEO_SITE_NAME,
  tagline:
    (siteConfig.homepage && siteConfig.homepage.introduction) ||
    "Nền tảng chỉ dành cho manga. Không tạp. Không lẫn thể loại khác."
};

const homepageDefaults = {
  noticeTitle1: "Lịch phát hành",
  noticeBody1: "Thông báo phát hành và lịch cập nhật sẽ hiển thị tại đây.",
  noticeTitle2: "Nội dung ưu tiên",
  noticeBody2: "Ưu tiên nội dung nội bộ, không lẫn thể loại khác."
};

const pickValue = (value, fallback) => (value == null ? fallback : value);

const parseFeaturedIds = (value) =>
  value
    ? value
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((id) => Number.isFinite(id) && id > 0)
    : [];

const normalizeHomepageRow = (row) => ({
  noticeTitle1: pickValue(
    row ? row.notice_title_1 : null,
    homepageDefaults.noticeTitle1
  ),
  noticeBody1: pickValue(
    row ? row.notice_body_1 : null,
    homepageDefaults.noticeBody1
  ),
  noticeTitle2: pickValue(
    row ? row.notice_title_2 : null,
    homepageDefaults.noticeTitle2
  ),
  noticeBody2: pickValue(
    row ? row.notice_body_2 : null,
    homepageDefaults.noticeBody2
  ),
  featuredIds: parseFeaturedIds(row ? row.featured_ids : "")
});

const buildHomepageNotices = (homepageData) => {
  const notices = [];
  const addNotice = (title, body) => {
    const trimmedTitle = (title || "").trim();
    const trimmedBody = (body || "").trim();
    if (!trimmedTitle && !trimmedBody) return;
    notices.push({
      title: trimmedTitle,
      body: trimmedBody
    });
  };

  addNotice(homepageData.noticeTitle1, homepageData.noticeBody1);
  addNotice(homepageData.noticeTitle2, homepageData.noticeBody2);
  return notices;
};

const getDefaultFeaturedIds = async () => {
  const rows = await dbAll(
    "SELECT id FROM manga WHERE COALESCE(is_hidden, 0) = 0 ORDER BY updated_at DESC, id DESC LIMIT 3"
  );
  return rows.map((row) => row.id);
};

const ensureHomepageDefaults = async () => {
  const homepageRow = await dbGet("SELECT id FROM homepage WHERE id = 1");
  if (homepageRow) return;
  const featuredIds = await getDefaultFeaturedIds();
  const now = new Date().toISOString();
  await dbRun(
    `
    INSERT INTO homepage (id, notice_title_1, notice_body_1, notice_title_2, notice_body_2, featured_ids, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `,
    [
      homepageDefaults.noticeTitle1,
      homepageDefaults.noticeBody1,
      homepageDefaults.noticeTitle2,
      homepageDefaults.noticeBody2,
      featuredIds.join(","),
      now
    ]
  );
};

const rawSessionSecret = (process.env.SESSION_SECRET || "").toString().trim();
let resolvedSessionSecret = rawSessionSecret;

if (!resolvedSessionSecret) {
  if (isProductionApp) {
    throw new Error("SESSION_SECRET là bắt buộc khi APP_ENV=production");
  }
  resolvedSessionSecret = crypto.randomBytes(48).toString("hex");
  console.warn("SESSION_SECRET chưa được cấu hình; đang dùng secret tạm cho development.");
}

if (resolvedSessionSecret.length < 32) {
  const message = "SESSION_SECRET nên dài tối thiểu 32 ký tự.";
  if (isProductionApp) {
    throw new Error(message);
  }
  console.warn(message);
}

const adminConfig = {
  user: process.env.ADMIN_USER || "",
  pass: process.env.ADMIN_PASS || "",
  sessionSecret: resolvedSessionSecret
};

const isPasswordAdminEnabled = parseEnvBoolean(process.env.ADMIN_PASSWORD_LOGIN_ENABLED, true);

if (isPasswordAdminEnabled && (!adminConfig.user || !adminConfig.pass)) {
  console.warn("ADMIN_USER/ADMIN_PASS chưa được cấu hình trong .env");
}

if (!isPasswordAdminEnabled) {
  console.warn("ADMIN_PASSWORD_LOGIN_ENABLED đang tắt; chỉ cho phép đăng nhập admin bằng huy hiệu.");
}

const mapMangaRow = (row) => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  author: row.author,
  groupName: row.group_name,
  otherNames: row.other_names,
  genres: parseGenres(row.genres),
  status: row.status,
  description: row.description,
  updatedAt: row.updated_at,
  cover: row.cover,
  coverUpdatedAt: Number(row.cover_updated_at) || 0,
  archive: row.archive,
  isHidden: Boolean(row.is_hidden),
  isOneshot: toBooleanFlag(row && row.is_oneshot),
  oneshotLocked: toBooleanFlag(row && row.oneshot_locked)
});

const mapMangaListRow = (row) => ({
  ...mapMangaRow(row),
  chapterCount: row.chapter_count || 0,
  latestChapterNumber: row.latest_chapter_number || 0,
  latestChapterIsOneshot: toBooleanFlag(row.latest_chapter_is_oneshot)
});

const mapReadingHistoryRow = (row) => {
  const mangaSlug = row && row.manga_slug ? String(row.manga_slug).trim() : "";
  const chapterNumber = row && row.chapter_number != null ? Number(row.chapter_number) : NaN;
  const latestChapterNumber =
    row && row.latest_chapter_number != null ? Number(row.latest_chapter_number) : NaN;
  const chapterIsOneshot = toBooleanFlag(row && row.chapter_is_oneshot);
  const latestChapterIsOneshot = toBooleanFlag(row && row.latest_chapter_is_oneshot);
  const chapterNumberText = Number.isFinite(chapterNumber) ? formatChapterNumberValue(chapterNumber) : "";
  const latestChapterNumberText = Number.isFinite(latestChapterNumber)
    ? formatChapterNumberValue(latestChapterNumber)
    : "";
  const chapterLabel = chapterIsOneshot
    ? "Oneshot"
    : chapterNumberText
      ? `Ch ${chapterNumberText}`
      : "";
  const isUnfinished =
    Number.isFinite(chapterNumber) &&
    Number.isFinite(latestChapterNumber) &&
    latestChapterNumber - chapterNumber > 1e-9;
  const chapterUrl =
    mangaSlug && chapterNumberText
      ? `/manga/${encodeURIComponent(mangaSlug)}/chapters/${encodeURIComponent(chapterNumberText)}`
      : "";
  const updatedAtValue = row && row.updated_at != null ? Number(row.updated_at) : NaN;

  return {
    mangaId: row && row.manga_id != null ? Number(row.manga_id) : 0,
    mangaTitle: row && row.manga_title ? String(row.manga_title).trim() : "",
    mangaSlug,
    mangaUrl: mangaSlug ? `/manga/${encodeURIComponent(mangaSlug)}` : "",
    mangaCover: row && row.manga_cover ? String(row.manga_cover) : "",
    mangaCoverUpdatedAt: Number(row && row.manga_cover_updated_at) || 0,
    mangaAuthor: row && row.manga_author ? String(row.manga_author).trim() : "",
    mangaGroupName: row && row.manga_group_name ? String(row.manga_group_name).trim() : "",
    mangaGenres: parseGenres(row && row.manga_genres ? row.manga_genres : ""),
    mangaStatus: row && row.manga_status ? String(row.manga_status).trim() : "",
    chapterNumber: Number.isFinite(chapterNumber) ? chapterNumber : null,
    chapterNumberText,
    chapterTitle: row && row.chapter_title ? String(row.chapter_title).trim() : "",
    chapterIsOneshot,
    chapterLabel,
    chapterUrl,
    latestChapterNumber: Number.isFinite(latestChapterNumber) ? latestChapterNumber : null,
    latestChapterNumberText,
    latestChapterIsOneshot,
    isUnfinished,
    updatedAt: Number.isFinite(updatedAtValue) ? updatedAtValue : null,
    updatedAtText: Number.isFinite(updatedAtValue) ? formatTimeAgo(updatedAtValue) : ""
  };
};

const ensureUniqueSlug = async (base) => {
  const baseSlug = base || `manga-${Date.now()}`;
  let slug = baseSlug;
  let index = 2;
  while (true) {
    const existing = await dbGet("SELECT 1 FROM manga WHERE slug = ?", [slug]);
    if (!existing) return slug;
    slug = `${baseSlug}-${index}`;
    index += 1;
  }
};

const listQueryBase = `
  SELECT
    m.id,
    m.title,
    m.slug,
    m.author,
    m.group_name,
    m.other_names,
    genre_agg.genres,
    COALESCE(m.is_hidden, 0) as is_hidden,
    COALESCE(m.is_oneshot, false) as is_oneshot,
    COALESCE(m.oneshot_locked, false) as oneshot_locked,
    m.status,
    m.description,
    m.cover,
    COALESCE(m.cover_updated_at, 0) as cover_updated_at,
    m.archive,
    m.updated_at,
    m.created_at,
    COALESCE(chapter_count_stats.chapter_count, 0) as chapter_count,
    latest_chapter.latest_chapter_number,
    latest_chapter.latest_chapter_is_oneshot
  FROM manga m
  LEFT JOIN (
    SELECT
      mg.manga_id,
      string_agg(g.name, ', ' ORDER BY lower(g.name) ASC, g.id ASC) as genres
    FROM manga_genres mg
    JOIN genres g ON g.id = mg.genre_id
    GROUP BY mg.manga_id
  ) genre_agg ON genre_agg.manga_id = m.id
  LEFT JOIN (
    SELECT
      c.manga_id,
      COUNT(*) as chapter_count
    FROM chapters c
    GROUP BY c.manga_id
  ) chapter_count_stats ON chapter_count_stats.manga_id = m.id
  LEFT JOIN (
    SELECT DISTINCT ON (c.manga_id)
      c.manga_id,
      c.number as latest_chapter_number,
      COALESCE(c.is_oneshot, false) as latest_chapter_is_oneshot
    FROM chapters c
    ORDER BY c.manga_id, c.number DESC
  ) latest_chapter ON latest_chapter.manga_id = m.id
`;

const listQueryOrder = "ORDER BY m.updated_at DESC, m.id DESC";

const listQuery = `${listQueryBase} ${listQueryOrder}`;

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const wantsJson = (req) => {
  const queryFormat =
    req && req.query && typeof req.query.format === "string"
      ? req.query.format.toString().trim().toLowerCase()
      : "";
  const requestedWith = (req.get("x-requested-with") || "").toString().trim().toLowerCase();
  if (requestedWith === "xmlhttprequest") {
    return true;
  }

  const accept = (req.headers.accept || "").toString().trim().toLowerCase();
  const acceptsHtml = accept.includes("text/html") || accept.includes("application/xhtml+xml");
  const acceptsJson = accept.includes("application/json");

  if (queryFormat === "json") {
    return !acceptsHtml;
  }

  if (acceptsJson && !acceptsHtml) {
    return true;
  }

  return false;
};

const sameOriginMethods = new Set(["GET", "HEAD", "OPTIONS"]);

const isSameOriginProtectedWritePath = (requestPath) => {
  const pathValue = ensureLeadingSlash(requestPath || "/");
  if (pathValue.startsWith("/admin")) return true;
  if (pathValue === "/teams" || pathValue.startsWith("/teams/")) return true;
  if (pathValue === "/team" || pathValue.startsWith("/team/")) return true;
  if (pathValue === "/forum/api" || pathValue.startsWith("/forum/api/")) return true;
  if (pathValue === "/forum/api/admin" || pathValue.startsWith("/forum/api/admin/")) return true;
  if (pathValue.startsWith("/auth/")) return true;
  if (pathValue.startsWith("/account/")) return true;
  if (pathValue.startsWith("/comments/")) return true;
  if (pathValue === "/comments") return true;
  if (pathValue.startsWith("/messages/")) return true;
  if (pathValue === "/messages") return true;
  if (pathValue.startsWith("/notifications/")) return true;
  if (pathValue === "/notifications") return true;
  return /^\/manga\/[^/]+(?:\/chapters\/[^/]+)?\/comments(?:\/|$)/i.test(pathValue);
};

const readOriginFromUrl = (value) => {
  const text = (value || "").toString().trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return (parsed.origin || "").toLowerCase();
  } catch (_err) {
    return "";
  }
};

const uniqueList = (items) => {
  const set = new Set();
  const result = [];
  (items || []).forEach((item) => {
    const value = (item || "").toString().trim();
    if (!value || set.has(value)) return;
    set.add(value);
    result.push(value);
  });
  return result;
};

const buildContentSecurityPolicy = (nonce) => {
  const safeNonce = (nonce || "").toString().trim();
  const nonceToken = safeNonce ? `'nonce-${safeNonce}'` : "";

  const chapterCdnOrigin = readOriginFromUrl(process.env.CHAPTER_CDN_BASE_URL || "");
  const turnstileOrigin = readOriginFromUrl("https://challenges.cloudflare.com");

  const scriptSrc = uniqueList([
    "'self'",
    nonceToken,
    "'inline-speculation-rules'",
    "https://cdn.jsdelivr.net",
    "https://cdn.ampproject.org",
    turnstileOrigin
  ]);
  const connectSrc = uniqueList(["'self'", turnstileOrigin]);
  const imgSrc = uniqueList(["'self'", "data:", "blob:", "https:", chapterCdnOrigin]);
  const mediaSrc = uniqueList(["'self'", "data:", "blob:", "https:", chapterCdnOrigin]);
  const frameSrc = uniqueList(["'self'", turnstileOrigin]);
  const styleSrc = uniqueList([
    "'self'",
    "'unsafe-inline'",
    "https://fonts.googleapis.com",
    "https://cdn.jsdelivr.net"
  ]);
  const fontSrc = uniqueList(["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "data:"]);

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    `img-src ${imgSrc.join(" ")}`,
    `media-src ${mediaSrc.join(" ")}`,
    `frame-src ${frameSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    `font-src ${fontSrc.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
  ];

  if (isProductionApp) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
};

const rejectForbiddenRequest = (req, res, message) => {
  if (wantsJson(req)) {
    return res.status(403).json({ ok: false, error: message });
  }
  return res.status(403).send(message);
};

const requireSameOriginForAdminWrites = (req, res, next) => {
  const method = (req.method || "GET").toString().toUpperCase();
  if (sameOriginMethods.has(method)) return next();

  const requestPath = (req.path || "").toString();
  if (!isSameOriginProtectedWritePath(requestPath)) return next();

  const host = (req.get("host") || "").toString().trim().toLowerCase();
  if (!host) return next();

  const expectedOrigin = `${req.protocol}://${host}`.toLowerCase();
  const originHeader = (req.get("origin") || "").toString().trim();
  const refererHeader = (req.get("referer") || "").toString().trim();
  const actualOrigin = readOriginFromUrl(originHeader || refererHeader);

  if (!actualOrigin) {
    const fetchSite = (req.get("sec-fetch-site") || "").toString().trim().toLowerCase();
    if (fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none") {
      return next();
    }
    return rejectForbiddenRequest(req, res, "Yêu cầu không hợp lệ (thiếu Origin/Referer).");
  }

  if (actualOrigin !== expectedOrigin) {
    return rejectForbiddenRequest(req, res, "Origin không hợp lệ.");
  }

  return next();
};

const securitySessionDomain = createSecuritySessionDomain({
  isProductionApp,
  serverSessionVersion,
  wantsJson,
});
const {
  adminLoginRateLimiter,
  adminSsoRateLimiter,
  clearAdminAuthSession,
  clearAllAuthSessionState,
  clearUserAuthSession,
  createRateLimiter,
  isServerSessionVersionMismatch,
  readSessionVersion,
} = securitySessionDomain;
const authUserDomain = createAuthUserDomain({
  apiKeySecret: rawSessionSecret,
  clearAllAuthSessionState,
  clearUserAuthSession,
  crypto,
  dbAll,
  dbGet,
  dbRun,
  formatDate,
  isServerSessionVersionMismatch,
  serverSessionVersion,
  wantsJson,
});
const {
  badgeCodePattern,
  buildAutoBadgeCode,
  buildAvatarUrlFromAuthUser,
  buildCommentAuthorFromAuthUser,
  buildIdentityDataRecord,
  buildSessionUserFromUserRow,
  buildUsernameCandidate,
  ensureMemberBadgeForUser,
  ensureUserRowFromAuthUser,
  extractDiscordProfileData,
  generateLocalUserId,
  getMemberBadgeId,
  getUserApiKeyMeta,
  getUserBadgeContext,
  getUserBadges,
  hasOwnObjectKey,
  hexColorPattern,
  isAuthUserEmailVerified,
  isGoogleAvatarUrl,
  isSafeAvatarUrl,
  isUploadedAvatarUrl,
  listAuthIdentityRowsForUser,
  loadSessionUserById,
  mapAuthIdentityRowToUserIdentity,
  mapBadgeRow,
  mapPublicUserRow,
  memberBadgeCacheTtlMs,
  normalizeAuthIdentityProvider,
  normalizeAvatarUrl,
  normalizeBadgeCode,
  normalizeHexColor,
  normalizeOauthDisplayName,
  normalizeOauthEmail,
  normalizeOauthIdentifier,
  normalizeOauthProvider,
  normalizeProfileBio,
  normalizeProfileDiscord,
  normalizeProfileDisplayName,
  normalizeProfileFacebook,
  normalizeProfileSocialUrl,
  normalizeUsernameBase,
  readAuthIdentityAvatar,
  readGoogleProfileData,
  readUserProfileExtrasFromAuthUser,
  resetMemberBadgeCache,
  requireAuthUserForComments,
  resolveOrCreateUserFromOauthProfile,
  rotateUserApiKey,
  setAuthSessionUser,
  shortHexColorPattern,
  upsertAuthIdentityForUser,
  upsertUserProfileFromAuthUser,
} = authUserDomain;
const mentionNotificationDomain = createMentionNotificationDomain({
  COMMENT_MENTION_FETCH_LIMIT,
  NOTIFICATION_CLEANUP_INTERVAL_MS,
  NOTIFICATION_RETENTION_MS,
  NOTIFICATION_TYPE_MENTION,
  NOTIFICATION_TYPE_MANGA_BOOKMARK_NEW_CHAPTER,
  crypto,
  dbAll,
  dbGet,
  dbRun,
  formatTimeAgo,
  normalizeAvatarUrl,
  normalizeHexColor,
  notificationStreamClientsByUserId,
  resolveCommentScope,
});
const {
  addNotificationStreamClient,
  buildCommentMentionsForContent,
  buildCommentNotificationPreview,
  buildCommentPermalink,
  cleanupOldNotifications,
  createMentionNotificationsForComment,
  extractMentionUsernamesFromContent,
  findMentionTargetsForComment,
  getCommentMentionRegex,
  getCommentPageForRoot,
  getCommentRootId,
  getMentionCandidatesForManga,
  getMentionProfileMapForManga,
  getUnreadNotificationCount,
  mapNotificationRow,
  normalizeMentionSearchQuery,
  publishNotificationStreamUpdate,
  removeNotificationStreamClient,
  resolveCommentPermalinkForNotification,
  resolveForumCommentPermalinkForNotification,
  scheduleNotificationCleanup,
  writeNotificationStreamEvent,
} = mentionNotificationDomain;
const initDbDomain = createInitDbDomain({
  ONESHOT_GENRE_NAME,
  dbAll,
  dbGet,
  dbRun,
  ensureHomepageDefaults,
  migrateLegacyGenres,
  migrateMangaSlugs,
  migrateMangaStatuses,
  resetMemberBadgeCache,
  team,
});
const {
  initDb,
} = initDbDomain;
const isAdminConfigured = () => Boolean(isPasswordAdminEnabled && adminConfig.user && adminConfig.pass);

const normalizeSafeRedirectPath = (value, fallback = "") => {
  const raw = (value || "").toString().trim();
  if (!raw) return (fallback || "").toString().trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) {
    return (fallback || "").toString().trim();
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
};

const normalizeSafeForumRedirectPath = (value, fallback = "") => {
  const normalized = normalizeSafeRedirectPath(value, "");
  if (!normalized || !normalized.startsWith("/forum")) {
    return normalizeSafeRedirectPath(fallback, "");
  }
  return normalized;
};

const buildForumAdminLoginRedirect = (req) => {
  const sourceUrl = (req && (req.originalUrl || req.url || req.path) ? (req.originalUrl || req.url || req.path) : "")
    .toString()
    .trim();
  const nextTarget = normalizeSafeForumRedirectPath(sourceUrl, "/forum/admin");
  const fallbackTarget = "/forum";
  const params = new URLSearchParams();
  if (nextTarget) {
    params.set("next", nextTarget);
  }
  params.set("fallback", fallbackTarget);
  return `/admin?${params.toString()}`;
};

const denyAdminAccess = (req, res) => {
  if (wantsJson(req)) {
    return res.status(401).json({ ok: false, error: "Vui lòng đăng nhập admin." });
  }

  const sourcePath = (req && (req.path || req.originalUrl || req.url) ? (req.path || req.originalUrl || req.url) : "")
    .toString()
    .trim();
  const requestPath = normalizeSafeRedirectPath(sourcePath.split("?")[0], "/");

  if (requestPath === "/forum/admin" || requestPath.startsWith("/forum/admin/")) {
    return res.redirect(buildForumAdminLoginRedirect(req));
  }

  if (requestPath === "/admin") {
    const nextTarget = normalizeSafeForumRedirectPath(req && req.query ? req.query.next : "", "");
    if (nextTarget) {
      const params = new URLSearchParams();
      params.set("next", nextTarget);
      const fallbackTarget = normalizeSafeForumRedirectPath(req && req.query ? req.query.fallback : "", "/forum");
      if (fallbackTarget) {
        params.set("fallback", fallbackTarget);
      }
      return res.redirect(`/admin/login?${params.toString()}`);
    }
  }

  return res.redirect("/admin/login");
};

const regenerateSession = (req) =>
  new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.regenerate !== "function") {
      resolve();
      return;
    }
    req.session.regenerate((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

const clearAdminSessionState = (req) => {
  if (!req || !req.session) return;
  req.session.isAdmin = false;
  delete req.session.adminAuth;
  delete req.session.adminUserId;
  delete req.session.adminAuthUserId;
  delete req.session.adminTeamId;
  delete req.session.adminTeamName;
  delete req.session.adminTeamSlug;
  delete req.session.adminTeamRole;
  delete req.session.adminTeamPermissions;
};

const TEAM_MODE_ADMIN_ALLOWED_PATHS = [
  /^\/admin\/manga(?:\/|$)/,
  /^\/admin\/chapters(?:\/|$)/,
  /^\/admin\/chapter-drafts(?:\/|$)/,
  /^\/admin\/covers\/temp(?:\/|$)/,
  /^\/admin\/teams\/search(?:\/|$)/,
  /^\/admin\/jobs(?:\/|$)/,
  /^\/admin\/logout(?:\/|$)/,
];

const TEAM_MEMBER_PERMISSION_DEFAULTS = Object.freeze({
  canAddManga: false,
  canEditManga: false,
  canDeleteManga: false,
  canAddChapter: true,
  canEditChapter: true,
  canDeleteChapter: true,
});

const buildTeamModePermissionSet = ({ role, row }) => {
  const safeRole = (role || "").toString().trim().toLowerCase();
  if (safeRole === "leader") {
    return {
      canAddManga: true,
      canEditManga: true,
      canDeleteManga: true,
      canAddChapter: true,
      canEditChapter: true,
      canDeleteChapter: true,
    };
  }

  const readFlag = (value, fallback) => {
    if (value == null) return Boolean(fallback);
    return toBooleanFlag(value);
  };

  return {
    canAddManga: readFlag(row && row.can_add_manga, TEAM_MEMBER_PERMISSION_DEFAULTS.canAddManga),
    canEditManga: readFlag(row && row.can_edit_manga, TEAM_MEMBER_PERMISSION_DEFAULTS.canEditManga),
    canDeleteManga: readFlag(row && row.can_delete_manga, TEAM_MEMBER_PERMISSION_DEFAULTS.canDeleteManga),
    canAddChapter: readFlag(row && row.can_add_chapter, TEAM_MEMBER_PERMISSION_DEFAULTS.canAddChapter),
    canEditChapter: readFlag(row && row.can_edit_chapter, TEAM_MEMBER_PERMISSION_DEFAULTS.canEditChapter),
    canDeleteChapter: readFlag(row && row.can_delete_chapter, TEAM_MEMBER_PERMISSION_DEFAULTS.canDeleteChapter),
  };
};

const requireAdmin = (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      if (!req.session || !req.session.isAdmin) {
        return denyAdminAccess(req, res);
      }

      const sessionVersion = (req.session.sessionVersion || "").toString().trim();
      if (sessionVersion !== serverSessionVersion) {
        clearAdminSessionState(req);
        delete req.session.sessionVersion;
        return denyAdminAccess(req, res);
      }

      const mode = (req.session.adminAuth || "password").toString().trim().toLowerCase();
      if (mode === "team_leader" || mode === "team_member") {
        const adminUserId = (req.session.adminUserId || "").toString().trim();
        const authUserId = (req.session.authUserId || "").toString().trim();
        const teamId = Number(req.session.adminTeamId);
        const originalUrl = (req.originalUrl || req.url || req.path || "/").toString();
        const pathOnly = originalUrl.split("?")[0] || "/";
        const pathValue = ensureLeadingSlash(pathOnly);

        const pathAllowed = TEAM_MODE_ADMIN_ALLOWED_PATHS.some((pattern) => pattern.test(pathValue));
        if (!pathAllowed || !adminUserId || !authUserId || adminUserId !== authUserId || !Number.isFinite(teamId) || teamId <= 0) {
          clearAdminSessionState(req);
          return denyAdminAccess(req, res);
        }

        const teamMemberRow = await dbGet(
          `
            SELECT
              t.id,
              t.name,
              t.slug,
              tm.role,
              tm.can_add_manga,
              tm.can_edit_manga,
              tm.can_delete_manga,
              tm.can_add_chapter,
              tm.can_edit_chapter,
              tm.can_delete_chapter
            FROM translation_team_members tm
            JOIN translation_teams t ON t.id = tm.team_id
            WHERE tm.team_id = ?
              AND tm.user_id = ?
              AND tm.status = 'approved'
              AND t.status = 'approved'
            LIMIT 1
          `,
          [Math.floor(teamId), adminUserId]
        );
        if (!teamMemberRow) {
          clearAdminSessionState(req);
          return denyAdminAccess(req, res);
        }

        const membershipRole = (teamMemberRow.role || "member").toString().trim().toLowerCase() === "leader"
          ? "leader"
          : "member";
        const teamPermissions = buildTeamModePermissionSet({
          role: membershipRole,
          row: teamMemberRow
        });

        req.session.adminAuth = membershipRole === "leader" ? "team_leader" : "team_member";
        req.session.adminTeamId = Math.floor(Number(teamMemberRow.id));
        req.session.adminTeamName = (teamMemberRow.name || "").toString().trim();
        req.session.adminTeamSlug = (teamMemberRow.slug || "").toString().trim();
        req.session.adminTeamRole = membershipRole;
        req.session.adminTeamPermissions = teamPermissions;
        return next();
      }

      if (mode !== "badge") {
        return next();
      }

      const adminUserId = (req.session.adminUserId || "").toString().trim();
      if (!adminUserId) {
        clearAdminSessionState(req);
        return denyAdminAccess(req, res);
      }

      const badgeContext = await getUserBadgeContext(adminUserId);
      const canAccessAdmin = Boolean(
        badgeContext && badgeContext.permissions && badgeContext.permissions.canAccessAdmin
      );
      if (!canAccessAdmin) {
        clearAdminSessionState(req);
        return denyAdminAccess(req, res);
      }

      return next();
    })
    .catch(next);
};

const coreRuntime = configureCoreRuntime(app, {
  SEO_ROBOTS_INDEX,
  SEO_ROBOTS_NOINDEX,
  appRootDir: __dirname,
  adminConfig,
  asyncHandler,
  buildContentSecurityPolicy,
  buildSeoPayload,
  cacheBust,
  clearAllAuthSessionState,
  compression,
  crypto,
  cssMinifier,
  dbGet,
  ensureLeadingSlash,
  express,
  formatDate,
  formatDateTime,
  formatTimeAgo,
  fs,
  getAuthPublicConfigForRequest,
  isJsMinifyEnabled,
  isProductionApp,
  isServerSessionVersionMismatch,
  loadSessionUserById,
  minifyJs,
  parseEnvBoolean,
  passport,
  path,
  publicDir,
  requireSameOriginForAdminWrites,
  siteConfig,
  serverAssetVersion,
  session,
  sessionStore,
  sharp,
  stickersDir,
  trustProxy,
  uploadDir,
});
const {
  prebuildMinifiedScriptsAtStartup,
} = coreRuntime;
const appContainer = {
  ...storageDomain,
  ...mangaDomain,
  ...securitySessionDomain,
  ...authUserDomain,
  ...mentionNotificationDomain,
  AUTH_DISCORD_STRATEGY,
  AUTH_GOOGLE_STRATEGY,
  COMMENT_LINK_LABEL_FETCH_LIMIT,
  COMMENT_MAX_LENGTH,
  FORUM_COMMENT_MIN_LENGTH,
  FORUM_POST_MIN_LENGTH,
  FORUM_POST_TITLE_MIN_LENGTH,
  FORUM_REPLY_COOLDOWN_MS,
  FORUM_POST_COOLDOWN_MS,
  READING_HISTORY_MAX_ITEMS,
  SEO_ROBOTS_INDEX,
  SEO_ROBOTS_NOINDEX,
  SEO_SITE_NAME,
  asyncHandler,
  avatarsDir,
  express,
  buildAvatarUrlFromAuthUser,
  buildCommentAuthorFromAuthUser,
  buildCommentChapterContext,
  buildCommentMentionsForContent,
  buildHomepageNotices,
  buildOAuthCallbackUrl,
  buildSeoPayload,
  buildSessionUserFromUserRow,
  cacheBust,
  cssMinifier,
  censorCommentContentByForbiddenWords,
  clearAllAuthSessionState,
  clearUserAuthSession,
  createMentionNotificationsForComment,
  crypto,
  dbAll,
  dbGet,
  dbRun,
  newsDbAll,
  newsDbGet,
  isNewsDatabaseConfigured,
  isNewsPageEnabled,
  ensureCommentNotDuplicateRecently,
  ensureCommentPostCooldown,
  ensureCommentTurnstileIfSuspicious,
  ensureLeadingSlash,
  ensureUserRowFromAuthUser,
  escapeXml,
  extractMentionUsernamesFromContent,
  formatChapterNumberValue,
  formatTimeAgo,
  fs,
  getB2Config,
  getGenreStats,
  getUserApiKeyMeta,
  getMentionCandidatesForManga,
  getMentionProfileMapForManga,
  getPaginatedCommentTree,
  getPublicOriginFromRequest,
  getUserBadgeContext,
  hasOwnObjectKey,
  isJsMinifyEnabled,
  isDuplicateCommentRequestError,
  isOauthProviderEnabled,
  isProductionApp,
  isServerSessionVersionMismatch,
  isUploadedAvatarUrl,
  listAuthIdentityRowsForUser,
  listQueryBase,
  listQueryOrder,
  loadSessionUserById,
  mapAuthIdentityRowToUserIdentity,
  mapMangaListRow,
  mapMangaRow,
  mapPublicUserRow,
  mapReadingHistoryRow,
  normalizeAvatarUrl,
  normalizeHomepageRow,
  normalizeNextPath,
  normalizeProfileBio,
  normalizeProfileDiscord,
  normalizeProfileDisplayName,
  normalizeProfileFacebook,
  normalizeSeoText,
  parseChapterNumberInput,
  minifyJs,
  passport,
  path,
  readAuthNextPath,
  readCommentRequestId,
  regenerateSession,
  registerCommentBotSignal,
  requireAuthUserForComments,
  rotateUserApiKey,
  resolveCommentScope,
  resolveOrCreateUserFromOauthProfile,
  resolvePaginationParams,
  sendCommentCooldownResponse,
  sendCommentDuplicateContentResponse,
  sendCommentRequestIdInvalidResponse,
  sendDuplicateCommentRequestResponse,
  serverSessionVersion,
  setAuthSessionUser,
  sharp,
  sitemapCacheByOrigin,
  sitemapCacheTtlMs,
  siteConfig,
  team,
  toAbsolutePublicUrl,
  toBooleanFlag,
  toIsoDate,
  uploadAvatar,
  uploadTeamMedia,
  upsertUserProfileFromAuthUser,
  wantsJson,
  withTransaction,
  ADMIN_MEMBERS_PER_PAGE,
  NOTIFICATION_STREAM_HEARTBEAT_MS,
  addNotificationStreamClient,
  adminConfig,
  adminJobs,
  adminLoginRateLimiter,
  adminSsoRateLimiter,
  b2DeleteAllByPrefix,
  b2DeleteChapterExtraPages,
  b2DeleteFileVersions,
  b2ListFileVersionsByPrefix,
  b2UploadBuffer,
  buildAutoBadgeCode,
  buildChapterExistingPageId,
  buildChapterTimestampIso,
  buildMangaSlug,
  chapterDraftTtlMs,
  convertChapterPageToWebp,
  convertCoverToWebp,
  coversDir,
  coversUrlPrefix,
  createAdminJob,
  createChapterDraft,
  createCoverTempToken,
  deleteChapterAndCleanupStorage,
  deleteCommentCascade,
  deleteCoverTemp,
  deleteFileIfExists,
  deleteMangaAndCleanupStorage,
  enqueueChapterProcessing,
  ensureHomepageDefaults,
  ensureMemberBadgeForUser,
  extractLocalCoverFilename,
  findGenreRowByNormalizedName,
  formatDate,
  formatDateTime,
  getChapterDraft,
  getDefaultFeaturedIds,
  getForbiddenWords,
  getGenresStringByIds,
  getMemberBadgeId,
  getOneshotGenreId,
  getUnreadNotificationCount,
  getVisibleCommentCount,
  invalidateForbiddenWordsCache,
  isAdminConfigured,
  isB2Ready,
  isChapterDraftPageIdValid,
  isChapterDraftTokenValid,
  isPasswordAdminEnabled,
  isForumPageAvailable,
  isForumPageEnabled,
  isTruthyInput,
  listQuery,
  loadCoverTempBuffer,
  localDevOrigin,
  mapBadgeRow,
  mapNotificationRow,
  markMangaUpdatedAtForNewChapter,
  normalizeAdminJobError,
  normalizeBadgeCode,
  normalizeForbiddenWordList,
  normalizeGenreName,
  normalizeHexColor,
  normalizeIdList,
  publishNotificationStreamUpdate,
  removeNotificationStreamClient,
  requireAdmin,
  resolveCommentPermalinkForNotification,
  resolveForumCommentPermalinkForNotification,
  safeCompareText,
  saveCoverBuffer,
  saveCoverTempBuffer,
  setMangaGenresByIds,
  touchChapterDraft,
  updateChapterProcessing,
  uploadChapterPage,
  uploadChapterPages,
  uploadCover,
  writeNotificationStreamEvent,
};

registerSiteRoutes(app, appContainer);
if (isNewsPageEnabled) {
  registerNewsRoutes(app, appContainer);
}
if (isForumPageAvailable) {
  registerForumApiRoutes(app, appContainer);

  const forumDistDir = path.join(__dirname, "sampleforum", "dist");
  const forumIndexPath = forumDistIndexPath;
  if (fs.existsSync(forumIndexPath)) {
    const forumSiteName =
      (siteBrandingConfig && siteBrandingConfig.siteName ? String(siteBrandingConfig.siteName).trim() : "") ||
      SEO_SITE_NAME;
    const forumTitle = `${forumSiteName} Forum`;
    const forumDescription = `Forum thảo luận cộng đồng ${forumSiteName}`;
    const forumBrandMark =
      (siteBrandingConfig && siteBrandingConfig.brandMark ? String(siteBrandingConfig.brandMark).trim() : "") ||
      forumSiteName;
    const derivedTwitterSiteToken = forumBrandMark.replace(/[^a-z0-9_]/gi, "");
    const forumTwitterSite =
      (siteSeoConfig && siteSeoConfig.twitterSite ? String(siteSeoConfig.twitterSite).trim() : "") ||
      (derivedTwitterSiteToken ? `@${derivedTwitterSiteToken}` : "");

    const forumBaseRuntimePayload = {
      siteConfig,
      forumMeta: {
        siteName: forumSiteName,
        title: forumTitle,
        description: forumDescription,
        twitterSite: forumTwitterSite,
        imagePath: FORUM_DEFAULT_SOCIAL_IMAGE_PATH
      }
    };
    const serializeSafeInlineJson = (value) =>
      JSON.stringify(value || {})
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
    const forumRuntimePayloadJson = serializeSafeInlineJson(forumBaseRuntimePayload);
    const forumRuntimeScript = [
      "(() => {",
      `  const payload = ${forumRuntimePayloadJson};`,
      "  window.__SITE_CONFIG = payload && payload.siteConfig ? payload.siteConfig : {};",
      "  window.__FORUM_META = payload && payload.forumMeta ? payload.forumMeta : {};",
      "})();"
    ].join("\n");
    const forumConfigScriptTag = '<script src="/forum/site-config.js"></script>';
    const forumDefaultSectionLabelBySlug = new Map([
      ["thao-luan-chung", "Thảo luận chung"],
      ["thong-bao", "Thông báo"],
      ["huong-dan", "Hướng dẫn"],
      ["tim-truyen", "Tìm truyện"],
      ["gop-y", "Góp ý"],
      ["tam-su", "Tâm sự"],
      ["chia-se", "Chia sẻ"]
    ]);
    const FORUM_SEO_POST_ID_LIKE = "forum-%";
    const FORUM_ROBOTS_NOINDEX_FOLLOW = "noindex,follow";
    const FORUM_ROBOTS_PRIVATE_NOINDEX = "noindex,nofollow";
    const forumSectionAliasMap = new Map([
      ["goi-y", "gop-y"],
      ["tin-tuc", "thong-bao"]
    ]);
    const normalizeForumSectionSlug = (value) => {
      const slug = String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[đĐ]/g, "d")
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!slug) return "";
      return forumSectionAliasMap.get(slug) || slug;
    };
    const extractForumSectionSlugFromContent = (value) => {
      const source = String(value || "");
      const match = source.match(/<!--\s*forum-meta:([^>]*?)\s*-->/i);
      if (!match) return "";
      const payload = String(match[1] || "").trim();
      if (!payload) return "";
      const parts = payload
        .split(";")
        .map((item) => String(item || "").trim())
        .filter(Boolean);
      for (const part of parts) {
        const equalIndex = part.indexOf("=");
        if (equalIndex <= 0) continue;
        const key = part.slice(0, equalIndex).trim().toLowerCase();
        if (key !== "section") continue;
        return normalizeForumSectionSlug(part.slice(equalIndex + 1));
      }
      return "";
    };
    const stripHtmlText = (value) =>
      String(value || "")
        .replace(/<!--([\s\S]*?)-->/g, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    const buildForumPostTitleFromContent = (value) => {
      const source = String(value || "");
      const match = source.match(/^\s*<p>\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*<\/p>/i);
      if (!match) return "";
      return stripHtmlText(match[1]).trim();
    };
    const sanitizeForumMetaText = (value, maxLength, fallback = "") => {
      const cleaned = String(value || "").replace(/\s+/g, " ").trim();
      if (!cleaned) return fallback;
      const limit = Number.isFinite(Number(maxLength)) ? Math.max(24, Math.floor(Number(maxLength))) : 0;
      if (!limit || cleaned.length <= limit) return cleaned;
      return `${cleaned.slice(0, Math.max(1, limit - 1)).trim()}...`;
    };
    const buildForumCanonical = (req, pathValue) => toAbsolutePublicUrl(req, pathValue || "/forum");
    const forumSectionCacheTtlMs = 5 * 60 * 1000;
    let forumSectionCache = {
      expiresAt: 0,
      labelBySlug: new Map(forumDefaultSectionLabelBySlug)
    };
    const loadForumSectionLabels = async () => {
      const now = Date.now();
      if (forumSectionCache.expiresAt > now) {
        return forumSectionCache.labelBySlug;
      }

      const labelBySlug = new Map(forumDefaultSectionLabelBySlug);
      try {
        const rows = await dbAll(
          `
            SELECT slug, label, is_deleted, is_visible
            FROM forum_section_settings
            WHERE COALESCE(is_deleted, FALSE) = FALSE
          `,
          []
        );
        (rows || []).forEach((row) => {
          const visible = row && row.is_visible !== false && String(row.is_visible || "").toLowerCase() !== "false";
          if (!visible) return;
          const slug = normalizeForumSectionSlug(row && row.slug);
          if (!slug) return;
          const label = sanitizeForumMetaText(row && row.label, 64, "");
          if (!label) return;
          labelBySlug.set(slug, label);
        });
      } catch (_err) {
        // Keep default slugs if table is unavailable.
      }

      forumSectionCache = {
        expiresAt: now + forumSectionCacheTtlMs,
        labelBySlug
      };
      return labelBySlug;
    };
    const parsePositivePage = (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return 1;
      return Math.floor(parsed);
    };
    const normalizeForumSort = (value) => {
      const raw = String(value || "").trim().toLowerCase();
      if (raw === "hot" || raw === "new" || raw === "most-commented") {
        return raw;
      }
      return "hot";
    };
    const buildForumIndexSeoData = async (req) => {
      const sectionLabelBySlug = await loadForumSectionLabels();
      const queryObject = req && req.query && typeof req.query === "object" ? req.query : {};
      const q = String(queryObject && queryObject.q ? queryObject.q : "").trim();
      const sort = normalizeForumSort(queryObject && queryObject.sort ? queryObject.sort : "hot");
      const page = parsePositivePage(queryObject && queryObject.page ? queryObject.page : "1");
      const rawSection = req.query && req.query.section ? req.query.section : "";
      const normalizedSection = normalizeForumSectionSlug(rawSection);
      const validSectionSlug = normalizedSection && sectionLabelBySlug.has(normalizedSection) ? normalizedSection : "";
      const allowedQueryKeys = new Set(["page", "q", "section", "sort"]);
      const hasUnknownQueryParam = Object.keys(queryObject).some((key) => !allowedQueryKeys.has(String(key || "").trim()));
      const baseCanonicalPath = validSectionSlug
        ? `/forum?section=${encodeURIComponent(validSectionSlug)}`
        : "/forum";

      const shouldNoindex = Boolean(q) || sort !== "hot" || page > 1 || hasUnknownQueryParam;
      const robots = shouldNoindex ? FORUM_ROBOTS_NOINDEX_FOLLOW : SEO_ROBOTS_INDEX;
      const sectionLabel = validSectionSlug ? sectionLabelBySlug.get(validSectionSlug) : "";
      const title = sectionLabel
        ? `${sectionLabel} | ${forumSiteName} Forum`
        : forumTitle;
      const description = sectionLabel
        ? `Khám phá các chủ đề trong mục ${sectionLabel} tại cộng đồng ${forumSiteName}.`
        : forumDescription;
      const canonicalPath = baseCanonicalPath;
      const canonical = buildForumCanonical(req, canonicalPath);
      const jsonLd = shouldNoindex
        ? []
        : [
            {
              "@context": "https://schema.org",
              "@type": "CollectionPage",
              name: title,
              description,
              url: canonical,
              inLanguage: "vi"
            }
          ];

      return {
        routeType: "home",
        title,
        description,
        canonicalPath,
        canonical,
        robots,
        ogType: "website",
        twitterCard: "summary",
        jsonLd,
        section: validSectionSlug || "",
        queryPolicy: {
          q: Boolean(q),
          sort,
          page,
          noindex: shouldNoindex,
          hasUnknownQueryParam
        }
      };
    };
    const buildForumPostSeoData = async (req, postIdRaw) => {
      const numericPostId = Number(postIdRaw);
      if (!Number.isFinite(numericPostId) || numericPostId <= 0) {
        return {
          routeType: "post",
          title: `Không tìm thấy chủ đề | ${forumSiteName} Forum`,
          description: "Chủ đề bạn đang tìm không tồn tại hoặc đã bị xóa.",
          canonicalPath: "/forum",
          canonical: buildForumCanonical(req, "/forum"),
          robots: FORUM_ROBOTS_NOINDEX_FOLLOW,
          ogType: "website",
          twitterCard: "summary",
          jsonLd: []
        };
      }

      const safePostId = Math.floor(numericPostId);
        const row = await dbGet(
          `
            SELECT
              c.id,
            c.content,
            c.created_at,
            c.author,
              c.author_user_id,
              u.username,
              u.display_name
            FROM forum_posts c
            LEFT JOIN users u ON u.id = c.author_user_id
            WHERE c.id = ?
              AND c.status = 'visible'
            AND c.parent_id IS NULL
            AND COALESCE(c.client_request_id, '') ILIKE ?
          LIMIT 1
        `,
        [safePostId, FORUM_SEO_POST_ID_LIKE]
      );

      if (!row) {
        return {
          routeType: "post",
          title: `Không tìm thấy chủ đề | ${forumSiteName} Forum`,
          description: "Chủ đề bạn đang tìm không tồn tại hoặc đã bị xóa.",
          canonicalPath: "/forum",
          canonical: buildForumCanonical(req, "/forum"),
          robots: FORUM_ROBOTS_NOINDEX_FOLLOW,
          ogType: "website",
          twitterCard: "summary",
          jsonLd: []
        };
      }

      const sectionLabelBySlug = await loadForumSectionLabels();
      const sectionSlug = extractForumSectionSlugFromContent(row.content);
      const sectionLabel = sectionSlug ? sectionLabelBySlug.get(sectionSlug) || "" : "";
      const titleText = sanitizeForumMetaText(
        buildForumPostTitleFromContent(row.content),
        120,
        `Chủ đề #${safePostId}`
      );
      const title = `${titleText} | ${forumSiteName} Forum`;
      const description = sanitizeForumMetaText(stripHtmlText(row.content), 190, forumDescription);
      const canonicalPath = `/forum/post/${encodeURIComponent(String(safePostId))}`;
      const canonical = buildForumCanonical(req, canonicalPath);
      const authorName = sanitizeForumMetaText(
        row.display_name || row.author || row.username || "Thành viên",
        80,
        "Thành viên"
      );
      const datePublished = toIsoDate(row.created_at);
      const jsonLd = [
        {
          "@context": "https://schema.org",
          "@type": "DiscussionForumPosting",
          headline: titleText,
          description,
          url: canonical,
          author: {
            "@type": "Person",
            name: authorName
          },
          articleSection: sectionLabel || undefined,
          datePublished: datePublished || undefined,
          inLanguage: "vi"
        }
      ];

      return {
        routeType: "post",
        title,
        description,
        canonicalPath,
        canonical,
        robots: SEO_ROBOTS_INDEX,
        ogType: "article",
        twitterCard: "summary",
        jsonLd,
        section: sectionSlug || ""
      };
    };
    const buildForumSeoData = async (req) => {
      const pathValue = String(req.path || "").replace(/\/+$/, "") || "/forum";
      if (pathValue === "/forum") {
        return buildForumIndexSeoData(req);
      }

      const postMatch = pathValue.match(/^\/forum\/post\/([^/]+)$/i);
      if (postMatch) {
        return buildForumPostSeoData(req, decodeURIComponent(postMatch[1] || ""));
      }

      if (pathValue === "/forum/saved-posts") {
        const title = `Bài viết đã lưu | ${forumSiteName} Forum`;
        const canonicalPath = "/forum/saved-posts";
        return {
          routeType: "saved-posts",
          title,
          description: "Trang bài viết đã lưu dành cho tài khoản cá nhân.",
          canonicalPath,
          canonical: buildForumCanonical(req, canonicalPath),
          robots: FORUM_ROBOTS_PRIVATE_NOINDEX,
          ogType: "website",
          twitterCard: "summary",
          jsonLd: []
        };
      }

      if (pathValue === "/forum/admin" || pathValue.startsWith("/forum/admin/")) {
        const title = `Quản trị forum | ${forumSiteName}`;
        const canonicalPath = ensureLeadingSlash(req.path || "/forum/admin");
        return {
          routeType: "admin",
          title,
          description: "Khu vực quản trị forum chỉ dành cho quản trị viên.",
          canonicalPath,
          canonical: buildForumCanonical(req, canonicalPath),
          robots: FORUM_ROBOTS_PRIVATE_NOINDEX,
          ogType: "website",
          twitterCard: "summary",
          jsonLd: []
        };
      }

      const canonicalPath = ensureLeadingSlash(req.path || "/forum");
      return {
        routeType: "not-found",
        title: `Không tìm thấy trang | ${forumSiteName} Forum`,
        description: "Trang diễn đàn bạn truy cập không tồn tại hoặc đã bị xóa.",
        canonicalPath: "/forum",
        canonical: buildForumCanonical(req, "/forum"),
        robots: FORUM_ROBOTS_NOINDEX_FOLLOW,
        ogType: "website",
        twitterCard: "summary",
        jsonLd: []
      };
    };
    const escapeHtmlText = (value) =>
      String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const escapeHtmlAttr = (value) =>
      escapeHtmlText(value)
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const replaceMetaContent = (html, selectorPattern, nextContent) => {
      const pattern = new RegExp(`<meta\\s+[^>]*${selectorPattern}[^>]*>`, "i");
      if (!pattern.test(html)) return html;
      return html.replace(pattern, (tag) => {
        if (/content\s*=\s*["'][^"']*["']/i.test(tag)) {
          return tag.replace(/content\s*=\s*["'][^"']*["']/i, `content="${nextContent}"`);
        }
        return tag.replace(/\/?>$/, ` content="${nextContent}"$&`);
      });
    };
    const upsertMetaContent = (html, attrName, attrValue, nextContent) => {
      const escapedAttr = String(attrValue || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const selectorPattern = `${attrName}\\s*=\\s*[\"']${escapedAttr}[\"']`;
      const updated = replaceMetaContent(html, selectorPattern, escapeHtmlAttr(nextContent));
      if (updated !== html) return updated;
      const newTag = `<meta ${attrName}="${attrValue}" content="${escapeHtmlAttr(nextContent)}">`;
      if (updated.includes("</head>")) {
        return updated.replace("</head>", `  ${newTag}\n</head>`);
      }
      return `${updated}\n${newTag}`;
    };
    const upsertCanonicalLink = (html, canonicalUrl) => {
      const safeCanonical = escapeHtmlAttr(canonicalUrl);
      const canonicalTagPattern = /<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*>/i;
      if (canonicalTagPattern.test(html)) {
        return html.replace(canonicalTagPattern, (tag) => {
          if (/href\s*=\s*["'][^"']*["']/i.test(tag)) {
            return tag.replace(/href\s*=\s*["'][^"']*["']/i, `href="${safeCanonical}"`);
          }
          return tag.replace(/\/?>(\s*)$/, ` href="${safeCanonical}">$1`);
        });
      }

      const canonicalTag = `<link rel="canonical" href="${safeCanonical}">`;
      if (html.includes("</head>")) {
        return html.replace("</head>", `  ${canonicalTag}\n</head>`);
      }
      return `${html}\n${canonicalTag}`;
    };
    const upsertJsonLdScript = (html, jsonLdList) => {
      const source = String(html || "").replace(
        /<script\s+[^>]*id\s*=\s*["']forum-seo-jsonld["'][^>]*>[\s\S]*?<\/script>/gi,
        ""
      );
      if (!Array.isArray(jsonLdList) || !jsonLdList.length) {
        return source;
      }
      const serialized = serializeSafeInlineJson(jsonLdList.length === 1 ? jsonLdList[0] : jsonLdList);
      const scriptTag = `<script id="forum-seo-jsonld" type="application/ld+json">${serialized}</script>`;
      if (source.includes("</head>")) {
        return source.replace("</head>", `  ${scriptTag}\n</head>`);
      }
      return `${source}\n${scriptTag}`;
    };
    const upsertRuntimeSeoPayload = (html, payload) => {
      const source = String(html || "").replace(
        /<script\s+[^>]*id\s*=\s*["']forum-seo-runtime["'][^>]*>[\s\S]*?<\/script>/gi,
        ""
      );
      const serialized = serializeSafeInlineJson(payload || {});
      const scriptTag = `<script id="forum-seo-runtime" type="application/json">${serialized}</script>`;
      if (source.includes("</head>")) {
        return source.replace("</head>", `  ${scriptTag}\n</head>`);
      }
      return `${source}\n${scriptTag}`;
    };
    const applyForumHeadBranding = (html, seoPayload) => {
      let nextHtml = String(html || "");
      const seo = seoPayload && typeof seoPayload === "object" ? seoPayload : {};
      const resolvedTitle = sanitizeForumMetaText(seo.title, 140, forumTitle);
      const resolvedDescription = sanitizeForumMetaText(seo.description, 190, forumDescription);
      const resolvedCanonical = sanitizeForumMetaText(seo.canonical, 1000, buildForumCanonical(null, "/forum"));
      const resolvedRobots = sanitizeForumMetaText(seo.robots, 240, SEO_ROBOTS_INDEX);
      const resolvedOgType = sanitizeForumMetaText(seo.ogType, 32, "website");
      const rawImage = sanitizeForumMetaText(seo.image, 1000, FORUM_DEFAULT_SOCIAL_IMAGE_PATH);
      let resolvedImage = rawImage;
      try {
        resolvedImage = new URL(rawImage, resolvedCanonical).toString();
      } catch (_err) {
        resolvedImage = rawImage;
      }
      const safeTitleText = escapeHtmlText(resolvedTitle);
      const safeTitleAttr = escapeHtmlAttr(resolvedTitle);
      const safeDescriptionAttr = escapeHtmlAttr(resolvedDescription);
      const safeAuthorAttr = escapeHtmlAttr(forumSiteName);
      if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(nextHtml)) {
        nextHtml = nextHtml.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${safeTitleText}</title>`);
      }
      nextHtml = upsertMetaContent(nextHtml, "name", "description", resolvedDescription);
      nextHtml = upsertMetaContent(nextHtml, "name", "author", forumSiteName);
      nextHtml = upsertMetaContent(nextHtml, "name", "robots", resolvedRobots);
      nextHtml = upsertMetaContent(nextHtml, "property", "og:title", resolvedTitle);
      nextHtml = upsertMetaContent(nextHtml, "property", "og:description", resolvedDescription);
      nextHtml = upsertMetaContent(nextHtml, "property", "og:url", resolvedCanonical);
      nextHtml = upsertMetaContent(nextHtml, "property", "og:type", resolvedOgType);
      nextHtml = upsertMetaContent(nextHtml, "property", "og:image", resolvedImage);
      nextHtml = upsertMetaContent(nextHtml, "name", "twitter:title", resolvedTitle);
      nextHtml = upsertMetaContent(nextHtml, "name", "twitter:description", resolvedDescription);
      nextHtml = upsertMetaContent(nextHtml, "name", "twitter:card", sanitizeForumMetaText(seo.twitterCard, 40, "summary"));
      nextHtml = upsertMetaContent(nextHtml, "name", "twitter:image", resolvedImage);
      if (forumTwitterSite) {
        nextHtml = upsertMetaContent(nextHtml, "name", "twitter:site", String(forumTwitterSite).trim());
      }
      nextHtml = upsertCanonicalLink(nextHtml, resolvedCanonical);
      nextHtml = upsertJsonLdScript(nextHtml, Array.isArray(seo.jsonLd) ? seo.jsonLd : []);

      const runtimeSeoPayload = {
        ...forumBaseRuntimePayload,
        seo: {
          title: resolvedTitle,
          description: resolvedDescription,
          canonical: resolvedCanonical,
          robots: resolvedRobots,
          ogType: resolvedOgType,
          image: resolvedImage,
          twitterCard: sanitizeForumMetaText(seo.twitterCard, 40, "summary"),
          jsonLd: Array.isArray(seo.jsonLd) ? seo.jsonLd : [],
          routeType: sanitizeForumMetaText(seo.routeType, 40, "home"),
          canonicalPath: sanitizeForumMetaText(seo.canonicalPath, 200, "/forum")
        }
      };
      nextHtml = upsertRuntimeSeoPayload(nextHtml, runtimeSeoPayload);
      return nextHtml;
    };
    const getForumIndexHtml = (() => {
      let cachedMtimeMs = -1;
      let cachedHtml = "";

      return () => {
        const stat = fs.statSync(forumIndexPath);
        const mtimeMs = Number(stat.mtimeMs || 0);
        if (cachedHtml && cachedMtimeMs === mtimeMs) {
          return cachedHtml;
        }

        const sourceHtml = fs.readFileSync(forumIndexPath, "utf8");
        const withRuntimeConfigScript = sourceHtml.includes("/forum/site-config.js")
          ? sourceHtml
          : sourceHtml.includes('<script type="module"')
            ? sourceHtml.replace('<script type="module"', `${forumConfigScriptTag}<script type="module"`)
            : sourceHtml.includes("</head>")
              ? sourceHtml.replace("</head>", `${forumConfigScriptTag}</head>`)
              : `${forumConfigScriptTag}${sourceHtml}`;
        cachedHtml = withRuntimeConfigScript;
        cachedMtimeMs = mtimeMs;
        return cachedHtml;
      };
    })();

    const sendForumIndex = async (req, res) => {
      try {
        const baseHtml = getForumIndexHtml();
        const seoPayload = await buildForumSeoData(req);
        const html = applyForumHeadBranding(baseHtml, seoPayload);
        res.type("text/html; charset=utf-8");
        res.set("Cache-Control", "no-store");
        return res.send(html);
      } catch (error) {
        console.warn("Cannot inject site config into forum index.", error);
        return res.sendFile(forumIndexPath);
      }
    };

    app.get("/forum", (req, res) => {
      return sendForumIndex(req, res);
    });
    app.get("/forum/site-config.js", (_req, res) => {
      res.type("application/javascript; charset=utf-8");
      res.set("Cache-Control", "no-store");
      return res.send(forumRuntimeScript);
    });
    app.use(
      "/forum",
      express.static(forumDistDir, {
        index: false
      })
    );
    app.get("/forum/admin", requireAdmin, (req, res) => {
      return sendForumIndex(req, res);
    });
    app.get("/forum/admin/*", requireAdmin, (req, res) => {
      return sendForumIndex(req, res);
    });
    app.get("/forum/*", (req, res, next) => {
      const requestPath = (req.path || "").toString();
      if (requestPath.startsWith("/forum/api/")) {
        return next();
      }
      if (requestPath.startsWith("/forum/tmp/") || requestPath.startsWith("/forum/posts/")) {
        return res.status(404).send("Không tìm thấy tài nguyên forum.");
      }
      return sendForumIndex(req, res);
    });
  } else {
    console.warn("Forum page enabled nhưng chưa có build frontend tại sampleforum/dist.");
  }
} else if (isForumPageEnabled && !isForumFrontendAvailable) {
  console.warn("Forum page enabled nhưng chưa có build frontend tại sampleforum/dist.");
}
registerAdminAndEngagementRoutes(app, appContainer);
registerEngagementRoutes(app, appContainer);
app.use((req, res) => {
  res.status(404).render("not-found", {
    title: "Không tìm thấy",
    team,
    seo: buildSeoPayload(req, {
      title: "Không tìm thấy",
      description: `Trang bạn yêu cầu không tồn tại trên ${SEO_SITE_NAME}.`,
      robots: SEO_ROBOTS_NOINDEX,
      canonicalPath: ensureLeadingSlash(req.path || "/")
    })
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Đã xảy ra lỗi hệ thống.");
});

const createApp = () => ({
  app,
  appContainer,
  config: {
    port: PORT,
    isProductionApp,
    isJsMinifyEnabled,
    serverAssetVersion
  }
});

const startServer = async (context = null) => {
  const runtime = context && typeof context === "object" ? context : createApp();
  const runtimeApp = runtime.app || app;

  await initDb();

  let jsMinifySummary = {
    enabled: isJsMinifyEnabled,
    total: 0,
    built: 0,
    failed: 0
  };

  try {
    jsMinifySummary = await prebuildMinifiedScriptsAtStartup();
  } catch (error) {
    console.warn("Failed to prebuild minified JS assets at startup", error);
  }

  scheduleSessionStoreCleanup();
  scheduleCoverTempCleanup();
  scheduleChapterDraftCleanup();
  scheduleNotificationCleanup();
  resumeChapterProcessingJobs().catch((err) => {
    console.warn("Failed to resume chapter processing jobs", err);
  });

  return new Promise((resolve, reject) => {
    const server = runtimeApp.listen(PORT, () => {
      console.log(`${SEO_SITE_NAME} manga server running on port ${PORT}`);
      console.log(`Asset version token: ${serverAssetVersion}`);
      console.log(
        jsMinifySummary.enabled
          ? `JS asset minify: enabled (startup build ${jsMinifySummary.built}/${jsMinifySummary.total}, failed ${jsMinifySummary.failed})`
          : "JS asset minify: disabled"
      );
      console.log(`Production CSS minify: ${isProductionApp ? "enabled" : "disabled"}`);
      resolve(server);
    });
    server.on("error", reject);
  });
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  });
}

module.exports = {
  app,
  appContainer,
  createApp,
  startServer
};
