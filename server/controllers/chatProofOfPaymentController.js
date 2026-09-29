'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');
const { uploadFile, getSignedDownloadUrl } = require('../utils/storage');
const {
  assertConversationParticipant,
  assertGuestInquiryAccess,
  assertBusinessAccess,
  resolveGuestFromRequest,
  isProviderOnConversation,
} = require('../services/chatThreadAccess');
const {
  CONFIRM_ACTIONS,
  ALLOWED_POP_MIMES,
  buildPopMarker,
  buildPopShareContent,
  normalizePopPayload,
  toPublicPopCard,
  redactPopForLog,
} = require('../services/chatProofOfPayment');
const { mirrorLegacyMessage } = require('../services/businessConversationSync');
const { enqueueConversationMessageNotifications } = require('../services/messageNotificationService');
const { withTransaction } = require('../utils/transaction');

function bad(res, status, error, code) {
  return res.status(status).json({ error, code: code || 'error' });
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
    if (!messageRow) throw new Error('Failed to create proof-of-payment chat message');
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
  }, 'chat_proof_of_payment_message');
  if (replayed) return { ...messageRow, sender_name: senderName };
  const message = { ...messageRow, sender_name: senderName };
  socketService.broadcastToConversation(conversationId, 'message:new', { conversationId, message });
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
    logger.warn('[chatProofOfPayment] business mirror failed', { error: err.message });
  }
  return message;
}

async function postGuestMessage({ guestSessionId, senderName, content, helperId, senderType = 'helper', clientMessageId }) {
  const { rows } = await pool.query(
    `INSERT INTO guest_profile_chat_messages
       (session_id, sender_type, sender_name, message, client_message_id, created_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (session_id, client_message_id)
     WHERE client_message_id IS NOT NULL DO NOTHING
     RETURNING id, session_id, sender_type, sender_name, message, created_at`,
    [guestSessionId, senderType, senderName, content, clientMessageId || null],
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
  if (!msg) throw new Error('Failed to create proof-of-payment guest message');
  if (rows.length === 0) return msg;
  const createdAt = msg.created_at instanceof Date ? msg.created_at.toISOString() : msg.created_at;
  try {
    socketService.io?.to?.(`guest_session_${guestSessionId}`)?.emit?.('profile_chat:new_message', {
      guestInquiry: true,
      guestSessionId,
      message: {
        id: msg.id,
        content,
        sender_type: senderType,
        sender_name: senderName,
        created_at: createdAt,
      },
      senderName,
    });
    if (helperId) {
      socketService.broadcastToUser(helperId, 'profile_chat:new_message', {
        guestInquiry: true,
        guestSessionId,
        message: {
          id: msg.id,
          content,
          sender_type: senderType,
          sender_name: senderName,
          created_at: createdAt,
        },
        senderName,
      });
    }
  } catch (e) {
    logger.warn('[chatPop] guest socket emit failed', { error: e.message });
  }
  return msg;
}

async function loadPop(id) {
  const { rows } = await pool.query('SELECT * FROM chat_proof_of_payments WHERE id = $1', [id]);
  return rows[0] || null;
}

async function assertCanViewPop(req, pop) {
  const userId = req.user?.id;
  const guest = await resolveGuestFromRequest(req);
  if (userId && pop.conversation_id) {
    const conv = await assertConversationParticipant(userId, pop.conversation_id);
    if (conv) return { ok: true, role: isProviderOnConversation(userId, conv) ? 'provider' : 'customer', conv };
  }
  if (userId && pop.guest_session_id) {
    const g = await assertGuestInquiryAccess(userId, pop.guest_session_id);
    if (g) return { ok: true, role: 'provider', guestInquiry: g };
  }
  if (userId && pop.business_id) {
    const biz = await assertBusinessAccess(userId, pop.business_id);
    if (biz) return { ok: true, role: 'provider' };
  }
  if (userId && pop.helper_id && String(pop.helper_id) === String(userId)) {
    return { ok: true, role: 'provider' };
  }
  if (userId && pop.submitted_by && String(pop.submitted_by) === String(userId)) {
    return { ok: true, role: 'submitter' };
  }
  if (guest && pop.guest_session_id && String(guest.id) === String(pop.guest_session_id)) {
    return { ok: true, role: 'guest', guest };
  }
  return { ok: false };
}

exports.sharePop = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const guest = await resolveGuestFromRequest(req);
    if (!userId && !guest) return bad(res, 401, 'Authentication required', 'auth_required');

    const conversationId = req.body.conversationId || req.body.conversation_id || null;
    const guestSessionId = req.body.guestSessionId || req.body.guest_session_id || null;
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      return bad(res, 400, 'clientRequestId must be a valid UUID', 'validation_failed');
    }
    if (!conversationId && !guestSessionId) {
      return bad(res, 400, 'conversationId or guestSessionId required', 'validation_failed');
    }

    const normalized = normalizePopPayload({
      ...req.body,
      hasFile: Boolean(req.file),
      attachment_key: req.body.attachment_key || req.body.attachmentKey,
    });
    if (normalized.error) return bad(res, 400, normalized.error, 'validation_failed');

    let helperId = null;
    let businessId = req.body.businessId || req.body.business_id || null;
    let conversationParticipants = null;
    let senderName = req.user
      ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Member'
      : guest?.guest_name || 'Guest';

    if (conversationId) {
      if (!userId) return bad(res, 401, 'Sign in to share on this conversation', 'auth_required');
      const conv = await assertConversationParticipant(userId, conversationId, { writable: true });
      if (!conv) return bad(res, 403, 'Not a conversation participant', 'forbidden');
      conversationParticipants = [conv.customer_id, conv.helper_id];
      helperId = conv.helper_id;
      businessId = businessId || conv.business_id;
    } else if (guestSessionId) {
      if (userId) {
        const guestInquiry = await assertGuestInquiryAccess(userId, guestSessionId);
        if (!guestInquiry) return bad(res, 403, 'Not allowed for this guest inquiry', 'forbidden');
        helperId = guestInquiry.helper_id;
        businessId = businessId || guestInquiry.business_id;
      } else if (guest && String(guest.id) === String(guestSessionId)) {
        helperId = guest.helper_id;
        businessId = businessId || guest.business_id;
      } else {
        return bad(res, 403, 'Guest session mismatch', 'forbidden');
      }
    }

    let pop = null;
    let replayed = false;
    if (clientRequestId) {
      const existing = userId
        ? await pool.query(
          'SELECT * FROM chat_proof_of_payments WHERE submitted_by = $1 AND client_request_id = $2',
          [userId, clientRequestId],
        )
        : await pool.query(
          `SELECT * FROM chat_proof_of_payments
            WHERE submitted_by IS NULL AND guest_session_id = $1 AND client_request_id = $2`,
          [guestSessionId, clientRequestId],
        );
      pop = existing.rows[0] || null;
      replayed = Boolean(pop);
    }

    let attachmentKey = req.body.attachment_key || req.body.attachmentKey || null;
    let attachmentName = req.body.attachment_name || req.body.attachmentName || null;
    let attachmentMime = req.body.attachment_mime || req.body.attachmentMime || null;
    let attachmentSize = req.body.attachment_size || req.body.attachmentSize || null;

    if (req.file && !pop) {
      if (!ALLOWED_POP_MIMES.has(req.file.mimetype)) {
        return bad(res, 400, 'File type not allowed for proof of payment', 'invalid_file_type');
      }
      const key = await uploadFile(req.file.buffer, 'chat-pop', req.file.originalname, req.file.mimetype);
      if (key) {
        attachmentKey = key;
        attachmentName = req.file.originalname;
        attachmentMime = req.file.mimetype;
        attachmentSize = req.file.size;
      } else {
        return bad(res, 503, 'File storage unavailable', 'storage_unavailable');
      }
    }

    if (!pop) {
      const { rows } = await pool.query(
        `INSERT INTO chat_proof_of_payments (
           conversation_id, guest_session_id, business_id, helper_id,
           quote_kind, quote_id, booking_request_id,
           amount_cents, currency, payment_method, transaction_id, paid_on, notes,
           attachment_key, attachment_name, attachment_mime, attachment_size,
           submitted_by, submitted_by_guest, status, client_request_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'submitted',$20
         )
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          conversationId,
          guestSessionId,
          businessId,
          helperId || null,
          normalized.quoteKind,
          normalized.quoteId,
          normalized.bookingRequestId,
          normalized.amountCents,
          normalized.currency,
          normalized.paymentMethod,
          normalized.transactionId,
          normalized.paidOn,
          normalized.notes,
          attachmentKey,
          attachmentName,
          attachmentMime,
          attachmentSize,
          userId || null,
          Boolean(guest && !userId),
          clientRequestId,
        ],
      );
      pop = rows[0] || null;
      if (!pop && clientRequestId) {
        const replay = userId
          ? await pool.query(
            'SELECT * FROM chat_proof_of_payments WHERE submitted_by = $1 AND client_request_id = $2',
            [userId, clientRequestId],
          )
          : await pool.query(
            `SELECT * FROM chat_proof_of_payments
              WHERE submitted_by IS NULL AND guest_session_id = $1 AND client_request_id = $2`,
            [guestSessionId, clientRequestId],
          );
        pop = replay.rows[0] || null;
        replayed = true;
      }
    }
    if (!pop) throw new Error('Failed to create proof of payment');
    const marker = buildPopMarker({
      id: pop.id,
      status: pop.status,
      amountCents: pop.amount_cents,
      paymentMethod: pop.payment_method,
      transactionId: pop.transaction_id,
      paidOn: pop.paid_on,
      quoteKind: pop.quote_kind,
      quoteId: pop.quote_id,
    });
    const content = buildPopShareContent({
      marker,
      amountCents: pop.amount_cents,
      paymentMethod: pop.payment_method,
      preface: req.body.preface,
    });

    let message = null;
    const messageConversationId = replayed ? pop.conversation_id : conversationId;
    const messageGuestSessionId = replayed ? pop.guest_session_id : guestSessionId;
    const messageHelperId = replayed ? pop.helper_id : helperId;
    if (messageConversationId) {
      message = await postConversationMessage({
        conversationId: messageConversationId,
        senderId: userId,
        content,
        senderName,
        businessId: replayed ? pop.business_id : businessId,
        clientMessageId: clientRequestId,
        recipientIds: conversationParticipants || [pop.customer_id, pop.helper_id],
      });
      await pool.query('UPDATE chat_proof_of_payments SET message_id = $1, updated_at = NOW() WHERE id = $2', [
        String(message.id),
        pop.id,
      ]);
    } else if (messageGuestSessionId) {
      const senderType = pop.submitted_by_guest ? 'guest' : userId ? 'helper' : 'guest';
      message = await postGuestMessage({
        guestSessionId: messageGuestSessionId,
        senderName,
        content,
        helperId: messageHelperId,
        senderType,
        clientMessageId: clientRequestId,
      });
      await pool.query('UPDATE chat_proof_of_payments SET message_id = $1, updated_at = NOW() WHERE id = $2', [
        String(message.id),
        pop.id,
      ]);
    }

    logger.info('[chatPop] shared', { pop: redactPopForLog(pop) });
    return res.status(replayed ? 200 : 201).json({
      pop: toPublicPopCard(pop),
      message,
      marker,
      idempotent: replayed,
    });
  } catch (err) {
    next(err);
  }
};

exports.getPop = async (req, res, next) => {
  try {
    const pop = await loadPop(req.params.id);
    if (!pop) return bad(res, 404, 'Proof of payment not found', 'not_found');
    const access = await assertCanViewPop(req, pop);
    if (!access.ok) return bad(res, 403, 'Not allowed to view this proof of payment', 'forbidden');
    return res.json(toPublicPopCard(pop));
  } catch (err) {
    next(err);
  }
};

exports.downloadPop = async (req, res, next) => {
  try {
    const pop = await loadPop(req.params.id);
    if (!pop) return bad(res, 404, 'Proof of payment not found', 'not_found');
    const access = await assertCanViewPop(req, pop);
    if (!access.ok) return bad(res, 403, 'Not allowed to download', 'forbidden');
    if (!pop.attachment_key) return bad(res, 404, 'No attachment on this proof of payment', 'no_attachment');
    const url = await getSignedDownloadUrl(pop.attachment_key, 600);
    if (!url) return bad(res, 503, 'Download unavailable', 'storage_unavailable');
    return res.json({
      url,
      name: pop.attachment_name,
      mimeType: pop.attachment_mime,
      size: pop.attachment_size,
      expiresIn: 600,
    });
  } catch (err) {
    next(err);
  }
};

exports.confirmPop = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_required');
    const action = String(req.body?.action || '').toLowerCase();
    if (!CONFIRM_ACTIONS.has(action)) {
      return bad(res, 400, 'action must be confirm or reject', 'validation_failed');
    }
    const pop = await loadPop(req.params.id);
    if (!pop) return bad(res, 404, 'Proof of payment not found', 'not_found');
    if (pop.status !== 'submitted') {
      return bad(res, 409, 'Proof of payment already resolved', 'invalid_status');
    }

    let allowed = false;
    let conversationParticipants = null;
    if (pop.conversation_id) {
      const conv = await assertConversationParticipant(userId, pop.conversation_id, { writable: true });
      conversationParticipants = conv ? [conv.customer_id, conv.helper_id] : null;
      if (conv && isProviderOnConversation(userId, conv)) allowed = true;
      if (conv && conv.business_id) {
        const biz = await assertBusinessAccess(userId, conv.business_id);
        if (biz) allowed = true;
      }
    }
    if (pop.guest_session_id) {
      const g = await assertGuestInquiryAccess(userId, pop.guest_session_id);
      if (g) allowed = true;
    }
    if (pop.helper_id && String(pop.helper_id) === String(userId)) allowed = true;
    if (pop.business_id) {
      const biz = await assertBusinessAccess(userId, pop.business_id);
      if (biz) allowed = true;
    }
    if (!allowed) return bad(res, 403, 'Only the provider can confirm or reject', 'forbidden');

    const nextStatus = action === 'confirm' ? 'confirmed' : 'rejected';
    const reason = action === 'reject' ? String(req.body?.reason || '').trim().slice(0, 1000) : null;
    const { rows } = await pool.query(
      `UPDATE chat_proof_of_payments
          SET status = $1, confirmed_by = $2, confirmed_at = NOW(),
              reject_reason = $3, updated_at = NOW()
        WHERE id = $4 RETURNING *`,
      [nextStatus, userId, reason, pop.id],
    );
    const updated = rows[0];
    const marker = buildPopMarker({
      id: updated.id,
      status: updated.status,
      amountCents: updated.amount_cents,
      paymentMethod: updated.payment_method,
      transactionId: updated.transaction_id,
      paidOn: updated.paid_on,
      quoteKind: updated.quote_kind,
      quoteId: updated.quote_id,
    });
    const statusContent = `Proof of payment ${nextStatus}${reason ? `: ${reason}` : ''}\n${marker}`;
    const displayName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Provider';

    if (updated.conversation_id) {
      await postConversationMessage({
        conversationId: updated.conversation_id,
        senderId: userId,
        content: statusContent,
        senderName: displayName,
        businessId: updated.business_id,
        recipientIds: conversationParticipants || [updated.customer_id, updated.helper_id],
      });
    } else if (updated.guest_session_id) {
      await postGuestMessage({
        guestSessionId: updated.guest_session_id,
        senderName: displayName,
        content: statusContent,
        helperId: updated.helper_id,
        senderType: 'helper',
      });
    }

    return res.json({ pop: toPublicPopCard(updated) });
  } catch (err) {
    next(err);
  }
};
