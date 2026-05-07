import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, Eye, EyeOff, Loader2, Lock, MoreHorizontal, Pin, PinOff, RefreshCw, Search, Trash2, Unlock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { RichTextEditor } from "@/components/RichTextEditor";
import { toast } from "@/hooks/use-toast";
import { measureForumTextLength } from "@/lib/forum-content";
import { FORUM_POST_MAX_LENGTH, FORUM_POST_TITLE_MAX_LENGTH } from "@/lib/forum-limits";
import {
  bulkActionForumAdminPosts,
  deleteForumAdminPost,
  finalizeForumPostLocalImages,
  fetchForumAdminPosts,
  hideForumAdminPost,
  restoreForumAdminPost,
  setForumAdminPostHomePinned,
  setForumAdminPostLocked,
  setForumAdminPostPinned,
  updateForumAdminPost,
} from "@/lib/forum-api";
import { prepareForumPostContentForSubmit } from "@/lib/forum-local-post-images";
import type { ForumAdminPostSummary, ForumAdminSectionOption } from "@/types/forum";

type ConfirmAction = "delete" | "hide" | "restore";

const PER_PAGE = 20;
const FORUM_META_COMMENT_PATTERN = /<!--\s*forum-meta:([^>]*?)\s*-->/gi;

const normalizeForumSectionSlug = (value: string): string => {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";
  const aliasMap: Record<string, string> = {
    "goi-y": "gop-y",
    "tin-tuc": "thong-bao",
  };
  return aliasMap[slug] || slug;
};

const extractForumMetaFromContent = (value: string): { sectionSlug: string; contentWithoutMeta: string } => {
  let resolvedSectionSlug = "";
  const contentWithoutMeta = String(value || "").replace(FORUM_META_COMMENT_PATTERN, (_fullMatch, payloadText) => {
    const payload = String(payloadText || "").trim();
    if (!payload) return "";

    const pairs = payload
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);

    for (const pair of pairs) {
      const equalIndex = pair.indexOf("=");
      if (equalIndex <= 0) continue;
      const key = pair.slice(0, equalIndex).trim().toLowerCase();
      const rawValue = pair.slice(equalIndex + 1).trim();
      if (!rawValue) continue;
      if (key === "section" && !resolvedSectionSlug) {
        resolvedSectionSlug = normalizeForumSectionSlug(rawValue);
      }
    }

    return "";
  });

  return {
    sectionSlug: resolvedSectionSlug,
    contentWithoutMeta: contentWithoutMeta.trim(),
  };
};

const decodeHtmlEntities = (value: string): string => {
  if (typeof window === "undefined") {
    return String(value || "");
  }
  const textarea = window.document.createElement("textarea");
  textarea.innerHTML = String(value || "");
  return textarea.value;
};

const escapeHtml = (value: string): string => {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const FORUM_MANAGED_IMAGE_HINTS = [
  "/forum/posts/",
  "/forum/tmp/posts/",
  "/chapters/forum-posts/",
  "/chapters/tmp/forum-posts/",
  "forum/posts/",
  "forum/tmp/posts/",
  "chapters/forum-posts/",
  "chapters/tmp/forum-posts/",
];

const isManagedForumImageRef = (value: string): boolean => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return false;
  return FORUM_MANAGED_IMAGE_HINTS.some((hint) => raw.includes(hint));
};

const extractForumManagedImageRefs = (html: string): string[] => {
  const refs = new Set<string>();
  const source = String(html || "");
  if (!source) return [];

  const pushRef = (rawSrc: string) => {
    const src = String(rawSrc || "").trim();
    if (!src) return;
    if (!isManagedForumImageRef(src)) return;
    refs.add(src);
  };

  if (typeof DOMParser === "function") {
    try {
      const doc = new DOMParser().parseFromString(source, "text/html");
      const nodes = Array.from(doc.querySelectorAll("img[src]"));
      nodes.forEach((node) => {
        pushRef(String(node.getAttribute("src") || ""));
      });
    } catch {
      // fallback regex below
    }
  }

  if (!refs.size) {
    source.replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, (_fullMatch, srcValue) => {
      pushRef(String(srcValue || ""));
      return "";
    });
  }

  return Array.from(refs);
};

const getRemovedForumManagedImageRefs = (beforeContent: string, nextContent: string): string[] => {
  const previousRefs = extractForumManagedImageRefs(beforeContent);
  if (!previousRefs.length) return [];

  const nextRefSet = new Set(extractForumManagedImageRefs(nextContent));
  return previousRefs.filter((src) => !nextRefSet.has(src));
};

const splitPostTitleAndBody = (rawContent: string, fallbackTitle: string) => {
  const content = String(rawContent || "").trim();
  const titleFallback = String(fallbackTitle || "").trim();

  if (!content) {
    return { title: titleFallback, body: "", sectionSlug: "" };
  }

  const titleBlockMatch = content.match(/^\s*<p>\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*<\/p>/i);
  if (!titleBlockMatch) {
    const extracted = extractForumMetaFromContent(content);
    return {
      title: titleFallback,
      body: extracted.contentWithoutMeta,
      sectionSlug: extracted.sectionSlug,
    };
  }

  const parsedTitle = decodeHtmlEntities(titleBlockMatch[1]).replace(/\s+/g, " ").trim();
  const body = content.slice(titleBlockMatch[0].length).trim();
  const extracted = extractForumMetaFromContent(body);
  return {
    title: parsedTitle || titleFallback,
    body: extracted.contentWithoutMeta,
    sectionSlug: extracted.sectionSlug,
  };
};

const AdminPosts = () => {
  const [posts, setPosts] = useState<ForumAdminPostSummary[]>([]);
  const [sections, setSections] = useState<ForumAdminSectionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);

  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    post?: ForumAdminPostSummary;
    action?: ConfirmAction;
    isBulk?: boolean;
    ids?: number[];
  }>({ open: false });

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editPostId, setEditPostId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editOriginalPostContent, setEditOriginalPostContent] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editSavePhase, setEditSavePhase] = useState<"idle" | "saving" | "uploading">("idle");
  const [editImageSyncProgress, setEditImageSyncProgress] = useState<{ uploaded: number; total: number } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [search]);

  const markPending = useCallback((postId: number, pending: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (pending) {
        next.add(postId);
      } else {
        next.delete(postId);
      }
      return next;
    });
  }, []);

  const loadPosts = useCallback(
    async (manual = false) => {
      if (manual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError("");

      try {
        const payload = await fetchForumAdminPosts({
          page,
          perPage: PER_PAGE,
          q: debouncedSearch,
          status: "all",
          section: "all",
          sort: "newest",
        });

        setPosts(Array.isArray(payload.posts) ? payload.posts : []);
        setSections(Array.isArray(payload.sections) ? payload.sections : []);
        setPageCount(Math.max(1, Number(payload.pagination?.pageCount) || 1));

        const serverPage = Number(payload.pagination?.page) || page;
        if (serverPage !== page) {
          setPage(serverPage);
        }
      } catch (err) {
        setPosts([]);
        setSections([]);
        setError(err instanceof Error ? err.message : "Không thể tải danh sách bài viết.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [debouncedSearch, page]
  );

  useEffect(() => {
    void loadPosts(false);
  }, [loadPosts]);

  useEffect(() => {
    const postIdSet = new Set(posts.map((post) => Number(post.id)).filter((id) => Number.isFinite(id) && id > 0));
    setSelectedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => postIdSet.has(id)));
      return next;
    });
  }, [posts]);

  useEffect(() => {
    if (editDialogOpen) return;
    setEditSavePhase("idle");
    setEditImageSyncProgress(null);
    setEditOriginalPostContent("");
  }, [editDialogOpen]);

  const visiblePostIds = useMemo(
    () => posts.map((post) => Number(post.id)).filter((id) => Number.isFinite(id) && id > 0),
    [posts]
  );

  const selectedVisibleCount = useMemo(
    () => visiblePostIds.filter((id) => selectedIds.has(id)).length,
    [selectedIds, visiblePostIds]
  );

  const selectAllState: boolean | "indeterminate" = useMemo(() => {
    if (!visiblePostIds.length || selectedVisibleCount <= 0) return false;
    if (selectedVisibleCount >= visiblePostIds.length) return true;
    return "indeterminate";
  }, [selectedVisibleCount, visiblePostIds.length]);

  const selectedCount = selectedIds.size;

  const handleToggleSelectAll = useCallback(
    (checked: boolean | "indeterminate") => {
      const isChecked = checked === true;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (isChecked) {
          visiblePostIds.forEach((id) => next.add(id));
        } else {
          visiblePostIds.forEach((id) => next.delete(id));
        }
        return next;
      });
    },
    [visiblePostIds]
  );

  const handleToggleSelectOne = useCallback((postId: number, checked: boolean | "indeterminate") => {
    const isChecked = checked === true;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isChecked) {
        next.add(postId);
      } else {
        next.delete(postId);
      }
      return next;
    });
  }, []);

  const handleAction = useCallback(
    async (post: ForumAdminPostSummary, action: "pin" | "home-pin" | "lock") => {
      const postId = Number(post.id);
      if (!Number.isFinite(postId) || postId <= 0) return;

      try {
        markPending(postId, true);

        if (action === "pin") {
          await setForumAdminPostPinned(postId, !post.isPinned);
          toast({
            title: post.isPinned ? "Đã bỏ ghim chuyên mục" : "Đã ghim chuyên mục",
            description: post.title,
          });
        } else if (action === "home-pin") {
          await setForumAdminPostHomePinned(postId, !post.isHomePinned);
          toast({
            title: post.isHomePinned ? "Đã bỏ ghim trang chính" : "Đã ghim trang chính",
            description: post.title,
          });
        } else {
          await setForumAdminPostLocked(postId, !post.isLocked);
          toast({
            title: post.isLocked ? "Đã mở khóa bài viết" : "Đã khóa bài viết",
            description: post.title,
          });
        }

        await loadPosts(true);
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Không thể cập nhật bài viết",
          description: err instanceof Error ? err.message : "Vui lòng thử lại.",
        });
      } finally {
        markPending(postId, false);
      }
    },
    [loadPosts, markPending]
  );

  const openConfirm = useCallback((post: ForumAdminPostSummary, action: ConfirmAction) => {
    setConfirmDialog({ open: true, post, action, isBulk: false, ids: [Number(post.id)] });
  }, []);

  const openBulkConfirm = useCallback(
    (action: "hide" | "delete") => {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;
      setConfirmDialog({
        open: true,
        action,
        isBulk: true,
        ids,
      });
    },
    [selectedIds]
  );

  const handleConfirmAction = useCallback(async () => {
    const post = confirmDialog.post;
    const action = confirmDialog.action;
    const isBulk = Boolean(confirmDialog.isBulk);
    const ids = Array.isArray(confirmDialog.ids) ? confirmDialog.ids : [];
    if (!action) return;

    if (isBulk) {
      if ((action !== "hide" && action !== "delete") || !ids.length) {
        setConfirmDialog({ open: false });
        return;
      }

      try {
        setBulkPending(true);
        await bulkActionForumAdminPosts(ids, action);
        toast({
          title: action === "hide" ? "Đã ẩn bài viết đã chọn" : "Đã xóa bài viết đã chọn",
          description: `Đã xử lý ${ids.length} bài viết.`,
        });
        setSelectedIds(new Set());
        setConfirmDialog({ open: false });
        await loadPosts(true);
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Không thể thực hiện thao tác hàng loạt",
          description: err instanceof Error ? err.message : "Vui lòng thử lại.",
        });
      } finally {
        setBulkPending(false);
      }
      return;
    }

    if (!post) return;
    const postId = Number(post.id);
    if (!Number.isFinite(postId) || postId <= 0) {
      setConfirmDialog({ open: false });
      return;
    }

    try {
      markPending(postId, true);
      if (action === "delete") {
        await deleteForumAdminPost(postId);
        toast({ title: "Đã xóa bài viết", description: post.title });
      } else if (action === "hide") {
        await hideForumAdminPost(postId);
        toast({ title: "Đã ẩn bài viết", description: post.title });
      } else {
        await restoreForumAdminPost(postId);
        toast({ title: "Đã khôi phục bài viết", description: post.title });
      }

      setConfirmDialog({ open: false });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
      await loadPosts(true);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Không thể thực hiện thao tác",
        description: err instanceof Error ? err.message : "Vui lòng thử lại.",
      });
    } finally {
      markPending(postId, false);
    }
  }, [confirmDialog.action, confirmDialog.ids, confirmDialog.isBulk, confirmDialog.post, loadPosts, markPending]);

  const availableCategories = useMemo(() => {
    const values = (Array.isArray(sections) ? sections : [])
      .map((item) => ({
        slug: normalizeForumSectionSlug(item.slug),
        label: String(item.label || "").trim(),
      }))
      .filter((item) => item.slug && item.label);
    return values;
  }, [sections]);

  const openEditDialog = useCallback(
    (post: ForumAdminPostSummary) => {
      const parsed = splitPostTitleAndBody(String(post.content || ""), String(post.title || ""));
      const fallbackCategory = availableCategories[0]?.slug || "thao-luan-chung";
      const nextCategory = normalizeForumSectionSlug(parsed.sectionSlug || post.sectionSlug || fallbackCategory) || fallbackCategory;

      setEditPostId(Number(post.id) || null);
      setEditTitle(parsed.title || String(post.title || ""));
      setEditContent(parsed.body || "");
      setEditCategory(nextCategory);
      setEditOriginalPostContent(String(post.content || ""));
      setEditSavePhase("idle");
      setEditImageSyncProgress(null);
      setEditDialogOpen(true);
    },
    [availableCategories]
  );

  const handleSaveEditDialog = useCallback(async () => {
    const postId = Number(editPostId);
    if (!Number.isFinite(postId) || postId <= 0) return;

    const normalizedTitle = String(editTitle || "").trim();
    const normalizedBody = String(editContent || "").trim();
    const normalizedCategory = normalizeForumSectionSlug(editCategory);
    const bodyLength = measureForumTextLength(normalizedBody);

    if (!normalizedCategory) {
      toast({
        variant: "destructive",
        title: "Thiếu danh mục",
        description: "Vui lòng chọn danh mục cho bài viết.",
      });
      return;
    }

    if (!normalizedTitle) {
      toast({
        variant: "destructive",
        title: "Thiếu tiêu đề",
        description: "Tiêu đề bài viết không được để trống.",
      });
      return;
    }

    if (normalizedTitle.length > FORUM_POST_TITLE_MAX_LENGTH) {
      toast({
        variant: "destructive",
        title: "Tiêu đề quá dài",
        description: `Tiêu đề tối đa ${FORUM_POST_TITLE_MAX_LENGTH} ký tự.`,
      });
      return;
    }

    if (!normalizedBody || normalizedBody === "<p></p>") {
      toast({
        variant: "destructive",
        title: "Thiếu nội dung",
        description: "Nội dung bài viết không được để trống.",
      });
      return;
    }

    if (bodyLength > FORUM_POST_MAX_LENGTH) {
      toast({
        variant: "destructive",
        title: "Nội dung quá dài",
        description: `Bài viết tối đa ${FORUM_POST_MAX_LENGTH} ký tự.`,
      });
      return;
    }

    try {
      setEditSaving(true);
      setEditSavePhase("saving");
      setEditImageSyncProgress(null);
      const prepared = prepareForumPostContentForSubmit(normalizedBody);
      const finalPostContent = `<p><strong>${escapeHtml(normalizedTitle)}</strong></p><!--forum-meta:section=${normalizedCategory}-->${
        prepared.content ? prepared.content : ""
      }`;
      const removedImageKeys = getRemovedForumManagedImageRefs(editOriginalPostContent, finalPostContent);

      if (prepared.images.length > 0) {
        let syncedContent = finalPostContent;
        setEditSavePhase("uploading");

        for (let index = 0; index < prepared.images.length; index += 1) {
          setEditImageSyncProgress({ uploaded: index + 1, total: prepared.images.length });
          const result = await finalizeForumPostLocalImages({
            postId,
            content: syncedContent,
            images: [prepared.images[index]],
            allowPartialFinalize: true,
            removedImageKeys: index === 0 ? removedImageKeys : [],
          });
          syncedContent = result.content;
        }

        setEditSavePhase("saving");
      } else {
        await updateForumAdminPost(postId, {
          title: normalizedTitle,
          content: prepared.content,
          sectionSlug: normalizedCategory,
          removedImageKeys,
        });
      }

      toast({ title: "Đã cập nhật bài viết", description: normalizedTitle });
      setEditDialogOpen(false);
      await loadPosts(true);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Không thể cập nhật bài viết",
        description: err instanceof Error ? err.message : "Vui lòng thử lại.",
      });
    } finally {
      setEditSaving(false);
      setEditSavePhase("idle");
      setEditImageSyncProgress(null);
    }
  }, [editCategory, editContent, editOriginalPostContent, editPostId, editTitle, loadPosts]);

  const confirmTitle = useMemo(() => {
    if (confirmDialog.action === "delete") return "Xóa bài viết";
    if (confirmDialog.action === "hide") return "Ẩn bài viết";
    if (confirmDialog.action === "restore") return "Khôi phục bài viết";
    return "Xác nhận";
  }, [confirmDialog.action]);

  const confirmDescription = useMemo(() => {
    if (confirmDialog.isBulk) {
      const targetCount = Array.isArray(confirmDialog.ids) ? confirmDialog.ids.length : 0;
      if (confirmDialog.action === "delete") {
        return `Bạn có chắc muốn xóa ${targetCount} bài viết đã chọn? Hành động này không thể hoàn tác.`;
      }
      if (confirmDialog.action === "hide") {
        return `Bạn có chắc muốn ẩn ${targetCount} bài viết đã chọn? Toàn bộ phản hồi liên quan cũng sẽ bị ẩn.`;
      }
      return "Bạn có chắc muốn thực hiện thao tác hàng loạt này?";
    }

    if (confirmDialog.action === "delete") {
      return "Bạn có chắc muốn xóa bài viết này? Hành động này không thể hoàn tác.";
    }
    if (confirmDialog.action === "hide") {
      return "Bài viết và toàn bộ phản hồi sẽ được chuyển sang trạng thái ẩn.";
    }
    if (confirmDialog.action === "restore") {
      return "Bài viết và toàn bộ phản hồi sẽ hiển thị lại.";
    }
    return "Bạn có chắc muốn thực hiện thao tác này?";
  }, [confirmDialog.action, confirmDialog.ids, confirmDialog.isBulk]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Quản lý bài viết</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full sm:w-auto"
          disabled={loading || refreshing || bulkPending}
          onClick={() => {
            void loadPosts(true);
          }}
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading || refreshing ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </div>

      <Card className="border-border">
        <CardHeader className="space-y-3 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Tìm bài viết..."
              className="h-9 pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full sm:w-auto"
              disabled={selectedCount <= 0 || bulkPending || loading}
              onClick={() => openBulkConfirm("hide")}
            >
              <EyeOff className="mr-2 h-3.5 w-3.5" /> Ẩn đã chọn ({selectedCount})
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-8 w-full sm:w-auto"
              disabled={selectedCount <= 0 || bulkPending || loading}
              onClick={() => openBulkConfirm("delete")}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Xóa đã chọn ({selectedCount})
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {error ? (
            <div className="p-4 text-sm text-red-400">{error}</div>
          ) : (
            <>
              <div className="space-y-3 p-3 md:hidden">
                <div className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-2 py-1.5">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      aria-label="Chọn tất cả bài viết"
                      checked={selectAllState}
                      onCheckedChange={handleToggleSelectAll}
                      disabled={!visiblePostIds.length || loading || bulkPending}
                    />
                    Chọn tất cả trong trang
                  </label>
                  <span className="text-[11px] text-muted-foreground">{`${selectedVisibleCount}/${visiblePostIds.length}`}</span>
                </div>

                {loading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <div key={`post-mobile-loading-${index}`} className="h-24 animate-pulse rounded-md bg-accent" />
                  ))
                ) : posts.length ? (
                  posts.map((post) => {
                    const postId = Number(post.id);
                    const busy = pendingIds.has(postId) || bulkPending;
                    return (
                      <div key={`post-mobile-${post.id}`} className="rounded-md border border-border p-3">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            aria-label={`Chọn bài viết #${post.id}`}
                            checked={selectedIds.has(postId)}
                            onCheckedChange={(checked) => handleToggleSelectOne(postId, checked)}
                            disabled={busy}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-medium">{post.title}</p>
                            <p className="text-[11px] text-muted-foreground">{`#${post.id} · ${post.timeAgo}`}</p>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={busy}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditDialog(post)}>
                                <Edit3 className="mr-2 h-3.5 w-3.5" /> Chỉnh sửa
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void handleAction(post, "pin")}>
                                {post.isPinned ? (
                                  <>
                                    <PinOff className="mr-2 h-3.5 w-3.5" /> Bỏ ghim chuyên mục
                                  </>
                                ) : (
                                  <>
                                    <Pin className="mr-2 h-3.5 w-3.5" /> Ghim chuyên mục
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void handleAction(post, "home-pin")}>
                                {post.isHomePinned ? (
                                  <>
                                    <PinOff className="mr-2 h-3.5 w-3.5" /> Bỏ ghim trang chính
                                  </>
                                ) : (
                                  <>
                                    <Pin className="mr-2 h-3.5 w-3.5" /> Ghim trang chính
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void handleAction(post, "lock")}>
                                {post.isLocked ? (
                                  <>
                                    <Unlock className="mr-2 h-3.5 w-3.5" /> Mở khóa
                                  </>
                                ) : (
                                  <>
                                    <Lock className="mr-2 h-3.5 w-3.5" /> Khóa
                                  </>
                                )}
                              </DropdownMenuItem>
                              {post.status === "hidden" ? (
                                <DropdownMenuItem onClick={() => openConfirm(post, "restore")}>
                                  <Eye className="mr-2 h-3.5 w-3.5" /> Khôi phục
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => openConfirm(post, "hide")}>
                                  <EyeOff className="mr-2 h-3.5 w-3.5" /> Ẩn bài viết
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem className="text-destructive" onClick={() => openConfirm(post, "delete")}>
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Xóa
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {post.status === "hidden" ? (
                            <Badge className="border-0 bg-red-500/20 text-red-300 text-xs">Đã ẩn</Badge>
                          ) : null}
                          {post.isHomePinned ? <Badge className="border-0 bg-sky-500/20 text-sky-300 text-xs">Trang chính</Badge> : null}
                          {post.isPinned ? <Badge className="border-0 bg-yellow-500/20 text-yellow-300 text-xs">Ghim chuyên mục</Badge> : null}
                          {post.isLocked ? <Badge className="border-0 bg-orange-500/20 text-orange-300 text-xs">Khóa</Badge> : null}
                          {post.status !== "hidden" && !post.isHomePinned && !post.isPinned && !post.isLocked ? (
                            <Badge className="border-0 bg-zinc-500/20 text-zinc-300 text-xs">Bình thường</Badge>
                          ) : null}
                        </div>

                        <p className="mt-1 text-[11px] text-muted-foreground">{`${post.author.name} · ${post.sectionLabel}`}</p>
                        <p className="text-[11px] text-muted-foreground">{`${post.commentCount.toLocaleString("vi-VN")} bình luận`}</p>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">Không tìm thấy bài viết nào.</div>
                )}
              </div>

              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label="Chọn tất cả bài viết"
                          checked={selectAllState}
                          onCheckedChange={handleToggleSelectAll}
                          disabled={!visiblePostIds.length || loading || bulkPending}
                        />
                      </TableHead>
                      <TableHead>Tiêu đề</TableHead>
                      <TableHead className="hidden md:table-cell">Tác giả</TableHead>
                      <TableHead className="hidden md:table-cell">Danh mục</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead className="hidden lg:table-cell">Bình luận</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {loading ? (
                      Array.from({ length: 8 }).map((_, index) => (
                        <TableRow key={`post-loading-${index}`}>
                          <TableCell colSpan={7}>
                            <div className="h-4 animate-pulse rounded bg-accent" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : posts.length ? (
                      posts.map((post) => {
                        const postId = Number(post.id);
                        const busy = pendingIds.has(postId) || bulkPending;
                        return (
                          <TableRow key={post.id}>
                            <TableCell>
                              <Checkbox
                                aria-label={`Chọn bài viết #${post.id}`}
                                checked={selectedIds.has(postId)}
                                onCheckedChange={(checked) => handleToggleSelectOne(postId, checked)}
                                disabled={busy}
                              />
                            </TableCell>

                            <TableCell className="max-w-[260px]">
                              <div className="space-y-0.5">
                                <p className="truncate text-sm font-medium">{post.title}</p>
                                <p className="text-[11px] text-muted-foreground">{`#${post.id} · ${post.timeAgo}`}</p>
                              </div>
                            </TableCell>

                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                              {post.author.name}
                            </TableCell>

                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                              {post.sectionLabel}
                            </TableCell>

                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {post.status === "hidden" ? (
                                  <Badge className="border-0 bg-red-500/20 text-red-300 text-xs">Đã ẩn</Badge>
                                ) : null}
                                {post.isPinned ? (
                                  <Badge className="border-0 bg-yellow-500/20 text-yellow-300 text-xs">Ghim chuyên mục</Badge>
                                ) : null}
                                {post.isHomePinned ? (
                                  <Badge className="border-0 bg-sky-500/20 text-sky-300 text-xs">Trang chính</Badge>
                                ) : null}
                                {post.isLocked ? (
                                  <Badge className="border-0 bg-orange-500/20 text-orange-300 text-xs">Khóa</Badge>
                                ) : null}
                                {post.status !== "hidden" && !post.isHomePinned && !post.isPinned && !post.isLocked ? (
                                  <Badge className="border-0 bg-zinc-500/20 text-zinc-300 text-xs">Bình thường</Badge>
                                ) : null}
                              </div>
                            </TableCell>

                            <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                              {post.commentCount.toLocaleString("vi-VN")}
                            </TableCell>

                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy}>
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      openEditDialog(post);
                                    }}
                                  >
                                    <Edit3 className="mr-2 h-3.5 w-3.5" /> Chỉnh sửa
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    onClick={() => {
                                      void handleAction(post, "pin");
                                    }}
                                  >
                                    {post.isPinned ? (
                                      <>
                                        <PinOff className="mr-2 h-3.5 w-3.5" /> Bỏ ghim chuyên mục
                                      </>
                                    ) : (
                                      <>
                                        <Pin className="mr-2 h-3.5 w-3.5" /> Ghim chuyên mục
                                      </>
                                    )}
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    onClick={() => {
                                      void handleAction(post, "home-pin");
                                    }}
                                  >
                                    {post.isHomePinned ? (
                                      <>
                                        <PinOff className="mr-2 h-3.5 w-3.5" /> Bỏ ghim trang chính
                                      </>
                                    ) : (
                                      <>
                                        <Pin className="mr-2 h-3.5 w-3.5" /> Ghim trang chính
                                      </>
                                    )}
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    onClick={() => {
                                      void handleAction(post, "lock");
                                    }}
                                  >
                                    {post.isLocked ? (
                                      <>
                                        <Unlock className="mr-2 h-3.5 w-3.5" /> Mở khóa
                                      </>
                                    ) : (
                                      <>
                                        <Lock className="mr-2 h-3.5 w-3.5" /> Khóa
                                      </>
                                    )}
                                  </DropdownMenuItem>

                                  {post.status === "hidden" ? (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        openConfirm(post, "restore");
                                      }}
                                    >
                                      <Eye className="mr-2 h-3.5 w-3.5" /> Khôi phục
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        openConfirm(post, "hide");
                                      }}
                                    >
                                      <EyeOff className="mr-2 h-3.5 w-3.5" /> Ẩn bài viết
                                    </DropdownMenuItem>
                                  )}

                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => {
                                      openConfirm(post, "delete");
                                    }}
                                  >
                                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Xóa
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                          Không tìm thấy bài viết nào.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">{`Trang ${page}/${Math.max(1, pageCount)}`}</p>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full sm:w-auto"
            disabled={loading || page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Trước
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full sm:w-auto"
            disabled={loading || page >= pageCount}
            onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
          >
            Sau
          </Button>
        </div>
      </div>

      <Dialog
        open={confirmDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDialog({ open: false });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription>{confirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmDialog({ open: false });
              }}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant={confirmDialog.action === "restore" ? "default" : "destructive"}
              disabled={bulkPending}
              onClick={() => {
                void handleConfirmAction();
              }}
            >
              Xác nhận
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          if (editSaving) return;
          setEditDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[calc(100vh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa bài viết</DialogTitle>
            <DialogDescription>
              Chỉnh sửa tiêu đề, danh mục và nội dung bài viết theo cùng định dạng ở trang chi tiết bài viết.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Tiêu đề</p>
              <Input
                value={editTitle}
                maxLength={FORUM_POST_TITLE_MAX_LENGTH}
                placeholder="Nhập tiêu đề bài viết..."
                onChange={(event) => setEditTitle(event.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">{`${editTitle.trim().length}/${FORUM_POST_TITLE_MAX_LENGTH}`}</p>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Danh mục</p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={editCategory}
                onChange={(event) => setEditCategory(event.target.value)}
              >
                {(availableCategories.length ? availableCategories : [{ slug: "thao-luan-chung", label: "Thảo luận chung" }]).map(
                  (category) => (
                    <option key={category.slug} value={category.slug}>
                      {category.label}
                    </option>
                  )
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Nội dung</p>
              <RichTextEditor
                content={editContent}
                onUpdate={setEditContent}
                placeholder="Viết nội dung bài viết..."
                minHeight="220px"
              />
              <p className="text-[11px] text-muted-foreground">
                {`${measureForumTextLength(String(editContent || "").trim())}/${FORUM_POST_MAX_LENGTH}`}
              </p>
              {editSaving && editSavePhase === "uploading" && editImageSyncProgress ? (
                <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {`Đang tải lên ${editImageSyncProgress.uploaded}/${editImageSyncProgress.total} ảnh`}
                </p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={editSaving} onClick={() => setEditDialogOpen(false)}>
              Hủy
            </Button>
            <Button
              type="button"
              disabled={editSaving}
              onClick={() => {
                void handleSaveEditDialog();
              }}
            >
              {editSavePhase === "uploading" && editImageSyncProgress
                ? `Đang tải lên ${editImageSyncProgress.uploaded}/${editImageSyncProgress.total} ảnh`
                : editSaving
                  ? "Đang lưu..."
                  : "Lưu thay đổi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default memo(AdminPosts);
