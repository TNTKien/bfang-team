const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const readProjectFile = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");

const loadApplyRemotePreview = (source) => {
  const start = source.indexOf("const applyRemotePreview = (item, data) => {");
  const end = source.indexOf("const updateHiddenPages = () => {", start);

  assert.notEqual(start, -1, "admin.js should define applyRemotePreview");
  assert.notEqual(end, -1, "test should isolate applyRemotePreview before updateHiddenPages");

  const snippet = source.slice(start, end);
  const imageInstances = [];
  const revokedUrls = [];

  function MockImage() {
    this.listeners = {};
    imageInstances.push(this);
  }
  MockImage.prototype.addEventListener = function addEventListener(type, listener) {
    this.listeners[type] = listener;
  };

  const applyRemotePreview = Function(
    "Image",
    "Date",
    "encodeURIComponent",
    "revokeLocalObjectUrl",
    `${snippet}\nreturn applyRemotePreview;`
  )(
    MockImage,
    { now: () => 12345 },
    encodeURIComponent,
    (url) => revokedUrls.push(url)
  );

  return { applyRemotePreview, imageInstances, revokedUrls, snippet };
};

test("chapter draft upload keeps local preview until remote preview is loadable", () => {
  const source = readProjectFile("resources/js/admin.js");
  const { snippet } = loadApplyRemotePreview(source);

  assert.match(snippet, /item\.previewUrl = previewUrl;/);
  assert.match(snippet, /const remoteImage = new Image\(\);/);
  assert.match(snippet, /remoteImage\.addEventListener\("load", \(\) => \{/);
  assert.match(snippet, /remoteImage\.addEventListener\("error", \(\) => \{/);
  assert.doesNotMatch(
    snippet,
    /item\.imgEl\.src = previewUrl;/,
    "remote preview should not replace the local blob before the remote image load succeeds"
  );
});

test("chapter draft upload remote preview preload preserves blob on error and revokes it on load", () => {
  const source = readProjectFile("resources/js/admin.js");
  const { applyRemotePreview, imageInstances, revokedUrls } = loadApplyRemotePreview(source);
  const item = {
    objectUrl: "blob:local-preview",
    imgEl: { src: "blob:local-preview" }
  };

  applyRemotePreview(item, { previewUrl: "https://cdn.example.test/page.webp" });

  assert.equal(item.previewUrl, "https://cdn.example.test/page.webp");
  assert.equal(item.imgEl.src, "blob:local-preview");
  assert.equal(imageInstances.length, 1);
  assert.equal(imageInstances[0].src, "https://cdn.example.test/page.webp?t=12345");
  assert.deepEqual(revokedUrls, []);

  imageInstances[0].listeners.error();
  assert.equal(item.imgEl.src, "blob:local-preview");
  assert.equal(item.objectUrl, "blob:local-preview");
  assert.deepEqual(revokedUrls, []);

  imageInstances[0].listeners.load();
  assert.equal(item.imgEl.src, "https://cdn.example.test/page.webp?t=12345");
  assert.equal(item.objectUrl, "");
  assert.deepEqual(revokedUrls, ["blob:local-preview"]);
});
