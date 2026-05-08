const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const scriptPath = path.join(projectRoot, "scripts", "convert-chapter-imgx.js");

test("IMGX chapter conversion script exposes safe dry-run CLI", () => {
  const source = fs.readFileSync(scriptPath, "utf8");

  assert.match(source, /--to <imgx\|imgx-js\|js\|imgx-bin\|bin\|legacy\|webp>/);
  assert.match(source, /--chapter-id <ids>/);
  assert.match(source, /--manga-id <ids>/);
  assert.match(source, /--manga-id-from <id>/);
  assert.match(source, /--manga-id-to <id>/);
  assert.match(source, /--manga-limit <n>/);
  assert.match(source, /--checkpoint <path>/);
  assert.match(source, /--resume/);
  assert.match(source, /--skip-errors/);
  assert.match(source, /--cleanup-old/);
  assert.match(source, /--keep-old/);
  assert.match(source, /--apply/);
  assert.match(source, /Dry-run is default/);
  assert.match(source, /buildMangaQuery/);
  assert.match(source, /FROM manga m/);
  assert.match(source, /m\.id >= \?/);
  assert.match(source, /m\.id <= \?/);
  assert.match(source, /readCheckpointState/);
  assert.match(source, /saveCheckpointState/);
  assert.match(source, /fs\.renameSync/);
  assert.match(source, /completedMangaIds/);
  assert.match(source, /completedChapterIds/);
  assert.match(source, /failedChapterIds/);
  assert.match(source, /cleanupOld: !args\.includes\("--keep-old"\)/);
  assert.match(source, /currentTargetMode === targetMode && !options\.force[\s\S]*cleanupOldArtifacts/);
  assert.match(source, /normalizeImgxStorageExt/);
  assert.match(source, /imgx-js/);
  assert.match(source, /imgx-bin/);
  assert.match(source, /getTargetExt/);
  assert.match(source, /validateTargetPages/);
  assert.match(source, /pages_ext = \?/);
  assert.match(source, /page_delivery_mode = \?/);
  assert.match(source, /buildChapterPageFileName/);
  assert.match(source, /decodeImgxForVerification/);
  assert.match(source, /transcodeChapterPageToImgx/);
  assert.match(source, /transcodeChapterPageToLegacyWebp/);
  assert.match(source, /b2DeleteChapterLegacyPageArtifacts/);
  assert.match(source, /b2DeleteChapterImgxPageArtifacts/);
});

test("IMGX chapter conversion script help does not require production env", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;

  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    cwd: projectRoot,
    env,
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /convert-chapter-imgx\.js --to imgx --chapter-id 123/);
  assert.match(result.stdout, /--to imgx-js --chapter-id 123 --apply/);
  assert.match(result.stdout, /--to imgx-bin --chapter-id 123 --apply/);
  assert.match(result.stdout, /--manga-id-from 1 --manga-id-to 100/);
  assert.match(result.stdout, /--checkpoint <path>/);
  assert.match(result.stdout, /--resume/);
  assert.match(result.stdout, /--skip-errors/);
  assert.match(result.stdout, /By default, --apply deletes source artifacts after success/);
  assert.match(result.stdout, /bin<->js deletes old IMGX ext/);
  assert.match(result.stdout, /Default is dry-run/);
});
