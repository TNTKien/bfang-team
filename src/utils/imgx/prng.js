"use strict";

const seedFromKey = (key) => {
  if (!key || key.byteLength < 4) {
    throw new Error("IMGX key must contain at least 4 bytes");
  }
  const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
  const seed = view.getUint32(0, false);
  return seed || 0x9e3779b9;
};

const nextXorShift32 = (value) => {
  let x = value >>> 0;
  x ^= (x << 13) >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  return x >>> 0;
};

const swapByte = (bytes, left, right) => {
  if (left === right) return;
  const tmp = bytes[left];
  bytes[left] = bytes[right];
  bytes[right] = tmp;
};

const shuffleBytesInPlace = (bytes, key) => {
  let seed = seedFromKey(key);
  for (let index = bytes.byteLength - 1; index > 0; index -= 1) {
    seed = nextXorShift32(seed);
    const swapWith = seed % (index + 1);
    swapByte(bytes, index, swapWith);
  }
};

const unshuffleBytesInPlace = (bytes, key) => {
  const swaps = new Uint32Array(bytes.byteLength);
  let seed = seedFromKey(key);
  for (let index = bytes.byteLength - 1; index > 0; index -= 1) {
    seed = nextXorShift32(seed);
    swaps[index] = seed % (index + 1);
  }
  for (let index = 1; index < bytes.byteLength; index += 1) {
    swapByte(bytes, index, swaps[index]);
  }
};

const xorInPlace = (bytes, key) => {
  if (!key || key.byteLength === 0) {
    throw new Error("IMGX key must not be empty");
  }
  for (let index = 0; index < bytes.byteLength; index += 1) {
    bytes[index] ^= key[index % key.byteLength];
  }
};

module.exports = {
  shuffleBytesInPlace,
  unshuffleBytesInPlace,
  xorInPlace
};
