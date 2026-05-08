"use strict";

const { createHash, createHmac, randomBytes, timingSafeEqual } = require("crypto");
const { IMGX_HEADER_BYTES, IMGX_SESSION_KEY_BYTES } = require("./constants");
const { createImgxHeader, parseImgxHeader } = require("./format");
const { shuffleBytesInPlace, unshuffleBytesInPlace, xorInPlace } = require("./prng");

const imageIdFromWebp = (webpBytes) => {
  if (!webpBytes || webpBytes.byteLength <= 0) {
    throw new Error("WebP bytes required for IMGX image id");
  }
  return createHash("sha256").update(webpBytes).digest("hex").slice(0, 32);
};

const imageIdFromStorageKey = (storageKey) => {
  const safeKey = (storageKey || "").toString().trim().replace(/^\/+/, "");
  if (!safeKey) throw new Error("storageKey is required for IMGX image id");
  return createHash("sha256").update(safeKey).digest("hex").slice(0, 32);
};

const deriveImgxKey = (imageId, secret) => {
  const safeImageId = (imageId || "").toString().trim();
  const safeSecret = (secret || "").toString();
  if (!safeImageId) throw new Error("imageId is required for IMGX key derivation");
  if (!safeSecret.trim()) throw new Error("IMGX secret is required for key derivation");
  return createHash("sha256").update(safeImageId).update(safeSecret).digest();
};

const encodeImgx = ({ webp, width, height, imageId, secret }) => {
  if (!webp || webp.byteLength <= 0) {
    throw new Error("IMGX WebP payload must not be empty");
  }
  const key = deriveImgxKey(imageId, secret);
  const payload = Buffer.from(webp);
  xorInPlace(payload, key);
  shuffleBytesInPlace(payload, key);
  return Buffer.concat([Buffer.from(createImgxHeader(width, height)), payload]);
};

const decodeImgxWithKey = (binary, decodeKey) => {
  const header = parseImgxHeader(binary);
  if (!decodeKey || decodeKey.byteLength !== IMGX_SESSION_KEY_BYTES) {
    throw new Error("IMGX decode requires a 32-byte key");
  }
  const payload = Uint8Array.from(binary.subarray(IMGX_HEADER_BYTES));
  unshuffleBytesInPlace(payload, decodeKey);
  xorInPlace(payload, decodeKey);
  return { ...header, webp: payload };
};

const decodeImgxForVerification = (binary, imageId, secret) =>
  decodeImgxWithKey(binary, deriveImgxKey(imageId, secret));

const base64UrlEncode = (bytes) => Buffer.from(bytes).toString("base64url");
const base64UrlDecode = (text) => Buffer.from((text || "").toString(), "base64url");

const sha256Base64Url = (bytes) => createHash("sha256").update(bytes).digest("base64url");

const canonicalGrantPayload = (grant, sessionId, storageKey) => [
  grant.version,
  grant.algorithm,
  grant.imageId,
  grant.issuedAt,
  grant.expiresAt,
  grant.nonce,
  grant.keyHash,
  sessionId,
  storageKey
].join(".");

const signGrant = ({ grant, sessionId, storageKey, hmacSecret }) =>
  createHmac("sha256", hmacSecret).update(canonicalGrantPayload(grant, sessionId, storageKey)).digest("base64url");

const createSessionKeyGrant = ({ imageId, storageKey, sessionId, imgxSecret, hmacSecret, ttlMs, now }) => {
  const issuedAt = Number.isFinite(Number(now)) ? Math.floor(Number(now)) : Date.now();
  const expiresAt = issuedAt + Math.max(1000, Math.floor(Number(ttlMs) || 60000));
  const decodeKey = deriveImgxKey(imageId, imgxSecret);
  const unsigned = {
    version: 1,
    algorithm: "IMGX-HMAC-SHA256-v1",
    imageId,
    issuedAt,
    expiresAt,
    nonce: base64UrlEncode(randomBytes(16)),
    decodeKey: base64UrlEncode(decodeKey),
    keyHash: sha256Base64Url(decodeKey)
  };
  return {
    ...unsigned,
    signature: signGrant({ grant: unsigned, sessionId, storageKey, hmacSecret })
  };
};

const verifySessionKeyGrantSignature = ({ grant, sessionId, storageKey, hmacSecret }) => {
  if (!grant || !grant.signature) return false;
  const expected = signGrant({ grant, sessionId, storageKey, hmacSecret });
  const actual = Buffer.from(String(grant.signature));
  const expectedBytes = Buffer.from(expected);
  return actual.byteLength === expectedBytes.byteLength && timingSafeEqual(actual, expectedBytes);
};

module.exports = {
  base64UrlDecode,
  base64UrlEncode,
  createSessionKeyGrant,
  decodeImgxForVerification,
  decodeImgxWithKey,
  deriveImgxKey,
  encodeImgx,
  imageIdFromStorageKey,
  imageIdFromWebp,
  sha256Base64Url,
  verifySessionKeyGrantSignature
};
