const truncateCardTitle = (value) => {
  const text = (value || "").toString().replace(/\s+/g, " ").trim();
  if (!text) return "";

  const maxWords = 4;
  const maxChars = 24;
  const words = text.split(" ").filter(Boolean);
  let shortened = words.length > maxWords ? words.slice(0, maxWords).join(" ") : text;
  if (shortened.length > maxChars) {
    shortened = shortened.slice(0, maxChars).trimEnd();
  }

  return shortened.length < text.length ? `${shortened}...` : shortened;
};

const appendCoverVariant = (url, width, height, quality) => {
  const raw = (url || "").toString().trim();
  const parsedWidth = Number(width);
  const parsedHeight = Number(height);
  const parsedQuality = Number(quality);
  if (!raw || !Number.isFinite(parsedWidth) || parsedWidth <= 0) return raw;

  const params = [`w=${Math.floor(parsedWidth)}`];
  if (Number.isFinite(parsedHeight) && parsedHeight > 0) {
    params.push(`h=${Math.floor(parsedHeight)}`);
  }
  if (Number.isFinite(parsedQuality) && parsedQuality > 0) {
    params.push(`q=${Math.floor(parsedQuality)}`);
  }

  const separator = raw.includes("?") ? "&" : "?";
  return `${raw}${separator}${params.join("&")}`;
};

const COVER_HEIGHT_RATIO = 4 / 3;
const COVER_HEADROOM_PX = 2;

const buildSafeCoverSources = (baseUrl, options = {}) => {
  const slotWidths = Array.isArray(options.slotWidths) ? options.slotWidths : [];
  const dprLevels = Array.isArray(options.dprLevels) && options.dprLevels.length ? options.dprLevels : [1, 2];
  const quality = Number.isFinite(Number(options.quality)) ? Number(options.quality) : 95;
  const maxWidth = Number.isFinite(Number(options.maxWidth)) ? Number(options.maxWidth) : 1200;
  const defaultWidthOption = Number(options.defaultWidth);
  const candidates = new Set();

  slotWidths.forEach((slotWidth) => {
    const parsedSlotWidth = Number(slotWidth);
    if (!Number.isFinite(parsedSlotWidth) || parsedSlotWidth <= 0) return;

    dprLevels.forEach((density) => {
      const parsedDensity = Number(density);
      if (!Number.isFinite(parsedDensity) || parsedDensity <= 0) return;
      const safeWidth = Math.ceil(parsedSlotWidth * parsedDensity) + COVER_HEADROOM_PX;
      const clampedWidth = Math.min(Math.max(safeWidth, 120), maxWidth);
      candidates.add(clampedWidth);
    });
  });

  const widths = [...candidates].sort((left, right) => left - right);
  if (!widths.length) {
    return {
      src: baseUrl,
      srcset: ""
    };
  }

  const srcset = widths
    .map((width) => {
      const height = Math.ceil(width * COVER_HEIGHT_RATIO);
      return `${appendCoverVariant(baseUrl, width, height, quality)} ${width}w`;
    })
    .join(", ");

  const defaultWidth = Number.isFinite(defaultWidthOption) && defaultWidthOption > 0
    ? widths.find((width) => width >= defaultWidthOption) || widths[widths.length - 1]
    : widths[0];
  const defaultHeight = Math.ceil(defaultWidth * COVER_HEIGHT_RATIO);

  return {
    src: appendCoverVariant(baseUrl, defaultWidth, defaultHeight, quality),
    srcset
  };
};

module.exports = {
  truncateCardTitle,
  appendCoverVariant,
  buildSafeCoverSources
};
