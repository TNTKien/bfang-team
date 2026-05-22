const DEFAULT_FORUM_PATH = "/forum";
const WEB_UNLOCK_COOKIE_NAME = "moetruyen_full_web";
const WEB_UNLOCK_HEADER_NAME = "x-moetruyen-full-web";
const WEB_UNLOCK_RETURN_PARAM = "__moe_web_return";

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

const isTruthyFlag = (value) => {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const normalizeHeaderName = (value) => String(value == null ? "" : value).trim().toLowerCase();

const getHeaderValue = (headers, headerName) => {
  if (!headers || typeof headers !== "object") return "";
  const normalizedHeaderName = normalizeHeaderName(headerName);
  if (!normalizedHeaderName) return "";

  const directValue = headers[normalizedHeaderName] || headers[headerName];
  if (directValue !== undefined) return Array.isArray(directValue) ? directValue.join(";") : String(directValue);

  const matchedKey = Object.keys(headers).find((key) => normalizeHeaderName(key) === normalizedHeaderName);
  if (!matchedKey) return "";
  const matchedValue = headers[matchedKey];
  return Array.isArray(matchedValue) ? matchedValue.join(";") : String(matchedValue);
};

const parseCookieHeader = (cookieHeader) => {
  const cookies = {};
  String(cookieHeader || "")
    .split(";")
    .forEach((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) return;

      const name = entry.slice(0, separatorIndex).trim();
      if (!name) return;

      const rawValue = entry.slice(separatorIndex + 1).trim();
      try {
        cookies[name] = decodeURIComponent(rawValue);
      } catch (_err) {
        cookies[name] = rawValue;
      }
    });

  return cookies;
};

const getRequestCookieValue = (req, cookieName) => {
  const safeCookieName = String(cookieName || "").trim();
  if (!safeCookieName || !req) return "";

  if (req.cookies && Object.prototype.hasOwnProperty.call(req.cookies, safeCookieName)) {
    return String(req.cookies[safeCookieName] == null ? "" : req.cookies[safeCookieName]).trim();
  }

  const parsedCookies = parseCookieHeader(getHeaderValue(req.headers, "cookie"));
  return String(parsedCookies[safeCookieName] == null ? "" : parsedCookies[safeCookieName]).trim();
};

const normalizeBypassToken = (value) => String(value == null ? "" : value).trim();

const isValidBypassMarker = (value, expectedToken = "") => {
  const marker = normalizeBypassToken(value);
  if (!marker) return false;

  const token = normalizeBypassToken(expectedToken);
  if (token) return marker === token;

  return isTruthyFlag(marker);
};

const isWinterModeBypassRequest = (req, options = {}) => {
  if (!req) return false;

  const cookieName = options.cookieName || WEB_UNLOCK_COOKIE_NAME;
  const headerName = options.headerName || WEB_UNLOCK_HEADER_NAME;
  const expectedToken = options.token || "";

  return (
    isValidBypassMarker(getRequestCookieValue(req, cookieName), expectedToken) ||
    isValidBypassMarker(getHeaderValue(req.headers, headerName), expectedToken)
  );
};

const isAdminForumBridgeRequest = (pathValue, query = {}) => {
  if (normalizePathname(pathValue) !== "/admin") return false;

  const candidates = [query && query.next, query && query.fallback];
  return candidates.some((candidate) => hasPathPrefix(candidate, DEFAULT_FORUM_PATH));
};

const isForumLegacyCommentActionPath = (pathValue) => (
  /^\/comments\/(?:reactions|[1-9][0-9]*\/(?:delete|edit|like|report))$/i.test(normalizePathname(pathValue))
);

const isForumModeRequest = ({ body } = {}) => Boolean(body && isTruthyFlag(body.forumMode));

const isWinterModeAllowedPath = ({ path, query, body } = {}) => {
  const pathValue = normalizePathname(path);

  if (hasPathPrefix(pathValue, DEFAULT_FORUM_PATH)) return true;
  if (pathValue === "/m/forum" || hasPathPrefix(pathValue, "/m/forum/post")) return true;

  if (hasPathPrefix(pathValue, "/admin")) return true;
  if (hasPathPrefix(pathValue, "/auth")) return true;
  if (hasPathPrefix(pathValue, "/notifications")) return true;
  if (pathValue === "/messages/unread-count" || pathValue === "/messages/stream") return true;
  if (hasPathPrefix(pathValue, "/user")) return true;
  if (hasPathPrefix(pathValue, "/comments/users")) return true;
  if (isForumLegacyCommentActionPath(pathValue) && isForumModeRequest({ body })) return true;

  if (isAdminForumBridgeRequest(pathValue, query)) return true;

  return false;
};

const normalizeReturnPath = (value) => {
  const raw = String(value == null ? "" : value).trim();
  if (!raw || raw.length > 1000) return "";

  let parsed = null;
  try {
    parsed = new URL(raw, "http://localhost");
  } catch (_err) {
    return "";
  }

  if (parsed.origin !== "http://localhost") return "";
  const pathname = parsed.pathname || "/";
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return "";

  return `${pathname}${parsed.search || ""}`;
};

const buildWinterModeRedirectPath = ({ forumPath = DEFAULT_FORUM_PATH, originalUrl = "" } = {}) => {
  const redirectPath = normalizePathname(forumPath || DEFAULT_FORUM_PATH);
  const returnPath = normalizeReturnPath(originalUrl);
  if (!returnPath || hasPathPrefix(returnPath, redirectPath)) {
    return redirectPath;
  }

  const params = new URLSearchParams();
  params.set(WEB_UNLOCK_RETURN_PARAM, returnPath);
  return `${redirectPath}?${params.toString()}`;
};

const createWinterModeMiddleware = ({
  enabled,
  bypassCookieName = WEB_UNLOCK_COOKIE_NAME,
  bypassHeaderName = WEB_UNLOCK_HEADER_NAME,
  bypassToken = "",
  forumPath = DEFAULT_FORUM_PATH,
  onBypass,
  wantsJson,
} = {}) => {
  if (!enabled) {
    return (_req, _res, next) => next();
  }

  const redirectPath = normalizePathname(forumPath || DEFAULT_FORUM_PATH);

  return (req, res, next) => {
    if (isWinterModeBypassRequest(req, {
      cookieName: bypassCookieName,
      headerName: bypassHeaderName,
      token: bypassToken
    })) {
      if (res && typeof res.set === "function") {
        res.set("X-Web-Winter-Mode-Bypass", "1");
      }
      if (typeof onBypass === "function") {
        onBypass(req, res);
      }
      return next();
    }

    if (isWinterModeAllowedPath({ path: req && req.path, query: req && req.query, body: req && req.body })) {
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

    return res.redirect(302, buildWinterModeRedirectPath({
      forumPath: redirectPath,
      originalUrl: req && req.originalUrl
    }));
  };
};

module.exports = {
  DEFAULT_FORUM_PATH,
  WEB_UNLOCK_COOKIE_NAME,
  WEB_UNLOCK_HEADER_NAME,
  WEB_UNLOCK_RETURN_PARAM,
  buildWinterModeRedirectPath,
  createWinterModeMiddleware,
  isWinterModeBypassRequest,
  isWinterModeAllowedPath,
  normalizePathname,
};
