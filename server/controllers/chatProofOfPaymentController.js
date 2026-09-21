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

function bad(res, status, error, code) {
  return res.status(status).json({ error, code: code || 'error' });
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
  socketService.broadcastToConversation(conversationId, 'message:new', { conversationId, message });
  socketService.broadcastToConversation(conversationId, 'profile_chat:new_message', {
    conversationId,
    message,
    senderName,
  });
  return message;
}

async function postGuestMessage({ guestSessionId, senderName, content, helperId, senderType = 'helper' }) {
  const { rows } = await pool.query(
    `INSERT INTO guest_profile_chat_messages
       (session_id, sender_type, sender_name, message, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     RETURNING id, session_id, sender_type, sender_name, message, created_at`,
    [guestSessionId, senderType, senderName, content],
  );
  const msg = rows[0];
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
    let senderName = req.user
      ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Member'
      : guest?.guest_name || 'Guest';

    if (conversationId) {
      if (!userId) return bad(res, 401, 'Sign in to share on this conversation', 'auth_required');
      const conv = await assertConversationParticipant(userId, conversationId);
      if (!conv) return bad(res, 403, 'Not a conversation participant', 'forbidden');
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

    let attachmentKey = req.body.attachment_key || req.body.attachmentKey || null;
    let attachmentName = req.body.attachment_name || req.body.attachmentName || null;
    let attachmentMime = req.body.attachment_mime || req.body.attachmentMime || null;
    let attachmentSize = req.body.attachment_size || req.body.attachmentSize || null;

    if (req.file) {
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

    const { rows } = await pool.query(
      `INSERT INTO chat_proof_of_payments (
         conversation_id, guest_session_id, business_id, helper_id,
         quote_kind, quote_id, booking_request_id,
         amount_cents, currency, payment_method, transaction_id, paid_on, notes,
         attachment_key, attachment_name, attachment_mime, attachment_size,
         submitted_by, submitted_by_guest, status
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'submitted'
       ) RETURNING *`,
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
      ],
    );
    const pop = rows[0];
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
    if (conversationId) {
      message = await postConversationMessage({
        conversationId,
        senderId: userId,
        content,
        senderName,
      });
      await pool.query('UPDATE chat_proof_of_payments SET message_id = $1, updated_at = NOW() WHERE id = $2', [
        String(message.id),
        pop.id,
      ]);
    } else if (guestSessionId) {
      const senderType = userId ? 'helper' : 'guest';
      message = await postGuestMessage({
        guestSessionId,
        senderName,
        content,
        helperId,
        senderType,
      });
      await pool.query('UPDATE chat_proof_of_payments SET message_id = $1, updated_at = NOW() WHERE id = $2', [
        String(message.id),
        pop.id,
      ]);
    }

    logger.info('[chatPop] shared', { pop: redactPopForLog(pop) });
    return res.status(201).json({
      pop: toPublicPopCard(pop),
      message,
      marker,
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
    if (pop.conversation_id) {
      const conv = await assertConversationParticipant(userId, pop.conversation_id);
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
