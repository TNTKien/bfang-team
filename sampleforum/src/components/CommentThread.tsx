import { useEffect, useState, memo } from "react";
import { Comment } from "@/types/forum";
import { Flag, Trash2, Edit3, Reply, ThumbsUp } from "lucide-react";
import { CommentInput } from "@/components/CommentInput";
import { ForumRichContent } from "@/components/ForumRichContent";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Button } from "@/components/ui/button";
import { measureForumTextLength, toPlainTextForUi } from "@/lib/forum-content";
import { FORUM_COMMENT_MAX_LENGTH } from "@/lib/forum-limits";
import { RoleBadge } from "@/components/UserInfo";

const REPLY_COLLAPSED_PREVIEW_COUNT = 3;
const REPLY_EXPAND_PAGE_SIZE = 10;
const SPOILER_HTML_PATTERN =
  /<span\b[^>]*class\s*=\s*(["'])[^"']*\bspoiler\b[^"']*\1[^>]*>[\s\S]*?<\/span>/gi;
const STICKER_HTML_PATTERN = /<img\b[^>]*src\s*=\s*(["'])\/stickers\/[^"']+\1[^>]*>/gi;

const buildReplyPreviewText = (value: string): string => {
  const normalized = String(value || "")
    .replace(SPOILER_HTML_PATTERN, " [spoiler] ")
    .replace(STICKER_HTML_PATTERN, " [sticker] ");
  const text = toPlainTextForUi(normalized)
    .replace(/\s+/g, " ")
    .trim();
  return text || "(Không có nội dung)";
};

const compactForumRelativeTime = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const hourMatch = raw.match(/^(\d+)\s*giờ trước$/i);
  if (hourMatch && hourMatch[1]) {
    return `${hourMatch[1]}h`;
  }

  const minuteMatch = raw.match(/^(\d+)\s*phút trước$/i);
  if (minuteMatch && minuteMatch[1]) {
    return `${minuteMatch[1]}m`;
  }

  return raw;
};

interface CommentThreadProps {
  comment: Comment;
  depth?: number;
  canReply?: boolean;
  submitting?: boolean;
  highlightedCommentId?: string;
  forceExpandedParentIds?: Set<string>;
  forceVisibleReplyCountByParentId?: Record<string, number>;
  onReplySubmit?: (commentId: string, content: string, imageFile?: File | null) => void;
  onToggleLike?: (commentId: string) => void;
  onEditSubmit?: (commentId: string, content: string) => Promise<boolean | void> | boolean | void;
  onDelete?: (commentId: string) => void;
  onReport?: (commentId: string) => void;
  likedIds?: Set<string>;
  reportedIds?: Set<string>;
  pendingActionIds?: Set<string>;
  deletingCommentIds?: Set<string>;
  mentionRootCommentId?: number;
  imageUploadsEnabled?: boolean;
}

const SingleComment = memo(function SingleComment({
  comment,
  depth,
  onReplyToggle,
  showReply,
  canReply,
  onReplySubmit,
  onToggleLike,
  onEditSubmit,
  onDelete,
  onReport,
  likedIds,
  reportedIds,
  pendingActionIds,
  deletingCommentIds,
  mentionRootCommentId,
  imageUploadsEnabled,
  submitting,
  isTargeted,
}: {
  comment: Comment;
  depth: number;
  onReplyToggle: () => void;
  showReply: boolean;
  canReply: boolean;
  submitting?: boolean;
  onReplySubmit?: (commentId: string, content: string, imageFile?: File | null) => void;
  onToggleLike?: (commentId: string) => void;
  onEditSubmit?: (commentId: string, content: string) => Promise<boolean | void> | boolean | void;
  onDelete?: (commentId: string) => void;
  onReport?: (commentId: string) => void;
  likedIds?: Set<string>;
  reportedIds?: Set<string>;
  pendingActionIds?: Set<string>;
  deletingCommentIds?: Set<string>;
  mentionRootCommentId?: number;
  imageUploadsEnabled?: boolean;
  isTargeted?: boolean;
}) {
  const permissions = comment.permissions || {
    canEdit: false,
    canDelete: false,
    canReport: false,
    canReply: true,
    isOwner: false,
  };
  const isLiked = Boolean(likedIds && likedIds.has(comment.id));
  const isReported = Boolean(reportedIds && reportedIds.has(comment.id));
  const isBusy = Boolean(pendingActionIds && pendingActionIds.has(comment.id));
  const isDeleting = Boolean(deletingCommentIds && deletingCommentIds.has(comment.id));
  const canReplyHere = canReply && permissions.canReply !== false;
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content || "");
  const normalizedEditContent = (editContent || "").toString().trim();
  const editLength = measureForumTextLength(normalizedEditContent);
  const overEditLimit = editLength > FORUM_COMMENT_MAX_LENGTH;
  const topBadges = Array.isArray(comment.author.badges) ? comment.author.badges.slice(0, 1) : [];
  const hasAdminBadge = topBadges.some((badge) => String(badge && badge.code ? badge.code : "").trim().toLowerCase() === "admin");
  const hasModBadge = topBadges.some((badge) => {
    const code = String(badge && badge.code ? badge.code : "").trim().toLowerCase();
    return code === "mod" || code === "moderator";
  });
  const shouldShowRoleBadge =
    comment.author.role === "admin"
      ? !hasAdminBadge
      : comment.author.role === "moderator"
        ? !hasModBadge
        : false;
  const compactCreatedAt = compactForumRelativeTime(comment.createdAt);

  useEffect(() => {
    setEditContent(comment.content || "");
  }, [comment.content]);

  const handleEdit = () => {
    if (!onEditSubmit || !permissions.canEdit || isBusy) return;
    setEditContent(comment.content || "");
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!onEditSubmit || isBusy) return;
    const normalized = normalizedEditContent;
    const normalizedLength = measureForumTextLength(normalized);
    if (!normalized || normalized === "<p></p>") return;
    if (normalizedLength <= 0) return;
    if (normalizedLength > FORUM_COMMENT_MAX_LENGTH) return;

    const result = await onEditSubmit(comment.id, normalized);
    if (result !== false) {
      setIsEditing(false);
    }
  };

  const handleCancelEdit = () => {
    setEditContent(comment.content || "");
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (!onDelete || !permissions.canDelete || isBusy) return;
    onDelete(comment.id);
  };

  const handleReport = () => {
    if (!onReport || !permissions.canReport || isBusy || isReported) return;
    onReport(comment.id);
  };

  return (
    <div className={`flex items-start gap-2 py-1.5${isTargeted ? " forum-comment-targeted" : ""}`}>
      {comment.author.profileUrl ? (
        <a href={comment.author.profileUrl} className="shrink-0 mt-0.5">
          <img
            src={comment.author.avatar}
            alt={comment.author.username}
            className={`w-7 h-7 rounded-full bg-accent hover:opacity-80 transition-opacity${
              isTargeted ? " forum-comment-avatar-targeted" : ""
            }`}
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = "/logobfang.svg";
            }}
          />
        </a>
      ) : (
        <img
          src={comment.author.avatar}
          alt={comment.author.username}
          className={`w-7 h-7 rounded-full shrink-0 mt-0.5 bg-accent${
            isTargeted ? " forum-comment-avatar-targeted" : ""
          }`}
          onError={(event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = "/logobfang.svg";
          }}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className={`bg-secondary rounded-xl px-3 py-2${isTargeted ? " forum-comment-bubble-targeted" : ""}`}>
          <div className="flex items-center gap-1.5">
            {comment.author.profileUrl ? (
              <a
                href={comment.author.profileUrl}
                className="font-semibold text-xs truncate max-w-[160px] hover:underline cursor-pointer"
                style={comment.author.userColor ? { color: comment.author.userColor } : undefined}
              >
                {comment.author.displayName || comment.author.username}
              </a>
            ) : (
              <span
                className="font-semibold text-xs text-foreground truncate max-w-[160px] hover:underline cursor-pointer"
                style={comment.author.userColor ? { color: comment.author.userColor } : undefined}
              >
                {comment.author.displayName || comment.author.username}
              </span>
            )}
            {topBadges.map((badge) => (
              <span
                key={`${badge.code}-${badge.label}`}
                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  color: badge.color || '#f8f8f2',
                  backgroundColor: badge.color ? `${badge.color}22` : 'hsl(var(--secondary))'
                }}
              >
                {badge.label}
              </span>
            ))}
            {shouldShowRoleBadge ? <RoleBadge role={comment.author.role} /> : null}
          </div>

          {isEditing ? (
            <div className="mt-2 space-y-2">
              <RichTextEditor
                content={editContent}
                onUpdate={setEditContent}
                placeholder="Nhập nội dung bình luận..."
                compact
                mentionRootCommentId={mentionRootCommentId}
              />
              <div className="flex items-center justify-end gap-2">
                <span
                  className={`mr-auto text-[11px] ${
                    overEditLimit ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {editLength}/{FORUM_COMMENT_MAX_LENGTH}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCancelEdit}
                  disabled={isBusy}
                >
                  Hủy
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void handleSaveEdit();
                  }}
                  disabled={
                    isBusy ||
                    editLength <= 0 ||
                    !(editContent || "").trim() ||
                    editContent === "<p></p>" ||
                    editContent === (comment.content || "") ||
                    overEditLimit
                  }
                >
                  Lưu
                </Button>
              </div>
            </div>
          ) : (
            <ForumRichContent
              html={comment.content}
              className="forum-rich-content text-[13px] text-foreground/90 mt-0.5 leading-relaxed"
            />
          )}

          {comment.imageUrl ? (
            <div className="mt-2">
              <a href={comment.imageUrl} target="_blank" rel="noreferrer" className="inline-block max-w-[240px]">
                <img
                  src={comment.imageUrl}
                  alt="Ảnh bình luận"
                  className="h-auto w-full rounded-md border border-border/70 object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </a>
            </div>
          ) : null}
        </div>

        <div className={`flex items-center gap-2 mt-0.5 px-1${isTargeted ? " forum-comment-meta-targeted" : ""}`}>
          {comment.isPending ? (
            <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span>{comment.pendingText || "Đang gửi bình luận..."}</span>
            </div>
          ) : isDeleting ? (
            <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span>Đang xóa bình luận</span>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  if (onToggleLike && !isBusy) {
                    onToggleLike(comment.id);
                  }
                }}
                className={`inline-flex items-center gap-1 text-[11px] font-medium transition-colors ${
                  isLiked ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                disabled={isBusy}
                aria-label="Thích"
                title="Thích"
              >
                <ThumbsUp className="h-3 w-3 sm:hidden" />
                <span className="hidden sm:inline">Thích</span>
                <span className="text-muted-foreground">{comment.upvotes || 0}</span>
              </button>
              {depth === 0 && canReplyHere && (
                <button
                  onClick={onReplyToggle}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground font-medium transition-colors"
                  type="button"
                  aria-label="Trả lời"
                  title="Trả lời"
                >
                  <Reply className="h-3 w-3 sm:hidden" />
                  <span className="hidden sm:inline">Trả lời</span>
                </button>
              )}
              {permissions.canEdit && (
                <button
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground font-medium transition-colors"
                  onClick={handleEdit}
                  type="button"
                  disabled={isBusy}
                >
                  <Edit3 className="h-3 w-3" /> Sửa
                </button>
              )}
              {permissions.canDelete && (
                <button
                  className="inline-flex items-center gap-1 text-[11px] text-destructive/80 hover:text-destructive font-medium transition-colors"
                  onClick={handleDelete}
                  type="button"
                  disabled={isBusy}
                  aria-label="Xóa"
                  title="Xóa"
                >
                  <Trash2 className="h-3 w-3" />
                  <span className="hidden sm:inline">Xóa</span>
                </button>
              )}
              {permissions.canReport && (
                <button
                  className={`inline-flex items-center gap-1 text-[11px] font-medium transition-colors ${
                    isReported ? "text-muted-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={handleReport}
                  type="button"
                  disabled={isBusy || isReported}
                  aria-label={isReported ? "Đã báo cáo" : "Báo cáo"}
                  title={isReported ? "Đã báo cáo" : "Báo cáo"}
                >
                  <Flag className="h-3 w-3" />
                  <span className="hidden sm:inline">{isReported ? "Đã báo cáo" : "Báo cáo"}</span>
                </button>
              )}
              <span className="text-[11px] text-muted-foreground">{compactCreatedAt}</span>
            </>
          )}
        </div>

        {showReply && depth === 0 && canReplyHere && (
          <div className="mt-1.5">
            <CommentInput
              placeholder={`Trả lời ${comment.author.displayName || comment.author.username}...`}
              onSubmit={(content, imageFile) => {
                if (typeof onReplySubmit === "function") {
                  onReplySubmit(comment.id, content, imageFile);
                }
                onReplyToggle();
              }}
              onCancel={onReplyToggle}
              autoFocus
              mentionRootCommentId={mentionRootCommentId}
              submitting={Boolean(submitting)}
              imageUploadsEnabled={Boolean(imageUploadsEnabled)}
            />
          </div>
        )}
      </div>
    </div>
  );
});

export const CommentThread = memo(function CommentThread({
  comment,
  depth = 0,
  canReply = true,
  highlightedCommentId,
  forceExpandedParentIds,
  forceVisibleReplyCountByParentId,
  onReplySubmit,
  onToggleLike,
  onEditSubmit,
  onDelete,
  onReport,
  likedIds,
  reportedIds,
  pendingActionIds,
  deletingCommentIds,
  mentionRootCommentId,
  imageUploadsEnabled,
  submitting,
}: CommentThreadProps) {
  const [showReply, setShowReply] = useState(false);
  const [repliesExpanded, setRepliesExpanded] = useState(false);
  const [visibleReplyCount, setVisibleReplyCount] = useState(REPLY_EXPAND_PAGE_SIZE);
  const maxDepth = 1;
  const safeHighlightedCommentId = String(highlightedCommentId || "").trim();
  const isTargeted = safeHighlightedCommentId !== "" && safeHighlightedCommentId === String(comment.id);
  const replies = depth < maxDepth && Array.isArray(comment.replies) ? comment.replies : [];
  const previewReplies = replies.slice(0, REPLY_COLLAPSED_PREVIEW_COUNT);
  const remainingPreviewReplies = Math.max(replies.length - previewReplies.length, 0);
  const renderedReplies = replies.slice(0, visibleReplyCount);
  const remainingExpandedReplies = Math.max(replies.length - renderedReplies.length, 0);

  const expandReplies = () => {
    setRepliesExpanded(true);
    setVisibleReplyCount(REPLY_EXPAND_PAGE_SIZE);
  };

  useEffect(() => {
    if (depth !== 0) return;
    if (!(forceExpandedParentIds instanceof Set)) return;
    if (!forceExpandedParentIds.has(String(comment.id))) return;

    setRepliesExpanded(true);
    setVisibleReplyCount((prev) => Math.max(prev, REPLY_EXPAND_PAGE_SIZE));
  }, [comment.id, depth, forceExpandedParentIds]);

  useEffect(() => {
    if (depth !== 0) return;
    const forcedCountRaw = forceVisibleReplyCountByParentId
      ? Number(forceVisibleReplyCountByParentId[String(comment.id)] || 0)
      : 0;
    const forcedCount = Number.isFinite(forcedCountRaw) ? Math.max(0, Math.floor(forcedCountRaw)) : 0;
    if (forcedCount <= 0) return;

    setRepliesExpanded(true);
    setVisibleReplyCount((prev) => Math.max(prev, forcedCount));
  }, [comment.id, depth, forceVisibleReplyCountByParentId]);

  return (
    <div id={`comment-${comment.id}`} className={depth > 0 ? "ml-9" : ""}>
      <SingleComment
        comment={comment}
        depth={depth}
        onReplyToggle={() => setShowReply(!showReply)}
        showReply={showReply}
        canReply={canReply}
        onReplySubmit={onReplySubmit}
        onToggleLike={onToggleLike}
        onEditSubmit={onEditSubmit}
        onDelete={onDelete}
        onReport={onReport}
        likedIds={likedIds}
        reportedIds={reportedIds}
        pendingActionIds={pendingActionIds}
        deletingCommentIds={deletingCommentIds}
        mentionRootCommentId={mentionRootCommentId}
        submitting={submitting}
        imageUploadsEnabled={imageUploadsEnabled}
        isTargeted={isTargeted}
      />

      {depth < maxDepth && replies.length > 0 ? (
        repliesExpanded ? (
          <div>
            {renderedReplies.map((reply) => (
              <CommentThread
                key={reply.id}
                comment={reply}
                depth={depth + 1}
                canReply={canReply}
                forceExpandedParentIds={forceExpandedParentIds}
                forceVisibleReplyCountByParentId={forceVisibleReplyCountByParentId}
                onReplySubmit={onReplySubmit}
                onToggleLike={onToggleLike}
                onEditSubmit={onEditSubmit}
                onDelete={onDelete}
                onReport={onReport}
                likedIds={likedIds}
                reportedIds={reportedIds}
                pendingActionIds={pendingActionIds}
                deletingCommentIds={deletingCommentIds}
                mentionRootCommentId={mentionRootCommentId}
                imageUploadsEnabled={imageUploadsEnabled}
                submitting={submitting}
                highlightedCommentId={highlightedCommentId}
              />
            ))}

            {remainingExpandedReplies > 0 ? (
              <div className="ml-9 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleReplyCount((prev) =>
                      Math.min(prev + REPLY_EXPAND_PAGE_SIZE, replies.length)
                    )
                  }
                  className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  Xem thêm {Math.min(REPLY_EXPAND_PAGE_SIZE, remainingExpandedReplies)} phản hồi
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="ml-9 mt-1">
            <button
              type="button"
              onClick={expandReplies}
              className="w-full text-left rounded-md border-l border-border/80 pl-3 pr-2 py-1.5 cursor-pointer hover:bg-secondary/40 transition-colors"
            >
              <div className="space-y-1.5">
                {previewReplies.map((reply) => (
                  <div key={reply.id} className="flex items-center gap-2">
                    <img
                      src={reply.author.avatar}
                      alt={reply.author.username}
                      className="w-5 h-5 rounded-full shrink-0 bg-accent"
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = "/logobfang.svg";
                      }}
                    />
                    <div className="min-w-0 flex-1 text-[12px] leading-5">
                      <p className="truncate">
                        <span className="font-semibold text-foreground">
                          {reply.author.displayName || reply.author.username}
                        </span>
                        <span className="ml-1 text-muted-foreground">
                          {buildReplyPreviewText(reply.content)}
                        </span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-1 text-xs font-semibold text-foreground">
                {remainingPreviewReplies > 0
                  ? `Xem thêm ${remainingPreviewReplies} phản hồi`
                  : `Xem ${replies.length} phản hồi`}
              </div>
            </button>
          </div>
        )
      ) : null}
    </div>
  );
});
