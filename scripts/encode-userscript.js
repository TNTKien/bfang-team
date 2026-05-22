#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_SOURCE_PATH = path.join(ROOT_DIR, "scripts", "userscripts", "moetruyen-full-web.source.user.js");
const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, "public", "userscripts", "moetruyen-full-web.user.js");
const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  seed: 7331,
  selfDefending: false,
  simplify: true,
  sourceMap: false,
  splitStrings: true,
  splitStringsChunkLength: 4,
  stringArray: true,
  stringArrayEncoding: ["rc4"],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 1,
  target: "browser",
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
};

const normalizeLineEndings = (value) => value.replace(/\r\n/g, "\n");

const parseArgs = (argv) => {
  const options = {
    check: false,
    outputPath: DEFAULT_OUTPUT_PATH,
    sourcePath: DEFAULT_SOURCE_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--source") {
      options.sourcePath = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--output") {
      options.outputPath = path.resolve(argv[index + 1] || "");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const parseUserscriptSource = (source) => {
  const normalizedSource = normalizeLineEndings(source);
  const match = normalizedSource.match(/^(\/\/ ==UserScript==\n[\s\S]*?\/\/ ==\/UserScript==)\n+([\s\S]*?)\s*$/);
  if (!match) {
    throw new Error("Source userscript must contain a top-level Tampermonkey metadata block");
  }

  return {
    metadataBlock: match[1],
    runtime: match[2],
  };
};

const obfuscateRuntime = (runtime) =>
  JavaScriptObfuscator
    .obfuscate(runtime, OBFUSCATOR_OPTIONS)
    .getObfuscatedCode();

const buildEncodedUserscript = (source) => {
  const { metadataBlock, runtime } = parseUserscriptSource(source);
  const obfuscatedRuntime = obfuscateRuntime(runtime);

  return `${metadataBlock}\n\n(() => {\n${obfuscatedRuntime}\n})();\n`;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const source = fs.readFileSync(options.sourcePath, "utf8");
  const encodedUserscript = buildEncodedUserscript(source);

  if (options.check) {
    const existingOutput = fs.existsSync(options.outputPath)
      ? normalizeLineEndings(fs.readFileSync(options.outputPath, "utf8"))
      : "";

    if (existingOutput !== encodedUserscript) {
      throw new Error(`${path.relative(ROOT_DIR, options.outputPath)} is not up to date. Run: node scripts/encode-userscript.js`);
    }

    console.log(`${path.relative(ROOT_DIR, options.outputPath)} is up to date.`);
    return;
  }

  fs.writeFileSync(options.outputPath, encodedUserscript, "utf8");
  console.log(`Encoded ${path.relative(ROOT_DIR, options.sourcePath)} -> ${path.relative(ROOT_DIR, options.outputPath)}`);
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildEncodedUserscript,
  obfuscateRuntime,
  parseUserscriptSource,
};
