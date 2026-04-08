"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { ipcRenderer } = require("electron");

const fsp = fs.promises;
const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_PAGES_PER_CHAPTER = 220;
const PAGE_UPLOAD_PARALLELISM = 3;
const SOURCE_PAGE_UPLOAD_PARALLELISM = 3;
const MIN_INTEGER_INPUT = 2;
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_DELAY_MS = 900;
const SOURCE_START_TIMEOUT_MS = 120000;
const SOURCE_PAGE_TIMEOUT_MS = 180000;
const SOURCE_COMPLETE_TIMEOUT_MS = 180000;
const PAGE_UPLOAD_COOLDOWN_MS = 40;
const RETRY_BASE_DELAY_MS = 1200;
const RETRY_MAX_DELAY_MS = 30000;
const RETRY_JITTER_RATIO = 0.35;
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const CHAPTER_PAGE_MAX_HEIGHT = 1800;
const CHAPTER_PAGE_WEBP_QUALITY = 77;
const WEBTOON_TARGET_WIDTH = 1000;
const SIDEBAR_COLLAPSE_WIDTH = 1180;
const LOG_COLLAPSE_HEIGHT = 860;
const STORAGE_ENDPOINT_KEY = "desktop_api_endpoint";
const SOURCE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const state = {
  endpoint: "https://api2.moetruyen.net",
  apiKey: "",
  authenticated: false,
  account: null,
  mangaList: [],
  mangaSearch: "",
  mangaLoading: false,
  selectedManga: null,
  activeUploadPane: "folder",
  sourceProvider: "",
  sourceInput: "",
  sourceManga: null,
  sourceRows: [],
  sourceGroupPriority: [],
  sourceLoading: false,
  sourceUploading: false,
  existingChapterMap: new Map(),
  parentFolder: "",
  chapterRows: [],
  chapterTableLoading: false,
  uploadRunning: false,
  authBusy: false,
  sidebarOpen: false,
  logCollapsed: false,
  logCompactMode: false
};

const el = {
  authOverlay: document.querySelector("[data-auth-overlay]"),
  authForm: document.querySelector("[data-auth-form]"),
  authEndpoint: document.querySelector("[data-auth-endpoint]"),
  authKey: document.querySelector("[data-auth-key]"),
  authMessage: document.querySelector("[data-auth-message]"),
  authSubmit: document.querySelector("[data-auth-submit]"),

  helpOpenBtn: document.querySelector("[data-help-open]"),
  helpModal: document.querySelector("[data-help-modal]"),
  helpCloseBtn: document.querySelector("[data-help-close]"),

  hardRefreshBtn: document.querySelector("[data-hard-refresh]"),
  switchAuthBtn: document.querySelector("[data-switch-auth]"),
  serverLabel: document.querySelector("[data-server-label]"),

  accountName: document.querySelector("[data-account-name]"),
  accountSub: document.querySelector("[data-account-sub]"),

  mangaSearch: document.querySelector("[data-manga-search]"),
  mangaGrid: document.querySelector("[data-manga-grid]"),
  mangaEmpty: document.querySelector("[data-manga-empty]"),

  uploadPaneButtons: Array.from(document.querySelectorAll("[data-upload-pane-btn]")),
  uploadPanes: Array.from(document.querySelectorAll("[data-upload-pane]")),
  uploadPanel: document.querySelector(".upload-panel"),
  uploadHeadActions: document.querySelector("[data-upload-head-actions]"),
  folderOnlyControls: Array.from(document.querySelectorAll("[data-folder-only]")),

  sidebarToggleBtn: document.querySelector("[data-sidebar-toggle]"),
  sidebarBackdrop: document.querySelector("[data-sidebar-backdrop]"),

  sourceLink: document.querySelector("[data-source-link]"),
  sourceFetchBtn: document.querySelector("[data-source-fetch]"),
  sourceUploadSelectedBtn: document.querySelector("[data-source-upload-selected]"),
  sourceSelectAllToggle: document.querySelector("[data-source-select-all]"),
  sourcePriorityOpenBtn: document.querySelector("[data-source-priority-open]"),
  sourcePriorityCloseBtn: document.querySelector("[data-source-priority-close]"),
  sourcePriorityPopover: document.querySelector("[data-source-priority-popover]"),
  sourcePriorityList: document.querySelector("[data-source-priority-list]"),
  sourceStatus: document.querySelector("[data-source-status]"),
  sourceTableBody: document.querySelector("[data-source-table]"),
  sourceEmpty: document.querySelector("[data-source-empty]"),

  selectedMangaLabel: document.querySelector("[data-selected-manga-label]"),
  selectAllBtn: document.querySelector("[data-select-all]"),
  loadTitleMapBtn: document.querySelector("[data-load-title-map]"),
  pickFolderBtn: document.querySelector("[data-pick-folder]"),
  reloadFolderBtn: document.querySelector("[data-reload-folder]"),
  parentFolder: document.querySelector("[data-parent-folder]"),
  tableWrap: document.querySelector("[data-table-wrap]"),
  chapterTableBody: document.querySelector("[data-chapter-table]"),
  tableEmpty: document.querySelector("[data-table-empty]"),
  tableLoading: document.querySelector("[data-table-loading]"),
  tableLoadingText: document.querySelector("[data-table-loading-text]"),

  retryCount: document.querySelector("[data-retry-count]"),
  delayMs: document.querySelector("[data-delay-ms]"),
  startUploadBtn: document.querySelector("[data-start-upload]"),

  overallLabel: document.querySelector("[data-overall-label]"),
  overallStats: document.querySelector("[data-overall-stats]"),
  overallPercent: document.querySelector("[data-overall-percent]"),
  overallSuccess: document.querySelector("[data-overall-success]"),
  overallFailed: document.querySelector("[data-overall-failed]"),
  overallSkipped: document.querySelector("[data-overall-skipped]"),
  overallBar: document.querySelector("[data-overall-bar]"),
  logSection: document.querySelector("[data-log-section]"),
  logToggleBtn: document.querySelector("[data-log-toggle]"),
  logToggleText: document.querySelector("[data-log-toggle-text]"),
  logToggleIcon: document.querySelector("[data-log-toggle-icon]"),
  logBox: document.querySelector("[data-log-box]")
};

function setAuthMessage(text, isError = false) {
  if (!el.authMessage) return;
  const safeText = (text || "").toString();
  el.authMessage.hidden = !safeText;
  el.authMessage.textContent = safeText;
  el.authMessage.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function logLine(text, isError = false) {
  if (!el.logBox) return;
  const line = document.createElement("p");
  line.className = `log-line${isError ? " error" : ""}`;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  line.textContent = `[${hh}:${mm}:${ss}] ${text}`;
  el.logBox.appendChild(line);
  el.logBox.scrollTop = el.logBox.scrollHeight;
}

function logDebugPayload(debugPayload, title = "Debug") {
  if (!debugPayload || typeof debugPayload !== "object") return;

  let text = "";
  try {
    text = JSON.stringify(debugPayload, null, 2);
  } catch (_err) {
    text = String(debugPayload);
  }

  if (!text) return;

  const lines = text.split("\n");
  const maxLines = 40;
  logLine(`${title}:`, true);
  lines.slice(0, maxLines).forEach((line) => {
    logLine(`  ${line}`, true);
  });
  if (lines.length > maxLines) {
    logLine(`  ... (${lines.length - maxLines} dòng còn lại)`, true);
  }
}

function buildSourceIpcError(result, fallbackMessage) {
  const message = result && result.error
    ? String(result.error)
    : String(fallbackMessage || "Lỗi không xác định từ nguồn ngoài.");
  const error = new Error(message);
  if (result && Number.isFinite(Number(result.status))) {
    error.statusCode = Number(result.status);
  }
  if (result && result.debug && typeof result.debug === "object") {
    error.debug = result.debug;
  }
  return error;
}

function logErrorWithDebug(prefix, error) {
  const message = (error && error.message) ? String(error.message) : "không rõ";
  logLine(`${prefix}: ${message}`, true);
  if (error && error.debug && typeof error.debug === "object") {
    logDebugPayload(error.debug, `${prefix} [debug]`);
  }
}

function getSourceProviderLabel(provider) {
  const value = normalizeSourceProvider(provider);
  if (value === "weebdex") return "WeebDex";
  if (value === "mangadex") return "MangaDex";
  return "Chưa xác định";
}

function normalizeSourceProvider(value) {
  const provider = String(value == null ? "" : value).trim().toLowerCase();
  if (provider === "weebdex" || provider === "mangadex") return provider;
  return "";
}

function detectSourceProviderFromInput(input) {
  const raw = String(input == null ? "" : input).trim();
  if (!raw) return "";

  if (SOURCE_UUID_PATTERN.test(raw)) {
    return "mangadex";
  }

  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = String(parsed.host || "").toLowerCase();
    if (host.includes("mangadex")) {
      return "mangadex";
    }
    if (host.includes("weebdex")) {
      return "weebdex";
    }

    const segments = parsed.pathname.split("/").map((item) => item.trim()).filter(Boolean);
    if (segments.some((item) => item.toLowerCase() === "title")) {
      if (segments.some((item) => SOURCE_UUID_PATTERN.test(item))) {
        return "mangadex";
      }
      if (segments.length >= 2) {
        return "weebdex";
      }
    }
  } catch (_err) {
    // ignore and fallback to id heuristics
  }

  if (/^[a-z0-9]{6,}$/i.test(raw)) {
    return "weebdex";
  }

  return "";
}

function normalizeUploadPane(value) {
  const pane = String(value == null ? "" : value).trim().toLowerCase();
  return pane === "source" ? "source" : "folder";
}

function renderUploadPanes() {
  const activePane = normalizeUploadPane(state.activeUploadPane);
  const isFolderPane = activePane === "folder";
  const isSourcePane = activePane === "source";

  if (Array.isArray(el.uploadPaneButtons)) {
    el.uploadPaneButtons.forEach((button) => {
      if (!(button instanceof Element)) return;
      const pane = normalizeUploadPane(button.getAttribute("data-pane"));
      const isActive = pane === activePane;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  if (Array.isArray(el.uploadPanes)) {
    el.uploadPanes.forEach((paneNode) => {
      if (!(paneNode instanceof Element)) return;
      const pane = normalizeUploadPane(paneNode.getAttribute("data-upload-pane"));
      const isActive = pane === activePane;
      paneNode.hidden = !isActive;
      paneNode.classList.toggle("active", isActive);
    });
  }

  if (el.uploadHeadActions) {
    el.uploadHeadActions.hidden = false;
  }

  if (Array.isArray(el.folderOnlyControls)) {
    el.folderOnlyControls.forEach((node) => {
      if (!node) return;
      node.hidden = !isFolderPane;
      node.style.display = isFolderPane ? "" : "none";
    });
  }

  if (el.uploadPanel) {
    el.uploadPanel.classList.toggle("source-pane-active", isSourcePane);
    el.uploadPanel.classList.toggle("folder-pane-active", isFolderPane);
  }

  if (!isSourcePane) {
    setSourcePriorityPopoverVisible(false);
  }

  updateStartUploadButtonState();
  updateSourceSelectionUi();
}

function setSourceStatus(text, isError = false) {
  if (!el.sourceStatus) return;
  const safeText = (text || "").toString().trim();
  el.sourceStatus.textContent = safeText || "";
  el.sourceStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function getSourceSelectedRelease(row) {
  if (!row || !Array.isArray(row.releases) || !row.releases.length) return null;
  const selectedId = String(row.selectedReleaseId || "").trim();
  return row.releases.find((release) => String(release.id) === selectedId) || row.releases[0];
}

function normalizeSourceGroupLabel(value) {
  const text = String(value == null ? "" : value).trim();
  return text || "(Không rõ nhóm)";
}

function getReleaseGroupLabel(release) {
  if (!release || typeof release !== "object") {
    return "(Không rõ nhóm)";
  }

  const rawLabel = normalizeSourceGroupLabel(release.groupLabel || release.groupName || release.group || "");
  const title = String(release.title || "").trim();
  if (!title) {
    return rawLabel;
  }

  const separators = [" — ", " - ", " – ", " —", "-"];
  for (const sep of separators) {
    const suffix = `${sep}${title}`;
    if (rawLabel.endsWith(suffix)) {
      const trimmed = rawLabel.slice(0, -suffix.length).trim();
      return trimmed || "(Không rõ nhóm)";
    }
  }

  return rawLabel;
}

function getSelectableSourceRows() {
  return (Array.isArray(state.sourceRows) ? state.sourceRows : []).filter((row) => row && !row.isDone && !row.isUploading);
}

function ensureSourceGroupPriority() {
  const groups = [];
  const seen = new Set();

  (Array.isArray(state.sourceRows) ? state.sourceRows : []).forEach((row) => {
    if (!row || !Array.isArray(row.releases)) return;
    row.releases.forEach((release) => {
      const label = getReleaseGroupLabel(release);
      if (seen.has(label)) return;
      seen.add(label);
      groups.push(label);
    });
  });

  const current = Array.isArray(state.sourceGroupPriority) ? state.sourceGroupPriority : [];
  const next = current.filter((label) => seen.has(label));
  groups.forEach((label) => {
    if (!next.includes(label)) {
      next.push(label);
    }
  });
  state.sourceGroupPriority = next;
}

function pickPreferredRelease(row) {
  if (!row || !Array.isArray(row.releases) || !row.releases.length) return null;
  const priority = Array.isArray(state.sourceGroupPriority) ? state.sourceGroupPriority : [];
  if (!priority.length) {
    return row.releases[0];
  }

  let best = row.releases[0];
  let bestRank = Number.MAX_SAFE_INTEGER;

  row.releases.forEach((release) => {
    const label = getReleaseGroupLabel(release);
    const rank = priority.indexOf(label);
    const score = rank >= 0 ? rank : Number.MAX_SAFE_INTEGER;
    if (score < bestRank) {
      bestRank = score;
      best = release;
    }
  });

  return best;
}

function applySourcePriorityToRows() {
  (Array.isArray(state.sourceRows) ? state.sourceRows : []).forEach((row) => {
    if (!row || !Array.isArray(row.releases) || !row.releases.length) return;
    const release = pickPreferredRelease(row);
    if (!release || !release.id) return;

    row.selectedReleaseId = String(release.id);
    row.customTitle = release.title ? String(release.title) : row.customTitle;
  });
}

function setSourcePriorityPopoverVisible(visible) {
  if (!el.sourcePriorityPopover) return;
  const show = Boolean(visible);
  el.sourcePriorityPopover.hidden = !show;
}

function renderSourcePriorityList() {
  if (!el.sourcePriorityList) return;
  ensureSourceGroupPriority();
  const list = Array.isArray(state.sourceGroupPriority) ? state.sourceGroupPriority : [];
  const disabled = state.uploadRunning || state.sourceUploading || state.sourceLoading || state.authBusy;

  if (!list.length) {
    el.sourcePriorityList.innerHTML = `<li class="hint">Chưa có dữ liệu nhóm dịch.</li>`;
    return;
  }

  el.sourcePriorityList.innerHTML = list.map((label, index) => `
    <li class="source-priority-item" data-priority-index="${index}">
      <span class="source-priority-item__label">${escapeHtml(label)}</span>
      <span class="source-priority-item__actions">
        <button type="button" class="btn btn-ghost" data-priority-move="up" ${disabled || index === 0 ? "disabled" : ""}>
          <i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
          <span>Lên</span>
        </button>
        <button type="button" class="btn btn-ghost" data-priority-move="down" ${disabled || index === list.length - 1 ? "disabled" : ""}>
          <i class="fa-solid fa-arrow-down" aria-hidden="true"></i>
          <span>Xuống</span>
        </button>
      </span>
    </li>
  `).join("");
}

function moveSourcePriority(index, delta) {
  const list = Array.isArray(state.sourceGroupPriority) ? state.sourceGroupPriority : [];
  const from = Math.max(0, Math.min(list.length - 1, Number(index)));
  const to = Math.max(0, Math.min(list.length - 1, from + Number(delta)));
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;

  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  state.sourceGroupPriority = next;
  applySourcePriorityToRows();
  renderSourceRows();
  renderSourcePriorityList();
}

function getEnabledSourceRows() {
  return (Array.isArray(state.sourceRows) ? state.sourceRows : []).filter((row) => row && row.enabled && !row.isDone && !row.isUploading);
}

function updateSourceSelectionUi() {
  const rows = Array.isArray(state.sourceRows) ? state.sourceRows : [];
  const selectableRows = rows.filter((row) => row && !row.isDone && !row.isUploading);
  const enabledRows = selectableRows.filter((row) => row.enabled);
  const selectedCount = enabledRows.length;

  if (el.sourceSelectAllToggle) {
    const allSelected = selectableRows.length > 0 && selectedCount === selectableRows.length;
    el.sourceSelectAllToggle.checked = allSelected;
    el.sourceSelectAllToggle.indeterminate = selectableRows.length > 0 && selectedCount > 0 && selectedCount < selectableRows.length;
    el.sourceSelectAllToggle.disabled = selectableRows.length === 0 || state.sourceLoading || state.sourceUploading || state.uploadRunning || state.authBusy;
  }

  if (el.sourceUploadSelectedBtn) {
    el.sourceUploadSelectedBtn.disabled = selectedCount === 0 || state.sourceLoading || state.sourceUploading || state.uploadRunning || state.authBusy;
    const textNode = el.sourceUploadSelectedBtn.querySelector("span");
    if (textNode) {
      textNode.textContent = selectedCount > 0
        ? `Upload đã chọn (${selectedCount})`
        : "Upload đã chọn";
    }
  }
}

function setSidebarOpen(open) {
  const shouldOpen = Boolean(open);
  state.sidebarOpen = shouldOpen;
  document.body.classList.toggle("sidebar-open", shouldOpen);
  if (el.sidebarBackdrop) {
    el.sidebarBackdrop.hidden = !shouldOpen || !isSidebarCollapsedViewport();
  }
}

function isSidebarCollapsedViewport() {
  if (typeof window === "undefined") return false;
  return window.innerWidth <= SIDEBAR_COLLAPSE_WIDTH;
}

function syncSidebarForViewport() {
  const collapsed = isSidebarCollapsedViewport();
  document.body.classList.toggle("sidebar-collapsed", collapsed);

  if (!collapsed && state.sidebarOpen) {
    setSidebarOpen(false);
    return;
  }

  if (el.sidebarBackdrop) {
    el.sidebarBackdrop.hidden = !collapsed || !state.sidebarOpen;
  }
}

function isLogCompactViewport() {
  if (typeof window === "undefined") return false;
  return window.innerWidth <= SIDEBAR_COLLAPSE_WIDTH || window.innerHeight <= LOG_COLLAPSE_HEIGHT;
}

function applyLogPanelState() {
  if (el.logSection) {
    el.logSection.classList.toggle("is-collapsed", state.logCollapsed);
  }

  document.body.classList.toggle("log-compact", state.logCompactMode);

  if (el.logToggleBtn) {
    el.logToggleBtn.hidden = !state.logCompactMode;
    el.logToggleBtn.setAttribute("aria-expanded", state.logCollapsed ? "false" : "true");
  }

  if (el.logToggleText) {
    el.logToggleText.textContent = state.logCollapsed ? "Hiện log" : "Ẩn log";
  }

  if (el.logToggleIcon) {
    el.logToggleIcon.className = state.logCollapsed
      ? "fa-solid fa-angle-down"
      : "fa-solid fa-angle-up";
  }
}

function syncLogPanelForViewport() {
  const compactMode = isLogCompactViewport();
  const wasCompact = state.logCompactMode;

  state.logCompactMode = compactMode;

  if (compactMode && !wasCompact) {
    state.logCollapsed = true;
  }

  if (!compactMode && wasCompact) {
    state.logCollapsed = false;
  }

  applyLogPanelState();
}

function toggleLogPanel() {
  if (!state.logCompactMode) return;
  state.logCollapsed = !state.logCollapsed;
  applyLogPanelState();
}

function renderSourceRows() {
  if (!el.sourceTableBody) return;
  const rows = Array.isArray(state.sourceRows) ? state.sourceRows : [];

  if (!rows.length) {
    el.sourceTableBody.innerHTML = "";
    if (el.sourceEmpty) {
      el.sourceEmpty.hidden = false;
    }
    updateSourceSelectionUi();
    updateLoadTitleMapButtonState();
    return;
  }

  el.sourceTableBody.innerHTML = rows
    .map((row) => {
      const selectedRelease = getSourceSelectedRelease(row);
      const releaseCount = Array.isArray(row.releases) ? row.releases.length : 0;
      const enabled = row.enabled !== false;
      const chapterDisplayText = String(row.chapterNumberText || row.chapterInput || "").trim() || "-";

      const statusClass = row.isUploading
        ? "uploading"
        : row.isDone
          ? "done"
          : row.isSkipped
            ? "skipped"
            : row.isFailed
              ? "failed"
              : "";
      const statusText = row.isUploading
        ? `Đang upload ${Number(row.uploadedCount) || 0}/${Number(row.totalCount) || 0}`
        : row.isDone
          ? "Hoàn thành"
          : row.isSkipped
            ? "Bỏ qua (chapter đã tồn tại)"
          : row.isFailed
            ? (row.errorMessage || "Thất bại")
            : "Sẵn sàng";

      const releaseOptions = (Array.isArray(row.releases) ? row.releases : [])
        .map((release) => {
          const releaseId = String(release.id || "");
          const optionLabel = getReleaseGroupLabel(release) || `Release ${releaseId.slice(0, 8)}`;
          return `<option value="${escapeHtml(releaseId)}"${releaseId === String(row.selectedReleaseId || "") ? " selected" : ""}>${escapeHtml(optionLabel)}</option>`;
        })
        .join("");

      return `
        <tr data-source-row-id="${escapeHtml(row.id)}">
          <td class="source-col-check">
            <input
              type="checkbox"
              data-source-enabled="1"
              ${enabled ? "checked" : ""}
              ${state.sourceLoading || state.sourceUploading || state.uploadRunning || state.authBusy || row.isDone || row.isUploading ? "disabled" : ""}
            />
          </td>
          <td class="source-col-chapter source-chapter-cell">
            <span class="source-chapter-text" title="${escapeHtml(chapterDisplayText)}">${escapeHtml(chapterDisplayText)}</span>
          </td>
          <td class="source-col-title">
            <input
              type="text"
              class="source-title-input"
              data-source-title="1"
              value="${escapeHtml(String(row.customTitle || ""))}"
              maxlength="180"
              ${state.sourceLoading || state.sourceUploading || state.uploadRunning || state.authBusy ? "disabled" : ""}
            />
          </td>
          <td class="source-col-group">
            <select class="source-group-select" data-source-release="1" ${state.sourceLoading || state.sourceUploading || state.uploadRunning || state.authBusy ? "disabled" : ""}>
              ${releaseOptions}
            </select>
            <div class="source-release-meta">${escapeHtml(releaseCount > 1 ? `${releaseCount} bản dịch` : "1 bản dịch")}</div>
          </td>
          <td class="source-col-status"><span class="source-row-status ${escapeHtml(statusClass)}">${escapeHtml(statusText)}</span></td>
          <td class="source-col-upload">
            <button type="button" class="btn btn-primary source-upload-btn" data-source-upload="1" ${state.sourceLoading || state.sourceUploading || state.uploadRunning || state.authBusy ? "disabled" : ""}>
              <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i>
              <span>Upload</span>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  if (el.sourceEmpty) {
    el.sourceEmpty.hidden = true;
  }

  updateSourceSelectionUi();
  updateSelectAllButtonState();
  updateLoadTitleMapButtonState();
}

function setSourceControlsDisabled(disabled) {
  const flag = Boolean(disabled);
  if (el.sourceLink) {
    el.sourceLink.disabled = flag;
  }
  if (el.sourceFetchBtn) {
    el.sourceFetchBtn.disabled = flag;
  }
  if (el.sourcePriorityOpenBtn) {
    el.sourcePriorityOpenBtn.disabled = flag;
  }
  if (el.sourcePriorityCloseBtn) {
    el.sourcePriorityCloseBtn.disabled = flag;
  }
  if (el.sourceUploadSelectedBtn) {
    el.sourceUploadSelectedBtn.disabled = flag;
  }
  if (el.sourceSelectAllToggle) {
    el.sourceSelectAllToggle.disabled = flag;
  }
  renderSourcePriorityList();
  renderSourceRows();
}

async function sourceResolveManga(payload = {}) {
  const result = await ipcRenderer.invoke("desktop:source-resolve-manga", payload).catch(() => null);
  if (!result || result.ok !== true || !result.data) {
    throw buildSourceIpcError(result, "Không thể tải chapter từ nguồn ngoài.");
  }
  return result.data;
}

async function sourceDownloadChapter(payload = {}) {
  const result = await ipcRenderer.invoke("desktop:source-download-chapter", payload).catch(() => null);
  if (!result || result.ok !== true || !result.data) {
    throw buildSourceIpcError(result, "Không thể tải ảnh chapter.");
  }
  return result.data;
}

function sleep(ms) {
  const wait = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, wait));
}

function extractErrorStatusCode(error) {
  if (!error || typeof error !== "object") return 0;
  const direct = Number(error.statusCode);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.floor(direct);
  }
  const payloadStatus = Number(error && error.payload && error.payload.statusCode);
  if (Number.isFinite(payloadStatus) && payloadStatus > 0) {
    return Math.floor(payloadStatus);
  }
  const debugStatus = Number(error && error.debug && error.debug.httpStatus);
  if (Number.isFinite(debugStatus) && debugStatus > 0) {
    return Math.floor(debugStatus);
  }
  return 0;
}

function extractRetryAfterMs(error) {
  if (!error || typeof error !== "object") return 0;
  const direct = Number(error.retryAfterMs);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.max(0, Math.floor(direct));
  }
  return 0;
}

function isTransientNetworkError(error) {
  const code = error && error.code ? String(error.code).toUpperCase() : "";
  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "EPIPE"].includes(code)) {
    return true;
  }

  const message = (error && error.message ? String(error.message) : "").toLowerCase();
  if (!message) return false;
  return [
    "failed to fetch",
    "network",
    "timeout",
    "quá thời gian",
    "socket hang up",
    "temporarily unavailable",
    "connection reset",
    "connection refused"
  ].some((token) => message.includes(token));
}

function isRetriableRequestError(error) {
  const statusCode = extractErrorStatusCode(error);
  if (RETRYABLE_HTTP_STATUS.has(statusCode)) {
    return true;
  }
  if (statusCode >= 500 && statusCode < 600) {
    return true;
  }
  return isTransientNetworkError(error);
}

function isRetriableCompressionError(error) {
  if (!error || typeof error !== "object") return false;
  const code = error.code ? String(error.code).toUpperCase() : "";
  if (["EMFILE", "ENFILE", "EBUSY", "EAGAIN", "ETIMEDOUT"].includes(code)) {
    return true;
  }

  const message = (error.message ? String(error.message) : "").toLowerCase();
  if (!message) return false;
  return ["resource busy", "temporarily unavailable", "timeout"].some((token) => message.includes(token));
}

function computeRetryDelayMs({ attempt, retryAfterMs, baseDelayMs, maxDelayMs, jitterRatio }) {
  const safeAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  const safeBaseDelay = Math.max(120, Math.floor(Number(baseDelayMs) || RETRY_BASE_DELAY_MS));
  const safeMaxDelay = Math.max(safeBaseDelay, Math.floor(Number(maxDelayMs) || RETRY_MAX_DELAY_MS));
  const safeRetryAfter = Math.max(0, Math.floor(Number(retryAfterMs) || 0));
  const safeJitterRatio = Math.min(0.9, Math.max(0, Number(jitterRatio)));

  if (safeRetryAfter > 0) {
    if (safeJitterRatio <= 0) {
      return safeRetryAfter;
    }
    const retryAfterJitter = Math.floor(safeRetryAfter * safeJitterRatio * Math.random());
    return safeRetryAfter + retryAfterJitter;
  }

  const baseDelay = Math.min(safeMaxDelay, safeBaseDelay * (2 ** (safeAttempt - 1)));
  if (safeJitterRatio <= 0) {
    return baseDelay;
  }

  const jitter = Math.floor(baseDelay * safeJitterRatio * Math.random());
  return Math.min(safeMaxDelay, baseDelay + jitter);
}

function formatRetryDelayHint(context) {
  const delayMs = context && Number.isFinite(Number(context.delayMs))
    ? Math.max(0, Math.floor(Number(context.delayMs)))
    : 0;
  const retryAfterMs = context && Number.isFinite(Number(context.retryAfterMs))
    ? Math.max(0, Math.floor(Number(context.retryAfterMs)))
    : 0;
  if (delayMs <= 0 && retryAfterMs <= 0) {
    return "";
  }

  if (retryAfterMs > 0) {
    return `, chờ ${delayMs}ms (server yêu cầu ${retryAfterMs}ms)`;
  }
  return `, chờ ${delayMs}ms`;
}

function normalizeEndpoint(value) {
  const raw = (value || "").toString().trim();
  if (!raw) return "";

  const tryParse = (candidate) => {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      return `${parsed.protocol}//${parsed.host}${parsed.pathname || ""}`.replace(/\/+$/, "");
    } catch (_err) {
      return "";
    }
  };

  const direct = tryParse(raw);
  if (direct) {
    if (direct.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(direct)) {
      return tryParse(direct.replace(/^http:\/\//i, "https://")) || direct;
    }
    return direct;
  }

  return tryParse(`https://${raw}`);
}

function parseChapterNumber(value) {
  const raw = (value == null ? "" : String(value)).trim();
  if (!raw) return null;
  const normalized = raw.replace(/,/g, ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0) return null;
  return Math.round(parsed * 1000) / 1000;
}

function parseChapterNumberAndTitle(value) {
  const raw = (value == null ? "" : String(value)).trim();
  if (!raw) {
    return { chapterNumber: null, title: "" };
  }

  const separatorIndex = raw.indexOf("_");
  if (separatorIndex < 0) {
    return {
      chapterNumber: parseChapterNumber(raw),
      title: ""
    };
  }

  const chapterRaw = raw.slice(0, separatorIndex).trim();
  const titleRaw = raw.slice(separatorIndex + 1).trim();
  return {
    chapterNumber: parseChapterNumber(chapterRaw),
    title: titleRaw
  };
}

function formatChapterNumber(number) {
  const value = Number(number);
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value - Math.round(value)) < 1e-9) {
    return String(Math.round(value));
  }
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function chapterNumberKey(number) {
  const value = Number(number);
  if (!Number.isFinite(value)) return "";
  return value.toFixed(3);
}

function escapeHtml(value) {
  return (value == null ? "" : String(value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setButtonLabel(button, iconClass, label) {
  if (!button) return;
  const safeLabel = escapeHtml((label || "").toString());
  const iconHtml = iconClass
    ? `<i class="${escapeHtml(iconClass)}" aria-hidden="true"></i>`
    : "";
  button.innerHTML = `${iconHtml}<span>${safeLabel}</span>`;
}

function normalizeIntegerInputValue(value, fallback, maxValue) {
  const safeFallback = Math.max(MIN_INTEGER_INPUT, Math.floor(Number(fallback) || MIN_INTEGER_INPUT));
  const cleanText = (value == null ? "" : String(value)).replace(/[^0-9]/g, "");
  const parsed = Number.parseInt(cleanText, 10);

  let nextValue = Number.isFinite(parsed) ? Math.floor(parsed) : safeFallback;
  if (nextValue < MIN_INTEGER_INPUT) {
    nextValue = MIN_INTEGER_INPUT;
  }

  const safeMax = Number(maxValue);
  if (Number.isFinite(safeMax) && safeMax > 0) {
    nextValue = Math.min(nextValue, Math.floor(safeMax));
  }

  if (nextValue < MIN_INTEGER_INPUT) {
    nextValue = MIN_INTEGER_INPUT;
  }

  return nextValue;
}

function readIntegerInputValue(input, fallback) {
  if (!input) return Math.max(MIN_INTEGER_INPUT, Math.floor(Number(fallback) || MIN_INTEGER_INPUT));
  const maxAttr = input.getAttribute("max");
  const maxValue = maxAttr ? Number(maxAttr) : Number.NaN;
  const normalized = normalizeIntegerInputValue(input.value, fallback, maxValue);
  input.value = String(normalized);
  return normalized;
}

function bindStrictIntegerInput(input, fallback) {
  if (!input) return;

  input.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
    },
    { passive: false }
  );

  input.addEventListener("keydown", (event) => {
    if (!event || !event.key) return;
    if (["e", "E", "+", "-", ".", ","].includes(event.key)) {
      event.preventDefault();
    }
  });

  input.addEventListener("input", () => {
    const onlyDigits = (input.value || "").replace(/[^0-9]/g, "");
    if (onlyDigits !== input.value) {
      input.value = onlyDigits;
    }
  });

  input.addEventListener("blur", () => {
    readIntegerInputValue(input, fallback);
  });

  readIntegerInputValue(input, fallback);
}

function getSelectableRows() {
  return state.chapterRows.filter((row) => row && !row.exceedsLimit);
}

function hasCheckedSourceRows() {
  return getEnabledSourceRows().length > 0;
}

function updateLoadTitleMapButtonState() {
  if (!el.loadTitleMapBtn) return;
  const activePane = normalizeUploadPane(state.activeUploadPane);
  const isFolderPane = activePane === "folder";
  const isSourcePane = activePane === "source";
  const hasFolderRows = Array.isArray(state.chapterRows) && state.chapterRows.length > 0;
  const hasSourceRows = Array.isArray(state.sourceRows) && state.sourceRows.length > 0;
  const shouldShow = (isFolderPane && hasFolderRows) || (isSourcePane && hasSourceRows);
  el.loadTitleMapBtn.hidden = !shouldShow;
  el.loadTitleMapBtn.style.display = shouldShow ? "" : "none";
  el.loadTitleMapBtn.disabled =
    !shouldShow ||
    !state.authenticated ||
    state.uploadRunning ||
    state.authBusy ||
    state.sourceUploading ||
    state.sourceLoading;
}

function hasCheckedChapters() {
  return state.chapterRows.some((row) => row && row.enabled && !row.exceedsLimit);
}

function updateSelectAllButtonState() {
  if (!el.selectAllBtn) return;

  if (normalizeUploadPane(state.activeUploadPane) === "source") {
    const selectableRows = getSelectableSourceRows();
    const selectedCount = selectableRows.filter((row) => row.enabled).length;
    const hasRows = selectableRows.length > 0;
    const allSelected = hasRows && selectedCount === selectableRows.length;

    setButtonLabel(
      el.selectAllBtn,
      allSelected ? "fa-solid fa-square-minus" : "fa-solid fa-square-check",
      allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"
    );

    el.selectAllBtn.disabled =
      !state.authenticated ||
      state.uploadRunning ||
      state.authBusy ||
      state.sourceLoading ||
      state.sourceUploading ||
      !hasRows;
    return;
  }

  const selectableRows = getSelectableRows();
  const selectedCount = selectableRows.filter((row) => row.enabled).length;
  const hasRows = selectableRows.length > 0;
  const allSelected = hasRows && selectedCount === selectableRows.length;

  setButtonLabel(
    el.selectAllBtn,
    allSelected ? "fa-solid fa-square-minus" : "fa-solid fa-square-check",
    allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"
  );
  el.selectAllBtn.disabled =
    !state.authenticated ||
    state.uploadRunning ||
    state.authBusy ||
    state.sourceUploading ||
    state.sourceLoading ||
    !hasRows;
}

function updateStartUploadButtonState() {
  if (!el.startUploadBtn) return;
  const isSourcePane = normalizeUploadPane(state.activeUploadPane) === "source";
  const shouldDisable =
    !state.authenticated ||
    state.uploadRunning ||
    state.authBusy ||
    state.sourceUploading ||
    state.sourceLoading ||
    (isSourcePane ? !hasCheckedSourceRows() : !hasCheckedChapters());
  el.startUploadBtn.disabled = shouldDisable;

  updateSelectAllButtonState();
  updateLoadTitleMapButtonState();
}

function setControlsDisabled(disabled) {
  const flag = Boolean(disabled);
  const elements = [
    el.hardRefreshBtn,
    el.selectAllBtn,
    el.loadTitleMapBtn,
    el.pickFolderBtn,
    el.reloadFolderBtn,
    el.startUploadBtn,
    el.retryCount,
    el.delayMs,
    el.mangaSearch,
    el.switchAuthBtn,
    el.sidebarToggleBtn,
    el.helpOpenBtn
  ];

  if (Array.isArray(el.uploadPaneButtons)) {
    el.uploadPaneButtons.forEach((button) => {
      elements.push(button);
    });
  }
  elements.forEach((node) => {
    if (!node) return;
    node.disabled = flag;
  });

  setSourceControlsDisabled(flag);

  if (el.chapterTableBody) {
    renderChapterTable();
  }

  updateStartUploadButtonState();
}

function setAuthOverlayVisible(visible) {
  if (!el.authOverlay) return;
  el.authOverlay.hidden = !visible;
}

function setHelpModalVisible(visible) {
  if (!el.helpModal) return;
  const show = Boolean(visible);
  el.helpModal.hidden = !show;

  if (show && el.helpCloseBtn) {
    setTimeout(() => {
      el.helpCloseBtn.focus();
    }, 0);
  }
}

function setChapterTableLoading(loading, labelText = "") {
  state.chapterTableLoading = Boolean(loading);

  if (el.tableWrap) {
    el.tableWrap.classList.toggle("is-loading", state.chapterTableLoading);
  }

  if (el.tableEmpty) {
    const hasRows = Array.isArray(state.chapterRows) && state.chapterRows.length > 0;
    el.tableEmpty.hidden = state.chapterTableLoading || hasRows;
  }

  if (el.tableLoading) {
    el.tableLoading.hidden = !state.chapterTableLoading;
  }

  if (el.tableLoadingText && labelText) {
    el.tableLoadingText.textContent = labelText;
  }
}

function setOverallProgress(done, total, labelText) {
  const safeDone = Math.max(0, Number(done) || 0);
  const safeTotal = Math.max(0, Number(total) || 0);
  const idle = safeTotal <= 0;
  const rawText = (labelText || "").toString().trim();
  const hideLabel = !rawText || rawText === "Chưa upload.";
  if (el.overallLabel) {
    el.overallLabel.hidden = hideLabel;
    el.overallLabel.textContent = hideLabel ? "" : rawText;
  }
  if (el.overallStats) {
    el.overallStats.hidden = idle;
    el.overallStats.textContent = `${safeDone}/${safeTotal}`;
  }
  const pct = safeTotal > 0 ? Math.min(100, Math.max(0, Math.round((safeDone / safeTotal) * 100))) : 0;
  if (el.overallPercent) {
    el.overallPercent.hidden = idle;
    el.overallPercent.textContent = `${pct}%`;
  }
  if (el.overallBar) {
    el.overallBar.style.width = `${pct}%`;
  }
}

function setOverallBreakdown({ success = 0, failed = 0, skipped = 0 } = {}) {
  const okCount = Math.max(0, Number(success) || 0);
  const failedCount = Math.max(0, Number(failed) || 0);
  const skippedCount = Math.max(0, Number(skipped) || 0);

  if (el.overallSuccess) {
    el.overallSuccess.textContent = `Thành công: ${okCount}`;
  }
  if (el.overallFailed) {
    el.overallFailed.textContent = `Thất bại: ${failedCount}`;
  }
  if (el.overallSkipped) {
    el.overallSkipped.textContent = `Bỏ qua: ${skippedCount}`;
  }
}

function updateServerLabel() {
  if (!el.serverLabel) return;
  if (!state.authenticated) {
    el.serverLabel.textContent = "API: chưa kết nối";
    return;
  }
  const keyPrefix = state.account && state.account.keyPrefix ? String(state.account.keyPrefix).trim() : "";
  el.serverLabel.textContent = `API: ${state.endpoint}${keyPrefix ? ` | key ${keyPrefix}` : ""}`;
}

function renderAccount() {
  const account = state.account;
  if (!account) {
    if (el.accountName) el.accountName.textContent = "Chưa đăng nhập";
    if (el.accountSub) {
      el.accountSub.textContent = "";
      el.accountSub.hidden = true;
    }
    return;
  }

  const displayName =
    (account.displayName || "").toString().trim() ||
    (account.username || "").toString().trim() ||
    "User";

  const username = (account.username || "").toString().trim();
  const showUsername = username && username !== displayName;

  if (el.accountName) {
    el.accountName.textContent = showUsername ? `${displayName} ·` : displayName;
  }

  const subParts = [];
  if (username) {
    subParts.push(`@${username}`);
  }
  if (el.accountSub) {
    el.accountSub.textContent = subParts.join(" | ") || "Đã xác thực API key";
    el.accountSub.hidden = !subParts.length;
  }
}

function getVisibleMangaList() {
  const query = state.mangaSearch.trim().toLowerCase();
  const list = Array.isArray(state.mangaList) ? state.mangaList : [];
  if (!query) return list;
  return list.filter((item) => {
    const haystack = [item.title, item.slug, item.author, item.groupName]
      .map((value) => (value == null ? "" : String(value)).toLowerCase())
      .join(" ");
    return haystack.includes(query);
  });
}

function renderMangaList() {
  if (!el.mangaGrid) return;
  const sourceList = getVisibleMangaList();
  const list = sourceList
    .slice()
    .sort((a, b) => (a && a.title ? String(a.title) : "").localeCompare(b && b.title ? String(b.title) : "", "vi"));
  const selectedId = state.selectedManga && state.selectedManga.id ? Number(state.selectedManga.id) : 0;

  if (state.mangaLoading && !state.mangaList.length) {
    el.mangaGrid.innerHTML = Array.from({ length: 8 }, () => {
      return `
        <article class="manga-card loading" aria-hidden="true">
          <div class="manga-skeleton-line"></div>
          <div class="manga-skeleton-line short"></div>
        </article>
      `;
    }).join("");

    if (el.mangaEmpty) {
      el.mangaEmpty.hidden = true;
    }
    return;
  }

  el.mangaGrid.innerHTML = list
    .map((manga) => {
      const mangaId = Number(manga.id) || 0;
      const activeClass = mangaId && mangaId === selectedId ? " active" : "";
      const title = (manga.title || "").toString();
      const author = (manga.author || "").toString().trim();
      const groupName = (manga.groupName || "").toString().trim();
      const compactMeta = [
        author ? `Tác giả: ${author}` : null,
        groupName ? `Nhóm: ${groupName}` : null
      ].filter(Boolean).join(" • ") || "Thiếu thông tin truyện";
      const detailMeta = `${compactMeta}${manga && manga.isHidden ? " • Trạng thái: Đã ẩn" : ""}`;
      return `
        <article class="manga-card${activeClass}" data-manga-id="${mangaId}">
          <div class="manga-card__head">
            <h3 class="manga-title">${escapeHtml(title)}</h3>
          </div>
          <p class="manga-meta" title="${escapeHtml(detailMeta)}">${escapeHtml(compactMeta)}</p>
        </article>
      `;
    })
    .join("");

  if (el.mangaEmpty) {
    el.mangaEmpty.hidden = list.length > 0;
  }
}

function updateSelectedMangaLabel() {
  if (!el.selectedMangaLabel) return;
  if (!state.selectedManga) {
    el.selectedMangaLabel.textContent = "Chưa chọn truyện.";
    return;
  }
  const item = state.selectedManga;
  const title = escapeHtml(item.title || "");
  const latestText = item.latestChapterNumberText
    ? `Mới nhất: ${escapeHtml(String(item.latestChapterNumberText))}`
    : "";
  const metaParts = [`ID: ${escapeHtml(String(item.id || ""))}`];
  if (item && item.isHidden) {
    metaParts.push("Trạng thái: Đã ẩn");
  }
  if (latestText) {
    metaParts.push(latestText);
  }

  el.selectedMangaLabel.innerHTML = `
    <span class="selected-manga-label__title">${title}</span>
    <span class="selected-manga-label__meta">${metaParts.join(" • ")}</span>
  `;
}

function renderChapterTable() {
  if (!el.chapterTableBody) return;
  const rows = Array.isArray(state.chapterRows) ? state.chapterRows : [];

  if (el.tableEmpty) {
    el.tableEmpty.hidden = rows.length > 0 || state.chapterTableLoading;
  }

  el.chapterTableBody.innerHTML = rows
    .map((row) => {
      const rowClasses = [];
      if (row.conflict) rowClasses.push("conflict");

      const isPendingSkip =
        row.conflict &&
        row.action === "skip" &&
        !row.isUploading &&
        !row.isDone &&
        !row.isFailed &&
        !row.isSkipped;
      const isPendingOverwrite =
        row.conflict &&
        row.action === "overwrite" &&
        !row.isUploading &&
        !row.isDone &&
        !row.isFailed &&
        !row.isSkipped;
      const isPendingNew =
        !row.conflict &&
        !row.isUploading &&
        !row.isDone &&
        !row.isFailed &&
        !row.isSkipped;

      if (row.isFailed) rowClasses.push("failed");
      if (row.isDone) rowClasses.push("done");
      if (row.isSkipped || isPendingSkip) rowClasses.push("skipped");
      if (isPendingOverwrite) rowClasses.push("overwrite");
      if (isPendingNew) rowClasses.push("new");
      const rowClass = rowClasses.join(" ");
      const disabledAttr = (state.uploadRunning || state.sourceUploading || state.sourceLoading || state.authBusy) ? " disabled" : "";
      const totalCount = Math.max(0, Number(row.totalCount || row.imagePaths.length) || 0);
      const uploadedRaw = Number(row.uploadedCount || 0);
      const uploadedCount = Math.max(0, Math.min(totalCount, Number.isFinite(uploadedRaw) ? uploadedRaw : 0));

      let statusText = "Mới";
      let statusClass = "new";
      let statusIconClass = "fa-solid fa-wand-sparkles";
      if (row.isUploading) {
        statusText = `${uploadedCount}/${totalCount}`;
        statusClass = "uploading";
        statusIconClass = "fa-solid fa-cloud-arrow-up";
      } else if (row.isDone) {
        statusText = "Hoàn thành";
        statusClass = "done";
        statusIconClass = "fa-solid fa-circle-check";
      } else if (row.isFailed) {
        statusText = row.exceedsLimit ? "Vượt giới hạn ảnh" : "Thất bại";
        statusClass = "failed";
        statusIconClass = "fa-solid fa-circle-xmark";
      } else if (row.isSkipped || isPendingSkip) {
        statusText = "Bỏ qua";
        statusClass = "skipped";
        statusIconClass = "fa-solid fa-forward";
      } else if (isPendingOverwrite) {
        statusText = "Up đè";
        statusClass = "overwrite";
        statusIconClass = "fa-solid fa-arrows-rotate";
      }

      const spinnerHtml = row.isUploading
        ? "<span class=\"chapter-spinner spinning\" aria-hidden=\"true\"></span>"
        : "";

      const actionCell = row.conflict
        ? `
            <select data-row-action="1"${disabledAttr}>
              <option value="skip"${row.action === "skip" ? " selected" : ""}>Bỏ qua</option>
              <option value="overwrite"${row.action === "overwrite" ? " selected" : ""}>Up đè</option>
            </select>
          `
        : `<span class="hint">Mới</span>`;

      return `
        <tr class="${rowClass}" data-row-id="${escapeHtml(row.id)}">
          <td class="chapter-col-check"><input type="checkbox" data-row-enabled="1"${row.enabled ? " checked" : ""}${disabledAttr} /></td>
          <td class="chapter-col-number">${escapeHtml(row.chapterNumberText)}</td>
          <td class="chapter-col-folder" title="${escapeHtml(row.folderPath)}"><span class="chapter-folder-text">${escapeHtml(row.folderName)}</span></td>
          <td class="chapter-col-pages">${row.imagePaths.length}</td>
          <td class="chapter-col-title">
            <input
              type="text"
              data-row-title="1"
              value="${escapeHtml(row.title || "")}"${disabledAttr}
              maxlength="140"
            />
          </td>
          <td class="chapter-col-action">${actionCell}</td>
          <td class="chapter-col-status">
            <div class="chapter-progress-wrap">
              <span class="chapter-state ${statusClass}">
                <i class="${escapeHtml(statusIconClass)}" aria-hidden="true"></i>
                <span>${escapeHtml(statusText)}</span>
              </span>
              ${spinnerHtml}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  updateStartUploadButtonState();
}

function updateRowUploadState(rowId, patch, shouldRender = true) {
  const row = state.chapterRows.find((item) => item.id === rowId);
  if (!row) return;
  const next = patch && typeof patch === "object" ? patch : {};

  if (Object.prototype.hasOwnProperty.call(next, "uploadedCount")) {
    const parsed = Number(next.uploadedCount);
    row.uploadedCount = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }
  if (Object.prototype.hasOwnProperty.call(next, "totalCount")) {
    const parsed = Number(next.totalCount);
    row.totalCount = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : row.totalCount;
  }
  if (Object.prototype.hasOwnProperty.call(next, "isUploading")) {
    row.isUploading = Boolean(next.isUploading);
  }
  if (Object.prototype.hasOwnProperty.call(next, "isFailed")) {
    row.isFailed = Boolean(next.isFailed);
  }
  if (Object.prototype.hasOwnProperty.call(next, "isDone")) {
    row.isDone = Boolean(next.isDone);
  }
  if (Object.prototype.hasOwnProperty.call(next, "isSkipped")) {
    row.isSkipped = Boolean(next.isSkipped);
  }
  if (Object.prototype.hasOwnProperty.call(next, "enabled")) {
    row.enabled = Boolean(next.enabled);
  }

  if (shouldRender) {
    renderChapterTable();
  }
}

function updateFolderPathLabel() {
  if (!el.parentFolder) return;
  const folderText = state.parentFolder || "Chưa chọn thư mục.";

  if ("value" in el.parentFolder) {
    el.parentFolder.value = folderText;
    return;
  }

  if (!state.parentFolder) {
    el.parentFolder.textContent = folderText;
    return;
  }
  el.parentFolder.textContent = folderText;
}

async function listImageFiles(folderPath) {
  const items = await fsp.readdir(folderPath, { withFileTypes: true });
  const files = items
    .filter((item) => item && item.isFile())
    .map((item) => item.name)
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => collator.compare(a, b))
    .map((name) => path.join(folderPath, name));
  return files;
}

function applyConflictState() {
  const map = state.existingChapterMap;
  state.chapterRows.forEach((row) => {
    const key = chapterNumberKey(row.chapterNumber);
    const existing = key ? map.get(key) : null;
    row.conflict = Boolean(existing);
    row.existingChapter = existing || null;

    if (row.conflict) {
      if (row.action !== "overwrite" && row.action !== "skip") {
        row.action = "skip";
      }
    } else {
      row.action = "new";
    }

    row.totalCount = Math.max(0, Number(row.imagePaths.length) || 0);
    row.uploadedCount = Math.max(0, Number(row.uploadedCount || 0) || 0);
    row.isUploading = false;
    row.isDone = false;
    row.isFailed = Boolean(row.exceedsLimit);
    row.isSkipped = false;
  });
}

async function loadRowsFromParentFolder(parentFolder) {
  const entries = await fsp.readdir(parentFolder, { withFileTypes: true });
  const chapterFolders = entries.filter((entry) => entry && entry.isDirectory());

  const rows = [];
  for (const folder of chapterFolders) {
    const folderName = (folder.name || "").toString().trim();
    if (!folderName) continue;

    const parsedFolderMeta = parseChapterNumberAndTitle(folderName);
    const chapterNumber = parsedFolderMeta.chapterNumber;
    if (chapterNumber == null) {
      continue;
    }

    const folderPath = path.join(parentFolder, folderName);
    const imagePaths = await listImageFiles(folderPath);
    if (!imagePaths.length) {
      continue;
    }

    const rowId = cryptoRandomId();
    rows.push({
      id: rowId,
      folderName,
      folderPath,
      chapterNumber,
      chapterNumberText: formatChapterNumber(chapterNumber),
      imagePaths,
      title: parsedFolderMeta.title || "",
      enabled:
        imagePaths.length > MAX_PAGES_PER_CHAPTER
          ? false
          : true,
      action: "new",
      exceedsLimit: imagePaths.length > MAX_PAGES_PER_CHAPTER,
      conflict: false,
      existingChapter: null,
      uploadedCount: 0,
      totalCount: imagePaths.length,
      isUploading: false,
      isDone: false,
      isFailed: imagePaths.length > MAX_PAGES_PER_CHAPTER,
      isSkipped: false
    });
  }

  rows.sort((a, b) => {
    const diff = Number(a.chapterNumber) - Number(b.chapterNumber);
    if (Math.abs(diff) > 1e-9) return diff;
    return collator.compare(a.folderName, b.folderName);
  });

  state.chapterRows = rows;
  applyConflictState();
  renderChapterTable();
  logLine(`Đã nạp ${rows.length} chapter từ thư mục.`);
}

async function loadExistingChaptersForSelectedManga(loadingText = "") {
  const label = (loadingText || "Đang tải dữ liệu chapter...").toString();
  setChapterTableLoading(true, label);

  try {
    state.existingChapterMap = new Map();
    if (!state.selectedManga) {
      applyConflictState();
      renderChapterTable();
      return;
    }

    const response = await apiRequest(`/v1/manga/${encodeURIComponent(String(state.selectedManga.id))}/chapters`, {
      method: "GET"
    });

    const map = new Map();
    const chapters = Array.isArray(response.chapters) ? response.chapters : [];
    chapters.forEach((chapter) => {
      const number = chapter && chapter.number != null ? Number(chapter.number) : NaN;
      if (!Number.isFinite(number)) return;
      map.set(chapterNumberKey(number), chapter);
    });
    state.existingChapterMap = map;

    applyConflictState();
    renderChapterTable();
  } finally {
    setChapterTableLoading(false);
  }
}

async function selectMangaById(mangaId) {
  const id = Number(mangaId);
  const previousId = state.selectedManga ? Number(state.selectedManga.id) : 0;
  const manga = state.mangaList.find((item) => Number(item.id) === id) || null;

  if (!Number.isFinite(previousId) || previousId !== id) {
    state.sourceProvider = "";
    state.sourceInput = "";
    state.sourceManga = null;
    state.sourceRows = [];
    state.sourceGroupPriority = [];
    if (el.sourceLink) {
      el.sourceLink.value = "";
    }
    setSourceStatus("Chưa tải chapter từ nguồn ngoài.");
    setSourcePriorityPopoverVisible(false);
    renderSourceRows();
    renderSourcePriorityList();
  }

  state.selectedManga = manga;
  renderMangaList();
  updateSelectedMangaLabel();

  if (!manga) {
    state.existingChapterMap = new Map();
    applyConflictState();
    renderChapterTable();
    setChapterTableLoading(false);
    return;
  }

  logLine(`Đang lấy dữ liệu truyện ${manga.title}...`);
  await loadExistingChaptersForSelectedManga(`Đang tải chapter của ${manga.title}...`);
  logLine(`Đã lấy dữ liệu truyện ${manga.title} (${state.existingChapterMap.size} chapter trên server).`);
  if (state.chapterRows.length) {
    const conflictCount = state.chapterRows.filter((row) => row && row.conflict).length;
    logLine(`Đã đối chiếu ${state.chapterRows.length} chapter trong thư mục (trùng: ${conflictCount}).`);
  }
}

async function apiRequest(route, options = {}) {
  if (!state.endpoint) {
    throw new Error("Endpoint API đang để trống");
  }

  const method = (options.method || "GET").toString().toUpperCase();
  const timeoutMs = Math.max(1000, Math.floor(Number(options.timeoutMs) || 120000));
  const requestPayload = {
    endpoint: state.endpoint,
    route,
    method,
    timeoutMs,
    apiKey: state.apiKey
  };

  if (options.jsonBody && typeof options.jsonBody === "object") {
    requestPayload.jsonBody = options.jsonBody;
  }

  if (options.pageUpload && typeof options.pageUpload === "object") {
    const pageUpload = options.pageUpload;
    const pageBuffer = pageUpload.buffer;
    if (!pageBuffer) {
      throw new Error("Thiếu dữ liệu ảnh để upload");
    }

    requestPayload.pageUpload = {
      pageIndex: pageUpload.pageIndex,
      fileName: pageUpload.fileName || "page.webp",
      fileBase64: Buffer.from(pageBuffer).toString("base64")
    };
  }

  const result = await ipcRenderer.invoke("desktop:api-request", requestPayload).catch(() => null);
  if (!result || result.ok !== true || !result.data || result.data.ok !== true) {
    const message =
      (result && result.error ? String(result.error) : "").trim() ||
      "Không thể kết nối API server";
    const error = new Error(message);
    error.statusCode = result && Number.isFinite(Number(result.status)) ? Number(result.status) : 0;
    const retryAfterMs = result && Number.isFinite(Number(result.retryAfterMs))
      ? Math.max(0, Math.floor(Number(result.retryAfterMs)))
      : 0;
    if (retryAfterMs > 0) {
      error.retryAfterMs = retryAfterMs;
    }
    error.payload = result && result.data ? result.data : null;
    error.debug = result && result.debug && typeof result.debug === "object"
      ? result.debug
      : null;
    throw error;
  }

  return result.data;
}

async function uploadPageToPresignedUrl({ uploadUrl, buffer, timeoutMs, headers }) {
  const headerMap = headers && typeof headers === "object" ? headers : null;
  const headerContentType = headerMap && Object.prototype.hasOwnProperty.call(headerMap, "Content-Type")
    ? String(headerMap["Content-Type"] || "").trim()
    : "";

  const payload = {
    uploadUrl: (uploadUrl || "").toString().trim(),
    fileBase64: Buffer.from(buffer || Buffer.alloc(0)).toString("base64"),
    contentType: headerContentType || "image/webp",
    headers: headerMap,
    timeoutMs: Math.max(1000, Math.floor(Number(timeoutMs) || SOURCE_PAGE_TIMEOUT_MS))
  };

  const result = await ipcRenderer.invoke("desktop:upload-presigned", payload).catch(() => null);
  if (!result || result.ok !== true) {
    const message =
      (result && result.error ? String(result.error) : "").trim() ||
      "Không thể upload trực tiếp lên storage";
    const error = new Error(message);
    error.statusCode = result && Number.isFinite(Number(result.status)) ? Number(result.status) : 0;
    error.payload = result && result.data ? result.data : null;
    error.debug = result && result.debug && typeof result.debug === "object"
      ? result.debug
      : null;
    throw error;
  }

  return result.data || null;
}

async function withRetry(task, retries, onRetry, options = {}) {
  const maxRetries = Math.max(0, Math.floor(Number(retries) || 0));
  const shouldRetry = typeof options.shouldRetry === "function"
    ? options.shouldRetry
    : isRetriableRequestError;
  const baseDelayMs = Math.max(120, Math.floor(Number(options.baseDelayMs) || RETRY_BASE_DELAY_MS));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(Number(options.maxDelayMs) || RETRY_MAX_DELAY_MS));
  const jitterRatio = Number.isFinite(Number(options.jitterRatio))
    ? Math.min(0.9, Math.max(0, Number(options.jitterRatio)))
    : RETRY_JITTER_RATIO;

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      const currentAttempt = attempt + 1;
      const canRetry = attempt < maxRetries && shouldRetry(err, currentAttempt);
      if (!canRetry) break;

      const retryAfterMs = extractRetryAfterMs(err);
      const delayMs = computeRetryDelayMs({
        attempt: currentAttempt,
        retryAfterMs,
        baseDelayMs,
        maxDelayMs,
        jitterRatio
      });

      if (typeof onRetry === "function") {
        onRetry(currentAttempt, err, { delayMs, retryAfterMs });
      }

      await sleep(delayMs);
    }
  }
  throw lastError || new Error("Tác vụ thất bại");
}

async function findChapterOnServer({ mangaId, chapterNumber, timeoutMs = 45000 }) {
  const safeMangaId = Number(mangaId);
  const targetKey = chapterNumberKey(chapterNumber);
  if (!Number.isFinite(safeMangaId) || safeMangaId <= 0 || !targetKey) {
    return null;
  }

  const payload = await apiRequest(`/v1/manga/${encodeURIComponent(String(Math.floor(safeMangaId)))}/chapters`, {
    method: "GET",
    timeoutMs: Math.max(10000, Math.floor(Number(timeoutMs) || 45000))
  });
  const chapters = Array.isArray(payload && payload.chapters) ? payload.chapters : [];
  return chapters.find((chapter) => {
    const number = chapter && chapter.number != null ? Number(chapter.number) : NaN;
    return Number.isFinite(number) && chapterNumberKey(number) === targetKey;
  }) || null;
}

function canRecoverCompleteByChapterSnapshot({ chapter, startPayload, totalPages }) {
  if (!chapter || typeof chapter !== "object") return false;
  const payload = startPayload && typeof startPayload === "object" ? startPayload : {};

  const expectedPrefix = (payload.targetPrefix || "").toString().trim();
  const actualPrefix = (chapter.pagesPrefix || "").toString().trim();
  if (!expectedPrefix || !actualPrefix || expectedPrefix !== actualPrefix) {
    return false;
  }

  const expectedPages = Math.max(0, Math.floor(Number(totalPages) || 0));
  const actualPages = Number(chapter.pages);
  if (expectedPages > 0 && (!Number.isFinite(actualPages) || Math.floor(actualPages) !== expectedPages)) {
    return false;
  }

  const expectedFilePrefix = (payload.pageFilePrefix || payload.pagesFilePrefix || "").toString().trim();
  const actualFilePrefix = (chapter.pagesFilePrefix || chapter.pageFilePrefix || "").toString().trim();
  if (expectedFilePrefix && actualFilePrefix && expectedFilePrefix !== actualFilePrefix) {
    return false;
  }

  return true;
}

async function waitForRecoveredChapterSnapshot({
  mangaId,
  chapterNumber,
  startPayload,
  totalPages,
  waitMs = 30000,
  intervalMs = 2500
}) {
  const safeWaitMs = Math.max(3000, Math.floor(Number(waitMs) || 30000));
  const safeIntervalMs = Math.max(500, Math.floor(Number(intervalMs) || 2500));
  const deadlineAt = Date.now() + safeWaitMs;

  while (true) {
    const chapter = await findChapterOnServer({
      mangaId,
      chapterNumber,
      timeoutMs: Math.max(10000, Math.min(45000, safeIntervalMs * 2))
    }).catch(() => null);

    const recovered = canRecoverCompleteByChapterSnapshot({
      chapter,
      startPayload,
      totalPages
    });
    if (recovered) {
      return chapter;
    }

    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await sleep(Math.min(safeIntervalMs, remainingMs));
  }

  return null;
}

async function authenticate(endpoint, apiKey) {
  state.endpoint = endpoint;
  state.apiKey = apiKey;

  state.mangaLoading = true;
  renderMangaList();

  try {
    const payload = await apiRequest("/v1/bootstrap", { method: "GET", timeoutMs: 30000 });
    state.account = payload.account || null;
    state.mangaList = Array.isArray(payload.manga) ? payload.manga : [];
    state.authenticated = true;
  } finally {
    state.mangaLoading = false;
  }

  renderAccount();
  renderMangaList();
  updateServerLabel();

  if (!state.selectedManga || !state.mangaList.some((item) => Number(item.id) === Number(state.selectedManga.id))) {
    if (state.mangaList.length) {
      await selectMangaById(state.mangaList[0].id);
    } else {
      state.selectedManga = null;
      updateSelectedMangaLabel();
      state.existingChapterMap = new Map();
      applyConflictState();
      renderChapterTable();
    }
  }
}

async function fetchSourceChapterList() {
  if (state.uploadRunning || state.authBusy || state.sourceUploading) return;

  const sourceInput = el.sourceLink ? String(el.sourceLink.value || "").trim() : "";
  if (!sourceInput) {
    setSourceStatus("Vui lòng paste link hoặc id truyện/chương trước khi lấy chapter.", true);
    return;
  }

  const detectedProvider = normalizeSourceProvider(detectSourceProviderFromInput(sourceInput));
  if (!detectedProvider) {
    state.sourceProvider = "";
    setSourceStatus("Không thể nhận diện nguồn từ link/ID. Hãy dùng link MangaDex hoặc WeebDex hợp lệ.", true);
    return;
  }

  state.sourceProvider = detectedProvider;

  state.sourceLoading = true;
  state.sourceInput = sourceInput;
  setControlsDisabled(true);
  setSourceStatus(`Đang lấy chapter tiếng Việt từ ${getSourceProviderLabel(state.sourceProvider)}...`);
  if (el.sourceFetchBtn) {
    setButtonLabel(el.sourceFetchBtn, "fa-solid fa-spinner fa-spin", "Đang tải chapter...");
  }

  try {
    const payload = await sourceResolveManga({
      provider: state.sourceProvider,
      input: sourceInput,
      translatedLanguages: ["vi"]
    });

    const manga = payload && payload.manga && typeof payload.manga === "object" ? payload.manga : null;
    const chapterEntries = Array.isArray(payload && payload.chapters) ? payload.chapters : [];
    state.sourceManga = manga;
    let filteredExistingCount = 0;
    state.sourceRows = chapterEntries.map((entry, index) => {
      const releases = Array.isArray(entry && entry.releases)
        ? entry.releases.map((release) => ({ ...release }))
        : [];
      const selectedRelease = releases.find((release) => String(release.id) === String(entry.selectedReleaseId || ""))
        || releases[0]
        || null;

      const chapterNumber = Number.isFinite(Number(entry && entry.chapterNumber))
        ? Number(entry.chapterNumber)
        : parseChapterNumber(selectedRelease && selectedRelease.chapterRaw ? selectedRelease.chapterRaw : entry && entry.chapterNumberText);

      const chapterHasNumber = Number.isFinite(chapterNumber);

      const formattedChapterNumber = formatChapterNumber(chapterNumber);
      const chapterNumberText = entry && entry.chapterNumberText
        ? String(entry.chapterNumberText)
        : (formattedChapterNumber || `Chưa rõ (${index + 1})`);
      const chapterInput = chapterHasNumber
        ? (formattedChapterNumber || chapterNumberText)
        : "";

      return {
        id: String(entry && entry.id ? entry.id : `source-${Date.now()}-${index}`),
        chapterNumber,
        chapterNumberText,
        chapterInput,
        requiresManualChapterNumber: Boolean(entry && entry.requiresManualChapterNumber) || !chapterHasNumber,
        volumeText: entry && entry.volumeText ? String(entry.volumeText) : "",
        selectedReleaseId: selectedRelease ? String(selectedRelease.id) : "",
        customTitle: selectedRelease && selectedRelease.title
          ? String(selectedRelease.title)
          : (entry && entry.title ? String(entry.title) : ""),
        enabled: true,
        releases,
        isUploading: false,
        isDone: false,
        isSkipped: false,
        isFailed: false,
        errorMessage: "",
        uploadedCount: 0,
        totalCount: 0
      };
    }).filter((row) => {
      if (!Number.isFinite(Number(row.chapterNumber))) {
        return true;
      }
      const key = chapterNumberKey(Number(row.chapterNumber));
      if (!key) return true;
      const exists = state.existingChapterMap.has(key);
      if (exists) {
        filteredExistingCount += 1;
      }
      return !exists;
    });

    ensureSourceGroupPriority();
    applySourcePriorityToRows();

    state.sourceRows.sort((a, b) => {
      const aNum = Number(a && a.chapterNumber);
      const bNum = Number(b && b.chapterNumber);
      const aFinite = Number.isFinite(aNum);
      const bFinite = Number.isFinite(bNum);

      if (aFinite && bFinite) {
        const diff = aNum - bNum;
        if (Math.abs(diff) > 1e-9) return diff;
      } else if (aFinite) {
        return -1;
      } else if (bFinite) {
        return 1;
      }

      const aText = String(a && a.chapterNumberText ? a.chapterNumberText : "");
      const bText = String(b && b.chapterNumberText ? b.chapterNumberText : "");
      return collator.compare(aText, bText);
    });

    renderSourceRows();
    renderSourcePriorityList();

    const sourceLabel = getSourceProviderLabel(state.sourceProvider);
    const mangaTitle = manga && manga.title ? String(manga.title) : "(không rõ tên)";
    const fallbackUsed = Boolean(payload && payload.languageFallbackUsed);
    const requestedLanguages = Array.isArray(payload && payload.requestedLanguages) ? payload.requestedLanguages : [];
    const missingChapterNumberCount = state.sourceRows.filter((row) => !Number.isFinite(Number(row && row.chapterNumber))).length;
    const manualNumberHint = missingChapterNumberCount > 0
      ? ` • Có ${missingChapterNumberCount} chapter chưa có số, hãy nhập ở cột Chap trước khi upload.`
      : "";

    if (fallbackUsed) {
      setSourceStatus(
        `Không có chapter khớp ngôn ngữ ${requestedLanguages.join(", ") || "vi"}. Đã fallback tất cả ngôn ngữ: ${state.sourceRows.length} chapter mới (${filteredExistingCount} chapter trùng đã ẩn) cho ${sourceLabel}: ${mangaTitle}${manualNumberHint}`
      );
      logLine(
        `Nguồn ${sourceLabel}: fallback all-language, nạp ${state.sourceRows.length} chapter mới và ẩn ${filteredExistingCount} chapter đã có cho truyện ${mangaTitle}.${manualNumberHint ? " Cần nhập số chapter còn thiếu trước khi upload." : ""}`,
        true
      );
    } else {
      setSourceStatus(`Đã tải ${state.sourceRows.length} chapter mới từ ${sourceLabel}: ${mangaTitle} (ẩn ${filteredExistingCount} chapter đã có)${manualNumberHint}`);
      logLine(`Nguồn ${sourceLabel}: đã lấy ${state.sourceRows.length} chapter mới, ẩn ${filteredExistingCount} chapter đã có cho truyện ${mangaTitle}.${manualNumberHint ? " Cần nhập số chapter còn thiếu trước khi upload." : ""}`);
    }
  } catch (err) {
    const message = (err && err.message) ? String(err.message) : "Không thể lấy chapter từ nguồn ngoài.";
    state.sourceManga = null;
    state.sourceRows = [];
    state.sourceGroupPriority = [];
    renderSourceRows();
    renderSourcePriorityList();
    setSourceStatus(message, true);
    logErrorWithDebug("Lấy chapter nguồn ngoài thất bại", err);
  } finally {
    state.sourceLoading = false;
    setControlsDisabled(false);
    if (el.sourceFetchBtn) {
      setButtonLabel(el.sourceFetchBtn, "fa-solid fa-magnifying-glass", "Lấy danh sách chapter");
    }
    renderSourceRows();
  }
}

function resetAuthState() {
  state.apiKey = "";
  state.authenticated = false;
  state.account = null;
  state.mangaList = [];
  state.mangaLoading = false;
  state.selectedManga = null;
  state.activeUploadPane = "folder";
  state.sourceProvider = "";
  state.sourceManga = null;
  state.sourceRows = [];
  state.sourceGroupPriority = [];
  state.existingChapterMap = new Map();
  state.chapterRows = [];
  state.chapterTableLoading = false;
  state.sourceLoading = false;
  state.sourceUploading = false;

  renderAccount();
  renderMangaList();
  updateSelectedMangaLabel();
  renderChapterTable();
  renderSourceRows();
  renderUploadPanes();
  renderSourcePriorityList();
  setSourcePriorityPopoverVisible(false);
  setChapterTableLoading(false);
  updateServerLabel();
  setOverallProgress(0, 0, "Chưa upload.");
  setOverallBreakdown({ success: 0, failed: 0, skipped: 0 });
}

async function compressImageToWebp(filePath, options = {}) {
  const inputBuffer = await fsp.readFile(filePath);
  const metadata = await sharp(inputBuffer).metadata();
  const orientedWidth = Number(
    metadata && metadata.autoOrient && Number.isFinite(Number(metadata.autoOrient.width))
      ? metadata.autoOrient.width
      : metadata && metadata.width
  );
  const isWebtoonManga = Boolean(options && options.isWebtoon);

  let pipeline = sharp(inputBuffer).rotate();
  if (isWebtoonManga) {
    if (Number.isFinite(orientedWidth) && orientedWidth > WEBTOON_TARGET_WIDTH) {
      pipeline = pipeline.resize({
        width: WEBTOON_TARGET_WIDTH,
        withoutEnlargement: true
      });
    }
  } else {
    pipeline = pipeline.resize({
      height: CHAPTER_PAGE_MAX_HEIGHT,
      withoutEnlargement: true
    });
  }

  return pipeline
    .webp({ quality: CHAPTER_PAGE_WEBP_QUALITY, effort: 6 })
    .toBuffer();
}

async function performChapterUpload({
  mangaId,
  chapterNumber,
  title,
  overwrite,
  imagePaths,
  retryCount,
  parallelism,
  startTimeoutMs,
  pageUploadTimeoutMs,
  completeTimeoutMs,
  onRetry,
  onProgress
}) {
  const totalImages = Array.isArray(imagePaths) ? imagePaths.length : 0;
  if (!totalImages) {
    throw new Error("Chapter không có ảnh để upload");
  }

  const safeMangaId = Number(mangaId);
  if (!Number.isFinite(safeMangaId) || safeMangaId <= 0) {
    throw new Error("Chưa chọn truyện");
  }

  const safeParallelism = Math.max(1, Math.min(8, Math.floor(Number(parallelism) || PAGE_UPLOAD_PARALLELISM)));
  const safeStartTimeoutMs = Math.max(10000, Math.floor(Number(startTimeoutMs) || 30000));
  const safePageUploadTimeoutMs = Math.max(20000, Math.floor(Number(pageUploadTimeoutMs) || 180000));
  const safeCompleteTimeoutMs = Math.max(20000, Math.floor(Number(completeTimeoutMs) || 180000));

  const startPayload = await withRetry(
    () =>
      apiRequest("/v1/uploads/start", {
        method: "POST",
        jsonBody: {
          mangaId: safeMangaId,
          chapterNumber,
          title: title || "",
          overwrite: Boolean(overwrite),
          totalPages: totalImages
        },
        timeoutMs: safeStartTimeoutMs
      }),
    retryCount,
    (attempt, err, retryMeta) => {
      if (typeof onRetry === "function") {
        onRetry("start", attempt, err, { totalImages, ...(retryMeta || {}) });
      }
    },
    {
      baseDelayMs: 1200,
      maxDelayMs: 18000,
      jitterRatio: 0.4
    }
  );

  const sessionId = String(startPayload.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("Mã phiên upload không hợp lệ");
  }
  const isWebtoonManga = Boolean(startPayload && startPayload.isWebtoonManga);

  let completeRequestStarted = false;

  try {
    const workerCount = Math.max(1, Math.min(safeParallelism, totalImages));
    let nextImageIndex = 0;
    let uploadedCount = 0;
    let workerError = null;

    const uploadWorker = async (workerNo) => {
      while (true) {
        if (workerError) return;

        const currentIndex = nextImageIndex;
        nextImageIndex += 1;
        if (currentIndex >= totalImages) return;

        const pageNumber = currentIndex + 1;
        const sourceFilePath = imagePaths[currentIndex];

        try {
          const compressed = await withRetry(
            () => compressImageToWebp(sourceFilePath, { isWebtoon: isWebtoonManga }),
            retryCount,
            (attempt, err, retryMeta) => {
              if (typeof onRetry === "function") {
                onRetry("compress", attempt, err, { pageNumber, totalImages, workerNo, ...(retryMeta || {}) });
              }
            },
            {
              baseDelayMs: 300,
              maxDelayMs: 2500,
              jitterRatio: 0.2,
              shouldRetry: isRetriableCompressionError
            }
          );

          if (workerError) return;

          await withRetry(
            async () => {
              const presignPayload = await apiRequest(`/v1/uploads/${encodeURIComponent(sessionId)}/pages/presign`, {
                method: "POST",
                jsonBody: {
                  pageIndex: pageNumber
                },
                timeoutMs: safePageUploadTimeoutMs
              });

              const uploadUrl = presignPayload && presignPayload.uploadUrl
                ? String(presignPayload.uploadUrl).trim()
                : "";
              const uploadHeaders = presignPayload && presignPayload.headers && typeof presignPayload.headers === "object"
                ? presignPayload.headers
                : null;
              if (!uploadUrl) {
                throw new Error("Không nhận được đường dẫn upload trực tiếp từ server");
              }

              const uploadResult = await uploadPageToPresignedUrl({
                uploadUrl,
                buffer: compressed,
                headers: uploadHeaders,
                timeoutMs: safePageUploadTimeoutMs
              });

              const uploadedEtag = uploadResult && uploadResult.etag
                ? String(uploadResult.etag).trim()
                : "";

              await apiRequest(`/v1/uploads/${encodeURIComponent(sessionId)}/pages/ack`, {
                method: "POST",
                jsonBody: {
                  pageIndex: pageNumber,
                  ...(uploadedEtag ? { etag: uploadedEtag } : {})
                },
                timeoutMs: safePageUploadTimeoutMs
              });
            },
            retryCount,
            (attempt, err, retryMeta) => {
              if (typeof onRetry === "function") {
                onRetry("upload", attempt, err, { pageNumber, totalImages, workerNo, ...(retryMeta || {}) });
              }
            },
            {
              baseDelayMs: 1400,
              maxDelayMs: 25000,
              jitterRatio: 0.45
            }
          );

          uploadedCount += 1;
          if (typeof onProgress === "function") {
            onProgress(uploadedCount, totalImages);
          }

          if (PAGE_UPLOAD_COOLDOWN_MS > 0) {
            await sleep(PAGE_UPLOAD_COOLDOWN_MS);
          }
        } catch (err) {
          if (!workerError) {
            workerError = err instanceof Error ? err : new Error("Upload ảnh thất bại");
          }
          return;
        }
      }
    };

    await Promise.all(
      Array.from({ length: workerCount }, (_value, index) => uploadWorker(index + 1))
    );

    if (workerError) {
      throw workerError;
    }

    let donePayload = null;
    try {
      completeRequestStarted = true;
      donePayload = await apiRequest(`/v1/uploads/${encodeURIComponent(sessionId)}/complete`, {
        method: "POST",
        jsonBody: {},
        timeoutMs: safeCompleteTimeoutMs
      });
    } catch (err) {
      const statusCode = extractErrorStatusCode(err);
      const shouldTryRecover = statusCode === 0 || statusCode >= 500 || statusCode === 404;
      if (shouldTryRecover) {
        if (typeof onRetry === "function") {
          onRetry("complete", 1, err, { totalImages, delayMs: 0, retryAfterMs: 0 });
        }

        const chapter = await waitForRecoveredChapterSnapshot({
          mangaId: safeMangaId,
          chapterNumber,
          startPayload,
          totalPages: totalImages,
          waitMs: Math.max(15000, safeCompleteTimeoutMs),
          intervalMs: 2500
        });
        if (chapter) {
          return chapter;
        }
      }
      throw err;
    }

    return donePayload && donePayload.chapter ? donePayload.chapter : null;
  } catch (err) {
    if (!completeRequestStarted) {
      await apiRequest(`/v1/uploads/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        jsonBody: {}
      }).catch(() => null);
    }
    throw err;
  }
}

async function uploadChapterRow({ row, retryCount, onImageProgress }) {
  const mangaId = Number(state.selectedManga && state.selectedManga.id);
  if (!Number.isFinite(mangaId) || mangaId <= 0) {
    throw new Error("Chưa chọn truyện");
  }

  const totalImages = row.imagePaths.length;
  if (!totalImages) {
    throw new Error("Thư mục chapter không có ảnh");
  }

  updateRowUploadState(row.id, {
    totalCount: totalImages,
    uploadedCount: 0,
    isUploading: true,
    isFailed: false,
    isDone: false,
    isSkipped: false
  });
  const chapter = await performChapterUpload({
    mangaId,
    chapterNumber: row.chapterNumber,
    title: row.title || "",
    overwrite: row.action === "overwrite",
    imagePaths: row.imagePaths,
    retryCount,
    onRetry: (stage, attempt, err, context) => {
      const delayHint = formatRetryDelayHint(context);
      if (stage === "start") {
        logLine(
          `Chapter ${row.chapterNumberText}: thử lại khởi tạo lần ${attempt} (${(err && err.message) || "lỗi"}${delayHint})`,
          true
        );
        return;
      }
      if (stage === "compress") {
        const pageNumber = context && context.pageNumber ? context.pageNumber : 0;
        const totalCount = context && context.totalImages ? context.totalImages : totalImages;
        const workerNo = context && context.workerNo ? context.workerNo : 0;
        logLine(
          `Chapter ${row.chapterNumberText}: thử lại nén ảnh ${pageNumber}/${totalCount} (luồng ${workerNo}) lần ${attempt} (${(err && err.message) || "lỗi"}${delayHint})`,
          true
        );
        return;
      }
      if (stage === "upload") {
        const pageNumber = context && context.pageNumber ? context.pageNumber : 0;
        const totalCount = context && context.totalImages ? context.totalImages : totalImages;
        const workerNo = context && context.workerNo ? context.workerNo : 0;
        logLine(
          `Chapter ${row.chapterNumberText}: thử lại upload ảnh ${pageNumber}/${totalCount} (luồng ${workerNo}) lần ${attempt} (${(err && err.message) || "lỗi"}${delayHint})`,
          true
        );
        return;
      }
      if (stage === "complete") {
        logLine(
          `Chapter ${row.chapterNumberText}: thử lại hoàn tất lần ${attempt} (${(err && err.message) || "lỗi"}${delayHint})`,
          true
        );
      }
    },
    onProgress: (uploadedCount, totalCount) => {
      const delta = Math.max(0, Number(uploadedCount) - Math.max(0, Number(row.uploadedCount || 0)));
      updateRowUploadState(row.id, {
        uploadedCount,
        totalCount,
        isUploading: true,
        isFailed: false,
        isDone: false,
        isSkipped: false
      });
      if (delta > 0 && typeof onImageProgress === "function") {
        onImageProgress(delta);
      }
    }
  });

  updateRowUploadState(row.id, {
    uploadedCount: totalImages,
    totalCount: totalImages,
    isUploading: false,
    isFailed: false,
    isDone: true,
    isSkipped: false,
    enabled: false
  });
  if (chapter && chapter.number != null) {
    state.existingChapterMap.set(chapterNumberKey(Number(chapter.number)), chapter);
  }
  return { ok: true };
}

async function uploadSourceRow(rowId) {
  if (state.uploadRunning || state.authBusy || state.sourceUploading || state.sourceLoading) return;

  const targetManga = state.selectedManga;
  if (!targetManga) {
    throw new Error("Vui lòng chọn truyện đích ở panel bên trái trước khi kéo chapter.");
  }
  const targetMangaId = Number(targetManga.id);
  if (!Number.isFinite(targetMangaId) || targetMangaId <= 0) {
    throw new Error("Truyện đích không hợp lệ để upload.");
  }

  const provider = normalizeSourceProvider(state.sourceProvider);
  if (!provider) {
    throw new Error("Chưa nhận diện được nguồn chapter. Vui lòng nhập link MangaDex/WeebDex hợp lệ rồi tải lại danh sách.");
  }

  const row = state.sourceRows.find((item) => item && item.id === rowId);
  if (!row) {
    throw new Error("Không tìm thấy chapter nguồn đã chọn.");
  }

  const release = getSourceSelectedRelease(row);
  if (!release || !release.id) {
    throw new Error("Chapter chưa có bản dịch hợp lệ để tải.");
  }

  const chapterNumber = Number.isFinite(row.chapterNumber)
    ? row.chapterNumber
    : parseChapterNumber(release.chapterRaw || row.chapterInput || row.chapterNumberText);

  if (!Number.isFinite(chapterNumber)) {
    throw new Error("Chapter nguồn chưa có số chapter hợp lệ. Vui lòng nhập ở cột Chap trước khi upload.");
  }

  row.chapterNumber = chapterNumber;
  row.chapterNumberText = formatChapterNumber(chapterNumber) || String(chapterNumber);
  row.chapterInput = row.chapterNumberText;
  row.requiresManualChapterNumber = false;

  const conflictKey = chapterNumberKey(chapterNumber);
  const existing = conflictKey ? state.existingChapterMap.get(conflictKey) : null;

  if (existing) {
    row.enabled = false;
    row.isDone = false;
    row.isUploading = false;
    row.isSkipped = true;
    row.isFailed = false;
    row.errorMessage = "";
    renderSourceRows();
    logLine(`Bỏ qua chapter ${row.chapterNumberText}: đã tồn tại trên server.`, true);
    setOverallProgress(1, 1, `Bỏ qua chapter ${row.chapterNumberText} vì đã tồn tại.`);
    setOverallBreakdown({ success: 0, failed: 0, skipped: 1 });
    return;
  }

  const retryCount = readIntegerInputValue(el.retryCount, DEFAULT_RETRY_COUNT);

  row.isUploading = true;
  row.isDone = false;
  row.isSkipped = false;
  row.isFailed = false;
  row.errorMessage = "";
  row.uploadedCount = 0;
  row.totalCount = 0;
  state.sourceUploading = true;
  setControlsDisabled(true);
  setOverallProgress(0, 1, `Đang tải ảnh chapter ${row.chapterNumberText}...`);
  setOverallBreakdown({ success: 0, failed: 0, skipped: 0 });
  renderSourceRows();

  let tempDir = "";
  try {
    const sourceLabel = getSourceProviderLabel(provider);
    logLine(`Đang tải chapter ${row.chapterNumberText} từ ${sourceLabel}...`);

    const download = await sourceDownloadChapter({
      provider,
      chapterId: release.id,
      chapterNumberText: row.chapterNumberText,
      chapterTitle: row.customTitle || release.title || "",
      preferDataSaver: provider === "mangadex"
    });

    tempDir = String(download.tempDir || "").trim();
    const imagePaths = Array.isArray(download.imagePaths) ? download.imagePaths : [];
    if (!imagePaths.length) {
      throw new Error("Không có ảnh sau khi tải chapter nguồn.");
    }

    if (provider === "mangadex" && download && download.imageSourceStats && typeof download.imageSourceStats === "object") {
      const stats = download.imageSourceStats;
      const originalUsedCount = Number(stats.originalUsedCount) || 0;
      const runtimeUsedCount = Number(stats.runtimeUsedCount) || 0;
      const dataSaverUsedCount = Number(stats.dataSaverUsedCount) || 0;
      logLine(
        `Nguồn ${row.chapterNumberText}: nguồn ảnh đã dùng -> original:${originalUsedCount}, runtime:${runtimeUsedCount}, data-saver:${dataSaverUsedCount}.`
      );
      if (dataSaverUsedCount > 0) {
        logLine(
          `Nguồn ${row.chapterNumberText}: đã phải fallback sang data-saver ${dataSaverUsedCount} trang (có thể ảnh nhỏ hơn).`,
          true
        );
      }
    }

    row.totalCount = imagePaths.length;
    renderSourceRows();

    setOverallProgress(0, 1, `Đang upload chapter ${row.chapterNumberText} (${imagePaths.length} ảnh)...`);
    logLine(
      `Nguồn ${row.chapterNumberText}: bắt đầu upload (song song ${SOURCE_PAGE_UPLOAD_PARALLELISM}, timeout start ${Math.round(SOURCE_START_TIMEOUT_MS / 1000)}s, page ${Math.round(SOURCE_PAGE_TIMEOUT_MS / 1000)}s).`
    );

    const uploadedChapter = await performChapterUpload({
      mangaId: targetMangaId,
      chapterNumber,
      title: row.customTitle || release.title || "",
      overwrite: false,
      imagePaths,
      retryCount,
      parallelism: SOURCE_PAGE_UPLOAD_PARALLELISM,
      startTimeoutMs: SOURCE_START_TIMEOUT_MS,
      pageUploadTimeoutMs: SOURCE_PAGE_TIMEOUT_MS,
      completeTimeoutMs: SOURCE_COMPLETE_TIMEOUT_MS,
      onRetry: (stage, attempt, err, context) => {
        const delayHint = formatRetryDelayHint(context);
        if (stage === "start") {
          logLine(
            `Nguồn ${row.chapterNumberText}: thử lại khởi tạo lần ${attempt} (${(err && err.message) || "lỗi"}${delayHint})`,
            true
          );
          return;
        }
        if (stage === "compress") {
          const pageNumber = context && context.pageNumber ? context.pageNumber : 0;
          const totalImages = context && context.totalImages ? context.totalImages : imagePaths.length;
          logLine(
            `Nguồn ${row.chapterNumberText}: thử lại nén ảnh ${pageNumber}/${totalImages} lần ${attempt} (${(err && err.message) || "lỗi"}${delayHint})`,
            true
          );
          return;
        }
        if (stage === "upload") {
          const pageNumber = context && context.pageNumber ? context.pageNumber : 0;
          const totalImages = context && context.totalImages ? context.totalImages : imagePaths.length;
          logLine(
            `Nguồn ${row.chapterNumberText}: thử lại upload ảnh ${pageNumber}/${totalImages} lần ${attempt} (${(err && err.message) || "lỗi"}${delayHint})`,
            true
          );
          return;
        }
        if (stage === "complete") {
          logLine(
            `Nguồn ${row.chapterNumberText}: thử lại hoàn tất lần ${attempt} (${(err && err.message) || "lỗi"}${delayHint})`,
            true
          );
        }
      },
      onProgress: (uploadedCount, totalCount) => {
        row.uploadedCount = uploadedCount;
        row.totalCount = totalCount;
        row.isUploading = true;
        setOverallProgress(
          uploadedCount,
          Math.max(1, totalCount),
          `Đang upload chapter ${row.chapterNumberText} (${uploadedCount}/${totalCount})`
        );
        renderSourceRows();
      }
    });

    if (uploadedChapter && uploadedChapter.number != null) {
      state.existingChapterMap.set(chapterNumberKey(Number(uploadedChapter.number)), uploadedChapter);
    }

    row.isUploading = false;
    row.isDone = true;
    row.isSkipped = false;
    row.isFailed = false;
    row.enabled = false;
    row.errorMessage = "";
    row.uploadedCount = row.totalCount;
    setOverallProgress(1, 1, `Đã đẩy chapter ${row.chapterNumberText} lên API server.`);
    setOverallBreakdown({ success: 1, failed: 0, skipped: 0 });
    renderSourceRows();
    logLine(`Đã kéo chapter ${row.chapterNumberText} từ ${sourceLabel} lên API server thành công.`);
  } catch (err) {
    row.isUploading = false;
    row.isDone = false;
    row.isSkipped = false;
    row.isFailed = true;
    row.errorMessage = (err && err.message) ? String(err.message) : "Không rõ lỗi";
    setOverallProgress(1, 1, `Kéo chapter ${row.chapterNumberText} thất bại.`);
    setOverallBreakdown({ success: 0, failed: 1, skipped: 0 });
    renderSourceRows();
    logErrorWithDebug(`Kéo chapter ${row.chapterNumberText} thất bại`, err);
    throw err;
  } finally {
    state.sourceUploading = false;
    setControlsDisabled(false);

    if (tempDir) {
      try {
        await fsp.rm(tempDir, { recursive: true, force: true });
      } catch (_cleanupErr) {
        // ignore cleanup error
      }
    }
  }
}

async function uploadSelectedSourceRows() {
  if (state.uploadRunning || state.authBusy || state.sourceLoading || state.sourceUploading) return;

  const queue = getEnabledSourceRows();
  if (!queue.length) {
    logLine("Chưa chọn chapter nguồn nào để upload.", true);
    return;
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;

  setOverallProgress(0, queue.length, `Bắt đầu upload ${queue.length} chapter nguồn...`);
  setOverallBreakdown({ success: 0, failed: 0, skipped: 0 });

  for (let index = 0; index < queue.length; index += 1) {
    const row = queue[index];
    const current = index + 1;

    try {
      await uploadSourceRow(row.id);
      if (row.isSkipped) {
        skipped += 1;
      } else {
        success += 1;
      }
    } catch (_err) {
      failed += 1;
    }

    setOverallProgress(current, queue.length, `Đã xử lý ${current}/${queue.length} chapter nguồn`);
    setOverallBreakdown({ success, failed, skipped });
  }

  const summary = `Nguồn ngoài: ${success} thành công, ${failed} thất bại, ${skipped} bỏ qua.`;
  logLine(summary, failed > 0);
  setOverallProgress(queue.length, queue.length, summary);
}

async function startBulkUpload() {
  if (state.uploadRunning || state.authBusy) return;
  if (!state.selectedManga) {
    logLine("Hãy chọn truyện trước khi upload.", true);
    return;
  }
  if (!state.parentFolder) {
    logLine("Hãy chọn thư mục mẹ trước khi upload.", true);
    return;
  }

  const retryCount = readIntegerInputValue(el.retryCount, DEFAULT_RETRY_COUNT);
  const delayMs = readIntegerInputValue(el.delayMs, DEFAULT_DELAY_MS);

  state.chapterRows.forEach((row) => {
    row.totalCount = Math.max(0, Number(row.imagePaths && row.imagePaths.length) || 0);
    row.uploadedCount = 0;
    row.isUploading = false;
    row.isDone = false;
    row.isSkipped = false;
    row.isFailed = Boolean(row.exceedsLimit);
  });

  const queue = state.chapterRows.filter((row) => {
    if (!row.enabled) return false;
    if (!Array.isArray(row.imagePaths) || !row.imagePaths.length) return false;
    if (row.exceedsLimit) return false;
    if (row.conflict && row.action !== "overwrite") return false;
    return true;
  });

  const skippedByConflict = state.chapterRows.filter((row) => row.enabled && row.conflict && row.action === "skip");
  skippedByConflict.forEach((row) => {
    row.isSkipped = true;
    row.isUploading = false;
    row.isDone = false;
    row.isFailed = false;
    row.uploadedCount = 0;
  });
  renderChapterTable();

  if (!queue.length) {
    logLine("Không có chapter hợp lệ để upload.", true);
    setOverallProgress(0, 0, "Không có chapter để upload");
    setOverallBreakdown({ success: 0, failed: 0, skipped: skippedByConflict.length });
    return;
  }

  const totalImagesInQueue = queue.reduce((sum, row) => {
    const count = Math.max(0, Number(Array.isArray(row && row.imagePaths) ? row.imagePaths.length : 0) || 0);
    return sum + count;
  }, 0);
  let uploadedImages = 0;

  state.uploadRunning = true;
  setControlsDisabled(true);
  setOverallProgress(0, Math.max(1, totalImagesInQueue), "Đang bắt đầu upload...");
  setOverallBreakdown({ success: 0, failed: 0, skipped: skippedByConflict.length });

  let successCount = 0;
  let failedCount = 0;

  try {
    for (let index = 0; index < queue.length; index += 1) {
      const row = queue[index];
      const chapterOrder = index + 1;
      logLine(`Bắt đầu chapter ${row.chapterNumberText} (${chapterOrder}/${queue.length})`);

      try {
        await uploadChapterRow({
          row,
          retryCount,
          onImageProgress: (delta) => {
            uploadedImages += Math.max(0, Number(delta) || 0);
            setOverallProgress(
              uploadedImages,
              Math.max(1, totalImagesInQueue),
              `Đang upload ảnh ${uploadedImages}/${totalImagesInQueue}`
            );
          }
        });
        successCount += 1;
        logLine(`Chapter ${row.chapterNumberText}: thành công`);
        setOverallBreakdown({
          success: successCount,
          failed: failedCount,
          skipped: skippedByConflict.length
        });
      } catch (err) {
        failedCount += 1;
        const message = (err && err.message) || "upload thất bại";
        updateRowUploadState(row.id, {
          isUploading: false,
          isFailed: true,
          isDone: false,
          isSkipped: false
        });
        setOverallProgress(
          uploadedImages,
          Math.max(1, totalImagesInQueue),
          `Đã xử lý ${chapterOrder}/${queue.length} chapter`
        );
        logLine(`Chapter ${row.chapterNumberText}: thất bại - ${message}`, true);
        setOverallBreakdown({
          success: successCount,
          failed: failedCount,
          skipped: skippedByConflict.length
        });
      }

      if (chapterOrder < queue.length && delayMs > 0) {
        setOverallProgress(
          uploadedImages,
          Math.max(1, totalImagesInQueue),
          `Chờ ${delayMs}ms trước chapter tiếp theo...`
        );
        await sleep(delayMs);
      }
    }

    const summary = `Xong: ${successCount} thành công, ${failedCount} thất bại, ${skippedByConflict.length} bỏ qua.`;
    logLine(summary, failedCount > 0);
    setOverallProgress(Math.max(1, totalImagesInQueue), Math.max(1, totalImagesInQueue), summary);
    setOverallBreakdown({
      success: successCount,
      failed: failedCount,
      skipped: skippedByConflict.length
    });
  } finally {
    state.uploadRunning = false;
    setControlsDisabled(false);
    renderChapterTable();
  }
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function handlePickParentFolder() {
  if (!state.authenticated || state.uploadRunning || state.authBusy) return;
  const picked = await ipcRenderer.invoke("desktop:pick-parent-folder").catch(() => "");
  const folder = (picked || "").toString().trim();
  if (!folder) return;

  state.parentFolder = folder;
  updateFolderPathLabel();

  try {
    await loadRowsFromParentFolder(folder);
    if (state.selectedManga) {
      await loadExistingChaptersForSelectedManga(`Đang cập nhật chapter của ${state.selectedManga.title}...`);
      logLine(`Đã đồng bộ chapter của ${state.selectedManga.title} sau khi chọn thư mục.`);
    }
  } catch (err) {
    logLine(`Không thể đọc thư mục: ${(err && err.message) || "không rõ"}`, true);
  }
}

async function handleReloadParentFolder() {
  if (!state.parentFolder) {
    logLine("Chưa có thư mục để tải lại.", true);
    return;
  }
  try {
    await loadRowsFromParentFolder(state.parentFolder);
    if (state.selectedManga) {
      await loadExistingChaptersForSelectedManga(`Đang cập nhật chapter của ${state.selectedManga.title}...`);
      logLine(`Đã cập nhật lại chapter của ${state.selectedManga.title}.`);
    }
  } catch (err) {
    logLine(`Tải lại thư mục thất bại: ${(err && err.message) || "không rõ"}`, true);
  }
}

async function handleLoadChapterTitleMapFromTxt() {
  if (!state.authenticated || state.uploadRunning || state.authBusy || state.sourceUploading || state.sourceLoading) return;
  const activePane = normalizeUploadPane(state.activeUploadPane);
  const isSourcePane = activePane === "source";
  const hasTargetRows = isSourcePane
    ? Array.isArray(state.sourceRows) && state.sourceRows.length > 0
    : Array.isArray(state.chapterRows) && state.chapterRows.length > 0;

  if (!hasTargetRows) {
    logLine("Chưa có danh sách chapter để nạp title.", true);
    return;
  }

  const picked = await ipcRenderer.invoke("desktop:pick-title-map-file").catch(() => "");
  const filePath = (picked || "").toString().trim();
  if (!filePath) return;

  let text = "";
  try {
    text = await fsp.readFile(filePath, "utf8");
  } catch (err) {
    logLine(`Không đọc được file title map: ${(err && err.message) || "không rõ"}`, true);
    return;
  }

  const map = new Map();
  const lines = text.split(/\r?\n/g);
  lines.forEach((line) => {
    const raw = (line || "").toString().trim();
    if (!raw || raw.startsWith("#")) return;
    const parsed = parseChapterNumberAndTitle(raw);
    if (!Number.isFinite(Number(parsed.chapterNumber))) return;
    const title = (parsed.title || "").trim();
    if (!title) return;
    map.set(chapterNumberKey(Number(parsed.chapterNumber)), title);
  });

  if (!map.size) {
    logLine("File .txt không có dòng hợp lệ theo định dạng: chap_title", true);
    return;
  }

  let appliedCount = 0;

  if (isSourcePane) {
    state.sourceRows.forEach((row) => {
      if (!row) return;
      const chapterNumber = Number.isFinite(Number(row.chapterNumber))
        ? Number(row.chapterNumber)
        : parseChapterNumber(row.chapterInput || row.chapterNumberText);
      if (!Number.isFinite(chapterNumber)) return;

      const key = chapterNumberKey(chapterNumber);
      if (!key || !map.has(key)) return;

      row.customTitle = map.get(key) || "";
      appliedCount += 1;
    });

    renderSourceRows();
    logLine(`Đã nạp title từ .txt cho ${appliedCount} chapter nguồn (${path.basename(filePath)}).`);
    return;
  }

  state.chapterRows.forEach((row) => {
    if (!row) return;
    const key = chapterNumberKey(row.chapterNumber);
    if (!key || !map.has(key)) return;
    row.title = map.get(key) || "";
    appliedCount += 1;
  });

  renderChapterTable();
  updateStartUploadButtonState();
  logLine(`Đã nạp title từ .txt cho ${appliedCount} chapter (${path.basename(filePath)}).`);
}

function clearLogBox() {
  if (!el.logBox) return;
  el.logBox.innerHTML = "";
}

function readLocalStorageText(key) {
  try {
    return (localStorage.getItem(key) || "").toString();
  } catch (_err) {
    return "";
  }
}

function writeLocalStorageText(key, value) {
  try {
    localStorage.setItem(key, (value == null ? "" : String(value)).trim());
  } catch (_err) {
    // ignore storage write errors
  }
}

function fillAuthInputsFromLocalStorage() {
  const cachedEndpoint = normalizeEndpoint(readLocalStorageText(STORAGE_ENDPOINT_KEY));
  const endpointValue = cachedEndpoint || state.endpoint;
  if (el.authEndpoint) {
    el.authEndpoint.value = endpointValue;
  }
}

async function handleHardRefresh() {
  if (!state.authenticated || state.uploadRunning || state.authBusy || state.sourceLoading || state.sourceUploading) return;

  state.authBusy = true;
  setControlsDisabled(true);
  if (el.hardRefreshBtn) {
    setButtonLabel(el.hardRefreshBtn, "fa-solid fa-spinner fa-spin", "Đang làm mới...");
  }

  try {
    clearLogBox();

    state.parentFolder = "";
    state.chapterRows = [];
    state.existingChapterMap = new Map();
    state.selectedManga = null;
    state.sourceManga = null;
    state.sourceRows = [];
    state.sourceGroupPriority = [];
    state.mangaList = [];
    state.mangaLoading = true;
    state.mangaSearch = "";

    if (el.mangaSearch) {
      el.mangaSearch.value = "";
    }

    updateFolderPathLabel();
    renderChapterTable();
    renderSourceRows();
    renderSourcePriorityList();
    setSourcePriorityPopoverVisible(false);
    renderMangaList();
    updateSelectedMangaLabel();
    setSourceStatus("Chưa tải chapter từ nguồn ngoài.");
    setOverallProgress(0, 0, "Đang làm mới dữ liệu...");
    setOverallBreakdown({ success: 0, failed: 0, skipped: 0 });

    await authenticate(state.endpoint, state.apiKey);

    setOverallProgress(0, 0, "Đã làm mới dữ liệu.");
    setOverallBreakdown({ success: 0, failed: 0, skipped: 0 });
    logLine("Đã làm mới danh sách truyện, bảng upload và nhật ký.");
  } catch (err) {
    const message = (err && err.message) || "không rõ";
    logLine(`Làm mới thất bại: ${message}`, true);
  } finally {
    state.authBusy = false;
    setControlsDisabled(false);
    if (el.hardRefreshBtn) {
      setButtonLabel(el.hardRefreshBtn, "fa-solid fa-rotate-right", "Làm mới");
    }
  }
}

function bindEvents() {
  fillAuthInputsFromLocalStorage();
  bindStrictIntegerInput(el.retryCount, DEFAULT_RETRY_COUNT);
  bindStrictIntegerInput(el.delayMs, DEFAULT_DELAY_MS);

  if (el.helpOpenBtn) {
    el.helpOpenBtn.addEventListener("click", () => {
      setHelpModalVisible(true);
    });
  }

  if (el.helpCloseBtn) {
    el.helpCloseBtn.addEventListener("click", () => {
      setHelpModalVisible(false);
    });
  }

  if (el.helpModal) {
    el.helpModal.addEventListener("click", (event) => {
      if (event.target === el.helpModal) {
        setHelpModalVisible(false);
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!event || event.key !== "Escape") return;
    if (el.helpModal && !el.helpModal.hidden) {
      setHelpModalVisible(false);
      return;
    }
    if (el.sourcePriorityPopover && !el.sourcePriorityPopover.hidden) {
      setSourcePriorityPopoverVisible(false);
    }
  });

  if (el.authForm) {
    el.authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.authBusy || state.uploadRunning) return;

      const endpointInput = el.authEndpoint ? el.authEndpoint.value : "";
      const apiKeyInput = el.authKey ? el.authKey.value : "";

      const endpoint = normalizeEndpoint(endpointInput);
      const apiKey = (apiKeyInput || "").toString().trim();

      if (!endpoint) {
        setAuthMessage("Endpoint không hợp lệ.", true);
        return;
      }
      if (!apiKey) {
        setAuthMessage("API key không được để trống.", true);
        return;
      }

      if (el.authEndpoint) {
        el.authEndpoint.value = endpoint;
      }

      state.authBusy = true;
      if (el.authSubmit) {
        el.authSubmit.disabled = true;
        setButtonLabel(el.authSubmit, "fa-solid fa-spinner fa-spin", "Đang kết nối...");
      }
      setAuthMessage("Đang xác thực API key...");

      try {
        await authenticate(endpoint, apiKey);
        writeLocalStorageText(STORAGE_ENDPOINT_KEY, endpoint);
        if (el.authKey) {
          el.authKey.value = "";
        }
        setAuthOverlayVisible(false);
        setAuthMessage("Kết nối thành công.");
        logLine(`Đăng nhập thành công vào ${endpoint}`);
      } catch (err) {
        resetAuthState();
        const message = (err && err.message) || "Không thể xác thực API key.";
        setAuthMessage(message, true);
        logLine(`Xác thực thất bại: ${message}`, true);
      } finally {
        state.authBusy = false;
        if (el.authSubmit) {
          el.authSubmit.disabled = false;
          setButtonLabel(el.authSubmit, "fa-solid fa-plug", "Kết nối");
        }
      }
    });
  }

  if (el.switchAuthBtn) {
    el.switchAuthBtn.addEventListener("click", () => {
      if (state.uploadRunning) return;
      resetAuthState();
      if (el.authKey) {
        el.authKey.value = "";
      }
      fillAuthInputsFromLocalStorage();
      setAuthOverlayVisible(true);
      setAuthMessage("");
    });
  }

  if (el.hardRefreshBtn) {
    el.hardRefreshBtn.addEventListener("click", () => {
      handleHardRefresh().catch((err) => {
        logLine(`Làm mới thất bại: ${(err && err.message) || "không rõ"}`, true);
      });
    });
  }

  if (el.selectAllBtn) {
    el.selectAllBtn.addEventListener("click", () => {
      if (state.uploadRunning || state.authBusy || state.sourceUploading || state.sourceLoading) return;

      if (normalizeUploadPane(state.activeUploadPane) === "source") {
        const rows = getSelectableSourceRows();
        if (!rows.length) return;

        const allSelected = rows.every((row) => row.enabled);
        rows.forEach((row) => {
          row.enabled = !allSelected;
        });

        renderSourceRows();
        updateSourceSelectionUi();
        updateSelectAllButtonState();
        return;
      }

      const rows = getSelectableRows();
      if (!rows.length) return;

      const allSelected = rows.every((row) => row.enabled);
      rows.forEach((row) => {
        row.enabled = !allSelected;
      });

      renderChapterTable();
    });
  }

  if (el.loadTitleMapBtn) {
    el.loadTitleMapBtn.addEventListener("click", () => {
      handleLoadChapterTitleMapFromTxt().catch((err) => {
        logLine(`Nạp title từ .txt thất bại: ${(err && err.message) || "không rõ"}`, true);
      });
    });
  }

  if (el.mangaSearch) {
    el.mangaSearch.addEventListener("input", () => {
      state.mangaSearch = (el.mangaSearch.value || "").toString();
      renderMangaList();
    });
  }

  if (Array.isArray(el.uploadPaneButtons)) {
    el.uploadPaneButtons.forEach((button) => {
      if (!(button instanceof Element)) return;
      button.addEventListener("click", () => {
        if (state.uploadRunning || state.authBusy || state.sourceUploading || state.sourceLoading) return;
        const pane = normalizeUploadPane(button.getAttribute("data-pane"));
        if (pane === state.activeUploadPane) return;
        state.activeUploadPane = pane;
        renderUploadPanes();
      });
    });
  }

  if (el.sourceLink) {
    el.sourceLink.addEventListener("input", () => {
      if (state.uploadRunning || state.authBusy || state.sourceUploading || state.sourceLoading) return;
      const sourceInput = String(el.sourceLink.value || "").trim();
      const detected = normalizeSourceProvider(detectSourceProviderFromInput(sourceInput));
      state.sourceProvider = detected;
      if (!sourceInput) {
        setSourceStatus("Chưa tải chapter từ nguồn ngoài.");
      }
    });

    el.sourceLink.addEventListener("keydown", (event) => {
      if (!event || event.key !== "Enter") return;
      event.preventDefault();
      fetchSourceChapterList().catch((err) => {
        logErrorWithDebug("Lấy chapter nguồn ngoài thất bại", err);
      });
    });
  }

  if (el.sourceFetchBtn) {
    el.sourceFetchBtn.addEventListener("click", () => {
      fetchSourceChapterList().catch((err) => {
        logErrorWithDebug("Lấy chapter nguồn ngoài thất bại", err);
      });
    });
  }

  if (el.sourcePriorityOpenBtn) {
    el.sourcePriorityOpenBtn.addEventListener("click", () => {
      if (state.uploadRunning || state.authBusy || state.sourceUploading || state.sourceLoading) return;
      renderSourcePriorityList();
      setSourcePriorityPopoverVisible(true);
    });
  }

  if (el.sourcePriorityCloseBtn) {
    el.sourcePriorityCloseBtn.addEventListener("click", () => {
      setSourcePriorityPopoverVisible(false);
    });
  }

  if (el.sourcePriorityList) {
    el.sourcePriorityList.addEventListener("click", (event) => {
      if (state.uploadRunning || state.sourceUploading || state.sourceLoading || state.authBusy) {
        return;
      }
      event.stopPropagation();
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const button = target.closest("[data-priority-move]");
      if (!button) return;

      const itemNode = button.closest("[data-priority-index]");
      if (!itemNode) return;
      const index = Number(itemNode.getAttribute("data-priority-index") || -1);
      if (!Number.isFinite(index) || index < 0) return;

      const direction = String(button.getAttribute("data-priority-move") || "").trim();
      moveSourcePriority(index, direction === "up" ? -1 : 1);
    });
  }

  if (el.sourceUploadSelectedBtn) {
    el.sourceUploadSelectedBtn.addEventListener("click", () => {
      uploadSelectedSourceRows().catch((err) => {
        logErrorWithDebug("Upload hàng loạt chapter nguồn thất bại", err);
      });
    });
  }

  if (el.sourceSelectAllToggle) {
    el.sourceSelectAllToggle.addEventListener("change", () => {
      if (state.uploadRunning || state.authBusy || state.sourceUploading || state.sourceLoading) return;
      const checked = Boolean(el.sourceSelectAllToggle.checked);
      (Array.isArray(state.sourceRows) ? state.sourceRows : []).forEach((row) => {
        if (!row) return;
        if (row.isDone || row.isUploading) return;
        row.enabled = checked;
      });
      renderSourceRows();
    });
  }

  if (el.mangaGrid) {
    el.mangaGrid.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const card = target.closest("[data-manga-id]");
      if (!card) return;
      if (state.uploadRunning || state.authBusy || state.sourceLoading || state.sourceUploading) return;
      const mangaId = Number(card.getAttribute("data-manga-id") || 0);
      if (!Number.isFinite(mangaId) || mangaId <= 0) return;
      selectMangaById(mangaId).catch((err) => {
        logLine(`Không thể tải chapter list: ${(err && err.message) || "không rõ"}`, true);
      });
      if (isSidebarCollapsedViewport()) {
        setSidebarOpen(false);
      }
    });
  }

  if (el.sidebarToggleBtn) {
    el.sidebarToggleBtn.addEventListener("click", () => {
      if (!isSidebarCollapsedViewport()) return;
      setSidebarOpen(!state.sidebarOpen);
    });
  }

  if (el.sidebarBackdrop) {
    el.sidebarBackdrop.addEventListener("click", () => {
      setSidebarOpen(false);
    });
  }

  if (el.logToggleBtn) {
    el.logToggleBtn.addEventListener("click", () => {
      toggleLogPanel();
    });
  }

  window.addEventListener("resize", () => {
    syncSidebarForViewport();
    syncLogPanelForViewport();
  });

  if (el.pickFolderBtn) {
    el.pickFolderBtn.addEventListener("click", () => {
      handlePickParentFolder().catch((err) => {
        logLine(`Chọn thư mục thất bại: ${(err && err.message) || "không rõ"}`, true);
      });
    });
  }

  if (el.reloadFolderBtn) {
    el.reloadFolderBtn.addEventListener("click", () => {
      handleReloadParentFolder().catch((err) => {
        logLine(`Tải lại thư mục thất bại: ${(err && err.message) || "không rõ"}`, true);
      });
    });
  }

  if (el.startUploadBtn) {
    el.startUploadBtn.addEventListener("click", () => {
      startBulkUpload().catch((err) => {
        logLine(`Upload bulk thất bại: ${(err && err.message) || "không rõ"}`, true);
      });
    });
  }

  if (el.chapterTableBody) {
    el.chapterTableBody.addEventListener("input", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (!target.matches("[data-row-title]")) return;

      const rowNode = target.closest("[data-row-id]");
      if (!rowNode) return;
      const rowId = rowNode.getAttribute("data-row-id");
      const row = state.chapterRows.find((item) => item.id === rowId);
      if (!row) return;

      row.title = (target.value || "").toString();
    });

    el.chapterTableBody.addEventListener("change", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const rowNode = target.closest("[data-row-id]");
      if (!rowNode) return;
      const rowId = rowNode.getAttribute("data-row-id");
      const row = state.chapterRows.find((item) => item.id === rowId);
      if (!row) return;

      if (target.matches("[data-row-enabled]")) {
        row.enabled = Boolean(target.checked);
        updateStartUploadButtonState();
        return;
      }

      if (target.matches("[data-row-action]")) {
        row.action = String(target.value || "skip");
        return;
      }
    });
  }

  if (el.sourceTableBody) {
    el.sourceTableBody.addEventListener("change", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const rowNode = target.closest("[data-source-row-id]");
      if (!rowNode) return;
      const rowId = String(rowNode.getAttribute("data-source-row-id") || "");
      const row = state.sourceRows.find((item) => item && item.id === rowId);
      if (!row) return;

      if (target.matches("[data-source-release]")) {
        row.selectedReleaseId = String(target.value || "");
        const selectedRelease = getSourceSelectedRelease(row);
        row.customTitle = selectedRelease && selectedRelease.title ? String(selectedRelease.title) : "";
        row.isDone = false;
        row.isSkipped = false;
        row.isFailed = false;
        row.errorMessage = "";
        renderSourceRows();
        return;
      }

      if (target.matches("[data-source-enabled]")) {
        row.enabled = Boolean(target.checked);
        updateSourceSelectionUi();
        updateSelectAllButtonState();
        return;
      }
    });

    el.sourceTableBody.addEventListener("input", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const rowNode = target.closest("[data-source-row-id]");
      if (!rowNode) return;
      const rowId = String(rowNode.getAttribute("data-source-row-id") || "");
      const row = state.sourceRows.find((item) => item && item.id === rowId);
      if (!row) return;

      if (!target.matches("[data-source-title]")) return;

      row.customTitle = String(target.value || "");
    });

    el.sourceTableBody.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const button = target.closest("[data-source-upload]");
      if (!button) return;
      const rowNode = button.closest("[data-source-row-id]");
      if (!rowNode) return;
      const rowId = String(rowNode.getAttribute("data-source-row-id") || "");

      uploadSourceRow(rowId)
        .catch((err) => {
          logErrorWithDebug("Kéo chapter nguồn ngoài thất bại", err);
        });
    });
  }
}

function init() {
  bindEvents();
  setHelpModalVisible(false);
  resetAuthState();
  renderUploadPanes();
  renderSourceRows();
  renderSourcePriorityList();
  setSourcePriorityPopoverVisible(false);
  syncSidebarForViewport();
  syncLogPanelForViewport();
  if (el.sourceLink) {
    el.sourceLink.value = state.sourceInput || "";
  }
  setSourceStatus("Chưa tải chapter từ nguồn ngoài.");
  updateFolderPathLabel();
  setOverallProgress(0, 0, "Chưa upload.");
  setOverallBreakdown({ success: 0, failed: 0, skipped: 0 });
  setAuthOverlayVisible(true);
  setAuthMessage("");
}

init();
