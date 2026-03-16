export interface Category {
  id: string | number;
  name: string;
  slug: string;
  icon: string;
  postCount: number;
}

export interface Tag {
  id: string | number;
  name: string;
  color?: string;
}

export interface User {
  id: string;
  username: string;
  displayName?: string;
  avatar: string;
  profileUrl?: string;
  badges?: Array<{ code: string; label: string; color?: string; priority?: number }>;
  userColor?: string;
  bio?: string;
  role?: 'admin' | 'moderator' | 'member';
  joinDate?: string;
  postCount?: number;
}

export interface Post {
  id: string;
  title: string;
  content: string;
  author: User;
  category: Category;
  tags: Tag[];
  upvotes: number;
  downvotes: number;
  commentCount: number;
  createdAt: string;
  isSticky?: boolean;
  isLocked?: boolean;
  isAnnouncement?: boolean;
  userVote?: 'up' | 'down' | null;
  saved?: boolean;
  permissions?: ForumItemPermissions;
}

export interface Comment {
  id: string;
  content: string;
  imageUrl?: string;
  author: User;
  upvotes: number;
  downvotes: number;
  createdAt: string;
  parentId?: string;
  replies: Comment[];
  userVote?: 'up' | 'down' | null;
  permissions?: ForumItemPermissions;
  isPending?: boolean;
  pendingText?: string;
}

export interface ForumItemPermissions {
  canEdit: boolean;
  canDelete: boolean;
  canReport: boolean;
  canReply: boolean;
  isOwner: boolean;
}

export interface ForumApiPostAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  profileUrl?: string;
  badges?: Array<{ code: string; label: string; color?: string; priority?: number }>;
  userColor?: string;
}

export interface ForumApiMention {
  userId: string;
  username: string;
  name: string;
  userColor?: string;
}

export interface ForumApiCategory {
  id: number;
  name: string;
  slug: string;
  postCount: number;
}

export interface ForumApiPostSummary {
  id: number;
  title: string;
  excerpt: string;
  content: string;
  createdAt: string;
  timeAgo: string;
  likeCount: number;
  reportCount: number;
  commentCount: number;
  author: ForumApiPostAuthor;
  category: {
    id: number;
    name: string;
    slug: string;
  };
  sectionSlug?: string;
  sectionLabel?: string;
  sectionIcon?: string;
  mentions?: ForumApiMention[];
  permissions?: ForumItemPermissions;
  liked?: boolean;
  saved?: boolean;
  isLocked?: boolean;
  isSticky?: boolean;
}

export interface ForumSectionOption {
  id: number;
  slug: string;
  label: string;
  icon: string;
  visible: boolean;
  isSystem: boolean;
  postCount?: number;
}

export interface ForumApiComment {
  id: number;
  content: string;
  imageUrl?: string;
  createdAt: string;
  timeAgo: string;
  likeCount: number;
  reportCount: number;
  parentId?: number;
  parentAuthorUserId?: string;
  author: ForumApiPostAuthor;
  mentions?: ForumApiMention[];
  permissions?: ForumItemPermissions;
  liked?: boolean;
}

export interface ForumHomeResponse {
  ok: boolean;
  filters: {
    page: number;
    perPage: number;
    q: string;
    sort?: 'hot' | 'new' | 'most-commented';
    section?: string;
  };
  pagination: {
    page: number;
    perPage: number;
    total: number;
    pageCount: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  stats: {
    memberCount: number;
    postCount: number;
    replyCount: number;
  };
  categories: ForumApiCategory[];
  sections?: ForumSectionOption[];
  posts: ForumApiPostSummary[];
  viewer?: {
    authenticated: boolean;
    userId: string;
    canComment: boolean;
    canDeleteAnyComment: boolean;
    canAccessAdmin: boolean;
    canModerateForum?: boolean;
    canCreateAnnouncement?: boolean;
    role?: "guest" | "member" | "moderator" | "admin";
  };
}

export interface ForumSavedPostsResponse {
  ok: boolean;
  filters?: {
    page: number;
    perPage: number;
  };
  pagination?: {
    page: number;
    perPage: number;
    total: number;
    pageCount: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  posts: ForumApiPostSummary[];
  viewer?: {
    authenticated: boolean;
    userId: string;
    canComment: boolean;
    canDeleteAnyComment: boolean;
    canAccessAdmin: boolean;
    canModerateForum?: boolean;
    canCreateAnnouncement?: boolean;
    role?: "guest" | "member" | "moderator" | "admin";
  };
}

export interface ForumPostDetailResponse {
  ok: boolean;
  post: ForumApiPostSummary;
  sections?: ForumSectionOption[];
  comments: ForumApiComment[];
  viewer?: {
    authenticated: boolean;
    userId: string;
    canComment: boolean;
    commentImageUploadsEnabled?: boolean;
    canDeleteAnyComment: boolean;
    canAccessAdmin: boolean;
    canModerateForum?: boolean;
    canCreateAnnouncement?: boolean;
    role?: "guest" | "member" | "moderator" | "admin";
  };
}

export interface ForumAdminOverviewResponse {
  ok: boolean;
  stats: {
    totalPosts: number;
    visiblePosts: number;
    hiddenPosts: number;
    totalReplies: number;
    totalReports: number;
    activeAuthors: number;
    newPostsToday: number;
    newRepliesToday: number;
  };
  latestPosts: Array<{
    id: number;
    title: string;
    status: "visible" | "hidden";
    sectionLabel: string;
    authorName: string;
    timeAgo: string;
    createdAt: string;
  }>;
}

export interface ForumAdminSectionOption {
  slug: string;
  label: string;
}

export interface ForumAdminPostSummary {
  id: number;
  title: string;
  content: string;
  excerpt: string;
  status: "visible" | "hidden";
  sectionSlug: string;
  sectionLabel: string;
  commentCount: number;
  reportCount: number;
  likeCount: number;
  isLocked: boolean;
  isPinned: boolean;
  author: {
    id: string;
    username: string;
    displayName: string;
    name: string;
    avatarUrl: string;
  };
  createdAt: string;
  timeAgo: string;
}

export interface ForumAdminPostsResponse {
  ok: boolean;
  filters: {
    q: string;
    status: "all" | "visible" | "hidden" | "reported";
    section: string;
    sort: "newest" | "oldest" | "likes" | "reports" | "comments";
    page: number;
    perPage: number;
  };
  pagination: {
    page: number;
    perPage: number;
    total: number;
    pageCount: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  sections: ForumAdminSectionOption[];
  posts: ForumAdminPostSummary[];
}

export interface ForumAdminCategorySummary {
  slug: string;
  label: string;
  icon: string;
  visible: boolean;
  isSystem: boolean;
  sortOrder: number;
  postCount: number;
  hiddenPostCount: number;
  reportCount: number;
  lastPostAt: string;
  lastPostTimeAgo: string;
}

export interface ForumAdminCategoriesResponse {
  ok: boolean;
  categories: ForumAdminCategorySummary[];
}

export interface ForumAdminCommentSummary {
  id: number;
  content: string;
  status: "visible" | "hidden";
  kind: "comment" | "reply";
  likeCount: number;
  reportCount: number;
  parentAuthorName: string;
  post: {
    id: number;
    title: string;
  };
  author: {
    id: string;
    username: string;
    displayName: string;
    name: string;
    avatarUrl: string;
  };
  createdAt: string;
  timeAgo: string;
}

export interface ForumAdminCommentsResponse {
  ok: boolean;
  filters: {
    q: string;
    status: "all" | "visible" | "hidden" | "reported";
    page: number;
    perPage: number;
  };
  pagination: {
    page: number;
    perPage: number;
    total: number;
    pageCount: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  comments: ForumAdminCommentSummary[];
}

export interface AuthSessionUser {
  id: string;
  email?: string;
  user_metadata?: {
    display_name?: string;
    full_name?: string;
    name?: string;
    avatar_url?: string;
    avatar_url_custom?: string;
    picture?: string;
  };
  identities?: Array<{
    provider?: string;
    provider_id?: string;
    identity_data?: {
      avatar_url?: string;
      picture?: string;
      display_name?: string;
      name?: string;
    };
  }>;
}

export interface AuthSessionResponse {
  ok: boolean;
  session: {
    user: AuthSessionUser;
    access_token?: string;
    expires_at?: number;
  } | null;
  reason?: string;
}

export interface CommentReactionStateResponse {
  ok: boolean;
  likedIds: number[];
  reportedIds: number[];
}

export interface CommentLikeResponse {
  ok: boolean;
  liked?: boolean;
  likeCount?: number;
  error?: string;
}

export interface CommentReportResponse {
  ok: boolean;
  reported?: boolean;
  reportCount?: number;
  error?: string;
}

export interface PostBookmarkResponse {
  ok: boolean;
  saved?: boolean;
  error?: string;
}

export interface CommentDeleteResponse {
  ok: boolean;
  deleted?: boolean;
  commentCount?: number;
  error?: string;
}

export interface CommentEditResponse {
  ok: boolean;
  content?: string;
  error?: string;
}

export interface MentionCandidateResponse {
  ok: boolean;
  users: Array<{
    id: number;
    username: string;
    name?: string;
    displayName?: string;
    avatarUrl?: string;
    roleLabel?: string;
  }>;
}
