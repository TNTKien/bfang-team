"use strict";

const CHAPTER_PAGE_MAX_HEIGHT = 1800;
const CHAPTER_PAGE_WEBP_QUALITY = 77;
const WEBTOON_TARGET_WIDTH = 1000;

const buildChapterPageResizeOptions = ({ width, isWebtoon }) => {
  if (isWebtoon) {
    if (Number.isFinite(width) && width > WEBTOON_TARGET_WIDTH) {
      return {
        width: WEBTOON_TARGET_WIDTH,
        withoutEnlargement: true
      };
    }
    return null;
  }

  return {
    height: CHAPTER_PAGE_MAX_HEIGHT,
    withoutEnlargement: true
  };
};

const createConvertChapterPageToWebp = ({ sharp }) => {
  if (typeof sharp !== "function") {
    throw new Error("sharp instance is required");
  }

  return async (inputBuffer, options = {}) => {
    if (!inputBuffer) return null;

    const pipeline = sharp(inputBuffer).rotate();
    const metadata = await pipeline.metadata();
    const width = Number(metadata && metadata.width);
    const resizeOptions = buildChapterPageResizeOptions({
      width,
      isWebtoon: Boolean(options && options.isWebtoon)
    });
    const transformed = resizeOptions ? pipeline.resize(resizeOptions) : pipeline;

    return transformed.webp({ quality: CHAPTER_PAGE_WEBP_QUALITY, effort: 6 }).toBuffer();
  };
};

module.exports = {
  CHAPTER_PAGE_MAX_HEIGHT,
  CHAPTER_PAGE_WEBP_QUALITY,
  createConvertChapterPageToWebp
};
