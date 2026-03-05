const registerSiteRoutes = (app, deps) => {
  const {
    AUTH_DISCORD_STRATEGY,
    AUTH_GOOGLE_STRATEGY,
    COMMENT_LINK_LABEL_FETCH_LIMIT,
    COMMENT_MAX_LENGTH,
    FORUM_COMMENT_MIN_LENGTH,
    FORUM_COMMENT_MAX_LENGTH,
    FORUM_POST_MIN_LENGTH,
    FORUM_POST_MAX_LENGTH,
    FORUM_POST_TITLE_MIN_LENGTH,
    FORUM_REPLY_COOLDOWN_MS,
    FORUM_POST_COOLDOWN_MS,
    READING_HISTORY_MAX_ITEMS,
    SEO_ROBOTS_INDEX,
    SEO_ROBOTS_NOINDEX,
    SEO_SITE_NAME,
    asyncHandler,
    avatarsDir,
    coversDir,
    buildAvatarUrlFromAuthUser,
    buildCommentAuthorFromAuthUser,
    buildCommentChapterContext,
    buildCommentMentionsForContent,
    buildCommentNotificationPreview,
    buildHomepageNotices,
    buildOAuthCallbackUrl,
    buildSeoPayload,
    buildSessionUserFromUserRow,
    cacheBust,
    censorCommentContentByForbiddenWords,
    clearAllAuthSessionState,
    clearUserAuthSession,
    createMentionNotificationsForComment,
    crypto,
    dbAll,
    dbGet,
    dbRun,
    ensureCommentNotDuplicateRecently,
    ensureCommentPostCooldown,
    ensureCommentTurnstileIfSuspicious,
    ensureLeadingSlash,
    ensureUserRowFromAuthUser,
    escapeXml,
    extractMentionUsernamesFromContent,
    formatChapterNumberValue,
    formatTimeAgo,
    fs,
    getB2Config,
    getGenreStats,
    getMentionCandidatesForManga,
    getMentionProfileMapForManga,
    getPaginatedCommentTree,
    getPublicOriginFromRequest,
    getUserBadgeContext,
    hasOwnObjectKey,
    isDuplicateCommentRequestError,
    isOauthProviderEnabled,
    isServerSessionVersionMismatch,
    isUploadedAvatarUrl,
    listAuthIdentityRowsForUser,
    listQueryBase,
    listQueryOrder,
    loadSessionUserById,
    mapAuthIdentityRowToUserIdentity,
    mapMangaListRow,
    mapMangaRow,
    mapPublicUserRow,
    mapReadingHistoryRow,
    normalizeAvatarUrl,
    normalizeHomepageRow,
    normalizeNextPath,
    normalizeProfileBio,
    normalizeProfileDiscord,
    normalizeProfileDisplayName,
    normalizeProfileFacebook,
    normalizeSeoText,
    parseChapterNumberInput,
    passport,
    path,
    publishNotificationStreamUpdate,
    readAuthNextPath,
    readCommentRequestId,
    regenerateSession,
    registerCommentBotSignal,
    requireAuthUserForComments,
    resolveCommentScope,
    resolveOrCreateUserFromOauthProfile,
    resolvePaginationParams,
    sendCommentCooldownResponse,
    sendCommentDuplicateContentResponse,
    sendCommentRequestIdInvalidResponse,
    sendDuplicateCommentRequestResponse,
    serverSessionVersion,
    setAuthSessionUser,
    sharp,
    sitemapCacheByOrigin,
    sitemapCacheTtlMs,
    team,
    toAbsolutePublicUrl,
    toBooleanFlag,
    toIsoDate,
    uploadAvatar,
    uploadCover,
    upsertUserProfileFromAuthUser,
    wantsJson,
    withTransaction,
  } = deps;

  const TEAM_NAME_MAX_LENGTH = 30;
  const TEAM_INTRO_MAX_LENGTH = 300;
  const TEAM_SLUG_MAX_LENGTH = 60;
  const TEAM_MANGA_PREVIEW_LIMIT = 120;
  const TEAM_OVERVIEW_MANGA_LIMIT = 8;
  const CHAT_MESSAGE_MAX_LENGTH = 300;
  const CHAT_POST_COOLDOWN_MS = 2000;
  const TEAM_BADGE_LEADER_COLOR = "#ef4444";
  const TEAM_BADGE_MEMBER_COLOR = "#3b82f6";
  const TEAM_BADGE_LEADER_PRIORITY_FALLBACK = 55;
  const TEAM_BADGE_MEMBER_PRIORITY_FALLBACK = 45;
  const HOMEPAGE_CACHE_TTL_MS = 45 * 1000;
  const HOMEPAGE_LATEST_LIMIT = 8;
  const HOMEPAGE_RANDOM_SLICE_LIMIT = 16;
  const COMMENT_PANEL_PER_PAGE = 20;
  const NOTIFICATION_TYPE_TEAM_JOIN_REQUEST = "team_join_request";
  const NOTIFICATION_TYPE_TEAM_JOIN_APPROVED = "team_join_approved";
  const NOTIFICATION_TYPE_TEAM_JOIN_REJECTED = "team_join_rejected";
  const NOTIFICATION_TYPE_TEAM_MEMBER_KICKED = "team_member_kicked";
  const NOTIFICATION_TYPE_FORUM_POST_COMMENT = "forum_post_comment";
  const MANGA_DETAIL_CHAPTERS_PER_PAGE = 30;
  const BOOKMARKS_PER_PAGE = 10;
  const FAST_NAV_PAGE_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

  const isForumCommentRequest = (req, commentRequestId) => {
    const requestIdText = (commentRequestId || "").toString().trim().toLowerCase();
    if (requestIdText.startsWith("forum-")) {
      return true;
    }

    const forumModeValue = req && req.body ? req.body.forumMode : false;
    return toBooleanFlag(forumModeValue);
  };

  const resolveCommentLengthLimit = ({ req, parentId, commentRequestId }) => {
    if (isForumCommentRequest(req, commentRequestId)) {
      const parentNumber = Number(parentId);
      const isReply = Number.isFinite(parentNumber) && parentNumber > 0;
      return {
        maxLength: isReply ? FORUM_COMMENT_MAX_LENGTH : FORUM_POST_MAX_LENGTH,
        minLength: isReply ? FORUM_COMMENT_MIN_LENGTH : FORUM_POST_MIN_LENGTH,
        label: isReply ? "Bình luận" : "Bài viết",
      };
    }

    return {
      maxLength: COMMENT_MAX_LENGTH,
      minLength: 1,
      label: "Bình luận",
    };
  };

  const resolveNextSharedCommentId = async (dbGetFn = dbGet) => {
    const getter = typeof dbGetFn === "function" ? dbGetFn : dbGet;

    try {
      const sequenceRow = await getter(
        "SELECT nextval(pg_get_serial_sequence('comments', 'id')) AS id"
      );
      const sequenceId = sequenceRow && sequenceRow.id != null ? Number(sequenceRow.id) : NaN;
      if (Number.isFinite(sequenceId) && sequenceId > 0) {
        return Math.floor(sequenceId);
      }
    } catch (_err) {
      // Fallback for environments without pg_get_serial_sequence support.
    }

    const fallbackRow = await getter(
      `
        SELECT COALESCE(MAX(id), 0) + 1 AS id
        FROM (
          SELECT id FROM comments
          UNION ALL
          SELECT id FROM forum_posts
        ) all_ids
      `
    );
    const fallbackId = fallbackRow && fallbackRow.id != null ? Number(fallbackRow.id) : NaN;
    if (Number.isFinite(fallbackId) && fallbackId > 0) {
      return Math.floor(fallbackId);
    }
    return 1;
  };

  const stripHtmlTags = (value) =>
    (value == null ? "" : String(value))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const decodeBasicHtmlEntities = (value) =>
    (value == null ? "" : String(value))
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'");

  const normalizeForumTextLength = (value) =>
    decodeBasicHtmlEntities(stripHtmlTags(value)).replace(/\s+/g, " ").trim().length;

  const buildDefaultCommentPagination = ({
    page = 1,
    perPage = COMMENT_PANEL_PER_PAGE,
    totalCount = 0
  } = {}) => {
    const safePerPageValue = Number(perPage);
    const safePerPage = Number.isFinite(safePerPageValue)
      ? Math.max(1, Math.min(50, Math.floor(safePerPageValue)))
      : COMMENT_PANEL_PER_PAGE;
    const safeTotalCount = Math.max(Number(totalCount) || 0, 0);
    const totalPages = Math.max(1, Math.ceil(safeTotalCount / safePerPage));
    const requestedPage = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page))) : 1;
    const currentPage = Math.min(requestedPage, totalPages);

    return {
      page: currentPage,
      perPage: safePerPage,
      totalPages,
      totalTopLevel: safeTotalCount,
      hasPrev: currentPage > 1,
      hasNext: currentPage < totalPages,
      prevPage: Math.max(1, currentPage - 1),
      nextPage: Math.min(totalPages, currentPage + 1)
    };
  };

  const resolveVisibleCommentCount = async ({ mangaId, chapterNumber }) => {
    const commentScope = resolveCommentScope({ mangaId, chapterNumber });
    if (!commentScope) return 0;

    const countRow = await dbGet(
      `
        SELECT COUNT(*) as count
        FROM comments
        WHERE ${commentScope.whereVisible}
          AND COALESCE(client_request_id, '') NOT ILIKE ?
      `,
      [...commentScope.params, "forum-%"]
    );
    return countRow ? Number(countRow.count) || 0 : 0;
  };

  const FORUM_SECTION_SLUGS = new Set([
    "thao-luan-chung",
    "thong-bao",
    "huong-dan",
    "tim-truyen",
    "gop-y",
    "tam-su",
    "chia-se",
  ]);
  const FORUM_SECTION_SLUG_ALIASES = new Map([
    ["goi-y", "gop-y"],
    ["tin-tuc", "thong-bao"],
  ]);

  const normalizeForumSectionSlug = (value) => {
    const slug = (value == null ? "" : String(value))
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!slug) return "";
    const alias = FORUM_SECTION_SLUG_ALIASES.get(slug);
    const normalized = alias || slug;
    return FORUM_SECTION_SLUGS.has(normalized) ? normalized : "";
  };

  const extractForumSectionSlugFromContent = (content) => {
    let sectionSlug = "";
    String(content || "").replace(/<!--\s*forum-meta:([^>]*?)\s*-->/gi, (_fullMatch, payloadText) => {
      if (sectionSlug) return "";
      const payload = (payloadText == null ? "" : String(payloadText)).trim();
      if (!payload) return "";

      const pairs = payload
        .split(";")
        .map((item) => (item == null ? "" : String(item)).trim())
        .filter(Boolean);

      for (const pair of pairs) {
        const equalIndex = pair.indexOf("=");
        if (equalIndex <= 0) continue;
        const key = pair.slice(0, equalIndex).trim().toLowerCase();
        if (key !== "section") continue;
        const normalized = normalizeForumSectionSlug(pair.slice(equalIndex + 1));
        if (normalized) {
          sectionSlug = normalized;
          break;
        }
      }

      return "";
    });

    return sectionSlug;
  };

  const canCreateAnnouncementFromBadgeContext = (badgeContext) => {
    const badges = Array.isArray(badgeContext && badgeContext.badges) ? badgeContext.badges : [];
    const codes = badges
      .map((badge) => String(badge && badge.code ? badge.code : "").trim().toLowerCase())
      .filter(Boolean);
    return codes.includes("admin") || codes.includes("mod") || codes.includes("moderator");
  };

  const parseForumPostValidationParts = (content) => {
    const raw = (content == null ? "" : String(content)).trim();
    if (!raw) {
      return { titleText: "", bodyText: "" };
    }

    const titleMatch = raw.match(/^\s*<p>\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*<\/p>/i);
    const titleText = titleMatch ? decodeBasicHtmlEntities(stripHtmlTags(titleMatch[1])) : "";
    const bodyRaw = titleMatch ? raw.slice(titleMatch[0].length) : raw;
    const bodyWithoutMeta = bodyRaw.replace(/<!--\s*forum-meta:[\s\S]*?-->/gi, " ");
    const bodyText = decodeBasicHtmlEntities(stripHtmlTags(bodyWithoutMeta));

    return {
      titleText: titleText.replace(/\s+/g, " ").trim(),
      bodyText: bodyText.replace(/\s+/g, " ").trim(),
    };
  };

  const resolveCommentParentContext = async ({
    parentIdInput,
    commentScope,
    isForumRequest,
  }) => {
    const parentProvided = parentIdInput != null && String(parentIdInput).trim() !== "";
    let parentId = parentProvided ? Number(parentIdInput) : null;

    if (!parentProvided || !Number.isFinite(parentId) || parentId <= 0) {
      return {
        parentId: null,
        parentAuthorUserId: "",
        rootCommentId: 0,
        parentProvided,
        invalidParent: false,
      };
    }

    parentId = Math.floor(parentId);
    const targetTable = isForumRequest ? "forum_posts" : "comments";
    const parentRow = await dbGet(
      `
        SELECT
          c.id,
          c.parent_id,
          c.author_user_id
        FROM ${targetTable} c
        WHERE c.id = ?
          AND ${commentScope.whereWithoutStatus}
      `,
      [parentId, ...commentScope.params]
    );

    if (!parentRow) {
      return {
        parentId: null,
        parentAuthorUserId: "",
        rootCommentId: 0,
        parentProvided,
        invalidParent: true,
      };
    }

    const parentAuthorUserId = parentRow.author_user_id
      ? String(parentRow.author_user_id).trim()
      : "";
    const directParentIdRaw = Number(parentRow.parent_id);
    const directParentId = Number.isFinite(directParentIdRaw) && directParentIdRaw > 0
      ? Math.floor(directParentIdRaw)
      : 0;

    if (!isForumRequest) {
      if (directParentId) {
        return {
          parentId: null,
          parentAuthorUserId: "",
          rootCommentId: 0,
          parentProvided,
          invalidParent: true,
        };
      }

      return {
        parentId,
        parentAuthorUserId,
        rootCommentId: parentId,
        parentProvided,
        invalidParent: false,
      };
    }

    if (!directParentId) {
      return {
        parentId,
        parentAuthorUserId,
        rootCommentId: parentId,
        parentProvided,
        invalidParent: false,
      };
    }

    const rootRow = await dbGet(
      `
        SELECT
          c.id,
          c.parent_id
        FROM ${targetTable} c
        WHERE c.id = ?
          AND ${commentScope.whereWithoutStatus}
      `,
      [directParentId, ...commentScope.params]
    );

    const rootParentIdRaw = rootRow ? Number(rootRow.parent_id) : NaN;
    const rootParentId = Number.isFinite(rootParentIdRaw) && rootParentIdRaw > 0
      ? Math.floor(rootParentIdRaw)
      : 0;
    if (!rootRow || rootParentId) {
      return {
        parentId: null,
        parentAuthorUserId: "",
        rootCommentId: 0,
        parentProvided,
        invalidParent: true,
      };
    }

    return {
      parentId,
      parentAuthorUserId,
      rootCommentId: directParentId,
      parentProvided,
      invalidParent: false,
    };
  };

  const createForumPostCommentNotification = async ({
    isForumRequest,
    parentId,
    rootCommentId,
    parentAuthorUserId,
    authorUserId,
    mangaId,
    chapterNumber,
    commentId,
    content,
  }) => {
    if (!isForumRequest) return 0;

    const parentValue = Number(parentId);
    const rootValue = Number(rootCommentId);
    if (!Number.isFinite(parentValue) || parentValue <= 0) return 0;
    if (!Number.isFinite(rootValue) || rootValue <= 0) return 0;
    if (Math.floor(parentValue) !== Math.floor(rootValue)) return 0;

    const targetUserId = (parentAuthorUserId || "").toString().trim();
    const actorUserId = (authorUserId || "").toString().trim();
    if (!targetUserId || !actorUserId || targetUserId === actorUserId) return 0;

    const safeCommentIdRaw = Number(commentId);
    if (!Number.isFinite(safeCommentIdRaw) || safeCommentIdRaw <= 0) return 0;
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
        NOTIFICATION_TYPE_FORUM_POST_COMMENT,
        actorUserId,
        null,
        null,
        Math.floor(safeCommentIdRaw),
        preview,
        createdAt,
      ]
    );

    if (inserted && inserted.changes) {
      publishNotificationStreamUpdate({ userId: targetUserId, reason: "created" }).catch(() => null);
      return inserted.changes;
    }

    return 0;
  };
  const NOTIFICATION_TYPE_TEAM_MEMBER_PROMOTED_LEADER = "team_member_promoted_leader";
  const TEAM_MEMBER_PERMISSION_DEFAULTS = Object.freeze({
    canAddManga: false,
    canEditManga: false,
    canDeleteManga: false,
    canAddChapter: true,
    canEditChapter: true,
    canDeleteChapter: true
  });
  let homepageCacheExpiresAt = 0;
  let homepageCachePayload = null;
  const SEO_TRENDING_KEYWORDS = Object.freeze([
    "đọc truyện tranh online",
    "manga tiếng Việt",
    "đọc manga miễn phí",
    "truyện tranh mới cập nhật",
    "manga hot",
    "truyện tranh full chapter",
    "truyện tranh hành động",
    "truyện tranh romance",
    "truyện tranh drama",
    "truyện tranh school life",
    "nhóm dịch truyện tranh",
    SEO_SITE_NAME
  ]);

  const splitSeoNameTokens = (value) =>
    (value || "")
      .toString()
      .split(",")
      .map((item) => item.replace(/\s+/g, " ").trim())
      .filter(Boolean);

  const buildSeoKeywordList = (inputs, maxItems = 18) => {
    const values = Array.isArray(inputs) ? inputs : [inputs];
    const seen = new Set();
    const output = [];

    const pushKeyword = (value) => {
      const normalized = normalizeSeoText(value, 72);
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      output.push(normalized);
    };

    values.forEach((entry) => {
      if (Array.isArray(entry)) {
        entry.forEach(pushKeyword);
        return;
      }
      pushKeyword(entry);
    });

    return output.slice(0, maxItems);
  };

  const compactJsonLdList = (items) =>
    (Array.isArray(items) ? items : []).filter((item) => item && typeof item === "object");

  const buildOrganizationSchema = (req) => ({
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": toAbsolutePublicUrl(req, "/#organization"),
    name: SEO_SITE_NAME,
    url: toAbsolutePublicUrl(req, "/"),
    logo: toAbsolutePublicUrl(req, "/logobfang.svg")
  });

  const buildWebsiteSchema = (req) => {
    const mangaUrl = toAbsolutePublicUrl(req, "/manga");

    return {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": toAbsolutePublicUrl(req, "/#website"),
      name: SEO_SITE_NAME,
      url: toAbsolutePublicUrl(req, "/"),
      inLanguage: "vi-VN",
      publisher: {
        "@id": toAbsolutePublicUrl(req, "/#organization")
      },
      potentialAction: {
        "@type": "SearchAction",
        target: `${mangaUrl}?q={search_term_string}`,
        "query-input": "required name=search_term_string"
      }
    };
  };

  const buildBreadcrumbSchema = (req, items) => {
    const safeItems = Array.isArray(items) ? items : [];
    const itemListElement = safeItems
      .map((item, index) => {
        const name = normalizeSeoText(item && item.name ? item.name : "", 120);
        const path = item && item.path ? item.path : "";
        const itemUrl = toAbsolutePublicUrl(req, path || "");
        if (!name || !itemUrl) return null;
        return {
          "@type": "ListItem",
          position: index + 1,
          name,
          item: itemUrl
        };
      })
      .filter(Boolean);

    if (!itemListElement.length) return null;

    return {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement
    };
  };

  const buildCollectionPageSchema = (req, options = {}) => {
    const path = options.path || "/";
    const pageUrl = toAbsolutePublicUrl(req, path);
    const imageUrl = toAbsolutePublicUrl(req, options.image || "");
    const keywords = buildSeoKeywordList(options.keywords || []);

    const schema = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${pageUrl}#webpage`,
      url: pageUrl,
      name: normalizeSeoText(options.name || SEO_SITE_NAME, 140) || SEO_SITE_NAME,
      description: normalizeSeoText(options.description || SEO_SITE_NAME, 190) || SEO_SITE_NAME,
      inLanguage: "vi-VN",
      isPartOf: {
        "@id": toAbsolutePublicUrl(req, "/#website")
      }
    };

    if (imageUrl) {
      schema.primaryImageOfPage = {
        "@type": "ImageObject",
        url: imageUrl
      };
    }

    if (keywords.length) {
      schema.keywords = keywords.join(", ");
    }

    return schema;
  };

  const buildMangaItemListSchema = (req, options = {}) => {
    const mangaItems = Array.isArray(options.items) ? options.items : [];
    const itemListElement = mangaItems
      .slice(0, 20)
      .map((manga, index) => {
        const slug = manga && manga.slug ? String(manga.slug).trim() : "";
        if (!slug) return null;

        const mangaPath = `/manga/${encodeURIComponent(slug)}`;
        const mangaUrl = toAbsolutePublicUrl(req, mangaPath);

        return {
          "@type": "ListItem",
          position: index + 1,
          url: mangaUrl
        };
      })
      .filter(Boolean);

    if (!itemListElement.length) return null;

    return {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: normalizeSeoText(options.name || "Danh sách manga", 140) || "Danh sách manga",
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      numberOfItems: itemListElement.length,
      itemListElement
    };
  };

  const buildMangaSeriesSchema = (req, options = {}) => {
    const manga = options.manga && typeof options.manga === "object" ? options.manga : null;
    const canonicalPath = options.canonicalPath || "/";
    if (!manga || !manga.slug || !manga.title) return null;

    const pageUrl = toAbsolutePublicUrl(req, canonicalPath);
    const coverUrl = toAbsolutePublicUrl(req, manga.cover || "");
    const authorNames = splitSeoNameTokens(manga.author || "");
    const groupNames = splitSeoNameTokens(manga.groupName || "");
    const authorEntries = [
      ...authorNames.map((name) => ({ "@type": "Person", name })),
      ...groupNames.map((name) => ({ "@type": "Organization", name }))
    ];
    const genres = Array.isArray(manga.genres)
      ? manga.genres
        .map((genre) => normalizeSeoText(genre, 48))
        .filter(Boolean)
      : [];

    const schema = {
      "@context": "https://schema.org",
      "@type": "ComicSeries",
      "@id": `${pageUrl}#comicseries`,
      name: normalizeSeoText(manga.title, 140),
      url: pageUrl,
      inLanguage: "vi-VN",
      description: normalizeSeoText(options.description || manga.description || "", 190) || undefined,
      publisher: {
        "@id": toAbsolutePublicUrl(req, "/#organization")
      },
      isPartOf: {
        "@id": toAbsolutePublicUrl(req, "/#website")
      }
    };

    if (authorEntries.length === 1) {
      schema.author = authorEntries[0];
    } else if (authorEntries.length > 1) {
      schema.author = authorEntries;
    }

    if (genres.length) {
      schema.genre = genres;
    }

    if (coverUrl) {
      schema.image = coverUrl;
    }

    const chapterCount = Number.isFinite(Number(options.chapterCount))
      ? Math.max(0, Math.floor(Number(options.chapterCount)))
      : 0;
    if (chapterCount > 0) {
      schema.numberOfItems = chapterCount;
    }

    return schema;
  };

  const buildChapterSchema = (req, options = {}) => {
    const manga = options.manga && typeof options.manga === "object" ? options.manga : null;
    const chapter = options.chapter && typeof options.chapter === "object" ? options.chapter : null;
    const chapterPath = options.chapterPath || "";
    const chapterLabel = normalizeSeoText(options.chapterLabel || "", 140);
    if (!manga || !manga.slug || !manga.title || !chapter || !chapterPath || !chapterLabel) return null;

    const chapterUrl = toAbsolutePublicUrl(req, chapterPath);
    const mangaUrl = toAbsolutePublicUrl(req, `/manga/${encodeURIComponent(manga.slug)}`);
    const chapterPosition = Number(chapter.number);
    const chapterDateIso = toIsoDate(chapter.date);
    const coverUrl = toAbsolutePublicUrl(req, manga.cover || "");

    const schema = {
      "@context": "https://schema.org",
      "@type": "Chapter",
      "@id": `${chapterUrl}#chapter`,
      name: chapterLabel,
      headline: `${chapterLabel} | ${normalizeSeoText(manga.title, 120)}`,
      url: chapterUrl,
      inLanguage: "vi-VN",
      description: normalizeSeoText(options.description || "", 190) || undefined,
      isPartOf: {
        "@type": "ComicSeries",
        "@id": `${mangaUrl}#comicseries`,
        name: normalizeSeoText(manga.title, 120),
        url: mangaUrl
      }
    };

    if (Number.isFinite(chapterPosition) && chapterPosition > 0) {
      schema.position = chapterPosition;
    }

    if (chapterDateIso) {
      schema.datePublished = chapterDateIso;
      schema.dateModified = chapterDateIso;
    }

    if (coverUrl) {
      schema.image = coverUrl;
    }

    return schema;
  };

  const buildChapterItemListSchema = (req, options = {}) => {
    const mangaSlug = (options.mangaSlug || "").toString().trim();
    const mangaTitle = normalizeSeoText(options.mangaTitle || "", 120);
    const items = Array.isArray(options.items) ? options.items : [];
    if (!mangaSlug || !items.length) return null;

    const itemListElement = items
      .slice(0, 30)
      .map((chapter, index) => {
        const chapterNumber = chapter && chapter.number != null ? String(chapter.number).trim() : "";
        if (!chapterNumber) return null;
        const chapterPath = `/manga/${encodeURIComponent(mangaSlug)}/chapters/${encodeURIComponent(chapterNumber)}`;
        const chapterUrl = toAbsolutePublicUrl(req, chapterPath);
        return {
          "@type": "ListItem",
          position: index + 1,
          url: chapterUrl
        };
      })
      .filter(Boolean);

    if (!itemListElement.length) return null;

    return {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: mangaTitle ? `Danh sách chương ${mangaTitle}` : "Danh sách chương",
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      numberOfItems: itemListElement.length,
      itemListElement
    };
  };

  const teamSlugify = (value) =>
    (value || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();

  const buildUniqueTeamSlug = async (name) => {
    const base = teamSlugify(name).slice(0, TEAM_SLUG_MAX_LENGTH) || "team";
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const existing = await dbGet(
        "SELECT id FROM translation_teams WHERE lower(slug) = lower(?) LIMIT 1",
        [candidate]
      );
      if (!existing) return candidate;
    }
    return `${base}-${Date.now()}`;
  };

  const normalizeCommunityUrl = (value, maxLength = 220) => {
    const raw = (value || "").toString().trim();
    if (!raw) return "";
    if (raw.length > maxLength) return "";
    let candidate = raw;
    if (!/^https?:\/\//i.test(candidate)) {
      candidate = `https://${candidate.replace(/^\/+/, "")}`;
    }
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return `${parsed.protocol}//${parsed.host}${parsed.pathname || "/"}${parsed.search || ""}`;
    } catch (_err) {
      return "";
    }
  };

  const normalizeTeamFacebookUrl = (value) => normalizeProfileFacebook(value || "");
  const normalizeTeamDiscordUrl = (value) => normalizeProfileDiscord(value || "");

  const parseTeamCommunityLinks = ({ facebookRaw, discordRaw }) => {
    const rawFacebook = (facebookRaw || "").toString().trim();
    const rawDiscord = (discordRaw || "").toString().trim();
    const facebookUrl = normalizeTeamFacebookUrl(rawFacebook);
    const discordUrl = normalizeTeamDiscordUrl(rawDiscord);

    if (rawFacebook && !facebookUrl) {
      return { ok: false, errorKey: "facebook", facebookUrl: "", discordUrl: "" };
    }

    if (rawDiscord && !discordUrl) {
      return { ok: false, errorKey: "discord", facebookUrl: "", discordUrl: "" };
    }

    return { ok: true, errorKey: "", facebookUrl, discordUrl };
  };

  const normalizeTeamAssetUrl = (value) => {
    const raw = (value || "").toString().trim();
    if (!raw || raw.length > 500) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/uploads/avatars/") || raw.startsWith("/uploads/covers/")) return raw;
    return "";
  };

  const readTeamMemberPermissionFlag = (value, fallback) => {
    if (value == null) return Boolean(fallback);
    return toBooleanFlag(value);
  };

  const buildTeamMemberPermissionsFromRow = ({ role, row } = {}) => {
    const safeRole = (role || (row && row.role) || "member").toString().trim().toLowerCase();
    if (safeRole === "leader") {
      return {
        canAddManga: true,
        canEditManga: true,
        canDeleteManga: true,
        canAddChapter: true,
        canEditChapter: true,
        canDeleteChapter: true
      };
    }

    return {
      canAddManga: readTeamMemberPermissionFlag(
        row && row.can_add_manga,
        TEAM_MEMBER_PERMISSION_DEFAULTS.canAddManga
      ),
      canEditManga: readTeamMemberPermissionFlag(
        row && row.can_edit_manga,
        TEAM_MEMBER_PERMISSION_DEFAULTS.canEditManga
      ),
      canDeleteManga: readTeamMemberPermissionFlag(
        row && row.can_delete_manga,
        TEAM_MEMBER_PERMISSION_DEFAULTS.canDeleteManga
      ),
      canAddChapter: readTeamMemberPermissionFlag(
        row && row.can_add_chapter,
        TEAM_MEMBER_PERMISSION_DEFAULTS.canAddChapter
      ),
      canEditChapter: readTeamMemberPermissionFlag(
        row && row.can_edit_chapter,
        TEAM_MEMBER_PERMISSION_DEFAULTS.canEditChapter
      ),
      canDeleteChapter: readTeamMemberPermissionFlag(
        row && row.can_delete_chapter,
        TEAM_MEMBER_PERMISSION_DEFAULTS.canDeleteChapter
      )
    };
  };

  const hasAnyTeamManagePermission = (permissions) => {
    if (!permissions || typeof permissions !== "object") return false;
    return Boolean(
      permissions.canAddManga ||
      permissions.canEditManga ||
      permissions.canDeleteManga ||
      permissions.canAddChapter ||
      permissions.canEditChapter ||
      permissions.canDeleteChapter
    );
  };

  const parseTeamMemberPermissionInput = (payload) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: "invalid" };
    }

    const requiredKeys = [
      "canAddManga",
      "canEditManga",
      "canDeleteManga",
      "canAddChapter",
      "canEditChapter",
      "canDeleteChapter"
    ];

    const normalized = {};
    for (const key of requiredKeys) {
      if (!hasOwnObjectKey(payload, key)) {
        return { ok: false, reason: "invalid" };
      }
      normalized[key] = toBooleanFlag(payload[key]);
    }

    return { ok: true, permissions: normalized };
  };

  const buildTeamGroupNameListExpr = (columnSql) =>
    `replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(trim(COALESCE(${columnSql}, ''))), ' / ', ','), '/', ','), ' & ', ','), '&', ','), ' + ', ','), '+', ','), ';', ','), '|', ','), ', ', ','), ' ,', ',')`;

  const buildTeamGroupNameMatchSql = (columnSql) => {
    const normalizedList = buildTeamGroupNameListExpr(columnSql);
    return `
      (
        lower(trim(COALESCE(${columnSql}, ''))) = lower(trim(?))
        OR (',' || ${normalizedList} || ',') LIKE ('%,' || lower(trim(?)) || ',%')
        OR lower(COALESCE(${columnSql}, '')) LIKE ('%' || lower(trim(?)) || '%')
      )
    `;
  };

  const normalizeTeamGroupName = (value) =>
    (value || "")
      .toString()
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const splitTeamGroupDisplayTokens = (value) =>
    (value || "")
      .toString()
      .replace(/\s*[\/&+;|,]\s*/g, ",")
      .replace(/\s+x\s+/gi, ",")
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);

  const buildTeamPublicPath = (teamId, teamSlug) => {
    const safeTeamId = Number(teamId);
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0) return "";
    const safeTeamSlug = (teamSlug || "").toString().trim();
    return `/team/${encodeURIComponent(String(Math.floor(safeTeamId)))}/${encodeURIComponent(safeTeamSlug)}`;
  };

  const listGroupTeamLinks = async (groupName) => {
    const labels = splitTeamGroupDisplayTokens(groupName || "");
    if (!labels.length) return [];

    const uniqueNormalizedLabels = [...new Set(labels.map((label) => normalizeTeamGroupName(label)).filter(Boolean))];
    if (!uniqueNormalizedLabels.length) {
      return labels.map((label) => ({ label, url: "" }));
    }

    const placeholders = uniqueNormalizedLabels.map(() => "?").join(", ");
    const teamRows = await dbAll(
      `
        SELECT id, name, slug
        FROM translation_teams
        WHERE status = 'approved'
          AND lower(trim(name)) IN (${placeholders})
      `,
      uniqueNormalizedLabels
    );

    const teamPathByName = new Map();
    (Array.isArray(teamRows) ? teamRows : []).forEach((row) => {
      const key = normalizeTeamGroupName(row && row.name ? row.name : "");
      if (!key || teamPathByName.has(key)) return;
      const teamPath = buildTeamPublicPath(row && row.id, row && row.slug ? row.slug : "");
      if (teamPath) {
        teamPathByName.set(key, teamPath);
      }
    });

    return labels.map((label) => {
      const normalizedLabel = normalizeTeamGroupName(label);
      return {
        label,
        url: normalizedLabel ? teamPathByName.get(normalizedLabel) || "" : ""
      };
    });
  };

  const parseTimeValueToMs = (value) => {
    if (value == null) return 0;

    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0) return 0;
      return Math.floor(value);
    }

    const raw = String(value).trim();
    if (!raw) return 0;

    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.floor(numeric);
    }

    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
  };

  const formatDateVi = (value) => {
    const timeMs = parseTimeValueToMs(value);
    if (!timeMs) return "";
    try {
      return new Date(timeMs).toLocaleDateString("vi-VN");
    } catch (_err) {
      return "";
    }
  };

  const buildTeamInitials = (name) => {
    const safeName = (name || "").toString().replace(/\s+/g, " ").trim();
    if (!safeName) return "TT";
    const words = safeName.split(" ").filter(Boolean);
    if (!words.length) return "TT";

    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }

    return `${words[0][0] || ""}${words[words.length - 1][0] || ""}`.toUpperCase();
  };

  const getApprovedTeamMembership = async (userId) => {
    const safeUserId = (userId || "").toString().trim();
    if (!safeUserId) return null;
    return dbGet(
      `
        SELECT
          tm.team_id,
          tm.role,
          tm.can_add_manga,
          tm.can_edit_manga,
          tm.can_delete_manga,
          tm.can_add_chapter,
          tm.can_edit_chapter,
          tm.can_delete_chapter,
          t.name as team_name,
          t.slug as team_slug,
          t.status as team_status
        FROM translation_team_members tm
        JOIN translation_teams t ON t.id = tm.team_id
        WHERE tm.user_id = ?
          AND tm.status = 'approved'
          AND t.status = 'approved'
        ORDER BY CASE WHEN tm.role = 'leader' THEN 0 ELSE 1 END ASC, tm.reviewed_at DESC, tm.requested_at DESC
        LIMIT 1
      `,
      [safeUserId]
    );
  };

  const getApprovedLeaderTeamMembership = async ({ userId, teamId = 0, dbGetFn = dbGet }) => {
    const safeUserId = (userId || "").toString().trim();
    const safeTeamId = Number(teamId);
    if (!safeUserId) return null;

    const hasTeamFilter = Number.isFinite(safeTeamId) && safeTeamId > 0;
    return dbGetFn(
      `
        SELECT
          tm.team_id,
          tm.role,
          tm.can_add_manga,
          tm.can_edit_manga,
          tm.can_delete_manga,
          tm.can_add_chapter,
          tm.can_edit_chapter,
          tm.can_delete_chapter,
          t.name as team_name,
          t.slug as team_slug,
          t.intro as team_intro,
          t.facebook_url as team_facebook_url,
          t.discord_url as team_discord_url,
          t.avatar_url as team_avatar_url,
          t.cover_url as team_cover_url,
          t.status as team_status
        FROM translation_team_members tm
        JOIN translation_teams t ON t.id = tm.team_id
        WHERE tm.user_id = ?
          AND tm.role = 'leader'
          AND tm.status = 'approved'
          AND t.status = 'approved'
          AND (? = 0 OR tm.team_id = ?)
        ORDER BY tm.reviewed_at DESC, tm.requested_at DESC
        LIMIT 1
      `,
      [safeUserId, hasTeamFilter ? Math.floor(safeTeamId) : 0, hasTeamFilter ? Math.floor(safeTeamId) : 0]
    );
  };

  const getApprovedTeamMembershipForTeam = async ({ userId, teamId = 0, dbGetFn = dbGet }) => {
    const safeUserId = (userId || "").toString().trim();
    const safeTeamId = Number(teamId);
    if (!safeUserId) return null;

    const hasTeamFilter = Number.isFinite(safeTeamId) && safeTeamId > 0;
    return dbGetFn(
      `
        SELECT
          tm.team_id,
          tm.role,
          tm.can_add_manga,
          tm.can_edit_manga,
          tm.can_delete_manga,
          tm.can_add_chapter,
          tm.can_edit_chapter,
          tm.can_delete_chapter,
          t.name as team_name,
          t.slug as team_slug,
          t.intro as team_intro,
          t.facebook_url as team_facebook_url,
          t.discord_url as team_discord_url,
          t.avatar_url as team_avatar_url,
          t.cover_url as team_cover_url,
          t.status as team_status
        FROM translation_team_members tm
        JOIN translation_teams t ON t.id = tm.team_id
        WHERE tm.user_id = ?
          AND tm.status = 'approved'
          AND t.status = 'approved'
          AND (? = 0 OR tm.team_id = ?)
        ORDER BY CASE WHEN tm.role = 'leader' THEN 0 ELSE 1 END ASC, tm.reviewed_at DESC, tm.requested_at DESC
        LIMIT 1
      `,
      [safeUserId, hasTeamFilter ? Math.floor(safeTeamId) : 0, hasTeamFilter ? Math.floor(safeTeamId) : 0]
    );
  };

  const getApprovedTeamById = async ({ teamId, dbGetFn = dbGet }) => {
    const safeTeamId = Number(teamId);
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0) return null;

    return dbGetFn(
      `
        SELECT
          t.id as team_id,
          t.name as team_name,
          t.slug as team_slug,
          t.intro as team_intro,
          t.facebook_url as team_facebook_url,
          t.discord_url as team_discord_url,
          t.avatar_url as team_avatar_url,
          t.cover_url as team_cover_url,
          t.status as team_status
        FROM translation_teams t
        WHERE t.id = ?
          AND t.status = 'approved'
        LIMIT 1
      `,
      [Math.floor(safeTeamId)]
    );
  };

  const hasAdminBadgeAccess = async (userId) => {
    const safeUserId = (userId || "").toString().trim();
    if (!safeUserId) return false;
    try {
      const badgeContext = await getUserBadgeContext(safeUserId);
      return Boolean(badgeContext && badgeContext.permissions && badgeContext.permissions.canAccessAdmin);
    } catch (_err) {
      return false;
    }
  };

  const resolveTeamManagementActor = async ({ userId, teamId, dbGetFn = dbGet }) => {
    const safeUserId = (userId || "").toString().trim();
    const safeTeamId = Number(teamId);
    if (!safeUserId || !Number.isFinite(safeTeamId) || safeTeamId <= 0) {
      return { ok: false, statusCode: 400, error: "Dữ liệu không hợp lệ.", reason: "invalid" };
    }

    const teamRow = await getApprovedTeamById({ teamId: Math.floor(safeTeamId), dbGetFn });
    if (!teamRow) {
      return { ok: false, statusCode: 404, error: "Không tìm thấy nhóm dịch.", reason: "notfound" };
    }

    const leaderMembership = await dbGetFn(
      `
        SELECT user_id
        FROM translation_team_members
        WHERE team_id = ?
          AND user_id = ?
          AND role = 'leader'
          AND status = 'approved'
        LIMIT 1
      `,
      [Math.floor(safeTeamId), safeUserId]
    );

    if (leaderMembership && leaderMembership.user_id) {
      return {
        ok: true,
        reason: "leader",
        actorMode: "leader",
        actorUserId: safeUserId,
        team: teamRow,
        teamId: Math.floor(Number(teamRow.team_id) || safeTeamId),
        teamName: (teamRow.team_name || "").toString().trim(),
        teamSlug: (teamRow.team_slug || "").toString().trim()
      };
    }

    const canAccessAdmin = await hasAdminBadgeAccess(safeUserId);
    if (canAccessAdmin) {
      return {
        ok: true,
        reason: "admin",
        actorMode: "admin",
        actorUserId: safeUserId,
        team: teamRow,
        teamId: Math.floor(Number(teamRow.team_id) || safeTeamId),
        teamName: (teamRow.team_name || "").toString().trim(),
        teamSlug: (teamRow.team_slug || "").toString().trim()
      };
    }

    return {
      ok: false,
      statusCode: 403,
      error: "Bạn không có quyền quản lý nhóm dịch này.",
      reason: "forbidden"
    };
  };

  const isTeamNameMatch = (left, right) => {
    const normalize = (value) =>
      (value || "")
        .toString()
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const a = normalize(left);
    const b = normalize(right);
    return Boolean(a) && Boolean(b) && a === b;
  };

  const syncTeamBadgesForTeamMembers = async ({ teamId, teamName, dbAllFn = dbAll, dbGetFn = dbGet, dbRunFn = dbRun }) => {
    const safeTeamId = Number(teamId);
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0) return;

    const rows = await dbAllFn(
      `
        SELECT user_id, role, status
        FROM translation_team_members
        WHERE team_id = ?
      `,
      [Math.floor(safeTeamId)]
    );

    for (const row of rows) {
      await syncTeamBadgeForMember({
        teamId: Math.floor(safeTeamId),
        teamName,
        userId: row && row.user_id ? String(row.user_id).trim() : "",
        role: row && row.role ? row.role : "member",
        isApproved: (row && row.status ? String(row.status).trim().toLowerCase() : "") === "approved",
        dbGetFn,
        dbRunFn
      });
    }
  };

  const buildTeamRoleLabel = ({ role, teamName }) => {
    const safeTeamName = (teamName || "").toString().trim();
    if (!safeTeamName) return "";
    const safeRole = (role || "").toString().trim().toLowerCase();
    return safeRole === "leader" ? `Leader ${safeTeamName}` : safeTeamName;
  };

  const buildTeamBadgeCode = (teamId, role) => {
    const id = Number(teamId);
    if (!Number.isFinite(id) || id <= 0) return "";
    const safeRole = (role || "").toString().trim().toLowerCase() === "leader" ? "leader" : "member";
    return `team_${Math.floor(id)}_${safeRole}`;
  };

  const resolveTeamBadgePriority = async (dbGetFn = dbGet) => {
    const row = await dbGetFn(
      `
        SELECT
          MAX(CASE WHEN lower(code) = 'admin' THEN priority END) as admin_priority,
          MAX(CASE WHEN lower(code) = 'mod' THEN priority END) as mod_priority,
          MAX(CASE WHEN lower(code) NOT IN ('admin', 'mod') THEN priority END) as other_priority
        FROM badges
      `
    );

    const adminPriority = row && row.admin_priority != null ? Number(row.admin_priority) : NaN;
    const modPriority = row && row.mod_priority != null ? Number(row.mod_priority) : NaN;
    const otherPriority = row && row.other_priority != null ? Number(row.other_priority) : NaN;
    const safeOtherPriority = Number.isFinite(otherPriority)
      ? Math.floor(otherPriority)
      : TEAM_BADGE_MEMBER_PRIORITY_FALLBACK;

    let leaderPriority = Number.isFinite(modPriority)
      ? Math.floor(modPriority) - 1
      : Number.isFinite(adminPriority)
        ? Math.floor(adminPriority) - 1
        : TEAM_BADGE_LEADER_PRIORITY_FALLBACK;
    if (leaderPriority <= safeOtherPriority) {
      leaderPriority = safeOtherPriority + 1;
    }
    if (Number.isFinite(modPriority) && leaderPriority > Math.floor(modPriority)) {
      leaderPriority = Math.floor(modPriority);
    }
    if (!Number.isFinite(modPriority) && Number.isFinite(adminPriority) && leaderPriority > Math.floor(adminPriority)) {
      leaderPriority = Math.floor(adminPriority);
    }

    let memberPriority = safeOtherPriority + 1;
    if (memberPriority >= leaderPriority) {
      memberPriority = Math.max(1, leaderPriority - 1);
    }

    return {
      leaderPriority: Number.isFinite(leaderPriority) ? Math.floor(leaderPriority) : TEAM_BADGE_LEADER_PRIORITY_FALLBACK,
      memberPriority: Number.isFinite(memberPriority) ? Math.floor(memberPriority) : TEAM_BADGE_MEMBER_PRIORITY_FALLBACK
    };
  };

  const upsertTeamRoleBadge = async ({ teamId, teamName, role, dbGetFn = dbGet, dbRunFn = dbRun }) => {
    const safeTeamId = Number(teamId);
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0) return 0;

    const safeRole = (role || "").toString().trim().toLowerCase() === "leader" ? "leader" : "member";
    const safeTeamName = (teamName || "").toString().trim() || "Nhóm dịch";
    const code = buildTeamBadgeCode(safeTeamId, safeRole);
    if (!code) return 0;

    const now = Date.now();
    const label = safeRole === "leader" ? `Leader ${safeTeamName}` : safeTeamName;
    const color = safeRole === "leader" ? TEAM_BADGE_LEADER_COLOR : TEAM_BADGE_MEMBER_COLOR;
    const priorities = await resolveTeamBadgePriority(dbGetFn);
    const priority = safeRole === "leader" ? priorities.leaderPriority : priorities.memberPriority;

    const result = await dbRunFn(
      `
        INSERT INTO badges (
          code,
          label,
          color,
          priority,
          can_access_admin,
          can_delete_any_comment,
          can_comment,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, false, false, true, ?, ?)
        ON CONFLICT (code)
        DO UPDATE SET
          label = EXCLUDED.label,
          color = EXCLUDED.color,
          priority = EXCLUDED.priority,
          can_access_admin = false,
          can_delete_any_comment = false,
          can_comment = true,
          updated_at = EXCLUDED.updated_at
        RETURNING id
      `,
      [code, label, color, priority, now, now]
    );

    const id = result && Array.isArray(result.rows) && result.rows[0] ? Number(result.rows[0].id) : 0;
    if (Number.isFinite(id) && id > 0) {
      return Math.floor(id);
    }

    const row = await dbGetFn("SELECT id FROM badges WHERE lower(code) = lower(?) LIMIT 1", [code]);
    const fallbackId = row && row.id != null ? Number(row.id) : 0;
    return Number.isFinite(fallbackId) && fallbackId > 0 ? Math.floor(fallbackId) : 0;
  };

  const clearTeamBadgesForUser = async ({ teamId, userId, dbRunFn = dbRun }) => {
    const safeTeamId = Number(teamId);
    const safeUserId = (userId || "").toString().trim();
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0 || !safeUserId) return;

    const leaderCode = buildTeamBadgeCode(safeTeamId, "leader");
    const memberCode = buildTeamBadgeCode(safeTeamId, "member");
    if (!leaderCode || !memberCode) return;

    await dbRunFn(
      `
        DELETE FROM user_badges ub
        USING badges b
        WHERE ub.badge_id = b.id
          AND ub.user_id = ?
          AND (lower(b.code) = lower(?) OR lower(b.code) = lower(?))
      `,
      [safeUserId, leaderCode, memberCode]
    );
  };

  const syncTeamBadgeForMember = async ({
    teamId,
    teamName,
    userId,
    role,
    isApproved,
    dbGetFn = dbGet,
    dbRunFn = dbRun
  }) => {
    const safeTeamId = Number(teamId);
    const safeUserId = (userId || "").toString().trim();
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0 || !safeUserId) return;

    await clearTeamBadgesForUser({ teamId: safeTeamId, userId: safeUserId, dbRunFn });
    if (!isApproved) return;

    const safeRole = (role || "").toString().trim().toLowerCase() === "leader" ? "leader" : "member";
    const badgeId = await upsertTeamRoleBadge({
      teamId: safeTeamId,
      teamName,
      role: safeRole,
      dbGetFn,
      dbRunFn
    });
    if (!badgeId) return;

    await dbRunFn(
      "INSERT INTO user_badges (user_id, badge_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      [safeUserId, badgeId, Date.now()]
    );

    const safeTeamName = (teamName || "").toString().trim() || "Member";
    const roleLabel = safeRole === "leader" ? `Leader ${safeTeamName}` : safeTeamName;
    await dbRunFn("UPDATE users SET badge = ? WHERE id = ?", [roleLabel, safeUserId]);
  };

  const ensureSingleApprovedLeaderForTeam = async ({
    teamId,
    preferredLeaderUserId = "",
    actorUserId = "",
    teamName = "",
    dbAllFn = dbAll,
    dbGetFn = dbGet,
    dbRunFn = dbRun
  }) => {
    const safeTeamId = Number(teamId);
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0) {
      return { leaderUserId: "", demotedUserIds: [] };
    }

    const preferredUserId = (preferredLeaderUserId || "").toString().trim();
    const safeActorUserId = (actorUserId || "").toString().trim();
    const safeTeamName = (teamName || "").toString().trim();

    const leaderRows = await dbAllFn(
      `
        SELECT user_id, reviewed_at, requested_at
        FROM translation_team_members
        WHERE team_id = ?
          AND status = 'approved'
          AND role = 'leader'
        ORDER BY
          CASE WHEN ? <> '' AND user_id = ? THEN 0 ELSE 1 END ASC,
          COALESCE(reviewed_at, requested_at, 0) DESC,
          requested_at DESC,
          user_id ASC
      `,
      [Math.floor(safeTeamId), preferredUserId, preferredUserId]
    );

    const leaderUserIds = Array.from(
      new Set(
        (Array.isArray(leaderRows) ? leaderRows : [])
          .map((row) => (row && row.user_id ? String(row.user_id).trim() : ""))
          .filter(Boolean)
      )
    );

    if (!leaderUserIds.length) {
      return { leaderUserId: "", demotedUserIds: [] };
    }

    const keptLeaderUserId = leaderUserIds[0];
    const demotedUserIds = leaderUserIds.slice(1);
    if (!demotedUserIds.length) {
      return { leaderUserId: keptLeaderUserId, demotedUserIds: [] };
    }

    const now = Date.now();
    const reviewedByUserId = safeActorUserId || keptLeaderUserId;

    for (const demotedUserId of demotedUserIds) {
      await dbRunFn(
        `
          UPDATE translation_team_members
          SET role = 'member', reviewed_at = ?, reviewed_by_user_id = ?
          WHERE team_id = ?
            AND user_id = ?
            AND status = 'approved'
            AND role = 'leader'
        `,
        [now, reviewedByUserId, Math.floor(safeTeamId), demotedUserId]
      );

      await syncTeamBadgeForMember({
        teamId: Math.floor(safeTeamId),
        teamName: safeTeamName,
        userId: demotedUserId,
        role: "member",
        isApproved: true,
        dbGetFn,
        dbRunFn
      });
    }

    await syncTeamBadgeForMember({
      teamId: Math.floor(safeTeamId),
      teamName: safeTeamName,
      userId: keptLeaderUserId,
      role: "leader",
      isApproved: true,
      dbGetFn,
      dbRunFn
    });

    return { leaderUserId: keptLeaderUserId, demotedUserIds };
  };

  const listTeamPendingJoinRequests = async ({ teamId, dbAllFn = dbAll }) => {
    const safeTeamId = Number(teamId);
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0) return [];

    return dbAllFn(
      `
        SELECT
          tm.user_id,
          tm.requested_at,
          u.username,
          u.display_name,
          u.avatar_url
        FROM translation_team_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = ?
          AND tm.status = 'pending'
        ORDER BY tm.requested_at ASC, tm.user_id ASC
      `,
      [Math.floor(safeTeamId)]
    );
  };

  const reviewTeamJoinRequest = async ({ reviewerUserId, teamId, targetUserId, action }) => {
    const safeReviewerUserId = (reviewerUserId || "").toString().trim();
    const safeTargetUserId = (targetUserId || "").toString().trim();
    const safeTeamId = Number(teamId);
    const actionValue = (action || "").toString().trim().toLowerCase();
    const nextStatus = actionValue === "approve" ? "approved" : actionValue === "reject" ? "rejected" : "";

    if (!safeReviewerUserId || !safeTargetUserId || !Number.isFinite(safeTeamId) || safeTeamId <= 0 || !nextStatus) {
      return { ok: false, statusCode: 400, error: "Dữ liệu không hợp lệ.", reason: "invalid" };
    }

    const result = await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
      const manageActor = await resolveTeamManagementActor({
        userId: safeReviewerUserId,
        teamId: Math.floor(safeTeamId),
        dbGetFn: txGet
      });
      if (!manageActor || manageActor.ok !== true) {
        return (
          manageActor ||
          {
            ok: false,
            statusCode: 403,
            error: "Bạn không có quyền duyệt yêu cầu này.",
            reason: "forbidden"
          }
        );
      }

      const requestRow = await txGet(
        `
          SELECT team_id, user_id, role
          FROM translation_team_members
          WHERE team_id = ? AND user_id = ? AND status = 'pending'
          LIMIT 1
        `,
        [Math.floor(safeTeamId), safeTargetUserId]
      );
      if (!requestRow) {
        return {
          ok: false,
          statusCode: 404,
          error: "Không tìm thấy yêu cầu đang chờ duyệt.",
          reason: "notfound"
        };
      }

      const now = Date.now();
      const approvedRole = "member";
      await txRun(
        `
          UPDATE translation_team_members
          SET status = ?, role = ?, reviewed_at = ?, reviewed_by_user_id = ?
          WHERE team_id = ? AND user_id = ?
        `,
        [nextStatus, approvedRole, now, safeReviewerUserId, Math.floor(safeTeamId), safeTargetUserId]
      );

      await syncTeamBadgeForMember({
        teamId: Math.floor(safeTeamId),
        teamName: manageActor.teamName || "",
        userId: safeTargetUserId,
        role: approvedRole,
        isApproved: nextStatus === "approved",
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      await ensureSingleApprovedLeaderForTeam({
        teamId: Math.floor(safeTeamId),
        preferredLeaderUserId: safeReviewerUserId,
        actorUserId: safeReviewerUserId,
        teamName: manageActor.teamName || "",
        dbAllFn: txAll,
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      const safeTeamName = (manageActor.teamName || "").toString().trim() || "nhóm dịch";
      const notificationType =
        nextStatus === "approved" ? NOTIFICATION_TYPE_TEAM_JOIN_APPROVED : NOTIFICATION_TYPE_TEAM_JOIN_REJECTED;
      const notificationPreview =
        nextStatus === "approved"
          ? `Yêu cầu tham gia ${safeTeamName} của bạn đã được duyệt.`
          : `Yêu cầu tham gia ${safeTeamName} của bạn đã bị từ chối.`;

      const notificationResult = await txRun(
        `
          INSERT INTO notifications (
            user_id,
            type,
            actor_user_id,
            team_id,
            content_preview,
            is_read,
            created_at,
            read_at
          )
          VALUES (?, ?, ?, ?, ?, false, ?, NULL)
        `,
        [safeTargetUserId, notificationType, manageActor.actorUserId, Math.floor(safeTeamId), notificationPreview, now]
      );

      return {
        ok: true,
        status: nextStatus,
        reason: nextStatus,
        teamId: Math.floor(safeTeamId),
        teamSlug: (manageActor.teamSlug || "").toString().trim(),
        notifyUserId: safeTargetUserId,
        notificationCreated: Boolean(notificationResult && notificationResult.changes)
      };
    });

    if (!result || result.ok !== true) {
      return result || { ok: false, statusCode: 500, error: "Không thể xử lý yêu cầu.", reason: "error" };
    }

    if (result.notificationCreated && result.notifyUserId) {
      publishNotificationStreamUpdate({ userId: result.notifyUserId, reason: "created" }).catch(() => null);
    }

    return result;
  };

  const kickTeamMember = async ({ actorUserId, teamId, targetUserId }) => {
    const safeActorUserId = (actorUserId || "").toString().trim();
    const safeTargetUserId = (targetUserId || "").toString().trim();
    const safeTeamId = Number(teamId);

    if (!safeActorUserId || !safeTargetUserId || !Number.isFinite(safeTeamId) || safeTeamId <= 0) {
      return { ok: false, statusCode: 400, error: "Dữ liệu không hợp lệ.", reason: "invalid" };
    }

    if (safeActorUserId === safeTargetUserId) {
      return {
        ok: false,
        statusCode: 400,
        error: "Bạn không thể tự kick chính mình.",
        reason: "invalid"
      };
    }

    const result = await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
      const manageActor = await resolveTeamManagementActor({
        userId: safeActorUserId,
        teamId: Math.floor(safeTeamId),
        dbGetFn: txGet
      });
      if (!manageActor || manageActor.ok !== true) {
        return (
          manageActor ||
          {
            ok: false,
            statusCode: 403,
            error: "Bạn không có quyền kick thành viên của nhóm này.",
            reason: "forbidden"
          }
        );
      }

      const memberRow = await txGet(
        `
          SELECT team_id, user_id, role, status
          FROM translation_team_members
          WHERE team_id = ? AND user_id = ?
          LIMIT 1
        `,
        [Math.floor(safeTeamId), safeTargetUserId]
      );

      const memberRole = (memberRow && memberRow.role ? String(memberRow.role) : "").trim().toLowerCase();
      const memberStatus = (memberRow && memberRow.status ? String(memberRow.status) : "").trim().toLowerCase();
      if (!memberRow || memberRole !== "member" || memberStatus !== "approved") {
        return {
          ok: false,
          statusCode: 404,
          error: "Không tìm thấy thành viên hợp lệ để kick.",
          reason: "notfound"
        };
      }

      await txRun(
        "DELETE FROM translation_team_members WHERE team_id = ? AND user_id = ?",
        [Math.floor(safeTeamId), safeTargetUserId]
      );

      await syncTeamBadgeForMember({
        teamId: Math.floor(safeTeamId),
        teamName: manageActor.teamName || "",
        userId: safeTargetUserId,
        role: "member",
        isApproved: false,
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      const now = Date.now();
      const safeTeamName = (manageActor.teamName || "").toString().trim() || "nhóm dịch";
      const notificationResult = await txRun(
        `
          INSERT INTO notifications (
            user_id,
            type,
            actor_user_id,
            team_id,
            content_preview,
            is_read,
            created_at,
            read_at
          )
          VALUES (?, ?, ?, ?, ?, false, ?, NULL)
        `,
        [
          safeTargetUserId,
          NOTIFICATION_TYPE_TEAM_MEMBER_KICKED,
          manageActor.actorUserId,
          Math.floor(safeTeamId),
          `Bạn đã bị loại khỏi nhóm ${safeTeamName}.`,
          now
        ]
      );

      return {
        ok: true,
        reason: "kicked",
        teamId: Math.floor(safeTeamId),
        teamSlug: (manageActor.teamSlug || "").toString().trim(),
        notifyUserId: safeTargetUserId,
        notificationCreated: Boolean(notificationResult && notificationResult.changes)
      };
    });

    if (!result || result.ok !== true) {
      return result || { ok: false, statusCode: 500, error: "Không thể kick thành viên.", reason: "error" };
    }

    if (result.notificationCreated && result.notifyUserId) {
      publishNotificationStreamUpdate({ userId: result.notifyUserId, reason: "created" }).catch(() => null);
    }

    return result;
  };

  const leaveTeamAsMember = async ({ userId, teamId }) => {
    const safeUserId = (userId || "").toString().trim();
    const safeTeamId = Number(teamId);

    if (!safeUserId || !Number.isFinite(safeTeamId) || safeTeamId <= 0) {
      return { ok: false, statusCode: 400, error: "Dữ liệu không hợp lệ.", reason: "invalid" };
    }

    const result = await withTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
      const teamRow = await getApprovedTeamById({ teamId: Math.floor(safeTeamId), dbGetFn: txGet });
      if (!teamRow) {
        return {
          ok: false,
          statusCode: 404,
          error: "Không tìm thấy nhóm dịch.",
          reason: "leave_notfound"
        };
      }

      const membershipRow = await txGet(
        `
          SELECT role, status
          FROM translation_team_members
          WHERE team_id = ?
            AND user_id = ?
          LIMIT 1
        `,
        [Math.floor(safeTeamId), safeUserId]
      );

      const memberRole = (membershipRow && membershipRow.role ? String(membershipRow.role) : "").trim().toLowerCase();
      const memberStatus =
        (membershipRow && membershipRow.status ? String(membershipRow.status) : "").trim().toLowerCase();
      if (!membershipRow || memberRole !== "member" || memberStatus !== "approved") {
        return {
          ok: false,
          statusCode: 403,
          error: "Chỉ member đã được duyệt mới có thể rời nhóm.",
          reason: "leave_forbidden"
        };
      }

      await txRun(
        "DELETE FROM translation_team_members WHERE team_id = ? AND user_id = ? AND role = 'member' AND status = 'approved'",
        [Math.floor(safeTeamId), safeUserId]
      );

      await syncTeamBadgeForMember({
        teamId: Math.floor(safeTeamId),
        teamName: (teamRow.team_name || "").toString().trim(),
        userId: safeUserId,
        role: "member",
        isApproved: false,
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      return {
        ok: true,
        reason: "left",
        teamId: Math.floor(Number(teamRow.team_id) || safeTeamId),
        teamSlug: (teamRow.team_slug || "").toString().trim()
      };
    });

    if (!result || result.ok !== true) {
      return result || { ok: false, statusCode: 500, error: "Không thể rời nhóm dịch.", reason: "error" };
    }

    return result;
  };

  const promoteTeamMemberAsLeader = async ({ actorUserId, teamId, targetUserId }) => {
    const safeActorUserId = (actorUserId || "").toString().trim();
    const safeTargetUserId = (targetUserId || "").toString().trim();
    const safeTeamId = Number(teamId);

    if (!safeActorUserId || !safeTargetUserId || !Number.isFinite(safeTeamId) || safeTeamId <= 0) {
      return { ok: false, statusCode: 400, error: "Dữ liệu không hợp lệ.", reason: "invalid" };
    }

    if (safeActorUserId === safeTargetUserId) {
      return {
        ok: false,
        statusCode: 400,
        error: "Bạn không thể tự bổ nhiệm chính mình.",
        reason: "invalid"
      };
    }

    const result = await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
      const manageActor = await resolveTeamManagementActor({
        userId: safeActorUserId,
        teamId: Math.floor(safeTeamId),
        dbGetFn: txGet
      });
      if (!manageActor || manageActor.ok !== true) {
        return (
          manageActor ||
          {
            ok: false,
            statusCode: 403,
            error: "Bạn không có quyền bổ nhiệm leader trong nhóm này.",
            reason: "forbidden"
          }
        );
      }

      const memberRow = await txGet(
        `
          SELECT team_id, user_id, role, status
          FROM translation_team_members
          WHERE team_id = ? AND user_id = ?
          LIMIT 1
        `,
        [Math.floor(safeTeamId), safeTargetUserId]
      );

      const memberRole = (memberRow && memberRow.role ? String(memberRow.role) : "").trim().toLowerCase();
      const memberStatus = (memberRow && memberRow.status ? String(memberRow.status) : "").trim().toLowerCase();
      if (!memberRow || memberRole !== "member" || memberStatus !== "approved") {
        return {
          ok: false,
          statusCode: 404,
          error: "Không tìm thấy thành viên hợp lệ để bổ nhiệm leader.",
          reason: "notfound"
        };
      }

      const now = Date.now();
      const demotedLeaderRows = await txAll(
        `
          SELECT user_id
          FROM translation_team_members
          WHERE team_id = ?
            AND role = 'leader'
            AND status = 'approved'
            AND user_id <> ?
        `,
        [Math.floor(safeTeamId), safeTargetUserId]
      );

      await txRun(
        `
          UPDATE translation_team_members
          SET role = 'member', reviewed_at = ?, reviewed_by_user_id = ?
          WHERE team_id = ?
            AND role = 'leader'
            AND status = 'approved'
            AND user_id <> ?
        `,
        [now, safeActorUserId, Math.floor(safeTeamId), safeTargetUserId]
      );

      for (const row of demotedLeaderRows) {
        const demotedUserId = row && row.user_id ? String(row.user_id).trim() : "";
        if (!demotedUserId) continue;
        await syncTeamBadgeForMember({
          teamId: Math.floor(safeTeamId),
          teamName: manageActor.teamName || "",
          userId: demotedUserId,
          role: "member",
          isApproved: true,
          dbGetFn: txGet,
          dbRunFn: txRun
        });
      }

      await txRun(
        `
          UPDATE translation_team_members
          SET role = 'leader', reviewed_at = ?, reviewed_by_user_id = ?
          WHERE team_id = ? AND user_id = ?
        `,
        [now, safeActorUserId, Math.floor(safeTeamId), safeTargetUserId]
      );

      await syncTeamBadgeForMember({
        teamId: Math.floor(safeTeamId),
        teamName: manageActor.teamName || "",
        userId: safeTargetUserId,
        role: "leader",
        isApproved: true,
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      await ensureSingleApprovedLeaderForTeam({
        teamId: Math.floor(safeTeamId),
        preferredLeaderUserId: safeTargetUserId,
        actorUserId: safeActorUserId,
        teamName: manageActor.teamName || "",
        dbAllFn: txAll,
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      const safeTeamName = (manageActor.teamName || "").toString().trim() || "nhóm dịch";
      const notificationResult = await txRun(
        `
          INSERT INTO notifications (
            user_id,
            type,
            actor_user_id,
            team_id,
            content_preview,
            is_read,
            created_at,
            read_at
          )
          VALUES (?, ?, ?, ?, ?, false, ?, NULL)
        `,
        [
          safeTargetUserId,
          NOTIFICATION_TYPE_TEAM_MEMBER_PROMOTED_LEADER,
          manageActor.actorUserId,
          Math.floor(safeTeamId),
          `Bạn đã được bổ nhiệm làm leader của nhóm ${safeTeamName}.`,
          now
        ]
      );

      return {
        ok: true,
        reason: "promoted",
        teamId: Math.floor(safeTeamId),
        teamSlug: (manageActor.teamSlug || "").toString().trim(),
        notifyUserId: safeTargetUserId,
        notificationCreated: Boolean(notificationResult && notificationResult.changes)
      };
    });

    if (!result || result.ok !== true) {
      return result || { ok: false, statusCode: 500, error: "Không thể bổ nhiệm leader.", reason: "error" };
    }

    if (result.notificationCreated && result.notifyUserId) {
      publishNotificationStreamUpdate({ userId: result.notifyUserId, reason: "created" }).catch(() => null);
    }

    return result;
  };

  const updateTeamMemberPermissions = async ({ actorUserId, teamId, targetUserId, permissions }) => {
    const safeActorUserId = (actorUserId || "").toString().trim();
    const safeTargetUserId = (targetUserId || "").toString().trim();
    const safeTeamId = Number(teamId);

    if (!safeActorUserId || !safeTargetUserId || !Number.isFinite(safeTeamId) || safeTeamId <= 0) {
      return { ok: false, statusCode: 400, error: "Dữ liệu không hợp lệ.", reason: "invalid" };
    }

    if (safeActorUserId === safeTargetUserId) {
      return {
        ok: false,
        statusCode: 400,
        error: "Bạn không thể tự cấp quyền cho chính mình.",
        reason: "invalid"
      };
    }

    if (!permissions || typeof permissions !== "object") {
      return { ok: false, statusCode: 400, error: "Dữ liệu quyền không hợp lệ.", reason: "invalid" };
    }

    const normalizedPermissions = {
      canAddManga: Boolean(permissions.canAddManga),
      canEditManga: Boolean(permissions.canEditManga),
      canDeleteManga: Boolean(permissions.canDeleteManga),
      canAddChapter: Boolean(permissions.canAddChapter),
      canEditChapter: Boolean(permissions.canEditChapter),
      canDeleteChapter: Boolean(permissions.canDeleteChapter)
    };

    const result = await withTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
      const manageActor = await resolveTeamManagementActor({
        userId: safeActorUserId,
        teamId: Math.floor(safeTeamId),
        dbGetFn: txGet
      });
      if (!manageActor || manageActor.ok !== true) {
        return (
          manageActor ||
          {
            ok: false,
            statusCode: 403,
            error: "Bạn không có quyền cập nhật phân quyền của nhóm này.",
            reason: "forbidden"
          }
        );
      }

      const memberRow = await txGet(
        `
          SELECT team_id, user_id, role, status
          FROM translation_team_members
          WHERE team_id = ?
            AND user_id = ?
          LIMIT 1
        `,
        [Math.floor(safeTeamId), safeTargetUserId]
      );

      const memberRole = (memberRow && memberRow.role ? String(memberRow.role) : "").trim().toLowerCase();
      const memberStatus = (memberRow && memberRow.status ? String(memberRow.status) : "").trim().toLowerCase();
      if (!memberRow || memberRole !== "member" || memberStatus !== "approved") {
        return {
          ok: false,
          statusCode: 404,
          error: "Không tìm thấy member hợp lệ để cấp quyền.",
          reason: "notfound"
        };
      }

      const updateResult = await txRun(
        `
          UPDATE translation_team_members
          SET
            can_add_manga = ?,
            can_edit_manga = ?,
            can_delete_manga = ?,
            can_add_chapter = ?,
            can_edit_chapter = ?,
            can_delete_chapter = ?,
            reviewed_at = ?,
            reviewed_by_user_id = ?
          WHERE team_id = ?
            AND user_id = ?
            AND role = 'member'
            AND status = 'approved'
        `,
        [
          normalizedPermissions.canAddManga,
          normalizedPermissions.canEditManga,
          normalizedPermissions.canDeleteManga,
          normalizedPermissions.canAddChapter,
          normalizedPermissions.canEditChapter,
          normalizedPermissions.canDeleteChapter,
          Date.now(),
          safeActorUserId,
          Math.floor(safeTeamId),
          safeTargetUserId
        ]
      );
      if (!updateResult || !updateResult.changes) {
        return {
          ok: false,
          statusCode: 404,
          error: "Không tìm thấy member hợp lệ để cấp quyền.",
          reason: "notfound"
        };
      }

      return {
        ok: true,
        reason: "permissions_updated",
        teamId: Math.floor(safeTeamId),
        teamSlug: (manageActor.teamSlug || "").toString().trim(),
        targetUserId: safeTargetUserId,
        permissions: normalizedPermissions
      };
    });

    if (!result || result.ok !== true) {
      return result || { ok: false, statusCode: 500, error: "Không thể cập nhật phân quyền.", reason: "error" };
    }

    return result;
  };

  const CHAT_STREAM_HEARTBEAT_MS = 25000;
  const chatStreamClientsByUserId = new Map();

  const sendPrivateFeatureNotFound = (req, res) => {
    const acceptHeader = (req.get("accept") || "").toString().toLowerCase();
    if (acceptHeader.includes("text/event-stream")) {
      return res.status(404).end();
    }

    if (wantsJson(req)) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy." });
    }

    return res.status(404).render("not-found", {
      title: "Không tìm thấy",
      team,
      seo: buildSeoPayload(req, {
        title: "Không tìm thấy",
        description: "Trang bạn yêu cầu không tồn tại trên BFANG Team.",
        robots: SEO_ROBOTS_NOINDEX,
        canonicalPath: ensureLeadingSlash(req.path || "/")
      })
    });
  };

  const requirePrivateFeatureAuthUser = async (req, res) => {
    if (isServerSessionVersionMismatch(req)) {
      clearAllAuthSessionState(req);
      sendPrivateFeatureNotFound(req, res);
      return null;
    }

    const authUserId =
      (req && req.session && req.session.authUserId ? req.session.authUserId : "").toString().trim();
    if (!authUserId) {
      sendPrivateFeatureNotFound(req, res);
      return null;
    }

    const user = await loadSessionUserById(authUserId);
    if (!user || !user.id) {
      clearUserAuthSession(req);
      sendPrivateFeatureNotFound(req, res);
      return null;
    }

    if (req && req.session) {
      req.session.sessionVersion = serverSessionVersion;
    }
    return user;
  };

  const resolveOptionalPrivateFeatureAuthUser = async (req) => {
    if (isServerSessionVersionMismatch(req)) {
      clearAllAuthSessionState(req);
      return null;
    }

    const authUserId =
      (req && req.session && req.session.authUserId ? req.session.authUserId : "").toString().trim();
    if (!authUserId) return null;

    const user = await loadSessionUserById(authUserId);
    if (!user || !user.id) {
      clearUserAuthSession(req);
      return null;
    }

    if (req && req.session) {
      req.session.sessionVersion = serverSessionVersion;
    }
    return user;
  };

  const writeChatStreamEvent = (response, eventName, payload) => {
    if (!response || response.writableEnded || response.destroyed) return false;
    const name = (eventName || "").toString().trim();
    const body = payload && typeof payload === "object" ? payload : {};
    const data = JSON.stringify(body);

    try {
      if (name) response.write(`event: ${name}\n`);
      response.write(`data: ${data}\n\n`);
      if (typeof response.flush === "function") {
        response.flush();
      }
      return true;
    } catch (_err) {
      return false;
    }
  };

  const addChatStreamClient = (userId, response) => {
    const safeUserId = (userId || "").toString().trim();
    if (!safeUserId || !response) return "";
    let bucket = chatStreamClientsByUserId.get(safeUserId);
    if (!bucket) {
      bucket = new Map();
      chatStreamClientsByUserId.set(safeUserId, bucket);
    }
    const clientId = crypto.randomUUID();
    bucket.set(clientId, { response });
    return clientId;
  };

  const removeChatStreamClient = (userId, clientId) => {
    const safeUserId = (userId || "").toString().trim();
    const safeClientId = (clientId || "").toString().trim();
    if (!safeUserId || !safeClientId) return;
    const bucket = chatStreamClientsByUserId.get(safeUserId);
    if (!bucket) return;

    bucket.delete(safeClientId);
    if (!bucket.size) {
      chatStreamClientsByUserId.delete(safeUserId);
    }
  };

  const publishChatStreamUpdate = ({ userIds, payload }) => {
    const ids = Array.from(
      new Set(
        (Array.isArray(userIds) ? userIds : [])
          .map((value) => (value == null ? "" : String(value)).trim())
          .filter(Boolean)
      )
    );
    if (!ids.length) return;

    ids.forEach((userId) => {
      const bucket = chatStreamClientsByUserId.get(userId);
      if (!bucket || !bucket.size) return;

      const staleClientIds = [];
      bucket.forEach((client, clientId) => {
        const ok = writeChatStreamEvent(client.response, "chat", payload || {});
        if (!ok) staleClientIds.push(clientId);
      });

      staleClientIds.forEach((clientId) => {
        removeChatStreamClient(userId, clientId);
      });
    });
  };

  const getUnreadChatMessageCount = async (userId) => {
    const safeUserId = (userId || "").toString().trim();
    if (!safeUserId) return 0;

    const row = await dbGet(
      `
        SELECT COUNT(*) as count
        FROM chat_messages m
        JOIN chat_thread_members tm ON tm.thread_id = m.thread_id
        WHERE tm.user_id = ?
          AND m.sender_user_id <> ?
          AND (tm.last_read_message_id IS NULL OR m.id > tm.last_read_message_id)
      `,
      [safeUserId, safeUserId]
    );

    const count = row ? Number(row.count) : 0;
    if (!Number.isFinite(count) || count <= 0) return 0;
    return Math.floor(count);
  };

app.get(
  "/auth/session",
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

    if (isServerSessionVersionMismatch(req)) {
      clearAllAuthSessionState(req);
      return res.json({ ok: true, session: null, reason: "server_restart" });
    }

    const authUserId =
      (req && req.session && req.session.authUserId ? req.session.authUserId : "").toString().trim();
    if (!authUserId) {
      return res.json({ ok: true, session: null });
    }

    const user = await loadSessionUserById(authUserId);
    if (!user || !user.id) {
      clearUserAuthSession(req);
      return res.json({ ok: true, session: null });
    }

    req.session.sessionVersion = serverSessionVersion;
    return res.json({
      ok: true,
      session: {
        user,
        access_token: `session_${user.id}`,
        expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60
      }
    });
  })
);

app.post(
  "/auth/logout",
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

    if (req && req.session && typeof req.session.regenerate === "function") {
      await regenerateSession(req).catch(() => null);
    }
    if (req && req.session) {
      req.session.sessionVersion = serverSessionVersion;
    }
    return res.json({ ok: true });
  })
);

app.post(
  "/auth/profile",
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;

    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ error: { message: "Phiên đăng nhập không hợp lệ." } });
    }

    const payload =
      req && req.body && typeof req.body.data === "object" && req.body.data ? req.body.data : {};

    const currentRow = await ensureUserRowFromAuthUser(user);
    const identityRows = await listAuthIdentityRowsForUser(userId);
    const identityList = identityRows.map(mapAuthIdentityRowToUserIdentity).filter(Boolean);
    const baseUser = {
      ...user,
      id: userId,
      identities: identityList
    };

    const now = Date.now();
    const hasDisplayName = hasOwnObjectKey(payload, "display_name");
    const hasFacebook = hasOwnObjectKey(payload, "facebook_url");
    const hasDiscord = hasOwnObjectKey(payload, "discord_handle") || hasOwnObjectKey(payload, "discord_url");
    const hasBio = hasOwnObjectKey(payload, "bio");
    const hasAvatarCustom = hasOwnObjectKey(payload, "avatar_url_custom");

    const displayName = hasDisplayName
      ? normalizeProfileDisplayName(payload.display_name)
      : normalizeProfileDisplayName(currentRow && currentRow.display_name ? currentRow.display_name : "");
    const facebookUrl = hasFacebook
      ? normalizeProfileFacebook(payload.facebook_url)
      : normalizeProfileFacebook(currentRow && currentRow.facebook_url ? currentRow.facebook_url : "");
    const discordHandle = hasDiscord
      ? normalizeProfileDiscord(payload.discord_handle || payload.discord_url)
      : normalizeProfileDiscord(currentRow && currentRow.discord_handle ? currentRow.discord_handle : "");
    const bio = hasBio
      ? normalizeProfileBio(payload.bio)
      : normalizeProfileBio(currentRow && currentRow.bio ? currentRow.bio : "");

    let avatarUrl = normalizeAvatarUrl(currentRow && currentRow.avatar_url ? currentRow.avatar_url : "");
    if (hasAvatarCustom) {
      const requestedCustomAvatar = normalizeAvatarUrl(payload.avatar_url_custom);
      if (requestedCustomAvatar && isUploadedAvatarUrl(requestedCustomAvatar)) {
        avatarUrl = requestedCustomAvatar;
      } else {
        avatarUrl = buildAvatarUrlFromAuthUser(
          {
            ...baseUser,
            user_metadata: {
              ...(baseUser && typeof baseUser.user_metadata === "object" ? baseUser.user_metadata : {}),
              avatar_url_custom: ""
            }
          },
          currentRow && currentRow.avatar_url ? currentRow.avatar_url : ""
        );
      }
    }

    await dbRun(
      "UPDATE users SET display_name = ?, avatar_url = ?, facebook_url = ?, discord_handle = ?, bio = ?, updated_at = ? WHERE id = ?",
      [displayName, avatarUrl, facebookUrl, discordHandle, bio, now, userId]
    );

    const updatedRow = await dbGet(
      "SELECT id, email, username, display_name, avatar_url, facebook_url, discord_handle, bio, badge, created_at, updated_at FROM users WHERE id = ?",
      [userId]
    );
    const sessionUser = buildSessionUserFromUserRow(updatedRow, identityRows);
    if (sessionUser) {
      setAuthSessionUser(req, sessionUser, req && req.session ? req.session.authProvider : "");
    }

    return res.json({
      data: {
        user: sessionUser || null
      },
      error: null
    });
  })
);

app.get("/auth/google", (req, res, next) => {
  if (!isOauthProviderEnabled("google")) {
    return res.status(503).send("Google OAuth chưa được cấu hình.");
  }

  req.session.authNextPath = normalizeNextPath(req.query.next || "/");
  const callbackURL = buildOAuthCallbackUrl(req, "google");
  if (!callbackURL) {
    return res.status(500).send("Không xác định được callback URL cho Google OAuth.");
  }

  return passport.authenticate(AUTH_GOOGLE_STRATEGY, {
    callbackURL,
    session: false,
    scope: ["profile", "email"],
    prompt: "select_account"
  })(req, res, next);
});

app.get("/auth/google/callback", (req, res, next) => {
  if (!isOauthProviderEnabled("google")) {
    return res.redirect("/");
  }
  const callbackURL = buildOAuthCallbackUrl(req, "google");
  if (!callbackURL) {
    return res.redirect("/");
  }
  return passport.authenticate(AUTH_GOOGLE_STRATEGY, {
    callbackURL,
    session: false,
    failureRedirect: "/?auth=failed"
  })(req, res, next);
}, asyncHandler(async (req, res) => {
  const nextPath = readAuthNextPath(req);
  const profile = req && req.user ? req.user : null;
  if (!profile) {
    return res.redirect(nextPath || "/");
  }
  try {
    const resolved = await resolveOrCreateUserFromOauthProfile(profile);
    const resolvedUserId =
      resolved && resolved.sessionUser && resolved.sessionUser.id
        ? String(resolved.sessionUser.id).trim()
        : "";
    if (resolvedUserId) {
      const sessionUser = await loadSessionUserById(resolvedUserId);
      if (!sessionUser || !sessionUser.id) {
        await regenerateSession(req).catch(() => null);
        clearUserAuthSession(req);
      } else {
        await regenerateSession(req);
        setAuthSessionUser(req, sessionUser, resolved.provider);
      }
    }
  } catch (err) {
    console.warn("Google OAuth callback failed", err);
  }
  return res.redirect(nextPath || "/");
}));

app.get("/auth/discord", (req, res, next) => {
  if (!isOauthProviderEnabled("discord")) {
    return res.status(503).send("Discord OAuth chưa được cấu hình.");
  }

  req.session.authNextPath = normalizeNextPath(req.query.next || "/");
  const callbackURL = buildOAuthCallbackUrl(req, "discord");
  if (!callbackURL) {
    return res.status(500).send("Không xác định được callback URL cho Discord OAuth.");
  }

  return passport.authenticate(AUTH_DISCORD_STRATEGY, {
    callbackURL,
    session: false
  })(req, res, next);
});

app.get("/auth/discord/callback", (req, res, next) => {
  if (!isOauthProviderEnabled("discord")) {
    return res.redirect("/");
  }
  const callbackURL = buildOAuthCallbackUrl(req, "discord");
  if (!callbackURL) {
    return res.redirect("/");
  }
  return passport.authenticate(AUTH_DISCORD_STRATEGY, {
    callbackURL,
    session: false,
    failureRedirect: "/?auth=failed"
  })(req, res, next);
}, asyncHandler(async (req, res) => {
  const nextPath = readAuthNextPath(req);
  const profile = req && req.user ? req.user : null;
  if (!profile) {
    return res.redirect(nextPath || "/");
  }
  try {
    const resolved = await resolveOrCreateUserFromOauthProfile(profile);
    const resolvedUserId =
      resolved && resolved.sessionUser && resolved.sessionUser.id
        ? String(resolved.sessionUser.id).trim()
        : "";
    if (resolvedUserId) {
      const sessionUser = await loadSessionUserById(resolvedUserId);
      if (!sessionUser || !sessionUser.id) {
        await regenerateSession(req).catch(() => null);
        clearUserAuthSession(req);
      } else {
        await regenerateSession(req);
        setAuthSessionUser(req, sessionUser, resolved.provider);
      }
    }
  } catch (err) {
    console.warn("Discord OAuth callback failed", err);
  }
  return res.redirect(nextPath || "/");
}));

app.get("/auth/callback", (req, res) => {
  return res.redirect(normalizeNextPath(req.query.next || "/"));
});

app.get("/account", (req, res) => {
  res.render("account", {
    title: "Tài khoản",
    team,
    seo: buildSeoPayload(req, {
      title: "Tài khoản",
      description: "Quản lý thông tin hồ sơ và cài đặt tài khoản BFANG Team.",
      robots: SEO_ROBOTS_NOINDEX,
      canonicalPath: "/account",
      ogType: "profile"
    })
  });
});

app.get("/account/history", (req, res) => {
  res.render("reading-history", {
    title: "Lịch sử đọc",
    team,
    seo: buildSeoPayload(req, {
      title: "Lịch sử đọc",
      description: "Theo dõi truyện đang đọc dở và mở nhanh chương đang đọc.",
      robots: SEO_ROBOTS_NOINDEX,
      canonicalPath: "/account/history",
      ogType: "profile"
    })
  });
});

app.get("/account/saved", (req, res) => {
  res.render("bookmarks", {
    title: "Đã lưu",
    team,
    seo: buildSeoPayload(req, {
      title: "Đã lưu",
      description: "Theo dõi danh sách truyện bạn đã bookmark để đọc nhanh chương mới.",
      robots: SEO_ROBOTS_NOINDEX,
      canonicalPath: "/account/saved",
      ogType: "profile"
    })
  });
});

app.get(
  "/publish",
  asyncHandler(async (req, res) => {
    const user = await resolveOptionalPrivateFeatureAuthUser(req);
    const userId = user && user.id ? String(user.id).trim() : "";
    const canAccessAdminBadge = userId ? await hasAdminBadgeAccess(userId) : false;
    const membership = userId ? await getApprovedTeamMembership(userId) : null;

    const publishState = {
      requiresLogin: !userId,
      inTeam: false,
      roleLabel: "",
      team: null,
      canReviewRequests: false,
      pendingRequests: [],
      manageMangaUrl: ""
    };

    if (membership) {
      const teamId = Number(membership.team_id) || 0;
      const role = (membership.role || "member").toString().trim().toLowerCase();
      const memberPermissions = buildTeamMemberPermissionsFromRow({
        role,
        row: membership
      });
      const canReviewRequests = role === "leader" || canAccessAdminBadge;
      const canManageManga = canAccessAdminBadge || role === "leader" || hasAnyTeamManagePermission(memberPermissions);
      const pendingRows =
        canReviewRequests && teamId > 0
          ? await listTeamPendingJoinRequests({ teamId })
          : [];

      publishState.inTeam = true;
      publishState.team = {
        id: teamId,
        name: membership.team_name || "",
        slug: membership.team_slug || "",
        role
      };
      publishState.roleLabel = buildTeamRoleLabel({ role, teamName: membership.team_name || "" });
      publishState.canReviewRequests = canReviewRequests;
      publishState.pendingRequests = pendingRows.map((row) => ({
        userId: row.user_id,
        username: row.username || "",
        displayName: (row.display_name || "").toString().trim(),
        avatarUrl: normalizeAvatarUrl(row.avatar_url || ""),
        requestedAt: Number(row.requested_at) || 0
      }));
      publishState.manageMangaUrl =
        canManageManga && teamId > 0
          ? `/team/${encodeURIComponent(String(teamId))}/${encodeURIComponent(membership.team_slug || "")}/manage-manga`
          : "";
    }

    res.render("publish", {
      title: "Đăng truyện",
      team,
      publishState,
      headScripts: {
        notifications: true
      },
      seo: buildSeoPayload(req, {
        title: "Đăng truyện",
        description: "Tạo hoặc tham gia nhóm dịch để có quyền đăng truyện.",
        robots: SEO_ROBOTS_NOINDEX,
        canonicalPath: "/publish"
      })
    });
  })
);

const ensureChatThreadBetweenUsers = async ({ userId, targetUserId }) => {
  const actorUserId = String(userId || "").trim();
  const peerUserId = String(targetUserId || "").trim();
  if (!actorUserId || !peerUserId || actorUserId === peerUserId) {
    return { ok: false, statusCode: 400, error: "Không thể tạo cuộc trò chuyện." };
  }

  const targetRow = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [peerUserId]);
  if (!targetRow) {
    return { ok: false, statusCode: 404, error: "Không tìm thấy thành viên." };
  }

  const now = Date.now();
  const threadId = await withTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
    const existing = await txGet(
      `
        SELECT tm1.thread_id
        FROM chat_thread_members tm1
        JOIN chat_thread_members tm2 ON tm2.thread_id = tm1.thread_id
        WHERE tm1.user_id = ? AND tm2.user_id = ?
          AND (
            SELECT COUNT(*)
            FROM chat_thread_members all_members
            WHERE all_members.thread_id = tm1.thread_id
          ) = 2
        ORDER BY tm1.thread_id ASC
        LIMIT 1
      `,
      [actorUserId, peerUserId]
    );
    if (existing && existing.thread_id) {
      return Number(existing.thread_id);
    }

    const threadInsert = await txRun(
      "INSERT INTO chat_threads (created_at, updated_at, last_message_at) VALUES (?, ?, ?)",
      [now, now, now]
    );
    const createdThreadId = threadInsert && threadInsert.lastID ? Number(threadInsert.lastID) : 0;
    if (!createdThreadId) {
      throw new Error("Không thể tạo cuộc trò chuyện.");
    }

    await txRun(
      "INSERT INTO chat_thread_members (thread_id, user_id, joined_at, last_read_message_id) VALUES (?, ?, ?, NULL)",
      [createdThreadId, actorUserId, now]
    );
    await txRun(
      "INSERT INTO chat_thread_members (thread_id, user_id, joined_at, last_read_message_id) VALUES (?, ?, ?, NULL)",
      [createdThreadId, peerUserId, now]
    );
    return createdThreadId;
  });

  return { ok: true, threadId: Number(threadId) || 0 };
};

app.get(
  "/messages",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;
    const currentUserId = String(user.id || "").trim();

    const preferredTargetUserIdRaw = (req.query.with || "").toString().trim();
    const preferredTargetUserId =
      preferredTargetUserIdRaw && preferredTargetUserIdRaw.length <= 128 ? preferredTargetUserIdRaw : "";
    let preferredThreadId = 0;
    if (currentUserId && preferredTargetUserId && preferredTargetUserId !== currentUserId) {
      const ensuredThread = await ensureChatThreadBetweenUsers({
        userId: currentUserId,
        targetUserId: preferredTargetUserId
      }).catch(() => null);
      if (ensuredThread && ensuredThread.ok) {
        preferredThreadId = Number(ensuredThread.threadId) || 0;
      }
    }

    const threadSelectSql = `
      SELECT
        t.id,
        t.last_message_at,
        other.id as other_user_id,
        other.username as other_username,
        other.display_name as other_display_name,
        other.avatar_url as other_avatar_url,
        msg.id as last_message_id,
        msg.content as last_message_content,
        msg.created_at as last_message_created_at,
        msg.sender_user_id as last_message_sender_user_id
      FROM chat_thread_members self_member
      JOIN chat_threads t ON t.id = self_member.thread_id
      JOIN chat_thread_members other_member ON other_member.thread_id = t.id AND other_member.user_id <> self_member.user_id
      JOIN users other ON other.id = other_member.user_id
      LEFT JOIN LATERAL (
        SELECT id, content, created_at, sender_user_id
        FROM chat_messages m
        WHERE m.thread_id = t.id
        ORDER BY id DESC
        LIMIT 1
      ) msg ON true
      WHERE self_member.user_id = ?
    `;

    const threadRows = currentUserId
      ? await dbAll(
        `${threadSelectSql}
        ORDER BY COALESCE(msg.created_at, t.last_message_at) DESC, t.id DESC
        LIMIT 40`,
        [currentUserId]
      )
      : [];

    const mapThreadRow = (row) => ({
      id: Number(row.id),
      lastMessageAt: Number(row.last_message_created_at || row.last_message_at) || 0,
      lastMessageId: Number(row.last_message_id) || 0,
      lastMessageContent: (row.last_message_content || "").toString(),
      lastMessageSenderUserId: row.last_message_sender_user_id || "",
      otherUser: {
        id: row.other_user_id,
        username: row.other_username || "",
        displayName: (row.other_display_name || "").toString().trim(),
        avatarUrl: normalizeAvatarUrl(row.other_avatar_url || "")
      }
    });

    let initialThreads = threadRows.map(mapThreadRow);

    if (preferredThreadId > 0 && !initialThreads.some((thread) => Number(thread.id) === Number(preferredThreadId))) {
      const preferredRow = await dbGet(
        `${threadSelectSql}
        AND t.id = ?
        LIMIT 1`,
        [currentUserId, Math.floor(preferredThreadId)]
      );
      if (preferredRow) {
        initialThreads = [mapThreadRow(preferredRow), ...initialThreads];
      }
    }

    const initialThreadId =
      preferredThreadId > 0 && initialThreads.some((thread) => Number(thread.id) === Number(preferredThreadId))
        ? Number(preferredThreadId)
        : initialThreads.length
          ? Number(initialThreads[0].id) || 0
          : 0;
    let initialMessages = [];
    let initialMessagesHasMore = false;
    if (initialThreadId > 0) {
      const rows = await dbAll(
        `
          SELECT id, thread_id, sender_user_id, content, created_at
          FROM chat_messages
          WHERE thread_id = ?
          ORDER BY id DESC
          LIMIT 11
        `,
        [Math.floor(initialThreadId)]
      );
      initialMessagesHasMore = rows.length > 10;
      const pageRows = initialMessagesHasMore ? rows.slice(0, 10) : rows;
      initialMessages = pageRows
        .map((row) => ({
          id: Number(row.id),
          threadId: Number(row.thread_id),
          senderUserId: row.sender_user_id || "",
          content: (row.content || "").toString(),
          createdAt: Number(row.created_at) || 0
        }))
        .reverse();
    }

    res.render("messages", {
      title: "Tin nhắn",
      team,
      chatBootstrap: {
        currentUserId,
        initialThreads,
        initialThreadId,
        initialMessages,
        initialMessagesHasMore
      },
      headScripts: {
        notifications: false,
        messagesIndicator: false
      },
      seo: buildSeoPayload(req, {
        title: "Tin nhắn",
        description: "Nhắn tin với các thành viên trong cộng đồng BFANG Team.",
        robots: SEO_ROBOTS_NOINDEX,
        canonicalPath: "/messages"
      })
    });
  })
);

app.get(
  "/messages/unread-count",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    const userId = String(user.id || "").trim();
    if (!userId) {
      return sendPrivateFeatureNotFound(req, res);
    }

    const unreadCount = await getUnreadChatMessageCount(userId);
    return res.json({ ok: true, unreadCount });
  })
);

app.get(
  "/messages/stream",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;
    const userId = String(user.id || "").trim();
    if (!userId) {
      return sendPrivateFeatureNotFound(req, res);
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const clientId = addChatStreamClient(userId, res);
    writeChatStreamEvent(res, "ready", { ts: Date.now() });

    const heartbeat = setInterval(() => {
      const ok = writeChatStreamEvent(res, "heartbeat", { ts: Date.now() });
      if (!ok) {
        cleanup();
      }
    }, CHAT_STREAM_HEARTBEAT_MS);
    if (heartbeat && typeof heartbeat.unref === "function") {
      heartbeat.unref();
    }

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      removeChatStreamClient(userId, clientId);
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
  })
);

app.get(
  "/account/team-status",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }
    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }
    const canAccessAdminBadge = await hasAdminBadgeAccess(userId);

    const membership = await getApprovedTeamMembership(userId);
    if (!membership) {
      return res.json({ ok: true, inTeam: false, team: null, roleLabel: "" });
    }

    const teamId = Number(membership.team_id) || 0;
    const teamSlug = (membership.team_slug || "").toString().trim();
    const role = (membership.role || "member").toString().trim().toLowerCase();
    const memberPermissions = buildTeamMemberPermissionsFromRow({
      role,
      row: membership
    });
    const canManageManga = canAccessAdminBadge || role === "leader" || hasAnyTeamManagePermission(memberPermissions);
    const manageMangaUrl =
      canManageManga && teamId > 0
        ? `/team/${encodeURIComponent(String(teamId))}/${encodeURIComponent(teamSlug)}/manage-manga`
        : "";

    return res.json({
      ok: true,
      inTeam: true,
      team: {
        id: teamId,
        name: membership.team_name || "",
        slug: teamSlug,
        role
      },
      roleLabel: buildTeamRoleLabel({ role: membership.role, teamName: membership.team_name }),
      canManageManga,
      manageMangaUrl
    });
  })
);

app.get(
  "/teams/search",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    const query = (req.query.q || "").toString().trim().slice(0, 60);
    if (!query) {
      return res.json({
        ok: true,
        teams: []
      });
    }

    const likeValue = `%${query}%`;
    const startsWithValue = `${query}%`;
    const rows = await dbAll(
      `
        SELECT id, name, slug, intro
        FROM translation_teams
        WHERE status = 'approved'
          AND (name ILIKE ? OR slug ILIKE ?)
        ORDER BY
          CASE
            WHEN lower(trim(name)) = lower(?) THEN 0
            WHEN lower(trim(slug)) = lower(?) THEN 1
            WHEN lower(name) LIKE lower(?) THEN 2
            WHEN lower(slug) LIKE lower(?) THEN 3
            ELSE 4
          END ASC,
          LEAST(
            CASE WHEN strpos(lower(name), lower(?)) > 0 THEN strpos(lower(name), lower(?)) ELSE 9999 END,
            CASE WHEN strpos(lower(slug), lower(?)) > 0 THEN strpos(lower(slug), lower(?)) ELSE 9999 END
          ) ASC,
          ABS(char_length(name) - char_length(?)) ASC,
          updated_at DESC,
          id DESC
        LIMIT 5
      `,
      [
        likeValue,
        likeValue,
        query,
        query,
        startsWithValue,
        startsWithValue,
        query,
        query,
        query,
        query,
        query
      ]
    );

    return res.json({
      ok: true,
      teams: rows.map((row) => ({
        id: Number(row.id),
        name: row.name || "",
        slug: row.slug || "",
        intro: (row.intro || "").toString().trim()
      }))
    });
  })
);

app.post(
  "/teams/create",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }
    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }
    await ensureUserRowFromAuthUser(user).catch(() => null);

    const existingMembership = await dbGet(
      "SELECT 1 as ok FROM translation_team_members WHERE user_id = ? AND status IN ('pending', 'approved') LIMIT 1",
      [userId]
    );
    if (existingMembership) {
      return res.status(409).json({ ok: false, error: "Bạn đã ở trong một nhóm dịch hoặc đang chờ duyệt." });
    }

    const name = (req.body && req.body.name ? String(req.body.name) : "").replace(/\s+/g, " ").trim();
    const intro = (req.body && req.body.intro ? String(req.body.intro) : "").replace(/\s+/g, " ").trim();
    const communityLinks = parseTeamCommunityLinks({
      facebookRaw: req.body && req.body.facebookUrl ? req.body.facebookUrl : "",
      discordRaw: req.body && req.body.discordUrl ? req.body.discordUrl : ""
    });
    if (!communityLinks.ok) {
      if (communityLinks.errorKey === "facebook") {
        return res.status(400).json({ ok: false, error: "Link Facebook phải có dạng facebook.com/*." });
      }
      if (communityLinks.errorKey === "discord") {
        return res.status(400).json({ ok: false, error: "Link Discord phải có dạng discord.gg/*." });
      }
      return res.status(400).json({ ok: false, error: "Link cộng đồng không hợp lệ." });
    }
    const facebookUrl = communityLinks.facebookUrl;
    const discordUrl = communityLinks.discordUrl;

    if (!name) {
      return res.status(400).json({ ok: false, error: "Tên nhóm dịch không được để trống." });
    }
    if (name.length > TEAM_NAME_MAX_LENGTH) {
      return res.status(400).json({ ok: false, error: `Tên nhóm dịch tối đa ${TEAM_NAME_MAX_LENGTH} ký tự.` });
    }
    if (intro.length > TEAM_INTRO_MAX_LENGTH) {
      return res.status(400).json({ ok: false, error: `Giới thiệu tối đa ${TEAM_INTRO_MAX_LENGTH} ký tự.` });
    }

    const slug = await buildUniqueTeamSlug(name);
    const now = Date.now();

    const created = await withTransaction(async ({ dbRun: txRun }) => {
      const teamInsert = await txRun(
        `
          INSERT INTO translation_teams (
            name,
            slug,
            intro,
            facebook_url,
            discord_url,
            status,
            created_by_user_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `,
        [name, slug, intro, facebookUrl, discordUrl, userId, now, now]
      );
      const teamId = teamInsert && teamInsert.lastID ? Number(teamInsert.lastID) : 0;
      if (!teamId) {
        throw new Error("Không thể tạo nhóm dịch.");
      }

      await txRun(
        `
          INSERT INTO translation_team_members (
            team_id,
            user_id,
            role,
            status,
            requested_at,
            reviewed_at,
            reviewed_by_user_id
          )
          VALUES (?, ?, 'leader', 'approved', ?, ?, ?)
        `,
        [teamId, userId, now, now, userId]
      );

      return { teamId };
    });

    return res.json({
      ok: true,
      team: {
        id: Number(created.teamId),
        name,
        slug,
        status: "pending",
        url: `/team/${encodeURIComponent(String(created.teamId))}/${encodeURIComponent(slug)}`
      }
    });
  })
);

app.post(
  "/teams/join-request",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }
    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }
    await ensureUserRowFromAuthUser(user).catch(() => null);

    const teamId = Number(req.body && req.body.teamId);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      return res.status(400).json({ ok: false, error: "Nhóm dịch không hợp lệ." });
    }

    const teamRow = await dbGet(
      "SELECT id, name, status FROM translation_teams WHERE id = ? LIMIT 1",
      [Math.floor(teamId)]
    );
    if (!teamRow || String(teamRow.status || "") !== "approved") {
      return res.status(404).json({ ok: false, error: "Không tìm thấy nhóm dịch." });
    }

    const current = await dbGet(
      "SELECT team_id, status FROM translation_team_members WHERE user_id = ? AND status IN ('pending', 'approved') LIMIT 1",
      [userId]
    );
    if (current) {
      return res.status(409).json({ ok: false, error: "Bạn đã có nhóm dịch hoặc đang chờ duyệt." });
    }

    const safeTeamId = Math.floor(teamId);
    const joinResult = await withTransaction(async ({ dbAll: txAll, dbRun: txRun }) => {
      const now = Date.now();
      await txRun(
        `
          INSERT INTO translation_team_members (team_id, user_id, role, status, requested_at)
          VALUES (?, ?, 'member', 'pending', ?)
          ON CONFLICT (team_id, user_id)
          DO UPDATE SET status = 'pending', requested_at = EXCLUDED.requested_at, reviewed_at = NULL, reviewed_by_user_id = NULL
        `,
        [safeTeamId, userId, now]
      );

      const leaderRows = await txAll(
        `
          SELECT tm.user_id
          FROM translation_team_members tm
          JOIN translation_teams t ON t.id = tm.team_id
          WHERE tm.team_id = ?
            AND tm.role = 'leader'
            AND tm.status = 'approved'
            AND t.status = 'approved'
        `,
        [safeTeamId]
      );

      const preview = `Có yêu cầu tham gia ${teamRow.name || "nhóm dịch"}.`;
      const notifiedLeaderIds = [];
      for (const row of leaderRows) {
        const leaderUserId = row && row.user_id ? String(row.user_id).trim() : "";
        if (!leaderUserId || leaderUserId === userId) continue;

        const inserted = await txRun(
          `
            INSERT INTO notifications (
              user_id,
              type,
              actor_user_id,
              team_id,
              content_preview,
              is_read,
              created_at,
              read_at
            )
            VALUES (?, ?, ?, ?, ?, false, ?, NULL)
          `,
          [
            leaderUserId,
            NOTIFICATION_TYPE_TEAM_JOIN_REQUEST,
            userId,
            safeTeamId,
            preview,
            now
          ]
        );

        if (inserted && inserted.changes) {
          notifiedLeaderIds.push(leaderUserId);
        }
      }

      return {
        notifiedLeaderIds: Array.from(new Set(notifiedLeaderIds))
      };
    });

    const notifiedLeaderIds =
      joinResult && Array.isArray(joinResult.notifiedLeaderIds) ? joinResult.notifiedLeaderIds : [];
    notifiedLeaderIds.forEach((leaderUserId) => {
      publishNotificationStreamUpdate({ userId: leaderUserId, reason: "created" }).catch(() => null);
    });

    return res.json({ ok: true, message: `Đã gửi yêu cầu tham gia ${teamRow.name || "nhóm dịch"}.` });
  })
);

app.get(
  "/teams/:id/requests",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }
    const userId = String(user.id || "").trim();
    const teamId = Number(req.params.id);
    if (!userId || !Number.isFinite(teamId) || teamId <= 0) {
      return res.status(400).json({ ok: false, error: "Yêu cầu không hợp lệ." });
    }

    const manageActor = await resolveTeamManagementActor({
      userId,
      teamId: Math.floor(teamId)
    });
    if (!manageActor || manageActor.ok !== true) {
      return res.status((manageActor && manageActor.statusCode) || 403).json({
        ok: false,
        error: (manageActor && manageActor.error) || "Bạn không có quyền duyệt yêu cầu của nhóm này."
      });
    }

    const rows = await listTeamPendingJoinRequests({ teamId: Math.floor(teamId) });

    return res.json({
      ok: true,
      requests: rows.map((row) => ({
        userId: row.user_id,
        username: row.username || "",
        displayName: (row.display_name || "").toString().trim(),
        avatarUrl: normalizeAvatarUrl(row.avatar_url || ""),
        requestedAt: Number(row.requested_at) || 0
      }))
    });
  })
);

app.post(
  "/teams/requests/:teamId/:userId/review",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }
    const reviewerUserId = String(user.id || "").trim();
    const teamId = Number(req.params.teamId);
    const targetUserId = String(req.params.userId || "").trim();
    const action = (req.body && req.body.action ? String(req.body.action) : "").toLowerCase().trim();

    const result = await reviewTeamJoinRequest({
      reviewerUserId,
      teamId,
      targetUserId,
      action
    });

    if (!result || result.ok !== true) {
      return res.status((result && result.statusCode) || 400).json({
        ok: false,
        error: (result && result.error) || "Không thể xử lý yêu cầu tham gia."
      });
    }

    return res.json({ ok: true, status: result.status });
  })
);

app.post(
  "/team/:teamId/:slug/requests/:userId/review",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    const reviewerUserId = String(user.id || "").trim();
    const teamId = Number(req.params.teamId);
    const requestedSlug = (req.params.slug || "").toString().trim();
    const targetUserId = String(req.params.userId || "").trim();
    const action = (req.body && req.body.action ? String(req.body.action) : "").toLowerCase().trim();

    const fallbackPath = Number.isFinite(teamId) && teamId > 0
      ? `/team/${encodeURIComponent(String(Math.floor(teamId)))}/${encodeURIComponent(requestedSlug || "")}`
      : "/publish";

    const result = await reviewTeamJoinRequest({
      reviewerUserId,
      teamId,
      targetUserId,
      action
    });

    if (!result || result.ok !== true) {
      const reason = (result && result.reason ? String(result.reason) : "error").trim() || "error";
      setTeamPageFlash(req, teamId, {
        requestStatus: reason,
        activeTab: "members"
      });
      return res.redirect(fallbackPath);
    }

    const canonicalPath = `/team/${encodeURIComponent(String(result.teamId))}/${encodeURIComponent(
      result.teamSlug || requestedSlug || ""
    )}`;
    setTeamPageFlash(req, result.teamId, {
      requestStatus: result.status || "updated",
      activeTab: "members"
    });
    return res.redirect(canonicalPath);
  })
);

app.post(
  "/team/:teamId/:slug/members/:userId/kick",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    const actorUserId = String(user.id || "").trim();
    const teamId = Number(req.params.teamId);
    const requestedSlug = (req.params.slug || "").toString().trim();
    const targetUserId = String(req.params.userId || "").trim();

    const fallbackPath = Number.isFinite(teamId) && teamId > 0
      ? `/team/${encodeURIComponent(String(Math.floor(teamId)))}/${encodeURIComponent(requestedSlug || "")}`
      : "/publish";

    const result = await kickTeamMember({
      actorUserId,
      teamId,
      targetUserId
    });

    if (!result || result.ok !== true) {
      const reason = (result && result.reason ? String(result.reason) : "error").trim() || "error";
      setTeamPageFlash(req, teamId, {
        memberStatus: reason,
        activeTab: "members"
      });
      return res.redirect(fallbackPath);
    }

    const canonicalPath = `/team/${encodeURIComponent(String(result.teamId))}/${encodeURIComponent(
      result.teamSlug || requestedSlug || ""
    )}`;
    setTeamPageFlash(req, result.teamId, {
      memberStatus: result.reason || "kicked",
      activeTab: "members"
    });
    return res.redirect(canonicalPath);
  })
);

app.post(
  "/team/:teamId/:slug/members/leave",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    const userId = String(user.id || "").trim();
    const teamId = Number(req.params.teamId);
    const requestedSlug = (req.params.slug || "").toString().trim();

    const fallbackPath =
      Number.isFinite(teamId) && teamId > 0
        ? `/team/${encodeURIComponent(String(Math.floor(teamId)))}/${encodeURIComponent(requestedSlug || "")}`
        : "/publish";

    const result = await leaveTeamAsMember({
      userId,
      teamId
    });

    if (!result || result.ok !== true) {
      const reason = (result && result.reason ? String(result.reason) : "error").trim() || "error";
      setTeamPageFlash(req, teamId, {
        memberStatus: reason,
        activeTab: "members"
      });
      return res.redirect(fallbackPath);
    }

    const canonicalPath = `/team/${encodeURIComponent(String(result.teamId))}/${encodeURIComponent(
      result.teamSlug || requestedSlug || ""
    )}`;
    setTeamPageFlash(req, result.teamId, {
      memberStatus: result.reason || "left",
      activeTab: "members"
    });
    return res.redirect(canonicalPath);
  })
);

app.post(
  "/team/:teamId/:slug/members/:userId/promote-leader",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    const actorUserId = String(user.id || "").trim();
    const teamId = Number(req.params.teamId);
    const requestedSlug = (req.params.slug || "").toString().trim();
    const targetUserId = String(req.params.userId || "").trim();

    const fallbackPath = Number.isFinite(teamId) && teamId > 0
      ? `/team/${encodeURIComponent(String(Math.floor(teamId)))}/${encodeURIComponent(requestedSlug || "")}`
      : "/publish";

    const result = await promoteTeamMemberAsLeader({
      actorUserId,
      teamId,
      targetUserId
    });

    if (!result || result.ok !== true) {
      const reason = (result && result.reason ? String(result.reason) : "error").trim() || "error";
      setTeamPageFlash(req, teamId, {
        memberStatus: reason,
        activeTab: "members"
      });
      return res.redirect(fallbackPath);
    }

    const canonicalPath = `/team/${encodeURIComponent(String(result.teamId))}/${encodeURIComponent(
      result.teamSlug || requestedSlug || ""
    )}`;
    setTeamPageFlash(req, result.teamId, {
      memberStatus: result.reason || "promoted",
      activeTab: "members"
    });
    return res.redirect(canonicalPath);
  })
);

app.post(
  "/team/:teamId/:slug/members/:userId/permissions",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).json({ ok: false, error: "Yêu cầu JSON." });
    }

    const actorUserId = String(user.id || "").trim();
    const teamId = Number(req.params.teamId);
    const targetUserId = String(req.params.userId || "").trim();
    const parsedPermissionPayload = parseTeamMemberPermissionInput(req.body || {});
    if (!parsedPermissionPayload.ok) {
      return res.status(400).json({ ok: false, error: "Dữ liệu phân quyền không hợp lệ." });
    }

    const result = await updateTeamMemberPermissions({
      actorUserId,
      teamId,
      targetUserId,
      permissions: parsedPermissionPayload.permissions
    });

    if (!result || result.ok !== true) {
      return res.status((result && result.statusCode) || 400).json({
        ok: false,
        error: (result && result.error) || "Không thể cập nhật phân quyền thành viên."
      });
    }

    return res.json({
      ok: true,
      member: {
        userId: result.targetUserId,
        permissions: result.permissions,
        hasAnyPermission: hasAnyTeamManagePermission(result.permissions)
      }
    });
  })
);

app.get(
  "/team/:teamId/:slug/manage-manga",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    const userId = String(user.id || "").trim();
    const teamId = Number(req.params.teamId);
    const requestedSlug = (req.params.slug || "").toString().trim();
    const fallbackPath = buildTeamEditPath(teamId, requestedSlug || "");

    if (!userId || !Number.isFinite(teamId) || teamId <= 0) {
      setTeamPageFlash(req, teamId, {
        settingsStatus: "invalid",
        activeTab: "overview"
      });
      return res.redirect(fallbackPath);
    }

    const memberMembership = await getApprovedTeamMembershipForTeam({
      userId,
      teamId: Math.floor(teamId)
    });
    const canAccessAdminBadge = await hasAdminBadgeAccess(userId);

    let canonicalTeamId = 0;
    let canonicalSlug = "";
    let sessionAdminAuth = "team_member";
    let sessionTeamRole = "member";
    let sessionTeamName = "";
    let sessionTeamPermissions = buildTeamMemberPermissionsFromRow({ role: "member", row: null });

    if (memberMembership) {
      const membershipRole = (memberMembership.role || "member").toString().trim().toLowerCase();
      const teamManagePermissions = buildTeamMemberPermissionsFromRow({
        role: membershipRole,
        row: memberMembership
      });
      const hasTeamManagePermission =
        membershipRole === "leader" || hasAnyTeamManagePermission(teamManagePermissions);

      if (!hasTeamManagePermission && !canAccessAdminBadge) {
        return res.redirect(fallbackPath);
      }

      canonicalTeamId = Number(memberMembership.team_id) || Math.floor(teamId);
      canonicalSlug = (memberMembership.team_slug || requestedSlug || "").toString().trim();
      sessionTeamName = (memberMembership.team_name || "").toString().trim();

      if (hasTeamManagePermission) {
        sessionAdminAuth = membershipRole === "leader" ? "team_leader" : "team_member";
        sessionTeamRole = membershipRole === "leader" ? "leader" : "member";
        sessionTeamPermissions = teamManagePermissions;
      } else {
        sessionAdminAuth = "badge";
        sessionTeamRole = "member";
        sessionTeamPermissions = buildTeamMemberPermissionsFromRow({ role: "member", row: null });
      }
    } else {
      if (!canAccessAdminBadge) {
        setTeamPageFlash(req, teamId, {
          settingsStatus: "forbidden",
          activeTab: "overview"
        });
        return res.redirect(fallbackPath);
      }

      const teamRow = await getApprovedTeamById({ teamId: Math.floor(teamId) });
      if (!teamRow) {
        setTeamPageFlash(req, teamId, {
          settingsStatus: "forbidden",
          activeTab: "overview"
        });
        return res.redirect(fallbackPath);
      }

      canonicalTeamId = Number(teamRow.team_id) || Math.floor(teamId);
      canonicalSlug = (teamRow.team_slug || requestedSlug || "").toString().trim();
      sessionAdminAuth = "badge";
      sessionTeamRole = "member";
      sessionTeamName = (teamRow.team_name || "").toString().trim();
      sessionTeamPermissions = buildTeamMemberPermissionsFromRow({ role: "member", row: null });
    }

    if (!req.session) {
      return res.redirect(`/admin/manga?teamId=${encodeURIComponent(String(canonicalTeamId))}`);
    }

    req.session.isAdmin = true;
    req.session.adminAuth = sessionAdminAuth;
    req.session.adminUserId = userId;
    req.session.adminAuthUserId = userId;
    req.session.adminTeamId = Math.floor(canonicalTeamId);
    req.session.adminTeamName = sessionTeamName;
    req.session.adminTeamSlug = canonicalSlug;
    if (sessionAdminAuth === "team_leader" || sessionAdminAuth === "team_member") {
      req.session.adminTeamRole = sessionTeamRole;
      req.session.adminTeamPermissions = sessionTeamPermissions;
    } else {
      delete req.session.adminTeamRole;
      delete req.session.adminTeamPermissions;
    }
    req.session.sessionVersion = serverSessionVersion;

    return res.redirect(`/admin/manga?teamId=${encodeURIComponent(String(Math.floor(canonicalTeamId)))}&teamMode=1`);
  })
);

app.post(
  "/team/:teamId/:slug/settings",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    const userId = String(user.id || "").trim();
    const teamId = Number(req.params.teamId);
    const requestedSlug = (req.params.slug || "").toString().trim();
    const fallbackPath = buildTeamEditPath(teamId, requestedSlug || "");

    if (!userId || !Number.isFinite(teamId) || teamId <= 0) {
      setTeamPageFlash(req, teamId, {
        settingsStatus: "invalid",
        activeTab: "overview"
      });
      return res.redirect(fallbackPath);
    }

    const manageActor = await resolveTeamManagementActor({
      userId,
      teamId: Math.floor(teamId)
    });
    if (!manageActor || manageActor.ok !== true || !manageActor.team) {
      setTeamPageFlash(req, teamId, {
        settingsStatus: "forbidden",
        activeTab: "overview"
      });
      return res.redirect(fallbackPath);
    }
    const managedTeam = manageActor.team;

    const oldName = (managedTeam.team_name || "").toString().trim();
    const inputName = (req.body && req.body.name ? String(req.body.name) : "").replace(/\s+/g, " ").trim();
    const inputIntro = (req.body && req.body.intro ? String(req.body.intro) : "").replace(/\s+/g, " ").trim();
    const communityLinks = parseTeamCommunityLinks({
      facebookRaw: req.body && req.body.facebookUrl ? req.body.facebookUrl : "",
      discordRaw: req.body && req.body.discordUrl ? req.body.discordUrl : ""
    });
    const inputFacebook = communityLinks.facebookUrl;
    const inputDiscord = communityLinks.discordUrl;
    const canonicalPath = buildTeamEditPath(managedTeam.team_id, managedTeam.team_slug || requestedSlug || "");

    if (!communityLinks.ok) {
      setTeamPageFlash(req, managedTeam.team_id, {
        settingsStatus: "invalid",
        activeTab: "overview"
      });
      return res.redirect(canonicalPath);
    }

    if (!inputName || inputName.length > TEAM_NAME_MAX_LENGTH || inputIntro.length > TEAM_INTRO_MAX_LENGTH) {
      setTeamPageFlash(req, managedTeam.team_id, {
        settingsStatus: "invalid",
        activeTab: "overview"
      });
      return res.redirect(canonicalPath);
    }

    const shouldRenameTeam = !isTeamNameMatch(inputName, oldName);
    const nextSlug = shouldRenameTeam
      ? await buildUniqueTeamSlug(inputName)
      : (managedTeam.team_slug || requestedSlug || "").toString().trim();
    const now = Date.now();

    try {
      await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
        await txRun(
          `
            UPDATE translation_teams
            SET name = ?, slug = ?, intro = ?, facebook_url = ?, discord_url = ?, updated_at = ?
            WHERE id = ?
          `,
          [
            inputName,
            nextSlug,
            inputIntro,
            inputFacebook,
            inputDiscord,
            now,
            Math.floor(Number(managedTeam.team_id) || 0)
          ]
        );

        if (shouldRenameTeam && oldName) {
          await txRun(
            `
              UPDATE manga
              SET group_name = ?
              WHERE lower(trim(COALESCE(group_name, ''))) = lower(trim(?))
            `,
            [inputName, oldName]
          );
          await txRun(
            `
              UPDATE chapters
              SET group_name = ?
              WHERE lower(trim(COALESCE(group_name, ''))) = lower(trim(?))
            `,
            [inputName, oldName]
          );
        }

        await syncTeamBadgesForTeamMembers({
          teamId: Number(managedTeam.team_id),
          teamName: inputName,
          dbAllFn: txAll,
          dbGetFn: txGet,
          dbRunFn: txRun
        });
      });
    } catch (_err) {
      setTeamPageFlash(req, managedTeam.team_id, {
        settingsStatus: "error",
        activeTab: "overview"
      });
      return res.redirect(canonicalPath);
    }

    const nextCanonicalPath = buildTeamEditPath(managedTeam.team_id, nextSlug || requestedSlug || "");
    setTeamPageFlash(req, managedTeam.team_id, {
      settingsStatus: "updated",
      activeTab: "overview"
    });
    return res.redirect(nextCanonicalPath);
  })
);

app.post(
  "/team/:teamId/:slug/avatar",
  uploadAvatar,
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    const userId = String(user.id || "").trim();
    const teamId = Number(req.params.teamId);
    const requestedSlug = (req.params.slug || "").toString().trim();
    const fallbackPath = buildTeamEditPath(teamId, requestedSlug || "");

    if (!userId || !Number.isFinite(teamId) || teamId <= 0) {
      setTeamPageFlash(req, teamId, {
        settingsStatus: "invalid",
        activeTab: "overview"
      });
      return res.redirect(fallbackPath);
    }

    const manageActor = await resolveTeamManagementActor({
      userId,
      teamId: Math.floor(teamId)
    });
    if (!manageActor || manageActor.ok !== true || !manageActor.team) {
      setTeamPageFlash(req, teamId, {
        settingsStatus: "forbidden",
        activeTab: "overview"
      });
      return res.redirect(fallbackPath);
    }
    const managedTeam = manageActor.team;

    if (!req.file || !req.file.buffer) {
      const canonicalPath = buildTeamEditPath(managedTeam.team_id, managedTeam.team_slug || requestedSlug || "");
      setTeamPageFlash(req, managedTeam.team_id, {
        settingsStatus: "invalid",
        activeTab: "overview"
      });
      return res.redirect(canonicalPath);
    }

    let output = null;
    try {
      output = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 256, height: 256, fit: "cover" })
        .webp({ quality: 80, effort: 6 })
        .toBuffer();
    } catch (_err) {
      const canonicalPath = buildTeamEditPath(managedTeam.team_id, managedTeam.team_slug || requestedSlug || "");
      setTeamPageFlash(req, managedTeam.team_id, {
        settingsStatus: "invalid",
        activeTab: "overview"
      });
      return res.redirect(canonicalPath);
    }

    const safeTeamId = Math.floor(Number(managedTeam.team_id) || 0);
    const fileName = `team-${safeTeamId}-avatar.webp`;
    const filePath = path.join(avatarsDir, fileName);
    const stamp = Date.now();
    const avatarUrl = `/uploads/avatars/${fileName}?v=${stamp}`;

    await fs.promises.writeFile(filePath, output);
    await dbRun("UPDATE translation_teams SET avatar_url = ?, updated_at = ? WHERE id = ?", [
      avatarUrl,
      stamp,
      safeTeamId
    ]);

    const canonicalPath = buildTeamEditPath(managedTeam.team_id, managedTeam.team_slug || requestedSlug || "");
    setTeamPageFlash(req, managedTeam.team_id, {
      settingsStatus: "avatar_updated",
      activeTab: "overview"
    });
    return res.redirect(canonicalPath);
  })
);

app.post(
  "/team/:teamId/:slug/cover",
  uploadCover,
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    const userId = String(user.id || "").trim();
    const teamId = Number(req.params.teamId);
    const requestedSlug = (req.params.slug || "").toString().trim();
    const fallbackPath = buildTeamEditPath(teamId, requestedSlug || "");

    if (!userId || !Number.isFinite(teamId) || teamId <= 0) {
      setTeamPageFlash(req, teamId, {
        settingsStatus: "invalid",
        activeTab: "overview"
      });
      return res.redirect(fallbackPath);
    }

    const manageActor = await resolveTeamManagementActor({
      userId,
      teamId: Math.floor(teamId)
    });
    if (!manageActor || manageActor.ok !== true || !manageActor.team) {
      setTeamPageFlash(req, teamId, {
        settingsStatus: "forbidden",
        activeTab: "overview"
      });
      return res.redirect(fallbackPath);
    }
    const managedTeam = manageActor.team;

    if (!req.file || !req.file.buffer) {
      const canonicalPath = buildTeamEditPath(managedTeam.team_id, managedTeam.team_slug || requestedSlug || "");
      setTeamPageFlash(req, managedTeam.team_id, {
        settingsStatus: "invalid",
        activeTab: "overview"
      });
      return res.redirect(canonicalPath);
    }

    let output = null;
    try {
      output = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1500, height: 420, fit: "cover" })
        .webp({ quality: 82, effort: 6 })
        .toBuffer();
    } catch (_err) {
      const canonicalPath = buildTeamEditPath(managedTeam.team_id, managedTeam.team_slug || requestedSlug || "");
      setTeamPageFlash(req, managedTeam.team_id, {
        settingsStatus: "invalid",
        activeTab: "overview"
      });
      return res.redirect(canonicalPath);
    }

    const safeTeamId = Math.floor(Number(managedTeam.team_id) || 0);
    const fileName = `team-${safeTeamId}-cover.webp`;
    const filePath = path.join(coversDir, fileName);
    const stamp = Date.now();
    const coverUrl = `/uploads/covers/${fileName}?v=${stamp}`;

    await fs.promises.writeFile(filePath, output);
    await dbRun("UPDATE translation_teams SET cover_url = ?, updated_at = ? WHERE id = ?", [
      coverUrl,
      stamp,
      safeTeamId
    ]);

    const canonicalPath = buildTeamEditPath(managedTeam.team_id, managedTeam.team_slug || requestedSlug || "");
    setTeamPageFlash(req, managedTeam.team_id, {
      settingsStatus: "cover_updated",
      activeTab: "overview"
    });
    return res.redirect(canonicalPath);
  })
);

app.get(
  "/messages/users",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }
    const currentUserId = String(user.id || "").trim();
    if (!currentUserId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }

    const query = (req.query.q || "").toString().trim().slice(0, 40);
    const likeValue = `%${query}%`;
    const rows = await dbAll(
      `
        SELECT id, username, display_name, avatar_url
        FROM users
        WHERE id <> ?
          AND username IS NOT NULL
          AND TRIM(username) <> ''
          AND (? = '' OR username ILIKE ? OR COALESCE(display_name, '') ILIKE ?)
        ORDER BY
          CASE WHEN lower(username) = lower(?) THEN 0 ELSE 1 END,
          CASE WHEN lower(username) LIKE lower(?) THEN 0 ELSE 1 END,
          lower(username) ASC
        LIMIT 20
      `,
      [currentUserId, query, likeValue, likeValue, query, `${query}%`]
    );

    return res.json({
      ok: true,
      users: rows.map((row) => ({
        id: row.id,
        username: row.username || "",
        displayName: (row.display_name || "").toString().trim(),
        avatarUrl: normalizeAvatarUrl(row.avatar_url || "")
      }))
    });
  })
);

app.post(
  "/messages/threads",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }
    const userId = String(user.id || "").trim();
    const targetUserId = String(req.body && req.body.targetUserId ? req.body.targetUserId : "").trim();
    const ensuredThread = await ensureChatThreadBetweenUsers({ userId, targetUserId });
    if (!ensuredThread || ensuredThread.ok !== true) {
      const statusCode = Number(ensuredThread && ensuredThread.statusCode) || 400;
      const errorMessage =
        ensuredThread && ensuredThread.error ? String(ensuredThread.error) : "Không thể tạo cuộc trò chuyện.";
      return res.status(statusCode).json({ ok: false, error: errorMessage });
    }

    return res.json({ ok: true, threadId: Number(ensuredThread.threadId) || 0 });
  })
);

app.get(
  "/messages/threads",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }
    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }

    const includeThreadIdRaw = Number(req.query.includeThreadId);
    const includeThreadId = Number.isFinite(includeThreadIdRaw) && includeThreadIdRaw > 0
      ? Math.floor(includeThreadIdRaw)
      : 0;

    const threadSelectSql = `
      SELECT
        t.id,
        t.last_message_at,
        other.id as other_user_id,
        other.username as other_username,
        other.display_name as other_display_name,
        other.avatar_url as other_avatar_url,
        msg.id as last_message_id,
        msg.content as last_message_content,
        msg.created_at as last_message_created_at,
        msg.sender_user_id as last_message_sender_user_id
      FROM chat_thread_members self_member
      JOIN chat_threads t ON t.id = self_member.thread_id
      JOIN chat_thread_members other_member ON other_member.thread_id = t.id AND other_member.user_id <> self_member.user_id
      JOIN users other ON other.id = other_member.user_id
      LEFT JOIN LATERAL (
        SELECT id, content, created_at, sender_user_id
        FROM chat_messages m
        WHERE m.thread_id = t.id
        ORDER BY id DESC
        LIMIT 1
      ) msg ON true
      WHERE self_member.user_id = ?
    `;

    let rows = await dbAll(
      `${threadSelectSql}
      ORDER BY COALESCE(msg.created_at, t.last_message_at) DESC, t.id DESC
      LIMIT 40`,
      [userId]
    );

    if (includeThreadId > 0 && !rows.some((row) => Number(row && row.id) === includeThreadId)) {
      const includeRow = await dbGet(
        `${threadSelectSql}
        AND t.id = ?
        LIMIT 1`,
        [userId, includeThreadId]
      );
      if (includeRow) {
        rows = [includeRow, ...rows];
      }
    }

    const seenThreadIds = new Set();
    const threads = rows
      .map((row) => ({
        id: Number(row.id),
        lastMessageAt: Number(row.last_message_created_at || row.last_message_at) || 0,
        lastMessageId: Number(row.last_message_id) || 0,
        lastMessageContent: (row.last_message_content || "").toString(),
        lastMessageSenderUserId: row.last_message_sender_user_id || "",
        otherUser: {
          id: row.other_user_id,
          username: row.other_username || "",
          displayName: (row.other_display_name || "").toString().trim(),
          avatarUrl: normalizeAvatarUrl(row.other_avatar_url || "")
        }
      }))
      .filter((thread) => {
        const threadId = Number(thread && thread.id);
        if (!Number.isFinite(threadId) || threadId <= 0) return false;
        if (seenThreadIds.has(threadId)) return false;
        seenThreadIds.add(threadId);
        return true;
      });

    return res.json({
      ok: true,
      threads
    });
  })
);

app.get(
  "/messages/threads/:id/messages",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }
    const userId = String(user.id || "").trim();
    const threadId = Number(req.params.id);
    if (!userId || !Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ ok: false, error: "Yêu cầu không hợp lệ." });
    }

    const memberRow = await dbGet(
      "SELECT 1 as ok FROM chat_thread_members WHERE thread_id = ? AND user_id = ? LIMIT 1",
      [Math.floor(threadId), userId]
    );
    if (!memberRow) {
      return res.status(403).json({ ok: false, error: "Bạn không có quyền xem đoạn chat này." });
    }

    const beforeIdRaw = Number(req.query.beforeId);
    const beforeId = Number.isFinite(beforeIdRaw) && beforeIdRaw > 0 ? Math.floor(beforeIdRaw) : 0;
    const markReadRaw = (req.query.markRead || "").toString().trim().toLowerCase();
    const shouldMarkRead = beforeId === 0 && (markReadRaw === "1" || markReadRaw === "true");
    const limitRaw = Number(req.query.limit);
    const defaultLimit = beforeId > 0 ? 25 : 10;
    const maxLimit = beforeId > 0 ? 25 : 10;
    const requestedLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : defaultLimit;
    const safeLimit = Math.max(1, Math.min(maxLimit, requestedLimit));

    const rows = await dbAll(
      `
        SELECT id, thread_id, sender_user_id, content, created_at
        FROM chat_messages
        WHERE thread_id = ?
          AND (? = 0 OR id < ?)
        ORDER BY id DESC
        LIMIT ?
      `,
      [Math.floor(threadId), beforeId, beforeId, safeLimit + 1]
    );

    const hasMore = rows.length > safeLimit;
    const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;

    if (shouldMarkRead && pageRows.length) {
      const latestMessageId = Number(pageRows[0].id);
      if (Number.isFinite(latestMessageId) && latestMessageId > 0) {
        await dbRun(
          `
            UPDATE chat_thread_members
            SET last_read_message_id = ?
            WHERE thread_id = ? AND user_id = ?
              AND (last_read_message_id IS NULL OR last_read_message_id < ?)
          `,
          [Math.floor(latestMessageId), Math.floor(threadId), userId, Math.floor(latestMessageId)]
        );
      }
    }

    const messages = pageRows
      .map((row) => ({
        id: Number(row.id),
        threadId: Number(row.thread_id),
        senderUserId: row.sender_user_id || "",
        content: (row.content || "").toString(),
        createdAt: Number(row.created_at) || 0
      }))
      .reverse();

    const nextBeforeId = messages.length ? Number(messages[0].id) || 0 : 0;

    return res.json({
      ok: true,
      messages,
      hasMore,
      nextBeforeId
    });
  })
);

app.post(
  "/messages/threads/:id/messages",
  asyncHandler(async (req, res) => {
    const user = await requirePrivateFeatureAuthUser(req, res);
    if (!user) return;

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }
    const userId = String(user.id || "").trim();
    const threadId = Number(req.params.id);
    const requestId = (req.body && req.body.requestId ? String(req.body.requestId) : "").trim().slice(0, 80);
    const content = (req.body && req.body.content ? String(req.body.content) : "").replace(/\r\n/g, "\n").trim();

    if (!userId || !Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ ok: false, error: "Yêu cầu không hợp lệ." });
    }
    if (!content) {
      return res.status(400).json({ ok: false, error: "Tin nhắn không được để trống." });
    }
    if (content.length > CHAT_MESSAGE_MAX_LENGTH) {
      return res.status(400).json({ ok: false, error: `Tin nhắn tối đa ${CHAT_MESSAGE_MAX_LENGTH} ký tự.` });
    }
    if (requestId && !/^[a-z0-9][a-z0-9._:-]{2,79}$/i.test(requestId)) {
      return res.status(400).json({ ok: false, error: "Mã yêu cầu tin nhắn không hợp lệ." });
    }

    const now = Date.now();

    try {
      const messageId = await withTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
        await txRun("SELECT pg_advisory_xact_lock(hashtext(?), 0)", [`chat-post:${userId}`]);

        const memberRow = await txGet(
          "SELECT 1 as ok FROM chat_thread_members WHERE thread_id = ? AND user_id = ? LIMIT 1",
          [Math.floor(threadId), userId]
        );
        if (!memberRow) {
          const err = new Error("FORBIDDEN");
          err.code = "FORBIDDEN";
          throw err;
        }

        const latestSent = await txGet(
          "SELECT created_at FROM chat_messages WHERE sender_user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
          [userId]
        );
        const latestSentAt = latestSent && latestSent.created_at != null ? Number(latestSent.created_at) : 0;
        if (Number.isFinite(latestSentAt) && latestSentAt > 0) {
          const retryAfterMs = CHAT_POST_COOLDOWN_MS - (now - latestSentAt);
          if (retryAfterMs > 0) {
            const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
            const err = new Error("CHAT_RATE_LIMITED");
            err.code = "CHAT_RATE_LIMITED";
            err.retryAfter = retryAfter;
            throw err;
          }
        }

        const inserted = await txRun(
          `
            INSERT INTO chat_messages (thread_id, sender_user_id, content, client_request_id, created_at)
            VALUES (?, ?, ?, ?, ?)
          `,
          [Math.floor(threadId), userId, content, requestId || null, now]
        );
        const messageIdValue = inserted && inserted.lastID ? Number(inserted.lastID) : 0;
        if (!messageIdValue) throw new Error("Không thể gửi tin nhắn.");

        await txRun(
          `
            DELETE FROM chat_messages
            WHERE thread_id = ?
              AND id NOT IN (
                SELECT id
                FROM chat_messages
                WHERE thread_id = ?
                ORDER BY id DESC
                LIMIT 200
              )
          `,
          [Math.floor(threadId), Math.floor(threadId)]
        );

        await txRun(
          "UPDATE chat_threads SET updated_at = ?, last_message_at = ? WHERE id = ?",
          [now, now, Math.floor(threadId)]
        );
        await txRun(
          "UPDATE chat_thread_members SET last_read_message_id = ? WHERE thread_id = ? AND user_id = ?",
          [messageIdValue, Math.floor(threadId), userId]
        );

        return messageIdValue;
      });

      const threadMemberRows = await dbAll(
        "SELECT user_id FROM chat_thread_members WHERE thread_id = ?",
        [Math.floor(threadId)]
      );
      const notifyUserIds = threadMemberRows
        .map((row) => (row && row.user_id ? String(row.user_id).trim() : ""))
        .filter(Boolean);
      publishChatStreamUpdate({
        userIds: notifyUserIds,
        payload: {
          threadId: Math.floor(threadId),
          messageId: Number(messageId),
          senderUserId: userId,
          createdAt: now
        }
      });

      return res.json({
        ok: true,
        message: {
          id: Number(messageId),
          threadId: Math.floor(threadId),
          senderUserId: userId,
          content,
          createdAt: now
        }
      });
    } catch (error) {
      if (error && error.code === "FORBIDDEN") {
        return res.status(403).json({ ok: false, error: "Bạn không có quyền gửi tin nhắn trong đoạn chat này." });
      }
      if (error && error.code === "CHAT_RATE_LIMITED") {
        const retryAfter = Number(error.retryAfter) || 1;
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({
          ok: false,
          error: `Bạn gửi tin nhắn quá nhanh. Vui lòng chờ ${retryAfter} giây.`,
          retryAfter
        });
      }
      if (error && error.code === "23505") {
        const duplicated = await dbGet(
          `
            SELECT id, thread_id, sender_user_id, content, created_at
            FROM chat_messages
            WHERE sender_user_id = ? AND client_request_id = ?
            LIMIT 1
          `,
          [userId, requestId || ""]
        );
        if (duplicated && Number(duplicated.id) > 0) {
          return res.json({
            ok: true,
            message: {
              id: Number(duplicated.id),
              threadId: Number(duplicated.thread_id),
              senderUserId: duplicated.sender_user_id || "",
              content: (duplicated.content || "").toString(),
              createdAt: Number(duplicated.created_at) || now
            }
          });
        }
      }
      throw error;
    }
  })
);

  const buildTeamEditPath = (teamId, teamSlug) => {
    const safeTeamId = Number(teamId);
    const safeTeamSlug = (teamSlug || "").toString().trim();
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0) {
      return "/publish";
    }
    return `/team/${encodeURIComponent(String(Math.floor(safeTeamId)))}/${encodeURIComponent(safeTeamSlug)}`;
  };

  const TEAM_PAGE_FLASH_SESSION_KEY = "teamPageFlashByTeamId";

  const normalizeTeamPageTab = (value) => {
    const raw = (value || "").toString().trim().toLowerCase();
    if (raw === "series" || raw === "truyen") return "series";
    if (raw === "members" || raw === "thanh-vien") return "members";
    return "overview";
  };

  const setTeamPageFlash = (req, teamId, payload = {}) => {
    const safeTeamId = Number(teamId);
    if (!req || !req.session || !Number.isFinite(safeTeamId) || safeTeamId <= 0) return;

    const key = String(Math.floor(safeTeamId));
    const current =
      req.session[TEAM_PAGE_FLASH_SESSION_KEY] && typeof req.session[TEAM_PAGE_FLASH_SESSION_KEY] === "object"
        ? req.session[TEAM_PAGE_FLASH_SESSION_KEY]
        : {};

    const requestStatus = (payload.requestStatus || "").toString().trim().toLowerCase();
    const memberStatus = (payload.memberStatus || "").toString().trim().toLowerCase();
    const settingsStatus = (payload.settingsStatus || "").toString().trim().toLowerCase();

    current[key] = {
      requestStatus,
      memberStatus,
      settingsStatus,
      activeTab: normalizeTeamPageTab(payload.activeTab || "overview")
    };
    req.session[TEAM_PAGE_FLASH_SESSION_KEY] = current;
  };

  const consumeTeamPageFlash = (req, teamId) => {
    const safeTeamId = Number(teamId);
    if (!req || !req.session || !Number.isFinite(safeTeamId) || safeTeamId <= 0) return null;

    const current =
      req.session[TEAM_PAGE_FLASH_SESSION_KEY] && typeof req.session[TEAM_PAGE_FLASH_SESSION_KEY] === "object"
        ? req.session[TEAM_PAGE_FLASH_SESSION_KEY]
        : null;
    if (!current) return null;

    const key = String(Math.floor(safeTeamId));
    const flash = current[key] && typeof current[key] === "object" ? current[key] : null;
    if (!flash) return null;

    delete current[key];
    if (Object.keys(current).length) {
      req.session[TEAM_PAGE_FLASH_SESSION_KEY] = current;
    } else {
      delete req.session[TEAM_PAGE_FLASH_SESSION_KEY];
    }

    return {
      requestStatus: (flash.requestStatus || "").toString().trim().toLowerCase(),
      memberStatus: (flash.memberStatus || "").toString().trim().toLowerCase(),
      settingsStatus: (flash.settingsStatus || "").toString().trim().toLowerCase(),
      activeTab: normalizeTeamPageTab(flash.activeTab || "overview")
    };
  };

  const feedbackByTeamSettingsStatus = {
    updated: { tone: "success", text: "Đã cập nhật thông tin nhóm dịch." },
    avatar_updated: { tone: "success", text: "Đã cập nhật avatar nhóm dịch." },
    cover_updated: { tone: "success", text: "Đã cập nhật ảnh bìa nhóm dịch." },
    forbidden: { tone: "error", text: "Bạn không có quyền chỉnh sửa nhóm dịch này." },
    invalid: { tone: "error", text: "Dữ liệu chỉnh sửa nhóm dịch không hợp lệ." },
    error: { tone: "error", text: "Không thể cập nhật nhóm dịch lúc này." }
  };

app.get(
  "/team/:id/:slug",
  asyncHandler(async (req, res) => {
    const viewer = await resolveOptionalPrivateFeatureAuthUser(req);

    const teamId = Number(req.params.id);
    const requestedSlug = (req.params.slug || "").toString().trim();
    if (!Number.isFinite(teamId) || teamId <= 0) {
      return res.status(404).render("not-found", { title: "Không tìm thấy", team });
    }

    const teamRow = await dbGet(
      `
        SELECT id, name, slug, intro, facebook_url, discord_url, avatar_url, cover_url, status, created_at
        FROM translation_teams
        WHERE id = ?
        LIMIT 1
      `,
      [Math.floor(teamId)]
    );
    if (!teamRow) {
      return res.status(404).render("not-found", { title: "Không tìm thấy", team });
    }
    const canonicalSlug = (teamRow.slug || "").toString().trim();
    if (requestedSlug !== canonicalSlug) {
      return res.redirect(301, `/team/${encodeURIComponent(String(teamRow.id))}/${encodeURIComponent(canonicalSlug)}`);
    }

    const currentUserId = viewer && viewer.id ? String(viewer.id).trim() : "";
    const viewerMembership = currentUserId
      ? await getApprovedTeamMembershipForTeam({
        userId: currentUserId,
        teamId: Math.floor(teamRow.id)
      })
      : null;
    const viewerBadgeContext = currentUserId ? await getUserBadgeContext(currentUserId).catch(() => null) : null;
    const viewerRole = viewerMembership && viewerMembership.role
      ? String(viewerMembership.role).trim().toLowerCase()
      : "";
    const isApprovedTeam = (teamRow.status || "").toString().trim().toLowerCase() === "approved";
    const isViewerMember = Boolean(viewerMembership);
    const isViewerLeader = isViewerMember && viewerRole === "leader";
    const isViewerAdminBadge = Boolean(
      viewerBadgeContext &&
      viewerBadgeContext.permissions &&
      viewerBadgeContext.permissions.canAccessAdmin
    );
    const canViewerManageTeam = isApprovedTeam && (isViewerLeader || isViewerAdminBadge);
    const viewerTeamPermissions = buildTeamMemberPermissionsFromRow({
      role: viewerRole || "member",
      row: viewerMembership || null
    });
    const canViewerManageManga =
      canViewerManageTeam ||
      (isViewerMember && hasAnyTeamManagePermission(viewerTeamPermissions));

    const teamPageFlash = consumeTeamPageFlash(req, teamRow.id);
    const requestStatus = (teamPageFlash && teamPageFlash.requestStatus ? teamPageFlash.requestStatus : "")
      .toString()
      .trim()
      .toLowerCase();
    const memberStatus = (teamPageFlash && teamPageFlash.memberStatus ? teamPageFlash.memberStatus : "")
      .toString()
      .trim()
      .toLowerCase();
    const settingsStatus = (teamPageFlash && teamPageFlash.settingsStatus ? teamPageFlash.settingsStatus : "")
      .toString()
      .trim()
      .toLowerCase();
    const activeTab = teamPageFlash && teamPageFlash.activeTab
      ? normalizeTeamPageTab(teamPageFlash.activeTab)
      : "overview";
    const feedbackByRequestStatus = {
      approved: { tone: "success", text: "Đã duyệt yêu cầu tham gia nhóm." },
      rejected: { tone: "success", text: "Đã từ chối yêu cầu tham gia nhóm." },
      forbidden: { tone: "error", text: "Bạn không có quyền duyệt yêu cầu của nhóm này." },
      notfound: { tone: "error", text: "Không tìm thấy yêu cầu đang chờ duyệt." },
      invalid: { tone: "error", text: "Dữ liệu yêu cầu không hợp lệ." },
      error: { tone: "error", text: "Không thể xử lý yêu cầu tham gia." }
    };
    const feedbackByMemberStatus = {
      promoted: { tone: "success", text: "Đã bổ nhiệm thành viên làm leader." },
      kicked: { tone: "success", text: "Đã kick thành viên khỏi nhóm." },
      left: { tone: "success", text: "Bạn đã rời nhóm dịch." },
      forbidden: { tone: "error", text: "Bạn không có quyền quản lý thành viên của nhóm này." },
      leave_forbidden: { tone: "error", text: "Chỉ member đã được duyệt mới có thể rời nhóm." },
      leave_notfound: { tone: "error", text: "Không tìm thấy nhóm dịch để rời." },
      notfound: { tone: "error", text: "Không tìm thấy thành viên hợp lệ để xử lý." },
      invalid: { tone: "error", text: "Dữ liệu xử lý thành viên không hợp lệ." },
      error: { tone: "error", text: "Không thể xử lý thành viên của nhóm." }
    };
    const requestFeedback =
      (requestStatus && feedbackByRequestStatus[requestStatus] ? feedbackByRequestStatus[requestStatus] : null) ||
      (memberStatus && feedbackByMemberStatus[memberStatus] ? feedbackByMemberStatus[memberStatus] : null) ||
      (settingsStatus && feedbackByTeamSettingsStatus[settingsStatus] ? feedbackByTeamSettingsStatus[settingsStatus] : null);

    const pendingRequestRows = canViewerManageTeam
      ? await listTeamPendingJoinRequests({ teamId: Math.floor(teamRow.id) })
      : [];

    const safeTeamName = (teamRow.name || "").toString().trim();
    await ensureSingleApprovedLeaderForTeam({
      teamId: Math.floor(teamRow.id),
      preferredLeaderUserId: currentUserId,
      actorUserId: currentUserId,
      teamName: safeTeamName,
      dbAllFn: dbAll,
      dbRunFn: dbRun
    });

    const memberRows = await dbAll(
      `
        SELECT
          tm.user_id,
          tm.role,
          tm.can_add_manga,
          tm.can_edit_manga,
          tm.can_delete_manga,
          tm.can_add_chapter,
          tm.can_edit_chapter,
          tm.can_delete_chapter,
          u.username,
          u.display_name,
          u.avatar_url
        FROM translation_team_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = ?
          AND tm.status = 'approved'
        ORDER BY CASE WHEN tm.role = 'leader' THEN 0 ELSE 1 END ASC, lower(u.username) ASC
      `,
      [teamRow.id]
    );

    const mappedMembers = memberRows.map((row) => {
      const rowUserId = String(row && row.user_id ? row.user_id : "").trim();
      const rowRole = (row && row.role ? String(row.role) : "member").trim().toLowerCase() || "member";
      const isCurrentViewer = Boolean(currentUserId) && rowUserId === currentUserId;
      const isMemberRole = rowRole === "member";

      return {
        userId: row.user_id,
        username: row.username || "",
        displayName: (row.display_name || "").toString().trim(),
        avatarUrl: normalizeAvatarUrl(row.avatar_url || ""),
        role: row.role || "member",
        permissions: buildTeamMemberPermissionsFromRow({
          role: row.role || "member",
          row
        }),
        canManage: canViewerManageTeam && isMemberRole && !isCurrentViewer,
        canEditPermissions: canViewerManageTeam && isMemberRole && !isCurrentViewer,
        canKick: canViewerManageTeam && isMemberRole && !isCurrentViewer,
        canLeaveSelf: isCurrentViewer && isViewerMember && viewerRole === "member" && isMemberRole
      };
    });

    const leaderMember = mappedMembers.find((member) => (member.role || "").toString().trim().toLowerCase() === "leader") || null;
    const memberCount = mappedMembers.length;
    const leaderCount = mappedMembers.filter(
      (member) => (member.role || "").toString().trim().toLowerCase() === "leader"
    ).length;

    const teamSeriesStatsRow = safeTeamName
      ? await dbGet(
        `
          SELECT
            COUNT(*) as manga_count,
            COALESCE(SUM(chapter_stats.chapter_count), 0) as chapter_count
          FROM manga m
          LEFT JOIN (
            SELECT c.manga_id, COUNT(*) as chapter_count
            FROM chapters c
            GROUP BY c.manga_id
          ) chapter_stats ON chapter_stats.manga_id = m.id
          WHERE COALESCE(m.is_hidden, 0) = 0
            AND ${buildTeamGroupNameMatchSql("m.group_name")}
        `,
        [safeTeamName, safeTeamName, safeTeamName]
      )
      : null;

    const teamMangaRows = safeTeamName
      ? await dbAll(
        `
          ${listQueryBase}
          WHERE COALESCE(m.is_hidden, 0) = 0
            AND ${buildTeamGroupNameMatchSql("m.group_name")}
          ${listQueryOrder}
          LIMIT ?
        `,
        [safeTeamName, safeTeamName, safeTeamName, TEAM_MANGA_PREVIEW_LIMIT + 1]
      )
      : [];

    const hasMoreManga = teamMangaRows.length > TEAM_MANGA_PREVIEW_LIMIT;
    const visibleTeamMangaRows = hasMoreManga ? teamMangaRows.slice(0, TEAM_MANGA_PREVIEW_LIMIT) : teamMangaRows;

    const mappedTeamManga = visibleTeamMangaRows.map((row) => {
      const manga = mapMangaListRow(row);
      const chapterCount = Number(manga.chapterCount) || 0;
      const latestChapterNumber = manga.latestChapterNumber != null ? Number(manga.latestChapterNumber) : NaN;
      const latestChapterNumberText = Number.isFinite(latestChapterNumber) && latestChapterNumber > 0
        ? formatChapterNumberValue(latestChapterNumber)
        : "";
      const latestChapterLabel = manga.latestChapterIsOneshot
        ? "Oneshot"
        : latestChapterNumberText
          ? `Ch ${latestChapterNumberText}`
          : "Chưa có chương";
      const updatedAtMs = parseTimeValueToMs(manga.updatedAt);
      const updatedAtText = updatedAtMs
        ? formatTimeAgo(updatedAtMs)
        : (manga.updatedAt || "").toString().trim();

      return {
        id: manga.id,
        title: manga.title || "",
        slug: manga.slug || "",
        url: manga.slug ? `/manga/${encodeURIComponent(manga.slug)}` : "",
        cover: manga.cover || "",
        coverUpdatedAt: Number(manga.coverUpdatedAt) || 0,
        status: (manga.status || "").toString().trim() || "Đang cập nhật",
        chapterCount,
        latestChapterLabel,
        updatedAtMs,
        updatedAtText,
        genres: Array.isArray(manga.genres) ? manga.genres.slice(0, 3) : [],
        description: normalizeSeoText(manga.description || "", 130)
      };
    });
    const overviewMangaList = mappedTeamManga.slice(0, TEAM_OVERVIEW_MANGA_LIMIT);

    const recentChapterRows = safeTeamName
      ? await dbAll(
        `
          SELECT
            c.id,
            c.number,
            c.title as chapter_title,
            c.date as chapter_date,
            COALESCE(c.is_oneshot, false) as chapter_is_oneshot,
            m.slug as manga_slug,
            m.title as manga_title
          FROM chapters c
          JOIN manga m ON m.id = c.manga_id
          WHERE COALESCE(m.is_hidden, 0) = 0
            AND ${buildTeamGroupNameMatchSql("m.group_name")}
          ORDER BY c.id DESC
          LIMIT 6
        `,
        [safeTeamName, safeTeamName, safeTeamName]
      )
      : [];

    const recentUpdates = recentChapterRows.map((row) => {
      const mangaSlug = row && row.manga_slug ? String(row.manga_slug).trim() : "";
      const chapterNumber = row && row.number != null ? Number(row.number) : NaN;
      const chapterNumberText = Number.isFinite(chapterNumber) ? formatChapterNumberValue(chapterNumber) : "";
      const chapterLabel = toBooleanFlag(row && row.chapter_is_oneshot)
        ? "Oneshot"
        : chapterNumberText
          ? `Ch ${chapterNumberText}`
          : "Chương mới";
      const chapterUrl = mangaSlug
        ? chapterNumberText
          ? `/manga/${encodeURIComponent(mangaSlug)}/chapters/${encodeURIComponent(chapterNumberText)}`
          : `/manga/${encodeURIComponent(mangaSlug)}`
        : "";
      const chapterDateMs = parseTimeValueToMs(row && row.chapter_date ? row.chapter_date : 0);
      const chapterDateText = chapterDateMs
        ? formatTimeAgo(chapterDateMs)
        : (row && row.chapter_date ? String(row.chapter_date).trim() : "");

      return {
        mangaTitle: row && row.manga_title ? String(row.manga_title).trim() : "",
        chapterLabel,
        chapterTitle: row && row.chapter_title ? String(row.chapter_title).trim() : "",
        chapterUrl,
        chapterDateText
      };
    });

    const totalMangaCount = teamSeriesStatsRow && teamSeriesStatsRow.manga_count != null
      ? Number(teamSeriesStatsRow.manga_count) || 0
      : 0;
    const totalChapterCount = teamSeriesStatsRow && teamSeriesStatsRow.chapter_count != null
      ? Number(teamSeriesStatsRow.chapter_count) || 0
      : 0;
    const hasMoreOverviewManga = totalMangaCount > TEAM_OVERVIEW_MANGA_LIMIT;
    const createdAtMs = parseTimeValueToMs(teamRow.created_at);
    const createdAtText = formatDateVi(createdAtMs);
    const latestMangaUpdateMs = mappedTeamManga.reduce((max, manga) => {
      const value = Number(manga && manga.updatedAtMs ? manga.updatedAtMs : 0);
      return value > max ? value : max;
    }, 0);
    const latestMangaUpdateText = latestMangaUpdateMs ? formatTimeAgo(latestMangaUpdateMs) : "";
    const teamAvatarUrl = normalizeTeamAssetUrl(teamRow.avatar_url || "");
    const teamCoverUrl = normalizeTeamAssetUrl(teamRow.cover_url || "");
    const teamCanonicalPath = `/team/${encodeURIComponent(String(teamRow.id))}/${encodeURIComponent(canonicalSlug)}`;
    const teamDescription = (teamRow.intro || "").toString().trim() || `Trang nhóm dịch ${teamRow.name || ""}`;
    const teamKeywords = buildSeoKeywordList([
      SEO_TRENDING_KEYWORDS,
      safeTeamName,
      `nhóm dịch ${safeTeamName}`,
      "dịch manga tiếng Việt",
      mappedTeamManga.map((item) => item && item.title).slice(0, 8)
    ]);
    const teamCanonicalUrl = toAbsolutePublicUrl(req, teamCanonicalPath);
    const teamSchemaLogo = toAbsolutePublicUrl(req, teamAvatarUrl || "");
    const teamSchemaImage = toAbsolutePublicUrl(
      req,
      teamCoverUrl || (mappedTeamManga.length && mappedTeamManga[0].cover ? mappedTeamManga[0].cover : "")
    );
    const teamSchemaOrganization = {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${teamCanonicalUrl}#organization`,
      name: safeTeamName || "Nhóm dịch",
      url: teamCanonicalUrl,
      description: normalizeSeoText(teamDescription, 190),
      memberOf: {
        "@id": toAbsolutePublicUrl(req, "/#organization"),
        name: SEO_SITE_NAME
      },
      sameAs: [
        normalizeTeamFacebookUrl(teamRow.facebook_url || ""),
        normalizeTeamDiscordUrl(teamRow.discord_url || "")
      ].filter(Boolean)
    };
    if (teamSchemaLogo) {
      teamSchemaOrganization.logo = teamSchemaLogo;
    }
    if (teamSchemaImage) {
      teamSchemaOrganization.image = teamSchemaImage;
    }
    const teamSchemas = isApprovedTeam
      ? compactJsonLdList([
        buildOrganizationSchema(req),
        buildWebsiteSchema(req),
        buildCollectionPageSchema(req, {
          path: teamCanonicalPath,
          name: safeTeamName || "Nhóm dịch",
          description: teamDescription,
          image: teamCoverUrl || (mappedTeamManga.length && mappedTeamManga[0].cover ? mappedTeamManga[0].cover : ""),
          keywords: teamKeywords
        }),
        buildBreadcrumbSchema(req, [
          { name: "Trang chủ", path: "/" },
          { name: "Toàn bộ truyện", path: "/manga" },
          { name: safeTeamName || "Nhóm dịch", path: teamCanonicalPath }
        ]),
        teamSchemaOrganization,
        {
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          "@id": `${teamCanonicalUrl}#profilepage`,
          url: teamCanonicalUrl,
          name: safeTeamName || "Nhóm dịch",
          description: normalizeSeoText(teamDescription, 190),
          inLanguage: "vi-VN",
          mainEntity: {
            "@id": `${teamCanonicalUrl}#organization`
          }
        }
      ])
      : [];

    return res.render("team", {
      title: teamRow.name || "Nhóm dịch",
      team,
      teamProfile: {
        id: Number(teamRow.id),
        name: safeTeamName,
        slug: canonicalSlug,
        intro: (teamRow.intro || "").toString().trim(),
        facebookUrl: normalizeTeamFacebookUrl(teamRow.facebook_url || ""),
        discordUrl: normalizeTeamDiscordUrl(teamRow.discord_url || ""),
        status: teamRow.status || "pending",
        createdAt: createdAtMs,
        createdAtText,
        initials: buildTeamInitials(safeTeamName),
        memberCount,
        leaderCount,
        totalMangaCount,
        totalChapterCount,
        latestMangaUpdateText,
        pendingRequestCount: pendingRequestRows.length,
        heroCoverUrl: teamCoverUrl || (mappedTeamManga.length && mappedTeamManga[0].cover ? mappedTeamManga[0].cover : ""),
        avatarUrl: teamAvatarUrl,
        mangaBrowseUrl: `/manga?q=${encodeURIComponent(safeTeamName)}`,
        mangaList: mappedTeamManga,
        overviewMangaList,
        hasMoreManga,
        hasMoreOverviewManga,
        mangaPreviewLimit: TEAM_MANGA_PREVIEW_LIMIT,
        overviewMangaLimit: TEAM_OVERVIEW_MANGA_LIMIT,
        recentUpdates,
        leader: leaderMember
          ? {
            username: leaderMember.username || "",
            displayName: leaderMember.displayName || "",
            avatarUrl: leaderMember.avatarUrl || ""
          }
          : null,
        canReviewRequests: canViewerManageTeam,
        canManageMembers: canViewerManageTeam,
        canKickMembers: canViewerManageTeam,
        canEditTeam: canViewerManageTeam,
        activeTab,
        editSettingsUrl: canViewerManageTeam
          ? `/team/${encodeURIComponent(String(teamRow.id))}/${encodeURIComponent(canonicalSlug)}/settings`
          : "",
        editAvatarUrl: canViewerManageTeam
          ? `/team/${encodeURIComponent(String(teamRow.id))}/${encodeURIComponent(canonicalSlug)}/avatar`
          : "",
        editCoverUrl: canViewerManageTeam
          ? `/team/${encodeURIComponent(String(teamRow.id))}/${encodeURIComponent(canonicalSlug)}/cover`
          : "",
        manageMangaUrl: canViewerManageManga
          ? `/team/${encodeURIComponent(String(teamRow.id))}/${encodeURIComponent(canonicalSlug)}/manage-manga`
          : "",
        requestFeedback,
        pendingRequests: pendingRequestRows.map((row) => ({
          userId: row.user_id,
          username: row.username || "",
          displayName: (row.display_name || "").toString().trim(),
          avatarUrl: normalizeAvatarUrl(row.avatar_url || ""),
          requestedAt: Number(row.requested_at) || 0
        })),
        members: mappedMembers
      },
      seo: buildSeoPayload(req, {
        title: `${teamRow.name || "Nhóm dịch"}`,
        description: teamDescription,
        keywords: teamKeywords,
        canonicalPath: teamCanonicalPath,
        robots: isApprovedTeam ? SEO_ROBOTS_INDEX : SEO_ROBOTS_NOINDEX,
        ogType: "profile",
        jsonLd: teamSchemas
      })
    });
  })
);

app.get(
  "/user/:username",
  asyncHandler(async (req, res) => {
    const viewer = await resolveOptionalPrivateFeatureAuthUser(req);

    const username = (req.params.username || "").toString().trim().toLowerCase();
    if (!/^[a-z0-9_]{1,24}$/.test(username)) {
      return res.status(404).render("not-found", { title: "Không tìm thấy", team });
    }

    const profileRow = await dbGet(
      `
        SELECT id, username, display_name, avatar_url, bio, facebook_url, discord_handle, created_at
        FROM users
        WHERE lower(username) = lower(?)
        LIMIT 1
      `,
      [username]
    );
    if (!profileRow) {
      return res.status(404).render("not-found", { title: "Không tìm thấy", team });
    }

    const [teamRow, badgeContext, commentCountRow, recentCommentRows] = await Promise.all([
      getApprovedTeamMembership(profileRow.id),
      getUserBadgeContext(profileRow.id).catch(() => ({ badges: [], userColor: "", permissions: {} })),
      dbGet(
        `
          SELECT COUNT(*) as count
          FROM (
            SELECT c.id
            FROM comments c
            JOIN manga m ON m.id = c.manga_id
            WHERE c.author_user_id = ?
              AND c.status = 'visible'
              AND COALESCE(m.is_hidden, 0) = 0

            UNION ALL

            SELECT fp.id
            FROM forum_posts fp
            WHERE fp.author_user_id = ?
              AND fp.status = 'visible'
              AND COALESCE(fp.parent_id, 0) > 0
          ) profile_comments
        `,
        [profileRow.id, profileRow.id]
      ),
      dbAll(
        `
          SELECT *
          FROM (
            SELECT
              c.id,
              c.content,
              c.chapter_number,
              c.parent_id,
              c.created_at,
              '' as client_request_id,
              false as is_forum_comment,
              m.slug as manga_slug,
              COALESCE(m.title, '') as content_title,
              COALESCE(ch.title, '') as chapter_title,
              COALESCE(ch.is_oneshot, false) as chapter_is_oneshot,
              NULL as parent_parent_id,
              0 as forum_root_id,
              '' as forum_root_content
            FROM comments c
            JOIN manga m ON m.id = c.manga_id
            LEFT JOIN chapters ch ON ch.manga_id = c.manga_id AND ch.number = c.chapter_number
            WHERE c.author_user_id = ?
              AND c.status = 'visible'
              AND COALESCE(m.is_hidden, 0) = 0

            UNION ALL

            SELECT
              fp.id,
              fp.content,
              NULL as chapter_number,
              fp.parent_id,
              fp.created_at,
              COALESCE(fp.client_request_id, '') as client_request_id,
              true as is_forum_comment,
              '' as manga_slug,
              '' as content_title,
              '' as chapter_title,
              false as chapter_is_oneshot,
              parent_comment.parent_id as parent_parent_id,
              COALESCE(root_comment.id, 0) as forum_root_id,
              COALESCE(root_comment.content, '') as forum_root_content
            FROM forum_posts fp
            LEFT JOIN forum_posts parent_comment ON parent_comment.id = fp.parent_id
            LEFT JOIN forum_posts root_comment ON root_comment.id = (
              CASE
                WHEN fp.parent_id IS NULL THEN fp.id
                WHEN parent_comment.parent_id IS NULL THEN fp.parent_id
                ELSE parent_comment.parent_id
              END
            )
            WHERE fp.author_user_id = ?
              AND fp.status = 'visible'
              AND COALESCE(fp.parent_id, 0) > 0
          ) recent
          ORDER BY recent.created_at DESC, recent.id DESC
          LIMIT 10
        `,
        [profileRow.id, profileRow.id]
      )
    ]);

    const fallbackPublicBadge = { code: "member", label: "Member", color: "#f8f8f2", priority: 100 };
    const profileBadgesRaw = Array.isArray(badgeContext && badgeContext.badges) ? badgeContext.badges : [];
    const profileBadges = profileBadgesRaw.length ? profileBadgesRaw : [fallbackPublicBadge];
    const commentCount = Math.max(0, Number(commentCountRow && commentCountRow.count) || 0);
    const recentComments = (Array.isArray(recentCommentRows) ? recentCommentRows : []).map((row) => {
      const mangaSlug = (row && row.manga_slug ? String(row.manga_slug) : "").trim();
      const commentId = Number(row && row.id);
      const isForumComment = Boolean(row && row.is_forum_comment);
      const parentIdRaw = Number(row && row.parent_id);
      const parentId = Number.isFinite(parentIdRaw) && parentIdRaw > 0 ? Math.floor(parentIdRaw) : 0;
      const parentParentIdRaw = Number(row && row.parent_parent_id);
      const parentParentId = Number.isFinite(parentParentIdRaw) && parentParentIdRaw > 0 ? Math.floor(parentParentIdRaw) : 0;
      const forumRootIdRaw = Number(row && row.forum_root_id);
      const forumRootId = Number.isFinite(forumRootIdRaw) && forumRootIdRaw > 0 ? Math.floor(forumRootIdRaw) : 0;
      const forumRootContent = row && row.forum_root_content ? String(row.forum_root_content) : "";
      const forumPostTitle = isForumComment
        ? (parseForumPostValidationParts(forumRootContent).titleText || "")
        : "";
      const chapterRaw = row && row.chapter_number != null ? String(row.chapter_number).trim() : "";
      const chapterContext = buildCommentChapterContext({
        chapterNumber: chapterRaw || null,
        chapterTitle: row && row.chapter_title ? row.chapter_title : "",
        chapterIsOneshot: row && row.chapter_is_oneshot
      });

      const contentText = stripHtmlTags(
        decodeBasicHtmlEntities(row && row.content ? String(row.content) : "")
      );
      const contentPreview = contentText.length > 220 ? `${contentText.slice(0, 217).trimEnd()}...` : contentText;
      const createdAtMs = parseTimeValueToMs(row && row.created_at != null ? row.created_at : 0);
      const basePath = mangaSlug
        ? (chapterRaw
          ? `/manga/${encodeURIComponent(mangaSlug)}/chapters/${encodeURIComponent(chapterRaw)}`
          : `/manga/${encodeURIComponent(mangaSlug)}`)
        : "";
      const forumPostId = forumRootId || parentParentId || parentId;
      const forumCommentPath = forumPostId && Number.isFinite(commentId) && commentId > 0
        ? `/forum/post/${encodeURIComponent(String(forumPostId))}#comment-${encodeURIComponent(String(Math.floor(commentId)))}`
        : "/forum";
      const commentPath = isForumComment
        ? forumCommentPath
        : (basePath && Number.isFinite(commentId) && commentId > 0
          ? `${basePath}#comment-${encodeURIComponent(String(Math.floor(commentId)))}`
          : basePath);

      const displayTitle = isForumComment
        ? (forumPostTitle || "Bài viết diễn đàn")
        : ((row && row.content_title ? String(row.content_title) : "").trim() || "Truyện");

      return {
        id: Number.isFinite(commentId) && commentId > 0 ? Math.floor(commentId) : 0,
        displayTitle,
        chapterLabel: isForumComment
          ? "Bình luận tại diễn đàn"
          : (chapterContext.chapterLabel || "Bình luận tại trang truyện"),
        contentPreview: contentPreview || "(Bình luận trống)",
        commentUrl: commentPath,
        timeAgo: createdAtMs ? formatTimeAgo(createdAtMs) : ""
      };
    });

    const viewerUserId = viewer && viewer.id ? String(viewer.id).trim() : "";
    const profileUserId = profileRow && profileRow.id ? String(profileRow.id).trim() : "";
    const canMessageProfile = Boolean(viewerUserId && profileUserId && viewerUserId !== profileUserId);
    const messageProfileUrl = canMessageProfile ? `/messages?with=${encodeURIComponent(profileUserId)}` : "";

    return res.render("user-profile", {
      title: `@${profileRow.username || username}`,
      team,
      profile: {
        id: profileRow.id,
        username: profileRow.username || username,
        displayName: (profileRow.display_name || "").toString().trim(),
        avatarUrl: normalizeAvatarUrl(profileRow.avatar_url || ""),
        bio: normalizeProfileBio(profileRow.bio || ""),
        facebookUrl: normalizeCommunityUrl(profileRow.facebook_url || ""),
        discordUrl: normalizeCommunityUrl(profileRow.discord_handle || ""),
        joinedAt: Number(profileRow.created_at) || 0,
        badges: profileBadges,
        commentCount,
        recentComments,
        team: teamRow
          ? {
            id: Number(teamRow.team_id),
            name: teamRow.team_name || "",
            slug: teamRow.team_slug || "",
            role: teamRow.role || "member",
            roleLabel: buildTeamRoleLabel({ role: teamRow.role, teamName: teamRow.team_name })
          }
          : null
      },
      profileActions: {
        canMessage: canMessageProfile,
        messageUrl: messageProfileUrl
      },
      seo: buildSeoPayload(req, {
        title: `@${profileRow.username || username}`,
        description: normalizeSeoText(profileRow.bio || `Trang thành viên ${profileRow.username || username}`, 180),
        canonicalPath: `/user/${encodeURIComponent(profileRow.username || username)}`,
        robots: SEO_ROBOTS_NOINDEX,
        ogType: "profile"
      })
    });
  })
);

app.get("/privacy-policy", (req, res) => {
  res.render("privacy-policy", {
    title: "Privacy Policy",
    team,
    seo: buildSeoPayload(req, {
      title: "Privacy Policy",
      description: "Privacy Policy for BFANG Team web services and OAuth login.",
      robots: SEO_ROBOTS_NOINDEX,
      canonicalPath: "/privacy-policy"
    })
  });
});

app.get("/terms-of-service", (req, res) => {
  res.render("terms-of-service", {
    title: "Terms of Service",
    team,
    seo: buildSeoPayload(req, {
      title: "Terms of Service",
      description: "Terms of Service for using BFANG Team website and related features.",
      robots: SEO_ROBOTS_NOINDEX,
      canonicalPath: "/terms-of-service"
    })
  });
});

app.get("/robots.txt", (req, res) => {
  const origin = getPublicOriginFromRequest(req);
  const sitemapUrl = origin ? `${origin}/sitemap.xml` : "/sitemap.xml";

  res.type("text/plain; charset=utf-8");
  return res.send(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /admin/",
      "Disallow: /forum/admin",
      "Disallow: /forum/admin/",
      "Disallow: /account",
      "Disallow: /auth/",
      "Disallow: /publish",
      "Disallow: /messages",
      "Disallow: /user/",
      "Disallow: /privacy-policy",
      "Disallow: /terms-of-service",
      "",
      `Sitemap: ${sitemapUrl}`
    ].join("\n")
  );
});

app.get(
  "/sitemap.xml",
  asyncHandler(async (req, res) => {
    const origin = getPublicOriginFromRequest(req) || "";
    const cacheKey = origin || "__default__";
    const now = Date.now();
    const cached = sitemapCacheByOrigin.get(cacheKey);

    res.type("application/xml");
    res.set("Cache-Control", "public, max-age=600, stale-while-revalidate=3600");

    if (cached && cached.expiresAt > now) {
      const requestEtag = (req.get("if-none-match") || "").toString();
      if (requestEtag && requestEtag.includes(cached.etag)) {
        res.set("ETag", cached.etag);
        return res.status(304).end();
      }
      res.set("ETag", cached.etag);
      return res.send(cached.xmlBody);
    }

    const baseUrls = [
      {
        loc: toAbsolutePublicUrl(req, "/"),
        changefreq: "daily",
        priority: "1.0"
      },
      {
        loc: toAbsolutePublicUrl(req, "/manga"),
        changefreq: "daily",
        priority: "0.9"
      },
      {
        loc: toAbsolutePublicUrl(req, "/amp"),
        changefreq: "daily",
        priority: "0.5"
      }
    ];

    const [mangaRows, chapterRows, teamRows] = await Promise.all([
      dbAll(
        "SELECT slug, updated_at FROM manga WHERE COALESCE(is_hidden, 0) = 0 ORDER BY updated_at DESC, id DESC"
      ),
      dbAll(
        `
          SELECT
            m.slug,
            c.number,
            COALESCE(NULLIF(TRIM(c.date), ''), m.updated_at) as updated_at
          FROM chapters c
          JOIN manga m ON m.id = c.manga_id
          WHERE COALESCE(m.is_hidden, 0) = 0
          ORDER BY m.id ASC, c.number DESC
        `
      ),
      dbAll(
        `
          SELECT id, slug, COALESCE(updated_at, created_at) AS updated_at
          FROM translation_teams
          WHERE status = 'approved'
          ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
        `
      )
    ]);

    const urlEntries = baseUrls.slice();

    mangaRows.forEach((row) => {
      const slug = row && row.slug ? String(row.slug).trim() : "";
      if (!slug) return;

      const encodedSlug = encodeURIComponent(slug);

      urlEntries.push({
        loc: toAbsolutePublicUrl(req, `/manga/${encodedSlug}`),
        lastmod: toIsoDate(row.updated_at),
        changefreq: "daily",
        priority: "0.8"
      });

      urlEntries.push({
        loc: toAbsolutePublicUrl(req, `/amp/manga/${encodedSlug}`),
        lastmod: toIsoDate(row.updated_at),
        changefreq: "daily",
        priority: "0.4"
      });
    });

    chapterRows.forEach((row) => {
      const slug = row && row.slug ? String(row.slug).trim() : "";
      const chapterNumber = row && row.number != null ? String(row.number).trim() : "";
      if (!slug || !chapterNumber) return;

      urlEntries.push({
        loc: toAbsolutePublicUrl(
          req,
          `/manga/${encodeURIComponent(slug)}/chapters/${encodeURIComponent(chapterNumber)}`
        ),
        lastmod: toIsoDate(row.updated_at),
        changefreq: "weekly",
        priority: "0.7"
      });
    });

    teamRows.forEach((row) => {
      const teamId = Number(row && row.id);
      const teamSlug = row && row.slug ? String(row.slug).trim() : "";
      if (!Number.isFinite(teamId) || teamId <= 0 || !teamSlug) return;

      urlEntries.push({
        loc: toAbsolutePublicUrl(
          req,
          `/team/${encodeURIComponent(String(Math.floor(teamId)))}/${encodeURIComponent(teamSlug)}`
        ),
        lastmod: toIsoDate(row.updated_at),
        changefreq: "weekly",
        priority: "0.6"
      });
    });

    const xmlBody = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urlEntries.map((item) => {
        const loc = escapeXml(item.loc || "");
        const lastmod = item.lastmod ? `<lastmod>${escapeXml(item.lastmod)}</lastmod>` : "";
        const changefreq = item.changefreq ? `<changefreq>${escapeXml(item.changefreq)}</changefreq>` : "";
        const priority = item.priority ? `<priority>${escapeXml(item.priority)}</priority>` : "";
        return `<url><loc>${loc}</loc>${lastmod}${changefreq}${priority}</url>`;
      }),
      "</urlset>"
    ].join("");

    const etag = `"${crypto.createHash("sha1").update(xmlBody).digest("hex")}"`;
    sitemapCacheByOrigin.set(cacheKey, {
      etag,
      xmlBody,
      expiresAt: now + sitemapCacheTtlMs
    });

    res.set("ETag", etag);
    return res.send(xmlBody);
  })
);

app.get(
  "/account/me",
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;

    const profileRow = await upsertUserProfileFromAuthUser(user);
    const badgeContext = await getUserBadgeContext(profileRow && profileRow.id ? profileRow.id : "");
    return res.json({
      ok: true,
      profile: {
        ...mapPublicUserRow(profileRow),
        badges: badgeContext.badges,
        userColor: badgeContext.userColor,
        permissions: badgeContext.permissions
      }
    });
  })
);

app.get(
  "/account/reading-history",
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;
    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }

    try {
      await ensureUserRowFromAuthUser(user);
    } catch (err) {
      console.warn("Failed to ensure user row for reading history", err);
    }

    const rows = await dbAll(
      `
      SELECT
        rh.user_id,
        rh.manga_id,
        rh.chapter_number,
        rh.updated_at,
        m.title as manga_title,
        m.slug as manga_slug,
        m.author as manga_author,
        m.group_name as manga_group_name,
        m.genres as manga_genres,
        m.cover as manga_cover,
        COALESCE(m.cover_updated_at, 0) as manga_cover_updated_at,
        m.status as manga_status,
        COALESCE(c.title, '') as chapter_title,
        COALESCE(c.is_oneshot, false) as chapter_is_oneshot,
        (SELECT number FROM chapters c2 WHERE c2.manga_id = m.id ORDER BY number DESC LIMIT 1)
          as latest_chapter_number,
        (SELECT COALESCE(c2.is_oneshot, false) FROM chapters c2 WHERE c2.manga_id = m.id ORDER BY number DESC LIMIT 1)
          as latest_chapter_is_oneshot
      FROM reading_history rh
      JOIN manga m ON m.id = rh.manga_id
      LEFT JOIN chapters c ON c.manga_id = rh.manga_id AND c.number = rh.chapter_number
      WHERE rh.user_id = ?
        AND COALESCE(m.is_hidden, 0) = 0
      ORDER BY rh.updated_at DESC, rh.manga_id DESC
      LIMIT ?
    `,
      [userId, READING_HISTORY_MAX_ITEMS]
    );

    const history = rows.map(mapReadingHistoryRow);
    return res.json({ ok: true, history });
  })
);

app.post(
  "/account/reading-history",
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;
    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }

    try {
      await ensureUserRowFromAuthUser(user);
    } catch (err) {
      console.warn("Failed to ensure user row for reading history upsert", err);
    }

    const mangaSlug = (req.body && req.body.mangaSlug ? String(req.body.mangaSlug) : "").trim();
    const chapterNumber = parseChapterNumberInput(req.body ? req.body.chapterNumber : null);
    if (!mangaSlug || chapterNumber == null || chapterNumber < 0) {
      return res.status(400).json({ ok: false, error: "Thiếu thông tin lịch sử đọc." });
    }

    const mangaRow = await dbGet(
      "SELECT id, slug FROM manga WHERE slug = ? AND COALESCE(is_hidden, 0) = 0",
      [mangaSlug]
    );
    if (!mangaRow) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy truyện." });
    }

    const chapterRow = await dbGet(
      "SELECT number FROM chapters WHERE manga_id = ? AND number = ? LIMIT 1",
      [mangaRow.id, chapterNumber]
    );
    if (!chapterRow) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
    }

    const stamp = Date.now();
    await withTransaction(async ({ dbRun: txRun }) => {
      await txRun(
        `
        INSERT INTO reading_history (user_id, manga_id, chapter_number, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id, manga_id)
        DO UPDATE SET
          chapter_number = EXCLUDED.chapter_number,
          updated_at = EXCLUDED.updated_at
      `,
        [userId, mangaRow.id, chapterNumber, stamp]
      );

      await txRun(
        `
        WITH keep AS (
          SELECT manga_id
          FROM reading_history
          WHERE user_id = ?
          ORDER BY updated_at DESC, manga_id DESC
          LIMIT ?
        )
        DELETE FROM reading_history
        WHERE user_id = ?
          AND manga_id NOT IN (SELECT manga_id FROM keep)
      `,
        [userId, READING_HISTORY_MAX_ITEMS, userId]
      );
    });

    return res.json({ ok: true });
  })
);

app.get(
  "/account/bookmarks",
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;
    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }

    try {
      await ensureUserRowFromAuthUser(user);
    } catch (err) {
      console.warn("Failed to ensure user row for bookmarks", err);
    }

    const totalRow = await dbGet(
      `
        SELECT COUNT(*) as count
        FROM manga_bookmarks mb
        JOIN manga m ON m.id = mb.manga_id
        WHERE mb.user_id = ?
          AND COALESCE(m.is_hidden, 0) = 0
      `,
      [userId]
    );
    const totalCount = totalRow ? Number(totalRow.count) || 0 : 0;

    const pagination = resolvePaginationParams({
      pageInput: req.query.page,
      perPageInput: req.query.limit,
      defaultPerPage: BOOKMARKS_PER_PAGE,
      maxPerPage: BOOKMARKS_PER_PAGE,
      totalCount
    });

    const rows = await dbAll(
      `
        SELECT
          mb.user_id,
          mb.manga_id,
          mb.created_at,
          mb.updated_at,
          m.title as manga_title,
          m.slug as manga_slug,
          m.author as manga_author,
          m.group_name as manga_group_name,
          m.genres as manga_genres,
          m.status as manga_status,
          m.cover as manga_cover,
          COALESCE(m.cover_updated_at, 0) as manga_cover_updated_at,
          COALESCE(m.is_oneshot, false) as manga_is_oneshot,
          latest.number as latest_chapter_number,
          COALESCE(latest.is_oneshot, false) as latest_chapter_is_oneshot
        FROM manga_bookmarks mb
        JOIN manga m ON m.id = mb.manga_id
        LEFT JOIN LATERAL (
          SELECT number, COALESCE(is_oneshot, false) as is_oneshot
          FROM chapters c
          WHERE c.manga_id = m.id
          ORDER BY number DESC
          LIMIT 1
        ) latest ON true
        WHERE mb.user_id = ?
          AND COALESCE(m.is_hidden, 0) = 0
        ORDER BY mb.updated_at DESC, mb.manga_id DESC
        LIMIT ? OFFSET ?
      `,
      [userId, pagination.perPage, pagination.offset]
    );

    const items = rows.map((row) => {
      const mangaSlug = row && row.manga_slug ? String(row.manga_slug).trim() : "";
      const latestChapterNumber = row && row.latest_chapter_number != null ? Number(row.latest_chapter_number) : NaN;
      const latestChapterNumberText = Number.isFinite(latestChapterNumber)
        ? formatChapterNumberValue(latestChapterNumber)
        : "";
      const latestChapterIsOneshot = toBooleanFlag(row && row.latest_chapter_is_oneshot);
      const mangaGenres = (row && row.manga_genres ? String(row.manga_genres) : "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      return {
        mangaId: row && row.manga_id != null ? Number(row.manga_id) : 0,
        mangaTitle: row && row.manga_title ? String(row.manga_title).trim() : "",
        mangaSlug,
        mangaUrl: mangaSlug ? `/manga/${encodeURIComponent(mangaSlug)}` : "",
        mangaAuthor: row && row.manga_author ? String(row.manga_author).trim() : "",
        mangaGroupName: row && row.manga_group_name ? String(row.manga_group_name).trim() : "",
        mangaStatus: row && row.manga_status ? String(row.manga_status).trim() : "",
        mangaGenres,
        mangaCover: row && row.manga_cover ? String(row.manga_cover) : "",
        mangaCoverUpdatedAt: Number(row && row.manga_cover_updated_at) || 0,
        latestChapterNumber: Number.isFinite(latestChapterNumber) ? latestChapterNumber : null,
        latestChapterNumberText,
        latestChapterIsOneshot,
        latestChapterLabel: latestChapterIsOneshot
          ? "Oneshot"
          : latestChapterNumberText
            ? `Ch. ${latestChapterNumberText}`
            : "",
        latestChapterUrl:
          mangaSlug && latestChapterNumberText
            ? `/manga/${encodeURIComponent(mangaSlug)}/chapters/${encodeURIComponent(latestChapterNumberText)}`
            : "",
        bookmarkedAt: Number(row && row.updated_at) || Number(row && row.created_at) || 0,
        bookmarkedAtText:
          Number(row && row.updated_at) > 0
            ? formatTimeAgo(Number(row.updated_at))
            : Number(row && row.created_at) > 0
              ? formatTimeAgo(Number(row.created_at))
              : ""
      };
    });

    return res.json({
      ok: true,
      items,
      pagination
    });
  })
);

app.post(
  "/account/bookmarks/toggle",
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;
    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }

    try {
      await ensureUserRowFromAuthUser(user);
    } catch (err) {
      console.warn("Failed to ensure user row for bookmark toggle", err);
    }

    const mangaSlug = (req.body && req.body.mangaSlug ? String(req.body.mangaSlug) : "").trim();
    if (!mangaSlug) {
      return res.status(400).json({ ok: false, error: "Thiếu slug truyện." });
    }

    const mangaRow = await dbGet(
      "SELECT id, slug, title FROM manga WHERE slug = ? AND COALESCE(is_hidden, 0) = 0 LIMIT 1",
      [mangaSlug]
    );
    if (!mangaRow) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy truyện." });
    }

    const timestamp = Date.now();
    const result = await withTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
      const existing = await txGet(
        "SELECT 1 as ok FROM manga_bookmarks WHERE user_id = ? AND manga_id = ? LIMIT 1",
        [userId, mangaRow.id]
      );

      if (existing && existing.ok) {
        await txRun("DELETE FROM manga_bookmarks WHERE user_id = ? AND manga_id = ?", [userId, mangaRow.id]);
        return {
          bookmarked: false
        };
      }

      await txRun(
        `
          INSERT INTO manga_bookmarks (user_id, manga_id, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (user_id, manga_id)
          DO UPDATE SET updated_at = EXCLUDED.updated_at
        `,
        [userId, mangaRow.id, timestamp, timestamp]
      );

      return {
        bookmarked: true
      };
    });

    return res.json({
      ok: true,
      bookmarked: Boolean(result && result.bookmarked),
      mangaId: Number(mangaRow.id) || 0,
      mangaSlug: String(mangaRow.slug || "").trim(),
      mangaTitle: String(mangaRow.title || "").trim()
    });
  })
);

app.post(
  "/account/bookmarks/remove",
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;
    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }

    try {
      await ensureUserRowFromAuthUser(user);
    } catch (err) {
      console.warn("Failed to ensure user row for bookmark removal", err);
    }

    const mangaIdRaw = Number(req.body && req.body.mangaId);
    const mangaSlugRaw = (req.body && req.body.mangaSlug ? String(req.body.mangaSlug) : "").trim();

    let mangaId = Number.isFinite(mangaIdRaw) && mangaIdRaw > 0 ? Math.floor(mangaIdRaw) : 0;
    if (!mangaId && mangaSlugRaw) {
      const mangaRow = await dbGet("SELECT id FROM manga WHERE slug = ? LIMIT 1", [mangaSlugRaw]);
      mangaId = mangaRow && mangaRow.id ? Number(mangaRow.id) || 0 : 0;
    }
    if (!mangaId) {
      return res.status(400).json({ ok: false, error: "Thiếu truyện cần gỡ bookmark." });
    }

    const removed = await dbRun("DELETE FROM manga_bookmarks WHERE user_id = ? AND manga_id = ?", [userId, mangaId]);

    return res.json({
      ok: true,
      removed: Boolean(removed && removed.changes),
      mangaId
    });
  })
);

app.post(
  "/account/avatar/upload",
  uploadAvatar,
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, error: "Chưa chọn ảnh avatar." });
    }

    let output = null;
    try {
      output = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 256, height: 256, fit: "cover" })
        .webp({ quality: 76, effort: 6 })
        .toBuffer();
    } catch (_err) {
      return res.status(400).json({ ok: false, error: "Ảnh avatar không hợp lệ." });
    }

    const userId = String(user.id || "").trim();
    const safeId = userId.replace(/[^a-z0-9_-]+/gi, "").slice(0, 80) || "user";
    const fileName = `u-${safeId}.webp`;
    const filePath = path.join(avatarsDir, fileName);
    const stamp = Date.now();

    await fs.promises.writeFile(filePath, output);
    const avatarUrl = `/uploads/avatars/${fileName}?v=${stamp}`;

    try {
      await ensureUserRowFromAuthUser(user);
      await dbRun("UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?", [
        avatarUrl,
        stamp,
        userId
      ]);
    } catch (err) {
      console.warn("Failed to update user avatar", err);
    }

    return res.json({ ok: true, avatarUrl });
  })
);

app.post(
  "/account/profile/sync",
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;

    const author = buildCommentAuthorFromAuthUser(user);
    const authorEmail = user.email ? String(user.email).trim() : "";
    let authorAvatarUrl = buildAvatarUrlFromAuthUser(
      user,
      user && user.bfangAvatarUrl ? user.bfangAvatarUrl : ""
    );
    const authorUserId = String(user.id || "").trim();
    if (!authorUserId) {
      return res.status(400).json({ ok: false, error: "Không xác định được người dùng." });
    }

    let profileRow = null;
    try {
      profileRow = await upsertUserProfileFromAuthUser(user);
      if (profileRow && profileRow.avatar_url) {
        authorAvatarUrl = normalizeAvatarUrl(profileRow.avatar_url);
      }
    } catch (err) {
      console.warn("Failed to sync user profile", err);
    }

    const badgeContext = await getUserBadgeContext(authorUserId);

    const result = await dbRun(
      "UPDATE comments SET author = ?, author_email = ?, author_avatar_url = ? WHERE author_user_id = ?",
      [author, authorEmail, authorAvatarUrl, authorUserId]
    );

    return res.json({
      ok: true,
      updated: result && result.changes ? result.changes : 0,
      profile: profileRow
        ? {
          ...mapPublicUserRow(profileRow),
          badges: badgeContext.badges,
          userColor: badgeContext.userColor,
          permissions: badgeContext.permissions
        }
        : null
    });
  })
);

const resolveHomepagePayload = async () => {
  const now = Date.now();
  let homepagePayload = homepageCachePayload;

  if (!homepagePayload || homepageCacheExpiresAt <= now) {
    const homepageRow = await dbGet("SELECT * FROM homepage WHERE id = 1");
    const homepageData = normalizeHomepageRow(homepageRow);
    const notices = buildHomepageNotices(homepageData);
    const featuredIds = homepageData.featuredIds;
    let featuredRows = [];

    if (featuredIds.length > 0) {
      const placeholders = featuredIds.map(() => "?").join(",");
      const rows = await dbAll(
        `${listQueryBase} WHERE m.id IN (${placeholders}) AND COALESCE(m.is_hidden, 0) = 0`,
        featuredIds
      );
      const rowMap = new Map(rows.map((row) => [row.id, row]));
      featuredRows = featuredIds.map((id) => rowMap.get(id)).filter(Boolean);
    }

    if (featuredRows.length === 0) {
      featuredRows = await dbAll(
        `${listQueryBase} WHERE COALESCE(m.is_hidden, 0) = 0 ${listQueryOrder} LIMIT 3`
      );
    }

    const latestRows = await dbAll(
      `${listQueryBase} WHERE COALESCE(m.is_hidden, 0) = 0 ${listQueryOrder} LIMIT ${HOMEPAGE_LATEST_LIMIT}`
    );
    const totalSeriesRow = await dbGet(
      "SELECT COUNT(*) as count FROM manga WHERE COALESCE(is_hidden, 0) = 0"
    );
    const totalsRow = await dbGet(
      `
      SELECT COUNT(*) as total_chapters
      FROM chapters c
      JOIN manga m ON m.id = c.manga_id
      WHERE COALESCE(m.is_hidden, 0) = 0
    `
    );

    const mappedFeatured = featuredRows.map(mapMangaListRow);
    const mappedLatest = latestRows.map(mapMangaListRow);
    const cdnBaseUrl = getB2Config().cdnBaseUrl;
    let randomPageSlices = [];

    if (cdnBaseUrl) {
      const randomSliceRows = await dbAll(
        `
          SELECT
            m.id AS manga_id,
            m.slug AS manga_slug,
            m.title AS manga_title,
            c.number AS chapter_number,
            c.pages AS page_count,
            c.pages_prefix,
            c.pages_ext,
            c.pages_updated_at
          FROM chapters c
          JOIN manga m ON m.id = c.manga_id
          WHERE COALESCE(m.is_hidden, 0) = 0
            AND COALESCE(c.pages, 0) > 4
            AND COALESCE(c.processing_state, '') <> 'processing'
            AND COALESCE(c.pages_prefix, '') <> ''
            AND COALESCE(c.pages_ext, '') <> ''
          ORDER BY RANDOM()
          LIMIT ${HOMEPAGE_RANDOM_SLICE_LIMIT}
        `
      );

      randomPageSlices = randomSliceRows
        .map((row, index) => {
          const mangaSlug = (row && row.manga_slug ? row.manga_slug : "").toString().trim();
          const chapterNumberRaw = row && row.chapter_number != null ? row.chapter_number : "";
          const chapterNumberText = String(chapterNumberRaw).trim();
          const pageCount = Math.max(Number(row && row.page_count) || 0, 0);
          if (!mangaSlug || !chapterNumberText || pageCount <= 4) return null;

          const randomPage = Math.floor(Math.random() * (pageCount - 4)) + 3;
          const pageName = String(randomPage).padStart(Math.max(3, String(pageCount).length), "0");
          const rawImageUrl = `${cdnBaseUrl}/${row.pages_prefix}/${pageName}.${row.pages_ext}`;

          return {
            key: `${row.manga_id || "m"}-${chapterNumberText}-${randomPage}-${index}`,
            href: `/manga/${encodeURIComponent(mangaSlug)}/chapters/${encodeURIComponent(chapterNumberText)}`,
            imageUrl: cacheBust(rawImageUrl, row.pages_updated_at),
            mangaTitle: (row && row.manga_title ? row.manga_title : "").toString().trim(),
            chapterNumber: chapterNumberText,
            pageNumber: randomPage
          };
        })
        .filter(Boolean);
    }

    homepagePayload = {
      featured: mappedFeatured,
      randomPageSlices,
      latest: mappedLatest,
      homepage: {
        notices
      },
      stats: {
        totalSeries: totalSeriesRow ? totalSeriesRow.count : 0,
        totalChapters: totalsRow
          ? Number(totalsRow.total_chapters ?? totalsRow.totalchapters ?? totalsRow.totalChapters) || 0
          : 0
      }
    };
    homepageCachePayload = homepagePayload;
    homepageCacheExpiresAt = now + HOMEPAGE_CACHE_TTL_MS;
  }

  return homepagePayload;
};

const buildHomepageSeoImage = (homepagePayload) =>
  homepagePayload && homepagePayload.featured && homepagePayload.featured.length && homepagePayload.featured[0].cover
    ? homepagePayload.featured[0].cover
    : "";

app.get(
  "/",
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", FAST_NAV_PAGE_CACHE_CONTROL);

    const homepagePayload = await resolveHomepagePayload();
    const seoImage = buildHomepageSeoImage(homepagePayload);
    const homepageKeywords = buildSeoKeywordList([
      SEO_TRENDING_KEYWORDS,
      "đọc manga online",
      "manga Việt hóa",
      "truyện tranh mới mỗi ngày",
      homepagePayload.featured.map((item) => item && item.title).slice(0, 6)
    ]);
    const homepageSchemas = compactJsonLdList([
      buildOrganizationSchema(req),
      buildWebsiteSchema(req),
      buildCollectionPageSchema(req, {
        path: "/",
        name: `${SEO_SITE_NAME} - Trang chủ đọc truyện tranh`,
        description: "Trang chủ BFANG Team với danh sách manga nổi bật, truyện mới cập nhật mỗi ngày.",
        image: seoImage,
        keywords: homepageKeywords
      }),
      buildBreadcrumbSchema(req, [{ name: "Trang chủ", path: "/" }])
    ]);

    res.render("index", {
      title: "Trang chủ",
      team,
      featured: homepagePayload.featured,
      randomPageSlices: homepagePayload.randomPageSlices,
      latest: homepagePayload.latest,
      homepage: homepagePayload.homepage,
      stats: homepagePayload.stats,
      seo: buildSeoPayload(req, {
        title: "BFANG Team - nhóm dịch truyện tranh",
        description: "Đọc truyện tranh online và manga tiếng Việt mới nhất tại BFANG Team, cập nhật chương liên tục mỗi ngày.",
        keywords: homepageKeywords,
        canonicalPath: "/",
        ampHtml: "/amp",
        image: seoImage,
        ogType: "website",
        jsonLd: homepageSchemas
      })
    });
  })
);

app.get(
  "/amp",
  asyncHandler(async (req, res) => {
    const homepagePayload = await resolveHomepagePayload();

    res.render("index-amp", {
      title: "Trang chủ",
      team,
      featured: homepagePayload.featured,
      latest: homepagePayload.latest,
      stats: homepagePayload.stats,
      canonicalUrl: toAbsolutePublicUrl(req, "/"),
      webUrl: toAbsolutePublicUrl(req, "/")
    });
  })
);

app.get(
  "/manga",
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", FAST_NAV_PAGE_CACHE_CONTROL);

    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const rawInclude = req.query.include;
    const rawExclude = req.query.exclude;
    const legacyGenre = typeof req.query.genre === "string" ? req.query.genre.trim() : "";
    const include = [];
    const exclude = [];

    const genreStats = await getGenreStats();
    const genreIdByName = new Map(
      genreStats.map((genre) => [genre.name.toLowerCase(), genre.id])
    );

    const addFilter = (target, value) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      let resolvedId = null;
      if (/^\d+$/.test(trimmed)) {
        resolvedId = Number(trimmed);
      } else {
        resolvedId = genreIdByName.get(trimmed.toLowerCase()) || null;
      }

      if (!Number.isFinite(resolvedId) || resolvedId <= 0) return;
      const id = Math.floor(resolvedId);
      if (!target.includes(id)) target.push(id);
    };

    const collectFilters = (input, target) => {
      if (Array.isArray(input)) {
        input.forEach((value) => {
          if (typeof value === "string") {
            addFilter(target, value);
          }
        });
        return;
      }
      if (typeof input === "string") {
        addFilter(target, input);
      }
    };

    collectFilters(rawInclude, include);
    collectFilters(rawExclude, exclude);
    if (legacyGenre) {
      addFilter(include, legacyGenre);
    }

    const includeSet = new Set(include);
    const filteredExclude = exclude.filter((id) => !includeSet.has(id));

    const conditions = [];
    const params = [];

    conditions.push("COALESCE(m.is_hidden, 0) = 0");

    const qNormalized = q.replace(/^#/, "").trim();
    const qId = /^\d+$/.test(qNormalized) ? Number(qNormalized) : null;
    if (qNormalized) {
      const likeValue = `%${qNormalized}%`;
      if (qId) {
        conditions.push(
          `(
            m.id = ?
            OR m.title ILIKE ?
            OR m.author ILIKE ?
            OR COALESCE(m.group_name, '') ILIKE ?
            OR COALESCE(m.other_names, '') ILIKE ?
            OR EXISTS (
              SELECT 1
              FROM manga_genres mg
              JOIN genres g ON g.id = mg.genre_id
              WHERE mg.manga_id = m.id AND g.name ILIKE ?
            )
          )`
        );
        params.push(qId, likeValue, likeValue, likeValue, likeValue, likeValue);
      } else {
        conditions.push(
          `(
            m.title ILIKE ?
            OR m.author ILIKE ?
            OR COALESCE(m.group_name, '') ILIKE ?
            OR COALESCE(m.other_names, '') ILIKE ?
            OR EXISTS (
              SELECT 1
              FROM manga_genres mg
              JOIN genres g ON g.id = mg.genre_id
              WHERE mg.manga_id = m.id AND g.name ILIKE ?
            )
          )`
        );
        params.push(likeValue, likeValue, likeValue, likeValue, likeValue);
      }
    }

    include.forEach((genre) => {
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM manga_genres mg
          WHERE mg.manga_id = m.id AND mg.genre_id = ?
        )`
      );
      params.push(genre);
    });

    filteredExclude.forEach((genre) => {
      conditions.push(
        `NOT EXISTS (
          SELECT 1
          FROM manga_genres mg
          WHERE mg.manga_id = m.id AND mg.genre_id = ?
        )`
      );
      params.push(genre);
    });

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countRow = await dbGet(`SELECT COUNT(*) as count FROM manga m ${whereClause}`, params);
    const pagination = resolvePaginationParams({
      pageInput: req.query.page,
      perPageInput: req.query.perPage,
      defaultPerPage: 24,
      maxPerPage: 60,
      totalCount: countRow && countRow.count ? Number(countRow.count) : 0
    });

    const query = `${listQueryBase} ${whereClause} ${listQueryOrder} LIMIT ? OFFSET ?`;
    const mangaRows = await dbAll(query, [...params, pagination.perPage, pagination.offset]);
    const mangaLibrary = mangaRows.map(mapMangaListRow);
    const hasFilters = Boolean(q || include.length || filteredExclude.length);
    const seoTitleQuery = normalizeSeoText(q, 55);
    const seoTitle = seoTitleQuery
      ? `Tìm manga: ${seoTitleQuery}`
      : hasFilters
        ? "Lọc manga BFANG Team"
        : "Toàn bộ manga";
    const seoDescription = hasFilters
      ? "Kết quả tìm kiếm và lọc manga trên BFANG Team. Mở bộ lọc để xem toàn bộ thư viện truyện."
      : "Thư viện manga đầy đủ của BFANG Team, cập nhật liên tục theo nhóm dịch và thể loại.";
    const shouldNoIndex = hasFilters || pagination.page > 1;
    const genreNameById = new Map(genreStats.map((genre) => [Number(genre.id), (genre.name || "").toString().trim()]));
    const includeGenreNames = include.map((id) => genreNameById.get(Number(id)) || "").filter(Boolean);
    const excludeGenreNames = filteredExclude
      .map((id) => genreNameById.get(Number(id)) || "")
      .filter(Boolean);
    const mangaListKeywords = buildSeoKeywordList([
      SEO_TRENDING_KEYWORDS,
      "thư viện manga",
      "lọc thể loại manga",
      qNormalized,
      includeGenreNames,
      excludeGenreNames.map((name) => `không gồm ${name}`)
    ]);
    const mangaListSchemas = shouldNoIndex
      ? []
      : compactJsonLdList([
        buildOrganizationSchema(req),
        buildWebsiteSchema(req),
        buildCollectionPageSchema(req, {
          path: "/manga",
          name: seoTitle,
          description: seoDescription,
          image: mangaLibrary.length && mangaLibrary[0].cover ? mangaLibrary[0].cover : "",
          keywords: mangaListKeywords
        }),
        buildBreadcrumbSchema(req, [
          { name: "Trang chủ", path: "/" },
          { name: "Toàn bộ truyện", path: "/manga" }
        ])
      ]);

    res.render("manga", {
      title: "Toàn bộ truyện",
      team,
      mangaLibrary,
      genres: genreStats,
      filters: {
        q,
        include,
        exclude: filteredExclude
      },
      resultCount: pagination.total,
      pagination,
      seo: buildSeoPayload(req, {
        title: seoTitle,
        description: seoDescription,
        keywords: mangaListKeywords,
        canonicalPath: "/manga",
        robots: shouldNoIndex ? SEO_ROBOTS_NOINDEX : SEO_ROBOTS_INDEX,
        image: mangaLibrary.length && mangaLibrary[0].cover ? mangaLibrary[0].cover : "",
        ogType: "website",
        jsonLd: mangaListSchemas
      })
    });
  })
);

app.get(
  "/manga/:slug",
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", FAST_NAV_PAGE_CACHE_CONTROL);

    const requestedSlug = (req.params.slug || "").trim();
    let mangaRow = await dbGet(
      `${listQueryBase} WHERE m.slug = ? AND COALESCE(m.is_hidden, 0) = 0`,
      [requestedSlug]
    );
    if (!mangaRow) {
      const fallbackRows = await dbAll(
        `${listQueryBase} WHERE m.slug LIKE ? AND COALESCE(m.is_hidden, 0) = 0`,
        [`%-${requestedSlug}`]
      );
      if (fallbackRows.length === 1) {
        return res.redirect(301, `/manga/${fallbackRows[0].slug}`);
      }
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team,
        seo: buildSeoPayload(req, {
          title: "Không tìm thấy",
          description: "Trang bạn yêu cầu không tồn tại trên BFANG Team.",
          robots: SEO_ROBOTS_NOINDEX,
          canonicalPath: ensureLeadingSlash(req.path || "/")
        })
      });
    }

    const chapterSummary = await dbGet(
      `
        SELECT
          COUNT(*) as count,
          MAX(number) as latest_number,
          MIN(number) as first_number
        FROM chapters
        WHERE manga_id = ?
      `,
      [mangaRow.id]
    );
    const chapterPagination = resolvePaginationParams({
      pageInput: req.query.chapterPage,
      perPageInput: MANGA_DETAIL_CHAPTERS_PER_PAGE,
      defaultPerPage: MANGA_DETAIL_CHAPTERS_PER_PAGE,
      maxPerPage: MANGA_DETAIL_CHAPTERS_PER_PAGE,
      totalCount: chapterSummary && chapterSummary.count ? Number(chapterSummary.count) : 0
    });

    const chapterRows = await dbAll(
      "SELECT number, title, pages, date, group_name, COALESCE(is_oneshot, false) as is_oneshot FROM chapters WHERE manga_id = ? ORDER BY number DESC LIMIT ? OFFSET ?",
      [mangaRow.id, chapterPagination.perPage, chapterPagination.offset]
    );
    const chapters = chapterRows.map((chapter) => ({
      ...chapter,
      is_oneshot: toBooleanFlag(chapter && chapter.is_oneshot)
    }));
    const latestChapterNumber = chapterSummary && chapterSummary.latest_number != null
      ? formatChapterNumberValue(chapterSummary.latest_number)
      : "";
    const firstChapterNumber = chapterSummary && chapterSummary.first_number != null
      ? formatChapterNumberValue(chapterSummary.first_number)
      : "";

    const commentPageRaw = Number(req.query.commentPage);
    const commentPage =
      Number.isFinite(commentPageRaw) && commentPageRaw > 0 ? Math.floor(commentPageRaw) : 1;
    const commentsFlag = (req.query.comments || "").toString().trim().toLowerCase();
    const commentsRequestedExplicitly =
      commentsFlag === "1" || commentsFlag === "true" || commentsFlag === "yes";
    const hasCommentPageQuery = hasOwnObjectKey(req.query || {}, "commentPage");
    const commentsHydrated = commentsRequestedExplicitly || hasCommentPageQuery;

    let commentData = null;
    if (commentsHydrated) {
      commentData = await getPaginatedCommentTree({
        mangaId: mangaRow.id,
        chapterNumber: null,
        page: commentPage,
        perPage: COMMENT_PANEL_PER_PAGE,
        session: req.session
      });
    } else {
      const initialCommentCount = await resolveVisibleCommentCount({
        mangaId: mangaRow.id,
        chapterNumber: null
      });
      commentData = {
        comments: [],
        count: initialCommentCount,
        pagination: buildDefaultCommentPagination({
          page: 1,
          perPage: COMMENT_PANEL_PER_PAGE,
          totalCount: initialCommentCount
        })
      };
    }

    const mappedManga = mapMangaRow(mangaRow);
    const groupTeamLinks = await listGroupTeamLinks(mangaRow.group_name || "");
    const commentsLoadUrl = `/manga/${encodeURIComponent(mangaRow.slug)}?comments=1`;
    const authUserId =
      req && req.session && req.session.authUserId
        ? String(req.session.authUserId).trim()
        : "";
    const commentComposerEnabled = Boolean(authUserId);
    let mangaBookmarked = false;
    if (authUserId) {
      const bookmarkRow = await dbGet(
        "SELECT 1 as ok FROM manga_bookmarks WHERE user_id = ? AND manga_id = ? LIMIT 1",
        [authUserId, mangaRow.id]
      );
      mangaBookmarked = Boolean(bookmarkRow && bookmarkRow.ok);
    }
    const mangaDescription = normalizeSeoText(
      mangaRow.description || `Đọc manga ${mangaRow.title} tại BFANG Team.`,
      180
    );
    const canonicalPath = `/manga/${encodeURIComponent(mangaRow.slug)}`;
    const ampPath = `/amp/manga/${encodeURIComponent(mangaRow.slug)}`;
    const mangaKeywords = buildSeoKeywordList([
      SEO_TRENDING_KEYWORDS,
      mangaRow.title,
      `đọc ${mangaRow.title}`,
      splitSeoNameTokens(mangaRow.author || ""),
      splitSeoNameTokens(mangaRow.group_name || ""),
      Array.isArray(mappedManga.genres) ? mappedManga.genres : [],
      mappedManga.status || ""
    ]);
    const mangaSchemas = compactJsonLdList([
      buildOrganizationSchema(req),
      buildWebsiteSchema(req),
      buildCollectionPageSchema(req, {
        path: canonicalPath,
        name: `${mangaRow.title} | Đọc manga`,
        description: mangaDescription,
        image: mappedManga.cover || "",
        keywords: mangaKeywords
      }),
      buildBreadcrumbSchema(req, [
        { name: "Trang chủ", path: "/" },
        { name: "Toàn bộ truyện", path: "/manga" },
        { name: mangaRow.title, path: canonicalPath }
      ]),
      buildMangaSeriesSchema(req, {
        manga: mappedManga,
        canonicalPath,
        description: mangaDescription,
        chapterCount: chapterPagination.total
      })
    ]);

    return res.render("manga-detail", {
      title: mangaRow.title,
      team,
      manga: {
        ...mappedManga,
        chapters,
        latestChapterNumber,
        firstChapterNumber,
        groupTeamLinks
      },
      chapterPagination,
      comments: commentData.comments,
      commentCount: commentData.count,
      commentPagination: commentData.pagination,
      commentsHydrated,
      commentsLoadUrl,
      commentComposerEnabled,
      mangaBookmarked,
      seo: buildSeoPayload(req, {
        title: `${mangaRow.title} | Đọc manga`,
        description: mangaDescription,
        keywords: mangaKeywords,
        canonicalPath,
        ampHtml: ampPath,
        image: mappedManga.cover || "",
        ogType: "article",
        jsonLd: mangaSchemas
      })
    });
  })
);

app.get(
  "/amp/manga/:slug",
  asyncHandler(async (req, res) => {
    const requestedSlug = (req.params.slug || "").trim();
    let mangaRow = await dbGet(
      `${listQueryBase} WHERE m.slug = ? AND COALESCE(m.is_hidden, 0) = 0`,
      [requestedSlug]
    );

    if (!mangaRow) {
      const fallbackRows = await dbAll(
        `${listQueryBase} WHERE m.slug LIKE ? AND COALESCE(m.is_hidden, 0) = 0`,
        [`%-${requestedSlug}`]
      );
      if (fallbackRows.length === 1) {
        return res.redirect(301, `/amp/manga/${fallbackRows[0].slug}`);
      }
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team,
        seo: buildSeoPayload(req, {
          title: "Không tìm thấy",
          description: "Trang bạn yêu cầu không tồn tại trên BFANG Team.",
          robots: SEO_ROBOTS_NOINDEX,
          canonicalPath: ensureLeadingSlash(req.path || "/")
        })
      });
    }

    const chapterRows = await dbAll(
      "SELECT number, title, pages, date, group_name, COALESCE(is_oneshot, false) as is_oneshot FROM chapters WHERE manga_id = ? ORDER BY number DESC",
      [mangaRow.id]
    );
    const chapters = chapterRows.map((chapter) => ({
      ...chapter,
      is_oneshot: toBooleanFlag(chapter && chapter.is_oneshot)
    }));

    const mappedManga = mapMangaRow(mangaRow);
    const groupTeamLinks = await listGroupTeamLinks(mangaRow.group_name || "");
    const canonicalPath = `/manga/${encodeURIComponent(mangaRow.slug)}`;

    return res.render("manga-detail-amp", {
      title: mangaRow.title,
      team,
      manga: {
        ...mappedManga,
        chapters,
        groupTeamLinks
      },
      canonicalUrl: toAbsolutePublicUrl(req, canonicalPath),
      webUrl: toAbsolutePublicUrl(req, canonicalPath)
    });
  })
);

app.get(
  "/manga/:slug/chapters/:number",
  asyncHandler(async (req, res) => {
    const chapterNumber = Number(req.params.number);
    if (!Number.isFinite(chapterNumber)) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team,
        seo: buildSeoPayload(req, {
          title: "Không tìm thấy",
          description: "Trang bạn yêu cầu không tồn tại trên BFANG Team.",
          robots: SEO_ROBOTS_NOINDEX,
          canonicalPath: ensureLeadingSlash(req.path || "/")
        })
      });
    }

    const requestedSlug = (req.params.slug || "").trim();
    let mangaRow = await dbGet(
      `${listQueryBase} WHERE m.slug = ? AND COALESCE(m.is_hidden, 0) = 0`,
      [requestedSlug]
    );
    if (!mangaRow) {
      const fallbackRows = await dbAll(
        `${listQueryBase} WHERE m.slug LIKE ? AND COALESCE(m.is_hidden, 0) = 0`,
        [`%-${requestedSlug}`]
      );
      if (fallbackRows.length === 1) {
        return res.redirect(301, `/manga/${fallbackRows[0].slug}/chapters/${chapterNumber}`);
      }
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team,
        seo: buildSeoPayload(req, {
          title: "Không tìm thấy",
          description: "Trang bạn yêu cầu không tồn tại trên BFANG Team.",
          robots: SEO_ROBOTS_NOINDEX,
          canonicalPath: ensureLeadingSlash(req.path || "/")
        })
      });
    }

    const chapterRow = await dbGet(
      "SELECT number, title, pages, date, pages_prefix, pages_ext, pages_updated_at, processing_state, processing_error, COALESCE(is_oneshot, false) as is_oneshot FROM chapters WHERE manga_id = ? AND number = ?",
      [mangaRow.id, chapterNumber]
    );

    if (!chapterRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team,
        seo: buildSeoPayload(req, {
          title: "Không tìm thấy",
          description: "Trang bạn yêu cầu không tồn tại trên BFANG Team.",
          robots: SEO_ROBOTS_NOINDEX,
          canonicalPath: ensureLeadingSlash(req.path || "/")
        })
      });
    }

    const chapterListRows = await dbAll(
      "SELECT number, title, COALESCE(is_oneshot, false) as is_oneshot FROM chapters WHERE manga_id = ? ORDER BY number DESC",
      [mangaRow.id]
    );
    const chapterList = chapterListRows.map((item) => ({
      ...item,
      is_oneshot: toBooleanFlag(item && item.is_oneshot)
    }));

    const currentIndex = chapterList.findIndex(
      (chapter) => Number(chapter.number) === chapterNumber
    );
    const prevChapter =
      currentIndex >= 0 && currentIndex < chapterList.length - 1
        ? chapterList[currentIndex + 1]
        : null;
    const nextChapter = currentIndex > 0 ? chapterList[currentIndex - 1] : null;
    const pageCount = Math.max(Number(chapterRow.pages) || 0, 0);
    const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
    const isOneshotChapter = toBooleanFlag(mangaRow.is_oneshot) && toBooleanFlag(chapterRow.is_oneshot);

    const cdnBaseUrl = getB2Config().cdnBaseUrl;
    const processingState = (chapterRow.processing_state || "").toString().trim();
    const isProcessing = processingState === "processing";
    const canRenderPages = Boolean(
      !isProcessing && cdnBaseUrl && chapterRow.pages_prefix && chapterRow.pages_ext
    );
    const padLength = Math.max(3, String(pageCount).length);
    const pageUrls = canRenderPages
      ? pages.map((page) => {
        const pageName = String(page).padStart(padLength, "0");
        const rawUrl = `${cdnBaseUrl}/${chapterRow.pages_prefix}/${pageName}.${chapterRow.pages_ext}`;
        return cacheBust(rawUrl, chapterRow.pages_updated_at);
      })
      : [];

    let nextChapterPrefetchUrls = [];
    if (nextChapter && cdnBaseUrl) {
      const nextChapterNumber = Number(nextChapter.number);
      if (Number.isFinite(nextChapterNumber)) {
        const nextChapterRow = await dbGet(
          "SELECT pages, pages_prefix, pages_ext, pages_updated_at, processing_state FROM chapters WHERE manga_id = ? AND number = ?",
          [mangaRow.id, nextChapterNumber]
        );

        const nextProcessingState =
          nextChapterRow && nextChapterRow.processing_state
            ? String(nextChapterRow.processing_state).trim()
            : "";
        const canPrefetchNextChapter = Boolean(
          nextChapterRow &&
            nextProcessingState !== "processing" &&
            nextChapterRow.pages_prefix &&
            nextChapterRow.pages_ext
        );

        if (canPrefetchNextChapter) {
          const nextPageCount = Math.max(Number(nextChapterRow.pages) || 0, 0);
          const prefetchCount = Math.min(3, nextPageCount);
          const nextPadLength = Math.max(3, String(nextPageCount).length);

          nextChapterPrefetchUrls = Array.from({ length: prefetchCount }, (_, idx) => {
            const page = idx + 1;
            const pageName = String(page).padStart(nextPadLength, "0");
            const rawUrl = `${cdnBaseUrl}/${nextChapterRow.pages_prefix}/${pageName}.${nextChapterRow.pages_ext}`;
            return cacheBust(rawUrl, nextChapterRow.pages_updated_at);
          });
        }
      }
    }

    const commentPageRaw = Number(req.query.commentPage);
    const commentPage =
      Number.isFinite(commentPageRaw) && commentPageRaw > 0 ? Math.floor(commentPageRaw) : 1;

    const commentData = await getPaginatedCommentTree({
      mangaId: mangaRow.id,
      chapterNumber: isOneshotChapter ? null : chapterNumber,
      page: commentPage,
      perPage: 20,
      session: req.session
    });
    const commentComposerEnabled = Boolean(
      req &&
        req.session &&
        req.session.authUserId &&
        String(req.session.authUserId).trim()
    );

    const mappedManga = mapMangaRow(mangaRow);
    const chapterTitle = (chapterRow.title || "").toString().trim();
    const chapterBaseLabel = isOneshotChapter ? "Oneshot" : `Chương ${chapterRow.number}`;
    const chapterLabel = chapterTitle ? `${chapterBaseLabel} - ${chapterTitle}` : chapterBaseLabel;
    const chapterDescription = normalizeSeoText(
      `Đọc ${chapterLabel} của ${mangaRow.title} trên BFANG Team. Trang đọc tối ưu cho di động và máy tính.`,
      180
    );
    const mangaCanonicalPath = `/manga/${encodeURIComponent(mangaRow.slug)}`;
    const chapterPath = `/manga/${encodeURIComponent(mangaRow.slug)}/chapters/${encodeURIComponent(
      String(chapterRow.number)
    )}`;
    const chapterKeywords = buildSeoKeywordList([
      SEO_TRENDING_KEYWORDS,
      mangaRow.title,
      chapterLabel,
      `đọc ${chapterLabel}`,
      splitSeoNameTokens(mangaRow.author || ""),
      Array.isArray(mappedManga.genres) ? mappedManga.genres : []
    ]);
    const chapterSchemas = compactJsonLdList([
      buildOrganizationSchema(req),
      buildWebsiteSchema(req),
      buildCollectionPageSchema(req, {
        path: chapterPath,
        name: `${chapterLabel} | ${mangaRow.title}`,
        description: chapterDescription,
        image: mappedManga.cover || "",
        keywords: chapterKeywords
      }),
      buildBreadcrumbSchema(req, [
        { name: "Trang chủ", path: "/" },
        { name: "Toàn bộ truyện", path: "/manga" },
        { name: mangaRow.title, path: mangaCanonicalPath },
        { name: chapterLabel, path: chapterPath }
      ]),
      buildMangaSeriesSchema(req, {
        manga: mappedManga,
        canonicalPath: mangaCanonicalPath,
        description: normalizeSeoText(mappedManga.description || `Đọc manga ${mangaRow.title}.`, 180),
        chapterCount: chapterList.length
      }),
      buildChapterSchema(req, {
        manga: mappedManga,
        chapter: chapterRow,
        chapterPath,
        chapterLabel,
        description: chapterDescription
      })
    ]);

    return res.render("chapter", {
      title: `${chapterBaseLabel} — ${mangaRow.title}`,
      team,
      manga: mappedManga,
      chapter: {
        ...chapterRow,
        is_oneshot: isOneshotChapter
      },
      prevChapter,
      nextChapter,
      chapterList,
      pages,
      pageUrls,
      nextChapterPrefetchUrls,
      comments: commentData.comments,
      commentCount: commentData.count,
      commentPagination: commentData.pagination,
      commentComposerEnabled,
      seo: buildSeoPayload(req, {
        title: `${chapterLabel} | ${mangaRow.title}`,
        description: chapterDescription,
        keywords: chapterKeywords,
        canonicalPath: chapterPath,
        image: mappedManga.cover || "",
        ogType: "article",
        jsonLd: chapterSchemas
      })
    });
  })
);

app.get(
  "/manga/:slug/comment-mentions",
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    const mangaRow = await dbGet(
      "SELECT id, slug FROM manga WHERE slug = ? AND COALESCE(is_hidden, 0) = 0",
      [req.params.slug]
    );
    if (!mangaRow) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy truyện." });
    }

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;
    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }

    try {
      await ensureUserRowFromAuthUser(user);
    } catch (err) {
      console.warn("Failed to ensure user row for mention candidates", err);
    }

    const query = typeof req.query.q === "string" ? req.query.q : "";
    const limit = req.query.limit;
    const rootCommentIdRaw = Number(req.query.postId);
    const rootCommentId = Number.isFinite(rootCommentIdRaw) && rootCommentIdRaw > 0
      ? Math.floor(rootCommentIdRaw)
      : 0;
    const rows = await getMentionCandidatesForManga({
      mangaId: mangaRow.id,
      currentUserId: userId,
      query,
      limit,
      rootCommentId: rootCommentId || undefined
    });

    const users = rows
      .map((row) => {
        const username = row && row.username ? String(row.username).trim() : "";
        if (!username) return null;
        const displayName =
          row && row.display_name ? String(row.display_name).replace(/\s+/g, " ").trim() : "";
        const isAdmin = Boolean(Number(row && row.is_admin));
        const isMod = Boolean(Number(row && row.is_mod));
        const hasCommented = Boolean(row && row.has_commented);
        return {
          id: row.id,
          username,
          name: displayName || `@${username}`,
          avatarUrl: normalizeAvatarUrl(row && row.avatar_url ? row.avatar_url : ""),
          roleLabel: isAdmin ? "Admin" : isMod ? "Mod" : hasCommented ? "Đã bình luận" : ""
        };
      })
      .filter(Boolean);

    return res.json({ ok: true, users });
  })
);

const commentLinkLabelSlugPattern = /^[a-z0-9][a-z0-9_-]{0,199}$/;
const commentLinkLabelUserPattern = /^[a-z0-9_]{1,24}$/;
const commentLinkLabelPostIdPattern = /^[1-9][0-9]{0,11}$/;

app.post(
  "/comments/link-labels",
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).json({ ok: false, error: "Yêu cầu JSON." });
    }

    const rawItems = req.body && Array.isArray(req.body.items) ? req.body.items : [];
    const normalizedItems = [];
    const seenKeys = new Set();

    rawItems.slice(0, COMMENT_LINK_LABEL_FETCH_LIMIT).forEach((rawItem) => {
      const item = rawItem && typeof rawItem === "object" ? rawItem : null;
      if (!item) return;

      const type = (item.type || "").toString().trim().toLowerCase();
      if (type !== "manga" && type !== "chapter" && type !== "user" && type !== "team" && type !== "forum-post") {
        return;
      }

      let slug = "";
      let chapterNumberText = "";
      let username = "";
      let postId = "";

      if (type === "user") {
        username = (item.username || "").toString().trim().toLowerCase();
        if (!commentLinkLabelUserPattern.test(username)) return;
      } else if (type === "forum-post") {
        postId = (item.postId || item.id || "").toString().trim();
        if (!commentLinkLabelPostIdPattern.test(postId)) return;
      } else {
        slug = (item.slug || "").toString().trim().toLowerCase();
        if (!commentLinkLabelSlugPattern.test(slug)) return;

        if (type === "chapter") {
          const chapterValue = parseChapterNumberInput(item.chapterNumberText);
          chapterNumberText = formatChapterNumberValue(chapterValue);
          if (!chapterNumberText) return;
        }
      }

      const key =
        type === "chapter"
          ? `chapter:${slug}:${chapterNumberText}`
          : type === "team"
            ? `team:${slug}`
            : type === "forum-post"
              ? `forum-post:${postId}`
          : type === "manga"
            ? `manga:${slug}`
            : `user:${username}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      normalizedItems.push({
        key,
        type,
        slug,
        chapterNumberText,
        username,
        postId
      });
    });

    if (!normalizedItems.length) {
      return res.json({ ok: true, labels: {} });
    }

    const slugs = Array.from(new Set(normalizedItems.map((item) => item.slug).filter(Boolean)));
    const usernames = Array.from(new Set(normalizedItems.map((item) => item.username).filter(Boolean)));
    const teamSlugs = Array.from(
      new Set(normalizedItems.filter((item) => item.type === "team").map((item) => item.slug).filter(Boolean))
    );
    const postIds = Array.from(
      new Set(
        normalizedItems
          .filter((item) => item.type === "forum-post")
          .map((item) => Number(item.postId))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))
      )
    );
    const labels = {};

    if (slugs.length) {
      const placeholders = slugs.map(() => "?").join(",");
      const rows = await dbAll(
        `
          SELECT slug, title
          FROM manga
          WHERE COALESCE(is_hidden, 0) = 0
            AND slug IN (${placeholders})
        `,
        slugs
      );

      const titleBySlug = new Map();
      rows.forEach((row) => {
        const slugValue = row && row.slug ? String(row.slug).trim().toLowerCase() : "";
        const titleValue = row && row.title ? String(row.title).replace(/\s+/g, " ").trim() : "";
        if (!slugValue || !titleValue) return;
        titleBySlug.set(slugValue, titleValue);
      });

      normalizedItems.forEach((item) => {
        if (item.type !== "manga" && item.type !== "chapter") return;
        const title = titleBySlug.get(item.slug);
        if (!title) return;
        labels[item.key] =
          item.type === "chapter" ? `${title} - Ch. ${item.chapterNumberText}` : title;
      });
    }

    if (usernames.length) {
      const placeholders = usernames.map(() => "?").join(",");
      const rows = await dbAll(
        `
          SELECT username, display_name
          FROM users
          WHERE lower(username) IN (${placeholders})
        `,
        usernames
      );

      const labelByUsername = new Map();
      rows.forEach((row) => {
        const usernameValue = row && row.username ? String(row.username).trim().toLowerCase() : "";
        if (!usernameValue || !commentLinkLabelUserPattern.test(usernameValue)) return;
        const displayName = row && row.display_name ? String(row.display_name).replace(/\s+/g, " ").trim() : "";
        labelByUsername.set(usernameValue, displayName || `@${usernameValue}`);
      });

      normalizedItems.forEach((item) => {
        if (item.type !== "user") return;
        const label = labelByUsername.get(item.username);
        if (!label) return;
        labels[item.key] = label;
      });
    }

    if (teamSlugs.length) {
      const placeholders = teamSlugs.map(() => "?").join(",");
      const rows = await dbAll(
        `
          SELECT slug, name
          FROM translation_teams
          WHERE lower(slug) IN (${placeholders})
        `,
        teamSlugs
      );

      const nameBySlug = new Map();
      rows.forEach((row) => {
        const slugValue = row && row.slug ? String(row.slug).trim().toLowerCase() : "";
        const nameValue = row && row.name ? String(row.name).replace(/\s+/g, " ").trim() : "";
        if (!slugValue || !nameValue) return;
        nameBySlug.set(slugValue, nameValue);
      });

      normalizedItems.forEach((item) => {
        if (item.type !== "team") return;
        const label = nameBySlug.get(item.slug);
        if (!label) return;
        labels[item.key] = label;
      });
    }

    if (postIds.length) {
      const placeholders = postIds.map(() => "?").join(",");
      const rows = await dbAll(
        `
          SELECT id, content
          FROM comments
          WHERE parent_id IS NULL
            AND status = 'visible'
            AND id IN (${placeholders})
        `,
        postIds
      );

      const titleByPostId = new Map();
      rows.forEach((row) => {
        const idValue = row && row.id != null ? Number(row.id) : 0;
        if (!Number.isFinite(idValue) || idValue <= 0) return;
        const parsed = parseForumPostValidationParts(row && row.content ? row.content : "");
        const title = parsed.titleText || `Bài viết #${Math.floor(idValue)}`;
        titleByPostId.set(Math.floor(idValue), title);
      });

      normalizedItems.forEach((item) => {
        if (item.type !== "forum-post") return;
        const idValue = Number(item.postId);
        if (!Number.isFinite(idValue) || idValue <= 0) return;
        const label = titleByPostId.get(Math.floor(idValue));
        if (!label) return;
        labels[item.key] = label;
      });
    }

    return res.json({ ok: true, labels });
  })
);

app.post(
  "/manga/:slug/comments",
  asyncHandler(async (req, res) => {
    const mangaRow = await dbGet(
      `
      SELECT id, slug, COALESCE(is_oneshot, false) as is_oneshot
      FROM manga
      WHERE slug = ? AND COALESCE(is_hidden, 0) = 0
    `,
      [req.params.slug]
    );
    if (!mangaRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const commentScope = resolveCommentScope({ mangaId: mangaRow.id, chapterNumber: null });
    if (!commentScope) {
      return res.status(500).send("Không thể tải phạm vi bình luận.");
    }

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;

    const author = buildCommentAuthorFromAuthUser(user);
    const authorUserId = String(user.id || "").trim();
    const authorEmail = user.email ? String(user.email).trim() : "";
    let authorAvatarUrl = buildAvatarUrlFromAuthUser(
      user,
      user && user.bfangAvatarUrl ? user.bfangAvatarUrl : ""
    );

    let badgeContext = {
      badges: [{ code: "member", label: "Member", color: "#f8f8f2", priority: 100 }],
      userColor: "",
      permissions: { canAccessAdmin: false, canDeleteAnyComment: false, canComment: false }
    };
    try {
      const ensuredUserRow = await ensureUserRowFromAuthUser(user);
      authorAvatarUrl = buildAvatarUrlFromAuthUser(
        user,
        ensuredUserRow && ensuredUserRow.avatar_url ? ensuredUserRow.avatar_url : authorAvatarUrl
      );
      badgeContext = await getUserBadgeContext(authorUserId);
    } catch (err) {
      console.warn("Failed to load user badge context", err);
    }

    if (!badgeContext.permissions || badgeContext.permissions.canComment === false) {
      const message = "Tài khoản của bạn hiện không có quyền tương tác.";
      if (wantsJson(req)) {
        return res.status(403).json({ error: message });
      }
      return res.status(403).send(message);
    }

    const content = await censorCommentContentByForbiddenWords(req.body.content);
    const mangaCommentContext = buildCommentChapterContext({
      chapterNumber: commentScope.chapterNumber,
      chapterTitle: "",
      chapterIsOneshot: false
    });

    const commentRequestId = readCommentRequestId(req);
    if (!commentRequestId) {
      return sendCommentRequestIdInvalidResponse(req, res);
    }
    const isForumRequest = isForumCommentRequest(req, commentRequestId);
    const parentContext = await resolveCommentParentContext({
      parentIdInput: req.body.parent_id,
      commentScope,
      isForumRequest,
    });
    const parentId = parentContext.parentId;
    const parentAuthorUserId = parentContext.parentAuthorUserId;
    const rootCommentId = parentContext.rootCommentId;
    const canCreateAnnouncement = canCreateAnnouncementFromBadgeContext(badgeContext);

    const contentLimit = resolveCommentLengthLimit({
      req,
      parentId,
      commentRequestId,
    });

    if (!content) {
      if (wantsJson(req)) {
        return res.status(400).json({ error: "Nội dung bình luận không được để trống." });
      }
      return res.status(400).send("Nội dung bình luận không được để trống.");
    }

    if (isForumRequest) {
      if (parentId) {
        const lockRow = await dbGet(
          `
            SELECT COALESCE(root.forum_post_locked, false) AS forum_post_locked
            FROM forum_posts root
            WHERE root.id = ?
              AND ${commentScope.whereWithoutStatus.replace(/\bc\./g, "root.")}
            LIMIT 1
          `,
          [rootCommentId || parentId, ...commentScope.params]
        );
        if (lockRow && toBooleanFlag(lockRow.forum_post_locked)) {
          const message = "Chủ đề này đã bị khóa. Bạn không thể bình luận.";
          if (wantsJson(req)) {
            return res.status(403).json({ error: message });
          }
          return res.status(403).send(message);
        }

        const plainLength = normalizeForumTextLength(content);
        if (plainLength < FORUM_COMMENT_MIN_LENGTH) {
          const message = `Bình luận cần ít nhất ${FORUM_COMMENT_MIN_LENGTH} ký tự.`;
          if (wantsJson(req)) {
            return res.status(400).json({ error: message });
          }
          return res.status(400).send(message);
        }
      } else {
        const parsed = parseForumPostValidationParts(content);
        const sectionSlug = extractForumSectionSlugFromContent(content);
        if (sectionSlug === "thong-bao" && !canCreateAnnouncement) {
          const message = "Chỉ Mod/Admin mới có thể đăng bài trong mục Thông báo.";
          if (wantsJson(req)) {
            return res.status(403).json({ error: message });
          }
          return res.status(403).send(message);
        }

        if ((parsed.titleText || "").length < FORUM_POST_TITLE_MIN_LENGTH) {
          const message = `Tiêu đề bài viết cần ít nhất ${FORUM_POST_TITLE_MIN_LENGTH} ký tự.`;
          if (wantsJson(req)) {
            return res.status(400).json({ error: message });
          }
          return res.status(400).send(message);
        }

        if ((parsed.bodyText || "").length < FORUM_POST_MIN_LENGTH) {
          const message = `Nội dung bài viết cần ít nhất ${FORUM_POST_MIN_LENGTH} ký tự.`;
          if (wantsJson(req)) {
            return res.status(400).json({ error: message });
          }
          return res.status(400).send(message);
        }
      }
    }

    if (content.length > contentLimit.maxLength) {
      const message = `${contentLimit.label} tối đa ${contentLimit.maxLength} ký tự.`;
      if (wantsJson(req)) {
        return res.status(400).json({ error: message });
      }
      return res.status(400).send(message);
    }

    const createdAtDate = new Date();
    const createdAt = createdAtDate.toISOString();
    const nowMs = createdAtDate.getTime();

    const canContinueAfterChallenge = await ensureCommentTurnstileIfSuspicious({
      req,
      res,
      userId: authorUserId,
      nowMs,
      requestId: commentRequestId
    });
    if (!canContinueAfterChallenge) {
      return;
    }

    let result = null;

    try {
      result = await withTransaction(async ({ dbGet: txGet, dbRun: txRun, dbAll: txAll }) => {
        await ensureCommentPostCooldown({
          userId: authorUserId,
          nowMs,
          dbGet: txGet,
          dbRun: txRun,
          ...(isForumRequest
            ? parentId
              ? { cooldownMs: FORUM_REPLY_COOLDOWN_MS, replyOnly: true }
              : { cooldownMs: FORUM_POST_COOLDOWN_MS, rootOnly: true }
            : {})
        });

        await ensureCommentNotDuplicateRecently({
          userId: authorUserId,
          content,
          nowMs,
          dbAll: txAll
        });

        if (isForumRequest) {
          const nextCommentId = await resolveNextSharedCommentId(txGet);
          await txRun(
            `
            INSERT INTO forum_posts (
              id,
              manga_id,
              chapter_number,
              parent_id,
              author,
              author_user_id,
              author_email,
              author_avatar_url,
              client_request_id,
              content,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              nextCommentId,
              mangaRow.id,
              commentScope.chapterNumber,
              parentId,
              author,
              authorUserId,
              authorEmail,
              authorAvatarUrl,
              commentRequestId,
              content,
              createdAt
            ]
          );
          return { lastID: nextCommentId };
        }

        return txRun(
          `
          INSERT INTO comments (
            manga_id,
            chapter_number,
            parent_id,
            author,
            author_user_id,
            author_email,
            author_avatar_url,
            client_request_id,
            content,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            mangaRow.id,
            commentScope.chapterNumber,
            parentId,
            author,
            authorUserId,
            authorEmail,
            authorAvatarUrl,
            commentRequestId,
            content,
            createdAt
          ]
        );
      });
    } catch (error) {
      if (error && error.code === "COMMENT_RATE_LIMITED") {
        registerCommentBotSignal({ userId: authorUserId, nowMs });
        return sendCommentCooldownResponse(req, res, error.retryAfterSeconds);
      }
      if (error && error.code === "COMMENT_DUPLICATE_CONTENT") {
        registerCommentBotSignal({ userId: authorUserId, nowMs });
        return sendCommentDuplicateContentResponse(req, res, error.retryAfterSeconds);
      }
      if (isDuplicateCommentRequestError(error)) {
        return sendDuplicateCommentRequestResponse(req, res);
      }
      throw error;
    }

    const mentionUsernames = extractMentionUsernamesFromContent(content);
    const mentionProfileMap = await getMentionProfileMapForManga({
      mangaId: mangaRow.id,
      usernames: mentionUsernames,
      rootCommentId: rootCommentId || undefined
    }).catch(() => new Map());
    const commentMentions = buildCommentMentionsForContent({
      content,
      mentionProfileMap
    });

    try {
      await createMentionNotificationsForComment({
        mangaId: mangaRow.id,
        chapterNumber: commentScope.chapterNumber,
        commentId: result.lastID,
        content,
        authorUserId,
        rootCommentId: rootCommentId || undefined,
        isForumRequest,
      });
    } catch (err) {
      console.warn("Failed to create mention notifications", err);
    }

    try {
      await createForumPostCommentNotification({
        isForumRequest,
        parentId,
        rootCommentId,
        parentAuthorUserId,
        authorUserId,
        mangaId: mangaRow.id,
        chapterNumber: commentScope.chapterNumber,
        commentId: result.lastID,
        content,
      });
    } catch (err) {
      console.warn("Failed to create forum post comment notification", err);
    }

    if (wantsJson(req)) {
      const countRow = await dbGet(
        `
          SELECT COUNT(*) as count
          FROM comments
          WHERE ${commentScope.whereVisible}
            AND COALESCE(client_request_id, '') NOT ILIKE ?
        `,
        [...commentScope.params, "forum-%"]
      );
      return res.json({
        comment: {
          id: result.lastID,
          author,
          authorUserId,
          badges: badgeContext.badges,
          userColor: badgeContext.userColor,
          avatarUrl: authorAvatarUrl,
          content,
          mentions: commentMentions,
          createdAt,
          timeAgo: formatTimeAgo(createdAt),
          parentId,
          parentAuthorUserId,
          chapterNumber: mangaCommentContext.chapterNumber,
          chapterNumberText: mangaCommentContext.chapterNumberText,
          chapterTitle: mangaCommentContext.chapterTitle,
          chapterIsOneshot: mangaCommentContext.chapterIsOneshot,
          chapterLabel: mangaCommentContext.chapterLabel,
          likeCount: 0,
          reportCount: 0,
          liked: false,
          reported: false
        },
        commentCount: countRow ? countRow.count : 0
      });
    }

    return res.redirect(`/manga/${mangaRow.slug}#comments`);
  })
);

app.post(
  "/manga/:slug/chapters/:number/comments",
  asyncHandler(async (req, res) => {
    const chapterNumber = Number(req.params.number);
    if (!Number.isFinite(chapterNumber)) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const mangaRow = await dbGet(
      `
      SELECT id, slug, COALESCE(is_oneshot, false) as is_oneshot
      FROM manga
      WHERE slug = ? AND COALESCE(is_hidden, 0) = 0
    `,
      [req.params.slug]
    );
    if (!mangaRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const chapterRow = await dbGet(
      "SELECT number, title, COALESCE(is_oneshot, false) as is_oneshot FROM chapters WHERE manga_id = ? AND number = ?",
      [mangaRow.id, chapterNumber]
    );
    if (!chapterRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const commentScope = resolveCommentScope({
      mangaId: mangaRow.id,
      chapterNumber:
        toBooleanFlag(mangaRow.is_oneshot) && toBooleanFlag(chapterRow.is_oneshot)
          ? null
          : chapterNumber
    });
    if (!commentScope) {
      return res.status(500).send("Không thể tải phạm vi bình luận.");
    }

    const chapterCommentContext = buildCommentChapterContext({
      chapterNumber: commentScope.chapterNumber,
      chapterTitle: chapterRow.title,
      chapterIsOneshot: chapterRow.is_oneshot
    });

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;

    const author = buildCommentAuthorFromAuthUser(user);
    const authorUserId = String(user.id || "").trim();
    const authorEmail = user.email ? String(user.email).trim() : "";
    let authorAvatarUrl = buildAvatarUrlFromAuthUser(
      user,
      user && user.bfangAvatarUrl ? user.bfangAvatarUrl : ""
    );

    let badgeContext = {
      badges: [{ code: "member", label: "Member", color: "#f8f8f2", priority: 100 }],
      userColor: "",
      permissions: { canAccessAdmin: false, canDeleteAnyComment: false, canComment: false }
    };
    try {
      const ensuredUserRow = await ensureUserRowFromAuthUser(user);
      authorAvatarUrl = buildAvatarUrlFromAuthUser(
        user,
        ensuredUserRow && ensuredUserRow.avatar_url ? ensuredUserRow.avatar_url : authorAvatarUrl
      );
      badgeContext = await getUserBadgeContext(authorUserId);
    } catch (err) {
      console.warn("Failed to load user badge context", err);
    }

    if (!badgeContext.permissions || badgeContext.permissions.canComment === false) {
      const message = "Tài khoản của bạn hiện không có quyền tương tác.";
      if (wantsJson(req)) {
        return res.status(403).json({ error: message });
      }
      return res.status(403).send(message);
    }

    const content = await censorCommentContentByForbiddenWords(req.body.content);
    const commentRequestId = readCommentRequestId(req);
    if (!commentRequestId) {
      return sendCommentRequestIdInvalidResponse(req, res);
    }
    const isForumRequest = isForumCommentRequest(req, commentRequestId);
    const parentContext = await resolveCommentParentContext({
      parentIdInput: req.body.parent_id,
      commentScope,
      isForumRequest,
    });
    const parentId = parentContext.parentId;
    const parentAuthorUserId = parentContext.parentAuthorUserId;
    const rootCommentId = parentContext.rootCommentId;
    const canCreateAnnouncement = canCreateAnnouncementFromBadgeContext(badgeContext);

    const contentLimit = resolveCommentLengthLimit({
      req,
      parentId,
      commentRequestId,
    });

    if (!content) {
      if (wantsJson(req)) {
        return res.status(400).json({ error: "Nội dung bình luận không được để trống." });
      }
      return res.status(400).send("Nội dung bình luận không được để trống.");
    }

    if (isForumRequest) {
      if (parentId) {
        const lockRow = await dbGet(
          `
            SELECT COALESCE(root.forum_post_locked, false) AS forum_post_locked
            FROM forum_posts root
            WHERE root.id = ?
              AND ${commentScope.whereWithoutStatus.replace(/\bc\./g, "root.")}
            LIMIT 1
          `,
          [rootCommentId || parentId, ...commentScope.params]
        );
        if (lockRow && toBooleanFlag(lockRow.forum_post_locked)) {
          const message = "Chủ đề này đã bị khóa. Bạn không thể bình luận.";
          if (wantsJson(req)) {
            return res.status(403).json({ error: message });
          }
          return res.status(403).send(message);
        }

        const plainLength = normalizeForumTextLength(content);
        if (plainLength < FORUM_COMMENT_MIN_LENGTH) {
          const message = `Bình luận cần ít nhất ${FORUM_COMMENT_MIN_LENGTH} ký tự.`;
          if (wantsJson(req)) {
            return res.status(400).json({ error: message });
          }
          return res.status(400).send(message);
        }
      } else {
        const parsed = parseForumPostValidationParts(content);
        const sectionSlug = extractForumSectionSlugFromContent(content);
        if (sectionSlug === "thong-bao" && !canCreateAnnouncement) {
          const message = "Chỉ Mod/Admin mới có thể đăng bài trong mục Thông báo.";
          if (wantsJson(req)) {
            return res.status(403).json({ error: message });
          }
          return res.status(403).send(message);
        }

        if ((parsed.titleText || "").length < FORUM_POST_TITLE_MIN_LENGTH) {
          const message = `Tiêu đề bài viết cần ít nhất ${FORUM_POST_TITLE_MIN_LENGTH} ký tự.`;
          if (wantsJson(req)) {
            return res.status(400).json({ error: message });
          }
          return res.status(400).send(message);
        }

        if ((parsed.bodyText || "").length < FORUM_POST_MIN_LENGTH) {
          const message = `Nội dung bài viết cần ít nhất ${FORUM_POST_MIN_LENGTH} ký tự.`;
          if (wantsJson(req)) {
            return res.status(400).json({ error: message });
          }
          return res.status(400).send(message);
        }
      }
    }

    if (content.length > contentLimit.maxLength) {
      const message = `${contentLimit.label} tối đa ${contentLimit.maxLength} ký tự.`;
      if (wantsJson(req)) {
        return res.status(400).json({ error: message });
      }
      return res.status(400).send(message);
    }

    const createdAtDate = new Date();
    const createdAt = createdAtDate.toISOString();
    const nowMs = createdAtDate.getTime();

    const canContinueAfterChallenge = await ensureCommentTurnstileIfSuspicious({
      req,
      res,
      userId: authorUserId,
      nowMs,
      requestId: commentRequestId
    });
    if (!canContinueAfterChallenge) {
      return;
    }

    let result = null;

    try {
      result = await withTransaction(async ({ dbGet: txGet, dbRun: txRun, dbAll: txAll }) => {
        await ensureCommentPostCooldown({
          userId: authorUserId,
          nowMs,
          dbGet: txGet,
          dbRun: txRun,
          ...(isForumRequest
            ? parentId
              ? { cooldownMs: FORUM_REPLY_COOLDOWN_MS, replyOnly: true }
              : { cooldownMs: FORUM_POST_COOLDOWN_MS, rootOnly: true }
            : {})
        });

        await ensureCommentNotDuplicateRecently({
          userId: authorUserId,
          content,
          nowMs,
          dbAll: txAll
        });

        if (isForumRequest) {
          const nextCommentId = await resolveNextSharedCommentId(txGet);
          await txRun(
            `
            INSERT INTO forum_posts (
              id,
              manga_id,
              chapter_number,
              parent_id,
              author,
              author_user_id,
              author_email,
              author_avatar_url,
              client_request_id,
              content,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              nextCommentId,
              mangaRow.id,
              commentScope.chapterNumber,
              parentId,
              author,
              authorUserId,
              authorEmail,
              authorAvatarUrl,
              commentRequestId,
              content,
              createdAt
            ]
          );
          return { lastID: nextCommentId };
        }

        return txRun(
          `
          INSERT INTO comments (
            manga_id,
            chapter_number,
            parent_id,
            author,
            author_user_id,
            author_email,
            author_avatar_url,
            client_request_id,
            content,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            mangaRow.id,
            commentScope.chapterNumber,
            parentId,
            author,
            authorUserId,
            authorEmail,
            authorAvatarUrl,
            commentRequestId,
            content,
            createdAt
          ]
        );
      });
    } catch (error) {
      if (error && error.code === "COMMENT_RATE_LIMITED") {
        registerCommentBotSignal({ userId: authorUserId, nowMs });
        return sendCommentCooldownResponse(req, res, error.retryAfterSeconds);
      }
      if (error && error.code === "COMMENT_DUPLICATE_CONTENT") {
        registerCommentBotSignal({ userId: authorUserId, nowMs });
        return sendCommentDuplicateContentResponse(req, res, error.retryAfterSeconds);
      }
      if (isDuplicateCommentRequestError(error)) {
        return sendDuplicateCommentRequestResponse(req, res);
      }
      throw error;
    }

    const mentionUsernames = extractMentionUsernamesFromContent(content);
    const mentionProfileMap = await getMentionProfileMapForManga({
      mangaId: mangaRow.id,
      usernames: mentionUsernames,
      rootCommentId: rootCommentId || undefined
    }).catch(() => new Map());
    const commentMentions = buildCommentMentionsForContent({
      content,
      mentionProfileMap
    });

    try {
      await createMentionNotificationsForComment({
        mangaId: mangaRow.id,
        chapterNumber: commentScope.chapterNumber,
        commentId: result.lastID,
        content,
        authorUserId,
        rootCommentId: rootCommentId || undefined,
        isForumRequest,
      });
    } catch (err) {
      console.warn("Failed to create mention notifications", err);
    }

    try {
      await createForumPostCommentNotification({
        isForumRequest,
        parentId,
        rootCommentId,
        parentAuthorUserId,
        authorUserId,
        mangaId: mangaRow.id,
        chapterNumber: commentScope.chapterNumber,
        commentId: result.lastID,
        content,
      });
    } catch (err) {
      console.warn("Failed to create forum post comment notification", err);
    }

    if (wantsJson(req)) {
      const countRow = await dbGet(
        `
          SELECT COUNT(*) as count
          FROM comments
          WHERE ${commentScope.whereVisible}
            AND COALESCE(client_request_id, '') NOT ILIKE ?
        `,
        [...commentScope.params, "forum-%"]
      );
      return res.json({
        comment: {
          id: result.lastID,
          author,
          authorUserId,
          badges: badgeContext.badges,
          userColor: badgeContext.userColor,
          avatarUrl: authorAvatarUrl,
          content,
          mentions: commentMentions,
          createdAt,
          timeAgo: formatTimeAgo(createdAt),
          parentId,
          parentAuthorUserId,
          chapterNumber: chapterCommentContext.chapterNumber,
          chapterNumberText: chapterCommentContext.chapterNumberText,
          chapterTitle: chapterCommentContext.chapterTitle,
          chapterIsOneshot: chapterCommentContext.chapterIsOneshot,
          chapterLabel: chapterCommentContext.chapterLabel,
          likeCount: 0,
          reportCount: 0,
          liked: false,
          reported: false
        },
        commentCount: countRow ? countRow.count : 0
      });
    }

    return res.redirect(`/manga/${mangaRow.slug}/chapters/${chapterNumber}#comments`);
  })
);
};

module.exports = registerSiteRoutes;
