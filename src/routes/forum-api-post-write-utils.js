const createForumApiPostWriteUtils = ({
  crypto,
  dbGet,
  dbRun,
  escapeHtml,
  forumRequestIdLike,
  normalizeAuthorAvatar,
  normalizeForumSectionSlug,
  requestIdPrefix,
  toText,
}) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const safeRequestIdPrefix = readText(requestIdPrefix) || "forum-";

  const generateForumRequestId = () => {
    const randomSuffix =
      crypto && typeof crypto.randomBytes === "function"
        ? crypto.randomBytes(4).toString("hex")
        : Math.random().toString(36).slice(2, 10);
    return `${safeRequestIdPrefix}${Date.now().toString(36)}-${randomSuffix}`;
  };

  const normalizeForumRequestId = (value) => {
    const requestIdRaw = readText(value);
    return requestIdRaw.startsWith(safeRequestIdPrefix)
      ? requestIdRaw.slice(0, 80)
      : generateForumRequestId();
  };

  const buildForumMetaMarker = (sectionSlug) => {
    const safeSection =
      typeof normalizeForumSectionSlug === "function"
        ? normalizeForumSectionSlug(sectionSlug)
        : readText(sectionSlug);
    if (!safeSection) return "";
    return `<!--forum-meta:section=${safeSection}-->`;
  };

  const buildNormalizedForumPostContent = ({ title, content, sectionSlug }) => {
    const safeTitle = readText(title);
    const safeBody = readText(content);
    const metaMarker = buildForumMetaMarker(sectionSlug);
    const titleBlock = safeTitle ? `<p><strong>${escapeHtml(safeTitle)}</strong></p>` : "";
    return `${titleBlock}${metaMarker}${safeBody}`.trim();
  };

  const loadViewerAuthorIdentity = async (viewer) => {
    const userId = readText(viewer && viewer.userId);
    if (!userId) {
      return {
        author: "Thành viên",
        authorUserId: "",
        authorEmail: "",
        authorAvatarUrl: "",
      };
    }

    const row = await dbGet(
      `
        SELECT id, username, display_name, avatar_url
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [userId]
    );

    return {
      author: readText(row && row.display_name) || readText(row && row.username) || "Thành viên",
      authorUserId: userId,
      authorEmail: "",
      authorAvatarUrl: normalizeAuthorAvatar(row || {}),
    };
  };

  const insertForumComment = async ({
    parentId,
    authorIdentity,
    content,
    createdAt,
    requestId,
  }) => {
    const insertResult = await dbRun(
      `
        INSERT INTO comments (
          parent_id,
          author,
          author_user_id,
          author_email,
          author_avatar_url,
          client_request_id,
          content,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        parentId == null ? null : parentId,
        readText(authorIdentity && authorIdentity.author),
        readText(authorIdentity && authorIdentity.authorUserId),
        readText(authorIdentity && authorIdentity.authorEmail),
        readText(authorIdentity && authorIdentity.authorAvatarUrl),
        readText(requestId),
        readText(content),
        readText(createdAt),
      ]
    );
    return Number(insertResult && insertResult.lastID) || 0;
  };

  const loadVisibleForumRootPost = async (postId) => {
    const safePostId = Number(postId);
    if (!Number.isFinite(safePostId) || safePostId <= 0) return null;

    return dbGet(
      `
        SELECT id, forum_post_locked, author_user_id
        FROM comments
        WHERE id = ?
          AND parent_id IS NULL
          AND status = 'visible'
          AND COALESCE(client_request_id, '') ILIKE ?
        LIMIT 1
      `,
      [Math.floor(safePostId), forumRequestIdLike]
    );
  };

  const loadVisibleForumCommentById = async (commentId) => {
    const safeCommentId = Number(commentId);
    if (!Number.isFinite(safeCommentId) || safeCommentId <= 0) return null;

    return dbGet(
      `
        SELECT id, parent_id, author_user_id
        FROM comments
        WHERE id = ?
          AND status = 'visible'
          AND COALESCE(client_request_id, '') ILIKE ?
        LIMIT 1
      `,
      [Math.floor(safeCommentId), forumRequestIdLike]
    );
  };

  return {
    buildNormalizedForumPostContent,
    insertForumComment,
    loadVisibleForumCommentById,
    loadVisibleForumRootPost,
    loadViewerAuthorIdentity,
    normalizeForumRequestId,
  };
};

module.exports = createForumApiPostWriteUtils;
