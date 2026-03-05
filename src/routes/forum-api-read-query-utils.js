const createForumApiReadQueryUtils = ({ dbAll, dbGet }) => {
  const loadForumPostDetailRow = ({ postId, forumRequestIdLike }) =>
    dbGet(
      `
        SELECT
          c.id,
          c.content,
          c.created_at,
          c.like_count,
          c.report_count,
          c.forum_post_locked,
          c.forum_post_pinned,
          c.author,
          c.author_user_id,
          c.author_avatar_url,
          u.username AS user_username,
          u.display_name AS user_display_name,
          u.avatar_url AS user_avatar_url,
          COALESCE(reply_stats.reply_count, 0) AS reply_count
        FROM comments c
        LEFT JOIN users u ON u.id = c.author_user_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS reply_count
          FROM comments r
          WHERE r.status = 'visible'
            AND (
              r.parent_id = c.id
              OR r.parent_id IN (
                SELECT c1.id
                FROM comments c1
                WHERE c1.parent_id = c.id
                  AND c1.status = 'visible'
              )
            )
        ) reply_stats ON TRUE
        WHERE c.id = ?
          AND c.status = 'visible'
          AND c.parent_id IS NULL
          AND COALESCE(c.client_request_id, '') ILIKE ?
        LIMIT 1
      `,
      [postId, forumRequestIdLike]
    );

  const loadForumPostReplyRows = ({ postId, forumRequestIdLike }) =>
    dbAll(
      `
        SELECT
          r.id,
          r.content,
          r.created_at,
          r.like_count,
          r.report_count,
          r.parent_id,
          r.author,
          r.author_user_id,
          r.author_avatar_url,
          parent.author_user_id AS parent_author_user_id,
          u.username AS user_username,
          u.display_name AS user_display_name,
          u.avatar_url AS user_avatar_url
        FROM comments r
        LEFT JOIN comments parent ON parent.id = r.parent_id
        LEFT JOIN users u ON u.id = r.author_user_id
        WHERE r.status = 'visible'
          AND COALESCE(r.client_request_id, '') ILIKE ?
          AND (
            r.parent_id = ?
            OR r.parent_id IN (
              SELECT c1.id
              FROM comments c1
              WHERE c1.parent_id = ?
                AND c1.status = 'visible'
            )
          )
        ORDER BY r.created_at ASC, r.id ASC
      `,
      [forumRequestIdLike, postId, postId]
    );

  const countSavedForumPostsForUser = ({ forumRequestIdLike, userId }) =>
    dbGet(
      `
        SELECT COUNT(*) AS count
        FROM forum_post_bookmarks b
        JOIN comments c ON c.id = b.comment_id
        WHERE b.user_id = ?
          AND c.status = 'visible'
          AND c.parent_id IS NULL
          AND COALESCE(c.client_request_id, '') ILIKE ?
      `,
      [userId, forumRequestIdLike]
    );

  const loadSavedForumPostsForUser = ({ forumRequestIdLike, limit, offset, userId }) =>
    dbAll(
      `
        SELECT
          c.id,
          c.content,
          c.created_at,
          c.like_count,
          c.report_count,
          c.forum_post_locked,
          c.forum_post_pinned,
          c.author,
          c.author_user_id,
          c.author_avatar_url,
          u.username AS user_username,
          u.display_name AS user_display_name,
          u.avatar_url AS user_avatar_url,
          COALESCE(reply_stats.reply_count, 0) AS reply_count
        FROM forum_post_bookmarks b
        JOIN comments c ON c.id = b.comment_id
        LEFT JOIN users u ON u.id = c.author_user_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS reply_count
          FROM comments r
          WHERE r.status = 'visible'
            AND (
              r.parent_id = c.id
              OR r.parent_id IN (
                SELECT c1.id
                FROM comments c1
                WHERE c1.parent_id = c.id
                  AND c1.status = 'visible'
              )
            )
        ) reply_stats ON TRUE
        WHERE b.user_id = ?
          AND c.status = 'visible'
          AND c.parent_id IS NULL
          AND COALESCE(c.client_request_id, '') ILIKE ?
        ORDER BY COALESCE(c.forum_post_pinned, false) DESC, b.created_at DESC, b.comment_id DESC
        LIMIT ?
        OFFSET ?
      `,
      [userId, forumRequestIdLike, limit, offset]
    );

  const loadVisibleForumRootPostIdRow = ({ forumRequestIdLike, postId }) =>
    dbGet(
      `
        SELECT c.id
        FROM comments c
        WHERE c.id = ?
          AND c.parent_id IS NULL
          AND c.status = 'visible'
          AND COALESCE(c.client_request_id, '') ILIKE ?
        LIMIT 1
      `,
      [postId, forumRequestIdLike]
    );

  const loadVisibleForumRootPostModerationRow = ({ forumRequestIdLike, postId }) =>
    dbGet(
      `
        SELECT
          c.id,
          c.author_user_id,
          COALESCE(c.forum_post_locked, false) AS forum_post_locked,
          COALESCE(c.forum_post_pinned, false) AS forum_post_pinned
        FROM comments c
        WHERE c.id = ?
          AND c.parent_id IS NULL
          AND c.status = 'visible'
          AND COALESCE(c.client_request_id, '') ILIKE ?
        LIMIT 1
      `,
      [postId, forumRequestIdLike]
    );

  return {
    countSavedForumPostsForUser,
    loadForumPostDetailRow,
    loadForumPostReplyRows,
    loadSavedForumPostsForUser,
    loadVisibleForumRootPostModerationRow,
    loadVisibleForumRootPostIdRow,
  };
};

module.exports = createForumApiReadQueryUtils;
