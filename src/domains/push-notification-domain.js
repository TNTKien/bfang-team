const PUSH_NOTIFICATION_MAX_TITLE_LENGTH = 120;
const PUSH_NOTIFICATION_MAX_BODY_LENGTH = 240;
const PUSH_NOTIFICATION_MAX_TAG_LENGTH = 120;
const PUSH_NOTIFICATION_TTL_SECONDS = 24 * 60 * 60;

const createPushNotificationDomain = (deps) => {
  const {
    dbAll,
    dbRun,
    webPush,
    vapidPublicKey,
    vapidPrivateKey,
    vapidSubject,
    defaultIconUrl,
    defaultBadgeUrl,
  } = deps;

  const normalizeText = (value) => (value == null ? "" : String(value)).trim();

  const normalizeLimitedText = (value, maxLength) => {
    const text = normalizeText(value).replace(/\s+/g, " ");
    const safeLimit = Number.isFinite(Number(maxLength))
      ? Math.max(8, Math.floor(Number(maxLength)))
      : 0;
    if (!safeLimit || text.length <= safeLimit) return text;
    return `${text.slice(0, safeLimit - 1).trim()}...`;
  };

  const normalizeUserId = (value) => normalizeText(value);

  const normalizeRelativeOrHttpUrl = (value) => {
    const text = normalizeText(value);
    if (!text) return "";
    if (text.startsWith("/")) return text;

    try {
      const parsed = new URL(text);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      return parsed.toString();
    } catch (_error) {
      return "";
    }
  };

  const normalizeNotificationUrl = (value) => {
    const url = normalizeRelativeOrHttpUrl(value);
    return url || "/";
  };

  const normalizeNotificationType = (value) => normalizeText(value).toLowerCase();

  const shouldSendPushForNotificationType = (typeInput) => {
    const type = normalizeNotificationType(typeInput);
    if (!type) return false;
    if (type === "team_manga_comment") return false;
    return true;
  };

  const normalizeSubscription = (value) => {
    if (!value || typeof value !== "object") return null;

    const endpoint = normalizeText(value.endpoint);
    if (!endpoint) return null;

    let endpointUrl = null;
    try {
      endpointUrl = new URL(endpoint);
    } catch (_error) {
      endpointUrl = null;
    }
    if (!endpointUrl || endpointUrl.protocol !== "https:") return null;

    const keys = value.keys && typeof value.keys === "object" ? value.keys : null;
    const p256dh = normalizeText(keys && keys.p256dh);
    const authKey = normalizeText(keys && keys.auth);
    if (!p256dh || !authKey) return null;

    const expirationTimeRaw = Number(value.expirationTime);
    const expirationTime = Number.isFinite(expirationTimeRaw) && expirationTimeRaw > 0
      ? Math.floor(expirationTimeRaw)
      : null;

    return {
      endpoint,
      expirationTime,
      keys: {
        p256dh,
        auth: authKey,
      },
    };
  };

  const normalizePushNotificationPayload = (value) => {
    if (!value || typeof value !== "object") return null;

    const type = normalizeNotificationType(value.type);
    if (!shouldSendPushForNotificationType(type)) return null;

    const title = normalizeLimitedText(value.title || "Thông báo mới", PUSH_NOTIFICATION_MAX_TITLE_LENGTH);
    const body = normalizeLimitedText(value.body, PUSH_NOTIFICATION_MAX_BODY_LENGTH);
    const tag = normalizeLimitedText(value.tag, PUSH_NOTIFICATION_MAX_TAG_LENGTH);
    const icon = normalizeRelativeOrHttpUrl(value.icon || defaultIconUrl || "/favicon.ico") || "/favicon.ico";
    const badge = normalizeRelativeOrHttpUrl(value.badge || defaultBadgeUrl || "/favicon.ico") || "/favicon.ico";
    const url = normalizeNotificationUrl(value.url);
    const data = value.data && typeof value.data === "object" ? value.data : {};

    return {
      type,
      title,
      body,
      tag,
      icon,
      badge,
      url,
      data,
      renotify: Boolean(value.renotify),
      requireInteraction: Boolean(value.requireInteraction),
    };
  };

  const normalizeErrorCode = (value) => normalizeLimitedText(value, 160);

  const markPushDeliverySuccess = async (endpoint) => {
    const safeEndpoint = normalizeText(endpoint);
    if (!safeEndpoint) return;
    const now = Date.now();
    await dbRun(
      `
        UPDATE push_subscriptions
        SET
          last_success_at = ?,
          last_error_at = NULL,
          last_error_code = NULL,
          updated_at = ?
        WHERE endpoint = ?
      `,
      [now, now, safeEndpoint]
    );
  };

  const markPushDeliveryFailure = async ({ endpoint, errorCode }) => {
    const safeEndpoint = normalizeText(endpoint);
    if (!safeEndpoint) return;
    const now = Date.now();
    await dbRun(
      `
        UPDATE push_subscriptions
        SET
          last_error_at = ?,
          last_error_code = ?,
          updated_at = ?
        WHERE endpoint = ?
      `,
      [now, normalizeErrorCode(errorCode), now, safeEndpoint]
    );
  };

  const removePushSubscriptionByEndpoint = async ({ endpoint }) => {
    const safeEndpoint = normalizeText(endpoint);
    if (!safeEndpoint) return 0;
    const result = await dbRun("DELETE FROM push_subscriptions WHERE endpoint = ?", [safeEndpoint]);
    return result && result.changes ? Number(result.changes) : 0;
  };

  const listPushSubscriptionsForUser = async ({ userId }) => {
    const safeUserId = normalizeUserId(userId);
    if (!safeUserId) return [];

    return dbAll(
      `
        SELECT endpoint, p256dh, auth_key, expiration_time
        FROM push_subscriptions
        WHERE user_id = ?
        ORDER BY updated_at DESC, id DESC
      `,
      [safeUserId]
    );
  };

  const safeVapidPublicKey = normalizeText(vapidPublicKey);
  const safeVapidPrivateKey = normalizeText(vapidPrivateKey);
  const safeVapidSubject = normalizeText(vapidSubject);

  let pushEnabled = false;
  if (
    safeVapidPublicKey &&
    safeVapidPrivateKey &&
    safeVapidSubject &&
    webPush &&
    typeof webPush.setVapidDetails === "function"
  ) {
    try {
      webPush.setVapidDetails(safeVapidSubject, safeVapidPublicKey, safeVapidPrivateKey);
      pushEnabled = true;
    } catch (error) {
      pushEnabled = false;
      console.warn("Web Push VAPID configuration failed", error);
    }
  }

  const isPushNotificationEnabled = () => pushEnabled;

  const getPushNotificationPublicKey = () => (pushEnabled ? safeVapidPublicKey : "");

  const upsertUserPushSubscription = async ({ userId, subscription, userAgent }) => {
    const safeUserId = normalizeUserId(userId);
    if (!safeUserId) {
      return { ok: false, error: "Người dùng không hợp lệ." };
    }

    const normalized = normalizeSubscription(subscription);
    if (!normalized) {
      return { ok: false, error: "Dữ liệu đăng ký push không hợp lệ." };
    }

    const now = Date.now();
    await dbRun(
      `
        INSERT INTO push_subscriptions (
          user_id,
          endpoint,
          p256dh,
          auth_key,
          expiration_time,
          user_agent,
          created_at,
          updated_at,
          last_success_at,
          last_error_at,
          last_error_code
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
        ON CONFLICT (endpoint) DO UPDATE
        SET
          user_id = EXCLUDED.user_id,
          p256dh = EXCLUDED.p256dh,
          auth_key = EXCLUDED.auth_key,
          expiration_time = EXCLUDED.expiration_time,
          user_agent = EXCLUDED.user_agent,
          updated_at = EXCLUDED.updated_at,
          last_error_at = NULL,
          last_error_code = NULL
      `,
      [
        safeUserId,
        normalized.endpoint,
        normalized.keys.p256dh,
        normalized.keys.auth,
        normalized.expirationTime,
        normalizeLimitedText(userAgent, 600),
        now,
        now,
      ]
    );

    return {
      ok: true,
      endpoint: normalized.endpoint,
    };
  };

  const removeUserPushSubscription = async ({ userId, endpoint }) => {
    const safeUserId = normalizeUserId(userId);
    const safeEndpoint = normalizeText(endpoint);
    if (!safeUserId || !safeEndpoint) return 0;
    const result = await dbRun("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", [
      safeUserId,
      safeEndpoint,
    ]);
    return result && result.changes ? Number(result.changes) : 0;
  };

  const removeAllPushSubscriptionsForUser = async ({ userId }) => {
    const safeUserId = normalizeUserId(userId);
    if (!safeUserId) return 0;
    const result = await dbRun("DELETE FROM push_subscriptions WHERE user_id = ?", [safeUserId]);
    return result && result.changes ? Number(result.changes) : 0;
  };

  const sendPushNotificationToUser = async ({ userId, notification }) => {
    const safeUserId = normalizeUserId(userId);
    if (!safeUserId || !pushEnabled) {
      return { total: 0, sent: 0, failed: 0, removed: 0 };
    }

    const normalizedNotification = normalizePushNotificationPayload(notification);
    if (!normalizedNotification) {
      return { total: 0, sent: 0, failed: 0, removed: 0 };
    }

    const subscriptions = await listPushSubscriptionsForUser({ userId: safeUserId });
    if (!subscriptions.length) {
      return { total: 0, sent: 0, failed: 0, removed: 0 };
    }

    const payload = JSON.stringify({
      title: normalizedNotification.title,
      body: normalizedNotification.body,
      icon: normalizedNotification.icon,
      badge: normalizedNotification.badge,
      tag: normalizedNotification.tag,
      renotify: normalizedNotification.renotify,
      requireInteraction: normalizedNotification.requireInteraction,
      url: normalizedNotification.url,
      data: {
        ...(normalizedNotification.data || {}),
        notificationType: normalizedNotification.type,
      },
    });

    const result = {
      total: subscriptions.length,
      sent: 0,
      failed: 0,
      removed: 0,
    };

    await Promise.all(
      subscriptions.map(async (subscriptionRow) => {
        const endpoint = normalizeText(subscriptionRow && subscriptionRow.endpoint);
        const p256dh = normalizeText(subscriptionRow && subscriptionRow.p256dh);
        const authKey = normalizeText(subscriptionRow && subscriptionRow.auth_key);
        if (!endpoint || !p256dh || !authKey) return;

        const pushSubscription = {
          endpoint,
          expirationTime:
            subscriptionRow && Number.isFinite(Number(subscriptionRow.expiration_time))
              ? Number(subscriptionRow.expiration_time)
              : null,
          keys: {
            p256dh,
            auth: authKey,
          },
        };

        try {
          await webPush.sendNotification(pushSubscription, payload, {
            TTL: PUSH_NOTIFICATION_TTL_SECONDS,
            urgency: "normal",
          });
          result.sent += 1;
          await markPushDeliverySuccess(endpoint);
        } catch (error) {
          result.failed += 1;
          const statusCode = Number(error && error.statusCode);
          if (statusCode === 404 || statusCode === 410) {
            const removedCount = await removePushSubscriptionByEndpoint({ endpoint });
            result.removed += removedCount;
            return;
          }

          const errorCode = Number.isFinite(statusCode)
            ? `HTTP_${Math.floor(statusCode)}`
            : normalizeErrorCode(error && error.code ? error.code : "PUSH_SEND_FAILED");
          await markPushDeliveryFailure({ endpoint, errorCode });
        }
      })
    );

    return result;
  };

  return {
    getPushNotificationPublicKey,
    isPushNotificationEnabled,
    listPushSubscriptionsForUser,
    removeAllPushSubscriptionsForUser,
    removePushSubscriptionByEndpoint,
    removeUserPushSubscription,
    sendPushNotificationToUser,
    shouldSendPushForNotificationType,
    upsertUserPushSubscription,
  };
};

module.exports = createPushNotificationDomain;
