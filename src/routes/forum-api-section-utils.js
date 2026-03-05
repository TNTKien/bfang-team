const createForumApiSectionUtils = ({
  dbAll,
  dbRun,
  formatTimeAgo,
  forumRequestIdLike,
  parseBooleanValue,
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

  const parseBoolean =
    typeof parseBooleanValue === "function"
      ? (value, fallback) => parseBooleanValue(value, fallback)
      : (value, fallback = true) => {
          if (typeof value === "boolean") return value;
          if (value == null) return fallback;
          const normalized = readText(value).toLowerCase();
          if (!normalized) return fallback;
          if (["1", "true", "t", "yes", "y", "on"].includes(normalized)) return true;
          if (["0", "false", "f", "no", "n", "off"].includes(normalized)) return false;
          return fallback;
        };

  const FORUM_ADMIN_SECTION_OPTIONS = Object.freeze([
    { slug: "thao-luan-chung", label: "Thảo luận chung", icon: "💬" },
    { slug: "thong-bao", label: "Thông báo", icon: "📢" },
    { slug: "huong-dan", label: "Hướng dẫn", icon: "📘" },
    { slug: "tim-truyen", label: "Tìm truyện", icon: "🔎" },
    { slug: "gop-y", label: "Góp ý", icon: "💡" },
    { slug: "tam-su", label: "Tâm sự", icon: "🫶" },
    { slug: "chia-se", label: "Chia sẻ", icon: "🤝" }
  ]);

  const FORUM_ADMIN_SECTION_DEFAULT_BY_SLUG = new Map(
    FORUM_ADMIN_SECTION_OPTIONS.map((item, index) => [item.slug, { ...item, defaultOrder: index + 1 }])
  );
  const FORUM_ADMIN_SECTION_LABEL_BY_SLUG = new Map(
    FORUM_ADMIN_SECTION_OPTIONS.map((item) => [item.slug, item.label])
  );

  const sanitizeForumSectionLabel = (value) => {
    const text = readText(value).replace(/\s+/g, " ").trim();
    return text.slice(0, 64);
  };

  const sanitizeForumSectionIcon = (value) => {
    const text = readText(value).replace(/\s+/g, "");
    if (!text) return "";
    return Array.from(text).slice(0, 2).join("");
  };

  const sanitizeForumSectionSlug = (value) =>
    readText(value)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);

  const buildForumSectionLabelFromSlug = (slugValue) => {
    const safeSlug = sanitizeForumSectionSlug(slugValue);
    if (!safeSlug) return "Thảo luận chung";
    return safeSlug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  };

  const FORUM_SECTION_SLUG_ALIASES = new Map([
    ["goi-y", "gop-y"],
    ["tin-tuc", "thong-bao"]
  ]);
  const FORUM_META_COMMENT_PATTERN = /<!--\s*forum-meta:([^>]*?)\s*-->/gi;

  const normalizeForumSectionSlug = (value) => {
    const slug = sanitizeForumSectionSlug(value);
    if (!slug) return "";
    const alias = FORUM_SECTION_SLUG_ALIASES.get(slug);
    return alias || slug;
  };

  const extractForumSectionSlug = (content) => {
    let resolved = "";
    String(content || "").replace(FORUM_META_COMMENT_PATTERN, (_fullMatch, payloadText) => {
      if (resolved) return "";
      const payload = readText(payloadText);
      if (!payload) return "";

      const pairs = payload
        .split(";")
        .map((item) => readText(item))
        .filter(Boolean);
      for (const pair of pairs) {
        const equalIndex = pair.indexOf("=");
        if (equalIndex <= 0) continue;
        const key = pair.slice(0, equalIndex).trim().toLowerCase();
        const value = pair.slice(equalIndex + 1).trim();
        if (key !== "section") continue;
        const slug = normalizeForumSectionSlug(value);
        if (slug) {
          resolved = slug;
          break;
        }
      }

      return "";
    });
    return resolved;
  };

  const normalizeForumAdminSection = (value) => {
    const slug = normalizeForumSectionSlug(value);
    return slug || "all";
  };

  let forumSectionSettingsTableReadyPromise = null;

  const ensureForumSectionSettingsTable = async () => {
    if (forumSectionSettingsTableReadyPromise) {
      return forumSectionSettingsTableReadyPromise;
    }

    forumSectionSettingsTableReadyPromise = dbRun(
      `
        CREATE TABLE IF NOT EXISTS forum_section_settings (
          slug TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          icon TEXT NOT NULL,
          is_visible BOOLEAN NOT NULL DEFAULT TRUE,
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
    )
      .then(async () => {
        await dbRun(
          "ALTER TABLE forum_section_settings ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE"
        );
        await dbRun(
          "ALTER TABLE forum_section_settings ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE"
        );
        await dbRun(
          "ALTER TABLE forum_section_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
        );

        for (const [slug, item] of FORUM_ADMIN_SECTION_DEFAULT_BY_SLUG.entries()) {
          await dbRun(
            `
              INSERT INTO forum_section_settings (
                slug,
                label,
                icon,
                is_visible,
                is_system,
                is_deleted,
                sort_order,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, TRUE, TRUE, FALSE, ?, NOW(), NOW())
              ON CONFLICT (slug) DO UPDATE
              SET
                is_system = TRUE,
                label = CASE
                  WHEN COALESCE(TRIM(forum_section_settings.label), '') = '' THEN EXCLUDED.label
                  ELSE forum_section_settings.label
                END,
                icon = CASE
                  WHEN COALESCE(TRIM(forum_section_settings.icon), '') = '' THEN EXCLUDED.icon
                  ELSE forum_section_settings.icon
                END,
                sort_order = CASE
                  WHEN COALESCE(forum_section_settings.sort_order, 0) <= 0 THEN EXCLUDED.sort_order
                  ELSE forum_section_settings.sort_order
                END,
                created_at = COALESCE(forum_section_settings.created_at, NOW())
            `,
            [slug, item.label, item.icon, item.defaultOrder]
          );
        }
      })
      .catch((err) => {
        forumSectionSettingsTableReadyPromise = null;
        throw err;
      });

    return forumSectionSettingsTableReadyPromise;
  };

  const loadForumAdminSections = async () => {
    await ensureForumSectionSettingsTable();

    const rows = await dbAll(
      `
        SELECT
          slug,
          label,
          icon,
          is_visible,
          is_system,
          is_deleted,
          sort_order,
          created_at,
          updated_at
        FROM forum_section_settings
        WHERE COALESCE(is_deleted, FALSE) = FALSE
      `
    );

    const sections = (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const rawSlug = sanitizeForumSectionSlug(row && row.slug);
        if (!rawSlug) return null;
        const systemDefaults = FORUM_ADMIN_SECTION_DEFAULT_BY_SLUG.get(rawSlug);
        const sortOrderRaw = Number(row && row.sort_order);
        const sortOrder =
          Number.isFinite(sortOrderRaw) && sortOrderRaw > 0
            ? Math.floor(sortOrderRaw)
            : systemDefaults
              ? systemDefaults.defaultOrder
              : 9999;

        const label =
          sanitizeForumSectionLabel(row && row.label) ||
          (systemDefaults ? systemDefaults.label : rawSlug);

        const icon =
          sanitizeForumSectionIcon(row && row.icon) ||
          (systemDefaults ? systemDefaults.icon : "💬");

        return {
          slug: rawSlug,
          label,
          icon,
          visible: parseBoolean(row && row.is_visible, true),
          isSystem: parseBoolean(row && row.is_system, false),
          sortOrder,
          createdAt: toIsoValue(row && row.created_at),
          updatedAt: toIsoValue(row && row.updated_at)
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        const leftDefaultOrder = FORUM_ADMIN_SECTION_DEFAULT_BY_SLUG.get(left.slug);
        const rightDefaultOrder = FORUM_ADMIN_SECTION_DEFAULT_BY_SLUG.get(right.slug);
        return (leftDefaultOrder ? leftDefaultOrder.defaultOrder : 0) -
          (rightDefaultOrder ? rightDefaultOrder.defaultOrder : 0);
      });

    const labelBySlug = new Map(sections.map((item) => [item.slug, item.label]));

    return {
      sections,
      labelBySlug
    };
  };

  const buildForumAdminSectionStatsMap = async (knownSlugs = []) => {
    const rows = await dbAll(
      `
        SELECT c.content, c.status, c.report_count, c.created_at
        FROM comments c
        WHERE c.parent_id IS NULL
          AND COALESCE(c.client_request_id, '') ILIKE ?
      `,
      [forumRequestIdLike || "forum-%"]
    );

    const statsBySlug = new Map(
      (Array.isArray(knownSlugs) ? knownSlugs : []).map((slug) => [
        slug,
        {
          postCount: 0,
          hiddenPostCount: 0,
          reportCount: 0,
          lastPostAt: "",
          lastPostTimeAgo: ""
        }
      ])
    );

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const rawSlug = extractForumSectionSlug(readText(row && row.content));
      const sectionSlug = rawSlug || "thao-luan-chung";
      if (!statsBySlug.has(sectionSlug)) {
        statsBySlug.set(sectionSlug, {
          postCount: 0,
          hiddenPostCount: 0,
          reportCount: 0,
          lastPostAt: "",
          lastPostTimeAgo: ""
        });
      }
      const bucket = statsBySlug.get(sectionSlug);
      if (!bucket) return;

      bucket.postCount += 1;
      bucket.reportCount += Number(row && row.report_count) || 0;
      if (readText(row && row.status).toLowerCase() === "reported") {
        bucket.hiddenPostCount += 1;
      }

      const createdAtRaw = readText(row && row.created_at);
      if (!createdAtRaw) return;

      const currentTime = new Date(createdAtRaw).getTime();
      const previousTime = bucket.lastPostAt ? new Date(bucket.lastPostAt).getTime() : 0;
      if (!Number.isFinite(currentTime) || (Number.isFinite(previousTime) && previousTime >= currentTime)) {
        return;
      }

      bucket.lastPostAt = toIsoValue(createdAtRaw);
      bucket.lastPostTimeAgo = typeof formatTimeAgo === "function" ? formatTimeAgo(createdAtRaw) : createdAtRaw;
    });

    return statsBySlug;
  };

  return {
    FORUM_ADMIN_SECTION_DEFAULT_BY_SLUG,
    FORUM_ADMIN_SECTION_LABEL_BY_SLUG,
    buildForumAdminSectionStatsMap,
    buildForumSectionLabelFromSlug,
    extractForumSectionSlug,
    loadForumAdminSections,
    normalizeForumAdminSection,
    normalizeForumSectionSlug,
    sanitizeForumSectionIcon,
    sanitizeForumSectionLabel,
    sanitizeForumSectionSlug
  };
};

module.exports = createForumApiSectionUtils;
