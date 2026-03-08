(() => {
  const page = document.querySelector("[data-account-page]");
  if (!page) return;

  const locked = page.querySelector("[data-account-locked]");
  const form = page.querySelector("[data-account-form]");
  const headActions = page.querySelector("[data-account-head-actions]");
  const statusEl = page.querySelector("[data-account-status]");

  const nameInput = page.querySelector("[data-account-name]");
  const previewNameEl = page.querySelector("[data-account-preview-name]");
  const usernameEls = page.querySelectorAll("[data-account-username]");
  const emailEls = page.querySelectorAll("[data-account-email]");
  const joinedEls = page.querySelectorAll("[data-account-joined]");
  const facebookInput = page.querySelector("[data-account-facebook]");
  const discordInput = page.querySelector("[data-account-discord]");
  const bioInput = page.querySelector("[data-account-bio]");
  const bioCounterEl = page.querySelector("[data-account-bio-counter]");

  const avatarPreviewWrap = page.querySelector("[data-avatar-preview-wrap]");
  const avatarPreviewImg = page.querySelector("[data-account-avatar-preview]");
  const avatarFileInput = page.querySelector("[data-account-avatar-file]");
  const avatarErrorEl = page.querySelector("[data-avatar-error]");

  const overlayEl = page.querySelector("[data-avatar-overlay]");
  const overlayBarEl = page.querySelector("[data-avatar-overlay-bar]");
  const overlayTextEl = page.querySelector("[data-avatar-overlay-text]");

  const resetBtn = page.querySelector("[data-account-reset]");
  const saveBtn = page.querySelector("[data-account-save]");

  const apiKeySummaryEl = page.querySelector("[data-account-api-summary]");
  const apiKeyPrefixEl = page.querySelector("[data-account-api-prefix]");
  const apiKeyCreatedEl = page.querySelector("[data-account-api-created]");
  const apiKeyLastUsedEl = page.querySelector("[data-account-api-last-used]");
  const apiKeyGenerateBtn = page.querySelector("[data-account-api-generate]");
  const apiKeyRevealEl = page.querySelector("[data-account-api-reveal]");
  const apiKeyValueInput = page.querySelector("[data-account-api-value]");
  const apiKeyCopyBtn = page.querySelector("[data-account-api-copy]");
  const apiKeyCopyStatusEl = page.querySelector("[data-account-api-copy-status]");

  let nameDirty = false;
  let pendingAvatarFile = null;
  let pendingAvatarObjectUrl = "";
  let busy = false;
  let apiKeyBusy = false;
  let currentApiKeyRevealValue = "";
  let apiKeyCopied = false;
  let cachedUsername = "";
  let cachedProfile = null;
  const ACCOUNT_BIO_MAX_LENGTH = 300;
  const fieldDirty = {
    facebook: false,
    discord: false,
    bio: false
  };

  const setLocked = (isLocked) => {
    if (locked) locked.hidden = !isLocked;
    if (form) form.hidden = isLocked;
    if (headActions) headActions.hidden = isLocked;
  };

  const setStatus = (text, variant) => {
    if (!statusEl) return;
    const message = (text || "").toString().trim();
    if (!message) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      statusEl.classList.remove("is-error", "is-success");
      return;
    }
    statusEl.textContent = message;
    statusEl.hidden = false;
    statusEl.classList.remove("is-error", "is-success");
    if (variant === "error") statusEl.classList.add("is-error");
    if (variant === "success") statusEl.classList.add("is-success");
  };

  const showToast = (message, tone = "info", kind = "info", dedupe = true) => {
    const text = (message || "").toString().trim();
    if (!text) return;
    if (!window.BfangToast || typeof window.BfangToast.show !== "function") return;
    window.BfangToast.show({
      message: text,
      tone,
      kind,
      dedupe
    });
  };

  const EMPTY_API_KEY_META = {
    hasKey: false,
    keyPrefix: "",
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: 0
  };

  const normalizeApiKeyMeta = (value) => {
    if (!value || typeof value !== "object") {
      return { ...EMPTY_API_KEY_META };
    }

    const keyPrefix = value.keyPrefix ? String(value.keyPrefix).trim() : "";
    const createdAt = Number(value.createdAt);
    const updatedAt = Number(value.updatedAt);
    const lastUsedAt = Number(value.lastUsedAt);

    return {
      hasKey: Boolean(value.hasKey || keyPrefix),
      keyPrefix,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : 0,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : 0,
      lastUsedAt: Number.isFinite(lastUsedAt) && lastUsedAt > 0 ? Math.floor(lastUsedAt) : 0
    };
  };

  const formatApiKeyTime = (value) => {
    const stamp = Number(value);
    if (!Number.isFinite(stamp) || stamp <= 0) return "—";
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return "—";

    try {
      return new Intl.DateTimeFormat("vi-VN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
    } catch (_err) {
      return date.toLocaleString();
    }
  };

  const setApiKeyCopyStatus = (text, variant) => {
    if (!apiKeyCopyStatusEl) return;
    const message = (text || "").toString().trim();
    if (!message) {
      apiKeyCopyStatusEl.hidden = true;
      apiKeyCopyStatusEl.textContent = "";
      apiKeyCopyStatusEl.classList.remove("is-error", "is-success");
      return;
    }
    apiKeyCopyStatusEl.hidden = false;
    apiKeyCopyStatusEl.textContent = message;
    apiKeyCopyStatusEl.classList.remove("is-error", "is-success");
    apiKeyCopyStatusEl.classList.add(variant === "error" ? "is-error" : "is-success");
  };

  const hideApiKeyReveal = () => {
    currentApiKeyRevealValue = "";
    apiKeyCopied = false;
    setApiKeyCopyStatus("");

    if (apiKeyRevealEl) {
      apiKeyRevealEl.hidden = true;
    }

    if (apiKeyValueInput && apiKeyValueInput instanceof HTMLInputElement) {
      apiKeyValueInput.value = "";
      apiKeyValueInput.blur();
    }

    if (apiKeyCopyBtn && apiKeyCopyBtn instanceof HTMLButtonElement) {
      const originalText =
        apiKeyCopyBtn.dataset.originalText != null
          ? apiKeyCopyBtn.dataset.originalText
          : (apiKeyCopyBtn.textContent || "").toString();
      apiKeyCopyBtn.dataset.originalText = originalText;
      apiKeyCopyBtn.textContent = originalText;
      apiKeyCopyBtn.disabled = false;
    }
  };

  const showApiKeyReveal = (value) => {
    const token = (value || "").toString().trim();
    if (!token) {
      hideApiKeyReveal();
      return;
    }

    currentApiKeyRevealValue = token;
    apiKeyCopied = false;
    setApiKeyCopyStatus("");

    if (apiKeyRevealEl) {
      apiKeyRevealEl.hidden = false;
    }

    if (apiKeyValueInput && apiKeyValueInput instanceof HTMLInputElement) {
      apiKeyValueInput.value = token;
    }

    if (apiKeyCopyBtn && apiKeyCopyBtn instanceof HTMLButtonElement) {
      if (apiKeyCopyBtn.dataset.originalText == null) {
        apiKeyCopyBtn.dataset.originalText = (apiKeyCopyBtn.textContent || "").toString();
      }
      apiKeyCopyBtn.textContent = apiKeyCopyBtn.dataset.originalText;
      apiKeyCopyBtn.disabled = false;
    }
  };

  const setApiKeyMetaUi = (metaInput) => {
    const meta = normalizeApiKeyMeta(metaInput);

    if (apiKeySummaryEl) {
      apiKeySummaryEl.textContent = meta.hasKey ? "Đang hoạt động" : "Chưa có API key";
    }
    if (apiKeyPrefixEl) {
      apiKeyPrefixEl.textContent = meta.keyPrefix || "—";
    }
    if (apiKeyCreatedEl) {
      apiKeyCreatedEl.textContent = meta.hasKey ? formatApiKeyTime(meta.createdAt) : "—";
    }
    if (apiKeyLastUsedEl) {
      apiKeyLastUsedEl.textContent = meta.lastUsedAt > 0 ? formatApiKeyTime(meta.lastUsedAt) : "—";
    }
    if (apiKeyGenerateBtn) {
      apiKeyGenerateBtn.textContent = meta.hasKey ? "Tạo API key mới" : "Tạo API key";
    }
  };

  const setAvatarError = (text) => {
    if (!avatarErrorEl) return;
    const message = (text || "").toString().trim();
    if (!message) {
      avatarErrorEl.hidden = true;
      avatarErrorEl.textContent = "";
      return;
    }
    avatarErrorEl.textContent = message;
    avatarErrorEl.hidden = false;
  };

  const showOverlay = ({ pct, text } = {}) => {
    if (!overlayEl || !overlayBarEl || !overlayTextEl) return;
    const safePct = Math.max(0, Math.min(100, Math.floor(Number(pct) || 0)));
    overlayBarEl.style.width = `${safePct}%`;
    overlayTextEl.textContent = (text || "").toString();
    overlayEl.hidden = false;
  };

  const hideOverlay = () => {
    if (!overlayEl || !overlayBarEl || !overlayTextEl) return;
    overlayEl.hidden = true;
    overlayBarEl.style.width = "0%";
    overlayTextEl.textContent = "";
  };

  const setButtonBusy = (button, label) => {
    if (!button || !(button instanceof HTMLButtonElement)) return;
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
    const original = button.dataset.originalText;
    if (original != null) {
      button.textContent = original;
    }
    delete button.dataset.originalText;
    button.classList.remove("is-loading");
    button.disabled = false;
  };

  const confirmAction = async ({ title, body, confirmText, variant, metaItems } = {}) => {
    const payload = {
      title: (title || "Xác nhận").toString(),
      body: (body || "Bạn có chắc muốn thực hiện thao tác này?").toString(),
      confirmText: (confirmText || "Xác nhận").toString(),
      confirmVariant: (variant || "default").toString(),
      metaItems: Array.isArray(metaItems) ? metaItems : [],
      fallbackText: (body || "Bạn có chắc muốn thực hiện thao tác này?").toString()
    };

    if (window.BfangConfirm && typeof window.BfangConfirm.confirm === "function") {
      return window.BfangConfirm.confirm(payload);
    }

    return window.confirm(payload.fallbackText);
  };

  const normalizeName = (value) => {
    const text = (value || "").toString().replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (text.length <= 30) return text;
    return `${text.slice(0, 27)}...`;
  };

  const parseProfileSocialUrl = ({ value, allowedHosts, canonicalHost, maxLength }) => {
    const raw = value == null ? "" : String(value).trim();
    if (!raw) {
      return { ok: true, value: "" };
    }

    const safeMax = Math.max(1, Math.floor(Number(maxLength) || 0));
    if (safeMax && raw.length > safeMax) {
      return { ok: false, value: "" };
    }

    const safeHosts = Array.isArray(allowedHosts)
      ? allowedHosts
          .map((item) => (item == null ? "" : String(item)).trim().toLowerCase())
          .filter(Boolean)
      : [];
    const preferredHost = (canonicalHost || safeHosts[0] || "").toString().trim().toLowerCase();
    if (!safeHosts.length || !preferredHost) {
      return { ok: false, value: "" };
    }

    let candidate = raw;
    if (!/^https?:\/\//i.test(candidate)) {
      candidate = `https://${candidate.replace(/^\/+/, "")}`;
    }

    let parsed = null;
    try {
      parsed = new URL(candidate);
    } catch (_err) {
      return { ok: false, value: "" };
    }

    const protocol = (parsed.protocol || "").toLowerCase();
    if (protocol !== "https:" && protocol !== "http:") {
      return { ok: false, value: "" };
    }

    const host = (parsed.hostname || "").toLowerCase();
    if (!safeHosts.includes(host)) {
      return { ok: false, value: "" };
    }

    const pathname = (parsed.pathname || "").replace(/\/+$/, "");
    if (!pathname || pathname === "/") {
      return { ok: false, value: "" };
    }

    const search = parsed.search || "";
    return {
      ok: true,
      value: `https://${preferredHost}${pathname}${search}`
    };
  };

  const normalizeFacebook = (value) => {
    const parsed = parseProfileSocialUrl({
      value,
      allowedHosts: ["facebook.com", "www.facebook.com", "m.facebook.com"],
      canonicalHost: "facebook.com",
      maxLength: 180
    });
    return parsed.ok ? parsed.value : "";
  };

  const normalizeDiscord = (value) => {
    const parsed = parseProfileSocialUrl({
      value,
      allowedHosts: ["discord.gg", "www.discord.gg"],
      canonicalHost: "discord.gg",
      maxLength: 80
    });
    return parsed.ok ? parsed.value : "";
  };

  const normalizeBio = (value) => {
    const raw = value == null ? "" : String(value);
    const compact = raw.replace(/\r\n/g, "\n").trim();
    if (!compact) return "";
    return compact.length <= ACCOUNT_BIO_MAX_LENGTH
      ? compact
      : compact.slice(0, ACCOUNT_BIO_MAX_LENGTH).trim();
  };

  const normalizeAvatarUrl = (value) => {
    const url = (value || "").toString().trim();
    if (!url) return "";
    if (url.length > 500) return "";
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("/uploads/avatars/")) return url;
    return "";
  };

  const getUserMeta = (user) =>
    user && typeof user.user_metadata === "object" && user.user_metadata ? user.user_metadata : {};

  const getDisplayNameFromUser = (user) => {
    const meta = getUserMeta(user);
    const custom = meta.display_name ? String(meta.display_name).trim() : "";
    const full = meta.full_name ? String(meta.full_name).trim() : "";
    const name = meta.name ? String(meta.name).trim() : "";
    const email = user && user.email ? String(user.email).trim() : "";
    return normalizeName(custom || full || name || email || "");
  };

  const getProviderAvatarFromUser = (user) => {
    const meta = getUserMeta(user);
    const raw =
      (meta.avatar_url ? meta.avatar_url : "") || (meta.picture ? meta.picture : "") || "";
    return normalizeAvatarUrl(raw);
  };

  const getCustomAvatarFromUser = (user) => {
    const meta = getUserMeta(user);
    const raw = meta.avatar_url_custom ? meta.avatar_url_custom : "";
    return normalizeAvatarUrl(raw);
  };

  const applyText = (nodes, text) => {
    const value = (text || "").toString();
    (nodes || []).forEach((node) => {
      if (node) node.textContent = value;
    });
  };

  const setAccountMeta = ({ username, email, joinedAtText }) => {
    const safeUsername = (username || "").toString().trim();
    const safeEmail = (email || "").toString().trim();
    const safeJoined = (joinedAtText || "").toString().trim();
    const usernameText = safeUsername ? `@${safeUsername}` : "—";
    const emailText = safeEmail || "—";
    const joinedText = safeJoined || "—";
    applyText(usernameEls, usernameText);
    applyText(emailEls, emailText);
    applyText(joinedEls, joinedText);
  };

  const setProfileFieldValues = (profile) => {
    const data = profile && typeof profile === "object" ? profile : null;

    if (facebookInput && !fieldDirty.facebook) {
      facebookInput.value = normalizeFacebook(data ? data.facebookUrl : "");
    }

    if (discordInput && !fieldDirty.discord) {
      discordInput.value = normalizeDiscord(
        data ? data.discordUrl || data.discordHandle || "" : ""
      );
    }

    if (bioInput && !fieldDirty.bio) {
      bioInput.value = normalizeBio(data ? data.bio : "");
    }

    updateBioCounter();
  };

  const updateBioCounter = () => {
    if (!bioCounterEl) return;
    const value = bioInput && bioInput.value != null ? String(bioInput.value) : "";
    const used = value.length;
    const limit = ACCOUNT_BIO_MAX_LENGTH;
    bioCounterEl.textContent = `${used}/${limit}`;
    bioCounterEl.classList.remove("is-warning", "is-exceeded");
    if (used > limit) {
      bioCounterEl.classList.add("is-exceeded");
      return;
    }
    if (used >= Math.floor(limit * 0.85)) {
      bioCounterEl.classList.add("is-warning");
    }
  };

  const setAvatarPreviewUrl = (url) => {
    if (!avatarPreviewImg || !(avatarPreviewImg instanceof HTMLImageElement)) return;
    if (!url) {
      avatarPreviewImg.removeAttribute("src");
      avatarPreviewImg.hidden = true;
      return;
    }
    avatarPreviewImg.src = url;
    avatarPreviewImg.hidden = false;
  };

  const revokePendingObjectUrl = () => {
    if (!pendingAvatarObjectUrl) return;
    try {
      URL.revokeObjectURL(pendingAvatarObjectUrl);
    } catch (_err) {
      // ignore
    }
    pendingAvatarObjectUrl = "";
  };

  const clearPendingAvatar = () => {
    pendingAvatarFile = null;
    if (window.BfangAuth && typeof window.BfangAuth.clearAvatarPreview === "function") {
      window.BfangAuth.clearAvatarPreview();
    }
    revokePendingObjectUrl();
    if (avatarFileInput && avatarFileInput instanceof HTMLInputElement) {
      avatarFileInput.value = "";
    }
  };

  const getSessionSafe = async () => {
    if (!window.BfangAuth || typeof window.BfangAuth.getSession !== "function") {
      return null;
    }
    try {
      return await window.BfangAuth.getSession();
    } catch (_err) {
      return null;
    }
  };

  const buildAuthHeaders = (accessToken, extraHeaders) => {
    const token = (accessToken || "").toString().trim();
    const headers = Object.assign({}, extraHeaders || {});
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const fetchMeProfile = async (accessToken) => {
    const response = await fetch("/account/me", {
      headers: buildAuthHeaders(accessToken, {
        Accept: "application/json"
      }),
      credentials: "same-origin"
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      return null;
    }
    return data.profile || null;
  };

  const syncProfileToComments = async (accessToken) => {
    const response = await fetch("/account/profile/sync", {
      method: "POST",
      headers: buildAuthHeaders(accessToken, {
        "Content-Type": "application/json",
        Accept: "application/json"
      }),
      credentials: "same-origin",
      body: JSON.stringify({})
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      return null;
    }

    return data;
  };

  const regenerateApiKey = async () => {
    const response = await fetch("/account/api-key/regenerate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({})
    }).catch(() => null);

    if (!response) {
      throw new Error("Không thể kết nối máy chủ để tạo API key.");
    }

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true || !data.apiKey) {
      const message = data && data.error ? String(data.error) : "Không thể tạo API key mới.";
      throw new Error(message);
    }

    const token = String(data.apiKey || "").trim();
    if (!token) {
      throw new Error("Không nhận được API key hợp lệ.");
    }

    return {
      apiKey: token,
      meta: normalizeApiKeyMeta(data.meta)
    };
  };

  const copyTextToClipboard = async (text) => {
    const value = (text || "").toString();
    if (!value) return false;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (_err) {
        // fallback below
      }
    }

    if (!apiKeyValueInput || !(apiKeyValueInput instanceof HTMLInputElement)) {
      return false;
    }

    const previousReadonly = apiKeyValueInput.readOnly;
    const previousSelectionStart = apiKeyValueInput.selectionStart;
    const previousSelectionEnd = apiKeyValueInput.selectionEnd;
    apiKeyValueInput.readOnly = false;
    apiKeyValueInput.focus();
    apiKeyValueInput.select();
    apiKeyValueInput.setSelectionRange(0, apiKeyValueInput.value.length);

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (_err) {
      copied = false;
    }

    apiKeyValueInput.readOnly = previousReadonly;
    if (
      Number.isFinite(previousSelectionStart) &&
      Number.isFinite(previousSelectionEnd)
    ) {
      apiKeyValueInput.setSelectionRange(previousSelectionStart, previousSelectionEnd);
    } else {
      apiKeyValueInput.setSelectionRange(0, 0);
      apiKeyValueInput.blur();
    }

    return copied;
  };

  const uploadAvatarWithProgress = (file, accessToken, onProgress) =>
    new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("Chưa chọn ảnh avatar."));
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/account/avatar/upload");
      xhr.responseType = "json";
      xhr.timeout = 120000;
      xhr.setRequestHeader("Accept", "application/json");
      const token = (accessToken || "").toString().trim();
      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }

      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) {
          if (onProgress) onProgress(null);
          return;
        }
        const pct = Math.round((event.loaded / event.total) * 100);
        if (onProgress) onProgress(pct);
      });

      xhr.addEventListener("load", () => {
        const data = xhr.response;
        if (xhr.status >= 200 && xhr.status < 300 && data && data.ok === true && data.avatarUrl) {
          resolve(String(data.avatarUrl));
          return;
        }
        const message = data && data.error ? String(data.error) : "Upload avatar thất bại.";
        reject(new Error(message));
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Upload avatar thất bại."));
      });

      xhr.addEventListener("timeout", () => {
        reject(new Error("Upload avatar quá lâu. Vui lòng thử lại."));
      });

      const body = new FormData();
      body.append("avatar", file);
      xhr.send(body);
    });

  const refresh = async () => {
    const session = await getSessionSafe();
    const user = session && session.user ? session.user : null;
    if (!user) {
      setLocked(true);
      setStatus("");
      setAvatarError("");
      setAccountMeta({ username: "", email: "", joinedAtText: "" });
      if (previewNameEl) previewNameEl.textContent = "";
      setAvatarPreviewUrl("");
      clearPendingAvatar();
      if (facebookInput) facebookInput.value = "";
      if (discordInput) discordInput.value = "";
      if (bioInput) bioInput.value = "";
      updateBioCounter();
      nameDirty = false;
      fieldDirty.facebook = false;
      fieldDirty.discord = false;
      fieldDirty.bio = false;
      cachedUsername = "";
      cachedProfile = null;
      setApiKeyMetaUi(EMPTY_API_KEY_META);
      hideApiKeyReveal();
      return;
    }

    setLocked(false);
    setAvatarError("");

    const displayName = getDisplayNameFromUser(user);
    const sessionEmail = user.email ? String(user.email).trim() : "";

    if (nameInput && !nameDirty) {
      nameInput.value = displayName;
    }

    const baseName = normalizeName(nameInput ? nameInput.value : "") || displayName;
    if (previewNameEl) previewNameEl.textContent = baseName;

    if (pendingAvatarObjectUrl) {
      setAvatarPreviewUrl(pendingAvatarObjectUrl);
      if (window.BfangAuth && typeof window.BfangAuth.setAvatarPreview === "function") {
        window.BfangAuth.setAvatarPreview(pendingAvatarObjectUrl);
      }
    } else {
      const avatarUrl = getCustomAvatarFromUser(user) || getProviderAvatarFromUser(user);
      setAvatarPreviewUrl(avatarUrl);
    }

    const token = session.access_token ? String(session.access_token).trim() : "";
    if (!cachedProfile) {
      const me = await fetchMeProfile(token);
      if (me && typeof me === "object") {
        cachedProfile = me;
        cachedUsername = me.username ? String(me.username).trim() : "";
      }
    }

    const profileEmail =
      cachedProfile && cachedProfile.email ? String(cachedProfile.email).trim() : "";
    const joinedAtText =
      cachedProfile && cachedProfile.joinedAtText ? String(cachedProfile.joinedAtText).trim() : "";
    setAccountMeta({
      username: cachedUsername,
      email: profileEmail || sessionEmail,
      joinedAtText
    });
    setProfileFieldValues(cachedProfile);
    setApiKeyMetaUi(cachedProfile && cachedProfile.apiKey ? cachedProfile.apiKey : EMPTY_API_KEY_META);
  };

  if (nameInput) {
    nameInput.addEventListener("input", () => {
      nameDirty = true;
      const next = normalizeName(nameInput.value);
      if (previewNameEl) {
        previewNameEl.textContent = next || "";
      }
    });
  }

  if (facebookInput) {
    facebookInput.addEventListener("input", () => {
      fieldDirty.facebook = true;
    });
    facebookInput.addEventListener("blur", () => {
      const parsed = parseProfileSocialUrl({
        value: facebookInput.value,
        allowedHosts: ["facebook.com", "www.facebook.com", "m.facebook.com"],
        canonicalHost: "facebook.com",
        maxLength: 180
      });
      if (parsed.ok && parsed.value) {
        facebookInput.value = parsed.value;
      }
    });
  }

  if (discordInput) {
    discordInput.addEventListener("input", () => {
      fieldDirty.discord = true;
    });
    discordInput.addEventListener("blur", () => {
      const parsed = parseProfileSocialUrl({
        value: discordInput.value,
        allowedHosts: ["discord.gg", "www.discord.gg"],
        canonicalHost: "discord.gg",
        maxLength: 80
      });
      if (parsed.ok && parsed.value) {
        discordInput.value = parsed.value;
      }
    });
  }

  if (bioInput) {
    bioInput.addEventListener("input", () => {
      fieldDirty.bio = true;
      updateBioCounter();
    });
    bioInput.addEventListener("blur", () => {
      bioInput.value = normalizeBio(bioInput.value);
      updateBioCounter();
    });
  }

  if (avatarPreviewWrap && avatarFileInput) {
    avatarPreviewWrap.addEventListener("click", () => {
      if (busy || apiKeyBusy) return;
      avatarFileInput.click();
    });
  }

  if (avatarFileInput) {
    avatarFileInput.addEventListener("change", () => {
      setAvatarError("");
      const file =
        avatarFileInput.files && avatarFileInput.files[0] ? avatarFileInput.files[0] : null;

      pendingAvatarFile = null;
      revokePendingObjectUrl();

      if (!file) {
        if (window.BfangAuth && typeof window.BfangAuth.clearAvatarPreview === "function") {
          window.BfangAuth.clearAvatarPreview();
        }
        refresh().catch(() => null);
        return;
      }

      const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
      if (!allowed.has(file.type)) {
        setAvatarError("Chỉ hỗ trợ JPG/PNG/WebP.");
        if (avatarFileInput) avatarFileInput.value = "";
        refresh().catch(() => null);
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        setAvatarError("Avatar tối đa 2MB.");
        if (avatarFileInput) avatarFileInput.value = "";
        refresh().catch(() => null);
        return;
      }

      pendingAvatarFile = file;
      try {
        pendingAvatarObjectUrl = URL.createObjectURL(file);
      } catch (_err) {
        pendingAvatarObjectUrl = "";
      }

      if (pendingAvatarObjectUrl && window.BfangAuth && typeof window.BfangAuth.setAvatarPreview === "function") {
        window.BfangAuth.setAvatarPreview(pendingAvatarObjectUrl);
      }

      refresh().catch(() => null);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      if (busy || apiKeyBusy) return;
      const session = await getSessionSafe();
      if (!session || !session.user || !window.BfangAuth || !window.BfangAuth.client) {
        setStatus("Vui lòng đăng nhập để thực hiện thao tác.", "error");
        return;
      }

      const ok = await confirmAction({
        title: "Đặt lại avatar?",
        body: "Avatar sẽ trở về ảnh mặc định từ tài khoản đăng nhập (nếu có).",
        confirmText: "Đặt lại",
        variant: "default"
      });
      if (!ok) return;

      busy = true;
      clearPendingAvatar();
      hideOverlay();
      setStatus("Đang cập nhật...", "");
      if (saveBtn) saveBtn.disabled = true;
      if (avatarFileInput) avatarFileInput.disabled = true;
      setButtonBusy(resetBtn, "Đang xử lý...");

      try {
        const { error } = await window.BfangAuth.client.auth.updateUser({
          data: { avatar_url_custom: "" }
        });
        if (error) throw error;

        await syncProfileToComments(session.access_token);
        cachedProfile = null;
        cachedUsername = "";
        if (window.BfangAuth && typeof window.BfangAuth.refreshUi === "function") {
          await window.BfangAuth.refreshUi();
        }

        setStatus("Đã đặt lại avatar.", "success");
      } catch (_err) {
        setStatus("Không thể cập nhật avatar. Vui lòng thử lại.", "error");
      } finally {
        busy = false;
        restoreButton(resetBtn);
        if (saveBtn) saveBtn.disabled = false;
        if (avatarFileInput) avatarFileInput.disabled = false;
      }

      await refresh();
    });
  }

  if (apiKeyGenerateBtn) {
    apiKeyGenerateBtn.addEventListener("click", async () => {
      if (busy || apiKeyBusy) return;

      const session = await getSessionSafe();
      if (!session || !session.user) {
        setLocked(true);
        setStatus("Vui lòng đăng nhập để tạo API key.", "error");
        return;
      }

      const currentMeta = normalizeApiKeyMeta(cachedProfile && cachedProfile.apiKey ? cachedProfile.apiKey : null);
      if (currentMeta.hasKey) {
        const ok = await confirmAction({
          title: "Tạo API key mới?",
          body: "API key cũ sẽ bị vô hiệu hóa ngay lập tức. Các ứng dụng đang dùng key cũ sẽ ngừng hoạt động.",
          confirmText: "Tạo mới",
          variant: "danger",
          metaItems: currentMeta.keyPrefix ? [currentMeta.keyPrefix] : []
        });
        if (!ok) return;
      }

      apiKeyBusy = true;
      setApiKeyCopyStatus("");
      setButtonBusy(apiKeyGenerateBtn, currentMeta.hasKey ? "Đang tạo lại..." : "Đang tạo...");

      try {
        const generated = await regenerateApiKey();
        if (!cachedProfile || typeof cachedProfile !== "object") {
          cachedProfile = {};
        }
        cachedProfile.apiKey = generated.meta;
        setApiKeyMetaUi(generated.meta);
        showApiKeyReveal(generated.apiKey);
        setStatus("Đã tạo API key mới. Hãy sao chép ngay, key chỉ hiển thị một lần.", "success");
      } catch (err) {
        const message = (err && err.message) || "Không thể tạo API key mới.";
        setStatus(message, "error");
      } finally {
        apiKeyBusy = false;
        restoreButton(apiKeyGenerateBtn);
        setApiKeyMetaUi(cachedProfile && cachedProfile.apiKey ? cachedProfile.apiKey : EMPTY_API_KEY_META);
      }
    });
  }

  if (apiKeyCopyBtn) {
    apiKeyCopyBtn.addEventListener("click", async () => {
      if (apiKeyCopied) return;
      const token = (currentApiKeyRevealValue || "").toString().trim();
      if (!token) {
        setApiKeyCopyStatus("API key đã bị ẩn. Hãy tạo key mới nếu cần.", "error");
        return;
      }

      apiKeyCopyBtn.disabled = true;
      const copied = await copyTextToClipboard(token);
      if (!copied) {
        apiKeyCopyBtn.disabled = false;
        setApiKeyCopyStatus("Không thể sao chép tự động. Hãy sao chép thủ công trước khi rời trang.", "error");
        return;
      }

      apiKeyCopied = true;
      currentApiKeyRevealValue = "";

      if (apiKeyValueInput && apiKeyValueInput instanceof HTMLInputElement) {
        apiKeyValueInput.value = "Đã ẩn key vĩnh viễn";
      }

      if (apiKeyCopyBtn.dataset.originalText == null) {
        apiKeyCopyBtn.dataset.originalText = (apiKeyCopyBtn.textContent || "").toString();
      }

      const clearCopyButtonLoadingState = () => {
        apiKeyCopyBtn.classList.remove("is-loading");
        apiKeyCopyBtn.removeAttribute("data-button-auto-loading");
        apiKeyCopyBtn.removeAttribute("aria-busy");
      };

      apiKeyCopyBtn.textContent = "Đã sao chép";
      apiKeyCopyBtn.disabled = true;
      clearCopyButtonLoadingState();
      window.setTimeout(clearCopyButtonLoadingState, 0);
      setApiKeyCopyStatus("Đã sao chép API key. Key đã được ẩn khỏi trang.", "success");
    });
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || apiKeyBusy) return;

      if (!window.BfangAuth || !window.BfangAuth.client) {
        setStatus("Không tải được hệ thống đăng nhập. Vui lòng thử lại.", "error");
        return;
      }

      const session = await getSessionSafe();
      if (!session || !session.user) {
        setLocked(true);
        setStatus("Vui lòng đăng nhập để lưu thay đổi.", "error");
        return;
      }

      const nextName = normalizeName(nameInput ? nameInput.value : "");
      const facebookParsed = parseProfileSocialUrl({
        value: facebookInput ? facebookInput.value : "",
        allowedHosts: ["facebook.com", "www.facebook.com", "m.facebook.com"],
        canonicalHost: "facebook.com",
        maxLength: 180
      });
      if (!facebookParsed.ok) {
        setStatus("Link Facebook phải có dạng facebook.com/*.", "error");
        if (facebookInput) facebookInput.focus();
        return;
      }

      const discordParsed = parseProfileSocialUrl({
        value: discordInput ? discordInput.value : "",
        allowedHosts: ["discord.gg", "www.discord.gg"],
        canonicalHost: "discord.gg",
        maxLength: 80
      });
      if (!discordParsed.ok) {
        setStatus("Link Discord phải có dạng discord.gg/*.", "error");
        if (discordInput) discordInput.focus();
        return;
      }

      const nextFacebook = facebookParsed.value;
      const nextDiscord = discordParsed.value;
      const nextBio = normalizeBio(bioInput ? bioInput.value : "");
      if (nextBio.length > ACCOUNT_BIO_MAX_LENGTH) {
        setStatus(`Thông tin bản thân tối đa ${ACCOUNT_BIO_MAX_LENGTH} ký tự.`, "error");
        if (bioInput) bioInput.focus();
        return;
      }
      const willUploadAvatar = Boolean(pendingAvatarFile);

      if (facebookInput) facebookInput.value = nextFacebook;
      if (discordInput) discordInput.value = nextDiscord;
      if (bioInput) bioInput.value = nextBio;

      const metaItems = [];
      if (cachedUsername) metaItems.push(`@${cachedUsername}`);
      if (willUploadAvatar && pendingAvatarFile) metaItems.push(pendingAvatarFile.name);

      const bodyParts = [];
      bodyParts.push(nextName ? `Tên hiển thị: "${nextName}"` : "Tên hiển thị: dùng mặc định");
      if (willUploadAvatar) {
        bodyParts.push("Avatar: upload ảnh mới");
      }
      if (nextFacebook) bodyParts.push("Facebook: đã cập nhật");
      if (nextDiscord) bodyParts.push("Discord: đã cập nhật");
      if (nextBio) bodyParts.push("Giới thiệu: đã cập nhật");

      const ok = await confirmAction({
        title: "Lưu thay đổi?",
        body: `${bodyParts.join(". ")}.`,
        confirmText: "Lưu",
        variant: "default",
        metaItems
      });
      if (!ok) return;

      busy = true;
      setStatus("Đang lưu...", "");
      setAvatarError("");

      if (avatarFileInput) avatarFileInput.disabled = true;
      if (resetBtn) resetBtn.disabled = true;
      setButtonBusy(saveBtn, willUploadAvatar ? "Đang upload..." : "Đang lưu...");

      try {
        const token = String(session.access_token || "").trim();
        let uploadedAvatarUrl = "";

        if (willUploadAvatar && pendingAvatarFile) {
          showOverlay({ pct: 0, text: "Đang upload 0%" });
          uploadedAvatarUrl = await uploadAvatarWithProgress(pendingAvatarFile, token, (pct) => {
            if (pct == null) {
              showOverlay({ pct: 15, text: "Đang upload..." });
              return;
            }
            showOverlay({ pct, text: `Đang upload ${pct}%` });
          });

          showOverlay({ pct: 100, text: "Đang cập nhật..." });
        }

        const payload = {
          display_name: nextName,
          facebook_url: nextFacebook,
          discord_handle: nextDiscord,
          bio: nextBio
        };
        if (uploadedAvatarUrl) {
          payload.avatar_url_custom = normalizeAvatarUrl(uploadedAvatarUrl);
        }

        const { error } = await window.BfangAuth.client.auth.updateUser({ data: payload });
        if (error) throw error;

        const synced = await syncProfileToComments(session.access_token);
        if (synced && synced.profile) {
          cachedProfile = synced.profile;
          cachedUsername = synced.profile.username ? String(synced.profile.username).trim() : "";
        }

        if (window.BfangAuth && typeof window.BfangAuth.refreshUi === "function") {
          await window.BfangAuth.refreshUi();
        }

        clearPendingAvatar();
        nameDirty = false;
        fieldDirty.facebook = false;
        fieldDirty.discord = false;
        fieldDirty.bio = false;

        showOverlay({ pct: 100, text: "Hoàn tất" });
        window.setTimeout(hideOverlay, 600);
        setStatus("Đã lưu thay đổi.", "success");
        showToast("Đã lưu thay đổi.", "success", "account-save");
      } catch (err) {
        hideOverlay();
        const message = (err && err.message) || "Không thể lưu. Vui lòng thử lại.";
        setStatus(message, "error");
      } finally {
        busy = false;
        restoreButton(saveBtn);
        if (avatarFileInput) avatarFileInput.disabled = false;
        if (resetBtn) resetBtn.disabled = false;
      }

      cachedProfile = null;
      cachedUsername = "";
      await refresh();
    });
  }

  window.addEventListener("pagehide", () => {
    if (window.BfangAuth && typeof window.BfangAuth.clearAvatarPreview === "function") {
      window.BfangAuth.clearAvatarPreview();
    }
    revokePendingObjectUrl();
    hideApiKeyReveal();
  });

  setApiKeyMetaUi(EMPTY_API_KEY_META);
  hideApiKeyReveal();
  updateBioCounter();
  refresh().catch(() => null);

  if (window.BfangAuth && window.BfangAuth.client && window.BfangAuth.client.auth) {
    window.BfangAuth.client.auth.onAuthStateChange(() => {
      refresh().catch(() => null);
    });
  }
})();
