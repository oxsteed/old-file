'use strict';

/**
 * Group 3 (Recipient and sponsor, roadmap items 101-150).
 *
 * Everything the recipient, the site contact, and the sponsor do on a
 * booking, on top of the G-6/G-7 foundation (recipient/site-contact
 * columns, tokens, consent, chat admission, jobs carry-over).
 *
 * Party model: the booker pays and decides; the recipient is who the work
 * is for; the site contact is who is on site; the sponsor is a third
 * party who pays for one booking with their own card (D-40). Amounts are
 * visible only to the booker and, for their own payment, to the sponsor
 * (D-41). Phone numbers are masked in every non-booker view (D-43).
 *
 * Two entry shapes: account endpoints under /bookings/:id/... (requireAuth)
 * and token endpoints under /bookings/status/:token/... (public, token
 * gated, mirroring respondToRecipientInvite). Both resolve through
 * bookingRecipientService.resolveParty and share the same core functions.
 */

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const { sendValidationError, sendError } = require('../utils/apiError');
const { sendNotification } = require('../services/notificationService');
const { broadcastToUser } = require('../services/socketService');
const { uploadFile, getSignedDownloadUrl } = require('../utils/storage');
const { scheduleSupportMessageNotifications } = require('../services/supportNotificationService');
const recipientSvc = require('../services/bookingRecipientService');

const SITE_ACTION_TYPES = [
  'acknowledge_instructions', 'request_callback', 'suggest_window',
  'report_entry_problem', 'confirm_handoff', 'acknowledge_completion',
];
const SITE_ACTION_LABELS = {
  acknowledge_instructions: 'Acknowledged arrival instructions',
  request_callback: 'Requested a callback',
  suggest_window: 'Suggested an access window',
  report_entry_problem: 'Reported an entry problem',
  confirm_handoff: 'Confirmed handoff',
  acknowledge_completion: 'Acknowledged completion',
};
const SUPPORT_KINDS = ['general', 'missed_provider', 'payment', 'callback'];
const SUPPORT_CATEGORIES = { general: 'general', missed_provider: 'general', payment: 'billing', callback: 'general' };
const MAX_SPONSORSHIP_CENTS = 5000000;
const MIN_SPONSORSHIP_CENTS = 50;

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function inviteLinkUsable(booking) {
  if (!booking) return false;
  if (booking.status_token_revoked_at) return false;
  if (booking.status_token_expires_at && new Date(booking.status_token_expires_at) <= new Date()) return false;
  return true;
}

async function logBookingAudit(bookingId, action, actorId, actorType, oldStatus, newStatus) {
  try {
    await pool.query(
      `INSERT INTO booking_request_audit_log (booking_request_id, action, actor_id, actor_type, old_status, new_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bookingId, action, actorId, actorType, oldStatus, newStatus]
    );
  } catch (err) {
    logger.warn('Failed to log booking audit', { error: err.message });
  }
}

function stripeClient() {
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

function requireStripe(res) {
  if (!process.env.STRIPE_SECRET_KEY) {
    sendError(res, 503, 'Card payments are not configured', 'stripe_not_configured');
    return null;
  }
  return stripeClient();
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max) || null;
}

function cleanCents(value) {
  const cents = Math.round(Number(value));
  if (!Number.isFinite(cents)) return null;
  return cents;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ─── party loading ────────────────────────────────────────────────────────

/** Account endpoint: load the booking and resolve the caller's party. */
async function loadAccountBooking(req, res, allowedRoles) {
  const bookingId = String(req.params.bookingId || '');
  if (!isUuid(bookingId)) {
    sendError(res, 404, 'Booking request not found');
    return null;
  }
  const booking = await recipientSvc.loadBooking(bookingId);
  if (!booking) {
    sendError(res, 404, 'Booking request not found');
    return null;
  }
  const party = await recipientSvc.resolveParty(booking, { userId: req.user?.id });
  if (!party || (allowedRoles && !allowedRoles.includes(party.role))) {
    sendError(res, 403, 'You do not have access to this booking');
    return null;
  }
  return { booking, party };
}

/** Token endpoint: load the booking by its status/invite token. */
async function loadTokenBooking(req, res, allowedRoles) {
  const token = String(req.params.token || '');
  if (!recipientSvc.isTokenShape(token)) {
    sendError(res, 404, 'Booking status link not found');
    return null;
  }
  const { rows } = await pool.query(
    `SELECT * FROM booking_requests WHERE status_token = $1 OR recipient_token = $1`,
    [token]
  );
  let booking = rows[0] || null;
  let party = null;
  if (booking) {
    party = await recipientSvc.resolveParty(booking, { userId: req.user?.id, token });
  }
  if (!booking || !party) {
    // A sponsorship invite token lives on its own row, not on the booking.
    const { rows: sponsorRows } = await pool.query(
      `SELECT b.* FROM booking_sponsorships s JOIN booking_requests b ON b.id = s.booking_id
        WHERE s.invite_token = $1 LIMIT 1`,
      [token]
    );
    booking = sponsorRows[0] || null;
    if (booking) party = await recipientSvc.resolveParty(booking, { userId: req.user?.id, token });
  }
  if (!booking || !party) {
    sendError(res, 404, 'Booking status link not found');
    return null;
  }
  if ((party.role === 'recipient' || party.role === 'site_contact') && !inviteLinkUsable(booking)) {
    sendError(res, 404, 'Booking status link not found');
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(party.role)) {
    sendError(res, 403, 'You do not have access to this booking');
    return null;
  }
  return { booking, party, token };
}

// ─── shapes ───────────────────────────────────────────────────────────────

function sponsorshipShape(row, viewer) {
  const isBooker = viewer.role === 'booker';
  const isOwnSponsor = viewer.role === 'sponsor'
    && ((viewer.sponsorshipId && String(viewer.sponsorshipId) === String(row.id))
      || (viewer.userId && row.sponsor_user_id && String(viewer.userId) === String(row.sponsor_user_id)));
  const amountVisible = isBooker || isOwnSponsor;
  return {
    id: String(row.id),
    bookingId: String(row.booking_id),
    sponsorName: row.sponsor_name || null,
    sponsorEmail: isBooker || isOwnSponsor ? (row.sponsor_email || null) : null,
    amountCents: amountVisible ? Number(row.amount_cents) : null,
    currency: 'USD',
    status: row.status,
    paymentDeadlineAt: row.payment_deadline_at || null,
    paidAt: row.paid_at || null,
    refundedAt: row.refunded_at || null,
    canRespond: isOwnSponsor && row.status === 'invited',
    canPay: isOwnSponsor && row.status === 'accepted',
    createdAt: row.created_at,
  };
}

function chargeShape(row, viewer) {
  const isBooker = viewer.role === 'booker';
  const isOwnSponsor = viewer.role === 'sponsor';
  const amountVisible = isBooker || isOwnSponsor;
  return {
    id: String(row.id),
    sponsorshipId: String(row.sponsorship_id),
    amountCents: amountVisible ? Number(row.amount_cents) : null,
    reason: row.reason,
    status: row.status,
    paidAt: row.paid_at || null,
    refundedAt: row.refunded_at || null,
    canRespond: isOwnSponsor && row.status === 'requested',
    canPay: isOwnSponsor && row.status === 'accepted',
    createdAt: row.created_at,
  };
}

function siteActionShape(row) {
  return {
    id: String(row.id),
    actorType: row.actor_type,
    actionType: row.action_type,
    label: SITE_ACTION_LABELS[row.action_type] || row.action_type,
    details: row.details || {},
    receiptId: String(row.id),
    createdAt: row.created_at,
  };
}

async function checklistFor(booking) {
  const { rows: actions } = await pool.query(
    `SELECT action_type, created_at FROM booking_site_actions WHERE booking_id = $1 ORDER BY created_at ASC`,
    [booking.id]
  );
  const byType = {};
  for (const row of actions) {
    if (!byType[row.action_type]) byType[row.action_type] = row.created_at;
  }
  const { rows: photos } = await pool.query(
    'SELECT COUNT(*)::int AS n, MAX(created_at) AS at FROM booking_site_photos WHERE booking_id = $1',
    [booking.id]
  );
  const { rows: callbacks } = await pool.query(
    'SELECT COUNT(*)::int AS n, MAX(created_at) AS at FROM booking_callbacks WHERE booking_id = $1',
    [booking.id]
  );
  const item = (key, doneAt) => ({ key, done: Boolean(doneAt), doneAt: doneAt || null });
  return {
    items: [
      item('instructions_acknowledged', byType.acknowledge_instructions),
      item('access_window_suggested', byType.suggest_window),
      item('entry_problem_reported', byType.report_entry_problem),
      item('handoff_confirmed', byType.confirm_handoff),
      item('completion_acknowledged', byType.acknowledge_completion),
      item('photos_contributed', photos[0]?.n > 0 ? photos[0].at : null),
      item('callback_requested', callbacks[0]?.n > 0 ? callbacks[0].at : null),
    ],
    counts: { actions: actions.length, photos: photos[0]?.n || 0, callbacks: callbacks[0]?.n || 0 },
  };
}

/**
 * Participant summary (items 131-135): labels, authority, scope, and the
 * payment responsibility breakdown. Amounts follow D-41: the booker sees
 * every amount, a sponsor sees only their own, the recipient and site
 * contact see who pays and never an amount.
 */
async function summaryFor(booking, party) {
  const helper = await recipientSvc.helperName(booking.helper_id);
  const totals = await recipientSvc.sponsorshipTotals(booking.id);
  const paidSponsored = await recipientSvc.paidSponsorshipCents(booking.id);
  const { rows: sponsorships } = await pool.query(
    `SELECT * FROM booking_sponsorships WHERE booking_id = $1 ORDER BY created_at ASC`,
    [booking.id]
  );
  const { rows: jobRows } = await pool.query(
    `SELECT aftercare_instructions FROM jobs WHERE id = $1 LIMIT 1`,
    [booking.converted_to_job_id]
  );
  const isBooker = party.role === 'booker';
  const isToken = party.via === 'token';
  const payment = {
    bookerPays: true,
    sponsoredCents: isBooker ? paidSponsored : null,
    // Declared amount is the gross the booker named; the intent itself
    // carries the net (gross minus promo minus sponsorships). A fresh
    // booking carries no declared amount (NULL or 0) until payment starts.
    declaredCents: isBooker
      ? (Number(booking.gross_amount_cents || 0) > 0 ? Number(booking.gross_amount_cents)
        : (Number(booking.payment_amount_cents || 0) > 0 ? Number(booking.payment_amount_cents) : null))
      : null,
    promoDiscountCents: isBooker ? Number(booking.promo_discount_cents || 0) : null,
    remainingCents: null,
    sponsors: sponsorships
      .filter((s) => isBooker || (party.role === 'sponsor' && party.sponsorshipId
        && String(party.sponsorshipId) === String(s.id)))
      .map((s) => sponsorshipShape(s, party)),
    sponsorCount: sponsorships.filter((s) => ['invited', 'accepted', 'paid'].includes(s.status)).length,
  };
  if (isBooker && payment.declaredCents != null) {
    payment.remainingCents = Math.max(0, payment.declaredCents - (payment.promoDiscountCents || 0) - paidSponsored);
  }
  return {
    bookingId: String(booking.id),
    serviceName: booking.service_name,
    status: booking.status,
    requestedDate: booking.requested_date,
    requestedStartTime: booking.requested_start_time,
    requestedEndTime: booking.requested_end_time,
    serviceLocation: booking.service_location,
    description: booking.description,
    labels: {
      requester: 'Booker',
      recipient: booking.recipient_name || null,
      siteContact: booking.site_contact_name || null,
      ownershipLabel: booking.recipient_name
        ? `Visit for ${booking.recipient_name}`
        : null,
    },
    authority: {
      booker: ['Manage the booking', 'Invite or replace a recipient, site contact, or sponsor', 'Share the receipt'],
      recipient: ['Read this booking', 'Accept or decline the visit', 'Cancel the booking', 'Acknowledge completion', 'Share feedback'],
      siteContact: ['Read the visit status', 'Coordinate site access', 'Confirm handoff', 'Message in the booking chat'],
      sponsor: ['Preview the sponsored amount', 'Accept or decline', 'Pay with your own card', 'Approve or decline additional charges'],
    },
    scope: {
      service: booking.service_name,
      schedule: `${booking.requested_date || ''} ${booking.requested_start_time || ''}-${booking.requested_end_time || ''}`.trim(),
      site: booking.service_location,
    },
    helper: isToken
      ? { doorName: ['accepted', 'completed'].includes(booking.status) ? (helper?.doorName || null) : null }
      : { name: helper?.fullName || null },
    payment,
    careInstructions: booking.care_instructions || jobRows[0]?.aftercare_instructions || null,
    statusTokenExpiresAt: booking.status_token_expires_at || null,
    recipientConsentStatus: booking.recipient_consent_status || 'pending',
    receiptSharedWithRecipient: Boolean(booking.receipt_shared_with_recipient_at),
    viewerRole: party.role,
  };
}

// ─── participant summary / sharing preview / checklist ────────────────────

exports.getParticipantSummary = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'recipient', 'site_contact', 'sponsor']);
    if (!loaded) return;
    const { booking, party } = loaded;
    return res.json({ success: true, data: await summaryFor(booking, party) });
  } catch (err) {
    logger.error('Error fetching participant summary', { error: err.message });
    sendError(res, 500, 'Failed to fetch participant summary');
  }
};

exports.getTokenParticipantSummary = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact', 'sponsor']);
    if (!loaded) return;
    const { booking, party } = loaded;
    return res.json({ success: true, data: await summaryFor(booking, party) });
  } catch (err) {
    logger.error('Error fetching token participant summary', { error: err.message });
    sendError(res, 500, 'Failed to fetch participant summary');
  }
};

/** Contact-sharing preview (item 116): the exact shapes each role sees. */
exports.getSharingPreview = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker']);
    if (!loaded) return;
    const { booking } = loaded;
    return res.json({
      success: true,
      data: {
        recipient: {
          linked: Boolean(booking.recipient_user_id || booking.recipient_name),
          sees: ['Service', 'Date and time', 'Site address', 'Helper name', 'Your contact details'],
          neverSees: ['Payment amounts', 'Deposit state', 'Booker payment method', 'Site-contact link'],
          canDo: ['Accept or decline', 'Cancel the booking', 'Acknowledge completion', 'Share feedback'],
        },
        siteContact: {
          linked: Boolean(booking.site_contact_user_id || booking.site_contact_name),
          sees: ['Service', 'Date and time', 'Site address', 'Helper name once accepted'],
          neverSees: ['Payment amounts', 'Recipient details', 'Booker payment method'],
          canDo: ['Coordinate site access', 'Confirm handoff', 'Message in the booking chat'],
        },
        sponsor: {
          linked: true,
          sees: ['Service', 'Date', 'Your sponsored amount', 'Payment deadline'],
          neverSees: ['Booker payment method', 'Other sponsors amounts', 'Recipient contact details'],
          canDo: ['Accept or decline', 'Pay with your own card', 'Approve or decline additional charges'],
        },
      },
    });
  } catch (err) {
    logger.error('Error fetching sharing preview', { error: err.message });
    sendError(res, 500, 'Failed to fetch sharing preview');
  }
};

exports.getChecklist = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'recipient', 'site_contact']);
    if (!loaded) return;
    return res.json({ success: true, data: await checklistFor(loaded.booking) });
  } catch (err) {
    logger.error('Error fetching visit checklist', { error: err.message });
    sendError(res, 500, 'Failed to fetch visit checklist');
  }
};

exports.getTokenChecklist = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    return res.json({ success: true, data: await checklistFor(loaded.booking) });
  } catch (err) {
    logger.error('Error fetching token visit checklist', { error: err.message });
    sendError(res, 500, 'Failed to fetch visit checklist');
  }
};

// ─── site actions (items 106-110, 141, 144) ──────────────────────────────

async function doSiteAction(booking, party, actionType, details) {
  if (!SITE_ACTION_TYPES.includes(actionType)) return null;
  const cleanDetails = {};
  if (details && typeof details === 'object') {
    for (const key of ['window', 'message', 'problem', 'handedTo', 'notes']) {
      if (details[key] != null) cleanDetails[key] = String(details[key]).slice(0, 500);
    }
  }
  const { rows } = await pool.query(
    `INSERT INTO booking_site_actions (booking_id, actor_type, actor_user_id, action_type, details)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
    [booking.id, party.role, party.userId || null, actionType, JSON.stringify(cleanDetails)]
  );
  const row = rows[0];
  await logBookingAudit(booking.id, `site_${actionType}`, party.userId || null, party.role, booking.status, booking.status);
  const detailText = cleanDetails.window || cleanDetails.problem || cleanDetails.message || null;
  await recipientSvc.notifyBookerOfSiteAction(booking, {
    actionLabel: SITE_ACTION_LABELS[actionType] || actionType,
    detail: detailText,
  });
  if (actionType === 'request_callback') {
    await pool.query(
      `INSERT INTO booking_callbacks (booking_id, requested_by_type, requested_by_user_id, target, preferred_window)
       VALUES ($1, $2, $3, $4, $5)`,
      [booking.id, party.role, party.userId || null, 'booker', cleanDetails.window || null]
    );
  }
  return row;
}

exports.recordSiteAction = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const actionType = String(req.body?.actionType || req.body?.action_type || '');
    if (!SITE_ACTION_TYPES.includes(actionType)) {
      return sendValidationError(res, { actionType: 'Unknown site action' });
    }
    const row = await doSiteAction(loaded.booking, loaded.party, actionType, req.body?.details || req.body);
    return res.status(201).json({ success: true, data: siteActionShape(row) });
  } catch (err) {
    logger.error('Error recording site action', { error: err.message });
    sendError(res, 500, 'Failed to record site action');
  }
};

exports.recordTokenSiteAction = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const actionType = String(req.body?.actionType || req.body?.action_type || '');
    if (!SITE_ACTION_TYPES.includes(actionType)) {
      return sendValidationError(res, { actionType: 'Unknown site action' });
    }
    const row = await doSiteAction(loaded.booking, loaded.party, actionType, req.body?.details || req.body);
    return res.status(201).json({ success: true, data: siteActionShape(row) });
  } catch (err) {
    logger.error('Error recording token site action', { error: err.message });
    sendError(res, 500, 'Failed to record site action');
  }
};

exports.listSiteActions = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'recipient', 'site_contact']);
    if (!loaded) return;
    const { rows } = await pool.query(
      `SELECT * FROM booking_site_actions WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [loaded.booking.id]
    );
    return res.json({ success: true, data: rows.map(siteActionShape) });
  } catch (err) {
    logger.error('Error listing site actions', { error: err.message });
    sendError(res, 500, 'Failed to list site actions');
  }
};

// ─── arrival (item 103) ───────────────────────────────────────────────────

/**
 * Booking-level arrival check-in (G-15 is job-level only): the assigned
 * helper stamps arrived_at on the booking's appointment, mirroring
 * markJobArrived. The status is untouched; the recipient, site contact,
 * and booker are notified.
 */
exports.markProviderArrived = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['helper']);
    if (!loaded) return;
    const { booking } = loaded;
    if (!['accepted'].includes(booking.status)) {
      return sendError(res, 400, 'Only an accepted booking can be marked arrived', 'invalid_booking_state');
    }
    if (!booking.appointment_id) {
      return sendError(res, 400, 'This booking has no appointment to mark arrived', 'no_appointment');
    }
    const { rows } = await pool.query(
      `UPDATE appointments SET arrived_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND arrived_at IS NULL RETURNING arrived_at`,
      [booking.appointment_id]
    );
    if (!rows.length) {
      return sendError(res, 409, 'Arrival is already recorded for this booking', 'already_arrived');
    }
    await logBookingAudit(booking.id, 'provider_arrived', req.user.id, 'helper', booking.status, booking.status);
    await recipientSvc.notifyProviderArrived(booking);
    return res.json({ success: true, data: { bookingId: booking.id, arrivedAt: rows[0].arrived_at } });
  } catch (err) {
    logger.error('Error marking booking arrived', { error: err.message });
    sendError(res, 500, 'Failed to record arrival');
  }
};

// ─── care instructions (item 143) ─────────────────────────────────────────

exports.setCareInstructions = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'helper']);
    if (!loaded) return;
    const instructions = cleanText(req.body?.instructions ?? req.body?.careInstructions, 2000);
    if (!instructions) {
      return sendValidationError(res, { instructions: 'Care instructions are required' });
    }
    const { rows } = await pool.query(
      `UPDATE booking_requests SET care_instructions = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 RETURNING *`,
      [loaded.booking.id, instructions]
    );
    const updated = rows[0];
    await logBookingAudit(loaded.booking.id, 'care_instructions_set', req.user.id, loaded.party.role, loaded.booking.status, loaded.booking.status);
    for (const userId of [updated.recipient_user_id, updated.site_contact_user_id]) {
      await recipientSvc.notifyAccountParty({
        booking: updated,
        userId,
        type: 'booking_care_instructions',
        body: `${updated.service_name}, ${updated.requested_date}`,
        actionUrl: '/my-bookings',
        idempotencyKey: `booking-care-instructions:${updated.id}:${Date.now()}`,
      });
    }
    return res.json({ success: true, data: { bookingId: updated.id, careInstructions: instructions } });
  } catch (err) {
    logger.error('Error setting care instructions', { error: err.message });
    sendError(res, 500, 'Failed to set care instructions');
  }
};

// ─── authorized receipt (item 150) ────────────────────────────────────────

exports.shareReceipt = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker']);
    if (!loaded) return;
    const { rows } = await pool.query(
      `UPDATE booking_requests SET receipt_shared_with_recipient_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 RETURNING receipt_shared_with_recipient_at`,
      [loaded.booking.id]
    );
    await logBookingAudit(loaded.booking.id, 'receipt_shared', req.user.id, 'booker', loaded.booking.status, loaded.booking.status);
    return res.json({ success: true, data: { sharedAt: rows[0].receipt_shared_with_recipient_at } });
  } catch (err) {
    logger.error('Error sharing receipt', { error: err.message });
    sendError(res, 500, 'Failed to share receipt');
  }
};

function receiptFor(booking) {
  // The authorized receipt never carries amounts (D-49): service, date,
  // status, completion and handoff evidence only.
  return {
    bookingId: String(booking.id),
    serviceName: booking.service_name,
    requestedDate: booking.requested_date,
    status: booking.status,
    recipientName: booking.recipient_name || null,
    confirmationCode: String(booking.id).slice(0, 8).toUpperCase(),
  };
}

exports.getReceipt = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'recipient', 'site_contact']);
    if (!loaded) return;
    const { booking, party } = loaded;
    if (party.role !== 'booker' && !booking.receipt_shared_with_recipient_at) {
      return sendError(res, 403, 'The booker has not shared the receipt for this visit', 'receipt_not_shared');
    }
    return res.json({ success: true, data: receiptFor(booking) });
  } catch (err) {
    logger.error('Error fetching receipt', { error: err.message });
    sendError(res, 500, 'Failed to fetch receipt');
  }
};

exports.getTokenReceipt = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    if (!loaded.booking.receipt_shared_with_recipient_at) {
      return sendError(res, 403, 'The booker has not shared the receipt for this visit', 'receipt_not_shared');
    }
    return res.json({ success: true, data: receiptFor(loaded.booking) });
  } catch (err) {
    logger.error('Error fetching token receipt', { error: err.message });
    sendError(res, 500, 'Failed to fetch receipt');
  }
};

// ─── link management (items 112-115, 120, 147) ───────────────────────────

async function resolveUserIdByEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return null;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL AND is_active = TRUE LIMIT 1`,
      [clean]
    );
    return rows[0] ? String(rows[0].id) : null;
  } catch (err) {
    logger.warn('Failed to resolve booking contact by email', { error: err.message });
    return null;
  }
}

/** Notify a removed account party that their access ended (item 120). */
async function notifyRemovedParty(booking, userId) {
  if (!userId) return;
  await recipientSvc.notifyAccountParty({
    booking,
    userId,
    type: 'booking_contact_removed',
    body: `${booking.service_name}, ${booking.requested_date}`,
    actionUrl: '/my-bookings',
    idempotencyKey: `booking-contact-removed:${booking.id}:${userId}`,
  });
}

/**
 * Replace the recipient or the site contact (item 112, D-45). Mints a
 * fresh token with a fresh 7-day expiry, resets recipient consent to
 * pending, notifies the removed party and the new one, and writes an
 * audit row. Allowed after acceptance: replacement is how a changed
 * contact is handled, unlike revocation which stays pre-acceptance only.
 */
exports.replaceContact = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker']);
    if (!loaded) return;
    const { booking } = loaded;
    const kind = String(req.body?.kind || '');
    if (kind !== 'recipient' && kind !== 'site_contact') {
      return sendValidationError(res, { kind: 'Kind must be recipient or site_contact' });
    }
    if (['completed', 'cancelled', 'declined', 'expired', 'accepted_cancelled'].includes(booking.status)) {
      return sendError(res, 400, 'Contacts cannot be replaced on a finished booking', 'booking_finished');
    }
    const name = cleanText(req.body?.name, 200);
    const phone = cleanText(req.body?.phone, 40);
    const email = String(req.body?.email || '').trim().toLowerCase() || null;
    const userId = req.body?.userId ? String(req.body.userId) : (email ? await resolveUserIdByEmail(email) : null);
    if (userId && userId === String(booking.customer_id)) {
      return sendValidationError(res, { userId: 'The contact must be someone other than the booker' });
    }
    if (userId && booking.helper_id && userId === String(booking.helper_id)) {
      return sendValidationError(res, { userId: 'The contact cannot be the helper' });
    }
    const oldUserId = kind === 'recipient' ? booking.recipient_user_id : booking.site_contact_user_id;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const token = newToken();
    let updated;
    if (kind === 'recipient') {
      const { rows } = await pool.query(
        `UPDATE booking_requests
            SET recipient_user_id = $2, recipient_name = $3, recipient_phone = $4,
                recipient_token = $5, recipient_consent_status = 'pending',
                recipient_consented_at = NULL, recipient_consent_method = NULL,
                status_token_expires_at = $6, status_token_revoked_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 RETURNING *`,
        [booking.id, userId, name, phone, token, expiresAt]
      );
      updated = rows[0];
    } else {
      const { rows } = await pool.query(
        `UPDATE booking_requests
            SET site_contact_user_id = $2, site_contact_name = $3, site_contact_phone = $4,
                status_token = $5, status_token_expires_at = $6, status_token_revoked_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 RETURNING *`,
        [booking.id, userId, name, phone, token, expiresAt]
      );
      updated = rows[0];
    }
    await logBookingAudit(booking.id, `${kind}_replaced`, req.user.id, 'booker', booking.status, booking.status);
    await notifyRemovedParty(booking, oldUserId);
    // Deliver the fresh link to the new account party, if there is one.
    if (userId) {
      const isRecipient = kind === 'recipient';
      try {
        broadcastToUser(String(userId), isRecipient ? 'booking:recipient_invite' : 'booking:site_contact_link', {
          bookingId: booking.id,
          status: booking.status,
        });
        await sendNotification({
          userId: String(userId),
          type: isRecipient ? 'booking_recipient_invite' : 'booking_site_contact_link',
          body: `${booking.service_name}, ${booking.requested_date}`,
          data: { bookingId: booking.id },
          action_url: `/bookings/status/${token}`,
          idempotencyKey: `booking-contact-replaced:${booking.id}:${kind}:${userId}`,
        });
      } catch (err) {
        logger.warn('Failed to deliver replaced contact link', { error: err.message });
      }
    }
    return res.json({
      success: true,
      data: {
        bookingId: booking.id,
        kind,
        recipientUserId: updated.recipient_user_id || null,
        siteContactUserId: updated.site_contact_user_id || null,
        recipientToken: kind === 'recipient' ? token : undefined,
        statusToken: kind === 'site_contact' ? token : undefined,
        statusTokenExpiresAt: expiresAt,
      },
    });
  } catch (err) {
    logger.error('Error replacing booking contact', { error: err.message });
    sendError(res, 500, 'Failed to replace contact');
  }
};

/**
 * Remove guest access (item 147): the booker clears a recipient or site
 * contact link entirely, including after acceptance. The removed account
 * party is notified (item 120) and the removal is audited.
 */
exports.removeGuestAccess = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker']);
    if (!loaded) return;
    const { booking } = loaded;
    const kind = String(req.body?.kind || '');
    if (kind !== 'recipient' && kind !== 'site_contact') {
      return sendValidationError(res, { kind: 'Kind must be recipient or site_contact' });
    }
    const oldUserId = kind === 'recipient' ? booking.recipient_user_id : booking.site_contact_user_id;
    let updated;
    if (kind === 'recipient') {
      const { rows } = await pool.query(
        `UPDATE booking_requests
            SET recipient_user_id = NULL, recipient_name = NULL, recipient_phone = NULL,
                recipient_token = NULL, recipient_consent_status = 'pending',
                recipient_consented_at = NULL, recipient_consent_method = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 RETURNING *`,
        [booking.id]
      );
      updated = rows[0];
    } else {
      const { rows } = await pool.query(
        `UPDATE booking_requests
            SET site_contact_user_id = NULL, site_contact_name = NULL, site_contact_phone = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 RETURNING *`,
        [booking.id]
      );
      updated = rows[0];
    }
    await logBookingAudit(booking.id, `${kind}_access_removed`, req.user.id, 'booker', booking.status, booking.status);
    await notifyRemovedParty(booking, oldUserId);
    return res.json({
      success: true,
      data: {
        bookingId: booking.id,
        kind,
        removedUserId: oldUserId ? String(oldUserId) : null,
        notified: Boolean(oldUserId),
      },
    });
  } catch (err) {
    logger.error('Error removing guest access', { error: err.message });
    sendError(res, 500, 'Failed to remove guest access');
  }
};

// ─── link renewal (item 114) ──────────────────────────────────────────────

async function doRenewalRequest(booking, party) {
  const { rows } = await pool.query(
    `INSERT INTO booking_link_renewals (booking_id, requested_by_type, requested_by_user_id)
     VALUES ($1, $2, $3) RETURNING *`,
    [booking.id, party.role, party.userId || null]
  );
  await recipientSvc.notifyAccountParty({
    booking,
    userId: booking.customer_id,
    type: 'booking_link_renewal_requested',
    body: `${booking.service_name}, ${booking.requested_date}`,
    data: { renewalId: rows[0].id },
    actionUrl: '/my-bookings',
    idempotencyKey: `booking-renewal-requested:${booking.id}:${rows[0].id}`,
  });
  return rows[0];
}

exports.requestLinkRenewal = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const row = await doRenewalRequest(loaded.booking, loaded.party);
    return res.status(201).json({ success: true, data: { id: String(row.id), status: row.status } });
  } catch (err) {
    logger.error('Error requesting link renewal', { error: err.message });
    sendError(res, 500, 'Failed to request link renewal');
  }
};

exports.requestTokenLinkRenewal = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const row = await doRenewalRequest(loaded.booking, loaded.party);
    return res.status(201).json({ success: true, data: { id: String(row.id), status: row.status } });
  } catch (err) {
    logger.error('Error requesting token link renewal', { error: err.message });
    sendError(res, 500, 'Failed to request link renewal');
  }
};

/** The booker re-mints both links with a fresh 7-day expiry (item 114). */
exports.renewStatusLink = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker']);
    if (!loaded) return;
    const { booking } = loaded;
    if (!booking.status_token && !booking.recipient_token) {
      return sendError(res, 400, 'This booking has no status link to renew', 'no_status_link');
    }
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const recipientToken = booking.recipient_token ? newToken() : null;
    const statusToken = booking.status_token ? newToken() : null;
    const { rows } = await pool.query(
      `UPDATE booking_requests
          SET recipient_token = COALESCE($2, recipient_token),
              status_token = COALESCE($3, status_token),
              status_token_expires_at = $4, status_token_revoked_at = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 RETURNING *`,
      [booking.id, recipientToken, statusToken, expiresAt]
    );
    const updated = rows[0];
    await pool.query(
      `UPDATE booking_link_renewals SET status = 'renewed', decided_at = CURRENT_TIMESTAMP
        WHERE booking_id = $1 AND status = 'requested'`,
      [booking.id]
    );
    await logBookingAudit(booking.id, 'status_link_renewed', req.user.id, 'booker', booking.status, booking.status);
    // Re-deliver the fresh links to the account parties.
    if (updated.recipient_user_id && recipientToken) {
      await recipientSvc.notifyAccountParty({
        booking: updated,
        userId: updated.recipient_user_id,
        type: 'booking_recipient_invite',
        body: `${updated.service_name}, ${updated.requested_date}`,
        data: { bookingId: updated.id },
        actionUrl: `/bookings/status/${recipientToken}`,
        idempotencyKey: `booking-link-renewed:${updated.id}:recipient`,
      });
    }
    if (updated.site_contact_user_id && statusToken) {
      await recipientSvc.notifyAccountParty({
        booking: updated,
        userId: updated.site_contact_user_id,
        type: 'booking_site_contact_link',
        body: `${updated.service_name}, ${updated.requested_date}`,
        data: { bookingId: updated.id },
        actionUrl: `/bookings/status/${statusToken}`,
        idempotencyKey: `booking-link-renewed:${updated.id}:site-contact`,
      });
    }
    return res.json({
      success: true,
      data: {
        bookingId: updated.id,
        recipientToken,
        statusToken,
        statusTokenExpiresAt: expiresAt,
      },
    });
  } catch (err) {
    logger.error('Error renewing status link', { error: err.message });
    sendError(res, 500, 'Failed to renew status link');
  }
};

// ─── alternate contact delivery (item 115) ────────────────────────────────

/**
 * Deliver a status link to an alternate contact. An account gets the link
 * by notification; a named alternate is recorded and the link is returned
 * for the booker to forward by hand (the existing copy-link pattern).
 */
exports.deliverLinkToAlternate = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker']);
    if (!loaded) return;
    const { booking } = loaded;
    const kind = String(req.body?.kind || '');
    if (kind !== 'recipient' && kind !== 'site_contact') {
      return sendValidationError(res, { kind: 'Kind must be recipient or site_contact' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendValidationError(res, { email: 'A valid email address is required' });
    }
    const token = kind === 'recipient' ? booking.recipient_token : booking.status_token;
    if (!token) {
      return sendError(res, 400, 'This booking has no link of that kind', 'no_status_link');
    }
    const userId = await resolveUserIdByEmail(email);
    const { rows } = await pool.query(
      `INSERT INTO booking_link_deliveries (booking_id, link_kind, delivered_to_email, delivered_to_user_id, delivered_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [booking.id, kind, email, userId, req.user.id]
    );
    let delivered = false;
    if (userId) {
      delivered = await recipientSvc.notifyAccountParty({
        booking,
        userId,
        type: kind === 'recipient' ? 'booking_recipient_invite' : 'booking_site_contact_link',
        body: `${booking.service_name}, ${booking.requested_date}`,
        data: { bookingId: booking.id },
        actionUrl: `/bookings/status/${token}`,
        idempotencyKey: `booking-link-delivery:${booking.id}:${kind}:${rows[0].id}`,
      });
    }
    return res.status(201).json({
      success: true,
      data: {
        id: String(rows[0].id),
        kind,
        email,
        delivered,
        // Returned only so the booker can forward it by hand when the
        // alternate has no account; the booker already holds this token.
        link: delivered ? null : `/bookings/status/${token}`,
      },
    });
  } catch (err) {
    logger.error('Error delivering link to alternate', { error: err.message });
    sendError(res, 500, 'Failed to deliver link');
  }
};

// ─── update email, opt-out, archive (items 118, 146, 148) ────────────────

exports.registerUpdateEmail = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendValidationError(res, { email: 'A valid email address is required' });
    }
    await pool.query(
      `INSERT INTO booking_link_update_emails (booking_id, link_kind, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (booking_id, link_kind, email) DO NOTHING`,
      [loaded.booking.id, loaded.party.role, email]
    );
    return res.json({ success: true, data: { email, kind: loaded.party.role } });
  } catch (err) {
    logger.error('Error registering update email', { error: err.message });
    sendError(res, 500, 'Failed to register update email');
  }
};

exports.removeUpdateEmail = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const email = String(req.body?.email || '').trim().toLowerCase();
    await pool.query(
      `DELETE FROM booking_link_update_emails WHERE booking_id = $1 AND link_kind = $2 AND email = $3`,
      [loaded.booking.id, loaded.party.role, email]
    );
    return res.json({ success: true, data: { removed: true } });
  } catch (err) {
    logger.error('Error removing update email', { error: err.message });
    sendError(res, 500, 'Failed to remove update email');
  }
};

exports.optOutNotifications = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact', 'sponsor']);
    if (!loaded) return;
    await pool.query(
      `INSERT INTO booking_notification_opt_outs (booking_id, user_id)
       VALUES ($1, $2) ON CONFLICT (booking_id, user_id) DO NOTHING`,
      [loaded.booking.id, req.user.id]
    );
    return res.json({ success: true, data: { optedOut: true } });
  } catch (err) {
    logger.error('Error opting out of booking notifications', { error: err.message });
    sendError(res, 500, 'Failed to opt out');
  }
};

exports.optInNotifications = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact', 'sponsor']);
    if (!loaded) return;
    await pool.query(
      `DELETE FROM booking_notification_opt_outs WHERE booking_id = $1 AND user_id = $2`,
      [loaded.booking.id, req.user.id]
    );
    return res.json({ success: true, data: { optedOut: false } });
  } catch (err) {
    logger.error('Error opting into booking notifications', { error: err.message });
    sendError(res, 500, 'Failed to opt in');
  }
};

exports.optOutTokenNotifications = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    await pool.query(
      `INSERT INTO booking_notification_opt_outs (booking_id, token_hash)
       VALUES ($1, $2) ON CONFLICT (booking_id, token_hash) DO NOTHING`,
      [loaded.booking.id, recipientSvc.tokenHash(loaded.token)]
    );
    return res.json({ success: true, data: { optedOut: true } });
  } catch (err) {
    logger.error('Error opting out token notifications', { error: err.message });
    sendError(res, 500, 'Failed to opt out');
  }
};

exports.archiveVisit = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    await pool.query(
      `INSERT INTO booking_visit_archives (booking_id, user_id, role)
       VALUES ($1, $2, $3) ON CONFLICT (booking_id, user_id) DO NOTHING`,
      [loaded.booking.id, req.user.id, loaded.party.role]
    );
    return res.json({ success: true, data: { archived: true } });
  } catch (err) {
    logger.error('Error archiving visit', { error: err.message });
    sendError(res, 500, 'Failed to archive visit');
  }
};

exports.unarchiveVisit = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    await pool.query(
      `DELETE FROM booking_visit_archives WHERE booking_id = $1 AND user_id = $2`,
      [loaded.booking.id, req.user.id]
    );
    return res.json({ success: true, data: { archived: false } });
  } catch (err) {
    logger.error('Error unarchiving visit', { error: err.message });
    sendError(res, 500, 'Failed to unarchive visit');
  }
};

exports.archiveTokenVisit = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    await pool.query(
      `INSERT INTO booking_visit_archives (booking_id, token_hash, role)
       VALUES ($1, $2, $3) ON CONFLICT (booking_id, token_hash) DO NOTHING`,
      [loaded.booking.id, recipientSvc.tokenHash(loaded.token), loaded.party.role]
    );
    return res.json({ success: true, data: { archived: true } });
  } catch (err) {
    logger.error('Error archiving token visit', { error: err.message });
    sendError(res, 500, 'Failed to archive visit');
  }
};

// ─── contact correction (item 149, D-50) ──────────────────────────────────

async function doContactCorrection(booking, party, field, value) {
  if (field !== 'name' && field !== 'phone') return null;
  const column = party.role === 'recipient'
    ? (field === 'name' ? 'recipient_name' : 'recipient_phone')
    : (field === 'name' ? 'site_contact_name' : 'site_contact_phone');
  const oldValue = booking[column];
  const { rows } = await pool.query(
    `UPDATE booking_requests SET ${column} = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
    [booking.id, value]
  );
  await pool.query(
    `INSERT INTO booking_contact_corrections (booking_id, party_type, requested_by_user_id, field_name, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [booking.id, party.role, party.userId || null, field, oldValue, value]
  );
  await logBookingAudit(booking.id, `contact_${field}_corrected`, party.userId || null, party.role, booking.status, booking.status);
  await recipientSvc.notifyBookerOfSiteAction(booking, {
    actionLabel: `Contact ${field} corrected`,
    detail: value,
  });
  return rows[0];
}

exports.submitContactCorrection = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const field = String(req.body?.field || '');
    const value = cleanText(req.body?.value, field === 'phone' ? 40 : 200);
    if (field !== 'name' && field !== 'phone') {
      return sendValidationError(res, { field: 'Field must be name or phone' });
    }
    if (!value) return sendValidationError(res, { value: 'A corrected value is required' });
    await doContactCorrection(loaded.booking, loaded.party, field, value);
    return res.json({ success: true, data: { field, value } });
  } catch (err) {
    logger.error('Error correcting contact', { error: err.message });
    sendError(res, 500, 'Failed to correct contact');
  }
};

exports.submitTokenContactCorrection = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const field = String(req.body?.field || '');
    const value = cleanText(req.body?.value, field === 'phone' ? 40 : 200);
    if (field !== 'name' && field !== 'phone') {
      return sendValidationError(res, { field: 'Field must be name or phone' });
    }
    if (!value) return sendValidationError(res, { value: 'A corrected value is required' });
    await doContactCorrection(loaded.booking, loaded.party, field, value);
    return res.json({ success: true, data: { field, value } });
  } catch (err) {
    logger.error('Error correcting token contact', { error: err.message });
    sendError(res, 500, 'Failed to correct contact');
  }
};

// ─── masked contact relay (item 117, D-43) ────────────────────────────────

async function doRelay(booking, party, to, message) {
  const cleanMessage = cleanText(message, 500);
  if (!cleanMessage) return null;
  let targetUserId = null;
  let label = null;
  if (to === 'booker') {
    targetUserId = booking.customer_id;
    label = 'Relay message for the booker';
  } else if (to === 'helper') {
    targetUserId = booking.helper_id;
    label = 'Relay message for the provider';
  } else if (to === 'site_contact') {
    targetUserId = booking.site_contact_user_id;
    label = 'Relay message for the site contact';
  } else {
    return null;
  }
  if (!targetUserId || (party.userId && String(targetUserId) === String(party.userId))) return null;
  await recipientSvc.notifyAccountParty({
    booking,
    userId: targetUserId,
    type: 'booking_site_action',
    body: `${booking.service_name}: ${label}: ${cleanMessage}`,
    data: { relayFrom: party.role },
    actionUrl: '/my-bookings',
    idempotencyKey: `booking-relay:${booking.id}:${crypto.randomUUID()}`,
  });
  return { delivered: true };
}

exports.relayMessage = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const to = String(req.body?.to || '');
    const result = await doRelay(loaded.booking, loaded.party, to, req.body?.message);
    if (!result) return sendValidationError(res, { to: 'A reachable recipient and a message are required' });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Error relaying message', { error: err.message });
    sendError(res, 500, 'Failed to send message');
  }
};

exports.relayTokenMessage = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const to = String(req.body?.to || '');
    const result = await doRelay(loaded.booking, loaded.party, to, req.body?.message);
    if (!result) return sendValidationError(res, { to: 'A reachable recipient and a message are required' });
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Error relaying token message', { error: err.message });
    sendError(res, 500, 'Failed to send message');
  }
};

// ─── sponsorships (items 121-130, D-40) ───────────────────────────────────

async function loadSponsorship(bookingId, sponsorshipId) {
  const { rows } = await pool.query(
    'SELECT * FROM booking_sponsorships WHERE id = $1 AND booking_id = $2',
    [sponsorshipId, bookingId]
  );
  return rows[0] || null;
}

/** Lazy expiry: an invite past its payment deadline is expired. */
async function refreshSponsorship(row) {
  if (!row) return row;
  if (['invited', 'accepted'].includes(row.status)
    && row.payment_deadline_at && new Date(row.payment_deadline_at) <= new Date()) {
    const { rows } = await pool.query(
      `UPDATE booking_sponsorships SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status IN ('invited', 'accepted') RETURNING *`,
      [row.id]
    );
    return rows[0] || row;
  }
  return row;
}

async function notifySponsorUpdate(booking, sponsorship, note) {
  const body = `${booking.service_name}: ${note}`;
  if (sponsorship.sponsor_user_id) {
    await recipientSvc.notifyAccountParty({
      booking,
      userId: sponsorship.sponsor_user_id,
      type: 'booking_sponsor_update',
      body,
      data: { sponsorshipId: sponsorship.id },
      actionUrl: '/my-bookings',
      idempotencyKey: `booking-sponsor-update:${sponsorship.id}:${crypto.randomUUID()}`,
    });
  }
  await recipientSvc.notifyAccountParty({
    booking,
    userId: booking.customer_id,
    type: 'booking_sponsor_update',
    body,
    data: { sponsorshipId: sponsorship.id },
    actionUrl: '/my-bookings',
    idempotencyKey: `booking-sponsor-update:${sponsorship.id}:booker:${crypto.randomUUID()}`,
  });
}

exports.createSponsorship = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker']);
    if (!loaded) return;
    const { booking } = loaded;
    if (!['pending', 'accepted'].includes(booking.status)) {
      return sendError(res, 400, 'Sponsorships can only be invited on an open booking', 'booking_not_open');
    }
    if (booking.payment_status === 'paid') {
      return sendError(res, 409, 'This booking is already paid in full', 'booking_already_paid');
    }
    const amountCents = cleanCents(req.body?.amountCents ?? req.body?.amount_cents);
    if (amountCents == null || amountCents < MIN_SPONSORSHIP_CENTS || amountCents > MAX_SPONSORSHIP_CENTS) {
      return sendValidationError(res, { amountCents: 'Amount must be between $0.50 and $50,000' });
    }
    const totals = await recipientSvc.sponsorshipTotals(booking.id);
    // A fresh booking carries no declared amount (NULL or 0 until the
    // booker starts payment): the cap is the intent maximum, not zero.
    const declaredAmount = Number(booking.payment_amount_cents || 0);
    const cap = declaredAmount > 0 ? declaredAmount : MAX_SPONSORSHIP_CENTS;
    if (totals.live + amountCents > cap) {
      return sendValidationError(res, { amountCents: 'Live sponsorships already cover the booking amount' });
    }
    const email = String(req.body?.sponsorEmail || req.body?.email || '').trim().toLowerCase() || null;
    const sponsorUserId = req.body?.sponsorUserId
      ? String(req.body.sponsorUserId)
      : (email ? await resolveUserIdByEmail(email) : null);
    if (sponsorUserId && sponsorUserId === String(booking.customer_id)) {
      return sendValidationError(res, { sponsorUserId: 'The sponsor must be someone other than the booker' });
    }
    const sponsorName = cleanText(req.body?.sponsorName || req.body?.name, 200);
    if (!sponsorUserId && !email && !sponsorName) {
      return sendValidationError(res, { sponsorEmail: 'Invite the sponsor by email or name' });
    }
    let deadline = null;
    if (req.body?.paymentDeadline || req.body?.payment_deadline_at) {
      deadline = new Date(req.body.paymentDeadline || req.body.payment_deadline_at);
      if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) {
        return sendValidationError(res, { paymentDeadline: 'Payment deadline must be in the future' });
      }
      if (deadline.getTime() - Date.now() > 30 * 24 * 60 * 60 * 1000) {
        return sendValidationError(res, { paymentDeadline: 'Payment deadline must be within 30 days' });
      }
    } else if (booking.requested_date && booking.requested_start_time) {
      const visit = new Date(`${booking.requested_date}T${booking.requested_start_time}:00`);
      deadline = Number.isNaN(visit.getTime()) || visit <= new Date()
        ? new Date(Date.now() + 24 * 60 * 60 * 1000)
        : visit;
    } else {
      deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    const token = newToken();
    const { rows } = await pool.query(
      `INSERT INTO booking_sponsorships
         (booking_id, sponsor_user_id, sponsor_name, sponsor_email, amount_cents,
          status, invite_token, payment_deadline_at, invited_by)
       VALUES ($1, $2, $3, $4, $5, 'invited', $6, $7, $8) RETURNING *`,
      [booking.id, sponsorUserId, sponsorName, email, amountCents, token, deadline, req.user.id]
    );
    const sponsorship = rows[0];
    await logBookingAudit(booking.id, 'sponsorship_invited', req.user.id, 'booker', booking.status, booking.status);
    if (sponsorUserId) {
      await recipientSvc.notifyAccountParty({
        booking,
        userId: sponsorUserId,
        type: 'booking_sponsor_invite',
        body: `${booking.service_name}, ${booking.requested_date}`,
        data: { sponsorshipId: sponsorship.id },
        actionUrl: `/bookings/status/${token}`,
        idempotencyKey: `booking-sponsor-invite:${sponsorship.id}`,
      });
    }
    return res.status(201).json({
      success: true,
      data: {
        ...sponsorshipShape(sponsorship, { role: 'booker' }),
        inviteToken: token,
        inviteLink: `/bookings/status/${token}`,
      },
    });
  } catch (err) {
    logger.error('Error creating sponsorship', { error: err.message });
    sendError(res, 500, 'Failed to invite sponsor');
  }
};

exports.listSponsorships = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'sponsor']);
    if (!loaded) return;
    const { rows } = await pool.query(
      `SELECT * FROM booking_sponsorships WHERE booking_id = $1 ORDER BY created_at ASC`,
      [loaded.booking.id]
    );
    const refreshed = [];
    for (const row of rows) refreshed.push(await refreshSponsorship(row));
    const visible = loaded.party.role === 'booker'
      ? refreshed
      : refreshed.filter((s) => loaded.party.sponsorshipId === String(s.id)
        || (s.sponsor_user_id && String(s.sponsor_user_id) === String(loaded.party.userId)));
    return res.json({ success: true, data: visible.map((s) => sponsorshipShape(s, loaded.party)) });
  } catch (err) {
    logger.error('Error listing sponsorships', { error: err.message });
    sendError(res, 500, 'Failed to list sponsorships');
  }
};

async function doSponsorshipRespond(booking, party, sponsorship, decision) {
  const { rows } = await pool.query(
    `UPDATE booking_sponsorships SET status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'invited' RETURNING *`,
    [sponsorship.id, decision]
  );
  if (!rows.length) return null;
  await logBookingAudit(booking.id, `sponsorship_${decision}`, party.userId || null, 'sponsor', booking.status, booking.status);
  await notifySponsorUpdate(booking, rows[0], decision === 'accepted'
    ? 'The sponsor accepted the invitation'
    : 'The sponsor declined the invitation');
  return rows[0];
}

exports.respondToSponsorship = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (decision !== 'accepted' && decision !== 'declined') {
      return sendValidationError(res, { decision: 'Decision must be accepted or declined' });
    }
    const sponsorship = await refreshSponsorship(
      await loadSponsorship(loaded.booking.id, String(req.params.sponsorshipId || ''))
    );
    if (!sponsorship) return sendError(res, 404, 'Sponsorship not found');
    if (loaded.party.sponsorshipId !== String(sponsorship.id)
      && !(sponsorship.sponsor_user_id && String(sponsorship.sponsor_user_id) === String(loaded.party.userId))) {
      return sendError(res, 403, 'Only the invited sponsor can respond');
    }
    if (sponsorship.status !== 'invited') {
      return sendError(res, 409, `This sponsorship is already ${sponsorship.status}`, 'sponsorship_decided');
    }
    const updated = await doSponsorshipRespond(loaded.booking, loaded.party, sponsorship, decision);
    return res.json({ success: true, data: sponsorshipShape(updated, loaded.party) });
  } catch (err) {
    logger.error('Error responding to sponsorship', { error: err.message });
    sendError(res, 500, 'Failed to respond to sponsorship');
  }
};

exports.respondToSponsorshipByToken = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (decision !== 'accepted' && decision !== 'declined') {
      return sendValidationError(res, { decision: 'Decision must be accepted or declined' });
    }
    const sponsorship = await refreshSponsorship(
      await loadSponsorship(loaded.booking.id, loaded.party.sponsorshipId)
    );
    if (!sponsorship) return sendError(res, 404, 'Sponsorship not found');
    if (sponsorship.status !== 'invited') {
      return sendError(res, 409, `This sponsorship is already ${sponsorship.status}`, 'sponsorship_decided');
    }
    const updated = await doSponsorshipRespond(loaded.booking, loaded.party, sponsorship, decision);
    return res.json({ success: true, data: sponsorshipShape(updated, loaded.party) });
  } catch (err) {
    logger.error('Error responding to sponsorship by token', { error: err.message });
    sendError(res, 500, 'Failed to respond to sponsorship');
  }
};

exports.getSponsorPreviewByToken = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const sponsorship = await refreshSponsorship(
      await loadSponsorship(loaded.booking.id, loaded.party.sponsorshipId)
    );
    if (!sponsorship) return sendError(res, 404, 'Sponsorship not found');
    return res.json({
      success: true,
      data: {
        ...sponsorshipShape(sponsorship, loaded.party),
        serviceName: loaded.booking.service_name,
        requestedDate: loaded.booking.requested_date,
        status: loaded.booking.status,
      },
    });
  } catch (err) {
    logger.error('Error fetching sponsor preview', { error: err.message });
    sendError(res, 500, 'Failed to fetch sponsor preview');
  }
};

// ─── sponsor payments (D-40) ──────────────────────────────────────────────

/**
 * Create the sponsor's own PaymentIntent. The intent is the sponsor's
 * money, on the sponsor's card: metadata names the sponsorship, never the
 * booker, and the webhook settles the sponsorship row only.
 */
async function createIntentFor({ booking, sponsorship, charge, payerEmail }) {
  const stripe = requireStripeForIntent();
  if (!stripe) throw new Error('Card payments are not configured');
  const amountCents = charge ? Number(charge.amount_cents) : Number(sponsorship.amount_cents);
  const metadata = {
    booking_request_id: String(booking.id),
    source: 'mobile_booking',
    sponsor_user_id: String(sponsorship.sponsor_user_id || ''),
  };
  if (charge) {
    metadata.sponsorship_charge_id = String(charge.id);
    metadata.sponsorship_id = String(sponsorship.id);
  } else {
    metadata.sponsorship_id = String(sponsorship.id);
  }
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    receipt_email: payerEmail || undefined,
    metadata,
  });
  if (!intent || typeof intent.id !== 'string' || !intent.client_secret) {
    throw new Error('Stripe did not return a usable PaymentIntent');
  }
  return intent;
}

function requireStripeForIntent() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return stripeClient();
}

async function loadLiveIntent(stripe, intentId) {
  try {
    return await stripe.paymentIntents.retrieve(intentId);
  } catch (err) {
    logger.warn('Failed to retrieve sponsor PaymentIntent', { error: err.message });
    return null;
  }
}

exports.createSponsorPaymentIntent = async (req, res) => {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;
    const loaded = await loadAccountBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const sponsorship = await refreshSponsorship(
      await loadSponsorship(loaded.booking.id, String(req.params.sponsorshipId || ''))
    );
    if (!sponsorship) return sendError(res, 404, 'Sponsorship not found');
    if (sponsorship.status !== 'accepted') {
      return sendError(res, 409, `This sponsorship cannot be paid while ${sponsorship.status}`, 'sponsorship_not_payable');
    }
    if (loaded.party.sponsorshipId !== String(sponsorship.id)
      && !(sponsorship.sponsor_user_id && String(sponsorship.sponsor_user_id) === String(loaded.party.userId))) {
      return sendError(res, 403, 'Only the sponsor can pay this sponsorship');
    }
    if (sponsorship.stripe_payment_intent_id) {
      const existing = await loadLiveIntent(stripe, sponsorship.stripe_payment_intent_id);
      if (existing && Number(existing.amount) === Number(sponsorship.amount_cents)
        && !['succeeded', 'canceled'].includes(existing.status)) {
        return res.json({
          success: true,
          data: {
            sponsorshipId: sponsorship.id,
            clientSecret: existing.client_secret,
            paymentIntentId: existing.id,
            amountCents: Number(sponsorship.amount_cents),
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
          },
        });
      }
      if (existing && existing.status === 'succeeded') {
        return sendError(res, 409, 'This sponsorship is already paid', 'sponsorship_already_paid');
      }
    }
    const intent = await createIntentFor({
      booking: loaded.booking,
      sponsorship,
      payerEmail: sponsorship.sponsor_email,
    });
    await pool.query(
      `UPDATE booking_sponsorships SET stripe_payment_intent_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [sponsorship.id, intent.id]
    );
    return res.json({
      success: true,
      data: {
        sponsorshipId: sponsorship.id,
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        amountCents: Number(sponsorship.amount_cents),
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      },
    });
  } catch (err) {
    logger.error('Error creating sponsor PaymentIntent', { error: err.message });
    sendError(res, 500, 'Failed to create sponsor payment');
  }
};

async function confirmIntent({ stripe, booking, row, table, intentId, amountCents }) {
  const intent = await stripe.paymentIntents.retrieve(intentId);
  const expected = Number(amountCents);
  const actual = Number(intent.amount_received || intent.amount || 0);
  if (String(intent.metadata?.booking_request_id || '') !== String(booking.id)
    || String(intentId) !== String(row.stripe_payment_intent_id || '')
    || actual !== expected
    || String(intent.currency || '').toLowerCase() !== 'usd') {
    return { ok: false, status: 403, error: 'Payment does not belong to this sponsorship' };
  }
  if (intent.status !== 'succeeded') {
    return { ok: false, status: 409, error: `Payment status: ${intent.status}`, paymentStatus: intent.status };
  }
  const { rows } = await pool.query(
    `UPDATE ${table} SET status = 'paid', paid_at = COALESCE(paid_at, NOW()), updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'accepted' RETURNING *`,
    [row.id]
  );
  return { ok: true, row: rows[0] || row };
}

exports.confirmSponsorPayment = async (req, res) => {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;
    const loaded = await loadAccountBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const sponsorship = await loadSponsorship(loaded.booking.id, String(req.params.sponsorshipId || ''));
    if (!sponsorship) return sendError(res, 404, 'Sponsorship not found');
    const paymentIntentId = String(req.body?.paymentIntentId || sponsorship.stripe_payment_intent_id || '');
    if (!paymentIntentId) return sendValidationError(res, { paymentIntentId: 'Payment intent is required' });
    const result = await confirmIntent({
      stripe,
      booking: loaded.booking,
      row: sponsorship,
      table: 'booking_sponsorships',
      intentId: paymentIntentId,
      amountCents: sponsorship.amount_cents,
    });
    if (!result.ok) return sendError(res, result.status, result.error, 'sponsor_payment_mismatch');
    await logBookingAudit(loaded.booking.id, 'sponsorship_paid', loaded.party.userId || null, 'sponsor', loaded.booking.status, loaded.booking.status);
    await notifySponsorUpdate(loaded.booking, result.row, 'The sponsor paid the sponsored amount');
    return res.json({
      success: true,
      data: { ...sponsorshipShape(result.row, loaded.party), paidAt: result.row.paid_at },
    });
  } catch (err) {
    logger.error('Error confirming sponsor payment', { error: err.message });
    sendError(res, 500, 'Failed to confirm sponsor payment');
  }
};

/** The sponsor's own receipt (item 125): their amount, their payment. */
exports.getSponsorReceipt = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'sponsor']);
    if (!loaded) return;
    const sponsorship = await loadSponsorship(loaded.booking.id, String(req.params.sponsorshipId || ''));
    if (!sponsorship) return sendError(res, 404, 'Sponsorship not found');
    if (loaded.party.role === 'sponsor'
      && loaded.party.sponsorshipId !== String(sponsorship.id)
      && !(sponsorship.sponsor_user_id && String(sponsorship.sponsor_user_id) === String(loaded.party.userId))) {
      return sendError(res, 403, 'Only the sponsor can read this receipt');
    }
    return res.json({
      success: true,
      data: {
        sponsorshipId: String(sponsorship.id),
        serviceName: loaded.booking.service_name,
        requestedDate: loaded.booking.requested_date,
        sponsorName: sponsorship.sponsor_name || null,
        amountCents: Number(sponsorship.amount_cents),
        currency: 'USD',
        status: sponsorship.status,
        paidAt: sponsorship.paid_at || null,
        refundedAt: sponsorship.refunded_at || null,
        paymentIntentId: sponsorship.stripe_payment_intent_id || null,
      },
    });
  } catch (err) {
    logger.error('Error fetching sponsor receipt', { error: err.message });
    sendError(res, 500, 'Failed to fetch sponsor receipt');
  }
};

// ─── token sponsor payments (D-40) ───────────────────────────────────────
// The sponsor usually has no account: they arrive on the invite token in
// the email. The account handlers above cannot serve them, so these six
// mirror them exactly with loadTokenBooking instead of loadAccountBooking.
// The money path is identical (same createIntentFor / confirmIntent, same
// webhook settlement, same idempotency): only the credential differs.

exports.createSponsorPaymentIntentByToken = async (req, res) => {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;
    const loaded = await loadTokenBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const sponsorship = await refreshSponsorship(
      await loadSponsorship(loaded.booking.id, loaded.party.sponsorshipId)
    );
    if (!sponsorship) return sendError(res, 404, 'Sponsorship not found');
    if (sponsorship.status !== 'accepted') {
      return sendError(res, 409, `This sponsorship cannot be paid while ${sponsorship.status}`, 'sponsorship_not_payable');
    }
    if (sponsorship.stripe_payment_intent_id) {
      const existing = await loadLiveIntent(stripe, sponsorship.stripe_payment_intent_id);
      if (existing && Number(existing.amount) === Number(sponsorship.amount_cents)
        && !['succeeded', 'canceled'].includes(existing.status)) {
        return res.json({
          success: true,
          data: {
            sponsorshipId: sponsorship.id,
            clientSecret: existing.client_secret,
            paymentIntentId: existing.id,
            amountCents: Number(sponsorship.amount_cents),
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
          },
        });
      }
      if (existing && existing.status === 'succeeded') {
        return sendError(res, 409, 'This sponsorship is already paid', 'sponsorship_already_paid');
      }
    }
    const intent = await createIntentFor({
      booking: loaded.booking,
      sponsorship,
      payerEmail: sponsorship.sponsor_email,
    });
    await pool.query(
      `UPDATE booking_sponsorships SET stripe_payment_intent_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [sponsorship.id, intent.id]
    );
    return res.json({
      success: true,
      data: {
        sponsorshipId: sponsorship.id,
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        amountCents: Number(sponsorship.amount_cents),
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      },
    });
  } catch (err) {
    logger.error('Error creating sponsor PaymentIntent by token', { error: err.message });
    sendError(res, 500, 'Failed to create sponsor payment');
  }
};

exports.confirmSponsorPaymentByToken = async (req, res) => {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;
    const loaded = await loadTokenBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const sponsorship = await loadSponsorship(loaded.booking.id, loaded.party.sponsorshipId);
    if (!sponsorship) return sendError(res, 404, 'Sponsorship not found');
    const paymentIntentId = String(req.body?.paymentIntentId || sponsorship.stripe_payment_intent_id || '');
    if (!paymentIntentId) return sendValidationError(res, { paymentIntentId: 'Payment intent is required' });
    const result = await confirmIntent({
      stripe,
      booking: loaded.booking,
      row: sponsorship,
      table: 'booking_sponsorships',
      intentId: paymentIntentId,
      amountCents: sponsorship.amount_cents,
    });
    if (!result.ok) return sendError(res, result.status, result.error, 'sponsor_payment_mismatch');
    await logBookingAudit(loaded.booking.id, 'sponsorship_paid', loaded.party.userId || null, 'sponsor', loaded.booking.status, loaded.booking.status);
    await notifySponsorUpdate(loaded.booking, result.row, 'The sponsor paid the sponsored amount');
    return res.json({
      success: true,
      data: { ...sponsorshipShape(result.row, loaded.party), paidAt: result.row.paid_at },
    });
  } catch (err) {
    logger.error('Error confirming sponsor payment by token', { error: err.message });
    sendError(res, 500, 'Failed to confirm sponsor payment');
  }
};

exports.getSponsorReceiptByToken = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const sponsorship = await loadSponsorship(loaded.booking.id, loaded.party.sponsorshipId);
    if (!sponsorship) return sendError(res, 404, 'Sponsorship not found');
    return res.json({
      success: true,
      data: {
        sponsorshipId: String(sponsorship.id),
        serviceName: loaded.booking.service_name,
        requestedDate: loaded.booking.requested_date,
        sponsorName: sponsorship.sponsor_name || null,
        amountCents: Number(sponsorship.amount_cents),
        currency: 'USD',
        status: sponsorship.status,
        paidAt: sponsorship.paid_at || null,
        refundedAt: sponsorship.refunded_at || null,
        paymentIntentId: sponsorship.stripe_payment_intent_id || null,
      },
    });
  } catch (err) {
    logger.error('Error fetching sponsor receipt by token', { error: err.message });
    sendError(res, 500, 'Failed to fetch sponsor receipt');
  }
};

exports.respondToChargeByToken = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (decision !== 'accepted' && decision !== 'declined') {
      return sendValidationError(res, { decision: 'Decision must be accepted or declined' });
    }
    const { rows } = await pool.query(
      'SELECT * FROM booking_sponsorship_charges WHERE id = $1 AND booking_id = $2',
      [String(req.params.chargeId || ''), loaded.booking.id]
    );
    const charge = rows[0];
    if (!charge) return sendError(res, 404, 'Additional charge not found');
    if (charge.status !== 'requested') {
      return sendError(res, 409, `This charge is already ${charge.status}`, 'charge_decided');
    }
    const sponsorship = await loadSponsorship(loaded.booking.id, charge.sponsorship_id);
    if (loaded.party.sponsorshipId !== String(charge.sponsorship_id)) {
      return sendError(res, 403, 'Only the sponsor can respond to this charge');
    }
    const { rows: updatedRows } = await pool.query(
      `UPDATE booking_sponsorship_charges SET status = $2, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'requested' RETURNING *`,
      [charge.id, decision]
    );
    if (!updatedRows.length) return sendError(res, 409, 'This charge was already decided', 'charge_decided');
    await logBookingAudit(loaded.booking.id, `sponsorship_charge_${decision}`, loaded.party.userId || null, 'sponsor', loaded.booking.status, loaded.booking.status);
    await notifySponsorUpdate(loaded.booking, sponsorship, decision === 'accepted'
      ? 'The sponsor accepted the additional charge'
      : 'The sponsor declined the additional charge');
    return res.json({ success: true, data: chargeShape(updatedRows[0], loaded.party) });
  } catch (err) {
    logger.error('Error responding to additional charge by token', { error: err.message });
    sendError(res, 500, 'Failed to respond to additional charge');
  }
};

exports.createChargePaymentIntentByToken = async (req, res) => {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;
    const loaded = await loadTokenBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const { rows } = await pool.query(
      'SELECT * FROM booking_sponsorship_charges WHERE id = $1 AND booking_id = $2',
      [String(req.params.chargeId || ''), loaded.booking.id]
    );
    const charge = rows[0];
    if (!charge) return sendError(res, 404, 'Additional charge not found');
    if (charge.status !== 'accepted') {
      return sendError(res, 409, `This charge cannot be paid while ${charge.status}`, 'charge_not_payable');
    }
    if (loaded.party.sponsorshipId !== String(charge.sponsorship_id)) {
      return sendError(res, 403, 'Only the sponsor can pay this charge');
    }
    const sponsorship = await loadSponsorship(loaded.booking.id, charge.sponsorship_id);
    if (charge.stripe_payment_intent_id) {
      const existing = await loadLiveIntent(stripe, charge.stripe_payment_intent_id);
      if (existing && Number(existing.amount) === Number(charge.amount_cents)
        && !['succeeded', 'canceled'].includes(existing.status)) {
        return res.json({
          success: true,
          data: {
            chargeId: charge.id,
            clientSecret: existing.client_secret,
            paymentIntentId: existing.id,
            amountCents: Number(charge.amount_cents),
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
          },
        });
      }
      if (existing && existing.status === 'succeeded') {
        return sendError(res, 409, 'This charge is already paid', 'charge_already_paid');
      }
    }
    const intent = await createIntentFor({
      booking: loaded.booking,
      sponsorship,
      charge,
      payerEmail: sponsorship?.sponsor_email,
    });
    await pool.query(
      `UPDATE booking_sponsorship_charges SET stripe_payment_intent_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [charge.id, intent.id]
    );
    return res.json({
      success: true,
      data: {
        chargeId: charge.id,
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        amountCents: Number(charge.amount_cents),
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      },
    });
  } catch (err) {
    logger.error('Error creating charge PaymentIntent by token', { error: err.message });
    sendError(res, 500, 'Failed to create charge payment');
  }
};

exports.confirmChargePaymentByToken = async (req, res) => {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;
    const loaded = await loadTokenBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const { rows } = await pool.query(
      'SELECT * FROM booking_sponsorship_charges WHERE id = $1 AND booking_id = $2',
      [String(req.params.chargeId || ''), loaded.booking.id]
    );
    const charge = rows[0];
    if (!charge) return sendError(res, 404, 'Additional charge not found');
    if (loaded.party.sponsorshipId !== String(charge.sponsorship_id)) {
      return sendError(res, 403, 'Only the sponsor can confirm this charge payment');
    }
    const paymentIntentId = String(req.body?.paymentIntentId || charge.stripe_payment_intent_id || '');
    if (!paymentIntentId) return sendValidationError(res, { paymentIntentId: 'Payment intent is required' });
    const result = await confirmIntent({
      stripe,
      booking: loaded.booking,
      row: charge,
      table: 'booking_sponsorship_charges',
      intentId: paymentIntentId,
      amountCents: charge.amount_cents,
    });
    if (!result.ok) return sendError(res, result.status, result.error, 'charge_payment_mismatch');
    const sponsorship = await loadSponsorship(loaded.booking.id, charge.sponsorship_id);
    await notifySponsorUpdate(loaded.booking, sponsorship, 'The sponsor paid the additional charge');
    return res.json({ success: true, data: chargeShape(result.row, loaded.party) });
  } catch (err) {
    logger.error('Error confirming charge payment by token', { error: err.message });
    sendError(res, 500, 'Failed to confirm charge payment');
  }
};

// ─── additional charges (items 126-127) ───────────────────────────────────

exports.requestAdditionalCharge = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'helper']);
    if (!loaded) return;
    const sponsorship = await refreshSponsorship(
      await loadSponsorship(loaded.booking.id, String(req.params.sponsorshipId || ''))
    );
    if (!sponsorship) return sendError(res, 404, 'Sponsorship not found');
    if (!['accepted', 'paid'].includes(sponsorship.status)) {
      return sendError(res, 409, `Additional charges cannot be requested while the sponsorship is ${sponsorship.status}`, 'sponsorship_not_live');
    }
    const amountCents = cleanCents(req.body?.amountCents ?? req.body?.amount_cents);
    if (amountCents == null || amountCents < MIN_SPONSORSHIP_CENTS || amountCents > MAX_SPONSORSHIP_CENTS) {
      return sendValidationError(res, { amountCents: 'Amount must be between $0.50 and $50,000' });
    }
    const reason = cleanText(req.body?.reason, 500);
    if (!reason) return sendValidationError(res, { reason: 'A reason for the additional charge is required' });
    const { rows } = await pool.query(
      `INSERT INTO booking_sponsorship_charges
         (sponsorship_id, booking_id, amount_cents, reason, status, requested_by)
       VALUES ($1, $2, $3, $4, 'requested', $5) RETURNING *`,
      [sponsorship.id, loaded.booking.id, amountCents, reason, req.user.id]
    );
    await logBookingAudit(loaded.booking.id, 'sponsorship_charge_requested', req.user.id, loaded.party.role, loaded.booking.status, loaded.booking.status);
    await notifySponsorUpdate(loaded.booking, sponsorship, `An additional charge of $${(amountCents / 100).toFixed(2)} was requested: ${reason}`);
    return res.status(201).json({ success: true, data: chargeShape(rows[0], loaded.party) });
  } catch (err) {
    logger.error('Error requesting additional charge', { error: err.message });
    sendError(res, 500, 'Failed to request additional charge');
  }
};

exports.listAdditionalCharges = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'sponsor']);
    if (!loaded) return;
    const { rows } = await pool.query(
      `SELECT * FROM booking_sponsorship_charges
        WHERE booking_id = $1 AND sponsorship_id = $2 ORDER BY created_at ASC`,
      [loaded.booking.id, String(req.params.sponsorshipId || '')]
    );
    return res.json({ success: true, data: rows.map((r) => chargeShape(r, loaded.party)) });
  } catch (err) {
    logger.error('Error listing additional charges', { error: err.message });
    sendError(res, 500, 'Failed to list additional charges');
  }
};

exports.respondToCharge = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (decision !== 'accepted' && decision !== 'declined') {
      return sendValidationError(res, { decision: 'Decision must be accepted or declined' });
    }
    const { rows } = await pool.query(
      'SELECT * FROM booking_sponsorship_charges WHERE id = $1 AND booking_id = $2',
      [String(req.params.chargeId || ''), loaded.booking.id]
    );
    const charge = rows[0];
    if (!charge) return sendError(res, 404, 'Additional charge not found');
    if (charge.status !== 'requested') {
      return sendError(res, 409, `This charge is already ${charge.status}`, 'charge_decided');
    }
    const sponsorship = await loadSponsorship(loaded.booking.id, charge.sponsorship_id);
    if (loaded.party.sponsorshipId !== String(charge.sponsorship_id)
      && !(sponsorship?.sponsor_user_id && String(sponsorship.sponsor_user_id) === String(loaded.party.userId))) {
      return sendError(res, 403, 'Only the sponsor can respond to this charge');
    }
    const { rows: updatedRows } = await pool.query(
      `UPDATE booking_sponsorship_charges SET status = $2, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'requested' RETURNING *`,
      [charge.id, decision]
    );
    if (!updatedRows.length) return sendError(res, 409, 'This charge was already decided', 'charge_decided');
    await logBookingAudit(loaded.booking.id, `sponsorship_charge_${decision}`, loaded.party.userId || null, 'sponsor', loaded.booking.status, loaded.booking.status);
    await notifySponsorUpdate(loaded.booking, sponsorship, decision === 'accepted'
      ? 'The sponsor accepted the additional charge'
      : 'The sponsor declined the additional charge');
    return res.json({ success: true, data: chargeShape(updatedRows[0], loaded.party) });
  } catch (err) {
    logger.error('Error responding to additional charge', { error: err.message });
    sendError(res, 500, 'Failed to respond to additional charge');
  }
};

exports.createChargePaymentIntent = async (req, res) => {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;
    const loaded = await loadAccountBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const { rows } = await pool.query(
      'SELECT * FROM booking_sponsorship_charges WHERE id = $1 AND booking_id = $2',
      [String(req.params.chargeId || ''), loaded.booking.id]
    );
    const charge = rows[0];
    if (!charge) return sendError(res, 404, 'Additional charge not found');
    if (charge.status !== 'accepted') {
      return sendError(res, 409, `This charge cannot be paid while ${charge.status}`, 'charge_not_payable');
    }
    const sponsorship = await loadSponsorship(loaded.booking.id, charge.sponsorship_id);
    if (charge.stripe_payment_intent_id) {
      const existing = await loadLiveIntent(stripe, charge.stripe_payment_intent_id);
      if (existing && Number(existing.amount) === Number(charge.amount_cents)
        && !['succeeded', 'canceled'].includes(existing.status)) {
        return res.json({
          success: true,
          data: {
            chargeId: charge.id,
            clientSecret: existing.client_secret,
            paymentIntentId: existing.id,
            amountCents: Number(charge.amount_cents),
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
          },
        });
      }
      if (existing && existing.status === 'succeeded') {
        return sendError(res, 409, 'This charge is already paid', 'charge_already_paid');
      }
    }
    const intent = await createIntentFor({
      booking: loaded.booking,
      sponsorship,
      charge,
      payerEmail: sponsorship?.sponsor_email,
    });
    await pool.query(
      `UPDATE booking_sponsorship_charges SET stripe_payment_intent_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [charge.id, intent.id]
    );
    return res.json({
      success: true,
      data: {
        chargeId: charge.id,
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        amountCents: Number(charge.amount_cents),
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      },
    });
  } catch (err) {
    logger.error('Error creating charge PaymentIntent', { error: err.message });
    sendError(res, 500, 'Failed to create charge payment');
  }
};

exports.confirmChargePayment = async (req, res) => {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;
    const loaded = await loadAccountBooking(req, res, ['sponsor']);
    if (!loaded) return;
    const { rows } = await pool.query(
      'SELECT * FROM booking_sponsorship_charges WHERE id = $1 AND booking_id = $2',
      [String(req.params.chargeId || ''), loaded.booking.id]
    );
    const charge = rows[0];
    if (!charge) return sendError(res, 404, 'Additional charge not found');
    const paymentIntentId = String(req.body?.paymentIntentId || charge.stripe_payment_intent_id || '');
    if (!paymentIntentId) return sendValidationError(res, { paymentIntentId: 'Payment intent is required' });
    const result = await confirmIntent({
      stripe,
      booking: loaded.booking,
      row: charge,
      table: 'booking_sponsorship_charges',
      intentId: paymentIntentId,
      amountCents: charge.amount_cents,
    });
    if (!result.ok) return sendError(res, result.status, result.error, 'charge_payment_mismatch');
    const sponsorship = await loadSponsorship(loaded.booking.id, charge.sponsorship_id);
    await notifySponsorUpdate(loaded.booking, sponsorship, 'The sponsor paid the additional charge');
    return res.json({ success: true, data: chargeShape(result.row, loaded.party) });
  } catch (err) {
    logger.error('Error confirming charge payment', { error: err.message });
    sendError(res, 500, 'Failed to confirm charge payment');
  }
};

// ─── payment breakdown (items 129, 135, D-41) ────────────────────────────

exports.getPaymentBreakdown = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'sponsor']);
    if (!loaded) return;
    const { booking, party } = loaded;
    const isBooker = party.role === 'booker';
    const paidSponsored = await recipientSvc.paidSponsorshipCents(booking.id);
    const { rows: sponsorships } = await pool.query(
      `SELECT * FROM booking_sponsorships WHERE booking_id = $1 ORDER BY created_at ASC`,
      [booking.id]
    );
    const { rows: charges } = await pool.query(
      `SELECT * FROM booking_sponsorship_charges WHERE booking_id = $1 ORDER BY created_at ASC`,
      [booking.id]
    );
    const ownSponsorship = (s) => isBooker
      || (party.sponsorshipId && String(party.sponsorshipId) === String(s.id))
      || (s.sponsor_user_id && party.userId && String(s.sponsor_user_id) === String(party.userId));
    const payments = [];
    if (isBooker) {
      payments.push({
        payer: 'booker',
        payerLabel: 'Booker',
        amountCents: booking.payment_amount_cents != null ? Number(booking.payment_amount_cents) : null,
        paymentStatus: booking.payment_status || null,
        paidAt: booking.paid_at || null,
        refundedAt: booking.refunded_at || null,
        refundDestination: booking.payment_status === 'refunded'
          ? 'Refunded to the booker\u2019s original payment method'
          : null,
      });
    }
    for (const s of sponsorships) {
      if (!ownSponsorship(s)) continue;
      payments.push({
        payer: 'sponsor',
        payerLabel: s.sponsor_name || 'Sponsor',
        sponsorshipId: String(s.id),
        amountCents: Number(s.amount_cents),
        paymentStatus: s.status,
        paidAt: s.paid_at || null,
        refundedAt: s.refunded_at || null,
        refundDestination: s.status === 'refunded'
          ? 'Refunded to the sponsor\u2019s original payment method'
          : null,
      });
    }
    for (const c of charges) {
      const parent = sponsorships.find((s) => String(s.id) === String(c.sponsorship_id));
      if (!parent || !ownSponsorship(parent)) continue;
      payments.push({
        payer: 'sponsor',
        payerLabel: `${parent.sponsor_name || 'Sponsor'} (additional charge)`,
        sponsorshipId: String(parent.id),
        chargeId: String(c.id),
        amountCents: Number(c.amount_cents),
        paymentStatus: c.status,
        paidAt: c.paid_at || null,
        refundedAt: c.refunded_at || null,
        refundDestination: c.status === 'refunded'
          ? 'Refunded to the sponsor\u2019s original payment method'
          : null,
      });
    }
    const declaredCents = Number(booking.gross_amount_cents || 0) > 0
      ? Number(booking.gross_amount_cents)
      : (Number(booking.payment_amount_cents || 0) > 0 ? Number(booking.payment_amount_cents) : null);
    const promoDiscountCents = Number(booking.promo_discount_cents || 0);
    return res.json({
      success: true,
      data: {
        bookingId: String(booking.id),
        declaredCents: isBooker ? declaredCents : null,
        promoDiscountCents: isBooker ? promoDiscountCents : null,
        sponsoredPaidCents: isBooker ? paidSponsored : null,
        remainingCents: isBooker && declaredCents != null
          ? Math.max(0, declaredCents - promoDiscountCents - paidSponsored)
          : null,
        payments,
      },
    });
  } catch (err) {
    logger.error('Error fetching payment breakdown', { error: err.message });
    sendError(res, 500, 'Failed to fetch payment breakdown');
  }
};

// ─── support intake (items 136-140, D-47) ────────────────────────────────

/**
 * The intake is a real support ticket with booking metadata, so triage,
 * replies, and SLA ride the existing support pipeline instead of a
 * parallel case system. The scoped timeline shows non-internal messages
 * only (item 139).
 */
async function doSupportIntake(booking, party, body) {
  const kind = String(body?.kind || 'general');
  if (!SUPPORT_KINDS.includes(kind)) return { error: 'kind' };
  const subject = cleanText(body?.subject, 500) || ({
    general: 'Visit support request',
    missed_provider: 'Missed provider report',
    payment: 'Sponsor payment support',
    callback: 'Callback request',
  })[kind];
  const message = cleanText(body?.message, 5000);
  if (!message) return { error: 'message' };
  const name = cleanText(body?.name, 200)
    || (party.role === 'recipient' ? booking.recipient_name : null)
    || (party.role === 'site_contact' ? booking.site_contact_name : null)
    || 'Visit participant';
  const email = String(body?.email || '').trim().toLowerCase() || null;
  const callbackWindow = cleanText(body?.callbackWindow || body?.preferred_window, 200);
  const priority = kind === 'missed_provider' ? 'high' : 'normal';
  const metadata = {
    booking_id: String(booking.id),
    reporter_role: party.role,
    kind,
    ...(callbackWindow ? { callback_window: callbackWindow } : {}),
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: ticketRows } = await client.query(
      `INSERT INTO support_tickets
         (user_id, name, email, subject, category, priority, status, source, metadata, sla_due_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', 'widget', $7::jsonb,
               NOW() + (CASE $6::varchar
                 WHEN 'urgent' THEN INTERVAL '1 hour'
                 WHEN 'high' THEN INTERVAL '4 hours'
                 WHEN 'low' THEN INTERVAL '72 hours'
                 ELSE INTERVAL '24 hours' END))
       RETURNING *`,
      [
        party.userId || null,
        name,
        email || '',
        subject,
        SUPPORT_CATEGORIES[kind],
        priority,
        JSON.stringify(metadata),
      ]
    );
    const ticket = ticketRows[0];
    const { rows: messageRows } = await client.query(
      `INSERT INTO support_messages
         (ticket_id, sender_id, sender_name, sender_email, content, sender_language, is_internal, is_from_admin)
       VALUES ($1, $2, $3, $4, $5, 'en', false, false) RETURNING *`,
      [ticket.id, party.userId || null, name, email || '', message]
    );
    await client.query('COMMIT');
    try {
      scheduleSupportMessageNotifications({
        ticketId: ticket.id,
        messageId: messageRows[0].id,
        senderId: party.userId || null,
        body: message,
        title: 'New visit support request',
        actionUrl: '/support/agent',
      });
    } catch (err) {
      logger.warn('Failed to schedule visit support notifications', { error: err.message });
    }
    if (callbackWindow) {
      await pool.query(
        `INSERT INTO booking_callbacks (booking_id, requested_by_type, requested_by_user_id, target, preferred_window)
         VALUES ($1, $2, $3, 'support', $4)`,
        [booking.id, party.role, party.userId || null, callbackWindow]
      );
    }
    await logBookingAudit(booking.id, `support_${kind}`, party.userId || null, party.role, booking.status, booking.status);
    await recipientSvc.notifyBookerOfSiteAction(booking, {
      actionLabel: kind === 'missed_provider' ? 'Reported a missed provider' : 'Opened a support request',
      detail: subject,
    });
    return { ticket };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

exports.submitSupportIntake = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact', 'sponsor']);
    if (!loaded) return;
    if (loaded.party.role === 'sponsor' && String(req.body?.kind || '') !== 'payment') {
      return sendValidationError(res, { kind: 'Sponsors open payment support only' });
    }
    const result = await doSupportIntake(loaded.booking, loaded.party, req.body || {});
    if (result.error === 'kind') return sendValidationError(res, { kind: 'Unknown support kind' });
    if (result.error === 'message') return sendValidationError(res, { message: 'A message is required' });
    return res.status(201).json({
      success: true,
      data: {
        ticketId: String(result.ticket.id),
        ticketNumber: result.ticket.ticket_number,
        status: result.ticket.status,
      },
    });
  } catch (err) {
    logger.error('Error submitting visit support intake', { error: err.message });
    sendError(res, 500, 'Failed to submit support request');
  }
};

exports.submitTokenSupportIntake = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const result = await doSupportIntake(loaded.booking, loaded.party, req.body || {});
    if (result.error === 'kind') return sendValidationError(res, { kind: 'Unknown support kind' });
    if (result.error === 'message') return sendValidationError(res, { message: 'A message is required' });
    return res.status(201).json({
      success: true,
      data: {
        ticketId: String(result.ticket.id),
        ticketNumber: result.ticket.ticket_number,
        status: result.ticket.status,
      },
    });
  } catch (err) {
    logger.error('Error submitting token visit support intake', { error: err.message });
    sendError(res, 500, 'Failed to submit support request');
  }
};

/** Scoped timeline (item 139): the party's own tickets, public messages only. */
async function listScopedTickets(booking, party) {
  const { rows } = await pool.query(
    `SELECT t.id, t.ticket_number, t.subject, t.category, t.status, t.created_at,
            t.metadata
       FROM support_tickets t
      WHERE (t.metadata ->> 'booking_id') = $1
        AND (t.metadata ->> 'reporter_role') = $2
        AND ($3::uuid IS NULL OR t.user_id = $3)
      ORDER BY t.created_at DESC LIMIT 50`,
    [String(booking.id), party.role, party.userId || null]
  );
  const tickets = [];
  for (const ticket of rows) {
    const { rows: messages } = await pool.query(
      `SELECT id, sender_name, content, created_at, is_from_admin
         FROM support_messages
        WHERE ticket_id = $1 AND is_internal = false
        ORDER BY created_at ASC LIMIT 100`,
      [ticket.id]
    );
    tickets.push({
      ticketId: String(ticket.id),
      ticketNumber: ticket.ticket_number,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      kind: ticket.metadata?.kind || null,
      createdAt: ticket.created_at,
      messages: messages.map((m) => ({
        id: String(m.id),
        senderName: m.sender_name,
        content: m.content,
        fromSupport: Boolean(m.is_from_admin),
        createdAt: m.created_at,
      })),
    });
  }
  return tickets;
}

exports.listSupportIntake = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact', 'sponsor']);
    if (!loaded) return;
    return res.json({ success: true, data: await listScopedTickets(loaded.booking, loaded.party) });
  } catch (err) {
    logger.error('Error listing visit support intake', { error: err.message });
    sendError(res, 500, 'Failed to list support requests');
  }
};

exports.listTokenSupportIntake = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    return res.json({ success: true, data: await listScopedTickets(loaded.booking, loaded.party) });
  } catch (err) {
    logger.error('Error listing token visit support intake', { error: err.message });
    sendError(res, 500, 'Failed to list support requests');
  }
};

exports.listCallbacks = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'recipient', 'site_contact']);
    if (!loaded) return;
    const { rows } = await pool.query(
      `SELECT * FROM booking_callbacks WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [loaded.booking.id]
    );
    return res.json({
      success: true,
      data: rows.map((r) => ({
        id: String(r.id),
        requestedBy: r.requested_by_type,
        target: r.target,
        preferredWindow: r.preferred_window || null,
        status: r.status,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    logger.error('Error listing callbacks', { error: err.message });
    sendError(res, 500, 'Failed to list callbacks');
  }
};

// ─── feedback (item 145) ──────────────────────────────────────────────────

async function doFeedback(booking, party, body) {
  const rating = body?.rating == null ? null : Math.round(Number(body.rating));
  if (rating != null && (rating < 1 || rating > 5)) return { error: 'rating' };
  const text = cleanText(body?.body || body?.message, 2000);
  if (rating == null && !text) return { error: 'body' };
  const { rows } = await pool.query(
    `INSERT INTO booking_recipient_feedback (booking_id, author_type, author_user_id, rating, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [booking.id, party.role, party.userId || null, rating, text]
  );
  await recipientSvc.notifyBookerOfSiteAction(booking, {
    actionLabel: 'Shared visit feedback',
    detail: rating ? `${rating}/5` : null,
  });
  return { row: rows[0] };
}

exports.submitFeedback = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const result = await doFeedback(loaded.booking, loaded.party, req.body || {});
    if (result.error === 'rating') return sendValidationError(res, { rating: 'Rating must be 1 to 5' });
    if (result.error === 'body') return sendValidationError(res, { body: 'Feedback text or a rating is required' });
    return res.status(201).json({
      success: true,
      data: { id: String(result.row.id), rating: result.row.rating, createdAt: result.row.created_at },
    });
  } catch (err) {
    logger.error('Error submitting visit feedback', { error: err.message });
    sendError(res, 500, 'Failed to submit feedback');
  }
};

exports.submitTokenFeedback = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const result = await doFeedback(loaded.booking, loaded.party, req.body || {});
    if (result.error === 'rating') return sendValidationError(res, { rating: 'Rating must be 1 to 5' });
    if (result.error === 'body') return sendValidationError(res, { body: 'Feedback text or a rating is required' });
    return res.status(201).json({
      success: true,
      data: { id: String(result.row.id), rating: result.row.rating, createdAt: result.row.created_at },
    });
  } catch (err) {
    logger.error('Error submitting token visit feedback', { error: err.message });
    sendError(res, 500, 'Failed to submit feedback');
  }
};

exports.listFeedback = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'recipient', 'site_contact']);
    if (!loaded) return;
    const { rows } = await pool.query(
      `SELECT * FROM booking_recipient_feedback WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [loaded.booking.id]
    );
    const visible = loaded.party.role === 'booker'
      ? rows
      : rows.filter((r) => r.author_user_id && String(r.author_user_id) === String(loaded.party.userId));
    return res.json({
      success: true,
      data: visible.map((r) => ({
        id: String(r.id),
        authorType: r.author_type,
        rating: r.rating,
        body: r.body,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    logger.error('Error listing visit feedback', { error: err.message });
    sendError(res, 500, 'Failed to list feedback');
  }
};

// ─── site photos (item 142) ───────────────────────────────────────────────

async function doPhotoUpload(booking, party, file) {
  if (!file || !file.buffer) return { error: 'file' };
  const key = await uploadFile(file.buffer, `booking-site-photos/${booking.id}`, file.originalname, file.mimetype);
  if (!key) return { error: 'upload' };
  const { rows } = await pool.query(
    `INSERT INTO booking_site_photos (booking_id, contributor_type, contributor_user_id, storage_key, mime_type)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [booking.id, party.role, party.userId || null, key, file.mimetype]
  );
  await logBookingAudit(booking.id, 'site_photo_added', party.userId || null, party.role, booking.status, booking.status);
  return { row: rows[0], key };
}

exports.uploadSitePhoto = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const result = await doPhotoUpload(loaded.booking, loaded.party, req.file);
    if (result.error === 'file') return sendValidationError(res, { file: 'A photo file is required' });
    if (result.error === 'upload') return sendError(res, 500, 'Photo upload failed');
    const url = await getSignedDownloadUrl(result.key, 3600).catch(() => null);
    return res.status(201).json({
      success: true,
      data: { id: String(result.row.id), key: result.key, url: url || null, createdAt: result.row.created_at },
    });
  } catch (err) {
    logger.error('Error uploading site photo', { error: err.message });
    sendError(res, 500, 'Failed to upload photo');
  }
};

exports.uploadTokenSitePhoto = async (req, res) => {
  try {
    const loaded = await loadTokenBooking(req, res, ['recipient', 'site_contact']);
    if (!loaded) return;
    const result = await doPhotoUpload(loaded.booking, loaded.party, req.file);
    if (result.error === 'file') return sendValidationError(res, { file: 'A photo file is required' });
    if (result.error === 'upload') return sendError(res, 500, 'Photo upload failed');
    const url = await getSignedDownloadUrl(result.key, 3600).catch(() => null);
    return res.status(201).json({
      success: true,
      data: { id: String(result.row.id), key: result.key, url: url || null, createdAt: result.row.created_at },
    });
  } catch (err) {
    logger.error('Error uploading token site photo', { error: err.message });
    sendError(res, 500, 'Failed to upload photo');
  }
};

exports.listSitePhotos = async (req, res) => {
  try {
    const loaded = await loadAccountBooking(req, res, ['booker', 'recipient', 'site_contact']);
    if (!loaded) return;
    const { rows } = await pool.query(
      `SELECT * FROM booking_site_photos WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [loaded.booking.id]
    );
    const photos = [];
    for (const row of rows) {
      const url = await getSignedDownloadUrl(row.storage_key, 3600).catch(() => null);
      photos.push({
        id: String(row.id),
        contributorType: row.contributor_type,
        key: row.storage_key,
        url: url || null,
        createdAt: row.created_at,
      });
    }
    return res.json({ success: true, data: photos });
  } catch (err) {
    logger.error('Error listing site photos', { error: err.message });
    sendError(res, 500, 'Failed to list photos');
  }
};
