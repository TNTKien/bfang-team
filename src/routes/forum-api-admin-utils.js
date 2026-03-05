const createForumApiAdminUtils = ({
  dbAll,
  dbGet,
  dbRun,
  deleteForumImageKeys,
  forumRequestIdLike,
  getB2Config,
  isForumManagedImageKey,
  listImageKeysFromContent,
  normalizeAdminIdList,
  normalizePositiveInt,
  toText,
  withTransaction,
}) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const buildSqlPlaceholders = (count) =>
    Array.from({ length: Math.max(0, Number(count) || 0) })
      .map(() => "?")
      .join(",");

  const toChangedCount = (result) =>
    result && result.changes ? Number(result.changes) || 0 : 0;

  const hideCommentSubtrees = async ({ dbRun, rootIds }) => {
    const ids = Array.from(
      new Set(
        (Array.isArray(rootIds) ? rootIds : [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))
      )
    );
    if (!ids.length) return 0;

    const placeholders = buildSqlPlaceholders(ids.length);
    const result = await dbRun(
      `
        WITH RECURSIVE subtree AS (
          SELECT id
          FROM comments
          WHERE id IN (${placeholders})
          UNION ALL
          SELECT c.id
          FROM comments c
          JOIN subtree s ON c.parent_id = s.id
        )
        UPDATE comments
        SET
          status = 'reported',
          report_count = GREATEST(COALESCE(report_count, 0), 1)
        WHERE id IN (SELECT id FROM subtree)
          AND (status <> 'reported' OR COALESCE(report_count, 0) < 1)
      `,
      ids
    );
    return toChangedCount(result);
  };

  const restoreCommentSubtree = async ({ dbRun, rootId }) => {
    const safeRootId = Number(rootId);
    if (!Number.isFinite(safeRootId) || safeRootId <= 0) return 0;

    const normalizedRootId = Math.floor(safeRootId);
    const updateResult = await dbRun(
      `
        WITH RECURSIVE subtree AS (
          SELECT id
          FROM comments
          WHERE id = ?
          UNION ALL
          SELECT c.id
          FROM comments c
          JOIN subtree s ON c.parent_id = s.id
        )
        UPDATE comments
        SET status = 'visible', report_count = 0
        WHERE id IN (SELECT id FROM subtree)
          AND (status <> 'visible' OR COALESCE(report_count, 0) <> 0)
      `,
      [normalizedRootId]
    );

    const changed = toChangedCount(updateResult);
    if (changed > 0) {
      await dbRun(
        `
          WITH RECURSIVE subtree AS (
            SELECT id
            FROM comments
            WHERE id = ?
            UNION ALL
            SELECT c.id
            FROM comments c
            JOIN subtree s ON c.parent_id = s.id
          )
          DELETE FROM comment_reports
          WHERE comment_id IN (SELECT id FROM subtree)
        `,
        [normalizedRootId]
      );
    }
    return changed;
  };

  const getForumAdminRootPostById = async (postId) => {
    const safeId = typeof normalizePositiveInt === "function" ? normalizePositiveInt(postId, 0) : Number(postId) || 0;
    if (!safeId || typeof dbGet !== "function") return null;

    const row = await dbGet(
      `
        SELECT
          c.id,
          c.content,
          c.status,
          c.forum_post_locked,
          c.forum_post_pinned
        FROM comments c
        WHERE c.id = ?
          AND c.parent_id IS NULL
          AND COALESCE(c.client_request_id, '') ILIKE ?
        LIMIT 1
      `,
      [safeId, forumRequestIdLike]
    );

    return row || null;
  };

  const getForumAdminCommentById = async (commentId) => {
    const safeId = typeof normalizePositiveInt === "function" ? normalizePositiveInt(commentId, 0) : Number(commentId) || 0;
    if (!safeId || typeof dbGet !== "function") return null;

    const row = await dbGet(
      `
        SELECT
          c.id,
          c.parent_id,
          c.status
        FROM comments c
        JOIN comments parent ON parent.id = c.parent_id
        WHERE c.id = ?
          AND COALESCE(c.parent_id, 0) > 0
          AND COALESCE(c.client_request_id, '') ILIKE ?
          AND COALESCE(parent.client_request_id, '') ILIKE ?
        LIMIT 1
      `,
      [safeId, forumRequestIdLike, forumRequestIdLike]
    );

    return row || null;
  };

  const runForumAdminTransaction = async (handler) => {
    if (typeof withTransaction === "function") {
      return withTransaction(handler);
    }
    return handler({ dbRun, dbGet, dbAll });
  };

  const normalizeBulkTargetIds = (ids, limit = 200) =>
    typeof normalizeAdminIdList === "function"
      ? normalizeAdminIdList(ids, limit)
      : Array.from(
          new Set(
            (Array.isArray(ids) ? ids : [])
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0)
              .map((value) => Math.floor(value))
          )
        ).slice(0, Math.max(1, Number(limit) || 1));

  const loadValidForumCommentIdsForBulk = async ({ ids, limit = 200 }) => {
    const normalizedIds = normalizeBulkTargetIds(ids, limit);
    if (!normalizedIds.length || typeof dbAll !== "function") return [];

    const placeholders = buildSqlPlaceholders(normalizedIds.length);
    const validRows = await dbAll(
      `
        SELECT c.id
        FROM comments c
        JOIN comments parent ON parent.id = c.parent_id
        WHERE c.id IN (${placeholders})
          AND COALESCE(c.parent_id, 0) > 0
          AND COALESCE(c.client_request_id, '') ILIKE ?
          AND COALESCE(parent.client_request_id, '') ILIKE ?
      `,
      [...normalizedIds, forumRequestIdLike, forumRequestIdLike]
    );

    return normalizeBulkTargetIds(
      (Array.isArray(validRows) ? validRows : []).map((row) => Number(row && row.id)),
      limit
    );
  };

  const loadValidForumPostIdsForBulk = async ({ ids, limit = 200 }) => {
    const normalizedIds = normalizeBulkTargetIds(ids, limit);
    if (!normalizedIds.length || typeof dbAll !== "function") return [];

    const placeholders = buildSqlPlaceholders(normalizedIds.length);
    const validRows = await dbAll(
      `
        SELECT c.id
        FROM comments c
        WHERE c.id IN (${placeholders})
          AND c.parent_id IS NULL
          AND COALESCE(c.client_request_id, '') ILIKE ?
      `,
      [...normalizedIds, forumRequestIdLike]
    );

    return normalizeBulkTargetIds(
      (Array.isArray(validRows) ? validRows : []).map((row) => Number(row && row.id)),
      limit
    );
  };

  const updateForumRootPostBooleanField = async ({
    currentValue,
    explicitValue,
    fieldName,
    postId,
  }) => {
    const safePostId = typeof normalizePositiveInt === "function" ? normalizePositiveInt(postId, 0) : Number(postId) || 0;
    if (!safePostId) return false;

    const allowedFields = new Set(["forum_post_pinned", "forum_post_locked"]);
    if (!allowedFields.has(fieldName)) {
      throw new Error("Invalid forum root field update");
    }

    const nextValue = explicitValue == null ? !Boolean(currentValue) : Boolean(explicitValue);
    await dbRun(`UPDATE comments SET ${fieldName} = ? WHERE id = ?`, [nextValue, safePostId]);
    return nextValue;
  };

  const hideForumTreeByRootId = (rootId) =>
    runForumAdminTransaction(async ({ dbRun: txRun }) =>
      hideCommentSubtrees({
        dbRun: txRun,
        rootIds: [rootId],
      })
    );

  const restoreForumTreeByRootId = (rootId) =>
    runForumAdminTransaction(async ({ dbRun: txRun }) =>
      restoreCommentSubtree({
        dbRun: txRun,
        rootId,
      })
    );

  const deleteForumTreeByRootId = (rootId) => deleteForumCommentTree({ rootId });

  const runForumBulkModerationAction = async ({
    action,
    ids,
    limit = 200,
    loadValidIds,
  }) => {
    const validIds =
      typeof loadValidIds === "function"
        ? await loadValidIds({ ids, limit })
        : normalizeBulkTargetIds(ids, limit);
    if (!validIds.length) {
      return {
        changedCount: 0,
        deletedCount: 0,
        validIds: [],
      };
    }

    let changedCount = 0;
    let deletedCount = 0;

    if (action === "hide") {
      changedCount = await hideCommentSubtrees({
        dbRun,
        rootIds: validIds,
      });
    } else {
      for (const id of validIds) {
        deletedCount += await deleteForumCommentTree({ rootId: id });
      }
    }

    return {
      changedCount,
      deletedCount,
      validIds,
    };
  };

  const deleteForumCommentTree = async ({ rootId, txRun, txAll }) => {
    const safeRootId = typeof normalizePositiveInt === "function" ? normalizePositiveInt(rootId, 0) : Number(rootId) || 0;
    if (!safeRootId) return 0;

    const run = typeof txRun === "function" ? txRun : dbRun;
    const all = typeof txAll === "function" ? txAll : dbAll;
    if (typeof run !== "function" || typeof all !== "function") return 0;

    const subtreeRows = await all(
      `
        WITH RECURSIVE subtree AS (
          SELECT id
          FROM forum_posts
          WHERE id = ?
          UNION ALL
          SELECT c.id
          FROM forum_posts c
          JOIN subtree s ON c.parent_id = s.id
        )
        SELECT p.id, p.content
        FROM subtree
        JOIN forum_posts p ON p.id = subtree.id
      `,
      [safeRootId]
    );

    const ids = typeof normalizeAdminIdList === "function"
      ? normalizeAdminIdList(
          (Array.isArray(subtreeRows) ? subtreeRows : []).map((row) => Number(row && row.id)),
          10000
        )
      : Array.from(
          new Set(
            (Array.isArray(subtreeRows) ? subtreeRows : [])
              .map((row) => Number(row && row.id))
              .filter((value) => Number.isFinite(value) && value > 0)
              .map((value) => Math.floor(value))
          )
        );
    if (!ids.length) return 0;

    const config = typeof getB2Config === "function" ? getB2Config() : null;
    const removedImageKeys = Array.from(
      new Set(
        (Array.isArray(subtreeRows) ? subtreeRows : []).flatMap((row) => {
          const imageKeys =
            typeof listImageKeysFromContent === "function" ? listImageKeysFromContent(row && row.content) : [];
          return imageKeys.filter((key) =>
            typeof isForumManagedImageKey === "function" ? isForumManagedImageKey(key, config) : Boolean(key)
          );
        })
      )
    );

    const placeholders = buildSqlPlaceholders(ids.length);
    await run(`DELETE FROM comment_likes WHERE comment_id IN (${placeholders})`, ids);
    await run(`DELETE FROM comment_reports WHERE comment_id IN (${placeholders})`, ids);
    await run(`DELETE FROM forum_post_bookmarks WHERE comment_id IN (${placeholders})`, ids);
    await run(`DELETE FROM notifications WHERE comment_id IN (${placeholders})`, ids);

    const result = await run(
      `
        DELETE FROM forum_posts
        WHERE id IN (${placeholders})
      `,
      ids
    );

    const deletedCount = toChangedCount(result);

    if (deletedCount > 0 && removedImageKeys.length > 0 && typeof deleteForumImageKeys === "function") {
      try {
        await deleteForumImageKeys(removedImageKeys);
      } catch (err) {
        console.warn("forum comment tree image cleanup failed", err);
      }
    }

    return deletedCount;
  };

  return {
    buildSqlPlaceholders,
    deleteForumCommentTree,
    getForumAdminCommentById,
    getForumAdminRootPostById,
    hideCommentSubtrees,
    hideForumTreeByRootId,
    loadValidForumCommentIdsForBulk,
    loadValidForumPostIdsForBulk,
    runForumBulkModerationAction,
    runForumAdminTransaction,
    restoreCommentSubtree,
    restoreForumTreeByRootId,
    toChangedCount,
    toText: readText,
    updateForumRootPostBooleanField,
    deleteForumTreeByRootId,
  };
};

module.exports = createForumApiAdminUtils;
