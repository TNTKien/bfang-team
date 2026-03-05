const createForumApiViewerUtils = ({ getUserBadgeContext, loadSessionUserById, toText }) => {
  const readText =
    typeof toText === "function"
      ? (value) => toText(value)
      : (value) => (value == null ? "" : String(value)).trim();

  const resolveViewerRole = (badgeContext) => {
    const badges = Array.isArray(badgeContext && badgeContext.badges) ? badgeContext.badges : [];
    const codes = badges
      .map((badge) => String(badge && badge.code ? badge.code : "").trim().toLowerCase())
      .filter(Boolean);
    if (codes.includes("admin")) return "admin";
    if (codes.includes("mod") || codes.includes("moderator")) return "moderator";
    return "member";
  };

  const buildGuestViewerContext = () => ({
    authenticated: false,
    userId: "",
    canComment: false,
    canDeleteAnyComment: false,
    canAccessAdmin: false,
    canModerateForum: false,
    canCreateAnnouncement: false,
    role: "guest"
  });

  const buildViewerContext = async (req) => {
    const sessionUserId =
      req && req.session && req.session.authUserId ? String(req.session.authUserId).trim() : "";
    if (!sessionUserId) {
      return buildGuestViewerContext();
    }

    const sessionUser = typeof loadSessionUserById === "function" ? await loadSessionUserById(sessionUserId) : null;
    if (!sessionUser || !sessionUser.id) {
      return buildGuestViewerContext();
    }

    const userId = String(sessionUser.id).trim();
    if (!userId) {
      return buildGuestViewerContext();
    }

    let badgeContext = null;
    try {
      badgeContext = typeof getUserBadgeContext === "function" ? await getUserBadgeContext(userId) : null;
    } catch (_err) {
      badgeContext = null;
    }

    const permissions = badgeContext && badgeContext.permissions ? badgeContext.permissions : {};
    const canComment = permissions.canComment !== false;
    const role = resolveViewerRole(badgeContext);
    const canCreateAnnouncement = role === "admin" || role === "moderator";

    return {
      authenticated: true,
      userId,
      canComment: Boolean(canComment),
      canDeleteAnyComment: Boolean(permissions.canDeleteAnyComment),
      canAccessAdmin: Boolean(permissions.canAccessAdmin),
      canModerateForum: Boolean(permissions.canDeleteAnyComment),
      canCreateAnnouncement,
      role
    };
  };

  const buildCommentPermissions = ({ viewer, authorUserId }) => {
    const ownerId = readText(authorUserId);
    const isOwner = Boolean(viewer && viewer.authenticated && viewer.userId && ownerId && viewer.userId === ownerId);
    const canDeleteAny = Boolean(viewer && viewer.canDeleteAnyComment);
    const canComment = Boolean(viewer && viewer.canComment);

    return {
      canEdit: isOwner,
      canDelete: isOwner || canDeleteAny,
      canReport: Boolean(viewer && viewer.authenticated && canComment && !isOwner),
      canReply: canComment,
      isOwner
    };
  };

  return {
    buildCommentPermissions,
    buildViewerContext
  };
};

module.exports = createForumApiViewerUtils;
