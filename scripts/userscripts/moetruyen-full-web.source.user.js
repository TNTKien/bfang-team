// ==UserScript==
// @name         MoeTruyen Full Web Unlock
// @namespace    https://moetruyen.net/
// @version      1.0.4
// @description  Cho phép mở đầy đủ website khi máy chủ đang bật WEB_ENABLED=false/forum-only.
// @author       MoeTruyen
// @match        https://moetruyen.net/*
// @match        https://www.moetruyen.net/*
// @match        https://*.moetruyen.net/*
// @match        https://truyen.moe/*
// @match        https://www.truyen.moe/*
// @match        https://*.truyen.moe/*
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const COOKIE_NAME = "moetruyen_full_web";
  const RETURN_PARAM = "__moe_web_return";
  const UNLOCK_ATTEMPT_STORAGE_KEY = "moetruyen_full_web_unlock_attempt";
  const UNLOCK_DISABLED_STORAGE_KEY = "moetruyen_full_web_unlock_disabled";
  const MAX_AGE_SECONDS = 60 * 30;

  // Nếu server cấu hình WINTER_MODE_WEB_UNLOCK_TOKEN thì dán cùng token vào đây.
  // Nếu không cấu hình token, giữ chuỗi rỗng để script tự dùng giá trị "1".
  const SERVER_TOKEN = "Moetruyen123456";

  const TRUSTED_HOSTS = new Set([
    "moetruyen.net",
    "www.moetruyen.net",
    "truyen.moe",
    "www.truyen.moe",
    "localhost",
    "127.0.0.1"
  ]);
  const TRUSTED_HOST_SUFFIXES = [".moetruyen.net", ".truyen.moe"];

  const isTrustedHost = (hostname) => {
    const host = (hostname || "").toString().trim().toLowerCase();
    return TRUSTED_HOSTS.has(host) || TRUSTED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  };

  const encodeCookieValue = (value) =>
    encodeURIComponent(value || "1")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");

  const getUnlockMarker = () => SERVER_TOKEN.trim() || "1";

  const getSessionStorage = () => {
    try {
      return window.sessionStorage || null;
    } catch (_err) {
      return null;
    }
  };

  const getStorageValue = (storage, key) => {
    if (!storage) return "";
    try {
      return storage.getItem(key) || "";
    } catch (_err) {
      return "";
    }
  };

  const setStorageValue = (storage, key, value) => {
    if (!storage) return false;
    try {
      storage.setItem(key, value);
      return true;
    } catch (_err) {
      return false;
    }
  };

  const removeStorageValue = (storage, key) => {
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch (_err) {
      // Ignore storage failures; the userscript should fail closed, not reload.
    }
  };

  const getUnlockScopeMarker = () => JSON.stringify([
    window.location.origin,
    getUnlockMarker()
  ]);

  const getUnlockAttemptMarker = (returnUrl) => JSON.stringify([
    window.location.origin,
    getUnlockMarker(),
    returnUrl.pathname,
    returnUrl.search
  ]);

  const isUnlockDisabled = (storage) =>
    getStorageValue(storage, UNLOCK_DISABLED_STORAGE_KEY) === getUnlockScopeMarker();

  const disableUnlock = (storage) => {
    setStorageValue(storage, UNLOCK_DISABLED_STORAGE_KEY, getUnlockScopeMarker());
    removeStorageValue(storage, UNLOCK_ATTEMPT_STORAGE_KEY);
  };

  const rememberUnlockAttempt = (storage, returnUrl) =>
    setStorageValue(storage, UNLOCK_ATTEMPT_STORAGE_KEY, getUnlockAttemptMarker(returnUrl));

  const hasMatchingUnlockAttempt = (storage, returnUrl) =>
    getStorageValue(storage, UNLOCK_ATTEMPT_STORAGE_KEY) === getUnlockAttemptMarker(returnUrl);

  const clearFullWebCookie = () => {
    document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
  };

  const enableFullWebCookie = () => {
    document.cookie = `${COOKIE_NAME}=${encodeCookieValue(getUnlockMarker())}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  };

  const getSafeReturnUrl = () => {
    const currentUrl = new URL(window.location.href);
    const returnPath = currentUrl.searchParams.get(RETURN_PARAM);
    if (!returnPath || !returnPath.startsWith("/") || returnPath.startsWith("//")) return null;

    const targetUrl = new URL(returnPath, window.location.origin);
    if (targetUrl.origin !== window.location.origin) return null;
    return targetUrl;
  };

  if (!isTrustedHost(window.location.hostname)) return;

  const storage = getSessionStorage();
  const returnUrl = getSafeReturnUrl();

  if (isUnlockDisabled(storage)) {
    clearFullWebCookie();
    return;
  }

  if (!returnUrl) {
    enableFullWebCookie();
    removeStorageValue(storage, UNLOCK_ATTEMPT_STORAGE_KEY);
    return;
  }

  if (hasMatchingUnlockAttempt(storage, returnUrl)) {
    disableUnlock(storage);
    clearFullWebCookie();
    return;
  }

  enableFullWebCookie();
  if (!rememberUnlockAttempt(storage, returnUrl)) return;

  if (returnUrl.href !== window.location.href) {
    window.location.replace(returnUrl.href);
  }
})();
