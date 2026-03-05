const createInitDbDomain = (deps) => {
  const {
    ONESHOT_GENRE_NAME,
    dbAll,
    dbGet,
    dbRun,
    ensureHomepageDefaults,
    migrateLegacyGenres,
    migrateMangaSlugs,
    migrateMangaStatuses,
    resetMemberBadgeCache,
    team,
  } = deps;

  const TEAM_LEADER_BADGE_COLOR = "#ef4444";
  const TEAM_MEMBER_BADGE_COLOR = "#3b82f6";
  const TEAM_LEADER_BADGE_PRIORITY_FALLBACK = 55;
  const TEAM_MEMBER_BADGE_PRIORITY_FALLBACK = 45;

  const buildTeamBadgeCode = (teamId, role) => {
    const id = Number(teamId);
    if (!Number.isFinite(id) || id <= 0) return "";
    const safeRole = (role || "").toString().trim().toLowerCase() === "leader" ? "leader" : "member";
    return `team_${Math.floor(id)}_${safeRole}`;
  };

  const resolveTeamBadgePriority = async () => {
    const row = await dbGet(
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
      : TEAM_MEMBER_BADGE_PRIORITY_FALLBACK;

    let leaderPriority = Number.isFinite(modPriority)
      ? Math.floor(modPriority) - 1
      : Number.isFinite(adminPriority)
        ? Math.floor(adminPriority) - 1
        : TEAM_LEADER_BADGE_PRIORITY_FALLBACK;
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
      leaderPriority: Number.isFinite(leaderPriority) ? Math.floor(leaderPriority) : TEAM_LEADER_BADGE_PRIORITY_FALLBACK,
      memberPriority: Number.isFinite(memberPriority) ? Math.floor(memberPriority) : TEAM_MEMBER_BADGE_PRIORITY_FALLBACK
    };
  };

  const upsertTeamRoleBadge = async ({ teamId, teamName, role }) => {
    const safeTeamId = Number(teamId);
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0) return 0;

    const safeRole = (role || "").toString().trim().toLowerCase() === "leader" ? "leader" : "member";
    const safeTeamName = (teamName || "").toString().trim() || "Nhóm dịch";
    const code = buildTeamBadgeCode(safeTeamId, safeRole);
    if (!code) return 0;

    const now = Date.now();
    const label = safeRole === "leader" ? `Leader ${safeTeamName}` : safeTeamName;
    const color = safeRole === "leader" ? TEAM_LEADER_BADGE_COLOR : TEAM_MEMBER_BADGE_COLOR;
    const priorities = await resolveTeamBadgePriority();
    const priority = safeRole === "leader" ? priorities.leaderPriority : priorities.memberPriority;

    const result = await dbRun(
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

    const row = await dbGet("SELECT id FROM badges WHERE lower(code) = lower(?) LIMIT 1", [code]);
    const fallbackId = row && row.id != null ? Number(row.id) : 0;
    return Number.isFinite(fallbackId) && fallbackId > 0 ? Math.floor(fallbackId) : 0;
  };

  const clearTeamBadgesForUser = async ({ teamId, userId }) => {
    const safeTeamId = Number(teamId);
    const safeUserId = (userId || "").toString().trim();
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0 || !safeUserId) return;

    const leaderCode = buildTeamBadgeCode(safeTeamId, "leader");
    const memberCode = buildTeamBadgeCode(safeTeamId, "member");
    if (!leaderCode || !memberCode) return;

    await dbRun(
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

  const syncTeamBadgeForMember = async ({ teamId, teamName, userId, role, isApproved }) => {
    const safeTeamId = Number(teamId);
    const safeUserId = (userId || "").toString().trim();
    if (!Number.isFinite(safeTeamId) || safeTeamId <= 0 || !safeUserId) return;

    await clearTeamBadgesForUser({ teamId: safeTeamId, userId: safeUserId });
    if (!isApproved) return;

    const safeRole = (role || "").toString().trim().toLowerCase() === "leader" ? "leader" : "member";
    const badgeId = await upsertTeamRoleBadge({ teamId: safeTeamId, teamName, role: safeRole });
    if (!badgeId) return;

    await dbRun(
      "INSERT INTO user_badges (user_id, badge_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      [safeUserId, badgeId, Date.now()]
    );

    const safeTeamName = (teamName || "").toString().trim() || "Member";
    const roleLabel = safeRole === "leader" ? `Leader ${safeTeamName}` : safeTeamName;
    await dbRun("UPDATE users SET badge = ? WHERE id = ?", [roleLabel, safeUserId]);
  };

  const parseEnvBoolean = (value, defaultValue = false) => {
    if (value == null) return Boolean(defaultValue);
    const raw = String(value).trim().toLowerCase();
    if (!raw) return Boolean(defaultValue);
    if (["1", "true", "yes", "on"].includes(raw)) return true;
    if (["0", "false", "no", "off"].includes(raw)) return false;
    return Boolean(defaultValue);
  };

  const forumSampleSeedEnabled = parseEnvBoolean(
    process.env.FORUM_SAMPLE_SEED_ENABLED,
    false
  );
  const forumSampleTargetTopicsRaw = Number(process.env.FORUM_SAMPLE_TARGET_TOPICS);
  const forumSampleTargetTopics =
    Number.isFinite(forumSampleTargetTopicsRaw) && forumSampleTargetTopicsRaw > 0
      ? Math.floor(forumSampleTargetTopicsRaw)
      : 36;
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
  const FORUM_META_COMMENT_PATTERN = /<!--\s*forum-meta:([^>]*?)\s*-->/gi;

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

  const stripForumTagsMetaFromContent = (value) => {
    const raw = value == null ? "" : String(value);
    return raw.replace(FORUM_META_COMMENT_PATTERN, (_fullMatch, payloadText) => {
      let sectionSlug = "";
      const payload = (payloadText == null ? "" : String(payloadText)).trim();
      if (payload) {
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
      }

      return sectionSlug ? `<!--forum-meta:section=${sectionSlug}-->` : "";
    });
  };

  const normalizeForumTagsForTable = async (tableName) => {
    const safeTableName = (tableName || "").toString().trim().toLowerCase();
    if (!safeTableName) return;

    const rows = await dbAll(
      `
        SELECT id, content
        FROM ${safeTableName}
        WHERE content ILIKE '%<!--forum-meta:%'
      `
    );

    for (const row of rows) {
      const rowId = row && row.id != null ? Number(row.id) : 0;
      if (!Number.isFinite(rowId) || rowId <= 0) continue;
      const originalContent = row && row.content != null ? String(row.content) : "";
      const normalizedContent = stripForumTagsMetaFromContent(originalContent);
      if (normalizedContent === originalContent) continue;

      await dbRun(`UPDATE ${safeTableName} SET content = ? WHERE id = ?`, [normalizedContent, Math.floor(rowId)]);
    }
  };

  const removeForumTagsFromStoredComments = async () => {
    await normalizeForumTagsForTable("comments");
    await normalizeForumTagsForTable("forum_posts");
  };

  const getNextSharedCommentId = async () => {
    try {
      const sequenceRow = await dbGet(
        "SELECT nextval(pg_get_serial_sequence('comments', 'id')) AS id"
      );
      const sequenceId = sequenceRow && sequenceRow.id != null ? Number(sequenceRow.id) : NaN;
      if (Number.isFinite(sequenceId) && sequenceId > 0) {
        return Math.floor(sequenceId);
      }
    } catch (_err) {
      // Fallback for environments where pg_get_serial_sequence is unavailable.
    }

    const fallbackRow = await dbGet(
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

  const migrateForumRowsToForumPosts = async () => {
    await dbRun(
      `
        INSERT INTO forum_posts (
          id,
          parent_id,
          author,
          author_user_id,
          author_email,
          author_avatar_url,
          client_request_id,
          content,
          status,
          like_count,
          report_count,
          forum_post_locked,
          forum_post_pinned,
          created_at
        )
        SELECT
          c.id,
          c.parent_id,
          c.author,
          c.author_user_id,
          c.author_email,
          c.author_avatar_url,
          c.client_request_id,
          c.content,
          c.status,
          COALESCE(c.like_count, 0),
          COALESCE(c.report_count, 0),
          COALESCE(c.forum_post_locked, false),
          COALESCE(c.forum_post_pinned, false),
          c.created_at
        FROM comments c
        WHERE COALESCE(c.client_request_id, '') ILIKE 'forum-%'
          AND NOT EXISTS (
            SELECT 1
            FROM forum_posts fp
            WHERE fp.id = c.id
          )
      `
    );

    await dbRun(
      `
        DELETE FROM comments c
        WHERE COALESCE(c.client_request_id, '') ILIKE 'forum-%'
          AND EXISTS (
            SELECT 1
            FROM forum_posts fp
            WHERE fp.id = c.id
          )
      `
    );
  };

  const rebuildCommentReferenceTables = async () => {
    const now = Date.now();

    await dbRun(
      `
        CREATE TABLE IF NOT EXISTS comment_likes_next (
          comment_id INTEGER NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at BIGINT NOT NULL,
          PRIMARY KEY (comment_id, user_id)
        )
      `
    );
    await dbRun(
      `
        INSERT INTO comment_likes_next (comment_id, user_id, created_at)
        SELECT comment_id, user_id, COALESCE(created_at, ?)
        FROM comment_likes
        ON CONFLICT DO NOTHING
      `,
      [now]
    );
    await dbRun("DROP TABLE IF EXISTS comment_likes");
    await dbRun("ALTER TABLE comment_likes_next RENAME TO comment_likes");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_comment_likes_user_id ON comment_likes(user_id)");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id)");

    await dbRun(
      `
        CREATE TABLE IF NOT EXISTS forum_post_bookmarks_next (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          comment_id INTEGER NOT NULL,
          created_at BIGINT NOT NULL,
          PRIMARY KEY (user_id, comment_id)
        )
      `
    );
    await dbRun(
      `
        INSERT INTO forum_post_bookmarks_next (user_id, comment_id, created_at)
        SELECT user_id, comment_id, COALESCE(created_at, ?)
        FROM forum_post_bookmarks
        ON CONFLICT DO NOTHING
      `,
      [now]
    );
    await dbRun("DROP TABLE IF EXISTS forum_post_bookmarks");
    await dbRun("ALTER TABLE forum_post_bookmarks_next RENAME TO forum_post_bookmarks");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_forum_post_bookmarks_user_id ON forum_post_bookmarks(user_id)");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_forum_post_bookmarks_comment_id ON forum_post_bookmarks(comment_id)");

    await dbRun(
      `
        CREATE TABLE IF NOT EXISTS comment_reports_next (
          comment_id INTEGER NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at BIGINT NOT NULL,
          PRIMARY KEY (comment_id, user_id)
        )
      `
    );
    await dbRun(
      `
        INSERT INTO comment_reports_next (comment_id, user_id, created_at)
        SELECT comment_id, user_id, COALESCE(created_at, ?)
        FROM comment_reports
        ON CONFLICT DO NOTHING
      `,
      [now]
    );
    await dbRun("DROP TABLE IF EXISTS comment_reports");
    await dbRun("ALTER TABLE comment_reports_next RENAME TO comment_reports");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_comment_reports_user_id ON comment_reports(user_id)");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_comment_reports_comment_id ON comment_reports(comment_id)");

    await dbRun(
      `
        CREATE TABLE IF NOT EXISTS notifications_next (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          actor_user_id TEXT,
          manga_id INTEGER REFERENCES manga(id) ON DELETE CASCADE,
          team_id INTEGER,
          chapter_number NUMERIC(10, 3),
          comment_id INTEGER,
          content_preview TEXT,
          is_read BOOLEAN NOT NULL DEFAULT false,
          created_at BIGINT NOT NULL,
          read_at BIGINT
        )
      `
    );
    await dbRun(
      `
        INSERT INTO notifications_next (
          id,
          user_id,
          type,
          actor_user_id,
          manga_id,
          team_id,
          chapter_number,
          comment_id,
          content_preview,
          is_read,
          created_at,
          read_at
        )
        SELECT
          id,
          user_id,
          type,
          actor_user_id,
          manga_id,
          team_id,
          chapter_number,
          comment_id,
          content_preview,
          COALESCE(is_read, false),
          COALESCE(created_at, ?),
          read_at
        FROM notifications
        ON CONFLICT DO NOTHING
      `,
      [now]
    );
    await dbRun("DROP TABLE IF EXISTS notifications");
    await dbRun("ALTER TABLE notifications_next RENAME TO notifications");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC)");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at)");
    await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_comment_type ON notifications(user_id, comment_id, type)");

    await dbRun(
      `
        DELETE FROM comment_likes cl
        WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.id = cl.comment_id)
          AND NOT EXISTS (SELECT 1 FROM forum_posts fp WHERE fp.id = cl.comment_id)
      `
    );
    await dbRun(
      `
        DELETE FROM comment_reports cr
        WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.id = cr.comment_id)
          AND NOT EXISTS (SELECT 1 FROM forum_posts fp WHERE fp.id = cr.comment_id)
      `
    );
    await dbRun(
      `
        DELETE FROM forum_post_bookmarks b
        WHERE NOT EXISTS (SELECT 1 FROM forum_posts fp WHERE fp.id = b.comment_id)
      `
    );
    await dbRun(
      `
        DELETE FROM notifications n
        WHERE n.comment_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.id = n.comment_id)
          AND NOT EXISTS (SELECT 1 FROM forum_posts fp WHERE fp.id = n.comment_id)
      `
    );
  };

  const forumSeedAuthors = [
    {
      id: "forum_seed_admin",
      username: "bfang_forum_admin",
      displayName: "Admin BFANG",
      email: "forum-admin@bfang.local",
      avatarUrl: "/logobfang.svg"
    },
    {
      id: "forum_seed_mod",
      username: "bfang_forum_mod",
      displayName: "Mod Cộng Đồng",
      email: "forum-mod@bfang.local",
      avatarUrl: "/logobfang.svg"
    },
    {
      id: "forum_seed_reviewer",
      username: "bfang_reviewer",
      displayName: "Reviewer Truyện",
      email: "forum-review@bfang.local",
      avatarUrl: "/logobfang.svg"
    },
    {
      id: "forum_seed_reader",
      username: "bfang_reader",
      displayName: "Bạn Đọc Nhiệt Huyết",
      email: "forum-reader@bfang.local",
      avatarUrl: "/logobfang.svg"
    }
  ];

  const forumSeedTopicTemplates = [
    {
      title: "Thảo luận chương mới",
      body: "Chương này có điểm nào khiến bạn ấn tượng nhất? Mọi người cùng chia sẻ cảm nhận và đoạn cao trào nhé.",
      replies: [
        "Mình thích nhịp kể ở nửa sau chương, đọc cuốn hơn hẳn.",
        "Đoạn cuối khá bất ngờ, hy vọng chương sau giữ được nhịp này."
      ]
    },
    {
      title: "Dự đoán diễn biến tiếp theo",
      body: "Nếu dự đoán cho 1-2 chương tới, bạn nghĩ tuyến truyện sẽ rẽ theo hướng nào?",
      replies: [
        "Khả năng cao sẽ có thêm một cú plot twist liên quan nhân vật phụ.",
        "Mình nghĩ tác giả đang cài cắm cho arc mới, chưa bung hết ngay đâu."
      ]
    },
    {
      title: "Nhân vật nổi bật của arc",
      body: "Theo bạn nhân vật nào đang tỏa sáng nhất ở arc hiện tại? Lý do là gì?",
      replies: [
        "Mình vote nhân vật chính vì phát triển tâm lý khá ổn.",
        "Nhân vật phụ lần này được viết tốt hơn mong đợi."
      ]
    },
    {
      title: "Khoảnh khắc đáng nhớ",
      body: "Nếu chọn một khoảnh khắc đáng nhớ nhất gần đây, bạn sẽ chọn đoạn nào?",
      replies: [
        "Mình chọn đoạn hội thoại ngắn nhưng cảm xúc rất mạnh.",
        "Phân cảnh hành động ở cuối chương thật sự rất đẹp."
      ]
    },
    {
      title: "Đánh giá nhịp truyện",
      body: "Nhịp truyện hiện tại có hợp lý không? Bạn muốn nhanh hơn hay chậm lại để đào sâu nhân vật?",
      replies: [
        "Nhịp hiện tại ổn, nhưng mình muốn thêm vài cảnh đời thường để cân bằng.",
        "Có thể đẩy nhanh 1 chút ở giữa chương để tăng kịch tính."
      ]
    },
    {
      title: "Giả thuyết fan",
      body: "Thử đưa ra một giả thuyết vui về tình tiết sắp tới để mọi người cùng bàn luận.",
      replies: [
        "Mình đoán bí mật của nhân vật phụ sẽ mở khóa cốt truyện chính.",
        "Nếu giả thuyết này đúng thì arc sau sẽ rất bùng nổ."
      ]
    }
  ];

  const ensureForumSeedAuthor = async (profile) => {
    const safeProfile = profile && typeof profile === "object" ? profile : {};
    const preferredId = (safeProfile.id || "").toString().trim();
    const username = (safeProfile.username || "").toString().trim();
    const displayName = (safeProfile.displayName || username || "Thành viên").toString().trim();
    const email = (safeProfile.email || "").toString().trim();
    const avatarUrl = (safeProfile.avatarUrl || "").toString().trim();
    if (!preferredId || !username) return null;

    const existingByUsername = await dbGet(
      "SELECT id FROM users WHERE lower(username) = lower(?) LIMIT 1",
      [username]
    );
    const resolvedId = existingByUsername && existingByUsername.id
      ? String(existingByUsername.id).trim()
      : preferredId;

    const now = Date.now();
    await dbRun(
      `
        INSERT INTO users (
          id,
          email,
          username,
          display_name,
          avatar_url,
          badge,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'Member', ?, ?)
        ON CONFLICT (id)
        DO UPDATE SET
          email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email),
          display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
          avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), users.avatar_url),
          updated_at = EXCLUDED.updated_at
      `,
      [resolvedId, email, username, displayName, avatarUrl, now, now]
    );

    const row = await dbGet(
      "SELECT id, username, display_name, email, avatar_url FROM users WHERE id = ? LIMIT 1",
      [resolvedId]
    );
    if (!row || !row.id) return null;

    return {
      id: String(row.id).trim(),
      username: (row.username || username).toString().trim(),
      displayName: (row.display_name || displayName).toString().trim() || displayName,
      email: (row.email || email).toString().trim(),
      avatarUrl: (row.avatar_url || avatarUrl).toString().trim()
    };
  };

  const seedForumSampleTopics = async () => {
    if (!forumSampleSeedEnabled) return;

    const rootCountRow = await dbGet(
      `
        SELECT COUNT(*) AS count
        FROM forum_posts c
        WHERE c.status = 'visible'
          AND c.parent_id IS NULL
      `
    );
    const existingRootCount = rootCountRow && rootCountRow.count != null
      ? Number(rootCountRow.count) || 0
      : 0;
    if (existingRootCount >= forumSampleTargetTopics) {
      return;
    }

    const resolvedAuthors = [];
    for (const profile of forumSeedAuthors) {
      const resolved = await ensureForumSeedAuthor(profile);
      if (resolved && resolved.id) {
        resolvedAuthors.push(resolved);
      }
    }
    if (!resolvedAuthors.length) {
      return;
    }

    const maxSeedTopics = Math.max(forumSampleTargetTopics, 1);
    const baseTimestamp = Date.now() - maxSeedTopics * 2 * 60 * 60 * 1000;
    const sectionSlugs = Array.from(FORUM_SECTION_SLUGS);

    for (let index = 0; index < maxSeedTopics; index += 1) {
      const topicRequestId = `forum-seed-topic-${String(index + 1).padStart(3, "0")}`;
      const author = resolvedAuthors[index % resolvedAuthors.length];
      const template = forumSeedTopicTemplates[index % forumSeedTopicTemplates.length];
      if (!author || !template) continue;

      const existingTopic = await dbGet(
        "SELECT id FROM forum_posts WHERE parent_id IS NULL AND author_user_id = ? AND client_request_id = ? LIMIT 1",
        [author.id, topicRequestId]
      );

      const topicCreatedAt = new Date(baseTimestamp + index * 2 * 60 * 60 * 1000).toISOString();
      const sectionSlug = sectionSlugs[index % sectionSlugs.length] || "thao-luan-chung";
      const topicTitle = `${template.title} #${index + 1}`;
      const topicContent = [
        `<p><strong>${topicTitle}</strong></p>`,
        `<!--forum-meta:section=${sectionSlug}-->`,
        `<p>${template.body}</p>`,
        "<p>Mọi người vào chia sẻ quan điểm để topic sôi động hơn nhé.</p>",
      ].join("");

      let topicId = existingTopic && existingTopic.id ? Number(existingTopic.id) : 0;
      if (!topicId) {
        const nextTopicId = await getNextSharedCommentId();
        await dbRun(
          `
            INSERT INTO forum_posts (
              id,
              parent_id,
              author,
              author_user_id,
              author_email,
              author_avatar_url,
              client_request_id,
              content,
              status,
              like_count,
              report_count,
              created_at
            )
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'visible', ?, 0, ?)
          `,
          [
            nextTopicId,
            author.displayName,
            author.id,
            author.email,
            author.avatarUrl,
            topicRequestId,
            topicContent,
            (index % 7) + 2,
            topicCreatedAt
          ]
        );
        topicId = nextTopicId;
      }

      if (!Number.isFinite(topicId) || topicId <= 0) continue;

      for (let replyIndex = 0; replyIndex < template.replies.length; replyIndex += 1) {
        const replyAuthor = resolvedAuthors[(index + replyIndex + 1) % resolvedAuthors.length];
        if (!replyAuthor || !replyAuthor.id) continue;

        const replyRequestId = `forum-seed-reply-${String(index + 1).padStart(3, "0")}-${replyIndex + 1}`;
        const existingReply = await dbGet(
          "SELECT id FROM forum_posts WHERE author_user_id = ? AND client_request_id = ? LIMIT 1",
          [replyAuthor.id, replyRequestId]
        );
        if (existingReply && existingReply.id) continue;

        const replyCreatedAt = new Date(
          new Date(topicCreatedAt).getTime() + (replyIndex + 1) * 7 * 60 * 1000
        ).toISOString();
        const nextReplyId = await getNextSharedCommentId();

        await dbRun(
          `
            INSERT INTO forum_posts (
              id,
              parent_id,
              author,
              author_user_id,
              author_email,
              author_avatar_url,
              client_request_id,
              content,
              status,
              like_count,
              report_count,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, 0, ?)
          `,
          [
            nextReplyId,
            Math.floor(topicId),
            replyAuthor.displayName,
            replyAuthor.id,
            replyAuthor.email,
            replyAuthor.avatarUrl,
            replyRequestId,
            `<p>${template.replies[replyIndex]}</p>`,
            replyIndex + 1,
            replyCreatedAt
          ]
        );
      }
    }
  };

  const cleanupForumSampleSeedData = async () => {
    await dbRun(
      `
        WITH RECURSIVE seed_subtree AS (
          SELECT c.id
          FROM forum_posts c
          WHERE COALESCE(c.client_request_id, '') LIKE 'forum-seed-%'
             OR COALESCE(c.author_user_id, '') LIKE 'forum_seed_%'
          UNION
          SELECT child.id
          FROM forum_posts child
          JOIN seed_subtree ss ON child.parent_id = ss.id
        )
        DELETE FROM forum_posts
        WHERE id IN (SELECT id FROM seed_subtree)
      `
    );

    await dbRun(
      `
        WITH RECURSIVE dangling AS (
          SELECT c.id
          FROM forum_posts c
          WHERE c.parent_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM forum_posts parent
              WHERE parent.id = c.parent_id
            )
          UNION
          SELECT child.id
          FROM forum_posts child
          JOIN dangling d ON child.parent_id = d.id
        )
        DELETE FROM forum_posts
        WHERE id IN (SELECT id FROM dangling)
      `
    );

    await dbRun(
      `
        DELETE FROM user_badges ub
        USING users u
        WHERE ub.user_id = u.id
          AND (
            u.id LIKE 'forum_seed_%'
            OR lower(COALESCE(u.username, '')) LIKE 'bfang_forum_%'
          )
      `
    );

    await dbRun(
      `
        DELETE FROM users
        WHERE id LIKE 'forum_seed_%'
           OR lower(COALESCE(username, '')) LIKE 'bfang_forum_%'
      `
    );
  };

const initDb = async () => {
  await dbGet("SELECT 1 as ok");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS web_sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `
  );
  await dbRun("CREATE INDEX IF NOT EXISTS idx_web_sessions_expire_at ON web_sessions(expire_at)");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS manga (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      author TEXT NOT NULL,
      genres TEXT,
      status TEXT,
      description TEXT,
      cover TEXT,
      archive TEXT,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      group_name TEXT,
      other_names TEXT,
      cover_updated_at BIGINT,
      is_oneshot BOOLEAN NOT NULL DEFAULT false,
      oneshot_locked BOOLEAN NOT NULL DEFAULT false
    )
  `
  );

  // Safety migrations for older schemas.
  await dbRun("ALTER TABLE manga ADD COLUMN IF NOT EXISTS is_hidden INTEGER NOT NULL DEFAULT 0");
  await dbRun("ALTER TABLE manga ADD COLUMN IF NOT EXISTS group_name TEXT");
  await dbRun("ALTER TABLE manga ADD COLUMN IF NOT EXISTS other_names TEXT");
  await dbRun("ALTER TABLE manga ADD COLUMN IF NOT EXISTS cover_updated_at BIGINT");
  await dbRun("ALTER TABLE manga ADD COLUMN IF NOT EXISTS is_oneshot BOOLEAN NOT NULL DEFAULT false");
  await dbRun("ALTER TABLE manga ADD COLUMN IF NOT EXISTS oneshot_locked BOOLEAN NOT NULL DEFAULT false");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_manga_visible_updated ON manga (is_hidden, updated_at DESC, id DESC)");

  await dbRun(
    `
    UPDATE manga
    SET group_name = author
    WHERE (group_name IS NULL OR TRIM(group_name) = '')
      AND author IS NOT NULL
      AND TRIM(author) <> ''
  `
  );

  const coverStamp = Date.now();
  await dbRun(
    "UPDATE manga SET cover_updated_at = ? WHERE cover IS NOT NULL AND TRIM(cover) <> '' AND cover_updated_at IS NULL",
    [coverStamp]
  );

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      manga_id INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
      number NUMERIC(10, 3) NOT NULL,
      title TEXT NOT NULL,
      pages INTEGER NOT NULL,
      date TEXT NOT NULL,
      group_name TEXT,
      pages_prefix TEXT,
      pages_ext TEXT,
      pages_updated_at BIGINT,
      is_oneshot BOOLEAN NOT NULL DEFAULT false,
      processing_state TEXT,
      processing_error TEXT,
      processing_draft_token TEXT,
      processing_pages_json TEXT,
      processing_updated_at BIGINT
    )
  `
  );

  await dbRun("ALTER TABLE chapters ADD COLUMN IF NOT EXISTS group_name TEXT");
  await dbRun("ALTER TABLE chapters ADD COLUMN IF NOT EXISTS pages_prefix TEXT");
  await dbRun("ALTER TABLE chapters ADD COLUMN IF NOT EXISTS pages_ext TEXT");
  await dbRun("ALTER TABLE chapters ADD COLUMN IF NOT EXISTS pages_updated_at BIGINT");
  await dbRun("ALTER TABLE chapters ADD COLUMN IF NOT EXISTS is_oneshot BOOLEAN NOT NULL DEFAULT false");
  await dbRun("ALTER TABLE chapters ADD COLUMN IF NOT EXISTS processing_state TEXT");
  await dbRun("ALTER TABLE chapters ADD COLUMN IF NOT EXISTS processing_error TEXT");
  await dbRun("ALTER TABLE chapters ADD COLUMN IF NOT EXISTS processing_draft_token TEXT");
  await dbRun("ALTER TABLE chapters ADD COLUMN IF NOT EXISTS processing_pages_json TEXT");
  await dbRun("ALTER TABLE chapters ADD COLUMN IF NOT EXISTS processing_updated_at BIGINT");

  await dbRun(
    `
    UPDATE manga
    SET is_oneshot = true
    WHERE COALESCE(is_oneshot, false) = false
      AND id IN (
        SELECT c.manga_id
        FROM chapters c
        GROUP BY c.manga_id
        HAVING COUNT(*) = 1
           AND SUM(CASE WHEN COALESCE(c.is_oneshot, false) THEN 1 ELSE 0 END) = 1
      )
  `
  );

  // Enforce unique chapter number per manga.
  await dbRun(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_chapters_manga_number ON chapters (manga_id, number)"
  );

  await dbRun(
    `
    UPDATE chapters
    SET group_name = (
      SELECT COALESCE(NULLIF(TRIM(m.group_name), ''), NULLIF(TRIM(m.author), ''), ?)
      FROM manga m
      WHERE m.id = chapters.manga_id
    )
    WHERE (group_name IS NULL OR TRIM(group_name) = '')
  `,
    [team.name]
  );

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS chapter_drafts (
      token TEXT PRIMARY KEY,
      manga_id INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
      pages_prefix TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_chapter_drafts_updated_at ON chapter_drafts(updated_at)"
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_chapter_drafts_manga_id ON chapter_drafts(manga_id)"
  );

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      manga_id INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
      chapter_number NUMERIC(10, 3),
      parent_id INTEGER,
      author TEXT NOT NULL,
      author_user_id TEXT,
      author_email TEXT,
      author_avatar_url TEXT,
      client_request_id TEXT,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible',
      like_count INTEGER NOT NULL DEFAULT 0,
      report_count INTEGER NOT NULL DEFAULT 0,
      forum_post_locked BOOLEAN NOT NULL DEFAULT false,
      forum_post_pinned BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL
    )
  `
  );

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS forum_posts (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      parent_id INTEGER,
      author TEXT NOT NULL,
      author_user_id TEXT,
      author_email TEXT,
      author_avatar_url TEXT,
      client_request_id TEXT,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible',
      like_count INTEGER NOT NULL DEFAULT 0,
      report_count INTEGER NOT NULL DEFAULT 0,
      forum_post_locked BOOLEAN NOT NULL DEFAULT false,
      forum_post_pinned BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL
    )
  `
  );

  await dbRun("ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id INTEGER");
  await dbRun("ALTER TABLE comments ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0");
  await dbRun("ALTER TABLE comments ADD COLUMN IF NOT EXISTS report_count INTEGER NOT NULL DEFAULT 0");
  await dbRun("ALTER TABLE comments ADD COLUMN IF NOT EXISTS author_user_id TEXT");
  await dbRun("ALTER TABLE comments ADD COLUMN IF NOT EXISTS author_email TEXT");
  await dbRun("ALTER TABLE comments ADD COLUMN IF NOT EXISTS author_avatar_url TEXT");
  await dbRun("ALTER TABLE comments ADD COLUMN IF NOT EXISTS client_request_id TEXT");
  await dbRun("ALTER TABLE comments ADD COLUMN IF NOT EXISTS forum_post_locked BOOLEAN NOT NULL DEFAULT false");
  await dbRun("ALTER TABLE comments ADD COLUMN IF NOT EXISTS forum_post_pinned BOOLEAN NOT NULL DEFAULT false");
  await dbRun("UPDATE comments SET forum_post_locked = false WHERE forum_post_locked IS NULL");
  await dbRun("UPDATE comments SET forum_post_pinned = false WHERE forum_post_pinned IS NULL");
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_comments_manga_chapter_status_created ON comments (manga_id, chapter_number, status, created_at DESC)"
  );
  await dbRun("CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_comments_author_user_id ON comments(author_user_id)");
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_comments_author_created_at ON comments(author_user_id, created_at DESC, id DESC)"
  );
  await dbRun(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_author_request_id ON comments(author_user_id, client_request_id) WHERE client_request_id IS NOT NULL AND author_user_id IS NOT NULL"
  );

  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS parent_id INTEGER");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS author TEXT");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS content TEXT");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS status TEXT");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS created_at TEXT");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS report_count INTEGER NOT NULL DEFAULT 0");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS author_user_id TEXT");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS author_email TEXT");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS author_avatar_url TEXT");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS client_request_id TEXT");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS forum_post_locked BOOLEAN NOT NULL DEFAULT false");
  await dbRun("ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS forum_post_pinned BOOLEAN NOT NULL DEFAULT false");
  await dbRun("ALTER TABLE forum_posts DROP COLUMN IF EXISTS manga_id");
  await dbRun("ALTER TABLE forum_posts DROP COLUMN IF EXISTS chapter_number");
  const forumCreatedAtColumnRow = await dbGet(
    "SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'forum_posts' AND column_name = 'created_at' LIMIT 1"
  );
  const forumCreatedAtDataType =
    forumCreatedAtColumnRow && forumCreatedAtColumnRow.data_type
      ? String(forumCreatedAtColumnRow.data_type).toLowerCase()
      : "";
  if (forumCreatedAtDataType && forumCreatedAtDataType !== "text") {
    if (["bigint", "integer", "smallint", "numeric", "double precision", "real"].includes(forumCreatedAtDataType)) {
      await dbRun(
        `
          ALTER TABLE forum_posts
          ALTER COLUMN created_at TYPE TEXT
          USING to_char(
            to_timestamp((created_at)::double precision / 1000.0) AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        `
      );
    } else {
      await dbRun("ALTER TABLE forum_posts ALTER COLUMN created_at TYPE TEXT USING created_at::text");
    }
  }
  const forumAuthorNameColumnRow = await dbGet(
    "SELECT 1 as ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'forum_posts' AND column_name = 'author_name' LIMIT 1"
  );
  if (forumAuthorNameColumnRow && forumAuthorNameColumnRow.ok) {
    await dbRun("ALTER TABLE forum_posts ALTER COLUMN author_name DROP NOT NULL");
  }
  const forumAuthorFallbackExpression = forumAuthorNameColumnRow && forumAuthorNameColumnRow.ok
    ? "COALESCE(NULLIF(TRIM(author), ''), NULLIF(TRIM(author_name), ''), 'Ẩn danh')"
    : "COALESCE(NULLIF(TRIM(author), ''), 'Ẩn danh')";
  await dbRun(
    `UPDATE forum_posts SET author = ${forumAuthorFallbackExpression} WHERE author IS NULL OR TRIM(author) = ''`
  );
  await dbRun("UPDATE forum_posts SET status = 'visible' WHERE status IS NULL OR TRIM(status) = ''");
  await dbRun("UPDATE forum_posts SET content = '' WHERE content IS NULL");
  await dbRun(
    "UPDATE forum_posts SET created_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') WHERE created_at IS NULL OR TRIM(created_at) = ''"
  );
  const forumTopicIdColumnRow = await dbGet(
    "SELECT 1 as ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'forum_posts' AND column_name = 'topic_id' LIMIT 1"
  );
  if (forumTopicIdColumnRow && forumTopicIdColumnRow.ok) {
    await dbRun("ALTER TABLE forum_posts ALTER COLUMN topic_id DROP NOT NULL");
  }
  const forumUpdatedAtColumnRow = await dbGet(
    "SELECT 1 as ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'forum_posts' AND column_name = 'updated_at' LIMIT 1"
  );
  if (forumUpdatedAtColumnRow && forumUpdatedAtColumnRow.ok) {
    await dbRun("ALTER TABLE forum_posts ALTER COLUMN updated_at DROP NOT NULL");
  }
  await dbRun("UPDATE forum_posts SET forum_post_locked = false WHERE forum_post_locked IS NULL");
  await dbRun("UPDATE forum_posts SET forum_post_pinned = false WHERE forum_post_pinned IS NULL");
  await dbRun("ALTER TABLE forum_posts ALTER COLUMN status SET DEFAULT 'visible'");
  await dbRun("DROP INDEX IF EXISTS idx_forum_posts_manga_chapter_status_created");
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_forum_posts_status_created ON forum_posts (status, created_at DESC)"
  );
  await dbRun("CREATE INDEX IF NOT EXISTS idx_forum_posts_parent_id ON forum_posts(parent_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_forum_posts_author_user_id ON forum_posts(author_user_id)");
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_forum_posts_author_created_at ON forum_posts(author_user_id, created_at DESC, id DESC)"
  );
  await dbRun(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_posts_author_request_id ON forum_posts(author_user_id, client_request_id) WHERE client_request_id IS NOT NULL AND author_user_id IS NOT NULL"
  );

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS forbidden_words (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      word TEXT NOT NULL,
      normalized_word TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `
  );
  await dbRun("ALTER TABLE forbidden_words ADD COLUMN IF NOT EXISTS word TEXT");
  await dbRun("ALTER TABLE forbidden_words ADD COLUMN IF NOT EXISTS normalized_word TEXT");
  await dbRun("ALTER TABLE forbidden_words ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("UPDATE forbidden_words SET word = '' WHERE word IS NULL");
  await dbRun("UPDATE forbidden_words SET normalized_word = lower(regexp_replace(trim(word), '\\s+', ' ', 'g'))");
  await dbRun("UPDATE forbidden_words SET created_at = ? WHERE created_at IS NULL", [Date.now()]);
  await dbRun("DELETE FROM forbidden_words WHERE TRIM(word) = ''");
  await dbRun(
    "DELETE FROM forbidden_words fw USING forbidden_words other WHERE fw.id > other.id AND fw.normalized_word = other.normalized_word"
  );
  await dbRun("ALTER TABLE forbidden_words ALTER COLUMN word SET NOT NULL");
  await dbRun("ALTER TABLE forbidden_words ALTER COLUMN normalized_word SET NOT NULL");
  await dbRun("ALTER TABLE forbidden_words ALTER COLUMN created_at SET NOT NULL");
  await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_forbidden_words_normalized ON forbidden_words(normalized_word)");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      facebook_url TEXT,
      discord_handle TEXT,
      bio TEXT,
      badge TEXT NOT NULL DEFAULT 'Member',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `
  );
  await dbRun("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT");
  await dbRun("ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT");
  await dbRun("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT");
  await dbRun("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT");
  await dbRun("ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_url TEXT");
  await dbRun("ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_handle TEXT");
  await dbRun("ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT");
  await dbRun("ALTER TABLE users ADD COLUMN IF NOT EXISTS badge TEXT");
  await dbRun("UPDATE users SET badge = 'Member' WHERE badge IS NULL OR TRIM(badge) = ''");
  await dbRun("ALTER TABLE users ALTER COLUMN badge SET DEFAULT 'Member'");
  await dbRun("ALTER TABLE users ALTER COLUMN badge SET NOT NULL");
  await dbRun("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at BIGINT");
  await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users ((lower(email)))");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS translation_teams (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      intro TEXT NOT NULL DEFAULT '',
      facebook_url TEXT,
      discord_url TEXT,
      avatar_url TEXT,
      cover_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      approved_at BIGINT,
      reject_reason TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `
  );
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS name TEXT");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS slug TEXT");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS intro TEXT NOT NULL DEFAULT ''");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS facebook_url TEXT");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS discord_url TEXT");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS avatar_url TEXT");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS cover_url TEXT");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS created_by_user_id TEXT");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS approved_by_user_id TEXT");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS approved_at BIGINT");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS reject_reason TEXT");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("ALTER TABLE translation_teams ADD COLUMN IF NOT EXISTS updated_at BIGINT");
  await dbRun("UPDATE translation_teams SET intro = '' WHERE intro IS NULL");
  await dbRun("UPDATE translation_teams SET status = 'pending' WHERE status IS NULL OR TRIM(status) = ''");
  await dbRun("UPDATE translation_teams SET created_at = ? WHERE created_at IS NULL", [Date.now()]);
  await dbRun("UPDATE translation_teams SET updated_at = ? WHERE updated_at IS NULL", [Date.now()]);
  await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_translation_teams_slug_lower ON translation_teams((lower(slug)))");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_translation_teams_status_created ON translation_teams(status, created_at DESC, id DESC)");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS translation_team_members (
      team_id INTEGER NOT NULL REFERENCES translation_teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at BIGINT NOT NULL,
      reviewed_at BIGINT,
      reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      PRIMARY KEY (team_id, user_id)
    )
  `
  );
  await dbRun("ALTER TABLE translation_team_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'");
  await dbRun("ALTER TABLE translation_team_members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'");
  await dbRun("ALTER TABLE translation_team_members ADD COLUMN IF NOT EXISTS requested_at BIGINT");
  await dbRun("ALTER TABLE translation_team_members ADD COLUMN IF NOT EXISTS reviewed_at BIGINT");
  await dbRun("ALTER TABLE translation_team_members ADD COLUMN IF NOT EXISTS reviewed_by_user_id TEXT");
  await dbRun("ALTER TABLE translation_team_members ADD COLUMN IF NOT EXISTS can_add_manga BOOLEAN NOT NULL DEFAULT false");
  await dbRun("ALTER TABLE translation_team_members ADD COLUMN IF NOT EXISTS can_edit_manga BOOLEAN NOT NULL DEFAULT false");
  await dbRun("ALTER TABLE translation_team_members ADD COLUMN IF NOT EXISTS can_delete_manga BOOLEAN NOT NULL DEFAULT false");
  await dbRun("ALTER TABLE translation_team_members ADD COLUMN IF NOT EXISTS can_add_chapter BOOLEAN NOT NULL DEFAULT true");
  await dbRun("ALTER TABLE translation_team_members ADD COLUMN IF NOT EXISTS can_edit_chapter BOOLEAN NOT NULL DEFAULT true");
  await dbRun("ALTER TABLE translation_team_members ADD COLUMN IF NOT EXISTS can_delete_chapter BOOLEAN NOT NULL DEFAULT true");
  await dbRun("UPDATE translation_team_members SET role = 'member' WHERE role IS NULL OR TRIM(role) = ''");
  await dbRun("UPDATE translation_team_members SET status = 'pending' WHERE status IS NULL OR TRIM(status) = ''");
  await dbRun("UPDATE translation_team_members SET requested_at = ? WHERE requested_at IS NULL", [Date.now()]);
  await dbRun("UPDATE translation_team_members SET can_add_manga = false WHERE can_add_manga IS NULL");
  await dbRun("UPDATE translation_team_members SET can_edit_manga = false WHERE can_edit_manga IS NULL");
  await dbRun("UPDATE translation_team_members SET can_delete_manga = false WHERE can_delete_manga IS NULL");
  await dbRun("UPDATE translation_team_members SET can_add_chapter = true WHERE can_add_chapter IS NULL");
  await dbRun("UPDATE translation_team_members SET can_edit_chapter = true WHERE can_edit_chapter IS NULL");
  await dbRun("UPDATE translation_team_members SET can_delete_chapter = true WHERE can_delete_chapter IS NULL");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_translation_team_members_user_status ON translation_team_members(user_id, status)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_translation_team_members_team_status ON translation_team_members(team_id, status)");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS chat_threads (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_message_at BIGINT NOT NULL
    )
  `
  );
  await dbRun("ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS updated_at BIGINT");
  await dbRun("ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS last_message_at BIGINT");
  await dbRun("UPDATE chat_threads SET created_at = ? WHERE created_at IS NULL", [Date.now()]);
  await dbRun("UPDATE chat_threads SET updated_at = ? WHERE updated_at IS NULL", [Date.now()]);
  await dbRun("UPDATE chat_threads SET last_message_at = COALESCE(last_message_at, updated_at, created_at, ?)", [Date.now()]);
  await dbRun("CREATE INDEX IF NOT EXISTS idx_chat_threads_last_message ON chat_threads(last_message_at DESC, id DESC)");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS chat_thread_members (
      thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at BIGINT NOT NULL,
      last_read_message_id INTEGER,
      PRIMARY KEY (thread_id, user_id)
    )
  `
  );
  await dbRun("ALTER TABLE chat_thread_members ADD COLUMN IF NOT EXISTS joined_at BIGINT");
  await dbRun("ALTER TABLE chat_thread_members ADD COLUMN IF NOT EXISTS last_read_message_id INTEGER");
  await dbRun("UPDATE chat_thread_members SET joined_at = ? WHERE joined_at IS NULL", [Date.now()]);
  await dbRun("CREATE INDEX IF NOT EXISTS idx_chat_thread_members_user ON chat_thread_members(user_id)");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      client_request_id TEXT,
      created_at BIGINT NOT NULL
    )
  `
  );
  await dbRun("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS client_request_id TEXT");
  await dbRun("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("UPDATE chat_messages SET created_at = ? WHERE created_at IS NULL", [Date.now()]);
  await dbRun("CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON chat_messages(thread_id, id DESC)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_created ON chat_messages(sender_user_id, created_at DESC)");
  await dbRun(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_sender_request_id ON chat_messages(sender_user_id, client_request_id) WHERE client_request_id IS NOT NULL"
  );
  await dbRun(
    `
      DELETE FROM chat_messages m
      WHERE m.id IN (
        SELECT id
        FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY id DESC) as rn
          FROM chat_messages
        ) ranked
        WHERE ranked.rn > 200
      )
    `
  );

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS auth_identities (
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT,
      display_name TEXT,
      avatar_url TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (provider, provider_user_id)
    )
  `
  );
  await dbRun("ALTER TABLE auth_identities ADD COLUMN IF NOT EXISTS provider TEXT");
  await dbRun("ALTER TABLE auth_identities ADD COLUMN IF NOT EXISTS provider_user_id TEXT");
  await dbRun("ALTER TABLE auth_identities ADD COLUMN IF NOT EXISTS user_id TEXT");
  await dbRun("ALTER TABLE auth_identities ADD COLUMN IF NOT EXISTS email TEXT");
  await dbRun("ALTER TABLE auth_identities ADD COLUMN IF NOT EXISTS display_name TEXT");
  await dbRun("ALTER TABLE auth_identities ADD COLUMN IF NOT EXISTS avatar_url TEXT");
  await dbRun("ALTER TABLE auth_identities ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("ALTER TABLE auth_identities ADD COLUMN IF NOT EXISTS updated_at BIGINT");
  await dbRun(
    "UPDATE auth_identities SET provider = lower(trim(provider)) WHERE provider IS NOT NULL"
  );
  await dbRun("UPDATE auth_identities SET created_at = ? WHERE created_at IS NULL", [Date.now()]);
  await dbRun("UPDATE auth_identities SET updated_at = ? WHERE updated_at IS NULL", [Date.now()]);
  await dbRun(
    "DELETE FROM auth_identities WHERE provider IS NULL OR TRIM(provider) = '' OR provider_user_id IS NULL OR TRIM(provider_user_id) = '' OR user_id IS NULL OR TRIM(user_id) = ''"
  );
  await dbRun("ALTER TABLE auth_identities ALTER COLUMN provider SET NOT NULL");
  await dbRun("ALTER TABLE auth_identities ALTER COLUMN provider_user_id SET NOT NULL");
  await dbRun("ALTER TABLE auth_identities ALTER COLUMN user_id SET NOT NULL");
  await dbRun("ALTER TABLE auth_identities ALTER COLUMN created_at SET NOT NULL");
  await dbRun("ALTER TABLE auth_identities ALTER COLUMN updated_at SET NOT NULL");
  await dbRun(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_identities_provider_subject ON auth_identities(provider, provider_user_id)"
  );
  await dbRun("CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON auth_identities(user_id)");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS reading_history (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      manga_id INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
      chapter_number NUMERIC(10, 3) NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, manga_id)
    )
  `
  );
  await dbRun("ALTER TABLE reading_history ADD COLUMN IF NOT EXISTS user_id TEXT");
  await dbRun("ALTER TABLE reading_history ADD COLUMN IF NOT EXISTS manga_id INTEGER");
  await dbRun("ALTER TABLE reading_history ADD COLUMN IF NOT EXISTS chapter_number NUMERIC(10, 3)");
  await dbRun("ALTER TABLE reading_history ADD COLUMN IF NOT EXISTS updated_at BIGINT");
  await dbRun("DELETE FROM reading_history WHERE user_id IS NULL OR TRIM(user_id) = ''");
  await dbRun("DELETE FROM reading_history WHERE manga_id IS NULL");
  await dbRun("DELETE FROM reading_history WHERE chapter_number IS NULL");
  await dbRun("UPDATE reading_history SET updated_at = ? WHERE updated_at IS NULL", [Date.now()]);
  await dbRun("ALTER TABLE reading_history ALTER COLUMN user_id SET NOT NULL");
  await dbRun("ALTER TABLE reading_history ALTER COLUMN manga_id SET NOT NULL");
  await dbRun("ALTER TABLE reading_history ALTER COLUMN chapter_number SET NOT NULL");
  await dbRun("ALTER TABLE reading_history ALTER COLUMN updated_at SET NOT NULL");
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_reading_history_user_updated ON reading_history(user_id, updated_at DESC)"
  );
  await dbRun("CREATE INDEX IF NOT EXISTS idx_reading_history_manga_id ON reading_history(manga_id)");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS comment_likes (
      comment_id INTEGER NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (comment_id, user_id)
    )
  `
  );
  await dbRun("ALTER TABLE comment_likes ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_comment_likes_user_id ON comment_likes(user_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id)");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS forum_post_bookmarks (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      comment_id INTEGER NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, comment_id)
    )
  `
  );
  await dbRun("ALTER TABLE forum_post_bookmarks ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_forum_post_bookmarks_user_id ON forum_post_bookmarks(user_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_forum_post_bookmarks_comment_id ON forum_post_bookmarks(comment_id)");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS comment_reports (
      comment_id INTEGER NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (comment_id, user_id)
    )
  `
  );
  await dbRun("ALTER TABLE comment_reports ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_comment_reports_user_id ON comment_reports(user_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_comment_reports_comment_id ON comment_reports(comment_id)");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      actor_user_id TEXT,
      manga_id INTEGER REFERENCES manga(id) ON DELETE CASCADE,
      team_id INTEGER,
      chapter_number NUMERIC(10, 3),
      comment_id INTEGER,
      content_preview TEXT,
      is_read BOOLEAN NOT NULL DEFAULT false,
      created_at BIGINT NOT NULL,
      read_at BIGINT
    )
  `
  );
  await dbRun("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id TEXT");
  await dbRun("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT");
  await dbRun("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_user_id TEXT");
  await dbRun("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS manga_id INTEGER");
  await dbRun("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS chapter_number NUMERIC(10, 3)");
  await dbRun("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS comment_id INTEGER");
  await dbRun("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS team_id INTEGER");
  await dbRun("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS content_preview TEXT");
  await dbRun("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN");
  await dbRun("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at BIGINT");
  await dbRun("DELETE FROM notifications WHERE user_id IS NULL OR TRIM(user_id) = ''");
  await dbRun("UPDATE notifications SET type = 'mention' WHERE type IS NULL OR TRIM(type) = ''");
  await dbRun("UPDATE notifications SET is_read = false WHERE is_read IS NULL");
  await dbRun("UPDATE notifications SET created_at = ? WHERE created_at IS NULL", [Date.now()]);
  await dbRun("ALTER TABLE notifications ALTER COLUMN user_id SET NOT NULL");
  await dbRun("ALTER TABLE notifications ALTER COLUMN type SET NOT NULL");
  await dbRun("ALTER TABLE notifications ALTER COLUMN created_at SET NOT NULL");
  await dbRun("ALTER TABLE notifications ALTER COLUMN is_read SET DEFAULT false");
  await dbRun("ALTER TABLE notifications ALTER COLUMN is_read SET NOT NULL");
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)"
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC)"
  );
  await dbRun("CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at)");
  await dbRun(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_comment_type ON notifications(user_id, comment_id, type)"
  );

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS badges (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      color TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      can_access_admin BOOLEAN NOT NULL DEFAULT false,
      can_delete_any_comment BOOLEAN NOT NULL DEFAULT false,
      can_comment BOOLEAN NOT NULL DEFAULT true,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `
  );
  await dbRun("ALTER TABLE badges ADD COLUMN IF NOT EXISTS code TEXT");
  await dbRun("ALTER TABLE badges ADD COLUMN IF NOT EXISTS label TEXT");
  await dbRun("ALTER TABLE badges ADD COLUMN IF NOT EXISTS color TEXT");
  await dbRun("ALTER TABLE badges ADD COLUMN IF NOT EXISTS priority INTEGER");
  await dbRun("ALTER TABLE badges ADD COLUMN IF NOT EXISTS can_access_admin BOOLEAN");
  await dbRun("ALTER TABLE badges ADD COLUMN IF NOT EXISTS can_delete_any_comment BOOLEAN");
  await dbRun("ALTER TABLE badges ADD COLUMN IF NOT EXISTS can_comment BOOLEAN");
  await dbRun("ALTER TABLE badges ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("ALTER TABLE badges ADD COLUMN IF NOT EXISTS updated_at BIGINT");
  await dbRun("UPDATE badges SET priority = 0 WHERE priority IS NULL");
  await dbRun("UPDATE badges SET can_access_admin = false WHERE can_access_admin IS NULL");
  await dbRun("UPDATE badges SET can_delete_any_comment = false WHERE can_delete_any_comment IS NULL");
  await dbRun("UPDATE badges SET can_comment = true WHERE can_comment IS NULL");
  await dbRun("ALTER TABLE badges ALTER COLUMN priority SET DEFAULT 0");
  await dbRun("ALTER TABLE badges ALTER COLUMN can_access_admin SET DEFAULT false");
  await dbRun("ALTER TABLE badges ALTER COLUMN can_delete_any_comment SET DEFAULT false");
  await dbRun("ALTER TABLE badges ALTER COLUMN can_comment SET DEFAULT true");
  await dbRun("ALTER TABLE badges ALTER COLUMN priority SET NOT NULL");
  await dbRun("ALTER TABLE badges ALTER COLUMN can_access_admin SET NOT NULL");
  await dbRun("ALTER TABLE badges ALTER COLUMN can_delete_any_comment SET NOT NULL");
  await dbRun("ALTER TABLE badges ALTER COLUMN can_comment SET NOT NULL");
  await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_badges_code_lower ON badges ((lower(code)))");

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS user_badges (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, badge_id)
    )
  `
  );
  await dbRun("ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS created_at BIGINT");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_user_badges_badge_id ON user_badges(badge_id)");

  const badgeCountRow = await dbGet("SELECT COUNT(*) as count FROM badges");
  if (!badgeCountRow || Number(badgeCountRow.count) === 0) {
    const now = Date.now();
    const defaults = [
      {
        code: "admin",
        label: "Admin",
        color: "#ff6b6b",
        priority: 500,
        canAccessAdmin: true,
        canDeleteAnyComment: true,
        canComment: true
      },
      {
        code: "mod",
        label: "Mod",
        color: "#33d17a",
        priority: 400,
        canAccessAdmin: false,
        canDeleteAnyComment: true,
        canComment: true
      },
      {
        code: "translator",
        label: "Translator",
        color: "#5aa7ff",
        priority: 300,
        canAccessAdmin: false,
        canDeleteAnyComment: false,
        canComment: true
      },
      {
        code: "editor",
        label: "Editor",
        color: "#d79a4a",
        priority: 200,
        canAccessAdmin: false,
        canDeleteAnyComment: false,
        canComment: true
      },
      {
        code: "vip",
        label: "VIP",
        color: "#f7d154",
        priority: 150,
        canAccessAdmin: false,
        canDeleteAnyComment: false,
        canComment: true
      },
      {
        code: "member",
        label: "Member",
        color: "#f8f8f2",
        priority: 100,
        canAccessAdmin: false,
        canDeleteAnyComment: false,
        canComment: true
      },
      {
        code: "banned",
        label: "Banned",
        color: "#8f95a3",
        priority: 10,
        canAccessAdmin: false,
        canDeleteAnyComment: false,
        canComment: false
      }
    ];

    for (const badge of defaults) {
      await dbRun(
        "INSERT INTO badges (code, label, color, priority, can_access_admin, can_delete_any_comment, can_comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          badge.code,
          badge.label,
          badge.color,
          badge.priority,
          Boolean(badge.canAccessAdmin),
          Boolean(badge.canDeleteAnyComment),
          badge.canComment !== false,
          now,
          now
        ]
      );
    }
  }

  const ensuredMemberBadgeRow = await dbGet("SELECT id FROM badges WHERE lower(code) = 'member' LIMIT 1");
  if (!ensuredMemberBadgeRow) {
    const now = Date.now();
    await dbRun(
      "INSERT INTO badges (code, label, color, priority, can_access_admin, can_delete_any_comment, can_comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["member", "Member", "#f8f8f2", 100, false, false, true, now, now]
    );
    resetMemberBadgeCache();
  }

  const ensuredBannedBadgeRow = await dbGet("SELECT id FROM badges WHERE lower(code) = 'banned' LIMIT 1");
  if (!ensuredBannedBadgeRow) {
    const now = Date.now();
    await dbRun(
      "INSERT INTO badges (code, label, color, priority, can_access_admin, can_delete_any_comment, can_comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["banned", "Banned", "#8f95a3", 10, false, false, false, now, now]
    );
  } else {
    await dbRun("UPDATE badges SET can_comment = false WHERE lower(code) = 'banned' AND can_comment <> false");
  }

  // Migrate legacy single-badge users.badge -> user_badges (best-effort).
  const badgeMigrationNow = Date.now();
  await dbRun(
    `
    INSERT INTO user_badges (user_id, badge_id, created_at)
    SELECT u.id, b.id, ?
    FROM users u
    JOIN badges b ON lower(b.label) = lower(u.badge)
    WHERE u.badge IS NOT NULL AND TRIM(u.badge) <> ''
      AND b.code !~* '^team_[0-9]+_(leader|member)$'
    ON CONFLICT DO NOTHING
  `,
    [badgeMigrationNow]
  );

  // Ensure every user has at least Member.
  const memberBadgeRow = await dbGet("SELECT id FROM badges WHERE lower(code) = 'member' LIMIT 1");
  if (memberBadgeRow && memberBadgeRow.id) {
    await dbRun(
      `
      INSERT INTO user_badges (user_id, badge_id, created_at)
      SELECT u.id, ?, ?
      FROM users u
      WHERE u.id IS NOT NULL AND TRIM(u.id) <> ''
      ON CONFLICT DO NOTHING
    `,
      [memberBadgeRow.id, Date.now()]
    );
  }

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS homepage (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      notice_title_1 TEXT,
      notice_body_1 TEXT,
      notice_title_2 TEXT,
      notice_body_2 TEXT,
      featured_ids TEXT,
      updated_at TEXT NOT NULL
    )
  `
  );

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS genres (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL
    )
  `
  );
  await dbRun(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_genres_name_lower ON genres ((lower(name)))"
  );

  await dbRun(
    `
    CREATE TABLE IF NOT EXISTS manga_genres (
      manga_id INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
      genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
      PRIMARY KEY (manga_id, genre_id)
    )
  `
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_manga_genres_genre_id ON manga_genres(genre_id)"
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_manga_genres_manga_id ON manga_genres(manga_id)"
  );

  const oneshotGenreRow = await dbGet(
    "SELECT id FROM genres WHERE lower(name) = lower(?) LIMIT 1",
    [ONESHOT_GENRE_NAME]
  );
  const oneshotGenreId = oneshotGenreRow && oneshotGenreRow.id ? Number(oneshotGenreRow.id) : 0;
  if (Number.isFinite(oneshotGenreId) && oneshotGenreId > 0) {
    await dbRun(
      `
      INSERT INTO manga_genres (manga_id, genre_id)
      SELECT id, ?
      FROM manga
      WHERE COALESCE(is_oneshot, false) = true
      ON CONFLICT DO NOTHING
    `,
      [oneshotGenreId]
    );
  }
  await migrateLegacyGenres();
  await ensureHomepageDefaults();
  await migrateMangaStatuses();
  await migrateMangaSlugs();
  await rebuildCommentReferenceTables();
  await migrateForumRowsToForumPosts();
  await removeForumTagsFromStoredComments();

  await dbRun(
    `
      WITH ranked AS (
        SELECT
          team_id,
          user_id,
          ROW_NUMBER() OVER (
            PARTITION BY team_id
            ORDER BY COALESCE(reviewed_at, requested_at, 0) DESC, requested_at DESC, user_id ASC
          ) AS rn
        FROM translation_team_members
        WHERE role = 'leader'
          AND status = 'approved'
      )
      UPDATE translation_team_members tm
      SET role = 'member'
      FROM ranked r
      WHERE tm.team_id = r.team_id
        AND tm.user_id = r.user_id
        AND r.rn > 1
    `
  );

  await dbRun(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_translation_team_single_approved_leader ON translation_team_members(team_id) WHERE role = 'leader' AND status = 'approved'"
  );

  await dbRun(
    `
      DELETE FROM user_badges ub
      USING badges b
      WHERE ub.badge_id = b.id
        AND b.code ~* '^team_[0-9]+_(leader|member)$'
    `
  );

  const membershipRows = await dbAll(
    `
      SELECT
        tm.team_id,
        tm.user_id,
        tm.role,
        tm.status as member_status,
        t.name as team_name,
        t.status as team_status
      FROM translation_team_members tm
      JOIN translation_teams t ON t.id = tm.team_id
      WHERE tm.user_id IS NOT NULL
        AND TRIM(tm.user_id) <> ''
    `
  );

  for (const row of membershipRows) {
    const teamId = row && row.team_id != null ? Number(row.team_id) : 0;
    const userId = row && row.user_id ? String(row.user_id).trim() : "";
    if (!Number.isFinite(teamId) || teamId <= 0 || !userId) continue;

    const teamStatus = (row && row.team_status ? String(row.team_status) : "").trim().toLowerCase();
    const memberStatus = (row && row.member_status ? String(row.member_status) : "").trim().toLowerCase();
    const isApproved = teamStatus === "approved" && memberStatus === "approved";
    await syncTeamBadgeForMember({
      teamId: Math.floor(teamId),
      teamName: row && row.team_name ? row.team_name : "",
      userId,
      role: row && row.role ? row.role : "member",
      isApproved
    });
  }

  await cleanupForumSampleSeedData();
  await seedForumSampleTopics();
};

  return {
    initDb,
  };
};

module.exports = createInitDbDomain;
