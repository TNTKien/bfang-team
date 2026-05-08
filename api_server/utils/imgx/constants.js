"use strict";

const IMGX_MAGIC = "IMGX";
const IMGX_MAGIC_BYTES = Uint8Array.from([0x49, 0x4d, 0x47, 0x58]);
const IMGX_VERSION = 2;
const IMGX_HEADER_BYTES = 13;
const IMGX_SESSION_KEY_BYTES = 32;

module.exports = {
  IMGX_MAGIC,
  IMGX_MAGIC_BYTES,
  IMGX_VERSION,
  IMGX_HEADER_BYTES,
  IMGX_SESSION_KEY_BYTES
};
