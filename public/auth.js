(() => {
  const authRoot = document.documentElement;

  const authConfig = window.__AUTH && typeof window.__AUTH === "object" ? window.__AUTH : {};
  const providerConfig =
    authConfig && typeof authConfig.providers === "object" && authConfig.providers
      ? authConfig.providers
      : {};

  const authHintStorageKey = "bfang_auth_hint";
  const authProviderStorageKey = "bfang_auth_provider";
  const authServerSessionVersionStorageKey = "bfang_server_session_version";
  const supportedAuthProviders = ["google", "discord"];
  const notificationsScriptDefaultPath = "/notifications.js";

  const authProviderEnabled = {
    google: Boolean(providerConfig.google),
    discord: Boolean(providerConfig.discord)
  };

  const normalizeScriptUrl = (value) => {
    const raw = (value || "").toString().trim();
    if (!raw) return notificationsScriptDefaultPath;
    if (raw.startsWith("/")) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    return notificationsScriptDefaultPath;
  };

  const notificationsScriptUrl = normalizeScriptUrl(
    authConfig.notificationsScriptUrl || notificationsScriptDefaultPath
  );
  let notificationsScriptPromise = null;

  const ensureNotificationsClientLoaded = () => {
    if (window.__BFANG_NOTIFICATIONS_BOOTED) {
      return Promise.resolve();
    }
    if (notificationsScriptPromise) {
      return notificationsScriptPromise;
    }

    notificationsScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-bfang-notifications]");
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Cannot load notifications client.")), {
          once: true
        });
        return;
      }

      const script = document.createElement("script");
      script.src = notificationsScriptUrl;
      script.defer = true;
      script.setAttribute("data-bfang-notifications", "1");
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => reject(new Error("Cannot load notifications client.")), {
        once: true
      });
      document.head.appendChild(script);
    }).catch((error) => {
      notificationsScriptPromise = null;
      throw error;
    });

    return notificationsScriptPromise;
  };

  const setAuthRootState = (ready, hint) => {
    if (!authRoot) return;
    const safeHint = hint === "in" ? "in" : "out";
    authRoot.setAttribute("data-auth-hint", safeHint);
    authRoot.setAttribute("data-auth-ready", ready ? "1" : "0");
  };

  const normalizeServerSessionVersion = (value) => {
    const raw = value == null ? "" : String(value).trim();
    if (!raw) return "";
    if (raw.length > 64) return "";
    if (!/^[a-z0-9._-]+$/i.test(raw)) return "";
    return raw;
  };

  const detectServerSessionVersionChange = (value) => {
    const currentVersion = normalizeServerSessionVersion(value);
    if (!currentVersion) return false;
    try {
      const previousVersion = normalizeServerSessionVersion(
        window.localStorage.getItem(authServerSessionVersionStorageKey)
      );
      window.localStorage.setItem(authServerSessionVersionStorageKey, currentVersion);
      return Boolean(previousVersion && previousVersion !== currentVersion);
    } catch (_err) {
      return false;
    }
  };

  const readAuthHint = () => {
    try {
      const hint = (window.localStorage.getItem(authHintStorageKey) || "").toString().trim().toLowerCase();
      return hint === "in" ? "in" : "out";
    } catch (_err) {
      return "out";
    }
  };

  const writeAuthHint = (signedIn) => {
    try {
      window.localStorage.setItem(authHintStorageKey, signedIn ? "in" : "out");
    } catch (_err) {
      // ignore
    }
  };

  const forceSignOutOnServerRestart = detectServerSessionVersionChange(authConfig.sessionVersion || "");
  if (forceSignOutOnServerRestart) {
    writeAuthHint(false);
  }

  setAuthRootState(false, forceSignOutOnServerRestart ? "out" : readAuthHint());

  const normalizeAuthProvider = (value) => {
    const raw = (value || "").toString().trim().toLowerCase();
    if (supportedAuthProviders.includes(raw) && authProviderEnabled[raw]) {
      return raw;
    }
    if (authProviderEnabled.google) return "google";
    if (authProviderEnabled.discord) return "discord";
    return "google";
  };

  const readPreferredAuthProvider = () => {
    try {
      return normalizeAuthProvider(window.localStorage.getItem(authProviderStorageKey));
    } catch (_err) {
      return normalizeAuthProvider("");
    }
  };

  let preferredAuthProvider = readPreferredAuthProvider();

  const storePreferredAuthProvider = (value) => {
    const provider = normalizeAuthProvider(value);
    preferredAuthProvider = provider;
    try {
      window.localStorage.setItem(authProviderStorageKey, provider);
    } catch (_err) {
      // ignore
    }
    return provider;
  };

  const authStateListeners = new Set();
  const emitAuthStateChange = (event, session) => {
    authStateListeners.forEach((listener) => {
      try {
        listener(event, session);
      } catch (_err) {
        // ignore listener failure
      }
    });
  };

  let cachedUserId = "";
  let cachedUsername = "";
  let cachedProfile = null;
  let avatarPreviewOverride = "";
  let profileFetchPromise = null;
  let sessionRequestPromise = null;
  let sessionLoaded = false;
  let lastSession = null;
  const authProfileUsernamePattern = /^[a-z0-9_]{1,24}$/i;

  const buildProfilePathFromUsername = (value) => {
    const username = (value || "").toString().trim().toLowerCase();
    if (!authProfileUsernamePattern.test(username)) return "";
    return `/user/${encodeURIComponent(username)}`;
  };

  const setMeProfile = (profile) => {
    cachedProfile = profile && typeof profile === "object" ? profile : null;
    if (window.BfangAuth) {
      window.BfangAuth.me = cachedProfile;
    }
    try {
      window.dispatchEvent(new CustomEvent("bfang:me", { detail: { profile: cachedProfile } }));
    } catch (_err) {
      // ignore
    }
  };

  const setUsernameWidgets = (username) => {
    const value = (username || "").toString().trim();
    const label = value ? `@${value}` : "";
    document.querySelectorAll("[data-auth-username]").forEach((el) => {
      el.textContent = label;
    });
  };

  const normalizeAvatarCandidate = (value) => {
    const url = value == null ? "" : String(value).trim();
    if (!url) return "";
    if (url.length > 500) return "";
    if (!/^https?:\/\//i.test(url) && !url.startsWith("/uploads/avatars/")) return "";
    return url;
  };

  const readIdentityAvatar = (user, provider) => {
    const wantedProvider = (provider || "").toString().trim().toLowerCase();
    if (!wantedProvider) return "";

    const identities = user && Array.isArray(user.identities) ? user.identities : [];
    for (const identity of identities) {
      if (!identity || typeof identity !== "object") continue;
      const identityData =
        identity.identity_data && typeof identity.identity_data === "object" ? identity.identity_data : {};
      const identityProvider = (identity.provider || identity.provider_id || identityData.provider || "")
        .toString()
        .trim()
        .toLowerCase();
      if (identityProvider !== wantedProvider) continue;

      const avatarUrl = normalizeAvatarCandidate(
        identityData.avatar_url ||
          identityData.picture ||
          identityData.photo_url ||
          identityData.photoURL ||
          identityData.profile_image ||
          ""
      );
      if (avatarUrl) return avatarUrl;
    }

    return "";
  };

  const buildAvatarUrl = (user) => {
    if (!user) return "";
    const meta = user && typeof user.user_metadata === "object" ? user.user_metadata : null;

    const customAvatarUrl = normalizeAvatarCandidate(meta && meta.avatar_url_custom ? meta.avatar_url_custom : "");
    if (customAvatarUrl) return customAvatarUrl;

    const googleAvatarUrl = readIdentityAvatar(user, "google");
    if (googleAvatarUrl) return googleAvatarUrl;

    const metadataAvatarUrl = normalizeAvatarCandidate(
      (meta && meta.avatar_url ? meta.avatar_url : "") || (meta && meta.picture ? meta.picture : "") || ""
    );
    if (metadataAvatarUrl) return metadataAvatarUrl;

    return readIdentityAvatar(user, "discord");
  };

  const buildDisplayName = (user) => {
    if (!user) return "";
    const meta = user && typeof user.user_metadata === "object" ? user.user_metadata : null;
    const custom = meta && meta.display_name ? String(meta.display_name).trim() : "";
    const fullName = meta && meta.full_name ? String(meta.full_name).trim() : "";
    const fallbackName = meta && meta.name ? String(meta.name).trim() : "";
    const email = user.email ? String(user.email).trim() : "";
    const candidate = (custom || fullName || fallbackName || email || "").replace(/\s+/g, " ").trim();
    if (!candidate) return "";
    if (candidate.length <= 30) return candidate;
    return `${candidate.slice(0, 27)}...`;
  };

  const setAvatarPreview = (url) => {
    avatarPreviewOverride = normalizeAvatarCandidate(url);
    updateWidgets(lastSession);
  };

  const clearAvatarPreview = () => {
    avatarPreviewOverride = "";
    updateWidgets(lastSession);
  };

  const getSafeNext = () => {
    const pathname = (window.location.pathname || "").toString();
    const search = (window.location.search || "").toString();
    const hash = (window.location.hash || "").toString();
    const next = `${pathname}${search}${hash}`;
    if (!next.startsWith("/")) return "/";
    if (next.startsWith("/auth/")) return "/";
    if (next.length > 300) return "/";
    return next || "/";
  };

  const consumeAuthLoginIntentFromUrl = () => {
    try {
      const currentUrl = new URL(window.location.href);
      const authValue = (currentUrl.searchParams.get("auth") || "").toString().trim().toLowerCase();
      const loginValue = (currentUrl.searchParams.get("login") || "").toString().trim().toLowerCase();
      const shouldOpen =
        authValue === "login" ||
        loginValue === "1" ||
        loginValue === "true" ||
        loginValue === "login";

      if (!shouldOpen) {
        return false;
      }

      currentUrl.searchParams.delete("auth");
      currentUrl.searchParams.delete("login");
      const nextUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}` || "/";

      if (window.history && typeof window.history.replaceState === "function") {
        window.history.replaceState(window.history.state || null, document.title, nextUrl);
      }

      return true;
    } catch (_err) {
      return false;
    }
  };

  const shouldAutoOpenLoginDialogFromUrl = consumeAuthLoginIntentFromUrl();

  const fetchMeProfile = async () => {
    const response = await fetch("/account/me", {
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin"
    }).catch(() => null);

    if (!response) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true || !data.profile) {
      return null;
    }
    return data.profile;
  };

  const refreshProfileForSession = (session) => {
    const user = session && session.user ? session.user : null;
    const userId = user && user.id ? String(user.id).trim() : "";

    if (!userId) {
      cachedUserId = "";
      cachedUsername = "";
      setMeProfile(null);
      setUsernameWidgets("");
      updateWidgets(lastSession);
      return Promise.resolve();
    }

    if (profileFetchPromise) {
      return profileFetchPromise;
    }

    if (cachedUserId === userId && cachedProfile) {
      setUsernameWidgets(cachedUsername);
      updateWidgets(lastSession);
      return Promise.resolve();
    }

    profileFetchPromise = fetchMeProfile()
      .then((profile) => {
        cachedUserId = userId;
        cachedUsername = profile && profile.username ? String(profile.username).trim() : "";
        setMeProfile(profile);
        setUsernameWidgets(cachedUsername);
        updateWidgets(lastSession);
      })
      .catch(() => {
        cachedUserId = userId;
        cachedUsername = "";
        setMeProfile(null);
        setUsernameWidgets("");
        updateWidgets(lastSession);
      })
      .finally(() => {
        profileFetchPromise = null;
      });

    return profileFetchPromise;
  };

  const updateCommentForms = (session) => {
    const signedIn = Boolean(session && session.user);
    document.querySelectorAll("[data-comment-form]").forEach((form) => {
      const textarea = form.querySelector("textarea[name='content']");
      const submit = form.querySelector("button[type='submit']");
      if (!textarea) return;

      if (signedIn) {
        textarea.disabled = false;
        if (submit) submit.disabled = false;
        textarea.setAttribute("placeholder", "Viết bình luận...");
        return;
      }

      textarea.value = "";
      textarea.disabled = true;
      if (submit) submit.disabled = true;
      textarea.setAttribute("placeholder", "Đăng nhập để bình luận...");
    });
  };

  const updateWidgets = (session) => {
    const signedIn = Boolean(session && session.user);
    const user = session && session.user ? session.user : null;
    const name = signedIn ? buildDisplayName(user) : "";
    const profilePath = signedIn ? buildProfilePathFromUsername(cachedUsername) : "";
    const profileAvatarUrl =
      signedIn && cachedProfile && cachedProfile.avatarUrl
        ? normalizeAvatarCandidate(cachedProfile.avatarUrl)
        : "";
    const avatarUrl = signedIn ? avatarPreviewOverride || profileAvatarUrl || buildAvatarUrl(user) : "";

    document.querySelectorAll("[data-auth-widget]").forEach((widget) => {
      const loginButtons = widget.querySelectorAll("[data-auth-login]");
      const profile = widget.querySelector("[data-auth-profile]");
      const nameEl = widget.querySelector("[data-auth-name]");
      const profileLinkEl = widget.querySelector("[data-auth-profile-link]");
      const avatarEl = widget.querySelector("[data-auth-avatar]");

      loginButtons.forEach((button) => {
        button.hidden = signedIn;
      });
      if (profile) profile.hidden = !signedIn;
      if (nameEl) nameEl.textContent = name || "";
      if (profileLinkEl) {
        profileLinkEl.setAttribute("href", profilePath || "/account");
      }

      if (avatarEl) {
        if (avatarUrl) {
          if (avatarEl.src !== avatarUrl) {
            avatarEl.src = avatarUrl;
          }
          avatarEl.hidden = false;
        } else {
          avatarEl.hidden = true;
          avatarEl.removeAttribute("src");
        }
      }
    });
  };

  const setMemberOnlyNavVisibility = (signedIn) => {
    document.querySelectorAll("[data-auth-member-only]").forEach((link) => {
      if (!link) return;
      link.hidden = !signedIn;
    });
  };

  let publishNavTeamStatusRequestId = 0;
  let publishNavTeamStatusCache = {
    userId: "",
    inTeam: false
  };

  const setPublishNavLinkLabel = (label) => {
    const safeLabel = label === "Nhóm dịch" ? "Nhóm dịch" : "Đăng truyện";
    const mode = safeLabel === "Nhóm dịch" ? "team" : "publish";

    document.querySelectorAll("[data-publish-nav-link]").forEach((link) => {
      if (!link) return;
      link.textContent = safeLabel;
      link.setAttribute("href", "/publish");
      link.setAttribute("data-publish-nav-mode", mode);
    });
  };

  const updatePublishNavLinkLabel = (session) => {
    const signedIn = Boolean(session && session.user);
    const userId =
      signedIn && session && session.user && session.user.id
        ? String(session.user.id).trim()
        : "";

    if (!signedIn || !userId) {
      publishNavTeamStatusCache = {
        userId: "",
        inTeam: false
      };
      setPublishNavLinkLabel("Đăng truyện");
      return;
    }

    if (publishNavTeamStatusCache.userId === userId) {
      setPublishNavLinkLabel(publishNavTeamStatusCache.inTeam ? "Nhóm dịch" : "Đăng truyện");
      return;
    }

    const requestId = ++publishNavTeamStatusRequestId;
    fetch("/account/team-status?format=json", {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin",
      cache: "no-store"
    })
      .then((response) =>
        response
          .json()
          .catch(() => null)
          .then((data) => ({ response, data }))
      )
      .then(({ response, data }) => {
        if (requestId !== publishNavTeamStatusRequestId) return;

        const latestSessionUserId =
          lastSession && lastSession.user && lastSession.user.id
            ? String(lastSession.user.id).trim()
            : "";
        if (!latestSessionUserId || latestSessionUserId !== userId) return;

        const inTeam = Boolean(response && response.ok && data && data.ok === true && data.inTeam && data.team);
        publishNavTeamStatusCache = {
          userId,
          inTeam
        };
        setPublishNavLinkLabel(inTeam ? "Nhóm dịch" : "Đăng truyện");
      })
      .catch(() => {
        if (requestId !== publishNavTeamStatusRequestId) return;

        const latestSessionUserId =
          lastSession && lastSession.user && lastSession.user.id
            ? String(lastSession.user.id).trim()
            : "";
        if (!latestSessionUserId || latestSessionUserId !== userId) return;

        publishNavTeamStatusCache = {
          userId,
          inTeam: false
        };
        setPublishNavLinkLabel("Đăng truyện");
      });
  };

  setPublishNavLinkLabel("Đăng truyện");

  const applyAuthState = (session, eventName) => {
    const safeSession = session && session.user ? session : null;
    const signedIn = Boolean(safeSession && safeSession.user);
    const previousSignedIn = Boolean(lastSession && lastSession.user);
    lastSession = safeSession;
    sessionLoaded = true;

    if (!signedIn) {
      cachedUserId = "";
      cachedUsername = "";
      setMeProfile(null);
      setUsernameWidgets("");
    }

    writeAuthHint(signedIn);
    setAuthRootState(true, signedIn ? "in" : "out");
    setMemberOnlyNavVisibility(signedIn);
    updatePublishNavLinkLabel(lastSession);
    updateWidgets(lastSession);
    updateCommentForms(lastSession);

    const shouldAutoLoadNotifications =
      !document.body || !document.body.hasAttribute("data-disable-notifications-client");

    if (signedIn) {
      refreshProfileForSession(lastSession).catch(() => null);
      if (shouldAutoLoadNotifications) {
        ensureNotificationsClientLoaded().catch(() => null);
      }
    }

    const event = eventName || (signedIn ? (previousSignedIn ? "TOKEN_REFRESHED" : "SIGNED_IN") : "SIGNED_OUT");
    emitAuthStateChange(event, lastSession);

    try {
      window.dispatchEvent(
        new CustomEvent("bfang:auth", {
          detail: {
            session: lastSession,
            signedIn
          }
        })
      );
    } catch (_err) {
      // ignore
    }
  };

  const requestSession = async () => {
    const response = await fetch("/auth/session", {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin",
      cache: "no-store"
    }).catch(() => null);

    if (!response) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      return null;
    }

    const session = data && data.session && data.session.user ? data.session : null;
    return session;
  };

  const loadSession = ({ force } = {}) => {
    const shouldForce = Boolean(force);
    if (!shouldForce && sessionLoaded) {
      return Promise.resolve(lastSession);
    }

    if (!shouldForce && sessionRequestPromise) {
      return sessionRequestPromise;
    }

    sessionRequestPromise = requestSession()
      .then((session) => {
        applyAuthState(session, shouldForce ? "TOKEN_REFRESHED" : undefined);
        return lastSession;
      })
      .catch(() => {
        applyAuthState(null, "SIGNED_OUT");
        return null;
      })
      .finally(() => {
        sessionRequestPromise = null;
      });

    return sessionRequestPromise;
  };

  const signInWithProvider = async (provider) => {
    const safeProvider = storePreferredAuthProvider(provider);
    const next = getSafeNext();
    const target = `/auth/${encodeURIComponent(safeProvider)}?next=${encodeURIComponent(next)}`;
    window.location.assign(target);
  };

  const signInWithGoogle = async () => signInWithProvider("google");
  const signInWithDiscord = async () => signInWithProvider("discord");

  const signOut = async () => {
    await fetch("/auth/logout", {
      method: "POST",
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin"
    }).catch(() => null);

    applyAuthState(null, "SIGNED_OUT");
  };

  const getSession = async () => {
    const session = await loadSession({ force: false });
    return session;
  };

  const getAccessToken = async () => {
    const session = await getSession();
    if (!session || !session.access_token) return "";
    return String(session.access_token).trim();
  };

  const refreshUi = async () => {
    return loadSession({ force: true });
  };

  const requestUpdateUser = async (payload) => {
    const response = await fetch("/auth/profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({ data: payload && typeof payload === "object" ? payload : {} })
    }).catch(() => null);

    if (!response) {
      return {
        data: null,
        error: { message: "Không thể kết nối hệ thống đăng nhập." }
      };
    }

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.error) {
      const message =
        data && data.error && data.error.message
          ? String(data.error.message)
          : "Không thể cập nhật tài khoản.";
      return {
        data: null,
        error: { message }
      };
    }

    const user = data && data.data && data.data.user ? data.data.user : null;
    if (user && lastSession && lastSession.user) {
      lastSession = {
        ...lastSession,
        user
      };
      updateWidgets(lastSession);
      updateCommentForms(lastSession);
      emitAuthStateChange("USER_UPDATED", lastSession);
    }

    return {
      data: data.data || null,
      error: null
    };
  };

  const client = {
    auth: {
      getSession: async () => {
        const session = await getSession();
        return {
          data: { session },
          error: null
        };
      },
      signOut: async () => {
        await signOut();
        return { error: null };
      },
      updateUser: async ({ data } = {}) => {
        return requestUpdateUser(data || {});
      },
      onAuthStateChange: (callback) => {
        if (typeof callback !== "function") {
          return {
            data: {
              subscription: {
                unsubscribe: () => {}
              }
            }
          };
        }
        authStateListeners.add(callback);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                authStateListeners.delete(callback);
              }
            }
          }
        };
      }
    }
  };

  const ensureAuthLoginDialog = () => {
    const existing = document.querySelector("[data-auth-login-dialog]");
    if (existing) return existing;

    const dialog = document.createElement("dialog");
    dialog.className = "modal auth-login-popup";
    dialog.setAttribute("data-auth-login-dialog", "");
    dialog.setAttribute("aria-label", "Chọn phương thức đăng nhập");
    dialog.innerHTML = `
      <div class="modal-card auth-login-popup__card">
        <div class="modal-head">
          <h2 class="modal-title">Đăng nhập</h2>
          <button class="modal-close" type="button" data-auth-login-close aria-label="Đóng">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12" />
              <path d="M18 6l-12 12" />
            </svg>
          </button>
        </div>
        <p class="modal-body">Chọn phương thức đăng nhập.</p>
        <div class="auth-login-popup__providers">
          <button
            class="button button--ghost auth-login-popup__provider auth-login-popup__provider--google"
            type="button"
            data-auth-login-provider="google"
          >
            <img class="auth-login-popup__provider-icon-image" src="/images/google.svg" alt="" aria-hidden="true" />
            <span>Google</span>
          </button>
          <button
            class="button button--ghost auth-login-popup__provider auth-login-popup__provider--discord"
            type="button"
            data-auth-login-provider="discord"
          >
            <img class="auth-login-popup__provider-icon-image" src="/images/discord.svg" alt="" aria-hidden="true" />
            <span>Discord</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    const googleBtn = dialog.querySelector("[data-auth-login-provider='google']");
    const discordBtn = dialog.querySelector("[data-auth-login-provider='discord']");
    if (googleBtn) googleBtn.hidden = !authProviderEnabled.google;
    if (discordBtn) discordBtn.hidden = !authProviderEnabled.discord;

    return dialog;
  };

  const loginProviderDialog = ensureAuthLoginDialog();
  const supportsLoginProviderDialog =
    Boolean(loginProviderDialog) && typeof loginProviderDialog.showModal === "function";

  const closeLoginProviderDialog = () => {
    if (!supportsLoginProviderDialog || !loginProviderDialog || !loginProviderDialog.open) return;
    loginProviderDialog.close();
  };

  const closeAuthMenus = () => {
    document.querySelectorAll("[data-auth-menu]").forEach((menu) => {
      menu.hidden = true;
    });
    document.querySelectorAll("[data-auth-menu-toggle]").forEach((toggle) => {
      toggle.setAttribute("aria-expanded", "false");
    });
    closeLoginProviderDialog();
  };

  const headerNavToggle = document.querySelector("[data-header-nav-toggle]");
  const headerNav = document.getElementById("site-nav-links");

  const setKomaSliceBackground = (sliceLink) => {
    if (!(sliceLink instanceof HTMLElement)) return;
    if (sliceLink.dataset.bgReady === "1") return;
    const source = (sliceLink.getAttribute("data-bg") || "").toString().trim();
    if (!source) return;
    const escapedSource = source.replace(/"/g, '\\"');
    sliceLink.style.backgroundImage = `url("${escapedSource}"), var(--koma-placeholder-image)`;
    sliceLink.dataset.bgReady = "1";
    sliceLink.removeAttribute("data-bg");
    sliceLink.classList.add("is-bg-ready");
  };

  const initKomaInfiniteLoop = () => {
    document.querySelectorAll(".koma-stream-ranking-list").forEach((stream) => {
      if (!(stream instanceof HTMLElement) || stream.dataset.komaLoopReady === "1") return;

      const originalBlocks = Array.from(stream.querySelectorAll(":scope > .koma-stream-ranking-list-block"));
      if (originalBlocks.length < 2) return;

      stream.dataset.komaLoopReady = "1";
      stream.classList.add("is-loop-ready");

      const createLoopClone = (block) => {
        const clone = block.cloneNode(true);
        clone.setAttribute("aria-hidden", "true");
        return clone;
      };

      for (let index = originalBlocks.length - 1; index >= 0; index -= 1) {
        stream.insertBefore(createLoopClone(originalBlocks[index]), stream.firstChild);
      }

      originalBlocks.forEach((block) => {
        stream.appendChild(createLoopClone(block));
      });

      let segmentStart = 0;
      let segmentWidth = 0;

      const updateLoopMetrics = () => {
        const firstOriginal = originalBlocks[0];
        const lastOriginal = originalBlocks[originalBlocks.length - 1];
        if (!firstOriginal || !lastOriginal) return;
        segmentStart = firstOriginal.offsetLeft;
        segmentWidth = Math.max(lastOriginal.offsetLeft + lastOriginal.offsetWidth - segmentStart, 1);
      };

      const normalizeLoopPosition = () => {
        if (!segmentWidth) return;

        const minScroll = segmentStart;
        const maxScroll = segmentStart + segmentWidth;
        let nextScrollLeft = stream.scrollLeft;

        while (nextScrollLeft < minScroll) {
          nextScrollLeft += segmentWidth;
        }
        while (nextScrollLeft >= maxScroll) {
          nextScrollLeft -= segmentWidth;
        }

        if (nextScrollLeft !== stream.scrollLeft) {
          stream.scrollLeft = nextScrollLeft;
        }
      };

      let loopRafId = 0;
      const queueNormalizeLoopPosition = () => {
        if (loopRafId) return;
        loopRafId = window.requestAnimationFrame(() => {
          loopRafId = 0;
          normalizeLoopPosition();
        });
      };

      updateLoopMetrics();
      stream.scrollLeft = segmentStart;
      normalizeLoopPosition();

      stream.addEventListener("scroll", queueNormalizeLoopPosition, { passive: true });
      window.addEventListener(
        "resize",
        () => {
          const previousOffset = stream.scrollLeft - segmentStart;
          updateLoopMetrics();
          stream.scrollLeft = segmentStart + previousOffset;
          normalizeLoopPosition();
        },
        { passive: true }
      );
    });
  };

  const initKomaSliceLazyBackgrounds = () => {
    document.querySelectorAll(".koma-stream-ranking-list").forEach((stream) => {
      if (!(stream instanceof HTMLElement) || stream.dataset.komaLazyReady === "1") return;
      stream.dataset.komaLazyReady = "1";

      let rafId = 0;

      const loadVisibleSlices = () => {
        rafId = 0;
        const streamRect = stream.getBoundingClientRect();
        if (!streamRect.width || !streamRect.height) return;
        const preloadDistance = 180;

        stream.querySelectorAll("a[data-bg]").forEach((sliceLink) => {
          if (!(sliceLink instanceof HTMLElement)) return;
          const sliceRect = sliceLink.getBoundingClientRect();
          const isWithinRange =
            sliceRect.right >= streamRect.left - preloadDistance &&
            sliceRect.left <= streamRect.right + preloadDistance;
          if (!isWithinRange) return;
          setKomaSliceBackground(sliceLink);
        });
      };

      const queueLoadVisibleSlices = () => {
        if (rafId) return;
        rafId = window.requestAnimationFrame(loadVisibleSlices);
      };

      queueLoadVisibleSlices();
      stream.addEventListener("scroll", queueLoadVisibleSlices, { passive: true });
      window.addEventListener("resize", queueLoadVisibleSlices, { passive: true });
    });
  };

  const scheduleNonCriticalTask = (callback) => {
    if (typeof callback !== "function") return;
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(
        () => {
          callback();
        },
        { timeout: 1200 }
      );
      return;
    }
    window.setTimeout(callback, 220);
  };

  const bootstrapKomaStreams = () => {
    initKomaInfiniteLoop();
    initKomaSliceLazyBackgrounds();
    initKomaStreamMouseDrag();
  };

  const initKomaStreamsDeferred = () => {
    const streams = Array.from(document.querySelectorAll(".koma-stream-ranking-list")).filter(
      (stream) => stream instanceof HTMLElement
    );
    if (!streams.length) return;

    const fallbackBootstrap = () => {
      scheduleNonCriticalTask(bootstrapKomaStreams);
    };

    const watchVisibility = () => {
      if (!("IntersectionObserver" in window)) {
        fallbackBootstrap();
        return;
      }

      let didTrigger = false;

      const observer = new IntersectionObserver(
        (entries) => {
          const shouldBootstrap = entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0);
          if (!shouldBootstrap) return;
          didTrigger = true;
          observer.disconnect();
          fallbackBootstrap();
        },
        {
          root: null,
          rootMargin: "320px 0px 320px 0px",
          threshold: 0.01
        }
      );

      streams.forEach((stream) => {
        observer.observe(stream);
      });

      window.setTimeout(() => {
        if (didTrigger) return;
        observer.disconnect();
        fallbackBootstrap();
      }, 1800);
    };

    if (document.readyState === "complete") {
      watchVisibility();
    } else {
      window.addEventListener("load", watchVisibility, { once: true });
    }

    window.addEventListener(
      "pageshow",
      () => {
        fallbackBootstrap();
      },
      { once: true }
    );
  };

  const initKomaStreamMouseDrag = () => {
    document.querySelectorAll(".koma-stream-ranking-list").forEach((stream) => {
      if (!(stream instanceof HTMLElement) || stream.dataset.komaDragReady === "1") return;
      stream.dataset.komaDragReady = "1";

      let activePointerId = null;
      let startClientX = 0;
      let startScrollLeft = 0;
      let dragging = false;
      let suppressClickUntil = 0;
      const dragThreshold = 8;

      const handlePointerMove = (event) => {
        if (activePointerId == null || event.pointerId !== activePointerId) return;

        const deltaX = event.clientX - startClientX;
        if (!dragging && Math.abs(deltaX) > dragThreshold) {
          dragging = true;
          stream.classList.add("is-dragging");
        }

        if (!dragging) return;
        event.preventDefault();
        stream.scrollLeft = startScrollLeft - deltaX;
      };

      const endDrag = (event) => {
        if (activePointerId == null || event.pointerId !== activePointerId) return;

        const deltaX = event.clientX - startClientX;
        if (dragging && Math.abs(deltaX) > dragThreshold) {
          suppressClickUntil = Date.now() + 180;
        }

        stream.classList.remove("is-dragging");
        activePointerId = null;
        startClientX = 0;
        startScrollLeft = 0;
        dragging = false;
      };

      stream.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        activePointerId = event.pointerId;
        startClientX = event.clientX;
        startScrollLeft = stream.scrollLeft;
        dragging = false;
      });

      window.addEventListener("pointermove", handlePointerMove, { passive: false });
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);

      stream.addEventListener("dragstart", (event) => {
        event.preventDefault();
      });

      stream.addEventListener(
        "click",
        (event) => {
          if (Date.now() > suppressClickUntil) return;
          suppressClickUntil = 0;
          event.preventDefault();
          event.stopPropagation();
        },
        true
      );
    });
  };

  const setHeaderNavOpen = (open) => {
    if (!headerNav || !headerNavToggle) return;
    const shouldOpen = Boolean(open);
    headerNav.classList.toggle("hidden", !shouldOpen);
    headerNavToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  };

  const closeHeaderNav = () => {
    setHeaderNavOpen(false);
  };

  if (headerNav && headerNavToggle) {
    const initialOpen = !headerNav.classList.contains("hidden");
    headerNavToggle.setAttribute("aria-expanded", initialOpen ? "true" : "false");
  }

  initKomaStreamsDeferred();
  window.addEventListener("bfang:pagechange", () => {
    bootstrapKomaStreams();
  });

  const openLoginProviderDialog = ({ silent } = {}) => {
    const shouldSilenceAlert = Boolean(silent);

    if (!authProviderEnabled.google && !authProviderEnabled.discord) {
      if (!shouldSilenceAlert) {
        window.alert("Đăng nhập OAuth chưa được cấu hình.");
      }
      return;
    }

    if (!supportsLoginProviderDialog || !loginProviderDialog) {
      signInWithProvider(preferredAuthProvider || "google").catch(() => {
        window.alert("Không thể mở đăng nhập. Vui lòng thử lại.");
      });
      return;
    }

    closeAuthMenus();
    loginProviderDialog.showModal();
    const firstOption = loginProviderDialog.querySelector("[data-auth-login-provider]:not([hidden])");
    if (firstOption && typeof firstOption.focus === "function") {
      firstOption.focus();
    }
  };

  const signIn = async () => {
    openLoginProviderDialog();
  };

  const confirmLogout = async () => {
    const payload = {
      title: "Đăng xuất?",
      body: "Bạn sẽ cần đăng nhập lại để tiếp tục bình luận và đồng bộ dữ liệu.",
      confirmText: "Đăng xuất",
      confirmVariant: "danger",
      fallbackText: "Bạn có chắc muốn đăng xuất không?"
    };

    if (window.BfangConfirm && typeof window.BfangConfirm.confirm === "function") {
      return window.BfangConfirm.confirm(payload);
    }

    return window.confirm(payload.fallbackText);
  };

  if (supportsLoginProviderDialog && loginProviderDialog) {
    const loginDialogCloseBtn = loginProviderDialog.querySelector("[data-auth-login-close]");
    if (loginDialogCloseBtn) {
      loginDialogCloseBtn.addEventListener("click", () => {
        closeLoginProviderDialog();
      });
    }

    loginProviderDialog.addEventListener("click", (event) => {
      if (event.target === loginProviderDialog) {
        closeLoginProviderDialog();
      }
    });

    loginProviderDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeLoginProviderDialog();
    });
  }

  document.addEventListener("click", async (event) => {
    const headerToggle = event.target.closest("[data-header-nav-toggle]");
    if (headerToggle && headerNav) {
      event.preventDefault();
      const willOpen = headerNav.classList.contains("hidden");
      closeAuthMenus();
      setHeaderNavOpen(willOpen);
      return;
    }

    const headerNavLink = event.target.closest("#site-nav-links a");
    if (headerNavLink) {
      closeHeaderNav();
      return;
    }

    const toggle = event.target.closest("[data-auth-menu-toggle]");
    if (toggle) {
      const container = toggle.closest("[data-auth-profile]") || toggle.parentElement;
      const menu = container ? container.querySelector("[data-auth-menu]") : null;
      if (!menu) return;
      const willOpen = menu.hidden;
      closeHeaderNav();
      closeAuthMenus();
      if (willOpen) {
        menu.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
      }
      return;
    }

    const loginProviderBtn = event.target.closest("[data-auth-login-provider]");
    if (loginProviderBtn) {
      event.preventDefault();
      closeAuthMenus();
      const requestedProvider =
        loginProviderBtn && loginProviderBtn.getAttribute
          ? loginProviderBtn.getAttribute("data-auth-login-provider") || ""
          : "";
      signInWithProvider(requestedProvider || preferredAuthProvider || "google").catch(() => {
        window.alert("Không thể mở đăng nhập. Vui lòng thử lại.");
      });
      return;
    }

    const loginBtn = event.target.closest("[data-auth-login]");
    if (loginBtn) {
      event.preventDefault();
      openLoginProviderDialog();
      return;
    }

    const logoutBtn = event.target.closest("[data-auth-logout]");
    if (logoutBtn) {
      event.preventDefault();
      closeAuthMenus();
      const ok = await confirmLogout();
      if (!ok) return;
      signOut().catch(() => {
        window.alert("Không thể đăng xuất. Vui lòng thử lại.");
      });
      return;
    }

    if (
      !event.target.closest("[data-auth-menu]") &&
      !event.target.closest("[data-auth-menu-toggle]") &&
      !event.target.closest("[data-auth-login-dialog]")
    ) {
      closeAuthMenus();
    }

    if (!event.target.closest("#site-nav-links") && !event.target.closest("[data-header-nav-toggle]")) {
      closeHeaderNav();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAuthMenus();
      closeHeaderNav();
    }
  });

  window.BfangAuth = {
    client,
    signIn,
    signInWithProvider,
    signInWithGoogle,
    signInWithDiscord,
    signOut,
    getSession,
    getAccessToken,
    getMeProfile: () => cachedProfile,
    refreshUi,
    setAvatarPreview,
    clearAvatarPreview,
    me: null
  };

  loadSession({ force: true })
    .then(() => {
      if (!shouldAutoOpenLoginDialogFromUrl) return;
      if (lastSession && lastSession.user) return;
      openLoginProviderDialog({ silent: true });
    })
    .catch(() => {
      applyAuthState(null, "SIGNED_OUT");
      if (!shouldAutoOpenLoginDialogFromUrl) return;
      openLoginProviderDialog({ silent: true });
    });
})();
