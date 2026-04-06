const db                = require('../db');
const { broadcastToUser } = require('./socketService');
const { sendEmail }     = require('../utils/email');  // Resend — single email system
const { Expo }          = require('expo-server-sdk');

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

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
      `, [userId, type, title, body, JSON.stringify(data), action_url]);
      notifId = rows[0].id;

      // ── 2. Real-time via Socket.IO ──────────────────────────
      broadcastToUser(userId, 'notification:new', {
        id: notifId, type, title, body, data, action_url,
        created_at: new Date().toISOString()
      });
    }

    // ── 3. Push notification (Expo) ───────────────────────────
    const pushKey     = `push_${type.replace(':', '_')}`;
    const pushEnabled = prefs[pushKey] !== false;
    if (token && pushEnabled && Expo.isExpoPushToken(token)) {
      await sendPushNotification(token, title, body, data, notifId);
      if (notifId) {
        await db.query(
          `UPDATE notifications SET is_push_sent = true WHERE id = $1`,
          [notifId]
        );
      }
    }

    // ── 4. Email notification (via Resend) ────────────────────
    const emailKey   = `email_${type.replace(':', '_')}`;
    const emailEnabled = prefs[emailKey] !== false;
    const emailTypes = [
      'bid_accepted', 'payment_released', 'subscription_renewed',
      'subscription_cancelled', 'subscription_past_due',
      'dispute_update', 'payout_deposited', 'account_banned'
    ];
    if (emailEnabled && userEmail && emailTypes.includes(type)) {
      // Banned users get the notification email but with no account link
      const safeActionUrl = isBanned ? null : action_url;
      await sendEmailNotification({
        to: userEmail,
        firstName,
        type,
        title,
        body,
        action_url: safeActionUrl,
        isBanned
      });
      if (notifId) {
        await db.query(
          `UPDATE notifications SET is_email_sent = true WHERE id = $1`,
          [notifId]
        );
      }
    }
  } catch (err) {
    console.error('[Notification] sendNotification error:', err.message);
    // Never throw — notification failure should never block business logic
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
        console.error('[Push] Error:', ticket.message);
        if (ticket.details?.error === 'DeviceNotRegistered') {
          await db.query(
            `UPDATE helper_profiles SET push_token = NULL WHERE push_token = $1`,
            [token]
          );
        }
      }
    }
  } catch (err) {
    console.error('[Push] sendPushNotification error:', err.message);
  }
}

// ─── EMAIL NOTIFICATION (Resend via utils/email.js) ───────────
async function sendEmailNotification({ to, firstName, type, title, body, action_url, isBanned }) {
  try {
    const buttonText = {
      bid_accepted:           'View Job',
      payment_released:       'View Earnings',
      subscription_renewed:   'View Billing',
      subscription_cancelled: 'Renew Plan',
      subscription_past_due:  'Update Payment',
      dispute_update:         'View Dispute',
      payout_deposited:       'View Earnings',
      account_banned:         'Contact Support'
    }[type] || 'View Dashboard';

    const html = buildEmailTemplate({
      firstName: firstName || 'there',
      title,
      body,
      action_url,
      buttonText,
      isBanned
    });

    await sendEmail({
      to,
      subject: title,
      html,
      text: body,
    });
  } catch (err) {
    console.error('[Email] sendEmailNotification error:', err.message);
  }
}

// ─── EMAIL TEMPLATE BUILDER ───────────────────────────────────
function buildEmailTemplate({ firstName, title, body, action_url, buttonText, isBanned }) {
  const settingsUrl = isBanned
    ? null
    : `${process.env.CLIENT_URL}/settings/notifications`;

  const ctaBlock = action_url ? `
    <table cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td style="border-radius:10px;background:#f97316;">
          <a href="${process.env.CLIENT_URL}${action_url}"
             style="display:inline-block;padding:14px 28px;
                    color:#ffffff;font-size:14px;
                    font-weight:600;text-decoration:none;
                    border-radius:10px;">
            ${buttonText}
          </a>
        </td>
      </tr>
    </table>
  ` : '';

  const footerLinks = settingsUrl ? `
    <a href="${settingsUrl}" style="color:#f97316;text-decoration:none;">Manage notifications</a>
    &nbsp;·&nbsp;
    <a href="${settingsUrl}" style="color:#f97316;text-decoration:none;">Unsubscribe</a>
  ` : 'You received this notification from OxSteed.';

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
            <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Hi ${firstName},</p>
            <h1 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">${title}</h1>
            <p style="margin:0 0 28px;color:#4b5563;font-size:15px;line-height:1.6;">${body}</p>
            ${ctaBlock}
          </td></tr>
          <tr><td style="padding:20px 32px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
              You're receiving this because you have an OxSteed account.
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
  const failed = results.filter(r => r.status === 'rejected').length;
  console.log(`[Notification] Bulk sent: ${userIds.length - failed} ok, ${failed} failed`);
  return { sent: userIds.length - failed, failed };
};
