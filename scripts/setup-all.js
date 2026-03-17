#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const npmCommand = "npm";
const psqlCommand = process.platform === "win32" ? "psql.exe" : "psql";
const MIN_NODE_MAJOR = 20;
const MIN_POSTGRES_MAJOR = 16;
const INSTALLER_UI_FLAG = "installer-ui";
const INSTALLER_NEW_WINDOW_FLAG = "new-window";
const INSTALLER_TUI_DEPENDENCIES = ["chalk", "ora", "listr2", "boxen", "inquirer"];

const createTerminalUi = () => {
  const term = String(process.env.TERM || "").trim().toLowerCase();
  const isStdoutTty = Boolean(process.stdout && process.stdout.isTTY);
  const isStdinTty = Boolean(process.stdin && process.stdin.isTTY);
  const canInlineUpdate = Boolean(
    isStdoutTty
      && process.stdout
      && typeof process.stdout.clearLine === "function"
      && typeof process.stdout.cursorTo === "function"
  );

  const colorEnabled = (() => {
    const forced = process.env.FORCE_COLOR;
    if (forced != null) {
      const text = String(forced).trim().toLowerCase();
      if (!text) return true;
      return !["0", "false", "no", "off"].includes(text);
    }
    if (process.env.NO_COLOR != null) return false;
    if (!isStdoutTty) return false;
    if (term === "dumb") return false;
    return true;
  })();

  const unicodeEnabled = isStdoutTty && term !== "dumb";

  const ansi = {
    reset: "\u001b[0m",
    bold: "\u001b[1m",
    dim: "\u001b[2m",
    underline: "\u001b[4m",
    noUnderline: "\u001b[24m",
    red: "\u001b[31m",
    green: "\u001b[32m",
    yellow: "\u001b[33m",
    blue: "\u001b[34m",
    magenta: "\u001b[35m",
    cyan: "\u001b[36m",
    gray: "\u001b[90m"
  };

  const tones = {
    step: ansi.blue,
    info: ansi.cyan,
    ok: ansi.green,
    warn: ansi.yellow,
    fail: ansi.red,
    wait: ansi.magenta
  };

  const styleText = (text, codes = []) => {
    const value = String(text == null ? "" : text);
    if (!colorEnabled || !codes.length) return value;
    return `${codes.join("")}${value}${ansi.reset}`;
  };

  const getLineWidth = () => {
    const columns = Number(process.stdout && process.stdout.columns);
    if (!Number.isFinite(columns) || columns <= 0) return 68;
    return Math.max(12, Math.min(columns - 2, 88));
  };

  const rule = (char) => {
    const token = String(char || (unicodeEnabled ? "─" : "-"));
    return token.repeat(getLineWidth());
  };

  const badge = (label, tone) => styleText(`[${label}]`, [ansi.bold, tone]);
  const symbol = (label, tone) => styleText(label, [ansi.bold, tone]);

  const statusLine = ({ label, tone, message, stderr = false, blankLine = false }) => {
    const output = stderr ? console.error : console.log;
    if (blankLine) {
      output("");
    }
    output(`${badge(label, tone)} ${message}`);
  };

  const paintTone = (text, tone, extraCodes = []) => {
    const codes = [ansi.bold];
    if (tone) {
      codes.push(tone);
    }
    if (Array.isArray(extraCodes) && extraCodes.length) {
      codes.push(...extraCodes);
    }
    return styleText(text, codes);
  };

  const inline = (message, persist = false) => {
    const text = String(message == null ? "" : message);
    if (!canInlineUpdate) {
      if (persist) {
        console.log(text);
      } else {
        console.log(text);
      }
      return;
    }

    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(text);
    if (persist) {
      process.stdout.write("\n");
    }
  };

  const printKeyValueBlock = (title, rows) => {
    const safeRows = Array.isArray(rows) ? rows : [];
    console.log("");
    console.log(styleText(title, [ansi.bold, tones.info]));
    console.log(styleText(rule(), [ansi.dim]));
    const keyWidth = safeRows.reduce((max, entry) => {
      const key = Array.isArray(entry) ? entry[0] : "";
      return Math.max(max, String(key || "").length);
    }, 0);

    safeRows.forEach((entry) => {
      const key = Array.isArray(entry) ? entry[0] : "";
      const value = Array.isArray(entry) ? entry[1] : "";
      const padded = String(key || "").padEnd(keyWidth, " ");
      console.log(`  ${styleText(padded, [ansi.dim])} : ${value}`);
    });
  };

  return {
    isInteractive: isStdoutTty && isStdinTty,
    canInlineUpdate,
    muted: (text) => styleText(text, [ansi.dim]),
    strong: (text) => styleText(text, [ansi.bold]),
    accent: (text) => styleText(text, [ansi.bold, tones.info]),
    command: (text) => styleText(text, [ansi.bold, tones.step]),
    paintInfo: (text) => paintTone(text, tones.info),
    paintOk: (text) => paintTone(text, tones.ok),
    paintWarn: (text) => paintTone(text, tones.warn),
    paintFail: (text) => paintTone(text, tones.fail),
    paintWait: (text) => paintTone(text, tones.wait),
    yesNo: (value) => {
      if (value) return styleText("yes", [ansi.bold, tones.ok]);
      return styleText("no", [ansi.dim]);
    },
    underlineChoice: (text) => {
      const value = String(text == null ? "" : text);
      if (!colorEnabled) {
        return `_${value}_`;
      }
      return `${ansi.underline}${value}${ansi.noUnderline}`;
    },
    prompt: (label) => `${symbol("?", tones.info)} ${label}: `,
    validation: (message) => {
      console.log(`  ${symbol("!", tones.warn)} ${message}`);
    },
    banner: (title, subtitle) => {
      const border = styleText(rule(unicodeEnabled ? "═" : "="), [tones.step]);
      console.log("");
      console.log(border);
      console.log(styleText(` ${title}`, [ansi.bold, tones.info]));
      if (subtitle) {
        console.log(styleText(` ${subtitle}`, [ansi.dim]));
      }
      console.log(border);
    },
    section: (title) => {
      console.log("");
      console.log(styleText(title, [ansi.bold, tones.info]));
      console.log(styleText(rule(), [ansi.dim]));
    },
    status: statusLine,
    step: (label, message, blankLine = false) => statusLine({ label, tone: tones.step, message, blankLine }),
    info: (message) => statusLine({ label: "INFO", tone: tones.info, message }),
    ok: (message) => statusLine({ label: " OK ", tone: tones.ok, message }),
    warn: (message) => statusLine({ label: "WARN", tone: tones.warn, message }),
    wait: (message) => statusLine({ label: "WAIT", tone: tones.wait, message }),
    fail: (message) => statusLine({ label: "FAIL", tone: tones.fail, message, stderr: true }),
    inline,
    printKeyValueBlock
  };
};

const terminalUi = createTerminalUi();

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

const stripInstallerUiArgTokens = (argv) => {
  const tokens = Array.isArray(argv) ? argv : [];
  const filtered = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = String(tokens[i] == null ? "" : tokens[i]).trim();
    const lower = token.toLowerCase();
    if (!token) continue;

    if (lower === `--${INSTALLER_UI_FLAG}`) {
      const next = tokens[i + 1];
      const nextText = String(next == null ? "" : next).trim();
      if (nextText && !nextText.startsWith("--")) {
        i += 1;
      }
      continue;
    }

    if (lower.startsWith(`--${INSTALLER_UI_FLAG}=`)) {
      continue;
    }

    filtered.push(String(tokens[i]));
  }

  return filtered;
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

const askSecretQuestion = (rl, promptText) => new Promise((resolve) => {
  const originalWrite = rl._writeToOutput;
  rl.stdoutMuted = true;
  rl._writeToOutput = (stringToWrite) => {
    const text = String(stringToWrite == null ? "" : stringToWrite);
    if (rl.stdoutMuted) {
      if (!text) {
        return;
      }
      if (text === promptText) {
        rl.output.write(text);
        return;
      }
      if (text.includes("\n") || text.includes("\r")) {
        rl.output.write(text);
        return;
      }
      rl.output.write("*");
      return;
    }
    if (typeof originalWrite === "function") {
      originalWrite.call(rl, text);
      return;
    }
    rl.output.write(text);
  };

  rl.question(promptText, (answer) => {
    rl.stdoutMuted = false;
    rl._writeToOutput = originalWrite;
    rl.output.write("\n");
    resolve(String(answer == null ? "" : answer));
  });
});

const quoteArgForDisplay = (value) => {
  const text = String(value == null ? "" : value);
  if (!text) return '""';
  if (!/[\s"'`$\\]/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
};

const formatCommandPreview = (command, args = []) => {
  return [command, ...args].map((part) => quoteArgForDisplay(part)).join(" ").trim();
};

const formatUnderlinedChoice = (value) => {
  return terminalUi.underlineChoice(value);
};

const promptTextValue = async ({ rl, label, defaultValue = "", allowEmpty = false, secret = false }) => {
  while (true) {
    const fallback = String(defaultValue == null ? "" : defaultValue);
    const suffix = fallback ? (secret ? "" : ` [${fallback}]`) : "";
    const clearHint = allowEmpty && fallback ? " (Enter để giữ, nhập - để xóa)" : "";
    const questionText = terminalUi.prompt(`${label}${suffix}${clearHint}`);
    const answer = secret
      ? await askSecretQuestion(rl, questionText)
      : await askQuestion(rl, questionText);
    const value = String(answer || "").trim();

    if (allowEmpty && value === "-") {
      return "";
    }

    if (!value) {
      if (fallback) {
        return fallback;
      }
      if (allowEmpty) {
        return "";
      }
      terminalUi.validation("Giá trị không được để trống.");
      continue;
    }

    return value;
  }
};

const promptPortValue = async ({ rl, label, defaultValue }) => {
  while (true) {
    const fallback = Number.isFinite(defaultValue) ? defaultValue : 0;
    const answer = await askQuestion(rl, terminalUi.prompt(`${label} [${fallback}]`));
    const raw = String(answer || "").trim();
    const candidate = raw ? Number.parseInt(raw, 10) : fallback;
    if (Number.isFinite(candidate) && candidate >= 1 && candidate <= 65535) {
      return Math.floor(candidate);
    }
    terminalUi.validation("Port phải là số từ 1 đến 65535.");
  }
};

const promptBooleanValue = async ({ rl, label, defaultValue = false }) => {
  const fallback = Boolean(defaultValue);
  const hint = fallback
    ? `${formatUnderlinedChoice("Y")}/n`
    : `y/${formatUnderlinedChoice("N")}`;

  while (true) {
    const answer = await askQuestion(rl, terminalUi.prompt(`${label} (${hint})`));
    const raw = String(answer || "").trim().toLowerCase();
    if (!raw) return fallback;
    if (["y", "yes", "1", "true", "on", "co", "c", "có", "ok"].includes(raw)) return true;
    if (["n", "no", "0", "false", "off", "khong", "không", "k"].includes(raw)) return false;
    terminalUi.validation("Nhập y/yes hoặc n/no.");
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
    terminalUi.section("Interactive Setup Wizard");
    console.log(terminalUi.muted("Nhập từng thông số cấu hình. Nhấn Enter để dùng giá trị trong ngoặc []."));
    console.log(terminalUi.muted("Mẹo: với các trường tùy chọn đã có giá trị, nhập '-' để xóa."));

    terminalUi.section("Database và tài khoản admin");

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
      defaultValue: seedOptions.dbPassword,
      secret: true
    });

    const webAdminUser = await promptTextValue({
      rl,
      label: "username admin web",
      defaultValue: seedOptions.webAdminUser
    });

    const webAdminPass = await promptTextValue({
      rl,
      label: "Password admin web",
      defaultValue: seedOptions.webAdminPass,
      secret: true
    });

    terminalUi.section("Port ứng dụng và module tùy chọn");

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
      terminalUi.section("Cấu hình S3");

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
        defaultValue: seedOptions.s3SecretAccessKey,
        secret: true
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

    terminalUi.section("OAuth (Google / Discord)");

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
        defaultValue: seedOptions.googleClientSecret,
        secret: true
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
        defaultValue: seedOptions.discordClientSecret,
        secret: true
      });
    }

    terminalUi.section("Khởi động sau setup");

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

const promptExistingDbAction = async ({ tableCount, inquirerPrompt = null }) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "overwrite";
  }

  if (inquirerPrompt && typeof inquirerPrompt === "function") {
    terminalUi.section("Database đã có dữ liệu");
    terminalUi.warn(`Database hiện đã có ${tableCount} bảng trong schema hiện tại.`);
    const response = await inquirerPrompt([
      {
        type: "list",
        name: "dbAction",
        message: "Chọn hướng xử lý",
        default: "overwrite",
        choices: [
          {
            name: "Ghi đè setup (không xóa dữ liệu hiện có)",
            value: "overwrite"
          },
          {
            name: "Dừng setup",
            value: "stop"
          }
        ]
      }
    ]);
    return normalizeExistingDbAction(response && response.dbAction ? response.dbAction : "overwrite", "overwrite");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    terminalUi.section("Database đã có dữ liệu");
    terminalUi.warn(`Database hiện đã có ${tableCount} bảng trong schema hiện tại.`);
    console.log(terminalUi.muted("Chọn hướng xử lý:"));
    console.log(`  ${terminalUi.strong("1)")} Ghi đè setup (không xóa dữ liệu hiện có)`);
    console.log(`  ${terminalUi.strong("2)")} Dừng setup`);

    while (true) {
      const answer = String(await askQuestion(rl, terminalUi.prompt("Lựa chọn [1/2] (mặc định 1)"))).trim().toLowerCase();
      if (!answer || answer === "1") {
        return "overwrite";
      }
      if (answer === "2") {
        return "stop";
      }
      terminalUi.validation("Vui lòng nhập 1 hoặc 2.");
    }
  } finally {
    rl.close();
  }
};

const formatDuration = (ms) => {
  const safeMs = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  if (safeMs < 1000) return `${safeMs}ms`;
  const seconds = Math.floor(safeMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `${minutes}m${String(remSeconds).padStart(2, "0")}s`;
};

let setupStepCounter = 0;

const logStepStart = (title) => {
  setupStepCounter += 1;
  const index = String(setupStepCounter).padStart(2, "0");
  terminalUi.step(`STEP ${index}`, title, true);
  return setupStepCounter;
};

const logStepDone = (title, elapsedMs) => {
  terminalUi.ok(`${title} (${formatDuration(elapsedMs)})`);
};

const logStepFail = (title, elapsedMs) => {
  terminalUi.fail(`${title} (${formatDuration(elapsedMs)})`);
};

const printSetupBanner = () => {
  const logoLines = [
    "███╗   ███╗ ██████╗ ███████╗    ████████╗██████╗ ██╗   ██╗██╗   ██╗███████╗███╗   ██╗",
    "████╗ ████║██╔═══██╗██╔════╝    ╚══██╔══╝██╔══██╗██║   ██║╚██╗ ██╔╝██╔════╝████╗  ██║",
    "██╔████╔██║██║   ██║█████╗         ██║   ██████╔╝██║   ██║ ╚████╔╝ █████╗  ██╔██╗ ██║",
    "██║╚██╔╝██║██║   ██║██╔══╝         ██║   ██╔══██╗██║   ██║  ╚██╔╝  ██╔══╝  ██║╚██╗██║",
    "██║ ╚═╝ ██║╚██████╔╝███████╗       ██║   ██║  ██║╚██████╔╝   ██║   ███████╗██║ ╚████║",
    "╚═╝     ╚═╝ ╚═════╝ ╚══════╝       ╚═╝   ╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═══╝"
  ];

  console.log("");
  logoLines.forEach((line) => {
    console.log(terminalUi.accent(line));
  });

  terminalUi.banner(
    "MOETRUYEN Professional Installer",
    `Node.js ${MIN_NODE_MAJOR}+ | PostgreSQL ${MIN_POSTGRES_MAJOR}+ | Cross-platform setup`
  );
};

const runCommand = async ({ title, command, args = [], cwd = projectRoot, extraEnv = null, capture = false, shell = false }) => {
  const startedAt = Date.now();
  logStepStart(title);
  const commandPreview = formatCommandPreview(command, args);

  if (commandPreview) {
    console.log(`  ${terminalUi.muted("$")} ${terminalUi.command(commandPreview)}`);
  }

  const queueCapture = capture;
  const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
  const result = spawnSync(command, args, {
    cwd,
    env,
    shell,
    stdio: queueCapture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: queueCapture ? "utf8" : undefined
  });

  if (result.error) {
    logStepFail(title, Date.now() - startedAt);
    throw result.error;
  }

  if (result.signal) {
    const signalName = String(result.signal || "").trim() || "UNKNOWN";
    const signalMessage = `Command terminated by signal ${signalName}.`;
    console.error(signalMessage);
    logStepFail(title, Date.now() - startedAt);
    throw new Error(signalMessage);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    const stderr = queueCapture ? String(result.stderr || "").trim() : "";
    const stdout = queueCapture ? String(result.stdout || "").trim() : "";
    const detailText = stderr || stdout;
    const detail = detailText ? `\n${detailText}` : "";

    if (detailText) {
      console.error(detailText);
    }

    logStepFail(title, Date.now() - startedAt);
    throw new Error(`Command failed: ${command} ${args.join(" ")}${detail}`);
  }

  logStepDone(title, Date.now() - startedAt);

  return result;
};

const resolveNpmInvocation = ({ args = [] }) => {
  const npmExecPath = String(process.env.npm_execpath || "").trim();
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
      shell: false
    };
  }

  if (process.platform === "win32") {
    return {
      command: "npm",
      args,
      shell: true
    };
  }

  return {
    command: "npm",
    args,
    shell: false
  };
};

const runNpmCommand = async ({ title, args = [], cwd = projectRoot }) => {
  const invocation = resolveNpmInvocation({ args });
  return runCommand({
    title,
    command: invocation.command,
    args: invocation.args,
    cwd,
    shell: invocation.shell
  });
};

const trimCommandErrorDetail = (text) => {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  const lines = raw.split("\n").filter((line) => line.trim());
  return lines.slice(-10).join("\n");
};

const runNpmCommandCaptured = async ({ args = [], cwd = projectRoot, task = null }) => {
  const invocation = resolveNpmInvocation({ args });
  const commandText = formatCommandPreview(invocation.command, invocation.args);
  if (task && typeof task === "object") {
    task.output = commandText;
  }

  return new Promise((resolve, reject) => {
    const stdoutParts = [];
    const stderrParts = [];
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: process.env,
      shell: invocation.shell,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.on("error", (error) => {
      reject(error);
    });

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdoutParts.push(String(chunk || ""));
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderrParts.push(String(chunk || ""));
      });
    }

    child.on("close", (code, signal) => {
      const stdout = trimCommandErrorDetail(stdoutParts.join(""));
      const stderr = trimCommandErrorDetail(stderrParts.join(""));
      if (signal) {
        reject(new Error(`Command terminated by signal ${signal}`));
        return;
      }
      if (typeof code === "number" && code !== 0) {
        const detail = stderr || stdout || `Command exited with status ${code}`;
        reject(new Error(detail));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
};

const runNpmInstallerDependenciesSilently = async () => {
  const invocation = resolveNpmInvocation({
    args: [
      "install",
      "--no-save",
      "--no-package-lock",
      "--silent",
      "--no-audit",
      "--no-fund",
      ...INSTALLER_TUI_DEPENDENCIES
    ]
  });

  await new Promise((resolve, reject) => {
    const stderrParts = [];
    const child = spawn(invocation.command, invocation.args, {
      cwd: projectRoot,
      env: process.env,
      shell: invocation.shell,
      stdio: ["ignore", "ignore", "pipe"]
    });

    child.on("error", (error) => {
      reject(error);
    });

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderrParts.push(String(chunk || ""));
      });
    }

    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`Installer bootstrap bị dừng bởi signal ${signal}`));
        return;
      }

      if (typeof code === "number" && code !== 0) {
        const detail = trimCommandErrorDetail(stderrParts.join(""));
        reject(new Error(detail || `Installer bootstrap failed with status ${code}`));
        return;
      }

      resolve();
    });
  });
};

const toPowerShellSingleQuoted = (value) => {
  return `'${String(value == null ? "" : value).replace(/'/g, "''")}'`;
};

const launchInstallerUiWindow = ({ forwardArgs = [] }) => {
  const scriptPath = path.join(projectRoot, "scripts", "setup-all.js");
  const args = [scriptPath, ...forwardArgs];

  if (process.platform === "win32") {
    const argList = args.map((entry) => toPowerShellSingleQuoted(entry)).join(", ");
    const command = `Start-Process -FilePath ${toPowerShellSingleQuoted(process.execPath)} -ArgumentList @(${argList})`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      cwd: projectRoot,
      shell: false,
      stdio: "ignore"
    });
    if (result.error) {
      throw result.error;
    }
    if (typeof result.status === "number" && result.status !== 0) {
      throw new Error(`Không thể mở cửa sổ terminal mới (status ${result.status}).`);
    }
    return true;
  }

  return false;
};

const bootstrapInstallerUiWindow = async ({ rawArgv = [], openInNewWindow = false }) => {
  console.log("Đang khởi động trình cài đặt...");
  await runNpmInstallerDependenciesSilently();

  if (!openInNewWindow) {
    return false;
  }

  const forwardArgs = [
    ...stripInstallerUiArgTokens(rawArgv),
    `--${INSTALLER_UI_FLAG}=true`
  ];

  const launched = launchInstallerUiWindow({ forwardArgs });
  if (launched) {
    console.log("Đã mở cửa sổ cài đặt mới. Bạn có thể đóng cửa sổ hiện tại.");
  }
  return launched;
};

const loadInstallerUiLibraries = async () => {
  try {
    const [
      chalkModule,
      oraModule,
      listrModule,
      boxenModule,
      inquirerModule
    ] = await Promise.all([
      import("chalk"),
      import("ora"),
      import("listr2"),
      import("boxen"),
      import("inquirer")
    ]);

    return {
      chalk: chalkModule && chalkModule.default ? chalkModule.default : null,
      ora: oraModule && oraModule.default ? oraModule.default : null,
      Listr: listrModule && listrModule.Listr ? listrModule.Listr : null,
      boxen: boxenModule && boxenModule.default ? boxenModule.default : null,
      inquirer: inquirerModule && inquirerModule.default ? inquirerModule.default : inquirerModule
    };
  } catch (_error) {
    return null;
  }
};

const runSetupExecutionWithListr = async ({ options, existingTableCount, existingDbAction, Listr }) => {
  const tasks = [
    {
      title: "Install root dependencies",
      task: async (_ctx, task) => runNpmCommandCaptured({ args: ["install"], task })
    }
  ];

  if (options.withApi) {
    tasks.push({
      title: "Install api_server dependencies",
      task: async (_ctx, task) => runNpmCommandCaptured({ args: ["--prefix", "api_server", "install"], task })
    });
  }

  if (options.withForum) {
    tasks.push({
      title: "Install sampleforum dependencies",
      task: async (_ctx, task) => runNpmCommandCaptured({ args: ["--prefix", "sampleforum", "install"], task })
    });
  }

  if (options.withDesktop) {
    tasks.push({
      title: "Install app_desktop dependencies",
      task: async (_ctx, task) => runNpmCommandCaptured({ args: ["--prefix", "app_desktop", "install"], task })
    });
  }

  tasks.push({
    title: "Bootstrap database schema",
    task: async (_ctx, task) => {
      try {
        await runNpmCommandCaptured({ args: ["run", "db:bootstrap"], task });
      } catch (error) {
        if (existingTableCount > 0 && existingDbAction !== "overwrite") {
          throw error;
        }

        task.output = "Schema lệch db.json, đang sync snapshot rồi bootstrap lại...";
        await task.newListr([
          {
            title: "Sync db.json from current database",
            task: async (_subCtx, subTask) => runNpmCommandCaptured({ args: ["run", "db:schema:json:sync"], task: subTask })
          },
          {
            title: "Bootstrap database schema (retry)",
            task: async (_subCtx, subTask) => runNpmCommandCaptured({ args: ["run", "db:bootstrap"], task: subTask })
          }
        ], {
          concurrent: false
        }).run();
      }
    }
  });

  tasks.push({
    title: "Build web styles",
    task: async (_ctx, task) => runNpmCommandCaptured({ args: ["run", "styles:build"], task })
  });

  if (options.withForum) {
    tasks.push({
      title: "Build sampleforum frontend",
      task: async (_ctx, task) => runNpmCommandCaptured({ args: ["--prefix", "sampleforum", "run", "build"], task })
    });
  }

  const runner = new Listr(tasks, {
    concurrent: false,
    exitOnError: true,
    rendererOptions: {
      collapse: false,
      showErrorMessage: true,
      showTimer: true,
      showSubtasks: true
    }
  });

  await runner.run();
};

const runNpmCommandWithWaiting = async ({ title, args = [], cwd = projectRoot, waitingMessage = "" }) => {
  const invocation = resolveNpmInvocation({ args });
  const startedAt = Date.now();
  const env = process.env;
  const baseWaitingMessage = String(waitingMessage || "").trim() || "Đang chờ tiến trình khởi động...";

  logStepStart(title);
  const commandPreview = formatCommandPreview(invocation.command, invocation.args);
  if (commandPreview) {
    console.log(`  ${terminalUi.muted("$")} ${terminalUi.command(commandPreview)}`);
  }
  terminalUi.wait(baseWaitingMessage);

  const child = spawn(invocation.command, invocation.args, {
    cwd,
    env,
    shell: invocation.shell,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let hasOutput = false;
  const waitingStartedAt = Date.now();
  const waitingIntervalMs = 4000;

  const clearWaitingTimer = () => {
    if (waitingTimer) {
      clearInterval(waitingTimer);
    }
  };

  const markOutput = () => {
    if (hasOutput) return;
    hasOutput = true;
    clearWaitingTimer();
    terminalUi.info("Đã nhận log từ web server. Tiến trình đang tiếp tục...");
  };

  const waitingTimer = setInterval(() => {
    if (hasOutput) return;
    const waitedMs = Date.now() - waitingStartedAt;
    terminalUi.wait(`${baseWaitingMessage} (${formatDuration(waitedMs)})`);
  }, waitingIntervalMs);

  child.stdout.on("data", (chunk) => {
    markOutput();
    process.stdout.write(chunk);
  });

  child.stderr.on("data", (chunk) => {
    markOutput();
    process.stderr.write(chunk);
  });

  const forwardSigint = () => {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  };

  process.once("SIGINT", forwardSigint);

  try {
    await new Promise((resolve, reject) => {
      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code, signal) => {
        if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
          resolve();
          return;
        }
        reject(new Error(`Command failed: ${invocation.command} ${invocation.args.join(" ")}`));
      });
    });
    logStepDone(title, Date.now() - startedAt);
  } catch (error) {
    logStepFail(title, Date.now() - startedAt);
    throw error;
  } finally {
    clearWaitingTimer();
    process.removeListener("SIGINT", forwardSigint);
  }
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

  if (testResult.signal) {
    throw new Error(`Kết nối SQL thất bại: tiến trình psql bị dừng bởi signal ${testResult.signal}.`);
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

  if (versionResult.error || versionResult.signal || versionResult.status !== 0) {
    const message = versionResult.error
      ? String(versionResult.error.message || versionResult.error)
      : versionResult.signal
        ? `psql bị dừng bởi signal ${versionResult.signal}`
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

  if (result.error || result.signal || result.status !== 0) {
    const message = result.error
      ? String(result.error.message || result.error)
      : result.signal
        ? `psql bị dừng bởi signal ${result.signal}`
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
  const optionRows = [
    ["--db-host <host>", "PostgreSQL host (default: 127.0.0.1)"],
    ["--db-port <port>", "PostgreSQL port (default: 5432)"],
    ["--db-name <name>", "App database name (default: moetruyen)"],
    ["--db-user <user>", "App database user (default: postgres)"],
    ["--db-pass <pass>", "App database password (default: 12345)"],
    ["--admin-user <user>", "Web admin username (default: admin)"],
    ["--admin-pass <pass>", "Web admin password (default: 12345)"],
    ["--app-port <port>", "Web port (default: 3000)"],
    ["--api-port <port>", "API server port (default: 3001)"],
    ["--with-api <true|false>", "Install api_server deps (default: true)"],
    ["--with-forum <true|false>", "Install/build sampleforum (default: true)"],
    ["--with-desktop <true|false>", "Install app_desktop deps (default: false)"],
    ["--existing-db-action <mode>", "Existing DB behavior: overwrite|stop|ask (default: ask)"],
    ["--setup-s3 <true|false>", "Setup S3 vars now"],
    ["--s3-endpoint <url>", "S3 endpoint (optional)"],
    ["--s3-bucket <name>", "S3 bucket"],
    ["--s3-region <name>", "S3 region (default: us-east-1)"],
    ["--s3-access-key-id <id>", "S3 access key id"],
    ["--s3-secret-access-key <secret>", "S3 secret access key"],
    ["--s3-force-path-style <bool>", "S3 force path style"],
    ["--chapter-cdn-base-url <url>", "CDN base URL for chapter images"],
    ["--s3-chapter-prefix <prefix>", "S3 chapter prefix (default: chapters)"],
    ["--setup-google <true|false>", "Setup Google OAuth vars now"],
    ["--google-client-id <id>", "Google OAuth client id"],
    ["--google-client-secret <secret>", "Google OAuth client secret"],
    ["--setup-discord <true|false>", "Setup Discord OAuth vars now"],
    ["--discord-client-id <id>", "Discord OAuth client id"],
    ["--discord-client-secret <secret>", "Discord OAuth client secret"],
    ["--new-window <true|false>", "Open installer in a new terminal window (default: false)"],
    ["--non-interactive", "Do not prompt; use args/env/defaults"],
    ["--start", "Start web server (`npm run dev`) after setup"],
    ["--help", "Show this help"]
  ];

  const optionWidth = optionRows.reduce((max, row) => Math.max(max, String(row[0]).length), 0);
  const formatOption = (flag, description) => {
    const padded = String(flag).padEnd(optionWidth, " ");
    return `  ${terminalUi.command(padded)}  ${description}`;
  };

  const examples = [
    "npm run setup:all",
    "npm run setup:all -- --db-user=postgres --db-pass=12345",
    "npm run setup:all -- --existing-db-action=overwrite",
    "npm run setup:all -- --new-window=true",
    "npm run setup:all -- --non-interactive --setup-s3=true --setup-google=false --setup-discord=false",
    "npm run setup:all -- --with-desktop=true"
  ];

  const lines = [
    terminalUi.accent("Usage"),
    `  ${terminalUi.command("node scripts/setup-all.js [options]")}`,
    "",
    "Cross-platform project bootstrap for Windows and Ubuntu.",
    `Requirements: Node.js LTS ${MIN_NODE_MAJOR}+ and PostgreSQL ${MIN_POSTGRES_MAJOR}+.`,
    "By default, the installer stays in the current terminal window.",
    "By default, setup runs in interactive wizard mode and asks each parameter.",
    "This script installs dependencies, creates env files, prepares DB,",
    "runs schema bootstrap, and builds required assets.",
    "",
    terminalUi.accent("Options"),
    ...optionRows.map((row) => formatOption(row[0], row[1])),
    "",
    terminalUi.accent("Examples"),
    ...examples.map((entry) => `  ${terminalUi.command(entry)}`),
    ""
  ];

  console.log(lines.join("\n"));
};

const main = async () => {
  if (process.platform !== "win32" && process.platform !== "linux") {
    throw new Error("This setup script supports Windows and Linux/Ubuntu only.");
  }

  const nodeMajor = Number.parseInt(String(process.versions && process.versions.node || "0").split(".")[0], 10);
  if (!Number.isFinite(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
    throw new Error(`Node.js LTS ${MIN_NODE_MAJOR}+ is required. Please upgrade Node.js and run again.`);
  }

  const rawArgv = process.argv.slice(2);
  const args = parseArgs(rawArgv);
  if (args.help) {
    printHelp();
    return;
  }

  let installerUiMode = parseBoolean(args[INSTALLER_UI_FLAG], false);
  const openInNewWindow = parseBoolean(
    args[INSTALLER_NEW_WINDOW_FLAG] || process.env.SETUP_NEW_WINDOW,
    false
  );
  if (!installerUiMode) {
    const launched = await bootstrapInstallerUiWindow({ rawArgv, openInNewWindow });
    if (launched) {
      return;
    }

    if (openInNewWindow) {
      terminalUi.warn("Không thể mở cửa sổ terminal mới. Tiếp tục cài đặt ngay trong cửa sổ hiện tại.");
    }

    installerUiMode = true;
  }

  const installerUiLibraries = installerUiMode ? await loadInstallerUiLibraries() : null;
  const installerInquirerPrompt = installerUiLibraries
    && installerUiLibraries.inquirer
    && typeof installerUiLibraries.inquirer.prompt === "function"
    ? installerUiLibraries.inquirer.prompt.bind(installerUiLibraries.inquirer)
    : null;

  printSetupBanner();

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

  const canRunInteractiveWizard = Boolean(process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY);
  const options = seedOptions.nonInteractive
    ? seedOptions
    : canRunInteractiveWizard
      ? await collectInteractiveOptions(seedOptions)
      : {
        ...seedOptions,
        nonInteractive: true
      };

  terminalUi.info("Kiểm tra kết nối SQL với thông số bạn vừa nhập...");
  const sqlCheck = testSqlConnectionWithPsql({
    host: options.dbHost,
    port: options.dbPort,
    database: options.dbName,
    user: options.dbUser,
    password: options.dbPassword,
    minMajor: MIN_POSTGRES_MAJOR
  });
  terminalUi.ok(`Kết nối SQL thành công (PostgreSQL ${sqlCheck.major}).`);

  const existingTableCount = getSchemaTableCountWithPsql({
    host: options.dbHost,
    port: options.dbPort,
    database: options.dbName,
    user: options.dbUser,
    password: options.dbPassword
  });

  let existingDbAction = normalizeExistingDbAction(
    options.existingDbAction,
    options.nonInteractive ? "stop" : "ask"
  );

  if (existingTableCount > 0) {
    if (existingDbAction === "ask") {
      existingDbAction = options.nonInteractive
        ? "stop"
        : await promptExistingDbAction({
          tableCount: existingTableCount,
          inquirerPrompt: installerInquirerPrompt
        });
    }

    if (existingDbAction === "stop") {
      if (options.nonInteractive) {
        terminalUi.warn("Database đã có dữ liệu. Để tiếp tục trong non-interactive, dùng --existing-db-action=overwrite.");
      } else {
        terminalUi.warn("Setup đã dừng theo lựa chọn của bạn vì database đã có dữ liệu.");
      }
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

  terminalUi.printKeyValueBlock("Setup configuration", [
    ["Platform", process.platform],
    ["Web database", maskDatabaseUrl(databaseUrl)],
    ["Web port", String(options.appPort)],
    ["API enabled", terminalUi.yesNo(options.withApi)],
    ["Forum enabled", terminalUi.yesNo(options.withForum)],
    ["Desktop deps install", terminalUi.yesNo(options.withDesktop)],
    ["Setup S3 now", terminalUi.yesNo(options.setupS3Now)],
    ["Setup Google OAuth now", terminalUi.yesNo(options.setupGoogleNow)],
    ["Setup Discord OAuth now", terminalUi.yesNo(options.setupDiscordNow)],
    ["Interactive mode", options.nonInteractive ? terminalUi.muted("off") : terminalUi.strong("on")],
    ["Existing DB tables", String(existingTableCount)],
    ["Existing DB action", existingDbAction]
  ]);

  terminalUi.section("Thực thi setup");

  const canUseListrUi = Boolean(
    installerUiMode
      && installerUiLibraries
      && installerUiLibraries.Listr
      && typeof installerUiLibraries.Listr === "function"
  );

  if (canUseListrUi) {
    const preparationSpinner = installerUiLibraries.ora
      ? installerUiLibraries.ora("Đang chuẩn bị danh sách tác vụ cài đặt...").start()
      : null;

    try {
      if (preparationSpinner) {
        preparationSpinner.succeed("Bắt đầu chạy tác vụ cài đặt.");
      }
      await runSetupExecutionWithListr({
        options,
        existingTableCount,
        existingDbAction,
        Listr: installerUiLibraries.Listr
      });
    } catch (error) {
      if (preparationSpinner) {
        preparationSpinner.fail("Tác vụ cài đặt thất bại.");
      }
      throw error;
    }
  } else {
    terminalUi.warn("Thiếu TUI dependencies hoặc chưa cài xong; chạy giao diện cơ bản cho phiên này.");

    await runNpmCommand({
      title: "Install root dependencies",
      args: ["install"]
    });

    if (options.withApi) {
      await runNpmCommand({
        title: "Install api_server dependencies",
        args: ["--prefix", "api_server", "install"]
      });
    }

    if (options.withForum) {
      await runNpmCommand({
        title: "Install sampleforum dependencies",
        args: ["--prefix", "sampleforum", "install"]
      });
    }

    if (options.withDesktop) {
      await runNpmCommand({
        title: "Install app_desktop dependencies",
        args: ["--prefix", "app_desktop", "install"]
      });
    }

    try {
      await runNpmCommand({
        title: "Bootstrap database schema",
        args: ["run", "db:bootstrap"]
      });
    } catch (error) {
      if (existingTableCount === 0 || existingDbAction === "overwrite") {
        terminalUi.warn("Schema chưa khớp db.json. Đang thử tự đồng bộ snapshot rồi bootstrap lại...");
        await runNpmCommand({
          title: "Sync db.json from current database",
          args: ["run", "db:schema:json:sync"]
        });
        await runNpmCommand({
          title: "Bootstrap database schema (retry)",
          args: ["run", "db:bootstrap"]
        });
      } else {
        throw error;
      }
    }

    await runNpmCommand({
      title: "Build web styles",
      args: ["run", "styles:build"]
    });

    if (options.withForum) {
      await runNpmCommand({
        title: "Build sampleforum frontend",
        args: ["--prefix", "sampleforum", "run", "build"]
      });
    }
  }

  terminalUi.section("Setup hoàn tất");
  terminalUi.ok(`Root env: ${path.relative(projectRoot, rootEnvPath)}`);
  if (options.withApi) {
    terminalUi.ok(`API env: ${path.relative(projectRoot, apiEnvPath)}`);
  }
  if (!options.setupS3Now) {
    terminalUi.warn("S3 setup skipped: hãy cấu hình S3_* và CHAPTER_CDN_BASE_URL trong .env khi cần.");
  }
  if (!options.setupGoogleNow) {
    terminalUi.warn("Google OAuth skipped: hãy cập nhật GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET trong .env khi cần.");
  }
  if (!options.setupDiscordNow) {
    terminalUi.warn("Discord OAuth skipped: hãy cập nhật DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET trong .env khi cần.");
  }

  terminalUi.section("Run services");
  console.log(`  ${terminalUi.strong("1)")} Web: ${terminalUi.command(`${npmCommand} run dev`)}`);
  if (options.withApi) {
    console.log(`  ${terminalUi.strong("2)")} API: ${terminalUi.command(`${npmCommand} --prefix api_server run start`)}`);
  }

  if (options.startWeb) {
    await runNpmCommandWithWaiting({
      title: "Start web server",
      args: ["run", "dev"],
      waitingMessage: "Đang khởi động server (có thể mất 30-90s nếu đang minify JS lần đầu)"
    });
  }
};

main().catch((error) => {
  terminalUi.fail("Setup failed.");
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
