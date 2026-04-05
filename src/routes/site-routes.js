const registerSiteRoutes = (app, deps) => {
  const {
    AUTH_DISCORD_STRATEGY,
    AUTH_GOOGLE_STRATEGY,
    COMMENT_LINK_LABEL_FETCH_LIMIT,
    COMMENT_MAX_LENGTH,
    CHAPTER_PASSWORD_MAX_LENGTH,
    CHAPTER_PASSWORD_MIN_LENGTH,
    commentImageUploadsEnabled,
    messageImageUploadsEnabled,
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
    formatDate,
    formatChapterNumberValue,
    formatTimeAgo,
    fs,
    getB2Config,
    getGenreStats,
    getSqlRedisCacheVersion,
    getUserApiKeyMeta,
    getMentionCandidatesForManga,
    getMentionProfileMapForManga,
    getPaginatedCommentTree,
    getPublicOriginFromRequest,
    getUserBadgeContext,
    hasOwnObjectKey,
    isDuplicateCommentRequestError,
    isForumPageAvailable,
    isOauthProviderEnabled,
    isServerSessionVersionMismatch,
    isUploadedAvatarUrl,
    adultContentControlEnabled,
    listAuthIdentityRowsForUser,
    listQueryBase,
    listQueryOrder,
    loadSessionUserById,
    mapAuthIdentityRowToUserIdentity,
    mapMangaListRow,
    mapMangaRow,
    mapPublicUserRow,
    mapReadingHistoryRow,
    normalizeChapterPasswordInput,
    normalizeAvatarUrl,
    normalizeHomepageRow,
    normalizeNextPath,
    normalizeUploadedImageUrl,
    normalizeProfileBio,
    normalizeProfileDiscord,
    normalizeProfileDisplayName,
    normalizeProfileFacebook,
    normalizeSeoText,
    parseChapterNumberInput,
    passport,
    path,
    publishNotificationStreamUpdate,
    reconcileStaleChapterProcessingById,
    readAuthNextPath,
    readCommentRequestId,
    regenerateSession,
    registerCommentBotSignal,
    requireAuthUserForComments,
    rotateUserApiKey,
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
    sqlRedisCache,
    sqlRedisCacheEnabled,
    sitemapCacheByOrigin,
    sitemapCacheTtlMs,
    siteConfig,
    team,
    toAbsolutePublicUrl,
    toBooleanFlag,
    toIsoDate,
    uploadAvatar,
    uploadCommentImage,
    uploadMessageImage,
    uploadImageBufferToGoogleDrive,
    uploadTeamMedia,
    uploadCover,
    upsertUserProfileFromAuthUser,
    verifyChapterPasswordHash,
    wantsJson,
    withTransaction,
  } = deps;

  const TEAM_NAME_MAX_LENGTH = 30;
  const TEAM_INTRO_MAX_LENGTH = 300;
  const TEAM_SLUG_MAX_LENGTH = 60;
  const TEAM_MANGA_PREVIEW_LIMIT = 120;
  const TEAM_OVERVIEW_MANGA_LIMIT = 8;
  const TEAM_NOTIFICATIONS_MAX_ITEMS = 200;
  const TEAM_NOTIFICATIONS_PER_PAGE = 25;
  const TEAM_COMMUNITY_LOOKUP_TIMEOUT_MS = 5000;
  const TEAM_COMMUNITY_NAME_SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
  const TEAM_COMMUNITY_NAME_FAILURE_TTL_MS = 15 * 60 * 1000;
  const CHAT_MESSAGE_MAX_LENGTH = 300;
  const CHAT_POST_COOLDOWN_MS = 2000;
  const CHAT_IMAGE_PREVIEW_TEXT = "Đã gửi ảnh";
  const TEAM_BADGE_LEADER_COLOR = "#ef4444";
  const TEAM_BADGE_MEMBER_COLOR = "#3b82f6";
  const TEAM_BADGE_LEADER_PRIORITY_FALLBACK = 55;
  const TEAM_BADGE_MEMBER_PRIORITY_FALLBACK = 45;
  const HOMEPAGE_CACHE_TTL_MS = 45 * 1000;
  const HOMEPAGE_META_PROBE_INTERVAL_MS = 2 * 1000;
  const HOMEPAGE_FORUM_POST_LIMIT = 5;
  const HOMEPAGE_FORUM_REQUEST_ID_LIKE = "forum-%";
  const HOMEPAGE_LATEST_LIMIT = 18;
  const HOMEPAGE_RANKING_LIMIT = 10;
  const HOMEPAGE_RANKING_DAY_DAYS = 1;
  const HOMEPAGE_RANKING_WEEK_DAYS = 7;
  const HOMEPAGE_RANKING_MONTH_DAYS = 30;
  const HOMEPAGE_RECENT_COMMENT_LIMIT = 6;
  const teamCommunityNameCache = new Map();
  const HOMEPAGE_CACHE_AUDIENCE_INCLUDE_ADULT = "include-adult";
  const HOMEPAGE_CACHE_AUDIENCE_EXCLUDE_ADULT = "exclude-adult";
  const homepageCacheByAudience = new Map();
  const homepageCacheRefreshInFlightByAudience = new Map();
  const homepageRankingRefreshInFlight = new Map();
  let mangaStatusOptionsRefreshPromise = null;
  const COMMENT_PANEL_PER_PAGE = 20;
  const NOTIFICATION_TYPE_TEAM_JOIN_REQUEST = "team_join_request";
  const NOTIFICATION_TYPE_TEAM_JOIN_APPROVED = "team_join_approved";
  const NOTIFICATION_TYPE_TEAM_JOIN_REJECTED = "team_join_rejected";
  const NOTIFICATION_TYPE_TEAM_MEMBER_KICKED = "team_member_kicked";
  const NOTIFICATION_TYPE_FORUM_POST_COMMENT = "forum_post_comment";
  const NOTIFICATION_TYPE_COMMENT_REPLY = "comment_reply";
  const NOTIFICATION_TYPE_TEAM_MANGA_COMMENT = "team_manga_comment";
  const MANGA_DETAIL_CHAPTERS_PER_PAGE = 30;
  const BOOKMARKS_PER_PAGE = 15;
  const FAST_NAV_PAGE_CACHE_CONTROL = "private, max-age=60, stale-while-revalidate=300";
  const siteSeoConfig = siteConfig && siteConfig.seo && typeof siteConfig.seo === "object" ? siteConfig.seo : {};
  const homepageSeoTitle =
    (siteSeoConfig.homepageTitle || "").toString().trim() || `${SEO_SITE_NAME} - Đọc truyện tranh online miễn phí`;
  const homepageSeoDescription =
    (siteSeoConfig.homepageDescription || "").toString().trim() ||
    `${SEO_SITE_NAME} là nơi đọc truyện tranh online miễn phí, cập nhật nhanh manga, manhwa, manhua mới nhất mỗi ngày.`;
  const siteNotFoundDescription = `Trang bạn yêu cầu không tồn tại trên ${SEO_SITE_NAME}.`;
  const CHAPTER_VIEW_SESSION_KEY = "chapterViewSessions";
  const CHAPTER_VIEW_TRACK_WINDOW_MS = 12 * 60 * 60 * 1000;
  const CHAPTER_VIEW_MAX_SESSION_ITEMS = 180;
  const CHAPTER_UNLOCK_SESSION_KEY = "chapterUnlockSessions";
  const CHAPTER_UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;
  const CHAPTER_UNLOCK_MAX_SESSION_ITEMS = 180;
  const CHAPTER_UNLOCK_ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;
  const CHAPTER_UNLOCK_ATTEMPT_SOFT_LIMIT = 5;
  const CHAPTER_UNLOCK_ATTEMPT_BASE_DELAY_MS = 15 * 1000;
  const CHAPTER_UNLOCK_ATTEMPT_MAX_DELAY_MS = 4 * 60 * 1000;
  const CHAPTER_UNLOCK_ATTEMPT_MAP_MAX_SIZE = 6000;
  const CHAPTER_REPORT_REASON_MAX_LENGTH = 40;
  const CHAPTER_REPORT_NOTE_MAX_LENGTH = 600;
  const CHAPTER_REPORT_ALLOWED_REASONS = new Set([
    "broken_images",
    "wrong_order",
    "translation_issue",
    "other"
  ]);
  const chapterUnlockAttemptMap = new Map();
  const CHAPTER_VIEW_TOKEN_SECRET =
    (process.env.CHAPTER_VIEW_SECRET || process.env.SESSION_SECRET || `${SEO_SITE_NAME}-chapter-view`)
      .toString()
      .trim() || "chapter-view-fallback";
  const endpointRedisCacheEnabled = Boolean(
    sqlRedisCacheEnabled
      && sqlRedisCache
      && typeof sqlRedisCache.buildCacheKey === "function"
      && typeof sqlRedisCache.getJson === "function"
      && typeof sqlRedisCache.setJson === "function"
  );
  const ENDPOINT_CACHE_HOMEPAGE_TTL_SECONDS = (() => {
    const parsed = Number(process.env.ENDPOINT_CACHE_HOMEPAGE_TTL_SECONDS);
    if (!Number.isFinite(parsed) || parsed <= 0) return 45;
    return Math.floor(parsed);
  })();
  const ENDPOINT_CACHE_MANGA_LIST_TTL_SECONDS = (() => {
    const parsed = Number(process.env.ENDPOINT_CACHE_MANGA_LIST_TTL_SECONDS);
    if (!Number.isFinite(parsed) || parsed <= 0) return 180;
    return Math.floor(parsed);
  })();
  const ENDPOINT_CACHE_MANGA_DETAIL_TTL_SECONDS = (() => {
    const parsed = Number(process.env.ENDPOINT_CACHE_MANGA_DETAIL_TTL_SECONDS);
    if (!Number.isFinite(parsed) || parsed <= 0) return 300;
    return Math.floor(parsed);
  })();
  const ENDPOINT_CACHE_CHAPTER_DETAIL_TTL_SECONDS = (() => {
    const parsed = Number(process.env.ENDPOINT_CACHE_CHAPTER_DETAIL_TTL_SECONDS);
    if (!Number.isFinite(parsed) || parsed <= 0) return 450;
    return Math.floor(parsed);
  })();
  const ENDPOINT_CACHE_MANGA_STATUS_OPTIONS_TTL_SECONDS = (() => {
    const parsed = Number(process.env.ENDPOINT_CACHE_MANGA_STATUS_OPTIONS_TTL_SECONDS);
    if (!Number.isFinite(parsed) || parsed <= 0) return 300;
    return Math.floor(parsed);
  })();
  const ENDPOINT_CACHE_MANGA_ROUTE_LOOKUP_TTL_SECONDS = (() => {
    const parsed = Number(process.env.ENDPOINT_CACHE_MANGA_ROUTE_LOOKUP_TTL_SECONDS);
    if (!Number.isFinite(parsed) || parsed <= 0) return 300;
    return Math.floor(parsed);
  })();
  const ENDPOINT_CACHE_HOMEPAGE_RANKING_TTL_SECONDS = (() => {
    const parsed = Number(process.env.ENDPOINT_CACHE_HOMEPAGE_RANKING_TTL_SECONDS);
    if (!Number.isFinite(parsed) || parsed <= 0) return 90;
    return Math.floor(parsed);
  })();

  const normalizeEndpointCacheInput = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item == null ? "" : item).trim())
        .filter(Boolean)
        .sort();
    }
    if (value == null) return "";
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (_error) {
        return "";
      }
    }
    return String(value).trim();
  };

  const normalizeCacheKeySegment = (value) =>
    String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");

  const buildEndpointCacheKey = (...segments) => {
    if (!endpointRedisCacheEnabled) return "";
    const normalizedSegments = segments
      .map((segment) => normalizeCacheKeySegment(segment))
      .filter(Boolean);
    if (!normalizedSegments.length) return "";
    return sqlRedisCache.buildCacheKey("endpoint", normalizedSegments);
  };

  const resolveEndpointCacheVersion = async () => {
    if (typeof getSqlRedisCacheVersion !== "function") return "0";
    const version = await getSqlRedisCacheVersion();
    const normalizedVersion = normalizeCacheKeySegment(version || "0");
    return normalizedVersion || "0";
  };

  const toVersionedEndpointCacheKey = (key, version) => {
    const safeKey = String(key || "").trim();
    if (!safeKey) return "";
    const safeVersion = normalizeCacheKeySegment(version || "0") || "0";
    return `${safeKey}:v-${safeVersion}`;
  };

  const resolveEndpointCacheTtlSeconds = (ttlSeconds) => {
    const parsed = Number(ttlSeconds);
    const baseTtl = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
    if (!baseTtl) return 0;
    const jitterCap = Math.max(1, Math.floor(baseTtl * 0.2));
    const jitterDelta = Math.floor(Math.random() * (jitterCap + 1));
    return baseTtl + jitterDelta;
  };

  const buildHomepageEndpointCacheKey = ({ includeAdult } = {}) =>
    buildEndpointCacheKey("homepage", includeAdult ? "include-adult" : "exclude-adult");

  const buildHomepageRankingEndpointCacheKey = ({ includeAdult, daysWindow }) =>
    buildEndpointCacheKey(
      "homepage",
      "ranking",
      includeAdult ? "include-adult" : "exclude-adult",
      Number.isFinite(Number(daysWindow)) && Number(daysWindow) > 0
        ? `days-${Math.floor(Number(daysWindow))}`
        : "total"
    );

  const buildMangaStatusOptionsEndpointCacheKey = () =>
    buildEndpointCacheKey("manga", "status-options");

  const buildMangaListEndpointCacheKey = ({
    includeAdult,
    q,
    status,
    include,
    exclude,
    genre,
    pageInput,
    perPageInput
  }) =>
    buildEndpointCacheKey(
      "manga",
      "list",
      `q-${String(normalizeEndpointCacheInput(q) || "all").toLowerCase()}`,
      `status-${String(normalizeEndpointCacheInput(status) || "all").toLowerCase()}`,
      `include-${String(normalizeEndpointCacheInput(include) || "none").toLowerCase()}`,
      `exclude-${String(normalizeEndpointCacheInput(exclude) || "none").toLowerCase()}`,
      `genre-${String(normalizeEndpointCacheInput(genre) || "none").toLowerCase()}`,
      `adult-${Boolean(includeAdult) ? "include" : "exclude"}`,
      `page-${normalizeEndpointCacheInput(pageInput) || "1"}`,
      `per-page-${normalizeEndpointCacheInput(perPageInput) || "24"}`
    );

  const buildMangaDetailEndpointCacheKey = ({ slug, chapterPageInput }) =>
    buildEndpointCacheKey(
      "chapters",
      "team-links-v2",
      slug,
      "page",
      normalizeEndpointCacheInput(chapterPageInput) || "1"
    );

  const buildChapterDetailEndpointCacheKey = ({ slug, chapterNumber }) =>
    buildEndpointCacheKey(
      "chapter",
      slug,
      normalizeEndpointCacheInput(chapterNumber) || "0"
    );

  const buildMangaRouteLookupEndpointCacheKey = ({ mode, value }) =>
    buildEndpointCacheKey(
      "manga",
      "route-lookup",
      normalizeEndpointCacheInput(mode) || "slug",
      normalizeEndpointCacheInput(value) || ""
    );

  const readEndpointCache = async (key) => {
    if (!key) {
      return { key: "", value: null, version: "0" };
    }

    const cacheVersion = await resolveEndpointCacheVersion();
    const versionedKey = toVersionedEndpointCacheKey(key, cacheVersion);
    const cachedValue = await sqlRedisCache.getJson(versionedKey);
    return {
      key: versionedKey,
      version: cacheVersion,
      value: cachedValue && typeof cachedValue === "object" ? cachedValue : null
    };
  };

  const writeEndpointCache = async (key, value, ttlSeconds) => {
    const safeKey = String(key || "").trim();
    if (!endpointRedisCacheEnabled || !safeKey) return false;
    if (!value || typeof value !== "object") return false;
    const keyToWrite = safeKey.includes(":v-")
      ? safeKey
      : toVersionedEndpointCacheKey(safeKey, await resolveEndpointCacheVersion());
    return sqlRedisCache.setJson(keyToWrite, value, resolveEndpointCacheTtlSeconds(ttlSeconds));
  };

  let chapterViewSchemaReadyPromise = null;
  let mangaDailyViewSchemaReadyPromise = null;
  let mangaDailyViewBaselineSyncPromise = null;
  let mangaDailyViewBaselineSyncedDate = "";

  const MANGA_HAS_CHAPTER_SQL = "EXISTS (SELECT 1 FROM chapters c_has WHERE c_has.manga_id = m.id)";
  const isAdultContentControlActive = toBooleanFlag(adultContentControlEnabled);
  const MANGA_HAS_ADULT_GENRE_SQL = `
    EXISTS (
      SELECT 1
      FROM manga_genres mg_adult
      JOIN genres g_adult ON g_adult.id = mg_adult.genre_id
      WHERE mg_adult.manga_id = m.id
        AND (
          lower(trim(g_adult.name)) = 'adult'
          OR lower(trim(g_adult.name)) = '18+'
          OR lower(trim(g_adult.name)) = '18 +'
          OR lower(trim(g_adult.name)) = 'r18'
          OR lower(trim(g_adult.name)) = 'r-18'
          OR lower(trim(g_adult.name)) = 'nsfw'
          OR lower(trim(g_adult.name)) LIKE '%adult%'
        )
    )
  `;

  const buildHomepageAudienceCacheKey = (includeAdult) =>
    includeAdult
      ? HOMEPAGE_CACHE_AUDIENCE_INCLUDE_ADULT
      : HOMEPAGE_CACHE_AUDIENCE_EXCLUDE_ADULT;

  const resolveViewStatsTimezone = () => {
    const rawTimezone = (
      process.env.VIEW_STATS_TIMEZONE ||
      process.env.APP_TIMEZONE ||
      "Asia/Ho_Chi_Minh"
    )
      .toString()
      .trim();
    if (!rawTimezone) return "Asia/Ho_Chi_Minh";
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: rawTimezone });
      return rawTimezone;
    } catch (_err) {
      return "Asia/Ho_Chi_Minh";
    }
  };

  const VIEW_STATS_TIMEZONE = resolveViewStatsTimezone();
  const viewStatsDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIEW_STATS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

  const toViewStatsDateString = (timestampMs) => {
    const safeTimestamp = Number(timestampMs);
    const targetDate = Number.isFinite(safeTimestamp) ? new Date(safeTimestamp) : new Date();
    try {
      const formatted = viewStatsDateFormatter.format(targetDate);
      if (isoDatePattern.test(formatted)) {
        return formatted;
      }
    } catch (_err) {
      // fallback below
    }
    return targetDate.toISOString().slice(0, 10);
  };

  const shiftViewStatsDateByDays = (isoDate, offsetDays) => {
    const rawDate = (isoDate || "").toString().trim();
    const match = rawDate.match(isoDatePattern);
    if (!match) return "";

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "";

    const shifted = new Date(Date.UTC(year, month - 1, day));
    shifted.setUTCDate(shifted.getUTCDate() + (Number.isFinite(Number(offsetDays)) ? Number(offsetDays) : 0));
    return shifted.toISOString().slice(0, 10);
  };

  const isAuthenticatedRequest = (req) => {
    const authUserId = req && req.session && req.session.authUserId
      ? String(req.session.authUserId).trim()
      : "";
    return Boolean(authUserId);
  };

  const normalizeGenreLabelForAdultCheck = (value) =>
    (value == null ? "" : String(value))
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/_/g, "")
      .replace(/-/g, "")
      .trim();

  const isAdultGenreLabel = (value) => {
    const normalized = normalizeGenreLabelForAdultCheck(value);
    if (!normalized) return false;
    return normalized === "adult"
      || normalized === "18+"
      || normalized === "r18"
      || normalized === "nsfw"
      || normalized.includes("adult");
  };

  const hasAdultGenre = (genresInput) => {
    if (Array.isArray(genresInput)) {
      return genresInput.some((genre) => isAdultGenreLabel(genre));
    }
    if (typeof genresInput === "string") {
      return genresInput.split(",").some((genre) => isAdultGenreLabel(genre));
    }
    return false;
  };

  const isMangaRowAdult = (mangaRow) => {
    if (!mangaRow || typeof mangaRow !== "object") return false;
    if (toBooleanFlag(mangaRow.is_adult)) return true;
    if (hasAdultGenre(mangaRow.genre_agg)) return true;
    if (hasAdultGenre(mangaRow.genres)) return true;
    return false;
  };

  const shouldExposeAdultMarker = (mangaRow) =>
    isAdultContentControlActive && isMangaRowAdult(mangaRow);

  const shouldIncludeAdultMangaForRequest = (req) =>
    !isAdultContentControlActive || isAuthenticatedRequest(req);

  const isAdultMangaBlockedForRequest = (req, mangaRow) =>
    isAdultContentControlActive && !isAuthenticatedRequest(req) && isMangaRowAdult(mangaRow);

  const isAdultMangaItemForOverlay = (item) => {
    if (!item || typeof item !== "object") return false;
    if (toBooleanFlag(item.isAdult)) return true;
    if (toBooleanFlag(item.is_adult)) return true;
    if (toBooleanFlag(item.manga_is_adult)) return true;
    return isMangaRowAdult(item);
  };

  const filterAdultItemsForOverlay = (items, includeAdult) => {
    const safeItems = Array.isArray(items) ? items.slice() : [];
    if (includeAdult) return safeItems;
    return safeItems.filter((item) => !isAdultMangaItemForOverlay(item));
  };

  const filterGenreStatsForAudience = (genreStats, includeAdult) => {
    const safeGenreStats = Array.isArray(genreStats) ? genreStats.slice() : [];
    if (includeAdult || !isAdultContentControlActive) {
      return safeGenreStats;
    }
    return safeGenreStats.filter((genre) => !isAdultGenreLabel(genre && genre.name));
  };

  const applyHomepageUserOverlay = (homepagePayload, includeAdult) => {
    const safePayload = homepagePayload && typeof homepagePayload === "object" ? homepagePayload : {};
    const safeTopRankings =
      safePayload.topRankings && typeof safePayload.topRankings === "object"
        ? safePayload.topRankings
        : {};
    const safeStats = safePayload.stats && typeof safePayload.stats === "object" ? safePayload.stats : {};
    const totalSeriesValue = includeAdult
      ? Number(safeStats.totalSeries)
      : Number(safeStats.totalSeriesNoAdult ?? safeStats.totalSeries);
    const totalChaptersValue = includeAdult
      ? Number(safeStats.totalChapters)
      : Number(safeStats.totalChaptersNoAdult ?? safeStats.totalChapters);

    return {
      ...safePayload,
      featured: filterAdultItemsForOverlay(safePayload.featured, includeAdult),
      latest: filterAdultItemsForOverlay(safePayload.latest, includeAdult),
      topRankings: {
        day: filterAdultItemsForOverlay(safeTopRankings.day, includeAdult),
        week: filterAdultItemsForOverlay(safeTopRankings.week, includeAdult),
        month: filterAdultItemsForOverlay(safeTopRankings.month, includeAdult),
        total: filterAdultItemsForOverlay(safeTopRankings.total, includeAdult)
      },
      recentComments: filterAdultItemsForOverlay(safePayload.recentComments, includeAdult),
      stats: {
        totalSeries: Number.isFinite(totalSeriesValue) ? Math.max(0, Math.floor(totalSeriesValue)) : 0,
        totalChapters: Number.isFinite(totalChaptersValue) ? Math.max(0, Math.floor(totalChaptersValue)) : 0
      }
    };
  };

  const applyMangaListUserOverlay = (mangaListPayload, includeAdult) => {
    const safePayload = mangaListPayload && typeof mangaListPayload === "object" ? mangaListPayload : {};
    const filteredMangaLibrary = filterAdultItemsForOverlay(safePayload.mangaLibrary, includeAdult);
    const filteredGenreStats = filterGenreStatsForAudience(safePayload.genreStats, includeAdult);
    const basePagination =
      safePayload.pagination && typeof safePayload.pagination === "object" ? safePayload.pagination : {};
    const perPageRaw = Number(basePagination.perPage);
    const pageRaw = Number(basePagination.page);
    const perPage = Number.isFinite(perPageRaw) && perPageRaw > 0 ? Math.floor(perPageRaw) : 24;
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const resultCountValue = includeAdult
      ? Number(safePayload.resultCount)
      : Number(safePayload.resultCountNoAdult ?? safePayload.resultCount);
    const resultCount = Number.isFinite(resultCountValue)
      ? Math.max(0, Math.floor(resultCountValue))
      : filteredMangaLibrary.length;
    const pageCount = Math.max(1, Math.ceil(resultCount / perPage));

    return {
      ...safePayload,
      mangaLibrary: filteredMangaLibrary,
      genreStats: filteredGenreStats,
      resultCount,
      pagination: {
        ...basePagination,
        page,
        perPage,
        total: resultCount,
        pageCount,
        hasPrev: page > 1,
        hasNext: page < pageCount
      }
    };
  };

  const renderNotFoundPage = (req, res) =>
    res.status(404).render("not-found", {
      title: "Không tìm thấy",
      team,
      seo: buildSeoPayload(req, {
        title: "Không tìm thấy",
        description: siteNotFoundDescription,
        robots: SEO_ROBOTS_NOINDEX,
        canonicalPath: ensureLeadingSlash(req.path || "/")
      })
    });

  const readSafeUploadedImageUrl = (value) => {
    if (typeof normalizeUploadedImageUrl === "function") {
      return normalizeUploadedImageUrl(value);
    }
    return "";
  };

  const hasInlineDataImage = (value) => {
    const text = value == null ? "" : String(value);
    if (!text) return false;
    return /<img\b[^>]*\bsrc\s*=\s*["']\s*data:image\//i.test(text) || /data:image\/[a-z0-9.+-]+;base64,/i.test(text);
  };

  const ensureChapterViewSchemaReady = async () => {
    if (chapterViewSchemaReadyPromise) {
      return chapterViewSchemaReadyPromise;
    }

    chapterViewSchemaReadyPromise = (async () => {
      await dbRun(
        `
          CREATE TABLE IF NOT EXISTS chapter_view_stats (
            chapter_id BIGINT PRIMARY KEY,
            view_count BIGINT NOT NULL DEFAULT 0,
            updated_at BIGINT NOT NULL DEFAULT 0
          )
        `
      );
    })().catch((error) => {
      chapterViewSchemaReadyPromise = null;
      throw error;
    });

    return chapterViewSchemaReadyPromise;
  };

  const ensureMangaDailyViewSchemaReady = async () => {
    if (mangaDailyViewSchemaReadyPromise) {
      return mangaDailyViewSchemaReadyPromise;
    }

    mangaDailyViewSchemaReadyPromise = (async () => {
      await dbRun(
        `
          CREATE TABLE IF NOT EXISTS manga_view_daily_stats (
            manga_id INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
            view_date DATE NOT NULL,
            view_count BIGINT NOT NULL DEFAULT 0,
            updated_at BIGINT NOT NULL DEFAULT 0,
            PRIMARY KEY (manga_id, view_date)
          )
        `
      );
      await dbRun(
        "CREATE INDEX IF NOT EXISTS idx_manga_view_daily_stats_view_date ON manga_view_daily_stats(view_date DESC, manga_id)"
      );
      await dbRun(
        "CREATE INDEX IF NOT EXISTS idx_manga_view_daily_stats_manga_id ON manga_view_daily_stats(manga_id)"
      );
    })().catch((error) => {
      mangaDailyViewSchemaReadyPromise = null;
      throw error;
    });

    return mangaDailyViewSchemaReadyPromise;
  };

  const ensureMangaDailyViewBaselineSynced = async () => {
    const currentViewDate = toViewStatsDateString(Date.now());
    if (!currentViewDate) {
      return;
    }

    if (mangaDailyViewBaselineSyncedDate === currentViewDate) {
      return;
    }

    if (mangaDailyViewBaselineSyncPromise) {
      await mangaDailyViewBaselineSyncPromise;
      return;
    }

    mangaDailyViewBaselineSyncPromise = (async () => {
      await ensureChapterViewSchemaReady();
      await ensureMangaDailyViewSchemaReady();

      const syncedAtMs = Date.now();
      await dbRun(
        `
          WITH chapter_totals AS (
            SELECT
              c.manga_id,
              COALESCE(SUM(GREATEST(COALESCE(v.view_count, 0), 0)), 0)::bigint AS chapter_total_views
            FROM chapters c
            LEFT JOIN chapter_view_stats v ON v.chapter_id = c.id
            GROUP BY c.manga_id
          ),
          non_current_day_totals AS (
            SELECT
              stats.manga_id,
              COALESCE(SUM(GREATEST(COALESCE(stats.view_count, 0), 0)), 0)::bigint AS non_current_day_views
            FROM manga_view_daily_stats stats
            WHERE stats.view_date <> ?
            GROUP BY stats.manga_id
          ),
          daily_seed_targets AS (
            SELECT
              chapter_totals.manga_id,
              GREATEST(
                chapter_totals.chapter_total_views - COALESCE(non_current_day_totals.non_current_day_views, 0),
                0
              )::bigint AS today_seed_views
            FROM chapter_totals
            LEFT JOIN non_current_day_totals ON non_current_day_totals.manga_id = chapter_totals.manga_id
          )
          INSERT INTO manga_view_daily_stats (manga_id, view_date, view_count, updated_at)
          SELECT
            daily_seed_targets.manga_id,
            ?,
            daily_seed_targets.today_seed_views,
            ?
          FROM daily_seed_targets
          ON CONFLICT (manga_id, view_date)
          DO UPDATE SET
            view_count = EXCLUDED.view_count,
            updated_at = EXCLUDED.updated_at
        `,
        [currentViewDate, currentViewDate, syncedAtMs]
      );

      mangaDailyViewBaselineSyncedDate = currentViewDate;
    })();

    try {
      await mangaDailyViewBaselineSyncPromise;
    } finally {
      mangaDailyViewBaselineSyncPromise = null;
    }
  };

  const normalizeRoleColorHex = (value) => {
    const raw = (value == null ? "" : String(value)).trim();
    if (!raw) return "";
    const normalized = raw.startsWith("#") ? raw : `#${raw}`;
    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized)) {
      return normalized.toLowerCase();
    }
    return "";
  };

  const resolveHighestRoleColorFromBadgeContext = (badgeContext) => {
    const badges = Array.isArray(badgeContext && badgeContext.badges) ? badgeContext.badges : [];
    const rankedColors = badges
      .map((badge, index) => ({
        priority: Number(badge && badge.priority) || 0,
        color: normalizeRoleColorHex(badge && badge.color),
        order: index
      }))
      .filter((entry) => entry.color)
      .sort((left, right) => {
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }
        return left.order - right.order;
      });

    if (rankedColors.length) {
      return rankedColors[0].color;
    }

    return normalizeRoleColorHex(badgeContext && badgeContext.userColor);
  };

  const mangaRouteLookupQueryBase = `
    SELECT
      m.id,
      m.title,
      m.slug,
      m.author,
      m.group_name,
      m.other_names,
      genre_agg.genres,
      COALESCE(m.is_hidden, 0) as is_hidden,
      COALESCE(m.is_oneshot, false) as is_oneshot,
      COALESCE(m.oneshot_locked, false) as oneshot_locked,
      m.status,
      m.description,
      m.cover,
      COALESCE(m.cover_updated_at, 0) as cover_updated_at,
      m.archive,
      m.updated_at,
      m.created_at
    FROM manga m
    LEFT JOIN LATERAL (
      SELECT string_agg(g.name, ', ' ORDER BY lower(g.name) ASC, g.id ASC) as genres
      FROM manga_genres mg
      JOIN genres g ON g.id = mg.genre_id
      WHERE mg.manga_id = m.id
    ) genre_agg ON true
  `;

  const readMangaRouteLookupFromCache = async ({ mode, value }) => {
    const baseCacheKey = buildMangaRouteLookupEndpointCacheKey({ mode, value });
    const lookupCache = await readEndpointCache(baseCacheKey);
    const cachedPayload = lookupCache.value;
    if (!cachedPayload || typeof cachedPayload !== "object") {
      return {
        cacheKey: lookupCache.key || baseCacheKey,
        payload: null
      };
    }

    return {
      cacheKey: lookupCache.key || baseCacheKey,
      payload: cachedPayload
    };
  };

  const writeMangaRouteLookupToCache = async ({ cacheKey, payload }) => {
    await writeEndpointCache(
      cacheKey,
      payload,
      ENDPOINT_CACHE_MANGA_ROUTE_LOOKUP_TTL_SECONDS
    );
  };

  const parseMangaIdFromRouteSlug = (slugInput) => {
    const text = (slugInput == null ? "" : String(slugInput)).trim();
    if (!text) return 0;
    const match = text.match(/^(\d+)(?:-|$)/);
    if (!match || !match[1]) return 0;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
  };

  const resolveMangaRowByRouteSlug = async (routeSlug) => {
    const requestedSlug = (routeSlug == null ? "" : String(routeSlug)).trim();
    if (!requestedSlug) {
      return {
        mangaRow: null,
        requestedSlug,
        matchedBy: "none"
      };
    }

    const slugLookupCache = await readMangaRouteLookupFromCache({ mode: "slug", value: requestedSlug });
    if (slugLookupCache.payload) {
      return {
        mangaRow: slugLookupCache.payload.mangaRow || null,
        requestedSlug,
        matchedBy: slugLookupCache.payload.matchedBy || "none"
      };
    }

    const exactSlugRow = await dbGet(
      `${mangaRouteLookupQueryBase} WHERE m.is_hidden = 0 AND m.slug = ?`,
      [requestedSlug]
    );
    if (exactSlugRow) {
      await writeMangaRouteLookupToCache({
        cacheKey: slugLookupCache.cacheKey,
        payload: {
          mangaRow: exactSlugRow,
          matchedBy: "slug"
        }
      });
      return {
        mangaRow: exactSlugRow,
        requestedSlug,
        matchedBy: "slug"
      };
    }

    const mangaId = parseMangaIdFromRouteSlug(requestedSlug);
    if (mangaId > 0) {
      const idLookupCache = await readMangaRouteLookupFromCache({ mode: "id", value: mangaId });
      if (idLookupCache.payload) {
        return {
          mangaRow: idLookupCache.payload.mangaRow || null,
          requestedSlug,
          matchedBy: idLookupCache.payload.matchedBy || "none"
        };
      }

      const idMatchedRow = await dbGet(
        `${mangaRouteLookupQueryBase} WHERE m.is_hidden = 0 AND m.id = ?`,
        [mangaId]
      );
      if (idMatchedRow) {
        await writeMangaRouteLookupToCache({
          cacheKey: idLookupCache.cacheKey,
          payload: {
            mangaRow: idMatchedRow,
            matchedBy: "id"
          }
        });
        return {
          mangaRow: idMatchedRow,
          requestedSlug,
          matchedBy: "id"
        };
      }
    }

    const suffixRows = await dbAll(
      `${mangaRouteLookupQueryBase} WHERE m.is_hidden = 0 AND m.slug LIKE ? LIMIT 2`,
      [`%-${requestedSlug}`]
    );
    if (suffixRows.length === 1) {
      await writeMangaRouteLookupToCache({
        cacheKey: slugLookupCache.cacheKey,
        payload: {
          mangaRow: suffixRows[0],
          matchedBy: "suffix"
        }
      });
      return {
        mangaRow: suffixRows[0],
        requestedSlug,
        matchedBy: "suffix"
      };
    }

    await writeMangaRouteLookupToCache({
      cacheKey: slugLookupCache.cacheKey,
      payload: {
        mangaRow: null,
        matchedBy: "none"
      }
    });

    return {
      mangaRow: null,
      requestedSlug,
      matchedBy: "none"
    };
  };

  const chapterHasPasswordProtection = (chapterRow) => {
    const hash = (chapterRow && chapterRow.password_hash ? chapterRow.password_hash : "").toString().trim();
    const salt = (chapterRow && chapterRow.password_salt ? chapterRow.password_salt : "").toString().trim();
    return Boolean(hash && salt);
  };

  const normalizeChapterUnlockSessionEntry = (entryInput) => {
    if (!entryInput || typeof entryInput !== "object") return null;
    const unlockedAt = toSafeTimestampMs(entryInput.unlockedAt);
    const passwordUpdatedAt = toSafeTimestampMs(entryInput.passwordUpdatedAt);
    if (!unlockedAt) return null;
    return {
      unlockedAt,
      passwordUpdatedAt: passwordUpdatedAt || 0
    };
  };

  const readChapterUnlockSessionMap = (sessionValue, nowMs) => {
    const safeNow = toSafeTimestampMs(nowMs) || Date.now();
    const source = sessionValue && typeof sessionValue === "object" ? sessionValue : {};
    const normalized = [];

    Object.keys(source).forEach((key) => {
      const chapterId = toSafeTimestampMs(key);
      if (!chapterId) return;
      const entry = normalizeChapterUnlockSessionEntry(source[key]);
      if (!entry) return;
      if (safeNow - entry.unlockedAt > CHAPTER_UNLOCK_TTL_MS) return;
      normalized.push({
        chapterId,
        entry
      });
    });

    normalized.sort((left, right) => right.entry.unlockedAt - left.entry.unlockedAt);
    const limited = normalized.slice(0, CHAPTER_UNLOCK_MAX_SESSION_ITEMS);
    const result = {};
    limited.forEach((item) => {
      result[String(item.chapterId)] = item.entry;
    });
    return result;
  };

  const isChapterUnlockedForSession = ({ req, chapterRow, nowMs }) => {
    if (!chapterHasPasswordProtection(chapterRow)) return true;
    const chapterId = toSafeTimestampMs(chapterRow && chapterRow.id);
    if (!chapterId) return false;

    const passwordUpdatedAt = toSafeTimestampMs(chapterRow && chapterRow.password_updated_at);
    const unlockMap = readChapterUnlockSessionMap(
      req && req.session ? req.session[CHAPTER_UNLOCK_SESSION_KEY] : null,
      nowMs || Date.now()
    );
    const unlockEntry = normalizeChapterUnlockSessionEntry(unlockMap[String(chapterId)]);
    if (!unlockEntry) return false;
    if (passwordUpdatedAt > 0 && unlockEntry.passwordUpdatedAt !== passwordUpdatedAt) return false;
    return true;
  };

  const markChapterUnlockedForSession = ({ req, chapterRow, nowMs }) => {
    if (!req || !req.session) return;
    const chapterId = toSafeTimestampMs(chapterRow && chapterRow.id);
    if (!chapterId) return;
    const safeNow = toSafeTimestampMs(nowMs) || Date.now();
    const unlockMap = readChapterUnlockSessionMap(req.session[CHAPTER_UNLOCK_SESSION_KEY], safeNow);
    unlockMap[String(chapterId)] = {
      unlockedAt: safeNow,
      passwordUpdatedAt: toSafeTimestampMs(chapterRow && chapterRow.password_updated_at)
    };
    req.session[CHAPTER_UNLOCK_SESSION_KEY] = readChapterUnlockSessionMap(unlockMap, safeNow);
  };

  const formatUnlockThrottleMessage = (retryAfterMs) => {
    const safeRetryMs = Math.max(Number(retryAfterMs) || 0, 0);
    const retrySeconds = Math.max(1, Math.ceil(safeRetryMs / 1000));
    if (retrySeconds >= 60) {
      const retryMinutes = Math.floor(retrySeconds / 60);
      const retryRemainSeconds = retrySeconds % 60;
      if (retryRemainSeconds > 0) {
        return `Bạn đã thử sai quá nhiều lần. Vui lòng chờ ${retryMinutes} phút ${retryRemainSeconds} giây rồi thử lại.`;
      }
      return `Bạn đã thử sai quá nhiều lần. Vui lòng chờ ${retryMinutes} phút rồi thử lại.`;
    }
    return `Bạn đã thử sai quá nhiều lần. Vui lòng chờ ${retrySeconds} giây rồi thử lại.`;
  };

  const resolveRequestClientIp = (req) => {
    const forwardedHeader = req && req.headers ? req.headers["x-forwarded-for"] : "";
    const forwardedText = Array.isArray(forwardedHeader)
      ? forwardedHeader.join(",")
      : (forwardedHeader || "").toString();
    const firstForwardedIp = forwardedText
      .split(",")
      .map((part) => part.trim())
      .find(Boolean);
    const directIp = req && req.ip ? String(req.ip).trim() : "";
    const remoteIp =
      req && req.socket && req.socket.remoteAddress
        ? String(req.socket.remoteAddress).trim()
        : "";
    const rawIp = firstForwardedIp || directIp || remoteIp || "";
    const sanitized = rawIp.replace(/^::ffff:/i, "").trim();
    return sanitized || "unknown-ip";
  };

  const buildChapterUnlockAttemptKey = ({ req, chapterId }) => {
    const safeChapterId = toSafeTimestampMs(chapterId);
    const clientIp = resolveRequestClientIp(req);
    const userAgent = (req && req.headers && req.headers["user-agent"]
      ? String(req.headers["user-agent"])
      : "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    const rawKey = `${safeChapterId}|${clientIp}|${userAgent}`;
    return crypto.createHash("sha256").update(rawKey).digest("hex");
  };

  const pruneChapterUnlockAttemptMap = (nowMs) => {
    const safeNow = toSafeTimestampMs(nowMs) || Date.now();
    chapterUnlockAttemptMap.forEach((entry, key) => {
      if (!entry || typeof entry !== "object") {
        chapterUnlockAttemptMap.delete(key);
        return;
      }

      const blockedUntil = toSafeTimestampMs(entry.blockedUntil);
      const lastAttemptAt = toSafeTimestampMs(entry.lastAttemptAt);
      const failureCountRaw = Number(entry.failureCount);
      const failureCount =
        Number.isFinite(failureCountRaw) && failureCountRaw > 0 ? Math.floor(failureCountRaw) : 0;

      const isExpired =
        blockedUntil <= safeNow &&
        (lastAttemptAt <= 0 || safeNow - lastAttemptAt > CHAPTER_UNLOCK_ATTEMPT_WINDOW_MS);
      if (isExpired) {
        chapterUnlockAttemptMap.delete(key);
        return;
      }

      entry.blockedUntil = blockedUntil > 0 ? blockedUntil : 0;
      entry.failureCount = failureCount;
      entry.lastAttemptAt = lastAttemptAt > 0 ? lastAttemptAt : 0;
      chapterUnlockAttemptMap.set(key, entry);
    });

    if (chapterUnlockAttemptMap.size <= CHAPTER_UNLOCK_ATTEMPT_MAP_MAX_SIZE) {
      return;
    }

    const entries = Array.from(chapterUnlockAttemptMap.entries()).sort((left, right) => {
      const leftTime = toSafeTimestampMs(left[1] && left[1].lastAttemptAt);
      const rightTime = toSafeTimestampMs(right[1] && right[1].lastAttemptAt);
      return leftTime - rightTime;
    });
    const overflow = chapterUnlockAttemptMap.size - CHAPTER_UNLOCK_ATTEMPT_MAP_MAX_SIZE;
    for (let index = 0; index < overflow; index += 1) {
      const key = entries[index] ? entries[index][0] : "";
      if (!key) continue;
      chapterUnlockAttemptMap.delete(key);
    }
  };

  const getChapterUnlockThrottleState = ({ attemptKey, nowMs }) => {
    const safeNow = toSafeTimestampMs(nowMs) || Date.now();
    pruneChapterUnlockAttemptMap(safeNow);
    const entry = chapterUnlockAttemptMap.get(attemptKey);
    const blockedUntil = toSafeTimestampMs(entry && entry.blockedUntil);
    if (blockedUntil > safeNow) {
      return {
        blocked: true,
        retryAfterMs: blockedUntil - safeNow
      };
    }
    return {
      blocked: false,
      retryAfterMs: 0
    };
  };

  const registerChapterUnlockFailure = ({ attemptKey, nowMs }) => {
    const safeNow = toSafeTimestampMs(nowMs) || Date.now();
    pruneChapterUnlockAttemptMap(safeNow);

    const existing = chapterUnlockAttemptMap.get(attemptKey);
    const entry = existing && typeof existing === "object" ? existing : {};
    const previousFailureCountRaw = Number(entry.failureCount);
    const previousFailureCount =
      Number.isFinite(previousFailureCountRaw) && previousFailureCountRaw > 0
        ? Math.floor(previousFailureCountRaw)
        : 0;
    const failureCount = previousFailureCount + 1;

    let retryAfterMs = 0;
    if (failureCount >= CHAPTER_UNLOCK_ATTEMPT_SOFT_LIMIT) {
      const lockLevel = failureCount - CHAPTER_UNLOCK_ATTEMPT_SOFT_LIMIT + 1;
      retryAfterMs = Math.min(
        CHAPTER_UNLOCK_ATTEMPT_MAX_DELAY_MS,
        CHAPTER_UNLOCK_ATTEMPT_BASE_DELAY_MS * lockLevel
      );
    }

    const blockedUntil = retryAfterMs > 0 ? safeNow + retryAfterMs : 0;
    chapterUnlockAttemptMap.set(attemptKey, {
      failureCount,
      blockedUntil,
      lastAttemptAt: safeNow
    });

    return {
      failureCount,
      retryAfterMs: retryAfterMs > 0 ? retryAfterMs : 0
    };
  };

  const clearChapterUnlockFailures = (attemptKey) => {
    if (!attemptKey) return;
    chapterUnlockAttemptMap.delete(attemptKey);
  };

  const toSafeChapterViewCount = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
  };

  const computeChapterViewThreshold = (pageCountInput) => {
    const pageCount = Math.max(Number(pageCountInput) || 0, 0);
    const threshold = Math.floor(pageCount / 2 + 1);
    return Math.max(1, threshold);
  };

  const toSafeTimestampMs = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
  };

  const safeStringEquals = (leftValue, rightValue) => {
    const left = Buffer.from((leftValue == null ? "" : String(leftValue)).trim());
    const right = Buffer.from((rightValue == null ? "" : String(rightValue)).trim());
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  };

  const chapterPageFilePrefixPattern = /^[a-zA-Z]{5}$/;

  const normalizeChapterPageFilePrefix = (value) => {
    const text = (value || "").toString().trim();
    if (!text) return "";
    return chapterPageFilePrefixPattern.test(text) ? text : "";
  };

  const buildChapterPageAssetFileName = ({ pageNumber, padLength, pagesExt, pageFilePrefix }) => {
    const safePageNumber = Number(pageNumber);
    if (!Number.isFinite(safePageNumber) || safePageNumber <= 0) return "";
    const safePadLength = Math.max(1, Math.floor(Number(padLength) || 0));
    const extension = (pagesExt || "").toString().trim().toLowerCase();
    if (!extension) return "";
    const pageName = String(Math.floor(safePageNumber)).padStart(safePadLength, "0");
    const normalizedFilePrefix = normalizeChapterPageFilePrefix(pageFilePrefix);
    return normalizedFilePrefix ? `${pageName}_${normalizedFilePrefix}.${extension}` : `${pageName}.${extension}`;
  };

  const buildChapterViewTrackToken = ({ chapterId, startedAt, nonce }) => {
    const safeChapterId = toSafeTimestampMs(chapterId);
    const safeStartedAt = toSafeTimestampMs(startedAt);
    const safeNonce = (nonce || "").toString().trim().toLowerCase();
    const payload = `${safeChapterId}.${safeStartedAt}.${safeNonce}`;
    const signature = crypto
      .createHmac("sha256", CHAPTER_VIEW_TOKEN_SECRET)
      .update(payload)
      .digest("hex");
    return `${payload}.${signature}`;
  };

  const parseChapterViewTrackToken = (tokenInput) => {
    const raw = (tokenInput || "").toString().trim().toLowerCase();
    const match = raw.match(/^([0-9]+)\.([0-9]+)\.([a-f0-9]{16,128})\.([a-f0-9]{64})$/i);
    if (!match) return null;

    const chapterId = toSafeTimestampMs(match[1]);
    const startedAt = toSafeTimestampMs(match[2]);
    const nonce = (match[3] || "").toString().trim().toLowerCase();
    const signature = (match[4] || "").toString().trim().toLowerCase();
    if (!chapterId || !startedAt || !nonce || !signature) return null;

    return {
      chapterId,
      startedAt,
      nonce,
      signature,
      payload: `${chapterId}.${startedAt}.${nonce}`
    };
  };

  const normalizeChapterViewSessionEntry = (entryInput) => {
    if (!entryInput || typeof entryInput !== "object") return null;
    const startedAt = toSafeTimestampMs(entryInput.startedAt);
    const nonce = (entryInput.nonce || "").toString().trim().toLowerCase();
    const countedAt = toSafeTimestampMs(entryInput.countedAt);
    if (!startedAt || !nonce) return null;

    return {
      startedAt,
      nonce,
      countedAt: countedAt || 0
    };
  };

  const readChapterViewSessionMap = (sessionValue, nowMs) => {
    const safeNow = toSafeTimestampMs(nowMs) || Date.now();
    const source = sessionValue && typeof sessionValue === "object" ? sessionValue : {};
    const normalized = [];

    Object.keys(source).forEach((key) => {
      const chapterId = toSafeTimestampMs(key);
      if (!chapterId) return;
      const entry = normalizeChapterViewSessionEntry(source[key]);
      if (!entry) return;
      if (safeNow - entry.startedAt > CHAPTER_VIEW_TRACK_WINDOW_MS * 3) return;
      normalized.push({
        chapterId,
        entry
      });
    });

    normalized.sort((left, right) => {
      const leftSort = Math.max(left.entry.countedAt || 0, left.entry.startedAt || 0);
      const rightSort = Math.max(right.entry.countedAt || 0, right.entry.startedAt || 0);
      return rightSort - leftSort;
    });

    const limited = normalized.slice(0, CHAPTER_VIEW_MAX_SESSION_ITEMS);
    const result = {};
    limited.forEach((item) => {
      result[String(item.chapterId)] = item.entry;
    });
    return result;
  };

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
      .replace(/&apos;/gi, "'")
      .replace(/&#x([0-9a-f]{1,6});/gi, (fullMatch, hexValue) => {
        const codePoint = Number.parseInt(String(hexValue || ""), 16);
        if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
          return fullMatch;
        }
        try {
          return String.fromCodePoint(codePoint);
        } catch (_err) {
          return fullMatch;
        }
      })
      .replace(/&#([0-9]{1,7});/g, (fullMatch, decimalValue) => {
        const codePoint = Number.parseInt(String(decimalValue || ""), 10);
        if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
          return fullMatch;
        }
        try {
          return String.fromCodePoint(codePoint);
        } catch (_err) {
          return fullMatch;
        }
      });

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

  let pgTrgmEnabled = null;

  const resolvePgTrgmEnabled = async () => {
    if (typeof pgTrgmEnabled === "boolean") {
      return pgTrgmEnabled;
    }

    try {
      const row = await dbGet(
        "SELECT 1 as ok FROM pg_extension WHERE extname = 'pg_trgm' LIMIT 1"
      );
      pgTrgmEnabled = Boolean(row && row.ok);
    } catch (_error) {
      pgTrgmEnabled = false;
    }

    return pgTrgmEnabled;
  };

  const normalizeMangaSearchQuery = (value, maxLength = 80) =>
    (value == null ? "" : String(value))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, Math.max(1, Number(maxLength) || 80));

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
        interactionParentId: 0,
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
        interactionParentId: 0,
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

    if (!directParentId) {
      return {
        parentId,
        interactionParentId: parentId,
        parentAuthorUserId,
        rootCommentId: parentId,
        parentProvided,
        invalidParent: false,
      };
    }

    if (!isForumRequest) {
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
          interactionParentId: 0,
          parentAuthorUserId: "",
          rootCommentId: 0,
          parentProvided,
          invalidParent: true,
        };
      }

      return {
        parentId: directParentId,
        interactionParentId: parentId,
        parentAuthorUserId,
        rootCommentId: directParentId,
        parentProvided,
        invalidParent: false,
      };
    }

    const directParentRow = await dbGet(
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
    const directParentParentIdRaw = directParentRow ? Number(directParentRow.parent_id) : NaN;
    const directParentParentId = Number.isFinite(directParentParentIdRaw) && directParentParentIdRaw > 0
      ? Math.floor(directParentParentIdRaw)
      : 0;
    if (!directParentRow) {
      return {
        parentId: null,
        interactionParentId: 0,
        parentAuthorUserId: "",
        rootCommentId: 0,
        parentProvided,
        invalidParent: true,
      };
    }

    if (!directParentParentId) {
      return {
        parentId,
        interactionParentId: parentId,
        parentAuthorUserId,
        rootCommentId: directParentId,
        parentProvided,
        invalidParent: false,
      };
    }

    const rootPostRow = await dbGet(
      `
        SELECT
          c.id,
          c.parent_id
        FROM ${targetTable} c
        WHERE c.id = ?
          AND ${commentScope.whereWithoutStatus}
      `,
      [directParentParentId, ...commentScope.params]
    );

    const rootPostParentIdRaw = rootPostRow ? Number(rootPostRow.parent_id) : NaN;
    const rootPostParentId = Number.isFinite(rootPostParentIdRaw) && rootPostParentIdRaw > 0
      ? Math.floor(rootPostParentIdRaw)
      : 0;
    if (!rootPostRow || rootPostParentId) {
      return {
        parentId: null,
        interactionParentId: 0,
        parentAuthorUserId: "",
        rootCommentId: 0,
        parentProvided,
        invalidParent: true,
      };
    }

    return {
      parentId: directParentId,
      interactionParentId: parentId,
      parentAuthorUserId,
      rootCommentId: directParentParentId,
      parentProvided,
      invalidParent: false,
    };
  };

  const createCommentInteractionNotifications = async ({
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
    const actorUserId = (authorUserId || "").toString().trim();
    if (!actorUserId) {
      return {
        createdCount: 0,
        notifiedUserIds: []
      };
    }

    const parentValue = Number(parentId);
    const rootValue = Number(rootCommentId);
    if (!Number.isFinite(parentValue) || parentValue <= 0) {
      return {
        createdCount: 0,
        notifiedUserIds: []
      };
    }
    if (!Number.isFinite(rootValue) || rootValue <= 0) {
      return {
        createdCount: 0,
        notifiedUserIds: []
      };
    }
    const safeParentId = Math.floor(parentValue);
    const safeRootId = Math.floor(rootValue);

    const safeCommentIdRaw = Number(commentId);
    if (!Number.isFinite(safeCommentIdRaw) || safeCommentIdRaw <= 0) {
      return {
        createdCount: 0,
        notifiedUserIds: []
      };
    }
    const safeCommentId = Math.floor(safeCommentIdRaw);
    const preview =
      typeof buildCommentNotificationPreview === "function" ? buildCommentNotificationPreview(content) : "";
    const createdAt = Date.now();
    const mangaIdValue = Number(mangaId);
    const chapterValue = chapterNumber == null ? NaN : Number(chapterNumber);
    const notificationMangaId =
      !isForumRequest && Number.isFinite(mangaIdValue) && mangaIdValue > 0 ? Math.floor(mangaIdValue) : null;
    const notificationChapterNumber =
      !isForumRequest && Number.isFinite(chapterValue) ? chapterValue : null;

    const normalizedParentAuthorUserId = (parentAuthorUserId || "").toString().trim();
    const notificationsToCreate = [];

    if (isForumRequest && safeParentId === safeRootId) {
      if (normalizedParentAuthorUserId && normalizedParentAuthorUserId !== actorUserId) {
        notificationsToCreate.push({
          userId: normalizedParentAuthorUserId,
          type: NOTIFICATION_TYPE_FORUM_POST_COMMENT
        });
      }
    } else if (normalizedParentAuthorUserId && normalizedParentAuthorUserId !== actorUserId) {
      notificationsToCreate.push({
        userId: normalizedParentAuthorUserId,
        type: NOTIFICATION_TYPE_COMMENT_REPLY
      });
    }

    if (!notificationsToCreate.length) {
      return {
        createdCount: 0,
        notifiedUserIds: []
      };
    }

    let createdCount = 0;
    const notifiedUserIdSet = new Set();

    for (const notification of notificationsToCreate) {
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
          notification.userId,
          notification.type,
          actorUserId,
          notificationMangaId,
          notificationChapterNumber,
          safeCommentId,
          preview,
          createdAt,
        ]
      );

      if (inserted && inserted.changes) {
        createdCount += inserted.changes;
        notifiedUserIdSet.add(notification.userId);
        publishNotificationStreamUpdate({ userId: notification.userId, reason: "created" }).catch(() => null);
      }
    }

    return {
      createdCount,
      notifiedUserIds: Array.from(notifiedUserIdSet)
    };
  };

  const createTeamCommentNotifications = async ({
    mangaId,
    chapterNumber,
    commentId,
    authorUserId,
    content
  }) => {
    const safeMangaIdRaw = Number(mangaId);
    const safeCommentIdRaw = Number(commentId);
    const actorUserId = (authorUserId || "").toString().trim();
    if (!Number.isFinite(safeMangaIdRaw) || safeMangaIdRaw <= 0) {
      return { createdCount: 0, notifiedUserIds: [] };
    }
    if (!Number.isFinite(safeCommentIdRaw) || safeCommentIdRaw <= 0) {
      return { createdCount: 0, notifiedUserIds: [] };
    }
    if (!actorUserId) {
      return { createdCount: 0, notifiedUserIds: [] };
    }

    const safeMangaId = Math.floor(safeMangaIdRaw);
    const safeCommentId = Math.floor(safeCommentIdRaw);
    const chapterValue = chapterNumber == null ? NaN : Number(chapterNumber);
    const safeChapterNumber = Number.isFinite(chapterValue) ? chapterValue : null;
    const preview =
      typeof buildCommentNotificationPreview === "function" ? buildCommentNotificationPreview(content) : "";
    const createdAt = Date.now();

    const normalizedMangaGroupNameExpr = "replace(lower(trim(COALESCE(m.group_name, ''))), '_', '-')";
    const normalizedMangaGroupListExpr = `replace(${buildTeamGroupNameListExpr("m.group_name")}, '_', '-')`;
    const normalizedTeamNameExpr = "replace(lower(trim(COALESCE(t.name, ''))), '_', '-')";
    const mangaGroupMatchTeamNameSql = `
      (
        ${normalizedMangaGroupNameExpr} = ${normalizedTeamNameExpr}
        OR (',' || ${normalizedMangaGroupListExpr} || ',') LIKE ('%,' || ${normalizedTeamNameExpr} || ',%')
      )
    `;

    const recipientRows = await dbAll(
      `
        SELECT DISTINCT tm.user_id
        FROM manga m
        JOIN translation_team_members tm
          ON tm.status = 'approved'
        JOIN translation_teams t
          ON t.id = tm.team_id
         AND t.status = 'approved'
        WHERE m.id = ?
          AND ${mangaGroupMatchTeamNameSql}
          AND tm.user_id IS NOT NULL
          AND TRIM(tm.user_id) <> ''
          AND tm.user_id <> ?
      `,
      [safeMangaId, actorUserId]
    ).catch(() => []);

    const recipientUserIds = (Array.isArray(recipientRows) ? recipientRows : [])
      .map((row) => (row && row.user_id ? String(row.user_id).trim() : ""))
      .filter(Boolean);

    if (!recipientUserIds.length) {
      return { createdCount: 0, notifiedUserIds: [] };
    }

    let createdCount = 0;
    const notifiedUserIdSet = new Set();

    for (const userId of recipientUserIds) {
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
          userId,
          NOTIFICATION_TYPE_TEAM_MANGA_COMMENT,
          actorUserId,
          safeMangaId,
          safeChapterNumber,
          safeCommentId,
          preview,
          createdAt
        ]
      );

      if (inserted && inserted.changes) {
        createdCount += inserted.changes;
        notifiedUserIdSet.add(userId);
        publishNotificationStreamUpdate({ userId, reason: "created" }).catch(() => null);
      }
    }

    return {
      createdCount,
      notifiedUserIds: Array.from(notifiedUserIdSet)
    };
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
  let homepageCacheUpdatedAt = "";
  const SEO_TRENDING_KEYWORDS = Object.freeze([
    "đọc truyện tranh",
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
      .replace(/[đĐ]/g, "d")
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

  const readCachedTeamCommunityName = (cacheKey) => {
    const key = (cacheKey || "").toString().trim();
    if (!key) return null;
    const cached = teamCommunityNameCache.get(key);
    if (!cached || typeof cached !== "object") return null;
    if (!Number.isFinite(Number(cached.expiresAt)) || Number(cached.expiresAt) <= Date.now()) {
      teamCommunityNameCache.delete(key);
      return null;
    }
    return (cached.value || "").toString().trim();
  };

  const writeCachedTeamCommunityName = (cacheKey, value, { success = true } = {}) => {
    const key = (cacheKey || "").toString().trim();
    if (!key) return;
    const safeValue = (value || "").toString().trim();
    const ttl = success ? TEAM_COMMUNITY_NAME_SUCCESS_TTL_MS : TEAM_COMMUNITY_NAME_FAILURE_TTL_MS;
    teamCommunityNameCache.set(key, {
      value: safeValue,
      expiresAt: Date.now() + ttl
    });
  };

  const fetchWithTimeout = async (url, options = {}) => {
    if (typeof fetch !== "function") return null;
    const timeoutCandidate = Number(options && options.timeoutMs != null ? options.timeoutMs : TEAM_COMMUNITY_LOOKUP_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(timeoutCandidate)
      ? Math.max(1000, Math.min(15000, Math.floor(timeoutCandidate)))
      : TEAM_COMMUNITY_LOOKUP_TIMEOUT_MS;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timeoutHandle = null;
    if (controller) {
      timeoutHandle = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
    }

    try {
      const requestOptions = {
        ...(options && typeof options === "object" ? options : {})
      };
      delete requestOptions.timeoutMs;
      if (controller) {
        requestOptions.signal = controller.signal;
      }
      return await fetch(url, requestOptions);
    } catch (_err) {
      return null;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  };

  const extractDiscordInviteCode = (inviteUrlOrCode) => {
    const input = (inviteUrlOrCode || "").toString().trim();
    if (!input) return "";
    if (!/^https?:\/\//i.test(input)) return input;

    try {
      const parsed = new URL(input);
      const hostname = (parsed.hostname || "").toLowerCase();
      if (hostname === "discord.gg" || hostname === "www.discord.gg") {
        return (parsed.pathname || "").replace(/^\/+/, "").split("/")[0] || "";
      }
      if (hostname === "discord.com" || hostname === "www.discord.com") {
        const pathParts = (parsed.pathname || "").split("/").filter(Boolean);
        if (pathParts[0] === "invite" && pathParts[1]) {
          return pathParts[1];
        }
      }
    } catch (_err) {
      return "";
    }

    return "";
  };

  const extractFacebookPageNameFromHtml = (html) => {
    const source = (html || "").toString();
    if (!source) return "";
    const titleMatch = source.match(/<div[^>]*class="lfloat"[^>]*>[\s\S]*?<a[^>]*title="([^"]+)"/i);
    if (titleMatch && titleMatch[1]) {
      return decodeBasicHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim();
    }
    const ogTitleMatch = source.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
      return decodeBasicHtmlEntities(ogTitleMatch[1]).replace(/\s+/g, " ").trim();
    }
    return "";
  };

  const resolveFacebookPageDisplayName = async (facebookUrl) => {
    const normalizedUrl = normalizeTeamFacebookUrl(facebookUrl || "");
    if (!normalizedUrl) return "";

    const cacheKey = `team-facebook:${normalizedUrl.toLowerCase()}`;
    const cachedName = readCachedTeamCommunityName(cacheKey);
    if (cachedName !== null) return cachedName;

    const pluginUrl = `https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(normalizedUrl)}`;
    const response = await fetchWithTimeout(pluginUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "vi,en-US;q=0.9,en;q=0.8"
      },
      timeoutMs: TEAM_COMMUNITY_LOOKUP_TIMEOUT_MS
    });
    if (!response || !response.ok) {
      writeCachedTeamCommunityName(cacheKey, "", { success: false });
      return "";
    }

    const html = await response.text().catch(() => "");
    const pageName = extractFacebookPageNameFromHtml(html);
    if (!pageName) {
      writeCachedTeamCommunityName(cacheKey, "", { success: false });
      return "";
    }

    writeCachedTeamCommunityName(cacheKey, pageName, { success: true });
    return pageName;
  };

  const resolveDiscordServerDisplayName = async (discordUrl) => {
    const normalizedUrl = normalizeTeamDiscordUrl(discordUrl || "");
    if (!normalizedUrl) return "";

    const inviteCode = extractDiscordInviteCode(normalizedUrl);
    if (!inviteCode) return "";

    const cacheKey = `team-discord:${inviteCode.toLowerCase()}`;
    const cachedName = readCachedTeamCommunityName(cacheKey);
    if (cachedName !== null) return cachedName;

    const endpoint = `https://discord.com/api/v9/invites/${encodeURIComponent(inviteCode)}`;
    const response = await fetchWithTimeout(endpoint, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      },
      timeoutMs: TEAM_COMMUNITY_LOOKUP_TIMEOUT_MS
    });
    if (!response || !response.ok) {
      writeCachedTeamCommunityName(cacheKey, "", { success: false });
      return "";
    }

    const payload = await response.json().catch(() => null);
    const serverName = payload && payload.guild && payload.guild.name
      ? String(payload.guild.name).trim()
      : "";
    if (!serverName) {
      writeCachedTeamCommunityName(cacheKey, "", { success: false });
      return "";
    }

    writeCachedTeamCommunityName(cacheKey, serverName, { success: true });
    return serverName;
  };

  const resolveTeamCommunityDisplayNames = async ({ facebookUrl, discordUrl } = {}) => {
    const [facebookDisplayName, discordDisplayName] = await Promise.all([
      resolveFacebookPageDisplayName(facebookUrl || ""),
      resolveDiscordServerDisplayName(discordUrl || "")
    ]);

    return {
      facebookDisplayName,
      discordDisplayName
    };
  };

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
    `replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(trim(COALESCE(${columnSql}, ''))), ' / ', ','), '/', ','), ' & ', ','), '&', ','), ' + ', ','), '+', ','), ';', ','), '|', ','), ' x ', ','), ', ', ','), ' ,', ',')`;

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

  const buildTeamGroupNameColumnMatchSql = (groupColumnSql, teamNameColumnSql) => {
    const normalizedList = buildTeamGroupNameListExpr(groupColumnSql);
    const normalizedTeamName = `lower(trim(COALESCE(${teamNameColumnSql}, '')))`;
    return `
      (
        lower(trim(COALESCE(${groupColumnSql}, ''))) = ${normalizedTeamName}
        OR (',' || ${normalizedList} || ',') LIKE ('%,' || ${normalizedTeamName} || ',%')
        OR lower(COALESCE(${groupColumnSql}, '')) LIKE ('%' || ${normalizedTeamName} || '%')
      )
    `;
  };

  const TEAM_GROUP_NAME_MATCH_MANGA_TEAM_SQL = buildTeamGroupNameColumnMatchSql("m.group_name", "t.name");

  const buildMangaLinkedTeamExistsSql = (mangaAlias = "m") => {
    const alias = (mangaAlias || "m").toString().trim() || "m";
    return `EXISTS (SELECT 1 FROM manga_translation_teams mtt WHERE mtt.manga_id = ${alias}.id AND mtt.team_id = ?)`;
  };

  const listMangaGroupTeamLinksByMangaId = async (mangaId) => {
    const safeMangaId = Number(mangaId);
    if (!Number.isFinite(safeMangaId) || safeMangaId <= 0) return [];

    const rows = await dbAll(
      `
        SELECT
          t.id,
          t.name,
          t.slug
        FROM manga_translation_teams mtt
        JOIN translation_teams t ON t.id = mtt.team_id
        WHERE mtt.manga_id = ?
          AND t.status = 'approved'
        ORDER BY mtt.team_id ASC, lower(t.name) ASC, t.id ASC
      `,
      [Math.floor(safeMangaId)]
    );

    return (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const label = (row && row.name ? String(row.name) : "").trim();
        const url = buildTeamPublicPath(row && row.id, row && row.slug ? row.slug : "");
        if (!label) return null;
        return { label, url };
      })
      .filter(Boolean);
  };

  const canDeleteMangaCommentsByTeamMember = async ({ userId, mangaId }) => {
    const safeUserId = (userId || "").toString().trim();
    const numericMangaId = Number(mangaId);
    if (!safeUserId) return false;
    if (!Number.isFinite(numericMangaId) || numericMangaId <= 0) return false;

    const row = await dbGet(
      `
        SELECT 1 as ok
        FROM manga_translation_teams mtt
        JOIN translation_teams t ON t.id = mtt.team_id
        JOIN translation_team_members tm ON tm.team_id = mtt.team_id
        WHERE mtt.manga_id = ?
          AND t.status = 'approved'
          AND tm.user_id = ?
          AND tm.status = 'approved'
        LIMIT 1
      `,
      [Math.floor(numericMangaId), safeUserId]
    );
    return Boolean(row && row.ok);
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

  const decodeForumHtmlEntities = (value) =>
    String(value || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");

  const stripForumSpoilerHtml = (value) =>
    String(value || "").replace(
      /<span\b[^>]*class\s*=\s*(["'])[^"']*\bspoiler\b[^"']*\1[^>]*>[\s\S]*?<\/span>/gi,
      " [spoiler] "
    );

  const forumContentToPlainText = (value) => {
    const decoded = decodeForumHtmlEntities(value);
    const withoutHtml = stripForumSpoilerHtml(decoded).replace(/<[^>]+>/g, " ");
    return decodeForumHtmlEntities(withoutHtml).replace(/\s+/g, " ").trim();
  };

  const extractForumTopicHeadline = (content, limit = 84) => {
    const raw = content == null ? "" : String(content);
    const htmlHeadlineMatch = raw.match(/^\s*<p>\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*<\/p>/i);
    const source = htmlHeadlineMatch ? htmlHeadlineMatch[1] : raw;
    const lines = source
      .split(/\r?\n/)
      .map((line) => forumContentToPlainText(line))
      .filter(Boolean);
    if (!lines.length) return "";
    const normalized = lines[0]
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .trim();
    if (!normalized) return "";
    if (normalized.length <= limit) return normalized;
    return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}...`;
  };

  const FORUM_HOME_SECTION_LABEL_BY_SLUG = new Map([
    ["thao-luan-chung", "Thảo luận chung"],
    ["thong-bao", "Thông báo"],
    ["huong-dan", "Hướng dẫn"],
    ["tim-truyen", "Tìm truyện"],
    ["gop-y", "Góp ý"],
    ["tam-su", "Tâm sự"],
    ["chia-se", "Chia sẻ"],
  ]);

  const extractForumSectionSlug = (content) => {
    const match = String(content || "").match(/forum-meta:section=([a-z0-9]+(?:-[a-z0-9]+)*)/i);
    if (!match || !match[1]) return "thao-luan-chung";
    const normalized = String(match[1]).trim().toLowerCase();
    if (normalized === "goi-y") return "gop-y";
    if (normalized === "tin-tuc") return "thong-bao";
    return normalized;
  };

  const buildForumSectionLabel = (content) => {
    const sectionSlug = extractForumSectionSlug(content);
    return FORUM_HOME_SECTION_LABEL_BY_SLUG.get(sectionSlug) || FORUM_HOME_SECTION_LABEL_BY_SLUG.get("thao-luan-chung") || "Thảo luận chung";
  };

  const buildAvatarFallback = (value) => {
    const parts = String(value || "")
      .replace(/^@+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
    if (!parts.length) return "FM";
    if (parts.length === 1) {
      return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
    }
    return `${Array.from(parts[0])[0] || ""}${Array.from(parts[parts.length - 1])[0] || ""}`.toUpperCase();
  };

  const buildForumAuthorDecorationMap = async (rows) => {
    const map = new Map();
    if (typeof getUserBadgeContext !== "function") return map;

    const userIds = Array.from(
      new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => (row && row.author_user_id ? String(row.author_user_id).trim() : ""))
          .filter(Boolean)
      )
    );

    if (!userIds.length) return map;

    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const context = await getUserBadgeContext(userId);
          map.set(userId, resolveHighestRoleColorFromBadgeContext(context));
        } catch (_error) {
          map.set(userId, "");
        }
      })
    );

    return map;
  };

  const getPendingTeamMembership = async (userId) => {
    const safeUserId = (userId || "").toString().trim();
    if (!safeUserId) return null;
    return dbGet(
      `
        SELECT
          tm.team_id,
          tm.requested_at,
          tm.status as member_status,
          tm.role as member_role,
          t.name as team_name,
          t.slug as team_slug,
          t.status as team_status,
          CASE
            WHEN tm.status = 'approved' AND tm.role = 'leader' AND t.status = 'pending' THEN 'create'
            ELSE 'join'
          END as pending_kind
        FROM translation_team_members tm
        JOIN translation_teams t ON t.id = tm.team_id
        WHERE tm.user_id = ?
          AND (
            tm.status = 'pending'
            OR (tm.status = 'approved' AND tm.role = 'leader' AND t.status = 'pending')
          )
        ORDER BY
          CASE
            WHEN tm.status = 'approved' AND tm.role = 'leader' AND t.status = 'pending' THEN 0
            ELSE 1
          END,
          tm.requested_at DESC,
          tm.team_id DESC
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
        MAX(
          CASE
            WHEN lower(code) NOT IN ('admin', 'mod')
              AND code !~* '^team_[0-9]+_(leader|member)$'
            THEN priority
          END
        ) as other_priority
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

  const syncUserPrimaryBadgeLabel = async ({ userId, dbGetFn = dbGet, dbRunFn = dbRun }) => {
    const safeUserId = (userId || "").toString().trim();
    if (!safeUserId) return;

    const primaryBadgeRow = await dbGetFn(
      `
        SELECT b.label
        FROM user_badges ub
        JOIN badges b ON b.id = ub.badge_id
        WHERE ub.user_id = ?
        ORDER BY b.priority DESC, b.id ASC
        LIMIT 1
      `,
      [safeUserId]
    );

    const nextBadgeLabel = (primaryBadgeRow && primaryBadgeRow.label ? String(primaryBadgeRow.label) : "")
      .toString()
      .trim();

    await dbRunFn("UPDATE users SET badge = ?, updated_at = ? WHERE id = ?", [nextBadgeLabel, Date.now(), safeUserId]);
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
    if (!isApproved) {
      await syncUserPrimaryBadgeLabel({ userId: safeUserId, dbGetFn, dbRunFn });
      return;
    }

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

    await syncUserPrimaryBadgeLabel({ userId: safeUserId, dbGetFn, dbRunFn });
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
        description: siteNotFoundDescription,
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
      res.vary("Cookie");
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.set("CDN-Cache-Control", "no-store");
      res.set("Cloudflare-CDN-Cache-Control", "no-store");

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
      res.vary("Cookie");
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.set("CDN-Cache-Control", "no-store");
      res.set("Cloudflare-CDN-Cache-Control", "no-store");

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

  const OAUTH_CALLBACK_SESSION_KEYS = Object.freeze({
    google: "oauthGoogleCallbackUrl",
    discord: "oauthDiscordCallbackUrl"
  });

  const normalizeOauthProviderKey = (value) =>
    (value || "").toString().trim().toLowerCase();

  const normalizeOauthCallbackUrlForProvider = (value, providerKey) => {
    const provider = normalizeOauthProviderKey(providerKey);
    if (!provider) return "";

    const raw = (value || "").toString().trim();
    if (!raw) return "";

    try {
      const parsed = new URL(raw);
      const protocol = (parsed.protocol || "").toLowerCase();
      if (protocol !== "http:" && protocol !== "https:") return "";
      const pathname = ensureLeadingSlash(parsed.pathname || "");
      if (pathname !== `/auth/${provider}/callback`) return "";
      return `${parsed.protocol}//${parsed.host}${pathname}`;
    } catch (_err) {
      return "";
    }
  };

  const storeOauthCallbackUrl = (req, providerKey, callbackUrl) => {
    const provider = normalizeOauthProviderKey(providerKey);
    const key = provider ? OAUTH_CALLBACK_SESSION_KEYS[provider] : "";
    if (!key || !req || !req.session) return;

    const normalized = normalizeOauthCallbackUrlForProvider(callbackUrl, provider);
    if (normalized) {
      req.session[key] = normalized;
      return;
    }

    delete req.session[key];
  };

  const readStoredOauthCallbackUrl = (req, providerKey) => {
    const provider = normalizeOauthProviderKey(providerKey);
    const key = provider ? OAUTH_CALLBACK_SESSION_KEYS[provider] : "";
    if (!key || !req || !req.session) return "";

    const stored = normalizeOauthCallbackUrlForProvider(req.session[key], provider);
    delete req.session[key];
    return stored;
  };

  const resolveOauthCallbackUrl = (req, providerKey) => {
    const provider = normalizeOauthProviderKey(providerKey);
    if (!provider) return "";
    const stored = readStoredOauthCallbackUrl(req, provider);
    if (stored) return stored;
    return normalizeOauthCallbackUrlForProvider(buildOAuthCallbackUrl(req, provider), provider);
  };

  const mapOauthErrorCodeToLoginErrorCode = (value) => {
    const code = (value || "").toString().trim().toUpperCase();
    if (code === "AUTH_EMAIL_DOMAIN_NOT_ALLOWED") return "email_domain_not_allowed";
    if (code === "AUTH_EMAIL_REQUIRED") return "email_required";
    if (code === "AUTH_EMAIL_NOT_VERIFIED") return "email_not_verified";
    return "";
  };

  const buildAuthLoginErrorRedirectPath = (nextPath, loginErrorCode) => {
    const safeNextPath = normalizeNextPath(nextPath || "/");
    const safeCode = (loginErrorCode || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!safeCode) return safeNextPath;

    try {
      const parsed = new URL(safeNextPath, "http://localhost");
      parsed.searchParams.set("auth", "login");
      parsed.searchParams.set("login", "1");
      parsed.searchParams.set("login_error", safeCode);
      return `${parsed.pathname}${parsed.search || ""}${parsed.hash || ""}` || "/";
    } catch (_err) {
      const params = new URLSearchParams();
      params.set("auth", "login");
      params.set("login", "1");
      params.set("login_error", safeCode);
      return `/?${params.toString()}`;
    }
  };

  const runOauthCallbackAuthentication = ({ req, res, next, providerKey, strategyName, failureRedirect }) => {
    const provider = normalizeOauthProviderKey(providerKey);
    if (!provider || !strategyName) {
      return res.redirect(failureRedirect);
    }

    const callbackURL = resolveOauthCallbackUrl(req, provider);
    if (!callbackURL) {
      console.warn(`${provider} OAuth callback URL is empty.`);
      return res.redirect(failureRedirect);
    }

    return passport.authenticate(
      strategyName,
      {
        callbackURL,
        session: false
      },
      (err, profile) => {
        if (err) {
          const oauthError = (req && req.query && req.query.error ? req.query.error : "").toString().trim();
          const oauthErrorDescription =
            (req && req.query && req.query.error_description ? req.query.error_description : "").toString().trim();
          console.warn(`${provider} OAuth callback failed.`, {
            message: err && err.message ? err.message : String(err || ""),
            oauthError,
            oauthErrorDescription,
            callbackURL
          });
          return res.redirect(failureRedirect);
        }
        if (!profile) {
          return res.redirect(failureRedirect);
        }
        req.user = profile;
        return next();
      }
    )(req, res, next);
  };

  app.get("/auth/google", (req, res, next) => {
    if (!isOauthProviderEnabled("google")) {
      return res.status(503).send("Google OAuth chưa được cấu hình.");
    }

    req.session.authNextPath = normalizeNextPath(req.query.next || "/");
    const callbackURL = buildOAuthCallbackUrl(req, "google");
    if (!callbackURL) {
      return res.status(500).send("Không xác định được callback URL cho Google OAuth.");
    }

    storeOauthCallbackUrl(req, "google", callbackURL);

    return passport.authenticate(AUTH_GOOGLE_STRATEGY, {
      callbackURL,
      session: false,
      scope: ["profile", "email"],
      prompt: "select_account",
      state: true
    })(req, res, next);
  });

  app.get("/auth/google/callback", (req, res, next) => {
    if (!isOauthProviderEnabled("google")) {
      return res.redirect("/");
    }

    return runOauthCallbackAuthentication({
      req,
      res,
      next,
      providerKey: "google",
      strategyName: AUTH_GOOGLE_STRATEGY,
      failureRedirect: "/?auth=failed"
    });
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
      const loginErrorCode = mapOauthErrorCodeToLoginErrorCode(err && err.code ? err.code : "");
      if (loginErrorCode) {
        return res.redirect(buildAuthLoginErrorRedirectPath(nextPath || "/", loginErrorCode));
      }
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

    storeOauthCallbackUrl(req, "discord", callbackURL);

    return passport.authenticate(AUTH_DISCORD_STRATEGY, {
      callbackURL,
      session: false
    })(req, res, next);
  });

  app.get("/auth/discord/callback", (req, res, next) => {
    if (!isOauthProviderEnabled("discord")) {
      return res.redirect("/");
    }

    return runOauthCallbackAuthentication({
      req,
      res,
      next,
      providerKey: "discord",
      strategyName: AUTH_DISCORD_STRATEGY,
      failureRedirect: "/?auth=failed"
    });
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
      const loginErrorCode = mapOauthErrorCodeToLoginErrorCode(err && err.code ? err.code : "");
      if (loginErrorCode) {
        return res.redirect(buildAuthLoginErrorRedirectPath(nextPath || "/", loginErrorCode));
      }
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
        description: `Quản lý thông tin hồ sơ và cài đặt tài khoản ${SEO_SITE_NAME}.`,
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
      publicShareToken: "",
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
    "/account/saved/share/:shareToken",
    asyncHandler(async (req, res) => {
      const shareToken = (req.params && req.params.shareToken ? String(req.params.shareToken) : "").trim();
      const sharedList = shareToken
        ? await dbGet(
          `
            SELECT
              l.id,
              l.name,
              u.username,
              u.display_name,
              (
                SELECT COUNT(*)
                FROM manga_bookmark_list_items li_count
                JOIN manga m_count ON m_count.id = li_count.manga_id
                WHERE li_count.list_id = l.id
                  AND COALESCE(m_count.is_hidden, 0) = 0
              ) as item_count,
              (
                SELECT m_cover.cover
                FROM manga_bookmark_list_items li_cover
                JOIN manga m_cover ON m_cover.id = li_cover.manga_id
                WHERE li_cover.list_id = l.id
                  AND COALESCE(m_cover.is_hidden, 0) = 0
                  AND COALESCE(m_cover.cover, '') <> ''
                ORDER BY li_cover.updated_at DESC, li_cover.manga_id DESC
                LIMIT 1
              ) as seo_cover,
              (
                SELECT COALESCE(m_cover.cover_updated_at, 0)
                FROM manga_bookmark_list_items li_cover
                JOIN manga m_cover ON m_cover.id = li_cover.manga_id
                WHERE li_cover.list_id = l.id
                  AND COALESCE(m_cover.is_hidden, 0) = 0
                  AND COALESCE(m_cover.cover, '') <> ''
                ORDER BY li_cover.updated_at DESC, li_cover.manga_id DESC
                LIMIT 1
              ) as seo_cover_updated_at
            FROM manga_bookmark_lists l
            LEFT JOIN users u ON u.id = l.user_id
            WHERE l.share_token = ?
              AND l.is_public = true
            LIMIT 1
          `,
          [shareToken]
        )
        : null;
      if (!sharedList) {
        return renderNotFoundPage(req, res);
      }

      const shareOwnerName = (sharedList.display_name || sharedList.username || "người dùng").toString().trim();
      const shareListName = (sharedList.name || "Danh sách truyện").toString().trim() || "Danh sách truyện";
      const shareItemCount = sharedList.item_count != null ? Number(sharedList.item_count) || 0 : 0;
      const shareItemCountText = `${shareItemCount.toLocaleString("vi-VN")} truyện`;
      const sharePagePath = `/account/saved/share/${encodeURIComponent(shareToken)}`;
      const sharePageUrl = toAbsolutePublicUrl(req, sharePagePath);
      const shareImagePath = cacheBust(sharedList.seo_cover || "/logobfang.svg", sharedList.seo_cover_updated_at || 0);
      const shareImageUrl = toAbsolutePublicUrl(req, shareImagePath);
      const shareSeoTitle = `${shareListName} • Danh sách truyện của ${shareOwnerName}`;
      const shareSeoDescription = shareItemCount > 0
        ? `Đây là danh sách truyện được chia sẻ công khai của ${shareOwnerName} với ${shareItemCountText}.`
        : `Đây là danh sách truyện được chia sẻ công khai của ${shareOwnerName}.`;
      const siteOrigin = getPublicOriginFromRequest(req);
      const homepageUrl = toAbsolutePublicUrl(req, "/");

      return res.render("bookmarks", {
        title: "Danh sách truyện",
        team,
        publicShareToken: shareToken,
        publicShareOwnerName: shareOwnerName,
        seo: buildSeoPayload(req, {
          title: shareSeoTitle,
          description: shareSeoDescription,
          keywords: [shareListName, shareOwnerName, "danh sách truyện", "chia sẻ công khai", SEO_SITE_NAME],
          robots: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
          canonicalPath: sharePagePath,
          ogType: "website",
          image: shareImageUrl,
          jsonLd: [
            {
              "@context": "https://schema.org",
              "@type": "CollectionPage",
              name: shareSeoTitle,
              description: shareSeoDescription,
              url: sharePageUrl,
              inLanguage: "vi-VN",
              image: shareImageUrl,
              isPartOf: {
                "@type": "WebSite",
                name: SEO_SITE_NAME,
                url: siteOrigin || homepageUrl
              },
              mainEntity: {
                "@type": "ItemList",
                name: shareListName,
                numberOfItems: shareItemCount
              }
            },
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "Trang chủ",
                  item: homepageUrl
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "Danh sách truyện",
                  item: sharePageUrl
                }
              ]
            }
          ]
        })
      });
    })
  );

  app.get(
    "/publish",
    asyncHandler(async (req, res) => {
      const user = await resolveOptionalPrivateFeatureAuthUser(req);
      const userId = user && user.id ? String(user.id).trim() : "";
      const canAccessAdminBadge = userId ? await hasAdminBadgeAccess(userId) : false;
      const membership = userId ? await getApprovedTeamMembership(userId) : null;
      const pendingMembership = !membership && userId ? await getPendingTeamMembership(userId) : null;

      const publishState = {
        requiresLogin: !userId,
        inTeam: false,
        roleLabel: "",
        team: null,
        pendingTeam: null,
        canReviewRequests: false,
        pendingRequests: [],
        manageMangaUrl: ""
      };

      if (pendingMembership) {
        const pendingTeamId = Number(pendingMembership.team_id);
        const pendingKind = (pendingMembership.pending_kind || "join").toString().trim().toLowerCase() === "create"
          ? "create"
          : "join";
        publishState.pendingTeam = {
          id: Number.isFinite(pendingTeamId) && pendingTeamId > 0 ? Math.floor(pendingTeamId) : 0,
          name: (pendingMembership.team_name || "").toString().trim(),
          slug: (pendingMembership.team_slug || "").toString().trim(),
          requestedAt: Number(pendingMembership.requested_at) || 0,
          teamStatus: (pendingMembership.team_status || "").toString().trim().toLowerCase() || "pending",
          pendingKind
        };
      }

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
        msg.image_url as last_message_image_url,
        msg.created_at as last_message_created_at,
        msg.sender_user_id as last_message_sender_user_id
      FROM chat_thread_members self_member
      JOIN chat_threads t ON t.id = self_member.thread_id
      JOIN chat_thread_members other_member ON other_member.thread_id = t.id AND other_member.user_id <> self_member.user_id
      JOIN users other ON other.id = other_member.user_id
      LEFT JOIN LATERAL (
        SELECT id, content, image_url, created_at, sender_user_id
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

      const mapThreadRow = (row) => {
        const safeImageUrl = readSafeUploadedImageUrl(row.last_message_image_url || "");
        const safeContent = (row.last_message_content || "").toString();
        const previewContent = safeContent.trim() || (safeImageUrl ? CHAT_IMAGE_PREVIEW_TEXT : "");
        return {
          id: Number(row.id),
          lastMessageAt: Number(row.last_message_created_at || row.last_message_at) || 0,
          lastMessageId: Number(row.last_message_id) || 0,
          lastMessageContent: previewContent,
          lastMessageImageUrl: safeImageUrl,
          lastMessageHasImage: Boolean(safeImageUrl),
          lastMessageSenderUserId: row.last_message_sender_user_id || "",
          otherUser: {
            id: row.other_user_id,
            username: row.other_username || "",
            displayName: (row.other_display_name || "").toString().trim(),
            avatarUrl: normalizeAvatarUrl(row.other_avatar_url || "")
          }
        };
      };

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
          SELECT id, thread_id, sender_user_id, content, image_url, created_at
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
            imageUrl: readSafeUploadedImageUrl(row.image_url || ""),
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
          initialMessagesHasMore,
          messageImageUploadsEnabled: Boolean(messageImageUploadsEnabled)
        },
        headScripts: {
          notifications: false,
          messagesIndicator: false
        },
        seo: buildSeoPayload(req, {
          title: "Tin nhắn",
          description: `Nhắn tin với các thành viên trong cộng đồng ${SEO_SITE_NAME}.`,
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
        const pendingMembership = await getPendingTeamMembership(userId);
        if (!pendingMembership) {
          return res.json({ ok: true, inTeam: false, team: null, roleLabel: "", pendingTeam: null });
        }

        const pendingTeamId = Number(pendingMembership.team_id);
        const pendingKind = (pendingMembership.pending_kind || "join").toString().trim().toLowerCase() === "create"
          ? "create"
          : "join";
        return res.json({
          ok: true,
          inTeam: false,
          team: null,
          roleLabel: "",
          pendingTeam: {
            id: Number.isFinite(pendingTeamId) && pendingTeamId > 0 ? Math.floor(pendingTeamId) : 0,
            name: (pendingMembership.team_name || "").toString().trim(),
            slug: (pendingMembership.team_slug || "").toString().trim(),
            requestedAt: Number(pendingMembership.requested_at) || 0,
            teamStatus: (pendingMembership.team_status || "").toString().trim().toLowerCase() || "pending",
            pendingKind
          }
        });
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
        message: `Nhóm dịch ${name} đang được chờ duyệt.`,
        pendingKind: "create",
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

      const safeTeamId = Math.floor(teamId);

      const current = await dbGet(
        `
        SELECT
          tm.team_id,
          tm.status,
          t.name AS team_name,
          t.slug AS team_slug
        FROM translation_team_members tm
        LEFT JOIN translation_teams t ON t.id = tm.team_id
        WHERE tm.user_id = ?
          AND tm.status IN ('pending', 'approved')
        ORDER BY
          CASE WHEN tm.status = 'approved' THEN 0 ELSE 1 END,
          tm.requested_at DESC NULLS LAST,
          tm.team_id DESC
        LIMIT 1
      `,
        [userId]
      );
      if (current) {
        const currentTeamId = Number(current.team_id);
        const currentStatus = (current.status || "").toString().trim().toLowerCase();
        const currentTeamName = (current.team_name || "").toString().trim() || "nhóm dịch khác";
        const currentTeamSlug = (current.team_slug || "").toString().trim();
        const requestedSameTeam = Number.isFinite(currentTeamId) && currentTeamId > 0 && currentTeamId === safeTeamId;

        let conflictMessage = "Bạn đã có nhóm dịch hoặc đang chờ duyệt.";
        if (requestedSameTeam && currentStatus === "approved") {
          conflictMessage = "Bạn đã là thành viên của nhóm này.";
        } else if (requestedSameTeam && currentStatus === "pending") {
          conflictMessage = "Bạn đã gửi yêu cầu tham gia nhóm này rồi.";
        } else if (currentStatus === "approved") {
          conflictMessage = `Bạn đang là thành viên của nhóm ${currentTeamName}.`;
        } else if (currentStatus === "pending") {
          conflictMessage = `Bạn đang chờ duyệt vào nhóm ${currentTeamName}.`;
        }

        return res.status(409).json({
          ok: false,
          error: conflictMessage,
          currentTeam: {
            id: Number.isFinite(currentTeamId) && currentTeamId > 0 ? Math.floor(currentTeamId) : 0,
            name: currentTeamName,
            slug: currentTeamSlug,
            status: currentStatus || "pending"
          }
        });
      }

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

  app.post(
    "/teams/join-request/cancel",
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

      const requestedTeamIdRaw = Number(req.body && req.body.teamId);
      const hasTeamFilter = Number.isFinite(requestedTeamIdRaw) && requestedTeamIdRaw > 0;
      const requestedTeamId = hasTeamFilter ? Math.floor(requestedTeamIdRaw) : 0;

      const pendingRow = await dbGet(
        `
        SELECT
          tm.team_id,
          tm.status AS member_status,
          tm.role AS member_role,
          tm.requested_at,
          t.name AS team_name,
          t.slug AS team_slug,
          t.status AS team_status,
          t.created_by_user_id AS team_creator_user_id
        FROM translation_team_members tm
        LEFT JOIN translation_teams t ON t.id = tm.team_id
        WHERE tm.user_id = ?
          AND (
            tm.status = 'pending'
            OR (tm.status = 'approved' AND tm.role = 'leader' AND t.status = 'pending')
          )
          AND (? = 0 OR tm.team_id = ?)
        ORDER BY
          CASE
            WHEN tm.status = 'approved' AND tm.role = 'leader' AND t.status = 'pending' THEN 0
            ELSE 1
          END,
          tm.requested_at DESC NULLS LAST,
          tm.team_id DESC
        LIMIT 1
      `,
        [userId, requestedTeamId, requestedTeamId]
      );

      if (!pendingRow) {
        return res.status(404).json({ ok: false, error: "Bạn không có yêu cầu tham gia nào đang chờ duyệt." });
      }

      const pendingTeamId = Number(pendingRow.team_id);
      if (!Number.isFinite(pendingTeamId) || pendingTeamId <= 0) {
        return res.status(404).json({ ok: false, error: "Yêu cầu tham gia không hợp lệ." });
      }

      const safePendingTeamId = Math.floor(pendingTeamId);
      const pendingMemberStatus = (pendingRow.member_status || "").toString().trim().toLowerCase();
      const pendingMemberRole = (pendingRow.member_role || "").toString().trim().toLowerCase();
      const pendingTeamStatus = (pendingRow.team_status || "").toString().trim().toLowerCase();
      const pendingKind =
        pendingMemberStatus === "approved" && pendingMemberRole === "leader" && pendingTeamStatus === "pending"
          ? "create"
          : "join";
      const pendingTeamCreatorId = (pendingRow.team_creator_user_id || "").toString().trim();

      if (pendingKind === "create" && pendingTeamCreatorId && pendingTeamCreatorId !== userId) {
        return res.status(403).json({ ok: false, error: "Bạn không có quyền hủy yêu cầu tạo nhóm này." });
      }

      const cancelResult = await withTransaction(async ({ dbRun: txRun, dbAll: txAll }) => {
        if (pendingKind === "create") {
          const deleteTeam = await txRun(
            "DELETE FROM translation_teams WHERE id = ? AND status = 'pending' AND created_by_user_id = ?",
            [safePendingTeamId, userId]
          );

          if (!deleteTeam || !deleteTeam.changes) {
            return {
              ok: false,
              notifiedLeaderIds: []
            };
          }

          await txRun("DELETE FROM notifications WHERE team_id = ?", [safePendingTeamId]);

          return {
            ok: true,
            notifiedLeaderIds: []
          };
        }

        const deleteRow = await txRun(
          "DELETE FROM translation_team_members WHERE team_id = ? AND user_id = ? AND status = 'pending'",
          [safePendingTeamId, userId]
        );
        if (!deleteRow || !deleteRow.changes) {
          return {
            ok: false,
            notifiedLeaderIds: []
          };
        }

        await txRun(
          "DELETE FROM notifications WHERE team_id = ? AND actor_user_id = ? AND type = ? AND is_read = false",
          [safePendingTeamId, userId, NOTIFICATION_TYPE_TEAM_JOIN_REQUEST]
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
          [safePendingTeamId]
        );

        const notifiedLeaderIds = Array.from(
          new Set(
            (Array.isArray(leaderRows) ? leaderRows : [])
              .map((row) => (row && row.user_id ? String(row.user_id).trim() : ""))
              .filter((value) => value && value !== userId)
          )
        );

        return {
          ok: true,
          notifiedLeaderIds
        };
      });

      if (!cancelResult || cancelResult.ok !== true) {
        return res.status(409).json({ ok: false, error: "Yêu cầu chờ duyệt không còn khả dụng để hủy." });
      }

      const notifiedLeaderIds = Array.isArray(cancelResult.notifiedLeaderIds) ? cancelResult.notifiedLeaderIds : [];
      notifiedLeaderIds.forEach((leaderUserId) => {
        publishNotificationStreamUpdate({ userId: leaderUserId, reason: "deleted" }).catch(() => null);
      });

      const pendingTeamName = (pendingRow.team_name || "nhóm dịch").toString().trim() || "nhóm dịch";
      const cancelMessage =
        pendingKind === "create"
          ? `Đã hủy yêu cầu tạo nhóm dịch ${pendingTeamName}.`
          : `Đã hủy yêu cầu tham gia ${pendingTeamName}.`;
      return res.json({
        ok: true,
        message: cancelMessage,
        pendingKind,
        team: {
          id: safePendingTeamId,
          name: pendingTeamName,
          slug: (pendingRow.team_slug || "").toString().trim()
        }
      });
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
    "/team/:teamId/:slug/media",
    uploadTeamMedia,
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
      const canonicalPath = buildTeamEditPath(managedTeam.team_id, managedTeam.team_slug || requestedSlug || "");

      const files = req.files && typeof req.files === "object" ? req.files : {};
      const avatarFile = Array.isArray(files.avatar) && files.avatar[0] && files.avatar[0].buffer ? files.avatar[0] : null;
      const coverFile = Array.isArray(files.cover) && files.cover[0] && files.cover[0].buffer ? files.cover[0] : null;

      if (!avatarFile && !coverFile) {
        setTeamPageFlash(req, managedTeam.team_id, {
          settingsStatus: "invalid",
          activeTab: "overview"
        });
        return res.redirect(canonicalPath);
      }

      const safeTeamId = Math.floor(Number(managedTeam.team_id) || 0);
      const stamp = Date.now();
      let avatarUrl = "";
      let coverUrl = "";

      try {
        if (avatarFile) {
          const avatarOutput = await sharp(avatarFile.buffer)
            .rotate()
            .resize({ width: 256, height: 256, fit: "cover" })
            .webp({ quality: 80, effort: 6 })
            .toBuffer();
          const avatarFileName = `team-${safeTeamId}-avatar.webp`;
          const avatarFilePath = path.join(avatarsDir, avatarFileName);
          avatarUrl = `/uploads/avatars/${avatarFileName}?v=${stamp}`;
          await fs.promises.writeFile(avatarFilePath, avatarOutput);
        }

        if (coverFile) {
          const coverOutput = await sharp(coverFile.buffer)
            .rotate()
            .resize({ width: 1500, height: 420, fit: "cover" })
            .webp({ quality: 82, effort: 6 })
            .toBuffer();
          const coverFileName = `team-${safeTeamId}-cover.webp`;
          const coverFilePath = path.join(coversDir, coverFileName);
          coverUrl = `/uploads/covers/${coverFileName}?v=${stamp}`;
          await fs.promises.writeFile(coverFilePath, coverOutput);
        }
      } catch (_err) {
        setTeamPageFlash(req, managedTeam.team_id, {
          settingsStatus: "invalid",
          activeTab: "overview"
        });
        return res.redirect(canonicalPath);
      }

      const setFields = [];
      const params = [];
      if (avatarUrl) {
        setFields.push("avatar_url = ?");
        params.push(avatarUrl);
      }
      if (coverUrl) {
        setFields.push("cover_url = ?");
        params.push(coverUrl);
      }
      setFields.push("updated_at = ?");
      params.push(stamp, safeTeamId);

      try {
        await dbRun(`UPDATE translation_teams SET ${setFields.join(", ")} WHERE id = ?`, params);
      } catch (_err) {
        setTeamPageFlash(req, managedTeam.team_id, {
          settingsStatus: "error",
          activeTab: "overview"
        });
        return res.redirect(canonicalPath);
      }

      const settingsStatus = avatarUrl && coverUrl ? "media_updated" : (avatarUrl ? "avatar_updated" : "cover_updated");
      setTeamPageFlash(req, managedTeam.team_id, {
        settingsStatus,
        activeTab: "overview"
      });
      return res.redirect(canonicalPath);
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
        msg.image_url as last_message_image_url,
        msg.created_at as last_message_created_at,
        msg.sender_user_id as last_message_sender_user_id
      FROM chat_thread_members self_member
      JOIN chat_threads t ON t.id = self_member.thread_id
      JOIN chat_thread_members other_member ON other_member.thread_id = t.id AND other_member.user_id <> self_member.user_id
      JOIN users other ON other.id = other_member.user_id
      LEFT JOIN LATERAL (
        SELECT id, content, image_url, created_at, sender_user_id
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
        .map((row) => {
          const safeImageUrl = readSafeUploadedImageUrl(row.last_message_image_url || "");
          const safeContent = (row.last_message_content || "").toString();
          const previewContent = safeContent.trim() || (safeImageUrl ? CHAT_IMAGE_PREVIEW_TEXT : "");
          return {
            id: Number(row.id),
            lastMessageAt: Number(row.last_message_created_at || row.last_message_at) || 0,
            lastMessageId: Number(row.last_message_id) || 0,
            lastMessageContent: previewContent,
            lastMessageImageUrl: safeImageUrl,
            lastMessageHasImage: Boolean(safeImageUrl),
            lastMessageSenderUserId: row.last_message_sender_user_id || "",
            otherUser: {
              id: row.other_user_id,
              username: row.other_username || "",
              displayName: (row.other_display_name || "").toString().trim(),
              avatarUrl: normalizeAvatarUrl(row.other_avatar_url || "")
            }
          };
        })
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
      const limitRaw = Number(req.query.limit);
      const defaultLimit = beforeId > 0 ? 25 : 10;
      const maxLimit = beforeId > 0 ? 25 : 10;
      const requestedLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : defaultLimit;
      const safeLimit = Math.max(1, Math.min(maxLimit, requestedLimit));

      const rows = await dbAll(
        `
        SELECT id, thread_id, sender_user_id, content, image_url, created_at
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

      const messages = pageRows
        .map((row) => ({
          id: Number(row.id),
          threadId: Number(row.thread_id),
          senderUserId: row.sender_user_id || "",
          content: (row.content || "").toString(),
          imageUrl: readSafeUploadedImageUrl(row.image_url || ""),
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
    "/messages/threads/:id/read",
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

      const safeThreadId = Math.floor(threadId);
      const memberRow = await dbGet(
        "SELECT 1 as ok FROM chat_thread_members WHERE thread_id = ? AND user_id = ? LIMIT 1",
        [safeThreadId, userId]
      );
      if (!memberRow) {
        return res.status(403).json({ ok: false, error: "Bạn không có quyền cập nhật đoạn chat này." });
      }

      const requestMessageIdRaw = Number(req.body && req.body.lastMessageId);
      const requestMessageId = Number.isFinite(requestMessageIdRaw) && requestMessageIdRaw > 0
        ? Math.floor(requestMessageIdRaw)
        : 0;

      let targetMessageId = 0;
      if (requestMessageId > 0) {
        const messageRow = await dbGet(
          "SELECT id FROM chat_messages WHERE id = ? AND thread_id = ? LIMIT 1",
          [requestMessageId, safeThreadId]
        );
        if (!messageRow || Number(messageRow.id) <= 0) {
          return res.status(400).json({ ok: false, error: "Tin nhắn tham chiếu không hợp lệ." });
        }
        targetMessageId = Math.floor(Number(messageRow.id));
      } else {
        const latestRow = await dbGet(
          "SELECT id FROM chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1",
          [safeThreadId]
        );
        targetMessageId = latestRow && Number(latestRow.id) > 0 ? Math.floor(Number(latestRow.id)) : 0;
      }

      if (targetMessageId > 0) {
        await dbRun(
          `
          UPDATE chat_thread_members
          SET last_read_message_id = ?
          WHERE thread_id = ? AND user_id = ?
            AND (last_read_message_id IS NULL OR last_read_message_id < ?)
        `,
          [targetMessageId, safeThreadId, userId, targetMessageId]
        );
      }

      return res.json({
        ok: true,
        threadId: safeThreadId,
        lastReadMessageId: targetMessageId
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
      const imageUrl = readSafeUploadedImageUrl(req.body && req.body.imageUrl ? req.body.imageUrl : "");

      if (!userId || !Number.isFinite(threadId) || threadId <= 0) {
        return res.status(400).json({ ok: false, error: "Yêu cầu không hợp lệ." });
      }
      if (imageUrl && !messageImageUploadsEnabled) {
        return res.status(400).json({ ok: false, error: "Tính năng gửi ảnh trong tin nhắn hiện đang tắt." });
      }
      if (!content && !imageUrl) {
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
            INSERT INTO chat_messages (thread_id, sender_user_id, content, image_url, client_request_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
            [Math.floor(threadId), userId, content, imageUrl || null, requestId || null, now]
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
            imageUrl,
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
            imageUrl,
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
            SELECT id, thread_id, sender_user_id, content, image_url, created_at
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
                imageUrl: readSafeUploadedImageUrl(duplicated.image_url || ""),
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
    if (raw === "notifications" || raw === "thong-bao") return "notifications";
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
    media_updated: { tone: "success", text: "Đã lưu thay đổi avatar và ảnh bìa nhóm dịch." },
    avatar_updated: { tone: "success", text: "Đã cập nhật avatar nhóm dịch." },
    cover_updated: { tone: "success", text: "Đã cập nhật ảnh bìa nhóm dịch." },
    forbidden: { tone: "error", text: "Bạn không có quyền chỉnh sửa nhóm dịch này." },
    invalid: { tone: "error", text: "Dữ liệu chỉnh sửa nhóm dịch không hợp lệ." },
    error: { tone: "error", text: "Không thể cập nhật nhóm dịch lúc này." }
  };

  const buildTeamCanonicalRedirectPath = (req, teamId, teamSlug) => {
    const canonicalPath = buildTeamPublicPath(teamId, teamSlug);
    if (!canonicalPath) return "";

    const originalUrl = req && typeof req.originalUrl === "string" ? req.originalUrl : "";
    const queryIndex = originalUrl.indexOf("?");
    if (queryIndex < 0) return canonicalPath;

    const queryText = originalUrl.slice(queryIndex);
    return queryText ? `${canonicalPath}${queryText}` : canonicalPath;
  };

  app.get(
    "/team/:id",
    asyncHandler(async (req, res) => {
      const teamId = Number(req.params.id);
      if (!Number.isFinite(teamId) || teamId <= 0) {
        return res.status(404).render("not-found", { title: "Không tìm thấy", team });
      }

      const teamRow = await dbGet(
        `
        SELECT id, slug
        FROM translation_teams
        WHERE id = ?
        LIMIT 1
      `,
        [Math.floor(teamId)]
      );
      if (!teamRow) {
        return res.status(404).render("not-found", { title: "Không tìm thấy", team });
      }

      const canonicalTarget = buildTeamCanonicalRedirectPath(req, teamRow.id, (teamRow.slug || "").toString().trim());
      if (!canonicalTarget) {
        return res.status(404).render("not-found", { title: "Không tìm thấy", team });
      }
      return res.redirect(301, canonicalTarget);
    })
  );

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
        const canonicalTarget = buildTeamCanonicalRedirectPath(req, teamRow.id, canonicalSlug);
        if (!canonicalTarget) {
          return res.status(404).render("not-found", { title: "Không tìm thấy", team });
        }
        return res.redirect(301, canonicalTarget);
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
      const canViewerSeeTeamNotifications = isViewerMember || isViewerAdminBadge;
      const requestedTabFromQuery = normalizeTeamPageTab(req.query && req.query.tab ? req.query.tab : "");

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
      const flashActiveTab = teamPageFlash && teamPageFlash.activeTab
        ? normalizeTeamPageTab(teamPageFlash.activeTab)
        : "";
      let activeTab = flashActiveTab || requestedTabFromQuery || "overview";
      if (activeTab === "notifications" && !canViewerSeeTeamNotifications) {
        activeTab = "overview";
      }
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

      const safeTeamId = Number.isFinite(Number(teamRow.id)) && Number(teamRow.id) > 0
        ? Math.floor(Number(teamRow.id))
        : 0;
      const buildTeamMangaScopeSql = (mangaAlias = "m") => {
        return buildMangaLinkedTeamExistsSql(mangaAlias);
      };
      const buildTeamMangaScopeParams = () => [safeTeamId];

      const teamSeriesStatsRow = safeTeamId
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
                WHERE m.is_hidden = 0
            AND ${buildTeamMangaScopeSql("m")}
        `,
          buildTeamMangaScopeParams()
        )
        : null;

      const teamCommentStatsRow = safeTeamId
        ? await dbGet(
          `
          SELECT COALESCE(SUM(comment_stats.comment_count), 0) AS comment_count
          FROM manga m
          LEFT JOIN (
            SELECT c.manga_id, COUNT(*) AS comment_count
            FROM comments c
            WHERE c.status = 'visible'
            GROUP BY c.manga_id
          ) comment_stats ON comment_stats.manga_id = m.id
          WHERE COALESCE(m.is_hidden, 0) = 0
            AND ${buildTeamMangaScopeSql("m")}
        `,
          buildTeamMangaScopeParams()
        )
        : null;

      const teamMangaRows = safeTeamId
        ? await dbAll(
          `
          ${listQueryBase}
          WHERE COALESCE(m.is_hidden, 0) = 0
            AND ${buildTeamMangaScopeSql("m")}
          ${listQueryOrder}
          LIMIT ?
        `,
          [...buildTeamMangaScopeParams(), TEAM_MANGA_PREVIEW_LIMIT + 1]
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

      const recentChapterRows = safeTeamId
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
            AND ${buildTeamMangaScopeSql("m")}
          ORDER BY c.id DESC
          LIMIT 6
        `,
          buildTeamMangaScopeParams()
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

      const requestedNotificationsPageRaw = Number(req.query && req.query.notificationsPage ? req.query.notificationsPage : 1);
      const requestedNotificationsPage = Number.isFinite(requestedNotificationsPageRaw) && requestedNotificationsPageRaw > 0
        ? Math.floor(requestedNotificationsPageRaw)
        : 1;

      const teamNotificationRows = canViewerSeeTeamNotifications && safeTeamId
        ? await dbAll(
          `
          SELECT
            c.id,
            c.content,
            c.created_at,
            c.chapter_number,
            c.author,
            c.author_user_id,
            u.username,
            u.display_name,
            u.avatar_url,
            m.slug AS manga_slug,
            m.title AS manga_title,
            COALESCE(ch.title, '') AS chapter_title,
            COALESCE(ch.is_oneshot, false) AS chapter_is_oneshot
          FROM comments c
          JOIN manga m ON m.id = c.manga_id
          LEFT JOIN users u ON u.id = c.author_user_id
          LEFT JOIN chapters ch ON ch.manga_id = c.manga_id AND ch.number = c.chapter_number
          WHERE c.status = 'visible'
            AND COALESCE(c.parent_id, 0) = 0
            AND COALESCE(m.is_hidden, 0) = 0
            AND ${buildTeamMangaScopeSql("m")}
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT ?
        `,
          [...buildTeamMangaScopeParams(), TEAM_NOTIFICATIONS_MAX_ITEMS]
        )
        : [];

      const teamNotifications = teamNotificationRows.map((row) => {
        const commentIdRaw = Number(row && row.id);
        const commentId = Number.isFinite(commentIdRaw) && commentIdRaw > 0 ? Math.floor(commentIdRaw) : 0;
        const mangaSlug = (row && row.manga_slug ? String(row.manga_slug) : "").trim();
        const mangaTitle = (row && row.manga_title ? String(row.manga_title) : "").trim() || "Truyện";
        const chapterRaw = row && row.chapter_number != null ? String(row.chapter_number).trim() : "";
        const chapterContext = buildCommentChapterContext({
          chapterNumber: chapterRaw || null,
          chapterTitle: row && row.chapter_title ? String(row.chapter_title) : "",
          chapterIsOneshot: row && row.chapter_is_oneshot
        });
        const chapterNumberText = chapterRaw ? formatChapterNumberValue(chapterRaw) : "";
        const basePath = mangaSlug
          ? (chapterNumberText
            ? `/manga/${encodeURIComponent(mangaSlug)}/chapters/${encodeURIComponent(chapterNumberText)}`
            : `/manga/${encodeURIComponent(mangaSlug)}`)
          : "";
        const commentUrl = basePath && commentId > 0
          ? `${basePath}#comment-${encodeURIComponent(String(commentId))}`
          : basePath;
        const contentText = stripHtmlTags(decodeBasicHtmlEntities(row && row.content ? String(row.content) : ""));
        const contentPreview = contentText.length > 200 ? `${contentText.slice(0, 197).trimEnd()}...` : contentText;
        const createdAtMs = parseTimeValueToMs(row && row.created_at != null ? row.created_at : 0);
        const actorDisplayName = (row && row.display_name ? String(row.display_name) : "").trim()
          || (row && row.author ? String(row.author) : "").trim()
          || (row && row.username ? `@${String(row.username).trim()}` : "")
          || "Thành viên";

        return {
          id: commentId,
          actorName: actorDisplayName,
          actorAvatarUrl: normalizeAvatarUrl(row && row.avatar_url ? row.avatar_url : ""),
          mangaTitle,
          chapterLabel: chapterContext.chapterLabel || "Bình luận tại trang truyện",
          preview: contentPreview || "(Bình luận trống)",
          commentUrl,
          createdAtMs,
          timeAgo: createdAtMs ? formatTimeAgo(createdAtMs) : ""
        };
      });

      const totalNotifications = teamNotifications.length;
      const notificationTotalPages = Math.max(1, Math.ceil(totalNotifications / TEAM_NOTIFICATIONS_PER_PAGE));
      const notificationsPage = Math.min(requestedNotificationsPage, notificationTotalPages);
      const notificationsOffset = (notificationsPage - 1) * TEAM_NOTIFICATIONS_PER_PAGE;
      const pagedTeamNotifications = teamNotifications.slice(
        notificationsOffset,
        notificationsOffset + TEAM_NOTIFICATIONS_PER_PAGE
      );

      const notificationVisiblePageNumbers = [];
      if (notificationTotalPages <= 6) {
        for (let index = 1; index <= notificationTotalPages; index += 1) {
          notificationVisiblePageNumbers.push(index);
        }
      } else if (notificationsPage <= 3) {
        notificationVisiblePageNumbers.push(1, 2, 3, 4, "...", notificationTotalPages);
      } else if (notificationsPage >= notificationTotalPages - 2) {
        notificationVisiblePageNumbers.push(
          1,
          "...",
          notificationTotalPages - 3,
          notificationTotalPages - 2,
          notificationTotalPages - 1,
          notificationTotalPages
        );
      } else {
        notificationVisiblePageNumbers.push(
          1,
          "...",
          notificationsPage - 1,
          notificationsPage,
          notificationsPage + 1,
          "...",
          notificationTotalPages
        );
      }

      const notificationsPagination = {
        page: notificationsPage,
        perPage: TEAM_NOTIFICATIONS_PER_PAGE,
        totalItems: totalNotifications,
        totalPages: notificationTotalPages,
        hasPrev: notificationsPage > 1,
        hasNext: notificationsPage < notificationTotalPages,
        prevPage: Math.max(1, notificationsPage - 1),
        nextPage: Math.min(notificationTotalPages, notificationsPage + 1),
        visiblePageNumbers: notificationVisiblePageNumbers
      };

      const totalMangaCount = teamSeriesStatsRow && teamSeriesStatsRow.manga_count != null
        ? Number(teamSeriesStatsRow.manga_count) || 0
        : 0;
      const totalChapterCount = teamSeriesStatsRow && teamSeriesStatsRow.chapter_count != null
        ? Number(teamSeriesStatsRow.chapter_count) || 0
        : 0;
      const totalCommentCount = teamCommentStatsRow && teamCommentStatsRow.comment_count != null
        ? Number(teamCommentStatsRow.comment_count) || 0
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
      const teamFacebookUrl = normalizeTeamFacebookUrl(teamRow.facebook_url || "");
      const teamDiscordUrl = normalizeTeamDiscordUrl(teamRow.discord_url || "");
      const teamCommunityDisplayNames = await resolveTeamCommunityDisplayNames({
        facebookUrl: teamFacebookUrl,
        discordUrl: teamDiscordUrl
      });
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
          teamFacebookUrl,
          teamDiscordUrl
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
          facebookUrl: teamFacebookUrl,
          discordUrl: teamDiscordUrl,
          facebookDisplayName: (teamCommunityDisplayNames.facebookDisplayName || "").toString().trim(),
          discordDisplayName: (teamCommunityDisplayNames.discordDisplayName || "").toString().trim(),
          status: teamRow.status || "pending",
          createdAt: createdAtMs,
          createdAtText,
          initials: buildTeamInitials(safeTeamName),
          memberCount,
          leaderCount,
          totalMangaCount,
          totalChapterCount,
          totalCommentCount,
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
          canViewNotifications: canViewerSeeTeamNotifications,
          activeTab,
          editSettingsUrl: canViewerManageTeam
            ? `/team/${encodeURIComponent(String(teamRow.id))}/${encodeURIComponent(canonicalSlug)}/settings`
            : "",
          editMediaUrl: canViewerManageTeam
            ? `/team/${encodeURIComponent(String(teamRow.id))}/${encodeURIComponent(canonicalSlug)}/media`
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
          notifications: pagedTeamNotifications,
          notificationsPagination,
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
        description: `Privacy Policy for ${SEO_SITE_NAME} web services and OAuth login.`,
        robots: SEO_ROBOTS_INDEX,
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
        description: `Terms of Service for using ${SEO_SITE_NAME} website and related features.`,
        robots: SEO_ROBOTS_INDEX,
        canonicalPath: "/terms-of-service"
      })
    });
  });

  app.get("/robots.txt", (req, res) => {
    const origin = getPublicOriginFromRequest(req);
    const sitemapUrl = origin ? `${origin}/sitemap.xml` : "/sitemap.xml";
    const newsSitemapUrl = origin ? `${origin}/tin-tuc/sitemap.xml` : "/tin-tuc/sitemap.xml";
    const llmsUrl = origin ? `${origin}/llms.txt` : "/llms.txt";
    const llmsFullUrl = origin ? `${origin}/llms-full.txt` : "/llms-full.txt";
    const newsPageEnabled = Boolean(req && req.app && req.app.locals && req.app.locals.isNewsPageEnabled);
    const disallowPaths = [
      "/admin",
      "/admin/",
      "/forum/admin",
      "/forum/admin/",
      "/account",
      "/auth/",
      "/publish",
      "/messages",
      "/user/"
    ];

    res.type("text/plain; charset=utf-8");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("CDN-Cache-Control", "no-store");
    res.set("Cloudflare-CDN-Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    return res.send(
      [
        "User-agent: *",
        "Allow: /",
        "Allow: /llms.txt",
        "Allow: /llms-full.txt",
        ...disallowPaths.map((pathValue) => `Disallow: ${pathValue}`),
        "",
        "User-agent: GPTBot",
        "User-agent: OAI-SearchBot",
        "User-agent: ChatGPT-User",
        "User-agent: ClaudeBot",
        "User-agent: Claude-User",
        "User-agent: Claude-SearchBot",
        "User-agent: Claude-Web",
        "User-agent: PerplexityBot",
        "User-agent: Google-Extended",
        "User-agent: Meta-ExternalAgent",
        "User-agent: CCBot",
        "Allow: /",
        "Allow: /llms.txt",
        "Allow: /llms-full.txt",
        ...disallowPaths.map((pathValue) => `Disallow: ${pathValue}`),
        "",
        `# LLM docs: ${llmsUrl}`,
        `# LLM full docs: ${llmsFullUrl}`,
        `Sitemap: ${sitemapUrl}`,
        ...(newsPageEnabled ? [`Sitemap: ${newsSitemapUrl}`] : [])
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
          loc: toAbsolutePublicUrl(req, "/llms.txt"),
          changefreq: "weekly",
          priority: "0.6"
        },
        {
          loc: toAbsolutePublicUrl(req, "/llms-full.txt"),
          changefreq: "weekly",
          priority: "0.5"
        },
        {
          loc: toAbsolutePublicUrl(req, "/privacy-policy"),
          changefreq: "monthly",
          priority: "0.3"
        },
        {
          loc: toAbsolutePublicUrl(req, "/terms-of-service"),
          changefreq: "monthly",
          priority: "0.3"
        }
      ];
      const newsPageEnabled = Boolean(req && req.app && req.app.locals && req.app.locals.isNewsPageEnabled);
      if (newsPageEnabled) {
        baseUrls.push({
          loc: toAbsolutePublicUrl(req, "/tin-tuc"),
          changefreq: "daily",
          priority: "0.8"
        });
      }
      if (isForumPageAvailable) {
        baseUrls.push({
          loc: toAbsolutePublicUrl(req, "/forum"),
          changefreq: "daily",
          priority: "0.8"
        });
      }

      const [mangaRows, chapterRows, teamRows, forumPostRows, forumSectionRows] = await Promise.all([
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
        ),
        isForumPageAvailable
          ? dbAll(
            `
              SELECT
                id,
                COALESCE(updated_at::text, created_at) AS updated_at
              FROM forum_posts
              WHERE status = 'visible'
                AND parent_id IS NULL
                AND COALESCE(client_request_id, '') ILIKE ?
              ORDER BY COALESCE(updated_at::text, created_at) DESC, id DESC
            `,
            ["forum-%"]
          )
          : Promise.resolve([]),
        isForumPageAvailable
          ? dbAll(
            `
              SELECT
                slug,
                COALESCE(updated_at::text, created_at::text, '') AS updated_at
              FROM forum_section_settings
              WHERE COALESCE(is_deleted, FALSE) = FALSE
                AND COALESCE(is_visible, TRUE) = TRUE
              ORDER BY slug ASC
            `
          ).catch(() => [])
          : Promise.resolve([])
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

      (forumPostRows || []).forEach((row) => {
        const postId = Number(row && row.id);
        if (!Number.isFinite(postId) || postId <= 0) return;

        urlEntries.push({
          loc: toAbsolutePublicUrl(req, `/forum/post/${encodeURIComponent(String(Math.floor(postId)))}`),
          lastmod: toIsoDate(row.updated_at),
          changefreq: "weekly",
          priority: "0.6"
        });
      });

      (forumSectionRows || []).forEach((row) => {
        const rawSlug = row && row.slug ? String(row.slug).trim().toLowerCase() : "";
        if (!rawSlug || !/^[a-z0-9-]+$/.test(rawSlug)) return;

        urlEntries.push({
          loc: toAbsolutePublicUrl(req, `/forum?section=${encodeURIComponent(rawSlug)}`),
          lastmod: toIsoDate(row.updated_at),
          changefreq: "weekly",
          priority: "0.7"
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

      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;

      const profileRow = await upsertUserProfileFromAuthUser(user);
      const profileUserId = profileRow && profileRow.id ? String(profileRow.id).trim() : "";
      const badgeContext = await getUserBadgeContext(profileRow && profileRow.id ? profileRow.id : "");
      let apiKeyMeta = {
        hasKey: false,
        keyPrefix: "",
        createdAt: 0,
        updatedAt: 0,
        lastUsedAt: 0
      };
      if (profileUserId) {
        try {
          apiKeyMeta = await getUserApiKeyMeta(profileUserId);
        } catch (err) {
          console.warn("Failed to load API key metadata", err);
        }
      }

      return res.json({
        ok: true,
        profile: {
          ...mapPublicUserRow(profileRow),
          apiKey: apiKeyMeta,
          badges: badgeContext.badges,
          userColor: badgeContext.userColor,
          permissions: badgeContext.permissions
        }
      });
    })
  );

  app.post(
    "/account/api-key/regenerate",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;

      if (req && req.authByApiKey) {
        return res.status(403).json({
          ok: false,
          error: "Vui lòng đăng nhập bằng tài khoản trên web để tạo API key mới."
        });
      }

      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      const generated = await rotateUserApiKey(userId);
      if (!generated || !generated.apiKey) {
        return res.status(500).json({ ok: false, error: "Không thể tạo API key mới." });
      }

      return res.json({
        ok: true,
        apiKey: generated.apiKey,
        meta: {
          hasKey: true,
          keyPrefix: generated.keyPrefix ? String(generated.keyPrefix).trim() : "",
          createdAt: Number(generated.createdAt) || Date.now(),
          updatedAt: Number(generated.updatedAt) || Date.now(),
          lastUsedAt: 0
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

  const BOOKMARK_LIST_NAME_MAX_LENGTH = 20;
  const BOOKMARK_LIST_MAX_PER_USER = 10;
  const BOOKMARK_FOLLOW_DEFAULT_NAME = "Theo dõi";

  const toBookmarkListNameSlug = (value) =>
    (value || "")
      .toString()
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);

  const normalizeBookmarkListNameInput = (value) =>
    (value || "")
      .toString()
      .replace(/\s+/g, " ")
      .trim();

  const buildBookmarkShareToken = () => crypto.randomBytes(10).toString("hex");

  const getBookmarkShareOriginFromRequest = (req) => {
    if (!req) return getPublicOriginFromRequest(req) || "";

    const canUseForwardedHeaders = Boolean(app.get("trust proxy"));
    const forwardedHost = canUseForwardedHeaders
      ? (req.get("x-forwarded-host") || "").toString().split(",")[0].trim()
      : "";
    const host = forwardedHost || (req.get("host") || "").toString().split(",")[0].trim();
    if (!host) return getPublicOriginFromRequest(req) || "";

    const forwardedProto = canUseForwardedHeaders
      ? (req.get("x-forwarded-proto") || "").toString().split(",")[0].trim()
      : "";
    const protocol = (forwardedProto || req.protocol || "http").toLowerCase() === "https" ? "https" : "http";
    return `${protocol}://${host}`;
  };

  const buildBookmarkPublicShareUrl = (req, shareToken) => {
    const token = (shareToken || "").toString().trim();
    if (!token) return "";
    return `${getBookmarkShareOriginFromRequest(req)}/account/saved/share/${encodeURIComponent(token)}`;
  };

  const ensureDefaultFollowBookmarkList = async ({ userId, dbGetFn = dbGet, dbRunFn = dbRun }) => {
    const safeUserId = (userId || "").toString().trim();
    if (!safeUserId) return null;

    const existing = await dbGetFn(
      `
        SELECT id, user_id, name, slug, is_public, is_default_follow, share_token, created_at, updated_at
        FROM manga_bookmark_lists
        WHERE user_id = ?
          AND is_default_follow = true
        LIMIT 1
      `,
      [safeUserId]
    );
    if (existing) return existing;

    const now = Date.now();
    let slug = "theo-doi";
    const slugConflict = await dbGetFn(
      "SELECT id FROM manga_bookmark_lists WHERE user_id = ? AND lower(slug) = lower(?) LIMIT 1",
      [safeUserId, slug]
    );
    if (slugConflict) {
      slug = await createUniqueBookmarkListSlug({
        userId: safeUserId,
        preferredName: BOOKMARK_FOLLOW_DEFAULT_NAME,
        dbGetFn
      });
    }

    try {
      await dbRunFn(
        `
          INSERT INTO manga_bookmark_lists (
            user_id,
            name,
            slug,
            is_public,
            is_default_follow,
            share_token,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, false, true, NULL, ?, ?)
        `,
        [safeUserId, BOOKMARK_FOLLOW_DEFAULT_NAME, slug, now, now]
      );
    } catch (_err) {
      const fallback = await dbGetFn(
        `
          SELECT id
          FROM manga_bookmark_lists
          WHERE user_id = ?
            AND (is_default_follow = true OR lower(name) = lower(?))
          ORDER BY is_default_follow DESC, updated_at DESC, id DESC
          LIMIT 1
        `,
        [safeUserId, BOOKMARK_FOLLOW_DEFAULT_NAME]
      );
      if (fallback && fallback.id) {
        await dbRunFn(
          "UPDATE manga_bookmark_lists SET is_default_follow = CASE WHEN id = ? THEN true ELSE false END WHERE user_id = ?",
          [fallback.id, safeUserId]
        );
      }
    }

    return dbGetFn(
      `
        SELECT id, user_id, name, slug, is_public, is_default_follow, share_token, created_at, updated_at
        FROM manga_bookmark_lists
        WHERE user_id = ?
          AND is_default_follow = true
        LIMIT 1
      `,
      [safeUserId]
    );
  };

  const createUniqueBookmarkListSlug = async ({ userId, preferredName, dbGetFn = dbGet }) => {
    const safeUserId = (userId || "").toString().trim();
    const base = toBookmarkListNameSlug(preferredName) || "list";
    let candidate = base;
    let suffix = 2;

    while (suffix < 200) {
      const row = await dbGetFn(
        "SELECT id FROM manga_bookmark_lists WHERE user_id = ? AND lower(slug) = lower(?) LIMIT 1",
        [safeUserId, candidate]
      );
      if (!row) return candidate;
      candidate = `${base}-${suffix}`.slice(0, 60);
      suffix += 1;
    }

    return `${base}-${Date.now()}`.slice(0, 60);
  };

  const mapBookmarkListRow = (row, req) => {
    const listId = row && row.id != null ? Number(row.id) : 0;
    const isPublic = toBooleanFlag(row && row.is_public);
    const shareToken = row && row.share_token ? String(row.share_token).trim() : "";
    return {
      id: Number.isFinite(listId) && listId > 0 ? Math.floor(listId) : 0,
      name: row && row.name ? String(row.name).trim() : "",
      slug: row && row.slug ? String(row.slug).trim() : "",
      isPublic,
      isDefaultFollow: toBooleanFlag(row && row.is_default_follow),
      shareToken: isPublic ? shareToken : "",
      shareUrl: isPublic ? buildBookmarkPublicShareUrl(req, shareToken) : "",
      itemCount: row && row.item_count != null ? Number(row.item_count) || 0 : 0,
      updatedAt: row && row.updated_at != null ? Number(row.updated_at) || 0 : 0
    };
  };

  const mapBookmarkMangaItem = (row) => {
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
  };

  const BOOKMARK_SORT_NEW = "new";
  const BOOKMARK_SORT_AZ = "az";
  const BOOKMARK_SORT_ZA = "za";
  const BOOKMARK_SEARCH_MIN_LENGTH = 2;
  const BOOKMARK_SEARCH_MAX_TOKENS = 4;
  const BOOKMARK_VI_COLLATION_CANDIDATES = [
    "vi-VN-x-icu",
    "vi-x-icu",
    "vi_VN.utf8",
    "vi_VN.UTF-8",
    "vi_VN",
    "Vietnamese_Vietnam.1258"
  ];
  const BOOKMARK_VI_TRANSLITERATE_SOURCE = "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ";
  const BOOKMARK_VI_TRANSLITERATE_TARGET = "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiioooooooooooooooooouuuuuuuuuuuyyyyyd";
  const BOOKMARK_VI_FALLBACK_SORT_KEY_SQL =
    `translate(LOWER(m.title), '${BOOKMARK_VI_TRANSLITERATE_SOURCE}', '${BOOKMARK_VI_TRANSLITERATE_TARGET}')`;
  let bookmarkViCollationPromise = null;

  const escapeSqlIdentifier = (value) => String(value == null ? "" : value).replace(/"/g, '""');

  const resolveBookmarkVietnameseCollation = async () => {
    if (!bookmarkViCollationPromise) {
      bookmarkViCollationPromise = (async () => {
        try {
          const rows = await dbAll(
            `
              SELECT collname, collprovider
              FROM pg_collation
              WHERE collname ILIKE 'vi%'
                OR collname ILIKE 'vietnamese%'
            `
          );
          const normalizedRows = (Array.isArray(rows) ? rows : [])
            .map((row) => ({
              collname: row && row.collname ? String(row.collname).trim() : "",
              collprovider: row && row.collprovider ? String(row.collprovider).trim() : ""
            }))
            .filter((row) => row.collname);

          if (!normalizedRows.length) return "";

          for (const candidate of BOOKMARK_VI_COLLATION_CANDIDATES) {
            const matched = normalizedRows.find(
              (row) => row.collname.toLowerCase() === candidate.toLowerCase()
            );
            if (matched && matched.collname) {
              return matched.collname;
            }
          }

          const icuRow = normalizedRows.find((row) => row.collprovider === "i");
          if (icuRow && icuRow.collname) return icuRow.collname;

          return normalizedRows[0].collname;
        } catch (error) {
          console.warn("Failed to detect Vietnamese collation for bookmark sorting", error);
          return "";
        }
      })();
    }

    try {
      return String(await bookmarkViCollationPromise);
    } catch (error) {
      bookmarkViCollationPromise = null;
      console.warn("Failed to resolve Vietnamese collation for bookmark sorting", error);
      return "";
    }
  };

  const resolveBookmarkSearchInput = (value) =>
    normalizeMangaSearchQuery(value, 80).toLowerCase();

  const resolveBookmarkSortOrder = (value) => {
    const sortValue = (value == null ? "" : String(value)).trim().toLowerCase();
    if (sortValue === BOOKMARK_SORT_ZA) return BOOKMARK_SORT_ZA;
    if (sortValue === BOOKMARK_SORT_AZ) return BOOKMARK_SORT_AZ;
    return BOOKMARK_SORT_NEW;
  };

  const resolveBookmarkSortSql = async (sortOrder) => {
    if (sortOrder === BOOKMARK_SORT_NEW) {
      return "COALESCE(m.updated_at, m.created_at) DESC, li.updated_at DESC, li.manga_id DESC";
    }

    const isDesc = sortOrder === BOOKMARK_SORT_ZA;
    const direction = isDesc ? "DESC" : "ASC";
    const vietnameseCollation = await resolveBookmarkVietnameseCollation();

    if (vietnameseCollation) {
      const safeCollation = escapeSqlIdentifier(vietnameseCollation);
      return `LOWER(m.title) COLLATE "${safeCollation}" ${direction}, li.manga_id ${direction}`;
    }

    return `${BOOKMARK_VI_FALLBACK_SORT_KEY_SQL} ${direction}, li.manga_id ${direction}`;
  };

  const resolveBookmarkSearchPlan = async (value) => {
    const searchInput = resolveBookmarkSearchInput(value);
    if (!searchInput) {
      return {
        searchInput: "",
        searchTerm: "",
        whereSql: "",
        params: [],
        isTooShort: false,
        minLength: BOOKMARK_SEARCH_MIN_LENGTH
      };
    }

    if (searchInput.length < BOOKMARK_SEARCH_MIN_LENGTH) {
      return {
        searchInput,
        searchTerm: "",
        whereSql: "",
        params: [],
        isTooShort: true,
        minLength: BOOKMARK_SEARCH_MIN_LENGTH
      };
    }

    const searchTerm = searchInput;

    const rawTokens = searchTerm
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean)
      .slice(0, BOOKMARK_SEARCH_MAX_TOKENS);

    if (!rawTokens.length) {
      return {
        searchInput,
        searchTerm: "",
        whereSql: "",
        params: [],
        isTooShort: false,
        minLength: BOOKMARK_SEARCH_MIN_LENGTH
      };
    }

    const longTokens = rawTokens.filter((token) => token.length >= 3);
    const tokens = (longTokens.length ? longTokens : rawTokens.slice(0, 1)).slice(0, BOOKMARK_SEARCH_MAX_TOKENS);
    const canUseTrigram = tokens.some((token) => token.length >= 3) ? await resolvePgTrgmEnabled() : false;

    const params = [];
    const clauses = [];

    tokens.forEach((token) => {
      const prefixPattern = `${token}%`;
      if (canUseTrigram && token.length >= 3) {
        clauses.push("(LOWER(m.title) LIKE ? OR m.title % ?)");
        params.push(prefixPattern, token);
        return;
      }

      if (token.length < 3) {
        clauses.push("LOWER(m.title) LIKE ?");
        params.push(prefixPattern);
        return;
      }

      clauses.push("(LOWER(m.title) LIKE ? OR LOWER(m.title) LIKE ? OR LOWER(m.title) LIKE ?)");
      params.push(prefixPattern, `% ${token}%`, `%-${token}%`);
    });

    return {
      searchInput,
      searchTerm,
      whereSql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "",
      params,
      isTooShort: false,
      minLength: BOOKMARK_SEARCH_MIN_LENGTH
    };
  };

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

      const defaultList = await ensureDefaultFollowBookmarkList({ userId });
      const defaultListId = defaultList && defaultList.id != null ? Number(defaultList.id) || 0 : 0;

      const listRows = await dbAll(
        `
          SELECT
            l.id,
            l.user_id,
            l.name,
            l.slug,
            l.is_public,
            l.is_default_follow,
            l.share_token,
            l.created_at,
            l.updated_at,
            COUNT(li.manga_id) as item_count
          FROM manga_bookmark_lists l
          LEFT JOIN manga_bookmark_list_items li ON li.list_id = l.id
          WHERE l.user_id = ?
          GROUP BY l.id
          ORDER BY l.is_default_follow DESC, l.updated_at DESC, l.id DESC
        `,
        [userId]
      );

      const lists = listRows.map((row) => mapBookmarkListRow(row, req));
      const requestedListId = Number(req.query.listId);
      const selectedListId = Number.isFinite(requestedListId) && requestedListId > 0
        ? Math.floor(requestedListId)
        : defaultListId || (lists[0] && lists[0].id ? lists[0].id : 0);
      const selectedList = lists.find((item) => item.id === selectedListId) || null;
      const searchPlan = await resolveBookmarkSearchPlan(req.query.search);
      const searchInput = searchPlan.searchInput;
      const sortOrder = resolveBookmarkSortOrder(req.query.sort);
      const sortSql = await resolveBookmarkSortSql(sortOrder);
      const searchClause = searchPlan.whereSql;
      const searchParams = searchPlan.params;

      if (!selectedList) {
        return res.json({
          ok: true,
          lists,
          selectedListId: 0,
          selectedList: null,
          items: [],
          pagination: resolvePaginationParams({
            pageInput: req.query.page,
            perPageInput: req.query.limit,
            defaultPerPage: BOOKMARKS_PER_PAGE,
            maxPerPage: BOOKMARKS_PER_PAGE,
            totalCount: 0
          }),
          query: {
            search: searchInput,
            sort: sortOrder,
            searchTooShort: false,
            minSearchLength: BOOKMARK_SEARCH_MIN_LENGTH
          },
          limits: {
            maxLists: BOOKMARK_LIST_MAX_PER_USER
          }
        });
      }

      if (searchPlan.isTooShort) {
        return res.json({
          ok: true,
          lists,
          selectedListId: selectedList.id,
          selectedList,
          items: [],
          pagination: resolvePaginationParams({
            pageInput: req.query.page,
            perPageInput: req.query.limit,
            defaultPerPage: BOOKMARKS_PER_PAGE,
            maxPerPage: BOOKMARKS_PER_PAGE,
            totalCount: 0
          }),
          query: {
            search: searchInput,
            sort: sortOrder,
            searchTooShort: true,
            minSearchLength: searchPlan.minLength
          },
          limits: {
            maxLists: BOOKMARK_LIST_MAX_PER_USER
          }
        });
      }

      const totalRow = await dbGet(
        `
          SELECT COUNT(*) as count
          FROM manga_bookmark_list_items li
          JOIN manga m ON m.id = li.manga_id
          WHERE li.list_id = ?
            AND COALESCE(m.is_hidden, 0) = 0
            ${searchClause}
        `,
        [selectedList.id, ...searchParams]
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
            li.list_id,
            li.manga_id,
            li.created_at,
            li.updated_at,
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
          FROM manga_bookmark_list_items li
          JOIN manga m ON m.id = li.manga_id
          LEFT JOIN LATERAL (
            SELECT number, COALESCE(is_oneshot, false) as is_oneshot
            FROM chapters c
            WHERE c.manga_id = m.id
            ORDER BY number DESC
            LIMIT 1
          ) latest ON true
          WHERE li.list_id = ?
            AND COALESCE(m.is_hidden, 0) = 0
            ${searchClause}
          ORDER BY ${sortSql}
          LIMIT ? OFFSET ?
        `,
        [selectedList.id, ...searchParams, pagination.perPage, pagination.offset]
      );

      return res.json({
        ok: true,
        lists,
        selectedListId: selectedList.id,
        selectedList,
        items: rows.map(mapBookmarkMangaItem),
        pagination,
        query: {
          search: searchInput,
          sort: sortOrder,
          searchTooShort: false,
          minSearchLength: BOOKMARK_SEARCH_MIN_LENGTH
        },
        limits: {
          maxLists: BOOKMARK_LIST_MAX_PER_USER
        }
      });
    })
  );

  app.get(
    "/account/bookmarks/state",
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

      const mangaSlug = (req.query && req.query.mangaSlug ? String(req.query.mangaSlug) : "").trim();
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

      const defaultList = await ensureDefaultFollowBookmarkList({ userId });
      const listRows = await dbAll(
        `
          SELECT
            l.id,
            l.name,
            l.slug,
            l.is_public,
            l.is_default_follow,
            l.share_token,
            l.updated_at,
            COUNT(li_all.manga_id) as item_count,
            MAX(CASE WHEN li_selected.manga_id IS NULL THEN 0 ELSE 1 END) as is_selected
          FROM manga_bookmark_lists l
          LEFT JOIN manga_bookmark_list_items li_all ON li_all.list_id = l.id
          LEFT JOIN manga_bookmark_list_items li_selected
            ON li_selected.list_id = l.id
           AND li_selected.manga_id = ?
          WHERE l.user_id = ?
          GROUP BY l.id
          ORDER BY l.is_default_follow DESC, l.updated_at DESC, l.id DESC
        `,
        [mangaRow.id, userId]
      );

      const lists = listRows.map((row) => ({
        ...mapBookmarkListRow(row, req),
        selected: Boolean(Number(row && row.is_selected) || 0)
      }));

      const bookmarked = lists.some((item) => item.selected);
      const defaultListId = defaultList && defaultList.id != null ? Number(defaultList.id) || 0 : 0;

      return res.json({
        ok: true,
        mangaId: Number(mangaRow.id) || 0,
        mangaSlug: String(mangaRow.slug || "").trim(),
        mangaTitle: String(mangaRow.title || "").trim(),
        bookmarked,
        defaultListId,
        lists,
        limits: {
          maxLists: BOOKMARK_LIST_MAX_PER_USER
        }
      });
    })
  );

  app.post(
    "/account/bookmarks/manage",
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
        console.warn("Failed to ensure user row for bookmark manage", err);
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

      const requestedListIds = Array.isArray(req.body && req.body.listIds)
        ? req.body.listIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0).map((value) => Math.floor(value))
        : [];

      const now = Date.now();
      const result = await withTransaction(async ({ dbGet: txGet, dbAll: txAll, dbRun: txRun }) => {
        const defaultList = await ensureDefaultFollowBookmarkList({ userId, dbGetFn: txGet, dbRunFn: txRun });
        const defaultListId = defaultList && defaultList.id != null ? Number(defaultList.id) || 0 : 0;

        const userListRows = await txAll(
          "SELECT id FROM manga_bookmark_lists WHERE user_id = ?",
          [userId]
        );
        const ownedListIds = new Set(
          userListRows
            .map((row) => Number(row && row.id))
            .filter((value) => Number.isFinite(value) && value > 0)
            .map((value) => Math.floor(value))
        );

        const targetListIds = Array.from(new Set(requestedListIds)).filter((id) => ownedListIds.has(id));

        await txRun(
          `
            DELETE FROM manga_bookmark_list_items
            WHERE manga_id = ?
              AND list_id IN (
                SELECT id FROM manga_bookmark_lists WHERE user_id = ?
              )
              ${targetListIds.length ? `AND list_id NOT IN (${targetListIds.map(() => "?").join(", ")})` : ""}
          `,
          targetListIds.length
            ? [mangaRow.id, userId, ...targetListIds]
            : [mangaRow.id, userId]
        );

        for (const listId of targetListIds) {
          await txRun(
            `
              INSERT INTO manga_bookmark_list_items (list_id, manga_id, created_at, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT (list_id, manga_id)
              DO UPDATE SET updated_at = EXCLUDED.updated_at
            `,
            [listId, mangaRow.id, now, now]
          );
        }

        const followEnabled = defaultListId > 0 && targetListIds.includes(defaultListId);
        if (followEnabled) {
          await txRun(
            `
              INSERT INTO manga_bookmarks (user_id, manga_id, created_at, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT (user_id, manga_id)
              DO UPDATE SET updated_at = EXCLUDED.updated_at
            `,
            [userId, mangaRow.id, now, now]
          );
        } else {
          await txRun("DELETE FROM manga_bookmarks WHERE user_id = ? AND manga_id = ?", [userId, mangaRow.id]);
        }

        return {
          defaultListId,
          followEnabled,
          selectedListIds: targetListIds,
          bookmarked: targetListIds.length > 0
        };
      });

      homepageCacheByAudience.clear();

      return res.json({
        ok: true,
        mangaId: Number(mangaRow.id) || 0,
        mangaSlug: String(mangaRow.slug || "").trim(),
        mangaTitle: String(mangaRow.title || "").trim(),
        defaultListId: Number(result && result.defaultListId) || 0,
        followEnabled: Boolean(result && result.followEnabled),
        bookmarked: Boolean(result && result.bookmarked),
        selectedListIds: Array.isArray(result && result.selectedListIds) ? result.selectedListIds : []
      });
    })
  );

  app.post(
    "/account/bookmarks/lists/create",
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

      const name = normalizeBookmarkListNameInput(req.body && req.body.name);
      if (!name) {
        return res.status(400).json({ ok: false, error: "Tên mục không hợp lệ." });
      }
      if (name.length > BOOKMARK_LIST_NAME_MAX_LENGTH) {
        return res.status(400).json({
          ok: false,
          error: `Tên mục tối đa ${BOOKMARK_LIST_NAME_MAX_LENGTH} ký tự.`
        });
      }
      const isPublic = toBooleanFlag(req.body && req.body.isPublic);

      const customCountRow = await dbGet(
        "SELECT COUNT(*) as count FROM manga_bookmark_lists WHERE user_id = ? AND is_default_follow = false",
        [userId]
      );
      const customCount = customCountRow && customCountRow.count != null ? Number(customCountRow.count) || 0 : 0;
      if (customCount >= BOOKMARK_LIST_MAX_PER_USER) {
        return res.status(400).json({ ok: false, error: `Bạn chỉ có thể tạo tối đa ${BOOKMARK_LIST_MAX_PER_USER} mục.` });
      }

      const duplicate = await dbGet(
        "SELECT id FROM manga_bookmark_lists WHERE user_id = ? AND lower(name) = lower(?) LIMIT 1",
        [userId, name]
      );
      if (duplicate) {
        return res.status(400).json({ ok: false, error: "Tên mục đã tồn tại." });
      }

      const slug = await createUniqueBookmarkListSlug({ userId, preferredName: name });
      const now = Date.now();
      const shareToken = isPublic ? buildBookmarkShareToken() : null;
      const inserted = await dbRun(
        `
          INSERT INTO manga_bookmark_lists (
            user_id,
            name,
            slug,
            is_public,
            is_default_follow,
            share_token,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, false, ?, ?, ?)
          RETURNING id
        `,
        [userId, name, slug, isPublic, shareToken, now, now]
      );
      const listId = inserted && Array.isArray(inserted.rows) && inserted.rows[0]
        ? Number(inserted.rows[0].id) || 0
        : 0;

      const created = await dbGet(
        `
          SELECT id, name, slug, is_public, is_default_follow, share_token, created_at, updated_at, 0 as item_count
          FROM manga_bookmark_lists
          WHERE id = ?
            AND user_id = ?
          LIMIT 1
        `,
        [listId, userId]
      );

      return res.json({
        ok: true,
        list: created ? mapBookmarkListRow(created, req) : null,
        limits: {
          maxLists: BOOKMARK_LIST_MAX_PER_USER
        }
      });
    })
  );

  app.post(
    "/account/bookmarks/lists/update",
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

      const listId = Number(req.body && req.body.listId);
      if (!Number.isFinite(listId) || listId <= 0) {
        return res.status(400).json({ ok: false, error: "Mục không hợp lệ." });
      }

      const listRow = await dbGet(
        `
          SELECT id, name, slug, is_public, is_default_follow, share_token
          FROM manga_bookmark_lists
          WHERE id = ?
            AND user_id = ?
          LIMIT 1
        `,
        [Math.floor(listId), userId]
      );
      if (!listRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy mục." });
      }

      if (toBooleanFlag(listRow.is_default_follow)) {
        return res.status(400).json({ ok: false, error: "Không thể chỉnh sửa mục Theo dõi mặc định." });
      }

      const name = normalizeBookmarkListNameInput(
        req.body && Object.prototype.hasOwnProperty.call(req.body, "name") ? req.body.name : listRow.name
      );
      if (!name) {
        return res.status(400).json({ ok: false, error: "Tên mục không hợp lệ." });
      }
      if (name.length > BOOKMARK_LIST_NAME_MAX_LENGTH) {
        return res.status(400).json({
          ok: false,
          error: `Tên mục tối đa ${BOOKMARK_LIST_NAME_MAX_LENGTH} ký tự.`
        });
      }

      const duplicate = await dbGet(
        "SELECT id FROM manga_bookmark_lists WHERE user_id = ? AND lower(name) = lower(?) AND id <> ? LIMIT 1",
        [userId, name, Math.floor(listId)]
      );
      if (duplicate) {
        return res.status(400).json({ ok: false, error: "Tên mục đã tồn tại." });
      }

      const isPublic = toBooleanFlag(
        req.body && Object.prototype.hasOwnProperty.call(req.body, "isPublic")
          ? req.body.isPublic
          : listRow.is_public
      );
      const now = Date.now();
      let shareToken = isPublic
        ? ((listRow.share_token || "").toString().trim() || buildBookmarkShareToken())
        : null;

      await dbRun(
        `
          UPDATE manga_bookmark_lists
          SET name = ?, is_public = ?, share_token = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `,
        [name, isPublic, shareToken, now, Math.floor(listId), userId]
      );

      const updated = await dbGet(
        `
          SELECT l.*, COUNT(li.manga_id) as item_count
          FROM manga_bookmark_lists l
          LEFT JOIN manga_bookmark_list_items li ON li.list_id = l.id
          WHERE l.id = ?
            AND l.user_id = ?
          GROUP BY l.id
          LIMIT 1
        `,
        [Math.floor(listId), userId]
      );

      return res.json({
        ok: true,
        list: updated ? mapBookmarkListRow(updated, req) : null
      });
    })
  );

  app.post(
    "/account/bookmarks/lists/delete",
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

      const listId = Number(req.body && req.body.listId);
      if (!Number.isFinite(listId) || listId <= 0) {
        return res.status(400).json({ ok: false, error: "Mục không hợp lệ." });
      }

      const listRow = await dbGet(
        "SELECT id, is_default_follow FROM manga_bookmark_lists WHERE id = ? AND user_id = ? LIMIT 1",
        [Math.floor(listId), userId]
      );
      if (!listRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy mục." });
      }
      if (toBooleanFlag(listRow.is_default_follow)) {
        return res.status(400).json({ ok: false, error: "Không thể xóa mục Theo dõi mặc định." });
      }

      await dbRun("DELETE FROM manga_bookmark_lists WHERE id = ? AND user_id = ?", [Math.floor(listId), userId]);

      return res.json({
        ok: true,
        deletedListId: Math.floor(listId)
      });
    })
  );

  app.get(
    "/account/bookmarks/public/:shareToken",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const shareToken = (req.params && req.params.shareToken ? String(req.params.shareToken) : "").trim();
      if (!shareToken) {
        return res.status(400).json({ ok: false, error: "Liên kết chia sẻ không hợp lệ." });
      }

      const listRow = await dbGet(
        `
          SELECT
            l.id,
            l.name,
            l.slug,
            l.is_public,
            l.is_default_follow,
            l.share_token,
            l.created_at,
            l.updated_at,
            u.username,
            u.display_name
          FROM manga_bookmark_lists l
          LEFT JOIN users u ON u.id = l.user_id
          WHERE l.share_token = ?
            AND l.is_public = true
          LIMIT 1
        `,
        [shareToken]
      );
      if (!listRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy danh sách công khai." });
      }

      const searchPlan = await resolveBookmarkSearchPlan(req.query.search);
      const searchInput = searchPlan.searchInput;
      const sortOrder = resolveBookmarkSortOrder(req.query.sort);
      const sortSql = await resolveBookmarkSortSql(sortOrder);
      const searchClause = searchPlan.whereSql;
      const searchParams = searchPlan.params;

      if (searchPlan.isTooShort) {
        return res.json({
          ok: true,
          list: {
            ...mapBookmarkListRow({ ...listRow, item_count: 0 }, req),
            ownerName: (listRow.display_name || listRow.username || "người dùng").toString().trim()
          },
          items: [],
          pagination: resolvePaginationParams({
            pageInput: req.query.page,
            perPageInput: req.query.limit,
            defaultPerPage: BOOKMARKS_PER_PAGE,
            maxPerPage: BOOKMARKS_PER_PAGE,
            totalCount: 0
          }),
          query: {
            search: searchInput,
            sort: sortOrder,
            searchTooShort: true,
            minSearchLength: searchPlan.minLength
          }
        });
      }

      const totalRow = await dbGet(
        `
          SELECT COUNT(*) as count
          FROM manga_bookmark_list_items li
          JOIN manga m ON m.id = li.manga_id
          WHERE li.list_id = ?
            AND COALESCE(m.is_hidden, 0) = 0
            ${searchClause}
        `,
        [listRow.id, ...searchParams]
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
            li.list_id,
            li.manga_id,
            li.created_at,
            li.updated_at,
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
          FROM manga_bookmark_list_items li
          JOIN manga m ON m.id = li.manga_id
          LEFT JOIN LATERAL (
            SELECT number, COALESCE(is_oneshot, false) as is_oneshot
            FROM chapters c
            WHERE c.manga_id = m.id
            ORDER BY number DESC
            LIMIT 1
          ) latest ON true
          WHERE li.list_id = ?
            AND COALESCE(m.is_hidden, 0) = 0
            ${searchClause}
          ORDER BY ${sortSql}
          LIMIT ? OFFSET ?
        `,
        [listRow.id, ...searchParams, pagination.perPage, pagination.offset]
      );

      return res.json({
        ok: true,
        list: {
          ...mapBookmarkListRow({ ...listRow, item_count: totalCount }, req),
          ownerName: (listRow.display_name || listRow.username || "người dùng").toString().trim()
        },
        items: rows.map(mapBookmarkMangaItem),
        pagination,
        query: {
          search: searchInput,
          sort: sortOrder,
          searchTooShort: false,
          minSearchLength: BOOKMARK_SEARCH_MIN_LENGTH
        }
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

      const now = Date.now();
      const result = await withTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
        const defaultList = await ensureDefaultFollowBookmarkList({ userId, dbGetFn: txGet, dbRunFn: txRun });
        const defaultListId = defaultList && defaultList.id != null ? Number(defaultList.id) || 0 : 0;
        if (!defaultListId) {
          return { bookmarked: false, defaultListId: 0 };
        }

        const existing = await txGet(
          "SELECT 1 as ok FROM manga_bookmark_list_items WHERE list_id = ? AND manga_id = ? LIMIT 1",
          [defaultListId, mangaRow.id]
        );

        if (existing && existing.ok) {
          await txRun("DELETE FROM manga_bookmark_list_items WHERE list_id = ? AND manga_id = ?", [defaultListId, mangaRow.id]);
          await txRun("DELETE FROM manga_bookmarks WHERE user_id = ? AND manga_id = ?", [userId, mangaRow.id]);
          return { bookmarked: false, defaultListId };
        }

        await txRun(
          `
            INSERT INTO manga_bookmark_list_items (list_id, manga_id, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (list_id, manga_id)
            DO UPDATE SET updated_at = EXCLUDED.updated_at
          `,
          [defaultListId, mangaRow.id, now, now]
        );
        await txRun(
          `
            INSERT INTO manga_bookmarks (user_id, manga_id, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (user_id, manga_id)
            DO UPDATE SET updated_at = EXCLUDED.updated_at
          `,
          [userId, mangaRow.id, now, now]
        );

        return { bookmarked: true, defaultListId };
      });

      return res.json({
        ok: true,
        bookmarked: Boolean(result && result.bookmarked),
        defaultListId: Number(result && result.defaultListId) || 0,
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

      const mangaIdRaw = Number(req.body && req.body.mangaId);
      const mangaSlugRaw = (req.body && req.body.mangaSlug ? String(req.body.mangaSlug) : "").trim();
      const listIdRaw = Number(req.body && req.body.listId);

      let mangaId = Number.isFinite(mangaIdRaw) && mangaIdRaw > 0 ? Math.floor(mangaIdRaw) : 0;
      if (!mangaId && mangaSlugRaw) {
        const mangaRow = await dbGet("SELECT id FROM manga WHERE slug = ? LIMIT 1", [mangaSlugRaw]);
        mangaId = mangaRow && mangaRow.id ? Number(mangaRow.id) || 0 : 0;
      }
      if (!mangaId) {
        return res.status(400).json({ ok: false, error: "Thiếu truyện cần gỡ bookmark." });
      }

      const result = await withTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
        const defaultList = await ensureDefaultFollowBookmarkList({ userId, dbGetFn: txGet, dbRunFn: txRun });
        const defaultListId = defaultList && defaultList.id != null ? Number(defaultList.id) || 0 : 0;

        if (Number.isFinite(listIdRaw) && listIdRaw > 0) {
          const safeListId = Math.floor(listIdRaw);
          const removed = await txRun(
            `
              DELETE FROM manga_bookmark_list_items
              WHERE list_id = ?
                AND manga_id = ?
                AND EXISTS (
                  SELECT 1 FROM manga_bookmark_lists l WHERE l.id = ? AND l.user_id = ?
                )
            `,
            [safeListId, mangaId, safeListId, userId]
          );
          if (defaultListId && safeListId === defaultListId) {
            await txRun("DELETE FROM manga_bookmarks WHERE user_id = ? AND manga_id = ?", [userId, mangaId]);
          }
          const remainRow = await txGet(
            `
              SELECT 1 as ok
              FROM manga_bookmark_list_items li
              JOIN manga_bookmark_lists l ON l.id = li.list_id
              WHERE l.user_id = ?
                AND li.manga_id = ?
              LIMIT 1
            `,
            [userId, mangaId]
          );
          return {
            removed: Boolean(removed && removed.changes),
            removedFromAll: false,
            listId: safeListId,
            mangaId,
            bookmarked: Boolean(remainRow && remainRow.ok)
          };
        }

        await txRun(
          `
            DELETE FROM manga_bookmark_list_items
            WHERE manga_id = ?
              AND list_id IN (SELECT id FROM manga_bookmark_lists WHERE user_id = ?)
          `,
          [mangaId, userId]
        );
        await txRun("DELETE FROM manga_bookmarks WHERE user_id = ? AND manga_id = ?", [userId, mangaId]);

        return {
          removed: true,
          removedFromAll: true,
          listId: 0,
          mangaId,
          bookmarked: false
        };
      });

      return res.json({
        ok: true,
        removed: Boolean(result && result.removed),
        removedFromAll: Boolean(result && result.removedFromAll),
        listId: Number(result && result.listId) || 0,
        mangaId: Number(result && result.mangaId) || 0,
        bookmarked: Boolean(result && result.bookmarked)
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

  const isHomepageRefreshRequest = (req) => {
    const headerValue = req && req.get ? req.get("X-BFANG-Homepage-Refresh") : "";
    const queryValue = req && req.query ? req.query.homepage_refresh : "";
    return String(headerValue || "").trim() === "1" || String(queryValue || "").trim() === "1";
  };

  const shouldForceFreshHomepagePayload = (req) => {
    const headerValue = req && req.get ? req.get("X-BFANG-Force-Homepage-Refresh") : "";
    const queryValue = req && req.query ? req.query.force_homepage_refresh : "";
    return String(headerValue || "").trim() === "1" || String(queryValue || "").trim() === "1";
  };

  const buildHomepageFreshnessToken = (row) => {
    const homepageUpdatedAt = row && row.homepage_updated_at ? String(row.homepage_updated_at).trim() : "";
    const latestMangaUpdatedAt = row && row.latest_manga_updated_at ? String(row.latest_manga_updated_at).trim() : "";
    const latestChapterId = row && row.latest_chapter_id != null ? String(row.latest_chapter_id).trim() : "";
    return `${homepageUpdatedAt}::${latestMangaUpdatedAt}::${latestChapterId}`;
  };

  const readHomepageFreshnessToken = async () => {
    const row = await dbGet(
      `
        SELECT
          COALESCE(
            (
              SELECT h.updated_at
              FROM homepage h
              WHERE h.id = 1
            ),
            ''
          ) AS homepage_updated_at,
          COALESCE(
            (
              SELECT m.updated_at
              FROM manga m
              WHERE m.is_hidden = 0
                AND ${MANGA_HAS_CHAPTER_SQL}
              ORDER BY m.updated_at DESC, m.id DESC
              LIMIT 1
            ),
            ''
          ) AS latest_manga_updated_at,
          COALESCE(
            (
              SELECT c.id::text
              FROM chapters c
              JOIN manga m ON m.id = c.manga_id
              WHERE m.is_hidden = 0
              ORDER BY c.id DESC
              LIMIT 1
            ),
            ''
          ) AS latest_chapter_id
      `
    );
    return buildHomepageFreshnessToken(row);
  };

  const buildHomepagePayloadSignature = (homepagePayload) => {
    const safePayload = homepagePayload && typeof homepagePayload === "object"
      ? {
        ...homepagePayload,
        latestForumPosts: Array.isArray(homepagePayload.latestForumPosts)
          ? homepagePayload.latestForumPosts.map((post) => {
            const safePost = post && typeof post === "object" ? { ...post } : {};
            delete safePost.timeAgo;
            return safePost;
          })
          : [],
        recentComments: Array.isArray(homepagePayload.recentComments)
          ? homepagePayload.recentComments.map((comment) => {
            const safeComment = comment && typeof comment === "object" ? { ...comment } : {};
            delete safeComment.timeAgo;
            return safeComment;
          })
          : []
      }
      : {};
    return crypto.createHash("sha256").update(JSON.stringify(safePayload)).digest("hex");
  };

  const buildHomepageAvatarFallback = (value) => {
    const text = (value || "").toString().trim();
    if (!text) return "TV";

    const normalized = text.replace(/^@+/, "");
    if (!normalized) return "TV";

    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const first = parts[0].charAt(0);
      const last = parts[parts.length - 1].charAt(0);
      return `${first}${last}`.toUpperCase();
    }

    return normalized.slice(0, 2).toUpperCase();
  };

  const buildHomepageRankingSinceDate = (daysWindow) => {
    const safeDays = Number.isFinite(Number(daysWindow))
      ? Math.max(1, Math.floor(Number(daysWindow)))
      : 0;
    if (!safeDays) return "";

    const todayDate = toViewStatsDateString(Date.now());
    if (!todayDate) return "";
    if (safeDays <= 1) return todayDate;
    return shiftViewStatsDateByDays(todayDate, -(safeDays - 1));
  };

  const resolveHomepageTopRankingByPeriod = async ({ includeAdult, daysWindow }) => {
    const adultVisibilityClause = includeAdult ? "" : ` AND NOT (${MANGA_HAS_ADULT_GENRE_SQL})`;
    const safeDaysWindow = Number.isFinite(Number(daysWindow))
      ? Math.max(0, Math.floor(Number(daysWindow)))
      : 0;
    const sinceDate = buildHomepageRankingSinceDate(safeDaysWindow);

    const rankingBaseCacheKey = buildHomepageRankingEndpointCacheKey({
      includeAdult,
      daysWindow: safeDaysWindow
    });
    const rankingEndpointCache = await readEndpointCache(rankingBaseCacheKey);
    const rankingEndpointCacheKey = rankingEndpointCache.key;
    const cachedRankingPayload = rankingEndpointCache.value;
    if (cachedRankingPayload && Array.isArray(cachedRankingPayload.items)) {
      return cachedRankingPayload.items;
    }

    const rankingInFlightKey = rankingBaseCacheKey || `homepage-ranking:${includeAdult ? "include" : "exclude"}:${safeDaysWindow}`;
    const inFlightRankingRefresh = homepageRankingRefreshInFlight.get(rankingInFlightKey);
    if (inFlightRankingRefresh) {
      return inFlightRankingRefresh;
    }

    const rankingRefreshPromise = (async () => {
      let rankingRows = [];
      if (safeDaysWindow > 0 && sinceDate) {
        rankingRows = await dbAll(
          `
            WITH period_totals AS (
              SELECT
                stats.manga_id,
                SUM(GREATEST(COALESCE(stats.view_count, 0), 0))::bigint AS period_views
              FROM manga_view_daily_stats stats
              WHERE stats.view_date >= ?
              GROUP BY stats.manga_id
            ),
            chapter_totals AS (
              SELECT
                c.manga_id,
                SUM(GREATEST(COALESCE(v.view_count, 0), 0))::bigint AS chapter_total_views
              FROM chapters c
              LEFT JOIN chapter_view_stats v ON v.chapter_id = c.id
              WHERE c.manga_id IN (SELECT p.manga_id FROM period_totals p)
              GROUP BY c.manga_id
            )
            SELECT
              m.id AS manga_id,
              LEAST(
                COALESCE(period_totals.period_views, 0),
                COALESCE(chapter_totals.chapter_total_views, 0)
              )::bigint AS manga_views
            FROM manga m
            LEFT JOIN period_totals ON period_totals.manga_id = m.id
            LEFT JOIN chapter_totals ON chapter_totals.manga_id = m.id
            WHERE m.is_hidden = 0
              AND ${MANGA_HAS_CHAPTER_SQL}
              ${adultVisibilityClause}
              AND COALESCE(period_totals.period_views, 0) > 0
            ORDER BY LEAST(
              COALESCE(period_totals.period_views, 0),
              COALESCE(chapter_totals.chapter_total_views, 0)
            ) DESC, m.id DESC
            LIMIT ?
          `,
          [sinceDate, HOMEPAGE_RANKING_LIMIT]
        );
      } else {
        rankingRows = await dbAll(
          `
            WITH chapter_totals AS (
              SELECT
                c.manga_id,
                SUM(GREATEST(COALESCE(v.view_count, 0), 0))::bigint AS chapter_total_views
              FROM chapters c
              LEFT JOIN chapter_view_stats v ON v.chapter_id = c.id
              GROUP BY c.manga_id
            )
            SELECT
              m.id AS manga_id,
              COALESCE(chapter_totals.chapter_total_views, 0)::bigint AS manga_views
            FROM manga m
            LEFT JOIN chapter_totals ON chapter_totals.manga_id = m.id
            WHERE m.is_hidden = 0
              AND ${MANGA_HAS_CHAPTER_SQL}
              ${adultVisibilityClause}
            ORDER BY COALESCE(chapter_totals.chapter_total_views, 0) DESC, m.id DESC
            LIMIT ?
          `,
          [HOMEPAGE_RANKING_LIMIT]
        );
      }

      const rankingMangaIds = rankingRows
        .map((row) => Number(row && row.manga_id))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value));
      const rankedItems = [];
      if (rankingMangaIds.length) {
        const placeholders = rankingMangaIds.map(() => "?").join(",");
        const rankingMangaRows = await dbAll(
          `${listQueryBase} WHERE m.id IN (${placeholders}) AND m.is_hidden = 0 AND ${MANGA_HAS_CHAPTER_SQL}${adultVisibilityClause}`,
          rankingMangaIds
        );
        const mangaRowById = new Map(
          rankingMangaRows.map((row) => [Number(row && row.id) || 0, row])
        );

        const resolvedRankedItems = rankingRows
          .map((rankingRow, index) => {
            const mangaId = Number(rankingRow && rankingRow.manga_id);
            if (!Number.isFinite(mangaId) || mangaId <= 0) return null;
            const mangaRow = mangaRowById.get(Math.floor(mangaId));
            if (!mangaRow) return null;

            const mapped = mapMangaListRow(mangaRow);
            const totalViews = Number(rankingRow && rankingRow.manga_views) || 0;
            return {
              ...mapped,
              rank: index + 1,
              totalViews,
              total_views: totalViews,
              isAdult: shouldExposeAdultMarker(mangaRow)
            };
          })
          .filter(Boolean);

        rankedItems.push(...resolvedRankedItems);
      }

      if (rankedItems.length < HOMEPAGE_RANKING_LIMIT) {
        const seenMangaIds = new Set(
          rankedItems
            .map((item) => Number(item && item.id))
            .filter((value) => Number.isFinite(value) && value > 0)
            .map((value) => Math.floor(value))
        );

        const fallbackRows = await dbAll(
          `${listQueryBase} WHERE m.is_hidden = 0 AND ${MANGA_HAS_CHAPTER_SQL}${adultVisibilityClause} ${listQueryOrder} LIMIT ${Math.max(HOMEPAGE_LATEST_LIMIT * 3, HOMEPAGE_RANKING_LIMIT * 6)}`
        );

        fallbackRows.forEach((row) => {
          if (rankedItems.length >= HOMEPAGE_RANKING_LIMIT) return;
          const mapped = mapMangaListRow(row);
          const mappedId = Number(mapped && mapped.id);
          if (!Number.isFinite(mappedId) || mappedId <= 0) return;
          const safeMappedId = Math.floor(mappedId);
          if (seenMangaIds.has(safeMappedId)) return;

          const chapterCount = Number(mapped && mapped.chapterCount) || 0;
          if (!Number.isFinite(chapterCount) || chapterCount <= 1) return;

          seenMangaIds.add(safeMappedId);
          const fallbackViews = Number(mapped && mapped.totalViews) || 0;
          rankedItems.push({
            ...mapped,
            totalViews: fallbackViews,
            total_views: fallbackViews,
            isAdult: shouldExposeAdultMarker(row)
          });
        });
      }

      const finalRankedItems = rankedItems
        .slice(0, HOMEPAGE_RANKING_LIMIT)
        .map((item, index) => ({
          ...item,
          rank: index + 1
        }));

      await writeEndpointCache(
        rankingEndpointCacheKey || rankingBaseCacheKey,
        { items: finalRankedItems },
        ENDPOINT_CACHE_HOMEPAGE_RANKING_TTL_SECONDS
      );

      return finalRankedItems;
    })();

    homepageRankingRefreshInFlight.set(rankingInFlightKey, rankingRefreshPromise);
    try {
      return await rankingRefreshPromise;
    } finally {
      if (homepageRankingRefreshInFlight.get(rankingInFlightKey) === rankingRefreshPromise) {
        homepageRankingRefreshInFlight.delete(rankingInFlightKey);
      }
    }
  };

  const resolveBookmarkUserCountByMangaId = async (mangaIds) => {
    const safeMangaIds = Array.from(
      new Set(
        (Array.isArray(mangaIds) ? mangaIds : [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))
      )
    );

    if (!safeMangaIds.length) {
      return new Map();
    }

    const placeholders = safeMangaIds.map(() => "?").join(",");
    const rows = await dbAll(
      `
        SELECT
          source.manga_id,
          COUNT(DISTINCT source.user_id)::bigint AS bookmark_user_count
        FROM (
          SELECT
            mb.manga_id,
            mb.user_id
          FROM manga_bookmarks mb
          WHERE mb.manga_id IN (${placeholders})

          UNION ALL

          SELECT
            li.manga_id,
            l.user_id
          FROM manga_bookmark_list_items li
          JOIN manga_bookmark_lists l ON l.id = li.list_id
          WHERE li.manga_id IN (${placeholders})
        ) source
        WHERE source.user_id IS NOT NULL
          AND TRIM(source.user_id) <> ''
        GROUP BY source.manga_id
      `,
      [...safeMangaIds, ...safeMangaIds]
    );

    const countByMangaId = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const mangaId = Number(row && row.manga_id);
      if (!Number.isFinite(mangaId) || mangaId <= 0) return;
      const bookmarkUserCount = Number(row && row.bookmark_user_count);
      countByMangaId.set(
        Math.floor(mangaId),
        Number.isFinite(bookmarkUserCount) && bookmarkUserCount > 0 ? Math.floor(bookmarkUserCount) : 0
      );
    });

    return countByMangaId;
  };

  const applyBookmarkCountToMangaList = (mangaList, bookmarkCountByMangaId) => {
    const safeList = Array.isArray(mangaList) ? mangaList : [];
    const safeCountByMangaId = bookmarkCountByMangaId instanceof Map ? bookmarkCountByMangaId : new Map();

    return safeList.map((item) => {
      if (!item || typeof item !== "object") return item;
      const mangaId = Number(item.id);
      const bookmarkCount = Number.isFinite(mangaId)
        ? Number(safeCountByMangaId.get(Math.floor(mangaId))) || 0
        : 0;
      return {
        ...item,
        bookmarkCount,
        bookmark_count: bookmarkCount
      };
    });
  };

  const refreshHomepageBookmarkCounts = async (homepagePayload) => {
    if (!homepagePayload || typeof homepagePayload !== "object") {
      return homepagePayload;
    }

    const featuredList = Array.isArray(homepagePayload.featured) ? homepagePayload.featured : [];
    const latestList = Array.isArray(homepagePayload.latest) ? homepagePayload.latest : [];
    const mangaIds = Array.from(
      new Set(
        featuredList
          .concat(latestList)
          .map((item) => Number(item && item.id))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))
      )
    );

    if (!mangaIds.length) {
      return homepagePayload;
    }

    const bookmarkCountByMangaId = await resolveBookmarkUserCountByMangaId(mangaIds);
    homepagePayload.featured = applyBookmarkCountToMangaList(featuredList, bookmarkCountByMangaId);
    homepagePayload.latest = applyBookmarkCountToMangaList(latestList, bookmarkCountByMangaId);
    return homepagePayload;
  };

  const resolveHomepagePayload = async (options = {}) => {
    const forceFresh = Boolean(options && options.forceFresh);
    const includeAdult = Boolean(options && options.includeAdult);
    const audienceKey = buildHomepageAudienceCacheKey(includeAdult);
    const now = Date.now();
    let cachedState = homepageCacheByAudience.get(audienceKey);
    let homepagePayload = cachedState && cachedState.payload ? cachedState.payload : null;
    let homepageEndpointCacheKey = "";

    if (forceFresh) {
      homepagePayload = null;
    }

    if (!forceFresh && !homepagePayload) {
      const homepageCacheKey = buildHomepageEndpointCacheKey({ includeAdult });
      const homepageRedisCache = await readEndpointCache(homepageCacheKey);
      homepageEndpointCacheKey = homepageRedisCache.key;
      const cachedRedisState = homepageRedisCache.value;
      if (cachedRedisState && cachedRedisState.payload && typeof cachedRedisState.payload === "object") {
        homepagePayload = cachedRedisState.payload;
        homepageCacheByAudience.set(audienceKey, {
          payload: homepagePayload,
          expiresAt: now + HOMEPAGE_CACHE_TTL_MS,
          updatedAt: cachedRedisState.updatedAt ? String(cachedRedisState.updatedAt).trim() : "",
          freshnessToken: cachedRedisState.freshnessToken ? String(cachedRedisState.freshnessToken).trim() : "",
          metaProbeAt: now + HOMEPAGE_META_PROBE_INTERVAL_MS
        });
        cachedState = homepageCacheByAudience.get(audienceKey);
      }
    }

    if (homepagePayload && cachedState && cachedState.expiresAt > now) {
      const nextMetaProbeAt = Number(cachedState.metaProbeAt) || 0;
      if (nextMetaProbeAt <= now) {
        const latestFreshnessToken = await readHomepageFreshnessToken();
        cachedState.metaProbeAt = now + HOMEPAGE_META_PROBE_INTERVAL_MS;
        if (latestFreshnessToken !== (cachedState.freshnessToken || "")) {
          homepagePayload = null;
        }
      }
    }

    if (!homepagePayload || !cachedState || cachedState.expiresAt <= now) {
      const inFlightRefresh = homepageCacheRefreshInFlightByAudience.get(audienceKey);
      if (inFlightRefresh) {
        homepagePayload = await inFlightRefresh;
      } else {
        const refreshPromise = (async () => {
          const homepageRow = await dbGet("SELECT * FROM homepage WHERE id = 1");
          const homepageData = normalizeHomepageRow(homepageRow);
          const notices = buildHomepageNotices(homepageData);
          const featuredIds = homepageData.featuredIds.slice(0, 4);
          const adultVisibilityClause = includeAdult ? "" : ` AND NOT (${MANGA_HAS_ADULT_GENRE_SQL})`;
          let featuredRows = [];

          if (featuredIds.length > 0) {
            const placeholders = featuredIds.map(() => "?").join(",");
            const rows = await dbAll(
        `${listQueryBase} WHERE m.id IN (${placeholders}) AND m.is_hidden = 0 AND ${MANGA_HAS_CHAPTER_SQL}${adultVisibilityClause}`,
              featuredIds
            );
            const rowMap = new Map(rows.map((row) => [row.id, row]));
            featuredRows = featuredIds.map((id) => rowMap.get(id)).filter(Boolean);
          }

          if (featuredRows.length === 0) {
            featuredRows = await dbAll(
        `${listQueryBase} WHERE m.is_hidden = 0 AND ${MANGA_HAS_CHAPTER_SQL}${adultVisibilityClause} ${listQueryOrder} LIMIT 4`
            );
          }

          const latestRows = await dbAll(
        `${listQueryBase} WHERE m.is_hidden = 0 AND ${MANGA_HAS_CHAPTER_SQL}${adultVisibilityClause} ${listQueryOrder} LIMIT ${HOMEPAGE_LATEST_LIMIT}`
          );
          await ensureMangaDailyViewBaselineSynced();
          const topRankingDayRows = await resolveHomepageTopRankingByPeriod({
            includeAdult: false,
            daysWindow: HOMEPAGE_RANKING_DAY_DAYS
          });
          const topRankingWeekRows = await resolveHomepageTopRankingByPeriod({
            includeAdult: false,
            daysWindow: HOMEPAGE_RANKING_WEEK_DAYS
          });
          const topRankingMonthRows = await resolveHomepageTopRankingByPeriod({
            includeAdult: false,
            daysWindow: HOMEPAGE_RANKING_MONTH_DAYS
          });
          const topRankingTotalRows = await resolveHomepageTopRankingByPeriod({
            includeAdult: false,
            daysWindow: 0
          });
          const recentCommentRows = await dbAll(
            `
              SELECT
                c.id,
                c.manga_id,
                c.author,
                c.content,
                c.created_at,
                c.chapter_number,
                COALESCE(comment_page_calc.comment_page, 1) AS comment_page,
                COALESCE(c.author_avatar_url, '') AS author_avatar_url,
                COALESCE(
                  NULLIF(trim(COALESCE(c.author_user_id, '')), ''),
                  u_primary.id::text,
                  u_guess.id::text,
                  ''
                ) AS author_user_id,
                COALESCE(
                  NULLIF(trim(COALESCE(u_primary.username, '')), ''),
                  NULLIF(trim(COALESCE(u_guess.username, '')), ''),
                  ''
                ) AS author_username,
                m.slug AS manga_slug,
                m.title AS manga_title,
                COALESCE(m.genres, '') AS manga_genres
              FROM comments c
              JOIN manga m ON m.id = c.manga_id
              LEFT JOIN LATERAL (
                SELECT
                  FLOOR(COUNT(*)::numeric / ${COMMENT_PANEL_PER_PAGE})::int + 1 AS comment_page
                FROM comments c_scope
                WHERE c_scope.status = 'visible'
                  AND c_scope.parent_id IS NULL
                  AND COALESCE(c_scope.client_request_id, '') NOT ILIKE 'forum-%'
                  AND c_scope.manga_id = c.manga_id
                  AND (
                    (c.chapter_number IS NULL AND c_scope.chapter_number IS NULL)
                    OR (c.chapter_number IS NOT NULL AND c_scope.chapter_number = c.chapter_number)
                  )
                  AND c_scope.id > c.id
              ) comment_page_calc ON TRUE
              LEFT JOIN users u_primary
                ON NULLIF(trim(COALESCE(c.author_user_id, '')), '') IS NOT NULL
                AND u_primary.id::text = trim(COALESCE(c.author_user_id, ''))
              LEFT JOIN LATERAL (
                SELECT u_lookup.id, u_lookup.username
                FROM users u_lookup
                WHERE (
                  NULLIF(trim(COALESCE(c.author_user_id, '')), '') IS NULL
                  OR u_primary.id IS NULL
                )
                  AND (
                    lower(trim(COALESCE(u_lookup.username, ''))) = lower(regexp_replace(trim(COALESCE(c.author, '')), '^@+', ''))
                    OR lower(trim(COALESCE(u_lookup.display_name, ''))) = lower(trim(COALESCE(c.author, '')))
                    OR lower(trim(COALESCE(u_lookup.display_name, ''))) = lower(regexp_replace(trim(COALESCE(c.author, '')), '^@+', ''))
                  )
                ORDER BY
                  CASE
                    WHEN lower(trim(COALESCE(u_lookup.display_name, ''))) = lower(trim(COALESCE(c.author, ''))) THEN 0
                    ELSE 1
                  END,
                  u_lookup.id
                LIMIT 1
              ) u_guess ON TRUE
              WHERE c.status = 'visible'
                AND c.parent_id IS NULL
                AND COALESCE(c.client_request_id, '') NOT ILIKE 'forum-%'
                AND m.is_hidden = 0
                ${adultVisibilityClause}
              ORDER BY c.id DESC
              LIMIT ${HOMEPAGE_RECENT_COMMENT_LIMIT}
            `
          );
          const totalSeriesRow = await dbGet(
            `SELECT COUNT(*) as count FROM manga m WHERE m.is_hidden = 0 AND ${MANGA_HAS_CHAPTER_SQL}${adultVisibilityClause}`
          );
          const totalsRow = await dbGet(
            `
              SELECT COUNT(*) as total_chapters
              FROM chapters c
              JOIN manga m ON m.id = c.manga_id
              WHERE COALESCE(m.is_hidden, 0) = 0
                ${adultVisibilityClause}
            `
          );
          const totalSeriesNoAdultRow = isAdultContentControlActive
            ? await dbGet(
              `SELECT COUNT(*) as count FROM manga m WHERE m.is_hidden = 0 AND ${MANGA_HAS_CHAPTER_SQL} AND NOT (${MANGA_HAS_ADULT_GENRE_SQL})`
            )
            : totalSeriesRow;
          const totalsNoAdultRow = isAdultContentControlActive
            ? await dbGet(
              `
                SELECT COUNT(*) as total_chapters
                FROM chapters c
                JOIN manga m ON m.id = c.manga_id
                WHERE m.is_hidden = 0
                  AND NOT (${MANGA_HAS_ADULT_GENRE_SQL})
              `
            )
            : totalsRow;
          const latestForumPostRows = isForumPageAvailable
            ? await dbAll(
              `
                WITH RECURSIVE roots AS (
                  SELECT
                    p.id,
                    p.content,
                    p.created_at,
                    p.author,
                    p.author_name,
                    p.author_avatar_url,
                    p.author_user_id
                  FROM forum_posts p
                  WHERE p.status = 'visible'
                    AND p.parent_id IS NULL
                    AND COALESCE(p.client_request_id, '') ILIKE ?
                ),
                subtree AS (
                  SELECT
                    r.id AS root_id,
                    child.id,
                    child.created_at
                  FROM roots r
                  JOIN forum_posts child ON child.parent_id = r.id
                  WHERE child.status = 'visible'
                    AND COALESCE(child.client_request_id, '') ILIKE ?
                  UNION ALL
                  SELECT
                    subtree.root_id,
                    child.id,
                    child.created_at
                  FROM subtree
                  JOIN forum_posts child ON child.parent_id = subtree.id
                  WHERE child.status = 'visible'
                    AND COALESCE(child.client_request_id, '') ILIKE ?
                ),
                reply_stats AS (
                  SELECT
                    root_id,
                    COUNT(*)::int AS reply_count,
                    MAX(created_at) AS latest_reply_at
                  FROM subtree
                  GROUP BY root_id
                )
                SELECT
                  roots.id,
                  roots.content,
                  roots.created_at,
                  COALESCE(reply_stats.latest_reply_at, roots.created_at) AS latest_activity_at,
                  roots.author,
                  roots.author_name,
                  roots.author_avatar_url,
                  roots.author_user_id,
                  COALESCE(u.username, '') AS user_username,
                  COALESCE(u.display_name, '') AS user_display_name,
                  COALESCE(u.avatar_url, '') AS user_avatar_url,
                  COALESCE(reply_stats.reply_count, 0) AS reply_count
                FROM roots
                LEFT JOIN users u ON u.id = roots.author_user_id
                LEFT JOIN reply_stats ON reply_stats.root_id = roots.id
                ORDER BY COALESCE(reply_stats.latest_reply_at, roots.created_at) DESC, roots.created_at DESC, roots.id DESC
                LIMIT ?
              `,
              [
                HOMEPAGE_FORUM_REQUEST_ID_LIKE,
                HOMEPAGE_FORUM_REQUEST_ID_LIKE,
                HOMEPAGE_FORUM_REQUEST_ID_LIKE,
                HOMEPAGE_FORUM_POST_LIMIT
              ]
            )
            : [];

          const mappedFeatured = featuredRows.map((row) => {
            const mapped = mapMangaListRow(row);
            return {
              ...mapped,
              isAdult: shouldExposeAdultMarker(row)
            };
          });
          const mappedLatest = latestRows.map((row) => {
            const mapped = mapMangaListRow(row);
            return {
              ...mapped,
              isAdult: shouldExposeAdultMarker(row)
            };
          });
          const mappedTopRankings = {
            day: topRankingDayRows,
            week: topRankingWeekRows,
            month: topRankingMonthRows,
            total: topRankingTotalRows
          };
          const recentCommentAuthorDecorationMap = await buildForumAuthorDecorationMap(recentCommentRows);
          const mappedRecentComments = recentCommentRows.map((row) => {
            const mangaSlug = (row && row.manga_slug ? row.manga_slug : "").toString().trim();
            const mangaTitle = (row && row.manga_title ? row.manga_title : "").toString().trim();
            const chapterNumberValue = row && row.chapter_number != null ? Number(row.chapter_number) : NaN;
            const chapterNumberText = Number.isFinite(chapterNumberValue)
              ? formatChapterNumberValue(chapterNumberValue)
              : "";
            const commentTargetLabel = chapterNumberText
              ? `CH. ${chapterNumberText} - ${mangaTitle || "Xem truyện"}`
              : (mangaTitle || "Xem truyện");
            const mangaHref = mangaSlug ? `/manga/${encodeURIComponent(mangaSlug)}` : "/manga";
            const chapterHref = mangaSlug && chapterNumberText
              ? `/manga/${encodeURIComponent(mangaSlug)}/chapters/${encodeURIComponent(chapterNumberText)}`
              : mangaHref;
            const commentPageRaw = Number(row && row.comment_page);
            const commentPage = Number.isFinite(commentPageRaw) && commentPageRaw > 1
              ? Math.floor(commentPageRaw)
              : 1;
            const commentId = Number(row && row.id) || 0;
            const commentPathBase = chapterHref || mangaHref;
            const commentPermalinkHref = commentPathBase
              ? `${commentPathBase}${commentPage > 1 ? `?commentPage=${encodeURIComponent(String(commentPage))}` : ""}${commentId > 0 ? `#comment-${commentId}` : ""}`
              : "";
            const authorName = (row && row.author ? row.author : "").toString().trim() || "Thành viên";
            const authorUserId = row && row.author_user_id ? String(row.author_user_id).trim() : "";
            const authorUsername = row && row.author_username ? String(row.author_username).trim() : "";
            const authorProfileHref = authorUsername || authorUserId
              ? `/user/${encodeURIComponent(authorUsername || authorUserId)}`
              : "";
            const authorColor = authorUserId && recentCommentAuthorDecorationMap.has(authorUserId)
              ? recentCommentAuthorDecorationMap.get(authorUserId) || ""
              : "";
            const avatarCandidate = row && row.author_avatar_url ? String(row.author_avatar_url) : "";
            const avatarUrl = typeof normalizeAvatarUrl === "function"
              ? normalizeAvatarUrl(avatarCandidate)
              : avatarCandidate.trim();

            return {
              id: Number(row && row.id) || 0,
              commentPage,
              commentPermalinkHref,
              authorName,
              authorUsername,
              authorProfileHref,
              authorColor,
              avatarUrl,
              avatarFallback: buildHomepageAvatarFallback(authorName),
              content: (row && row.content ? String(row.content) : "").trim(),
              mangaTitle,
              commentTargetLabel,
              mangaHref,
              chapterHref,
              chapterNumberText,
              isAdult: hasAdultGenre(row && row.manga_genres),
              timeAgo: formatTimeAgo(row && row.created_at)
            };
          });
          const forumAuthorDecorationMap = await buildForumAuthorDecorationMap(latestForumPostRows);
          const mappedLatestForumPosts = latestForumPostRows.map((row) => {
            const postId = Number(row && row.id);
            const safePostId = Number.isFinite(postId) && postId > 0 ? Math.floor(postId) : 0;
            const title = extractForumTopicHeadline(row && row.content) || "Bài viết diễn đàn";
            const authorDisplayName = (row && row.user_display_name ? String(row.user_display_name) : "").trim();
            const authorUsername = (row && row.user_username ? String(row.user_username) : "").trim().toLowerCase();
            const fallbackAuthor = (row && (row.author_name || row.author) ? String(row.author_name || row.author) : "").trim();
            const authorName = authorDisplayName || (authorUsername ? `@${authorUsername}` : fallbackAuthor || "Thành viên");
            const avatarCandidate = row && (row.user_avatar_url || row.author_avatar_url) ? String(row.user_avatar_url || row.author_avatar_url) : "";
            const avatarUrl = typeof normalizeAvatarUrl === "function" ? normalizeAvatarUrl(avatarCandidate) : avatarCandidate.trim();
            const metadataAuthor = authorDisplayName || authorUsername || fallbackAuthor || "Thành viên";
            const authorUserId = row && row.author_user_id ? String(row.author_user_id).trim() : "";
            const authorColor = authorUserId && forumAuthorDecorationMap.has(authorUserId)
              ? forumAuthorDecorationMap.get(authorUserId) || ""
              : "";
            const sectionLabel = buildForumSectionLabel(row && row.content);

            return {
              id: safePostId,
              title,
              authorName,
              metadataAuthor,
              authorColor,
              avatarUrl,
              avatarFallback: buildAvatarFallback(authorDisplayName || authorUsername || fallbackAuthor),
              sectionLabel,
              commentCount: Number(row && row.reply_count) || 0,
              timeAgo: formatTimeAgo(row && row.latest_activity_at || row && row.created_at),
              href: safePostId > 0 ? `/forum/post/${safePostId}` : "/forum"
            };
          });
          let rebuiltPayload = {
            featured: mappedFeatured,
            latest: mappedLatest,
            topRankings: mappedTopRankings,
            recentComments: mappedRecentComments,
            latestForumPosts: mappedLatestForumPosts,
            homepage: {
              notices
            },
            stats: {
              totalSeries: totalSeriesRow ? Number(totalSeriesRow.count) || 0 : 0,
              totalSeriesNoAdult: totalSeriesNoAdultRow ? Number(totalSeriesNoAdultRow.count) || 0 : 0,
              totalChapters: totalsRow
                ? Number(totalsRow.total_chapters ?? totalsRow.totalchapters ?? totalsRow.totalChapters) || 0
                : 0,
              totalChaptersNoAdult: totalsNoAdultRow
                ? Number(
                  totalsNoAdultRow.total_chapters
                  ?? totalsNoAdultRow.totalchapters
                  ?? totalsNoAdultRow.totalChapters
                ) || 0
                : 0
            }
          };

          rebuiltPayload = await refreshHomepageBookmarkCounts(rebuiltPayload);
          const refreshedAt = Date.now();
          const freshnessToken = await readHomepageFreshnessToken();
          const updatedAt = homepageRow && homepageRow.updated_at
            ? String(homepageRow.updated_at).trim()
            : "";
          homepageCacheByAudience.set(audienceKey, {
            payload: rebuiltPayload,
            expiresAt: refreshedAt + HOMEPAGE_CACHE_TTL_MS,
            updatedAt,
            freshnessToken,
            metaProbeAt: refreshedAt + HOMEPAGE_META_PROBE_INTERVAL_MS
          });
          const redisHomepageCacheKey = homepageEndpointCacheKey || buildHomepageEndpointCacheKey({ includeAdult });
          await writeEndpointCache(
            redisHomepageCacheKey,
            {
              payload: rebuiltPayload,
              freshnessToken,
              updatedAt
            },
            ENDPOINT_CACHE_HOMEPAGE_TTL_SECONDS
          );
          return rebuiltPayload;
        })();

        homepageCacheRefreshInFlightByAudience.set(audienceKey, refreshPromise);
        try {
          homepagePayload = await refreshPromise;
        } finally {
          if (homepageCacheRefreshInFlightByAudience.get(audienceKey) === refreshPromise) {
            homepageCacheRefreshInFlightByAudience.delete(audienceKey);
          }
        }
      }
    }

    return applyHomepageUserOverlay(homepagePayload, includeAdult);
  };

  const buildHomepageSeoImage = (homepagePayload) =>
    homepagePayload && homepagePayload.featured && homepagePayload.featured.length && homepagePayload.featured[0].cover
      ? homepagePayload.featured[0].cover
      : "";

  app.get(
    "/",
    asyncHandler(async (req, res) => {
      const isHomepageRefresh = isHomepageRefreshRequest(req);
      const forceFreshHomepagePayload = shouldForceFreshHomepagePayload(req);
      res.vary("Cookie");
      res.set("Cache-Control", isHomepageRefresh || forceFreshHomepagePayload ? "no-store" : FAST_NAV_PAGE_CACHE_CONTROL);

      const homepagePayload = await resolveHomepagePayload({
        forceFresh: forceFreshHomepagePayload,
        includeAdult: shouldIncludeAdultMangaForRequest(req)
      });
      const homepageSignature = buildHomepagePayloadSignature(homepagePayload);
      res.set("X-Homepage-Signature", homepageSignature);
      const seoImage = buildHomepageSeoImage(homepagePayload);
      const homepageKeywords = buildSeoKeywordList([
        SEO_TRENDING_KEYWORDS,
        "đọc truyện tranh online miễn phí",
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
          name: `${SEO_SITE_NAME} - Đọc truyện tranh online`,
          description: `${SEO_SITE_NAME} là nơi đọc truyện tranh online miễn phí, cập nhật nhanh manga, manhwa, manhua mới nhất.`,
          image: seoImage,
          keywords: homepageKeywords
        }),
        buildBreadcrumbSchema(req, [{ name: "Trang chủ", path: "/" }])
      ]);

      res.render("index", {
        title: "Trang chủ",
        team,
        featured: homepagePayload.featured,
        latest: homepagePayload.latest,
        topRankings: homepagePayload.topRankings,
        recentComments: homepagePayload.recentComments,
        forumLatestPosts: homepagePayload.latestForumPosts,
        forumPageEnabled: Boolean(isForumPageAvailable),
        homepage: homepagePayload.homepage,
        homepageSignature,
        stats: homepagePayload.stats,
        seo: buildSeoPayload(req, {
          title: homepageSeoTitle,
          description: homepageSeoDescription,
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
      res.vary("Cookie");
      const homepagePayload = await resolveHomepagePayload({
        includeAdult: shouldIncludeAdultMangaForRequest(req)
      });
      const seoImage = buildHomepageSeoImage(homepagePayload);
      const homepageKeywords = buildSeoKeywordList([
        SEO_TRENDING_KEYWORDS,
        "đọc truyện tranh online miễn phí",
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
          name: `${SEO_SITE_NAME} - Đọc truyện tranh online`,
          description: `${SEO_SITE_NAME} là nơi đọc truyện tranh online miễn phí, cập nhật nhanh manga, manhwa, manhua mới nhất.`,
          image: seoImage,
          keywords: homepageKeywords
        }),
        buildBreadcrumbSchema(req, [{ name: "Trang chủ", path: "/" }])
      ]);
      const seo = buildSeoPayload(req, {
        title: homepageSeoTitle,
        description: homepageSeoDescription,
        keywords: homepageKeywords,
        canonicalPath: "/",
        image: seoImage,
        ogType: "website",
        jsonLd: homepageSchemas
      });

      res.render("index-amp", {
        title: "Trang chủ",
        team,
        featured: homepagePayload.featured,
        latest: homepagePayload.latest,
        forumLatestPosts: homepagePayload.latestForumPosts,
        homepage: homepagePayload.homepage,
        stats: homepagePayload.stats,
        canonicalUrl: seo.canonical,
        webUrl: seo.canonical,
        seo,
        ampSchemas: homepageSchemas
      });
    })
  );

  app.get(
    "/user/:identifier",
    asyncHandler(async (req, res) => {
      const rawIdentifier = (req.params.identifier || "").toString().trim();
      const identifier = rawIdentifier.replace(/^@+/, "").trim();
      if (!identifier) {
        return renderNotFoundPage(req, res);
      }

      let profileRow = await dbGet(
        `
        SELECT
          id,
          username,
          display_name,
          avatar_url,
          facebook_url,
          discord_handle,
          bio,
          created_at
        FROM users
        WHERE lower(trim(COALESCE(username, ''))) = lower(trim(?))
        LIMIT 1
      `,
        [identifier]
      );

      if (!profileRow) {
        profileRow = await dbGet(
          `
          SELECT
            id,
            username,
            display_name,
            avatar_url,
            facebook_url,
            discord_handle,
            bio,
            created_at
          FROM users
          WHERE id::text = ?
          LIMIT 1
        `,
          [identifier]
        );
      }

      if (!profileRow || !profileRow.id) {
        return renderNotFoundPage(req, res);
      }

      const profileUserId = String(profileRow.id).trim();
      const includeAdult = shouldIncludeAdultMangaForRequest(req);
      const adultVisibilityClause = includeAdult ? "" : ` AND NOT (${MANGA_HAS_ADULT_GENRE_SQL})`;

      const [badgeContext, commentCountRow, recentCommentRows] = await Promise.all([
        typeof getUserBadgeContext === "function"
          ? getUserBadgeContext(profileUserId).catch(() => ({ badges: [], userColor: "" }))
          : Promise.resolve({ badges: [], userColor: "" }),
        dbGet(
          `
          SELECT COUNT(*)::bigint AS count
          FROM comments c
          JOIN manga m ON m.id = c.manga_id
          WHERE c.status = 'visible'
            AND COALESCE(m.is_hidden, 0) = 0
            ${adultVisibilityClause}
            AND c.author_user_id = ?
        `,
          [profileUserId]
        ),
        dbAll(
          `
          SELECT
            c.id,
            c.content,
            c.created_at,
            c.chapter_number,
            m.slug AS manga_slug,
            m.title AS manga_title
          FROM comments c
          JOIN manga m ON m.id = c.manga_id
          WHERE c.status = 'visible'
            AND COALESCE(m.is_hidden, 0) = 0
            ${adultVisibilityClause}
            AND c.author_user_id = ?
          ORDER BY c.id DESC
          LIMIT 12
        `,
          [profileUserId]
        )
      ]);

      const recentComments = recentCommentRows.map((row) => {
        const mangaSlug = (row && row.manga_slug ? row.manga_slug : "").toString().trim();
        const mangaTitle = (row && row.manga_title ? row.manga_title : "").toString().trim() || "Xem truyện";
        const chapterNumberValue = row && row.chapter_number != null ? Number(row.chapter_number) : NaN;
        const chapterNumberText = Number.isFinite(chapterNumberValue)
          ? formatChapterNumberValue(chapterNumberValue)
          : "";
        const chapterLabel = chapterNumberText ? `CH. ${chapterNumberText}` : "Bình luận truyện";
        const baseCommentUrl = mangaSlug ? `/manga/${encodeURIComponent(mangaSlug)}` : "";
        const commentUrl = mangaSlug && chapterNumberText
          ? `${baseCommentUrl}/chapters/${encodeURIComponent(chapterNumberText)}`
          : baseCommentUrl;
        const contentText = (row && row.content ? String(row.content) : "").replace(/\s+/g, " ").trim();
        const contentPreview = contentText.length > 180
          ? `${contentText.slice(0, 177).trim()}...`
          : (contentText || "Bình luận trống.");

        return {
          commentUrl,
          displayTitle: mangaTitle,
          chapterLabel,
          contentPreview,
          timeAgo: formatTimeAgo(row && row.created_at)
        };
      });

      const username = (profileRow.username || "").toString().trim();
      const displayName = (profileRow.display_name || "").toString().replace(/\s+/g, " ").trim();
      const profileName = displayName || (username ? `@${username}` : "Thành viên");
      const profileDescription = normalizeSeoText(
        `Trang cá nhân của ${profileName} trên ${SEO_SITE_NAME}. Xem badge, thông tin và bình luận gần đây của thành viên.`,
        180
      );
      const canonicalPath = `/user/${encodeURIComponent(username || profileUserId)}`;

      return res.render("user-profile", {
        title: profileName,
        team,
        formatDate: typeof formatDate === "function"
          ? formatDate
          : (value) => {
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return "";
            return date.toLocaleDateString("vi-VN");
          },
        profile: {
          id: profileUserId,
          username,
          displayName,
          avatarUrl: normalizeAvatarUrl(profileRow.avatar_url || ""),
          joinedAt: profileRow.created_at || "",
          facebookUrl: normalizeProfileFacebook(profileRow.facebook_url || ""),
          discordUrl: normalizeProfileDiscord(profileRow.discord_handle || ""),
          bio: normalizeProfileBio(profileRow.bio || ""),
          badges: Array.isArray(badgeContext && badgeContext.badges) ? badgeContext.badges : [],
          recentComments,
          commentCount: Number(commentCountRow && commentCountRow.count) || 0,
          team: null
        },
        profileActions: {
          canMessage: false,
          messageUrl: ""
        },
        seo: buildSeoPayload(req, {
          title: `${profileName} | Thành viên ${SEO_SITE_NAME}`,
          description: profileDescription,
          canonicalPath,
          robots: SEO_ROBOTS_INDEX,
          image: normalizeAvatarUrl(profileRow.avatar_url || ""),
          ogType: "profile"
        })
      });
    })
  );

  app.post(
    "/messages/upload-image",
    uploadMessageImage,
    asyncHandler(async (req, res) => {
      const user = await requirePrivateFeatureAuthUser(req, res);
      if (!user) return;

      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      if (!messageImageUploadsEnabled) {
        return res.status(503).json({
          ok: false,
          error: "Tính năng gửi ảnh trong tin nhắn hiện đang tắt."
        });
      }

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ ok: false, error: "Không tìm thấy ảnh để tải lên." });
      }

      const uploaded = await uploadImageBufferToGoogleDrive({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
        prefix: "messages"
      });

      return res.json({
        ok: true,
        imageUrl: uploaded.imageUrl,
        fileId: uploaded.fileId || ""
      });
    })
  );

  app.get(
    "/manga/search",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      res.vary("Cookie");
      res.set("Cache-Control", "private, no-store");

      const q = normalizeMangaSearchQuery(req.query && typeof req.query.q === "string" ? req.query.q : "", 80);
      const includeAdult = shouldIncludeAdultMangaForRequest(req);
      const adultVisibilityClause = includeAdult ? "" : ` AND NOT (${MANGA_HAS_ADULT_GENRE_SQL})`;
      if (!q) {
        return res.json({ ok: true, query: "", items: [] });
      }

      const limitRaw = Number(req.query && req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(5, Math.floor(limitRaw))
        : 5;
      const qLower = q.toLowerCase();
      const qStartsWith = `${qLower}%`;
      const qContains = `%${qLower}%`;
      const useTrigram = q.length >= 3 && await resolvePgTrgmEnabled();

      let rows = [];

      if (useTrigram) {
        rows = await dbAll(
          `
          SELECT
            m.id,
            m.slug,
            m.title,
            m.cover,
            COALESCE(m.cover_updated_at, 0) AS cover_updated_at,
            COALESCE(m.status, '') AS status,
            ${MANGA_HAS_ADULT_GENRE_SQL} AS is_adult,
            (
              CASE
                WHEN lower(trim(m.title)) = ? THEN 1200
                WHEN lower(trim(m.slug)) = ? THEN 1120
                WHEN lower(m.title) LIKE ? THEN 980
                WHEN lower(m.slug) LIKE ? THEN 940
                WHEN strpos(lower(m.title), ?) > 0 THEN 760 - LEAST(strpos(lower(m.title), ?), 220)
                WHEN strpos(lower(m.slug), ?) > 0 THEN 710 - LEAST(strpos(lower(m.slug), ?), 220)
                ELSE 0
              END
            )
            + (similarity(m.title, ?) * 100)
            + (similarity(m.slug, ?) * 45)
            - LEAST(ABS(char_length(m.title) - char_length(?)), 60)
            AS score
          FROM manga m
          WHERE COALESCE(m.is_hidden, 0) = 0
            ${adultVisibilityClause}
            AND (
              lower(m.title) LIKE ?
              OR lower(m.slug) LIKE ?
              OR COALESCE(lower(m.other_names), '') LIKE ?
              OR m.title % ?
            )
          ORDER BY score DESC, m.updated_at DESC, m.id DESC
          LIMIT ?
        `,
          [
            qLower,
            qLower,
            qStartsWith,
            qStartsWith,
            qLower,
            qLower,
            qLower,
            qLower,
            q,
            q,
            q,
            qContains,
            qContains,
            qContains,
            q,
            limit
          ]
        );
      } else if (q.length < 2) {
        rows = await dbAll(
          `
          SELECT
            m.id,
            m.slug,
            m.title,
            m.cover,
            COALESCE(m.cover_updated_at, 0) AS cover_updated_at,
            COALESCE(m.status, '') AS status,
            ${MANGA_HAS_ADULT_GENRE_SQL} AS is_adult,
            (
              CASE
                WHEN lower(trim(m.title)) = ? THEN 1200
                WHEN lower(trim(m.slug)) = ? THEN 1120
                WHEN lower(m.title) LIKE ? THEN 980
                WHEN lower(m.slug) LIKE ? THEN 940
                ELSE 0
              END
            )
            - LEAST(ABS(char_length(m.title) - char_length(?)), 60)
            AS score
          FROM manga m
          WHERE COALESCE(m.is_hidden, 0) = 0
            ${adultVisibilityClause}
            AND (
              lower(m.title) LIKE ?
              OR lower(m.slug) LIKE ?
            )
          ORDER BY score DESC, m.updated_at DESC, m.id DESC
          LIMIT ?
        `,
          [
            qLower,
            qLower,
            qStartsWith,
            qStartsWith,
            q,
            qStartsWith,
            qStartsWith,
            limit
          ]
        );
      } else {
        rows = await dbAll(
          `
          SELECT
            m.id,
            m.slug,
            m.title,
            m.cover,
            COALESCE(m.cover_updated_at, 0) AS cover_updated_at,
            COALESCE(m.status, '') AS status,
            ${MANGA_HAS_ADULT_GENRE_SQL} AS is_adult,
            (
              CASE
                WHEN lower(trim(m.title)) = ? THEN 1200
                WHEN lower(trim(m.slug)) = ? THEN 1120
                WHEN lower(m.title) LIKE ? THEN 980
                WHEN lower(m.slug) LIKE ? THEN 940
                WHEN strpos(lower(m.title), ?) > 0 THEN 760 - LEAST(strpos(lower(m.title), ?), 220)
                WHEN strpos(lower(m.slug), ?) > 0 THEN 710 - LEAST(strpos(lower(m.slug), ?), 220)
                ELSE 0
              END
            )
            - LEAST(ABS(char_length(m.title) - char_length(?)), 60)
            AS score
          FROM manga m
          WHERE COALESCE(m.is_hidden, 0) = 0
            ${adultVisibilityClause}
            AND (
              lower(m.title) LIKE ?
              OR lower(m.slug) LIKE ?
              OR COALESCE(lower(m.other_names), '') LIKE ?
            )
          ORDER BY score DESC, m.updated_at DESC, m.id DESC
          LIMIT ?
        `,
          [
            qLower,
            qLower,
            qStartsWith,
            qStartsWith,
            qLower,
            qLower,
            qLower,
            qLower,
            q,
            qContains,
            qContains,
            qContains,
            limit
          ]
        );
      }

      return res.json({
        ok: true,
        query: q,
        items: (rows || []).map((row) => ({
          id: Number(row.id) || 0,
          slug: (row.slug || "").toString().trim(),
          title: (row.title || "").toString().trim(),
          cover: (row.cover || "").toString().trim(),
          coverUpdatedAt: Number(row.cover_updated_at) || 0,
          status: (row.status || "").toString().trim(),
          isAdult: shouldExposeAdultMarker(row)
        }))
      });
    })
  );

  const resolveMangaStatusOptions = async () => {
    const baseCacheKey = buildMangaStatusOptionsEndpointCacheKey();
    const statusOptionsCache = await readEndpointCache(baseCacheKey);
    const statusOptionsCacheKey = statusOptionsCache.key;
    const cachedStatusOptionsPayload = statusOptionsCache.value;
    if (cachedStatusOptionsPayload && Array.isArray(cachedStatusOptionsPayload.statusOptions)) {
      return cachedStatusOptionsPayload.statusOptions;
    }

    if (mangaStatusOptionsRefreshPromise) {
      return mangaStatusOptionsRefreshPromise;
    }

    mangaStatusOptionsRefreshPromise = (async () => {
      const statusRows = await dbAll(
        `
          SELECT status, COUNT(*) as count
          FROM manga m
          WHERE m.is_hidden = 0
            AND ${MANGA_HAS_CHAPTER_SQL}
            AND status IS NOT NULL
            AND TRIM(status) <> ''
          GROUP BY status
          ORDER BY
            CASE
              WHEN lower(trim(status)) = lower('Còn tiếp') THEN 0
              WHEN lower(trim(status)) = lower('Hoàn thành') THEN 1
              WHEN lower(trim(status)) = lower('Tạm dừng') THEN 2
              ELSE 3
            END,
            lower(trim(status)) ASC
        `
      );

      const statusOptions = statusRows
        .map((row) => {
          const value = (row && row.status ? String(row.status) : "").replace(/\s+/g, " ").trim();
          if (!value) return null;
          return {
            value,
            label: value,
            count: Number(row && row.count) || 0
          };
        })
        .filter(Boolean);

      await writeEndpointCache(
        statusOptionsCacheKey || baseCacheKey,
        { statusOptions },
        ENDPOINT_CACHE_MANGA_STATUS_OPTIONS_TTL_SECONDS
      );

      return statusOptions;
    })();

    try {
      return await mangaStatusOptionsRefreshPromise;
    } finally {
      mangaStatusOptionsRefreshPromise = null;
    }
  };

  app.get(
    "/manga",
    asyncHandler(async (req, res) => {
      res.vary("Cookie");
      res.set("Cache-Control", FAST_NAV_PAGE_CACHE_CONTROL);

      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const includeAdultForRequest = shouldIncludeAdultMangaForRequest(req);
      const rawStatus = typeof req.query.status === "string" ? req.query.status.trim() : "";
      const rawInclude = req.query.include;
      const rawExclude = req.query.exclude;
      const legacyGenre = typeof req.query.genre === "string" ? req.query.genre.trim() : "";
      const mangaListEndpointCacheContext = {
        includeAdult: includeAdultForRequest,
        q: normalizeEndpointCacheInput(q),
        status: normalizeEndpointCacheInput(rawStatus),
        include: normalizeEndpointCacheInput(rawInclude),
        exclude: normalizeEndpointCacheInput(rawExclude),
        genre: normalizeEndpointCacheInput(legacyGenre),
        pageInput: normalizeEndpointCacheInput(req.query && req.query.page),
        perPageInput: normalizeEndpointCacheInput(req.query && req.query.perPage)
      };
      const mangaListRequestedEndpointCacheKey = buildMangaListEndpointCacheKey(mangaListEndpointCacheContext);
      const mangaListEndpointCache = await readEndpointCache(mangaListRequestedEndpointCacheKey);
      const mangaListEndpointCacheKey = mangaListEndpointCache.key;
      const cachedMangaListPayload = mangaListEndpointCache.value;
      if (
        cachedMangaListPayload
        && Array.isArray(cachedMangaListPayload.mangaLibrary)
        && Array.isArray(cachedMangaListPayload.genreStats)
        && cachedMangaListPayload.pagination
        && typeof cachedMangaListPayload.pagination === "object"
      ) {
        const mangaListRenderPayload = applyMangaListUserOverlay(cachedMangaListPayload, includeAdultForRequest);
        const cachedFilters =
          mangaListRenderPayload.filters && typeof mangaListRenderPayload.filters === "object"
            ? mangaListRenderPayload.filters
            : {};
        const cachedSeo =
          mangaListRenderPayload.seoData && typeof mangaListRenderPayload.seoData === "object"
            ? mangaListRenderPayload.seoData
            : {};
        const cachedMangaLibrary = Array.isArray(mangaListRenderPayload.mangaLibrary)
          ? mangaListRenderPayload.mangaLibrary
          : [];
        const cachedResultCount = Number(mangaListRenderPayload.resultCount) || 0;
        const cachedKeywords = Array.isArray(cachedSeo.mangaListKeywords) ? cachedSeo.mangaListKeywords : [];
        const cachedSchemas = Array.isArray(cachedSeo.mangaListSchemas) ? cachedSeo.mangaListSchemas : [];

        return res.render("manga", {
          title: "Toàn bộ truyện",
          team,
          mangaLibrary: cachedMangaLibrary,
          genres: mangaListRenderPayload.genreStats,
          filters: {
            q: typeof cachedFilters.q === "string" ? cachedFilters.q : "",
            status: typeof cachedFilters.status === "string" ? cachedFilters.status : "",
            statusOptions: Array.isArray(mangaListRenderPayload.statusOptions)
              ? mangaListRenderPayload.statusOptions
              : [],
            include: Array.isArray(cachedFilters.include) ? cachedFilters.include : [],
            exclude: Array.isArray(cachedFilters.exclude) ? cachedFilters.exclude : []
          },
          resultCount: cachedResultCount,
          pagination: mangaListRenderPayload.pagination,
          seo: buildSeoPayload(req, {
            title: typeof cachedSeo.seoTitle === "string"
              ? cachedSeo.seoTitle
              : "Đọc truyện tranh | Toàn bộ manga",
            description: typeof cachedSeo.seoDescription === "string"
              ? cachedSeo.seoDescription
              : `${SEO_SITE_NAME} là kho đọc truyện tranh online miễn phí, cập nhật liên tục manga, manhwa, manhua mới nhất mỗi ngày.`,
            keywords: cachedKeywords,
            canonicalPath: "/manga",
            robots: cachedSeo.shouldNoIndex ? SEO_ROBOTS_NOINDEX : SEO_ROBOTS_INDEX,
            image: cachedMangaLibrary.length && cachedMangaLibrary[0].cover ? cachedMangaLibrary[0].cover : "",
            ogType: "website",
            jsonLd: cachedSchemas
          })
        });
      }
      const include = [];
      const exclude = [];

      const rawGenreStats = await getGenreStats();
      const genreStats = filterGenreStatsForAudience(rawGenreStats, includeAdultForRequest);
      const statusOptions = await resolveMangaStatusOptions();
      const selectedStatusOption = rawStatus
        ? statusOptions.find((option) => option.value.toLowerCase() === rawStatus.toLowerCase()) || null
        : null;
      const selectedStatus = selectedStatusOption ? selectedStatusOption.value : "";
      const genreIdByName = new Map(
        genreStats.map((genre) => [genre.name.toLowerCase(), genre.id])
      );
      const allowedGenreIdSet = new Set(
        genreStats
          .map((genre) => Number(genre && genre.id))
          .filter((id) => Number.isFinite(id) && id > 0)
          .map((id) => Math.floor(id))
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
        if (!allowedGenreIdSet.has(id)) return;
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

    conditions.push("m.is_hidden = 0");
      conditions.push(MANGA_HAS_CHAPTER_SQL);
      if (!includeAdultForRequest) {
        conditions.push(`NOT (${MANGA_HAS_ADULT_GENRE_SQL})`);
      }

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

      if (selectedStatus) {
        conditions.push("lower(trim(COALESCE(m.status, ''))) = lower(?)");
        params.push(selectedStatus);
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
      const noAdultWhereClause = `WHERE ${conditions.concat([`NOT (${MANGA_HAS_ADULT_GENRE_SQL})`]).join(" AND ")}`;
      const noAdultCountRow = isAdultContentControlActive
        ? (
          includeAdultForRequest
            ? await dbGet(`SELECT COUNT(*) as count FROM manga m ${noAdultWhereClause}`, params)
            : countRow
        )
        : countRow;
      const pagination = resolvePaginationParams({
        pageInput: req.query.page,
        perPageInput: req.query.perPage,
        defaultPerPage: 24,
        maxPerPage: 60,
        totalCount: countRow && countRow.count ? Number(countRow.count) : 0
      });

      const query = `${listQueryBase} ${whereClause} ${listQueryOrder} LIMIT ? OFFSET ?`;
      const mangaRows = await dbAll(query, [...params, pagination.perPage, pagination.offset]);
      const mangaIdsForBookmarkCount = mangaRows
        .map((row) => Number(row && row.id))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value));
      const bookmarkUserCountByMangaId = await resolveBookmarkUserCountByMangaId(mangaIdsForBookmarkCount);
      const mangaLibrary = mangaRows.map((row) => {
        const mapped = mapMangaListRow(row);
        const mappedMangaId = Number(mapped && mapped.id);
        const bookmarkCount = Number.isFinite(mappedMangaId)
          ? Number(bookmarkUserCountByMangaId.get(Math.floor(mappedMangaId))) || 0
          : 0;
        return {
          ...mapped,
          bookmarkCount,
          bookmark_count: bookmarkCount,
          isAdult: shouldExposeAdultMarker(row)
        };
      });
      const hasFilters = Boolean(q || selectedStatus || include.length || filteredExclude.length);
      const seoTitleQuery = normalizeSeoText(q, 55);
      const seoTitle = seoTitleQuery
        ? `Đọc truyện tranh: ${seoTitleQuery}`
        : hasFilters
          ? `Đọc truyện tranh theo bộ lọc | ${SEO_SITE_NAME}`
          : "Đọc truyện tranh | Toàn bộ manga";
      const seoDescription = hasFilters
        ? `Danh sách đọc truyện tranh theo từ khóa và bộ lọc trên ${SEO_SITE_NAME}. Duyệt manga, manhwa, manhua theo thể loại nhanh chóng.`
        : `${SEO_SITE_NAME} là kho đọc truyện tranh online miễn phí, cập nhật liên tục manga, manhwa, manhua mới nhất mỗi ngày.`;
      const shouldNoIndex = hasFilters || pagination.page > 1;
      const genreNameById = new Map(genreStats.map((genre) => [Number(genre.id), (genre.name || "").toString().trim()]));
      const includeGenreNames = include.map((id) => genreNameById.get(Number(id)) || "").filter(Boolean);
      const excludeGenreNames = filteredExclude
        .map((id) => genreNameById.get(Number(id)) || "")
        .filter(Boolean);
      const mangaListKeywords = buildSeoKeywordList([
        SEO_TRENDING_KEYWORDS,
        "đọc truyện tranh theo thể loại",
        "thư viện manga",
        "lọc thể loại manga",
        qNormalized,
        selectedStatus,
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

      const mangaListCachePayload = {
        mangaLibrary,
        genreStats,
        statusOptions,
        filters: {
          q,
          status: selectedStatus,
          include,
          exclude: filteredExclude
        },
        resultCount: pagination.total,
        resultCountNoAdult: noAdultCountRow ? Number(noAdultCountRow.count) || 0 : pagination.total,
        pagination,
        seoData: {
          seoTitle,
          seoDescription,
          shouldNoIndex,
          mangaListKeywords,
          mangaListSchemas
        }
      };
      const mangaListResolvedEndpointCacheKey = mangaListEndpointCacheKey || buildMangaListEndpointCacheKey(mangaListEndpointCacheContext);
      await writeEndpointCache(
        mangaListResolvedEndpointCacheKey,
        mangaListCachePayload,
        ENDPOINT_CACHE_MANGA_LIST_TTL_SECONDS
      );

      const mangaListRenderPayload = applyMangaListUserOverlay(mangaListCachePayload, includeAdultForRequest);

      res.render("manga", {
        title: "Toàn bộ truyện",
        team,
        mangaLibrary: mangaListRenderPayload.mangaLibrary,
        genres: mangaListRenderPayload.genreStats,
        filters: {
          q,
          status: selectedStatus,
          statusOptions,
          include,
          exclude: filteredExclude
        },
        resultCount: mangaListRenderPayload.resultCount,
        pagination: mangaListRenderPayload.pagination,
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
      res.vary("Cookie");
      res.set("Cache-Control", FAST_NAV_PAGE_CACHE_CONTROL);
      await ensureChapterViewSchemaReady();

      const mangaResolution = await resolveMangaRowByRouteSlug(req.params.slug);
      let mangaRow = mangaResolution.mangaRow;
      if (!mangaRow) {
        return renderNotFoundPage(req, res);
      }

      const canonicalMangaPath = `/manga/${encodeURIComponent(mangaRow.slug)}`;
      if (mangaResolution.matchedBy !== "slug") {
        return res.redirect(301, canonicalMangaPath);
      }

      const commentPageRaw = Number(req.query.commentPage);
      const commentPage =
        Number.isFinite(commentPageRaw) && commentPageRaw > 0 ? Math.floor(commentPageRaw) : 1;
      const commentsFlag = (req.query.comments || "").toString().trim().toLowerCase();
      const commentsRequestedExplicitly =
        commentsFlag === "1" || commentsFlag === "true" || commentsFlag === "yes";
      const hasCommentPageQuery = hasOwnObjectKey(req.query || {}, "commentPage");
      const commentsHydrated = commentsRequestedExplicitly || hasCommentPageQuery;

      const mangaDetailEndpointCacheContext = {
        slug: mangaRow.slug,
        chapterPageInput: normalizeEndpointCacheInput(req.query && req.query.chapterPage)
      };
      const mangaDetailKey = buildMangaDetailEndpointCacheKey(mangaDetailEndpointCacheContext);
      const mangaDetailEndpointCache = commentsHydrated
        ? { key: "", value: null }
        : await readEndpointCache(mangaDetailKey);
      const mangaDetailEndpointCacheKey = mangaDetailEndpointCache.key;
      const cachedMangaDetailPayload = mangaDetailEndpointCache.value;

      let chapterPagination = null;
      let shouldNoIndexMangaDetail = false;
      let chapters = [];
      let latestChapterNumber = "";
      let firstChapterNumber = "";
      let latestChapterForSeoText = "?";
      let mangaSeoTitle = "";
      let mappedManga = null;
      let mangaBookmarkCount = 0;
      let groupTeamLinks = [];
      let mangaTotalViews = 0;

      if (
        cachedMangaDetailPayload
        && cachedMangaDetailPayload.chapterPagination
        && typeof cachedMangaDetailPayload.chapterPagination === "object"
        && Array.isArray(cachedMangaDetailPayload.chapters)
        && cachedMangaDetailPayload.mappedManga
        && typeof cachedMangaDetailPayload.mappedManga === "object"
      ) {
        chapterPagination = cachedMangaDetailPayload.chapterPagination;
        shouldNoIndexMangaDetail = Boolean(cachedMangaDetailPayload.shouldNoIndexMangaDetail);
        chapters = cachedMangaDetailPayload.chapters;
        latestChapterNumber = String(cachedMangaDetailPayload.latestChapterNumber || "").trim();
        firstChapterNumber = String(cachedMangaDetailPayload.firstChapterNumber || "").trim();
        latestChapterForSeoText = String(cachedMangaDetailPayload.latestChapterForSeoText || "?").trim() || "?";
        mangaSeoTitle = String(cachedMangaDetailPayload.mangaSeoTitle || "").trim() || `${mangaRow.title} [Tới Chap ${latestChapterForSeoText}]`;
        mappedManga = cachedMangaDetailPayload.mappedManga;
        mangaBookmarkCount = Number(cachedMangaDetailPayload.mangaBookmarkCount) || 0;
        groupTeamLinks = Array.isArray(cachedMangaDetailPayload.groupTeamLinks)
          ? cachedMangaDetailPayload.groupTeamLinks
          : [];
        mangaTotalViews = toSafeChapterViewCount(cachedMangaDetailPayload.mangaTotalViews);
      } else {
        const chapterSummary = await dbGet(
          `
          SELECT
            COUNT(*) as count,
            MAX(number) as latest_number,
            MIN(number) as first_number,
            COALESCE(
              (
                SELECT SUM(COALESCE(v.view_count, 0))
                FROM chapters c_view
                LEFT JOIN chapter_view_stats v ON v.chapter_id = c_view.id
                WHERE c_view.manga_id = ?
              ),
              0
            ) as total_views
          FROM chapters
          WHERE manga_id = ?
        `,
          [mangaRow.id, mangaRow.id]
        );
        chapterPagination = resolvePaginationParams({
          pageInput: req.query.chapterPage,
          perPageInput: MANGA_DETAIL_CHAPTERS_PER_PAGE,
          defaultPerPage: MANGA_DETAIL_CHAPTERS_PER_PAGE,
          maxPerPage: MANGA_DETAIL_CHAPTERS_PER_PAGE,
          totalCount: chapterSummary && chapterSummary.count ? Number(chapterSummary.count) : 0
        });
        shouldNoIndexMangaDetail = chapterPagination.page > 1;

        const chapterRows = await dbAll(
          `
          SELECT
            c.id,
            c.number,
            c.title,
            c.pages,
            c.date,
            c.group_name,
            CASE
              WHEN COALESCE(c.password_hash, '') <> '' AND COALESCE(c.password_salt, '') <> '' THEN true
              ELSE false
            END AS has_password,
            COALESCE(c.is_oneshot, false) as is_oneshot,
            COALESCE(v.view_count, 0) as view_count
          FROM chapters c
          LEFT JOIN chapter_view_stats v ON v.chapter_id = c.id
          WHERE c.manga_id = ?
          ORDER BY c.number DESC
          LIMIT ? OFFSET ?
        `,
          [mangaRow.id, chapterPagination.perPage, chapterPagination.offset]
        );
        chapters = chapterRows.map((chapter) => ({
          ...chapter,
          has_password: toBooleanFlag(chapter && chapter.has_password),
          is_oneshot: toBooleanFlag(chapter && chapter.is_oneshot),
          view_count: toSafeChapterViewCount(chapter && chapter.view_count)
        }));
        latestChapterNumber = chapterSummary && chapterSummary.latest_number != null
          ? formatChapterNumberValue(chapterSummary.latest_number)
          : "";
        firstChapterNumber = chapterSummary && chapterSummary.first_number != null
          ? formatChapterNumberValue(chapterSummary.first_number)
          : "";
        latestChapterForSeoText = latestChapterNumber || "?";
        mangaSeoTitle = `${mangaRow.title} [Tới Chap ${latestChapterForSeoText}]`;
        mappedManga = {
          ...mapMangaRow(mangaRow),
          isAdult: shouldExposeAdultMarker(mangaRow)
        };
        const bookmarkCountByMangaId = await resolveBookmarkUserCountByMangaId([mangaRow.id]);
        mangaBookmarkCount = Number(bookmarkCountByMangaId.get(Math.floor(Number(mangaRow.id)))) || 0;
        groupTeamLinks = await listMangaGroupTeamLinksByMangaId(mangaRow.id);
        mangaTotalViews = toSafeChapterViewCount(chapterSummary && chapterSummary.total_views);

        await writeEndpointCache(
          mangaDetailEndpointCacheKey,
          {
            chapterPagination,
            shouldNoIndexMangaDetail,
            chapters,
            latestChapterNumber,
            firstChapterNumber,
            latestChapterForSeoText,
            mangaSeoTitle,
            mappedManga,
            mangaBookmarkCount,
            groupTeamLinks,
            mangaTotalViews
          },
          ENDPOINT_CACHE_MANGA_DETAIL_TTL_SECONDS
        );
      }

      if (isAdultMangaBlockedForRequest(req, mangaRow)) {
        return renderNotFoundPage(req, res);
      }

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

      const commentsLoadUrl = `/manga/${encodeURIComponent(mangaRow.slug)}?comments=1`;
      const authUserId =
        req && req.session && req.session.authUserId
          ? String(req.session.authUserId).trim()
          : "";
      const commentComposerEnabled = Boolean(authUserId);
      let mangaBookmarked = false;
      if (authUserId) {
        const bookmarkRow = await dbGet(
          `
          SELECT 1 as ok
          FROM manga_bookmark_list_items li
          JOIN manga_bookmark_lists l ON l.id = li.list_id
          WHERE l.user_id = ?
            AND li.manga_id = ?
          LIMIT 1
        `,
          [authUserId, mangaRow.id]
        );
        mangaBookmarked = Boolean(bookmarkRow && bookmarkRow.ok);
      }
      const mangaDescription = normalizeSeoText(
        `Đọc truyện tranh ${mangaRow.title} sớm nhất với bản đẹp chất lượng sắc nét chỉ có ở ${SEO_SITE_NAME} - Chương truyện mới nhất là chương ${latestChapterForSeoText}, được cập nhật liên tục.`,
        190
      );
      const canonicalPath = `/manga/${encodeURIComponent(mangaRow.slug)}`;
      const ampPath = `/amp/manga/${encodeURIComponent(mangaRow.slug)}`;
      const mangaKeywords = buildSeoKeywordList([
        SEO_TRENDING_KEYWORDS,
        mangaRow.title,
        `đọc truyện tranh ${mangaRow.title}`,
        splitSeoNameTokens(mangaRow.author || ""),
        splitSeoNameTokens(mangaRow.group_name || ""),
        Array.isArray(mappedManga.genres) ? mappedManga.genres : [],
        mappedManga.status || ""
      ]);
      const mangaSchemas = shouldNoIndexMangaDetail
        ? []
        : compactJsonLdList([
          buildOrganizationSchema(req),
          buildWebsiteSchema(req),
          buildCollectionPageSchema(req, {
            path: canonicalPath,
            name: mangaSeoTitle,
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
        headScripts: {
          bookmarks: true
        },
        manga: {
          ...mappedManga,
          bookmarkCount: mangaBookmarkCount,
          bookmark_count: mangaBookmarkCount,
          chapters,
          latestChapterNumber,
          firstChapterNumber,
          groupTeamLinks,
          totalViews: mangaTotalViews
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
          title: mangaSeoTitle,
          titleAbsolute: true,
          description: mangaDescription,
          keywords: mangaKeywords,
          canonicalPath,
          robots: shouldNoIndexMangaDetail ? SEO_ROBOTS_NOINDEX : SEO_ROBOTS_INDEX,
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
      res.vary("Cookie");
      const mangaResolution = await resolveMangaRowByRouteSlug(req.params.slug);
      let mangaRow = mangaResolution.mangaRow;

      if (!mangaRow) {
        return renderNotFoundPage(req, res);
      }

      if (isAdultMangaBlockedForRequest(req, mangaRow)) {
        return renderNotFoundPage(req, res);
      }

      const canonicalAmpPath = `/amp/manga/${encodeURIComponent(mangaRow.slug)}`;
      if (mangaResolution.matchedBy !== "slug") {
        return res.redirect(301, canonicalAmpPath);
      }

      const chapterRows = await dbAll(
        `
        SELECT
          number,
          title,
          pages,
          date,
          group_name,
          CASE
            WHEN COALESCE(password_hash, '') <> '' AND COALESCE(password_salt, '') <> '' THEN true
            ELSE false
          END AS has_password,
          COALESCE(is_oneshot, false) as is_oneshot
        FROM chapters
        WHERE manga_id = ?
        ORDER BY number DESC
      `,
        [mangaRow.id]
      );
      const chapters = chapterRows.map((chapter) => ({
        ...chapter,
        has_password: toBooleanFlag(chapter && chapter.has_password),
        is_oneshot: toBooleanFlag(chapter && chapter.is_oneshot)
      }));
      const latestChapterNumber =
        chapters.length && chapters[0] && chapters[0].number != null
          ? formatChapterNumberValue(chapters[0].number)
          : "";
      const latestChapterForSeoText = latestChapterNumber || "?";
      const mangaSeoTitle = `${mangaRow.title} [Tới Chap ${latestChapterForSeoText}]`;

      const mappedManga = {
        ...mapMangaRow(mangaRow),
        isAdult: shouldExposeAdultMarker(mangaRow)
      };
      const groupTeamLinks = await listGroupTeamLinks(mangaRow.group_name || "");
      const canonicalPath = `/manga/${encodeURIComponent(mangaRow.slug)}`;
      const mangaDescription = normalizeSeoText(
        `Đọc truyện tranh ${mangaRow.title} sớm nhất với bản đẹp chất lượng sắc nét chỉ có ở ${SEO_SITE_NAME} - Chương truyện mới nhất là chương ${latestChapterForSeoText}, được cập nhật liên tục.`,
        190
      );
      const mangaKeywords = buildSeoKeywordList([
        SEO_TRENDING_KEYWORDS,
        mangaRow.title,
        `đọc truyện tranh ${mangaRow.title}`,
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
          name: mangaSeoTitle,
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
          chapterCount: chapters.length
        })
      ]);
      const seo = buildSeoPayload(req, {
        title: mangaSeoTitle,
        titleAbsolute: true,
        description: mangaDescription,
        keywords: mangaKeywords,
        canonicalPath,
        image: mappedManga.cover || "",
        ogType: "article",
        jsonLd: mangaSchemas
      });

      return res.render("manga-detail-amp", {
        title: mangaRow.title,
        team,
        manga: {
          ...mappedManga,
          chapters,
          groupTeamLinks
        },
        canonicalUrl: seo.canonical,
        webUrl: seo.canonical,
        seo,
        ampSchemas: mangaSchemas
      });
    })
  );

  app.get(
    "/manga/:slug/chapters/:number/processing-status",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).json({ ok: false, error: "Yêu cầu JSON." });
      }

      const chapterNumber = Number(req.params.number);
      if (!Number.isFinite(chapterNumber)) {
        return res.status(400).json({ ok: false, error: "Số chương không hợp lệ." });
      }

      const mangaResolution = await resolveMangaRowByRouteSlug(req.params.slug);
      const mangaRow = mangaResolution.mangaRow;
      if (!mangaRow || isAdultMangaBlockedForRequest(req, mangaRow)) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
      }

      const loadChapterProcessingRow = async () =>
        dbGet(
          `
          SELECT
            c.id,
            c.pages,
            c.pages_prefix,
            c.pages_ext,
            c.processing_state,
            c.processing_error,
            c.processing_done_pages,
            c.processing_total_pages
          FROM chapters c
          WHERE c.manga_id = ? AND c.number = ?
          LIMIT 1
        `,
          [mangaRow.id, chapterNumber]
        );

      let chapterRow = await loadChapterProcessingRow();

      if (!chapterRow || !chapterRow.id) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
      }

      const maybeProcessingState = (chapterRow.processing_state || "").toString().trim();
      if (maybeProcessingState === "processing") {
        const reconciled = await reconcileStaleChapterProcessingById(chapterRow.id);
        if (reconciled) {
          chapterRow = await loadChapterProcessingRow();
          if (!chapterRow || !chapterRow.id) {
            return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
          }
        }
      }

      const processingState = (chapterRow.processing_state || "").toString().trim();
      const processingError = (chapterRow.processing_error || "").toString().trim();
      const doneRaw = Number(chapterRow.processing_done_pages);
      const totalRaw = Number(chapterRow.processing_total_pages);
      const fallbackTotalRaw = Number(chapterRow.pages);
      const processingDonePages = Number.isFinite(doneRaw) && doneRaw >= 0 ? Math.floor(doneRaw) : 0;
      const processingTotalPages =
        Number.isFinite(totalRaw) && totalRaw > 0
          ? Math.floor(totalRaw)
          : Number.isFinite(fallbackTotalRaw) && fallbackTotalRaw > 0
            ? Math.floor(fallbackTotalRaw)
            : 0;
      const processingPercent =
        processingTotalPages > 0
          ? Math.min(
            100,
            Math.max(
              0,
              Math.floor((Math.min(processingDonePages, processingTotalPages) / processingTotalPages) * 100)
            )
          )
          : 0;

      const status =
        processingState === "processing"
          ? "processing"
          : processingState === "failed"
            ? "failed"
            : "done";

      return res.json({
        ok: true,
        status,
        ready: status === "done",
        processingState,
        processingError,
        processingDonePages,
        processingTotalPages,
        processingPercent
      });
    })
  );

  app.get(
    "/manga/:slug/chapters/:number",
    asyncHandler(async (req, res) => {
      res.vary("Cookie");
      await ensureChapterViewSchemaReady();
      const chapterNumber = Number(req.params.number);
      if (!Number.isFinite(chapterNumber)) {
        return renderNotFoundPage(req, res);
      }

      const mangaResolution = await resolveMangaRowByRouteSlug(req.params.slug);
      let mangaRow = mangaResolution.mangaRow;
      if (!mangaRow) {
        return renderNotFoundPage(req, res);
      }

      if (mangaResolution.matchedBy !== "slug") {
        return res.redirect(301, `/manga/${encodeURIComponent(mangaRow.slug)}/chapters/${encodeURIComponent(String(chapterNumber))}`);
      }

      const chapterDetailEndpointCacheContext = {
        slug: mangaRow.slug,
        chapterNumber
      };
      const chapterDetailCacheKey = buildChapterDetailEndpointCacheKey(chapterDetailEndpointCacheContext);
      const chapterDetailEndpointCache = await readEndpointCache(chapterDetailCacheKey);
      const chapterDetailEndpointCacheKey = chapterDetailEndpointCache.key;
      const cachedChapterDetailPayload = chapterDetailEndpointCache.value;

      let chapterRow = null;
      let chapterListRows = [];
      if (
        cachedChapterDetailPayload
        && cachedChapterDetailPayload.chapterRow
        && typeof cachedChapterDetailPayload.chapterRow === "object"
        && Array.isArray(cachedChapterDetailPayload.chapterListRows)
      ) {
        chapterRow = cachedChapterDetailPayload.chapterRow;
        chapterListRows = cachedChapterDetailPayload.chapterListRows;
      } else {
        chapterRow = await dbGet(
          `
          SELECT
            c.id,
            c.number,
            c.title,
            c.pages,
            c.date,
            c.pages_prefix,
            c.pages_file_prefix,
            c.pages_ext,
            c.pages_updated_at,
            c.processing_state,
            c.processing_error,
            c.processing_done_pages,
            c.processing_total_pages,
            c.password_hash,
            c.password_salt,
            c.password_updated_at,
            COALESCE(c.is_oneshot, false) as is_oneshot,
            COALESCE(v.view_count, 0) as view_count
          FROM chapters c
          LEFT JOIN chapter_view_stats v ON v.chapter_id = c.id
          WHERE c.manga_id = ? AND c.number = ?
        `,
          [mangaRow.id, chapterNumber]
        );

        if (!chapterRow) {
          return renderNotFoundPage(req, res);
        }

        chapterListRows = await dbAll(
          "SELECT number, title, COALESCE(is_oneshot, false) as is_oneshot FROM chapters WHERE manga_id = ? ORDER BY number DESC",
          [mangaRow.id]
        );

        await writeEndpointCache(
          chapterDetailEndpointCacheKey,
          {
            chapterRow,
            chapterListRows
          },
          ENDPOINT_CACHE_CHAPTER_DETAIL_TTL_SECONDS
        );
      }

      if (!chapterRow) {
        return renderNotFoundPage(req, res);
      }

      if (isAdultMangaBlockedForRequest(req, mangaRow)) {
        return renderNotFoundPage(req, res);
      }

      const unlockQuery = (req.query && req.query.unlock ? String(req.query.unlock) : "").trim().toLowerCase();
      const chapterIsLocked = chapterHasPasswordProtection(chapterRow);
      const chapterUnlocked = isChapterUnlockedForSession({
        req,
        chapterRow,
        nowMs: Date.now()
      });
      const requiresChapterPassword = chapterIsLocked && !chapterUnlocked;
      let chapterUnlockRetryAfterMs = 0;
      if (requiresChapterPassword) {
        const unlockAttemptKey = buildChapterUnlockAttemptKey({
          req,
          chapterId: chapterRow.id
        });
        const unlockThrottleState = getChapterUnlockThrottleState({
          attemptKey: unlockAttemptKey,
          nowMs: Date.now()
        });
        chapterUnlockRetryAfterMs = unlockThrottleState.blocked ? unlockThrottleState.retryAfterMs : 0;
      }
      const chapterUnlockError =
        requiresChapterPassword && chapterUnlockRetryAfterMs > 0
          ? formatUnlockThrottleMessage(chapterUnlockRetryAfterMs)
          : requiresChapterPassword && unlockQuery === "failed"
            ? "Mật khẩu chương không chính xác. Vui lòng thử lại."
            : requiresChapterPassword && unlockQuery === "throttled"
              ? "Bạn đã thử sai quá nhiều lần. Vui lòng chờ một lúc rồi thử lại."
              : "";

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
      const nowMs = Date.now();
      let chapterViewTrackToken = "";
      if (!requiresChapterPassword) {
        const chapterSessionMap = readChapterViewSessionMap(
          req && req.session ? req.session[CHAPTER_VIEW_SESSION_KEY] : null,
          nowMs
        );
        const chapterSessionKey = String(toSafeTimestampMs(chapterRow.id));
        const existingChapterSession = chapterSessionMap[chapterSessionKey];
        const hasExistingStartedAt =
          existingChapterSession && toSafeTimestampMs(existingChapterSession.startedAt) > 0;
        const startedAt = hasExistingStartedAt
          ? toSafeTimestampMs(existingChapterSession.startedAt)
          : nowMs;
        const nonce =
          existingChapterSession && existingChapterSession.nonce
            ? String(existingChapterSession.nonce).trim().toLowerCase()
            : crypto.randomBytes(18).toString("hex");
        const countedAt =
          existingChapterSession && toSafeTimestampMs(existingChapterSession.countedAt) > 0
            ? toSafeTimestampMs(existingChapterSession.countedAt)
            : 0;
        chapterSessionMap[chapterSessionKey] = {
          startedAt,
          nonce,
          countedAt
        };
        if (req && req.session) {
          req.session[CHAPTER_VIEW_SESSION_KEY] = readChapterViewSessionMap(chapterSessionMap, nowMs);
        }
        chapterViewTrackToken = buildChapterViewTrackToken({
          chapterId: chapterRow.id,
          startedAt,
          nonce
        });
      }

      const cdnBaseUrl = getB2Config().cdnBaseUrl;
      const processingState = (chapterRow.processing_state || "").toString().trim();
      const processingDonePagesRaw = Number(chapterRow.processing_done_pages);
      const processingTotalPagesRaw = Number(chapterRow.processing_total_pages);
      const processingDonePages =
        Number.isFinite(processingDonePagesRaw) && processingDonePagesRaw >= 0
          ? Math.floor(processingDonePagesRaw)
          : 0;
      const processingTotalPages =
        Number.isFinite(processingTotalPagesRaw) && processingTotalPagesRaw > 0
          ? Math.floor(processingTotalPagesRaw)
          : 0;
      const processingPercent = processingTotalPages
        ? Math.min(100, Math.max(0, Math.floor((Math.min(processingDonePages, processingTotalPages) / processingTotalPages) * 100)))
        : 0;
      const isProcessing = processingState === "processing";
      const canRenderPages = Boolean(
        !requiresChapterPassword && !isProcessing && cdnBaseUrl && chapterRow.pages_prefix && chapterRow.pages_ext
      );
      const padLength = Math.max(3, String(pageCount).length);
      const pageUrls = canRenderPages
        ? pages.map((page) => {
          const pageFileName = buildChapterPageAssetFileName({
            pageNumber: page,
            padLength,
            pagesExt: chapterRow.pages_ext,
            pageFilePrefix: chapterRow.pages_file_prefix
          });
          if (!pageFileName) return "";
          const rawUrl = `${cdnBaseUrl}/${chapterRow.pages_prefix}/${pageFileName}`;
          return cacheBust(rawUrl, chapterRow.pages_updated_at);
        }).filter(Boolean)
        : [];

      let nextChapterPrefetchUrls = [];
      if (!requiresChapterPassword && nextChapter && cdnBaseUrl) {
        const nextChapterNumber = Number(nextChapter.number);
        if (Number.isFinite(nextChapterNumber)) {
          const nextChapterRow = await dbGet(
            `
            SELECT
              pages,
              pages_prefix,
              pages_file_prefix,
              pages_ext,
              pages_updated_at,
              processing_state,
              password_hash,
              password_salt
            FROM chapters
            WHERE manga_id = ? AND number = ?
          `,
            [mangaRow.id, nextChapterNumber]
          );

          const nextProcessingState =
            nextChapterRow && nextChapterRow.processing_state
              ? String(nextChapterRow.processing_state).trim()
              : "";
          const canPrefetchNextChapter = Boolean(
            nextChapterRow &&
            nextProcessingState !== "processing" &&
            !chapterHasPasswordProtection(nextChapterRow) &&
            nextChapterRow.pages_prefix &&
            nextChapterRow.pages_ext
          );

          if (canPrefetchNextChapter) {
            const nextPageCount = Math.max(Number(nextChapterRow.pages) || 0, 0);
            const prefetchCount = Math.min(3, nextPageCount);
            const nextPadLength = Math.max(3, String(nextPageCount).length);

            nextChapterPrefetchUrls = Array.from({ length: prefetchCount }, (_, idx) => {
              const page = idx + 1;
              const pageFileName = buildChapterPageAssetFileName({
                pageNumber: page,
                padLength: nextPadLength,
                pagesExt: nextChapterRow.pages_ext,
                pageFilePrefix: nextChapterRow.pages_file_prefix
              });
              if (!pageFileName) return "";
              const rawUrl = `${cdnBaseUrl}/${nextChapterRow.pages_prefix}/${pageFileName}`;
              return cacheBust(rawUrl, nextChapterRow.pages_updated_at);
            }).filter(Boolean);
          }
        }
      }

      const commentPageRaw = Number(req.query.commentPage);
      const commentPage =
        Number.isFinite(commentPageRaw) && commentPageRaw > 0 ? Math.floor(commentPageRaw) : 1;
      const shouldNoIndexChapterDetail = commentPage > 1;

      let commentData = {
        comments: [],
        count: 0,
        pagination: {
          page: 1,
          perPage: 10,
          totalPages: 1,
          totalTopLevel: 0,
          hasPrev: false,
          hasNext: false,
          prevPage: 1,
          nextPage: 1
        }
      };
      if (!requiresChapterPassword) {
        commentData = await getPaginatedCommentTree({
          mangaId: mangaRow.id,
          chapterNumber: isOneshotChapter ? null : chapterNumber,
          page: commentPage,
          perPage: 10,
          session: req.session
        });
      }
      const authUserId =
        req && req.session && req.session.authUserId
          ? String(req.session.authUserId).trim()
          : "";
      const commentComposerEnabled = !requiresChapterPassword && Boolean(authUserId);
      let commentDeleteByTeamMember = false;
      if (!requiresChapterPassword && authUserId) {
        try {
          commentDeleteByTeamMember = await canDeleteMangaCommentsByTeamMember({
            userId: authUserId,
            mangaId: mangaRow.id
          });
        } catch (error) {
          console.warn("Failed to resolve team-based comment delete permission", error);
        }
      }

      const mappedManga = {
        ...mapMangaRow(mangaRow),
        isAdult: shouldExposeAdultMarker(mangaRow)
      };
      const chapterTitle = (chapterRow.title || "").toString().trim();
      const chapterSeoNumber = formatChapterNumberValue(chapterRow.number);
      const chapterSeoTitle = `${mangaRow.title} Chap ${chapterSeoNumber} - ${SEO_SITE_NAME}`;
      const chapterBaseLabel = isOneshotChapter ? "Oneshot" : `Chương ${chapterRow.number}`;
      const chapterLabel = chapterTitle ? `${chapterBaseLabel} - ${chapterTitle}` : chapterBaseLabel;
      const chapterDescription = normalizeSeoText(
        `Đọc ${mangaRow.title} online chương ${chapterSeoNumber} chỉ có tại ${SEO_SITE_NAME}, cập nhật nhanh chóng với chất lượng cao nhất.`,
        190
      );
      const mangaCanonicalPath = `/manga/${encodeURIComponent(mangaRow.slug)}`;
      const chapterPath = `/manga/${encodeURIComponent(mangaRow.slug)}/chapters/${encodeURIComponent(
        String(chapterRow.number)
      )}`;
      const chapterKeywords = buildSeoKeywordList([
        SEO_TRENDING_KEYWORDS,
        mangaRow.title,
        chapterLabel,
        `đọc truyện tranh ${mangaRow.title}`,
        `đọc ${chapterLabel} ${mangaRow.title}`,
        splitSeoNameTokens(mangaRow.author || ""),
        Array.isArray(mappedManga.genres) ? mappedManga.genres : []
      ]);
      const chapterSchemas = shouldNoIndexChapterDetail
        ? []
        : compactJsonLdList([
          buildOrganizationSchema(req),
          buildWebsiteSchema(req),
          buildCollectionPageSchema(req, {
            path: chapterPath,
            name: chapterSeoTitle,
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
            description: normalizeSeoText(mappedManga.description || `Đọc truyện tranh ${mangaRow.title}.`, 180),
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
          is_oneshot: isOneshotChapter,
          view_count: toSafeChapterViewCount(chapterRow && chapterRow.view_count),
          processing_done_pages: processingDonePages,
          processing_total_pages: processingTotalPages,
          processing_percent: processingPercent
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
        commentDeleteByTeamMember,
        chapterViewTrackToken,
        chapterLocked: requiresChapterPassword,
        chapterUnlockError,
        chapterUnlockRetryAfterMs,
        chapterUnlockPath: `${chapterPath}/unlock`,
        chapterProcessingStatusPath: `${chapterPath}/processing-status`,
        chapterPasswordMinLength: CHAPTER_PASSWORD_MIN_LENGTH,
        chapterPasswordMaxLength: CHAPTER_PASSWORD_MAX_LENGTH,
        seo: buildSeoPayload(req, {
          title: chapterSeoTitle,
          titleAbsolute: true,
          description: chapterDescription,
          keywords: chapterKeywords,
          canonicalPath: chapterPath,
          robots: shouldNoIndexChapterDetail ? SEO_ROBOTS_NOINDEX : SEO_ROBOTS_INDEX,
          image: mappedManga.cover || "",
          ogType: "article",
          jsonLd: chapterSchemas
        })
      });
    })
  );

  app.post(
    "/manga/:slug/chapters/:number/unlock",
    asyncHandler(async (req, res) => {
      const chapterNumber = Number(req.params.number);
      if (!Number.isFinite(chapterNumber)) {
        if (wantsJson(req)) {
          return res.status(400).json({ ok: false, error: "Số chương không hợp lệ." });
        }
        return res.status(404).render("not-found", {
          title: "Không tìm thấy",
          team,
          seo: buildSeoPayload(req, {
            title: "Không tìm thấy",
            description: siteNotFoundDescription,
            robots: SEO_ROBOTS_NOINDEX,
            canonicalPath: ensureLeadingSlash(req.path || "/")
          })
        });
      }

      const mangaResolution = await resolveMangaRowByRouteSlug(req.params.slug);
      const mangaRow = mangaResolution.mangaRow;
      if (!mangaRow) {
        if (wantsJson(req)) {
          return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
        }
        return res.status(404).render("not-found", {
          title: "Không tìm thấy",
          team,
          seo: buildSeoPayload(req, {
            title: "Không tìm thấy",
            description: siteNotFoundDescription,
            robots: SEO_ROBOTS_NOINDEX,
            canonicalPath: ensureLeadingSlash(req.path || "/")
          })
        });
      }

      if (isAdultMangaBlockedForRequest(req, mangaRow)) {
        if (wantsJson(req)) {
          return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
        }
        return renderNotFoundPage(req, res);
      }

      const chapterLookup = await dbGet(
        `
        SELECT
          c.id,
          c.number,
          c.password_hash,
          c.password_salt,
          c.password_updated_at,
          m.id AS manga_id,
          m.slug,
          ${MANGA_HAS_ADULT_GENRE_SQL} AS is_adult
        FROM chapters c
        JOIN manga m ON m.id = c.manga_id
        WHERE m.id = ?
          AND COALESCE(m.is_hidden, 0) = 0
          AND c.number = ?
        LIMIT 1
      `,
        [mangaRow.id, chapterNumber]
      );

      if (!chapterLookup || !chapterLookup.id) {
        if (wantsJson(req)) {
          return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
        }
        return res.status(404).render("not-found", {
          title: "Không tìm thấy",
          team,
          seo: buildSeoPayload(req, {
            title: "Không tìm thấy",
            description: siteNotFoundDescription,
            robots: SEO_ROBOTS_NOINDEX,
            canonicalPath: ensureLeadingSlash(req.path || "/")
          })
        });
      }

      const chapterPath = `/manga/${encodeURIComponent(
        chapterLookup.slug
      )}/chapters/${encodeURIComponent(String(chapterLookup.number))}`;

      if (!chapterHasPasswordProtection(chapterLookup)) {
        if (wantsJson(req)) {
          return res.json({ ok: true, unlocked: true, redirectUrl: chapterPath });
        }
        return res.redirect(chapterPath);
      }

      const nowMs = Date.now();
      const attemptKey = buildChapterUnlockAttemptKey({
        req,
        chapterId: chapterLookup.id
      });
      const throttleState = getChapterUnlockThrottleState({
        attemptKey,
        nowMs
      });
      if (throttleState.blocked) {
        const throttleMessage = formatUnlockThrottleMessage(throttleState.retryAfterMs);
        const retryAfterSeconds = Math.max(1, Math.ceil(throttleState.retryAfterMs / 1000));
        if (wantsJson(req)) {
          res.set("Retry-After", String(retryAfterSeconds));
          return res.status(429).json({
            ok: false,
            error: throttleMessage,
            retryAfterMs: throttleState.retryAfterMs
          });
        }
        return res.redirect(`${chapterPath}?unlock=throttled`);
      }

      const passwordInput = normalizeChapterPasswordInput(req.body && req.body.chapter_password);
      if (!passwordInput) {
        if (wantsJson(req)) {
          return res.status(400).json({ ok: false, error: "Vui lòng nhập mật khẩu chương." });
        }
        return res.redirect(`${chapterPath}?unlock=failed`);
      }

      const verified = verifyChapterPasswordHash({
        passwordInput,
        passwordHash: chapterLookup.password_hash,
        passwordSalt: chapterLookup.password_salt
      });
      if (!verified) {
        const failureState = registerChapterUnlockFailure({
          attemptKey,
          nowMs: Date.now()
        });
        const shouldThrottle = failureState.retryAfterMs > 0;
        const failureMessage = shouldThrottle
          ? formatUnlockThrottleMessage(failureState.retryAfterMs)
          : "Mật khẩu chương không chính xác.";
        if (wantsJson(req)) {
          if (shouldThrottle) {
            const retryAfterSeconds = Math.max(1, Math.ceil(failureState.retryAfterMs / 1000));
            res.set("Retry-After", String(retryAfterSeconds));
          }
          return res.status(shouldThrottle ? 429 : 403).json({
            ok: false,
            error: failureMessage,
            retryAfterMs: shouldThrottle ? failureState.retryAfterMs : 0
          });
        }
        return res.redirect(shouldThrottle ? `${chapterPath}?unlock=throttled` : `${chapterPath}?unlock=failed`);
      }

      clearChapterUnlockFailures(attemptKey);
      markChapterUnlockedForSession({ req, chapterRow: chapterLookup, nowMs: Date.now() });
      if (wantsJson(req)) {
        return res.json({ ok: true, unlocked: true, redirectUrl: chapterPath });
      }
      return res.redirect(chapterPath);
    })
  );

  app.post(
    "/manga/:slug/chapters/:number/view",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).json({ ok: false, error: "Yêu cầu JSON." });
      }

      await ensureChapterViewSchemaReady();
      await ensureMangaDailyViewSchemaReady();

      const chapterNumber = Number(req.params.number);
      if (!Number.isFinite(chapterNumber)) {
        return res.status(400).json({ ok: false, error: "Số chương không hợp lệ." });
      }

      const mangaResolution = await resolveMangaRowByRouteSlug(req.params.slug);
      const mangaRow = mangaResolution.mangaRow;
      if (!mangaRow || isAdultMangaBlockedForRequest(req, mangaRow)) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
      }

      const chapterLookup = await dbGet(
        `
        SELECT
          c.id,
          c.manga_id,
          c.pages,
          c.password_hash,
          c.password_salt,
          c.password_updated_at,
          ${MANGA_HAS_ADULT_GENRE_SQL} AS is_adult,
          COALESCE(v.view_count, 0) as view_count
        FROM chapters c
        JOIN manga m ON m.id = c.manga_id
        LEFT JOIN chapter_view_stats v ON v.chapter_id = c.id
        WHERE m.id = ?
          AND COALESCE(m.is_hidden, 0) = 0
          AND c.number = ?
        LIMIT 1
      `,
        [mangaRow.id, chapterNumber]
      );

      if (!chapterLookup || !chapterLookup.id) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
      }

      if (isAdultMangaBlockedForRequest(req, chapterLookup)) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
      }

      if (!isChapterUnlockedForSession({ req, chapterRow: chapterLookup, nowMs: Date.now() })) {
        return res.status(403).json({ ok: false, error: "Chương này đang được khóa bằng mật khẩu." });
      }

      const trackToken = (req.body && req.body.trackToken ? String(req.body.trackToken).trim() : "");
      const parsedToken = parseChapterViewTrackToken(trackToken);
      if (!parsedToken || parsedToken.chapterId !== toSafeTimestampMs(chapterLookup.id)) {
        return res.status(403).json({ ok: false, error: "Yêu cầu xem không hợp lệ." });
      }

      const expectedSignature = crypto
        .createHmac("sha256", CHAPTER_VIEW_TOKEN_SECRET)
        .update(parsedToken.payload)
        .digest("hex");
      if (!safeStringEquals(parsedToken.signature, expectedSignature)) {
        return res.status(403).json({ ok: false, error: "Yêu cầu xem không hợp lệ." });
      }

      const now = Date.now();
      if (parsedToken.startedAt > now + 60 * 1000 || now - parsedToken.startedAt > CHAPTER_VIEW_TRACK_WINDOW_MS) {
        return res.status(403).json({ ok: false, error: "Yêu cầu xem đã hết hạn." });
      }

      const chapterSessionMap = readChapterViewSessionMap(
        req && req.session ? req.session[CHAPTER_VIEW_SESSION_KEY] : null,
        now
      );
      const chapterSessionKey = String(toSafeTimestampMs(chapterLookup.id));
      const sessionEntry = normalizeChapterViewSessionEntry(chapterSessionMap[chapterSessionKey]);
      if (!sessionEntry || sessionEntry.nonce !== parsedToken.nonce || sessionEntry.startedAt !== parsedToken.startedAt) {
        return res.status(403).json({ ok: false, error: "Yêu cầu xem không hợp lệ." });
      }

      const seenPagesRaw = Number(req.body && req.body.seenPages);
      const seenPages = Number.isFinite(seenPagesRaw) && seenPagesRaw > 0 ? Math.floor(seenPagesRaw) : 0;
      const seenSeconds = Math.max(0, Math.floor((now - sessionEntry.startedAt) / 1000));
      const requiredSeenPages = computeChapterViewThreshold(chapterLookup.pages);
      const currentViewCount = toSafeChapterViewCount(chapterLookup.view_count);

      if (sessionEntry.countedAt > 0) {
        return res.json({
          ok: true,
          counted: false,
          seenPages,
          seenSeconds,
          requiredSeenPages,
          viewCount: currentViewCount
        });
      }

      const hasReachedViewThreshold = seenSeconds >= requiredSeenPages;

      if (!hasReachedViewThreshold) {
        return res.json({
          ok: true,
          counted: false,
          seenPages,
          seenSeconds,
          requiredSeenPages,
          viewCount: currentViewCount
        });
      }

      const updatedRow = await dbGet(
        `
        INSERT INTO chapter_view_stats (chapter_id, view_count, updated_at)
        VALUES (?, 1, ?)
        ON CONFLICT (chapter_id)
        DO UPDATE SET
          view_count = chapter_view_stats.view_count + 1,
          updated_at = EXCLUDED.updated_at
        RETURNING view_count
      `,
        [chapterLookup.id, now]
      );

      const viewDate = toViewStatsDateString(now);
      await dbRun(
        `
        INSERT INTO manga_view_daily_stats (manga_id, view_date, view_count, updated_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT (manga_id, view_date)
        DO UPDATE SET
          view_count = manga_view_daily_stats.view_count + 1,
          updated_at = EXCLUDED.updated_at
      `,
        [chapterLookup.manga_id, viewDate, now]
      );

      chapterSessionMap[chapterSessionKey] = {
        ...sessionEntry,
        countedAt: now
      };
      if (req && req.session) {
        req.session[CHAPTER_VIEW_SESSION_KEY] = readChapterViewSessionMap(chapterSessionMap, now);
      }

      return res.json({
        ok: true,
        counted: true,
        seenPages,
        seenSeconds,
        requiredSeenPages,
        viewCount: toSafeChapterViewCount(updatedRow && updatedRow.view_count)
      });
    })
  );

  app.post(
    "/manga/:slug/chapters/:number/report",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).json({ ok: false, error: "Yêu cầu JSON." });
      }

      const chapterNumber = Number(req.params.number);
      if (!Number.isFinite(chapterNumber)) {
        return res.status(400).json({ ok: false, error: "Số chương không hợp lệ." });
      }

      const mangaResolution = await resolveMangaRowByRouteSlug(req.params.slug);
      const mangaRow = mangaResolution.mangaRow;
      if (!mangaRow || isAdultMangaBlockedForRequest(req, mangaRow)) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
      }

      const chapterRow = await dbGet(
        `
        SELECT
          c.id,
          c.number,
          c.password_hash,
          c.password_salt
        FROM chapters c
        WHERE c.manga_id = ?
          AND c.number = ?
        LIMIT 1
      `,
        [mangaRow.id, chapterNumber]
      );

      if (!chapterRow || !chapterRow.id) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chương." });
      }

      if (!isChapterUnlockedForSession({ req, chapterRow, nowMs: Date.now() })) {
        return res.status(403).json({ ok: false, error: "Vui lòng mở khóa chương trước khi gửi báo lỗi." });
      }

      const reasonInput = req.body && req.body.reason != null ? String(req.body.reason) : "";
      const reason = reasonInput.trim().toLowerCase();
      if (
        !reason
        || reason.length > CHAPTER_REPORT_REASON_MAX_LENGTH
        || !CHAPTER_REPORT_ALLOWED_REASONS.has(reason)
      ) {
        return res.status(400).json({ ok: false, error: "Lý do báo lỗi không hợp lệ." });
      }

      const noteInput = req.body && req.body.note != null ? String(req.body.note) : "";
      const note = noteInput.trim();
      if (note.length > CHAPTER_REPORT_NOTE_MAX_LENGTH) {
        return res.status(400).json({ ok: false, error: "Nội dung báo lỗi quá dài." });
      }

      const reporterUserId = req && req.session && req.session.authUserId
        ? String(req.session.authUserId).trim()
        : "";
      const reporterSessionId = req && req.sessionID ? String(req.sessionID).trim() : "";
      const now = Date.now();

      await dbRun(
        `
        INSERT INTO chapter_reports (
          manga_id,
          chapter_id,
          chapter_number,
          reporter_user_id,
          reporter_session_id,
          reason,
          note,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      `,
        [
          mangaRow.id,
          chapterRow.id,
          Number(chapterRow.number),
          reporterUserId || null,
          reporterSessionId || null,
          reason,
          note || null,
          now,
          now
        ]
      );

      return res.json({ ok: true });
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
        const titleByPostId = new Map();
        const applyForumPostTitleRows = (rows) => {
          const safeRows = Array.isArray(rows) ? rows : [];
          safeRows.forEach((row) => {
            const idValue = row && row.id != null ? Number(row.id) : 0;
            if (!Number.isFinite(idValue) || idValue <= 0) return;
            const parsed = parseForumPostValidationParts(row && row.content ? row.content : "");
            const title = parsed.titleText || `Bài viết #${Math.floor(idValue)}`;
            titleByPostId.set(Math.floor(idValue), title);
          });
        };

        const forumPlaceholders = postIds.map(() => "?").join(",");
        let forumRows = [];
        try {
          forumRows = await dbAll(
            `
            SELECT id, content
            FROM forum_posts
            WHERE parent_id IS NULL
              AND id IN (${forumPlaceholders})
          `,
            postIds
          );
        } catch (err) {
          console.warn("Failed to resolve forum post labels from forum_posts", err);
        }
        applyForumPostTitleRows(forumRows);

        const unresolvedPostIds = postIds.filter((postId) => !titleByPostId.has(postId));
        if (unresolvedPostIds.length) {
          const legacyPlaceholders = unresolvedPostIds.map(() => "?").join(",");
          const legacyRows = await dbAll(
            `
            SELECT id, content
            FROM comments
            WHERE parent_id IS NULL
              AND id IN (${legacyPlaceholders})
          `,
            unresolvedPostIds
          );
          applyForumPostTitleRows(legacyRows);
        }

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
    "/comments/upload-image",
    uploadCommentImage,
    asyncHandler(async (req, res) => {
      const user = await requireAuthUserForComments(req, res);
      if (!user) return;

      const authorUserId = String(user.id || "").trim();
      if (authorUserId) {
        try {
          const badgeContext = await getUserBadgeContext(authorUserId);
          if (!badgeContext.permissions || badgeContext.permissions.canComment === false) {
            return res.status(403).json({ ok: false, error: "Tài khoản của bạn hiện không có quyền tương tác." });
          }
        } catch (err) {
          console.warn("Failed to load user badge context", err);
        }
      }

      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      if (!commentImageUploadsEnabled) {
        return res.status(503).json({
          ok: false,
          error: "Tính năng gửi ảnh trong bình luận hiện đang tắt."
        });
      }

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ ok: false, error: "Không tìm thấy ảnh để tải lên." });
      }

      const uploaded = await uploadImageBufferToGoogleDrive({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
        prefix: "comments"
      });

      return res.json({
        ok: true,
        imageUrl: uploaded.imageUrl,
        fileId: uploaded.fileId || ""
      });
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
      const authorUsername = user && user.username ? String(user.username).trim().toLowerCase() : "";
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

      const contentRaw = await censorCommentContentByForbiddenWords(req.body.content);
      const content = (contentRaw == null ? "" : String(contentRaw)).trim();
      const imageUrl = readSafeUploadedImageUrl(req.body && req.body.imageUrl ? req.body.imageUrl : "");
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
      if (isForumRequest && hasInlineDataImage(content)) {
        const message = "Ảnh dán trực tiếp không được hỗ trợ. Vui lòng tải ảnh lên.";
        if (wantsJson(req)) {
          return res.status(400).json({ error: message });
        }
        return res.status(400).send(message);
      }
      const parentContext = await resolveCommentParentContext({
        parentIdInput: req.body.parent_id,
        commentScope,
        isForumRequest,
      });
      const parentId = parentContext.parentId;
      const interactionParentId = Number(parentContext.interactionParentId) > 0
        ? Math.floor(Number(parentContext.interactionParentId))
        : parentId;
      const parentAuthorUserId = parentContext.parentAuthorUserId;
      const rootCommentId = parentContext.rootCommentId;
      const canCreateAnnouncement = canCreateAnnouncementFromBadgeContext(badgeContext);

      const contentLimit = resolveCommentLengthLimit({
        req,
        parentId,
        commentRequestId,
      });

      if (imageUrl && !commentImageUploadsEnabled) {
        const message = "Tính năng gửi ảnh trong bình luận hiện đang tắt.";
        if (wantsJson(req)) {
          return res.status(503).json({ error: message });
        }
        return res.status(503).send(message);
      }

      if (!content && !imageUrl) {
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

          const plainLength = content ? normalizeForumTextLength(content) : 0;
          if (content && plainLength < FORUM_COMMENT_MIN_LENGTH) {
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

      if (content && content.length > contentLimit.maxLength) {
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

          const duplicateSignalContent = content || `[image]${imageUrl}`;
          await ensureCommentNotDuplicateRecently({
            userId: authorUserId,
            content: duplicateSignalContent,
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
              image_url,
              client_request_id,
              content,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                imageUrl || null,
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
            image_url,
            client_request_id,
            content,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            [
              mangaRow.id,
              commentScope.chapterNumber,
              parentId,
              author,
              authorUserId,
              authorEmail,
              authorAvatarUrl,
              imageUrl || null,
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

      let excludedMentionUserIds = [];
      try {
        const interactionNotificationResult = await createCommentInteractionNotifications({
          isForumRequest,
          parentId: interactionParentId,
          rootCommentId,
          parentAuthorUserId,
          authorUserId,
          mangaId: mangaRow.id,
          chapterNumber: commentScope.chapterNumber,
          commentId: result.lastID,
          content,
        });
        excludedMentionUserIds =
          interactionNotificationResult && Array.isArray(interactionNotificationResult.notifiedUserIds)
            ? interactionNotificationResult.notifiedUserIds
            : [];
      } catch (err) {
        console.warn("Failed to create comment interaction notifications", err);
      }

      if (!isForumRequest && !parentId) {
        try {
          await createTeamCommentNotifications({
            mangaId: mangaRow.id,
            chapterNumber: commentScope.chapterNumber,
            commentId: result.lastID,
            authorUserId,
            content,
          });
        } catch (err) {
          console.warn("Failed to create team comment notifications", err);
        }
      }

      try {
        await createMentionNotificationsForComment({
          mangaId: mangaRow.id,
          chapterNumber: commentScope.chapterNumber,
          commentId: result.lastID,
          content,
          authorUserId,
          rootCommentId: rootCommentId || undefined,
          isForumRequest,
          excludeUserIds: excludedMentionUserIds
        });
      } catch (err) {
        console.warn("Failed to create mention notifications", err);
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
            authorUsername,
            badges: badgeContext.badges,
            userColor: badgeContext.userColor,
            avatarUrl: authorAvatarUrl,
            content,
            imageUrl,
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
      const authorUsername = user && user.username ? String(user.username).trim().toLowerCase() : "";
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

      const contentRaw = await censorCommentContentByForbiddenWords(req.body.content);
      const content = (contentRaw == null ? "" : String(contentRaw)).trim();
      const imageUrl = readSafeUploadedImageUrl(req.body && req.body.imageUrl ? req.body.imageUrl : "");
      const commentRequestId = readCommentRequestId(req);
      if (!commentRequestId) {
        return sendCommentRequestIdInvalidResponse(req, res);
      }
      const isForumRequest = isForumCommentRequest(req, commentRequestId);
      if (isForumRequest && hasInlineDataImage(content)) {
        const message = "Ảnh dán trực tiếp không được hỗ trợ. Vui lòng tải ảnh lên.";
        if (wantsJson(req)) {
          return res.status(400).json({ error: message });
        }
        return res.status(400).send(message);
      }
      const parentContext = await resolveCommentParentContext({
        parentIdInput: req.body.parent_id,
        commentScope,
        isForumRequest,
      });
      const parentId = parentContext.parentId;
      const interactionParentId = Number(parentContext.interactionParentId) > 0
        ? Math.floor(Number(parentContext.interactionParentId))
        : parentId;
      const parentAuthorUserId = parentContext.parentAuthorUserId;
      const rootCommentId = parentContext.rootCommentId;
      const canCreateAnnouncement = canCreateAnnouncementFromBadgeContext(badgeContext);

      const contentLimit = resolveCommentLengthLimit({
        req,
        parentId,
        commentRequestId,
      });

      if (imageUrl && !commentImageUploadsEnabled) {
        const message = "Tính năng gửi ảnh trong bình luận hiện đang tắt.";
        if (wantsJson(req)) {
          return res.status(503).json({ error: message });
        }
        return res.status(503).send(message);
      }

      if (!content && !imageUrl) {
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

          const plainLength = content ? normalizeForumTextLength(content) : 0;
          if (content && plainLength < FORUM_COMMENT_MIN_LENGTH) {
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

      if (content && content.length > contentLimit.maxLength) {
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

          const duplicateSignalContent = content || `[image]${imageUrl}`;
          await ensureCommentNotDuplicateRecently({
            userId: authorUserId,
            content: duplicateSignalContent,
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
              image_url,
              client_request_id,
              content,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                imageUrl || null,
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
            image_url,
            client_request_id,
            content,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            [
              mangaRow.id,
              commentScope.chapterNumber,
              parentId,
              author,
              authorUserId,
              authorEmail,
              authorAvatarUrl,
              imageUrl || null,
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

      let excludedMentionUserIds = [];
      try {
        const interactionNotificationResult = await createCommentInteractionNotifications({
          isForumRequest,
          parentId: interactionParentId,
          rootCommentId,
          parentAuthorUserId,
          authorUserId,
          mangaId: mangaRow.id,
          chapterNumber: commentScope.chapterNumber,
          commentId: result.lastID,
          content,
        });
        excludedMentionUserIds =
          interactionNotificationResult && Array.isArray(interactionNotificationResult.notifiedUserIds)
            ? interactionNotificationResult.notifiedUserIds
            : [];
      } catch (err) {
        console.warn("Failed to create comment interaction notifications", err);
      }

      if (!isForumRequest && !parentId) {
        try {
          await createTeamCommentNotifications({
            mangaId: mangaRow.id,
            chapterNumber: commentScope.chapterNumber,
            commentId: result.lastID,
            authorUserId,
            content,
          });
        } catch (err) {
          console.warn("Failed to create team comment notifications", err);
        }
      }

      try {
        await createMentionNotificationsForComment({
          mangaId: mangaRow.id,
          chapterNumber: commentScope.chapterNumber,
          commentId: result.lastID,
          content,
          authorUserId,
          rootCommentId: rootCommentId || undefined,
          isForumRequest,
          excludeUserIds: excludedMentionUserIds
        });
      } catch (err) {
        console.warn("Failed to create mention notifications", err);
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
            authorUsername,
            badges: badgeContext.badges,
            userColor: badgeContext.userColor,
            avatarUrl: authorAvatarUrl,
            content,
            imageUrl,
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
