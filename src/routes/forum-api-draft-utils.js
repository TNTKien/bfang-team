const createForumApiDraftUtils = ({
  b2DeleteAllByPrefix,
  b2DeleteFileVersions,
  crypto,
  dbAll,
  dbGet,
  dbRun,
  draftCleanupIntervalMs,
  draftTtlMs,
  expandForumImageKeyCandidates,
  getB2Config,
  toText,
}) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const imageDraftTtlMs = Math.max(1, Number(draftTtlMs) || 1);
  const draftCleanupEveryMs = Math.max(1, Number(draftCleanupIntervalMs) || 1);

  let forumDraftTableReadyPromise = null;
  let forumDraftCleanupScheduled = false;

  const ensureForumDraftTable = async () => {
    if (forumDraftTableReadyPromise) {
      return forumDraftTableReadyPromise;
    }

    forumDraftTableReadyPromise = dbRun(
      `
        CREATE TABLE IF NOT EXISTS forum_post_image_drafts (
          token VARCHAR(40) PRIMARY KEY,
          user_id TEXT NOT NULL,
          images_json TEXT NOT NULL DEFAULT '[]',
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `
    )
      .then(() => dbRun("ALTER TABLE forum_post_image_drafts DROP COLUMN IF EXISTS manga_slug"))
      .catch((err) => {
        forumDraftTableReadyPromise = null;
        throw err;
      });

    return forumDraftTableReadyPromise;
  };

  const createDraftToken = () => {
    if (crypto && typeof crypto.randomBytes === "function") {
      return crypto.randomBytes(16).toString("hex");
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  };

  const parseDraftImages = (value) => {
    const text = readText(value);
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          id: readText(item.id),
          key: readText(item.key),
          url: readText(item.url),
          legacyUrl: readText(item.legacyUrl),
        }))
        .filter((item) => item.id && item.key && item.url);
    } catch (_err) {
      return [];
    }
  };

  const isTmpForumDraftImageKey = (value) => {
    const key = readText(value);
    if (!key) return false;
    return key.includes("/tmp/forum-posts/") || key.includes("/tmp/posts/");
  };

  const escapeSqlLikePattern = (value) => String(value || "").replace(/[!%_]/g, "!$&");

  const listForumDraftImageKeys = (images, options = {}) => {
    const onlyTmp = Boolean(options && options.onlyTmp);
    return Array.from(
      new Set(
        (Array.isArray(images) ? images : [])
          .map((item) => ({
            key: readText(item && item.key),
          }))
          .filter((item) => item.key)
          .filter((item) => (onlyTmp ? isTmpForumDraftImageKey(item.key) : true))
          .map((item) => item.key)
      )
    );
  };

  const isForumImageKeyReferencedByComments = async (key) => {
    const safeKey = readText(key);
    if (!safeKey) return false;
    const escaped = escapeSqlLikePattern(safeKey);
    const row = await dbGet(
      "SELECT 1 as ok FROM comments WHERE content ILIKE ? ESCAPE '!' LIMIT 1",
      [`%${escaped}%`]
    );
    return Boolean(row && row.ok);
  };

  const deleteForumImageKeys = async (keys, options = {}) => {
    const config = typeof getB2Config === "function" ? getB2Config() : null;
    const normalizedKeys = Array.from(
      new Set(
        (Array.isArray(keys) ? keys : [])
          .flatMap((value) =>
            typeof expandForumImageKeyCandidates === "function"
              ? expandForumImageKeyCandidates(value, config)
              : [readText(value)]
          )
          .filter(Boolean)
      )
    );
    if (!normalizedKeys.length) return 0;

    const skipReferenceCheck = Boolean(options && options.skipReferenceCheck);
    const keysToDelete = [];
    for (const key of normalizedKeys) {
      if (skipReferenceCheck) {
        keysToDelete.push(key);
        continue;
      }
      const isReferenced = await isForumImageKeyReferencedByComments(key);
      if (!isReferenced) {
        keysToDelete.push(key);
      }
    }

    if (!keysToDelete.length) return 0;

    if (typeof b2DeleteFileVersions === "function") {
      return b2DeleteFileVersions(
        keysToDelete.map((key) => ({
          fileName: key,
          fileId: key,
          versionId: "",
        }))
      );
    }

    if (typeof b2DeleteAllByPrefix !== "function") {
      throw new Error("Storage delete function unavailable.");
    }

    const prefixes = Array.from(
      new Set(keysToDelete.map((key) => key.split("/").slice(0, -1).join("/")).filter(Boolean))
    );
    let deletedCount = 0;
    for (const prefix of prefixes) {
      deletedCount += Number(await b2DeleteAllByPrefix(prefix)) || 0;
    }
    return deletedCount;
  };

  const resolveDraftUpdatedAtMs = (draftRow) => {
    const value = Number(
      draftRow && draftRow.updated_at != null
        ? draftRow.updated_at
        : draftRow && draftRow.created_at != null
          ? draftRow.created_at
          : 0
    );
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  };

  const isForumDraftExpired = (draftRow, nowMs = Date.now()) => {
    const updatedAtMs = resolveDraftUpdatedAtMs(draftRow);
    if (!updatedAtMs) return false;
    return nowMs - updatedAtMs > imageDraftTtlMs;
  };

  const purgeForumDraft = async (draftRow) => {
    const token = readText(draftRow && draftRow.token).slice(0, 40);
    if (!token) return 0;

    const images = parseDraftImages(draftRow && draftRow.images_json);
    const tmpKeys = listForumDraftImageKeys(images, { onlyTmp: true });
    const persistedKeys = listForumDraftImageKeys(images).filter((key) => !isTmpForumDraftImageKey(key));

    if (tmpKeys.length > 0) {
      await deleteForumImageKeys(tmpKeys, { skipReferenceCheck: true });
    }
    if (persistedKeys.length > 0) {
      await deleteForumImageKeys(persistedKeys);
    }

    await dbRun("DELETE FROM forum_post_image_drafts WHERE token = ?", [token]);
    return images.length;
  };

  const cleanupExpiredForumDrafts = async () => {
    await ensureForumDraftTable();
    const cutoff = Date.now() - imageDraftTtlMs;
    const rows = await dbAll(
      `
        SELECT token, images_json
        FROM forum_post_image_drafts
        WHERE updated_at < ?
        ORDER BY updated_at ASC
        LIMIT 30
      `,
      [cutoff]
    );

    for (const row of rows) {
      const token = readText(row && row.token);
      if (!token) continue;
      const images = parseDraftImages(row && row.images_json);

      const keys = listForumDraftImageKeys(images);
      let hasReferencedKey = false;
      for (const key of keys) {
        if (await isForumImageKeyReferencedByComments(key)) {
          hasReferencedKey = true;
          break;
        }
      }
      if (hasReferencedKey) {
        continue;
      }

      let hasCleanupFailure = false;
      try {
        await deleteForumImageKeys(keys, { skipReferenceCheck: true });
      } catch (_err) {
        hasCleanupFailure = true;
      }

      if (hasCleanupFailure) continue;
      await dbRun("DELETE FROM forum_post_image_drafts WHERE token = ?", [token]);
    }
  };

  const scheduleForumDraftCleanup = () => {
    if (forumDraftCleanupScheduled) return;
    forumDraftCleanupScheduled = true;

    const run = async () => {
      try {
        await cleanupExpiredForumDrafts();
      } catch (err) {
        console.warn("Forum draft cleanup failed", err);
      }
    };

    run();
    const timer = setInterval(run, draftCleanupEveryMs);
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }
  };

  return {
    cleanupExpiredForumDrafts,
    createDraftToken,
    deleteForumImageKeys,
    ensureForumDraftTable,
    isForumDraftExpired,
    isTmpForumDraftImageKey,
    listForumDraftImageKeys,
    parseDraftImages,
    purgeForumDraft,
    scheduleForumDraftCleanup,
  };
};

module.exports = createForumApiDraftUtils;
