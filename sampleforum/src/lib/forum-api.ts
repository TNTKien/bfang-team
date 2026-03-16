import type {
  AuthSessionResponse,
  CommentDeleteResponse,
  CommentEditResponse,
  CommentLikeResponse,
  CommentReactionStateResponse,
  CommentReportResponse,
  ForumHomeResponse,
  ForumPostDetailResponse,
  ForumSavedPostsResponse,
  ForumAdminOverviewResponse,
  ForumAdminPostsResponse,
  ForumAdminCategoriesResponse,
  ForumAdminCommentsResponse,
  MentionCandidateResponse,
  PostBookmarkResponse,
} from "@/types/forum";
import { measureForumTextLength } from "@/lib/forum-content";
import { FORUM_COMMENT_MAX_LENGTH, FORUM_POST_MAX_LENGTH } from "@/lib/forum-limits";
import type { ForumLocalPostImage } from "@/lib/forum-local-post-images";

const readJson = async <T>(response: Response): Promise<T> => {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const payloadObject = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const message =
      payloadObject &&
      typeof payloadObject.error === "string"
        ? payloadObject.error
        : `Yêu cầu thất bại (${response.status}).`;

    const retryAfterRaw =
      (payloadObject && Number(payloadObject.retryAfter)) ||
      Number(response.headers.get("Retry-After") || 0);
    const retryAfter = Number.isFinite(retryAfterRaw) && retryAfterRaw > 0 ? Math.floor(retryAfterRaw) : undefined;

    const error = new Error(message) as Error & {
      code?: string;
      retryAfter?: number;
      status?: number;
    };

    if (payloadObject && typeof payloadObject.code === "string" && payloadObject.code.trim()) {
      error.code = payloadObject.code.trim();
    }
    if (typeof retryAfter === "number") {
      error.retryAfter = retryAfter;
    }
    error.status = response.status;

    throw error;
  }

  return payload as T;
};

const forumLinkLabelCache = new Map<string, string>();

const toTrimmedString = (value: unknown): string => String(value == null ? "" : value).trim();

const normalizeForumSectionSlug = (value: string): string => {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";

  const aliases: Record<string, string> = {
    "goi-y": "gop-y",
    "tin-tuc": "thong-bao",
  };

  return aliases[slug] || slug;
};

const buildForumMetaMarker = (sectionSlug: string): string => {
  const safeSection = normalizeForumSectionSlug(sectionSlug);
  if (!safeSection) return "";
  return `<!--forum-meta:section=${safeSection}-->`;
};

export const fetchForumHome = async (params: {
  page?: number;
  perPage?: number;
  q?: string;
  sort?: "hot" | "new" | "most-commented";
  section?: string;
} = {}): Promise<ForumHomeResponse> => {
  const search = new URLSearchParams();

  if (params.page && Number.isFinite(params.page) && params.page > 0) {
    search.set("page", String(Math.floor(params.page)));
  }

  if (params.perPage && Number.isFinite(params.perPage) && params.perPage > 0) {
    search.set("perPage", String(Math.floor(params.perPage)));
  }

  if (params.q && params.q.trim()) {
    search.set("q", params.q.trim());
  }

  if (params.sort && ["hot", "new", "most-commented"].includes(params.sort)) {
    search.set("sort", params.sort);
  }

  if (params.section && params.section.trim()) {
    search.set("section", params.section.trim());
  }

  const endpoint = `/forum/api/home${search.toString() ? `?${search.toString()}` : ""}`;
  const response = await fetch(endpoint, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<ForumHomeResponse>(response);
};

export const fetchForumPostDetail = async (postId: string | number): Promise<ForumPostDetailResponse> => {
  const safePostId = String(postId || "").trim();
  if (!safePostId) {
    throw new Error("Mã chủ đề không hợp lệ.");
  }

  const response = await fetch(`/forum/api/posts/${encodeURIComponent(safePostId)}`, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<ForumPostDetailResponse>(response);
};

export const fetchForumSavedPosts = async (
  paramsOrLimit: { page?: number; perPage?: number; limit?: number } | number = {}
): Promise<ForumSavedPostsResponse> => {
  const options =
    typeof paramsOrLimit === "number"
      ? { limit: paramsOrLimit }
      : paramsOrLimit && typeof paramsOrLimit === "object"
        ? paramsOrLimit
        : {};

  const safePage = Number(options.page);
  const safePerPage = Number(options.perPage);
  const safeLimit = Number(options.limit);
  const params = new URLSearchParams();
  if (Number.isFinite(safePage) && safePage > 0) {
    params.set("page", String(Math.floor(safePage)));
  }
  if (Number.isFinite(safePerPage) && safePerPage > 0) {
    params.set("perPage", String(Math.floor(safePerPage)));
  } else if (Number.isFinite(safeLimit) && safeLimit > 0) {
    params.set("limit", String(Math.floor(safeLimit)));
  }

  const endpoint = `/forum/api/saved-posts${params.toString() ? `?${params.toString()}` : ""}`;
  const response = await fetch(endpoint, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<ForumSavedPostsResponse>(response);
};

export const fetchAuthSession = async (): Promise<AuthSessionResponse> => {
  const response = await fetch("/auth/session", {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<AuthSessionResponse>(response);
};

export const submitForumPost = async (params: {
  title: string;
  content: string;
  categorySlug?: string;
}): Promise<{
  comment?: {
    id: number;
  };
  commentCount?: number;
  error?: string;
  normalizedContent: string;
}> => {
  const title = (params.title || "").toString().trim();
  const body = (params.content || "").toString().trim();
  const forumMetaMarker = buildForumMetaMarker(params.categorySlug || "");
  const normalizedContent = body ? `${forumMetaMarker}${body}` : "";
  if (!normalizedContent || normalizedContent === "<p></p>") {
    throw new Error("Nội dung bài viết không được để trống.");
  }

  if (measureForumTextLength(normalizedContent) > FORUM_POST_MAX_LENGTH) {
    throw new Error(`Bài viết tối đa ${FORUM_POST_MAX_LENGTH} ký tự.`);
  }

  const requestId = `forum-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const response = await fetch("/forum/api/posts", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-comment-request-id": requestId,
    },
    body: JSON.stringify({
      title,
      content: normalizedContent,
      categorySlug: params.categorySlug,
      requestId,
    }),
  });

  const payload = await readJson<{
    comment?: {
      id: number;
    };
    commentCount?: number;
    error?: string;
  }>(response);

  return {
    ...payload,
    normalizedContent,
  };
};

export const finalizeForumPostLocalImages = async (params: {
  postId: number;
  content: string;
  images: ForumLocalPostImage[];
  allowPartialFinalize?: boolean;
  removedImageKeys?: string[];
}): Promise<{ content: string; uploadedCount: number; removedImageCount?: number; deletedImageCount?: number }> => {
  const postIdValue = Number(params.postId);
  if (!Number.isFinite(postIdValue) || postIdValue <= 0) {
    throw new Error("Không xác định được bài viết để đồng bộ ảnh.");
  }

  const safePostId = Math.floor(postIdValue);
  const images = Array.from(
    new Set(
      (Array.isArray(params.images) ? params.images : [])
        .map((item) => ({
          id: (item && item.id ? String(item.id) : "").trim(),
          dataUrl: (item && item.dataUrl ? String(item.dataUrl) : "").trim(),
        }))
        .filter((item) => item.id && item.dataUrl)
        .map((item) => JSON.stringify(item))
    )
  ).map((item) => JSON.parse(item) as ForumLocalPostImage);

  const removedImageKeys = Array.from(
    new Set(
      (Array.isArray(params.removedImageKeys) ? params.removedImageKeys : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 200);

  if (!images.length) {
    return {
      content: (params.content || "").toString(),
      uploadedCount: 0,
    };
  }

  const response = await fetch(`/forum/api/posts/${encodeURIComponent(String(safePostId))}/images/finalize`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: params.content || "",
      images,
      allowPartialFinalize: Boolean(params.allowPartialFinalize),
      removedImageKeys,
    }),
  });

  const payload = await readJson<{ content?: string; uploadedCount?: number; removedImageCount?: number; deletedImageCount?: number }>(response);
  return {
    content: payload && typeof payload.content === "string" ? payload.content : String(params.content || ""),
    uploadedCount: Number(payload && payload.uploadedCount) || 0,
    removedImageCount: Number(payload && payload.removedImageCount) || 0,
    deletedImageCount: Number(payload && payload.deletedImageCount) || 0,
  };
};

export const createForumPostDraft = async (): Promise<{ token: string }> => {
  const response = await fetch("/forum/api/post-drafts", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  return readJson<{ ok?: boolean; token: string }>(response);
};

export const cancelForumPostDraft = async (draftToken: string): Promise<void> => {
  const token = (draftToken || "").toString().trim();
  if (!token) return;

  const response = await fetch(`/forum/api/post-drafts/${encodeURIComponent(token)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  await readJson<{ ok?: boolean }>(response);
};

export const uploadForumPostDraftImage = async (params: {
  draftToken: string;
  imageDataUrl: string;
  fileName?: string;
}): Promise<{ id: string; url: string; key: string }> => {
  const draftToken = (params.draftToken || "").toString().trim();
  if (!draftToken) {
    throw new Error("Draft tải ảnh không hợp lệ.");
  }

  const response = await fetch(`/forum/api/post-drafts/${encodeURIComponent(draftToken)}/images`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      imageDataUrl: params.imageDataUrl,
      fileName: (params.fileName || "").toString(),
    }),
  });

  const payload = await readJson<{ image?: { id: string; url: string; key: string } }>(response);
  if (!payload || !payload.image || !payload.image.url) {
    throw new Error("Không nhận được URL ảnh sau khi upload.");
  }
  return payload.image;
};

export const finalizeForumPostDraft = async (params: {
  draftToken: string;
  content: string;
}): Promise<{ content: string }> => {
  const draftToken = (params.draftToken || "").toString().trim();
  if (!draftToken) {
    return { content: params.content || "" };
  }

  const response = await fetch(`/forum/api/post-drafts/${encodeURIComponent(draftToken)}/finalize`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: params.content,
    }),
  });

  const payload = await readJson<{ content?: string }>(response);
  return { content: (payload && payload.content ? String(payload.content) : "").trim() };
};

export const commitForumPostDraft = async (draftToken: string, commentId?: number): Promise<void> => {
  const token = (draftToken || "").toString().trim();
  if (!token) return;

  const safeCommentId = Number(commentId);
  const normalizedCommentId = Number.isFinite(safeCommentId) && safeCommentId > 0 ? Math.floor(safeCommentId) : 0;

  const response = await fetch(`/forum/api/post-drafts/${encodeURIComponent(token)}/commit`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      normalizedCommentId
        ? {
            commentId: normalizedCommentId,
          }
        : {}
    ),
  });

  await readJson<{ ok?: boolean; committed?: boolean }>(response);
};

export const submitForumReply = async (params: {
  postId: number;
  content: string;
  parentId: number;
  imageUrl?: string;
}) => {
  const postId = Number(params.postId);
  if (!Number.isFinite(postId) || postId <= 0) {
    throw new Error("Không xác định được chủ đề để phản hồi.");
  }

  const content = (params.content || "").toString().trim();
  const imageUrl = (params.imageUrl || "").toString().trim();

  if (!content && !imageUrl) {
    throw new Error("Nội dung bình luận không được để trống.");
  }
  if (content && measureForumTextLength(content) > FORUM_COMMENT_MAX_LENGTH) {
    throw new Error(`Bình luận tối đa ${FORUM_COMMENT_MAX_LENGTH} ký tự.`);
  }

  const parentId = Number(params.parentId);
  if (!Number.isFinite(parentId) || parentId <= 0) {
    throw new Error("Không xác định được chủ đề để phản hồi.");
  }

  const requestId = `forum-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const response = await fetch(`/forum/api/posts/${encodeURIComponent(String(Math.floor(postId)))}/replies`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-comment-request-id": requestId,
    },
    body: JSON.stringify({
      content,
      imageUrl,
      parentId,
      requestId,
    }),
  });

  return readJson<{
    ok?: boolean;
    error?: string;
    comment?: {
      id?: number;
    };
    commentCount?: number;
  }>(response);
};

const FORUM_COMMENT_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const FORUM_COMMENT_IMAGE_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const uploadForumCommentImage = async (file: File): Promise<string> => {
  if (!(file instanceof File)) {
    throw new Error("Không tìm thấy ảnh để tải lên.");
  }

  const fileType = String(file.type || "").toLowerCase();
  if (!FORUM_COMMENT_IMAGE_ALLOWED_MIME_TYPES.has(fileType)) {
    throw new Error("Chỉ hỗ trợ ảnh JPG, PNG, GIF hoặc WebP.");
  }

  const fileSize = Number(file.size);
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > FORUM_COMMENT_IMAGE_MAX_BYTES) {
    throw new Error("Ảnh vượt quá giới hạn 3MB.");
  }

  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("/forum/api/comments/upload-image", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
    body: formData,
  });

  const payload = await readJson<{ imageUrl?: string }>(response);
  const imageUrl = payload && typeof payload.imageUrl === "string" ? payload.imageUrl.trim() : "";
  if (!imageUrl) {
    throw new Error("Không nhận được URL ảnh sau khi upload.");
  }
  return imageUrl;
};

export const fetchCommentReactions = async (ids: number[]): Promise<CommentReactionStateResponse> => {
  const safeIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value))
    )
  ).slice(0, 320);

  if (!safeIds.length) {
    return { ok: true, likedIds: [], reportedIds: [] };
  }

  const response = await fetch("/comments/reactions", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids: safeIds, forumMode: true }),
  });

  return readJson<CommentReactionStateResponse>(response);
};

export const toggleCommentLike = async (commentId: number): Promise<CommentLikeResponse> => {
  const safeId = Number(commentId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bình luận không hợp lệ.");
  }

  const response = await fetch(`/comments/${encodeURIComponent(String(Math.floor(safeId)))}/like`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ forumMode: true }),
  });

  return readJson<CommentLikeResponse>(response);
};

export const reportComment = async (commentId: number): Promise<CommentReportResponse> => {
  const safeId = Number(commentId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bình luận không hợp lệ.");
  }

  const response = await fetch(`/comments/${encodeURIComponent(String(Math.floor(safeId)))}/report`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ forumMode: true }),
  });

  return readJson<CommentReportResponse>(response);
};

export const deleteComment = async (commentId: number): Promise<CommentDeleteResponse> => {
  const safeId = Number(commentId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bình luận không hợp lệ.");
  }

  const response = await fetch(`/comments/${encodeURIComponent(String(Math.floor(safeId)))}/delete`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ forumMode: true }),
  });

  return readJson<CommentDeleteResponse>(response);
};

export const editComment = async (
  commentId: number,
  content: string,
  options?: { removedImageKeys?: string[] }
): Promise<CommentEditResponse> => {
  const safeId = Number(commentId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bình luận không hợp lệ.");
  }

  const safeContent = (content || "").toString().trim();
  const removedImageKeys = Array.from(
    new Set(
      (Array.isArray(options?.removedImageKeys) ? options.removedImageKeys : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 200);
  if (!safeContent || safeContent === "<p></p>") {
    throw new Error("Nội dung bình luận không được để trống.");
  }

  const response = await fetch(`/comments/${encodeURIComponent(String(Math.floor(safeId)))}/edit`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: safeContent,
      forumMode: true,
      removedImageKeys,
    }),
  });

  return readJson<CommentEditResponse>(response);
};

export const fetchMentionCandidates = async (params: {
  query: string;
  limit?: number;
  postId?: number;
}): Promise<MentionCandidateResponse> => {
  const queryText = (params.query || "").toString().trim();

  const search = new URLSearchParams();
  if (queryText) {
    search.set("q", queryText);
  }
  if (params.limit && Number.isFinite(params.limit) && params.limit > 0) {
    search.set("limit", String(Math.floor(params.limit)));
  }
  if (params.postId && Number.isFinite(params.postId) && params.postId > 0) {
    search.set("postId", String(Math.floor(params.postId)));
  }

  const endpoint = `/forum/api/mentions${search.toString() ? `?${search.toString()}` : ""}`;
  const response = await fetch(endpoint, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<MentionCandidateResponse>(response);
};

export const fetchForumLinkLabels = async (urls: string[]): Promise<Record<string, string>> => {
  const uniqueUrls = Array.from(
    new Set(
      (Array.isArray(urls) ? urls : [])
        .map((value) => toTrimmedString(value))
        .filter(Boolean)
    )
  ).slice(0, 80);

  if (!uniqueUrls.length) {
    return {};
  }

  const missingUrls = uniqueUrls.filter((url) => !forumLinkLabelCache.has(url));

  if (missingUrls.length) {
    const response = await fetch("/forum/api/link-labels", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls: missingUrls,
      }),
    });

    const payload = await readJson<{
      ok?: boolean;
      labels?: Array<{
        url?: string;
        label?: string;
      }>;
    }>(response);

    const entries = Array.isArray(payload && payload.labels) ? payload.labels : [];
    entries.forEach((entry) => {
      const key = toTrimmedString(entry && entry.url);
      const label = toTrimmedString(entry && entry.label);
      if (!key || !label) return;
      forumLinkLabelCache.set(key, label);
    });
  }

  const result: Record<string, string> = {};
  uniqueUrls.forEach((url) => {
    const label = toTrimmedString(forumLinkLabelCache.get(url));
    if (!label) return;
    result[url] = label;
  });

  return result;
};

export const toggleForumPostBookmark = async (postId: number): Promise<PostBookmarkResponse> => {
  const safeId = Number(postId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bài viết không hợp lệ.");
  }

  const response = await fetch(`/forum/api/posts/${encodeURIComponent(String(Math.floor(safeId)))}/bookmark`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  return readJson<PostBookmarkResponse>(response);
};

export const setForumPostLocked = async (postId: number, locked?: boolean): Promise<{ ok: boolean; locked?: boolean }> => {
  const safeId = Number(postId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bài viết không hợp lệ.");
  }

  const body: { locked?: boolean } = {};
  if (typeof locked === "boolean") {
    body.locked = locked;
  }

  const response = await fetch(`/forum/api/posts/${encodeURIComponent(String(Math.floor(safeId)))}/lock`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return readJson<{ ok: boolean; locked?: boolean }>(response);
};

export const setForumPostPinned = async (postId: number, pinned?: boolean): Promise<{ ok: boolean; pinned?: boolean }> => {
  const safeId = Number(postId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bài viết không hợp lệ.");
  }

  const body: { pinned?: boolean } = {};
  if (typeof pinned === "boolean") {
    body.pinned = pinned;
  }

  const response = await fetch(`/forum/api/posts/${encodeURIComponent(String(Math.floor(safeId)))}/pin`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return readJson<{ ok: boolean; pinned?: boolean }>(response);
};

export const fetchForumAdminOverview = async (): Promise<ForumAdminOverviewResponse> => {
  const response = await fetch("/forum/api/admin/overview", {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<ForumAdminOverviewResponse>(response);
};

export const fetchForumAdminPosts = async (params: {
  page?: number;
  perPage?: number;
  q?: string;
  status?: "all" | "visible" | "hidden" | "reported";
  section?: string;
  sort?: "newest" | "oldest" | "likes" | "reports" | "comments";
} = {}): Promise<ForumAdminPostsResponse> => {
  const search = new URLSearchParams();

  if (params.page && Number.isFinite(params.page) && params.page > 0) {
    search.set("page", String(Math.floor(params.page)));
  }

  if (params.perPage && Number.isFinite(params.perPage) && params.perPage > 0) {
    search.set("perPage", String(Math.floor(params.perPage)));
  }

  if (params.q && params.q.trim()) {
    search.set("q", params.q.trim());
  }

  if (params.status && ["all", "visible", "hidden", "reported"].includes(params.status)) {
    search.set("status", params.status);
  }

  if (params.section && params.section.trim()) {
    search.set("section", params.section.trim());
  }

  if (params.sort && ["newest", "oldest", "likes", "reports", "comments"].includes(params.sort)) {
    search.set("sort", params.sort);
  }

  const endpoint = `/forum/api/admin/posts${search.toString() ? `?${search.toString()}` : ""}`;
  const response = await fetch(endpoint, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<ForumAdminPostsResponse>(response);
};

export const fetchForumAdminCategories = async (): Promise<ForumAdminCategoriesResponse> => {
  const response = await fetch("/forum/api/admin/categories", {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<ForumAdminCategoriesResponse>(response);
};

export const fetchForumAdminComments = async (params: {
  page?: number;
  perPage?: number;
  q?: string;
  status?: "all" | "visible" | "hidden" | "reported";
} = {}): Promise<ForumAdminCommentsResponse> => {
  const search = new URLSearchParams();

  if (params.page && Number.isFinite(params.page) && params.page > 0) {
    search.set("page", String(Math.floor(params.page)));
  }

  if (params.perPage && Number.isFinite(params.perPage) && params.perPage > 0) {
    search.set("perPage", String(Math.floor(params.perPage)));
  }

  if (params.q && params.q.trim()) {
    search.set("q", params.q.trim());
  }

  if (params.status && ["all", "visible", "hidden", "reported"].includes(params.status)) {
    search.set("status", params.status);
  }

  const endpoint = `/forum/api/admin/comments${search.toString() ? `?${search.toString()}` : ""}`;
  const response = await fetch(endpoint, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<ForumAdminCommentsResponse>(response);
};

export const updateForumAdminPost = async (
  postId: number,
  payload: {
    title: string;
    content: string;
    sectionSlug: string;
    removedImageKeys?: string[];
  }
): Promise<{ ok: boolean; removedImageCount?: number; deletedImageCount?: number; post?: { id: number; sectionSlug: string; content: string } }> => {
  const safeId = Number(postId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bài viết không hợp lệ.");
  }

  const title = (payload && payload.title ? payload.title : "").toString().trim();
  const content = (payload && payload.content ? payload.content : "").toString().trim();
  const sectionSlug = (payload && payload.sectionSlug ? payload.sectionSlug : "").toString().trim();
  const removedImageKeys = Array.from(
    new Set(
      (Array.isArray(payload?.removedImageKeys) ? payload.removedImageKeys : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 200);

  const response = await fetch(`/forum/api/admin/posts/${encodeURIComponent(String(Math.floor(safeId)))}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      content,
      sectionSlug,
      removedImageKeys,
    }),
  });

  return readJson<{ ok: boolean; removedImageCount?: number; deletedImageCount?: number; post?: { id: number; sectionSlug: string; content: string } }>(
    response
  );
};

export const bulkActionForumAdminPosts = async (
  ids: number[],
  action: "hide" | "delete"
): Promise<{ ok: boolean; action: "hide" | "delete"; targetCount: number; changedCount?: number; deletedCount?: number }> => {
  const safeIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value))
    )
  ).slice(0, 200);

  if (!safeIds.length) {
    throw new Error("Vui lòng chọn ít nhất một bài viết.");
  }

  const response = await fetch("/forum/api/admin/posts/bulk", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ids: safeIds,
      action,
    }),
  });

  return readJson<{
    ok: boolean;
    action: "hide" | "delete";
    targetCount: number;
    changedCount?: number;
    deletedCount?: number;
  }>(response);
};

export const bulkActionForumAdminComments = async (
  ids: number[],
  action: "hide" | "delete"
): Promise<{ ok: boolean; action: "hide" | "delete"; targetCount: number; changedCount?: number; deletedCount?: number }> => {
  const safeIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value))
    )
  ).slice(0, 200);

  if (!safeIds.length) {
    throw new Error("Vui lòng chọn ít nhất một bình luận.");
  }

  const response = await fetch("/forum/api/admin/comments/bulk", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ids: safeIds,
      action,
    }),
  });

  return readJson<{
    ok: boolean;
    action: "hide" | "delete";
    targetCount: number;
    changedCount?: number;
    deletedCount?: number;
  }>(response);
};

export const hideForumAdminComment = async (commentId: number): Promise<{ ok: boolean; changedCount?: number }> => {
  const safeId = Number(commentId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bình luận không hợp lệ.");
  }

  const response = await fetch(`/forum/api/admin/comments/${encodeURIComponent(String(Math.floor(safeId)))}/hide`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  return readJson<{ ok: boolean; changedCount?: number }>(response);
};

export const restoreForumAdminComment = async (commentId: number): Promise<{ ok: boolean; changedCount?: number }> => {
  const safeId = Number(commentId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bình luận không hợp lệ.");
  }

  const response = await fetch(`/forum/api/admin/comments/${encodeURIComponent(String(Math.floor(safeId)))}/restore`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  return readJson<{ ok: boolean; changedCount?: number }>(response);
};

export const deleteForumAdminComment = async (commentId: number): Promise<{ ok: boolean; deletedCount?: number }> => {
  const safeId = Number(commentId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bình luận không hợp lệ.");
  }

  const response = await fetch(`/forum/api/admin/comments/${encodeURIComponent(String(Math.floor(safeId)))}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<{ ok: boolean; deletedCount?: number }>(response);
};

export const updateForumAdminCategory = async (
  slug: string,
  payload: {
    label?: string;
    icon?: string;
    visible?: boolean;
    sortOrder?: number;
  }
): Promise<{
  ok: boolean;
  category?: {
    slug: string;
    label: string;
    icon: string;
    visible: boolean;
    isSystem: boolean;
    sortOrder: number;
  } | null;
}> => {
  const safeSlug = (slug || "").toString().trim();
  if (!safeSlug) {
    throw new Error("Danh mục không hợp lệ.");
  }

  const body: Record<string, unknown> = {};
  if (typeof payload.label === "string") {
    body.label = payload.label;
  }
  if (typeof payload.icon === "string") {
    body.icon = payload.icon;
  }
  if (typeof payload.visible === "boolean") {
    body.visible = payload.visible;
  }
  if (typeof payload.sortOrder === "number" && Number.isFinite(payload.sortOrder) && payload.sortOrder > 0) {
    body.sortOrder = Math.floor(payload.sortOrder);
  }

  const response = await fetch(`/forum/api/admin/categories/${encodeURIComponent(safeSlug)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return readJson<{
    ok: boolean;
    category?: {
      slug: string;
      label: string;
      icon: string;
      visible: boolean;
      isSystem: boolean;
      sortOrder: number;
    } | null;
  }>(response);
};

export const createForumAdminCategory = async (payload: {
  label: string;
  icon?: string;
  slug?: string;
}): Promise<{
  ok: boolean;
  category?: {
    slug: string;
    label: string;
    icon: string;
    visible: boolean;
    isSystem: boolean;
    sortOrder: number;
  } | null;
}> => {
  const label = (payload.label || "").toString().trim();
  if (!label) {
    throw new Error("Tên danh mục không hợp lệ.");
  }

  const body: Record<string, unknown> = {
    label,
  };
  if (typeof payload.icon === "string") {
    body.icon = payload.icon;
  }
  if (typeof payload.slug === "string") {
    body.slug = payload.slug;
  }

  const response = await fetch("/forum/api/admin/categories", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return readJson<{
    ok: boolean;
    category?: {
      slug: string;
      label: string;
      icon: string;
      visible: boolean;
      isSystem: boolean;
      sortOrder: number;
    } | null;
  }>(response);
};

export const deleteForumAdminCategory = async (slug: string): Promise<{ ok: boolean; deleted?: boolean; slug?: string }> => {
  const safeSlug = (slug || "").toString().trim();
  if (!safeSlug) {
    throw new Error("Danh mục không hợp lệ.");
  }

  const response = await fetch(`/forum/api/admin/categories/${encodeURIComponent(safeSlug)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<{ ok: boolean; deleted?: boolean; slug?: string }>(response);
};

export const setForumAdminPostPinned = async (postId: number, pinned?: boolean): Promise<{ ok: boolean; pinned?: boolean }> => {
  const safeId = Number(postId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bài viết không hợp lệ.");
  }

  const body: { pinned?: boolean } = {};
  if (typeof pinned === "boolean") {
    body.pinned = pinned;
  }

  const response = await fetch(`/forum/api/admin/posts/${encodeURIComponent(String(Math.floor(safeId)))}/pin`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return readJson<{ ok: boolean; pinned?: boolean }>(response);
};

export const setForumAdminPostLocked = async (postId: number, locked?: boolean): Promise<{ ok: boolean; locked?: boolean }> => {
  const safeId = Number(postId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bài viết không hợp lệ.");
  }

  const body: { locked?: boolean } = {};
  if (typeof locked === "boolean") {
    body.locked = locked;
  }

  const response = await fetch(`/forum/api/admin/posts/${encodeURIComponent(String(Math.floor(safeId)))}/lock`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return readJson<{ ok: boolean; locked?: boolean }>(response);
};

export const hideForumAdminPost = async (postId: number): Promise<{ ok: boolean; changedCount?: number }> => {
  const safeId = Number(postId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bài viết không hợp lệ.");
  }

  const response = await fetch(`/forum/api/admin/posts/${encodeURIComponent(String(Math.floor(safeId)))}/hide`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  return readJson<{ ok: boolean; changedCount?: number }>(response);
};

export const restoreForumAdminPost = async (postId: number): Promise<{ ok: boolean; changedCount?: number }> => {
  const safeId = Number(postId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bài viết không hợp lệ.");
  }

  const response = await fetch(`/forum/api/admin/posts/${encodeURIComponent(String(Math.floor(safeId)))}/restore`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  return readJson<{ ok: boolean; changedCount?: number }>(response);
};

export const deleteForumAdminPost = async (postId: number): Promise<{ ok: boolean; deletedCount?: number }> => {
  const safeId = Number(postId);
  if (!Number.isFinite(safeId) || safeId <= 0) {
    throw new Error("Mã bài viết không hợp lệ.");
  }

  const response = await fetch(`/forum/api/admin/posts/${encodeURIComponent(String(Math.floor(safeId)))}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  return readJson<{ ok: boolean; deletedCount?: number }>(response);
};

export const fetchStickerManifest = async (): Promise<Array<{ code: string; label: string; src: string }>> => {
  const response = await fetch("/stickers/manifest.json", {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  const payload = await readJson<{ stickers?: Array<{ code: string; label: string; src: string }> }>(response);
  return Array.isArray(payload && payload.stickers) ? payload.stickers : [];
};
