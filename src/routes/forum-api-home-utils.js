const createForumApiHomeUtils = ({ dbGet, forumRequestIdLike, toText }) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const resolveRequestedForumSection = ({ rawSection, sections }) => {
    const availableSectionSlugs = new Set(
      (Array.isArray(sections) ? sections : [])
        .map((section) => readText(section && section.slug))
        .filter(Boolean)
    );
    const safeRawSection = readText(rawSection);
    return safeRawSection && availableSectionSlugs.has(safeRawSection) ? safeRawSection : "";
  };

  const buildForumHomeWhereClause = ({ queryText, requestedSection }) => {
    const whereParts = [
      "c.status = 'visible'",
      "c.parent_id IS NULL",
      "COALESCE(c.client_request_id, '') ILIKE ?",
    ];
    const whereParams = [forumRequestIdLike];

    const safeQuery = readText(queryText);
    if (safeQuery) {
      whereParts.push("c.content ILIKE ?");
      whereParams.push(`%${safeQuery}%`);
    }

    const forumSectionFilterSql = `
      COALESCE(
        NULLIF(
          REPLACE(
            REPLACE(
              lower(COALESCE((regexp_match(c.content, 'forum-meta:section=([a-z0-9]+(-[a-z0-9]+)*)'))[1], '')),
              'goi-y',
              'gop-y'
            ),
            'tin-tuc',
            'thong-bao'
          ),
          ''
        ),
        'thao-luan-chung'
      )
    `;

    const safeSection = readText(requestedSection);
    if (safeSection) {
      whereParts.push(`(${forumSectionFilterSql}) = ?::text`);
      whereParams.push(safeSection);
    }

    return {
      whereParams,
      whereSql: whereParts.join(" AND "),
    };
  };

  const loadForumHomeCount = ({ whereParams, whereSql }) =>
    dbGet(
      `
        SELECT COUNT(*) AS count
        FROM comments c
        WHERE ${whereSql}
      `,
      whereParams
    );

  const loadForumHomeStats = () =>
    dbGet(
      `
        SELECT
          (SELECT COUNT(*) FROM users) AS member_count,
          (
            SELECT COUNT(*)
            FROM comments c
            WHERE c.status = 'visible'
              AND c.parent_id IS NULL
              AND COALESCE(c.client_request_id, '') ILIKE ?
          ) AS post_count,
          (
            SELECT COUNT(*)
            FROM comments c
            WHERE c.status = 'visible'
              AND c.parent_id IS NOT NULL
              AND COALESCE(c.client_request_id, '') ILIKE ?
          ) AS reply_count
      `,
      [forumRequestIdLike, forumRequestIdLike]
    );

  return {
    buildForumHomeWhereClause,
    loadForumHomeCount,
    loadForumHomeStats,
    resolveRequestedForumSection,
  };
};

module.exports = createForumApiHomeUtils;
