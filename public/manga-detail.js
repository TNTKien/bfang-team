(() => {
  const BOUND_SHARE_ATTR = "data-manga-share-bound";
  const BOUND_SHARE_KEY = "__bfangShareBound";
  const BOUND_SHARE_HANDLER_KEY = "__bfangShareHandler";
  const BOUND_PUBLISH_VN_ATTR = "data-publish-vn-link-bound";
  const SHARE_REBIND_PENDING_ATTR = "data-share-rebind-pending";
  const BOUND_DESC_ATTR = "data-description-bound";
  const CHAPTER_READ_STORAGE_KEY_PREFIX = "bfang:manga-read-map:v2:";
  const CHAPTER_READ_CLASS = "chapter-link--read";
  const CHAPTER_READ_LI_CLASS = "chapter--read";
  const CHAPTER_MARK_ENDPOINT = "/account/manga-read-map";
  const READ_CACHE_TTL_MS = 2 * 60 * 1000;
  const descriptionControllers = [];
  let resizeTimer = null;
  let lastViewportWidth = window.innerWidth;
  let readStateVersion = 0;

  const toPositiveInteger = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
  };

  const normalizeChapterIdArray = (value) => {
    const source = Array.isArray(value) ? value : [];
    const seen = new Set();
    const normalized = [];

    source.forEach((item) => {
      const chapterId = toPositiveInteger(item);
      if (!chapterId) return;
      if (seen.has(chapterId)) return;
      seen.add(chapterId);
      normalized.push(chapterId);
    });

    normalized.sort((left, right) => left - right);
    return normalized;
  };

  const normalizeReadScopeToken = (value) => {
    const normalized = (value == null ? "" : String(value))
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || "";
  };

  const resolveReadScopeFromSession = (session) => {
    const userId =
      session && session.user && session.user.id != null
        ? String(session.user.id).trim()
        : "";
    const normalizedUserId = normalizeReadScopeToken(userId);
    if (!normalizedUserId) return "guest";
    return `user-${normalizedUserId}`;
  };

  const buildReadStorageKey = ({ mangaSlug, scope = "guest" }) => {
    const slug = (mangaSlug || "").toString().trim().toLowerCase();
    if (!slug) return "";
    const normalizedScope = normalizeReadScopeToken(scope) || "guest";
    return `${CHAPTER_READ_STORAGE_KEY_PREFIX}${normalizedScope}:${slug}`;
  };

  const readLocalReadState = ({ mangaSlug, scope = "guest" }) => {
    const key = buildReadStorageKey({ mangaSlug, scope });
    if (!key) {
      return {
        chapterIds: [],
        pendingSyncChapterIds: [],
        fetchedAt: 0,
        updatedAt: 0
      };
    }

    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return {
          chapterIds: [],
          pendingSyncChapterIds: [],
          fetchedAt: 0,
          updatedAt: 0
        };
      }

      const parsed = JSON.parse(raw);
      const chapterIds = normalizeChapterIdArray(parsed && parsed.chapterIds);
      const chapterIdSet = new Set(chapterIds);
      const pendingSyncChapterIds = normalizeChapterIdArray(
        parsed && parsed.pendingSyncChapterIds
      ).filter((chapterId) => chapterIdSet.has(chapterId));
      const fetchedAt = Number(parsed && parsed.fetchedAt) || 0;
      const updatedAt = Number(parsed && parsed.updatedAt) || 0;
      return {
        chapterIds,
        pendingSyncChapterIds,
        fetchedAt,
        updatedAt
      };
    } catch (_error) {
      return {
        chapterIds: [],
        pendingSyncChapterIds: [],
        fetchedAt: 0,
        updatedAt: 0
      };
    }
  };

  const writeLocalReadState = ({ mangaSlug, scope = "guest", payload }) => {
    const key = buildReadStorageKey({ mangaSlug, scope });
    if (!key) return;

    const safePayload = payload && typeof payload === "object" ? payload : {};
    const chapterIds = normalizeChapterIdArray(safePayload.chapterIds);
    const chapterIdSet = new Set(chapterIds);
    const hasExplicitPending = Object.prototype.hasOwnProperty.call(
      safePayload,
      "pendingSyncChapterIds"
    );
    const pendingSource = hasExplicitPending
      ? safePayload.pendingSyncChapterIds
      : readLocalReadState({ mangaSlug, scope }).pendingSyncChapterIds;
    const pendingSyncChapterIds = normalizeChapterIdArray(pendingSource).filter((chapterId) =>
      chapterIdSet.has(chapterId)
    );
    const fetchedAtRaw = Number(safePayload.fetchedAt);
    const updatedAtRaw = Number(safePayload.updatedAt);
    const now = Date.now();

    const data = {
      chapterIds,
      pendingSyncChapterIds,
      fetchedAt: Number.isFinite(fetchedAtRaw) && fetchedAtRaw > 0 ? Math.floor(fetchedAtRaw) : now,
      updatedAt: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? Math.floor(updatedAtRaw) : now
    };

    try {
      window.localStorage.setItem(key, JSON.stringify(data));
    } catch (_error) {
      // ignore storage failures (private mode or quota).
    }
  };

  const mergeChapterIds = (baseIds, incomingIds) => {
    const mergedSet = new Set(normalizeChapterIdArray(baseIds));
    normalizeChapterIdArray(incomingIds).forEach((chapterId) => {
      mergedSet.add(chapterId);
    });
    return Array.from(mergedSet).sort((left, right) => left - right);
  };

  const getUrl = (button) => {
    const attrValue = button && button.getAttribute ? button.getAttribute("data-share-url") : "";
    const explicitUrl = (attrValue || "").toString().trim();
    if (explicitUrl) return explicitUrl;
    return window.location.href.split("#")[0];
  };

  const getTitle = () => {
    const h1 = document.querySelector(".detail-info h1") || document.querySelector("h1");
    const text = h1 ? (h1.textContent || "").trim() : "";
    return text || document.title;
  };

  const copyText = async (value) => {
    const text = (value || "").toString();
    if (!text) return false;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_err) {
        // Ignore clipboard API failures.
      }
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return Boolean(ok);
    } catch (_err) {
      return false;
    }
  };

  const decodeBase64UrlToText = (value) => {
    const token = (value || "").toString().trim();
    if (!token) return "";
    const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    const paddingLength = (4 - (normalized.length % 4)) % 4;
    const padded = `${normalized}${"=".repeat(paddingLength)}`;

    try {
      const binary = window.atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      if (typeof TextDecoder === "function") {
        return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      }
      let utf8PercentEncoded = "";
      for (let index = 0; index < bytes.length; index += 1) {
        utf8PercentEncoded += `%${bytes[index].toString(16).padStart(2, "0")}`;
      }
      return decodeURIComponent(utf8PercentEncoded);
    } catch (_error) {
      return "";
    }
  };

  const resolvePublishVnUrl = (button) => {
    if (!(button instanceof HTMLElement)) return "";
    const token = button.getAttribute("data-publish-vn-link-token");
    const decoded = decodeBase64UrlToText(token).trim();
    if (!decoded) return "";
    try {
      const parsed = new URL(decoded);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.toString();
    } catch (_error) {
      return "";
    }
  };

  const initPublishVnButtons = (root) => {
    const scope = root && root.querySelectorAll ? root : document;
    const buttons = Array.from(scope.querySelectorAll("[data-publish-vn-link-button]"));
    buttons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.getAttribute(BOUND_PUBLISH_VN_ATTR) === "1") return;
      button.setAttribute(BOUND_PUBLISH_VN_ATTR, "1");
      button.addEventListener("click", () => {
        const targetUrl = resolvePublishVnUrl(button);
        if (!targetUrl) return;
        const opened = window.open(targetUrl, "_blank", "noopener,noreferrer");
        if (opened && typeof opened.opener !== "undefined") {
          opened.opener = null;
        }
      });
    });
  };

  const initShareButtons = (root) => {
    const scope = root && root.querySelectorAll ? root : document;
    const shareButtons = Array.from(scope.querySelectorAll("[data-share-button]"));

    shareButtons.forEach((button) => {
      if (button[BOUND_SHARE_KEY] === true) {
        button.setAttribute(BOUND_SHARE_ATTR, "1");
        return;
      }
      if (button.getAttribute(BOUND_SHARE_ATTR) === "1") return;
      button[BOUND_SHARE_KEY] = true;
      button.setAttribute(BOUND_SHARE_ATTR, "1");

      const label = button.querySelector("[data-share-label]");
      const getLabel = () => {
        const target = label || button;
        return (target.textContent || "Chia sẻ").trim() || "Chia sẻ";
      };
      const setLabel = (value) => {
        const text = (value || "").toString();
        if (label) {
          label.textContent = text;
          return;
        }
        button.textContent = text;
      };

      const original = getLabel();
      const onShareClick = async (event) => {
        event.preventDefault();
        const url = getUrl(button);
        const title = getTitle();

        if (navigator.share) {
          try {
            await navigator.share({ title, url });
            return;
          } catch (_err) {
            // User canceled share dialog.
          }
        }

        const copied = await copyText(url);
        setLabel(copied ? "Đã copy link" : "Không copy được");
        window.setTimeout(() => {
          setLabel(original);
        }, 1400);
      };

      button[BOUND_SHARE_HANDLER_KEY] = onShareClick;
      button.addEventListener("click", onShareClick);
    });
  };

  const createDescriptionController = (wrapper) => {
    const content = wrapper.querySelector("[data-description-content]");
    const toggle = wrapper.querySelector("[data-description-toggle]");
    if (!content || !toggle) return null;

    const fullText = (content.textContent || "").replace(/\r\n?/g, "\n").trim();
    if (!fullText) {
      toggle.hidden = true;
      toggle.removeAttribute("aria-expanded");
      return null;
    }

    const getMax = () => {
      const base = Number(wrapper.dataset.descriptionMax) || 280;
      const mobile = Number(wrapper.dataset.descriptionMaxMobile) || Math.round(base * 0.72);
      if (window.matchMedia && window.matchMedia("(max-width: 560px)").matches) {
        return mobile;
      }
      return base;
    };

    const truncate = (text, max) => {
      if (text.length <= max) {
        return { text, truncated: false };
      }

      const slice = text.slice(0, max).trimEnd();
      let lastBreak = -1;
      for (let index = slice.length - 1; index >= 0; index -= 1) {
        if (/\s/.test(slice[index])) {
          lastBreak = index;
          break;
        }
      }
      const cut = lastBreak > Math.floor(max * 0.6) ? slice.slice(0, lastBreak).trimEnd() : slice;
      return { text: cut, truncated: true };
    };

    const setState = (expanded) => {
      wrapper.classList.toggle("is-expanded", expanded);
      wrapper.classList.toggle("is-collapsed", !expanded);
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.textContent = expanded ? "Thu gọn" : "Xem thêm";
    };

    const collapse = () => {
      const result = truncate(fullText, getMax());
      if (!result.truncated) {
        content.textContent = fullText;
        toggle.hidden = true;
        wrapper.classList.remove("is-expanded", "is-collapsed");
        toggle.removeAttribute("aria-expanded");
        return;
      }

      content.textContent = `${result.text}...`;
      toggle.hidden = false;
      setState(false);
    };

    const refresh = () => {
      const result = truncate(fullText, getMax());
      if (!result.truncated) {
        content.textContent = fullText;
        toggle.hidden = true;
        wrapper.classList.remove("is-expanded", "is-collapsed");
        toggle.removeAttribute("aria-expanded");
        return;
      }

      toggle.hidden = false;
      if (wrapper.classList.contains("is-expanded")) {
        content.textContent = fullText;
        setState(true);
        return;
      }

      content.textContent = `${result.text}...`;
      setState(false);
    };

    const expand = () => {
      content.textContent = fullText;
      toggle.hidden = false;
      setState(true);
    };

    toggle.addEventListener("click", () => {
      if (wrapper.classList.contains("is-expanded")) {
        collapse();
        return;
      }
      expand();
    });

    window.requestAnimationFrame(() => {
      refresh();
    });

    return {
      wrapper,
      collapse,
      refresh
    };
  };

  const initDescription = (root) => {
    const scope = root && root.querySelectorAll ? root : document;
    const wrappers = Array.from(scope.querySelectorAll("[data-description-wrap]"));
    wrappers.forEach((wrapper) => {
      if (!(wrapper instanceof HTMLElement)) return;
      if (wrapper.getAttribute(BOUND_DESC_ATTR) === "1") return;
      wrapper.setAttribute(BOUND_DESC_ATTR, "1");
      const controller = createDescriptionController(wrapper);
      if (controller) {
        descriptionControllers.push(controller);
      }
    });
  };

  const refreshDescriptionOnResize = () => {
    const activeControllers = [];
    descriptionControllers.forEach((controller) => {
      if (!controller || !controller.wrapper || !controller.wrapper.isConnected) {
        return;
      }
      if (typeof controller.refresh === "function") {
        controller.refresh();
      } else {
        controller.collapse();
      }
      activeControllers.push(controller);
    });
    descriptionControllers.length = 0;
    activeControllers.forEach((controller) => {
      descriptionControllers.push(controller);
    });
  };

  const collectChapterLinkEntries = () => {
    const chapterLinks = Array.from(document.querySelectorAll("#chapters .chapter-list .chapter-link"));
    return chapterLinks
      .map((link) => {
        const chapterId = toPositiveInteger(link.getAttribute("data-chapter-id"));
        const chapterNumberRaw = Number(link.getAttribute("data-chapter-number"));
        const chapterNumber = Number.isFinite(chapterNumberRaw) ? chapterNumberRaw : null;
        const mangaSlug = (link.getAttribute("data-manga-slug") || "").toString().trim();
        if (!chapterId || !mangaSlug) return null;
        return {
          link,
          li: link.closest("li.chapter"),
          chapterId,
          chapterNumber,
          mangaSlug
        };
      })
      .filter(Boolean);
  };

  const applyReadStateToEntries = (entries, readChapterSet) => {
    const safeSet = readChapterSet instanceof Set ? readChapterSet : new Set();
    entries.forEach((entry) => {
      const isRead = safeSet.has(entry.chapterId);
      entry.link.classList.toggle(CHAPTER_READ_CLASS, isRead);
      entry.link.setAttribute("data-read-state", isRead ? "1" : "0");
      if (entry.li) {
        entry.li.classList.toggle(CHAPTER_READ_LI_CLASS, isRead);
      }
    });
  };

  const resolveSignedInState = async () => {
    if (window.BfangAuth && typeof window.BfangAuth.getSession === "function") {
      try {
        const session = await window.BfangAuth.getSession();
        if (session && session.user) {
          return {
            signedIn: true,
            session
          };
        }
      } catch (_error) {
        return {
          signedIn: false,
          session: null
        };
      }
    }

    const authConfig = window.__AUTH && typeof window.__AUTH === "object" ? window.__AUTH : null;
    const initialState =
      authConfig && authConfig.initialState && typeof authConfig.initialState === "object"
        ? authConfig.initialState
        : null;
    if (initialState && initialState.session && initialState.session.user) {
      return {
        signedIn: true,
        session: initialState.session
      };
    }

    return {
      signedIn: false,
      session: null
    };
  };

  const getAccessTokenSafe = async () => {
    if (window.BfangAuth && typeof window.BfangAuth.getAccessToken === "function") {
      try {
        const token = await window.BfangAuth.getAccessToken();
        return (token || "").toString().trim();
      } catch (_error) {
        return "";
      }
    }
    return "";
  };

  const fetchReadMapFromServer = async ({ mangaSlug, scope = "guest", force = false }) => {
    const localState = readLocalReadState({ mangaSlug, scope });
    const now = Date.now();
    if (!force && localState.fetchedAt > 0 && now - localState.fetchedAt <= READ_CACHE_TTL_MS) {
      return {
        chapterIds: localState.chapterIds,
        pendingSyncChapterIds: localState.pendingSyncChapterIds,
        updatedAt: localState.updatedAt,
        fetchedAt: localState.fetchedAt,
        fromCache: true
      };
    }

    const token = await getAccessTokenSafe();
    const headers = {
      Accept: "application/json"
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const url = `${CHAPTER_MARK_ENDPOINT}?mangaSlug=${encodeURIComponent(mangaSlug)}`;
    const response = await fetch(url, {
      method: "GET",
      headers,
      credentials: "same-origin",
      cache: "no-store"
    }).catch(() => null);

    if (!response || !response.ok) {
      return {
        chapterIds: localState.chapterIds,
        pendingSyncChapterIds: localState.pendingSyncChapterIds,
        updatedAt: localState.updatedAt,
        fetchedAt: localState.fetchedAt,
        fromCache: true
      };
    }

    const data = await response.json().catch(() => null);
    if (!data || data.ok !== true) {
      return {
        chapterIds: localState.chapterIds,
        pendingSyncChapterIds: localState.pendingSyncChapterIds,
        updatedAt: localState.updatedAt,
        fetchedAt: localState.fetchedAt,
        fromCache: true
      };
    }

    const serverChapterIds = normalizeChapterIdArray(data.readMap);
    const mergedChapterIds = mergeChapterIds(localState.chapterIds, serverChapterIds);
    const pendingSyncChapterIds = normalizeChapterIdArray(
      localState.pendingSyncChapterIds
    ).filter((chapterId) => !serverChapterIds.includes(chapterId));
    const updatedAt = Number(data.updatedAt) || Date.now();
    writeLocalReadState({
      mangaSlug,
      scope,
      payload: {
        chapterIds: mergedChapterIds,
        pendingSyncChapterIds,
        updatedAt,
        fetchedAt: Date.now()
      }
    });

    return {
      chapterIds: mergedChapterIds,
      pendingSyncChapterIds,
      updatedAt,
      fetchedAt: Date.now(),
      fromCache: false
    };
  };

  const pushReadMapToServer = async ({ mangaSlug, chapterIds }) => {
    const safeIds = normalizeChapterIdArray(chapterIds);
    if (!mangaSlug || !safeIds.length) return null;

    const token = await getAccessTokenSafe();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(CHAPTER_MARK_ENDPOINT, {
      method: "POST",
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        mangaSlug,
        readMap: safeIds
      })
    }).catch(() => null);

    if (!response || !response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!data || data.ok !== true) return null;
    return {
      chapterIds: normalizeChapterIdArray(data.readMap),
      updatedAt: Number(data.updatedAt) || Date.now()
    };
  };

  const markCurrentChapterAsReadFromReaderProgress = async ({ mangaSlug, readScope = "guest", signedIn }) => {
    const progressNode = document.querySelector(
      `[data-reading-progress][data-reading-manga-slug="${CSS.escape(mangaSlug)}"]`
    );
    if (!(progressNode instanceof HTMLElement)) return;

    const chapterId = toPositiveInteger(progressNode.getAttribute("data-reading-chapter-id"));
    if (!chapterId) return;

    const localState = readLocalReadState({ mangaSlug, scope: readScope });
    const pendingSyncSet = new Set(localState.pendingSyncChapterIds || []);

    if (localState.chapterIds.includes(chapterId)) {
      if (!signedIn || !pendingSyncSet.has(chapterId)) return;
    } else {
      const mergedLocal = mergeChapterIds(localState.chapterIds, [chapterId]);
      if (signedIn) {
        pendingSyncSet.add(chapterId);
      }
      writeLocalReadState({
        mangaSlug,
        scope: readScope,
        payload: {
          chapterIds: mergedLocal,
          pendingSyncChapterIds: Array.from(pendingSyncSet).sort((left, right) => left - right),
          updatedAt: Date.now(),
          fetchedAt: Date.now()
        }
      });

      if (!signedIn) return;
    }

    const serverResult = await pushReadMapToServer({
      mangaSlug,
      chapterIds: [chapterId]
    });

    if (serverResult && Array.isArray(serverResult.chapterIds)) {
      const serverChapterIds = normalizeChapterIdArray(serverResult.chapterIds);
      const pendingSyncChapterIds = normalizeChapterIdArray(
        Array.from(pendingSyncSet)
      ).filter((pendingChapterId) => !serverChapterIds.includes(pendingChapterId));
      writeLocalReadState({
        mangaSlug,
        scope: readScope,
        payload: {
          chapterIds: serverChapterIds,
          pendingSyncChapterIds,
          updatedAt: serverResult.updatedAt,
          fetchedAt: Date.now()
        }
      });
    }
  };

  const hydrateChapterReadState = async ({ force = false } = {}) => {
    const runVersion = readStateVersion + 1;
    readStateVersion = runVersion;

    const entries = collectChapterLinkEntries();
    if (!entries.length) return;

    const mangaSlug = entries[0].mangaSlug;
    if (!mangaSlug) return;

    const authState = await resolveSignedInState();
    const readScope = resolveReadScopeFromSession(authState.session);
    const localState = readLocalReadState({ mangaSlug, scope: readScope });
    applyReadStateToEntries(entries, new Set(localState.chapterIds));

    await markCurrentChapterAsReadFromReaderProgress({
      mangaSlug,
      readScope,
      signedIn: authState.signedIn
    });

    if (readStateVersion !== runVersion) return;

    if (!authState.signedIn) {
      const guestState = readLocalReadState({ mangaSlug, scope: readScope });
      applyReadStateToEntries(entries, new Set(guestState.chapterIds));
      return;
    }

    const serverState = await fetchReadMapFromServer({ mangaSlug, scope: readScope, force });
    if (readStateVersion !== runVersion) return;
    applyReadStateToEntries(entries, new Set(serverState.chapterIds));
  };

  const initMangaDetail = (root, options = {}) => {
    initShareButtons(root);
    initPublishVnButtons(root);
    initDescription(root);
    const settings = options && typeof options === "object" ? options : {};
    hydrateChapterReadState({ force: settings.force === true }).catch(() => null);
  };

  const rebindShareButtonOnDemand = (button, event) => {
    if (!(button instanceof HTMLElement)) return;
    if (button.getAttribute(BOUND_SHARE_ATTR) === "1") return;
    if (button.getAttribute(SHARE_REBIND_PENDING_ATTR) === "1") return;

    button.setAttribute(SHARE_REBIND_PENDING_ATTR, "1");
    initShareButtons(document);
    button.removeAttribute(SHARE_REBIND_PENDING_ATTR);

    const handler = button[BOUND_SHARE_HANDLER_KEY];
    if (typeof handler !== "function") return;

    event.preventDefault();
    event.stopImmediatePropagation();
    handler(event);
  };

  window.BfangMangaDetail = window.BfangMangaDetail || {};
  window.BfangMangaDetail.init = initMangaDetail;

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        initMangaDetail(document, { force: false });
      },
      { once: true }
    );
  } else {
    initMangaDetail(document, { force: false });
  }

  window.addEventListener("resize", () => {
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
    }
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      const nextViewportWidth = window.innerWidth;
      if (nextViewportWidth === lastViewportWidth) {
        return;
      }
      lastViewportWidth = nextViewportWidth;
      refreshDescriptionOnResize();
    }, 120);
  });

  window.addEventListener("bfang:pagechange", () => {
    initMangaDetail(document, { force: false });
  });

  window.addEventListener("bfang:auth", () => {
    hydrateChapterReadState({ force: false }).catch(() => null);
  });

  document.addEventListener(
    "click",
    (event) => {
      const source = event.target;
      if (!(source instanceof Element)) return;
      const button = source.closest("[data-share-button]");
      if (!button) return;
      if (button.getAttribute(BOUND_SHARE_ATTR) === "1") return;

      rebindShareButtonOnDemand(button, event);
    },
    true
  );
})();
