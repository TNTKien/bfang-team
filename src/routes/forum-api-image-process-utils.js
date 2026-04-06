const createForumApiImageProcessUtils = ({
  maxDimension,
  maxHeight,
  maxSourceBytes,
  sharp,
}) => {
  const createProcessingError = (code) => {
    const err = new Error(code);
    err.code = code;
    return err;
  };

  const processForumDataUrlImage = async (dataUrl) => {
    const safeDataUrl = dataUrl == null ? "" : String(dataUrl).trim();
    const match = safeDataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) {
      throw createProcessingError("invalid_data_url");
    }

    const base64Payload = String(match[1] || "").replace(/\s+/g, "");
    if (!base64Payload) {
      throw createProcessingError("invalid_base64_payload");
    }

    let sourceBuffer = null;
    try {
      sourceBuffer = Buffer.from(base64Payload, "base64");
    } catch (_err) {
      sourceBuffer = null;
    }
    if (!sourceBuffer || !sourceBuffer.length) {
      throw createProcessingError("invalid_base64_payload");
    }

    if (sourceBuffer.length > maxSourceBytes) {
      throw createProcessingError("source_too_large");
    }

    let metadata = null;
    try {
      metadata = await sharp(sourceBuffer, { limitInputPixels: 70000000 }).metadata();
    } catch (_err) {
      metadata = null;
    }

    const sourceWidth = Number(metadata && metadata.width) || 0;
    const sourceHeight = Number(metadata && metadata.height) || 0;
    if (!sourceWidth || !sourceHeight) {
      throw createProcessingError("invalid_dimensions");
    }
    if (sourceWidth > maxDimension || sourceHeight > maxDimension) {
      throw createProcessingError("dimension_too_large");
    }

    let webpBuffer = null;
    try {
      let pipeline = sharp(sourceBuffer)
        .rotate()
        .resize({
          height: maxHeight,
          fit: "inside",
          withoutEnlargement: true,
        });

      if (sourceHeight <= maxHeight) {
        pipeline = sharp(sourceBuffer).rotate();
      }

      webpBuffer = await pipeline.webp({ quality: 85, effort: 6 }).toBuffer();
    } catch (_err) {
      webpBuffer = null;
    }

    if (!webpBuffer || !webpBuffer.length) {
      throw createProcessingError("process_failed");
    }

    return webpBuffer;
  };

  return {
    processForumDataUrlImage,
  };
};

module.exports = createForumApiImageProcessUtils;
