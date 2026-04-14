const createMangaDomain = (deps) => {
  const {
    FORBIDDEN_WORD_MAX_LENGTH,
    ONESHOT_GENRE_NAME,
    buildChapterTimestampIso,
    buildMangaSlug,
    dbAll,
    dbGet,
    dbRun,
  } = deps;

const parseGenres = (value) =>
  value
    ? value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    : [];

const normalizeGenreName = (value) => {
  const collapsed = (value || "").toString().replace(/\s+/g, " ").trim();
  if (!collapsed) return "";

  return collapsed
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((segment) => {
          if (!segment) return segment;
          if (/^[A-Z0-9+]{2,}$/.test(segment)) return segment;
          const lower = segment.toLowerCase();
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join("-")
    )
    .join(" ");
};

const normalizeGenreList = (list) => {
  const seen = new Set();
  const result = [];

  (list || []).forEach((genre) => {
    const normalized = normalizeGenreName(genre);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });

  return result;
};

const normalizeGenresString = (value) =>
  normalizeGenreList(parseGenres(value)).join(", ");

const getGenreStats = async () =>
  dbAll(
    `
    SELECT
      g.id,
      g.name,
      COUNT(m.id) as count
    FROM genres g
    LEFT JOIN manga_genres mg ON mg.genre_id = g.id
    LEFT JOIN manga m ON m.id = mg.manga_id AND COALESCE(m.is_deleted, false) = false
    GROUP BY g.id
    ORDER BY lower(g.name) ASC, g.id ASC
  `
  );

const findGenreRowByNormalizedName = async (normalizedName) => {
  if (!normalizedName) return null;
  const rows = await dbAll("SELECT id, name FROM genres");
  return rows.find((row) => normalizeGenreName(row.name) === normalizedName) || null;
};

const getOrCreateGenreId = async (name) => {
  const normalized = normalizeGenreName(name);
  if (!normalized) return null;

  const direct = await dbGet("SELECT id, name FROM genres WHERE name = ?", [normalized]);
  if (direct) {
    if (direct.name !== normalized) {
      await dbRun("UPDATE genres SET name = ? WHERE id = ?", [normalized, direct.id]);
    }
    return direct.id;
  }

  const normalizedMatch = await findGenreRowByNormalizedName(normalized);
  if (normalizedMatch) {
    if (normalizedMatch.name !== normalized) {
      await dbRun("UPDATE genres SET name = ? WHERE id = ?", [normalized, normalizedMatch.id]);
    }
    return normalizedMatch.id;
  }

  const result = await dbRun("INSERT INTO genres (name) VALUES (?)", [normalized]);
  return result ? result.lastID : null;
};

const getOneshotGenreId = async () => getOrCreateGenreId(ONESHOT_GENRE_NAME);

const setMangaGenresByNames = async (mangaId, input) => {
  const list = Array.isArray(input) ? input : parseGenres(input);
  const names = normalizeGenreList(list);
  await dbRun("DELETE FROM manga_genres WHERE manga_id = ?", [mangaId]);
  for (const name of names) {
    const genreId = await getOrCreateGenreId(name);
    if (!genreId) continue;
    await dbRun("INSERT INTO manga_genres (manga_id, genre_id) VALUES (?, ?) ON CONFLICT DO NOTHING", [
      mangaId,
      genreId
    ]);
  }
};

const normalizeIdList = (input) => {
  const ids = [];
  const seen = new Set();
  const add = (value) => {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0) return;
    const normalized = Math.floor(id);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    ids.push(normalized);
  };

  if (Array.isArray(input)) {
    input.forEach(add);
    return ids;
  }
  if (input != null) {
    add(input);
  }
  return ids;
};

const escapeRegexPattern = (value) =>
  (value == null ? "" : String(value)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeForbiddenWord = (value) => {
  const compact = (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.slice(0, FORBIDDEN_WORD_MAX_LENGTH);
};

const normalizeForbiddenWordList = (value) => {
  const list = [];
  const seen = new Set();

  const append = (rawItem) => {
    const normalized = normalizeForbiddenWord(rawItem);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(normalized);
  };

  if (Array.isArray(value)) {
    value.forEach(append);
    return list;
  }

  const rawText = (value == null ? "" : String(value)).replace(/\r\n/g, "\n");
  if (!rawText.trim()) return list;

  rawText
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach(append);

  return list;
};

const forbiddenWordsCacheTtlMs = 60 * 1000;
let forbiddenWordsCache = {
  expiresAt: 0,
  rows: []
};

const invalidateForbiddenWordsCache = () => {
  forbiddenWordsCache = {
    expiresAt: 0,
    rows: []
  };
};

const getForbiddenWords = async () => {
  if (forbiddenWordsCache.expiresAt > Date.now() && Array.isArray(forbiddenWordsCache.rows)) {
    return forbiddenWordsCache.rows;
  }

  const rows = await dbAll(
    "SELECT id, word, created_at FROM forbidden_words ORDER BY lower(word) ASC, id ASC"
  );
  forbiddenWordsCache = {
    expiresAt: Date.now() + forbiddenWordsCacheTtlMs,
    rows
  };
  return rows;
};

const censorCommentContentByForbiddenWords = async (value) => {
  const raw = value == null ? "" : String(value);
  const compact = raw.trim();
  if (!compact) return "";

  const wordsRows = await getForbiddenWords();
  const words = normalizeForbiddenWordList(wordsRows.map((row) => (row && row.word ? row.word : ""))).sort(
    (left, right) => right.length - left.length
  );
  if (!words.length) return compact;

  let output = compact;
  words.forEach((word) => {
    const pattern = escapeRegexPattern(word);
    if (!pattern) return;
    output = output.replace(new RegExp(pattern, "gi"), "***");
  });

  return output;
};

const setMangaGenresByIds = async (mangaId, ids) => {
  const genreIds = normalizeIdList(ids);
  await dbRun("DELETE FROM manga_genres WHERE manga_id = ?", [mangaId]);
  for (const genreId of genreIds) {
    await dbRun("INSERT INTO manga_genres (manga_id, genre_id) VALUES (?, ?) ON CONFLICT DO NOTHING", [
      mangaId,
      genreId
    ]);
  }
  return genreIds;
};

const getGenresStringByIds = async (ids) => {
  const genreIds = normalizeIdList(ids);
  if (!genreIds.length) return "";
  const placeholders = genreIds.map(() => "?").join(",");
  const rows = await dbAll(
    `
      SELECT id, name
      FROM genres
      WHERE id IN (${placeholders})
      ORDER BY lower(name) ASC, id ASC
    `,
    genreIds
  );
  const nameById = new Map(rows.map((row) => [row.id, row.name]));
  const names = genreIds.map((id) => nameById.get(id)).filter(Boolean);
  return names.join(", ");
};

const migrateLegacyGenres = async () => {
  const joinCountRow = await dbGet("SELECT COUNT(*) as count FROM manga_genres");
  if (joinCountRow && joinCountRow.count > 0) return;

  const legacyRows = await dbAll(
    "SELECT id, genres FROM manga WHERE genres IS NOT NULL AND TRIM(genres) <> ''"
  );
  if (!legacyRows.length) return;

  for (const row of legacyRows) {
    const names = normalizeGenreList(parseGenres(row.genres));
    if (!names.length) continue;
    for (const name of names) {
      const genreId = await getOrCreateGenreId(name);
      if (!genreId) continue;
      await dbRun(
        "INSERT INTO manga_genres (manga_id, genre_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
        [row.id, genreId]
      );
    }
  }
};

const migrateMangaSlugs = async () => {
  const rows = await dbAll("SELECT id, title, slug FROM manga");
  for (const row of rows) {
    const desired = buildMangaSlug(row.id, row.title);
    if (desired && row.slug !== desired) {
      await dbRun("UPDATE manga SET slug = ? WHERE id = ?", [desired, row.id]);
    }
  }
};

const migrateMangaStatuses = async () => {
  await dbRun(
    `
      UPDATE manga
      SET status = ?
      WHERE status IS NOT NULL AND TRIM(status) = ?
    `,
    ["Còn tiếp", "Đang ra"]
  );
};

const markMangaUpdatedAtForNewChapter = async (mangaId, chapterDate) => {
  const id = Number(mangaId);
  if (!Number.isFinite(id) || id <= 0) return;
  const updatedAt = buildChapterTimestampIso(chapterDate);
  await dbRun("UPDATE manga SET updated_at = ? WHERE id = ? AND COALESCE(is_deleted, false) = false", [updatedAt, Math.floor(id)]);
};

  return {
    censorCommentContentByForbiddenWords,
    escapeRegexPattern,
    findGenreRowByNormalizedName,
    forbiddenWordsCache,
    forbiddenWordsCacheTtlMs,
    getForbiddenWords,
    getGenreStats,
    getGenresStringByIds,
    getOneshotGenreId,
    getOrCreateGenreId,
    invalidateForbiddenWordsCache,
    markMangaUpdatedAtForNewChapter,
    migrateLegacyGenres,
    migrateMangaSlugs,
    migrateMangaStatuses,
    normalizeForbiddenWord,
    normalizeForbiddenWordList,
    normalizeGenreList,
    normalizeGenreName,
    normalizeGenresString,
    normalizeIdList,
    parseGenres,
    setMangaGenresByIds,
    setMangaGenresByNames,
  };
};

module.exports = createMangaDomain;
