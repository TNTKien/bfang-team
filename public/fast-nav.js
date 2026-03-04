(() => {
  if (typeof window === "undefined") return;
  if (typeof window.fetch !== "function") return;
  if (typeof window.DOMParser !== "function") return;
  if (!window.history || typeof window.history.pushState !== "function") return;

  const FAST_NAV_PATH_PATTERN =
    /^\/(?:$|manga\/?$|manga\/[^/?#]+\/?$|privacy-policy\/?$|terms-of-service\/?$|user\/[^/?#]+\/?$|account\/history\/?$)/i;
  const PREFETCH_TTL_MS = 3 * 60 * 1000;
  const PREFETCH_CACHE_LIMIT = 28;
  const FONT_AWESOME_STYLESHEET_URL =
    "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/css/all.min.css";

  const htmlCache = new Map();
  const inFlightFetches = new Map();
  const scriptLoadPromises = new Map();
  const styleLoadPromises = new Map();
  let renderedPageKey = "";

  let navigationToken = 0;
  let prefetchObserver = null;
  let disposeCommentsScriptLoader = null;

  const supportsViewTransition = false;

  const forceInstantReveal = (root) => {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll(".reveal").forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      element.style.opacity = "1";
      element.style.transform = "none";
      element.style.animation = "none";
    });
  };

  const toUrl = (value) => {
    try {
      return new URL(value, window.location.href);
    } catch (_err) {
      return null;
    }
  };

  const isSameAssetUrl = (left, right) => {
    const leftUrl = toUrl(left);
    const rightUrl = toUrl(right);
    if (!leftUrl || !rightUrl) return false;
    if (leftUrl.origin !== rightUrl.origin) return false;
    return leftUrl.pathname === rightUrl.pathname;
  };

  const isFastNavigablePath = (pathname) => {
    const safePathname = (pathname || "/").toString();
    return FAST_NAV_PATH_PATTERN.test(safePathname);
  };

  const isFreshNavigationPath = (pathname) => {
    const safePathname = (pathname || "/").toString();
    return /^\/(?:manga\/[^/?#]+\/?$|user\/[^/?#]+\/?$)/i.test(safePathname);
  };

  const isFastNavigableUrl = (url) => {
    if (!url) return false;
    return url.origin === window.location.origin && isFastNavigablePath(url.pathname);
  };

  const toCacheKey = (url) => {
    const parsed = toUrl(url);
    if (!parsed) return "";
    parsed.hash = "";
    return parsed.toString();
  };

  renderedPageKey = toCacheKey(window.location.href);

  const trimCache = () => {
    if (htmlCache.size <= PREFETCH_CACHE_LIMIT) return;
    const overflow = htmlCache.size - PREFETCH_CACHE_LIMIT;
    const keys = Array.from(htmlCache.keys()).slice(0, overflow);
    keys.forEach((key) => {
      htmlCache.delete(key);
    });
  };

  const readCachedPayload = (url) => {
    const key = toCacheKey(url);
    if (!key) return null;
    const entry = htmlCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > PREFETCH_TTL_MS) {
      htmlCache.delete(key);
      return null;
    }
    htmlCache.delete(key);
    htmlCache.set(key, entry);
    return entry;
  };

  const writeCachedPayload = (url, payload) => {
    const key = toCacheKey(url);
    if (!key || !payload) return;
    htmlCache.set(key, {
      html: payload.html,
      finalUrl: payload.finalUrl,
      cachedAt: Date.now()
    });
    trimCache();
  };

  const fetchPagePayload = async (targetUrl, options) => {
    const settings = options && typeof options === "object" ? options : {};
    const noStore = Boolean(settings.noStore);
    const reuseInFlight = settings.reuseInFlight !== false;
    const cacheKey = toCacheKey(targetUrl);
    if (!cacheKey) return null;
    const requestKey = `${cacheKey}|${noStore ? "no-store" : "default"}`;

    if (reuseInFlight && inFlightFetches.has(requestKey)) {
      return inFlightFetches.get(requestKey);
    }

    const pending = fetch(cacheKey, {
      method: "GET",
      credentials: "same-origin",
      cache: noStore ? "no-store" : "default",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "X-BFANG-Fast-Nav": "1",
        "X-BFANG-Fast-Nav-Fresh": noStore ? "1" : "0"
      }
    })
      .then(async (response) => {
        if (!response || !response.ok) {
          return null;
        }

        const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
        if (!contentType.includes("text/html")) {
          return null;
        }

        const finalUrl = toUrl(response.url || cacheKey);
        if (!isFastNavigableUrl(finalUrl)) {
          return null;
        }

        const html = await response.text();
        if (!html || !html.trim()) {
          return null;
        }

        return {
          html,
          finalUrl: finalUrl.toString()
        };
      })
      .catch(() => null)
      .finally(() => {
        inFlightFetches.delete(requestKey);
      });

    inFlightFetches.set(requestKey, pending);
    return pending;
  };

  const prefetchUrl = async (value) => {
    const targetUrl = toUrl(value);
    if (!isFastNavigableUrl(targetUrl)) return;
    if (toCacheKey(targetUrl) === toCacheKey(window.location.href)) return;
    if (readCachedPayload(targetUrl)) return;

    const payload = await fetchPagePayload(targetUrl, { noStore: false, reuseInFlight: true });
    if (payload) {
      writeCachedPayload(targetUrl, payload);
    }
  };

  const shouldHandleAnchorClick = (anchor, event) => {
    if (!(anchor instanceof HTMLAnchorElement)) return false;
    if (!event || event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (anchor.hasAttribute("download")) return false;
    if (anchor.getAttribute("target") && anchor.getAttribute("target") !== "_self") return false;
    if (anchor.getAttribute("rel") && /external/i.test(anchor.getAttribute("rel"))) return false;
    if (anchor.getAttribute("data-no-fast-nav") === "1") return false;
    if (anchor.closest("#comments")) return false;

    const targetUrl = toUrl(anchor.href);
    if (!isFastNavigableUrl(targetUrl)) return false;

    const currentUrl = toUrl(window.location.href);
    if (!currentUrl) return false;
    if (toCacheKey(targetUrl) === toCacheKey(currentUrl) && targetUrl.hash) {
      return false;
    }
    if (toCacheKey(targetUrl) === toCacheKey(currentUrl) && !targetUrl.hash) {
      return false;
    }

    return true;
  };

  const ensureScriptLoaded = async (src) => {
    const scriptUrl = toUrl(src);
    if (!scriptUrl) return false;
    const absoluteSrc = scriptUrl.toString();
    if (scriptLoadPromises.has(absoluteSrc)) {
      return scriptLoadPromises.get(absoluteSrc);
    }

    const existingScript = Array.from(document.querySelectorAll("script[src]")).find((script) =>
      isSameAssetUrl(script.getAttribute("src") || "", absoluteSrc)
    );

    if (existingScript) {
      const done = Promise.resolve(true);
      scriptLoadPromises.set(absoluteSrc, done);
      return done;
    }

    const pending = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = absoluteSrc;
      script.defer = true;
      script.addEventListener(
        "load",
        () => {
          resolve(true);
        },
        { once: true }
      );
      script.addEventListener(
        "error",
        () => {
          resolve(false);
        },
        { once: true }
      );
      document.head.appendChild(script);
    });

    scriptLoadPromises.set(absoluteSrc, pending);
    return pending;
  };

  const ensureStylesheetLoaded = async (href) => {
    const stylesheetUrl = toUrl(href);
    if (!stylesheetUrl) return false;
    const absoluteHref = stylesheetUrl.toString();
    if (styleLoadPromises.has(absoluteHref)) {
      return styleLoadPromises.get(absoluteHref);
    }

    const existingLink = Array.from(document.querySelectorAll("link[rel='stylesheet'][href]")).find((link) =>
      isSameAssetUrl(link.getAttribute("href") || "", absoluteHref)
    );

    if (existingLink) {
      const done = Promise.resolve(true);
      styleLoadPromises.set(absoluteHref, done);
      return done;
    }

    const pending = new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = absoluteHref;
      link.addEventListener(
        "load",
        () => {
          resolve(true);
        },
        { once: true }
      );
      link.addEventListener(
        "error",
        () => {
          resolve(false);
        },
        { once: true }
      );
      document.head.appendChild(link);
    });

    styleLoadPromises.set(absoluteHref, pending);
    return pending;
  };

  const getPageScriptList = (pathname) => {
    if (/^\/manga\/?$/i.test(pathname || "")) {
      return ["/filters.js"];
    }
    if (/^\/manga\/[^/?#]+\/?$/i.test(pathname || "")) {
      return ["/manga-detail.js", "/reading-history.js"];
    }
    if (/^\/account\/history\/?$/i.test(pathname || "")) {
      return ["/reading-history.js"];
    }
    return [];
  };

  const ensurePageScripts = async (pathname) => {
    const scripts = getPageScriptList(pathname);
    for (const src of scripts) {
      await ensureScriptLoaded(src);
    }
  };

  const ensurePageStyles = async (pathname) => {
    if (/^\/manga\/[^/?#]+\/?$/i.test(pathname || "")) {
      await ensureStylesheetLoaded(FONT_AWESOME_STYLESHEET_URL);
      return;
    }
    if (/^\/user\/[^/?#]+\/?$/i.test(pathname || "")) {
      await ensureStylesheetLoaded(FONT_AWESOME_STYLESHEET_URL);
    }
  };

  const syncSpeculationRules = (nextDocument) => {
    const mounted = Array.from(document.querySelectorAll("script[data-fast-nav-speculation='1']"));
    mounted.forEach((script) => script.remove());

    if (!nextDocument) return;

    const nextScripts = Array.from(nextDocument.querySelectorAll("script[type='speculationrules']"));
    if (!nextScripts.length) return;

    const nonceHolder = document.querySelector("script[nonce]");
    const nonceValue = nonceHolder ? nonceHolder.getAttribute("nonce") || "" : "";
    const insertionPoint = document.querySelector(".site");

    nextScripts.forEach((sourceScript) => {
      const script = document.createElement("script");
      script.type = "speculationrules";
      script.textContent = sourceScript.textContent || "";
      script.setAttribute("data-fast-nav-speculation", "1");
      if (nonceValue) {
        script.setAttribute("nonce", nonceValue);
      }
      if (insertionPoint && insertionPoint.parentNode) {
        insertionPoint.parentNode.insertBefore(script, insertionPoint);
      } else {
        document.body.appendChild(script);
      }
    });
  };

  const scrollToHash = (hash) => {
    const safeHash = (hash || "").toString();
    if (!safeHash || !safeHash.startsWith("#")) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }

    const targetId = decodeURIComponent(safeHash.slice(1));
    if (!targetId) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }

    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ block: "start", behavior: "auto" });
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  const setupCommentsScriptLoader = () => {
    if (typeof disposeCommentsScriptLoader === "function") {
      disposeCommentsScriptLoader();
      disposeCommentsScriptLoader = null;
    }

    const commentsRoot = document.querySelector("#comments");
    if (!commentsRoot) return;

    const scriptSrc =
      (commentsRoot.getAttribute("data-comment-script-src") || "").toString().trim() || "/comments.js";
    const isLazyCommentsSection = commentsRoot.getAttribute("data-comment-lazy") === "1";

    let loaded = false;
    let observer = null;

    const cleanup = () => {
      document.removeEventListener("focusin", onIntent, true);
      document.removeEventListener("pointerdown", onIntent, true);
      document.removeEventListener("keydown", onIntent, true);
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };

    const loadCommentsScript = () => {
      if (loaded) return;
      loaded = true;
      cleanup();
      commentsRoot.setAttribute("data-comment-auto-hydrate", "1");
      ensureScriptLoaded(scriptSrc).then(() => {
        if (window.BfangComments && typeof window.BfangComments.refresh === "function") {
          window.BfangComments.refresh();
        }
        if (window.BfangAuth && typeof window.BfangAuth.refreshUi === "function") {
          window.BfangAuth.refreshUi().catch(() => null);
        }
      });
    };

    const onIntent = (event) => {
      const target = event && event.target;
      if (!target || !target.closest) return;
      if (target.closest("#comments")) {
        loadCommentsScript();
      }
    };

    document.addEventListener("focusin", onIntent, true);
    document.addEventListener("pointerdown", onIntent, true);
    document.addEventListener("keydown", onIntent, true);

    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            loadCommentsScript();
          });
        },
        {
          root: null,
          rootMargin: isLazyCommentsSection ? "320px 0px" : "1100px 0px",
          threshold: 0.01
        }
      );
      observer.observe(commentsRoot);
    } else {
      window.setTimeout(() => {
        loadCommentsScript();
      }, 1200);
    }

    disposeCommentsScriptLoader = cleanup;
  };

  const runPostNavigationHooks = async (targetUrl) => {
    await ensurePageStyles(targetUrl.pathname);
    await ensurePageScripts(targetUrl.pathname);

    if (window.BfangFilters && typeof window.BfangFilters.init === "function") {
      window.BfangFilters.init(document);
    }

    if (window.BfangMangaDetail && typeof window.BfangMangaDetail.init === "function") {
      window.BfangMangaDetail.init(document);
    }

    if (window.BfangAuth && typeof window.BfangAuth.refreshUi === "function") {
      window.BfangAuth.refreshUi().catch(() => null);
    }

    setupCommentsScriptLoader();
    observePrefetchableAnchors();

    window.dispatchEvent(
      new CustomEvent("bfang:pagechange", {
        detail: {
          url: targetUrl.toString(),
          pathname: targetUrl.pathname,
          search: targetUrl.search,
          hash: targetUrl.hash
        }
      })
    );
  };

  const applyNavigationPayload = async (targetUrl, payload, options) => {
    const parsed = new DOMParser().parseFromString(payload.html, "text/html");
    const nextMain = parsed.querySelector("main");
    const currentMain = document.querySelector("main");
    if (!nextMain || !currentMain) {
      return false;
    }

    const nextTitle = (parsed.title || "").toString().trim();
    const updateDom = () => {
      const importedMain = document.importNode(nextMain, true);
      forceInstantReveal(importedMain);
      currentMain.replaceWith(importedMain);
      if (nextTitle) {
        document.title = nextTitle;
      }
      syncSpeculationRules(parsed);
    };

    if (supportsViewTransition) {
      await document.startViewTransition(updateDom).finished.catch(() => null);
    } else {
      updateDom();
    }

    if (options && options.pushHistory) {
      window.history.pushState({ bfangFastNav: true }, "", targetUrl.toString());
    }

    if (options && options.replaceHistory) {
      window.history.replaceState({ bfangFastNav: true }, "", targetUrl.toString());
    }

    if (options && options.scrollToHash !== false) {
      scrollToHash(targetUrl.hash);
    }

    await runPostNavigationHooks(targetUrl);
    return true;
  };

  const navigateSoft = async (value, options) => {
    const settings = options && typeof options === "object" ? options : {};
    const targetUrl = toUrl(value);
    if (!isFastNavigableUrl(targetUrl)) return false;

    const targetKey = toCacheKey(targetUrl);
    if (!targetKey) return false;

    if (renderedPageKey === targetKey) {
      if (settings.pushHistory) {
        window.history.pushState({ bfangFastNav: true }, "", targetUrl.toString());
      }
      scrollToHash(targetUrl.hash);
      return true;
    }

    const localToken = ++navigationToken;
    document.documentElement.setAttribute("data-fast-nav-loading", "1");

    try {
      const needsFreshPayload = isFreshNavigationPath(targetUrl.pathname);
      let payload = null;

      if (!needsFreshPayload) {
        payload = readCachedPayload(targetUrl);
      }

      if (!payload) {
        payload = await fetchPagePayload(targetUrl, {
          noStore: needsFreshPayload,
          reuseInFlight: !needsFreshPayload
        });
      }

      if (!payload && needsFreshPayload) {
        payload = readCachedPayload(targetUrl);
      }

      if (!payload) return false;

      writeCachedPayload(targetUrl, payload);

      if (localToken !== navigationToken) return false;
      const finalUrl = toUrl(payload.finalUrl || targetUrl.toString());
      if (!isFastNavigableUrl(finalUrl)) return false;

      const effectiveUrl = new URL(finalUrl.toString());
      effectiveUrl.hash = targetUrl.hash || "";
      const applied = await applyNavigationPayload(effectiveUrl, payload, settings);
      if (applied) {
        renderedPageKey = toCacheKey(effectiveUrl) || renderedPageKey;
      }
      return applied;
    } catch (_err) {
      return false;
    } finally {
      if (localToken === navigationToken) {
        document.documentElement.removeAttribute("data-fast-nav-loading");
      }
    }
  };

  const observePrefetchableAnchors = () => {
    if (!("IntersectionObserver" in window)) return;

    if (prefetchObserver) {
      prefetchObserver.disconnect();
    }

    prefetchObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const anchor = entry.target;
          observer.unobserve(anchor);
          if (!(anchor instanceof HTMLAnchorElement)) return;
          prefetchUrl(anchor.href).catch(() => null);
        });
      },
      {
        root: null,
        rootMargin: "300px 0px",
        threshold: 0.01
      }
    );

    const anchors = Array.from(document.querySelectorAll("a[href]"));
    anchors.forEach((anchor) => {
      const href = (anchor.getAttribute("href") || "").toString().trim();
      if (!href || href.startsWith("javascript:")) return;
      const targetUrl = toUrl(anchor.href);
      if (!isFastNavigableUrl(targetUrl)) return;
      if (toCacheKey(targetUrl) === toCacheKey(window.location.href)) return;
      prefetchObserver.observe(anchor);
    });
  };

  document.addEventListener(
    "click",
    (event) => {
      const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!shouldHandleAnchorClick(anchor, event)) return;

      const href = anchor.getAttribute("href") || anchor.href;
      event.preventDefault();
      navigateSoft(href, { pushHistory: true, replaceHistory: false, scrollToHash: true }).then((ok) => {
        if (!ok) {
          window.location.assign(anchor.href);
        }
      });
    },
    true
  );

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const method = (form.method || "get").toString().trim().toLowerCase();
      if (method !== "get") return;
      if (form.getAttribute("target") && form.getAttribute("target") !== "_self") return;

      const actionUrl = toUrl(form.getAttribute("action") || window.location.href);
      if (!isFastNavigableUrl(actionUrl)) return;

      event.preventDefault();

      let formData = null;
      try {
        formData = new FormData(form, event.submitter || undefined);
      } catch (_err) {
        formData = new FormData(form);
      }

      const searchParams = new URLSearchParams();
      Array.from(formData.entries()).forEach(([key, value]) => {
        if (typeof value !== "string") return;
        searchParams.append(key, value);
      });

      const nextUrl = new URL(actionUrl.toString());
      nextUrl.search = searchParams.toString();

      navigateSoft(nextUrl.toString(), { pushHistory: true, replaceHistory: false, scrollToHash: true }).then(
        (ok) => {
          if (!ok) {
            window.location.assign(nextUrl.toString());
          }
        }
      );
    },
    true
  );

  window.addEventListener("popstate", () => {
    const currentUrl = toUrl(window.location.href);
    if (!isFastNavigableUrl(currentUrl)) return;
    navigateSoft(currentUrl.toString(), {
      pushHistory: false,
      replaceHistory: false,
      scrollToHash: true
    }).then((ok) => {
      if (!ok) {
        window.location.reload();
      }
    });
  });

  const prefetchFromIntent = (event) => {
    const target = event && event.target;
    if (!target || !target.closest) return;
    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const targetUrl = toUrl(anchor.href);
    if (!isFastNavigableUrl(targetUrl)) return;
    prefetchUrl(targetUrl.toString()).catch(() => null);
  };

  document.addEventListener("pointerover", prefetchFromIntent, { passive: true, capture: true });
  document.addEventListener("focusin", prefetchFromIntent, { passive: true, capture: true });
  document.addEventListener("touchstart", prefetchFromIntent, { passive: true, capture: true });

  document.querySelectorAll("script[type='speculationrules']").forEach((script) => {
    script.setAttribute("data-fast-nav-speculation", "1");
  });

  window.history.replaceState({ bfangFastNav: true }, "", window.location.href);
  observePrefetchableAnchors();
  setupCommentsScriptLoader();
})();
