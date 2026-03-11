(() => {
  const ICON_MARKER_ATTR = "data-button-iconized";
  const ICON_ONLY_ATTR = "data-button-icon-only";
  const AUTO_LOADING_ATTR = "data-button-auto-loading";
  const AUTO_ICON_ATTR = "data-button-auto-icon";
  const INTENT_WINDOW_MS = 5000;
  const clickIntentMap = new WeakMap();
  const ICON_SKIP_CLASSES = new Set([
    "chat-sidebar-overlay",
    "chat-thread-item",
    "chat-search-item",
    "chat-picker__item",
    "comment-picker__item",
    "comment-picker__toggle--mention",
    "comment-mention-item",
    "reader-dropdown-option",
    "admin-member-badge-option",
    "filter-option"
  ]);

  const normalizeWhitespace = (value) => (value || "").toString().replace(/\s+/g, " ").trim();

  const normalizeKey = (value) => normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const isButtonElement = (value) => value instanceof HTMLButtonElement;
  const shouldSkipAutoLoading = (button) =>
    isButtonElement(button) && button.hasAttribute("data-button-loading-skip");
  const hasClass = (button, className) => isButtonElement(button) && button.classList.contains(className);

  const hasExistingIcon = (button) => {
    if (!isButtonElement(button)) return true;
    return Boolean(
      button.querySelector(
        `i[class*="fa-"], svg, img, [${AUTO_ICON_ATTR}], [class*="icon"], [class*="spinner"]`
      )
    );
  };

  const isIconSkipButton = (button) => {
    if (!isButtonElement(button)) return true;
    if (button.hasAttribute("data-button-icon-skip")) return true;
    if (button.hasAttribute("data-member-editor-add-toggle")) return true;
    for (const className of ICON_SKIP_CLASSES) {
      if (button.classList.contains(className)) return true;
    }
    return false;
  };

  const getButtonLabel = (button) => {
    if (!isButtonElement(button)) return "";
    const text = normalizeWhitespace(button.textContent);
    if (text) return text;
    const ariaLabel = normalizeWhitespace(button.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;
    return normalizeWhitespace(button.getAttribute("title"));
  };

  const resolveIconFromAttributes = (button, labelKey) => {
    if (!isButtonElement(button)) return "";

    if (
      hasClass(button, "modal-close") ||
      button.hasAttribute("data-dialog-close") ||
      button.hasAttribute("data-public-confirm-close") ||
      button.hasAttribute("data-close-join-team") ||
      button.hasAttribute("data-close-create-team") ||
      button.hasAttribute("data-team-edit-close") ||
      button.hasAttribute("data-member-editor-close") ||
      button.hasAttribute("data-chat-user-close")
    ) {
      return "fa-xmark";
    }

    if (
      button.hasAttribute("data-dialog-cancel") ||
      button.hasAttribute("data-public-confirm-cancel") ||
      button.hasAttribute("data-admin-team-edit-cancel") ||
      button.hasAttribute("data-admin-team-confirm-cancel")
    ) {
      return "fa-xmark";
    }

    if (
      button.hasAttribute("data-dialog-confirm") ||
      button.hasAttribute("data-public-confirm-ok") ||
      button.hasAttribute("data-admin-team-confirm-submit")
    ) {
      return "fa-check";
    }

    if (button.hasAttribute("data-auth-login")) return "fa-right-to-bracket";
    if (button.hasAttribute("data-auth-logout")) return "fa-right-from-bracket";
    if (button.hasAttribute("data-open-join-team")) return "fa-user-plus";
    if (button.hasAttribute("data-open-create-team")) return "fa-people-group";
    if (button.hasAttribute("data-cancel-pending-team")) return "fa-user-xmark";
    if (button.hasAttribute("data-bookmark-remove")) return "fa-bookmark-slash";
    if (button.hasAttribute("data-account-api-generate")) return "fa-key";
    if (button.hasAttribute("data-account-api-copy")) return "fa-copy";
    if (button.hasAttribute("data-account-reset")) return "fa-rotate-left";
    if (button.hasAttribute("data-account-save") || button.hasAttribute("data-chapter-save")) return "fa-floppy-disk";
    if (button.hasAttribute("data-team-media-submit")) return "fa-floppy-disk";
    if (button.hasAttribute("data-team-tab-jump")) return "fa-arrow-right";
    if (button.hasAttribute("data-admin-team-edit-open")) return "fa-pen-to-square";
    if (button.hasAttribute("data-admin-team-edit-submit")) return "fa-floppy-disk";
    if (button.hasAttribute("data-admin-team-member-add-submit")) return "fa-user-plus";
    if (button.hasAttribute("data-comments-bulk-delete") || button.hasAttribute("data-chapters-bulk-delete")) return "fa-trash-can";
    if (button.hasAttribute("data-member-open-id")) return "fa-user-pen";
    if (button.hasAttribute("data-description-toggle")) return "fa-chevron-down";
    if (button.hasAttribute("data-notify-mark-all")) return "fa-check-double";

    if (button.hasAttribute("data-request-action")) {
      const actionKey = normalizeKey(button.getAttribute("data-request-action"));
      if (actionKey === "approve") return "fa-circle-check";
      if (actionKey === "reject") return "fa-circle-xmark";
    }

    if (button.hasAttribute("data-team-tab-trigger")) {
      const tabKey = normalizeKey(button.getAttribute("data-team-tab-trigger"));
      if (tabKey === "overview") return "fa-chart-column";
      if (tabKey === "series") return "fa-book-open";
      if (tabKey === "notifications") return "fa-bell";
      if (tabKey === "members") return "fa-users";
    }

    if (hasClass(button, "notify-menu__mark")) return "fa-check-double";
    if (hasClass(button, "admin-forbidden-word-remove")) return "fa-xmark";
    if (hasClass(button, "admin-team-selector__option")) return "fa-people-group";
    if (hasClass(button, "comment-picker__toggle--mention")) return "fa-at";
    if (hasClass(button, "comment-action--reply")) return "fa-reply";
    if (hasClass(button, "comment-action--report")) return "fa-flag";
    if (hasClass(button, "comment-action--delete")) return "fa-trash";

    if (hasClass(button, "upload-tile__badge--status")) {
      if (labelKey.includes("xong")) return "fa-check";
      if (labelKey.includes("loi")) return "fa-triangle-exclamation";
      if (labelKey.includes("cho")) return "fa-hourglass-half";
      return "fa-clock";
    }

    return "";
  };

  const exactTextIconMap = {
    "+": "fa-plus",
    x: "fa-xmark",
    "dang nhap": "fa-right-to-bracket",
    "dang xuat": "fa-right-from-bracket",
    "thoat quan ly": "fa-right-from-bracket",
    "huy": "fa-xmark",
    dong: "fa-xmark",
    "xac nhan": "fa-check",
    "duyet": "fa-circle-check",
    "tu choi": "fa-circle-xmark",
    "luu": "fa-floppy-disk",
    "them": "fa-plus",
    "tim kiem": "fa-magnifying-glass",
    "thu lai": "fa-rotate-right",
    "tao nhom": "fa-people-group",
    "tao nhom dich": "fa-people-group",
    "tham gia nhom dich": "fa-user-plus",
    "huy yeu cau tham gia": "fa-user-xmark",
    "go bookmark": "fa-bookmark-slash",
    "tong quan": "fa-chart-column",
    truyen: "fa-book-open",
    "thong bao": "fa-bell",
    "thanh vien": "fa-users",
    hien: "fa-eye",
    an: "fa-eye-slash",
    truoc: "fa-chevron-left",
    sau: "fa-chevron-right"
  };

  const keywordRules = [
    { pattern: /(dang nhap|login)/i, icon: "fa-right-to-bracket" },
    { pattern: /(dang xuat|logout|thoat quan ly|roi nhom)/i, icon: "fa-right-from-bracket" },
    { pattern: /(huy yeu cau tham gia)/i, icon: "fa-user-xmark" },
    { pattern: /(api key|token)/i, icon: "fa-key" },
    { pattern: /(sao chep|copy)/i, icon: "fa-copy" },
    { pattern: /(dat lai|khoi phuc|reset)/i, icon: "fa-rotate-left" },
    { pattern: /(tao nhom|nhom dich)/i, icon: "fa-people-group" },
    { pattern: /(tao truyen)/i, icon: "fa-book-open" },
    { pattern: /(them thanh vien)/i, icon: "fa-user-plus" },
    { pattern: /(them huy hieu)/i, icon: "fa-medal" },
    { pattern: /(them tu cam)/i, icon: "fa-ban" },
    { pattern: /(them)/i, icon: "fa-plus" },
    { pattern: /(luu|save)/i, icon: "fa-floppy-disk" },
    { pattern: /(xoa da chon)/i, icon: "fa-trash-can" },
    { pattern: /(xoa|delete)/i, icon: "fa-trash" },
    { pattern: /(ban thanh vien|kick)/i, icon: "fa-user-slash" },
    { pattern: /(mo khoa|unban)/i, icon: "fa-unlock" },
    { pattern: /(huy|cancel)/i, icon: "fa-xmark" },
    { pattern: /(xac nhan|duyet|dong y)/i, icon: "fa-circle-check" },
    { pattern: /(tu choi|reject)/i, icon: "fa-circle-xmark" },
    { pattern: /(thu lai|retry)/i, icon: "fa-rotate-right" },
    { pattern: /(gui tra loi|gui binh luan|gui|send|submit|tra loi)/i, icon: "fa-paper-plane" },
    { pattern: /(xem them)/i, icon: "fa-chevron-down" },
    { pattern: /(danh dau da doc|danh dau)/i, icon: "fa-check-double" },
    { pattern: /(tham gia|join)/i, icon: "fa-user-plus" },
    { pattern: /(tong quan|overview)/i, icon: "fa-chart-column" },
    { pattern: /(thong bao|notification|notifications)/i, icon: "fa-bell" },
    { pattern: /(thanh vien|members)/i, icon: "fa-users" },
    { pattern: /(truyen|series)/i, icon: "fa-book-open" },
    { pattern: /(sua|chinh sua|cap nhat|edit)/i, icon: "fa-pen-to-square" },
    { pattern: /(tim kiem|search|loc)/i, icon: "fa-magnifying-glass" },
    { pattern: /(^|\s)(hien|show)(\s|$)/i, icon: "fa-eye" },
    { pattern: /(^|\s)(an|hide)(\s|$)/i, icon: "fa-eye-slash" },
    { pattern: /(^|\s)(truoc|prev)(\s|$)/i, icon: "fa-chevron-left" },
    { pattern: /(^|\s)(sau|next)(\s|$)/i, icon: "fa-chevron-right" }
  ];

  const isLikelyActionButton = (button) => {
    if (!isButtonElement(button)) return false;
    if (hasClass(button, "button")) return true;
    if (hasClass(button, "auth-menu__item")) return true;
    if (hasClass(button, "notify-menu__mark")) return true;
    if (hasClass(button, "admin-member-open")) return true;
    if (hasClass(button, "admin-forbidden-word-remove")) return true;
    if (hasClass(button, "comment-picker__toggle--mention")) return true;
    if (hasClass(button, "upload-tile__badge--status")) return true;
    if (button.hasAttribute("data-request-action")) return true;
    if (button.hasAttribute("data-team-tab-trigger")) return true;
    return false;
  };

  const resolveIconFromText = (button, labelKey) => {
    const key = (labelKey || "").toString();
    if (!key || /^(?:-|\u2013|\u2014)+$/.test(key) || /^[0-9]+$/.test(key)) return "";

    if (Object.prototype.hasOwnProperty.call(exactTextIconMap, key)) {
      return exactTextIconMap[key];
    }

    for (const rule of keywordRules) {
      if (rule.pattern.test(key)) return rule.icon;
    }

    if (!isLikelyActionButton(button)) {
      return "";
    }

    if ((button.getAttribute("type") || "").toLowerCase() === "submit") {
      return "fa-check";
    }

    return hasClass(button, "button") ? "fa-circle-dot" : "";
  };

  const resolveIconClass = (button, labelKey) => {
    const attrIcon = resolveIconFromAttributes(button, labelKey);
    if (attrIcon) return attrIcon;
    return resolveIconFromText(button, labelKey);
  };

  const addButtonIcon = (button, iconClass, hasVisibleText) => {
    if (!isButtonElement(button) || !iconClass) return;
    const iconEl = document.createElement("i");
    iconEl.className = `fa-solid ${iconClass} button-auto-icon`;
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.setAttribute(AUTO_ICON_ATTR, "1");

    const firstSignificantNode = Array.from(button.childNodes).find((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return normalizeWhitespace(node.textContent).length > 0;
      }
      return true;
    });

    if (firstSignificantNode) {
      button.insertBefore(iconEl, firstSignificantNode);
    } else {
      button.appendChild(iconEl);
    }

    button.setAttribute(ICON_MARKER_ATTR, "1");
    if (hasVisibleText) {
      button.removeAttribute(ICON_ONLY_ATTR);
    } else {
      button.setAttribute(ICON_ONLY_ATTR, "1");
    }
  };

  const enhanceButtonIcon = (button) => {
    if (!isButtonElement(button) || isIconSkipButton(button)) return;
    if (hasExistingIcon(button)) return;

    const label = getButtonLabel(button);
    if (!label) return;
    const labelKey = normalizeKey(label);

    const iconClass = resolveIconClass(button, labelKey);
    if (!iconClass) return;

    const hasVisibleText = normalizeWhitespace(button.textContent).length > 0;
    addButtonIcon(button, iconClass, hasVisibleText);
  };

  const enhanceIconsInNode = (rootNode) => {
    if (!rootNode) return;

    if (isButtonElement(rootNode)) {
      enhanceButtonIcon(rootNode);
      return;
    }

    if (!(rootNode instanceof Element) && !(rootNode instanceof Document)) return;

    const buttons = rootNode.querySelectorAll ? rootNode.querySelectorAll("button") : [];
    buttons.forEach((button) => {
      enhanceButtonIcon(button);
    });
  };

  const rememberIntent = (button) => {
    if (!isButtonElement(button)) return;
    clickIntentMap.set(button, Date.now());
  };

  const hasRecentIntent = (button) => {
    const at = clickIntentMap.get(button);
    if (!at) return false;
    return Date.now() - at <= INTENT_WINDOW_MS;
  };

  const setButtonLoading = (button, shouldLoad, options = {}) => {
    if (!isButtonElement(button)) return;
    const isAuto = Boolean(options.auto);

    if (shouldLoad) {
      if (isAuto) {
        button.setAttribute(AUTO_LOADING_ATTR, "1");
      }
      button.classList.add("is-loading");
      button.setAttribute("aria-busy", "true");
      return;
    }

    if (isAuto) {
      if (button.getAttribute(AUTO_LOADING_ATTR) === "1") {
        button.removeAttribute(AUTO_LOADING_ATTR);
        button.classList.remove("is-loading");
      }
    } else {
      button.classList.remove("is-loading");
      button.removeAttribute(AUTO_LOADING_ATTR);
    }

    if (!button.classList.contains("is-loading")) {
      button.removeAttribute("aria-busy");
    }
  };

  const syncAutoLoadingFromDisabledState = (button) => {
    if (!isButtonElement(button)) return;
    const isAutoLoading = button.getAttribute(AUTO_LOADING_ATTR) === "1";

    if (shouldSkipAutoLoading(button)) {
      if (isAutoLoading) {
        setButtonLoading(button, false, { auto: true });
      }
      return;
    }

    if (button.disabled) {
      if (!isAutoLoading && hasRecentIntent(button)) {
        setButtonLoading(button, true, { auto: true });
      }
      return;
    }

    if (isAutoLoading) {
      setButtonLoading(button, false, { auto: true });
    }
  };

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target ? target.closest("button") : null;
      if (!isButtonElement(button) || button.disabled) return;
      rememberIntent(button);
    },
    true
  );

  document.addEventListener(
    "submit",
    (event) => {
      const submitter = event.submitter;
      if (!isButtonElement(submitter)) return;
      if (shouldSkipAutoLoading(submitter)) return;
      rememberIntent(submitter);
      setButtonLoading(submitter, true, { auto: true });
      if (!submitter.disabled) {
        submitter.disabled = true;
      }
    },
    true
  );

  const observeMutations = () => {
    const root = document.documentElement;
    if (!root || typeof MutationObserver !== "function") return;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "disabled") {
          syncAutoLoadingFromDisabledState(mutation.target);
          return;
        }

        if (mutation.type !== "childList") return;

        if (isButtonElement(mutation.target)) {
          enhanceButtonIcon(mutation.target);
        }

        mutation.addedNodes.forEach((node) => {
          enhanceIconsInNode(node);
        });
      });
    });

    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled"]
    });
  };

  const init = () => {
    enhanceIconsInNode(document);
    observeMutations();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.BfangButtonUi = {
    refresh(rootNode) {
      enhanceIconsInNode(rootNode || document);
    },
    setLoading(button, shouldLoad) {
      setButtonLoading(button, Boolean(shouldLoad), { auto: true });
    }
  };
})();
