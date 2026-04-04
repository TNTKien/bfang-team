const readerFloat = document.querySelector("[data-reader-float]");
const fixedNavs = Array.from(document.querySelectorAll("[data-reader-fixed]"));
const commentsSection = document.querySelector("#comments");
const quickTopButtons = Array.from(document.querySelectorAll("[data-reader-top]"));
const quickDownButtons = Array.from(document.querySelectorAll("[data-reader-down]"));
const quickCommentsButtons = Array.from(document.querySelectorAll("[data-reader-comments]"));
const reportButtons = Array.from(document.querySelectorAll("[data-reader-report]"));
const dropdowns = Array.from(document.querySelectorAll("[data-reader-dropdown]"));
const READER_JUMP_COMMENTS_EVENT = "bfang:reader-jump-comments";
const READER_CANCEL_JUMP_COMMENTS_EVENT = "bfang:reader-cancel-jump-comments";
const READER_COMMENTS_LAYOUT_EVENT = "bfang:reader-comments-layout";
const READER_LAYOUT_CHANGED_EVENT = "bfang:reader-layout-changed";
const READER_HORIZONTAL_PAGE_NAV_EVENT = "bfang:reader-horizontal-page-nav";
const READER_MODE_STORAGE_KEY = "bfang:reader-mode";
const READER_MODE_VERTICAL = "vertical";
const READER_MODE_HORIZONTAL = "horizontal";
const READER_MODE_HORIZONTAL_RTL = "horizontal-rtl";
const READER_MODE_HORIZONTAL_CLASS = "reader-reading-horizontal";
const READER_MODE_HORIZONTAL_RTL_CLASS = "reader-reading-horizontal-rtl";

const dispatchReaderToast = (message, tone = "info") => {
  const text = (message || "").toString().trim();
  if (!text) return;

  if (window.BfangToast) {
    const toastMethod = tone === "error" ? "error" : tone === "success" ? "success" : "info";
    if (typeof window.BfangToast[toastMethod] === "function") {
      window.BfangToast[toastMethod](text, { dedupe: false, duration: 3600 });
      return;
    }
  }

  if (typeof window.CustomEvent === "function") {
    window.dispatchEvent(
      new CustomEvent("bfang:toast", {
        detail: {
          message: text,
          tone,
          dedupe: false,
          duration: 3600
        }
      })
    );
  }
};

(() => {
  const dock = document.querySelector(".reader-dock");
  if (!(dock instanceof HTMLElement)) return;
  if (typeof window.matchMedia !== "function") return;

  const readerModeQuery = window.matchMedia("(min-width: 1120px)");
  const compactDockThreshold = 430;
  const ultraCompactDockThreshold = 360;
  const dockCommentsRoot = dock.querySelector(".reader-dock__comments");
  const commentTimeFullAttr = "data-reader-time-full";
  const commentTimeShortAttr = "data-reader-time-short";
  let syncingCommentTimes = false;

  const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed;
  };

  const toCompactTimeLabel = (value) => {
    const raw = (value || "").toString().trim().toLowerCase();
    if (!raw) return "";
    if (raw.includes("vừa xong") || raw.includes("mới đây") || raw.includes("just now")) {
      return "0s";
    }

    const normalized = raw.replace(/\s+trước$/i, "").trim();
    const units = [
      { pattern: /(\d+)\s*(giây|giay|second|seconds|sec|s)/i, suffix: "s" },
      { pattern: /(\d+)\s*(phút|phut|minute|minutes|min|m)/i, suffix: "m" },
      { pattern: /(\d+)\s*(giờ|gio|hour|hours|hr|h)/i, suffix: "h" },
      { pattern: /(\d+)\s*(ngày|ngay|day|days|d)/i, suffix: "d" },
      { pattern: /(\d+)\s*(tháng|thang|month|months|mo)/i, suffix: "mo" },
      { pattern: /(\d+)\s*(năm|nam|year|years|y)/i, suffix: "y" }
    ];

    for (const unit of units) {
      const match = normalized.match(unit.pattern);
      if (!match) continue;
      const numeric = Math.max(0, Math.floor(toFiniteNumber(match[1], 0)));
      return `${numeric}${unit.suffix}`;
    }

    return normalized
      .replace(/(\d+)\s*(giây|giay|second|seconds|sec|s)/gi, "$1s")
      .replace(/(\d+)\s*(phút|phut|minute|minutes|min|m)/gi, "$1m")
      .replace(/(\d+)\s*(giờ|gio|hour|hours|hr|h)/gi, "$1h")
      .replace(/(\d+)\s*(ngày|ngay|day|days|d)/gi, "$1d")
      .replace(/(\d+)\s*(tháng|thang|month|months|mo)/gi, "$1mo")
      .replace(/(\d+)\s*(năm|nam|year|years|y)/gi, "$1y")
      .replace(/\s+/g, "")
      .trim();
  };

  const syncDockCommentTimes = () => {
    if (!(dockCommentsRoot instanceof HTMLElement) || syncingCommentTimes) return;
    const timeElements = Array.from(dockCommentsRoot.querySelectorAll(".comment-time"));
    if (!timeElements.length) return;

    const useCompactLabel =
      Boolean(document.body) && document.body.classList.contains("reader-dock-compact");

    syncingCommentTimes = true;
    try {
      timeElements.forEach((element) => {
        if (!(element instanceof HTMLElement)) return;

        const currentText = (element.textContent || "").toString().trim();
        const storedFull = (element.getAttribute(commentTimeFullAttr) || "").toString().trim();
        if (!storedFull) {
          const seededFull =
            currentText || (element.getAttribute("data-time-mobile") || "").toString().trim();
          if (seededFull) {
            element.setAttribute(commentTimeFullAttr, seededFull);
          }
        }

        const fullText = (element.getAttribute(commentTimeFullAttr) || "").toString().trim() || currentText;
        const shortSeed =
          (element.getAttribute("data-time-mobile") || "").toString().trim() || fullText;
        const shortText = toCompactTimeLabel(shortSeed);
        if (shortText) {
          element.setAttribute(commentTimeShortAttr, shortText);
        }

        if (useCompactLabel) {
          const nextShort = (element.getAttribute(commentTimeShortAttr) || "").toString().trim() || shortText;
          if (nextShort && currentText !== nextShort) {
            element.textContent = nextShort;
          }
          return;
        }

        const nextFull = (element.getAttribute(commentTimeFullAttr) || "").toString().trim() || fullText;
        if (nextFull && currentText !== nextFull) {
          element.textContent = nextFull;
        }
      });
    } finally {
      syncingCommentTimes = false;
    }
  };

  const applyDockCompactClasses = (width) => {
    if (!document.body) return;
    const safeWidth = Math.max(0, Math.round(toFiniteNumber(width, 0)));
    const isDesktop = readerModeQuery.matches;
    const isCompact = isDesktop && safeWidth <= compactDockThreshold;
    const isUltraCompact = isDesktop && safeWidth <= ultraCompactDockThreshold;

    document.body.classList.toggle("reader-dock-compact", isCompact);
    document.body.classList.toggle("reader-dock-ultra-compact", isUltraCompact);
    document.body.classList.remove("reader-dock-resizing");

    if (isDesktop) {
      document.body.setAttribute("data-reader-dock-width", String(safeWidth));
    } else {
      document.body.removeAttribute("data-reader-dock-width");
    }

    document.body.style.removeProperty("--reader-dock-width");
    syncDockCommentTimes();
  };

  const getCurrentDockWidth = () => {
    const rectWidth = Math.round(toFiniteNumber(dock.getBoundingClientRect().width, 0));
    if (rectWidth > 0) return rectWidth;
    const cssWidth = Math.round(toFiniteNumber(window.getComputedStyle(dock).width, 0));
    if (cssWidth > 0) return cssWidth;
    return 0;
  };

  const syncDockWidthForViewport = () => {
    if (document.body) {
      document.body.classList.remove("reader-dock-resizing");
    }

    if (!readerModeQuery.matches) {
      if (document.body) {
        document.body.classList.remove("reader-dock-compact");
        document.body.classList.remove("reader-dock-ultra-compact");
        document.body.removeAttribute("data-reader-dock-width");
        document.body.style.removeProperty("--reader-dock-width");
      }
      syncDockCommentTimes();
      return;
    }

    applyDockCompactClasses(getCurrentDockWidth());
  };

  syncDockWidthForViewport();

  if (dockCommentsRoot instanceof HTMLElement && typeof MutationObserver === "function") {
    const timeObserver = new MutationObserver(() => {
      syncDockCommentTimes();
    });
    timeObserver.observe(dockCommentsRoot, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  window.addEventListener("resize", syncDockWidthForViewport, { passive: true });
  if (typeof readerModeQuery.addEventListener === "function") {
    readerModeQuery.addEventListener("change", syncDockWidthForViewport);
  } else if (typeof readerModeQuery.addListener === "function") {
    readerModeQuery.addListener(syncDockWidthForViewport);
  }
})();

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

(() => {
  const processingBox = document.querySelector("[data-chapter-processing-box]");
  if (!(processingBox instanceof HTMLElement)) return;
  if (typeof window.fetch !== "function") return;

  const statusUrl = (processingBox.dataset.processingStatusUrl || "").toString().trim();
  if (!statusUrl) return;

  const progressEl = processingBox.querySelector("[data-chapter-processing-progress]");
  const summaryEl = document.querySelector("[data-chapter-processing-summary]");
  const reloadEl = processingBox.querySelector("[data-chapter-processing-reload]");

  let pollingTimerId = 0;
  let polling = false;
  let stopped = false;
  let reloading = false;

  const toSafeInt = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.floor(Number(fallback) || 0));
    return Math.floor(parsed);
  };

  const toSafePercent = (value, donePages, totalPages) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(100, Math.max(0, Math.floor(parsed)));
    }
    const safeDone = toSafeInt(donePages);
    const safeTotal = toSafeInt(totalPages);
    if (safeTotal <= 0) return 0;
    return Math.min(100, Math.max(0, Math.floor((Math.min(safeDone, safeTotal) / safeTotal) * 100)));
  };

  const renderProgressText = ({ donePages, totalPages, percent }) => {
    const safeDone = toSafeInt(donePages);
    const safeTotal = toSafeInt(totalPages);
    if (safeTotal <= 0) {
      return "Hệ thống đang chuẩn hóa ảnh và đồng bộ trang đọc. Vui lòng quay lại sau ít phút.";
    }
    const safePercent = toSafePercent(percent, safeDone, safeTotal);
    return `Tiến độ hiện tại: ${Math.min(safeDone, safeTotal)}/${safeTotal} trang (${safePercent}%).`;
  };

  const renderSummaryText = ({ donePages, totalPages, percent }) => {
    const safeDone = toSafeInt(donePages);
    const safeTotal = toSafeInt(totalPages);
    if (safeTotal <= 0) {
      return "Chương đang xử lý ảnh. Vui lòng quay lại sau.";
    }
    const safePercent = toSafePercent(percent, safeDone, safeTotal);
    return `Chương đang xử lý ảnh — ${Math.min(safeDone, safeTotal)}/${safeTotal} (${safePercent}%). Vui lòng quay lại sau.`;
  };

  const setText = (element, text) => {
    if (!(element instanceof HTMLElement)) return;
    element.textContent = (text || "").toString().trim();
  };

  const stopPolling = () => {
    stopped = true;
    if (pollingTimerId) {
      window.clearTimeout(pollingTimerId);
      pollingTimerId = 0;
    }
  };

  const schedulePoll = (delayMs = 2000) => {
    if (stopped) return;
    if (pollingTimerId) {
      window.clearTimeout(pollingTimerId);
    }
    const delay = Number.isFinite(Number(delayMs)) ? Math.max(0, Math.floor(Number(delayMs))) : 2000;
    pollingTimerId = window.setTimeout(pollStatus, delay);
  };

  const setFailedState = (errorText) => {
    const safeError = (errorText || "").toString().trim();
    const failureMessage = safeError
      ? `Xử lý ảnh thất bại: ${safeError}`
      : "Xử lý ảnh thất bại. Vui lòng thử lại sau.";
    setText(progressEl, failureMessage);
    setText(summaryEl, failureMessage);
    if (reloadEl instanceof HTMLElement) {
      reloadEl.hidden = true;
      reloadEl.textContent = "";
    }
  };

  const triggerReload = () => {
    if (reloading) return;
    reloading = true;
    stopPolling();

    if (reloadEl instanceof HTMLElement) {
      reloadEl.hidden = false;
      reloadEl.textContent = "Đã xử lý xong, đang tải lại trang để hiển thị ảnh…";
    }

    window.setTimeout(() => {
      window.location.reload();
    }, 180);
  };

  async function pollStatus() {
    if (stopped || polling) return;
    polling = true;
    let shouldContinuePolling = true;

    try {
      const response = await fetch(statusUrl, {
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "same-origin"
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.ok !== true) {
        shouldContinuePolling = true;
      } else {
        const status = (data.status || "").toString().trim().toLowerCase();
        const donePages = toSafeInt(data.processingDonePages);
        const totalPages = toSafeInt(data.processingTotalPages);
        const percent = toSafePercent(data.processingPercent, donePages, totalPages);

        if (status === "processing") {
          setText(progressEl, renderProgressText({ donePages, totalPages, percent }));
          setText(summaryEl, renderSummaryText({ donePages, totalPages, percent }));
          shouldContinuePolling = true;
        } else if (status === "failed") {
          setFailedState(data.processingError || "");
          shouldContinuePolling = false;
          stopPolling();
        } else {
          setText(progressEl, renderProgressText({ donePages: totalPages || donePages, totalPages, percent: 100 }));
          setText(summaryEl, "Chương đã xử lý xong. Đang tải lại để hiển thị ảnh…");
          shouldContinuePolling = false;
          triggerReload();
        }
      }
    } catch (_err) {
      shouldContinuePolling = true;
    } finally {
      polling = false;
      if (!stopped && shouldContinuePolling) {
        schedulePoll(2000);
      }
    }
  }

  window.addEventListener("beforeunload", stopPolling, { once: true });
  schedulePoll(0);
})();

const isElementVisible = (element) => {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
};

const isElementProminentlyVisible = (element, options = {}) => {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const viewportHeight = Number(window.innerHeight) || Number(document.documentElement?.clientHeight) || 0;
  const viewportWidth = Number(window.innerWidth) || Number(document.documentElement?.clientWidth) || 0;
  if (!viewportHeight || !viewportWidth) return false;
  if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom) || !Number.isFinite(rect.height) || rect.height <= 0) {
    return false;
  }

  const visibleTop = Math.max(0, rect.top);
  const visibleBottom = Math.min(viewportHeight, rect.bottom);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  if (visibleHeight <= 0) return false;

  const minVisiblePxRaw = Number(options && options.minVisiblePx);
  const minVisiblePx = Number.isFinite(minVisiblePxRaw) ? Math.max(1, Math.floor(minVisiblePxRaw)) : 18;

  const visibleLeft = Math.max(0, rect.left);
  const visibleRight = Math.min(viewportWidth, rect.right);
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);
  const elementArea = Math.max(1, rect.width * rect.height);
  const visibleArea = visibleWidth * visibleHeight;
  const visibleRatio = visibleArea / elementArea;
  const minVisibleRatioRaw = Number(options && options.minVisibleRatio);
  const minVisibleRatio = Number.isFinite(minVisibleRatioRaw)
    ? Math.max(0.01, Math.min(1, minVisibleRatioRaw))
    : 0.28;

  return visibleHeight >= Math.min(minVisiblePx, Math.max(1, Math.floor(rect.height))) || visibleRatio >= minVisibleRatio;
};

const isCommentsVisible = () => {
  if (!commentsSection) return false;
  return isElementVisible(commentsSection);
};

const isFixedVisible = () => fixedNavs.some((element) => isElementProminentlyVisible(element, {
  minVisiblePx: 18,
  minVisibleRatio: 0.28
}));

const isMobileHorizontalReaderViewport = () =>
  Boolean(
    document.body &&
      document.body.classList.contains("reader-page--reader-mode") &&
      (document.body.classList.contains(READER_MODE_HORIZONTAL_CLASS) ||
        document.body.classList.contains(READER_MODE_HORIZONTAL_RTL_CLASS)) &&
      window.matchMedia &&
      window.matchMedia("(max-width: 1119px)").matches
  );

const syncHorizontalProgressHiddenState = () => {
  if (!document.body) return;
  if (!isMobileHorizontalReaderViewport()) {
    document.body.classList.remove("reader-horizontal-progress-hidden");
    return;
  }

  if (Date.now() < horizontalProgressForceVisibleUntil) {
    document.body.classList.remove("reader-horizontal-progress-hidden");
    return;
  }

  const floatVisible =
    readerFloat instanceof HTMLElement &&
    readerFloat.classList.contains("is-visible") &&
    isElementVisible(readerFloat);
  const fixedVisible = isFixedVisible();
  document.body.classList.toggle("reader-horizontal-progress-hidden", floatVisible || fixedVisible);
};

const scheduleHorizontalProgressHiddenStateSync = () => {
  syncHorizontalProgressHiddenState();
  window.requestAnimationFrame(syncHorizontalProgressHiddenState);
  window.setTimeout(syncHorizontalProgressHiddenState, 96);
  window.setTimeout(syncHorizontalProgressHiddenState, 240);
};

let forceShowHorizontalProgressAfterTapNavigation = false;
let horizontalProgressForceVisibleUntil = 0;

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

if (dropdowns.length) {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!target.closest("[data-reader-dropdown]")) {
      closeAllDropdowns();
    }
  });
}

if (readerFloat) {
  let lastScroll = window.scrollY;
  let ticking = false;
  const threshold = 8;
  const floatDropdown = readerFloat.querySelector("[data-reader-dropdown]");
  const isMobileReaderMode = () =>
    Boolean(
      document.body &&
        document.body.classList.contains("reader-page--reader-mode") &&
        window.matchMedia &&
        window.matchMedia("(max-width: 1119px)").matches
    );

  const setVisible = (visible) => {
    if (visible) {
      readerFloat.classList.add("is-visible");
    } else {
      readerFloat.classList.remove("is-visible");
    }
    syncHorizontalProgressHiddenState();
  };

  const updateVisibility = () => {
    const current = window.scrollY;
    const diff = current - lastScroll;
    const commentsVisible = isCommentsVisible();
    const fixedVisible = isFixedVisible();
    const floatOpen = floatDropdown && floatDropdown.classList.contains("is-open");
    const shouldHideForComments = commentsVisible && !isMobileReaderMode();

    if (shouldHideForComments || fixedVisible) {
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

    if (!shouldHideForComments && !fixedVisible && current < 120) {
      setVisible(true);
    }

    syncHorizontalProgressHiddenState();

    lastScroll = current;
    ticking = false;
  };

  window.addEventListener("scroll", () => {
    if (!ticking) {
      window.requestAnimationFrame(updateVisibility);
      ticking = true;
    }
  });

  window.addEventListener("resize", () => {
    updateVisibility();
  }, { passive: true });

  updateVisibility();
}

quickTopButtons.forEach((quickTop) => {
  quickTop.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent(READER_CANCEL_JUMP_COMMENTS_EVENT));
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

quickDownButtons.forEach((quickDown) => {
  quickDown.addEventListener("click", () => {
    const doc = document.documentElement;
    const body = document.body;
    const docHeight = doc ? Number(doc.scrollHeight) : 0;
    const bodyHeight = body ? Number(body.scrollHeight) : 0;
    const viewportHeight = Number(window.innerHeight) || 0;
    const maxTop = Math.max(0, Math.max(docHeight, bodyHeight) - Math.max(0, viewportHeight));
    window.scrollTo({ top: maxTop, behavior: "smooth" });
  });
});

quickCommentsButtons.forEach((quickComments) => {
  quickComments.addEventListener("click", () => {
    if (commentsSection) {
      window.dispatchEvent(new CustomEvent(READER_JUMP_COMMENTS_EVENT));
    }
  });
});

(() => {
  const reportModal = document.querySelector("[data-reader-report-modal]");
  if (!(reportModal instanceof HTMLElement)) return;

  const closeButtons = Array.from(reportModal.querySelectorAll("[data-reader-report-close]"));
  const reasonButtons = Array.from(reportModal.querySelectorAll("[data-reader-report-reason]"));
  const noteInput = reportModal.querySelector("[data-reader-report-note]");
  const submitButton = reportModal.querySelector("[data-reader-report-submit]");
  const feedback = reportModal.querySelector("[data-reader-report-feedback]");
  const submitUrl = (reportModal.dataset.readerReportSubmitUrl || "").toString().trim();
  const body = document.body;
  let selectedReason = "";
  let submitting = false;

  const setFeedback = (message, tone = "") => {
    if (!(feedback instanceof HTMLElement)) return;
    feedback.textContent = (message || "").toString().trim();
    feedback.dataset.tone = tone;
  };

  const setOpen = (open) => {
    if (open) {
      reportModal.hidden = false;
      reportModal.classList.add("is-open");
      body.classList.add("reader-report-open");
    } else {
      reportModal.classList.remove("is-open");
      reportModal.hidden = true;
      body.classList.remove("reader-report-open");
      setSelectedReason("");
      if (noteInput instanceof HTMLTextAreaElement) {
        noteInput.value = "";
      }
      submitting = false;
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
        submitButton.textContent = "Gửi báo lỗi";
      }
      setFeedback("");
    }
  };

  const setSelectedReason = (reason) => {
    selectedReason = (reason || "").toString().trim();
    reasonButtons.forEach((button) => {
      const buttonReason = (button.dataset.readerReportReason || "").toString().trim();
      const isActive = Boolean(selectedReason) && buttonReason === selectedReason;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  };

  reportButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setOpen(true);
    });
  });

  closeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setOpen(false);
    });
  });

  reasonButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (submitting) return;
      setSelectedReason(button.dataset.readerReportReason || "");
      setFeedback("");
    });
  });

  if (submitButton instanceof HTMLButtonElement) {
    submitButton.addEventListener("click", async () => {
      if (submitting) return;
      if (!selectedReason) {
        setFeedback("Vui lòng chọn lý do báo lỗi.", "error");
        dispatchReaderToast("Vui lòng chọn lý do báo lỗi.", "error");
        return;
      }

      if (!submitUrl) {
        setFeedback("Không thể gửi báo lỗi lúc này. Vui lòng thử lại sau.", "error");
        dispatchReaderToast("Không thể gửi báo lỗi lúc này. Vui lòng thử lại sau.", "error");
        return;
      }

      const note = noteInput instanceof HTMLTextAreaElement ? String(noteInput.value || "").trim() : "";

      submitting = true;
      submitButton.disabled = true;
      submitButton.textContent = "Đang gửi...";
      setFeedback("");

      try {
        const response = await fetch(submitUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest"
          },
          credentials: "same-origin",
          body: JSON.stringify({
            reason: selectedReason,
            note
          })
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || payload.ok !== true) {
          const errorMessage = payload && payload.error
            ? String(payload.error)
            : "Không thể gửi báo lỗi lúc này. Vui lòng thử lại.";
          setFeedback(errorMessage, "error");
          dispatchReaderToast(errorMessage, "error");
          return;
        }

        setFeedback("Đã gửi báo lỗi. Cảm ơn bạn!", "success");
        dispatchReaderToast("Đã gửi báo lỗi. Cảm ơn bạn!", "success");
        window.setTimeout(() => {
          setOpen(false);
        }, 320);
      } catch (_error) {
        const message = "Không thể gửi báo lỗi lúc này. Vui lòng thử lại.";
        setFeedback(message, "error");
        dispatchReaderToast(message, "error");
      } finally {
        submitting = false;
        if (submitButton instanceof HTMLButtonElement && reportModal.classList.contains("is-open")) {
          submitButton.disabled = false;
          submitButton.textContent = "Gửi báo lỗi";
        }
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!reportModal.classList.contains("is-open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  });
})();

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

  const isHorizontalReaderMode = () =>
    Boolean(
      document.body &&
        (document.body.classList.contains(READER_MODE_HORIZONTAL_CLASS) ||
          document.body.classList.contains(READER_MODE_HORIZONTAL_RTL_CLASS))
    );

  const isHorizontalRtlReaderMode = () =>
    Boolean(document.body && document.body.classList.contains(READER_MODE_HORIZONTAL_RTL_CLASS));

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (isTextEditingContext()) return;

    const key = (event.key || "").toString();
    let targetHref = "";

    if (key === "ArrowRight") {
      if (isHorizontalReaderMode()) {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent(READER_HORIZONTAL_PAGE_NAV_EVENT, {
            detail: { direction: isHorizontalRtlReaderMode() ? -1 : 1 }
          })
        );
        return;
      }
      targetHref = nextLink ? (nextLink.getAttribute("href") || "").toString().trim() : "";
    } else if (key === "ArrowLeft") {
      if (isHorizontalReaderMode()) {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent(READER_HORIZONTAL_PAGE_NAV_EVENT, {
            detail: { direction: isHorizontalRtlReaderMode() ? 1 : -1 }
          })
        );
        return;
      }
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
  const totalPagesFromDataset = Number.isFinite(totalPagesRaw) && totalPagesRaw > 0
    ? Math.floor(totalPagesRaw)
    : 0;
  const totalPages = orderedImages.length > 0 ? orderedImages.length : totalPagesFromDataset;
  const pageCurrentIndicators = Array.from(document.querySelectorAll("[data-reader-page-current]"));
  const pageTotalIndicators = Array.from(document.querySelectorAll("[data-reader-page-total]"));
  const pageFirstButtons = Array.from(document.querySelectorAll("[data-reader-page-first]"));
  const pagePrevButtons = Array.from(document.querySelectorAll("[data-reader-page-prev]"));
  const pageNextButtons = Array.from(document.querySelectorAll("[data-reader-page-next]"));
  const pageLastButtons = Array.from(document.querySelectorAll("[data-reader-page-last]"));
  const pageOptionButtons = Array.from(document.querySelectorAll("[data-reader-page-index]"));
  const modeOptionButtons = Array.from(document.querySelectorAll("[data-reader-mode-option]"));
  const modeToggleButtons = Array.from(document.querySelectorAll("[data-reader-mode-toggle]"));
  const chapterBridge = pagesRoot.querySelector("[data-reader-chapter-bridge]");
  const hasChapterBridge = chapterBridge instanceof HTMLElement;
  const totalReaderSlides = orderedImages.length + (hasChapterBridge ? 1 : 0);

  const normalizeReaderMode = (value) => {
    const normalized = (value || "").toString().trim().toLowerCase();
    if (normalized === READER_MODE_HORIZONTAL) return READER_MODE_HORIZONTAL;
    if (normalized === READER_MODE_HORIZONTAL_RTL) return READER_MODE_HORIZONTAL_RTL;
    return READER_MODE_VERTICAL;
  };

  const readStoredReaderMode = () => {
    try {
      const rawMode = window.localStorage.getItem(READER_MODE_STORAGE_KEY);
      const normalizedMode = normalizeReaderMode(rawMode);
      if (rawMode !== normalizedMode) {
        window.localStorage.setItem(READER_MODE_STORAGE_KEY, normalizedMode);
      }
      return normalizedMode;
    } catch (_err) {
      return READER_MODE_VERTICAL;
    }
  };

  let readerMode = readStoredReaderMode();
  const isHorizontalReaderModeActive = () =>
    readerMode === READER_MODE_HORIZONTAL || readerMode === READER_MODE_HORIZONTAL_RTL;
  const isHorizontalRtlReaderModeActive = () => readerMode === READER_MODE_HORIZONTAL_RTL;

  const getModeToggleMeta = (mode) => {
    if (mode === READER_MODE_HORIZONTAL) {
      return {
        label: "Ngang T→P",
        ariaLabel: "Chế độ đọc ngang trái sang phải, bấm để chuyển đọc ngang phải sang trái",
        title: "Chế độ đọc ngang trái sang phải, bấm để chuyển đọc ngang phải sang trái",
        ariaPressed: "true"
      };
    }
    if (mode === READER_MODE_HORIZONTAL_RTL) {
      return {
        label: "Ngang P→T",
        ariaLabel: "Chế độ đọc ngang phải sang trái, bấm để chuyển đọc dọc",
        title: "Chế độ đọc ngang phải sang trái, bấm để chuyển đọc dọc",
        ariaPressed: "true"
      };
    }
    return {
      label: "Dọc",
      ariaLabel: "Chế độ đọc dọc, bấm để chuyển đọc ngang trái sang phải",
      title: "Chế độ đọc dọc, bấm để chuyển đọc ngang trái sang phải",
      ariaPressed: "false"
    };
  };

  const persistReaderMode = (mode) => {
    try {
      window.localStorage.setItem(READER_MODE_STORAGE_KEY, mode);
    } catch (_err) {
      // Ignore storage failures.
    }
  };

  const applyReaderModeStateToDom = () => {
    const horizontal = isHorizontalReaderModeActive();
    const horizontalRtl = isHorizontalRtlReaderModeActive();
    const currentMode = horizontalRtl
      ? READER_MODE_HORIZONTAL_RTL
      : horizontal
        ? READER_MODE_HORIZONTAL
        : READER_MODE_VERTICAL;
    const toggleMeta = getModeToggleMeta(currentMode);
    if (document.body) {
      document.body.classList.toggle(READER_MODE_HORIZONTAL_CLASS, horizontal);
      document.body.classList.toggle(READER_MODE_HORIZONTAL_RTL_CLASS, horizontalRtl);
      document.body.dataset.readerMode = currentMode;
    }
    pagesRoot.dataset.readerMode = currentMode;
    if (horizontal) {
      pagesRoot.style.flexDirection = "row";
    } else {
      pagesRoot.style.removeProperty("flex-direction");
    }

    modeOptionButtons.forEach((button) => {
      const optionMode = normalizeReaderMode(button.dataset.readerModeOption || "");
      const isActive = optionMode === currentMode;
      button.dataset.readerMode = currentMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    modeToggleButtons.forEach((button) => {
      const label = button.querySelector("[data-reader-mode-label]");
      if (label) {
        label.textContent = toggleMeta.label;
      }

      button.dataset.readerMode = currentMode;
      button.setAttribute("aria-pressed", toggleMeta.ariaPressed);
      button.setAttribute("aria-label", toggleMeta.ariaLabel);
      button.setAttribute("title", toggleMeta.title);
    });
  };

  applyReaderModeStateToDom();

  const resolveSlideElementByIndex = (index) => {
    const safeIndex = Math.floor(Number(index) || 0);
    if (hasChapterBridge && safeIndex === orderedImages.length) {
      return chapterBridge;
    }
    return orderedImages[safeIndex] || null;
  };

  const clampPageIndex = (value) => {
    if (!totalReaderSlides) return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(totalReaderSlides - 1, Math.floor(parsed)));
  };

  const setNavButtonState = (button, disabled) => {
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = disabled;
    button.classList.toggle("is-disabled", disabled);
  };

  const updatePageNavButtons = (pageIndex) => {
    const hasPages = totalReaderSlides > 0;
    const safeIndex = clampPageIndex(pageIndex);
    const atFirst = safeIndex <= 0;
    const atLast = safeIndex >= Math.max(0, totalReaderSlides - 1);

    pageFirstButtons.forEach((button) => {
      setNavButtonState(button, !hasPages || atFirst);
    });
    pagePrevButtons.forEach((button) => {
      setNavButtonState(button, !hasPages || atFirst);
    });
    pageNextButtons.forEach((button) => {
      setNavButtonState(button, !hasPages || atLast);
    });
    pageLastButtons.forEach((button) => {
      setNavButtonState(button, !hasPages || atLast);
    });

    pageOptionButtons.forEach((button) => {
      if (!button) return;
      const optionIndex = Number(button.dataset.readerPageIndex);
      const isActive = Number.isFinite(optionIndex) && Math.floor(optionIndex) === safeIndex;
      button.classList.toggle("is-active", isActive);
      if (isActive) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    });
  };

  let horizontalScrollFrame = 0;

  const isMobileHorizontalReaderModeActive = () =>
    Boolean(
      isHorizontalReaderModeActive() &&
        window.matchMedia &&
        window.matchMedia("(max-width: 1119px)").matches
    );

  const getWindowScrollTop = () => {
    const windowTop = Number(window.scrollY);
    if (Number.isFinite(windowTop)) {
      return Math.max(0, windowTop);
    }

    const pageTop = Number(window.pageYOffset);
    if (Number.isFinite(pageTop)) {
      return Math.max(0, pageTop);
    }

    const doc = document.documentElement;
    const body = document.body;
    const docTop = doc ? Number(doc.scrollTop) || 0 : 0;
    const bodyTop = body ? Number(body.scrollTop) || 0 : 0;
    return Math.max(0, docTop, bodyTop);
  };

  const recenterMobileHorizontalViewport = () => {
    if (!isMobileHorizontalReaderModeActive()) return;
    if (!pagesRoot || !pagesRoot.isConnected) return;

    const viewportHeight = Number(window.innerHeight) || Number(document.documentElement?.clientHeight) || 0;
    if (!viewportHeight) return;

    const rootRect = pagesRoot.getBoundingClientRect();
    if (!rootRect || !Number.isFinite(rootRect.top) || !Number.isFinite(rootRect.height) || rootRect.height <= 0) {
      return;
    }

    const currentCenter = rootRect.top + rootRect.height * 0.5;
    const targetCenter = viewportHeight * 0.5;
    const delta = currentCenter - targetCenter;
    if (Math.abs(delta) < 1) return;

    const currentTop = getWindowScrollTop();
    const nextTop = Math.max(0, Math.round(currentTop + delta));
    if (Math.abs(nextTop - currentTop) < 1) return;

    window.scrollTo({ top: nextTop, behavior: "auto" });
  };

  const stopHorizontalScrollAnimation = () => {
    if (horizontalScrollFrame) {
      window.cancelAnimationFrame(horizontalScrollFrame);
      horizontalScrollFrame = 0;
    }
    pagesRoot.classList.remove("is-programmatic-scroll");
  };

  const animateHorizontalScrollTo = (targetLeft, durationMs) => {
    const startLeft = Math.max(0, Number(pagesRoot.scrollLeft) || 0);
    const destination = Math.max(0, Number(targetLeft) || 0);
    if (Math.abs(destination - startLeft) < 1) {
      pagesRoot.scrollLeft = destination;
      return;
    }

    const duration = Number.isFinite(Number(durationMs))
      ? Math.max(80, Math.min(220, Math.floor(Number(durationMs))))
      : 150;

    stopHorizontalScrollAnimation();
    pagesRoot.classList.add("is-programmatic-scroll");
    const startedAt = performance.now();

    const tick = (now) => {
      const elapsed = Math.max(0, now - startedAt);
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextLeft = startLeft + (destination - startLeft) * eased;
      pagesRoot.scrollLeft = nextLeft;

      if (progress < 1) {
        horizontalScrollFrame = window.requestAnimationFrame(tick);
      } else {
        pagesRoot.scrollLeft = destination;
        horizontalScrollFrame = 0;
        pagesRoot.classList.remove("is-programmatic-scroll");
      }
    };

    horizontalScrollFrame = window.requestAnimationFrame(tick);
  };

  const enforceHorizontalScrollLeft = (targetLeft, maxAttempts = 4) => {
    const expected = Math.max(0, Math.round(Number(targetLeft) || 0));
    const attemptsLimit = Math.max(1, Math.floor(Number(maxAttempts) || 1));
    let attempts = 0;

    const apply = () => {
      const current = Math.max(0, Number(pagesRoot.scrollLeft) || 0);
      if (Math.abs(current - expected) <= 1) return;
      pagesRoot.scrollLeft = expected;
      attempts += 1;
      if (attempts < attemptsLimit) {
        window.requestAnimationFrame(apply);
      }
    };

    window.requestAnimationFrame(apply);
  };

  const scrollToPageIndex = (targetIndex, behavior = "smooth") => {
    if (!totalReaderSlides) return;
    const safeIndex = clampPageIndex(targetIndex);
    const targetElement = resolveSlideElementByIndex(safeIndex);
    if (!targetElement || !targetElement.isConnected) return;
    const targetImage = targetElement instanceof HTMLImageElement
      ? targetElement
      : targetElement.querySelector(".page-media--lazy");

    activePageIndex = safeIndex;
    updatePageIndicators(activePageIndex);
    if (safeIndex < orderedImages.length) {
      markPageAsViewed(activePageIndex);
      queueLookAround(activePageIndex);
      if (targetImage instanceof HTMLImageElement) {
        ensureImageVisible(targetImage);
      }
    } else if (orderedImages.length) {
      markPageAsViewed(orderedImages.length - 1);
      queueLookAround(orderedImages.length - 1);
    }

    if (isHorizontalReaderModeActive()) {
      if (forceShowHorizontalProgressAfterTapNavigation) {
        horizontalProgressForceVisibleUntil = Date.now() + 420;
        forceShowHorizontalProgressAfterTapNavigation = false;
        if (document.body) {
          document.body.classList.remove("reader-horizontal-progress-hidden");
        }
      }

      const targetMetrics = getHorizontalTargetMetrics(targetElement);
      const rawTargetLeft = targetMetrics.start;
      const maxScrollLeft = getMaxHorizontalScrollLeft();
      const targetLeft = Math.max(0, Math.min(maxScrollLeft, Math.round(rawTargetLeft)));
      const targetDeferredSrc = targetImage instanceof HTMLImageElement ? getDeferredSrc(targetImage) : "";
      const targetLazyState = targetImage instanceof HTMLImageElement ? getLazyState(targetImage) : "loaded";
      const targetReady = !targetDeferredSrc || targetLazyState === "loaded";
      const smoothNavigation = behavior === "smooth" && targetReady;
      window.dispatchEvent(new CustomEvent(READER_CANCEL_JUMP_COMMENTS_EVENT));
      closeAllDropdowns();

      if (isMobileHorizontalReaderModeActive()) {
        clearHorizontalPullResistance(false);
        recenterMobileHorizontalViewport();
        scheduleHorizontalProgressHiddenStateSync();
      }

      if (smoothNavigation) {
        const isMobileViewport = isMobileHorizontalReaderModeActive();
        animateHorizontalScrollTo(targetLeft, isMobileViewport ? 112 : 126);
      } else {
        stopHorizontalScrollAnimation();
        pagesRoot.scrollLeft = targetLeft;
      }

      window.setTimeout(() => {
        enforceHorizontalScrollLeft(targetLeft, smoothNavigation ? 6 : 4);
      }, smoothNavigation ? 130 : 24);

      if (isMobileHorizontalReaderModeActive()) {
        window.requestAnimationFrame(() => {
          recenterMobileHorizontalViewport();
          scheduleHorizontalProgressHiddenStateSync();
        });
      }

      window.setTimeout(() => {
        if (isMobileHorizontalReaderModeActive()) {
          recenterMobileHorizontalViewport();
          scheduleHorizontalProgressHiddenStateSync();
        }
        scheduleActiveWindowSync();
      }, smoothNavigation ? 230 : 70);
      return;
    }

    forceShowHorizontalProgressAfterTapNavigation = false;

    const targetTop = Math.max(0, Math.round(window.scrollY + targetElement.getBoundingClientRect().top - 12));
    window.dispatchEvent(new CustomEvent(READER_CANCEL_JUMP_COMMENTS_EVENT));
    closeAllDropdowns();
    window.scrollTo({ top: targetTop, behavior });

    window.setTimeout(() => {
      scheduleActiveWindowSync();
    }, 260);
  };

  pageFirstButtons.forEach((button) => {
    button.addEventListener("click", () => {
      scrollToPageIndex(0);
    });
  });

  pagePrevButtons.forEach((button) => {
    button.addEventListener("click", () => {
      scrollToPageIndex(activePageIndex - 1);
    });
  });

  pageNextButtons.forEach((button) => {
    button.addEventListener("click", () => {
      scrollToPageIndex(activePageIndex + 1);
    });
  });

  pageLastButtons.forEach((button) => {
    button.addEventListener("click", () => {
      scrollToPageIndex(totalReaderSlides - 1);
    });
  });

  pageOptionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const optionIndex = Number(button.dataset.readerPageIndex);
      if (!Number.isFinite(optionIndex)) return;
      scrollToPageIndex(optionIndex);
    });
  });

  const updatePageIndicators = (pageIndex) => {
    const safeTotal = Math.max(1, totalPages || orderedImages.length || 1);
    const safeCurrentIndex = Number.isFinite(Number(pageIndex)) ? Math.floor(Number(pageIndex)) : 0;
    const navIndex = clampPageIndex(safeCurrentIndex);
    const safeCurrent = navIndex >= orderedImages.length
      ? safeTotal
      : Math.min(safeTotal, Math.max(1, navIndex + 1));

    pageCurrentIndicators.forEach((element) => {
      if (element) {
        element.textContent = String(safeCurrent);
      }
    });

    pageTotalIndicators.forEach((element) => {
      if (element) {
        element.textContent = String(safeTotal);
      }
    });

    if (isHorizontalReaderModeActive() && totalReaderSlides > 0) {
      const activeElement = resolveSlideElementByIndex(navIndex);
      if (activeElement && activeElement.isConnected) {
        const targetMetrics = getHorizontalTargetMetrics(activeElement);
        const maxScrollLeft = getMaxHorizontalScrollLeft();
        const targetLeft = Math.max(0, Math.min(maxScrollLeft, Math.round(targetMetrics.start)));
        const currentLeft = Math.max(0, Number(pagesRoot.scrollLeft) || 0);
        if (Math.abs(currentLeft - targetLeft) > 1) {
          pagesRoot.scrollLeft = targetLeft;
        }
      }
    }

    updatePageNavButtons(navIndex);
  };
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
  const getPageCard = (img) => (img && img.closest ? img.closest(".page-card") : null);

  const getHorizontalScrollTarget = (img) => getPageCard(img) || getPageFrame(img) || img;

  const getHorizontalTargetMetrics = (img) => {
    const target = getHorizontalScrollTarget(img);
    if (!target || !target.isConnected) {
      return { start: 0, width: 0 };
    }

    const offsetStart = Number(target.offsetLeft);
    const start = Number.isFinite(offsetStart)
      ? Math.max(0, Math.round(offsetStart))
      : 0;
    const width = Math.max(1, Math.round(Number(target.offsetWidth) || Number(target.getBoundingClientRect().width) || 0));
    return { start, width };
  };

  const getPositiveDimension = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.round(numeric);
  };

  const clearReaderImageSize = (img) => {
    if (!img || !(img instanceof HTMLElement)) return;
    img.style.width = "";
    img.style.height = "";
    img.style.maxWidth = "";
    img.style.maxHeight = "";
  };

  const applyHorizontalImageSize = (img) => {
    if (!img || !img.isConnected) return;

    if (!isHorizontalReaderModeActive()) {
      clearReaderImageSize(img);
      return;
    }

    const lazyState = getLazyState(img);
    if (lazyState !== "loaded" && getDeferredSrc(img)) {
      clearReaderImageSize(img);
      return;
    }

    const naturalWidth = getPositiveDimension(img.naturalWidth);
    const naturalHeight = getPositiveDimension(img.naturalHeight);
    if (!naturalWidth || !naturalHeight) {
      clearReaderImageSize(img);
      return;
    }

    const rootRect = pagesRoot.getBoundingClientRect();
    const viewportWidth = Math.max(1, getPositiveDimension(rootRect.width) || getPositiveDimension(window.innerWidth));
    const viewportHeight = Math.max(1, getPositiveDimension(window.innerHeight) || getPositiveDimension(rootRect.height));

    let targetHeight = Math.min(naturalHeight, viewportHeight);
    let targetWidth = Math.round((naturalWidth * targetHeight) / naturalHeight);

    if (targetWidth > viewportWidth) {
      targetWidth = Math.min(viewportWidth, naturalWidth);
      targetHeight = Math.round((naturalHeight * targetWidth) / naturalWidth);
    }

    targetWidth = Math.max(1, Math.min(targetWidth, naturalWidth));
    targetHeight = Math.max(1, Math.min(targetHeight, naturalHeight));

    img.style.width = `${targetWidth}px`;
    img.style.height = `${targetHeight}px`;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
  };

  const applyReaderModeImageSizing = () => {
    orderedImages.forEach((img) => {
      applyHorizontalImageSize(img);
    });
  };

  const applyPageFrameWidth = (img) => {
    if (!img || !img.isConnected) return;

    const frame = getPageFrame(img);
    if (!frame) return;

    if (isHorizontalReaderModeActive()) {
      frame.style.removeProperty("--page-frame-width");
      frame.style.removeProperty("--page-desktop-max-viewport");
      pagesRoot.style.removeProperty("--reader-page-width");
      pagesRoot.style.removeProperty("--reader-page-desktop-max-viewport");
      return;
    }

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
  const loadingStallMs = saveData ? 22000 : 14000;
  const jumpToCommentsMaxMs = saveData ? 24000 : 16000;

  let activePageIndex = 0;
  let syncTicking = false;
  let lookAheadTimer = null;
  let triggerNextChapterPrefetch = () => {};

  const lookAheadQueue = [];
  const lookAheadQueuedSet = new Set();
  const lazyLoadingStartedAtMap = new WeakMap();
  const lazyWatchdogTimerMap = new WeakMap();
  let jumpToCommentsActive = false;
  let jumpToCommentsTimer = null;
  let jumpToCommentsStartedAt = 0;
  let jumpToCommentsIgnoreScrollUntil = 0;
  let lastObservedScrollY = Math.round(window.scrollY || 0);

  const getLazyState = (img) =>
    (img && img.dataset && img.dataset.lazyState ? String(img.dataset.lazyState).trim() : "");

  const clearLazyWatchdog = (img) => {
    if (!img) return;
    const timerId = lazyWatchdogTimerMap.get(img);
    if (Number.isFinite(Number(timerId)) && Number(timerId) > 0) {
      window.clearTimeout(Number(timerId));
    }
    lazyWatchdogTimerMap.delete(img);
    lazyLoadingStartedAtMap.delete(img);
  };

  const scheduleLazyWatchdog = (img) => {
    if (!img) return;
    clearLazyWatchdog(img);
    lazyLoadingStartedAtMap.set(img, Date.now());

    const timerId = window.setTimeout(() => {
      lazyWatchdogTimerMap.delete(img);
      if (!img.isConnected) return;
      if (getLazyState(img) !== "loading") return;
      retryLazyImage(img, { immediate: true });
    }, loadingStallMs);

    lazyWatchdogTimerMap.set(img, timerId);
  };

  const rescueStalledLoadingImages = () => {
    const now = Date.now();

    lazyImages.forEach((img) => {
      if (!img || !img.isConnected) return;
      if (getLazyState(img) !== "loading") return;

      const startedAt = Number(lazyLoadingStartedAtMap.get(img));
      if (!Number.isFinite(startedAt) || startedAt <= 0) {
        scheduleLazyWatchdog(img);
        return;
      }

      if (now - startedAt < loadingStallMs) return;
      retryLazyImage(img, { immediate: true });
    });
  };

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
    clearLazyWatchdog(img);
    img.dataset.lazyState = "loaded";
    img.classList.remove("is-placeholder", "is-error", "lazyerror", "lazyload", "lazyloaded");
    img.classList.add("is-loaded");
  };

  const markError = (img) => {
    clearLazyWatchdog(img);
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
    scheduleLazyWatchdog(img);
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

    rescueStalledLoadingImages();

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
    if (!totalReaderSlides) return 0;

    if (isHorizontalReaderModeActive()) {
      const currentScrollLeft = Math.max(0, Number(pagesRoot.scrollLeft) || 0);
      const viewportWidth = Math.max(1, Number(pagesRoot.clientWidth) || Number(window.innerWidth) || 0);
      const focusLine = currentScrollLeft + viewportWidth * 0.5;

      for (let index = 0; index < orderedImages.length; index += 1) {
        const targetMetrics = getHorizontalTargetMetrics(orderedImages[index]);
        const start = targetMetrics.start;
        const width = targetMetrics.width;
        const end = start + width;
        if (start <= focusLine && end >= focusLine) {
          return index;
        }
      }

      for (let index = 0; index < orderedImages.length; index += 1) {
        const targetMetrics = getHorizontalTargetMetrics(orderedImages[index]);
        const end = targetMetrics.start + targetMetrics.width;
        if (end > currentScrollLeft) {
          return index;
        }
      }

      if (hasChapterBridge && chapterBridge && chapterBridge.isConnected) {
        const targetMetrics = getHorizontalTargetMetrics(chapterBridge);
        const start = targetMetrics.start;
        const end = targetMetrics.start + targetMetrics.width;
        if (start <= focusLine && end >= focusLine) {
          return orderedImages.length;
        }
        if (currentScrollLeft >= Math.max(0, start - 2)) {
          return orderedImages.length;
        }
      }

      return orderedImages.length - 1;
    }

    const viewportHeight = window.innerHeight || 0;
    if (!viewportHeight) return activePageIndex;

    const focusLine = viewportHeight * 0.38;
    for (let index = 0; index < orderedImages.length; index += 1) {
      const rect = orderedImages[index].getBoundingClientRect();
      if (rect.top <= focusLine && rect.bottom >= focusLine) {
        return index;
      }
    }

    if (hasChapterBridge && chapterBridge && chapterBridge.isConnected) {
      const bridgeRect = chapterBridge.getBoundingClientRect();
      if (bridgeRect.top <= focusLine && bridgeRect.bottom >= focusLine) {
        return orderedImages.length;
      }
    }

    for (let index = 0; index < orderedImages.length; index += 1) {
      const rect = orderedImages[index].getBoundingClientRect();
      if (rect.bottom > 0) {
        return index;
      }
    }

    if (hasChapterBridge && chapterBridge && chapterBridge.isConnected) {
      const bridgeRect = chapterBridge.getBoundingClientRect();
      if (bridgeRect.bottom > 0) {
        return orderedImages.length;
      }
    }

    return orderedImages.length - 1;
  };

  const syncActiveWindow = () => {
    activePageIndex = resolveActivePageIndex();
    updatePageIndicators(activePageIndex);
    const viewTrackingIndex = orderedImages.length
      ? Math.max(0, Math.min(orderedImages.length - 1, activePageIndex))
      : 0;
    markPageAsViewed(viewTrackingIndex);
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
    let finalized = false;
    const runSync = () => {
      if (finalized) return;
      finalized = true;
      syncTicking = false;
      syncActiveWindow();
    };

    window.requestAnimationFrame(runSync);
    window.setTimeout(runSync, 260);
  };

  const setReaderMode = (nextMode, options = {}) => {
    const normalizedMode = normalizeReaderMode(nextMode);
    const shouldPersist = !options || options.persist !== false;
    const behavior = options && options.behavior ? String(options.behavior) : "auto";

    readerMode = normalizedMode;
    applyReaderModeStateToDom();
    if (shouldPersist) {
      persistReaderMode(readerMode);
    }

    applyReaderModeImageSizing();
    if (isHorizontalReaderModeActive()) {
      scrollToPageIndex(activePageIndex, behavior === "smooth" ? "smooth" : "auto");
    } else {
      clearHorizontalPullResistance(false);
      scheduleActiveWindowSync();
    }
  };

  modeOptionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextMode = normalizeReaderMode(button.dataset.readerModeOption || "");
      if (nextMode === readerMode) return;
      setReaderMode(nextMode, { persist: true, behavior: "auto" });
    });
  });

  modeToggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextMode = (() => {
        if (readerMode === READER_MODE_VERTICAL) return READER_MODE_HORIZONTAL;
        if (readerMode === READER_MODE_HORIZONTAL) return READER_MODE_HORIZONTAL_RTL;
        return READER_MODE_VERTICAL;
      })();
      setReaderMode(nextMode, { persist: true, behavior: "auto" });
    });
  });

  window.addEventListener(READER_HORIZONTAL_PAGE_NAV_EVENT, (event) => {
    if (!isHorizontalReaderModeActive()) return;
    const detail = event && event.detail && typeof event.detail === "object" ? event.detail : null;
    const directionRaw = Number(detail && detail.direction);
    const direction = directionRaw > 0 ? 1 : directionRaw < 0 ? -1 : 0;
    if (!direction) return;
    scrollToPageIndex(activePageIndex + direction);
  });

  window.addEventListener(READER_LAYOUT_CHANGED_EVENT, () => {
    applyReaderModeImageSizing();
    if (isHorizontalReaderModeActive()) {
      scrollToPageIndex(activePageIndex, "auto");
      return;
    }
    scheduleActiveWindowSync();
  });

  const isInteractiveTarget = (target) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        "a,button,input,textarea,select,label,[role='button'],[contenteditable='true'],[data-reader-option],[data-reader-report-submit],[data-reader-report-close],[data-reader-report-reason]"
      )
    );
  };

  const getClientX = (event) => {
    if (!event) return NaN;
    const touch = event.changedTouches && event.changedTouches[0];
    if (touch && Number.isFinite(Number(touch.clientX))) {
      return Number(touch.clientX);
    }
    if (Number.isFinite(Number(event.clientX))) {
      return Number(event.clientX);
    }
    return NaN;
  };

  let suppressClickUntil = 0;
  let pointerTracking = false;
  let pointerMoved = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerStartAt = 0;
  let pointerType = "";
  let touchTracking = false;
  let swipeStartX = 0;
  let swipeStartY = 0;
  let touchMoved = false;
  let touchStartAt = 0;
  let touchSuppressTapClick = false;
  let skipHalfClickForErrorRetry = false;
  let horizontalPullResetTimer = 0;

  const HORIZONTAL_POINTER_DRAG_THRESHOLD = 8;
  const HORIZONTAL_TAP_DEAD_MOVEMENT = 6;
  const HORIZONTAL_SWIPE_MIN_DISTANCE = 74;
  const HORIZONTAL_SWIPE_INTENT_RATIO = 1.28;
  const HORIZONTAL_SWIPE_MAX_DURATION = 760;
  const HORIZONTAL_PULL_RESIST_FACTOR = 0.18;
  const HORIZONTAL_PULL_RESIST_MAX = 18;

  const getMaxHorizontalScrollLeft = () => {
    const scrollWidth = Math.max(0, Number(pagesRoot.scrollWidth) || 0);
    const clientWidth = Math.max(0, Number(pagesRoot.clientWidth) || 0);
    return Math.max(0, Math.round(scrollWidth - clientWidth));
  };

  const resolveHorizontalStepFromGesture = (deltaX) => {
    const ltrStep = deltaX < 0 ? 1 : -1;
    return isHorizontalRtlReaderModeActive() ? -ltrStep : ltrStep;
  };

  const isAtHorizontalReaderStart = () => {
    const currentLeft = Math.max(0, Number(pagesRoot.scrollLeft) || 0);
    return activePageIndex <= 0 && currentLeft <= 8;
  };

  const clearHorizontalPullResistance = (animate = true) => {
    if (horizontalPullResetTimer) {
      window.clearTimeout(horizontalPullResetTimer);
      horizontalPullResetTimer = 0;
    }

    if (!pagesRoot.classList.contains("is-pull-resist") && !pagesRoot.style.getPropertyValue("--reader-horizontal-pull-offset")) {
      pagesRoot.style.removeProperty("transition");
      return;
    }

    if (!animate) {
      pagesRoot.classList.remove("is-pull-resist");
      pagesRoot.style.removeProperty("--reader-horizontal-pull-offset");
      pagesRoot.style.removeProperty("transition");
      return;
    }

    pagesRoot.classList.add("is-pull-resist");
    pagesRoot.style.transition = "transform 180ms ease-out";
    pagesRoot.style.setProperty("--reader-horizontal-pull-offset", "0px");
    horizontalPullResetTimer = window.setTimeout(() => {
      pagesRoot.classList.remove("is-pull-resist");
      pagesRoot.style.removeProperty("--reader-horizontal-pull-offset");
      pagesRoot.style.removeProperty("transition");
      horizontalPullResetTimer = 0;
    }, 190);
  };

  const applyHorizontalPullResistance = (offsetPx) => {
    if (!Number.isFinite(offsetPx) || offsetPx <= 0) {
      clearHorizontalPullResistance(false);
      return;
    }

    if (horizontalPullResetTimer) {
      window.clearTimeout(horizontalPullResetTimer);
      horizontalPullResetTimer = 0;
    }

    pagesRoot.classList.add("is-pull-resist");
    pagesRoot.style.removeProperty("transition");
    pagesRoot.style.setProperty("--reader-horizontal-pull-offset", `${Math.round(offsetPx)}px`);
  };

  pagesRoot.addEventListener(
    "pointerdown",
    (event) => {
      if (!isHorizontalReaderModeActive()) return;
      if (!event || event.button !== 0 || !event.isPrimary) return;
      if (isInteractiveTarget(event.target)) return;

      pointerTracking = true;
      pointerMoved = false;
      pointerStartX = Number(event.clientX) || 0;
      pointerStartY = Number(event.clientY) || 0;
      pointerStartAt = Date.now();
      pointerType = ((event.pointerType || "") + "").toLowerCase();
    },
    { passive: true }
  );

  pagesRoot.addEventListener(
    "pointermove",
    (event) => {
      if (!pointerTracking) return;
      const moveX = Math.abs((Number(event.clientX) || 0) - pointerStartX);
      const moveY = Math.abs((Number(event.clientY) || 0) - pointerStartY);
      if (moveX > HORIZONTAL_POINTER_DRAG_THRESHOLD || moveY > HORIZONTAL_POINTER_DRAG_THRESHOLD) {
        pointerMoved = true;
      }
    },
    { passive: true }
  );

  const finishPointerTracking = (event, cancelled = false) => {
    if (!pointerTracking) return;

    const endX = event && Number.isFinite(Number(event.clientX)) ? Number(event.clientX) : pointerStartX;
    const endY = event && Number.isFinite(Number(event.clientY)) ? Number(event.clientY) : pointerStartY;
    const deltaX = endX - pointerStartX;
    const deltaY = endY - pointerStartY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const elapsedMs = pointerStartAt > 0 ? Date.now() - pointerStartAt : 0;

    const shouldSwipePage =
      !cancelled &&
      isHorizontalReaderModeActive() &&
      pointerType !== "touch" &&
      pointerMoved &&
      absX >= HORIZONTAL_SWIPE_MIN_DISTANCE &&
      absX > absY * HORIZONTAL_SWIPE_INTENT_RATIO &&
      elapsedMs <= HORIZONTAL_SWIPE_MAX_DURATION;

    if (shouldSwipePage) {
      suppressClickUntil = Date.now() + 220;
      const direction = resolveHorizontalStepFromGesture(deltaX);
      scrollToPageIndex(activePageIndex + direction);
    } else if (pointerMoved) {
      suppressClickUntil = Date.now() + 180;
    }

    pointerTracking = false;
    pointerMoved = false;
    pointerStartAt = 0;
    pointerType = "";
  };

  pagesRoot.addEventListener(
    "pointerup",
    (event) => {
      finishPointerTracking(event, false);
    },
    { passive: true }
  );
  pagesRoot.addEventListener(
    "pointercancel",
    (event) => {
      finishPointerTracking(event, true);
    },
    { passive: true }
  );
  pagesRoot.addEventListener(
    "pointerleave",
    (event) => {
      finishPointerTracking(event, true);
    },
    { passive: true }
  );

  pagesRoot.addEventListener(
    "touchstart",
    (event) => {
      if (!isHorizontalReaderModeActive()) return;
      if (!event || !event.touches || event.touches.length !== 1) return;
      if (isInteractiveTarget(event.target)) return;
      const touch = event.touches[0];
      touchTracking = true;
      touchMoved = false;
      touchSuppressTapClick = false;
      skipHalfClickForErrorRetry = false;
      swipeStartX = Number(touch.clientX) || 0;
      swipeStartY = Number(touch.clientY) || 0;
      touchStartAt = Date.now();
    },
    { passive: true }
  );

  pagesRoot.addEventListener(
    "touchmove",
    (event) => {
      if (!touchTracking || !event || !event.touches || !event.touches[0]) return;
      const touch = event.touches[0];
      const deltaX = (Number(touch.clientX) || 0) - swipeStartX;
      const deltaY = (Number(touch.clientY) || 0) - swipeStartY;

      if (isMobileHorizontalReaderModeActive()) {
        const atReaderStart = isAtHorizontalReaderStart();
        const downwardDominant = deltaY > 6 && Math.abs(deltaY) > Math.abs(deltaX) * 1.08;
        if (atReaderStart && downwardDominant) {
          const resistance = Math.min(HORIZONTAL_PULL_RESIST_MAX, deltaY * HORIZONTAL_PULL_RESIST_FACTOR);
          applyHorizontalPullResistance(resistance);
        } else {
          clearHorizontalPullResistance(false);
        }
      }

      if (Math.abs(deltaX) > HORIZONTAL_TAP_DEAD_MOVEMENT || Math.abs(deltaY) > HORIZONTAL_TAP_DEAD_MOVEMENT) {
        touchMoved = true;
      }
    },
    { passive: true }
  );

  pagesRoot.addEventListener(
    "touchend",
    (event) => {
      if (!touchTracking) return;

      const clientX = getClientX(event);
      const clientY = event && event.changedTouches && event.changedTouches[0]
        ? Number(event.changedTouches[0].clientY)
        : NaN;
      const deltaX = Number.isFinite(clientX) ? clientX - swipeStartX : 0;
      const deltaY = Number.isFinite(clientY) ? clientY - swipeStartY : 0;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      const elapsedMs = Date.now() - touchStartAt;

      const shouldSwipePage =
        isHorizontalReaderModeActive() &&
        absX >= HORIZONTAL_SWIPE_MIN_DISTANCE &&
        absX > absY * HORIZONTAL_SWIPE_INTENT_RATIO &&
        elapsedMs <= HORIZONTAL_SWIPE_MAX_DURATION;

      if (shouldSwipePage) {
        touchSuppressTapClick = true;
        suppressClickUntil = Date.now() + 220;
        const direction = resolveHorizontalStepFromGesture(deltaX);
        scrollToPageIndex(activePageIndex + direction);
      } else if (touchMoved) {
        touchSuppressTapClick = true;
        suppressClickUntil = Date.now() + 170;
      }

      clearHorizontalPullResistance(true);
      touchTracking = false;
      touchMoved = false;
      touchStartAt = 0;
    },
    { passive: true }
  );

  pagesRoot.addEventListener(
    "touchcancel",
    () => {
      touchTracking = false;
      touchMoved = false;
      touchSuppressTapClick = false;
      touchStartAt = 0;
      clearHorizontalPullResistance(false);
    },
    { passive: true }
  );

  pagesRoot.addEventListener(
    "click",
    (event) => {
      if (!isHorizontalReaderModeActive()) return;
      const targetImage = event.target instanceof Element
        ? event.target.closest(".page-media--lazy")
        : null;
      if (!(targetImage instanceof HTMLElement)) return;
      if (getLazyState(targetImage) === "error") {
        skipHalfClickForErrorRetry = true;
      }
    },
    { capture: true, passive: true }
  );

  pagesRoot.addEventListener("click", (event) => {
    if (!isHorizontalReaderModeActive()) {
      touchSuppressTapClick = false;
      skipHalfClickForErrorRetry = false;
      return;
    }
    if (!event || event.defaultPrevented) {
      skipHalfClickForErrorRetry = false;
      return;
    }
    if (skipHalfClickForErrorRetry) {
      skipHalfClickForErrorRetry = false;
      return;
    }
    if (Date.now() < suppressClickUntil) {
      touchSuppressTapClick = false;
      return;
    }
    if (touchSuppressTapClick) {
      touchSuppressTapClick = false;
      return;
    }
    if (isInteractiveTarget(event.target)) return;

    const targetImage = event.target instanceof Element
      ? event.target.closest(".page-media--lazy")
      : null;
    if (targetImage instanceof HTMLElement) {
      const lazyState = getLazyState(targetImage);
      if (lazyState === "error") return;
    }

    const rootRect = pagesRoot.getBoundingClientRect();
    if (!rootRect || !Number.isFinite(rootRect.width) || rootRect.width <= 0) return;
    const clickX = Number(event.clientX);
    if (!Number.isFinite(clickX)) return;

    const relativeX = (clickX - rootRect.left) / rootRect.width;
    const direction = isHorizontalRtlReaderModeActive()
      ? relativeX > 0.5
        ? -1
        : 1
      : relativeX > 0.5
        ? 1
        : -1;
    forceShowHorizontalProgressAfterTapNavigation = true;
    scrollToPageIndex(activePageIndex + direction);
  });

  const onImageLoaded = (img) => {
    resetRetry(img);
    markLoaded(img);
    applyPageFrameWidth(img);
    applyHorizontalImageSize(img);
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

  const retryLazyImage = (img, options = {}) => {
    if (!img || !img.dataset) return;
    clearLazyWatchdog(img);

    const immediate = Boolean(options && options.immediate);
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

    const retryDelay = immediate ? 40 : retryDelayMs * nextRetry;
    window.setTimeout(() => {
      if (!img.isConnected) return;
      const state = (img.dataset.lazyState || "").toString();
      if (state === "loaded") return;
      requestUnveil(img);
      scheduleLookAheadDrain(220);
      if (jumpToCommentsActive) {
        scheduleJumpToCommentsSync(120, "auto");
      }
    }, retryDelay);
  };

  orderedImages.forEach((img) => {
    if (!img.dataset.lazyState) {
      const deferredSrc = getDeferredSrc(img);
      if (deferredSrc) {
        img.dataset.lazyState = img.classList.contains("is-loaded") ? "loaded" : "idle";
      } else {
        const isRenderable = img.complete && (img.naturalWidth > 0 || img.naturalHeight > 0);
        img.dataset.lazyState = isRenderable ? "loaded" : "loading";
      }
    }

    const originalSrc = getDeferredSrc(img);
    if (originalSrc) {
      img.dataset.lazyOriginalSrc = originalSrc;
      img.classList.remove("lazyload");
    } else {
      if (getLazyState(img) === "loaded") {
        markLoaded(img);
        applyPageFrameWidth(img);
        applyHorizontalImageSize(img);
      } else {
        img.classList.remove("is-loaded", "is-error", "lazyerror", "lazyloaded", "lazyload");
        img.classList.add("is-placeholder");
      }
    }

    img.addEventListener("load", () => {
      if (getLazyState(img) !== "loading" && getDeferredSrc(img)) return;
      if (!isCurrentSrcExpected(img)) return;
      onImageLoaded(img);
      markVisiblePageByImage(img);
    });

    img.addEventListener("error", () => {
      const state = (img.dataset.lazyState || "").toString();
      if (state !== "loading") return;
      if (!isCurrentSrcExpected(img)) return;
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
  updatePageIndicators(activePageIndex);

  const primeInitialImages = () => {
    orderedImages.slice(0, Math.min(5, orderedImages.length)).forEach((img) => {
      ensureImageVisible(img);
    });
    applyReaderModeImageSizing();
  };

  syncActiveWindow();
  primeInitialImages();
  setReaderMode(readerMode, { persist: false, behavior: "auto" });
  window.requestAnimationFrame(primeInitialImages);
  window.addEventListener("load", primeInitialImages, { once: true });
  window.addEventListener("pageshow", () => {
    primeInitialImages();
    rescueStalledLoadingImages();
    scheduleLookAheadDrain(80);
    scheduleActiveWindowSync();
  });
  window.addEventListener("pagehide", () => {
    stopHorizontalScrollAnimation();
    lazyImages.forEach((img) => {
      clearLazyWatchdog(img);
    });
  });
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
  pagesRoot.addEventListener(
    "scroll",
    () => {
      if (!isHorizontalReaderModeActive()) return;
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
  window.addEventListener(
    "resize",
    () => {
      applyReaderModeImageSizing();
      scheduleActiveWindowSync();
    },
    { passive: true }
  );
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
