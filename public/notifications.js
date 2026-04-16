(() => {
  window.__BFANG_NOTIFICATIONS_BOOTED = true;

  const COMMENT_TARGET_REVEAL_EVENT = "bfang:reveal-comment-target";
  const READER_LAYOUT_CHANGED_EVENT = "bfang:reader-layout-changed";
  const NOTIFY_MENU_EDGE_GAP = 8;
  const NOTIFY_MENU_TOP_GAP = 8;
  const NOTIFY_MENU_MAX_WIDTH = 360;
  const NOTIFY_REALTIME_RETRY_BASE_MS = 5000;
  const NOTIFY_REALTIME_RETRY_MAX_MS = 60 * 1000;
  const NOTIFY_REALTIME_DEBOUNCE_MS = 350;
  const NOTIFY_FALLBACK_POLL_MS = 60 * 1000;
  const NOTIFY_STALE_STREAM_MS = 75 * 1000;
  const NOTIFY_REALTIME_HEALTH_TICK_MS = 20 * 1000;
  const NOTIFY_FETCH_TIMEOUT_MS = 10000;
  const PUSH_SYNC_THROTTLE_MS = 30 * 1000;
  const PUSH_PERMISSION_PROMPT_COOLDOWN_MS = 60 * 1000;
  const PUSH_SYNC_CROSS_TAB_LOCK_TTL_MS = 12 * 1000;
  const PUSH_SYNC_LOCK_KEY = "__bfang_push_sync_lock";
  const PUSH_PERMISSION_PROMPT_TS_KEY = "__bfang_push_prompt_last_at";
  const PUSH_SYNC_RETRY_DELAY_MS = PUSH_SYNC_CROSS_TAB_LOCK_TTL_MS + 300;

  const hasAuthSession = (session) =>
    Boolean(
      session &&
        ((session.user && typeof session.user === "object") ||
          (session.access_token && String(session.access_token).trim()))
    );

  const getSessionSafe = async () => {
    if (!window.BfangAuth || typeof window.BfangAuth.getSession !== "function") return null;
    try {
      const session = await window.BfangAuth.getSession();
      return hasAuthSession(session) ? session : null;
    } catch (_err) {
      return null;
    }
  };

  const getAccessTokenSafe = async () => {
    const session = await getSessionSafe();
    if (session && session.access_token) {
      return String(session.access_token).trim();
    }
    return "";
  };

  const isDocumentVisible = () =>
    !document.visibilityState || document.visibilityState === "visible";

  const createAbortTimeout = (timeoutMs) => {
    const maxMs = Number(timeoutMs);
    if (!window.AbortController || !Number.isFinite(maxMs) || maxMs <= 0) {
      return { signal: undefined, cleanup: () => {} };
    }

    const controller = new window.AbortController();
    const timer = window.setTimeout(() => {
      try {
        controller.abort();
      } catch (_err) {
        // ignore
      }
    }, Math.floor(maxMs));

    return {
      signal: controller.signal,
      cleanup: () => {
        window.clearTimeout(timer);
      }
    };
  };

  const createAvatarIcon = (notificationType) => {
    const type = notificationType == null ? "" : String(notificationType).trim().toLowerCase();
    const icon = document.createElement("span");
    icon.className = "notify-item__avatar-icon";
    icon.style.width = "16px";
    icon.style.height = "16px";
    icon.style.display = "inline-flex";
    icon.style.alignItems = "center";
    icon.style.justifyContent = "center";
    icon.style.flexShrink = "0";

    if (type === "manga_bookmark_new_chapter") {
      icon.innerHTML =
        "<svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true'><path d='M6.5 3.8h11a1.7 1.7 0 0 1 1.7 1.7v14.7l-2.7-1.8-2.7 1.8-2.7-1.8-2.7 1.8-2.7-1.8V5.5a1.7 1.7 0 0 1 1.7-1.7z' stroke='currentColor' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>";
      return icon;
    }

    if (type === "team_manga_comment") {
      icon.innerHTML =
        "<svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true'><circle cx='9' cy='8.3' r='2.4' stroke='currentColor' stroke-width='1.9' fill='none'/><path d='M4.9 16.8c.8-2.1 2.4-3.2 4.1-3.2s3.3 1.1 4.1 3.2' stroke='currentColor' stroke-width='1.9' fill='none' stroke-linecap='round'/><circle cx='16.6' cy='9.1' r='2' stroke='currentColor' stroke-width='1.9' fill='none'/><path d='M13.8 16.7c.6-1.7 1.9-2.6 3.2-2.6 1 0 2 .5 2.8 1.6' stroke='currentColor' stroke-width='1.9' fill='none' stroke-linecap='round'/></svg>";
      return icon;
    }

    if (
      type === "forum_post_comment" ||
      type === "comment_reply" ||
      type === "mention"
    ) {
      icon.innerHTML =
        "<svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true'><path d='M21 14.2a3.8 3.8 0 0 1-3.8 3.8H9l-4.5 3v-3.4A3.8 3.8 0 0 1 1 13.8V6.8A3.8 3.8 0 0 1 4.8 3h12.4A3.8 3.8 0 0 1 21 6.8z' stroke='currentColor' stroke-width='1.9' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>";
      return icon;
    }

    icon.innerHTML =
      "<svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true'><path d='M6.8 9a5.2 5.2 0 1 1 10.4 0v3.1c0 .8.3 1.5.8 2.1l1.1 1.3H5l1.1-1.3c.5-.6.8-1.3.8-2.1z' stroke='currentColor' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/><path d='M9.8 18.1a2.2 2.2 0 0 0 4.4 0' stroke='currentColor' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>";
    return icon;
  };

  const buildAvatar = (item) => {
    const wrap = document.createElement("span");
    wrap.className = "notify-item__avatar";
    const notification = item && typeof item === "object" ? item : {};
    const avatarUrl = notification.actorAvatarUrl;
    const notificationType = notification.type == null ? "" : String(notification.type).trim().toLowerCase();
    const fallbackIcon = createAvatarIcon(notificationType);

    const applyFallback = () => {
      wrap.textContent = "";
      wrap.appendChild(fallbackIcon.cloneNode(true));
    };

    const raw = avatarUrl == null ? "" : String(avatarUrl).trim();
    const safe = raw && raw.length <= 500 && (/^https?:\/\//i.test(raw) || raw.startsWith("/uploads/avatars/"));
    if (safe) {
      const image = document.createElement("img");
      image.src = raw;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", applyFallback);
      wrap.appendChild(image);
      return wrap;
    }

    applyFallback();
    return wrap;
  };

  const normalizeNotification = (rawItem) => {
    const item = rawItem && typeof rawItem === "object" ? rawItem : {};
    const id = Number(item.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    const rawUrl = item.url == null ? "" : String(item.url).trim();
    const url = rawUrl && rawUrl.startsWith("/") ? rawUrl : "/";
    return {
      id: Math.floor(id),
      type: item.type == null ? "" : String(item.type).trim().toLowerCase(),
      isRead: Boolean(item.isRead),
      actorName: item.actorName == null ? "" : String(item.actorName).trim(),
      actorAvatarUrl: item.actorAvatarUrl == null ? "" : String(item.actorAvatarUrl).trim(),
      message: item.message == null ? "" : String(item.message).trim(),
      mangaTitle: item.mangaTitle == null ? "" : String(item.mangaTitle).trim(),
      chapterLabel: item.chapterLabel == null ? "" : String(item.chapterLabel).trim(),
      preview: item.preview == null ? "" : String(item.preview).trim(),
      createdAtText: item.createdAtText == null ? "" : String(item.createdAtText).trim(),
      url
    };
  };

  const createWidgets = ({
    rootSelector,
    toggleSelector,
    menuSelector,
    badgeSelector,
    listSelector,
    emptySelector,
    markAllSelector,
    moreSelector,
    channel,
    requiresTeamMembership
  }) => {
    const roots = Array.from(document.querySelectorAll(rootSelector));
    if (!roots.length) return [];

    return roots
      .map((root) => {
        const toggle = root.querySelector(toggleSelector);
        const menu = root.querySelector(menuSelector);
        const badge = root.querySelector(badgeSelector);
        const list = root.querySelector(listSelector);
        const empty = root.querySelector(emptySelector);
        const markAllBtn = root.querySelector(markAllSelector);
        const moreLink = moreSelector ? root.querySelector(moreSelector) : null;
        if (!toggle || !menu || !badge || !list || !empty || !markAllBtn) return null;

        return {
          root,
          toggle,
          menu,
          badge,
          list,
          empty,
          markAllBtn,
          moreLink,
          channel,
          requiresTeamMembership: Boolean(requiresTeamMembership),
          visible: !root.hidden,
          loading: false,
          unreadCount: 0,
          notifications: [],
          moreUrl: "/publish"
        };
      })
      .filter(Boolean);
  };

  const widgets = [
    ...createWidgets({
      rootSelector: "[data-notify-widget]",
      toggleSelector: "[data-notify-toggle]",
      menuSelector: "[data-notify-menu]",
      badgeSelector: "[data-notify-badge]",
      listSelector: "[data-notify-list]",
      emptySelector: "[data-notify-empty]",
      markAllSelector: "[data-notify-mark-all]",
      channel: "default",
      requiresTeamMembership: false
    }),
    ...createWidgets({
      rootSelector: "[data-team-notify-widget]",
      toggleSelector: "[data-team-notify-toggle]",
      menuSelector: "[data-team-notify-menu]",
      badgeSelector: "[data-team-notify-badge]",
      listSelector: "[data-team-notify-list]",
      emptySelector: "[data-team-notify-empty]",
      markAllSelector: "[data-team-notify-mark-all]",
      moreSelector: "[data-team-notify-more]",
      channel: "team",
      requiresTeamMembership: true
    })
  ];

  if (!widgets.length) return;

  const widgetsByChannel = new Map();
  widgets.forEach((widget) => {
    if (!widgetsByChannel.has(widget.channel)) {
      widgetsByChannel.set(widget.channel, []);
    }
    widgetsByChannel.get(widget.channel).push(widget);
  });

  const getChannelWidgets = (channel) => widgetsByChannel.get(channel) || [];
  const getPrimaryChannelWidget = (channel) => {
    const channelWidgets = getChannelWidgets(channel);
    return channelWidgets.length ? channelWidgets[0] : null;
  };

  const initialTeamWidget = getPrimaryChannelWidget("team");

  let signedIn = false;
  let inTeam = Boolean(initialTeamWidget && !initialTeamWidget.root.hidden);
  let pollingTimer = null;
  let realtimeStream = null;
  let realtimeRetryTimer = null;
  let realtimeRefreshTimer = null;
  let realtimeHealthTimer = null;
  let realtimeConnected = false;
  let realtimeBackoffMs = NOTIFY_REALTIME_RETRY_BASE_MS;
  let lastRealtimeEventAt = 0;
  let teamMembershipRequestPromise = null;
  let pushSyncPromise = null;
  let lastPushSyncAt = 0;
  let pushPermissionPromptedAt = 0;
  let pushSyncRetryTimer = null;

  const parseJsonObjectSafe = (value) => {
    if (typeof value !== "string" || !value) return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_error) {
      return null;
    }
  };

  const randomLockToken = () => {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
      }
    } catch (_error) {
      // ignore
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const readPushSyncLock = () => {
    try {
      return parseJsonObjectSafe(window.localStorage.getItem(PUSH_SYNC_LOCK_KEY));
    } catch (_error) {
      return null;
    }
  };

  const writePushSyncLock = (lock) => {
    try {
      window.localStorage.setItem(PUSH_SYNC_LOCK_KEY, JSON.stringify(lock));
      return true;
    } catch (_error) {
      return false;
    }
  };

  const clearPushSyncLock = (lockToken) => {
    if (!lockToken) return;
    const current = readPushSyncLock();
    if (!current || current.token !== lockToken) return;
    try {
      window.localStorage.removeItem(PUSH_SYNC_LOCK_KEY);
    } catch (_error) {
      // ignore
    }
  };

  const readPushPermissionPromptedAtFromStorage = () => {
    try {
      if (!window.localStorage) return 0;
    } catch (_error) {
      return 0;
    }

    try {
      const rawValue = Number(window.localStorage.getItem(PUSH_PERMISSION_PROMPT_TS_KEY));
      return Number.isFinite(rawValue) && rawValue > 0 ? Math.floor(rawValue) : 0;
    } catch (_error) {
      return 0;
    }
  };

  const writePushPermissionPromptedAtToStorage = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return;
    try {
      if (!window.localStorage) return;
    } catch (_error) {
      return;
    }

    try {
      window.localStorage.setItem(PUSH_PERMISSION_PROMPT_TS_KEY, String(Math.floor(numericValue)));
    } catch (_error) {
      // ignore
    }
  };

  const isPushPermissionPromptCooldownActive = () => {
    const latestPromptedAt = Math.max(pushPermissionPromptedAt, readPushPermissionPromptedAtFromStorage());
    if (!latestPromptedAt) return false;
    return Date.now() - latestPromptedAt < PUSH_PERMISSION_PROMPT_COOLDOWN_MS;
  };

  const markPushPermissionPromptAttempt = () => {
    const now = Date.now();
    pushPermissionPromptedAt = now;
    writePushPermissionPromptedAtToStorage(now);
  };

  const acquirePushSyncLock = () => {
    try {
      if (!window.localStorage) return null;
    } catch (_error) {
      return null;
    }

    const now = Date.now();
    const existingLock = readPushSyncLock();
    if (existingLock && Number.isFinite(Number(existingLock.expiresAt)) && Number(existingLock.expiresAt) > now) {
      return "";
    }

    const token = randomLockToken();
    const lockPayload = {
      token,
      expiresAt: now + PUSH_SYNC_CROSS_TAB_LOCK_TTL_MS,
    };
    if (!writePushSyncLock(lockPayload)) {
      return null;
    }

    const current = readPushSyncLock();
    if (!current) {
      return null;
    }
    if (current.token !== token) {
      return "";
    }
    return token;
  };

  const clearPushSyncRetryTimer = () => {
    if (!pushSyncRetryTimer) return;
    window.clearTimeout(pushSyncRetryTimer);
    pushSyncRetryTimer = null;
  };

  const schedulePushSyncRetry = () => {
    if (pushSyncRetryTimer || !signedIn) return;
    pushSyncRetryTimer = window.setTimeout(() => {
      pushSyncRetryTimer = null;
      if (!signedIn) return;
      syncPushSubscriptionState({ force: false, allowPrompt: false }).catch(() => null);
    }, PUSH_SYNC_RETRY_DELAY_MS);
  };

  const closeMenusExcept = (exceptWidget) => {
    widgets.forEach((widget) => {
      if (widget === exceptWidget) return;
      widget.menu.hidden = true;
      widget.toggle.setAttribute("aria-expanded", "false");
    });
  };

  const clearMenuPosition = (widget) => {
    widget.menu.style.position = "";
    widget.menu.style.left = "";
    widget.menu.style.right = "";
    widget.menu.style.top = "";
    widget.menu.style.width = "";
    widget.menu.style.maxWidth = "";
  };

  const positionMenu = (widget) => {
    if (widget.menu.hidden || widget.root.hidden) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!viewportWidth || !viewportHeight) return;

    const triggerRect = widget.toggle.getBoundingClientRect();
    const menuWidth = Math.min(NOTIFY_MENU_MAX_WIDTH, Math.max(220, viewportWidth - NOTIFY_MENU_EDGE_GAP * 2));

    widget.menu.style.position = "fixed";
    widget.menu.style.right = "auto";
    widget.menu.style.width = `${Math.round(menuWidth)}px`;
    widget.menu.style.maxWidth = `${Math.round(menuWidth)}px`;
    widget.menu.style.left = `${NOTIFY_MENU_EDGE_GAP}px`;
    widget.menu.style.top = `${Math.round(triggerRect.bottom + NOTIFY_MENU_TOP_GAP)}px`;

    const menuRect = widget.menu.getBoundingClientRect();
    const preferredLeft = triggerRect.right - menuRect.width;
    const maxLeft = Math.max(NOTIFY_MENU_EDGE_GAP, viewportWidth - NOTIFY_MENU_EDGE_GAP - menuRect.width);
    const nextLeft = Math.min(maxLeft, Math.max(NOTIFY_MENU_EDGE_GAP, preferredLeft));

    let nextTop = triggerRect.bottom + NOTIFY_MENU_TOP_GAP;
    const maxTop = viewportHeight - NOTIFY_MENU_EDGE_GAP - menuRect.height;
    if (nextTop > maxTop) {
      const fallbackTop = triggerRect.top - NOTIFY_MENU_TOP_GAP - menuRect.height;
      nextTop = fallbackTop >= NOTIFY_MENU_EDGE_GAP ? fallbackTop : Math.max(NOTIFY_MENU_EDGE_GAP, maxTop);
    }

    widget.menu.style.left = `${Math.round(nextLeft)}px`;
    widget.menu.style.top = `${Math.round(nextTop)}px`;
  };

  const setMenuOpen = (widget, open) => {
    const next = Boolean(open);
    widget.menu.hidden = !next;
    widget.toggle.setAttribute("aria-expanded", next ? "true" : "false");
    if (next) {
      closeMenusExcept(widget);
      positionMenu(widget);
    } else {
      clearMenuPosition(widget);
    }
  };

  const isCollapsedReaderDockWidget = (widget) =>
    Boolean(
      widget &&
        widget.root &&
        typeof widget.root.closest === "function" &&
        widget.root.closest(".reader-dock") &&
        document.body &&
        document.body.classList.contains("reader-dock-collapsed")
    );

  const formatBadgeText = (widget, safeCount) => {
    if (isCollapsedReaderDockWidget(widget)) {
      return safeCount > 19 ? "19+" : String(safeCount);
    }
    return safeCount > 99 ? "99+" : String(safeCount);
  };

  const updateBadge = (widget, countValue) => {
    const count = Number(countValue);
    const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    widget.unreadCount = safeCount;
    if (!safeCount) {
      widget.badge.hidden = true;
      widget.badge.textContent = "0";
      return;
    }
    widget.badge.hidden = false;
    widget.badge.textContent = formatBadgeText(widget, safeCount);
  };

  const renderNotifications = (widget) => {
    widget.list.textContent = "";
    const hasItems = Array.isArray(widget.notifications) && widget.notifications.length > 0;
    widget.empty.hidden = hasItems;
    widget.markAllBtn.hidden = widget.unreadCount <= 0;

    if (widget.moreLink) {
      const nextUrl = widget.moreUrl && widget.moreUrl.startsWith("/") ? widget.moreUrl : "/publish";
      widget.moreLink.href = nextUrl;
      widget.moreLink.hidden = !hasItems;
    }

    if (!hasItems) {
      if (!widget.menu.hidden) positionMenu(widget);
      return;
    }

    const fragment = document.createDocumentFragment();
    widget.notifications.forEach((item) => {
      const link = document.createElement("a");
      link.className = `notify-item${item.isRead ? "" : " is-unread"}`;
      link.href = item.url;
      link.dataset.notifyId = String(item.id);
      link.dataset.notifyRead = item.isRead ? "1" : "0";

      const avatar = buildAvatar(item);
      const body = document.createElement("span");
      body.className = "notify-item__body";

      const title = document.createElement("span");
      title.className = "notify-item__title";
      title.textContent = item.message || "Bạn có thông báo mới.";

      const context = document.createElement("span");
      context.className = "notify-item__context";
      context.textContent = [item.mangaTitle, item.chapterLabel].filter(Boolean).join(" • ");

      const isForumNotification =
        item.type === "forum_post_comment" ||
        (item.type === "mention" && typeof item.url === "string" && item.url.startsWith("/forum"));

      body.appendChild(title);
      if (!isForumNotification && context.textContent) {
        body.appendChild(context);
      }

      if (item.preview) {
        const preview = document.createElement("span");
        preview.className = "notify-item__preview";
        preview.textContent = item.preview;
        body.appendChild(preview);
      }

      const meta = document.createElement("span");
      meta.className = "notify-item__meta";
      if (item.createdAtText) {
        const time = document.createElement("span");
        time.textContent = item.createdAtText;
        meta.appendChild(time);
      }
      if (!item.isRead) {
        const dot = document.createElement("span");
        dot.className = "notify-item__dot";
        dot.setAttribute("aria-hidden", "true");
        meta.appendChild(dot);
      }

      link.appendChild(avatar);
      link.appendChild(body);
      link.appendChild(meta);
      fragment.appendChild(link);
    });

    widget.list.appendChild(fragment);
    if (!widget.menu.hidden) positionMenu(widget);
  };

  const requestNotificationApi = async ({ url, method, body }) => {
    const token = await getAccessTokenSafe().catch(() => "");
    const headers = { Accept: "application/json" };
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const { signal, cleanup } = createAbortTimeout(NOTIFY_FETCH_TIMEOUT_MS);
    let response = null;
    let data = null;
    try {
      response = await fetch(url, {
        method,
        cache: "no-store",
        headers,
        credentials: "same-origin",
        body: method === "GET" ? undefined : JSON.stringify(body && typeof body === "object" ? body : {}),
        signal
      });
      data = await response.json().catch(() => null);
    } catch (_err) {
      return null;
    } finally {
      cleanup();
    }

    if (!response || !response.ok || !data || data.ok !== true) return null;
    return data;
  };

  const showNotificationToast = (message, tone = "info", kind = "notifications-push", dedupe = true) => {
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

  const isPushNotificationSupported = () =>
    Boolean(
      window.Notification &&
        window.PushManager &&
        navigator.serviceWorker &&
        typeof navigator.serviceWorker.getRegistration === "function"
    );

  const base64UrlToUint8Array = (base64Url) => {
    const normalized = String(base64Url || "").trim().replace(/-/g, "+").replace(/_/g, "/");
    if (!normalized) throw new Error("Invalid VAPID key");
    const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const base64 = normalized + padding;
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let index = 0; index < rawData.length; index += 1) {
      outputArray[index] = rawData.charCodeAt(index);
    }
    return outputArray;
  };

  const readPushPublicKey = async () => {
    const data = await requestNotificationApi({
      url: "/notifications/push/public-key",
      method: "GET"
    });
    if (!data || data.enabled !== true) return "";
    const key = data.publicKey == null ? "" : String(data.publicKey).trim();
    return key;
  };

  const readCurrentPushSubscription = async () => {
    if (!isPushNotificationSupported()) return null;
    const registration = await navigator.serviceWorker.ready.catch(() => null);
    if (!registration || !registration.pushManager || typeof registration.pushManager.getSubscription !== "function") {
      return null;
    }
    return registration.pushManager.getSubscription().catch(() => null);
  };

  const unsubscribePushLocallyAndRemotely = async (subscription, { allowServerCall } = {}) => {
    const targetSubscription = subscription || (await readCurrentPushSubscription().catch(() => null));
    if (!targetSubscription) return;

    const endpoint =
      targetSubscription && targetSubscription.endpoint
        ? String(targetSubscription.endpoint).trim()
        : "";

    if (allowServerCall && signedIn && endpoint) {
      await requestNotificationApi({
        url: "/notifications/push/unsubscribe",
        method: "POST",
        body: { endpoint }
      }).catch(() => null);
    }

    if (typeof targetSubscription.unsubscribe === "function") {
      await targetSubscription.unsubscribe().catch(() => null);
    }
  };

  const syncPushSubscriptionState = async ({ force = false, allowPrompt = false } = {}) => {
    if (!isPushNotificationSupported()) return;
    if (pushSyncPromise) return pushSyncPromise;

    const now = Date.now();
    if (!force && now - lastPushSyncAt < PUSH_SYNC_THROTTLE_MS) {
      return;
    }

    const pushSyncLockToken = acquirePushSyncLock();
    if (pushSyncLockToken === "") {
      schedulePushSyncRetry();
      return;
    }
    clearPushSyncRetryTimer();

    pushSyncPromise = (async () => {
      const existingSubscription = await readCurrentPushSubscription().catch(() => null);

      if (!signedIn) {
        await unsubscribePushLocallyAndRemotely(existingSubscription, { allowServerCall: true });
        lastPushSyncAt = Date.now();
        return;
      }

      const permission = window.Notification.permission;
      if (permission === "denied") {
        await unsubscribePushLocallyAndRemotely(existingSubscription, { allowServerCall: true });
        lastPushSyncAt = Date.now();
        return;
      }

      const publicKey = await readPushPublicKey().catch(() => "");
      if (!publicKey) {
        await unsubscribePushLocallyAndRemotely(existingSubscription, { allowServerCall: true });
        lastPushSyncAt = Date.now();
        return;
      }

      let activeSubscription = existingSubscription;
      if (!activeSubscription) {
        if (window.Notification.permission !== "granted") {
          const canPromptPermission =
            force &&
            allowPrompt &&
            !isPushPermissionPromptCooldownActive() &&
            typeof window.Notification.requestPermission === "function";
          if (canPromptPermission) {
            markPushPermissionPromptAttempt();
            const nextPermission = await window.Notification.requestPermission().catch(() => "default");
            if (nextPermission !== "granted") {
              lastPushSyncAt = Date.now();
              return;
            }
          } else {
            lastPushSyncAt = Date.now();
            return;
          }
        }

        const registration = await navigator.serviceWorker.ready.catch(() => null);
        if (!registration || !registration.pushManager || typeof registration.pushManager.subscribe !== "function") {
          lastPushSyncAt = Date.now();
          return;
        }

        let applicationServerKey;
        try {
          applicationServerKey = base64UrlToUint8Array(publicKey);
        } catch (_error) {
          lastPushSyncAt = Date.now();
          return;
        }

        activeSubscription = await registration.pushManager
          .subscribe({
            userVisibleOnly: true,
            applicationServerKey
          })
          .catch(() => null);
      }

      if (!activeSubscription) {
        lastPushSyncAt = Date.now();
        return;
      }

      const serializedSubscription =
        typeof activeSubscription.toJSON === "function"
          ? activeSubscription.toJSON()
          : activeSubscription;

      const subscribeResult = await requestNotificationApi({
        url: "/notifications/push/subscribe",
        method: "POST",
        body: { subscription: serializedSubscription }
      }).catch(() => null);
      if (!subscribeResult) {
        schedulePushSyncRetry();
        return;
      }

      lastPushSyncAt = Date.now();
    })().finally(() => {
      pushSyncPromise = null;
      clearPushSyncLock(pushSyncLockToken);
    });

    return pushSyncPromise;
  };

  const requestPushPermissionFromUserGesture = () => {
    if (!signedIn || !isPushNotificationSupported()) return;

    const permission = window.Notification.permission;
    if (permission === "granted") {
      syncPushSubscriptionState({ force: false, allowPrompt: false }).catch(() => null);
      return;
    }
    if (permission === "denied") {
      showNotificationToast(
        "Trình duyệt đang chặn thông báo. Hãy bật lại quyền Thông báo cho trang này trong cài đặt trình duyệt.",
        "warning",
        "notifications-push-denied"
      );
      syncPushSubscriptionState({ force: false, allowPrompt: false }).catch(() => null);
      return;
    }
    if (permission !== "default") {
      return;
    }
    if (isPushPermissionPromptCooldownActive()) {
      return;
    }
    if (typeof window.Notification.requestPermission !== "function") {
      return;
    }

    markPushPermissionPromptAttempt();
    window.Notification.requestPermission()
      .then((nextPermission) => {
        if (nextPermission === "granted") {
          syncPushSubscriptionState({ force: true, allowPrompt: false }).catch(() => null);
          return;
        }
        syncPushSubscriptionState({ force: false, allowPrompt: false }).catch(() => null);
      })
      .catch(() => null);
  };

  const setWidgetVisible = (widget, visible) => {
    widget.visible = Boolean(visible);
    widget.root.hidden = !widget.visible;
    if (!widget.visible) {
      widget.notifications = [];
      updateBadge(widget, 0);
      renderNotifications(widget);
      setMenuOpen(widget, false);
    }
  };

  const syncChannelWidgetsState = (channel, { notifications, unreadCount, moreUrl } = {}) => {
    const channelWidgets = getChannelWidgets(channel);
    if (!channelWidgets.length) return;

    channelWidgets.forEach((channelWidget) => {
      if (Array.isArray(notifications)) {
        channelWidget.notifications = notifications.map((item) => ({ ...item }));
      }
      if (unreadCount != null) {
        updateBadge(channelWidget, unreadCount);
      }
      if (channelWidget.moreLink && typeof moreUrl === "string" && moreUrl.startsWith("/")) {
        channelWidget.moreUrl = moreUrl;
      }
      renderNotifications(channelWidget);
    });
  };

  const loadTeamMembershipState = async () => {
    if (!signedIn) {
      inTeam = false;
      getChannelWidgets("team").forEach((teamWidget) => {
        teamWidget.moreUrl = "/publish";
        setWidgetVisible(teamWidget, false);
      });
      return false;
    }

    if (teamMembershipRequestPromise) {
      return teamMembershipRequestPromise;
    }

    teamMembershipRequestPromise = (async () => {
      const teamWidgets = getChannelWidgets("team");
      const { signal, cleanup } = createAbortTimeout(NOTIFY_FETCH_TIMEOUT_MS);
      let response = null;
      let data = null;
      try {
        response = await fetch("/account/team-status?format=json", {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json"
          },
          credentials: "same-origin",
          signal
        });
        data = await response.json().catch(() => null);
      } catch (_err) {
        return inTeam;
      } finally {
        cleanup();
      }

      if (!response || !response.ok || !data || data.ok !== true) {
        return inTeam;
      }

      if (data.inTeam !== true || !data.team) {
        inTeam = false;
        teamWidgets.forEach((teamWidget) => {
          teamWidget.moreUrl = "/publish";
          setWidgetVisible(teamWidget, false);
        });
        return false;
      }

      inTeam = true;
      teamWidgets.forEach((teamWidget) => {
        const teamId = Number(data.team.id);
        const teamSlug = data.team.slug ? String(data.team.slug).trim() : "";
        teamWidget.moreUrl =
          Number.isFinite(teamId) && teamId > 0 && teamSlug
            ? `/team/${encodeURIComponent(String(Math.floor(teamId)))}/${encodeURIComponent(teamSlug)}?tab=notifications`
            : "/publish";
        setWidgetVisible(teamWidget, true);
      });

      return true;
    })().finally(() => {
      teamMembershipRequestPromise = null;
    });

    return teamMembershipRequestPromise;
  };

  const loadNotifications = async (widget) => {
    if (!widget.visible || !signedIn || widget.loading) return;
    widget.loading = true;
    try {
      const query = widget.channel === "team" ? "?limit=20&channel=team" : "?limit=20&channel=default";
      const data = await requestNotificationApi({ url: `/notifications${query}`, method: "GET" });
      if (!data) return;

      const items = Array.isArray(data.notifications) ? data.notifications : [];
      const normalized = items.map((item) => normalizeNotification(item)).filter(Boolean);
      const nextMoreUrl = data.moreUrl && String(data.moreUrl).startsWith("/") ? String(data.moreUrl) : undefined;
      syncChannelWidgetsState(widget.channel, {
        notifications: normalized,
        unreadCount: data.unreadCount,
        moreUrl: nextMoreUrl
      });
    } finally {
      widget.loading = false;
    }
  };

  const markNotificationRead = async (widget, notificationId) => {
    const id = Number(notificationId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const channelQuery = widget.channel === "team" ? "?channel=team" : "?channel=default";
    const data = await requestNotificationApi({
      url: `/notifications/${Math.floor(id)}/read${channelQuery}`,
      method: "POST"
    });
    if (!data) return false;

    const nextNotifications = widget.notifications.map((item) =>
      item.id === Math.floor(id) ? { ...item, isRead: true } : item
    );
    syncChannelWidgetsState(widget.channel, {
      notifications: nextNotifications,
      unreadCount: data.unreadCount
    });
    return true;
  };

  const markAllNotificationsRead = async (widget) => {
    const channelQuery = widget.channel === "team" ? "?channel=team" : "?channel=default";
    const data = await requestNotificationApi({ url: `/notifications/read-all${channelQuery}`, method: "POST" });
    if (!data) return false;

    const nextNotifications = widget.notifications.map((item) => ({ ...item, isRead: true }));
    syncChannelWidgetsState(widget.channel, {
      notifications: nextNotifications,
      unreadCount: data.unreadCount
    });
    return true;
  };

  const stopPolling = () => {
    if (!pollingTimer) return;
    clearInterval(pollingTimer);
    pollingTimer = null;
  };

  const refreshVisibleWidgets = () => {
    widgets.forEach((widget) => {
      if (!widget.visible) return;
      loadNotifications(widget).catch(() => null);
    });
  };

  const startPolling = () => {
    stopPolling();
    if (!signedIn) return;
    pollingTimer = setInterval(() => {
      if (!signedIn || !isDocumentVisible() || realtimeConnected) return;
      refreshVisibleWidgets();
    }, NOTIFY_FALLBACK_POLL_MS);
  };

  const stopRealtimeRefreshTimer = () => {
    if (!realtimeRefreshTimer) return;
    clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = null;
  };

  const scheduleRealtimeRefresh = () => {
    if (!signedIn || realtimeRefreshTimer) return;
    realtimeRefreshTimer = window.setTimeout(() => {
      realtimeRefreshTimer = null;
      refreshVisibleWidgets();
    }, NOTIFY_REALTIME_DEBOUNCE_MS);
  };

  const clearRealtimeRetry = () => {
    if (!realtimeRetryTimer) return;
    clearTimeout(realtimeRetryTimer);
    realtimeRetryTimer = null;
  };

  const closeRealtimeStream = () => {
    realtimeConnected = false;
    lastRealtimeEventAt = 0;
    if (!realtimeStream) return;
    const stream = realtimeStream;
    realtimeStream = null;
    try {
      stream.onopen = null;
      stream.onerror = null;
      stream.onmessage = null;
      stream.close();
    } catch (_err) {
      // ignore
    }
  };

  const stopRealtimeHealthCheck = () => {
    if (!realtimeHealthTimer) return;
    clearInterval(realtimeHealthTimer);
    realtimeHealthTimer = null;
  };

  const scheduleRealtimeReconnect = ({ immediate = false } = {}) => {
    if (!signedIn || !isDocumentVisible() || realtimeStream || realtimeRetryTimer) return;
    const delay = immediate ? 0 : realtimeBackoffMs;
    realtimeRetryTimer = window.setTimeout(() => {
      realtimeRetryTimer = null;
      startRealtime();
    }, delay);
    realtimeBackoffMs = Math.min(
      NOTIFY_REALTIME_RETRY_MAX_MS,
      Math.max(NOTIFY_REALTIME_RETRY_BASE_MS, realtimeBackoffMs * 2)
    );
  };

  const startRealtimeHealthCheck = () => {
    stopRealtimeHealthCheck();
    realtimeHealthTimer = setInterval(() => {
      if (!signedIn || !realtimeStream || !realtimeConnected) return;
      const now = Date.now();
      if (!lastRealtimeEventAt) {
        lastRealtimeEventAt = now;
        return;
      }
      if (now - lastRealtimeEventAt <= NOTIFY_STALE_STREAM_MS) return;
      closeRealtimeStream();
      scheduleRealtimeReconnect({ immediate: true });
      scheduleRealtimeRefresh();
    }, NOTIFY_REALTIME_HEALTH_TICK_MS);
  };

  const stopRealtime = () => {
    closeRealtimeStream();
    clearRealtimeRetry();
    stopRealtimeHealthCheck();
    stopRealtimeRefreshTimer();
    realtimeBackoffMs = NOTIFY_REALTIME_RETRY_BASE_MS;
  };

  const handleRealtimePayload = (payload) => {
    if (payload && payload.unreadCount != null) {
      getChannelWidgets("default").forEach((widget) => {
        updateBadge(widget, payload.unreadCount);
      });
    }
    if (payload && payload.teamUnreadCount != null) {
      getChannelWidgets("team").forEach((widget) => {
        updateBadge(widget, payload.teamUnreadCount);
      });
    }
    scheduleRealtimeRefresh();
  };

  const startRealtime = () => {
    if (!signedIn || typeof window.EventSource !== "function" || !isDocumentVisible()) return;

    clearRealtimeRetry();
    closeRealtimeStream();
    startRealtimeHealthCheck();

    const stream = new window.EventSource("/notifications/stream");
    realtimeStream = stream;

    stream.onopen = () => {
      realtimeConnected = true;
      realtimeBackoffMs = NOTIFY_REALTIME_RETRY_BASE_MS;
      lastRealtimeEventAt = Date.now();
      scheduleRealtimeRefresh();
    };

    const onRealtimeEvent = (event) => {
      lastRealtimeEventAt = Date.now();
      let payload = null;
      try {
        payload = event && typeof event.data === "string" && event.data ? JSON.parse(event.data) : null;
      } catch (_err) {
        payload = null;
      }
      handleRealtimePayload(payload);
    };

    stream.addEventListener("ready", onRealtimeEvent);
    stream.addEventListener("notification", onRealtimeEvent);
    stream.addEventListener("heartbeat", () => {
      lastRealtimeEventAt = Date.now();
    });

    stream.onerror = () => {
      realtimeConnected = false;
      closeRealtimeStream();
      scheduleRealtimeRefresh();
      scheduleRealtimeReconnect();
    };
  };

  const applySignedInState = async (nextSignedIn, options = {}) => {
    const settings = options && typeof options === "object" ? options : {};
    const wasSignedIn = signedIn;
    const allowPushPrompt = Boolean(settings.allowPushPrompt);
    signedIn = Boolean(nextSignedIn);
    if (!signedIn) {
      inTeam = false;
      clearPushSyncRetryTimer();
      widgets.forEach((widget) => {
        setWidgetVisible(widget, false);
      });
      stopPolling();
      stopRealtime();
      syncPushSubscriptionState({ force: true, allowPrompt: false }).catch(() => null);
      return;
    }

    getChannelWidgets("default").forEach((defaultWidget) => {
      setWidgetVisible(defaultWidget, true);
    });

    await loadTeamMembershipState().catch(() => inTeam);

    startPolling();
    if (isDocumentVisible()) startRealtime();
    refreshVisibleWidgets();
    syncPushSubscriptionState({ force: true, allowPrompt: allowPushPrompt && !wasSignedIn }).catch(() => null);
  };

  widgets.forEach((widget) => {
    widget.toggle.addEventListener("click", () => {
      if (!signedIn || widget.root.hidden) return;
      const nextOpen = widget.menu.hidden;
      setMenuOpen(widget, nextOpen);
      if (nextOpen) {
        requestPushPermissionFromUserGesture();
        loadNotifications(widget).catch(() => null);
      }
    });

    widget.markAllBtn.addEventListener("click", (event) => {
      event.preventDefault();
      if (!signedIn || widget.unreadCount <= 0) return;
      markAllNotificationsRead(widget).catch(() => null);
    });

    widget.list.addEventListener("click", (event) => {
      const link = event.target.closest("a[data-notify-id]");
      if (!link) return;

      const href = link.getAttribute("href") || "/";
      const currentUrl = new URL(window.location.href);
      const targetUrl = new URL(href, currentUrl.origin);
      const hasCommentHash = /^#comment-[a-z0-9_-]+$/i.test(targetUrl.hash || "");
      const isSamePage =
        targetUrl.origin === currentUrl.origin &&
        targetUrl.pathname === currentUrl.pathname &&
        targetUrl.search === currentUrl.search;
      const isSameHash = targetUrl.hash === currentUrl.hash;
      const shouldForceReveal = isSamePage && isSameHash && hasCommentHash;

      const triggerCommentReveal = () => {
        if (!shouldForceReveal) return;
        window.dispatchEvent(
          new CustomEvent(COMMENT_TARGET_REVEAL_EVENT, {
            detail: { hash: targetUrl.hash, source: "header-notifications" }
          })
        );
      };

      const id = Number(link.dataset.notifyId);
      const isRead = link.dataset.notifyRead === "1";
      if (!Number.isFinite(id) || id <= 0 || isRead) {
        if (shouldForceReveal) {
          event.preventDefault();
          setMenuOpen(widget, false);
          triggerCommentReveal();
          return;
        }
        setMenuOpen(widget, false);
        return;
      }

      event.preventDefault();
      markNotificationRead(widget, id)
        .catch(() => null)
        .finally(() => {
          if (shouldForceReveal) {
            setMenuOpen(widget, false);
            triggerCommentReveal();
            return;
          }
          window.location.href = href;
        });
    });
  });

  document.addEventListener("click", (event) => {
    const clickedInsideAny = widgets.some((widget) => widget.root.contains(event.target));
    if (clickedInsideAny) return;
    widgets.forEach((widget) => {
      setMenuOpen(widget, false);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    widgets.forEach((widget) => {
      setMenuOpen(widget, false);
    });
  });

  window.addEventListener(READER_LAYOUT_CHANGED_EVENT, () => {
    widgets.forEach((widget) => {
      if (!widget || widget.root.hidden) return;
      updateBadge(widget, widget.unreadCount);
    });
  });

  window.addEventListener(
    "scroll",
    () => {
      widgets.forEach((widget) => {
        if (!widget.menu.hidden) positionMenu(widget);
      });
    },
    { passive: true }
  );

  window.addEventListener("resize", () => {
    widgets.forEach((widget) => {
      if (!widget.menu.hidden) positionMenu(widget);
    });
  });

  window.addEventListener("bfang:auth", (event) => {
    const detail = event && typeof event === "object" ? event.detail : null;
    const session = detail && detail.session ? detail.session : null;
    applySignedInState(hasAuthSession(session), { allowPushPrompt: false }).catch(() => null);
  });

  const refreshOnResume = () => {
    getSessionSafe()
      .then((session) => applySignedInState(Boolean(session), { allowPushPrompt: false }))
      .catch(() => null)
      .finally(() => {
        if (signedIn && isDocumentVisible()) {
          startRealtime();
        }
        if (signedIn) {
          syncPushSubscriptionState({ force: false, allowPrompt: false }).catch(() => null);
        }
      });
  };

  window.addEventListener("pageshow", refreshOnResume);
  window.addEventListener("focus", refreshOnResume);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      stopRealtime();
      return;
    }
    refreshOnResume();
  });

  getSessionSafe()
    .then((session) => applySignedInState(Boolean(session), { allowPushPrompt: false }))
    .catch(() => null);
})();
