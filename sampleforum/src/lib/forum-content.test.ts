import { describe, expect, it } from "vitest";

import { normalizeForumContentHtml, trimForumContentEdges } from "@/lib/forum-content";

const getBody = (html: string) => new DOMParser().parseFromString(html, "text/html").body;

describe("normalizeForumContentHtml", () => {
  it("decorates @username mentions into profile links", () => {
    const html = normalizeForumContentHtml("<p>Xin chao @phanthehien150196</p>", [
      {
        userId: "u-1",
        username: "phanthehien150196",
        name: "@phanthehien150196",
      },
    ]);
    const body = getBody(html);
    const mention = body.querySelector("a.mention[data-mention-username='phanthehien150196']");

    expect(mention).not.toBeNull();
    expect(mention?.getAttribute("href")).toBe("/user/phanthehien150196");
    expect(mention?.textContent).toBe("@phanthehien150196");
  });

  it("keeps mentions inside code blocks as plain text", () => {
    const html = normalizeForumContentHtml("<p><code>@phanthehien150196</code> va @admin_user</p>", [
      {
        userId: "u-admin",
        username: "admin_user",
        name: "@admin_user",
      },
    ]);
    const body = getBody(html);

    expect(body.querySelector("code")?.textContent).toBe("@phanthehien150196");
    const mentionLinks = body.querySelectorAll("a.mention");
    expect(mentionLinks.length).toBe(1);
    expect(mentionLinks[0]?.textContent).toBe("@admin_user");
  });

  it("does not wrap mentions already inside links", () => {
    const html = normalizeForumContentHtml("<p><a href='/user/old_user'>@old_user</a> va @new_user</p>", [
      {
        userId: "u-new",
        username: "new_user",
        name: "@new_user",
      },
    ]);
    const body = getBody(html);

    const anchors = Array.from(body.querySelectorAll("a"));
    expect(anchors.length).toBe(2);
    expect(anchors[0]?.getAttribute("href")).toBe("/user/old_user");
    expect(anchors[0]?.classList.contains("mention")).toBe(false);
    expect(anchors[1]?.getAttribute("href")).toBe("/user/new_user");
    expect(anchors[1]?.classList.contains("mention")).toBe(true);
  });

  it("supports mention decoration for markdown content", () => {
    const html = normalizeForumContentHtml("Chao @mod_linh", [
      {
        userId: "u-2",
        username: "mod_linh",
        name: "@mod_linh",
      },
    ]);
    const body = getBody(html);
    const mention = body.querySelector("a.mention[data-mention-username='mod_linh']");

    expect(mention).not.toBeNull();
    expect(mention?.getAttribute("href")).toBe("/user/mod_linh");
  });

  it("renders mention display names when mention metadata is provided", () => {
    const html = normalizeForumContentHtml("<p>Xin chao @mod_linh</p>", [
      {
        userId: "u-2",
        username: "mod_linh",
        name: "Mod Linh",
        userColor: "#3b82f6",
      },
    ]);
    const body = getBody(html);
    const mention = body.querySelector("a.mention[data-mention-username='mod_linh']");

    expect(mention).not.toBeNull();
    expect(mention?.getAttribute("href")).toBe("/user/mod_linh");
    expect(mention?.textContent).toBe("Mod Linh");
    expect(mention?.getAttribute("style") || "").toContain("59, 130, 246");
  });

  it("keeps unknown @username as plain text when mention metadata is missing", () => {
    const html = normalizeForumContentHtml("<p>Xin chao @nguoi_la</p>", []);
    const body = getBody(html);

    expect(body.querySelector("a.mention")).toBeNull();
    expect(body.textContent || "").toContain("@nguoi_la");
  });

  it("sanitizes unsafe html while preserving safe forum markup", () => {
    const html = normalizeForumContentHtml(
      "<p onclick='alert(1)'>Xin chao</p><script>alert(1)</script><img src='javascript:alert(1)' onerror='alert(1)' alt='x'><img src='/uploads/a.webp' alt='  Anh   bia  '><span class='spoiler extra' style='color:red'>An noi dung</span>",
      []
    );
    const body = getBody(html);

    expect(body.querySelector("script")).toBeNull();
    expect((body.textContent || "").includes("alert(1)")).toBe(true);

    const images = Array.from(body.querySelectorAll("img"));
    expect(images.length).toBe(2);
    expect(images[0]?.getAttribute("src") || "").toBe("");
    expect(images[1]?.getAttribute("src")).toBe("/uploads/a.webp");
    expect(images[1]?.getAttribute("alt")).toBe("Anh bia");

    const spoiler = body.querySelector("span");
    expect(spoiler?.getAttribute("class")).toBe("spoiler");
    expect(spoiler?.getAttribute("style")).toBeNull();
  });

  it("keeps uploaded images when html content also contains markdown-like text", () => {
    const html = normalizeForumContentHtml(
      "<p>Noi dung [link](https://example.com/path)</p><img class='rounded-lg' src='https://i.moetruyen.net/forum/posts/2026/03/post-1772854746985-post-62/001.webp' alt='upload.webp'>",
      []
    );
    const body = getBody(html);
    const image = body.querySelector("img");
    const link = body.querySelector("a");

    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(
      "https://i.moetruyen.net/forum/posts/2026/03/post-1772854746985-post-62/001.webp"
    );
    expect(link?.getAttribute("href")).toBe("https://example.com/path");
  });

  it("preserves pasted raw line breaks inside html text nodes", () => {
    const html = normalizeForumContentHtml("<p>Dong 1\nDong 2\n\nDong 4</p>", []);
    const body = getBody(html);
    const paragraph = body.querySelector("p");

    expect(paragraph).not.toBeNull();
    expect(paragraph?.querySelectorAll("br").length).toBe(3);
    expect((paragraph?.innerHTML || "").replace(/<br\s*\/?>/g, "<br>")).toContain("Dong 1<br>Dong 2<br><br>Dong 4");
  });

  it("does not introduce visible breaks for formatting newlines around inline markup", () => {
    const html = normalizeForumContentHtml("<p>\nXin <strong>chao</strong>\n</p>", []);
    const body = getBody(html);
    const paragraph = body.querySelector("p");

    expect(paragraph).not.toBeNull();
    expect(paragraph?.querySelectorAll("br").length).toBe(0);
    expect(paragraph?.querySelector("strong")?.textContent).toBe("chao");
  });

  it("keeps whitespace-only paragraphs as explicit blank lines", () => {
    const html = normalizeForumContentHtml("<p>A</p><p> </p><p>B</p>", []);
    const body = getBody(html);
    const paragraphs = body.querySelectorAll("p");

    expect(paragraphs.length).toBe(3);
    expect(paragraphs[1]?.textContent || "").toBe("");
  });
});

describe("trimForumContentEdges", () => {
  it("removes trailing empty paragraph blocks", () => {
    expect(trimForumContentEdges("<p>Xin chao</p><p></p>")).toBe("<p>Xin chao</p>");
  });

  it("removes trailing br inside the final paragraph", () => {
    expect(trimForumContentEdges("<p>Xin chao<br></p>")).toBe("<p>Xin chao</p>");
  });
});
