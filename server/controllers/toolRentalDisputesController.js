'use strict';
// Group 11 Slice 2e: Disputes + Maintain + Review (586, 587, 589, 590, 591,
// 594, 595, 597, 600). Record-only money (D-257): damage-claim amounts and
// resolutions are recorded; the money settles off-platform, never through a
// platform transfer. Every action is party-checked on the server.
const db = require('../db');
const logger = require('../utils/logger');
const { uploadFile, getPublicUrl, deleteFile } = require('../utils/storage');
const { parseDateOnlyUTC } = require('../utils/dateOnly');
// G11-B2 (D-609): booking-flow notices go through the shared helper
// (notify_bookings toggle honored). Escalation-thread replies keep the
// Wave 3 sender below: an escalation is a safety thread, so the
// bookings toggle does not silence it.
const { notifyRental, notifyRentalCounterparty } = require('../utils/toolRentalNotifications');

const MAX_TEXT = 2000;
const MAX_TITLE = 200;
const ESCALATION_CATEGORIES = ['damage', 'deposit', 'condition', 'other'];
const ESCALATION_STATUSES = ['open', 'in_review', 'resolved'];

function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ error: message, code, ...extra });
}

function cleanText(value, max = MAX_TEXT, { required = false } = {}) {
  if (value === undefined || value === null) return required ? null : null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return required ? null : null;
  if (text.length > max) return undefined;
  return text;
}

function parseMoney(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 100000) return undefined;
  return Math.round(num * 100) / 100;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

// Party check: loads the booking and returns { booking, isOwner, isRenter }
// or sends 404 (a stranger learns nothing) / 403 (a party acting in the
// wrong role). A role label never grants access by itself.
async function loadBookingParty(req, res, bookingId) {
  const id = Number(bookingId);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'validation_failed', 'Invalid booking id');
    return null;
  }
  const { rows } = await db.query(
    'SELECT * FROM tool_rentals_bookings WHERE id = $1',
    [id],
  );
  const booking = rows[0];
  if (!booking) {
    fail(res, 404, 'not_found', 'Booking not found');
    return null;
  }
  const isOwner = String(booking.owner_id) === String(req.user.id);
  const isRenter = String(booking.customer_id) === String(req.user.id);
  if (!isOwner && !isRenter) {
    fail(res, 404, 'not_found', 'Booking not found');
    return null;
  }
  return { booking, isOwner, isRenter };
}

async function loadToolOwner(req, res, toolId) {
  const id = Number(toolId);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'validation_failed', 'Invalid tool id');
    return null;
  }
  const { rows } = await db.query(
    'SELECT id, user_id FROM tool_rentals WHERE id = $1',
    [id],
  );
  const tool = rows[0];
  if (!tool || String(tool.user_id) !== String(req.user.id)) {
    fail(res, 404, 'not_found', 'Tool not found');
    return null;
  }
  return tool;
}

// ---------------------------------------------------------------- 586: damage claim

const listDamageClaims = async (req, res) => {
  try {
    const party = await loadBookingParty(req, res, req.params.bookingId);
    if (!party) return;
    const { rows } = await db.query(
      `SELECT * FROM tool_rental_damage_claims
        WHERE booking_id = $1 ORDER BY created_at DESC, id DESC`,
      [party.booking.id],
    );
    return res.json({ claims: rows });
  } catch (err) {
    logger.error('listDamageClaims error', { err });
    return res.status(500).json({ error: 'Failed to load damage claims' });
  }
};

const fileDamageClaim = async (req, res) => {
  try {
    const party = await loadBookingParty(req, res, req.params.bookingId);
    if (!party) return;
    const { booking } = party;
    if (!['payment_confirmed', 'returned', 'completed'].includes(booking.status)) {
      return fail(res, 409, 'state_conflict', 'Damage claims open once the rental is paid and underway');
    }
    const amount = parseMoney(req.body?.amount);
    if (amount === null || amount === undefined || amount <= 0) {
      return fail(res, 400, 'validation_failed', 'A damage claim needs an amount greater than 0');
    }
    const description = cleanText(req.body?.description, MAX_TEXT, { required: true });
    if (description === null) {
      return fail(res, 400, 'validation_failed', 'A damage claim needs a description');
    }
    if (description === undefined) {
      return fail(res, 400, 'validation_failed', 'Description is too long');
    }
    // Linked condition-report evidence (587): the report must belong to
    // this booking; a claim may also stand without a report.
    let evidenceReportId = null;
    if (req.body?.evidence_report_id !== undefined && req.body.evidence_report_id !== null && req.body.evidence_report_id !== '') {
      if (!isUuid(req.body.evidence_report_id)) {
        return fail(res, 400, 'validation_failed', 'Invalid evidence report id');
      }
      const { rows } = await db.query(
        'SELECT id FROM equipment_reports WHERE id = $1 AND booking_id = $2',
        [req.body.evidence_report_id, booking.id],
      );
      if (!rows.length) {
        return fail(res, 400, 'validation_failed', 'Evidence report does not belong to this booking');
      }
      evidenceReportId = req.body.evidence_report_id;
    }
    const open = await db.query(
      "SELECT id FROM tool_rental_damage_claims WHERE booking_id = $1 AND status = 'open' LIMIT 1",
      [booking.id],
    );
    if (open.rows.length) {
      return fail(res, 409, 'claim_already_open', 'A damage claim is already open on this booking');
    }
    const { rows } = await db.query(
      `INSERT INTO tool_rental_damage_claims
         (booking_id, tool_id, filed_by, amount, description, evidence_report_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [booking.id, booking.tool_id, req.user.id, amount, description, evidenceReportId],
    );
    // G11-B2 (D-609): the counterparty is told a claim was filed.
    await notifyRentalCounterparty({
      booking, actorId: req.user.id, type: 'tool_rental_damage_claim_filed',
      eventKey: `filed:${rows[0].created_at}`,
      data: { claim_id: String(rows[0].id) },
    });
    return res.status(201).json({ claim: rows[0] });
  } catch (err) {
    logger.error('fileDamageClaim error', { err });
    return res.status(500).json({ error: 'Failed to file damage claim' });
  }
};

async function loadClaim(req, res, booking) {
  if (!isUuid(req.params.claimId)) {
    fail(res, 400, 'validation_failed', 'Invalid claim id');
    return null;
  }
  const { rows } = await db.query(
    'SELECT * FROM tool_rental_damage_claims WHERE id = $1 AND booking_id = $2',
    [req.params.claimId, booking.id],
  );
  if (!rows.length) {
    fail(res, 404, 'not_found', 'Damage claim not found');
    return null;
  }
  return rows[0];
}

// The other party (not the filer) resolves: agree an amount (at most the
// claimed amount, 0 allowed for a no-charge agreement) or decline with a
// reason. Recorded only; no money moves (D-257).
const resolveDamageClaim = async (req, res) => {
  try {
    const party = await loadBookingParty(req, res, req.params.bookingId);
    if (!party) return;
    const claim = await loadClaim(req, res, party.booking);
    if (!claim) return;
    if (String(claim.filed_by) === String(req.user.id)) {
      return fail(res, 403, 'access_required', 'The filer cannot resolve their own claim');
    }
    if (claim.status !== 'open') {
      return fail(res, 409, 'state_conflict', 'This claim is already resolved');
    }
    const decision = req.body?.decision;
    if (!['agreed', 'declined'].includes(decision)) {
      return fail(res, 400, 'validation_failed', 'decision must be agreed or declined');
    }
    const reason = cleanText(req.body?.reason, MAX_TEXT);
    if (reason === undefined) {
      return fail(res, 400, 'validation_failed', 'Reason is too long');
    }
    let agreedAmount = null;
    if (decision === 'agreed') {
      agreedAmount = parseMoney(req.body?.agreed_amount);
      if (agreedAmount === null || agreedAmount === undefined) {
        return fail(res, 400, 'validation_failed', 'An agreed claim needs an agreed amount');
      }
      if (agreedAmount > Number(claim.amount)) {
        return fail(res, 400, 'validation_failed', 'The agreed amount cannot exceed the claimed amount');
      }
    } else if (!reason) {
      return fail(res, 400, 'validation_failed', 'Declining a claim needs a reason');
    }
    const { rows } = await db.query(
      `UPDATE tool_rental_damage_claims
          SET status = $2, agreed_amount = $3, resolution_reason = $4,
              resolved_by = $5, resolved_at = NOW(), ack_status = 'pending',
              acknowledged_by = NULL, acknowledged_at = NULL, updated_at = NOW()
        WHERE id = $1 AND status = 'open' RETURNING *`,
      [claim.id, decision === 'agreed' ? 'resolved' : 'declined', agreedAmount, reason || null, req.user.id],
    );
    if (!rows.length) return fail(res, 409, 'state_conflict', 'This claim is already resolved');
    // G11-B2 (D-609): the filer is told the claim was resolved.
    await notifyRental({
      userId: claim.filed_by,
      type: 'tool_rental_damage_claim_resolved',
      bookingId: party.booking.id,
      eventKey: `resolved:${rows[0].resolved_at}`,
      data: { claim_id: String(claim.id) },
    });
    return res.json({ claim: rows[0] });
  } catch (err) {
    logger.error('resolveDamageClaim error', { err });
    return res.status(500).json({ error: 'Failed to resolve damage claim' });
  }
};

// 590: the filer acknowledges the resolution, or disputes it, which
// reopens the claim for a fresh resolution.
const acknowledgeDamageClaim = async (req, res) => {
  try {
    const party = await loadBookingParty(req, res, req.params.bookingId);
    if (!party) return;
    const claim = await loadClaim(req, res, party.booking);
    if (!claim) return;
    if (String(claim.filed_by) !== String(req.user.id)) {
      return fail(res, 403, 'access_required', 'Only the filer acknowledges the resolution');
    }
    if (claim.status === 'open' || claim.ack_status !== 'pending') {
      return fail(res, 409, 'state_conflict', 'There is no resolution waiting to be acknowledged');
    }
    const decision = req.body?.decision;
    if (!['acknowledged', 'disputed'].includes(decision)) {
      return fail(res, 400, 'validation_failed', 'decision must be acknowledged or disputed');
    }
    if (decision === 'acknowledged') {
      const { rows } = await db.query(
        `UPDATE tool_rental_damage_claims
            SET ack_status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND ack_status = 'pending' RETURNING *`,
        [claim.id, req.user.id],
      );
      // G11-B2 (D-609): the resolver is told the filer acknowledged.
      await notifyRental({
        userId: claim.resolved_by,
        type: 'tool_rental_damage_claim_acknowledged',
        bookingId: party.booking.id,
        eventKey: `ack:${rows[0].acknowledged_at}`,
        data: { claim_id: String(claim.id) },
      });
      return res.json({ claim: rows[0] });
    }
    const { rows } = await db.query(
      `UPDATE tool_rental_damage_claims
          SET status = 'open', ack_status = 'disputed', acknowledged_by = $2,
              acknowledged_at = NOW(), agreed_amount = NULL, resolution_reason = NULL,
              resolved_by = NULL, resolved_at = NULL, updated_at = NOW()
        WHERE id = $1 AND ack_status = 'pending' RETURNING *`,
      [claim.id, req.user.id],
    );
    // G11-B2 (D-609): the resolver is told the filer disputed, so the
    // claim is open again. resolved_by was cleared by the UPDATE above,
    // so it is read from the pre-update claim row.
    await notifyRental({
      userId: claim.resolved_by,
      type: 'tool_rental_damage_claim_acknowledged',
      bookingId: party.booking.id,
      eventKey: `ack:${rows[0].acknowledged_at}`,
      data: { claim_id: String(claim.id) },
    });
    return res.json({ claim: rows[0] });
  } catch (err) {
    logger.error('acknowledgeDamageClaim error', { err });
    return res.status(500).json({ error: 'Failed to acknowledge damage claim' });
  }
};

// ---------------------------------------------------------------- 589: escalation

// 589 (D-569/D-572): who works the rental-escalation queue. Active,
// non-deleted admins / super_admins holding the global `moderate_content`
// grant (super_admins unconditionally), the same gate as the admin
// escalation endpoints. Capped at 25 like the support-staff fan-out, so
// an escalation open never notifies an unbounded list. Mirrors
// resolveSupportStaffIds (supportNotificationService.js); the grant
// differs because this queue is a moderation queue, not support.
const ESCALATION_ADMIN_ALERT_LIMIT = 25;
async function resolveEscalationAdminIds() {
  const { rows } = await db.query(
    `SELECT u.id FROM users u
      WHERE u.role::text = ANY($1::text[])
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
        AND (u.role = 'super_admin' OR EXISTS (
          SELECT 1 FROM admin_permission_grants g
           WHERE g.grantee_id = u.id
             AND g.permissions ? 'moderate_content'
             AND g.region_id IS NULL
             AND g.revoked_at IS NULL
             AND g.expires_at > NOW()
        ))
      ORDER BY u.id
      LIMIT $2`,
    [['admin', 'super_admin'], ESCALATION_ADMIN_ALERT_LIMIT],
  );
  return rows.map((row) => String(row.id));
}

// 589 (D-572/D-569): escalation-open notices. Awaited by the caller but
// failure-safe: the helper catches everything, so a failed send is logged
// and never turns the 201 into a 500. The fan-out is bounded (one
// counterparty + at most 25 admins), so the wait is one small query plus
// a few notification rows. One sendNotification per recipient with a
// per-recipient idempotency key, so a retry cannot duplicate the row.
// The counterparty links to their bookings; admins link to the queue.
async function notifyEscalationOpened({ escalation, booking, openerId }) {
  try {
    const { sendNotification } = require('../services/notificationService');
    const counterpartyId = String(openerId) === String(booking.owner_id) ? booking.customer_id : booking.owner_id;
    const sends = [];
    if (String(counterpartyId) !== String(openerId)) {
      sends.push({
        userId: String(counterpartyId),
        action_url: '/my-bookings',
        idempotencyKey: `tool-rental-escalation-opened:${escalation.id}:${counterpartyId}`,
      });
    }
    for (const adminId of await resolveEscalationAdminIds()) {
      if (adminId !== String(openerId)) {
        sends.push({
          userId: adminId,
          action_url: '/admin/tool-rentals',
          idempotencyKey: `tool-rental-escalation-opened:${escalation.id}:${adminId}`,
        });
      }
    }
    const results = await Promise.allSettled(sends.map((s) => sendNotification({
      userId: s.userId,
      type: 'tool_rental_escalation_opened',
      data: { escalation_id: String(escalation.id), booking_id: String(booking.id), category: escalation.category },
      action_url: s.action_url,
      idempotencyKey: s.idempotencyKey,
    })));
    const failed = results.filter((r) => r.status === 'rejected' || r.value?.success === false).length;
    if (failed) logger.warn('Rental escalation open notification had failures', { escalationId: escalation.id, failed });
  } catch (err) {
    logger.warn('Rental escalation open notification failed', { escalationId: escalation?.id, error: err.message });
  }
}

// 589 (D-569/D-572): an admin closing the thread notifies both parties,
// each with a per-recipient key scoped to this resolution (resolved_at),
// so a re-resolve after a dispute notifies again. Awaited by the caller
// but failure-safe, same shape as notifyEscalationOpened.
async function notifyEscalationResolved({ escalation, booking }) {
  try {
    const { sendNotification } = require('../services/notificationService');
    const key = String(escalation.resolved_at || 'unresolved');
    const results = await Promise.allSettled(
      [booking.customer_id, booking.owner_id].map((userId) => sendNotification({
        userId: String(userId),
        type: 'tool_rental_escalation_resolved',
        data: { escalation_id: String(escalation.id), booking_id: String(booking.id), category: escalation.category },
        action_url: '/my-bookings',
        idempotencyKey: `tool-rental-escalation-resolved:${escalation.id}:${key}:${userId}`,
      })),
    );
    const failed = results.filter((r) => r.status === 'rejected' || r.value?.success === false).length;
    if (failed) logger.warn('Rental escalation resolved notification had failures', { escalationId: escalation.id, failed });
  } catch (err) {
    logger.warn('Rental escalation resolved notification failed', { escalationId: escalation?.id, error: err.message });
  }
}

function serializeEscalation(row, messages) {
  return { ...row, messages: messages || [] };
}

// B13 (D-620): a party's accept/dispute of an admin-closed escalation
// tells the counterparty, and a dispute also tells the moderation admins
// (the thread is open again and needs a fresh admin look). The actor is
// never notified of their own action, matching the escalation-open
// convention. Two per-outcome types (acknowledged/disputed) so the bell
// never mislabels a dispute as an acceptance, unlike the damage-claim
// pattern, which sends its acknowledged type on both branches. Awaited
// by the caller but failure-safe, same shape as notifyEscalationResolved.
async function notifyEscalationAcknowledged({ escalation, booking, decision, actorId }) {
  try {
    const { sendNotification } = require('../services/notificationService');
    const key = String(escalation.acknowledged_at || 'unacknowledged');
    const counterpartyId = String(actorId) === String(booking.owner_id) ? booking.customer_id : booking.owner_id;
    const sends = [];
    if (String(counterpartyId) !== String(actorId)) {
      sends.push({
        userId: String(counterpartyId),
        action_url: '/my-bookings',
        idempotencyKey: `tool-rental-escalation-acknowledged:${escalation.id}:${key}:${decision}:${counterpartyId}`,
      });
    }
    if (decision === 'disputed') {
      for (const adminId of await resolveEscalationAdminIds()) {
        if (adminId !== String(actorId)) {
          sends.push({
            userId: adminId,
            action_url: '/admin/tool-rentals',
            idempotencyKey: `tool-rental-escalation-acknowledged:${escalation.id}:${key}:${decision}:${adminId}`,
          });
        }
      }
    }
    const results = await Promise.allSettled(sends.map((s) => sendNotification({
      userId: s.userId,
      type: decision === 'disputed' ? 'tool_rental_escalation_disputed' : 'tool_rental_escalation_acknowledged',
      data: { escalation_id: String(escalation.id), booking_id: String(booking.id), category: escalation.category, decision },
      action_url: s.action_url,
      idempotencyKey: s.idempotencyKey,
    })));
    const failed = results.filter((r) => r.status === 'rejected' || r.value?.success === false).length;
    if (failed) logger.warn('Rental escalation acknowledgment notification had failures', { escalationId: escalation.id, failed });
  } catch (err) {
    logger.warn('Rental escalation acknowledgment notification failed', { escalationId: escalation?.id, error: err.message });
  }
}

// G11-B2 (D-609): an escalation-thread reply tells the other side.
// Same shape as the open/resolved senders: direct sendNotification (the
// safety thread is not silenced by the bookings toggle), per-recipient
// key scoped to the message row, so a retry cannot duplicate the row.
// A party reply tells the counterparty; an admin reply tells both
// parties. Awaited by the caller but failure-safe.
async function notifyEscalationReplied({ escalation, booking, messageId, authorId, authorRole }) {
  try {
    const { sendNotification } = require('../services/notificationService');
    const recipients = authorRole === 'admin'
      ? [booking.customer_id, booking.owner_id]
      : [String(authorId) === String(booking.owner_id) ? booking.customer_id : booking.owner_id];
    const results = await Promise.allSettled(
      recipients
        .filter((userId) => String(userId) !== String(authorId))
        .map((userId) => sendNotification({
          userId: String(userId),
          type: 'tool_rental_escalation_replied',
          data: { escalation_id: String(escalation.id), booking_id: String(booking.id), category: escalation.category },
          action_url: '/my-bookings',
          idempotencyKey: `tool-rental-escalation-replied:${escalation.id}:${messageId}:${userId}`,
        })),
    );
    const failed = results.filter((r) => r.status === 'rejected' || r.value?.success === false).length;
    if (failed) logger.warn('Rental escalation reply notification had failures', { escalationId: escalation.id, failed });
  } catch (err) {
    logger.warn('Rental escalation reply notification failed', { escalationId: escalation?.id, error: err.message });
  }
}

const listEscalations = async (req, res) => {
  try {
    const party = await loadBookingParty(req, res, req.params.bookingId);
    if (!party) return;
    const { rows } = await db.query(
      `SELECT * FROM tool_rental_escalations WHERE booking_id = $1 ORDER BY created_at DESC`,
      [party.booking.id],
    );
    const out = [];
    for (const row of rows) {
      const { rows: messages } = await db.query(
        `SELECT id, author_id, author_role, body, created_at
           FROM tool_rental_escalation_messages WHERE escalation_id = $1 ORDER BY created_at, id`,
        [row.id],
      );
      out.push(serializeEscalation(row, messages));
    }
    return res.json({ escalations: out });
  } catch (err) {
    logger.error('listEscalations error', { err });
    return res.status(500).json({ error: 'Failed to load escalations' });
  }
};

const openEscalation = async (req, res) => {
  try {
    const party = await loadBookingParty(req, res, req.params.bookingId);
    if (!party) return;
    const category = req.body?.category;
    if (!ESCALATION_CATEGORIES.includes(category)) {
      return fail(res, 400, 'validation_failed', 'category must be damage, deposit, condition or other');
    }
    const message = cleanText(req.body?.message, MAX_TEXT, { required: true });
    if (message === null) {
      return fail(res, 400, 'validation_failed', 'An escalation needs an opening message');
    }
    if (message === undefined) {
      return fail(res, 400, 'validation_failed', 'Message is too long');
    }
    const { rows } = await db.query(
      `INSERT INTO tool_rental_escalations (booking_id, tool_id, opened_by, category)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [party.booking.id, party.booking.tool_id, req.user.id, category],
    );
    const escalation = rows[0];
    const { rows: first } = await db.query(
      `INSERT INTO tool_rental_escalation_messages (escalation_id, author_id, author_role, body)
       VALUES ($1, $2, $3, $4) RETURNING id, author_id, author_role, body, created_at`,
      [escalation.id, req.user.id, party.isOwner ? 'owner' : 'renter', message],
    );
    // 589 (D-572): tell the counterparty and the moderation admins.
    // Awaited but failure-safe; the helper never throws into this 201.
    await notifyEscalationOpened({ escalation, booking: party.booking, openerId: req.user.id });
    return res.status(201).json({ escalation: serializeEscalation(escalation, first) });
  } catch (err) {
    logger.error('openEscalation error', { err });
    return res.status(500).json({ error: 'Failed to open escalation' });
  }
};

async function loadEscalationForParty(req, res) {
  if (!isUuid(req.params.escalationId)) {
    fail(res, 400, 'validation_failed', 'Invalid escalation id');
    return null;
  }
  const { rows } = await db.query(
    `SELECT e.* FROM tool_rental_escalations e
      JOIN tool_rentals_bookings b ON b.id = e.booking_id
     WHERE e.id = $1 AND (b.owner_id = $2 OR b.customer_id = $2)`,
    [req.params.escalationId, req.user.id],
  );
  if (!rows.length) {
    fail(res, 404, 'not_found', 'Escalation not found');
    return null;
  }
  return rows[0];
}

const postEscalationMessage = async (req, res) => {
  try {
    const escalation = await loadEscalationForParty(req, res);
    if (!escalation) return;
    if (escalation.status === 'resolved') {
      return fail(res, 409, 'state_conflict', 'This escalation is resolved');
    }
    const body = cleanText(req.body?.message, MAX_TEXT, { required: true });
    if (body === null) return fail(res, 400, 'validation_failed', 'A message is required');
    if (body === undefined) return fail(res, 400, 'validation_failed', 'Message is too long');
    const { rows: bookingRows } = await db.query(
      'SELECT owner_id, customer_id FROM tool_rentals_bookings WHERE id = $1',
      [escalation.booking_id],
    );
    const role = String(bookingRows[0].owner_id) === String(req.user.id) ? 'owner' : 'renter';
    const { rows } = await db.query(
      `INSERT INTO tool_rental_escalation_messages (escalation_id, author_id, author_role, body)
       VALUES ($1, $2, $3, $4) RETURNING id, author_id, author_role, body, created_at`,
      [escalation.id, req.user.id, role, body],
    );
    // G11-B2 (D-609): the counterparty is told a reply landed.
    await notifyEscalationReplied({
      escalation,
      booking: { owner_id: bookingRows[0].owner_id, customer_id: bookingRows[0].customer_id, id: escalation.booking_id },
      messageId: rows[0].id,
      authorId: req.user.id,
      authorRole: role,
    });
    return res.status(201).json({ message: rows[0] });
  } catch (err) {
    logger.error('postEscalationMessage error', { err });
    return res.status(500).json({ error: 'Failed to post message' });
  }
};

const adminListEscalations = async (req, res) => {
  try {
    const status = req.query?.status;
    const params = [];
    let where = '';
    if (status !== undefined) {
      if (!ESCALATION_STATUSES.includes(status)) {
        return fail(res, 400, 'validation_failed', 'Invalid status');
      }
      params.push(status);
      where = 'WHERE e.status = $1';
    }
    const { rows } = await db.query(
      `SELECT e.*, b.owner_id, b.customer_id, t.name AS tool_name
         FROM tool_rental_escalations e
         JOIN tool_rentals_bookings b ON b.id = e.booking_id
         JOIN tool_rentals t ON t.id = e.tool_id
        ${where}
        ORDER BY e.created_at DESC LIMIT 100`,
      params,
    );
    return res.json({ escalations: rows });
  } catch (err) {
    logger.error('adminListEscalations error', { err });
    return res.status(500).json({ error: 'Failed to load escalations' });
  }
};

const adminGetEscalation = async (req, res) => {
  try {
    if (!isUuid(req.params.escalationId)) {
      return fail(res, 400, 'validation_failed', 'Invalid escalation id');
    }
    const { rows } = await db.query(
      'SELECT * FROM tool_rental_escalations WHERE id = $1',
      [req.params.escalationId],
    );
    if (!rows.length) return fail(res, 404, 'not_found', 'Escalation not found');
    const { rows: messages } = await db.query(
      `SELECT id, author_id, author_role, body, created_at
         FROM tool_rental_escalation_messages WHERE escalation_id = $1 ORDER BY created_at, id`,
      [req.params.escalationId],
    );
    return res.json({ escalation: serializeEscalation(rows[0], messages) });
  } catch (err) {
    logger.error('adminGetEscalation error', { err });
    return res.status(500).json({ error: 'Failed to load escalation' });
  }
};

const adminPostEscalationMessage = async (req, res) => {
  try {
    if (!isUuid(req.params.escalationId)) {
      return fail(res, 400, 'validation_failed', 'Invalid escalation id');
    }
    const { rows } = await db.query(
      'SELECT * FROM tool_rental_escalations WHERE id = $1',
      [req.params.escalationId],
    );
    if (!rows.length) return fail(res, 404, 'not_found', 'Escalation not found');
    const escalation = rows[0];
    if (escalation.status === 'resolved') {
      return fail(res, 409, 'state_conflict', 'This escalation is resolved');
    }
    const body = cleanText(req.body?.message, MAX_TEXT, { required: true });
    if (body === null) return fail(res, 400, 'validation_failed', 'A message is required');
    if (body === undefined) return fail(res, 400, 'validation_failed', 'Message is too long');
    const { rows: saved } = await db.query(
      `INSERT INTO tool_rental_escalation_messages (escalation_id, author_id, author_role, body)
       VALUES ($1, $2, 'admin', $3) RETURNING id, author_id, author_role, body, created_at`,
      [escalation.id, req.user.id, body],
    );
    // G11-B2 (D-609): both parties are told the admin replied.
    const { rows: bookingRows } = await db.query(
      'SELECT owner_id, customer_id FROM tool_rentals_bookings WHERE id = $1',
      [escalation.booking_id],
    );
    await notifyEscalationReplied({
      escalation,
      booking: { owner_id: bookingRows[0].owner_id, customer_id: bookingRows[0].customer_id, id: escalation.booking_id },
      messageId: saved[0].id,
      authorId: req.user.id,
      authorRole: 'admin',
    });
    return res.status(201).json({ message: saved[0] });
  } catch (err) {
    logger.error('adminPostEscalationMessage error', { err });
    return res.status(500).json({ error: 'Failed to post message' });
  }
};

const adminSetEscalationStatus = async (req, res) => {
  try {
    if (!isUuid(req.params.escalationId)) {
      return fail(res, 400, 'validation_failed', 'Invalid escalation id');
    }
    const status = req.body?.status;
    if (!ESCALATION_STATUSES.includes(status)) {
      return fail(res, 400, 'validation_failed', 'status must be open, in_review or resolved');
    }
    const { rows: prior } = await db.query(
      'SELECT status FROM tool_rental_escalations WHERE id = $1',
      [req.params.escalationId],
    );
    if (!prior.length) return fail(res, 404, 'not_found', 'Escalation not found');
    const { rows } = await db.query(
      `UPDATE tool_rental_escalations
          SET status = $2, resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE NULL END,
              ack_status = CASE WHEN $2 = 'resolved' THEN 'pending' ELSE ack_status END,
              acknowledged_by = CASE WHEN $2 = 'resolved' THEN NULL ELSE acknowledged_by END,
              acknowledged_at = CASE WHEN $2 = 'resolved' THEN NULL ELSE acknowledged_at END
        WHERE id = $1 RETURNING *`,
      [req.params.escalationId, status],
    );
    if (!rows.length) return fail(res, 404, 'not_found', 'Escalation not found');
    const escalation = rows[0];
    // 589 (D-569/D-572): a fresh resolution arms the acknowledgment
    // (pending, both parties) and notifies both parties. A repeat resolve
    // of an already-resolved thread is a no-op for notices (the ack was
    // already armed and both parties were already told); a status move
    // away from resolved leaves the ack state as-is.
    if (status === 'resolved' && prior[0].status !== 'resolved') {
      const { rows: bookingRows } = await db.query(
        'SELECT owner_id, customer_id FROM tool_rentals_bookings WHERE id = $1',
        [escalation.booking_id],
      );
      if (bookingRows.length) {
        await notifyEscalationResolved({ escalation, booking: bookingRows[0] });
      }
    }
    return res.json({ escalation });
  } catch (err) {
    logger.error('adminSetEscalationStatus error', { err });
    return res.status(500).json({ error: 'Failed to update escalation' });
  }
};

// ---------------------------------------------------------------- 590: acknowledgment

// 589 (D-569): either party accepts or disputes an admin-closed
// escalation. A dispute reopens the thread (status back to open,
// resolved_at cleared) so an admin can look again, mirroring the
// damage-claim dispute (D-283). The ack_status guard in the WHERE keeps
// a double-submit from flipping an already-settled acknowledgment.
const acknowledgeEscalation = async (req, res) => {
  try {
    const escalation = await loadEscalationForParty(req, res);
    if (!escalation) return;
    if (escalation.status !== 'resolved') {
      return fail(res, 409, 'state_conflict', 'Only a resolved escalation can be acknowledged');
    }
    if (escalation.ack_status !== 'pending') {
      return fail(res, 409, 'state_conflict', 'This resolution was already acknowledged');
    }
    const decision = req.body?.decision;
    if (!['acknowledged', 'disputed'].includes(decision)) {
      return fail(res, 400, 'validation_failed', 'decision must be acknowledged or disputed');
    }
    const { rows } = await db.query(
      decision === 'acknowledged'
        ? `UPDATE tool_rental_escalations
              SET ack_status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW()
            WHERE id = $1 AND ack_status = 'pending' RETURNING *`
        : `UPDATE tool_rental_escalations
              SET status = 'open', resolved_at = NULL, ack_status = 'disputed',
                  acknowledged_by = $2, acknowledged_at = NOW()
            WHERE id = $1 AND ack_status = 'pending' RETURNING *`,
      [escalation.id, req.user.id],
    );
    if (!rows.length) {
      return fail(res, 409, 'state_conflict', 'This resolution was already acknowledged');
    }
    // B13 (D-620): the counterparty is told the resolution was accepted
    // or disputed; a dispute also tells the moderation admins, because
    // the thread is open again and needs a fresh admin look. The actor
    // is never notified of their own action.
    const { rows: bookingRows } = await db.query(
      'SELECT id, owner_id, customer_id FROM tool_rentals_bookings WHERE id = $1',
      [escalation.booking_id],
    );
    if (bookingRows.length) {
      await notifyEscalationAcknowledged({
        escalation: rows[0],
        booking: bookingRows[0],
        decision,
        actorId: req.user.id,
      });
    }
    return res.json({ escalation: rows[0] });
  } catch (err) {
    logger.error('acknowledgeEscalation error', { err });
    return res.status(500).json({ error: 'Failed to acknowledge escalation' });
  }
};

// Missing-accessory resolution (578): the owner resolves, so the renter
// acknowledges (or disputes, which clears the resolution so the owner can
// resolve again).
const acknowledgeMissingResolution = async (req, res) => {
  try {
    const party = await loadBookingParty(req, res, req.params.bookingId);
    if (!party) return;
    if (party.isOwner) {
      return fail(res, 403, 'access_required', 'Only the renter acknowledges the missing-item resolution');
    }
    if (!isUuid(req.params.reportId)) {
      return fail(res, 400, 'validation_failed', 'Invalid report id');
    }
    const { rows } = await db.query(
      `SELECT m.* FROM equipment_missing_accessories m
        JOIN equipment_reports r ON r.id = m.report_id
       WHERE m.report_id = $1 AND r.booking_id = $2`,
      [req.params.reportId, party.booking.id],
    );
    const row = rows[0];
    if (!row) return fail(res, 404, 'not_found', 'Missing-item record not found');
    if (!row.resolved_at) {
      return fail(res, 409, 'state_conflict', 'There is no resolution waiting to be acknowledged');
    }
    if (row.ack_status !== 'pending') {
      return fail(res, 409, 'state_conflict', 'This resolution was already acknowledged');
    }
    const decision = req.body?.decision;
    if (!['acknowledged', 'disputed'].includes(decision)) {
      return fail(res, 400, 'validation_failed', 'decision must be acknowledged or disputed');
    }
    if (decision === 'acknowledged') {
      const { rows: updated } = await db.query(
        `UPDATE equipment_missing_accessories
            SET ack_status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW()
          WHERE report_id = $1 AND ack_status = 'pending' RETURNING *`,
        [req.params.reportId, req.user.id],
      );
      return res.json({ missing: updated[0] });
    }
    const { rows: updated } = await db.query(
      `UPDATE equipment_missing_accessories
          SET resolution = NULL, resolved_at = NULL, ack_status = 'disputed',
              acknowledged_by = $2, acknowledged_at = NOW(), version = version + 1
        WHERE report_id = $1 AND ack_status = 'pending' RETURNING *`,
      [req.params.reportId, req.user.id],
    );
    return res.json({ missing: updated[0] });
  } catch (err) {
    logger.error('acknowledgeMissingResolution error', { err });
    return res.status(500).json({ error: 'Failed to acknowledge resolution' });
  }
};

// Deposit resolution (588): the owner resolves, so the renter acknowledges
// (or disputes, recorded as a disagreement; the deposit status itself
// stands because the money already moved off-platform, D-257).
const acknowledgeDepositResolution = async (req, res) => {
  try {
    const party = await loadBookingParty(req, res, req.params.bookingId);
    if (!party) return;
    if (party.isOwner) {
      return fail(res, 403, 'access_required', 'Only the renter acknowledges the deposit resolution');
    }
    const { booking } = party;
    if (!booking.deposit_resolved_at || !['returned', 'partially_withheld', 'withheld'].includes(booking.deposit_status)) {
      return fail(res, 409, 'state_conflict', 'There is no deposit resolution waiting to be acknowledged');
    }
    if (booking.deposit_ack_status !== 'pending') {
      return fail(res, 409, 'state_conflict', 'This deposit resolution was already acknowledged');
    }
    const decision = req.body?.decision;
    if (!['acknowledged', 'disputed'].includes(decision)) {
      return fail(res, 400, 'validation_failed', 'decision must be acknowledged or disputed');
    }
    const { rows } = await db.query(
      `UPDATE tool_rentals_bookings
          SET deposit_ack_status = $2, deposit_acknowledged_by = $3, deposit_acknowledged_at = NOW()
        WHERE id = $1 AND deposit_ack_status = 'pending'
        RETURNING id, deposit_status, deposit_ack_status, deposit_acknowledged_by, deposit_acknowledged_at`,
      [booking.id, decision, req.user.id],
    );
    // G11-B2 (D-609): the owner resolved the deposit, so the owner is
    // told the renter acknowledged (or disputed) it.
    await notifyRental({
      userId: booking.owner_id,
      type: 'tool_rental_deposit_acknowledged',
      bookingId: booking.id,
      eventKey: `ack:${rows[0].deposit_acknowledged_at}`,
    });
    return res.json({ deposit: rows[0] });
  } catch (err) {
    logger.error('acknowledgeDepositResolution error', { err });
    return res.status(500).json({ error: 'Failed to acknowledge deposit resolution' });
  }
};

// ---------------------------------------------------------------- 591: maintenance

const listMaintenanceEvents = async (req, res) => {
  try {
    const tool = await loadToolOwner(req, res, req.params.toolId);
    if (!tool) return;
    const { rows } = await db.query(
      `SELECT * FROM tool_rental_maintenance_events WHERE tool_id = $1 ORDER BY scheduled_date, created_at`,
      [tool.id],
    );
    return res.json({ events: rows });
  } catch (err) {
    logger.error('listMaintenanceEvents error', { err });
    return res.status(500).json({ error: 'Failed to load maintenance events' });
  }
};

const createMaintenanceEvent = async (req, res) => {
  try {
    const tool = await loadToolOwner(req, res, req.params.toolId);
    if (!tool) return;
    const title = cleanText(req.body?.title, MAX_TITLE, { required: true });
    if (title === null) return fail(res, 400, 'validation_failed', 'A maintenance event needs a title');
    if (title === undefined) return fail(res, 400, 'validation_failed', 'Title is too long');
    const date = parseDateOnlyUTC(req.body?.scheduled_date);
    if (!date) return fail(res, 400, 'validation_failed', 'scheduled_date must be a valid date');
    const notes = cleanText(req.body?.notes, MAX_TEXT);
    if (notes === undefined) return fail(res, 400, 'validation_failed', 'Notes are too long');
    const { rows } = await db.query(
      `INSERT INTO tool_rental_maintenance_events (tool_id, owner_id, title, scheduled_date, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tool.id, req.user.id, title, req.body.scheduled_date, notes || null],
    );
    return res.status(201).json({ event: rows[0] });
  } catch (err) {
    logger.error('createMaintenanceEvent error', { err });
    return res.status(500).json({ error: 'Failed to create maintenance event' });
  }
};

async function loadMaintenanceEvent(req, res, tool) {
  if (!isUuid(req.params.eventId)) {
    fail(res, 400, 'validation_failed', 'Invalid event id');
    return null;
  }
  const { rows } = await db.query(
    'SELECT * FROM tool_rental_maintenance_events WHERE id = $1 AND tool_id = $2',
    [req.params.eventId, tool.id],
  );
  if (!rows.length) {
    fail(res, 404, 'not_found', 'Maintenance event not found');
    return null;
  }
  return rows[0];
}

// Completing an event can create a repair record (593): pass
// create_repair_record true with notes and the record is written with the
// event's scheduled date as occurred_on.
const completeMaintenanceEvent = async (req, res) => {
  try {
    const tool = await loadToolOwner(req, res, req.params.toolId);
    if (!tool) return;
    const event = await loadMaintenanceEvent(req, res, tool);
    if (!event) return;
    if (event.status !== 'scheduled') {
      return fail(res, 409, 'state_conflict', 'This event is already decided');
    }
    const createRepair = req.body?.create_repair_record === true;
    const notes = cleanText(req.body?.notes, MAX_TEXT) ?? event.notes;
    if (createRepair && !notes) {
      return fail(res, 400, 'validation_failed', 'A repair record needs notes');
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      let repairRecordId = null;
      if (createRepair) {
        const { rows } = await client.query(
          `INSERT INTO equipment_records (tool_id, booking_id, actor_id, kind, notes, occurred_on)
           VALUES ($1, NULL, $2, 'repair', $3, $4) RETURNING id`,
          [tool.id, req.user.id, notes, event.scheduled_date],
        );
        repairRecordId = rows[0].id;
      }
      const { rows } = await client.query(
        `UPDATE tool_rental_maintenance_events
            SET status = 'completed', completed_at = NOW(),
                repair_record_id = $2, notes = COALESCE($3, notes), updated_at = NOW()
          WHERE id = $1 AND status = 'scheduled' RETURNING *`,
        [event.id, repairRecordId, notes || null],
      );
      await client.query('COMMIT');
      return res.json({ event: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('completeMaintenanceEvent error', { err });
    return res.status(500).json({ error: 'Failed to complete maintenance event' });
  }
};

const cancelMaintenanceEvent = async (req, res) => {
  try {
    const tool = await loadToolOwner(req, res, req.params.toolId);
    if (!tool) return;
    const event = await loadMaintenanceEvent(req, res, tool);
    if (!event) return;
    if (event.status !== 'scheduled') {
      return fail(res, 409, 'state_conflict', 'This event is already decided');
    }
    const { rows } = await db.query(
      `UPDATE tool_rental_maintenance_events
          SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1 AND status = 'scheduled' RETURNING *`,
      [event.id],
    );
    return res.json({ event: rows[0] });
  } catch (err) {
    logger.error('cancelMaintenanceEvent error', { err });
    return res.status(500).json({ error: 'Failed to cancel maintenance event' });
  }
};

// ---------------------------------------------------------------- 594: safety docs

async function storeUploadedFile(req, res, { folder, imageOnly = false }) {
  const file = req.file;
  if (!file) {
    fail(res, 400, 'validation_failed', 'A file is required');
    return null;
  }
  if (imageOnly && (!file.mimetype || !file.mimetype.startsWith('image/'))) {
    fail(res, 400, 'validation_failed', 'Evidence must be an image');
    return null;
  }
  const key = await uploadFile(file.buffer, folder, file.originalname, file.mimetype);
  if (key) {
    const url = getPublicUrl(key);
    if (!url) {
      await deleteFile(key).catch(() => {});
      fail(res, 503, 'unavailable', 'File URL unavailable');
      return null;
    }
    return { url, key };
  }
  if (file.size > 2 * 1024 * 1024) {
    fail(res, 400, 'validation_failed', 'File is too large. Upload a file under 2MB.');
    return null;
  }
  return { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`, key: null };
}

const listSafetyDocuments = async (req, res) => {
  try {
    const tool = await loadToolOwner(req, res, req.params.toolId);
    if (!tool) return;
    const { rows } = await db.query(
      `SELECT id, tool_id, title, file_url, mime_type, created_at
         FROM tool_rental_safety_documents WHERE tool_id = $1 ORDER BY created_at DESC`,
      [tool.id],
    );
    return res.json({ documents: rows });
  } catch (err) {
    logger.error('listSafetyDocuments error', { err });
    return res.status(500).json({ error: 'Failed to load safety documents' });
  }
};

const listPublicSafetyDocuments = async (req, res) => {
  try {
    const toolId = Number(req.params.toolId);
    if (!Number.isInteger(toolId) || toolId <= 0) {
      return fail(res, 400, 'validation_failed', 'Invalid tool id');
    }
    const { rows: tools } = await db.query(
      'SELECT id FROM tool_rentals WHERE id = $1 AND is_available = TRUE AND moderation_hold IS NOT TRUE',
      [toolId],
    );
    if (!tools.length) return fail(res, 404, 'not_found', 'Tool not found');
    const { rows } = await db.query(
      `SELECT id, tool_id, title, file_url, mime_type, created_at
         FROM tool_rental_safety_documents WHERE tool_id = $1 ORDER BY created_at DESC`,
      [toolId],
    );
    return res.json({ documents: rows });
  } catch (err) {
    logger.error('listPublicSafetyDocuments error', { err });
    return res.status(500).json({ error: 'Failed to load safety documents' });
  }
};

const uploadSafetyDocument = async (req, res) => {
  try {
    const tool = await loadToolOwner(req, res, req.params.toolId);
    if (!tool) return;
    const title = cleanText(req.body?.title, MAX_TITLE, { required: true });
    if (title === null) return fail(res, 400, 'validation_failed', 'A safety document needs a title');
    if (title === undefined) return fail(res, 400, 'validation_failed', 'Title is too long');
    if (!req.file || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(req.file.mimetype)) {
      return fail(res, 400, 'validation_failed', 'Safety documents must be a PDF or an image');
    }
    const stored = await storeUploadedFile(req, res, { folder: 'tool-rentals/safety' });
    if (!stored) return;
    const { rows } = await db.query(
      `INSERT INTO tool_rental_safety_documents (tool_id, owner_id, title, file_url, storage_key, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, tool_id, title, file_url, mime_type, created_at`,
      [tool.id, req.user.id, title, stored.url, stored.key, req.file.mimetype],
    );
    return res.status(201).json({ document: rows[0] });
  } catch (err) {
    logger.error('uploadSafetyDocument error', { err });
    return res.status(500).json({ error: 'Failed to upload safety document' });
  }
};

const deleteSafetyDocument = async (req, res) => {
  try {
    const tool = await loadToolOwner(req, res, req.params.toolId);
    if (!tool) return;
    if (!isUuid(req.params.docId)) {
      return fail(res, 400, 'validation_failed', 'Invalid document id');
    }
    const { rows } = await db.query(
      'SELECT storage_key FROM tool_rental_safety_documents WHERE id = $1 AND tool_id = $2',
      [req.params.docId, tool.id],
    );
    if (!rows.length) return fail(res, 404, 'not_found', 'Safety document not found');
    await db.query(
      'DELETE FROM tool_rental_safety_documents WHERE id = $1 AND tool_id = $2',
      [req.params.docId, tool.id],
    );
    if (rows[0].storage_key) await deleteFile(rows[0].storage_key).catch(() => {});
    return res.json({ deleted: true });
  } catch (err) {
    logger.error('deleteSafetyDocument error', { err });
    return res.status(500).json({ error: 'Failed to delete safety document' });
  }
};

// Admin moderation view of a listing's safety documents (594).
const adminListSafetyDocuments = async (req, res) => {
  try {
    const toolId = Number(req.params.toolId);
    if (!Number.isInteger(toolId) || toolId <= 0) {
      return fail(res, 400, 'validation_failed', 'Invalid tool id');
    }
    const { rows } = await db.query(
      `SELECT d.*, t.name AS tool_name, t.user_id AS owner_id
         FROM tool_rental_safety_documents d
         JOIN tool_rentals t ON t.id = d.tool_id
        WHERE d.tool_id = $1 ORDER BY d.created_at DESC`,
      [toolId],
    );
    return res.json({ documents: rows });
  } catch (err) {
    logger.error('adminListSafetyDocuments error', { err });
    return res.status(500).json({ error: 'Failed to load safety documents' });
  }
};

// ---------------------------------------------------------------- 595: checklist

// Server-side return-to-availability checklist. A tool with no prior rental
// passes the condition-report check vacuously (nothing to report on yet).
async function computeAvailabilityChecklist(toolId, cleaningConfirmed) {
  const { rows: lastBookings } = await db.query(
    `SELECT id FROM tool_rentals_bookings
      WHERE tool_id = $1 AND status IN ('payment_confirmed', 'returned', 'completed')
      ORDER BY end_date DESC, id DESC LIMIT 1`,
    [toolId],
  );
  let conditionReportFiled = true;
  let lastBookingId = null;
  if (lastBookings.length) {
    lastBookingId = lastBookings[0].id;
    const { rows } = await db.query(
      `SELECT 1 FROM equipment_reports
        WHERE booking_id = $1 AND phase = 'return' LIMIT 1`,
      [lastBookingId],
    );
    conditionReportFiled = rows.length > 0;
  }
  const { rows: missing } = await db.query(
    `SELECT 1 FROM equipment_missing_accessories m
       JOIN equipment_reports r ON r.id = m.report_id
       JOIN tool_rentals_bookings b ON b.id = r.booking_id
      WHERE b.tool_id = $1 AND m.resolved_at IS NULL LIMIT 1`,
    [toolId],
  );
  const { rows: claims } = await db.query(
    `SELECT 1 FROM tool_rental_damage_claims
      WHERE tool_id = $1 AND status = 'open' LIMIT 1`,
    [toolId],
  );
  const checks = {
    condition_report_filed: conditionReportFiled,
    no_unresolved_missing_accessories: missing.length === 0,
    no_open_damage_claim: claims.length === 0,
    cleaning_confirmed: cleaningConfirmed === true,
  };
  return {
    checks,
    last_booking_id: lastBookingId,
    complete: Object.values(checks).every(Boolean),
  };
}

const getAvailabilityChecklist = async (req, res) => {
  try {
    const tool = await loadToolOwner(req, res, req.params.toolId);
    if (!tool) return;
    const cleaningConfirmed = req.query?.cleaning_confirmed === 'true';
    const result = await computeAvailabilityChecklist(tool.id, cleaningConfirmed);
    return res.json({ tool_id: tool.id, ...result });
  } catch (err) {
    logger.error('getAvailabilityChecklist error', { err });
    return res.status(500).json({ error: 'Failed to load checklist' });
  }
};

// ---------------------------------------------------------------- 600: repeat renters

const listRepeatRenters = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT b.customer_id AS renter_id,
              COALESCE(u.first_name, '') AS first_name,
              COALESCE(u.last_name, '') AS last_name,
              u.email AS email,
              COUNT(*) FILTER (WHERE b.status = 'completed') AS completed_bookings,
              MAX(b.end_date) AS last_rental_end,
              ARRAY_AGG(DISTINCT b.tool_id) AS tool_ids
         FROM tool_rentals_bookings b
         JOIN users u ON u.id = b.customer_id
        WHERE b.owner_id = $1
        GROUP BY b.customer_id, u.first_name, u.last_name, u.email
       HAVING COUNT(*) FILTER (WHERE b.status = 'completed') >= 2
        ORDER BY completed_bookings DESC, last_rental_end DESC`,
      [req.user.id],
    );
    const out = [];
    for (const row of rows) {
      const { rows: notes } = await db.query(
        `SELECT id, tool_id, booking_id, note, created_at
           FROM tool_rental_followups
          WHERE owner_id = $1 AND renter_id = $2 ORDER BY created_at DESC LIMIT 20`,
        [req.user.id, row.renter_id],
      );
      out.push({
        ...row,
        completed_bookings: Number(row.completed_bookings),
        followups: notes,
      });
    }
    return res.json({ renters: out });
  } catch (err) {
    logger.error('listRepeatRenters error', { err });
    return res.status(500).json({ error: 'Failed to load repeat renters' });
  }
};

const recordFollowup = async (req, res) => {
  try {
    const note = cleanText(req.body?.note, MAX_TEXT, { required: true });
    if (note === null) return fail(res, 400, 'validation_failed', 'A follow-up needs a note');
    if (note === undefined) return fail(res, 400, 'validation_failed', 'Note is too long');
    // The renter must be a repeat renter of this owner (2+ completed
    // bookings); the follow-up itself is recorded, and the client opens the
    // existing messages thread with that renter.
    const { rows: repeat } = await db.query(
      `SELECT COUNT(*) AS n FROM tool_rentals_bookings
        WHERE owner_id = $1 AND customer_id = $2 AND status = 'completed'`,
      [req.user.id, req.body?.renter_id],
    );
    if (Number(repeat[0]?.n || 0) < 2) {
      return fail(res, 404, 'not_found', 'Repeat renter not found');
    }
    let toolId = null;
    let bookingId = null;
    if (req.body?.tool_id !== undefined && req.body.tool_id !== null) {
      toolId = Number(req.body.tool_id);
      if (!Number.isInteger(toolId) || toolId <= 0) {
        return fail(res, 400, 'validation_failed', 'Invalid tool id');
      }
      const { rows } = await db.query(
        'SELECT id FROM tool_rentals WHERE id = $1 AND user_id = $2',
        [toolId, req.user.id],
      );
      if (!rows.length) return fail(res, 404, 'not_found', 'Tool not found');
    }
    if (req.body?.booking_id !== undefined && req.body.booking_id !== null) {
      bookingId = Number(req.body.booking_id);
      if (!Number.isInteger(bookingId) || bookingId <= 0) {
        return fail(res, 400, 'validation_failed', 'Invalid booking id');
      }
      const { rows } = await db.query(
        'SELECT id FROM tool_rentals_bookings WHERE id = $1 AND owner_id = $2 AND customer_id = $3',
        [bookingId, req.user.id, req.body.renter_id],
      );
      if (!rows.length) return fail(res, 404, 'not_found', 'Booking not found');
    }
    const { rows } = await db.query(
      `INSERT INTO tool_rental_followups (owner_id, renter_id, tool_id, booking_id, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, req.body.renter_id, toolId, bookingId, note],
    );
    return res.status(201).json({ followup: rows[0] });
  } catch (err) {
    logger.error('recordFollowup error', { err });
    return res.status(500).json({ error: 'Failed to record follow-up' });
  }
};

module.exports = {
  listDamageClaims,
  fileDamageClaim,
  resolveDamageClaim,
  acknowledgeDamageClaim,
  listEscalations,
  openEscalation,
  postEscalationMessage,
  adminListEscalations,
  adminGetEscalation,
  adminPostEscalationMessage,
  adminSetEscalationStatus,
  acknowledgeEscalation,
  acknowledgeMissingResolution,
  acknowledgeDepositResolution,
  listMaintenanceEvents,
  createMaintenanceEvent,
  completeMaintenanceEvent,
  cancelMaintenanceEvent,
  listSafetyDocuments,
  listPublicSafetyDocuments,
  uploadSafetyDocument,
  deleteSafetyDocument,
  adminListSafetyDocuments,
  computeAvailabilityChecklist,
  getAvailabilityChecklist,
  listRepeatRenters,
  recordFollowup,
  storeUploadedFile,
};
