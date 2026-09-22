'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');
const guestProfileVerify = require('../services/guestProfileChatVerification');
const {
  QUOTE_KINDS,
  RESPOND_ACTIONS,
  toDbAcceptStatus,
  canRespond,
  isQuoteExpired,
  buildQuoteMarker,
  buildShareMessageContent,
  buildRequestChangesMessage,
  newQuoteToken,
  normalizeLineItems,
  calculateTotals,
  toPublicQuoteCard,
  toChatStatus,
} = require('../services/chatQuotes');
const { checkScheduleAgreementGate } = require('../services/chatAgreements');


function bad(res, status, error, code, extra = {}) {
  return res.status(status).json({ error, code: code || 'error', ...extra });
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

async function loadQuote(kind, id) {
  if (kind === 'business') {
    const { rows } = await pool.query('SELECT * FROM business_quotes WHERE id = $1', [id]);
    return rows[0] || null;
  }
  const { rows } = await pool.query('SELECT * FROM helper_quotes WHERE id = $1', [id]);
  return rows[0] || null;
}

async function assertProviderAccess(userId, { kind, businessId, helperId, conversationId, guestSessionId }) {
  if (kind === 'business') {
    if (!businessId) return { ok: false, status: 400, error: 'businessId is required' };
    const { rows } = await pool.query(
      `SELECT b.id, b.user_id, b.business_name
         FROM businesses b
        WHERE b.id = $1 AND b.is_active = TRUE
          AND (
            b.user_id = $2
            OR EXISTS (
              SELECT 1 FROM business_members bm
               WHERE bm.business_id = b.id AND bm.member_id = $2 AND bm.status = 'active'
            )
          )`,
      [businessId, userId],
    ).catch(() => ({ rows: [] }));
    if (!rows[0]) return { ok: false, status: 403, error: 'Not allowed for this business' };
    return { ok: true, business: rows[0], helperId: rows[0].user_id };
  }

  // helper kind
  const hid = helperId || userId;
  if (String(hid) !== String(userId)) {
    return { ok: false, status: 403, error: 'Not allowed to share helper quotes for another user' };
  }
  return { ok: true, helperId: hid };
}

async function assertConversationParticipant(userId, conversationId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.customer_id, c.helper_id, c.business_id, c.job_id
       FROM conversations c
      WHERE c.id = $1 AND (
        c.customer_id = $2 OR c.helper_id = $2
        OR (c.business_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM business_members bm
           WHERE bm.business_id = c.business_id AND bm.member_id = $2 AND bm.status = 'active'
        ))
      )`,
    [conversationId, userId],
  );
  return rows[0] || null;
}

async function assertGuestInquiryAccess(userId, guestSessionId) {
  const { rows } = await pool.query(
    `SELECT g.* FROM guest_profile_chat_inbound g
      WHERE g.id = $1
        AND (
          g.helper_id = $2
          OR (g.business_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM businesses b WHERE b.id = g.business_id AND b.user_id = $2
          ))
          OR (g.business_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM business_members bm
             WHERE bm.business_id = g.business_id AND bm.member_id = $2 AND bm.status = 'active'
          ))
        )`,
    [guestSessionId, userId],
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

async function postConversationMessage({
  conversationId,
  senderId,
  content,
  senderName,
  isProfileChat,
  clientMessageId = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, sender_id, content, message_type, client_message_id)
     VALUES ($1, $2, $3, 'text', $4)
     ON CONFLICT (conversation_id, client_message_id)
     WHERE client_message_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [conversationId, senderId, content, clientMessageId],
  );
  let messageRow = rows[0];
  const replayed = !messageRow && Boolean(clientMessageId);
  if (!messageRow && clientMessageId) {
    const replay = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 AND client_message_id = $2',
      [conversationId, clientMessageId],
    );
    messageRow = replay.rows[0];
  }
  if (!messageRow) throw new Error('Failed to create quote chat message');
  if (replayed) return { ...messageRow, sender_name: senderName };
  await pool.query(
    'UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
    [conversationId],
  );
  const message = { ...messageRow, sender_name: senderName };
  socketService.broadcastToConversation(conversationId, 'message:new', {
    conversationId,
    message,
  });
  if (isProfileChat !== false) {
    socketService.broadcastToConversation(conversationId, 'profile_chat:new_message', {
      conversationId,
      message,
      senderName,
    });
  }
  return message;
}

async function postGuestMessage({ guestSessionId, senderName, content, helperId, clientMessageId = null }) {
  const { rows } = await pool.query(
    `INSERT INTO guest_profile_chat_messages
       (session_id, sender_type, sender_name, message, client_message_id, created_at)
     VALUES ($1, 'helper', $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (session_id, client_message_id)
     WHERE client_message_id IS NOT NULL DO NOTHING
     RETURNING id, session_id, sender_type, sender_name, message, created_at`,
    [guestSessionId, senderName, content, clientMessageId],
  );
  let msg = rows[0];
  const replayed = !msg && Boolean(clientMessageId);
  if (!msg && clientMessageId) {
    const replay = await pool.query(
      `SELECT id, session_id, sender_type, sender_name, message, created_at
         FROM guest_profile_chat_messages
        WHERE session_id = $1 AND client_message_id = $2`,
      [guestSessionId, clientMessageId],
    );
    msg = replay.rows[0];
  }
  if (!msg) throw new Error('Failed to create guest quote message');
  if (replayed) return msg;
  const createdAt = msg.created_at instanceof Date ? msg.created_at.toISOString() : msg.created_at;
  try {
    if (typeof socketService.broadcastGuestChatMessage === 'function') {
      socketService.broadcastGuestChatMessage(guestSessionId, {
        messageId: msg.id,
        senderType: 'helper',
        senderName,
        message: content,
        createdAt,
      });
    }
  } catch {
    /* optional */
  }
  try {
    socketService.io?.to?.(`guest_session_${guestSessionId}`)?.emit?.('profile_chat:new_message', {
      guestInquiry: true,
      guestSessionId,
      message: {
        id: msg.id,
        content,
        sender_type: 'helper',
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
          sender_type: 'helper',
          sender_name: senderName,
          created_at: createdAt,
        },
        senderName,
      });
    }
  } catch (e) {
    logger.warn('[chatQuotes] guest socket emit failed', { error: e.message });
  }
  return msg;
}

async function emitQuoteStatusToThread({ conversationId, guestSessionId, helperId, customerId, content, meta }) {
  const payload = {
    conversationId: conversationId || null,
    guestSessionId: guestSessionId || null,
    guestInquiry: Boolean(guestSessionId),
    message: {
      content,
      sender_type: 'system',
      sender_name: 'OxSteed',
      ...meta,
    },
    quoteEvent: true,
    ...meta,
  };
  try {
    if (conversationId) {
      socketService.broadcastToConversation(conversationId, 'profile_chat:new_message', payload);
      socketService.broadcastToConversation(conversationId, 'message:new', payload);
    }
    if (guestSessionId) {
      socketService.io?.to?.(`guest_session_${guestSessionId}`)?.emit?.('profile_chat:new_message', payload);
    }
    if (helperId) socketService.broadcastToUser(helperId, 'profile_chat:new_message', payload);
    if (customerId) socketService.broadcastToUser(customerId, 'profile_chat:new_message', payload);
  } catch (e) {
    logger.warn('[chatQuotes] status emit failed', { error: e.message });
  }
}

/**
 * POST /api/chat/quotes/share
 */
exports.shareQuote = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_error');

    const body = req.body || {};
    const kind = String(body.kind || body.quoteKind || '').toLowerCase();
    if (!QUOTE_KINDS.has(kind)) return bad(res, 400, 'kind must be business or helper', 'validation_failed');
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      return bad(res, 400, 'clientRequestId must be a valid UUID', 'validation_failed');
    }

    const conversationId = body.conversationId || body.conversation_id || null;
    const guestSessionId = body.guestSessionId || body.guest_session_id || null;
    if (!conversationId && !guestSessionId) {
      return bad(res, 400, 'conversationId or guestSessionId is required', 'validation_failed');
    }

    const businessId = body.businessId ?? body.business_id ?? null;
    let helperId = body.helperId || body.helper_id || null;

    if (conversationId) {
      const conv = await assertConversationParticipant(userId, conversationId);
      if (!conv) return bad(res, 403, 'Not a participant of this conversation', 'forbidden');
      helperId = helperId || conv.helper_id;
      if (kind === 'business' && !businessId && conv.business_id) {
        body.businessId = conv.business_id;
      }
    }
    if (guestSessionId) {
      const guest = await assertGuestInquiryAccess(userId, guestSessionId);
      if (!guest) return bad(res, 403, 'Not allowed for this guest inquiry', 'forbidden');
      helperId = helperId || guest.helper_id;
      if (kind === 'business' && !businessId && guest.business_id) {
        body.businessId = guest.business_id;
      }
    }

    const access = await assertProviderAccess(userId, {
      kind,
      businessId: body.businessId ?? businessId,
      helperId: helperId || userId,
      conversationId,
      guestSessionId,
    });
    if (!access.ok) return bad(res, access.status, access.error, 'forbidden');

    if (clientRequestId) {
      const { rows: existingShares } = await pool.query(
        `SELECT * FROM chat_quote_shares
          WHERE shared_by = $1 AND client_request_id = $2
          LIMIT 1`,
        [userId, clientRequestId],
      );
      const existingShare = existingShares[0];
      if (existingShare) {
        const existingQuote = await loadQuote(kind, existingShare.quote_id);
        if (existingQuote) {
          const existingCard = toPublicQuoteCard(kind, existingQuote);
          const existingMarker = buildQuoteMarker({
            kind,
            id: existingQuote.id,
            token: existingQuote.token,
            status: existingQuote.status,
            totalCents: existingQuote.total_cents,
            title: existingQuote.title || existingCard.title,
            validUntil: existingQuote.valid_until,
            version: existingQuote.version,
          });
          return res.status(200).json({
            quote: existingCard,
            marker: existingMarker,
            message: existingShare.message_id ? { id: existingShare.message_id } : null,
            idempotent: true,
          });
        }
      }
    }

    let quote = null;
    let quoteId = body.quoteId || body.quote_id || null;

    if (quoteId) {
      quote = await loadQuote(kind, quoteId);
      if (!quote) return bad(res, 404, 'Quote not found', 'not_found');
      if (kind === 'business' && String(quote.business_id) !== String(body.businessId ?? businessId)) {
        return bad(res, 403, 'Quote does not belong to this business', 'forbidden');
      }
      if (kind === 'helper' && String(quote.helper_id) !== String(access.helperId || userId)) {
        return bad(res, 403, 'Quote does not belong to this helper', 'forbidden');
      }
    } else {
      // Create from line items
      const normalized = normalizeLineItems(body.line_items || body.lineItems);
      if (normalized.error) return bad(res, 400, normalized.error, 'validation_failed');
      const taxRate = Number(body.tax_rate ?? body.taxRate ?? 0);
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
        return bad(res, 400, 'Tax rate must be between 0 and 100', 'validation_failed');
      }
      const { subtotal, tax, total } = calculateTotals(normalized.items, taxRate);
      const title = String(body.title || 'Service quote').trim().slice(0, 300);
      const validUntil = body.valid_until || body.validUntil || null;
      const clientName = String(body.client_name || body.clientName || 'Customer').trim().slice(0, 200);
      const clientEmail = String(body.client_email || body.clientEmail || '').trim().slice(0, 255) || null;
      const token = newQuoteToken();

      if (kind === 'business') {
        const bid = body.businessId ?? businessId;
        if (clientRequestId) {
          const { rows: existingQuotes } = await pool.query(
            'SELECT * FROM business_quotes WHERE business_id = $1 AND client_request_id = $2 LIMIT 1',
            [bid, clientRequestId],
          );
          quote = existingQuotes[0] || null;
          quoteId = quote?.id || null;
        }
        if (!quote) {
          const { rows } = await pool.query(
            `INSERT INTO business_quotes
             (business_id, client_name, client_email, title, line_items, subtotal_cents, tax_rate, total_cents,
              valid_until, token, status, conversation_id, guest_session_id, created_by, version, client_request_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sent',$11,$12,$13,1,$14)
             ON CONFLICT (business_id, client_request_id)
             WHERE client_request_id IS NOT NULL DO NOTHING
             RETURNING *`,
            [
              bid, clientName, clientEmail, title, JSON.stringify(normalized.items),
              subtotal, taxRate, total, validUntil, token,
              conversationId, guestSessionId, userId, clientRequestId,
            ],
          );
          quote = rows[0] || null;
          if (!quote && clientRequestId) {
            const { rows: replay } = await pool.query(
              'SELECT * FROM business_quotes WHERE business_id = $1 AND client_request_id = $2 LIMIT 1',
              [bid, clientRequestId],
            );
            quote = replay[0] || null;
            quoteId = quote?.id || null;
          }
        }
      } else {
        const hid = access.helperId || userId;
        if (clientRequestId) {
          const { rows: existingQuotes } = await pool.query(
            'SELECT * FROM helper_quotes WHERE helper_id = $1 AND client_request_id = $2 LIMIT 1',
            [hid, clientRequestId],
          );
          quote = existingQuotes[0] || null;
          quoteId = quote?.id || null;
        }
        if (!quote) {
          const { rows } = await pool.query(
            `INSERT INTO helper_quotes
             (job_id, helper_id, line_items, tax_rate, subtotal_cents, tax_cents, total_cents,
              notes, status, valid_until, conversation_id, guest_session_id, client_user_id,
              client_name, client_email, title, token, version, client_request_id)
           VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,'sent',$9,$10,$11,$12,$13,$14,$15,$16,1,$17)
           ON CONFLICT (helper_id, client_request_id)
           WHERE client_request_id IS NOT NULL DO NOTHING
           RETURNING *`,
            [
              body.job_id || body.jobId || null,
              hid,
              JSON.stringify(normalized.items),
              taxRate / 100, // helper table historically stores 0–1
              subtotal, tax, total,
              body.notes || null,
              validUntil,
              conversationId, guestSessionId,
              body.client_user_id || body.clientUserId || null,
              clientName, clientEmail, title, token, clientRequestId,
            ],
          );
          quote = rows[0] || null;
          if (!quote && clientRequestId) {
            const { rows: replay } = await pool.query(
              'SELECT * FROM helper_quotes WHERE helper_id = $1 AND client_request_id = $2 LIMIT 1',
              [hid, clientRequestId],
            );
            quote = replay[0] || null;
            quoteId = quote?.id || null;
          }
        }
      }
    }

    // Ensure sent + linkage
    if (kind === 'business') {
      const { rows } = await pool.query(
        `UPDATE business_quotes
            SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
                conversation_id = COALESCE($2, conversation_id),
                guest_session_id = COALESCE($3, guest_session_id),
                updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [quote.id, conversationId, guestSessionId],
      );
      quote = rows[0] || quote;
    } else {
      if (!quote.token) {
        const token = newQuoteToken();
        await pool.query('UPDATE helper_quotes SET token = $2 WHERE id = $1', [quote.id, token]);
        quote.token = token;
      }
      const { rows } = await pool.query(
        `UPDATE helper_quotes
            SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
                conversation_id = COALESCE($2, conversation_id),
                guest_session_id = COALESCE($3, guest_session_id),
                updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [quote.id, conversationId, guestSessionId],
      );
      quote = rows[0] || quote;
    }

    const card = toPublicQuoteCard(kind, quote);
    const marker = buildQuoteMarker({
      kind,
      id: quote.id,
      token: quote.token,
      status: quote.status,
      totalCents: quote.total_cents,
      title: quote.title || card.title,
      validUntil: quote.valid_until,
      version: quote.version,
    });
    const content = buildShareMessageContent({
      marker,
      title: card.title,
      totalCents: card.total_cents,
      tPreface: body.preface || null,
    });

    const senderName =
      (access.business && access.business.business_name) ||
      `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() ||
      'Provider';

    let message = null;
    if (conversationId) {
      const conv = await assertConversationParticipant(userId, conversationId);
      message = await postConversationMessage({
        conversationId,
        senderId: userId,
        content,
        senderName,
        isProfileChat: !conv?.job_id,
        clientMessageId: clientRequestId,
      });
    } else if (guestSessionId) {
      message = await postGuestMessage({
        guestSessionId,
        senderName,
        content,
        helperId: access.helperId || helperId,
        clientMessageId: clientRequestId,
      });
    }

    let shareCreated = true;
    try {
      const { rows: shareRows } = await pool.query(
        `INSERT INTO chat_quote_shares
           (quote_kind, quote_id, conversation_id, guest_session_id, message_id, shared_by, status_at_share, client_request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (shared_by, client_request_id)
         WHERE client_request_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          kind,
          String(quote.id),
          conversationId,
          guestSessionId,
          message?.id != null ? String(message.id) : null,
          userId,
          toChatStatus(kind, quote.status),
          clientRequestId,
        ],
      );
      shareCreated = shareRows.length > 0;
    } catch (e) {
      if (clientRequestId) throw e;
      logger.warn('[chatQuotes] share audit insert failed', { error: e.message });
    }

    return res.status(shareCreated ? 201 : 200).json({
      quote: card,
      marker,
      message,
      content,
      idempotent: !shareCreated,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/chat/quotes/:kind/:id
 */
exports.getQuote = async (req, res, next) => {
  try {
    const kind = String(req.params.kind || '').toLowerCase();
    if (!QUOTE_KINDS.has(kind)) return bad(res, 400, 'Invalid kind');
    const quote = await loadQuote(kind, req.params.id);
    if (!quote) return bad(res, 404, 'Quote not found', 'not_found');

    const token = String(req.query.token || req.headers['x-quote-token'] || '').trim();
    const userId = req.user?.id;
    let allowed = false;

    if (token && quote.token && token === quote.token) allowed = true;
    if (userId) {
      if (kind === 'helper' && String(quote.helper_id) === String(userId)) allowed = true;
      if (kind === 'helper' && quote.client_user_id && String(quote.client_user_id) === String(userId)) allowed = true;
      if (kind === 'business') {
        const access = await assertProviderAccess(userId, { kind, businessId: quote.business_id });
        if (access.ok) allowed = true;
      }
      if (quote.conversation_id) {
        const conv = await assertConversationParticipant(userId, quote.conversation_id);
        if (conv) allowed = true;
      }
    }

    // Verified guest bound to session
    const guest = req.guestSession;
    if (guest && quote.guest_session_id && String(guest.id) === String(quote.guest_session_id)) {
      allowed = true;
    }

    if (!allowed) return bad(res, 403, 'Not allowed to view this quote', 'forbidden');

    // Auto-expire on read
    if (isQuoteExpired(quote) && String(quote.status) === 'sent') {
      const table = kind === 'business' ? 'business_quotes' : 'helper_quotes';
      await pool.query(`UPDATE ${table} SET status = 'expired', updated_at = NOW() WHERE id = $1`, [quote.id]);
      quote.status = 'expired';
    }

    return res.json(toPublicQuoteCard(kind, quote));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/chat/quotes/:kind/:id/respond
 * body: { action: 'accept'|'decline'|'request_changes', reason?, token? }
 */
exports.respondQuote = async (req, res, next) => {
  try {
    const kind = String(req.params.kind || '').toLowerCase();
    if (!QUOTE_KINDS.has(kind)) return bad(res, 400, 'Invalid kind');
    const action = String(req.body?.action || req.body?.response || '').toLowerCase();
    if (!RESPOND_ACTIONS.has(action)) {
      return bad(res, 400, 'action must be accept, decline, or request_changes', 'validation_failed');
    }

    const quote = await loadQuote(kind, req.params.id);
    if (!quote) return bad(res, 404, 'Quote not found', 'not_found');

    const token = String(req.body?.token || req.query.token || '').trim();
    const userId = req.user?.id;
    let guest = req.guestSession || null;
    if (!guest && !userId) {
      const extracted = guestProfileVerify.extractGuestAuth(req);
      if (extracted.token && extracted.sessionId) {
        guest = await guestProfileVerify.loadVerifiedGuestSession(extracted.token, extracted.sessionId);
      }
    }

    let allowed = false;
    if (token && quote.token && token === quote.token) allowed = true;
    if (userId && quote.conversation_id) {
      const conv = await assertConversationParticipant(userId, quote.conversation_id);
      if (conv && String(conv.customer_id) === String(userId)) allowed = true;
    }
    if (userId && kind === 'helper' && quote.client_user_id && String(quote.client_user_id) === String(userId)) {
      allowed = true;
    }
    if (guest && quote.guest_session_id && String(guest.id) === String(quote.guest_session_id)) {
      allowed = true;
    }
    // Guest with matching email on quote
    if (guest?.guest_email && quote.client_email &&
        String(guest.guest_email).toLowerCase() === String(quote.client_email).toLowerCase()) {
      allowed = true;
    }

    if (!allowed) {
      if (!userId && !guest) {
        return bad(res, 401, 'Sign in or verify as guest to respond', 'verify_required');
      }
      return bad(res, 403, 'Not allowed to respond to this quote', 'forbidden');
    }

    const gate = canRespond(quote);
    if (!gate.ok) {
      return bad(res, 409, `Cannot respond: ${gate.reason}`, gate.reason);
    }

    const reason = String(req.body?.reason || '').trim().slice(0, 1000) || null;
    let nextStatus;
    if (action === 'accept') nextStatus = toDbAcceptStatus(kind);
    else nextStatus = 'declined'; // decline + request_changes

    const table = kind === 'business' ? 'business_quotes' : 'helper_quotes';
    const { rows } = await pool.query(
      `UPDATE ${table}
          SET status = $2, decline_reason = $3, updated_at = NOW()
        WHERE id = $1 AND status = 'sent'
        RETURNING *`,
      [quote.id, nextStatus, action === 'accept' ? null : reason],
    );
    if (!rows[0]) return bad(res, 409, 'Quote already responded or unavailable', 'conflict');
    const updated = rows[0];
    const card = toPublicQuoteCard(kind, updated);

    const chatStatus = action === 'accept' ? 'accepted' : action === 'request_changes' ? 'declined' : 'declined';
    const statusLabel =
      action === 'accept'
        ? `Quote accepted: ${card.title}`
        : action === 'request_changes'
          ? `Changes requested on quote: ${card.title}`
          : `Quote declined: ${card.title}`;

    // Post status into thread when possible
    const statusContent = `[quote_status:${kind}|${updated.id}|${chatStatus}]\n${statusLabel}`;
    let followUpMessage = null;
    if (action === 'request_changes') {
      followUpMessage = buildRequestChangesMessage({ title: card.title, reason });
    }

    if (updated.conversation_id && userId) {
      try {
        await postConversationMessage({
          conversationId: updated.conversation_id,
          senderId: userId,
          content: followUpMessage ? `${statusContent}\n${followUpMessage}` : statusContent,
          senderName: 'Customer',
          isProfileChat: true,
        });
      } catch (e) {
        logger.warn('[chatQuotes] status message failed', { error: e.message });
      }
    } else if (updated.guest_session_id && guest) {
      try {
        await pool.query(
          `INSERT INTO guest_profile_chat_messages
             (session_id, sender_type, sender_name, message, created_at)
           VALUES ($1, 'guest', $2, $3, CURRENT_TIMESTAMP)`,
          [
            updated.guest_session_id,
            guest.guest_name || 'Guest',
            followUpMessage ? `${statusContent}\n${followUpMessage}` : statusContent,
          ],
        );
      } catch (e) {
        logger.warn('[chatQuotes] guest status message failed', { error: e.message });
      }
    }

    await emitQuoteStatusToThread({
      conversationId: updated.conversation_id,
      guestSessionId: updated.guest_session_id,
      helperId: kind === 'helper' ? updated.helper_id : null,
      customerId: userId || null,
      content: statusLabel,
      meta: { quoteKind: kind, quoteId: String(updated.id), quoteStatus: chatStatus },
    });

    return res.json({
      quote: card,
      action,
      openAvailability: action === 'accept',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/chat/quotes/:kind/:id/revise
 * Provider creates a new version (or updates draft) and optionally re-shares.
 */
exports.reviseQuote = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_error');
    const kind = String(req.params.kind || '').toLowerCase();
    if (!QUOTE_KINDS.has(kind)) return bad(res, 400, 'Invalid kind');

    const parent = await loadQuote(kind, req.params.id);
    if (!parent) return bad(res, 404, 'Quote not found', 'not_found');

    const businessId = kind === 'business' ? parent.business_id : null;
    const access = await assertProviderAccess(userId, {
      kind,
      businessId,
      helperId: kind === 'helper' ? parent.helper_id : userId,
    });
    if (!access.ok) return bad(res, access.status, access.error, 'forbidden');

    const normalized = normalizeLineItems(req.body?.line_items || req.body?.lineItems || parent.line_items);
    if (normalized.error) return bad(res, 400, normalized.error, 'validation_failed');
    const taxRate =
      kind === 'helper'
        ? Number(req.body?.tax_rate ?? req.body?.taxRate ?? (Number(parent.tax_rate) <= 1 ? Number(parent.tax_rate) * 100 : parent.tax_rate) ?? 0)
        : Number(req.body?.tax_rate ?? req.body?.taxRate ?? parent.tax_rate ?? 0);
    const { subtotal, tax, total } = calculateTotals(normalized.items, taxRate);
    const title = String(req.body?.title || parent.title || 'Service quote').trim().slice(0, 300);
    const validUntil = req.body?.valid_until || req.body?.validUntil || parent.valid_until || null;
    const token = newQuoteToken();
    const nextVersion = (Number(parent.version) || 1) + 1;

    // Mark parent superseded
    const table = kind === 'business' ? 'business_quotes' : 'helper_quotes';
    await pool.query(
      `UPDATE ${table} SET superseded_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [parent.id],
    );

    let created;
    if (kind === 'business') {
      const { rows } = await pool.query(
        `INSERT INTO business_quotes
           (business_id, client_name, client_email, title, line_items, subtotal_cents, tax_rate, total_cents,
            valid_until, token, status, conversation_id, guest_session_id, created_by, parent_quote_id, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sent',$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          parent.business_id,
          parent.client_name,
          parent.client_email,
          title,
          JSON.stringify(normalized.items),
          subtotal,
          taxRate,
          total,
          validUntil,
          token,
          parent.conversation_id,
          parent.guest_session_id,
          userId,
          parent.id,
          nextVersion,
        ],
      );
      created = rows[0];
    } else {
      const { rows } = await pool.query(
        `INSERT INTO helper_quotes
           (job_id, helper_id, line_items, tax_rate, subtotal_cents, tax_cents, total_cents,
            notes, status, valid_until, conversation_id, guest_session_id, client_user_id,
            client_name, client_email, title, token, parent_quote_id, version)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,'sent',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          parent.job_id,
          parent.helper_id,
          JSON.stringify(normalized.items),
          taxRate / 100,
          subtotal,
          tax,
          total,
          req.body?.notes || parent.notes || null,
          validUntil,
          parent.conversation_id,
          parent.guest_session_id,
          parent.client_user_id,
          parent.client_name,
          parent.client_email,
          title,
          token,
          parent.id,
          nextVersion,
        ],
      );
      created = rows[0];
    }

    const reshare = req.body?.reshare !== false;
    let shareResult = null;
    if (reshare && (created.conversation_id || created.guest_session_id)) {
      req.body = {
        kind,
        quoteId: created.id,
        conversationId: created.conversation_id,
        guestSessionId: created.guest_session_id,
        businessId: created.business_id,
        helperId: created.helper_id,
        preface: `Updated quote (v${nextVersion}): ${title}`,
      };
      // Delegate to shareQuote logic inline via recursive call pattern — call share internals
      const card = toPublicQuoteCard(kind, created);
      const marker = buildQuoteMarker({
        kind,
        id: created.id,
        token: created.token,
        status: created.status,
        totalCents: created.total_cents,
        title,
        validUntil: created.valid_until,
        version: nextVersion,
      });
      const content = buildShareMessageContent({
        marker,
        title,
        totalCents: created.total_cents,
        tPreface: `Updated quote (v${nextVersion}): ${title}`,
      });
      const senderName =
        (access.business && access.business.business_name) ||
        `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() ||
        'Provider';
      let message = null;
      if (created.conversation_id) {
        message = await postConversationMessage({
          conversationId: created.conversation_id,
          senderId: userId,
          content,
          senderName,
          isProfileChat: true,
        });
      } else if (created.guest_session_id) {
        message = await postGuestMessage({
          guestSessionId: created.guest_session_id,
          senderName,
          content,
          helperId: created.helper_id,
        });
      }
      shareResult = { marker, message, content, quote: card };
    }

    return res.status(201).json({
      quote: toPublicQuoteCard(kind, created),
      parentId: String(parent.id),
      share: shareResult,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/chat/quotes/:kind/:id/schedule
 * After accept: create pending booking/appointment linked to quote.
 */
exports.scheduleFromQuote = async (req, res, next) => {
  try {
    const kind = String(req.params.kind || '').toLowerCase();
    if (!QUOTE_KINDS.has(kind)) return bad(res, 400, 'Invalid kind');
    const quote = await loadQuote(kind, req.params.id);
    if (!quote) return bad(res, 404, 'Quote not found', 'not_found');

    const chatStatus = toChatStatus(kind, quote.status);
    if (chatStatus !== 'accepted') {
      return bad(res, 409, 'Quote must be accepted before scheduling', 'not_accepted');
    }

    const token = String(req.body?.token || '').trim();
    const userId = req.user?.id;
    let guest = req.guestSession || null;
    if (!guest && !userId) {
      const extracted = guestProfileVerify.extractGuestAuth(req);
      if (extracted.token && extracted.sessionId) {
        guest = await guestProfileVerify.loadVerifiedGuestSession(extracted.token, extracted.sessionId);
      }
    }

    let allowed = false;
    if (token && quote.token && token === quote.token) allowed = true;
    if (userId && quote.conversation_id) {
      const conv = await assertConversationParticipant(userId, quote.conversation_id);
      if (conv && String(conv.customer_id) === String(userId)) allowed = true;
    }
    if (guest && quote.guest_session_id && String(guest.id) === String(quote.guest_session_id)) {
      allowed = true;
    }
    if (!allowed) {
      if (!userId && !guest) return bad(res, 401, 'Sign in or verify as guest', 'verify_required');
      return bad(res, 403, 'Not allowed', 'forbidden');
    }

    // Optional: block schedule until required agreements are accepted
    {
      const gate = await checkScheduleAgreementGate(pool, {
        conversationId: quote.conversation_id,
        guestSessionId: quote.guest_session_id,
      });
      if (gate.blocked) {
        return bad(res, 409, 'Accept the required agreement before scheduling', 'agreement_required', { agreements: gate.agreements });
      }
    }


    const body = req.body || {};
    const date = String(body.requestedDate || body.date || '').slice(0, 10);
    const start = String(body.requestedStartTime || body.start || '').slice(0, 8);
    const end = String(body.requestedEndTime || body.end || '').slice(0, 8);
    if (!date || !start || !end) {
      return bad(res, 400, 'requestedDate, start, and end are required', 'validation_failed');
    }

    const serviceName = String(
      body.serviceName || body.service_name || quote.title || 'Quoted service',
    ).trim().slice(0, 200);
    const description = [
      `source=quote_schedule`,
      `quote_kind=${kind}`,
      `quote_id=${quote.id}`,
      body.description ? String(body.description).slice(0, 500) : null,
    ].filter(Boolean).join(' | ');

    let helperId =
      kind === 'helper'
        ? quote.helper_id
        : body.helperId || body.helper_id || null;
    const businessId =
      kind === 'business'
        ? quote.business_id
        : body.businessId ?? body.business_id ?? null;

    if (businessId && !helperId) {
      const biz = await pool.query('SELECT user_id FROM businesses WHERE id = $1', [businessId]);
      helperId = biz.rows[0]?.user_id;
    }
    if (!helperId) return bad(res, 400, 'Could not resolve helper for booking', 'validation_failed');

    let bookingId = null;
    let appointmentId = null;
    let booking = null;

    if (userId && !guest) {
      bookingId = require('crypto').randomUUID();
      const hours = 24;
      const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
      const { rows } = await pool.query(
        `INSERT INTO booking_requests (
           id, customer_id, helper_id, business_id, service_name, requested_date,
           requested_start_time, requested_end_time, service_location,
           description, expires_at, confirmation_hours,
           conversation_id, guest_session_id, quote_kind, quote_id, source
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          bookingId,
          userId,
          helperId,
          businessId || null,
          serviceName,
          date,
          start.length === 5 ? `${start}:00` : start,
          end.length === 5 ? `${end}:00` : end,
          null,
          description,
          expiresAt,
          hours,
          quote.conversation_id || null,
          quote.guest_session_id || null,
          kind,
          String(quote.id),
          'quote_schedule',
        ],
      );
      booking = rows[0];
      try {
        socketService.broadcastToUser(helperId, 'booking:requested', { booking: rows[0] });
      } catch { /* ignore */ }
    } else {
      // Guest path — reuse messenger booking helper
      const startIso = body.startIso || `${date}T${start.length === 5 ? start + ':00' : start}`;
      const endIso = body.endIso || `${date}T${end.length === 5 ? end + ':00' : end}`;
      const { createAiBookingFromAction } = require('./chatController');
      const guestName = guest?.guest_name || '';
      const guestEmail = guest?.guest_email || '';
      const threadId = `quote:${kind}:${quote.id}:${date}|${start}|${end}`;
      const result = await createAiBookingFromAction(
        {
          guest_name: guestName,
          guest_email: guestEmail,
          service_description: serviceName,
          scheduled_start_time: startIso,
          scheduled_end_time: endIso,
          estimated_duration_minutes: 60,
          customer_notes: description,
        },
        helperId,
        threadId,
        null,
        { name: guestName, email: guestEmail },
      );
      if (!result?.ok) {
        if (result?.reason === 'conflict') {
          return res.status(409).json({ error: 'That time is no longer available', code: 'conflict' });
        }
        return bad(res, 500, 'Could not create booking', 'booking_failed');
      }
      appointmentId = result.appointment?.id;
      booking = result.appointment;
      try {
        const chatBookingReq = require('./chatBookingRequestsController');
        const guestBooking = await chatBookingReq.createGuestChatBookingRequest({
          helperId,
          businessId,
          guestSessionId: guest?.id || quote.guest_session_id || null,
          serviceName,
          date,
          start,
          end,
          description,
          appointmentId,
          source: 'quote_schedule',
          conversationId: quote.conversation_id || null,
        });
        if (guestBooking?.id) {
          bookingId = guestBooking.id;
          booking = guestBooking;
          await pool.query(
            `UPDATE booking_requests
                SET quote_kind = $2, quote_id = $3, updated_at = NOW()
              WHERE id = $1`,
            [guestBooking.id, kind, String(quote.id)],
          );
        }
      } catch (e) {
        logger.warn('[chatQuotes] guest booking_request create failed', { error: e.message });
      }
    }

    const table = kind === 'business' ? 'business_quotes' : 'helper_quotes';
    await pool.query(
      `UPDATE ${table}
          SET booking_request_id = COALESCE($2, booking_request_id),
              appointment_id = COALESCE($3, appointment_id),
              updated_at = NOW()
        WHERE id = $1`,
      [quote.id, bookingId, appointmentId],
    );

    const chatBookingReq = require('./chatBookingRequestsController');
    const bookingMarker = bookingId
      ? chatBookingReq.buildBookingRequestMarker({
          id: bookingId,
          status: 'pending',
          date,
          start,
          end,
          serviceName,
        })
      : '';
    const statusLabel = `Appointment requested from quote: ${quote.title || 'Quote'} · ${date} ${start}–${end}`;
    const threadContent = bookingMarker ? `${bookingMarker}
${statusLabel}` : statusLabel;
    await emitQuoteStatusToThread({
      conversationId: quote.conversation_id,
      guestSessionId: quote.guest_session_id,
      helperId,
      customerId: userId || null,
      content: threadContent,
      meta: {
        quoteKind: kind,
        quoteId: String(quote.id),
        quoteStatus: 'scheduled',
        bookingId,
        appointmentId,
      },
    });

    if (quote.conversation_id && userId) {
      try {
        await postConversationMessage({
          conversationId: quote.conversation_id,
          senderId: userId,
          content: `[quote_status:${kind}|${quote.id}|scheduled]
${threadContent}`,
          senderName: 'Customer',
          isProfileChat: true,
        });
      } catch { /* ignore */ }
    }

    return res.status(201).json({
      success: true,
      bookingId,
      appointmentId,
      booking,
      quote: toPublicQuoteCard(kind, { ...quote, booking_request_id: bookingId, appointment_id: appointmentId }),
    });
  } catch (err) {
    if (err.code === 'SCHEDULING_CONFLICT') {
      return res.status(409).json({ error: 'That time is no longer available', code: 'conflict' });
    }
    next(err);
  }
};

/**
 * GET /api/chat/quotes/list — provider lists quotes shareable in a thread context
 */
exports.listForThread = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_error');
    const kind = String(req.query.kind || '').toLowerCase();
    const businessId = req.query.businessId || req.query.business_id || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);

    if (kind === 'business') {
      if (!businessId) return bad(res, 400, 'businessId required');
      const access = await assertProviderAccess(userId, { kind, businessId });
      if (!access.ok) return bad(res, access.status, access.error);
      const { rows } = await pool.query(
        `SELECT * FROM business_quotes
          WHERE business_id = $1 AND superseded_at IS NULL
            AND status IN ('draft','sent','approved','declined')
          ORDER BY updated_at DESC NULLS LAST, created_at DESC
          LIMIT $2`,
        [businessId, limit],
      );
      return res.json({ quotes: rows.map((r) => toPublicQuoteCard('business', r)) });
    }

    // helper
    const { rows } = await pool.query(
      `SELECT * FROM helper_quotes
        WHERE helper_id = $1 AND superseded_at IS NULL
          AND status IN ('draft','sent','accepted','declined')
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT $2`,
      [userId, limit],
    );
    return res.json({ quotes: rows.map((r) => toPublicQuoteCard('helper', r)) });
  } catch (err) {
    next(err);
  }
};
