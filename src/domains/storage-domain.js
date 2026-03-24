const createStorageDomain = (deps) => {
  const {
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
  } = deps;

const imageFileExtensionPattern = /\.(avif|gif|jpe?g|png|svg|webp)$/i;
const defaultImageCacheControl = (
  process.env.IMAGE_CACHE_CONTROL ||
  process.env.CHAPTER_IMAGE_CACHE_CONTROL ||
  "public, max-age=31536000, immutable"
)
  .toString()
  .trim();

const resolveObjectCacheControl = (key, overrideValue) => {
  const override = (overrideValue || "").toString().trim();
  if (override) return override;
  if (!defaultImageCacheControl) return "";
  if (!imageFileExtensionPattern.test((key || "").toString().toLowerCase())) return "";
  return defaultImageCacheControl;
};

const getB2Config = () => {
  const bucketId = (
    process.env.S3_BUCKET || process.env.BUCKET || process.env.B2_BUCKET || process.env.B2_BUCKET_ID || ""
  ).trim();
  const keyId = (
    process.env.S3_ACCESS_KEY_ID ||
    process.env.S3_ACCESS_KEY ||
    process.env.ACCESS_KEY ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.B2_KEY_ID ||
    ""
  ).trim();
  const applicationKey = (
    process.env.S3_SECRET_ACCESS_KEY ||
    process.env.S3_SECRET_KEY ||
    process.env.SECRET_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    process.env.B2_APPLICATION_KEY ||
    ""
  ).trim();
  const region = (
    process.env.S3_REGION || process.env.REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1"
  ).trim() || "us-east-1";
  const endpoint = normalizeBaseUrl((process.env.S3_ENDPOINT || process.env.ENDPOINT || process.env.B2_ENDPOINT || "").trim());
  const forcePathStyle = parseEnvBoolean(process.env.S3_FORCE_PATH_STYLE, true);
  const cdnBaseUrl = normalizeBaseUrl((process.env.CHAPTER_CDN_BASE_URL || endpoint || "").trim());
  const forumCdnBaseUrl = normalizeBaseUrl(
    (
      process.env.S3_FORUM_CDN_BASE_URL ||
      process.env.B2_FORUM_CDN_BASE_URL ||
      process.env.FORUM_CDN_BASE_URL ||
      ""
    ).trim()
  );
  const chapterPrefix =
    normalizePathPrefix(process.env.S3_CHAPTER_PREFIX || process.env.B2_CHAPTER_PREFIX || "chapters") ||
    "chapters";
  const forumPrefix =
    normalizePathPrefix(process.env.S3_FORUM_PREFIX || process.env.B2_FORUM_PREFIX || "forum") || "forum";

  return {
    bucketId,
    keyId,
    applicationKey,
    region,
    endpoint,
    forcePathStyle,
    cdnBaseUrl,
    forumCdnBaseUrl,
    chapterPrefix,
    forumPrefix
  };
};

let storageClientCache = null;

const getStorageClient = () => {
  const config = getB2Config();
  if (!config.bucketId || !config.keyId || !config.applicationKey) {
    throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
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

const b2UploadBuffer = async ({ fileName, buffer, contentType, cacheControl }) => {
  const config = getB2Config();
  const key = (fileName || "").toString().trim().replace(/^\/+/, "");
  if (!isB2Ready(config) || !key || !buffer) {
    throw new Error("Upload ảnh thất bại.");
  }

  const s3 = getStorageClient();
  const cacheControlValue = resolveObjectCacheControl(key, cacheControl);
  const payload = {
    Bucket: config.bucketId,
    Key: key,
    Body: buffer,
    ContentType: contentType || "application/octet-stream"
  };
  if (cacheControlValue) {
    payload.CacheControl = cacheControlValue;
  }
  await s3.send(
    new PutObjectCommand(payload)
  );

  return {
    fileName: key,
    fileId: key,
    uploadTimestamp: Date.now()
  };
};

const normalizeB2FileKey = (value) => (value || "").toString().trim().replace(/^\/+/, "");

const buildB2DirPrefix = (value) => {
  const trimmed = normalizeB2FileKey(value).replace(/\/+$/, "");
  if (!trimmed) return "";
  return `${trimmed}/`;
};

const chapterPageFilePrefixPattern = /^[a-zA-Z]{5}$/;

const normalizeChapterPageFilePrefix = (value) => {
  const text = (value || "").toString().trim();
  if (!text) return "";
  return chapterPageFilePrefixPattern.test(text) ? text : "";
};

const buildChapterPageFileName = ({ pageNumber, padLength, extension, pageFilePrefix }) => {
  const page = Number(pageNumber);
  if (!Number.isFinite(page) || page <= 0) return "";
  const safePadLength = Math.max(1, Math.floor(Number(padLength) || 0));
  const ext = (extension || "").toString().trim();
  if (!ext) return "";
  const pageName = String(Math.floor(page)).padStart(safePadLength, "0");
  const suffix = normalizeChapterPageFilePrefix(pageFilePrefix);
  return suffix ? `${pageName}_${suffix}.${ext}` : `${pageName}.${ext}`;
};

const parseChapterPageNumberFromFileName = (prefixDir, fileName, expectedPageFilePrefix) => {
  if (!prefixDir || !fileName) return null;
  if (!fileName.startsWith(prefixDir)) return null;
  const tail = fileName.slice(prefixDir.length);
  const match = tail.match(/^(\d{1,6})(?:_([a-zA-Z]{5}))?\.[a-z0-9]+$/i);
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
};

const isB2Ready = (config) => Boolean(config && config.bucketId && config.keyId && config.applicationKey);

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
    throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
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
        const modifiedRaw = file && file.LastModified ? new Date(file.LastModified).getTime() : 0;
        const uploadTimestamp = Number.isFinite(modifiedRaw) ? modifiedRaw : 0;
        if (!fileName || !fileName.startsWith(prefixKey)) return;
        versions.push({ fileName, fileId: fileName, versionId, uploadTimestamp });
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
      throw new Error("Không đọc được danh sách ảnh lưu trữ.");
    }
  }

  const files = await b2ListFileNamesByPrefix(prefixKey);
  return files.map((file) => ({
    fileName: file.fileName,
    fileId: file.fileId,
    versionId: "",
    uploadTimestamp: file.uploadTimestamp
  }));
};

const b2DeleteFileVersions = async (versions) => {
  if (!Array.isArray(versions) || versions.length === 0) return 0;

  const config = getB2Config();
  if (!isB2Ready(config)) {
    throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
  }

  const s3 = getStorageClient();

  const normalizedInput = versions
    .map((version) => ({
      fileName: normalizeB2FileKey(version && version.fileName),
      versionId: version && version.versionId != null ? String(version.versionId).trim() : ""
    }))
    .filter((version) => Boolean(version.fileName));

  if (!normalizedInput.length) return 0;

  const resolvedVersions = [];
  const unresolvedKeys = new Set();

  normalizedInput.forEach((version) => {
    if (version.versionId) {
      resolvedVersions.push(version);
      return;
    }
    unresolvedKeys.add(version.fileName);
  });

  for (const key of unresolvedKeys) {
    let listedVersions = [];
    try {
      listedVersions = await b2ListFileVersionsByPrefix(key);
    } catch (_err) {
      listedVersions = [];
    }

    const exactVersions = (Array.isArray(listedVersions) ? listedVersions : [])
      .map((item) => ({
        fileName: normalizeB2FileKey(item && item.fileName),
        versionId: item && item.versionId != null ? String(item.versionId).trim() : ""
      }))
      .filter((item) => item.fileName === key);

    if (exactVersions.length) {
      resolvedVersions.push(...exactVersions);
      continue;
    }

    resolvedVersions.push({ fileName: key, versionId: "" });
  }

  const seen = new Set();
  let deleted = 0;
  for (const version of resolvedVersions) {
    const fileName = normalizeB2FileKey(version && version.fileName);
    if (!fileName) continue;

    const versionId = version && version.versionId != null ? String(version.versionId).trim() : "";
    const dedupeKey = `${fileName}@@${versionId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

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
    throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
  }

  const prefixDir = buildB2DirPrefix(prefix);
  if (!prefixDir) return 0;
  const versions = await b2ListFileVersionsByPrefix(prefixDir);
  return b2DeleteFileVersions(versions);
};

const b2DeleteChapterExtraPages = async ({ prefix, keepPages, pageFilePrefix }) => {
  const config = getB2Config();
  if (!isB2Ready(config)) {
    throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
  }

  const prefixDir = buildB2DirPrefix(prefix);
  if (!prefixDir) return 0;

  const keep = Math.max(0, Math.floor(Number(keepPages) || 0));
  const versions = await b2ListFileVersionsByPrefix(prefixDir);
  const normalizedFilePrefix = normalizeChapterPageFilePrefix(pageFilePrefix);
  const toDelete = versions.filter((version) => {
    const fileName = version && typeof version.fileName === "string" ? version.fileName : "";
    const page = parseChapterPageNumberFromFileName(prefixDir, fileName, normalizedFilePrefix);
    return page != null && page > keep;
  });

  return b2DeleteFileVersions(toDelete);
};

const b2ListFileNamesByPrefix = async (prefix) => {
  const config = getB2Config();
  if (!config.bucketId) {
    throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
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
      const modifiedRaw = file && file.LastModified ? new Date(file.LastModified).getTime() : 0;
      const uploadTimestamp = Number.isFinite(modifiedRaw) ? modifiedRaw : 0;
      if (!fileName) return;
      if (!fileName.startsWith(prefixKey)) return;
      files.push({ fileName, fileId: fileName, uploadTimestamp });
    });

    const nextToken = data && typeof data.NextContinuationToken === "string" ? data.NextContinuationToken : "";
    const isTruncated = Boolean(data && data.IsTruncated);
    if (!isTruncated || !nextToken) break;
    if (nextToken === continuationToken) break;
    continuationToken = nextToken;
  }

  return files;
};

const encodeS3CopySource = (bucketName, objectKey) => {
  const safeBucket = (bucketName || "").toString().trim();
  const safeKey = normalizeB2FileKey(objectKey);
  if (!safeBucket || !safeKey) return "";
  const encodedKey = safeKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/${encodeURIComponent(safeBucket)}/${encodedKey}`;
};

const b2CopyFile = async ({ sourceFileId, destinationFileName }) => {
  const config = getB2Config();
  if (!isB2Ready(config)) {
    throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
  }

  const sourceKey = normalizeB2FileKey(sourceFileId);
  const destinationKey = normalizeB2FileKey(destinationFileName);
  if (!sourceKey || !destinationKey) {
    throw new Error("Thiếu thông tin copy ảnh.");
  }

  if (sourceKey === destinationKey) {
    return {
      fileName: destinationKey,
      fileId: destinationKey
    };
  }

  const copySource = encodeS3CopySource(config.bucketId, sourceKey);
  if (!copySource) {
    throw new Error("Thiếu thông tin copy ảnh.");
  }

  const s3 = getStorageClient();
  await s3.send(
    new CopyObjectCommand({
      Bucket: config.bucketId,
      Key: destinationKey,
      CopySource: copySource
    })
  );

  return {
    fileName: destinationKey,
    fileId: destinationKey
  };
};

const chapterDraftTokenPattern = /^[a-f0-9]{32}$/;
const chapterDraftPageIdPattern = /^[a-f0-9]{24}$/;

const createChapterDraftToken = () => crypto.randomBytes(16).toString("hex");

const isChapterDraftTokenValid = (token) => chapterDraftTokenPattern.test(token || "");

const isChapterDraftPageIdValid = (value) => chapterDraftPageIdPattern.test(value || "");

const buildChapterExistingPageId = (chapterId, pageNumber) => {
  const id = Number(chapterId);
  const page = Number(pageNumber);
  if (!Number.isFinite(id) || id <= 0) return "";
  if (!Number.isFinite(page) || page <= 0) return "";
  const key = `chapter:${Math.floor(id)}:page:${Math.floor(page)}`;
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 24);
};

const buildChapterDraftPrefix = (mangaId, token) => {
  const config = getB2Config();
  const id = Number(mangaId);
  if (!Number.isFinite(id) || id <= 0) return "";
  if (!isChapterDraftTokenValid(token)) return "";
  const base = normalizeB2FileKey(config.chapterPrefix || "chapters");
  const safeBase = base || "chapters";
  return `${safeBase}/tmp/manga-${Math.floor(id)}/draft-${token}`;
};

const createChapterDraft = async (mangaId) => {
  const config = getB2Config();
  if (!isB2Ready(config)) {
    throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
  }

  const id = Number(mangaId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Không tìm thấy truyện");
  }

  const token = createChapterDraftToken();
  const prefix = buildChapterDraftPrefix(id, token);
  if (!prefix) {
    throw new Error("Không tạo được draft chương.");
  }

  const now = Date.now();
  await dbRun(
    "INSERT INTO chapter_drafts (token, manga_id, pages_prefix, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [token, Math.floor(id), prefix, now, now]
  );

  return { token, prefix, createdAt: now, updatedAt: now };
};

const getChapterDraft = async (token) => {
  if (!isChapterDraftTokenValid(token)) return null;
  return dbGet("SELECT * FROM chapter_drafts WHERE token = ?", [token]);
};

const touchChapterDraft = async (token) => {
  if (!isChapterDraftTokenValid(token)) return;
  await dbRun("UPDATE chapter_drafts SET updated_at = ? WHERE token = ?", [Date.now(), token]);
};

const deleteChapterDraftRow = async (token) => {
  if (!isChapterDraftTokenValid(token)) return;
  await dbRun("DELETE FROM chapter_drafts WHERE token = ?", [token]);
};

const chapterDraftTtlMs = 3 * 60 * 60 * 1000;
const chapterDraftCleanupIntervalMs = 8 * 60 * 60 * 1000;

const cleanupChapterDrafts = async () => {
  const config = getB2Config();
  if (!isB2Ready(config)) return 0;

  const cutoff = Date.now() - chapterDraftTtlMs;
  const rows = await dbAll(
    `
    SELECT token, pages_prefix
    FROM chapter_drafts
    WHERE updated_at < ?
      AND token NOT IN (
        SELECT processing_draft_token
        FROM chapters
        WHERE processing_state = 'processing'
          AND processing_draft_token IS NOT NULL
          AND TRIM(processing_draft_token) <> ''
      )
    ORDER BY updated_at ASC
    LIMIT 40
  `,
    [cutoff]
  );

  let cleaned = 0;
  for (const row of rows) {
    const token = row && typeof row.token === "string" ? row.token : "";
    const prefix = row && typeof row.pages_prefix === "string" ? row.pages_prefix : "";
    if (!isChapterDraftTokenValid(token) || !prefix) {
      continue;
    }

    try {
      await b2DeleteAllByPrefix(prefix);
    } catch (err) {
      console.warn("Chapter draft cleanup failed", err);
      continue;
    }

    try {
      await deleteChapterDraftRow(token);
    } catch (err) {
      console.warn("Chapter draft cleanup DB delete failed", err);
      continue;
    }

    cleaned += 1;
  }

  return cleaned;
};

const scheduleChapterDraftCleanup = () => {
  const run = async () => {
    try {
      await cleanupChapterDrafts();
    } catch (err) {
      console.warn("Chapter draft cleanup crashed", err);
    }
  };

  run();
  const timer = setInterval(run, chapterDraftCleanupIntervalMs);
  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }
};

const normalizeJsonString = (value) => (value == null ? "" : String(value)).trim();

const parseJsonArrayOfStrings = (value) => {
  const text = normalizeJsonString(value);
  if (!text) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_err) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => (item == null ? "" : String(item).trim()))
    .filter(Boolean);
};

const chapterProcessingQueue = [];
const chapterProcessingQueued = new Set();
let chapterProcessingRunning = false;
let chapterProcessingActiveWorkers = 0;

const chapterProcessingConcurrency = Math.max(
  1,
  Math.min(4, Math.floor(Number(process.env.CHAPTER_PROCESSING_CONCURRENCY) || 2))
);
const chapterProcessingStaleMs = Math.max(
  2 * 60 * 1000,
  Math.floor(Number(process.env.CHAPTER_PROCESSING_STALE_MS) || 10 * 60 * 1000)
);

const adminJobs = new Map();
const adminJobsQueue = [];
let adminJobsRunning = false;

const createAdminJobId = () => crypto.randomBytes(16).toString("hex");

const pruneAdminJobs = () => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of adminJobs.entries()) {
    if (!job) {
      adminJobs.delete(id);
      continue;
    }
    const updatedAt = Number(job.updatedAt) || 0;
    if ((job.state === "done" || job.state === "failed") && updatedAt && updatedAt < cutoff) {
      adminJobs.delete(id);
    }
  }
};

const normalizeAdminJobError = (err) => {
  const message = (err && err.message ? String(err.message) : "").trim();
  if (!message) return "Thao tác thất bại. Vui lòng thử lại.";
  if (message.length > 160) return "Thao tác thất bại. Vui lòng thử lại.";
  if (/\bb2\b|backblaze|\bs3\b|aws|signaturedoesnotmatch|invalidaccesskeyid/i.test(message)) {
    return "Thao tác thất bại. Vui lòng thử lại.";
  }
  return message;
};

const runAdminJobsQueue = async () => {
  if (adminJobsRunning) return;
  adminJobsRunning = true;
  try {
    while (adminJobsQueue.length) {
      const nextId = adminJobsQueue.shift();
      const job = adminJobs.get(nextId);
      if (!job || job.state !== "queued") continue;

      job.state = "running";
      job.startedAt = Date.now();
      job.updatedAt = job.startedAt;

      try {
        await job.run();
        job.state = "done";
        job.error = "";
      } catch (err) {
        console.warn("Admin job failed", { id: job.id, type: job.type, message: err && err.message });
        job.state = "failed";
        job.error = normalizeAdminJobError(err);
      }

      job.finishedAt = Date.now();
      job.updatedAt = job.finishedAt;
    }
  } finally {
    adminJobsRunning = false;
  }
};

const createAdminJob = ({ type, run }) => {
  pruneAdminJobs();
  const id = createAdminJobId();
  const now = Date.now();
  const safeType = (type || "").toString().trim() || "job";
  adminJobs.set(id, {
    id,
    type: safeType,
    state: "queued",
    error: "",
    createdAt: now,
    startedAt: 0,
    finishedAt: 0,
    updatedAt: now,
    run
  });
  adminJobsQueue.push(id);
  runAdminJobsQueue().catch((err) => {
    console.warn("Admin job queue crashed", err);
  });
  return id;
};

const deleteChapterAndCleanupStorage = async (chapterId) => {
  const id = Number(chapterId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Không tìm thấy chương");
  }

  const chapterRow = await dbGet(
    "SELECT id, manga_id, number, pages_prefix, processing_draft_token FROM chapters WHERE id = ?",
    [Math.floor(id)]
  );
  if (!chapterRow) {
    throw new Error("Không tìm thấy chương");
  }

  const storedPrefix = (chapterRow.pages_prefix || "").toString().trim();
  const processingToken = (chapterRow.processing_draft_token || "").toString().trim();
  const hasProcessing = processingToken && isChapterDraftTokenValid(processingToken);

  if (storedPrefix || hasProcessing) {
    const config = getB2Config();
    if (!isB2Ready(config)) {
      throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
    }

    const prefixesToDelete = new Set();
    if (storedPrefix) {
      prefixesToDelete.add(storedPrefix);
    }

    const finalPrefix = `${config.chapterPrefix}/manga-${chapterRow.manga_id}/ch-${String(
      chapterRow.number
    )}`;
    if (finalPrefix) {
      prefixesToDelete.add(finalPrefix);
    }

    if (hasProcessing) {
      let draftPrefix = "";
      const draft = await getChapterDraft(processingToken);
      if (draft && draft.pages_prefix) {
        draftPrefix = String(draft.pages_prefix).trim();
      }
      if (!draftPrefix) {
        draftPrefix = buildChapterDraftPrefix(chapterRow.manga_id, processingToken);
      }
      if (draftPrefix) {
        prefixesToDelete.add(draftPrefix);
      }
    }

    for (const prefix of prefixesToDelete) {
      if (!prefix) continue;
      await b2DeleteAllByPrefix(prefix);
    }
  }

  if (hasProcessing) {
    try {
      await deleteChapterDraftRow(processingToken);
    } catch (err) {
      console.warn("Failed to delete chapter draft row", err);
    }
  }

  await dbRun("DELETE FROM chapters WHERE id = ?", [chapterRow.id]);
  return { mangaId: chapterRow.manga_id };
};

const deleteMangaAndCleanupStorage = async (mangaId) => {
  const id = Number(mangaId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Không tìm thấy truyện");
  }
  const safeMangaId = Math.floor(id);

  const mangaRow = await dbGet("SELECT id FROM manga WHERE id = ?", [safeMangaId]);
  if (!mangaRow) {
    throw new Error("Không tìm thấy truyện");
  }

  const config = getB2Config();
  if (!isB2Ready(config)) {
    throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
  }

  const rootPrefix = `${config.chapterPrefix}/manga-${safeMangaId}`;
  const tmpPrefix = `${config.chapterPrefix}/tmp/manga-${safeMangaId}`;

  const prefixesToDelete = new Set([rootPrefix, tmpPrefix]);

  const storedPrefixes = await dbAll(
    "SELECT DISTINCT pages_prefix FROM chapters WHERE manga_id = ? AND pages_prefix IS NOT NULL AND TRIM(pages_prefix) <> ''",
    [safeMangaId]
  );
  storedPrefixes.forEach((row) => {
    const prefix = row && row.pages_prefix != null ? String(row.pages_prefix).trim() : "";
    if (!prefix) return;
    if (rootPrefix && prefix.startsWith(rootPrefix)) return;
    if (tmpPrefix && prefix.startsWith(tmpPrefix)) return;
    prefixesToDelete.add(prefix);
  });

  const draftPrefixes = await dbAll(
    "SELECT DISTINCT pages_prefix FROM chapter_drafts WHERE manga_id = ? AND pages_prefix IS NOT NULL AND TRIM(pages_prefix) <> ''",
    [safeMangaId]
  );
  draftPrefixes.forEach((row) => {
    const prefix = row && row.pages_prefix != null ? String(row.pages_prefix).trim() : "";
    if (!prefix) return;
    if (rootPrefix && prefix.startsWith(rootPrefix)) return;
    if (tmpPrefix && prefix.startsWith(tmpPrefix)) return;
    prefixesToDelete.add(prefix);
  });

  for (const prefix of prefixesToDelete) {
    if (!prefix) continue;
    await b2DeleteAllByPrefix(prefix);
  }

  await dbRun("DELETE FROM manga WHERE id = ?", [safeMangaId]);
};

const updateChapterProcessing = async ({ chapterId, state, error }) => {
  const id = Number(chapterId);
  if (!Number.isFinite(id) || id <= 0) return;
  const safeState = (state || "").toString().trim();
  const safeError = (error || "").toString().trim();
  await dbRun(
    "UPDATE chapters SET processing_state = ?, processing_error = ?, processing_updated_at = ? WHERE id = ?",
    [safeState, safeError, Date.now(), Math.floor(id)]
  );
};

const clearChapterProcessing = async (chapterId) => {
  const id = Number(chapterId);
  if (!Number.isFinite(id) || id <= 0) return;
  await dbRun(
    `
    UPDATE chapters
    SET
      processing_state = NULL,
      processing_error = NULL,
      processing_draft_token = NULL,
      processing_pages_json = NULL,
      processing_updated_at = ?
    WHERE id = ?
  `,
    [Date.now(), Math.floor(id)]
  );
};

const buildChapterProcessingFinalPrefix = (mangaId, chapterNumber) => {
  const config = getB2Config();
  const safeMangaId = Number(mangaId);
  if (!Number.isFinite(safeMangaId) || safeMangaId <= 0) return "";
  const chapterNumberKey = String(chapterNumber == null ? "" : chapterNumber).trim();
  if (!chapterNumberKey) return "";
  return `${config.chapterPrefix}/manga-${Math.floor(safeMangaId)}/ch-${chapterNumberKey}`;
};

const getLatestChapterPagesByNumber = async ({ prefix, pageFilePrefix }) => {
  const prefixDir = buildB2DirPrefix(prefix);
  if (!prefixDir) return new Map();

  const files = await b2ListFileNamesByPrefix(prefixDir);
  const latestByPage = new Map();
  files.forEach((file) => {
    const fileName = file && typeof file.fileName === "string" ? file.fileName : "";
    const page = parseChapterPageNumberFromFileName(prefixDir, fileName, pageFilePrefix);
    if (page == null) return;

    const ts = file && file.uploadTimestamp != null ? Number(file.uploadTimestamp) : 0;
    const prev = latestByPage.get(page);
    const prevTs = prev && prev.uploadTimestamp != null ? Number(prev.uploadTimestamp) : 0;
    if (!prev || ts >= prevTs) {
      latestByPage.set(page, {
        fileName,
        uploadTimestamp: Number.isFinite(ts) ? ts : 0
      });
    }
  });

  return latestByPage;
};

const finalizeChapterProcessingSuccess = async ({ chapterId, pageCount, finalPrefix, completedAt }) => {
  const doneAt = Number.isFinite(Number(completedAt)) && Number(completedAt) > 0 ? Number(completedAt) : Date.now();
  const doneDate = new Date(doneAt).toISOString();
  await dbRun(
    `
    UPDATE chapters
    SET
      pages = ?,
      pages_prefix = ?,
      pages_ext = ?,
      pages_updated_at = ?,
      date = ?,
      processing_state = NULL,
      processing_error = NULL,
      processing_draft_token = NULL,
      processing_pages_json = NULL,
      processing_updated_at = ?
    WHERE id = ?
  `,
    [pageCount, finalPrefix, "webp", doneAt, doneDate, doneAt, chapterId]
  );
};

const tryReconcileStaleChapterProcessing = async ({ chapterRow, pageIds, pageFilePrefix, draftPrefix, token }) => {
  const processingUpdatedAt = Number(chapterRow && chapterRow.processing_updated_at);
  if (!Number.isFinite(processingUpdatedAt) || processingUpdatedAt <= 0) return false;
  if (Date.now() - processingUpdatedAt < chapterProcessingStaleMs) return false;

  const expectedCount = pageIds.length;
  if (!expectedCount) return false;

  const finalPrefix = buildChapterProcessingFinalPrefix(chapterRow.manga_id, chapterRow.number);
  if (!finalPrefix) return false;

  const currentPrefix = normalizeJsonString(chapterRow.pages_prefix);
  const currentPages = Number(chapterRow.pages);
  const isAlreadyAlignedWithCurrentPages =
    currentPrefix && currentPrefix === finalPrefix && Number.isFinite(currentPages) && currentPages === expectedCount;
  if (isAlreadyAlignedWithCurrentPages) return false;

  let latestByPage = new Map();
  try {
    latestByPage = await getLatestChapterPagesByNumber({ prefix: finalPrefix, pageFilePrefix });
  } catch (_err) {
    return false;
  }

  for (let page = 1; page <= expectedCount; page += 1) {
    if (!latestByPage.has(page)) return false;
  }

  await finalizeChapterProcessingSuccess({
    chapterId: chapterRow.id,
    pageCount: expectedCount,
    finalPrefix,
    completedAt: Date.now()
  });

  try {
    await b2DeleteChapterExtraPages({ prefix: finalPrefix, keepPages: expectedCount, pageFilePrefix });
  } catch (err) {
    console.warn("Chapter extra page cleanup failed during reconcile", err);
  }

  const previousPrefix = normalizeJsonString(chapterRow.pages_prefix);
  if (previousPrefix && previousPrefix !== finalPrefix) {
    try {
      await b2DeleteAllByPrefix(previousPrefix);
    } catch (err) {
      console.warn("Failed to delete old chapter prefix during reconcile", err);
    }
  }

  if (draftPrefix) {
    let draftCleared = false;
    try {
      await b2DeleteAllByPrefix(draftPrefix);
      draftCleared = true;
    } catch (err) {
      console.warn("Failed to delete chapter draft prefix during reconcile", err);
    }

    if (draftCleared) {
      try {
        await deleteChapterDraftRow(token);
      } catch (err) {
        console.warn("Failed to delete chapter draft row during reconcile", err);
      }
    } else {
      try {
        await touchChapterDraft(token);
      } catch (err) {
        console.warn("Failed to touch chapter draft row during reconcile", err);
      }
    }
  }

  return true;
};

const runChapterProcessingJob = async (chapterId) => {
  const id = Number(chapterId);
  if (!Number.isFinite(id) || id <= 0) return;

  const chapterRow = await dbGet(
    `
    SELECT
      id,
      manga_id,
      number,
      pages,
      pages_prefix,
      pages_file_prefix,
      processing_state,
      processing_draft_token,
      processing_pages_json,
      processing_updated_at
    FROM chapters
    WHERE id = ?
  `,
    [Math.floor(id)]
  );
  if (!chapterRow) return;

  const state = normalizeJsonString(chapterRow.processing_state);
  if (state !== "processing") return;

  const token = normalizeJsonString(chapterRow.processing_draft_token);
  const pageIds = parseJsonArrayOfStrings(chapterRow.processing_pages_json);
  const hasPayload = isChapterDraftTokenValid(token) && pageIds.length > 0;

  if (chapterRow.pages_prefix && String(chapterRow.pages_prefix).trim() && !hasPayload) {
    await clearChapterProcessing(chapterRow.id);
    return;
  }

  const config = getB2Config();
  if (!isB2Ready(config)) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: "Thiếu cấu hình lưu trữ ảnh trong .env"
    });
    return;
  }

  if (!isChapterDraftTokenValid(token)) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: "Draft chương không hợp lệ hoặc đã hết hạn."
    });
    return;
  }

  if (!pageIds.length) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: "Danh sách ảnh trang không hợp lệ."
    });
    return;
  }

  if (pageIds.length > 220) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: "Số lượng ảnh trang quá nhiều."
    });
    return;
  }

  if (pageIds.some((value) => !isChapterDraftPageIdValid(value))) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: "Danh sách ảnh trang không hợp lệ."
    });
    return;
  }

  const uniquePageIds = Array.from(new Set(pageIds));
  if (uniquePageIds.length !== pageIds.length) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: "Danh sách ảnh trang bị trùng."
    });
    return;
  }

  const draft = await getChapterDraft(token);
  if (!draft || Number(draft.manga_id) !== Number(chapterRow.manga_id)) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: "Draft chương không tồn tại hoặc đã hết hạn."
    });
    return;
  }

  const draftPrefix = normalizeJsonString(draft.pages_prefix);
  if (!draftPrefix) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: "Draft chương không hợp lệ."
    });
    return;
  }

  await updateChapterProcessing({ chapterId: chapterRow.id, state: "processing", error: "" });
  await touchChapterDraft(token);

  const finalPrefix = buildChapterProcessingFinalPrefix(chapterRow.manga_id, chapterRow.number);
  if (!finalPrefix) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: "Đường dẫn ảnh chương không hợp lệ."
    });
    return;
  }
  const pageFilePrefix = normalizeChapterPageFilePrefix(chapterRow.pages_file_prefix);
  const padLength = Math.max(3, Math.min(6, String(pageIds.length).length));

  try {
    const reconciled = await tryReconcileStaleChapterProcessing({
      chapterRow,
      pageIds,
      pageFilePrefix,
      draftPrefix,
      token
    });
    if (reconciled) {
      return;
    }
  } catch (err) {
    console.warn("Chapter stale reconciliation failed", err);
  }

  let available = [];
  try {
    available = await b2ListFileNamesByPrefix(buildB2DirPrefix(draftPrefix));
  } catch (err) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: "Không đọc được ảnh tạm."
    });
    return;
  }

  const availableMap = new Map(available.map((file) => [file.fileName, file]));

  const existingSourceById = new Map();
  const existingPrefix = normalizeJsonString(chapterRow.pages_prefix);
  const existingPrefixDir = existingPrefix ? buildB2DirPrefix(existingPrefix) : "";
  if (existingPrefixDir) {
    let existingFiles = [];
    try {
      existingFiles = await b2ListFileNamesByPrefix(existingPrefixDir);
    } catch (err) {
      await updateChapterProcessing({
        chapterId: chapterRow.id,
        state: "failed",
        error: "Không đọc được ảnh chương."
      });
      return;
    }

    const latestByPage = new Map();
    existingFiles.forEach((file) => {
      const fileName = file && typeof file.fileName === "string" ? file.fileName : "";
      const page = parseChapterPageNumberFromFileName(existingPrefixDir, fileName, pageFilePrefix);
      if (page == null) return;

      const prev = latestByPage.get(page);
      const ts = file && file.uploadTimestamp != null ? Number(file.uploadTimestamp) : 0;
      const prevTs = prev && prev.uploadTimestamp != null ? Number(prev.uploadTimestamp) : 0;
      if (!prev || ts >= prevTs) {
        latestByPage.set(page, file);
      }
    });

    latestByPage.forEach((file, page) => {
      const id = buildChapterExistingPageId(chapterRow.id, page);
      if (!id) return;
      existingSourceById.set(id, file);
    });
  }

  try {
    for (let index = 0; index < pageIds.length; index += 1) {
      if (index > 0 && index % 10 === 0) {
        const still = await dbGet(
          "SELECT 1 FROM chapters WHERE id = ? AND processing_state = 'processing'",
          [chapterRow.id]
        );
        if (!still) {
          return;
        }
        await touchChapterDraft(token);
        await dbRun("UPDATE chapters SET processing_updated_at = ? WHERE id = ?", [
          Date.now(),
          chapterRow.id
        ]);
      }

      const pageId = pageIds[index];
      const draftName = `${draftPrefix}/${pageId}.webp`;
      const draftSource = availableMap.get(draftName);
      let sourceFileId = draftSource && draftSource.fileId ? String(draftSource.fileId) : "";
      if (!sourceFileId) {
        const existingSource = existingSourceById.get(pageId);
        sourceFileId = existingSource && existingSource.fileId ? String(existingSource.fileId) : "";
      }
      if (!sourceFileId) {
        throw new Error(
          `Thiếu ảnh cho trang ${index + 1} (có thể draft đã hết hạn). Vui lòng mở Sửa và upload lại.`
        );
      }

      const pageFileName = buildChapterPageFileName({
        pageNumber: index + 1,
        padLength,
        extension: "webp",
        pageFilePrefix
      });
      if (!pageFileName) {
        throw new Error("Tên ảnh trang không hợp lệ.");
      }
      const destinationName = `${finalPrefix}/${pageFileName}`;
      await b2CopyFile({ sourceFileId, destinationFileName: destinationName });
    }
  } catch (err) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: (err && err.message) || "Xử lý ảnh chương thất bại."
    });
    return;
  }

  const doneAt = Date.now();
  try {
    await finalizeChapterProcessingSuccess({
      chapterId: chapterRow.id,
      pageCount: pageIds.length,
      finalPrefix,
      completedAt: doneAt
    });
  } catch (_err) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: "Lưu trạng thái hoàn tất thất bại. Vui lòng thử lại."
    });
    return;
  }
  // Cleanup any leftover pages from previous uploads/edits.
  try {
    await b2DeleteChapterExtraPages({ prefix: finalPrefix, keepPages: pageIds.length, pageFilePrefix });
  } catch (err) {
    console.warn("Chapter extra page cleanup failed", err);
  }

  const previousPrefix = normalizeJsonString(chapterRow.pages_prefix);
  if (previousPrefix && previousPrefix !== finalPrefix) {
    try {
      await b2DeleteAllByPrefix(previousPrefix);
    } catch (err) {
      console.warn("Failed to delete old chapter prefix", err);
    }
  }

  let draftCleared = false;
  try {
    await b2DeleteAllByPrefix(draftPrefix);
    draftCleared = true;
  } catch (err) {
    console.warn("Failed to delete chapter draft prefix", err);
  }

  if (draftCleared) {
    try {
      await deleteChapterDraftRow(token);
    } catch (err) {
      console.warn("Failed to delete chapter draft row", err);
    }
  } else {
    try {
      await touchChapterDraft(token);
    } catch (err) {
      console.warn("Failed to touch chapter draft row", err);
    }
  }
};

const runChapterProcessingQueue = async () => {
  if (chapterProcessingRunning && chapterProcessingActiveWorkers >= chapterProcessingConcurrency) return;
  chapterProcessingRunning = true;

  while (chapterProcessingActiveWorkers < chapterProcessingConcurrency && chapterProcessingQueue.length) {
    const nextId = chapterProcessingQueue.shift();
    chapterProcessingActiveWorkers += 1;

    Promise.resolve()
      .then(async () => {
        try {
          await runChapterProcessingJob(nextId);
        } catch (err) {
          console.warn("Chapter processing job crashed", err);
          const safeId = Number(nextId);
          if (Number.isFinite(safeId) && safeId > 0) {
            try {
              await updateChapterProcessing({
                chapterId: Math.floor(safeId),
                state: "failed",
                error: "Xử lý ảnh chương thất bại."
              });
            } catch (updateErr) {
              console.warn("Failed to persist chapter processing crash status", updateErr);
            }
          }
        } finally {
          chapterProcessingQueued.delete(nextId);
          chapterProcessingActiveWorkers = Math.max(0, chapterProcessingActiveWorkers - 1);

          if (chapterProcessingQueue.length) {
            runChapterProcessingQueue();
          } else if (chapterProcessingActiveWorkers === 0) {
            chapterProcessingRunning = false;
          }
        }
      })
      .catch((err) => {
        console.warn("Chapter processing worker launch failed", err);
        chapterProcessingQueued.delete(nextId);
        chapterProcessingActiveWorkers = Math.max(0, chapterProcessingActiveWorkers - 1);
        if (!chapterProcessingQueue.length && chapterProcessingActiveWorkers === 0) {
          chapterProcessingRunning = false;
        }
      });
  }

  if (!chapterProcessingQueue.length && chapterProcessingActiveWorkers === 0) {
    chapterProcessingRunning = false;
  }
};

const enqueueChapterProcessing = (chapterId) => {
  const id = Number(chapterId);
  if (!Number.isFinite(id) || id <= 0) return;
  const safeId = Math.floor(id);
  if (chapterProcessingQueued.has(safeId)) return;
  chapterProcessingQueued.add(safeId);
  chapterProcessingQueue.push(safeId);
  runChapterProcessingQueue();
};

const resumeChapterProcessingJobs = async () => {
  const batchSize = 200;
  let lastId = 0;

  while (true) {
    const rows = await dbAll(
      "SELECT id FROM chapters WHERE processing_state = 'processing' AND id > ? ORDER BY id ASC LIMIT ?",
      [lastId, batchSize]
    );

    if (!rows.length) break;

    rows.forEach((row) => {
      const id = row ? Number(row.id) : 0;
      if (!Number.isFinite(id) || id <= 0) return;
      const safeId = Math.floor(id);
      enqueueChapterProcessing(safeId);
      if (safeId > lastId) {
        lastId = safeId;
      }
    });

    if (rows.length < batchSize) break;
  }
};

const chapterPageMaxHeight = 1800;
const chapterPageWebpQuality = 77;

const convertChapterPageToWebp = async (inputBuffer) => {
  if (!inputBuffer) return null;
  return sharp(inputBuffer)
    .rotate()
    .resize({
      height: chapterPageMaxHeight,
      withoutEnlargement: true
    })
    .webp({ quality: chapterPageWebpQuality, effort: 6 })
    .toBuffer();
};

  return {
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
    buildChapterPageFileName,
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
  };
};

module.exports = createStorageDomain;
