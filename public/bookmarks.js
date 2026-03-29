(() => {
  const BOOKMARKS_ENDPOINT = "/account/bookmarks";
  const BOOKMARKS_STATE_ENDPOINT = "/account/bookmarks/state";
  const BOOKMARKS_MANAGE_ENDPOINT = "/account/bookmarks/manage";
  const BOOKMARKS_LIST_CREATE_ENDPOINT = "/account/bookmarks/lists/create";
  const BOOKMARKS_LIST_UPDATE_ENDPOINT = "/account/bookmarks/lists/update";
  const BOOKMARKS_LIST_DELETE_ENDPOINT = "/account/bookmarks/lists/delete";
  const BOOKMARKS_PUBLIC_ENDPOINT_PREFIX = "/account/bookmarks/public";
  const TOGGLE_BOOKMARK_ENDPOINT = "/account/bookmarks/toggle";
  const REMOVE_BOOKMARK_ENDPOINT = "/account/bookmarks/remove";
  const BOOKMARKS_PER_PAGE_WIDE = 15;
  const BOOKMARKS_PER_PAGE_COMPACT = 12;
  const BOOKMARKS_PER_PAGE_RESIZE_DEBOUNCE_MS = 180;
  const BOOKMARK_LIST_NAME_MAX_LENGTH = 20;
  const BOOKMARK_SORT_NEW = "new";
  const BOOKMARK_SORT_AZ = "az";
  const BOOKMARK_SORT_ZA = "za";
  const BOOKMARK_SEARCH_MAX_LENGTH = 80;
  const BOOKMARK_PAGE_SEARCH_DEBOUNCE_MS = 320;

  const toText = (value) => (value == null ? "" : String(value)).trim();
  const normalizeBookmarkSearchTerm = (value) =>
    (value == null ? "" : String(value))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, BOOKMARK_SEARCH_MAX_LENGTH);
  const normalizeBookmarkSortOrder = (value) => {
    const sortValue = toText(value).toLowerCase();
    if (sortValue === BOOKMARK_SORT_ZA) return BOOKMARK_SORT_ZA;
    if (sortValue === BOOKMARK_SORT_AZ) return BOOKMARK_SORT_AZ;
    return BOOKMARK_SORT_NEW;
  };
  const toSafePath = (value) => {
    const text = toText(value);
    return text && text.startsWith("/") ? text : "";
  };
  const toSafeImageUrl = (value) => {
    const text = toText(value);
    if (!text) return "";
    if (text.startsWith("/")) return text;
    if (/^https?:\/\//i.test(text)) return text;
    return "";
  };
  const escapeHtml = (value) =>
    (value == null ? "" : String(value))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const escapeAttr = (value) => escapeHtml(value).replace(/`/g, "&#96;");

  const cacheBust = (url, token) => {
    const safeUrl = toSafeImageUrl(url);
    if (!safeUrl) return "";
    const separator = safeUrl.includes("?") ? "&" : "?";
    return `${safeUrl}${separator}t=${encodeURIComponent(String(token == null ? 0 : token))}`;
  };

  const formatChapterNumber = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (Math.abs(number - Math.round(number)) < 1e-9) return String(Math.round(number));
    return number.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  };

  const getMangaStatusClass = (value) => {
    const normalized = toText(value).toLowerCase();
    if (normalized === "hoàn thành") return "is-complete";
    if (normalized === "tạm dừng") return "is-hiatus";
    return "is-ongoing";
  };

  const showBookmarkToast = (message, tone = "info", kind = "info") => {
    const text = toText(message);
    if (!text) return;
    if (window.BfangToast && typeof window.BfangToast.show === "function") {
      window.BfangToast.show({ message: text, tone, kind });
    }
  };

  const getSessionSafe = async () => {
    if (window.BfangAuth && typeof window.BfangAuth.getSession === "function") {
      try {
        const session = await window.BfangAuth.getSession();
        return session && ((session.user && typeof session.user === "object") || session.access_token) ? session : null;
      } catch (_err) {
        return null;
      }
    }
    return null;
  };

  const openLoginDialog = () => {
    const loginBtn = document.querySelector("[data-auth-login]");
    if (loginBtn) {
      loginBtn.click();
      return;
    }
    if (window.BfangAuth && typeof window.BfangAuth.signIn === "function") {
      window.BfangAuth.signIn().catch(() => null);
    }
  };

  const requestBookmarkApi = async ({ url, method = "GET", body = null, token = "", signal = undefined } = {}) => {
    const headers = { Accept: "application/json" };
    if (method !== "GET") headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      const response = await fetch(url, {
        method,
        cache: "no-store",
        credentials: "same-origin",
        headers,
        signal,
        body: method === "GET" ? undefined : JSON.stringify(body && typeof body === "object" ? body : {})
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.ok !== true) {
        const errorText = data && data.error ? toText(data.error) : "Không thể xử lý mục đã lưu.";
        return { ok: false, error: errorText || "Không thể xử lý mục đã lưu." };
      }

      return { ok: true, data };
    } catch (error) {
      if (error && error.name === "AbortError") {
        return { ok: false, aborted: true, error: "" };
      }
      return { ok: false, error: "Không thể xử lý mục đã lưu." };
    }
  };

  const dispatchBookmarkUpdated = ({ mangaId, mangaSlug, bookmarked }) => {
    try {
      window.dispatchEvent(
        new CustomEvent("bfang:bookmark-updated", {
          detail: {
            mangaId: Number(mangaId) || 0,
            mangaSlug: toText(mangaSlug),
            bookmarked: Boolean(bookmarked)
          }
        })
      );
    } catch (_err) {
      // ignore
    }
  };

  const requestConfirm = async ({ title, body, confirmText }) => {
    if (window.BfangConfirm && typeof window.BfangConfirm.confirm === "function") {
      return window.BfangConfirm.confirm({
        title: toText(title) || "Xác nhận",
        body: toText(body) || "Bạn có chắc muốn tiếp tục?",
        confirmText: toText(confirmText) || "Xác nhận",
        confirmVariant: "danger",
        fallbackText: toText(body) || "Bạn có chắc muốn tiếp tục?"
      });
    }
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "modal bookmark-modal";
      dialog.innerHTML = `
        <div class="modal-card bookmark-modal-card">
          <h2 class="modal-title bookmark-modal-title">${escapeHtml(toText(title) || "Xác nhận")}</h2>
          <p class="note bookmark-modal-status">${escapeHtml(toText(body) || "Bạn có chắc muốn tiếp tục?")}</p>
          <div class="modal-actions bookmark-modal-actions">
            <button class="button button--ghost" type="button" data-confirm-cancel>Hủy</button>
            <button class="button button--danger" type="button" data-confirm-ok>${escapeHtml(toText(confirmText) || "Xác nhận")}</button>
          </div>
        </div>
      `;

      const cleanup = (value) => {
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(Boolean(value));
      };

      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        cleanup(false);
      });

      const cancelBtn = dialog.querySelector("[data-confirm-cancel]");
      const okBtn = dialog.querySelector("[data-confirm-ok]");
      if (cancelBtn) cancelBtn.addEventListener("click", () => cleanup(false));
      if (okBtn) okBtn.addEventListener("click", () => cleanup(true));

      document.body.appendChild(dialog);
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        cleanup(false);
      }
    });
  };

  const showDialogModal = (dialogElement) => {
    if (!(dialogElement instanceof HTMLDialogElement)) return false;

    if (typeof dialogElement.showModal === "function") {
      if (!dialogElement.open) {
        try {
          dialogElement.showModal();
        } catch (_err) {
          try {
            if (typeof dialogElement.close === "function") {
              dialogElement.close();
            }
            dialogElement.showModal();
          } catch (_retryErr) {
            return false;
          }
        }
      }
      setBookmarkDialogScrollLock(dialogElement, true);
      return true;
    }

    dialogElement.setAttribute("open", "");
    setBookmarkDialogScrollLock(dialogElement, true);
    return true;
  };

  const closeDialogModal = (dialogElement) => {
    if (!(dialogElement instanceof HTMLDialogElement)) return;
    if (!dialogElement.open) {
      setBookmarkDialogScrollLock(dialogElement, false);
      dialogElement.removeAttribute("open");
      return;
    }
    if (typeof dialogElement.close === "function") {
      try {
        dialogElement.close();
        setBookmarkDialogScrollLock(dialogElement, false);
        return;
      } catch (_err) {
        // fallback to attribute close
      }
    }
    setBookmarkDialogScrollLock(dialogElement, false);
    dialogElement.removeAttribute("open");
  };

  let detailButton = null;
  let detailLabel = null;
  let detailIcon = null;
  let detailDialog = null;
  let detailDialogLists = null;
  let detailDialogSaveBtn = null;
  let detailDialogStatus = null;
  let detailDialogCloseBtn = null;
  let detailDialogCancelBtn = null;
  let detailDialogCreateBtn = null;
  let detailCreateDialog = null;
  let detailCreateNameInput = null;
  let detailCreatePrivateInput = null;
  let detailCreateStatus = null;
  let detailCreateSubmit = null;
  let detailCreateCloseBtn = null;
  let detailCreateCancelBtn = null;
  let detailBookmarked = false;
  let detailPending = false;
  let detailCurrentState = null;
  let detailDialogDraftListIds = [];
  let detailLoadPromise = null;
  let detailCreatePending = false;
  let detailSavePending = false;

  const DETAIL_BOUND_ATTR = "data-bookmark-detail-bound";
  const PAGE_BOUND_ATTR = "data-bookmark-page-bound";
  const PAGE_DIALOG_BOUND_ATTR = "data-bookmark-page-dialog-bound";
  const PAGE_MOBILE_SELECT_BOUND_ATTR = "data-bookmark-mobile-select-bound";
  const PAGE_MOBILE_PICKER_BOUND_ATTR = "data-bookmark-mobile-picker-bound";
  const BOOKMARK_DIALOG_SCROLL_LOCK_ATTR = "data-bookmark-dialog-scroll-lock";
  let bookmarkDialogScrollLockCount = 0;
  let bookmarkDialogScrollTop = 0;

  const isBookmarkManagedDialog = (dialogElement) => {
    if (!(dialogElement instanceof HTMLDialogElement)) return false;
    const classes = dialogElement.classList;
    return (
      classes.contains("bookmark-modal") ||
      classes.contains("bookmark-create-modal") ||
      classes.contains("bookmark-list-dialog")
    );
  };

  const lockBookmarkDialogPageScroll = () => {
    if (bookmarkDialogScrollLockCount > 1) return;
    const body = document.body;
    if (!body) return;
    bookmarkDialogScrollTop =
      Number(window.scrollY) ||
      Number(window.pageYOffset) ||
      Number(document.documentElement && document.documentElement.scrollTop) ||
      0;
    body.classList.add("bookmark-dialog-scroll-locked");
    body.style.top = `-${bookmarkDialogScrollTop}px`;
  };

  const unlockBookmarkDialogPageScroll = () => {
    if (bookmarkDialogScrollLockCount > 0) return;
    const body = document.body;
    if (!body) return;
    body.classList.remove("bookmark-dialog-scroll-locked");
    body.style.top = "";
    const restoreY = bookmarkDialogScrollTop;
    bookmarkDialogScrollTop = 0;
    if (Number.isFinite(restoreY) && restoreY > 0) {
      window.scrollTo(0, restoreY);
    }
  };

  const setBookmarkDialogScrollLock = (dialogElement, active) => {
    if (!isBookmarkManagedDialog(dialogElement)) return;
    const isActive = dialogElement.getAttribute(BOOKMARK_DIALOG_SCROLL_LOCK_ATTR) === "1";
    if (active) {
      if (isActive) return;
      dialogElement.setAttribute(BOOKMARK_DIALOG_SCROLL_LOCK_ATTR, "1");
      bookmarkDialogScrollLockCount += 1;
      lockBookmarkDialogPageScroll();
      return;
    }

    if (!isActive) return;
    dialogElement.removeAttribute(BOOKMARK_DIALOG_SCROLL_LOCK_ATTR);
    bookmarkDialogScrollLockCount = Math.max(0, bookmarkDialogScrollLockCount - 1);
    unlockBookmarkDialogPageScroll();
  };

  const setDetailButtonState = () => {
    if (!detailButton || !detailLabel) return;
    const text = detailBookmarked ? "Đã lưu" : "Lưu truyện";
    detailButton.classList.toggle("is-bookmarked", detailBookmarked);
    detailButton.classList.toggle("is-pending", detailPending);
    detailButton.setAttribute("aria-pressed", detailBookmarked ? "true" : "false");
    detailButton.setAttribute("aria-label", text);
    detailButton.setAttribute("title", text);
    detailLabel.textContent = text;
    if (detailIcon) {
      detailIcon.classList.toggle("fa-solid", detailBookmarked);
      detailIcon.classList.toggle("fa-regular", !detailBookmarked);
    }
  };

  const readSelectedDialogListIds = () => {
    if (!detailDialogLists) return [];
    const inputs = Array.from(detailDialogLists.querySelectorAll("[data-bookmark-list-checkbox]"));
    return inputs
      .filter((node) => node instanceof HTMLInputElement && node.checked)
      .map((node) => Number(node.value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.floor(value));
  };

  const setDetailDialogStatus = (text, isError = false) => {
    if (!detailDialogStatus) return;
    const message = toText(text);
    detailDialogStatus.hidden = !message;
    detailDialogStatus.textContent = message;
    detailDialogStatus.classList.toggle("is-error", Boolean(message && isError));
    detailDialogStatus.classList.toggle("is-success", Boolean(message && !isError));
  };

  const renderDetailDialogLists = (state) => {
    if (!detailDialogLists) return;
    const lists = Array.isArray(state && state.lists) ? state.lists.slice() : [];
    if (!lists.length) {
      detailDialogLists.innerHTML = '<p class="note">Chưa có mục lưu nào.</p>';
      return;
    }

    lists.sort((left, right) => {
      const leftIsDefault = Boolean(left && left.isDefaultFollow);
      const rightIsDefault = Boolean(right && right.isDefaultFollow);
      if (leftIsDefault === rightIsDefault) return 0;
      return leftIsDefault ? -1 : 1;
    });

    detailDialogLists.innerHTML = lists
      .map((list) => {
        const listId = Number(list && list.id) || 0;
        const label = toText(list && list.name) || "Mục";
        const selected = Boolean(list && list.selected);
        const isDefault = Boolean(list && list.isDefaultFollow);
        const isPublic = Boolean(list && list.isPublic);
        const stateText = isDefault ? "Theo dõi" : isPublic ? "Công khai" : "Riêng tư";
        const stateClass = isDefault
          ? "is-default"
          : isPublic
            ? "is-public"
            : "is-private";
        const stateIcon = isDefault ? "fa-bell" : isPublic ? "fa-earth-asia" : "fa-lock";
        return `
          <label class="bookmark-picker-option">
            <input class="bookmark-picker-option__check" type="checkbox" value="${listId}" data-bookmark-list-checkbox ${selected ? "checked" : ""} />
            <span class="bookmark-picker-option__content">
              <span class="bookmark-picker-option__name-row">
                <span class="bookmark-picker-option__name" title="${escapeAttr(label)}">${escapeHtml(label)}</span>
                <span class="bookmark-picker-option__state bookmark-role-state ${stateClass}">
                  <i class="fa-solid ${stateIcon}" aria-hidden="true"></i>
                  <span>${stateText}</span>
                </span>
              </span>
            </span>
          </label>
        `;
      })
      .join("");
  };

  const setDetailCreateStatus = (text, isError = false) => {
    if (!detailCreateStatus) return;
    const message = toText(text);
    detailCreateStatus.hidden = !message;
    detailCreateStatus.textContent = message;
    detailCreateStatus.classList.toggle("is-error", Boolean(message && isError));
    detailCreateStatus.classList.toggle("is-success", Boolean(message && !isError));
  };

  const setDetailDialogControlsDisabled = (disabled) => {
    const state = Boolean(disabled);
    if (detailDialogSaveBtn) detailDialogSaveBtn.disabled = state;
    if (detailDialogCreateBtn) detailDialogCreateBtn.disabled = state;
    if (detailDialogCancelBtn) detailDialogCancelBtn.disabled = state;
    if (detailDialogCloseBtn) detailDialogCloseBtn.disabled = state;
    if (detailDialogLists) {
      const checkboxes = detailDialogLists.querySelectorAll("[data-bookmark-list-checkbox]");
      checkboxes.forEach((node) => {
        if (node instanceof HTMLInputElement) node.disabled = state;
      });
    }
  };

  const setDetailCreateControlsDisabled = (disabled) => {
    const state = Boolean(disabled);
    if (detailCreateSubmit) detailCreateSubmit.disabled = state;
    if (detailCreateCancelBtn) detailCreateCancelBtn.disabled = state;
    if (detailCreateCloseBtn) detailCreateCloseBtn.disabled = state;
    if (detailCreateNameInput) detailCreateNameInput.disabled = state;
    if (detailCreatePrivateInput) detailCreatePrivateInput.disabled = state;
  };

  const loadDetailBookmarkState = async () => {
    if (detailLoadPromise) return detailLoadPromise;
    if (!detailButton) return null;
    const mangaSlug = toText(detailButton.getAttribute("data-manga-slug"));
    if (!mangaSlug) return null;

    detailLoadPromise = (async () => {
      const session = await getSessionSafe();
      if (!session) return null;
      const token = toText(session.access_token);

      const result = await requestBookmarkApi({
        url: `${BOOKMARKS_STATE_ENDPOINT}?mangaSlug=${encodeURIComponent(mangaSlug)}`,
        method: "GET",
        token
      });
      if (!result.ok) {
        setDetailDialogStatus(result.error || "Không tải được danh sách lưu.", true);
        return null;
      }
      detailCurrentState = result.data || null;
      detailBookmarked = Boolean(detailCurrentState && detailCurrentState.bookmarked);
      setDetailButtonState();
      renderDetailDialogLists(detailCurrentState);
      return detailCurrentState;
    })().finally(() => {
      detailLoadPromise = null;
    });

    return detailLoadPromise;
  };

  const openDetailCreateDialog = () => {
    if (!detailCreateDialog) return;
    detailDialogDraftListIds = readSelectedDialogListIds();
    if (detailDialog && detailDialog.open) {
      closeDialogModal(detailDialog);
    }
    setDetailCreateStatus("");
    if (detailCreateNameInput) detailCreateNameInput.value = "";
    if (detailCreatePrivateInput) detailCreatePrivateInput.checked = true;
    if (!showDialogModal(detailCreateDialog)) return;
    if (detailCreateNameInput) detailCreateNameInput.focus();
  };

  const restoreMainDialogFromCreate = async ({ listId = 0 } = {}) => {
    if (detailCreateDialog && detailCreateDialog.open) {
      closeDialogModal(detailCreateDialog);
    }
    if (!detailDialog) return;
    if (!detailDialog.open && !showDialogModal(detailDialog)) return;
    await loadDetailBookmarkState();

    if (!detailDialogLists) return;
    const selectedSet = new Set(
      (Array.isArray(detailDialogDraftListIds) ? detailDialogDraftListIds : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value))
    );
    if (Number.isFinite(Number(listId)) && Number(listId) > 0) {
      selectedSet.add(Math.floor(Number(listId)));
    }
    const checkboxes = detailDialogLists.querySelectorAll("[data-bookmark-list-checkbox]");
    checkboxes.forEach((node) => {
      if (!(node instanceof HTMLInputElement)) return;
      const value = Math.floor(Number(node.value));
      node.checked = selectedSet.has(value);
    });
    detailDialogDraftListIds = Array.from(selectedSet);
  };

  const submitDetailCreateDialog = async () => {
    if (!detailCreateSubmit || detailCreatePending) return;
    detailCreatePending = true;
    setDetailCreateControlsDisabled(true);
    try {
      const name = toText(detailCreateNameInput && detailCreateNameInput.value);
      if (!name) {
        setDetailCreateStatus("Vui lòng nhập tên mục.", true);
        return;
      }
      if (name.length > BOOKMARK_LIST_NAME_MAX_LENGTH) {
        setDetailCreateStatus(`Tên mục tối đa ${BOOKMARK_LIST_NAME_MAX_LENGTH} ký tự.`, true);
        return;
      }
      const isPublic = !(detailCreatePrivateInput && detailCreatePrivateInput.checked);

      const session = await getSessionSafe();
      if (!session) {
        openLoginDialog();
        return;
      }
      const token = toText(session.access_token);

      const result = await requestBookmarkApi({
        url: BOOKMARKS_LIST_CREATE_ENDPOINT,
        method: "POST",
        body: { name, isPublic },
        token
      });

      if (!result.ok) {
        setDetailCreateStatus(result.error || "Không thể tạo mục.", true);
        return;
      }

      const data = result.data || {};
      const createdList = data && data.list && typeof data.list === "object" ? data.list : null;
      await restoreMainDialogFromCreate({
        listId: createdList && createdList.id ? Number(createdList.id) : 0
      });
    } finally {
      detailCreatePending = false;
      setDetailCreateControlsDisabled(false);
    }
  };

  const saveDetailBookmarkSelection = async () => {
    if (!detailButton || !detailDialogSaveBtn || detailSavePending) return;
    detailSavePending = true;
    setDetailDialogControlsDisabled(true);
    const selectedListIds = readSelectedDialogListIds();
    const mangaSlug = toText(detailButton.getAttribute("data-manga-slug"));
    if (!mangaSlug) {
      detailSavePending = false;
      setDetailDialogControlsDisabled(false);
      return;
    }

    try {
      const session = await getSessionSafe();
      if (!session) {
        openLoginDialog();
        return;
      }
      const token = toText(session.access_token);

      const result = await requestBookmarkApi({
        url: BOOKMARKS_MANAGE_ENDPOINT,
        method: "POST",
        body: { mangaSlug, listIds: selectedListIds },
        token
      });
      if (!result.ok) {
        setDetailDialogStatus(result.error || "Không thể lưu vào mục.", true);
        return;
      }

      const data = result.data || {};
      detailBookmarked = Boolean(data.bookmarked);
      setDetailButtonState();
      dispatchBookmarkUpdated({
        mangaId: Number(data.mangaId) || 0,
        mangaSlug: toText(data.mangaSlug || mangaSlug),
        bookmarked: detailBookmarked
      });
      showBookmarkToast("Đã cập nhật danh sách lưu.", "success", "create");
      if (detailDialog && detailDialog.open) {
        closeDialogModal(detailDialog);
      }
    } finally {
      detailSavePending = false;
      setDetailDialogControlsDisabled(false);
    }
  };

  const openDetailDialog = async () => {
    if (!detailDialog) return;

    const session = await getSessionSafe();
    if (!session) {
      openLoginDialog();
      showBookmarkToast("Vui lòng đăng nhập để lưu truyện.", "warning", "auth");
      return;
    }

    setDetailDialogStatus("");
    detailDialogDraftListIds = [];
    renderDetailDialogLists({ lists: [] });
    if (!showDialogModal(detailDialog)) return;
    await loadDetailBookmarkState();
  };

  const bindDetailBookmark = () => {
    detailButton = document.querySelector("[data-manga-bookmark-button]");
    if (!detailButton) return;
    detailLabel = detailButton.querySelector("[data-bookmark-label]");
    detailIcon = detailButton.querySelector("[data-bookmark-icon]");
    detailBookmarked = detailButton.getAttribute("data-bookmarked") === "1";
    setDetailButtonState();

    detailDialog = document.querySelector("[data-manga-bookmark-dialog]");
    detailDialogLists = detailDialog ? detailDialog.querySelector("[data-manga-bookmark-dialog-lists]") : null;
    detailDialogSaveBtn = detailDialog ? detailDialog.querySelector("[data-manga-bookmark-dialog-save]") : null;
    detailDialogStatus = detailDialog ? detailDialog.querySelector("[data-manga-bookmark-dialog-status]") : null;
    detailDialogCloseBtn = detailDialog ? detailDialog.querySelector("[data-manga-bookmark-dialog-close]") : null;
    detailDialogCancelBtn = detailDialog ? detailDialog.querySelector("[data-manga-bookmark-dialog-cancel]") : null;
    detailDialogCreateBtn = detailDialog ? detailDialog.querySelector("[data-manga-bookmark-dialog-create-list]") : null;
    detailCreateDialog = document.querySelector("[data-manga-bookmark-create-dialog]");
    detailCreateNameInput = detailCreateDialog ? detailCreateDialog.querySelector("[data-manga-bookmark-create-name]") : null;
    detailCreatePrivateInput = detailCreateDialog ? detailCreateDialog.querySelector("[data-manga-bookmark-create-private]") : null;
    detailCreateStatus = detailCreateDialog ? detailCreateDialog.querySelector("[data-manga-bookmark-create-status]") : null;
    detailCreateSubmit = detailCreateDialog ? detailCreateDialog.querySelector("[data-manga-bookmark-create-submit]") : null;
    detailCreateCloseBtn = detailCreateDialog ? detailCreateDialog.querySelector("[data-manga-bookmark-create-close]") : null;
    detailCreateCancelBtn = detailCreateDialog ? detailCreateDialog.querySelector("[data-manga-bookmark-create-cancel]") : null;

    if (detailButton.getAttribute(DETAIL_BOUND_ATTR) === "1") {
      return;
    }
    detailButton.setAttribute(DETAIL_BOUND_ATTR, "1");

    detailButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (detailPending) return;
      detailPending = true;
      setDetailButtonState();
      openDetailDialog()
        .catch(() => {
          showBookmarkToast("Không thể mở danh sách lưu.", "error", "error");
        })
        .finally(() => {
          detailPending = false;
          setDetailButtonState();
        });
    });

    if (detailDialog) {
      if (detailDialogCloseBtn) {
        detailDialogCloseBtn.addEventListener("click", () => {
          if (detailSavePending || detailCreatePending) return;
          closeDialogModal(detailDialog);
        });
      }
      if (detailDialogCancelBtn) {
        detailDialogCancelBtn.addEventListener("click", () => {
          if (detailSavePending || detailCreatePending) return;
          closeDialogModal(detailDialog);
        });
      }
      if (detailDialogCreateBtn) {
        detailDialogCreateBtn.addEventListener("click", () => {
          if (detailSavePending || detailCreatePending) return;
          openDetailCreateDialog();
        });
      }
      if (detailDialogSaveBtn) {
        detailDialogSaveBtn.addEventListener("click", () => {
          saveDetailBookmarkSelection().catch(() => {
            setDetailDialogStatus("Không thể lưu vào mục.", true);
          });
        });
      }
      detailDialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        if (detailSavePending || detailCreatePending) return;
        closeDialogModal(detailDialog);
      });
    }

    if (detailCreateDialog) {
      const closeCreateDialog = () => {
        if (detailCreatePending) return;
        restoreMainDialogFromCreate().catch(() => {
          if (detailCreateDialog.open) closeDialogModal(detailCreateDialog);
        });
      };

      if (detailCreateCloseBtn) detailCreateCloseBtn.addEventListener("click", closeCreateDialog);
      if (detailCreateCancelBtn) detailCreateCancelBtn.addEventListener("click", closeCreateDialog);
      if (detailCreateSubmit) {
        detailCreateSubmit.addEventListener("click", () => {
          submitDetailCreateDialog().catch(() => {
            setDetailCreateStatus("Không thể tạo mục.", true);
          });
        });
      }
      if (detailCreateNameInput) {
        detailCreateNameInput.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          submitDetailCreateDialog().catch(() => {
            setDetailCreateStatus("Không thể tạo mục.", true);
          });
        });
      }
      detailCreateDialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        if (detailCreatePending) return;
        closeCreateDialog();
      });
    }
  };

  let pageRoot = null;
  let pageLocked = null;
  let pageContent = null;
  let pageStatus = null;
  let pageEmpty = null;
  let pageList = null;
  let pagePagination = null;
  let pageLists = null;
  let pageSearchInput = null;
  let pageSortSelect = null;
  let pageMobileListPicker = null;
  let pageMobileListControl = null;
  let pageMobileListTrigger = null;
  let pageMobileListTriggerName = null;
  let pageMobileListTriggerState = null;
  let pageMobileListMenu = null;
  let pageMobileListSelect = null;
  let pageMobileListMenuOpen = false;
  let pageListsPanel = null;
  let pageLayout = null;
  let pageTitle = null;
  let pageMeta = null;
  let pageHeroTitle = null;
  let pageHeroSubtitle = null;
  let pageShareBtn = null;
  let pageEditBtn = null;
  let pageDeleteBtn = null;
  let pagePublicToken = "";
  let pagePublicOwnerName = "";

  let dialog = null;
  let dialogTitle = null;
  let dialogNameInput = null;
  let dialogPublicInput = null;
  let dialogStatus = null;
  let dialogSubmit = null;
  let dialogSubmitLabel = null;
  let dialogCloseButton = null;
  let dialogCancelButton = null;
  let dialogMode = "create";
  let dialogEditingListId = 0;
  let dialogPending = false;

  let pageLoading = false;
  let pageCurrentPage = 1;
  let pageCurrentListId = 0;
  let pageListsData = [];
  let pageSearchTerm = "";
  let pageSortOrder = BOOKMARK_SORT_NEW;
  let pagePerPage = BOOKMARKS_PER_PAGE_WIDE;
  let pageSearchDebounceTimer = null;
  let pageSearchInputComposing = false;
  let pageResizeDebounceTimer = null;
  let pageResizeBound = false;
  let pageLoadRequestId = 0;
  let pageLoadController = null;

  const setPageLocked = (locked) => {
    if (pageLocked) pageLocked.hidden = !locked;
    if (pageContent) pageContent.hidden = locked;
  };

  const setPageStatus = (message, variant = "") => {
    if (!pageStatus) return;
    const text = toText(message);
    pageStatus.hidden = !text;
    pageStatus.textContent = text;
    pageStatus.classList.toggle("is-error", Boolean(text && variant === "error"));
    pageStatus.classList.toggle("is-success", Boolean(text && variant === "success"));
  };

  const splitTopLevelBySpace = (value) => {
    const text = toText(value);
    if (!text) return [];

    const tokens = [];
    let current = "";
    let depth = 0;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (/\s/.test(char) && depth === 0) {
        if (current) {
          tokens.push(current);
          current = "";
        }
        continue;
      }
      if (char === "(") depth += 1;
      if (char === ")") depth = Math.max(0, depth - 1);
      current += char;
    }

    if (current) tokens.push(current);
    return tokens;
  };

  const countColumnsFromTemplate = (templateValue) => {
    const tracks = splitTopLevelBySpace(templateValue);
    if (!tracks.length) return 0;

    let count = 0;
    for (const track of tracks) {
      const autoRepeatMatch = track.match(/^repeat\(\s*auto-(?:fit|fill)\s*,/i);
      if (autoRepeatMatch) return 0;

      const fixedRepeatMatch = track.match(/^repeat\(\s*(\d+)\s*,/i);
      if (fixedRepeatMatch) {
        const repeatCount = Number(fixedRepeatMatch[1]);
        if (Number.isFinite(repeatCount) && repeatCount > 0) {
          count += Math.floor(repeatCount);
        }
        continue;
      }

      count += 1;
    }

    return count;
  };

  const countColumnsFromRenderedItems = () => {
    if (!pageList) return 0;
    const cards = Array.from(pageList.children).filter((node) => node instanceof HTMLElement);
    if (!cards.length) return 0;

    const firstTop = Math.round(cards[0].getBoundingClientRect().top);
    let count = 0;

    for (const card of cards) {
      const top = Math.round(card.getBoundingClientRect().top);
      if (Math.abs(top - firstTop) > 2) break;
      count += 1;
    }

    return count;
  };

  const resolveBookmarkGridColumns = () => {
    if (!pageList || typeof window.getComputedStyle !== "function") return 0;
    const computedStyle = window.getComputedStyle(pageList);
    const templateColumns = computedStyle ? computedStyle.gridTemplateColumns : "";
    const fromTemplate = countColumnsFromTemplate(templateColumns);
    const fromRendered = countColumnsFromRenderedItems();
    return Math.max(fromTemplate, fromRendered);
  };

  const resolveBookmarkPerPageLimit = () => {
    const columns = resolveBookmarkGridColumns();
    if (columns >= 5) return BOOKMARKS_PER_PAGE_WIDE;
    return BOOKMARKS_PER_PAGE_COMPACT;
  };

  const scheduleBookmarkResizeSync = () => {
    if (!pageRoot || !pageContent || pageContent.hidden || pageLoading) return;

    if (pageResizeDebounceTimer) {
      window.clearTimeout(pageResizeDebounceTimer);
    }

    pageResizeDebounceTimer = window.setTimeout(() => {
      pageResizeDebounceTimer = null;
      const nextPerPage = resolveBookmarkPerPageLimit();
      if (nextPerPage === pagePerPage) return;
      pagePerPage = nextPerPage;

      loadBookmarkPage({
        page: pageCurrentPage,
        listId: pageCurrentListId,
        search: pageSearchTerm,
        sort: pageSortOrder,
        keepStatus: true
      }).catch(() => {
        setPageStatus("Không thể tải danh sách đã lưu.", "error");
      });
    }, BOOKMARKS_PER_PAGE_RESIZE_DEBOUNCE_MS);
  };

  const applyBookmarkQueryState = ({ query, fallbackSearch, fallbackSort } = {}) => {
    const queryState = query && typeof query === "object" ? query : {};
    const resolvedSearch = normalizeBookmarkSearchTerm(
      queryState.search == null ? fallbackSearch : queryState.search
    );
    const resolvedSort = normalizeBookmarkSortOrder(
      queryState.sort == null ? fallbackSort : queryState.sort
    );

    pageSearchTerm = resolvedSearch;
    pageSortOrder = resolvedSort;

    const canSyncSearchInput =
      pageSearchInput &&
      document.activeElement !== pageSearchInput &&
      !pageSearchInputComposing;
    if (canSyncSearchInput && pageSearchInput.value !== resolvedSearch) {
      pageSearchInput.value = resolvedSearch;
    }
    if (pageSortSelect && pageSortSelect.value !== resolvedSort) {
      pageSortSelect.value = resolvedSort;
    }

    const minSearchLength = Number(queryState.minSearchLength) || 2;
    const searchTooShort = Boolean(queryState.searchTooShort) && resolvedSearch.length > 0;

    return {
      search: resolvedSearch,
      sort: resolvedSort,
      minSearchLength,
      searchTooShort
    };
  };

  const resolvePublicOwnerName = (value) => {
    const safeName = toText(value);
    return safeName || "người dùng";
  };

  const updatePublicShareHero = (list) => {
    if (!pagePublicToken) return;
    const ownerName = resolvePublicOwnerName((list && list.ownerName) || pagePublicOwnerName);
    if (pageHeroTitle) pageHeroTitle.textContent = "Danh sách truyện";
    if (pageHeroSubtitle) {
      pageHeroSubtitle.textContent = `Đây là danh sách truyện được chia sẻ công khai của ${ownerName}`;
    }
  };

  const readPageStateFromUrl = () => {
    try {
      const url = new URL(window.location.href);
      const page = Number(url.searchParams.get("page"));
      const listId = Number(url.searchParams.get("listId"));
      const search = normalizeBookmarkSearchTerm(url.searchParams.get("search") || "");
      const sort = normalizeBookmarkSortOrder(url.searchParams.get("sort"));
      return {
        page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
        listId: Number.isFinite(listId) && listId > 0 ? Math.floor(listId) : 0,
        search,
        sort
      };
    } catch (_err) {
      return { page: 1, listId: 0, search: "", sort: BOOKMARK_SORT_NEW };
    }
  };

  const writePageStateToUrl = ({ page, listId, search, sort }) => {
    if (!window.history || typeof window.history.replaceState !== "function") return;
    const url = new URL(window.location.href);
    const safeSearch = normalizeBookmarkSearchTerm(search);
    const safeSort = normalizeBookmarkSortOrder(sort);
    if (page > 1) url.searchParams.set("page", String(page));
    else url.searchParams.delete("page");
    if (pagePublicToken) {
      url.searchParams.delete("listId");
    } else if (listId > 0) {
      url.searchParams.set("listId", String(listId));
    } else {
      url.searchParams.delete("listId");
    }
    if (safeSearch) {
      url.searchParams.set("search", safeSearch);
    } else {
      url.searchParams.delete("search");
    }
    if (safeSort !== BOOKMARK_SORT_NEW) {
      url.searchParams.set("sort", safeSort);
    } else {
      url.searchParams.delete("sort");
    }
    window.history.replaceState(window.history.state || null, document.title, `${url.pathname}${url.search}`);
  };

  const buildVisiblePageNumbers = (page, totalPages) => {
    const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
    const safeTotal = Number.isFinite(Number(totalPages)) && Number(totalPages) > 0 ? Math.floor(Number(totalPages)) : 1;

    if (safeTotal <= 6) {
      return Array.from({ length: safeTotal }, (_item, index) => index + 1);
    }
    if (safePage <= 3) {
      return [1, 2, 3, 4, "...", safeTotal];
    }
    if (safePage >= safeTotal - 2) {
      return [1, "...", safeTotal - 3, safeTotal - 2, safeTotal - 1, safeTotal];
    }
    return [1, "...", safePage - 1, safePage, safePage + 1, "...", safeTotal];
  };

  const renderPagePagination = (pagination) => {
    if (!pagePagination) return;
    const totalPages = pagination && pagination.totalPages ? Number(pagination.totalPages) : 1;
    const currentPage = pagination && pagination.page ? Number(pagination.page) : 1;
    if (!Number.isFinite(totalPages) || totalPages <= 1) {
      pagePagination.hidden = true;
      pagePagination.innerHTML = "";
      return;
    }
    const safePage = Number.isFinite(currentPage) && currentPage > 0 ? Math.floor(currentPage) : 1;
    const hasPrev = safePage > 1;
    const hasNext = safePage < totalPages;
    const prev = Math.max(1, safePage - 1);
    const next = Math.min(totalPages, safePage + 1);
    const pageNumbers = buildVisiblePageNumbers(safePage, totalPages);

    pagePagination.hidden = false;
    pagePagination.innerHTML = `
      <nav class="admin-pagination" aria-label="Phân trang truyện">
        <button
          class="button button--ghost ${hasPrev ? "" : "is-disabled"}"
          type="button"
          data-bookmark-page-link
          data-page="${prev}"
          aria-label="Trang trước"
          ${hasPrev ? "" : "disabled aria-disabled=\"true\""}
        >
          Trước
        </button>

        <div class="admin-pagination__numbers">
          ${pageNumbers.map((item) => {
    if (item === "...") return '<span class="admin-pagination__dots">...</span>';
    if (item === safePage) return `<span class="chip">${item}</span>`;
    return `<button class="button button--ghost" type="button" data-bookmark-page-link data-page="${item}">${item}</button>`;
  }).join("")}
        </div>

        <button
          class="button button--ghost ${hasNext ? "" : "is-disabled"}"
          type="button"
          data-bookmark-page-link
          data-page="${next}"
          aria-label="Trang sau"
          ${hasNext ? "" : "disabled aria-disabled=\"true\""}
        >
          Sau
        </button>
      </nav>
    `;

    const prevButton = pagePagination.querySelector('[data-bookmark-page-link][aria-label="Trang trước"]');
    if (prevButton instanceof HTMLElement) {
      prevButton.textContent = "Trước";
    }
    const nextButton = pagePagination.querySelector('[data-bookmark-page-link][aria-label="Trang sau"]');
    if (nextButton instanceof HTMLElement) {
      nextButton.textContent = "Sau";
    }
  };

  const renderPageItems = (items) => {
    if (!pageList || !pageEmpty) return;
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      pageList.innerHTML = "";
      pageEmpty.hidden = false;
      return;
    }

    pageEmpty.hidden = true;
    pageList.innerHTML = rows
      .map((item) => {
        const mangaId = Number(item && item.mangaId) || 0;
        const title = toText(item && item.mangaTitle) || "Truyện";
        const safeUrl = toSafePath(item && item.mangaUrl) || "/manga";
        const author = toText(item && item.mangaGroupName) || toText(item && item.mangaAuthor) || "BFANG Team";
        const status = toText(item && item.mangaStatus) || "Đang theo dõi";
        const statusClass = getMangaStatusClass(status);
        const coverUrl = cacheBust(item && item.mangaCover, item && item.mangaCoverUpdatedAt);
        const latestLabel = toText(item && item.latestChapterLabel) || "Tiếp tục đọc";
        return `
          <article class="manga-card manga-card--list manga-card--saved bookmark-card" data-bookmark-item data-bookmark-manga-id="${mangaId}">
            <a href="${escapeAttr(safeUrl)}">
              <div class="cover">
                ${coverUrl
            ? `<img src="${escapeAttr(coverUrl)}" alt="Bìa ${escapeAttr(title)}" />`
            : '<span class="cover__label">Chưa có bìa</span>'}
                <span class="manga-badge ${statusClass}">${escapeHtml(status)}</span>
                <span class="manga-chapter-label">${escapeHtml(latestLabel)}</span>
              </div>
              <div class="manga-body">
                <h3 title="${escapeAttr(title)}">${escapeHtml(title)}</h3>
                <p class="manga-author">${escapeHtml(author)}</p>
              </div>
            </a>
            ${pagePublicToken
            ? ""
            : `<button class="saved-remove-button" type="button" data-bookmark-remove data-manga-id="${mangaId}" title="Gỡ khỏi mục" aria-label="Gỡ ${escapeAttr(title)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i><span class="sr-only">Gỡ khỏi mục</span></button>`}
          </article>
        `;
      })
      .join("");
  };

  const resolveBookmarkListStateMeta = (list) => {
    const isDefault = Boolean(list && list.isDefaultFollow);
    const isPublic = Boolean(list && list.isPublic);
    if (isDefault) {
      return {
        text: "Theo dõi",
        className: "is-default",
        icon: "fa-bell"
      };
    }
    if (isPublic) {
      return {
        text: "Công khai",
        className: "is-public",
        icon: "fa-earth-asia"
      };
    }
    return {
      text: "Riêng tư",
      className: "is-private",
      icon: "fa-lock"
    };
  };

  const resolveBookmarkListDisplayName = (list) => {
    const baseName = toText(list && list.name) || "Mục";
    const rawCount = Number(list && list.itemCount);
    const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0;
    return `${baseName} (${count.toLocaleString("vi-VN")})`;
  };

  const setMobileListPickerOpen = (nextOpen) => {
    if (!pageMobileListControl || !pageMobileListTrigger || !pageMobileListMenu) return;
    const open = Boolean(nextOpen);
    pageMobileListMenuOpen = open;
    pageMobileListControl.classList.toggle("is-open", open);
    pageMobileListMenu.hidden = !open;
    pageMobileListTrigger.setAttribute("aria-expanded", open ? "true" : "false");
  };

  const updateMobileListPickerTrigger = (list) => {
    if (!pageMobileListTriggerName || !pageMobileListTriggerState) return;
    const listName = resolveBookmarkListDisplayName(list);
    const stateMeta = resolveBookmarkListStateMeta(list);
    pageMobileListTriggerName.textContent = listName;
    pageMobileListTriggerState.classList.remove("is-default", "is-public", "is-private");
    pageMobileListTriggerState.classList.add(stateMeta.className);
    pageMobileListTriggerState.innerHTML = `<i class="fa-solid ${stateMeta.icon}" aria-hidden="true"></i><span>${escapeHtml(stateMeta.text)}</span>`;
    pageMobileListTriggerState.hidden = false;
  };

  const renderListSidebar = () => {
    if (!pageLists) return;
    if (pagePublicToken) {
      pageLists.innerHTML = "";
      return;
    }
    pageLists.innerHTML = pageListsData
      .map((list) => {
        const active = list.id === pageCurrentListId;
        const count = Number(list.itemCount) || 0;
        const listName = toText(list && list.name) || "Mục";
        const stateMeta = resolveBookmarkListStateMeta(list);
        return `
          <button class="bookmark-list-item ${active ? "is-active" : ""}" type="button" data-bookmark-list-select data-list-id="${list.id}">
            <span class="bookmark-list-item__main">
              <span class="bookmark-list-item__name">${escapeHtml(listName)}</span>
              <span class="bookmark-list-item__state bookmark-role-state ${stateMeta.className}">
                <i class="fa-solid ${stateMeta.icon}" aria-hidden="true"></i>
                <span>${stateMeta.text}</span>
              </span>
            </span>
            <span class="bookmark-list-item__count">${count}</span>
          </button>
        `;
      })
      .join("");
  };

  const renderMobileListPicker = () => {
    if (!pageMobileListPicker || !pageMobileListSelect || !pageMobileListMenu) return;

    if (pagePublicToken) {
      setMobileListPickerOpen(false);
      pageMobileListPicker.hidden = true;
      pageMobileListSelect.innerHTML = "";
      pageMobileListMenu.innerHTML = "";
      return;
    }

    const lists = Array.isArray(pageListsData) ? pageListsData : [];
    if (!lists.length) {
      setMobileListPickerOpen(false);
      pageMobileListPicker.hidden = true;
      pageMobileListSelect.innerHTML = "";
      pageMobileListMenu.innerHTML = "";
      return;
    }

    const selectedListId = Number.isFinite(Number(pageCurrentListId)) && pageCurrentListId > 0
      ? Math.floor(pageCurrentListId)
      : Number(lists[0] && lists[0].id) || 0;
    const selectedList = lists.find((list) => Number(list && list.id) === selectedListId) || lists[0] || null;

    pageMobileListSelect.innerHTML = lists
      .map((list) => {
        const listId = Number(list && list.id) || 0;
        const listName = resolveBookmarkListDisplayName(list);
        const stateMeta = resolveBookmarkListStateMeta(list);
        const optionText = `${listName} · ${stateMeta.text}`;
        return `<option value="${listId}">${escapeHtml(optionText)}</option>`;
      })
      .join("");

    pageMobileListMenu.innerHTML = lists
      .map((list) => {
        const listId = Number(list && list.id) || 0;
        const listName = resolveBookmarkListDisplayName(list);
        const stateMeta = resolveBookmarkListStateMeta(list);
        const active = selectedList && Number(selectedList.id) === listId;
        return `
          <button class="bookmark-mobile-list-option ${active ? "is-active" : ""}" type="button" data-bookmark-mobile-list-option data-list-id="${listId}" role="option" aria-selected="${active ? "true" : "false"}">
            <span class="bookmark-mobile-list-option__name">${escapeHtml(listName)}</span>
            <span class="bookmark-role-state ${stateMeta.className}">
              <i class="fa-solid ${stateMeta.icon}" aria-hidden="true"></i>
              <span>${stateMeta.text}</span>
            </span>
          </button>
        `;
      })
      .join("");

    if (selectedListId > 0) {
      pageMobileListSelect.value = String(selectedListId);
    }
    updateMobileListPickerTrigger(selectedList);
    setMobileListPickerOpen(false);
    pageMobileListPicker.hidden = false;
  };

  const updateActiveListMeta = (list) => {
    if (pageTitle) pageTitle.textContent = list ? list.name || "Danh sách" : "Danh sách";
    if (pageMeta) {
      if (!list) {
        pageMeta.textContent = "";
      } else {
        const itemCount = Number(list && list.itemCount) || 0;
        const itemText = `${itemCount.toLocaleString("vi-VN")} truyện`;
        if (list.isDefaultFollow) {
          pageMeta.textContent = `Mục mặc định nhận thông báo chương mới · ${itemText}.`;
        } else {
          pageMeta.textContent = `${list.isPublic ? "Mục công khai — có thể chia sẻ liên kết" : "Mục riêng tư"} · ${itemText}.`;
        }
      }
    }

    const canManage = Boolean(list) && !pagePublicToken && !list.isDefaultFollow;
    const hasShareUrl = Boolean(list && toText(list.shareUrl));
    if (pageShareBtn) pageShareBtn.hidden = !(list && list.isPublic && hasShareUrl);
    if (pageEditBtn) pageEditBtn.hidden = !canManage;
    if (pageDeleteBtn) pageDeleteBtn.hidden = !canManage;
  };

  const clearPageSearchDebounce = () => {
    if (!pageSearchDebounceTimer) return;
    window.clearTimeout(pageSearchDebounceTimer);
    pageSearchDebounceTimer = null;
  };

  const shouldRunPageSearch = (nextRawValue) => {
    const previousSearch = pageSearchTerm;
    const nextSearch = normalizeBookmarkSearchTerm(nextRawValue || "");
    if (nextSearch === pageSearchTerm) return false;

    pageSearchTerm = nextSearch;

    const skipInitialShortQuery =
      nextSearch.length > 0 &&
      nextSearch.length < 2 &&
      previousSearch.length < 2;
    return !skipInitialShortQuery;
  };

  const schedulePageSearchLoad = () => {
    clearPageSearchDebounce();
    pageSearchDebounceTimer = window.setTimeout(() => {
      pageSearchDebounceTimer = null;
      loadBookmarkPage({
        page: 1,
        listId: pageCurrentListId,
        search: pageSearchTerm,
        sort: pageSortOrder
      }).catch(() => {
        setPageStatus("Không thể tải danh sách đã lưu.", "error");
      });
    }, BOOKMARK_PAGE_SEARCH_DEBOUNCE_MS);
  };

  const loadBookmarkPage = async ({ page, listId, search, sort, keepStatus = false } = {}) => {
    if (!pageRoot) return;

    pageLoadRequestId += 1;
    const requestId = pageLoadRequestId;
    if (pageLoadController) {
      try {
        pageLoadController.abort();
      } catch (_err) {
        // ignore abort errors
      }
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    pageLoadController = controller;
    const isStaleRequest = () => requestId !== pageLoadRequestId;

    pageLoading = true;
    if (!keepStatus) setPageStatus("");

    try {
      const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
      const safeListId = Number.isFinite(Number(listId)) && Number(listId) > 0 ? Math.floor(Number(listId)) : 0;
      const safeSearch = normalizeBookmarkSearchTerm(search == null ? pageSearchTerm : search);
      const safeSort = normalizeBookmarkSortOrder(sort == null ? pageSortOrder : sort);
      const safeLimit = resolveBookmarkPerPageLimit();
      pageSearchTerm = safeSearch;
      pageSortOrder = safeSort;
      pagePerPage = safeLimit;

      const canSyncSearchInput =
        pageSearchInput &&
        document.activeElement !== pageSearchInput &&
        !pageSearchInputComposing;
      if (canSyncSearchInput && pageSearchInput.value !== safeSearch) {
        pageSearchInput.value = safeSearch;
      }
      if (pageSortSelect && pageSortSelect.value !== safeSort) {
        pageSortSelect.value = safeSort;
      }

      if (pagePublicToken) {
        setPageLocked(false);
        const publicQuery = new URLSearchParams({
          page: String(safePage),
          limit: String(safeLimit),
          sort: safeSort
        });
        if (safeSearch) publicQuery.set("search", safeSearch);

        const result = await requestBookmarkApi({
          url: `${BOOKMARKS_PUBLIC_ENDPOINT_PREFIX}/${encodeURIComponent(pagePublicToken)}?${publicQuery.toString()}`,
          method: "GET",
          signal: controller ? controller.signal : undefined
        });
        if (isStaleRequest()) return;
        if (!result.ok) {
          if (!result.aborted) {
            setPageStatus(result.error || "Không tải được danh sách công khai.", "error");
          }
          return;
        }
        const data = result.data || {};
        const list = data.list || null;
        if (list) {
          pageListsData = [list];
          pageCurrentListId = Number(list.id) || 0;
          updatePublicShareHero(list);
          updateActiveListMeta(list);
        } else {
          pageListsData = [];
          pageCurrentListId = 0;
          updatePublicShareHero(null);
          updateActiveListMeta(null);
        }
        renderMobileListPicker();
        renderPageItems(Array.isArray(data.items) ? data.items : []);
        renderPagePagination(data.pagination || null);
        const queryState = applyBookmarkQueryState({
          query: data.query,
          fallbackSearch: safeSearch,
          fallbackSort: safeSort
        });
        if (queryState.searchTooShort) {
          setPageStatus(`Nhập ít nhất ${queryState.minSearchLength} ký tự để tìm kiếm.`);
        }
        pageCurrentPage = data.pagination && Number(data.pagination.page) > 0 ? Math.floor(Number(data.pagination.page)) : 1;
        writePageStateToUrl({
          page: pageCurrentPage,
          listId: pageCurrentListId,
          search: queryState.search,
          sort: queryState.sort
        });
        return;
      }

      const session = await getSessionSafe();
      if (isStaleRequest()) return;
      if (!session) {
        setPageLocked(true);
        if (pageList) pageList.innerHTML = "";
        if (pagePagination) {
          pagePagination.hidden = true;
          pagePagination.innerHTML = "";
        }
        return;
      }

      setPageLocked(false);
      const token = toText(session.access_token);
      const query = new URLSearchParams({
        page: String(safePage),
        limit: String(safeLimit),
        sort: safeSort
      });
      if (safeListId > 0) query.set("listId", String(safeListId));
      if (safeSearch) query.set("search", safeSearch);

      const result = await requestBookmarkApi({
        url: `${BOOKMARKS_ENDPOINT}?${query.toString()}`,
        method: "GET",
        token,
        signal: controller ? controller.signal : undefined
      });
      if (isStaleRequest()) return;
      if (!result.ok) {
        if (!result.aborted) {
          setPageStatus(result.error || "Không tải được danh sách đã lưu.", "error");
        }
        return;
      }

      const data = result.data || {};
      pageListsData = Array.isArray(data.lists) ? data.lists : [];
      pageCurrentListId = Number(data.selectedListId) || 0;
      pageCurrentPage = data.pagination && Number(data.pagination.page) > 0 ? Math.floor(Number(data.pagination.page)) : 1;

      renderListSidebar();
      renderMobileListPicker();
      updateActiveListMeta(data.selectedList || pageListsData.find((list) => list.id === pageCurrentListId) || null);
      renderPageItems(Array.isArray(data.items) ? data.items : []);
      renderPagePagination(data.pagination || null);
      const queryState = applyBookmarkQueryState({
        query: data.query,
        fallbackSearch: safeSearch,
        fallbackSort: safeSort
      });
      if (queryState.searchTooShort) {
        setPageStatus(`Nhập ít nhất ${queryState.minSearchLength} ký tự để tìm kiếm.`);
      }
      writePageStateToUrl({
        page: pageCurrentPage,
        listId: pageCurrentListId,
        search: queryState.search,
        sort: queryState.sort
      });
    } finally {
      if (pageLoadController === controller) {
        pageLoadController = null;
      }
      if (requestId === pageLoadRequestId) {
        pageLoading = false;
        scheduleBookmarkResizeSync();
      }
    }
  };

  const openListDialog = ({ mode, list }) => {
    if (!dialog) return;
    dialogMode = mode === "edit" ? "edit" : "create";
    dialogEditingListId = list && list.id ? Number(list.id) || 0 : 0;

    if (dialogTitle) dialogTitle.textContent = dialogMode === "edit" ? "Sửa mục" : "Tạo mục mới";
    if (dialogNameInput) dialogNameInput.value = list && list.name ? list.name : "";
    if (dialogPublicInput) dialogPublicInput.checked = Boolean(list && list.isPublic);
    if (dialogSubmitLabel) {
      dialogSubmitLabel.textContent = dialogMode === "edit" ? "Cập nhật" : "Lưu";
    } else if (dialogSubmit) {
      dialogSubmit.textContent = dialogMode === "edit" ? "Cập nhật" : "Lưu";
    }
    setDialogControlsDisabled(false);
    if (dialogStatus) {
      dialogStatus.hidden = true;
      dialogStatus.textContent = "";
      dialogStatus.classList.remove("is-error", "is-success");
    }

    if (!showDialogModal(dialog)) return;
    if (dialogNameInput) dialogNameInput.focus();
  };

  const setDialogStatus = (message, isError = false) => {
    if (!dialogStatus) return;
    const text = toText(message);
    dialogStatus.hidden = !text;
    dialogStatus.textContent = text;
    dialogStatus.classList.toggle("is-error", Boolean(text && isError));
    dialogStatus.classList.toggle("is-success", Boolean(text && !isError));
  };

  const setDialogControlsDisabled = (disabled) => {
    const state = Boolean(disabled);
    dialogPending = state;
    if (dialogSubmit) dialogSubmit.disabled = state;
    if (dialogCloseButton) dialogCloseButton.disabled = state;
    if (dialogCancelButton) dialogCancelButton.disabled = state;
    if (dialogNameInput) dialogNameInput.disabled = state;
    if (dialogPublicInput) dialogPublicInput.disabled = state;
  };

  const closeListDialog = () => {
    if (dialogPending) return;
    closeDialogModal(dialog);
  };

  const submitListDialog = async () => {
    if (!dialogSubmit || dialogPending) return;
    setDialogControlsDisabled(true);

    try {
      const name = toText(dialogNameInput && dialogNameInput.value);
      const isPublic = Boolean(dialogPublicInput && dialogPublicInput.checked);
      if (!name) {
        setDialogStatus("Vui lòng nhập tên mục.", true);
        return;
      }
      if (name.length > BOOKMARK_LIST_NAME_MAX_LENGTH) {
        setDialogStatus(`Tên mục tối đa ${BOOKMARK_LIST_NAME_MAX_LENGTH} ký tự.`, true);
        return;
      }

      const session = await getSessionSafe();
      if (!session) {
        openLoginDialog();
        setDialogStatus("Vui lòng đăng nhập để lưu mục.", true);
        return;
      }
      const token = toText(session.access_token);

      const endpoint = dialogMode === "edit" ? BOOKMARKS_LIST_UPDATE_ENDPOINT : BOOKMARKS_LIST_CREATE_ENDPOINT;
      const body = dialogMode === "edit"
        ? { listId: dialogEditingListId, name, isPublic }
        : { name, isPublic };
      const result = await requestBookmarkApi({
        url: endpoint,
        method: "POST",
        body,
        token
      });

      if (!result.ok) {
        setDialogStatus(result.error || "Không thể lưu mục.", true);
        return;
      }

      closeDialogModal(dialog);
      setPageStatus(dialogMode === "edit" ? "Đã cập nhật mục." : "Đã tạo mục mới.", "success");
      const state = readPageStateFromUrl();
      await loadBookmarkPage({ page: 1, listId: state.listId || pageCurrentListId, keepStatus: true });
    } finally {
      setDialogControlsDisabled(false);
    }
  };

  const removeCurrentList = async () => {
    const target = pageListsData.find((list) => list.id === pageCurrentListId);
    if (!target || target.isDefaultFollow) return;
    const confirmed = await requestConfirm({
      title: "Xóa mục",
      body: `Xóa mục \"${target.name}\"?`,
      confirmText: "Xóa"
    });
    if (!confirmed) return;

    const session = await getSessionSafe();
    if (!session) {
      openLoginDialog();
      return;
    }
    const token = toText(session.access_token);

    const result = await requestBookmarkApi({
      url: BOOKMARKS_LIST_DELETE_ENDPOINT,
      method: "POST",
      body: { listId: target.id },
      token
    });
    if (!result.ok) {
      setPageStatus(result.error || "Không thể xóa mục.", "error");
      return;
    }

    setPageStatus("Đã xóa mục.", "success");
    await loadBookmarkPage({ page: 1, listId: 0, keepStatus: true });
  };

  const removeMangaFromCurrentList = async (mangaId) => {
    const safeMangaId = Number(mangaId);
    if (!Number.isFinite(safeMangaId) || safeMangaId <= 0 || !pageCurrentListId) return;

    const session = await getSessionSafe();
    if (!session) {
      openLoginDialog();
      return;
    }
    const token = toText(session.access_token);

    const result = await requestBookmarkApi({
      url: REMOVE_BOOKMARK_ENDPOINT,
      method: "POST",
      body: { mangaId: Math.floor(safeMangaId), listId: pageCurrentListId },
      token
    });
    if (!result.ok) {
      setPageStatus(result.error || "Không thể gỡ truyện khỏi mục.", "error");
      return;
    }

    setPageStatus("Đã gỡ truyện khỏi mục.", "success");
    const data = result.data || {};
    dispatchBookmarkUpdated({
      mangaId: Math.floor(safeMangaId),
      mangaSlug: "",
      bookmarked: Boolean(data.bookmarked)
    });
    await loadBookmarkPage({ page: pageCurrentPage, listId: pageCurrentListId, keepStatus: true });
  };

  const copyCurrentListShareLink = async () => {
    const target = pageListsData.find((list) => list.id === pageCurrentListId);
    const shareUrl = target && target.shareUrl ? toText(target.shareUrl) : "";
    if (!shareUrl) {
      setPageStatus("Danh mục này chưa có liên kết chia sẻ.", "error");
      return;
    }
    let copied = false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(shareUrl);
        copied = true;
      } catch (_err) {
        copied = false;
      }
    }
    if (!copied) {
      const input = document.createElement("input");
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      copied = document.execCommand("copy");
      input.remove();
    }
    setPageStatus(copied ? "Đã copy link chia sẻ." : "Không thể copy link chia sẻ.", copied ? "success" : "error");
  };

  const setRemoveButtonBusy = (button, isBusy) => {
    if (!(button instanceof HTMLButtonElement)) return;
    const nextState = Boolean(isBusy);
    button.disabled = nextState;
    if (window.BfangButtonUi && typeof window.BfangButtonUi.setLoading === "function") {
      window.BfangButtonUi.setLoading(button, nextState);
      return;
    }
    button.classList.toggle("is-loading", nextState);
    if (nextState) {
      button.setAttribute("aria-busy", "true");
      return;
    }
    button.removeAttribute("aria-busy");
    button.removeAttribute("data-button-auto-loading");
  };

  const ensureBookmarkListDialog = () => {
    let current = document.querySelector("[data-bookmark-list-dialog]");
    if (current instanceof HTMLDialogElement) return current;
    if (!pageRoot) return null;

    const mountTarget = pageRoot.closest(".section") || pageRoot.parentElement || document.body;
    if (!(mountTarget instanceof Element)) return null;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <dialog class="bookmark-list-dialog" data-bookmark-list-dialog aria-label="Tạo mục lưu">
        <div class="bookmark-list-dialog__card">
          <div class="bookmark-list-dialog__head">
            <h2 class="bookmark-list-dialog__title" data-bookmark-list-dialog-title>Tạo mục mới</h2>
            <button class="bookmark-list-dialog__close" type="button" data-bookmark-list-dialog-close aria-label="Đóng">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12"></path>
                <path d="M18 6L6 18"></path>
              </svg>
            </button>
          </div>
          <p class="note bookmark-list-dialog__desc">Đặt tên ngắn gọn để bạn tìm lại truyện nhanh hơn.</p>
          <label class="bookmark-list-dialog__field" for="bookmark-list-name">
            <span class="field-label">Tên mục</span>
            <input class="input" id="bookmark-list-name" type="text" maxlength="20" data-bookmark-list-name-input placeholder="Ví dụ: Đọc cuối tuần" />
          </label>
          <label class="checkbox bookmark-list-privacy">
            <input type="checkbox" data-bookmark-list-public-input />
            <span>Công khai (có thể chia sẻ liên kết)</span>
          </label>
          <p class="note" data-bookmark-list-dialog-status hidden></p>
          <div class="bookmark-list-dialog__actions">
            <button class="button button--ghost" type="button" data-bookmark-list-dialog-cancel>
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              <span>Hủy</span>
            </button>
            <button class="button" type="button" data-bookmark-list-dialog-submit>
              <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
              <span data-bookmark-list-dialog-submit-label>Lưu</span>
            </button>
          </div>
        </div>
      </dialog>
    `;

    const createdDialog = wrapper.firstElementChild;
    if (!(createdDialog instanceof HTMLDialogElement)) return null;
    mountTarget.appendChild(createdDialog);
    return createdDialog;
  };

  const bindBookmarkPage = () => {
    pageRoot = document.querySelector("[data-bookmark-page]");
    if (!pageRoot) return;

    pageLocked = pageRoot.querySelector("[data-bookmark-locked]");
    pageContent = pageRoot.querySelector("[data-bookmark-content]");
    pageStatus = pageRoot.querySelector("[data-bookmark-status]");
    pageEmpty = pageRoot.querySelector("[data-bookmark-empty]");
    pageList = pageRoot.querySelector("[data-bookmark-list]");
    pagePagination = pageRoot.querySelector("[data-bookmark-pagination]");
    pageLists = pageRoot.querySelector("[data-bookmark-lists]");
    pageSearchInput = pageRoot.querySelector("[data-bookmark-search-input]");
    pageSortSelect = pageRoot.querySelector("[data-bookmark-sort-select]");
    pageMobileListPicker = pageRoot.querySelector("[data-bookmark-mobile-list-picker]");
    pageMobileListControl = pageRoot.querySelector("[data-bookmark-mobile-list-control]");
    pageMobileListTrigger = pageRoot.querySelector("[data-bookmark-mobile-list-trigger]");
    pageMobileListTriggerName = pageRoot.querySelector("[data-bookmark-mobile-list-trigger-name]");
    pageMobileListTriggerState = pageRoot.querySelector("[data-bookmark-mobile-list-trigger-state]");
    pageMobileListMenu = pageRoot.querySelector("[data-bookmark-mobile-list-menu]");
    pageMobileListSelect = pageRoot.querySelector("[data-bookmark-mobile-list-select]");
    pageListsPanel = pageRoot.querySelector("[data-bookmark-lists-panel]");
    pageLayout = pageRoot.querySelector(".bookmark-layout");
    pageTitle = pageRoot.querySelector("[data-bookmark-active-list-title]");
    pageMeta = pageRoot.querySelector("[data-bookmark-active-list-meta]");
    pageHeroTitle = pageRoot.querySelector("[data-bookmark-page-title]");
    pageHeroSubtitle = pageRoot.querySelector("[data-bookmark-page-subtitle]");
    pageShareBtn = pageRoot.querySelector("[data-bookmark-share-list]");
    pageEditBtn = pageRoot.querySelector("[data-bookmark-edit-list]");
    pageDeleteBtn = pageRoot.querySelector("[data-bookmark-delete-list]");
    pagePublicToken = toText(pageRoot.getAttribute("data-bookmark-public-token"));
    pagePublicOwnerName = toText(pageRoot.getAttribute("data-bookmark-public-owner-name"));

    if (pagePublicToken) {
      if (pageLayout) pageLayout.classList.add("is-public-share");
      if (pageListsPanel) pageListsPanel.hidden = true;
      if (pageMobileListPicker) pageMobileListPicker.hidden = true;
      setMobileListPickerOpen(false);
      updatePublicShareHero(null);
    } else {
      if (pageLayout) pageLayout.classList.remove("is-public-share");
      if (pageListsPanel) pageListsPanel.hidden = false;
      if (pageMobileListPicker) pageMobileListPicker.hidden = true;
      setMobileListPickerOpen(false);
    }

    if (!pageResizeBound) {
      pageResizeBound = true;
      window.addEventListener("resize", () => {
        scheduleBookmarkResizeSync();
      });
    }

    if (pageMobileListSelect && pageMobileListSelect.getAttribute(PAGE_MOBILE_SELECT_BOUND_ATTR) !== "1") {
      pageMobileListSelect.setAttribute(PAGE_MOBILE_SELECT_BOUND_ATTR, "1");
      pageMobileListSelect.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) return;
        const nextListId = Number(target.value || "0");
        if (!Number.isFinite(nextListId) || nextListId <= 0) return;
        setMobileListPickerOpen(false);
        clearPageSearchDebounce();
        loadBookmarkPage({ page: 1, listId: Math.floor(nextListId) }).catch(() => {
          setPageStatus("Không thể tải danh mục.", "error");
        });
      });
    }

    if (pageMobileListTrigger && pageMobileListTrigger.getAttribute(PAGE_MOBILE_PICKER_BOUND_ATTR) !== "1") {
      pageMobileListTrigger.setAttribute(PAGE_MOBILE_PICKER_BOUND_ATTR, "1");
      pageMobileListTrigger.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setMobileListPickerOpen(false);
        }
      });
    }

    if (pageSearchInput && pageSearchInput.getAttribute("data-bookmark-search-bound") !== "1") {
      pageSearchInput.setAttribute("data-bookmark-search-bound", "1");
      pageSearchInput.addEventListener("compositionstart", () => {
        pageSearchInputComposing = true;
      });
      pageSearchInput.addEventListener("compositionend", (event) => {
        pageSearchInputComposing = false;
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (!shouldRunPageSearch(target.value || "")) return;
        schedulePageSearchLoad();
      });
      pageSearchInput.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (event.isComposing || pageSearchInputComposing) return;
        if (!shouldRunPageSearch(target.value || "")) return;
        schedulePageSearchLoad();
      });
    }

    if (pageSortSelect && pageSortSelect.getAttribute("data-bookmark-sort-bound") !== "1") {
      pageSortSelect.setAttribute("data-bookmark-sort-bound", "1");
      pageSortSelect.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) return;
        const nextSort = normalizeBookmarkSortOrder(target.value || "");
        if (nextSort === pageSortOrder) return;
        pageSortOrder = nextSort;
        clearPageSearchDebounce();
        loadBookmarkPage({
          page: 1,
          listId: pageCurrentListId,
          search: pageSearchTerm,
          sort: pageSortOrder
        }).catch(() => {
          setPageStatus("Không thể tải danh sách đã lưu.", "error");
        });
      });
    }

    dialog = ensureBookmarkListDialog();
    dialogTitle = dialog ? dialog.querySelector("[data-bookmark-list-dialog-title]") : null;
    dialogNameInput = dialog ? dialog.querySelector("[data-bookmark-list-name-input]") : null;
    dialogPublicInput = dialog ? dialog.querySelector("[data-bookmark-list-public-input]") : null;
    dialogStatus = dialog ? dialog.querySelector("[data-bookmark-list-dialog-status]") : null;
    dialogSubmit = dialog ? dialog.querySelector("[data-bookmark-list-dialog-submit]") : null;
    dialogSubmitLabel = dialog ? dialog.querySelector("[data-bookmark-list-dialog-submit-label]") : null;
    dialogCloseButton = dialog ? dialog.querySelector("[data-bookmark-list-dialog-close]") : null;
    dialogCancelButton = dialog ? dialog.querySelector("[data-bookmark-list-dialog-cancel]") : null;

    if (detailCreateNameInput) detailCreateNameInput.maxLength = BOOKMARK_LIST_NAME_MAX_LENGTH;
    if (dialogNameInput) dialogNameInput.maxLength = BOOKMARK_LIST_NAME_MAX_LENGTH;

    if (dialog && dialog.getAttribute(PAGE_DIALOG_BOUND_ATTR) !== "1") {
      dialog.setAttribute(PAGE_DIALOG_BOUND_ATTR, "1");
      if (dialogCloseButton) dialogCloseButton.addEventListener("click", closeListDialog);
      if (dialogCancelButton) dialogCancelButton.addEventListener("click", closeListDialog);
      if (dialogSubmit) {
        dialogSubmit.addEventListener("click", () => {
          submitListDialog().catch(() => {
            setDialogStatus("Không thể lưu mục.", true);
          });
        });
      }
      if (dialogNameInput) {
        dialogNameInput.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          submitListDialog().catch(() => {
            setDialogStatus("Không thể lưu mục.", true);
          });
        });
      }
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeListDialog();
      });
    }

    if (pageRoot.getAttribute(PAGE_BOUND_ATTR) !== "1") {
      pageRoot.setAttribute(PAGE_BOUND_ATTR, "1");
      pageRoot.addEventListener("click", (event) => {
        const source = event.target;
        if (!(source instanceof Element)) return;

        const insideMobileControl = source.closest("[data-bookmark-mobile-list-control]");
        if (pageMobileListMenuOpen && !insideMobileControl) {
          setMobileListPickerOpen(false);
        }

        const mobileTrigger = source.closest("[data-bookmark-mobile-list-trigger]");
        if (mobileTrigger) {
          event.preventDefault();
          if (!pageMobileListPicker || pageMobileListPicker.hidden) return;
          setMobileListPickerOpen(!pageMobileListMenuOpen);
          return;
        }

        const mobileOptionButton = source.closest("[data-bookmark-mobile-list-option]");
        if (mobileOptionButton instanceof HTMLButtonElement) {
          event.preventDefault();
          const nextListId = Number(mobileOptionButton.getAttribute("data-list-id") || "0");
          setMobileListPickerOpen(false);
          if (!Number.isFinite(nextListId) || nextListId <= 0) return;
          clearPageSearchDebounce();
          loadBookmarkPage({ page: 1, listId: Math.floor(nextListId) }).catch(() => {
            setPageStatus("Không thể tải danh mục.", "error");
          });
          return;
        }

        const createButton = source.closest("[data-bookmark-create-list]");
        if (createButton) {
          event.preventDefault();
          setMobileListPickerOpen(false);
          openListDialog({ mode: "create", list: null });
          return;
        }

        const editButton = source.closest("[data-bookmark-edit-list]");
        if (editButton) {
          event.preventDefault();
          setMobileListPickerOpen(false);
          const current = pageListsData.find((list) => list.id === pageCurrentListId);
          if (!current || current.isDefaultFollow) return;
          openListDialog({ mode: "edit", list: current });
          return;
        }

        const deleteButton = source.closest("[data-bookmark-delete-list]");
        if (deleteButton) {
          event.preventDefault();
          setMobileListPickerOpen(false);
          removeCurrentList().catch(() => {
            setPageStatus("Không thể xóa mục.", "error");
          });
          return;
        }

        const shareButton = source.closest("[data-bookmark-share-list]");
        if (shareButton) {
          event.preventDefault();
          setMobileListPickerOpen(false);
          copyCurrentListShareLink().catch(() => {
            setPageStatus("Không thể copy link chia sẻ.", "error");
          });
          return;
        }

        const listButton = source.closest("[data-bookmark-list-select]");
        if (listButton) {
          event.preventDefault();
          setMobileListPickerOpen(false);
          const nextListId = Number(listButton.getAttribute("data-list-id") || "0");
          if (!Number.isFinite(nextListId) || nextListId <= 0) return;
          clearPageSearchDebounce();
          loadBookmarkPage({ page: 1, listId: Math.floor(nextListId) }).catch(() => {
            setPageStatus("Không thể tải danh mục.", "error");
          });
          return;
        }

        const removeButton = source.closest("[data-bookmark-remove]");
        if (removeButton instanceof HTMLButtonElement) {
          event.preventDefault();
          setMobileListPickerOpen(false);
          if (removeButton.disabled || removeButton.classList.contains("is-loading")) return;
          const mangaId = Number(removeButton.getAttribute("data-manga-id") || "0");
          if (!Number.isFinite(mangaId) || mangaId <= 0) return;
          setRemoveButtonBusy(removeButton, true);
          removeMangaFromCurrentList(mangaId).catch(() => {
            setPageStatus("Không thể gỡ truyện khỏi mục.", "error");
          }).finally(() => {
            if (!removeButton.isConnected) return;
            setRemoveButtonBusy(removeButton, false);
          });
          return;
        }

        const pageButton = source.closest("[data-bookmark-page-link]");
        if (pageButton) {
          event.preventDefault();
          setMobileListPickerOpen(false);
          const targetPage = Number(pageButton.getAttribute("data-page") || "1");
          if (!Number.isFinite(targetPage) || targetPage <= 0) return;
          clearPageSearchDebounce();
          loadBookmarkPage({ page: Math.floor(targetPage), listId: pageCurrentListId }).catch(() => {
            setPageStatus("Không thể tải trang đã lưu.", "error");
          });
        }
      });
    }

    const state = readPageStateFromUrl();
    pageSearchTerm = normalizeBookmarkSearchTerm(state.search);
    pageSortOrder = normalizeBookmarkSortOrder(state.sort);
    if (pageSearchInput) pageSearchInput.value = pageSearchTerm;
    if (pageSortSelect) pageSortSelect.value = pageSortOrder;

    loadBookmarkPage({
      page: state.page,
      listId: state.listId,
      search: pageSearchTerm,
      sort: pageSortOrder
    }).catch(() => {
      setPageStatus("Không thể tải danh sách đã lưu.", "error");
    });
  };

  const refreshFromSession = async () => {
    bindDetailBookmark();
    bindBookmarkPage();
  };

  window.addEventListener("bfang:auth", () => {
    refreshFromSession().catch(() => null);
  });
  window.addEventListener("bfang:pagechange", () => {
    refreshFromSession().catch(() => null);
  });
  window.addEventListener("pageshow", () => {
    refreshFromSession().catch(() => null);
  });

  refreshFromSession().catch(() => null);
})();
