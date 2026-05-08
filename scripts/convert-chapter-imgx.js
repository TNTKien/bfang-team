#!/usr/bin/env node

"use strict";

const normalizeBaseUrl = (value) => (value || "").toString().trim().replace(/\/+$/, "");
const normalizePathPrefix = (value) =>
  (value || "").toString().trim().replace(/^\/+/, "").replace(/\/+$/, "");
const DEFAULT_CHECKPOINT_PATH = ".omx/state/convert-chapter-imgx-checkpoint.json";

const loadRuntimeDeps = () => {
  const {
    CopyObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    ListObjectVersionsCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client
  } = require("@aws-sdk/client-s3");
  return {
    CopyObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    ListObjectVersionsCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
    Pool: require("pg").Pool,
    createStorageDomain: require("../src/domains/storage-domain"),
    crypto: require("crypto"),
    fs: require("fs"),
    imgxServer: require("../src/utils/imgx/server"),
    path: require("path"),
    parseEnvBoolean: require("../src/utils/env").parseEnvBoolean,
    sharp: require("sharp")
  };
};

const printUsage = () => {
  console.log(`Usage:
  node scripts/convert-chapter-imgx.js --to imgx --chapter-id 123
  node scripts/convert-chapter-imgx.js --to imgx-js --chapter-id 123 --apply
  node scripts/convert-chapter-imgx.js --to imgx-bin --chapter-id 123 --apply
  node scripts/convert-chapter-imgx.js --to legacy --manga-id 45 --apply
  node scripts/convert-chapter-imgx.js --to js --all --apply
  node scripts/convert-chapter-imgx.js --to imgx --manga-id-from 1 --manga-id-to 100 --skip-missing --skip-errors --resume --apply

Options:
  --to <imgx|imgx-js|js|imgx-bin|bin|legacy|webp>
                               Target format. imgx/js writes .js by default, imgx-bin/bin writes .bin,
                               legacy/webp writes .webp. Alias imgx follows IMGX_STORAGE_EXT (default js).
  --chapter-id <ids>           Chapter id, comma-separated or repeated.
  --manga-id <ids>             Manga id, comma-separated or repeated.
  --manga-id-from <id>         First manga id in a real manga-table range. Alias: --manga-from.
  --manga-id-to <id>           Last manga id in a real manga-table range. Alias: --manga-to.
  --manga-limit <n>            Process at most n selected manga rows after id filtering.
  --all                        Target all active chapters.
  --include-deleted            Also include soft-deleted chapters.
  --force                      Rebuild target files even if chapter is already in target mode.
  --skip-missing               Skip chapters with missing page objects instead of failing.
  --skip-errors                Skip manga/chapter conversion errors and continue to the next item.
  --keep-old                   Keep source page artifacts after conversion.
                               By default, --apply deletes source artifacts after success:
                               webp->js/bin deletes old .webp pages; bin<->js deletes old IMGX ext;
                               js/bin->webp deletes old .js/.bin + previews.
  --cleanup-old                Backward-compatible alias for the default cleanup behavior.
  --allow-shared-cleanup       Allow cleanup even when another active chapter shares the prefix.
  --limit <n>                  Process at most n selected chapters.
  --checkpoint <path>          Checkpoint file for resume. Default: ${DEFAULT_CHECKPOINT_PATH}
  --resume                     Read checkpoint and skip completed manga/chapters.
  --reset-checkpoint           Ignore an existing checkpoint and start a fresh one.
  --no-checkpoint              Disable checkpoint writes.
  --apply                      Write S3 objects and update chapter DB rows. Default is dry-run.
  --help                       Show this help.

Notes:
  - Dry-run is default and does not read/write S3.
  - With --apply, checkpoint writes are enabled by default so an interrupted run can continue with --resume.
  - Manga id ranges are selected from the real manga table first; missing/deleted manga are naturally skipped.
  - The script preserves the existing page-order model: page 1..N file names only, no per-page DB IDs.
  - IMGX_SECRET plus IMGX_SESSION_HMAC_SECRET/IMGX_HMAC_SECRET/SESSION_SECRET must match the data.
`);
};

const readFlagValues = (args, flagName) => {
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
  return values;
};

const parseIdFlags = (args, flagName) =>
  Array.from(
    new Set(
      readFlagValues(args, flagName)
        .flatMap((value) => String(value || "").split(","))
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value))
    )
  );

const readSingleFlagValue = (args, flagName) => {
  const values = readFlagValues(args, flagName);
  return values.length ? String(values[values.length - 1] || "").trim() : "";
};

const readSingleFlagValueAny = (args, flagNames) => {
  let selected = "";
  for (const flagName of flagNames) {
    const value = readSingleFlagValue(args, flagName);
    if (value) selected = value;
  }
  return selected;
};

const parsePositiveIntegerValue = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
};

const IMGX_STORAGE_EXTENSIONS = Object.freeze(["js", "bin"]);

const normalizeImgxStorageExt = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/^\.+/, "");
  return normalized === "bin" ? "bin" : "js";
};

const isImgxStorageExt = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/^\.+/, "");
  return IMGX_STORAGE_EXTENSIONS.includes(normalized);
};

const uniqueStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean)));

const normalizeTargetMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "imgx") return `imgx-${normalizeImgxStorageExt(process.env.IMGX_STORAGE_EXT)}`;
  if (normalized === "imgx-js" || normalized === "js") return "imgx-js";
  if (normalized === "imgx-bin" || normalized === "bin") return "imgx-bin";
  if (normalized === "legacy" || normalized === "webp") return "legacy";
  return "";
};

const getTargetExt = (targetMode) => {
  if (targetMode === "imgx-js") return "js";
  if (targetMode === "imgx-bin") return "bin";
  return "webp";
};

const normalizeChapterDeliveryMode = (chapterRow) => {
  const mode = String(chapterRow && chapterRow.page_delivery_mode ? chapterRow.page_delivery_mode : "")
    .trim()
    .toLowerCase();
  const ext = String(chapterRow && chapterRow.pages_ext ? chapterRow.pages_ext : "")
    .trim()
    .toLowerCase();
  if (mode === "imgx" || isImgxStorageExt(ext)) return "imgx";
  return "legacy";
};

const normalizeChapterPagesExt = (chapterRow) => {
  const ext = String(chapterRow && chapterRow.pages_ext ? chapterRow.pages_ext : "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "");
  if (ext === "webp" || isImgxStorageExt(ext)) return ext;
  return normalizeChapterDeliveryMode(chapterRow) === "imgx" ? normalizeImgxStorageExt(process.env.IMGX_STORAGE_EXT) : "webp";
};

const getSourceExtCandidates = (chapterRow) => {
  const ext = normalizeChapterPagesExt(chapterRow);
  if (ext === "webp") return ["webp"];
  if (isImgxStorageExt(ext)) return uniqueStrings([ext, ...IMGX_STORAGE_EXTENSIONS]);
  return normalizeChapterDeliveryMode(chapterRow) === "imgx"
    ? uniqueStrings([normalizeImgxStorageExt(process.env.IMGX_STORAGE_EXT), ...IMGX_STORAGE_EXTENSIONS])
    : ["webp"];
};

const isLikelyWebpBuffer = (value) => {
  if (!Buffer.isBuffer(value) || value.length < 16) return false;
  const riffTag = value.toString("ascii", 0, 4);
  const webpTag = value.toString("ascii", 8, 12);
  const chunkTag = value.toString("ascii", 12, 16);
  return riffTag === "RIFF" && webpTag === "WEBP" && (chunkTag === "VP8 " || chunkTag === "VP8L" || chunkTag === "VP8X");
};

const toPgQuery = (sql, params) => {
  const text = String(sql || "");
  if (!Array.isArray(params) || !params.length) {
    return { text, values: [] };
  }

  let index = 0;
  return {
    text: text.replace(/\?/g, () => {
      index += 1;
      return `$${index}`;
    }),
    values: params
  };
};

const createDb = (pool) => {
  const query = async (sql, params = [], client = null) => {
    const payload = toPgQuery(sql, params);
    return (client || pool).query(payload.text, payload.values);
  };
  const dbAll = async (sql, params = [], client = null) => {
    const result = await query(sql, params, client);
    return result.rows || [];
  };
  const dbGet = async (sql, params = [], client = null) => {
    const rows = await dbAll(sql, params, client);
    return rows.length ? rows[0] : null;
  };
  const dbRun = async (sql, params = [], client = null) => {
    const result = await query(sql, params, client);
    return {
      changes: typeof result.rowCount === "number" ? result.rowCount : 0,
      rows: result.rows || []
    };
  };
  const withTransaction = async (handler) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await handler({
        dbAll: (sql, params = []) => dbAll(sql, params, client),
        dbGet: (sql, params = []) => dbGet(sql, params, client),
        dbRun: (sql, params = []) => dbRun(sql, params, client)
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      client.release();
    }
  };

  return { dbAll, dbGet, dbRun, withTransaction };
};

const createStorage = ({ dbAll, dbGet, dbRun, withTransaction, deps }) =>
  deps.createStorageDomain({
    CopyObjectCommand: deps.CopyObjectCommand,
    DeleteObjectCommand: deps.DeleteObjectCommand,
    GetObjectCommand: deps.GetObjectCommand,
    ListObjectVersionsCommand: deps.ListObjectVersionsCommand,
    ListObjectsV2Command: deps.ListObjectsV2Command,
    PutObjectCommand: deps.PutObjectCommand,
    S3Client: deps.S3Client,
    crypto: deps.crypto,
    dbAll,
    dbGet,
    dbRun,
    normalizeBaseUrl,
    normalizePathPrefix,
    parseEnvBoolean: deps.parseEnvBoolean,
    withTransaction,
    sharp: deps.sharp
  });

const hasMangaSelector = (options) =>
  Boolean(
    options.all ||
      (Array.isArray(options.mangaIds) && options.mangaIds.length) ||
      options.mangaIdFrom > 0 ||
      options.mangaIdTo > 0
  );

const buildMangaQuery = ({ all, mangaIds, mangaIdFrom, mangaIdTo, includeDeleted, mangaLimit }) => {
  const conditions = [];
  const params = [];

  if (all) {
    conditions.push("1 = 1");
  }
  if (mangaIds.length) {
    conditions.push("m.id = ANY(?::int[])");
    params.push(mangaIds);
  }
  if (mangaIdFrom > 0) {
    conditions.push("m.id >= ?");
    params.push(mangaIdFrom);
  }
  if (mangaIdTo > 0) {
    conditions.push("m.id <= ?");
    params.push(mangaIdTo);
  }
  if (!includeDeleted) {
    conditions.push("COALESCE(m.is_deleted, false) = false");
  }

  const where = conditions.length ? conditions.join(" AND ") : "1 = 0";
  const safeLimit =
    Number.isFinite(Number(mangaLimit)) && Number(mangaLimit) > 0 ? Math.floor(Number(mangaLimit)) : 0;

  return {
    sql: `
      SELECT
        m.id,
        m.title,
        m.slug,
        COALESCE(m.is_deleted, false) AS is_deleted
      FROM manga m
      WHERE ${where}
      ORDER BY m.id ASC
      ${safeLimit ? `LIMIT ${safeLimit}` : ""}
    `,
    params
  };
};

const buildChapterQuery = ({ chapterIds, selectedMangaIds, mangaSelectorEnabled, includeDeleted, limit }) => {
  const conditions = [];
  const params = [];

  if (chapterIds.length) {
    conditions.push("c.id = ANY(?::int[])");
    params.push(chapterIds);
  }
  if (mangaSelectorEnabled) {
    if (selectedMangaIds.length) {
      conditions.push("c.manga_id = ANY(?::int[])");
      params.push(selectedMangaIds);
    } else {
      conditions.push("1 = 0");
    }
  }
  if (!includeDeleted) {
    conditions.push("COALESCE(c.is_deleted, false) = false");
  }
  if (!chapterIds.length && !mangaSelectorEnabled) {
    conditions.push("1 = 0");
  }

  const where = conditions.length ? conditions.join(" AND ") : "1 = 0";
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 0;

  return {
    sql: `
      SELECT
        c.id,
        c.manga_id,
        c.number,
        c.title,
        c.pages,
        c.pages_prefix,
        c.pages_file_prefix,
        c.pages_ext,
        c.page_delivery_mode,
        c.pages_updated_at,
        COALESCE(c.is_deleted, false) AS is_deleted
      FROM chapters c
      WHERE ${where}
      ORDER BY c.manga_id ASC, c.number ASC, c.id ASC
      ${safeLimit ? `LIMIT ${safeLimit}` : ""}
    `,
    params
  };
};

const uniqueSortedNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Math.floor(Number(value) || 0))
        .filter((value) => value > 0)
    )
  ).sort((a, b) => a - b);

const buildCheckpointRunConfig = (options) => ({
  targetMode: options.targetMode,
  apply: Boolean(options.apply),
  all: Boolean(options.all),
  chapterIds: uniqueSortedNumbers(options.chapterIds),
  mangaIds: uniqueSortedNumbers(options.mangaIds),
  mangaIdFrom: Math.max(0, Math.floor(Number(options.mangaIdFrom) || 0)),
  mangaIdTo: Math.max(0, Math.floor(Number(options.mangaIdTo) || 0)),
  mangaLimit: Math.max(0, Math.floor(Number(options.mangaLimit) || 0)),
  includeDeleted: Boolean(options.includeDeleted),
  force: Boolean(options.force),
  cleanupOld: Boolean(options.cleanupOld),
  allowSharedCleanup: Boolean(options.allowSharedCleanup),
  limit: Math.max(0, Math.floor(Number(options.limit) || 0))
});

const buildCheckpointRunKey = (options) => JSON.stringify(buildCheckpointRunConfig(options));

const resolveCheckpointPath = ({ path, checkpointPath }) =>
  path.resolve(process.cwd(), checkpointPath || DEFAULT_CHECKPOINT_PATH);

const createCheckpointState = (options) => {
  const runConfig = buildCheckpointRunConfig(options);
  return {
    version: 1,
    script: "convert-chapter-imgx",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runKey: JSON.stringify(runConfig),
    runConfig,
    completedMangaIds: [],
    completedChapterIds: [],
    failedMangaIds: [],
    failedChapterIds: [],
    failed: [],
    lastMangaId: null,
    lastChapterId: null
  };
};

const readCheckpointState = ({ fs, checkpointPath, options }) => {
  if (!options.resume || options.resetCheckpoint || !fs.existsSync(checkpointPath)) {
    return createCheckpointState(options);
  }

  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
  const expectedRunKey = buildCheckpointRunKey(options);
  if (checkpoint.runKey && checkpoint.runKey !== expectedRunKey) {
    throw new Error(
      `Checkpoint ${checkpointPath} belongs to a different conversion selection. Use --reset-checkpoint or a different --checkpoint file.`
    );
  }
  checkpoint.version = checkpoint.version || 1;
  checkpoint.script = checkpoint.script || "convert-chapter-imgx";
  checkpoint.runKey = checkpoint.runKey || expectedRunKey;
  checkpoint.runConfig = checkpoint.runConfig || buildCheckpointRunConfig(options);
  checkpoint.completedMangaIds = uniqueSortedNumbers(checkpoint.completedMangaIds);
  checkpoint.completedChapterIds = uniqueSortedNumbers(checkpoint.completedChapterIds);
  checkpoint.failedMangaIds = uniqueSortedNumbers(checkpoint.failedMangaIds);
  checkpoint.failedChapterIds = uniqueSortedNumbers(checkpoint.failedChapterIds);
  checkpoint.failed = Array.isArray(checkpoint.failed) ? checkpoint.failed : [];
  return checkpoint;
};

const saveCheckpointState = ({
  fs,
  path,
  checkpointPath,
  checkpoint,
  completedMangaIds,
  completedChapterIds,
  failedMangaIds,
  failedChapterIds
}) => {
  if (!checkpointPath) return;
  checkpoint.updatedAt = new Date().toISOString();
  checkpoint.completedMangaIds = uniqueSortedNumbers(Array.from(completedMangaIds || []));
  checkpoint.completedChapterIds = uniqueSortedNumbers(Array.from(completedChapterIds || []));
  checkpoint.failedMangaIds = uniqueSortedNumbers(Array.from(failedMangaIds || []));
  checkpoint.failedChapterIds = uniqueSortedNumbers(Array.from(failedChapterIds || []));
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  const tmpPath = `${checkpointPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  fs.renameSync(tmpPath, checkpointPath);
};

const appendCheckpointFailure = ({ checkpoint, scope, mangaId, chapterId, error }) => {
  checkpoint.failed.push({
    at: new Date().toISOString(),
    scope,
    mangaId: mangaId ? Math.floor(Number(mangaId) || 0) : null,
    chapterId: chapterId ? Math.floor(Number(chapterId) || 0) : null,
    error: String(error && error.message ? error.message : error || "").slice(0, 2000)
  });
};

const groupChaptersByMangaId = (chapterRows) => {
  const groups = new Map();
  for (const chapterRow of chapterRows) {
    const mangaId = Math.floor(Number(chapterRow.manga_id) || 0);
    if (!groups.has(mangaId)) groups.set(mangaId, []);
    groups.get(mangaId).push(chapterRow);
  }
  return groups;
};

const findMissingRequestedIds = (requestedIds, foundIds) => {
  const found = new Set(uniqueSortedNumbers(foundIds));
  return uniqueSortedNumbers(requestedIds).filter((id) => !found.has(id));
};

const getOtherPrefixReferences = async ({ dbAll, prefix, chapterId }) => {
  const safePrefix = String(prefix || "").trim();
  const safeChapterId = Math.floor(Number(chapterId) || 0);
  if (!safePrefix || safeChapterId <= 0) return [];
  return dbAll(
    `
      SELECT id, manga_id, number
      FROM chapters
      WHERE id <> ?
        AND COALESCE(is_deleted, false) = false
        AND TRIM(COALESCE(pages_prefix, '')) = ?
      ORDER BY id ASC
      LIMIT 10
    `,
    [safeChapterId, safePrefix]
  );
};

const assertChapterConvertible = (chapterRow) => {
  const pageCount = Math.max(0, Math.floor(Number(chapterRow && chapterRow.pages) || 0));
  const prefix = String(chapterRow && chapterRow.pages_prefix ? chapterRow.pages_prefix : "").trim();
  if (!prefix) throw new Error(`Chapter #${chapterRow.id} has no pages_prefix.`);
  if (pageCount <= 0) throw new Error(`Chapter #${chapterRow.id} has no pages.`);
  return { pageCount, prefix };
};

const buildPageKeys = ({ storage, chapterRow, fromExts, toExt }) => {
  const { pageCount, prefix } = assertChapterConvertible(chapterRow);
  const padLength = Math.max(3, String(pageCount).length);
  const pageFilePrefix = chapterRow.pages_file_prefix || "";
  const normalizedSourceExts = uniqueStrings(Array.isArray(fromExts) ? fromExts : [fromExts]);
  const sourceExts = normalizedSourceExts.length ? normalizedSourceExts : [normalizeChapterPagesExt(chapterRow)];
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const sourceCandidates = sourceExts.map((extension) => {
      const sourceName = storage.buildChapterPageFileName({
        pageNumber,
        padLength,
        extension,
        pageFilePrefix
      });
      return sourceName ? `${prefix}/${sourceName}` : "";
    }).filter(Boolean);
    const destinationName = storage.buildChapterPageFileName({
      pageNumber,
      padLength,
      extension: toExt,
      pageFilePrefix
    });
    if (!sourceCandidates.length || !destinationName) {
      throw new Error(`Chapter #${chapterRow.id} page ${pageNumber} has invalid file name.`);
    }
    pages.push({
      pageNumber,
      sourceCandidates,
      destinationKey: `${prefix}/${destinationName}`
    });
  }

  return pages;
};

const convertPagesToTarget = async ({ storage, chapterRow, targetExt, apply, skipMissing }) => {
  const pages = buildPageKeys({
    storage,
    chapterRow,
    fromExts: getSourceExtCandidates(chapterRow),
    toExt: targetExt
  });
  let converted = 0;
  let skipped = 0;
  let bytes = 0;

  for (const page of pages) {
    if (!apply) {
      converted += 1;
      continue;
    }
    let lastError = null;
    let result = null;
    for (const sourceKey of page.sourceCandidates) {
      try {
        result = targetExt === "webp"
          ? await storage.transcodeChapterPageToLegacyWebp({
              sourceStorageKey: sourceKey,
              destinationStorageKey: page.destinationKey
            })
          : await storage.transcodeChapterPageToImgx({
              sourceStorageKey: sourceKey,
              destinationStorageKey: page.destinationKey
            });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!result) {
      const error = lastError || new Error("No source page candidate matched.");
      if (skipMissing) {
        skipped += 1;
        console.warn(`[skip] chapter #${chapterRow.id} page ${page.pageNumber}: ${error.message || error}`);
        continue;
      }
      throw error;
    }
    converted += 1;
    bytes += Math.max(0, Number(result && result.byteSize) || 0);
  }

  return { converted, skipped, bytes };
};

const validateTargetPages = async ({ storage, imgxConfig, imgxServer, chapterRow, targetExt, apply }) => {
  if (!apply) return 0;
  const pages = buildPageKeys({ storage, chapterRow, fromExts: [targetExt], toExt: targetExt });
  let validated = 0;
  for (const page of pages) {
    const targetKey = page.destinationKey;
    const buffer = await storage.b2DownloadBuffer(targetKey);
    if (!buffer || !buffer.byteLength) {
      throw new Error(`Chapter #${chapterRow.id} target page ${page.pageNumber} is empty.`);
    }
    if (targetExt === "webp") {
      if (!isLikelyWebpBuffer(buffer)) {
        throw new Error(`Chapter #${chapterRow.id} target page ${page.pageNumber} is not valid WebP.`);
      }
    } else {
      const decoded = imgxServer.decodeImgxForVerification(
        buffer,
        imgxServer.imageIdFromStorageKey(targetKey),
        imgxConfig.secret
      );
      const webpBuffer = Buffer.from(decoded.webp);
      if (!isLikelyWebpBuffer(webpBuffer)) {
        throw new Error(`Chapter #${chapterRow.id} target page ${page.pageNumber} does not decode to WebP.`);
      }
    }
    validated += 1;
  }
  return validated;
};

const updateChapterDeliveryMode = async ({ dbRun, chapterRow, targetMode, apply }) => {
  if (!apply) return 0;
  const updatedAt = Date.now();
  const pagesExt = getTargetExt(targetMode);
  const pageDeliveryMode = pagesExt === "webp" ? "legacy" : "imgx";
  const result = await dbRun(
    `
      UPDATE chapters
      SET pages_ext = ?,
          page_delivery_mode = ?,
          pages_updated_at = ?
      WHERE id = ?
    `,
    [pagesExt, pageDeliveryMode, updatedAt, chapterRow.id]
  );
  return result.changes || 0;
};

const cleanupOldArtifacts = async ({ storage, dbAll, chapterRow, targetMode, apply, allowSharedCleanup }) => {
  if (!apply) return 0;
  const { pageCount, prefix } = assertChapterConvertible(chapterRow);
  const targetExt = getTargetExt(targetMode);
  if (!allowSharedCleanup) {
    const references = await getOtherPrefixReferences({ dbAll, prefix, chapterId: chapterRow.id });
    if (references.length) {
      throw new Error(
        `Refusing cleanup for chapter #${chapterRow.id}: prefix is shared by active chapter ids ${references
          .map((row) => row.id)
          .join(", ")}. Re-run with --allow-shared-cleanup only if this is intended.`
      );
    }
  }

  if (targetExt === "webp") {
    return storage.b2DeleteChapterImgxPageArtifacts({
      prefix,
      keepPages: 0,
      pageFilePrefix: chapterRow.pages_file_prefix
    });
  }

  let deleted = 0;
  deleted += await storage.b2DeleteChapterLegacyPageArtifacts({
    prefix,
    keepPages: 0,
    pageFilePrefix: chapterRow.pages_file_prefix
  });
  deleted += await storage.b2DeleteChapterImgxPageArtifacts({
    prefix,
    keepPages: pageCount,
    pageFilePrefix: chapterRow.pages_file_prefix,
    extensions: [targetExt]
  });
  const staleExts = IMGX_STORAGE_EXTENSIONS.filter((extension) => extension !== targetExt);
  if (staleExts.length) {
    deleted += await storage.b2DeleteChapterExtraPages({
      prefix,
      keepPages: 0,
      pageFilePrefix: chapterRow.pages_file_prefix,
      extensions: staleExts
    });
  }
  return deleted;
};

const convertChapter = async ({ storage, dbAll, dbRun, imgxConfig, imgxServer, chapterRow, options }) => {
  const targetMode = options.targetMode;
  const currentExt = normalizeChapterPagesExt(chapterRow);
  const targetExt = getTargetExt(targetMode);
  const currentTargetMode = currentExt === "webp" ? "legacy" : `imgx-${currentExt}`;

  if (currentTargetMode === targetMode && !options.force) {
    const cleanupDeleted = options.cleanupOld
      ? await cleanupOldArtifacts({
          storage,
          dbAll,
          chapterRow,
          targetMode,
          apply: options.apply,
          allowSharedCleanup: options.allowSharedCleanup
        })
      : 0;
    return {
      chapterId: chapterRow.id,
      mangaId: chapterRow.manga_id,
      skipped: true,
      reason: `already ${targetExt}`,
      converted: 0,
      skippedPages: 0,
      bytes: 0,
      cleanupDeleted
    };
  }

  const pageStats = await convertPagesToTarget({
    storage,
    chapterRow,
    targetExt,
    apply: options.apply,
    skipMissing: options.skipMissing
  });

  if (pageStats.skipped > 0) {
    return {
      chapterId: chapterRow.id,
      mangaId: chapterRow.manga_id,
      skipped: true,
      reason: `${pageStats.skipped} missing/failed page(s)`,
      converted: pageStats.converted,
      skippedPages: pageStats.skipped,
      bytes: pageStats.bytes,
      cleanupDeleted: 0
    };
  }

  const validatedPages = await validateTargetPages({
    storage,
    imgxConfig,
    imgxServer,
    chapterRow,
    targetExt,
    apply: options.apply
  });
  const dbUpdated = await updateChapterDeliveryMode({
    dbRun,
    chapterRow,
    targetMode,
    apply: options.apply
  });
  const cleanupDeleted = options.cleanupOld
    ? await cleanupOldArtifacts({
        storage,
        dbAll,
        chapterRow,
        targetMode,
        apply: options.apply,
        allowSharedCleanup: options.allowSharedCleanup
      })
    : 0;

  return {
    chapterId: chapterRow.id,
    mangaId: chapterRow.manga_id,
    skipped: false,
    from: currentExt,
    to: targetExt,
    converted: pageStats.converted,
    validatedPages,
    skippedPages: pageStats.skipped,
    bytes: pageStats.bytes,
    dbUpdated,
    cleanupDeleted
  };
};

const parseOptions = (args) => {
  const targetMode = normalizeTargetMode(readSingleFlagValue(args, "--to"));
  const chapterIds = parseIdFlags(args, "--chapter-id");
  const mangaIds = parseIdFlags(args, "--manga-id");
  const mangaIdFrom = parsePositiveIntegerValue(readSingleFlagValueAny(args, ["--manga-id-from", "--manga-from"]));
  const mangaIdTo = parsePositiveIntegerValue(readSingleFlagValueAny(args, ["--manga-id-to", "--manga-to"]));
  const all = args.includes("--all");
  const limitRaw = parsePositiveIntegerValue(readSingleFlagValue(args, "--limit"));
  const mangaLimitRaw = parsePositiveIntegerValue(readSingleFlagValue(args, "--manga-limit"));
  const checkpointPath = readSingleFlagValue(args, "--checkpoint");
  const apply = args.includes("--apply");
  const resume = args.includes("--resume");
  const checkpointEnabled = !args.includes("--no-checkpoint") && (apply || resume || Boolean(checkpointPath));

  return {
    targetMode,
    chapterIds,
    mangaIds,
    mangaIdFrom,
    mangaIdTo,
    all,
    includeDeleted: args.includes("--include-deleted"),
    force: args.includes("--force"),
    skipMissing: args.includes("--skip-missing"),
    skipErrors: args.includes("--skip-errors"),
    cleanupOld: !args.includes("--keep-old"),
    allowSharedCleanup: args.includes("--allow-shared-cleanup"),
    apply,
    limit: limitRaw,
    mangaLimit: mangaLimitRaw,
    checkpointEnabled,
    checkpointPath: checkpointPath || DEFAULT_CHECKPOINT_PATH,
    resume,
    resetCheckpoint: args.includes("--reset-checkpoint")
  };
};

const validateOptions = (options) => {
  if (!options.targetMode) {
    throw new Error("Missing or invalid --to. Use --to imgx-js, imgx-bin, imgx, or legacy.");
  }
  if (!options.all && !options.chapterIds.length && !options.mangaIds.length && !options.mangaIdFrom && !options.mangaIdTo) {
    throw new Error("Choose at least one target: --chapter-id, --manga-id, --manga-id-from/--manga-id-to, or --all.");
  }
  if (options.mangaIdFrom > 0 && options.mangaIdTo > 0 && options.mangaIdFrom > options.mangaIdTo) {
    throw new Error("--manga-id-from must be less than or equal to --manga-id-to.");
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  require("dotenv").config();
  const options = parseOptions(args);
  validateOptions(options);

  const databaseUrl = (process.env.DATABASE_URL || "").toString().trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in .env.");
  }

  const deps = loadRuntimeDeps();
  const pool = new deps.Pool({ connectionString: databaseUrl });
  const db = createDb(pool);
  const storage = createStorage({ ...db, deps });

  try {
    const b2Config = storage.getB2Config();
    const imgxConfig = storage.getImgxConfig();
    if (options.apply && !storage.isB2Ready(b2Config)) {
      throw new Error("S3/B2 chapter storage config is required for --apply.");
    }
    if (options.apply && !storage.isImgxReady(imgxConfig)) {
      throw new Error("IMGX_SECRET plus IMGX_SESSION_HMAC_SECRET/IMGX_HMAC_SECRET/SESSION_SECRET are required.");
    }

    const mangaSelectorEnabled = hasMangaSelector(options);
    const mangaQuery = mangaSelectorEnabled ? buildMangaQuery(options) : null;
    const mangaRows = mangaSelectorEnabled ? await db.dbAll(mangaQuery.sql, mangaQuery.params) : [];
    const selectedMangaIds = mangaRows.map((row) => Math.floor(Number(row.id) || 0)).filter((id) => id > 0);
    const chapterQuery = buildChapterQuery({
      chapterIds: options.chapterIds,
      selectedMangaIds,
      mangaSelectorEnabled,
      includeDeleted: options.includeDeleted,
      limit: options.limit
    });
    const chapterRows = await db.dbAll(chapterQuery.sql, chapterQuery.params);
    const missingMangaIds = mangaSelectorEnabled
      ? findMissingRequestedIds(options.mangaIds, selectedMangaIds)
      : [];
    const missingChapterIds = findMissingRequestedIds(
      options.chapterIds,
      chapterRows.map((row) => row.id)
    );
    const checkpointPath = options.checkpointEnabled
      ? resolveCheckpointPath({ path: deps.path, checkpointPath: options.checkpointPath })
      : "";
    const checkpoint = options.checkpointEnabled
      ? readCheckpointState({ fs: deps.fs, checkpointPath, options })
      : createCheckpointState(options);
    const completedMangaIds = new Set(uniqueSortedNumbers(checkpoint.completedMangaIds));
    const completedChapterIds = new Set(uniqueSortedNumbers(checkpoint.completedChapterIds));
    const failedMangaIds = new Set(uniqueSortedNumbers(checkpoint.failedMangaIds));
    const failedChapterIds = new Set(uniqueSortedNumbers(checkpoint.failedChapterIds));
    const persistCheckpoint = () =>
      saveCheckpointState({
        fs: deps.fs,
        path: deps.path,
        checkpointPath,
        checkpoint,
        completedMangaIds,
        completedChapterIds,
        failedMangaIds,
        failedChapterIds
      });

    if (options.checkpointEnabled) {
      persistCheckpoint();
    }

    console.log(`IMGX chapter conversion (${options.apply ? "apply" : "dry-run"})`);
    console.log(`- target: .${getTargetExt(options.targetMode)} / ${options.targetMode === "legacy" ? "legacy" : "imgx"}`);
    if (mangaSelectorEnabled) {
      console.log(`- manga selected from real manga table: ${mangaRows.length}`);
    }
    console.log(`- chapters selected: ${chapterRows.length}`);
    console.log(`- cleanup old artifacts: ${options.cleanupOld ? "yes" : "no"}`);
    console.log(`- checkpoint: ${options.checkpointEnabled ? checkpointPath : "disabled"}`);
    if (missingMangaIds.length) {
      console.log(`[skip] manga ids not found/excluded: ${missingMangaIds.join(", ")}`);
    }
    if (missingChapterIds.length) {
      console.log(`[skip] chapter ids not found/excluded: ${missingChapterIds.join(", ")}`);
    }

    const results = [];
    const skippedMangas = [];
    const chapterGroups = groupChaptersByMangaId(chapterRows);

    const processChapterRow = async (chapterRow) => {
      const chapterId = Math.floor(Number(chapterRow.id) || 0);
      const mangaId = Math.floor(Number(chapterRow.manga_id) || 0);
      const label = `chapter #${chapterRow.id} manga #${chapterRow.manga_id} ch ${chapterRow.number}`;
      if (options.resume && completedChapterIds.has(chapterId)) {
        console.log(`[checkpoint] skip completed ${label}`);
        return;
      }
      if (options.resume && options.skipErrors && failedChapterIds.has(chapterId)) {
        console.log(`[checkpoint] skip previously failed ${label}`);
        return;
      }

      try {
        const result = await convertChapter({
          storage,
          dbAll: db.dbAll,
          dbRun: db.dbRun,
          imgxConfig,
          imgxServer: deps.imgxServer,
          chapterRow,
          options
        });
        results.push(result);
        if (result.skipped) {
          console.log(`[skip] ${label}: ${result.reason}`);
        } else {
          console.log(
            `[ok] ${label}: ${result.from} -> ${result.to}, pages=${result.converted}, cleanup=${result.cleanupDeleted}`
          );
        }
        completedChapterIds.add(chapterId);
        checkpoint.lastMangaId = mangaId || null;
        checkpoint.lastChapterId = chapterId || null;
        if (options.checkpointEnabled) {
          persistCheckpoint();
        }
      } catch (error) {
        console.error(`[fail] ${label}: ${error.message || error}`);
        failedChapterIds.add(chapterId);
        appendCheckpointFailure({ checkpoint, scope: "chapter", mangaId, chapterId, error });
        checkpoint.lastMangaId = mangaId || null;
        checkpoint.lastChapterId = chapterId || null;
        if (options.checkpointEnabled) {
          persistCheckpoint();
        }
        if (options.skipErrors) {
          console.warn(`[skip-error] ${label}: continuing because --skip-errors is enabled.`);
          return;
        }
        throw error;
      }
    };

    if (mangaSelectorEnabled) {
      for (const mangaRow of mangaRows) {
        const mangaId = Math.floor(Number(mangaRow.id) || 0);
        const mangaLabel = `manga #${mangaId}${mangaRow.title ? ` (${mangaRow.title})` : ""}`;
        if (options.resume && completedMangaIds.has(mangaId)) {
          console.log(`[checkpoint] skip completed ${mangaLabel}`);
          continue;
        }

        const mangaChapters = chapterGroups.get(mangaId) || [];
        if (!mangaChapters.length) {
          const reason = "no selected chapters";
          skippedMangas.push({ mangaId, skipped: true, reason });
          console.log(`[skip] ${mangaLabel}: ${reason}`);
          completedMangaIds.add(mangaId);
          checkpoint.lastMangaId = mangaId || null;
          if (options.checkpointEnabled) {
            persistCheckpoint();
          }
          continue;
        }

        console.log(`[manga] ${mangaLabel}: chapters=${mangaChapters.length}`);
        for (const chapterRow of mangaChapters) {
          await processChapterRow(chapterRow);
        }
        completedMangaIds.add(mangaId);
        checkpoint.lastMangaId = mangaId || null;
        if (options.checkpointEnabled) {
          persistCheckpoint();
        }
      }
    } else {
      for (const chapterRow of chapterRows) {
        await processChapterRow(chapterRow);
      }
    }

    const convertedChapters = results.filter((result) => !result.skipped).length;
    const skippedChapters = results.length - convertedChapters;
    const convertedPages = results.reduce((sum, result) => sum + Math.max(0, Number(result.converted) || 0), 0);
    const cleanupDeleted = results.reduce((sum, result) => sum + Math.max(0, Number(result.cleanupDeleted) || 0), 0);

    console.log("Done.");
    console.log(
      JSON.stringify(
        {
          dryRun: !options.apply,
          targetMode: options.targetMode,
          selectedMangas: mangaRows.length,
          selectedChapters: chapterRows.length,
          processedChapters: results.length,
          convertedChapters,
          skippedChapters,
          skippedMangas,
          convertedPages,
          cleanupDeleted,
          checkpoint: options.checkpointEnabled ? checkpointPath : null,
          failedMangaIds: uniqueSortedNumbers(Array.from(failedMangaIds)),
          failedChapterIds: uniqueSortedNumbers(Array.from(failedChapterIds)),
          results
        },
        null,
        2
      )
    );
    if (!options.apply) {
      console.log("Dry-run only. Re-run with --apply to write S3 objects and update DB rows.");
    }
  } finally {
    await pool.end().catch(() => null);
  }
};

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
