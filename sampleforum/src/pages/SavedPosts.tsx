import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { PostCard } from "@/components/PostCard";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { fetchAuthSession, fetchForumSavedPosts } from "@/lib/forum-api";
import { openAuthProviderDialog } from "@/lib/auth-login";
import { applyForumSeo, buildForumSavedPostsSeo } from "@/lib/forum-seo";
import { mapApiPostToUiPost } from "@/lib/forum-presenters";
import type { AuthSessionUser, ForumApiPostSummary } from "@/types/forum";

const SAVED_POSTS_PER_PAGE = 10;

const normalizePage = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.floor(parsed);
};

const SavedPosts = () => {
  const [sessionUser, setSessionUser] = useState<AuthSessionUser | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [savedPosts, setSavedPosts] = useState<ForumApiPostSummary[]>([]);
  const [canModerateForum, setCanModerateForum] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    perPage: SAVED_POSTS_PER_PAGE,
    total: 0,
    pageCount: 1,
    hasPrev: false,
    hasNext: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPage = normalizePage(searchParams.get("page") || "1");

  useEffect(() => {
    applyForumSeo(buildForumSavedPostsSeo());
  }, []);

  const isAuthenticated = Boolean(sessionUser && sessionUser.id);

  const loadSavedPosts = useCallback(async () => {
    if (!isAuthenticated) {
      setSavedPosts([]);
      setCanModerateForum(false);
      setPagination({
        page: 1,
        perPage: SAVED_POSTS_PER_PAGE,
        total: 0,
        pageCount: 1,
        hasPrev: false,
        hasNext: false,
      });
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await fetchForumSavedPosts({
        page: currentPage,
        perPage: SAVED_POSTS_PER_PAGE,
      });
      const pageCountRaw = Number(payload?.pagination?.pageCount);
      const totalRaw = Number(payload?.pagination?.total);
      const pageRaw = Number(payload?.pagination?.page);
      const perPageRaw = Number(payload?.pagination?.perPage);

      const total = Number.isFinite(totalRaw) && totalRaw > 0 ? Math.floor(totalRaw) : 0;
      const pageCount = Number.isFinite(pageCountRaw) && pageCountRaw > 0 ? Math.floor(pageCountRaw) : 1;
      const resolvedPage = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
      const resolvedPerPage = Number.isFinite(perPageRaw) && perPageRaw > 0 ? Math.floor(perPageRaw) : SAVED_POSTS_PER_PAGE;
      const normalizedPage = Math.min(Math.max(resolvedPage, 1), pageCount);

      setSavedPosts(Array.isArray(payload && payload.posts) ? payload.posts : []);
      setPagination({
        page: normalizedPage,
        perPage: resolvedPerPage,
        total,
        pageCount,
        hasPrev: normalizedPage > 1,
        hasNext: normalizedPage < pageCount,
      });
      setCanModerateForum(Boolean(payload?.viewer?.canModerateForum || payload?.viewer?.canDeleteAnyComment));

      if (normalizedPage !== currentPage) {
        const params = new URLSearchParams(searchParams);
        if (normalizedPage <= 1) {
          params.delete("page");
        } else {
          params.set("page", String(normalizedPage));
        }
        setSearchParams(params, { replace: true });
      }
    } catch (err) {
      setSavedPosts([]);
      setCanModerateForum(false);
      setPagination({
        page: 1,
        perPage: SAVED_POSTS_PER_PAGE,
        total: 0,
        pageCount: 1,
        hasPrev: false,
        hasNext: false,
      });
      setError(err instanceof Error ? err.message : "Không thể tải danh sách bài viết đã lưu.");
    } finally {
      setLoading(false);
    }
  }, [currentPage, isAuthenticated, searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      try {
        const payload = await fetchAuthSession();
        if (!cancelled) {
          setSessionUser(payload && payload.session && payload.session.user ? payload.session.user : null);
        }
      } catch (_error) {
        if (!cancelled) {
          setSessionUser(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSession(false);
        }
      }
    };

    loadSession();

    const onAuthChanged = () => {
      void loadSession();
    };

    window.addEventListener("bfang:auth", onAuthChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("bfang:auth", onAuthChanged);
    };
  }, []);

  useEffect(() => {
    if (isLoadingSession) return;
    void loadSavedPosts();
  }, [isLoadingSession, loadSavedPosts]);

  useEffect(() => {
    if (!isAuthenticated || isLoadingSession) return;

    const handleBookmarkChanged = () => {
      void loadSavedPosts();
    };

    window.addEventListener("bfang:forum-bookmark-changed", handleBookmarkChanged as EventListener);
    return () => {
      window.removeEventListener("bfang:forum-bookmark-changed", handleBookmarkChanged as EventListener);
    };
  }, [isAuthenticated, isLoadingSession, loadSavedPosts]);

  const handleLogin = () => {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    openAuthProviderDialog(next || "/forum/saved-posts");
  };

  const setPage = useCallback(
    (nextPage: number) => {
      const pageCount = Math.max(1, Number(pagination.pageCount) || 1);
      const clamped = Math.min(Math.max(Math.floor(nextPage), 1), pageCount);
      const params = new URLSearchParams(searchParams);
      if (clamped <= 1) {
        params.delete("page");
      } else {
        params.set("page", String(clamped));
      }
      setSearchParams(params);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [pagination.pageCount, searchParams, setSearchParams]
  );

  const pageItems = useMemo(() => {
    const page = Number(pagination.page) || 1;
    const pageCount = Number(pagination.pageCount) || 1;
    if (pageCount <= 1) return [] as Array<number | "ellipsis">;

    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, (_item, index) => index + 1);
    }

    if (page <= 3) {
      return [1, 2, 3, 4, "ellipsis", pageCount];
    }

    if (page >= pageCount - 2) {
      return [1, "ellipsis", pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
    }

    return [1, "ellipsis", page - 1, page, page + 1, "ellipsis", pageCount];
  }, [pagination]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="mx-auto max-w-5xl px-4 py-4 space-y-3">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bộ sưu tập cá nhân</p>
              <h1 className="mt-1 text-lg font-semibold text-foreground">Bài viết đã lưu</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {isAuthenticated ? `${pagination.total} bài viết` : "Đăng nhập để xem danh sách bài viết đã lưu."}
              </p>
            </div>

            <Link
              to="/"
              className="inline-flex items-center rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Quay lại diễn đàn
            </Link>
          </div>
        </section>

        {isLoadingSession ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">Đang kiểm tra phiên đăng nhập...</p>
          </div>
        ) : !isAuthenticated ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">Bạn cần đăng nhập để xem bài viết đã lưu.</p>
            <button
              type="button"
              onClick={handleLogin}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              Đăng nhập
            </button>
          </div>
        ) : loading ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">Đang tải bài viết đã lưu...</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => {
                void loadSavedPosts();
              }}
              className="inline-flex items-center rounded-md bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
            >
              Tải lại
            </button>
          </div>
        ) : savedPosts.length > 0 ? (
          <>
            {savedPosts.map((post) => (
              <PostCard
                key={post.id}
                post={mapApiPostToUiPost(post)}
                isAuthenticated={isAuthenticated}
                canModerateForum={canModerateForum}
                onRequireLogin={handleLogin}
                onPostDeleted={() => {
                  void loadSavedPosts();
                }}
                onPostUpdated={() => {
                  void loadSavedPosts();
                }}
              />
            ))}

            {pagination.pageCount > 1 ? (
              <div className="pt-1">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          if (!pagination.hasPrev) return;
                          setPage((pagination.page || 1) - 1);
                        }}
                        className={!pagination.hasPrev ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>

                    {pageItems.map((item, index) => {
                      if (item === "ellipsis") {
                        return (
                          <PaginationItem key={`ellipsis-${index}`}>
                            <PaginationEllipsis />
                          </PaginationItem>
                        );
                      }

                      return (
                        <PaginationItem key={`page-${item}`}>
                          <PaginationLink
                            href="#"
                            isActive={item === pagination.page}
                            onClick={(event) => {
                              event.preventDefault();
                              setPage(item);
                            }}
                          >
                            {item}
                          </PaginationLink>
                        </PaginationItem>
                      );
                    })}

                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          if (!pagination.hasNext) return;
                          setPage((pagination.page || 1) + 1);
                        }}
                        className={!pagination.hasNext ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-border bg-card p-8 text-center space-y-2">
            <p className="text-sm text-muted-foreground">Bạn chưa lưu bài viết nào.</p>
            <p className="text-xs text-muted-foreground">Nhấn nút Lưu ở bài viết bạn quan tâm để thêm vào danh sách này.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SavedPosts;
