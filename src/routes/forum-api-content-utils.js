const createForumApiContentUtils = ({ toText }) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const decodeHtmlEntities = (value) =>
    String(value || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");

  const stripSpoilerHtml = (value) =>
    String(value || "").replace(
      /<span\b[^>]*class\s*=\s*(["'])[^"']*\bspoiler\b[^"']*\1[^>]*>[\s\S]*?<\/span>/gi,
      " [spoiler] "
    );

  const stripHtml = (value) => stripSpoilerHtml(value).replace(/<[^>]+>/g, " ");

  const toPlainText = (value) => {
    const decoded = decodeHtmlEntities(value);
    const withoutHtml = stripHtml(decoded);
    return decodeHtmlEntities(withoutHtml).replace(/\s+/g, " ").trim();
  };

  const buildExcerpt = (content, limit = 180) => {
    const compact = toPlainText(content);
    if (compact.length <= limit) return compact;
    return `${compact.slice(0, Math.max(0, limit - 1)).trim()}…`;
  };

  const extractTopicHeadline = (content, limit = 96) => {
    const raw = content == null ? "" : String(content);
    const htmlHeadlineMatch = raw.match(/^\s*<p>\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*<\/p>/i);
    const source = htmlHeadlineMatch ? htmlHeadlineMatch[1] : raw;

    const lines = source
      .split(/\r?\n/)
      .map((line) => toPlainText(line))
      .filter(Boolean);
    if (!lines.length) return "";

    const normalized = lines[0]
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .trim();
    if (!normalized) return "";
    if (normalized.length <= limit) return normalized;
    return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`;
  };

  const FORUM_POST_TITLE_BLOCK_PATTERN = /^\s*<p>\s*<strong[^>]*>[\s\S]*?<\/strong>\s*<\/p>/i;

  const extractForumPostTitleBlock = (content) => {
    const source = readText(content);
    if (!source) return "";
    const match = source.match(FORUM_POST_TITLE_BLOCK_PATTERN);
    return match ? readText(match[0]) : "";
  };

  return {
    buildExcerpt,
    extractForumPostTitleBlock,
    extractTopicHeadline
  };
};

module.exports = createForumApiContentUtils;
