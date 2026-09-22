'use strict';

/**
 * Shared booking-request lifecycle for calendar + messenger.
 * Canonical store: booking_requests (migrations 176 → 537+).
 */

const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('./socketService');
const {
  canProviderRespond,
  canCustomerRespond,
  toPublicBookingRequestCard,
  toChatStatus,
  normalizeClock,
  normalizeDate,
  buildStatusMessage,
} = require('./chatBookingRequests');
const {
  assertConversationParticipant,
  assertGuestInquiryAccess,
  assertBusinessAccess,
} = require('./chatThreadAccess');

const INBOX_STATUSES = ['pending', 'counter_proposed'];
const PROVIDER_RESPOND_STATUSES = ['pending', 'expired', 'counter_proposed'];

async function loadBooking(id) {
  if (!id) return null;
  const { rows } = await pool.query('SELECT * FROM booking_requests WHERE id = $1', [id]);
  return rows[0] || null;
}

async function logAudit(bookingId, action, actorId, actorType, oldStatus, newStatus) {
  try {
    await pool.query(
      `INSERT INTO booking_request_audit_log
         (booking_request_id, action, actor_id, actor_type, old_status, new_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bookingId, action, actorId || null, actorType || null, oldStatus || null, newStatus || null],
    );
  } catch (err) {
    logger.warn('[bookingLifecycle] audit failed', { error: err.message });
  }
}

async function expireIfStale(bookingRow) {
  if (!bookingRow || bookingRow.status !== 'pending') return bookingRow;
  const exp = new Date(bookingRow.expires_at);
  if (!(exp instanceof Date) || Number.isNaN(exp.getTime()) || exp > new Date()) {
    return bookingRow;
  }
  const r = await pool.query(
    `UPDATE booking_requests
        SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [bookingRow.id],
  );
  if (r.rows.length) {
    await logAudit(bookingRow.id, 'expired', null, 'system', 'pending', 'expired');
    return r.rows[0];
  }
  return bookingRow;
}

function formatTimePart(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return normalizeClock(
      `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`,
    );
  }
  return normalizeClock(value);
}

/**
 * Calendar + shared list shape (camelCase + conversation/source for UI).
 */
function toCalendarBooking(row) {
  if (!row) return null;
  const status = toChatStatus(row.status);
  return {
    id: row.id,
    customerId: row.customer_id,
    helperId: row.helper_id,
    businessId: row.business_id || null,
    serviceName: row.service_name,
    requestedDate: row.requested_date,
    requestedStartTime: row.requested_start_time,
    requestedEndTime: row.requested_end_time,
    serviceLocation: row.service_location,
    description: row.description,
    status,
    expiresAt: row.expires_at,
    confirmationHours: row.confirmation_hours,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    helperResponseReason: row.helper_response_reason,
    convertedToJobId: row.converted_to_job_id,
    conversationId: row.conversation_id || null,
    guestSessionId: row.guest_session_id || null,
    appointmentId: row.appointment_id != null ? String(row.appointment_id) : null,
    source: row.source || 'direct',
    serviceId: row.service_id || null,
    timezone: row.timezone || null,
    counter_proposed_at: row.counter_proposed_at,
    counter_date: row.counter_date,
    counter_start_time: row.counter_start_time,
    counter_end_time: row.counter_end_time,
    counter_message: row.counter_message,
    counter_status: row.counter_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerName: row.customer_name || null,
    customerAvatar: row.customer_avatar || null,
    canRespond: canProviderRespond(row).ok,
    canCustomerRespond: canCustomerRespond(row).ok,
  };
}

/**
 * Same provider authz as chat `/api/chat/booking-requests/*`:
 * helper owner, business owner/member, conversation helper/business, guest inquiry provider.
 */
async function isProviderForBooking(userId, booking) {
  if (!userId || !booking) return false;
  if (booking.helper_id && String(booking.helper_id) === String(userId)) return true;
  if (booking.business_id) {
    const biz = await assertBusinessAccess(userId, booking.business_id);
    if (biz) return true;
  }
  if (booking.conversation_id) {
    const conv = await assertConversationParticipant(userId, booking.conversation_id);
    if (conv && conv.helper_id && String(conv.helper_id) === String(userId)) return true;
    if (conv?.business_id) {
      const biz = await assertBusinessAccess(userId, conv.business_id);
      if (biz) return true;
    }
  }
  if (booking.guest_session_id) {
    const guest = await assertGuestInquiryAccess(userId, booking.guest_session_id);
    if (guest) return true;
  }
  return false;
}

/** Active business ids the user owns or is an active member of. */
async function resolveProviderBusinessIds(userId) {
  if (!userId) return [];
  const { rows } = await pool
    .query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_active = TRUE
       UNION
       SELECT bm.business_id AS id
         FROM business_members bm
         JOIN businesses b ON b.id = bm.business_id AND b.is_active = TRUE
        WHERE bm.member_id = $1 AND bm.status = 'active'`,
      [userId],
    )
    .catch(() => ({ rows: [] }));
  return rows.map((r) => r.id).filter(Boolean);
}

/**
 * List inbox rows for a provider actor (helper + business-scoped parity with chat).
 * Includes guest requests (LEFT JOIN users). Default: pending + counter_proposed.
 */
async function listIncomingForProvider(providerUserId, { status, statuses } = {}) {
  let statusList;
  if (Array.isArray(statuses) && statuses.length) {
    statusList = statuses.map((s) => toChatStatus(s));
  } else if (status === 'all' || status === '*') {
    statusList = null;
  } else if (status) {
    statusList = [toChatStatus(status)];
  } else {
    statusList = [...INBOX_STATUSES];
  }

  const businessIds = await resolveProviderBusinessIds(providerUserId);
  const params = [providerUserId, businessIds];
  let statusClause = '';
  if (statusList) {
    statusClause = ` AND br.status = ANY($${params.length + 1}::text[])`;
    params.push(statusList);
  }

  const { rows } = await pool.query(
    `SELECT br.*,
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS customer_name,
            u.profile_photo_url AS customer_avatar
       FROM booking_requests br
       LEFT JOIN users u ON u.id = br.customer_id
      WHERE (
        br.helper_id = $1
        OR (br.business_id IS NOT NULL AND br.business_id = ANY($2::uuid[]))
        OR EXISTS (
          SELECT 1 FROM conversations c
           WHERE c.id = br.conversation_id
             AND (
               c.helper_id = $1
               OR (c.business_id IS NOT NULL AND c.business_id = ANY($2::uuid[]))
             )
        )
        OR EXISTS (
          SELECT 1 FROM guest_profile_chat_inbound g
           WHERE g.id = br.guest_session_id
             AND (
               g.helper_id = $1
               OR (g.business_id IS NOT NULL AND g.business_id = ANY($2::uuid[]))
             )
        )
      )
      ${statusClause}
      ORDER BY br.created_at DESC`,
    params,
  );

  const out = [];
  for (const row of rows) {
    const maybeExpired = await expireIfStale(row);
    // After expire, re-check against requested status list
    if (statusList && !statusList.includes(toChatStatus(maybeExpired.status))) {
      continue;
    }
    out.push(toCalendarBooking({ ...row, ...maybeExpired }));
  }
  return out;
}

async function confirmOrCreateAppointment(booking, helperId, { source = 'booking_accept' } = {}) {
  if (booking.appointment_id) {
    const { rows } = await pool.query(
      `UPDATE appointments
          SET status = 'confirmed',
              updated_at = NOW()
        WHERE id = $1 AND helper_id = $2 AND status IN ('requested', 'confirmed')
        RETURNING *`,
      [booking.appointment_id, helperId],
    );
    return rows[0] || null;
  }

  const date = normalizeDate(booking.requested_date);
  const start = normalizeClock(booking.requested_start_time);
  const end = normalizeClock(booking.requested_end_time);
  if (!date || !start || !end) return null;

  const startDate = new Date(`${date}T${start}:00`);
  const endDate = new Date(`${date}T${end}:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return null;
  }
  const duration = Math.max(15, Math.min(480, Math.round((endDate - startDate) / 60000) || 60));
  const customerId = booking.customer_id || '00000000-0000-4000-8000-000000000001';

  const { rows } = await pool.query(
    `INSERT INTO appointments (
       customer_id, helper_id, job_id, service_description,
       scheduled_start_time, scheduled_end_time, estimated_duration_minutes,
       customer_notes, status, created_by_user_id,
       source, guest_name, guest_email
     ) VALUES (
       $1, $2, NULL, $3, $4, $5, $6, $7, 'confirmed', $8,
       $9, NULL, NULL
     ) RETURNING *`,
    [
      customerId,
      helperId,
      booking.service_name || 'Booked service',
      startDate,
      endDate,
      duration,
      [
        booking.source ? `source=${booking.source}` : null,
        booking.conversation_id ? `conversation_id=${booking.conversation_id}` : null,
        `booking_request_id=${booking.id}`,
      ]
        .filter(Boolean)
        .join(' | '),
      helperId,
      source,
    ],
  );
  const appt = rows[0];
  if (appt?.id) {
    await pool.query(
      'UPDATE booking_requests SET appointment_id = $2, updated_at = NOW() WHERE id = $1',
      [booking.id, appt.id],
    );
  }
  return appt;
}

async function cancelLinkedAppointment(booking, helperId) {
  if (!booking.appointment_id) return null;
  const { rows } = await pool.query(
    `UPDATE appointments
        SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND helper_id = $2 AND status IN ('requested', 'confirmed')
      RETURNING *`,
    [booking.appointment_id, helperId],
  );
  return rows[0] || null;
}

async function syncAppointmentTimes(booking, date, start, end) {
  if (!booking.appointment_id) return null;
  const startDate = new Date(`${date}T${start}:00`);
  const endDate = new Date(`${date}T${end}:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return null;
  }
  const duration = Math.max(15, Math.min(480, Math.round((endDate - startDate) / 60000) || 60));
  const { rows } = await pool.query(
    `UPDATE appointments
        SET scheduled_start_time = $2,
            scheduled_end_time = $3,
            estimated_duration_minutes = $4,
            updated_at = NOW()
      WHERE id = $1 AND status IN ('requested', 'confirmed')
      RETURNING *`,
    [booking.appointment_id, startDate, endDate, duration],
  );
  return rows[0] || null;
}

/**
 * Active owner + members for a business (for user-room fanout without spam).
 * Dedupes ids; caller should exclude already-notified helper/customer.
 */
async function listBusinessMemberUserIds(businessId) {
  if (!businessId) return [];
  const { rows } = await pool
    .query(
      `SELECT b.user_id AS id
         FROM businesses b
        WHERE b.id = $1 AND b.is_active = TRUE AND b.user_id IS NOT NULL
       UNION
       SELECT bm.member_id AS id
         FROM business_members bm
         JOIN businesses b ON b.id = bm.business_id AND b.is_active = TRUE
        WHERE bm.business_id = $1
          AND bm.status = 'active'
          AND bm.member_id IS NOT NULL`,
      [businessId],
    )
    .catch(() => ({ rows: [] }));
  return [...new Set(rows.map((r) => r.id).filter(Boolean).map(String))];
}

function emitToUserRooms(userId, event, payload) {
  if (!userId) return;
  socketService.broadcastToUser(userId, 'booking:updated', payload);
  socketService.broadcastToUser(userId, 'booking:chat_updated', payload);
  if (event === 'requested') {
    socketService.broadcastToUser(userId, 'booking:new', payload);
  }
}

async function emitBookingEvent({ booking, event, actorId = null }) {
  const card = toPublicBookingRequestCard(booking);
  if (!card) return;
  const payload = {
    bookingId: card.id,
    status: card.status,
    booking: card,
    event,
    actorId,
    conversationId: booking.conversation_id || null,
    guestSessionId: booking.guest_session_id || null,
    businessId: booking.business_id || null,
  };
  try {
    const notified = new Set();
    if (booking.helper_id) {
      emitToUserRooms(booking.helper_id, event, payload);
      notified.add(String(booking.helper_id));
    }
    if (booking.customer_id) {
      emitToUserRooms(booking.customer_id, event, payload);
      notified.add(String(booking.customer_id));
    }
    if (booking.conversation_id && typeof socketService.broadcastToConversation === 'function') {
      socketService.broadcastToConversation(booking.conversation_id, 'booking:chat_updated', payload);
    }
    if (booking.guest_session_id) {
      try {
        socketService.io?.to?.(`guest_session_${booking.guest_session_id}`)?.emit?.(
          'booking:chat_updated',
          payload,
        );
      } catch {
        /* optional */
      }
    }
    // Business-scoped bookings: room + member user rooms (skip helper/customer already notified).
    if (booking.business_id) {
      if (typeof socketService.broadcastToBusinessCalendar === 'function') {
        socketService.broadcastToBusinessCalendar(booking.business_id, 'booking:updated', payload);
        socketService.broadcastToBusinessCalendar(booking.business_id, 'booking:chat_updated', payload);
        if (event === 'requested') {
          socketService.broadcastToBusinessCalendar(booking.business_id, 'booking:new', payload);
        }
      }
      const memberIds = await listBusinessMemberUserIds(booking.business_id);
      for (const mid of memberIds) {
        if (notified.has(String(mid))) continue;
        emitToUserRooms(mid, event, payload);
        notified.add(String(mid));
      }
    }
  } catch (e) {
    logger.warn('[bookingLifecycle] emit failed', { error: e.message });
  }
}

/**
 * Accept: pending | expired | counter_proposed → accepted + appointment confirm/create.
 */
async function acceptBookingRequest({ booking, actorId, actorType = 'helper', appointmentSource = 'booking_accept' }) {
  const gate = canProviderRespond(booking);
  if (!gate.ok) {
    const err = new Error(gate.reason || 'invalid_status');
    err.code = gate.reason || 'invalid_status';
    err.status = 409;
    throw err;
  }
  const oldStatus = booking.status;
  const { rows } = await pool.query(
    `UPDATE booking_requests
        SET status = 'accepted',
            accepted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP,
            helper_response_reason = NULL,
            counter_status = CASE
              WHEN counter_status = 'pending' THEN 'accepted'
              ELSE counter_status
            END
      WHERE id = $1 AND status = ANY($2::text[])
      RETURNING *`,
    [booking.id, PROVIDER_RESPOND_STATUSES],
  );
  if (!rows[0]) {
    const err = new Error('Booking is no longer pending');
    err.code = 'invalid_status';
    err.status = 409;
    throw err;
  }
  let updated = rows[0];
  let appointment = null;
  try {
    appointment = await confirmOrCreateAppointment(updated, updated.helper_id, {
      source: appointmentSource,
    });
    if (appointment?.id && !updated.appointment_id) {
      updated = { ...updated, appointment_id: appointment.id };
    }
  } catch (e) {
    logger.warn('[bookingLifecycle] appointment confirm/create failed', { error: e.message });
  }
  await logAudit(updated.id, 'accepted', actorId, actorType, oldStatus, 'accepted');
  await emitBookingEvent({ booking: updated, event: 'accepted', actorId });
  return { booking: updated, appointment };
}

/**
 * Decline: pending | expired | counter_proposed → declined; cancel linked appointment.
 */
async function declineBookingRequest({ booking, actorId, actorType = 'helper', reason = null }) {
  const gate = canProviderRespond(booking);
  if (!gate.ok) {
    const err = new Error(gate.reason || 'invalid_status');
    err.code = gate.reason || 'invalid_status';
    err.status = 409;
    throw err;
  }
  const oldStatus = booking.status;
  const note = reason ? String(reason).trim().slice(0, 500) : null;
  const { rows } = await pool.query(
    `UPDATE booking_requests
        SET status = 'declined',
            declined_at = CURRENT_TIMESTAMP,
            helper_response_reason = $2,
            updated_at = CURRENT_TIMESTAMP,
            counter_status = CASE
              WHEN counter_status = 'pending' THEN 'declined'
              ELSE counter_status
            END
      WHERE id = $1 AND status = ANY($3::text[])
      RETURNING *`,
    [booking.id, note, PROVIDER_RESPOND_STATUSES],
  );
  if (!rows[0]) {
    const err = new Error('Booking is no longer pending');
    err.code = 'invalid_status';
    err.status = 409;
    throw err;
  }
  const updated = rows[0];
  try {
    await cancelLinkedAppointment(updated, updated.helper_id);
  } catch (e) {
    logger.warn('[bookingLifecycle] appointment cancel failed', { error: e.message });
  }
  await logAudit(updated.id, 'declined', actorId, actorType, oldStatus, 'declined');
  await emitBookingEvent({ booking: updated, event: 'declined', actorId });
  return { booking: updated };
}

/**
 * Provider propose different time → counter_proposed (+ legacy counter_* sync).
 */
async function proposeBookingTime({ booking, actorId, actorType = 'helper', date, start, end, note = null }) {
  const gate = canProviderRespond(booking);
  if (!gate.ok) {
    const err = new Error(gate.reason || 'invalid_status');
    err.code = gate.reason || 'invalid_status';
    err.status = 409;
    throw err;
  }
  const d = normalizeDate(date);
  const s = normalizeClock(start);
  const e = normalizeClock(end);
  if (!d || !s || !e) {
    const err = new Error('requestedDate, start, and end are required');
    err.code = 'validation_failed';
    err.status = 400;
    throw err;
  }
  if (s >= e) {
    const err = new Error('End time must be after start time');
    err.code = 'validation_failed';
    err.status = 400;
    throw err;
  }
  const startSql = s.length === 5 ? `${s}:00` : s;
  const endSql = e.length === 5 ? `${e}:00` : e;
  const noteClean = note ? String(note).trim().slice(0, 500) : null;
  const oldStatus = booking.status;

  let updated;
  try {
    const { rows } = await pool.query(
      `UPDATE booking_requests
          SET requested_date = $2,
              requested_start_time = $3,
              requested_end_time = $4,
              status = 'counter_proposed',
              helper_response_reason = $5,
              counter_proposed_at = CURRENT_TIMESTAMP,
              counter_date = $2,
              counter_start_time = $3,
              counter_end_time = $4,
              counter_message = $5,
              counter_status = 'pending',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = ANY($6::text[])
        RETURNING *`,
      [booking.id, d, startSql, endSql, noteClean, PROVIDER_RESPOND_STATUSES],
    );
    updated = rows[0];
  } catch (sqlErr) {
    // Older DBs without counter_proposed in CHECK — fall back to pending + counter_* only
    if (sqlErr.code === '23514') {
      const { rows } = await pool.query(
        `UPDATE booking_requests
            SET requested_date = $2,
                requested_start_time = $3,
                requested_end_time = $4,
                status = 'pending',
                helper_response_reason = $5,
                counter_proposed_at = CURRENT_TIMESTAMP,
                counter_date = $2,
                counter_start_time = $3,
                counter_end_time = $4,
                counter_message = $5,
                counter_status = 'pending',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status IN ('pending', 'expired')
          RETURNING *`,
        [booking.id, d, startSql, endSql, noteClean],
      );
      updated = rows[0];
    } else {
      throw sqlErr;
    }
  }
  if (!updated) {
    const err = new Error('Booking is no longer pending');
    err.code = 'invalid_status';
    err.status = 409;
    throw err;
  }

  try {
    await syncAppointmentTimes(updated, d, s, e);
  } catch (syncErr) {
    logger.warn('[bookingLifecycle] appointment time sync failed', { error: syncErr.message });
  }

  await logAudit(updated.id, 'counter_proposed', actorId, actorType, oldStatus, updated.status);
  await emitBookingEvent({ booking: updated, event: 'counter_proposed', actorId });
  return { booking: updated };
}

/**
 * Customer accepts provider-proposed time (status must be counter_proposed,
 * or legacy counter_status=pending).
 */
async function customerAcceptBookingRequest({
  booking,
  actorId,
  actorType = 'customer',
  appointmentSource = 'booking_customer_accept',
}) {
  const isCanonical = toChatStatus(booking.status) === 'counter_proposed';
  const isLegacy = booking.counter_status === 'pending' && toChatStatus(booking.status) === 'pending';
  if (!isCanonical && !isLegacy) {
    const gate = canCustomerRespond(booking);
    const err = new Error(gate.reason || 'invalid_status');
    err.code = gate.reason || 'invalid_status';
    err.status = 409;
    throw err;
  }

  const oldStatus = booking.status;
  let working = booking;

  // Legacy: apply counter_* into requested_* first
  if (isLegacy && booking.counter_date) {
    const { rows: migrated } = await pool.query(
      `UPDATE booking_requests
          SET requested_date = counter_date,
              requested_start_time = counter_start_time,
              requested_end_time = counter_end_time,
              status = 'counter_proposed',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND counter_status = 'pending'
        RETURNING *`,
      [booking.id],
    );
    working = migrated[0] || booking;
  }

  const { rows } = await pool.query(
    `UPDATE booking_requests
        SET status = 'accepted',
            accepted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP,
            counter_status = 'accepted'
      WHERE id = $1 AND status = 'counter_proposed'
      RETURNING *`,
    [working.id],
  );
  if (!rows[0]) {
    const err = new Error('Booking is no longer counter-proposed');
    err.code = 'invalid_status';
    err.status = 409;
    throw err;
  }
  let updated = rows[0];
  let appointment = null;
  try {
    appointment = await confirmOrCreateAppointment(updated, updated.helper_id, {
      source: appointmentSource,
    });
    if (appointment?.id && !updated.appointment_id) {
      updated = { ...updated, appointment_id: appointment.id };
    }
  } catch (e) {
    logger.warn('[bookingLifecycle] customer-accept appointment failed', { error: e.message });
  }
  await logAudit(updated.id, 'accepted', actorId, actorType, oldStatus, 'accepted');
  await emitBookingEvent({ booking: updated, event: 'accepted', actorId });
  return { booking: updated, appointment };
}

async function customerDeclineBookingRequest({ booking, actorId, actorType = 'customer', reason = null }) {
  const isCanonical = toChatStatus(booking.status) === 'counter_proposed';
  const isLegacy = booking.counter_status === 'pending' && toChatStatus(booking.status) === 'pending';
  if (!isCanonical && !isLegacy) {
    const gate = canCustomerRespond(booking);
    const err = new Error(gate.reason || 'invalid_status');
    err.code = gate.reason || 'invalid_status';
    err.status = 409;
    throw err;
  }
  const oldStatus = booking.status;
  const note = reason ? String(reason).trim().slice(0, 500) : null;
  const { rows } = await pool.query(
    `UPDATE booking_requests
        SET status = 'declined',
            declined_at = CURRENT_TIMESTAMP,
            helper_response_reason = COALESCE($2, helper_response_reason),
            updated_at = CURRENT_TIMESTAMP,
            counter_status = 'declined'
      WHERE id = $1 AND (status = 'counter_proposed' OR counter_status = 'pending')
      RETURNING *`,
    [booking.id, note],
  );
  if (!rows[0]) {
    const err = new Error('Booking is no longer counter-proposed');
    err.code = 'invalid_status';
    err.status = 409;
    throw err;
  }
  const updated = rows[0];
  try {
    await cancelLinkedAppointment(updated, updated.helper_id);
  } catch (e) {
    logger.warn('[bookingLifecycle] customer-decline appointment cancel failed', { error: e.message });
  }
  await logAudit(updated.id, 'declined', actorId, actorType, oldStatus, 'declined');
  await emitBookingEvent({ booking: updated, event: 'declined', actorId });
  return { booking: updated };
}

module.exports = {
  INBOX_STATUSES,
  PROVIDER_RESPOND_STATUSES,
  loadBooking,
  expireIfStale,
  isProviderForBooking,
  resolveProviderBusinessIds,
  listIncomingForProvider,
  toCalendarBooking,
  confirmOrCreateAppointment,
  cancelLinkedAppointment,
  syncAppointmentTimes,
  emitBookingEvent,
  listBusinessMemberUserIds,
  acceptBookingRequest,
  declineBookingRequest,
  proposeBookingTime,
  customerAcceptBookingRequest,
  customerDeclineBookingRequest,
  logAudit,
  formatTimePart,
  buildStatusMessage,
  canProviderRespond,
  canCustomerRespond,
  toPublicBookingRequestCard,
  toChatStatus,
  normalizeClock,
  normalizeDate,
};
