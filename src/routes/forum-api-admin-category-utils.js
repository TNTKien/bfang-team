const createForumApiAdminCategoryUtils = ({ dbGet, dbRun }) => {
  const loadForumAdminCategoryBySlug = async (slug) =>
    dbGet(
      `
        SELECT slug, label, icon, is_system, is_deleted, sort_order
        FROM forum_section_settings
        WHERE slug = ?
        LIMIT 1
      `,
      [slug]
    );

  const loadActiveForumAdminCategoryBySlug = async (slug) =>
    dbGet(
      `
        SELECT slug, is_system
        FROM forum_section_settings
        WHERE slug = ?
          AND COALESCE(is_deleted, FALSE) = FALSE
        LIMIT 1
      `,
      [slug]
    );

  const loadNextForumAdminCategorySortOrder = async () => {
    const row = await dbGet(
      `
        SELECT COALESCE(MAX(sort_order), 0) AS max_sort_order
        FROM forum_section_settings
        WHERE COALESCE(is_deleted, FALSE) = FALSE
      `
    );
    return (Number(row && row.max_sort_order) || 0) + 1;
  };

  const upsertForumAdminCategory = async ({ icon, label, slug, sortOrder }) => {
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
        VALUES (?, ?, ?, TRUE, FALSE, FALSE, ?, NOW(), NOW())
        ON CONFLICT (slug) DO UPDATE
        SET
          label = EXCLUDED.label,
          icon = EXCLUDED.icon,
          is_visible = TRUE,
          is_deleted = FALSE,
          sort_order = EXCLUDED.sort_order,
          updated_at = NOW()
      `,
      [slug, label, icon, sortOrder]
    );
  };

  const ensureForumAdminCategoryExists = async ({
    defaultSection,
    fallbackIcon,
    fallbackLabel,
    slug,
  }) => {
    const existing = await loadForumAdminCategoryBySlug(slug);
    if (existing) return existing;

    const nextSortOrder = await loadNextForumAdminCategorySortOrder();
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
        VALUES (?, ?, ?, TRUE, ?, FALSE, ?, NOW(), NOW())
      `,
      [
        slug,
        defaultSection ? defaultSection.label : fallbackLabel,
        defaultSection ? defaultSection.icon : fallbackIcon,
        Boolean(defaultSection),
        defaultSection ? defaultSection.defaultOrder : nextSortOrder,
      ]
    );

    return loadForumAdminCategoryBySlug(slug);
  };

  const updateForumAdminCategoryBySlug = async ({ slug, updates, values }) => {
    await dbRun(
      `
        UPDATE forum_section_settings
        SET ${updates.join(", ")}, updated_at = NOW()
        WHERE slug = ?
      `,
      [...values, slug]
    );
  };

  const softDeleteForumAdminCategoryBySlug = async (slug) => {
    await dbRun(
      `
        UPDATE forum_section_settings
        SET
          is_deleted = TRUE,
          is_visible = FALSE,
          updated_at = NOW()
        WHERE slug = ?
      `,
      [slug]
    );
  };

  const buildForumAdminCategoryUpdateMutation = ({
    body,
    defaultSection,
    existing,
    sanitizeForumSectionIcon,
    sanitizeForumSectionLabel,
    slug,
    toPositiveInt,
  }) => {
    const payload = body && typeof body === "object" ? body : {};
    const updates = [];
    const values = [];

    const fallbackLabel =
      sanitizeForumSectionLabel(existing && existing.label) ||
      (defaultSection ? defaultSection.label : slug);
    const fallbackIcon =
      sanitizeForumSectionIcon(existing && existing.icon) ||
      (defaultSection ? defaultSection.icon : "💬");

    if (Object.prototype.hasOwnProperty.call(payload, "label")) {
      const nextLabel = sanitizeForumSectionLabel(payload.label) || fallbackLabel;
      updates.push("label = ?");
      values.push(nextLabel);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "icon")) {
      const nextIcon = sanitizeForumSectionIcon(payload.icon) || fallbackIcon;
      updates.push("icon = ?");
      values.push(nextIcon);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "visible")) {
      if (typeof payload.visible !== "boolean") {
        return {
          error: "Trạng thái hiển thị không hợp lệ.",
        };
      }
      updates.push("is_visible = ?");
      values.push(Boolean(payload.visible));
    }

    if (Object.prototype.hasOwnProperty.call(payload, "sortOrder")) {
      const sortOrder = typeof toPositiveInt === "function" ? toPositiveInt(payload.sortOrder, 0) : Number(payload.sortOrder) || 0;
      if (!sortOrder) {
        return {
          error: "Thứ tự danh mục không hợp lệ.",
        };
      }
      updates.push("sort_order = ?");
      values.push(sortOrder);
    }

    updates.push("is_deleted = FALSE");

    if (!updates.length) {
      return {
        error: "Không có dữ liệu cần cập nhật.",
      };
    }

    return {
      updates,
      values,
    };
  };

  return {
    buildForumAdminCategoryUpdateMutation,
    ensureForumAdminCategoryExists,
    loadActiveForumAdminCategoryBySlug,
    loadForumAdminCategoryBySlug,
    loadNextForumAdminCategorySortOrder,
    softDeleteForumAdminCategoryBySlug,
    updateForumAdminCategoryBySlug,
    upsertForumAdminCategory,
  };
};

module.exports = createForumApiAdminCategoryUtils;
