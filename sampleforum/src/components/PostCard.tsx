import { MessageSquare, Pin, Lock, Megaphone, Bookmark, Share2, MoreHorizontal, Edit3, Trash2 } from "lucide-react";
import { Post } from "@/types/forum";
import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ReactionBar, ReactionType, getDefaultReactionCounts } from "@/components/ReactionBar";
import { UserInfo } from "@/components/UserInfo";
import { ForumRichContent } from "@/components/ForumRichContent";
import { deleteComment, setForumPostLocked, setForumPostPinned, toggleCommentLike, toggleForumPostBookmark } from "@/lib/forum-api";
import { openAuthProviderDialog } from "@/lib/auth-login";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { getSiteBranding } from "@/lib/site-branding";

interface PostCardProps {
  post: Post;
  onPostDeleted?: (postId: string) => void | Promise<void>;
  isAuthenticated?: boolean;
  canModerateForum?: boolean;
  onRequireLogin?: () => void;
}

export const PostCard = memo(function PostCard({
  post,
  onPostDeleted,
  isAuthenticated,
  canModerateForum = false,
  onRequireLogin,
}: PostCardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [bookmarked, setBookmarked] = useState(false);
  const [postActionBusy, setPostActionBusy] = useState(false);
  const [postLocked, setPostLocked] = useState(Boolean(post.isLocked));
  const [postPinned, setPostPinned] = useState(Boolean(post.isSticky));
  const [isDeleted, setIsDeleted] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");
  const [reactions, setReactions] = useState<Record<ReactionType, number>>({ ...getDefaultReactionCounts() });
  const [userReaction, setUserReaction] = useState<ReactionType | null>(post.userVote === "up" ? "like" : null);
  const [hasPreviewOverflow, setHasPreviewOverflow] = useState(false);
  const suppressCardNavigationUntilRef = useRef(0);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const shareOrigin = useMemo(() => {
    const origin = (getSiteBranding().shareOrigin || "").toString().trim();
    if (origin) return origin;
    if (typeof window !== "undefined") {
      return window.location.origin || "";
    }
    return "";
  }, []);

  const suppressCardNavigation = useCallback((durationMs = 800) => {
    suppressCardNavigationUntilRef.current = Date.now() + Math.max(0, Number(durationMs) || 0);
  }, []);

  useEffect(() => {
    setReactions((prev) => ({ ...prev, like: post.upvotes || 0 }));
  }, [post.upvotes]);

  useEffect(() => {
    setUserReaction(post.userVote === "up" ? "like" : null);
  }, [post.userVote]);

  useEffect(() => {
    setBookmarked(Boolean(post.saved));
  }, [post.saved]);

  useEffect(() => {
    setPostLocked(Boolean(post.isLocked));
  }, [post.isLocked]);

  useEffect(() => {
    setPostPinned(Boolean(post.isSticky));
  }, [post.isSticky]);

  const handleReact = async (type: ReactionType | null) => {
    const postId = Number(post.id);
    if (!Number.isFinite(postId) || postId <= 0) return;
    try {
      const response = await toggleCommentLike(Math.floor(postId));
      const liked = Boolean(response && response.liked);
      const likeCount = Number(response && response.likeCount);
      setUserReaction(liked ? "like" : null);
      if (Number.isFinite(likeCount)) {
        setReactions((prev) => ({ ...prev, like: Math.max(0, Math.floor(likeCount)) }));
      }
    } catch (_err) {
      if (type && userReaction !== type) {
        setUserReaction(userReaction);
      }
    }
  };

  const handleBookmark = async () => {
    const requestLogin = () => {
      if (typeof onRequireLogin === "function") {
        onRequireLogin();
        return;
      }

      const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      openAuthProviderDialog(next || "/forum");
    };

    if (isAuthenticated === false) {
      requestLogin();
      return;
    }

    const postId = Number(post.id);
    if (!Number.isFinite(postId) || postId <= 0) return;
    try {
      const response = await toggleForumPostBookmark(Math.floor(postId));
      const nextSaved = Boolean(response && response.saved);
      setBookmarked(nextSaved);
      window.dispatchEvent(
        new CustomEvent("bfang:forum-bookmark-changed", {
          detail: {
            postId: String(post.id),
            saved: nextSaved,
          },
        })
      );
    } catch (err) {
      const status = Number(
        err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : 0
      );
      if (status === 401) {
        requestLogin();
      }
    }
  };

  const handleShare = async () => {
    const shareUrl = new URL(`/forum/post/${encodeURIComponent(String(post.id))}`, shareOrigin || window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({
          title: post.title,
          url: shareUrl,
        });
        return;
      }

      await navigator.clipboard.writeText(shareUrl);
      setShareState("copied");
    } catch (_err) {
      setShareState("failed");
    } finally {
      window.setTimeout(() => {
        setShareState("idle");
      }, 1800);
    }
  };

  const contentPreview = post.content;
  const displayContent = contentPreview;
  const previewTextLength = useMemo(
    () =>
      String(displayContent || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim().length,
    [displayContent]
  );
  const previewBlockCount = useMemo(
    () => (String(displayContent || "").match(/<(p|li|blockquote|pre|h[1-6])\b/gi) || []).length,
    [displayContent]
  );
  const shouldFadePreview = hasPreviewOverflow || previewTextLength > 380 || previewBlockCount > 6;
  const canLockPost = Boolean((post.permissions?.isOwner || canModerateForum) && post.id);
  const canPinPost = Boolean(canModerateForum && post.id);
  const canManagePost = Boolean(
    post.permissions && (post.permissions.canEdit || post.permissions.canDelete || canLockPost || canPinPost)
  );

  const buildForumContextQuery = () => {
    const source = new URLSearchParams(location.search || "");
    const next = new URLSearchParams();
    for (const key of ["section", "sort", "q", "page"]) {
      const value = String(source.get(key) || "").trim();
      if (value) {
        next.set(key, value);
      }
    }
    return next;
  };

  const buildPostDetailUrl = (withActionEdit = false) => {
    const params = buildForumContextQuery();
    if (withActionEdit) {
      params.set("action", "edit");
    }
    const query = params.toString();
    return `/post/${encodeURIComponent(String(post.id))}${query ? `?${query}` : ""}`;
  };

  const handleDeletePost = async () => {
    if (!post.permissions?.canDelete || postActionBusy) {
      return;
    }

    setDeleteConfirmOpen(false);

    const postId = Number(post.id);
    if (!Number.isFinite(postId) || postId <= 0) {
      toast({
        variant: "destructive",
        title: "Không thể xóa bài viết",
        description: "Mã bài viết không hợp lệ.",
      });
      return;
    }

    try {
      setPostActionBusy(true);
      await deleteComment(Math.floor(postId));
      setIsDeleted(true);
      toast({
        title: "Đã xóa bài viết",
        description: post.title,
      });
      if (typeof onPostDeleted === "function") {
        await Promise.resolve(onPostDeleted(String(post.id)));
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Không thể xóa bài viết",
        description: err instanceof Error ? err.message : "Đã xảy ra lỗi không mong muốn.",
      });
    } finally {
      setPostActionBusy(false);
    }
  };

  const openDeleteConfirmDialog = () => {
    if (!post.permissions?.canDelete || postActionBusy) return;
    setDeleteConfirmOpen(true);
  };

  const handleTogglePostLock = async () => {
    if (!canLockPost || postActionBusy) return;

    const postId = Number(post.id);
    if (!Number.isFinite(postId) || postId <= 0) return;

    try {
      setPostActionBusy(true);
      const nextLocked = !postLocked;
      const payload = await setForumPostLocked(Math.floor(postId), nextLocked);
      setPostLocked(typeof payload.locked === "boolean" ? payload.locked : nextLocked);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Không thể thay đổi trạng thái khoá bài viết.");
    } finally {
      setPostActionBusy(false);
    }
  };

  const handleTogglePostPin = async () => {
    if (!canPinPost || postActionBusy) return;

    const postId = Number(post.id);
    if (!Number.isFinite(postId) || postId <= 0) return;

    try {
      setPostActionBusy(true);
      const nextPinned = !postPinned;
      const payload = await setForumPostPinned(Math.floor(postId), nextPinned);
      setPostPinned(typeof payload.pinned === "boolean" ? payload.pinned : nextPinned);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Không thể thay đổi trạng thái ghim bài viết.");
    } finally {
      setPostActionBusy(false);
    }
  };

  useEffect(() => {
    const node = previewRef.current;
    if (!node) {
      setHasPreviewOverflow(false);
      return;
    }

    let frameId = 0;
    const timeoutIds: number[] = [];
    let cancelled = false;

    const measure = () => {
      const nextOverflow = node.scrollHeight - node.clientHeight > 2;
      setHasPreviewOverflow(nextOverflow);
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measure);
    };

    const handleDeferredMediaLoad = (event: Event) => {
      if (!(event.target instanceof HTMLElement)) return;
      const tagName = event.target.tagName;
      if (tagName === "IMG" || tagName === "VIDEO" || tagName === "IFRAME") {
        scheduleMeasure();
      }
    };

    const mutationObserver = new MutationObserver(() => {
      scheduleMeasure();
    });
    mutationObserver.observe(node, {
      childList: true,
      subtree: true,
      characterData: true
    });

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            scheduleMeasure();
          })
        : null;
    if (resizeObserver) {
      resizeObserver.observe(node);
    }

    scheduleMeasure();
    timeoutIds.push(window.setTimeout(scheduleMeasure, 0));
    timeoutIds.push(window.setTimeout(scheduleMeasure, 120));
    timeoutIds.push(window.setTimeout(scheduleMeasure, 360));

    if (typeof document !== "undefined" && document.fonts && typeof document.fonts.ready?.then === "function") {
      document.fonts.ready
        .then(() => {
          if (cancelled) return;
          scheduleMeasure();
        })
        .catch(() => null);
    }

    window.addEventListener("resize", scheduleMeasure);
    node.addEventListener("load", handleDeferredMediaLoad, true);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      timeoutIds.forEach((id) => {
        window.clearTimeout(id);
      });
      window.removeEventListener("resize", scheduleMeasure);
      node.removeEventListener("load", handleDeferredMediaLoad, true);
      mutationObserver.disconnect();
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  if (isDeleted) {
    return null;
  }

  return (
    <>
      <article
        className="rounded-lg border border-border bg-card overflow-hidden transition-colors hover:border-muted-foreground/20 animate-fade-in cursor-pointer"
        onClick={(event) => {
          if (Date.now() < suppressCardNavigationUntilRef.current) return;
          const target = event.target as HTMLElement;
          if (target.closest("button, a, input, textarea, [data-no-nav='true']")) return;
          navigate(buildPostDetailUrl());
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (Date.now() < suppressCardNavigationUntilRef.current) return;
          const target = event.target as HTMLElement;
          if (target.closest("button, a, input, textarea, [data-no-nav='true']")) return;
          navigate(buildPostDetailUrl());
        }}
      >
        <div className="p-4">
        {/* Meta badges */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
            {post.isAnnouncement && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-primary">
                <Megaphone className="h-3 w-3" /> Thông báo
              </span>
            )}
            {postPinned && !post.isAnnouncement && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-sticky">
                <Pin className="h-3 w-3" /> Ghim
              </span>
            )}
            {postLocked && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                <Lock className="h-3 w-3" /> Đã khóa
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {post.category.icon} {post.category.name}
            </span>
          </div>

          {canManagePost ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Tùy chọn bài viết"
                  data-no-nav="true"
                  disabled={postActionBusy}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    suppressCardNavigation(1200);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    suppressCardNavigation(1200);
                  }}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44" onPointerDownOutside={() => suppressCardNavigation(500)}>
                {post.permissions?.canEdit ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          suppressCardNavigation(1200);
                          navigate(buildPostDetailUrl(true), {
                            state: { openEdit: true },
                          });
                        }}
                      >
                    <Edit3 className="mr-2 h-3.5 w-3.5" /> Chỉnh sửa bài viết
                  </DropdownMenuItem>
                ) : null}
                {(post.permissions?.canEdit && (canLockPost || canPinPost || post.permissions?.canDelete)) ? <DropdownMenuSeparator /> : null}
                {canLockPost ? (
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      suppressCardNavigation(1200);
                      void handleTogglePostLock();
                    }}
                    disabled={postActionBusy}
                  >
                    <Lock className="mr-2 h-3.5 w-3.5" /> {postLocked ? "Mở khoá bài viết" : "Khoá bài viết"}
                  </DropdownMenuItem>
                ) : null}
                {canPinPost ? (
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      suppressCardNavigation(1200);
                      void handleTogglePostPin();
                    }}
                    disabled={postActionBusy}
                  >
                    <Pin className="mr-2 h-3.5 w-3.5" /> {postPinned ? "Bỏ ghim bài viết" : "Ghim bài viết"}
                  </DropdownMenuItem>
                ) : null}
                {(post.permissions?.canDelete && (post.permissions?.canEdit || canLockPost || canPinPost)) ? <DropdownMenuSeparator /> : null}
                {post.permissions?.canDelete ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      suppressCardNavigation(1200);
                      openDeleteConfirmDialog();
                    }}
                    disabled={postActionBusy}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> {postActionBusy ? "Đang xóa..." : "Xóa bài viết"}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        {/* Author info */}
        <div className="mb-2">
          <UserInfo user={post.author} size="md" timestamp={post.createdAt} showUsername />
        </div>

        {/* Title */}
          <h3
            onClick={() => navigate(buildPostDetailUrl())}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              navigate(buildPostDetailUrl());
            }}
            className="text-sm font-semibold text-foreground leading-snug mb-1.5 hover:text-primary cursor-pointer transition-colors break-words [overflow-wrap:anywhere]"
          >
            {post.title}
        </h3>

        {/* Content preview */}
        <div className="text-[13px] text-foreground/80 leading-relaxed mb-2">
          <div
            ref={previewRef}
            className={`forum-rich-content forum-card-preview-collapsed ${shouldFadePreview ? "forum-card-preview-fade" : ""}`}
          >
            <ForumRichContent html={displayContent} stripMedia />
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-1 flex-wrap border-t border-border pt-2 -mx-4 px-4">
          <ReactionBar counts={reactions} userReaction={userReaction} onReact={handleReact} />

          <button
            type="button"
            onClick={() => navigate(buildPostDetailUrl())}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-accent"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>{post.commentCount} bình luận</span>
          </button>

          <button
            onClick={handleShare}
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-accent"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {shareState === "copied" ? "Đã sao chép" : shareState === "failed" ? "Thử lại" : "Chia sẻ"}
            </span>
          </button>

          <button
            type="button"
            onClick={handleBookmark}
            className={`flex items-center gap-1.5 text-xs transition-colors px-2 py-1.5 rounded-md hover:bg-accent ${
              bookmarked ? "text-sticky" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Bookmark className={`h-3.5 w-3.5 ${bookmarked ? "fill-current" : ""}`} />
            <span className="hidden sm:inline">{bookmarked ? "Đã lưu" : "Lưu"}</span>
          </button>
        </div>
        </div>
      </article>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa bài viết?</AlertDialogTitle>
            <AlertDialogDescription>
              Bài viết và toản bộ bình luận trong đó sẽ bị xóa. Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={postActionBusy}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDeletePost();
              }}
              disabled={postActionBusy}
            >
              {postActionBusy ? "Đang xóa..." : "Xóa bài viết"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
