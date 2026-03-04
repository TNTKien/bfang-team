const commentSelectors = {
  section: "#comments",
  list: ".comment-items",
  header: ".section-header h2"
};
const COMMENT_EMPTY_NOTE_ATTR = "data-comment-empty-note";

const avatarSvg =
  "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.6'><circle cx='12' cy='8' r='4' /><path d='M4 20c1.6-3.5 5-5 8-5s6.4 1.5 8 5' /></svg>";

const icons = {
  like: "<i class='fa-solid fa-thumbs-up' aria-hidden='true'></i>",
  reply: "<i class='fa-solid fa-reply' aria-hidden='true'></i>",
  report: "<i class='fa-regular fa-flag' aria-hidden='true'></i>",
  delete: "<i class='fa-regular fa-trash-can' aria-hidden='true'></i>"
};

const commentToolIcons = {
  emoji:
    "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><circle cx='12' cy='12' r='9' /><path d='M8.4 14.4c1 1.2 2.2 1.8 3.6 1.8s2.6-.6 3.6-1.8' /><circle cx='9.2' cy='10.2' r='1' fill='currentColor' stroke='none' /><circle cx='14.8' cy='10.2' r='1' fill='currentColor' stroke='none' /></svg>",
  sticker:
    "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M6 3h12a3 3 0 0 1 3 3v7a8 8 0 0 1-8 8H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z' /><path d='M14 21v-5a3 3 0 0 1 3-3h4' /></svg>"
};

const buildAvatar = (avatarUrl) => {
  const avatar = document.createElement("div");
  avatar.className = "comment-avatar";
  avatar.setAttribute("aria-hidden", "true");

  const raw = avatarUrl == null ? "" : String(avatarUrl).trim();
  const ok =
    raw &&
    raw.length <= 500 &&
    (/^https?:\/\//i.test(raw) || raw.startsWith("/uploads/avatars/"));
  if (ok) {
    const img = document.createElement("img");
    img.className = "comment-avatar__img";
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.src = raw;
    avatar.appendChild(img);
    return avatar;
  }

  avatar.innerHTML = avatarSvg;
  return avatar;
};

const toSafeCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

const toCompactTimeAgo = (value) => {
  const text = toSafeText(value) || "Vừa xong";
  return text.replace(/\s+trước$/i, "").trim();
};

const getFirstVisibleBadge = (badgesInput) => {
  const badges = Array.isArray(badgesInput) ? badgesInput : [];
  for (let i = 0; i < badges.length; i += 1) {
    const badge = badges[i];
    if (!badge) continue;
    const label = String(badge.label || "").trim();
    if (!label) continue;
    const code = String(badge.code || "").trim().toLowerCase();
    const normalizedLabel = label.toLowerCase();
    if (
      code === "member" ||
      normalizedLabel.includes("member") ||
      normalizedLabel.includes("thanh vien") ||
      normalizedLabel.includes("thành viên")
    ) {
      continue;
    }
    return badge;
  }
  return null;
};

const syncCommentActionCount = (button, attributeName, value) => {
  if (!button || !attributeName) return;
  const count = toSafeCount(value);
  let countEl = button.querySelector(`[${attributeName}]`);
  if (count <= 0) {
    if (countEl) countEl.remove();
    return;
  }
  if (!countEl) {
    countEl = document.createElement("span");
    countEl.className = "comment-action__count";
    countEl.setAttribute(attributeName, "");
    button.appendChild(countEl);
  }
  countEl.textContent = String(count);
};

const COMMENT_TEXTAREA_LIMIT = 500;
const COMMENT_MENTION_MAX_QUERY = 32;
const COMMENT_MENTION_DEBOUNCE_MS = 140;
const COMMENT_MENTION_CACHE_MS = 30 * 1000;
const COMMENT_MENTION_FETCH_LIMIT = 3;
const COMMENT_FORM_NOTICE_AUTO_HIDE_MS = 5500;
const COMMENT_LINK_LABEL_FETCH_LIMIT = 40;
const COMMENT_FRESH_BYPASS_QUERY_PARAM = "__bfv";
const commentLinkLabelApiPath = "/comments/link-labels";
const commentTurnstileApiPath = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const commentTurnstilePublicConfig =
  window.__TURNSTILE && typeof window.__TURNSTILE === "object" ? window.__TURNSTILE : {};
let commentCounterSeed = 0;

const commentEmojiFallbackList = [
  "😀",
  "😁",
  "😂",
  "😅",
  "😊",
  "😍",
  "😘",
  "😭",
  "😡",
  "🤔",
  "👍",
  "👏",
  "🙏",
  "🔥",
  "✨",
  "❤️"
];

const emojiMartAssetPaths = {
  script: "/vendor/emoji-mart/dist/browser.js",
  data: "/vendor/emoji-mart-data/sets/15/native.json",
  i18n: "/vendor/emoji-mart-data/i18n/vi.json"
};

const commentStickerManifestPath = "/stickers/manifest.json";

const buildDefaultCommentStickerList = () =>
  Array.from({ length: 49 }, (_unused, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      code: `pepe-${number}`,
      label: `Pepe ${number}`,
      src: `/stickers/pepe-${number}.png`
    };
  });

const normalizeCommentStickerItems = (items) => {
  if (!Array.isArray(items)) return [];
  const normalized = [];
  const seen = new Set();

  items.forEach((item, index) => {
    const fallbackNumber = String(index + 1).padStart(2, "0");
    const rawCode = item && item.code != null ? String(item.code).trim().toLowerCase() : "";
    const code = rawCode || `pepe-${fallbackNumber}`;
    if (!/^[a-z0-9_-]{1,40}$/.test(code) || seen.has(code)) return;

    const rawLabel = item && item.label != null ? String(item.label).trim() : "";
    const label = rawLabel || code.replace(/[-_]+/g, " ").trim() || `Sticker ${fallbackNumber}`;

    const rawSrc = item && item.src != null ? String(item.src).trim() : "";
    const safeSrc =
      rawSrc && (rawSrc.startsWith("/stickers/") || /^https?:\/\//i.test(rawSrc)) ? rawSrc : "";
    if (!safeSrc) return;

    seen.add(code);
    normalized.push({
      code,
      label,
      src: safeSrc
    });
  });

  return normalized;
};

let commentStickerList = buildDefaultCommentStickerList();

const commentStickerLegacyAliasMap = new Map([
  ["happy", "pepe-01"],
  ["love", "pepe-02"],
  ["wow", "pepe-03"],
  ["cry", "pepe-04"],
  ["angry", "pepe-05"],
  ["cool", "pepe-06"],
  ["sleep", "pepe-07"],
  ["gg", "pepe-08"]
]);

const commentStickerMap = new Map();
let commentStickerManifestPromise = null;

const loadStickerImageFromDataset = (image) => {
  if (!image || image.dataset.stickerLoaded === "1") return;
  const source = image.dataset.stickerSrc ? String(image.dataset.stickerSrc).trim() : "";
  if (!source) return;
  image.src = source;
  image.dataset.stickerLoaded = "1";
  image.removeAttribute("data-sticker-src");
};

const commentStickerImageObserver =
  typeof window !== "undefined" && "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const target = entry.target;
            observer.unobserve(target);
            loadStickerImageFromDataset(target);
          });
        },
        {
          rootMargin: "180px 0px",
          threshold: 0.01
        }
      )
    : null;

const queueCommentStickerImageLoad = (image) => {
  if (!image) return;
  if (commentStickerImageObserver) {
    commentStickerImageObserver.observe(image);
    return;
  }
  loadStickerImageFromDataset(image);
};

const applyCommentStickerCatalog = (items) => {
  const normalized = normalizeCommentStickerItems(items);
  commentStickerList = normalized.length ? normalized : buildDefaultCommentStickerList();

  commentStickerMap.clear();
  commentStickerList.forEach((item) => {
    commentStickerMap.set(item.code, item);
  });

  commentStickerLegacyAliasMap.forEach((targetCode, legacyCode) => {
    const targetSticker = commentStickerMap.get(targetCode);
    if (targetSticker) {
      commentStickerMap.set(legacyCode, targetSticker);
    }
  });
};

const loadCommentStickerManifest = () => {
  if (commentStickerManifestPromise) {
    return commentStickerManifestPromise;
  }

  commentStickerManifestPromise = fetchJsonAsset(commentStickerManifestPath)
    .then((payload) => {
      const stickerItems = Array.isArray(payload)
        ? payload
        : payload && Array.isArray(payload.stickers)
          ? payload.stickers
          : [];

      if (stickerItems.length) {
        applyCommentStickerCatalog(stickerItems);
      }

      return commentStickerList;
    })
    .catch((error) => {
      console.warn("Cannot load sticker manifest.", error);
      return commentStickerList;
    });

  return commentStickerManifestPromise;
};

applyCommentStickerCatalog(commentStickerList);

const getStickerTokenRegex = () => /\[sticker:([a-z0-9_-]+)\]/gi;

const numberFormatter = new Intl.NumberFormat("vi-VN");
const commentUserProfileCache = new Map();
const commentUserProfilePendingMap = new Map();
const commentMentionCache = new Map();
const commentMentionPendingMap = new Map();
const commentLinkLabelCache = new Map();
const commentMentionStates = new Set();
const commentFormNoticeTimerMap = new WeakMap();
const commentTurnstileStateMap = new WeakMap();
let commentUserDialogState = null;
let commentUserDialogRequestToken = 0;
let emojiMartScriptPromise = null;
let emojiMartDataPromise = null;
let emojiMartI18nPromise = null;
let commentTurnstileScriptPromise = null;

const closeSiblingCommentPickers = (currentPicker) => {
  if (!currentPicker) return;
  const scope = currentPicker.closest(".comment-tools") || document;
  scope.querySelectorAll(".comment-picker[open]").forEach((picker) => {
    if (picker === currentPicker) return;
    picker.open = false;
  });
};

const resolveEmojiMartApi = () => {
  if (!window.EmojiMart || typeof window.EmojiMart.Picker !== "function") {
    return null;
  }
  return window.EmojiMart;
};

const loadEmojiMartScript = () => {
  const existingApi = resolveEmojiMartApi();
  if (existingApi) {
    return Promise.resolve(existingApi);
  }

  if (emojiMartScriptPromise) {
    return emojiMartScriptPromise;
  }

  emojiMartScriptPromise = new Promise((resolve, reject) => {
    const handleReady = () => {
      const api = resolveEmojiMartApi();
      if (api) {
        resolve(api);
      } else {
        reject(new Error("Emoji Mart script loaded without Picker API."));
      }
    };

    let script = document.querySelector("script[data-emoji-mart-script='1']");
    if (script && script.dataset.emojiMartFailed === "1") {
      script.remove();
      script = null;
    }

    if (!script) {
      script = document.createElement("script");
      script.src = emojiMartAssetPaths.script;
      script.defer = true;
      script.dataset.emojiMartScript = "1";
      script.addEventListener(
        "load",
        () => {
          script.dataset.emojiMartLoaded = "1";
          handleReady();
        },
        { once: true }
      );
      script.addEventListener(
        "error",
        () => {
          script.dataset.emojiMartFailed = "1";
          script.remove();
          reject(new Error("Cannot load Emoji Mart script."));
        },
        { once: true }
      );
      document.head.appendChild(script);
      return;
    }

    if (script.dataset.emojiMartLoaded === "1") {
      handleReady();
      return;
    }

    script.addEventListener(
      "load",
      () => {
        script.dataset.emojiMartLoaded = "1";
        handleReady();
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => {
        script.dataset.emojiMartFailed = "1";
        script.remove();
        reject(new Error("Cannot load Emoji Mart script."));
      },
      { once: true }
    );
  }).catch((error) => {
    emojiMartScriptPromise = null;
    throw error;
  });

  return emojiMartScriptPromise;
};

const fetchJsonAsset = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    },
    credentials: "same-origin"
  });

  if (!response.ok) {
    throw new Error(`JSON asset unavailable (${response.status}).`);
  }

  return response.json();
};

const loadEmojiMartData = () => {
  if (emojiMartDataPromise) {
    return emojiMartDataPromise;
  }

  emojiMartDataPromise = fetchJsonAsset(emojiMartAssetPaths.data).catch((error) => {
    emojiMartDataPromise = null;
    throw error;
  });

  return emojiMartDataPromise;
};

const loadEmojiMartI18n = () => {
  if (emojiMartI18nPromise) {
    return emojiMartI18nPromise;
  }

  emojiMartI18nPromise = fetchJsonAsset(emojiMartAssetPaths.i18n).catch(() => null);
  return emojiMartI18nPromise;
};

const toSafeText = (value) => (value == null ? "" : String(value)).trim();
const commentProfileUsernamePattern = /^[a-z0-9_]{1,24}$/i;

const normalizeCommentProfileUrl = ({ value, allowedHosts, canonicalHost, maxLength }) => {
  const raw = toSafeText(value);
  if (!raw) return "";

  const safeMax = Math.max(1, Math.floor(Number(maxLength) || 0));
  if (safeMax && raw.length > safeMax) return "";

  const hosts = Array.isArray(allowedHosts)
    ? allowedHosts
        .map((item) => (item == null ? "" : String(item)).trim().toLowerCase())
        .filter(Boolean)
    : [];
  const preferredHost = toSafeText(canonicalHost || hosts[0]).toLowerCase();
  if (!hosts.length || !preferredHost) return "";

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate.replace(/^\/+/, "")}`;
  }

  let parsed = null;
  try {
    parsed = new URL(candidate);
  } catch (_err) {
    return "";
  }

  const protocol = (parsed.protocol || "").toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") return "";

  const host = (parsed.hostname || "").toLowerCase();
  if (!hosts.includes(host)) return "";

  const pathname = (parsed.pathname || "").replace(/\/+$/, "");
  if (!pathname || pathname === "/") return "";

  const search = parsed.search || "";
  return `https://${preferredHost}${pathname}${search}`;
};

const normalizeCommentUserProfile = (rawProfile) => {
  const profile = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
  const badgesRaw = Array.isArray(profile.badges) ? profile.badges : [];
  const badges = badgesRaw
    .map((item) => {
      const label = item && item.label != null ? String(item.label).trim() : "";
      if (!label) return null;
      const color = item && item.color != null ? String(item.color).trim() : "";
      return {
        label,
        color
      };
    })
    .filter(Boolean);

  const username = toSafeText(profile.username);
  const email = toSafeText(profile.email);
  const name = toSafeText(profile.name) || (username ? `@${username}` : "Người dùng");
  const avatarUrl = toSafeText(profile.avatarUrl);
  const joinedAtText = toSafeText(profile.joinedAtText);
  const commentCount = toSafeCount(profile.commentCount);
  const facebookUrl = normalizeCommentProfileUrl({
    value: profile.facebookUrl,
    allowedHosts: ["facebook.com", "www.facebook.com", "m.facebook.com"],
    canonicalHost: "facebook.com",
    maxLength: 180
  });
  const discordUrl = normalizeCommentProfileUrl({
    value: profile.discordUrl,
    allowedHosts: ["discord.gg", "www.discord.gg"],
    canonicalHost: "discord.gg",
    maxLength: 80
  });
  const bioRaw = profile && profile.bio != null ? String(profile.bio) : "";
  const bio = bioRaw.replace(/\r\n/g, "\n").trim().slice(0, 300);

  return {
    id: toSafeText(profile.id),
    name,
    email,
    avatarUrl,
    username,
    joinedAtText,
    commentCount,
    facebookUrl,
    discordUrl,
    bio,
    badges
  };
};

const renderCommentUserAvatar = (container, avatarUrl) => {
  if (!container) return;
  container.textContent = "";

  const raw = toSafeText(avatarUrl);
  const ok = raw && raw.length <= 500 && (/^https?:\/\//i.test(raw) || raw.startsWith("/uploads/avatars/"));
  if (ok) {
    const img = document.createElement("img");
    img.className = "comment-user-modal__avatar-img";
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.src = raw;
    container.appendChild(img);
    return;
  }

  container.innerHTML = avatarSvg;
};

const ensureCommentUserDialog = () => {
  if (commentUserDialogState) {
    return commentUserDialogState;
  }

  const dialog = document.createElement("dialog");
  dialog.className = "modal comment-user-modal";
  dialog.setAttribute("aria-label", "Thông tin người dùng");
  dialog.innerHTML = `
    <div class="modal-card comment-user-modal__card" role="document">
      <div class="modal-head">
        <h3 class="modal-title">Thông tin người dùng</h3>
        <button class="modal-close" type="button" data-comment-user-close aria-label="Đóng">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <div class="comment-user-modal__profile">
        <div class="comment-user-modal__avatar" data-comment-user-avatar aria-hidden="true"></div>
        <div class="comment-user-modal__identity">
          <p class="comment-user-modal__name" data-comment-user-name>Người dùng</p>
          <p class="comment-user-modal__username" data-comment-user-username></p>
        </div>
      </div>
      <div class="comment-user-modal__stats">
        <div class="comment-user-modal__stat">
          <span>Tham gia</span>
          <strong data-comment-user-joined>Không rõ</strong>
        </div>
        <div class="comment-user-modal__stat">
          <span>Bình luận</span>
          <strong data-comment-user-comment-count>0</strong>
        </div>
      </div>
      <div class="comment-user-modal__badges" data-comment-user-badges></div>
      <div class="comment-user-modal__contacts" data-comment-user-contacts hidden>
        <p class="comment-user-modal__contact comment-user-modal__contact--plain" hidden data-comment-user-email>
          <i class="fa-regular fa-envelope" aria-hidden="true"></i>
          <span data-comment-user-email-text></span>
        </p>
        <a
          class="comment-user-modal__contact"
          href="#"
          target="_blank"
          rel="noopener noreferrer"
          hidden
          data-comment-user-facebook
        >
          <i class="fa-brands fa-facebook" aria-hidden="true"></i>
          <span>Facebook</span>
        </a>
        <a
          class="comment-user-modal__contact"
          href="#"
          target="_blank"
          rel="noopener noreferrer"
          hidden
          data-comment-user-discord
        >
          <i class="fa-brands fa-discord" aria-hidden="true"></i>
          <span>Discord</span>
        </a>
      </div>
      <div class="comment-user-modal__bio-wrap" data-comment-user-bio-wrap hidden>
        <p class="comment-user-modal__bio-label">
          <i class="fa-regular fa-address-card" aria-hidden="true"></i>
          <span>Giới thiệu</span>
        </p>
        <p class="comment-user-modal__bio" data-comment-user-bio></p>
      </div>
      <p class="comment-user-modal__status" data-comment-user-status hidden></p>
    </div>
  `;
  document.body.appendChild(dialog);

  const closeBtn = dialog.querySelector("[data-comment-user-close]");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      if (typeof dialog.close === "function") {
        if (dialog.open) dialog.close();
        return;
      }
      dialog.removeAttribute("open");
    });
  }

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    }
  });

  commentUserDialogState = {
    dialog,
    nameEl: dialog.querySelector("[data-comment-user-name]"),
    usernameEl: dialog.querySelector("[data-comment-user-username]"),
    avatarEl: dialog.querySelector("[data-comment-user-avatar]"),
    joinedEl: dialog.querySelector("[data-comment-user-joined]"),
    commentCountEl: dialog.querySelector("[data-comment-user-comment-count]"),
    badgesEl: dialog.querySelector("[data-comment-user-badges]"),
    contactsEl: dialog.querySelector("[data-comment-user-contacts]"),
    emailEl: dialog.querySelector("[data-comment-user-email]"),
    emailTextEl: dialog.querySelector("[data-comment-user-email-text]"),
    facebookEl: dialog.querySelector("[data-comment-user-facebook]"),
    discordEl: dialog.querySelector("[data-comment-user-discord]"),
    bioWrapEl: dialog.querySelector("[data-comment-user-bio-wrap]"),
    bioEl: dialog.querySelector("[data-comment-user-bio]"),
    statusEl: dialog.querySelector("[data-comment-user-status]")
  };
  return commentUserDialogState;
};

const renderCommentUserDialogLoading = ({ state, hintName }) => {
  if (!state) return;
  const name = toSafeText(hintName) || "Đang tải...";
  if (state.nameEl) state.nameEl.textContent = name;
  if (state.usernameEl) state.usernameEl.textContent = "";
  if (state.joinedEl) state.joinedEl.textContent = "Đang tải...";
  if (state.commentCountEl) state.commentCountEl.textContent = "...";
  if (state.badgesEl) state.badgesEl.textContent = "";
  if (state.contactsEl) state.contactsEl.hidden = true;
  if (state.emailEl) state.emailEl.hidden = true;
  if (state.emailTextEl) state.emailTextEl.textContent = "";
  if (state.facebookEl) {
    state.facebookEl.hidden = true;
    state.facebookEl.removeAttribute("href");
  }
  if (state.discordEl) {
    state.discordEl.hidden = true;
    state.discordEl.removeAttribute("href");
  }
  if (state.bioWrapEl) state.bioWrapEl.hidden = true;
  if (state.bioEl) state.bioEl.textContent = "";
  renderCommentUserAvatar(state.avatarEl, "");
  if (state.statusEl) {
    state.statusEl.hidden = false;
    state.statusEl.textContent = "Đang tải thông tin người dùng...";
  }
};

const renderCommentUserDialogError = ({ state, message }) => {
  if (!state || !state.statusEl) return;
  state.statusEl.hidden = false;
  state.statusEl.textContent = toSafeText(message) || "Không thể tải thông tin người dùng.";
};

const applyCommentUserContactLink = (anchor, url) => {
  if (!anchor) return false;
  const safeUrl = toSafeText(url);
  if (!safeUrl) {
    anchor.hidden = true;
    anchor.removeAttribute("href");
    return false;
  }
  anchor.hidden = false;
  anchor.href = safeUrl;
  return true;
};

const renderCommentUserDialogProfile = ({ state, profile }) => {
  if (!state) return;
  const data = normalizeCommentUserProfile(profile);

  if (state.nameEl) {
    state.nameEl.textContent = data.name;
  }

  if (state.usernameEl) {
    state.usernameEl.textContent = data.username ? `@${data.username}` : "Chưa đặt username";
  }

  renderCommentUserAvatar(state.avatarEl, data.avatarUrl);

  if (state.joinedEl) {
    state.joinedEl.textContent = data.joinedAtText || "Không rõ";
  }

  if (state.commentCountEl) {
    state.commentCountEl.textContent = numberFormatter.format(data.commentCount);
  }

  if (state.badgesEl) {
    state.badgesEl.textContent = "";
    if (data.badges.length) {
      data.badges.forEach((badge) => {
        const badgeEl = document.createElement("span");
        badgeEl.className = "comment-badge";
        if (badge.color) {
          badgeEl.style.setProperty("--badge-color", badge.color);
          badgeEl.style.setProperty("--badge-bg", `${badge.color}22`);
        }
        badgeEl.textContent = badge.label;
        state.badgesEl.appendChild(badgeEl);
      });
    } else {
      const emptyEl = document.createElement("span");
      emptyEl.className = "comment-user-modal__empty";
      emptyEl.textContent = "Chưa có huy hiệu";
      state.badgesEl.appendChild(emptyEl);
    }
  }

  const hasFacebook = applyCommentUserContactLink(state.facebookEl, data.facebookUrl);
  const hasDiscord = applyCommentUserContactLink(state.discordEl, data.discordUrl);
  const hasEmail = Boolean(data.email);
  if (state.emailEl) {
    state.emailEl.hidden = !hasEmail;
  }
  if (state.emailTextEl) {
    state.emailTextEl.textContent = hasEmail ? data.email : "";
  }
  if (state.contactsEl) {
    state.contactsEl.hidden = !(hasEmail || hasFacebook || hasDiscord);
  }

  if (state.bioWrapEl && state.bioEl) {
    if (data.bio) {
      state.bioWrapEl.hidden = false;
      state.bioEl.textContent = data.bio;
    } else {
      state.bioWrapEl.hidden = true;
      state.bioEl.textContent = "";
    }
  }

  if (state.statusEl) {
    state.statusEl.hidden = true;
    state.statusEl.textContent = "";
  }
};

const fetchCommentUserProfile = async (userId) => {
  const id = toSafeText(userId);
  if (!id) {
    throw new Error("Không tìm thấy người dùng.");
  }

  if (commentUserProfileCache.has(id)) {
    return commentUserProfileCache.get(id);
  }

  if (commentUserProfilePendingMap.has(id)) {
    return commentUserProfilePendingMap.get(id);
  }

  const request = fetch(`/comments/users/${encodeURIComponent(id)}?format=json`, {
    headers: {
      Accept: "application/json"
    },
    credentials: "same-origin"
  })
    .then(async (response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.ok !== true || !data.profile) {
        const message = data && data.error ? String(data.error) : "Không thể tải thông tin người dùng.";
        throw new Error(message);
      }
      const profile = normalizeCommentUserProfile(data.profile);
      commentUserProfileCache.set(id, profile);
      return profile;
    })
    .finally(() => {
      commentUserProfilePendingMap.delete(id);
    });

  commentUserProfilePendingMap.set(id, request);
  return request;
};

const buildCommentUserProfilePath = (usernameValue) => {
  const username = toSafeText(usernameValue).toLowerCase();
  if (!commentProfileUsernamePattern.test(username)) return "";
  return `/user/${encodeURIComponent(username)}`;
};

const openCommentUserDialog = async (triggerEl) => {
  const trigger = triggerEl && triggerEl.closest ? triggerEl.closest("[data-comment-author-trigger]") : null;
  if (!trigger) return;

  const directPath = buildCommentUserProfilePath(trigger.dataset.commentUsername);
  if (directPath) {
    window.location.assign(directPath);
    return;
  }

  const userId = toSafeText(trigger.dataset.commentUserId);
  if (!userId) return;

  const profile = await fetchCommentUserProfile(userId);
  const username = profile && profile.username ? String(profile.username).trim() : "";
  const profilePath = buildCommentUserProfilePath(username);
  if (!profilePath) {
    throw new Error("Không tìm thấy trang thành viên.");
  }

  trigger.dataset.commentUsername = username.toLowerCase();
  window.location.assign(profilePath);
};

const getCommentTextareaLimit = (textarea) => {
  if (!textarea) return COMMENT_TEXTAREA_LIMIT;
  const rawLimit = Number(textarea.maxLength);
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
    return COMMENT_TEXTAREA_LIMIT;
  }
  return Math.floor(rawLimit);
};

const getCommentCounterText = (textarea) => {
  const value = textarea && textarea.value != null ? String(textarea.value) : "";
  const limit = getCommentTextareaLimit(textarea);
  const used = value.length;
  const remaining = limit - used;
  return {
    text: `${used}/${limit}`,
    remaining,
    limit
  };
};

const clearCommentFormNoticeTimer = (form) => {
  if (!form) return;
  const existingTimer = commentFormNoticeTimerMap.get(form);
  if (!existingTimer) return;
  window.clearTimeout(existingTimer);
  commentFormNoticeTimerMap.delete(form);
};

const ensureCommentFormNotice = (form) => {
  if (!form) return null;
  let notice = form.querySelector("[data-comment-form-notice]");
  if (notice) return notice;

  notice = document.createElement("p");
  notice.className = "comment-form-notice note";
  notice.setAttribute("data-comment-form-notice", "");
  notice.setAttribute("aria-live", "polite");
  notice.hidden = true;

  const submitWrap = form.querySelector(".comment-submit");
  if (submitWrap && submitWrap.parentElement === form) {
    submitWrap.insertAdjacentElement("beforebegin", notice);
  } else {
    form.appendChild(notice);
  }

  return notice;
};

const hideCommentFormNotice = (form) => {
  if (!form) return;
  clearCommentFormNoticeTimer(form);
  const notice = ensureCommentFormNotice(form);
  if (!notice) return;
  notice.hidden = true;
  notice.textContent = "";
  notice.classList.remove("is-error", "is-success");
};

const showCommentFormNotice = (form, message, options) => {
  const notice = ensureCommentFormNotice(form);
  if (!notice) return;

  const settings = options && typeof options === "object" ? options : {};
  const tone = String(settings.tone || "error").trim().toLowerCase();
  const autoHideMsRaw = Number(settings.autoHideMs);
  const autoHideMs =
    Number.isFinite(autoHideMsRaw) && autoHideMsRaw > 0
      ? Math.max(600, Math.floor(autoHideMsRaw))
      : COMMENT_FORM_NOTICE_AUTO_HIDE_MS;
  const text = toSafeText(message) || "Không thể gửi bình luận. Vui lòng thử lại.";

  clearCommentFormNoticeTimer(form);

  notice.hidden = false;
  notice.textContent = text;
  notice.classList.remove("is-error", "is-success");
  if (tone === "success") {
    notice.classList.add("is-success");
  } else {
    notice.classList.add("is-error");
  }

  if (autoHideMs > 0) {
    const timer = window.setTimeout(() => {
      if (!notice.isConnected) return;
      hideCommentFormNotice(form);
    }, autoHideMs);
    commentFormNoticeTimerMap.set(form, timer);
  }
};

const readCommentRetryAfterSeconds = (response, payload) => {
  const fromBody = Number(payload && payload.retryAfter != null ? payload.retryAfter : NaN);
  if (Number.isFinite(fromBody) && fromBody > 0) {
    return Math.max(1, Math.floor(fromBody));
  }

  const headerRaw = response && response.headers ? response.headers.get("Retry-After") : "";
  const fromHeader = Number((headerRaw || "").toString().trim());
  if (Number.isFinite(fromHeader) && fromHeader > 0) {
    return Math.max(1, Math.floor(fromHeader));
  }

  return 0;
};

const generateCommentRequestId = () => {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  const randomPart = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${randomPart()}-${randomPart()}`;
};

const getCommentTurnstileSiteKey = (preferredSiteKey) => {
  const preferred = preferredSiteKey == null ? "" : String(preferredSiteKey).trim();
  if (preferred) return preferred;
  const configured =
    commentTurnstilePublicConfig && commentTurnstilePublicConfig.siteKey != null
      ? String(commentTurnstilePublicConfig.siteKey).trim()
      : "";
  return configured;
};

const loadCommentTurnstileScript = async () => {
  if (window.turnstile && typeof window.turnstile.render === "function") {
    return window.turnstile;
  }

  if (commentTurnstileScriptPromise) {
    return commentTurnstileScriptPromise;
  }

  commentTurnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-comment-turnstile-script]");
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.turnstile && typeof window.turnstile.render === "function") {
          resolve(window.turnstile);
          return;
        }
        reject(new Error("Turnstile unavailable."));
      });
      existing.addEventListener("error", () => reject(new Error("Turnstile script failed to load.")));
      return;
    }

    const script = document.createElement("script");
    script.src = commentTurnstileApiPath;
    script.async = true;
    script.defer = true;
    script.setAttribute("data-comment-turnstile-script", "1");
    script.addEventListener("load", () => {
      if (window.turnstile && typeof window.turnstile.render === "function") {
        resolve(window.turnstile);
        return;
      }
      reject(new Error("Turnstile unavailable."));
    });
    script.addEventListener("error", () => reject(new Error("Turnstile script failed to load.")));
    document.head.appendChild(script);
  }).catch((error) => {
    commentTurnstileScriptPromise = null;
    throw error;
  });

  return commentTurnstileScriptPromise;
};

const ensureCommentTurnstileState = (form) => {
  if (!form) return null;
  const existing = commentTurnstileStateMap.get(form);
  if (existing) return existing;

  const wrap = document.createElement("div");
  wrap.className = "comment-turnstile";
  wrap.hidden = true;

  const title = document.createElement("p");
  title.className = "comment-turnstile__title";
  title.textContent = "Vui lòng xác minh bạn không phải robot để tiếp tục bình luận.";

  const widget = document.createElement("div");
  widget.className = "comment-turnstile__widget";

  const error = document.createElement("p");
  error.className = "comment-turnstile__error note is-error";
  error.hidden = true;

  wrap.appendChild(title);
  wrap.appendChild(widget);
  wrap.appendChild(error);

  const submitWrap = form.querySelector(".comment-submit");
  if (submitWrap && submitWrap.parentElement === form) {
    submitWrap.insertAdjacentElement("beforebegin", wrap);
  } else {
    form.appendChild(wrap);
  }

  const state = {
    wrap,
    title,
    widget,
    error,
    widgetId: null,
    siteKey: "",
    pendingPromise: null,
    resolvePending: null,
    rejectPending: null,
    lastToken: ""
  };

  commentTurnstileStateMap.set(form, state);
  return state;
};

const setCommentTurnstileError = (form, message) => {
  const state = ensureCommentTurnstileState(form);
  if (!state) return;
  const text = toSafeText(message);
  if (!text) {
    state.error.hidden = true;
    state.error.textContent = "";
    return;
  }

  state.error.hidden = false;
  state.error.textContent = text;
};

const hideCommentTurnstile = (form) => {
  const state = form ? commentTurnstileStateMap.get(form) : null;
  if (!state) return;

  if (state.rejectPending) {
    state.rejectPending(new Error("Turnstile cancelled."));
  }
  state.pendingPromise = null;
  state.resolvePending = null;
  state.rejectPending = null;
  state.lastToken = "";
  state.wrap.hidden = true;
  setCommentTurnstileError(form, "");

  if (window.turnstile && state.widgetId != null) {
    try {
      window.turnstile.reset(state.widgetId);
    } catch (_err) {
      // ignore
    }
  }
};

const requestCommentTurnstileToken = async (form, preferredSiteKey) => {
  const siteKey = getCommentTurnstileSiteKey(preferredSiteKey);
  if (!siteKey) {
    throw new Error("Turnstile not configured.");
  }

  await loadCommentTurnstileScript();
  if (!window.turnstile || typeof window.turnstile.render !== "function") {
    throw new Error("Turnstile unavailable.");
  }

  const state = ensureCommentTurnstileState(form);
  if (!state) {
    throw new Error("Turnstile state unavailable.");
  }

  state.wrap.hidden = false;
  state.title.textContent = "Vui lòng xác minh bảo mật để tiếp tục gửi bình luận.";
  setCommentTurnstileError(form, "");

  const renderWidget = () => {
    state.widget.textContent = "";
    state.lastToken = "";
    state.widgetId = window.turnstile.render(state.widget, {
      sitekey: siteKey,
      theme: "dark",
      callback: (token) => {
        const safeToken = toSafeText(token);
        state.lastToken = safeToken;
        if (state.resolvePending) {
          state.resolvePending(safeToken);
        }
        state.pendingPromise = null;
        state.resolvePending = null;
        state.rejectPending = null;
      },
      "expired-callback": () => {
        state.lastToken = "";
        if (state.rejectPending) {
          state.rejectPending(new Error("Turnstile expired."));
        }
        state.pendingPromise = null;
        state.resolvePending = null;
        state.rejectPending = null;
        setCommentTurnstileError(form, "Phiên xác minh đã hết hạn. Vui lòng xác minh lại.");
      },
      "error-callback": () => {
        state.lastToken = "";
        if (state.rejectPending) {
          state.rejectPending(new Error("Turnstile failed."));
        }
        state.pendingPromise = null;
        state.resolvePending = null;
        state.rejectPending = null;
        setCommentTurnstileError(form, "Không thể tải xác minh bảo mật. Vui lòng thử lại.");
      }
    });
    state.siteKey = siteKey;
  };

  if (state.widgetId == null || state.siteKey !== siteKey) {
    renderWidget();
  }

  if (state.pendingPromise) {
    return state.pendingPromise;
  }

  const existingToken =
    state.widgetId != null && typeof window.turnstile.getResponse === "function"
      ? toSafeText(window.turnstile.getResponse(state.widgetId))
      : "";
  if (existingToken) {
    state.lastToken = existingToken;
    return existingToken;
  }

  state.pendingPromise = new Promise((resolve, reject) => {
    state.resolvePending = resolve;
    state.rejectPending = reject;
  });

  if (state.widgetId != null && typeof window.turnstile.reset === "function") {
    try {
      window.turnstile.reset(state.widgetId);
    } catch (_err) {
      // ignore
    }
  }

  return state.pendingPromise;
};

const insertCommentTextAtCursor = (textarea, rawText) => {
  if (!textarea) return;
  const text = rawText == null ? "" : String(rawText);
  if (!text) return;

  const start = Number.isFinite(textarea.selectionStart)
    ? Math.max(0, textarea.selectionStart)
    : textarea.value.length;
  const end = Number.isFinite(textarea.selectionEnd) ? Math.max(start, textarea.selectionEnd) : start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);

  let insertValue = text;
  if (before && !/\s$/.test(before)) {
    insertValue = ` ${insertValue}`;
  }
  if (after && !/^\s/.test(after)) {
    insertValue = `${insertValue} `;
  }

  const limit = getCommentTextareaLimit(textarea);
  const nextValue = `${before}${insertValue}${after}`;
  if (nextValue.length > limit) {
    const fallbackValue = `${before}${text}${after}`;
    if (fallbackValue.length > limit) {
      window.alert(`Đã đạt giới hạn ${limit} ký tự.`);
      textarea.focus();
      return;
    }
    insertValue = text;
  }

  if (typeof textarea.setRangeText === "function") {
    textarea.setRangeText(insertValue, start, end, "end");
  } else {
    textarea.value = `${before}${insertValue}${after}`;
  }

  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
};

const getCommentMentionApiPath = (textarea) => {
  const section = textarea && textarea.closest ? textarea.closest(commentSelectors.section) : null;
  if (!section || !section.dataset) return "";
  return toSafeText(section.dataset.commentMentionUrl);
};

const normalizeCommentMentionCandidate = (rawUser) => {
  const user = rawUser && typeof rawUser === "object" ? rawUser : {};
  const username = toSafeText(user.username).toLowerCase();
  if (!/^[a-z0-9_]{1,24}$/.test(username)) {
    return null;
  }

  const name = toSafeText(user.name) || `@${username}`;
  const roleLabel = toSafeText(user.roleLabel);
  const avatarUrl = toSafeText(user.avatarUrl);
  return {
    id: toSafeText(user.id),
    username,
    name,
    roleLabel,
    avatarUrl
  };
};

const getCommentMentionContext = (textarea) => {
  if (!textarea) return null;
  const value = textarea.value == null ? "" : String(textarea.value);
  const start = Number.isFinite(textarea.selectionStart)
    ? Math.max(0, textarea.selectionStart)
    : value.length;
  const end = Number.isFinite(textarea.selectionEnd) ? Math.max(start, textarea.selectionEnd) : start;
  if (start !== end) return null;

  const head = value.slice(0, start);
  const atIndex = head.lastIndexOf("@");
  if (atIndex < 0) return null;

  const previousChar = atIndex === 0 ? "" : head.charAt(atIndex - 1);
  if (previousChar && /[a-z0-9_]/i.test(previousChar)) return null;

  const query = head.slice(atIndex + 1);
  if (query.length > COMMENT_MENTION_MAX_QUERY) return null;
  if (/\s/.test(query)) return null;

  return {
    query,
    replaceStart: atIndex,
    replaceEnd: start
  };
};

const pruneCommentMentionStates = () => {
  commentMentionStates.forEach((state) => {
    if (!state || !state.textarea || !state.textarea.isConnected) {
      commentMentionStates.delete(state);
    }
  });
};

const hideCommentMentionPanel = (state) => {
  if (!state || !state.panel) return;
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  state.panel.hidden = true;
  state.items = [];
  state.activeIndex = -1;
  state.activeRange = null;
  if (state.list) {
    state.list.textContent = "";
  }
};

const hideAllCommentMentionPanels = (keepTextarea) => {
  pruneCommentMentionStates();
  commentMentionStates.forEach((state) => {
    if (keepTextarea && state && state.textarea === keepTextarea) return;
    hideCommentMentionPanel(state);
  });
};

const setCommentMentionActiveIndex = (state, index) => {
  if (!state || !Array.isArray(state.items) || !state.items.length) {
    state.activeIndex = -1;
    return;
  }

  const length = state.items.length;
  const nextIndex = ((Number(index) || 0) % length + length) % length;
  state.activeIndex = nextIndex;

  if (!state.list) return;
  const buttons = state.list.querySelectorAll(".comment-mention-item");
  buttons.forEach((button, buttonIndex) => {
    const active = buttonIndex === nextIndex;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
};

const selectCommentMentionCandidate = (textarea, state, user) => {
  if (!textarea || !state || !user || !state.activeRange) return;

  const limit = getCommentTextareaLimit(textarea);
  const before = textarea.value.slice(0, state.activeRange.start);
  const after = textarea.value.slice(state.activeRange.end);
  const mentionCore = `@${user.username}`;
  const appendSpace = after && /^[\s.,!?;:)}\]]/.test(after) ? "" : " ";
  const replacement = `${mentionCore}${appendSpace}`;
  const candidate = `${before}${replacement}${after}`;
  if (candidate.length > limit) {
    window.alert(`Đã đạt giới hạn ${limit} ký tự.`);
    textarea.focus();
    return;
  }

  if (typeof textarea.setRangeText === "function") {
    textarea.setRangeText(replacement, state.activeRange.start, state.activeRange.end, "end");
  } else {
    textarea.value = candidate;
  }

  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  hideCommentMentionPanel(state);
};

const renderCommentMentionCandidates = ({ textarea, state, users }) => {
  if (!state || !state.panel || !state.list) return;
  const list = Array.isArray(users) ? users : [];
  state.items = list;
  state.list.textContent = "";

  if (!list.length) {
    hideCommentMentionPanel(state);
    return;
  }

  list.forEach((user, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "comment-mention-item";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    button.dataset.mentionIndex = String(index);

    const avatarWrap = document.createElement("span");
    avatarWrap.className = "comment-mention-item__avatar";
    const rawAvatar = toSafeText(user.avatarUrl);
    const isSafeAvatar =
      rawAvatar &&
      rawAvatar.length <= 500 &&
      (/^https?:\/\//i.test(rawAvatar) || rawAvatar.startsWith("/uploads/avatars/"));
    if (isSafeAvatar) {
      const image = document.createElement("img");
      image.src = rawAvatar;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      avatarWrap.appendChild(image);
    } else {
      avatarWrap.innerHTML = "<i class='fa-regular fa-user' aria-hidden='true'></i>";
    }

    const meta = document.createElement("span");
    meta.className = "comment-mention-item__meta";

    const main = document.createElement("span");
    main.className = "comment-mention-item__name";
    main.textContent = user.name;

    const sub = document.createElement("span");
    sub.className = "comment-mention-item__sub";
    sub.innerHTML = `<span>@${user.username}</span>`;
    if (user.roleLabel) {
      const role = document.createElement("span");
      role.className = "comment-mention-item__role";
      role.textContent = user.roleLabel;
      sub.appendChild(role);
    }

    meta.appendChild(main);
    meta.appendChild(sub);

    button.appendChild(avatarWrap);
    button.appendChild(meta);
    button.addEventListener("click", () => {
      selectCommentMentionCandidate(textarea, state, user);
    });

    state.list.appendChild(button);
  });

  state.panel.hidden = false;
  setCommentMentionActiveIndex(state, 0);
};

const fetchCommentMentionCandidates = async ({ apiPath, query }) => {
  const endpoint = toSafeText(apiPath);
  if (!endpoint) return [];

  let accessToken = "";
  try {
    if (window.BfangAuth && typeof window.BfangAuth.getAccessToken === "function") {
      accessToken = await window.BfangAuth.getAccessToken();
    }
  } catch (_err) {
    accessToken = "";
  }
  if (!accessToken) return [];

  const normalizedQuery = (query || "").toString().trim().toLowerCase();
  const cacheKey = `${endpoint}|${normalizedQuery}`;
  const cached = commentMentionCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.cachedAt < COMMENT_MENTION_CACHE_MS) {
    return cached.items;
  }

  if (commentMentionPendingMap.has(cacheKey)) {
    return commentMentionPendingMap.get(cacheKey);
  }

  const request = (async () => {
    let requestUrl = null;
    try {
      requestUrl = new URL(endpoint, window.location.origin);
    } catch (_err) {
      return [];
    }
    requestUrl.searchParams.set("limit", String(COMMENT_MENTION_FETCH_LIMIT));
    requestUrl.searchParams.set("q", normalizedQuery);

    const response = await fetch(requestUrl.toString(), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      credentials: "same-origin"
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true || !Array.isArray(data.users)) {
      return [];
    }

    const items = data.users
      .map((user) => normalizeCommentMentionCandidate(user))
      .filter(Boolean)
      .slice(0, COMMENT_MENTION_FETCH_LIMIT);

    commentMentionCache.set(cacheKey, {
      items,
      cachedAt: Date.now()
    });
    return items;
  })().finally(() => {
    commentMentionPendingMap.delete(cacheKey);
  });

  commentMentionPendingMap.set(cacheKey, request);
  return request;
};

const triggerCommentMentionSearch = (textarea, state) => {
  if (!textarea || !state) return;

  const context = getCommentMentionContext(textarea);
  const apiPath = getCommentMentionApiPath(textarea);
  if (!context || !apiPath) {
    hideCommentMentionPanel(state);
    return;
  }

  state.activeRange = {
    start: context.replaceStart,
    end: context.replaceEnd
  };

  const requestId = state.requestId + 1;
  state.requestId = requestId;

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
  }

  state.debounceTimer = setTimeout(() => {
    fetchCommentMentionCandidates({ apiPath, query: context.query })
      .then((users) => {
        if (!state || requestId !== state.requestId) return;
        renderCommentMentionCandidates({ textarea, state, users });
      })
      .catch(() => {
        if (!state || requestId !== state.requestId) return;
        hideCommentMentionPanel(state);
      });
  }, COMMENT_MENTION_DEBOUNCE_MS);
};

const handleCommentMentionKeyDown = (event, textarea, state) => {
  if (!state || !state.panel || state.panel.hidden) return false;

  if (!Array.isArray(state.items) || !state.items.length) {
    hideCommentMentionPanel(state);
    return false;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    setCommentMentionActiveIndex(state, state.activeIndex + 1);
    return true;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    setCommentMentionActiveIndex(state, state.activeIndex - 1);
    return true;
  }

  if (event.key === "Enter" || event.key === "Tab") {
    const activeItem = state.items[state.activeIndex] || state.items[0];
    if (!activeItem) return false;
    event.preventDefault();
    selectCommentMentionCandidate(textarea, state, activeItem);
    return true;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    hideCommentMentionPanel(state);
    return true;
  }

  return false;
};

const ensureCommentMentionAutocomplete = (textarea) => {
  if (!textarea || textarea.dataset.commentMentionReady === "1") return;

  const panel = document.createElement("div");
  panel.className = "comment-mention-panel";
  panel.hidden = true;
  panel.setAttribute("data-comment-mention-panel", "");
  panel.setAttribute("role", "listbox");
  panel.setAttribute("aria-label", "Gợi ý người dùng để tag");

  const note = document.createElement("p");
  note.className = "comment-mention-note";
  note.textContent = "Chỉ tag được Admin, Mod và người từng bình luận ở truyện này.";
  panel.appendChild(note);

  const list = document.createElement("div");
  list.className = "comment-mention-list";
  panel.appendChild(list);

  textarea.insertAdjacentElement("afterend", panel);

  const state = {
    textarea,
    panel,
    list,
    items: [],
    activeIndex: -1,
    activeRange: null,
    requestId: 0,
    debounceTimer: null
  };
  commentMentionStates.add(state);

  panel.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  textarea.addEventListener("input", () => {
    triggerCommentMentionSearch(textarea, state);
  });

  textarea.addEventListener("click", () => {
    triggerCommentMentionSearch(textarea, state);
  });

  textarea.addEventListener("focus", () => {
    hideAllCommentMentionPanels(textarea);
    triggerCommentMentionSearch(textarea, state);
  });

  textarea.addEventListener("keydown", (event) => {
    handleCommentMentionKeyDown(event, textarea, state);
  });

  textarea.dataset.commentMentionReady = "1";
};

const buildCommentEmojiFallbackGrid = (textarea, details) => {
  const grid = document.createElement("div");
  grid.className = "comment-picker__grid comment-picker__grid--emoji";

  commentEmojiFallbackList.forEach((emoji) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "comment-picker__item comment-picker__item--emoji";
    button.setAttribute("aria-label", `Chen emoji ${emoji}`);
    button.textContent = emoji;
    button.addEventListener("click", () => {
      insertCommentTextAtCursor(textarea, emoji);
      details.open = false;
    });
    grid.appendChild(button);
  });

  return grid;
};

const buildCommentEmojiPicker = (textarea) => {
  const details = document.createElement("details");
  details.className = "comment-picker comment-picker--emoji";

  const summary = document.createElement("summary");
  summary.className = "comment-picker__toggle";
  summary.setAttribute("aria-label", "Chon emoji");
  summary.title = "Chen emoji";
  summary.innerHTML = `${commentToolIcons.emoji}<span class="comment-picker__sr">Emoji</span>`;
  details.appendChild(summary);

  const panel = document.createElement("div");
  panel.className = "comment-picker__panel comment-picker__panel--emoji-mart";

  let pickerReady = false;
  let pickerLoading = false;
  let fallbackReady = false;

  const setPanelStatus = (message) => {
    panel.textContent = "";
    const note = document.createElement("p");
    note.className = "comment-picker__status";
    note.textContent = message;
    panel.appendChild(note);
  };

  const mountFallback = (message) => {
    if (fallbackReady) return;
    panel.textContent = "";
    if (message) {
      const note = document.createElement("p");
      note.className = "comment-picker__status";
      note.textContent = message;
      panel.appendChild(note);
    }
    panel.appendChild(buildCommentEmojiFallbackGrid(textarea, details));
    fallbackReady = true;
  };

  const mountEmojiMartPicker = async () => {
    if (pickerReady || pickerLoading || fallbackReady) return;

    pickerLoading = true;
    setPanelStatus("Đang tải Emoji Mart...");

    try {
      const [emojiMartApi, emojiData, emojiI18n] = await Promise.all([
        loadEmojiMartScript(),
        loadEmojiMartData(),
        loadEmojiMartI18n()
      ]);

      if (!details.isConnected) return;
      if (!emojiMartApi || typeof emojiMartApi.Picker !== "function" || !emojiData) {
        throw new Error("Emoji Mart Picker API is unavailable.");
      }

      const picker = new emojiMartApi.Picker({
        data: emojiData,
        i18n: emojiI18n || undefined,
        locale: "vi",
        set: "native",
        theme: "dark",
        icons: "auto",
        dynamicWidth: true,
        navPosition: "bottom",
        searchPosition: "sticky",
        previewPosition: "none",
        maxFrequentRows: 2,
        onEmojiSelect: (emoji) => {
          const selected = emoji && emoji.native ? String(emoji.native) : "";
          if (!selected) return;
          insertCommentTextAtCursor(textarea, selected);
          details.open = false;
        }
      });

      picker.classList.add("comment-picker__emoji-mart");
      panel.textContent = "";
      panel.appendChild(picker);
      pickerReady = true;
    } catch (_err) {
      mountFallback("Không tải được Emoji Mart. Đang dùng emoji cơ bản.");
    } finally {
      pickerLoading = false;
    }
  };

  details.addEventListener("toggle", () => {
    if (!details.open) return;
    closeSiblingCommentPickers(details);
    mountEmojiMartPicker().catch(() => {
      mountFallback("Không tải được Emoji Mart. Đang dùng emoji cơ bản.");
    });
  });

  details.appendChild(panel);
  return details;
};

const buildCommentStickerGrid = (textarea, details, stickers) => {
  const grid = document.createElement("div");
  grid.className = "comment-picker__grid comment-picker__grid--sticker";

  stickers.forEach((sticker) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "comment-picker__item comment-picker__item--sticker";
    button.setAttribute("aria-label", `Chen sticker ${sticker.label}`);

    const image = document.createElement("img");
    image.className = "comment-picker__sticker";
    image.alt = sticker.label;
    image.loading = "lazy";
    image.decoding = "async";
    image.fetchPriority = "low";
    image.dataset.stickerSrc = sticker.src;

    const label = document.createElement("span");
    label.className = "comment-picker__sticker-label";
    label.textContent = sticker.label;

    button.appendChild(image);
    button.appendChild(label);

    button.addEventListener("click", () => {
      insertCommentTextAtCursor(textarea, `[sticker:${sticker.code}]`);
      details.open = false;
    });

    grid.appendChild(button);
  });

  return grid;
};

const buildCommentStickerPicker = (textarea) => {
  const details = document.createElement("details");
  details.className = "comment-picker comment-picker--sticker";

  const summary = document.createElement("summary");
  summary.className = "comment-picker__toggle";
  summary.setAttribute("aria-label", "Chon sticker");
  summary.title = "Chen sticker";
  summary.innerHTML = `${commentToolIcons.sticker}<span class="comment-picker__sr">Sticker</span>`;
  details.appendChild(summary);

  const panel = document.createElement("div");
  panel.className = "comment-picker__panel";

  let pickerReady = false;
  let pickerLoading = false;

  const setPanelStatus = (message) => {
    panel.textContent = "";
    const note = document.createElement("p");
    note.className = "comment-picker__status";
    note.textContent = message;
    panel.appendChild(note);
  };

  const mountStickerGrid = (stickers) => {
    panel.textContent = "";
    const grid = buildCommentStickerGrid(textarea, details, stickers);
    panel.appendChild(grid);
    grid.querySelectorAll("img[data-sticker-src]").forEach((image) => {
      queueCommentStickerImageLoad(image);
    });
    pickerReady = true;
  };

  const mountStickerPicker = async () => {
    if (pickerReady || pickerLoading) return;

    pickerLoading = true;
    setPanelStatus("Đang tải sticker...");

    try {
      const stickers = await loadCommentStickerManifest();
      if (!details.isConnected) return;
      mountStickerGrid(stickers);
    } catch (_err) {
      if (!details.isConnected) return;
      mountStickerGrid(commentStickerList);
    } finally {
      pickerLoading = false;
    }
  };

  const warmupStickerManifest = () => {
    loadCommentStickerManifest().catch(() => null);
  };

  summary.addEventListener("pointerenter", warmupStickerManifest, { once: true });
  summary.addEventListener("focus", warmupStickerManifest, { once: true });

  details.addEventListener("toggle", () => {
    if (!details.open) return;
    closeSiblingCommentPickers(details);
    mountStickerPicker().catch(() => null);
  });

  details.appendChild(panel);
  return details;
};

const ensureCommentComposerTools = (textarea) => {
  if (!textarea || textarea.dataset.commentToolsReady === "1") return;

  const tools = document.createElement("div");
  tools.className = "comment-tools";
  tools.appendChild(buildCommentEmojiPicker(textarea));
  tools.appendChild(buildCommentStickerPicker(textarea));

  const parent = textarea.parentElement;
  const counterId = (textarea.dataset.commentCounterId || "").trim();
  const counterEl = counterId ? document.getElementById(counterId) : null;
  let metaRow = null;

  if (counterEl && counterEl.parentElement && counterEl.parentElement.classList) {
    if (counterEl.parentElement.classList.contains("comment-compose-meta")) {
      metaRow = counterEl.parentElement;
    }
  }

  if (!metaRow) {
    metaRow = document.createElement("div");
    metaRow.className = "comment-compose-meta";
    if (counterEl && parent && counterEl.parentElement === parent) {
      counterEl.insertAdjacentElement("beforebegin", metaRow);
      metaRow.appendChild(counterEl);
    } else {
      textarea.insertAdjacentElement("afterend", metaRow);
    }
  }

  if (counterEl && counterEl.parentElement !== metaRow) {
    metaRow.appendChild(counterEl);
  }

  if (metaRow.firstChild) {
    metaRow.insertBefore(tools, metaRow.firstChild);
  } else {
    metaRow.appendChild(tools);
  }

  if (counterEl && counterEl.parentElement !== tools) {
    tools.appendChild(counterEl);
  }

  ensureCommentMentionAutocomplete(textarea);
  textarea.dataset.commentToolsReady = "1";
};

const normalizeCommentMentionItems = (rawMentions) => {
  const list = Array.isArray(rawMentions) ? rawMentions : [];
  return list
    .map((item) => {
      const username = toSafeText(item && item.username ? item.username : "").toLowerCase();
      if (!/^[a-z0-9_]{1,24}$/.test(username)) return null;
      const userId = toSafeText(item && item.userId ? item.userId : "");
      const name =
        toSafeText(item && item.name ? item.name : "").replace(/^@+/, "") ||
        `@${username}`;
      const userColor = toSafeText(item && item.userColor ? item.userColor : "");
      return {
        userId,
        username,
        name,
        userColor
      };
    })
    .filter(Boolean);
};

const parseCommentMentionItems = (rawValue) => {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) {
    return normalizeCommentMentionItems(rawValue);
  }
  const text = toSafeText(rawValue);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return normalizeCommentMentionItems(parsed);
  } catch (_err) {
    return [];
  }
};

const getCommentLinkRegex = () => /(?:https?:\/\/[^\s<>"']+|\/manga\/[^\s<>"']+)/gi;

const trimTrailingCharsFromCommentUrl = (rawUrlText) => {
  const raw = rawUrlText == null ? "" : String(rawUrlText);
  if (!raw) {
    return {
      urlText: "",
      trailingText: ""
    };
  }

  let urlText = raw;
  let trailingText = "";
  while (urlText) {
    const lastChar = urlText.charAt(urlText.length - 1);
    if (!".,!?;:)]}\"'".includes(lastChar)) {
      break;
    }
    trailingText = `${lastChar}${trailingText}`;
    urlText = urlText.slice(0, -1);
  }

  return {
    urlText,
    trailingText
  };
};

const decodeCommentPathSegment = (value) => {
  const raw = value == null ? "" : String(value);
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch (_err) {
    return raw;
  }
};

const normalizeCommentHostName = (value) => toSafeText(value).toLowerCase().replace(/^www\./, "");

const isCommentSiteUrl = (candidateUrl) => {
  if (!candidateUrl) return false;
  const currentHost = normalizeCommentHostName(window.location.hostname);
  const targetHost = normalizeCommentHostName(candidateUrl.hostname);
  if (!currentHost || !targetHost) return false;
  return currentHost === targetHost;
};

const formatCommentTitleWord = (word) => {
  const text = toSafeText(word).toLowerCase();
  if (!text) return "";
  if (/^[a-z0-9]{1,3}$/.test(text)) {
    return text.toUpperCase();
  }
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
};

const buildCommentTitleFromMangaSlug = (slug, linkContext) => {
  const normalizedSlug = toSafeText(slug).toLowerCase();
  const contextSlug = toSafeText(linkContext && linkContext.mangaSlug ? linkContext.mangaSlug : "").toLowerCase();
  const contextTitle = toSafeText(linkContext && linkContext.mangaTitle ? linkContext.mangaTitle : "");
  if (contextTitle && contextSlug && contextSlug === normalizedSlug) {
    return contextTitle;
  }

  const decodedSlug = decodeCommentPathSegment(slug).replace(/^\d+-/, "");
  const words = decodedSlug
    .split(/[-_]+/)
    .map((part) => formatCommentTitleWord(part))
    .filter(Boolean);

  if (!words.length) {
    return "Truyện";
  }

  return words.join(" ");
};

const normalizeCommentChapterNumberLabel = (chapterValue) => {
  const raw = decodeCommentPathSegment(chapterValue).replace(/,/g, ".").trim();
  if (!raw) return "";
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return raw;
  }

  const rounded = Math.round(numeric * 1000) / 1000;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toString();
};

const buildCommentLinkLabelKey = ({
  type,
  mangaSlug,
  chapterNumberText,
  username,
  teamSlug,
  postId
}) => {
  const normalizedType = toSafeText(type).toLowerCase();
  const slug = toSafeText(mangaSlug).toLowerCase();
  const safeUsername = toSafeText(username).toLowerCase();
  const safeTeamSlug = toSafeText(teamSlug).toLowerCase();
  const safePostId = toSafeText(postId);

  if (normalizedType === "chapter") {
    if (!slug) return "";
    const chapter = normalizeCommentChapterNumberLabel(chapterNumberText);
    if (!chapter) return "";
    return `chapter:${slug}:${chapter}`;
  }

  if (normalizedType === "manga") {
    if (!slug) return "";
    return `manga:${slug}`;
  }

  if (normalizedType === "user") {
    if (!/^[a-z0-9_]{1,24}$/.test(safeUsername)) return "";
    return `user:${safeUsername}`;
  }

  if (normalizedType === "team") {
    if (!/^[a-z0-9][a-z0-9_-]{0,199}$/.test(safeTeamSlug)) return "";
    return `team:${safeTeamSlug}`;
  }

  if (normalizedType === "forum-post") {
    if (!/^[1-9][0-9]{0,11}$/.test(safePostId)) return "";
    return `forum-post:${safePostId}`;
  }

  return "";
};

const resolveCommentInternalLinkMeta = (rawUrlText, linkContext) => {
  const source = toSafeText(rawUrlText);
  if (!source) return null;

  let parsedUrl = null;
  try {
    if (source.startsWith("/")) {
      parsedUrl = new URL(source, window.location.origin);
    } else {
      parsedUrl = new URL(source);
    }
  } catch (_err) {
    return null;
  }

  if (!parsedUrl || !/^https?:$/i.test(parsedUrl.protocol || "")) {
    return null;
  }
  if (!isCommentSiteUrl(parsedUrl)) {
    return null;
  }

  const normalizedPath = ((parsedUrl.pathname || "").replace(/\/+$/, "") || "/").trim();
  const userMatch = normalizedPath.match(/^\/comments\/users\/([^/]+)$/i);
  if (userMatch) {
    const userId = decodeCommentPathSegment(userMatch[1]).trim();
    if (!userId) return null;
    return {
      href: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
      label: "user",
      type: "user",
      labelKey: "",
      needsCanonicalLabel: false
    };
  }

  const teamMatch = normalizedPath.match(/^\/team\/([^/]+)\/([^/]+)$/i);
  if (teamMatch) {
    const teamSlug = decodeCommentPathSegment(teamMatch[2]).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,199}$/.test(teamSlug)) return null;
    return {
      href: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
      label: "nhóm dịch",
      type: "team",
      teamSlug,
      labelKey: buildCommentLinkLabelKey({ type: "team", teamSlug }),
      needsCanonicalLabel: true
    };
  }

  const forumPostMatch = normalizedPath.match(/^\/(?:forum\/)?post\/([1-9][0-9]{0,11})$/i);
  if (forumPostMatch) {
    const postId = decodeCommentPathSegment(forumPostMatch[1]).trim();
    return {
      href: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
      label: "bài viết",
      type: "forum-post",
      postId,
      labelKey: buildCommentLinkLabelKey({ type: "forum-post", postId }),
      needsCanonicalLabel: true
    };
  }

  const chapterMatch = normalizedPath.match(/^\/manga\/([^/]+)\/chapters\/([^/]+)$/i);
  if (chapterMatch) {
    const mangaSlug = decodeCommentPathSegment(chapterMatch[1]).trim().toLowerCase();
    const chapterNumberLabel = normalizeCommentChapterNumberLabel(chapterMatch[2]);
    if (!mangaSlug || !chapterNumberLabel) return null;

    const contextSlug = toSafeText(linkContext && linkContext.mangaSlug ? linkContext.mangaSlug : "").toLowerCase();
    const contextTitle = toSafeText(linkContext && linkContext.mangaTitle ? linkContext.mangaTitle : "");
    const hasContextTitle = Boolean(contextTitle && contextSlug && contextSlug === mangaSlug);
    const mangaTitle = buildCommentTitleFromMangaSlug(mangaSlug, linkContext);
    return {
      href: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
      label: `${mangaTitle} - Ch. ${chapterNumberLabel}`,
      type: "chapter",
      mangaSlug,
      chapterNumberText: chapterNumberLabel,
      labelKey: buildCommentLinkLabelKey({
        type: "chapter",
        mangaSlug,
        chapterNumberText: chapterNumberLabel
      }),
      needsCanonicalLabel: !hasContextTitle
    };
  }

  const mangaMatch = normalizedPath.match(/^\/manga\/([^/]+)$/i);
  if (!mangaMatch) return null;

  const mangaSlug = decodeCommentPathSegment(mangaMatch[1]).trim().toLowerCase();
  if (!mangaSlug) return null;
  const contextSlug = toSafeText(linkContext && linkContext.mangaSlug ? linkContext.mangaSlug : "").toLowerCase();
  const contextTitle = toSafeText(linkContext && linkContext.mangaTitle ? linkContext.mangaTitle : "");
  const hasContextTitle = Boolean(contextTitle && contextSlug && contextSlug === mangaSlug);
  const mangaTitle = buildCommentTitleFromMangaSlug(mangaSlug, linkContext);
  return {
    href: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
    label: mangaTitle,
    type: "manga",
    mangaSlug,
    chapterNumberText: "",
    labelKey: buildCommentLinkLabelKey({
      type: "manga",
      mangaSlug,
      chapterNumberText: ""
    }),
    needsCanonicalLabel: !hasContextTitle
  };
};

const buildCommentInlineLinkElement = (meta) => {
  if (!meta) return null;
  const label = toSafeText(meta.label);
  const href = toSafeText(meta.href);
  if (!label || !href) return null;

  const link = document.createElement("a");
  link.className = "comment-inline-link";
  link.href = href;
  const labelKey = toSafeText(meta.labelKey);
  const cachedLabel = labelKey ? toSafeText(commentLinkLabelCache.get(labelKey)) : "";
  const visibleLabel = cachedLabel || label;

  link.textContent = visibleLabel;
  link.title = visibleLabel;

  const shouldLookup = Boolean(meta && meta.needsCanonicalLabel && labelKey);
  if (shouldLookup) {
    const type = toSafeText(meta.type).toLowerCase();
    const mangaSlug = toSafeText(meta.mangaSlug).toLowerCase();
    const username = toSafeText(meta.username).toLowerCase();
    const teamSlug = toSafeText(meta.teamSlug).toLowerCase();
    const postId = toSafeText(meta.postId);
    if (labelKey) {
      link.dataset.commentLinkKey = labelKey;
      link.dataset.commentLinkType = type;
      if ((type === "manga" || type === "chapter") && mangaSlug) {
        link.dataset.commentLinkSlug = mangaSlug;
        if (type === "chapter") {
          const chapterNumberText = normalizeCommentChapterNumberLabel(meta.chapterNumberText);
          if (chapterNumberText) {
            link.dataset.commentLinkChapter = chapterNumberText;
          }
        }
      } else if (type === "user" && username) {
        link.dataset.commentLinkUsername = username;
      } else if (type === "team" && teamSlug) {
        link.dataset.commentLinkTeamSlug = teamSlug;
      } else if (type === "forum-post" && /^[1-9][0-9]{0,11}$/.test(postId)) {
        link.dataset.commentLinkPostId = postId;
      }
    }
  }

  return link;
};

const setCommentInlineLinkLabel = (link, labelValue) => {
  if (!link) return;
  const label = toSafeText(labelValue).replace(/\s+/g, " ").trim();
  if (!label) return;
  link.textContent = label;
  link.title = label;
};

const fetchCommentLinkLabels = async (items) => {
  const safeItems = Array.isArray(items) ? items.slice(0, COMMENT_LINK_LABEL_FETCH_LIMIT) : [];
  if (!safeItems.length) return {};

  const response = await fetch(commentLinkLabelApiPath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    credentials: "same-origin",
    body: JSON.stringify({ items: safeItems })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok !== true || !payload.labels || typeof payload.labels !== "object") {
    return {};
  }
  return payload.labels;
};

const hydrateCommentInlineLinks = async (root) => {
  const links = [];
  if (root && root.matches && root.matches(".comment-inline-link[data-comment-link-key]")) {
    links.push(root);
  }

  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll(".comment-inline-link[data-comment-link-key]").forEach((link) => {
    links.push(link);
  });

  if (!links.length) return;

  const groupedLinks = new Map();
  const lookupItems = [];

  links.forEach((link) => {
    const key = toSafeText(link && link.dataset ? link.dataset.commentLinkKey : "");
    if (!key) return;

    const cachedLabel = toSafeText(commentLinkLabelCache.get(key));
    if (cachedLabel) {
      setCommentInlineLinkLabel(link, cachedLabel);
      return;
    }

    const type = toSafeText(link.dataset.commentLinkType).toLowerCase();
    if (!/^(manga|chapter|user|team|forum-post)$/.test(type)) return;

    const slug = toSafeText(link.dataset.commentLinkSlug).toLowerCase();
    const username = toSafeText(link.dataset.commentLinkUsername).toLowerCase();
    const teamSlug = toSafeText(link.dataset.commentLinkTeamSlug).toLowerCase();
    const postId = toSafeText(link.dataset.commentLinkPostId);

    let chapterNumberText = "";
    if (type === "chapter") {
      if (!/^[a-z0-9][a-z0-9_-]{0,199}$/.test(slug)) return;
      chapterNumberText = normalizeCommentChapterNumberLabel(link.dataset.commentLinkChapter);
      if (!chapterNumberText) return;
    } else if (type === "manga") {
      if (!/^[a-z0-9][a-z0-9_-]{0,199}$/.test(slug)) return;
    } else if (type === "user") {
      if (!/^[a-z0-9_]{1,24}$/.test(username)) return;
    } else if (type === "team") {
      if (!/^[a-z0-9][a-z0-9_-]{0,199}$/.test(teamSlug)) return;
    } else if (type === "forum-post") {
      if (!/^[1-9][0-9]{0,11}$/.test(postId)) return;
    }

    if (!groupedLinks.has(key)) {
      groupedLinks.set(key, []);
      lookupItems.push({
        type,
        slug,
        chapterNumberText,
        username,
        teamSlug,
        postId
      });
    }
    groupedLinks.get(key).push(link);
  });

  if (!lookupItems.length) return;

  for (let index = 0; index < lookupItems.length; index += COMMENT_LINK_LABEL_FETCH_LIMIT) {
    const chunk = lookupItems.slice(index, index + COMMENT_LINK_LABEL_FETCH_LIMIT);
    const labels = await fetchCommentLinkLabels(chunk).catch(() => ({}));
    Object.entries(labels).forEach(([key, labelValue]) => {
      const normalizedLabel = toSafeText(labelValue).replace(/\s+/g, " ").trim();
      if (!normalizedLabel) return;
      commentLinkLabelCache.set(key, normalizedLabel);
      const targets = groupedLinks.get(key);
      if (!Array.isArray(targets)) return;
      targets.forEach((link) => {
        if (!link || !link.isConnected) return;
        setCommentInlineLinkLabel(link, normalizedLabel);
      });
    });
  }
};

const readCommentLinkContext = (sourceElement) => {
  const section = sourceElement && sourceElement.closest ? sourceElement.closest(commentSelectors.section) : null;
  if (!section || !section.dataset) {
    return {
      mangaSlug: "",
      mangaTitle: ""
    };
  }

  return {
    mangaSlug: toSafeText(section.dataset.commentMangaSlug).toLowerCase(),
    mangaTitle: toSafeText(section.dataset.commentMangaTitle)
  };
};

const buildCommentMentionElement = (mention) => {
  const el = document.createElement("span");
  el.className = "comment-mention";

  const nameEl = document.createElement("span");
  nameEl.className = "comment-author__name";
  nameEl.textContent = mention && mention.name ? mention.name : "Người dùng";
  el.appendChild(nameEl);

  const userColor = mention && mention.userColor ? String(mention.userColor).trim() : "";
  if (userColor) {
    el.style.setProperty("--mention-color", userColor);
  }

  const userId = mention && mention.userId ? String(mention.userId).trim() : "";
  const username = mention && mention.username ? String(mention.username).trim().toLowerCase() : "";
  if (userId) {
    el.classList.add("comment-author--interactive");
    el.setAttribute("role", "link");
    el.setAttribute("tabindex", "0");
    el.setAttribute("data-comment-author-trigger", "");
    el.dataset.commentUserId = userId;
    if (commentProfileUsernamePattern.test(username)) {
      el.dataset.commentUsername = username;
    }
    el.setAttribute("aria-label", `Xem thông tin người dùng ${nameEl.textContent}`);
  }

  return el;
};

const appendCommentTextWithMentions = ({ target, text, mentionMap }) => {
  if (!target) return;
  const raw = text == null ? "" : String(text);
  if (!raw) return;

  const map = mentionMap instanceof Map ? mentionMap : new Map();
  const regex = /(^|[^a-z0-9_])@([a-z0-9_]{1,24})/gi;
  let cursor = 0;
  let match = regex.exec(raw);

  while (match) {
    const full = match[0] || "";
    const prefix = match[1] || "";
    const username = (match[2] || "").toString().trim().toLowerCase();
    const mention = username ? map.get(username) : null;

    if (match.index > cursor) {
      target.appendChild(document.createTextNode(raw.slice(cursor, match.index)));
    }

    if (prefix) {
      target.appendChild(document.createTextNode(prefix));
    }

    if (mention) {
      target.appendChild(buildCommentMentionElement(mention));
    } else {
      const atStart = match.index + prefix.length;
      target.appendChild(document.createTextNode(raw.slice(atStart, match.index + full.length)));
    }

    cursor = match.index + full.length;
    match = regex.exec(raw);
  }

  if (cursor < raw.length) {
    target.appendChild(document.createTextNode(raw.slice(cursor)));
  }
};

const appendCommentTextWithLinksAndMentions = ({ target, text, mentionMap, linkContext }) => {
  if (!target) return;
  const raw = text == null ? "" : String(text);
  if (!raw) return;

  const linkRegex = getCommentLinkRegex();
  let cursor = 0;
  let match = linkRegex.exec(raw);

  while (match) {
    const matchedText = match[0] || "";
    if (!matchedText) {
      match = linkRegex.exec(raw);
      continue;
    }

    if (matchedText.startsWith("/manga/")) {
      const previousChar = match.index > 0 ? raw.charAt(match.index - 1) : "";
      if (previousChar && /[a-z0-9_]/i.test(previousChar)) {
        match = linkRegex.exec(raw);
        continue;
      }
    }

    if (match.index > cursor) {
      appendCommentTextWithMentions({
        target,
        text: raw.slice(cursor, match.index),
        mentionMap
      });
    }

    const { urlText, trailingText } = trimTrailingCharsFromCommentUrl(matchedText);
    const linkMeta = resolveCommentInternalLinkMeta(urlText, linkContext);
    if (linkMeta) {
      const linkEl = buildCommentInlineLinkElement(linkMeta);
      if (linkEl) {
        target.appendChild(linkEl);
      } else {
        appendCommentTextWithMentions({ target, text: urlText, mentionMap });
      }
      if (trailingText) {
        appendCommentTextWithMentions({ target, text: trailingText, mentionMap });
      }
    } else {
      appendCommentTextWithMentions({ target, text: matchedText, mentionMap });
    }

    cursor = match.index + matchedText.length;
    match = linkRegex.exec(raw);
  }

  if (cursor < raw.length) {
    appendCommentTextWithMentions({
      target,
      text: raw.slice(cursor),
      mentionMap
    });
  }
};

const renderCommentTextWithStickers = (target, rawValue, mentionItemsInput, options) => {
  if (!target) return;
  const settings = options && typeof options === "object" ? options : {};
  const linkContext = {
    mangaSlug: toSafeText(settings.mangaSlug).toLowerCase(),
    mangaTitle: toSafeText(settings.mangaTitle)
  };
  const raw = rawValue == null ? "" : String(rawValue);
  const mentionItems = parseCommentMentionItems(
    mentionItemsInput != null ? mentionItemsInput : target.dataset.commentMentions
  );
  const mentionMap = new Map(
    mentionItems.map((item) => [String(item.username).trim().toLowerCase(), item])
  );

  target.textContent = "";
  target.dataset.commentRaw = raw;
  target.dataset.commentMentions = JSON.stringify(mentionItems);

  const stickerTokenRegex = getStickerTokenRegex();
  let lastIndex = 0;
  let match = stickerTokenRegex.exec(raw);
  while (match) {
    if (match.index > lastIndex) {
      appendCommentTextWithLinksAndMentions({
        target,
        text: raw.slice(lastIndex, match.index),
        mentionMap,
        linkContext
      });
    }

    const stickerCode = (match[1] || "").toString().trim().toLowerCase();
    const sticker = commentStickerMap.get(stickerCode);
    if (sticker) {
      const image = document.createElement("img");
      image.className = "comment-sticker";
      image.src = sticker.src;
      image.alt = sticker.label;
      image.loading = "lazy";
      image.decoding = "async";
      target.appendChild(image);
    } else {
      target.appendChild(document.createTextNode(match[0]));
    }

    lastIndex = stickerTokenRegex.lastIndex;
    match = stickerTokenRegex.exec(raw);
  }

  if (lastIndex < raw.length) {
    appendCommentTextWithLinksAndMentions({
      target,
      text: raw.slice(lastIndex),
      mentionMap,
      linkContext
    });
  }

  target.dataset.commentRichReady = "1";
};

const initCommentRichText = (root) => {
  const scope = root && root.querySelectorAll ? root : document;
  const textBlocks = scope.querySelectorAll("#comments .comment-text");
  textBlocks.forEach((block) => {
    if (block.dataset.commentRichReady === "1") return;
    const raw = block.dataset.commentRaw != null ? block.dataset.commentRaw : block.textContent || "";
    const mentions = parseCommentMentionItems(block.dataset.commentMentions);
    const linkContext = readCommentLinkContext(block);
    renderCommentTextWithStickers(block, raw, mentions, linkContext);
  });

  hydrateCommentInlineLinks(scope).catch(() => null);
};

const ensureCommentCharCounter = (textarea) => {
  if (!textarea || textarea.dataset.commentCounterReady === "1") return;

  const counter = document.createElement("p");
  counter.className = "comment-char-counter";
  counter.dataset.commentCharCounter = "";
  commentCounterSeed += 1;
  counter.id = `comment-char-counter-${commentCounterSeed}`;

  textarea.insertAdjacentElement("afterend", counter);

  const describedBy = (textarea.getAttribute("aria-describedby") || "").trim();
  if (describedBy) {
    textarea.setAttribute("aria-describedby", `${describedBy} ${counter.id}`.trim());
  } else {
    textarea.setAttribute("aria-describedby", counter.id);
  }

  textarea.dataset.commentCounterReady = "1";
  textarea.dataset.commentCounterId = counter.id;
  textarea.addEventListener("input", () => {
    const form = textarea.form;
    if (form) {
      hideCommentFormNotice(form);
    }
    const info = getCommentCounterText(textarea);
    counter.textContent = info.text;
    counter.classList.toggle("is-warning", info.remaining > 0 && info.remaining <= 20);
    counter.classList.toggle("is-exceeded", info.remaining <= 0);
  });

  const info = getCommentCounterText(textarea);
  counter.textContent = info.text;
  counter.classList.toggle("is-warning", info.remaining > 0 && info.remaining <= 20);
  counter.classList.toggle("is-exceeded", info.remaining <= 0);
};

const updateCommentCharCounter = (textarea) => {
  if (!textarea) return;
  ensureCommentCharCounter(textarea);
  const counterId = (textarea.dataset.commentCounterId || "").trim();
  if (!counterId) return;

  const counter = document.getElementById(counterId);
  if (!counter) return;

  const info = getCommentCounterText(textarea);
  counter.textContent = info.text;
  counter.classList.toggle("is-warning", info.remaining > 0 && info.remaining <= 20);
  counter.classList.toggle("is-exceeded", info.remaining <= 0);
};

const initCommentCharCounters = (root) => {
  const scope = root && root.querySelectorAll ? root : document;
  const textareas = scope.querySelectorAll("#comments textarea[name='content']");
  textareas.forEach((textarea) => {
    ensureCommentCharCounter(textarea);
    ensureCommentComposerTools(textarea);
  });
};

const buildLikeForm = (comment) => {
  const id = comment && comment.id != null ? Number(comment.id) : 0;
  const liked = Boolean(comment && comment.liked);
  const likeCount = toSafeCount(comment && comment.likeCount);

  const form = document.createElement("form");
  form.method = "post";
  form.action = `/comments/${id}/like`;

  const button = document.createElement("button");
  button.type = "submit";
  button.className = `comment-action comment-action--like${liked ? " is-active" : ""}`;
  button.setAttribute("data-comment-like", "");
  button.setAttribute("data-liked", liked ? "1" : "0");

  const label = document.createElement("span");
  label.className = "comment-action__label";
  label.textContent = "Thích";

  button.innerHTML = icons.like;
  button.appendChild(label);
  syncCommentActionCount(button, "data-comment-like-count", likeCount);
  form.appendChild(button);
  return form;
};

const buildReportForm = (comment) => {
  const id = comment && comment.id != null ? Number(comment.id) : 0;
  const reported = Boolean(comment && comment.reported);
  const reportCount = toSafeCount(comment && comment.reportCount);

  const form = document.createElement("form");
  form.method = "post";
  form.action = `/comments/${id}/report`;

  const button = document.createElement("button");
  button.type = "submit";
  button.className = `comment-action comment-action--report${reported ? " is-muted" : ""}`;
  button.setAttribute("data-comment-report", "");
  button.setAttribute("data-reported", reported ? "1" : "0");
  button.disabled = reported;

  const label = document.createElement("span");
  label.className = "comment-action__label";
  label.textContent = "Báo cáo";

  button.innerHTML = icons.report;
  button.appendChild(label);
  syncCommentActionCount(button, "data-comment-report-count", reportCount);
  form.appendChild(button);
  return form;
};

const buildReplyButton = () => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "comment-action comment-action--reply";
  button.setAttribute("data-comment-reply", "");
  button.innerHTML = `${icons.reply}Trả lời`;
  return button;
};

const buildDeleteButton = () => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "comment-action comment-action--delete";
  button.setAttribute("data-comment-delete", "");
  button.hidden = true;
  button.innerHTML = `${icons.delete}Xóa`;
  return button;
};

const buildReplyForm = (action, parentId) => {
  const wrapper = document.createElement("div");
  wrapper.className = "comment-reply";

  const form = document.createElement("form");
  form.className = "comment-form comment-form--reply";
  form.method = "post";
  form.action = action;

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "parent_id";
  input.value = parentId;

  const textarea = document.createElement("textarea");
  textarea.className = "comment-textarea";
  textarea.name = "content";
  textarea.rows = 2;
  textarea.maxLength = COMMENT_TEXTAREA_LIMIT;
  textarea.placeholder = "Viết trả lời...";
  textarea.required = true;

  const submit = document.createElement("div");
  submit.className = "comment-submit";
  const button = document.createElement("button");
  button.className = "button";
  button.type = "submit";
  button.textContent = "Gửi trả lời";
  submit.appendChild(button);

  form.appendChild(input);
  form.appendChild(textarea);
  form.appendChild(submit);
  wrapper.appendChild(form);

  ensureCommentCharCounter(textarea);
  ensureCommentComposerTools(textarea);

  return wrapper;
};

const buildCommentItem = (comment, actionBase, isReply, options) => {
  const settings = options && typeof options === "object" ? options : {};
  const showChapterLabel = Boolean(settings.showChapterLabel);
  const mangaSlug = toSafeText(settings.mangaSlug);
  const mangaTitle = toSafeText(settings.mangaTitle);
  const authorUserId = (comment && comment.authorUserId ? String(comment.authorUserId) : "")
    .toString()
    .trim();
  const authorUsername = toSafeText(comment && comment.authorUsername ? comment.authorUsername : "").toLowerCase();
  const parentAuthorUserId = (comment && comment.parentAuthorUserId ? String(comment.parentAuthorUserId) : "")
    .toString()
    .trim();
  const authorNameText = toSafeText(comment && comment.author ? comment.author : "") || "Ẩn danh";

  const item = document.createElement("li");
  item.className = `comment-item${isReply ? " comment-item--reply" : ""}`;
  item.id = `comment-${comment.id}`;
  item.dataset.commentId = comment.id;
  item.dataset.commentAuthorId = authorUserId;
  item.dataset.commentParentAuthorId = parentAuthorUserId;

  const avatar = buildAvatar(comment.avatarUrl);
  const body = document.createElement("div");
  body.className = "comment-body";
  const bubble = document.createElement("div");
  bubble.className = "comment-bubble";

  const header = document.createElement("div");
  header.className = "comment-header";

  const author = document.createElement("span");
  author.className = "comment-author";
  if (authorUserId) {
    author.classList.add("comment-author--interactive");
    author.setAttribute("role", "link");
    author.setAttribute("tabindex", "0");
    author.setAttribute("data-comment-author-trigger", "");
    author.dataset.commentUserId = authorUserId;
    if (commentProfileUsernamePattern.test(authorUsername)) {
      author.dataset.commentUsername = authorUsername;
    }
    author.setAttribute("aria-label", `Xem thông tin người dùng ${authorNameText}`);
  }

  const authorName = document.createElement("span");
  authorName.className = "comment-author__name";
  authorName.textContent = authorNameText;
  author.appendChild(authorName);

  const userColor = comment && comment.userColor ? String(comment.userColor).trim() : "";
  if (userColor) {
    author.style.setProperty("--user-color", userColor);
  }

  const topBadgeItem = getFirstVisibleBadge(comment && comment.badges ? comment.badges : []);
  if (topBadgeItem) {
    const label = String(topBadgeItem.label).trim();
    const color = topBadgeItem.color ? String(topBadgeItem.color).trim() : "";
    const badge = document.createElement("span");
    badge.className = "comment-badge";
    if (color) {
      badge.style.setProperty("--badge-color", color);
      badge.style.setProperty("--badge-bg", `${color}22`);
    }
    badge.textContent = label;
    author.appendChild(badge);
  }

  header.appendChild(author);
  if (showChapterLabel) {
    const chapterNumberText = toSafeText(comment && comment.chapterNumberText ? comment.chapterNumberText : "");
    if (chapterNumberText) {
      const chapterTag = document.createElement(mangaSlug ? "a" : "span");
      chapterTag.className = "comment-chapter-tag";
      chapterTag.textContent = `Chương ${chapterNumberText}`;
      if (mangaSlug) {
        chapterTag.href = `/manga/${encodeURIComponent(mangaSlug)}/chapters/${encodeURIComponent(chapterNumberText)}`;
      }
      header.appendChild(chapterTag);
    }
  }
  const time = document.createElement("span");
  time.className = "comment-time";
  const timeText = toSafeText(comment && comment.timeAgo ? comment.timeAgo : "") || "Vừa xong";
  time.textContent = timeText;
  time.dataset.timeMobile = toCompactTimeAgo(timeText);

  const text = document.createElement("p");
  text.className = "comment-text";
  const mentionItems = comment && Array.isArray(comment.mentions) ? comment.mentions : [];
  renderCommentTextWithStickers(text, comment.content, mentionItems, {
    mangaSlug,
    mangaTitle
  });

  const actions = document.createElement("div");
  actions.className = "comment-actions";

  actions.appendChild(buildLikeForm(comment));

  if (!isReply) {
    actions.appendChild(buildReplyButton());
  }

  actions.appendChild(buildReportForm(comment));

  actions.appendChild(buildDeleteButton());

  const meta = document.createElement("div");
  meta.className = "comment-meta";
  meta.appendChild(time);
  meta.appendChild(actions);

  bubble.appendChild(header);
  bubble.appendChild(text);
  body.appendChild(bubble);
  body.appendChild(meta);

  if (!isReply) {
    body.appendChild(buildReplyForm(actionBase, comment.id));
  }

  item.appendChild(avatar);
  item.appendChild(body);
  return item;
};

const updateCommentCount = (section, nextCount) => {
  const header = section.querySelector(commentSelectors.header);
  if (!header) return;
  const match = header.textContent.match(/\((\d+)\)/);
  const current = match ? Number(match[1]) : 0;
  const count = Number.isFinite(nextCount) ? nextCount : current + 1;
  if (match) {
    header.textContent = header.textContent.replace(/\(\d+\)/, `(${count})`);
  } else {
    header.textContent = `${header.textContent} (${count})`;
  }
};

const readCommentCount = (section) => {
  if (!section) return NaN;
  const header = section.querySelector(commentSelectors.header);
  if (!header) return NaN;
  const match = (header.textContent || "").match(/\((\d+)\)/);
  if (!match) return NaN;
  const count = Number(match[1]);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : NaN;
};

const isCommentEmptyNote = (note) => {
  if (!(note instanceof HTMLElement)) return false;
  if (!note.classList.contains("note")) return false;
  if (note.hasAttribute(COMMENT_EMPTY_NOTE_ATTR)) return true;

  const text = (note.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  return text === "chưa có bình luận nào." || text === "chua co binh luan nao.";
};

const clearCommentEmptyNotes = (section) => {
  if (!section) return;
  section.querySelectorAll(".note").forEach((note) => {
    if (!isCommentEmptyNote(note)) return;
    note.remove();
  });
};

const ensureCommentList = (section) => {
  let list = section.querySelector(commentSelectors.list);
  clearCommentEmptyNotes(section);
  if (list) return list;
  list = document.createElement("ul");
  list.className = "comment-items";
  section.appendChild(list);
  return list;
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

const getUserIdFromSession = (session) => {
  const user = session && session.user ? session.user : null;
  return user && user.id ? String(user.id).trim() : "";
};

let currentUserId = "";
let currentCanDeleteAny = false;
let currentCanComment = true;
let currentSignedIn = false;

const readCanDeleteAnyFromProfile = (profile) => {
  const perms = profile && typeof profile === "object" ? profile.permissions : null;
  return Boolean(perms && typeof perms === "object" && perms.canDeleteAnyComment);
};

const readCanCommentFromProfile = (profile) => {
  const perms = profile && typeof profile === "object" ? profile.permissions : null;
  if (!perms || typeof perms !== "object") return true;
  return perms.canComment !== false;
};

const COMMENT_PERMISSION_NOTE_ATTR = "data-comment-permission-note";

const clearCommentPermissionNote = () => {
  document.querySelectorAll(`#comments [${COMMENT_PERMISSION_NOTE_ATTR}]`).forEach((note) => {
    note.remove();
  });
};

const showCommentPermissionNote = () => {
  const section = document.querySelector(commentSelectors.section);
  if (!section) return;
  clearCommentPermissionNote();

  const note = document.createElement("p");
  note.className = "note comment-disabled-note";
  note.setAttribute(COMMENT_PERMISSION_NOTE_ATTR, "1");
  note.textContent = "Tài khoản của bạn hiện không có quyền tương tác.";

  const header = section.querySelector(".section-header");
  if (header && header.parentNode === section) {
    header.insertAdjacentElement("afterend", note);
  } else {
    section.prepend(note);
  }
};

const setCommentActionVisibility = (section, selector, blocked, restoreDisabled) => {
  if (!section) return;
  section.querySelectorAll(selector).forEach((button) => {
    const form = button && button.closest ? button.closest("form") : null;
    if (form) {
      form.hidden = blocked;
    } else if (button) {
      button.hidden = blocked;
    }

    if (button instanceof HTMLButtonElement) {
      if (blocked) {
        button.disabled = true;
        return;
      }

      if (typeof restoreDisabled === "function") {
        button.disabled = Boolean(restoreDisabled(button));
      } else {
        button.disabled = false;
      }
    }
  });
};

const applyCommentPermissionVisibility = ({ signedIn, canComment }) => {
  const section = document.querySelector(commentSelectors.section);
  if (!section) return;

  const blocked = Boolean(signedIn && canComment === false);
  const composer = section.querySelector(".comment-box");
  if (composer) {
    composer.hidden = blocked;
  }

  setCommentActionVisibility(section, "[data-comment-like]", blocked, () => false);
  setCommentActionVisibility(
    section,
    "[data-comment-report]",
    blocked,
    (button) => button.getAttribute("data-reported") === "1"
  );

  section.querySelectorAll("[data-comment-reply]").forEach((button) => {
    button.hidden = blocked;
  });

  section.querySelectorAll(".comment-reply").forEach((replyWrap) => {
    if (blocked) {
      replyWrap.classList.remove("is-open");
      replyWrap.hidden = true;
      return;
    }
    replyWrap.hidden = false;
  });

  if (blocked) {
    hideAllCommentMentionPanels();
    showCommentPermissionNote();
    return;
  }

  clearCommentPermissionNote();
};

const refreshCommentPermissionVisibility = async (session, profile) => {
  let nextSession = session;
  if (!nextSession) {
    nextSession = await getSessionSafe();
  }

  currentSignedIn = Boolean(nextSession && nextSession.user);

  let nextProfile = profile;
  if (!nextProfile && window.BfangAuth && typeof window.BfangAuth.getMeProfile === "function") {
    nextProfile = window.BfangAuth.getMeProfile();
  }

  currentCanComment = currentSignedIn ? readCanCommentFromProfile(nextProfile) : true;
  applyCommentPermissionVisibility({ signedIn: currentSignedIn, canComment: currentCanComment });
};

const applyDeleteVisibility = (userId, canDeleteAny) => {
  const id = (userId || "").toString().trim();
  const allowAny = Boolean(canDeleteAny);
  document.querySelectorAll("[data-comment-delete]").forEach((button) => {
    const item = button.closest(".comment-item");
    const authorId = item && item.dataset ? String(item.dataset.commentAuthorId || "").trim() : "";
    const parentAuthorId =
      item && item.dataset ? String(item.dataset.commentParentAuthorId || "").trim() : "";
    const canDeleteOwn = Boolean(id && authorId && id === authorId);
    const canDeleteReplyToOwn = Boolean(id && parentAuthorId && id === parentAuthorId);
    button.hidden = !(allowAny || canDeleteOwn || canDeleteReplyToOwn);
  });
};

const refreshDeleteVisibility = async (session) => {
  let nextSession = session;
  if (!nextSession) {
    nextSession = await getSessionSafe();
  }
  currentUserId = getUserIdFromSession(nextSession);
  currentSignedIn = Boolean(nextSession && nextSession.user);

  let profile = null;
  if (window.BfangAuth && typeof window.BfangAuth.getMeProfile === "function") {
    profile = window.BfangAuth.getMeProfile();
  }
  currentCanDeleteAny = readCanDeleteAnyFromProfile(profile);

  applyDeleteVisibility(currentUserId, currentCanDeleteAny);
};

const collectVisibleCommentIds = () => {
  return Array.from(document.querySelectorAll(".comment-item[data-comment-id]"))
    .map((item) => Number(item.dataset.commentId))
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => Math.floor(id));
};

const applyReactionStates = ({ likedIds, reportedIds }) => {
  const likedSet = new Set(
    (Array.isArray(likedIds) ? likedIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .map((id) => Math.floor(id))
  );
  const reportedSet = new Set(
    (Array.isArray(reportedIds) ? reportedIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .map((id) => Math.floor(id))
  );

  document.querySelectorAll("[data-comment-like]").forEach((button) => {
    const item = button.closest(".comment-item");
    const id = item ? Number(item.dataset.commentId) : NaN;
    if (!Number.isFinite(id) || id <= 0) return;
    const countEl = button.querySelector("[data-comment-like-count]");
    const count = countEl ? toSafeCount(countEl.textContent) : 0;
    setLikeButtonState(button, likedSet.has(Math.floor(id)), count);
  });

  document.querySelectorAll("[data-comment-report]").forEach((button) => {
    const item = button.closest(".comment-item");
    const id = item ? Number(item.dataset.commentId) : NaN;
    if (!Number.isFinite(id) || id <= 0) return;
    const countEl = button.querySelector("[data-comment-report-count]");
    const count = countEl ? toSafeCount(countEl.textContent) : 0;
    setReportButtonState(button, reportedSet.has(Math.floor(id)), count);
  });
};

const refreshReactionStates = async (session) => {
  let nextSession = session;
  if (!nextSession) {
    nextSession = await getSessionSafe();
  }

  const userId = getUserIdFromSession(nextSession);
  if (!userId) return;
  if (currentSignedIn && !currentCanComment) return;

  const ids = Array.from(new Set(collectVisibleCommentIds())).slice(0, 320);
  if (!ids.length) return;

  let accessToken = "";
  if (nextSession && nextSession.access_token) {
    accessToken = String(nextSession.access_token).trim();
  }
  if (!accessToken) {
    try {
      if (window.BfangAuth && typeof window.BfangAuth.getAccessToken === "function") {
        accessToken = await window.BfangAuth.getAccessToken();
      }
    } catch (_err) {
      accessToken = "";
    }
  }
  if (!accessToken) return;

  const response = await fetch("/comments/reactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ ids })
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.ok !== true) {
    return;
  }

  applyReactionStates({
    likedIds: result.likedIds,
    reportedIds: result.reportedIds
  });
};

const ensureNoCommentsNote = (section) => {
  if (!section) return;
  const list = section.querySelector(commentSelectors.list);
  const hasAny = Boolean(list && list.querySelector(".comment-item"));
  if (hasAny) {
    clearCommentEmptyNotes(section);
    return;
  }
  if (list) list.remove();
  clearCommentEmptyNotes(section);

  const note = document.createElement("p");
  note.className = "note";
  note.setAttribute(COMMENT_EMPTY_NOTE_ATTR, "1");
  note.textContent = "Chưa có bình luận nào.";

  const composer = section.querySelector(".comment-box");
  if (composer && composer.parentNode === section) {
    composer.insertAdjacentElement("afterend", note);
  } else {
    section.appendChild(note);
  }
};

let isCommentPaginationLoading = false;

const isPrimaryUnmodifiedClick = (event) => {
  if (!event || event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  return true;
};

const COMMENT_TARGET_ACTIVE_CLASS = "is-targeted";
const COMMENT_TARGET_NOTE_ATTR = "data-comment-target-note";
const COMMENT_TARGET_NOTE_TIMEOUT_MS = 3200;
const COMMENT_TARGET_HIGHLIGHT_TIMEOUT_MS = 2400;
let commentTargetNoteTimer = null;
let commentTargetHighlightTimer = null;

const extractCommentIdFromHash = (hashValue) => {
  const hash = hashValue == null ? "" : String(hashValue).trim();
  const match = hash.match(/^#comment-(\d+)$/i);
  if (!match) return 0;
  const id = Number(match[1]);
  if (!Number.isFinite(id) || id <= 0) return 0;
  return Math.floor(id);
};

const clearCommentTargetNote = () => {
  if (commentTargetNoteTimer) {
    clearTimeout(commentTargetNoteTimer);
    commentTargetNoteTimer = null;
  }
  document.querySelectorAll(`#comments [${COMMENT_TARGET_NOTE_ATTR}]`).forEach((note) => {
    note.remove();
  });
};

const showCommentTargetNote = () => {
  const section = document.querySelector(commentSelectors.section);
  if (!section) return;
  clearCommentTargetNote();

  const note = document.createElement("p");
  note.className = "note comment-target-note";
  note.setAttribute(COMMENT_TARGET_NOTE_ATTR, "1");
  note.textContent = "Không tìm thấy bình luận này. Có thể bình luận đã bị xóa hoặc thay đổi.";

  const header = section.querySelector(".section-header");
  if (header && header.parentNode === section) {
    header.insertAdjacentElement("afterend", note);
  } else {
    section.prepend(note);
  }

  commentTargetNoteTimer = setTimeout(() => {
    note.remove();
    commentTargetNoteTimer = null;
  }, COMMENT_TARGET_NOTE_TIMEOUT_MS);
};

const clearCommentTargetHighlight = () => {
  if (commentTargetHighlightTimer) {
    clearTimeout(commentTargetHighlightTimer);
    commentTargetHighlightTimer = null;
  }
  document.querySelectorAll(`#comments .comment-item.${COMMENT_TARGET_ACTIVE_CLASS}`).forEach((item) => {
    item.classList.remove(COMMENT_TARGET_ACTIVE_CLASS);
  });
};

const revealCommentTargetFromHash = (options) => {
  const settings = options && typeof options === "object" ? options : {};
  const hashValue = settings.hash != null ? String(settings.hash) : window.location.hash;
  const commentId = extractCommentIdFromHash(hashValue);
  if (!commentId) {
    clearCommentTargetNote();
    clearCommentTargetHighlight();
    return false;
  }

  const section = document.querySelector(commentSelectors.section);
  if (!section) return false;

  const target = section.querySelector(`#comment-${commentId}`);
  if (!target) {
    clearCommentTargetHighlight();
    if (settings.showFallback !== false) {
      showCommentTargetNote();
      section.scrollIntoView({ block: "start", behavior: settings.behavior || "smooth" });
    }
    return false;
  }

  clearCommentTargetNote();
  clearCommentTargetHighlight();
  target.classList.add(COMMENT_TARGET_ACTIVE_CLASS);
  target.scrollIntoView({ block: "center", behavior: settings.behavior || "smooth" });

  commentTargetHighlightTimer = setTimeout(() => {
    target.classList.remove(COMMENT_TARGET_ACTIVE_CLASS);
    commentTargetHighlightTimer = null;
  }, COMMENT_TARGET_HIGHLIGHT_TIMEOUT_MS);

  return true;
};

const buildCommentHistoryPath = (targetUrl) => {
  if (!targetUrl) return "";
  const hash = targetUrl.hash ? targetUrl.hash : "#comments";
  return `${targetUrl.pathname}${targetUrl.search}${hash}`;
};

const buildFreshCommentFetchUrl = (targetUrl) => {
  if (!targetUrl) return null;
  let requestUrl = null;
  try {
    requestUrl = new URL(targetUrl.toString());
  } catch (_err) {
    requestUrl = null;
  }
  if (!requestUrl) return null;

  requestUrl.searchParams.set(
    COMMENT_FRESH_BYPASS_QUERY_PARAM,
    `${Date.now()}-${Math.floor(Math.random() * 100000)}`
  );
  return requestUrl;
};

const replaceCommentsSectionFromPage = async (targetUrl, options) => {
  const settings = options && typeof options === "object" ? options : {};
  const shouldPushHistory = settings.pushHistory !== false;

  const currentSection = document.querySelector(commentSelectors.section);
  if (!currentSection) return false;
  if (isCommentPaginationLoading) return false;

  isCommentPaginationLoading = true;
  currentSection.setAttribute("aria-busy", "true");

  try {
    const requestUrl = buildFreshCommentFetchUrl(targetUrl) || targetUrl;
    const response = await fetch(requestUrl.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "text/html",
        "X-BFANG-Comments-Fresh": "1",
        "Cache-Control": "no-cache, no-store",
        Pragma: "no-cache"
      },
      credentials: "same-origin"
    });

    if (!response.ok) {
      return false;
    }

    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const nextSection = parsed.querySelector(commentSelectors.section);
    if (!nextSection) {
      return false;
    }

    hideAllCommentMentionPanels();
    currentSection.replaceWith(nextSection);
    initCommentRichText(nextSection);
    initCommentCharCounters(nextSection);

    if (window.BfangAuth && typeof window.BfangAuth.refreshUi === "function") {
      window.BfangAuth.refreshUi().catch(() => null);
    }

    refreshDeleteVisibility().catch(() => null);
    refreshCommentPermissionVisibility().catch(() => null);
    refreshReactionStates().catch(() => null);
    revealCommentTargetFromHash({ hash: targetUrl.hash, behavior: "auto", showFallback: false });

    if (shouldPushHistory) {
      const nextPath = buildCommentHistoryPath(targetUrl);
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextPath && nextPath !== currentPath) {
        window.history.pushState({ commentsPageAsync: true }, "", nextPath);
      }
    }

    return true;
  } catch (_err) {
    return false;
  } finally {
    isCommentPaginationLoading = false;
    const activeSection = document.querySelector(commentSelectors.section);
    if (activeSection) {
      activeSection.removeAttribute("aria-busy");
    }
  }
};

let isLazyCommentHydrationLoading = false;

const resolveLazyCommentHydrationUrl = (section) => {
  if (!section) return null;

  const rawUrl = (section.getAttribute("data-comment-load-url") || "").toString().trim();
  if (!rawUrl) return null;

  try {
    const targetUrl = new URL(rawUrl, window.location.href);
    if (targetUrl.origin !== window.location.origin) return null;
    return targetUrl;
  } catch (_err) {
    return null;
  }
};

const hydrateLazyCommentsSection = async (options) => {
  const settings = options && typeof options === "object" ? options : {};
  const force = Boolean(settings.force);
  const section = document.querySelector(`${commentSelectors.section}[data-comment-lazy='1']`);
  if (!section) return true;
  if (isLazyCommentHydrationLoading && !force) return false;

  const targetUrl = resolveLazyCommentHydrationUrl(section);
  if (!targetUrl) return false;

  isLazyCommentHydrationLoading = true;
  section.setAttribute("aria-busy", "true");
  section.setAttribute("data-comment-load-state", "loading");

  const triggerButton = section.querySelector("[data-comment-load-trigger]");
  if (triggerButton) {
    triggerButton.disabled = true;
  }

  try {
    const hydrated = await replaceCommentsSectionFromPage(targetUrl, { pushHistory: false });
    if (!hydrated) {
      section.setAttribute("data-comment-load-state", "error");
      return false;
    }
    return true;
  } catch (_err) {
    section.setAttribute("data-comment-load-state", "error");
    return false;
  } finally {
    isLazyCommentHydrationLoading = false;
    const activeSection = document.querySelector(`${commentSelectors.section}[data-comment-lazy='1']`);
    if (activeSection) {
      activeSection.removeAttribute("aria-busy");
      if (activeSection.getAttribute("data-comment-load-state") === "loading") {
        activeSection.removeAttribute("data-comment-load-state");
      }
      const activeTrigger = activeSection.querySelector("[data-comment-load-trigger]");
      if (activeTrigger) {
        activeTrigger.disabled = false;
      }
    }
  }
};

const extractCommentAction = (form) => {
  if (!form || !(form instanceof HTMLFormElement)) return null;
  const actionUrl = (form.getAttribute("action") || form.action || "").toString().trim();
  const match = actionUrl.match(/\/comments\/(\d+)\/(like|report)(?:$|\?|\/)/i);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isFinite(id) || id <= 0) return null;
  const type = String(match[2] || "").toLowerCase();
  if (type !== "like" && type !== "report") return null;
  return { id: Math.floor(id), type, actionUrl };
};

const setLikeButtonState = (button, liked, likeCount) => {
  if (!button) return;
  const active = Boolean(liked);
  button.classList.toggle("is-active", active);
  button.setAttribute("data-liked", active ? "1" : "0");
  syncCommentActionCount(button, "data-comment-like-count", likeCount);
};

const setReportButtonState = (button, reported, reportCount) => {
  if (!button) return;
  const flagged = Boolean(reported);
  button.classList.toggle("is-muted", flagged);
  button.setAttribute("data-reported", flagged ? "1" : "0");
  syncCommentActionCount(button, "data-comment-report-count", reportCount);
  button.disabled = flagged;
};

const getAccessTokenForCommentAction = async (message) => {
  let accessToken = "";
  try {
    if (window.BfangAuth && typeof window.BfangAuth.getAccessToken === "function") {
      accessToken = await window.BfangAuth.getAccessToken();
    }
  } catch (_err) {
    accessToken = "";
  }

  if (accessToken) return accessToken;

  const text = (message || "Vui lòng đăng nhập bằng Google hoặc Discord để tiếp tục.").toString();

  const startSignIn = async () => {
    if (!window.BfangAuth) return false;
    if (typeof window.BfangAuth.signIn === "function") {
      await window.BfangAuth.signIn();
      return true;
    }
    if (typeof window.BfangAuth.signInWithGoogle === "function") {
      await window.BfangAuth.signInWithGoogle();
      return true;
    }
    return false;
  };

  try {
    if (await startSignIn()) {
      return "";
    }
  } catch (_err) {
    // ignore
  }
  window.alert(text);
  return "";
};

const handleReactionSubmit = async (form, reactionType) => {
  const action = extractCommentAction(form);
  if (!action || action.type !== reactionType) return;

  if (currentSignedIn && !currentCanComment) {
    applyCommentPermissionVisibility({ signedIn: true, canComment: false });
    window.alert("Tài khoản của bạn hiện không có quyền tương tác.");
    return;
  }

  const button = form.querySelector("button[type='submit']");
  if (!button) return;

  if (reactionType === "report") {
    const item = button.closest(".comment-item");
    const contentEl = item ? item.querySelector(".comment-text") : null;
    const rawPreview = contentEl
      ? String(contentEl.dataset.commentRaw || contentEl.textContent || "").trim()
      : "";
    const preview = rawPreview.length > 80 ? `${rawPreview.slice(0, 77)}...` : rawPreview;

    const confirmPayload = {
      title: "Báo cáo bình luận?",
      body: "Báo cáo sẽ được gửi cho quản trị viên để kiểm tra nội dung này.",
      confirmText: "Báo cáo",
      confirmVariant: "danger",
      metaItems: preview ? [preview] : [],
      fallbackText: "Bạn có chắc muốn báo cáo bình luận này?"
    };

    let ok = false;
    if (window.BfangConfirm && typeof window.BfangConfirm.confirm === "function") {
      ok = await window.BfangConfirm.confirm(confirmPayload);
    } else {
      ok = window.confirm(confirmPayload.fallbackText);
    }
    if (!ok) return;
  }

  const actionLabel = reactionType === "like" ? "thích" : "báo cáo";
  const accessToken = await getAccessTokenForCommentAction(
    `Vui lòng đăng nhập bằng Google hoặc Discord để ${actionLabel} bình luận.`
  );
  if (!accessToken) return;

  button.disabled = true;
  let response = null;
  let result = null;
  try {
    response = await fetch(action.actionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({})
    });
    result = await response.json().catch(() => null);
  } finally {
    button.disabled = false;
  }

  if (!response || !response.ok || !result || result.ok !== true) {
    const message =
      result && result.error
        ? String(result.error)
        : `Không thể ${actionLabel} bình luận. Vui lòng thử lại.`;
    if (response && response.status === 401) {
      try {
        if (window.BfangAuth && typeof window.BfangAuth.signIn === "function") {
          await window.BfangAuth.signIn();
          return;
        }
        if (window.BfangAuth && typeof window.BfangAuth.signInWithGoogle === "function") {
          await window.BfangAuth.signInWithGoogle();
          return;
        }
      } catch (_err) {
        // ignore
      }
    }
    if (response && response.status === 403) {
      currentSignedIn = true;
      currentCanComment = false;
      applyCommentPermissionVisibility({ signedIn: true, canComment: false });
    }
    window.alert(message);
    return;
  }

  if (reactionType === "like") {
    setLikeButtonState(button, result.liked, result.likeCount);
    return;
  }

  setReportButtonState(button, result.reported, result.reportCount);
};

const handleCommentSubmit = async (form) => {
  hideCommentFormNotice(form);

  if (currentSignedIn && !currentCanComment) {
    applyCommentPermissionVisibility({ signedIn: true, canComment: false });
    showCommentFormNotice(form, "Tài khoản của bạn hiện không có quyền tương tác.", {
      tone: "error"
    });
    return;
  }

  const textarea = form.querySelector("textarea[name='content']");
  if (!textarea) return;
  const content = textarea.value.trim();
  if (!content) {
    textarea.focus();
    return;
  }

  const limit = getCommentTextareaLimit(textarea);
  if (content.length > limit) {
    showCommentFormNotice(form, `Bình luận tối đa ${limit} ký tự.`, {
      tone: "error"
    });
    textarea.focus();
    return;
  }

  const parentInput = form.querySelector("input[name='parent_id']");
  const parentId = parentInput ? parentInput.value : null;
  const requestId = generateCommentRequestId();
  const payload = { content };
  payload.requestId = requestId;
  if (parentId) {
    payload.parent_id = parentId;
  }

  let accessToken = "";
  try {
    if (window.BfangAuth && typeof window.BfangAuth.getAccessToken === "function") {
      accessToken = await window.BfangAuth.getAccessToken();
    }
  } catch (_err) {
    accessToken = "";
  }

  if (!accessToken) {
    const message = "Vui lòng đăng nhập bằng Google hoặc Discord để bình luận.";
    try {
      if (window.BfangAuth && typeof window.BfangAuth.signIn === "function") {
        await window.BfangAuth.signIn();
        return;
      }
      if (window.BfangAuth && typeof window.BfangAuth.signInWithGoogle === "function") {
        await window.BfangAuth.signInWithGoogle();
        return;
      }
    } catch (_err) {
      // ignore
    }
    showCommentFormNotice(form, message, {
      tone: "error"
    });
    return;
  }

  const sendCommentRequest = async (turnstileToken) => {
    const requestPayload = { ...payload };
    const token = toSafeText(turnstileToken);
    if (token) {
      requestPayload.turnstileToken = token;
    }

    return fetch(form.action, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": requestId,
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(requestPayload)
    });
  };

  let response = await sendCommentRequest("");
  let result = await response.json().catch(() => null);

  const firstErrorCode =
    result && result.code != null ? String(result.code).trim().toUpperCase() : "";
  if (response.status === 403 && firstErrorCode === "TURNSTILE_REQUIRED") {
    const challengeSiteKey = result && result.turnstileSiteKey ? String(result.turnstileSiteKey) : "";
    let turnstileToken = "";
    try {
      turnstileToken = await requestCommentTurnstileToken(form, challengeSiteKey);
    } catch (_err) {
      turnstileToken = "";
    }

    if (!turnstileToken) {
      showCommentFormNotice(
        form,
        (result && result.error) || "Cần xác minh bảo mật trước khi gửi bình luận.",
        {
          tone: "error",
          autoHideMs: 8000
        }
      );
      return;
    }

    response = await sendCommentRequest(turnstileToken);
    result = await response.json().catch(() => null);
  }

  if (!response.ok) {
    const errorCode = result && result.code != null ? String(result.code).trim().toUpperCase() : "";
    let message =
      result && result.error ? String(result.error) : "Gửi bình luận thất bại. Vui lòng thử lại.";

    if (response.status === 403 && errorCode !== "TURNSTILE_REQUIRED") {
      currentSignedIn = true;
      currentCanComment = false;
      applyCommentPermissionVisibility({ signedIn: true, canComment: false });
    }

    if (response.status === 401) {
      try {
        if (window.BfangAuth && typeof window.BfangAuth.signIn === "function") {
          await window.BfangAuth.signIn();
          return;
        }
        if (window.BfangAuth && typeof window.BfangAuth.signInWithGoogle === "function") {
          await window.BfangAuth.signInWithGoogle();
          return;
        }
      } catch (_err) {
        // ignore
      }
    }

    let autoHideMs = COMMENT_FORM_NOTICE_AUTO_HIDE_MS;
    if (response.status === 429) {
      const retryAfterSeconds = readCommentRetryAfterSeconds(response, result);
      if (!message || message === "Gửi bình luận thất bại. Vui lòng thử lại.") {
        message = retryAfterSeconds
          ? `Bạn thao tác quá nhanh, vui lòng chờ ${retryAfterSeconds} giây rồi thử lại.`
          : "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít giây.";
      }
      if (retryAfterSeconds > 0) {
        autoHideMs = Math.max(autoHideMs, (retryAfterSeconds + 1) * 1000);
      }
    }

    if (errorCode !== "TURNSTILE_REQUIRED") {
      hideCommentTurnstile(form);
    }

    showCommentFormNotice(form, message, {
      tone: "error",
      autoHideMs
    });
    textarea.focus();
    return;
  }
  if (!result || !result.comment) return;

  hideCommentTurnstile(form);
  hideCommentFormNotice(form);

  const section = form.closest(commentSelectors.section);
  if (!section) return;

  const actionBase = form.action;
  const isReply = Boolean(result.comment.parentId);
  const mangaSlug = (section.getAttribute("data-comment-manga-slug") || "").toString().trim();
  const mangaTitle = (section.getAttribute("data-comment-manga-title") || "").toString().trim();
  const showChapterLabel =
    (section.getAttribute("data-comment-scope") || "").toString().trim().toLowerCase() === "manga";
  const newItem = buildCommentItem(result.comment, actionBase, isReply, {
    showChapterLabel,
    mangaSlug,
    mangaTitle
  });

  if (isReply) {
    const parentItem = section.querySelector(
      `.comment-item[data-comment-id='${result.comment.parentId}']`
    );
    if (parentItem) {
      if (!newItem.dataset.commentParentAuthorId) {
        newItem.dataset.commentParentAuthorId = String(parentItem.dataset.commentAuthorId || "").trim();
      }
      let replyList = parentItem.querySelector(".comment-replies");
      if (!replyList) {
        replyList = document.createElement("ul");
        replyList.className = "comment-replies";
        const parentBody = parentItem.querySelector(".comment-body");
        if (parentBody) {
          parentBody.appendChild(replyList);
        }
      }
      replyList.prepend(newItem);
    }
    const replyWrap = form.closest(".comment-reply");
    if (replyWrap) {
      replyWrap.classList.remove("is-open");
    }
  } else {
    const list = ensureCommentList(section);
    list.prepend(newItem);
  }

  clearCommentEmptyNotes(section);

  hydrateCommentInlineLinks(newItem).catch(() => null);

  textarea.value = "";
  updateCommentCharCounter(textarea);
  hideAllCommentMentionPanels();
  const nextCount = result && result.commentCount != null ? Number(result.commentCount) : NaN;
  updateCommentCount(section, Number.isFinite(nextCount) ? nextCount : undefined);
  refreshDeleteVisibility().catch(() => null);
  refreshReactionStates().catch(() => null);
  notifyCommentDataUpdated(section);
};

const notifyCommentDataUpdated = (section) => {
  const urls = new Set();

  const currentUrl = new URL(window.location.href);
  currentUrl.hash = "";
  currentUrl.searchParams.delete(COMMENT_FRESH_BYPASS_QUERY_PARAM);
  urls.add(currentUrl.toString());

  const sectionNode = section && section.getAttribute ? section : document.querySelector(commentSelectors.section);
  if (sectionNode) {
    const loadUrlRaw = (sectionNode.getAttribute("data-comment-load-url") || "").toString().trim();
    if (loadUrlRaw) {
      try {
        const loadUrl = new URL(loadUrlRaw, window.location.href);
        loadUrl.hash = "";
        loadUrl.searchParams.delete(COMMENT_FRESH_BYPASS_QUERY_PARAM);
        urls.add(loadUrl.toString());
      } catch (_err) {
        // Ignore malformed preload URLs.
      }
    }
  }

  const affectedUrls = Array.from(urls);
  if (!affectedUrls.length) return;

  window.dispatchEvent(
    new CustomEvent("bfang:data-updated", {
      detail: {
        type: "comments",
        urls: affectedUrls
      }
    })
  );

  if ("serviceWorker" in navigator && navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: "INVALIDATE_PAGE_CACHE",
      urls: affectedUrls
    });
  }
};

document.addEventListener("click", (event) => {
  if (!isPrimaryUnmodifiedClick(event)) return;

  const loadCommentsButton = event.target.closest("[data-comment-load-trigger]");
  if (loadCommentsButton) {
    event.preventDefault();
    hydrateLazyCommentsSection({ force: true }).catch(() => null);
    return;
  }

  const pageLink = event.target.closest("#comments .comment-pagination a[href]");
  if (pageLink) {
    const hrefRaw = (pageLink.getAttribute("href") || "").toString().trim();
    const isDisabled =
      pageLink.classList.contains("is-disabled") || pageLink.getAttribute("aria-disabled") === "true";

    if (!hrefRaw || hrefRaw === "#" || isDisabled) {
      event.preventDefault();
      return;
    }

    let nextUrl = null;
    try {
      nextUrl = new URL(hrefRaw, window.location.href);
    } catch (_err) {
      nextUrl = null;
    }

    if (!nextUrl || nextUrl.origin !== window.location.origin) {
      return;
    }

    event.preventDefault();
    replaceCommentsSectionFromPage(nextUrl, { pushHistory: true }).then((ok) => {
      if (!ok) {
        window.location.href = nextUrl.toString();
      }
    });
    return;
  }

  const authorTrigger = event.target.closest("[data-comment-author-trigger]");
  if (authorTrigger) {
    event.preventDefault();
    openCommentUserDialog(authorTrigger).catch(() => {
      window.alert("Không thể mở trang thành viên.");
    });
    return;
  }

  const target = event.target;
  const isInsidePicker = Boolean(target && target.closest && target.closest(".comment-picker"));
  if (!isInsidePicker) {
    document.querySelectorAll(".comment-picker[open]").forEach((picker) => {
      picker.open = false;
    });
  }

  const isInsideMentionPanel = Boolean(
    target && target.closest && target.closest("[data-comment-mention-panel]")
  );
  const isInsideCommentTextarea = Boolean(
    target && target.closest && target.closest("#comments textarea[name='content']")
  );
  if (!isInsideMentionPanel && !isInsideCommentTextarea) {
    hideAllCommentMentionPanels();
  }
});

window.addEventListener("popstate", () => {
  const section = document.querySelector(commentSelectors.section);
  if (!section) return;

  const url = new URL(window.location.href);
  replaceCommentsSectionFromPage(url, { pushHistory: false })
    .then((ok) => {
      if (!ok) {
        revealCommentTargetFromHash({ behavior: "auto", showFallback: true });
      }
    })
    .catch(() => null);
});

window.addEventListener("hashchange", () => {
  revealCommentTargetFromHash({ behavior: "smooth", showFallback: true });
});

document.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-comment-delete]");
  if (!deleteButton) return;

  const item = deleteButton.closest(".comment-item");
  if (!item) return;

  const id = Number(item.dataset.commentId);
  if (!Number.isFinite(id) || id <= 0) return;

  const section = item.closest(commentSelectors.section);
  const hasReplies = Boolean(item.querySelector(".comment-replies .comment-item"));
  const contentEl = item.querySelector(".comment-text");
  const rawPreview = contentEl
    ? String(contentEl.dataset.commentRaw || contentEl.textContent || "").trim()
    : "";
  const preview = rawPreview.length > 80 ? `${rawPreview.slice(0, 77)}...` : rawPreview;

  const confirmPayload = {
    title: "Xóa bình luận?",
    body: hasReplies
      ? "Bình luận và tất cả trả lời (nếu có) sẽ bị xóa."
      : "Bình luận sẽ bị xóa.",
    confirmText: "Xóa",
    confirmVariant: "danger",
    metaItems: preview ? [preview] : [],
    fallbackText: "Bạn có chắc muốn xóa bình luận?"
  };

  let ok = false;
  if (window.BfangConfirm && typeof window.BfangConfirm.confirm === "function") {
    ok = await window.BfangConfirm.confirm(confirmPayload);
  } else {
    ok = window.confirm(confirmPayload.fallbackText);
  }
  if (!ok) return;

  let accessToken = "";
  try {
    if (window.BfangAuth && typeof window.BfangAuth.getAccessToken === "function") {
      accessToken = await window.BfangAuth.getAccessToken();
    }
  } catch (_err) {
    accessToken = "";
  }

  if (!accessToken) {
    const message = "Vui lòng đăng nhập bằng Google hoặc Discord để xóa bình luận.";
    try {
      if (window.BfangAuth && typeof window.BfangAuth.signIn === "function") {
        await window.BfangAuth.signIn();
        return;
      }
      if (window.BfangAuth && typeof window.BfangAuth.signInWithGoogle === "function") {
        await window.BfangAuth.signInWithGoogle();
        return;
      }
    } catch (_err) {
      // ignore
    }
    window.alert(message);
    return;
  }

  deleteButton.disabled = true;
  const response = await fetch(`/comments/${id}/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({})
  });

  const result = await response.json().catch(() => null);
  deleteButton.disabled = false;

  if (!response.ok) {
    const message =
      result && result.error ? String(result.error) : "Không thể xóa bình luận. Vui lòng thử lại.";
    if (response.status === 401) {
      try {
        if (window.BfangAuth && typeof window.BfangAuth.signIn === "function") {
          await window.BfangAuth.signIn();
          return;
        }
        if (window.BfangAuth && typeof window.BfangAuth.signInWithGoogle === "function") {
          await window.BfangAuth.signInWithGoogle();
          return;
        }
      } catch (_err) {
        // ignore
      }
    }
    window.alert(message);
    return;
  }

  const parentReplies = item.closest(".comment-replies");
  item.remove();
  if (parentReplies && !parentReplies.querySelector(".comment-item")) {
    parentReplies.remove();
  }

  if (section) {
    const deletedCountRaw = result && result.deleted != null ? Number(result.deleted) : NaN;
    const deletedCount =
      Number.isFinite(deletedCountRaw) && deletedCountRaw > 0 ? Math.floor(deletedCountRaw) : 1;
    const currentCount = readCommentCount(section);
    const fallbackNextCount = Number.isFinite(currentCount)
      ? Math.max(0, currentCount - deletedCount)
      : NaN;
    const serverNextCount = result && result.commentCount != null ? Number(result.commentCount) : NaN;
    const nextCount = Number.isFinite(fallbackNextCount)
      ? fallbackNextCount
      : Number.isFinite(serverNextCount)
      ? serverNextCount
      : undefined;
    updateCommentCount(section, nextCount);
    ensureNoCommentsNote(section);
  }
});

document.addEventListener("click", (event) => {
  const replyButton = event.target.closest("[data-comment-reply]");
  if (!replyButton) return;

  if (currentSignedIn && !currentCanComment) {
    applyCommentPermissionVisibility({ signedIn: true, canComment: false });
    return;
  }

  const commentBody = replyButton.closest(".comment-body");
  if (!commentBody) return;

  const replyForm = commentBody.querySelector(".comment-reply");
  if (!replyForm) return;

  replyForm.classList.toggle("is-open");
  if (replyForm.classList.contains("is-open")) {
    const textarea = replyForm.querySelector("textarea");
    if (textarea) {
      textarea.focus();
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const authorTrigger = target.closest("[data-comment-author-trigger]");
  if (!authorTrigger) return;

  event.preventDefault();
  openCommentUserDialog(authorTrigger).catch(() => {
    window.alert("Không thể mở trang thành viên.");
  });
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!form.closest(commentSelectors.section)) return;

  const reaction = extractCommentAction(form);
  if (reaction) {
    event.preventDefault();
    handleReactionSubmit(form, reaction.type).catch(() => {
      window.alert("Không thể thực hiện thao tác. Vui lòng thử lại.");
    });
    return;
  }

  if (!form.querySelector("textarea[name='content']")) return;
  event.preventDefault();
  handleCommentSubmit(form).catch(() => {
    showCommentFormNotice(form, "Không thể gửi bình luận. Vui lòng thử lại.", {
      tone: "error"
    });
  });
});

window.addEventListener("bfang:auth", (event) => {
  const detail = event && typeof event === "object" ? event.detail : null;
  const session = detail && detail.session ? detail.session : null;
  refreshDeleteVisibility(session).catch(() => null);
  refreshCommentPermissionVisibility(session).catch(() => null);
  refreshReactionStates(session).catch(() => null);
});

window.addEventListener("bfang:me", (event) => {
  const detail = event && typeof event === "object" ? event.detail : null;
  const profile = detail && detail.profile ? detail.profile : null;

  const nextId = profile && profile.id ? String(profile.id).trim() : "";
  if (nextId) {
    currentUserId = nextId;
  }
  currentCanDeleteAny = readCanDeleteAnyFromProfile(profile);
  currentCanComment = currentSignedIn ? readCanCommentFromProfile(profile) : true;
  applyDeleteVisibility(currentUserId, currentCanDeleteAny);
  applyCommentPermissionVisibility({ signedIn: currentSignedIn, canComment: currentCanComment });
  refreshReactionStates().catch(() => null);
});

const refreshCommentsPageUi = () => {
  const lazySection = document.querySelector(`${commentSelectors.section}[data-comment-lazy='1']`);
  const canAutoHydrate =
    !lazySection || lazySection.getAttribute("data-comment-auto-hydrate") === "1";
  if (canAutoHydrate) {
    hydrateLazyCommentsSection().catch(() => null);
  }
  refreshDeleteVisibility().catch(() => null);
  refreshCommentPermissionVisibility().catch(() => null);
  refreshReactionStates().catch(() => null);
  initCommentRichText();
  initCommentCharCounters();
  revealCommentTargetFromHash({ behavior: "auto", showFallback: true });
};

window.BfangComments = window.BfangComments || {};
window.BfangComments.refresh = refreshCommentsPageUi;

window.addEventListener("bfang:pagechange", () => {
  refreshCommentsPageUi();
});

refreshCommentsPageUi();
