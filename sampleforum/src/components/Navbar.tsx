import { Bell, Menu, MessageCircle, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAuthSession } from "@/lib/forum-api";
import { AUTH_PROVIDER_DIALOG_EVENT, openAuthProviderDialog } from "@/lib/auth-login";
import { getSiteBranding } from "@/lib/site-branding";
import type { AuthSessionUser } from "@/types/forum";

type NavLinkItem = {
  label: string;
  href: string;
  external?: boolean;
};

type HeaderNotificationItem = {
  id: number;
  actorName: string;
  actorAvatarUrl: string;
  message: string;
  preview: string;
  createdAtText: string;
  url: string;
  isRead: boolean;
};

const HEADER_POLL_INTERVAL_MS = 60 * 1000;

const toSafeText = (value: unknown) => (value == null ? "" : String(value)).trim();

const normalizeCount = (value: unknown): number => {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
};

const parseNotificationItem = (rawItem: unknown): HeaderNotificationItem | null => {
  const item = rawItem && typeof rawItem === "object" ? (rawItem as Record<string, unknown>) : null;
  if (!item) return null;

  const id = Number(item.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const rawUrl = toSafeText(item.url);
  const safeUrl = rawUrl && rawUrl.startsWith("/") ? rawUrl : "/";
  return {
    id: Math.floor(id),
    actorName: toSafeText(item.actorName),
    actorAvatarUrl: toSafeText(item.actorAvatarUrl),
    message: toSafeText(item.message) || "Bạn có thông báo mới.",
    preview: toSafeText(item.preview),
    createdAtText: toSafeText(item.createdAtText),
    url: safeUrl,
    isRead: Boolean(item.isRead),
  };
};

export function Navbar() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionUser, setSessionUser] = useState<AuthSessionUser | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogNext, setAuthDialogNext] = useState("/forum");
  const [searchText, setSearchText] = useState("");

  const [mobileNotificationMenuOpen, setMobileNotificationMenuOpen] = useState(false);
  const [desktopNotificationMenuOpen, setDesktopNotificationMenuOpen] = useState(false);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [notifications, setNotifications] = useState<HeaderNotificationItem[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [messageWidgetEnabled, setMessageWidgetEnabled] = useState(true);

  const location = useLocation();
  const navigate = useNavigate();
  const siteBranding = useMemo(() => getSiteBranding(), []);
  const notificationMenuOpenRef = useRef(false);
  const notificationMenuOpen = mobileNotificationMenuOpen || desktopNotificationMenuOpen;

  const closeNotificationMenus = useCallback(() => {
    setMobileNotificationMenuOpen(false);
    setDesktopNotificationMenuOpen(false);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    setSearchText((params.get("q") || "").trim());
  }, [location.search]);

  const handleSearchSubmit = (event?: FormEvent) => {
    if (event) event.preventDefault();
    const next = (searchText || "").trim();
    navigate({ pathname: "/", search: next ? `?q=${encodeURIComponent(next)}` : "" });
    setSearchOpen(false);
  };

  useEffect(() => {
    let cancelled = false;

    const syncSession = async () => {
      try {
        const payload = await fetchAuthSession();
        if (cancelled) return;
        setSessionUser(payload && payload.session && payload.session.user ? payload.session.user : null);
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

    syncSession();

    const onAuthChange = () => {
      syncSession();
    };

    window.addEventListener("bfang:auth", onAuthChange);
    return () => {
      cancelled = true;
      window.removeEventListener("bfang:auth", onAuthChange);
    };
  }, []);

  useEffect(() => {
    const handleOpenAuthDialog = (event: Event) => {
      const customEvent = event as CustomEvent<{ next?: string }>;
      const detailNext =
        customEvent && customEvent.detail && typeof customEvent.detail.next === "string"
          ? customEvent.detail.next.trim()
          : "";
      const fallbackNext = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      setAuthDialogNext(detailNext || fallbackNext || "/forum");
      setAuthDialogOpen(true);
      setMobileMenuOpen(false);
    };

    window.addEventListener(AUTH_PROVIDER_DIALOG_EVENT, handleOpenAuthDialog as EventListener);
    return () => {
      window.removeEventListener(AUTH_PROVIDER_DIALOG_EVENT, handleOpenAuthDialog as EventListener);
    };
  }, []);

  const navLinks: NavLinkItem[] = [
    { label: "Diễn đàn", href: "/" },
    { label: "Tin tức", href: "/tin-tuc", external: true },
    { label: "Nhóm dịch / Đăng truyện", href: "/publish", external: true },
  ];

  const displayName = useMemo(() => {
    if (!sessionUser) return "";
    const meta =
      sessionUser.user_metadata && typeof sessionUser.user_metadata === "object"
        ? sessionUser.user_metadata
        : null;
    return (
      (meta && (meta.display_name || meta.name || meta.full_name)
        ? String(meta.display_name || meta.name || meta.full_name).trim()
        : "") ||
      (sessionUser.email || "").toString().trim() ||
      "Tài khoản"
    );
  }, [sessionUser]);

  const avatarUrl = useMemo(() => {
    if (!sessionUser) return "";
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
        identity.identity_data && typeof identity.identity_data === "object"
          ? identity.identity_data
          : null;
      const avatar =
        identityData && (identityData.avatar_url || identityData.picture)
          ? String(identityData.avatar_url || identityData.picture).trim()
          : "";
      if (avatar) return avatar;
    }
    return "";
  }, [sessionUser]);

  const profileHandle = useMemo(() => {
    if (!sessionUser) return "";

    const metaRaw =
      sessionUser.user_metadata && typeof sessionUser.user_metadata === "object"
        ? (sessionUser.user_metadata as Record<string, unknown>)
        : null;
    const handleFromMeta =
      (metaRaw && (metaRaw.username || metaRaw.preferred_username || metaRaw.nick_name)
        ? String(metaRaw.username || metaRaw.preferred_username || metaRaw.nick_name).trim()
        : "") || "";

    const handleFromEmail = (() => {
      const email = (sessionUser.email || "").toString().trim();
      if (!email || !email.includes("@")) return "";
      const localPart = email.split("@")[0] || "";
      return localPart.replace(/\s+/g, "").trim();
    })();

    const resolvedHandle = handleFromMeta || handleFromEmail;
    if (!resolvedHandle) return "";
    return resolvedHandle.startsWith("@") ? resolvedHandle : `@${resolvedHandle}`;
  }, [sessionUser]);

  const loadNotifications = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!sessionUser || !sessionUser.id) {
        setNotifications([]);
        setUnreadNotificationCount(0);
        return;
      }

      if (!silent) {
        setIsLoadingNotifications(true);
      }

      try {
        const response = await fetch("/notifications?limit=20", {
          method: "GET",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
          },
          cache: "no-store",
        });
        if (!response.ok) return;

        const payload = await response.json().catch(() => null);
        if (!payload || payload.ok !== true) return;

        const parsedItems = Array.isArray(payload.notifications)
          ? payload.notifications
              .map((item: unknown) => parseNotificationItem(item))
              .filter((item: HeaderNotificationItem | null): item is HeaderNotificationItem => Boolean(item))
          : [];

        setNotifications(parsedItems);
        setUnreadNotificationCount(normalizeCount(payload.unreadCount));
      } finally {
        if (!silent) {
          setIsLoadingNotifications(false);
        }
      }
    },
    [sessionUser]
  );

  const loadMessageUnreadCount = useCallback(async () => {
    if (!sessionUser || !sessionUser.id) {
      setUnreadMessageCount(0);
      setMessageWidgetEnabled(true);
      return;
    }

    try {
      const response = await fetch("/messages/unread-count?format=json", {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          setMessageWidgetEnabled(false);
          setUnreadMessageCount(0);
        }
        return;
      }

      const payload = await response.json().catch(() => null);
      if (!payload || payload.ok !== true) return;

      setMessageWidgetEnabled(true);
      setUnreadMessageCount(normalizeCount(payload.unreadCount));
    } catch (_err) {
      // ignore
    }
  }, [sessionUser]);

  const markNotificationRead = useCallback(
    async (notificationId: number): Promise<boolean> => {
      const safeId = Number(notificationId);
      if (!Number.isFinite(safeId) || safeId <= 0) return false;

      try {
        const response = await fetch(`/notifications/${encodeURIComponent(String(Math.floor(safeId)))}/read`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
        if (!response.ok) return false;

        const payload = await response.json().catch(() => null);
        if (!payload || payload.ok !== true) return false;

        setNotifications((prev) =>
          prev.map((item) =>
            item.id === Math.floor(safeId)
              ? {
                  ...item,
                  isRead: true,
                }
              : item
          )
        );
        setUnreadNotificationCount(normalizeCount(payload.unreadCount));
        return true;
      } catch (_err) {
        return false;
      }
    },
    []
  );

  const markAllNotificationsRead = useCallback(async () => {
    if (!sessionUser || !sessionUser.id || unreadNotificationCount <= 0) return;

    try {
      const response = await fetch("/notifications/read-all", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) return;

      const payload = await response.json().catch(() => null);
      if (!payload || payload.ok !== true) return;

      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
      setUnreadNotificationCount(0);
    } catch (_err) {
      // ignore
    }
  }, [sessionUser, unreadNotificationCount]);

  useEffect(() => {
    notificationMenuOpenRef.current = notificationMenuOpen;
    if (notificationMenuOpen && sessionUser && sessionUser.id) {
      void loadNotifications();
    }
  }, [notificationMenuOpen, sessionUser, loadNotifications]);

  useEffect(() => {
    if (!sessionUser || !sessionUser.id) {
      setNotifications([]);
      setUnreadNotificationCount(0);
      setUnreadMessageCount(0);
      setMessageWidgetEnabled(true);
      closeNotificationMenus();
      return;
    }

    let disposed = false;
    const refreshCounts = () => {
      if (disposed) return;
      void loadNotifications({ silent: true });
      void loadMessageUnreadCount();
    };

    refreshCounts();

    const pollTimer = window.setInterval(() => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      refreshCounts();
    }, HEADER_POLL_INTERVAL_MS);

    let notificationStream: EventSource | null = null;
    let messageStream: EventSource | null = null;
    if (typeof window.EventSource === "function") {
      notificationStream = new window.EventSource("/notifications/stream");
      const handleNotificationStreamEvent = (event: MessageEvent) => {
        if (disposed) return;
        let payload: Record<string, unknown> | null = null;
        if (event && typeof event.data === "string" && event.data) {
          try {
            payload = JSON.parse(event.data) as Record<string, unknown>;
          } catch (_err) {
            payload = null;
          }
        }
        const unread = normalizeCount(payload && payload.unreadCount);
        setUnreadNotificationCount(unread);
        if (notificationMenuOpenRef.current) {
          void loadNotifications({ silent: true });
        }
      };

      notificationStream.addEventListener("ready", handleNotificationStreamEvent as EventListener);
      notificationStream.addEventListener("notification", handleNotificationStreamEvent as EventListener);

      if (messageWidgetEnabled) {
        messageStream = new window.EventSource("/messages/stream");
        const refreshMessages = () => {
          if (disposed) return;
          void loadMessageUnreadCount();
        };
        messageStream.addEventListener("ready", refreshMessages as EventListener);
        messageStream.addEventListener("chat", refreshMessages as EventListener);
      }
    }

    const onFocus = () => {
      if (disposed) return;
      refreshCounts();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        onFocus();
      }
    };
    const onMessagesViewed = () => {
      if (disposed) return;
      void loadMessageUnreadCount();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    window.addEventListener("bfang:messages:viewed", onMessagesViewed as EventListener);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(pollTimer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
      window.removeEventListener("bfang:messages:viewed", onMessagesViewed as EventListener);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (notificationStream) {
        try {
          notificationStream.close();
        } catch (_err) {
          // ignore
        }
      }
      if (messageStream) {
        try {
          messageStream.close();
        } catch (_err) {
          // ignore
        }
      }
    };
  }, [sessionUser, messageWidgetEnabled, loadNotifications, loadMessageUnreadCount, closeNotificationMenus]);

  const handleLogin = () => {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    openAuthProviderDialog(next || "/forum");
  };

  const handleProviderSignIn = (provider: "google" | "discord") => {
    const safeNext = (authDialogNext || "").trim() || "/forum";
    window.location.assign(`/auth/${encodeURIComponent(provider)}?next=${encodeURIComponent(safeNext)}`);
  };

  const handleLogout = async () => {
    const maybeAuth = (window as Window & { BfangAuth?: { signOut?: () => Promise<void> } }).BfangAuth;
    if (maybeAuth && typeof maybeAuth.signOut === "function") {
      await maybeAuth.signOut().catch(() => null);
      setSessionUser(null);
      return;
    }

    await fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    }).catch(() => null);

    setSessionUser(null);
  };

  const openNotification = async (item: HeaderNotificationItem) => {
    if (!item || !item.url) return;
    if (!item.isRead) {
      await markNotificationRead(item.id).catch(() => null);
    }
    closeNotificationMenus();
    window.location.assign(item.url);
  };

  const renderUnreadBadge = (count: number) => {
    if (count <= 0) return null;
    return (
      <span className="absolute -top-1 -right-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
        {count > 99 ? "99+" : count}
      </span>
    );
  };

  const renderNotificationActorAvatar = (item: HeaderNotificationItem) => {
    const fallbackLetter = (item.actorName || item.message || "U").charAt(0).toUpperCase();
    if (item.actorAvatarUrl) {
      return (
        <img
          src={item.actorAvatarUrl}
          alt={item.actorName || "Thành viên"}
          className="h-8 w-8 shrink-0 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      );
    }

    return (
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
        {fallbackLetter}
      </span>
    );
  };

  const renderNotificationMenuContent = () => (
    <DropdownMenuContent align="end" className="w-[320px] p-0">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-foreground">Thông báo</span>
        <button
          type="button"
          onClick={() => {
            void markAllNotificationsRead();
          }}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          disabled={unreadNotificationCount <= 0}
        >
          Đánh dấu đã đọc
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto p-1.5">
        {isLoadingNotifications ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Đang tải thông báo...</p>
        ) : notifications.length > 0 ? (
          notifications.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                void openNotification(item);
              }}
              className={`w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent ${
                item.isRead ? "" : "bg-secondary/60"
              }`}
            >
              <div className="flex items-start gap-2.5">
                {renderNotificationActorAvatar(item)}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">{item.message}</p>
                  {item.preview ? <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{item.preview}</p> : null}
                  {item.createdAtText ? <p className="mt-1 text-[10px] text-muted-foreground">{item.createdAtText}</p> : null}
                </div>
              </div>
            </button>
          ))
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground">Chưa có thông báo nào.</p>
        )}
      </div>
    </DropdownMenuContent>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <a href="/" className="flex items-center gap-1.5 shrink-0">
          <span className="text-base font-bold tracking-wide text-primary">{siteBranding.brandMark}</span>
          <span className="text-sm font-semibold text-foreground">{siteBranding.brandSubmark}</span>
        </a>

        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = link.href === "/" ? location.pathname === "/" : location.pathname.startsWith(link.href);
            const className = `px-3 py-1.5 rounded-md text-sm transition-colors ${
              isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`;

            if (link.external) {
              return (
                <a key={link.href} href={link.href} className={className}>
                  {link.label}
                </a>
              );
            }

            return (
              <Link key={link.href} to={link.href} className={className}>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <form className="hidden md:flex flex-1 max-w-md" onSubmit={handleSearchSubmit}>
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm kiếm bài viết, chủ đề..."
              className="pl-9 bg-secondary border-none h-9 text-sm"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </div>
        </form>

        <div className="flex-1 md:hidden" />

        {!isLoadingSession && sessionUser && messageWidgetEnabled ? (
          <a
            href="/messages"
            className="sm:hidden relative p-2 text-muted-foreground hover:text-foreground transition-colors"
            title="Tin nhắn"
          >
            <MessageCircle className="h-5 w-5" />
            {renderUnreadBadge(unreadMessageCount)}
          </a>
        ) : null}

        {!isLoadingSession && sessionUser ? (
          <DropdownMenu
            open={mobileNotificationMenuOpen}
            onOpenChange={(open) => {
              setMobileNotificationMenuOpen(open);
              if (open) {
                setDesktopNotificationMenuOpen(false);
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="sm:hidden relative p-2 text-muted-foreground hover:text-foreground transition-colors"
                title="Thông báo"
              >
                <Bell className="h-5 w-5" />
                {renderUnreadBadge(unreadNotificationCount)}
              </button>
            </DropdownMenuTrigger>
            {renderNotificationMenuContent()}
          </DropdownMenu>
        ) : null}

        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className="md:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Search className="h-5 w-5" />
        </button>

        <div className="hidden sm:flex items-center gap-2">
          {!isLoadingSession && sessionUser ? (
            <>
              {messageWidgetEnabled ? (
                <a
                  href="/messages"
                  className="relative rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Tin nhắn"
                >
                  <MessageCircle className="h-4 w-4" />
                  {renderUnreadBadge(unreadMessageCount)}
                </a>
              ) : null}

              <DropdownMenu
                open={desktopNotificationMenuOpen}
                onOpenChange={(open) => {
                  setDesktopNotificationMenuOpen(open);
                  if (open) {
                    setMobileNotificationMenuOpen(false);
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="relative rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title="Thông báo"
                  >
                    <Bell className="h-4 w-4" />
                    {renderUnreadBadge(unreadNotificationCount)}
                  </button>
                </DropdownMenuTrigger>
                {renderNotificationMenuContent()}
              </DropdownMenu>

              <a
                href="/account"
                className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="h-7 w-7 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {(displayName.charAt(0) || "U").toUpperCase()}
                  </span>
                )}
                <span className="max-w-[140px] truncate">{displayName}</span>
              </a>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={handleLogout}>
                Đăng xuất
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleLogin}>
              Đăng nhập
            </Button>
          )}
        </div>

        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="sm:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {searchOpen && (
        <div className="md:hidden border-t border-border p-3">
          <form className="relative" onSubmit={handleSearchSubmit}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm kiếm bài viết, chủ đề..."
              className="pl-9 bg-secondary border-none h-9 text-sm"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              autoFocus
            />
          </form>
        </div>
      )}

      {mobileMenuOpen && (
        <div className="sm:hidden border-t border-border p-3 flex flex-col gap-1">
          {!isLoadingSession && sessionUser ? (
            <>
              <a
                href="/account"
                className="block rounded-xl border border-border/70 bg-secondary/40 px-3 py-2.5 transition-colors hover:bg-secondary/60"
                onClick={() => setMobileMenuOpen(false)}
              >
                <div className="flex items-center gap-2.5">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={displayName}
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                      {(displayName.charAt(0) || "U").toUpperCase()}
                    </span>
                  )}

                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{displayName}</span>
                    {profileHandle ? (
                      <span className="block truncate text-xs text-muted-foreground">{profileHandle}</span>
                    ) : null}
                  </span>
                </div>
              </a>

              <Link
                to="/saved-posts"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Đã lưu
              </Link>

              <div className="border-t border-border my-1" />

              {navLinks.map((link) => {
                const className = "px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";
                if (link.external) {
                  return (
                    <a
                      key={link.href}
                      href={link.href}
                      className={className}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {link.label}
                    </a>
                  );
                }

                return (
                  <Link
                    key={link.href}
                    to={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={className}
                  >
                    {link.label}
                  </Link>
                );
              })}

              <div className="border-t border-border my-1" />

              <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={handleLogout}>
                Đăng xuất
              </Button>
            </>
          ) : (
            <>
              {navLinks.map((link) => {
                const className = "px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";
                if (link.external) {
                  return (
                    <a
                      key={link.href}
                      href={link.href}
                      className={className}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {link.label}
                    </a>
                  );
                }

                return (
                  <Link
                    key={link.href}
                    to={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={className}
                  >
                    {link.label}
                  </Link>
                );
              })}

              <div className="border-t border-border my-1" />

              <Button size="sm" className="justify-start" onClick={handleLogin}>
                Đăng nhập
              </Button>
            </>
          )}
        </div>
      )}

      <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle>Đăng nhập</DialogTitle>
            <DialogDescription>Chọn phương thức đăng nhập để tiếp tục.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Button
              type="button"
              variant="outline"
              className="justify-start gap-2"
              onClick={() => handleProviderSignIn("google")}
            >
              <img src="/images/google.svg" alt="" className="h-4 w-4" aria-hidden="true" />
              <span>Tiếp tục với Google</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              className="justify-start gap-2"
              onClick={() => handleProviderSignIn("discord")}
            >
              <img src="/images/discord.svg" alt="" className="h-4 w-4" aria-hidden="true" />
              <span>Tiếp tục với Discord</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
