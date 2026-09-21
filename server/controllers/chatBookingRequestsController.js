'use strict';

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');
const {
  assertConversationParticipant,
  assertGuestInquiryAccess,
  assertBusinessAccess,
  resolveGuestFromRequest,
} = require('../services/chatThreadAccess');
const {
  buildBookingRequestMarker,
  parseBookingRequestMarker,
  toPublicBookingRequestCard,
  canProviderRespond,
  buildStatusMessage,
  normalizeClock,
  normalizeDate,
  toChatStatus,
} = require('../services/chatBookingRequests');
const { checkScheduleAgreementGate } = require('../services/chatAgreements');

function bad(res, status, error, code = 'error', extra = {}) {
  return res.status(status).json({ error, code, ...extra });
}

async function loadBooking(id) {
  if (!id) return null;
  const { rows } = await pool.query('SELECT * FROM booking_requests WHERE id = $1', [id]);
  return rows[0] || null;
}

async function isProviderForBooking(userId, booking) {
  if (!userId || !booking) return false;
  if (String(booking.helper_id) === String(userId)) return true;
  if (booking.business_id) {
    const biz = await assertBusinessAccess(userId, booking.business_id);
    if (biz) return true;
  }
  if (booking.conversation_id) {
    const conv = await assertConversationParticipant(userId, booking.conversation_id);
    if (conv && String(conv.helper_id) === String(userId)) return true;
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

async function canViewBooking(req, booking) {
  const userId = req.user?.id;
  if (!booking) return false;
  if (userId && String(booking.customer_id) === String(userId)) return true;
  if (userId && (await isProviderForBooking(userId, booking))) return true;
  const guest = await resolveGuestFromRequest(req);
  if (guest && booking.guest_session_id && String(guest.id) === String(booking.guest_session_id)) {
    return true;
  }
  return false;
}

async function postConversationMessage({ conversationId, senderId, content, senderName }) {
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, sender_id, content, message_type)
     VALUES ($1, $2, $3, 'text') RETURNING *`,
    [conversationId, senderId, content],
  );
  await pool.query(
    'UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
    [conversationId],
  );
  const message = { ...rows[0], sender_name: senderName };
  socketService.broadcastToConversation(conversationId, 'message:new', {
    conversationId,
    message,
  });
  socketService.broadcastToConversation(conversationId, 'profile_chat:new_message', {
    conversationId,
    message,
    senderName,
  });
  return message;
}

async function postGuestMessage({ guestSessionId, senderType, senderName, content, helperId }) {
  const { rows } = await pool.query(
    `INSERT INTO guest_profile_chat_messages
       (session_id, sender_type, sender_name, message, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     RETURNING id, session_id, sender_type, sender_name, message, created_at`,
    [guestSessionId, senderType || 'helper', senderName, content],
  );
  const msg = rows[0];
  const createdAt = msg.created_at instanceof Date ? msg.created_at.toISOString() : msg.created_at;
  const payload = {
    guestInquiry: true,
    guestSessionId,
    message: {
      id: msg.id,
      content,
      sender_type: senderType || 'helper',
      sender_name: senderName,
      created_at: createdAt,
    },
    senderName,
    bookingEvent: true,
  };
  try {
    if (typeof socketService.broadcastGuestChatMessage === 'function') {
      socketService.broadcastGuestChatMessage(guestSessionId, {
        messageId: msg.id,
        senderType: senderType || 'helper',
        senderName,
        message: content,
        createdAt,
      });
    }
  } catch { /* optional */ }
  try {
    socketService.io?.to?.(`guest_session_${guestSessionId}`)?.emit?.('profile_chat:new_message', payload);
    if (helperId) socketService.broadcastToUser(helperId, 'profile_chat:new_message', payload);
  } catch (e) {
    logger.warn('[chatBookingRequests] guest socket emit failed', { error: e.message });
  }
  return msg;
}

async function emitBookingEvent({ booking, event, actorId = null }) {
  const card = toPublicBookingRequestCard(booking);
  const payload = {
    bookingId: card.id,
    status: card.status,
    booking: card,
    event,
    actorId,
    conversationId: booking.conversation_id || null,
    guestSessionId: booking.guest_session_id || null,
  };
  try {
    if (booking.helper_id) {
      socketService.broadcastToUser(booking.helper_id, 'booking:updated', payload);
      socketService.broadcastToUser(booking.helper_id, 'booking:chat_updated', payload);
    }
    if (booking.customer_id) {
      socketService.broadcastToUser(booking.customer_id, 'booking:updated', payload);
      socketService.broadcastToUser(booking.customer_id, 'booking:chat_updated', payload);
    }
    if (booking.conversation_id) {
      socketService.broadcastToConversation(booking.conversation_id, 'booking:chat_updated', payload);
    }
  } catch (e) {
    logger.warn('[chatBookingRequests] emit failed', { error: e.message });
  }
}

async function postStatusToThread({ booking, event, actorId, actorName, reason = '' }) {
  const content = buildStatusMessage({ booking, event, reason });
  if (!content) return null;
  if (booking.conversation_id && actorId) {
    try {
      return await postConversationMessage({
        conversationId: booking.conversation_id,
        senderId: actorId,
        content,
        senderName: actorName || 'Provider',
      });
    } catch (e) {
      logger.warn('[chatBookingRequests] conversation status post failed', { error: e.message });
    }
  }
  if (booking.guest_session_id) {
    try {
      return await postGuestMessage({
        guestSessionId: booking.guest_session_id,
        senderType: 'helper',
        senderName: actorName || 'Provider',
        content,
        helperId: booking.helper_id,
      });
    } catch (e) {
      logger.warn('[chatBookingRequests] guest status post failed', { error: e.message });
    }
  }
  return null;
}

async function confirmOrCreateAppointment(booking, helperId) {
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

  const startIso = `${date}T${start}:00`;
  const endIso = `${date}T${end}:00`;
  const startDate = new Date(startIso);
  const endDate = new Date(endIso);
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
       'messenger_accept', NULL, NULL
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
      ].filter(Boolean).join(' | '),
      helperId,
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

/**
 * GET /api/chat/booking-requests/:id
 */
exports.getBookingRequest = async (req, res, next) => {
  try {
    const booking = await loadBooking(req.params.id);
    if (!booking) return bad(res, 404, 'Booking request not found', 'not_found');
    if (!(await canViewBooking(req, booking))) {
      if (!req.user?.id && !(await resolveGuestFromRequest(req))) {
        return bad(res, 401, 'Sign in or verify as guest', 'verify_required');
      }
      return bad(res, 403, 'Not allowed', 'forbidden');
    }
    return res.json(toPublicBookingRequestCard(booking));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/chat/booking-requests/:id/accept
 */
exports.acceptBookingRequest = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_error');

    const booking = await loadBooking(req.params.id);
    if (!booking) return bad(res, 404, 'Booking request not found', 'not_found');
    if (!(await isProviderForBooking(userId, booking))) {
      return bad(res, 403, 'Only the provider can accept this booking', 'forbidden');
    }
    const gate = canProviderRespond(booking);
    if (!gate.ok) return bad(res, 409, `Cannot accept: ${gate.reason}`, gate.reason);

    const { rows } = await pool.query(
      `UPDATE booking_requests
          SET status = 'accepted',
              accepted_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP,
              helper_response_reason = NULL
        WHERE id = $1 AND status IN ('pending', 'expired', 'counter_proposed')
        RETURNING *`,
      [booking.id],
    );
    if (!rows[0]) return bad(res, 409, 'Booking is no longer pending', 'invalid_status');
    let updated = rows[0];

    let appointment = null;
    try {
      appointment = await confirmOrCreateAppointment(updated, updated.helper_id);
      if (appointment?.id && !updated.appointment_id) {
        updated = { ...updated, appointment_id: appointment.id };
      }
    } catch (e) {
      logger.warn('[chatBookingRequests] appointment confirm/create failed', { error: e.message });
    }

    const actorName =
      [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
    await postStatusToThread({
      booking: updated,
      event: 'accepted',
      actorId: userId,
      actorName,
    });
    await emitBookingEvent({ booking: updated, event: 'accepted', actorId: userId });

    return res.json({
      success: true,
      booking: toPublicBookingRequestCard(updated),
      appointmentId: appointment?.id || updated.appointment_id || null,
      appointment,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/chat/booking-requests/:id/decline
 * Body: { reason?: string }
 */
exports.declineBookingRequest = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_error');

    const booking = await loadBooking(req.params.id);
    if (!booking) return bad(res, 404, 'Booking request not found', 'not_found');
    if (!(await isProviderForBooking(userId, booking))) {
      return bad(res, 403, 'Only the provider can decline this booking', 'forbidden');
    }
    const gate = canProviderRespond(booking);
    if (!gate.ok) return bad(res, 409, `Cannot decline: ${gate.reason}`, gate.reason);

    const reason = String(req.body?.reason || req.body?.decline_reason || '').trim().slice(0, 500) || null;

    const { rows } = await pool.query(
      `UPDATE booking_requests
          SET status = 'declined',
              declined_at = CURRENT_TIMESTAMP,
              helper_response_reason = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status IN ('pending', 'expired', 'counter_proposed')
        RETURNING *`,
      [booking.id, reason],
    );
    if (!rows[0]) return bad(res, 409, 'Booking is no longer pending', 'invalid_status');
    const updated = rows[0];

    try {
      await cancelLinkedAppointment(updated, updated.helper_id);
    } catch (e) {
      logger.warn('[chatBookingRequests] appointment cancel failed', { error: e.message });
    }

    const actorName =
      [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
    await postStatusToThread({
      booking: updated,
      event: 'declined',
      actorId: userId,
      actorName,
      reason,
    });
    await emitBookingEvent({ booking: updated, event: 'declined', actorId: userId });

    return res.json({
      success: true,
      booking: toPublicBookingRequestCard(updated),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/chat/booking-requests/:id/propose
 * Provider counter-offer: update requested times, keep pending (counter_proposed).
 * Body: { requestedDate, requestedStartTime, requestedEndTime, note? }
 */
exports.proposeBookingTime = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_error');

    const booking = await loadBooking(req.params.id);
    if (!booking) return bad(res, 404, 'Booking request not found', 'not_found');
    if (!(await isProviderForBooking(userId, booking))) {
      return bad(res, 403, 'Only the provider can propose a different time', 'forbidden');
    }
    const gate = canProviderRespond(booking);
    if (!gate.ok) return bad(res, 409, `Cannot propose: ${gate.reason}`, gate.reason);

    const agreementGate = await checkScheduleAgreementGate(pool, {
      conversationId: booking.conversation_id,
      guestSessionId: booking.guest_session_id,
    });
    if (agreementGate.blocked) {
      return bad(
        res,
        409,
        'Accept the required agreement before scheduling',
        'agreement_required',
        { agreements: agreementGate.agreements },
      );
    }

    const body = req.body || {};
    const date = normalizeDate(body.requestedDate || body.date);
    const start = normalizeClock(body.requestedStartTime || body.start);
    const end = normalizeClock(body.requestedEndTime || body.end);
    if (!date || !start || !end) {
      return bad(res, 400, 'requestedDate, start, and end are required', 'validation_failed');
    }
    if (start >= end) {
      return bad(res, 400, 'End time must be after start time', 'validation_failed');
    }
    const note = String(body.note || body.reason || '').trim().slice(0, 500) || null;

    // counter_proposed may not be in older CHECK constraints — fall back to pending if needed
    let updated;
    try {
      const { rows } = await pool.query(
        `UPDATE booking_requests
            SET requested_date = $2,
                requested_start_time = $3,
                requested_end_time = $4,
                status = 'counter_proposed',
                helper_response_reason = $5,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status IN ('pending', 'expired', 'counter_proposed')
          RETURNING *`,
        [
          booking.id,
          date,
          start.length === 5 ? `${start}:00` : start,
          end.length === 5 ? `${end}:00` : end,
          note,
        ],
      );
      updated = rows[0];
    } catch (e) {
      if (e.code === '23514') {
        const { rows } = await pool.query(
          `UPDATE booking_requests
              SET requested_date = $2,
                  requested_start_time = $3,
                  requested_end_time = $4,
                  status = 'pending',
                  helper_response_reason = $5,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status IN ('pending', 'expired')
            RETURNING *`,
          [
            booking.id,
            date,
            start.length === 5 ? `${start}:00` : start,
            end.length === 5 ? `${end}:00` : end,
            note,
          ],
        );
        updated = rows[0];
      } else {
        throw e;
      }
    }
    if (!updated) return bad(res, 409, 'Booking is no longer pending', 'invalid_status');

    // Keep linked appointment in sync when present
    if (updated.appointment_id) {
      try {
        const startDate = new Date(`${date}T${start}:00`);
        const endDate = new Date(`${date}T${end}:00`);
        await pool.query(
          `UPDATE appointments
              SET scheduled_start_time = $2,
                  scheduled_end_time = $3,
                  status = 'requested',
                  updated_at = NOW()
            WHERE id = $1 AND helper_id = $4`,
          [updated.appointment_id, startDate, endDate, updated.helper_id],
        );
      } catch (e) {
        logger.warn('[chatBookingRequests] appointment reschedule failed', { error: e.message });
      }
    }

    const actorName =
      [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
    await postStatusToThread({
      booking: updated,
      event: 'counter_proposed',
      actorId: userId,
      actorName,
      reason: note,
    });
    await emitBookingEvent({ booking: updated, event: 'counter_proposed', actorId: userId });

    return res.json({
      success: true,
      booking: toPublicBookingRequestCard(updated),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Helper used by messenger create paths to attach chat linkage + return marker.
 * Not an HTTP handler.
 */

/**
 * POST /api/chat/booking-requests
 * Inbox / ChatPanel Schedule with no quote: create a durable booking_request,
 * post [booking_req:…] marker into the conversation, emit sockets.
 * Customer or provider (schedules on behalf of conversation customer) may call.
 * Body: {
 *   conversationId, helperId?, businessId?, serviceId?, serviceName?,
 *   requestedDate, requestedStartTime, requestedEndTime,
 *   startIso?, endIso?, timezone?, description?, source?
 * }
 */
exports.createChatBookingRequest = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_error');

    const body = req.body || {};
    const conversationId = body.conversationId || body.conversation_id || null;
    if (!conversationId) {
      return bad(res, 400, 'conversationId is required', 'validation_failed');
    }

    const conv = await assertConversationParticipant(userId, conversationId);
    if (!conv) return bad(res, 403, 'Not a conversation participant', 'forbidden');

    const agreementGate = await checkScheduleAgreementGate(pool, {
      conversationId,
      guestSessionId: null,
    });
    if (agreementGate.blocked) {
      return bad(
        res,
        409,
        'Accept the required agreement before scheduling',
        'agreement_required',
        { agreements: agreementGate.agreements },
      );
    }

    const date = normalizeDate(body.requestedDate || body.date);
    const start = normalizeClock(body.requestedStartTime || body.start);
    const end = normalizeClock(body.requestedEndTime || body.end);
    if (!date || !start || !end) {
      return bad(res, 400, 'requestedDate, start, and end are required', 'validation_failed');
    }
    if (start >= end) {
      return bad(res, 400, 'End time must be after start time', 'validation_failed');
    }

    const isProvider =
      String(conv.helper_id) === String(userId) ||
      (conv.business_id && (await assertBusinessAccess(userId, conv.business_id)));

    let helperId = body.helperId || body.helper_id || conv.helper_id || null;
    let businessId = body.businessId ?? body.business_id ?? conv.business_id ?? null;
    if (businessId && !helperId) {
      const biz = await pool.query('SELECT user_id FROM businesses WHERE id = $1', [businessId]);
      helperId = biz.rows[0]?.user_id || null;
    }
    if (!helperId) {
      return bad(res, 400, 'Could not resolve helper for booking', 'validation_failed');
    }

    // Customer books themselves; provider schedules on behalf of the conversation customer.
    let customerId;
    if (isProvider) {
      customerId = conv.customer_id || null;
      if (!customerId) {
        return bad(
          res,
          400,
          'Conversation has no customer to schedule for',
          'validation_failed',
        );
      }
    } else {
      customerId = userId;
      if (String(customerId) === String(helperId)) {
        return bad(res, 400, 'Cannot book with yourself', 'validation_failed');
      }
    }

    const serviceName = String(
      body.serviceName || body.service_name || 'Service request',
    )
      .trim()
      .slice(0, 200);
    const serviceId = body.serviceId ?? body.service_id ?? null;
    const timezone = String(body.timezone || '').trim().slice(0, 80) || null;
    const description = String(body.description || '').trim().slice(0, 2000) || null;
    const source = String(body.source || 'messenger_inbox_schedule').trim().slice(0, 64);
    const hours = 24;
    const bookingId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const { rows } = await pool.query(
      `INSERT INTO booking_requests (
         id, customer_id, helper_id, business_id, service_name, requested_date,
         requested_start_time, requested_end_time, service_location,
         description, expires_at, confirmation_hours,
         conversation_id, guest_session_id, source, service_id, timezone
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, $11,
         $12, NULL, $13, $14, $15
       ) RETURNING *`,
      [
        bookingId,
        customerId,
        helperId,
        businessId || null,
        serviceName,
        date,
        start.length === 5 ? `${start}:00` : start,
        end.length === 5 ? `${end}:00` : end,
        description,
        expiresAt,
        hours,
        conversationId,
        source,
        serviceId != null ? String(serviceId) : null,
        timezone,
      ],
    );
    const booking = rows[0];

    const actorName =
      [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') ||
      (isProvider ? 'Provider' : 'Customer');
    await postStatusToThread({
      booking,
      event: 'requested',
      actorId: userId,
      actorName,
    });
    await emitBookingEvent({ booking, event: 'requested', actorId: userId });

    try {
      socketService.broadcastToUser(helperId, 'booking:requested', { booking });
      if (customerId && String(customerId) !== String(userId)) {
        socketService.broadcastToUser(customerId, 'booking:requested', { booking });
      }
    } catch { /* ignore */ }

    return res.status(201).json({
      success: true,
      booking: toPublicBookingRequestCard(booking),
      marker: buildBookingRequestMarker({
        id: booking.id,
        status: booking.status,
        date,
        start,
        end,
        serviceName,
        serviceId,
      }),
    });
  } catch (err) {
    next(err);
  }
};

exports.linkBookingToChat = async function linkBookingToChat(bookingId, {
  conversationId = null,
  guestSessionId = null,
  appointmentId = null,
  quoteKind = null,
  quoteId = null,
  source = 'messenger_picker',
  serviceId = null,
  timezone = null,
} = {}) {
  if (!bookingId) return null;
  const { rows } = await pool.query(
    `UPDATE booking_requests
        SET conversation_id = COALESCE($2, conversation_id),
            guest_session_id = COALESCE($3, guest_session_id),
            appointment_id = COALESCE($4, appointment_id),
            quote_kind = COALESCE($5, quote_kind),
            quote_id = COALESCE($6, quote_id),
            source = COALESCE($7, source),
            service_id = COALESCE($8, service_id),
            timezone = COALESCE($9, timezone),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      bookingId,
      conversationId || null,
      guestSessionId || null,
      appointmentId || null,
      quoteKind || null,
      quoteId != null ? String(quoteId) : null,
      source || null,
      serviceId != null ? String(serviceId) : null,
      timezone || null,
    ],
  );
  return rows[0] || null;
};

exports.createGuestChatBookingRequest = async function createGuestChatBookingRequest({
  helperId,
  businessId = null,
  guestSessionId,
  serviceName,
  serviceId = null,
  date,
  start,
  end,
  timezone = null,
  description = null,
  appointmentId = null,
  source = 'messenger_picker',
  conversationId = null,
}) {
  const bookingId = crypto.randomUUID();
  const hours = 24;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `INSERT INTO booking_requests (
       id, customer_id, helper_id, business_id, service_name, requested_date,
       requested_start_time, requested_end_time, service_location,
       description, expires_at, confirmation_hours,
       conversation_id, guest_session_id, appointment_id, source, service_id, timezone
     ) VALUES (
       $1, NULL, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10,
       $11, $12, $13, $14, $15, $16
     ) RETURNING *`,
    [
      bookingId,
      helperId,
      businessId || null,
      String(serviceName || 'Service request').trim().slice(0, 200),
      normalizeDate(date),
      normalizeClock(start).length === 5 ? `${normalizeClock(start)}:00` : normalizeClock(start),
      normalizeClock(end).length === 5 ? `${normalizeClock(end)}:00` : normalizeClock(end),
      description || null,
      expiresAt,
      hours,
      conversationId || null,
      guestSessionId || null,
      appointmentId || null,
      source,
      serviceId != null ? String(serviceId) : null,
      timezone || null,
    ],
  );
  return rows[0];
};

exports.buildBookingRequestMarker = buildBookingRequestMarker;
exports.parseBookingRequestMarker = parseBookingRequestMarker;
exports.toPublicBookingRequestCard = toPublicBookingRequestCard;
exports.toChatStatus = toChatStatus;
