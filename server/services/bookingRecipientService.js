'use strict';

/**
 * Group 3 (Recipient and sponsor, items 101-150): shared helpers for the
 * recipient/site-contact/sponsor surfaces.
 *
 * Party model (D-10, D-40): the booker pays and decides; the recipient is
 * who the work is for; the site contact is who is on site; the sponsor is
 * a third party who pays for one booking with their own card. Nobody but
 * the booker ever sees another party's payment details (D-41), and no
 * phone number is ever shown to a non-booker unmasked (D-43).
 *
 * This module owns no routes. It is required by bookingRecipientController
 * and, for the completion/arrival notices, by bookingController. It
 * requires only db/notification/socket/email, so there is no cycle.
 */

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');
const { broadcastToUser } = require('./socketService');
const { sendEmail } = require('../utils/email');

const VISIT_REMINDER_TYPES = Object.freeze({
  reminder: 'booking_visit_reminder',
  arrived: 'booking_provider_arrived',
  completed: 'booking_visit_completed',
});

/** Mask a phone number to its last two digits (D-43). */
function maskPhone(phone) {
  const value = String(phone || '');
  if (!value) return null;
  let kept = 0;
  let out = '';
  for (let i = value.length - 1; i >= 0; i -= 1) {
    const ch = value[i];
    if (/[0-9]/.test(ch) && kept < 2) {
      kept += 1;
      out = ch + out;
    } else if (/[0-9]/.test(ch)) {
      out = '•' + out;
    } else {
      out = ch + out;
    }
  }
  return out;
}

/** Opaque fingerprint of a status/invite token for opt-out/archive rows. */
function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function isTokenShape(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/**
 * Resolve who the caller is for one booking. The caller is identified by
 * an account id, a status/invite token, or both. Returns null for a
 * stranger. A sponsorship invite token resolves to the sponsor role with
 * its sponsorship id; the recipient and site-contact tokens resolve to
 * their roles. The booker and helper resolve by account only.
 */
async function resolveParty(booking, { userId = null, token = null } = {}) {
  const uid = userId ? String(userId) : null;
  if (uid && String(booking.customer_id) === uid) {
    return { role: 'booker', via: 'account', userId: uid };
  }
  if (uid && booking.helper_id && String(booking.helper_id) === uid) {
    return { role: 'helper', via: 'account', userId: uid };
  }
  if (uid && booking.recipient_user_id && String(booking.recipient_user_id) === uid) {
    return { role: 'recipient', via: 'account', userId: uid };
  }
  if (uid && booking.site_contact_user_id && String(booking.site_contact_user_id) === uid) {
    return { role: 'site_contact', via: 'account', userId: uid };
  }
  if (token && isTokenShape(token)) {
    if (booking.recipient_token && String(booking.recipient_token) === token) {
      return { role: 'recipient', via: 'token', userId: uid, token };
    }
    if (booking.status_token && String(booking.status_token) === token) {
      return { role: 'site_contact', via: 'token', userId: uid, token };
    }
    const { rows } = await pool.query(
      `SELECT id, sponsor_user_id FROM booking_sponsorships
        WHERE invite_token = $1 AND booking_id = $2 LIMIT 1`,
      [token, booking.id]
    );
    if (rows.length) {
      return {
        role: 'sponsor',
        via: 'token',
        userId: uid,
        token,
        sponsorshipId: String(rows[0].id),
        sponsorUserId: rows[0].sponsor_user_id ? String(rows[0].sponsor_user_id) : null,
      };
    }
  }
  if (uid) {
    const { rows } = await pool.query(
      `SELECT id FROM booking_sponsorships
        WHERE booking_id = $1 AND sponsor_user_id = $2
          AND status IN ('invited', 'accepted', 'paid')
        LIMIT 1`,
      [booking.id, uid]
    );
    if (rows.length) {
      return { role: 'sponsor', via: 'account', userId: uid, sponsorshipId: String(rows[0].id) };
    }
  }
  return null;
}

async function loadBooking(bookingId) {
  const { rows } = await pool.query('SELECT * FROM booking_requests WHERE id = $1', [bookingId]);
  return rows[0] || null;
}

/** True when this party muted notifications for this booking (item 146). */
async function isMuted(bookingId, { userId = null, token = null } = {}) {
  const { rows } = await pool.query(
    `SELECT 1 FROM booking_notification_opt_outs
      WHERE booking_id = $1 AND (user_id = $2 OR token_hash = $3) LIMIT 1`,
    [bookingId, userId || null, token ? tokenHash(token) : null]
  );
  return rows.length > 0;
}

/**
 * Notify one account party about a booking, unless they muted this
 * booking. Best-effort: a failed send never breaks the caller's write.
 */
async function notifyAccountParty({ booking, userId, type, body, data = {}, actionUrl = '/my-bookings', idempotencyKey }) {
  if (!userId) return false;
  try {
    if (await isMuted(booking.id, { userId: String(userId) })) return false;
  } catch (err) {
    logger.warn('Recipient mute check failed; notifying anyway', { error: err.message });
  }
  try {
    broadcastToUser(String(userId), 'booking:updated', { bookingId: booking.id, status: booking.status });
    await sendNotification({
      userId: String(userId),
      type,
      body,
      data: { bookingId: booking.id, ...data },
      action_url: actionUrl,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    return true;
  } catch (err) {
    logger.warn('Failed to notify booking party', { bookingId: booking.id, type, error: err.message });
    return false;
  }
}

/** Email the token parties who registered for visit updates (D-51). */
async function emailTokenParties(booking, kind, { subject, text }) {
  try {
    const { rows } = await pool.query(
      `SELECT link_kind, email FROM booking_link_update_emails WHERE booking_id = $1`,
      [booking.id]
    );
    for (const row of rows) {
      // G3-12 (item 146): a token party who opted out stops getting
      // emails. The opt-out is recorded by token hash; the token for a
      // link kind is the booking's own token for that role.
      try {
        const token = row.link_kind === 'recipient'
          ? booking.recipient_token
          : row.link_kind === 'site_contact' ? booking.status_token : null;
        if (token && await isMuted(booking.id, { token })) continue;
      } catch (err) {
        logger.warn('Recipient mute check failed; emailing anyway', { error: err.message });
      }
      try {
        await sendEmail({
          to: row.email,
          subject,
          text: `${text}\n\nService: ${booking.service_name || ''}\nDate: ${booking.requested_date || ''}\n`,
        });
      } catch (err) {
        logger.warn('Failed to email token party', { bookingId: booking.id, kind, error: err.message });
      }
    }
  } catch (err) {
    logger.warn('Failed to load token update emails', { bookingId: booking.id, error: err.message });
  }
}

/** The visit happened: tell the recipient and site contact (item 105). */
async function notifyVisitCompleted(booking) {
  const body = `${booking.service_name}, ${booking.requested_date}`;
  await notifyAccountParty({
    booking,
    userId: booking.recipient_user_id,
    type: VISIT_REMINDER_TYPES.completed,
    body,
    actionUrl: '/my-bookings',
    idempotencyKey: `booking-visit-completed:${booking.id}:recipient`,
  });
  await notifyAccountParty({
    booking,
    userId: booking.site_contact_user_id,
    type: VISIT_REMINDER_TYPES.completed,
    body,
    actionUrl: '/my-bookings',
    idempotencyKey: `booking-visit-completed:${booking.id}:site-contact`,
  });
  await emailTokenParties(booking, 'completed', {
    subject: 'Your visit is complete',
    text: `The visit for ${booking.service_name} is complete.`,
  });
}

/** The provider arrived: tell the booker, recipient, and site contact (item 103). */
async function notifyProviderArrived(booking) {
  const body = `${booking.service_name}, ${booking.requested_date}`;
  await notifyAccountParty({
    booking,
    userId: booking.customer_id,
    type: VISIT_REMINDER_TYPES.arrived,
    body,
    actionUrl: '/my-bookings',
    idempotencyKey: `booking-visit-arrived:${booking.id}:booker`,
  });
  await notifyAccountParty({
    booking,
    userId: booking.recipient_user_id,
    type: VISIT_REMINDER_TYPES.arrived,
    body,
    actionUrl: '/my-bookings',
    idempotencyKey: `booking-visit-arrived:${booking.id}:recipient`,
  });
  await notifyAccountParty({
    booking,
    userId: booking.site_contact_user_id,
    type: VISIT_REMINDER_TYPES.arrived,
    body,
    actionUrl: '/my-bookings',
    idempotencyKey: `booking-visit-arrived:${booking.id}:site-contact`,
  });
  await emailTokenParties(booking, 'arrived', {
    subject: 'Your provider has arrived',
    text: `The provider for ${booking.service_name} has arrived.`,
  });
}

/** One notice to the booker about a recipient/site-contact act (D-44). */
async function notifyBookerOfSiteAction(booking, { actionLabel, detail, idempotencyKey }) {
  return notifyAccountParty({
    booking,
    userId: booking.customer_id,
    type: 'booking_site_action',
    body: `${booking.service_name}: ${actionLabel}${detail ? ` (${detail})` : ''}`,
    data: { actionLabel },
    actionUrl: '/my-bookings',
    // Stable per event (G3-30): callers pass the action/ticket row id so
    // a retry or double-submit dedupes instead of double-sending.
    idempotencyKey: idempotencyKey || `booking-site-action:${booking.id}:${detail || actionLabel}`,
  });
}

/** Sums over a booking's sponsorships, by live status. */
async function sponsorshipTotals(bookingId) {
  const { rows } = await pool.query(
    `SELECT status, COALESCE(SUM(amount_cents), 0)::int AS cents
       FROM booking_sponsorships WHERE booking_id = $1 GROUP BY status`,
    [bookingId]
  );
  const totals = { invited: 0, accepted: 0, declined: 0, paid: 0, expired: 0, refunded: 0, voided: 0 };
  for (const row of rows) totals[row.status] = Number(row.cents || 0);
  totals.live = totals.invited + totals.accepted + totals.paid;
  return totals;
}

/** Cents already paid by sponsors toward this booking (D-40, D-581). */
async function paidSponsorshipCents(bookingId) {
  // D-581: paid additional charges are extra work on top of the booking
  // total, so they never reduce the booker's remaining amount.
  const totals = await sponsorshipTotals(bookingId);
  return totals.paid;
}

/** Helper name for provider-identity confirmation (D-42). */
async function helperName(helperId) {
  if (!helperId) return null;
  const { rows } = await pool.query(
    'SELECT first_name, last_name FROM users WHERE id = $1 LIMIT 1',
    [helperId]
  );
  if (!rows.length) return null;
  const first = String(rows[0].first_name || '').trim();
  const last = String(rows[0].last_name || '').trim();
  return {
    firstName: first || null,
    lastName: last || null,
    fullName: [first, last].filter(Boolean).join(' ') || null,
    // Door check on the public page: first name plus last initial only.
    doorName: first ? `${first} ${last ? `${last[0]}.` : ''}`.trim() : null,
  };
}

/**
 * Visit reminders (item 102, D-46). The booking maintenance sweep calls
 * this every 15 minutes: one reminder per linked account party when the
 * visit is tomorrow, recorded so retries never double-send. Token parties
 * with a registered update email get the same reminder by email.
 */
async function sendVisitReminders() {
  const { rows: bookings } = await pool.query(
    `SELECT * FROM booking_requests
      WHERE status IN ('pending', 'accepted')
        AND requested_date = (CURRENT_DATE + INTERVAL '1 day')::date
        AND (recipient_user_id IS NOT NULL OR site_contact_user_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM booking_link_update_emails e WHERE e.booking_id = booking_requests.id))`
  );
  let sent = 0;
  for (const booking of bookings) {
    for (const [role, userId] of [
      ['recipient', booking.recipient_user_id],
      ['site_contact', booking.site_contact_user_id],
    ]) {
      if (!userId) continue;
      // G3-24: the dedupe row is written only after the send succeeds
      // (or the party is muted, which is a deliberate end-state). A
      // failed send leaves no row, so the next sweep retries it.
      if (await isMuted(booking.id, { userId: String(userId) })) {
        await pool.query(
          `INSERT INTO booking_visit_reminders (booking_id, party_role)
           VALUES ($1, $2) ON CONFLICT (booking_id, party_role) DO NOTHING`,
          [booking.id, role]
        );
        continue;
      }
      const already = await pool.query(
        `SELECT 1 FROM booking_visit_reminders WHERE booking_id = $1 AND party_role = $2`,
        [booking.id, role]
      );
      if (already.rows.length) continue;
      const ok = await notifyAccountParty({
        booking,
        userId,
        type: VISIT_REMINDER_TYPES.reminder,
        body: `${booking.service_name}, ${booking.requested_date}`,
        actionUrl: '/my-bookings',
        idempotencyKey: `booking-visit-reminder:${booking.id}:${role}`,
      });
      if (ok) {
        await pool.query(
          `INSERT INTO booking_visit_reminders (booking_id, party_role)
           VALUES ($1, $2) ON CONFLICT (booking_id, party_role) DO NOTHING`,
          [booking.id, role]
        );
        sent += 1;
      }
    }
    // Token parties share the same once-per-role record: the email goes
    // out only when the role's reminder row is newly inserted above, or
    // when no account party exists for that role.
    const { rows: emailRows } = await pool.query(
      `SELECT link_kind, email FROM booking_link_update_emails WHERE booking_id = $1`,
      [booking.id]
    );
    for (const emailRow of emailRows) {
      // G3-24 + G3-12: the row is the once-per-role record shared with
      // the account leg, so an already-reminded role is skipped; a muted
      // token party is skipped without a row (opting back in re-enables
      // the reminder); a failed send leaves no row and retries next sweep.
      const already = await pool.query(
        `SELECT 1 FROM booking_visit_reminders WHERE booking_id = $1 AND party_role = $2`,
        [booking.id, emailRow.link_kind]
      );
      if (already.rows.length) continue;
      const token = emailRow.link_kind === 'recipient'
        ? booking.recipient_token
        : emailRow.link_kind === 'site_contact' ? booking.status_token : null;
      if (token && await isMuted(booking.id, { token })) continue;
      try {
        await sendEmail({
          to: emailRow.email,
          subject: 'Reminder: your visit is tomorrow',
          text: `Reminder: the visit for ${booking.service_name} is tomorrow, ${booking.requested_date}.\n`,
        });
        await pool.query(
          `INSERT INTO booking_visit_reminders (booking_id, party_role)
           VALUES ($1, $2) ON CONFLICT (booking_id, party_role) DO NOTHING`,
          [booking.id, emailRow.link_kind]
        );
        sent += 1;
      } catch (err) {
        logger.warn('Failed to email visit reminder', { bookingId: booking.id, error: err.message });
      }
    }
  }
  return { sent, checked: bookings.length };
}

module.exports = {
  maskPhone,
  tokenHash,
  isTokenShape,
  resolveParty,
  loadBooking,
  isMuted,
  notifyAccountParty,
  notifyBookerOfSiteAction,
  notifyVisitCompleted,
  notifyProviderArrived,
  emailTokenParties,
  sponsorshipTotals,
  paidSponsorshipCents,
  helperName,
  sendVisitReminders,
  VISIT_REMINDER_TYPES,
};
