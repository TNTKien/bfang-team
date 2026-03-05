(() => {
  const root = document.querySelector("[data-chat-page]");
  if (!root) return;
  const chatShell = root.closest(".site--chat");

  const searchInput = root.querySelector("[data-chat-user-search]");
  const searchResults = root.querySelector("[data-chat-search-results]");
  const threadList = root.querySelector("[data-chat-thread-list]");
  const threadCount = root.querySelector("[data-chat-thread-count]");
  const messageList = root.querySelector("[data-chat-message-list]");
  const composeForm = root.querySelector("[data-chat-compose]");
  const input = root.querySelector("[data-chat-input]");
  const counter = root.querySelector("[data-chat-counter]");
  const status = root.querySelector("[data-chat-status]");
  const peerName = root.querySelector("[data-chat-peer-name]");
  const peerNameLink = root.querySelector("[data-chat-peer-link]");
  const peerAvatar = root.querySelector("[data-chat-peer-avatar]");
  const infoButton = root.querySelector("[data-chat-info-button]");
  const sidebarToggleButtons = Array.from(root.querySelectorAll("[data-chat-sidebar-toggle]"));
  const sidebarOverlay = root.querySelector("[data-chat-sidebar-overlay]");

  const chatBootstrap = window.__CHAT_BOOTSTRAP && typeof window.__CHAT_BOOTSTRAP === "object" ? window.__CHAT_BOOTSTRAP : {};
  const bootstrapCurrentUserId =
    chatBootstrap && chatBootstrap.currentUserId ? String(chatBootstrap.currentUserId).trim() : "";
  const bootstrapThreadsRaw = Array.isArray(chatBootstrap && chatBootstrap.initialThreads)
    ? chatBootstrap.initialThreads
    : [];
  const bootstrapInitialThreadIdRaw = Number(chatBootstrap && chatBootstrap.initialThreadId);
  const bootstrapMessagesRaw = Array.isArray(chatBootstrap && chatBootstrap.initialMessages)
    ? chatBootstrap.initialMessages
    : [];
  const bootstrapInitialMessagesHasMore = Boolean(chatBootstrap && chatBootstrap.initialMessagesHasMore);

  const mobileLayoutMedia =
    typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 900px)") : null;
  const SIDEBAR_COLLAPSED_STORAGE_KEY = "bfang:chat:sidebarCollapsed";

  const CHAT_LIMIT = 300;
  const CHAT_USER_SEARCH_RESULT_LIMIT = 5;
  const INITIAL_MESSAGES_LIMIT = 10;
  const OLDER_MESSAGES_LIMIT = 25;
  const POLL_THREAD_LIST_MS = 20000;
  const POLL_MESSAGES_MS = 12000;
  const REALTIME_REFRESH_DEBOUNCE_MS = 220;
  const THREAD_LIST_REQUEST_TIMEOUT_MS = 12000;
  const MESSAGE_REQUEST_TIMEOUT_MS = 10000;
  const THREAD_VIEW_CACHE_LIMIT = 36;
  const CHAT_LINK_LABEL_FETCH_LIMIT = 40;
  const CHAT_LINK_LABEL_API_PATH = "/comments/link-labels";
  const CHAT_PROFILE_USERNAME_PATTERN = /^[a-z0-9_]{1,24}$/i;
  const CHAT_VIEWPORT_RECHECK_MS = 160;
  const CHAT_VIEWPORT_LATE_RECHECK_MS = 380;
  const CHAT_STICK_BOTTOM_THRESHOLD_PX = 120;

  const emojiMartAssetPaths = {
    script: "/vendor/emoji-mart/dist/browser.js",
    data: "/vendor/emoji-mart-data/sets/15/native.json",
    i18n: "/vendor/emoji-mart-data/i18n/vi.json"
  };

  const emojiFallback = [
    "😀",
    "😁",
    "😂",
    "😅",
    "😊",
    "😍",
    "😘",
    "😭",
    "😡",
    "🤔",
    "👍",
    "👏",
    "🙏",
    "🔥",
    "✨",
    "❤️"
  ];

  const numberFormatter = new Intl.NumberFormat("vi-VN");
  const stickerByCode = new Map();
  const chatLinkLabelCache = new Map();
  const profileCache = new Map();
  const profilePendingMap = new Map();

  let emojiMartScriptPromise = null;
  let emojiMartDataPromise = null;
  let emojiMartI18nPromise = null;
  let stickerCatalogLoadPromise = null;

  let stickerCatalog = [];
  let selectedThreadId = 0;
  let selectedPeer = null;
  let currentUserId = "";
  let messageItems = [];
  let pendingMessages = [];
  let hasOlderMessages = false;
  let loadingOlderMessages = false;
  let oldestLoadedMessageId = 0;
  let activeMessageThreadToken = 0;
  let pendingSequence = 0;
  let suppressRefreshUntil = 0;
  let lastMessageListScrollAt = 0;
  let sidebarCollapsedDesktop = false;
  let sidebarOpenMobile = false;
  let searchTimer = null;
  let threadListTimer = null;
  let messageTimer = null;
  let realtimeStream = null;
  let realtimeRefreshTimer = null;
  let realtimeConnected = false;
  let threadListLoadPromise = null;
  let latestRefreshPromise = null;
  let initialMessagesLoadPromise = null;
  let initialMessagesLoadThreadId = 0;
  let userInfoDialogState = null;
  let userInfoRequestToken = 0;
  let chatViewportSyncFrame = 0;
  let chatViewportSyncTimer = null;
  let chatViewportLateSyncTimer = null;
  let lastObservedMessageScrollTop = 0;

  const threadViewStateCache = new Map();

  const escapeHtml = (value) =>
    (value == null ? "" : String(value))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const toSafeText = (value, maxLength = 500) => {
    const raw = (value == null ? "" : String(value)).trim();
    if (!raw) return "";
    if (Number.isFinite(maxLength) && maxLength > 0 && raw.length > maxLength) {
      return "";
    }
    return raw;
  };

  const toSafeCount = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
  };

  const normalizeSearchText = (value) =>
    (value == null ? "" : String(value))
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const scoreUserSearchMatch = (user, normalizedQuery) => {
    if (!normalizedQuery) return Number.POSITIVE_INFINITY;

    const username = normalizeSearchText(user && user.username ? user.username : "");
    const displayName = normalizeSearchText(user && user.displayName ? user.displayName : "");
    const candidates = [username, displayName].filter(Boolean);
    if (!candidates.length) return Number.POSITIVE_INFINITY;

    let bestScore = Number.POSITIVE_INFINITY;
    candidates.forEach((candidate, idx) => {
      if (!candidate) return;

      if (candidate === normalizedQuery) {
        bestScore = Math.min(bestScore, idx === 0 ? 0 : 1);
        return;
      }

      if (candidate.startsWith(normalizedQuery)) {
        bestScore = Math.min(bestScore, idx === 0 ? 2 : 3);
        return;
      }

      const includeIndex = candidate.indexOf(normalizedQuery);
      if (includeIndex >= 0) {
        bestScore = Math.min(bestScore, 20 + includeIndex + idx * 2);
      }
    });

    return bestScore;
  };

  const setThreadCount = (count) => {
    if (!threadCount) return;
    const safeCount = toSafeCount(count);
    threadCount.textContent = `${numberFormatter.format(safeCount)} cuộc trò chuyện`;
  };

  const isSafeAvatarUrl = (value) => {
    const raw = toSafeText(value);
    if (!raw) return false;
    return /^https?:\/\//i.test(raw) || raw.startsWith("/uploads/avatars/") || raw.startsWith("/images/");
  };

  const normalizeProfileLink = (value) => {
    const raw = toSafeText(value, 220);
    if (!raw) return "";
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
      return `${parsed.protocol}//${parsed.host}${parsed.pathname || "/"}${parsed.search || ""}`;
    } catch (_err) {
      return "";
    }
  };

  const buildUserProfilePath = (usernameValue) => {
    const username = toSafeText(usernameValue, 24).toLowerCase();
    if (!CHAT_PROFILE_USERNAME_PATTERN.test(username)) return "";
    return `/user/${encodeURIComponent(username)}`;
  };

  const setStatus = (message, tone = "") => {
    if (!status) return;
    status.hidden = !message;
    status.textContent = message || "";
    status.classList.remove("is-error", "is-success");
    if (tone === "error") status.classList.add("is-error");
    if (tone === "success") status.classList.add("is-success");
  };

  const shouldPausePolling = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return true;
    }
    if (realtimeConnected) {
      return true;
    }
    return false;
  };

  const getSession = async () => {
    if (!window.BfangAuth || typeof window.BfangAuth.getSession !== "function") return null;
    return window.BfangAuth.getSession().catch(() => null);
  };

  const fetchWithTimeout = async (url, options = {}, timeoutMs = 0) => {
    const safeTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Math.floor(Number(timeoutMs)) : 0;
    if (!safeTimeout || typeof AbortController !== "function") {
      return fetch(url, options);
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      try {
        controller.abort();
      } catch (_err) {
        // ignore
      }
    }, safeTimeout);

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  };

  const fetchJson = async (url, options = {}) => {
    const timeoutMs = options && options.timeoutMs != null ? Number(options.timeoutMs) : 0;
    const requestOptions = { ...(options || {}) };
    delete requestOptions.timeoutMs;

    const response = await fetchWithTimeout(
      url,
      {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
          ...(requestOptions.body ? { "Content-Type": "application/json" } : {})
      },
        ...requestOptions
      },
      timeoutMs
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const error = new Error((data && data.error) || "Yêu cầu thất bại.");
      error.retryAfter = data && data.retryAfter ? Number(data.retryAfter) : 0;
      throw error;
    }
    return data;
  };

  const fetchJsonAsset = async (url) => {
    const response = await fetchWithTimeout(
      url,
      {
        credentials: "same-origin",
        headers: {
          Accept: "application/json"
        }
      },
      10000
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch asset: ${response.status}`);
    }
    return response.json();
  };

  const loadEmojiMartScript = async () => {
    if (emojiMartScriptPromise) return emojiMartScriptPromise;

    emojiMartScriptPromise = new Promise((resolve, reject) => {
      const done = () => {
        if (window.EmojiMart && typeof window.EmojiMart.Picker === "function") {
          resolve(window.EmojiMart);
          return;
        }
        reject(new Error("Emoji Mart unavailable"));
      };

      let script = document.querySelector("script[data-emoji-mart-script='1']");
      if (!script) {
        script = document.createElement("script");
        script.src = emojiMartAssetPaths.script;
        script.defer = true;
        script.dataset.emojiMartScript = "1";
        script.addEventListener("load", done, { once: true });
        script.addEventListener("error", () => reject(new Error("Failed to load Emoji Mart script")), {
          once: true
        });
        document.head.appendChild(script);
        return;
      }

      if (window.EmojiMart && typeof window.EmojiMart.Picker === "function") {
        resolve(window.EmojiMart);
        return;
      }

      script.addEventListener("load", done, { once: true });
      script.addEventListener("error", () => reject(new Error("Failed to load Emoji Mart script")), {
        once: true
      });
    }).catch((error) => {
      emojiMartScriptPromise = null;
      throw error;
    });

    return emojiMartScriptPromise;
  };

  const loadEmojiMartData = async () => {
    if (emojiMartDataPromise) return emojiMartDataPromise;
    emojiMartDataPromise = fetchJsonAsset(emojiMartAssetPaths.data).catch((error) => {
      emojiMartDataPromise = null;
      throw error;
    });
    return emojiMartDataPromise;
  };

  const loadEmojiMartI18n = async () => {
    if (emojiMartI18nPromise) return emojiMartI18nPromise;
    emojiMartI18nPromise = fetchJsonAsset(emojiMartAssetPaths.i18n).catch(() => null);
    return emojiMartI18nPromise;
  };

  const toName = (user) => {
    if (!user || typeof user !== "object") return "Người dùng";
    return (user.displayName || "").toString().trim() || (user.username ? `@${user.username}` : "Người dùng");
  };

  const renderAvatarHtml = (user, className = "") => {
    const safeClass = (className || "").toString().trim();
    const avatarUrl = user && user.avatarUrl ? String(user.avatarUrl).trim() : "";
    if (isSafeAvatarUrl(avatarUrl)) {
      return `<span class="${safeClass}"><img src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>`;
    }
    return `<span class="${safeClass}"><i class="fa-regular fa-user" aria-hidden="true"></i></span>`;
  };

  const createAvatarElement = (user, className = "") => {
    const element = document.createElement("span");
    const safeClass = (className || "").toString().trim();
    if (safeClass) {
      element.className = safeClass;
    }

    const avatarUrl = user && user.avatarUrl ? String(user.avatarUrl).trim() : "";
    if (isSafeAvatarUrl(avatarUrl)) {
      const image = document.createElement("img");
      image.src = avatarUrl;
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      element.appendChild(image);
      return element;
    }

    element.innerHTML = '<i class="fa-regular fa-user" aria-hidden="true"></i>';
    return element;
  };

  const formatRelativeTime = (timestamp) => {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return "";
    const deltaMs = Math.max(0, Date.now() - value);
    const deltaMinutes = Math.floor(deltaMs / (60 * 1000));
    if (deltaMinutes < 1) return "vừa xong";
    if (deltaMinutes < 60) return `${deltaMinutes} phút`;
    const deltaHours = Math.floor(deltaMinutes / 60);
    if (deltaHours < 24) return `${deltaHours} giờ`;
    const deltaDays = Math.floor(deltaHours / 24);
    if (deltaDays < 7) return `${deltaDays} ngày`;
    return new Date(value).toLocaleDateString("vi-VN");
  };

  const isMobileLayout = () => Boolean(mobileLayoutMedia && mobileLayoutMedia.matches);

  const readStoredSidebarCollapsed = () => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
    } catch (_err) {
      return false;
    }
  };

  const writeStoredSidebarCollapsed = (value) => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? "1" : "0");
    } catch (_err) {
      // ignore
    }
  };

  const updateSidebarToggleButtons = () => {
    const mobile = isMobileLayout();
    sidebarToggleButtons.forEach((button) => {
      if (!button) return;
      const icon = button.querySelector("i");
      const expanded = mobile ? sidebarOpenMobile : !sidebarCollapsedDesktop;
      if (icon) {
        icon.className = expanded ? "fa-solid fa-angles-left" : "fa-solid fa-angles-right";
      }
      const actionText = expanded ? "Thu gọn cột đoạn chat" : "Mở cột đoạn chat";
      button.title = actionText;
      button.setAttribute("aria-label", actionText);
    });
  };

  const applySidebarState = () => {
    const mobile = isMobileLayout();
    if (mobile) {
      root.classList.remove("chat-layout--sidebar-collapsed");
      root.classList.toggle("chat-layout--sidebar-open", sidebarOpenMobile);
      if (sidebarOverlay) {
        sidebarOverlay.hidden = !sidebarOpenMobile;
      }
    } else {
      root.classList.remove("chat-layout--sidebar-open");
      root.classList.toggle("chat-layout--sidebar-collapsed", sidebarCollapsedDesktop);
      if (sidebarOverlay) {
        sidebarOverlay.hidden = true;
      }
    }

    updateSidebarToggleButtons();
  };

  const closeSidebarOnMobile = () => {
    if (!isMobileLayout()) return;
    if (!sidebarOpenMobile) return;
    sidebarOpenMobile = false;
    applySidebarState();
  };

  const toggleSidebar = () => {
    if (isMobileLayout()) {
      sidebarOpenMobile = !sidebarOpenMobile;
      applySidebarState();
      return;
    }

    sidebarCollapsedDesktop = !sidebarCollapsedDesktop;
    writeStoredSidebarCollapsed(sidebarCollapsedDesktop);
    applySidebarState();
  };

  const syncSidebarStateForViewport = () => {
    if (isMobileLayout()) {
      sidebarOpenMobile = selectedThreadId ? false : true;
    } else {
      sidebarOpenMobile = false;
    }
    applySidebarState();
  };

  const setPeerIdentity = (user) => {
    if (peerName) {
      peerName.textContent = user ? toName(user) : "Chọn đoạn chat";
    }
    if (peerNameLink) {
      const username = user && user.username ? String(user.username).trim().toLowerCase() : "";
      const profilePath = buildUserProfilePath(username);
      peerNameLink.classList.toggle("is-disabled", !profilePath);
      peerNameLink.setAttribute("aria-disabled", profilePath ? "false" : "true");
      peerNameLink.href = profilePath || "#";
      if (profilePath) {
        peerNameLink.target = "_blank";
        peerNameLink.rel = "noopener noreferrer";
      } else {
        peerNameLink.removeAttribute("target");
        peerNameLink.removeAttribute("rel");
      }
      peerNameLink.title = profilePath ? `Mở trang thành viên ${toName(user)}` : "Chưa có trang thành viên";
    }
    if (peerAvatar) {
      peerAvatar.innerHTML = user
        ? renderAvatarHtml(user, "chat-peer__avatar-inner")
        : '<i class="fa-regular fa-user" aria-hidden="true"></i>';
    }
    if (infoButton) {
      infoButton.disabled = !(user && user.id);
    }
  };

  const buildDefaultStickerCatalog = () =>
    Array.from({ length: 49 }, (_unused, index) => {
      const number = String(index + 1).padStart(2, "0");
      return {
        code: `pepe-${number}`,
        src: `/stickers/pepe-${number}.png`
      };
    });

  const ensureStickerCatalog = async () => {
    stickerCatalog = buildDefaultStickerCatalog();
    stickerByCode.clear();
    stickerCatalog.forEach((item) => {
      if (!item || !item.code || !item.src) return;
      stickerByCode.set(item.code, item.src);
    });

    if (stickerCatalogLoadPromise) {
      return stickerCatalogLoadPromise;
    }

    stickerCatalogLoadPromise = (async () => {
      try {
        const response = await fetchWithTimeout(
          "/stickers/manifest.json",
          {
            headers: { Accept: "application/json" },
            credentials: "same-origin"
          },
          10000
        );
        const data = await response.json().catch(() => null);
        const stickers = data && Array.isArray(data.stickers) ? data.stickers : [];
        if (stickers.length) {
          stickerCatalog = [];
        }
        stickers.forEach((item) => {
          const code = (item && item.code ? String(item.code) : "").trim().toLowerCase();
          const src = (item && item.src ? String(item.src) : "").trim();
          if (!code || !src) return;
          stickerCatalog.push({ code, src });
          stickerByCode.set(code, src);
        });
      } catch (_error) {
        // keep default catalog
      }
    })().finally(() => {
      stickerCatalogLoadPromise = null;
    });

    return stickerCatalogLoadPromise;
  };

  const getChatLinkRegex = () => /(?:https?:\/\/[^\s<>"']+|\/(?:manga|user)\/[^\s<>"']+)/gi;

  const trimTrailingCharsFromChatUrl = (rawUrlText) => {
    const raw = rawUrlText == null ? "" : String(rawUrlText);
    if (!raw) {
      return {
        urlText: "",
        trailingText: ""
      };
    }

    let urlText = raw;
    let trailingText = "";
    while (urlText) {
      const lastChar = urlText.charAt(urlText.length - 1);
      if (!".,!?;:)]}\"'".includes(lastChar)) {
        break;
      }
      trailingText = `${lastChar}${trailingText}`;
      urlText = urlText.slice(0, -1);
    }

    return {
      urlText,
      trailingText
    };
  };

  const decodeChatPathSegment = (value) => {
    const raw = value == null ? "" : String(value);
    if (!raw) return "";
    try {
      return decodeURIComponent(raw);
    } catch (_err) {
      return raw;
    }
  };

  const normalizeChatHostName = (value) => toSafeText(value).toLowerCase().replace(/^www\./, "");

  const isChatSiteUrl = (candidateUrl) => {
    if (!candidateUrl) return false;
    const currentHost = normalizeChatHostName(window.location.hostname);
    const targetHost = normalizeChatHostName(candidateUrl.hostname);
    if (!currentHost || !targetHost) return false;
    return currentHost === targetHost;
  };

  const chatTitleLowercaseWords = new Set([
    "a",
    "an",
    "and",
    "or",
    "the",
    "of",
    "in",
    "on",
    "at",
    "to",
    "for",
    "from",
    "by",
    "with",
    "without",
    "no",
    "vs"
  ]);

  const formatChatTitleWord = (word, index) => {
    const text = toSafeText(word).toLowerCase();
    if (!text) return "";
    if (Number(index) > 0 && chatTitleLowercaseWords.has(text)) {
      return text;
    }
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  };

  const buildChatTitleFromMangaSlug = (slug) => {
    const decodedSlug = decodeChatPathSegment(slug).replace(/^\d+-/, "");
    const words = decodedSlug
      .split(/[-_]+/)
      .map((part, index) => formatChatTitleWord(part, index))
      .filter(Boolean);

    if (!words.length) {
      return "Truyện";
    }

    return words.join(" ");
  };

  const normalizeChatChapterNumberLabel = (chapterValue) => {
    const raw = decodeChatPathSegment(chapterValue).replace(/,/g, ".").trim();
    if (!raw) return "";
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return raw;
    }

    const rounded = Math.round(numeric * 1000) / 1000;
    if (Number.isInteger(rounded)) {
      return String(rounded);
    }
    return rounded.toString();
  };

  const buildChatLinkLabelKey = ({ type, mangaSlug, chapterNumberText, username }) => {
    const normalizedType = toSafeText(type).toLowerCase();

    if (normalizedType === "chapter") {
      const slug = toSafeText(mangaSlug).toLowerCase();
      const chapter = normalizeChatChapterNumberLabel(chapterNumberText);
      if (!slug || !chapter) return "";
      return `chapter:${slug}:${chapter}`;
    }

    if (normalizedType === "manga") {
      const slug = toSafeText(mangaSlug).toLowerCase();
      if (!slug) return "";
      return `manga:${slug}`;
    }

    if (normalizedType === "user") {
      const user = toSafeText(username, 24).toLowerCase();
      if (!CHAT_PROFILE_USERNAME_PATTERN.test(user)) return "";
      return `user:${user}`;
    }

    return "";
  };

  const resolveChatInternalLinkMeta = (rawUrlText) => {
    const source = toSafeText(rawUrlText);
    if (!source) return null;

    let parsedUrl = null;
    try {
      if (source.startsWith("/")) {
        parsedUrl = new URL(source, window.location.origin);
      } else {
        parsedUrl = new URL(source);
      }
    } catch (_err) {
      return null;
    }

    if (!parsedUrl || !/^https?:$/i.test(parsedUrl.protocol || "")) {
      return null;
    }
    if (!isChatSiteUrl(parsedUrl)) {
      return null;
    }

    const normalizedPath = ((parsedUrl.pathname || "").replace(/\/+$/, "") || "/").trim();
    const chapterMatch = normalizedPath.match(/^\/manga\/([^/]+)\/chapters\/([^/]+)$/i);
    if (chapterMatch) {
      const mangaSlug = decodeChatPathSegment(chapterMatch[1]).trim().toLowerCase();
      const chapterNumberLabel = normalizeChatChapterNumberLabel(chapterMatch[2]);
      if (!mangaSlug || !chapterNumberLabel) return null;

      const mangaTitle = buildChatTitleFromMangaSlug(mangaSlug);
      return {
        href: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
        label: `${mangaTitle} - Ch. ${chapterNumberLabel}`,
        type: "chapter",
        mangaSlug,
        chapterNumberText: chapterNumberLabel,
        labelKey: buildChatLinkLabelKey({
          type: "chapter",
          mangaSlug,
          chapterNumberText: chapterNumberLabel,
          username: ""
        }),
        needsCanonicalLabel: true
      };
    }

    const mangaMatch = normalizedPath.match(/^\/manga\/([^/]+)$/i);
    if (mangaMatch) {
      const mangaSlug = decodeChatPathSegment(mangaMatch[1]).trim().toLowerCase();
      if (!mangaSlug) return null;
      const mangaTitle = buildChatTitleFromMangaSlug(mangaSlug);
      return {
        href: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
        label: mangaTitle,
        type: "manga",
        mangaSlug,
        chapterNumberText: "",
        username: "",
        labelKey: buildChatLinkLabelKey({
          type: "manga",
          mangaSlug,
          chapterNumberText: "",
          username: ""
        }),
        needsCanonicalLabel: true
      };
    }

    const userMatch = normalizedPath.match(/^\/user\/([a-z0-9_]{1,24})$/i);
    if (userMatch) {
      const username = decodeChatPathSegment(userMatch[1]).trim().toLowerCase();
      if (!CHAT_PROFILE_USERNAME_PATTERN.test(username)) return null;
      return {
        href: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
        label: `@${username}`,
        type: "user",
        mangaSlug: "",
        chapterNumberText: "",
        username,
        labelKey: buildChatLinkLabelKey({
          type: "user",
          mangaSlug: "",
          chapterNumberText: "",
          username
        }),
        needsCanonicalLabel: true
      };
    }

    return null;
  };

  const buildChatInlineLinkElement = (meta) => {
    if (!meta) return null;
    const label = toSafeText(meta.label);
    const href = toSafeText(meta.href);
    if (!label || !href) return null;

    const type = toSafeText(meta.type).toLowerCase();
    const link = document.createElement("a");
    link.className = `chat-inline-link${type === "user" ? " chat-inline-link--user" : ""}`;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const labelKey = toSafeText(meta.labelKey);
    const cachedLabel = labelKey ? toSafeText(chatLinkLabelCache.get(labelKey)) : "";
    const visibleLabel = cachedLabel || label;
    link.textContent = visibleLabel;
    link.title = visibleLabel;

    const shouldLookup = Boolean(meta && meta.needsCanonicalLabel && labelKey);
    if (shouldLookup) {
      if (type === "user") {
        const username = toSafeText(meta.username, 24).toLowerCase();
        if (CHAT_PROFILE_USERNAME_PATTERN.test(username)) {
          link.dataset.chatLinkKey = labelKey;
          link.dataset.chatLinkType = type;
          link.dataset.chatLinkUser = username;
        }
      }

      const mangaSlug = toSafeText(meta.mangaSlug).toLowerCase();
      if ((type === "manga" || type === "chapter") && mangaSlug) {
        link.dataset.chatLinkKey = labelKey;
        link.dataset.chatLinkType = type;
        link.dataset.chatLinkSlug = mangaSlug;
        if (type === "chapter") {
          const chapterNumberText = normalizeChatChapterNumberLabel(meta.chapterNumberText);
          if (chapterNumberText) {
            link.dataset.chatLinkChapter = chapterNumberText;
          }
        }
      }
    }

    return link;
  };

  const setChatInlineLinkLabel = (link, labelValue) => {
    if (!link) return;
    const label = toSafeText(labelValue).replace(/\s+/g, " ").trim();
    if (!label) return;
    link.textContent = label;
    link.title = label;
  };

  const fetchChatLinkLabels = async (items) => {
    const safeItems = Array.isArray(items) ? items.slice(0, CHAT_LINK_LABEL_FETCH_LIMIT) : [];
    if (!safeItems.length) return {};

    const response = await fetch(CHAT_LINK_LABEL_API_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({ items: safeItems })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok !== true || !payload.labels || typeof payload.labels !== "object") {
      return {};
    }
    return payload.labels;
  };

  const hydrateChatInlineLinks = async (root) => {
    const hydrationStartedAt = Date.now();
    const shouldKeepBottom = getMessageDistanceToBottom() <= CHAT_STICK_BOTTOM_THRESHOLD_PX;
    const hydrationThreadId = Number(selectedThreadId) || 0;
    const links = [];
    if (root && root.matches && root.matches(".chat-inline-link[data-chat-link-key]")) {
      links.push(root);
    }

    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll(".chat-inline-link[data-chat-link-key]").forEach((link) => {
      links.push(link);
    });

    if (!links.length) return;

    const groupedLinks = new Map();
    const lookupItems = [];

    links.forEach((link) => {
      const key = toSafeText(link && link.dataset ? link.dataset.chatLinkKey : "");
      if (!key) return;

      const cachedLabel = toSafeText(chatLinkLabelCache.get(key));
      if (cachedLabel) {
        setChatInlineLinkLabel(link, cachedLabel);
        return;
      }

      const type = toSafeText(link.dataset.chatLinkType).toLowerCase();
      if (!/^(manga|chapter|user)$/.test(type)) return;

      if (type === "user") {
        const username = toSafeText(link.dataset.chatLinkUser, 24).toLowerCase();
        if (!CHAT_PROFILE_USERNAME_PATTERN.test(username)) return;
        if (!groupedLinks.has(key)) {
          groupedLinks.set(key, []);
          lookupItems.push({
            type,
            slug: "",
            chapterNumberText: "",
            username
          });
        }
        groupedLinks.get(key).push(link);
        return;
      }

      const slug = toSafeText(link.dataset.chatLinkSlug).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,199}$/.test(slug)) return;

      let chapterNumberText = "";
      if (type === "chapter") {
        chapterNumberText = normalizeChatChapterNumberLabel(link.dataset.chatLinkChapter);
        if (!chapterNumberText) return;
      }

      if (!groupedLinks.has(key)) {
        groupedLinks.set(key, []);
        lookupItems.push({
          type,
          slug,
          chapterNumberText,
          username: ""
        });
      }
      groupedLinks.get(key).push(link);
    });

    if (!lookupItems.length) return;

    for (let index = 0; index < lookupItems.length; index += CHAT_LINK_LABEL_FETCH_LIMIT) {
      const chunk = lookupItems.slice(index, index + CHAT_LINK_LABEL_FETCH_LIMIT);
      const labels = await fetchChatLinkLabels(chunk).catch(() => ({}));
      Object.entries(labels).forEach(([key, labelValue]) => {
        const normalizedLabel = toSafeText(labelValue).replace(/\s+/g, " ").trim();
        if (!normalizedLabel) return;
        chatLinkLabelCache.set(key, normalizedLabel);
        const targets = groupedLinks.get(key);
        if (!Array.isArray(targets)) return;
        targets.forEach((link) => {
          if (!link || !link.isConnected) return;
          setChatInlineLinkLabel(link, normalizedLabel);
        });
      });

      if (
        shouldKeepBottom &&
        hydrationThreadId > 0 &&
        Number(selectedThreadId) === hydrationThreadId &&
        lastMessageListScrollAt <= hydrationStartedAt
      ) {
        scrollMessagesToBottom();
      }
    }
  };

  const appendChatTextWithLinks = ({ target, text }) => {
    if (!target) return;
    const raw = text == null ? "" : String(text);
    if (!raw) return;

    const linkRegex = getChatLinkRegex();
    let cursor = 0;
    let match = linkRegex.exec(raw);

    while (match) {
      const matchedText = match[0] || "";
      if (!matchedText) {
        match = linkRegex.exec(raw);
        continue;
      }

      if (matchedText.startsWith("/manga/") || matchedText.startsWith("/user/")) {
        const previousChar = match.index > 0 ? raw.charAt(match.index - 1) : "";
        if (previousChar && /[a-z0-9_]/i.test(previousChar)) {
          match = linkRegex.exec(raw);
          continue;
        }
      }

      if (match.index > cursor) {
        target.appendChild(document.createTextNode(raw.slice(cursor, match.index)));
      }

      const { urlText, trailingText } = trimTrailingCharsFromChatUrl(matchedText);
      const linkMeta = resolveChatInternalLinkMeta(urlText);
      if (linkMeta) {
        const linkEl = buildChatInlineLinkElement(linkMeta);
        if (linkEl) {
          target.appendChild(linkEl);
        } else {
          target.appendChild(document.createTextNode(urlText));
        }
        if (trailingText) {
          target.appendChild(document.createTextNode(trailingText));
        }
      } else {
        target.appendChild(document.createTextNode(matchedText));
      }

      cursor = match.index + matchedText.length;
      match = linkRegex.exec(raw);
    }

    if (cursor < raw.length) {
      target.appendChild(document.createTextNode(raw.slice(cursor)));
    }
  };

  const renderMessageTextWithStickers = (target, rawValue) => {
    if (!target) return;
    const raw = rawValue == null ? "" : String(rawValue);
    target.textContent = "";

    const stickerTokenRegex = /\[sticker:([a-z0-9_-]+)\]/gi;
    let lastIndex = 0;
    let match = stickerTokenRegex.exec(raw);
    while (match) {
      if (match.index > lastIndex) {
        appendChatTextWithLinks({
          target,
          text: raw.slice(lastIndex, match.index)
        });
      }

      const stickerCode = (match[1] || "").toString().trim().toLowerCase();
      const src = stickerByCode.get(stickerCode) || `/stickers/${stickerCode}.png`;
      const image = document.createElement("img");
      image.className = "chat-sticker";
      image.src = src;
      image.alt = `[sticker:${stickerCode}]`;
      image.loading = "lazy";
      image.decoding = "async";
      image.width = 88;
      image.height = 88;
      const renderedThreadId = Number(selectedThreadId) || 0;
      if (!image.complete) {
        const preserveBottomPosition = () => {
          if (!renderedThreadId || Number(selectedThreadId) !== renderedThreadId) return;
          if (getMessageDistanceToBottom() <= CHAT_STICK_BOTTOM_THRESHOLD_PX) {
            scrollMessagesToBottom();
          }
        };
        image.addEventListener("load", preserveBottomPosition, { once: true });
        image.addEventListener("error", preserveBottomPosition, { once: true });
      }
      target.appendChild(image);

      lastIndex = stickerTokenRegex.lastIndex;
      match = stickerTokenRegex.exec(raw);
    }

    if (lastIndex < raw.length) {
      appendChatTextWithLinks({
        target,
        text: raw.slice(lastIndex)
      });
    }
  };

  const dispatchViewedEvent = () => {
    if (!selectedThreadId) return;
    try {
      window.dispatchEvent(
        new CustomEvent("bfang:messages:viewed", {
          detail: { threadId: selectedThreadId }
        })
      );
    } catch (_err) {
      // ignore
    }
  };

  const setSearchMode = (active) => {
    const nextActive = Boolean(active);
    if (searchResults) {
      searchResults.hidden = !nextActive;
      if (!nextActive) {
        searchResults.textContent = "";
      }
    }
    if (threadList) {
      threadList.hidden = nextActive;
    }
  };

  const buildMessageKey = (item) => {
    if (!item || typeof item !== "object") return "";
    if (item.pending && item.localRequestId) {
      return `local:${String(item.localRequestId)}`;
    }
    const id = Number(item.id);
    if (Number.isFinite(id) && id > 0) {
      return `srv:${Math.floor(id)}`;
    }
    return "";
  };

  const normalizeMessageRow = (row) => {
    if (!row || typeof row !== "object") return null;
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    const createdAt = Number(row.createdAt);
    return {
      id: Math.floor(id),
      threadId: Number(row.threadId) || 0,
      senderUserId: row.senderUserId ? String(row.senderUserId) : "",
      content: row.content != null ? String(row.content) : "",
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : Date.now(),
      pending: false,
      localRequestId: ""
    };
  };

  const normalizeThreadUser = (value) => {
    const user = value && typeof value === "object" ? value : {};
    return {
      id: user.id ? String(user.id) : "",
      username: user.username ? String(user.username) : "",
      displayName: user.displayName ? String(user.displayName) : "",
      avatarUrl: user.avatarUrl ? String(user.avatarUrl) : ""
    };
  };

  const normalizeThreadRow = (row) => {
    if (!row || typeof row !== "object") return null;
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    const lastMessageAt = Number(row.lastMessageAt);
    const lastMessageId = Number(row.lastMessageId);
    return {
      id: Math.floor(id),
      lastMessageAt: Number.isFinite(lastMessageAt) && lastMessageAt > 0 ? Math.floor(lastMessageAt) : 0,
      lastMessageId: Number.isFinite(lastMessageId) && lastMessageId > 0 ? Math.floor(lastMessageId) : 0,
      lastMessageContent: row.lastMessageContent != null ? String(row.lastMessageContent) : "",
      lastMessageSenderUserId: row.lastMessageSenderUserId ? String(row.lastMessageSenderUserId) : "",
      otherUser: normalizeThreadUser(row.otherUser)
    };
  };

  const createPendingMessage = ({ content, requestId, createdAt }) => {
    const createdValue = Number(createdAt);
    pendingSequence += 1;
    return {
      id: 0,
      threadId: Number(selectedThreadId) || 0,
      senderUserId: currentUserId,
      content: content != null ? String(content) : "",
      createdAt:
        Number.isFinite(createdValue) && createdValue > 0
          ? Math.floor(createdValue)
          : Date.now() + pendingSequence,
      pending: true,
      localRequestId: requestId ? String(requestId) : ""
    };
  };

  const sortMessageItems = (items) =>
    (Array.isArray(items) ? items : [])
      .slice()
      .sort((a, b) => {
        const aCreated = Number(a && a.createdAt);
        const bCreated = Number(b && b.createdAt);
        if (aCreated !== bCreated) {
          return (Number.isFinite(aCreated) ? aCreated : 0) - (Number.isFinite(bCreated) ? bCreated : 0);
        }

        const aId = Number(a && a.id);
        const bId = Number(b && b.id);
        const safeAId = Number.isFinite(aId) ? aId : 0;
        const safeBId = Number.isFinite(bId) ? bId : 0;
        if (safeAId !== safeBId) return safeAId - safeBId;
        return buildMessageKey(a).localeCompare(buildMessageKey(b));
      });

  const mergeMessageItems = (baseItems, incomingItems) => {
    const map = new Map();
    (Array.isArray(baseItems) ? baseItems : []).forEach((item) => {
      const normalized = normalizeMessageRow(item) || (item && item.pending ? item : null);
      const key = buildMessageKey(normalized);
      if (!normalized || !key) return;
      map.set(key, normalized);
    });
    (Array.isArray(incomingItems) ? incomingItems : []).forEach((item) => {
      const normalized = normalizeMessageRow(item) || (item && item.pending ? item : null);
      const key = buildMessageKey(normalized);
      if (!normalized || !key) return;
      map.set(key, normalized);
    });
    return sortMessageItems(Array.from(map.values()));
  };

  const getCombinedMessageItems = () => sortMessageItems([...(messageItems || []), ...(pendingMessages || [])]);

  const snapshotMessageItems = (items) =>
    (Array.isArray(items) ? items : [])
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        if (item.pending) {
          const createdAt = Number(item.createdAt);
          return {
            id: 0,
            threadId: Number(item.threadId) || 0,
            senderUserId: item.senderUserId ? String(item.senderUserId) : "",
            content: item.content != null ? String(item.content) : "",
            createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : Date.now(),
            pending: true,
            localRequestId: item.localRequestId ? String(item.localRequestId) : ""
          };
        }
        return normalizeMessageRow(item);
      })
      .filter(Boolean);

  const persistCurrentThreadViewState = () => {
    const threadId = Number(selectedThreadId);
    if (!Number.isFinite(threadId) || threadId <= 0) return;

    const key = Math.floor(threadId);
    const snapshot = {
      messageItems: snapshotMessageItems(messageItems),
      pendingMessages: snapshotMessageItems(pendingMessages),
      hasOlderMessages: Boolean(hasOlderMessages),
      oldestLoadedMessageId: Number(oldestLoadedMessageId) || 0,
      distanceToBottom: getMessageDistanceToBottom(),
      savedAt: Date.now()
    };

    if (threadViewStateCache.has(key)) {
      threadViewStateCache.delete(key);
    }
    threadViewStateCache.set(key, snapshot);

    while (threadViewStateCache.size > THREAD_VIEW_CACHE_LIMIT) {
      const oldestKey = threadViewStateCache.keys().next().value;
      if (oldestKey == null) break;
      threadViewStateCache.delete(oldestKey);
    }
  };

  const restoreThreadViewState = (threadId) => {
    const key = Number(threadId);
    if (!Number.isFinite(key) || key <= 0) return false;

    const snapshot = threadViewStateCache.get(Math.floor(key));
    if (!snapshot || typeof snapshot !== "object") return false;

    messageItems = snapshotMessageItems(snapshot.messageItems);
    pendingMessages = snapshotMessageItems(snapshot.pendingMessages);
    hasOlderMessages = Boolean(snapshot.hasOlderMessages);
    oldestLoadedMessageId = Number(snapshot.oldestLoadedMessageId) || (messageItems.length ? Number(messageItems[0].id) : 0);
    initialMessagesLoadPromise = null;
    initialMessagesLoadThreadId = 0;

    renderMessages();
    if (messageList) {
      const distance = Number(snapshot.distanceToBottom);
      const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
      if (safeDistance <= CHAT_STICK_BOTTOM_THRESHOLD_PX) {
        scrollMessagesToBottom();
      } else {
        const target = messageList.scrollHeight - messageList.clientHeight - safeDistance;
        messageList.scrollTop = Math.max(0, target);
        lastObservedMessageScrollTop = Math.max(0, Number(messageList.scrollTop) || 0);
      }
    }

    if (hasOlderMessages) {
      window.setTimeout(() => {
        backfillOlderMessagesIfViewportHasNoScroll().catch(() => null);
      }, 0);
    }

    dispatchViewedEvent();
    return true;
  };

  const reconcilePendingMessagesWithServer = () => {
    if (!pendingMessages.length || !messageItems.length || !currentUserId) return;

    const usedServerIndices = new Set();
    pendingMessages = pendingMessages.filter((pending) => {
      if (!pending || !pending.pending) return false;
      const pendingContent = pending.content != null ? String(pending.content) : "";
      const pendingCreatedAt = Number(pending.createdAt) || 0;

      const matchIndex = messageItems.findIndex((serverItem, index) => {
        if (usedServerIndices.has(index)) return false;
        if (!serverItem || serverItem.pending) return false;
        if (String(serverItem.senderUserId || "") !== String(currentUserId)) return false;
        if ((serverItem.content != null ? String(serverItem.content) : "") !== pendingContent) return false;
        const serverCreatedAt = Number(serverItem.createdAt) || 0;
        return Math.abs(serverCreatedAt - pendingCreatedAt) <= 25 * 1000;
      });

      if (matchIndex >= 0) {
        usedServerIndices.add(matchIndex);
        return false;
      }

      return true;
    });
  };

  const getMessageDistanceToBottom = () => {
    if (!messageList) return 0;
    return Math.max(0, messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight);
  };

  const scrollMessagesToBottom = () => {
    if (!messageList) return;
    messageList.scrollTop = messageList.scrollHeight;
    lastObservedMessageScrollTop = Math.max(0, Number(messageList.scrollTop) || 0);
  };

  const getViewportHeightPx = () => {
    const visualViewport = window.visualViewport;
    const visualViewportHeight =
      visualViewport && Number.isFinite(Number(visualViewport.height)) && Number(visualViewport.height) > 0
        ? Number(visualViewport.height)
        : 0;
    const windowHeight = Number.isFinite(Number(window.innerHeight)) && Number(window.innerHeight) > 0
      ? Number(window.innerHeight)
      : 0;
    const docHeight =
      document.documentElement &&
      Number.isFinite(Number(document.documentElement.clientHeight)) &&
      Number(document.documentElement.clientHeight) > 0
        ? Number(document.documentElement.clientHeight)
        : 0;

    const nextHeight = visualViewportHeight || windowHeight || docHeight;
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return 0;
    return Math.max(200, Math.round(nextHeight));
  };

  const syncChatViewportHeight = ({ revealComposer = false } = {}) => {
    if (!chatShell) return;

    const wasNearBottom = getMessageDistanceToBottom() <= 220;

    const heightPx = getViewportHeightPx();
    if (!heightPx) return;
    const nextHeight = `${heightPx}px`;

    chatShell.style.height = nextHeight;
    chatShell.style.minHeight = nextHeight;

    if (wasNearBottom) {
      scrollMessagesToBottom();
    }

    if (!revealComposer || !composeForm || !input) return;
    if (document.activeElement !== input) return;

    try {
      composeForm.scrollIntoView({ block: "end", inline: "nearest", behavior: "auto" });
    } catch (_err) {
      // ignore
    }

    if (getMessageDistanceToBottom() <= 140) {
      scrollMessagesToBottom();
    }
  };

  const scheduleChatViewportSync = ({ revealComposer = false } = {}) => {
    const shouldReveal = Boolean(revealComposer);

    if (chatViewportSyncFrame) {
      window.cancelAnimationFrame(chatViewportSyncFrame);
      chatViewportSyncFrame = 0;
    }
    chatViewportSyncFrame = window.requestAnimationFrame(() => {
      chatViewportSyncFrame = 0;
      syncChatViewportHeight({ revealComposer: shouldReveal });
    });

    if (chatViewportSyncTimer) {
      window.clearTimeout(chatViewportSyncTimer);
      chatViewportSyncTimer = null;
    }
    chatViewportSyncTimer = window.setTimeout(() => {
      chatViewportSyncTimer = null;
      syncChatViewportHeight({ revealComposer: shouldReveal });
    }, CHAT_VIEWPORT_RECHECK_MS);

    if (chatViewportLateSyncTimer) {
      window.clearTimeout(chatViewportLateSyncTimer);
      chatViewportLateSyncTimer = null;
    }
    chatViewportLateSyncTimer = window.setTimeout(() => {
      chatViewportLateSyncTimer = null;
      syncChatViewportHeight({ revealComposer: shouldReveal });
    }, CHAT_VIEWPORT_LATE_RECHECK_MS);
  };

  const captureScrollAnchor = () => {
    if (!messageList) return null;
    const rows = Array.from(messageList.querySelectorAll("[data-message-key]"));
    if (!rows.length) return null;

    const top = Math.max(0, messageList.scrollTop);
    let anchorEl = null;
    for (const row of rows) {
      const rowBottom = row.offsetTop + row.offsetHeight;
      if (rowBottom >= top) {
        anchorEl = row;
        break;
      }
    }
    if (!anchorEl) {
      anchorEl = rows[0];
    }
    if (!anchorEl) return null;

    return {
      key: anchorEl.getAttribute("data-message-key") || "",
      offset: top - anchorEl.offsetTop
    };
  };

  const restoreScrollAnchor = (anchor) => {
    if (!messageList || !anchor || !anchor.key) return false;
    const rows = Array.from(messageList.querySelectorAll("[data-message-key]"));
    const target = rows.find((row) => (row.getAttribute("data-message-key") || "") === anchor.key);
    if (!target) return false;
    const offset = Number(anchor.offset);
    const safeOffset = Number.isFinite(offset) ? offset : 0;
    messageList.scrollTop = Math.max(0, target.offsetTop + safeOffset);
    return true;
  };

  const renderMessages = ({
    preserveTopOffset = false,
    preserveScrollTop = false,
    preserveAnchor = null,
    previousScrollHeight = 0,
    previousScrollTop = 0,
    stickBottom = false
  } = {}) => {
    if (!messageList) return;
    messageList.textContent = "";

    const combinedItems = getCombinedMessageItems();

    if (!combinedItems.length) {
      messageList.textContent = "Chưa có tin nhắn nào. Hãy bắt đầu cuộc trò chuyện.";
      lastObservedMessageScrollTop = 0;
      return;
    }

    const fragment = document.createDocumentFragment();
    combinedItems.forEach((item) => {
      const mine = currentUserId && String(currentUserId) === String(item.senderUserId);
      const row = document.createElement("div");
      row.className = `chat-message${mine ? " is-me" : ""}`;
      const key = buildMessageKey(item);
      if (key) {
        row.setAttribute("data-message-key", key);
      }

      const contentWrap = document.createElement("div");
      contentWrap.className = "chat-message__content";

      const bubble = document.createElement("div");
      bubble.className = "chat-message__bubble";
      renderMessageTextWithStickers(bubble, item.content || "");
      contentWrap.appendChild(bubble);

      if (item && item.pending) {
        const pendingLabel = document.createElement("small");
        pendingLabel.className = "chat-message__pending";
        pendingLabel.textContent = "Đang gửi...";
        contentWrap.appendChild(pendingLabel);
      }

      if (!mine) {
        row.appendChild(createAvatarElement(selectedPeer, "chat-message__avatar"));
      }

      row.appendChild(contentWrap);
      fragment.appendChild(row);
    });

    messageList.appendChild(fragment);
    hydrateChatInlineLinks(messageList).catch(() => null);

    if (preserveTopOffset) {
      const nextHeight = messageList.scrollHeight;
      const delta = Math.max(0, nextHeight - previousScrollHeight);
      messageList.scrollTop = Math.max(0, previousScrollTop + delta);
      lastObservedMessageScrollTop = Math.max(0, Number(messageList.scrollTop) || 0);
      return;
    }

    if (preserveAnchor) {
      if (restoreScrollAnchor(preserveAnchor)) {
        lastObservedMessageScrollTop = Math.max(0, Number(messageList.scrollTop) || 0);
        return;
      }
    }

    if (preserveScrollTop) {
      messageList.scrollTop = Math.max(0, previousScrollTop);
      lastObservedMessageScrollTop = Math.max(0, Number(messageList.scrollTop) || 0);
      return;
    }

    if (stickBottom) {
      scrollMessagesToBottom();
      return;
    }

    lastObservedMessageScrollTop = Math.max(0, Number(messageList.scrollTop) || 0);
  };

  const fetchThreadMessages = async ({
    threadId,
    beforeId = 0,
    limit = INITIAL_MESSAGES_LIMIT,
    markRead = false
  }) => {
    const safeThreadId = Number(threadId);
    if (!Number.isFinite(safeThreadId) || safeThreadId <= 0) {
      return {
        messages: [],
        hasMore: false,
        nextBeforeId: 0
      };
    }

    const safeBeforeId = Number.isFinite(Number(beforeId)) && Number(beforeId) > 0 ? Math.floor(Number(beforeId)) : 0;
    const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : INITIAL_MESSAGES_LIMIT;
    const params = new URLSearchParams();
    params.set("format", "json");
    params.set("limit", String(safeLimit));
    if (markRead && safeBeforeId === 0) {
      params.set("markRead", "1");
    }
    if (safeBeforeId > 0) {
      params.set("beforeId", String(safeBeforeId));
    }

    const data = await fetchJson(
      `/messages/threads/${encodeURIComponent(String(Math.floor(safeThreadId)))}/messages?${params.toString()}`,
      {
        timeoutMs: MESSAGE_REQUEST_TIMEOUT_MS
      }
    );

    const items = Array.isArray(data.messages) ? data.messages.map(normalizeMessageRow).filter(Boolean) : [];
    return {
      messages: items,
      hasMore: Boolean(data.hasMore),
      nextBeforeId: Number(data.nextBeforeId) || 0
    };
  };

  const resetMessageState = () => {
    messageItems = [];
    pendingMessages = [];
    hasOlderMessages = false;
    loadingOlderMessages = false;
    oldestLoadedMessageId = 0;
    suppressRefreshUntil = 0;
    initialMessagesLoadPromise = null;
    initialMessagesLoadThreadId = 0;
  };

  const loadInitialMessages = async ({ emitViewed = false } = {}) => {
    if (!selectedThreadId) return;
    const currentThreadId = Number(selectedThreadId) || 0;
    if (
      initialMessagesLoadPromise &&
      initialMessagesLoadThreadId > 0 &&
      Number(initialMessagesLoadThreadId) === currentThreadId
    ) {
      return initialMessagesLoadPromise;
    }

    initialMessagesLoadThreadId = currentThreadId;
    const token = ++activeMessageThreadToken;

    initialMessagesLoadPromise = (async () => {
      const data = await fetchThreadMessages({
        threadId: currentThreadId,
        beforeId: 0,
        limit: INITIAL_MESSAGES_LIMIT,
        markRead: true
      });
      if (token !== activeMessageThreadToken) return;
      if (Number(selectedThreadId) !== currentThreadId) return;

      messageItems = Array.isArray(data.messages) ? data.messages : [];
      reconcilePendingMessagesWithServer();
      hasOlderMessages = Boolean(data.hasMore);
      oldestLoadedMessageId = data.nextBeforeId || (messageItems.length ? Number(messageItems[0].id) : 0);
      renderMessages({ stickBottom: true });

      await backfillOlderMessagesIfViewportHasNoScroll();

      if (emitViewed) {
        dispatchViewedEvent();
      }
    })().finally(() => {
      if (Number(initialMessagesLoadThreadId) === currentThreadId) {
        initialMessagesLoadPromise = null;
        initialMessagesLoadThreadId = 0;
      }
    });

    return initialMessagesLoadPromise;
  };

  const refreshLatestMessages = async ({ emitViewed = false } = {}) => {
    if (latestRefreshPromise) return latestRefreshPromise;

    latestRefreshPromise = (async () => {
      if (!selectedThreadId) return;
      if (loadingOlderMessages) return;
      if (
        initialMessagesLoadPromise &&
        initialMessagesLoadThreadId > 0 &&
        Number(initialMessagesLoadThreadId) === Number(selectedThreadId)
      ) {
        return;
      }
      const now = Date.now();
      if (now < suppressRefreshUntil) return;

      const currentDistance = getMessageDistanceToBottom();
      if (!emitViewed && currentDistance > 120 && now - lastMessageListScrollAt < 220) {
        return;
      }
      const nearBottomAtRequest = currentDistance < 80;

      const token = activeMessageThreadToken;
      const requestStartedAt = Date.now();

      const data = await fetchThreadMessages({
        threadId: selectedThreadId,
        beforeId: 0,
        limit: INITIAL_MESSAGES_LIMIT,
        markRead: emitViewed || nearBottomAtRequest
      });
      if (token !== activeMessageThreadToken) return;

      const latestItems = Array.isArray(data.messages) ? data.messages : [];
      messageItems = mergeMessageItems(messageItems, latestItems);
      reconcilePendingMessagesWithServer();
      hasOlderMessages = Boolean(data.hasMore || (messageItems.length > latestItems.length));
      oldestLoadedMessageId = messageItems.length ? Number(messageItems[0].id) : 0;

      const userScrolledDuringRequest = lastMessageListScrollAt >= requestStartedAt;
      const distanceAtRender = getMessageDistanceToBottom();
      const nearBottomAtRender = distanceAtRender < 80;
      const previousScrollTop = messageList ? messageList.scrollTop : 0;
      const anchor = captureScrollAnchor();

      if (!userScrolledDuringRequest && (nearBottomAtRequest || nearBottomAtRender || !messageItems.length)) {
        renderMessages({ stickBottom: true });
      } else {
        renderMessages({ preserveAnchor: anchor, preserveScrollTop: !anchor, previousScrollTop });
      }

      if (emitViewed) {
        dispatchViewedEvent();
      }
    })().finally(() => {
      latestRefreshPromise = null;
    });

    return latestRefreshPromise;
  };

  const loadOlderMessages = async () => {
    if (!selectedThreadId || !hasOlderMessages || loadingOlderMessages) return;
    const beforeId = oldestLoadedMessageId || (messageItems.length ? Number(messageItems[0].id) : 0);
    if (!Number.isFinite(beforeId) || beforeId <= 0) {
      hasOlderMessages = false;
      return;
    }

    const token = activeMessageThreadToken;
    const previousScrollHeight = messageList ? messageList.scrollHeight : 0;
    const previousScrollTop = messageList ? messageList.scrollTop : 0;
    const anchor = captureScrollAnchor();

    loadingOlderMessages = true;
    suppressRefreshUntil = Date.now() + 900;
    try {
      const data = await fetchThreadMessages({
        threadId: selectedThreadId,
        beforeId,
        limit: OLDER_MESSAGES_LIMIT
      });
      if (token !== activeMessageThreadToken) return;

      const olderItems = Array.isArray(data.messages) ? data.messages : [];
      if (!olderItems.length) {
        hasOlderMessages = false;
        return;
      }

      messageItems = mergeMessageItems(olderItems, messageItems);
      reconcilePendingMessagesWithServer();
      hasOlderMessages = Boolean(data.hasMore);
      oldestLoadedMessageId = data.nextBeforeId || (messageItems.length ? Number(messageItems[0].id) : 0);

      renderMessages({ preserveAnchor: anchor, preserveTopOffset: !anchor, previousScrollHeight, previousScrollTop });
    } finally {
      loadingOlderMessages = false;
      suppressRefreshUntil = Date.now() + 300;
    }
  };

  const backfillOlderMessagesIfViewportHasNoScroll = async ({ maxRounds = 4 } = {}) => {
    if (!messageList) return;
    if (!selectedThreadId) return;

    const max = Number.isFinite(Number(maxRounds)) && Number(maxRounds) > 0 ? Math.floor(Number(maxRounds)) : 4;
    if (!max) return;

    for (let round = 0; round < max; round += 1) {
      if (!hasOlderMessages) break;
      if (loadingOlderMessages) break;

      const canScroll = messageList.scrollHeight > messageList.clientHeight + 2;
      if (canScroll) break;

      await loadOlderMessages();
    }
  };

  const renderThreadList = (threads) => {
    if (!threadList) return;
    threadList.textContent = "";

    const totalThreads = Array.isArray(threads) ? threads.length : 0;
    setThreadCount(totalThreads);

    if (!Array.isArray(threads) || !threads.length) {
      threadList.textContent = "Chưa có cuộc trò chuyện nào.";
      return;
    }

    threads.forEach((thread) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chat-thread-item${Number(thread.id) === Number(selectedThreadId) ? " is-active" : ""}`;

      const name = toName(thread.otherUser);
      const messagePreview = (thread.lastMessageContent || "").toString().trim();
      const previewText = messagePreview || "Chưa có tin nhắn";
      const timeText = formatRelativeTime(thread.lastMessageAt);

      button.innerHTML = `
        ${renderAvatarHtml(thread.otherUser, "chat-thread-item__avatar")}
        <span class="chat-thread-item__body">
          <strong>${escapeHtml(name)}</strong>
          <span class="chat-thread-item__snippet">${escapeHtml(previewText.slice(0, 90))}</span>
        </span>
        <span class="chat-thread-item__time">${escapeHtml(timeText)}</span>
      `;

      button.addEventListener("click", () => {
        const nextThreadId = Number(thread.id) || 0;
        if (!nextThreadId) return;
        if (nextThreadId === selectedThreadId) {
          closeSidebarOnMobile();
          return;
        }

        persistCurrentThreadViewState();

        selectedThreadId = nextThreadId;
        selectedPeer = thread.otherUser || null;
        setPeerIdentity(selectedPeer);

        const restored = restoreThreadViewState(nextThreadId);
        if (!restored) {
          resetMessageState();
        }

        renderThreadList(threads);
        closeSidebarOnMobile();

        if (!restored) {
          renderMessages();
          loadInitialMessages({ emitViewed: true }).catch(() => null);
        } else {
          refreshLatestMessages({ emitViewed: true }).catch(() => null);
        }
      });

      threadList.appendChild(button);
    });
  };

  const loadThreadList = async ({ force = false } = {}) => {
    if (!force && threadListLoadPromise) {
      return threadListLoadPromise;
    }

    threadListLoadPromise = (async () => {
      const params = new URLSearchParams();
      params.set("format", "json");
      const includeThreadId = Number(selectedThreadId);
      if (Number.isFinite(includeThreadId) && includeThreadId > 0) {
        params.set("includeThreadId", String(Math.floor(includeThreadId)));
      }

      const data = await fetchJson(`/messages/threads?${params.toString()}`, {
        timeoutMs: THREAD_LIST_REQUEST_TIMEOUT_MS
      });
      const threads = Array.isArray(data.threads) ? data.threads.map(normalizeThreadRow).filter(Boolean) : [];

      if (threadViewStateCache.size) {
        const activeThreadIds = new Set(threads.map((thread) => Number(thread.id)).filter((id) => Number.isFinite(id) && id > 0));
        Array.from(threadViewStateCache.keys()).forEach((cachedId) => {
          if (!activeThreadIds.has(Number(cachedId))) {
            threadViewStateCache.delete(cachedId);
          }
        });
      }

      if (!threads.length) {
        selectedThreadId = 0;
        selectedPeer = null;
        setPeerIdentity(null);
        resetMessageState();
        threadViewStateCache.clear();
        renderThreadList([]);
        renderMessages();
        return;
      }

      const matched = threads.find((thread) => Number(thread.id) === Number(selectedThreadId));
      if (matched) {
        selectedPeer = matched.otherUser || selectedPeer;
        setPeerIdentity(selectedPeer);
        renderThreadList(threads);
        return;
      }

      if (Number(selectedThreadId) > 0) {
        persistCurrentThreadViewState();
      }
      selectedThreadId = Number(threads[0].id) || 0;
      selectedPeer = threads[0].otherUser || null;
      setPeerIdentity(selectedPeer);
      const restored = restoreThreadViewState(selectedThreadId);
      if (!restored) {
        resetMessageState();
      }
      renderThreadList(threads);
      if (!restored) {
        renderMessages();
        await loadInitialMessages({ emitViewed: true });
      }
    })().finally(() => {
      threadListLoadPromise = null;
    });

    return threadListLoadPromise;
  };

  const applyBootstrapSnapshot = () => {
    const threads = bootstrapThreadsRaw.map(normalizeThreadRow).filter(Boolean);
    if (!threads.length) return false;

    const preferredThreadId =
      Number.isFinite(bootstrapInitialThreadIdRaw) && bootstrapInitialThreadIdRaw > 0
        ? Math.floor(bootstrapInitialThreadIdRaw)
        : 0;
    const initialThread =
      threads.find((thread) => Number(thread.id) === preferredThreadId) ||
      threads.find((thread) => Number(thread.id) === Number(selectedThreadId)) ||
      threads[0];
    if (!initialThread) return false;

    selectedThreadId = Number(initialThread.id) || 0;
    selectedPeer = initialThread.otherUser || null;
    setPeerIdentity(selectedPeer);

    const initialMessages = bootstrapMessagesRaw
      .map(normalizeMessageRow)
      .filter((item) => item && Number(item.threadId) === Number(selectedThreadId));

    messageItems = initialMessages;
    pendingMessages = [];
    hasOlderMessages = Boolean(bootstrapInitialMessagesHasMore);
    oldestLoadedMessageId = messageItems.length ? Number(messageItems[0].id) || 0 : 0;

    renderThreadList(threads);
    if (messageItems.length) {
      renderMessages({ stickBottom: true });
      dispatchViewedEvent();
    } else {
      renderMessages();
      loadInitialMessages({ emitViewed: true }).catch(() => null);
    }

    return true;
  };

  const scheduleRealtimeRefresh = () => {
    if (realtimeRefreshTimer) return;
    realtimeRefreshTimer = window.setTimeout(() => {
      realtimeRefreshTimer = null;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      loadThreadList().catch(() => null);
      if (selectedThreadId) {
        refreshLatestMessages().catch(() => null);
      }
    }, REALTIME_REFRESH_DEBOUNCE_MS);
  };

  const stopRealtime = () => {
    realtimeConnected = false;
    if (realtimeRefreshTimer) {
      window.clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = null;
    }
    if (!realtimeStream) return;
    try {
      realtimeStream.close();
    } catch (_err) {
      // ignore
    }
    realtimeStream = null;
  };

  const startRealtime = () => {
    if (typeof window.EventSource !== "function") return;
    stopRealtime();
    realtimeStream = new window.EventSource("/messages/stream");

    realtimeStream.onopen = () => {
      realtimeConnected = true;
    };

    realtimeStream.addEventListener("ready", () => {
      realtimeConnected = true;
      scheduleRealtimeRefresh();
    });

    realtimeStream.addEventListener("chat", (event) => {
      try {
        const payload = event && typeof event.data === "string" ? JSON.parse(event.data) : null;
        if (!payload || !payload.threadId) {
          scheduleRealtimeRefresh();
          return;
        }

        const incomingThreadId = Number(payload.threadId);
        if (!Number.isFinite(incomingThreadId) || incomingThreadId <= 0) {
          scheduleRealtimeRefresh();
          return;
        }

        if (selectedThreadId && Number(selectedThreadId) === incomingThreadId) {
          refreshLatestMessages({ emitViewed: true }).catch(() => null);
          return;
        }

        loadThreadList().catch(() => null);
        return;
      } catch (_err) {
        // ignore
      }
      scheduleRealtimeRefresh();
    });

    realtimeStream.addEventListener("heartbeat", () => {
      // keep alive
    });

    realtimeStream.onerror = () => {
      realtimeConnected = false;
      // EventSource reconnects automatically.
    };
  };

  const searchUsers = async () => {
    if (!searchInput || !searchResults) return;
    const query = String(searchInput.value || "").trim();
    if (!query) {
      setSearchMode(false);
      return;
    }

    setSearchMode(true);
    searchResults.textContent = "Đang tìm...";
    try {
      const data = await fetchJson(`/messages/users?format=json&q=${encodeURIComponent(query)}`);
      const users = Array.isArray(data.users) ? data.users : [];
      const normalizedQuery = normalizeSearchText(query);
      const selectedUsers = users
        .map((user, index) => ({
          user,
          score: scoreUserSearchMatch(user, normalizedQuery),
          index
        }))
        .filter((item) => Number.isFinite(item.score))
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          return a.index - b.index;
        })
        .slice(0, CHAT_USER_SEARCH_RESULT_LIMIT)
        .map((item) => item.user);

      searchResults.textContent = "";

      if (!selectedUsers.length) {
        searchResults.textContent = "Không tìm thấy thành viên.";
        return;
      }

      selectedUsers.forEach((user) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-search-item";
        button.innerHTML = `
          ${renderAvatarHtml(user, "chat-search-item__avatar")}
          <span class="chat-search-item__meta">
            <strong>${escapeHtml(toName(user))}</strong>
          </span>
        `;

        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const created = await fetchJson("/messages/threads?format=json", {
              method: "POST",
              body: JSON.stringify({ targetUserId: user.id })
            });

            if (Number(selectedThreadId) > 0) {
              persistCurrentThreadViewState();
            }

            selectedThreadId = Number(created.threadId) || 0;
            selectedPeer = user;
            setPeerIdentity(selectedPeer);
            const restored = restoreThreadViewState(selectedThreadId);
            if (!restored) {
              resetMessageState();
              renderMessages();
            }
            closeSidebarOnMobile();

            searchInput.value = "";
            setSearchMode(false);
            await loadThreadList();
            if (!restored) {
              await loadInitialMessages({ emitViewed: true });
            } else {
              refreshLatestMessages({ emitViewed: true }).catch(() => null);
            }
          } catch (error) {
            setStatus(error && error.message ? error.message : "Không thể mở đoạn chat.", "error");
          } finally {
            button.disabled = false;
          }
        });

        searchResults.appendChild(button);
      });
    } catch (_error) {
      searchResults.textContent = "Không thể tìm thành viên.";
    }
  };

  const focusChatInput = () => {
    if (!input) return;
    try {
      input.focus({ preventScroll: true });
    } catch (_err) {
      input.focus();
    }
  };

  const shouldKeepComposerFocusAfterSend = () => {
    const coarsePointer =
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    const visualViewportWidth =
      window.visualViewport && Number.isFinite(Number(window.visualViewport.width))
        ? Number(window.visualViewport.width)
        : 0;
    const windowWidth = Number.isFinite(Number(window.innerWidth)) ? Number(window.innerWidth) : 0;
    const viewportWidth = visualViewportWidth > 0 ? visualViewportWidth : windowWidth;
    return Boolean(coarsePointer || (viewportWidth > 0 && viewportWidth <= 900));
  };

  const sendMessage = async ({ keepComposerFocus = false } = {}) => {
    if (!selectedThreadId || !input) return;
    const content = String(input.value || "").trim();
    if (!content) return;
    if (content.length > CHAT_LIMIT) {
      setStatus(`Tin nhắn tối đa ${CHAT_LIMIT} ký tự.`, "error");
      return;
    }

    const requestId =
      window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    const pendingMessage = createPendingMessage({
      content,
      requestId,
      createdAt: Date.now()
    });

    pendingMessages = [...pendingMessages, pendingMessage];
    renderMessages({ stickBottom: true });

    const shouldRefocusComposer = Boolean(keepComposerFocus);
    input.value = "";
    updateCounter();
    setStatus("");
    if (shouldRefocusComposer) {
      focusChatInput();
      scheduleChatViewportSync({ revealComposer: true });
    }

    const submit = composeForm && composeForm.querySelector("button[type='submit']");
    if (submit) submit.disabled = true;

    try {
      const data = await fetchJson(
        `/messages/threads/${encodeURIComponent(String(selectedThreadId))}/messages?format=json`,
        {
          method: "POST",
          body: JSON.stringify({ content, requestId })
        }
      );

      pendingMessages = pendingMessages.filter((item) => item.localRequestId !== requestId);

      const sentMessage = normalizeMessageRow(data && data.message ? data.message : null);
      if (sentMessage) {
        messageItems = mergeMessageItems(messageItems, [sentMessage]);
        oldestLoadedMessageId = messageItems.length ? Number(messageItems[0].id) : 0;
        renderMessages({ stickBottom: true });
      } else {
        renderMessages({ stickBottom: true });
      }

      dispatchViewedEvent();
      loadThreadList().catch(() => null);
    } catch (error) {
      pendingMessages = pendingMessages.filter((item) => item.localRequestId !== requestId);
      const previousScrollTop = messageList ? messageList.scrollTop : 0;
      renderMessages({ preserveScrollTop: true, previousScrollTop });

      if (error && error.retryAfter) {
        setStatus(`Bạn gửi tin nhắn quá nhanh. Chờ ${error.retryAfter} giây.`, "error");
      } else {
        setStatus(error && error.message ? error.message : "Không thể gửi tin nhắn.", "error");
      }
    } finally {
      if (submit) submit.disabled = false;
      if (shouldRefocusComposer) {
        window.requestAnimationFrame(() => {
          focusChatInput();
          scheduleChatViewportSync({ revealComposer: true });
        });
      }
    }
  };

  const insertAtCursor = (rawText) => {
    if (!input) return;
    const text = rawText == null ? "" : String(rawText);
    if (!text) return;

    const start = Number.isFinite(input.selectionStart) ? Math.max(0, input.selectionStart) : input.value.length;
    const end = Number.isFinite(input.selectionEnd) ? Math.max(start, input.selectionEnd) : start;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);

    let insertValue = text;
    if (before && !/\s$/.test(before)) {
      insertValue = ` ${insertValue}`;
    }
    if (after && !/^\s/.test(after)) {
      insertValue = `${insertValue} `;
    }

    const nextValue = `${before}${insertValue}${after}`;
    if (nextValue.length > CHAT_LIMIT) {
      setStatus(`Tin nhắn tối đa ${CHAT_LIMIT} ký tự.`, "error");
      input.focus();
      return;
    }

    if (typeof input.setRangeText === "function") {
      input.setRangeText(insertValue, start, end, "end");
    } else {
      input.value = nextValue;
    }

    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const setupPickers = () => {
    const toolsRoot = root.querySelector("[data-chat-tools]");
    if (!toolsRoot || !input) return;

    const emojiDetails = toolsRoot.querySelector("[data-chat-emoji-picker]");
    const stickerDetails = toolsRoot.querySelector("[data-chat-sticker-picker]");
    const emojiPanel = toolsRoot.querySelector("[data-chat-emoji-panel]");
    const stickerPanel = toolsRoot.querySelector("[data-chat-sticker-panel]");

    const closeOthers = (current) => {
      [emojiDetails, stickerDetails].forEach((details) => {
        if (!details || details === current) return;
        details.open = false;
      });
    };

    if (emojiDetails) {
      emojiDetails.addEventListener("toggle", () => {
        if (emojiDetails.open) closeOthers(emojiDetails);
      });
    }

    if (stickerDetails) {
      stickerDetails.addEventListener("toggle", () => {
        if (stickerDetails.open) closeOthers(stickerDetails);
      });
    }

    document.addEventListener("click", (event) => {
      if (!toolsRoot.contains(event.target)) {
        if (emojiDetails) emojiDetails.open = false;
        if (stickerDetails) stickerDetails.open = false;
      }
    });

    const renderEmojiFallback = (message) => {
      if (!emojiPanel) return;
      emojiPanel.classList.remove("chat-picker__panel--emoji-mart");
      emojiPanel.textContent = "";

      if (message) {
        const note = document.createElement("p");
        note.className = "chat-picker__note";
        note.textContent = message;
        emojiPanel.appendChild(note);
      }

      const grid = document.createElement("div");
      grid.className = "chat-picker__fallback-grid";
      emojiFallback.forEach((emoji) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-picker__item chat-picker__item--emoji";
        button.textContent = emoji;
        button.addEventListener("click", () => {
          insertAtCursor(emoji);
          if (emojiDetails) emojiDetails.open = false;
        });
        grid.appendChild(button);
      });
      emojiPanel.appendChild(grid);
    };

    const renderEmojiLoading = () => {
      if (!emojiPanel) return;
      emojiPanel.classList.remove("chat-picker__panel--emoji-mart");
      emojiPanel.textContent = "";

      const loading = document.createElement("div");
      loading.className = "chat-picker__loading";
      loading.setAttribute("aria-label", "Đang tải emoji");

      const spinner = document.createElement("span");
      spinner.className = "chat-picker__spinner";
      spinner.setAttribute("aria-hidden", "true");

      loading.appendChild(spinner);
      emojiPanel.appendChild(loading);
    };

    let emojiPickerMounted = false;
    let emojiPickerLoading = false;
    const mountEmojiMartPicker = async ({ showLoading = true } = {}) => {
      if (!emojiPanel || emojiPickerMounted || emojiPickerLoading) return;
      emojiPickerLoading = true;
      if (showLoading) {
        renderEmojiLoading();
      }

      try {
        const [emojiMartApi, emojiData, emojiI18n] = await Promise.all([
          loadEmojiMartScript(),
          loadEmojiMartData(),
          loadEmojiMartI18n()
        ]);

        if (!emojiMartApi || typeof emojiMartApi.Picker !== "function" || !emojiData) {
          throw new Error("Emoji Mart unavailable");
        }

        emojiPanel.textContent = "";
        const picker = new emojiMartApi.Picker({
          data: emojiData,
          i18n: emojiI18n || undefined,
          locale: "vi",
          set: "native",
          theme: "dark",
          previewPosition: "none",
          searchPosition: "top",
          skinTonePosition: "none",
          dynamicWidth: true,
          onEmojiSelect: (emoji) => {
            const selected = emoji && emoji.native ? String(emoji.native) : "";
            if (!selected) return;
            insertAtCursor(selected);
            if (emojiDetails) emojiDetails.open = false;
          }
        });

        picker.classList.add("chat-picker__emoji-mart");
        emojiPanel.classList.add("chat-picker__panel--emoji-mart");
        emojiPanel.appendChild(picker);
        emojiPickerMounted = true;
      } catch (_error) {
        renderEmojiFallback("Không tải được Emoji Mart. Đang dùng emoji cơ bản.");
        emojiPickerMounted = true;
      } finally {
        emojiPickerLoading = false;
      }
    };

    if (emojiDetails) {
      emojiDetails.addEventListener("toggle", () => {
        if (!emojiDetails.open) return;
        mountEmojiMartPicker({ showLoading: false }).catch(() => {
          renderEmojiFallback("");
        });
      });
    }

    if (emojiPanel) {
      renderEmojiFallback("");
    }

    const renderStickerPanel = () => {
      if (!stickerPanel) return;
      stickerPanel.textContent = "";
      stickerCatalog.forEach((item) => {
        if (!item || !item.code || !item.src) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-picker__item chat-picker__item--sticker";
        button.innerHTML = `<img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.code)}" loading="lazy" />`;
        button.addEventListener("click", () => {
          insertAtCursor(`[sticker:${item.code}]`);
          if (stickerDetails) stickerDetails.open = false;
        });
        stickerPanel.appendChild(button);
      });
    };

    renderStickerPanel();
    ensureStickerCatalog().then(renderStickerPanel).catch(() => null);

  };

  const updateCounter = () => {
    if (!input || !counter) return;
    const value = String(input.value || "");
    counter.textContent = `${value.length}/${CHAT_LIMIT}`;
  };

  const ensureUserInfoDialog = () => {
    if (userInfoDialogState) return userInfoDialogState;

    const dialog = document.createElement("dialog");
    dialog.className = "modal comment-user-modal";
    dialog.setAttribute("aria-label", "Thông tin người dùng");
    dialog.innerHTML = `
      <div class="modal-card comment-user-modal__card" role="document">
        <div class="modal-head">
          <h3 class="modal-title">Thông tin người dùng</h3>
          <button class="modal-close" type="button" data-chat-user-close aria-label="Đóng">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <div class="comment-user-modal__profile">
          <div class="comment-user-modal__avatar" data-chat-user-avatar aria-hidden="true"></div>
          <div class="comment-user-modal__identity">
            <p class="comment-user-modal__name" data-chat-user-name>Người dùng</p>
            <p class="comment-user-modal__username" data-chat-user-username></p>
          </div>
        </div>
        <div class="comment-user-modal__stats">
          <div class="comment-user-modal__stat">
            <span>Tham gia</span>
            <strong data-chat-user-joined>Không rõ</strong>
          </div>
          <div class="comment-user-modal__stat">
            <span>Bình luận</span>
            <strong data-chat-user-comment-count>0</strong>
          </div>
        </div>
        <div class="comment-user-modal__badges" data-chat-user-badges></div>
        <div class="comment-user-modal__contacts" data-chat-user-contacts hidden>
          <a
            class="comment-user-modal__contact"
            href="#"
            target="_blank"
            rel="noopener noreferrer"
            hidden
            data-chat-user-facebook
          >
            <i class="fa-brands fa-facebook" aria-hidden="true"></i>
            <span>Facebook</span>
          </a>
          <a
            class="comment-user-modal__contact"
            href="#"
            target="_blank"
            rel="noopener noreferrer"
            hidden
            data-chat-user-discord
          >
            <i class="fa-brands fa-discord" aria-hidden="true"></i>
            <span>Discord</span>
          </a>
        </div>
        <div class="comment-user-modal__bio-wrap" data-chat-user-bio-wrap hidden>
          <p class="comment-user-modal__bio-label">
            <i class="fa-regular fa-address-card" aria-hidden="true"></i>
            <span>Giới thiệu</span>
          </p>
          <p class="comment-user-modal__bio" data-chat-user-bio></p>
        </div>
        <p class="comment-user-modal__status" data-chat-user-status hidden></p>
      </div>
    `;

    document.body.appendChild(dialog);

    const closeBtn = dialog.querySelector("[data-chat-user-close]");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        if (typeof dialog.close === "function") {
          if (dialog.open) dialog.close();
          return;
        }
        dialog.removeAttribute("open");
      });
    }

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && dialog.open) {
        if (typeof dialog.close === "function") {
          dialog.close();
        } else {
          dialog.removeAttribute("open");
        }
      }
    });

    userInfoDialogState = {
      dialog,
      avatarEl: dialog.querySelector("[data-chat-user-avatar]"),
      nameEl: dialog.querySelector("[data-chat-user-name]"),
      usernameEl: dialog.querySelector("[data-chat-user-username]"),
      joinedEl: dialog.querySelector("[data-chat-user-joined]"),
      commentCountEl: dialog.querySelector("[data-chat-user-comment-count]"),
      badgesEl: dialog.querySelector("[data-chat-user-badges]"),
      contactsEl: dialog.querySelector("[data-chat-user-contacts]"),
      facebookEl: dialog.querySelector("[data-chat-user-facebook]"),
      discordEl: dialog.querySelector("[data-chat-user-discord]"),
      bioWrapEl: dialog.querySelector("[data-chat-user-bio-wrap]"),
      bioEl: dialog.querySelector("[data-chat-user-bio]"),
      statusEl: dialog.querySelector("[data-chat-user-status]")
    };
    return userInfoDialogState;
  };

  const renderUserInfoAvatar = (container, avatarUrl) => {
    if (!container) return;
    container.textContent = "";

    if (isSafeAvatarUrl(avatarUrl)) {
      const image = document.createElement("img");
      image.className = "comment-user-modal__avatar-img";
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.src = String(avatarUrl).trim();
      container.appendChild(image);
      return;
    }

    container.innerHTML = "<i class='fa-regular fa-user' aria-hidden='true'></i>";
  };

  const applyUserContactLink = (anchor, rawUrl) => {
    if (!anchor) return false;
    const url = normalizeProfileLink(rawUrl);
    if (!url) {
      anchor.hidden = true;
      anchor.removeAttribute("href");
      return false;
    }

    anchor.hidden = false;
    anchor.href = url;
    return true;
  };

  const renderUserInfoLoading = (state, hintName) => {
    if (!state) return;
    if (state.nameEl) state.nameEl.textContent = toSafeText(hintName) || "Đang tải...";
    if (state.usernameEl) state.usernameEl.textContent = "";
    if (state.joinedEl) state.joinedEl.textContent = "Đang tải...";
    if (state.commentCountEl) state.commentCountEl.textContent = "...";
    if (state.badgesEl) state.badgesEl.textContent = "";
    if (state.contactsEl) state.contactsEl.hidden = true;
    if (state.facebookEl) {
      state.facebookEl.hidden = true;
      state.facebookEl.removeAttribute("href");
    }
    if (state.discordEl) {
      state.discordEl.hidden = true;
      state.discordEl.removeAttribute("href");
    }
    if (state.bioWrapEl) state.bioWrapEl.hidden = true;
    if (state.bioEl) state.bioEl.textContent = "";
    if (state.statusEl) {
      state.statusEl.hidden = false;
      state.statusEl.textContent = "Đang tải thông tin người dùng...";
    }
    renderUserInfoAvatar(state.avatarEl, "");
  };

  const renderUserInfoError = (state, message) => {
    if (!state || !state.statusEl) return;
    state.statusEl.hidden = false;
    state.statusEl.textContent = toSafeText(message) || "Không thể tải thông tin người dùng.";
  };

  const renderUserInfoProfile = (state, profile) => {
    if (!state) return;
    const data = profile && typeof profile === "object" ? profile : {};

    const name = toSafeText(data.name) || "Người dùng";
    const username = toSafeText(data.username, 80);
    const avatarUrl = toSafeText(data.avatarUrl, 500);
    const joinedAtText = toSafeText(data.joinedAtText, 80) || "Không rõ";
    const commentCount = toSafeCount(data.commentCount);
    const bio = toSafeText(data.bio, 300);
    const badges = Array.isArray(data.badges) ? data.badges : [];

    if (state.nameEl) state.nameEl.textContent = name;
    if (state.usernameEl) {
      state.usernameEl.textContent = username ? `@${username}` : "Chưa đặt username";
    }

    renderUserInfoAvatar(state.avatarEl, avatarUrl);

    if (state.joinedEl) state.joinedEl.textContent = joinedAtText;
    if (state.commentCountEl) state.commentCountEl.textContent = numberFormatter.format(commentCount);

    if (state.badgesEl) {
      state.badgesEl.textContent = "";
      if (badges.length) {
        badges.forEach((badge) => {
          if (!badge || typeof badge !== "object") return;
          const label = toSafeText(badge.label, 80);
          if (!label) return;
          const color = toSafeText(badge.color, 30);
          const badgeEl = document.createElement("span");
          badgeEl.className = "comment-badge";
          if (color) {
            badgeEl.style.setProperty("--badge-color", color);
            badgeEl.style.setProperty("--badge-bg", `${color}22`);
          }
          badgeEl.textContent = label;
          state.badgesEl.appendChild(badgeEl);
        });
      }

      if (!state.badgesEl.childElementCount) {
        const emptyEl = document.createElement("span");
        emptyEl.className = "comment-user-modal__empty";
        emptyEl.textContent = "Chưa có huy hiệu";
        state.badgesEl.appendChild(emptyEl);
      }
    }

    const hasFacebook = applyUserContactLink(state.facebookEl, data.facebookUrl);
    const hasDiscord = applyUserContactLink(state.discordEl, data.discordUrl);
    if (state.contactsEl) {
      state.contactsEl.hidden = !(hasFacebook || hasDiscord);
    }

    if (state.bioWrapEl && state.bioEl) {
      if (bio) {
        state.bioWrapEl.hidden = false;
        state.bioEl.textContent = bio;
      } else {
        state.bioWrapEl.hidden = true;
        state.bioEl.textContent = "";
      }
    }

    if (state.statusEl) {
      state.statusEl.hidden = true;
      state.statusEl.textContent = "";
    }
  };

  const fetchUserProfile = async (userId) => {
    const id = toSafeText(userId, 128);
    if (!id) throw new Error("Không tìm thấy người dùng.");

    if (profileCache.has(id)) {
      return profileCache.get(id);
    }
    if (profilePendingMap.has(id)) {
      return profilePendingMap.get(id);
    }

    const request = fetch(`/comments/users/${encodeURIComponent(id)}?format=json`, {
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin"
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || data.ok !== true || !data.profile) {
          const message = data && data.error ? String(data.error) : "Không thể tải thông tin người dùng.";
          throw new Error(message);
        }
        profileCache.set(id, data.profile);
        return data.profile;
      })
      .finally(() => {
        profilePendingMap.delete(id);
      });

    profilePendingMap.set(id, request);
    return request;
  };

  const openSelectedPeerProfile = async () => {
    const openProfilePath = (path) => {
      const href = toSafeText(path, 300);
      if (!href) return;
      const opened = window.open(href, "_blank", "noopener,noreferrer");
      if (!opened) {
        window.location.assign(href);
      }
    };

    const userId = selectedPeer && selectedPeer.id ? String(selectedPeer.id) : "";
    if (!userId) {
      setStatus("Hãy chọn một đoạn chat trước khi mở trang thành viên.", "error");
      return;
    }

    const directPath = buildUserProfilePath(selectedPeer && selectedPeer.username ? selectedPeer.username : "");
    if (directPath) {
      openProfilePath(directPath);
      return;
    }

    const profile = await fetchUserProfile(userId);
    const username = profile && profile.username ? String(profile.username).trim().toLowerCase() : "";
    const profilePath = buildUserProfilePath(username);
    if (!profilePath) {
      throw new Error("Không tìm thấy trang thành viên.");
    }

    selectedPeer = {
      ...(selectedPeer && typeof selectedPeer === "object" ? selectedPeer : {}),
      username
    };
    setPeerIdentity(selectedPeer);
    openProfilePath(profilePath);
  };

  const openSelectedPeerInfoDialog = async () => {
    const userId = selectedPeer && selectedPeer.id ? String(selectedPeer.id) : "";
    if (!userId) {
      setStatus("Hãy chọn một đoạn chat trước khi xem thông tin người dùng.", "error");
      return;
    }

    const state = ensureUserInfoDialog();
    if (!state || !state.dialog) return;

    renderUserInfoLoading(state, toName(selectedPeer));

    if (typeof state.dialog.showModal === "function") {
      if (!state.dialog.open) state.dialog.showModal();
    } else {
      state.dialog.setAttribute("open", "open");
    }

    userInfoRequestToken += 1;
    const token = userInfoRequestToken;

    try {
      const profile = await fetchUserProfile(userId);
      if (token !== userInfoRequestToken) return;
      renderUserInfoProfile(state, profile);
    } catch (error) {
      if (token !== userInfoRequestToken) return;
      const message = error && error.message ? String(error.message) : "Không thể tải thông tin người dùng.";
      renderUserInfoError(state, message);
    }
  };

  const stopTimers = () => {
    if (threadListTimer) window.clearInterval(threadListTimer);
    if (messageTimer) window.clearInterval(messageTimer);
    if (chatViewportSyncFrame) window.cancelAnimationFrame(chatViewportSyncFrame);
    if (chatViewportSyncTimer) window.clearTimeout(chatViewportSyncTimer);
    if (chatViewportLateSyncTimer) window.clearTimeout(chatViewportLateSyncTimer);
    threadListTimer = null;
    messageTimer = null;
    chatViewportSyncFrame = 0;
    chatViewportSyncTimer = null;
    chatViewportLateSyncTimer = null;
    stopRealtime();
  };

  const boot = async () => {
    let resolvedUserId = bootstrapCurrentUserId;

    if (!resolvedUserId) {
      const session = await getSession().catch(() => null);
      resolvedUserId = session && session.user && session.user.id ? String(session.user.id) : "";
    } else {
      getSession().catch(() => null);
    }

    if (!resolvedUserId) {
      if (messageList) messageList.textContent = "Bạn cần đăng nhập để sử dụng tin nhắn.";
      if (composeForm) composeForm.hidden = true;
      return;
    }

    sidebarCollapsedDesktop = readStoredSidebarCollapsed();
    syncSidebarStateForViewport();

    currentUserId = String(resolvedUserId).trim();

    ensureStickerCatalog().catch(() => null);
    setupPickers();
    setPeerIdentity(null);
    setSearchMode(false);
    updateCounter();

    const bootstrapApplied = applyBootstrapSnapshot();
    if (!bootstrapApplied && threadList) {
      threadList.textContent = "Đang tải đoạn chat...";
    }

    stopTimers();
    const loadLatestThreads = async () => {
      try {
        await loadThreadList();
      } catch (_error) {
        if (!bootstrapApplied && threadList) {
          threadList.textContent = "Đang tải lại đoạn chat...";
        }
        window.setTimeout(() => {
          loadThreadList().catch(() => null);
        }, 1600);
      }
    };

    loadLatestThreads().catch(() => null);
    syncSidebarStateForViewport();
    scheduleChatViewportSync();

    threadListTimer = window.setInterval(() => {
      if (shouldPausePolling()) return;
      loadThreadList().catch(() => null);
    }, POLL_THREAD_LIST_MS);

    messageTimer = window.setInterval(() => {
      if (!selectedThreadId) return;
      if (shouldPausePolling()) return;
      refreshLatestMessages().catch(() => null);
    }, POLL_MESSAGES_MS);

    startRealtime();
  };

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const query = String(searchInput.value || "").trim();
      if (!query) {
        window.clearTimeout(searchTimer);
        setSearchMode(false);
        return;
      }
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        searchUsers().catch(() => null);
      }, 220);
    });
  }

  if (input) {
    input.addEventListener("input", updateCounter);
    input.addEventListener("focus", () => {
      scheduleChatViewportSync({ revealComposer: true });
    });
    input.addEventListener("blur", () => {
      scheduleChatViewportSync();
    });
  }

  const handleViewportGeometryChange = () => {
    scheduleChatViewportSync({ revealComposer: document.activeElement === input });
  };

  window.addEventListener("resize", handleViewportGeometryChange, { passive: true });
  window.addEventListener("orientationchange", handleViewportGeometryChange);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", handleViewportGeometryChange);
    window.visualViewport.addEventListener("scroll", handleViewportGeometryChange);
  }

  if (composeForm) {
    composeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const keepComposerFocus = shouldKeepComposerFocusAfterSend();
      if (keepComposerFocus) {
        focusChatInput();
        scheduleChatViewportSync({ revealComposer: true });
      }
      sendMessage({ keepComposerFocus }).catch(() => null);
    });
  }

  if (messageList) {
    messageList.addEventListener("scroll", () => {
      const currentTop = Math.max(0, Number(messageList.scrollTop) || 0);
      const previousTop = lastObservedMessageScrollTop;
      lastObservedMessageScrollTop = currentTop;
      lastMessageListScrollAt = Date.now();
      if (currentTop > 72) return;
      if (currentTop >= previousTop - 0.5) return;
      loadOlderMessages().catch(() => null);
    });
  }

  if (infoButton) {
    infoButton.addEventListener("click", (event) => {
      event.preventDefault();
      openSelectedPeerInfoDialog().catch(() => null);
    });
  }

  if (peerNameLink) {
    peerNameLink.addEventListener("click", (event) => {
      if (peerNameLink.classList.contains("is-disabled")) {
        event.preventDefault();
        return;
      }

      const href = toSafeText(peerNameLink.getAttribute("href"), 300);
      if (href && href !== "#") {
        return;
      }

      event.preventDefault();
      openSelectedPeerProfile().catch((error) => {
        const message = error && error.message ? String(error.message) : "Không thể mở trang thành viên.";
        setStatus(message, "error");
      });
    });
  }

  sidebarToggleButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      toggleSidebar();
    });
  });

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", () => {
      closeSidebarOnMobile();
    });
  }

  if (mobileLayoutMedia) {
    const handleMediaChange = () => {
      syncSidebarStateForViewport();
    };
    if (typeof mobileLayoutMedia.addEventListener === "function") {
      mobileLayoutMedia.addEventListener("change", handleMediaChange);
    } else if (typeof mobileLayoutMedia.addListener === "function") {
      mobileLayoutMedia.addListener(handleMediaChange);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    loadThreadList().catch(() => null);
    if (selectedThreadId) {
      refreshLatestMessages().catch(() => null);
    }
  });

  window.addEventListener("focus", () => {
    loadThreadList().catch(() => null);
    if (selectedThreadId) {
      refreshLatestMessages().catch(() => null);
    }
  });

  window.addEventListener("beforeunload", stopTimers);
  boot().catch(() => null);
})();
