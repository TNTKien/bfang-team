const createForumApiImageUtils = require("./forum-api-image-utils");
const createForumApiParamUtils = require("./forum-api-param-utils");
const createForumApiSectionUtils = require("./forum-api-section-utils");
const createForumApiContentUtils = require("./forum-api-content-utils");
const createForumApiViewerUtils = require("./forum-api-viewer-utils");
const createForumApiPresenterUtils = require("./forum-api-presenter-utils");
const createForumApiAdminUtils = require("./forum-api-admin-utils");
const createForumApiEngagementUtils = require("./forum-api-engagement-utils");
const createForumApiDraftUtils = require("./forum-api-draft-utils");
const createForumApiPostWriteUtils = require("./forum-api-post-write-utils");
const createForumApiMentionUtils = require("./forum-api-mention-utils");
const createForumApiMentionProfileUtils = require("./forum-api-mention-profile-utils");
const createForumApiLinkLabelUtils = require("./forum-api-link-label-utils");
const createForumApiImageProcessUtils = require("./forum-api-image-process-utils");
const createForumApiReadQueryUtils = require("./forum-api-read-query-utils");
const createForumApiSectionViewUtils = require("./forum-api-section-view-utils");
const createForumApiAdminReadUtils = require("./forum-api-admin-read-utils");
const createForumApiAdminListUtils = require("./forum-api-admin-list-utils");
const createForumApiAdminCategoryUtils = require("./forum-api-admin-category-utils");
const createForumApiAdminPostEditUtils = require("./forum-api-admin-post-edit-utils");
const createForumApiPaginationUtils = require("./forum-api-pagination-utils");
const createForumApiHomeUtils = require("./forum-api-home-utils");

const registerForumApiRoutes = (app, deps) => {
  const {
    asyncHandler,
    b2CopyFile,
    b2DeleteAllByPrefix,
    b2DeleteFileVersions,
    b2UploadBuffer,
    buildCommentNotificationPreview,
    buildCommentMentionsForContent,
    createMentionNotificationsForComment,
    crypto,
    dbAll: baseDbAll,
    dbGet: baseDbGet,
    dbRun: baseDbRun,
    deleteGoogleDriveImageByFileId,
    extractGoogleDriveFileIdFromImageUrl,
    extractMentionUsernamesFromContent,
    formatTimeAgo,
    getB2Config,
    getUserBadgeContext,
    isB2Ready,
    loadSessionUserById,
    normalizeAvatarUrl,
    normalizeUploadedImageUrl,
    publishNotificationStreamUpdate,
    requireAdmin,
    sharp,
    uploadCommentImage,
    uploadImageBufferToGoogleDrive,
    commentImageUploadsEnabled,
    withTransaction: baseWithTransaction,
  } = deps;

  const DEFAULT_PER_PAGE = 20;
  const MAX_PER_PAGE = 20;
  const FORUM_REQUEST_ID_PREFIX = "forum-";
  const FORUM_REQUEST_ID_LIKE = `${FORUM_REQUEST_ID_PREFIX}%`;
  const HOT_RECENT_WINDOW_MS = 30 * 60 * 1000;
  const HOT_RECENT_LIMIT = 5;
  const HOT_COMMENT_ACTIVITY_LIMIT = 10;
  const FORUM_MENTION_MAX_RESULTS = 5;
  const NOTIFICATION_TYPE_FORUM_POST_COMMENT = "forum_post_comment";
  const NOTIFICATION_TYPE_COMMENT_REPLY = "comment_reply";
  const ADMIN_DEFAULT_PER_PAGE = 20;
  const ADMIN_MAX_PER_PAGE = 50;

  const rewriteForumCommentSql = (sql) => {
    const text = typeof sql === "string" ? sql : "";
    if (!text) return sql;
    return text
      .replace(/\bINSERT\s+INTO\s+comments\b/gi, "INSERT INTO forum_posts")
      .replace(/\bDELETE\s+FROM\s+comments\b/gi, "DELETE FROM forum_posts")
      .replace(/\bUPDATE\s+comments\b/gi, "UPDATE forum_posts")
      .replace(/\bFROM\s+comments\b/gi, "FROM forum_posts")
      .replace(/\bJOIN\s+comments\b/gi, "JOIN forum_posts");
  };

  const dbAll = (sql, params) => baseDbAll(rewriteForumCommentSql(sql), params);
  const dbGet = (sql, params) => baseDbGet(rewriteForumCommentSql(sql), params);
  const dbRun = (sql, params) => baseDbRun(rewriteForumCommentSql(sql), params);
  const withTransaction =
    typeof baseWithTransaction === "function"
      ? (handler) =>
          baseWithTransaction(async (tx) =>
            handler({
              ...tx,
              dbAll: (sql, params) => tx.dbAll(rewriteForumCommentSql(sql), params),
              dbGet: (sql, params) => tx.dbGet(rewriteForumCommentSql(sql), params),
              dbRun: (sql, params) => tx.dbRun(rewriteForumCommentSql(sql), params),
            })
          )
      : null;

  const toText = (value) => (value == null ? "" : String(value)).trim();
  const readSafeUploadedImageUrl = (value) => {
    const normalized =
      typeof normalizeUploadedImageUrl === "function"
        ? normalizeUploadedImageUrl(value)
        : toText(value);
    return toText(normalized).slice(0, 500);
  };

  const createCommentInteractionNotifications = async ({
    postId,
    parentId,
    parentAuthorUserId,
    authorUserId,
    commentId,
    content,
  }) => {
    const safePostId = Number(postId);
    const safeParentId = Number(parentId);
    const safeCommentId = Number(commentId);
    const targetUserId = toText(parentAuthorUserId);
    const actorUserId = toText(authorUserId);

    if (!Number.isFinite(safePostId) || safePostId <= 0) {
      return { createdCount: 0, notifiedUserIds: [] };
    }
    if (!Number.isFinite(safeParentId) || safeParentId <= 0) {
      return { createdCount: 0, notifiedUserIds: [] };
    }
    if (!Number.isFinite(safeCommentId) || safeCommentId <= 0) {
      return { createdCount: 0, notifiedUserIds: [] };
    }
    if (!targetUserId || !actorUserId || targetUserId === actorUserId) {
      return { createdCount: 0, notifiedUserIds: [] };
    }

    const notificationType = Math.floor(safeParentId) === Math.floor(safePostId)
      ? NOTIFICATION_TYPE_FORUM_POST_COMMENT
      : NOTIFICATION_TYPE_COMMENT_REPLY;
    const createdAt = Date.now();
    const preview =
      typeof buildCommentNotificationPreview === "function" ? buildCommentNotificationPreview(content) : "";

    const inserted = await dbRun(
      `
        INSERT INTO notifications (
          user_id,
          type,
          actor_user_id,
          manga_id,
          chapter_number,
          comment_id,
          content_preview,
          is_read,
          created_at,
          read_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, false, ?, NULL)
        ON CONFLICT DO NOTHING
      `,
      [
        targetUserId,
        notificationType,
        actorUserId,
        null,
        null,
        Math.floor(safeCommentId),
        preview,
        createdAt,
      ]
    );

    if (inserted && inserted.changes) {
      publishNotificationStreamUpdate({ userId: targetUserId, reason: "created" }).catch(() => null);
      return {
        createdCount: inserted.changes,
        notifiedUserIds: [targetUserId]
      };
    }

    return { createdCount: 0, notifiedUserIds: [] };
  };

  const toIso = (value) => {
    const raw = toText(value);
    if (!raw) return "";
    const parsed = new Date(raw).getTime();
    if (!Number.isFinite(parsed)) return raw;
    return new Date(parsed).toISOString();
  };

  const {
    normalizeAdminIdList,
    normalizeForumAdminSort,
    normalizeForumAdminStatus,
    normalizeForumSort,
    normalizeMentionSearchQuery,
    normalizePositiveInt,
    parseBooleanValue
  } = createForumApiParamUtils({
    toText
  });

  const {
    contentHasImageKey,
    expandForumImageKeyCandidates,
    extractObjectKeyFromUrlLike,
    getRemovedForumImageKeys,
    isForumManagedImageKey,
    listImageKeysFromContent,
    normalizeRequestedRemovedImageKeys,
    replaceAllLiteral,
    replaceImageSourceByKey,
    resolveForumImageBaseUrl
  } = createForumApiImageUtils({
    toText,
    getB2Config
  });

  const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const escapeHtml = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const {
    FORUM_ADMIN_SECTION_DEFAULT_BY_SLUG,
    FORUM_ADMIN_SECTION_LABEL_BY_SLUG,
    buildForumAdminSectionStatsMap,
    buildForumSectionLabelFromSlug,
    extractForumSectionSlug,
    loadForumAdminSections,
    normalizeForumAdminSection,
    normalizeForumSectionSlug,
    sanitizeForumSectionIcon,
    sanitizeForumSectionLabel
  } = createForumApiSectionUtils({
    dbAll,
    dbRun,
    forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
    formatTimeAgo,
    parseBooleanValue,
    toIso,
    toText
  });

  const {
    buildExcerpt,
    extractForumPostTitleBlock,
    extractTopicHeadline
  } = createForumApiContentUtils({
    toText
  });

  const {
    buildCommentPermissions,
    buildViewerContext
  } = createForumApiViewerUtils({
    getUserBadgeContext,
    loadSessionUserById,
    toText
  });

  const {
    buildPostTitle,
    mapForumAdminCommentSummary,
    mapForumAdminPostSummary,
    mapPostSummary,
    mapReply,
    normalizeAuthorAvatar,
    normalizeAuthorBadges
  } = createForumApiPresenterUtils({
    buildCommentPermissions,
    buildExcerpt,
    buildForumSectionLabelFromSlug,
    defaultSectionLabelBySlug: FORUM_ADMIN_SECTION_LABEL_BY_SLUG,
    extractForumSectionSlug,
    extractTopicHeadline,
    formatTimeAgo,
    normalizeAvatarUrl,
    normalizeForumSectionSlug,
    normalizeUploadedImageUrl,
    toIso,
    toText
  });

  const {
    buildSqlPlaceholders,
    deleteForumTreeByRootId,
    getForumAdminCommentById,
    getForumAdminRootPostById,
    hideForumTreeByRootId,
    loadValidForumCommentIdsForBulk,
    loadValidForumPostIdsForBulk,
    restoreForumTreeByRootId,
    runForumBulkModerationAction,
    updateForumRootPostBooleanField
  } = createForumApiAdminUtils({
    dbAll,
    dbGet,
    dbRun,
    deleteGoogleDriveImageByFileId,
    forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
    extractGoogleDriveFileIdFromImageUrl,
    getB2Config,
    isForumManagedImageKey,
    listImageKeysFromContent,
    normalizeAdminIdList,
    normalizePositiveInt,
    toText,
    deleteForumImageKeys: (...args) => deleteForumImageKeys(...args),
    withTransaction
  });

  const {
    buildAuthorDecorationMap,
    buildLikedIdSetForViewer,
    buildSavedPostIdSetForViewer
  } = createForumApiEngagementUtils({
    dbAll,
    getUserBadgeContext,
    normalizeAuthorBadges,
    toText
  });

  const FORUM_IMAGE_DRAFT_TTL_MS = 3 * 60 * 60 * 1000;
  const FORUM_DRAFT_CLEANUP_INTERVAL_MS = 8 * 60 * 60 * 1000;
  const FORUM_IMAGE_MAX_HEIGHT = 1500;
  const FORUM_IMAGE_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
  const FORUM_IMAGE_MAX_DIMENSION = 12000;
  const FORUM_POST_MAX_IMAGE_COUNT = 24;
  const FORUM_LOCAL_IMAGE_PLACEHOLDER_PREFIX = "forum-local-image://";
  const FORUM_LOCAL_IMAGE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

  const normalizeForumLocalImageId = (value) => {
    const normalized = toText(value)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-");
    if (!FORUM_LOCAL_IMAGE_ID_PATTERN.test(normalized)) return "";
    return normalized;
  };

  const buildForumLocalImagePlaceholder = (value) => {
    const safeId = normalizeForumLocalImageId(value);
    if (!safeId) return "";
    return `${FORUM_LOCAL_IMAGE_PLACEHOLDER_PREFIX}${safeId}`;
  };

  const {
    processForumDataUrlImage
  } = createForumApiImageProcessUtils({
    maxDimension: FORUM_IMAGE_MAX_DIMENSION,
    maxHeight: FORUM_IMAGE_MAX_HEIGHT,
    maxSourceBytes: FORUM_IMAGE_MAX_SOURCE_BYTES,
    sharp
  });

  const {
    cleanupExpiredForumDrafts,
    createDraftToken,
    deleteForumImageKeys,
    ensureForumDraftTable,
    isForumDraftExpired,
    isTmpForumDraftImageKey,
    listForumDraftImageKeys,
    parseDraftImages,
    purgeForumDraft,
    scheduleForumDraftCleanup
  } = createForumApiDraftUtils({
    b2DeleteAllByPrefix,
    b2DeleteFileVersions,
    crypto,
    dbAll,
    dbGet,
    dbRun,
    draftCleanupIntervalMs: FORUM_DRAFT_CLEANUP_INTERVAL_MS,
    draftTtlMs: FORUM_IMAGE_DRAFT_TTL_MS,
    expandForumImageKeyCandidates,
    getB2Config,
    toText
  });

  const {
    buildNormalizedForumPostContent,
    insertForumComment,
    loadVisibleForumCommentById,
    loadVisibleForumRootPost,
    loadViewerAuthorIdentity,
    normalizeForumRequestId
  } = createForumApiPostWriteUtils({
    crypto,
    dbGet,
    dbRun,
    escapeHtml,
    forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
    normalizeAuthorAvatar,
    normalizeForumSectionSlug,
    requestIdPrefix: FORUM_REQUEST_ID_PREFIX,
    toText
  });

  const {
    mapMentionCandidates
  } = createForumApiMentionUtils({
    toText
  });

  const {
    buildForumRootAuthorFilterSql,
    buildForumThreadParticipantFilterSql,
    buildRootCommentIdByCommentId,
    getForumMentionProfileMap
  } = createForumApiMentionProfileUtils({
    dbAll,
    normalizePositiveInt,
    toText
  });

  const {
    normalizeLinkLabelUrls,
    parseForumLinkCandidates,
    resolveParsedForumLinkLabels
  } = createForumApiLinkLabelUtils({
    buildPostTitle,
    buildSqlPlaceholders,
    dbAll,
    toText
  });

  const {
    countSavedForumPostsForUser,
    loadForumPostDetailRow,
    loadForumPostReplyRows,
    loadSavedForumPostsForUser,
    loadVisibleForumRootPostModerationRow,
    loadVisibleForumRootPostIdRow
  } = createForumApiReadQueryUtils({
    dbAll,
    dbGet
  });

  const {
    buildForumSectionItems,
    buildHomeCategoryItems,
    buildHomeSectionItems,
    buildSectionMetaBySlug,
    mapForumAdminCategory,
    mapForumAdminCategoryWithStats
  } = createForumApiSectionViewUtils({
    toText
  });

  const {
    loadForumAdminOverviewRows
  } = createForumApiAdminReadUtils({
    dbAll,
    dbGet
  });

  const {
    buildForumAdminCommentsWhere,
    buildForumAdminPostsWhere,
    loadForumAdminCommentsCount,
    loadForumAdminCommentsRows,
    loadForumAdminPostsCount,
    loadForumAdminPostsRows,
    resolveForumAdminPostsOrderBy
  } = createForumApiAdminListUtils({
    dbAll,
    dbGet
  });

  const {
    buildForumAdminCategoryUpdateMutation,
    ensureForumAdminCategoryExists,
    loadActiveForumAdminCategoryBySlug,
    loadForumAdminCategoryBySlug,
    loadNextForumAdminCategorySortOrder,
    softDeleteForumAdminCategoryBySlug,
    updateForumAdminCategoryBySlug,
    upsertForumAdminCategory
  } = createForumApiAdminCategoryUtils({
    dbGet,
    dbRun
  });

  const {
    buildAdminPostUpdatePayload
  } = createForumApiAdminPostEditUtils({
    escapeHtml,
    extractForumSectionSlug,
    getRemovedForumImageKeys,
    normalizeForumSectionSlug,
    normalizeRequestedRemovedImageKeys,
    toText
  });

  const {
    buildPaginationPayload,
    buildPaginationState
  } = createForumApiPaginationUtils();

  const {
    buildForumHomeWhereClause,
    loadForumHomeCount,
    loadForumHomeStats,
    resolveRequestedForumSection
  } = createForumApiHomeUtils({
    dbGet,
    forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
    toText
  });

  const buildForumPostFinalPrefix = ({ forumPrefix, token, nowMs = Date.now() }) => {
    const safeForumPrefix = toText(forumPrefix).replace(/^\/+/, "").replace(/\/+$/, "") || "forum";
    const safeToken = toText(token).slice(0, 8) || "draft";
    const safeTimestamp = Number.isFinite(Number(nowMs)) ? Math.max(0, Math.floor(Number(nowMs))) : Date.now();
    const date = new Date(safeTimestamp);
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${safeForumPrefix}/posts/${year}/${month}/post-${safeTimestamp}-${safeToken}`;
  };

  scheduleForumDraftCleanup();

  const decodePathSegment = (value) => {
    const text = toText(value);
    if (!text) return "";
    try {
      return decodeURIComponent(text);
    } catch (_err) {
      return text;
    }
  };

  const normalizePathname = (value) => {
    const source = toText(value).split(/[?#]/)[0];
    if (!source) return "";
    const withLeadingSlash = source.startsWith("/") ? source : `/${source}`;
    const compact = withLeadingSlash.replace(/\/{2,}/g, "/");
    const trimmed = compact.replace(/\/+$/, "");
    return trimmed || "/";
  };

  const normalizeHostName = (value) =>
    toText(value)
      .toLowerCase()
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .replace(/^www\./, "");

  const isLoopbackHostName = (value) => {
    const host = normalizeHostName(value);
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  };

  const resolvePortForUrl = (urlObject) => {
    const explicitPort = toText(urlObject && urlObject.port);
    if (explicitPort) return explicitPort;
    const protocol = toText(urlObject && urlObject.protocol).toLowerCase();
    if (protocol === "https:") return "443";
    if (protocol === "http:") return "80";
    return "";
  };

  const hasSameHostContext = (targetUrl, baseUrl) => {
    const targetHost = normalizeHostName(targetUrl && targetUrl.hostname);
    const baseHost = normalizeHostName(baseUrl && baseUrl.hostname);
    if (!targetHost || !baseHost) return false;

    const targetPort = resolvePortForUrl(targetUrl);
    const basePort = resolvePortForUrl(baseUrl);

    if (targetHost === baseHost) {
      return targetPort === basePort;
    }

    if (isLoopbackHostName(targetHost) && isLoopbackHostName(baseHost)) {
      return targetPort === basePort;
    }

    return false;
  };

  const parseInternalPathFromUrl = (rawUrl, req) => {
    const text = toText(rawUrl);
    if (!text) return "";

    const host = toText(req && typeof req.get === "function" ? req.get("host") : "");
    const protocol = toText(req && req.protocol ? req.protocol : "http") || "http";
    const baseOrigin = `${protocol}://${host || "localhost"}`;

    try {
      const parsed = new URL(text, baseOrigin);
      if (!/^https?:$/i.test(parsed.protocol)) return "";
      const base = new URL(baseOrigin);
      if (parsed.host && !hasSameHostContext(parsed, base)) {
        return "";
      }
      return normalizePathname(parsed.pathname);
    } catch (_err) {
      if (!text.startsWith("/")) return "";
      return normalizePathname(text);
    }
  };

  const buildMentionMapForRows = async ({ rows, rootCommentId }) => {
    const result = new Map();
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return result;
    if (
      typeof extractMentionUsernamesFromContent !== "function" ||
      typeof buildCommentMentionsForContent !== "function"
    ) {
      return result;
    }

    const forcedRootCommentId = normalizePositiveInt(rootCommentId, 0);
    const rootByCommentId = buildRootCommentIdByCommentId(list);
    const usernamesByRootId = new Map();

    list.forEach((row) => {
      const rowId = Number(row && row.id);
      if (!Number.isFinite(rowId) || rowId <= 0) return;

      const safeRowId = Math.floor(rowId);
      const resolvedRootId = forcedRootCommentId || Number(rootByCommentId.get(safeRowId)) || safeRowId;
      const mentionUsernames = extractMentionUsernamesFromContent(toText(row && row.content))
        .map((value) => toText(value).toLowerCase())
        .filter((value) => /^[a-z0-9_]{1,24}$/.test(value));
      if (!mentionUsernames.length) return;

      if (!usernamesByRootId.has(resolvedRootId)) {
        usernamesByRootId.set(resolvedRootId, new Set());
      }
      const bucket = usernamesByRootId.get(resolvedRootId);
      mentionUsernames.forEach((username) => {
        bucket.add(username);
      });
    });

    const mentionProfileMapByRootId = new Map();
    await Promise.all(
      Array.from(usernamesByRootId.entries()).map(async ([resolvedRootId, usernamesSet]) => {
        const mentionProfileMap = await getForumMentionProfileMap(Array.from(usernamesSet), {
          rootCommentId: resolvedRootId,
        }).catch(() => new Map());
        mentionProfileMapByRootId.set(resolvedRootId, mentionProfileMap);
      })
    );

    list.forEach((row) => {
      const rowId = Number(row && row.id);
      if (!Number.isFinite(rowId) || rowId <= 0) return;

      const safeRowId = Math.floor(rowId);
      const resolvedRootId = forcedRootCommentId || Number(rootByCommentId.get(safeRowId)) || safeRowId;
      const mentionProfileMap = mentionProfileMapByRootId.get(resolvedRootId) || new Map();

      const mentions = buildCommentMentionsForContent({
        content: toText(row && row.content),
        mentionProfileMap,
      });
      result.set(safeRowId, Array.isArray(mentions) ? mentions : []);
    });

    return result;
  };

  app.get(
    "/forum/api/mentions",
    asyncHandler(async (req, res) => {
      const limit = Math.min(
        Math.max(normalizePositiveInt(req.query.limit, FORUM_MENTION_MAX_RESULTS), 1),
        FORUM_MENTION_MAX_RESULTS
      );
      const queryText = normalizeMentionSearchQuery(req.query.q);
      const postId = normalizePositiveInt(req.query.postId, 0);
      const participantFilter = buildForumThreadParticipantFilterSql("c", postId);
      const rootAuthorFilter = buildForumRootAuthorFilterSql(postId);

      const queryFilterSql = queryText
        ? "AND (LOWER(u.username) ILIKE ? OR LOWER(COALESCE(u.display_name, '')) ILIKE ?)"
        : "";
      const queryFilterParams = queryText ? [`%${queryText}%`, `%${queryText}%`] : [];
      const fetchLimit = Math.max(limit * 12, 60);
      const rows = await dbAll(
        `
          WITH commenter_users AS (
            SELECT DISTINCT c.author_user_id AS user_id
            FROM comments c
            WHERE c.status = 'visible'
              AND c.author_user_id IS NOT NULL
              AND TRIM(c.author_user_id) <> ''
              ${participantFilter.sql}
          ),
          commenter_stats AS (
            SELECT
              c.author_user_id AS user_id,
              MAX(c.created_at) AS last_commented_at
            FROM comments c
            WHERE c.status = 'visible'
              AND c.author_user_id IS NOT NULL
              AND TRIM(c.author_user_id) <> ''
              ${participantFilter.sql}
            GROUP BY c.author_user_id
          ),
          root_post_author AS (
            ${rootAuthorFilter.sql}
          ),
          badge_flags AS (
            SELECT
              ub.user_id,
              MAX(CASE WHEN lower(b.code) = 'admin' THEN 1 ELSE 0 END) AS is_admin,
              MAX(CASE WHEN lower(b.code) IN ('mod', 'moderator') THEN 1 ELSE 0 END) AS is_mod,
              (array_agg(b.label ORDER BY b.priority DESC, b.id ASC))[1] AS role_label
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
            u.username,
            u.display_name,
            u.avatar_url,
            COALESCE(bf.role_label, '') AS role_label,
            COALESCE(cs.last_commented_at, '') AS last_commented_at,
            CASE WHEN cu.user_id IS NULL THEN false ELSE true END AS has_commented,
            COALESCE(bf.is_admin, 0) AS is_admin,
            COALESCE(bf.is_mod, 0) AS is_mod
          FROM allowed_users au
          JOIN users u ON u.id = au.user_id
          LEFT JOIN commenter_users cu ON cu.user_id = u.id
          LEFT JOIN commenter_stats cs ON cs.user_id = u.id
          LEFT JOIN badge_flags bf ON bf.user_id = u.id
          WHERE u.username IS NOT NULL
            AND TRIM(u.username) <> ''
            ${queryFilterSql}
          ORDER BY
            CASE WHEN cu.user_id IS NULL THEN 1 ELSE 0 END ASC,
            COALESCE(cs.last_commented_at, '') DESC,
            COALESCE(bf.is_admin, 0) DESC,
            COALESCE(bf.is_mod, 0) DESC,
            LOWER(COALESCE(u.display_name, u.username)) ASC,
            LOWER(u.username) ASC
          LIMIT ?
        `,
        [
          ...participantFilter.params,
          ...participantFilter.params,
          ...rootAuthorFilter.params,
          ...queryFilterParams,
          fetchLimit,
        ]
      );

      const mappedUsers = mapMentionCandidates({
        rows,
        limit,
        queryText,
      });

      return res.json({
        ok: true,
        users: mappedUsers,
      });
    })
  );

  app.post(
    "/forum/api/comments/upload-image",
    uploadCommentImage,
    asyncHandler(async (req, res) => {
      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập để gửi ảnh bình luận." });
      }
      if (!viewer.canComment) {
        return res.status(403).json({ ok: false, error: "Tài khoản của bạn không có quyền bình luận." });
      }

      if (!commentImageUploadsEnabled) {
        return res.status(503).json({
          ok: false,
          error: "Tính năng gửi ảnh trong bình luận hiện đang tắt.",
        });
      }

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ ok: false, error: "Không tìm thấy ảnh để tải lên." });
      }

      const uploaded = await uploadImageBufferToGoogleDrive({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
        prefix: "forum-comments",
      });

      return res.json({
        ok: true,
        imageUrl: uploaded.imageUrl,
        fileId: uploaded.fileId || "",
      });
    })
  );

  app.post(
    "/forum/api/posts",
    asyncHandler(async (req, res) => {
      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập để đăng bài." });
      }
      if (!viewer.canComment) {
        return res.status(403).json({ ok: false, error: "Tài khoản của bạn không có quyền đăng bài." });
      }

      const title = toText(req.body && req.body.title).slice(0, 220);
      const bodyContent = toText(req.body && req.body.content);
      const sectionSlug = toText(req.body && req.body.categorySlug);
      const normalizedContent = buildNormalizedForumPostContent({
        title,
        content: bodyContent,
        sectionSlug,
      });

      if (!title || !bodyContent || !normalizedContent) {
        return res.status(400).json({ ok: false, error: "Nội dung bài viết không được để trống." });
      }

      const requestId = normalizeForumRequestId(req.body && req.body.requestId);
      const authorIdentity = await loadViewerAuthorIdentity(viewer);
      const createdAt = new Date().toISOString();

      const createdCommentId = await insertForumComment({
        parentId: null,
        authorIdentity,
        content: normalizedContent,
        createdAt,
        requestId,
      });

      return res.json({
        ok: true,
        comment: {
          id: createdCommentId,
        },
        normalizedContent,
      });
    })
  );

  app.post(
    "/forum/api/posts/:id/replies",
    asyncHandler(async (req, res) => {
      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập để bình luận." });
      }
      if (!viewer.canComment) {
        return res.status(403).json({ ok: false, error: "Tài khoản của bạn không có quyền bình luận." });
      }

      const postId = normalizePositiveInt(req.params.id, 0);
      const parentIdInput = normalizePositiveInt(req.body && req.body.parentId, 0);
      const content = toText(req.body && req.body.content);
      const imageUrl = readSafeUploadedImageUrl(req.body && req.body.imageUrl);
      if (imageUrl && !commentImageUploadsEnabled) {
        return res.status(503).json({ ok: false, error: "Tính năng gửi ảnh trong bình luận hiện đang tắt." });
      }
      if (!postId || (!content && !imageUrl)) {
        return res.status(400).json({ ok: false, error: "Nội dung bình luận không hợp lệ." });
      }

      const rootPost = await loadVisibleForumRootPost(postId);
      if (!rootPost) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chủ đề." });
      }
      if (Boolean(rootPost && rootPost.forum_post_locked)) {
        return res.status(403).json({ ok: false, error: "Chủ đề này đã bị khóa. Bạn không thể bình luận." });
      }

      const parentId = parentIdInput || postId;
      const parentRow = await loadVisibleForumCommentById(parentId);
      if (!parentRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bình luận cha." });
      }

      const parentParentId = Number(parentRow && parentRow.parent_id) || 0;
      if (parentId !== postId && parentParentId !== postId) {
        return res.status(400).json({ ok: false, error: "Phản hồi không thuộc chủ đề này." });
      }
      const parentAuthorUserId = toText(parentRow && parentRow.author_user_id);

      const requestId = normalizeForumRequestId(req.body && req.body.requestId);
      const authorIdentity = await loadViewerAuthorIdentity(viewer);
      const createdAt = new Date().toISOString();

      const createdCommentId = await insertForumComment({
        parentId,
        authorIdentity,
        content,
        imageUrl,
        createdAt,
        requestId,
      });

      let excludedMentionUserIds = [];
      try {
        const interactionNotificationResult = await createCommentInteractionNotifications({
          postId,
          parentId,
          parentAuthorUserId,
          authorUserId: viewer.userId,
          commentId: createdCommentId,
          content,
        });
        excludedMentionUserIds =
          interactionNotificationResult && Array.isArray(interactionNotificationResult.notifiedUserIds)
            ? interactionNotificationResult.notifiedUserIds
            : [];
      } catch (error) {
        console.warn("Failed to create forum interaction notifications", error);
      }

      try {
        await createMentionNotificationsForComment({
          mangaId: null,
          chapterNumber: null,
          commentId: createdCommentId,
          content,
          authorUserId: viewer.userId,
          rootCommentId: postId,
          isForumRequest: true,
          excludeUserIds: excludedMentionUserIds
        });
      } catch (error) {
        console.warn("Failed to create forum mention notifications", error);
      }

      return res.json({
        ok: true,
        comment: {
          id: createdCommentId,
        },
      });
    })
  );

  app.post(
    "/forum/api/posts/:id/images/finalize",
    asyncHandler(async (req, res) => {
      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập để đăng bài." });
      }
      const canModerateImages = Boolean(viewer.canModerateForum || viewer.canDeleteAnyComment || viewer.canAccessAdmin);
      if (!viewer.canComment && !canModerateImages) {
        return res.status(403).json({ ok: false, error: "Tài khoản của bạn không có quyền đăng bài." });
      }

      const postId = normalizePositiveInt(req.params.id, 0);
      if (!postId) {
        return res.status(400).json({ ok: false, error: "Mã bài viết không hợp lệ." });
      }

      if (typeof sharp !== "function" || typeof b2UploadBuffer !== "function") {
        return res.status(500).json({ ok: false, error: "Máy chủ chưa cấu hình xử lý ảnh." });
      }

      const config = typeof getB2Config === "function" ? getB2Config() : null;
      if (!isB2Ready || typeof isB2Ready !== "function" || !isB2Ready(config)) {
        return res.status(500).json({ ok: false, error: "Thiếu cấu hình lưu trữ ảnh trong .env" });
      }
      const imageBaseUrl = resolveForumImageBaseUrl(config);
      if (!imageBaseUrl) {
        return res.status(500).json({ ok: false, error: "Thiếu cấu hình URL public cho ảnh forum." });
      }

      const postRow = await dbGet(
        `
          SELECT c.id, c.author_user_id, c.content, c.status
          FROM comments c
          WHERE c.id = ?
            AND c.parent_id IS NULL
            AND COALESCE(c.client_request_id, '') ILIKE ?
          LIMIT 1
        `,
        [postId, FORUM_REQUEST_ID_LIKE]
      );

      if (!postRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bài viết để đồng bộ ảnh." });
      }
      const authorUserId = toText(postRow.author_user_id);
      const isOwner = Boolean(authorUserId && authorUserId === viewer.userId);
      if (!isOwner && !canModerateImages) {
        return res.status(403).json({ ok: false, error: "Bạn không có quyền cập nhật ảnh cho bài viết này." });
      }
      if (!canModerateImages && toText(postRow.status) !== "visible") {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bài viết để đồng bộ ảnh." });
      }

      const rawContent =
        req && req.body && typeof req.body.content === "string"
          ? req.body.content
          : postRow && typeof postRow.content === "string"
            ? postRow.content
            : "";
      const allowPartialFinalize = Boolean(req && req.body && req.body.allowPartialFinalize === true);
      let outputContent = String(rawContent || "");
      if (!extractForumPostTitleBlock(outputContent)) {
        const existingTitleBlock = extractForumPostTitleBlock(postRow && postRow.content);
        if (existingTitleBlock) {
          outputContent = `${existingTitleBlock}${outputContent}`;
        }
      }

      const rawImages = Array.isArray(req && req.body ? req.body.images : null) ? req.body.images : [];
      const images = [];
      const seenImageIds = new Set();
      rawImages.forEach((item) => {
        const imageId = normalizeForumLocalImageId(item && item.id);
        const dataUrl = toText(item && item.dataUrl);
        if (!imageId || !dataUrl || seenImageIds.has(imageId)) return;
        seenImageIds.add(imageId);
        images.push({ id: imageId, dataUrl });
      });

      if (!images.length) {
        return res.json({ ok: true, content: outputContent, uploadedCount: 0 });
      }
      if (images.length > FORUM_POST_MAX_IMAGE_COUNT) {
        return res.status(400).json({ ok: false, error: `Tối đa ${FORUM_POST_MAX_IMAGE_COUNT} ảnh mỗi bài viết.` });
      }

      const processedImages = [];
      for (const image of images) {
        const imageId = toText(image && image.id);
        const dataUrl = toText(image && image.dataUrl);
        const placeholder = buildForumLocalImagePlaceholder(imageId);
        if (!placeholder) {
          return res.status(400).json({ ok: false, error: "ID ảnh cục bộ không hợp lệ." });
        }
        if (!outputContent.includes(placeholder)) {
          continue;
        }

        let webpBuffer = null;
        try {
          webpBuffer = await processForumDataUrlImage(dataUrl);
        } catch (err) {
          const code = toText(err && err.code);
          if (code === "invalid_data_url") {
            return res.status(400).json({ ok: false, error: "Dữ liệu ảnh không hợp lệ." });
          }
          if (code === "invalid_base64_payload") {
            return res.status(400).json({ ok: false, error: "Không đọc được dữ liệu ảnh." });
          }
          if (code === "source_too_large") {
            return res.status(400).json({ ok: false, error: "Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 8MB." });
          }
          if (code === "invalid_dimensions") {
            return res.status(400).json({ ok: false, error: "Không đọc được kích thước ảnh." });
          }
          if (code === "dimension_too_large") {
            return res
              .status(400)
              .json({ ok: false, error: "Kích thước ảnh quá lớn. Vui lòng chọn ảnh tối đa 12000px." });
          }
          return res.status(400).json({ ok: false, error: "Không thể xử lý ảnh." });
        }

        processedImages.push({
          id: imageId,
          placeholder,
          buffer: webpBuffer,
        });
      }

      if (!processedImages.length) {
        return res.json({ ok: true, content: outputContent, uploadedCount: 0 });
      }

      const nowMs = Date.now();
      const finalPrefix = buildForumPostFinalPrefix({
        forumPrefix: config.forumPrefix,
        token: `post-${postId}`,
        nowMs,
      });

      const uploadedKeys = [];
      const finalUrlById = new Map();

      try {
        for (let index = 0; index < processedImages.length; index += 1) {
          const item = processedImages[index];
          const destinationName = `${finalPrefix}/${String(index + 1).padStart(3, "0")}.webp`;
          await b2UploadBuffer({
            fileName: destinationName,
            buffer: item.buffer,
            contentType: "image/webp",
          });
          uploadedKeys.push(destinationName);
          finalUrlById.set(item.id, `${imageBaseUrl}/${destinationName}`);
        }
      } catch (_err) {
        if (uploadedKeys.length > 0) {
          await deleteForumImageKeys(uploadedKeys, { skipReferenceCheck: true }).catch(() => null);
        }
        return res.status(500).json({ ok: false, error: "Upload ảnh thất bại." });
      }

      for (const item of processedImages) {
        const finalUrl = toText(finalUrlById.get(item.id));
        if (!finalUrl) continue;
        outputContent = replaceAllLiteral(outputContent, item.placeholder, finalUrl);
      }

      const hasPendingLocalPlaceholders = new RegExp(
        `${escapeRegex(FORUM_LOCAL_IMAGE_PLACEHOLDER_PREFIX)}[a-z0-9][a-z0-9_-]{0,63}`,
        "i"
      ).test(outputContent);

      if (hasPendingLocalPlaceholders && !allowPartialFinalize) {
        await deleteForumImageKeys(uploadedKeys, { skipReferenceCheck: true }).catch(() => null);
        return res.status(400).json({ ok: false, error: "Thiếu dữ liệu ảnh để hoàn tất bài viết." });
      }

      const removedImageKeys = Array.from(
        new Set([
          ...getRemovedForumImageKeys({
            beforeContent: postRow && postRow.content,
            nextContent: outputContent,
            config,
          }),
          ...normalizeRequestedRemovedImageKeys(req && req.body ? req.body.removedImageKeys : [], config),
        ])
      );

      let deletedImageCount = 0;
      await dbRun("UPDATE comments SET content = ? WHERE id = ?", [outputContent, postId]);
      if (removedImageKeys.length > 0) {
        try {
          deletedImageCount = Number(await deleteForumImageKeys(removedImageKeys, { skipReferenceCheck: true })) || 0;
        } catch (err) {
          console.warn("forum finalize image cleanup failed", err);
        }
      }
      return res.json({
        ok: true,
        content: outputContent,
        uploadedCount: processedImages.length,
        removedImageCount: removedImageKeys.length,
        deletedImageCount,
        pendingPlaceholders: hasPendingLocalPlaceholders,
      });
    })
  );

  app.post(
    "/forum/api/post-drafts",
    asyncHandler(async (req, res) => {
      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập để tải ảnh." });
      }
      if (!viewer.canComment) {
        return res.status(403).json({ ok: false, error: "Tài khoản của bạn không có quyền đăng bài." });
      }

      await ensureForumDraftTable();
      cleanupExpiredForumDrafts().catch(() => null);

      const token = createDraftToken();
      const now = Date.now();
      await dbRun(
        `
          INSERT INTO forum_post_image_drafts (token, user_id, images_json, created_at, updated_at)
          VALUES (?, ?, '[]', ?, ?)
        `,
        [token, viewer.userId, now, now]
      );

      return res.json({ ok: true, token, createdAt: now });
    })
  );

  app.post(
    "/forum/api/post-drafts/:token/images",
    asyncHandler(async (req, res) => {
      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập để tải ảnh." });
      }
      if (!viewer.canComment) {
        return res.status(403).json({ ok: false, error: "Tài khoản của bạn không có quyền đăng bài." });
      }

      if (typeof sharp !== "function" || typeof b2UploadBuffer !== "function") {
        return res.status(500).json({ ok: false, error: "Máy chủ chưa cấu hình xử lý ảnh." });
      }

      const config = typeof getB2Config === "function" ? getB2Config() : null;
      if (!isB2Ready || typeof isB2Ready !== "function" || !isB2Ready(config)) {
        return res.status(500).json({ ok: false, error: "Thiếu cấu hình lưu trữ ảnh trong .env" });
      }
      const imageBaseUrl = resolveForumImageBaseUrl(config);
      if (!imageBaseUrl) {
        return res.status(500).json({ ok: false, error: "Thiếu cấu hình URL public cho ảnh forum." });
      }

      const token = toText(req.params.token).slice(0, 40);
      if (!token) {
        return res.status(400).json({ ok: false, error: "Draft không hợp lệ." });
      }

      await ensureForumDraftTable();
      const draftRow = await dbGet("SELECT * FROM forum_post_image_drafts WHERE token = ? LIMIT 1", [token]);
      if (!draftRow) {
        return res.status(404).json({ ok: false, error: "Draft không tồn tại hoặc đã hết hạn." });
      }
      if (toText(draftRow.user_id) !== viewer.userId) {
        return res.status(403).json({ ok: false, error: "Bạn không có quyền chỉnh draft này." });
      }
      if (isForumDraftExpired(draftRow)) {
        await purgeForumDraft(draftRow).catch(() => null);
        return res.status(410).json({ ok: false, error: "Draft đã hết hạn. Vui lòng tạo bài viết mới." });
      }

      const imageDataUrl = toText(req && req.body ? req.body.imageDataUrl : "");
      let webpBuffer = null;
      try {
        webpBuffer = await processForumDataUrlImage(imageDataUrl);
      } catch (err) {
        const code = toText(err && err.code);
        if (code === "invalid_data_url") {
          return res.status(400).json({ ok: false, error: "Dữ liệu ảnh không hợp lệ." });
        }
        if (code === "invalid_base64_payload") {
          return res.status(400).json({ ok: false, error: "Không đọc được dữ liệu ảnh." });
        }
        if (code === "source_too_large") {
          return res.status(400).json({ ok: false, error: "Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 8MB." });
        }
        if (code === "invalid_dimensions") {
          return res.status(400).json({ ok: false, error: "Không đọc được kích thước ảnh." });
        }
        if (code === "dimension_too_large") {
          return res
            .status(400)
            .json({ ok: false, error: "Kích thước ảnh quá lớn. Vui lòng chọn ảnh tối đa 12000px." });
        }
        return res.status(400).json({ ok: false, error: "Ảnh không hợp lệ hoặc không hỗ trợ." });
      }

      const imageId = crypto && typeof crypto.randomBytes === "function"
        ? crypto.randomBytes(12).toString("hex")
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      const keyPrefix = `${config.forumPrefix || "forum"}/tmp/posts/user-${viewer.userId}/draft-${token}`;
      const fileName = `${keyPrefix}/${imageId}.webp`;

      try {
        await b2UploadBuffer({
          fileName,
          buffer: webpBuffer,
          contentType: "image/webp",
        });
      } catch (_err) {
        return res.status(500).json({ ok: false, error: "Upload ảnh thất bại." });
      }

      const imageUrl = `${imageBaseUrl}/${fileName}`;
      const images = parseDraftImages(draftRow.images_json);
      images.push({ id: imageId, key: fileName, url: imageUrl });

      await dbRun(
        "UPDATE forum_post_image_drafts SET images_json = ?, updated_at = ? WHERE token = ?",
        [JSON.stringify(images), Date.now(), token]
      );

      return res.json({
        ok: true,
        image: {
          id: imageId,
          url: imageUrl,
          key: fileName,
        },
      });
    })
  );

  app.post(
    "/forum/api/post-drafts/:token/finalize",
    asyncHandler(async (req, res) => {
      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập để đăng bài." });
      }

      if (typeof b2CopyFile !== "function") {
        return res.status(500).json({ ok: false, error: "Máy chủ chưa cấu hình lưu trữ ảnh." });
      }

      const config = typeof getB2Config === "function" ? getB2Config() : null;
      if (!isB2Ready || typeof isB2Ready !== "function" || !isB2Ready(config)) {
        return res.status(500).json({ ok: false, error: "Thiếu cấu hình lưu trữ ảnh trong .env" });
      }
      const imageBaseUrl = resolveForumImageBaseUrl(config);
      if (!imageBaseUrl) {
        return res.status(500).json({ ok: false, error: "Thiếu cấu hình URL public cho ảnh forum." });
      }

      const token = toText(req.params.token).slice(0, 40);
      if (!token) {
        return res.status(400).json({ ok: false, error: "Draft không hợp lệ." });
      }

      await ensureForumDraftTable();
      const draftRow = await dbGet("SELECT * FROM forum_post_image_drafts WHERE token = ? LIMIT 1", [token]);
      if (!draftRow) {
        return res.status(404).json({ ok: false, error: "Draft không tồn tại hoặc đã hết hạn." });
      }
      if (toText(draftRow.user_id) !== viewer.userId) {
        return res.status(403).json({ ok: false, error: "Bạn không có quyền chỉnh draft này." });
      }
      if (isForumDraftExpired(draftRow)) {
        await purgeForumDraft(draftRow).catch(() => null);
        return res.status(410).json({ ok: false, error: "Draft đã hết hạn. Vui lòng tạo bài viết mới." });
      }

      const content = toText(req && req.body ? req.body.content : "");
      const images = parseDraftImages(draftRow.images_json);
      if (!images.length) {
        await dbRun("UPDATE forum_post_image_drafts SET images_json = '[]', updated_at = ? WHERE token = ?", [
          Date.now(),
          token,
        ]);
        return res.json({ ok: true, content });
      }

      const nowMs = Date.now();
      const finalPrefix = buildForumPostFinalPrefix({
        forumPrefix: config.forumPrefix,
        token,
        nowMs,
      });
      let outputContent = String(content || "");
      let savedCount = 0;
      const nextImages = [];

      for (const image of images) {
        const imageId = toText(image && image.id) || `${nextImages.length + 1}`;
        const imageKey = toText(image && image.key);
        const imageUrl = toText(image && image.url);
        const imageLegacyUrl = toText(image && image.legacyUrl);
        if (!imageKey || !imageUrl) continue;

        const hasCurrentUrl = extractObjectKeyFromUrlLike(imageUrl) === imageKey
          ? outputContent.includes(imageUrl)
          : false;
        const hasLegacyUrl = Boolean(imageLegacyUrl && outputContent.includes(imageLegacyUrl));
        const currentMatch = replaceImageSourceByKey({
          content: outputContent,
          sourceKey: imageKey,
          replacementUrl: imageUrl,
        });
        const hasKeyMatch = currentMatch.replaced;
        if (!hasCurrentUrl && !hasLegacyUrl && !hasKeyMatch) continue;
        if (hasKeyMatch) {
          outputContent = currentMatch.content;
        }

        if (!isTmpForumDraftImageKey(imageKey)) {
          if (!hasCurrentUrl && hasLegacyUrl) {
            outputContent = replaceAllLiteral(outputContent, imageLegacyUrl, imageUrl);
          }
          nextImages.push({ id: imageId, key: imageKey, url: imageUrl, legacyUrl: imageLegacyUrl });
          continue;
        }

        savedCount += 1;
        const destinationName = `${finalPrefix}/${String(savedCount).padStart(3, "0")}.webp`;
        await b2CopyFile({ sourceFileId: imageKey, destinationFileName: destinationName });
        const finalUrl = `${imageBaseUrl}/${destinationName}`;
        const replacedCurrent = replaceImageSourceByKey({
          content: outputContent,
          sourceKey: imageKey,
          replacementUrl: finalUrl,
        });
        outputContent = replacedCurrent.content;
        if (!replacedCurrent.replaced) {
          outputContent = replaceAllLiteral(outputContent, imageUrl, finalUrl);
        }
        nextImages.push({ id: imageId, key: destinationName, url: finalUrl, legacyUrl: imageUrl });
      }

      await dbRun("UPDATE forum_post_image_drafts SET images_json = ?, updated_at = ? WHERE token = ?", [
        JSON.stringify(nextImages),
        nowMs,
        token,
      ]);

      const tmpKeys = listForumDraftImageKeys(images, { onlyTmp: true });
      if (tmpKeys.length) {
        deleteForumImageKeys(tmpKeys, { skipReferenceCheck: true }).catch(() => null);
      }

      return res.json({ ok: true, content: outputContent });
    })
  );

  app.post(
    "/forum/api/post-drafts/:token/commit",
    asyncHandler(async (req, res) => {
      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập." });
      }

      const token = toText(req.params.token).slice(0, 40);
      if (!token) {
        return res.status(400).json({ ok: false, error: "Draft không hợp lệ." });
      }

      await ensureForumDraftTable();
      const draftRow = await dbGet("SELECT * FROM forum_post_image_drafts WHERE token = ? LIMIT 1", [token]);
      if (!draftRow) {
        return res.json({ ok: true, committed: true });
      }
      if (toText(draftRow.user_id) !== viewer.userId) {
        return res.status(403).json({ ok: false, error: "Bạn không có quyền chỉnh draft này." });
      }
      if (isForumDraftExpired(draftRow)) {
        await purgeForumDraft(draftRow).catch(() => null);
        return res.status(410).json({ ok: false, error: "Draft đã hết hạn. Vui lòng tạo bài viết mới." });
      }

      const images = parseDraftImages(draftRow.images_json);
      const requestedCommentId = normalizePositiveInt(req && req.body ? req.body.commentId : 0, 0);
      let effectiveCommentId = requestedCommentId;
      const config = typeof getB2Config === "function" ? getB2Config() : null;
      const canOperateStorage =
        typeof b2CopyFile === "function" &&
        (typeof b2DeleteFileVersions === "function" || typeof b2DeleteAllByPrefix === "function") &&
        typeof isB2Ready === "function" &&
        Boolean(isB2Ready(config));
      const imageBaseUrl = resolveForumImageBaseUrl(config);

      if (effectiveCommentId <= 0 && images.length > 0) {
        const candidateRows = await dbAll(
          `
            SELECT id, content
            FROM comments
            WHERE author_user_id = ?
              AND parent_id IS NULL
              AND status = 'visible'
              AND COALESCE(client_request_id, '') ILIKE ?
            ORDER BY id DESC
            LIMIT 30
          `,
          [viewer.userId, FORUM_REQUEST_ID_LIKE]
        );

        const matchedRow = (Array.isArray(candidateRows) ? candidateRows : []).find((row) => {
          const rowContent = String(row && row.content ? row.content : "");
          if (!rowContent) return false;

          return images.some((image) => {
            const imageKey = toText(image && image.key);
            const imageUrl = toText(image && image.url);
            const imageLegacyUrl = toText(image && image.legacyUrl);

            if (imageKey && contentHasImageKey(rowContent, imageKey)) return true;
            if (imageUrl && rowContent.includes(imageUrl)) return true;
            if (imageLegacyUrl && rowContent.includes(imageLegacyUrl)) return true;
            return false;
          });
        });

        if (matchedRow) {
          effectiveCommentId = normalizePositiveInt(matchedRow.id, 0);
        }
      }

      if (effectiveCommentId > 0 && images.length > 0) {
        if (!canOperateStorage || !imageBaseUrl) {
          return res.status(500).json({ ok: false, error: "Thiếu cấu hình URL public cho ảnh forum." });
        }

        const commentRow = await dbGet(
          `
            SELECT id, author_user_id, content
            FROM comments
            WHERE id = ?
              AND parent_id IS NULL
              AND status = 'visible'
              AND COALESCE(client_request_id, '') ILIKE ?
            LIMIT 1
          `,
          [effectiveCommentId, FORUM_REQUEST_ID_LIKE]
        );

        if (!commentRow) {
          return res.status(404).json({ ok: false, error: "Không tìm thấy bài viết để hoàn tất ảnh." });
        }
        if (toText(commentRow.author_user_id) !== viewer.userId) {
          return res.status(403).json({ ok: false, error: "Bạn không có quyền hoàn tất ảnh cho bài viết này." });
        }

        const nowMs = Date.now();
        const finalPrefix = buildForumPostFinalPrefix({
          forumPrefix: config.forumPrefix,
          token,
          nowMs,
        });
        const originalContent = String(commentRow && commentRow.content ? commentRow.content : "");
        let outputContent = originalContent;
        let savedCount = 0;

        for (const image of images) {
          const imageKey = toText(image && image.key);
          const imageUrl = toText(image && image.url);
          const imageLegacyUrl = toText(image && image.legacyUrl);
          if (!imageKey || !imageUrl) continue;

          const hasCurrentUrl = extractObjectKeyFromUrlLike(imageUrl) === imageKey
            ? outputContent.includes(imageUrl)
            : false;
          const hasLegacyUrl = Boolean(imageLegacyUrl && outputContent.includes(imageLegacyUrl));
          const currentMatch = replaceImageSourceByKey({
            content: outputContent,
            sourceKey: imageKey,
            replacementUrl: imageUrl,
          });
          const hasKeyMatch = currentMatch.replaced;
          if (!hasCurrentUrl && !hasLegacyUrl && !hasKeyMatch) continue;
          if (hasKeyMatch) {
            outputContent = currentMatch.content;
          }

          if (!isTmpForumDraftImageKey(imageKey)) {
            if (!hasCurrentUrl && hasLegacyUrl) {
              outputContent = replaceAllLiteral(outputContent, imageLegacyUrl, imageUrl);
            }
            continue;
          }

          savedCount += 1;
          const destinationName = `${finalPrefix}/${String(savedCount).padStart(3, "0")}.webp`;
          await b2CopyFile({ sourceFileId: imageKey, destinationFileName: destinationName });
          const finalUrl = `${imageBaseUrl}/${destinationName}`;

          const replacedCurrent = replaceImageSourceByKey({
            content: outputContent,
            sourceKey: imageKey,
            replacementUrl: finalUrl,
          });
          outputContent = replacedCurrent.content;
          if (!replacedCurrent.replaced) {
            outputContent = replaceAllLiteral(outputContent, imageUrl, finalUrl);
            if (imageLegacyUrl && imageLegacyUrl !== imageUrl) {
              outputContent = replaceAllLiteral(outputContent, imageLegacyUrl, finalUrl);
            }
          }
        }

        if (outputContent !== originalContent) {
          await dbRun("UPDATE comments SET content = ? WHERE id = ?", [outputContent, effectiveCommentId]);
        }
      }

      const hasTmpImages = images.some((image) => isTmpForumDraftImageKey(toText(image && image.key)));
      if (images.length > 0 && hasTmpImages && effectiveCommentId <= 0) {
        return res.status(409).json({
          ok: false,
          error: "Không xác định được bài viết để hoàn tất ảnh. Vui lòng thử đăng lại hoặc huỷ nháp.",
        });
      }

      const tmpKeys = listForumDraftImageKeys(images, { onlyTmp: true });
      if (tmpKeys.length > 0) {
        try {
          await deleteForumImageKeys(tmpKeys, { skipReferenceCheck: true });
        } catch (_err) {
          return res.status(500).json({ ok: false, error: "Không thể dọn ảnh nháp. Vui lòng thử lại." });
        }
      }

      await dbRun("DELETE FROM forum_post_image_drafts WHERE token = ?", [token]);
      return res.json({ ok: true, committed: true });
    })
  );

  app.delete(
    "/forum/api/post-drafts/:token",
    asyncHandler(async (req, res) => {
      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập." });
      }

      const token = toText(req.params.token).slice(0, 40);
      if (!token) {
        return res.status(400).json({ ok: false, error: "Draft không hợp lệ." });
      }

      await ensureForumDraftTable();
      const draftRow = await dbGet("SELECT * FROM forum_post_image_drafts WHERE token = ? LIMIT 1", [token]);
      if (!draftRow) {
        return res.json({ ok: true, deletedImages: 0 });
      }
      if (toText(draftRow.user_id) !== viewer.userId) {
        return res.status(403).json({ ok: false, error: "Bạn không có quyền chỉnh draft này." });
      }

      if (isForumDraftExpired(draftRow)) {
        const deletedCount = await purgeForumDraft(draftRow).catch(() => 0);
        return res.json({ ok: true, deletedImages: deletedCount });
      }

      const images = parseDraftImages(draftRow.images_json);
      const config = typeof getB2Config === "function" ? getB2Config() : null;
      const canDeleteStorage =
        (typeof b2DeleteFileVersions === "function" || typeof b2DeleteAllByPrefix === "function") &&
        typeof isB2Ready === "function" &&
        Boolean(isB2Ready(config));

      if (images.length > 0 && !canDeleteStorage) {
        return res.status(500).json({ ok: false, error: "Không thể dọn ảnh nháp. Vui lòng thử lại." });
      }

      if (canDeleteStorage && images.length > 0) {
        const tmpKeys = listForumDraftImageKeys(images, { onlyTmp: true });
        const persistedKeys = listForumDraftImageKeys(images).filter((key) => !isTmpForumDraftImageKey(key));
        let hasCleanupFailure = false;

        try {
          if (tmpKeys.length > 0) {
            await deleteForumImageKeys(tmpKeys, { skipReferenceCheck: true });
          }
          if (persistedKeys.length > 0) {
            await deleteForumImageKeys(persistedKeys);
          }
        } catch (_err) {
          hasCleanupFailure = true;
        }

        if (hasCleanupFailure) {
          return res.status(500).json({ ok: false, error: "Không thể dọn ảnh nháp. Vui lòng thử lại." });
        }
      }

      await dbRun("DELETE FROM forum_post_image_drafts WHERE token = ?", [token]);
      return res.json({ ok: true, deletedImages: images.length });
    })
  );

  app.get(
    "/forum/api/home",
    asyncHandler(async (req, res) => {
      const requestedPage = normalizePositiveInt(req.query.page, 1);
      const perPageRequested = normalizePositiveInt(req.query.perPage, DEFAULT_PER_PAGE);
      const perPage = Math.min(Math.max(perPageRequested, 1), MAX_PER_PAGE);
      const queryText = toText(req.query.q).replace(/\s+/g, " ").slice(0, 120);
      const sort = normalizeForumSort(req.query.sort);
      const rawSection = normalizeForumSectionSlug(toText(req.query.section));

      const viewer = await buildViewerContext(req);
      const forumSectionConfig = await loadForumAdminSections();
      const requestedSection = resolveRequestedForumSection({
        rawSection,
        sections: forumSectionConfig.sections,
      });
      const {
        whereParams,
        whereSql,
      } = buildForumHomeWhereClause({
        queryText,
        requestedSection,
      });

      const sectionMetaBySlug = buildSectionMetaBySlug(forumSectionConfig.sections);

      const countRow = await loadForumHomeCount({ whereParams, whereSql });

      const total = Number(countRow && countRow.count) || 0;
      const paginationState = buildPaginationState({
        perPage,
        requestedPage,
        total,
      });
      const {
        offset,
        page,
        pageCount,
      } = paginationState;

      const basePostSelectSql = `
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
          COALESCE(reply_stats.reply_count, 0) AS reply_count,
          reply_stats.latest_reply_at,
          (COALESCE(c.like_count, 0) + (COALESCE(reply_stats.reply_count, 0) * 2))::int AS hot_score
        FROM comments c
        LEFT JOIN users u ON u.id = c.author_user_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS reply_count,
            MAX(r.created_at) AS latest_reply_at
          FROM comments r
          WHERE r.status = 'visible'
            AND COALESCE(r.client_request_id, '') ILIKE ?
            AND (
              r.parent_id = c.id
              OR r.parent_id IN (
                SELECT c1.id
                FROM comments c1
                WHERE c1.parent_id = c.id
                  AND c1.status = 'visible'
                  AND COALESCE(c1.client_request_id, '') ILIKE ?
              )
            )
        ) reply_stats ON TRUE
        WHERE ${whereSql}
      `;

      let postRows = [];
      if (sort === "hot") {
        const recentCutoffIso = new Date(Date.now() - HOT_RECENT_WINDOW_MS).toISOString();
        postRows = await dbAll(
          `
            WITH base_posts AS (
              ${basePostSelectSql}
            ),
            recent_bucket AS (
              SELECT
                bp.id,
                ROW_NUMBER() OVER (ORDER BY bp.created_at DESC, bp.id DESC) AS bucket_rank
              FROM base_posts bp
              WHERE bp.created_at >= ?
            ),
            recent_picks AS (
              SELECT id, bucket_rank
              FROM recent_bucket
              WHERE bucket_rank <= ${HOT_RECENT_LIMIT}
            ),
            comment_bucket AS (
              SELECT
                bp.id,
                ROW_NUMBER() OVER (ORDER BY bp.latest_reply_at DESC, bp.id DESC) AS bucket_rank
              FROM base_posts bp
              WHERE bp.latest_reply_at IS NOT NULL
                AND bp.id NOT IN (SELECT id FROM recent_picks)
            ),
            comment_picks AS (
              SELECT id, bucket_rank
              FROM comment_bucket
              WHERE bucket_rank <= ${HOT_COMMENT_ACTIVITY_LIMIT}
            ),
            hot_bucket AS (
              SELECT
                bp.id,
                ROW_NUMBER() OVER (ORDER BY bp.hot_score DESC, bp.created_at DESC, bp.id DESC) AS bucket_rank
              FROM base_posts bp
              WHERE bp.id NOT IN (SELECT id FROM recent_picks)
                AND bp.id NOT IN (SELECT id FROM comment_picks)
            ),
            ranked AS (
              SELECT
                merged.id,
                ROW_NUMBER() OVER (ORDER BY merged.bucket ASC, merged.bucket_rank ASC) AS global_rank
              FROM (
                SELECT rp.id, 1 AS bucket, rp.bucket_rank
                FROM recent_picks rp
                UNION ALL
                SELECT cp.id, 2 AS bucket, cp.bucket_rank
                FROM comment_picks cp
                UNION ALL
                SELECT hb.id, 3 AS bucket, hb.bucket_rank
                FROM hot_bucket hb
              ) merged
            )
            SELECT bp.*
            FROM ranked r
            JOIN base_posts bp ON bp.id = r.id
            ORDER BY r.global_rank ASC
            LIMIT ? OFFSET ?
          `,
          [FORUM_REQUEST_ID_LIKE, FORUM_REQUEST_ID_LIKE, ...whereParams, recentCutoffIso, perPage, offset]
        );
      } else {
        const orderSql =
          sort === "most-commented"
            ? "ORDER BY COALESCE(reply_stats.reply_count, 0) DESC, c.created_at DESC, c.id DESC"
            : "ORDER BY c.created_at DESC, c.id DESC";

        postRows = await dbAll(
          `
            ${basePostSelectSql}
            ${orderSql}
            LIMIT ? OFFSET ?
          `,
          [FORUM_REQUEST_ID_LIKE, FORUM_REQUEST_ID_LIKE, ...whereParams, perPage, offset]
        );
      }

      const statsRow = await loadForumHomeStats();

      const postIds = postRows
        .map((row) => Number(row && row.id))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value));
      const likedIdSet = await buildLikedIdSetForViewer({ viewer, ids: postIds });
      const savedIdSet = await buildSavedPostIdSetForViewer({ viewer, ids: postIds });
      const authorDecorationMap = await buildAuthorDecorationMap(postRows);
      const mentionByCommentId = await buildMentionMapForRows({ rows: postRows });
      const sectionStatsBySlug = await buildForumAdminSectionStatsMap(
        forumSectionConfig.sections.map((section) => section.slug)
      );

      return res.json({
        ok: true,
        filters: {
          page,
          perPage,
          q: queryText,
          sort,
          section: requestedSection,
        },
        pagination: {
          ...buildPaginationPayload({
            page,
            perPage,
            total,
            pageCount,
          }),
        },
        stats: {
          memberCount: Number(statsRow && statsRow.member_count) || 0,
          postCount: Number(statsRow && statsRow.post_count) || 0,
          replyCount: Number(statsRow && statsRow.reply_count) || 0,
        },
        categories: buildHomeCategoryItems({
          sectionStatsBySlug,
          sections: forumSectionConfig.sections,
        }),
        sections: buildHomeSectionItems({
          sectionStatsBySlug,
          sections: forumSectionConfig.sections,
        }),
        posts: postRows.map((row) =>
          mapPostSummary(row, {
            viewer,
            authorDecorationMap,
            mentionByCommentId,
            likedIdSet,
            savedIdSet,
            sectionMetaBySlug,
            includeAllBadges: false,
          })
        ),
        viewer,
      });
    })
  );

  app.post(
    "/forum/api/link-labels",
    asyncHandler(async (req, res) => {
      const urls = normalizeLinkLabelUrls(req && req.body ? req.body.urls : []);

      if (!urls.length) {
        return res.json({ ok: true, labels: [] });
      }

      const parsedLinks = parseForumLinkCandidates({
        decodePathSegment,
        parseInternalPathFromUrl,
        req,
        urls,
      });

      if (!parsedLinks.length) {
        return res.json({ ok: true, labels: [] });
      }

      const labels = await resolveParsedForumLinkLabels({
        parsedLinks,
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
      });

      return res.json({ ok: true, labels });
    })
  );

  app.get(
    "/forum/api/posts/:id",
    asyncHandler(async (req, res) => {
      const postId = normalizePositiveInt(req.params.id, 0);
      if (!postId) {
        return res.status(400).json({ ok: false, error: "Mã chủ đề không hợp lệ." });
      }
      const viewer = await buildViewerContext(req);

      const postRow = await loadForumPostDetailRow({
        postId,
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
      });

      if (!postRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chủ đề." });
      }

      const replyRows = await loadForumPostReplyRows({
        postId,
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
      });

      const reactionIds = [postId, ...replyRows.map((row) => Number(row && row.id))]
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value));
      const likedIdSet = await buildLikedIdSetForViewer({ viewer, ids: reactionIds });
      const savedIdSet = await buildSavedPostIdSetForViewer({ viewer, ids: [postId] });
      const authorDecorationMap = await buildAuthorDecorationMap([postRow, ...replyRows]);
      const forumSectionConfig = await loadForumAdminSections();
      const sectionMetaBySlug = buildSectionMetaBySlug(forumSectionConfig.sections);
      const mentionByCommentId = await buildMentionMapForRows({
        rows: [postRow, ...replyRows],
        rootCommentId: postId,
      });
      const mappedPostWithAuthor = mapPostSummary(postRow, {
        includeContent: true,
        viewer,
        includeAllBadges: true,
        authorDecorationMap,
        mentionByCommentId,
        likedIdSet,
        savedIdSet,
        sectionMetaBySlug,
      });

      return res.json({
        ok: true,
        post: mappedPostWithAuthor,
        sections: buildForumSectionItems(forumSectionConfig.sections),
        comments: replyRows.map((row) =>
          mapReply(row, {
            viewer,
            authorDecorationMap,
            mentionByCommentId,
            likedIdSet,
          })
        ),
        viewer: {
          ...viewer,
          commentImageUploadsEnabled: Boolean(commentImageUploadsEnabled),
        },
      });
    })
  );

  app.post(
    "/forum/api/posts/:id/lock",
    asyncHandler(async (req, res) => {
      const postId = normalizePositiveInt(req.params.id, 0);
      if (!postId) {
        return res.status(400).json({ ok: false, error: "Mã chủ đề không hợp lệ." });
      }

      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập để khóa chủ đề." });
      }

      const postRow = await loadVisibleForumRootPostModerationRow({
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
        postId,
      });
      if (!postRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chủ đề." });
      }

      const ownerId = toText(postRow && postRow.author_user_id);
      const isOwner = Boolean(ownerId && ownerId === viewer.userId);
      const canModerate = Boolean(viewer.canModerateForum || viewer.canDeleteAnyComment);
      if (!isOwner && !canModerate) {
        return res.status(403).json({ ok: false, error: "Bạn không có quyền khóa chủ đề này." });
      }

      const explicitLocked = req && req.body && typeof req.body.locked === "boolean" ? req.body.locked : null;
      const currentLocked = Boolean(postRow && postRow.forum_post_locked);
      const nextLocked = await updateForumRootPostBooleanField({
        currentValue: currentLocked,
        explicitValue: explicitLocked,
        fieldName: "forum_post_locked",
        postId,
      });
      return res.json({ ok: true, locked: nextLocked });
    })
  );

  app.post(
    "/forum/api/posts/:id/pin",
    asyncHandler(async (req, res) => {
      const postId = normalizePositiveInt(req.params.id, 0);
      if (!postId) {
        return res.status(400).json({ ok: false, error: "Mã chủ đề không hợp lệ." });
      }

      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập để ghim chủ đề." });
      }

      if (!viewer.canModerateForum && !viewer.canDeleteAnyComment) {
        return res.status(403).json({ ok: false, error: "Chỉ Mod/Admin mới có thể ghim chủ đề." });
      }

      const postRow = await loadVisibleForumRootPostModerationRow({
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
        postId,
      });
      if (!postRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chủ đề." });
      }

      const explicitPinned = req && req.body && typeof req.body.pinned === "boolean" ? req.body.pinned : null;
      const currentPinned = Boolean(postRow && postRow.forum_post_pinned);
      const nextPinned = await updateForumRootPostBooleanField({
        currentValue: currentPinned,
        explicitValue: explicitPinned,
        fieldName: "forum_post_pinned",
        postId,
      });
      return res.json({ ok: true, pinned: nextPinned });
    })
  );

  app.get(
    "/forum/api/saved-posts",
    asyncHandler(async (req, res) => {
      const requestedPage = normalizePositiveInt(req.query.page, 1);
      const requestedPerPage = normalizePositiveInt(req.query.perPage, 0);
      const requestedLimit = normalizePositiveInt(req.query.limit, 0);
      const perPageInput = requestedPerPage || requestedLimit || 10;
      const perPage = Math.min(Math.max(perPageInput, 1), 10);

      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        const emptyPagination = buildPaginationPayload({
          page: 1,
          perPage,
          total: 0,
          pageCount: 1,
        });
        return res.json({
          ok: true,
          filters: {
            page: 1,
            perPage,
          },
          pagination: emptyPagination,
          posts: [],
          viewer,
        });
      }

      const countRow = await countSavedForumPostsForUser({
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
        userId: viewer.userId,
      });
      const total = Number(countRow && countRow.count) || 0;
      const paginationState = buildPaginationState({
        perPage,
        requestedPage,
        total,
      });
      const {
        offset,
        page,
        pageCount,
      } = paginationState;

      const postRows = await loadSavedForumPostsForUser({
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
        limit: perPage,
        offset,
        userId: viewer.userId,
      });

      if (!Array.isArray(postRows) || !postRows.length) {
        return res.json({
          ok: true,
          filters: {
            page,
            perPage,
          },
          pagination: buildPaginationPayload({
            page,
            perPage,
            total,
            pageCount,
          }),
          posts: [],
          viewer,
        });
      }

      const postIds = postRows
        .map((row) => Number(row && row.id))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value));
      const likedIdSet = await buildLikedIdSetForViewer({ viewer, ids: postIds });
      const savedIdSet = await buildSavedPostIdSetForViewer({ viewer, ids: postIds });
      const authorDecorationMap = await buildAuthorDecorationMap(postRows);
      const forumSectionConfig = await loadForumAdminSections();
      const sectionMetaBySlug = buildSectionMetaBySlug(forumSectionConfig.sections);
      const mentionByCommentId = await buildMentionMapForRows({ rows: postRows });

      return res.json({
        ok: true,
        filters: {
          page,
          perPage,
        },
        pagination: buildPaginationPayload({
          page,
          perPage,
          total,
          pageCount,
        }),
        posts: postRows.map((row) =>
          mapPostSummary(row, {
            viewer,
            authorDecorationMap,
            mentionByCommentId,
            likedIdSet,
            savedIdSet,
            sectionMetaBySlug,
            includeAllBadges: false,
          })
        ),
        viewer,
      });
    })
  );

  app.post(
    "/forum/api/posts/:id/bookmark",
    asyncHandler(async (req, res) => {
      const postId = normalizePositiveInt(req.params.id, 0);
      if (!postId) {
        return res.status(400).json({ ok: false, error: "Mã chủ đề không hợp lệ." });
      }

      const viewer = await buildViewerContext(req);
      if (!viewer.authenticated || !viewer.userId) {
        return res.status(401).json({ ok: false, error: "Bạn cần đăng nhập để lưu bài viết." });
      }

      const postRow = await loadVisibleForumRootPostIdRow({
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
        postId,
      });
      if (!postRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chủ đề." });
      }

      const existing = await dbGet(
        "SELECT comment_id FROM forum_post_bookmarks WHERE user_id = ? AND comment_id = ? LIMIT 1",
        [viewer.userId, postId]
      );

      let saved = false;
      if (existing) {
        await dbRun("DELETE FROM forum_post_bookmarks WHERE user_id = ? AND comment_id = ?", [viewer.userId, postId]);
        saved = false;
      } else {
        await dbRun(
          "INSERT INTO forum_post_bookmarks (user_id, comment_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
          [viewer.userId, postId, Date.now()]
        );
        saved = true;
      }

      return res.json({ ok: true, saved });
    })
  );

  app.get(
    "/forum/api/admin/overview",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const {
        latestRows,
        statsRow,
        todayRow,
      } = await loadForumAdminOverviewRows({
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
        startOfDayIso: startOfDay.toISOString(),
      });

      const adminSectionConfig = await loadForumAdminSections();

      return res.json({
        ok: true,
        stats: {
          totalPosts: Number(statsRow && statsRow.total_posts) || 0,
          visiblePosts: Number(statsRow && statsRow.visible_posts) || 0,
          hiddenPosts: Number(statsRow && statsRow.hidden_posts) || 0,
          totalReplies: Number(statsRow && statsRow.total_replies) || 0,
          totalReports: Number(statsRow && statsRow.total_reports) || 0,
          activeAuthors: Number(statsRow && statsRow.unique_authors) || 0,
          newPostsToday: Number(todayRow && todayRow.new_posts_today) || 0,
          newRepliesToday: Number(todayRow && todayRow.new_replies_today) || 0,
        },
        latestPosts: (Array.isArray(latestRows) ? latestRows : []).map((row) => {
          const mapped = mapForumAdminPostSummary(row, {
            sectionLabelBySlug: adminSectionConfig.labelBySlug,
          });
          return {
            id: mapped.id,
            title: mapped.title,
            status: mapped.status,
            sectionLabel: mapped.sectionLabel,
            authorName: mapped.author.name,
            timeAgo: mapped.timeAgo,
            createdAt: mapped.createdAt,
          };
        }),
      });
    })
  );

  app.get(
    "/forum/api/admin/posts",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const q = toText(req.query.q).replace(/\s+/g, " ").slice(0, 120);
      const status = normalizeForumAdminStatus(req.query.status);
      const section = normalizeForumAdminSection(req.query.section);
      const sort = normalizeForumAdminSort(req.query.sort);
      const perPageRequested = normalizePositiveInt(req.query.perPage, ADMIN_DEFAULT_PER_PAGE);
      const perPage = Math.min(Math.max(perPageRequested, 1), ADMIN_MAX_PER_PAGE);
      const requestedPage = normalizePositiveInt(req.query.page, 1);

      const {
        whereParams,
        whereSql,
      } = buildForumAdminPostsWhere({
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
        q,
        section,
        status,
      });

      const countRow = await loadForumAdminPostsCount({ whereParams, whereSql });
      const total = Number(countRow && countRow.count) || 0;
      const paginationState = buildPaginationState({
        perPage,
        requestedPage,
        total,
      });
      const {
        offset,
        page,
        pageCount,
      } = paginationState;

      const adminSectionConfig = await loadForumAdminSections();

      const orderBySql = resolveForumAdminPostsOrderBy(sort);

      const rows = await loadForumAdminPostsRows({
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
        offset,
        orderBySql,
        perPage,
        whereParams,
        whereSql,
      });

      return res.json({
        ok: true,
        filters: {
          q,
          status,
          section,
          sort,
          page,
          perPage,
        },
        pagination: buildPaginationPayload({
          page,
          perPage,
          total,
          pageCount,
        }),
        sections: adminSectionConfig.sections.map((item) => ({
          slug: item.slug,
          label: item.label,
        })),
        posts: (Array.isArray(rows) ? rows : []).map((row) =>
          mapForumAdminPostSummary(row, {
            sectionLabelBySlug: adminSectionConfig.labelBySlug,
          })
        ),
      });
    })
  );

  app.get(
    "/forum/api/admin/categories",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const adminSectionConfig = await loadForumAdminSections();
      const statsBySlug = await buildForumAdminSectionStatsMap(
        adminSectionConfig.sections.map((section) => section.slug)
      );

      return res.json({
        ok: true,
        categories: adminSectionConfig.sections
          .map((section) =>
            mapForumAdminCategoryWithStats({
              section,
              stats: statsBySlug.get(section.slug),
            })
          )
          .filter(Boolean),
      });
    })
  );

  app.post(
    "/forum/api/admin/categories",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = req && req.body && typeof req.body === "object" ? req.body : {};
      const label = sanitizeForumSectionLabel(body.label);
      const icon = sanitizeForumSectionIcon(body.icon) || "💬";
      const requestedSlug = toText(body.slug);

      if (!label) {
        return res.status(400).json({ ok: false, error: "Tên danh mục không hợp lệ." });
      }

      const slug = normalizeForumSectionSlug(requestedSlug || label);
      if (!slug) {
        return res.status(400).json({ ok: false, error: "Slug danh mục không hợp lệ." });
      }

      await ensureForumSectionSettingsTable();

      const existing = await loadForumAdminCategoryBySlug(slug);

      if (existing && !parseBooleanValue(existing.is_deleted, false)) {
        return res.status(409).json({ ok: false, error: "Slug danh mục đã tồn tại." });
      }

      const nextSortOrder = await loadNextForumAdminCategorySortOrder();
      await upsertForumAdminCategory({
        icon,
        label,
        slug,
        sortOrder: nextSortOrder,
      });

      const adminSectionConfig = await loadForumAdminSections();
      const created = adminSectionConfig.sections.find((item) => item.slug === slug);

      return res.status(201).json({
        ok: true,
        category: mapForumAdminCategory(created),
      });
    })
  );

  app.patch(
    "/forum/api/admin/categories/:slug",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const slug = normalizeForumSectionSlug(req.params.slug);
      if (!slug) {
        return res.status(400).json({ ok: false, error: "Danh mục không hợp lệ." });
      }

      await ensureForumSectionSettingsTable();

      const defaultSection = FORUM_ADMIN_SECTION_DEFAULT_BY_SLUG.get(slug);
      let existing = await loadForumAdminCategoryBySlug(slug);

      if (!existing && !defaultSection) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy danh mục." });
      }

      if (!existing) {
        existing = await ensureForumAdminCategoryExists({
          defaultSection,
          fallbackIcon: "💬",
          fallbackLabel: slug,
          slug,
        });
      }

      const mutation = buildForumAdminCategoryUpdateMutation({
        body: req && req.body && typeof req.body === "object" ? req.body : {},
        defaultSection,
        existing,
        sanitizeForumSectionIcon,
        sanitizeForumSectionLabel,
        slug,
        toPositiveInt: normalizePositiveInt,
      });
      if (mutation && mutation.error) {
        return res.status(400).json({ ok: false, error: mutation.error });
      }

      const updates = Array.isArray(mutation && mutation.updates) ? mutation.updates : [];
      const values = Array.isArray(mutation && mutation.values) ? mutation.values : [];

      await updateForumAdminCategoryBySlug({ slug, updates, values });

      const adminSectionConfig = await loadForumAdminSections();
      const updated = adminSectionConfig.sections.find((item) => item.slug === slug);

      return res.json({
        ok: true,
        category: mapForumAdminCategory(updated),
      });
    })
  );

  app.delete(
    "/forum/api/admin/categories/:slug",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const slug = normalizeForumSectionSlug(req.params.slug);
      if (!slug) {
        return res.status(400).json({ ok: false, error: "Danh mục không hợp lệ." });
      }

      await ensureForumSectionSettingsTable();

      const existing = await loadActiveForumAdminCategoryBySlug(slug);

      if (!existing) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy danh mục." });
      }

      if (parseBooleanValue(existing.is_system, false)) {
        return res.status(400).json({ ok: false, error: "Danh mục hệ thống không thể xóa." });
      }

      await softDeleteForumAdminCategoryBySlug(slug);

      return res.json({ ok: true, deleted: true, slug });
    })
  );

  const resolveAdminCommentTarget = async (req, res) => {
    const commentId = normalizePositiveInt(req.params.id, 0);
    if (!commentId) {
      res.status(400).json({ ok: false, error: "Mã bình luận không hợp lệ." });
      return null;
    }

    const commentRow = await getForumAdminCommentById(commentId);
    if (!commentRow) {
      res.status(404).json({ ok: false, error: "Không tìm thấy bình luận." });
      return null;
    }

    return {
      commentId,
      commentRow,
    };
  };

  const resolveAdminRootPostTarget = async (req, res) => {
    const postId = normalizePositiveInt(req.params.id, 0);
    if (!postId) {
      res.status(400).json({ ok: false, error: "Mã bài viết không hợp lệ." });
      return null;
    }

    const postRow = await getForumAdminRootPostById(postId);
    if (!postRow) {
      res.status(404).json({ ok: false, error: "Không tìm thấy bài viết." });
      return null;
    }

    return {
      postId,
      postRow,
    };
  };

  app.get(
    "/forum/api/admin/comments",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const q = toText(req.query.q).replace(/\s+/g, " ").slice(0, 120);
      const status = normalizeForumAdminStatus(req.query.status);
      const perPageRequested = normalizePositiveInt(req.query.perPage, ADMIN_DEFAULT_PER_PAGE);
      const perPage = Math.min(Math.max(perPageRequested, 1), ADMIN_MAX_PER_PAGE);
      const requestedPage = normalizePositiveInt(req.query.page, 1);

      const {
        whereParams,
        whereSql,
      } = buildForumAdminCommentsWhere({
        forumRequestIdLike: FORUM_REQUEST_ID_LIKE,
        q,
        status,
      });

      const countRow = await loadForumAdminCommentsCount({ whereParams, whereSql });

      const total = Number(countRow && countRow.count) || 0;
      const paginationState = buildPaginationState({
        perPage,
        requestedPage,
        total,
      });
      const {
        offset,
        page,
        pageCount,
      } = paginationState;

      const rows = await loadForumAdminCommentsRows({
        offset,
        perPage,
        whereParams,
        whereSql,
      });

      return res.json({
        ok: true,
        filters: {
          q,
          status,
          page,
          perPage,
        },
        pagination: buildPaginationPayload({
          page,
          perPage,
          total,
          pageCount,
        }),
        comments: (Array.isArray(rows) ? rows : []).map((row) => mapForumAdminCommentSummary(row)),
      });
    })
  );

  app.post(
    "/forum/api/admin/comments/bulk",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = req && req.body && typeof req.body === "object" ? req.body : {};
      const action = toText(body.action).toLowerCase();
      if (action !== "hide" && action !== "delete") {
        return res.status(400).json({ ok: false, error: "Thao tác hàng loạt không hợp lệ." });
      }

      const ids = normalizeAdminIdList(body.ids, 200);
      if (!ids.length) {
        return res.status(400).json({ ok: false, error: "Vui lòng chọn ít nhất một bình luận." });
      }

      const {
        changedCount,
        deletedCount,
        validIds,
      } = await runForumBulkModerationAction({
        action,
        ids,
        limit: 200,
        loadValidIds: loadValidForumCommentIdsForBulk,
      });

      if (!validIds.length) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bình luận hợp lệ để xử lý." });
      }

      return res.json({
        ok: true,
        action,
        targetCount: validIds.length,
        changedCount,
        deletedCount,
      });
    })
  );

  app.post(
    "/forum/api/admin/comments/:id/hide",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const target = await resolveAdminCommentTarget(req, res);
      if (!target) return;

      const { commentId } = target;

      const changedCount = await hideForumTreeByRootId(commentId);

      return res.json({ ok: true, hidden: true, changedCount });
    })
  );

  app.post(
    "/forum/api/admin/comments/:id/restore",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const target = await resolveAdminCommentTarget(req, res);
      if (!target) return;

      const { commentId } = target;

      const changedCount = await restoreForumTreeByRootId(commentId);

      return res.json({ ok: true, restored: true, changedCount });
    })
  );

  app.delete(
    "/forum/api/admin/comments/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const target = await resolveAdminCommentTarget(req, res);
      if (!target) return;

      const { commentId } = target;

      const deletedCount = await deleteForumTreeByRootId(commentId);

      return res.json({ ok: true, deleted: true, deletedCount });
    })
  );

  app.post(
    "/forum/api/admin/posts/bulk",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = req && req.body && typeof req.body === "object" ? req.body : {};
      const action = toText(body.action).toLowerCase();
      if (action !== "hide" && action !== "delete") {
        return res.status(400).json({ ok: false, error: "Thao tác hàng loạt không hợp lệ." });
      }

      const ids = normalizeAdminIdList(body.ids, 200);
      if (!ids.length) {
        return res.status(400).json({ ok: false, error: "Vui lòng chọn ít nhất một bài viết." });
      }

      const {
        changedCount,
        deletedCount,
        validIds,
      } = await runForumBulkModerationAction({
        action,
        ids,
        limit: 200,
        loadValidIds: loadValidForumPostIdsForBulk,
      });

      if (!validIds.length) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bài viết hợp lệ để xử lý." });
      }

      return res.json({
        ok: true,
        action,
        targetCount: validIds.length,
        changedCount,
        deletedCount,
      });
    })
  );

  app.patch(
    "/forum/api/admin/posts/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const target = await resolveAdminRootPostTarget(req, res);
      if (!target) return;

      const { postId, postRow } = target;

      const body = req && req.body && typeof req.body === "object" ? req.body : {};
      const config = typeof getB2Config === "function" ? getB2Config() : null;

      const adminSectionConfig = await loadForumAdminSections();
      const updatePayload = buildAdminPostUpdatePayload({
        availableSectionSlugs: adminSectionConfig.sections.map((item) => item.slug),
        body,
        config,
        postRow,
      });

      if (updatePayload && updatePayload.error) {
        return res.status(400).json({ ok: false, error: updatePayload.error });
      }

      const nextContent = toText(updatePayload && updatePayload.nextContent);
      const removedImageKeys = Array.isArray(updatePayload && updatePayload.removedImageKeys)
        ? updatePayload.removedImageKeys
        : [];
      const sectionSlug = toText(updatePayload && updatePayload.sectionSlug) || "thao-luan-chung";

      await dbRun(
        `
          UPDATE comments
          SET content = ?
          WHERE id = ?
        `,
        [nextContent, postId]
      );

      let deletedImageCount = 0;
      if (removedImageKeys.length > 0) {
        try {
          deletedImageCount = Number(await deleteForumImageKeys(removedImageKeys, { skipReferenceCheck: true })) || 0;
        } catch (err) {
          console.warn("admin post image cleanup failed", err);
        }
      }

      return res.json({
        ok: true,
        removedImageCount: removedImageKeys.length,
        deletedImageCount,
        post: {
          id: postId,
          sectionSlug,
          content: nextContent,
        },
      });
    })
  );

  app.post(
    "/forum/api/admin/posts/:id/pin",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const target = await resolveAdminRootPostTarget(req, res);
      if (!target) return;

      const { postId, postRow } = target;

      const explicitPinned = req && req.body && typeof req.body.pinned === "boolean" ? req.body.pinned : null;
      const currentPinned = Boolean(postRow && postRow.forum_post_pinned);
      const nextPinned = await updateForumRootPostBooleanField({
        currentValue: currentPinned,
        explicitValue: explicitPinned,
        fieldName: "forum_post_pinned",
        postId,
      });
      return res.json({ ok: true, pinned: nextPinned });
    })
  );

  app.post(
    "/forum/api/admin/posts/:id/lock",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const target = await resolveAdminRootPostTarget(req, res);
      if (!target) return;

      const { postId, postRow } = target;

      const explicitLocked = req && req.body && typeof req.body.locked === "boolean" ? req.body.locked : null;
      const currentLocked = Boolean(postRow && postRow.forum_post_locked);
      const nextLocked = await updateForumRootPostBooleanField({
        currentValue: currentLocked,
        explicitValue: explicitLocked,
        fieldName: "forum_post_locked",
        postId,
      });
      return res.json({ ok: true, locked: nextLocked });
    })
  );

  app.post(
    "/forum/api/admin/posts/:id/hide",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const target = await resolveAdminRootPostTarget(req, res);
      if (!target) return;

      const { postId } = target;

      const changedCount = await hideForumTreeByRootId(postId);

      return res.json({
        ok: true,
        hidden: true,
        changedCount,
      });
    })
  );

  app.post(
    "/forum/api/admin/posts/:id/restore",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const target = await resolveAdminRootPostTarget(req, res);
      if (!target) return;

      const { postId } = target;

      const changedCount = await restoreForumTreeByRootId(postId);

      return res.json({ ok: true, restored: true, changedCount });
    })
  );

  app.delete(
    "/forum/api/admin/posts/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const target = await resolveAdminRootPostTarget(req, res);
      if (!target) return;

      const { postId } = target;

      const deletedCount = await deleteForumTreeByRootId(postId);

      return res.json({ ok: true, deleted: true, deletedCount });
    })
  );
};

module.exports = registerForumApiRoutes;
