require("dotenv").config();

const { Pool } = require("pg");

const run = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const legacyColumnCheck = await pool.query(`
      SELECT 1 AS ok
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'manga'
        AND column_name = 'translation_team_id'
      LIMIT 1
    `);
    const hasLegacyTranslationTeamId = Boolean(legacyColumnCheck.rows[0] && legacyColumnCheck.rows[0].ok);

    const insertedFromMirror = hasLegacyTranslationTeamId
      ? await pool.query(`
          INSERT INTO manga_translation_teams (manga_id, team_id)
          SELECT m.id, m.translation_team_id
          FROM manga m
          JOIN translation_teams t ON t.id = m.translation_team_id
          WHERE m.translation_team_id IS NOT NULL
          ON CONFLICT DO NOTHING
          RETURNING manga_id, team_id
        `)
      : { rowCount: 0, rows: [] };

    const insertedFromGroupName = await pool.query(`
      INSERT INTO manga_translation_teams (manga_id, team_id)
      SELECT DISTINCT tokenized.manga_id, t.id
      FROM (
        SELECT
          m.id AS manga_id,
          BTRIM(
            REGEXP_SPLIT_TO_TABLE(
              REGEXP_REPLACE(COALESCE(m.group_name, ''), '\\s*(/|&|\\+|;|\\||,)\\s*|\\s+x\\s+', ',', 'gi'),
              ','
            )
          ) AS team_name_token
        FROM manga m
        WHERE m.group_name IS NOT NULL
          AND TRIM(m.group_name) <> ''
      ) tokenized
      JOIN translation_teams t
        ON t.status = 'approved'
       AND t.name = tokenized.team_name_token
      WHERE tokenized.team_name_token <> ''
      ON CONFLICT DO NOTHING
      RETURNING manga_id, team_id
    `);

    const synced = await pool.query(`
      WITH linked AS (
        SELECT
          m.id AS manga_id,
          string_agg(
            t.name,
            ' / '
            ORDER BY
              mtt.team_id ASC,
              lower(t.name) ASC,
              t.id ASC
          ) AS group_name
        FROM manga m
        JOIN manga_translation_teams mtt ON mtt.manga_id = m.id
        JOIN translation_teams t ON t.id = mtt.team_id
        GROUP BY m.id
      )
      UPDATE manga m
      SET
        group_name = linked.group_name
      FROM linked
      WHERE linked.manga_id = m.id
      RETURNING m.id, m.group_name
    `);

    if (hasLegacyTranslationTeamId) {
      await pool.query("DROP INDEX IF EXISTS idx_manga_translation_team_id");
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_manga_translation_team_id'
              AND conrelid = 'manga'::regclass
          ) THEN
            ALTER TABLE manga DROP CONSTRAINT fk_manga_translation_team_id;
          END IF;
        END
        $$;
      `);
      await pool.query("ALTER TABLE manga DROP COLUMN IF EXISTS translation_team_id");
    }

    console.log(
      JSON.stringify(
        {
          insertedFromMirror: insertedFromMirror.rowCount,
          insertedFromGroupName: insertedFromGroupName.rowCount,
          syncedManga: synced.rowCount,
          syncedIds: synced.rows
            .map((row) => Number(row.id))
            .filter((id) => Number.isFinite(id) && id > 0)
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
};

run().catch((error) => {
  console.error("Failed to backfill manga translation team links", error);
  process.exit(1);
});
