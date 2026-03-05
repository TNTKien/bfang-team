import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import type { AuthSessionUser } from "@/types/forum";
import { fetchAuthSession } from "@/lib/forum-api";
import { getSiteBranding } from "@/lib/site-branding";

type SiteHeaderProps = {
  onSessionChange?: (user: AuthSessionUser | null) => void;
};

type NavItem = {
  label: string;
  href: string;
  external?: boolean;
};

export function SiteHeader({ onSessionChange }: SiteHeaderProps) {
  const location = useLocation();
  const [sessionUser, setSessionUser] = useState<AuthSessionUser | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const siteBranding = useMemo(() => getSiteBranding(), []);
  const navItems = useMemo<NavItem[]>(
    () => [
      { label: "Diễn đàn", href: "/" },
      { label: "Toàn bộ truyện", href: "/manga", external: true },
      { label: "Đăng truyện", href: "/publish", external: true },
      { label: siteBranding.aboutNavLabel, href: "/#about", external: true },
    ],
    [siteBranding.aboutNavLabel]
  );

  const loadSession = async () => {
    try {
      const payload = await fetchAuthSession();
      const user = payload && payload.session && payload.session.user ? payload.session.user : null;
      setSessionUser(user);
      if (typeof onSessionChange === "function") {
        onSessionChange(user);
      }
    } catch (_error) {
      setSessionUser(null);
      if (typeof onSessionChange === "function") {
        onSessionChange(null);
      }
    } finally {
      setIsLoadingSession(false);
    }
  };

  useEffect(() => {
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayName = useMemo(() => {
    if (!sessionUser) return "";
    const metadata = sessionUser.user_metadata && typeof sessionUser.user_metadata === "object"
      ? sessionUser.user_metadata
      : null;
    return (
      (metadata && (metadata.display_name || metadata.name)
        ? String(metadata.display_name || metadata.name).trim()
        : "") ||
      (sessionUser.email || "").toString().trim() ||
      "Tài khoản"
    );
  }, [sessionUser]);

  const avatarUrl = useMemo(() => {
    if (!sessionUser) return "";
    const metadata = sessionUser.user_metadata && typeof sessionUser.user_metadata === "object"
      ? sessionUser.user_metadata
      : null;
    return (metadata && (metadata.avatar_url || metadata.picture)
      ? String(metadata.avatar_url || metadata.picture).trim()
      : "");
  }, [sessionUser]);

  const isNavActive = (item: NavItem) => {
    if (item.external) return false;
    if (item.href === "/") {
      return location.pathname === "/" || location.pathname.startsWith("/post/");
    }
    return location.pathname.startsWith(item.href);
  };

  const handleLogout = async () => {
    try {
      await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
      });
    } catch (_error) {
      // ignore network errors and still reset local state
    }

    setSessionUser(null);
    if (typeof onSessionChange === "function") {
      onSessionChange(null);
    }
  };

  const renderNavItem = (item: NavItem, compact = false) => {
    const sharedClass = compact
      ? "block rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      : `rounded-md px-3 py-2 text-sm transition-colors ${
          isNavActive(item)
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`;

    if (item.external) {
      return (
        <a key={item.href} className={sharedClass} href={item.href}>
          {item.label}
        </a>
      );
    }

    return (
      <Link key={item.href} className={sharedClass} to={item.href}>
        {item.label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <a className="flex shrink-0 items-center gap-2" href="/">
          <img alt={siteBranding.brandMark} className="h-6 w-6" src="/logobfang.svg" />
          <span className="text-base font-bold tracking-wide text-primary">{siteBranding.brandMark}</span>
          <span className="text-sm font-semibold text-foreground">{siteBranding.brandSubmark}</span>
        </a>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => renderNavItem(item))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {!isLoadingSession && sessionUser ? (
            <>
              <a
                className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
                href="/account"
              >
                {avatarUrl ? (
                  <img
                    alt={displayName}
                    className="h-7 w-7 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                    src={avatarUrl}
                  />
                ) : (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {displayName.charAt(0).toUpperCase() || "U"}
                  </span>
                )}
                <span className="max-w-[160px] truncate">{displayName}</span>
              </a>
              <button
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={handleLogout}
                type="button"
              >
                Đăng xuất
              </button>
            </>
          ) : (
            <a
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              href="/auth/google"
            >
              Đăng nhập
            </a>
          )}
        </div>

        <button
          aria-label={mobileMenuOpen ? "Đóng menu" : "Mở menu"}
          className="ml-auto inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
          onClick={() => setMobileMenuOpen((value) => !value)}
          type="button"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileMenuOpen ? (
        <div className="border-t border-border px-4 pb-4 pt-2 md:hidden">
          <nav className="space-y-1">{navItems.map((item) => renderNavItem(item, true))}</nav>
          <div className="mt-3 border-t border-border pt-3">
            {!isLoadingSession && sessionUser ? (
              <div className="space-y-2">
                <a
                  className="block rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  href="/account"
                >
                  Tài khoản: {displayName}
                </a>
                <button
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={handleLogout}
                  type="button"
                >
                  Đăng xuất
                </button>
              </div>
            ) : (
              <a
                className="block rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                href="/auth/google"
              >
                Đăng nhập
              </a>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
