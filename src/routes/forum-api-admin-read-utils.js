const createForumApiAdminReadUtils = ({ dbAll, dbGet }) => {
  const loadForumAdminOverviewRows = ({ forumRequestIdLike, startOfDayIso }) =>
    Promise.all([
      dbGet(
        `
          SELECT
            COUNT(*) FILTER (WHERE c.parent_id IS NULL) AS total_posts,
            COUNT(*) FILTER (WHERE c.parent_id IS NULL AND c.status = 'visible') AS visible_posts,
            COUNT(*) FILTER (WHERE c.parent_id IS NULL AND c.status = 'reported') AS hidden_posts,
            COUNT(*) FILTER (WHERE c.parent_id IS NOT NULL) AS total_replies,
            COALESCE(SUM(COALESCE(c.report_count, 0)) FILTER (WHERE c.parent_id IS NULL), 0) AS total_reports,
            COUNT(DISTINCT c.author_user_id) FILTER (
              WHERE c.parent_id IS NULL
                AND c.author_user_id IS NOT NULL
                AND TRIM(c.author_user_id) <> ''
            ) AS unique_authors
          FROM comments c
          WHERE COALESCE(c.client_request_id, '') ILIKE ?
        `,
        [forumRequestIdLike]
      ),
      dbGet(
        `
          SELECT
            COUNT(*) FILTER (WHERE c.parent_id IS NULL) AS new_posts_today,
            COUNT(*) FILTER (WHERE c.parent_id IS NOT NULL) AS new_replies_today
          FROM comments c
          WHERE COALESCE(c.client_request_id, '') ILIKE ?
            AND c.created_at >= ?
        `,
        [forumRequestIdLike, startOfDayIso]
      ),
      dbAll(
        `
          SELECT
            c.id,
            c.content,
            c.status,
            c.created_at,
            c.author,
            c.author_user_id,
            COALESCE(u.username, '') AS author_username,
            COALESCE(u.display_name, '') AS author_display_name
          FROM comments c
          LEFT JOIN users u ON u.id = c.author_user_id
          WHERE c.parent_id IS NULL
            AND COALESCE(c.client_request_id, '') ILIKE ?
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT 6
        `,
        [forumRequestIdLike]
      ),
    ]).then(([statsRow, todayRow, latestRows]) => ({
      latestRows,
      statsRow,
      todayRow,
    }));

  return {
    loadForumAdminOverviewRows,
  };
};

module.exports = createForumApiAdminReadUtils;
