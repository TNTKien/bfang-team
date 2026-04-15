export type SiteBranding = {
  siteName: string;
  brandMark: string;
  brandSubmark: string;
  aboutNavLabel: string;
  footerYear: string;
  newsPageEnabled: boolean;
  shareOrigin: string;
};

const DEFAULT_SITE_BRANDING: SiteBranding = {
  siteName: "BFANG Team",
  brandMark: "BFANG",
  brandSubmark: "Team",
  aboutNavLabel: "Về BFANG",
  footerYear: String(new Date().getFullYear()),
  newsPageEnabled: true,
  shareOrigin: "",
};

const readText = (value: unknown, fallback: string): string => {
  const text = String(value == null ? "" : value).trim();
  return text || fallback;
};

const readBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
};

export const getSiteBranding = (): SiteBranding => {
  if (typeof window === "undefined") {
    return DEFAULT_SITE_BRANDING;
  }

  const runtimeWindow = window as typeof window & {
    __SITE_CONFIG?: {
      branding?: {
        siteName?: unknown;
        brandMark?: unknown;
        brandSubmark?: unknown;
        aboutNavLabel?: unknown;
        footerYear?: unknown;
      };
      features?: {
        newsPageEnabled?: unknown;
      };
    };
    __FORUM_META?: {
      newsPageEnabled?: unknown;
      shareOrigin?: unknown;
    };
  };

  const branding =
    runtimeWindow.__SITE_CONFIG && runtimeWindow.__SITE_CONFIG.branding
      ? runtimeWindow.__SITE_CONFIG.branding
      : {};
  const newsPageEnabled = readBoolean(
    runtimeWindow.__FORUM_META && Object.prototype.hasOwnProperty.call(runtimeWindow.__FORUM_META, "newsPageEnabled")
      ? runtimeWindow.__FORUM_META.newsPageEnabled
      : runtimeWindow.__SITE_CONFIG && runtimeWindow.__SITE_CONFIG.features
        ? runtimeWindow.__SITE_CONFIG.features.newsPageEnabled
        : undefined,
    DEFAULT_SITE_BRANDING.newsPageEnabled
  );

  const siteName = readText(branding.siteName, DEFAULT_SITE_BRANDING.siteName);
  const shareOrigin = readText(
    runtimeWindow.__FORUM_META && Object.prototype.hasOwnProperty.call(runtimeWindow.__FORUM_META, "shareOrigin")
      ? runtimeWindow.__FORUM_META.shareOrigin
      : "",
    DEFAULT_SITE_BRANDING.shareOrigin
  );
  const brandMark = readText(branding.brandMark, siteName.split(" ")[0] || DEFAULT_SITE_BRANDING.brandMark);
  const brandSubmark = readText(
    branding.brandSubmark,
    siteName.replace(brandMark, "").trim() || DEFAULT_SITE_BRANDING.brandSubmark
  );

  return {
    siteName,
    brandMark,
    brandSubmark,
    aboutNavLabel: readText(branding.aboutNavLabel, `Về ${brandMark}`),
    footerYear: readText(branding.footerYear, DEFAULT_SITE_BRANDING.footerYear),
    newsPageEnabled,
    shareOrigin,
  };
};
