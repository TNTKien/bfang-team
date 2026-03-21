(() => {
  const ADULT_WARNING_STORAGE_PREFIX = "bfang_adult_warning_ack:";
  const ADULT_COVER_BOUND_KEY = "__bfangAdultCoverBound";
  const ADULT_WARNING_BOUND_KEY = "__bfangAdultWarningBound";

  const revealCover = (cover) => {
    if (!(cover instanceof HTMLElement)) return;
    cover.dataset.adultRevealed = "1";
    cover.classList.add("is-adult-revealed");
    cover.removeAttribute("role");
    cover.removeAttribute("tabindex");
    cover.removeAttribute("aria-label");
  };

  const initAdultCoverReveal = () => {
    const adultCovers = Array.from(document.querySelectorAll("[data-adult-cover-reveal-on-click]"));
    if (!adultCovers.length) return;

    adultCovers.forEach((cover) => {
      if (!(cover instanceof HTMLElement)) return;
      if (cover[ADULT_COVER_BOUND_KEY]) return;

      const handleReveal = (event) => {
        event.preventDefault();
        event.stopPropagation();
        revealCover(cover);
      };

      cover.addEventListener("click", handleReveal);
      cover.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        handleReveal(event);
      });
      cover[ADULT_COVER_BOUND_KEY] = true;
    });
  };

  const getChapterWarningKey = () => {
    const path = (window.location && window.location.pathname ? window.location.pathname : "").trim();
    if (!path) return "";
    return `${ADULT_WARNING_STORAGE_PREFIX}${path}`;
  };

  const hasAcknowledgedAdultWarning = (key) => {
    if (!key) return false;
    try {
      return window.sessionStorage.getItem(key) === "1";
    } catch (_err) {
      return false;
    }
  };

  const markAdultWarningAcknowledged = (key) => {
    if (!key) return;
    try {
      window.sessionStorage.setItem(key, "1");
    } catch (_err) {
      // ignore
    }
  };

  const initAdultWarningDialog = () => {
    document.body.classList.remove("adult-warning-open");
    const warningWrap = document.querySelector("[data-adult-warning]");
    if (!(warningWrap instanceof HTMLElement)) return;

    const warningKey = getChapterWarningKey();
    if (hasAcknowledgedAdultWarning(warningKey)) {
      warningWrap.hidden = true;
      return;
    }

    const confirmButton = warningWrap.querySelector("[data-adult-warning-confirm]");
    const dismissTarget = warningWrap.querySelector("[data-adult-warning-dismiss]");
    warningWrap.hidden = false;
    document.body.classList.add("adult-warning-open");

    const closeWarning = () => {
      warningWrap.hidden = true;
      document.body.classList.remove("adult-warning-open");
      markAdultWarningAcknowledged(warningKey);
    };

    if (!warningWrap[ADULT_WARNING_BOUND_KEY]) {
      if (confirmButton instanceof HTMLButtonElement) {
        confirmButton.addEventListener("click", () => {
          closeWarning();
        });
      }

      if (dismissTarget instanceof HTMLElement) {
        dismissTarget.addEventListener("click", () => {
          closeWarning();
        });
      }

      warningWrap[ADULT_WARNING_BOUND_KEY] = true;
    }

    if (confirmButton instanceof HTMLButtonElement) {
      confirmButton.focus({ preventScroll: true });
    }
  };

  initAdultCoverReveal();
  initAdultWarningDialog();
  window.addEventListener("bfang:pagechange", () => {
    initAdultCoverReveal();
    initAdultWarningDialog();
  });
})();
