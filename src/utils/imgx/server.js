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
  grant.keyNonce || "",
  grant.keyHash,
  sessionId,
  storageKey
].join(".");

const signGrant = ({ grant, sessionId, storageKey, hmacSecret }) =>
  createHmac("sha256", hmacSecret).update(canonicalGrantPayload(grant, sessionId, storageKey)).digest("base64url");

const nextMaskXorShift32 = (value) => {
  let x = value >>> 0;
  x ^= (x << 13) >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  return x >>> 0;
};

const fnv1a32 = (bytes) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 0x9e3779b9;
};

const createGrantKeyMask = (material, byteLength = IMGX_SESSION_KEY_BYTES) => {
  const safeLength = Math.max(0, Math.floor(Number(byteLength) || 0));
  const mask = Buffer.alloc(safeLength);
  const materialBytes = Buffer.from((material || "").toString(), "utf8");
  let seed = fnv1a32(materialBytes);
  for (let index = 0; index < safeLength; index += 1) {
    if (index % 4 === 0) {
      seed = nextMaskXorShift32((seed + index + 0x9e3779b9) >>> 0);
    }
    mask[index] = (seed >>> ((index % 4) * 8)) & 0xff;
  }
  return mask;
};

const createGrantKeyWrapMaterial = (grant, storageKey) => [
  "IMGX-GRANT-WRAP-v1",
  grant && grant.version,
  grant && grant.algorithm,
  grant && grant.imageId,
  grant && grant.issuedAt,
  grant && grant.expiresAt,
  grant && grant.nonce,
  grant && grant.keyNonce,
  grant && grant.signature,
  (storageKey || "").toString().trim().replace(/^\/+/, "")
].map((part) => (part == null ? "" : String(part))).join(".");

const wrapDecodeKeyForGrant = ({ decodeKey, grant, storageKey }) => {
  if (!decodeKey || decodeKey.byteLength !== IMGX_SESSION_KEY_BYTES) {
    throw new Error("IMGX decode key wrap requires a 32-byte key");
  }
  if (!grant || !grant.keyNonce || !grant.signature) {
    throw new Error("IMGX decode key wrap requires a signed grant");
  }
  const source = Buffer.from(decodeKey);
  const mask = createGrantKeyMask(createGrantKeyWrapMaterial(grant, storageKey), source.byteLength);
  for (let index = 0; index < source.byteLength; index += 1) {
    source[index] ^= mask[index];
  }
  return source;
};

const unwrapDecodeKeyFromGrant = ({ grant, storageKey }) => {
  if (!grant || typeof grant !== "object") {
    throw new Error("IMGX grant is required");
  }
  if (grant.wrappedDecodeKey) {
    const wrapped = base64UrlDecode(grant.wrappedDecodeKey);
    if (wrapped.byteLength !== IMGX_SESSION_KEY_BYTES) {
      throw new Error("IMGX wrapped decode key invalid");
    }
    const mask = createGrantKeyMask(createGrantKeyWrapMaterial(grant, storageKey), wrapped.byteLength);
    const decodeKey = Buffer.from(wrapped);
    for (let index = 0; index < decodeKey.byteLength; index += 1) {
      decodeKey[index] ^= mask[index];
    }
    if (grant.keyHash && sha256Base64Url(decodeKey) !== grant.keyHash) {
      throw new Error("IMGX wrapped decode key hash mismatch");
    }
    return decodeKey;
  }
  if (grant.decodeKey) {
    return base64UrlDecode(grant.decodeKey);
  }
  throw new Error("IMGX grant does not include a decode key");
};

const createSessionKeyGrant = ({ imageId, storageKey, sessionId, imgxSecret, hmacSecret, ttlMs, now }) => {
  const issuedAt = Number.isFinite(Number(now)) ? Math.floor(Number(now)) : Date.now();
  const expiresAt = issuedAt + Math.max(1000, Math.floor(Number(ttlMs) || 60000));
  const decodeKey = deriveImgxKey(imageId, imgxSecret);
  const unsigned = {
    version: 2,
    algorithm: "IMGX-HMAC-SHA256-v2",
    imageId,
    issuedAt,
    expiresAt,
    nonce: base64UrlEncode(randomBytes(16)),
    keyNonce: base64UrlEncode(randomBytes(16)),
    keyHash: sha256Base64Url(decodeKey)
  };
  const signed = {
    ...unsigned,
    signature: signGrant({ grant: unsigned, sessionId, storageKey, hmacSecret })
  };
  return {
    ...signed,
    wrappedDecodeKey: base64UrlEncode(wrapDecodeKeyForGrant({ decodeKey, grant: signed, storageKey }))
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
  unwrapDecodeKeyFromGrant,
  verifySessionKeyGrantSignature
};
