#!/usr/bin/env node

"use strict";

require("dotenv").config();

const { Pool } = require("pg");
const createInitDbDomain = require("../src/domains/init-db-domain");
const createMangaDomain = require("../src/domains/manga-domain");
const { buildMangaSlug } = require("../src/utils/manga-slug");

const DATABASE_URL = (process.env.DATABASE_URL || "").toString().trim();
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required in .env");
  process.exit(1);
}

const applyChanges = process.argv.includes("--apply");
const ONESHOT_GENRE_NAME = "Oneshot";
const MAINTENANCE_KEYS = [
  "migrate_legacy_user_badges_v1",
  "backfill_default_member_badges_v1",
  "sync_oneshot_manga_genres_v1",
  "migrate_legacy_genres_v1",
  "migrate_manga_statuses_v1",
  "sync_translation_team_role_badges_v1"
];

const toPgQuery = (sql, params = []) => {
  const text = (sql || "").toString();
  if (!Array.isArray(params) || params.length === 0) {
    return { text, values: [] };
  }

  let index = 0;
  return {
    text: text.replace(/\?/g, () => {
      index += 1;
      return `$${index}`;
    }),
    values: params
  };
};

const maybeAddReturningId = (sql) => {
  const text = (sql || "").toString();
  const trimmed = text.trim();
  const compact = trimmed.replace(/\s+/g, " ");
  if (!/^insert\s+into\s+(manga|chapters|genres|comments|forum_posts|translation_teams|chat_threads|chat_messages)\b/i.test(compact)) {
    return { sql: text, wantsId: false };
  }
  if (/\breturning\b/i.test(compact)) {
    return { sql: text, wantsId: true };
  }
  const withoutSemi = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
  return { sql: `${withoutSemi} RETURNING id`, wantsId: true };
};

const main = async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  const dbQuery = async (sql, params = []) => {
    const payload = toPgQuery(sql, params);
    return pool.query(payload.text, payload.values);
  };

  const dbAll = async (sql, params = []) => {
    const result = await dbQuery(sql, params);
    return result.rows || [];
  };

  const dbGet = async (sql, params = []) => {
    const rows = await dbAll(sql, params);
    return rows && rows.length ? rows[0] : null;
  };

  const dbRun = async (sql, params = []) => {
    const { sql: finalSql, wantsId } = maybeAddReturningId(sql);
    const result = await dbQuery(finalSql, params);
    return {
      changes: typeof result.rowCount === "number" ? result.rowCount : 0,
      lastID: wantsId && result && Array.isArray(result.rows) && result.rows[0] && result.rows[0].id != null
        ? Number(result.rows[0].id)
        : undefined,
      rows: result.rows || []
    };
  };

  const withTransaction = async (handler) => {
    const client = await pool.connect();
    const scopedQuery = async (sql, params = []) => {
      const payload = toPgQuery(sql, params);
      return client.query(payload.text, payload.values);
    };
    const scopedDbAll = async (sql, params = []) => {
      const result = await scopedQuery(sql, params);
      return result.rows || [];
    };
    const scopedDbGet = async (sql, params = []) => {
      const rows = await scopedDbAll(sql, params);
      return rows && rows.length ? rows[0] : null;
    };
    const scopedDbRun = async (sql, params = []) => {
      const { sql: finalSql, wantsId } = maybeAddReturningId(sql);
      const result = await scopedQuery(finalSql, params);
      return {
        changes: typeof result.rowCount === "number" ? result.rowCount : 0,
        lastID: wantsId && result && Array.isArray(result.rows) && result.rows[0] && result.rows[0].id != null
          ? Number(result.rows[0].id)
          : undefined,
        rows: result.rows || []
      };
    };

    try {
      await client.query("BEGIN");
      const value = await handler({
        dbAll: scopedDbAll,
        dbGet: scopedDbGet,
        dbRun: scopedDbRun
      });
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_rollbackError) {
        // ignore rollback error
      }
      throw error;
    } finally {
      client.release();
    }
  };

  const mangaDomain = createMangaDomain({
    FORBIDDEN_WORD_MAX_LENGTH: 160,
    ONESHOT_GENRE_NAME,
    buildChapterTimestampIso: (value) => {
      const date = value ? new Date(value) : new Date();
      return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    },
    buildMangaSlug,
    dbAll,
    dbGet,
    dbRun
  });

  const initDbDomain = createInitDbDomain({
    ONESHOT_GENRE_NAME,
    dbAll,
    dbGet,
    dbRun,
    withTransaction,
    ensureHomepageDefaults: async () => {},
    migrateLegacyGenres: mangaDomain.migrateLegacyGenres,
    migrateMangaSlugs: async () => {},
    migrateMangaStatuses: mangaDomain.migrateMangaStatuses,
    resetMemberBadgeCache: () => {},
    team: {
      name: "BFANG Team"
    }
  });

  try {
    await dbRun(
      `
      CREATE TABLE IF NOT EXISTS init_migrations (
        key TEXT PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )
    `
    );

    if (!applyChanges) {
      const rows = await dbAll(
        "SELECT key FROM init_migrations WHERE key = ANY(?::text[]) ORDER BY key ASC",
        [MAINTENANCE_KEYS]
      );
      const applied = new Set(rows.map((row) => String(row.key || "").trim()).filter(Boolean));
      console.log("Deferred init maintenance status:");
      MAINTENANCE_KEYS.forEach((key) => {
        console.log(`- ${key}: ${applied.has(key) ? "done" : "pending"}`);
      });
      console.log("\nDry run only. Use --apply to execute pending maintenance tasks.");
      return;
    }

    const results = await initDbDomain.runDeferredInitMaintenance();
    console.log("Deferred init maintenance results:");
    results.forEach((entry) => {
      console.log(`- ${entry.key}: ${entry.applied ? "applied" : "skipped"}`);
    });
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Deferred init maintenance failed.");
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
