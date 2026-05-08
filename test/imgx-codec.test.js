const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { IMGX_HEADER_BYTES } = require("../src/utils/imgx/constants");
const { parseImgxHeader } = require("../src/utils/imgx/format");
const {
  createSessionKeyGrant,
  decodeImgxForVerification,
  decodeImgxWithKey,
  encodeImgx,
  imageIdFromStorageKey,
  unwrapDecodeKeyFromGrant,
  verifySessionKeyGrantSignature
} = require("../src/utils/imgx/server");

test("IMGX roundtrip keeps compressed bytes and header size", () => {
  const webp = Buffer.from("not-a-real-webp-but-compressed-bytes-for-codec-test");
  const storageKey = "chapters/manga-1/ch-1/001.bin";
  const secret = "unit-secret";
  const imageId = imageIdFromStorageKey(storageKey);

  const encoded = encodeImgx({
    webp,
    width: 640,
    height: 960,
    imageId,
    secret
  });

  assert.equal(encoded.byteLength, webp.byteLength + IMGX_HEADER_BYTES);
  assert.deepEqual(parseImgxHeader(encoded), {
    magic: "IMGX",
    version: 2,
    width: 640,
    height: 960,
    payloadBytes: webp.byteLength
  });

  const decoded = decodeImgxForVerification(encoded, imageId, secret);
  assert.equal(Buffer.compare(Buffer.from(decoded.webp), webp), 0);
});

test("IMGX storage-key ids are deterministic and key-specific", () => {
  const left = imageIdFromStorageKey("chapters/manga-1/ch-1/001.bin");
  const same = imageIdFromStorageKey("/chapters/manga-1/ch-1/001.bin");
  const right = imageIdFromStorageKey("chapters/manga-1/ch-1/002.bin");
  const jsVariant = imageIdFromStorageKey("chapters/manga-1/ch-1/001.js");
  assert.equal(left, same);
  assert.notEqual(left, right);
  assert.notEqual(left, jsVariant);
  assert.match(left, /^[a-f0-9]{32}$/);
});

test("IMGX page grant wraps stable storage key with changing per-grant envelope", () => {
  const webp = Buffer.from("grant-bound-webp-bytes");
  const storageKey = "chapters/manga-8/ch-12/003.bin";
  const imageId = imageIdFromStorageKey(storageKey);
  const imgxSecret = "imgx-secret";
  const hmacSecret = "grant-secret";
  const sessionId = "session-1";
  const encoded = encodeImgx({
    webp,
    width: 720,
    height: 1080,
    imageId,
    secret: imgxSecret
  });
  const grant = createSessionKeyGrant({
    imageId,
    storageKey,
    sessionId,
    imgxSecret,
    hmacSecret,
    ttlMs: 30000,
    now: 1000
  });
  const secondGrant = createSessionKeyGrant({
    imageId,
    storageKey,
    sessionId,
    imgxSecret,
    hmacSecret,
    ttlMs: 30000,
    now: 1000
  });

  assert.equal(grant.decodeKey, undefined);
  assert.equal(typeof grant.wrappedDecodeKey, "string");
  assert.equal(typeof grant.keyNonce, "string");
  assert.notEqual(grant.wrappedDecodeKey, secondGrant.wrappedDecodeKey);
  assert.equal(verifySessionKeyGrantSignature({ grant, sessionId, storageKey, hmacSecret }), true);
  assert.equal(
    verifySessionKeyGrantSignature({
      grant,
      sessionId,
      storageKey: "chapters/manga-8/ch-12/004.bin",
      hmacSecret
    }),
    false
  );

  const decoded = decodeImgxWithKey(encoded, unwrapDecodeKeyFromGrant({ grant, storageKey }));
  const decodedAgain = decodeImgxWithKey(encoded, unwrapDecodeKeyFromGrant({ grant: secondGrant, storageKey }));
  assert.equal(Buffer.compare(Buffer.from(decoded.webp), webp), 0);
  assert.equal(Buffer.compare(Buffer.from(decodedAgain.webp), webp), 0);
  assert.throws(
    () => unwrapDecodeKeyFromGrant({ grant: { ...grant, wrappedDecodeKey: secondGrant.wrappedDecodeKey }, storageKey }),
    /hash mismatch|invalid/
  );
});

test("IMGX reader ships WASM decoder and protected canvas guard", () => {
  const wasmDir = path.join(__dirname, "..", "public", "wasm");
  const wasmJs = path.join(wasmDir, "q7v9k2m1.js");
  const wasmBinary = path.join(wasmDir, "z4x8n0p3.wasm");
  const wasmSource = fs.readFileSync(wasmJs, "utf8");
  const wasmBinaryText = fs.readFileSync(wasmBinary).toString("latin1");
  const readerSource = fs.readFileSync(path.join(__dirname, "..", "resources", "js", "reader.js"), "utf8");
  const chapterTemplate = fs.readFileSync(path.join(__dirname, "..", "views", "chapter.ejs"), "utf8");
  const headTemplate = fs.readFileSync(path.join(__dirname, "..", "views", "partials", "head.ejs"), "utf8");
  const headScriptsTemplate = fs.readFileSync(path.join(__dirname, "..", "views", "partials", "head-scripts.ejs"), "utf8");
  const headStylesTemplate = fs.readFileSync(path.join(__dirname, "..", "views", "partials", "head-styles.ejs"), "utf8");
  const siteRoutesSource = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "site-routes.js"), "utf8");
  const envExample = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  const packageSource = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8");
  const lockSource = fs.readFileSync(path.join(__dirname, "..", "bun.lock"), "utf8");

  assert.equal(fs.existsSync(wasmJs), true);
  assert.equal(fs.existsSync(wasmBinary), true);
  assert.equal(fs.existsSync(path.join(wasmDir, "imgx_decoder.js")), false);
  assert.equal(fs.existsSync(path.join(wasmDir, "imgx_decoder_bg.wasm")), false);
  assert.doesNotMatch(wasmSource, /imgx_decoder_bg\.wasm/);
  assert.doesNotMatch(wasmSource, /export function decode_with_key/);
  assert.doesNotMatch(wasmBinaryText, /imgx_decoder/);
  assert.doesNotMatch(wasmBinaryText, /decode_with_key/);
  assert.match(wasmSource, /export function a0/);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "public", "vendor", "disable-devtool.min.js")), false);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "public", "vendor", "disable-devtool.LICENSE")), false);
  assert.doesNotMatch(readerSource, /IMGX page \$\{pageIndex \+ 1\} decoded via/);
  assert.doesNotMatch(readerSource, /canvas tiles=\$\{tileCount\}/);
  assert.match(readerSource, /IMGX_WASM_DECODE_EXPORT/);
  assert.doesNotMatch(readerSource, /decode_with_key/);
  assert.match(readerSource, /q7v9k2m1\.js/);
  assert.match(chapterTemplate, /q7v9k2m1\.js/);
  assert.match(chapterTemplate, /z4x8n0p3\.wasm/);
  assert.doesNotMatch(readerSource, /imgx_decoder/);
  assert.doesNotMatch(chapterTemplate, /imgx_decoder/);
  assert.match(readerSource, /readerImgxInitialPages/);
  assert.match(readerSource, /grant\.wrappedDecodeKey \|\| grant\.decodeKey/);
  assert.match(readerSource, /unwrapImgxGrantDecodeKey/);
  assert.match(readerSource, /loadImgxWasmDecoder\(\)\.catch\(\(\) => null\)/);
  assert.match(readerSource, /IMGX_DECODE_CACHE_MAX_PAGES/);
  assert.match(readerSource, /imgxDecodedPageCache/);
  assert.match(readerSource, /getDecodedImgxPage/);
  assert.match(readerSource, /putCachedImgxDecodedPage/);
  assert.match(readerSource, /cacheHit: true/);
  assert.match(readerSource, /primeInitialImgxPages/);
  assert.match(readerSource, /data-imgx-protected-canvas/);
  assert.match(readerSource, /createImageBitmap/);
  assert.match(readerSource, /const IMGX_TILE_SIZE = 256;/);
  assert.match(readerSource, /const isImgxChapter = \(\) => Boolean\(imgxAccessUrl\)/);
  assert.match(readerSource, /let imgxWasmDecoderPromise = null;/);
  assert.doesNotMatch(readerSource, /isImgxClientSecurityBlocked/);
  assert.doesNotMatch(readerSource, /deferImgxUnveilUntilSecurityClear/);
  assert.doesNotMatch(readerSource, /throwIfImgxSecurityBlocked/);
  assert.doesNotMatch(readerSource, /fetchImgxGuarded/);
  assert.doesNotMatch(readerSource, /purgeImgxProtectedRuntime/);
  assert.doesNotMatch(readerSource, /bfang:imgx-security/);
  assert.doesNotMatch(readerSource, /IMGX_SECURITY_BLOCKED/);
  assert.doesNotMatch(readerSource, /DisableDevtool/);
  assert.doesNotMatch(readerSource, /disable-devtool/);
  assert.match(chapterTemplate, /data-reader-imgx-initial-pages/);
  assert.match(chapterTemplate, /const readerPageOptionIndexes = hasProtectedReaderPages/);
  assert.match(chapterTemplate, /protectedPages\.map\(\(entry, fallbackIndex\)/);
  assert.match(chapterTemplate, /pageUrls\.map\(\(_src, pageIndex\) => pageIndex\)/);
  assert.match(chapterTemplate, /data-reader-dropdown/);
  assert.match(chapterTemplate, /data-reader-toggle/);
  assert.match(chapterTemplate, /data-reader-panel/);
  assert.match(chapterTemplate, /readerPageOptionIndexes\.forEach\(\(pageIndex\)/);
  assert.match(chapterTemplate, /data-reader-page-index="<%= pageIndex %>"/);
  assert.doesNotMatch(chapterTemplate, /data-reader-protected-page-status/);
  assert.match(chapterTemplate, /headModulePreloads/);
  assert.match(chapterTemplate, /headPreloadFetches/);
  assert.match(headTemplate, /safeHeadModulePreloads/);
  assert.match(headTemplate, /safeHeadPreloadFetches/);
  assert.doesNotMatch(headScriptsTemplate, /disableDevtool/);
  assert.doesNotMatch(headScriptsTemplate, /\/vendor\/disable-devtool\.min\.js/);
  assert.match(headStylesTemplate, /rel="modulepreload"/);
  assert.match(headStylesTemplate, /rel="preload" as="fetch"/);
  assert.match(chapterTemplate, /toDataURL/);
  assert.match(chapterTemplate, /captureStream/);
  assert.match(chapterTemplate, /__IMGX_RUNTIME_BASELINE__/);
  assert.doesNotMatch(chapterTemplate, /imgxAntiCaptureEnabled/);
  assert.doesNotMatch(chapterTemplate, /imgxDevtools/);
  assert.doesNotMatch(chapterTemplate, /reader-imgx-capture-mask/);
  assert.doesNotMatch(chapterTemplate, /reader-imgx-tab-inactive/);
  assert.doesNotMatch(chapterTemplate, /blackoutOnInactive/);
  assert.doesNotMatch(chapterTemplate, /reader-imgx-devtools-blocked/);
  assert.doesNotMatch(chapterTemplate, /reader-imgx-hard-locked/);
  assert.doesNotMatch(chapterTemplate, /data-imgx-security-overlay/);
  assert.doesNotMatch(chapterTemplate, /__IMGX_SECURITY_BLOCKED__/);
  assert.doesNotMatch(chapterTemplate, /bfang:imgx-security/);
  assert.doesNotMatch(chapterTemplate, /beforeprint/);
  assert.doesNotMatch(chapterTemplate, /printscreen/);
  assert.doesNotMatch(chapterTemplate, /runDebuggerTrap/);
  assert.doesNotMatch(chapterTemplate, /__IMGX_DISABLE_DEVTOOL_CONFIG__/);
  assert.doesNotMatch(chapterTemplate, /bfang:imgx-disable-devtool/);
  assert.doesNotMatch(chapterTemplate, /debugger;/);
  assert.doesNotMatch(chapterTemplate, /detectByDebuggerPause/);
  assert.doesNotMatch(chapterTemplate, /detectByViewportGap/);
  assert.doesNotMatch(chapterTemplate, /isDevtoolsShortcut/);
  assert.doesNotMatch(chapterTemplate, /viewportDevtoolsActive/);
  assert.doesNotMatch(chapterTemplate, /Date\.now\(\) - started > 80/);
  assert.doesNotMatch(chapterTemplate, /runDebuggerProbe/);
  assert.doesNotMatch(chapterTemplate, /document\.hasFocus/);
  assert.doesNotMatch(chapterTemplate, /reader-imgx-security-overlay__box/);
  assert.doesNotMatch(chapterTemplate, /DEFAULT_MASK_MESSAGE/);
  assert.doesNotMatch(chapterTemplate, /DEVTOOLS_MASK_MESSAGE/);
  assert.doesNotMatch(chapterTemplate, /contextmenu/);
  assert.doesNotMatch(readerSource, /shell\.addEventListener\("contextmenu"/);
  assert.doesNotMatch(readerSource, /shell\.addEventListener\("dragstart"/);
  assert.match(siteRoutesSource, /buildImgxPageAccessPayload/);
  assert.match(siteRoutesSource, /ext === "bin" \|\| ext === "js"/);
  assert.doesNotMatch(siteRoutesSource, /IMGX_STRICT_CLIENT_PROTECTION_ENABLED/);
  assert.doesNotMatch(siteRoutesSource, /IMGX_ANTI_CAPTURE_ENABLED/);
  assert.doesNotMatch(siteRoutesSource, /IMGX_DEVTOOLS_/);
  assert.doesNotMatch(siteRoutesSource, /imgxClientSecurity/);
  assert.match(siteRoutesSource, /downloadUrl: cacheBust\(`\$\{baseUrl\}\/\$\{storageKey\}`,\s*chapterRow\.pages_updated_at\)/);
  assert.match(siteRoutesSource, /initialImgxPages/);
  assert.match(siteRoutesSource, /initialPageGrants/);
  assert.doesNotMatch(envExample, /IMGX_STRICT_CLIENT_PROTECTION_ENABLED/);
  assert.doesNotMatch(envExample, /IMGX_ANTI_CAPTURE_ENABLED/);
  assert.doesNotMatch(envExample, /IMGX_DEVTOOLS_/);
  assert.match(envExample, /IMGX_STORAGE_EXT=js/);
  assert.doesNotMatch(packageSource, /disable-devtool/);
  assert.doesNotMatch(lockSource, /disable-devtool/);
});

test("IMGX admin upload stores lightweight preview sidecars and cleans them", () => {
  const storageSource = fs.readFileSync(path.join(__dirname, "..", "src", "domains", "storage-domain.js"), "utf8");
  const adminRoutesSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "routes", "admin-and-engagement-routes.js"),
    "utf8"
  );
  const apiServerSource = fs.readFileSync(path.join(__dirname, "..", "api_server", "server.js"), "utf8");
  const adminClientSource = fs.readFileSync(path.join(__dirname, "..", "resources", "js", "admin.js"), "utf8");

  assert.match(storageSource, /buildChapterPagePreviewStorageKey/);
  assert.match(storageSource, /IMGX_STORAGE_EXT/);
  assert.match(storageSource, /imgxStorageExtensions = Object\.freeze\(\["js", "bin"\]\)/);
  assert.match(storageSource, /\.preview\\.webp/);
  assert.match(storageSource, /CHAPTER_PAGE_PREVIEW_WEBP_QUALITY/);
  assert.match(storageSource, /CHAPTER_PAGE_PREVIEW_MAX_WIDTH\) \|\| 160/);
  assert.match(storageSource, /CHAPTER_PAGE_PREVIEW_MAX_HEIGHT\) \|\| 240/);
  assert.match(storageSource, /deleteProtectedChapterDraftPage[\s\S]*previewTarget/);
  assert.match(storageSource, /b2DeleteChapterExtraPagePreviews/);
  assert.match(storageSource, /extensions: normalizeChapterPageExtensionSet\(extensions\) \? extensions : imgxStorageExtensions/);
  assert.match(storageSource, /isImgxStorageKey[\s\S]*\(\?:bin\|js\)/);
  assert.match(storageSource, /b2DeleteChapterImgxPageArtifactsIfUnreferenced/);
  assert.match(storageSource, /const shouldUseImgxProcessing = isImgxUploadEnabled\(imgxConfig\)/);
  assert.match(storageSource, /transcodeChapterPageToLegacyWebp/);
  assert.match(storageSource, /CHAPTER_IMAGE_PROCESSING_API_URL/);
  assert.match(storageSource, /requestChapterImageProcessingApiTransfer/);
  assert.match(storageSource, /X-Chapter-Transfer-Proof/);
  assert.match(storageSource, /b2DeleteChapterImgxPageArtifacts\(\{ prefix: finalPrefix, keepPages: 0, pageFilePrefix \}\)/);
  assert.match(adminRoutesSource, /previewUrl: stored\.previewUrl/);
  assert.match(adminRoutesSource, /buildChapterPagePreviewStorageKey/);
  assert.match(adminRoutesSource, /getConfiguredImgxStorageExt/);
  assert.match(adminRoutesSource, /extensions: \[imgxStorageExt\]/);
  assert.match(adminRoutesSource, /admin-chapter-pages-finalize-old-imgx-prefix/);
  assert.match(adminRoutesSource, /admin-chapter-pages-target-imgx-prefix/);
  assert.match(adminRoutesSource, /admin-chapter-pages-finalize-target-imgx-prefix/);
  assert.match(adminRoutesSource, /useLocalProtectedUpload = !chapterUploadApiBaseUrl \|\| !chapterUploadApiProof/);
  assert.match(apiServerSource, /putImgxPage/);
  assert.match(apiServerSource, /IMGX_STORAGE_EXT/);
  assert.match(apiServerSource, /putChapterPagePreview/);
  assert.match(apiServerSource, /codecVersion: IMGX_VERSION/);
  assert.match(apiServerSource, /IMGX_STORAGE_EXTENSIONS\.map/);
  assert.match(apiServerSource, /deleteObjectsByKeys\(Array\.from\(new Set\(\[legacyName, \.\.\.imgxNames, \.\.\.previewNames\]\)\)\)/);
  assert.match(apiServerSource, /page_delivery_mode = 'legacy'/);
  assert.match(apiServerSource, /ignoreChapterIds: \[result\.chapterId \|\| session\.existingChapterId\]/);
  assert.match(apiServerSource, /\/v1\/internal\/chapter-pages\/transfer/);
  assert.match(apiServerSource, /verifyChapterTransferProof/);
  assert.match(apiServerSource, /transferChapterPageObject/);
  assert.match(apiServerSource, /decodeImgxForVerification/);
  assert.match(adminClientSource, /applyRemotePreview/);
  assert.match(adminClientSource, /attachImageFallback/);
});
