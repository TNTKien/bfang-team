#!/usr/bin/env node

"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const args = new Set(process.argv.slice(2));
const strictSchema = args.has("--strict");
const verbose = args.has("--verbose");

const runNodeScript = ({ title, scriptName, scriptArgs = [] }) => {
  const scriptPath = path.join(__dirname, scriptName);
  console.log(`\n==> ${title}`);

  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${scriptName} exited with status ${result.status}`);
  }
};

const main = () => {
  console.log("Starting database bootstrap...");
  console.log(`- schema mode: ${strictSchema ? "strict" : "safe"}`);

  const schemaArgs = [];
  if (strictSchema) {
    schemaArgs.push("--include-destructive");
  }
  if (verbose) {
    schemaArgs.push("--verbose");
  }

  runNodeScript({
    title: "Sync database schema",
    scriptName: "sync-db-schema.js",
    scriptArgs: schemaArgs
  });

  runNodeScript({
    title: "Run deferred init maintenance",
    scriptName: "run-init-maintenance.js",
    scriptArgs: ["--apply"]
  });

  runNodeScript({
    title: "Repair forum rows in comments",
    scriptName: "repair-forum-storage.js",
    scriptArgs: ["--apply"]
  });

  runNodeScript({
    title: "Verify forum storage state",
    scriptName: "repair-forum-storage.js",
    scriptArgs: []
  });

  runNodeScript({
    title: "Sync db.json schema snapshot",
    scriptName: "sync-db-json.js",
    scriptArgs: []
  });

  console.log("\nDatabase bootstrap completed.");
};

try {
  main();
} catch (error) {
  console.error("Database bootstrap failed.");
  console.error(error && error.message ? error.message : error);
  process.exit(1);
}
