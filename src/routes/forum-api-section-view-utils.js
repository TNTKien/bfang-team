const createForumApiSectionViewUtils = ({ toText }) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const buildSectionMetaBySlug = (sections) =>
    new Map(
      (Array.isArray(sections) ? sections : []).map((section) => [
        section.slug,
        {
          label: section.label,
          icon: section.icon,
        },
      ])
    );

  const resolveVisiblePostCount = ({ sectionStatsBySlug, slug }) => {
    const stats = sectionStatsBySlug && sectionStatsBySlug.get(slug)
      ? sectionStatsBySlug.get(slug)
      : {
          postCount: 0,
          hiddenPostCount: 0,
        };
    return Math.max(
      0,
      (Number(stats.postCount) || 0) - (Number(stats.hiddenPostCount) || 0)
    );
  };

  const buildHomeCategoryItems = ({ sectionStatsBySlug, sections }) =>
    (Array.isArray(sections) ? sections : [])
      .filter((section) => section && section.visible)
      .map((section, index) => ({
        id: index + 1,
        name: readText(section.label),
        slug: readText(section.slug),
        postCount: resolveVisiblePostCount({
          sectionStatsBySlug,
          slug: section && section.slug,
        }),
      }));

  const buildHomeSectionItems = ({ sectionStatsBySlug, sections }) =>
    (Array.isArray(sections) ? sections : [])
      .filter((section) => section && section.visible)
      .map((section, index) => ({
        id: index + 1,
        slug: section.slug,
        label: section.label,
        icon: section.icon,
        visible: section.visible,
        isSystem: section.isSystem,
        postCount: resolveVisiblePostCount({
          sectionStatsBySlug,
          slug: section && section.slug,
        }),
      }));

  const buildForumSectionItems = (sections) =>
    (Array.isArray(sections) ? sections : []).map((section, index) => ({
      id: index + 1,
      slug: section.slug,
      label: section.label,
      icon: section.icon,
      visible: section.visible,
      isSystem: section.isSystem,
    }));

  const mapForumAdminCategory = (section) => {
    if (!section || typeof section !== "object") return null;
    return {
      slug: readText(section.slug),
      label: readText(section.label),
      icon: readText(section.icon),
      visible: Boolean(section.visible),
      isSystem: Boolean(section.isSystem),
      sortOrder: Number(section.sortOrder) || 0,
    };
  };

  const mapForumAdminCategoryWithStats = ({ section, stats }) => {
    const mapped = mapForumAdminCategory(section);
    if (!mapped) return null;

    const safeStats = stats || {
      postCount: 0,
      hiddenPostCount: 0,
      reportCount: 0,
      lastPostAt: "",
      lastPostTimeAgo: "",
    };

    return {
      ...mapped,
      postCount: Number(safeStats.postCount) || 0,
      hiddenPostCount: Number(safeStats.hiddenPostCount) || 0,
      reportCount: Number(safeStats.reportCount) || 0,
      lastPostAt: readText(safeStats.lastPostAt),
      lastPostTimeAgo: readText(safeStats.lastPostTimeAgo),
    };
  };

  return {
    buildForumSectionItems,
    buildHomeCategoryItems,
    buildHomeSectionItems,
    mapForumAdminCategory,
    mapForumAdminCategoryWithStats,
    buildSectionMetaBySlug,
  };
};

module.exports = createForumApiSectionViewUtils;
