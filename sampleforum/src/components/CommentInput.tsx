import { useEffect, useMemo, useRef, useState, memo } from "react";
import { ImageIcon, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/RichTextEditor";
import { fetchAuthSession } from "@/lib/forum-api";
import { measureForumTextLength } from "@/lib/forum-content";
import { FORUM_COMMENT_MAX_LENGTH, FORUM_COMMENT_MIN_LENGTH } from "@/lib/forum-limits";
import type { AuthSessionUser } from "@/types/forum";

const FORUM_COMMENT_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const FORUM_COMMENT_IMAGE_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

interface CommentInputProps {
  placeholder?: string;
  onSubmit: (content: string, imageFile?: File | null) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  mentionRootCommentId?: number;
  submitting?: boolean;
  imageUploadsEnabled?: boolean;
}

export const CommentInput = memo(function CommentInput({
  placeholder = "Viết bình luận...",
  onSubmit,
  onCancel,
  autoFocus,
  mentionRootCommentId,
  submitting = false,
  imageUploadsEnabled = false,
}: CommentInputProps) {
  const [content, setContent] = useState("");
  const [expanded, setExpanded] = useState(autoFocus || false);
  const [sessionUser, setSessionUser] = useState<AuthSessionUser | null>(null);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingImagePreviewUrl, setPendingImagePreviewUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const imagePickerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const syncSession = async () => {
      try {
        const payload = await fetchAuthSession();
        if (!cancelled) {
          setSessionUser(payload && payload.session && payload.session.user ? payload.session.user : null);
        }
      } catch (_error) {
        if (!cancelled) {
          setSessionUser(null);
        }
      }
    };

    syncSession();

    const onAuthChanged = () => {
      syncSession();
    };

    window.addEventListener("bfang:auth", onAuthChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("bfang:auth", onAuthChanged);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pendingImagePreviewUrl) {
        URL.revokeObjectURL(pendingImagePreviewUrl);
      }
    };
  }, [pendingImagePreviewUrl]);

  const avatarUrl = useMemo(() => {
    const fallback = "https://api.dicebear.com/7.x/avataaars/svg?seed=currentuser";
    if (!sessionUser) return fallback;

    const meta =
      sessionUser.user_metadata && typeof sessionUser.user_metadata === "object"
        ? sessionUser.user_metadata
        : null;
    const direct =
      meta && (meta.avatar_url_custom || meta.avatar_url || meta.picture)
        ? String(meta.avatar_url_custom || meta.avatar_url || meta.picture).trim()
        : "";
    if (direct) return direct;

    const identities = Array.isArray(sessionUser.identities) ? sessionUser.identities : [];
    for (const identity of identities) {
      if (!identity || typeof identity !== "object") continue;
      const identityData =
        identity.identity_data && typeof identity.identity_data === "object" ? identity.identity_data : null;
      const avatar =
        identityData && (identityData.avatar_url || identityData.picture)
          ? String(identityData.avatar_url || identityData.picture).trim()
          : "";
      if (avatar) return avatar;
    }

    return fallback;
  }, [sessionUser]);

  const clearPendingImage = () => {
    setPendingImageFile(null);
    setImageError("");
    if (pendingImagePreviewUrl) {
      URL.revokeObjectURL(pendingImagePreviewUrl);
      setPendingImagePreviewUrl("");
    }
  };

  const handleSelectImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
    event.target.value = "";
    if (!file) return;

    const fileType = String(file.type || "").toLowerCase();
    if (!FORUM_COMMENT_IMAGE_ALLOWED_MIME_TYPES.has(fileType)) {
      clearPendingImage();
      setImageError("Chỉ hỗ trợ ảnh JPG, PNG, GIF hoặc WebP.");
      return;
    }

    const fileSize = Number(file.size);
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > FORUM_COMMENT_IMAGE_MAX_BYTES) {
      clearPendingImage();
      setImageError("Ảnh vượt quá giới hạn 3MB.");
      return;
    }

    if (pendingImagePreviewUrl) {
      URL.revokeObjectURL(pendingImagePreviewUrl);
    }
    setPendingImageFile(file);
    setPendingImagePreviewUrl(URL.createObjectURL(file));
    setImageError("");
  };

  const handleSubmit = () => {
    if (submitting) return;
    const normalized = (content || "").toString().trim();
    const visibleLength = measureForumTextLength(normalized);
    const hasImage = pendingImageFile instanceof File;
    if (!normalized && !hasImage) {
      return;
    }
    if (normalized && (visibleLength > FORUM_COMMENT_MAX_LENGTH || visibleLength < FORUM_COMMENT_MIN_LENGTH)) {
      return;
    }

    onSubmit(content, pendingImageFile);
    setContent("");
    clearPendingImage();
    if (!autoFocus) setExpanded(false);
  };

  const handleOpenImagePicker = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (submitting || !imageUploadsEnabled) return;
    const picker = imagePickerInputRef.current;
    if (!picker) return;
    picker.click();
  };

  const normalizedContent = (content || "").toString().trim();
  const contentLength = measureForumTextLength(normalizedContent);
  const overLimit = contentLength > FORUM_COMMENT_MAX_LENGTH;
  const underMin = Boolean(normalizedContent) && contentLength < FORUM_COMMENT_MIN_LENGTH;
  const invalidLength = Boolean(normalizedContent) && (contentLength < FORUM_COMMENT_MIN_LENGTH || overLimit);
  const canSubmit =
    !submitting &&
    !invalidLength &&
    (Boolean(normalizedContent) ? normalizedContent !== "<p></p>" : pendingImageFile instanceof File);

  return (
    <div className="flex items-start gap-2">
      <img
        src={avatarUrl}
        alt="Avatar"
        className="w-6 h-6 rounded-full shrink-0 mt-0.5"
        referrerPolicy="no-referrer"
      />
      <div className="flex-1 min-w-0">
        {expanded ? (
          <div className="space-y-1.5">
            <RichTextEditor
              content={content}
              onUpdate={setContent}
              placeholder={placeholder}
              compact
              autoFocus={autoFocus}
              minHeight="32px"
              mentionRootCommentId={mentionRootCommentId}
              compactToolbarExtra={
                imageUploadsEnabled ? (
                  <>
                    <button
                      type="button"
                      onMouseDown={handleOpenImagePicker}
                      className={`p-1 rounded transition-colors ${
                        submitting
                          ? "text-muted-foreground/45 cursor-not-allowed"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                      title="Thêm ảnh"
                      aria-label="Thêm ảnh"
                      disabled={submitting}
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : undefined
              }
            />

            {imageUploadsEnabled ? (
              <input
                ref={imagePickerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleSelectImage}
                disabled={submitting}
              />
            ) : null}

            {pendingImagePreviewUrl ? (
              <div className="flex items-start gap-2">
                <div className="max-w-[220px] max-h-[320px] overflow-hidden rounded-md border border-border bg-background">
                  <img src={pendingImagePreviewUrl} alt="Ảnh đính kèm" className="h-auto max-h-[320px] w-full object-cover" />
                </div>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (submitting) return;
                    clearPendingImage();
                  }}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background transition-colors ${
                    submitting
                      ? "text-muted-foreground/45 cursor-not-allowed"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                  title="Xóa ảnh"
                  aria-label="Xóa ảnh"
                  disabled={submitting}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}

            {imageError ? <p className="text-[11px] text-destructive">{imageError}</p> : null}

            <div className="flex justify-end gap-1.5">
              <span
                className={`mr-auto self-center text-[11px] ${
                  overLimit || underMin ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {contentLength}/{FORUM_COMMENT_MAX_LENGTH}
              </span>
              {onCancel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onCancel();
                    setExpanded(false);
                  }}
                  className="text-[11px] text-muted-foreground h-6 px-2"
                >
                  Hủy
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="text-[11px] h-6 px-2.5 gap-1"
              >
                <Send className="h-3 w-3" /> {submitting ? "Đang gửi..." : "Gửi"}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full text-left rounded-lg bg-secondary border-none text-sm text-muted-foreground px-3 py-2 hover:bg-accent transition-colors"
            disabled={submitting}
          >
            {placeholder}
          </button>
        )}
      </div>
    </div>
  );
});
