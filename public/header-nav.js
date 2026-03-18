(() => {
  const TOGGLE_SELECTOR = "[data-header-nav-toggle]";
  const BOUND_ATTR = "data-header-nav-bound";
  const OPEN_CLASS = "is-open";
  const MOBILE_MAX_WIDTH = 860;

  const resolveTargetNav = (toggle) => {
    if (!toggle) return null;
    const targetId = (toggle.dataset.headerNavTarget || toggle.getAttribute("aria-controls") || "").toString().trim();
    if (!targetId) return null;
    return document.getElementById(targetId);
  };

  const setExpanded = (toggle, expanded) => {
    if (!toggle) return;
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  };

  const closeNav = (toggle, nav) => {
    if (!toggle || !nav) return;
    nav.classList.remove(OPEN_CLASS);
    setExpanded(toggle, false);
  };

  const openNav = (toggle, nav) => {
    if (!toggle || !nav) return;
    nav.classList.add(OPEN_CLASS);
    setExpanded(toggle, true);
  };

  const closeAllNavs = () => {
    document.querySelectorAll(TOGGLE_SELECTOR).forEach((toggle) => {
      const nav = resolveTargetNav(toggle);
      closeNav(toggle, nav);
    });
  };

  const bindToggle = (toggle) => {
    if (!(toggle instanceof HTMLElement)) return;
    if (toggle.getAttribute(BOUND_ATTR) === "1") return;

    const nav = resolveTargetNav(toggle);
    if (!(nav instanceof HTMLElement)) {
      toggle.setAttribute(BOUND_ATTR, "1");
      return;
    }

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const isOpen = nav.classList.contains(OPEN_CLASS);
      closeAllNavs();
      if (!isOpen) {
        openNav(toggle, nav);
      }
    });

    nav.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    toggle.setAttribute(BOUND_ATTR, "1");
  };

  const initHeaderNav = (root) => {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll(TOGGLE_SELECTOR).forEach((toggle) => {
      bindToggle(toggle);
    });
    if (window.innerWidth > MOBILE_MAX_WIDTH) {
      closeAllNavs();
    }
  };

  document.addEventListener("click", () => {
    closeAllNavs();
  });

  document.addEventListener("keydown", (event) => {
    if (!event || event.key !== "Escape") return;
    closeAllNavs();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > MOBILE_MAX_WIDTH) {
      closeAllNavs();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        initHeaderNav(document);
      },
      { once: true }
    );
  } else {
    initHeaderNav(document);
  }

  window.addEventListener("bfang:pagechange", () => {
    initHeaderNav(document);
  });
})();
