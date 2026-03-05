const createForumApiAdminListUtils = ({ dbAll, dbGet }) => {
  const buildForumAdminPostsWhere = ({ forumRequestIdLike, q, section, status }) => {
    const whereParts = [
      "c.parent_id IS NULL",
      "COALESCE(c.client_request_id, '') ILIKE ?",
    ];
    const whereParams = [forumRequestIdLike];

    if (q) {
      const likeValue = `%${q}%`;
      whereParts.push(
        `(
          c.content ILIKE ?
          OR c.author ILIKE ?
          OR COALESCE(u.username, '') ILIKE ?
          OR COALESCE(u.display_name, '') ILIKE ?
          OR CAST(c.id AS TEXT) = ?
        )`
      );
      whereParams.push(likeValue, likeValue, likeValue, likeValue, q);
    }

    if (status === "visible") {
      whereParts.push("c.status = 'visible'");
    } else if (status === "hidden") {
      whereParts.push("c.status = 'reported'");
    } else if (status === "reported") {
      whereParts.push("c.status = 'visible' AND COALESCE(c.report_count, 0) > 0");
    }

    if (section !== "all") {
      whereParts.push("COALESCE(c.content, '') ILIKE ?");
      whereParams.push(`%forum-meta:section=${section}%`);
    }

    return {
      whereParams,
      whereSql: whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
    };
  };

  const resolveForumAdminPostsOrderBy = (sort) => {
    if (sort === "oldest") return "c.created_at ASC, c.id ASC";
    if (sort === "likes") return "COALESCE(c.like_count, 0) DESC, c.created_at DESC, c.id DESC";
    if (sort === "reports") return "COALESCE(c.report_count, 0) DESC, c.created_at DESC, c.id DESC";
    if (sort === "comments") return "COALESCE(reply_stats.reply_count, 0) DESC, c.created_at DESC, c.id DESC";
    return "c.created_at DESC, c.id DESC";
  };

  const loadForumAdminPostsCount = ({ whereParams, whereSql }) =>
    dbGet(
      `
        SELECT COUNT(*) AS count
        FROM comments c
        LEFT JOIN users u ON u.id = c.author_user_id
        ${whereSql}
      `,
      whereParams
    );

  const loadForumAdminPostsRows = ({
    forumRequestIdLike,
    offset,
    orderBySql,
    perPage,
    whereParams,
    whereSql,
  }) =>
    dbAll(
      `
        SELECT
          c.id,
          c.content,
          c.status,
          c.like_count,
          c.report_count,
          c.forum_post_locked,
          c.forum_post_pinned,
          c.created_at,
          c.author,
          c.author_user_id,
          c.author_avatar_url,
          COALESCE(u.username, '') AS author_username,
          COALESCE(u.display_name, '') AS author_display_name,
          u.avatar_url AS user_avatar_url,
          COALESCE(reply_stats.reply_count, 0) AS reply_count
        FROM comments c
        LEFT JOIN users u ON u.id = c.author_user_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS reply_count
          FROM comments r
          WHERE r.parent_id = c.id
            AND COALESCE(r.client_request_id, '') ILIKE ?
        ) reply_stats ON TRUE
        ${whereSql}
        ORDER BY ${orderBySql}
        LIMIT ? OFFSET ?
      `,
      [forumRequestIdLike, ...whereParams, perPage, offset]
    );

  const buildForumAdminCommentsWhere = ({ forumRequestIdLike, q, status }) => {
    const whereParts = [
      "COALESCE(c.parent_id, 0) > 0",
      "parent.id IS NOT NULL",
      "COALESCE(c.client_request_id, '') ILIKE ?",
      "COALESCE(parent.client_request_id, '') ILIKE ?",
    ];
    const whereParams = [forumRequestIdLike, forumRequestIdLike];

    if (q) {
      const likeValue = `%${q}%`;
      whereParts.push(
        `(
          c.content ILIKE ?
          OR c.author ILIKE ?
          OR COALESCE(u.username, '') ILIKE ?
          OR COALESCE(u.display_name, '') ILIKE ?
          OR COALESCE(parent.content, '') ILIKE ?
          OR CAST(c.id AS TEXT) = ?
        )`
      );
      whereParams.push(likeValue, likeValue, likeValue, likeValue, likeValue, q);
    }

    if (status === "visible") {
      whereParts.push("c.status = 'visible'");
    } else if (status === "hidden") {
      whereParts.push("c.status = 'reported'");
    } else if (status === "reported") {
      whereParts.push("c.status = 'visible' AND COALESCE(c.report_count, 0) > 0");
    }

    return {
      whereParams,
      whereSql: whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
    };
  };

  const loadForumAdminCommentsCount = ({ whereParams, whereSql }) =>
    dbGet(
      `
        SELECT COUNT(*) AS count
        FROM comments c
        LEFT JOIN users u ON u.id = c.author_user_id
        LEFT JOIN comments parent ON parent.id = c.parent_id
        ${whereSql}
      `,
      whereParams
    );

  const loadForumAdminCommentsRows = ({ offset, perPage, whereParams, whereSql }) =>
    dbAll(
      `
        SELECT
          c.id,
          c.parent_id,
          c.content,
          c.status,
          c.like_count,
          c.report_count,
          c.created_at,
          c.author,
          c.author_user_id,
          c.author_avatar_url,
          COALESCE(u.username, '') AS author_username,
          COALESCE(u.display_name, '') AS author_display_name,
          u.avatar_url AS user_avatar_url,
          COALESCE(parent.parent_id, 0) AS parent_parent_id,
          COALESCE(parent.author, '') AS parent_author,
          COALESCE(root_topic.id, 0) AS topic_id,
          COALESCE(root_topic.content, '') AS topic_content
        FROM comments c
        LEFT JOIN users u ON u.id = c.author_user_id
        LEFT JOIN comments parent ON parent.id = c.parent_id
        LEFT JOIN LATERAL (
          WITH RECURSIVE lineage AS (
            SELECT cc.id, cc.parent_id, cc.content
            FROM comments cc
            WHERE cc.id = c.id
            UNION ALL
            SELECT pp.id, pp.parent_id, pp.content
            FROM comments pp
            JOIN lineage l ON pp.id = l.parent_id
          )
          SELECT l.id, l.content
          FROM lineage l
          WHERE l.parent_id IS NULL
          LIMIT 1
        ) root_topic ON TRUE
        ${whereSql}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ? OFFSET ?
      `,
      [...whereParams, perPage, offset]
    );

  return {
    buildForumAdminCommentsWhere,
    buildForumAdminPostsWhere,
    loadForumAdminCommentsCount,
    loadForumAdminCommentsRows,
    loadForumAdminPostsCount,
    loadForumAdminPostsRows,
    resolveForumAdminPostsOrderBy,
  };
};

module.exports = createForumApiAdminListUtils;
