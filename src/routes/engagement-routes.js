const registerEngagementRoutes = (app, deps) => {
  const {
    b2DeleteFileVersions,
    COMMENT_MAX_LENGTH,
    FORUM_COMMENT_MAX_LENGTH,
    FORUM_POST_MAX_LENGTH,
    NOTIFICATION_STREAM_HEARTBEAT_MS,
    censorCommentContentByForbiddenWords,
    addNotificationStreamClient,
    asyncHandler,
    dbAll,
    dbGet,
    dbRun,
    deleteCommentCascade,
    ensureUserRowFromAuthUser,
    formatDate,
    getUnreadNotificationCount,
    getB2Config,
    getUserBadgeContext,
    getVisibleCommentCount,
    mapNotificationRow,
    normalizeAvatarUrl,
    normalizeProfileBio,
    normalizeProfileDiscord,
    normalizeProfileFacebook,
    publishNotificationStreamUpdate,
    removeNotificationStreamClient,
    requireAuthUserForComments,
    getPushNotificationPublicKey,
    upsertUserPushSubscription,
    removeUserPushSubscription,
    removeAllPushSubscriptionsForUser,
    isPushNotificationEnabled,
    sendPushNotificationToUser,
    resolveCommentPermalinkForNotification,
    resolveForumCommentPermalinkForNotification,
    wantsJson,
    withTransaction,
    writeNotificationStreamEvent,
  } = deps;

  const isTruthyFlag = (value) => {
    if (value === true || value === false) return value;
    if (typeof value === "number") return Number.isFinite(value) && value !== 0;
    const text = (value == null ? "" : String(value)).trim().toLowerCase();
    if (!text) return false;
    return text === "1" || text === "true" || text === "t" || text === "yes" || text === "y" || text === "on";
  };

  const toText = (value) => (value == null ? "" : String(value)).trim();

  const hasInlineDataImage = (value) => {
    const text = value == null ? "" : String(value);
    if (!text) return false;
    return /<img\b[^>]*\bsrc\s*=\s*["']\s*data:image\//i.test(text) || /data:image\/[a-z0-9.+-]+;base64,/i.test(text);
  };

  const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const safeDecodeUrlPath = (input) => {
    try {
      return decodeURIComponent(input || "");
    } catch (_err) {
      return String(input || "");
    }
  };

  const extractManagedForumKeyFromString = (value) => {
    const config = typeof getB2Config === "function" ? getB2Config() : null;
    const forumPrefix = toText(config && config.forumPrefix).replace(/^\/+/, "").replace(/\/+$/, "") || "forum";
    const chapterPrefix =
      toText(config && config.chapterPrefix).replace(/^\/+/, "").replace(/\/+$/, "") || "chapters";

    const decoded = safeDecodeUrlPath(toText(value));
    if (!decoded) return "";

    const patterns = [
      new RegExp(`(${escapeRegex(forumPrefix)}\\/(?:posts|tmp\\/posts)\\/[A-Za-z0-9._~!$&'()*+,;=:@\\/%-]+)`, "i"),
      new RegExp(
        `(${escapeRegex(chapterPrefix)}\\/(?:forum-posts|tmp\\/forum-posts)\\/[A-Za-z0-9._~!$&'()*+,;=:@\\/%-]+)`,
        "i"
      ),
    ];

    for (const pattern of patterns) {
      const match = decoded.match(pattern);
      if (!match || !match[1]) continue;
      const candidate = String(match[1])
        .replace(/[?#].*$/g, "")
        .replace(/[&"'<>\s]+$/g, "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      if (candidate) return candidate;
    }

    return "";
  };

  const extractForumManagedImageKeysFromContent = (content) => {
    const keys = new Set();
    String(content || "").replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, (_fullMatch, srcValue) => {
      const key = extractManagedForumKeyFromString(srcValue);
      if (key) {
        keys.add(key);
      }
      return "";
    });
    return Array.from(keys);
  };

  const getRemovedForumImageKeys = (beforeContent, nextContent) => {
    const previous = new Set(extractForumManagedImageKeysFromContent(beforeContent));
    if (!previous.size) return [];

    const current = new Set(extractForumManagedImageKeysFromContent(nextContent));
    return Array.from(previous).filter((key) => !current.has(key));
  };

  const normalizeRequestedForumImageKeys = (rawValues) => {
    const keys = new Set();
    const values = Array.isArray(rawValues) ? rawValues : [];
    values.forEach((value) => {
      const extracted = extractManagedForumKeyFromString(value);
      if (extracted) {
        keys.add(extracted);
      }
    });
    return Array.from(keys);
  };

  const deleteForumImageKeys = async (keys) => {
    const normalizedKeys = Array.from(
      new Set(
        (Array.isArray(keys) ? keys : [])
          .map((value) => toText(value))
          .filter(Boolean)
      )
    );
    if (!normalizedKeys.length) return 0;
    if (typeof b2DeleteFileVersions !== "function") return 0;

    return b2DeleteFileVersions(
      normalizedKeys.map((key) => ({
        fileName: key,
        fileId: key,
        versionId: "",
      }))
    );
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
    const slug = String(value == null ? "" : value)
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
      const payload = String(payloadText || "").trim();
      if (!payload) return "";

      const pairs = payload
        .split(";")
        .map((item) => String(item || "").trim())
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

  const COMMENT_TABLE_COMMENTS = "comments";
  const COMMENT_TABLE_FORUM = "forum_posts";
  const NOTIFICATION_TYPE_TEAM_MANGA_COMMENT = "team_manga_comment";

  const normalizeNotificationChannel = (value) => {
    const channel = (value || "").toString().trim().toLowerCase();
    if (channel === "team") return "team";
    return "default";
  };

  const buildNotificationChannelFilter = (channelInput, options = {}) => {
    const columnSql =
      options && typeof options.columnSql === "string" && options.columnSql.trim()
        ? options.columnSql.trim()
        : "type";
    const channel = normalizeNotificationChannel(channelInput);
    if (channel === "team") {
      return {
        channel,
        sql: `${columnSql} = ?`,
        params: [NOTIFICATION_TYPE_TEAM_MANGA_COMMENT]
      };
    }
    return {
      channel,
      sql: `${columnSql} IS DISTINCT FROM ?`,
      params: [NOTIFICATION_TYPE_TEAM_MANGA_COMMENT]
    };
  };

  const resolveCommentTableOrder = (preferForum = false) =>
    preferForum
      ? [COMMENT_TABLE_FORUM, COMMENT_TABLE_COMMENTS]
      : [COMMENT_TABLE_COMMENTS, COMMENT_TABLE_FORUM];

  const findCommentRowById = async ({ commentId, preferForum = false, requireVisible = false }) => {
    const numericId = Number(commentId);
    if (!Number.isFinite(numericId) || numericId <= 0) return null;

    const safeId = Math.floor(numericId);
    const visibilityClause = requireVisible ? " AND status = 'visible'" : "";

    for (const tableName of resolveCommentTableOrder(preferForum)) {
      const mangaContextColumns =
        tableName === COMMENT_TABLE_COMMENTS
          ? "manga_id, chapter_number"
          : "NULL AS manga_id, NULL AS chapter_number";

      const row = await dbGet(
        `
          SELECT
            id,
            ${mangaContextColumns},
            parent_id,
            author_user_id,
            author_email,
            status,
            content
          FROM ${tableName}
          WHERE id = ?${visibilityClause}
          LIMIT 1
        `,
        [safeId]
      );
      if (row) {
        return { ...row, _table: tableName };
      }
    }

    return null;
  };

  const buildTeamGroupNameListExpr = (columnSql) =>
    `replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(trim(COALESCE(${columnSql}, ''))), ' / ', ','), '/', ','), ' & ', ','), '&', ','), ' + ', ','), '+', ','), ';', ','), '|', ','), ' x ', ','), ', ', ','), ' ,', ',')`;

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

  const canDeleteMangaCommentByTeamMember = async ({ userId, mangaId }) => {
    const safeUserId = (userId || "").toString().trim();
    const numericMangaId = Number(mangaId);
    if (!safeUserId) return false;
    if (!Number.isFinite(numericMangaId) || numericMangaId <= 0) return false;

    const row = await dbGet(
      `
        SELECT 1 as ok
        FROM manga m
        JOIN translation_teams t ON t.status = 'approved'
        JOIN translation_team_members tm ON tm.team_id = t.id
        WHERE m.id = ?
          AND tm.user_id = ?
          AND tm.status = 'approved'
          AND COALESCE(m.group_name, '') <> ''
          AND ${TEAM_GROUP_NAME_MATCH_MANGA_TEAM_SQL}
        LIMIT 1
      `,
      [Math.floor(numericMangaId), safeUserId]
    );
    return Boolean(row && row.ok);
  };

  const parseMangaIdFromSlug = (slugInput) => {
    const text = (slugInput == null ? "" : String(slugInput)).trim();
    if (!text) return 0;
    const match = text.match(/^(\d+)(?:-|$)/);
    if (!match || !match[1]) return 0;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
  };

  const resolveMangaIdBySlug = async (slugInput) => {
    const requestedSlug = (slugInput == null ? "" : String(slugInput)).trim();
    if (!requestedSlug) return 0;

    const exactSlugRow = await dbGet("SELECT id FROM manga WHERE slug = ? LIMIT 1", [requestedSlug]);
    if (exactSlugRow && Number(exactSlugRow.id) > 0) {
      return Math.floor(Number(exactSlugRow.id));
    }

    const parsedMangaId = parseMangaIdFromSlug(requestedSlug);
    if (parsedMangaId > 0) {
      const idMatchedRow = await dbGet("SELECT id FROM manga WHERE id = ? LIMIT 1", [parsedMangaId]);
      if (idMatchedRow && Number(idMatchedRow.id) > 0) {
        return Math.floor(Number(idMatchedRow.id));
      }
    }

    const suffixRows = await dbAll("SELECT id FROM manga WHERE slug LIKE ? LIMIT 2", [`%-${requestedSlug}`]);
    if (suffixRows.length === 1 && Number(suffixRows[0].id) > 0) {
      return Math.floor(Number(suffixRows[0].id));
    }

    return 0;
  };

  app.get(
    "/notifications/push/public-key",
    asyncHandler(async (_req, res) => {
      const enabled = typeof isPushNotificationEnabled === "function" ? isPushNotificationEnabled() : false;
      const publicKey =
        typeof getPushNotificationPublicKey === "function" ? String(getPushNotificationPublicKey() || "").trim() : "";
      return res.json({
        ok: true,
        enabled: Boolean(enabled && publicKey),
        publicKey: enabled ? publicKey : ""
      });
    })
  );

  app.post(
    "/notifications/push/subscribe",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;
      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      if (typeof upsertUserPushSubscription !== "function") {
        return res.status(503).json({ ok: false, error: "Push notification chưa sẵn sàng trên máy chủ." });
      }

      const subscription = req && req.body && typeof req.body === "object" ? req.body.subscription : null;
      const userAgent = req && req.headers ? req.headers["user-agent"] : "";
      const result = await upsertUserPushSubscription({
        userId,
        subscription,
        userAgent
      });

      if (!result || result.ok !== true) {
        return res.status(400).json({
          ok: false,
          error: result && result.error ? result.error : "Không thể đăng ký push notification."
        });
      }

      return res.json({ ok: true, endpoint: result.endpoint || "" });
    })
  );

  app.post(
    "/notifications/push/unsubscribe",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;
      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      if (typeof removeUserPushSubscription !== "function") {
        return res.status(503).json({ ok: false, error: "Push notification chưa sẵn sàng trên máy chủ." });
      }

      const endpoint =
        req && req.body && typeof req.body === "object" && req.body.endpoint != null
          ? String(req.body.endpoint).trim()
          : "";
      if (!endpoint) {
        return res.status(400).json({ ok: false, error: "Thiếu endpoint đăng ký push." });
      }

      const removed = await removeUserPushSubscription({ userId, endpoint });
      return res.json({ ok: true, removed: Number(removed) || 0 });
    })
  );

  app.post(
    "/notifications/push/unsubscribe-all",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;
      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      if (typeof removeAllPushSubscriptionsForUser !== "function") {
        return res.status(503).json({ ok: false, error: "Push notification chưa sẵn sàng trên máy chủ." });
      }

      const removed = await removeAllPushSubscriptionsForUser({ userId });
      return res.json({ ok: true, removed: Number(removed) || 0 });
    })
  );

  app.post(
    "/notifications/push/test",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;
      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      if (typeof sendPushNotificationToUser !== "function") {
        return res.status(503).json({ ok: false, error: "Push notification chưa sẵn sàng trên máy chủ." });
      }

      if (typeof isPushNotificationEnabled === "function" && !isPushNotificationEnabled()) {
        return res.status(503).json({
          ok: false,
          error: "Máy chủ chưa bật Push Notification (thiếu cấu hình VAPID)."
        });
      }

      const sentAt = Date.now();
      const result = await sendPushNotificationToUser({
        userId,
        notification: {
          type: "push_test",
          title: "Test Push Notification",
          body: "Đây là thông báo test từ MoeTruyen.",
          tag: `push-test-${userId}-${sentAt}`,
          url: "/",
          data: {
            kind: "push_test",
            sentAt
          }
        }
      });

      const total = Number(result && result.total) || 0;
      const sent = Number(result && result.sent) || 0;
      const failed = Number(result && result.failed) || 0;
      const removed = Number(result && result.removed) || 0;

      if (total <= 0) {
        return res.status(400).json({
          ok: false,
          error: "Bạn chưa có đăng ký Push Notification trên thiết bị này.",
          result: { total, sent, failed, removed }
        });
      }

      if (sent <= 0) {
        return res.status(502).json({
          ok: false,
          error: "Không thể gửi push test. Vui lòng thử lại.",
          result: { total, sent, failed, removed }
        });
      }

      return res.json({
        ok: true,
        result: { total, sent, failed, removed }
      });
    })
  );

  app.get(
    "/comments/delete-capability",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;

      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      const numericMangaId = Number(req.query.mangaId);
      let mangaId = Number.isFinite(numericMangaId) && numericMangaId > 0 ? Math.floor(numericMangaId) : 0;

      if (!mangaId) {
        mangaId = await resolveMangaIdBySlug(req.query.mangaSlug);
      }

      if (!mangaId) {
        return res.json({ ok: true, canDeleteTeamManga: false });
      }

      let canDeleteTeamManga = false;
      try {
        canDeleteTeamManga = await canDeleteMangaCommentByTeamMember({ userId, mangaId });
      } catch (error) {
        console.warn("Failed to resolve delete capability for manga comments", error);
      }

      return res.json({
        ok: true,
        mangaId,
        canDeleteTeamManga: Boolean(canDeleteTeamManga)
      });
    })
  );

  app.get(
    "/comments/users/:id",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const userId = (req.params.id || "").toString().trim();
      if (!userId || userId.length > 128) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy người dùng." });
      }

      const profileRow = await dbGet(
        "SELECT id, username, display_name, avatar_url, facebook_url, discord_handle, bio, created_at FROM users WHERE id = ?",
        [userId]
      );

      const countRow = await dbGet(
        `
          SELECT
            COALESCE((SELECT COUNT(*) FROM comments WHERE author_user_id = ? AND status = 'visible'), 0)
            + COALESCE((SELECT COUNT(*) FROM forum_posts WHERE author_user_id = ? AND status = 'visible'), 0)
            AS count
        `,
        [userId, userId]
      );
      const commentCount = countRow ? Number(countRow.count) || 0 : 0;

      const fallbackCommentRow =
        !profileRow && commentCount > 0
          ? await dbGet(
            `
              SELECT author, author_avatar_url, created_at
              FROM (
                SELECT author, author_avatar_url, created_at, id
                FROM comments
                WHERE author_user_id = ? AND status = 'visible'

                UNION ALL

                SELECT author, author_avatar_url, created_at, id
                FROM forum_posts
                WHERE author_user_id = ? AND status = 'visible'
              ) recent
              ORDER BY created_at DESC, id DESC
              LIMIT 1
            `,
            [userId, userId]
          )
          : null;

      if (!profileRow && !fallbackCommentRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy người dùng." });
      }

      const username = profileRow && profileRow.username ? String(profileRow.username).trim() : "";
      const displayName =
        profileRow && profileRow.display_name ? String(profileRow.display_name).replace(/\s+/g, " ").trim() : "";
      const fallbackName =
        fallbackCommentRow && fallbackCommentRow.author
          ? String(fallbackCommentRow.author).replace(/\s+/g, " ").trim()
          : "";
      const name = displayName || fallbackName || (username ? `@${username}` : "Người dùng");

      const avatarUrl = normalizeAvatarUrl(
        (profileRow && profileRow.avatar_url) ||
        (fallbackCommentRow && fallbackCommentRow.author_avatar_url) ||
        ""
      );

      const joinedAtSource =
        (profileRow && profileRow.created_at != null && profileRow.created_at !== ""
          ? profileRow.created_at
          : null) ||
        (fallbackCommentRow && fallbackCommentRow.created_at != null && fallbackCommentRow.created_at !== ""
          ? fallbackCommentRow.created_at
          : null);
      const joinedAtNumeric = Number(joinedAtSource);
      const joinedAtValue = Number.isFinite(joinedAtNumeric) ? joinedAtNumeric : joinedAtSource;
      let joinedAtText = "";
      if (joinedAtValue) {
        const joinedDate = new Date(joinedAtValue);
        if (!Number.isNaN(joinedDate.getTime())) {
          joinedAtText = formatDate(joinedDate);
        }
      }

      const badgeContext = await getUserBadgeContext(userId);

      return res.json({
        ok: true,
        profile: {
          id: userId,
          name,
          avatarUrl,
          username,
          joinedAtText,
          commentCount,
          facebookUrl: normalizeProfileFacebook(profileRow && profileRow.facebook_url),
          discordUrl: normalizeProfileDiscord(profileRow && profileRow.discord_handle),
          bio: normalizeProfileBio(profileRow && profileRow.bio),
          badges: badgeContext.badges,
          userColor: badgeContext.userColor
        }
      });
    })
  );

  app.get(
    "/notifications/stream",
    asyncHandler(async (req, res) => {
      const user = await requireAuthUserForComments(req, res);
      if (!user) return;
      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).end();
      }

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      const clientId = addNotificationStreamClient(userId, res);
      const unreadCount = await getUnreadNotificationCount(userId, { channel: "default" });
      const teamUnreadCount = await getUnreadNotificationCount(userId, { channel: "team" });
      writeNotificationStreamEvent(res, "ready", { unreadCount, teamUnreadCount });

      const heartbeat = setInterval(() => {
        const ok = writeNotificationStreamEvent(res, "heartbeat", { ts: Date.now() });
        if (!ok) {
          cleanup();
        }
      }, NOTIFICATION_STREAM_HEARTBEAT_MS);
      if (heartbeat && typeof heartbeat.unref === "function") {
        heartbeat.unref();
      }

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeat);
        removeNotificationStreamClient(userId, clientId);
      };

      req.on("close", cleanup);
      req.on("aborted", cleanup);
      res.on("close", cleanup);
      res.on("finish", cleanup);
      res.on("error", cleanup);
    })
  );

  app.get(
    "/notifications",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;
      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 20;
      const channelFilter = buildNotificationChannelFilter(req.query.channel, { columnSql: "n.type" });

      const rows = await dbAll(
        `
          SELECT
            n.id,
            n.type,
            n.actor_user_id,
            n.manga_id,
            n.team_id,
            n.chapter_number,
            n.comment_id,
            n.content_preview,
            n.is_read,
            n.created_at,
            n.read_at,
            m.slug as manga_slug,
            m.title as manga_title,
            notify_team.name as notify_team_name,
            notify_team.slug as notify_team_slug,
            actor.username as actor_username,
            actor.display_name as actor_display_name,
            actor.avatar_url as actor_avatar_url,
            comment_row.client_request_id as comment_client_request_id,
            forum_comment_row.client_request_id as forum_comment_client_request_id
          FROM notifications n
          LEFT JOIN manga m ON m.id = n.manga_id
          LEFT JOIN translation_teams notify_team ON notify_team.id = n.team_id
          LEFT JOIN users actor ON actor.id = n.actor_user_id
          LEFT JOIN comments comment_row ON comment_row.id = n.comment_id
          LEFT JOIN forum_posts forum_comment_row ON forum_comment_row.id = n.comment_id
          WHERE n.user_id = ?
            AND ${channelFilter.sql}
          ORDER BY n.created_at DESC, n.id DESC
          LIMIT ?
        `,
        [userId, ...channelFilter.params, limit]
      );

      const permalinkPromiseByKey = new Map();
      const resolveNotificationCommentRequestId = (row, notificationType) => {
        const directCommentRequestId =
          row && row.comment_client_request_id != null
            ? String(row.comment_client_request_id).trim().toLowerCase()
            : "";
        const forumCommentRequestId =
          row && row.forum_comment_client_request_id != null
            ? String(row.forum_comment_client_request_id).trim().toLowerCase()
            : "";
        const preferForumRequestId =
          notificationType === "forum_post_comment" ||
          notificationType === "comment_reply" ||
          (notificationType === "mention" && row && row.manga_id == null && row.chapter_number == null);

        if (preferForumRequestId) {
          return forumCommentRequestId || directCommentRequestId;
        }
        return directCommentRequestId || forumCommentRequestId;
      };

      const getPermalinkForRow = (row) => {
        const notificationType = (row && row.type ? String(row.type) : "").trim().toLowerCase();
        const commentRequestId = resolveNotificationCommentRequestId(row, notificationType);
        const isForumCommentNotification = commentRequestId.startsWith("forum-");

        if (
          notificationType !== "mention" &&
          notificationType !== "forum_post_comment" &&
          notificationType !== "comment_reply" &&
          notificationType !== NOTIFICATION_TYPE_TEAM_MANGA_COMMENT
        ) {
          return Promise.resolve("");
        }

        if (
          notificationType === "forum_post_comment" ||
          ((notificationType === "mention" || notificationType === "comment_reply") && isForumCommentNotification)
        ) {
          const commentId = row && row.comment_id != null ? Number(row.comment_id) : NaN;
          const safeCommentId = Number.isFinite(commentId) && commentId > 0 ? Math.floor(commentId) : 0;
          if (!safeCommentId) {
            return Promise.resolve("/forum");
          }

          const key = `forum|${safeCommentId}`;
          if (!permalinkPromiseByKey.has(key)) {
            const resolver = resolveForumCommentPermalinkForNotification({ commentId: safeCommentId });
            permalinkPromiseByKey.set(key, resolver);
          }
          return permalinkPromiseByKey.get(key);
        }

        const chapterValue = row && row.chapter_number != null ? Number(row.chapter_number) : NaN;
        const hasChapter = Number.isFinite(chapterValue);
        const commentId = row && row.comment_id != null ? Number(row.comment_id) : NaN;
        const key = [
          row && row.manga_slug ? String(row.manga_slug).trim() : "",
          row && row.manga_id != null ? String(row.manga_id) : "",
          hasChapter ? String(chapterValue) : "",
          Number.isFinite(commentId) && commentId > 0 ? String(Math.floor(commentId)) : ""
        ].join("|");

        if (!permalinkPromiseByKey.has(key)) {
          const resolver = resolveCommentPermalinkForNotification({
            mangaSlug: row && row.manga_slug ? row.manga_slug : "",
            mangaId: row && row.manga_id != null ? row.manga_id : null,
            chapterNumber: hasChapter ? chapterValue : null,
            commentId: Number.isFinite(commentId) && commentId > 0 ? Math.floor(commentId) : null,
            perPage: 20
          });
          permalinkPromiseByKey.set(key, resolver);
        }

        return permalinkPromiseByKey.get(key);
      };

      const notifications = await Promise.all(
        rows.map(async (row) => {
          const resolvedUrl = await getPermalinkForRow(row);
          const notificationType = (row && row.type ? String(row.type) : "").trim().toLowerCase();
          const commentRequestId = resolveNotificationCommentRequestId(row, notificationType);
          const isForumCommentNotification = commentRequestId.startsWith("forum-");
          const hideContext =
            notificationType === "forum_post_comment" ||
            ((notificationType === "mention" || notificationType === "comment_reply") && isForumCommentNotification);

          return mapNotificationRow(row, {
            url: resolvedUrl,
            hideContext
          });
        })
      );

      const unreadCount = await getUnreadNotificationCount(userId, { channel: channelFilter.channel });
      const defaultUnreadCount = await getUnreadNotificationCount(userId, { channel: "default" });
      const teamUnreadCount = await getUnreadNotificationCount(userId, { channel: "team" });

      let moreUrl = "/publish";
      if (channelFilter.channel === "team") {
        const primaryTeamRow = await dbGet(
          `
            SELECT t.id, t.slug
            FROM translation_team_members tm
            JOIN translation_teams t ON t.id = tm.team_id
            WHERE tm.user_id = ?
              AND tm.status = 'approved'
              AND t.status = 'approved'
            ORDER BY CASE WHEN tm.role = 'leader' THEN 0 ELSE 1 END ASC, tm.reviewed_at DESC, tm.requested_at DESC
            LIMIT 1
          `,
          [userId]
        );
        const teamId = Number(primaryTeamRow && primaryTeamRow.id);
        const teamSlug = primaryTeamRow && primaryTeamRow.slug ? String(primaryTeamRow.slug).trim() : "";
        if (Number.isFinite(teamId) && teamId > 0 && teamSlug) {
          moreUrl = `/team/${encodeURIComponent(String(Math.floor(teamId)))}/${encodeURIComponent(teamSlug)}?tab=notifications`;
        }
      }

      return res.json({
        ok: true,
        channel: channelFilter.channel,
        unreadCount,
        defaultUnreadCount,
        teamUnreadCount,
        moreUrl,
        notifications
      });
    })
  );

  app.post(
    "/notifications/read-all",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;
      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }
      const channelFilter = buildNotificationChannelFilter(req.query.channel);

      const now = Date.now();
      const result = await dbRun(
        `
          UPDATE notifications
          SET is_read = true, read_at = ?
          WHERE user_id = ?
            AND is_read = false
            AND ${channelFilter.sql}
        `,
        [now, userId, ...channelFilter.params]
      );
      if (result && result.changes) {
        publishNotificationStreamUpdate({ userId, reason: "read_all" }).catch(() => null);
      }
      const unreadCount = await getUnreadNotificationCount(userId, { channel: channelFilter.channel });
      return res.json({
        ok: true,
        channel: channelFilter.channel,
        updated: result && result.changes ? result.changes : 0,
        unreadCount
      });
    })
  );

  app.post(
    "/notifications/:id/read",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const notificationId = Number(req.params.id);
      if (!Number.isFinite(notificationId) || notificationId <= 0) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy thông báo." });
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;
      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }
      const channelFilter = buildNotificationChannelFilter(req.query.channel);

      const now = Date.now();
      const result = await dbRun(
        `
          UPDATE notifications
          SET is_read = true, read_at = ?
          WHERE id = ?
            AND user_id = ?
            AND is_read = false
            AND ${channelFilter.sql}
        `,
        [now, Math.floor(notificationId), userId, ...channelFilter.params]
      );
      if (result && result.changes) {
        publishNotificationStreamUpdate({ userId, reason: "read_one" }).catch(() => null);
      }
      const unreadCount = await getUnreadNotificationCount(userId, { channel: channelFilter.channel });

      return res.json({
        ok: true,
        channel: channelFilter.channel,
        updated: result && result.changes ? result.changes : 0,
        unreadCount
      });
    })
  );

  app.post(
    "/comments/:id/edit",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const commentId = Number(req.params.id);
      if (!Number.isFinite(commentId) || commentId <= 0) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bình luận." });
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;
      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      const preferForumTable = isTruthyFlag(req && req.body ? req.body.forumMode : false);
      const commentRow = await findCommentRowById({
        commentId: Math.floor(commentId),
        preferForum: preferForumTable,
        requireVisible: true,
      });
      if (!commentRow || String(commentRow.status || "").trim() !== "visible") {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bình luận." });
      }
      const commentTable = commentRow._table === COMMENT_TABLE_FORUM ? COMMENT_TABLE_FORUM : COMMENT_TABLE_COMMENTS;
      const forumMode = preferForumTable || commentTable === COMMENT_TABLE_FORUM;

      const ownerId = commentRow.author_user_id ? String(commentRow.author_user_id).trim() : "";
      const isOwner = Boolean(ownerId && ownerId === userId);

      if (!isOwner) {
        return res.status(403).json({ ok: false, error: "Bạn không có quyền sửa bình luận này." });
      }

      let canCreateAnnouncement = false;
      try {
        await ensureUserRowFromAuthUser(user);
        const badgeContext = await getUserBadgeContext(userId);
        canCreateAnnouncement = canCreateAnnouncementFromBadgeContext(badgeContext);
      } catch (err) {
        console.warn("Failed to load moderation permissions", err);
      }

      const content = await censorCommentContentByForbiddenWords(req.body && req.body.content);
      if (!content) {
        return res.status(400).json({ ok: false, error: "Nội dung bình luận không được để trống." });
      }

      if (forumMode && hasInlineDataImage(content)) {
        return res.status(400).json({ ok: false, error: "Ảnh dán trực tiếp không được hỗ trợ. Vui lòng tải ảnh lên." });
      }

      let maxLength = COMMENT_MAX_LENGTH;
      let label = "Bình luận";
      if (forumMode) {
        const parentId = Number(commentRow.parent_id);
        const isReply = Number.isFinite(parentId) && parentId > 0;
        maxLength = isReply ? FORUM_COMMENT_MAX_LENGTH : FORUM_POST_MAX_LENGTH;
        label = isReply ? "Bình luận" : "Bài viết";
      }

      if (content.length > maxLength) {
        return res.status(400).json({ ok: false, error: `${label} tối đa ${maxLength} ký tự.` });
      }

      if (forumMode) {
        const parentId = Number(commentRow.parent_id);
        const isRootForumPost = !Number.isFinite(parentId) || parentId <= 0;
        if (isRootForumPost) {
          const sectionSlug = extractForumSectionSlugFromContent(content);
          if (sectionSlug === "thong-bao" && !canCreateAnnouncement) {
            return res
              .status(403)
              .json({ ok: false, error: "Chỉ Mod/Admin mới có thể lưu bài trong mục Thông báo." });
          }
        }
      }

      const removedForumImageKeys = forumMode
        ? Array.from(
            new Set([
              ...getRemovedForumImageKeys(commentRow && commentRow.content, content),
              ...normalizeRequestedForumImageKeys(req && req.body ? req.body.removedImageKeys : []),
            ])
          )
        : [];

      await dbRun(`UPDATE ${commentTable} SET content = ? WHERE id = ?`, [content, Math.floor(commentId)]);

      let deletedImageCount = 0;
      if (removedForumImageKeys.length > 0) {
        try {
          deletedImageCount = Number(await deleteForumImageKeys(removedForumImageKeys)) || 0;
        } catch (err) {
          console.warn("forum comment edit image cleanup failed", err);
        }
      }

      return res.json({
        ok: true,
        content,
        removedImageCount: removedForumImageKeys.length,
        deletedImageCount,
      });
    })
  );

  app.post(
    "/comments/:id/delete",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const commentId = Number(req.params.id);
      if (!Number.isFinite(commentId) || commentId <= 0) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bình luận." });
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;
      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      const preferForumTable = isTruthyFlag(req && req.body ? req.body.forumMode : false);
      const commentRow = await findCommentRowById({
        commentId: Math.floor(commentId),
        preferForum: preferForumTable,
        requireVisible: false,
      });
      if (!commentRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bình luận." });
      }
      const commentTable = commentRow._table === COMMENT_TABLE_FORUM ? COMMENT_TABLE_FORUM : COMMENT_TABLE_COMMENTS;

      let canDeleteAny = false;
      try {
        await ensureUserRowFromAuthUser(user);
        const badgeContext = await getUserBadgeContext(userId);
        canDeleteAny = Boolean(
          badgeContext && badgeContext.permissions && badgeContext.permissions.canDeleteAnyComment
        );
      } catch (err) {
        console.warn("Failed to load delete permissions", err);
      }

      let canDeleteByTeamMembership = false;
      if (commentTable === COMMENT_TABLE_COMMENTS) {
        const mangaId = Number(commentRow.manga_id);
        if (Number.isFinite(mangaId) && mangaId > 0) {
          try {
            canDeleteByTeamMembership = await canDeleteMangaCommentByTeamMember({
              userId,
              mangaId: Math.floor(mangaId)
            });
          } catch (err) {
            console.warn("Failed to load team delete permissions", err);
          }
        }
      }

      const ownerId = commentRow.author_user_id ? String(commentRow.author_user_id).trim() : "";

      const isOwner = Boolean(ownerId && ownerId === userId);

      if (
        !isOwner &&
        !canDeleteAny &&
        !canDeleteByTeamMembership
      ) {
        return res.status(403).json({ ok: false, error: "Bạn không có quyền xóa bình luận này." });
      }

      const deleted = await deleteCommentCascade(commentRow.id, { tableHint: commentTable });

      if (commentTable === COMMENT_TABLE_COMMENTS) {
        const commentCount = await getVisibleCommentCount({
          mangaId: commentRow.manga_id,
          chapterNumber: commentRow.chapter_number
        });
        return res.json({ ok: true, deleted, commentCount });
      }

      return res.json({ ok: true, deleted });
    })
  );

  app.post(
    "/comments/reactions",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;
      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      let canInteract = false;
      try {
        await ensureUserRowFromAuthUser(user);
        const badgeContext = await getUserBadgeContext(userId);
        canInteract = Boolean(
          badgeContext && badgeContext.permissions && badgeContext.permissions.canComment !== false
        );
      } catch (err) {
        console.warn("Failed to load interaction permissions for reaction sync", err);
      }

      if (!canInteract) {
        return res.json({ ok: true, likedIds: [], reportedIds: [] });
      }

      const rawIds = req.body && Array.isArray(req.body.ids) ? req.body.ids : [];
      const ids = Array.from(
        new Set(
          rawIds
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0)
            .map((value) => Math.floor(value))
        )
      ).slice(0, 320);

      if (!ids.length) {
        return res.json({ ok: true, likedIds: [], reportedIds: [] });
      }

      const placeholders = ids.map(() => "?").join(",");
      const likedRows = await dbAll(
        `
        SELECT cl.comment_id
        FROM comment_likes cl
        LEFT JOIN comments c ON c.id = cl.comment_id
        LEFT JOIN forum_posts fp ON fp.id = cl.comment_id
        WHERE cl.user_id = ?
          AND cl.comment_id IN (${placeholders})
          AND (
            COALESCE(c.status, '') = 'visible'
            OR COALESCE(fp.status, '') = 'visible'
          )
      `,
        [userId, ...ids]
      );
      const reportedRows = await dbAll(
        `
        SELECT cr.comment_id
        FROM comment_reports cr
        LEFT JOIN comments c ON c.id = cr.comment_id
        LEFT JOIN forum_posts fp ON fp.id = cr.comment_id
        WHERE cr.user_id = ?
          AND cr.comment_id IN (${placeholders})
          AND (
            COALESCE(c.status, '') = 'visible'
            OR COALESCE(fp.status, '') = 'visible'
          )
      `,
        [userId, ...ids]
      );

      const likedIds = likedRows
        .map((row) => Number(row.comment_id))
        .filter((id) => Number.isFinite(id) && id > 0)
        .map((id) => Math.floor(id));

      const reportedIds = reportedRows
        .map((row) => Number(row.comment_id))
        .filter((id) => Number.isFinite(id) && id > 0)
        .map((id) => Math.floor(id));

      return res.json({ ok: true, likedIds, reportedIds });
    })
  );

  app.post(
    "/comments/:id/like",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const commentId = Number(req.params.id);
      if (!Number.isFinite(commentId) || commentId <= 0) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bình luận." });
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;

      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      let canInteract = false;
      try {
        await ensureUserRowFromAuthUser(user);
        const badgeContext = await getUserBadgeContext(userId);
        canInteract = Boolean(
          badgeContext && badgeContext.permissions && badgeContext.permissions.canComment !== false
        );
      } catch (err) {
        console.warn("Failed to load interaction permissions for like action", err);
      }

      if (!canInteract) {
        return res.status(403).json({ ok: false, error: "Tài khoản của bạn hiện không có quyền tương tác." });
      }

      const preferForumTable = isTruthyFlag(req && req.body ? req.body.forumMode : false);
      const commentRow = await findCommentRowById({
        commentId: Math.floor(commentId),
        preferForum: preferForumTable,
        requireVisible: true,
      });
      if (!commentRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bình luận." });
      }
      const commentTable = commentRow._table === COMMENT_TABLE_FORUM ? COMMENT_TABLE_FORUM : COMMENT_TABLE_COMMENTS;

      const result = await withTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
        const existing = await txGet(
          "SELECT 1 as ok FROM comment_likes WHERE comment_id = ? AND user_id = ?",
          [Math.floor(commentId), userId]
        );

        let liked = false;
        if (existing) {
          await txRun("DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?", [
            Math.floor(commentId),
            userId
          ]);
          await txRun(
            `UPDATE ${commentTable} SET like_count = GREATEST(COALESCE(like_count, 0) - 1, 0) WHERE id = ?`,
            [Math.floor(commentId)]
          );
          liked = false;
        } else {
          const inserted = await txRun(
            "INSERT INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
            [Math.floor(commentId), userId, Date.now()]
          );

          if (inserted && inserted.changes) {
            await txRun(`UPDATE ${commentTable} SET like_count = COALESCE(like_count, 0) + 1 WHERE id = ?`, [
              Math.floor(commentId)
            ]);
          }
          liked = true;
        }

        const countRow = await txGet(
          `SELECT COALESCE(like_count, 0) as like_count FROM ${commentTable} WHERE id = ?`,
          [Math.floor(commentId)]
        );
        const likeCount = countRow ? Number(countRow.like_count) || 0 : 0;
        return { liked, likeCount };
      });

      return res.json({ ok: true, liked: result.liked, likeCount: result.likeCount });
    })
  );

  app.post(
    "/comments/:id/report",
    asyncHandler(async (req, res) => {
      if (!wantsJson(req)) {
        return res.status(406).send("Yêu cầu JSON.");
      }

      const commentId = Number(req.params.id);
      if (!Number.isFinite(commentId) || commentId <= 0) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bình luận." });
      }

      const user = await requireAuthUserForComments(req, res);
      if (!user) return;

      const userId = String(user.id || "").trim();
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
      }

      let canInteract = false;
      try {
        await ensureUserRowFromAuthUser(user);
        const badgeContext = await getUserBadgeContext(userId);
        canInteract = Boolean(
          badgeContext && badgeContext.permissions && badgeContext.permissions.canComment !== false
        );
      } catch (err) {
        console.warn("Failed to load interaction permissions for report action", err);
      }

      if (!canInteract) {
        return res.status(403).json({ ok: false, error: "Tài khoản của bạn hiện không có quyền tương tác." });
      }

      const preferForumTable = isTruthyFlag(req && req.body ? req.body.forumMode : false);
      const commentRow = await findCommentRowById({
        commentId: Math.floor(commentId),
        preferForum: preferForumTable,
        requireVisible: true,
      });
      if (!commentRow) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy bình luận." });
      }
      const commentTable = commentRow._table === COMMENT_TABLE_FORUM ? COMMENT_TABLE_FORUM : COMMENT_TABLE_COMMENTS;

      const ownerId = commentRow.author_user_id ? String(commentRow.author_user_id).trim() : "";
      const ownerEmail = commentRow.author_email
        ? String(commentRow.author_email).trim().toLowerCase()
        : "";
      const userEmail = user.email ? String(user.email).trim().toLowerCase() : "";
      if ((ownerId && ownerId === userId) || (ownerEmail && userEmail && ownerEmail === userEmail)) {
        return res.status(400).json({ ok: false, error: "Bạn không thể báo cáo bình luận của chính mình." });
      }

      const result = await withTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
        const existing = await txGet(
          "SELECT 1 as ok FROM comment_reports WHERE comment_id = ? AND user_id = ?",
          [Math.floor(commentId), userId]
        );

        let reported = true;
        if (!existing) {
          const inserted = await txRun(
            "INSERT INTO comment_reports (comment_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
            [Math.floor(commentId), userId, Date.now()]
          );

          if (inserted && inserted.changes) {
            await txRun(
              `
              UPDATE ${commentTable}
              SET report_count = COALESCE(report_count, 0) + 1,
                  status = CASE WHEN COALESCE(report_count, 0) + 1 >= 3 THEN 'reported' ELSE status END
              WHERE id = ?
            `,
              [Math.floor(commentId)]
            );
          }
        }

        const countRow = await txGet(
          `SELECT COALESCE(report_count, 0) as report_count FROM ${commentTable} WHERE id = ?`,
          [Math.floor(commentId)]
        );
        const reportCount = countRow ? Number(countRow.report_count) || 0 : 0;
        if (existing) {
          reported = true;
        }

        return { reported, reportCount };
      });

      return res.json({ ok: true, reported: result.reported, reportCount: result.reportCount });
    })
  );
};

module.exports = registerEngagementRoutes;
