#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const npmCommand = "npm";
const psqlCommand = process.platform === "win32" ? "psql.exe" : "psql";
const MIN_NODE_MAJOR = 20;
const MIN_POSTGRES_MAJOR = 16;

const parseArgs = (argv) => {
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token) continue;

    if (token === "-h" || token === "--help") {
      options.help = true;
      continue;
    }

    if (!token.startsWith("--")) continue;

    const pair = token.slice(2);
    const equalIndex = pair.indexOf("=");
    let key = pair;
    let value = "";

    if (equalIndex >= 0) {
      key = pair.slice(0, equalIndex);
      value = pair.slice(equalIndex + 1);
    } else {
      const next = argv[i + 1];
      if (next != null && !String(next).trim().startsWith("--")) {
        value = String(next);
        i += 1;
      } else {
        value = "true";
      }
    }

    options[key] = value;
  }

  return options;
};

const parseBoolean = (value, fallback = false) => {
  if (value == null) return Boolean(fallback);
  const text = String(value).trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (["1", "true", "yes", "y", "on", "co", "c", "có", "ok"].includes(text)) return true;
  if (["0", "false", "no", "n", "off", "khong", "không", "k"].includes(text)) return false;
  return Boolean(fallback);
};

const normalizeExistingDbAction = (value, fallback = "ask") => {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return fallback;
  if (["overwrite", "continue", "proceed", "go", "yes", "y", "1"].includes(text)) {
    return "overwrite";
  }
  if (["stop", "abort", "cancel", "no", "n", "0"].includes(text)) {
    return "stop";
  }
  return fallback;
};

const parsePort = (value, fallback) => {
  const parsed = Number.parseInt(String(value == null ? "" : value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 65535);
};

const parseDatabaseUrlParts = (databaseUrl) => {
  const raw = String(databaseUrl || "").trim();
  if (!raw) {
    return {
      host: "",
      port: 0,
      database: "",
      user: "",
      password: ""
    };
  }

  try {
    const parsed = new URL(raw);
    return {
      host: String(parsed.hostname || "").trim(),
      port: parsePort(parsed.port, 0),
      database: String(parsed.pathname || "").replace(/^\/+/, "").trim(),
      user: decodeURIComponent(String(parsed.username || "").trim()),
      password: decodeURIComponent(String(parsed.password || "").trim())
    };
  } catch (_error) {
    return {
      host: "",
      port: 0,
      database: "",
      user: "",
      password: ""
    };
  }
};

const askQuestion = (rl, promptText) => new Promise((resolve) => {
  rl.question(promptText, (answer) => {
    resolve(String(answer == null ? "" : answer));
  });
});

const formatUnderlinedChoice = (value) => {
  const text = String(value == null ? "" : value);
  const canUseAnsi = Boolean(
    process.stdout && process.stdout.isTTY && process.env.NO_COLOR == null && String(process.env.TERM || "") !== "dumb"
  );
  if (canUseAnsi) {
    return `\u001b[4m${text}\u001b[24m`;
  }
  return `_${text}_`;
};

const promptTextValue = async ({ rl, label, defaultValue = "", allowEmpty = false }) => {
  while (true) {
    const fallback = String(defaultValue == null ? "" : defaultValue);
    const suffix = fallback ? ` [${fallback}]` : "";
    const answer = await askQuestion(rl, `${label}${suffix}: `);
    const value = String(answer || "").trim();

    if (!value) {
      if (fallback) {
        return fallback;
      }
      if (allowEmpty) {
        return "";
      }
      console.log("  ! Giá trị không được để trống.");
      continue;
    }

    return value;
  }
};

const promptPortValue = async ({ rl, label, defaultValue }) => {
  while (true) {
    const fallback = Number.isFinite(defaultValue) ? defaultValue : 0;
    const answer = await askQuestion(rl, `${label} [${fallback}]: `);
    const raw = String(answer || "").trim();
    const candidate = raw ? Number.parseInt(raw, 10) : fallback;
    if (Number.isFinite(candidate) && candidate >= 1 && candidate <= 65535) {
      return Math.floor(candidate);
    }
    console.log("  ! Port phải là số từ 1 đến 65535.");
  }
};

const promptBooleanValue = async ({ rl, label, defaultValue = false }) => {
  const fallback = Boolean(defaultValue);
  const hint = fallback
    ? `${formatUnderlinedChoice("Y")}/n`
    : `y/${formatUnderlinedChoice("N")}`;

  while (true) {
    const answer = await askQuestion(rl, `${label} (${hint}): `);
    const raw = String(answer || "").trim().toLowerCase();
    if (!raw) return fallback;
    if (["y", "yes", "1", "true", "on", "co", "c", "có", "ok"].includes(raw)) return true;
    if (["n", "no", "0", "false", "off", "khong", "không", "k"].includes(raw)) return false;
    console.log("  ! Nhập y/yes hoặc n/no.");
  }
};

const collectInteractiveOptions = async (seedOptions) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Chế độ tương tác cần terminal TTY. Dùng --non-interactive để chạy tự động.");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log("\n=== Setup Wizard ===");
    console.log("Nhập từng thông số cấu hình. Nhấn Enter để dùng giá trị trong ngoặc [].\n");

    const dbHost = await promptTextValue({
      rl,
      label: "Host PostgreSQL",
      defaultValue: seedOptions.dbHost
    });

    const dbPort = await promptPortValue({
      rl,
      label: "Port PostgreSQL",
      defaultValue: seedOptions.dbPort
    });

    const dbName = await promptTextValue({
      rl,
      label: "Tên database",
      defaultValue: seedOptions.dbName
    });

    const dbUser = await promptTextValue({
      rl,
      label: "User database",
      defaultValue: seedOptions.dbUser
    });

    const dbPassword = await promptTextValue({
      rl,
      label: "Password database",
      defaultValue: seedOptions.dbPassword
    });

    const webAdminUser = await promptTextValue({
      rl,
      label: "username admin web",
      defaultValue: seedOptions.webAdminUser
    });

    const webAdminPass = await promptTextValue({
      rl,
      label: "Password admin web",
      defaultValue: seedOptions.webAdminPass
    });

    const appPort = await promptPortValue({
      rl,
      label: "Port web app",
      defaultValue: seedOptions.appPort
    });

    const withApi = await promptBooleanValue({
      rl,
      label: "Cài và cấu hình API Server",
      defaultValue: seedOptions.withApi
    });

    let apiPort = seedOptions.apiPort;
    if (withApi) {
      apiPort = await promptPortValue({
        rl,
        label: "API Server port",
        defaultValue: seedOptions.apiPort
      });
    }

    const withForum = await promptBooleanValue({
      rl,
      label: "Cài và build Forum frontend (sampleforum)",
      defaultValue: seedOptions.withForum
    });

    const withDesktop = await promptBooleanValue({
      rl,
      label: "Cài dependencies app_desktop",
      defaultValue: seedOptions.withDesktop
    });

    const setupS3Now = await promptBooleanValue({
      rl,
      label: "Setup S3 ngay bây giờ",
      defaultValue: seedOptions.setupS3Now
    });

    let s3Endpoint = seedOptions.s3Endpoint;
    let s3Bucket = seedOptions.s3Bucket;
    let s3Region = seedOptions.s3Region;
    let s3AccessKeyId = seedOptions.s3AccessKeyId;
    let s3SecretAccessKey = seedOptions.s3SecretAccessKey;
    let s3ForcePathStyle = seedOptions.s3ForcePathStyle;
    let chapterCdnBaseUrl = seedOptions.chapterCdnBaseUrl;
    let s3ChapterPrefix = seedOptions.s3ChapterPrefix;

    if (setupS3Now) {
      s3Endpoint = await promptTextValue({
        rl,
        label: "Endpoint S3 (để trống nếu dùng AWS)",
        defaultValue: seedOptions.s3Endpoint,
        allowEmpty: true
      });

      s3Bucket = await promptTextValue({
        rl,
        label: "Bucket S3",
        defaultValue: seedOptions.s3Bucket
      });

      s3Region = await promptTextValue({
        rl,
        label: "Region S3",
        defaultValue: seedOptions.s3Region
      });

      s3AccessKeyId = await promptTextValue({
        rl,
        label: "S3 Access Key ID",
        defaultValue: seedOptions.s3AccessKeyId
      });

      s3SecretAccessKey = await promptTextValue({
        rl,
        label: "S3 Secret Access Key",
        defaultValue: seedOptions.s3SecretAccessKey
      });

      const forcePathStyleBool = await promptBooleanValue({
        rl,
        label: "Bật S3 force path style",
        defaultValue: parseBoolean(seedOptions.s3ForcePathStyle, true)
      });
      s3ForcePathStyle = forcePathStyleBool ? "true" : "false";

      chapterCdnBaseUrl = await promptTextValue({
        rl,
        label: "Chapter CDN base URL",
        defaultValue: seedOptions.chapterCdnBaseUrl,
        allowEmpty: true
      });

      s3ChapterPrefix = await promptTextValue({
        rl,
        label: "S3 chapter prefix",
        defaultValue: seedOptions.s3ChapterPrefix
      });
    }

    const setupGoogleNow = await promptBooleanValue({
      rl,
      label: "Setup Google OAuth ngay bây giờ",
      defaultValue: seedOptions.setupGoogleNow
    });

    let googleClientId = seedOptions.googleClientId;
    let googleClientSecret = seedOptions.googleClientSecret;
    if (setupGoogleNow) {
      googleClientId = await promptTextValue({
        rl,
        label: "Google Client ID",
        defaultValue: seedOptions.googleClientId
      });
      googleClientSecret = await promptTextValue({
        rl,
        label: "Google Client Secret",
        defaultValue: seedOptions.googleClientSecret
      });
    }

    const setupDiscordNow = await promptBooleanValue({
      rl,
      label: "Setup Discord OAuth ngay bây giờ",
      defaultValue: seedOptions.setupDiscordNow
    });

    let discordClientId = seedOptions.discordClientId;
    let discordClientSecret = seedOptions.discordClientSecret;
    if (setupDiscordNow) {
      discordClientId = await promptTextValue({
        rl,
        label: "Discord Client ID",
        defaultValue: seedOptions.discordClientId
      });
      discordClientSecret = await promptTextValue({
        rl,
        label: "Discord Client Secret",
        defaultValue: seedOptions.discordClientSecret
      });
    }

    const startWeb = await promptBooleanValue({
      rl,
      label: "Start web server sau khi setup",
      defaultValue: seedOptions.startWeb
    });

    return {
      ...seedOptions,
      dbHost,
      dbPort,
      dbName,
      dbUser,
      dbPassword,
      webAdminUser,
      webAdminPass,
      appPort,
      apiPort,
      withApi,
      withForum,
      withDesktop,
      setupS3Now,
      s3Endpoint,
      s3Bucket,
      s3Region,
      s3AccessKeyId,
      s3SecretAccessKey,
      s3ForcePathStyle,
      chapterCdnBaseUrl,
      s3ChapterPrefix,
      setupGoogleNow,
      googleClientId,
      googleClientSecret,
      setupDiscordNow,
      discordClientId,
      discordClientSecret,
      startWeb
    };
  } finally {
    rl.close();
  }
};

const promptExistingDbAction = async ({ tableCount }) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "overwrite";
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log(`\n==> Database hiện đã có ${tableCount} bảng.`);
    console.log("Chọn hướng xử lý:");
    console.log("  1) Ghi đè setup (không xóa dữ liệu hiện có)");
    console.log("  2) Dừng setup");

    while (true) {
      const answer = String(await askQuestion(rl, "Lựa chọn [1/2] (mặc định 1): ")).trim().toLowerCase();
      if (!answer || answer === "1") {
        return "overwrite";
      }
      if (answer === "2") {
        return "stop";
      }
      console.log("  ! Vui lòng nhập 1 hoặc 2.");
    }
  } finally {
    rl.close();
  }
};

const runCommand = ({ title, command, args = [], cwd = projectRoot, extraEnv = null, capture = false, shell = false }) => {
  console.log(`\n==> ${title}`);
  const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
  const result = spawnSync(command, args, {
    cwd,
    env,
    shell,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: capture ? "utf8" : undefined
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    const stderr = capture ? String(result.stderr || "").trim() : "";
    const detail = stderr ? `\n${stderr}` : "";
    throw new Error(`Command failed: ${command} ${args.join(" ")}${detail}`);
  }

  return result;
};

const runNpmCommand = ({ title, args = [], cwd = projectRoot }) => {
  const npmExecPath = String(process.env.npm_execpath || "").trim();
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return runCommand({
      title,
      command: process.execPath,
      args: [npmExecPath, ...args],
      cwd,
      shell: false
    });
  }

  if (process.platform === "win32") {
    return runCommand({
      title,
      command: "npm",
      args,
      cwd,
      shell: true
    });
  }

  return runCommand({
    title,
    command: "npm",
    args,
    cwd,
    shell: false
  });
};

const testSqlConnectionWithPsql = ({ host, port, database, user, password, minMajor }) => {
  const baseArgs = [
    "-h",
    String(host || "").trim(),
    "-p",
    String(port || "").trim(),
    "-U",
    String(user || "").trim(),
    "-d",
    String(database || "").trim(),
    "-v",
    "ON_ERROR_STOP=1"
  ];

  const env = {
    ...process.env,
    PGPASSWORD: String(password == null ? "" : password)
  };

  const testResult = spawnSync(psqlCommand, [...baseArgs, "-tAc", "SELECT 1;"], {
    cwd: projectRoot,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env
  });

  if (testResult.error) {
    if (testResult.error.code === "ENOENT") {
      throw new Error("Không tìm thấy psql. Hãy cài PostgreSQL client 16+ và thêm vào PATH.");
    }
    throw testResult.error;
  }

  if (testResult.status !== 0) {
    const message = String(testResult.stderr || "").trim() || "Không thể kết nối PostgreSQL.";
    throw new Error(`Kết nối SQL thất bại: ${message}`);
  }

  const selectOutput = String(testResult.stdout || "").trim();
  if (selectOutput !== "1") {
    throw new Error("Kết nối SQL thất bại: truy vấn kiểm tra không trả về kết quả hợp lệ.");
  }

  const versionResult = spawnSync(psqlCommand, [...baseArgs, "-tAc", "SHOW server_version_num;"], {
    cwd: projectRoot,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env
  });

  if (versionResult.error || versionResult.status !== 0) {
    const message = versionResult.error
      ? String(versionResult.error.message || versionResult.error)
      : String(versionResult.stderr || "").trim();
    throw new Error(`Không đọc được phiên bản PostgreSQL server: ${message || "unknown error"}`);
  }

  const rawVersionNum = String(versionResult.stdout || "").trim();
  const versionNum = Number.parseInt(rawVersionNum, 10);
  const major = Number.isFinite(versionNum) ? Math.floor(versionNum / 10000) : 0;
  if (!major) {
    throw new Error("Không đọc được PostgreSQL server major version.");
  }

  if (major < minMajor) {
    throw new Error(`PostgreSQL ${minMajor}+ là bắt buộc. Server hiện tại là ${major}.`);
  }

  return {
    major
  };
};

const getSchemaTableCountWithPsql = ({ host, port, database, user, password }) => {
  const baseArgs = [
    "-h",
    String(host || "").trim(),
    "-p",
    String(port || "").trim(),
    "-U",
    String(user || "").trim(),
    "-d",
    String(database || "").trim(),
    "-v",
    "ON_ERROR_STOP=1"
  ];

  const env = {
    ...process.env,
    PGPASSWORD: String(password == null ? "" : password)
  };

  const query = [
    "SELECT COUNT(*)",
    "FROM information_schema.tables",
    "WHERE table_schema = current_schema()",
    "  AND table_type = 'BASE TABLE';"
  ].join(" ");

  const result = spawnSync(psqlCommand, [...baseArgs, "-tAc", query], {
    cwd: projectRoot,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env
  });

  if (result.error || result.status !== 0) {
    const message = result.error
      ? String(result.error.message || result.error)
      : String(result.stderr || "").trim();
    throw new Error(`Không đọc được số lượng bảng hiện tại của database: ${message || "unknown error"}`);
  }

  const tableCount = Number.parseInt(String(result.stdout || "").trim(), 10);
  if (!Number.isFinite(tableCount) || tableCount < 0) {
    throw new Error("Không đọc được số lượng bảng hiện tại của database.");
  }

  return Math.floor(tableCount);
};

const ensureFileFromTemplate = (targetPath, templatePath) => {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found: ${templatePath}`);
  }
  if (!fs.existsSync(targetPath)) {
    fs.copyFileSync(templatePath, targetPath);
  }
};

const readTextFile = (targetPath) => fs.readFileSync(targetPath, "utf8");

const writeTextFile = (targetPath, content) => {
  fs.writeFileSync(targetPath, content, "utf8");
};

const readEnvMap = (content) => {
  const map = {};
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  lines.forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) return;
    const key = match[1];
    const value = match[2];
    map[key] = value;
  });
  return map;
};

const upsertEnvValues = (content, updates) => {
  const source = String(content || "").replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const nextLines = [];
  const seen = new Set();

  lines.forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) {
      nextLines.push(line);
      return;
    }

    const key = match[1];
    if (!Object.prototype.hasOwnProperty.call(updates, key)) {
      nextLines.push(line);
      return;
    }

    seen.add(key);
    nextLines.push(`${key}=${updates[key]}`);
  });

  Object.keys(updates).forEach((key) => {
    if (seen.has(key)) return;
    nextLines.push(`${key}=${updates[key]}`);
  });

  return `${nextLines.join("\n").replace(/\n+$/g, "")}\n`;
};

const buildDatabaseUrl = ({ user, password, host, port, database }) => {
  const encodedUser = encodeURIComponent(String(user || ""));
  const encodedPassword = encodeURIComponent(String(password || ""));
  return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${database}`;
};

const resolveSessionSecret = (existingValue) => {
  const current = String(existingValue || "").trim();
  const looksPlaceholder = /chuoi-ngau-nhien|replace|example/i.test(current);
  if (current.length >= 32 && !looksPlaceholder) {
    return current;
  }
  return crypto.randomBytes(48).toString("hex");
};

const maskDatabaseUrl = (url) => {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch (_error) {
    return String(url || "");
  }
};


const printHelp = () => {
  console.log([
    "Usage: node scripts/setup-all.js [options]",
    "",
    "Cross-platform project bootstrap for Windows and Ubuntu.",
    `Requirements: Node.js LTS ${MIN_NODE_MAJOR}+ and PostgreSQL ${MIN_POSTGRES_MAJOR}+.`,
    "By default, setup runs in interactive wizard mode and asks each parameter.",
    "This script installs dependencies, creates env files, prepares DB,",
    "runs schema bootstrap, and builds required assets.",
    "",
    "Options:",
    "  --db-host <host>                 PostgreSQL host (default: 127.0.0.1)",
    "  --db-port <port>                 PostgreSQL port (default: 5432)",
    "  --db-name <name>                 App database name (default: moetruyen)",
    "  --db-user <user>                 App database user (default: postgres)",
    "  --db-pass <pass>                 App database password (default: 12345)",
    "  --admin-user <user>              Web admin username (default: admin)",
    "  --admin-pass <pass>              Web admin password (default: 12345)",
    "  --app-port <port>                Web port (default: 3000)",
    "  --api-port <port>                API server port (default: 3001)",
    "  --with-api <true|false>          Install api_server deps (default: true)",
    "  --with-forum <true|false>        Install/build sampleforum (default: true)",
    "  --with-desktop <true|false>      Install app_desktop deps (default: false)",
    "  --existing-db-action <mode>      Existing DB behavior: overwrite|stop|ask (default: ask)",
    "  --setup-s3 <true|false>          Setup S3 vars now",
    "  --s3-endpoint <url>              S3 endpoint (optional)",
    "  --s3-bucket <name>               S3 bucket",
    "  --s3-region <name>               S3 region (default: us-east-1)",
    "  --s3-access-key-id <id>          S3 access key id",
    "  --s3-secret-access-key <secret>  S3 secret access key",
    "  --s3-force-path-style <bool>     S3 force path style",
    "  --chapter-cdn-base-url <url>     CDN base URL for chapter images",
    "  --s3-chapter-prefix <prefix>     S3 chapter prefix (default: chapters)",
    "  --setup-google <true|false>      Setup Google OAuth vars now",
    "  --google-client-id <id>          Google OAuth client id",
    "  --google-client-secret <secret>  Google OAuth client secret",
    "  --setup-discord <true|false>     Setup Discord OAuth vars now",
    "  --discord-client-id <id>         Discord OAuth client id",
    "  --discord-client-secret <secret> Discord OAuth client secret",
    "  --non-interactive                Do not prompt; use args/env/defaults",
    "  --start                          Start web server (`npm run dev`) after setup",
    "  --help                           Show this help",
    "",
    "Examples:",
    "  npm run setup:all",
    "  npm run setup:all -- --db-user=postgres --db-pass=12345",
    "  npm run setup:all -- --existing-db-action=overwrite",
    "  npm run setup:all -- --non-interactive --setup-s3=true --setup-google=false --setup-discord=false",
    "  npm run setup:all -- --with-desktop=true",
    ""
  ].join("\n"));
};

const main = async () => {
  if (process.platform !== "win32" && process.platform !== "linux") {
    throw new Error("This setup script supports Windows and Linux/Ubuntu only.");
  }

  const nodeMajor = Number.parseInt(String(process.versions && process.versions.node || "0").split(".")[0], 10);
  if (!Number.isFinite(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
    throw new Error(`Node.js LTS ${MIN_NODE_MAJOR}+ is required. Please upgrade Node.js and run again.`);
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const rootEnvTemplatePath = path.join(projectRoot, ".env.example");
  const rootEnvPath = path.join(projectRoot, ".env");
  const apiEnvTemplatePath = path.join(projectRoot, "api_server", ".env.example");
  const apiEnvPath = path.join(projectRoot, "api_server", ".env");

  ensureFileFromTemplate(rootEnvPath, rootEnvTemplatePath);

  const rootEnvOriginal = readTextFile(rootEnvPath);
  const rootEnvMap = readEnvMap(rootEnvOriginal);
  const parsedDatabaseUrl = parseDatabaseUrlParts(rootEnvMap.DATABASE_URL);
  const hasS3Configured = Boolean(
    String(rootEnvMap.S3_BUCKET || "").trim() &&
    String(rootEnvMap.S3_ACCESS_KEY_ID || "").trim() &&
    String(rootEnvMap.S3_SECRET_ACCESS_KEY || "").trim()
  );
  const hasGoogleConfigured = Boolean(
    String(rootEnvMap.GOOGLE_CLIENT_ID || "").trim() &&
    String(rootEnvMap.GOOGLE_CLIENT_SECRET || "").trim()
  );
  const hasDiscordConfigured = Boolean(
    String(rootEnvMap.DISCORD_CLIENT_ID || "").trim() &&
    String(rootEnvMap.DISCORD_CLIENT_SECRET || "").trim()
  );

  const seedOptions = {
    dbHost: String(args["db-host"] || process.env.SETUP_DB_HOST || parsedDatabaseUrl.host || "127.0.0.1").trim() || "127.0.0.1",
    dbPort: parsePort(args["db-port"] || process.env.SETUP_DB_PORT || parsedDatabaseUrl.port, 5432),
    dbName: String(args["db-name"] || process.env.SETUP_DB_NAME || parsedDatabaseUrl.database || "moetruyen").trim() || "moetruyen",
    dbUser: String(args["db-user"] || process.env.SETUP_DB_USER || parsedDatabaseUrl.user || "postgres").trim() || "postgres",
    dbPassword: String(args["db-pass"] || process.env.SETUP_DB_PASS || parsedDatabaseUrl.password || "12345"),
    webAdminUser: String(args["admin-user"] || process.env.SETUP_ADMIN_USER || rootEnvMap.ADMIN_USER || "admin").trim() || "admin",
    webAdminPass: String(args["admin-pass"] || process.env.SETUP_ADMIN_PASS || rootEnvMap.ADMIN_PASS || "12345"),
    appPort: parsePort(args["app-port"] || process.env.SETUP_APP_PORT || rootEnvMap.PORT, 3000),
    apiPort: parsePort(args["api-port"] || process.env.SETUP_API_PORT, 3001),
    withApi: parseBoolean(args["with-api"], true),
    withForum: parseBoolean(
      args["with-forum"],
      parseBoolean(rootEnvMap.FORUM_PAGE_ENABLED, true)
    ),
    withDesktop: parseBoolean(args["with-desktop"], false),
    setupS3Now: parseBoolean(args["setup-s3"], hasS3Configured),
    s3Endpoint: String(args["s3-endpoint"] || process.env.SETUP_S3_ENDPOINT || rootEnvMap.S3_ENDPOINT || "").trim(),
    s3Bucket: String(args["s3-bucket"] || process.env.SETUP_S3_BUCKET || rootEnvMap.S3_BUCKET || "").trim(),
    s3Region: String(args["s3-region"] || process.env.SETUP_S3_REGION || rootEnvMap.S3_REGION || "us-east-1").trim() || "us-east-1",
    s3AccessKeyId: String(args["s3-access-key-id"] || process.env.SETUP_S3_ACCESS_KEY_ID || rootEnvMap.S3_ACCESS_KEY_ID || "").trim(),
    s3SecretAccessKey: String(args["s3-secret-access-key"] || process.env.SETUP_S3_SECRET_ACCESS_KEY || rootEnvMap.S3_SECRET_ACCESS_KEY || "").trim(),
    s3ForcePathStyle: String(
      args["s3-force-path-style"] ||
      process.env.SETUP_S3_FORCE_PATH_STYLE ||
      rootEnvMap.S3_FORCE_PATH_STYLE ||
      "true"
    ).trim() || "true",
    chapterCdnBaseUrl: String(
      args["chapter-cdn-base-url"] ||
      process.env.SETUP_CHAPTER_CDN_BASE_URL ||
      rootEnvMap.CHAPTER_CDN_BASE_URL ||
      ""
    ).trim(),
    s3ChapterPrefix: String(
      args["s3-chapter-prefix"] ||
      process.env.SETUP_S3_CHAPTER_PREFIX ||
      rootEnvMap.S3_CHAPTER_PREFIX ||
      "chapters"
    ).trim() || "chapters",
    setupGoogleNow: parseBoolean(args["setup-google"], hasGoogleConfigured),
    googleClientId: String(
      args["google-client-id"] ||
      process.env.SETUP_GOOGLE_CLIENT_ID ||
      rootEnvMap.GOOGLE_CLIENT_ID ||
      ""
    ).trim(),
    googleClientSecret: String(
      args["google-client-secret"] ||
      process.env.SETUP_GOOGLE_CLIENT_SECRET ||
      rootEnvMap.GOOGLE_CLIENT_SECRET ||
      ""
    ).trim(),
    setupDiscordNow: parseBoolean(args["setup-discord"], hasDiscordConfigured),
    discordClientId: String(
      args["discord-client-id"] ||
      process.env.SETUP_DISCORD_CLIENT_ID ||
      rootEnvMap.DISCORD_CLIENT_ID ||
      ""
    ).trim(),
    discordClientSecret: String(
      args["discord-client-secret"] ||
      process.env.SETUP_DISCORD_CLIENT_SECRET ||
      rootEnvMap.DISCORD_CLIENT_SECRET ||
      ""
    ).trim(),
    existingDbAction: normalizeExistingDbAction(
      args["existing-db-action"] || process.env.SETUP_EXISTING_DB_ACTION,
      "ask"
    ),
    startWeb: parseBoolean(args.start, false),
    nonInteractive: parseBoolean(args["non-interactive"], false)
  };

  const options = seedOptions.nonInteractive
    ? seedOptions
    : await collectInteractiveOptions(seedOptions);

  console.log("\n==> Kiểm tra kết nối SQL với thông số bạn vừa nhập...");
  const sqlCheck = testSqlConnectionWithPsql({
    host: options.dbHost,
    port: options.dbPort,
    database: options.dbName,
    user: options.dbUser,
    password: options.dbPassword,
    minMajor: MIN_POSTGRES_MAJOR
  });
  console.log(`==> Kết nối SQL thành công (PostgreSQL ${sqlCheck.major}).`);

  const existingTableCount = getSchemaTableCountWithPsql({
    host: options.dbHost,
    port: options.dbPort,
    database: options.dbName,
    user: options.dbUser,
    password: options.dbPassword
  });

  let existingDbAction = normalizeExistingDbAction(
    options.existingDbAction,
    options.nonInteractive ? "overwrite" : "ask"
  );

  if (existingTableCount > 0) {
    if (existingDbAction === "ask") {
      existingDbAction = options.nonInteractive
        ? "overwrite"
        : await promptExistingDbAction({ tableCount: existingTableCount });
    }

    if (existingDbAction === "stop") {
      console.log("\nSetup đã dừng theo lựa chọn của bạn vì database đã có dữ liệu.");
      return;
    }
  } else {
    existingDbAction = "overwrite";
  }

  if (options.setupS3Now) {
    const requiredS3 = [
      ["S3 bucket", options.s3Bucket],
      ["S3 access key id", options.s3AccessKeyId],
      ["S3 secret access key", options.s3SecretAccessKey]
    ];
    const missing = requiredS3.filter((entry) => !String(entry[1] || "").trim()).map((entry) => entry[0]);
    if (missing.length) {
      throw new Error(`Missing required S3 values: ${missing.join(", ")}`);
    }
  }

  if (options.setupGoogleNow) {
    if (!String(options.googleClientId || "").trim() || !String(options.googleClientSecret || "").trim()) {
      throw new Error("Google OAuth setup is enabled but GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET is empty.");
    }
  }

  if (options.setupDiscordNow) {
    if (!String(options.discordClientId || "").trim() || !String(options.discordClientSecret || "").trim()) {
      throw new Error("Discord OAuth setup is enabled but DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET is empty.");
    }
  }

  if (options.withApi) {
    ensureFileFromTemplate(apiEnvPath, apiEnvTemplatePath);
  }

  const databaseUrl = buildDatabaseUrl({
    user: options.dbUser,
    password: options.dbPassword,
    host: options.dbHost,
    port: options.dbPort,
    database: options.dbName
  });

  const sessionSecret = resolveSessionSecret(rootEnvMap.SESSION_SECRET);
  const rootEnvUpdates = {
    PORT: String(options.appPort),
    APP_ENV: String(rootEnvMap.APP_ENV || "development").trim() || "development",
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: sessionSecret,
    ADMIN_USER: options.webAdminUser,
    ADMIN_PASS: options.webAdminPass,
    ADMIN_PASSWORD_LOGIN_ENABLED:
      String(rootEnvMap.ADMIN_PASSWORD_LOGIN_ENABLED || "1").trim() || "1",
    FORUM_PAGE_ENABLED: options.withForum ? "true" : "false"
  };

  if (!String(rootEnvMap.NEWS_PAGE_ENABLED || "").trim()) {
    rootEnvUpdates.NEWS_PAGE_ENABLED = "off";
  }

  if (options.setupS3Now) {
    rootEnvUpdates.S3_ENDPOINT = String(options.s3Endpoint || "").trim();
    rootEnvUpdates.S3_BUCKET = String(options.s3Bucket || "").trim();
    rootEnvUpdates.S3_REGION = String(options.s3Region || "us-east-1").trim() || "us-east-1";
    rootEnvUpdates.S3_ACCESS_KEY_ID = String(options.s3AccessKeyId || "").trim();
    rootEnvUpdates.S3_SECRET_ACCESS_KEY = String(options.s3SecretAccessKey || "").trim();
    rootEnvUpdates.S3_FORCE_PATH_STYLE = parseBoolean(options.s3ForcePathStyle, true) ? "true" : "false";
    rootEnvUpdates.CHAPTER_CDN_BASE_URL = String(options.chapterCdnBaseUrl || "").trim();
    rootEnvUpdates.S3_CHAPTER_PREFIX = String(options.s3ChapterPrefix || "chapters").trim() || "chapters";
  }

  if (options.setupGoogleNow) {
    rootEnvUpdates.GOOGLE_CLIENT_ID = String(options.googleClientId || "").trim();
    rootEnvUpdates.GOOGLE_CLIENT_SECRET = String(options.googleClientSecret || "").trim();
  }

  if (options.setupDiscordNow) {
    rootEnvUpdates.DISCORD_CLIENT_ID = String(options.discordClientId || "").trim();
    rootEnvUpdates.DISCORD_CLIENT_SECRET = String(options.discordClientSecret || "").trim();
  }

  const rootEnvNext = upsertEnvValues(rootEnvOriginal, rootEnvUpdates);
  writeTextFile(rootEnvPath, rootEnvNext);
  const rootEnvFinalMap = readEnvMap(rootEnvNext);

  if (options.withApi) {
    const apiEnvOriginal = readTextFile(apiEnvPath);
    const apiEnvUpdates = {
      PORT: String(options.apiPort),
      DATABASE_URL: databaseUrl,
      API_KEY_SECRET: sessionSecret,
      WEB_BASE_URL: `http://127.0.0.1:${options.appPort}`
    };

    [
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_FORCE_PATH_STYLE",
      "S3_CHAPTER_PREFIX"
    ].forEach((key) => {
      const value = String(rootEnvFinalMap[key] || "").trim();
      if (!value) return;
      apiEnvUpdates[key] = value;
    });

    const apiEnvNext = upsertEnvValues(apiEnvOriginal, apiEnvUpdates);
    writeTextFile(apiEnvPath, apiEnvNext);
  }

  console.log("\nSetup configuration:");
  console.log(`- Platform: ${process.platform}`);
  console.log(`- Web database: ${maskDatabaseUrl(databaseUrl)}`);
  console.log(`- Web port: ${options.appPort}`);
  console.log(`- API enabled: ${options.withApi ? "yes" : "no"}`);
  console.log(`- Forum enabled: ${options.withForum ? "yes" : "no"}`);
  console.log(`- Desktop deps install: ${options.withDesktop ? "yes" : "no"}`);
  console.log(`- Setup S3 now: ${options.setupS3Now ? "yes" : "no"}`);
  console.log(`- Setup Google OAuth now: ${options.setupGoogleNow ? "yes" : "no"}`);
  console.log(`- Setup Discord OAuth now: ${options.setupDiscordNow ? "yes" : "no"}`);
  console.log(`- Interactive mode: ${options.nonInteractive ? "off" : "on"}`);
  console.log(`- Existing DB tables: ${existingTableCount}`);
  console.log(`- Existing DB action: ${existingDbAction}`);

  runNpmCommand({
    title: "Install root dependencies",
    args: ["install"]
  });

  if (options.withApi) {
    runNpmCommand({
      title: "Install api_server dependencies",
      args: ["--prefix", "api_server", "install"]
    });
  }

  if (options.withForum) {
    runNpmCommand({
      title: "Install sampleforum dependencies",
      args: ["--prefix", "sampleforum", "install"]
    });
  }

  if (options.withDesktop) {
    runNpmCommand({
      title: "Install app_desktop dependencies",
      args: ["--prefix", "app_desktop", "install"]
    });
  }

  try {
    runNpmCommand({
      title: "Bootstrap database schema",
      args: ["run", "db:bootstrap"]
    });
  } catch (error) {
    if (existingTableCount === 0 || existingDbAction === "overwrite") {
      console.log("\n==> Schema chưa khớp db.json. Đang thử tự đồng bộ snapshot rồi bootstrap lại...");
      runNpmCommand({
        title: "Sync db.json from current database",
        args: ["run", "db:schema:json:sync"]
      });
      runNpmCommand({
        title: "Bootstrap database schema (retry)",
        args: ["run", "db:bootstrap"]
      });
    } else {
      throw error;
    }
  }

  runNpmCommand({
    title: "Build web styles",
    args: ["run", "styles:build"]
  });

  if (options.withForum) {
    runNpmCommand({
      title: "Build sampleforum frontend",
      args: ["--prefix", "sampleforum", "run", "build"]
    });
  }

  console.log("\nSetup completed successfully.");
  console.log(`- Root env: ${path.relative(projectRoot, rootEnvPath)}`);
  if (options.withApi) {
    console.log(`- API env: ${path.relative(projectRoot, apiEnvPath)}`);
  }
  if (!options.setupS3Now) {
    console.log("- S3 setup skipped: hãy cấu hình S3_* và CHAPTER_CDN_BASE_URL trong .env khi cần.");
  }
  if (!options.setupGoogleNow) {
    console.log("- Google OAuth skipped: hãy cập nhật GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET trong .env khi cần.");
  }
  if (!options.setupDiscordNow) {
    console.log("- Discord OAuth skipped: hãy cập nhật DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET trong .env khi cần.");
  }
  console.log("\nRun services:");
  console.log(`- Web: ${npmCommand} run dev`);
  if (options.withApi) {
    console.log(`- API: ${npmCommand} --prefix api_server run start`);
  }

  if (options.startWeb) {
    runNpmCommand({
      title: "Start web server",
      args: ["run", "dev"]
    });
  }
};

main().catch((error) => {
  console.error("\nSetup failed.");
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
