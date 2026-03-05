(() => {
  const BOOKMARKS_ENDPOINT = "/account/bookmarks";
  const TOGGLE_BOOKMARK_ENDPOINT = "/account/bookmarks/toggle";
  const REMOVE_BOOKMARK_ENDPOINT = "/account/bookmarks/remove";
  const BOOKMARKS_PER_PAGE = 10;
  const DETAIL_BUTTON_BOUND_ATTR = "data-bookmark-bound";
  const PAGE_BOUND_ATTR = "data-bookmark-page-bound";

  let detailBookmarkButton = null;
  let detailBookmarkLabel = null;
  let detailBookmarked = false;
  let detailBookmarkPending = false;
  let detailFlashTimer = null;

  let bookmarkPageRoot = null;
  let bookmarkLockedEl = null;
  let bookmarkContentEl = null;
  let bookmarkStatusEl = null;
  let bookmarkEmptyEl = null;
  let bookmarkListEl = null;
  let bookmarkPaginationEl = null;
  let bookmarkLoading = false;
  let bookmarkCurrentPage = 1;
  let bookmarkPagination = null;

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
    const value = token == null || token === "" ? 0 : token;
    return `${safeUrl}${separator}t=${encodeURIComponent(String(value))}`;
  };

  const escapeHtml = (value) =>
    (value == null ? "" : String(value))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const escapeAttr = (value) => escapeHtml(value).replace(/`/g, "&#96;");

  const formatChapterNumber = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const normalized = Math.abs(number) < 1e-9 ? 0 : number;
    if (Math.abs(normalized - Math.round(normalized)) < 1e-9) {
      return String(Math.round(normalized));
    }
    return normalized.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  };

  const getSessionSafe = async () => {
    if (window.BfangAuth && typeof window.BfangAuth.getSession === "function") {
      try {
        const session = await window.BfangAuth.getSession();
        return session && session.access_token ? session : null;
      } catch (_err) {
        return null;
      }
    }
    return null;
  };

  const getAccessTokenSafe = async () => {
    const session = await getSessionSafe();
    return session && session.access_token ? String(session.access_token).trim() : "";
  };

  const openLoginDialog = () => {
    const loginBtn = document.querySelector("[data-auth-login]");
    if (loginBtn) {
      loginBtn.click();
      return;
    }
    if (window.BfangAuth && typeof window.BfangAuth.signIn === "function") {
      window.BfangAuth.signIn().catch(() => null);
    }
  };

  const requestBookmarkApi = async ({ url, method = "GET", body = null, token = "" } = {}) => {
    const headers = {
      Accept: "application/json"
    };
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body && typeof body === "object" ? body : {})
    }).catch(() => null);

    const data = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok || !data || data.ok !== true) {
      const errorText = data && data.error ? String(data.error).trim() : "Không thể xử lý bookmark.";
      return { ok: false, error: errorText || "Không thể xử lý bookmark." };
    }

    return { ok: true, data };
  };

  const dispatchBookmarkUpdated = ({ mangaId, mangaSlug, bookmarked }) => {
    try {
      window.dispatchEvent(
        new CustomEvent("bfang:bookmark-updated", {
          detail: {
            mangaId: Number(mangaId) || 0,
            mangaSlug: (mangaSlug || "").toString().trim(),
            bookmarked: Boolean(bookmarked)
          }
        })
      );
    } catch (_err) {
      // ignore
    }
  };

  const clearDetailFlashTimer = () => {
    if (!detailFlashTimer) return;
    window.clearTimeout(detailFlashTimer);
    detailFlashTimer = null;
  };

  const renderDetailBookmarkButton = () => {
    if (!detailBookmarkButton || !detailBookmarkLabel) return;
    detailBookmarkButton.classList.toggle("is-bookmarked", detailBookmarked);
    detailBookmarkButton.classList.toggle("is-pending", detailBookmarkPending);
    detailBookmarkButton.setAttribute("aria-pressed", detailBookmarked ? "true" : "false");
    detailBookmarkLabel.textContent = detailBookmarked ? "Đã bookmark" : "Bookmark";
  };

  const flashDetailBookmarkLabel = (text) => {
    if (!detailBookmarkLabel) return;
    const message = (text || "").toString().trim();
    if (!message) return;
    clearDetailFlashTimer();
    detailBookmarkLabel.textContent = message;
    detailFlashTimer = window.setTimeout(() => {
      detailFlashTimer = null;
      if (!detailBookmarkPending) {
        renderDetailBookmarkButton();
      }
    }, 1300);
  };

  const captureDetailNodes = () => {
    detailBookmarkButton = document.querySelector("[data-manga-bookmark-button]");
    detailBookmarkLabel = detailBookmarkButton
      ? detailBookmarkButton.querySelector("[data-bookmark-label]")
      : null;
    detailBookmarked =
      detailBookmarkButton && detailBookmarkButton.getAttribute("data-bookmarked") === "1";
    detailBookmarkPending = false;
    clearDetailFlashTimer();
  };

  const toggleMangaBookmark = async () => {
    if (!detailBookmarkButton || detailBookmarkPending) return;
    const mangaSlug = (detailBookmarkButton.getAttribute("data-manga-slug") || "").toString().trim();
    if (!mangaSlug) return;

    const token = await getAccessTokenSafe();
    if (!token) {
      openLoginDialog();
      flashDetailBookmarkLabel("Đăng nhập để bookmark");
      return;
    }

    detailBookmarkPending = true;
    renderDetailBookmarkButton();

    const result = await requestBookmarkApi({
      url: TOGGLE_BOOKMARK_ENDPOINT,
      method: "POST",
      body: { mangaSlug },
      token
    });

    detailBookmarkPending = false;
    if (!result.ok) {
      renderDetailBookmarkButton();
      flashDetailBookmarkLabel(result.error || "Không thể bookmark");
      return;
    }

    const data = result.data || {};
    detailBookmarked = Boolean(data.bookmarked);
    detailBookmarkButton.setAttribute("data-bookmarked", detailBookmarked ? "1" : "0");
    renderDetailBookmarkButton();
    dispatchBookmarkUpdated({
      mangaId: Number(data.mangaId) || 0,
      mangaSlug: (data.mangaSlug || mangaSlug).toString().trim(),
      bookmarked: detailBookmarked
    });
  };

  const bindDetailBookmarkButton = () => {
    if (!detailBookmarkButton) return;
    if (detailBookmarkButton.getAttribute(DETAIL_BUTTON_BOUND_ATTR) === "1") {
      renderDetailBookmarkButton();
      return;
    }
    detailBookmarkButton.setAttribute(DETAIL_BUTTON_BOUND_ATTR, "1");
    detailBookmarkButton.addEventListener("click", (event) => {
      event.preventDefault();
      toggleMangaBookmark().catch(() => {
        detailBookmarkPending = false;
        renderDetailBookmarkButton();
        flashDetailBookmarkLabel("Không thể bookmark");
      });
    });
    renderDetailBookmarkButton();
  };

  const captureBookmarkPageNodes = () => {
    bookmarkPageRoot = document.querySelector("[data-bookmark-page]");
    bookmarkLockedEl = bookmarkPageRoot ? bookmarkPageRoot.querySelector("[data-bookmark-locked]") : null;
    bookmarkContentEl = bookmarkPageRoot ? bookmarkPageRoot.querySelector("[data-bookmark-content]") : null;
    bookmarkStatusEl = bookmarkPageRoot ? bookmarkPageRoot.querySelector("[data-bookmark-status]") : null;
    bookmarkEmptyEl = bookmarkPageRoot ? bookmarkPageRoot.querySelector("[data-bookmark-empty]") : null;
    bookmarkListEl = bookmarkPageRoot ? bookmarkPageRoot.querySelector("[data-bookmark-list]") : null;
    bookmarkPaginationEl = bookmarkPageRoot ? bookmarkPageRoot.querySelector("[data-bookmark-pagination]") : null;
  };

  const setBookmarkLocked = (locked) => {
    if (bookmarkLockedEl) bookmarkLockedEl.hidden = !locked;
    if (bookmarkContentEl) bookmarkContentEl.hidden = locked;
  };

  const setBookmarkStatus = (text, variant) => {
    if (!bookmarkStatusEl) return;
    const message = (text || "").toString().trim();
    if (!message) {
      bookmarkStatusEl.hidden = true;
      bookmarkStatusEl.textContent = "";
      bookmarkStatusEl.classList.remove("is-error", "is-success");
      return;
    }

    bookmarkStatusEl.hidden = false;
    bookmarkStatusEl.textContent = message;
    bookmarkStatusEl.classList.remove("is-error", "is-success");
    if (variant === "error") bookmarkStatusEl.classList.add("is-error");
    if (variant === "success") bookmarkStatusEl.classList.add("is-success");
  };

  const getSavedPageHref = (targetPage) => {
    const page = Number.isFinite(Number(targetPage)) && Number(targetPage) > 0
      ? Math.floor(Number(targetPage))
      : 1;
    if (page <= 1) return "/account/saved";
    return `/account/saved?page=${page}`;
  };

  const buildPaginationNumbers = (page, totalPages) => {
    const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
    const safeTotal = Number.isFinite(Number(totalPages)) && Number(totalPages) > 0 ? Math.floor(Number(totalPages)) : 1;
    if (safeTotal <= 7) {
      return Array.from({ length: safeTotal }, (_item, index) => index + 1);
    }
    if (safePage <= 3) {
      return [1, 2, 3, 4, "...", safeTotal];
    }
    if (safePage >= safeTotal - 2) {
      return [1, "...", safeTotal - 3, safeTotal - 2, safeTotal - 1, safeTotal];
    }
    return [1, "...", safePage - 1, safePage, safePage + 1, "...", safeTotal];
  };

  const renderBookmarkPagination = (pagination) => {
    if (!bookmarkPaginationEl) return;

    const totalPages = pagination && pagination.totalPages ? Number(pagination.totalPages) : 1;
    const page = pagination && pagination.page ? Number(pagination.page) : 1;
    if (!Number.isFinite(totalPages) || totalPages <= 1) {
      bookmarkPaginationEl.hidden = true;
      bookmarkPaginationEl.innerHTML = "";
      return;
    }

    const pageNumbers = buildPaginationNumbers(page, totalPages);
    const hasPrev = Boolean(pagination && pagination.hasPrev);
    const hasNext = Boolean(pagination && pagination.hasNext);
    const prevPage = Number.isFinite(Number(pagination && pagination.prevPage))
      ? Math.floor(Number(pagination.prevPage))
      : 1;
    const nextPage = Number.isFinite(Number(pagination && pagination.nextPage))
      ? Math.floor(Number(pagination.nextPage))
      : Math.floor(totalPages);

    bookmarkPaginationEl.hidden = false;
    bookmarkPaginationEl.innerHTML = `
      <nav class="admin-pagination" aria-label="Phân trang truyện đã lưu">
        <button
          class="button button--ghost"
          type="button"
          data-bookmark-page-link
          data-page="${hasPrev ? prevPage : 1}"
          ${hasPrev ? "" : "disabled"}
        >
          Trước
        </button>
        <div class="admin-pagination__numbers" style="display: flex;">
          ${pageNumbers
            .map((item) => {
              if (item === "...") {
                return '<span class="admin-pagination__dots">...</span>';
              }
              const target = Number(item);
              if (!Number.isFinite(target)) return "";
              if (target === Math.floor(page)) {
                return `<span class="chip">${target}</span>`;
              }
              return `
                <button
                  class="button button--ghost"
                  type="button"
                  data-bookmark-page-link
                  data-page="${target}"
                >
                  ${target}
                </button>
              `;
            })
            .join("")}
        </div>
        <button
          class="button button--ghost"
          type="button"
          data-bookmark-page-link
          data-page="${hasNext ? nextPage : Math.floor(totalPages)}"
          ${hasNext ? "" : "disabled"}
        >
          Sau
        </button>
      </nav>
    `;
  };

  const renderBookmarkList = (items) => {
    if (!bookmarkListEl || !bookmarkEmptyEl) return;
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      bookmarkListEl.innerHTML = "";
      bookmarkEmptyEl.hidden = false;
      return;
    }

    bookmarkEmptyEl.hidden = true;
    bookmarkListEl.innerHTML = rows
      .map((item) => {
        const mangaId = Number(item && item.mangaId) || 0;
        const mangaTitle = item && item.mangaTitle ? String(item.mangaTitle).trim() : "";
        const fullTitle = mangaTitle || "Truyện";
        const mangaUrl = toSafePath(item && item.mangaUrl ? item.mangaUrl : "");
        const fallbackUrl = mangaUrl || "/manga";
        const authorText =
          item && item.mangaGroupName
            ? String(item.mangaGroupName).trim()
            : item && item.mangaAuthor
              ? String(item.mangaAuthor).trim()
              : "BFANG Team";
        const coverUrl = cacheBust(
          item && item.mangaCover ? item.mangaCover : "",
          item && item.mangaCoverUpdatedAt != null ? item.mangaCoverUpdatedAt : 0
        );
        const latestLabel = item && item.latestChapterLabel ? String(item.latestChapterLabel).trim() : "";
        const chapterText = latestLabel || "Chưa có chương";

        return `
          <article class="manga-card manga-card--saved" data-bookmark-item data-bookmark-manga-id="${mangaId}">
            <a href="${escapeAttr(fallbackUrl)}">
              <div class="cover">
                ${coverUrl
                  ? `<img src="${escapeAttr(coverUrl)}" alt="Bìa ${escapeAttr(fullTitle)}" />`
                  : '<span class="cover__label">No Cover</span>'}
              </div>
              <div class="manga-body">
                <h3 title="${escapeAttr(fullTitle)}">${escapeHtml(fullTitle)}</h3>
                <p class="manga-author">${escapeHtml(authorText)}</p>
                <p class="manga-update">Mới nhất: ${escapeHtml(chapterText)}</p>
              </div>
            </a>
            <div class="manga-card__actions">
              <button
                class="button button--ghost button--compact"
                type="button"
                data-bookmark-remove
                data-manga-id="${mangaId}"
              >
                Gỡ bookmark
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const updateSavedUrlForPage = (page) => {
    if (!window.history || typeof window.history.replaceState !== "function") return;
    const href = getSavedPageHref(page);
    window.history.replaceState(window.history.state || null, document.title, href);
  };

  const loadBookmarkPage = async (requestedPage, options = {}) => {
    if (!bookmarkPageRoot) return;
    if (bookmarkLoading) return;

    const settings = options && typeof options === "object" ? options : {};
    const safeRequestedPage = Number.isFinite(Number(requestedPage)) && Number(requestedPage) > 0
      ? Math.floor(Number(requestedPage))
      : 1;

    const token = await getAccessTokenSafe();
    if (!token) {
      bookmarkCurrentPage = 1;
      bookmarkPagination = null;
      setBookmarkLocked(true);
      setBookmarkStatus("");
      if (bookmarkListEl) bookmarkListEl.innerHTML = "";
      if (bookmarkPaginationEl) {
        bookmarkPaginationEl.hidden = true;
        bookmarkPaginationEl.innerHTML = "";
      }
      if (bookmarkEmptyEl) bookmarkEmptyEl.hidden = true;
      return;
    }

    bookmarkLoading = true;
    setBookmarkLocked(false);
    if (!settings.keepStatus) {
      setBookmarkStatus("");
    }

    const result = await requestBookmarkApi({
      url: `${BOOKMARKS_ENDPOINT}?page=${safeRequestedPage}&limit=${BOOKMARKS_PER_PAGE}`,
      method: "GET",
      token
    });

    bookmarkLoading = false;
    if (!result.ok) {
      setBookmarkStatus(result.error || "Không thể tải danh sách đã lưu.", "error");
      return;
    }

    const data = result.data || {};
    const pagination = data && data.pagination && typeof data.pagination === "object" ? data.pagination : null;
    const items = Array.isArray(data && data.items) ? data.items : [];

    bookmarkPagination = pagination;
    bookmarkCurrentPage = pagination && Number(pagination.page) > 0 ? Math.floor(Number(pagination.page)) : 1;
    renderBookmarkList(items);
    renderBookmarkPagination(bookmarkPagination);
    if (settings.updateUrl !== false) {
      updateSavedUrlForPage(bookmarkCurrentPage);
    }
  };

  const removeBookmarkFromPage = async (mangaId) => {
    const safeMangaId = Number(mangaId);
    if (!Number.isFinite(safeMangaId) || safeMangaId <= 0) return;

    const token = await getAccessTokenSafe();
    if (!token) {
      openLoginDialog();
      return;
    }

    const result = await requestBookmarkApi({
      url: REMOVE_BOOKMARK_ENDPOINT,
      method: "POST",
      body: { mangaId: Math.floor(safeMangaId) },
      token
    });
    if (!result.ok) {
      setBookmarkStatus(result.error || "Không thể gỡ bookmark.", "error");
      return;
    }

    setBookmarkStatus("Đã gỡ bookmark.", "success");
    dispatchBookmarkUpdated({ mangaId: Math.floor(safeMangaId), mangaSlug: "", bookmarked: false });
    await loadBookmarkPage(bookmarkCurrentPage, { updateUrl: true, keepStatus: true });
  };

  const readSavedPageFromUrl = () => {
    try {
      const currentUrl = new URL(window.location.href);
      const pageRaw = Number(currentUrl.searchParams.get("page"));
      if (!Number.isFinite(pageRaw) || pageRaw <= 0) return 1;
      return Math.floor(pageRaw);
    } catch (_err) {
      return 1;
    }
  };

  const bindBookmarkPageInteractions = () => {
    if (!bookmarkPageRoot) return;
    if (bookmarkPageRoot.getAttribute(PAGE_BOUND_ATTR) === "1") return;

    bookmarkPageRoot.setAttribute(PAGE_BOUND_ATTR, "1");
    bookmarkPageRoot.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-bookmark-remove]");
      if (removeButton) {
        event.preventDefault();
        const mangaId = Number(removeButton.getAttribute("data-manga-id") || "0");
        removeBookmarkFromPage(mangaId).catch(() => {
          setBookmarkStatus("Không thể gỡ bookmark.", "error");
        });
        return;
      }

      const pageButton = event.target.closest("[data-bookmark-page-link]");
      if (pageButton) {
        event.preventDefault();
        const targetPage = Number(pageButton.getAttribute("data-page") || "1");
        if (!Number.isFinite(targetPage) || targetPage <= 0) return;
        loadBookmarkPage(Math.floor(targetPage), { updateUrl: true }).catch(() => {
          setBookmarkStatus("Không thể tải trang đã lưu.", "error");
        });
      }
    });
  };

  const refreshAllFromCurrentSession = async () => {
    captureDetailNodes();
    bindDetailBookmarkButton();
    captureBookmarkPageNodes();
    bindBookmarkPageInteractions();
    if (bookmarkPageRoot) {
      await loadBookmarkPage(readSavedPageFromUrl(), { updateUrl: true });
    }
  };

  window.addEventListener("bfang:auth", (event) => {
    const detail = event && event.detail ? event.detail : null;
    const session = detail && detail.session ? detail.session : null;
    const signedIn = Boolean(session && (session.user || session.access_token));

    if (!signedIn) {
      if (detailBookmarkButton) {
        detailBookmarked = false;
        detailBookmarkPending = false;
        renderDetailBookmarkButton();
      }
      if (bookmarkPageRoot) {
        setBookmarkLocked(true);
        if (bookmarkListEl) bookmarkListEl.innerHTML = "";
        if (bookmarkPaginationEl) {
          bookmarkPaginationEl.hidden = true;
          bookmarkPaginationEl.innerHTML = "";
        }
        if (bookmarkEmptyEl) bookmarkEmptyEl.hidden = true;
        setBookmarkStatus("");
      }
      return;
    }

    refreshAllFromCurrentSession().catch(() => null);
  });

  window.addEventListener("bfang:pagechange", () => {
    refreshAllFromCurrentSession().catch(() => null);
  });

  window.addEventListener("pageshow", () => {
    refreshAllFromCurrentSession().catch(() => null);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    refreshAllFromCurrentSession().catch(() => null);
  });

  refreshAllFromCurrentSession().catch(() => null);
})();
