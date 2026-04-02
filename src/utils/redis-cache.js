const crypto = require("crypto");
const Redis = require("ioredis");
const { parseEnvBoolean } = require("./env");

const DEFAULT_PREFIX = "bfang";
const DEFAULT_DEFAULT_TTL_SECONDS = 30;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_CONNECT_MS = 15000;

const toSafePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized <= 0) return fallback;
  return normalized;
};

const hashCachePayload = (payload) =>
  crypto.createHash("sha1").update(String(payload == null ? "" : payload)).digest("hex");

const createRedisCache = (options = {}) => {
  const logger = options && options.logger && typeof options.logger.warn === "function"
    ? options.logger
    : console;

  const cacheEnabled = parseEnvBoolean(process.env.REDIS_CACHE_ENABLED, true);
  const redisUrl = String(process.env.REDIS_URL || "").trim();
  const prefix = String(process.env.REDIS_PREFIX || DEFAULT_PREFIX).trim() || DEFAULT_PREFIX;
  const defaultTtlSeconds = toSafePositiveInt(
    process.env.REDIS_DEFAULT_TTL_SECONDS,
    DEFAULT_DEFAULT_TTL_SECONDS
  );
  const connectTimeoutMs = toSafePositiveInt(
    process.env.REDIS_CONNECT_TIMEOUT_MS,
    DEFAULT_CONNECT_TIMEOUT_MS
  );
  const reconnectRetryMs = toSafePositiveInt(
    process.env.REDIS_RECONNECT_RETRY_MS,
    DEFAULT_RETRY_CONNECT_MS
  );

  if (!cacheEnabled || !redisUrl) {
    return {
      enabled: false,
      client: null,
      defaultTtlSeconds,
      buildCacheKey: () => "",
      getText: async () => "",
      setText: async () => false,
      incr: async () => 0,
      getJson: async () => null,
      setJson: async () => false,
      del: async () => 0,
      disconnect: async () => undefined
    };
  }

  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: connectTimeoutMs,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true
  });

  let nextConnectRetryAt = 0;

  const ensureConnected = async () => {
    if (client.status === "ready") return true;
    if (client.status === "connecting" || client.status === "connect") return true;

    const now = Date.now();
    if (nextConnectRetryAt > now) {
      return false;
    }

    try {
      await client.connect();
      nextConnectRetryAt = 0;
      return true;
    } catch (error) {
      nextConnectRetryAt = now + reconnectRetryMs;
      logger.warn(
        "Redis cache unavailable, falling back to PostgreSQL",
        error && error.message ? error.message : error
      );
      return false;
    }
  };

  const buildCacheKey = (scope, payload) => {
    const safeScope = String(scope || "default").trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-") || "default";
    const payloadHash = hashCachePayload(payload);
    return `${prefix}:${safeScope}:${payloadHash}`;
  };

  const getJson = async (key) => {
    const safeKey = String(key || "").trim();
    if (!safeKey) return null;
    const connected = await ensureConnected();
    if (!connected) return null;

    try {
      const raw = await client.get(safeKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      logger.warn("Redis GET cache miss fallback", error && error.message ? error.message : error);
      return null;
    }
  };

  const getText = async (key) => {
    const safeKey = String(key || "").trim();
    if (!safeKey) return "";
    const connected = await ensureConnected();
    if (!connected) return "";

    try {
      const raw = await client.get(safeKey);
      return raw == null ? "" : String(raw);
    } catch (error) {
      logger.warn("Redis GET text fallback", error && error.message ? error.message : error);
      return "";
    }
  };

  const setText = async (key, value, ttlSeconds = 0) => {
    const safeKey = String(key || "").trim();
    if (!safeKey) return false;
    const connected = await ensureConnected();
    if (!connected) return false;

    const textValue = String(value == null ? "" : value);
    const safeTtl = toSafePositiveInt(ttlSeconds, 0);
    try {
      if (safeTtl > 0) {
        await client.set(safeKey, textValue, "EX", safeTtl);
      } else {
        await client.set(safeKey, textValue);
      }
      return true;
    } catch (error) {
      logger.warn("Redis SET text failed", error && error.message ? error.message : error);
      return false;
    }
  };

  const incr = async (key) => {
    const safeKey = String(key || "").trim();
    if (!safeKey) return 0;
    const connected = await ensureConnected();
    if (!connected) return 0;

    try {
      const nextValue = await client.incr(safeKey);
      const parsed = Number(nextValue);
      return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
    } catch (error) {
      logger.warn("Redis INCR failed", error && error.message ? error.message : error);
      return 0;
    }
  };

  const setJson = async (key, value, ttlSeconds = defaultTtlSeconds) => {
    const safeKey = String(key || "").trim();
    if (!safeKey) return false;
    const connected = await ensureConnected();
    if (!connected) return false;

    const safeTtl = toSafePositiveInt(ttlSeconds, defaultTtlSeconds);
    try {
      await client.set(safeKey, JSON.stringify(value), "EX", safeTtl);
      return true;
    } catch (error) {
      logger.warn("Redis SET cache write failed", error && error.message ? error.message : error);
      return false;
    }
  };

  const del = async (keys) => {
    const normalizedKeys = Array.isArray(keys)
      ? keys.map((item) => String(item || "").trim()).filter(Boolean)
      : [String(keys || "").trim()].filter(Boolean);
    if (!normalizedKeys.length) return 0;

    const connected = await ensureConnected();
    if (!connected) return 0;

    try {
      return await client.del(...normalizedKeys);
    } catch (error) {
      logger.warn("Redis DEL cache invalidation failed", error && error.message ? error.message : error);
      return 0;
    }
  };

  const disconnect = async () => {
    try {
      if (client.status === "end") return;
      await client.quit();
    } catch (_error) {
      client.disconnect();
    }
  };

  return {
    enabled: true,
    client,
    defaultTtlSeconds,
    buildCacheKey,
    getText,
    setText,
    incr,
    getJson,
    setJson,
    del,
    disconnect
  };
};

module.exports = {
  createRedisCache
};
