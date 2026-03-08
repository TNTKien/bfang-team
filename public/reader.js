const readerFloat = document.querySelector("[data-reader-float]");
const fixedNavs = Array.from(document.querySelectorAll("[data-reader-fixed]"));
const commentsSection = document.querySelector("#comments");
const quickTop = document.querySelector("[data-reader-top]");
const quickComments = document.querySelector("[data-reader-comments]");
const dropdowns = Array.from(document.querySelectorAll("[data-reader-dropdown]"));
const READER_JUMP_COMMENTS_EVENT = "bfang:reader-jump-comments";
const READER_CANCEL_JUMP_COMMENTS_EVENT = "bfang:reader-cancel-jump-comments";
const READER_COMMENTS_LAYOUT_EVENT = "bfang:reader-comments-layout";

const isElementVisible = (element) => {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
};

const isCommentsVisible = () => {
  if (!commentsSection) return false;
  return isElementVisible(commentsSection);
};

const isFixedVisible = () => fixedNavs.some(isElementVisible);

const initDropdown = (dropdown, closeAll) => {
  const toggle = dropdown.querySelector("[data-reader-toggle]");
  const panel = dropdown.querySelector("[data-reader-panel]");
  const list = dropdown.querySelector("[data-reader-list]");
  const scrollButtons = dropdown.querySelectorAll("[data-reader-scroll]");

  const setOpen = (open) => {
    if (open) {
      dropdown.classList.add("is-open");
    } else {
      dropdown.classList.remove("is-open");
    }
  };

  dropdown._setOpen = setOpen;

  if (toggle) {
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = dropdown.classList.contains("is-open");
      closeAll(dropdown);
      setOpen(!isOpen);
    });
  }

  if (list) {
    list.addEventListener("click", (event) => {
      const option = event.target.closest("[data-reader-option]");
      if (!option) return;
      const href = option.dataset.href;
      if (href) {
        window.location.href = href;
      }
    });
  }

  scrollButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!list) return;
      const direction = button.dataset.readerScroll;
      const amount = direction === "up" ? -160 : 160;
      list.scrollBy({ top: amount, behavior: "smooth" });
    });
  });

  if (panel) {
    panel.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }
};

const closeAllDropdowns = (except) => {
  dropdowns.forEach((dropdown) => {
    if (dropdown !== except && dropdown._setOpen) {
      dropdown._setOpen(false);
    }
  });
};

dropdowns.forEach((dropdown) => initDropdown(dropdown, closeAllDropdowns));

if (readerFloat) {
  let lastScroll = window.scrollY;
  let ticking = false;
  const threshold = 8;
  const floatDropdown = readerFloat.querySelector("[data-reader-dropdown]");

  const setVisible = (visible) => {
    if (visible) {
      readerFloat.classList.add("is-visible");
    } else {
      readerFloat.classList.remove("is-visible");
    }
  };

  const updateVisibility = () => {
    const current = window.scrollY;
    const diff = current - lastScroll;
    const commentsVisible = isCommentsVisible();
    const fixedVisible = isFixedVisible();
    const floatOpen = floatDropdown && floatDropdown.classList.contains("is-open");

    if (commentsVisible || fixedVisible) {
      setVisible(false);
      if (floatOpen && floatDropdown._setOpen) {
        floatDropdown._setOpen(false);
      }
    } else if (floatOpen) {
      setVisible(true);
    } else if (diff < -threshold) {
      setVisible(true);
    } else if (diff > threshold) {
      setVisible(false);
    }

    if (!commentsVisible && !fixedVisible && current < 120) {
      setVisible(true);
    }

    lastScroll = current;
    ticking = false;
  };

  window.addEventListener("scroll", () => {
    if (!ticking) {
      window.requestAnimationFrame(updateVisibility);
      ticking = true;
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!target.closest("[data-reader-dropdown]")) {
      closeAllDropdowns();
    }
  });

  updateVisibility();
}

if (quickTop) {
  quickTop.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent(READER_CANCEL_JUMP_COMMENTS_EVENT));
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

if (quickComments) {
  quickComments.addEventListener("click", () => {
    if (commentsSection) {
      window.dispatchEvent(new CustomEvent(READER_JUMP_COMMENTS_EVENT));
      commentsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

(() => {
  const prevLink = document.querySelector('a[aria-label="Chương trước"][href]');
  const nextLink = document.querySelector('a[aria-label="Chương sau"][href]');
  if (!prevLink && !nextLink) return;

  const isTextEditingContext = () => {
    const active = document.activeElement;
    if (!active || !(active instanceof HTMLElement)) return false;

    const tag = (active.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input") {
      const type = (active.getAttribute("type") || "text").toLowerCase();
      return type !== "checkbox" && type !== "radio" && type !== "button";
    }
    if (active.isContentEditable) return true;
    return false;
  };

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (isTextEditingContext()) return;

    const key = (event.key || "").toString();
    let targetHref = "";

    if (key === "ArrowRight") {
      targetHref = nextLink ? (nextLink.getAttribute("href") || "").toString().trim() : "";
    } else if (key === "ArrowLeft") {
      targetHref = prevLink ? (prevLink.getAttribute("href") || "").toString().trim() : "";
    } else {
      return;
    }

    if (!targetHref) return;
    event.preventDefault();
    window.location.href = targetHref;
  });
})();

(() => {
  const pagesRoot = document.querySelector("[data-reader-lazy-pages]");
  if (!pagesRoot) return;

  const allImages = Array.from(pagesRoot.querySelectorAll(".page-media--lazy"));
  if (!allImages.length) return;

  const resolvePageIndex = (img, fallbackIndex) => {
    const raw = Number(img && img.dataset ? img.dataset.pageIndex : NaN);
    if (Number.isFinite(raw) && raw >= 0) {
      return Math.floor(raw);
    }
    return fallbackIndex;
  };

  const orderedImages = allImages
    .map((img, index) => ({ img, pageIndex: resolvePageIndex(img, index) }))
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .map((entry) => entry.img);

  const getPageFrame = (img) => (img && img.closest ? img.closest(".page-frame") : null);

  const getPositiveDimension = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.round(numeric);
  };

  const applyPageFrameWidth = (img) => {
    if (!img || !img.isConnected) return;

    const frame = getPageFrame(img);
    if (!frame) return;

    const naturalWidth = getPositiveDimension(img.naturalWidth);
    const naturalHeight = getPositiveDimension(img.naturalHeight);
    const measuredRect = img.getBoundingClientRect();
    const measuredWidth = getPositiveDimension(measuredRect.width);
    const measuredHeight = getPositiveDimension(measuredRect.height);

    const sourceWidth = naturalWidth || measuredWidth;
    if (!sourceWidth) return;

    const sourceHeight = naturalHeight || measuredHeight;
    const isLandscape = sourceHeight > 0 ? sourceWidth > sourceHeight : sourceWidth > 1200;
    const desktopPixelCap = isLandscape ? 1800 : 1200;
    const desktopViewportCap = isLandscape ? "90vw" : "85vw";
    const resolvedWidth = Math.min(sourceWidth, desktopPixelCap);
    const frameWidth = `${Math.round(resolvedWidth)}px`;

    frame.style.setProperty("--page-frame-width", frameWidth);
    frame.style.setProperty("--page-desktop-max-viewport", desktopViewportCap);
    pagesRoot.style.setProperty("--reader-page-width", frameWidth);
    pagesRoot.style.setProperty("--reader-page-desktop-max-viewport", desktopViewportCap);
  };

  const getDeferredSrc = (img) =>
    (img && img.dataset && img.dataset.src ? String(img.dataset.src).trim() : "");

  const lazyImages = orderedImages.filter((img) => Boolean(getDeferredSrc(img)));
  const tinyPlaceholder = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const placeholderSrc = (orderedImages[0].getAttribute("src") || "").toString() || tinyPlaceholder;

  const connection =
    (navigator && (navigator.connection || navigator.mozConnection || navigator.webkitConnection)) || null;
  const saveData = Boolean(connection && connection.saveData);
  const retryDelayMs = saveData ? 1800 : 1100;
  const maxRetryCount = saveData ? 1 : 2;
  const lookAheadForwardCount = 5;
  const lookBehindCount = 3;
  const maxLookAheadConcurrency = saveData ? 1 : 3;
  const jumpToCommentsMaxMs = saveData ? 24000 : 16000;

  let activePageIndex = 0;
  let syncTicking = false;
  let lookAheadTimer = null;
  let triggerNextChapterPrefetch = () => {};

  const lookAheadQueue = [];
  const lookAheadQueuedSet = new Set();
  let jumpToCommentsActive = false;
  let jumpToCommentsTimer = null;
  let jumpToCommentsStartedAt = 0;

  const getLazyState = (img) =>
    (img && img.dataset && img.dataset.lazyState ? String(img.dataset.lazyState).trim() : "");

  const clearJumpToComments = () => {
    jumpToCommentsActive = false;
    if (!jumpToCommentsTimer) return;
    window.clearTimeout(jumpToCommentsTimer);
    jumpToCommentsTimer = null;
  };

  const isCommentsReached = () => {
    if (!commentsSection) return true;
    const rect = commentsSection.getBoundingClientRect();
    const threshold = Math.max(24, window.innerHeight * 0.08);
    return rect.top <= threshold && rect.bottom > threshold;
  };

  const scrollToCommentsTarget = (behavior) => {
    if (!commentsSection) return;
    commentsSection.scrollIntoView({ behavior, block: "start" });
  };

  const getLoadingCount = () =>
    lazyImages.reduce((count, img) => (getLazyState(img) === "loading" ? count + 1 : count), 0);

  const getPendingLazyCount = () =>
    lazyImages.reduce((count, img) => {
      const state = getLazyState(img);
      return state === "loaded" || state === "error" ? count : count + 1;
    }, 0);

  const enqueueImagesTowardComments = () => {
    if (!orderedImages.length) return;
    const startIndex = Math.max(0, Math.min(orderedImages.length - 1, activePageIndex));
    for (let index = startIndex; index < orderedImages.length; index += 1) {
      enqueueLookAheadImage(orderedImages[index]);
    }
  };

  const scheduleJumpToCommentsSync = (delayMs, behavior) => {
    if (!jumpToCommentsActive) return;
    if (jumpToCommentsTimer) {
      window.clearTimeout(jumpToCommentsTimer);
      jumpToCommentsTimer = null;
    }

    const delay = Number.isFinite(Number(delayMs))
      ? Math.max(40, Math.min(1200, Math.floor(Number(delayMs))))
      : 180;

    jumpToCommentsTimer = window.setTimeout(() => {
      jumpToCommentsTimer = null;
      if (!jumpToCommentsActive) return;
      const pendingLazyCount = getPendingLazyCount();
      if (pendingLazyCount === 0 && isElementVisible(commentsSection)) {
        clearJumpToComments();
        return;
      }
      if (jumpToCommentsStartedAt && Date.now() - jumpToCommentsStartedAt >= jumpToCommentsMaxMs) {
        if (isElementVisible(commentsSection)) {
          clearJumpToComments();
          return;
        }
      }
      enqueueImagesTowardComments();
      drainLookAheadQueue();
      scrollToCommentsTarget(behavior || "auto");
      scheduleJumpToCommentsSync(180, "auto");
    }, delay);
  };

  const requestJumpToComments = () => {
    if (!commentsSection) return;
    jumpToCommentsActive = true;
    jumpToCommentsStartedAt = Date.now();
    activePageIndex = resolveActivePageIndex();
    enqueueImagesTowardComments();
    drainLookAheadQueue();
    scrollToCommentsTarget("smooth");
    scheduleJumpToCommentsSync(220, "auto");
  };

  const isChapterReady = () =>
    orderedImages.every((img) => {
      const deferredSrc = getDeferredSrc(img);
      if (!deferredSrc) return true;
      return getLazyState(img) === "loaded";
    });

  const markLoaded = (img) => {
    img.dataset.lazyState = "loaded";
    img.classList.remove("is-placeholder", "is-error", "lazyerror", "lazyload", "lazyloaded");
    img.classList.add("is-loaded");
  };

  const markError = (img) => {
    img.dataset.lazyState = "error";
    img.classList.remove("is-loaded", "is-placeholder", "lazyloaded", "lazyload");
    img.classList.add("is-error");
  };

  const getRetryCount = (img) => {
    const raw = Number(img && img.dataset ? img.dataset.lazyRetryCount : NaN);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.floor(raw);
  };

  const resetRetry = (img) => {
    if (!img || !img.dataset) return;
    delete img.dataset.lazyRetryCount;
  };

  const withRetryQuery = (url, retryToken) => {
    const raw = (url || "").toString().trim();
    if (!raw) return "";

    try {
      const parsed = new URL(raw, window.location.href);
      parsed.searchParams.set("lr", String(retryToken));
      return parsed.toString();
    } catch (_err) {
      const separator = raw.includes("?") ? "&" : "?";
      return `${raw}${separator}lr=${encodeURIComponent(String(retryToken))}`;
    }
  };

  const normalizeComparableUrl = (value) => {
    const raw = (value || "").toString().trim();
    if (!raw) return "";
    try {
      return new URL(raw, window.location.href).toString();
    } catch (_err) {
      return raw;
    }
  };

  const isCurrentSrcExpected = (img) => {
    const expected =
      (img && img.dataset && (img.dataset.src || img.dataset.lazyOriginalSrc)
        ? String(img.dataset.src || img.dataset.lazyOriginalSrc).trim()
        : "");
    if (!expected) return true;

    const current = (img && (img.currentSrc || img.src) ? String(img.currentSrc || img.src).trim() : "");
    if (!current) return false;

    return normalizeComparableUrl(current) === normalizeComparableUrl(expected);
  };

  const requestUnveil = (img) => {
    if (!img) return;

    const state = getLazyState(img);
    if (state === "loaded" || state === "loading") return;

    const src = getDeferredSrc(img);
    if (!src) return;

    img.dataset.lazyState = "loading";
    img.classList.remove("is-error", "lazyerror");

    img.loading = "eager";
    img.decoding = "async";
    img.classList.remove("lazyload");
    img.src = src;
  };

  const scheduleLookAheadDrain = (delayMs) => {
    if (!lookAheadQueue.length) return;
    if (lookAheadTimer) return;

    const delay = Number.isFinite(Number(delayMs))
      ? Math.max(40, Math.min(2500, Math.floor(Number(delayMs))))
      : 120;

    lookAheadTimer = window.setTimeout(() => {
      lookAheadTimer = null;
      drainLookAheadQueue();
    }, delay);
  };

  function drainLookAheadQueue() {
    if (!lookAheadQueue.length) return;

    let capacity = maxLookAheadConcurrency - getLoadingCount();
    if (!Number.isFinite(capacity) || capacity <= 0) {
      scheduleLookAheadDrain(220);
      return;
    }

    while (capacity > 0 && lookAheadQueue.length) {
      const img = lookAheadQueue.shift();
      lookAheadQueuedSet.delete(img);
      if (!img || !img.isConnected) continue;

      const state = getLazyState(img);
      if (state === "loaded" || state === "loading" || state === "error") continue;

      const src = getDeferredSrc(img);
      if (!src) continue;

      requestUnveil(img);
      capacity -= 1;
    }

    if (lookAheadQueue.length) {
      scheduleLookAheadDrain(220);
    }
  }

  const enqueueLookAheadImage = (img) => {
    if (!img || !img.dataset) return;
    if (lookAheadQueuedSet.has(img)) return;

    const state = getLazyState(img);
    if (state === "loaded" || state === "loading" || state === "error") return;

    const src = getDeferredSrc(img);
    if (!src) return;

    lookAheadQueuedSet.add(img);
    lookAheadQueue.push(img);
  };

  const resetLookAheadQueue = () => {
    lookAheadQueue.length = 0;
    lookAheadQueuedSet.clear();
  };

  const queueLookAround = (baseIndex) => {
    if (!orderedImages.length) return;

    const center = Math.max(0, Math.min(orderedImages.length - 1, Math.floor(Number(baseIndex) || 0)));
    resetLookAheadQueue();

    enqueueLookAheadImage(orderedImages[center]);

    for (let step = 1; step <= lookAheadForwardCount; step += 1) {
      const ahead = center + step;
      if (ahead < orderedImages.length) {
        enqueueLookAheadImage(orderedImages[ahead]);
      }
    }

    for (let step = 1; step <= lookBehindCount; step += 1) {
      const behind = center - step;
      if (behind >= 0) {
        enqueueLookAheadImage(orderedImages[behind]);
      }
    }

    drainLookAheadQueue();
  };

  const resolveActivePageIndex = () => {
    if (!orderedImages.length) return 0;

    const viewportHeight = window.innerHeight || 0;
    if (!viewportHeight) return activePageIndex;

    const focusLine = viewportHeight * 0.38;
    for (let index = 0; index < orderedImages.length; index += 1) {
      const rect = orderedImages[index].getBoundingClientRect();
      if (rect.top <= focusLine && rect.bottom >= focusLine) {
        return index;
      }
    }

    for (let index = 0; index < orderedImages.length; index += 1) {
      const rect = orderedImages[index].getBoundingClientRect();
      if (rect.bottom > 0) {
        return index;
      }
    }

    return orderedImages.length - 1;
  };

  const syncActiveWindow = () => {
    activePageIndex = resolveActivePageIndex();
    if (jumpToCommentsActive) {
      enqueueImagesTowardComments();
      drainLookAheadQueue();
      return;
    }
    queueLookAround(activePageIndex);
  };

  const scheduleActiveWindowSync = () => {
    if (syncTicking) return;
    syncTicking = true;
    window.requestAnimationFrame(() => {
      syncTicking = false;
      syncActiveWindow();
    });
  };

  const onImageLoaded = (img) => {
    resetRetry(img);
    markLoaded(img);
    applyPageFrameWidth(img);
    activePageIndex = resolveActivePageIndex();
    if (jumpToCommentsActive) {
      enqueueImagesTowardComments();
      drainLookAheadQueue();
      scheduleJumpToCommentsSync(80, "auto");
    } else {
      queueLookAround(activePageIndex);
    }
    triggerNextChapterPrefetch();
  };

  const retryLazyImage = (img) => {
    if (!img || !img.dataset) return;
    const retries = getRetryCount(img);
    if (retries >= maxRetryCount) {
      markError(img);
      drainLookAheadQueue();
      return;
    }

    const nextRetry = retries + 1;
    img.dataset.lazyRetryCount = String(nextRetry);
    img.dataset.lazyState = "idle";
    img.classList.remove("is-error", "lazyerror", "lazyloaded");
    img.classList.add("is-placeholder");

    const originalSrc =
      (img.dataset.lazyOriginalSrc || img.dataset.src || "").toString().trim();
    if (originalSrc) {
      img.dataset.lazyOriginalSrc = originalSrc;
      img.dataset.src = withRetryQuery(originalSrc, `${Date.now()}-${nextRetry}`);
    }

    img.src = "";
    if (placeholderSrc) {
      img.src = placeholderSrc;
    }

    window.setTimeout(() => {
      if (!img.isConnected) return;
      const state = (img.dataset.lazyState || "").toString();
      if (state === "loaded") return;
      requestUnveil(img);
      scheduleLookAheadDrain(220);
      if (jumpToCommentsActive) {
        scheduleJumpToCommentsSync(120, "auto");
      }
    }, retryDelayMs * nextRetry);
  };

  orderedImages.forEach((img) => {
    if (!img.dataset.lazyState) {
      const deferredSrc = getDeferredSrc(img);
      img.dataset.lazyState = img.classList.contains("is-loaded") || !deferredSrc ? "loaded" : "idle";
    }

    const originalSrc = getDeferredSrc(img);
    if (originalSrc) {
      img.dataset.lazyOriginalSrc = originalSrc;
      img.classList.remove("lazyload");
    } else {
      markLoaded(img);
      applyPageFrameWidth(img);
    }

    img.addEventListener("load", () => {
      if (getLazyState(img) !== "loading") return;
      if (!isCurrentSrcExpected(img)) return;
      onImageLoaded(img);
    });

    img.addEventListener("error", () => {
      const state = (img.dataset.lazyState || "").toString();
      if (state === "loaded") return;
      retryLazyImage(img);
    });

    img.addEventListener("click", () => {
      const state = (img.dataset.lazyState || "").toString();
      if (state !== "error") return;
      img.dataset.lazyRetryCount = "0";
      retryLazyImage(img);
    });

    if (img.complete && (img.naturalWidth || img.getBoundingClientRect().width)) {
      applyPageFrameWidth(img);
    }
  });

  syncActiveWindow();
  window.addEventListener("scroll", scheduleActiveWindowSync, { passive: true });
  window.addEventListener("resize", scheduleActiveWindowSync, { passive: true });
  window.addEventListener(READER_JUMP_COMMENTS_EVENT, requestJumpToComments);
  window.addEventListener(READER_CANCEL_JUMP_COMMENTS_EVENT, clearJumpToComments);
  window.addEventListener(READER_COMMENTS_LAYOUT_EVENT, () => {
    if (!jumpToCommentsActive) return;
    scheduleJumpToCommentsSync(60, "auto");
  });

  const nextChapterPrefetchUrls = (() => {
    const encoded = (pagesRoot.dataset.readerNextPrefetch || "").toString().trim();
    if (!encoded) return [];

    let parsed = null;
    try {
      parsed = JSON.parse(decodeURIComponent(encoded));
    } catch (_err) {
      parsed = null;
    }

    const list = Array.isArray(parsed) ? parsed : [];
    return list
      .map((value) => (value == null ? "" : String(value)).trim())
      .filter((value) => value && value.length <= 2000)
      .filter((value) => value.startsWith("/") || /^https?:\/\//i.test(value))
      .slice(0, 3);
  })();

  const nextPrefetchConcurrency = saveData ? 0 : 1;
  if (!nextPrefetchConcurrency || !nextChapterPrefetchUrls.length) return;

  const prefetchQueue = Array.from(new Set(nextChapterPrefetchUrls));
  const prefetchedSet = new Set();
  const prefetchRefs = [];
  let prefetchInFlight = 0;
  let prefetchTimer = null;

  const canPrefetchNow = () => {
    if (document.hidden) return false;
    if (!prefetchQueue.length) return false;

    if (!isChapterReady()) return false;
    if (getLoadingCount() > 0) return false;

    return true;
  };

  const schedulePrefetch = (delayMs) => {
    if (!prefetchQueue.length) return;
    if (prefetchTimer) return;

    const delay = Number.isFinite(Number(delayMs))
      ? Math.max(200, Math.min(6000, Math.floor(Number(delayMs))))
      : 900;

    prefetchTimer = window.setTimeout(() => {
      prefetchTimer = null;
      drainPrefetch();
    }, delay);
  };

  const prefetchUrl = (url) => {
    const normalized = (url || "").toString().trim();
    if (!normalized || prefetchedSet.has(normalized)) return;
    prefetchedSet.add(normalized);

    prefetchInFlight += 1;

    const image = new Image();
    prefetchRefs.push(image);
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    try {
      image.fetchPriority = "low";
    } catch (_err) {
      // ignore
    }

    const done = () => {
      image.onload = null;
      image.onerror = null;
      prefetchInFlight = Math.max(0, prefetchInFlight - 1);
      if (prefetchQueue.length) {
        schedulePrefetch(900);
      }
    };

    image.onload = done;
    image.onerror = done;
    image.src = normalized;
  };

  function drainPrefetch() {
    if (!canPrefetchNow()) {
      if (prefetchQueue.length) {
        schedulePrefetch(1800);
      }
      return;
    }

    while (prefetchInFlight < nextPrefetchConcurrency && prefetchQueue.length) {
      const url = prefetchQueue.shift();
      if (!url) continue;
      prefetchUrl(url);
    }

    if (prefetchQueue.length) {
      schedulePrefetch(1200);
    }
  }

  triggerNextChapterPrefetch = () => {
    if (!prefetchQueue.length) return;
    if (!isChapterReady()) return;
    schedulePrefetch(420);
  };

  triggerNextChapterPrefetch();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      schedulePrefetch(420);
    }
  });
})();
