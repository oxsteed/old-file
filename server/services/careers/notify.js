'use strict';

// Careers notifications: one in-app row per event plus a Resend email
// (careers spec §11). Copy comes from utils/careerNotificationTemplates.js
// in the recipient's language. Delivery keys make every send idempotent,
// so a retried request or job never double-notifies.

const pool = require('../../db');
const logger = require('../../utils/logger');
const { tNotif } = require('../../utils/i18n');
const { sendEmail } = require('../../utils/email');
const { careerReasonText, careerCheckStatusText, careerFactText, careerInvitationReasonText } = require('../../utils/careerNotificationTemplates');
const { normalizeLocale } = require('./validation');

const APP_URL = () => String(process.env.CLIENT_URL || process.env.APP_URL || 'https://oxsteed.com').replace(/\/+$/, '');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderParams(params, lang) {
  const out = { ...(params || {}) };
  if (out.reasonCode) out.reason = careerReasonText(out.reasonCode, lang);
  if (out.statusCode) out.status = careerCheckStatusText(out.statusCode, lang);
  if (out.factType) out.fact = careerFactText(out.factType, lang);
  if (out.invitationReasonCode) out.invitationReason = careerInvitationReasonText(out.invitationReasonCode, lang);
  if (out.expiresAt) {
    try {
      out.expires = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: out.timeZone || 'UTC' }).format(new Date(out.expiresAt));
    } catch { out.expires = new Date(out.expiresAt).toISOString(); }
  }
  delete out.reasonCode;
  delete out.statusCode;
  delete out.factType;
  delete out.invitationReasonCode;
  delete out.expiresAt;
  return out;
}

function render(type, lang, params) {
  const language = normalizeLocale(lang);
  const text = tNotif(type, language, renderParams(params, language));
  return { language, title: text.title || type, body: text.body || '' };
}

function emailHtml({ title, body, url, lang }) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const link = url ? `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` : '';
  return `<!doctype html><html lang="${escapeHtml(lang)}" dir="${dir}"><body style="font-family:system-ui,sans-serif;line-height:1.5">`
    + `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${link}</body></html>`;
}

async function sendCareerEmail({ to, lang, type, params, actionUrl, deliveryKey, attachments }) {
  if (!to) return { success: false, error: 'no_recipient' };
  const { language, title, body } = render(type, lang, params);
  const url = actionUrl ? `${APP_URL()}${actionUrl.startsWith('/') ? '' : '/'}${actionUrl}` : null;
  try {
    return await sendEmail({
      to,
      subject: title,
      text: url ? `${body}\n\n${url}` : body,
      html: emailHtml({ title, body, url, lang: language }),
      idempotencyKey: deliveryKey ? `careers:${deliveryKey}` : undefined,
      attachments,
    });
  } catch (err) {
    logger.warn('careers email failed', { type, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Notifications audit item 6: careers email used to bypass every
 * preference (the user row was read without notification_preferences)
 * and failures were swallowed with .catch(() => {}). The central
 * preference check is honoured here at minimum for the master email
 * toggle and the global unsubscribe; a missing prefs row means allowed
 * (opt-out semantics, matching notificationService.prefAllows). A prefs
 * lookup failure fails closed for email only: the in-app row is still
 * written, the hiring action never blocks on mail.
 */
async function careerEmailAllowed(db, userId) {
  if (!userId) return false;
  const runner = db || pool;
  try {
    const { rows: [prefs] } = await runner.query(
      `SELECT email_notifications, unsubscribe_all
         FROM notification_preferences WHERE user_id = $1`,
      [userId]
    );
    if (!prefs) return true;
    if (prefs.unsubscribe_all === true) return false;
    if (prefs.email_notifications === false) return false;
    return true;
  } catch (err) {
    logger.warn('careers email preference check failed; skipping email', { userId, error: err.message });
    return false;
  }
}

// Fire-and-forget email that never fails the hiring action, but never
// swallows the outcome either: a failed send is logged instead of
// disappearing into .catch(() => {}).
function sendCareerEmailLogged(args) {
  return sendCareerEmail(args).then((result) => {
    if (!result?.success) {
      logger.warn('careers email failed', { type: args.type, error: result?.error || 'unknown' });
    }
    return result;
  }).catch((err) => {
    logger.warn('careers email failed', { type: args.type, error: err.message });
    return { success: false, error: err.message };
  });
}

/**
 * In-app + email to an account holder. Returns { inserted } so callers and
 * tests can tell a fresh send from an idempotent replay.
 */
async function notifyUser(db, { userId, type, params = {}, actionUrl = null, deliveryKey = null, email = true, attachments }) {
  if (!userId) return { inserted: false };
  const runner = db || pool;
  const { rows: [user] } = await runner.query(
    `SELECT u.id, u.email, u.preferred_language,
            np.email_notifications, np.unsubscribe_all
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
      WHERE u.id = $1`,
    [userId]
  );
  if (!user) return { inserted: false };
  const { title, body, language } = render(type, user.preferred_language, params);
  const { rowCount } = await runner.query(
    `INSERT INTO notifications (user_id, type, title, body, data, action_url, delivery_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (delivery_key) WHERE delivery_key IS NOT NULL DO NOTHING`,
    [userId, type, title.slice(0, 255), body, JSON.stringify({ params, careers: true }), actionUrl, deliveryKey]
  );
  const inserted = rowCount > 0;
  if (inserted && email && user.email) {
    // Notifications audit item 6: honour the master email toggle and the
    // global unsubscribe (the prefs row rides along in the user query
    // above, so no second lookup is needed). The in-app row is the hiring
    // record and is written regardless; only the email leg is gated.
    // Fire and forget: an email outage never fails the hiring action.
    const allowed = user.email_notifications !== false && user.unsubscribe_all !== true;
    if (allowed) {
      sendCareerEmailLogged({ to: user.email, lang: language, type, params, actionUrl, deliveryKey, attachments });
    }
  }
  return { inserted };
}

/**
 * Recipients for hiring-team notices on one opening: the business owner,
 * the opening's creator and active managers whose store scope covers it.
 */
async function hiringTeamRecipients(db, opening) {
  const runner = db || pool;
  if (opening.employer_type === 'platform') return opening.created_by ? [opening.created_by] : [];
  const { rows } = await runner.query(
    `SELECT b.user_id AS id FROM businesses b WHERE b.id = $1
     UNION
     SELECT $2::uuid WHERE $2::uuid IS NOT NULL
     UNION
     SELECT bm.member_id
       FROM business_members bm
      WHERE bm.business_id = $1 AND bm.status = 'active' AND bm.role = 'manager'
        AND (
          cardinality($3::bigint[]) = 0
          OR NOT EXISTS (SELECT 1 FROM restaurant_location_memberships lm WHERE lm.membership_id = bm.id AND lm.status = 'active')
          OR EXISTS (SELECT 1 FROM restaurant_location_memberships lm
                      WHERE lm.membership_id = bm.id AND lm.status = 'active' AND lm.location_id = ANY($3::bigint[]))
          OR EXISTS (SELECT 1 FROM career_hiring_scopes s WHERE s.membership_id = bm.id AND s.revoked_at IS NULL)
        )`,
    [opening.business_id, opening.created_by || null, (opening.location_ids || []).map(Number)]
  );
  return [...new Set(rows.map((r) => r.id).filter(Boolean))];
}

async function notifyHiringTeam(db, opening, { type, params = {}, actionUrl = null, deliveryKey }) {
  const recipients = await hiringTeamRecipients(db, opening);
  for (const userId of recipients) {
    await notifyUser(db, { userId, type, params, actionUrl, deliveryKey: deliveryKey ? `${deliveryKey}:${userId}` : null });
  }
  return recipients.length;
}

/**
 * Notify the applicant on an application: in-app when they have an
 * account, otherwise email only (guests).
 */
async function notifyApplicant(db, application, { type, params = {}, actionUrl = '/careers/me', deliveryKey, attachments }) {
  if (application.user_id) {
    return notifyUser(db, { userId: application.user_id, type, params, actionUrl, deliveryKey, attachments });
  }
  if (application.applicant_email && !application.anonymized_at) {
    // Guest applicants have no account and no prefs row, so there is
    // nothing to honour; a failed send is still logged, not swallowed.
    sendCareerEmailLogged({ to: application.applicant_email, lang: application.locale, type, params, actionUrl, deliveryKey, attachments });
    return { inserted: true, emailOnly: true };
  }
  return { inserted: false };
}

module.exports = {
  escapeHtml,
  emailHtml,
  render,
  sendCareerEmail,
  careerEmailAllowed,
  notifyUser,
  hiringTeamRecipients,
  notifyHiringTeam,
  notifyApplicant,
};
