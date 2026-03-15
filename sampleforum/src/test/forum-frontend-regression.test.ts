import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const postDetailFilePath = path.resolve(process.cwd(), "src/pages/PostDetail.tsx");
const navbarFilePath = path.resolve(process.cwd(), "src/components/Navbar.tsx");
const commentThreadFilePath = path.resolve(process.cwd(), "src/components/CommentThread.tsx");
const createPostModalFilePath = path.resolve(process.cwd(), "src/components/CreatePostModal.tsx");
const richTextEditorFilePath = path.resolve(process.cwd(), "src/components/RichTextEditor.tsx");
const indexCssFilePath = path.resolve(process.cwd(), "src/index.css");
const dialogUiFilePath = path.resolve(process.cwd(), "src/components/ui/dialog.tsx");

describe("forum frontend regression checks", () => {
  it("keeps current comment sort tab when inserting optimistic replies", () => {
    const source = fs.readFileSync(postDetailFilePath, "utf8");
    const pushOptimisticCommentMatch = source.match(
      /const\s+pushOptimisticComment\s*=\s*\(comment:\s*UiComment\)\s*=>\s*\{[\s\S]*?\n\s*\};/
    );

    expect(pushOptimisticCommentMatch).not.toBeNull();
    const pushOptimisticCommentBlock = String(pushOptimisticCommentMatch && pushOptimisticCommentMatch[0]);

    expect(pushOptimisticCommentBlock).not.toContain('setSortComments("new")');
    expect(pushOptimisticCommentBlock).toContain("target.scrollIntoView({ behavior: \"smooth\", block: \"center\" });");
    expect(pushOptimisticCommentBlock).not.toContain("handleScrollToComments();");
  });

  it("temporarily pins newly submitted root comments before full reload", () => {
    const source = fs.readFileSync(postDetailFilePath, "utf8");

    expect(source).toContain("const [tempPinnedRootCommentIds, setTempPinnedRootCommentIds] = useState<Set<string>>(new Set());");
    expect(source).toContain("pinnedRootIdSet: tempPinnedRootCommentIds,");
    expect(source).toContain("const persistedRootCommentId = Number(payload && payload.comment && payload.comment.id);");
    expect(source).toContain("setTempPinnedRootCommentIds((prev) => {");
    expect(source).toContain("next.add(String(Math.floor(persistedRootCommentId)));");
  });

  it("routes same-page comment notification clicks through reveal event", () => {
    const source = fs.readFileSync(navbarFilePath, "utf8");

    expect(source).toContain("if (isSamePage && hasCommentHash) {");
    expect(source).not.toContain("if (isSamePage && isSameHash && hasCommentHash) {");
    expect(source).not.toContain("targetUrl.search === currentUrl.search");
    expect(source).toContain("new CustomEvent(COMMENT_TARGET_REVEAL_EVENT");
  });

  it("forces manual reveal token after setting new hash in PostDetail", () => {
    const source = fs.readFileSync(postDetailFilePath, "utf8");

    expect(source).toContain('const currentHash = typeof window !== "undefined" ? window.location.hash : "";');
    expect(source).toContain("}, [location.hash, manualRevealToken]);");
    expect(source).toMatch(
      /if\s*\(requestedHash\s*!==\s*currentHash\)\s*\{\s*window\.location\.hash\s*=\s*requestedHash;\s*\}\s*setManualRevealToken\(\(value\)\s*=>\s*value\s*\+\s*1\);/m
    );
  });

  it("refreshes post detail when notification hash target is missing", () => {
    const source = fs.readFileSync(postDetailFilePath, "utf8");

    expect(source).toContain("if (!safePostId || !hashTargetCommentId || hashTargetMeta) {");
    expect(source).toContain("const refreshKey = `${safePostId}:${hashTargetCommentId}:${manualRevealToken}`;");
    expect(source).toContain("const refreshed = await fetchForumPostDetail(safePostId);");
    expect(source).toContain("hashTargetRefreshAttemptRef.current = refreshKey;");
  });

  it("keeps optimistic comments visible until persisted comment appears in refreshed detail", () => {
    const source = fs.readFileSync(postDetailFilePath, "utf8");

    expect(source).toContain("const hasCommentInDetail = (payload: ForumPostDetailResponse | null | undefined, commentId: string): boolean => {");
    expect(source).toContain("if (!persistedRootCommentKey || hasCommentInDetail(refreshed, persistedRootCommentKey)) {");
    expect(source).toContain("if (!persistedReplyKey || hasCommentInDetail(refreshed, persistedReplyKey)) {");
  });

  it("shows deleting status text in comment actions while forum delete is pending", () => {
    const source = fs.readFileSync(commentThreadFilePath, "utf8");

    expect(source).toContain("deletingCommentIds?: Set<string>;");
    expect(source).toContain("pendingActionIds,\n  deletingCommentIds,");
    expect(source).toContain("const isDeleting = Boolean(deletingCommentIds && deletingCommentIds.has(comment.id));");
    expect(source).toContain("Đang xóa bình luận");
    expect(source).toContain(") : isDeleting ? (");
  });

  it("tracks deleting comment ids and shows delete success toast after refresh", () => {
    const source = fs.readFileSync(postDetailFilePath, "utf8");

    expect(source).toContain("const [deletingCommentIds, setDeletingCommentIds] = useState<Set<string>>(new Set());");
    expect(source).toContain("deletingCommentIds={deletingCommentIds}");
    expect(source).toContain("next.add(safeId);");
    expect(source).toContain("title: \"Đã xóa bình luận\"");
    expect(source).toContain("description: \"Bình luận đã được xóa khỏi bài đăng.\"");
  });

  it("adds expand control to create post dialog beside close button area", () => {
    const source = fs.readFileSync(createPostModalFilePath, "utf8");

    expect(source).toContain("const [dialogExpanded, setDialogExpanded] = useState(false);");
    expect(source).toContain("hidden md:inline-flex absolute right-10 top-4");
    expect(source).toContain("hover:text-foreground");
    expect(source).toContain("focus-visible:ring-0");
    expect(source).toContain("aria-label={dialogExpanded ? \"Thu nhỏ khung tạo bài viết\" : \"Mở rộng khung tạo bài viết\"}");
    expect(source).toContain("<Minimize2 className=\"h-4 w-4\" />");
    expect(source).toContain("<Maximize2 className=\"h-4 w-4\" />");
    expect(source).toContain("maxHeight={dialogExpanded ? \"clamp(280px, 58vh, 640px)\" : \"320px\"}");
    expect(source).toContain("className=\"h-10 bg-secondary border border-border/70 text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-border/70\"");
    expect(source).toContain("className=\"flex items-center justify-between gap-3 text-[11px]\"");
    expect(source).toContain("Tiêu đề cần ít nhất ${FORUM_POST_TITLE_MIN_LENGTH} ký tự.");
    expect(source).toContain("className=\"w-full rounded-lg bg-secondary border border-border/70 px-3 py-2.5 text-sm text-foreground outline-none focus:border-border/70 focus:ring-0\"");
  });

  it("adds expand control to edit dialog in post detail", () => {
    const source = fs.readFileSync(postDetailFilePath, "utf8");

    expect(source).toContain("const [editDialogExpanded, setEditDialogExpanded] = useState(false);");
    expect(source).toContain("hidden md:inline-flex absolute right-10 top-4");
    expect(source).toContain("hover:text-foreground");
    expect(source).toContain("focus-visible:ring-0");
    expect(source).toContain("aria-label={editDialogExpanded ? \"Thu nhỏ khung chỉnh sửa\" : \"Mở rộng khung chỉnh sửa\"}");
    expect(source).toContain("setEditDialogExpanded(false);");
    expect(source).toContain("max-w-[min(96vw,1200px)]");
    expect(source).toContain("? \"clamp(280px, 56vh, 620px)\"");
    expect(source).toContain(": \"clamp(220px, 52vh, 560px)\"");
    expect(source).toContain("className=\"h-10 bg-secondary border border-border/70 text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-border/70\"");
    expect(source).toContain("className=\"w-full rounded-lg bg-secondary border border-border/70 text-sm text-foreground px-3 py-2.5 outline-none focus:border-border/70 focus:ring-0\"");
  });

  it("keeps a writable trailing paragraph after image insertion in editor", () => {
    const source = fs.readFileSync(richTextEditorFilePath, "utf8");

    expect(source).toContain("import { NodeSelection } from \"@tiptap/pm/state\";");
    expect(source).toContain("const ensureTrailingParagraph = useCallback((editorInstance: Editor | null) => {");
    expect(source).toContain("let trailingEmptyParagraphCount = 0;");
    expect(source).toContain("const trailingStartIndex = doc.childCount - trailingEmptyParagraphCount;");
    expect(source).toContain("const previousIsImage = Boolean(");
    expect(source).toContain("if (!previousIsImage || trailingEmptyParagraphCount > 0) {");
    expect(source).toContain("const paragraphType = editorState.schema.nodes.paragraph;");
    expect(source).toContain("const paragraphNode = paragraphType.createAndFill();");
    expect(source).toContain("editorInstance.view.dispatch(editorState.tr.insert(doc.content.size, paragraphNode));");
    expect(source).not.toContain("transaction = transaction.delete(deleteFrom, doc.content.size).insert(deleteFrom, paragraphNode);");
    expect(source).not.toContain("const previousBottomGap = editorDom");
    expect(source).not.toContain("editorDom.scrollTop = editorDom.scrollHeight;");
    expect(source).toContain("handleKeyDown: (view, event) => {");
    expect(source).toContain("if (event.key !== \"Backspace\" && event.key !== \"Delete\") {");
    expect(source).toContain("const previousNode = doc.childCount > 1 ? doc.child(doc.childCount - 2) : null;");
    expect(source).toContain("if (!previousIsImage || selection.$from.parent !== lastNode) {");
    expect(source).toContain("if (event.key === \"Backspace\" && atParagraphStart) {");
    expect(source).toContain("const previousNodeSelection = NodeSelection.create(doc, previousNodeOffset);");
    expect(source).toContain("view.dispatch(view.state.tr.setSelection(previousNodeSelection).scrollIntoView());");
    expect(source).toContain("if (event.key === \"Delete\" && atParagraphEnd) {");
    expect(source).toContain(".setImage({ src: dataUrl, alt: file.name || \"Ảnh bài viết\" })");
    expect(source).toContain("throw new Error(\"Không thể chèn ảnh vào khung soạn thảo.\")");
    expect(source).toContain("editor?.chain().focus().setImage({ src: url }).run();");
    expect(source).toContain("editor.on(\"transaction\", handleTransaction);");
    expect(source).toContain("padding-bottom: 5rem;");
  });

  it("uses persistent hidden file input for reliable image picker preview flow", () => {
    const source = fs.readFileSync(richTextEditorFilePath, "utf8");

    expect(source).toContain("const handleFileInputChange = useCallback(");
    expect(source).toContain("const picker = fileInputRef.current;");
    expect(source).toContain("const file = picker.files?.[0];");
    expect(source).toContain("<input");
    expect(source).toContain("type=\"file\"");
    expect(source).toContain("accept=\"image/*\"");
    expect(source).toContain("onChange={handleFileInputChange}");
  });

  it("keeps empty trailing editor paragraph visually usable", () => {
    const source = fs.readFileSync(indexCssFilePath, "utf8");

    expect(source).toContain(".tiptap p.is-empty {");
    expect(source).toContain("min-height: 1.4rem;");
  });

  it("uses neutral close-button hover style without accent red ring", () => {
    const source = fs.readFileSync(dialogUiFilePath, "utf8");

    expect(source).toContain("hover:text-foreground hover:opacity-100");
    expect(source).toContain("focus-visible:ring-0 focus-visible:ring-offset-0");
    expect(source).not.toContain("data-[state=open]:bg-accent");
    expect(source).not.toContain("focus:ring-2 focus:ring-ring focus:ring-offset-2");
  });
});
