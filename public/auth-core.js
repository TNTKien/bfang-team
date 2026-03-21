(() => {
  if (typeof window === "undefined") return;

  window.BfangAuthModules = window.BfangAuthModules || {};

  window.BfangAuthModules.createCore = ({ authRoot, authConfig }) => {
    const providerConfig =
      authConfig && typeof authConfig.providers === "object" && authConfig.providers
        ? authConfig.providers
        : {};

    const authHintStorageKey = "bfang_auth_hint";
    const authProviderStorageKey = "bfang_auth_provider";
    const authServerSessionVersionStorageKey = "bfang_server_session_version";
    const supportedAuthProviders = ["google", "discord"];
    const notificationsScriptDefaultPath = "/notifications.js";
    const authProfileUsernamePattern = /^[a-z0-9_]{1,24}$/i;

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
    let preferredAuthProvider = "google";
    let publicApi = null;

    const authStateListeners = new Set();
    let cachedUserId = "";
    let cachedUsername = "";
    let cachedProfile = null;
    let avatarPreviewOverride = "";
    let profileFetchPromise = null;
    let sessionRequestPromise = null;
    let sessionLoaded = false;
    let lastSession = null;
    const shouldAutoLoadNotifications =
      !document.body || !document.body.hasAttribute("data-disable-notifications-client");

    const readInitialAuthState = () => {
      const initialState = authConfig && authConfig.initialState && typeof authConfig.initialState === "object"
        ? authConfig.initialState
        : null;
      const session = initialState && initialState.session && initialState.session.user
        ? initialState.session
        : null;

      return {
        hasServerState: Boolean(initialState && initialState.hasServerState === true),
        session
      };
    };

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
      const nextHint = signedIn ? "in" : "out";
      let shouldInvalidatePageCache = true;
      try {
        const previousHint = (window.localStorage.getItem(authHintStorageKey) || "").toString().trim();
        shouldInvalidatePageCache = previousHint !== nextHint;
        window.localStorage.setItem(authHintStorageKey, nextHint);
      } catch (_err) {
        // ignore
      }

      if (!shouldInvalidatePageCache) return;

      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        const currentUrl = (window.location && window.location.href ? String(window.location.href).trim() : "") || "";
        const postInvalidate = (worker) => {
          if (!worker || typeof worker.postMessage !== "function") return;
          worker.postMessage({
            type: "INVALIDATE_ALL_PAGE_CACHE"
          });
          if (currentUrl) {
            worker.postMessage({
              type: "INVALIDATE_PAGE_CACHE",
              urls: [currentUrl]
            });
          }
        };

        try {
          postInvalidate(navigator.serviceWorker.controller);
        } catch (_err) {
          // ignore
        }

        navigator.serviceWorker.ready
          .then((registration) => {
            if (!registration) return;
            postInvalidate(registration.active || registration.waiting || registration.installing);
          })
          .catch(() => null);
      }
    };

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

    preferredAuthProvider = readPreferredAuthProvider();

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

    const emitAuthStateChange = (event, session) => {
      authStateListeners.forEach((listener) => {
        try {
          listener(event, session);
        } catch (_err) {
          // ignore listener failure
        }
      });
    };

    const buildProfilePathFromUsername = (value) => {
      const username = (value || "").toString().trim().toLowerCase();
      if (!authProfileUsernamePattern.test(username)) return "";
      return `/user/${encodeURIComponent(username)}`;
    };

    const setMeProfile = (profile) => {
      cachedProfile = profile && typeof profile === "object" ? profile : null;
      if (publicApi) {
        publicApi.me = cachedProfile;
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

      return data && data.session && data.session.user ? data.session : null;
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

    const refreshUi = async (options = {}) => {
      const shouldForce = Boolean(options && options.force === true);
      return loadSession({ force: shouldForce });
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
        updateUser: async ({ data } = {}) => requestUpdateUser(data || {}),
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

    const setAvatarPreview = (url) => {
      avatarPreviewOverride = normalizeAvatarCandidate(url);
      updateWidgets(lastSession);
    };

    const clearAvatarPreview = () => {
      avatarPreviewOverride = "";
      updateWidgets(lastSession);
    };

    const forceSignOutOnServerRestart = detectServerSessionVersionChange(authConfig.sessionVersion || "");
    if (forceSignOutOnServerRestart) {
      writeAuthHint(false);
    }

    const initialAuthState = readInitialAuthState();
    const hasInitialServerState = !forceSignOutOnServerRestart && initialAuthState.hasServerState;
    const initialSession = hasInitialServerState ? initialAuthState.session : null;
    const initialSignedIn = Boolean(initialSession && initialSession.user);
    const initialPublishNavState =
      hasInitialServerState && initialAuthState.publishNav && typeof initialAuthState.publishNav === "object"
        ? initialAuthState.publishNav
        : null;
    const hasInitialPublishNavState =
      Boolean(initialPublishNavState) && typeof initialPublishNavState.inTeam === "boolean";

    if (hasInitialServerState) {
      lastSession = initialSession;
      sessionLoaded = true;

      publishNavTeamStatusCache = {
        userId:
          initialSignedIn && hasInitialPublishNavState && initialSession && initialSession.user && initialSession.user.id
            ? String(initialSession.user.id).trim()
            : "",
        inTeam: Boolean(initialSignedIn && hasInitialPublishNavState && initialPublishNavState.inTeam)
      };

      if (!initialSignedIn) {
        cachedUserId = "";
        cachedUsername = "";
        setMeProfile(null);
        setUsernameWidgets("");
      }

      writeAuthHint(initialSignedIn);
      setAuthRootState(true, initialSignedIn ? "in" : "out");
      setMemberOnlyNavVisibility(initialSignedIn);
      updatePublishNavLinkLabel(lastSession);
      updateWidgets(lastSession);
      updateCommentForms(lastSession);

      if (initialSignedIn) {
        if (shouldAutoLoadNotifications) {
          ensureNotificationsClientLoaded().catch(() => null);
        }
        refreshProfileForSession(lastSession).catch(() => null);
      }
    } else {
      setAuthRootState(false, forceSignOutOnServerRestart ? "out" : readAuthHint());
      setPublishNavLinkLabel("Đăng truyện");
    }

    return {
      authProviderEnabled,
      getPreferredAuthProvider: () => preferredAuthProvider,
      signInWithProvider,
      signInWithGoogle: async () => signInWithProvider("google"),
      signInWithDiscord: async () => signInWithProvider("discord"),
      signOut,
      getSession,
      getAccessToken,
      refreshUi,
      client,
      setAvatarPreview,
      clearAvatarPreview,
      getMeProfile: () => cachedProfile,
      setPublicApi: (api) => {
        publicApi = api && typeof api === "object" ? api : null;
        if (publicApi) {
          publicApi.me = cachedProfile;
        }
      },
      loadInitialSession: ({ shouldAutoOpenLoginDialogFromUrl, openLoginProviderDialog }) =>
        loadSession({ force: !hasInitialServerState || !initialSignedIn })
          .then(() => {
            if (!shouldAutoOpenLoginDialogFromUrl) return;
            if (lastSession && lastSession.user) return;
            if (typeof openLoginProviderDialog === "function") {
              openLoginProviderDialog({ silent: true });
            }
          })
          .catch(() => {
            applyAuthState(null, "SIGNED_OUT");
            if (!shouldAutoOpenLoginDialogFromUrl) return;
            if (typeof openLoginProviderDialog === "function") {
              openLoginProviderDialog({ silent: true });
            }
          })
    };
  };
})();
