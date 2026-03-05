const fs = require("fs");

const toText = (value, fallback = "") => {
  const text = (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
  if (text) return text;
  return (fallback == null ? "" : String(fallback)).replace(/\s+/g, " ").trim();
};

const toTextList = (value, fallback = []) => {
  const source = Array.isArray(value) ? value : fallback;
  return source
    .map((item) => toText(item, ""))
    .filter(Boolean);
};

const normalizeSiteConfig = (rawInput) => {
  const input = rawInput && typeof rawInput === "object" ? rawInput : {};
  const brandingInput = input.branding && typeof input.branding === "object" ? input.branding : {};
  const homepageInput = input.homepage && typeof input.homepage === "object" ? input.homepage : {};
  const contactInput = input.contact && typeof input.contact === "object" ? input.contact : {};
  const seoInput = input.seo && typeof input.seo === "object" ? input.seo : {};
  const adminInput = input.admin && typeof input.admin === "object" ? input.admin : {};

  const siteName = toText(brandingInput.siteName, "BFANG Team") || "BFANG Team";
  const inferredBrandMark = toText(siteName.split(" ")[0], "BFANG") || "BFANG";
  const brandMark = toText(brandingInput.brandMark, inferredBrandMark) || inferredBrandMark;
  const inferredSubmark = toText(siteName.replace(brandMark, "").trim(), "Team") || "Team";
  const brandSubmark = toText(brandingInput.brandSubmark, inferredSubmark) || inferredSubmark;
  const currentYear = String(new Date().getFullYear());

  return {
    branding: {
      siteName,
      brandMark,
      brandSubmark,
      aboutNavLabel: toText(brandingInput.aboutNavLabel, `Về ${brandMark}`),
      heroKicker: toText(brandingInput.heroKicker, `${siteName} Manga`),
      updateTag: toText(brandingInput.updateTag, brandMark),
      footerYear: toText(brandingInput.footerYear, currentYear)
    },
    homepage: {
      welcomeMessage: toText(
        homepageInput.welcomeMessage,
        `Chào mừng bạn đến với website của ${siteName}.`
      ),
      introduction: toText(
        homepageInput.introduction,
        `${siteName} là nhóm dịch manga hoạt động từ năm 2019 với hàng chục đầu truyện và hàng trăm chương truyện.`
      ),
      aboutTitle: toText(homepageInput.aboutTitle, `Về ${siteName}`),
      foundedYear: toText(homepageInput.foundedYear, "2019"),
      contentStandardsTitle: toText(homepageInput.contentStandardsTitle, "Tiêu chuẩn nội dung"),
      contentStandards: toTextList(homepageInput.contentStandards, [
        "Chúng tôi chỉ làm manga, và thể loại yêu thích nhất là Drama.",
        "Các dự án được dịch thuật từ tiếng Anh hoặc tiếng Nhật và sử dụng Adobe Photoshop để biên tập."
      ]),
      contactTitle: toText(homepageInput.contactTitle, "Kênh liên hệ")
    },
    contact: {
      facebookUrl: toText(contactInput.facebookUrl, "https://facebook.com/Bfangteam/"),
      facebookLabel: toText(contactInput.facebookLabel, "facebook.com/Bfangteam"),
      discordUrl: toText(contactInput.discordUrl, "https://discord.moetruyen.net/"),
      discordLabel: toText(contactInput.discordLabel, "discord.moetruyen.net")
    },
    seo: {
      defaultDescription: toText(seoInput.defaultDescription, `${siteName} - nhóm dịch truyện tranh`),
      homepageTitle: toText(seoInput.homepageTitle, `${siteName} - nhóm dịch truyện tranh`),
      homepageDescription: toText(
        seoInput.homepageDescription,
        `Đọc truyện tranh online và manga tiếng Việt mới nhất tại ${siteName}, cập nhật chương liên tục mỗi ngày.`
      )
    },
    admin: {
      teamManageLabel: toText(adminInput.teamManageLabel, `${siteName} Manage`),
      adminLabel: toText(adminInput.adminLabel, `${brandMark} Admin`),
      loginNote: toText(adminInput.loginNote, `Truy cập dành riêng cho ${siteName}.`)
    }
  };
};

const loadSiteConfig = (filePath) => {
  const targetPath = (filePath || "").toString().trim();
  if (!targetPath || !fs.existsSync(targetPath)) {
    return normalizeSiteConfig({});
  }

  try {
    const source = fs.readFileSync(targetPath, "utf8");
    const parsed = source ? JSON.parse(source) : {};
    return normalizeSiteConfig(parsed);
  } catch (error) {
    console.warn(`Cannot read site config from ${targetPath}.`, error);
    return normalizeSiteConfig({});
  }
};

module.exports = {
  loadSiteConfig,
  normalizeSiteConfig
};
