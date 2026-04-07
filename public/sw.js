const SW_VERSION = "v5";
const CACHE_PREFIX = "bfang";
const STATIC_CACHE_NAME = `${CACHE_PREFIX}-static-${SW_VERSION}`;
const PAGE_CACHE_NAME = `${CACHE_PREFIX}-page-${SW_VERSION}`;

const STATIC_CACHE_MAX_ENTRIES = 240;
const SCRIPT_CACHE_MAX_ENTRIES = 120;
const PAGE_CACHE_MAX_ENTRIES = 24;
const PREFETCH_PAGE_TTL_MS = 10 * 60 * 1000;

const CACHEABLE_DESTINATIONS = new Set(["script", "style", "font", "image"]);
const STATIC_ASSET_PATH_PATTERN = /\.(?:avif|css|eot|gif|ico|jpe?g|js|json|mjs|png|svg|ttf|webp|woff2?)$/i;
const SCRIPT_PATH_PATTERN = /\.(?:js|mjs)$/i;
const FAST_HTML_PATH_PATTERN =
  /^\/(?:$|manga\/?$|manga\/[^/?#]+\/?$|privacy-policy\/?$|terms-of-service\/?$|user\/[^/?#]+\/?$|account\/history\/?$|account\/saved\/?$)/i;

const DYNAMIC_PATH_PREFIXES = [
  "/admin",
  "/account",
  "/auth",
  "/comments",
  "/messages",
  "/notifications",
  "/forum/api"
];

const shouldBypassPath = (pathname) =>
  DYNAMIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const isServiceWorkerScript = (pathname) => pathname === "/sw.js" || pathname === "/sw-register.js";
const isFastHtmlPath = (pathname) => FAST_HTML_PATH_PATTERN.test(pathname || "");

const prefetchInFlight = new Set();

const buildPageCacheRequest = (targetUrl) => {
  let normalizedUrl = null;
  try {
    normalizedUrl = targetUrl instanceof URL
      ? new URL(targetUrl.toString())
      : new URL(String(targetUrl || "").trim(), self.location.origin);
  } catch (_error) {
    normalizedUrl = null;
  }

  const href = normalizedUrl
    ? (() => {
      normalizedUrl.hash = "";
      normalizedUrl.searchParams.delete("__bfv");
      return normalizedUrl.toString();
    })()
    : String(targetUrl || "").trim();

  return new Request(href, {
    method: "GET",
    credentials: "same-origin"
  });
};

const isHtmlRequest = (request) => {
  if (!request) return false;
  if (request.mode === "navigate") return true;
  const acceptHeader = (request.headers.get("Accept") || "").toLowerCase();
  return acceptHeader.includes("text/html");
};

const isFastNavHtmlRequest = (request) => {
  if (!request || !isHtmlRequest(request)) return false;
  return (request.headers.get("X-BFANG-Fast-Nav") || "") === "1";
};

const shouldForceFreshPageResponse = (request, url) => {
  if (!request) return false;
  if ((request.headers.get("X-BFANG-Fast-Nav-Fresh") || "") === "1") return true;
  if (url && url.searchParams && url.searchParams.has("__bfv")) return true;
  return request.cache === "reload" || request.cache === "no-store";
};

const isCacheableResponse = (response) => {
  if (!response || response.status !== 200) return false;
  if (response.type === "opaque" || response.type === "error") return false;

  const cacheControl = (response.headers.get("Cache-Control") || "").toLowerCase();
  if (cacheControl.includes("no-store")) return false;

  return true;
};

const isCacheableHtmlResponse = (response) => {
  if (!isCacheableResponse(response)) return false;
  const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
  return contentType.includes("text/html");
};

const trimCache = async (cacheName, maxEntries) => {
  const safeMax = Number(maxEntries) || 0;
  if (!safeMax) return;

  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= safeMax) return;

  const overflow = keys.length - safeMax;
  const staleKeys = keys.slice(0, overflow);
  await Promise.all(staleKeys.map((request) => cache.delete(request)));
};

const cacheResponseWithPrefetchMeta = async ({ cacheName, request, response, prefetchedAt = Date.now() }) => {
  const cache = await caches.open(cacheName);

  const headers = new Headers(response.headers || undefined);
  headers.set("X-SW-Prefetch-At", String(Math.max(0, Number(prefetchedAt) || Date.now())));

  const buffer = await response.clone().arrayBuffer();
  const wrapped = new Response(buffer, {
    status: response.status,
    statusText: response.statusText,
    headers
  });

  await cache.put(request, wrapped);
};

const cacheHtmlPageResponse = async ({ request, response, cachedAt = Date.now() }) => {
  if (!isCacheableHtmlResponse(response)) return false;

  await cacheResponseWithPrefetchMeta({
    cacheName: PAGE_CACHE_NAME,
    request,
    response,
    prefetchedAt: cachedAt
  });
  await trimCache(PAGE_CACHE_NAME, PAGE_CACHE_MAX_ENTRIES);
  return true;
};

const readPrefetchMeta = (response) => {
  if (!response) return { isPrefetched: false, prefetchedAt: 0, isFresh: false };
  const prefetchedAt = Number(response.headers.get("X-SW-Prefetch-At") || 0);
  if (!Number.isFinite(prefetchedAt) || prefetchedAt <= 0) {
    return { isPrefetched: false, prefetchedAt: 0, isFresh: false };
  }
  const age = Date.now() - prefetchedAt;
  return {
    isPrefetched: true,
    prefetchedAt,
    isFresh: age >= 0 && age <= PREFETCH_PAGE_TTL_MS
  };
};

const prefetchPageNavigation = async (urlText) => {
  const rawUrl = (urlText || "").toString().trim();
  if (!rawUrl) return;

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl, self.location.origin);
  } catch (_error) {
    return;
  }

  if (targetUrl.origin !== self.location.origin) return;
  if (!isFastHtmlPath(targetUrl.pathname || "/")) return;
  if (isServiceWorkerScript(targetUrl.pathname || "/") || shouldBypassPath(targetUrl.pathname || "/")) return;

  const cacheKey = targetUrl.toString();
  if (prefetchInFlight.has(cacheKey)) return;
  prefetchInFlight.add(cacheKey);

  try {
    const request = new Request(cacheKey, {
      method: "GET",
      mode: "same-origin",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
    const cacheRequest = buildPageCacheRequest(targetUrl);

    const response = await fetch(request);
    await cacheHtmlPageResponse({
      request: cacheRequest,
      response,
      cachedAt: Date.now()
    });
  } catch (_error) {
    // Ignore prefetch failures silently.
  } finally {
    prefetchInFlight.delete(cacheKey);
  }
};

const staleWhileRevalidate = async (event, request, cacheName, maxEntries) => {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const networkPromise = fetch(request)
    .then((networkResponse) => {
      if (isCacheableResponse(networkResponse)) {
        event.waitUntil(
          Promise.all([
            cache.put(request, networkResponse.clone()),
            trimCache(cacheName, Number(maxEntries) || STATIC_CACHE_MAX_ENTRIES)
          ])
        );
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cachedResponse) {
    event.waitUntil(networkPromise);
    return cachedResponse;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) {
    return networkResponse;
  }

  return fetch(request);
};

const networkFirstWithFallback = async (event, request, cacheName, maxEntries) => {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request);
    if (isCacheableResponse(networkResponse)) {
      event.waitUntil(
        Promise.all([
          cache.put(request, networkResponse.clone()),
          trimCache(cacheName, Number(maxEntries) || SCRIPT_CACHE_MAX_ENTRIES)
        ])
      );
    }
    return networkResponse;
  } catch (_error) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    return fetch(request);
  }
};

const getNavigationPreloadResponse = async (event) => {
  if (!event || !event.request || event.request.mode !== "navigate") return null;
  if (!("preloadResponse" in event)) return null;
  try {
    const preloadResponse = await event.preloadResponse;
    return preloadResponse || null;
  } catch (_error) {
    return null;
  }
};

const buildFetchFailureResponse = (request) => {
  const acceptHeader = (request && request.headers ? request.headers.get("Accept") : "") || "";
  const acceptsHtml = request && request.mode === "navigate"
    ? true
    : acceptHeader.toLowerCase().includes("text/html");

  if (acceptsHtml) {
    return new Response("Không thể kết nối mạng. Vui lòng thử lại.", {
      status: 503,
      statusText: "Service Unavailable",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }

  return new Response("", {
    status: 504,
    statusText: "Gateway Timeout",
    headers: {
      "Cache-Control": "no-store"
    }
  });
};

const resolveFetchFailure = async (request, url) => {
  if (request && request.mode === "navigate") {
    try {
      const pageCache = await caches.open(PAGE_CACHE_NAME);
      const cacheRequest = buildPageCacheRequest(url);
      const pageCached = await pageCache.match(cacheRequest);
      if (pageCached) return pageCached;
    } catch (_error) {
      // Ignore cache read failures.
    }
  }

  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;
  } catch (_error) {
    // Ignore cache read failures.
  }

  return buildFetchFailureResponse(request);
};

const handleCachedHtmlRequest = async (event, url) => {
  const { request } = event;
  const cacheRequest = buildPageCacheRequest(url);
  const pageCache = await caches.open(PAGE_CACHE_NAME);
  const cachedResponse = await pageCache.match(cacheRequest);
  const prefetchMeta = readPrefetchMeta(cachedResponse);
  const forceFreshResponse = shouldForceFreshPageResponse(request, url);

  const refreshCachedResponse = async ({ allowPreload = true, allowNetworkFallback = true } = {}) => {
    try {
      if (allowPreload) {
        const preloadResponse = await getNavigationPreloadResponse(event);
        if (preloadResponse) {
          await cacheHtmlPageResponse({
            request: cacheRequest,
            response: preloadResponse,
            cachedAt: Date.now()
          });
          return preloadResponse;
        }
      }

      if (!allowNetworkFallback) return null;

      const networkResponse = await fetch(request);
      await cacheHtmlPageResponse({
        request: cacheRequest,
        response: networkResponse,
        cachedAt: Date.now()
      });
      return networkResponse;
    } catch (_error) {
      return null;
    }
  };

  if (cachedResponse && !forceFreshResponse) {
    if (prefetchMeta.isFresh) {
      event.waitUntil(
        (async () => {
          await refreshCachedResponse({
            allowPreload: request.mode === "navigate",
            allowNetworkFallback: false
          });
          await prefetchPageNavigation(url.toString());
        })()
      );
    } else {
      event.waitUntil(
        refreshCachedResponse({
          allowPreload: request.mode === "navigate",
          allowNetworkFallback: true
        })
      );
    }

    return cachedResponse;
  }

  const networkResponse = await refreshCachedResponse({
    allowPreload: request.mode === "navigate",
    allowNetworkFallback: true
  });
  if (networkResponse) {
    return networkResponse;
  }

  if (cachedResponse) {
    return cachedResponse;
  }

  return fetch(request);
};

const handleFetch = async (event, url) => {
  const { request } = event;

  const pathname = url.pathname || "/";
  if (isServiceWorkerScript(pathname) || shouldBypassPath(pathname)) {
    if (request.mode === "navigate") {
      const preloadResponse = await getNavigationPreloadResponse(event);
      if (preloadResponse) return preloadResponse;
    }
    return fetch(request);
  }

  if (request.mode === "navigate") {
    if (!isFastHtmlPath(pathname)) {
      const preloadResponse = await getNavigationPreloadResponse(event);
      if (preloadResponse) return preloadResponse;
      return fetch(request);
    }

    return handleCachedHtmlRequest(event, url);
  }

  if (isFastNavHtmlRequest(request) && isFastHtmlPath(pathname)) {
    return handleCachedHtmlRequest(event, url);
  }

  const destination = (request.destination || "").toLowerCase();
  const isStaticRequest = CACHEABLE_DESTINATIONS.has(destination) || STATIC_ASSET_PATH_PATTERN.test(pathname);
  if (!isStaticRequest) {
    return fetch(request);
  }

  const isScriptRequest = destination === "script" || SCRIPT_PATH_PATTERN.test(pathname);
  if (isScriptRequest) {
    return networkFirstWithFallback(event, request, STATIC_CACHE_NAME, SCRIPT_CACHE_MAX_ENTRIES);
  }

  return staleWhileRevalidate(event, request, STATIC_CACHE_NAME, STATIC_CACHE_MAX_ENTRIES);
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys.map((cacheKey) => {
          const isOwned = cacheKey.startsWith(`${CACHE_PREFIX}-`);
          const isCurrent = cacheKey === STATIC_CACHE_NAME || cacheKey === PAGE_CACHE_NAME;
          if (isOwned && !isCurrent) {
            return caches.delete(cacheKey);
          }
          return Promise.resolve(false);
        })
      );

      if (self.registration && self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (_error) {
          // Ignore unsupported navigation preload.
        }
      }

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event && event.request ? event.request : null;
  if (!request || request.method !== "GET") return;

  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch (_error) {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    handleFetch(event, url).catch(() => resolveFetchFailure(request, url))
  );
});

const invalidatePageCacheUrls = async (rawUrls) => {
  const urls = Array.isArray(rawUrls) ? rawUrls : [rawUrls];
  if (!urls.length) return;

  const cache = await caches.open(PAGE_CACHE_NAME);
  const targets = new Set();

  urls.forEach((value) => {
    const raw = (value || "").toString().trim();
    if (!raw) return;
    let parsed = null;
    try {
      parsed = new URL(raw, self.location.origin);
    } catch (_error) {
      parsed = null;
    }
    if (!parsed || parsed.origin !== self.location.origin) return;

    parsed.hash = "";
    parsed.searchParams.delete("__bfv");
    targets.add(parsed.toString());

    if (isFastHtmlPath(parsed.pathname || "/")) {
      const base = new URL(parsed.toString());
      base.search = "";
      targets.add(base.toString());
    }
  });

  if (!targets.size) return;

  await Promise.all(
    Array.from(targets).map((targetUrl) => {
      const request = buildPageCacheRequest(targetUrl);
      return cache.delete(request);
    })
  );
};

const invalidateAllPageCache = async () => {
  const cache = await caches.open(PAGE_CACHE_NAME);
  const keys = await cache.keys();
  if (!keys.length) return;

  await Promise.all(keys.map((request) => cache.delete(request)));
};

self.addEventListener("message", (event) => {
  const data = event && event.data ? event.data : null;
  if (!data || typeof data !== "object") return;

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (data.type === "PREFETCH_PAGE") {
    event.waitUntil(prefetchPageNavigation(data.url));
    return;
  }

  if (data.type === "INVALIDATE_ALL_PAGE_CACHE") {
    event.waitUntil(invalidateAllPageCache());
    return;
  }

  if (data.type === "INVALIDATE_PAGE_CACHE") {
    const urls = Array.isArray(data.urls) ? data.urls : [data.url];
    event.waitUntil(invalidatePageCacheUrls(urls));
  }
});
