const {
  CHAPTER_PAGE_MAX_HEIGHT,
  CHAPTER_PAGE_WEBP_QUALITY,
  createConvertChapterPageToWebp
} = require("../utils/chapter-page-webp");
const {
  IMGX_VERSION
} = require("../utils/imgx/constants");
const {
  createSessionKeyGrant,
  decodeImgxForVerification,
  encodeImgx,
  imageIdFromStorageKey
} = require("../utils/imgx/server");

const createStorageDomain = (deps) => {
  const {
    CopyObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
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
  } = deps;

const runStorageTransaction = async (handler) => {
  if (typeof withTransaction === "function") {
    return withTransaction(handler);
  }
  return handler({ dbAll, dbGet, dbRun });
};

const chapterPageMaxHeight = CHAPTER_PAGE_MAX_HEIGHT;
const chapterPageWebpQuality = CHAPTER_PAGE_WEBP_QUALITY;
const convertChapterPageToWebp = createConvertChapterPageToWebp({ sharp });
const convertChapterPageToWebpWithMetadata =
  typeof convertChapterPageToWebp.withMetadata === "function"
    ? convertChapterPageToWebp.withMetadata
    : async (inputBuffer, options = {}) => {
        const buffer = await convertChapterPageToWebp(inputBuffer, options);
        const metadata = buffer ? await sharp(buffer).metadata() : {};
        return {
          buffer,
          width: Number(metadata && metadata.width) || 0,
          height: Number(metadata && metadata.height) || 0
        };
      };

const normalizeImgxMode = (value) => {
  const normalized = (value || "").toString().trim().toLowerCase();
  if (normalized === "imgx") return normalized;
  return "legacy";
};

let lastInvalidImgxStorageExtWarning = "";
const imgxStorageExtensions = Object.freeze(["js", "bin"]);

const normalizeImgxStorageExt = (value) => {
  const normalized = (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "");
  if (normalized === "js" || normalized === "bin") return normalized;
  if (normalized && normalized !== lastInvalidImgxStorageExtWarning) {
    lastInvalidImgxStorageExtWarning = normalized;
    console.warn(`Invalid IMGX_STORAGE_EXT="${normalized}". Falling back to "js".`);
  }
  return "js";
};

const getImgxStorageExt = (value = process.env.IMGX_STORAGE_EXT) => normalizeImgxStorageExt(value);

const isImgxStorageExt = (value) => {
  const normalized = (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "");
  return imgxStorageExtensions.includes(normalized);
};

const getImgxCandidateExts = (preferred) => {
  const first = normalizeImgxStorageExt(preferred || process.env.IMGX_STORAGE_EXT);
  return [first, ...imgxStorageExtensions.filter((extension) => extension !== first)];
};

const getImgxStaleStorageExts = (activeExt) => {
  const safeActiveExt = normalizeImgxStorageExt(activeExt);
  return imgxStorageExtensions.filter((extension) => extension !== safeActiveExt);
};

const getImgxTransferTargetModeForExt = (extension) =>
  normalizeImgxStorageExt(extension) === "bin" ? "imgx-bin" : "imgx-js";

const normalizeImgxRenderMode = (value) => {
  const normalized = (value || "").toString().trim().toLowerCase();
  if (normalized === "single") return "single";
  return "tiles";
};

const getImgxConfig = () => {
  const enabled = parseEnvBoolean(process.env.IMGX_ENABLED, false);
  const uploadMode = normalizeImgxMode(process.env.IMGX_UPLOAD_MODE || (enabled ? "imgx" : "legacy"));
  const secret = (process.env.IMGX_SECRET || "").toString();
  const sessionHmacSecret = (
    process.env.IMGX_SESSION_HMAC_SECRET ||
    process.env.IMGX_HMAC_SECRET ||
    process.env.SESSION_SECRET ||
    ""
  ).toString();
  const ttlMs = Math.max(1000, Math.floor(Number(process.env.IMGX_PAGE_ACCESS_TTL_MS) || 60000));
  const accessWindowMax = Math.max(1, Math.min(20, Math.floor(Number(process.env.IMGX_PAGE_ACCESS_WINDOW_MAX) || 5)));
  const initialPageGrantsText = (process.env.IMGX_INITIAL_PAGE_GRANTS || "").toString().trim();
  const initialPageGrantsRaw = initialPageGrantsText ? Number(initialPageGrantsText) : NaN;
  const initialPageGrants = Math.max(
    0,
    Math.min(
      accessWindowMax,
      5,
      Math.floor(Number.isFinite(initialPageGrantsRaw) ? initialPageGrantsRaw : 3)
    )
  );
  const renderMode = normalizeImgxRenderMode(process.env.IMGX_RENDER_MODE || "tiles");
  const rateLimitWindowMs = Math.max(1000, Math.floor(Number(process.env.IMGX_PAGE_ACCESS_RATE_LIMIT_WINDOW_MS) || 60000));
  const rateLimitMax = Math.max(accessWindowMax, Math.floor(Number(process.env.IMGX_PAGE_ACCESS_RATE_LIMIT_MAX) || 120));
  const storageExt = getImgxStorageExt();
  return {
    enabled,
    uploadMode,
    storageExt,
    secret,
    sessionHmacSecret,
    ttlMs,
    accessWindowMax,
    initialPageGrants,
    renderMode,
    rateLimitWindowMs,
    rateLimitMax
  };
};

const isImgxReady = (config = getImgxConfig()) =>
  Boolean(config && config.secret && config.sessionHmacSecret);

const isImgxUploadEnabled = (config = getImgxConfig()) =>
  Boolean(config && config.enabled && isImgxReady(config) && config.uploadMode === "imgx");

const getChapterImageProcessingApiConfig = () => {
  const baseUrl = normalizeBaseUrl(
    process.env.CHAPTER_IMAGE_PROCESSING_API_URL ||
      process.env.CHAPTER_UPLOAD_API_URL ||
      ""
  );
  const secret = (
    process.env.CHAPTER_IMAGE_PROCESSING_SHARED_SECRET ||
    process.env.CHAPTER_UPLOAD_SHARED_SECRET ||
    process.env.SESSION_SECRET ||
    ""
  ).toString();
  const required = parseEnvBoolean(
    process.env.CHAPTER_IMAGE_PROCESSING_API_REQUIRED ||
      process.env.IMAGE_PROCESSING_API_REQUIRED ||
      false,
    false
  );
  const timeoutMs = Math.max(
    5000,
    Math.min(300000, Math.floor(Number(process.env.CHAPTER_IMAGE_PROCESSING_API_TIMEOUT_MS) || 120000))
  );
  const proofTtlMs = Math.max(
    60000,
    Math.min(30 * 60 * 1000, Math.floor(Number(process.env.CHAPTER_IMAGE_PROCESSING_API_PROOF_TTL_MS) || 5 * 60 * 1000))
  );
  return {
    baseUrl,
    secret,
    required,
    timeoutMs,
    proofTtlMs
  };
};

const normalizeChapterTransferTargetMode = (value) => {
  const normalized = (value || "").toString().trim().toLowerCase();
  if (normalized === "imgx") return getImgxTransferTargetModeForExt(getImgxStorageExt());
  if (normalized === "imgx-js" || normalized === "js") return "imgx-js";
  if (normalized === "imgx-bin" || normalized === "bin") return "imgx-bin";
  if (normalized === "legacy" || normalized === "webp") return "legacy";
  return "";
};

const buildChapterImageProcessingApiProof = ({ sourceKey, destinationKey, targetMode, expiresAtText, secret }) => {
  const safeSourceKey = normalizeB2FileKey(sourceKey);
  const safeDestinationKey = normalizeB2FileKey(destinationKey);
  const safeTargetMode = normalizeChapterTransferTargetMode(targetMode);
  const safeExpiresAt = (expiresAtText == null ? "" : String(expiresAtText)).trim();
  if (!secret || !safeSourceKey || !safeDestinationKey || !safeTargetMode || !/^\d{10,14}$/.test(safeExpiresAt)) {
    return "";
  }
  const payload = `${safeSourceKey}.${safeDestinationKey}.${safeTargetMode}.${safeExpiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `v1.${safeExpiresAt}.${signature}`;
};

const requestChapterImageProcessingApiTransfer = async ({ sourceStorageKey, destinationStorageKey, targetMode }) => {
  const sourceKey = normalizeB2FileKey(sourceStorageKey);
  const destinationKey = normalizeB2FileKey(destinationStorageKey);
  const safeTargetMode = normalizeChapterTransferTargetMode(targetMode);
  const apiConfig = getChapterImageProcessingApiConfig();
  if (!apiConfig.baseUrl || !apiConfig.secret || !sourceKey || !destinationKey || !safeTargetMode) {
    return null;
  }

  const expiresAtText = String(Date.now() + apiConfig.proofTtlMs);
  const proof = buildChapterImageProcessingApiProof({
    sourceKey,
    destinationKey,
    targetMode: safeTargetMode,
    expiresAtText,
    secret: apiConfig.secret
  });
  if (!proof) return null;

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), apiConfig.timeoutMs) : null;
  try {
    const response = await fetch(`${apiConfig.baseUrl}/v1/internal/chapter-pages/transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Chapter-Transfer-Proof": proof
      },
      body: JSON.stringify({
        sourceKey,
        destinationKey,
        targetMode: safeTargetMode
      }),
      signal: controller ? controller.signal : undefined
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.ok !== true) {
      const message = body && body.error ? String(body.error) : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return body.transfer || {
      fileName: destinationKey,
      storageKey: destinationKey,
      targetMode: safeTargetMode
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const runChapterImageProcessingApiTransfer = async (payload) => {
  const apiConfig = getChapterImageProcessingApiConfig();
  if (!apiConfig.baseUrl || !apiConfig.secret) return null;
  try {
    return await requestChapterImageProcessingApiTransfer(payload);
  } catch (err) {
    if (apiConfig.required) throw err;
    console.warn("api_server chapter image processing failed, falling back to web process", err);
    return null;
  }
};

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
  let uploadBuffer = buffer;
  if (!isB2Ready(config) || !key || !uploadBuffer) {
    throw new Error("Upload ảnh thất bại.");
  }

  const s3 = getStorageClient();
  const cacheControlValue = resolveObjectCacheControl(key, cacheControl);
  const payload = {
    Bucket: config.bucketId,
    Key: key,
    Body: uploadBuffer,
    ContentType: contentType || "application/octet-stream"
  };
  if (cacheControlValue) {
    payload.CacheControl = cacheControlValue;
  }
  try {
    await s3.send(
      new PutObjectCommand(payload)
    );
  } finally {
    payload.Body = undefined;
    uploadBuffer = null;
  }

  return {
    fileName: key,
    fileId: key,
    uploadTimestamp: Date.now()
  };
};

const normalizeB2FileKey = (value) => (value || "").toString().trim().replace(/^\/+/, "");

const streamToBuffer = async (body) => {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  if (typeof body.arrayBuffer === "function") {
    return Buffer.from(await body.arrayBuffer());
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const b2DownloadBuffer = async (fileName) => {
  const config = getB2Config();
  const key = normalizeB2FileKey(fileName);
  if (!isB2Ready(config) || !key) {
    throw new Error("Không đọc được ảnh lưu trữ.");
  }

  const s3 = getStorageClient();
  const data = await s3.send(
    new GetObjectCommand({
      Bucket: config.bucketId,
      Key: key
    })
  );
  return streamToBuffer(data && data.Body);
};

const buildB2DirPrefix = (value) => {
  const trimmed = normalizeB2FileKey(value).replace(/\/+$/, "");
  if (!trimmed) return "";
  return `${trimmed}/`;
};

const normalizeB2DirKey = (value) => normalizeB2FileKey(value).replace(/\/+$/, "");

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

const parseChapterPagePreviewNumberFromFileName = (prefixDir, fileName, expectedPageFilePrefix) => {
  if (!prefixDir || !fileName) return null;
  if (!fileName.startsWith(prefixDir)) return null;
  const tail = fileName.slice(prefixDir.length);
  const match = tail.match(/^(\d{1,6})(?:_([a-zA-Z]{5}))?\.preview\.webp$/i);
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

const normalizeChapterPageExtensionSet = (extensions) => {
  if (!Array.isArray(extensions) || !extensions.length) return null;
  const set = new Set();
  extensions.forEach((extension) => {
    const normalized = (extension == null ? "" : String(extension))
      .trim()
      .toLowerCase()
      .replace(/^\.+/, "");
    if (normalized) set.add(normalized);
  });
  return set.size ? set : null;
};

const getChapterPageFileExtension = (fileName) => {
  const tail = (fileName == null ? "" : String(fileName)).trim();
  const dotIndex = tail.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex >= tail.length - 1) return "";
  return tail.slice(dotIndex + 1).toLowerCase();
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

const isStorageDeleteMissingError = (err) => {
  const code = (err && (err.Code || err.code || err.name) ? String(err.Code || err.code || err.name) : "")
    .trim()
    .toLowerCase();
  const status = Number(err && err.$metadata ? err.$metadata.httpStatusCode : NaN);
  return (
    code === "nosuchkey" ||
    code === "nosuchversion" ||
    code === "notfound" ||
    status === 404
  );
};

const storageDeleteBatchSize = Math.min(
  64,
  Math.max(1, Math.floor(Number(process.env.S3_DELETE_BATCH_SIZE) || 16))
);
const storageVersionResolveLimit = Math.max(
  0,
  Math.floor(Number(process.env.S3_DELETE_VERSION_RESOLVE_LIMIT) || 50)
);
const storageListPageSize = Math.min(
  1000,
  Math.max(100, Math.floor(Number(process.env.S3_LIST_PAGE_SIZE) || 1000))
);

const dedupeStorageDeleteEntries = (entries) => {
  const normalized = Array.isArray(entries)
    ? entries
        .map((entry) => ({
          fileName: normalizeB2FileKey(entry && entry.fileName),
          versionId: entry && entry.versionId != null ? String(entry.versionId).trim() : ""
        }))
        .filter((entry) => Boolean(entry.fileName))
    : [];
  if (!normalized.length) return [];

  const deduped = [];
  const seen = new Set();
  normalized.forEach((entry) => {
    const key = `${entry.fileName}@@${entry.versionId}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(entry);
  });

  return deduped;
};

const deleteStorageEntries = async ({ entries, s3, bucketId }) => {
  const safeEntries = dedupeStorageDeleteEntries(entries);
  if (!safeEntries.length) return 0;

  let deleted = 0;
  for (let offset = 0; offset < safeEntries.length; offset += storageDeleteBatchSize) {
    const batch = safeEntries.slice(offset, offset + storageDeleteBatchSize);
    const results = await Promise.all(
      batch.map(async (entry) => {
        const payload = {
          Bucket: bucketId,
          Key: entry.fileName
        };
        if (entry.versionId) {
          payload.VersionId = entry.versionId;
        }

        try {
          await s3.send(new DeleteObjectCommand(payload));
          return true;
        } catch (err) {
          if (isStorageDeleteMissingError(err)) {
            return false;
          }
          throw err;
        }
      })
    );

    deleted += results.reduce((sum, result) => sum + (result ? 1 : 0), 0);
  }

  return deleted;
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
        MaxKeys: storageListPageSize
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

  if (unresolvedKeys.size > storageVersionResolveLimit) {
    unresolvedKeys.forEach((key) => {
      resolvedVersions.push({ fileName: key, versionId: "" });
    });
  } else {
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
  }

  return deleteStorageEntries({
    entries: resolvedVersions,
    s3,
    bucketId: config.bucketId
  });
};

const b2DeleteAllByPrefix = async (prefix) => {
  const config = getB2Config();
  if (!isB2Ready(config)) {
    throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
  }

  const prefixDir = buildB2DirPrefix(prefix);
  if (!prefixDir) return 0;
  const s3 = getStorageClient();
  let deleted = 0;

  try {
    while (true) {
      const payload = {
        Bucket: config.bucketId,
        Prefix: prefixDir,
        MaxKeys: storageListPageSize
      };

      const data = await s3.send(new ListObjectVersionsCommand(payload));
      const versionRows = Array.isArray(data && data.Versions) ? data.Versions : [];
      const markerRows = Array.isArray(data && data.DeleteMarkers) ? data.DeleteMarkers : [];
      const rows = versionRows.concat(markerRows);

      const entries = [];
      rows.forEach((file) => {
        const fileName = file && typeof file.Key === "string" ? file.Key : "";
        if (!fileName || !fileName.startsWith(prefixDir)) return;
        const versionId = file && file.VersionId != null ? String(file.VersionId).trim() : "";
        entries.push({ fileName, versionId });
      });

      deleted += await deleteStorageEntries({
        entries,
        s3,
        bucketId: config.bucketId
      });
      if (!entries.length) break;
    }

    return deleted;
  } catch (err) {
    if (!isStorageVersionListingUnsupported(err)) {
      throw new Error("Không xóa được ảnh lưu trữ.");
    }
  }

  while (true) {
    const payload = {
      Bucket: config.bucketId,
      Prefix: prefixDir,
      MaxKeys: storageListPageSize
    };

    const data = await s3.send(new ListObjectsV2Command(payload));
    const rows = Array.isArray(data && data.Contents) ? data.Contents : [];
    const entries = [];
    rows.forEach((file) => {
      const fileName = file && typeof file.Key === "string" ? file.Key : "";
      if (!fileName || !fileName.startsWith(prefixDir)) return;
      entries.push({ fileName, versionId: "" });
    });

    deleted += await deleteStorageEntries({
      entries,
      s3,
      bucketId: config.bucketId
    });
    if (!entries.length) break;
  }

  return deleted;
};

const b2DeleteChapterExtraPages = async ({ prefix, keepPages, pageFilePrefix, extensions } = {}) => {
  const config = getB2Config();
  if (!isB2Ready(config)) {
    throw new Error("Thiếu cấu hình lưu trữ ảnh trong .env");
  }

  const prefixDir = buildB2DirPrefix(prefix);
  if (!prefixDir) return 0;

  const keep = Math.max(0, Math.floor(Number(keepPages) || 0));
  const versions = await b2ListFileVersionsByPrefix(prefixDir);
  const normalizedFilePrefix = normalizeChapterPageFilePrefix(pageFilePrefix);
  const extensionSet = normalizeChapterPageExtensionSet(extensions);
  const toDelete = versions.filter((version) => {
    const fileName = version && typeof version.fileName === "string" ? version.fileName : "";
    if (extensionSet && !extensionSet.has(getChapterPageFileExtension(fileName))) return false;
    const page = parseChapterPageNumberFromFileName(prefixDir, fileName, normalizedFilePrefix);
    return page != null && page > keep;
  });

  return b2DeleteFileVersions(toDelete);
};

const b2DeleteChapterExtraPagePreviews = async ({ prefix, keepPages, pageFilePrefix }) => {
  const config = getB2Config();
  if (!isB2Ready(config)) {
    throw new Error("Missing storage config.");
  }

  const prefixDir = buildB2DirPrefix(prefix);
  if (!prefixDir) return 0;

  const keep = Math.max(0, Math.floor(Number(keepPages) || 0));
  const versions = await b2ListFileVersionsByPrefix(prefixDir);
  const normalizedFilePrefix = normalizeChapterPageFilePrefix(pageFilePrefix);
  const toDelete = versions.filter((version) => {
    const fileName = version && typeof version.fileName === "string" ? version.fileName : "";
    const page = parseChapterPagePreviewNumberFromFileName(prefixDir, fileName, normalizedFilePrefix);
    return page != null && page > keep;
  });

  return b2DeleteFileVersions(toDelete);
};

const b2DeleteChapterImgxPageArtifacts = async ({ prefix, keepPages, pageFilePrefix, extensions } = {}) => {
  const deletedBins = await b2DeleteChapterExtraPages({
    prefix,
    keepPages,
    pageFilePrefix,
    extensions: normalizeChapterPageExtensionSet(extensions) ? extensions : imgxStorageExtensions
  });
  const deletedPreviews = await b2DeleteChapterExtraPagePreviews({
    prefix,
    keepPages,
    pageFilePrefix
  });
  return deletedBins + deletedPreviews;
};

const b2DeleteChapterLegacyPageArtifacts = async ({ prefix, keepPages = 0, pageFilePrefix } = {}) =>
  b2DeleteChapterExtraPages({
    prefix,
    keepPages,
    pageFilePrefix,
    extensions: ["webp"]
  });

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
      MaxKeys: storageListPageSize
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

const isImgxStorageKey = (value) => /\.(?:bin|js)$/i.test(normalizeB2FileKey(value));

const chapterPagePreviewMaxWidth = Math.max(
  64,
  Math.min(640, Math.floor(Number(process.env.CHAPTER_PAGE_PREVIEW_MAX_WIDTH) || 160))
);
const chapterPagePreviewMaxHeight = Math.max(
  96,
  Math.min(960, Math.floor(Number(process.env.CHAPTER_PAGE_PREVIEW_MAX_HEIGHT) || 240))
);
const chapterPagePreviewWebpQuality = Math.max(
  30,
  Math.min(82, Math.floor(Number(process.env.CHAPTER_PAGE_PREVIEW_WEBP_QUALITY) || 48))
);

const buildChapterPagePreviewStorageKey = (storageKey) => {
  const safeKey = normalizeB2FileKey(storageKey);
  if (!safeKey) return "";
  if (/\.preview\.webp$/i.test(safeKey)) return safeKey;
  const slashIndex = safeKey.lastIndexOf("/");
  const dir = slashIndex >= 0 ? safeKey.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? safeKey.slice(slashIndex + 1) : safeKey;
  const stem = fileName.replace(/\.[^.]+$/, "").trim();
  if (!stem) return "";
  return `${dir}${stem}.preview.webp`;
};

const buildChapterPagePreviewUrl = (storageKey) => {
  const safeKey = normalizeB2FileKey(storageKey);
  const config = getB2Config();
  if (!safeKey || !config.cdnBaseUrl) return "";
  return `${config.cdnBaseUrl}/${safeKey}`;
};

const createChapterPagePreviewWebp = async (webpBuffer) => {
  if (!webpBuffer || !webpBuffer.byteLength) return null;
  const output = await sharp(webpBuffer)
    .rotate()
    .resize({
      width: chapterPagePreviewMaxWidth,
      height: chapterPagePreviewMaxHeight,
      fit: "inside",
      withoutEnlargement: true
    })
    .webp({ quality: chapterPagePreviewWebpQuality, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const info = output && output.info ? output.info : {};
  const buffer = output && output.data ? output.data : null;
  if (!buffer || !buffer.byteLength) return null;
  return {
    buffer,
    width: Number(info.width) || 0,
    height: Number(info.height) || 0
  };
};

const uploadChapterPagePreviewWebp = async ({ webpBuffer, storageKey }) => {
  const safeStorageKey = buildChapterPagePreviewStorageKey(storageKey);
  if (!safeStorageKey) return null;
  const preview = await createChapterPagePreviewWebp(webpBuffer);
  if (!preview || !preview.buffer) return null;
  await b2UploadBuffer({
    fileName: safeStorageKey,
    buffer: preview.buffer,
    contentType: "image/webp",
    cacheControl: defaultImageCacheControl
  });
  return {
    storageKey: safeStorageKey,
    fileName: safeStorageKey,
    url: buildChapterPagePreviewUrl(safeStorageKey),
    width: preview.width,
    height: preview.height,
    byteSize: preview.buffer.byteLength
  };
};

const createInvalidChapterPageImageError = () => {
  const err = new Error("Ảnh trang không hợp lệ.");
  err.code = "IMGX_INVALID_IMAGE";
  return err;
};

const convertChapterUploadBufferToWebpMetadata = async (inputBuffer, { isWebtoon } = {}) => {
  let converted = null;
  try {
    converted = await convertChapterPageToWebpWithMetadata(inputBuffer, { isWebtoon: Boolean(isWebtoon) });
  } catch (_err) {
    throw createInvalidChapterPageImageError();
  }

  const webpBuffer = converted && converted.buffer ? converted.buffer : null;
  if (!webpBuffer || !webpBuffer.byteLength) {
    throw createInvalidChapterPageImageError();
  }

  return converted;
};

const encodeWebpForImgxStorage = ({ webpBuffer, width, height, storageKey, imgxConfig }) => {
  const safeStorageKey = normalizeB2FileKey(storageKey);
  if (!safeStorageKey) throw new Error("Đường dẫn ảnh IMGX không hợp lệ.");
  const config = imgxConfig || getImgxConfig();
  if (!isImgxUploadEnabled(config) && !isImgxReady(config)) {
    throw new Error("IMGX chưa được cấu hình.");
  }
  return encodeImgx({
    webp: webpBuffer,
    width: Math.max(1, Math.floor(Number(width) || 0)),
    height: Math.max(1, Math.floor(Number(height) || 0)),
    imageId: imageIdFromStorageKey(safeStorageKey),
    secret: config.secret
  });
};

const decodeImgxStorageToWebp = async ({ storageKey, imgxConfig }) => {
  const safeStorageKey = normalizeB2FileKey(storageKey);
  if (!safeStorageKey) throw new Error("Đường dẫn ảnh IMGX không hợp lệ.");
  const config = imgxConfig || getImgxConfig();
  if (!isImgxReady(config)) throw new Error("IMGX chưa được cấu hình.");
  const binary = await b2DownloadBuffer(safeStorageKey);
  const decoded = decodeImgxForVerification(binary, imageIdFromStorageKey(safeStorageKey), config.secret);
  return {
    webpBuffer: Buffer.from(decoded.webp),
    width: decoded.width,
    height: decoded.height
  };
};

const uploadWebpAsImgxStorage = async ({ webpBuffer, width, height, storageKey, previewStorageKey, imgxConfig }) => {
  const safeStorageKey = normalizeB2FileKey(storageKey);
  const binary = encodeWebpForImgxStorage({
    webpBuffer,
    width,
    height,
    storageKey: safeStorageKey,
    imgxConfig
  });
  await b2UploadBuffer({
    fileName: safeStorageKey,
    buffer: binary,
    contentType: "application/octet-stream",
    cacheControl: defaultImageCacheControl
  });
  const preview = previewStorageKey
    ? await uploadChapterPagePreviewWebp({
        webpBuffer,
        storageKey: previewStorageKey
      })
    : null;
  return {
    storageKey: safeStorageKey,
    byteSize: binary.byteLength,
    previewStorageKey: preview && preview.storageKey ? preview.storageKey : "",
    previewFileName: preview && preview.fileName ? preview.fileName : "",
    previewUrl: preview && preview.url ? preview.url : "",
    previewByteSize: preview && preview.byteSize ? preview.byteSize : 0,
    previewWidth: preview && preview.width ? preview.width : 0,
    previewHeight: preview && preview.height ? preview.height : 0
  };
};

const uploadProtectedChapterPageBuffer = async ({ inputBuffer, isWebtoon, storageKey, previewStorageKey, imgxConfig }) => {
  const config = imgxConfig || getImgxConfig();
  if (!isImgxUploadEnabled(config)) throw new Error("IMGX upload is not enabled.");
  const converted = await convertChapterUploadBufferToWebpMetadata(inputBuffer, { isWebtoon });
  return uploadWebpAsImgxStorage({
    webpBuffer: converted.buffer,
    width: converted.width,
    height: converted.height,
    storageKey,
    previewStorageKey: previewStorageKey || buildChapterPagePreviewStorageKey(storageKey),
    imgxConfig: config
  });
};

const readSourcePageAsWebp = async ({ storageKey, imgxConfig }) => {
  const safeStorageKey = normalizeB2FileKey(storageKey);
  if (!safeStorageKey) throw new Error("Thiếu ảnh nguồn.");
  if (isImgxStorageKey(safeStorageKey)) {
    return decodeImgxStorageToWebp({ storageKey: safeStorageKey, imgxConfig });
  }
  const webpBuffer = await b2DownloadBuffer(safeStorageKey);
  const metadata = webpBuffer ? await sharp(webpBuffer).metadata() : {};
  return {
    webpBuffer,
    width: Number(metadata && metadata.width) || 1,
    height: Number(metadata && metadata.height) || 1
  };
};

const transcodeChapterPageToImgx = async ({ sourceStorageKey, destinationStorageKey, previewStorageKey, imgxConfig }) => {
  const sourceKey = normalizeB2FileKey(sourceStorageKey);
  const destinationKey = normalizeB2FileKey(destinationStorageKey);
  if (!sourceKey || !destinationKey) throw new Error("Invalid IMGX chapter image path.");
  if (sourceKey === destinationKey && isImgxStorageKey(sourceKey)) {
    const previewKey =
      previewStorageKey === undefined ? buildChapterPagePreviewStorageKey(destinationKey) : previewStorageKey;
    if (!previewKey) return { storageKey: destinationKey, skipped: true };
    const source = await readSourcePageAsWebp({ storageKey: sourceKey, imgxConfig });
    const preview = await uploadChapterPagePreviewWebp({
      webpBuffer: source.webpBuffer,
      storageKey: previewKey
    });
    return {
      storageKey: destinationKey,
      skipped: true,
      previewStorageKey: preview && preview.storageKey ? preview.storageKey : "",
      previewFileName: preview && preview.fileName ? preview.fileName : "",
      previewUrl: preview && preview.url ? preview.url : ""
    };
  }
  const remoteTransfer = previewStorageKey === undefined
    ? await runChapterImageProcessingApiTransfer({
        sourceStorageKey: sourceKey,
        destinationStorageKey: destinationKey,
        targetMode: getImgxTransferTargetModeForExt(getChapterPageFileExtension(destinationKey))
      })
    : null;
  if (remoteTransfer) return remoteTransfer;
  const decoded = await readSourcePageAsWebp({ storageKey: sourceKey, imgxConfig });
  return uploadWebpAsImgxStorage({
    webpBuffer: decoded.webpBuffer,
    width: decoded.width,
    height: decoded.height,
    storageKey: destinationKey,
    previewStorageKey:
      previewStorageKey === undefined ? buildChapterPagePreviewStorageKey(destinationKey) : previewStorageKey,
    imgxConfig
  });
};

const transcodeChapterPageToLegacyWebp = async ({ sourceStorageKey, destinationStorageKey, imgxConfig }) => {
  const sourceKey = normalizeB2FileKey(sourceStorageKey);
  const destinationKey = normalizeB2FileKey(destinationStorageKey);
  if (!sourceKey || !destinationKey) throw new Error("Invalid legacy chapter image path.");
  const remoteTransfer = await runChapterImageProcessingApiTransfer({
    sourceStorageKey: sourceKey,
    destinationStorageKey: destinationKey,
    targetMode: "legacy"
  });
  if (remoteTransfer) return remoteTransfer;
  if (!isImgxStorageKey(sourceKey)) {
    return b2CopyFile({ sourceFileId: sourceKey, destinationFileName: destinationKey });
  }

  const decoded = await readSourcePageAsWebp({ storageKey: sourceKey, imgxConfig });
  await b2UploadBuffer({
    fileName: destinationKey,
    buffer: decoded.webpBuffer,
    contentType: "image/webp",
    cacheControl: defaultImageCacheControl
  });
  return {
    fileName: destinationKey,
    fileId: destinationKey,
    storageKey: destinationKey,
    byteSize: decoded.webpBuffer ? decoded.webpBuffer.byteLength : 0
  };
};

const storeProtectedChapterDraftPage = async ({ token, pageId, inputBuffer, isWebtoon, originalName }) => {
  const safeToken = (token || "").toString().trim();
  const safePageId = (pageId || "").toString().trim();
  if (!isChapterDraftTokenValid(safeToken) || !isChapterDraftPageIdValid(safePageId)) {
    throw new Error("Invalid draft page id.");
  }
  const draft = await getChapterDraft(safeToken);
  const draftPrefix = normalizeJsonString(draft && draft.pages_prefix);
  if (!draftPrefix) throw new Error("Invalid chapter draft.");

  const imgxConfig = getImgxConfig();
  if (!isImgxUploadEnabled(imgxConfig)) throw new Error("IMGX upload is not enabled.");

  const converted = await convertChapterUploadBufferToWebpMetadata(inputBuffer, { isWebtoon });

  const storageKey = `${draftPrefix}/${safePageId}.${getImgxStorageExt(imgxConfig.storageExt)}`;
  const previewStorageKey = buildChapterPagePreviewStorageKey(storageKey);
  const uploaded = await uploadWebpAsImgxStorage({
    webpBuffer: converted.buffer,
    width: converted.width,
    height: converted.height,
    storageKey,
    previewStorageKey,
    imgxConfig
  });
  await touchChapterDraft(safeToken);
  return {
    pageId: safePageId,
    storageKey,
    fileName: storageKey,
    previewStorageKey: uploaded.previewStorageKey || previewStorageKey,
    previewFileName: uploaded.previewFileName || previewStorageKey,
    previewUrl: uploaded.previewUrl || buildChapterPagePreviewUrl(previewStorageKey),
    previewByteSize: uploaded.previewByteSize || 0,
    previewWidth: uploaded.previewWidth || 0,
    previewHeight: uploaded.previewHeight || 0,
    originalName: (originalName || "").toString().trim().slice(0, 240),
    codecVersion: IMGX_VERSION
  };
};

const deleteProtectedChapterDraftPage = async ({ token, pageId }) => {
  const safeToken = (token || "").toString().trim();
  const safePageId = (pageId || "").toString().trim();
  if (!isChapterDraftTokenValid(safeToken) || !isChapterDraftPageIdValid(safePageId)) return 0;
  const draft = await getChapterDraft(safeToken);
  const draftPrefix = normalizeJsonString(draft && draft.pages_prefix);
  if (!draftPrefix) return 0;
  const protectedTargets = getImgxCandidateExts().map((extension) => `${draftPrefix}/${safePageId}.${extension}`);
  const previewTargets = protectedTargets.map((target) => buildChapterPagePreviewStorageKey(target)).filter(Boolean);
  const legacyTarget = `${draftPrefix}/${safePageId}.webp`;
  let deleted = 0;
  try {
    const versions = [];
    for (const target of Array.from(new Set([legacyTarget, ...protectedTargets, ...previewTargets]))) {
      versions.push(...await b2ListFileVersionsByPrefix(target));
    }
    deleted = await b2DeleteFileVersions(versions);
  } finally {
    await touchChapterDraft(safeToken);
  }
  return deleted;
};

const createImgxPageGrant = ({ storageKey, sessionId, imgxConfig }) => {
  const safeStorageKey = normalizeB2FileKey(storageKey);
  const config = imgxConfig || getImgxConfig();
  if (!isImgxReady(config)) throw new Error("IMGX chưa được cấu hình.");
  return createSessionKeyGrant({
    imageId: imageIdFromStorageKey(safeStorageKey),
    storageKey: safeStorageKey,
    sessionId: (sessionId || "").toString(),
    imgxSecret: config.secret,
    hmacSecret: config.sessionHmacSecret,
    ttlMs: config.ttlMs
  });
};

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
    SELECT token, manga_id, pages_prefix
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
    const mangaId = Number(row && row.manga_id);
    const prefix = row && typeof row.pages_prefix === "string" ? row.pages_prefix : "";
    if (!isChapterDraftTokenValid(token) || !prefix) {
      continue;
    }

    if (!isExpectedChapterDraftPrefix({ prefix, mangaId, token })) {
      console.warn("Skip chapter draft cleanup for unexpected prefix", { token, mangaId, prefix });
      continue;
    }

    try {
      await b2DeleteAllByPrefixIfUnreferenced(prefix, {
        reason: "chapter-draft-cleanup"
      });
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
  Math.floor(Number(process.env.CHAPTER_PROCESSING_STALE_MS) || 2 * 60 * 1000)
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
        job.result = await job.run();
        job.state = "done";
        job.error = "";
      } catch (err) {
        console.warn("Admin job failed", { id: job.id, type: job.type, message: err && err.message });
        job.state = "failed";
        job.error = normalizeAdminJobError(err);
        job.result = null;
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
    result: null,
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

const removeMangaIdFromHomepageFeatured = async ({ mangaId, dbGetFn = dbGet, dbRunFn = dbRun }) => {
  const safeMangaId = Number(mangaId);
  if (!Number.isFinite(safeMangaId) || safeMangaId <= 0) return;

  const homepageRow = await dbGetFn("SELECT featured_ids FROM homepage WHERE id = 1 LIMIT 1").catch(() => null);
  const rawFeaturedIds = homepageRow && homepageRow.featured_ids ? String(homepageRow.featured_ids) : "";
  if (!rawFeaturedIds.trim()) return;

  const nextFeaturedIds = rawFeaturedIds
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value))
    .filter((value, index, list) => list.indexOf(value) === index)
    .filter((value) => value !== Math.floor(safeMangaId));

  const nextValue = nextFeaturedIds.join(",");
  if (nextValue === rawFeaturedIds.trim()) return;

  await dbRunFn("UPDATE homepage SET featured_ids = ?, updated_at = ? WHERE id = 1", [
    nextValue,
    new Date().toISOString(),
  ]).catch(() => null);
};

const softDeleteChapter = async (chapterId) => {
  const id = Number(chapterId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Không tìm thấy chương");
  }

  const safeChapterId = Math.floor(id);
  const chapterRow = await dbGet(
    `
      SELECT id, manga_id
      FROM chapters
      WHERE id = ?
        AND COALESCE(is_deleted, false) = false
      LIMIT 1
    `,
    [safeChapterId]
  );
  if (!chapterRow) {
    throw new Error("Không tìm thấy chương");
  }

  const deletedAt = Date.now();
  await runStorageTransaction(async ({ dbRun: txRun }) => {
    await txRun(
      `
        UPDATE chapters
        SET
          is_deleted = true,
          deleted_at = ?,
          processing_state = CASE
            WHEN COALESCE(processing_state, '') = 'processing' THEN 'deleted'
            ELSE processing_state
          END
        WHERE id = ?
          AND COALESCE(is_deleted, false) = false
      `,
      [deletedAt, safeChapterId]
    );
    await txRun(
      `
        UPDATE manga AS m
        SET updated_at = COALESCE(
          (
            SELECT MAX(c.date)
            FROM chapters c
            WHERE c.manga_id = m.id
              AND COALESCE(c.is_deleted, false) = false
          ),
          m.created_at,
          m.updated_at
        )
        WHERE m.id = ?
          AND COALESCE(m.is_deleted, false) = false
      `,
      [chapterRow.manga_id]
    );
  });

  return { mangaId: Number(chapterRow.manga_id) || 0 };
};

const softDeleteManga = async (mangaId) => {
  const id = Number(mangaId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Không tìm thấy truyện");
  }

  const safeMangaId = Math.floor(id);
  const mangaRow = await dbGet(
    `
      SELECT id
      FROM manga
      WHERE id = ?
        AND COALESCE(is_deleted, false) = false
      LIMIT 1
    `,
    [safeMangaId]
  );
  if (!mangaRow) {
    throw new Error("Không tìm thấy truyện");
  }

  const deletedAt = Date.now();
  await runStorageTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
    await txRun(
      `
        UPDATE chapters
        SET
          is_deleted = true,
          deleted_at = ?,
          processing_state = CASE
            WHEN COALESCE(processing_state, '') = 'processing' THEN 'deleted'
            ELSE processing_state
          END
        WHERE manga_id = ?
          AND COALESCE(is_deleted, false) = false
      `,
      [deletedAt, safeMangaId]
    );
    await txRun(
      `
        UPDATE manga
        SET
          is_deleted = true,
          deleted_at = ?,
          is_hidden = 1
        WHERE id = ?
          AND COALESCE(is_deleted, false) = false
      `,
      [deletedAt, safeMangaId]
    );
    await removeMangaIdFromHomepageFeatured({
      mangaId: safeMangaId,
      dbGetFn: txGet,
      dbRunFn: txRun,
    });
  });
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
      await b2DeleteAllByPrefixIfUnreferenced(prefix, {
        reason: "delete-chapter",
        ignoreChapterIds: [chapterRow.id]
      });
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

  const normalizedRootPrefix = normalizeB2DirKey(rootPrefix);
  const normalizedTmpPrefix = normalizeB2DirKey(tmpPrefix);
  for (const prefix of prefixesToDelete) {
    if (!prefix) continue;
    const normalizedPrefix = normalizeB2DirKey(prefix);
    const isOwnedMangaPrefix =
      normalizedPrefix === normalizedRootPrefix ||
      normalizedPrefix === normalizedTmpPrefix ||
      (normalizedRootPrefix && normalizedPrefix.startsWith(`${normalizedRootPrefix}/`)) ||
      (normalizedTmpPrefix && normalizedPrefix.startsWith(`${normalizedTmpPrefix}/`));
    if (isOwnedMangaPrefix) {
      await b2DeleteAllByPrefix(prefix);
    } else {
      await b2DeleteAllByPrefixIfUnreferenced(prefix, {
        reason: "delete-manga-extra-prefix"
      });
    }
  }

  await dbRun("DELETE FROM manga WHERE id = ?", [safeMangaId]);
};

const updateChapterProcessing = async ({ chapterId, state, error, donePages, totalPages }) => {
  const id = Number(chapterId);
  if (!Number.isFinite(id) || id <= 0) return;
  const safeState = (state || "").toString().trim();
  const safeError = (error || "").toString().trim();

  const hasDonePages = donePages !== undefined;
  const hasTotalPages = totalPages !== undefined;
  const normalizedDonePages = hasDonePages
    ? Number.isFinite(Number(donePages)) && Number(donePages) >= 0
      ? Math.floor(Number(donePages))
      : null
    : null;
  const normalizedTotalPages = hasTotalPages
    ? Number.isFinite(Number(totalPages)) && Number(totalPages) >= 0
      ? Math.floor(Number(totalPages))
      : null
    : null;

  const updateSql = [
    "UPDATE chapters",
    "SET processing_state = ?, processing_error = ?, processing_updated_at = ?"
  ];
  const params = [safeState, safeError, Date.now()];

  if (hasDonePages) {
    updateSql.push(", processing_done_pages = ?");
    params.push(normalizedDonePages);
  }
  if (hasTotalPages) {
    updateSql.push(", processing_total_pages = ?");
    params.push(normalizedTotalPages);
  }

  updateSql.push("WHERE id = ?");
  params.push(Math.floor(id));
  await dbRun(updateSql.join(" "), params);
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
      processing_done_pages = NULL,
      processing_total_pages = NULL,
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

const parseMangaIdFromChapterStoragePrefix = (prefix) => {
  const config = getB2Config();
  const safePrefix = normalizeB2DirKey(prefix);
  const base = normalizeB2DirKey(config.chapterPrefix || "chapters") || "chapters";
  if (!safePrefix || !safePrefix.startsWith(`${base}/manga-`)) return 0;
  const rest = safePrefix.slice(`${base}/manga-`.length);
  const match = rest.match(/^(\d+)(?:\/|$)/);
  if (!match) return 0;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0;
};

const isExpectedChapterDraftPrefix = ({ prefix, mangaId, token }) => {
  const expected = buildChapterDraftPrefix(mangaId, token);
  return Boolean(expected && normalizeB2DirKey(prefix) === normalizeB2DirKey(expected));
};

const findActiveChapterReferencesForStoragePrefix = async (prefix, { ignoreChapterIds = [] } = {}) => {
  const safePrefix = normalizeB2DirKey(prefix);
  if (!safePrefix) return [];

  const ignored = new Set(
    (Array.isArray(ignoreChapterIds) ? ignoreChapterIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.floor(value))
  );
  const mangaId = parseMangaIdFromChapterStoragePrefix(safePrefix);
  const rows = mangaId > 0
    ? await dbAll(
        `
        SELECT id, manga_id, number, pages_prefix
        FROM chapters
        WHERE COALESCE(is_deleted, false) = false
          AND (TRIM(COALESCE(pages_prefix, '')) = ? OR manga_id = ?)
      `,
        [safePrefix, mangaId]
      )
    : await dbAll(
        `
        SELECT id, manga_id, number, pages_prefix
        FROM chapters
        WHERE COALESCE(is_deleted, false) = false
          AND TRIM(COALESCE(pages_prefix, '')) = ?
      `,
        [safePrefix]
      );

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const chapterId = Number(row && row.id);
    if (Number.isFinite(chapterId) && ignored.has(Math.floor(chapterId))) return false;

    const storedPrefix = normalizeB2DirKey(row && row.pages_prefix);
    if (storedPrefix && storedPrefix === safePrefix) return true;

    const finalPrefix = buildChapterProcessingFinalPrefix(row && row.manga_id, row && row.number);
    return Boolean(finalPrefix && normalizeB2DirKey(finalPrefix) === safePrefix);
  });
};

const b2DeleteAllByPrefixIfUnreferenced = async (prefix, options = {}) => {
  const safePrefix = normalizeB2DirKey(prefix);
  if (!safePrefix) return 0;

  const references = await findActiveChapterReferencesForStoragePrefix(safePrefix, options);
  if (references.length) {
    console.warn("Skip storage prefix delete because an active chapter still references it", {
      prefix: safePrefix,
      reason: options && options.reason ? String(options.reason) : "",
      activeChapterIds: references
        .map((row) => Number(row && row.id))
        .filter((value) => Number.isFinite(value) && value > 0)
        .slice(0, 10)
    });
    return 0;
  }

  return b2DeleteAllByPrefix(safePrefix);
};

const b2DeleteChapterImgxPageArtifactsIfUnreferenced = async ({
  prefix,
  keepPages = 0,
  pageFilePrefix,
  ignoreChapterIds = [],
  reason = ""
} = {}) => {
  const safePrefix = normalizeB2DirKey(prefix);
  if (!safePrefix) return 0;

  const references = await findActiveChapterReferencesForStoragePrefix(safePrefix, { ignoreChapterIds });
  if (references.length) {
    console.warn("Skip IMGX page artifact cleanup because an active chapter still references the prefix", {
      prefix: safePrefix,
      reason: reason ? String(reason) : "",
      activeChapterIds: references
        .map((row) => Number(row && row.id))
        .filter((value) => Number.isFinite(value) && value > 0)
        .slice(0, 10)
    });
    return 0;
  }

  return b2DeleteChapterImgxPageArtifacts({
    prefix: safePrefix,
    keepPages,
    pageFilePrefix
  });
};

const b2DeleteChapterLegacyPageArtifactsIfUnreferenced = async ({
  prefix,
  keepPages = 0,
  pageFilePrefix,
  ignoreChapterIds = [],
  reason = ""
} = {}) => {
  const safePrefix = normalizeB2DirKey(prefix);
  if (!safePrefix) return 0;

  const references = await findActiveChapterReferencesForStoragePrefix(safePrefix, { ignoreChapterIds });
  if (references.length) {
    console.warn("Skip legacy page artifact cleanup because an active chapter still references the prefix", {
      prefix: safePrefix,
      reason: reason ? String(reason) : "",
      activeChapterIds: references
        .map((row) => Number(row && row.id))
        .filter((value) => Number.isFinite(value) && value > 0)
        .slice(0, 10)
    });
    return 0;
  }

  return b2DeleteChapterLegacyPageArtifacts({
    prefix: safePrefix,
    keepPages,
    pageFilePrefix
  });
};

const getLatestChapterPagesByNumber = async ({ prefix, pageFilePrefix, requiredExtension = "" }) => {
  const prefixDir = buildB2DirPrefix(prefix);
  if (!prefixDir) return new Map();

  const files = await b2ListFileNamesByPrefix(prefixDir);
  const latestByPage = new Map();
  const safeRequiredExtension = normalizeJsonString(requiredExtension).toLowerCase().replace(/^\./, "");
  files.forEach((file) => {
    const fileName = file && typeof file.fileName === "string" ? file.fileName : "";
    if (safeRequiredExtension && getChapterPageFileExtension(fileName) !== safeRequiredExtension) return;
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

const finalizeChapterProcessingSuccess = async ({
  chapterId,
  pageCount,
  finalPrefix,
  completedAt,
  pagesExt = "webp",
  pageDeliveryMode = "legacy"
}) => {
  const doneAt = Number.isFinite(Number(completedAt)) && Number(completedAt) > 0 ? Number(completedAt) : Date.now();
  const doneDate = new Date(doneAt).toISOString();
  const safePagesExt = (pagesExt || "webp").toString().trim().toLowerCase() || "webp";
  const safeDeliveryMode = (pageDeliveryMode || (isImgxStorageExt(safePagesExt) ? "imgx" : "legacy")).toString().trim().toLowerCase();
  await dbRun(
    `
    UPDATE chapters
    SET
      pages = ?,
      pages_prefix = ?,
      pages_ext = ?,
      page_delivery_mode = ?,
      pages_updated_at = ?,
      date = ?,
      processing_state = NULL,
      processing_error = NULL,
      processing_draft_token = NULL,
      processing_pages_json = NULL,
      processing_done_pages = NULL,
      processing_total_pages = NULL,
      processing_updated_at = ?
    WHERE id = ?
  `,
    [pageCount, finalPrefix, safePagesExt, safeDeliveryMode, doneAt, doneDate, doneAt, chapterId]
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
    latestByPage = await getLatestChapterPagesByNumber({
      prefix: finalPrefix,
      pageFilePrefix,
      requiredExtension: "webp"
    });
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
    await b2DeleteChapterExtraPages({
      prefix: finalPrefix,
      keepPages: expectedCount,
      pageFilePrefix,
      extensions: ["webp"]
    });
    await b2DeleteChapterImgxPageArtifacts({ prefix: finalPrefix, keepPages: 0, pageFilePrefix });
  } catch (err) {
    console.warn("Chapter extra page cleanup failed during reconcile", err);
  }

  const previousPrefix = normalizeJsonString(chapterRow.pages_prefix);
  if (previousPrefix && previousPrefix !== finalPrefix) {
    try {
      await b2DeleteAllByPrefixIfUnreferenced(previousPrefix, {
        reason: "chapter-reconcile-old-prefix",
        ignoreChapterIds: [chapterRow.id]
      });
    } catch (err) {
      console.warn("Failed to delete old chapter prefix during reconcile", err);
    }
  }

  if (draftPrefix) {
    let draftCleared = false;
    try {
      if (!isExpectedChapterDraftPrefix({ prefix: draftPrefix, mangaId: chapterRow.manga_id, token })) {
        throw new Error("Unexpected chapter draft prefix.");
      }
      await b2DeleteAllByPrefixIfUnreferenced(draftPrefix, {
        reason: "chapter-reconcile-draft-prefix"
      });
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
      pages_ext,
      page_delivery_mode,
      pages_file_prefix,
      processing_state,
      processing_draft_token,
      processing_pages_json,
      processing_done_pages,
      processing_total_pages,
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

  await updateChapterProcessing({
    chapterId: chapterRow.id,
    state: "processing",
    error: "",
    donePages: 0,
    totalPages: pageIds.length
  });
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
  const imgxConfig = getImgxConfig();
  // Upload target follows the current env. Existing .bin chapters stay readable,
  // but saving edited pages while IMGX upload is disabled must finalize as legacy WebP.
  const shouldUseImgxProcessing = isImgxUploadEnabled(imgxConfig);
  const imgxPagesExt = getImgxStorageExt(imgxConfig.storageExt);

  if (!shouldUseImgxProcessing) {
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

  const shouldSnapshotExistingSources = Boolean(existingPrefix && existingPrefix === finalPrefix);
  if (shouldSnapshotExistingSources && existingSourceById.size) {
    const snapshotPrefix = `${draftPrefix}/existing-snapshot`;
    const snapshotIds = Array.from(new Set(pageIds.filter((pageId) => existingSourceById.has(pageId))));

    try {
      for (let index = 0; index < snapshotIds.length; index += 1) {
        const pageId = snapshotIds[index];
        const existingSource = existingSourceById.get(pageId);
        const sourceFileId = existingSource && existingSource.fileId ? String(existingSource.fileId) : "";
        if (!sourceFileId) {
          throw new Error("Không đọc được ảnh chương hiện tại để sắp xếp lại.");
        }

        const snapshotFileName = `${snapshotPrefix}/${pageId}.${shouldUseImgxProcessing ? imgxPagesExt : "webp"}`;
        const copied = shouldUseImgxProcessing
          ? await transcodeChapterPageToImgx({
              sourceStorageKey: sourceFileId,
              destinationStorageKey: snapshotFileName,
              imgxConfig
            })
          : await transcodeChapterPageToLegacyWebp({
              sourceStorageKey: sourceFileId,
              destinationStorageKey: snapshotFileName,
              imgxConfig
            });

        existingSourceById.set(pageId, {
          fileName: copied.fileName || copied.storageKey || snapshotFileName,
          fileId: copied.fileId || copied.storageKey || snapshotFileName,
          uploadTimestamp: Date.now()
        });
      }
    } catch (err) {
      await updateChapterProcessing({
        chapterId: chapterRow.id,
        state: "failed",
        error: (err && err.message) || "Không thể tạo bản sao tạm để sắp xếp lại ảnh chương."
      });
      return;
    }
  }

  let donePages = 0;
  const totalPages = pageIds.length;

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
      const draftImgxNames = getImgxCandidateExts(imgxPagesExt).map((extension) => `${draftPrefix}/${pageId}.${extension}`);
      const draftLegacyName = `${draftPrefix}/${pageId}.webp`;
      const draftSourceCandidates = shouldUseImgxProcessing
        ? [...draftImgxNames, draftLegacyName]
        : [draftLegacyName, ...draftImgxNames];
      const draftSource = draftSourceCandidates.map((name) => availableMap.get(name)).find(Boolean);
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
        extension: shouldUseImgxProcessing ? imgxPagesExt : "webp",
        pageFilePrefix
      });
      if (!pageFileName) {
        throw new Error("Tên ảnh trang không hợp lệ.");
      }
      const destinationName = `${finalPrefix}/${pageFileName}`;
      if (shouldUseImgxProcessing) {
        await transcodeChapterPageToImgx({
          sourceStorageKey: sourceFileId,
          destinationStorageKey: destinationName,
          imgxConfig
        });
      } else {
        await transcodeChapterPageToLegacyWebp({
          sourceStorageKey: sourceFileId,
          destinationStorageKey: destinationName,
          imgxConfig
        });
      }
      donePages = index + 1;
      await updateChapterProcessing({
        chapterId: chapterRow.id,
        state: "processing",
        error: "",
        donePages,
        totalPages
      });
    }
  } catch (err) {
    await updateChapterProcessing({
      chapterId: chapterRow.id,
      state: "failed",
      error: (err && err.message) || "Xử lý ảnh chương thất bại.",
      donePages,
      totalPages
    });
    return;
  }

  const doneAt = Date.now();
  try {
    await finalizeChapterProcessingSuccess({
      chapterId: chapterRow.id,
      pageCount: pageIds.length,
      finalPrefix,
      completedAt: doneAt,
      pagesExt: shouldUseImgxProcessing ? imgxPagesExt : "webp",
      pageDeliveryMode: shouldUseImgxProcessing ? "imgx" : "legacy"
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
    if (shouldUseImgxProcessing) {
      await b2DeleteChapterImgxPageArtifacts({
        prefix: finalPrefix,
        keepPages: pageIds.length,
        pageFilePrefix,
        extensions: [imgxPagesExt]
      });
      await b2DeleteChapterExtraPages({
        prefix: finalPrefix,
        keepPages: 0,
        pageFilePrefix,
        extensions: getImgxStaleStorageExts(imgxPagesExt)
      });
      await b2DeleteChapterLegacyPageArtifactsIfUnreferenced({
        prefix: finalPrefix,
        keepPages: 0,
        pageFilePrefix,
        reason: "chapter-processing-final-legacy-prefix",
        ignoreChapterIds: [chapterRow.id]
      });
    } else {
      await b2DeleteChapterExtraPages({
        prefix: finalPrefix,
        keepPages: pageIds.length,
        pageFilePrefix,
        extensions: ["webp"]
      });
      await b2DeleteChapterImgxPageArtifacts({ prefix: finalPrefix, keepPages: 0, pageFilePrefix });
    }
  } catch (err) {
    console.warn("Chapter extra page cleanup failed", err);
  }

  const previousPrefix = normalizeJsonString(chapterRow.pages_prefix);
  if (previousPrefix && previousPrefix !== finalPrefix) {
    try {
      if (shouldUseImgxProcessing) {
        await b2DeleteChapterImgxPageArtifactsIfUnreferenced({
          prefix: previousPrefix,
          keepPages: 0,
          pageFilePrefix,
          reason: "chapter-processing-old-imgx-prefix",
          ignoreChapterIds: [chapterRow.id]
        });
        await b2DeleteChapterLegacyPageArtifactsIfUnreferenced({
          prefix: previousPrefix,
          keepPages: 0,
          pageFilePrefix,
          reason: "chapter-processing-old-legacy-prefix",
          ignoreChapterIds: [chapterRow.id]
        });
      } else {
        await b2DeleteAllByPrefixIfUnreferenced(previousPrefix, {
          reason: "chapter-processing-old-prefix",
          ignoreChapterIds: [chapterRow.id]
        });
      }
    } catch (err) {
      console.warn("Failed to delete old chapter prefix", err);
    }
  }

  let draftCleared = false;
  try {
    if (!isExpectedChapterDraftPrefix({ prefix: draftPrefix, mangaId: chapterRow.manga_id, token })) {
      throw new Error("Unexpected chapter draft prefix.");
    }
    await b2DeleteAllByPrefixIfUnreferenced(draftPrefix, {
      reason: "chapter-processing-draft-prefix"
    });
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

const reconcileStaleChapterProcessingById = async (chapterId) => {
  const id = Number(chapterId);
  if (!Number.isFinite(id) || id <= 0) return false;

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
      processing_total_pages,
      processing_updated_at
    FROM chapters
    WHERE id = ?
    LIMIT 1
  `,
    [Math.floor(id)]
  );

  if (!chapterRow || !chapterRow.id) return false;
  const state = normalizeJsonString(chapterRow.processing_state);
  if (state !== "processing") return false;

  let pageIds = parseJsonArrayOfStrings(chapterRow.processing_pages_json);
  if (!pageIds.length) {
    const fallbackTotalRaw = Number(chapterRow.processing_total_pages);
    const fallbackTotalFromPagesRaw = Number(chapterRow.pages);
    const fallbackTotal =
      Number.isFinite(fallbackTotalRaw) && fallbackTotalRaw > 0
        ? Math.floor(fallbackTotalRaw)
        : Number.isFinite(fallbackTotalFromPagesRaw) && fallbackTotalFromPagesRaw > 0
          ? Math.floor(fallbackTotalFromPagesRaw)
          : 0;

    if (fallbackTotal > 0) {
      pageIds = Array.from({ length: fallbackTotal }, (_value, index) => `reconcile-${index + 1}`);
    }
  }

  if (!pageIds.length) return false;

  const token = normalizeJsonString(chapterRow.processing_draft_token);
  let draftPrefix = "";
  if (isChapterDraftTokenValid(token)) {
    const draftRow = await getChapterDraft(token);
    draftPrefix = normalizeJsonString(draftRow && draftRow.pages_prefix);
  }

  const processingUpdatedAt = Number(chapterRow.processing_updated_at);
  const safeChapterRow =
    Number.isFinite(processingUpdatedAt) && processingUpdatedAt > 0
      ? chapterRow
      : {
          ...chapterRow,
          processing_updated_at: Date.now() - chapterProcessingStaleMs - 1000
        };

  try {
    return await tryReconcileStaleChapterProcessing({
      chapterRow: safeChapterRow,
      pageIds,
      pageFilePrefix: chapterRow.pages_file_prefix,
      draftPrefix,
      token
    });
  } catch (_err) {
    return false;
  }
};

  return {
    adminJobs,
    adminJobsQueue,
    adminJobsRunning,
    b2CopyFile,
    b2DeleteAllByPrefix,
    b2DeleteAllByPrefixIfUnreferenced,
    b2DeleteChapterImgxPageArtifacts,
    b2DeleteChapterImgxPageArtifactsIfUnreferenced,
    b2DeleteChapterLegacyPageArtifacts,
    b2DeleteChapterLegacyPageArtifactsIfUnreferenced,
    b2DeleteChapterExtraPages,
    b2DeleteChapterExtraPagePreviews,
    b2DeleteFileVersions,
    b2DownloadBuffer,
    b2ListFileNamesByPrefix,
    b2ListFileVersionsByPrefix,
    b2UploadBuffer,
    buildB2DirPrefix,
    buildChapterPageFileName,
    buildChapterPagePreviewStorageKey,
    buildChapterPagePreviewUrl,
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
    convertChapterPageToWebpWithMetadata,
    createAdminJob,
    createAdminJobId,
    createChapterDraft,
    createChapterDraftToken,
    createChapterPagePreviewWebp,
    createImgxPageGrant,
    deleteChapterAndCleanupStorage,
    deleteChapterDraftRow,
    deleteProtectedChapterDraftPage,
    deleteMangaAndCleanupStorage,
    encodeS3CopySource,
    enqueueChapterProcessing,
    getB2Config,
    getChapterDraft,
    getImgxConfig,
    getImgxCandidateExts,
    getImgxStaleStorageExts,
    getImgxStorageExt,
    getStorageClient,
    isB2Ready,
    isChapterDraftPageIdValid,
    isChapterDraftTokenValid,
    isImgxReady,
    isImgxStorageExt,
    isImgxUploadEnabled,
    storeProtectedChapterDraftPage,
    transcodeChapterPageToImgx,
    isStorageVersionListingUnsupported,
    normalizeAdminJobError,
    normalizeImgxStorageExt,
    normalizeB2FileKey,
    normalizeJsonString,
    parseChapterPageNumberFromFileName,
    parseChapterPagePreviewNumberFromFileName,
    parseJsonArrayOfStrings,
    pruneAdminJobs,
    reconcileStaleChapterProcessingById,
    resumeChapterProcessingJobs,
    runAdminJobsQueue,
    runChapterProcessingJob,
    runChapterProcessingQueue,
    scheduleChapterDraftCleanup,
    softDeleteChapter,
    softDeleteManga,
    storageClientCache,
    touchChapterDraft,
    updateChapterProcessing,
    uploadProtectedChapterPageBuffer,
  };
};

module.exports = createStorageDomain;
