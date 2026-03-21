import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { PostCard } from "@/components/PostCard";
import type { Post } from "@/types/forum";

const makePost = (overrides: Partial<Post> = {}): Post => ({
  id: "101",
  title: "Bài viết dài",
  content: `<p>${"Dòng nội dung ".repeat(24)}</p>`,
  author: {
    id: "u-1",
    username: "tester",
    displayName: "Tester",
    avatar: "/logobfang.svg",
    profileUrl: "/user/tester",
    badges: [],
    role: "member",
  },
  category: {
    id: 1,
    name: "Thảo luận",
    slug: "thao-luan-chung",
    icon: "💬",
    postCount: 0,
  },
  tags: [],
  upvotes: 0,
  downvotes: 0,
  commentCount: 0,
  createdAt: "Vừa xong",
  permissions: {
    canEdit: false,
    canDelete: false,
    canReport: true,
    canReply: true,
    isOwner: false,
  },
  ...overrides,
});

const renderPostCard = (postOverrides: Partial<Post> = {}) =>
  render(
    <MemoryRouter>
      <PostCard post={makePost(postOverrides)} />
    </MemoryRouter>
  );

const setPreviewOverflow = (container: HTMLElement, hasOverflow: boolean) => {
  const preview = container.querySelector(".forum-card-preview-collapsed") as HTMLElement | null;
  expect(preview).not.toBeNull();
  if (!preview) return;

  const scrollHeight = hasOverflow ? 260 : 120;
  const clientHeight = hasOverflow ? 120 : 120;

  Object.defineProperty(preview, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(preview, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });

  window.dispatchEvent(new Event("resize"));
};

describe("PostCard preview fade", () => {
  it("shows fade teaser when preview overflows collapsed height", async () => {
    const { container } = renderPostCard();
    setPreviewOverflow(container, true);

    await waitFor(() => {
      expect(container.querySelector(".forum-card-preview-fade")).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: /xem thêm/i })).toBeNull();
  });

  it("keeps teaser state without preview action buttons", async () => {
    const { container } = renderPostCard();
    setPreviewOverflow(container, true);

    await waitFor(() => {
      expect(container.querySelector(".forum-card-preview-fade")).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: /thu gọn/i })).toBeNull();
  });

  it("does not show fade teaser for non-overflow previews", async () => {
    const { container } = renderPostCard({ content: "<p>Ngắn gọn</p>" });
    setPreviewOverflow(container, false);

    await waitFor(() => {
      expect(container.querySelector(".forum-card-preview-fade")).toBeNull();
    });
    expect(screen.queryByRole("button", { name: /xem thêm/i })).toBeNull();
  });

  it("does not render embedded media tags in preview content", async () => {
    const { container } = renderPostCard({
      content:
        '<p>Co noi dung</p><img src="https://example.com/a.jpg" alt="a"/><video src="https://example.com/v.mp4"></video><iframe src="https://example.com/embed"></iframe>',
    });

    await waitFor(() => {
      const preview = container.querySelector(".forum-card-preview-collapsed");
      expect(preview).not.toBeNull();
      expect(preview?.querySelector("img,video,iframe,picture,source")).toBeNull();
    });
  });
});
