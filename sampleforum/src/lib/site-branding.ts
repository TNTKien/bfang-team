export type SiteBranding = {
  siteName: string;
  brandMark: string;
  brandSubmark: string;
  aboutNavLabel: string;
  footerYear: string;
};

const DEFAULT_SITE_BRANDING: SiteBranding = {
  siteName: "BFANG Team",
  brandMark: "BFANG",
  brandSubmark: "Team",
  aboutNavLabel: "Về BFANG",
  footerYear: String(new Date().getFullYear()),
};

const readText = (value: unknown, fallback: string): string => {
  const text = String(value == null ? "" : value).trim();
  return text || fallback;
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
    };
  };

  const branding =
    runtimeWindow.__SITE_CONFIG && runtimeWindow.__SITE_CONFIG.branding
      ? runtimeWindow.__SITE_CONFIG.branding
      : {};

  const siteName = readText(branding.siteName, DEFAULT_SITE_BRANDING.siteName);
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
  };
};
