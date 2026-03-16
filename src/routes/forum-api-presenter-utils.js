const createForumApiPresenterUtils = ({
  buildCommentPermissions,
  buildExcerpt,
  buildForumSectionLabelFromSlug,
  defaultSectionLabelBySlug,
  extractForumSectionSlug,
  extractTopicHeadline,
  formatTimeAgo,
  normalizeAvatarUrl,
  normalizeForumSectionSlug,
  normalizeUploadedImageUrl,
  toIso,
  toText
}) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const toIsoValue =
    typeof toIso === "function"
      ? (value) => toIso(value)
      : (value) => {
          const raw = readText(value);
          if (!raw) return "";
          const parsed = new Date(raw).getTime();
          if (!Number.isFinite(parsed)) return raw;
          return new Date(parsed).toISOString();
        };

  const buildTimeAgoText = (value) =>
    typeof formatTimeAgo === "function" ? formatTimeAgo(value) : readText(value);

  const normalizeReplyImageUrl = (value) => {
    const raw = readText(value);
    if (!raw) return "";
    if (typeof normalizeUploadedImageUrl === "function") {
      return readText(normalizeUploadedImageUrl(raw));
    }
    return raw;
  };

  const normalizeAuthorAvatar = (row) => {
    const userAvatar = readText(row && row.user_avatar_url);
    const commentAvatar = readText(row && row.author_avatar_url);
    const avatarCandidate = userAvatar || commentAvatar;
    if (typeof normalizeAvatarUrl === "function") {
      return normalizeAvatarUrl(avatarCandidate);
    }
    return avatarCandidate;
  };

  const normalizeAuthorBadges = (badgesInput) => {
    const badges = Array.isArray(badgesInput) ? badgesInput : [];
    const normalized = [];
    const seen = new Set();

    badges.forEach((badge) => {
      const code = readText(badge && badge.code).toLowerCase();
      const label = readText(badge && badge.label);
      const color = readText(badge && badge.color);
      const priority = Number(badge && badge.priority) || 0;
      const key = `${code}|${label.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);

      normalized.push({
        code: code || "badge",
        label: label || code || "Badge",
        color,
        priority
      });
    });

    return normalized;
  };

  const mapAuthor = (row, options = {}) => {
    const decorationMap = options.authorDecorationMap instanceof Map ? options.authorDecorationMap : new Map();
    const includeAllBadges = Boolean(options.includeAllBadges);
    const authorUserId = readText(row && row.author_user_id);
    const decoration = authorUserId && decorationMap.has(authorUserId)
      ? decorationMap.get(authorUserId)
      : null;
    const badges = normalizeAuthorBadges(decoration && decoration.badges);
    const highestBadge = badges[0] || null;
    const username = readText(row && row.user_username);
    const displayName = readText(row && row.user_display_name);
    const fallbackName = readText(row && row.author);
    const profileUrl = username
      ? `/user/${encodeURIComponent(username)}`
      : authorUserId
        ? `/comments/users/${encodeURIComponent(authorUserId)}`
        : "";

    return {
      id: authorUserId,
      username,
      displayName: displayName || fallbackName || username || "Thành viên",
      avatarUrl: normalizeAuthorAvatar(row),
      badges: includeAllBadges ? badges : highestBadge ? [highestBadge] : [],
      userColor: readText(decoration && decoration.userColor),
      profileUrl
    };
  };

  const buildPostTitle = (row) => {
    const headline = extractTopicHeadline(row && row.content);
    if (headline) {
      return headline;
    }

    return "Bài viết diễn đàn";
  };

  const mapPostSummary = (row, options = {}) => {
    const includeContent = Boolean(options.includeContent);
    const includeAllBadges = Boolean(options.includeAllBadges);
    const viewer = options.viewer || null;
    const mentionByCommentId = options.mentionByCommentId instanceof Map ? options.mentionByCommentId : new Map();
    const content = readText(row && row.content);
    const normalizedSectionSlug = normalizeForumSectionSlug(extractForumSectionSlug(content));
    const sectionSlug = normalizedSectionSlug || "thao-luan-chung";
    const sectionMetaBySlug =
      options && options.sectionMetaBySlug instanceof Map ? options.sectionMetaBySlug : new Map();
    const sectionMeta = sectionMetaBySlug.get(sectionSlug) || null;
    const sectionLabel = sectionMeta && sectionMeta.label
      ? readText(sectionMeta.label)
      : buildForumSectionLabelFromSlug(sectionSlug);
    const sectionIcon = sectionMeta && sectionMeta.icon ? readText(sectionMeta.icon) : "💬";
    const createdAtRaw = readText(row && row.created_at);
    const mappedId = Number(row && row.id) || 0;
    const mentions = mappedId > 0 && mentionByCommentId.has(mappedId)
      ? mentionByCommentId.get(mappedId)
      : [];
    const permissions = buildCommentPermissions({
      viewer,
      authorUserId: row && row.author_user_id
    });

    return {
      id: mappedId,
      title: buildPostTitle(row),
      excerpt: buildExcerpt(content),
      content: includeContent ? content : "",
      createdAt: toIsoValue(createdAtRaw),
      timeAgo: buildTimeAgoText(createdAtRaw),
      likeCount: Number(row && row.like_count) || 0,
      reportCount: Number(row && row.report_count) || 0,
      commentCount: Number(row && row.reply_count) || 0,
      isLocked: Boolean(row && row.forum_post_locked),
      isSticky: Boolean(row && row.forum_post_pinned),
      author: mapAuthor(row, {
        authorDecorationMap: options.authorDecorationMap,
        includeAllBadges
      }),
      category: {
        id: 0,
        name: sectionLabel || "Thảo luận",
        slug: sectionSlug || "thao-luan-chung",
        icon: sectionIcon || "💬"
      },
      sectionSlug,
      sectionLabel,
      sectionIcon,
      mentions: Array.isArray(mentions) ? mentions : [],
      permissions,
      liked: Boolean(options.likedIdSet instanceof Set && options.likedIdSet.has(Number(row && row.id) || 0)),
      saved: Boolean(options.savedIdSet instanceof Set && options.savedIdSet.has(Number(row && row.id) || 0))
    };
  };

  const mapForumAdminPostSummary = (row, options = {}) => {
    const sectionLabelBySlug =
      options && options.sectionLabelBySlug instanceof Map
        ? options.sectionLabelBySlug
        : defaultSectionLabelBySlug instanceof Map
          ? defaultSectionLabelBySlug
          : new Map();
    const postId = Number(row && row.id);
    const safePostId = Number.isFinite(postId) && postId > 0 ? Math.floor(postId) : 0;
    const content = readText(row && row.content);
    const sectionSlug = extractForumSectionSlug(content) || "thao-luan-chung";
    const sectionLabel =
      sectionLabelBySlug.get(sectionSlug) ||
      sectionLabelBySlug.get("thao-luan-chung") ||
      "Thảo luận chung";
    const title = extractTopicHeadline(content, 120) || "Bài viết diễn đàn";
    const excerpt = buildExcerpt(content, 180);
    const createdAtRaw = readText(row && row.created_at);
    const authorDisplayName = readText(row && row.author_display_name);
    const authorUsername = readText(row && row.author_username).toLowerCase();
    const fallbackAuthor = readText(row && row.author);
    const authorName = authorDisplayName || (authorUsername ? `@${authorUsername}` : fallbackAuthor || "Thành viên");

    return {
      id: safePostId,
      title,
      content,
      excerpt,
      status: readText(row && row.status).toLowerCase() === "reported" ? "hidden" : "visible",
      sectionSlug,
      sectionLabel,
      commentCount: Number(row && row.reply_count) || 0,
      reportCount: Number(row && row.report_count) || 0,
      likeCount: Number(row && row.like_count) || 0,
      isLocked: Boolean(row && row.forum_post_locked),
      isPinned: Boolean(row && row.forum_post_pinned),
      author: {
        id: readText(row && row.author_user_id),
        username: authorUsername,
        displayName: authorDisplayName || fallbackAuthor || authorUsername || "Thành viên",
        name: authorName,
        avatarUrl: normalizeAuthorAvatar(row)
      },
      createdAt: toIsoValue(createdAtRaw),
      timeAgo: buildTimeAgoText(createdAtRaw)
    };
  };

  const mapForumAdminCommentSummary = (row) => {
    const commentId = Number(row && row.id);
    const safeCommentId = Number.isFinite(commentId) && commentId > 0 ? Math.floor(commentId) : 0;
    const content = readText(row && row.content);
    const createdAtRaw = readText(row && row.created_at);
    const authorDisplayName = readText(row && row.author_display_name);
    const authorUsername = readText(row && row.author_username).toLowerCase();
    const fallbackAuthor = readText(row && row.author);
    const authorName = authorDisplayName || (authorUsername ? `@${authorUsername}` : fallbackAuthor || "Thành viên");

    const topicIdRaw = Number(row && row.topic_id);
    const topicId = Number.isFinite(topicIdRaw) && topicIdRaw > 0 ? Math.floor(topicIdRaw) : 0;
    const topicTitle = extractTopicHeadline(readText(row && row.topic_content), 120) || "Bài viết diễn đàn";

    const parentParentId = Number(row && row.parent_parent_id);

    return {
      id: safeCommentId,
      content: buildExcerpt(content, 180),
      status: readText(row && row.status).toLowerCase() === "reported" ? "hidden" : "visible",
      kind: Number.isFinite(parentParentId) && parentParentId > 0 ? "reply" : "comment",
      likeCount: Number(row && row.like_count) || 0,
      reportCount: Number(row && row.report_count) || 0,
      parentAuthorName: readText(row && row.parent_author),
      post: {
        id: topicId,
        title: topicTitle
      },
      author: {
        id: readText(row && row.author_user_id),
        username: authorUsername,
        displayName: authorDisplayName || fallbackAuthor || authorUsername || "Thành viên",
        name: authorName,
        avatarUrl: normalizeAuthorAvatar(row)
      },
      createdAt: toIsoValue(createdAtRaw),
      timeAgo: buildTimeAgoText(createdAtRaw)
    };
  };

  const mapReply = (row, options = {}) => {
    const viewer = options.viewer || null;
    const mentionByCommentId = options.mentionByCommentId instanceof Map ? options.mentionByCommentId : new Map();
    const createdAtRaw = readText(row && row.created_at);
    const mappedId = Number(row && row.id) || 0;
    const mentions = mappedId > 0 && mentionByCommentId.has(mappedId)
      ? mentionByCommentId.get(mappedId)
      : [];
    const permissions = buildCommentPermissions({
      viewer,
      authorUserId: row && row.author_user_id
    });
    return {
      id: mappedId,
      content: readText(row && row.content),
      imageUrl: normalizeReplyImageUrl(row && row.image_url),
      createdAt: toIsoValue(createdAtRaw),
      timeAgo: buildTimeAgoText(createdAtRaw),
      likeCount: Number(row && row.like_count) || 0,
      reportCount: Number(row && row.report_count) || 0,
      parentId: Number(row && row.parent_id) || 0,
      parentAuthorUserId: readText(row && row.parent_author_user_id),
      author: mapAuthor(row, {
        authorDecorationMap: options.authorDecorationMap,
        includeAllBadges: false
      }),
      mentions: Array.isArray(mentions) ? mentions : [],
      permissions,
      liked: Boolean(options.likedIdSet instanceof Set && options.likedIdSet.has(Number(row && row.id) || 0))
    };
  };

  return {
    buildPostTitle,
    mapForumAdminCommentSummary,
    mapForumAdminPostSummary,
    mapPostSummary,
    mapReply,
    normalizeAuthorAvatar,
    normalizeAuthorBadges
  };
};

module.exports = createForumApiPresenterUtils;
