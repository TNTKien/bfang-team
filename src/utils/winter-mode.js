const DEFAULT_FORUM_PATH = "/forum";

const normalizePathname = (value) => {
  const raw = (value == null ? "" : String(value)).trim();
  if (!raw) return "/";

  const pathOnly = raw.split(/[?#]/, 1)[0] || "/";
  return pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
};

const hasPathPrefix = (pathValue, prefix) => {
  const safePath = normalizePathname(pathValue);
  const safePrefix = normalizePathname(prefix);
  return safePath === safePrefix || safePath.startsWith(`${safePrefix}/`);
};

const isAdminForumBridgeRequest = (pathValue, query = {}) => {
  if (normalizePathname(pathValue) !== "/admin") return false;

  const candidates = [query && query.next, query && query.fallback];
  return candidates.some((candidate) => hasPathPrefix(candidate, DEFAULT_FORUM_PATH));
};

const isWinterModeAllowedPath = ({ path, query } = {}) => {
  const pathValue = normalizePathname(path);

  if (hasPathPrefix(pathValue, DEFAULT_FORUM_PATH)) return true;
  if (pathValue === "/m/forum" || hasPathPrefix(pathValue, "/m/forum/post")) return true;

  if (hasPathPrefix(pathValue, "/admin")) return true;
  if (hasPathPrefix(pathValue, "/auth")) return true;
  if (hasPathPrefix(pathValue, "/notifications")) return true;
  if (pathValue === "/messages/unread-count" || pathValue === "/messages/stream") return true;

  if (isAdminForumBridgeRequest(pathValue, query)) return true;

  return false;
};

const createWinterModeMiddleware = ({
  enabled,
  forumPath = DEFAULT_FORUM_PATH,
  wantsJson,
} = {}) => {
  if (!enabled) {
    return (_req, _res, next) => next();
  }

  const redirectPath = normalizePathname(forumPath || DEFAULT_FORUM_PATH);

  return (req, res, next) => {
    if (isWinterModeAllowedPath({ path: req && req.path, query: req && req.query })) {
      return next();
    }

    res.set("X-Web-Winter-Mode", "1");
    const method = (req && req.method ? req.method : "GET").toString().trim().toUpperCase();
    const shouldReturnJson =
      (typeof wantsJson === "function" && wantsJson(req)) || (method !== "GET" && method !== "HEAD");

    if (shouldReturnJson) {
      return res.status(503).json({
        ok: false,
        error: "Website đang ở chế độ nghỉ đông. Forum vẫn hoạt động.",
        forumPath: redirectPath,
      });
    }

    return res.redirect(302, redirectPath);
  };
};

module.exports = {
  DEFAULT_FORUM_PATH,
  createWinterModeMiddleware,
  isWinterModeAllowedPath,
  normalizePathname,
};
