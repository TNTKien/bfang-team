const readerFloat = document.querySelector("[data-reader-float]");
const fixedNavs = Array.from(document.querySelectorAll("[data-reader-fixed]"));
const commentsSection = document.querySelector("#comments");
const quickTop = document.querySelector("[data-reader-top]");
const quickComments = document.querySelector("[data-reader-comments]");
const dropdowns = Array.from(document.querySelectorAll("[data-reader-dropdown]"));
const READER_JUMP_COMMENTS_EVENT = "bfang:reader-jump-comments";
const READER_CANCEL_JUMP_COMMENTS_EVENT = "bfang:reader-cancel-jump-comments";
const READER_COMMENTS_LAYOUT_EVENT = "bfang:reader-comments-layout";

(() => {
  const unlockForm = document.querySelector("[data-chapter-unlock-form]");
  if (!(unlockForm instanceof HTMLFormElement)) return;
  if (typeof window.fetch !== "function") return;

  const passwordInput = unlockForm.querySelector("[data-chapter-unlock-input]");
  const submitButton = unlockForm.querySelector("[data-chapter-unlock-submit]");
  const errorEl = unlockForm.querySelector("[data-chapter-unlock-error]");
  const countdownEl = unlockForm.querySelector("[data-chapter-unlock-countdown]");
  let lockUntilMs = 0;
  let lockTimerId = 0;

  const parsePositiveNumber = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
  };

  const formatLockDurationLabel = (remainingMs) => {
    const totalSeconds = Math.max(1, Math.ceil(Math.max(Number(remainingMs) || 0, 0) / 1000));
    if (totalSeconds >= 60) {
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${minutes}:${String(seconds).padStart(2, "0")}`;
    }
    return `${totalSeconds}s`;
  };

  const clearLockTimer = () => {
    if (!lockTimerId) return;
    window.clearInterval(lockTimerId);
    lockTimerId = 0;
  };

  const getRemainingLockMs = () => {
    if (lockUntilMs <= 0) return 0;
    return Math.max(0, lockUntilMs - Date.now());
  };

  const isLocked = () => getRemainingLockMs() > 0;

  const setCountdownMessage = (message) => {
    if (!(countdownEl instanceof HTMLElement)) return;
    const text = (message || "").toString().trim();
    countdownEl.textContent = text;
    countdownEl.hidden = !text;
  };

  const applyControlState = () => {
    const isSubmitting = unlockForm.dataset.unlockSubmitting === "1";
    const remainingLockMs = getRemainingLockMs();
    const hasLock = remainingLockMs > 0;

    unlockForm.classList.toggle("is-locked", hasLock);

    if (passwordInput instanceof HTMLInputElement) {
      passwordInput.disabled = isSubmitting || hasLock;
    }

    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = isSubmitting || hasLock;
      if (isSubmitting) {
        submitButton.textContent = "Đang kiểm tra...";
      } else if (hasLock) {
        submitButton.textContent = `Thử lại ${formatLockDurationLabel(remainingLockMs)}`;
      } else {
        submitButton.textContent = "Mở khóa";
      }
    }
  };

  const stopLockCountdown = () => {
    lockUntilMs = 0;
    clearLockTimer();
    setCountdownMessage("");
    setError("");
    applyControlState();
  };

  const tickLockCountdown = () => {
    const remainingLockMs = getRemainingLockMs();
    if (remainingLockMs <= 0) {
      stopLockCountdown();
      return;
    }
    setCountdownMessage(`Bạn có thể thử lại sau ${formatLockDurationLabel(remainingLockMs)}.`);
    applyControlState();
  };

  const startLockCountdown = (retryAfterMs, message) => {
    const parsedRetryAfterMs = parsePositiveNumber(retryAfterMs);
    const safeRetryAfterMs = parsedRetryAfterMs > 0 ? parsedRetryAfterMs : 15 * 1000;
    lockUntilMs = Date.now() + safeRetryAfterMs;
    clearLockTimer();
    if (message) {
      setError(message);
    }
    tickLockCountdown();
    lockTimerId = window.setInterval(tickLockCountdown, 250);
  };

  const parseRetryAfterMsFromResponse = (response, data) => {
    const bodyRetryAfterMs = parsePositiveNumber(data && data.retryAfterMs);
    if (bodyRetryAfterMs > 0) return bodyRetryAfterMs;

    if (response && response.headers) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterSeconds = Number(retryAfterHeader);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.floor(retryAfterSeconds * 1000);
      }
    }

    return 0;
  };

  const showErrorToast = (message) => {
    const text = (message || "").toString().trim();
    if (!text) return;

    if (window.BfangToast && typeof window.BfangToast.error === "function") {
      window.BfangToast.error(text, {
        dedupe: false,
        duration: 5600
      });
      return;
    }

    if (typeof window.CustomEvent === "function") {
      window.dispatchEvent(
        new CustomEvent("bfang:toast", {
          detail: {
            message: text,
            tone: "error",
            dedupe: false,
            duration: 5600
          }
        })
      );
    }
  };

  const setError = (message) => {
    if (!(errorEl instanceof HTMLElement)) return;
    const text = (message || "").toString().trim();
    errorEl.textContent = text;
    errorEl.hidden = !text;
  };

  const initialRetryAfterMs = parsePositiveNumber(unlockForm.dataset.chapterUnlockRetryAfterMs);
  if (initialRetryAfterMs > 0) {
    const initialLockMessage =
      errorEl instanceof HTMLElement ? String(errorEl.textContent || "").trim() : "";
    startLockCountdown(initialRetryAfterMs, initialLockMessage);
  } else {
    applyControlState();
  }

  unlockForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (unlockForm.dataset.unlockSubmitting === "1") {
      return;
    }

    if (isLocked()) {
      const message = `Bạn cần chờ ${formatLockDurationLabel(getRemainingLockMs())} trước khi thử lại.`;
      setError(message);
      showErrorToast(message);
      tickLockCountdown();
      return;
    }

    const passwordValue =
      passwordInput instanceof HTMLInputElement ? String(passwordInput.value || "").trim() : "";
    if (!passwordValue) {
      const message = "Vui lòng nhập mật khẩu chương.";
      setError(message);
      showErrorToast(message);
      if (passwordInput instanceof HTMLInputElement) {
        passwordInput.focus();
      }
      return;
    }

    const formData = new FormData(unlockForm);
    const params = new URLSearchParams();
    formData.forEach((value, key) => {
      params.append(key, value == null ? "" : String(value));
    });

    let navigating = false;
    unlockForm.dataset.unlockSubmitting = "1";
    applyControlState();
    try {
      const response = await fetch(unlockForm.action, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "same-origin",
        body: params.toString()
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.ok !== true) {
        const fallbackMessage =
          response.status === 429
            ? "Bạn đã thử sai quá nhiều lần. Vui lòng chờ một lúc rồi thử lại."
            : "Mật khẩu chương không chính xác.";
        const message = data && data.error ? String(data.error) : fallbackMessage;
        if (response.status === 429) {
          const retryAfterMs = parseRetryAfterMsFromResponse(response, data);
          startLockCountdown(retryAfterMs, message);
        } else {
          setError(message);
        }
        showErrorToast(message);
        return;
      }

      setError("");
      stopLockCountdown();
      const redirectUrl = (data.redirectUrl || "").toString().trim() || window.location.pathname;
      navigating = true;
      window.location.href = redirectUrl;
    } catch (_error) {
      const message = "Không thể kiểm tra mật khẩu lúc này. Vui lòng thử lại.";
      setError(message);
      showErrorToast(message);
    } finally {
      delete unlockForm.dataset.unlockSubmitting;
      if (!navigating) {
        applyControlState();
      }
    }
  });
})();

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

dropdowns.forEach((dropdown) => {
  initDropdown(dropdown, closeAllDropdowns);
});

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

  const viewTrackUrl = (pagesRoot.dataset.readerViewTrackUrl || "").toString().trim();
  const viewTrackToken = (pagesRoot.dataset.readerViewTrackToken || "").toString().trim();
  const totalPagesRaw = Number(pagesRoot.dataset.readerTotalPages);
  const totalPages =
    Number.isFinite(totalPagesRaw) && totalPagesRaw > 0 ? Math.floor(totalPagesRaw) : orderedImages.length;
  const thresholdRaw = Number(pagesRoot.dataset.readerViewThreshold);
  const requiredViewedPages = Number.isFinite(thresholdRaw) && thresholdRaw > 0
    ? Math.floor(thresholdRaw)
    : Math.max(1, Math.floor(totalPages / 2 + 1));
  const canTrackChapterView = Boolean(viewTrackUrl) && Boolean(viewTrackToken) && totalPages > 0;
  const viewedPageIndexes = new Set();
  let chapterViewSent = false;
  let chapterViewSending = false;
  const chapterViewStartedAt = Date.now();
  let chapterViewDurationTimer = null;

  const getPageIndexFromImage = (img) => {
    const indexRaw = Number(img && img.dataset ? img.dataset.pageIndex : NaN);
    if (!Number.isFinite(indexRaw) || indexRaw < 0) return -1;
    return Math.floor(indexRaw);
  };

  const getSeenSeconds = () => {
    const elapsedMs = Date.now() - chapterViewStartedAt;
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
    return Math.floor(elapsedMs / 1000);
  };

  const sendChapterViewIfReady = async () => {
    if (!canTrackChapterView || chapterViewSent || chapterViewSending) return;
    const seenPages = viewedPageIndexes.size;
    const seenSeconds = getSeenSeconds();
    if (seenPages < requiredViewedPages && seenSeconds < requiredViewedPages) return;

    chapterViewSending = true;
    try {
      const response = await fetch(viewTrackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify({ seenPages, trackToken: viewTrackToken })
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload && payload.ok === true && payload.counted === true) {
        chapterViewSent = true;
        if (chapterViewDurationTimer) {
          window.clearTimeout(chapterViewDurationTimer);
          chapterViewDurationTimer = null;
        }
      }
    } catch (_err) {
      // Ignore tracking failures.
    } finally {
      chapterViewSending = false;
    }
  };

  const markPageAsViewed = (pageIndex) => {
    if (!canTrackChapterView || chapterViewSent) return;
    if (!Number.isFinite(pageIndex) || pageIndex < 0) return;
    viewedPageIndexes.add(Math.floor(pageIndex));
    if (viewedPageIndexes.size >= requiredViewedPages) {
      sendChapterViewIfReady().catch(() => null);
    }
  };

  const scheduleDurationTracking = () => {
    if (!canTrackChapterView || chapterViewSent || chapterViewDurationTimer) return;
    const scheduleInMs = Math.max(1000, requiredViewedPages * 1000);
    chapterViewDurationTimer = window.setTimeout(() => {
      chapterViewDurationTimer = null;
      if (!canTrackChapterView || chapterViewSent) return;
      sendChapterViewIfReady().catch(() => null);
    }, scheduleInMs);
  };

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
  let jumpToCommentsIgnoreScrollUntil = 0;
  let lastObservedScrollY = Math.round(window.scrollY || 0);

  const getLazyState = (img) =>
    (img && img.dataset && img.dataset.lazyState ? String(img.dataset.lazyState).trim() : "");

  const clearJumpToComments = () => {
    jumpToCommentsActive = false;
    jumpToCommentsStartedAt = 0;
    jumpToCommentsIgnoreScrollUntil = 0;
    if (!jumpToCommentsTimer) return;
    window.clearTimeout(jumpToCommentsTimer);
    jumpToCommentsTimer = null;
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

  const getPendingLazyCountTowardComments = () => {
    if (!orderedImages.length) return 0;
    const startIndex = Math.max(0, Math.min(orderedImages.length - 1, activePageIndex));
    let count = 0;
    for (let index = startIndex; index < orderedImages.length; index += 1) {
      const state = getLazyState(orderedImages[index]);
      if (state !== "loaded" && state !== "error") {
        count += 1;
      }
    }
    return count;
  };

  const enqueueImagesTowardComments = () => {
    if (!orderedImages.length) return;
    const startIndex = Math.max(0, Math.min(orderedImages.length - 1, activePageIndex));
    for (let index = startIndex; index < orderedImages.length; index += 1) {
      enqueueLookAheadImage(orderedImages[index]);
    }
  };

  const getCommentsTargetTop = () => {
    if (!commentsSection) return 0;
    const rect = commentsSection.getBoundingClientRect();
    const threshold = Math.max(24, window.innerHeight * 0.08);
    const pendingLazyCount = jumpToCommentsActive ? getPendingLazyCountTowardComments() : 0;
    const pendingCompensation = Math.min(2400, pendingLazyCount * 36);
    return Math.max(0, Math.round(rect.top + window.scrollY - threshold - pendingCompensation));
  };

  const performJumpToCommentsScroll = (behavior) => {
    if (!commentsSection) return;
    const targetTop = getCommentsTargetTop();
    const currentTop = Math.round(window.scrollY || 0);
    if (targetTop <= currentTop + 24) return;
    jumpToCommentsIgnoreScrollUntil = Date.now() + 260;
    window.scrollTo({ top: targetTop, behavior });
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
      const pendingLazyCount = getPendingLazyCountTowardComments();
      const commentsVisible = isElementVisible(commentsSection);
      if (pendingLazyCount === 0 && commentsVisible) {
        clearJumpToComments();
        return;
      }
      if (jumpToCommentsStartedAt && Date.now() - jumpToCommentsStartedAt >= jumpToCommentsMaxMs) {
        if (commentsVisible) {
          clearJumpToComments();
          return;
        }
      }
      enqueueImagesTowardComments();
      drainLookAheadQueue();
      if (!commentsVisible) {
        performJumpToCommentsScroll(behavior || "auto");
      }
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
    performJumpToCommentsScroll("auto");
    scheduleJumpToCommentsSync(220, "auto");
  };

  const cancelJumpOnUpwardIntent = () => {
    if (!jumpToCommentsActive) return;
    clearJumpToComments();
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
    markPageAsViewed(activePageIndex);
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

  const markVisiblePageByImage = (img) => {
    if (!img || !img.isConnected) return;
    const rect = img.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    if (!viewportHeight || !viewportWidth) return;

    const visibleTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(viewportHeight, rect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const visibleLeft = Math.max(0, rect.left);
    const visibleRight = Math.min(viewportWidth, rect.right);
    const visibleWidth = Math.max(0, visibleRight - visibleLeft);
    const imageArea = Math.max(1, rect.width * rect.height);
    const visibleArea = visibleWidth * visibleHeight;
    const visibleRatio = visibleArea / imageArea;

    if (visibleRatio >= 0.5) {
      markPageAsViewed(getPageIndexFromImage(img));
    }
  };

  const ensureImageVisible = (img) => {
    if (!img || !img.isConnected) return;

    const deferredSrc = getDeferredSrc(img);
    const hasRenderableSource = Boolean((img.currentSrc || img.src || "").toString().trim()) || Boolean(deferredSrc);
    if (!hasRenderableSource) return;

    if (img.complete && (img.naturalWidth > 0 || img.naturalHeight > 0)) {
      if (deferredSrc && !isCurrentSrcExpected(img)) {
        requestUnveil(img);
        return;
      }
      onImageLoaded(img);
      return;
    }

    const state = getLazyState(img);
    if ((state === "idle" || state === "loading") && deferredSrc) {
      requestUnveil(img);
    }
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
      markVisiblePageByImage(img);
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
      ensureImageVisible(img);
      markVisiblePageByImage(img);
    }
  });

  if (canTrackChapterView && typeof IntersectionObserver === "function") {
    const viewObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          if (Number(entry.intersectionRatio || 0) < 0.5) return;
          markPageAsViewed(getPageIndexFromImage(entry.target));
          if (chapterViewSent) {
            viewObserver.disconnect();
          }
        });
      },
      {
        root: null,
        threshold: [0.5, 0.75]
      }
    );

    orderedImages.forEach((img) => {
      viewObserver.observe(img);
    });
  }

  scheduleDurationTracking();

  const primeInitialImages = () => {
    orderedImages.slice(0, Math.min(5, orderedImages.length)).forEach((img) => {
      ensureImageVisible(img);
    });
  };

  syncActiveWindow();
  primeInitialImages();
  window.requestAnimationFrame(primeInitialImages);
  window.addEventListener("load", primeInitialImages, { once: true });
  window.addEventListener("pageshow", primeInitialImages);
  window.addEventListener(
    "scroll",
    () => {
      const currentScrollY = Math.round(window.scrollY || 0);
      const isUserScrollingUp = currentScrollY < lastObservedScrollY - 24;
      const isStrongUpwardScroll = currentScrollY < lastObservedScrollY - 120;
      const commentsVisible = isElementVisible(commentsSection);
      if (jumpToCommentsActive && isStrongUpwardScroll && !commentsVisible) {
        clearJumpToComments();
      } else if (jumpToCommentsActive && isUserScrollingUp && Date.now() > jumpToCommentsIgnoreScrollUntil) {
        clearJumpToComments();
      }
      lastObservedScrollY = currentScrollY;
      scheduleActiveWindowSync();
    },
    { passive: true }
  );
  window.addEventListener(
    "wheel",
    (event) => {
      if (!event) return;
      if (Number(event.deltaY) < -6) {
        cancelJumpOnUpwardIntent();
      }
    },
    { passive: true }
  );
  document.addEventListener("keydown", (event) => {
    if (!event) return;
    const key = (event.key || "").toString();
    if (key === "ArrowUp" || key === "PageUp" || key === "Home") {
      cancelJumpOnUpwardIntent();
    }
  });
  let touchStartY = null;
  window.addEventListener(
    "touchstart",
    (event) => {
      const touch = event && event.touches && event.touches[0];
      touchStartY = touch ? Number(touch.clientY) : null;
    },
    { passive: true }
  );
  window.addEventListener(
    "touchmove",
    (event) => {
      const touch = event && event.touches && event.touches[0];
      const currentY = touch ? Number(touch.clientY) : null;
      if (!Number.isFinite(currentY) || !Number.isFinite(touchStartY)) return;
      if (currentY - touchStartY > 10) {
        cancelJumpOnUpwardIntent();
      }
    },
    { passive: true }
  );
  window.addEventListener(
    "touchend",
    () => {
      touchStartY = null;
    },
    { passive: true }
  );
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
