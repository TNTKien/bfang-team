(() => {
  const BOUND_SHARE_ATTR = "data-manga-share-bound";
  const BOUND_SHARE_KEY = "__bfangShareBound";
  const BOUND_SHARE_HANDLER_KEY = "__bfangShareHandler";
  const SHARE_REBIND_PENDING_ATTR = "data-share-rebind-pending";
  const BOUND_DESC_ATTR = "data-description-bound";
  const descriptionControllers = [];
  let resizeTimer = null;
  let lastViewportWidth = window.innerWidth;

  const getUrl = () => window.location.href.split("#")[0];

  const getTitle = () => {
    const h1 = document.querySelector(".detail-info h1") || document.querySelector("h1");
    const text = h1 ? (h1.textContent || "").trim() : "";
    return text || document.title;
  };

  const copyText = async (value) => {
    const text = (value || "").toString();
    if (!text) return false;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_err) {
        // Ignore clipboard API failures.
      }
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return Boolean(ok);
    } catch (_err) {
      return false;
    }
  };

  const initShareButtons = (root) => {
    const scope = root && root.querySelectorAll ? root : document;
    const shareButtons = Array.from(scope.querySelectorAll("[data-share-button]"));

    shareButtons.forEach((button) => {
      if (button[BOUND_SHARE_KEY] === true) {
        button.setAttribute(BOUND_SHARE_ATTR, "1");
        return;
      }
      if (button.getAttribute(BOUND_SHARE_ATTR) === "1") return;
      button[BOUND_SHARE_KEY] = true;
      button.setAttribute(BOUND_SHARE_ATTR, "1");

      const label = button.querySelector("[data-share-label]");
      const getLabel = () => {
        const target = label || button;
        return (target.textContent || "Chia sẻ").trim() || "Chia sẻ";
      };
      const setLabel = (value) => {
        const text = (value || "").toString();
        if (label) {
          label.textContent = text;
          return;
        }
        button.textContent = text;
      };

      const original = getLabel();
      const onShareClick = async (event) => {
        event.preventDefault();
        const url = getUrl();
        const title = getTitle();

        if (navigator.share) {
          try {
            await navigator.share({ title, url });
            return;
          } catch (_err) {
            // User canceled share dialog.
          }
        }

        const copied = await copyText(url);
        setLabel(copied ? "Đã copy link" : "Không copy được");
        window.setTimeout(() => {
          setLabel(original);
        }, 1400);
      };

      button[BOUND_SHARE_HANDLER_KEY] = onShareClick;
      button.addEventListener("click", onShareClick);
    });
  };

  const createDescriptionController = (wrapper) => {
    const content = wrapper.querySelector("[data-description-content]");
    const toggle = wrapper.querySelector("[data-description-toggle]");
    if (!content || !toggle) return null;

    const fullText = (content.textContent || "").replace(/\r\n?/g, "\n").trim();
    if (!fullText) {
      toggle.hidden = true;
      toggle.removeAttribute("aria-expanded");
      return null;
    }

    const getMax = () => {
      const base = Number(wrapper.dataset.descriptionMax) || 280;
      const mobile = Number(wrapper.dataset.descriptionMaxMobile) || Math.round(base * 0.72);
      if (window.matchMedia && window.matchMedia("(max-width: 560px)").matches) {
        return mobile;
      }
      return base;
    };

    const truncate = (text, max) => {
      if (text.length <= max) {
        return { text, truncated: false };
      }

      const slice = text.slice(0, max).trimEnd();
      let lastBreak = -1;
      for (let index = slice.length - 1; index >= 0; index -= 1) {
        if (/\s/.test(slice[index])) {
          lastBreak = index;
          break;
        }
      }
      const cut = lastBreak > Math.floor(max * 0.6) ? slice.slice(0, lastBreak).trimEnd() : slice;
      return { text: cut, truncated: true };
    };

    const setState = (expanded) => {
      wrapper.classList.toggle("is-expanded", expanded);
      wrapper.classList.toggle("is-collapsed", !expanded);
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.textContent = expanded ? "Thu g\u1ecdn" : "Xem th\u00eam";
    };

    const collapse = () => {
      const result = truncate(fullText, getMax());
      if (!result.truncated) {
        content.textContent = fullText;
        toggle.hidden = true;
        wrapper.classList.remove("is-expanded", "is-collapsed");
        toggle.removeAttribute("aria-expanded");
        return;
      }

      content.textContent = `${result.text}...`;
      toggle.hidden = false;
      setState(false);
    };

    const refresh = () => {
      const result = truncate(fullText, getMax());
      if (!result.truncated) {
        content.textContent = fullText;
        toggle.hidden = true;
        wrapper.classList.remove("is-expanded", "is-collapsed");
        toggle.removeAttribute("aria-expanded");
        return;
      }

      toggle.hidden = false;
      if (wrapper.classList.contains("is-expanded")) {
        content.textContent = fullText;
        setState(true);
        return;
      }

      content.textContent = `${result.text}...`;
      setState(false);
    };

    const expand = () => {
      content.textContent = fullText;
      toggle.hidden = false;
      setState(true);
    };

    toggle.addEventListener("click", () => {
      if (wrapper.classList.contains("is-expanded")) {
        collapse();
        return;
      }
      expand();
    });

    window.requestAnimationFrame(() => {
      refresh();
    });

    return {
      wrapper,
      collapse,
      refresh
    };
  };

  const initDescription = (root) => {
    const scope = root && root.querySelectorAll ? root : document;
    const wrappers = Array.from(scope.querySelectorAll("[data-description-wrap]"));
    wrappers.forEach((wrapper) => {
      if (!(wrapper instanceof HTMLElement)) return;
      if (wrapper.getAttribute(BOUND_DESC_ATTR) === "1") return;
      wrapper.setAttribute(BOUND_DESC_ATTR, "1");
      const controller = createDescriptionController(wrapper);
      if (controller) {
        descriptionControllers.push(controller);
      }
    });
  };

  const refreshDescriptionOnResize = () => {
    const activeControllers = [];
    descriptionControllers.forEach((controller) => {
      if (!controller || !controller.wrapper || !controller.wrapper.isConnected) {
        return;
      }
      if (typeof controller.refresh === "function") {
        controller.refresh();
      } else {
        controller.collapse();
      }
      activeControllers.push(controller);
    });
    descriptionControllers.length = 0;
    activeControllers.forEach((controller) => {
      descriptionControllers.push(controller);
    });
  };

  const initMangaDetail = (root) => {
    initShareButtons(root);
    initDescription(root);
  };

  const rebindShareButtonOnDemand = (button, event) => {
    if (!(button instanceof HTMLElement)) return;
    if (button.getAttribute(BOUND_SHARE_ATTR) === "1") return;
    if (button.getAttribute(SHARE_REBIND_PENDING_ATTR) === "1") return;

    button.setAttribute(SHARE_REBIND_PENDING_ATTR, "1");
    initShareButtons(document);
    button.removeAttribute(SHARE_REBIND_PENDING_ATTR);

    const handler = button[BOUND_SHARE_HANDLER_KEY];
    if (typeof handler !== "function") return;

    event.preventDefault();
    event.stopImmediatePropagation();
    handler(event);
  };

  window.BfangMangaDetail = window.BfangMangaDetail || {};
  window.BfangMangaDetail.init = initMangaDetail;

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        initMangaDetail(document);
      },
      { once: true }
    );
  } else {
    initMangaDetail(document);
  }

  window.addEventListener("resize", () => {
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
    }
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      const nextViewportWidth = window.innerWidth;
      if (nextViewportWidth === lastViewportWidth) {
        return;
      }
      lastViewportWidth = nextViewportWidth;
      refreshDescriptionOnResize();
    }, 120);
  });

  window.addEventListener("bfang:pagechange", () => {
    initMangaDetail(document);
  });

  document.addEventListener(
    "click",
    (event) => {
      const source = event.target;
      if (!(source instanceof Element)) return;
      const button = source.closest("[data-share-button]");
      if (!button) return;
      if (button.getAttribute(BOUND_SHARE_ATTR) === "1") return;

      rebindShareButtonOnDemand(button, event);
    },
    true
  );
})();

