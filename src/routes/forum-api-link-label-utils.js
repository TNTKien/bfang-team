const createForumApiLinkLabelUtils = ({
  buildPostTitle,
  buildSqlPlaceholders,
  dbAll,
  toText,
}) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const normalizeLinkLabelUrls = (rawUrls) =>
    Array.from(
      new Set(
        (Array.isArray(rawUrls) ? rawUrls : [])
          .map((value) => readText(value))
          .filter(Boolean)
      )
    ).slice(0, 80);

  const parseForumLinkCandidates = ({ decodePathSegment, parseInternalPathFromUrl, req, urls }) => {
    const safeUrls = Array.isArray(urls) ? urls : [];
    const parsedLinks = [];

    safeUrls.forEach((url) => {
      const path = parseInternalPathFromUrl(url, req);
      if (!path) return;

      let match = null;

      match = path.match(/^\/user\/([^/]+)$/i);
      if (match) {
        const username = decodePathSegment(match[1]).toLowerCase();
        if (!username) return;
        parsedLinks.push({ kind: "user", url, username });
        return;
      }

      match = path.match(/^\/comments\/users\/([^/]+)$/i);
      if (match) {
        const userId = decodePathSegment(match[1]);
        if (!userId) return;
        parsedLinks.push({ kind: "user-id", url, userId });
        return;
      }

      match = path.match(/^\/(?:forum\/)?post\/(\d+)$/i);
      if (match) {
        const postId = Number(match[1]);
        if (!Number.isFinite(postId) || postId <= 0) return;
        const safePostId = Math.floor(postId);
        parsedLinks.push({ kind: "forum-post", url, postId: safePostId });
        return;
      }

      match = path.match(/^\/team\/(\d+)\/([^/]+)$/i);
      if (match) {
        const teamId = Number(match[1]);
        const teamSlug = decodePathSegment(match[2]).toLowerCase();
        const safeTeamId = Number.isFinite(teamId) && teamId > 0 ? Math.floor(teamId) : 0;
        if (!safeTeamId && !teamSlug) return;
        parsedLinks.push({ kind: "team", url, teamId: safeTeamId, teamSlug });
      }
    });

    return parsedLinks;
  };

  const resolveParsedForumLinkLabels = async ({ parsedLinks, forumRequestIdLike }) => {
    const links = Array.isArray(parsedLinks) ? parsedLinks : [];
    if (!links.length) return [];

    const usernameSet = new Set();
    const userIdSet = new Set();
    const postIdSet = new Set();
    const teamIdSet = new Set();
    const teamSlugSet = new Set();

    links.forEach((item) => {
      if (!item || typeof item !== "object") return;
      if (item.kind === "user") {
        const username = readText(item.username).toLowerCase();
        if (username) usernameSet.add(username);
        return;
      }
      if (item.kind === "user-id") {
        const userId = readText(item.userId);
        if (userId) userIdSet.add(userId);
        return;
      }
      if (item.kind === "forum-post") {
        const postId = Number(item.postId);
        if (Number.isFinite(postId) && postId > 0) {
          postIdSet.add(Math.floor(postId));
        }
        return;
      }
      if (item.kind === "team") {
        const teamId = Number(item.teamId);
        const teamSlug = readText(item.teamSlug).toLowerCase();
        if (Number.isFinite(teamId) && teamId > 0) {
          teamIdSet.add(Math.floor(teamId));
        }
        if (teamSlug) {
          teamSlugSet.add(teamSlug);
        }
      }
    });

    const usernameLabelByUsername = new Map();
    const usernameLabelByUserId = new Map();
    const postTitleById = new Map();
    const teamNameById = new Map();
    const teamNameBySlug = new Map();

    if (usernameSet.size) {
      const usernames = Array.from(usernameSet);
      const placeholders = buildSqlPlaceholders(usernames.length);
      const rows = await dbAll(
        `
          SELECT username, display_name
          FROM users
          WHERE LOWER(username) IN (${placeholders})
        `,
        usernames
      );
      rows.forEach((row) => {
        const username = readText(row && row.username).toLowerCase();
        if (!username) return;
        const label = readText(row && row.display_name) || readText(row && row.username);
        if (!label) return;
        usernameLabelByUsername.set(username, label);
      });
    }

    if (userIdSet.size) {
      const userIds = Array.from(userIdSet);
      const placeholders = buildSqlPlaceholders(userIds.length);
      const rows = await dbAll(
        `
          SELECT id, username, display_name
          FROM users
          WHERE id IN (${placeholders})
        `,
        userIds
      );
      rows.forEach((row) => {
        const userId = readText(row && row.id);
        if (!userId) return;
        const label = readText(row && row.display_name) || readText(row && row.username);
        if (!label) return;
        usernameLabelByUserId.set(userId, label);
      });
    }

    if (postIdSet.size) {
      const ids = Array.from(postIdSet);
      const placeholders = buildSqlPlaceholders(ids.length);
      const rows = await dbAll(
        `
          SELECT
            c.id,
            c.content
          FROM comments c
          WHERE c.id IN (${placeholders})
            AND c.parent_id IS NULL
            AND c.status = 'visible'
            AND COALESCE(c.client_request_id, '') ILIKE ?
        `,
        [...ids, forumRequestIdLike]
      );
      rows.forEach((row) => {
        const id = Number(row && row.id);
        if (!Number.isFinite(id) || id <= 0) return;
        const title = buildPostTitle(row);
        if (!title) return;
        postTitleById.set(Math.floor(id), title);
      });
    }

    if (teamIdSet.size || teamSlugSet.size) {
      const teamIds = Array.from(teamIdSet);
      const teamSlugs = Array.from(teamSlugSet);
      const idPlaceholders = buildSqlPlaceholders(teamIds.length);
      const slugPlaceholders = buildSqlPlaceholders(teamSlugs.length);

      const whereParts = [];
      const whereParams = [];
      if (teamIds.length) {
        whereParts.push(`id IN (${idPlaceholders})`);
        whereParams.push(...teamIds);
      }
      if (teamSlugs.length) {
        whereParts.push(`LOWER(slug) IN (${slugPlaceholders})`);
        whereParams.push(...teamSlugs);
      }

      if (whereParts.length) {
        const rows = await dbAll(
          `
            SELECT id, slug, name
            FROM translation_teams
            WHERE ${whereParts.join(" OR ")}
          `,
          whereParams
        );
        rows.forEach((row) => {
          const id = Number(row && row.id);
          const slug = readText(row && row.slug).toLowerCase();
          const name = readText(row && row.name);
          if (!name) return;
          if (Number.isFinite(id) && id > 0) {
            teamNameById.set(Math.floor(id), name);
          }
          if (slug) {
            teamNameBySlug.set(slug, name);
          }
        });
      }
    }

    const labels = [];
    links.forEach((item) => {
      let label = "";

      if (item.kind === "user") {
        label = readText(usernameLabelByUsername.get(item.username));
      } else if (item.kind === "user-id") {
        label = readText(usernameLabelByUserId.get(item.userId));
      } else if (item.kind === "forum-post") {
        label = readText(postTitleById.get(item.postId));
      } else if (item.kind === "team") {
        label =
          readText(item.teamId ? teamNameById.get(item.teamId) : "") ||
          readText(item.teamSlug ? teamNameBySlug.get(item.teamSlug) : "");
      }

      if (!label) return;
      labels.push({
        url: item.url,
        label,
      });
    });

    return labels;
  };

  return {
    normalizeLinkLabelUrls,
    parseForumLinkCandidates,
    resolveParsedForumLinkLabels,
  };
};

module.exports = createForumApiLinkLabelUtils;
