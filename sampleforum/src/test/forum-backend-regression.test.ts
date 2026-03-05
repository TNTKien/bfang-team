import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const routeFilePath = path.resolve(process.cwd(), "../src/routes/site-routes.js");
const forumApiRouteFilePath = path.resolve(process.cwd(), "../src/routes/forum-api-routes.js");
const mentionDomainFilePath = path.resolve(process.cwd(), "../src/domains/mention-notification-domain.js");
const engagementRouteFilePath = path.resolve(process.cwd(), "../src/routes/engagement-routes.js");
const adminEngagementRouteFilePath = path.resolve(process.cwd(), "../src/routes/admin-and-engagement-routes.js");
const appFilePath = path.resolve(process.cwd(), "../app.js");

const getRouteBlock = (source: string, routePath: string): string => {
  const marker = `"${routePath}"`;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Cannot find route marker: ${marker}`);
  }

  const nextRouteStart = source.indexOf("\napp.post(", start + marker.length);
  return source.slice(start, nextRouteStart > 0 ? nextRouteStart : source.length);
};

describe("forum backend regression checks", () => {
  it("declares isForumRequest before cooldown guard in both forum comment routes", () => {
    const source = fs.readFileSync(routeFilePath, "utf8");

    const rootCommentRoute = getRouteBlock(source, "/manga/:slug/comments");
    const chapterCommentRoute = getRouteBlock(source, "/manga/:slug/chapters/:number/comments");

    for (const block of [rootCommentRoute, chapterCommentRoute]) {
      const declareIndex = block.indexOf("const isForumRequest = isForumCommentRequest(req, commentRequestId);");
      const useIndex = block.indexOf("...(isForumRequest");

      expect(declareIndex).toBeGreaterThan(-1);
      expect(useIndex).toBeGreaterThan(-1);
      expect(declareIndex).toBeLessThan(useIndex);
    }
  });

  it("resolves forum reply parent context and uses root comment id for mentions", () => {
    const source = fs.readFileSync(routeFilePath, "utf8");

    const rootCommentRoute = getRouteBlock(source, "/manga/:slug/comments");
    const chapterCommentRoute = getRouteBlock(source, "/manga/:slug/chapters/:number/comments");

    for (const block of [rootCommentRoute, chapterCommentRoute]) {
      expect(block).toContain("const parentContext = await resolveCommentParentContext({");
      expect(block).toContain("const rootCommentId = parentContext.rootCommentId;");
      expect(block).toContain("rootCommentId: rootCommentId || undefined");
    }
  });

  it("keeps forum API mention metadata wiring for posts and replies", () => {
    const source = fs.readFileSync(forumApiRouteFilePath, "utf8");

    expect(source).toContain("const buildMentionMapForRows = async ({ rows, rootCommentId }) => {");
    const hasInlineMentionsMapping = source.includes("mentions: Array.isArray(mentions) ? mentions : []");
    const hasExtractedMentionsMapping =
      source.includes("createForumApiPresenterUtils") &&
      source.includes("mapPostSummary,") &&
      source.includes("mapReply,");
    expect(hasInlineMentionsMapping || hasExtractedMentionsMapping).toBe(true);

    const listMentionMapPattern = /const\s+mentionByCommentId\s*=\s*await\s+buildMentionMapForRows\s*\(\s*\{\s*rows:\s*postRows\s*\}\s*\)/m;
    const detailMentionMapPattern =
      /const\s+mentionByCommentId\s*=\s*await\s+buildMentionMapForRows\s*\(\s*\{\s*rows:\s*\[\s*postRow\s*,\s*\.\.\.replyRows\s*\]\s*,\s*rootCommentId:\s*postId\s*,?\s*\}\s*\)/m;

    expect(listMentionMapPattern.test(source)).toBe(true);
    expect(detailMentionMapPattern.test(source)).toBe(true);
  });

  it("accepts host aliases when resolving forum link labels", () => {
    const source = fs.readFileSync(forumApiRouteFilePath, "utf8");

    expect(source).toContain('const hasSameHostContext = (targetUrl, baseUrl) => {');
    expect(source).toContain('replace(/^www\\./, "")');
    expect(source).toContain("if (parsed.host && !hasSameHostContext(parsed, base)) {");
  });

  it("includes nested forum replies when resolving mention candidates and colors", () => {
    const source = fs.readFileSync(mentionDomainFilePath, "utf8");

    expect(source).toContain("OR c.parent_id IN (");
    expect(source).toContain("WHERE c1.parent_id = ?");
    expect(source).toContain("AND c1.status = 'visible'");
  });

  it("keeps manga comment tree isolated from forum threads", () => {
    const source = fs.readFileSync(appFilePath, "utf8");

    expect(source).toContain('const FORUM_COMMENT_REQUEST_PREFIX = "forum-";');
    expect(source).toContain("AND COALESCE(client_request_id, '') NOT ILIKE ?");
    expect(source).toContain("AND COALESCE(c.client_request_id, '') NOT ILIKE ?");
    expect(source).toContain("AND COALESCE(child.client_request_id, '') NOT ILIKE ?");
  });

  it("cleans forum image prefixes on cascade delete and protects forum admin writes with same-origin checks", () => {
    const source = fs.readFileSync(appFilePath, "utf8");

    expect(source).toContain("const extractForumImageStoragePrefixesFromContent = ({ content, chapterPrefix, forumPrefix }) => {");
    expect(source).toContain("await b2DeleteAllByPrefix(prefix);");
    expect(source).toContain("pathValue === \"/forum/api/admin\" || pathValue.startsWith(\"/forum/api/admin/\")");
    expect(source).toContain('requestPath.startsWith("/forum/tmp/") || requestPath.startsWith("/forum/posts/")');
  });

  it("stores finalized forum images outside manga-slug folders", () => {
    const source = fs.readFileSync(forumApiRouteFilePath, "utf8");

    expect(source).toContain("const buildForumPostFinalPrefix = ({ forumPrefix, token, nowMs = Date.now() }) => {");
    expect(source).toContain("return `${safeForumPrefix}/posts/${year}/${month}/post-${safeTimestamp}-${safeToken}`;");
    expect(source).not.toContain("/forum-posts/${mangaSlug}/post-");
  });

  it("finalizes local browser images only after post creation succeeds", () => {
    const source = fs.readFileSync(forumApiRouteFilePath, "utf8");

    expect(source).toContain('"/forum/api/posts/:id/images/finalize"');
    expect(source).toContain('const FORUM_LOCAL_IMAGE_PLACEHOLDER_PREFIX = "forum-local-image://";');
    expect(source).toContain("buildForumLocalImagePlaceholder");
    expect(source).toContain("content: outputContent");
    expect(source).toContain("uploadedCount: processedImages.length");
    expect(source).toContain("replaceAllLiteral(outputContent, item.placeholder, finalUrl)");
    expect(source).toContain("UPDATE comments SET content = ? WHERE id = ?");
  });

  it("keeps forum API feeds scoped to forum-created comments only", () => {
    const source = fs.readFileSync(forumApiRouteFilePath, "utf8");

    expect(source).toContain('const FORUM_REQUEST_ID_PREFIX = "forum-";');
    expect(source).toContain("const FORUM_REQUEST_ID_LIKE = `${FORUM_REQUEST_ID_PREFIX}%`;");
    expect(source).toContain("COALESCE(c.client_request_id, '') ILIKE ?");
    expect(source).toContain("COALESCE(r.client_request_id, '') ILIKE ?");
  });

  it("keeps forum image finalize from dropping existing post title blocks", () => {
    const source = fs.readFileSync(forumApiRouteFilePath, "utf8");

    const hasInlineTitleExtractor = source.includes("const extractForumPostTitleBlock = (content) => {");
    const hasExtractedTitleExtractor =
      source.includes("createForumApiContentUtils") && source.includes("extractForumPostTitleBlock,");
    expect(hasInlineTitleExtractor || hasExtractedTitleExtractor).toBe(true);
    expect(source).toContain("if (!extractForumPostTitleBlock(outputContent)) {");
    expect(source).toContain("const existingTitleBlock = extractForumPostTitleBlock(postRow && postRow.content);");
    expect(source).toContain("outputContent = `${existingTitleBlock}${outputContent}`;");
  });

  it("keeps dedicated cooldown windows for forum posts and replies", () => {
    const source = fs.readFileSync(routeFilePath, "utf8");

    expect(source).toContain("{ cooldownMs: FORUM_REPLY_COOLDOWN_MS, replyOnly: true }");
    expect(source).toContain("{ cooldownMs: FORUM_POST_COOLDOWN_MS, rootOnly: true }");
  });

  it("keeps hot ranking buckets and pagination constraints in forum home API", () => {
    const source = fs.readFileSync(forumApiRouteFilePath, "utf8");

    expect(source).toContain("const MAX_PER_PAGE = 20;");
    expect(source).toContain("const HOT_RECENT_LIMIT = 5;");
    expect(source).toContain("const HOT_COMMENT_ACTIVITY_LIMIT = 10;");
    const hasInlineSortNormalizer = source.includes("const normalizeForumSort = (value) => {");
    const hasExtractedSortNormalizer =
      source.includes("createForumApiParamUtils") && source.includes("normalizeForumSort,");
    expect(hasInlineSortNormalizer || hasExtractedSortNormalizer).toBe(true);
    expect(source).toContain("WITH base_posts AS (");
    expect(source).toContain("recent_picks");
    expect(source).toContain("comment_picks");
    expect(source).toContain("hot_bucket");
  });

  it("resolves forum notifications to forum post permalinks", () => {
    const mentionSource = fs.readFileSync(mentionDomainFilePath, "utf8");
    const engagementSource = fs.readFileSync(engagementRouteFilePath, "utf8");

    expect(mentionSource).toContain("const resolveForumCommentPermalinkForNotification = async ({ commentId }) => {");
    expect(mentionSource).toContain("return `/forum/post/${rootId}#comment-${safeCommentId}`;");
    expect(engagementSource).toContain("resolveForumCommentPermalinkForNotification,");
    expect(engagementSource).toContain("comment_row.client_request_id as comment_client_request_id");
    expect(engagementSource).toContain("const isForumCommentNotification = commentRequestId.startsWith(\"forum-\");");
    expect(engagementSource).toContain(
      'if (notificationType === "forum_post_comment" || (notificationType === "mention" && isForumCommentNotification)) {'
    );
  });

  it("keeps forum comment lookup independent from manga columns", () => {
    const source = fs.readFileSync(engagementRouteFilePath, "utf8");

    expect(source).toContain('tableName === COMMENT_TABLE_COMMENTS');
    expect(source).toContain('"manga_id, chapter_number"');
    expect(source).toContain('"NULL AS manga_id, NULL AS chapter_number"');
  });

  it("keeps legacy admin comments view scoped to manga comments and plain-text previews", () => {
    const source = fs.readFileSync(adminEngagementRouteFilePath, "utf8");

    expect(source).toContain('const FORUM_COMMENT_REQUEST_PREFIX = "forum-";');
    expect(source).toContain("COALESCE(c.client_request_id, '') NOT ILIKE ?");
    expect(source).toContain("COALESCE(c.content, '') NOT ILIKE ?");
    expect(source).toContain("const normalizeAdminCommentRow = (row) => {");
    expect(source).toContain("normalized.content = toPlainCommentText(normalized.content || \"\");");
  });
});
