const db                = require('../db');
const logger            = require('../utils/logger');
const { broadcastToUser } = require('./socketService');
const { sendEmail }     = require('../utils/email');  // Resend - single email system
const { Expo }          = require('expo-server-sdk');
const escapeHtml        = require('../utils/escapeHtml');
const webPushService    = require('./webPushService');
const mobilePushService = require('./mobilePushService');
const { tNotif, tNotifEmail } = require('../utils/i18n');
const { renderOxSteedEmail } = require('../utils/emailTemplate');

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

function redactPushToken(token) {
  if (!token || typeof token !== 'string') return null;
  if (token.length <= 12) return '[redacted]';
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

// ─── MASTER SEND FUNCTION ─────────────────────────────────────
exports.sendNotification = async ({
  userId,
  type,
  title,
  body,
  data       = {},
  action_url = null,
  pushToken  = null,
  idempotencyKey = null,
  promotional = false,
}) => {
  try {
    // ── Promo frequency governor: at most 2 promotional pushes per user
    // per rolling 7 days. Transactional notifications (bids, orders,
    // payouts, recovery) are exempt — pass promotional: true only for
    // marketing content.
    if (promotional) {
      const { rows: promoRows } = await db.query(
        `SELECT COUNT(*)::int AS n
           FROM notifications
          WHERE user_id = $1
            AND is_promotional = TRUE
            AND created_at >= NOW() - INTERVAL '7 days'`,
        [userId]
      );
      if ((promoRows[0]?.n || 0) >= 2) {
        return { success: false, reason: 'promo_cap' };
      }
    }
    // Get user prefs
    const { rows: prefRows } = await db.query(`
      SELECT np.*, u.email, u.first_name, u.is_banned,
             u.preferred_language
      FROM users u
      LEFT JOIN notification_preferences np ON np.user_id = u.id
      WHERE u.id = $1
    `, [userId]);
    if (!prefRows.length) return { success: false, reason: 'user_not_found' };

    const prefs     = prefRows[0];
    const userEmail = prefs.email;
    const firstName = prefs.first_name;
    const isBanned  = !!prefs.is_banned;
    // Native tokens are delivered by mobilePushService from mobile_push_tokens.
    // Keep pushToken for legacy Expo callers, but do not read token data from
    // helper_profiles, whose schema no longer owns device registrations.
    const token     = pushToken;
    const language  = prefs.preferred_language || 'en';
    const notificationText = tNotif(type, language);
    const emailTranslations = tNotifEmail(type, language);
    const finalTitle = notificationText.title || title;
    const translationBody = notificationText.body || '';
    const finalBody = translationBody
      ? [translationBody, body].filter(Boolean).join(' ')
      : (body || translationBody);
    const deliveryKey = idempotencyKey
      ? String(idempotencyKey).trim().slice(0, 255)
      : null;

    // ── Quiet-hours gate (blocks push only, in-app and email still proceed) ──
    // quiet_hours_start / quiet_hours_end are stored as Postgres TIME (HH:MM:SS).
    // Safety SOS always bypasses quiet hours regardless of user setting.
    const isSOSType = type === 'safety_sos';
    const inQuietHours = !isSOSType && isWithinQuietHours(
      prefs.quiet_hours_start,
      prefs.quiet_hours_end,
      prefs.quiet_hours_enabled,
      prefs.timezone
    );

    // ── 1. Save to DB (in-app) ────────────────────────────────
    const prefKey    = `in_app_${type.replace(':', '_')}`;
    const inAppEnabled = prefs[prefKey] !== false; // default true
    let notifId = null;
    let notificationRow = null;
    if (inAppEnabled) {
      const { rows } = await db.query(`
        INSERT INTO notifications
          (user_id, type, title, body, data, action_url, delivery_key, is_promotional)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (delivery_key)
        WHERE delivery_key IS NOT NULL DO NOTHING
        RETURNING id, is_push_sent, is_email_sent
      `, [userId, type, finalTitle, finalBody, JSON.stringify(data), action_url, deliveryKey, promotional]);
      notificationRow = rows[0] || null;
      if (!notificationRow && deliveryKey) {
        const { rows: existingRows } = await db.query(
          `SELECT id, is_push_sent, is_email_sent
             FROM notifications
            WHERE delivery_key = $1
            LIMIT 1`,
          [deliveryKey]
        );
        notificationRow = existingRows[0] || null;
      }
      if (!notificationRow) {
        throw new Error('Notification row could not be resolved');
      }
      notifId = notificationRow.id;

      // ── 2. Real-time via Socket.IO ──────────────────────────
      if (rows[0]) {
        broadcastToUser(userId, 'notification:new', {
          id: notifId, type, title: finalTitle, body: finalBody, data, action_url,
          created_at: new Date().toISOString()
        });
      }
    }

    // ── 3. Push notification (Expo - native mobile) ───────────
    const pushKey     = `push_${type.replace(':', '_')}`;
    const pushEnabled = prefs[pushKey] !== false && !inQuietHours;
    if (token && pushEnabled && !notificationRow?.is_push_sent && Expo.isExpoPushToken(token)) {
      await sendPushNotification(token, finalTitle, finalBody, data, notifId);
      if (notifId) {
        await db.query(
          `UPDATE notifications SET is_push_sent = true WHERE id = $1`,
          [notifId]
        );
      }
    }

    // ── 3b. Web Push (browser, VAPID) ─────────────────────────
    // Master toggle (web_push_enabled) + per-event `push_*` pref.
    const webPushEnabled = prefs.web_push_enabled !== false && !inQuietHours;
    if (pushEnabled && webPushEnabled && !notificationRow?.is_push_sent && webPushService.isConfigured()) {
      try {
        const result = await webPushService.sendToUser(userId, {
          id: notifId,
          type,
          title: finalTitle,
          body: finalBody,
          data,
          action_url,
        });
        if (result.sent > 0 && notifId) {
          await db.query(
            `UPDATE notifications SET is_push_sent = true WHERE id = $1`,
            [notifId]
          );
        }
      } catch (err) {
        logger.warn('[Notification] Web push fan-out failed', {
          userId, type, error: err.message
        });
      }
    }

    // ── 3c. Native Mobile Push (APNs / FCM) ───────────────────
    if (pushEnabled && !inQuietHours && !notificationRow?.is_push_sent && mobilePushService.isConfigured()) {
      try {
        const result = await mobilePushService.sendToUser(userId, {
          notifId,
          type,
          title: finalTitle,
          body: finalBody,
          data,
          action_url,
        });
        if (result.sent > 0 && notifId) {
          await db.query(
            `UPDATE notifications SET is_push_sent = true WHERE id = $1`,
            [notifId]
          );
        }
      } catch (err) {
        logger.warn('[Notification] Mobile push fan-out failed', {
          userId, type, error: err.message
        });
      }
    }

    // ── 4. Email notification (via Resend) ────────────────────
    const emailKey   = `email_${type.replace(':', '_')}`;
    const emailPrefOff = prefs[emailKey] === false;
    const emailTypes = [
      'bid_accepted', 'payment_released', 'subscription_renewed',
      'subscription_cancelled', 'subscription_past_due',
      'dispute_update', 'payout_deposited', 'account_banned',
      'oxsteed_credit_transaction', 'oxsteed_credit_card_security',
      // Monthly statement issuance: generic authenticated-link email, no
      // amounts or attachments. Respects the user's email preference toggle.
      'statement_ready',
      // Statement amendment publication: same shape as statement_ready.
      'statement_amended',
      // Account integrity / admin actions — user should receive email by default
      'account_restored', 'account_suspended', 'account_restricted',
      'account_deletion_scheduled', 'admin_warning',
      // Direct booking notifications
      'booking_request_new', 'booking_accepted', 'booking_declined',
      'booking_cancelled', 'booking_auto_released',
    ];
    // Transactional: always attempt email when we have an address (cannot opt out of
    // security-relevant account notices via marketing-style toggles).
    const transactionalEmailTypes = new Set([
      'account_banned',
      'account_restored',
      'account_suspended',
      'account_restricted',
      'account_deletion_scheduled',
      'admin_warning',
      'oxsteed_credit_transaction', 'oxsteed_credit_card_security',
    ]);
    const emailAllowed = userEmail && emailTypes.includes(type)
      && (transactionalEmailTypes.has(type) ? true : !emailPrefOff);
    if (emailAllowed && !notificationRow?.is_email_sent) {
      // Banned users get the notification email but with no account link
      const safeActionUrl = isBanned ? null : action_url;
      const delivery = await sendEmailNotification({
        to: userEmail,
        firstName,
        type,
        title: finalTitle,
        body: finalBody,
        action_url: safeActionUrl,
        isBanned,
        language,
        fallbackTranslations: emailTranslations,
        idempotencyKey: deliveryKey,
      });
      if (type === 'oxsteed_credit_card_security' && delivery?.success !== true) {
        throw new Error('Card security email delivery unavailable');
      }
      if (notifId) {
        await db.query(
          `UPDATE notifications SET is_email_sent = true WHERE id = $1`,
          [notifId]
        );
      }
    }
    return { success: true, notificationId: notifId };
  } catch (err) {
    logger.error('Send notification failed', { userId, type, error: err.message });
    // Never throw - notification failure should never block business logic
    return { success: false, error: err.message };
  }
};

// ─── PUSH NOTIFICATION (Expo) ─────────────────────────────────
async function sendPushNotification(token, title, body, data, notifId) {
  try {
    const message = {
      to: token,
      sound: 'default',
      title,
      body,
      data: { ...data, notifId },
      badge: 1
    };
    const chunks  = expo.chunkPushNotifications([message]);
    const tickets = [];
    for (const chunk of chunks) {
      const batch = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...batch);
    }
    for (const ticket of tickets) {
      if (ticket.status === 'error') {
        logger.error('Push notification error', { token: redactPushToken(token), error: ticket.message });
        if (ticket.details?.error === 'DeviceNotRegistered') {
          await db.query(
            `UPDATE mobile_push_tokens
                SET enabled = FALSE, disabled_at = NOW(), updated_at = NOW()
              WHERE token = $1`,
            [token]
          );
        }
      }
    }
  } catch (err) {
    logger.error('Send push notification failed', { token: redactPushToken(token), error: err.message });
  }
}

// ─── EMAIL NOTIFICATION (Resend via utils/email.js) ───────────
async function sendEmailNotification({
  to,
  firstName,
  type,
  title,
  body,
  action_url,
  isBanned,
  language = 'en',
  fallbackTranslations = null,
  idempotencyKey = null,
}) {
  try {
    const translations = fallbackTranslations || tNotifEmail(type, language);
    const buttonText = translations.buttonText
      || tNotifEmail('default', language).buttonText
      || 'View Dashboard';

    const rendered = buildEmailTemplate({
      firstName: firstName || 'there',
      title,
      body,
      action_url,
      buttonText,
      isBanned,
      type,
      footerPrefix: translations.footerPrefix,
      manageNotificationsText: translations.manageNotificationsText,
      unsubscribeText: translations.unsubscribeText,
      footerFallbackText: translations.footerFallbackText,
      language,
    });

    return await sendEmail({
      to,
      subject: title,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: idempotencyKey || undefined,
    });
  } catch (err) {
    if (type === 'oxsteed_credit_card_security') return { success: false };
    logger.error('Send email notification failed', { to, type, error: err.message });
  }
}



// ─── EMAIL TEMPLATE BUILDER ───────────────────────────────────
function buildEmailTemplate({
  firstName,
  title,
  body,
  action_url,
  buttonText,
  isBanned,
  type = '',
  footerPrefix = 'You are receiving this because you have an OxSteed account.',
  manageNotificationsText = 'Manage notifications',
  unsubscribeText = 'Unsubscribe',
  footerFallbackText = 'You received this notification from OxSteed.',
  language = 'en',
}) {
  // action_url must be a relative path starting with '/' to prevent open redirect
  const safeActionUrl = (action_url && typeof action_url === 'string' && action_url.startsWith('/'))
    ? action_url
    : null;

  const lockedOut = isBanned || ['account_deletion_scheduled', 'account_suspended'].includes(type);
  const settingsUrl = lockedOut
    ? null
    : `${process.env.CLIENT_URL}/settings/notifications`;

  return renderOxSteedEmail({
    language,
    preheader: title,
    eyebrow: type.replace(/_/g, ' ').toUpperCase() || 'OXSTEED',
    title,
    intro: `Hi ${firstName || 'there'},`,
    bodyText: body,
    bodyHtml: `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(body)}</p>`,
    cta: safeActionUrl ? { label: buttonText, url: safeActionUrl } : null,
    footerText: `${footerPrefix} ${settingsUrl ? `${manageNotificationsText} · ${unsubscribeText}` : footerFallbackText}`,
  });
}

// ─── BULK NOTIFICATION (e.g. platform announcements) ──────────
exports.sendBulkNotification = async ({ userIds, type, title, body, data = {} }) => {
  // Audit fix: cap bulk notifications at 1000 recipients to prevent abuse.
  const MAX_BULK_RECIPIENTS = 1000;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new Error('userIds must be a non-empty array');
  }
  if (userIds.length > MAX_BULK_RECIPIENTS) {
    throw new Error(`Bulk notification limited to ${MAX_BULK_RECIPIENTS} recipients`);
  }
  const results = await Promise.allSettled(
    userIds.map(userId =>
      exports.sendNotification({ userId, type, title, body, data })
    )
  );
  const failedIds = results
    .map((r, i) => r.status === 'rejected' ? userIds[i] : null)
    .filter(Boolean);

  if (failedIds.length > 0) {
    logger.error('[Notification] Bulk send partial failure', {
      type,
      total: userIds.length,
      failed: failedIds.length,
      failedUserIds: failedIds,
    });
  } else {
    logger.info('[Notification] Bulk send complete', { type, sent: userIds.length });
  }
  return { sent: userIds.length - failedIds.length, failed: failedIds.length };
};

// ─── QUIET HOURS HELPER ───────────────────────────────────────────────────────
// quiet_hours_start / quiet_hours_end come from Postgres as strings like "22:00:00".
// Returns true (suppress push) when the current UTC time falls inside the window.
// Wraps across midnight: e.g. start=22:00, end=07:00 suppresses 22–07.
function isWithinQuietHours(startTime, endTime, enabled, timezone = 'UTC') {
  if (!enabled || !startTime || !endTime) return false;

  const toMinutes = (timeStr) => {
    const parts = String(timeStr).split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  };

  // Audit fix: evaluate in the user's timezone, not UTC.
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  const nowMins = hour * 60 + minute;
  const startMin = toMinutes(startTime);
  const endMin   = toMinutes(endTime);

  if (startMin <= endMin) {
    // Same-day window e.g. 09:00–17:00
    return nowMins >= startMin && nowMins < endMin;
  } else {
    // Overnight window e.g. 22:00–07:00
    return nowMins >= startMin || nowMins < endMin;
  }
}
