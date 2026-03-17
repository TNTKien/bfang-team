const { createApp, startServer } = require("./app");

const isTruthyEnvValue = (value) => {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return false;
  return ["1", "true", "yes", "on"].includes(text);
};

const canInlineUpdate = Boolean(
  process.stdout
    && process.stdout.isTTY
    && typeof process.stdout.clearLine === "function"
    && typeof process.stdout.cursorTo === "function"
);

const forceStartupSpinner = isTruthyEnvValue(
  process.env.FORCE_STARTUP_SPINNER || process.env.FORCE_ORA
);
const npmLifecycleEvent = String(process.env.npm_lifecycle_event || "").trim().toLowerCase();
const forceSpinnerForLifecycle = npmLifecycleEvent === "dev" || npmLifecycleEvent === "start";

const canUseOraSpinner = forceStartupSpinner || forceSpinnerForLifecycle || Boolean(process.stdout && process.stdout.isTTY);

const formatMinifyProgressBar = (completed, total) => {
  const safeCompleted = Number.isFinite(completed) ? Math.max(0, Math.floor(completed)) : 0;
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  if (!safeTotal) {
    return "";
  }

  const width = 18;
  const filled = Math.round((Math.min(safeCompleted, safeTotal) / safeTotal) * width);
  const empty = Math.max(0, width - filled);
  return `[${"#".repeat(filled)}${"-".repeat(empty)}] ${Math.min(safeCompleted, safeTotal)}/${safeTotal}`;
};

const writeLoadingLine = (message, persist = false) => {
  const text = String(message == null ? "" : message);
  if (!canInlineUpdate) {
    if (persist) {
      process.stdout.write(`${text}\n`);
      return;
    }
    process.stdout.write(`${text}\r`);
    return;
  }

  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
  process.stdout.write(text);
  if (persist) {
    process.stdout.write("\n");
  }
};

const startupLoadingState = {
  active: false,
  spinner: null
};

const loadOraFactory = async () => {
  try {
    const oraModule = await import("ora");
    return oraModule && typeof oraModule.default === "function"
      ? oraModule.default
      : null;
  } catch (_error) {
    return null;
  }
};

const initStartupSpinner = (oraFactory) => {
  if (!canUseOraSpinner) {
    startupLoadingState.spinner = null;
    return;
  }
  if (!oraFactory || typeof oraFactory !== "function") {
    startupLoadingState.spinner = null;
    return;
  }
  startupLoadingState.spinner = oraFactory({
    text: "",
    color: "cyan",
    spinner: "dots",
    isEnabled: forceStartupSpinner || forceSpinnerForLifecycle ? true : undefined
  });
};

const setStartupLoading = (message) => {
  const spinner = startupLoadingState.spinner;
  if (spinner) {
    const text = String(message == null ? "" : message).trim();
    startupLoadingState.active = true;
    if (spinner.isSpinning) {
      spinner.text = text;
    } else {
      spinner.start(text);
    }
    return;
  }

  startupLoadingState.active = true;
  writeLoadingLine(`[LOADING] ${message}`, false);
};

const finishStartupLoading = (message, success = true) => {
  if (!startupLoadingState.active) {
    return;
  }
  startupLoadingState.active = false;
  const prefix = success ? "[DONE]" : "[FAIL]";
  const spinner = startupLoadingState.spinner;
  if (spinner) {
    const text = String(message == null ? "" : message).trim();
    if (spinner.isSpinning) {
      if (success) {
        spinner.succeed(text);
      } else {
        spinner.fail(text);
      }
    } else {
      console.log(`${prefix} ${text}`);
    }
    return;
  }
  writeLoadingLine(`${prefix} ${message}`, true);
};

const createServerStartupHooks = () => {
  return {
    onMinifyProgress: (payload) => {
      const phase = String(payload && payload.phase ? payload.phase : "").trim().toLowerCase();
      if (!phase) return;

      if (phase === "disabled") {
        setStartupLoading("Bỏ qua minify JS startup (JS_MINIFY_ENABLED=false). Đang hoàn tất khởi tạo server...");
        return;
      }

      if (phase === "start") {
        const total = Number(payload.total) || 0;
        setStartupLoading(`Đang minify JavaScript startup... ${formatMinifyProgressBar(0, total)}`.trim());
        return;
      }

      if (phase === "item:start") {
        if (!startupLoadingState.spinner && !canInlineUpdate) {
          return;
        }
        const scriptName = String(payload.scriptName || "").trim();
        const built = Number(payload.built) || 0;
        const failed = Number(payload.failed) || 0;
        const total = Number(payload.total) || 0;
        const completed = built + failed;
        const progress = formatMinifyProgressBar(completed, total);
        const fileText = scriptName ? ` ${scriptName}.js` : "";
        setStartupLoading(`Đang minify${fileText}... ${progress}`.trim());
        return;
      }

      if (phase === "item:done" || phase === "item:fail") {
        if (!startupLoadingState.spinner && !canInlineUpdate) {
          return;
        }
        const scriptName = String(payload.scriptName || "").trim();
        const built = Number(payload.built) || 0;
        const failed = Number(payload.failed) || 0;
        const total = Number(payload.total) || 0;
        const completed = built + failed;
        const progress = formatMinifyProgressBar(completed, total);
        const statusText = phase === "item:done" ? "xong" : "lỗi";
        const fileText = scriptName ? ` ${scriptName}.js` : "";
        setStartupLoading(`Minify${fileText}: ${statusText}. ${progress}`.trim());
        return;
      }

      if (phase === "done") {
        const built = Number(payload.built) || 0;
        const total = Number(payload.total) || 0;
        const failed = Number(payload.failed) || 0;
        setStartupLoading(`Minify JS startup hoàn tất (${built}/${total}, lỗi ${failed}). Đang mở cổng server...`);
      }
    }
  };
};

const bootServer = async () => {
  const oraFactory = await loadOraFactory();
  initStartupSpinner(oraFactory);

  const runtime = createApp({
    hooks: createServerStartupHooks()
  });

  setStartupLoading("MOETRUYEN server đang khởi tạo...");
  await startServer(runtime);
  finishStartupLoading("MOETRUYEN server đã sẵn sàng.", true);
};

bootServer().catch((error) => {
  finishStartupLoading("MOETRUYEN server khởi tạo thất bại.", false);
  console.error("Failed to start MOETRUYEN server", error);
  process.exit(1);
});
