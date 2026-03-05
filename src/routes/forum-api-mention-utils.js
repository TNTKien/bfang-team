const createForumApiMentionUtils = ({ toText }) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const computeMentionMatch = (username, displayName, normalizedQuery) => {
    if (!normalizedQuery) {
      return { rank: 0, position: 0, distance: 0 };
    }

    const safeUsername = readText(username).toLowerCase();
    const safeDisplayName = readText(displayName).toLowerCase();

    if (safeUsername === normalizedQuery) {
      return { rank: 0, position: 0, distance: 0 };
    }
    if (safeDisplayName === normalizedQuery) {
      return { rank: 1, position: 0, distance: Math.abs(safeDisplayName.length - normalizedQuery.length) };
    }
    if (safeUsername.startsWith(normalizedQuery)) {
      return { rank: 2, position: 0, distance: safeUsername.length - normalizedQuery.length };
    }
    if (safeDisplayName.startsWith(normalizedQuery)) {
      return { rank: 3, position: 0, distance: safeDisplayName.length - normalizedQuery.length };
    }

    const usernamePosition = safeUsername.indexOf(normalizedQuery);
    if (usernamePosition >= 0) {
      return {
        rank: 4,
        position: usernamePosition,
        distance: Math.abs(safeUsername.length - normalizedQuery.length),
      };
    }

    const displayNamePosition = safeDisplayName.indexOf(normalizedQuery);
    if (displayNamePosition >= 0) {
      return {
        rank: 5,
        position: displayNamePosition,
        distance: Math.abs(safeDisplayName.length - normalizedQuery.length),
      };
    }

    return {
      rank: 6,
      position: 999,
      distance: 999,
    };
  };

  const mapMentionCandidates = ({ rows, limit, queryText }) =>
    (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const idText = readText(row && row.id);
        const username = readText(row && row.username);
        if (!idText || !username) return null;

        const displayName = readText(row && row.display_name) || username;
        const match = computeMentionMatch(username, displayName, queryText);
        return {
          id: Number(idText) || 0,
          username,
          name: displayName,
          displayName,
          avatarUrl: readText(row && row.avatar_url),
          roleLabel: readText(row && row.role_label),
          hasCommented: Boolean(row && row.has_commented),
          lastCommentedAt: readText(row && row.last_commented_at),
          isAdmin: Number(row && row.is_admin) || 0,
          isMod: Number(row && row.is_mod) || 0,
          matchRank: match.rank,
          matchPosition: match.position,
          matchDistance: match.distance,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.matchRank !== right.matchRank) return left.matchRank - right.matchRank;
        if (left.matchPosition !== right.matchPosition) return left.matchPosition - right.matchPosition;
        if (left.matchDistance !== right.matchDistance) return left.matchDistance - right.matchDistance;
        if (left.hasCommented !== right.hasCommented) return Number(right.hasCommented) - Number(left.hasCommented);
        if (left.lastCommentedAt !== right.lastCommentedAt) {
          return right.lastCommentedAt.localeCompare(left.lastCommentedAt);
        }
        if (left.isAdmin !== right.isAdmin) return right.isAdmin - left.isAdmin;
        if (left.isMod !== right.isMod) return right.isMod - left.isMod;
        return left.username.localeCompare(right.username);
      })
      .slice(0, Math.max(1, Number(limit) || 1))
      .map(
        ({
          hasCommented: _hasCommented,
          lastCommentedAt: _lastCommentedAt,
          isAdmin: _isAdmin,
          isMod: _isMod,
          matchRank: _matchRank,
          matchPosition: _matchPosition,
          matchDistance: _matchDistance,
          ...rest
        }) => rest
      );

  return {
    mapMentionCandidates,
  };
};

module.exports = createForumApiMentionUtils;
