// ==UserScript==
// @name         MoeTruyen Full Web Unlock
// @namespace    https://moetruyen.net/
// @version      1.0.0
// @description  Cho phép mở đầy đủ website khi máy chủ đang bật WEB_ENABLED=false/forum-only.
// @author       MoeTruyen
// @match        https://moetruyen.net/*
// @match        https://www.moetruyen.net/*
// @match        https://*.moetruyen.net/*
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const COOKIE_NAME = "moetruyen_full_web";
  const RETURN_PARAM = "__moe_web_return";
  const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

  // Nếu server cấu hình WINTER_MODE_WEB_UNLOCK_TOKEN thì dán cùng token vào đây.
  // Nếu không cấu hình token, giữ chuỗi rỗng để script tự dùng giá trị "1".
  const SERVER_TOKEN = "";

  const TRUSTED_HOSTS = new Set([
    "moetruyen.net",
    "www.moetruyen.net",
    "localhost",
    "127.0.0.1"
  ]);

  const isTrustedHost = (hostname) => {
    const host = (hostname || "").toString().trim().toLowerCase();
    return TRUSTED_HOSTS.has(host) || host.endsWith(".moetruyen.net");
  };

  const encodeCookieValue = (value) =>
    encodeURIComponent(value || "1")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");

  const enableFullWebCookie = () => {
    const value = SERVER_TOKEN.trim() || "1";
    document.cookie = `${COOKIE_NAME}=${encodeCookieValue(value)}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
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

  enableFullWebCookie();

  const returnUrl = getSafeReturnUrl();
  if (returnUrl && returnUrl.href !== window.location.href) {
    window.location.replace(returnUrl.href);
  }
})();
