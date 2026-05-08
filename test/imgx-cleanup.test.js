const test = require("node:test");
const assert = require("node:assert/strict");

const createStorageDomain = require("../src/domains/storage-domain");

const previousEnv = {
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_CHAPTER_PREFIX: process.env.S3_CHAPTER_PREFIX,
  S3_DELETE_VERSION_RESOLVE_LIMIT: process.env.S3_DELETE_VERSION_RESOLVE_LIMIT,
  IMGX_ENABLED: process.env.IMGX_ENABLED,
  IMGX_UPLOAD_MODE: process.env.IMGX_UPLOAD_MODE,
  IMGX_STORAGE_EXT: process.env.IMGX_STORAGE_EXT,
  IMGX_SECRET: process.env.IMGX_SECRET,
  IMGX_SESSION_HMAC_SECRET: process.env.IMGX_SESSION_HMAC_SECRET,
  IMGX_HMAC_SECRET: process.env.IMGX_HMAC_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET
};

class FakeListObjectVersionsCommand {
  constructor(input) {
    this.input = input;
  }
}

class FakeDeleteObjectCommand {
  constructor(input) {
    this.input = input;
  }
}

class FakeS3Client {
  constructor() {}

  async send(command) {
    if (command instanceof FakeListObjectVersionsCommand) {
      const prefix = command.input && command.input.Prefix ? String(command.input.Prefix) : "";
      return {
        Versions: FakeS3Client.objects.filter((object) => object.Key.startsWith(prefix)),
        DeleteMarkers: [],
        IsTruncated: false
      };
    }
    if (command instanceof FakeDeleteObjectCommand) {
      FakeS3Client.deleted.push(command.input);
      return {};
    }
    throw new Error("Unexpected fake S3 command");
  }
}

FakeS3Client.objects = [];
FakeS3Client.deleted = [];

const makeStorageDomain = ({ dbAll = async () => [] } = {}) => {
  process.env.S3_BUCKET = "unit-bucket";
  process.env.S3_ACCESS_KEY_ID = "unit-key";
  process.env.S3_SECRET_ACCESS_KEY = "unit-secret";
  process.env.S3_ENDPOINT = "https://s3.example.test";
  process.env.S3_CHAPTER_PREFIX = "chapters";
  process.env.S3_DELETE_VERSION_RESOLVE_LIMIT = "50";
  FakeS3Client.deleted = [];

  const sharp = () => ({
    rotate: () => ({
      metadata: async () => ({ width: 1 }),
      resize: () => ({
        webp: () => ({ toBuffer: async () => ({ data: Buffer.from("x"), info: { width: 1, height: 1 } }) })
      }),
      webp: () => ({ toBuffer: async () => ({ data: Buffer.from("x"), info: { width: 1, height: 1 } }) })
    })
  });

  return createStorageDomain({
    CopyObjectCommand: class {},
    DeleteObjectCommand: FakeDeleteObjectCommand,
    GetObjectCommand: class {},
    ListObjectVersionsCommand: FakeListObjectVersionsCommand,
    ListObjectsV2Command: class {},
    PutObjectCommand: class {},
    S3Client: FakeS3Client,
    crypto: require("node:crypto"),
    dbAll,
    dbGet: async () => null,
    dbRun: async () => ({}),
    normalizeBaseUrl: (value) => String(value || "").trim().replace(/\/+$/, ""),
    normalizePathPrefix: (value) => String(value || "").trim().replace(/^\/+|\/+$/g, ""),
    parseEnvBoolean: (value, fallback = false) => {
      if (value == null || value === "") return fallback;
      return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
    },
    withTransaction: null,
    sharp
  });
};

test.afterEach(() => {
  Object.keys(previousEnv).forEach((key) => {
    if (previousEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previousEnv[key];
    }
  });
  FakeS3Client.objects = [];
  FakeS3Client.deleted = [];
});

test("IMGX extra-page cleanup deletes stale .bin but preserves legacy .webp backup", async () => {
  FakeS3Client.objects = [
    { Key: "chapters/manga-1/ch-1/001_abcDE.bin", VersionId: "bin-1" },
    { Key: "chapters/manga-1/ch-1/002_abcDE.bin", VersionId: "bin-2" },
    { Key: "chapters/manga-1/ch-1/003_abcDE.bin", VersionId: "bin-3" },
    { Key: "chapters/manga-1/ch-1/003_abcDE.webp", VersionId: "webp-3" },
    { Key: "chapters/manga-1/ch-1/003_abcDE.preview.webp", VersionId: "preview-3" }
  ];

  const storage = makeStorageDomain();
  const deleted = await storage.b2DeleteChapterExtraPages({
    prefix: "chapters/manga-1/ch-1",
    keepPages: 2,
    pageFilePrefix: "abcDE",
    extensions: ["bin"]
  });

  assert.equal(deleted, 1);
  assert.deepEqual(
    FakeS3Client.deleted.map((item) => item.Key),
    ["chapters/manga-1/ch-1/003_abcDE.bin"]
  );
});

test("IMGX reader stays configured for existing .bin chapters when uploads are disabled", () => {
  process.env.IMGX_ENABLED = "false";
  process.env.IMGX_UPLOAD_MODE = "legacy";
  process.env.IMGX_SECRET = "unit-imgx-secret";
  process.env.IMGX_SESSION_HMAC_SECRET = "unit-hmac-secret";

  const storage = makeStorageDomain();
  const config = storage.getImgxConfig();

  assert.equal(storage.isImgxReady(config), true);
  assert.equal(storage.isImgxUploadEnabled(config), false);
  assert.doesNotThrow(() =>
    storage.createImgxPageGrant({
      storageKey: "chapters/manga-1/ch-1/001.bin",
      sessionId: "session-1",
      imgxConfig: config
    })
  );
});

test("IMGX storage extension defaults to fake .js and can be pinned to .bin", () => {
  delete process.env.IMGX_STORAGE_EXT;
  let storage = makeStorageDomain();
  assert.equal(storage.getImgxStorageExt(), "js");
  assert.equal(storage.normalizeImgxStorageExt("bad-ext"), "js");
  assert.equal(storage.isImgxStorageExt("js"), true);
  assert.equal(storage.isImgxStorageExt("bin"), true);
  assert.equal(storage.isImgxStorageExt("webp"), false);

  process.env.IMGX_STORAGE_EXT = "bin";
  storage = makeStorageDomain();
  assert.equal(storage.getImgxStorageExt(), "bin");
});

test("IMGX reader grants also support existing fake .js chapters when uploads are disabled", () => {
  process.env.IMGX_ENABLED = "false";
  process.env.IMGX_UPLOAD_MODE = "legacy";
  process.env.IMGX_SECRET = "unit-imgx-secret";
  process.env.IMGX_SESSION_HMAC_SECRET = "unit-hmac-secret";

  const storage = makeStorageDomain();
  const config = storage.getImgxConfig();

  assert.equal(storage.isImgxReady(config), true);
  assert.equal(storage.isImgxUploadEnabled(config), false);
  assert.doesNotThrow(() =>
    storage.createImgxPageGrant({
      storageKey: "chapters/manga-1/ch-1/001.js",
      sessionId: "session-1",
      imgxConfig: config
    })
  );
});

test("IMGX old-prefix cleanup deletes .bin, .js and preview only when prefix is unreferenced", async () => {
  FakeS3Client.objects = [
    { Key: "chapters/manga-1/ch-old/001_abcDE.bin", VersionId: "bin-1" },
    { Key: "chapters/manga-1/ch-old/001_abcDE.js", VersionId: "js-1" },
    { Key: "chapters/manga-1/ch-old/001_abcDE.webp", VersionId: "webp-1" },
    { Key: "chapters/manga-1/ch-old/001_abcDE.preview.webp", VersionId: "preview-1" }
  ];

  const storage = makeStorageDomain({ dbAll: async () => [] });
  const deleted = await storage.b2DeleteChapterImgxPageArtifactsIfUnreferenced({
    prefix: "chapters/manga-1/ch-old",
    keepPages: 0,
    pageFilePrefix: "abcDE",
    ignoreChapterIds: [10],
    reason: "unit"
  });

  assert.equal(deleted, 3);
  assert.deepEqual(
    FakeS3Client.deleted.map((item) => item.Key).sort(),
    [
      "chapters/manga-1/ch-old/001_abcDE.bin",
      "chapters/manga-1/ch-old/001_abcDE.js",
      "chapters/manga-1/ch-old/001_abcDE.preview.webp"
    ]
  );
});

test("IMGX conversion cleanup deletes legacy .webp pages without deleting .bin or previews", async () => {
  FakeS3Client.objects = [
    { Key: "chapters/manga-1/ch-1/001_abcDE.bin", VersionId: "bin-1" },
    { Key: "chapters/manga-1/ch-1/001_abcDE.webp", VersionId: "webp-1" },
    { Key: "chapters/manga-1/ch-1/001_abcDE.preview.webp", VersionId: "preview-1" },
    { Key: "chapters/manga-1/ch-1/002_abcDE.webp", VersionId: "webp-2" }
  ];

  const storage = makeStorageDomain();
  const deleted = await storage.b2DeleteChapterLegacyPageArtifacts({
    prefix: "chapters/manga-1/ch-1",
    keepPages: 0,
    pageFilePrefix: "abcDE"
  });

  assert.equal(deleted, 2);
  assert.deepEqual(
    FakeS3Client.deleted.map((item) => item.Key).sort(),
    ["chapters/manga-1/ch-1/001_abcDE.webp", "chapters/manga-1/ch-1/002_abcDE.webp"]
  );
});

test("IMGX conversion old-prefix cleanup deletes stale .bin/.js, preview, and legacy .webp when unreferenced", async () => {
  FakeS3Client.objects = [
    { Key: "chapters/manga-1/ch-old/001_abcDE.bin", VersionId: "bin-1" },
    { Key: "chapters/manga-1/ch-old/001_abcDE.js", VersionId: "js-1" },
    { Key: "chapters/manga-1/ch-old/001_abcDE.webp", VersionId: "webp-1" },
    { Key: "chapters/manga-1/ch-old/001_abcDE.preview.webp", VersionId: "preview-1" }
  ];

  const storage = makeStorageDomain({ dbAll: async () => [] });
  const deletedImgx = await storage.b2DeleteChapterImgxPageArtifactsIfUnreferenced({
    prefix: "chapters/manga-1/ch-old",
    keepPages: 0,
    pageFilePrefix: "abcDE",
    ignoreChapterIds: [10],
    reason: "unit"
  });
  const deletedLegacy = await storage.b2DeleteChapterLegacyPageArtifactsIfUnreferenced({
    prefix: "chapters/manga-1/ch-old",
    keepPages: 0,
    pageFilePrefix: "abcDE",
    ignoreChapterIds: [10],
    reason: "unit"
  });

  assert.equal(deletedImgx + deletedLegacy, 4);
  assert.deepEqual(
    FakeS3Client.deleted.map((item) => item.Key).sort(),
    [
      "chapters/manga-1/ch-old/001_abcDE.bin",
      "chapters/manga-1/ch-old/001_abcDE.js",
      "chapters/manga-1/ch-old/001_abcDE.preview.webp",
      "chapters/manga-1/ch-old/001_abcDE.webp"
    ].sort()
  );
});

test("IMGX conversion target cleanup ignores the current chapter reference", async () => {
  FakeS3Client.objects = [
    { Key: "chapters/manga-1/ch-1/001_abcDE.webp", VersionId: "webp-1" }
  ];

  const storage = makeStorageDomain({
    dbAll: async () => [
      { id: 10, manga_id: 1, number: 1, pages_prefix: "chapters/manga-1/ch-1" }
    ]
  });
  const deleted = await storage.b2DeleteChapterLegacyPageArtifactsIfUnreferenced({
    prefix: "chapters/manga-1/ch-1",
    keepPages: 0,
    pageFilePrefix: "abcDE",
    ignoreChapterIds: [10],
    reason: "unit"
  });

  assert.equal(deleted, 1);
  assert.deepEqual(FakeS3Client.deleted.map((item) => item.Key), ["chapters/manga-1/ch-1/001_abcDE.webp"]);
});

test("IMGX conversion legacy cleanup skips when another active chapter references the prefix", async () => {
  FakeS3Client.objects = [
    { Key: "chapters/manga-1/ch-shared/001_abcDE.webp", VersionId: "webp-1" }
  ];

  const storage = makeStorageDomain({
    dbAll: async () => [
      { id: 20, manga_id: 1, number: 1, pages_prefix: "chapters/manga-1/ch-shared" }
    ]
  });
  const deleted = await storage.b2DeleteChapterLegacyPageArtifactsIfUnreferenced({
    prefix: "chapters/manga-1/ch-shared",
    keepPages: 0,
    pageFilePrefix: "abcDE",
    ignoreChapterIds: [10],
    reason: "unit"
  });

  assert.equal(deleted, 0);
  assert.deepEqual(FakeS3Client.deleted, []);
});
