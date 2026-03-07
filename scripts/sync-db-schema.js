#!/usr/bin/env node

"use strict";

require("dotenv").config();

const { Pool } = require("pg");
const createInitDbDomain = require("../src/domains/init-db-domain");

const DATABASE_URL = (process.env.DATABASE_URL || "").toString().trim();
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required in .env");
  process.exit(1);
}

const includeDestructive = process.argv.includes("--include-destructive");
const verbose = process.argv.includes("--verbose");

const EXPECTED_TABLES = [
  "auth_identities",
  "badges",
  "chapter_drafts",
  "chapters",
  "chat_messages",
  "chat_thread_members",
  "chat_threads",
  "comment_likes",
  "comment_reports",
  "comments",
  "forbidden_words",
  "forum_post_bookmarks",
  "forum_posts",
  "genres",
  "homepage",
  "init_migrations",
  "manga",
  "manga_bookmarks",
  "manga_genres",
  "notifications",
  "reading_history",
  "translation_team_members",
  "translation_teams",
  "user_api_keys",
  "user_badges",
  "users",
  "web_sessions"
];

const pool = new Pool({ connectionString: DATABASE_URL });

const toPgQuery = (sql, params = []) => {
  const text = (sql || "").toString();
  if (!Array.isArray(params) || params.length === 0) {
    return { text, values: [] };
  }

  let index = 0;
  const converted = text.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });

  return {
    text: converted,
    values: params
  };
};

const dbQuery = async (sql, params = []) => {
  const payload = toPgQuery(sql, params);
  return pool.query(payload.text, payload.values);
};

const dbAllRaw = async (sql, params = []) => {
  const result = await dbQuery(sql, params);
  return result.rows || [];
};

const dbGetRaw = async (sql, params = []) => {
  const rows = await dbAllRaw(sql, params);
  return rows && rows.length ? rows[0] : null;
};

const dbRunRaw = async (sql, params = []) => {
  const result = await dbQuery(sql, params);
  return {
    changes: typeof result.rowCount === "number" ? result.rowCount : 0,
    lastID: undefined,
    rows: result.rows || []
  };
};

const normalizeSql = (value) => (value || "")
  .toString()
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const compactSql = (value) => {
  const text = (value || "").toString().replace(/\s+/g, " ").trim();
  if (text.length <= 140) return text;
  return `${text.slice(0, 137)}...`;
};

const isSchemaStatement = (sql) => {
  const normalized = normalizeSql(sql);
  if (!normalized) return false;

  if (/^create table if not exists\b/.test(normalized)) return true;
  if (/^alter table\b.+\badd column if not exists\b/.test(normalized)) return true;
  if (/^create unique index if not exists\b/.test(normalized)) return true;
  if (/^create index if not exists\b/.test(normalized)) return true;

  if (!includeDestructive) return false;

  if (/^drop index if exists\b/.test(normalized)) return true;
  if (/^alter table\b.+\bdrop column if exists\b/.test(normalized)) return true;
  if (/^alter table\b.+\balter column\b/.test(normalized)) return true;
  if (/^alter table\b.+\brename to\b/.test(normalized)) return true;
  if (/^drop table if exists\b/.test(normalized)) return true;

  return false;
};

const main = async () => {
  const stats = {
    executed: 0,
    skipped: 0,
    failed: 0
  };

  const skippedSamples = [];

  const dbRun = async (sql, params = []) => {
    if (!isSchemaStatement(sql)) {
      stats.skipped += 1;
      if (skippedSamples.length < 12) {
        skippedSamples.push(compactSql(sql));
      }
      return {
        changes: 0,
        lastID: undefined,
        rows: []
      };
    }

    try {
      const result = await dbRunRaw(sql, params);
      stats.executed += 1;
      if (verbose) {
        console.log(`OK ${compactSql(sql)}`);
      }
      return result;
    } catch (error) {
      stats.failed += 1;
      console.error(`FAIL ${compactSql(sql)}`);
      throw error;
    }
  };

  const dbGet = async (sql, params = []) => {
    const normalized = normalizeSql(sql);
    if (/\bfrom\s+init_migrations\b/.test(normalized)) {
      return { key: "schema_only" };
    }
    return dbGetRaw(sql, params);
  };

  const dbAll = async (sql, params = []) => dbAllRaw(sql, params);

  const initDbDomain = createInitDbDomain({
    ONESHOT_GENRE_NAME: "Oneshot",
    dbAll,
    dbGet,
    dbRun,
    ensureHomepageDefaults: async () => {},
    migrateLegacyGenres: async () => {},
    migrateMangaSlugs: async () => {},
    migrateMangaStatuses: async () => {},
    resetMemberBadgeCache: () => {},
    team: {
      name: "BFANG Team"
    }
  });

  console.log("Syncing database schema (structure only)...");
  if (includeDestructive) {
    console.log("Destructive schema updates are enabled.");
  }

  await initDbDomain.initDb();

  const tableRows = await dbAllRaw(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `
  );

  const existing = new Set(
    tableRows
      .map((row) => (row && row.table_name ? String(row.table_name).trim() : ""))
      .filter(Boolean)
  );

  const expected = new Set(EXPECTED_TABLES);
  const missing = EXPECTED_TABLES.filter((tableName) => !existing.has(tableName));
  const extra = Array.from(existing).filter((tableName) => !expected.has(tableName)).sort();

  console.log("\nSchema sync completed.");
  console.log(`Executed schema statements: ${stats.executed}`);
  console.log(`Skipped non-schema statements: ${stats.skipped}`);

  if (stats.failed > 0) {
    console.log(`Failed schema statements: ${stats.failed}`);
  }

  if (missing.length) {
    console.log("\nMissing expected tables after sync:");
    missing.forEach((tableName) => console.log(`- ${tableName}`));
  } else {
    console.log("\nAll expected tables are present.");
  }

  if (extra.length) {
    console.log("\nExtra tables found (kept unchanged):");
    extra.forEach((tableName) => console.log(`- ${tableName}`));
  }

  if (skippedSamples.length && verbose) {
    console.log("\nSample skipped statements:");
    skippedSamples.forEach((statement) => console.log(`- ${statement}`));
  }
};

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error("Schema sync failed.");
    console.error(error && error.message ? error.message : error);
    await pool.end();
    process.exit(1);
  });
