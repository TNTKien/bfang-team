"use strict";

const {
  IMGX_HEADER_BYTES,
  IMGX_MAGIC,
  IMGX_MAGIC_BYTES,
  IMGX_VERSION
} = require("./constants");

const assertValidDimensions = (width, height) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid IMGX dimensions: ${width}x${height}`);
  }
};

const createImgxHeader = (width, height) => {
  assertValidDimensions(width, height);
  const header = new Uint8Array(IMGX_HEADER_BYTES);
  header.set(IMGX_MAGIC_BYTES, 0);
  header[4] = IMGX_VERSION;
  const view = new DataView(header.buffer);
  view.setUint32(5, width, false);
  view.setUint32(9, height, false);
  return header;
};

const parseImgxHeader = (binary) => {
  if (!binary || binary.byteLength < IMGX_HEADER_BYTES) {
    throw new Error(`IMGX file too short: ${binary && binary.byteLength ? binary.byteLength : 0} bytes`);
  }
  for (let index = 0; index < IMGX_MAGIC_BYTES.length; index += 1) {
    if (binary[index] !== IMGX_MAGIC_BYTES[index]) {
      throw new Error("Invalid IMGX magic header");
    }
  }
  const version = binary[4];
  if (version !== IMGX_VERSION) {
    throw new Error(`Unsupported IMGX version: ${version}`);
  }
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const width = view.getUint32(5, false);
  const height = view.getUint32(9, false);
  assertValidDimensions(width, height);
  const payloadBytes = binary.byteLength - IMGX_HEADER_BYTES;
  if (payloadBytes <= 0) {
    throw new Error("IMGX payload must contain encoded WebP bytes");
  }
  return { magic: IMGX_MAGIC, version, width, height, payloadBytes };
};

module.exports = {
  assertValidDimensions,
  createImgxHeader,
  parseImgxHeader
};
