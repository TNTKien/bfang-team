const createForumApiImageUtils = ({ toText, getB2Config }) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const normalizeAbsoluteHttpBaseUrl = (value) => {
    const raw = readText(value);
    if (!raw) return "";

    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      const pathname = (parsed.pathname || "/").replace(/\/+$/, "");
      return `${parsed.protocol}//${parsed.host}${pathname}`;
    } catch (_err) {
      return "";
    }
  };

  const resolveForumImageBaseUrl = (config) => {
    const forumBase = normalizeAbsoluteHttpBaseUrl(config && config.forumCdnBaseUrl);
    if (forumBase) return forumBase;
    const chapterBase = normalizeAbsoluteHttpBaseUrl(config && config.cdnBaseUrl);
    if (chapterBase) return chapterBase;
    const endpointBase = normalizeAbsoluteHttpBaseUrl(config && config.endpoint);
    if (endpointBase) return endpointBase;
    return "";
  };

  const safeDecodeUrlPath = (input) => {
    try {
      return decodeURIComponent(input || "");
    } catch (_err) {
      return String(input || "");
    }
  };

  const isManagedForumPathSegment = ({ segments, index, forumPrefix, chapterPrefix }) => {
    const current = segments[index] || "";
    const next = segments[index + 1] || "";
    const third = segments[index + 2] || "";

    if (current === forumPrefix) {
      return next === "posts" || (next === "tmp" && third === "posts");
    }
    if (current === chapterPrefix) {
      return next === "forum-posts" || (next === "tmp" && third === "forum-posts");
    }
    return false;
  };

  const normalizeObjectKeyFromPath = (pathValue, config, options = {}) => {
    const decodedPath = safeDecodeUrlPath(pathValue).replace(/^\/+/, "");
    if (!decodedPath) return "";

    const segments = decodedPath.split("/").filter(Boolean);
    if (!segments.length) return "";

    const bucketId = readText(config && config.bucketId);
    const forumPrefix = readText(config && config.forumPrefix).replace(/^\/+/, "").replace(/\/+$/, "") || "forum";
    const chapterPrefix =
      readText(config && config.chapterPrefix).replace(/^\/+/, "").replace(/\/+$/, "") || "chapters";
    const allowManagedPathSearch = Boolean(options.allowManagedPathSearch);

    const maybeStripManagedPrefix = (parts) => {
      if (!allowManagedPathSearch) {
        return parts.join("/");
      }
      const startIndex = parts.findIndex((_, index) =>
        isManagedForumPathSegment({ segments: parts, index, forumPrefix, chapterPrefix })
      );
      if (startIndex > 0) {
        return parts.slice(startIndex).join("/");
      }
      return parts.join("/");
    };

    if (bucketId && segments[0] === "file" && segments[1] === bucketId && segments.length > 2) {
      return maybeStripManagedPrefix(segments.slice(2));
    }

    if (bucketId && segments[0] === bucketId && segments.length > 1) {
      return maybeStripManagedPrefix(segments.slice(1));
    }

    if (segments[0] === "file" && segments.length > 2) {
      return maybeStripManagedPrefix(segments.slice(2));
    }

    return maybeStripManagedPrefix(segments);
  };

  const extractManagedForumKeyFromString = (value, config) => {
    const decoded = safeDecodeUrlPath(readText(value));
    if (!decoded) return "";

    const forumPrefix = readText(config && config.forumPrefix).replace(/^\/+/, "").replace(/\/+$/, "") || "forum";
    const chapterPrefix =
      readText(config && config.chapterPrefix).replace(/^\/+/, "").replace(/\/+$/, "") || "chapters";

    const patterns = [
      new RegExp(`(${escapeRegex(forumPrefix)}\\/(?:posts|tmp\\/posts)\\/[A-Za-z0-9._~!$&'()*+,;=:@\\/%-]+)`, "i"),
      new RegExp(
        `(${escapeRegex(chapterPrefix)}\\/(?:forum-posts|tmp\\/forum-posts)\\/[A-Za-z0-9._~!$&'()*+,;=:@\\/%-]+)`,
        "i"
      )
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

  const extractObjectKeyFromUrlLike = (value) => {
    const raw = readText(value);
    if (!raw) return "";

    const config = typeof getB2Config === "function" ? getB2Config() : null;

    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        const fromPath = normalizeObjectKeyFromPath(parsed.pathname || "", config, { allowManagedPathSearch: true });
        const extracted = extractManagedForumKeyFromString(fromPath || `${parsed.pathname || ""}${parsed.search || ""}`, config);
        return extracted || fromPath;
      } catch (_err) {
        return extractManagedForumKeyFromString(raw, config);
      }
    }

    if (/^\/\//.test(raw)) {
      try {
        const parsed = new URL(`https:${raw}`);
        const fromPath = normalizeObjectKeyFromPath(parsed.pathname || "", config, { allowManagedPathSearch: true });
        const extracted = extractManagedForumKeyFromString(fromPath || `${parsed.pathname || ""}${parsed.search || ""}`, config);
        return extracted || fromPath;
      } catch (_err) {
        return extractManagedForumKeyFromString(raw, config);
      }
    }

    const fromPath = normalizeObjectKeyFromPath(raw.split(/[?#]/)[0], config, { allowManagedPathSearch: true });
    const extracted = extractManagedForumKeyFromString(raw, config);
    return extracted || fromPath;
  };

  const replaceImageSourceByKey = ({ content, sourceKey, replacementUrl }) => {
    const targetKey = readText(sourceKey).replace(/^\/+/, "");
    const nextUrl = readText(replacementUrl);
    if (!targetKey || !nextUrl) {
      return { content: String(content || ""), replaced: false };
    }

    let replaced = false;
    const output = String(content || "").replace(
      /(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
      (full, start, currentUrl, end) => {
        const currentKey = extractObjectKeyFromUrlLike(currentUrl);
        if (currentKey !== targetKey) return full;
        replaced = true;
        return `${start}${nextUrl}${end}`;
      }
    );

    return { content: output, replaced };
  };

  const contentHasImageKey = (content, key) => {
    const probe = replaceImageSourceByKey({
      content,
      sourceKey: key,
      replacementUrl: "__key_probe__"
    });
    return Boolean(probe && probe.replaced);
  };

  const listImageKeysFromContent = (content) => {
    const keys = new Set();
    String(content || "").replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, (_fullMatch, srcValue) => {
      const key = extractObjectKeyFromUrlLike(srcValue);
      if (key) {
        keys.add(key.replace(/^\/+/, ""));
      }
      return "";
    });
    return Array.from(keys);
  };

  const isForumManagedImageKey = (key, config) => {
    const normalizedKey = readText(key).replace(/^\/+/, "");
    if (!normalizedKey) return false;

    const forumPrefix = readText(config && config.forumPrefix).replace(/^\/+/, "").replace(/\/+$/, "") || "forum";
    const chapterPrefix =
      readText(config && config.chapterPrefix).replace(/^\/+/, "").replace(/\/+$/, "") || "chapters";

    return (
      normalizedKey.startsWith(`${forumPrefix}/posts/`) ||
      normalizedKey.startsWith(`${forumPrefix}/tmp/posts/`) ||
      normalizedKey.startsWith(`${chapterPrefix}/forum-posts/`) ||
      normalizedKey.startsWith(`${chapterPrefix}/tmp/forum-posts/`)
    );
  };

  const getRemovedForumImageKeys = ({ beforeContent, nextContent, config }) => {
    const previousKeys = new Set(
      listImageKeysFromContent(beforeContent).filter((key) => isForumManagedImageKey(key, config))
    );
    if (!previousKeys.size) return [];

    const currentKeys = new Set(listImageKeysFromContent(nextContent).filter((key) => isForumManagedImageKey(key, config)));
    return Array.from(previousKeys).filter((key) => !currentKeys.has(key));
  };

  const expandForumImageKeyCandidates = (value, config) => {
    const raw = readText(value);
    if (!raw) return [];

    const candidates = new Set();
    const addCandidate = (inputValue) => {
      const text = readText(inputValue);
      if (!text) return;

      const normalizedPath = normalizeObjectKeyFromPath(text, config, { allowManagedPathSearch: true });
      if (normalizedPath) {
        candidates.add(normalizedPath);
      }

      const extracted = extractManagedForumKeyFromString(text, config);
      if (extracted) {
        candidates.add(extracted);
      }
    };

    addCandidate(raw);

    const withoutQuery = raw.split(/[?#]/)[0];
    if (withoutQuery && withoutQuery !== raw) {
      addCandidate(withoutQuery);
    }

    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        addCandidate(`${parsed.pathname || ""}${parsed.search || ""}`);
      } catch (_err) {
        // ignore parse errors
      }
    } else if (/^\/\//.test(raw)) {
      try {
        const parsed = new URL(`https:${raw}`);
        addCandidate(`${parsed.pathname || ""}${parsed.search || ""}`);
      } catch (_err) {
        // ignore parse errors
      }
    }

    return Array.from(candidates).filter(Boolean);
  };

  const normalizeRequestedRemovedImageKeys = (value, config) => {
    return Array.from(
      new Set(
        (Array.isArray(value) ? value : [])
          .flatMap((item) => expandForumImageKeyCandidates(item, config))
          .filter((key) => isForumManagedImageKey(key, config))
      )
    );
  };

  const replaceAllLiteral = (sourceText, fromValue, toValue) => {
    const fromText = readText(fromValue);
    if (!fromText) return sourceText;
    return String(sourceText || "").replace(new RegExp(escapeRegex(fromText), "g"), String(toValue || ""));
  };

  return {
    contentHasImageKey,
    expandForumImageKeyCandidates,
    extractObjectKeyFromUrlLike,
    getRemovedForumImageKeys,
    isForumManagedImageKey,
    listImageKeysFromContent,
    normalizeRequestedRemovedImageKeys,
    replaceAllLiteral,
    replaceImageSourceByKey,
    resolveForumImageBaseUrl
  };
};

module.exports = createForumApiImageUtils;
