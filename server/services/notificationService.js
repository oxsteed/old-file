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
const { maskEmail } = require('../utils/directQuote');

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

// ─── Preference aliases ─────────────────────────────────────────
// The settings UI exposes friendly toggle names that do not match the
// canonical notification type sent by the backend (e.g. the "New bid on my
// job" toggle is stored as in_app_new_bid/push_new_bid while the event is
// bid_received). Each alias below acts as an ADDITIONAL kill-switch for the
// mapped canonical types: turning the friendly toggle off suppresses the
// channel for that type, same as the canonical pref key.
const PREF_ALIASES = {
  in_app: {
    bid_received: ['in_app_new_bid'],
    subscription_renewed: ['in_app_subscription'],
    subscription_cancelled: ['in_app_subscription'],
    subscription_past_due: ['in_app_subscription'],
  },
  push: {
    bid_received: ['push_new_bid'],
  },
  email: {
    subscription_renewed: ['email_subscription'],
    subscription_cancelled: ['email_subscription'],
    subscription_past_due: ['email_subscription'],
  },
};

// A channel is allowed for a type when neither the canonical pref key nor
// any of its UI aliases is explicitly false. Absent columns/keys default to
// allowed (opt-out semantics, matching the existing `!== false` convention).
function prefAllows(prefs, channel, type) {
  const key = `${channel}_${String(type).replace(':', '_')}`;
  if (prefs[key] === false) return false;
  const aliases = (PREF_ALIASES[channel] || {})[type] || [];
  return aliases.every((alias) => prefs[alias] !== false);
}

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
  // Item 9: lets a caller suppress realtime email for this send while still
  // delivering in-app (e.g. the admin opted out of email for metric alerts).
  // Defaults to true: no behavior change for existing callers.
  emailChannel = true,
  inAppChannel = true,
  pushChannel = true,
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
    const inAppEnabled = inAppChannel && prefAllows(prefs, 'in_app', type);
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
    // The push_notifications master toggle gates every push channel
    // (Expo, Web Push, native APNs/FCM): it is checked here because the
    // Web Push and native mobile blocks below both build on pushEnabled.
    const pushEnabled = pushChannel && prefs.push_notifications !== false
      && prefAllows(prefs, 'push', type)
      && !inQuietHours;
    // Tracks delivery across channels in this call. notificationRow is the
    // INSERT..RETURNING snapshot and never sees the UPDATEs below, so checking
    // it alone let Expo, Web Push and native push all fire for one event.
    let pushDelivered = !!notificationRow?.is_push_sent;
    if (token && pushEnabled && !pushDelivered && Expo.isExpoPushToken(token)) {
      const expoOk = await sendPushNotification(token, finalTitle, finalBody, data, notifId);
      if (expoOk) pushDelivered = true;
      if (expoOk && notifId) {
        await db.query(
          `UPDATE notifications SET is_push_sent = true WHERE id = $1`,
          [notifId]
        );
      }
    }

    // ── 3b. Web Push (browser, VAPID) ─────────────────────────
    // Master toggle (web_push_enabled) + per-event `push_*` pref.
    const webPushEnabled = prefs.web_push_enabled !== false
      && prefs.push_notifications !== false
      && !inQuietHours;
    if (pushEnabled && webPushEnabled && !pushDelivered && webPushService.isConfigured()) {
      try {
        const result = await webPushService.sendToUser(userId, {
          id: notifId,
          type,
          title: finalTitle,
          body: finalBody,
          data,
          action_url,
        });
        if (result.sent > 0) pushDelivered = true;
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
    if (pushEnabled && !inQuietHours && !pushDelivered && mobilePushService.isConfigured()) {
      try {
        const result = await mobilePushService.sendToUser(userId, {
          notifId,
          type,
          title: finalTitle,
          body: finalBody,
          data,
          action_url,
        });
        if (result.sent > 0) pushDelivered = true;
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
    const emailPrefOff = !prefAllows(prefs, 'email', type);
    // Respect global unsubscribe: if user opted out of all, skip non-transactional.
    const unsubscribedAll = !!prefs.unsubscribe_all;
    const emailTypes = [
      'bid_accepted', 'payment_released', 'payment_receipt', 'food_order_ready', 'subscription_renewed',
      'subscription_cancelled', 'subscription_past_due',
      'dispute_update', 'dispute_opened', 'dispute_opened_against', 'dispute_under_review', 'dispute_resolved',
      // Chat messages: gated by the user's email_new_message preference
      // toggle (previously the toggle existed in settings but the type was
      // never attempted, so the toggle was dead).
      'new_message',
      'payout_deposited', 'payout_requested', 'payout_approved', 'payout_rejected', 'account_banned',
      'oxsteed_credit_transaction', 'oxsteed_credit_card_security',
      'credit_identity_verification_requested', 'credit_identity_verification_approved',
      'credit_identity_verification_rejected', 'credit_sanctions_review_required',
      'credit_sanctions_cleared', 'credit_sanctions_confirmed',
      'credit_identity_verification_expired', 'credit_identity_verification_expiring',
      'credit_identity_verification_appeal_submitted', 'credit_identity_verification_appeal_approved',
      'credit_identity_verification_appeal_rejected',
      // Monthly statement issuance: generic authenticated-link email, no
      // amounts or attachments. Respects the user's email preference toggle.
      'statement_ready',
      // Statement amendment publication: same shape as statement_ready.
      'statement_amended',
      // Account integrity / admin actions — user should receive email by default
      'account_restored', 'account_suspended', 'account_restricted',
      'account_deletion_scheduled', 'admin_warning',
      // P3-1-F12: payout destination changes are security notices; the user
      // must hear about them even if they turned off marketing emails.
      'payout_destination_changed',
      // Direct booking notifications
      'booking_request_new', 'booking_accepted', 'booking_declined',
      'booking_cancelled', 'booking_auto_released',
      // Agreement/job lifecycle notices respect the participant's email choices.
      'warranty_claim_filed', 'warranty_claim_updated', 'job_started',
      'learn_video_review_received', 'learn_video_review_overdue',
      // Logistics campaign review decisions: the organizer learns about
      // Operations approve / request-revisions / reject by email too
      // (non-transactional: respects their email frequency/prefs).
      'logistics_campaign_approved', 'logistics_campaign_revisions_requested',
      'logistics_campaign_rejected',
      'logistics_payment_succeeded','logistics_payment_failed','logistics:quote_published','logistics:quote_accepted',
      'logistics:refund_proposed','logistics:refund_approved','logistics:refund_pending','logistics:refund_rejected','logistics:refund_processed','logistics:refund_failed','logistics:refund_expired',
      // Analytics platform, Phase 2 Item 9: metric threshold alerts for
      // admins. Non-transactional: respects the recipient's email toggles
      // (the job additionally gates on admin_notification_prefs).
      'metric_threshold_alert',
      'restaurant_loyalty_campaign',
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
      'payout_destination_changed',
      'oxsteed_credit_transaction', 'oxsteed_credit_card_security',
      'credit_identity_verification_requested', 'credit_identity_verification_approved',
      'credit_identity_verification_rejected', 'credit_sanctions_review_required',
      'credit_sanctions_cleared', 'credit_sanctions_confirmed',
      'credit_identity_verification_expired', 'credit_identity_verification_expiring',
      'credit_identity_verification_appeal_submitted', 'credit_identity_verification_appeal_approved',
      'credit_identity_verification_appeal_rejected',
    ]);
    // Review P3-845: money failures (and the ops alerts about them) must
    // reach email too; they were missing from the allow-list, so they only
    // ever produced an in-app row.
    if (isMoneyCriticalEmailType(type)) {
      if (!emailTypes.includes(type)) emailTypes.push(type);
      transactionalEmailTypes.add(type);
    }
    const emailAllowed = emailChannel && userEmail && emailTypes.includes(type)
      && (transactionalEmailTypes.has(type)
        ? true
        : !emailPrefOff && prefs.email_notifications !== false)
      && !(unsubscribedAll && !transactionalEmailTypes.has(type));
    // P2-8-F04: honor the user's email_frequency. The digest batch was the
    // only reader, so 'off' did not stop realtime mail and 'daily'/'weekly'
    // never received anything (nothing populated the digest queue).
    // Transactional mail always goes out immediately. For everything else:
    // 'off' drops realtime mail, 'daily'/'weekly' queues it for the digest
    // batch instead of sending it now.
    const isTransactionalEmail = transactionalEmailTypes.has(type);
    const emailFrequency = String(prefs.email_frequency || 'real-time');
    let sendRealtimeEmail = emailAllowed;
    let emailDelivered = !!notificationRow?.is_email_sent;
    let emailQueued = false;
    if (emailAllowed && !isTransactionalEmail) {
      if (emailFrequency === 'off') {
        logger.debug('[Notification] realtime email suppressed: frequency=off', { userId, type });
        sendRealtimeEmail = false;
      } else if ((emailFrequency === 'daily' || emailFrequency === 'weekly') && !notifId) {
        // An email-only caller must not create a visible in-app row, so the
        // digest entry carries its own localized payload (migration 898). A
        // delivery key is required so a retry cannot queue it twice; without
        // one, fall back to realtime email rather than dropping it.
        if (deliveryKey) {
          try {
            await db.query(
              `INSERT INTO email_digest_queue
                 (user_id, notification_id, digest_type, notification_type, title, body, delivery_key)
               VALUES ($1, NULL, $2, $3, $4, $5, $6)
               ON CONFLICT (delivery_key) WHERE delivery_key IS NOT NULL DO NOTHING`,
              [userId, emailFrequency, type, finalTitle || type, finalBody || '', deliveryKey]
            );
            emailQueued = true;
            sendRealtimeEmail = false;
            logger.debug('[Notification] email-only entry queued for digest', { userId, type, emailFrequency });
          } catch (queueErr) {
            logger.warn('[Notification] email-only digest queue insert failed; sending realtime', {
              userId, type, error: queueErr.message,
            });
          }
        }
      } else if ((emailFrequency === 'daily' || emailFrequency === 'weekly') && notifId) {
        try {
          await db.query(
            `INSERT INTO email_digest_queue (user_id, notification_id, digest_type)
             VALUES ($1, $2, $3)
             ON CONFLICT (notification_id) DO NOTHING`,
            [userId, notifId, emailFrequency]
          );
          emailQueued = true;
          logger.debug('[Notification] queued for email digest', { userId, type, emailFrequency });
          sendRealtimeEmail = false;
        } catch (queueErr) {
          // Fail open on the queue write: the user still gets the email, just
          // immediately instead of in the digest. Never drop it silently.
          logger.warn('[Notification] digest queue insert failed; sending realtime', {
            userId, type, error: queueErr.message,
          });
        }
      }
    }
    if (sendRealtimeEmail && !notificationRow?.is_email_sent) {
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
      emailDelivered = delivery?.success === true;
      if (type === 'oxsteed_credit_card_security' && delivery?.success !== true) {
        throw new Error('Card security email delivery unavailable');
      }
      // Only mark as sent if delivery was confirmed.
      if (notifId && delivery?.success === true) {
        await db.query(
          `UPDATE notifications SET is_email_sent = true WHERE id = $1`,
          [notifId]
        );
      }
      // P3-3-F13: an attempted realtime email that failed must not be
      // reported as delivered. Outbox workers mark the row sent on
      // success:true, so swallowing the failure here loses the email
      // (e.g. a template-render exception inside sendEmailNotification).
      // Propagate it so the row is retried instead of marked sent. The
      // in-app row is already persisted and the delivery key dedupes the
      // retry, so push/email resume without duplicating. A missing provider
      // outside production is an expected dev condition, not a failure.
      const emailFailed = delivery?.success !== true
        && !(delivery?.code === 'email_not_configured' && process.env.NODE_ENV !== 'production');
      if (emailFailed) {
        return { success: false, error: delivery?.error || 'Email delivery failed', notificationId: notifId };
      }
    }
    return { success: true, notificationId: notifId,
      ...(type === 'metric_threshold_alert' ? { delivered: !!notifId || pushDelivered || emailDelivered || emailQueued } : {}) };
  } catch (err) {
    logger.error('Send notification failed', { userId, type, error: err.message });
    // Never throw - notification failure should never block business logic
    return { success: false, error: err.message };
  }
};

// Review P3-845: notification types that report failed or reversed money
// movement. They are transactional: the recipient cannot opt out by email
// toggle, because each one asks them (or an operator) to act.
const MONEY_CRITICAL_EMAIL_TYPES = new Set([
  'payment_failed',
  'payout_failed',
  'refund',
  'refund_failed',
  'oxsteed_credit_withdrawal_failed',
  'oxsteed_credit_withdrawal_paid_then_failed',
  'oxsteed_credit_settlement_payout_failed',
  'oxsteed_credit_chargeback_unlinked',
  'oxsteed_credit_chargeback_terminal_conflict',
  'restaurant_credit_failed_pos_payments',
  'webhook_delivery_failed',
]);
const MONEY_CRITICAL_PATTERN = /^(oxsteed_credit|restaurant_credit|admin_audit)_[a-z_]*(failed|failure)$/;
function isMoneyCriticalEmailType(type) {
  const value = String(type || '');
  return MONEY_CRITICAL_EMAIL_TYPES.has(value) || MONEY_CRITICAL_PATTERN.test(value);
}

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
    return tickets.some((ticket) => ticket.status === 'ok');
  } catch (err) {
    logger.error('Send push notification failed', { token: redactPushToken(token), error: err.message });
    return false;
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
  // P3-3-F13: keep template rendering separate from provider delivery so a
  // render failure is identifiable (and retryable) instead of being lumped
  // in with provider errors.
  const translations = fallbackTranslations || tNotifEmail(type, language);
  const buttonText = translations.buttonText
    || tNotifEmail('default', language).buttonText
    || 'View Dashboard';

  let rendered;
  try {
    rendered = buildEmailTemplate({
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
  } catch (err) {
    logger.error('Email template render failed', { type, error: err.message });
    return { success: false, error: err.message, code: 'template_render_failed' };
  }

  try {
    return await sendEmail({
      to,
      subject: title,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: idempotencyKey || undefined,
    });
  } catch (err) {
    // Review P3-852: mask the recipient address in logs (PII).
    logger.error('Send email notification failed', { to: maskEmail(to), type, error: err.message });
    return { success: false, error: err.message };
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
exports.sendBulkNotification = async ({ userIds, type, title, body, data = {}, idempotencyKey = null }) => {
  // Audit fix: cap bulk notifications at 1000 recipients to prevent abuse.
  const MAX_BULK_RECIPIENTS = 1000;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new Error('userIds must be a non-empty array');
  }
  if (userIds.length > MAX_BULK_RECIPIENTS) {
    throw new Error(`Bulk notification limited to ${MAX_BULK_RECIPIENTS} recipients`);
  }
  // Notifications audit: without a per-recipient delivery key, a retried
  // bulk send (crash mid-fan-out, caller retry) inserts duplicate in-app
  // rows and re-fires push/email for everyone already notified. When the
  // caller supplies idempotencyKey, each recipient gets a deterministic
  // key so a repeat of the same bulk replays instead of duplicating.
  const bulkKey = idempotencyKey ? String(idempotencyKey).trim().slice(0, 200) : null;
  const results = await Promise.allSettled(
    userIds.map(userId =>
      exports.sendNotification({
        userId, type, title, body, data,
        ...(bulkKey ? { idempotencyKey: `${bulkKey}:${userId}` } : {}),
      })
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
exports.isMoneyCriticalEmailType = isMoneyCriticalEmailType;
