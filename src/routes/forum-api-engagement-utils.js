const createForumApiEngagementUtils = ({ dbAll, getUserBadgeContext, normalizeAuthorBadges, toText }) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const normalizeIdSet = (ids) =>
    Array.from(
      new Set(
        (Array.isArray(ids) ? ids : [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))
      )
    );

  const buildViewerRelationIdSet = async ({ viewer, ids, tableName }) => {
    const set = new Set();
    if (!viewer || !viewer.authenticated || !viewer.userId) return set;

    const safeIds = normalizeIdSet(ids);
    if (!safeIds.length) return set;

    const placeholders = safeIds.map(() => "?").join(",");
    const rows = await dbAll(
      `SELECT comment_id FROM ${tableName} WHERE user_id = ? AND comment_id IN (${placeholders})`,
      [viewer.userId, ...safeIds]
    );
    rows.forEach((row) => {
      const id = row && row.comment_id != null ? Number(row.comment_id) : 0;
      if (Number.isFinite(id) && id > 0) set.add(Math.floor(id));
    });
    return set;
  };

  const buildLikedIdSetForViewer = ({ viewer, ids }) =>
    buildViewerRelationIdSet({
      viewer,
      ids,
      tableName: "comment_likes",
    });

  const buildSavedPostIdSetForViewer = ({ viewer, ids }) =>
    buildViewerRelationIdSet({
      viewer,
      ids,
      tableName: "forum_post_bookmarks",
    });

  const buildAuthorDecorationMap = async (rows) => {
    const result = new Map();
    const userIds = Array.from(
      new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => readText(row && row.author_user_id))
          .filter(Boolean)
      )
    );
    if (!userIds.length || typeof getUserBadgeContext !== "function") return result;

    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const context = await getUserBadgeContext(userId);
          const badges = normalizeAuthorBadges(
            Array.isArray(context && context.badges)
              ? context.badges.map((badge) => ({
                  code: readText(badge && badge.code),
                  label: readText(badge && badge.label),
                  color: readText(badge && badge.color),
                  priority: Number(badge && badge.priority) || 0,
                }))
              : []
          );
          result.set(userId, {
            badges,
            userColor: readText(context && context.userColor),
          });
        } catch (_err) {
          result.set(userId, { badges: [], userColor: "" });
        }
      })
    );

    return result;
  };

  return {
    buildAuthorDecorationMap,
    buildLikedIdSetForViewer,
    buildSavedPostIdSetForViewer,
  };
};

module.exports = createForumApiEngagementUtils;
