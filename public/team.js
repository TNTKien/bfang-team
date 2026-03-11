(() => {
  const page = document.querySelector(".team-profile");
  if (!page) return;

  const parseMetaItems = (rawValue) =>
    (rawValue || "")
      .toString()
      .split("|")
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 6);

  const requestConfirm = async (payload) => {
    if (window.BfangConfirm && typeof window.BfangConfirm.confirm === "function") {
      return window.BfangConfirm.confirm(payload);
    }
    return window.confirm(payload.fallbackText || payload.body || "Bạn có chắc muốn thực hiện thao tác này?");
  };

  const tabRoot = page.querySelector("[data-team-tabs]");
  const tabTriggers = tabRoot ? Array.from(tabRoot.querySelectorAll("[data-team-tab-trigger]")) : [];
  const tabPanels = Array.from(page.querySelectorAll("[data-team-tab-panel]"));

  const isValidTab = (value) =>
    value === "overview" || value === "series" || value === "notifications" || value === "members";

  const setActiveTab = (nextTab) => {
    const tab = isValidTab(nextTab) ? nextTab : "overview";
    tabTriggers.forEach((trigger) => {
      const key = (trigger.getAttribute("data-team-tab-trigger") || "").toString().trim().toLowerCase();
      const isActive = key === tab;
      trigger.classList.toggle("is-active", isActive);
      trigger.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    tabPanels.forEach((panel) => {
      const key = (panel.getAttribute("data-team-tab-panel") || "").toString().trim().toLowerCase();
      const isActive = key === tab;
      panel.hidden = !isActive;
      panel.classList.toggle("is-active", isActive);
    });

    page.setAttribute("data-team-active-tab", tab);
  };

  if (tabTriggers.length && tabPanels.length) {
    tabTriggers.forEach((trigger) => {
      trigger.addEventListener("click", () => {
        const key = (trigger.getAttribute("data-team-tab-trigger") || "").toString().trim().toLowerCase();
        if (!isValidTab(key)) return;
        setActiveTab(key);
      });
    });

    page.querySelectorAll("[data-team-tab-jump]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = (button.getAttribute("data-team-tab-jump") || "").toString().trim().toLowerCase();
        if (!isValidTab(key)) return;
        setActiveTab(key);
      });
    });

    const initialTabFromData = (page.getAttribute("data-team-active-tab") || "").toString().trim().toLowerCase();
    setActiveTab(initialTabFromData || "overview");
  }

  const editDialog = document.querySelector("[data-team-edit-dialog]");
  if (editDialog) {
    const openButton = page.querySelector("[data-team-edit-open]");
    const closeButton = editDialog.querySelector("[data-team-edit-close]");
    const nameInput = editDialog.querySelector("[data-team-edit-name]");
    const slugInput = editDialog.querySelector("[data-team-edit-slug]");

    const syncDialogScrollLock = () => {
      document.body.classList.toggle("team-edit-modal-open", Boolean(editDialog.open));
    };
    syncDialogScrollLock();

    const teamSlugify = (value) => {
      const base = (value || "")
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      return base.slice(0, 60) || "team";
    };

    const syncSlugPreview = () => {
      if (!nameInput || !slugInput) return;
      slugInput.value = teamSlugify(nameInput.value || "");
    };

    if (nameInput && slugInput) {
      nameInput.addEventListener("input", syncSlugPreview);
    }

    if (openButton) {
      openButton.addEventListener("click", () => {
        if (typeof editDialog.showModal === "function") {
          syncSlugPreview();
          editDialog.showModal();
          syncDialogScrollLock();
        }
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", () => {
        if (editDialog.open) editDialog.close();
      });
    }

    editDialog.addEventListener("close", syncDialogScrollLock);
  }

  const mediaFormRoot = editDialog || page;
  const teamMediaForm = mediaFormRoot.querySelector("[data-team-media-form]");
  if (teamMediaForm) {
    const mediaSubmitButton = teamMediaForm.querySelector("[data-team-media-submit]");
    const uploadWidgets = Array.from(teamMediaForm.querySelectorAll("[data-team-upload-widget]"));
    const defaultFileLabel = "Chưa chọn tệp nào.";

    const hasAnyPickedFile = () =>
      uploadWidgets.some((widget) => {
        const input = widget.querySelector("[data-team-upload-input]");
        return Boolean(input && input.files && input.files[0]);
      });

    const syncSubmitState = () => {
      if (!(mediaSubmitButton instanceof HTMLButtonElement)) return;
      mediaSubmitButton.disabled = !hasAnyPickedFile();
    };

    uploadWidgets.forEach((widget) => {
      const input = widget.querySelector("[data-team-upload-input]");
      const previewWrap = widget.querySelector("[data-team-upload-preview-wrap]");
      const preview = widget.querySelector("[data-team-upload-preview]");
      const placeholder = widget.querySelector("[data-team-upload-placeholder]");
      const fileNameNode = widget.querySelector("[data-team-upload-filename]");
      if (!input || !previewWrap || !preview) return;

      const initialPreviewSrc = (preview.getAttribute("src") || "").toString().trim();
      const hasInitialPreview = Boolean(initialPreviewSrc && !preview.hidden);
      let objectUrl = "";

      const clearObjectUrl = () => {
        if (!objectUrl) return;
        URL.revokeObjectURL(objectUrl);
        objectUrl = "";
      };

      const setFileNameText = (text) => {
        if (!fileNameNode) return;
        fileNameNode.textContent = (text || "").toString().trim() || defaultFileLabel;
      };

      const resetPreview = () => {
        clearObjectUrl();
        if (hasInitialPreview) {
          preview.src = initialPreviewSrc;
          preview.hidden = false;
          if (placeholder) placeholder.hidden = true;
          return;
        }

        preview.src = "";
        preview.hidden = true;
        if (placeholder) placeholder.hidden = false;
      };

      setFileNameText(defaultFileLabel);
      resetPreview();

      input.addEventListener("change", () => {
        const file = input.files && input.files[0] ? input.files[0] : null;
        if (!file) {
          resetPreview();
          setFileNameText(defaultFileLabel);
          syncSubmitState();
          return;
        }

        clearObjectUrl();
        objectUrl = URL.createObjectURL(file);
        preview.src = objectUrl;
        preview.hidden = false;
        if (placeholder) {
          placeholder.hidden = true;
        }
        setFileNameText(`Đã chọn: ${file.name}`);
        syncSubmitState();
      });

      previewWrap.addEventListener("click", () => {
        if (input.disabled) return;
        input.click();
      });

      previewWrap.addEventListener("keydown", (event) => {
        if (!event || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        if (input.disabled) return;
        input.click();
      });

      window.addEventListener("beforeunload", clearObjectUrl);
    });

    teamMediaForm.addEventListener("submit", (event) => {
      if (hasAnyPickedFile()) return;
      event.preventDefault();
      syncSubmitState();
    });

    syncSubmitState();
  }

  const actionWrappers = Array.from(page.querySelectorAll("[data-team-member-actions]"));

  const closeAllMenus = (exceptWrapper = null) => {
    actionWrappers.forEach((wrapper) => {
      if (!wrapper || wrapper === exceptWrapper || typeof wrapper.__setMenuOpen !== "function") return;
      wrapper.__setMenuOpen(false);
    });
  };

  actionWrappers.forEach((wrapper) => {
    const trigger = wrapper.querySelector("[data-team-member-menu-trigger]");
    const menu = wrapper.querySelector("[data-team-member-menu]");
    if (!trigger || !menu) return;

    const setMenuOpen = (open) => {
      const nextOpen = Boolean(open);
      menu.hidden = !nextOpen;
      trigger.setAttribute("aria-expanded", nextOpen ? "true" : "false");
      wrapper.classList.toggle("is-open", nextOpen);
    };

    wrapper.__setMenuOpen = setMenuOpen;
    setMenuOpen(false);

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shouldOpen = menu.hidden;
      closeAllMenus(wrapper);
      setMenuOpen(shouldOpen);
    });
  });

  document.addEventListener("click", (event) => {
    const target = event && event.target ? event.target : null;
    if (target && target.closest("[data-team-member-actions]")) return;
    closeAllMenus();
  });

  document.addEventListener("keydown", (event) => {
    if (!event || event.key !== "Escape") return;
    closeAllMenus();
  });

  const TEAM_PERMISSION_KEYS = [
    "canAddManga",
    "canEditManga",
    "canDeleteManga",
    "canAddChapter",
    "canEditChapter",
    "canDeleteChapter"
  ];

  const TEAM_PERMISSION_GROUPS = {
    manga: ["canAddManga", "canEditManga", "canDeleteManga"],
    chapter: ["canAddChapter", "canEditChapter", "canDeleteChapter"]
  };

  const permissionEditors = Array.from(page.querySelectorAll("[data-team-permission-editor]"));

  const readPermissionState = (editor) => {
    const state = {};
    TEAM_PERMISSION_KEYS.forEach((key) => {
      const input = editor.querySelector(`input[data-team-permission="${key}"]`);
      state[key] = Boolean(input && input.checked);
    });
    return state;
  };

  const applyPermissionState = (editor, state) => {
    if (!state || typeof state !== "object") return;
    TEAM_PERMISSION_KEYS.forEach((key) => {
      const input = editor.querySelector(`input[data-team-permission="${key}"]`);
      if (!input) return;
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        input.checked = Boolean(state[key]);
      }
    });
    Object.entries(TEAM_PERMISSION_GROUPS).forEach(([groupKey, keys]) => {
      const groupInput = editor.querySelector(`input[data-team-permission-group="${groupKey}"]`);
      if (!groupInput) return;
      const enabledCount = keys.reduce((count, permissionKey) => {
        const permissionInput = editor.querySelector(`input[data-team-permission="${permissionKey}"]`);
        return count + (permissionInput && permissionInput.checked ? 1 : 0);
      }, 0);
      const hasAll = enabledCount === keys.length;
      groupInput.checked = hasAll;
      groupInput.indeterminate = enabledCount > 0 && !hasAll;
    });
  };

  const setPermissionGroupState = (editor, groupKey, enabled) => {
    const keys = TEAM_PERMISSION_GROUPS[groupKey];
    if (!Array.isArray(keys) || !keys.length) return;
    keys.forEach((key) => {
      const input = editor.querySelector(`input[data-team-permission="${key}"]`);
      if (!input) return;
      input.checked = Boolean(enabled);
    });
  };

  const setPermissionStatus = (editor, tone, text) => {
    const statusNode = editor.querySelector("[data-team-permission-status]");
    if (!statusNode) return;
    statusNode.classList.remove("is-success", "is-error");
    if (!text) {
      statusNode.hidden = true;
      statusNode.textContent = "";
      return;
    }
    statusNode.hidden = false;
    statusNode.textContent = text;
    if (tone === "success" || tone === "error") {
      statusNode.classList.add(`is-${tone}`);
    }
  };

  permissionEditors.forEach((editor) => {
    const endpoint = (editor.getAttribute("data-permission-endpoint") || "").toString().trim();
    if (!endpoint) return;

    applyPermissionState(editor, readPermissionState(editor));

    editor.addEventListener("change", async (event) => {
      const target = event && event.target ? event.target : null;
      if (!target) return;
      const isPermissionInput = target.matches("input[data-team-permission]");
      const isGroupInput = target.matches("input[data-team-permission-group]");
      if (!isPermissionInput && !isGroupInput) return;
      if (editor.dataset.loading === "1") return;

      const previousState = readPermissionState(editor);

      if (isGroupInput) {
        const groupKey = (target.getAttribute("data-team-permission-group") || "").toString().trim();
        setPermissionGroupState(editor, groupKey, target.checked);
      }

      const payload = readPermissionState(editor);

      editor.dataset.loading = "1";
      setPermissionStatus(editor, "", "");

      try {
        const response = await window.fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest"
          },
          body: JSON.stringify(payload)
        });

        let data = null;
        try {
          data = await response.json();
        } catch (_err) {
          data = null;
        }

        if (!response.ok || !data || data.ok !== true) {
          const message = data && data.error ? String(data.error).trim() : "Không thể cập nhật phân quyền.";
          throw new Error(message || "Không thể cập nhật phân quyền.");
        }

        const nextPermissions = data && data.member && data.member.permissions ? data.member.permissions : null;
        if (nextPermissions && typeof nextPermissions === "object") {
          applyPermissionState(editor, nextPermissions);
        }

        setPermissionStatus(editor, "success", "Đã cập nhật quyền.");
      } catch (err) {
        applyPermissionState(editor, previousState);
        const message = err && err.message ? err.message : "Không thể cập nhật phân quyền.";
        setPermissionStatus(editor, "error", message);
      } finally {
        delete editor.dataset.loading;
      }
    });
  });

  page.querySelectorAll("[data-team-confirm-form]").forEach((form) => {
    if (!form || form.dataset.confirmBound === "1") return;
    form.dataset.confirmBound = "1";

    form.addEventListener("submit", async (event) => {
      if (form.dataset.confirmSubmitting === "1") return;
      event.preventDefault();
      closeAllMenus();

      const title = (form.getAttribute("data-confirm-title") || "Xác nhận thao tác").toString().trim();
      const body =
        (form.getAttribute("data-confirm-body") || "Bạn có chắc muốn thực hiện thao tác này?")
          .toString()
          .trim();
      const confirmText = (form.getAttribute("data-confirm-text") || "Xác nhận").toString().trim();
      const confirmVariant = (form.getAttribute("data-confirm-variant") || "default").toString().trim();
      const metaItems = parseMetaItems(form.getAttribute("data-confirm-meta") || "");

      const ok = await requestConfirm({
        title,
        body,
        confirmText,
        confirmVariant,
        metaItems,
        fallbackText: body
      }).catch(() => false);

      if (!ok) return;

      form.dataset.confirmSubmitting = "1";
      form.submit();
    });
  });
})();
