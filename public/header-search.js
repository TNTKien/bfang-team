(() => {
  const ROOT_SELECTOR = "[data-header-search]";
  const BOUND_ATTR = "data-header-search-bound";
  const ENDPOINT = "/manga/search";
  const DEBOUNCE_MS = 180;
  const MAX_RESULTS = 5;
  const MOBILE_PANEL_BREAKPOINT = 960;

  const escapeHtml = (value) =>
    (value == null ? "" : String(value))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const normalizeQuery = (value) =>
    (value == null ? "" : String(value))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

  const buildCoverUrl = (cover, coverUpdatedAt) => {
    const url = (cover || "").toString().trim();
    if (!url) return "";
    const token = Number(coverUpdatedAt);
    if (!Number.isFinite(token) || token <= 0) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}t=${encodeURIComponent(String(token))}`;
  };

  const buildSearchUrl = (query) => {
    const normalized = normalizeQuery(query);
    if (!normalized) return "/manga";
    return `/manga?q=${encodeURIComponent(normalized)}`;
  };

  const initHeaderSearch = (scope) => {
    const rootNode = scope && scope.querySelectorAll ? scope : document;
    rootNode.querySelectorAll(ROOT_SELECTOR).forEach((root) => {
      if (!(root instanceof HTMLElement)) return;
      if (root.getAttribute(BOUND_ATTR) === "1") return;

      const toggle = root.querySelector("[data-header-search-toggle]");
      const panel = root.querySelector("[data-header-search-panel]");
      const input = root.querySelector("[data-header-search-input]");
      const resultsWrap = root.querySelector("[data-header-search-results-wrap]");
      const resultsList = root.querySelector("[data-header-search-results]");
      const moreLink = root.querySelector("[data-header-search-more]");
      const rootActions = root.closest(".header-actions");
      const navToggle = rootActions instanceof HTMLElement
        ? rootActions.querySelector("[data-header-nav-toggle]")
        : document.querySelector("[data-header-nav-toggle]");
      const navTargetId = navToggle instanceof HTMLElement
        ? (navToggle.getAttribute("aria-controls") || "").toString().trim()
        : "";
      const navMenu = navTargetId ? document.getElementById(navTargetId) : null;
      if (!(toggle instanceof HTMLElement)) return;
      if (!(panel instanceof HTMLElement)) return;
      if (!(input instanceof HTMLInputElement)) return;
      if (!(resultsWrap instanceof HTMLElement)) return;
      if (!(resultsList instanceof HTMLElement)) return;
      if (!(moreLink instanceof HTMLAnchorElement)) return;

      const state = {
        timer: 0,
        requestId: 0,
        controller: null
      };
      let syncFrame = 0;

      const clearResults = () => {
        resultsList.innerHTML = "";
        resultsWrap.hidden = true;
        moreLink.hidden = true;
        moreLink.href = "/manga";
      };

      const abortPending = () => {
        if (state.controller) {
          state.controller.abort();
          state.controller = null;
        }
      };

      const syncMobilePanelAnchor = () => {
        const viewportWidth = Number(window.innerWidth || document.documentElement.clientWidth || 0);
        if (!Number.isFinite(viewportWidth) || viewportWidth > MOBILE_PANEL_BREAKPOINT) {
          panel.style.removeProperty("--header-search-mobile-top");
          return;
        }

        const rootRect = root.getBoundingClientRect();
        const top = Math.max(8, Math.round(rootRect.bottom + 8));
        panel.style.setProperty("--header-search-mobile-top", `${top}px`);
      };

      const queueSyncMobilePanelAnchor = () => {
        if (panel.hidden) return;
        if (syncFrame) return;
        syncFrame = window.requestAnimationFrame(() => {
          syncFrame = 0;
          syncMobilePanelAnchor();
        });
      };

      const closePanel = ({ clearInput = false } = {}) => {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        clearTimeout(state.timer);
        if (syncFrame) {
          window.cancelAnimationFrame(syncFrame);
          syncFrame = 0;
        }
        abortPending();
        clearResults();
        if (clearInput) {
          input.value = "";
        }
      };

      const closeMobileHeaderNav = () => {
        const viewportWidth = Number(window.innerWidth || document.documentElement.clientWidth || 0);
        if (Number.isFinite(viewportWidth) && viewportWidth > MOBILE_PANEL_BREAKPOINT) {
          return;
        }

        if (navToggle instanceof HTMLElement) {
          navToggle.setAttribute("aria-expanded", "false");
        }

        if (!(navMenu instanceof HTMLElement)) {
          return;
        }

        navMenu.classList.remove("is-open");
        if (!navMenu.classList.contains("hidden")) {
          navMenu.classList.add("hidden");
        }
      };

      const openPanel = () => {
        syncMobilePanelAnchor();
        panel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        input.focus();
      };

      const renderEmpty = (text, query) => {
        resultsWrap.hidden = false;
        resultsList.innerHTML = `<li class="header-search-empty">${escapeHtml(text)}</li>`;
        moreLink.hidden = false;
        moreLink.href = buildSearchUrl(query);
        moreLink.textContent = "Mở trang tìm kiếm";
      };

      const renderLoading = (query) => {
        resultsWrap.hidden = false;
        resultsList.innerHTML = '<li class="header-search-loading">Đang tìm kiếm...</li>';
        moreLink.hidden = false;
        moreLink.href = buildSearchUrl(query);
        moreLink.textContent = "Xem tất cả kết quả";
      };

      const renderResults = (items, query) => {
        const normalizedQuery = normalizeQuery(query);
        const safeItems = Array.isArray(items) ? items.slice(0, MAX_RESULTS) : [];
        if (!normalizedQuery) {
          clearResults();
          return;
        }

        resultsWrap.hidden = false;

        if (!safeItems.length) {
          resultsList.innerHTML = '<li class="header-search-empty">Không tìm thấy truyện phù hợp.</li>';
          moreLink.hidden = false;
          moreLink.href = buildSearchUrl(normalizedQuery);
          moreLink.textContent = `Xem tất cả cho "${normalizedQuery}"`;
          return;
        }

        resultsList.innerHTML = safeItems
          .map((item, index) => {
            const slug = (item && item.slug ? String(item.slug) : "").trim();
            const title = (item && item.title ? String(item.title) : "").trim();
            const status = (item && item.status ? String(item.status) : "").replace(/\s+/g, " ").trim();
            if (!slug || !title) return "";

            const href = `/manga/${encodeURIComponent(slug)}`;
            const coverUrl = buildCoverUrl(item.cover, item.coverUpdatedAt);
            const statusLabel = status || "Đang cập nhật";
            const isAdult = Boolean(item && item.isAdult);
            const coverStateClass = isAdult ? " header-search-item__cover--adult" : "";
            const coverDataAttr = isAdult ? ' data-sensitive="adult"' : "";
            const coverHtml = coverUrl
              ? `<img src="${escapeHtml(coverUrl)}" alt="" loading="lazy" decoding="async" />`
              : '<span class="header-search-item__cover--empty">?</span>';

            return `
              <li>
                <a class="header-search-item" href="${href}" role="option" id="header-search-option-${index}">
                  <span class="header-search-item__cover${coverStateClass}"${coverDataAttr}>${coverHtml}</span>
                  <span class="header-search-item__meta">
                    <span class="header-search-item__title">${escapeHtml(title)}</span>
                    <span class="header-search-item__status">${escapeHtml(statusLabel)}</span>
                  </span>
                </a>
              </li>
            `;
          })
          .join("");

        moreLink.hidden = false;
        moreLink.href = buildSearchUrl(normalizedQuery);
        moreLink.textContent = `Xem tất cả cho "${normalizedQuery}"`;
      };

      const fetchResults = async (rawValue) => {
        const query = normalizeQuery(rawValue);
        if (!query) {
          clearResults();
          return;
        }

        state.requestId += 1;
        const currentRequestId = state.requestId;
        abortPending();
        const controller = new AbortController();
        state.controller = controller;
        renderLoading(query);

        try {
          const response = await fetch(
            `${ENDPOINT}?q=${encodeURIComponent(query)}&limit=${MAX_RESULTS}`,
            {
              cache: "no-store",
              headers: {
                Accept: "application/json"
              },
              signal: controller.signal
            }
          );

          if (!response.ok) {
            throw new Error("REQUEST_FAILED");
          }

          const payload = await response.json();
          if (currentRequestId !== state.requestId) {
            return;
          }
          renderResults(payload && payload.items ? payload.items : [], query);
        } catch (error) {
          if (error && error.name === "AbortError") {
            return;
          }
          if (currentRequestId !== state.requestId) {
            return;
          }
          renderEmpty("Không thể tải kết quả. Vui lòng thử lại.", query);
        } finally {
          if (state.controller === controller) {
            state.controller = null;
          }
        }
      };

      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMobileHeaderNav();

        const isOpen = !panel.hidden;
        if (isOpen) {
          closePanel({ clearInput: false });
          return;
        }

        openPanel();
        const currentQuery = normalizeQuery(input.value);
        if (currentQuery) {
          clearTimeout(state.timer);
          state.timer = window.setTimeout(() => {
            fetchResults(currentQuery).catch(() => null);
          }, DEBOUNCE_MS);
        }
      });

      panel.addEventListener("click", (event) => {
        event.stopPropagation();
      });

      input.addEventListener("input", () => {
        clearTimeout(state.timer);
        const query = normalizeQuery(input.value);
        if (!query) {
          abortPending();
          clearResults();
          return;
        }

        state.timer = window.setTimeout(() => {
          fetchResults(query).catch(() => null);
        }, DEBOUNCE_MS);
      });

      input.addEventListener("keydown", (event) => {
        if (!event) return;

        if (event.key === "Escape") {
          event.preventDefault();
          closePanel({ clearInput: false });
          toggle.focus();
          return;
        }

        if (event.key === "Enter") {
          const query = normalizeQuery(input.value);
          if (!query) return;
          event.preventDefault();
          closePanel({ clearInput: false });
          window.location.assign(buildSearchUrl(query));
        }
      });

      resultsList.addEventListener("click", (event) => {
        if (!event || !(event.target instanceof Element)) return;
        const itemLink = event.target.closest("a.header-search-item");
        if (!(itemLink instanceof HTMLAnchorElement)) return;
        closePanel({ clearInput: false });
      });

      moreLink.addEventListener("click", () => {
        closePanel({ clearInput: false });
      });

      if (navToggle instanceof HTMLElement) {
        navToggle.addEventListener(
          "click",
          () => {
            closePanel({ clearInput: false });
          },
          { capture: true }
        );
      }

      window.addEventListener("resize", () => {
        queueSyncMobilePanelAnchor();
      });

      window.addEventListener(
        "scroll",
        () => {
          queueSyncMobilePanelAnchor();
        },
        { passive: true }
      );

      document.addEventListener("click", (event) => {
        if (root.contains(event.target)) return;
        closePanel({ clearInput: false });
      });

      document.addEventListener("keydown", (event) => {
        if (!event || event.key !== "Escape") return;
        closePanel({ clearInput: false });
      });

      root.setAttribute(BOUND_ATTR, "1");
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        initHeaderSearch(document);
      },
      { once: true }
    );
  } else {
    initHeaderSearch(document);
  }

  window.addEventListener("bfang:pagechange", () => {
    initHeaderSearch(document);
  });
})();
