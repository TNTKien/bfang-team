const createForumApiAdminPostEditUtils = ({
  escapeHtml,
  extractForumSectionSlug,
  getRemovedForumImageKeys,
  normalizeForumSectionSlug,
  normalizeRequestedRemovedImageKeys,
  toText,
}) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const normalizeSectionSlug =
    typeof normalizeForumSectionSlug === "function"
      ? (value) => normalizeForumSectionSlug(value)
      : (value) => readText(value);

  const extractSectionSlug =
    typeof extractForumSectionSlug === "function"
      ? (value) => extractForumSectionSlug(value)
      : () => "";

  const buildAdminPostUpdatePayload = ({ availableSectionSlugs, body, config, postRow }) => {
    const title = readText(body && body.title).replace(/\s+/g, " ").slice(0, 300);
    if (!title) {
      return { error: "Tiêu đề bài viết không hợp lệ." };
    }

    const content = readText(body && body.content);
    if (!content || content === "<p></p>") {
      return { error: "Nội dung bài viết không được để trống." };
    }

    const availableSlugs = new Set(Array.isArray(availableSectionSlugs) ? availableSectionSlugs : []);
    const requestedSectionSlug = normalizeSectionSlug(body && body.sectionSlug);

    let sectionSlug = requestedSectionSlug;
    if (!sectionSlug || !availableSlugs.has(sectionSlug)) {
      sectionSlug = extractSectionSlug(readText(postRow && postRow.content)) || "thao-luan-chung";
    }
    if (!sectionSlug || !availableSlugs.has(sectionSlug)) {
      sectionSlug = "thao-luan-chung";
    }

    const nextContent = `<p><strong>${escapeHtml(title)}</strong></p><!--forum-meta:section=${sectionSlug}-->${content}`;
    const removedImageKeys = Array.from(
      new Set([
        ...getRemovedForumImageKeys({
          beforeContent: postRow && postRow.content,
          nextContent,
          config,
        }),
        ...normalizeRequestedRemovedImageKeys(body && body.removedImageKeys ? body.removedImageKeys : [], config),
      ])
    );

    return {
      nextContent,
      removedImageKeys,
      sectionSlug,
    };
  };

  return {
    buildAdminPostUpdatePayload,
  };
};

module.exports = createForumApiAdminPostEditUtils;
