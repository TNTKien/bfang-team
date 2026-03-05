const createForumApiParamUtils = ({ toText }) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const normalizeMentionSearchQuery = (value) =>
    readText(value)
      .replace(/^@+/, "")
      .toLowerCase()
      .slice(0, 40);

  const normalizePositiveInt = (value, fallback = 0) => {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return Math.floor(raw);
  };

  const normalizeForumSort = (value) => {
    const raw = readText(value).toLowerCase();
    if (raw === "new" || raw === "most-commented" || raw === "hot") {
      return raw;
    }
    return "hot";
  };

  const normalizeForumAdminStatus = (value) => {
    const raw = readText(value).toLowerCase();
    if (raw === "visible" || raw === "hidden" || raw === "reported") {
      return raw;
    }
    return "all";
  };

  const normalizeForumAdminSort = (value) => {
    const raw = readText(value).toLowerCase();
    if (raw === "oldest" || raw === "likes" || raw === "reports" || raw === "comments") {
      return raw;
    }
    return "newest";
  };

  const parseBooleanValue = (value, fallback = true) => {
    if (typeof value === "boolean") return value;
    if (value == null) return fallback;

    const normalized = readText(value).toLowerCase();
    if (!normalized) return fallback;
    if (["1", "true", "t", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "f", "no", "n", "off"].includes(normalized)) return false;
    return fallback;
  };

  const normalizeAdminIdList = (input, maxCount = 200) => {
    const values = Array.isArray(input) ? input : [];
    return Array.from(
      new Set(
        values
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))
      )
    ).slice(0, Math.max(1, normalizePositiveInt(maxCount, 200)));
  };

  return {
    normalizeAdminIdList,
    normalizeForumAdminSort,
    normalizeForumAdminStatus,
    normalizeForumSort,
    normalizeMentionSearchQuery,
    normalizePositiveInt,
    parseBooleanValue
  };
};

module.exports = createForumApiParamUtils;
