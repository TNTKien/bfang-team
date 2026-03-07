#!/usr/bin/env node

"use strict";

require("dotenv").config();

const { Pool } = require("pg");

const DATABASE_URL = (process.env.DATABASE_URL || "").toString().trim();
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required in .env");
  process.exit(1);
}

const applyChanges = process.argv.includes("--apply");

const FORUM_META_LIKE = "%<!--forum-meta:%";
const FORUM_REQUEST_PREFIX = "forum-";
const FORUM_REQUEST_LIKE = `${FORUM_REQUEST_PREFIX}%`;

const SUMMARY_SQL = `
  WITH RECURSIVE all_threads AS (
    SELECT
      c.id,
      c.parent_id,
      c.id AS root_id,
      c.client_request_id,
      c.content
    FROM comments c
    WHERE c.parent_id IS NULL

    UNION ALL

    SELECT
      child.id,
      child.parent_id,
      at.root_id,
      child.client_request_id,
      child.content
    FROM comments child
    JOIN all_threads at ON child.parent_id = at.id
  ),
  forum_roots AS (
    SELECT DISTINCT at.root_id
    FROM all_threads at
    WHERE (
      at.id = at.root_id
      AND at.content ILIKE $1
    )
    OR COALESCE(at.client_request_id, '') ILIKE $2
    OR EXISTS (
      SELECT 1
      FROM forum_post_bookmarks b
      WHERE b.comment_id = at.root_id
    )
  ),
  forum_rows AS (
    SELECT
      at.id,
      at.client_request_id
    FROM all_threads at
    JOIN forum_roots fr ON fr.root_id = at.root_id
  )
  SELECT
    (SELECT COUNT(*)::int FROM comments) AS comments_total,
    (SELECT COUNT(*)::int FROM forum_posts) AS forum_posts_total,
    (SELECT COUNT(*)::int FROM comments c WHERE COALESCE(c.client_request_id, '') ILIKE $2) AS prefixed_in_comments,
    (SELECT COUNT(*)::int FROM forum_rows fr WHERE COALESCE(fr.client_request_id, '') NOT ILIKE $2) AS inferred_missing_prefix
`;

const APPLY_PREFIX_SQL = `
  WITH RECURSIVE all_threads AS (
    SELECT
      c.id,
      c.parent_id,
      c.id AS root_id,
      c.client_request_id,
      c.content
    FROM comments c
    WHERE c.parent_id IS NULL

    UNION ALL

    SELECT
      child.id,
      child.parent_id,
      at.root_id,
      child.client_request_id,
      child.content
    FROM comments child
    JOIN all_threads at ON child.parent_id = at.id
  ),
  forum_roots AS (
    SELECT DISTINCT at.root_id
    FROM all_threads at
    WHERE (
      at.id = at.root_id
      AND at.content ILIKE $1
    )
    OR COALESCE(at.client_request_id, '') ILIKE $2
    OR EXISTS (
      SELECT 1
      FROM forum_post_bookmarks b
      WHERE b.comment_id = at.root_id
    )
  ),
  forum_rows AS (
    SELECT at.id, at.client_request_id
    FROM all_threads at
    JOIN forum_roots fr ON fr.root_id = at.root_id
  )
  UPDATE comments c
  SET client_request_id = CONCAT('${FORUM_REQUEST_PREFIX}legacy-', c.id::text)
  FROM forum_rows fr
  WHERE c.id = fr.id
    AND COALESCE(fr.client_request_id, '') NOT ILIKE $2
`;

const COPY_FORUM_ROWS_SQL = `
  INSERT INTO forum_posts (
    id,
    parent_id,
    author,
    author_user_id,
    author_email,
    author_avatar_url,
    client_request_id,
    content,
    status,
    like_count,
    report_count,
    forum_post_locked,
    forum_post_pinned,
    created_at
  )
  SELECT
    c.id,
    c.parent_id,
    COALESCE(NULLIF(TRIM(c.author), ''), 'Ẩn danh'),
    c.author_user_id,
    c.author_email,
    c.author_avatar_url,
    CASE
      WHEN COALESCE(TRIM(c.client_request_id), '') = '' THEN CONCAT('${FORUM_REQUEST_PREFIX}legacy-', c.id::text)
      ELSE c.client_request_id
    END,
    COALESCE(c.content, ''),
    COALESCE(NULLIF(TRIM(c.status), ''), 'visible'),
    COALESCE(c.like_count, 0),
    COALESCE(c.report_count, 0),
    COALESCE(c.forum_post_locked, false),
    COALESCE(c.forum_post_pinned, false),
    COALESCE(
      NULLIF(TRIM(c.created_at), ''),
      to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  FROM comments c
  WHERE COALESCE(c.client_request_id, '') ILIKE $1
  ON CONFLICT (id) DO NOTHING
`;

const DELETE_MOVED_ROWS_SQL = `
  DELETE FROM comments c
  WHERE COALESCE(c.client_request_id, '') ILIKE $1
    AND EXISTS (
      SELECT 1
      FROM forum_posts fp
      WHERE fp.id = c.id
    )
`;

const MARK_MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS init_migrations (
    key TEXT PRIMARY KEY,
    applied_at BIGINT NOT NULL
  )
`;

const INSERT_MIGRATION_MARK_SQL = `
  INSERT INTO init_migrations (key, applied_at)
  VALUES ('migrate_forum_rows_to_forum_posts_v1', $1)
  ON CONFLICT (key) DO NOTHING
`;

const printSummary = (title, row) => {
  const data = row && typeof row === "object" ? row : {};
  console.log(title);
  console.log(`- comments_total: ${Number(data.comments_total) || 0}`);
  console.log(`- forum_posts_total: ${Number(data.forum_posts_total) || 0}`);
  console.log(`- prefixed_in_comments: ${Number(data.prefixed_in_comments) || 0}`);
  console.log(`- inferred_missing_prefix: ${Number(data.inferred_missing_prefix) || 0}`);
};

const main = async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    const before = await client.query(SUMMARY_SQL, [FORUM_META_LIKE, FORUM_REQUEST_LIKE]);
    const beforeRow = before.rows && before.rows[0] ? before.rows[0] : null;
    printSummary("Forum storage summary (before):", beforeRow);

    if (!applyChanges) {
      console.log("\nDry run only. No changes applied.");
      console.log("Run with --apply to repair forum rows in comments.");
      return;
    }

    await client.query("BEGIN");

    const prefixResult = await client.query(APPLY_PREFIX_SQL, [FORUM_META_LIKE, FORUM_REQUEST_LIKE]);
    const copiedResult = await client.query(COPY_FORUM_ROWS_SQL, [FORUM_REQUEST_LIKE]);
    const deletedResult = await client.query(DELETE_MOVED_ROWS_SQL, [FORUM_REQUEST_LIKE]);
    await client.query(MARK_MIGRATION_SQL);
    await client.query(INSERT_MIGRATION_MARK_SQL, [Date.now()]);

    await client.query("COMMIT");

    const after = await client.query(SUMMARY_SQL, [FORUM_META_LIKE, FORUM_REQUEST_LIKE]);
    const afterRow = after.rows && after.rows[0] ? after.rows[0] : null;

    console.log("\nRepair applied:");
    console.log(`- rows normalized with forum prefix: ${prefixResult.rowCount || 0}`);
    console.log(`- rows copied into forum_posts: ${copiedResult.rowCount || 0}`);
    console.log(`- rows deleted from comments: ${deletedResult.rowCount || 0}`);
    console.log("");
    printSummary("Forum storage summary (after):", afterRow);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {
      // ignore rollback error
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Forum storage repair failed.");
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
