#!/usr/bin/env node

"use strict";

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");

const resolveNpmInvocation = (args = []) => {
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

const isTruthyEnvValue = (value) => {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return false;
  return ["1", "true", "yes", "on"].includes(text);
};

const npmLifecycleEvent = String(process.env.npm_lifecycle_event || "").trim().toLowerCase();
const forcePredevSpinner = isTruthyEnvValue(
  process.env.FORCE_PREDEV_SPINNER || process.env.FORCE_ORA
);

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

const trimOutput = (text) => {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  return raw;
};

const runStylesBuild = ({ showLogs }) => {
  return new Promise((resolve, reject) => {
    const invocation = resolveNpmInvocation(["run", "styles:build"]);
    const stdoutParts = [];
    const stderrParts = [];

    const child = spawn(invocation.command, invocation.args, {
      cwd: projectRoot,
      env: process.env,
      shell: invocation.shell,
      stdio: showLogs ? "inherit" : ["ignore", "pipe", "pipe"]
    });

    child.on("error", (error) => {
      reject(error);
    });

    if (!showLogs && child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdoutParts.push(String(chunk || ""));
      });
    }

    if (!showLogs && child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderrParts.push(String(chunk || ""));
      });
    }

    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`styles:build terminated by signal ${signal}`));
        return;
      }

      if (typeof code === "number" && code !== 0) {
        const stdoutText = trimOutput(stdoutParts.join(""));
        const stderrText = trimOutput(stderrParts.join(""));
        const detail = stderrText || stdoutText;
        reject(new Error(detail || `styles:build exited with status ${code}`));
        return;
      }

      resolve();
    });
  });
};

const main = async () => {
  const showLogs = isTruthyEnvValue(process.env.SHOW_STYLE_BUILD_LOGS);
  const oraFactory = await loadOraFactory();
  const shouldUseSpinner = Boolean(
    !showLogs
      && oraFactory
      && (
        forcePredevSpinner
        || npmLifecycleEvent === "predev"
        || (process.stdout && process.stdout.isTTY)
      )
  );

  const spinner = shouldUseSpinner
    ? oraFactory({
      text: "Building CSS assets...",
      color: "cyan",
      spinner: "dots",
      isEnabled: forcePredevSpinner || npmLifecycleEvent === "predev" ? true : undefined
    }).start()
    : null;

  try {
    await runStylesBuild({ showLogs });
    if (spinner) {
      spinner.succeed("CSS assets built.");
    }
  } catch (error) {
    if (spinner) {
      spinner.fail("styles:build failed.");
    }
    if (error && error.message) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
};

main();
