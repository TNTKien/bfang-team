(() => {
  const dialog = document.querySelector("[data-confirm-dialog]");
  const supportsDialog = Boolean(dialog && typeof dialog.showModal === "function");

  const titleEl = dialog ? dialog.querySelector("[data-dialog-title]") : null;
  const bodyEl = dialog ? dialog.querySelector("[data-dialog-body]") : null;
  const metaEl = dialog ? dialog.querySelector("[data-dialog-meta]") : null;
  const cancelBtn = dialog ? dialog.querySelector("[data-dialog-cancel]") : null;
  const closeBtn = dialog ? dialog.querySelector("[data-dialog-close]") : null;
  const confirmBtn = dialog ? dialog.querySelector("[data-dialog-confirm]") : null;

  let pendingForm = null;
  let pendingConfig = null;
  let pendingHref = "";
  let pendingSubmitter = null;
  let ignoreRemoveBadgeUntil = 0;
  const badgeInlineStatusEl = document.querySelector("[data-badge-inline-status]");
  const membersRootEl = document.querySelector("[data-members-admin-root]");
  const teamsRootEl = document.querySelector("[data-admin-teams-root]");
  let badgeInlineStatusTimer = null;

  const adminNavRoot = document.querySelector("[data-admin-nav-root]");
  const adminNavToggle = adminNavRoot
    ? adminNavRoot.querySelector("[data-admin-nav-toggle]")
    : null;
  const adminNavDrawer = adminNavRoot
    ? adminNavRoot.querySelector("[data-admin-nav-drawer]")
    : null;
  const adminNavBackdrop = adminNavRoot
    ? adminNavRoot.querySelector("[data-admin-nav-backdrop]")
    : null;
  const adminNavToggleIcon = adminNavToggle ? adminNavToggle.querySelector("i") : null;
  const adminNavDesktopQuery =
    typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 961px)") : null;

  let loadingOverlay = null;
  let loadingTitleEl = null;
  let loadingTextEl = null;

  const ensureLoadingOverlay = () => {
    if (loadingOverlay) return;
    const root = document.createElement("div");
    root.className = "admin-loading";
    root.hidden = true;

    const card = document.createElement("div");
    card.className = "admin-loading__card";
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");

    const head = document.createElement("div");
    head.className = "admin-loading__head";

    const spinner = document.createElement("div");
    spinner.className = "admin-loading__spinner";
    spinner.setAttribute("aria-hidden", "true");

    const title = document.createElement("p");
    title.className = "admin-loading__title";

    const text = document.createElement("p");
    text.className = "admin-loading__text";

    head.appendChild(spinner);
    head.appendChild(title);
    card.appendChild(head);
    card.appendChild(text);
    root.appendChild(card);
    document.body.appendChild(root);

    loadingOverlay = root;
    loadingTitleEl = title;
    loadingTextEl = text;
  };

  const showLoadingOverlay = ({ title, text } = {}) => {
    ensureLoadingOverlay();
    if (!loadingOverlay) return;
    if (loadingTitleEl) {
      loadingTitleEl.textContent = (title || "Đang xử lý...").toString();
    }
    if (loadingTextEl) {
      loadingTextEl.textContent = (text || "Vui lòng chờ trong giây lát.").toString();
    }
    document.body.setAttribute("aria-busy", "true");
    loadingOverlay.hidden = false;
  };

  const hideLoadingOverlay = () => {
    if (!loadingOverlay) return;
    loadingOverlay.hidden = true;
    document.body.removeAttribute("aria-busy");
  };

  window.addEventListener("pageshow", hideLoadingOverlay);

  const setAdminNavIcon = (expanded) => {
    if (!adminNavToggleIcon) return;
    adminNavToggleIcon.classList.remove("fa-bars", "fa-xmark");
    adminNavToggleIcon.classList.add(expanded ? "fa-xmark" : "fa-bars");
  };

  const isAdminNavDesktop = () => Boolean(adminNavDesktopQuery && adminNavDesktopQuery.matches);

  const setAdminNavExpanded = (expanded) => {
    if (!adminNavRoot || !adminNavToggle || !adminNavDrawer) return;
    if (isAdminNavDesktop()) {
      adminNavRoot.classList.remove("is-open");
      document.body.classList.remove("admin-nav-open");
      adminNavToggle.setAttribute("aria-expanded", "true");
      adminNavDrawer.hidden = false;
      if (adminNavBackdrop) {
        adminNavBackdrop.hidden = true;
      }
      setAdminNavIcon(false);
      return;
    }

    const next = Boolean(expanded);
    adminNavRoot.classList.toggle("is-open", next);
    document.body.classList.toggle("admin-nav-open", next);
    adminNavToggle.setAttribute("aria-expanded", next ? "true" : "false");
    adminNavDrawer.hidden = !next;
    if (adminNavBackdrop) {
      adminNavBackdrop.hidden = !next;
    }
    setAdminNavIcon(next);
  };

  if (adminNavRoot && adminNavToggle && adminNavDrawer) {
    const syncAdminNavMode = () => {
      if (isAdminNavDesktop()) {
        adminNavToggle.setAttribute("aria-hidden", "true");
        adminNavToggle.setAttribute("tabindex", "-1");
        setAdminNavExpanded(true);
        return;
      }

      adminNavToggle.removeAttribute("aria-hidden");
      adminNavToggle.removeAttribute("tabindex");
      setAdminNavExpanded(false);
    };

    adminNavToggle.addEventListener("click", () => {
      setAdminNavExpanded(!adminNavRoot.classList.contains("is-open"));
    });

    adminNavDrawer.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest("a")) return;
      setAdminNavExpanded(false);
    });

    if (adminNavBackdrop) {
      adminNavBackdrop.addEventListener("click", () => {
        if (!adminNavRoot.classList.contains("is-open")) return;
        setAdminNavExpanded(false);
      });
    }

    document.addEventListener("click", (event) => {
      if (!adminNavRoot.classList.contains("is-open")) return;
      if (!(event.target instanceof Node)) return;
      if (adminNavDrawer.contains(event.target)) return;
      if (adminNavToggle.contains(event.target)) return;
      if (adminNavBackdrop && adminNavBackdrop.contains(event.target)) return;
      setAdminNavExpanded(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!adminNavRoot.classList.contains("is-open")) return;
      setAdminNavExpanded(false);
      adminNavToggle.focus();
    });

    if (adminNavDesktopQuery) {
      if (typeof adminNavDesktopQuery.addEventListener === "function") {
        adminNavDesktopQuery.addEventListener("change", syncAdminNavMode);
      } else if (typeof adminNavDesktopQuery.addListener === "function") {
        adminNavDesktopQuery.addListener(syncAdminNavMode);
      }
    }

    syncAdminNavMode();
  }

  const setButtonBusy = (button, label) => {
    if (!button || !(button instanceof HTMLButtonElement)) return;
    if (button.dataset.originalHtml == null) {
      button.dataset.originalHtml = button.innerHTML;
    }
    if (button.dataset.originalText == null) {
      button.dataset.originalText = (button.textContent || "").toString();
    }
    button.disabled = true;
    button.classList.add("is-loading");
    if (label) {
      button.textContent = String(label);
    }
  };

  const restoreButton = (button) => {
    if (!button || !(button instanceof HTMLButtonElement)) return;
    const originalHtml = button.dataset.originalHtml;
    const original = button.dataset.originalText;
    if (originalHtml != null) {
      button.innerHTML = originalHtml;
    } else if (original != null) {
      button.textContent = original;
    }
    delete button.dataset.originalHtml;
    delete button.dataset.originalText;
    button.classList.remove("is-loading");
    button.disabled = false;
  };

  const releasePendingSubmitterLoading = () => {
    if (!(pendingSubmitter instanceof HTMLButtonElement)) return;
    restoreButton(pendingSubmitter);
    if (
      window.BfangButtonUi
      && typeof window.BfangButtonUi.setLoading === "function"
    ) {
      window.BfangButtonUi.setLoading(pendingSubmitter, false);
      return;
    }
    pendingSubmitter.classList.remove("is-loading");
    pendingSubmitter.removeAttribute("aria-busy");
    pendingSubmitter.removeAttribute("data-button-auto-loading");
  };

  const postJson = async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin"
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const message =
        data && data.error ? String(data.error) : "Thao tác thất bại. Vui lòng thử lại.";
      throw new Error(message);
    }

    return data;
  };

  const postFormJson = async (form, fallbackMessage) => {
    if (!form || !(form instanceof HTMLFormElement)) {
      throw new Error("Biểu mẫu không hợp lệ.");
    }

    const params = new URLSearchParams();
    const formData = new FormData(form);
    formData.forEach((value, key) => {
      params.append(key, value == null ? "" : String(value));
    });

    const response = await fetch(form.action, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json"
      },
      credentials: "same-origin",
      body: params.toString()
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const message =
        data && data.error
          ? String(data.error)
          : (fallbackMessage || "Thao tác thất bại. Vui lòng thử lại.").toString();
      throw new Error(message);
    }

    return data;
  };

  const postParamsJson = async (url, params, fallbackMessage) => {
    const body = params instanceof URLSearchParams ? params : new URLSearchParams();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json"
      },
      credentials: "same-origin",
      body: body.toString()
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const message =
        data && data.error
          ? String(data.error)
          : (fallbackMessage || "Thao tác thất bại. Vui lòng thử lại.").toString();
      throw new Error(message);
    }

    return data;
  };

  const syncBadgeOrderUi = (table) => {
    if (!table) return;
    const rows = Array.from(table.querySelectorAll("tbody tr[data-badge-row-id]"));
    rows.forEach((row, index) => {
      const orderChip = row.querySelector(".admin-badge-order .chip");
      if (orderChip) {
        orderChip.textContent = String(index + 1);
      }

      const upBtn = row.querySelector("[data-badge-move-direction='up']");
      const downBtn = row.querySelector("[data-badge-move-direction='down']");
      if (upBtn && upBtn instanceof HTMLButtonElement) {
        upBtn.disabled = index === 0;
      }
      if (downBtn && downBtn instanceof HTMLButtonElement) {
        downBtn.disabled = index === rows.length - 1;
      }
    });
  };

  const applyBadgeMoveInDom = (form) => {
    if (!form || !(form instanceof HTMLFormElement)) return false;
    const row = form.closest("tr[data-badge-row-id]");
    const table = row ? row.closest(".admin-table--badges") : null;
    const body = row && row.parentElement ? row.parentElement : null;
    if (!row || !table || !body) return false;

    const directionRaw = (form.dataset.badgeDirection || "").toString().trim().toLowerCase();
    const direction = directionRaw || String(new FormData(form).get("direction") || "").trim().toLowerCase();
    if (direction === "up") {
      const previous = row.previousElementSibling;
      if (!previous) return false;
      body.insertBefore(row, previous);
      syncBadgeOrderUi(table);
      return true;
    }

    if (direction === "down") {
      const next = row.nextElementSibling;
      if (!next) return false;
      body.insertBefore(next, row);
      syncBadgeOrderUi(table);
      return true;
    }

    return false;
  };

  const handleBadgeMoveSubmit = async (form, submitter) => {
    if (!form || !(form instanceof HTMLFormElement)) return;
    if (form.dataset.badgeMoving === "1") return;

    const row = form.closest("tr[data-badge-row-id]");
    const table = row ? row.closest(".admin-table--badges") : null;
    const button = submitter instanceof HTMLButtonElement ? submitter : form.querySelector("button[type='submit']");

    form.dataset.badgeMoving = "1";
    if (button) {
      setButtonBusy(button);
    }
    if (row) {
      row.querySelectorAll("[data-badge-move-direction]").forEach((btn) => {
        if (btn instanceof HTMLButtonElement) {
          btn.disabled = true;
        }
      });
    }

    try {
      await postFormJson(form);
      applyBadgeMoveInDom(form);
    } catch (err) {
      const message = (err && err.message) || "Không thể lưu thứ tự huy hiệu. Vui lòng thử lại.";
      window.alert(message);
    } finally {
      delete form.dataset.badgeMoving;
      restoreButton(button);
      if (table) {
        syncBadgeOrderUi(table);
      }
    }
  };

  const showBadgeInlineStatus = (message, variant) => {
    if (!badgeInlineStatusEl) return;
    const text = (message || "").toString().trim();
    if (!text) {
      badgeInlineStatusEl.hidden = true;
      return;
    }

    badgeInlineStatusEl.hidden = false;
    badgeInlineStatusEl.textContent = text;
    badgeInlineStatusEl.classList.remove("admin-success", "admin-error");
    badgeInlineStatusEl.classList.add(variant === "error" ? "admin-error" : "admin-success");

    if (badgeInlineStatusTimer) {
      clearTimeout(badgeInlineStatusTimer);
      badgeInlineStatusTimer = null;
    }

    badgeInlineStatusTimer = window.setTimeout(() => {
      if (badgeInlineStatusEl) {
        badgeInlineStatusEl.hidden = true;
      }
      badgeInlineStatusTimer = null;
    }, 2200);
  };

  const getBadgeFormControls = (form) => {
    if (!form || !(form instanceof HTMLFormElement)) return [];
    const controls = new Set();
    Array.from(form.elements || []).forEach((el) => {
      if (!el) return;
      controls.add(el);
    });

    const formId = (form.getAttribute("id") || "").toString().trim();
    if (formId) {
      document.querySelectorAll(`[form="${formId}"]`).forEach((el) => {
        controls.add(el);
      });
    }

    return Array.from(controls);
  };

  const setBadgeFormControlsDisabled = (form, disabled) => {
    const controls = getBadgeFormControls(form);
    controls.forEach((control) => {
      if (!(control instanceof HTMLElement)) return;
      if (!("disabled" in control)) return;
      if (disabled) {
        control.dataset.adminWasDisabled = control.disabled ? "1" : "0";
        control.disabled = true;
        return;
      }

      const wasDisabled = control.dataset.adminWasDisabled === "1";
      control.disabled = wasDisabled;
      delete control.dataset.adminWasDisabled;
    });
  };

  const handleBadgeSaveSubmit = async (form, submitter) => {
    if (!form || !(form instanceof HTMLFormElement)) return;
    if (form.dataset.badgeSaving === "1") return;

    const formId = (form.getAttribute("id") || "").toString().trim();
    const saveButton =
      submitter instanceof HTMLButtonElement
        ? submitter
        : formId
        ? document.querySelector(`button[type='submit'][form="${formId}"]`)
        : form.querySelector("button[type='submit']");

    form.dataset.badgeSaving = "1";
    const submitPromise = postFormJson(form, "Không thể lưu huy hiệu. Vui lòng thử lại.");
    setBadgeFormControlsDisabled(form, true);
    setButtonBusy(saveButton, "Đang lưu...");

    try {
      await submitPromise;
      const labelInput = formId
        ? document.querySelector(`input[name="label"][form="${formId}"]`)
        : form.querySelector("input[name='label']");
      const nextLabel = labelInput && "value" in labelInput ? String(labelInput.value || "").trim() : "";
      if (nextLabel) {
        form.dataset.badgeLabel = nextLabel;
      }
      showBadgeInlineStatus("Lưu thành công.", "success");
    } catch (err) {
      const message = (err && err.message) || "Không thể lưu huy hiệu. Vui lòng thử lại.";
      showBadgeInlineStatus(message, "error");
    } finally {
      delete form.dataset.badgeSaving;
      setBadgeFormControlsDisabled(form, false);
      restoreButton(saveButton);
    }
  };

  const emitMembersActionResult = (detail) => {
    try {
      window.dispatchEvent(new CustomEvent("admin:members:changed", { detail }));
    } catch (_err) {
      // ignore
    }
  };

  const emitTeamsActionResult = (detail) => {
    try {
      window.dispatchEvent(new CustomEvent("admin:teams:changed", { detail }));
    } catch (_err) {
      // ignore
    }
  };

  const resolveMemberSubmitButton = (form, submitter) => {
    if (submitter instanceof HTMLButtonElement) {
      return submitter;
    }

    const formId = (form.getAttribute("id") || "").toString().trim();
    if (formId) {
      const linked = document.querySelector(`button[type='submit'][form="${formId}"]`);
      if (linked instanceof HTMLButtonElement) {
        return linked;
      }
    }

    const own = form.querySelector("button[type='submit']");
    return own instanceof HTMLButtonElement ? own : null;
  };

  const getMemberActionBusyLabel = (action, form) => {
    if (action === "save-member") return "Đang lưu...";
    if (action === "assign-member-badge") return "Đang cấp...";
    if (action === "remove-member-badge") return "Đang gỡ...";
    if (action === "toggle-member-ban") {
      const mode = (form.dataset.memberMode || "").toString().trim().toLowerCase();
      return mode === "unban" ? "Đang mở khóa..." : "Đang ban...";
    }
    return "Đang lưu...";
  };

  const getMemberActionSuccessMessage = (action, form) => {
    if (action === "save-member") return "Lưu thành công.";
    if (action === "assign-member-badge") return "Đã cấp huy hiệu.";
    if (action === "remove-member-badge") return "Đã gỡ huy hiệu.";
    if (action === "toggle-member-ban") {
      const mode = (form.dataset.memberMode || "").toString().trim().toLowerCase();
      return mode === "unban"
        ? "Đã mở khóa thành viên và cấp lại Member."
        : "Đã ban thành viên và thay toàn bộ huy hiệu thành Banned.";
    }
    return "Đã cập nhật.";
  };

  const handleMemberActionSubmit = async (form, submitter) => {
    if (!form || !(form instanceof HTMLFormElement)) return;

    const action = (form.dataset.confirmAction || "").trim();
    const supportedActions = new Set([
      "save-member",
      "assign-member-badge",
      "remove-member-badge",
      "toggle-member-ban"
    ]);
    if (!supportedActions.has(action)) return;
    if (form.dataset.memberBusy === "1") return;

    const button = resolveMemberSubmitButton(form, submitter);
    const fallbackMessage = "Không thể cập nhật thành viên. Vui lòng thử lại.";
    const submitPromise = postFormJson(form, fallbackMessage);

    form.dataset.memberBusy = "1";
    if (action === "save-member") {
      setBadgeFormControlsDisabled(form, true);
    }
    setButtonBusy(button, getMemberActionBusyLabel(action, form));

    try {
      await submitPromise;
      const message = getMemberActionSuccessMessage(action, form);
      if (action === "assign-member-badge") {
        ignoreRemoveBadgeUntil = Date.now() + 650;
      }
      if (action === "save-member") {
        const formId = (form.getAttribute("id") || "").toString().trim();
        const displayNameInput = formId
          ? document.querySelector(`input[name="display_name"][form="${formId}"]`)
          : form.querySelector("input[name='display_name']");
        const nextName =
          displayNameInput && "value" in displayNameInput
            ? String(displayNameInput.value || "").trim()
            : "";
        if (nextName) {
          form.dataset.memberName = nextName;
        }
      }

      emitMembersActionResult({
        ok: true,
        action,
        memberId: (form.dataset.memberId || "").toString().trim(),
        message
      });
      if (!membersRootEl) {
        window.alert(message);
      }
    } catch (err) {
      const message = (err && err.message) || fallbackMessage;
      emitMembersActionResult({
        ok: false,
        action,
        memberId: (form.dataset.memberId || "").toString().trim(),
        message
      });
      if (!membersRootEl) {
        window.alert(message);
      }
    } finally {
      delete form.dataset.memberBusy;
      if (action === "save-member") {
        setBadgeFormControlsDisabled(form, false);
      }
      restoreButton(button);
    }
  };

  const getJson = async (url) => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin"
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const message =
        data && data.error ? String(data.error) : "Thao tác thất bại. Vui lòng thử lại.";
      throw new Error(message);
    }

    return data;
  };

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const isAdminJobMissingMessage = (error) => {
    const message = (error && error.message ? String(error.message) : "").trim().toLowerCase();
    if (!message) return false;
    return message.includes("không tìm thấy tiến trình") || message.includes("khong tim thay tien trinh");
  };

  const waitForAdminJob = async (jobId) => {
    const id = (jobId || "").toString().trim();
    if (!id) {
      throw new Error("Không theo dõi được tiến trình. Vui lòng thử lại.");
    }

    const started = Date.now();
    let consecutiveErrors = 0;

    while (true) {
      let data = null;
      try {
        data = await getJson(`/admin/jobs/${encodeURIComponent(id)}`);
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors += 1;
        if (isAdminJobMissingMessage(err)) {
          return {
            ok: true,
            id,
            type: "",
            state: "unknown",
            error: "",
            result: null,
            assumedMissing: true
          };
        }
        if (consecutiveErrors >= 3) {
          throw err;
        }
        await sleep(1200);
        continue;
      }

      const state = (data.state || "").toString();
      if (state === "done") {
        return data;
      }
      if (state === "failed") {
        const message = (data.error || "").toString().trim();
        throw new Error(message || "Thao tác thất bại. Vui lòng thử lại.");
      }

      const elapsedMs = Date.now() - started;
      if (elapsedMs > 12000) {
        showLoadingOverlay({
          title: "Đang xóa...",
          text: "Hệ thống đang dọn ảnh. Việc này có thể mất một lúc, vui lòng không đóng trang."
        });
      }

      await sleep(elapsedMs > 30000 ? 1600 : 900);
    }
  };

  const removeFormRow = (form) => {
    if (!form) return false;
    const row = form.closest("tr");
    if (!row) return false;
    row.remove();
    return true;
  };

  const ensureGenreTableEmptyState = () => {
    const tbody = document.querySelector("[data-genre-table-body]");
    if (!tbody) return;

    const hasGenreRow = Array.from(tbody.querySelectorAll("tr")).some((row) =>
      Boolean(row.querySelector("form[data-confirm-action='delete-genre']"))
    );
    if (hasGenreRow) return;

    const qInput = document.querySelector("[data-genre-filter-input]");
    const hasQuery = qInput && "value" in qInput ? Boolean(String(qInput.value || "").trim()) : false;

    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = hasQuery ? "Không có thể loại phù hợp." : "Chưa có thể loại.";
    tr.appendChild(td);

    tbody.innerHTML = "";
    tbody.appendChild(tr);
  };

  let trashInlineStatusTimer = null;
  const showTrashInlineStatus = (message, tone = "success") => {
    const statusEl = document.querySelector("[data-trash-inline-status]");
    const text = (message || "").toString().trim();
    if (!statusEl || !text) return false;

    if (trashInlineStatusTimer) {
      window.clearTimeout(trashInlineStatusTimer);
      trashInlineStatusTimer = null;
    }

    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.classList.remove("admin-success", "admin-error");
    statusEl.classList.add(tone === "error" ? "admin-error" : "admin-success");

    trashInlineStatusTimer = window.setTimeout(() => {
      statusEl.hidden = true;
      trashInlineStatusTimer = null;
    }, 2800);

    return true;
  };

  const ensureTrashTableEmptyState = (type) => {
    const safeType = (type || "").toString().trim().toLowerCase();
    const tbody =
      safeType === "manga"
        ? document.querySelector("[data-trash-manga-body]")
        : safeType === "chapter"
        ? document.querySelector("[data-trash-chapter-body]")
        : null;
    if (!tbody) return;

    const hasDataRow = Array.from(tbody.querySelectorAll("tr")).some((row) =>
      Boolean(
        row.querySelector(
          safeType === "manga"
            ? "[data-confirm-action='restore-trash-manga'], [data-confirm-action='purge-trash-manga']"
            : "[data-confirm-action='restore-trash-chapter'], [data-confirm-action='purge-trash-chapter']"
        )
      )
    );
    if (hasDataRow) return;

    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent =
      safeType === "manga"
        ? "Không có truyện nào trong thùng rác."
        : "Không có chương nào trong thùng rác.";
    tr.appendChild(td);
    tbody.innerHTML = "";
    tbody.appendChild(tr);
  };

  const getTrashTypeFromElement = (el) => {
    if (!el || !(el instanceof HTMLElement)) return "";
    const raw = (el.dataset.trashType || "").toString().trim().toLowerCase();
    return raw === "manga" || raw === "chapter" ? raw : "";
  };

  const getTrashTypeLabel = (type, plural = false) => {
    const safeType = (type || "").toString().trim().toLowerCase();
    if (safeType === "manga") {
      return plural ? "truyện" : "truyện";
    }
    if (safeType === "chapter") {
      return plural ? "chương" : "chương";
    }
    return plural ? "mục" : "mục";
  };

  const getTrashSelectionCheckboxes = (type) => {
    const safeType = (type || "").toString().trim().toLowerCase();
    if (!safeType) return [];
    return Array.from(document.querySelectorAll(`[data-trash-select][data-trash-type='${safeType}']`)).filter(
      (input) => input instanceof HTMLInputElement
    );
  };

  const getTrashDeleteAllForms = (type) => {
    const safeType = (type || "").toString().trim().toLowerCase();
    if (!safeType) return [];
    const action = `purge-trash-${safeType}-all`;
    return Array.from(
      document.querySelectorAll(`form[data-trash-type='${safeType}'][data-confirm-action='${action}']`)
    ).filter((form) => form instanceof HTMLFormElement);
  };

  const getTrashDeleteAllButtons = (type) => {
    const safeType = (type || "").toString().trim().toLowerCase();
    if (!safeType) return [];
    return Array.from(
      document.querySelectorAll(`[data-trash-delete-all][data-trash-type='${safeType}']`)
    ).filter((button) => button instanceof HTMLButtonElement);
  };

  const getTrashBulkRestoreButtons = (type) => {
    const safeType = (type || "").toString().trim().toLowerCase();
    if (!safeType) return [];
    return Array.from(
      document.querySelectorAll(`[data-trash-bulk-restore][data-trash-type='${safeType}']`)
    ).filter((button) => button instanceof HTMLButtonElement);
  };

  const readTrashTotalCount = (type) => {
    const form = getTrashDeleteAllForms(type)[0];
    if (!form) return 0;
    const totalRaw = Number(form.dataset.trashTotal);
    if (!Number.isFinite(totalRaw) || totalRaw <= 0) return 0;
    return Math.floor(totalRaw);
  };

  const setTrashTotalCount = (type, total) => {
    const safeTotalRaw = Number(total);
    const safeTotal = Number.isFinite(safeTotalRaw) && safeTotalRaw > 0 ? Math.floor(safeTotalRaw) : 0;

    getTrashDeleteAllForms(type).forEach((form) => {
      form.dataset.trashTotal = String(safeTotal);
    });

    getTrashDeleteAllButtons(type).forEach((button) => {
      button.disabled = safeTotal <= 0;
    });
  };

  const decrementTrashTotalCount = (type, delta) => {
    const safeDeltaRaw = Number(delta);
    const safeDelta = Number.isFinite(safeDeltaRaw) && safeDeltaRaw > 0 ? Math.floor(safeDeltaRaw) : 0;
    if (safeDelta <= 0) return;

    const currentTotal = readTrashTotalCount(type);
    const nextTotal = Math.max(0, currentTotal - safeDelta);
    setTrashTotalCount(type, nextTotal);
  };

  const getTrashSelectedCheckboxes = (type) =>
    getTrashSelectionCheckboxes(type).filter((input) => input.checked && !input.disabled);

  const syncTrashSelectionUi = (type) => {
    const safeType = (type || "").toString().trim().toLowerCase();
    if (!safeType) return;

    const checkboxes = getTrashSelectionCheckboxes(safeType);
    const enabled = checkboxes.filter((input) => !input.disabled);
    const selected = enabled.filter((input) => input.checked);

    const selectedCount = selected.length;
    const totalSelectable = enabled.length;

    document
      .querySelectorAll(`[data-trash-bulk-delete][data-trash-type='${safeType}']`)
      .forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) return;
        button.disabled = selectedCount <= 0;
      });

    getTrashBulkRestoreButtons(safeType).forEach((button) => {
      button.disabled = selectedCount <= 0;
    });

    document
      .querySelectorAll(`[data-trash-select-all-label][data-trash-type='${safeType}']`)
      .forEach((label) => {
        label.textContent = `Chọn tất cả trang này (${selectedCount})`;
      });

    document
      .querySelectorAll(`[data-trash-select-all][data-trash-type='${safeType}']`)
      .forEach((input) => {
        if (!(input instanceof HTMLInputElement)) return;
        if (!totalSelectable) {
          input.checked = false;
          input.indeterminate = false;
          input.disabled = true;
          return;
        }

        input.disabled = false;
        input.checked = selectedCount > 0 && selectedCount === totalSelectable;
        input.indeterminate = selectedCount > 0 && selectedCount < totalSelectable;
      });
  };

  const syncAllTrashSelectionUi = () => {
    syncTrashSelectionUi("manga");
    syncTrashSelectionUi("chapter");
    setTrashTotalCount("manga", readTrashTotalCount("manga"));
    setTrashTotalCount("chapter", readTrashTotalCount("chapter"));
  };

  const removeTrashRowsByIds = (type, ids) => {
    const safeType = (type || "").toString().trim().toLowerCase();
    const idSet = new Set(
      (Array.isArray(ids) ? ids : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => String(Math.floor(value)))
    );
    if (!safeType || !idSet.size) return 0;

    let removed = 0;
    document
      .querySelectorAll(`[data-trash-row][data-trash-type='${safeType}']`)
      .forEach((row) => {
        const rowId = (row instanceof HTMLElement ? row.dataset.trashId : "") || "";
        if (rowId && idSet.has(rowId)) {
          row.remove();
          removed += 1;
        }
      });

    return removed;
  };

  const removeAllTrashRows = (type) => {
    const safeType = (type || "").toString().trim().toLowerCase();
    if (!safeType) return 0;

    let removed = 0;
    document
      .querySelectorAll(`[data-trash-row][data-trash-type='${safeType}']`)
      .forEach((row) => {
        row.remove();
        removed += 1;
      });

    return removed;
  };

  const removeSingleTrashRow = (form, type) => {
    if (removeFormRow(form)) return 1;

    const rawId = Number(form && form.dataset ? form.dataset.trashId : 0);
    if (!Number.isFinite(rawId) || rawId <= 0) return 0;

    return removeTrashRowsByIds(type, [Math.floor(rawId)]);
  };

  const runTrashBulkRestore = async (form, submitter) => {
    if (!form || !(form instanceof HTMLFormElement)) return;
    if (form.dataset.trashBulkBusy === "1") return;

    const action = (form.dataset.confirmAction || "").toString().trim();
    const type = getTrashTypeFromElement(form);
    const isMangaBulk = action === "restore-trash-manga-bulk" && type === "manga";
    const isChapterBulk = action === "restore-trash-chapter-bulk" && type === "chapter";
    if (!isMangaBulk && !isChapterBulk) {
      return;
    }

    const selectedIds = getTrashSelectedCheckboxes(type)
      .map((input) => Number(input.value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.floor(value));

    if (!selectedIds.length) {
      showTrashInlineStatus("Vui lòng chọn ít nhất một mục để khôi phục.", "error");
      syncTrashSelectionUi(type);
      return;
    }

    const button =
      submitter instanceof HTMLButtonElement ? submitter : form.querySelector("button[type='submit']");
    form.dataset.trashBulkBusy = "1";
    setButtonBusy(button, "Đang khôi phục...");
    showLoadingOverlay({
      title: `Đang khôi phục ${selectedIds.length} ${getTrashTypeLabel(type, true)}...`,
      text: "Đang cập nhật dữ liệu trong thùng rác."
    });

    try {
      const params = new URLSearchParams();
      const paramKey = type === "manga" ? "manga_ids" : "chapter_ids";
      selectedIds.forEach((id) => {
        params.append(paramKey, String(id));
      });

      const data = await postParamsJson(form.action, params, "Không thể bắt đầu khôi phục hàng loạt. Vui lòng thử lại.");
      const result = data && data.result && typeof data.result === "object" ? data.result : {};

      const restoredCountRaw = Number(result.restoredCount);
      const failedCountRaw = Number(result.failedCount);
      const restoredCount = Number.isFinite(restoredCountRaw) && restoredCountRaw > 0 ? Math.floor(restoredCountRaw) : 0;
      const failedCount = Number.isFinite(failedCountRaw) && failedCountRaw > 0 ? Math.floor(failedCountRaw) : 0;

      const restoredIds = Array.isArray(result.restoredIds)
        ? result.restoredIds
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0)
            .map((value) => Math.floor(value))
        : [];

      let removedCount = 0;
      if (restoredIds.length) {
        removedCount = removeTrashRowsByIds(type, restoredIds);
      }

      if (!removedCount && restoredCount > 0) {
        if (failedCount <= 0 && selectedIds.length) {
          removedCount = removeTrashRowsByIds(type, selectedIds);
        }
      }

      if (!removedCount && restoredCount > 0) {
        showTrashInlineStatus("Đã khôi phục thành công nhưng danh sách chưa kịp cập nhật. Vui lòng tải lại trang để đồng bộ.", "error");
        return;
      }

      const effectiveRemovedCount = Math.max(removedCount, 0);
      const safeRestoredCount = Math.max(restoredCount, effectiveRemovedCount);

      decrementTrashTotalCount(type, safeRestoredCount);
      ensureTrashTableEmptyState(type);
      syncTrashSelectionUi(type);

      if (failedCount > 0) {
        showTrashInlineStatus(
          `Đã khôi phục ${safeRestoredCount} ${getTrashTypeLabel(type, true)}, còn ${failedCount} ${getTrashTypeLabel(type, true)} lỗi.`,
          "error"
        );
      } else {
        showTrashInlineStatus(`Đã khôi phục ${safeRestoredCount} ${getTrashTypeLabel(type, true)}.`, "success");
      }
    } catch (err) {
      const message = (err && err.message) || "Thao tác thất bại. Vui lòng thử lại.";
      if (!showTrashInlineStatus(message, "error")) {
        window.alert(message);
      }
    } finally {
      delete form.dataset.trashBulkBusy;
      hideLoadingOverlay();
      if (button && button.isConnected) {
        restoreButton(button);
      }
      syncTrashSelectionUi(type);
    }
  };

  const runTrashBulkDelete = async (form, submitter) => {
    if (!form || !(form instanceof HTMLFormElement)) return;
    if (form.dataset.trashBulkBusy === "1") return;

    const action = (form.dataset.confirmAction || "").toString().trim();
    const type = getTrashTypeFromElement(form);
    const isMangaBulk = action === "purge-trash-manga-bulk" && type === "manga";
    const isChapterBulk = action === "purge-trash-chapter-bulk" && type === "chapter";
    const isMangaAll = action === "purge-trash-manga-all" && type === "manga";
    const isChapterAll = action === "purge-trash-chapter-all" && type === "chapter";
    if (!isMangaBulk && !isChapterBulk && !isMangaAll && !isChapterAll) {
      return;
    }

    const isDeleteAll = isMangaAll || isChapterAll;
    const totalCountBeforeDelete = readTrashTotalCount(type);
    const button =
      submitter instanceof HTMLButtonElement ? submitter : form.querySelector("button[type='submit']");

    const selectedIds = getTrashSelectedCheckboxes(type)
      .map((input) => Number(input.value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.floor(value));

    if (!isDeleteAll && !selectedIds.length) {
      showTrashInlineStatus("Vui lòng chọn ít nhất một mục để xóa.", "error");
      syncTrashSelectionUi(type);
      return;
    }

    form.dataset.trashBulkBusy = "1";
    setButtonBusy(button, "Đang xóa...");
    showLoadingOverlay({
      title: isDeleteAll
        ? `Đang xóa toàn bộ ${getTrashTypeLabel(type, true)}...`
        : `Đang xóa ${selectedIds.length} ${getTrashTypeLabel(type, true)}...`,
      text: "Đang dọn dữ liệu và ảnh liên quan. Việc này có thể mất một lúc."
    });

    try {
      const started = await postFormJson(form, "Không thể bắt đầu xóa hàng loạt. Vui lòng thử lại.");
      const jobId = started && typeof started.jobId === "string" ? started.jobId : "";
      if (!jobId) {
        throw new Error("Không theo dõi được tiến trình. Vui lòng thử lại.");
      }

      const finished = await waitForAdminJob(jobId);
      if (finished && finished.assumedMissing) {
        let removedCount = 0;
        if (isDeleteAll) {
          removedCount = removeAllTrashRows(type);
        } else if (selectedIds.length) {
          removedCount = removeTrashRowsByIds(type, selectedIds);
        }

        if (removedCount > 0) {
          const fallbackDeletedCount = isDeleteAll
            ? Math.max(totalCountBeforeDelete, 1)
            : removedCount;
          decrementTrashTotalCount(type, fallbackDeletedCount);
          ensureTrashTableEmptyState(type);
          syncTrashSelectionUi(type);

          showTrashInlineStatus(
            isDeleteAll
              ? `Đã xử lý xóa toàn bộ ${getTrashTypeLabel(type, true)}.`
              : `Đã xử lý xóa ${fallbackDeletedCount} ${getTrashTypeLabel(type, true)}.`,
            "success"
          );
        } else {
          showTrashInlineStatus("Không thể xác nhận kết quả tiến trình. Vui lòng tải lại trang để đồng bộ.", "error");
        }
        return;
      }
      const result = finished && finished.result && typeof finished.result === "object" ? finished.result : {};

      const deletedCountRaw = Number(result.deletedCount);
      const failedCountRaw = Number(result.failedCount);
      const deletedCount = Number.isFinite(deletedCountRaw) && deletedCountRaw > 0 ? Math.floor(deletedCountRaw) : 0;
      const failedCount = Number.isFinite(failedCountRaw) && failedCountRaw > 0 ? Math.floor(failedCountRaw) : 0;

      const deletedIds = Array.isArray(result.deletedIds)
        ? result.deletedIds
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0)
            .map((value) => Math.floor(value))
        : [];

      let removedCount = 0;
      if (deletedIds.length) {
        removedCount = removeTrashRowsByIds(type, deletedIds);
      }

      if (!removedCount && !isDeleteAll && deletedCount > 0 && failedCount <= 0 && selectedIds.length) {
        removedCount = removeTrashRowsByIds(type, selectedIds);
      }

      if (isDeleteAll && failedCount <= 0 && deletedCount > 0) {
        removedCount = Math.max(removedCount, removeAllTrashRows(type));
      }

      if (!removedCount && deletedCount > 0) {
        showTrashInlineStatus("Đã xóa thành công nhưng danh sách chưa kịp cập nhật. Vui lòng tải lại trang để đồng bộ.", "error");
        return;
      }

      const effectiveRemovedCount = Math.max(removedCount, 0);
      const safeDeletedCount = Math.max(
        deletedCount,
        isDeleteAll ? Math.min(totalCountBeforeDelete, effectiveRemovedCount || deletedCount) : effectiveRemovedCount
      );

      decrementTrashTotalCount(type, safeDeletedCount);
      ensureTrashTableEmptyState(type);
      syncTrashSelectionUi(type);

      if (failedCount > 0) {
        showTrashInlineStatus(
          `Đã xóa ${safeDeletedCount} ${getTrashTypeLabel(type, true)}, còn ${failedCount} ${getTrashTypeLabel(type, true)} lỗi.`,
          "error"
        );
      } else {
        showTrashInlineStatus(`Đã xóa ${safeDeletedCount} ${getTrashTypeLabel(type, true)}.`, "success");
      }
    } catch (err) {
      const message = (err && err.message) || "Thao tác thất bại. Vui lòng thử lại.";
      if (!showTrashInlineStatus(message, "error")) {
        window.alert(message);
      }
    } finally {
      delete form.dataset.trashBulkBusy;
      hideLoadingOverlay();
      if (button && button.isConnected) {
        restoreButton(button);
      }
      syncTrashSelectionUi(type);
    }
  };

  const handleTrashActionInline = async (form, submitter) => {
    if (!form || !(form instanceof HTMLFormElement)) return;
    if (form.dataset.trashBusy === "1") return;

    const action = (form.dataset.confirmAction || "").toString().trim();
    const isRestoreManga = action === "restore-trash-manga";
    const isRestoreChapter = action === "restore-trash-chapter";
    const isPurgeManga = action === "purge-trash-manga";
    const isPurgeChapter = action === "purge-trash-chapter";
    if (!isRestoreManga && !isRestoreChapter && !isPurgeManga && !isPurgeChapter) {
      return;
    }

    const isRestoreAction = isRestoreManga || isRestoreChapter;
    const type = isRestoreManga || isPurgeManga ? "manga" : "chapter";
    const row = form.closest("tr");
    const button =
      submitter instanceof HTMLButtonElement ? submitter : form.querySelector("button[type='submit']");
    const mangaTitle = (form.dataset.mangaTitle || "").toString().trim();
    const chapterNumber = (form.dataset.chapterNumber || "").toString().trim();
    const chapterLabel = chapterNumber ? `Chương ${chapterNumber}` : "chương";

    form.dataset.trashBusy = "1";
    if (row) {
      row.classList.add("is-deleting");
    }

    if (isPurgeManga || isPurgeChapter) {
      showLoadingOverlay({
        title: isPurgeManga
          ? `Đang xóa ${mangaTitle ? `"${mangaTitle}"` : "truyện"}...`
          : `Đang xóa ${chapterLabel}${mangaTitle ? ` của "${mangaTitle}"` : ""}...`,
        text: "Đang dọn dữ liệu và ảnh liên quan. Việc này có thể mất một lúc."
      });
    }

    setButtonBusy(button, isRestoreAction ? "Đang khôi phục..." : "Đang xóa...");
    try {
      if (isRestoreAction) {
        const data = await postJson(form.action);
        const removedCount = removeSingleTrashRow(form, type);
        if (!removedCount) {
          showTrashInlineStatus("Đã khôi phục nhưng danh sách chưa kịp cập nhật. Vui lòng tải lại trang để đồng bộ.", "error");
          return;
        }

        decrementTrashTotalCount(type, removedCount);
        ensureTrashTableEmptyState(type);
        syncTrashSelectionUi(type);
        const restoredChapterCount =
          data && data.result && Number.isFinite(Number(data.result.restoredChapters))
            ? Math.max(0, Math.floor(Number(data.result.restoredChapters)))
            : 0;

        const successMessage = isRestoreManga
          ? `Đã khôi phục ${mangaTitle ? `"${mangaTitle}"` : "truyện"}${restoredChapterCount > 0 ? ` (${restoredChapterCount} chương)` : ""}.`
          : `Đã khôi phục ${chapterLabel}${mangaTitle ? ` của "${mangaTitle}"` : ""}.`;

        if (!showTrashInlineStatus(successMessage, "success")) {
          window.alert(successMessage);
        }
        return;
      }

      const started = await postJson(form.action);
      const jobId = started && typeof started.jobId === "string" ? started.jobId : "";
      if (!jobId) {
        throw new Error("Không theo dõi được tiến trình. Vui lòng thử lại.");
      }

      const finished = await waitForAdminJob(jobId);
      if (finished && finished.assumedMissing) {
        const assumedRemovedCount = removeSingleTrashRow(form, type);
        if (assumedRemovedCount > 0) {
          decrementTrashTotalCount(type, assumedRemovedCount);
          ensureTrashTableEmptyState(type);
          syncTrashSelectionUi(type);

          const assumedMessage = isPurgeManga
            ? `Đã xử lý xóa ${mangaTitle ? `"${mangaTitle}"` : "truyện"}.`
            : `Đã xử lý xóa ${chapterLabel}${mangaTitle ? ` của "${mangaTitle}"` : ""}.`;

          if (!showTrashInlineStatus(assumedMessage, "success")) {
            window.alert(assumedMessage);
          }
        } else {
          showTrashInlineStatus("Không thể xác nhận kết quả tiến trình. Vui lòng tải lại trang để đồng bộ.", "error");
        }
        return;
      }
      const removedCount = removeSingleTrashRow(form, type);
      if (!removedCount) {
        showTrashInlineStatus("Đã xóa thành công nhưng danh sách chưa kịp cập nhật. Vui lòng tải lại trang để đồng bộ.", "error");
        return;
      }

      decrementTrashTotalCount(type, removedCount);
      ensureTrashTableEmptyState(type);
      syncTrashSelectionUi(type);
      const successMessage = isPurgeManga
        ? `Đã xóa ${mangaTitle ? `"${mangaTitle}"` : "truyện"}.`
        : `Đã xóa ${chapterLabel}${mangaTitle ? ` của "${mangaTitle}"` : ""}.`;

      if (!showTrashInlineStatus(successMessage, "success")) {
        window.alert(successMessage);
      }
    } catch (err) {
      const message = (err && err.message) || "Thao tác thất bại. Vui lòng thử lại.";
      if (!showTrashInlineStatus(message, "error")) {
        window.alert(message);
      }
      if (row) {
        row.classList.remove("is-deleting");
      }
    } finally {
      delete form.dataset.trashBusy;
      hideLoadingOverlay();
      if (row && row.isConnected) {
        row.classList.remove("is-deleting");
      }
      if (button && button.isConnected) {
        restoreButton(button);
      }
      syncTrashSelectionUi(type);
    }
  };

  const deleteGenreInline = async (form, submitter) => {
    if (!form || !(form instanceof HTMLFormElement)) return;
    if (form.dataset.genreDeleting === "1") return;

    const row = form.closest("tr");
    const button =
      submitter instanceof HTMLButtonElement ? submitter : form.querySelector("button[type='submit']");

    form.dataset.genreDeleting = "1";
    if (row) {
      row.classList.add("is-deleting");
    }
    setButtonBusy(button, "Đang xóa...");

    try {
      await postFormJson(form, "Không thể xóa thể loại. Vui lòng thử lại.");
      if (!removeFormRow(form)) {
        window.location.reload();
        return;
      }
      ensureGenreTableEmptyState();
      try {
        window.dispatchEvent(
          new CustomEvent("admin:genres:toast", {
            detail: {
              message: "Đã xóa thể loại.",
              variant: "success"
            }
          })
        );
      } catch (_err) {
        // ignore
      }
    } catch (err) {
      if (row) {
        row.classList.remove("is-deleting");
      }
      const message = (err && err.message) || "Không thể xóa thể loại. Vui lòng thử lại.";
      window.alert(message);
    } finally {
      delete form.dataset.genreDeleting;
      if (row && row.isConnected) {
        row.classList.remove("is-deleting");
      }
      if (button && button.isConnected) {
        restoreButton(button);
      }
    }
  };

  const deleteTeamInline = async (form, submitter) => {
    if (!form || !(form instanceof HTMLFormElement)) return;
    if (form.dataset.teamDeleting === "1") return;

    const row = form.closest("tr");
    const button =
      submitter instanceof HTMLButtonElement ? submitter : form.querySelector("button[type='submit']");

    form.dataset.teamDeleting = "1";
    if (row) {
      row.classList.add("is-deleting");
    }
    setButtonBusy(button, "Đang xóa...");

    try {
      const data = await postFormJson(form, "Không thể xóa nhóm dịch. Vui lòng thử lại.");
      const teamIdRaw = (form.dataset.teamId || "").toString().trim();
      const teamId = Number(teamIdRaw);
      emitTeamsActionResult({
        ok: true,
        action: "delete-team",
        teamId: Number.isFinite(teamId) && teamId > 0 ? Math.floor(teamId) : 0,
        message: data && data.message ? String(data.message) : "Đã xóa nhóm dịch."
      });
      if (!teamsRootEl) {
        if (!removeFormRow(form)) {
          window.location.reload();
          return;
        }
      }
    } catch (err) {
      if (row) {
        row.classList.remove("is-deleting");
      }
      const message = (err && err.message) || "Không thể xóa nhóm dịch. Vui lòng thử lại.";
      emitTeamsActionResult({
        ok: false,
        action: "delete-team",
        teamId: Number((form.dataset.teamId || "").toString().trim()) || 0,
        message
      });
      if (!teamsRootEl) {
        window.alert(message);
      }
    } finally {
      delete form.dataset.teamDeleting;
      if (row && row.isConnected) {
        row.classList.remove("is-deleting");
      }
      if (button && button.isConnected) {
        restoreButton(button);
      }
    }
  };

  const deleteInBackground = async (form, submitter) => {
    if (!form) return;

    const action = (form.dataset.confirmAction || "").trim();
    const button = submitter instanceof HTMLButtonElement ? submitter : null;
    const row = form.closest("tr");
    if (row) {
      row.classList.add("is-deleting");
    }

    if (action === "delete-chapter") {
      const mangaTitle = (form.dataset.mangaTitle || "").trim();
      const chapterNumber = (form.dataset.chapterNumber || "").toString().trim();
      const chapterPart = chapterNumber ? `Chương ${chapterNumber}` : "chương";
      const mangaPart = mangaTitle ? ` của "${mangaTitle}"` : "";
      showLoadingOverlay({
        title: `Đang xóa ${chapterPart}${mangaPart}...`,
        text: "Đang xóa dữ liệu và dọn ảnh. Việc này có thể mất một lúc."
      });
    } else if (action === "delete-manga") {
      const mangaTitle = (form.dataset.mangaTitle || "").trim();
      const titlePart = mangaTitle ? `"${mangaTitle}"` : "truyện";
      showLoadingOverlay({
        title: `Đang xóa ${titlePart}...`,
        text: "Đang xóa dữ liệu và dọn ảnh. Việc này có thể mất một lúc."
      });
    } else if (action === "bulk-delete-chapters") {
      const selectedCount = document.querySelectorAll("[data-chapter-select]:checked").length;
      const countLabel = selectedCount > 0 ? `${selectedCount} chương` : "các chương đã chọn";
      showLoadingOverlay({
        title: `Đang xóa ${countLabel}...`,
        text: "Đang xóa dữ liệu và dọn ảnh hàng loạt. Vui lòng chờ trong giây lát."
      });
    } else {
      showLoadingOverlay({ title: "Đang xóa...", text: "Vui lòng chờ trong giây lát." });
    }

    setButtonBusy(button, "Đang xóa...");
    try {
      const started =
        action === "bulk-delete-chapters"
          ? await postFormJson(form, "Không thể bắt đầu xóa hàng loạt chương. Vui lòng thử lại.")
          : await postJson(form.action);
      const jobId = started && typeof started.jobId === "string" ? started.jobId : "";
      if (!jobId) {
        throw new Error("Không theo dõi được tiến trình. Vui lòng tải lại trang.");
      }

      const finished = await waitForAdminJob(jobId);
      if (finished && finished.assumedMissing) {
        window.location.reload();
        return;
      }
      if (action === "bulk-delete-chapters") {
        const mangaId = Number(form.dataset.mangaId);
        const deletedCountRaw = finished && finished.result ? Number(finished.result.deletedCount) : NaN;
        const failedCountRaw = finished && finished.result ? Number(finished.result.failedCount) : NaN;
        const deletedCount =
          Number.isFinite(deletedCountRaw) && deletedCountRaw > 0 ? Math.floor(deletedCountRaw) : 0;
        const failedCount =
          Number.isFinite(failedCountRaw) && failedCountRaw > 0 ? Math.floor(failedCountRaw) : 0;

        if (Number.isFinite(mangaId) && mangaId > 0 && deletedCount > 0) {
          const params = new URLSearchParams();
          params.set("status", failedCount > 0 ? "bulk_partial" : "bulk_deleted");
          params.set("deleted", String(deletedCount));
          if (failedCount > 0) {
            params.set("failed", String(failedCount));
          }
          window.location.href = `/admin/manga/${encodeURIComponent(String(Math.floor(mangaId)))}/chapters?${params.toString()}`;
          return;
        }
      }

      if (!removeFormRow(form)) {
        window.location.reload();
      }
    } catch (err) {
      if (row) {
        row.classList.remove("is-deleting");
      }
      restoreButton(button);
      hideLoadingOverlay();
      const message = (err && err.message) || "Xóa thất bại.";
      window.alert(message);
      return;
    }

    hideLoadingOverlay();
  };

  const safeNumber = (value) => {
    if (value == null) return null;
    if (typeof value === "string" && !value.trim()) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const normalizeChapterNumberText = (value) => {
    const raw = (value == null ? "" : String(value)).trim();
    if (!raw) return "";

    const lowered = raw.toLowerCase();
    if (lowered === "null" || lowered === "undefined") return "";

    const numberValue = Number(raw);
    if (!Number.isFinite(numberValue)) return "";
    return raw;
  };

  const renderMeta = (items) => {
    if (!metaEl) return;
    metaEl.innerHTML = "";

    (items || [])
      .filter((item) => typeof item === "string" && item.trim())
      .forEach((text) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = text;
        metaEl.appendChild(chip);
      });
  };

  const applyConfigToDialog = (config) => {
    pendingConfig = config;
    if (titleEl) titleEl.textContent = config.title || "Xác nhận";
    if (bodyEl) bodyEl.textContent = config.body || "";
    renderMeta(config.metaItems || []);

    if (confirmBtn) {
      confirmBtn.textContent = config.confirmText || "Xác nhận";
      confirmBtn.className = "button";
      if (config.confirmVariant === "danger") {
        confirmBtn.classList.add("button--danger");
      }
    }
  };

  const submitConfirmedForm = (form, submitter) => {
    if (!form) return;

    const action = (form.dataset.confirmAction || "").trim();
    if (
      (
        action === "save-member" ||
        action === "assign-member-badge" ||
        action === "remove-member-badge" ||
        action === "toggle-member-ban"
      ) &&
      typeof fetch === "function"
    ) {
      void handleMemberActionSubmit(form, submitter);
      return;
    }

    if (action === "save-badge" && typeof fetch === "function") {
      void handleBadgeSaveSubmit(form, submitter);
      return;
    }

    if (action === "delete-genre" && typeof fetch === "function") {
      void deleteGenreInline(form, submitter);
      return;
    }

    if (action === "delete-team" && typeof fetch === "function") {
      void deleteTeamInline(form, submitter);
      return;
    }

    if (
      (
        action === "restore-trash-manga" ||
        action === "restore-trash-chapter" ||
        action === "purge-trash-manga" ||
        action === "purge-trash-chapter"
      ) &&
      typeof fetch === "function"
    ) {
      void handleTrashActionInline(form, submitter);
      return;
    }

    if (
      (
        action === "restore-trash-manga-bulk" ||
        action === "restore-trash-chapter-bulk"
      ) &&
      typeof fetch === "function"
    ) {
      void runTrashBulkRestore(form, submitter);
      return;
    }

    if (
      (
        action === "purge-trash-manga-bulk" ||
        action === "purge-trash-chapter-bulk" ||
        action === "purge-trash-manga-all" ||
        action === "purge-trash-chapter-all"
      ) &&
      typeof fetch === "function"
    ) {
      void runTrashBulkDelete(form, submitter);
      return;
    }

    if (
      (action === "delete-chapter" || action === "delete-manga" || action === "bulk-delete-chapters") &&
      typeof fetch === "function"
    ) {
      void deleteInBackground(form, submitter);
      return;
    }

    form.dataset.confirmBypass = "1";
    if (typeof form.requestSubmit === "function") {
      if (submitter && submitter instanceof HTMLElement) {
        form.requestSubmit(submitter);
        return;
      }
      form.requestSubmit();
      return;
    }
    form.submit();
  };

  const openConfirm = (payload, config) => {
    pendingForm = payload && payload.form ? payload.form : null;
    pendingHref = payload && payload.href ? payload.href : "";
    pendingSubmitter = payload && payload.submitter ? payload.submitter : null;
    releasePendingSubmitterLoading();
    if (supportsDialog && dialog) {
      applyConfigToDialog(config);
      if (!dialog.open) {
        dialog.showModal();
      }
      if (confirmBtn) {
        confirmBtn.focus();
      }
      return;
    }

    const ok = window.confirm(config.fallbackText || config.body || "Bạn có chắc muốn thực hiện thao tác này?");
    if (ok) {
      if (pendingForm) {
        submitConfirmedForm(pendingForm, pendingSubmitter);
        return;
      }
      if (pendingHref) {
        window.location.href = pendingHref;
      }
    }
  };

  const buildConfirmConfig = (form) => {
    const action = (form.dataset.confirmAction || "").trim();

    if (action === "delete-genre") {
      const genreName = (form.dataset.genreName || "").trim();
      const genreId = safeNumber(form.dataset.genreId);
      const count = safeNumber(form.dataset.genreCount);

      const namePart = genreName ? `"${genreName}"` : "thể loại này";
      const countPart =
        count == null
          ? ""
          : count > 0
          ? ` Đang gắn với ${count} truyện.`
          : " Chưa gắn với truyện nào.";

      return {
        title: "Xóa thể loại?",
        body:
          `Bạn sắp xóa ${namePart}.${countPart} ` +
          "Thao tác sẽ gỡ bỏ thể loại và các liên kết liên quan. Truyện sẽ không bị xóa. Không thể hoàn tác.",
        metaItems: [
          genreId != null ? `ID #${genreId}` : "",
          count != null ? `${count} truyện` : ""
        ],
        confirmText: "Xóa",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn xóa thể loại này?"
      };
    }

    if (action === "delete-manga") {
      const mangaTitle = (form.dataset.mangaTitle || "").trim();
      const mangaId = safeNumber(form.dataset.mangaId);
      const chapters = safeNumber(form.dataset.mangaChapters);
      const isHidden = String(form.dataset.mangaHidden || "") === "1";

      const titlePart = mangaTitle ? `"${mangaTitle}"` : "truyện này";
      return {
        title: "Xóa truyện?",
        body:
          `Bạn sắp xóa ${titlePart}. ` +
          "Thao tác sẽ xóa toàn bộ chương, bình luận và dọn ảnh (nếu có). Có thể mất một lúc. Không thể hoàn tác.",
        metaItems: [
          mangaId != null ? `ID #${mangaId}` : "",
          chapters != null ? `${chapters} chương` : "",
          isHidden ? "Đang ẩn" : ""
        ],
        confirmText: "Xóa",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn xóa truyện này?"
      };
    }

    if (action === "delete-chapter") {
      const mangaTitle = (form.dataset.mangaTitle || "").trim();
      const mangaId = safeNumber(form.dataset.mangaId);
      const chapterId = safeNumber(form.dataset.chapterId);
      const chapterNumber = (form.dataset.chapterNumber || "").toString().trim();
      const pages = safeNumber(form.dataset.chapterPages);

      const mangaPart = mangaTitle ? `"${mangaTitle}"` : "truyện này";
      const chapterPart = chapterNumber ? `Chương ${chapterNumber}` : "chương này";

      return {
        title: "Xóa chương?",
        body:
          `Bạn sắp xóa ${chapterPart} của ${mangaPart}. ` +
          "Thao tác sẽ xóa chương và dọn ảnh (nếu có). Có thể mất một lúc. Không thể hoàn tác.",
        metaItems: [
          chapterId != null ? `ID #${chapterId}` : "",
          mangaId != null ? `Manga #${mangaId}` : "",
          pages != null ? `${pages} trang` : ""
        ],
        confirmText: "Xóa",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn xóa chương này?"
      };
    }

    if (action === "restore-trash-manga") {
      const mangaTitle = (form.dataset.mangaTitle || "").trim();
      const mangaId = safeNumber(form.dataset.trashId || form.dataset.mangaId);
      const chapterCount = safeNumber(form.dataset.trashChapterCount);
      const titlePart = mangaTitle ? `"${mangaTitle}"` : "truyện này";

      return {
        title: "Khôi phục truyện?",
        body:
          `Bạn muốn khôi phục ${titlePart} từ thùng rác? ` +
          "Hệ thống sẽ mở lại truyện và các chương đang ở trạng thái soft delete.",
        metaItems: [
          mangaId != null ? `ID #${mangaId}` : "",
          chapterCount != null ? `${chapterCount} chương đã xóa` : ""
        ],
        confirmText: "Khôi phục",
        confirmVariant: "default",
        fallbackText: "Bạn có chắc muốn khôi phục truyện này?"
      };
    }

    if (action === "restore-trash-chapter") {
      const chapterId = safeNumber(form.dataset.trashId || form.dataset.chapterId);
      const mangaTitle = (form.dataset.mangaTitle || "").trim();
      const chapterNumber = normalizeChapterNumberText(form.dataset.chapterNumber || "");
      const pages = safeNumber(form.dataset.chapterPages);
      const chapterPart = chapterNumber ? `Chương ${chapterNumber}` : "chương này";

      return {
        title: "Khôi phục chương?",
        body:
          `Bạn muốn khôi phục ${chapterPart}${mangaTitle ? ` của "${mangaTitle}"` : ""} từ thùng rác? ` +
          "Nếu có xung đột số chương đang hoạt động, hệ thống sẽ từ chối khôi phục.",
        metaItems: [
          chapterId != null ? `ID #${chapterId}` : "",
          pages != null ? `${pages} trang` : ""
        ],
        confirmText: "Khôi phục",
        confirmVariant: "default",
        fallbackText: "Bạn có chắc muốn khôi phục chương này?"
      };
    }

    if (action === "restore-trash-manga-bulk" || action === "restore-trash-chapter-bulk") {
      const type = action === "restore-trash-manga-bulk" ? "manga" : "chapter";
      const checkedCount = getTrashSelectedCheckboxes(type).length;
      const itemLabel = getTrashTypeLabel(type, true);

      return {
        title: `Khôi phục hàng loạt ${itemLabel}?`,
        body:
          checkedCount > 0
            ? `Bạn sắp khôi phục ${checkedCount} ${itemLabel} đã chọn trong thùng rác.`
            : `Bạn chưa chọn ${itemLabel} nào để khôi phục.`,
        metaItems: checkedCount > 0 ? [`${checkedCount} ${itemLabel}`] : [],
        confirmText: "Khôi phục đã chọn",
        confirmVariant: "default",
        fallbackText: `Bạn có chắc muốn khôi phục các ${itemLabel} đã chọn?`
      };
    }

    if (action === "purge-trash-manga") {
      const mangaTitle = (form.dataset.mangaTitle || "").trim();
      const mangaId = safeNumber(form.dataset.trashId || form.dataset.mangaId);
      const chapterCount = safeNumber(form.dataset.trashChapterCount);
      const titlePart = mangaTitle ? `"${mangaTitle}"` : "truyện này";

      return {
        title: "Xóa truyện?",
        body:
          `Bạn sắp xóa vĩnh viễn ${titlePart}. ` +
          "Toàn bộ chương, bình luận, bookmark và dữ liệu liên quan sẽ bị dọn sạch. Không thể hoàn tác.",
        metaItems: [
          mangaId != null ? `ID #${mangaId}` : "",
          chapterCount != null ? `${chapterCount} chương đã xóa` : ""
        ],
        confirmText: "Xóa",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn xóa truyện này?"
      };
    }

    if (action === "purge-trash-chapter") {
      const chapterId = safeNumber(form.dataset.trashId || form.dataset.chapterId);
      const mangaTitle = (form.dataset.mangaTitle || "").trim();
      const chapterNumber = normalizeChapterNumberText(form.dataset.chapterNumber || "");
      const pages = safeNumber(form.dataset.chapterPages);
      const chapterPart = chapterNumber ? `Chương ${chapterNumber}` : "chương này";

      return {
        title: "Xóa chương?",
        body:
          `Bạn sắp xóa vĩnh viễn ${chapterPart}${mangaTitle ? ` của "${mangaTitle}"` : ""}. ` +
          "Ảnh và dữ liệu liên quan sẽ bị dọn sạch. Không thể hoàn tác.",
        metaItems: [
          chapterId != null ? `ID #${chapterId}` : "",
          pages != null ? `${pages} trang` : ""
        ],
        confirmText: "Xóa",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn xóa chương này?"
      };
    }

    if (action === "hide-manga" || action === "show-manga") {
      const mangaTitle = (form.dataset.mangaTitle || "").trim();
      const mangaId = safeNumber(form.dataset.mangaId);
      const chapters = safeNumber(form.dataset.mangaChapters);

      const titlePart = mangaTitle ? `"${mangaTitle}"` : "truyện này";
      if (action === "hide-manga") {
        return {
          title: "Ẩn truyện?",
          body:
            `Bạn muốn ẩn ${titlePart} khỏi website? ` +
            "Người dùng sẽ không thấy truyện ở trang chủ và danh sách truyện. Có thể hoàn tác bằng nút Hiện.",
          metaItems: [
            mangaId != null ? `ID #${mangaId}` : "",
            chapters != null ? `${chapters} chương` : ""
          ],
          confirmText: "Ẩn",
          confirmVariant: "default",
          fallbackText: "Bạn có chắc muốn ẩn truyện này?"
        };
      }

      return {
        title: "Hiện truyện?",
        body: `Bạn muốn hiển thị ${titlePart} trở lại website?`,
        metaItems: [
          mangaId != null ? `ID #${mangaId}` : "",
          chapters != null ? `${chapters} chương` : ""
        ],
        confirmText: "Hiện",
        confirmVariant: "default",
        fallbackText: "Bạn có chắc muốn hiện truyện này?"
      };
    }

    if (action === "save-manga") {
      const mangaId = safeNumber(form.dataset.mangaId);
      const titleInput = form.querySelector("input[name=\"title\"]");
      const titleValue = titleInput && titleInput.value ? titleInput.value.trim() : "";
      const mangaTitle = titleValue || (form.dataset.mangaTitle || "").trim();
      const titlePart = mangaTitle ? `"${mangaTitle}"` : "truyện này";
      const isEdit = Boolean(mangaId);

      return {
        title: isEdit ? "Lưu thay đổi?" : "Tạo truyện mới?",
        body: isEdit
          ? `Bạn muốn lưu thay đổi cho ${titlePart}?`
          : `Bạn muốn tạo ${titlePart}?`,
        metaItems: [mangaId != null ? `ID #${mangaId}` : ""],
        confirmText: isEdit ? "Lưu" : "Tạo",
        confirmVariant: "default",
        fallbackText: isEdit ? "Bạn có chắc muốn lưu thay đổi?" : "Bạn có chắc muốn tạo truyện?"
      };
    }

    if (action === "delete-comment") {
      const commentId = safeNumber(form.dataset.commentId);
      const isForumMode = String(form.dataset.forumMode || "") === "1";
      const forumTopicTitle = (form.dataset.forumTopicTitle || "").trim();
      const forumTopicId = safeNumber(form.dataset.forumTopicId);
      const forumItemType = (form.dataset.forumItemType || "").toString().trim().toLowerCase();
      const mangaTitle = (form.dataset.mangaTitle || "").trim();
      const chapterNumber = normalizeChapterNumberText(form.dataset.chapterNumber || "");
      const author = (form.dataset.commentAuthor || "").trim();

      if (isForumMode) {
        const itemLabel = forumItemType === "reply" ? "phản hồi" : "bài viết";
        const topicPart = forumTopicTitle ? ` trong "${forumTopicTitle}"` : " trong diễn đàn";
        const authorPart = author ? ` của ${author}` : "";
        return {
          title: `Xóa ${itemLabel}?`,
          body:
            `Bạn sắp xóa một ${itemLabel}${authorPart}${topicPart}. ` +
            "Thao tác không thể hoàn tác.",
          metaItems: [
            commentId != null ? `ID #${commentId}` : "",
            forumTopicId != null ? `Bài #${forumTopicId}` : ""
          ],
          confirmText: "Xóa",
          confirmVariant: "danger",
          fallbackText: `Bạn có chắc muốn xóa ${itemLabel} này?`
        };
      }

      const mangaPart = mangaTitle ? `"${mangaTitle}"` : "truyện này";
      const chapterPart = chapterNumber ? ` (Chương ${chapterNumber})` : "";
      const authorPart = author ? ` bởi ${author}` : "";

      return {
        title: "Xóa bình luận?",
        body:
          `Bạn sắp xóa một bình luận của ${mangaPart}${chapterPart}${authorPart}. ` +
          "Thao tác không thể hoàn tác.",
        metaItems: [commentId != null ? `ID #${commentId}` : ""],
        confirmText: "Xóa",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn xóa bình luận này?"
      };
    }

    if (action === "hide-comment") {
      const commentId = safeNumber(form.dataset.commentId);
      const isForumMode = String(form.dataset.forumMode || "") === "1";
      const forumTopicTitle = (form.dataset.forumTopicTitle || "").trim();
      const forumTopicId = safeNumber(form.dataset.forumTopicId);
      const forumItemType = (form.dataset.forumItemType || "").toString().trim().toLowerCase();
      const mangaTitle = (form.dataset.mangaTitle || "").trim();
      const chapterNumber = normalizeChapterNumberText(form.dataset.chapterNumber || "");
      const author = (form.dataset.commentAuthor || "").trim();

      if (isForumMode) {
        const itemLabel = forumItemType === "reply" ? "phản hồi" : "bài viết";
        const topicPart = forumTopicTitle ? ` trong "${forumTopicTitle}"` : " trong diễn đàn";
        const authorPart = author ? ` của ${author}` : "";
        return {
          title: `Ẩn ${itemLabel}?`,
          body:
            `Bạn sắp ẩn một ${itemLabel}${authorPart}${topicPart}. ` +
            "Nội dung sẽ không hiển thị công khai và có thể khôi phục lại sau.",
          metaItems: [
            commentId != null ? `ID #${commentId}` : "",
            forumTopicId != null ? `Bài #${forumTopicId}` : ""
          ],
          confirmText: "Ẩn",
          confirmVariant: "default",
          fallbackText: `Bạn có chắc muốn ẩn ${itemLabel} này?`
        };
      }

      const mangaPart = mangaTitle ? `trong \"${mangaTitle}\"` : "trong diễn đàn";
      const chapterPart = chapterNumber ? ` (Chương ${chapterNumber})` : "";
      const authorPart = author ? ` của ${author}` : "";

      return {
        title: "Ẩn bình luận?",
        body:
          `Bạn sắp ẩn một bình luận${authorPart} ${mangaPart}${chapterPart}. ` +
          "Nội dung sẽ không hiển thị công khai và có thể khôi phục lại sau.",
        metaItems: [commentId != null ? `ID #${commentId}` : ""],
        confirmText: "Ẩn",
        confirmVariant: "default",
        fallbackText: "Bạn có chắc muốn ẩn bình luận này?"
      };
    }

    if (action === "bulk-delete-comments") {
      const checkedCount = document.querySelectorAll("[data-comment-select]:checked").length;
      const count = Number.isFinite(checkedCount) ? checkedCount : 0;
      return {
        title: "Xóa hàng loạt bình luận?",
        body:
          count > 0
            ? `Bạn sắp xóa ${count} bình luận đã chọn. Nếu có reply con, hệ thống sẽ xóa luôn toàn bộ nhánh liên quan.`
            : "Bạn chưa chọn bình luận nào để xóa.",
        metaItems: count > 0 ? [`${count} bình luận`] : [],
        confirmText: "Xóa đã chọn",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn xóa các bình luận đã chọn?"
      };
    }

    if (action === "bulk-hide-forum-topics") {
      const checkedCount = document.querySelectorAll("[data-forum-topic-select]:checked").length;
      const count = Number.isFinite(checkedCount) ? checkedCount : 0;
      return {
        title: "Ẩn hàng loạt bài đăng?",
        body:
          count > 0
            ? `Bạn sắp ẩn ${count} bài đăng đã chọn. Các bình luận con của từng bài cũng sẽ bị ẩn theo.`
            : "Bạn chưa chọn bài đăng nào để ẩn.",
        metaItems: count > 0 ? [`${count} bài đăng`] : [],
        confirmText: "Ẩn đã chọn",
        confirmVariant: "default",
        fallbackText: "Bạn có chắc muốn ẩn các bài đăng đã chọn?"
      };
    }

    if (action === "bulk-delete-forum-topics") {
      const checkedCount = document.querySelectorAll("[data-forum-topic-select]:checked").length;
      const count = Number.isFinite(checkedCount) ? checkedCount : 0;
      return {
        title: "Xóa hàng loạt bài đăng?",
        body:
          count > 0
            ? `Bạn sắp xóa ${count} bài đăng đã chọn. Toàn bộ bình luận trong từng bài sẽ bị xóa theo. Thao tác không thể hoàn tác.`
            : "Bạn chưa chọn bài đăng nào để xóa.",
        metaItems: count > 0 ? [`${count} bài đăng`] : [],
        confirmText: "Xóa đã chọn",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn xóa các bài đăng đã chọn?"
      };
    }

    if (action === "bulk-delete-chapters") {
      const checkedCount = document.querySelectorAll("[data-chapter-select]:checked").length;
      const count = Number.isFinite(checkedCount) ? checkedCount : 0;
      const mangaTitle = (form.dataset.mangaTitle || "").toString().trim();
      const mangaId = safeNumber(form.dataset.mangaId);
      const titlePart = mangaTitle ? ` của "${mangaTitle}"` : "";

      return {
        title: "Xóa hàng loạt chương?",
        body:
          count > 0
            ? `Bạn sắp xóa ${count} chương đã chọn${titlePart}. Hệ thống sẽ dọn ảnh liên quan và thao tác không thể hoàn tác.`
            : "Bạn chưa chọn chương nào để xóa.",
        metaItems: [count > 0 ? `${count} chương` : "", mangaId != null ? `Manga #${mangaId}` : ""],
        confirmText: "Xóa đã chọn",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn xóa các chương đã chọn?"
      };
    }

    if (action === "purge-trash-manga-bulk" || action === "purge-trash-chapter-bulk") {
      const type = action === "purge-trash-manga-bulk" ? "manga" : "chapter";
      const checkedCount = getTrashSelectedCheckboxes(type).length;
      const itemLabel = getTrashTypeLabel(type, true);

      return {
        title: `Xóa hàng loạt ${itemLabel}?`,
        body:
          checkedCount > 0
            ? `Bạn sắp xóa ${checkedCount} ${itemLabel} đã chọn trong thùng rác. Dữ liệu liên quan sẽ bị dọn sạch và không thể hoàn tác.`
            : `Bạn chưa chọn ${itemLabel} nào để xóa.`,
        metaItems: checkedCount > 0 ? [`${checkedCount} ${itemLabel}`] : [],
        confirmText: "Xóa đã chọn",
        confirmVariant: "danger",
        fallbackText: `Bạn có chắc muốn xóa các ${itemLabel} đã chọn?`
      };
    }

    if (action === "purge-trash-manga-all" || action === "purge-trash-chapter-all") {
      const type = action === "purge-trash-manga-all" ? "manga" : "chapter";
      const totalRaw = Number(form.dataset.trashTotal);
      const totalCount = Number.isFinite(totalRaw) && totalRaw > 0 ? Math.floor(totalRaw) : 0;
      const itemLabel = getTrashTypeLabel(type, true);

      return {
        title: `Xóa toàn bộ ${itemLabel}?`,
        body:
          totalCount > 0
            ? `Bạn sắp xóa toàn bộ ${totalCount} ${itemLabel} trong thùng rác. Dữ liệu liên quan sẽ bị dọn sạch và không thể hoàn tác.`
            : `Thùng rác ${itemLabel} hiện đang trống.`,
        metaItems: totalCount > 0 ? [`${totalCount} ${itemLabel}`] : [],
        confirmText: "Xóa toàn bộ",
        confirmVariant: "danger",
        fallbackText: `Bạn có chắc muốn xóa toàn bộ ${itemLabel} trong thùng rác?`
      };
    }

    if (action === "save-badge") {
      const badgeId = safeNumber(form.dataset.badgeId);
      const formId = (form.getAttribute("id") || "").toString().trim();
      let label = (form.dataset.badgeLabel || "").trim();
      if (formId) {
        const labelInput = document.querySelector(`input[name="label"][form="${formId}"]`);
        if (labelInput && "value" in labelInput) {
          const next = String(labelInput.value || "").trim();
          if (next) {
            label = next;
          }
        }
      }

      const namePart = label ? `"${label}"` : "huy hiệu này";
      return {
        title: "Lưu thay đổi huy hiệu?",
        body: `Bạn muốn lưu thay đổi cho ${namePart}?`,
        metaItems: [badgeId != null ? `ID #${badgeId}` : ""],
        confirmText: "Lưu",
        confirmVariant: "default",
        fallbackText: "Bạn có chắc muốn lưu thay đổi huy hiệu này?"
      };
    }

    if (action === "save-member") {
      const memberId = (form.dataset.memberId || "").trim();
      const memberName = (form.dataset.memberName || "").trim();
      const formId = (form.getAttribute("id") || "").toString().trim();
      let nextName = memberName;
      if (formId) {
        const input = document.querySelector(`input[name="display_name"][form="${formId}"]`);
        if (input && "value" in input) {
          const value = String(input.value || "").trim();
          if (value) {
            nextName = value;
          }
        }
      }

      const namePart = nextName ? `"${nextName}"` : "thành viên này";
      return {
        title: "Lưu thông tin thành viên?",
        body: `Bạn muốn lưu thay đổi cho ${namePart}?`,
        metaItems: [memberId ? `ID ${memberId}` : ""],
        confirmText: "Lưu",
        confirmVariant: "default",
        fallbackText: "Bạn có chắc muốn lưu thay đổi thành viên này?"
      };
    }

    if (action === "assign-member-badge") return null;

    if (action === "remove-member-badge") return null;

    if (action === "toggle-member-ban") {
      const memberId = (form.dataset.memberId || "").trim();
      const memberName = (form.dataset.memberName || "").trim();
      const mode = (form.dataset.memberMode || "").trim().toLowerCase();
      const memberPart = memberName ? `"${memberName}"` : "thành viên này";

      if (mode === "unban") {
        return {
          title: "Mở khóa thành viên?",
          body: `Bạn muốn mở khóa ${memberPart}, gỡ Banned và cấp lại huy hiệu Member?`,
          metaItems: [memberId ? `ID ${memberId}` : ""],
          confirmText: "Mở khóa",
          confirmVariant: "default",
          fallbackText: "Bạn có chắc muốn mở khóa thành viên này?"
        };
      }

      return {
        title: "Ban thành viên?",
        body:
          `Bạn sắp ban ${memberPart}. ` +
          "Hệ thống sẽ xóa toàn bộ huy hiệu hiện có và chỉ giữ huy hiệu Banned để khóa toàn bộ tương tác.",
        metaItems: [memberId ? `ID ${memberId}` : ""],
        confirmText: "Ban",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn ban thành viên này?"
      };
    }

    if (action === "delete-badge") {
      const badgeId = safeNumber(form.dataset.badgeId);
      const label = (form.dataset.badgeLabel || "").trim();
      const namePart = label ? `"${label}"` : "huy hiệu này";

      return {
        title: "Xóa huy hiệu?",
        body:
          `Bạn sắp xóa ${namePart}. ` +
          "Huy hiệu sẽ bị gỡ khỏi mọi user đang được cấp. Thao tác không thể hoàn tác.",
        metaItems: [badgeId != null ? `ID #${badgeId}` : ""],
        confirmText: "Xóa",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn xóa huy hiệu này?"
      };
    }

    if (action === "delete-team") {
      const teamId = safeNumber(form.dataset.teamId);
      const teamName = (form.dataset.teamName || "").trim();
      const statusRaw = (form.dataset.teamStatus || "").toString().trim().toLowerCase();
      const memberCount = safeNumber(form.dataset.teamMemberCount);
      const teamPart = teamName ? `"${teamName}"` : "nhóm dịch này";
      const statusLabel =
        statusRaw === "pending"
          ? "Chờ duyệt"
          : statusRaw === "approved"
          ? "Đã duyệt"
          : statusRaw === "rejected"
          ? "Đã từ chối"
          : "";

      return {
        title: "Xóa nhóm dịch?",
        body:
          `Bạn sắp xóa ${teamPart}. ` +
          "Thao tác sẽ xóa thành viên, avatar, cover, thông báo liên quan và cập nhật lại nhóm dịch trong truyện/chương. Không thể hoàn tác.",
        metaItems: [
          teamId != null ? `ID #${teamId}` : "",
          memberCount != null ? `${memberCount} thành viên` : "",
          statusLabel ? `Trạng thái: ${statusLabel}` : ""
        ],
        confirmText: "Xóa",
        confirmVariant: "danger",
        fallbackText: "Bạn có chắc muốn xóa nhóm dịch này?"
      };
    }

    return null;
  };

  document.querySelectorAll(".admin-table--badges").forEach((table) => {
    syncBadgeOrderUi(table);
  });

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-confirm-href]");
    if (!trigger) return;
    const href = (trigger.dataset.confirmHref || trigger.getAttribute("href") || "").trim();
    if (!href) return;

    event.preventDefault();
    openConfirm(
      { href },
      {
        title: (trigger.dataset.confirmTitle || "Xác nhận").trim(),
        body: (trigger.dataset.confirmBody || "").trim(),
        metaItems: [],
        confirmText: (trigger.dataset.confirmConfirmText || "Xác nhận").trim(),
        confirmVariant: (trigger.dataset.confirmVariant || "default").trim(),
        fallbackText: (trigger.dataset.confirmFallbackText || "").trim()
      }
    );
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.dataset.confirmBypass === "1") {
      delete form.dataset.confirmBypass;
      return;
    }

    if (form.dataset.badgeMove === "1") {
      event.preventDefault();
      void handleBadgeMoveSubmit(form, event.submitter);
      return;
    }

    const action = (form.dataset.confirmAction || "").trim();
    if (action === "remove-member-badge" && Date.now() < ignoreRemoveBadgeUntil) {
      event.preventDefault();
      return;
    }

    if (!form.dataset.confirmAction) return;

    event.preventDefault();
    const config = buildConfirmConfig(form);
    if (!config) {
      submitConfirmedForm(form, event.submitter);
      return;
    }
    return openConfirm({ form, submitter: event.submitter }, config);
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    if (target.matches("[data-trash-select-all]")) {
      const type = getTrashTypeFromElement(target);
      if (!type) return;

      const shouldCheck = Boolean(target.checked);
      getTrashSelectionCheckboxes(type).forEach((input) => {
        if (input.disabled) return;
        input.checked = shouldCheck;
      });
      syncTrashSelectionUi(type);
      return;
    }

    if (target.matches("[data-trash-select]")) {
      const type = getTrashTypeFromElement(target);
      if (!type) return;
      syncTrashSelectionUi(type);
    }
  });

  const closeDialog = () => {
    if (!supportsDialog) return;
    if (!dialog) return;
    dialog.close();
  };

  if (cancelBtn) {
    cancelBtn.addEventListener("click", closeDialog);
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", closeDialog);
  }

  if (supportsDialog) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });

    dialog.addEventListener("close", () => {
      releasePendingSubmitterLoading();
      pendingForm = null;
      pendingConfig = null;
      pendingHref = "";
      pendingSubmitter = null;
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      if (!pendingForm && !pendingHref) return;
      const form = pendingForm;
      const href = pendingHref;
      const submitter = pendingSubmitter;
      pendingForm = null;
      pendingConfig = null;
      pendingHref = "";
      pendingSubmitter = null;
      closeDialog();
      if (form) {
        submitConfirmedForm(form, submitter);
        return;
      }
      if (href) {
        window.location.href = href;
      }
    });
  }

  syncAllTrashSelectionUi();
})();

(() => {
  const root = document.querySelector("[data-admin-teams-root]");
  if (!root) return;

  const filterForm = root.querySelector("[data-admin-teams-filter-form]");
  const qInput = root.querySelector("[data-admin-teams-filter-q]");
  const reviewSelect = root.querySelector("[data-admin-teams-filter-review]");
  const tableBody = root.querySelector("[data-admin-teams-table-body]");
  const pendingCountEl = root.querySelector("[data-admin-teams-pending-count]");
  const inlineStatusEl = root.querySelector("[data-admin-teams-inline-status]");

  const editorDialog = root.querySelector("[data-admin-team-editor-dialog]");
  const editorCard = root.querySelector(".admin-team-editor-modal__card");
  const editorForm = root.querySelector("[data-admin-team-edit-form]");
  const editorHeading = root.querySelector("[data-admin-team-editor-heading]");
  const editorNote = root.querySelector("[data-admin-team-editor-note]");
  const editorName = root.querySelector("[data-admin-team-edit-name]");
  const editorSlug = root.querySelector("[data-admin-team-edit-slug]");
  const editorStatus = root.querySelector("[data-admin-team-edit-status]");
  const editorRejectReason = root.querySelector("[data-admin-team-edit-reject-reason]");
  const editorIntro = root.querySelector("[data-admin-team-edit-intro]");
  const editorFacebook = root.querySelector("[data-admin-team-edit-facebook]");
  const editorDiscord = root.querySelector("[data-admin-team-edit-discord]");
  const editorCloseBtn = root.querySelector("[data-admin-team-edit-close]");
  const editorCancelBtn = root.querySelector("[data-admin-team-edit-cancel]");
  const editorSubmitBtn = root.querySelector("[data-admin-team-edit-submit]");
  const editorMembersPanel = root.querySelector("[data-admin-team-members-panel]");
  const editorMembersList = root.querySelector("[data-admin-team-members-list]");
  const editorMembersStatus = root.querySelector("[data-admin-team-members-status]");
  const memberAddForm = root.querySelector("[data-admin-team-member-add-form]");
  const memberAddUser = root.querySelector("[data-admin-team-member-add-user]");
  const memberAddSearchResults = root.querySelector("[data-admin-team-member-search-results]");
  const memberAddSearchError = root.querySelector("[data-admin-team-member-search-error]");
  const memberAddRole = root.querySelector("[data-admin-team-member-add-role]");
  const memberAddManga = root.querySelector("[data-admin-team-member-add-manga]");
  const memberAddChapter = root.querySelector("[data-admin-team-member-add-chapter]");
  const memberAddSubmit = root.querySelector("[data-admin-team-member-add-submit]");
  const teamConfirmDialog = root.querySelector("[data-admin-team-confirm-dialog]");
  const teamConfirmTitle = root.querySelector("[data-admin-team-confirm-title]");
  const teamConfirmBody = root.querySelector("[data-admin-team-confirm-body]");
  const teamConfirmCloseBtn = root.querySelector("[data-admin-team-confirm-close]");
  const teamConfirmCancelBtn = root.querySelector("[data-admin-team-confirm-cancel]");
  const teamConfirmSubmitBtn = root.querySelector("[data-admin-team-confirm-submit]");
  const editorRejectField = editorRejectReason ? editorRejectReason.closest("label") : null;

  if (
    !filterForm ||
    !qInput ||
    !reviewSelect ||
    !tableBody ||
    !pendingCountEl ||
    !inlineStatusEl ||
    !editorDialog ||
    !editorForm ||
    !editorName ||
    !editorSlug ||
    !editorStatus ||
    !editorRejectReason ||
    !editorIntro ||
    !editorFacebook ||
    !editorDiscord ||
    !editorCloseBtn ||
    !editorCancelBtn ||
    !editorSubmitBtn ||
    !editorMembersPanel ||
    !editorMembersList ||
    !editorMembersStatus ||
    !memberAddForm ||
    !memberAddUser ||
    !memberAddSearchResults ||
    !memberAddSearchError ||
    !memberAddRole ||
    !memberAddManga ||
    !memberAddChapter ||
    !memberAddSubmit ||
    !teamConfirmDialog ||
    !teamConfirmTitle ||
    !teamConfirmBody ||
    !teamConfirmCloseBtn ||
    !teamConfirmCancelBtn ||
    !teamConfirmSubmitBtn
  ) {
    return;
  }

  const DEFAULT_REVIEW = "all";
  const STATUS_LABELS = {
    pending: "Chờ duyệt",
    approved: "Đã duyệt",
    rejected: "Đã từ chối"
  };
  const TEAM_MEMBER_ROLE_LABELS = {
    leader: "Leader",
    member: "Member"
  };

  const state = {
    q: (qInput.value || "").toString().trim(),
    review: (reviewSelect.value || DEFAULT_REVIEW).toString().trim().toLowerCase() || DEFAULT_REVIEW
  };

  let inlineStatusTimer = null;
  let filterDebounceTimer = null;
  let fetchController = null;
  let fetchToken = 0;
  let inputComposing = false;
  let membersFetchController = null;
  let membersFetchToken = 0;
  let memberSearchController = null;
  let memberSearchToken = 0;
  let memberSearchDebounceTimer = null;
  let memberSearchInputComposing = false;
  let memberSearchOptions = [];
  let pendingTeamConfirmResolve = null;

  const escapeHtml = (value) =>
    (value == null ? "" : String(value))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const escapeAttr = (value) => escapeHtml(value);

  const normalizeStatus = (value) => {
    const normalized = (value || "").toString().trim().toLowerCase();
    if (normalized === "approved" || normalized === "rejected") return normalized;
    return "pending";
  };

  const toInteger = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  };

  const readString = (value) => (value == null ? "" : String(value)).trim();

  const normalizeTeamItem = (item) => {
    if (!item || typeof item !== "object") return null;
    const id = toInteger(item.id, 0);
    if (!id) return null;
    return {
      id,
      name: readString(item.name),
      slug: readString(item.slug),
      intro: readString(item.intro),
      facebookUrl: readString(item.facebookUrl),
      discordUrl: readString(item.discordUrl),
      status: normalizeStatus(item.status),
      rejectReason: readString(item.rejectReason),
      creatorUsername: readString(item.creatorUsername),
      creatorDisplayName: readString(item.creatorDisplayName),
      memberCount: Math.max(0, toInteger(item.memberCount, 0))
    };
  };

  const setInlineStatus = (message, tone = "success") => {
    if (!inlineStatusEl) return;
    const text = (message || "").toString().trim();
    if (!text) {
      inlineStatusEl.hidden = true;
      inlineStatusEl.textContent = "";
      inlineStatusEl.classList.remove("admin-error", "admin-success");
      return;
    }
    if (inlineStatusTimer) {
      window.clearTimeout(inlineStatusTimer);
      inlineStatusTimer = null;
    }

    inlineStatusEl.hidden = false;
    inlineStatusEl.textContent = text;
    inlineStatusEl.classList.remove("admin-error", "admin-success");
    inlineStatusEl.classList.add(tone === "error" ? "admin-error" : "admin-success");

    inlineStatusTimer = window.setTimeout(() => {
      inlineStatusEl.hidden = true;
      inlineStatusEl.textContent = "";
      inlineStatusEl.classList.remove("admin-error", "admin-success");
      inlineStatusTimer = null;
    }, 3000);
  };

  const setButtonBusy = (button, label) => {
    if (!button || !(button instanceof HTMLButtonElement)) return;
    if (button.dataset.originalHtml == null) {
      button.dataset.originalHtml = button.innerHTML;
    }
    button.disabled = true;
    button.classList.add("is-loading");
    if (label) {
      button.textContent = String(label);
    }
  };

  const restoreButton = (button) => {
    if (!button || !(button instanceof HTMLButtonElement)) return;
    const originalHtml = button.dataset.originalHtml;
    if (originalHtml != null) {
      button.innerHTML = originalHtml;
    }
    delete button.dataset.originalHtml;
    button.classList.remove("is-loading");
    button.disabled = false;
  };

  const buildQuery = () => {
    const params = new URLSearchParams();
    const q = (state.q || "").toString().trim();
    const review = (state.review || DEFAULT_REVIEW).toString().trim().toLowerCase();
    if (q) {
      params.set("q", q);
    }
    if (review && review !== DEFAULT_REVIEW) {
      params.set("review", review);
    }
    return params;
  };

  const syncUrlFromState = () => {
    const params = buildQuery();
    const url = new URL(window.location.href);
    url.search = params.toString();
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const statusLabel = (value) => STATUS_LABELS[normalizeStatus(value)] || "Chờ duyệt";

  const buildActionHtml = (team) => {
    const baseActions = [];
    if (team.status === "pending") {
      baseActions.push(`
        <form class="admin-team-action-form admin-team-action-form--single" method="post" action="/admin/teams/${team.id}/review" data-admin-team-review-form>
          <input type="hidden" name="action" value="approve" />
          <button class="button" type="submit">Duyệt</button>
        </form>
      `);
      baseActions.push(`
        <form class="admin-team-action-form admin-team-action-form--reject" method="post" action="/admin/teams/${team.id}/review" data-admin-team-review-form>
          <input type="hidden" name="action" value="reject" />
          <input type="text" name="reject_reason" maxlength="300" placeholder="Lý do từ chối (tùy chọn)" />
          <button class="button button--ghost" type="submit">Từ chối</button>
        </form>
      `);
    }

    baseActions.push(`
      <div class="admin-team-actions__row">
        <button
          class="button button--ghost button--compact"
          type="button"
          data-admin-team-edit-open
          data-team-id="${team.id}"
          data-team-name="${escapeAttr(team.name)}"
          data-team-slug="${escapeAttr(team.slug)}"
          data-team-intro="${escapeAttr(team.intro)}"
          data-team-status="${escapeAttr(team.status)}"
          data-team-reject-reason="${escapeAttr(team.rejectReason)}"
          data-team-facebook-url="${escapeAttr(team.facebookUrl)}"
          data-team-discord-url="${escapeAttr(team.discordUrl)}"
        >
          Sửa
        </button>

        <form
          class="admin-team-action-form admin-team-action-form--inline"
          method="post"
          action="/admin/teams/${team.id}/delete"
          data-confirm-action="delete-team"
          data-team-id="${team.id}"
          data-team-name="${escapeAttr(team.name)}"
          data-team-status="${escapeAttr(team.status)}"
          data-team-member-count="${team.memberCount}"
        >
          <button class="button button--ghost button--danger button--compact" type="submit">Xóa</button>
        </form>
      </div>
    `);

    return baseActions.join("");
  };

  const buildTeamRowHtml = (team) => {
    const creatorText = team.creatorDisplayName || (team.creatorUsername ? `@${team.creatorUsername}` : "-");
    const introText = team.intro ? escapeHtml(team.intro) : "-";
    const rejectReasonHtml =
      team.status === "rejected" && team.rejectReason
        ? `<span class="admin-sub">${escapeHtml(team.rejectReason)}</span>`
        : "";

    return `
      <tr data-team-row-id="${team.id}">
        <td data-label="ID">#${team.id}</td>
        <td data-label="Tên">
          <strong>${escapeHtml(team.name)}</strong>
          <p class="admin-team-slug">/${escapeHtml(team.slug)}</p>
        </td>
        <td data-label="Người tạo">
          ${escapeHtml(creatorText)}
          <span class="admin-sub">${team.memberCount} thành viên</span>
        </td>
        <td data-label="Mô tả"><span class="admin-team-intro">${introText}</span></td>
        <td data-label="Trạng thái">
          <span class="admin-team-status is-${team.status}">${statusLabel(team.status)}</span>
          ${rejectReasonHtml}
        </td>
        <td class="admin-cell-actions" data-label="Hành động">
          <div class="admin-team-actions">
            ${buildActionHtml(team)}
          </div>
        </td>
      </tr>
    `;
  };

  const renderTeams = (items) => {
    const list = Array.isArray(items)
      ? items
          .map((item) => normalizeTeamItem(item))
          .filter(Boolean)
      : [];

    if (!list.length) {
      const hasFilters = Boolean((state.q || "").trim() || state.review !== DEFAULT_REVIEW);
      tableBody.innerHTML = `<tr><td colspan="6">${hasFilters ? "Không có nhóm dịch phù hợp bộ lọc." : "Chưa có nhóm dịch."}</td></tr>`;
      return;
    }

    tableBody.innerHTML = list.map((team) => buildTeamRowHtml(team)).join("");
  };

  const postFormJson = async (form, fallbackMessage) => {
    const formActionRaw =
      (form instanceof HTMLFormElement && typeof form.getAttribute === "function" ? form.getAttribute("action") : "") ||
      (form && typeof form.action === "string" ? form.action : "");
    const formAction = String(formActionRaw || "").trim();
    if (!formAction) {
      throw new Error("Không thể xác định endpoint thao tác.");
    }

    const params = new URLSearchParams();
    const formData = new FormData(form);
    formData.forEach((value, key) => {
      params.append(key, value == null ? "" : String(value));
    });

    const response = await fetch(formAction, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json"
      },
      credentials: "same-origin",
      body: params.toString()
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const message =
        data && data.error
          ? String(data.error)
          : (fallbackMessage || "Thao tác thất bại. Vui lòng thử lại.").toString();
      throw new Error(message);
    }

    return data;
  };

  const postUrlEncodedJson = async (url, payload, fallbackMessage) => {
    const params = new URLSearchParams();
    const source = payload && typeof payload === "object" ? payload : {};
    Object.keys(source).forEach((key) => {
      const value = source[key];
      params.append(key, value == null ? "" : String(value));
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json"
      },
      credentials: "same-origin",
      body: params.toString()
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const message =
        data && data.error
          ? String(data.error)
          : (fallbackMessage || "Thao tác thất bại. Vui lòng thử lại.").toString();
      throw new Error(message);
    }

    return data;
  };

  const normalizeTeamMemberRole = (value) => {
    const normalized = (value || "").toString().trim().toLowerCase();
    return normalized === "leader" ? "leader" : "member";
  };

  const teamMemberRoleLabel = (value) => TEAM_MEMBER_ROLE_LABELS[normalizeTeamMemberRole(value)] || "Member";

  const getTeamMemberPermissionGroups = (member) => {
    const source = member && typeof member === "object" ? member : {};
    const groupSource =
      source.permissionGroups && typeof source.permissionGroups === "object" ? source.permissionGroups : {};
    if (Object.prototype.hasOwnProperty.call(groupSource, "canManageManga")) {
      return {
        canManageManga: Boolean(groupSource.canManageManga),
        canManageChapter: Boolean(groupSource.canManageChapter)
      };
    }

    const permissions = source.permissions && typeof source.permissions === "object" ? source.permissions : {};
    return {
      canManageManga: Boolean(permissions.canAddManga && permissions.canEditManga && permissions.canDeleteManga),
      canManageChapter: Boolean(permissions.canAddChapter && permissions.canEditChapter && permissions.canDeleteChapter)
    };
  };

  const setEditorMembersStatus = (message, tone = "success") => {
    if (!editorMembersStatus) return;
    const text = (message || "").toString().trim();
    if (!text) {
      editorMembersStatus.hidden = true;
      editorMembersStatus.textContent = "";
      editorMembersStatus.classList.remove("admin-error", "admin-success");
      return;
    }

    editorMembersStatus.hidden = false;
    editorMembersStatus.textContent = text;
    editorMembersStatus.classList.remove("admin-error", "admin-success");
    editorMembersStatus.classList.add(tone === "error" ? "admin-error" : "admin-success");
  };

  const closeTeamConfirm = (confirmed = false) => {
    const resolver = pendingTeamConfirmResolve;
    pendingTeamConfirmResolve = null;

    if (teamConfirmDialog instanceof HTMLDialogElement && typeof teamConfirmDialog.close === "function") {
      if (teamConfirmDialog.open) {
        teamConfirmDialog.close();
      }
    } else {
      teamConfirmDialog.removeAttribute("open");
    }

    if (typeof resolver === "function") {
      resolver(Boolean(confirmed));
    }
  };

  const openTeamConfirm = ({ title, body, confirmText = "Xác nhận", confirmVariant = "default" } = {}) =>
    new Promise((resolve) => {
      if (pendingTeamConfirmResolve) {
        const previousResolver = pendingTeamConfirmResolve;
        pendingTeamConfirmResolve = null;
        previousResolver(false);
      }

      pendingTeamConfirmResolve = resolve;
      teamConfirmTitle.textContent = readString(title) || "Xác nhận thao tác";
      teamConfirmBody.textContent = readString(body) || "Bạn có chắc muốn tiếp tục?";

      teamConfirmSubmitBtn.textContent = readString(confirmText) || "Xác nhận";
      teamConfirmSubmitBtn.className = "button";
      if (readString(confirmVariant).toLowerCase() === "danger") {
        teamConfirmSubmitBtn.classList.add("button--danger");
      }

      if (teamConfirmDialog instanceof HTMLDialogElement && typeof teamConfirmDialog.showModal === "function") {
        if (!teamConfirmDialog.open) {
          teamConfirmDialog.showModal();
        }
      } else {
        teamConfirmDialog.setAttribute("open", "");
      }

      teamConfirmSubmitBtn.focus();
    });

  const normalizeMemberSearchItem = (item) => {
    if (!item || typeof item !== "object") return null;
    const userId = readString(item.userId);
    if (!userId) return null;
    const username = readString(item.username);
    const displayName = readString(item.displayName) || username || "Thành viên chưa đặt tên";
    return {
      userId,
      username,
      displayName,
      avatarUrl: readString(item.avatarUrl),
      alreadyInTeam: Boolean(item.alreadyInTeam)
    };
  };

  const setMemberSearchError = (message) => {
    const text = readString(message);
    memberAddSearchError.textContent = text;
    memberAddSearchError.hidden = !text;
  };

  const hideMemberSearchResults = () => {
    memberAddSearchResults.hidden = true;
    memberAddSearchResults.innerHTML = "";
  };

  const clearMemberSearchState = () => {
    if (memberSearchController) {
      memberSearchController.abort();
      memberSearchController = null;
    }
    if (memberSearchDebounceTimer) {
      window.clearTimeout(memberSearchDebounceTimer);
      memberSearchDebounceTimer = null;
    }
    memberSearchOptions = [];
    setMemberSearchError("");
    hideMemberSearchResults();
  };

  const renderMemberSearchResults = () => {
    const query = readString(memberAddUser.value);
    const list = Array.isArray(memberSearchOptions) ? memberSearchOptions : [];
    if (!query) {
      hideMemberSearchResults();
      return;
    }

    if (!list.length) {
      memberAddSearchResults.hidden = false;
      memberAddSearchResults.innerHTML =
        '<p class="note admin-team-member-search__empty">Không tìm thấy thành viên phù hợp.</p>';
      return;
    }

    memberAddSearchResults.hidden = false;
    memberAddSearchResults.innerHTML = list
      .map((item) => {
        const avatarHtml = buildMemberAvatarHtml(item);
        const subText = item.username ? `@${item.username}` : "Chưa có username";
        return `
          <button
            class="admin-team-member-search__option${item.alreadyInTeam ? " is-disabled" : ""}"
            type="button"
            data-admin-team-member-search-option
            data-user-id="${escapeAttr(item.userId)}"
            data-username="${escapeAttr(item.username)}"
            ${item.alreadyInTeam ? "disabled" : ""}
          >
            <span class="admin-team-member-search__avatar">${avatarHtml}</span>
            <span class="admin-team-member-search__meta">
              <span class="admin-team-member-search__name">${escapeHtml(item.displayName)}</span>
              <span class="admin-team-member-search__sub">${escapeHtml(subText)}</span>
            </span>
            <span class="admin-team-member-search__state">${item.alreadyInTeam ? "Đã trong nhóm" : "Chọn"}</span>
          </button>
        `;
      })
      .join("");
  };

  const fetchMemberSearchOptions = async () => {
    const rawQuery = readString(memberAddUser.value);
    const query = rawQuery.startsWith("@") ? readString(rawQuery.slice(1)) : rawQuery;
    if (!query) {
      memberSearchOptions = [];
      renderMemberSearchResults();
      return;
    }

    const requestToken = ++memberSearchToken;
    if (memberSearchController) {
      memberSearchController.abort();
    }
    memberSearchController = new AbortController();

    const endpoint = "/admin/teams/member-users/search";
    const url = new URL(endpoint, window.location.origin);
    url.searchParams.set("q", query);
    const activeTeamId = toInteger(memberAddForm.dataset.teamId || editorForm.dataset.teamId, 0);
    if (activeTeamId > 0) {
      url.searchParams.set("teamId", String(activeTeamId));
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin",
      signal: memberSearchController.signal
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true || !Array.isArray(data.users)) {
      throw new Error("Không thể tải danh sách thành viên.");
    }
    if (requestToken !== memberSearchToken) {
      return;
    }

    memberSearchOptions = data.users.map((item) => normalizeMemberSearchItem(item)).filter(Boolean);
    renderMemberSearchResults();
  };

  const runMemberSearch = async () => {
    try {
      await fetchMemberSearchOptions();
      setMemberSearchError("");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      setMemberSearchError((err && err.message) || "Không thể tải danh sách thành viên.");
      memberSearchOptions = [];
      renderMemberSearchResults();
    }
  };

  const scheduleMemberSearch = (delayMs = 180) => {
    if (memberSearchDebounceTimer) {
      window.clearTimeout(memberSearchDebounceTimer);
    }

    const delay = Number(delayMs);
    const safeDelay = Number.isFinite(delay) ? Math.max(0, Math.min(800, Math.floor(delay))) : 180;
    memberSearchDebounceTimer = window.setTimeout(() => {
      memberSearchDebounceTimer = null;
      void runMemberSearch();
    }, safeDelay);
  };

  const syncAddMemberRoleControls = () => {
    const isLeader = normalizeTeamMemberRole(memberAddRole.value) === "leader";
    if (isLeader) {
      memberAddManga.checked = true;
      memberAddChapter.checked = true;
    }
    memberAddManga.disabled = isLeader;
    memberAddChapter.disabled = isLeader;
  };

  const syncMemberItemRoleControls = (itemEl) => {
    if (!itemEl || !(itemEl instanceof Element)) return;
    const roleSelect = itemEl.querySelector("[data-admin-team-member-role]");
    const mangaToggle = itemEl.querySelector("[data-admin-team-member-perm-manga]");
    const chapterToggle = itemEl.querySelector("[data-admin-team-member-perm-chapter]");
    const deleteButton = itemEl.querySelector("[data-admin-team-member-delete]");
    const saveButton = itemEl.querySelector("[data-admin-team-member-save]");
    if (!roleSelect || !mangaToggle || !chapterToggle) return;

    const currentRole = normalizeTeamMemberRole(itemEl.dataset.currentRole || roleSelect.value);
    const isLockedLeader = currentRole === "leader";
    if (isLockedLeader) {
      roleSelect.value = "leader";
    }

    const selectedRole = normalizeTeamMemberRole(roleSelect.value);
    const isLeader = isLockedLeader || selectedRole === "leader";
    if (isLeader) {
      mangaToggle.checked = true;
      chapterToggle.checked = true;
    }

    roleSelect.disabled = isLockedLeader;
    mangaToggle.disabled = isLeader;
    chapterToggle.disabled = isLeader;
    if (deleteButton && deleteButton instanceof HTMLButtonElement) {
      deleteButton.hidden = isLockedLeader;
      deleteButton.disabled = isLockedLeader;
    }
    if (saveButton && saveButton instanceof HTMLButtonElement) {
      saveButton.disabled = isLockedLeader;
    }
  };

  const buildMemberAvatarHtml = (member) => {
    const avatarUrl = readString(member && member.avatarUrl);
    if (avatarUrl) {
      return `<img src="${escapeAttr(avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
    }
    return `<i class="fa-regular fa-user" aria-hidden="true"></i>`;
  };

  const buildEditorMemberItemHtml = (teamId, member) => {
    const userId = readString(member && member.userId);
    const username = readString(member && member.username);
    const displayName = readString(member && member.displayName) || (username ? `@${username}` : userId);
    const role = normalizeTeamMemberRole(member && member.role);
    const groups = getTeamMemberPermissionGroups(member);
    const memberLabel = username ? `@${username}` : userId;
    const deleteButtonHtml =
      role === "leader"
        ? ""
        : '<button class="button button--ghost button--danger button--compact" type="button" data-admin-team-member-delete>Xóa</button>';

    return `
      <article
        class="admin-team-member-item"
        data-admin-team-member-item
        data-user-id="${escapeAttr(userId)}"
        data-current-role="${escapeAttr(role)}"
      >
        <div class="admin-team-member-item__main">
          <span class="admin-team-member-item__avatar">${buildMemberAvatarHtml(member)}</span>
          <div class="admin-team-member-item__meta">
            <strong>${escapeHtml(displayName)}</strong>
            <span class="admin-sub">${escapeHtml(memberLabel)}</span>
          </div>
        </div>

        <div class="admin-team-member-item__controls">
          <label class="admin-field">
            <span>Vai trò</span>
            <select data-admin-team-member-role>
              <option value="member" ${role === "member" ? "selected" : ""}>${teamMemberRoleLabel("member")}</option>
              <option value="leader" ${role === "leader" ? "selected" : ""}>${teamMemberRoleLabel("leader")}</option>
            </select>
          </label>

          <label class="admin-checkbox-inline admin-team-member-item__toggle">
            <input type="checkbox" data-admin-team-member-perm-manga ${groups.canManageManga ? "checked" : ""} />
            <span>Quyền truyện (thêm/sửa/xóa)</span>
          </label>

          <label class="admin-checkbox-inline admin-team-member-item__toggle">
            <input type="checkbox" data-admin-team-member-perm-chapter ${groups.canManageChapter ? "checked" : ""} />
            <span>Quyền chương (thêm/sửa/xóa)</span>
          </label>
        </div>

        <div class="admin-team-member-item__actions">
          <button class="button button--ghost button--compact" type="button" data-admin-team-member-save>Lưu</button>
          ${deleteButtonHtml}
        </div>
      </article>
    `;
  };

  const renderEditorMembers = (teamId, members) => {
    const list = Array.isArray(members)
      ? members.filter((item) => item && readString(item.userId))
      : [];
    if (!list.length) {
      editorMembersList.innerHTML = '<p class="note admin-team-editor-members__empty">Chưa có thành viên trong nhóm.</p>';
      return;
    }

    editorMembersList.innerHTML = list.map((member) => buildEditorMemberItemHtml(teamId, member)).join("");
    editorMembersList
      .querySelectorAll("[data-admin-team-member-item]")
      .forEach((itemEl) => {
        syncMemberItemRoleControls(itemEl);
      });
  };

  const fetchEditorMembers = async (teamId) => {
    const requestToken = ++membersFetchToken;
    if (membersFetchController) {
      membersFetchController.abort();
    }
    membersFetchController = new AbortController();

    const response = await fetch(`/admin/teams/${teamId}/members`, {
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin",
      signal: membersFetchController.signal
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const message = data && data.error ? String(data.error) : "Không thể tải danh sách thành viên.";
      throw new Error(message);
    }

    if (requestToken !== membersFetchToken) {
      return null;
    }

    return data;
  };

  const loadEditorMembers = async (teamId) => {
    const safeTeamId = toInteger(teamId, 0);
    if (!safeTeamId) return;

    memberAddForm.action = `/admin/teams/${safeTeamId}/members/add`;
    memberAddForm.dataset.teamId = String(safeTeamId);
    clearMemberSearchState();
    editorMembersPanel.hidden = false;
    editorMembersList.innerHTML = '<p class="note admin-team-editor-members__empty">Đang tải danh sách thành viên...</p>';
    setEditorMembersStatus("", "success");

    try {
      const data = await fetchEditorMembers(safeTeamId);
      if (!data) return;
      renderEditorMembers(safeTeamId, data.members || []);
    } catch (err) {
      if (err && err.name === "AbortError") {
        return;
      }
      const message = (err && err.message) || "Không thể tải danh sách thành viên.";
      editorMembersList.innerHTML = '<p class="note admin-team-editor-members__empty">Không thể tải danh sách thành viên.</p>';
      setEditorMembersStatus(message, "error");
    }
  };

  const submitAddMember = async () => {
    if (memberAddForm.dataset.teamMemberAddBusy === "1") return;

    const teamId = toInteger(memberAddForm.dataset.teamId, 0);
    if (!teamId) {
      setEditorMembersStatus("Không tìm thấy nhóm dịch cần thêm thành viên.", "error");
      return;
    }

    const memberUserValue = readString(memberAddUser.value);
    if (!memberUserValue) {
      setEditorMembersStatus("Vui lòng nhập user ID hoặc username.", "error");
      memberAddUser.focus();
      return;
    }

    const role = normalizeTeamMemberRole(memberAddRole.value);
    const payload = {
      member_user: memberUserValue,
      role,
      can_manage_manga: memberAddManga.checked ? "1" : "0",
      can_manage_chapter: memberAddChapter.checked ? "1" : "0"
    };

    memberAddForm.dataset.teamMemberAddBusy = "1";
    setButtonBusy(memberAddSubmit, "Đang thêm...");
    hideMemberSearchResults();
    setMemberSearchError("");

    try {
      const data = await postUrlEncodedJson(
        memberAddForm.action,
        payload,
        "Không thể thêm thành viên vào nhóm dịch."
      );
      renderEditorMembers(teamId, data.members || []);
      setEditorMembersStatus(data && data.message ? String(data.message) : "Đã thêm thành viên.", "success");
      clearMemberSearchState();
      memberAddUser.value = "";
      memberAddRole.value = "member";
      memberAddManga.checked = false;
      memberAddChapter.checked = true;
      syncAddMemberRoleControls();
      memberAddUser.focus();
      void runFetch();
    } catch (err) {
      setEditorMembersStatus((err && err.message) || "Không thể thêm thành viên.", "error");
    } finally {
      delete memberAddForm.dataset.teamMemberAddBusy;
      restoreButton(memberAddSubmit);
    }
  };

  const submitUpdateMember = async (itemEl, button) => {
    if (!itemEl || !(itemEl instanceof Element)) return;
    if (itemEl.dataset.memberSaving === "1") return;

    const teamId = toInteger(editorForm.dataset.teamId, 0);
    const userId = readString(itemEl.dataset.userId);
    if (!teamId || !userId) return;

    const roleSelect = itemEl.querySelector("[data-admin-team-member-role]");
    const mangaToggle = itemEl.querySelector("[data-admin-team-member-perm-manga]");
    const chapterToggle = itemEl.querySelector("[data-admin-team-member-perm-chapter]");
    if (!roleSelect || !mangaToggle || !chapterToggle) return;

    const currentRole = normalizeTeamMemberRole(itemEl.dataset.currentRole);
    if (currentRole === "leader") {
      setEditorMembersStatus(
        "Leader hiện tại chỉ đổi được khi bạn set Leader cho thành viên khác.",
        "error"
      );
      return;
    }

    const role = normalizeTeamMemberRole(roleSelect.value);
    const memberNameEl = itemEl.querySelector(".admin-team-member-item__meta strong");
    const memberName = memberNameEl ? readString(memberNameEl.textContent) : "thành viên";
    const confirmed = await openTeamConfirm({
      title: "Lưu thay đổi thành viên?",
      body: `Bạn muốn lưu thay đổi cho ${memberName || "thành viên"}?`,
      confirmText: "Lưu"
    });
    if (!confirmed) return;

    itemEl.dataset.memberSaving = "1";
    setButtonBusy(button, "Đang lưu...");

    try {
      const data = await postUrlEncodedJson(
        `/admin/teams/${teamId}/members/${encodeURIComponent(userId)}/update`,
        {
          role,
          can_manage_manga: mangaToggle.checked ? "1" : "0",
          can_manage_chapter: chapterToggle.checked ? "1" : "0"
        },
        "Không thể cập nhật thành viên."
      );
      renderEditorMembers(teamId, data.members || []);
      setEditorMembersStatus(data && data.message ? String(data.message) : "Đã cập nhật thành viên.", "success");
      void runFetch();
    } catch (err) {
      setEditorMembersStatus((err && err.message) || "Không thể cập nhật thành viên.", "error");
    } finally {
      delete itemEl.dataset.memberSaving;
      restoreButton(button);
    }
  };

  const submitDeleteMember = async (itemEl, button) => {
    if (!itemEl || !(itemEl instanceof Element)) return;
    if (itemEl.dataset.memberDeleting === "1") return;

    const teamId = toInteger(editorForm.dataset.teamId, 0);
    const userId = readString(itemEl.dataset.userId);
    if (!teamId || !userId) return;

    const memberNameEl = itemEl.querySelector(".admin-team-member-item__meta strong");
    const memberName = memberNameEl ? readString(memberNameEl.textContent) : "thành viên";
    const confirmed = await openTeamConfirm({
      title: "Xóa thành viên?",
      body: `Bạn sắp xóa ${memberName || "thành viên"} khỏi nhóm dịch.`,
      confirmText: "Xóa",
      confirmVariant: "danger"
    });
    if (!confirmed) return;

    itemEl.dataset.memberDeleting = "1";
    setButtonBusy(button, "Đang xóa...");

    try {
      const data = await postUrlEncodedJson(
        `/admin/teams/${teamId}/members/${encodeURIComponent(userId)}/delete`,
        {},
        "Không thể xóa thành viên khỏi nhóm."
      );
      renderEditorMembers(teamId, data.members || []);
      setEditorMembersStatus(data && data.message ? String(data.message) : "Đã xóa thành viên.", "success");
      void runFetch();
    } catch (err) {
      setEditorMembersStatus((err && err.message) || "Không thể xóa thành viên.", "error");
    } finally {
      delete itemEl.dataset.memberDeleting;
      restoreButton(button);
    }
  };

  const syncEditorRejectField = () => {
    const isRejected = (editorStatus.value || "").toString().trim().toLowerCase() === "rejected";
    if (editorRejectField) {
      editorRejectField.hidden = !isRejected;
    }
    editorRejectReason.disabled = !isRejected;
    if (!isRejected) {
      editorRejectReason.value = "";
    }
  };

  const resetEditor = () => {
    editorForm.reset();
    editorForm.action = "/admin/teams/0/update";
    editorForm.dataset.teamId = "";
    memberAddForm.reset();
    memberAddForm.action = "/admin/teams/0/members/add";
    memberAddForm.dataset.teamId = "";
    clearMemberSearchState();
    editorMembersPanel.hidden = true;
    editorMembersList.innerHTML = "";
    setEditorMembersStatus("", "success");
    if (membersFetchController) {
      membersFetchController.abort();
      membersFetchController = null;
    }
    syncAddMemberRoleControls();
    if (editorHeading) {
      editorHeading.textContent = "Chỉnh sửa nhóm dịch";
    }
    if (editorNote) {
      editorNote.textContent = "";
    }
    if (editorCard) {
      editorCard.scrollTop = 0;
    }
    syncEditorRejectField();
  };

  const closeEditor = () => {
    if (pendingTeamConfirmResolve) {
      closeTeamConfirm(false);
    }

    if (editorDialog instanceof HTMLDialogElement && typeof editorDialog.close === "function") {
      if (editorDialog.open) {
        editorDialog.close();
        return;
      }
      resetEditor();
      return;
    }

    editorDialog.removeAttribute("open");
    resetEditor();
  };

  const openEditorFromTrigger = (trigger) => {
    if (!trigger) return;
    const teamId = toInteger(trigger.dataset.teamId, 0);
    if (!teamId) return;

    const teamName = readString(trigger.dataset.teamName);
    const teamSlug = readString(trigger.dataset.teamSlug);
    const teamStatus = normalizeStatus(trigger.dataset.teamStatus);

    editorForm.action = `/admin/teams/${teamId}/update`;
    editorForm.dataset.teamId = String(teamId);
    editorName.value = teamName;
    editorSlug.value = teamSlug;
    editorStatus.value = teamStatus;
    editorRejectReason.value = readString(trigger.dataset.teamRejectReason);
    editorIntro.value = readString(trigger.dataset.teamIntro);
    editorFacebook.value = readString(trigger.dataset.teamFacebookUrl);
    editorDiscord.value = readString(trigger.dataset.teamDiscordUrl);

    if (editorHeading) {
      editorHeading.textContent = `Chỉnh sửa nhóm #${teamId}`;
    }
    if (editorNote) {
      editorNote.textContent = teamName ? `Đang chỉnh sửa ${teamName}` : "";
    }

    syncEditorRejectField();
    syncAddMemberRoleControls();
    if (editorCard) {
      editorCard.scrollTop = 0;
    }
    if (editorDialog instanceof HTMLDialogElement && typeof editorDialog.showModal === "function") {
      if (!editorDialog.open) {
        editorDialog.showModal();
      }
    } else {
      editorDialog.setAttribute("open", "");
    }
    void loadEditorMembers(teamId);
    editorName.focus();
  };

  const fetchTeams = async () => {
    const requestToken = ++fetchToken;
    if (fetchController) {
      fetchController.abort();
    }
    fetchController = new AbortController();

    syncUrlFromState();
    const paramsSnapshot = buildQuery().toString();

    const url = new URL(filterForm.action, window.location.origin);
    url.search = paramsSnapshot;

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin",
      signal: fetchController.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json().catch(() => null);
    if (!data || data.ok !== true) {
      throw new Error("Không thể tải danh sách nhóm dịch.");
    }

    if (requestToken !== fetchToken) {
      return;
    }
    if (buildQuery().toString() !== paramsSnapshot) {
      return;
    }

    renderTeams(data.teams || []);
    pendingCountEl.textContent = String(toInteger(data.pendingCount, 0));
  };

  const runFetch = async () => {
    try {
      await fetchTeams();
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setInlineStatus((error && error.message) || "Không thể tải danh sách nhóm dịch.", "error");
    }
  };

  const scheduleFetch = () => {
    if (filterDebounceTimer) {
      window.clearTimeout(filterDebounceTimer);
    }
    filterDebounceTimer = window.setTimeout(() => {
      runFetch();
    }, 350);
  };

  const submitReview = async (form, submitter) => {
    if (!form || !(form instanceof HTMLFormElement)) return;
    if (form.dataset.teamReviewBusy === "1") return;

    const button = submitter instanceof HTMLButtonElement ? submitter : form.querySelector("button[type='submit']");
    form.dataset.teamReviewBusy = "1";
    setButtonBusy(button, "Đang lưu...");

    try {
      const data = await postFormJson(form, "Không thể cập nhật trạng thái nhóm dịch.");
      setInlineStatus(data && data.message ? String(data.message) : "Đã cập nhật trạng thái nhóm dịch.");
      await runFetch();
    } catch (err) {
      setInlineStatus((err && err.message) || "Không thể cập nhật trạng thái nhóm dịch.", "error");
    } finally {
      delete form.dataset.teamReviewBusy;
      restoreButton(button);
    }
  };

  const submitEditor = async () => {
    if (editorForm.dataset.teamEditBusy === "1") return;

    const teamName = readString(editorName.value) || "nhóm dịch";
    const confirmed = await openTeamConfirm({
      title: "Lưu thay đổi nhóm dịch?",
      body: `Bạn muốn lưu thay đổi cho ${teamName}?`,
      confirmText: "Lưu"
    });
    if (!confirmed) return;

    editorForm.dataset.teamEditBusy = "1";
    setButtonBusy(editorSubmitBtn, "Đang lưu...");

    try {
      const data = await postFormJson(editorForm, "Không thể lưu nhóm dịch.");
      setInlineStatus(data && data.message ? String(data.message) : "Đã cập nhật nhóm dịch.");
      closeEditor();
      await runFetch();
    } catch (err) {
      setInlineStatus((err && err.message) || "Không thể lưu nhóm dịch.", "error");
    } finally {
      delete editorForm.dataset.teamEditBusy;
      restoreButton(editorSubmitBtn);
    }
  };

  memberAddUser.addEventListener("compositionstart", () => {
    memberSearchInputComposing = true;
  });

  memberAddUser.addEventListener("compositionend", () => {
    memberSearchInputComposing = false;
    scheduleMemberSearch(120);
  });

  memberAddUser.addEventListener("input", () => {
    if (memberSearchInputComposing) return;
    scheduleMemberSearch(180);
  });

  memberAddUser.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    clearMemberSearchState();
  });

  qInput.addEventListener("compositionstart", () => {
    inputComposing = true;
  });

  qInput.addEventListener("compositionend", () => {
    inputComposing = false;
    state.q = (qInput.value || "").toString().trim();
    scheduleFetch();
  });

  qInput.addEventListener("input", () => {
    if (inputComposing) return;
    state.q = (qInput.value || "").toString().trim();
    scheduleFetch();
  });

  qInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    qInput.value = "";
    state.q = "";
    runFetch();
  });

  reviewSelect.addEventListener("change", () => {
    const next = (reviewSelect.value || DEFAULT_REVIEW).toString().trim().toLowerCase();
    state.review = next || DEFAULT_REVIEW;
    runFetch();
  });

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.q = (qInput.value || "").toString().trim();
    state.review = (reviewSelect.value || DEFAULT_REVIEW).toString().trim().toLowerCase() || DEFAULT_REVIEW;
    runFetch();
  });

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const searchOptionBtn = target.closest("[data-admin-team-member-search-option]");
    if (searchOptionBtn && searchOptionBtn instanceof HTMLButtonElement) {
      const pickedUserId = readString(searchOptionBtn.dataset.userId);
      const pickedUsername = readString(searchOptionBtn.dataset.username);
      memberAddUser.value = pickedUsername ? `@${pickedUsername}` : pickedUserId;
      clearMemberSearchState();
      return;
    }

    if (!target.closest("[data-admin-team-member-search-results]") && target !== memberAddUser) {
      hideMemberSearchResults();
    }

    const memberSaveBtn = target.closest("[data-admin-team-member-save]");
    if (memberSaveBtn && memberSaveBtn instanceof HTMLButtonElement) {
      const memberItem = memberSaveBtn.closest("[data-admin-team-member-item]");
      if (memberItem) {
        void submitUpdateMember(memberItem, memberSaveBtn);
      }
      return;
    }

    const memberDeleteBtn = target.closest("[data-admin-team-member-delete]");
    if (memberDeleteBtn && memberDeleteBtn instanceof HTMLButtonElement) {
      const memberItem = memberDeleteBtn.closest("[data-admin-team-member-item]");
      if (memberItem) {
        void submitDeleteMember(memberItem, memberDeleteBtn);
      }
      return;
    }

    const editTrigger = target.closest("[data-admin-team-edit-open]");
    if (editTrigger) {
      openEditorFromTrigger(editTrigger);
      return;
    }
  });

  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form === memberAddForm) {
      event.preventDefault();
      void submitAddMember();
      return;
    }

    if (form.matches("[data-admin-team-review-form]")) {
      event.preventDefault();
      void submitReview(form, event.submitter);
      return;
    }

    if (form === editorForm) {
      event.preventDefault();
      void submitEditor();
    }
  });

  editorStatus.addEventListener("change", syncEditorRejectField);
  memberAddRole.addEventListener("change", syncAddMemberRoleControls);

  root.addEventListener("change", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.matches("[data-admin-team-member-role]")) {
      const memberItem = target.closest("[data-admin-team-member-item]");
      if (memberItem) {
        syncMemberItemRoleControls(memberItem);
      }
    }
  });

  const cancelTeamConfirm = () => {
    closeTeamConfirm(false);
  };

  teamConfirmCloseBtn.addEventListener("click", cancelTeamConfirm);
  teamConfirmCancelBtn.addEventListener("click", cancelTeamConfirm);
  teamConfirmSubmitBtn.addEventListener("click", () => {
    closeTeamConfirm(true);
  });

  if (teamConfirmDialog instanceof HTMLDialogElement) {
    teamConfirmDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeTeamConfirm(false);
    });

    teamConfirmDialog.addEventListener("click", (event) => {
      if (event.target === teamConfirmDialog) {
        closeTeamConfirm(false);
      }
    });
  }

  editorCloseBtn.addEventListener("click", () => {
    closeEditor();
  });

  editorCancelBtn.addEventListener("click", () => {
    closeEditor();
  });

  if (editorDialog instanceof HTMLDialogElement) {
    editorDialog.addEventListener("close", () => {
      resetEditor();
    });

    editorDialog.addEventListener("click", (event) => {
      if (event.target === editorDialog) {
        closeEditor();
      }
    });
  }

  window.addEventListener("admin:teams:changed", (event) => {
    const detail = event && event.detail ? event.detail : null;
    if (!detail) return;

    const ok = detail.ok !== false;
    const message = detail.message ? String(detail.message) : "";
    if (message) {
      setInlineStatus(message, ok ? "success" : "error");
    }

    if (ok) {
      const changedTeamId = toInteger(detail.teamId, 0);
      const editingTeamId = toInteger(editorForm.dataset.teamId, 0);
      if (changedTeamId > 0 && editingTeamId > 0 && changedTeamId === editingTeamId) {
        closeEditor();
      }
      void runFetch();
    }
  });

  syncEditorRejectField();
  syncAddMemberRoleControls();
})();

(() => {
  const root = document.querySelector("[data-comments-admin-root]");
  if (!root) return;

  const filterForm = root.querySelector("[data-comments-filter-form]");
  const qInput = root.querySelector("[data-comments-filter-q]");
  const reportedSelect = root.querySelector("[data-comments-filter-reported]");
  const sortSelect = root.querySelector("[data-comments-filter-sort]");
  const summaryEl = root.querySelector("[data-comments-summary]");
  const tableBody = root.querySelector("[data-comments-table-body]");
  const paginationEl = root.querySelector("[data-comments-pagination]");

  const selectAll = root.querySelector("[data-comments-select-all]");
  const selectedCountEl = root.querySelector("[data-comments-selected-count]");
  const bulkForm = root.querySelector("[data-bulk-comments-form]");
  const bulkDeleteBtn = root.querySelector("[data-comments-bulk-delete]");
  const bulkIdsContainer = root.querySelector("[data-bulk-ids-container]");
  const bulkQInput = root.querySelector("[data-bulk-filter-q]");
  const bulkReportedInput = root.querySelector("[data-bulk-filter-reported]");
  const bulkSortInput = root.querySelector("[data-bulk-filter-sort]");
  const bulkPageInput = root.querySelector("[data-bulk-filter-page]");
  const forbiddenWordsList = root.querySelector("[data-forbidden-words-list]");
  const forbiddenWordsEmpty = root.querySelector("[data-forbidden-words-empty]");
  const forbiddenWordsForm = root.querySelector("[data-forbidden-words-form]");
  const forbiddenWordsInput = root.querySelector("[data-forbidden-words-input]");
  const forbiddenWordsStatus = root.querySelector("[data-forbidden-words-status]");

  if (
    !filterForm ||
    !qInput ||
    !reportedSelect ||
    !sortSelect ||
    !summaryEl ||
    !tableBody ||
    !selectAll ||
    !selectedCountEl ||
    !bulkForm ||
    !bulkDeleteBtn ||
    !bulkIdsContainer ||
    !bulkQInput ||
    !bulkReportedInput ||
    !bulkSortInput ||
    !bulkPageInput
  ) {
    return;
  }

  const DEFAULT_REPORTED = "all";
  const DEFAULT_SORT = "newest";

  const state = {
    q: (qInput.value || "").toString().trim(),
    reported: (reportedSelect.value || DEFAULT_REPORTED).toString(),
    sort: (sortSelect.value || DEFAULT_SORT).toString(),
    page: 1
  };

  const getCurrentPageFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const raw = Number(params.get("page"));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
  };
  state.page = getCurrentPageFromUrl();

  const escapeHtml = (value) =>
    (value == null ? "" : String(value))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const escapeAttr = (value) => escapeHtml(value);

  const toInt = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  };

  const normalizeChapterNumberText = (value) => {
    const raw = (value == null ? "" : String(value)).trim();
    if (!raw) return "";

    const lowered = raw.toLowerCase();
    if (lowered === "null" || lowered === "undefined") return "";

    const numberValue = Number(raw);
    if (!Number.isFinite(numberValue)) return "";
    return raw;
  };

  const buildQuery = (nextState) => {
    const params = new URLSearchParams();
    const q = (nextState.q || "").toString().trim();
    const reported = (nextState.reported || DEFAULT_REPORTED).toString();
    const sort = (nextState.sort || DEFAULT_SORT).toString();
    const page = toInt(nextState.page, 1);

    if (q) params.set("q", q);
    if (reported !== DEFAULT_REPORTED) params.set("reported", reported);
    if (sort !== DEFAULT_SORT) params.set("sort", sort);
    if (page > 1) params.set("page", String(page));

    return params;
  };

  const setUrlFromState = (nextState) => {
    const params = buildQuery(nextState);
    const search = params.toString();
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  };

  const getItems = () => Array.from(root.querySelectorAll("[data-comment-select]"));

  const updateSelectionState = () => {
    const items = getItems();
    const total = items.length;
    const checked = items.filter((item) => item.checked).length;

    selectedCountEl.textContent = `${checked} đã chọn`;
    bulkDeleteBtn.disabled = checked === 0;

    if (!total) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      selectAll.disabled = true;
      return;
    }

    selectAll.disabled = false;
    selectAll.checked = checked > 0 && checked === total;
    selectAll.indeterminate = checked > 0 && checked < total;
  };

  const syncBulkHiddenFilters = () => {
    bulkQInput.value = state.q;
    bulkReportedInput.value = state.reported;
    bulkSortInput.value = state.sort;
    bulkPageInput.value = String(Math.max(1, toInt(state.page, 1)));
  };

  const syncBulkHiddenIds = () => {
    bulkIdsContainer.innerHTML = "";
    const selectedIds = getItems()
      .filter((item) => item.checked)
      .map((item) => toInt(item.value, 0))
      .filter((id) => id > 0);

    selectedIds.forEach((id) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "comment_ids";
      input.value = String(id);
      bulkIdsContainer.appendChild(input);
    });
  };

  const updateForbiddenWordsEmptyState = () => {
    if (!forbiddenWordsList || !forbiddenWordsEmpty) return;
    const itemCount = forbiddenWordsList.querySelectorAll("[data-forbidden-word-item]").length;
    forbiddenWordsList.hidden = itemCount <= 0;
    forbiddenWordsEmpty.hidden = itemCount > 0;
  };

  const setForbiddenWordsStatus = (message, variant) => {
    if (!forbiddenWordsStatus) return;
    const text = (message || "").toString().trim();
    if (!text) {
      forbiddenWordsStatus.hidden = true;
      forbiddenWordsStatus.textContent = "";
      forbiddenWordsStatus.classList.remove("is-error", "is-success");
      return;
    }

    forbiddenWordsStatus.hidden = false;
    forbiddenWordsStatus.textContent = text;
    forbiddenWordsStatus.classList.remove("is-error", "is-success");
    if (variant === "error") forbiddenWordsStatus.classList.add("is-error");
    if (variant === "success") forbiddenWordsStatus.classList.add("is-success");
  };

  const buildForbiddenWordItem = (item) => {
    const id = toInt(item && item.id, 0);
    const word = item && item.word ? String(item.word).trim() : "";
    if (!id || !word) return null;

    const form = document.createElement("form");
    form.className = "admin-forbidden-words-item";
    form.method = "post";
    form.action = `/admin/comments/forbidden-words/${encodeURIComponent(String(id))}/delete`;
    form.setAttribute("data-forbidden-word-item", "");

    const text = document.createElement("span");
    text.className = "admin-forbidden-word-text";
    text.textContent = word;

    const remove = document.createElement("button");
    remove.className = "admin-forbidden-word-remove";
    remove.type = "submit";
    remove.title = "Xóa từ cấm";
    remove.setAttribute("aria-label", `Xóa từ cấm ${word}`);
    remove.textContent = "x";

    form.appendChild(text);
    form.appendChild(remove);
    return form;
  };

  const renderForbiddenWordsList = (items) => {
    if (!forbiddenWordsList) return;
    forbiddenWordsList.innerHTML = "";
    (Array.isArray(items) ? items : []).forEach((item) => {
      const node = buildForbiddenWordItem(item);
      if (!node) return;
      forbiddenWordsList.appendChild(node);
    });
    updateForbiddenWordsEmptyState();
  };

  const addForbiddenWordsInline = async (form, submitter) => {
    if (!form || !(form instanceof HTMLFormElement)) return;
    if (form.dataset.forbiddenAdding === "1") return;

    const button = submitter instanceof HTMLButtonElement
      ? submitter
      : form.querySelector("button[type='submit']");

    form.dataset.forbiddenAdding = "1";
    if (button && button instanceof HTMLButtonElement) {
      button.classList.add("is-loading");
      button.disabled = true;
    }
    setForbiddenWordsStatus("", "");

    try {
      const params = new URLSearchParams();
      const formData = new FormData(form);
      formData.forEach((value, key) => {
        params.append(key, value == null ? "" : String(value));
      });

      const response = await fetch(form.action, {
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
        const message = data && data.error ? String(data.error) : "Không thể thêm từ cấm.";
        throw new Error(message);
      }

      const words = Array.isArray(data.words) ? data.words : [];
      if (words.length) {
        renderForbiddenWordsList(words);
      }

      if (forbiddenWordsInput) {
        forbiddenWordsInput.value = "";
        forbiddenWordsInput.focus();
      }

      const added = Math.max(0, toInt(data.added, words.length || 0));
      setForbiddenWordsStatus(
        added > 0 ? `Đã thêm ${added} từ cấm.` : "Đã thêm từ cấm.",
        "success"
      );
    } catch (err) {
      const message = (err && err.message) || "Không thể thêm từ cấm.";
      setForbiddenWordsStatus(message, "error");
    } finally {
      delete form.dataset.forbiddenAdding;
      if (button && button instanceof HTMLButtonElement) {
        button.classList.remove("is-loading");
        button.disabled = false;
      }
    }
  };

  const deleteForbiddenWordInline = async (form, submitter) => {
    if (!form || !(form instanceof HTMLFormElement)) return;
    if (form.dataset.forbiddenDeleting === "1") return;

    const button = submitter instanceof HTMLButtonElement
      ? submitter
      : form.querySelector(".admin-forbidden-word-remove");

    form.dataset.forbiddenDeleting = "1";
    form.classList.add("is-removing");
    if (button && button instanceof HTMLButtonElement) {
      button.disabled = true;
    }

    try {
      const params = new URLSearchParams();
      const formData = new FormData(form);
      formData.forEach((value, key) => {
        params.append(key, value == null ? "" : String(value));
      });

      const response = await fetch(form.action, {
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
        const message = data && data.error ? String(data.error) : "Không thể xóa từ cấm.";
        throw new Error(message);
      }

      form.remove();
      updateForbiddenWordsEmptyState();
    } catch (err) {
      form.classList.remove("is-removing");
      if (button && button instanceof HTMLButtonElement) {
        button.disabled = false;
      }
      const message = (err && err.message) || "Không thể xóa từ cấm.";
      window.alert(message);
    } finally {
      delete form.dataset.forbiddenDeleting;
    }
  };

  const buildPageNumbers = ({ page, totalPages }) => {
    const current = Math.max(1, toInt(page, 1));
    const total = Math.max(1, toInt(totalPages, 1));
    if (total <= 9) {
      return Array.from({ length: total }, (_, idx) => idx + 1);
    }

    const list = [1];
    const start = Math.max(2, current - 2);
    const end = Math.min(total - 1, current + 2);
    if (start > 2) list.push("...");
    for (let i = start; i <= end; i += 1) {
      list.push(i);
    }
    if (end < total - 1) list.push("...");
    list.push(total);
    return list;
  };

  const buildPageHref = (targetPage) => {
    const params = buildQuery({
      q: state.q,
      reported: state.reported,
      sort: state.sort,
      page: targetPage
    });
    const search = params.toString();
    return `/admin/comments${search ? `?${search}` : ""}`;
  };

  const renderSummary = (pagination) => {
    if (!summaryEl) return;
    const totalCount = pagination && Number.isFinite(Number(pagination.totalCount))
      ? Number(pagination.totalCount)
      : 0;
    const page = pagination && Number.isFinite(Number(pagination.page)) ? Number(pagination.page) : 1;
    const totalPages = pagination && Number.isFinite(Number(pagination.totalPages))
      ? Number(pagination.totalPages)
      : 1;

    summaryEl.innerHTML =
      `Tổng <strong>${totalCount}</strong> bình luận • ` +
      `Trang <strong>${page}</strong>/${totalPages} • 20 bình luận/trang`;
  };

  const renderCommentsTable = (comments, filters) => {
    const list = Array.isArray(comments) ? comments : [];
    const q = filters && filters.q ? String(filters.q).trim() : "";
    const reported = filters && filters.reported ? String(filters.reported) : DEFAULT_REPORTED;

    if (!list.length) {
      const message = q || reported !== DEFAULT_REPORTED ? "Không có bình luận phù hợp." : "Chưa có bình luận.";
      tableBody.innerHTML = `<tr><td colspan="8">${escapeHtml(message)}</td></tr>`;
      updateSelectionState();
      syncBulkHiddenIds();
      return;
    }

    const rowsHtml = list
      .map((comment) => {
        const id = toInt(comment.id, 0);
        const mangaTitle = (comment.mangaTitle || "").toString();
        const mangaSlug = (comment.mangaSlug || "").toString().trim();
        const chapterText = normalizeChapterNumberText(comment.chapterNumber);
        const mangaHref = mangaSlug ? `/manga/${encodeURIComponent(mangaSlug)}` : "";
        const chapterHref =
          mangaSlug && chapterText
            ? `/manga/${encodeURIComponent(mangaSlug)}/chapters/${encodeURIComponent(chapterText)}`
            : "";
        const author = (comment.author || "").toString();
        const username = (comment.authorUsername || "").toString().trim();
        const content = (comment.content || "").toString();
        const compactContent = content.replace(/\s+/g, " ").trim();
        const likeCount = toInt(comment.likeCount, 0);
        const reportCount = toInt(comment.reportCount, 0);
        const createdAtText = (comment.createdAtText || "").toString();

        return `
          <tr>
            <td data-label="Chọn">
              <input type="checkbox" name="comment_ids" value="${id}" data-comment-select />
            </td>
            <td data-label="Truyện">
              <strong>
                ${mangaHref
                  ? `<a class="admin-comment-link" href="${escapeAttr(mangaHref)}">${escapeHtml(mangaTitle)}</a>`
                  : escapeHtml(mangaTitle)}
              </strong>
              ${chapterText
                ? chapterHref
                  ? `<a class="admin-sub admin-comment-link" href="${escapeAttr(chapterHref)}">Chương ${escapeHtml(chapterText)}</a>`
                  : `<span class="admin-sub">Chương ${escapeHtml(chapterText)}</span>`
                : ""}
            </td>
            <td data-label="User">
              <strong>${escapeHtml(author)}</strong>
              ${username ? `<span class="admin-sub">@${escapeHtml(username)}</span>` : ""}
            </td>
            <td data-label="Nội dung">
              <span class="admin-comment-preview" title="${escapeAttr(content)}">${escapeHtml(compactContent)}</span>
            </td>
            <td data-label="Thích">${likeCount}</td>
            <td data-label="Báo cáo">
              <span class="chip ${reportCount > 0 ? "chip--warn" : ""}">${reportCount}</span>
            </td>
            <td data-label="Thời gian">${escapeHtml(createdAtText)}</td>
            <td class="admin-cell-actions" data-label="Hành động">
              <div class="admin-actions">
                <form
                  method="post"
                  action="/admin/comments/${id}/delete"
                  data-confirm-action="delete-comment"
                  data-comment-id="${id}"
                  data-manga-title="${escapeAttr(mangaTitle)}"
                  data-chapter-number="${escapeAttr(chapterText)}"
                  data-comment-author="${escapeAttr(author)}"
                >
                  <button class="button button--ghost button--danger" type="submit">Xóa</button>
                </form>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    tableBody.innerHTML = rowsHtml;
    updateSelectionState();
    syncBulkHiddenIds();
  };

  const renderPagination = (pagination) => {
    if (!paginationEl) return;
    const totalPages = Math.max(1, toInt(pagination && pagination.totalPages, 1));
    if (totalPages <= 1) {
      paginationEl.hidden = true;
      paginationEl.innerHTML = "";
      return;
    }

    paginationEl.hidden = false;
    const page = Math.max(1, toInt(pagination.page, 1));
    const hasPrev = Boolean(pagination.hasPrev);
    const hasNext = Boolean(pagination.hasNext);
    const prevPage = Math.max(1, toInt(pagination.prevPage, page - 1));
    const nextPage = Math.min(totalPages, toInt(pagination.nextPage, page + 1));
    const pageNumbers = buildPageNumbers({ page, totalPages });

    const numbersHtml = pageNumbers
      .map((num) => {
        if (num === "...") {
          return '<span class="admin-pagination__dots">...</span>';
        }
        if (num === page) {
          return `<span class="chip">${num}</span>`;
        }
        return `<a class="button button--ghost" href="${escapeAttr(buildPageHref(num))}" data-comments-page="${num}">${num}</a>`;
      })
      .join("");

    paginationEl.innerHTML = `
      <a
        class="button button--ghost admin-pagination__nav ${hasPrev ? "" : "is-disabled"}"
        href="${hasPrev ? escapeAttr(buildPageHref(prevPage)) : "#"}"
        aria-label="Trang trước"
        ${hasPrev ? `data-comments-page="${prevPage}"` : 'tabindex="-1" aria-disabled="true"'}
      >
        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
        <span class="sr-only">Trang trước</span>
      </a>
      <span class="chip admin-pagination__meta">Trang ${page}/${totalPages}</span>
      <div class="admin-pagination__numbers">${numbersHtml}</div>
      <a
        class="button button--ghost admin-pagination__nav ${hasNext ? "" : "is-disabled"}"
        href="${hasNext ? escapeAttr(buildPageHref(nextPage)) : "#"}"
        aria-label="Trang sau"
        ${hasNext ? `data-comments-page="${nextPage}"` : 'tabindex="-1" aria-disabled="true"'}
      >
        <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
        <span class="sr-only">Trang sau</span>
      </a>
    `;
  };

  let pendingController = null;
  let debounceTimer = null;
  let commentsFetchToken = 0;
  let commentsQueryComposing = false;

  const fetchComments = async ({ resetPage } = {}) => {
    if (resetPage) {
      state.page = 1;
    }

    const requestedQ = (qInput.value || "").toString().trim();
    const requestedReported = (reportedSelect.value || DEFAULT_REPORTED).toString();
    const requestedSort = (sortSelect.value || DEFAULT_SORT).toString();

    state.q = requestedQ;
    state.reported = requestedReported;
    state.sort = requestedSort;
    
    syncBulkHiddenFilters();
    setUrlFromState(state);

    const requestToken = ++commentsFetchToken;

    if (pendingController) {
      pendingController.abort();
    }
    pendingController = new AbortController();

    const params = buildQuery(state);
    params.set("format", "json");
    const url = `/admin/comments${params.toString() ? `?${params.toString()}` : ""}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      },
      signal: pendingController.signal,
      credentials: "same-origin"
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      throw new Error("Không thể tải danh sách bình luận.");
    }

    if (requestToken !== commentsFetchToken) {
      return;
    }
    if (commentsQueryComposing) {
      return;
    }

    const liveQ = (qInput.value || "").toString().trim();
    const liveReported = (reportedSelect.value || DEFAULT_REPORTED).toString();
    const liveSort = (sortSelect.value || DEFAULT_SORT).toString();
    if (liveQ !== requestedQ || liveReported !== requestedReported || liveSort !== requestedSort) {
      return;
    }

    const filters = data.filters || {};
    const pagination = data.pagination || {};

    state.q = (filters.q || "").toString().trim();
    state.reported = (filters.reported || DEFAULT_REPORTED).toString();
    state.sort = (filters.sort || DEFAULT_SORT).toString();
    state.page = Math.max(1, toInt(pagination.page, 1));

    if (document.activeElement !== qInput) {
      qInput.value = state.q;
    }
    reportedSelect.value = state.reported;
    sortSelect.value = state.sort;

    renderSummary(pagination);
    renderCommentsTable(data.comments || [], filters);
    renderPagination(pagination);
    syncBulkHiddenFilters();
    setUrlFromState(state);
  };

  const scheduleFetch = ({ resetPage }) => {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      fetchComments({ resetPage }).catch((err) => {
        if (err && err.name === "AbortError") return;
        console.error(err);
      });
    }, 450);
  };

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    fetchComments({ resetPage: true }).catch((err) => {
      if (err && err.name === "AbortError") return;
      console.error(err);
    });
  });

  qInput.addEventListener("compositionstart", () => {
    commentsQueryComposing = true;
  });

  qInput.addEventListener("compositionend", () => {
    commentsQueryComposing = false;
    scheduleFetch({ resetPage: true });
  });

  qInput.addEventListener("input", () => {
    if (commentsQueryComposing) return;
    scheduleFetch({ resetPage: true });
  });

  reportedSelect.addEventListener("change", () => {
    fetchComments({ resetPage: true }).catch((err) => {
      if (err && err.name === "AbortError") return;
      console.error(err);
    });
  });

  sortSelect.addEventListener("change", () => {
    fetchComments({ resetPage: true }).catch((err) => {
      if (err && err.name === "AbortError") return;
      console.error(err);
    });
  });

  if (paginationEl) {
    paginationEl.addEventListener("click", (event) => {
      const link = event.target.closest("a[data-comments-page]");
      if (!link) return;
      const targetPage = toInt(link.dataset.commentsPage, 1);
      if (!targetPage || targetPage < 1) return;
      event.preventDefault();
      state.page = targetPage;
      fetchComments({ resetPage: false }).catch((err) => {
        if (err && err.name === "AbortError") return;
        console.error(err);
      });
    });
  }

  selectAll.addEventListener("change", () => {
    const items = getItems();
    items.forEach((item) => {
      item.checked = selectAll.checked;
    });
    updateSelectionState();
    syncBulkHiddenIds();
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.matches("[data-comment-select]")) return;
    updateSelectionState();
    syncBulkHiddenIds();
  });

  bulkForm.addEventListener("submit", (event) => {
    syncBulkHiddenIds();
    const selectedCount = getItems().filter((item) => item.checked).length;
    if (!selectedCount) {
      event.preventDefault();
    }
  });

  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.matches("[data-forbidden-words-form]")) {
      event.preventDefault();
      void addForbiddenWordsInline(form, event.submitter);
      return;
    }
    if (!form.matches("[data-forbidden-word-item]")) return;
    event.preventDefault();
    void deleteForbiddenWordInline(form, event.submitter);
  });

  updateSelectionState();
  syncBulkHiddenFilters();
  syncBulkHiddenIds();
  updateForbiddenWordsEmptyState();
})();

(() => {
  const root = document.querySelector("[data-members-admin-root]");
  if (!root) return;

  const filterForm = root.querySelector("[data-members-filter-form]");
  const qInput = root.querySelector("[data-members-filter-q]");
  const interactionSelect = root.querySelector("[data-members-filter-interaction]");
  const summaryEl = root.querySelector("[data-members-summary]");
  const tableBody = root.querySelector("[data-members-table-body]");
  const paginationEl = root.querySelector("[data-members-pagination]");
  const inlineStatusEl = root.querySelector("[data-members-inline-status]");

  const editorDialog = root.querySelector("[data-member-editor-dialog]");
  const editorCloseBtn = root.querySelector("[data-member-editor-close]");
  const editorStatusEl = root.querySelector("[data-member-editor-status]");
  const editorAvatarEl = root.querySelector("[data-member-editor-avatar]");
  const editorNameEl = root.querySelector("[data-member-editor-name]");
  const editorUsernameEl = root.querySelector("[data-member-editor-username]");
  const editorEmailEl = root.querySelector("[data-member-editor-email]");
  const editorJoinedEl = root.querySelector("[data-member-editor-joined]");
  const editorCommentsEl = root.querySelector("[data-member-editor-comments]");
  const editorInteractionEl = root.querySelector("[data-member-editor-interaction]");
  const editorBadgePicker = root.querySelector("[data-member-editor-badge-picker]");
  const editorBadgesEl = root.querySelector("[data-member-editor-badges]");
  const editorAddToggleBtn = root.querySelector("[data-member-editor-add-toggle]");
  const editorAddForm = root.querySelector("[data-member-editor-add-form]");
  const editorAddSearchInput = root.querySelector("[data-member-editor-add-search]");
  const editorAddListEl = root.querySelector("[data-member-editor-add-list]");
  const editorAddEmptyEl = root.querySelector("[data-member-editor-add-empty]");
  const editorAddSelect = root.querySelector("[data-member-editor-add-select]");
  const editorProfileForm = root.querySelector("[data-member-editor-profile-form]");
  const editorDisplayNameInput = root.querySelector('[data-member-editor-input="display_name"]');
  const editorFacebookInput = root.querySelector('[data-member-editor-input="facebook_url"]');
  const editorDiscordInput = root.querySelector('[data-member-editor-input="discord_url"]');
  const editorBioInput = root.querySelector('[data-member-editor-input="bio"]');

  if (!filterForm || !qInput || !interactionSelect || !summaryEl || !tableBody || !paginationEl) {
    return;
  }

  const hasEditor =
    Boolean(editorDialog) &&
    Boolean(editorStatusEl) &&
    Boolean(editorAvatarEl) &&
    Boolean(editorNameEl) &&
    Boolean(editorUsernameEl) &&
    Boolean(editorEmailEl) &&
    Boolean(editorJoinedEl) &&
    Boolean(editorCommentsEl) &&
    Boolean(editorInteractionEl) &&
    Boolean(editorBadgePicker) &&
    Boolean(editorBadgesEl) &&
    Boolean(editorAddToggleBtn) &&
    Boolean(editorAddForm) &&
    Boolean(editorAddSearchInput) &&
    Boolean(editorAddListEl) &&
    Boolean(editorAddEmptyEl) &&
    Boolean(editorAddSelect) &&
    Boolean(editorProfileForm) &&
    Boolean(editorDisplayNameInput) &&
    Boolean(editorFacebookInput) &&
    Boolean(editorDiscordInput) &&
    Boolean(editorBioInput);

  const DEFAULT_INTERACTION = "all";
  const state = {
    q: (qInput.value || "").toString().trim(),
    interaction: (interactionSelect.value || DEFAULT_INTERACTION).toString(),
    page: 1
  };

  let currentMembers = [];
  let currentBadgeOptions = [];
  let editorSelectableBadges = [];
  let editorSelectedBadgeId = 0;
  let editorMemberId = "";
  let editorRequestToken = 0;
  let editorStatusTimer = null;
  let editorBusy = false;

  const getCurrentPageFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const raw = Number(params.get("page"));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
  };
  state.page = getCurrentPageFromUrl();

  const escapeHtml = (value) =>
    (value == null ? "" : String(value))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const escapeAttr = (value) => escapeHtml(value);

  const toInt = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  };

  const getMemberName = (member) => {
    const displayName = (member && member.displayName ? String(member.displayName) : "").trim();
    const username = (member && member.username ? String(member.username) : "").trim();
    const email = (member && member.email ? String(member.email) : "").trim();
    return displayName || (username ? `@${username}` : email || "Thành viên");
  };

  const getMemberById = (memberId) => {
    const id = (memberId || "").toString().trim();
    if (!id) return null;
    const match = currentMembers.find((member) => String(member && member.id ? member.id : "") === id);
    return match || null;
  };

  const normalizeBadgeColor = (value) => {
    const raw = (value || "").toString().trim();
    if (!raw) return "";
    if (/^#[0-9a-fA-F]{6}$/.test(raw) || /^#[0-9a-fA-F]{3}$/.test(raw)) {
      return raw;
    }
    return "";
  };

  const clearEditorBadgePicker = () => {
    if (!hasEditor) return;

    editorSelectableBadges = [];
    editorSelectedBadgeId = 0;

    if (editorAddSearchInput) {
      editorAddSearchInput.value = "";
      editorAddSearchInput.disabled = true;
    }

    if (editorAddListEl) {
      editorAddListEl.innerHTML = "";
    }

    if (editorAddEmptyEl) {
      editorAddEmptyEl.hidden = true;
    }

    if (editorAddSelect) {
      editorAddSelect.innerHTML = '<option value=""></option>';
      editorAddSelect.value = "";
      editorAddSelect.disabled = true;
    }

  };

  const syncEditorBadgeSelection = () => {
    if (!hasEditor || !editorAddForm || !editorAddSelect) return;

    const selectedBadge =
      editorSelectableBadges.find((badge) => toInt(badge && badge.id, 0) === editorSelectedBadgeId) ||
      null;

    if (!selectedBadge) {
      editorSelectedBadgeId = 0;
      editorAddSelect.value = "";
      return;
    }

    const selectedId = toInt(selectedBadge && selectedBadge.id, 0);

    editorSelectedBadgeId = selectedId;
    editorAddSelect.value = String(selectedId);
  };

  const renderEditorAddBadgeList = () => {
    if (!hasEditor || !editorAddListEl || !editorAddEmptyEl || !editorAddForm) return;

    const query = editorAddSearchInput
      ? String(editorAddSearchInput.value || "")
          .trim()
          .toLowerCase()
      : "";

    const filteredBadges = editorSelectableBadges.filter((badge) => {
      const id = toInt(badge && badge.id, 0);
      const label = badge && badge.label ? String(badge.label).trim() : "";
      const code = badge && badge.code ? String(badge.code).trim() : "";
      if (id <= 0 || !label) return false;
      if (!query) return true;
      return `${label} ${code}`.toLowerCase().includes(query);
    });

    if (!filteredBadges.length) {
      editorAddListEl.innerHTML = "";
      editorAddEmptyEl.hidden = false;
      editorSelectedBadgeId = 0;
      syncEditorBadgeSelection();
      return;
    }

    const hasCurrentSelection = filteredBadges.some(
      (badge) => toInt(badge && badge.id, 0) === editorSelectedBadgeId
    );
    if (!hasCurrentSelection) {
      editorSelectedBadgeId = toInt(filteredBadges[0] && filteredBadges[0].id, 0);
    }
    syncEditorBadgeSelection();

    editorAddListEl.innerHTML = filteredBadges
      .map((badge) => {
        const badgeId = toInt(badge && badge.id, 0);
        const badgeLabel = badge && badge.label ? String(badge.label).trim() : "";
        if (!badgeId || !badgeLabel) return "";

        const badgeColor = normalizeBadgeColor(badge && badge.color ? String(badge.color) : "");
        const isSelected = badgeId === editorSelectedBadgeId;
        return `
          <button
            class="admin-member-badge-option${isSelected ? " is-selected" : ""}"
            type="button"
            role="option"
            aria-selected="${isSelected ? "true" : "false"}"
            data-member-editor-option-id="${badgeId}"
          >
            <span class="admin-member-badge-option__dot"${
              badgeColor ? ` style="--badge-color: ${escapeAttr(badgeColor)}"` : ""
            }></span>
            <span class="admin-member-badge-option__label">${escapeHtml(badgeLabel)}</span>
          </button>
        `;
      })
      .join("");
    editorAddEmptyEl.hidden = true;
  };

  if (hasEditor) {
    clearEditorBadgePicker();
  }

  const setEditorBusy = (nextBusy) => {
    if (!hasEditor || !editorDialog) return;
    editorBusy = Boolean(nextBusy);
    if (editorBusy) {
      editorDialog.dataset.memberEditorBusy = "1";
      return;
    }
    delete editorDialog.dataset.memberEditorBusy;
  };

  const setEditorStatus = (message, variant, autoHideMs = 0) => {
    if (!hasEditor || !editorStatusEl) return;

    const text = (message || "").toString().trim();
    editorStatusEl.classList.remove("admin-success", "admin-error");
    if (variant === "success") {
      editorStatusEl.classList.add("admin-success");
    } else if (variant === "error") {
      editorStatusEl.classList.add("admin-error");
    }

    if (!text) {
      editorStatusEl.hidden = true;
      editorStatusEl.textContent = "";
      if (editorStatusTimer) {
        window.clearTimeout(editorStatusTimer);
        editorStatusTimer = null;
      }
      return;
    }

    editorStatusEl.hidden = false;
    editorStatusEl.textContent = text;

    if (editorStatusTimer) {
      window.clearTimeout(editorStatusTimer);
      editorStatusTimer = null;
    }

    if (autoHideMs > 0) {
      editorStatusTimer = window.setTimeout(() => {
        editorStatusEl.hidden = true;
        editorStatusEl.textContent = "";
        editorStatusTimer = null;
      }, autoHideMs);
    }
  };

  const setEditorAddFormOpen = (open) => {
    if (!hasEditor || !editorAddForm || !editorAddToggleBtn) return;
    const canOpen = !editorAddToggleBtn.disabled;
    const next = Boolean(open) && canOpen;
    editorAddForm.hidden = !next;
    editorAddToggleBtn.setAttribute("aria-expanded", next ? "true" : "false");
    editorAddToggleBtn.classList.toggle("is-active", next);

    if (!next) {
      if (editorAddSearchInput) {
        editorAddSearchInput.value = "";
      }
      renderEditorAddBadgeList();
      return;
    }

    renderEditorAddBadgeList();
    if (editorAddSearchInput && !editorAddSearchInput.disabled) {
      editorAddSearchInput.focus();
      editorAddSearchInput.select();
    }
  };

  const renderEditorAvatar = (avatarUrl) => {
    if (!hasEditor || !editorAvatarEl) return;
    const raw = (avatarUrl || "").toString().trim();
    editorAvatarEl.textContent = "";
    if (raw) {
      const img = document.createElement("img");
      img.src = raw;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      editorAvatarEl.appendChild(img);
      return;
    }

    const icon = document.createElement("i");
    icon.className = "fa-regular fa-user";
    icon.setAttribute("aria-hidden", "true");
    editorAvatarEl.appendChild(icon);
  };

  const renderEditorMember = (member, badgeOptions) => {
    if (!hasEditor || !member) return;
    const memberId = (member.id || "").toString().trim();
    if (!memberId) return;

    const memberName = getMemberName(member);
    const username = (member.username || "").toString().trim();
    const email = (member.email || "").toString().trim();
    const joinedAtText = (member.joinedAtText || "").toString().trim() || "Không rõ";
    const commentCount = Math.max(0, toInt(member.commentCount, 0));
    const interactionDisabled = Boolean(member.interactionDisabled);
    const encodedMemberId = encodeURIComponent(memberId);

    editorMemberId = memberId;

    if (editorNameEl) {
      editorNameEl.textContent = memberName;
    }
    if (editorUsernameEl) {
      editorUsernameEl.textContent = username ? `@${username}` : "Chưa đặt username";
    }
    if (editorEmailEl) {
      editorEmailEl.textContent = email || "Chưa có email";
    }
    if (editorJoinedEl) {
      editorJoinedEl.textContent = `Tham gia: ${joinedAtText}`;
    }
    if (editorCommentsEl) {
      editorCommentsEl.textContent = `${commentCount} bình luận`;
    }
    if (editorInteractionEl) {
      editorInteractionEl.classList.remove("chip--ok", "chip--warn");
      editorInteractionEl.classList.add(interactionDisabled ? "chip--warn" : "chip--ok");
      editorInteractionEl.textContent = interactionDisabled ? "Đang khóa" : "Hoạt động";
    }

    renderEditorAvatar(member.avatarUrl || "");

    if (editorProfileForm) {
      editorProfileForm.action = `/admin/members/${encodedMemberId}/update`;
      editorProfileForm.dataset.memberId = memberId;
      editorProfileForm.dataset.memberName = memberName;
    }
    if (editorDisplayNameInput) {
      editorDisplayNameInput.value = (member.displayName || "").toString();
    }
    if (editorFacebookInput) {
      editorFacebookInput.value = (member.facebookUrl || "").toString();
    }
    if (editorDiscordInput) {
      editorDiscordInput.value = (member.discordUrl || "").toString();
    }
    if (editorBioInput) {
      editorBioInput.value = (member.bio || "").toString();
    }

    if (editorAddForm) {
      editorAddForm.action = `/admin/members/${encodedMemberId}/badges/add`;
      editorAddForm.dataset.memberId = memberId;
      editorAddForm.dataset.memberName = memberName;
    }

    const badges = Array.isArray(member.badges) ? member.badges : [];
    if (editorBadgesEl) {
      if (!badges.length) {
        editorBadgesEl.innerHTML = '<span class="admin-sub">Chưa có huy hiệu.</span>';
      } else {
        editorBadgesEl.innerHTML = badges
          .map((badge) => {
            const badgeId = toInt(badge && badge.id, 0);
            const badgeLabel = (badge && badge.label ? String(badge.label) : "").trim();
            if (!badgeLabel) return "";
            const badgeColor = (badge && badge.color ? String(badge.color) : "").trim();
            const isDefault = Boolean(badge && badge.isDefault);

            const removeFormHtml =
              !isDefault && badgeId > 0
                ? `
                  <form
                    method="post"
                    action="/admin/members/${encodedMemberId}/badges/${encodeURIComponent(String(badgeId))}/remove"
                    data-confirm-action="remove-member-badge"
                    data-member-id="${escapeAttr(memberId)}"
                    data-member-name="${escapeAttr(memberName)}"
                    data-badge-label="${escapeAttr(badgeLabel)}"
                  >
                    <button
                      class="admin-member-badge-remove"
                      type="submit"
                      aria-label="Gỡ ${escapeAttr(badgeLabel)}"
                      title="Gỡ huy hiệu"
                    >
                      <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                  </form>
                `
                : "";

            return `
              <span class="chip admin-member-badge-chip admin-member-badge-chip--editor" ${
                badgeColor ? `style="--badge-color: ${escapeAttr(badgeColor)}; --badge-bg: ${escapeAttr(`${badgeColor}22`)}"` : ""
              }>
                <span>${escapeHtml(badgeLabel)}</span>
                ${removeFormHtml}
              </span>
            `;
          })
          .join("");
      }
    }

    const allBadgeOptions = Array.isArray(badgeOptions) ? badgeOptions : [];
    const assignedBadgeIds = new Set(
      (Array.isArray(member.assignedBadgeIds) ? member.assignedBadgeIds : [])
        .map((id) => toInt(id, 0))
        .filter((id) => id > 0)
    );

    const selectableBadges = allBadgeOptions.filter((badge) => {
      const id = toInt(badge && badge.id, 0);
      const label = (badge && badge.label ? String(badge.label) : "").trim();
      return id > 0 && Boolean(label) && !assignedBadgeIds.has(id);
    });

    editorSelectableBadges = selectableBadges;

    if (editorAddSelect) {
      if (!selectableBadges.length) {
        editorAddSelect.innerHTML = '<option value=""></option>';
      } else {
        editorAddSelect.innerHTML = selectableBadges
          .map((badge) => {
            const id = toInt(badge && badge.id, 0);
            const label = (badge && badge.label ? String(badge.label) : "").trim();
            if (!id || !label) return "";
            return `<option value="${id}">${escapeHtml(label)}</option>`;
          })
          .join("");
      }
    }

    if (editorAddSearchInput) {
      editorAddSearchInput.value = "";
    }

    const hasSelectedBadge = selectableBadges.some(
      (badge) => toInt(badge && badge.id, 0) === editorSelectedBadgeId
    );
    if (!hasSelectedBadge) {
      editorSelectedBadgeId = selectableBadges.length
        ? toInt(selectableBadges[0] && selectableBadges[0].id, 0)
        : 0;
    }
    syncEditorBadgeSelection();
    renderEditorAddBadgeList();

    const canAddBadge = selectableBadges.length > 0;
    if (editorAddToggleBtn) {
      editorAddToggleBtn.disabled = !canAddBadge;
    }
    if (editorAddSelect && "disabled" in editorAddSelect) {
      editorAddSelect.disabled = !canAddBadge;
    }
    if (editorAddSearchInput && "disabled" in editorAddSearchInput) {
      editorAddSearchInput.disabled = !canAddBadge;
    }

    setEditorAddFormOpen(false);
  };

  const fetchEditorMember = async (memberId) => {
    const id = (memberId || "").toString().trim();
    if (!id) {
      throw new Error("Không tìm thấy thành viên.");
    }

    const response = await fetch(`/admin/members/${encodeURIComponent(id)}?format=json`, {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      },
      credentials: "same-origin"
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true || !data.member) {
      const message = data && data.error ? String(data.error) : "Không thể tải thông tin thành viên.";
      throw new Error(message);
    }

    return {
      member: data.member,
      badges: Array.isArray(data.badges) ? data.badges : []
    };
  };

  const showEditorDialog = () => {
    if (!hasEditor || !editorDialog) return;
    if (typeof editorDialog.showModal === "function") {
      if (!editorDialog.open) {
        editorDialog.showModal();
      }
      return;
    }
    editorDialog.setAttribute("open", "open");
  };

  const closeEditorDialog = () => {
    if (!hasEditor || !editorDialog) return;
    if (typeof editorDialog.close === "function") {
      if (editorDialog.open) {
        editorDialog.close();
      }
      return;
    }
    editorDialog.removeAttribute("open");
    editorMemberId = "";
    setEditorAddFormOpen(false);
    clearEditorBadgePicker();
    setEditorStatus("", "info");
    setEditorBusy(false);
  };

  const loadEditorMember = async (memberId, { hintName = "", silent = false } = {}) => {
    if (!hasEditor) return;
    const id = (memberId || "").toString().trim();
    if (!id) return;

    const token = ++editorRequestToken;
    editorMemberId = id;

    if (!silent) {
      const localMember = getMemberById(id);
      if (localMember) {
        renderEditorMember(localMember, currentBadgeOptions);
      } else if (editorNameEl) {
        editorNameEl.textContent = hintName || "Đang tải...";
      }
      setEditorStatus("Đang tải thông tin thành viên...", "info");
    }

    setEditorBusy(true);
    try {
      const result = await fetchEditorMember(id);
      if (token !== editorRequestToken) return;
      renderEditorMember(result.member, result.badges);
      currentBadgeOptions = result.badges;
      setEditorStatus("", "info");
    } catch (err) {
      if (token !== editorRequestToken) return;
      const message = (err && err.message) || "Không thể tải thông tin thành viên.";
      setEditorStatus(message, "error");
    } finally {
      if (token === editorRequestToken) {
        setEditorBusy(false);
      }
    }
  };

  const renderMemberAvatarHtml = (avatarUrl) => {
    const raw = (avatarUrl || "").toString().trim();
    if (raw) {
      return `<img src="${escapeAttr(raw)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
    }
    return '<i class="fa-regular fa-user"></i>';
  };

  const buildQuery = (nextState) => {
    const params = new URLSearchParams();
    const q = (nextState.q || "").toString().trim();
    const interaction = (nextState.interaction || DEFAULT_INTERACTION).toString();
    const page = toInt(nextState.page, 1);

    if (q) params.set("q", q);
    if (interaction !== DEFAULT_INTERACTION) params.set("interaction", interaction);
    if (page > 1) params.set("page", String(page));
    return params;
  };

  const setUrlFromState = (nextState) => {
    const params = buildQuery(nextState);
    const search = params.toString();
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  };

  let inlineStatusTimer = null;
  const showInlineStatus = (message, variant) => {
    if (!inlineStatusEl) return;
    const text = (message || "").toString().trim();
    if (!text) {
      inlineStatusEl.hidden = true;
      return;
    }

    inlineStatusEl.hidden = false;
    inlineStatusEl.textContent = text;
    inlineStatusEl.classList.remove("admin-success", "admin-error");
    inlineStatusEl.classList.add(variant === "error" ? "admin-error" : "admin-success");

    if (inlineStatusTimer) {
      window.clearTimeout(inlineStatusTimer);
      inlineStatusTimer = null;
    }

    inlineStatusTimer = window.setTimeout(() => {
      inlineStatusEl.hidden = true;
      inlineStatusTimer = null;
    }, 2400);
  };

  const buildPageNumbers = ({ page, totalPages }) => {
    const current = Math.max(1, toInt(page, 1));
    const total = Math.max(1, toInt(totalPages, 1));
    if (total <= 9) {
      return Array.from({ length: total }, (_, idx) => idx + 1);
    }

    const list = [1];
    const start = Math.max(2, current - 2);
    const end = Math.min(total - 1, current + 2);
    if (start > 2) list.push("...");
    for (let i = start; i <= end; i += 1) {
      list.push(i);
    }
    if (end < total - 1) list.push("...");
    list.push(total);
    return list;
  };

  const buildPageHref = (targetPage) => {
    const params = buildQuery({
      q: state.q,
      interaction: state.interaction,
      page: targetPage
    });
    const search = params.toString();
    return `/admin/members${search ? `?${search}` : ""}`;
  };

  const renderSummary = (pagination) => {
    const totalCount =
      pagination && Number.isFinite(Number(pagination.totalCount)) ? Number(pagination.totalCount) : 0;
    const page = pagination && Number.isFinite(Number(pagination.page)) ? Number(pagination.page) : 1;
    const totalPages =
      pagination && Number.isFinite(Number(pagination.totalPages)) ? Number(pagination.totalPages) : 1;
    const perPage = pagination && Number.isFinite(Number(pagination.perPage)) ? Number(pagination.perPage) : 0;

    summaryEl.innerHTML =
      `Tổng <strong>${totalCount}</strong> thành viên • ` +
      `Trang <strong>${page}</strong>/${totalPages} • ${perPage} thành viên/trang`;
  };

  const renderMembersTable = (members, badgeOptions, filters) => {
    const list = Array.isArray(members) ? members : [];
    currentMembers = list;
    currentBadgeOptions = Array.isArray(badgeOptions) ? badgeOptions : [];

    const q = filters && filters.q ? String(filters.q).trim() : "";
    const interaction =
      filters && filters.interaction ? String(filters.interaction).trim() : DEFAULT_INTERACTION;

    if (!list.length) {
      const message =
        q || interaction !== DEFAULT_INTERACTION ? "Không có thành viên phù hợp." : "Chưa có thành viên.";
      tableBody.innerHTML = `<tr><td colspan="3">${escapeHtml(message)}</td></tr>`;
      return;
    }

    const rowsHtml = list
      .map((member) => {
        const memberId = (member && member.id ? String(member.id) : "").trim();
        if (!memberId) return "";
        const encodedMemberId = encodeURIComponent(memberId);

        const memberName = getMemberName(member);
        const username = (member.username || "").toString().trim();
        const email = (member.email || "").toString().trim();
        const avatarUrl = (member.avatarUrl || "").toString().trim();
        const commentCount = Math.max(0, toInt(member.commentCount, 0));

        const badgeCount = Array.isArray(member.badges) ? member.badges.length : 0;

        const interactionDisabled = Boolean(member && member.interactionDisabled);
        const isBanned = Boolean(member && member.isBanned);
        const memberMode = isBanned ? "unban" : "ban";
        const modeButtonClass = isBanned ? "button button--ghost" : "button button--ghost button--danger";
        const modeButtonLabel = isBanned ? "Mở khóa" : "Ban thành viên";
        const interactionChip = isBanned
          ? ""
          : `<span class="chip ${interactionDisabled ? "chip--warn" : "chip--ok"}">${
              interactionDisabled ? "Đang khóa" : "Hoạt động"
            }</span>`;

        return `
          <tr data-member-row-id="${escapeAttr(memberId)}">
            <td data-label="Thành viên">
              <div class="admin-member-main admin-member-main--compact">
                <div class="admin-member-avatar" aria-hidden="true">
                  ${renderMemberAvatarHtml(avatarUrl)}
                </div>
                <div class="admin-member-meta">
                  <button
                    class="admin-member-open"
                    type="button"
                    data-member-open-id="${escapeAttr(memberId)}"
                    data-member-open-name="${escapeAttr(memberName)}"
                  >
                    ${escapeHtml(memberName)}
                  </button>
                  ${username ? `<span class="admin-sub">@${escapeHtml(username)}</span>` : ""}
                  ${email ? `<span class="admin-sub">${escapeHtml(email)}</span>` : ""}
                  <span class="admin-sub">${commentCount} bình luận • ${badgeCount} huy hiệu</span>
                </div>
              </div>
            </td>
            <td data-label="Trạng thái">
              <div class="admin-member-state">
                ${interactionChip}
                ${isBanned ? '<span class="chip chip--warn">Banned</span>' : ""}
              </div>
            </td>
            <td class="admin-cell-actions" data-label="Ban thành viên">
              <div class="admin-actions admin-actions--members-ban">
                <form
                  method="post"
                  action="/admin/members/${encodedMemberId}/ban"
                  data-confirm-action="toggle-member-ban"
                  data-member-id="${escapeAttr(memberId)}"
                  data-member-name="${escapeAttr(memberName)}"
                  data-member-mode="${memberMode}"
                >
                  <input type="hidden" name="mode" value="${memberMode}" />
                  <button class="${modeButtonClass}" type="submit">${modeButtonLabel}</button>
                </form>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    tableBody.innerHTML = rowsHtml || '<tr><td colspan="3">Chưa có thành viên.</td></tr>';
  };

  const renderPagination = (pagination) => {
    if (!paginationEl) return;
    const totalPages = Math.max(1, toInt(pagination && pagination.totalPages, 1));
    if (totalPages <= 1) {
      paginationEl.hidden = true;
      paginationEl.innerHTML = "";
      return;
    }

    paginationEl.hidden = false;
    const page = Math.max(1, toInt(pagination.page, 1));
    const hasPrev = Boolean(pagination.hasPrev);
    const hasNext = Boolean(pagination.hasNext);
    const prevPage = Math.max(1, toInt(pagination.prevPage, page - 1));
    const nextPage = Math.min(totalPages, toInt(pagination.nextPage, page + 1));
    const pageNumbers = buildPageNumbers({ page, totalPages });

    const numbersHtml = pageNumbers
      .map((num) => {
        if (num === "...") {
          return '<span class="admin-pagination__dots">...</span>';
        }
        if (num === page) {
          return `<span class="chip">${num}</span>`;
        }
        return `<a class="button button--ghost" href="${escapeAttr(
          buildPageHref(num)
        )}" data-members-page="${num}">${num}</a>`;
      })
      .join("");

    paginationEl.innerHTML = `
      <a
        class="button button--ghost admin-pagination__nav ${hasPrev ? "" : "is-disabled"}"
        href="${hasPrev ? escapeAttr(buildPageHref(prevPage)) : "#"}"
        aria-label="Trang trước"
        ${hasPrev ? `data-members-page="${prevPage}"` : 'tabindex="-1" aria-disabled="true"'}
      >
        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
        <span class="sr-only">Trang trước</span>
      </a>
      <span class="chip admin-pagination__meta">Trang ${page}/${totalPages}</span>
      <div class="admin-pagination__numbers">${numbersHtml}</div>
      <a
        class="button button--ghost admin-pagination__nav ${hasNext ? "" : "is-disabled"}"
        href="${hasNext ? escapeAttr(buildPageHref(nextPage)) : "#"}"
        aria-label="Trang sau"
        ${hasNext ? `data-members-page="${nextPage}"` : 'tabindex="-1" aria-disabled="true"'}
      >
        <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
        <span class="sr-only">Trang sau</span>
      </a>
    `;
  };

  let pendingController = null;
  let debounceTimer = null;
  let membersFetchToken = 0;
  let membersQueryComposing = false;

  const fetchMembers = async ({ resetPage } = {}) => {
    if (resetPage) {
      state.page = 1;
    }

    const requestedQ = (qInput.value || "").toString().trim();
    const requestedInteraction = (interactionSelect.value || DEFAULT_INTERACTION).toString();

    state.q = requestedQ;
    state.interaction = requestedInteraction;
    setUrlFromState(state);

    const requestToken = ++membersFetchToken;

    if (pendingController) {
      pendingController.abort();
    }
    pendingController = new AbortController();

    const params = buildQuery(state);
    params.set("format", "json");
    const url = `/admin/members${params.toString() ? `?${params.toString()}` : ""}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      },
      signal: pendingController.signal,
      credentials: "same-origin"
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      throw new Error("Không thể tải danh sách thành viên.");
    }

    if (requestToken !== membersFetchToken) {
      return;
    }
    if (membersQueryComposing) {
      return;
    }

    const liveQ = (qInput.value || "").toString().trim();
    const liveInteraction = (interactionSelect.value || DEFAULT_INTERACTION).toString();
    if (liveQ !== requestedQ || liveInteraction !== requestedInteraction) {
      return;
    }

    const filters = data.filters || {};
    const pagination = data.pagination || {};

    state.q = (filters.q || "").toString().trim();
    state.interaction = (filters.interaction || DEFAULT_INTERACTION).toString();
    state.page = Math.max(1, toInt(pagination.page, 1));

    if (document.activeElement !== qInput) {
      qInput.value = state.q;
    }
    interactionSelect.value = state.interaction;

    renderSummary(pagination);
    renderMembersTable(data.members || [], data.badges || [], filters);
    renderPagination(pagination);
    setUrlFromState(state);
  };

  const scheduleFetch = ({ resetPage }) => {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      fetchMembers({ resetPage }).catch((err) => {
        if (err && err.name === "AbortError") return;
        console.error(err);
      });
    }, 450);
  };

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    fetchMembers({ resetPage: true }).catch((err) => {
      if (err && err.name === "AbortError") return;
      console.error(err);
    });
  });

  qInput.addEventListener("compositionstart", () => {
    membersQueryComposing = true;
  });

  qInput.addEventListener("compositionend", () => {
    membersQueryComposing = false;
    scheduleFetch({ resetPage: true });
  });

  qInput.addEventListener("input", () => {
    if (membersQueryComposing) return;
    scheduleFetch({ resetPage: true });
  });

  interactionSelect.addEventListener("change", () => {
    fetchMembers({ resetPage: true }).catch((err) => {
      if (err && err.name === "AbortError") return;
      console.error(err);
    });
  });

  if (hasEditor && editorAddToggleBtn) {
    editorAddToggleBtn.addEventListener("click", () => {
      const isOpen = editorAddForm && !editorAddForm.hidden;
      setEditorAddFormOpen(!isOpen);
    });
  }

  if (hasEditor && editorAddSearchInput) {
    editorAddSearchInput.addEventListener("input", () => {
      renderEditorAddBadgeList();
    });

    editorAddSearchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setEditorAddFormOpen(false);
      if (editorAddToggleBtn) {
        editorAddToggleBtn.focus();
      }
    });
  }

  if (hasEditor && editorAddListEl) {
    editorAddListEl.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const target = event.target;
      if (!(target instanceof Element)) return;
      const option = target.closest("[data-member-editor-option-id]");
      if (!(option instanceof HTMLElement)) return;

      const badgeId = toInt(option.dataset.memberEditorOptionId, 0);
      if (!badgeId) return;

      editorSelectedBadgeId = badgeId;
      syncEditorBadgeSelection();
      renderEditorAddBadgeList();

      if (!editorAddForm || editorAddForm.hidden) return;
      if (editorAddForm.dataset.memberBusy === "1") return;

      const selectedId = toInt(editorAddSelect && editorAddSelect.value, 0);
      if (!selectedId) return;

      if (typeof editorAddForm.requestSubmit === "function") {
        editorAddForm.requestSubmit();
        return;
      }
      editorAddForm.submit();
    });
  }

  if (hasEditor && editorAddForm) {
    editorAddForm.addEventListener("submit", (event) => {
      const selectedId = toInt(editorAddSelect && editorAddSelect.value, 0);
      if (selectedId > 0) return;

      event.preventDefault();
      event.stopPropagation();
      setEditorStatus("Vui lòng chọn huy hiệu trước khi cấp.", "error", 2200);
      if (editorAddSearchInput && !editorAddSearchInput.disabled) {
        editorAddSearchInput.focus();
      }
    });
  }

  if (hasEditor && editorBadgePicker) {
    document.addEventListener("click", (event) => {
      if (!editorDialog || !editorDialog.open) return;
      if (!editorAddForm || editorAddForm.hidden) return;

      const target = event.target;
      if (!(target instanceof Node)) return;
      if (editorBadgePicker.contains(target)) return;

      setEditorAddFormOpen(false);
    });
  }

  if (hasEditor && editorCloseBtn) {
    editorCloseBtn.addEventListener("click", () => {
      closeEditorDialog();
    });
  }

  if (hasEditor && editorDialog) {
    editorDialog.addEventListener("click", (event) => {
      if (event.target === editorDialog) {
        closeEditorDialog();
      }
    });

    editorDialog.addEventListener("close", () => {
      editorMemberId = "";
      setEditorAddFormOpen(false);
      clearEditorBadgePicker();
      setEditorStatus("", "info");
      setEditorBusy(false);
    });
  }

  tableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest("[data-member-open-id]");
    if (!trigger) return;

    const memberId = (trigger.dataset.memberOpenId || "").toString().trim();
    if (!memberId) return;

    const hintName = (trigger.dataset.memberOpenName || trigger.textContent || "").toString().trim();
    if (!hasEditor) return;

    showEditorDialog();
    loadEditorMember(memberId, { hintName }).catch((err) => {
      const message = (err && err.message) || "Không thể tải thông tin thành viên.";
      setEditorStatus(message, "error");
    });
  });

  paginationEl.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-members-page]");
    if (!link) return;
    const targetPage = toInt(link.dataset.membersPage, 1);
    if (!targetPage || targetPage < 1) return;
    event.preventDefault();
    state.page = targetPage;
    fetchMembers({ resetPage: false }).catch((err) => {
      if (err && err.name === "AbortError") return;
      console.error(err);
    });
  });

  window.addEventListener("admin:members:changed", (event) => {
    const detail = event && typeof event === "object" ? event.detail : null;
    if (!detail || typeof detail !== "object") return;

    const eventMemberId = (detail.memberId || "").toString().trim();
    const shouldRefreshEditor =
      hasEditor &&
      Boolean(editorDialog && editorDialog.open) &&
      Boolean(editorMemberId) &&
      Boolean(eventMemberId) &&
      eventMemberId === editorMemberId;

    const message = (detail.message || "").toString().trim();
    if (message) {
      showInlineStatus(message, detail.ok === false ? "error" : "success");
      if (shouldRefreshEditor || (detail.ok === false && eventMemberId && eventMemberId === editorMemberId)) {
        setEditorStatus(message, detail.ok === false ? "error" : "success", detail.ok === false ? 0 : 2200);
      }
    }

    if (detail.ok === false) return;
    fetchMembers({ resetPage: false }).catch((err) => {
      if (err && err.name === "AbortError") return;
      console.error(err);
    });

    if (shouldRefreshEditor) {
      loadEditorMember(editorMemberId, { silent: true }).catch((err) => {
        const loadMessage = (err && err.message) || "Không thể tải lại thông tin thành viên.";
        setEditorStatus(loadMessage, "error");
      });
    }
  });
})();

(() => {
  const form = document.querySelector("[data-genre-filter-form]");
  if (!form) return;

  const createForm = document.querySelector("[data-genre-create-form]");
  const inlineStatusEl = document.querySelector("[data-genre-inline-status]");
  const input = form.querySelector("[data-genre-filter-input]");
  const clearBtn = form.querySelector("[data-genre-filter-clear]");
  const tbody = document.querySelector("[data-genre-table-body]");
  if (!input || !clearBtn || !tbody) return;

  const getFocusGenreId = () => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("id") || "";
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0;
  };

  const setUrlQuery = (q) => {
    const url = new URL(window.location.href);
    const trimmed = (q || "").trim();
    if (trimmed) {
      url.searchParams.set("q", trimmed);
    } else {
      url.searchParams.delete("q");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const setClearVisibility = () => {
    clearBtn.hidden = !input.value.trim();
  };

  const setButtonBusy = (button, label) => {
    if (!button || !(button instanceof HTMLButtonElement)) return;
    if (button.dataset.originalHtml == null) {
      button.dataset.originalHtml = button.innerHTML;
    }
    if (button.dataset.originalText == null) {
      button.dataset.originalText = (button.textContent || "").toString();
    }
    button.disabled = true;
    button.classList.add("is-loading");
    if (label) {
      button.textContent = String(label);
    }
  };

  const restoreButton = (button) => {
    if (!button || !(button instanceof HTMLButtonElement)) return;
    const originalHtml = button.dataset.originalHtml;
    const originalText = button.dataset.originalText;
    if (originalHtml != null) {
      button.innerHTML = originalHtml;
    } else if (originalText != null) {
      button.textContent = originalText;
    }
    delete button.dataset.originalHtml;
    delete button.dataset.originalText;
    button.classList.remove("is-loading");
    button.disabled = false;
  };

  const postFormJson = async (targetForm, fallbackMessage) => {
    if (!targetForm || !(targetForm instanceof HTMLFormElement)) {
      throw new Error("Biểu mẫu không hợp lệ.");
    }

    const params = new URLSearchParams();
    const formData = new FormData(targetForm);
    formData.forEach((value, key) => {
      params.append(key, value == null ? "" : String(value));
    });

    const response = await fetch(targetForm.action, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json"
      },
      credentials: "same-origin",
      body: params.toString()
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const message =
        data && data.error
          ? String(data.error)
          : (fallbackMessage || "Thao tác thất bại. Vui lòng thử lại.").toString();
      throw new Error(message);
    }

    return data;
  };

  const showGenreToast = (message, variant) => {
    const text = (message || "").toString().trim();
    if (!text) return;

    if (window.BfangToast && typeof window.BfangToast.show === "function") {
      window.BfangToast.show({
        message: text,
        tone: variant === "error" ? "error" : "success",
        source: "admin:genres"
      });
      return;
    }

    window.alert(text);
  };

  window.addEventListener("admin:genres:toast", (event) => {
    const detail = event && event.detail ? event.detail : null;
    const message = detail && detail.message ? String(detail.message) : "";
    if (!message) return;
    const variant = detail && detail.variant === "error" ? "error" : "success";
    showGenreToast(message, variant);
  });

  let inlineStatusTimer = null;
  const showGenreInlineStatus = (message, variant) => {
    if (!inlineStatusEl) return;

    const text = (message || "").toString().trim();
    if (!text) {
      inlineStatusEl.hidden = true;
      inlineStatusEl.textContent = "";
      inlineStatusEl.classList.remove("admin-success", "admin-error");
      return;
    }

    inlineStatusEl.hidden = false;
    inlineStatusEl.textContent = text;
    inlineStatusEl.classList.remove("admin-success", "admin-error");
    inlineStatusEl.classList.add(variant === "error" ? "admin-error" : "admin-success");

    if (inlineStatusTimer) {
      window.clearTimeout(inlineStatusTimer);
      inlineStatusTimer = null;
    }

    inlineStatusTimer = window.setTimeout(() => {
      if (inlineStatusEl) {
        inlineStatusEl.hidden = true;
      }
      inlineStatusTimer = null;
    }, 2400);
  };

  const createTextRow = (text) => {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = text;
    tr.appendChild(td);
    return tr;
  };

  const createGenreRow = (genre) => {
    const id = Number(genre.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    const count = Number(genre.count) || 0;
    const name = (genre.name || "").toString();
    const updateFormId = `genre-update-${id}`;

    const tr = document.createElement("tr");
    tr.id = `genre-${id}`;
    if (getFocusGenreId() === id) {
      tr.className = "admin-row--focus";
    }

    const tdName = document.createElement("td");
    tdName.dataset.label = "Tên";
    const editForm = document.createElement("form");
    editForm.id = updateFormId;
    editForm.className = "admin-genre-edit";
    editForm.method = "post";
    editForm.action = `/admin/genres/${id}/update`;
    editForm.dataset.genreEditForm = "1";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.name = "name";
    nameInput.value = name;
    nameInput.required = true;
    nameInput.autocomplete = "off";
    nameInput.setAttribute("aria-label", "Tên thể loại");

    editForm.appendChild(nameInput);
    tdName.appendChild(editForm);

    const tdCount = document.createElement("td");
    tdCount.dataset.label = "Số truyện";
    const countLink = document.createElement("a");
    countLink.className = "chip chip--link";
    countLink.href = `/admin/manga?include=${id}`;
    countLink.title = "Xem danh sách truyện thuộc thể loại này";
    countLink.setAttribute("aria-label", `Xem danh sách truyện thuộc thể loại ${name}`);
    countLink.textContent = String(count);
    tdCount.appendChild(countLink);

    const tdActions = document.createElement("td");
    tdActions.className = "admin-cell-actions";
    tdActions.dataset.label = "Hành động";
    const actions = document.createElement("div");
    actions.className = "admin-actions";

    const saveBtn = document.createElement("button");
    saveBtn.className = "button button--ghost";
    saveBtn.type = "submit";
    saveBtn.setAttribute("form", updateFormId);
    saveBtn.textContent = "Lưu";
    actions.appendChild(saveBtn);

    const deleteForm = document.createElement("form");
    deleteForm.method = "post";
    deleteForm.action = `/admin/genres/${id}/delete`;
    deleteForm.dataset.confirmAction = "delete-genre";
    deleteForm.dataset.genreId = String(id);
    deleteForm.dataset.genreName = name;
    deleteForm.dataset.genreCount = String(count);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "button button--ghost button--danger";
    deleteBtn.type = "submit";
    deleteBtn.textContent = "Xóa";

    deleteForm.appendChild(deleteBtn);
    actions.appendChild(deleteForm);
    tdActions.appendChild(actions);

    tr.appendChild(tdName);
    tr.appendChild(tdCount);
    tr.appendChild(tdActions);
    return tr;
  };

  const renderGenres = (genres) => {
    tbody.innerHTML = "";

    if (!Array.isArray(genres) || genres.length === 0) {
      const hasQuery = Boolean(input.value.trim());
      tbody.appendChild(createTextRow(hasQuery ? "Không có thể loại phù hợp." : "Chưa có thể loại."));
      return;
    }

    genres.forEach((genre) => {
      const row = createGenreRow(genre);
      if (row) tbody.appendChild(row);
    });

  };

  let debounceTimer = null;
  let controller = null;
  let fetchToken = 0;
  let genreInputComposing = false;

  const fetchGenres = async (q) => {
    const requestToken = ++fetchToken;
    if (controller) {
      controller.abort();
    }
    controller = new AbortController();

    const url = new URL(form.action, window.location.origin);
    const trimmed = (q || "").trim();
    if (trimmed) {
      url.searchParams.set("q", trimmed);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (requestToken !== fetchToken) {
      return;
    }
    const liveQ = (input.value || "").trim();
    if (liveQ !== trimmed) {
      return;
    }
    renderGenres(data && data.genres ? data.genres : []);
  };

  const runFetch = async (updateUrl) => {
    setClearVisibility();
    const q = input.value;
    if (updateUrl) setUrlQuery(q);
    try {
      await fetchGenres(q);
    } catch (error) {
      if (error && error.name === "AbortError") return;
      console.error(error);
    }
  };

  const scheduleFetch = (updateUrl) => {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
    }

    debounceTimer = window.setTimeout(() => {
      runFetch(updateUrl);
    }, 450);
  };

  const submitGenreCreate = async (event) => {
    if (!createForm || !(createForm instanceof HTMLFormElement)) return;
    if (createForm.dataset.genreCreating === "1") return;

    const submitter =
      event.submitter instanceof HTMLButtonElement
        ? event.submitter
        : createForm.querySelector("button[type='submit']");

    createForm.dataset.genreCreating = "1";
    setButtonBusy(submitter, "Đang thêm...");

    try {
      await postFormJson(createForm, "Không thể thêm thể loại. Vui lòng thử lại.");
      const nameInput = createForm.querySelector("input[name='name']");
      if (nameInput && "value" in nameInput) {
        nameInput.value = "";
        nameInput.focus();
      }
      showGenreInlineStatus("", "success");
      showGenreToast("Đã thêm thể loại.", "success");
      await runFetch(false);
    } catch (err) {
      const message = (err && err.message) || "Không thể thêm thể loại. Vui lòng thử lại.";
      showGenreInlineStatus(message, "error");
    } finally {
      delete createForm.dataset.genreCreating;
      restoreButton(submitter);
    }
  };

  const submitGenreEdit = async (editForm, submitter) => {
    if (!editForm || !(editForm instanceof HTMLFormElement)) return;
    if (editForm.dataset.genreSaving === "1") return;

    const button =
      submitter instanceof HTMLButtonElement ? submitter : editForm.querySelector("button[type='submit']");
    editForm.dataset.genreSaving = "1";
    setButtonBusy(button, "Đang lưu...");

    try {
      const data = await postFormJson(editForm, "Không thể cập nhật thể loại. Vui lòng thử lại.");
      const inputEl = editForm.querySelector("input[name='name']");
      if (data && data.genre && data.genre.name && inputEl && "value" in inputEl) {
        inputEl.value = String(data.genre.name);
      }
      showGenreInlineStatus("", "success");
      showGenreToast("Đã cập nhật thể loại.", "success");
      await runFetch(false);
    } catch (err) {
      const message = (err && err.message) || "Không thể cập nhật thể loại. Vui lòng thử lại.";
      showGenreInlineStatus(message, "error");
    } finally {
      delete editForm.dataset.genreSaving;
      restoreButton(button);
    }
  };

  if (createForm && typeof fetch === "function") {
    createForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitGenreCreate(event);
    });
  }

  if (typeof fetch === "function") {
    tbody.addEventListener("submit", (event) => {
      const targetForm = event.target;
      if (!(targetForm instanceof HTMLFormElement)) return;
      if (!targetForm.matches("[data-genre-edit-form]")) return;
      event.preventDefault();
      void submitGenreEdit(targetForm, event.submitter);
    });
  }

  input.addEventListener("compositionstart", () => {
    genreInputComposing = true;
  });

  input.addEventListener("compositionend", () => {
    genreInputComposing = false;
    setClearVisibility();
    scheduleFetch(true);
  });

  input.addEventListener("input", () => {
    if (genreInputComposing) return;
    setClearVisibility();
    scheduleFetch(true);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      runFetch(true);
      input.focus();
    }
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    runFetch(true);
    input.focus();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runFetch(true);
  });

  setClearVisibility();
})();

(() => {
  const input = document.querySelector("[data-cover-input]");
  const previewWrap = document.querySelector("[data-cover-preview-wrap]");
  const preview = document.querySelector("[data-cover-preview]");
  const placeholder = document.querySelector("[data-cover-placeholder]");
  const tempInput = document.querySelector("[data-cover-temp]");
  const overlay = document.querySelector("[data-cover-overlay]");
  const overlayBar = document.querySelector("[data-cover-overlay-bar]");
  const overlayText = document.querySelector("[data-cover-overlay-text]");
  const errorEl = document.querySelector("[data-cover-error]");
  if (
    !input ||
    !previewWrap ||
    !preview ||
    !tempInput ||
    !overlay ||
    !overlayBar ||
    !overlayText ||
    !errorEl
  ) {
    return;
  }

  const form = input.closest("form");
  if (!form) return;

  let objectUrl = "";
  let xhr = null;
  let isUploading = false;

  const setError = (message) => {
    const text = (message || "").toString().trim();
    errorEl.textContent = text;
    errorEl.hidden = !text;
  };

  const setOverlay = (percent, label) => {
    const value = Number(percent);
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    overlayBar.style.width = `${safe}%`;
    overlayText.textContent = (label || "").toString();
    overlay.hidden = false;
  };

  const hideOverlay = () => {
    overlay.hidden = true;
    overlayBar.style.width = "0%";
    overlayText.textContent = "";
  };

  const abortUpload = () => {
    if (xhr) {
      xhr.abort();
      xhr = null;
    }
  };

  const parseJson = (text) => {
    try {
      return JSON.parse(text);
    } catch (_err) {
      return null;
    }
  };

  const uploadTempCover = (file) =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("cover", file, file.name);

      xhr = new XMLHttpRequest();
      xhr.open("POST", "/admin/covers/temp");
      xhr.setRequestHeader("Accept", "application/json");

      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        const percent = (event.loaded / event.total) * 100;
        setOverlay(percent, `Đang upload... ${Math.round(percent)}%`);
      });

      xhr.addEventListener("load", () => {
        const data = parseJson(xhr.responseText);
        const ok = xhr.status >= 200 && xhr.status < 300;
        if (ok && data && data.token && data.url) {
          resolve(data);
          return;
        }

        const message =
          data && data.error
            ? String(data.error)
            : (xhr.responseText || "Upload ảnh bìa thất bại.").toString();
        reject(new Error(message));
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Kết nối upload ảnh bìa thất bại."));
      });

      xhr.addEventListener("abort", () => {
        reject(new Error("Đã hủy upload ảnh bìa."));
      });

      xhr.send(formData);
    });

  input.addEventListener("change", async () => {
    const file = input.files && input.files[0] ? input.files[0] : null;
    abortUpload();
    isUploading = false;
    setError("");
    hideOverlay();
    tempInput.value = "";

    input.value = "";

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }

    if (!file) {
      return;
    }

    objectUrl = URL.createObjectURL(file);
    preview.src = objectUrl;
    preview.hidden = false;
    if (placeholder) {
      placeholder.hidden = true;
    }

    input.disabled = true;
    isUploading = true;
    try {
      setOverlay(0, "Đang upload...");
      const result = await uploadTempCover(file);
      tempInput.value = String(result.token);
      preview.src = String(result.url);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = "";
      }
      setOverlay(100, "Đã upload ảnh bìa.");
      window.setTimeout(() => {
        hideOverlay();
      }, 900);
    } catch (err) {
      setError((err && err.message) || "Upload ảnh bìa thất bại.");
      hideOverlay();
    } finally {
      isUploading = false;
      input.disabled = false;
      abortUpload();
    }
  });

  previewWrap.addEventListener("click", () => {
    if (isUploading) return;
    input.click();
  });

  form.addEventListener("submit", (event) => {
    if (isUploading) {
      event.preventDefault();
      event.stopPropagation();
      setError("Đang upload ảnh bìa, vui lòng chờ.");
      return;
    }
    const token = (tempInput.value || "").toString().trim();
    if (token) {
      input.value = "";
    }
  });
})();

(() => {
  const form = document.querySelector("[data-manga-oneshot-form]");
  if (!form) return;

  const oneshotToggle = form.querySelector("[data-manga-oneshot-toggle]");
  const oneshotGenreInput = form.querySelector("[data-oneshot-genre-checkbox]");
  if (!oneshotToggle || !oneshotGenreInput) return;

  const genreToggle = oneshotGenreInput.closest(".genre-toggle");

  const syncOneshotGenre = () => {
    const isOneshot = Boolean(oneshotToggle.checked);
    if (isOneshot) {
      oneshotGenreInput.checked = true;
      oneshotGenreInput.disabled = true;
      if (genreToggle) {
        genreToggle.classList.add("is-locked");
      }
      return;
    }

    oneshotGenreInput.disabled = false;
    if (genreToggle) {
      genreToggle.classList.remove("is-locked");
    }
  };

  oneshotToggle.addEventListener("change", syncOneshotGenre);
  syncOneshotGenre();
})();

(() => {
  const pickers = Array.from(document.querySelectorAll("[data-team-group-picker]"));
  if (!pickers.length || typeof fetch !== "function") return;

  const parseJson = (text) => {
    try {
      return JSON.parse(text);
    } catch (_err) {
      return null;
    }
  };

  const normalizeTeamItem = (value) => {
    if (!value || typeof value !== "object") return null;
    const id = Number(value.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    const name = (value.name || "").toString().replace(/\s+/g, " ").trim();
    if (!name) return null;
    const slug = (value.slug || "").toString().trim();
    return {
      id: Math.floor(id),
      name,
      slug
    };
  };

  const escapeHtml = (value) =>
    (value == null ? "" : String(value))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  pickers.forEach((picker) => {
    const valueInput = picker.querySelector("[data-team-group-value]");
    const idsInput = picker.querySelector("[data-team-group-ids]");
    const initialInput = picker.querySelector("[data-team-initial-teams]");
    const lockedInput = picker.querySelector("[data-team-locked-ids]");
    const selectedWrap = picker.querySelector("[data-team-selected-list]");
    const searchInput = picker.querySelector("[data-team-search-input]");
    const resultsWrap = picker.querySelector("[data-team-search-results]");
    const errorEl = picker.querySelector("[data-team-search-error]");

    if (!valueInput || !idsInput) return;

    const form = picker.closest("form");
    const isReadonlyPicker = !selectedWrap || !searchInput || !resultsWrap;
    const skipOptionIcons = picker.dataset.teamSearchIconless === "1";

    const selectedTeams = [];
    const selectedMap = new Map();

    const lockedRaw = lockedInput && "value" in lockedInput ? String(lockedInput.value || "") : "";
    const lockedList = parseJson(lockedRaw);
    const lockedTeamIds = new Set();
    if (Array.isArray(lockedList)) {
      lockedList.forEach((value) => {
        const id = Number(value);
        if (!Number.isFinite(id) || id <= 0) return;
        lockedTeamIds.add(Math.floor(id));
      });
    }

    const isLockedTeamId = (value) => {
      const id = Number(value);
      if (!Number.isFinite(id) || id <= 0) return false;
      return lockedTeamIds.has(Math.floor(id));
    };

    const appendSelectedTeam = (teamItem) => {
      const normalized = normalizeTeamItem(teamItem);
      if (!normalized || selectedMap.has(normalized.id)) return false;
      selectedMap.set(normalized.id, normalized);
      selectedTeams.push(normalized);
      return true;
    };

    const initialRaw = initialInput && "value" in initialInput ? String(initialInput.value || "") : "";
    const initialList = parseJson(initialRaw);
    if (Array.isArray(initialList)) {
      initialList.forEach((item) => {
        appendSelectedTeam(item);
      });
    }

    const setPickerError = (message) => {
      if (!errorEl) return;
      const text = (message || "").toString().trim();
      errorEl.textContent = text;
      errorEl.hidden = !text;
    };

    const syncHiddenFields = () => {
      idsInput.value = selectedTeams.map((item) => String(item.id)).join(",");
      valueInput.value = selectedTeams.map((item) => item.name).join(" / ");
    };

    const renderSelected = () => {
      if (!selectedWrap) return;
      if (!selectedTeams.length) {
        selectedWrap.innerHTML = '<span class="admin-team-selector__empty">Chưa chọn nhóm dịch.</span>';
        return;
      }

      selectedWrap.innerHTML = selectedTeams
        .map((item) => {
          const canRemove = !isLockedTeamId(item.id);
          let removeButtonHtml = "";
          if (canRemove) {
            removeButtonHtml =
              `<button class="admin-team-selector__chip-remove" type="button" data-team-remove-id="${item.id}" aria-label="Bỏ ${escapeHtml(
                item.name
              )}">` +
              `<i class="fa-solid fa-xmark" aria-hidden="true"></i>` +
              `</button>`;
          }

          return (
            `<span class="admin-team-selector__chip${canRemove ? "" : " is-locked"}">` +
            `<span class="admin-team-selector__chip-name">${escapeHtml(item.name)}</span>` +
            removeButtonHtml +
            `</span>`
          );
        })
        .join("");
    };

    const removeTeam = (id) => {
      const targetId = Number(id);
      if (!Number.isFinite(targetId) || targetId <= 0) return;
      const safeTargetId = Math.floor(targetId);
      if (isLockedTeamId(safeTargetId)) return;
      const targetIndex = selectedTeams.findIndex((item) => item.id === safeTargetId);
      if (targetIndex < 0) return;
      selectedTeams.splice(targetIndex, 1);
      selectedMap.delete(safeTargetId);
      syncHiddenFields();
      renderSelected();
      setPickerError("");
    };

    const addTeam = (teamItem) => {
      if (!appendSelectedTeam(teamItem)) return;
      syncHiddenFields();
      renderSelected();
      setPickerError("");
    };

    if (isReadonlyPicker) {
      syncHiddenFields();
      return;
    }

    let options = [];
    let fetchToken = 0;
    let fetchController = null;
    let fetchDebounceTimer = null;
    let isComposing = false;

    const renderResults = () => {
      const query = (searchInput.value || "").toString().trim();
      const list = Array.isArray(options) ? options : [];

      if (!query && !list.length) {
        resultsWrap.hidden = true;
        resultsWrap.innerHTML = "";
        return;
      }

      if (!list.length) {
        resultsWrap.hidden = false;
        resultsWrap.innerHTML = '<p class="admin-team-selector__result-empty">Không tìm thấy nhóm dịch phù hợp.</p>';
        return;
      }

      resultsWrap.hidden = false;
      resultsWrap.innerHTML = list
        .map((item) => {
          const picked = selectedMap.has(item.id);
          return (
            `<button class="admin-team-selector__option${picked ? " is-selected" : ""}" type="button" data-team-option-id="${
              item.id
            }"${skipOptionIcons ? ' data-button-icon-skip="1"' : ""} ${picked ? "disabled" : ""}>` +
            `<span class="admin-team-selector__option-name">${escapeHtml(item.name)}</span>` +
            `<span class="admin-team-selector__option-sub">/${escapeHtml(item.slug || "")}</span>` +
            `</button>`
          );
        })
        .join("");
    };

    const fetchOptions = async () => {
      const endpoint = (picker.dataset.teamSearchEndpoint || "/admin/teams/search").toString().trim();
      const query = (searchInput.value || "").toString().trim();

      if (!query) {
        if (fetchController) {
          fetchController.abort();
          fetchController = null;
        }
        options = [];
        renderResults();
        return;
      }

      const requestToken = ++fetchToken;

      if (fetchController) {
        fetchController.abort();
      }
      fetchController = new AbortController();

      const url = new URL(endpoint, window.location.origin);
      url.searchParams.set("q", query);

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json"
        },
        credentials: "same-origin",
        signal: fetchController.signal
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.ok !== true || !Array.isArray(data.teams)) {
        throw new Error("Không thể tải danh sách nhóm dịch.");
      }
      if (requestToken !== fetchToken) return;

      options = data.teams.map((item) => normalizeTeamItem(item)).filter(Boolean);
      renderResults();
    };

    const runFetch = async () => {
      try {
        await fetchOptions();
        setPickerError("");
      } catch (error) {
        if (error && error.name === "AbortError") return;
        setPickerError((error && error.message) || "Không thể tải danh sách nhóm dịch.");
      }
    };

    const scheduleFetch = (delayMs = 180) => {
      if (fetchDebounceTimer) {
        window.clearTimeout(fetchDebounceTimer);
      }

      const delay = Number(delayMs);
      const safeDelay = Number.isFinite(delay) ? Math.max(0, Math.min(800, Math.floor(delay))) : 180;
      fetchDebounceTimer = window.setTimeout(() => {
        fetchDebounceTimer = null;
        runFetch();
      }, safeDelay);
    };

    searchInput.addEventListener("focus", () => {
      scheduleFetch(0);
    });

    searchInput.addEventListener("compositionstart", () => {
      isComposing = true;
    });

    searchInput.addEventListener("compositionend", () => {
      isComposing = false;
      scheduleFetch(120);
    });

    searchInput.addEventListener("input", () => {
      if (isComposing) return;
      scheduleFetch(180);
    });

    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        searchInput.value = "";
        scheduleFetch(0);
        return;
      }

      if (event.key !== "Enter") return;
      const firstOption = resultsWrap.querySelector("[data-team-option-id]:not([disabled])");
      if (!firstOption) return;
      event.preventDefault();
      firstOption.click();
    });

    selectedWrap.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const removeIcon = target.closest(".admin-team-selector__chip-remove i");
      if (!removeIcon || !selectedWrap.contains(removeIcon)) return;

      const button = removeIcon.closest("button.admin-team-selector__chip-remove");
      if (!button || !selectedWrap.contains(button)) return;

      event.preventDefault();
      event.stopPropagation();
      removeTeam(button.getAttribute("data-team-remove-id") || "");
      scheduleFetch(0);
      searchInput.focus();
    });

    selectedWrap.addEventListener("keydown", (event) => {
      const target = event.target instanceof Element ? event.target.closest("button.admin-team-selector__chip-remove") : null;
      if (!target || !selectedWrap.contains(target)) return;
      if (event.key !== "Enter" && event.key !== " ") return;

      event.preventDefault();
      event.stopPropagation();
      removeTeam(target.getAttribute("data-team-remove-id") || "");
      scheduleFetch(0);
      searchInput.focus();
    });

    resultsWrap.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-team-option-id]") : null;
      if (!target || target.hasAttribute("disabled")) return;

      const teamId = Number(target.getAttribute("data-team-option-id") || "");
      const selectedItem = options.find((item) => item.id === teamId);
      if (!selectedItem) return;

      addTeam(selectedItem);
      searchInput.value = "";
      scheduleFetch(0);
      searchInput.focus();
    });

    if (form) {
      form.addEventListener("submit", (event) => {
        syncHiddenFields();
        if (selectedTeams.length > 0) {
          setPickerError("");
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        setPickerError("Vui lòng chọn ít nhất một nhóm dịch từ danh sách.");
        searchInput.focus();
      });
    }

    syncHiddenFields();
    renderSelected();
  });
})();

(() => {
  const form = document.querySelector("[data-chapter-pages-form]");
  if (!form) return;

  const input = form.querySelector("[data-chapter-pages-input]");
  const queueEl = form.querySelector("[data-upload-queue]");
  const overallEl = form.querySelector("[data-upload-overall]");
  const overallBar = form.querySelector("[data-upload-overall-bar]");
  const overallText = form.querySelector("[data-upload-overall-text]");
  const clearBtn = form.querySelector("[data-upload-clear]");
  const startBtn = form.querySelector("[data-upload-start]");
  if (!input || !queueEl || !overallEl || !overallBar || !overallText || !clearBtn || !startBtn) {
    return;
  }

  const chapterId = (form.dataset.chapterId || "").toString().trim();
  if (!chapterId) return;

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const b2Ready = form.dataset.b2Ready === "1";

  let queue = [];
  let uploading = false;
  let activeXhr = null;
  let totalBytes = 0;
  let completedBytes = 0;
  let padLength = 3;

  const formatBytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value}B`;
    const kb = value / 1024;
    if (kb < 1024) return `${kb.toFixed(1)}KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)}MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)}GB`;
  };

  const setOverallProgress = (percent, label) => {
    const value = Number(percent);
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    overallBar.style.width = `${safe}%`;
    overallText.textContent = (label || "").toString();
    overallEl.hidden = false;
  };

  const hideOverall = () => {
    overallEl.hidden = true;
    overallBar.style.width = "0%";
    overallText.textContent = "";
  };

  const abortActive = () => {
    if (activeXhr) {
      activeXhr.abort();
      activeXhr = null;
    }
  };

  const resetQueue = () => {
    abortActive();
    queue.forEach((item) => {
      if (item.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
      }
    });
    queue = [];
    queueEl.innerHTML = "";
    queueEl.hidden = true;
    clearBtn.hidden = true;
    hideOverall();
    totalBytes = 0;
    completedBytes = 0;
    padLength = 3;
  };

  const parseJson = (text) => {
    try {
      return JSON.parse(text);
    } catch (_err) {
      return null;
    }
  };

  const uploadPage = (item) =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("page", item.file, item.file.name);
      const url = `/admin/chapters/${encodeURIComponent(chapterId)}/pages/upload?page=${encodeURIComponent(
        String(item.page)
      )}&pad=${encodeURIComponent(String(padLength))}`;

      const xhr = new XMLHttpRequest();
      activeXhr = xhr;
      xhr.open("POST", url);
      xhr.setRequestHeader("Accept", "application/json");

      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.max(0, Math.min(1, event.loaded / event.total));
        const percent = pct * 100;
        item.bar.style.width = `${percent}%`;
        item.pct.textContent = `${Math.round(percent)}%`;

        const overallLoaded = completedBytes + pct * item.bytes;
        const overallPct = totalBytes ? (overallLoaded / totalBytes) * 100 : 0;
        setOverallProgress(
          overallPct,
          `Đang upload ${item.page}/${queue.length} • ${Math.round(overallPct)}% (${formatBytes(
            overallLoaded
          )}/${formatBytes(totalBytes)})`
        );
      });

      xhr.addEventListener("load", () => {
        const data = parseJson(xhr.responseText);
        const ok = xhr.status >= 200 && xhr.status < 300;
        if (ok && data && data.ok) {
          resolve(data);
          return;
        }
        const message =
          data && data.error
            ? String(data.error)
            : (xhr.responseText || "Upload ảnh trang thất bại.").toString();
        reject(new Error(message));
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Kết nối upload ảnh trang thất bại."));
      });

      xhr.addEventListener("abort", () => {
        reject(new Error("Đã hủy upload."));
      });

      xhr.send(formData);
    });

  const finalizeChapter = async (pages) => {
    const response = await fetch(`/admin/chapters/${encodeURIComponent(chapterId)}/pages/finalize`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ pages })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || "Finalize thất bại.");
    }
    return response.json().catch(() => ({}));
  };

  const setQueueFromFiles = (files) => {
    if (uploading) return;
    resetQueue();

    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;

    list.sort((a, b) => collator.compare(a.name || "", b.name || ""));
    padLength = Math.max(3, String(list.length).length);
    totalBytes = list.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    completedBytes = 0;

    queue = list.map((file, index) => {
      const page = index + 1;
      const objectUrl = URL.createObjectURL(file);

      const itemEl = document.createElement("div");
      itemEl.className = "upload-item";

      const thumb = document.createElement("div");
      thumb.className = "upload-thumb";
      const img = document.createElement("img");
      img.src = objectUrl;
      img.alt = `Trang ${page}`;
      img.loading = "lazy";
      thumb.appendChild(img);

      const thumbProgress = document.createElement("div");
      thumbProgress.className = "upload-thumb-progress";
      const bar = document.createElement("div");
      bar.className = "upload-thumb-progress__bar";
      bar.style.width = "0%";
      thumbProgress.appendChild(bar);
      thumb.appendChild(thumbProgress);

      const info = document.createElement("div");
      info.className = "upload-info";
      const name = document.createElement("div");
      name.className = "upload-name";
      const pageName = String(page).padStart(padLength, "0");
      name.textContent = `${pageName} — ${file.name}`;
      const sub = document.createElement("div");
      sub.className = "upload-sub";
      sub.textContent = `${formatBytes(file.size)} • ${(file.type || "").replace("image/", "") || "image"}`;
      info.append(name, sub);

      const right = document.createElement("div");
      right.className = "upload-right";
      const state = document.createElement("div");
      state.className = "upload-state";
      state.textContent = "Chờ";
      const pct = document.createElement("div");
      pct.className = "upload-sub";
      pct.textContent = "0%";
      right.append(state, pct);

      itemEl.append(thumb, info, right);
      queueEl.appendChild(itemEl);

      return {
        file,
        page,
        bytes: Number(file.size) || 0,
        objectUrl,
        el: itemEl,
        bar,
        pct,
        state
      };
    });

    queueEl.hidden = false;
    clearBtn.hidden = false;
    setOverallProgress(0, `Sẵn sàng upload ${queue.length} ảnh (${formatBytes(totalBytes)}).`);
  };

  const dropZone = form.querySelector("[data-upload-drop]");
  if (dropZone) {
    const setHover = (value) => {
      dropZone.classList.toggle("is-dragover", Boolean(value));
    };

    dropZone.addEventListener("dragenter", (event) => {
      if (uploading || !b2Ready) return;
      event.preventDefault();
      setHover(true);
    });

    dropZone.addEventListener("dragover", (event) => {
      if (uploading || !b2Ready) return;
      event.preventDefault();
      setHover(true);
    });

    dropZone.addEventListener("dragleave", () => {
      setHover(false);
    });

    dropZone.addEventListener("drop", (event) => {
      if (uploading || !b2Ready) return;
      event.preventDefault();
      setHover(false);
      const dropped = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
      setQueueFromFiles(dropped);
    });
  }

  input.addEventListener("change", () => {
    setQueueFromFiles(Array.from(input.files || []));
    input.value = "";
  });

  clearBtn.addEventListener("click", () => {
    if (uploading) return;
    input.value = "";
    resetQueue();
  });

  form.addEventListener("submit", async (event) => {
    if (!queue.length || uploading) return;
    if (!b2Ready) return;
    event.preventDefault();

    uploading = true;
    startBtn.disabled = true;
    clearBtn.hidden = true;
    input.disabled = true;
    completedBytes = 0;

    try {
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        item.state.textContent = "Đang";
        item.state.classList.remove("is-error", "is-done");
        item.el.classList.remove("is-error", "is-done");
        item.el.classList.add("is-uploading");

        await uploadPage(item);
        completedBytes += item.bytes;

        item.bar.style.width = "100%";
        item.pct.textContent = "100%";
        item.state.textContent = "Xong";
        item.state.classList.add("is-done");
        item.el.classList.remove("is-uploading");
        item.el.classList.add("is-done");
      }

      setOverallProgress(100, "Đang hoàn tất...");
      await finalizeChapter(queue.length);
      window.location.href = `/admin/chapters/${encodeURIComponent(chapterId)}/pages?status=uploaded`;
    } catch (err) {
      const message = (err && err.message) || "Upload thất bại.";
      setOverallProgress(0, message);
      queue.forEach((item) => {
        if (item.state.textContent === "Đang") {
          item.state.textContent = "Lỗi";
          item.state.classList.add("is-error");
          item.el.classList.remove("is-uploading");
          item.el.classList.add("is-error");
        }
      });
      startBtn.disabled = false;
      input.disabled = false;
      clearBtn.hidden = false;
    } finally {
      uploading = false;
      abortActive();
    }
  });
})();

(() => {
  const form = document.querySelector("[data-chapter-new-form]");
  if (!form) return;

  const b2Ready = form.dataset.b2Ready === "1";
  const draftToken = (form.dataset.draftToken || "").toString().trim();
  const chapterUploadApiBaseUrl = (form.dataset.chapterUploadApiBaseUrl || "")
    .toString()
    .trim()
    .replace(/\/+$/, "");
  const chapterUploadApiProof = (form.dataset.chapterUploadApiProof || "").toString().trim();
  const imageCompression =
    typeof window !== "undefined" && typeof window.imageCompression === "function"
      ? window.imageCompression
      : null;
  const hasUploadApiTarget = Boolean(chapterUploadApiBaseUrl);
  const hasUploadApiProof = Boolean(chapterUploadApiProof);
  const useUploadApiServer = hasUploadApiTarget && hasUploadApiProof;
  const allowReplace = form.dataset.allowReplace === "1";
  const isWebtoonManga = form.dataset.isWebtoon === "1";

  const numberInput = form.querySelector("[data-chapter-number-input]");
  const positionSelect = form.querySelector("[data-chapter-position-select]");
  const draftPagesInput = form.querySelector("[data-draft-pages-input]");
  const saveBtn = form.querySelector("[data-chapter-save]");
  const pagesTouchedInput = form.querySelector("[data-pages-touched-input]");

  const input = form.querySelector("[data-chapter-draft-pages-input]");
  const dropZone = form.querySelector("[data-upload-drop]");
  const queueEl = form.querySelector("[data-upload-queue]");
  const overallEl = form.querySelector("[data-upload-overall]");
  const overallBar = form.querySelector("[data-upload-overall-bar]");
  const overallText = form.querySelector("[data-upload-overall-text]");
  const errorEl = form.querySelector("[data-draft-upload-error]");
  const numberErrorEl = form.querySelector("[data-chapter-number-error]");

  if (
    !draftPagesInput ||
    !saveBtn ||
    !input ||
    !dropZone ||
    !queueEl ||
    !overallEl ||
    !overallBar ||
    !overallText ||
    !errorEl
  ) {
    return;
  }

  const setError = (message) => {
    const text = (message || "").toString().trim();
    if (!text) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.textContent = text;
    errorEl.hidden = false;
  };

  if (!b2Ready || !draftToken) {
    saveBtn.disabled = true;
    setError("Thiếu phiên upload tạm hoặc cấu hình lưu trữ ảnh.");
    return;
  }

  if (hasUploadApiTarget && !hasUploadApiProof) {
    saveBtn.disabled = true;
    setError("Thiếu chữ ký upload API. Vui lòng kiểm tra CHAPTER_UPLOAD_SHARED_SECRET.");
    return;
  }

  const markTouched = () => {
    if (!pagesTouchedInput) return;
    pagesTouchedInput.value = "1";
  };

  const safeNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const parseJson = (text) => {
    try {
      return JSON.parse(text);
    } catch (_err) {
      return null;
    }
  };

  const buildDraftUploadUrl = (pageId) => {
    const tokenValue = encodeURIComponent(draftToken);
    const pageValue = encodeURIComponent((pageId || "").toString().trim());
    if (useUploadApiServer) {
      return `${chapterUploadApiBaseUrl}/v1/chapter-drafts/${tokenValue}/pages/upload?id=${pageValue}`;
    }
    return `/admin/chapter-drafts/${tokenValue}/pages/upload?id=${pageValue}`;
  };

  const buildDraftDeleteUrl = () => {
    const tokenValue = encodeURIComponent(draftToken);
    if (useUploadApiServer) {
      return `${chapterUploadApiBaseUrl}/v1/chapter-drafts/${tokenValue}/pages/delete`;
    }
    return `/admin/chapter-drafts/${tokenValue}/pages/delete`;
  };

  const isSupportedApiUploadMimeType = (value) => {
    const type = (value || "").toString().trim().toLowerCase();
    return (
      type === "image/jpeg" ||
      type === "image/png" ||
      type === "image/webp" ||
      type === "image/avif" ||
      type === "image/bmp"
    );
  };

  const isClientCompressibleMimeType = (value) => {
    const type = (value || "").toString().trim().toLowerCase();
    return type === "image/jpeg" || type === "image/webp";
  };

  const isSupportedDirectUploadMimeType = (value) => {
    const type = (value || "").toString().trim().toLowerCase();
    return type === "image/jpeg" || type === "image/png" || type === "image/webp";
  };

  const readImageDimensions = (file) =>
    new Promise((resolve, reject) => {
      if (!(file instanceof Blob)) {
        reject(new Error("Invalid image file."));
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      const cleanup = () => {
        URL.revokeObjectURL(objectUrl);
      };

      image.onload = () => {
        const width = Number(image.naturalWidth) || 0;
        const height = Number(image.naturalHeight) || 0;
        cleanup();
        resolve({ width, height });
      };
      image.onerror = () => {
        cleanup();
        reject(new Error("Cannot read image dimensions."));
      };
      image.src = objectUrl;
    });

  const compressChapterDraftFile = async (file) => {
    if (!file) {
      throw new Error("Thiếu file ảnh.");
    }

    if (!imageCompression) {
      return file;
    }

    const type = (file.type || "").toString().trim().toLowerCase();
    if (useUploadApiServer) {
      if (!isSupportedApiUploadMimeType(type)) {
        return file;
      }
      if (!isClientCompressibleMimeType(type)) {
        return file;
      }
    } else {
      const isSupportedImage =
        type === "image/jpeg" ||
        type === "image/png" ||
        type === "image/webp" ||
        type === "image/bmp";
      if (!isSupportedImage) {
        return file;
      }
    }

    const options = {
      initialQuality: 0.9,
      libURL: "/vendor/browser-image-compression/browser-image-compression.js",
      useWebWorker: true
    };

    const dimensions = await readImageDimensions(file).catch(() => null);
    if (!isWebtoonManga && dimensions && Number(dimensions.height) > 1800) {
      options.maxWidthOrHeight = 1800;
    }

    const compressed = await imageCompression(file, options);

    if (typeof File === "function") {
      const sourceType = (file.type || "").toString().trim().toLowerCase();
      const compressedType =
        compressed && compressed.type ? String(compressed.type).trim().toLowerCase() : "";
      const targetType = compressedType || sourceType || "application/octet-stream";
      const targetName = (file && file.name ? String(file.name) : "chapter-page").trim() || "chapter-page";
      if (compressed instanceof File && compressed.type === targetType && compressed.name === targetName) {
        return compressed;
      }
      return new File([compressed], targetName, {
        type: targetType,
        lastModified: Date.now()
      });
    }

    return compressed;
  };

  const prepareUploadFile = async (item) => {
    if (!item || !item.file) {
      throw new Error("Thiếu file ảnh.");
    }
    if (item.uploadFile) {
      return item.uploadFile;
    }

    let prepared = item.file;
    try {
      prepared = await compressChapterDraftFile(item.file);
    } catch (error) {
      if (useUploadApiServer) {
        console.warn("Compress chapter page failed on api_server mode, fallback to original file", error);
        prepared = item.file;
      } else {
        console.warn("Compress chapter page failed, fallback to original file", error);
        prepared = item.file;
      }
    }

    const preparedType = (prepared && prepared.type ? String(prepared.type) : "").trim().toLowerCase();
    if (useUploadApiServer) {
      if (!isSupportedApiUploadMimeType(preparedType)) {
        throw new Error("Ảnh upload lên api_server chỉ hỗ trợ JPG, PNG, WebP, AVIF hoặc BMP.");
      }
    } else if (!isSupportedDirectUploadMimeType(preparedType)) {
      throw new Error("Ảnh upload lên server chính chỉ hỗ trợ JPG, PNG hoặc WebP.");
    }

    item.uploadFile = prepared;
    item.bytes = Number(prepared && prepared.size) || item.bytes;
    return prepared;
  };

  const roundNice = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n * 1000) / 1000;
    return Number.isFinite(rounded) ? rounded : null;
  };

  let validateChapterNumber = () => true;

  if (numberInput && positionSelect) {
    const normalizeNumberText = (value) => {
      const raw = value == null ? "" : String(value);
      return raw.replace(/,/g, ".").trim();
    };

    let chapterNumbers = [];
    const rawChapterNumbers = (form.dataset.chapterNumbers || "").toString().trim();
    if (rawChapterNumbers) {
      const parsed = parseJson(rawChapterNumbers);
      if (Array.isArray(parsed)) {
        chapterNumbers = parsed
          .map((value) => safeNumber(value))
          .filter((n) => n != null && n >= 0)
          .sort((a, b) => a - b);
      }
    }

    const setNumberError = (message) => {
      const text = (message || "").toString().trim();

      if (numberErrorEl) {
        numberErrorEl.textContent = text;
        numberErrorEl.hidden = !text;
      }

      if (typeof numberInput.setCustomValidity === "function") {
        numberInput.setCustomValidity(text);
      }
    };

    validateChapterNumber = () => {
      const normalized = normalizeNumberText(numberInput.value);
      if (normalized !== numberInput.value) {
        numberInput.value = normalized;
      }

      if (!normalized) {
        setNumberError("Vui lòng nhập số chương.");
        return false;
      }

      const parsed = safeNumber(normalized);
      if (parsed == null || parsed < 0) {
        setNumberError("Số chương phải là số từ 0 trở lên.");
        return false;
      }

      const dot = normalized.indexOf(".");
      if (dot >= 0) {
        const decimals = normalized.slice(dot + 1);
        if (decimals.length > 3) {
          setNumberError("Số chương chỉ hỗ trợ tối đa 3 số thập phân.");
          return false;
        }
      }

      const duplicated = chapterNumbers.some((value) => Math.abs(value - parsed) <= 1e-9);
      if (duplicated) {
        setNumberError("Số chương đã tồn tại.");
        return false;
      }

      setNumberError("");
      return true;
    };

    const getSuggestedNumber = () => {
      const value = (positionSelect.value || "").toString();
      const max = chapterNumbers.length ? Math.max(...chapterNumbers) : 0;
      const next = max > 0 ? Math.floor(max) + 1 : 1;
      if (value === "after_latest") return next;

      const match = value.match(/^after:(.+)$/);
      if (!match) return next;
      const after = safeNumber(match[1]);
      if (after == null || after < 0) return next;

      const nextChapter = chapterNumbers.find((n) => n > after) || null;
      if (nextChapter == null) {
        return Math.floor(after) + 1;
      }

      const candidateInt = Math.floor(after) + 1;
      if (candidateInt > after && candidateInt < nextChapter - 1e-9) {
        return candidateInt;
      }

      const mid = (after + nextChapter) / 2;
      return roundNice(mid) || next;
    };

    positionSelect.addEventListener("change", () => {
      const suggested = getSuggestedNumber();
      if (suggested == null) return;
      numberInput.value = normalizeNumberText(suggested);
      validateChapterNumber();
    });

    numberInput.addEventListener("input", validateChapterNumber);
    numberInput.addEventListener("change", validateChapterNumber);
    validateChapterNumber();
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  const createRandomHex = (byteCount) => {
    const count = Number(byteCount) || 0;
    const safe = Math.max(1, Math.min(32, Math.floor(count)));
    const bytes = new Uint8Array(safe);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  const formatBytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value}B`;
    const kb = value / 1024;
    if (kb < 1024) return `${kb.toFixed(1)}KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)}MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)}GB`;
  };

  const setOverallProgress = (percent, label) => {
    const value = Number(percent);
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    overallBar.style.width = `${safe}%`;
    overallText.textContent = (label || "").toString();
    overallEl.hidden = false;
  };

  const hideOverall = () => {
    overallEl.hidden = true;
    overallBar.style.width = "0%";
    overallText.textContent = "";
  };

  let items = [];
  let uploading = false;
  const activeXhrs = new Map();
  let totalBytes = 0;
  let completedBytes = 0;
  const maxParallelUploads = 3;

  const abortActive = () => {
    activeXhrs.forEach((xhr) => {
      try {
        xhr.abort();
      } catch (_err) {
        // ignore
      }
    });
    activeXhrs.clear();
  };

  const updateHiddenPages = () => {
    draftPagesInput.value = JSON.stringify(items.map((item) => item.id));
  };

  const padLengthFor = (count) => Math.max(3, Math.min(6, String(count).length));

  const setItemState = (item, next) => {
    item.state = next;
    item.el.classList.remove("is-uploading", "is-error", "is-done");
    item.stateEl.classList.remove("is-uploading", "is-error", "is-done", "is-loading");
    item.pctEl.hidden = true;
    item.progressEl.hidden = true;

    if (next === "uploading") {
      item.el.classList.add("is-uploading");
      item.stateEl.textContent = "";
      item.stateEl.classList.add("is-loading");
      item.stateEl.setAttribute("aria-label", "Đang upload");
      item.pctEl.textContent = "0%";
      item.pctEl.hidden = false;
      item.progressEl.hidden = false;
      item.barEl.style.width = "0%";
      return;
    }

    if (next === "done") {
      item.el.classList.add("is-done");
      item.stateEl.classList.add("is-done");
      item.stateEl.textContent = "Xong";
      item.stateEl.setAttribute("aria-label", "Đã upload");
      return;
    }

    if (next === "error") {
      item.el.classList.add("is-error");
      item.stateEl.classList.add("is-error");
      item.stateEl.textContent = "Lỗi";
      item.stateEl.setAttribute("aria-label", "Lỗi upload");
      item.pctEl.textContent = "0%";
      item.barEl.style.width = "0%";
      return;
    }

    item.stateEl.textContent = "Chờ";
    item.stateEl.setAttribute("aria-label", "Chờ upload");
    item.pctEl.textContent = "0%";
    item.barEl.style.width = "0%";
  };

  const refreshLabels = () => {
    const padLength = padLengthFor(items.length);
    items.forEach((item, index) => {
      const pageName = String(index + 1).padStart(padLength, "0");
      if (item.indexEl) {
        item.indexEl.textContent = pageName;
      }

      const filename = (item.file && item.file.name ? item.file.name : "").toString();
      if (item.el) {
        item.el.title = filename;
      }
      if (item.removeBtn) {
        item.removeBtn.disabled = uploading;
      }
    });
  };

  const updateControls = () => {
    const hasItems = items.length > 0;
    const allDone = hasItems && items.every((item) => item.state === "done");
    saveBtn.disabled = !allDone || uploading;
    queueEl.hidden = !hasItems;
  };

  let autoUploadTimer = null;
  const scheduleAutoUpload = (delayMs = 120) => {
    if (autoUploadTimer) {
      window.clearTimeout(autoUploadTimer);
    }

    const delay = Number(delayMs);
    const safeDelay = Number.isFinite(delay) ? Math.max(0, Math.min(1500, Math.floor(delay))) : 120;

    autoUploadTimer = window.setTimeout(() => {
      autoUploadTimer = null;
      if (uploading) {
        if (items.some((item) => item.state === "queued")) {
          scheduleAutoUpload(220);
        }
        return;
      }

      const plan = items.filter((item) => item.state === "queued");
      if (!plan.length) {
        updateControls();
        return;
      }
      uploadItems(plan);
    }, safeDelay);
  };

  const deleteRemote = (id) => {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json"
    };
    if (useUploadApiServer) {
      headers["X-Chapter-Draft-Proof"] = chapterUploadApiProof;
    }

    fetch(buildDraftDeleteUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify({ id })
    }).catch(() => null);
  };

  const removeItemById = (id) => {
    if (uploading) return;
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;

    const item = items[index];
    if (item.objectUrl) {
      URL.revokeObjectURL(item.objectUrl);
    }
    if (item.el && item.el.parentNode) {
      item.el.parentNode.removeChild(item.el);
    }

    if (item.state === "done") {
      deleteRemote(id);
    }

    items.splice(index, 1);
    markTouched();
    updateHiddenPages();
    refreshLabels();
    updateControls();
  };

  let draggingId = "";
  let dragOverId = "";

  const clearDragState = () => {
    dragOverId = "";
    items.forEach((item) => {
      if (!item || !item.el) return;
      item.el.classList.remove("is-dragging", "is-dragover");
    });
  };

  const renderTiles = () => {
    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      if (!item || !item.el) return;
      fragment.appendChild(item.el);
    });
    queueEl.textContent = "";
    queueEl.appendChild(fragment);
  };

  const moveItemById = (fromId, toId, placeAfter = false) => {
    const fromIndex = items.findIndex((item) => item.id === fromId);
    const toIndex = items.findIndex((item) => item.id === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    const moved = items.splice(fromIndex, 1)[0];
    let insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    if (placeAfter) {
      insertIndex += 1;
    }
    insertIndex = Math.max(0, Math.min(items.length, insertIndex));
    items.splice(insertIndex, 0, moved);

    markTouched();

    renderTiles();
    updateHiddenPages();
    refreshLabels();
  };

  const moveItemToEnd = (id) => {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;
    const moved = items.splice(index, 1)[0];
    items.push(moved);

    markTouched();

    renderTiles();
    updateHiddenPages();
    refreshLabels();
  };

  queueEl.addEventListener("dragover", (event) => {
    if (!draggingId) return;
    const tile = event.target && event.target.closest ? event.target.closest(".upload-tile") : null;
    if (tile) return;
    event.preventDefault();
  });

  queueEl.addEventListener("drop", (event) => {
    if (!draggingId) return;
    const tile = event.target && event.target.closest ? event.target.closest(".upload-tile") : null;
    if (tile) return;

    event.preventDefault();
    const dragged = draggingId;
    draggingId = "";
    moveItemToEnd(dragged);
    clearDragState();
  });

  const replaceItemFile = (item, file) => {
    if (!item || !file) return;
    if (item.objectUrl) {
      URL.revokeObjectURL(item.objectUrl);
    }

    item.file = file;
    item.uploadFile = null;
    item.bytes = Number(file.size) || 0;
    item.objectUrl = URL.createObjectURL(file);
    item.imgEl.src = item.objectUrl;
    setItemState(item, "queued");
    markTouched();
    updateHiddenPages();
    refreshLabels();
    updateControls();
    scheduleAutoUpload();
  };

  const openReplacePicker = (item) => {
    if (uploading) return;
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/jpeg,image/png,image/webp";
    picker.className = "upload-input";
    picker.addEventListener("change", () => {
      const file = picker.files && picker.files[0] ? picker.files[0] : null;
      if (!file) return;
      replaceItemFile(item, file);
    });
    picker.click();
  };

  const uploadOne = async (item, onProgress) => {
    if (!item || !item.file) {
      throw new Error("Thiếu file.");
    }

    const uploadFile = await prepareUploadFile(item);
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("page", uploadFile, uploadFile.name || item.file.name || `${item.id}.webp`);
      const url = buildDraftUploadUrl(item.id);

      const xhr = new XMLHttpRequest();
      activeXhrs.set(item.id, xhr);
      const cleanup = () => {
        activeXhrs.delete(item.id);
      };
      xhr.open("POST", url);
      xhr.setRequestHeader("Accept", "application/json");
      if (useUploadApiServer) {
        xhr.setRequestHeader("X-Chapter-Draft-Proof", chapterUploadApiProof);
      }

      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.max(0, Math.min(1, event.loaded / event.total));
        const percent = pct * 100;
        item.barEl.style.width = `${percent}%`;
        item.pctEl.textContent = `${Math.round(percent)}%`;

        if (typeof onProgress === "function") {
          onProgress(pct);
        }
      });

      xhr.addEventListener("load", () => {
        cleanup();
        const ok = xhr.status >= 200 && xhr.status < 300;
        const data = parseJson(xhr.responseText);
        if (ok && data && data.ok) {
          resolve(data);
          return;
        }
        const message =
          data && data.error
            ? String(data.error)
            : (xhr.responseText || "Upload ảnh trang thất bại.").toString();
        reject(new Error(message));
      });

      xhr.addEventListener("error", () => {
        cleanup();
        reject(new Error("Kết nối upload ảnh trang thất bại."));
      });

      xhr.addEventListener("abort", () => {
        cleanup();
        reject(new Error("Đã hủy upload."));
      });

      xhr.send(formData);
    });
  };

  const sumMapValues = (map) => {
    let sum = 0;
    map.forEach((value) => {
      const n = Number(value);
      if (Number.isFinite(n)) {
        sum += n;
      }
    });
    return sum;
  };

  const uploadItems = (plan) => {
    if (uploading) return Promise.resolve();
    const list = Array.isArray(plan) ? plan.filter(Boolean) : [];
    if (!list.length) return Promise.resolve();

    setError("");
    hideOverall();
    uploading = true;
    input.disabled = true;
    saveBtn.disabled = true;
    refreshLabels();
    updateControls();

    totalBytes = list.reduce((sum, item) => sum + (item.bytes || 0), 0);
    completedBytes = 0;

    const inFlight = new Map();
    let inFlightCount = 0;
    let nextIndex = 0;
    let doneCount = 0;
    let errorCount = 0;

    let resolveDone = null;
    const donePromise = new Promise((resolve) => {
      resolveDone = resolve;
    });

    const updateOverall = () => {
      const inFlightLoaded = sumMapValues(inFlight);
      const overallLoaded = completedBytes + inFlightLoaded;
      const overallPct = totalBytes ? (overallLoaded / totalBytes) * 100 : 0;
      const errorLabel = errorCount ? ` • Lỗi ${errorCount}` : "";
      setOverallProgress(
        overallPct,
        `Đang upload ${doneCount}/${list.length}${errorLabel} • ${inFlightCount} luồng • ${Math.round(
          overallPct
        )}% (${formatBytes(overallLoaded)}/${formatBytes(totalBytes)})`
      );
    };

    const finish = () => {
      const anyError = errorCount > 0 || items.some((item) => item.state === "queued");
      setOverallProgress(
        100,
        anyError
          ? "Có ảnh lỗi. Bạn có thể thay ảnh hoặc bấm Thử lại ở ảnh lỗi."
          : "Đã upload xong. Có thể bấm Lưu chương."
      );
      uploading = false;
      abortActive();
      input.disabled = false;
      refreshLabels();
      updateControls();
      scheduleAutoUpload();
      resolveDone();
    };

    const startNext = () => {
      while (inFlightCount < maxParallelUploads && nextIndex < list.length) {
        const item = list[nextIndex];
        nextIndex += 1;
        inFlightCount += 1;
        inFlight.set(item.id, 0);

        setItemState(item, "uploading");
        item.barEl.style.width = "0%";
        item.pctEl.textContent = "0%";
        updateOverall();

        uploadOne(item, (pct) => {
          inFlight.set(item.id, pct * item.bytes);
          updateOverall();
        })
          .then(() => {
            completedBytes += item.bytes;
            doneCount += 1;
            inFlight.delete(item.id);
            setItemState(item, "done");
          })
          .catch((err) => {
            completedBytes += item.bytes;
            errorCount += 1;
            inFlight.delete(item.id);
            setItemState(item, "error");
            setError((err && err.message) || "Upload thất bại.");
          })
          .finally(() => {
            inFlightCount -= 1;
            updateOverall();

            if (nextIndex >= list.length && inFlightCount === 0) {
              finish();
              return;
            }
            startNext();
          });
      }
    };

    setOverallProgress(0, `Đang upload ${list.length} ảnh (${maxParallelUploads} luồng)...`);
    updateOverall();
    startNext();
    return donePromise;
  };

  const addFiles = (files) => {
    if (uploading) return;
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;

    const next = list
      .slice()
      .sort((a, b) => collator.compare(a.name || "", b.name || ""));

    const remaining = Math.max(0, 220 - items.length);
    const picked = next.slice(0, remaining);
    if (picked.length < next.length) {
      setError("Tối đa 220 ảnh. Một số ảnh đã bị bỏ qua.");
    } else {
      setError("");
    }
    hideOverall();

    if (picked.length) {
      markTouched();
    }

    picked.forEach((file) => {
      const id = createRandomHex(12);
      const objectUrl = URL.createObjectURL(file);

      const item = {
        id,
        file,
        uploadFile: null,
        bytes: Number(file.size) || 0,
        objectUrl,
        state: "queued",
        el: null,
        imgEl: null,
        barEl: null,
        pctEl: null,
        stateEl: null,
        indexEl: null,
        progressEl: null,
        removeBtn: null
      };

      const tileEl = document.createElement("div");
      tileEl.className = "upload-tile";
      tileEl.dataset.pageId = id;
      tileEl.draggable = true;

      const img = document.createElement("img");
      img.className = "upload-tile__img";
      img.src = objectUrl;
      img.alt = "Ảnh trang";
      img.loading = "lazy";
      img.draggable = false;

      const stateEl = document.createElement("button");
      stateEl.type = "button";
      stateEl.className = "upload-tile__badge upload-tile__badge--status";
      stateEl.setAttribute("data-button-icon-skip", "1");
      stateEl.textContent = "Chờ";
      stateEl.title = "Bấm để thử lại khi ảnh bị lỗi";
      stateEl.addEventListener("click", (event) => {
        event.stopPropagation();
        if (uploading) return;
        if (item.state !== "error") return;
        setItemState(item, "queued");
        scheduleAutoUpload(80);
      });

      const indexEl = document.createElement("div");
      indexEl.className = "upload-tile__badge upload-tile__badge--index";
      indexEl.textContent = "---";

      const pctEl = document.createElement("div");
      pctEl.className = "upload-tile__badge upload-tile__badge--pct";
      pctEl.textContent = "0%";
      pctEl.hidden = true;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "upload-tile__remove";
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
      removeBtn.setAttribute("aria-label", "Xóa ảnh");
      removeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        removeItemById(id);
      });

      const progressEl = document.createElement("div");
      progressEl.className = "upload-tile__progress";
      progressEl.hidden = true;
      const bar = document.createElement("div");
      bar.className = "upload-tile__progress-fill";
      bar.style.width = "0%";
      progressEl.appendChild(bar);

      tileEl.append(img, stateEl, removeBtn, indexEl, pctEl, progressEl);

      tileEl.addEventListener("click", () => {
        if (uploading) return;
        if (!allowReplace && item.state !== "error") return;
        openReplacePicker(item);
      });

      tileEl.addEventListener("dragstart", (event) => {
        if (event.target && event.target.closest) {
          if (event.target.closest(".upload-tile__remove") || event.target.closest(".upload-tile__badge")) {
            event.preventDefault();
            return;
          }
        }

        draggingId = id;
        tileEl.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          try {
            event.dataTransfer.setData("text/plain", id);
          } catch (_err) {
            // ignore
          }
        }
      });

      tileEl.addEventListener("dragover", (event) => {
        if (!draggingId || draggingId === id) return;
        event.preventDefault();
        if (dragOverId && dragOverId !== id) {
          const prev = items.find((value) => value.id === dragOverId);
          if (prev && prev.el) {
            prev.el.classList.remove("is-dragover");
          }
        }
        dragOverId = id;
        tileEl.classList.add("is-dragover");
      });

      tileEl.addEventListener("dragleave", () => {
        tileEl.classList.remove("is-dragover");
        if (dragOverId === id) {
          dragOverId = "";
        }
      });

      tileEl.addEventListener("drop", (event) => {
        if (!draggingId) return;
        event.preventDefault();
        event.stopPropagation();

        const dragged = draggingId;
        const rect = tileEl.getBoundingClientRect();
        const placeAfter = event.clientX > rect.left + rect.width / 2;
        draggingId = "";
        moveItemById(dragged, id, placeAfter);
        clearDragState();
      });

      tileEl.addEventListener("dragend", () => {
        draggingId = "";
        clearDragState();
      });

      item.el = tileEl;
      item.imgEl = img;
      item.barEl = bar;
      item.pctEl = pctEl;
      item.stateEl = stateEl;
      item.indexEl = indexEl;
      item.progressEl = progressEl;
      item.removeBtn = removeBtn;

      items.push(item);
      queueEl.appendChild(tileEl);
      setItemState(item, "queued");
    });

    updateHiddenPages();
    refreshLabels();
    updateControls();
    scheduleAutoUpload();
  };

  const addInitialPages = (raw) => {
    if (uploading) return;
    const list = Array.isArray(raw) ? raw : [];
    if (!list.length) return;

    const seen = new Set(items.map((item) => item.id));
    const remaining = Math.max(0, 220 - items.length);
    const picked = list.slice(0, remaining);

    picked.forEach((entry) => {
      const id = entry && typeof entry.id === "string" ? entry.id.trim() : "";
      const url = entry && typeof entry.url === "string" ? entry.url.trim() : "";
      if (!id || !url) return;
      if (seen.has(id)) return;
      seen.add(id);

      const item = {
        id,
        file: null,
        uploadFile: null,
        bytes: 0,
        objectUrl: url,
        state: "done",
        el: null,
        imgEl: null,
        barEl: null,
        pctEl: null,
        stateEl: null,
        indexEl: null,
        progressEl: null,
        removeBtn: null
      };

      const tileEl = document.createElement("div");
      tileEl.className = "upload-tile";
      tileEl.dataset.pageId = id;
      tileEl.draggable = true;

      const img = document.createElement("img");
      img.className = "upload-tile__img";
      img.src = url;
      img.alt = "Ảnh trang";
      img.loading = "lazy";
      img.draggable = false;

      const stateEl = document.createElement("button");
      stateEl.type = "button";
      stateEl.className = "upload-tile__badge upload-tile__badge--status";
      stateEl.setAttribute("data-button-icon-skip", "1");
      stateEl.textContent = "Xong";
      stateEl.title = "Bấm để thử lại khi ảnh bị lỗi";
      stateEl.addEventListener("click", (event) => {
        event.stopPropagation();
        if (uploading) return;
        if (item.state !== "error") return;
        setItemState(item, "queued");
        scheduleAutoUpload(80);
      });

      const indexEl = document.createElement("div");
      indexEl.className = "upload-tile__badge upload-tile__badge--index";
      indexEl.textContent = "---";

      const pctEl = document.createElement("div");
      pctEl.className = "upload-tile__badge upload-tile__badge--pct";
      pctEl.textContent = "0%";
      pctEl.hidden = true;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "upload-tile__remove";
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
      removeBtn.setAttribute("aria-label", "Xóa ảnh");
      removeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        removeItemById(id);
      });

      const progressEl = document.createElement("div");
      progressEl.className = "upload-tile__progress";
      progressEl.hidden = true;
      const bar = document.createElement("div");
      bar.className = "upload-tile__progress-fill";
      bar.style.width = "0%";
      progressEl.appendChild(bar);

      tileEl.append(img, stateEl, removeBtn, indexEl, pctEl, progressEl);

      tileEl.addEventListener("click", () => {
        if (uploading) return;
        if (!allowReplace && item.state !== "error") return;
        openReplacePicker(item);
      });

      tileEl.addEventListener("dragstart", (event) => {
        if (event.target && event.target.closest) {
          if (event.target.closest(".upload-tile__remove") || event.target.closest(".upload-tile__badge")) {
            event.preventDefault();
            return;
          }
        }

        draggingId = id;
        tileEl.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          try {
            event.dataTransfer.setData("text/plain", id);
          } catch (_err) {
            // ignore
          }
        }
      });

      tileEl.addEventListener("dragover", (event) => {
        if (!draggingId || draggingId === id) return;
        event.preventDefault();
        if (dragOverId && dragOverId !== id) {
          const prev = items.find((value) => value.id === dragOverId);
          if (prev && prev.el) {
            prev.el.classList.remove("is-dragover");
          }
        }
        dragOverId = id;
        tileEl.classList.add("is-dragover");
      });

      tileEl.addEventListener("dragleave", () => {
        tileEl.classList.remove("is-dragover");
        if (dragOverId === id) {
          dragOverId = "";
        }
      });

      tileEl.addEventListener("drop", (event) => {
        if (!draggingId) return;
        event.preventDefault();
        event.stopPropagation();

        const dragged = draggingId;
        const rect = tileEl.getBoundingClientRect();
        const placeAfter = event.clientX > rect.left + rect.width / 2;
        draggingId = "";
        moveItemById(dragged, id, placeAfter);
        clearDragState();
      });

      tileEl.addEventListener("dragend", () => {
        draggingId = "";
        clearDragState();
      });

      item.el = tileEl;
      item.imgEl = img;
      item.barEl = bar;
      item.pctEl = pctEl;
      item.stateEl = stateEl;
      item.indexEl = indexEl;
      item.progressEl = progressEl;
      item.removeBtn = removeBtn;

      items.push(item);
      queueEl.appendChild(tileEl);
      setItemState(item, "done");
    });
  };

  const initialEl = form.querySelector("[data-chapter-initial-pages]");
  if (initialEl) {
    const parsed = parseJson(initialEl.textContent);
    if (Array.isArray(parsed)) {
      addInitialPages(parsed);
    }
  }

  input.addEventListener("change", () => {
    addFiles(input.files);
    input.value = "";
  });

  const setHover = (value) => {
    dropZone.classList.toggle("is-dragover", Boolean(value));
  };

  dropZone.addEventListener("dragenter", (event) => {
    if (uploading) return;
    event.preventDefault();
    setHover(true);
  });

  dropZone.addEventListener("dragover", (event) => {
    if (uploading) return;
    event.preventDefault();
    setHover(true);
  });

  dropZone.addEventListener("dragleave", () => {
    setHover(false);
  });

  dropZone.addEventListener("drop", (event) => {
    if (uploading) return;
    event.preventDefault();
    setHover(false);
    const dropped = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
    addFiles(dropped);
  });

  form.addEventListener("submit", (event) => {
    if (!validateChapterNumber()) {
      event.preventDefault();
      if (numberInput && typeof numberInput.reportValidity === "function") {
        numberInput.reportValidity();
      }
      if (numberInput) {
        numberInput.focus();
      }
      return;
    }

    const hasItems = items.length > 0;
    const allDone = hasItems && items.every((item) => item.state === "done");
    if (!hasItems) {
      event.preventDefault();
      setError("Chưa chọn ảnh trang.");
      return;
    }
    if (!allDone) {
      event.preventDefault();
      setError("Bạn cần upload xong tất cả ảnh trước khi lưu chương.");
    }
  });

  updateHiddenPages();
  refreshLabels();
  updateControls();
})();

(() => {
  const wrapper = document.querySelector("[data-description-wrap]");
  if (!wrapper) return;
  const content = wrapper.querySelector("[data-description-content]");
  const toggle = wrapper.querySelector("[data-description-toggle]");
  if (!content || !toggle) return;

  const fullText = (content.textContent || "").replace(/\s+/g, " ").trim();
  if (!fullText) {
    toggle.hidden = true;
    toggle.removeAttribute("aria-expanded");
    return;
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
    const lastSpace = slice.lastIndexOf(" ");
    const cut = lastSpace > Math.floor(max * 0.6) ? slice.slice(0, lastSpace).trimEnd() : slice;
    return { text: cut, truncated: true };
  };

  const setState = (expanded) => {
    wrapper.classList.toggle("is-expanded", expanded);
    wrapper.classList.toggle("is-collapsed", !expanded);
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.textContent = expanded ? "Thu gọn" : "Xem thêm";
  };

  const collapse = () => {
    const max = getMax();
    const result = truncate(fullText, max);
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

  window.addEventListener("resize", () => {
    if (wrapper.classList.contains("is-expanded")) return;
    collapse();
  });

  window.requestAnimationFrame(() => {
    collapse();
  });
})();

(() => {
  const root = document.querySelector("[data-chapters-admin-root]");
  if (!root) return;

  const selectAll = root.querySelector("[data-chapters-select-all]");
  const selectedCountEl = root.querySelector("[data-chapters-selected-count]");
  const bulkDeleteBtn = root.querySelector("[data-chapters-bulk-delete]");

  if (!selectAll || !selectedCountEl || !bulkDeleteBtn) return;

  const getRowCheckboxes = () =>
    Array.from(root.querySelectorAll("[data-chapter-select]"))
      .filter((el) => el instanceof HTMLInputElement);

  const syncSelectionState = () => {
    const checkboxes = getRowCheckboxes();
    const enabled = checkboxes.filter((input) => !input.disabled);
    const selected = enabled.filter((input) => input.checked);

    selectedCountEl.textContent = `${selected.length} đã chọn`;
    bulkDeleteBtn.disabled = selected.length === 0;

    if (!enabled.length) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      selectAll.disabled = true;
      return;
    }

    selectAll.disabled = false;
    selectAll.checked = selected.length === enabled.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < enabled.length;
  };

  selectAll.addEventListener("change", () => {
    const checkboxes = getRowCheckboxes();
    checkboxes.forEach((input) => {
      if (input.disabled) return;
      input.checked = selectAll.checked;
    });
    syncSelectionState();
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.matches("[data-chapter-select]")) return;
    syncSelectionState();
  });

  syncSelectionState();
})();

(() => {
  const table = document.querySelector("[data-admin-chapters]");
  if (!table) return;

  const statusUrl = (table.dataset.statusUrl || "").toString().trim();
  if (!statusUrl) return;

  const rows = Array.from(table.querySelectorAll("[data-chapter-row]"));
  if (!rows.length) return;

  const rowById = new Map();
  rows.forEach((row) => {
    const id = Number(row.dataset.chapterId);
    if (!Number.isFinite(id) || id <= 0) return;
    rowById.set(Math.floor(id), row);
  });

  const getPendingIds = () => {
    const pending = [];
    rowById.forEach((row, id) => {
      const state = (row.dataset.processingState || "").toString().trim();
      if (state === "processing") {
        pending.push(id);
      }
    });
    return pending;
  };

  const setChip = (chipEl, kind, text) => {
    if (!chipEl) return;
    const label = (text || "").toString().trim();
    if (!label) {
      chipEl.hidden = true;
      chipEl.textContent = "";
      chipEl.classList.remove("chip--processing", "chip--warn", "chip--ok");
      return;
    }

    chipEl.hidden = false;
    chipEl.textContent = label;
    chipEl.classList.remove("chip--processing", "chip--warn", "chip--ok");
    if (kind) {
      chipEl.classList.add(kind);
    }
  };

  const normalizeProgressValue = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
  };

  const formatProcessingChipLabel = ({ donePages, totalPages, percent }) => {
    const safeTotal = normalizeProgressValue(totalPages);
    if (safeTotal <= 0) return "Đang xử lý";

    const safeDone = Math.min(normalizeProgressValue(donePages), safeTotal);
    let safePercent = Number(percent);
    if (!Number.isFinite(safePercent) || safePercent < 0) {
      safePercent = Math.floor((safeDone / safeTotal) * 100);
    }
    safePercent = Math.min(100, Math.max(0, Math.floor(safePercent)));
    return `Đang xử lý ${safeDone}/${safeTotal} (${safePercent}%)`;
  };

  const updateRow = ({
    id,
    processingState,
    processingError,
    processingDonePages,
    processingTotalPages,
    processingPercent
  }) => {
    const row = rowById.get(id);
    if (!row) return;

    const nextState = (processingState || "").toString().trim();
    const nextError = (processingError || "").toString().trim();
    const nextDonePages = normalizeProgressValue(
      processingDonePages != null ? processingDonePages : row.dataset.processingDonePages
    );
    const nextTotalPages = normalizeProgressValue(
      processingTotalPages != null ? processingTotalPages : row.dataset.processingTotalPages
    );
    const nextPercent = Number.isFinite(Number(processingPercent))
      ? Math.floor(Number(processingPercent))
      : nextTotalPages > 0
        ? Math.floor((Math.min(nextDonePages, nextTotalPages) / nextTotalPages) * 100)
        : 0;
    const prevState = (row.dataset.processingState || "").toString().trim();
    row.dataset.processingState = nextState;
    row.dataset.processingDonePages = String(nextDonePages);
    row.dataset.processingTotalPages = String(nextTotalPages);

    const chipEl = row.querySelector("[data-processing-chip]");
    const errorEl = row.querySelector("[data-processing-error]");
    const pagesLink = row.querySelector("[data-action-pages-link]");
    const placeholder = row.querySelector("[data-action-processing-placeholder]");
    const retryForm = row.querySelector("[data-action-retry]");

    if (nextState === "processing") {
      setChip(chipEl, "chip--processing", formatProcessingChipLabel({
        donePages: nextDonePages,
        totalPages: nextTotalPages,
        percent: nextPercent
      }));
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = "";
      }
      if (pagesLink) pagesLink.hidden = true;
      if (placeholder) placeholder.hidden = false;
      if (retryForm) retryForm.hidden = true;
      return;
    }

    if (nextState === "failed") {
      setChip(chipEl, "chip--warn", "Lỗi xử lý");
      if (errorEl) {
        if (nextError) {
          errorEl.hidden = false;
          errorEl.textContent = `Lỗi: ${nextError}`;
        } else {
          errorEl.hidden = true;
          errorEl.textContent = "";
        }
      }
      if (pagesLink) pagesLink.hidden = false;
      if (placeholder) placeholder.hidden = true;
      if (retryForm) retryForm.hidden = false;
      return;
    }

    // Done
    if (pagesLink) pagesLink.hidden = false;
    if (placeholder) placeholder.hidden = true;
    if (retryForm) retryForm.hidden = true;
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }

    if (prevState === "processing") {
      setChip(chipEl, "chip--ok", "Hoàn thành");
      window.setTimeout(() => {
        const current = (row.dataset.processingState || "").toString().trim();
        if (current) return;
        setChip(chipEl, "", "");
      }, 6000);
    } else {
      setChip(chipEl, "", "");
    }
  };

  let pollingTimer = null;
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      const ids = getPendingIds();
      if (!ids.length) return;

      const url = `${statusUrl}?ids=${encodeURIComponent(ids.join(","))}`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !data.ok || !Array.isArray(data.chapters)) {
        return;
      }

      data.chapters.forEach((item) => {
        if (!item || !item.id) return;
        updateRow({
          id: Number(item.id),
          processingState: item.processingState,
          processingError: item.processingError,
          processingDonePages: item.processingDonePages,
          processingTotalPages: item.processingTotalPages,
          processingPercent: item.processingPercent
        });
      });
    } catch (_err) {
      // ignore
    } finally {
      polling = false;

      if (pollingTimer) {
        window.clearTimeout(pollingTimer);
      }

      if (getPendingIds().length) {
        pollingTimer = window.setTimeout(poll, 2000);
      }
    }
  };

  if (getPendingIds().length) {
    poll();
  }
})();

(() => {
  const facebook = document.querySelector("[data-share-facebook]");
  const instagram = document.querySelector("[data-share-instagram]");
  if (!facebook && !instagram) return;

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
        // ignore
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

  if (facebook) {
    facebook.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getUrl())}`;
    facebook.target = "_blank";
    facebook.rel = "noopener";
  }

  if (instagram) {
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
    instagram.addEventListener("click", async () => {
      const url = getUrl();
      const title = getTitle();

      if (navigator.share) {
        try {
          await navigator.share({ title, url });
          return;
        } catch (_err) {
          // user cancelled or share failed
        }
      }

      const copied = await copyText(url);
      setLabel(copied ? "Đã copy link" : "Không copy được");
      window.setTimeout(() => {
        setLabel(original);
      }, 1400);
    });
  }
})();

(() => {
  const form = document.querySelector("[data-manga-filter-form]");
  if (!form) return;

  const input = form.querySelector("[data-manga-filter-input]");
  const clearBtn = form.querySelector("[data-manga-filter-clear]");
  const tbody = document.querySelector("[data-manga-table-body]");
  const resultCountEl = document.querySelector("[data-manga-result-count]");
  if (!input || !clearBtn || !tbody) return;

  const table = tbody.closest("table");
  const actionHeaderCell = table ? table.querySelector("[data-manga-th-actions]") : null;
  const actionCol = table ? table.querySelector("[data-manga-col-actions]") : null;

  const readFlag = (value, fallback = false) => {
    if (value == null) return Boolean(fallback);
    const raw = String(value).trim().toLowerCase();
    if (!raw) return Boolean(fallback);
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  };

  const readColumnCount = (value, fallback) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
    return Math.max(1, Number(fallback) || 5);
  };

  let permissionState = {
    canEditManga: readFlag(form.dataset.canEditManga, true),
    canDeleteManga: readFlag(form.dataset.canDeleteManga, true),
    canManageAnyChapter: readFlag(form.dataset.canManageAnyChapter, true),
    showMangaActions: readFlag(form.dataset.showMangaActions, true),
    columnCount: 5
  };
  permissionState.columnCount = readColumnCount(
    form.dataset.mangaColumnCount,
    permissionState.showMangaActions ? 5 : 4
  );

  const syncActionColumnVisibility = () => {
    const shouldShowActions = Boolean(permissionState.showMangaActions);
    if (actionHeaderCell) {
      actionHeaderCell.hidden = !shouldShowActions;
    }
    if (actionCol) {
      actionCol.hidden = !shouldShowActions;
    }
  };

  const updatePermissionStateFromResponse = (data) => {
    const responseScope = data && data.teamManageScope && typeof data.teamManageScope === "object"
      ? data.teamManageScope
      : null;
    const responsePermissions = data && data.teamManagePermissions && typeof data.teamManagePermissions === "object"
      ? data.teamManagePermissions
      : null;

    if (!responseScope) {
      permissionState = {
        canEditManga: true,
        canDeleteManga: true,
        canManageAnyChapter: true,
        showMangaActions: true,
        columnCount: 5
      };
      syncActionColumnVisibility();
      return;
    }

    const canEditManga = Boolean(responsePermissions && responsePermissions.canEditManga);
    const canDeleteManga = Boolean(responsePermissions && responsePermissions.canDeleteManga);
    const canAddChapter = Boolean(responsePermissions && responsePermissions.canAddChapter);
    const canEditChapter = Boolean(responsePermissions && responsePermissions.canEditChapter);
    const canDeleteChapter = Boolean(responsePermissions && responsePermissions.canDeleteChapter);
    const canManageAnyChapter = canAddChapter || canEditChapter || canDeleteChapter;
    const showMangaActions = canManageAnyChapter || canEditManga || canDeleteManga;

    permissionState = {
      canEditManga,
      canDeleteManga,
      canManageAnyChapter,
      showMangaActions,
      columnCount: showMangaActions ? 5 : 4
    };

    syncActionColumnVisibility();
  };

  const setClearVisibility = () => {
    clearBtn.hidden = !input.value.trim();
  };

  const buildParams = () => {
    const data = new FormData(form);
    const params = new URLSearchParams();

    for (const [key, value] of data.entries()) {
      const text = typeof value === "string" ? value.trim() : "";
      if (!text) continue;
      params.append(key, text);
    }

    return params;
  };

  const setUrlFromParams = (params) => {
    const url = new URL(window.location.href);
    url.search = params.toString();
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const createTextRow = (text) => {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = permissionState.columnCount;
    td.textContent = text;
    tr.appendChild(td);
    return tr;
  };

  const createMangaRow = (manga) => {
    const id = Number(manga && manga.id);
    if (!Number.isFinite(id) || id <= 0) return null;

    const title = (manga.title || "").toString();
    const author = (manga.author || "").toString();
    const groupName = (manga.groupName || "").toString();
    const status = (manga.status || "").toString();
    const updatedAt = (manga.updatedAtFormatted || "").toString();
    const chapterCount = Number(manga.chapterCount) || 0;
    const isHidden = Boolean(manga.isHidden);

    const tr = document.createElement("tr");

    const tdTitle = document.createElement("td");
    tdTitle.dataset.label = "Truyện";
    const strong = document.createElement("strong");
    strong.textContent = title;

    if (permissionState.canEditManga) {
      const titleLink = document.createElement("a");
      titleLink.className = "admin-manga-link";
      titleLink.href = `/admin/manga/${id}/edit`;
      titleLink.appendChild(strong);
      tdTitle.appendChild(titleLink);
    } else {
      tdTitle.appendChild(strong);
    }

    const authorEl = document.createElement("span");
    authorEl.className = "admin-sub";
    authorEl.textContent = groupName.trim() ? groupName : author;
    tdTitle.appendChild(authorEl);

    if (isHidden) {
      const hiddenChip = document.createElement("span");
      hiddenChip.className = "chip chip--warn";
      hiddenChip.textContent = "Đang ẩn";
      tdTitle.appendChild(hiddenChip);
    }

    const tdStatus = document.createElement("td");
    tdStatus.dataset.label = "Trạng thái";
    const statusTag = document.createElement("span");
    statusTag.className = "tag";
    statusTag.textContent = status;
    tdStatus.appendChild(statusTag);

    const tdChapters = document.createElement("td");
    tdChapters.dataset.label = "Số chương";

    const chapterChip = document.createElement("span");
    chapterChip.className = "chip";
    chapterChip.textContent = String(chapterCount);
    tdChapters.appendChild(chapterChip);

    const tdUpdated = document.createElement("td");
    tdUpdated.dataset.label = "Cập nhật";
    tdUpdated.textContent = updatedAt;

    tr.appendChild(tdTitle);
    tr.appendChild(tdStatus);
    tr.appendChild(tdChapters);
    tr.appendChild(tdUpdated);

    if (permissionState.showMangaActions) {
      const tdActions = document.createElement("td");
      tdActions.className = "admin-cell-actions";
      tdActions.dataset.label = "Hành động";

      const actions = document.createElement("div");
      actions.className = "admin-actions";

      if (permissionState.canManageAnyChapter) {
        const chapterManageLink = document.createElement("a");
        chapterManageLink.className = "button button--ghost";
        chapterManageLink.href = `/admin/manga/${id}/chapters`;
        chapterManageLink.title = "Quản lý chương";
        chapterManageLink.setAttribute("aria-label", `Quản lý chương của truyện ${title}`);
        chapterManageLink.textContent = "QL Chương";
        actions.appendChild(chapterManageLink);
      }

      if (permissionState.canEditManga) {
        const visibilityForm = document.createElement("form");
        visibilityForm.method = "post";
        visibilityForm.action = `/admin/manga/${id}/visibility`;
        visibilityForm.dataset.confirmAction = isHidden ? "show-manga" : "hide-manga";
        visibilityForm.dataset.mangaId = String(id);
        visibilityForm.dataset.mangaTitle = title;
        visibilityForm.dataset.mangaChapters = String(chapterCount);
        visibilityForm.dataset.mangaHidden = isHidden ? "1" : "0";

        const hiddenInput = document.createElement("input");
        hiddenInput.type = "hidden";
        hiddenInput.name = "hidden";
        hiddenInput.value = isHidden ? "0" : "1";

        const visibilityBtn = document.createElement("button");
        visibilityBtn.className = "button button--ghost";
        visibilityBtn.type = "submit";
        visibilityBtn.textContent = isHidden ? "Hiện" : "Ẩn";

        visibilityForm.appendChild(hiddenInput);
        visibilityForm.appendChild(visibilityBtn);
        actions.appendChild(visibilityForm);
      }

      if (permissionState.canDeleteManga) {
        const deleteForm = document.createElement("form");
        deleteForm.method = "post";
        deleteForm.action = `/admin/manga/${id}/delete`;
        deleteForm.dataset.confirmAction = "delete-manga";
        deleteForm.dataset.mangaId = String(id);
        deleteForm.dataset.mangaTitle = title;
        deleteForm.dataset.mangaChapters = String(chapterCount);
        deleteForm.dataset.mangaHidden = isHidden ? "1" : "0";

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "button button--ghost button--danger";
        deleteBtn.type = "submit";
        deleteBtn.textContent = "Xóa";

        deleteForm.appendChild(deleteBtn);
        actions.appendChild(deleteForm);
      }

      if (!permissionState.canEditManga && !permissionState.canDeleteManga) {
        const noPermissionNote = document.createElement("span");
        noPermissionNote.className = "note";
        noPermissionNote.textContent = "Không có quyền thao tác";
        actions.appendChild(noPermissionNote);
      }

      tdActions.appendChild(actions);
      tr.appendChild(tdActions);
    }

    return tr;
  };

  const renderManga = (items) => {
    tbody.innerHTML = "";

    const hasFilters = Boolean(
      input.value.trim() ||
        form.querySelector("input[name=\"include\"], input[name=\"exclude\"]")
    );

    if (!Array.isArray(items) || items.length === 0) {
      tbody.appendChild(createTextRow(hasFilters ? "Không có truyện phù hợp." : "Chưa có truyện."));
      return;
    }

    items.forEach((manga) => {
      const row = createMangaRow(manga);
      if (row) tbody.appendChild(row);
    });
  };

  let debounceTimer = null;
  let controller = null;
  let fetchToken = 0;
  let mangaInputComposing = false;

  const fetchManga = async () => {
    const requestToken = ++fetchToken;
    if (controller) {
      controller.abort();
    }
    controller = new AbortController();

    const params = buildParams();
    const paramsSnapshot = params.toString();
    setUrlFromParams(params);

    const url = new URL(form.action, window.location.origin);
    url.search = params.toString();

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (requestToken !== fetchToken) {
      return;
    }
    if (buildParams().toString() !== paramsSnapshot) {
      return;
    }
    updatePermissionStateFromResponse(data);
    renderManga(data && data.manga ? data.manga : []);
    if (resultCountEl) {
      const count = data && typeof data.resultCount === "number" ? data.resultCount : null;
      resultCountEl.textContent = String(count != null ? count : (data.manga || []).length);
    }
  };

  const runFetch = async () => {
    setClearVisibility();
    try {
      await fetchManga();
    } catch (error) {
      if (error && error.name === "AbortError") return;
      console.error(error);
    }
  };

  const scheduleFetch = () => {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      runFetch();
    }, 450);
  };

  input.addEventListener("compositionstart", () => {
    mangaInputComposing = true;
  });

  input.addEventListener("compositionend", () => {
    mangaInputComposing = false;
    setClearVisibility();
    scheduleFetch();
  });

  input.addEventListener("input", () => {
    if (mangaInputComposing) return;
    setClearVisibility();
    scheduleFetch();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      runFetch();
      input.focus();
    }
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    runFetch();
    input.focus();
  });

  form.addEventListener("click", (event) => {
    const toggle = event.target.closest(".filter-option--toggle");
    if (!toggle) return;
    scheduleFetch();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runFetch();
  });

  setClearVisibility();
  syncActionColumnVisibility();
})();
