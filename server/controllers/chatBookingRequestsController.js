'use strict';

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');
const {
  assertConversationParticipant,
  assertBusinessAccess,
  resolveGuestFromRequest,
} = require('../services/chatThreadAccess');
const {
  buildBookingRequestMarker,
  parseBookingRequestMarker,
  toPublicBookingRequestCard,
  canProviderRespond,
  canCustomerRespond,
  buildStatusMessage,
  normalizeClock,
  normalizeDate,
  toChatStatus,
} = require('../services/chatBookingRequests');
const bookingLifecycle = require('../services/bookingRequestLifecycle');
const { checkScheduleAgreementGate } = require('../services/chatAgreements');
const { mirrorLegacyMessage } = require('../services/businessConversationSync');
const { enqueueConversationMessageNotifications } = require('../services/messageNotificationService');
const { withTransaction } = require('../utils/transaction');

function bad(res, status, error, code = 'error', extra = {}) {
  return res.status(status).json({ error, code, ...extra });
}

function getClientRequestId(req) {
  const value = req.get?.('Idempotency-Key')
    || req.body?.clientRequestId
    || req.body?.client_request_id
    || null;
  if (!value) return null;
  const id = String(value).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : false;
}

async function loadBooking(id) {
  if (!id) return null;
  const { rows } = await pool.query('SELECT * FROM booking_requests WHERE id = $1', [id]);
  return rows[0] || null;
}

async function isCustomerForBooking(req, booking) {
  if (!booking) return { ok: false, reason: 'not_found' };
  const userId = req.user?.id;
  if (userId && (await bookingLifecycle.isProviderForBooking(userId, booking))) {
    return { ok: false, reason: 'provider_cannot_customer_respond' };
  }
  if (userId && booking.customer_id && String(booking.customer_id) === String(userId)) {
    return { ok: true, via: 'customer', userId };
  }
  if (userId && booking.conversation_id) {
    const conv = await assertConversationParticipant(userId, booking.conversation_id, { writable: true });
    if (conv && String(conv.customer_id) === String(userId)) {
      return { ok: true, via: 'conversation_customer', userId };
    }
  }
  const guest = await resolveGuestFromRequest(req);
  if (guest && booking.guest_session_id && String(guest.id) === String(booking.guest_session_id)) {
    return { ok: true, via: 'guest', guest };
  }
  if (!userId && !guest) return { ok: false, reason: 'verify_required' };
  return { ok: false, reason: 'forbidden' };
}

async function canViewBooking(req, booking) {
  const userId = req.user?.id;
  if (!booking) return false;
  if (userId && String(booking.customer_id) === String(userId)) return true;
  if (userId && (await bookingLifecycle.isProviderForBooking(userId, booking))) return true;
  const guest = await resolveGuestFromRequest(req);
  if (guest && booking.guest_session_id && String(guest.id) === String(booking.guest_session_id)) {
    return true;
  }
  return false;
}

async function postConversationMessage({ conversationId, senderId, content, senderName, businessId = null, clientMessageId, recipientIds = null }) {
  const { messageRow, replayed } = await withTransaction(pool, async (client) => {
    let messageRow;
    let replayed = false;
    const { rows } = await client.query(
    `INSERT INTO messages (conversation_id, sender_id, content, message_type, client_message_id)
     VALUES ($1, $2, $3, 'text', $4)
     ON CONFLICT (conversation_id, client_message_id)
     WHERE client_message_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [conversationId, senderId, content, clientMessageId || null],
    );
    messageRow = rows[0];
    replayed = !messageRow && Boolean(clientMessageId);
    if (!messageRow && clientMessageId) {
      const replay = await client.query(
      'SELECT * FROM messages WHERE conversation_id = $1 AND client_message_id = $2',
      [conversationId, clientMessageId],
      );
      messageRow = replay.rows[0];
    }
    if (!messageRow) throw new Error('Failed to create booking chat message');
    if (!replayed) {
      await client.query(
    'UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
    [conversationId],
      );
      await enqueueConversationMessageNotifications({
        dbClient: client,
        conversationId,
        messageId: messageRow.id,
        senderId,
        senderName,
        body: content,
        actionUrl: `/messages/${conversationId}`,
        recipientIds,
      });
    }
    return { messageRow, replayed };
  }, 'chat_booking_message');
  if (replayed) return { ...messageRow, sender_name: senderName };
  const message = { ...messageRow, sender_name: senderName };
  socketService.broadcastToConversation(conversationId, 'message:new', {
    conversationId,
    message,
  });
  socketService.broadcastToConversation(conversationId, 'profile_chat:new_message', {
    conversationId,
    message,
    senderName,
  });
  try {
    await mirrorLegacyMessage?.({
      legacyConversationId: conversationId,
      businessId,
      message,
      senderName,
    });
  } catch (err) {
    logger.warn('[chatBookingRequests] business mirror failed', { error: err.message });
  }
  return message;
}

async function postGuestMessage({ guestSessionId, senderType, senderName, content, helperId, clientMessageId }) {
  const { rows } = await pool.query(
    `INSERT INTO guest_profile_chat_messages
       (session_id, sender_type, sender_name, message, client_message_id, created_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (session_id, client_message_id)
     WHERE client_message_id IS NOT NULL DO NOTHING
     RETURNING id, session_id, sender_type, sender_name, message, created_at`,
    [guestSessionId, senderType || 'helper', senderName, content, clientMessageId || null],
  );
  let msg = rows[0];
  if (!msg && clientMessageId) {
    const replay = await pool.query(
      `SELECT id, session_id, sender_type, sender_name, message, created_at
         FROM guest_profile_chat_messages
        WHERE session_id = $1 AND client_message_id = $2`,
      [guestSessionId, clientMessageId],
    );
    msg = replay.rows[0];
  }
  if (!msg) throw new Error('Failed to create booking guest message');
  if (rows.length === 0) return msg;
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
    if (booking.guest_session_id) {
      try {
        socketService.io?.to?.(`guest_session_${booking.guest_session_id}`)?.emit?.(
          'booking:chat_updated',
          payload,
        );
      } catch { /* optional */ }
    }
  } catch (e) {
    logger.warn('[chatBookingRequests] emit failed', { error: e.message });
  }
}

async function postStatusToThread({
  booking,
  event,
  actorId,
  actorName,
  reason = '',
  senderType = 'helper',
  clientMessageId = null,
}) {
  const content = buildStatusMessage({ booking, event, reason });
  if (!content) return null;
  if (booking.conversation_id && actorId) {
    try {
      return await postConversationMessage({
        conversationId: booking.conversation_id,
        senderId: actorId,
        content,
        senderName: actorName || 'Provider',
        businessId: booking.business_id,
        clientMessageId,
        recipientIds: [booking.customer_id, booking.helper_id],
      });
    } catch (e) {
      logger.warn('[chatBookingRequests] conversation status post failed', { error: e.message });
    }
  }
  if (booking.guest_session_id) {
    try {
      return await postGuestMessage({
        guestSessionId: booking.guest_session_id,
        senderType: senderType || 'helper',
        senderName: actorName || 'Provider',
        content,
        helperId: booking.helper_id,
        clientMessageId,
      });
    } catch (e) {
      logger.warn('[chatBookingRequests] guest status post failed', { error: e.message });
    }
  }
  return null;
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
    if (!(await bookingLifecycle.isProviderForBooking(userId, booking))) {
      return bad(res, 403, 'Only the provider can accept this booking', 'forbidden');
    }
    if (booking.conversation_id) {
      await assertConversationParticipant(userId, booking.conversation_id, { writable: true });
    }

    let result;
    try {
      result = await bookingLifecycle.acceptBookingRequest({
        booking,
        actorId: userId,
        actorType: 'helper',
        appointmentSource: 'messenger_accept',
      });
    } catch (e) {
      return bad(res, e.status || 409, e.message || `Cannot accept: ${e.code}`, e.code || 'invalid_status');
    }

    const updated = result.booking;
    const appointment = result.appointment;
    const actorName =
      [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
    await postStatusToThread({
      booking: updated,
      event: 'accepted',
      actorId: userId,
      actorName,
    });

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
    if (!(await bookingLifecycle.isProviderForBooking(userId, booking))) {
      return bad(res, 403, 'Only the provider can decline this booking', 'forbidden');
    }
    if (booking.conversation_id) {
      await assertConversationParticipant(userId, booking.conversation_id, { writable: true });
    }

    const reason = String(req.body?.reason || req.body?.decline_reason || '').trim().slice(0, 500) || null;
    let result;
    try {
      result = await bookingLifecycle.declineBookingRequest({
        booking,
        actorId: userId,
        actorType: 'helper',
        reason,
      });
    } catch (e) {
      return bad(res, e.status || 409, e.message || `Cannot decline: ${e.code}`, e.code || 'invalid_status');
    }

    const updated = result.booking;
    const actorName =
      [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
    await postStatusToThread({
      booking: updated,
      event: 'declined',
      actorId: userId,
      actorName,
      reason: reason || '',
    });

    return res.json({
      success: true,
      booking: toPublicBookingRequestCard(updated),
    });
  } catch (err) {
    next(err);
  }
};


/**
 * POST /api/chat/booking-requests/:id/customer-accept
 * Customer or verified guest accepts a provider-proposed (counter_proposed) time.
 */
exports.customerAcceptBookingRequest = async (req, res, next) => {
  try {
    const booking = await loadBooking(req.params.id);
    if (!booking) return bad(res, 404, 'Booking request not found', 'not_found');

    const authz = await isCustomerForBooking(req, booking);
    if (!authz.ok) {
      if (authz.reason === 'provider_cannot_customer_respond') {
        return bad(res, 403, 'Provider cannot use customer-accept; use /accept', 'forbidden');
      }
      return bad(res, 403, 'Only the customer or verified guest can accept this time', 'forbidden');
    }
    if (authz.userId && booking.conversation_id) {
      await assertConversationParticipant(authz.userId, booking.conversation_id, { writable: true });
    }

    let result;
    try {
      result = await bookingLifecycle.customerAcceptBookingRequest({
        booking,
        actorId: authz.userId || authz.guest?.id || null,
        actorType: authz.via === 'guest' ? 'guest' : 'customer',
        appointmentSource: 'messenger_customer_accept',
      });
    } catch (e) {
      return bad(res, e.status || 409, e.message || `Cannot accept: ${e.code}`, e.code || 'invalid_status');
    }

    const updated = result.booking;
    const appointment = result.appointment;
    const userId = authz.userId || null;
    const actorName =
      authz.via === 'guest'
        ? (authz.guest?.guest_name || authz.guest?.name || 'Guest')
        : ([req.user?.first_name, req.user?.last_name].filter(Boolean).join(' ') || 'Customer');
    await postStatusToThread({
      booking: updated,
      event: 'accepted',
      actorId: userId,
      actorName,
      senderType: 'customer',
    });

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

exports.customerDeclineBookingRequest = async (req, res, next) => {
  try {
    const booking = await loadBooking(req.params.id);
    if (!booking) return bad(res, 404, 'Booking request not found', 'not_found');

    const authz = await isCustomerForBooking(req, booking);
    if (!authz.ok) {
      if (authz.reason === 'provider_cannot_customer_respond') {
        return bad(res, 403, 'Provider cannot use customer-decline; use /decline', 'forbidden');
      }
      return bad(res, 403, 'Only the customer or verified guest can decline this time', 'forbidden');
    }
    if (authz.userId && booking.conversation_id) {
      await assertConversationParticipant(authz.userId, booking.conversation_id, { writable: true });
    }

    const reason = String(req.body?.reason || req.body?.decline_reason || '').trim().slice(0, 500) || null;
    let result;
    try {
      result = await bookingLifecycle.customerDeclineBookingRequest({
        booking,
        actorId: authz.userId || authz.guest?.id || null,
        actorType: authz.via === 'guest' ? 'guest' : 'customer',
        reason,
      });
    } catch (e) {
      return bad(res, e.status || 409, e.message || `Cannot decline: ${e.code}`, e.code || 'invalid_status');
    }

    const updated = result.booking;
    const userId = authz.userId || null;
    const actorName =
      authz.via === 'guest'
        ? (authz.guest?.guest_name || authz.guest?.name || 'Guest')
        : ([req.user?.first_name, req.user?.last_name].filter(Boolean).join(' ') || 'Customer');
    await postStatusToThread({
      booking: updated,
      event: 'declined',
      actorId: userId,
      actorName,
      reason: reason || '',
      senderType: 'customer',
    });

    return res.json({
      success: true,
      booking: toPublicBookingRequestCard(updated),
    });
  } catch (err) {
    next(err);
  }
};

exports.proposeBookingTime = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_error');

    const booking = await loadBooking(req.params.id);
    if (!booking) return bad(res, 404, 'Booking request not found', 'not_found');
    if (!(await bookingLifecycle.isProviderForBooking(userId, booking))) {
      return bad(res, 403, 'Only the provider can propose a different time', 'forbidden');
    }
    if (booking.conversation_id) {
      await assertConversationParticipant(userId, booking.conversation_id, { writable: true });
    }

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
    const note = String(body.note || body.reason || '').trim().slice(0, 500) || null;

    let result;
    try {
      result = await bookingLifecycle.proposeBookingTime({
        booking,
        actorId: userId,
        actorType: 'helper',
        date,
        start,
        end,
        note,
      });
    } catch (e) {
      return bad(
        res,
        e.status || 409,
        e.message || `Cannot propose: ${e.code}`,
        e.code || 'invalid_status',
      );
    }

    const updated = result.booking;
    const actorName =
      [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || 'Provider';
    await postStatusToThread({
      booking: updated,
      event: 'counter_proposed',
      actorId: userId,
      actorName,
      reason: note || '',
    });

    return res.json({
      success: true,
      booking: toPublicBookingRequestCard(updated),
    });
  } catch (err) {
    next(err);
  }
};

exports.createChatBookingRequest = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_error');

    const body = req.body || {};
    const conversationId = body.conversationId || body.conversation_id || null;
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      return bad(res, 400, 'clientRequestId must be a valid UUID', 'validation_failed');
    }
    if (!conversationId) {
      return bad(res, 400, 'conversationId is required', 'validation_failed');
    }

    const conv = await assertConversationParticipant(userId, conversationId, { writable: true });
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

    // The messenger picker commits to a concrete time: verify it is truly free
    // before the request exists.
    const slotCheck = await bookingLifecycle.validateBookingSlot({
      helperId: businessId ? null : helperId,
      businessId: businessId || null,
      date,
      start,
      end,
    });
    if (!slotCheck.ok) {
      return bad(res, 409, slotCheck.message || 'Requested time is not available', slotCheck.code, {
        reason: slotCheck.reason,
      });
    }
    const timezone = String(body.timezone || '').trim().slice(0, 80) || null;
    const description = String(body.description || '').trim().slice(0, 2000) || null;
    const source = String(body.source || 'messenger_inbox_schedule').trim().slice(0, 64);
    const hours = 24;

    // Provider scheduling on behalf of customer → counter_proposed (customer Accept/Decline).
    // Customer-originated requests stay pending for the provider.
    const initialStatus = isProvider ? 'counter_proposed' : 'pending';
    let booking = null;
    let replayed = false;
    if (clientRequestId) {
      const existing = await pool.query(
        'SELECT * FROM booking_requests WHERE conversation_id = $1 AND client_request_id = $2',
        [conversationId, clientRequestId],
      );
      booking = existing.rows[0] || null;
      replayed = Boolean(booking);
    }

    if (!booking) {
      const bookingId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
      const { rows } = await pool.query(
        `INSERT INTO booking_requests (
         id, customer_id, helper_id, business_id, service_name, requested_date,
         requested_start_time, requested_end_time, service_location,
         description, expires_at, confirmation_hours,
         conversation_id, guest_session_id, source, service_id, timezone, status,
         client_request_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, $11,
         $12, NULL, $13, $14, $15, $16, $17
       )
       ON CONFLICT (conversation_id, client_request_id)
       WHERE client_request_id IS NOT NULL DO NOTHING
       RETURNING *`,
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
          initialStatus,
          clientRequestId,
        ],
      );
      booking = rows[0] || null;
      if (!booking && clientRequestId) {
        const replay = await pool.query(
          'SELECT * FROM booking_requests WHERE conversation_id = $1 AND client_request_id = $2',
          [conversationId, clientRequestId],
        );
        booking = replay.rows[0] || null;
        replayed = true;
      }
    }
    if (!booking) throw new Error('Failed to create booking request');

    const actorName =
      [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') ||
      (isProvider ? 'Provider' : 'Customer');
    await postStatusToThread({
      booking,
      event: booking.status === 'counter_proposed' ? 'counter_proposed' : 'requested',
      actorId: userId,
      actorName,
      clientMessageId: clientRequestId,
    });
    if (!replayed) await bookingLifecycle.emitBookingEvent({ booking, event: 'requested', actorId: userId });

    if (!replayed) try {
      socketService.broadcastToUser(helperId, 'booking:requested', { booking });
      if (customerId && String(customerId) !== String(userId)) {
        socketService.broadcastToUser(customerId, 'booking:requested', { booking });
      }
    } catch { /* ignore */ }

    const responseDate = booking.requested_date || date;
    const responseStart = booking.requested_start_time || start;
    const responseEnd = booking.requested_end_time || end;
    return res.status(replayed ? 200 : 201).json({
      success: true,
      booking: toPublicBookingRequestCard(booking),
      marker: buildBookingRequestMarker({
        id: booking.id,
        status: booking.status,
        date: responseDate,
        start: responseStart,
        end: responseEnd,
        serviceName: booking.service_name || serviceName,
        serviceId: booking.service_id || serviceId,
      }),
      idempotent: replayed,
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
  clientRequestId = null,
  source = 'messenger_picker',
  conversationId = null,
}) {
  if (guestSessionId && clientRequestId) {
    const existing = await pool.query(
      `SELECT * FROM booking_requests
        WHERE guest_session_id = $1 AND client_request_id = $2
        LIMIT 1`,
      [guestSessionId, clientRequestId],
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  const bookingId = crypto.randomUUID();
  const hours = 24;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `INSERT INTO booking_requests (
       id, customer_id, helper_id, business_id, service_name, requested_date,
       requested_start_time, requested_end_time, service_location,
       description, expires_at, confirmation_hours,
       conversation_id, guest_session_id, appointment_id, source, service_id, timezone, client_request_id
     ) VALUES (
       $1, NULL, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17
     )
     ON CONFLICT (guest_session_id, client_request_id)
     WHERE guest_session_id IS NOT NULL AND client_request_id IS NOT NULL DO NOTHING
     RETURNING *`,
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
      clientRequestId,
    ],
  );
  if (rows[0]) return rows[0];
  if (guestSessionId && clientRequestId) {
    const replay = await pool.query(
      `SELECT * FROM booking_requests
        WHERE guest_session_id = $1 AND client_request_id = $2
        LIMIT 1`,
      [guestSessionId, clientRequestId],
    );
    return replay.rows[0] || null;
  }
  return null;
};

exports.buildBookingRequestMarker = buildBookingRequestMarker;
exports.parseBookingRequestMarker = parseBookingRequestMarker;
exports.toPublicBookingRequestCard = toPublicBookingRequestCard;
exports.toChatStatus = toChatStatus;

/** Used by calendar bookings controller for cross-surface chat status posts. */
exports.postStatusToThreadForLifecycle = postStatusToThread;
