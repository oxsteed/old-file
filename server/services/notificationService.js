const db                = require('../db');
const logger            = require('../utils/logger');
const { broadcastToUser } = require('./socketService');
const { sendEmail }     = require('../utils/email');  // Resend - single email system
const { Expo }          = require('expo-server-sdk');
const escapeHtml        = require('../utils/escapeHtml');
const webPushService    = require('./webPushService');
const mobilePushService = require('./mobilePushService');
const { tNotif, tNotifEmail } = require('../utils/i18n');

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
  pushToken  = null
}) => {
  try {
    // Get user prefs
    const { rows: prefRows } = await db.query(`
      SELECT np.*, u.email, u.first_name, u.is_banned,
             u.preferred_language,
             hp.push_token AS helper_push_token
      FROM users u
      LEFT JOIN notification_preferences np ON np.user_id = u.id
      LEFT JOIN helper_profiles hp ON hp.user_id = u.id
      WHERE u.id = $1
    `, [userId]);
    if (!prefRows.length) return;

    const prefs     = prefRows[0];
    const userEmail = prefs.email;
    const firstName = prefs.first_name;
    const isBanned  = !!prefs.is_banned;
    const token     = pushToken || prefs.helper_push_token;
    const language  = prefs.preferred_language || 'en';
    const notificationText = tNotif(type, language);
    const emailTranslations = tNotifEmail(type, language);
    const finalTitle = notificationText.title || title;
    const translationBody = notificationText.body || '';
    const finalBody = translationBody
      ? [translationBody, body].filter(Boolean).join(' ')
      : (body || translationBody);

    // ── Quiet-hours gate (blocks push only, in-app and email still proceed) ──
    // quiet_hours_start / quiet_hours_end are stored as Postgres TIME (HH:MM:SS).
    // Safety SOS always bypasses quiet hours regardless of user setting.
    const isSOSType = type === 'safety_sos';
    const inQuietHours = !isSOSType && isWithinQuietHours(
      prefs.quiet_hours_start,
      prefs.quiet_hours_end,
      prefs.quiet_hours_enabled
    );

    // ── 1. Save to DB (in-app) ────────────────────────────────
    const prefKey    = `in_app_${type.replace(':', '_')}`;
    const inAppEnabled = prefs[prefKey] !== false; // default true
    let notifId = null;
    if (inAppEnabled) {
      const { rows } = await db.query(`
        INSERT INTO notifications
          (user_id, type, title, body, data, action_url)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id
      `, [userId, type, finalTitle, finalBody, JSON.stringify(data), action_url]);
      notifId = rows[0].id;

      // ── 2. Real-time via Socket.IO ──────────────────────────
      broadcastToUser(userId, 'notification:new', {
        id: notifId, type, title: finalTitle, body: finalBody, data, action_url,
        created_at: new Date().toISOString()
      });
    }

    // ── 3. Push notification (Expo - native mobile) ───────────
    const pushKey     = `push_${type.replace(':', '_')}`;
    const pushEnabled = prefs[pushKey] !== false && !inQuietHours;
    if (token && pushEnabled && Expo.isExpoPushToken(token)) {
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
    if (pushEnabled && webPushEnabled && webPushService.isConfigured()) {
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
    if (pushEnabled && !inQuietHours && mobilePushService.isConfigured()) {
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
    ]);
    const emailAllowed = userEmail && emailTypes.includes(type)
      && (transactionalEmailTypes.has(type) ? true : !emailPrefOff);
    if (emailAllowed) {
      // Banned users get the notification email but with no account link
      const safeActionUrl = isBanned ? null : action_url;
      await sendEmailNotification({
        to: userEmail,
        firstName,
        type,
        title: finalTitle,
        body: finalBody,
        action_url: safeActionUrl,
        isBanned,
        language,
        fallbackTranslations: emailTranslations,
      });
      if (notifId) {
        await db.query(
          `UPDATE notifications SET is_email_sent = true WHERE id = $1`,
          [notifId]
        );
      }
    }
  } catch (err) {
    logger.error('Send notification failed', { userId, type, error: err.message });
    // Never throw - notification failure should never block business logic
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
            `UPDATE helper_profiles SET push_token = NULL WHERE push_token = $1`,
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
}) {
  try {
    const translations = fallbackTranslations || tNotifEmail(type, language);
    const buttonText = translations.buttonText
      || tNotifEmail('default', language).buttonText
      || 'View Dashboard';

    const html = buildEmailTemplate({
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
    });

    await sendEmail({
      to,
      subject: title,
      html,
      text: body,
    });
  } catch (err) {
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
  footerFallbackText = 'You received this notification from OxSteed.'
}) {
  // action_url must be a relative path starting with '/' to prevent open redirect
  const safeActionUrl = (action_url && typeof action_url === 'string' && action_url.startsWith('/'))
    ? action_url
    : null;

  const lockedOut = isBanned || ['account_deletion_scheduled', 'account_suspended'].includes(type);
  const settingsUrl = lockedOut
    ? null
    : `${process.env.CLIENT_URL}/settings/notifications`;

  const ctaBlock = safeActionUrl ? `
    <table cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td style="border-radius:10px;background:#f97316;">
          <a href="${process.env.CLIENT_URL}${escapeHtml(safeActionUrl)}"
             style="display:inline-block;padding:14px 28px;
                    color:#ffffff;font-size:14px;
                    font-weight:600;text-decoration:none;
                    border-radius:10px;">
            ${escapeHtml(buttonText)}
          </a>
        </td>
      </tr>
    </table>
  ` : '';

  const footerLinks = settingsUrl ? `
    <a href="${settingsUrl}" style="color:#f97316;text-decoration:none;">${escapeHtml(manageNotificationsText)}</a>
    &nbsp;·&nbsp;
    <a href="${settingsUrl}" style="color:#f97316;text-decoration:none;">${escapeHtml(unsubscribeText)}</a>
  ` : escapeHtml(footerFallbackText);

  return `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head><body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td align="center" style="padding:40px 16px;">
        <table width="560" cellpadding="0" cellspacing="0" role="presentation"
               style="background:#ffffff;border-radius:16px;overflow:hidden;
                      box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr><td style="background:#f97316;padding:28px 32px;">
            <span style="color:#ffffff;font-size:22px;font-weight:800;">OxSteed</span>
          </td></tr>
          <tr><td style="padding:36px 32px;">
            <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Hi ${escapeHtml(firstName)},</p>
            <h1 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">${escapeHtml(title)}</h1>
            <p style="margin:0 0 28px;color:#4b5563;font-size:15px;line-height:1.6;">${escapeHtml(body)}</p>
            ${ctaBlock}
          </td></tr>
          <tr><td style="padding:20px 32px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
              ${escapeHtml(footerPrefix)}
              ${footerLinks}
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`.trim();
}

// ─── BULK NOTIFICATION (e.g. platform announcements) ──────────
exports.sendBulkNotification = async ({ userIds, type, title, body, data = {} }) => {
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
function isWithinQuietHours(startTime, endTime, enabled) {
  if (!enabled || !startTime || !endTime) return false;

  const toMinutes = (timeStr) => {
    const parts = String(timeStr).split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  };

  const now      = new Date();
  const nowMins  = now.getUTCHours() * 60 + now.getUTCMinutes();
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
