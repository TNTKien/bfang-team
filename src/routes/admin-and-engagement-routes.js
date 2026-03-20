const registerAdminAndEngagementRoutes = (app, deps) => {
  const {
    ADMIN_MEMBERS_PER_PAGE,
    NOTIFICATION_STREAM_HEARTBEAT_MS,
    addNotificationStreamClient,
    adminConfig,
    adminJobs,
    adminLoginRateLimiter,
    adminSsoRateLimiter,
    asyncHandler,
    b2DeleteAllByPrefix,
    b2DeleteChapterExtraPages,
    b2DeleteFileVersions,
    b2ListFileVersionsByPrefix,
    b2UploadBuffer,
    buildAutoBadgeCode,
    buildChapterExistingPageId,
    buildChapterTimestampIso,
    buildMangaSlug,
    cacheBust,
    chapterDraftTtlMs,
    convertChapterPageToWebp,
    convertCoverToWebp,
    avatarsDir,
    coversDir,
    coversUrlPrefix,
    createAdminJob,
    createChapterDraft,
    createCoverTempToken,
    crypto,
    dbAll,
    dbGet,
    dbRun,
    deleteChapterAndCleanupStorage,
    deleteCommentCascade,
    deleteCoverTemp,
    deleteFileIfExists,
    deleteMangaAndCleanupStorage,
    enqueueChapterProcessing,
    ensureHomepageDefaults,
    ensureMemberBadgeForUser,
    ensureUserRowFromAuthUser,
    extractLocalCoverFilename,
    findGenreRowByNormalizedName,
    formatDate,
    formatDateTime,
    getB2Config,
    getChapterDraft,
    getDefaultFeaturedIds,
    getForbiddenWords,
    getGenreStats,
    getGenresStringByIds,
    getMemberBadgeId,
    getOneshotGenreId,
    getPublicOriginFromRequest,
    getUnreadNotificationCount,
    getUserBadgeContext,
    getVisibleCommentCount,
    invalidateForbiddenWordsCache,
    isAdminConfigured,
    isB2Ready,
    isChapterDraftPageIdValid,
    isChapterDraftTokenValid,
    isPasswordAdminEnabled,
    isTruthyInput,
    listQuery,
    listQueryBase,
    listQueryOrder,
    loadCoverTempBuffer,
    localDevOrigin,
    mapBadgeRow,
    mapMangaListRow,
    mapNotificationRow,
    markMangaUpdatedAtForNewChapter,
    normalizeAdminJobError,
    normalizeAvatarUrl,
    normalizeBadgeCode,
    CHAPTER_PASSWORD_MAX_LENGTH,
    CHAPTER_PASSWORD_MIN_LENGTH,
    buildChapterPasswordHashRecord,
    normalizeForbiddenWordList,
    normalizeChapterPasswordInput,
    normalizeGenreName,
    normalizeHexColor,
    normalizeHomepageRow,
    normalizeIdList,
    normalizeProfileBio,
    normalizeProfileDiscord,
    normalizeProfileDisplayName,
    normalizeProfileFacebook,
    parseChapterNumberInput,
    path,
    publishNotificationStreamUpdate,
    regenerateSession,
    removeNotificationStreamClient,
    requireAdmin,
    requireAuthUserForComments,
    resolveCommentPermalinkForNotification,
    resolvePaginationParams,
    safeCompareText,
    saveCoverBuffer,
    saveCoverTempBuffer,
    serverSessionVersion,
    setMangaGenresByIds,
    team,
    toBooleanFlag,
    touchChapterDraft,
    updateChapterProcessing,
    uploadChapterPage,
    uploadChapterPages,
    uploadCover,
    wantsJson,
    withTransaction,
    writeNotificationStreamEvent,
  } = deps;

const NOTIFICATION_TYPE_MANGA_BOOKMARK_NEW_CHAPTER = "manga_bookmark_new_chapter";

const notifyBookmarkedUsersForNewChapter = async ({ mangaId, chapterNumber }) => {
  const mangaIdValue = Number(mangaId);
  const chapterValue = Number(chapterNumber);
  if (!Number.isFinite(mangaIdValue) || mangaIdValue <= 0) return 0;
  if (!Number.isFinite(chapterValue) || chapterValue < 0) return 0;

  const safeMangaId = Math.floor(mangaIdValue);
  const safeChapterNumber = Math.abs(chapterValue) < 1e-9 ? 0 : chapterValue;
  const createdAt = Date.now();

  const insertedRows = await dbAll(
    `
      WITH inserted AS (
        INSERT INTO notifications (
          user_id,
          type,
          actor_user_id,
          manga_id,
          chapter_number,
          comment_id,
          content_preview,
          is_read,
          created_at,
          read_at
        )
        SELECT
          mb.user_id,
          ?,
          NULL,
          mb.manga_id,
          ?,
          NULL,
          '',
          false,
          ?,
          NULL
        FROM manga_bookmarks mb
        WHERE mb.manga_id = ?
        ON CONFLICT DO NOTHING
        RETURNING user_id
      )
      SELECT DISTINCT user_id
      FROM inserted
      WHERE user_id IS NOT NULL
        AND TRIM(user_id) <> ''
    `,
    [NOTIFICATION_TYPE_MANGA_BOOKMARK_NEW_CHAPTER, safeChapterNumber, createdAt, safeMangaId]
  );

  let createdCount = 0;
  insertedRows.forEach((row) => {
    const userId = row && row.user_id ? String(row.user_id).trim() : "";
    if (!userId) return;
    createdCount += 1;
    publishNotificationStreamUpdate({ userId, reason: "created" }).catch(() => null);
  });

  return createdCount;
};

const normalizeTeamGroupName = (value) =>
  (value || "")
    .toString()
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const normalizeTeamGroupLookupKey = (value) =>
  normalizeTeamGroupName(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const splitTeamGroupNameTokens = (value) => {
  const normalized = normalizeTeamGroupName(value);
  if (!normalized) return [];
  return normalized
    .replace(/\s*[\/&+;|,]\s*/g, ",")
    .replace(/\s+x\s+/g, ",")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
};

const splitTeamGroupDisplayTokens = (value) =>
  (value || "")
    .toString()
    .replace(/\s*[\/&+;|,]\s*/g, ",")
    .replace(/\s+x\s+/gi, ",")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

const removeTeamFromGroupName = (groupName, teamName) => {
  const normalizedTeam = normalizeTeamGroupName(teamName);
  const safeGroupName = (groupName || "").toString().replace(/\s+/g, " ").trim();
  if (!normalizedTeam || !safeGroupName) return safeGroupName;

  const tokens = splitTeamGroupDisplayTokens(safeGroupName);
  if (!tokens.length) {
    return normalizeTeamGroupName(safeGroupName) === normalizedTeam ? "" : safeGroupName;
  }

  const filteredTokens = tokens.filter((token) => normalizeTeamGroupName(token) !== normalizedTeam);
  if (!filteredTokens.length) return "";
  if (filteredTokens.length === tokens.length) {
    return normalizeTeamGroupName(safeGroupName) === normalizedTeam ? "" : safeGroupName;
  }
  return filteredTokens.join(" / ");
};

const extractTeamUploadFilename = (assetUrl, expectedPrefix) => {
  const raw = (assetUrl || "").toString().trim();
  const prefix = (expectedPrefix || "").toString().trim();
  if (!raw || !prefix) return "";

  const noQuery = raw.split("?")[0].trim();
  if (!noQuery.startsWith(prefix)) return "";
  const filename = path.basename(noQuery);
  if (!filename || filename === "." || filename === "..") return "";
  return filename;
};

const teamGroupNameContainsTeam = (groupName, teamName) => {
  const normalizedTeam = normalizeTeamGroupName(teamName);
  if (!normalizedTeam) return false;
  const lookupTeam = normalizeTeamGroupLookupKey(teamName);

  const normalizedGroup = normalizeTeamGroupName(groupName);
  if (!normalizedGroup) return false;
  if (normalizedGroup === normalizedTeam) return true;
  if (lookupTeam && normalizeTeamGroupLookupKey(groupName) === lookupTeam) return true;

  const tokens = splitTeamGroupNameTokens(groupName);
  if (tokens.includes(normalizedTeam)) return true;
  if (lookupTeam) {
    const lookupTokens = splitTeamGroupDisplayTokens(groupName)
      .map((token) => normalizeTeamGroupLookupKey(token))
      .filter(Boolean);
    if (lookupTokens.includes(lookupTeam)) return true;
  }
  return false;
};

const buildTeamGroupNameListExpr = (columnSql) =>
  `replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(trim(COALESCE(${columnSql}, ''))), ' / ', ','), '/', ','), ' & ', ','), '&', ','), ' + ', ','), '+', ','), ';', ','), '|', ','), ' x ', ','), ', ', ','), ' ,', ',')`;

const buildTeamGroupNameMatchSql = (columnSql) => {
  const normalizedNameExpr = `replace(lower(trim(COALESCE(${columnSql}, ''))), '_', '-')`;
  const normalizedList = `replace(${buildTeamGroupNameListExpr(columnSql)}, '_', '-')`;
  const normalizedParamExpr = `replace(lower(trim(?)), '_', '-')`;
  return `
    (
      ${normalizedNameExpr} = ${normalizedParamExpr}
      OR (',' || ${normalizedList} || ',') LIKE ('%,' || ${normalizedParamExpr} || ',%')
    )
  `;
};

const TEAM_MEMBER_PERMISSION_DEFAULTS = Object.freeze({
  canAddManga: false,
  canEditManga: false,
  canDeleteManga: false,
  canAddChapter: true,
  canEditChapter: true,
  canDeleteChapter: true,
});

const readTeamPermissionFlag = (value, fallback) => {
  if (value == null) return Boolean(fallback);
  return toBooleanFlag(value);
};

const parseTeamPermissionPayload = (value) => {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_err) {
      return null;
    }
  }
  return null;
};

const normalizeSafeRedirectPath = (value, fallback = "") => {
  const raw = (value == null ? "" : String(value)).trim();
  if (!raw) return (fallback || "").toString().trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) {
    return (fallback || "").toString().trim();
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
};

const normalizeForumRedirectPath = (value, fallback = "") => {
  const normalized = normalizeSafeRedirectPath(value, "");
  if (!normalized || !normalized.startsWith("/forum")) {
    return normalizeSafeRedirectPath(fallback, "");
  }
  return normalized;
};

const readRedirectField = (container, key) => {
  if (!container || typeof container !== "object") return "";
  return key in container ? container[key] : "";
};

const resolveAdminNextTarget = (req) => {
  const bodyValue = readRedirectField(req && req.body, "next");
  const queryValue = readRedirectField(req && req.query, "next");
  return normalizeForumRedirectPath(bodyValue || queryValue || "", "");
};

const resolveAdminFallbackTarget = (req) => {
  const bodyValue = readRedirectField(req && req.body, "fallback");
  const queryValue = readRedirectField(req && req.query, "fallback");
  return normalizeForumRedirectPath(bodyValue || queryValue || "", "/forum");
};

const FORUM_COMMENT_REQUEST_PREFIX = "forum-";
const FORUM_COMMENT_REQUEST_LIKE = `${FORUM_COMMENT_REQUEST_PREFIX}%`;
const FORUM_COMMENT_META_LIKE = "%<!--forum-meta:%";

const buildTeamManagePermissions = ({ role, rawPermissions }) => {
  const safeRole = (role || "").toString().trim().toLowerCase();
  if (safeRole === "leader") {
    return {
      canAddManga: true,
      canEditManga: true,
      canDeleteManga: true,
      canAddChapter: true,
      canEditChapter: true,
      canDeleteChapter: true,
    };
  }

  const source = parseTeamPermissionPayload(rawPermissions) || {};
  return {
    canAddManga: readTeamPermissionFlag(source.canAddManga, TEAM_MEMBER_PERMISSION_DEFAULTS.canAddManga),
    canEditManga: readTeamPermissionFlag(source.canEditManga, TEAM_MEMBER_PERMISSION_DEFAULTS.canEditManga),
    canDeleteManga: readTeamPermissionFlag(source.canDeleteManga, TEAM_MEMBER_PERMISSION_DEFAULTS.canDeleteManga),
    canAddChapter: readTeamPermissionFlag(source.canAddChapter, TEAM_MEMBER_PERMISSION_DEFAULTS.canAddChapter),
    canEditChapter: readTeamPermissionFlag(source.canEditChapter, TEAM_MEMBER_PERMISSION_DEFAULTS.canEditChapter),
    canDeleteChapter: readTeamPermissionFlag(source.canDeleteChapter, TEAM_MEMBER_PERMISSION_DEFAULTS.canDeleteChapter),
  };
};

const parseGroupTeamIdsInput = (value) => {
  if (Array.isArray(value)) {
    return normalizeIdList(value);
  }
  if (typeof value === "string") {
    const tokens = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return normalizeIdList(tokens);
  }
  if (value == null) return [];
  return normalizeIdList(value);
};

const mapAdminTeamPickerRow = (row) => ({
  id: Number(row && row.id) || 0,
  name: (row && row.name ? row.name : "").toString().replace(/\s+/g, " ").trim(),
  slug: (row && row.slug ? row.slug : "").toString().trim()
});

const listApprovedTeamsByIds = async ({ teamIds, dbAllFn = dbAll }) => {
  const ids = normalizeIdList(Array.isArray(teamIds) ? teamIds : []);
  if (!ids.length) return [];

  const placeholders = ids.map(() => "?").join(", ");
  const rows = await dbAllFn(
    `
      SELECT id, name, slug
      FROM translation_teams
      WHERE status = 'approved'
        AND id IN (${placeholders})
    `,
    ids
  );

  const byId = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const mapped = mapAdminTeamPickerRow(row);
    if (!mapped.id || !mapped.name) return;
    byId.set(mapped.id, mapped);
  });

  return ids.map((id) => byId.get(id)).filter(Boolean);
};

const listApprovedTeamsByGroupName = async ({ groupName, dbAllFn = dbAll }) => {
  const rawTokens = splitTeamGroupDisplayTokens(groupName || "");
  if (!rawTokens.length) return [];

  const rows = await dbAllFn(
    `
      SELECT id, name, slug
      FROM translation_teams
      WHERE status = 'approved'
      ORDER BY lower(name) ASC, id ASC
    `,
    []
  );

  const byKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const mapped = mapAdminTeamPickerRow(row);
    if (!mapped.id || !mapped.name) return;

    [
      normalizeTeamGroupName(mapped.name),
      normalizeTeamGroupLookupKey(mapped.name),
      normalizeTeamGroupName(mapped.slug),
      normalizeTeamGroupLookupKey(mapped.slug)
    ]
      .filter(Boolean)
      .forEach((key) => {
        if (!byKey.has(key)) {
          byKey.set(key, mapped);
        }
      });
  });

  const ordered = [];
  const seenIds = new Set();
  rawTokens.forEach((token) => {
    const candidateKeys = [normalizeTeamGroupName(token), normalizeTeamGroupLookupKey(token)].filter(Boolean);
    let picked = null;
    for (const key of candidateKeys) {
      if (byKey.has(key)) {
        picked = byKey.get(key);
        break;
      }
    }
    if (!picked || seenIds.has(picked.id)) return;
    seenIds.add(picked.id);
    ordered.push(picked);
  });

  return ordered;
};

const buildChapterPasswordLengthError = () =>
  `Mật khẩu chương phải từ ${CHAPTER_PASSWORD_MIN_LENGTH} đến ${CHAPTER_PASSWORD_MAX_LENGTH} ký tự.`;

const parseChapterPasswordUpdatePayload = ({ reqBody, allowKeep, hasExistingPassword }) => {
  const body = reqBody && typeof reqBody === "object" ? reqBody : {};
  const requestedMode = (body.chapter_password_mode || "").toString().trim().toLowerCase();
  const wantsPasswordEnabled = isTruthyInput(body.chapter_password_enabled);
  const passwordInput = normalizeChapterPasswordInput(body.chapter_password);
  const prefillTokenInput = normalizeChapterPasswordInput(body.chapter_password_prefill_token);
  const hasExisting = Boolean(hasExistingPassword);

  const shouldKeepExistingByPrefillToken =
    Boolean(allowKeep) &&
    hasExisting &&
    wantsPasswordEnabled &&
    Boolean(passwordInput) &&
    Boolean(prefillTokenInput) &&
    safeCompareText(passwordInput, prefillTokenInput);

  if (shouldKeepExistingByPrefillToken) {
    return {
      ok: true,
      mode: "keep",
      shouldUpdate: false,
      passwordHash: null,
      passwordSalt: null,
      passwordUpdatedAt: null
    };
  }

  if (wantsPasswordEnabled || requestedMode === "set") {
    if (!passwordInput) {
      return {
        ok: false,
        error: "Bạn đã bật Cài mật khẩu chương nhưng chưa nhập mật khẩu."
      };
    }

    const hashRecord = buildChapterPasswordHashRecord(passwordInput);
    if (!hashRecord) {
      return {
        ok: false,
        error: buildChapterPasswordLengthError()
      };
    }

    return {
      ok: true,
      mode: "set",
      shouldUpdate: true,
      passwordHash: hashRecord.passwordHash,
      passwordSalt: hashRecord.passwordSalt,
      passwordUpdatedAt: hashRecord.passwordUpdatedAt
    };
  }

  if (requestedMode === "keep" && allowKeep && !passwordInput) {
    return {
      ok: true,
      mode: "keep",
      shouldUpdate: false,
      passwordHash: null,
      passwordSalt: null,
      passwordUpdatedAt: null
    };
  }

  if (requestedMode === "clear") {
    return {
      ok: true,
      mode: "clear",
      shouldUpdate: true,
      passwordHash: null,
      passwordSalt: null,
      passwordUpdatedAt: null
    };
  }

  if (allowKeep) {
    if (hasExisting) {
      return {
        ok: true,
        mode: "clear",
        shouldUpdate: true,
        passwordHash: null,
        passwordSalt: null,
        passwordUpdatedAt: null
      };
    }

    return {
      ok: true,
      mode: "keep",
      shouldUpdate: false,
      passwordHash: null,
      passwordSalt: null,
      passwordUpdatedAt: null
    };
  }

  return {
    ok: true,
    mode: "clear",
    shouldUpdate: true,
    passwordHash: null,
    passwordSalt: null,
    passwordUpdatedAt: null
  };
};

const buildGroupNameFromApprovedTeams = (teams) => {
  const list = Array.isArray(teams) ? teams : [];
  const names = list
    .map((teamRow) => (teamRow && teamRow.name ? String(teamRow.name).replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean);
  return names.join(" / ");
};

const ensureTeamScopeIncludedInSelection = async ({ teams, teamManageScope, dbAllFn = dbAll }) => {
  const list = (Array.isArray(teams) ? teams : []).filter(Boolean);
  if (!teamManageScope || !teamManageScope.teamName) return list;

  const scopeTeamIdRaw = Number(teamManageScope.teamId);
  const scopeTeamId = Number.isFinite(scopeTeamIdRaw) && scopeTeamIdRaw > 0 ? Math.floor(scopeTeamIdRaw) : 0;
  const scopeTeamName = (teamManageScope.teamName || "").toString().replace(/\s+/g, " ").trim();
  const normalizedScopeTeamName = normalizeTeamGroupLookupKey(scopeTeamName);

  const scopeTeamIndex = list.findIndex((item) => {
    const itemId = Number(item && item.id);
    if (scopeTeamId > 0 && Number.isFinite(itemId) && Math.floor(itemId) === scopeTeamId) return true;
    const normalizedName = normalizeTeamGroupLookupKey(item && item.name ? item.name : "");
    return Boolean(normalizedScopeTeamName && normalizedName && normalizedName === normalizedScopeTeamName);
  });
  if (scopeTeamIndex >= 0) {
    if (scopeTeamIndex === 0) return list;
    const next = list.slice();
    const scopedTeam = next.splice(scopeTeamIndex, 1)[0];
    if (!scopedTeam) return list;
    return [scopedTeam, ...next];
  }

  let scopeTeamSelection = null;
  if (scopeTeamId > 0) {
    const rows = await listApprovedTeamsByIds({ teamIds: [scopeTeamId], dbAllFn });
    scopeTeamSelection = rows.length ? rows[0] : null;
  }

  if (!scopeTeamSelection && scopeTeamName) {
    scopeTeamSelection = {
      id: scopeTeamId,
      name: scopeTeamName,
      slug: (teamManageScope.teamSlug || "").toString().trim()
    };
  }

  if (!scopeTeamSelection || !scopeTeamSelection.name) {
    return list;
  }

  const normalizedScopeName = normalizeTeamGroupLookupKey(scopeTeamSelection.name);
  const filtered = list.filter((item) => {
    const itemId = Number(item && item.id);
    if (scopeTeamSelection.id > 0 && Number.isFinite(itemId) && Math.floor(itemId) === scopeTeamSelection.id) {
      return false;
    }
    const normalizedName = normalizeTeamGroupLookupKey(item && item.name ? item.name : "");
    if (normalizedScopeName && normalizedName === normalizedScopeName) {
      return false;
    }
    return true;
  });

  return [scopeTeamSelection, ...filtered];
};

const resolveGroupNameFromRequestPayload = async ({ reqBody, teamManageScope, dbAllFn = dbAll }) => {
  const inputTeamIds = parseGroupTeamIdsInput(reqBody && reqBody.group_team_ids ? reqBody.group_team_ids : "");
  const scopeTeamIdRaw = Number(teamManageScope && teamManageScope.teamId);
  const scopeTeamId = Number.isFinite(scopeTeamIdRaw) && scopeTeamIdRaw > 0 ? Math.floor(scopeTeamIdRaw) : 0;
  const teamIds =
    teamManageScope && scopeTeamId > 0 && !inputTeamIds.length ? [scopeTeamId] : inputTeamIds;

  if (!teamIds.length) {
    return {
      ok: false,
      error: "Vui lòng chọn ít nhất một nhóm dịch từ danh sách."
    };
  }

  let selectedTeams = await listApprovedTeamsByIds({ teamIds, dbAllFn });
  if (selectedTeams.length !== teamIds.length) {
    return {
      ok: false,
      error: "Nhóm dịch đã chọn không hợp lệ hoặc không còn tồn tại."
    };
  }

  if (teamManageScope && teamManageScope.teamName) {
    selectedTeams = await ensureTeamScopeIncludedInSelection({
      teams: selectedTeams,
      teamManageScope,
      dbAllFn
    });
  }

  const groupName = buildGroupNameFromApprovedTeams(selectedTeams);
  if (!groupName) {
    return {
      ok: false,
      error: "Thiếu nhóm dịch."
    };
  }

  return {
    ok: true,
    groupName,
    teamIds: selectedTeams
      .map((item) => Number(item && item.id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .map((id) => Math.floor(id)),
    teams: selectedTeams
  };
};

const buildGroupTeamSelectionsForForm = async ({ teamManageScope, groupName, dbAllFn = dbAll }) => {
  const selectedTeams = await listApprovedTeamsByGroupName({ groupName: groupName || "", dbAllFn });
  return ensureTeamScopeIncludedInSelection({
    teams: selectedTeams,
    teamManageScope,
    dbAllFn
  });
};

const teamScopeHasPermission = (scope, permissionKey) => {
  if (!scope || !permissionKey) return true;
  if ((scope.role || "").toString().trim().toLowerCase() === "leader") return true;
  if (!scope.permissions || typeof scope.permissions !== "object") return false;
  return Boolean(scope.permissions[permissionKey]);
};

const teamScopeHasAnyPermission = (scope) => {
  if (!scope) return true;
  if ((scope.role || "").toString().trim().toLowerCase() === "leader") return true;
  const permissions = scope.permissions && typeof scope.permissions === "object" ? scope.permissions : null;
  if (!permissions) return false;
  return Boolean(
    permissions.canAddManga ||
    permissions.canEditManga ||
    permissions.canDeleteManga ||
    permissions.canAddChapter ||
    permissions.canEditChapter ||
    permissions.canDeleteChapter
  );
};

const teamScopeHasAnyOfPermissions = (scope, permissionKeys) => {
  if (!scope) return true;
  const keys = Array.isArray(permissionKeys) ? permissionKeys : [];
  if (!keys.length) return true;
  return keys.some((key) => teamScopeHasPermission(scope, key));
};

const enforceTeamScopePermission = (req, res, scope, permissionKey, message) => {
  if (teamScopeHasPermission(scope, permissionKey)) return true;
  sendTeamManageForbidden(req, res, message);
  return false;
};

const enforceTeamScopeAnyPermission = (req, res, scope, message) => {
  if (teamScopeHasAnyPermission(scope)) return true;
  sendTeamManageForbidden(req, res, message);
  return false;
};

const enforceTeamScopeAnyOfPermissions = (req, res, scope, permissionKeys, message) => {
  if (teamScopeHasAnyOfPermissions(scope, permissionKeys)) return true;
  sendTeamManageForbidden(req, res, message);
  return false;
};

const isTeamLeaderAdminMode = (req) => {
  const mode = (req && req.session && req.session.adminAuth ? req.session.adminAuth : "")
    .toString()
    .trim()
    .toLowerCase();
  return mode === "team_leader" || mode === "team_member";
};

const getTeamLeaderScope = (req) => {
  if (!isTeamLeaderAdminMode(req)) return null;
  const teamId = Number(req && req.session ? req.session.adminTeamId : 0);
  const teamName = (req && req.session && req.session.adminTeamName ? req.session.adminTeamName : "")
    .toString()
    .replace(/\s+/g, " ")
    .trim();
  const teamSlug = (req && req.session && req.session.adminTeamSlug ? req.session.adminTeamSlug : "")
    .toString()
    .trim();
  const roleFromSession = (req && req.session && req.session.adminTeamRole ? req.session.adminTeamRole : "")
    .toString()
    .trim()
    .toLowerCase();
  const mode = (req && req.session && req.session.adminAuth ? req.session.adminAuth : "")
    .toString()
    .trim()
    .toLowerCase();
  const role = roleFromSession === "leader" || mode === "team_leader" ? "leader" : "member";
  const permissions = buildTeamManagePermissions({
    role,
    rawPermissions: req && req.session ? req.session.adminTeamPermissions : null
  });
  if (!Number.isFinite(teamId) || teamId <= 0 || !teamName) return null;
  return {
    teamId: Math.floor(teamId),
    teamName,
    teamSlug,
    role,
    permissions
  };
};

const sendTeamManageForbidden = (req, res, message = "Bạn không có quyền thao tác dữ liệu của nhóm khác.") => {
  if (wantsJson(req)) {
    return res.status(403).json({ ok: false, error: message });
  }
  return res.status(403).send(message);
};

const teamLeaderOwnsGroup = (scope, groupName) => {
  if (!scope) return true;
  return teamGroupNameContainsTeam(groupName, scope.teamName);
};

const teamLeaderMangaGuard = asyncHandler(async (req, res, next) => {
  const scope = getTeamLeaderScope(req);
  if (!scope) return next();

  const mangaId = Number(req.params.id);
  if (!Number.isFinite(mangaId) || mangaId <= 0) {
    return sendTeamManageForbidden(req, res, "Mã truyện không hợp lệ.");
  }

  const mangaRow = await dbGet("SELECT id, group_name FROM manga WHERE id = ?", [Math.floor(mangaId)]);
  if (!mangaRow || !teamLeaderOwnsGroup(scope, mangaRow.group_name || "")) {
    return sendTeamManageForbidden(req, res);
  }

  req.teamManagedManga = {
    id: Number(mangaRow.id) || Math.floor(mangaId),
    groupName: (mangaRow.group_name || "").toString().trim()
  };
  return next();
});

const teamLeaderChapterGuard = asyncHandler(async (req, res, next) => {
  const scope = getTeamLeaderScope(req);
  if (!scope) return next();

  const chapterId = Number(req.params.id);
  if (!Number.isFinite(chapterId) || chapterId <= 0) {
    return sendTeamManageForbidden(req, res, "Mã chương không hợp lệ.");
  }

  const chapterRow = await dbGet(
    `
      SELECT c.id, c.manga_id, m.group_name
      FROM chapters c
      JOIN manga m ON m.id = c.manga_id
      WHERE c.id = ?
      LIMIT 1
    `,
    [Math.floor(chapterId)]
  );
  if (!chapterRow || !teamLeaderOwnsGroup(scope, chapterRow.group_name || "")) {
    return sendTeamManageForbidden(req, res);
  }

  req.teamManagedChapter = {
    id: Number(chapterRow.id) || Math.floor(chapterId),
    mangaId: Number(chapterRow.manga_id) || 0
  };
  return next();
});

const teamLeaderDraftGuard = asyncHandler(async (req, res, next) => {
  const scope = getTeamLeaderScope(req);
  if (!scope) return next();

  const token = (req.params.token || "").toString().trim();
  if (!token) {
    return sendTeamManageForbidden(req, res, "Draft chương không hợp lệ.");
  }

  const draftRow = await dbGet("SELECT manga_id FROM chapter_drafts WHERE token = ? LIMIT 1", [token]);
  if (!draftRow || !Number(draftRow.manga_id)) {
    return sendTeamManageForbidden(req, res, "Draft chương không tồn tại hoặc đã hết hạn.");
  }

  const mangaRow = await dbGet("SELECT id, group_name FROM manga WHERE id = ? LIMIT 1", [Number(draftRow.manga_id)]);
  if (!mangaRow || !teamLeaderOwnsGroup(scope, mangaRow.group_name || "")) {
    return sendTeamManageForbidden(req, res);
  }

  return next();
});

app.use("/admin/manga/:id(\\d+)", requireAdmin, teamLeaderMangaGuard);
app.use("/admin/chapters/:id(\\d+)", requireAdmin, teamLeaderChapterGuard);
app.use("/admin/chapter-drafts/:token", requireAdmin, teamLeaderDraftGuard);

app.get("/admin/login", (req, res) => {
  const nextTarget = resolveAdminNextTarget(req);
  const fallbackTarget = resolveAdminFallbackTarget(req);
  if (req.session && req.session.isAdmin) {
    return res.redirect(nextTarget || "/admin");
  }
  const passwordEnabled = isAdminConfigured();
  return res.render("admin/login", {
    title: "Admin Login",
    error: null,
    passwordEnabled,
    passwordDisabledReason: isPasswordAdminEnabled
      ? "Chưa cấu hình ADMIN_USER/ADMIN_PASS trong .env."
      : "Đăng nhập mật khẩu đã bị tắt bằng ADMIN_PASSWORD_LOGIN_ENABLED.",
    nextTarget,
    fallbackTarget,
  });
});

app.post(
  "/admin/login",
  adminLoginRateLimiter,
  asyncHandler(async (req, res) => {
    const nextTarget = resolveAdminNextTarget(req);
    const fallbackTarget = resolveAdminFallbackTarget(req);
    if (!isPasswordAdminEnabled) {
      return res.status(403).render("admin/login", {
        title: "Admin Login",
        error: "Đăng nhập mật khẩu đã bị tắt. Hãy dùng đăng nhập Google/Discord với huy hiệu Admin.",
        passwordEnabled: false,
        passwordDisabledReason: "Đăng nhập mật khẩu đã bị tắt bằng ADMIN_PASSWORD_LOGIN_ENABLED.",
        nextTarget,
        fallbackTarget,
      });
    }

    if (!isAdminConfigured()) {
      return res.status(500).render("admin/login", {
        title: "Admin Login",
        error: "Thiếu cấu hình ADMIN_USER/ADMIN_PASS trong .env.",
        passwordEnabled: false,
        passwordDisabledReason: "Chưa cấu hình ADMIN_USER/ADMIN_PASS trong .env.",
        nextTarget,
        fallbackTarget,
      });
    }

    const username = (req.body.username || "").trim();
    const password = (req.body.password || "").trim();

    if (safeCompareText(username, adminConfig.user) && safeCompareText(password, adminConfig.pass)) {
      await regenerateSession(req);
      req.session.isAdmin = true;
      req.session.adminAuth = "password";
      req.session.sessionVersion = serverSessionVersion;
      delete req.session.adminUserId;
      delete req.session.adminAuthUserId;
      return res.redirect(nextTarget || "/admin");
    }

    return res.status(401).render("admin/login", {
      title: "Admin Login",
      error: "Sai tài khoản hoặc mật khẩu.",
      passwordEnabled: true,
      passwordDisabledReason: "",
      nextTarget,
      fallbackTarget,
    });
  })
);

app.post(
  "/admin/sso",
  adminSsoRateLimiter,
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    const user = await requireAuthUserForComments(req, res);
    if (!user) return;
    const userId = String(user.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ." });
    }

    try {
      await ensureUserRowFromAuthUser(user);
    } catch (err) {
      console.warn("Failed to ensure user row for admin sso", err);
    }

    const badgeContext = await getUserBadgeContext(userId).catch(() => null);
    const canAccessAdmin = Boolean(
      badgeContext && badgeContext.permissions && badgeContext.permissions.canAccessAdmin
    );
    if (!canAccessAdmin) {
      return res.status(403).json({ ok: false, error: "Tài khoản này không có quyền Admin." });
    }

    const authProvider =
      (req.session && req.session.authProvider ? req.session.authProvider : "")
        .toString()
        .trim();

    await regenerateSession(req);
    req.session.authUserId = userId;
    if (authProvider) {
      req.session.authProvider = authProvider;
    }
    req.session.isAdmin = true;
    req.session.adminAuth = "badge";
    req.session.sessionVersion = serverSessionVersion;
    req.session.adminUserId = userId;
    req.session.adminAuthUserId = userId;
    return res.json({ ok: true });
  })
);

app.post("/admin/logout", requireAdmin, (req, res) => {
  const adminAuthMode = (req.session && req.session.adminAuth ? req.session.adminAuth : "password")
    .toString()
    .trim()
    .toLowerCase();
  const adminUserId = (req.session && req.session.adminUserId ? req.session.adminUserId : "")
    .toString()
    .trim();
  const adminAuthUserId =
    (req.session && req.session.adminAuthUserId ? req.session.adminAuthUserId : "")
      .toString()
      .trim();

  const teamIdRaw = Number(req.session && req.session.adminTeamId ? req.session.adminTeamId : 0);
  const teamId = Number.isFinite(teamIdRaw) && teamIdRaw > 0 ? Math.floor(teamIdRaw) : 0;
  const teamSlug = (req.session && req.session.adminTeamSlug ? req.session.adminTeamSlug : "")
    .toString()
    .trim();

  if (adminAuthMode === "team_leader" || adminAuthMode === "team_member") {
    req.session.isAdmin = false;
    delete req.session.adminAuth;
    delete req.session.adminUserId;
    delete req.session.adminAuthUserId;
    delete req.session.adminTeamId;
    delete req.session.adminTeamName;
    delete req.session.adminTeamSlug;
    delete req.session.adminTeamRole;
    delete req.session.adminTeamPermissions;
    return req.session.save(() => {
      if (teamId > 0 && teamSlug) {
        return res.redirect(`/team/${teamId}/${encodeURIComponent(teamSlug)}`);
      }
      return res.redirect("/publish");
    });
  }

  req.session.destroy(() => {
    if (adminAuthMode === "badge" && adminUserId) {
      const params = new URLSearchParams();
      params.set("logout_scope", "web");
      params.set("logout_user", adminAuthUserId || adminUserId);
      return res.redirect(`/admin/login?${params.toString()}`);
    }
    return res.redirect("/admin/login");
  });
});

app.post(
  "/admin/covers/temp",
  requireAdmin,
  uploadCover,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopeAnyOfPermissions(
        req,
        res,
        teamManageScope,
        ["canAddManga", "canEditManga"],
        "Bạn chưa được cấp quyền thao tác truyện."
      )
    ) {
      return;
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Chưa chọn ảnh bìa." });
    }

    let coverBuffer = null;
    try {
      coverBuffer = await convertCoverToWebp(req.file.buffer);
    } catch (err) {
      const message =
        err && err.message && err.message.startsWith("Ảnh bìa")
          ? err.message
          : "Ảnh bìa không hợp lệ hoặc quá lớn.";
      return res.status(400).json({ error: message });
    }

    const token = createCoverTempToken();
    await saveCoverTempBuffer(token, coverBuffer);
    const updatedAt = Date.now();
    const url = cacheBust(`${coversUrlPrefix}tmp/${token}.webp`, updatedAt);
    return res.json({ token, url, updatedAt });
  })
);

app.get(
  "/admin",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const nextTarget = resolveAdminNextTarget(req);
    if (nextTarget) {
      return res.redirect(nextTarget);
    }

    const mangaCountRow = await dbGet("SELECT COUNT(*) as count FROM manga");
    const chapterCountRow = await dbGet("SELECT COUNT(*) as count FROM chapters");
    const commentCountRow = await dbGet("SELECT COUNT(*) as count FROM comments");
    const memberCountRow = await dbGet("SELECT COUNT(*) as count FROM users");
    const latestMangaRows = await dbAll(`${listQuery} LIMIT 5`);
    const latestComments = await dbAll(
      `
      SELECT c.*, m.title as manga_title
      FROM comments c
      JOIN manga m ON m.id = c.manga_id
      WHERE COALESCE(c.client_request_id, '') NOT ILIKE ?
        AND COALESCE(c.content, '') NOT ILIKE ?
      ORDER BY c.created_at DESC
      LIMIT 5
    `,
      [FORUM_COMMENT_REQUEST_LIKE, FORUM_COMMENT_META_LIKE]
    );

    res.render("admin/dashboard", {
      title: "Admin Dashboard",
      adminUser: adminConfig.user,
      stats: {
        totalSeries: mangaCountRow ? mangaCountRow.count : 0,
        totalChapters: chapterCountRow ? chapterCountRow.count : 0,
        totalComments: commentCountRow ? commentCountRow.count : 0,
        totalMembers: memberCountRow ? memberCountRow.count : 0
      },
      latestManga: latestMangaRows.map(mapMangaListRow),
      latestComments
    });
  })
);

app.get(
  "/admin/homepage",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await ensureHomepageDefaults();
    const homepageRow = await dbGet("SELECT * FROM homepage WHERE id = 1");
    const homepageData = normalizeHomepageRow(homepageRow);
    const featuredIds = homepageData.featuredIds.length
      ? homepageData.featuredIds.slice(0, 4)
      : await getDefaultFeaturedIds();
    const mangaRows = await dbAll(
      `${listQueryBase} WHERE COALESCE(m.is_hidden, 0) = 0 ${listQueryOrder}`
    );

    res.render("admin/homepage", {
      title: "Trang chủ",
      adminUser: adminConfig.user,
      homepage: homepageData,
      featuredIds,
      mangaLibrary: mangaRows.map(mapMangaListRow),
      status: typeof req.query.status === "string" ? req.query.status : ""
    });
  })
);

app.post(
  "/admin/homepage",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await ensureHomepageDefaults();
    const noticeTitle1 = (req.body.notice_title_1 || "").trim();
    const noticeBody1 = (req.body.notice_body_1 || "").trim();
    const noticeTitle2 = (req.body.notice_title_2 || "").trim();
    const noticeBody2 = (req.body.notice_body_2 || "").trim();
    const rawFeatured = [req.body.featured_1, req.body.featured_2, req.body.featured_3, req.body.featured_4];
    let featuredIds = [];
    const seen = new Set();

    rawFeatured.forEach((value) => {
      const id = Number(value);
      if (Number.isFinite(id) && id > 0 && !seen.has(id)) {
        featuredIds.push(id);
        seen.add(id);
      }
    });

    if (featuredIds.length > 0) {
      const placeholders = featuredIds.map(() => "?").join(",");
      const visibleRows = await dbAll(
        `SELECT id FROM manga WHERE id IN (${placeholders}) AND COALESCE(is_hidden, 0) = 0`,
        featuredIds
      );
      const visibleIdSet = new Set(
        visibleRows
          .map((row) => Number(row && row.id))
          .filter((id) => Number.isFinite(id) && id > 0)
      );
      featuredIds = featuredIds.filter((id) => visibleIdSet.has(id));
    }

    const now = new Date().toISOString();
    await dbRun(
      `
      UPDATE homepage
      SET notice_title_1 = ?, notice_body_1 = ?, notice_title_2 = ?, notice_body_2 = ?, featured_ids = ?, updated_at = ?
      WHERE id = 1
    `,
      [
        noticeTitle1,
        noticeBody1,
        noticeTitle2,
        noticeBody2,
        featuredIds.join(","),
        now
      ]
    );

    return res.redirect("/admin/homepage?status=saved");
  })
);

app.get(
  "/admin/manga",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    const teamManagePermissions = teamManageScope ? teamManageScope.permissions : null;
    if (
      teamManageScope &&
      !enforceTeamScopeAnyPermission(
        req,
        res,
        teamManageScope,
        "Bạn chưa được cấp quyền quản lý truyện/chương của nhóm này."
      )
    ) {
      return;
    }
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const rawInclude = req.query.include;
    const rawExclude = req.query.exclude;
    const legacyGenre = typeof req.query.genre === "string" ? req.query.genre.trim() : "";

    const genreStats = await getGenreStats();
    const genreIdByName = new Map(
      genreStats.map((genre) => [genre.name.toLowerCase(), genre.id])
    );

    const include = [];
    const exclude = [];
    const conditions = [];
    const params = [];

    const addFilter = (target, value) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      let resolvedId = null;
      if (/^\d+$/.test(trimmed)) {
        resolvedId = Number(trimmed);
      } else {
        resolvedId = genreIdByName.get(trimmed.toLowerCase()) || null;
      }

      if (!Number.isFinite(resolvedId) || resolvedId <= 0) return;
      const id = Math.floor(resolvedId);
      if (!target.includes(id)) {
        target.push(id);
      }
    };

    const collectFilters = (input, target) => {
      if (Array.isArray(input)) {
        input.forEach((value) => {
          if (typeof value === "string") {
            addFilter(target, value);
          }
        });
        return;
      }
      if (typeof input === "string") {
        addFilter(target, input);
      }
    };

    collectFilters(rawInclude, include);
    collectFilters(rawExclude, exclude);
    if (legacyGenre) {
      addFilter(include, legacyGenre);
    }

    const includeSet = new Set(include);
    const filteredExclude = exclude.filter((id) => !includeSet.has(id));

    if (teamManageScope) {
      conditions.push(buildTeamGroupNameMatchSql("m.group_name"));
      params.push(teamManageScope.teamName, teamManageScope.teamName);
    }

    const qNormalized = q.replace(/^#/, "").trim();
    const qId = /^\d+$/.test(qNormalized) ? Number(qNormalized) : null;
    if (qNormalized) {
      const likeValue = `%${qNormalized}%`;
      if (qId) {
        conditions.push(
          `(
            m.id = ?
            OR m.title ILIKE ?
            OR m.author ILIKE ?
            OR COALESCE(m.group_name, '') ILIKE ?
            OR COALESCE(m.other_names, '') ILIKE ?
            OR EXISTS (
              SELECT 1
              FROM manga_genres mg
              JOIN genres g ON g.id = mg.genre_id
              WHERE mg.manga_id = m.id AND g.name ILIKE ?
            )
          )`
        );
        params.push(qId, likeValue, likeValue, likeValue, likeValue, likeValue);
      } else {
        conditions.push(
          `(
            m.title ILIKE ?
            OR m.author ILIKE ?
            OR COALESCE(m.group_name, '') ILIKE ?
            OR COALESCE(m.other_names, '') ILIKE ?
            OR EXISTS (
              SELECT 1
              FROM manga_genres mg
              JOIN genres g ON g.id = mg.genre_id
              WHERE mg.manga_id = m.id AND g.name ILIKE ?
            )
          )`
        );
        params.push(likeValue, likeValue, likeValue, likeValue, likeValue);
      }
    }

    include.forEach((genreId) => {
      conditions.push(
        "EXISTS (SELECT 1 FROM manga_genres mg WHERE mg.manga_id = m.id AND mg.genre_id = ?)"
      );
      params.push(genreId);
    });

    filteredExclude.forEach((genreId) => {
      conditions.push(
        "NOT EXISTS (SELECT 1 FROM manga_genres mg WHERE mg.manga_id = m.id AND mg.genre_id = ?)"
      );
      params.push(genreId);
    });

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countRow = await dbGet(`SELECT COUNT(*) as count FROM manga m ${whereClause}`, params);
    const isJsonRequest = wantsJson(req);
    const pagination = resolvePaginationParams({
      pageInput: req.query.page,
      perPageInput: req.query.perPage,
      defaultPerPage: isJsonRequest ? 1000 : 30,
      maxPerPage: isJsonRequest ? 2000 : 100,
      totalCount: countRow && countRow.count ? Number(countRow.count) : 0
    });

    const query = `${listQueryBase} ${whereClause} ${listQueryOrder} LIMIT ? OFFSET ?`;
    const mangaRows = await dbAll(query, [...params, pagination.perPage, pagination.offset]);

    if (isJsonRequest) {
      return res.json({
        manga: mangaRows.map((row) => ({
          id: row.id,
          title: row.title,
          author: row.author,
          groupName: row.group_name,
          status: row.status,
          updatedAt: row.updated_at,
          updatedAtFormatted: formatDate(row.updated_at),
          chapterCount: row.chapter_count || 0,
          isHidden: Boolean(row.is_hidden)
        })),
        resultCount: pagination.total,
        returnedCount: mangaRows.length,
        pagination,
        filters: {
          q,
          include,
          exclude: filteredExclude
        },
        teamManageScope,
        teamManagePermissions
      });
    }

    res.render("admin/manga-list", {
      title: "Quản lý truyện",
      adminUser: adminConfig.user,
      teamManageScope,
      teamManagePermissions,
      mangaLibrary: mangaRows.map(mapMangaListRow),
      genres: genreStats,
      filters: {
        q,
        include,
        exclude: filteredExclude
      },
      resultCount: pagination.total,
      pagination
    });
  })
);

app.get(
  "/admin/manga/new",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    const teamManagePermissions = teamManageScope ? teamManageScope.permissions : null;
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canAddManga", "Bạn chưa được cấp quyền thêm truyện.")
    ) {
      return;
    }
    const oneshotGenreId = await getOneshotGenreId();
    const genres = await getGenreStats();
    const groupTeamSelections = await buildGroupTeamSelectionsForForm({
      teamManageScope,
      groupName: teamManageScope ? teamManageScope.teamName : team.name
    });
    const initialGroupName =
      buildGroupNameFromApprovedTeams(groupTeamSelections) ||
      (teamManageScope && teamManageScope.teamName
        ? (teamManageScope.teamName || "").toString().replace(/\s+/g, " ").trim()
        : "");

    res.render("admin/manga-form", {
      title: "Thêm truyện",
      adminUser: adminConfig.user,
      teamManageScope,
      teamManagePermissions,
      groupTeamSelections,
      formAction: "/admin/manga/new",
      isEdit: false,
      genres,
      oneshotGenreId,
      selectedGenreIds: [],
      manga: {
        id: 0,
        title: "",
        otherNames: "",
        author: "",
        groupName: initialGroupName,
        status: "Còn tiếp",
        description: "",
        cover: "",
        coverUpdatedAt: 0,
        slug: "",
        isOneshot: false,
        oneshotLocked: false,
        chapterCount: 0,
        canToggleOneshot: true,
        oneshotToggleDisabledReason: ""
      }
    });
  })
);

app.post(
  "/admin/manga/new",
  requireAdmin,
  uploadCover,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canAddManga", "Bạn chưa được cấp quyền thêm truyện.")
    ) {
      return;
    }
    const title = (req.body.title || "").trim();
    if (!title) {
      return res.status(400).send("Thiếu tên truyện");
    }

    const otherNames = (req.body.other_names || "").trim();
    const author = (req.body.author || "").trim();
    const groupSelection = await resolveGroupNameFromRequestPayload({
      reqBody: req.body,
      teamManageScope
    });
    if (!groupSelection.ok) {
      return res.status(400).send(groupSelection.error || "Thiếu nhóm dịch");
    }
    const groupName = groupSelection.groupName;
    const status = (req.body.status || "Còn tiếp").trim();
    const description = (req.body.description || "").trim();
    let genreIds = normalizeIdList(req.body.genre_ids);
    const requestOneshot = String(req.body.is_oneshot || "").trim() === "1";
    if (requestOneshot) {
      const oneshotGenreId = await getOneshotGenreId();
      if (oneshotGenreId) {
        genreIds = normalizeIdList([...genreIds, oneshotGenreId]);
      }
    }
    const genres = await getGenresStringByIds(genreIds);
    const now = new Date().toISOString();
    let coverBuffer = null;
    let coverTempUsed = "";
    if (req.file && req.file.buffer) {
      try {
        coverBuffer = await convertCoverToWebp(req.file.buffer);
      } catch (err) {
        const message =
          err && err.message && err.message.startsWith("Ảnh bìa")
            ? err.message
            : "Ảnh bìa không hợp lệ hoặc quá lớn.";
        return res.status(400).send(message);
      }
    }

    const coverTempToken = typeof req.body.cover_temp === "string" ? req.body.cover_temp.trim() : "";
    if (!coverBuffer && coverTempToken) {
      const tempBuffer = await loadCoverTempBuffer(coverTempToken);
      if (!tempBuffer) {
        return res.status(400).send("Ảnh bìa tạm không tồn tại hoặc đã hết hạn.");
      }
      coverBuffer = tempBuffer;
      coverTempUsed = coverTempToken;
    }
    const draftSlug = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await dbRun(
      `
      INSERT INTO manga (
        title,
        slug,
        author,
        group_name,
        other_names,
        genres,
        status,
        description,
        cover,
        cover_updated_at,
        updated_at,
        created_at,
        is_oneshot,
        oneshot_locked
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        title,
        draftSlug,
        author,
        groupName,
        otherNames,
        genres,
        status,
        description,
        null,
        null,
        now,
        now,
        requestOneshot,
        false
      ]
    );

    const slug = buildMangaSlug(result.lastID, title);
    await dbRun("UPDATE manga SET slug = ? WHERE id = ?", [slug, result.lastID]);
    await setMangaGenresByIds(result.lastID, genreIds);

    if (coverBuffer) {
      const coverFilename = `${slug}.webp`;
      await saveCoverBuffer(coverFilename, coverBuffer);
      const coverUrl = `${coversUrlPrefix}${coverFilename}`;
      const coverUpdatedAt = Date.now();
      await dbRun("UPDATE manga SET cover = ?, cover_updated_at = ? WHERE id = ?", [
        coverUrl,
        coverUpdatedAt,
        result.lastID
      ]);
      if (coverTempUsed) {
        await deleteCoverTemp(coverTempUsed);
      }
    }

    return res.redirect("/admin/manga");
  })
);

app.get(
  "/admin/manga/:id/edit",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    const teamManagePermissions = teamManageScope ? teamManageScope.permissions : null;
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canEditManga", "Bạn chưa được cấp quyền sửa truyện.")
    ) {
      return;
    }
    const mangaId = Number(req.params.id);
    if (!Number.isFinite(mangaId) || mangaId <= 0) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const mangaRow = await dbGet("SELECT * FROM manga WHERE id = ?", [Math.floor(mangaId)]);
    if (!mangaRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const oneshotGenreId = await getOneshotGenreId();
    const genres = await getGenreStats();
    const selectedRows = await dbAll(
      "SELECT genre_id FROM manga_genres WHERE manga_id = ? ORDER BY genre_id ASC",
      [mangaRow.id]
    );
    let selectedGenreIds = selectedRows
      .map((row) => Number(row.genre_id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .map((id) => Math.floor(id));
    const isOneshot = toBooleanFlag(mangaRow.is_oneshot);
    const oneshotLocked = toBooleanFlag(mangaRow.oneshot_locked);
    const chapterCountRow = await dbGet("SELECT COUNT(*) as count FROM chapters WHERE manga_id = ?", [
      mangaRow.id
    ]);
    const chapterCount = chapterCountRow ? Number(chapterCountRow.count) || 0 : 0;
    const hasMultipleChapters = chapterCount > 1;
    const hideOneshotToggle = !isOneshot && hasMultipleChapters;
    const canToggleOneshot = isOneshot || (!(oneshotLocked && !isOneshot) && !hasMultipleChapters);
    let oneshotToggleDisabledReason = "";
    if (oneshotLocked && !isOneshot) {
      oneshotToggleDisabledReason = "Truyện này đã tắt Oneshot trước đó nên không thể bật lại.";
    } else if (!hideOneshotToggle && hasMultipleChapters) {
      oneshotToggleDisabledReason = "Chỉ có thể bật Oneshot khi truyện có tối đa 1 chương.";
    }

    if (isOneshot && oneshotGenreId && !selectedGenreIds.includes(oneshotGenreId)) {
      selectedGenreIds = [...selectedGenreIds, oneshotGenreId];
    }

    const groupTeamSelections = await buildGroupTeamSelectionsForForm({
      teamManageScope,
      groupName: mangaRow.group_name || ""
    });
    const initialGroupName =
      buildGroupNameFromApprovedTeams(groupTeamSelections) ||
      (teamManageScope && teamManageScope.teamName
        ? (teamManageScope.teamName || "").toString().replace(/\s+/g, " ").trim()
        : "");

    res.render("admin/manga-form", {
      title: "Chỉnh sửa truyện",
      adminUser: adminConfig.user,
      teamManageScope,
      teamManagePermissions,
      groupTeamSelections,
      formAction: `/admin/manga/${mangaRow.id}/edit`,
      isEdit: true,
      genres,
      oneshotGenreId,
      selectedGenreIds,
      manga: {
        id: mangaRow.id,
        title: mangaRow.title || "",
        otherNames: mangaRow.other_names || "",
        author: mangaRow.author || "",
        groupName: initialGroupName,
        status: mangaRow.status || "Còn tiếp",
        description: mangaRow.description || "",
        cover: mangaRow.cover || "",
        coverUpdatedAt: Number(mangaRow.cover_updated_at) || 0,
        slug: mangaRow.slug || "",
        isOneshot,
        oneshotLocked,
        chapterCount,
        hideOneshotToggle,
        canToggleOneshot,
        oneshotToggleDisabledReason
      }
    });
  })
);

app.post(
  "/admin/manga/:id/edit",
  requireAdmin,
  uploadCover,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canEditManga", "Bạn chưa được cấp quyền sửa truyện.")
    ) {
      return;
    }
    const mangaId = Number(req.params.id);
    if (!Number.isFinite(mangaId) || mangaId <= 0) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const mangaRow = await dbGet(
      "SELECT id, cover, cover_updated_at, COALESCE(is_oneshot, false) as is_oneshot, COALESCE(oneshot_locked, false) as oneshot_locked FROM manga WHERE id = ?",
      [Math.floor(mangaId)]
    );
    if (!mangaRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const title = (req.body.title || "").trim();
    if (!title) {
      return res.status(400).send("Thiếu tên truyện");
    }

    const otherNames = (req.body.other_names || "").trim();
    const author = (req.body.author || "").trim();
    const groupSelection = await resolveGroupNameFromRequestPayload({
      reqBody: req.body,
      teamManageScope
    });
    if (!groupSelection.ok) {
      return res.status(400).send(groupSelection.error || "Thiếu nhóm dịch");
    }
    const groupName = groupSelection.groupName;
    let genreIds = normalizeIdList(req.body.genre_ids);
    const requestOneshot = String(req.body.is_oneshot || "").trim() === "1";
    const currentIsOneshot = toBooleanFlag(mangaRow.is_oneshot);
    const currentOneshotLocked = toBooleanFlag(mangaRow.oneshot_locked);
    const chapterCountRow = await dbGet("SELECT COUNT(*) as count FROM chapters WHERE manga_id = ?", [
      mangaRow.id
    ]);
    const chapterCount = chapterCountRow ? Number(chapterCountRow.count) || 0 : 0;

    if (requestOneshot && currentOneshotLocked && !currentIsOneshot) {
      return res.status(400).send("Truyện đã tắt Oneshot trước đó và không thể bật lại.");
    }

    if (requestOneshot && !currentIsOneshot && chapterCount > 1) {
      return res.status(400).send("Chỉ có thể bật Oneshot khi truyện có tối đa 1 chương.");
    }

    let nextIsOneshot = currentIsOneshot;
    let nextOneshotLocked = currentOneshotLocked;

    if (requestOneshot && !currentIsOneshot) {
      nextIsOneshot = true;
    }

    if (!requestOneshot && currentIsOneshot) {
      nextIsOneshot = false;
      nextOneshotLocked = true;
    }

    if (nextIsOneshot) {
      const oneshotGenreId = await getOneshotGenreId();
      if (oneshotGenreId) {
        genreIds = normalizeIdList([...genreIds, oneshotGenreId]);
      }
    }

    const genres = await getGenresStringByIds(genreIds);
    const status = (req.body.status || "Còn tiếp").trim();
    const description = (req.body.description || "").trim();
    const slug = buildMangaSlug(mangaRow.id, title);

    let cover = mangaRow.cover || null;
    let coverUpdatedAt = Number(mangaRow.cover_updated_at) || 0;
    const coverTempToken = typeof req.body.cover_temp === "string" ? req.body.cover_temp.trim() : "";
    let nextCoverBuffer = null;
    let coverTempUsed = "";

    if (req.file && req.file.buffer) {
      try {
        nextCoverBuffer = await convertCoverToWebp(req.file.buffer);
      } catch (err) {
        const message =
          err && err.message && err.message.startsWith("Ảnh bìa")
            ? err.message
            : "Ảnh bìa không hợp lệ hoặc quá lớn.";
        return res.status(400).send(message);
      }
    } else if (coverTempToken) {
      const tempBuffer = await loadCoverTempBuffer(coverTempToken);
      if (!tempBuffer) {
        return res.status(400).send("Ảnh bìa tạm không tồn tại hoặc đã hết hạn.");
      }
      nextCoverBuffer = tempBuffer;
      coverTempUsed = coverTempToken;
    }

    if (nextCoverBuffer) {
      const coverFilename = `${slug}.webp`;
      await saveCoverBuffer(coverFilename, nextCoverBuffer);
      const coverUrl = `${coversUrlPrefix}${coverFilename}`;

      const oldFilename = extractLocalCoverFilename(cover);
      if (oldFilename && oldFilename !== coverFilename) {
        await deleteFileIfExists(path.join(coversDir, oldFilename));
      }

      cover = coverUrl;
      coverUpdatedAt = Date.now();

      if (coverTempUsed) {
        await deleteCoverTemp(coverTempUsed);
      }
    }

    if (currentIsOneshot && !nextIsOneshot) {
      const chapterRows = await dbAll(
        "SELECT id, number, COALESCE(is_oneshot, false) as is_oneshot FROM chapters WHERE manga_id = ? ORDER BY number ASC, id ASC",
        [mangaRow.id]
      );
      const explicitOneshot = chapterRows.find((row) => toBooleanFlag(row && row.is_oneshot));
      const fallbackSingle = chapterRows.length === 1 ? chapterRows[0] : null;
      const targetChapter = explicitOneshot || fallbackSingle || null;

      if (targetChapter) {
        const oldNumber = Number(targetChapter.number);
        const hasOldNumber = Number.isFinite(oldNumber);
        const duplicateZero = chapterRows.some(
          (row) => Number(row.id) !== Number(targetChapter.id) && Number(row.number) === 0
        );
        if (duplicateZero) {
          return res.status(400).send("Không thể tắt Oneshot vì đã tồn tại chương 0.");
        }

        if (hasOldNumber && Math.abs(oldNumber) > 1e-9) {
          await dbRun("UPDATE comments SET chapter_number = ? WHERE manga_id = ? AND chapter_number = ?", [
            0,
            mangaRow.id,
            oldNumber
          ]);
        }

        await dbRun("UPDATE chapters SET number = ?, is_oneshot = false WHERE id = ?", [
          0,
          targetChapter.id
        ]);
      } else {
        await dbRun("UPDATE chapters SET is_oneshot = false WHERE manga_id = ?", [mangaRow.id]);
      }
    }

    if (nextIsOneshot && chapterCount === 1) {
      await dbRun("UPDATE chapters SET is_oneshot = true WHERE manga_id = ?", [mangaRow.id]);
    }

    await dbRun(
      `
      UPDATE manga
      SET
        title = ?,
        slug = ?,
        author = ?,
        group_name = ?,
        other_names = ?,
        genres = ?,
        status = ?,
        description = ?,
        cover = ?,
        cover_updated_at = ?,
        is_oneshot = ?,
        oneshot_locked = ?
      WHERE id = ?
    `,
      [
        title,
        slug,
        author,
        groupName,
        otherNames,
        genres,
        status,
        description,
        cover,
        coverUpdatedAt,
        nextIsOneshot,
        nextOneshotLocked,
        mangaRow.id
      ]
    );

    await setMangaGenresByIds(mangaRow.id, genreIds);

    return res.redirect("/admin/manga");
  })
);

app.post(
  "/admin/manga/:id/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canDeleteManga", "Bạn chưa được cấp quyền xóa truyện.")
    ) {
      return;
    }
    const referer = req.get("referer") || "/admin/manga";
    const mangaId = Number(req.params.id);
    if (!Number.isFinite(mangaId) || mangaId <= 0) {
      if (wantsJson(req)) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy truyện" });
      }
      return res.redirect(referer);
    }

    const safeMangaId = Math.floor(mangaId);
    if (wantsJson(req)) {
      const jobId = createAdminJob({
        type: "delete-manga",
        run: async () => {
          await deleteMangaAndCleanupStorage(safeMangaId);
        }
      });
      return res.json({ ok: true, jobId });
    }

    try {
      await deleteMangaAndCleanupStorage(safeMangaId);
    } catch (err) {
      return res.status(500).send(normalizeAdminJobError(err));
    }
    return res.redirect(referer);
  })
);

app.post(
  "/admin/manga/:id/visibility",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canEditManga", "Bạn chưa được cấp quyền sửa truyện.")
    ) {
      return;
    }
    const referer = req.get("referer") || "/admin/manga";
    const mangaId = Number(req.params.id);
    if (!Number.isFinite(mangaId) || mangaId <= 0) {
      return res.redirect(referer);
    }

    const rawHidden = typeof req.body.hidden === "string" ? req.body.hidden.trim() : "";
    const hidden = rawHidden === "1" ? 1 : rawHidden === "0" ? 0 : null;
    if (hidden === null) {
      return res.redirect(referer);
    }

    await dbRun("UPDATE manga SET is_hidden = ? WHERE id = ?", [hidden, Math.floor(mangaId)]);
    return res.redirect(referer);
  })
);

app.get(
  "/admin/manga/:id/chapters",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    const teamManagePermissions = teamManageScope ? teamManageScope.permissions : null;
    if (
      teamManageScope &&
      !enforceTeamScopeAnyOfPermissions(
        req,
        res,
        teamManageScope,
        ["canAddChapter", "canEditChapter", "canDeleteChapter"],
        "Bạn chưa được cấp quyền quản lý chương truyện."
      )
    ) {
      return;
    }
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const deleted = Number(req.query.deleted);
    const mangaRow = await dbGet("SELECT * FROM manga WHERE id = ?", [req.params.id]);
    if (!mangaRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const chapterRows = await dbAll(
      `
        SELECT
          id,
          number,
          title,
          pages,
          date,
          group_name,
          COALESCE(is_oneshot, false) as is_oneshot,
          processing_state,
          processing_error,
          CASE
            WHEN COALESCE(password_hash, '') <> '' AND COALESCE(password_salt, '') <> '' THEN true
            ELSE false
          END AS has_password
        FROM chapters
        WHERE manga_id = ?
        ORDER BY number DESC
      `,
      [mangaRow.id]
    );
    const chapters = chapterRows.map((chapter) => ({
      ...chapter,
      is_oneshot: toBooleanFlag(chapter && chapter.is_oneshot),
      has_password: toBooleanFlag(chapter && chapter.has_password)
    }));
    const isOneshotManga = toBooleanFlag(mangaRow.is_oneshot);
    const canCreateChapterByPermission = !teamManageScope || teamScopeHasPermission(teamManageScope, "canAddChapter");
    const canCreateChapter = canCreateChapterByPermission && (!isOneshotManga || chapters.length === 0);
    const canEditChapter = !teamManageScope || teamScopeHasPermission(teamManageScope, "canEditChapter");
    const canDeleteChapter = !teamManageScope || teamScopeHasPermission(teamManageScope, "canDeleteChapter");
    const createChapterLabel = isOneshotManga ? "Thêm Oneshot" : "Thêm chương mới";
    const currentMax = chapters.length ? Number(chapters[0].number) : 0;
    const nextNumber = Number.isFinite(currentMax) ? Math.floor(currentMax) + 1 : 1;
    const today = new Date().toISOString().slice(0, 10);

    res.render("admin/chapters", {
      title: "Quản lý chương",
      adminUser: adminConfig.user,
      teamManageScope,
      teamManagePermissions,
      manga: mangaRow,
      chapters,
      canCreateChapter,
      canCreateChapterByPermission,
      canEditChapter,
      canDeleteChapter,
      createChapterLabel,
      nextNumber,
      today,
      status,
      deleted: Number.isFinite(deleted) ? Math.max(0, Math.floor(deleted)) : 0
    });
  })
);

app.post(
  "/admin/manga/:id/chapters/bulk-delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(
        req,
        res,
        teamManageScope,
        "canDeleteChapter",
        "Bạn chưa được cấp quyền xóa chương truyện."
      )
    ) {
      return;
    }
    const mangaRow = await dbGet("SELECT id FROM manga WHERE id = ?", [req.params.id]);
    if (!mangaRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const rawIds = Array.isArray(req.body.chapter_ids)
      ? req.body.chapter_ids
      : req.body.chapter_ids != null
        ? [req.body.chapter_ids]
        : [];

    const chapterIds = Array.from(
      new Set(
        rawIds
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))
      )
    );

    const buildRedirectUrl = (nextStatus, nextDeleted) => {
      const params = new URLSearchParams();
      if (nextStatus) params.set("status", nextStatus);
      if (Number.isFinite(nextDeleted) && nextDeleted > 0) {
        params.set("deleted", String(Math.floor(nextDeleted)));
      }
      return `/admin/manga/${mangaRow.id}/chapters${params.toString() ? `?${params.toString()}` : ""}`;
    };

    if (!chapterIds.length) {
      return res.redirect(buildRedirectUrl("bulk_missing"));
    }

    const placeholders = chapterIds.map(() => "?").join(",");
    const chapterRows = await dbAll(
      `SELECT id FROM chapters WHERE manga_id = ? AND id IN (${placeholders})`,
      [mangaRow.id, ...chapterIds]
    );
    const validIds = chapterRows
      .map((row) => Number(row && row.id))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.floor(value));

    if (!validIds.length) {
      return res.redirect(buildRedirectUrl("bulk_missing"));
    }

    let deletedCount = 0;
    try {
      for (const chapterId of validIds) {
        const result = await deleteChapterAndCleanupStorage(chapterId);
        if (result && result.mangaId) {
          deletedCount += 1;
        }
      }
    } catch (err) {
      return res.status(500).send(normalizeAdminJobError(err));
    }

    if (!deletedCount) {
      return res.redirect(buildRedirectUrl("bulk_missing"));
    }
    return res.redirect(buildRedirectUrl("bulk_deleted", deletedCount));
  })
);

app.get(
  "/admin/jobs/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopeAnyPermission(
        req,
        res,
        teamManageScope,
        "Bạn chưa được cấp quyền quản lý truyện/chương của nhóm này."
      )
    ) {
      return;
    }

    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    const id = (req.params.id || "").toString().trim();
    if (!id) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy tiến trình." });
    }

    const job = adminJobs.get(id);
    if (!job) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy tiến trình." });
    }

    const state = (job.state || "").toString();
    return res.json({
      ok: true,
      id: job.id,
      type: job.type,
      state,
      error: state === "failed" ? String(job.error || "").trim() : ""
    });
  })
);

app.get(
  "/admin/chapters/processing/status",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopeAnyOfPermissions(
        req,
        res,
        teamManageScope,
        ["canAddChapter", "canEditChapter", "canDeleteChapter"],
        "Bạn chưa được cấp quyền quản lý chương truyện."
      )
    ) {
      return;
    }
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    const rawIds = typeof req.query.ids === "string" ? req.query.ids.trim() : "";
    if (!rawIds) {
      return res.json({ ok: true, chapters: [] });
    }

    const ids = Array.from(
      new Set(
        rawIds
          .split(",")
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))
      )
    ).slice(0, 80);

    if (!ids.length) {
      return res.json({ ok: true, chapters: [] });
    }

    const placeholders = ids.map(() => "?").join(",");
    const rows = teamManageScope
      ? await dbAll(
        `
          SELECT c.id, c.processing_state, c.processing_error
          FROM chapters c
          JOIN manga m ON m.id = c.manga_id
          WHERE c.id IN (${placeholders})
            AND ${buildTeamGroupNameMatchSql("m.group_name")}
        `,
        [...ids, teamManageScope.teamName, teamManageScope.teamName]
      )
      : await dbAll(
        `
          SELECT id, processing_state, processing_error
          FROM chapters
          WHERE id IN (${placeholders})
        `,
        ids
      );

    return res.json({
      ok: true,
      chapters: rows.map((row) => ({
        id: row.id,
        processingState: (row.processing_state || "").toString(),
        processingError: (row.processing_error || "").toString()
      }))
    });
  })
);

app.get(
  "/admin/manga/:id/chapters/new",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    const teamManagePermissions = teamManageScope ? teamManageScope.permissions : null;
    if (
      teamManageScope &&
      !enforceTeamScopePermission(
        req,
        res,
        teamManageScope,
        "canAddChapter",
        "Bạn chưa được cấp quyền thêm chương truyện."
      )
    ) {
      return;
    }
    const mangaRow = await dbGet("SELECT * FROM manga WHERE id = ?", [req.params.id]);
    if (!mangaRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const chapterNumberRows = await dbAll(
      "SELECT number FROM chapters WHERE manga_id = ? ORDER BY number ASC",
      [mangaRow.id]
    );
    const chapterNumbers = chapterNumberRows
      .map((row) => (row ? Number(row.number) : NaN))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const isOneshotManga = toBooleanFlag(mangaRow.is_oneshot);

    if (isOneshotManga && chapterNumbers.length > 0) {
      return res.redirect(`/admin/manga/${mangaRow.id}/chapters?status=oneshot_exists`);
    }

    const maxNumber = chapterNumbers.length ? Math.max(...chapterNumbers) : 0;
    const nextNumber = isOneshotManga
      ? 0
      : Number.isFinite(maxNumber)
        ? Math.floor(maxNumber) + 1
        : 1;
    const today = new Date().toISOString().slice(0, 10);

    const config = getB2Config();
    const b2Ready = isB2Ready(config);
    let draft = null;
    if (b2Ready) {
      try {
        draft = await createChapterDraft(mangaRow.id);
      } catch (err) {
        console.warn("Failed to create chapter draft", err);
        draft = null;
      }
    }

    const draftTtlMinutes = Math.round(chapterDraftTtlMs / 60000) || 180;
    const draftTtlLabel =
      draftTtlMinutes >= 60 && draftTtlMinutes % 60 === 0
        ? `${Math.round(draftTtlMinutes / 60)} giờ`
        : `${draftTtlMinutes} phút`;

    const chapterInitialGroupName = (mangaRow.group_name || (teamManageScope ? teamManageScope.teamName : team.name) || "").toString();
    const groupTeamSelections = await buildGroupTeamSelectionsForForm({
      teamManageScope,
      groupName: chapterInitialGroupName
    });
    const chapterGroupName =
      buildGroupNameFromApprovedTeams(groupTeamSelections) ||
      (teamManageScope && teamManageScope.teamName
        ? (teamManageScope.teamName || "").toString().replace(/\s+/g, " ").trim()
        : "");

    return res.render("admin/chapter-new", {
      title: isOneshotManga ? "Thêm Oneshot" : "Thêm chương mới",
      adminUser: adminConfig.user,
      teamManageScope,
      teamManagePermissions,
      manga: mangaRow,
      groupTeamSelections,
      chapterGroupName,
      chapterNumbers,
      isOneshotManga,
      nextNumber,
      today,
      b2Ready,
      draftToken: draft ? draft.token : "",
      draftTtlMinutes,
      draftTtlLabel,
      chapterPasswordMinLength: CHAPTER_PASSWORD_MIN_LENGTH,
      chapterPasswordMaxLength: CHAPTER_PASSWORD_MAX_LENGTH
    });
  })
);

app.post(
  "/admin/chapter-drafts/:token/touch",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopeAnyOfPermissions(
        req,
        res,
        teamManageScope,
        ["canAddChapter", "canEditChapter"],
        "Bạn chưa được cấp quyền upload/sửa chương truyện."
      )
    ) {
      return;
    }
    const token = (req.params.token || "").toString().trim();
    if (!isChapterDraftTokenValid(token)) {
      return res.status(404).json({ ok: false, error: "Draft không hợp lệ." });
    }

    const draft = await getChapterDraft(token);
    if (!draft) {
      return res.status(404).json({ ok: false, error: "Draft không tồn tại hoặc đã hết hạn." });
    }

    await touchChapterDraft(token);
    return res.json({ ok: true });
  })
);

app.post(
  "/admin/chapter-drafts/:token/pages/upload",
  requireAdmin,
  uploadChapterPage,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopeAnyOfPermissions(
        req,
        res,
        teamManageScope,
        ["canAddChapter", "canEditChapter"],
        "Bạn chưa được cấp quyền upload/sửa chương truyện."
      )
    ) {
      return;
    }
    const token = (req.params.token || "").toString().trim();
    if (!isChapterDraftTokenValid(token)) {
      return res.status(404).send("Không tìm thấy draft chương.");
    }

    const config = getB2Config();
    if (!isB2Ready(config)) {
      return res.status(500).send("Thiếu cấu hình lưu trữ ảnh trong .env");
    }

    const draft = await getChapterDraft(token);
    if (!draft) {
      return res.status(404).send("Draft chương không tồn tại hoặc đã hết hạn.");
    }

    const pageId = (req.query.id || req.body.id || "").toString().trim();
    if (!isChapterDraftPageIdValid(pageId)) {
      return res.status(400).send("ID ảnh trang không hợp lệ.");
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).send("Chưa chọn ảnh trang.");
    }

    let webpBuffer = null;
    try {
      webpBuffer = await convertChapterPageToWebp(req.file.buffer);
    } catch (_err) {
      return res.status(400).send("Ảnh trang không hợp lệ.");
    }

    const prefix = (draft.pages_prefix || "").toString().trim();
    if (!prefix) {
      return res.status(500).send("Draft chương không hợp lệ.");
    }

    const fileName = `${prefix}/${pageId}.webp`;
    try {
      await b2UploadBuffer({
        fileName,
        buffer: webpBuffer,
        contentType: "image/webp"
      });
    } catch (err) {
      console.warn("Draft page upload failed", err);
      return res.status(500).send("Upload ảnh thất bại.");
    }

    await touchChapterDraft(token);
    const url = `${config.cdnBaseUrl}/${fileName}`;
    if (wantsJson(req)) {
      return res.json({ ok: true, id: pageId, fileName, url });
    }
    return res.send("OK");
  })
);

app.post(
  "/admin/chapter-drafts/:token/pages/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopeAnyOfPermissions(
        req,
        res,
        teamManageScope,
        ["canAddChapter", "canEditChapter"],
        "Bạn chưa được cấp quyền upload/sửa chương truyện."
      )
    ) {
      return;
    }
    const token = (req.params.token || "").toString().trim();
    if (!isChapterDraftTokenValid(token)) {
      return res.status(404).json({ ok: false, error: "Draft không hợp lệ." });
    }

    const config = getB2Config();
    if (!isB2Ready(config)) {
      return res.status(500).json({ ok: false, error: "Thiếu cấu hình lưu trữ ảnh trong .env" });
    }

    const draft = await getChapterDraft(token);
    if (!draft) {
      return res.status(404).json({ ok: false, error: "Draft không tồn tại hoặc đã hết hạn." });
    }

    const pageId = (req.body && req.body.id ? req.body.id : "").toString().trim();
    if (!isChapterDraftPageIdValid(pageId)) {
      return res.status(400).json({ ok: false, error: "ID ảnh trang không hợp lệ." });
    }

    const prefix = (draft.pages_prefix || "").toString().trim();
    if (!prefix) {
      return res.status(500).json({ ok: false, error: "Draft chương không hợp lệ." });
    }

    const target = `${prefix}/${pageId}.webp`;
    let deleted = 0;
    try {
      const versions = await b2ListFileVersionsByPrefix(target);
      deleted = await b2DeleteFileVersions(versions);
    } catch (err) {
      console.warn("Draft page delete failed", err);
      return res.status(500).json({ ok: false, error: "Xóa ảnh thất bại." });
    }

    await touchChapterDraft(token);
    return res.json({ ok: true, deleted });
  })
);

app.post(
  "/admin/manga/:id/chapters/new",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(
        req,
        res,
        teamManageScope,
        "canAddChapter",
        "Bạn chưa được cấp quyền thêm chương truyện."
      )
    ) {
      return;
    }
    const mangaRow = await dbGet("SELECT * FROM manga WHERE id = ?", [req.params.id]);
    if (!mangaRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const config = getB2Config();
    if (!isB2Ready(config)) {
      return res.status(500).send("Thiếu cấu hình lưu trữ ảnh trong .env");
    }

    const isOneshotManga = toBooleanFlag(mangaRow.is_oneshot);
    const chapterCountRow = await dbGet("SELECT COUNT(*) as count FROM chapters WHERE manga_id = ?", [
      mangaRow.id
    ]);
    const chapterCount = chapterCountRow ? Number(chapterCountRow.count) || 0 : 0;
    if (isOneshotManga && chapterCount > 0) {
      return res.status(400).send("Truyện Oneshot chỉ có thể có một chương.");
    }

    const parsedNumber = parseChapterNumberInput(req.body.number);
    const number = isOneshotManga ? 0 : parsedNumber;
    if (number == null || number < 0) {
      return res.status(400).send("Số chương không hợp lệ.");
    }
    const isChapterOneshot = isOneshotManga;

    const token = (req.body.draft_token || "").toString().trim();
    if (!isChapterDraftTokenValid(token)) {
      return res.status(400).send("Draft chương không hợp lệ hoặc đã hết hạn.");
    }

    const draft = await getChapterDraft(token);
    if (!draft || Number(draft.manga_id) !== Number(mangaRow.id)) {
      return res.status(400).send("Draft chương không hợp lệ hoặc đã hết hạn.");
    }

    let pageIds = [];
    const rawPageIds = (req.body.draft_pages || "").toString().trim();
    if (rawPageIds) {
      let parsed = null;
      try {
        parsed = JSON.parse(rawPageIds);
      } catch (_err) {
        return res.status(400).send("Danh sách ảnh trang không hợp lệ.");
      }
      if (Array.isArray(parsed)) {
        pageIds = parsed.map((value) => (value == null ? "" : String(value).trim())).filter(Boolean);
      }
    }

    pageIds = Array.from(new Set(pageIds));
    if (!pageIds.length) {
      return res.status(400).send("Chưa có ảnh trang nào được upload.");
    }
    if (pageIds.length > 220) {
      return res.status(400).send("Số lượng ảnh trang quá nhiều.");
    }
    if (pageIds.some((id) => !isChapterDraftPageIdValid(id))) {
      return res.status(400).send("Danh sách ảnh trang không hợp lệ.");
    }

    const existing = await dbGet(
      "SELECT 1 FROM chapters WHERE manga_id = ? AND number = ?",
      [mangaRow.id, number]
    );
    if (existing) {
      return res.status(400).send("Chương đã tồn tại");
    }

    const title = (req.body.title || "").toString().trim();
    const groupSelection = await resolveGroupNameFromRequestPayload({
      reqBody: req.body,
      teamManageScope
    });
    if (!groupSelection.ok) {
      return res.status(400).send(groupSelection.error || "Thiếu thông tin chương");
    }
    const groupName = groupSelection.groupName;
    const chapterPasswordPayload = parseChapterPasswordUpdatePayload({
      reqBody: req.body,
      allowKeep: false,
      hasExistingPassword: false
    });
    if (!chapterPasswordPayload.ok) {
      return res.status(400).send(chapterPasswordPayload.error || buildChapterPasswordLengthError());
    }
    const date = buildChapterTimestampIso();

    const prefix = (draft.pages_prefix || "").toString().trim();
    if (!prefix) {
      return res.status(500).send("Draft chương không hợp lệ.");
    }

    const processingPagesJson = JSON.stringify(pageIds);
    const processingStamp = Date.now();

    const result = await dbRun(
      `
      INSERT INTO chapters (
        manga_id,
        number,
        title,
        pages,
        date,
        group_name,
        is_oneshot,
        password_hash,
        password_salt,
        password_updated_at,
        processing_state,
        processing_error,
        processing_draft_token,
        processing_pages_json,
        processing_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        mangaRow.id,
        number,
        title,
        pageIds.length,
        date,
        groupName,
        isChapterOneshot,
        chapterPasswordPayload.passwordHash,
        chapterPasswordPayload.passwordSalt,
        chapterPasswordPayload.passwordUpdatedAt,
        "processing",
        "",
        token,
        processingPagesJson,
        processingStamp
      ]
    );

    await markMangaUpdatedAtForNewChapter(mangaRow.id, date);
    try {
      await notifyBookmarkedUsersForNewChapter({
        mangaId: mangaRow.id,
        chapterNumber: number
      });
    } catch (err) {
      console.warn("Failed to notify bookmarked readers for new chapter", err);
    }
    enqueueChapterProcessing(result.lastID);
    return res.redirect(`/admin/manga/${mangaRow.id}/chapters?status=processing`);
  })
);

app.post(
  "/admin/manga/:id/chapters",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(
        req,
        res,
        teamManageScope,
        "canAddChapter",
        "Bạn chưa được cấp quyền thêm chương truyện."
      )
    ) {
      return;
    }
    const mangaRow = await dbGet("SELECT * FROM manga WHERE id = ?", [req.params.id]);
    if (!mangaRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const isOneshotManga = toBooleanFlag(mangaRow.is_oneshot);
    const chapterCountRow = await dbGet("SELECT COUNT(*) as count FROM chapters WHERE manga_id = ?", [
      mangaRow.id
    ]);
    const chapterCount = chapterCountRow ? Number(chapterCountRow.count) || 0 : 0;
    if (isOneshotManga && chapterCount > 0) {
      return res.status(400).send("Truyện Oneshot chỉ có thể có một chương.");
    }

    const parsedNumber = parseChapterNumberInput(req.body.number);
    const number = isOneshotManga ? 0 : parsedNumber;
    const isChapterOneshot = isOneshotManga;
    const title = (req.body.title || "").trim();
    const groupSelection = await resolveGroupNameFromRequestPayload({
      reqBody: req.body,
      teamManageScope
    });
    if (!groupSelection.ok) {
      return res.status(400).send(groupSelection.error || "Thiếu thông tin chương");
    }
    const groupName = groupSelection.groupName;
    const chapterPasswordPayload = parseChapterPasswordUpdatePayload({
      reqBody: req.body,
      allowKeep: false,
      hasExistingPassword: false
    });
    if (!chapterPasswordPayload.ok) {
      return res.status(400).send(chapterPasswordPayload.error || buildChapterPasswordLengthError());
    }
    const pages = Math.max(Number(req.body.pages) || 0, 1);
    const date = buildChapterTimestampIso(req.body.date);

    if (number == null || number < 0 || !groupName || !date) {
      return res.status(400).send("Thiếu thông tin chương");
    }

    const existing = await dbGet(
      "SELECT 1 FROM chapters WHERE manga_id = ? AND number = ?",
      [mangaRow.id, number]
    );
    if (existing) {
      return res.status(400).send("Chương đã tồn tại");
    }

    await dbRun(
      `
      INSERT INTO chapters (
        manga_id,
        number,
        title,
        pages,
        date,
        group_name,
        is_oneshot,
        password_hash,
        password_salt,
        password_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        mangaRow.id,
        number,
        title,
        pages,
        date,
        groupName,
        isChapterOneshot,
        chapterPasswordPayload.passwordHash,
        chapterPasswordPayload.passwordSalt,
        chapterPasswordPayload.passwordUpdatedAt
      ]
    );

    await markMangaUpdatedAtForNewChapter(mangaRow.id, date);
    try {
      await notifyBookmarkedUsersForNewChapter({
        mangaId: mangaRow.id,
        chapterNumber: number
      });
    } catch (err) {
      console.warn("Failed to notify bookmarked readers for new chapter", err);
    }
    return res.redirect(`/admin/manga/${mangaRow.id}/chapters`);
  })
);

app.get(
  "/admin/chapters/:id/edit",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    const teamManagePermissions = teamManageScope ? teamManageScope.permissions : null;
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canEditChapter", "Bạn chưa được cấp quyền sửa chương truyện.")
    ) {
      return;
    }
    const chapterId = Number(req.params.id);
    if (!Number.isFinite(chapterId) || chapterId <= 0) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const chapterRow = await dbGet(
      `
      SELECT
        c.id,
        c.manga_id,
        c.number,
        c.title,
        c.pages,
        c.pages_prefix,
        c.pages_ext,
        c.pages_updated_at,
        c.is_oneshot,
        c.date,
        c.group_name,
        c.password_hash,
        c.password_salt,
        c.password_updated_at,
        m.title as manga_title,
        m.slug as manga_slug
      FROM chapters c
      JOIN manga m ON m.id = c.manga_id
      WHERE c.id = ?
    `,
      [Math.floor(chapterId)]
    );

    if (!chapterRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const config = getB2Config();
    const b2Ready = isB2Ready(config);
    let draft = null;
    if (b2Ready) {
      try {
        draft = await createChapterDraft(chapterRow.manga_id);
      } catch (err) {
        console.warn("Failed to create chapter draft", err);
        draft = null;
      }
    }

    const draftTtlMinutes = Math.round(chapterDraftTtlMs / 60000) || 180;
    const draftTtlLabel =
      draftTtlMinutes >= 60 && draftTtlMinutes % 60 === 0
        ? `${Math.round(draftTtlMinutes / 60)} giờ`
        : `${draftTtlMinutes} phút`;

    const pagesPrefix = (chapterRow.pages_prefix || "").toString().trim();
    const pagesExt = (chapterRow.pages_ext || "").toString().trim() || "webp";
    const pagesUpdatedAt = Number(chapterRow.pages_updated_at) || 0;
    const pageCount = Math.max(Number(chapterRow.pages) || 0, 0);
    const padLength = Math.max(3, String(pageCount).length);

    const chapterNumberRows = await dbAll(
      "SELECT number FROM chapters WHERE manga_id = ? ORDER BY number ASC",
      [chapterRow.manga_id]
    );
    const currentNumber = Number(chapterRow.number);
    const chapterNumbers = chapterNumberRows
      .map((row) => (row ? Number(row.number) : NaN))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .filter((value) => (Number.isFinite(currentNumber) ? Math.abs(value - currentNumber) > 1e-9 : true));

    const groupTeamSelections = await buildGroupTeamSelectionsForForm({
      teamManageScope,
      groupName: chapterRow.group_name || ""
    });
    const chapterGroupName =
      buildGroupNameFromApprovedTeams(groupTeamSelections) ||
      (teamManageScope && teamManageScope.teamName
        ? (teamManageScope.teamName || "").toString().replace(/\s+/g, " ").trim()
        : "");
    const hasExistingChapterPassword = Boolean(
      (chapterRow.password_hash || "").toString().trim() &&
        (chapterRow.password_salt || "").toString().trim()
    );
    const chapterPasswordPrefillToken = hasExistingChapterPassword
      ? `__chapter_password_prefill__${crypto.randomBytes(12).toString("hex")}`
      : "";

    const existingPageIds = [];
    const existingPages = [];
    const initialPages = [];
    if (pageCount > 0 && pagesPrefix && config.cdnBaseUrl) {
      for (let page = 1; page <= pageCount; page += 1) {
        const id = buildChapterExistingPageId(chapterRow.id, page);
        const pageName = String(page).padStart(padLength, "0");
        const rawUrl = `${config.cdnBaseUrl}/${pagesPrefix}/${pageName}.${pagesExt}`;
        const url = cacheBust(rawUrl, pagesUpdatedAt || Date.now());
        existingPageIds.push(id);
        existingPages.push({ id, page });
        initialPages.push({ id, page, url });
      }
    }

    res.render("admin/chapter-form", {
      title: "Chỉnh sửa chương",
      adminUser: adminConfig.user,
      teamManageScope,
      teamManagePermissions,
      groupTeamSelections,
      chapterGroupName,
      formAction: `/admin/chapters/${chapterRow.id}/edit`,
      b2Ready,
      draftToken: draft ? draft.token : "",
      draftTtlMinutes,
      draftTtlLabel,
      initialPages,
      existingPages,
      existingPageIds,
      chapterNumbers,
      chapter: {
        id: chapterRow.id,
        mangaId: chapterRow.manga_id,
        mangaTitle: chapterRow.manga_title,
        mangaSlug: chapterRow.manga_slug,
        number: chapterRow.number,
        isOneshot: toBooleanFlag(chapterRow.is_oneshot),
        title: chapterRow.title,
        pages: chapterRow.pages,
        date: chapterRow.date,
        groupName: chapterGroupName,
        hasPassword: hasExistingChapterPassword
      },
      chapterPasswordPrefillToken,
      chapterPasswordMinLength: CHAPTER_PASSWORD_MIN_LENGTH,
      chapterPasswordMaxLength: CHAPTER_PASSWORD_MAX_LENGTH
    });
  })
);

app.post(
  "/admin/chapters/:id/edit",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canEditChapter", "Bạn chưa được cấp quyền sửa chương truyện.")
    ) {
      return;
    }
    const chapterId = Number(req.params.id);
    if (!Number.isFinite(chapterId) || chapterId <= 0) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const chapterRow = await dbGet(
      `
        SELECT
          id,
          manga_id,
          number,
          pages,
          pages_prefix,
          password_hash,
          password_salt,
          password_updated_at
        FROM chapters
        WHERE id = ?
      `,
      [Math.floor(chapterId)]
    );
    if (!chapterRow) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    const mangaMetaRow = await dbGet(
      "SELECT COALESCE(is_oneshot, false) as is_oneshot FROM manga WHERE id = ?",
      [chapterRow.manga_id]
    );
    const isOneshotManga = toBooleanFlag(mangaMetaRow && mangaMetaRow.is_oneshot);

    const parsedNextNumber = parseChapterNumberInput(req.body.number);
    const nextNumber = isOneshotManga ? 0 : parsedNextNumber;
    if (nextNumber == null || nextNumber < 0) {
      return res.status(400).send("Số chương không hợp lệ.");
    }

    const existingNumber = await dbGet(
      "SELECT id FROM chapters WHERE manga_id = ? AND number = ? AND id <> ? LIMIT 1",
      [chapterRow.manga_id, nextNumber, chapterRow.id]
    );
    if (existingNumber) {
      return res.status(400).send("Chương đã tồn tại");
    }

    const currentNumber = Number(chapterRow.number);
    const numberChanged =
      Number.isFinite(currentNumber) ? Math.abs(nextNumber - currentNumber) > 1e-9 : true;

    const title = (req.body.title || "").trim();
    const groupSelection = await resolveGroupNameFromRequestPayload({
      reqBody: req.body,
      teamManageScope
    });
    if (!groupSelection.ok) {
      return res.status(400).send(groupSelection.error || "Thiếu thông tin chương");
    }
    const groupName = groupSelection.groupName;
    const hasExistingChapterPassword = Boolean(
      (chapterRow.password_hash || "").toString().trim() &&
        (chapterRow.password_salt || "").toString().trim()
    );
    const chapterPasswordPayload = parseChapterPasswordUpdatePayload({
      reqBody: req.body,
      allowKeep: true,
      hasExistingPassword: hasExistingChapterPassword
    });
    if (!chapterPasswordPayload.ok) {
      return res.status(400).send(chapterPasswordPayload.error || buildChapterPasswordLengthError());
    }

    const token = (req.body.draft_token || "").toString().trim();
    if (!isChapterDraftTokenValid(token)) {
      return res.status(400).send("Draft chương không hợp lệ hoặc đã hết hạn.");
    }

    let pageIds = [];
    const rawPageIds = (req.body.draft_pages || "").toString().trim();
    if (rawPageIds) {
      let parsed = null;
      try {
        parsed = JSON.parse(rawPageIds);
      } catch (_err) {
        return res.status(400).send("Danh sách ảnh trang không hợp lệ.");
      }
      if (Array.isArray(parsed)) {
        pageIds = parsed.map((value) => (value == null ? "" : String(value).trim())).filter(Boolean);
      }
    }

    pageIds = Array.from(new Set(pageIds));
    if (!pageIds.length) {
      return res.status(400).send("Chưa có ảnh trang nào.");
    }
    if (pageIds.length > 220) {
      return res.status(400).send("Số lượng ảnh trang quá nhiều.");
    }
    if (pageIds.some((id) => !isChapterDraftPageIdValid(id))) {
      return res.status(400).send("Danh sách ảnh trang không hợp lệ.");
    }

    const pagesTouched = String(req.body.pages_touched || "") === "1";
    const currentCount = Math.max(Number(chapterRow.pages) || 0, 0);
    const expectedOrder = Array.from({ length: currentCount }, (_value, index) =>
      buildChapterExistingPageId(chapterRow.id, index + 1)
    );
    const isSameOrder =
      pageIds.length === expectedOrder.length && pageIds.every((value, index) => value === expectedOrder[index]);

    const needsProcessing = pagesTouched || !isSameOrder;
    if (!needsProcessing) {
      if (numberChanged && Number.isFinite(currentNumber)) {
        await dbRun(
          "UPDATE comments SET chapter_number = ? WHERE manga_id = ? AND chapter_number = ?",
          [nextNumber, chapterRow.manga_id, currentNumber]
        );
      }

      const chapterUpdateSql = [
        "UPDATE chapters",
        "SET number = ?, title = ?, group_name = ?"
      ];
      const chapterUpdateParams = [nextNumber, title, groupName];
      if (chapterPasswordPayload.shouldUpdate) {
        chapterUpdateSql.push(", password_hash = ?, password_salt = ?, password_updated_at = ?");
        chapterUpdateParams.push(
          chapterPasswordPayload.passwordHash,
          chapterPasswordPayload.passwordSalt,
          chapterPasswordPayload.passwordUpdatedAt
        );
      }
      chapterUpdateSql.push("WHERE id = ?");
      chapterUpdateParams.push(chapterRow.id);

      await dbRun(chapterUpdateSql.join(" "), chapterUpdateParams);
      return res.redirect(`/admin/manga/${chapterRow.manga_id}/chapters`);
    }

    const config = getB2Config();
    if (!isB2Ready(config)) {
      return res.status(500).send("Thiếu cấu hình lưu trữ ảnh trong .env");
    }

    const draft = await getChapterDraft(token);
    if (!draft || Number(draft.manga_id) !== Number(chapterRow.manga_id)) {
      return res.status(400).send("Draft chương không hợp lệ hoặc đã hết hạn.");
    }

    if (numberChanged && Number.isFinite(currentNumber)) {
      await dbRun(
        "UPDATE comments SET chapter_number = ? WHERE manga_id = ? AND chapter_number = ?",
        [nextNumber, chapterRow.manga_id, currentNumber]
      );
    }

    const processingStamp = Date.now();
    const processingUpdateSql = [
      "UPDATE chapters",
      "SET",
      "  number = ?,",
      "  title = ?,",
      "  group_name = ?,",
      "  pages = ?,",
      "  processing_state = ?,",
      "  processing_error = ?,",
      "  processing_draft_token = ?,",
      "  processing_pages_json = ?,",
      "  processing_updated_at = ?"
    ];
    const processingUpdateParams = [
      nextNumber,
      title,
      groupName,
      pageIds.length,
      "processing",
      "",
      token,
      JSON.stringify(pageIds),
      processingStamp
    ];
    if (chapterPasswordPayload.shouldUpdate) {
      processingUpdateSql.push(", password_hash = ?, password_salt = ?, password_updated_at = ?");
      processingUpdateParams.push(
        chapterPasswordPayload.passwordHash,
        chapterPasswordPayload.passwordSalt,
        chapterPasswordPayload.passwordUpdatedAt
      );
    }
    processingUpdateSql.push("WHERE id = ?");
    processingUpdateParams.push(chapterRow.id);

    await dbRun(processingUpdateSql.join("\n"), processingUpdateParams);

    enqueueChapterProcessing(chapterRow.id);
    return res.redirect(`/admin/manga/${chapterRow.manga_id}/chapters?status=processing`);
  })
);

app.get(
  "/admin/chapters/:id/pages",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canEditChapter", "Bạn chưa được cấp quyền sửa chương truyện.")
    ) {
      return;
    }
    const chapterId = Number(req.params.id);
    if (!Number.isFinite(chapterId) || chapterId <= 0) {
      return res.status(404).render("not-found", {
        title: "Không tìm thấy",
        team
      });
    }

    return res.redirect(`/admin/chapters/${Math.floor(chapterId)}/edit`);
  })
);

app.post(
  "/admin/chapters/:id/pages",
  requireAdmin,
  uploadChapterPages,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canEditChapter", "Bạn chưa được cấp quyền sửa chương truyện.")
    ) {
      return;
    }
    const chapterId = Number(req.params.id);
    if (!Number.isFinite(chapterId) || chapterId <= 0) {
      return res.status(404).send("Không tìm thấy chương");
    }

    const chapterRow = await dbGet(
      "SELECT id, manga_id, number, pages_prefix, processing_draft_token FROM chapters WHERE id = ?",
      [Math.floor(chapterId)]
    );
    if (!chapterRow) {
      return res.status(404).send("Không tìm thấy chương");
    }

    const config = getB2Config();
    if (!config.bucketId || !config.keyId || !config.applicationKey) {
      return res.status(500).send("Thiếu cấu hình lưu trữ ảnh trong .env");
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).send("Chưa chọn ảnh trang.");
    }

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    files.sort((a, b) => collator.compare(a.originalname || "", b.originalname || ""));

    const prefix = `${config.chapterPrefix}/manga-${chapterRow.manga_id}/ch-${chapterRow.number}`;
    const padLength = Math.max(3, String(files.length).length);
    const updatedAt = Date.now();
    const chapterDate = new Date(updatedAt).toISOString();

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const pageNumber = index + 1;
        let webpBuffer = null;
        try {
          webpBuffer = await convertChapterPageToWebp(file.buffer);
        } catch (_err) {
          return res.status(400).send("Ảnh trang không hợp lệ.");
        }

        const pageName = String(pageNumber).padStart(padLength, "0");
        const fileName = `${prefix}/${pageName}.webp`;
        await b2UploadBuffer({
          fileName,
          buffer: webpBuffer,
          contentType: "image/webp"
        });
      }
    } catch (err) {
      console.warn("Chapter pages upload failed", err);
      return res.status(500).send("Upload ảnh thất bại.");
    }

    await dbRun(
      `
      UPDATE chapters
      SET
        pages = ?,
        pages_prefix = ?,
        pages_ext = ?,
        pages_updated_at = ?,
        date = ?,
        processing_state = NULL,
        processing_error = NULL,
        processing_draft_token = NULL,
        processing_pages_json = NULL,
        processing_updated_at = ?
      WHERE id = ?
    `,
      [files.length, prefix, "webp", updatedAt, chapterDate, updatedAt, chapterRow.id]
    );

    const oldPrefix = (chapterRow.pages_prefix || "").trim();
    if (oldPrefix) {
      try {
        if (oldPrefix !== prefix) {
          await b2DeleteAllByPrefix(oldPrefix);
        } else {
          await b2DeleteChapterExtraPages({ prefix, keepPages: files.length });
        }
      } catch (err) {
        console.warn("Chapter page cleanup failed", err);
      }
    }
    return res.redirect(`/admin/chapters/${chapterRow.id}/pages?status=uploaded`);
  })
);

app.post(
  "/admin/chapters/:id/pages/upload",
  requireAdmin,
  uploadChapterPage,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canEditChapter", "Bạn chưa được cấp quyền sửa chương truyện.")
    ) {
      return;
    }
    const chapterId = Number(req.params.id);
    if (!Number.isFinite(chapterId) || chapterId <= 0) {
      return res.status(404).send("Không tìm thấy chương");
    }

    const chapterRow = await dbGet(
      "SELECT id, manga_id, number, pages_prefix, processing_draft_token FROM chapters WHERE id = ?",
      [Math.floor(chapterId)]
    );
    if (!chapterRow) {
      return res.status(404).send("Không tìm thấy chương");
    }

    const config = getB2Config();
    if (!config.bucketId || !config.keyId || !config.applicationKey) {
      return res.status(500).send("Thiếu cấu hình lưu trữ ảnh trong .env");
    }

    const pageNumber = Number(req.query.page);
    const padRaw = Number(req.query.pad);
    const padLength = Number.isFinite(padRaw) ? Math.max(3, Math.min(6, Math.floor(padRaw))) : 3;
    if (!Number.isFinite(pageNumber) || pageNumber <= 0 || pageNumber > 9999) {
      return res.status(400).send("Số trang không hợp lệ.");
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).send("Chưa chọn ảnh trang.");
    }

    let webpBuffer = null;
    try {
      webpBuffer = await convertChapterPageToWebp(req.file.buffer);
    } catch (_err) {
      return res.status(400).send("Ảnh trang không hợp lệ.");
    }

    const prefix = `${config.chapterPrefix}/manga-${chapterRow.manga_id}/ch-${chapterRow.number}`;
    const pageName = String(Math.floor(pageNumber)).padStart(padLength, "0");
    const fileName = `${prefix}/${pageName}.webp`;

    try {
      await b2UploadBuffer({
        fileName,
        buffer: webpBuffer,
        contentType: "image/webp"
      });
    } catch (err) {
      console.warn("Chapter page upload failed", err);
      return res.status(500).send("Upload ảnh thất bại.");
    }

    const url = `${config.cdnBaseUrl}/${prefix}/${pageName}.webp`;
    if (wantsJson(req)) {
      return res.json({ ok: true, page: Math.floor(pageNumber), url });
    }
    return res.send("OK");
  })
);

app.post(
  "/admin/chapters/:id/pages/finalize",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canEditChapter", "Bạn chưa được cấp quyền sửa chương truyện.")
    ) {
      return;
    }
    const chapterId = Number(req.params.id);
    if (!Number.isFinite(chapterId) || chapterId <= 0) {
      return res.status(404).send("Không tìm thấy chương");
    }

    const pages = Math.max(Number(req.body.pages) || 0, 0);
    if (!Number.isFinite(pages) || pages <= 0 || pages > 220) {
      return res.status(400).send("Số trang không hợp lệ.");
    }

    const chapterRow = await dbGet(
      "SELECT id, manga_id, number, pages_prefix FROM chapters WHERE id = ?",
      [Math.floor(chapterId)]
    );
    if (!chapterRow) {
      return res.status(404).send("Không tìm thấy chương");
    }

    const config = getB2Config();
    const prefix = `${config.chapterPrefix}/manga-${chapterRow.manga_id}/ch-${chapterRow.number}`;
    const updatedAt = Date.now();
    const chapterDate = new Date(updatedAt).toISOString();
    await dbRun(
      `
      UPDATE chapters
      SET
        pages = ?,
        pages_prefix = ?,
        pages_ext = ?,
        pages_updated_at = ?,
        date = ?,
        processing_state = NULL,
        processing_error = NULL,
        processing_draft_token = NULL,
        processing_pages_json = NULL,
        processing_updated_at = ?
      WHERE id = ?
    `,
      [pages, prefix, "webp", updatedAt, chapterDate, updatedAt, chapterRow.id]
    );

    const oldPrefix = (chapterRow.pages_prefix || "").trim();
    if (oldPrefix) {
      if (isB2Ready(config)) {
        try {
          if (oldPrefix !== prefix) {
            await b2DeleteAllByPrefix(oldPrefix);
          } else {
            await b2DeleteChapterExtraPages({ prefix, keepPages: pages });
          }
        } catch (err) {
          console.warn("Chapter page cleanup failed", err);
        }
      } else {
        console.warn("Skip chapter page cleanup: missing storage config");
      }
    }

    if (wantsJson(req)) {
      return res.json({ ok: true, pages, prefix, updatedAt });
    }
    return res.redirect(`/admin/chapters/${chapterRow.id}/pages?status=uploaded`);
  })
);

app.post(
  "/admin/chapters/:id/processing/retry",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canEditChapter", "Bạn chưa được cấp quyền sửa chương truyện.")
    ) {
      return;
    }
    const referer = req.get("referer") || "/admin/manga";
    const chapterId = Number(req.params.id);
    if (!Number.isFinite(chapterId) || chapterId <= 0) {
      return res.redirect(referer);
    }

    const chapterRow = await dbGet(
      "SELECT id, manga_id, processing_state, processing_draft_token, processing_pages_json FROM chapters WHERE id = ?",
      [Math.floor(chapterId)]
    );
    if (!chapterRow) {
      return res.redirect(referer);
    }

    const state = (chapterRow.processing_state || "").toString().trim();
    if (state !== "failed") {
      return res.redirect(`/admin/manga/${chapterRow.manga_id}/chapters`);
    }

    const token = (chapterRow.processing_draft_token || "").toString().trim();
    const pagesJson = (chapterRow.processing_pages_json || "").toString().trim();
    if (!isChapterDraftTokenValid(token) || !pagesJson) {
      return res.status(400).send("Không thể thử lại: thiếu dữ liệu xử lý.");
    }

    await updateChapterProcessing({ chapterId: chapterRow.id, state: "processing", error: "" });
    enqueueChapterProcessing(chapterRow.id);
    return res.redirect(`/admin/manga/${chapterRow.manga_id}/chapters?status=processing`);
  })
);

app.post(
  "/admin/chapters/:id/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamManageScope = getTeamLeaderScope(req);
    if (
      teamManageScope &&
      !enforceTeamScopePermission(req, res, teamManageScope, "canDeleteChapter", "Bạn chưa được cấp quyền xóa chương truyện.")
    ) {
      return;
    }
    const chapterId = Number(req.params.id);
    if (!Number.isFinite(chapterId) || chapterId <= 0) {
      if (wantsJson(req)) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy chương" });
      }
      return res.status(404).send("Không tìm thấy chương");
    }
    if (wantsJson(req)) {
      const safeChapterId = Math.floor(chapterId);
      const jobId = createAdminJob({
        type: "delete-chapter",
        run: async () => {
          await deleteChapterAndCleanupStorage(safeChapterId);
        }
      });
      return res.json({ ok: true, jobId });
    }

    try {
      const result = await deleteChapterAndCleanupStorage(Math.floor(chapterId));
      return res.redirect(`/admin/manga/${result.mangaId}/chapters`);
    } catch (err) {
      const message = normalizeAdminJobError(err);
      if (message === "Không tìm thấy chương") {
        return res.status(404).send(message);
      }
      return res.status(500).send(message);
    }
  })
);

const parseAdminJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  }
  return [];
};

const mapAdminMemberBadge = (item) => {
  const idValue = item && item.id != null ? Number(item.id) : NaN;
  const id = Number.isFinite(idValue) && idValue > 0 ? Math.floor(idValue) : 0;
  const code = normalizeBadgeCode(item && item.code != null ? item.code : "");
  const labelRaw = item && item.label != null ? String(item.label).trim() : "";
  const color = normalizeHexColor(item && item.color != null ? item.color : "");
  const priorityValue = item && item.priority != null ? Number(item.priority) : 0;
  const priority = Number.isFinite(priorityValue) ? Math.floor(priorityValue) : 0;
  const canComment = item && item.can_comment != null ? Boolean(item.can_comment) : true;

  if (!id || !labelRaw) return null;
  return {
    id,
    code: code || "badge",
    label: labelRaw,
    color: color || "#f8f8f2",
    priority,
    canComment,
    isDefault: code === "member"
  };
};

const mapAdminMemberRow = (row) => {
  if (!row || !row.id) return null;

  const badgeList = parseAdminJsonArray(row.badges_json)
    .map(mapAdminMemberBadge)
    .filter(Boolean)
    .sort((left, right) => {
      const diff = (Number(right.priority) || 0) - (Number(left.priority) || 0);
      if (diff) return diff;
      return (Number(left.id) || 0) - (Number(right.id) || 0);
    });

  const assignedBadgeIds = badgeList
    .map((badge) => Number(badge.id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => Math.floor(id));

  const interactionDisabledFromDb = Boolean(row.interaction_disabled);
  const interactionDisabled =
    interactionDisabledFromDb || badgeList.some((badge) => badge.canComment === false);

  const displayName = normalizeProfileDisplayName(row.display_name);
  const username = row && row.username ? String(row.username).trim() : "";
  const email = row && row.email ? String(row.email).trim() : "";

  const createdAtRaw = row && row.created_at != null ? row.created_at : null;
  const createdAtDate = createdAtRaw == null || createdAtRaw === "" ? null : new Date(createdAtRaw);
  const joinedAtText =
    createdAtDate && !Number.isNaN(createdAtDate.getTime()) ? formatDate(createdAtDate) : "";

  const commentCountValue = row && row.comment_count != null ? Number(row.comment_count) : 0;
  const commentCount = Number.isFinite(commentCountValue) ? Math.max(0, Math.floor(commentCountValue)) : 0;

  const isBanned = badgeList.some((badge) => badge.code === "banned");
  const hasMemberBadge = badgeList.some((badge) => badge.code === "member");
  const badges = badgeList.slice();
  if (!isBanned && !hasMemberBadge) {
    badges.push({
      id: 0,
      code: "member",
      label: "Member",
      color: "#f8f8f2",
      priority: -1000,
      canComment: true,
      isDefault: true
    });
  }

  return {
    id: String(row.id),
    username,
    email,
    displayName,
    avatarUrl: normalizeAvatarUrl(row.avatar_url || ""),
    facebookUrl: normalizeProfileFacebook(row.facebook_url),
    discordUrl: normalizeProfileDiscord(row.discord_handle),
    bio: normalizeProfileBio(row.bio),
    joinedAtText,
    commentCount,
    badges,
    assignedBadgeIds,
    interactionDisabled,
    isBanned
  };
};

const buildAdminMembersWhere = ({ q, interaction }) => {
  const whereParts = [];
  const params = [];

  const qText = typeof q === "string" ? q.trim() : "";
  if (qText) {
    const like = `%${qText}%`;
    whereParts.push(
      `(
        u.id = ?
        OR COALESCE(u.username, '') ILIKE ?
        OR COALESCE(u.email, '') ILIKE ?
        OR COALESCE(u.display_name, '') ILIKE ?
      )`
    );
    params.push(qText, like, like, like);
  }

  const interactionFilter =
    interaction === "disabled" || interaction === "enabled" ? interaction : "all";
  if (interactionFilter === "disabled") {
    whereParts.push(
      `EXISTS (
        SELECT 1
        FROM user_badges ub
        JOIN badges b ON b.id = ub.badge_id
        WHERE ub.user_id = u.id
          AND b.can_comment = false
      )`
    );
  } else if (interactionFilter === "enabled") {
    whereParts.push(
      `NOT EXISTS (
        SELECT 1
        FROM user_badges ub
        JOIN badges b ON b.id = ub.badge_id
        WHERE ub.user_id = u.id
          AND b.can_comment = false
      )`
    );
  }

  return {
    clause: whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
    params,
    q: qText,
    interaction: interactionFilter
  };
};

const getAdminMemberById = async (userId) => {
  const id = (userId || "").toString().trim();
  if (!id || id.length > 128) return null;

  const row = await dbGet(
    `
      SELECT
        u.id,
        u.email,
        u.username,
        u.display_name,
        u.avatar_url,
        u.facebook_url,
        u.discord_handle,
        u.bio,
        u.created_at,
        u.updated_at,
        COALESCE(cs.comment_count, 0) as comment_count,
        COALESCE(bctx.badges_json, '[]'::json) as badges_json,
        COALESCE(bctx.interaction_disabled, false) as interaction_disabled
      FROM users u
      LEFT JOIN (
        SELECT author_user_id, COUNT(*) as comment_count
        FROM comments
        WHERE author_user_id IS NOT NULL AND TRIM(author_user_id) <> ''
        GROUP BY author_user_id
      ) cs ON cs.author_user_id = u.id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            json_agg(
              json_build_object(
                'id', b.id,
                'code', b.code,
                'label', b.label,
                'color', b.color,
                'priority', b.priority,
                'can_comment', b.can_comment
              )
              ORDER BY b.priority DESC, b.id ASC
            ),
            '[]'::json
          ) as badges_json,
          COALESCE(bool_or(b.can_comment = false), false) as interaction_disabled
        FROM user_badges ub
        JOIN badges b ON b.id = ub.badge_id
        WHERE ub.user_id = u.id
      ) bctx ON true
      WHERE u.id = ?
      LIMIT 1
    `,
    [id]
  );

  if (!row) return null;
  return mapAdminMemberRow(row);
};

const revokeMemberAuthSessions = async ({ userId, dbRunFn = dbRun }) => {
  const safeUserId = (userId || "").toString().trim();
  if (!safeUserId) return 0;

  const run = typeof dbRunFn === "function" ? dbRunFn : dbRun;
  const result = await run(
    `
      DELETE FROM web_sessions
      WHERE (sess::jsonb ->> 'authUserId') = ?
         OR (sess::jsonb ->> 'adminAuthUserId') = ?
         OR (sess::jsonb ->> 'adminUserId') = ?
    `,
    [safeUserId, safeUserId, safeUserId]
  );

  const changed = result && result.changes != null ? Number(result.changes) : 0;
  if (!Number.isFinite(changed) || changed <= 0) return 0;
  return Math.floor(changed);
};

const decodeHtmlEntities = (value) =>
  String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const toPlainCommentText = (value) => {
  const decoded = decodeHtmlEntities(value);
  const withoutHtml = decoded.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withoutHtml).replace(/\s+/g, " ").trim();
};

const normalizeAdminCommentRow = (row) => {
  const normalized = row && typeof row === "object" ? { ...row } : {};
  normalized.content = toPlainCommentText(normalized.content || "");
  return normalized;
};

app.get(
  "/admin/comments",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const deletedRaw = Number(req.query.deleted);
    const deleted = Number.isFinite(deletedRaw) && deletedRaw > 0 ? Math.floor(deletedRaw) : 0;
    const addedRaw = Number(req.query.added);
    const added = Number.isFinite(addedRaw) && addedRaw > 0 ? Math.floor(addedRaw) : 0;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const reportedRaw = typeof req.query.reported === "string" ? req.query.reported.trim() : "";
    const reported = reportedRaw === "only" || reportedRaw === "none" ? reportedRaw : "all";
    const sortRaw = typeof req.query.sort === "string" ? req.query.sort.trim() : "";
    const sort = ["newest", "oldest", "likes", "reports"].includes(sortRaw) ? sortRaw : "newest";
    const pageRaw = Number(req.query.page);
    const perPage = 20;

    let orderBy = "c.created_at DESC, c.id DESC";
    if (sort === "oldest") {
      orderBy = "c.created_at ASC, c.id ASC";
    } else if (sort === "likes") {
      orderBy = "COALESCE(c.like_count, 0) DESC, c.created_at DESC, c.id DESC";
    } else if (sort === "reports") {
      orderBy = "COALESCE(c.report_count, 0) DESC, c.created_at DESC, c.id DESC";
    }

    const whereParts = [];
    const whereParams = [];

    whereParts.push("COALESCE(c.client_request_id, '') NOT ILIKE ?");
    whereParts.push("COALESCE(c.content, '') NOT ILIKE ?");
    whereParams.push(FORUM_COMMENT_REQUEST_LIKE, FORUM_COMMENT_META_LIKE);

    if (q) {
      const like = `%${q}%`;
      whereParts.push(
        `(
          c.author_user_id = ?
          OR c.author ILIKE ?
          OR c.content ILIKE ?
          OR m.title ILIKE ?
          OR COALESCE(u.username, '') ILIKE ?
          OR COALESCE(u.display_name, '') ILIKE ?
          OR COALESCE(u.email, '') ILIKE ?
        )`
      );
      whereParams.push(q, like, like, like, like, like, like);
    }

    if (reported === "only") {
      whereParts.push("COALESCE(c.report_count, 0) > 0");
    } else if (reported === "none") {
      whereParts.push("COALESCE(c.report_count, 0) = 0");
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const countRow = await dbGet(
      `
      SELECT COUNT(*) as count
      FROM comments c
      JOIN manga m ON m.id = c.manga_id
      LEFT JOIN users u ON u.id = c.author_user_id
      ${whereClause}
    `,
      whereParams
    );

    const totalCount = countRow ? Number(countRow.count) || 0 : 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
    const page =
      Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(Math.floor(pageRaw), totalPages) : 1;
    const offset = (page - 1) * perPage;

    const comments = await dbAll(
      `
      SELECT
        c.id,
        c.manga_id,
        c.chapter_number,
        c.author,
        c.content,
        c.like_count,
        c.report_count,
        c.created_at,
        m.title as manga_title,
        m.slug as manga_slug,
        COALESCE(u.username, '') as author_username
      FROM comments c
      JOIN manga m ON m.id = c.manga_id
      LEFT JOIN users u ON u.id = c.author_user_id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `,
      [...whereParams, perPage, offset]
    );

    const normalizedComments = (Array.isArray(comments) ? comments : []).map((comment) =>
      normalizeAdminCommentRow(comment)
    );

    const pagination = {
      page,
      perPage,
      totalCount,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: Math.max(1, page - 1),
      nextPage: Math.min(totalPages, page + 1)
    };

    const forbiddenWords = await getForbiddenWords();

    if (wantsJson(req)) {
      return res.json({
        ok: true,
        comments: normalizedComments.map((comment) => ({
          id: comment.id,
          mangaTitle: comment.manga_title || "",
          mangaSlug: comment.manga_slug || "",
          chapterNumber: comment.chapter_number,
          author: comment.author || "",
          authorUsername: comment.author_username || "",
          content: comment.content || "",
          likeCount: Number(comment.like_count) || 0,
          reportCount: Number(comment.report_count) || 0,
          createdAt: comment.created_at,
          createdAtText: formatDateTime(comment.created_at)
        })),
        filters: {
          q,
          reported,
          sort
        },
        pagination
      });
    }

    res.render("admin/comments", {
      title: "Quản lý bình luận",
      adminUser: adminConfig.user,
      comments: normalizedComments,
      forbiddenWords,
      status,
      deleted,
      added,
      q,
      reported,
      sort,
      pagination
    });
  })
);

app.post(
  "/admin/comments/bulk-delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const q = (req.body.q || "").toString().trim();
    const reportedRaw = (req.body.reported || "").toString().trim();
    const reported = reportedRaw === "only" || reportedRaw === "none" ? reportedRaw : "all";
    const sortRaw = (req.body.sort || "").toString().trim();
    const sort = ["newest", "oldest", "likes", "reports"].includes(sortRaw) ? sortRaw : "newest";
    const pageRaw = Number(req.body.page);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

    const rawIds = req.body.comment_ids;
    const asList = Array.isArray(rawIds) ? rawIds : rawIds != null ? [rawIds] : [];
    const ids = Array.from(
      new Set(
        asList
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))
      )
    );

    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (reported !== "all") params.set("reported", reported);
    if (sort !== "newest") params.set("sort", sort);
    if (page > 1) params.set("page", String(page));

    if (!ids.length) {
      params.set("status", "bulk_missing");
      return res.redirect(`/admin/comments?${params.toString()}`);
    }

    let deletedCount = 0;
    for (const id of ids) {
      deletedCount += await deleteCommentCascade(id);
    }

    params.set("status", "bulk_deleted");
    params.set("deleted", String(deletedCount));
    return res.redirect(`/admin/comments?${params.toString()}`);
  })
);

app.post(
  "/admin/comments/forbidden-words",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const baseOrigin = getPublicOriginFromRequest(req) || localDevOrigin;
    const refererRaw = (req.get("referer") || "").toString().trim();
    let params = new URLSearchParams();
    if (refererRaw) {
      try {
        const refererUrl = new URL(refererRaw, baseOrigin);
        const normalizedPath = (refererUrl.pathname || "").replace(/\/+$/, "") || "/";
        if (normalizedPath === "/admin/comments") {
          params = new URLSearchParams(refererUrl.searchParams);
        }
      } catch (_err) {
        params = new URLSearchParams();
      }
    }

    params.delete("format");
    params.delete("status");
    params.delete("deleted");
    params.delete("added");

    const words = normalizeForbiddenWordList(req.body.words || req.body.word || "");
    if (!words.length) {
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, error: "Vui lòng nhập ít nhất một từ cấm hợp lệ." });
      }
      params.set("status", "word_invalid");
      return res.redirect(`/admin/comments${params.toString() ? `?${params.toString()}` : ""}`);
    }

    const now = Date.now();
    let added = 0;
    for (const word of words) {
      const normalizedWord = word.toLowerCase();
      const result = await dbRun(
        "INSERT INTO forbidden_words (word, normalized_word, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        [word, normalizedWord, now]
      );
      const changes = result && result.changes ? Number(result.changes) || 0 : 0;
      added += changes;
    }

    if (added > 0) {
      invalidateForbiddenWordsCache();
    }

    if (wantsJson(req)) {
      if (added <= 0) {
        return res.status(409).json({ ok: false, error: "Từ cấm đã tồn tại trong danh sách." });
      }

      const allWords = await getForbiddenWords();

      return res.json({
        ok: true,
        added,
        words: allWords
          .map((row) => ({
            id: row && row.id != null ? Number(row.id) : 0,
            word: row && row.word ? String(row.word).trim() : ""
          }))
          .filter((item) => item.id > 0 && item.word)
      });
    }

    if (added > 0) {
      params.set("status", "word_added");
      params.set("added", String(added));
    } else {
      params.set("status", "word_exists");
    }

    return res.redirect(`/admin/comments${params.toString() ? `?${params.toString()}` : ""}`);
  })
);

app.post(
  "/admin/comments/forbidden-words/:id/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const baseOrigin = getPublicOriginFromRequest(req) || localDevOrigin;
    const refererRaw = (req.get("referer") || "").toString().trim();
    let params = new URLSearchParams();
    if (refererRaw) {
      try {
        const refererUrl = new URL(refererRaw, baseOrigin);
        const normalizedPath = (refererUrl.pathname || "").replace(/\/+$/, "") || "/";
        if (normalizedPath === "/admin/comments") {
          params = new URLSearchParams(refererUrl.searchParams);
        }
      } catch (_err) {
        params = new URLSearchParams();
      }
    }

    params.delete("format");
    params.delete("status");
    params.delete("deleted");
    params.delete("added");

    const wordId = Number(req.params.id);
    if (!Number.isFinite(wordId) || wordId <= 0) {
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, error: "ID từ cấm không hợp lệ." });
      }
      params.set("status", "word_invalid");
      return res.redirect(`/admin/comments${params.toString() ? `?${params.toString()}` : ""}`);
    }

    const result = await dbRun("DELETE FROM forbidden_words WHERE id = ?", [Math.floor(wordId)]);
    if (result && result.changes) {
      invalidateForbiddenWordsCache();
      if (wantsJson(req)) {
        return res.json({ ok: true, deleted: true, id: Math.floor(wordId) });
      }
      params.set("status", "word_deleted");
    } else {
      if (wantsJson(req)) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy từ cấm cần xóa." });
      }
      params.set("status", "word_notfound");
    }

    return res.redirect(`/admin/comments${params.toString() ? `?${params.toString()}` : ""}`);
  })
);

app.post(
  "/admin/comments/:id/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const deletedCount = await deleteCommentCascade(req.params.id);

    const baseOrigin = getPublicOriginFromRequest(req) || localDevOrigin;
    const refererRaw = (req.get("referer") || "").toString().trim();

    let params = new URLSearchParams();
    if (refererRaw) {
      try {
        const refererUrl = new URL(refererRaw, baseOrigin);
        const normalizedPath = (refererUrl.pathname || "").replace(/\/+$/, "") || "/";
        if (normalizedPath === "/admin/comments") {
          params = new URLSearchParams(refererUrl.searchParams);
        }
      } catch (_err) {
        params = new URLSearchParams();
      }
    }

    params.delete("format");
    params.delete("status");
    params.delete("deleted");
    params.delete("added");

    if (deletedCount > 0) {
      params.set("status", "bulk_deleted");
      params.set("deleted", String(deletedCount));
    }

    const query = params.toString();
    return res.redirect(`/admin/comments${query ? `?${query}` : ""}`);
  })
);

app.get(
  "/admin/members",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const interactionRaw =
      typeof req.query.interaction === "string" ? req.query.interaction.trim() : "";
    const pageRaw = Number(req.query.page);

    const where = buildAdminMembersWhere({ q, interaction: interactionRaw });
    const countRow = await dbGet(`SELECT COUNT(*) as count FROM users u ${where.clause}`, where.params);
    const totalCount = countRow ? Number(countRow.count) || 0 : 0;
    const perPage = ADMIN_MEMBERS_PER_PAGE;
    const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
    const page =
      Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(Math.floor(pageRaw), totalPages) : 1;
    const offset = (page - 1) * perPage;

    const rows = await dbAll(
      `
      SELECT
        u.id,
        u.email,
        u.username,
        u.display_name,
        u.avatar_url,
        u.facebook_url,
        u.discord_handle,
        u.bio,
        u.created_at,
        u.updated_at,
        COALESCE(cs.comment_count, 0) as comment_count,
        COALESCE(bctx.badges_json, '[]'::json) as badges_json,
        COALESCE(bctx.interaction_disabled, false) as interaction_disabled
      FROM users u
      LEFT JOIN (
        SELECT author_user_id, COUNT(*) as comment_count
        FROM comments
        WHERE author_user_id IS NOT NULL AND TRIM(author_user_id) <> ''
        GROUP BY author_user_id
      ) cs ON cs.author_user_id = u.id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            json_agg(
              json_build_object(
                'id', b.id,
                'code', b.code,
                'label', b.label,
                'color', b.color,
                'priority', b.priority,
                'can_comment', b.can_comment
              )
              ORDER BY b.priority DESC, b.id ASC
            ),
            '[]'::json
          ) as badges_json,
          COALESCE(bool_or(b.can_comment = false), false) as interaction_disabled
        FROM user_badges ub
        JOIN badges b ON b.id = ub.badge_id
        WHERE ub.user_id = u.id
      ) bctx ON true
      ${where.clause}
      ORDER BY COALESCE(u.updated_at, u.created_at) DESC, u.id ASC
      LIMIT ? OFFSET ?
    `,
      [...where.params, perPage, offset]
    );

    const members = rows.map(mapAdminMemberRow).filter(Boolean);
    const badgeRows = await dbAll(
      "SELECT id, code, label, color, priority, can_access_admin, can_delete_any_comment, can_comment FROM badges ORDER BY priority DESC, id ASC"
    );
    const badges = badgeRows.map(mapBadgeRow).filter(Boolean);

    const pagination = {
      page,
      perPage,
      totalCount,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: Math.max(1, page - 1),
      nextPage: Math.min(totalPages, page + 1)
    };

    if (wantsJson(req)) {
      return res.json({
        ok: true,
        members,
        badges,
        filters: {
          q: where.q,
          interaction: where.interaction
        },
        pagination
      });
    }

    return res.render("admin/members", {
      title: "Quản lý thành viên",
      status,
      q: where.q,
      interaction: where.interaction,
      members,
      badges,
      pagination
    });
  })
);

app.get(
  "/admin/members/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const wants = wantsJson(req);
    const userId = (req.params.id || "").toString().trim();

    if (!userId || userId.length > 128) {
      if (wants) {
        return res.status(400).json({ ok: false, error: "Dữ liệu không hợp lệ." });
      }
      return res.redirect("/admin/members?status=invalid");
    }

    const member = await getAdminMemberById(userId);
    if (!member) {
      if (wants) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy thành viên." });
      }
      return res.redirect("/admin/members?status=notfound");
    }

    const badgeRows = await dbAll(
      "SELECT id, code, label, color, priority, can_access_admin, can_delete_any_comment, can_comment FROM badges ORDER BY priority DESC, id ASC"
    );
    const badges = badgeRows.map(mapBadgeRow).filter(Boolean);

    if (wants) {
      return res.json({ ok: true, member, badges });
    }

    return res.redirect("/admin/members");
  })
);

app.post(
  "/admin/members/:id/update",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const wants = wantsJson(req);
    const userId = (req.params.id || "").toString().trim();
    if (!userId || userId.length > 128) {
      if (wants) {
        return res.status(400).json({ ok: false, error: "Dữ liệu không hợp lệ." });
      }
      return res.redirect("/admin/members?status=invalid");
    }

    const existing = await dbGet("SELECT id FROM users WHERE id = ?", [userId]);
    if (!existing) {
      if (wants) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy thành viên." });
      }
      return res.redirect("/admin/members?status=notfound");
    }

    const displayName = normalizeProfileDisplayName(req.body.display_name);
    const facebookUrl = normalizeProfileFacebook(req.body.facebook_url);
    const discordUrl = normalizeProfileDiscord(req.body.discord_url || req.body.discord_handle);
    const bio = normalizeProfileBio(req.body.bio);

    const result = await dbRun(
      "UPDATE users SET display_name = ?, facebook_url = ?, discord_handle = ?, bio = ?, updated_at = ? WHERE id = ?",
      [displayName, facebookUrl, discordUrl, bio, Date.now(), userId]
    );

    if (!result || !result.changes) {
      if (wants) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy thành viên." });
      }
      return res.redirect("/admin/members?status=notfound");
    }

    if (wants) {
      return res.json({ ok: true, updated: true });
    }
    return res.redirect("/admin/members?status=updated");
  })
);

app.post(
  "/admin/members/:id/ban",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const wants = wantsJson(req);
    const userId = (req.params.id || "").toString().trim();
    const modeRaw = (req.body.mode || "").toString().trim().toLowerCase();
    const mode = modeRaw === "unban" ? "unban" : "ban";

    if (!userId || userId.length > 128) {
      if (wants) {
        return res.status(400).json({ ok: false, error: "Dữ liệu không hợp lệ." });
      }
      return res.redirect("/admin/members?status=invalid");
    }

    const existing = await dbGet("SELECT id FROM users WHERE id = ?", [userId]);
    if (!existing) {
      if (wants) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy thành viên." });
      }
      return res.redirect("/admin/members?status=notfound");
    }

    const bannedBadge = await dbGet("SELECT id FROM badges WHERE lower(code) = 'banned' LIMIT 1");
    const bannedBadgeId = bannedBadge && bannedBadge.id != null ? Number(bannedBadge.id) : NaN;
    if (!Number.isFinite(bannedBadgeId) || bannedBadgeId <= 0) {
      if (wants) {
        return res.status(500).json({ ok: false, error: "Không tìm thấy huy hiệu Banned." });
      }
      return res.redirect("/admin/members?status=notfound");
    }

    if (mode === "ban") {
      await withTransaction(async ({ dbRun: txRun }) => {
        await txRun("DELETE FROM user_badges WHERE user_id = ?", [userId]);
        await txRun(
          "INSERT INTO user_badges (user_id, badge_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
          [userId, Math.floor(bannedBadgeId), Date.now()]
        );
        await revokeMemberAuthSessions({ userId, dbRunFn: txRun });
      });
    } else {
      const memberBadgeId = await getMemberBadgeId();
      if (!memberBadgeId) {
        if (wants) {
          return res.status(500).json({ ok: false, error: "Không tìm thấy huy hiệu Member." });
        }
        return res.redirect("/admin/members?status=notfound");
      }

      await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
        await txRun("DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?", [
          userId,
          Math.floor(bannedBadgeId)
        ]);
        await txRun(
          "INSERT INTO user_badges (user_id, badge_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
          [userId, Math.floor(memberBadgeId), Date.now()]
        );
        await restoreTeamBadgesForUser({
          userId,
          dbAllFn: txAll,
          dbGetFn: txGet,
          dbRunFn: txRun
        });
      });
    }

    if (wants) {
      return res.json({ ok: true, banned: mode === "ban" });
    }
    return res.redirect(`/admin/members?status=${mode === "ban" ? "banned" : "unbanned"}`);
  })
);

app.post(
  "/admin/members/:id/badges/add",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const wants = wantsJson(req);
    const userId = (req.params.id || "").toString().trim();
    const badgeIdRaw = Number(req.body.badge_id);
    const badgeId = Number.isFinite(badgeIdRaw) && badgeIdRaw > 0 ? Math.floor(badgeIdRaw) : 0;

    if (!userId || userId.length > 128 || !badgeId) {
      if (wants) {
        return res.status(400).json({ ok: false, error: "Dữ liệu không hợp lệ." });
      }
      return res.redirect("/admin/members?status=invalid");
    }

    const userRow = await dbGet("SELECT id FROM users WHERE id = ?", [userId]);
    if (!userRow) {
      if (wants) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy thành viên." });
      }
      return res.redirect("/admin/members?status=notfound");
    }
    const badgeRow = await dbGet("SELECT id, code FROM badges WHERE id = ?", [badgeId]);
    if (!badgeRow) {
      if (wants) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy huy hiệu." });
      }
      return res.redirect("/admin/members?status=notfound");
    }

    const badgeCode = normalizeBadgeCode(badgeRow.code);
    if (badgeCode !== "banned") {
      await ensureMemberBadgeForUser(userId);
    }

    await dbRun(
      "INSERT INTO user_badges (user_id, badge_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      [userId, badgeId, Date.now()]
    );

    if (badgeCode === "banned") {
      await revokeMemberAuthSessions({ userId });
    }

    if (wants) {
      return res.json({ ok: true, assigned: true });
    }
    return res.redirect("/admin/members?status=assigned");
  })
);

app.post(
  "/admin/members/:id/badges/:badgeId/remove",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const wants = wantsJson(req);
    const userId = (req.params.id || "").toString().trim();
    const badgeIdValue = Number(req.params.badgeId);
    const badgeId = Number.isFinite(badgeIdValue) && badgeIdValue > 0 ? Math.floor(badgeIdValue) : 0;

    if (!userId || userId.length > 128 || !badgeId) {
      if (wants) {
        return res.status(400).json({ ok: false, error: "Dữ liệu không hợp lệ." });
      }
      return res.redirect("/admin/members?status=invalid");
    }

    const badgeRow = await dbGet("SELECT id, code FROM badges WHERE id = ?", [badgeId]);
    if (!badgeRow) {
      if (wants) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy huy hiệu." });
      }
      return res.redirect("/admin/members?status=notfound");
    }

    const badgeCode = normalizeBadgeCode(badgeRow.code);
    if (badgeCode === "member") {
      if (wants) {
        return res.status(400).json({ ok: false, error: "Không thể gỡ huy hiệu Member." });
      }
      return res.redirect("/admin/members?status=invalid");
    }

    const result = await dbRun("DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?", [
      userId,
      badgeId
    ]);
    if (!result || !result.changes) {
      if (wants) {
        return res.status(404).json({ ok: false, error: "Thành viên chưa có huy hiệu này." });
      }
      return res.redirect("/admin/members?status=notfound");
    }

    if (badgeCode === "banned") {
      await ensureMemberBadgeForUser(userId);
      await restoreTeamBadgesForUser({ userId });
    }

    if (wants) {
      return res.json({ ok: true, removed: true });
    }
    return res.redirect("/admin/members?status=revoked");
  })
);

app.get(
  "/admin/badges",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const badgeRows = await dbAll(
      "SELECT id, code, label, color, priority, can_access_admin, can_delete_any_comment, can_comment FROM badges ORDER BY priority DESC, id ASC"
    );
    const badges = badgeRows.map(mapBadgeRow).filter(Boolean);

    return res.render("admin/badges", {
      title: "Quản lý huy hiệu",
      status,
      badges
    });
  })
);

app.post(
  "/admin/badges/new",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const label = (req.body.label || "").toString().trim();
    const color = normalizeHexColor(req.body.color) || "#f8f8f2";
    const canAccessAdmin = isTruthyInput(req.body.can_access_admin);
    const canDeleteAnyComment = isTruthyInput(req.body.can_delete_any_comment);
    let canComment = isTruthyInput(req.body.can_comment);

    if (!label) {
      return res.redirect("/admin/badges?status=missing");
    }

    const desiredCode = await buildAutoBadgeCode({ label, excludeBadgeId: null });
    if (!desiredCode) {
      return res.redirect("/admin/badges?status=exists");
    }
    if (desiredCode === "banned") {
      canComment = false;
    }

    const topRow = await dbGet("SELECT priority FROM badges ORDER BY priority DESC, id ASC LIMIT 1");
    const topPriority = topRow && topRow.priority != null ? Number(topRow.priority) : 0;
    const nextPriority = Number.isFinite(topPriority) ? Math.floor(topPriority) + 10 : 100;

    const now = Date.now();
    await dbRun(
      "INSERT INTO badges (code, label, color, priority, can_access_admin, can_delete_any_comment, can_comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        desiredCode,
        label,
        color,
        nextPriority,
        canAccessAdmin,
        canDeleteAnyComment,
        canComment,
        now,
        now
      ]
    );

    return res.redirect("/admin/badges?status=created");
  })
);

app.post(
  "/admin/badges/:id/update",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const wants = wantsJson(req);
    const badgeId = Number(req.params.id);
    if (!Number.isFinite(badgeId) || badgeId <= 0) {
      if (wants) {
        return res.status(400).json({ ok: false, error: "Dữ liệu không hợp lệ." });
      }
      return res.redirect("/admin/badges?status=invalid");
    }

    const label = (req.body.label || "").toString().trim();
    const color = normalizeHexColor(req.body.color) || "#f8f8f2";
    const canAccessAdmin = isTruthyInput(req.body.can_access_admin);
    const canDeleteAnyComment = isTruthyInput(req.body.can_delete_any_comment);
    let canComment = isTruthyInput(req.body.can_comment);

    if (!label) {
      if (wants) {
        return res.status(400).json({ ok: false, error: "Vui lòng nhập tên huy hiệu." });
      }
      return res.redirect("/admin/badges?status=missing");
    }

    const existingRow = await dbGet("SELECT id, code FROM badges WHERE id = ?", [Math.floor(badgeId)]);
    if (!existingRow) {
      if (wants) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy huy hiệu." });
      }
      return res.redirect("/admin/badges?status=notfound");
    }

    const currentCode = normalizeBadgeCode(existingRow.code);
    const reservedCodes = new Set(["admin", "mod", "member", "banned"]);
    let desiredCode = await buildAutoBadgeCode({ label, excludeBadgeId: badgeId });
    if (reservedCodes.has(currentCode)) {
      desiredCode = currentCode;
    }
    if (!desiredCode) {
      if (wants) {
        return res.status(400).json({ ok: false, error: "Không thể tạo mã huy hiệu tự động." });
      }
      return res.redirect("/admin/badges?status=exists");
    }
    if (desiredCode === "banned") {
      canComment = false;
    }

    const updatedAt = Date.now();
    const result = await dbRun(
      "UPDATE badges SET code = ?, label = ?, color = ?, can_access_admin = ?, can_delete_any_comment = ?, can_comment = ?, updated_at = ? WHERE id = ?",
      [
        desiredCode,
        label,
        color,
        canAccessAdmin,
        canDeleteAnyComment,
        canComment,
        updatedAt,
        Math.floor(badgeId)
      ]
    );

    if (!result || !result.changes) {
      if (wants) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy huy hiệu." });
      }
      return res.redirect("/admin/badges?status=notfound");
    }

    if (wants) {
      return res.json({ ok: true, updated: true });
    }
    return res.redirect("/admin/badges?status=updated");
  })
);

app.post(
  "/admin/badges/:id/move",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const wants = wantsJson(req);
    const badgeId = Number(req.params.id);
    if (!Number.isFinite(badgeId) || badgeId <= 0) {
      if (wants) {
        return res.status(400).json({ ok: false, error: "Dữ liệu không hợp lệ." });
      }
      return res.redirect("/admin/badges?status=invalid");
    }

    const direction = (req.body.direction || "").toString().trim().toLowerCase();
    if (direction !== "up" && direction !== "down") {
      if (wants) {
        return res.status(400).json({ ok: false, error: "Hướng di chuyển không hợp lệ." });
      }
      return res.redirect("/admin/badges?status=invalid");
    }

    const rows = await dbAll("SELECT id, priority FROM badges ORDER BY priority DESC, id ASC");
    const safeRows = (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const id = row && row.id != null ? Number(row.id) : NaN;
        const priority = row && row.priority != null ? Number(row.priority) : 0;
        if (!Number.isFinite(id) || id <= 0) return null;
        return {
          id: Math.floor(id),
          priority: Number.isFinite(priority) ? Math.floor(priority) : 0
        };
      })
      .filter(Boolean);

    const currentIndex = safeRows.findIndex((row) => row.id === Math.floor(badgeId));
    if (currentIndex < 0) {
      if (wants) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy huy hiệu." });
      }
      return res.redirect("/admin/badges?status=notfound");
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= safeRows.length) {
      if (wants) {
        return res.json({ ok: true, moved: false });
      }
      return res.redirect("/admin/badges");
    }

    const reordered = safeRows.slice();
    const temp = reordered[currentIndex];
    reordered[currentIndex] = reordered[targetIndex];
    reordered[targetIndex] = temp;

    const now = Date.now();
    await withTransaction(async ({ dbRun: txRun }) => {
      for (let index = 0; index < reordered.length; index += 1) {
        const row = reordered[index];
        const nextPriority = (reordered.length - index) * 10;
        await txRun("UPDATE badges SET priority = ?, updated_at = ? WHERE id = ?", [
          nextPriority,
          now,
          row.id
        ]);
      }
    });

    if (wants) {
      return res.json({ ok: true, moved: true });
    }
    return res.redirect("/admin/badges?status=moved");
  })
);

app.post(
  "/admin/badges/:id/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const badgeId = Number(req.params.id);
    if (!Number.isFinite(badgeId) || badgeId <= 0) {
      return res.redirect("/admin/badges?status=invalid");
    }

    const result = await dbRun("DELETE FROM badges WHERE id = ?", [Math.floor(badgeId)]);
    if (!result || !result.changes) {
      return res.redirect("/admin/badges?status=notfound");
    }
    return res.redirect("/admin/badges?status=deleted");
  })
);

app.post(
  "/admin/badges/assign",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const q = (req.body.q || "").toString().trim();
    const userId = (req.body.user_id || "").toString().trim();
    const badgeId = Number(req.body.badge_id);
    if (!userId || !Number.isFinite(badgeId) || badgeId <= 0) {
      return res.redirect(`/admin/badges?status=missing${q ? `&q=${encodeURIComponent(q)}` : ""}`);
    }

    const userRow = await dbGet("SELECT id FROM users WHERE id = ?", [userId]);
    if (!userRow) {
      return res.redirect(
        `/admin/badges?status=user_notfound${q ? `&q=${encodeURIComponent(q)}` : ""}`
      );
    }
    const badgeRow = await dbGet("SELECT id, code FROM badges WHERE id = ?", [Math.floor(badgeId)]);
    if (!badgeRow) {
      return res.redirect(`/admin/badges?status=notfound${q ? `&q=${encodeURIComponent(q)}` : ""}`);
    }
    const badgeCode = normalizeBadgeCode(badgeRow.code);

    await dbRun(
      "INSERT INTO user_badges (user_id, badge_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      [userId, Math.floor(badgeId), Date.now()]
    );

    if (badgeCode === "banned") {
      await revokeMemberAuthSessions({ userId });
    }
    return res.redirect(`/admin/badges?status=assigned${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  })
);

app.post(
  "/admin/badges/revoke",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const q = (req.body.q || "").toString().trim();
    const userId = (req.body.user_id || "").toString().trim();
    const badgeId = Number(req.body.badge_id);
    if (!userId || !Number.isFinite(badgeId) || badgeId <= 0) {
      return res.redirect(`/admin/badges?status=missing${q ? `&q=${encodeURIComponent(q)}` : ""}`);
    }
    const badgeRow = await dbGet("SELECT id, code FROM badges WHERE id = ?", [Math.floor(badgeId)]);
    if (!badgeRow) {
      return res.redirect(`/admin/badges?status=notfound${q ? `&q=${encodeURIComponent(q)}` : ""}`);
    }
    const badgeCode = normalizeBadgeCode(badgeRow.code);

    const result = await dbRun("DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?", [
      userId,
      Math.floor(badgeId)
    ]);
    if (!result || !result.changes) {
      return res.redirect(`/admin/badges?status=notfound${q ? `&q=${encodeURIComponent(q)}` : ""}`);
    }

    if (badgeCode === "banned") {
      await ensureMemberBadgeForUser(userId);
      await restoreTeamBadgesForUser({ userId });
    }

    return res.redirect(`/admin/badges?status=revoked${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  })
);

app.get(
  "/admin/genres",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const focusIdValue = Number(req.query.id);
    const focusGenreId =
      Number.isFinite(focusIdValue) && focusIdValue > 0 ? Math.floor(focusIdValue) : 0;

    const genreRows = await getGenreStats();
    const qNormalized = q.replace(/^#/, "").trim();
    const queryLower = qNormalized.toLowerCase();
    const queryId = /^\d+$/.test(qNormalized) ? Number(qNormalized) : null;
    const genres = q
      ? genreRows.filter((genre) => {
        if (queryId && Number(genre.id) === queryId) return true;
        return genre.name.toLowerCase().includes(queryLower);
      })
      : genreRows;

    if (wantsJson(req)) {
      return res.json({
        genres: genres.map((genre) => ({
          id: genre.id,
          name: genre.name,
          count: Number(genre.count) || 0
        })),
        q
      });
    }

    res.render("admin/genres", {
      title: "Quản lý thể loại",
      adminUser: adminConfig.user,
      genres,
      status,
      q,
      focusGenreId
    });
  })
);

app.post(
  "/admin/genres/new",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const name = normalizeGenreName(req.body.name);
    if (!name) {
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, error: "Vui lòng nhập tên thể loại." });
      }
      return res.redirect("/admin/genres?status=missing");
    }

    const existing = await dbGet("SELECT id FROM genres WHERE name = ?", [name]);
    if (existing) {
      if (wantsJson(req)) {
        return res.status(409).json({
          ok: false,
          error: "Thể loại đã tồn tại.",
          id: Number(existing.id) || 0
        });
      }
      return res.redirect(`/admin/genres?status=exists&id=${existing.id}#genre-${existing.id}`);
    }

    const normalizedExisting = await findGenreRowByNormalizedName(name);
    if (normalizedExisting) {
      if (normalizedExisting.name !== name) {
        await dbRun("UPDATE genres SET name = ? WHERE id = ?", [name, normalizedExisting.id]);
      }
      if (wantsJson(req)) {
        return res.status(409).json({
          ok: false,
          error: "Thể loại đã tồn tại.",
          id: Number(normalizedExisting.id) || 0
        });
      }
      return res.redirect(
        `/admin/genres?status=exists&id=${normalizedExisting.id}#genre-${normalizedExisting.id}`
      );
    }

    const result = await dbRun("INSERT INTO genres (name) VALUES (?)", [name]);
    if (wantsJson(req)) {
      return res.json({
        ok: true,
        created: true,
        genre: {
          id: result ? Number(result.lastID) || 0 : 0,
          name,
          count: 0
        }
      });
    }
    return res.redirect(`/admin/genres?status=created&id=${result.lastID}#genre-${result.lastID}`);
  })
);

app.post(
  "/admin/genres/:id/update",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const genreId = Number(req.params.id);
    if (!Number.isFinite(genreId) || genreId <= 0) {
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, error: "ID thể loại không hợp lệ." });
      }
      return res.redirect("/admin/genres?status=invalid");
    }

    const name = normalizeGenreName(req.body.name);
    if (!name) {
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, error: "Vui lòng nhập tên thể loại." });
      }
      return res.redirect(`/admin/genres?status=missing&id=${genreId}#genre-${genreId}`);
    }

    const safeGenreId = Math.floor(genreId);
    const current = await dbGet("SELECT id FROM genres WHERE id = ?", [safeGenreId]);
    if (!current) {
      if (wantsJson(req)) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy thể loại." });
      }
      return res.redirect("/admin/genres?status=notfound");
    }

    const duplicate = await dbGet("SELECT id FROM genres WHERE name = ? AND id <> ?", [
      name,
      safeGenreId
    ]);
    if (duplicate) {
      if (wantsJson(req)) {
        return res.status(409).json({
          ok: false,
          error: "Tên thể loại đã được dùng cho ID khác.",
          id: Number(duplicate.id) || 0
        });
      }
      return res.redirect(
        `/admin/genres?status=duplicate&id=${safeGenreId}&target=${duplicate.id}#genre-${safeGenreId}`
      );
    }

    await dbRun("UPDATE genres SET name = ? WHERE id = ?", [name, safeGenreId]);
    if (wantsJson(req)) {
      return res.json({
        ok: true,
        updated: true,
        genre: {
          id: safeGenreId,
          name
        }
      });
    }
    return res.redirect(`/admin/genres?status=updated&id=${safeGenreId}#genre-${safeGenreId}`);
  })
);

app.post(
  "/admin/genres/:id/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const genreId = Number(req.params.id);
    if (!Number.isFinite(genreId) || genreId <= 0) {
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, error: "ID thể loại không hợp lệ." });
      }
      return res.redirect("/admin/genres?status=invalid");
    }

    const safeGenreId = Math.floor(genreId);
    const result = await dbRun("DELETE FROM genres WHERE id = ?", [safeGenreId]);
    if (!result || !result.changes) {
      if (wantsJson(req)) {
        return res.status(404).json({ ok: false, error: "Không tìm thấy thể loại cần xóa." });
      }
      return res.redirect("/admin/genres?status=notfound");
    }

    if (wantsJson(req)) {
      return res.json({ ok: true, deleted: true, id: safeGenreId });
    }

    return res.redirect("/admin/genres?status=deleted");
  })
);

const TEAM_BADGE_LEADER_COLOR = "#ef4444";
const TEAM_BADGE_MEMBER_COLOR = "#3b82f6";
const TEAM_BADGE_LEADER_PRIORITY_FALLBACK = 55;
const TEAM_BADGE_MEMBER_PRIORITY_FALLBACK = 45;

const buildTeamBadgeCode = (teamId, role) => {
  const id = Number(teamId);
  if (!Number.isFinite(id) || id <= 0) return "";
  const safeRole = (role || "").toString().trim().toLowerCase() === "leader" ? "leader" : "member";
  return `team_${Math.floor(id)}_${safeRole}`;
};

const resolveTeamBadgePriority = async (dbGetFn = dbGet) => {
  const row = await dbGetFn(
    `
      SELECT
        MAX(CASE WHEN lower(code) = 'admin' THEN priority END) as admin_priority,
        MAX(CASE WHEN lower(code) = 'mod' THEN priority END) as mod_priority,
        MAX(CASE WHEN lower(code) NOT IN ('admin', 'mod') THEN priority END) as other_priority
      FROM badges
    `
  );

  const adminPriority = row && row.admin_priority != null ? Number(row.admin_priority) : NaN;
  const modPriority = row && row.mod_priority != null ? Number(row.mod_priority) : NaN;
  const otherPriority = row && row.other_priority != null ? Number(row.other_priority) : NaN;
  const safeOtherPriority = Number.isFinite(otherPriority)
    ? Math.floor(otherPriority)
    : TEAM_BADGE_MEMBER_PRIORITY_FALLBACK;

  let leaderPriority = Number.isFinite(modPriority)
    ? Math.floor(modPriority) - 1
    : Number.isFinite(adminPriority)
      ? Math.floor(adminPriority) - 1
      : TEAM_BADGE_LEADER_PRIORITY_FALLBACK;
  if (leaderPriority <= safeOtherPriority) {
    leaderPriority = safeOtherPriority + 1;
  }
  if (Number.isFinite(modPriority) && leaderPriority > Math.floor(modPriority)) {
    leaderPriority = Math.floor(modPriority);
  }
  if (!Number.isFinite(modPriority) && Number.isFinite(adminPriority) && leaderPriority > Math.floor(adminPriority)) {
    leaderPriority = Math.floor(adminPriority);
  }

  let memberPriority = safeOtherPriority + 1;
  if (memberPriority >= leaderPriority) {
    memberPriority = Math.max(1, leaderPriority - 1);
  }

  return {
    leaderPriority: Number.isFinite(leaderPriority) ? Math.floor(leaderPriority) : TEAM_BADGE_LEADER_PRIORITY_FALLBACK,
    memberPriority: Number.isFinite(memberPriority) ? Math.floor(memberPriority) : TEAM_BADGE_MEMBER_PRIORITY_FALLBACK
  };
};

const upsertTeamRoleBadge = async ({ teamId, teamName, role, dbGetFn = dbGet, dbRunFn = dbRun }) => {
  const safeTeamId = Number(teamId);
  if (!Number.isFinite(safeTeamId) || safeTeamId <= 0) return 0;

  const safeRole = (role || "").toString().trim().toLowerCase() === "leader" ? "leader" : "member";
  const safeTeamName = (teamName || "").toString().trim() || "Nhóm dịch";
  const code = buildTeamBadgeCode(safeTeamId, safeRole);
  if (!code) return 0;

  const now = Date.now();
  const label = safeRole === "leader" ? `Leader ${safeTeamName}` : safeTeamName;
  const color = safeRole === "leader" ? TEAM_BADGE_LEADER_COLOR : TEAM_BADGE_MEMBER_COLOR;
  const priorities = await resolveTeamBadgePriority(dbGetFn);
  const priority = safeRole === "leader" ? priorities.leaderPriority : priorities.memberPriority;

  const result = await dbRunFn(
    `
      INSERT INTO badges (
        code,
        label,
        color,
        priority,
        can_access_admin,
        can_delete_any_comment,
        can_comment,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, false, false, true, ?, ?)
      ON CONFLICT (code)
      DO UPDATE SET
        label = EXCLUDED.label,
        color = EXCLUDED.color,
        priority = EXCLUDED.priority,
        can_access_admin = false,
        can_delete_any_comment = false,
        can_comment = true,
        updated_at = EXCLUDED.updated_at
      RETURNING id
    `,
    [code, label, color, priority, now, now]
  );

  const id = result && Array.isArray(result.rows) && result.rows[0] ? Number(result.rows[0].id) : 0;
  if (Number.isFinite(id) && id > 0) {
    return Math.floor(id);
  }

  const row = await dbGetFn("SELECT id FROM badges WHERE lower(code) = lower(?) LIMIT 1", [code]);
  const fallbackId = row && row.id != null ? Number(row.id) : 0;
  return Number.isFinite(fallbackId) && fallbackId > 0 ? Math.floor(fallbackId) : 0;
};

const clearTeamBadgesForUser = async ({ teamId, userId, dbRunFn = dbRun }) => {
  const safeTeamId = Number(teamId);
  const safeUserId = (userId || "").toString().trim();
  if (!Number.isFinite(safeTeamId) || safeTeamId <= 0 || !safeUserId) return;

  const leaderCode = buildTeamBadgeCode(safeTeamId, "leader");
  const memberCode = buildTeamBadgeCode(safeTeamId, "member");
  if (!leaderCode || !memberCode) return;

  await dbRunFn(
    `
      DELETE FROM user_badges ub
      USING badges b
      WHERE ub.badge_id = b.id
        AND ub.user_id = ?
        AND (lower(b.code) = lower(?) OR lower(b.code) = lower(?))
    `,
    [safeUserId, leaderCode, memberCode]
  );
};

const syncTeamBadgeForMember = async ({
  teamId,
  teamName,
  userId,
  role,
  isApproved,
  dbGetFn = dbGet,
  dbRunFn = dbRun
}) => {
  const safeTeamId = Number(teamId);
  const safeUserId = (userId || "").toString().trim();
  if (!Number.isFinite(safeTeamId) || safeTeamId <= 0 || !safeUserId) return;

  await clearTeamBadgesForUser({ teamId: safeTeamId, userId: safeUserId, dbRunFn });
  if (!isApproved) return;

  const safeRole = (role || "").toString().trim().toLowerCase() === "leader" ? "leader" : "member";
  const badgeId = await upsertTeamRoleBadge({
    teamId: safeTeamId,
    teamName,
    role: safeRole,
    dbGetFn,
    dbRunFn
  });
  if (!badgeId) return;

  await dbRunFn(
    "INSERT INTO user_badges (user_id, badge_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    [safeUserId, badgeId, Date.now()]
  );

  const safeTeamName = (teamName || "").toString().trim() || "Member";
  const roleLabel = safeRole === "leader" ? `Leader ${safeTeamName}` : safeTeamName;
  await dbRunFn("UPDATE users SET badge = ?, updated_at = ? WHERE id = ?", [roleLabel, Date.now(), safeUserId]);
};

const restoreTeamBadgesForUser = async ({ userId, dbAllFn = dbAll, dbGetFn = dbGet, dbRunFn = dbRun }) => {
  const safeUserId = (userId || "").toString().trim();
  if (!safeUserId) return;

  const memberships = await dbAllFn(
    `
      SELECT
        tm.team_id,
        tm.role,
        tm.status as member_status,
        t.name as team_name,
        t.status as team_status
      FROM translation_team_members tm
      JOIN translation_teams t ON t.id = tm.team_id
      WHERE tm.user_id = ?
    `,
    [safeUserId]
  );

  for (const item of Array.isArray(memberships) ? memberships : []) {
    const teamId = Number(item && item.team_id);
    if (!Number.isFinite(teamId) || teamId <= 0) continue;

    const role = (item && item.role ? String(item.role) : "member").trim().toLowerCase() === "leader"
      ? "leader"
      : "member";
    const memberStatus = (item && item.member_status ? String(item.member_status) : "").trim().toLowerCase();
    const teamStatus = (item && item.team_status ? String(item.team_status) : "").trim().toLowerCase();
    const isApproved = memberStatus === "approved" && teamStatus === "approved";

    await syncTeamBadgeForMember({
      teamId: Math.floor(teamId),
      teamName: item && item.team_name ? String(item.team_name) : "",
      userId: safeUserId,
      role,
      isApproved,
      dbGetFn,
      dbRunFn
    });
  }
};

const TEAM_NAME_MAX_LENGTH = 30;
const TEAM_INTRO_MAX_LENGTH = 300;
const TEAM_SLUG_MAX_LENGTH = 60;
const TEAM_REJECT_REASON_MAX_LENGTH = 300;
const TEAM_GROUP_NAME_EMPTY_LABEL = "Không có";

const TEAM_REVIEW_FILTER_VALUES = new Set(["pending", "approved", "rejected"]);
const TEAM_STATUS_VALUES = new Set(["pending", "approved", "rejected"]);

const normalizeTeamReviewFilter = (value) => {
  const normalized = (value || "").toString().trim().toLowerCase();
  if (TEAM_REVIEW_FILTER_VALUES.has(normalized)) return normalized;
  return "all";
};

const normalizeTeamStatusValue = (value, fallback = "pending") => {
  const normalized = (value || "").toString().trim().toLowerCase();
  if (TEAM_STATUS_VALUES.has(normalized)) return normalized;
  return TEAM_STATUS_VALUES.has((fallback || "").toString().trim().toLowerCase())
    ? (fallback || "").toString().trim().toLowerCase()
    : "pending";
};

const normalizeTeamNameInput = (value) =>
  (value || "")
    .toString()
    .replace(/\s+/g, " ")
    .trim();

const normalizeTeamIntroInput = (value) =>
  (value || "")
    .toString()
    .replace(/\s+/g, " ")
    .trim();

const normalizeTeamRejectReasonInput = (value) =>
  (value || "")
    .toString()
    .replace(/\s+/g, " ")
    .trim();

const teamSlugify = (value) =>
  (value || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const normalizeTeamSlugInput = (value) => teamSlugify(value).slice(0, TEAM_SLUG_MAX_LENGTH);

const parseAdminTeamCommunityLinks = ({ facebookRaw, discordRaw }) => {
  const rawFacebook = (facebookRaw || "").toString().trim();
  const rawDiscord = (discordRaw || "").toString().trim();
  const facebookUrl = normalizeProfileFacebook(rawFacebook);
  const discordUrl = normalizeProfileDiscord(rawDiscord);

  if (rawFacebook && !facebookUrl) {
    return { ok: false, error: "Link Facebook phải có dạng facebook.com/*." };
  }

  if (rawDiscord && !discordUrl) {
    return { ok: false, error: "Link Discord phải có dạng discord.gg/*." };
  }

  return {
    ok: true,
    facebookUrl,
    discordUrl
  };
};

const mapAdminTeamRow = (row) => ({
  id: Number(row && row.id) || 0,
  name: (row && row.name ? row.name : "").toString(),
  slug: (row && row.slug ? row.slug : "").toString(),
  intro: (row && row.intro ? row.intro : "").toString().trim(),
  facebookUrl: (row && row.facebook_url ? row.facebook_url : "").toString().trim(),
  discordUrl: (row && row.discord_url ? row.discord_url : "").toString().trim(),
  status: normalizeTeamStatusValue(row && row.status ? row.status : "pending", "pending"),
  rejectReason: (row && row.reject_reason ? row.reject_reason : "").toString().trim(),
  createdAt: Number(row && row.created_at) || 0,
  updatedAt: Number(row && row.updated_at) || 0,
  creatorUsername: (row && row.creator_username ? row.creator_username : "").toString().trim(),
  creatorDisplayName: (row && row.creator_display_name ? row.creator_display_name : "").toString().trim(),
  memberCount: Number(row && row.member_count) || 0
});

const TEAM_MEMBER_ROLE_VALUES = new Set(["leader", "member"]);
const TEAM_MEMBER_STATUS_VALUES = new Set(["pending", "approved", "rejected"]);

const normalizeAdminTeamMemberRoleValue = (value, fallback = "member") => {
  const normalized = (value || "").toString().trim().toLowerCase();
  if (TEAM_MEMBER_ROLE_VALUES.has(normalized)) return normalized;
  return TEAM_MEMBER_ROLE_VALUES.has((fallback || "").toString().trim().toLowerCase())
    ? (fallback || "").toString().trim().toLowerCase()
    : "member";
};

const normalizeAdminTeamMemberStatusValue = (value, fallback = "approved") => {
  const normalized = (value || "").toString().trim().toLowerCase();
  if (TEAM_MEMBER_STATUS_VALUES.has(normalized)) return normalized;
  return TEAM_MEMBER_STATUS_VALUES.has((fallback || "").toString().trim().toLowerCase())
    ? (fallback || "").toString().trim().toLowerCase()
    : "approved";
};

const buildAdminTeamMemberPermissionGroups = (permissions) => {
  const source = permissions && typeof permissions === "object" ? permissions : {};
  const canManageManga = Boolean(source.canAddManga && source.canEditManga && source.canDeleteManga);
  const canManageChapter = Boolean(source.canAddChapter && source.canEditChapter && source.canDeleteChapter);
  return {
    canManageManga,
    canManageChapter
  };
};

const mapAdminTeamMemberRow = (row) => {
  const role = normalizeAdminTeamMemberRoleValue(row && row.role ? row.role : "member", "member");
  const status = normalizeAdminTeamMemberStatusValue(row && row.status ? row.status : "pending", "pending");
  const permissions = buildTeamManagePermissions({
    role,
    rawPermissions: {
      canAddManga: row && row.can_add_manga,
      canEditManga: row && row.can_edit_manga,
      canDeleteManga: row && row.can_delete_manga,
      canAddChapter: row && row.can_add_chapter,
      canEditChapter: row && row.can_edit_chapter,
      canDeleteChapter: row && row.can_delete_chapter
    }
  });

  return {
    userId: (row && row.user_id ? row.user_id : "").toString().trim(),
    username: (row && row.username ? row.username : "").toString().trim(),
    displayName: (row && row.display_name ? row.display_name : "").toString().trim(),
    avatarUrl: normalizeAvatarUrl((row && row.avatar_url ? row.avatar_url : "").toString().trim()),
    role,
    status,
    requestedAt: Number(row && row.requested_at) || 0,
    reviewedAt: Number(row && row.reviewed_at) || 0,
    permissions,
    permissionGroups: buildAdminTeamMemberPermissionGroups(permissions)
  };
};

const mapAdminTeamMemberSearchUserRow = (row) => {
  const userId = (row && row.user_id ? row.user_id : row && row.id ? row.id : "").toString().trim();
  if (!userId) return null;
  const username = (row && row.username ? row.username : "").toString().trim();
  const displayName = (row && row.display_name ? row.display_name : "").toString().trim();
  return {
    userId,
    username,
    displayName: displayName || username || "Thành viên chưa đặt tên",
    avatarUrl: normalizeAvatarUrl((row && row.avatar_url ? row.avatar_url : "").toString().trim()),
    alreadyInTeam: Boolean(Number(row && row.already_in_team) || false)
  };
};

const ensureSingleApprovedLeaderForAdminTeam = async ({
  teamId,
  preferredLeaderUserId = "",
  actorUserId = "",
  teamName = "",
  dbAllFn = dbAll,
  dbGetFn = dbGet,
  dbRunFn = dbRun
}) => {
  const safeTeamId = Number(teamId);
  if (!Number.isFinite(safeTeamId) || safeTeamId <= 0) {
    return { leaderUserId: "", demotedUserIds: [] };
  }

  const preferredUserId = (preferredLeaderUserId || "").toString().trim();
  const safeActorUserId = (actorUserId || "").toString().trim();
  const safeTeamName = (teamName || "").toString().trim();

  const leaderRows = await dbAllFn(
    `
      SELECT user_id, reviewed_at, requested_at
      FROM translation_team_members
      WHERE team_id = ?
        AND role = 'leader'
        AND status = 'approved'
      ORDER BY
        CASE WHEN ? <> '' AND user_id = ? THEN 0 ELSE 1 END ASC,
        COALESCE(reviewed_at, requested_at, 0) DESC,
        requested_at DESC,
        user_id ASC
    `,
    [Math.floor(safeTeamId), preferredUserId, preferredUserId]
  );

  const leaderUserIds = Array.from(
    new Set(
      (Array.isArray(leaderRows) ? leaderRows : [])
        .map((row) => (row && row.user_id ? String(row.user_id).trim() : ""))
        .filter(Boolean)
    )
  );

  if (!leaderUserIds.length) {
    return { leaderUserId: "", demotedUserIds: [] };
  }

  const keptLeaderUserId = leaderUserIds[0];
  const demotedUserIds = leaderUserIds.slice(1);
  if (!demotedUserIds.length) {
    return { leaderUserId: keptLeaderUserId, demotedUserIds: [] };
  }

  const now = Date.now();
  const reviewedByUserId = safeActorUserId || keptLeaderUserId;

  for (const demotedUserId of demotedUserIds) {
    await dbRunFn(
      `
        UPDATE translation_team_members
        SET role = 'member', reviewed_at = ?, reviewed_by_user_id = ?
        WHERE team_id = ?
          AND user_id = ?
          AND role = 'leader'
          AND status = 'approved'
      `,
      [now, reviewedByUserId, Math.floor(safeTeamId), demotedUserId]
    );

    await syncTeamBadgeForMember({
      teamId: Math.floor(safeTeamId),
      teamName: safeTeamName,
      userId: demotedUserId,
      role: "member",
      isApproved: true,
      dbGetFn,
      dbRunFn
    });
  }

  await syncTeamBadgeForMember({
    teamId: Math.floor(safeTeamId),
    teamName: safeTeamName,
    userId: keptLeaderUserId,
    role: "leader",
    isApproved: true,
    dbGetFn,
    dbRunFn
  });

  return { leaderUserId: keptLeaderUserId, demotedUserIds };
};

const listAdminTeamMembers = async ({ teamId, dbAllFn = dbAll }) => {
  const safeTeamId = Number(teamId);
  if (!Number.isFinite(safeTeamId) || safeTeamId <= 0) return [];

  const rows = await dbAllFn(
    `
      SELECT
        tm.team_id,
        tm.user_id,
        tm.role,
        tm.status,
        tm.requested_at,
        tm.reviewed_at,
        tm.can_add_manga,
        tm.can_edit_manga,
        tm.can_delete_manga,
        tm.can_add_chapter,
        tm.can_edit_chapter,
        tm.can_delete_chapter,
        u.username,
        u.display_name,
        u.avatar_url
      FROM translation_team_members tm
      LEFT JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?
      ORDER BY
        CASE WHEN tm.role = 'leader' THEN 0 ELSE 1 END ASC,
        CASE tm.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END ASC,
        COALESCE(tm.reviewed_at, tm.requested_at) DESC,
        tm.user_id ASC
    `,
    [Math.floor(safeTeamId)]
  );

  return (Array.isArray(rows) ? rows : [])
    .map((row) => mapAdminTeamMemberRow(row))
    .filter((item) => item && item.userId);
};

const parseAdminTeamMemberPayload = (input, { defaultRole = "member", defaultStatus = "approved" } = {}) => {
  const source = input && typeof input === "object" ? input : {};
  const role = normalizeAdminTeamMemberRoleValue(source.role, defaultRole);
  let status = normalizeAdminTeamMemberStatusValue(source.status, defaultStatus);

  if (role === "leader") {
    status = "approved";
  }

  const canManageManga = role === "leader" ? true : toBooleanFlag(source.can_manage_manga);
  const canManageChapter = role === "leader" ? true : toBooleanFlag(source.can_manage_chapter);

  const permissions = {
    canAddManga: canManageManga,
    canEditManga: canManageManga,
    canDeleteManga: canManageManga,
    canAddChapter: canManageChapter,
    canEditChapter: canManageChapter,
    canDeleteChapter: canManageChapter
  };

  return {
    role,
    status,
    permissions,
    permissionGroups: {
      canManageManga,
      canManageChapter
    }
  };
};

const mapAdminTeamPayload = (row) => ({
  id: Number(row && row.id) || 0,
  name: (row && row.name ? row.name : "").toString().trim(),
  slug: (row && row.slug ? row.slug : "").toString().trim(),
  status: normalizeTeamStatusValue(row && row.status ? row.status : "pending", "pending")
});

const listAdminTeams = async ({ q, review }) => {
  const query = (q || "").toString().trim().slice(0, 60);
  const normalizedReview = normalizeTeamReviewFilter(review);
  const whereParts = [];
  const whereParams = [];

  if (normalizedReview !== "all") {
    whereParts.push("t.status = ?");
    whereParams.push(normalizedReview);
  }

  if (query) {
    const likeValue = `%${query}%`;
    whereParts.push(
      "(t.name ILIKE ? OR t.slug ILIKE ? OR COALESCE(creator.username, '') ILIKE ? OR COALESCE(creator.display_name, '') ILIKE ?)"
    );
    whereParams.push(likeValue, likeValue, likeValue, likeValue);
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const pendingCountRow = await dbGet(
    "SELECT COUNT(*) as count FROM translation_teams WHERE status = 'pending'"
  );
  const rows = await dbAll(
    `
      SELECT
        t.id,
        t.name,
        t.slug,
        t.intro,
        t.facebook_url,
        t.discord_url,
        t.status,
        t.reject_reason,
        t.created_at,
        t.updated_at,
        creator.username as creator_username,
        creator.display_name as creator_display_name,
        (
          SELECT COUNT(*)
          FROM translation_team_members tm
          WHERE tm.team_id = t.id
        ) as member_count
      FROM translation_teams t
      LEFT JOIN users creator ON creator.id = t.created_by_user_id
      ${whereClause}
      ORDER BY
        CASE t.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        t.created_at DESC,
        t.id DESC
    `,
    whereParams
  );

  return {
    q: query,
    review: normalizedReview,
    pendingCount: pendingCountRow ? Number(pendingCountRow.count) || 0 : 0,
    teams: rows.map((row) => mapAdminTeamRow(row))
  };
};

const redirectAdminTeamsWithStatus = (res, statusValue) => {
  const safeStatus = (statusValue || "").toString().trim() || "error";
  return res.redirect(`/admin/teams?status=${encodeURIComponent(safeStatus)}`);
};

const sendAdminTeamsError = (req, res, { statusCode = 400, error, status = "error" } = {}) => {
  const message = (error || "Không thể xử lý nhóm dịch.").toString();
  if (wantsJson(req)) {
    return res.status(statusCode).json({ ok: false, error: message });
  }
  return redirectAdminTeamsWithStatus(res, status);
};

const sendAdminTeamsSuccess = (req, res, payload = {}, status = "updated") => {
  if (wantsJson(req)) {
    return res.json({ ok: true, ...payload });
  }
  return redirectAdminTeamsWithStatus(res, status);
};

app.get(
  "/admin/teams/search",
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).send("Yêu cầu JSON.");
    }

    const q = (req.query && typeof req.query.q === "string" ? req.query.q : "").trim().slice(0, 60);
    if (!q) {
      return res.json({ ok: true, q, teams: [] });
    }

    const likeValue = `%${q}%`;
    const startsWithValue = `${q}%`;
    const rows = await dbAll(
      `
        SELECT id, name, slug
        FROM translation_teams
        WHERE status = 'approved'
          AND (name ILIKE ? OR slug ILIKE ?)
        ORDER BY
          CASE
            WHEN lower(trim(name)) = lower(?) THEN 0
            WHEN lower(trim(slug)) = lower(?) THEN 1
            WHEN lower(name) LIKE lower(?) THEN 2
            WHEN lower(slug) LIKE lower(?) THEN 3
            ELSE 4
          END ASC,
          LEAST(
            CASE WHEN strpos(lower(name), lower(?)) > 0 THEN strpos(lower(name), lower(?)) ELSE 9999 END,
            CASE WHEN strpos(lower(slug), lower(?)) > 0 THEN strpos(lower(slug), lower(?)) ELSE 9999 END
          ) ASC,
          ABS(char_length(name) - char_length(?)) ASC,
          updated_at DESC,
          id DESC
        LIMIT 5
      `,
      [
        likeValue,
        likeValue,
        q,
        q,
        startsWithValue,
        startsWithValue,
        q,
        q,
        q,
        q,
        q
      ]
    );

    const teams = (Array.isArray(rows) ? rows : [])
      .map((row) => mapAdminTeamPickerRow(row))
      .filter((item) => item && item.id && item.name);

    return res.json({
      ok: true,
      q,
      teams
    });
  })
);

app.get(
  "/admin/teams/member-users/search",
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).json({ ok: false, error: "Yêu cầu JSON." });
    }

    const rawQ = (req.query && typeof req.query.q === "string" ? req.query.q : "").trim().slice(0, 60);
    const q = rawQ.startsWith("@") ? rawQ.slice(1).trim() : rawQ;
    const teamIdRaw = Number(req.query && req.query.teamId);
    const teamId = Number.isFinite(teamIdRaw) && teamIdRaw > 0 ? Math.floor(teamIdRaw) : 0;
    if (!q) {
      return res.json({ ok: true, q, teamId, users: [] });
    }

    const likeValue = `%${q}%`;
    const startsWithValue = `${q}%`;
    const rows = await dbAll(
      `
        SELECT
          u.id as user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          CASE WHEN tm.user_id IS NULL THEN 0 ELSE 1 END as already_in_team
        FROM users u
        LEFT JOIN translation_team_members tm
          ON tm.team_id = ?
          AND tm.user_id = u.id
        WHERE
          (
            u.id = ?
            OR u.username ILIKE ?
            OR COALESCE(u.display_name, '') ILIKE ?
          )
          AND (
            ? <= 0
            OR tm.user_id IS NULL
          )
        ORDER BY
          CASE
            WHEN lower(trim(u.username)) = lower(?) THEN 0
            WHEN lower(trim(COALESCE(u.display_name, ''))) = lower(?) THEN 1
            WHEN lower(u.username) LIKE lower(?) THEN 2
            WHEN lower(COALESCE(u.display_name, '')) LIKE lower(?) THEN 3
            WHEN u.id = ? THEN 4
            ELSE 5
          END ASC,
          ABS(char_length(COALESCE(u.username, '')) - char_length(?)) ASC,
          lower(COALESCE(u.username, '')) ASC,
          u.id ASC
        LIMIT 5
      `,
      [teamId, q, likeValue, likeValue, teamId, q, q, startsWithValue, startsWithValue, q, q]
    );

    const users = (Array.isArray(rows) ? rows : [])
      .map((row) => mapAdminTeamMemberSearchUserRow(row))
      .filter(Boolean);

    return res.json({
      ok: true,
      q,
      teamId,
      users
    });
  })
);

app.get(
  "/admin/teams",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const reviewInput = typeof req.query.review === "string" ? req.query.review : "all";
    const listResult = await listAdminTeams({ q, review: reviewInput });

    if (wantsJson(req)) {
      return res.json({
        ok: true,
        status,
        q: listResult.q,
        review: listResult.review,
        pendingCount: listResult.pendingCount,
        resultCount: listResult.teams.length,
        teams: listResult.teams
      });
    }

    return res.render("admin/teams", {
      title: "Nhóm dịch",
      status,
      q: listResult.q,
      review: listResult.review,
      pendingCount: listResult.pendingCount,
      teams: listResult.teams
    });
  })
);

app.post(
  "/admin/teams/create",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const inputName = normalizeTeamNameInput(req.body && req.body.name ? req.body.name : "");
    const inputIntro = normalizeTeamIntroInput(req.body && req.body.intro ? req.body.intro : "");
    const inputStatus = normalizeTeamStatusValue(req.body && req.body.status ? req.body.status : "", "approved");
    const inputRejectReason = normalizeTeamRejectReasonInput(
      req.body && req.body.reject_reason ? req.body.reject_reason : ""
    );
    const inputSlugRaw = (req.body && req.body.slug ? req.body.slug : "").toString();
    const inputSlug = normalizeTeamSlugInput(inputSlugRaw || inputName);
    const communityLinks = parseAdminTeamCommunityLinks({
      facebookRaw: req.body && req.body.facebook_url ? req.body.facebook_url : "",
      discordRaw: req.body && req.body.discord_url ? req.body.discord_url : ""
    });

    if (!communityLinks.ok) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: communityLinks.error || "Link cộng đồng không hợp lệ."
      });
    }

    if (!inputName) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "missing",
        error: "Tên nhóm dịch không được để trống."
      });
    }
    if (inputName.length > TEAM_NAME_MAX_LENGTH) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: `Tên nhóm dịch tối đa ${TEAM_NAME_MAX_LENGTH} ký tự.`
      });
    }
    if (inputIntro.length > TEAM_INTRO_MAX_LENGTH) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: `Mô tả nhóm dịch tối đa ${TEAM_INTRO_MAX_LENGTH} ký tự.`
      });
    }
    if (!inputSlug) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: "Slug nhóm dịch không hợp lệ."
      });
    }
    if (inputRejectReason.length > TEAM_REJECT_REASON_MAX_LENGTH) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: `Lý do từ chối tối đa ${TEAM_REJECT_REASON_MAX_LENGTH} ký tự.`
      });
    }

    const duplicatedSlug = await dbGet(
      "SELECT id FROM translation_teams WHERE lower(slug) = lower(?) LIMIT 1",
      [inputSlug]
    );
    if (duplicatedSlug) {
      return sendAdminTeamsError(req, res, {
        statusCode: 409,
        status: "exists",
        error: "Slug nhóm dịch đã tồn tại."
      });
    }

    const actorUserId =
      (req.session && req.session.adminUserId ? String(req.session.adminUserId) : "").trim() || null;
    const now = Date.now();

    const created = await withTransaction(async ({ dbGet: txGet, dbRun: txRun }) => {
      const insertedTeam = await txRun(
        `
          INSERT INTO translation_teams (
            name,
            slug,
            intro,
            facebook_url,
            discord_url,
            status,
            created_by_user_id,
            approved_by_user_id,
            approved_at,
            reject_reason,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          inputName,
          inputSlug,
          inputIntro,
          communityLinks.facebookUrl,
          communityLinks.discordUrl,
          inputStatus,
          actorUserId,
          inputStatus === "approved" ? actorUserId : null,
          inputStatus === "approved" ? now : null,
          inputStatus === "rejected" ? inputRejectReason : "",
          now,
          now
        ]
      );

      const createdTeamId = Number(insertedTeam && insertedTeam.lastID);
      const safeTeamId = Number.isFinite(createdTeamId) && createdTeamId > 0 ? Math.floor(createdTeamId) : 0;
      if (!safeTeamId) {
        throw new Error("Không thể tạo nhóm dịch.");
      }

      if (inputStatus === "approved" && actorUserId) {
        await txRun(
          `
            INSERT INTO translation_team_members (
              team_id,
              user_id,
              role,
              status,
              requested_at,
              reviewed_at,
              reviewed_by_user_id
            )
            VALUES (?, ?, 'leader', 'approved', ?, ?, ?)
            ON CONFLICT (team_id, user_id)
            DO UPDATE SET
              role = EXCLUDED.role,
              status = EXCLUDED.status,
              requested_at = EXCLUDED.requested_at,
              reviewed_at = EXCLUDED.reviewed_at,
              reviewed_by_user_id = EXCLUDED.reviewed_by_user_id
          `,
          [safeTeamId, actorUserId, now, now, actorUserId]
        );

        await syncTeamBadgeForMember({
          teamId: safeTeamId,
          teamName: inputName,
          userId: actorUserId,
          role: "leader",
          isApproved: true,
          dbGetFn: txGet,
          dbRunFn: txRun
        });
      }

      return {
        teamId: safeTeamId
      };
    });

    return sendAdminTeamsSuccess(
      req,
      res,
      {
        team: {
          id: Number(created.teamId) || 0,
          name: inputName,
          slug: inputSlug,
          intro: inputIntro,
          facebookUrl: communityLinks.facebookUrl,
          discordUrl: communityLinks.discordUrl,
          status: inputStatus,
          rejectReason: inputStatus === "rejected" ? inputRejectReason : ""
        },
        message: "Đã tạo nhóm dịch mới."
      },
      "created"
    );
  })
);

app.post(
  "/admin/teams/:id/review",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamId = Number(req.params.id);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: "Nhóm dịch không hợp lệ."
      });
    }

    const action = (req.body && req.body.action ? String(req.body.action) : "").toLowerCase().trim();
    const nextStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "";
    if (!nextStatus) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: "Thao tác duyệt nhóm dịch không hợp lệ."
      });
    }

    const rejectReasonRaw = req.body && req.body.reject_reason ? String(req.body.reject_reason) : "";
    const rejectReason = normalizeTeamRejectReasonInput(rejectReasonRaw).slice(0, TEAM_REJECT_REASON_MAX_LENGTH);
    const teamRow = await dbGet(
      "SELECT id, name, slug, status, created_by_user_id FROM translation_teams WHERE id = ? LIMIT 1",
      [Math.floor(teamId)]
    );
    if (!teamRow) {
      return sendAdminTeamsError(req, res, {
        statusCode: 404,
        status: "notfound",
        error: "Không tìm thấy nhóm dịch."
      });
    }

    const actorUserId =
      (req.session && req.session.adminUserId ? String(req.session.adminUserId) : "").trim() || null;
    const now = Date.now();

    await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
      await txGet(
        "SELECT id FROM translation_teams WHERE id = ? LIMIT 1 FOR UPDATE",
        [Math.floor(teamId)]
      );

      await txRun(
        `
          UPDATE translation_teams
          SET
            status = ?,
            approved_by_user_id = ?,
            approved_at = ?,
            reject_reason = ?,
            updated_at = ?
          WHERE id = ?
        `,
        [nextStatus, actorUserId, nextStatus === "approved" ? now : null, nextStatus === "rejected" ? rejectReason : "", now, Math.floor(teamId)]
      );

      await txRun(
        `
          UPDATE translation_team_members
          SET
            status = CASE WHEN role = 'leader' AND ? = 'approved' THEN 'approved' ELSE status END,
            reviewed_at = CASE WHEN role = 'leader' THEN ? ELSE reviewed_at END,
            reviewed_by_user_id = CASE WHEN role = 'leader' THEN ? ELSE reviewed_by_user_id END
          WHERE team_id = ?
        `,
        [nextStatus, now, actorUserId, Math.floor(teamId)]
      );

      if (nextStatus === "approved") {
        await ensureSingleApprovedLeaderForAdminTeam({
          teamId: Math.floor(teamId),
          actorUserId: actorUserId || "",
          teamName: teamRow.name || "",
          dbAllFn: txAll,
          dbGetFn: txGet,
          dbRunFn: txRun
        });
      }

      const members = await txAll(
        `
          SELECT user_id, role, status
          FROM translation_team_members
          WHERE team_id = ?
        `,
        [Math.floor(teamId)]
      );
      for (const member of members) {
        const memberUserId = member && member.user_id ? String(member.user_id).trim() : "";
        if (!memberUserId) continue;
        const role = (member && member.role ? String(member.role) : "member").trim().toLowerCase();
        const memberStatus = (member && member.status ? String(member.status) : "").trim().toLowerCase();
        const isApprovedMember = nextStatus === "approved" && memberStatus === "approved";

        await syncTeamBadgeForMember({
          teamId: Math.floor(teamId),
          teamName: teamRow.name || "",
          userId: memberUserId,
          role,
          isApproved: isApprovedMember,
          dbGetFn: txGet,
          dbRunFn: txRun
        });
      }

      const ownerUserId = teamRow && teamRow.created_by_user_id ? String(teamRow.created_by_user_id).trim() : "";
      if (!ownerUserId) return;

      const existingThread = await txGet(
        `
          SELECT tm1.thread_id
          FROM chat_thread_members tm1
          JOIN chat_thread_members tm2 ON tm2.thread_id = tm1.thread_id
          WHERE tm1.user_id = ? AND tm2.user_id = ?
          GROUP BY tm1.thread_id
          HAVING COUNT(*) = 2
          LIMIT 1
        `,
        [actorUserId || ownerUserId, ownerUserId]
      );

      let threadId = existingThread && existingThread.thread_id ? Number(existingThread.thread_id) : 0;
      if (!threadId) {
        const threadInsert = await txRun(
          "INSERT INTO chat_threads (created_at, updated_at, last_message_at) VALUES (?, ?, ?)",
          [now, now, now]
        );
        threadId = threadInsert && threadInsert.lastID ? Number(threadInsert.lastID) : 0;
        if (threadId) {
          await txRun(
            "INSERT INTO chat_thread_members (thread_id, user_id, joined_at, last_read_message_id) VALUES (?, ?, ?, NULL) ON CONFLICT DO NOTHING",
            [threadId, ownerUserId, now]
          );
          await txRun(
            "INSERT INTO chat_thread_members (thread_id, user_id, joined_at, last_read_message_id) VALUES (?, ?, ?, NULL) ON CONFLICT DO NOTHING",
            [threadId, actorUserId || ownerUserId, now]
          );
        }
      }

      if (threadId) {
        const message =
          nextStatus === "approved"
            ? `Nhóm dịch "${teamRow.name || ""}" đã được admin duyệt.`
            : `Nhóm dịch "${teamRow.name || ""}" đã bị từ chối.${rejectReason ? ` Lý do: ${rejectReason}` : ""}`;
        const insertedMessage = await txRun(
          "INSERT INTO chat_messages (thread_id, sender_user_id, content, client_request_id, created_at) VALUES (?, ?, ?, ?, ?)",
          [threadId, actorUserId || ownerUserId, message, `team-review:${teamId}:${nextStatus}:${now}`, now]
        );
        const messageId = insertedMessage && insertedMessage.lastID ? Number(insertedMessage.lastID) : 0;
        await txRun("UPDATE chat_threads SET updated_at = ?, last_message_at = ? WHERE id = ?", [now, now, threadId]);
        if (messageId > 0) {
          await txRun(
            "UPDATE chat_thread_members SET last_read_message_id = ? WHERE thread_id = ? AND user_id = ?",
            [messageId, threadId, actorUserId || ownerUserId]
          );
        }
      }
    });

    return sendAdminTeamsSuccess(
      req,
      res,
      {
        teamId: Math.floor(teamId),
        status: nextStatus,
        message: nextStatus === "approved" ? "Đã duyệt nhóm dịch." : "Đã từ chối nhóm dịch."
      },
      nextStatus
    );
  })
);

app.get(
  "/admin/teams/:id/members",
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).json({ ok: false, error: "Yêu cầu JSON." });
    }

    const teamId = Number(req.params.id);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      return res.status(400).json({ ok: false, error: "Nhóm dịch không hợp lệ." });
    }

    const safeTeamId = Math.floor(teamId);
    const teamRow = await dbGet(
      "SELECT id, name, slug, status FROM translation_teams WHERE id = ? LIMIT 1",
      [safeTeamId]
    );
    if (!teamRow) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy nhóm dịch." });
    }

    const members = await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
      await txGet(
        "SELECT id FROM translation_teams WHERE id = ? LIMIT 1 FOR UPDATE",
        [safeTeamId]
      );
      await ensureSingleApprovedLeaderForAdminTeam({
        teamId: safeTeamId,
        actorUserId: "",
        teamName: teamRow.name || "",
        dbAllFn: txAll,
        dbGetFn: txGet,
        dbRunFn: txRun
      });
      return listAdminTeamMembers({ teamId: safeTeamId, dbAllFn: txAll });
    });

    return res.json({
      ok: true,
      team: mapAdminTeamPayload(teamRow),
      members,
      memberCount: members.length
    });
  })
);

app.post(
  "/admin/teams/:id/members/add",
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).json({ ok: false, error: "Yêu cầu JSON." });
    }

    const teamId = Number(req.params.id);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      return res.status(400).json({ ok: false, error: "Nhóm dịch không hợp lệ." });
    }

    const memberRawInput = (req.body && req.body.member_user ? req.body.member_user : "").toString().trim();
    const memberLookup = memberRawInput.startsWith("@") ? memberRawInput.slice(1).trim() : memberRawInput;
    if (!memberRawInput || !memberLookup) {
      return res.status(400).json({ ok: false, error: "Vui lòng nhập user ID hoặc username." });
    }

    const parsedPayload = parseAdminTeamMemberPayload(req.body || {}, {
      defaultRole: "member",
      defaultStatus: "approved"
    });

    const safeTeamId = Math.floor(teamId);
    const actorUserId =
      (req.session && req.session.adminUserId ? String(req.session.adminUserId) : "").trim() || null;

    const result = await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
      await txGet(
        "SELECT id FROM translation_teams WHERE id = ? LIMIT 1 FOR UPDATE",
        [safeTeamId]
      );

      const teamRow = await txGet(
        "SELECT id, name, slug, status FROM translation_teams WHERE id = ? LIMIT 1",
        [safeTeamId]
      );
      if (!teamRow) {
        return { ok: false, statusCode: 404, error: "Không tìm thấy nhóm dịch." };
      }

      const userRow = await txGet(
        `
          SELECT id, username, display_name
          FROM users
          WHERE id = ? OR lower(username) = lower(?)
          LIMIT 1
        `,
        [memberRawInput, memberLookup]
      );
      const targetUserId = (userRow && userRow.id ? userRow.id : "").toString().trim();
      if (!targetUserId) {
        return { ok: false, statusCode: 404, error: "Không tìm thấy thành viên cần thêm." };
      }

      const now = Date.now();
      const teamPayload = mapAdminTeamPayload(teamRow);
      const isApprovedTeam = teamPayload.status === "approved";

      if (parsedPayload.role === "leader" && parsedPayload.status === "approved") {
        const demotedRows = await txAll(
          `
            SELECT user_id
            FROM translation_team_members
            WHERE team_id = ?
              AND role = 'leader'
              AND status = 'approved'
              AND user_id <> ?
          `,
          [safeTeamId, targetUserId]
        );

        await txRun(
          `
            UPDATE translation_team_members
            SET role = 'member', reviewed_at = ?, reviewed_by_user_id = ?
            WHERE team_id = ?
              AND role = 'leader'
              AND status = 'approved'
              AND user_id <> ?
          `,
          [now, actorUserId, safeTeamId, targetUserId]
        );

        for (const row of Array.isArray(demotedRows) ? demotedRows : []) {
          const demotedUserId = (row && row.user_id ? row.user_id : "").toString().trim();
          if (!demotedUserId) continue;
          await syncTeamBadgeForMember({
            teamId: safeTeamId,
            teamName: teamPayload.name || "",
            userId: demotedUserId,
            role: "member",
            isApproved: isApprovedTeam,
            dbGetFn: txGet,
            dbRunFn: txRun
          });
        }
      }

      await txRun(
        `
          INSERT INTO translation_team_members (
            team_id,
            user_id,
            role,
            status,
            requested_at,
            reviewed_at,
            reviewed_by_user_id,
            can_add_manga,
            can_edit_manga,
            can_delete_manga,
            can_add_chapter,
            can_edit_chapter,
            can_delete_chapter
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (team_id, user_id)
          DO UPDATE SET
            role = EXCLUDED.role,
            status = EXCLUDED.status,
            reviewed_at = EXCLUDED.reviewed_at,
            reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
            can_add_manga = EXCLUDED.can_add_manga,
            can_edit_manga = EXCLUDED.can_edit_manga,
            can_delete_manga = EXCLUDED.can_delete_manga,
            can_add_chapter = EXCLUDED.can_add_chapter,
            can_edit_chapter = EXCLUDED.can_edit_chapter,
            can_delete_chapter = EXCLUDED.can_delete_chapter
        `,
        [
          safeTeamId,
          targetUserId,
          parsedPayload.role,
          parsedPayload.status,
          now,
          now,
          actorUserId,
          parsedPayload.permissions.canAddManga,
          parsedPayload.permissions.canEditManga,
          parsedPayload.permissions.canDeleteManga,
          parsedPayload.permissions.canAddChapter,
          parsedPayload.permissions.canEditChapter,
          parsedPayload.permissions.canDeleteChapter
        ]
      );

      await syncTeamBadgeForMember({
        teamId: safeTeamId,
        teamName: teamPayload.name || "",
        userId: targetUserId,
        role: parsedPayload.role,
        isApproved: isApprovedTeam && parsedPayload.status === "approved",
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      await ensureSingleApprovedLeaderForAdminTeam({
        teamId: safeTeamId,
        preferredLeaderUserId:
          parsedPayload.role === "leader" && parsedPayload.status === "approved" ? targetUserId : "",
        actorUserId: actorUserId || "",
        teamName: teamPayload.name || "",
        dbAllFn: txAll,
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      const members = await listAdminTeamMembers({ teamId: safeTeamId, dbAllFn: txAll });
      const addedName =
        (userRow && userRow.display_name ? String(userRow.display_name).trim() : "") ||
        (userRow && userRow.username ? `@${String(userRow.username).trim()}` : "thành viên");

      return {
        ok: true,
        team: teamPayload,
        members,
        message: `Đã thêm ${addedName} vào nhóm.`
      };
    });

    if (!result || result.ok !== true) {
      return res.status((result && result.statusCode) || 400).json({
        ok: false,
        error: (result && result.error) || "Không thể thêm thành viên."
      });
    }

    return res.json({
      ok: true,
      message: result.message || "Đã thêm thành viên.",
      team: result.team,
      members: result.members,
      memberCount: Array.isArray(result.members) ? result.members.length : 0
    });
  })
);

app.post(
  "/admin/teams/:id/members/:userId/update",
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).json({ ok: false, error: "Yêu cầu JSON." });
    }

    const teamId = Number(req.params.id);
    const targetUserId = (req.params.userId || "").toString().trim();
    if (!Number.isFinite(teamId) || teamId <= 0 || !targetUserId) {
      return res.status(400).json({ ok: false, error: "Dữ liệu thành viên không hợp lệ." });
    }

    const safeTeamId = Math.floor(teamId);
    const actorUserId =
      (req.session && req.session.adminUserId ? String(req.session.adminUserId) : "").trim() || null;

    const result = await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
      await txGet(
        "SELECT id FROM translation_teams WHERE id = ? LIMIT 1 FOR UPDATE",
        [safeTeamId]
      );

      const teamRow = await txGet(
        "SELECT id, name, slug, status FROM translation_teams WHERE id = ? LIMIT 1",
        [safeTeamId]
      );
      if (!teamRow) {
        return { ok: false, statusCode: 404, error: "Không tìm thấy nhóm dịch." };
      }

      const memberRow = await txGet(
        `
          SELECT
            team_id,
            user_id,
            role,
            status,
            can_add_manga,
            can_edit_manga,
            can_delete_manga,
            can_add_chapter,
            can_edit_chapter,
            can_delete_chapter
          FROM translation_team_members
          WHERE team_id = ? AND user_id = ?
          LIMIT 1
        `,
        [safeTeamId, targetUserId]
      );
      if (!memberRow) {
        return { ok: false, statusCode: 404, error: "Không tìm thấy thành viên trong nhóm." };
      }

      const currentRole = normalizeAdminTeamMemberRoleValue(memberRow.role, "member");
      const currentStatus = normalizeAdminTeamMemberStatusValue(memberRow.status, "pending");
      const parsedPayload = parseAdminTeamMemberPayload(req.body || {}, {
        defaultRole: currentRole,
        defaultStatus: currentStatus
      });

      const now = Date.now();
      const teamPayload = mapAdminTeamPayload(teamRow);
      const isApprovedTeam = teamPayload.status === "approved";

      if (
        isApprovedTeam &&
        currentRole === "leader" &&
        currentStatus === "approved" &&
        !(parsedPayload.role === "leader" && parsedPayload.status === "approved")
      ) {
        const otherLeaderRow = await txGet(
          `
            SELECT COUNT(*) AS count
            FROM translation_team_members
            WHERE team_id = ?
              AND role = 'leader'
              AND status = 'approved'
              AND user_id <> ?
          `,
          [safeTeamId, targetUserId]
        );
        const otherLeaderCount = otherLeaderRow ? Number(otherLeaderRow.count) || 0 : 0;
        if (otherLeaderCount <= 0) {
          return {
            ok: false,
            statusCode: 400,
            error: "Nhóm đang hoạt động phải có ít nhất một leader đã duyệt."
          };
        }
      }

      if (parsedPayload.role === "leader" && parsedPayload.status === "approved") {
        const demotedRows = await txAll(
          `
            SELECT user_id
            FROM translation_team_members
            WHERE team_id = ?
              AND role = 'leader'
              AND status = 'approved'
              AND user_id <> ?
          `,
          [safeTeamId, targetUserId]
        );

        await txRun(
          `
            UPDATE translation_team_members
            SET role = 'member', reviewed_at = ?, reviewed_by_user_id = ?
            WHERE team_id = ?
              AND role = 'leader'
              AND status = 'approved'
              AND user_id <> ?
          `,
          [now, actorUserId, safeTeamId, targetUserId]
        );

        for (const row of Array.isArray(demotedRows) ? demotedRows : []) {
          const demotedUserId = (row && row.user_id ? row.user_id : "").toString().trim();
          if (!demotedUserId) continue;
          await syncTeamBadgeForMember({
            teamId: safeTeamId,
            teamName: teamPayload.name || "",
            userId: demotedUserId,
            role: "member",
            isApproved: isApprovedTeam,
            dbGetFn: txGet,
            dbRunFn: txRun
          });
        }
      }

      const updated = await txRun(
        `
          UPDATE translation_team_members
          SET
            role = ?,
            status = ?,
            can_add_manga = ?,
            can_edit_manga = ?,
            can_delete_manga = ?,
            can_add_chapter = ?,
            can_edit_chapter = ?,
            can_delete_chapter = ?,
            reviewed_at = ?,
            reviewed_by_user_id = ?
          WHERE team_id = ? AND user_id = ?
        `,
        [
          parsedPayload.role,
          parsedPayload.status,
          parsedPayload.permissions.canAddManga,
          parsedPayload.permissions.canEditManga,
          parsedPayload.permissions.canDeleteManga,
          parsedPayload.permissions.canAddChapter,
          parsedPayload.permissions.canEditChapter,
          parsedPayload.permissions.canDeleteChapter,
          now,
          actorUserId,
          safeTeamId,
          targetUserId
        ]
      );
      if (!updated || !updated.changes) {
        return { ok: false, statusCode: 404, error: "Không tìm thấy thành viên để cập nhật." };
      }

      await syncTeamBadgeForMember({
        teamId: safeTeamId,
        teamName: teamPayload.name || "",
        userId: targetUserId,
        role: parsedPayload.role,
        isApproved: isApprovedTeam && parsedPayload.status === "approved",
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      await ensureSingleApprovedLeaderForAdminTeam({
        teamId: safeTeamId,
        preferredLeaderUserId:
          parsedPayload.role === "leader" && parsedPayload.status === "approved" ? targetUserId : "",
        actorUserId: actorUserId || "",
        teamName: teamPayload.name || "",
        dbAllFn: txAll,
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      const members = await listAdminTeamMembers({ teamId: safeTeamId, dbAllFn: txAll });
      return {
        ok: true,
        team: teamPayload,
        members,
        message: "Đã cập nhật thành viên nhóm."
      };
    });

    if (!result || result.ok !== true) {
      return res.status((result && result.statusCode) || 400).json({
        ok: false,
        error: (result && result.error) || "Không thể cập nhật thành viên."
      });
    }

    return res.json({
      ok: true,
      message: result.message || "Đã cập nhật thành viên.",
      team: result.team,
      members: result.members,
      memberCount: Array.isArray(result.members) ? result.members.length : 0
    });
  })
);

app.post(
  "/admin/teams/:id/members/:userId/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!wantsJson(req)) {
      return res.status(406).json({ ok: false, error: "Yêu cầu JSON." });
    }

    const teamId = Number(req.params.id);
    const targetUserId = (req.params.userId || "").toString().trim();
    if (!Number.isFinite(teamId) || teamId <= 0 || !targetUserId) {
      return res.status(400).json({ ok: false, error: "Dữ liệu thành viên không hợp lệ." });
    }

    const safeTeamId = Math.floor(teamId);

    const result = await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
      await txGet(
        "SELECT id FROM translation_teams WHERE id = ? LIMIT 1 FOR UPDATE",
        [safeTeamId]
      );

      const teamRow = await txGet(
        "SELECT id, name, slug, status FROM translation_teams WHERE id = ? LIMIT 1",
        [safeTeamId]
      );
      if (!teamRow) {
        return { ok: false, statusCode: 404, error: "Không tìm thấy nhóm dịch." };
      }

      const memberRow = await txGet(
        `
          SELECT user_id, role, status
          FROM translation_team_members
          WHERE team_id = ? AND user_id = ?
          LIMIT 1
        `,
        [safeTeamId, targetUserId]
      );
      if (!memberRow) {
        return { ok: false, statusCode: 404, error: "Không tìm thấy thành viên trong nhóm." };
      }

      const currentRole = normalizeAdminTeamMemberRoleValue(memberRow.role, "member");
      const currentStatus = normalizeAdminTeamMemberStatusValue(memberRow.status, "pending");
      const teamPayload = mapAdminTeamPayload(teamRow);
      const isApprovedTeam = teamPayload.status === "approved";

      if (isApprovedTeam && currentRole === "leader" && currentStatus === "approved") {
        const otherLeaderRow = await txGet(
          `
            SELECT COUNT(*) AS count
            FROM translation_team_members
            WHERE team_id = ?
              AND role = 'leader'
              AND status = 'approved'
              AND user_id <> ?
          `,
          [safeTeamId, targetUserId]
        );
        const otherLeaderCount = otherLeaderRow ? Number(otherLeaderRow.count) || 0 : 0;
        if (otherLeaderCount <= 0) {
          return {
            ok: false,
            statusCode: 400,
            error: "Nhóm đang hoạt động phải có ít nhất một leader đã duyệt."
          };
        }
      }

      const deleted = await txRun(
        "DELETE FROM translation_team_members WHERE team_id = ? AND user_id = ?",
        [safeTeamId, targetUserId]
      );
      if (!deleted || !deleted.changes) {
        return { ok: false, statusCode: 404, error: "Không tìm thấy thành viên để xóa." };
      }

      await syncTeamBadgeForMember({
        teamId: safeTeamId,
        teamName: teamPayload.name || "",
        userId: targetUserId,
        role: currentRole,
        isApproved: false,
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      await ensureSingleApprovedLeaderForAdminTeam({
        teamId: safeTeamId,
        actorUserId: "",
        teamName: teamPayload.name || "",
        dbAllFn: txAll,
        dbGetFn: txGet,
        dbRunFn: txRun
      });

      const members = await listAdminTeamMembers({ teamId: safeTeamId, dbAllFn: txAll });
      return {
        ok: true,
        team: teamPayload,
        members,
        message: "Đã xóa thành viên khỏi nhóm."
      };
    });

    if (!result || result.ok !== true) {
      return res.status((result && result.statusCode) || 400).json({
        ok: false,
        error: (result && result.error) || "Không thể xóa thành viên."
      });
    }

    return res.json({
      ok: true,
      message: result.message || "Đã xóa thành viên.",
      team: result.team,
      members: result.members,
      memberCount: Array.isArray(result.members) ? result.members.length : 0
    });
  })
);

app.post(
  "/admin/teams/:id/update",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamId = Number(req.params.id);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: "Nhóm dịch không hợp lệ."
      });
    }
    const safeTeamId = Math.floor(teamId);

    const teamRow = await dbGet(
      `
        SELECT id, name, slug, intro, facebook_url, discord_url, status
        FROM translation_teams
        WHERE id = ?
        LIMIT 1
      `,
      [safeTeamId]
    );
    if (!teamRow) {
      return sendAdminTeamsError(req, res, {
        statusCode: 404,
        status: "notfound",
        error: "Không tìm thấy nhóm dịch."
      });
    }

    const inputName = normalizeTeamNameInput(req.body && req.body.name ? req.body.name : "");
    const inputIntro = normalizeTeamIntroInput(req.body && req.body.intro ? req.body.intro : "");
    const inputStatus = normalizeTeamStatusValue(
      req.body && req.body.status ? req.body.status : "",
      normalizeTeamStatusValue(teamRow.status, "pending")
    );
    const inputRejectReason = normalizeTeamRejectReasonInput(
      req.body && req.body.reject_reason ? req.body.reject_reason : ""
    );
    const inputSlugRaw = (req.body && req.body.slug ? req.body.slug : "").toString();
    const inputSlug = normalizeTeamSlugInput(inputSlugRaw || inputName);
    const communityLinks = parseAdminTeamCommunityLinks({
      facebookRaw: req.body && req.body.facebook_url ? req.body.facebook_url : "",
      discordRaw: req.body && req.body.discord_url ? req.body.discord_url : ""
    });

    if (!communityLinks.ok) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: communityLinks.error || "Link cộng đồng không hợp lệ."
      });
    }

    if (!inputName) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "missing",
        error: "Tên nhóm dịch không được để trống."
      });
    }
    if (inputName.length > TEAM_NAME_MAX_LENGTH) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: `Tên nhóm dịch tối đa ${TEAM_NAME_MAX_LENGTH} ký tự.`
      });
    }
    if (inputIntro.length > TEAM_INTRO_MAX_LENGTH) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: `Mô tả nhóm dịch tối đa ${TEAM_INTRO_MAX_LENGTH} ký tự.`
      });
    }
    if (!inputSlug) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: "Slug nhóm dịch không hợp lệ."
      });
    }
    if (inputRejectReason.length > TEAM_REJECT_REASON_MAX_LENGTH) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: `Lý do từ chối tối đa ${TEAM_REJECT_REASON_MAX_LENGTH} ký tự.`
      });
    }

    const duplicatedSlug = await dbGet(
      "SELECT id FROM translation_teams WHERE lower(slug) = lower(?) AND id <> ? LIMIT 1",
      [inputSlug, safeTeamId]
    );
    if (duplicatedSlug) {
      return sendAdminTeamsError(req, res, {
        statusCode: 409,
        status: "exists",
        error: "Slug nhóm dịch đã tồn tại."
      });
    }

    const oldName = (teamRow.name || "").toString().trim();
    const actorUserId =
      (req.session && req.session.adminUserId ? String(req.session.adminUserId) : "").trim() || null;
    const now = Date.now();

    await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
      await txGet(
        "SELECT id FROM translation_teams WHERE id = ? LIMIT 1 FOR UPDATE",
        [safeTeamId]
      );

      await txRun(
        `
          UPDATE translation_teams
          SET
            name = ?,
            slug = ?,
            intro = ?,
            facebook_url = ?,
            discord_url = ?,
            status = ?,
            approved_by_user_id = ?,
            approved_at = ?,
            reject_reason = ?,
            updated_at = ?
          WHERE id = ?
        `,
        [
          inputName,
          inputSlug,
          inputIntro,
          communityLinks.facebookUrl,
          communityLinks.discordUrl,
          inputStatus,
          inputStatus === "approved" ? actorUserId : null,
          inputStatus === "approved" ? now : null,
          inputStatus === "rejected" ? inputRejectReason : "",
          now,
          safeTeamId
        ]
      );

      await txRun(
        `
          UPDATE translation_team_members
          SET
            status = CASE WHEN role = 'leader' AND ? = 'approved' THEN 'approved' ELSE status END,
            reviewed_at = CASE WHEN role = 'leader' AND ? = 'approved' THEN ? ELSE reviewed_at END,
            reviewed_by_user_id = CASE WHEN role = 'leader' AND ? = 'approved' THEN ? ELSE reviewed_by_user_id END
          WHERE team_id = ?
        `,
        [inputStatus, inputStatus, now, inputStatus, actorUserId, safeTeamId]
      );

      if (inputStatus === "approved") {
        await ensureSingleApprovedLeaderForAdminTeam({
          teamId: safeTeamId,
          actorUserId: actorUserId || "",
          teamName: inputName,
          dbAllFn: txAll,
          dbGetFn: txGet,
          dbRunFn: txRun
        });
      }

      if (!safeCompareText(inputName, oldName) && oldName) {
        await txRun(
          `
            UPDATE manga
            SET group_name = ?
            WHERE lower(trim(COALESCE(group_name, ''))) = lower(trim(?))
          `,
          [inputName, oldName]
        );
        await txRun(
          `
            UPDATE chapters
            SET group_name = ?
            WHERE lower(trim(COALESCE(group_name, ''))) = lower(trim(?))
          `,
          [inputName, oldName]
        );
      }

      const memberRowsRaw = await txAll(
        "SELECT user_id, role, status FROM translation_team_members WHERE team_id = ?",
        [safeTeamId]
      );
      const memberRows = Array.isArray(memberRowsRaw) ? memberRowsRaw : [];

      for (const member of memberRows) {
        const memberUserId = member && member.user_id ? String(member.user_id).trim() : "";
        if (!memberUserId) continue;
        const role = (member && member.role ? String(member.role) : "member").trim().toLowerCase();
        const memberStatus = (member && member.status ? String(member.status) : "").trim().toLowerCase();
        const isApprovedMember = inputStatus === "approved" && memberStatus === "approved";

        await syncTeamBadgeForMember({
          teamId: safeTeamId,
          teamName: inputName,
          userId: memberUserId,
          role,
          isApproved: isApprovedMember,
          dbGetFn: txGet,
          dbRunFn: txRun
        });
      }
    });

    return sendAdminTeamsSuccess(
      req,
      res,
      {
        team: {
          id: safeTeamId,
          name: inputName,
          slug: inputSlug,
          intro: inputIntro,
          facebookUrl: communityLinks.facebookUrl,
          discordUrl: communityLinks.discordUrl,
          status: inputStatus,
          rejectReason: inputStatus === "rejected" ? inputRejectReason : ""
        },
        message: "Đã cập nhật nhóm dịch."
      },
      "updated"
    );
  })
);

app.post(
  "/admin/teams/:id/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const teamId = Number(req.params.id);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      return sendAdminTeamsError(req, res, {
        statusCode: 400,
        status: "invalid",
        error: "Nhóm dịch không hợp lệ."
      });
    }
    const safeTeamId = Math.floor(teamId);

    const teamRow = await dbGet(
      "SELECT id, name, avatar_url, cover_url FROM translation_teams WHERE id = ? LIMIT 1",
      [safeTeamId]
    );
    if (!teamRow) {
      return sendAdminTeamsError(req, res, {
        statusCode: 404,
        status: "notfound",
        error: "Không tìm thấy nhóm dịch."
      });
    }

    const teamName = (teamRow.name || "").toString().trim();
    const avatarFilename = extractTeamUploadFilename(teamRow.avatar_url || "", "/uploads/avatars/");
    const coverFilename = extractTeamUploadFilename(teamRow.cover_url || "", "/uploads/covers/");

    await withTransaction(async ({ dbAll: txAll, dbGet: txGet, dbRun: txRun }) => {
      if (teamName) {
        const mangaRows = await txAll(
          `
            SELECT id, group_name
            FROM manga
            WHERE ${buildTeamGroupNameMatchSql("group_name")}
          `,
          [teamName, teamName]
        );
        const safeMangaRows = Array.isArray(mangaRows) ? mangaRows : [];
        for (const row of safeMangaRows) {
          const mangaId = Number(row && row.id);
          if (!Number.isFinite(mangaId) || mangaId <= 0) continue;
          const currentGroupName = (row && row.group_name ? row.group_name : "").toString();
          const cleaned = removeTeamFromGroupName(currentGroupName, teamName);
          const nextGroupName = cleaned || TEAM_GROUP_NAME_EMPTY_LABEL;
          if (safeCompareText(currentGroupName, nextGroupName)) continue;
          await txRun("UPDATE manga SET group_name = ? WHERE id = ?", [nextGroupName, Math.floor(mangaId)]);
        }

        const chapterRows = await txAll(
          `
            SELECT id, group_name
            FROM chapters
            WHERE ${buildTeamGroupNameMatchSql("group_name")}
          `,
          [teamName, teamName]
        );
        const safeChapterRows = Array.isArray(chapterRows) ? chapterRows : [];
        for (const row of safeChapterRows) {
          const chapterId = Number(row && row.id);
          if (!Number.isFinite(chapterId) || chapterId <= 0) continue;
          const currentGroupName = (row && row.group_name ? row.group_name : "").toString();
          const cleaned = removeTeamFromGroupName(currentGroupName, teamName);
          const nextGroupName = cleaned || TEAM_GROUP_NAME_EMPTY_LABEL;
          if (safeCompareText(currentGroupName, nextGroupName)) continue;
          await txRun("UPDATE chapters SET group_name = ? WHERE id = ?", [nextGroupName, Math.floor(chapterId)]);
        }
      }

      const memberRowsRaw = await txAll(
        "SELECT user_id, role FROM translation_team_members WHERE team_id = ?",
        [safeTeamId]
      );
      const memberRows = Array.isArray(memberRowsRaw) ? memberRowsRaw : [];

      for (const member of memberRows) {
        const memberUserId = member && member.user_id ? String(member.user_id).trim() : "";
        if (!memberUserId) continue;
        const role = (member && member.role ? String(member.role) : "member").trim().toLowerCase();
        await syncTeamBadgeForMember({
          teamId: safeTeamId,
          teamName: teamRow.name || "",
          userId: memberUserId,
          role,
          isApproved: false,
          dbGetFn: txGet,
          dbRunFn: txRun
        });
      }

      const leaderCode = buildTeamBadgeCode(safeTeamId, "leader");
      const memberCode = buildTeamBadgeCode(safeTeamId, "member");
      if (leaderCode || memberCode) {
        await txRun(
          "DELETE FROM badges WHERE lower(code) = lower(?) OR lower(code) = lower(?)",
          [leaderCode || "", memberCode || ""]
        );
      }

      await txRun("DELETE FROM notifications WHERE team_id = ?", [safeTeamId]);

      await txRun("DELETE FROM translation_teams WHERE id = ?", [safeTeamId]);
    });

    if (avatarFilename && avatarsDir) {
      await deleteFileIfExists(path.join(avatarsDir, avatarFilename)).catch(() => null);
    }
    if (coverFilename && coversDir) {
      await deleteFileIfExists(path.join(coversDir, coverFilename)).catch(() => null);
    }

    return sendAdminTeamsSuccess(
      req,
      res,
      {
        deleted: true,
        teamId: safeTeamId,
        message: "Đã xóa nhóm dịch."
      },
      "deleted"
    );
  })
);
};

module.exports = registerAdminAndEngagementRoutes;
