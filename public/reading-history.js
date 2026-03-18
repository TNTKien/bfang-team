(() => {
  const HISTORY_ENDPOINT = "/account/reading-history";

  const resolveSiteName = () => {
    const config = window.__SITE_CONFIG && typeof window.__SITE_CONFIG === "object" ? window.__SITE_CONFIG : null;
    const branding = config && config.branding && typeof config.branding === "object" ? config.branding : null;
    const name = branding && branding.siteName ? String(branding.siteName).trim() : "";
    return name || "BFANG Team";
  };

  const FALLBACK_AUTHOR_NAME = resolveSiteName();

  let detailStartButtonEl = null;
  let readingProgressEl = null;
  let historyPage = null;
  let historyLockedEl = null;
  let historyContentEl = null;
  let historyStatusEl = null;
  let historyEmptyEl = null;
  let historyListEl = null;

  const captureReadingHistoryNodes = () => {
    detailStartButtonEl = document.querySelector("[data-reading-detail-start]");
    readingProgressEl = document.querySelector("[data-reading-progress]");
    historyPage = document.querySelector("[data-reading-history-page]");
    historyLockedEl = historyPage ? historyPage.querySelector("[data-reading-history-locked]") : null;
    historyContentEl = historyPage ? historyPage.querySelector("[data-reading-history-content]") : null;
    historyStatusEl = historyPage ? historyPage.querySelector("[data-reading-history-status]") : null;
    historyEmptyEl = historyPage ? historyPage.querySelector("[data-reading-history-empty]") : null;
    historyListEl = historyPage ? historyPage.querySelector("[data-reading-history-list]") : null;
  };

  captureReadingHistoryNodes();

  let historyCache = [];
  let historyMapCache = new Map();
  let historyLoadingPromise = null;
  let progressSaved = false;

  const escapeHtml = (value) =>
    (value == null ? "" : String(value))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const escapeAttr = (value) => escapeHtml(value).replace(/`/g, "&#96;");

  const toSafePath = (value) => {
    const text = (value || "").toString().trim();
    if (!text || !text.startsWith("/")) return "";
    return text;
  };

  const toSafeImageUrl = (value) => {
    const text = (value || "").toString().trim();
    if (!text) return "";
    if (text.startsWith("/")) return text;
    if (/^https?:\/\//i.test(text)) return text;
    return "";
  };

  const cacheBust = (url, token) => {
    const safeUrl = toSafeImageUrl(url);
    if (!safeUrl) return "";
    const separator = safeUrl.includes("?") ? "&" : "?";
    const value = token == null || token === "" ? Date.now() : token;
    return `${safeUrl}${separator}t=${encodeURIComponent(String(value))}`;
  };

  const formatChapterNumber = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const normalized = Math.abs(number) < 1e-9 ? 0 : number;
    if (Math.abs(normalized - Math.round(normalized)) < 1e-9) {
      return String(Math.round(normalized));
    }
    return normalized.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  };

  const truncateCardTitle = (value) => {
    const text = (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
    if (!text) return "";

    const maxWords = 4;
    const maxChars = 24;
    const words = text.split(" ").filter(Boolean);
    let shortened = words.length > maxWords ? words.slice(0, maxWords).join(" ") : text;
    if (shortened.length > maxChars) {
      shortened = shortened.slice(0, maxChars).trimEnd();
    }

    return shortened.length < text.length ? `${shortened}...` : shortened;
  };

  const getSessionSafe = async () => {
    if (window.BfangAuth && typeof window.BfangAuth.getSession === "function") {
      try {
        const session = await window.BfangAuth.getSession();
        return session && ((session.user && typeof session.user === "object") || session.access_token) ? session : null;
      } catch (_err) {
        return null;
      }
    }
    return null;
  };

  const getAccessTokenSafe = async () => {
    const session = await getSessionSafe();
    if (session && session.access_token) {
      return String(session.access_token).trim();
    }
    return "";
  };

  const resetDetailStartButtonUi = () => {
    if (!detailStartButtonEl) return;
    const fallbackLabel = (detailStartButtonEl.dataset.startDefaultLabel || "").toString().trim() || "Đọc từ đầu";
    const fallbackUrl =
      toSafePath(detailStartButtonEl.dataset.startDefaultUrl || "") ||
      toSafePath(detailStartButtonEl.getAttribute("href") || "");
    detailStartButtonEl.textContent = fallbackLabel;
    if (fallbackUrl) {
      detailStartButtonEl.setAttribute("href", fallbackUrl);
    }
  };

  const setHistoryStatus = (text, variant) => {
    if (!historyStatusEl) return;
    const message = (text || "").toString().trim();
    if (!message) {
      historyStatusEl.hidden = true;
      historyStatusEl.textContent = "";
      historyStatusEl.classList.remove("is-error", "is-success");
      return;
    }
    historyStatusEl.hidden = false;
    historyStatusEl.textContent = message;
    historyStatusEl.classList.remove("is-error", "is-success");
    if (variant === "error") historyStatusEl.classList.add("is-error");
    if (variant === "success") historyStatusEl.classList.add("is-success");
  };

  const setHistoryLocked = (locked) => {
    if (historyLockedEl) historyLockedEl.hidden = !locked;
    if (historyContentEl) historyContentEl.hidden = locked;
  };

  const fetchReadingHistory = async () => {
    const token = await getAccessTokenSafe();
    const headers = {
      Accept: "application/json"
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(HISTORY_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      headers,
      credentials: "same-origin"
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true || !Array.isArray(data.history)) {
      return null;
    }

    return data.history;
  };

  const loadReadingHistory = async ({ force = false } = {}) => {
    if (!force && historyLoadingPromise) {
      return historyLoadingPromise;
    }

    historyLoadingPromise = fetchReadingHistory()
      .then((history) => {
        historyCache = Array.isArray(history) ? history : [];
        historyMapCache = new Map(
          historyCache
            .map((item) => {
              const slug = item && item.mangaSlug ? String(item.mangaSlug).trim() : "";
              if (!slug) return null;
              return [slug, item];
            })
            .filter(Boolean)
        );
        return historyCache;
      })
      .finally(() => {
        historyLoadingPromise = null;
      });

    return historyLoadingPromise;
  };

  const buildContinueText = (item) => {
    if (item && item.chapterIsOneshot) {
      return "Đọc Oneshot";
    }
    const chapterText =
      item && item.chapterNumberText
        ? String(item.chapterNumberText).trim()
        : formatChapterNumber(item && item.chapterNumber);
    return chapterText ? `Đọc ch. ${chapterText}` : "Đọc từ đầu";
  };

  const renderDetailStartButtonUi = () => {
    if (!detailStartButtonEl) return;
    resetDetailStartButtonUi();

    const slug = (detailStartButtonEl.dataset.mangaSlug || "").toString().trim();
    if (!slug) return;

    const fallbackUrl =
      toSafePath(detailStartButtonEl.dataset.startDefaultUrl || "") ||
      toSafePath(detailStartButtonEl.getAttribute("href") || "");
    const item = historyMapCache.get(slug);
    const historyChapterUrl = toSafePath(item && item.chapterUrl ? item.chapterUrl : "");

    if (historyChapterUrl) {
      detailStartButtonEl.setAttribute("href", historyChapterUrl);
      detailStartButtonEl.textContent = buildContinueText(item);
      return;
    }

    if (fallbackUrl) {
      detailStartButtonEl.setAttribute("href", fallbackUrl);
    }
  };

  const renderHistoryPageUi = () => {
    if (!historyPage || !historyListEl || !historyEmptyEl) return;

    if (!historyCache.length) {
      historyListEl.innerHTML = "";
      historyEmptyEl.hidden = false;
      return;
    }

    historyEmptyEl.hidden = true;

    const rowsHtml = historyCache
      .map((item) => {
        const mangaTitle = item && item.mangaTitle ? String(item.mangaTitle).trim() : "";
        const fullTitle = mangaTitle || "Truyện";
        const cardTitle = truncateCardTitle(fullTitle);
        const mangaUrl = toSafePath(item && item.mangaUrl ? item.mangaUrl : "");
        const mangaAuthor = item && item.mangaAuthor ? String(item.mangaAuthor).trim() : "";
        const mangaGroupName = item && item.mangaGroupName ? String(item.mangaGroupName).trim() : "";
        const authorText = mangaGroupName || mangaAuthor || FALLBACK_AUTHOR_NAME;
        const chapterUrl = toSafePath(item && item.chapterUrl ? item.chapterUrl : "");
        const chapterNumberText = item && item.chapterNumberText ? String(item.chapterNumberText).trim() : "";
        const cardHref = chapterUrl || mangaUrl || "/manga";
        const status = item && item.mangaStatus ? String(item.mangaStatus).trim() : "";
        const statusText = status || "Đang theo dõi";
        const statusClass =
          status === "Hoàn thành"
            ? "is-complete"
            : status === "Tạm dừng"
            ? "is-hiatus"
            : "is-ongoing";
        const chapterBadgeLabel = item && item.chapterIsOneshot
          ? "Oneshot"
          : chapterNumberText
          ? `Ch. ${chapterNumberText}`
          : "Tiếp tục đọc";

        const coverUrl = cacheBust(
          item && item.mangaCover ? item.mangaCover : "",
          item && item.mangaCoverUpdatedAt != null ? item.mangaCoverUpdatedAt : 0
        );

        return `
          <article class="manga-card manga-card--list">
            <a href="${escapeAttr(cardHref)}">
              <div class="cover">
                ${coverUrl
                  ? `<img src="${escapeAttr(coverUrl)}" alt="Bìa ${escapeAttr(mangaTitle || "truyện")}" />`
                  : '<span class="cover__label">No Cover</span>'}
                <span class="manga-badge ${statusClass}">${escapeHtml(statusText)}</span>
                <span class="manga-chapter-label">${escapeHtml(chapterBadgeLabel)}</span>
              </div>
              <div class="manga-body">
                <h3 title="${escapeAttr(fullTitle)}">${escapeHtml(cardTitle)}</h3>
                <p class="manga-author">${escapeHtml(authorText)}</p>
              </div>
            </a>
          </article>
        `;
      })
      .join("");

    historyListEl.innerHTML = rowsHtml;
  };

  const saveCurrentReadingProgress = async (session) => {
    if (!readingProgressEl || progressSaved) return;

    const mangaSlug = (readingProgressEl.dataset.readingMangaSlug || "").toString().trim();
    const chapterNumberText = (readingProgressEl.dataset.readingChapterNumber || "").toString().trim();
    const chapterNumber = Number(chapterNumberText);
    if (!mangaSlug || !Number.isFinite(chapterNumber) || chapterNumber < 0) return;

    const tokenFromSession =
      session && session.access_token ? String(session.access_token).trim() : "";
    const token = tokenFromSession || (await getAccessTokenSafe());
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(HISTORY_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      keepalive: true,
      headers,
      credentials: "same-origin",
      body: JSON.stringify({
        mangaSlug,
        chapterNumber
      })
    }).catch(() => null);

    if (response && response.ok) {
      progressSaved = true;
    }
  };

  const handleSignedOutUi = () => {
    historyCache = [];
    historyMapCache = new Map();
    renderDetailStartButtonUi();
    if (historyPage) {
      setHistoryLocked(true);
      setHistoryStatus("");
      if (historyListEl) historyListEl.innerHTML = "";
      if (historyEmptyEl) historyEmptyEl.hidden = true;
    }
  };

  const refreshFromSession = async (session, options = {}) => {
    const settings = options && typeof options === "object" ? options : {};
    const resolvedSession = settings.resolveSession ? await getSessionSafe() : session;
    const signedIn = Boolean(
      resolvedSession &&
        ((resolvedSession.user && typeof resolvedSession.user === "object") || resolvedSession.access_token)
    );

    if (!signedIn) {
      handleSignedOutUi();
      return;
    }

    if (historyPage) {
      setHistoryLocked(false);
      setHistoryStatus("");
    }

    await saveCurrentReadingProgress(resolvedSession);

    const shouldLoadHistory = Boolean(detailStartButtonEl || historyPage);
    if (!shouldLoadHistory) {
      return;
    }

    const history = await loadReadingHistory({ force: settings.force === true });
    if (!Array.isArray(history)) {
      if (historyPage) {
        setHistoryStatus("Không thể tải lịch sử đọc. Vui lòng thử lại.", "error");
      }
      return;
    }

    renderDetailStartButtonUi();
    renderHistoryPageUi();
  };

  window.addEventListener("bfang:auth", (event) => {
    const detail = event && event.detail ? event.detail : null;
    const session = detail && detail.session ? detail.session : null;
    refreshFromSession(session, { force: true }).catch(() => null);
  });

  const refreshFromCurrentSession = () => {
    refreshFromSession(null, { resolveSession: true, force: true }).catch(() => null);
  };

  window.addEventListener("pageshow", refreshFromCurrentSession);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    refreshFromCurrentSession();
  });

  window.addEventListener("bfang:pagechange", () => {
    captureReadingHistoryNodes();
    progressSaved = false;
    refreshFromSession(null, { resolveSession: true }).catch(() => null);
  });

  refreshFromSession(null, { resolveSession: true }).catch(() => null);
})();
