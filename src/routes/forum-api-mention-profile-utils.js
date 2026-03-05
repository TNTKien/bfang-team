const createForumApiMentionProfileUtils = ({ dbAll, normalizePositiveInt, toText }) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const readPositiveInt =
    typeof normalizePositiveInt === "function"
      ? (value, fallback = 0) => normalizePositiveInt(value, fallback)
      : (value, fallback = 0) => {
          const numeric = Number(value);
          if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
          return Math.floor(numeric);
        };

  const buildForumThreadParticipantFilterSql = (tableAlias, rootCommentId) => {
    const alias = readText(tableAlias) || "c";
    const safeRootCommentId = readPositiveInt(rootCommentId, 0);
    if (!safeRootCommentId) {
      return {
        sql: "AND 1 = 0",
        params: [],
      };
    }

    return {
      sql: `
        AND (
          ${alias}.id = ?
          OR ${alias}.parent_id = ?
          OR ${alias}.parent_id IN (
            SELECT c1.id
            FROM comments c1
            WHERE c1.parent_id = ?
              AND c1.status = 'visible'
          )
        )
      `,
      params: [safeRootCommentId, safeRootCommentId, safeRootCommentId],
    };
  };

  const buildForumRootAuthorFilterSql = (rootCommentId) => {
    const safeRootCommentId = readPositiveInt(rootCommentId, 0);
    if (!safeRootCommentId) {
      return {
        sql: "SELECT NULL::text AS user_id WHERE false",
        params: [],
      };
    }

    return {
      sql: `
        SELECT c.author_user_id AS user_id
        FROM comments c
        WHERE c.id = ?
          AND c.parent_id IS NULL
          AND c.status = 'visible'
          AND c.author_user_id IS NOT NULL
          AND TRIM(c.author_user_id) <> ''
        LIMIT 1
      `,
      params: [safeRootCommentId],
    };
  };

  const getForumMentionProfileMap = async (usernames, options = {}) => {
    const safeRootCommentId = readPositiveInt(options && options.rootCommentId, 0);
    const safeUsernames = Array.from(
      new Set(
        (Array.isArray(usernames) ? usernames : [])
          .map((value) => readText(value).toLowerCase())
          .filter((value) => /^[a-z0-9_]{1,24}$/.test(value))
      )
    ).slice(0, 120);
    if (!safeUsernames.length) return new Map();

    const placeholders = safeUsernames.map(() => "?").join(",");
    const commenterFilter = buildForumThreadParticipantFilterSql("c", safeRootCommentId);
    const rootAuthorFilter = buildForumRootAuthorFilterSql(safeRootCommentId);
    const rows = await dbAll(
      `
        WITH commenter_users AS (
          SELECT DISTINCT c.author_user_id AS user_id
          FROM comments c
          WHERE c.status = 'visible'
            AND c.author_user_id IS NOT NULL
            AND TRIM(c.author_user_id) <> ''
            ${commenterFilter.sql}
        ),
        root_post_author AS (
          ${rootAuthorFilter.sql}
        ),
        badge_flags AS (
          SELECT
            ub.user_id,
            MAX(CASE WHEN lower(b.code) = 'admin' THEN 1 ELSE 0 END) AS is_admin,
            MAX(CASE WHEN lower(b.code) IN ('mod', 'moderator') THEN 1 ELSE 0 END) AS is_mod,
            (array_agg(b.color ORDER BY b.priority DESC, b.id ASC))[1] AS user_color
          FROM user_badges ub
          JOIN badges b ON b.id = ub.badge_id
          GROUP BY ub.user_id
        ),
        role_users AS (
          SELECT bf.user_id
          FROM badge_flags bf
          WHERE bf.is_admin = 1 OR bf.is_mod = 1
        ),
        allowed_users AS (
          SELECT user_id FROM commenter_users
          UNION
          SELECT user_id FROM root_post_author
          UNION
          SELECT user_id FROM role_users
        )
        SELECT
          u.id,
          lower(u.username) AS username,
          u.display_name,
          COALESCE(bf.user_color, '') AS user_color
        FROM allowed_users au
        JOIN users u ON u.id = au.user_id
        LEFT JOIN badge_flags bf ON bf.user_id = u.id
        WHERE lower(COALESCE(u.username, '')) IN (${placeholders})
      `,
      [...commenterFilter.params, ...rootAuthorFilter.params, ...safeUsernames]
    );

    const map = new Map();
    rows.forEach((row) => {
      const username = readText(row && row.username).toLowerCase();
      const id = readText(row && row.id);
      if (!username || !id) return;

      const displayName = readText(row && row.display_name).replace(/\s+/g, " ").trim();
      map.set(username, {
        id,
        username,
        name: displayName || `@${username}`,
        userColor: readText(row && row.user_color),
      });
    });

    return map;
  };

  const buildRootCommentIdByCommentId = (rows) => {
    const rowById = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const id = Number(row && row.id);
      if (!Number.isFinite(id) || id <= 0) return;
      rowById.set(Math.floor(id), row);
    });

    const cache = new Map();
    const resolveRootId = (commentId) => {
      const safeCommentId = Number(commentId);
      if (!Number.isFinite(safeCommentId) || safeCommentId <= 0) return 0;

      const normalizedId = Math.floor(safeCommentId);
      if (cache.has(normalizedId)) return cache.get(normalizedId);

      const chain = [];
      const seen = new Set();
      let cursor = normalizedId;
      let resolvedRootId = 0;

      while (Number.isFinite(cursor) && cursor > 0) {
        const currentId = Math.floor(cursor);
        if (cache.has(currentId)) {
          resolvedRootId = Number(cache.get(currentId)) || 0;
          break;
        }
        if (seen.has(currentId)) {
          resolvedRootId = normalizedId;
          break;
        }

        seen.add(currentId);
        chain.push(currentId);

        const currentRow = rowById.get(currentId);
        if (!currentRow) {
          resolvedRootId = currentId;
          break;
        }

        const parentId = Number(currentRow && currentRow.parent_id);
        if (!Number.isFinite(parentId) || parentId <= 0) {
          resolvedRootId = currentId;
          break;
        }

        cursor = Math.floor(parentId);
      }

      const fallbackRootId = resolvedRootId > 0 ? resolvedRootId : normalizedId;
      chain.forEach((id) => {
        cache.set(id, fallbackRootId);
      });
      return fallbackRootId;
    };

    rowById.forEach((_row, id) => {
      resolveRootId(id);
    });

    return cache;
  };

  return {
    buildForumRootAuthorFilterSql,
    buildForumThreadParticipantFilterSql,
    buildRootCommentIdByCommentId,
    getForumMentionProfileMap,
  };
};

module.exports = createForumApiMentionProfileUtils;
