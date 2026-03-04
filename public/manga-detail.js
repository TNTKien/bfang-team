(() => {
  const BOUND_SHARE_ATTR = "data-manga-share-bound";
  const BOUND_DESC_ATTR = "data-description-bound";
  const descriptionControllers = [];
  let resizeTimer = null;

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
    const facebookButtons = Array.from(scope.querySelectorAll("[data-share-facebook]"));
    const instagramButtons = Array.from(scope.querySelectorAll("[data-share-instagram]"));

    facebookButtons.forEach((facebook) => {
      facebook.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getUrl())}`;
      facebook.target = "_blank";
      facebook.rel = "noopener";
    });

    instagramButtons.forEach((instagram) => {
      if (instagram.getAttribute(BOUND_SHARE_ATTR) === "1") return;
      instagram.setAttribute(BOUND_SHARE_ATTR, "1");

      const label = instagram.querySelector("[data-share-label]");
      const getLabel = () => {
        const target = label || instagram;
        return (target.textContent || "Instagram").trim() || "Instagram";
      };
      const setLabel = (value) => {
        const text = (value || "").toString();
        if (label) {
          label.textContent = text;
          return;
        }
        instagram.textContent = text;
      };

      const original = getLabel();
      instagram.addEventListener("click", async (event) => {
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
        setLabel(copied ? "\u0110\u00e3 copy link" : "Kh\u00f4ng copy \u0111\u01b0\u1ee3c");
        window.setTimeout(() => {
          setLabel(original);
        }, 1400);
      });
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
      collapse();
    });

    return {
      wrapper,
      collapse
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
      controller.collapse();
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
      refreshDescriptionOnResize();
    }, 120);
  });

  window.addEventListener("bfang:pagechange", () => {
    initMangaDetail(document);
  });
})();

