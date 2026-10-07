'use strict';

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');
const creditService = require('../services/oxsteedCreditService');
const {
  spendWithCreditInTransaction,
  resolveSpendParticipant,
} = require('../services/creditSpendAdapter');
const {
  assertConversationParticipant,
  assertGuestInquiryAccess,
  assertBusinessAccess,
  isProviderOnConversation,
  isCustomerOnConversation,
} = require('../services/chatThreadAccess');
const {
  buildPopMarker,
  buildPopShareContent,
  toPublicPopCard,
  redactPopForLog,
} = require('../services/chatProofOfPayment');
const {
  CREDIT_PAY_METHOD,
  normalizeCreditPayPayload,
  normalizePaymentRequestPayload,
  buildPaymentRequestMarker,
  buildPaymentRequestShareContent,
  toPublicPaymentRequestCard,
  canPayWithOxsteedCredit,
  deriveQuotePaymentStatus,
  assertMembershipForCustomerPay,
  resolveChatPurchaseOrderType,
  normalizeCreditRefundPayload,
  buildCreditRefundMarker,
  buildCreditRefundShareContent,
  toPublicCreditRefundCard,
} = require('../services/chatOxsteedCreditPayment');
const { mirrorLegacyMessage } = require('../services/businessConversationSync');
const { enqueueConversationMessageNotifications } = require('../services/messageNotificationService');

function bad(res, status, error, code, extra = {}) {
  return res.status(status).json({ error, code: code || 'error', ...extra });
}

function requestIp(req) {
  return (
    req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    null
  );
}

function deriveMessageClientId(scope, idempotencyKey) {
  const digest = crypto
    .createHash('sha256')
    .update(`${scope}:${idempotencyKey}`)
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function postConversationMessage(client, {
  conversationId,
  senderId,
  content,
  senderName,
  businessId = null,
  clientMessageId = null,
  recipientIds = null,
}) {
  const db = client || pool;
  const { rows } = await db.query(
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
    const replay = await db.query(
      'SELECT * FROM messages WHERE conversation_id = $1 AND client_message_id = $2',
      [conversationId, clientMessageId],
    );
    messageRow = replay.rows[0];
  }
  if (!messageRow) throw new Error('Failed to create chat payment message');
  if (replayed) return { ...messageRow, sender_name: senderName };
  await db.query(
    'UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
    [conversationId],
  );
  const message = { ...messageRow, sender_name: senderName };
  await enqueueConversationMessageNotifications({
    dbClient: db,
    conversationId,
    messageId: messageRow.id,
    senderId,
    senderName,
    body: content,
    actionUrl: `/messages/${conversationId}`,
    recipientIds,
    bestEffort: true,
  });
  try {
    socketService.broadcastToConversation(conversationId, 'message:new', { conversationId, message });
    socketService.broadcastToConversation(conversationId, 'profile_chat:new_message', {
      conversationId,
      message,
      senderName,
    });
  } catch (e) {
    logger.warn('[chatCreditPay] socket emit failed', { error: e.message });
  }
  try {
    await mirrorLegacyMessage?.({
      legacyConversationId: conversationId,
      businessId,
      message,
      senderName,
    });
  } catch (e) {
    logger.warn('[chatCreditPay] business mirror failed', { error: e.message });
  }
  return message;
}

async function postGuestMessage({
  guestSessionId,
  senderName,
  content,
  helperId,
  senderType = 'helper',
  clientMessageId = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO guest_profile_chat_messages
       (session_id, sender_type, sender_name, message, client_message_id, created_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (session_id, client_message_id)
     WHERE client_message_id IS NOT NULL DO NOTHING
     RETURNING id, session_id, sender_type, sender_name, message, created_at`,
    [guestSessionId, senderType, senderName, content, clientMessageId],
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
  if (!msg) throw new Error('Failed to create guest chat payment message');
  if (replayed) return msg;
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
    logger.warn('[chatCreditPay] guest socket emit failed', { error: e.message });
  }
  return msg;
}


/**
 * Resolve an active OxSteed Credit partner for a chat payee.
 * 1) Direct business_id on partners
 * 2) Helper → owned/member businesses that have an active partner (documented fallback)
 */
async function resolveCreditPartner({ businessId, helperId, client = pool } = {}) {
  const db = client || pool;

  async function partnerForBusiness(bizId) {
    if (!bizId) return null;
    const { rows } = await db.query(
      `SELECT p.id, p.restaurant_id, p.business_id, p.status, p.settlement_currency_code
         FROM oxsteed_credit_partners p
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE p.business_id = $1
          AND p.status = 'active'
          AND fr.status = 'active'
        ORDER BY p.updated_at DESC NULLS LAST
        LIMIT 1`,
      [bizId],
    );
    return rows[0] || null;
  }

  if (businessId) {
    const partner = await partnerForBusiness(businessId);
    if (partner) {
      return { ok: true, partner, resolvedBusinessId: businessId, resolution: 'business_id' };
    }
  }

  if (helperId) {
    const { rows: bizRows } = await db.query(
      `SELECT b.id
         FROM businesses b
        WHERE b.is_active = TRUE
          AND (
            b.user_id = $1
            OR EXISTS (
              SELECT 1 FROM business_members bm
               WHERE bm.business_id = b.id
                 AND bm.member_id = $1
                 AND bm.status = 'active'
            )
          )
        ORDER BY b.is_primary DESC NULLS LAST, b.updated_at DESC NULLS LAST
        LIMIT 25`,
      [helperId],
    );
    for (const row of bizRows) {
      const partner = await partnerForBusiness(row.id);
      if (partner) {
        return {
          ok: true,
          partner,
          resolvedBusinessId: row.id,
          resolution: 'helper_linked_business',
        };
      }
    }
  }

  if (!businessId && !helperId) {
    return {
      ok: false,
      code: 'credit_provider_not_eligible',
      error:
        'This provider cannot receive OxSteed Credit. Credit payments require an eligible partner business.',
    };
  }
  return {
    ok: false,
    code: 'credit_provider_not_eligible',
    error:
      'This provider is not enrolled to receive OxSteed Credit. Ask them to link an eligible partner business, or use another payment method / upload proof of payment.',
  };
}

/**
 * Resolve a chat payee to a Credit participant via the shared spend adapter.
 * Locked decision #8: chat works without a restaurant row — resolution goes
 * through credit_participants, not oxsteed_credit_partners.restaurant_id.
 *
 * Tries in order: direct business participant → direct helper participant →
 * helper's businesses as business participants. Returns { participantRef,
 * partnerId } or throws credit_provider_not_eligible.
 */
async function resolveChatParticipant({ businessId, helperId, client = pool } = {}) {
  const db = client || pool;

  async function tryParticipant(type, subjectId) {
    if (subjectId === null || subjectId === undefined) return null;
    try {
      const resolved = await resolveSpendParticipant(db, { type, subjectId: String(subjectId) }, 'chat');
      return { participantRef: { type, subjectId: String(subjectId) }, partnerId: resolved.partnerId };
    } catch (e) {
      if (e.code === 'credit_participant_not_found') return null;
      throw e;
    }
  }

  if (businessId) {
    const found = await tryParticipant('business', businessId);
    if (found) return found;
  }

  if (helperId) {
    const found = await tryParticipant('helper', helperId);
    if (found) return found;

    // Fallback: helper's businesses as business participants.
    const { rows: bizRows } = await db.query(
      `SELECT b.id
         FROM businesses b
        WHERE b.is_active = TRUE
          AND (
            b.user_id = $1
            OR EXISTS (
              SELECT 1 FROM business_members bm
               WHERE bm.business_id = b.id
                 AND bm.member_id = $1
                 AND bm.status = 'active'
            )
          )
        ORDER BY b.is_primary DESC NULLS LAST, b.updated_at DESC NULLS LAST
        LIMIT 25`,
      [helperId],
    );
    for (const row of bizRows) {
      const bizFound = await tryParticipant('business', row.id);
      if (bizFound) return bizFound;
    }
  }

  throw new AppError(
    'This provider is not enrolled to receive OxSteed Credit. Ask them to enroll as a Credit participant, or use another payment method / upload proof of payment.',
    403,
    'credit_provider_not_eligible'
  );
}

async function loadPartnerAllowedOrderTypes(partnerId, client = pool) {
  if (!partnerId) return [];
  try {
    const { rows } = await client.query(
      `SELECT a.allowed_order_types
         FROM oxsteed_credit_partner_agreements a
        WHERE a.partner_id = $1
          AND a.status = 'active'
          AND a.starts_at <= NOW()
          AND (a.ends_at IS NULL OR a.ends_at > NOW())
        ORDER BY a.version DESC
        LIMIT 1`,
      [partnerId],
    );
    return rows[0]?.allowed_order_types || [];
  } catch {
    return [];
  }
}

async function loadPaymentRequest(id, client = pool) {
  const { rows } = await client.query('SELECT * FROM chat_payment_requests WHERE id = $1', [id]);
  return rows[0] || null;
}

async function attachQuotePaymentMetadata(client, { quoteKind, quoteId, amountCents, creditTxnId }) {
  if (!quoteKind || !quoteId) return null;
  const table = quoteKind === 'business' ? 'business_quotes' : 'helper_quotes';
  let row;
  try {
    const { rows } = await client.query(
      `UPDATE ${table}
          SET amount_paid_cents = COALESCE(amount_paid_cents, 0) + $2,
              last_payment_method = $3,
              last_payment_at = NOW(),
              last_credit_txn_id = $4
        WHERE id = ${quoteKind === 'business' ? '$1::bigint' : '$1'}
        RETURNING id, total_cents, amount_paid_cents, status`,
      [quoteId, amountCents, CREDIT_PAY_METHOD, creditTxnId ? String(creditTxnId) : null],
    );
    row = rows[0];
  } catch (e) {
    logger.warn('[chatCreditPay] quote payment metadata update skipped', {
      quoteKind,
      quoteId,
      error: e.message,
    });
    return null;
  }
  if (!row) return null;
  const paymentStatus = deriveQuotePaymentStatus(row.total_cents, row.amount_paid_cents);
  try {
    await client.query(`UPDATE ${table} SET payment_status = $2 WHERE id = $1`, [
      row.id,
      paymentStatus,
    ]);
  } catch {
    /* payment_status column may be missing on older DBs mid-migrate */
  }
  return { ...row, payment_status: paymentStatus };
}

/**
 * POST /api/chat/payments/oxsteed-credit
 * Auth customer pays provider via existing credit ledger; auto-posts confirmed POP.
 */
exports.payWithOxsteedCredit = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const gate = canPayWithOxsteedCredit({
      isAuthenticated: Boolean(userId),
      guestVerified: Boolean(req.guestSession),
      guestCreditAvailable: false,
    });
    if (!gate.ok) {
      return bad(res, 401, gate.message, gate.reason, { signInRequired: true });
    }

    const normalized = normalizeCreditPayPayload(req.body || {});
    if (normalized.error) return bad(res, 400, normalized.error, normalized.code);

    const conv = await assertConversationParticipant(userId, normalized.conversationId, { writable: true });
    if (!conv) return bad(res, 403, 'Not a conversation participant', 'forbidden');

    const member = assertMembershipForCustomerPay(userId, conv);
    if (!member.ok) return bad(res, 403, member.error, member.code);

    // Optional: bind to an existing payment request
    let paymentRequest = null;
    if (normalized.paymentRequestId) {
      paymentRequest = await loadPaymentRequest(normalized.paymentRequestId);
      if (!paymentRequest) return bad(res, 404, 'Payment request not found', 'not_found');
      if (String(paymentRequest.conversation_id) !== String(normalized.conversationId)) {
        return bad(res, 403, 'Payment request does not belong to this conversation', 'forbidden');
      }
      if (paymentRequest.status !== 'open') {
        return bad(res, 409, 'Payment request is no longer open', 'invalid_status');
      }
      if (Number(paymentRequest.amount_cents) !== Number(normalized.amountCents)) {
        return bad(res, 409, 'Amount does not match the payment request', 'amount_mismatch');
      }
    }

    const businessId =
      normalized.payeeBusinessId ||
      paymentRequest?.business_id ||
      conv.business_id ||
      null;
    const helperId = normalized.payeeHelperId || paymentRequest?.helper_id || conv.helper_id || null;
    const quoteKind = normalized.quoteKind || paymentRequest?.quote_kind || null;
    const quoteId = normalized.quoteId || paymentRequest?.quote_id || null;

    // Resolve the payee to a Credit participant (no restaurant row required).
    let participantRef;
    let partnerId;
    try {
      const resolved = await resolveChatParticipant({ businessId, helperId });
      participantRef = resolved.participantRef;
      partnerId = resolved.partnerId;
    } catch (e) {
      return bad(res, e.status || 403, e.message, e.code || 'credit_provider_not_eligible');
    }
    const allowedOrderTypes = await loadPartnerAllowedOrderTypes(partnerId);
    const chatOrderType = resolveChatPurchaseOrderType(allowedOrderTypes);

    const senderName =
      `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Customer';
    const correlationId = `chat-credit-${normalized.idempotencyKey}`.slice(0, 160);
    const paidOn = new Date().toISOString().slice(0, 10);

    let result;
    try {
      result = await withTransaction(
        pool,
        async (client) => {
          const spendResult = await spendWithCreditInTransaction(client, {
            participantRef,
            customerId: userId,
            amountCents: normalized.amountCents,
            currency: normalized.currency,
            surface: 'chat',
            referenceType: 'chat_payment',
            referenceId: paymentRequest?.id || normalized.conversationId,
            idempotencyKey: normalized.idempotencyKey,
            actorUserId: userId,
            isImpersonated: !!req.isImpersonated,
            orderType: chatOrderType,
            category: 'chat_payment',
            correlationId,
            requestIp: requestIp(req),
            description: normalized.memo || `Chat payment${quoteId ? ` for quote ${quoteId}` : ''}`,
            metadata: {
              conversationId: normalized.conversationId,
              paymentRequestId: paymentRequest?.id || null,
              quoteKind,
              quoteId,
              helperId,
              businessId,
              channel: 'live_messenger',
              chatOrderTypeMapped: chatOrderType,
              partnerId,
            },
          });
          const purchase = spendResult.purchase;

          const creditTxnId =
            purchase?.transaction?.id != null
              ? String(purchase.transaction.id)
              : purchase?.id != null
                ? String(purchase.id)
                : null;

          // chat_proof_of_payments.business_id is UUID-typed in migration 534;
          // conversations.business_id is INT — only store UUID-shaped values here.
          const popBusinessId =
            businessId != null &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              String(businessId),
            )
              ? String(businessId)
              : null;

          const { rows: popRows } = await client.query(
            `INSERT INTO chat_proof_of_payments (
               conversation_id, business_id, helper_id,
               quote_kind, quote_id,
               amount_cents, currency, payment_method, transaction_id, paid_on, notes,
               submitted_by, submitted_by_guest, status,
               payment_request_id, credit_txn_id
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,'confirmed',$13,$14
             ) RETURNING *`,
            [
              normalized.conversationId,
              popBusinessId,
              helperId,
              quoteKind,
              quoteId,
              normalized.amountCents,
              normalized.currency,
              CREDIT_PAY_METHOD,
              creditTxnId,
              paidOn,
              normalized.memo,
              userId,
              paymentRequest?.id || null,
              creditTxnId,
            ],
          );
          const pop = popRows[0];

          if (paymentRequest) {
            await client.query(
              `UPDATE chat_payment_requests
                  SET status = 'paid', paid_pop_id = $2, paid_at = NOW(),
                      credit_txn_id = $3, updated_at = NOW()
                WHERE id = $1 AND status = 'open'`,
              [paymentRequest.id, pop.id, creditTxnId],
            );
          }

          const quoteMeta = await attachQuotePaymentMetadata(client, {
            quoteKind,
            quoteId,
            amountCents: normalized.amountCents,
            creditTxnId,
          });

          const marker = buildPopMarker({
            id: pop.id,
            status: pop.status,
            amountCents: pop.amount_cents,
            paymentMethod: CREDIT_PAY_METHOD,
            transactionId: creditTxnId,
            paidOn,
            quoteKind,
            quoteId,
          });
          const content = buildPopShareContent({
            marker,
            amountCents: pop.amount_cents,
            paymentMethod: 'OxSteed Credit',
            preface: `Paid with OxSteed Credit`,
          });

          const message = await postConversationMessage(client, {
            conversationId: normalized.conversationId,
            senderId: userId,
            content,
            senderName,
            recipientIds: [conv.customer_id, conv.helper_id],
          });
          await client.query(
            'UPDATE chat_proof_of_payments SET message_id = $1, updated_at = NOW() WHERE id = $2',
            [String(message.id), pop.id],
          );

          return {
            pop: { ...pop, message_id: String(message.id) },
            message,
            marker,
            creditTxnId,
            quoteMeta,
            purchase,
          };
        },
        'chat_oxsteed_credit_pay',
      );
    } catch (err) {
      if (err instanceof AppError || err?.isOperational) {
        return bad(res, err.status || err.statusCode || 400, err.message, err.code || 'credit_error', err.fields);
      }
      throw err;
    }

    logger.info('[chatCreditPay] paid', {
      pop: redactPopForLog(result.pop),
      creditTxnId: result.creditTxnId,
      conversationId: normalized.conversationId,
    });

    return res.status(201).json({
      pop: toPublicPopCard(result.pop),
      message: result.message,
      marker: result.marker,
      creditTransactionId: result.creditTxnId,
      quotePayment: result.quoteMeta
        ? {
            quote_kind: quoteKind,
            quote_id: quoteId,
            amount_paid_cents: result.quoteMeta.amount_paid_cents,
            payment_status: result.quoteMeta.payment_status,
          }
        : null,
      method: CREDIT_PAY_METHOD,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/chat/payments/request — provider sends a payment-request card.
 */
exports.requestPayment = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_required');

    const normalized = normalizePaymentRequestPayload(req.body || {});
    if (normalized.error) return bad(res, 400, normalized.error, normalized.code);

    let helperId = null;
    let businessId = req.body.businessId || req.body.business_id || null;
    let conversationParticipants = null;
    const senderName =
      `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Provider';

    if (normalized.conversationId) {
      const conv = await assertConversationParticipant(userId, normalized.conversationId, { writable: true });
      if (!conv) return bad(res, 403, 'Not a conversation participant', 'forbidden');
      conversationParticipants = [conv.customer_id, conv.helper_id];
      const isProvider =
        isProviderOnConversation(userId, conv) ||
        (conv.business_id && (await assertBusinessAccess(userId, conv.business_id)));
      if (!isProvider && isCustomerOnConversation(userId, conv)) {
        return bad(res, 403, 'Only the provider can request payment', 'provider_only');
      }
      if (!isProvider) return bad(res, 403, 'Only the provider can request payment', 'provider_only');
      helperId = conv.helper_id;
      businessId = businessId || conv.business_id;
    } else if (normalized.guestSessionId) {
      const guestInquiry = await assertGuestInquiryAccess(userId, normalized.guestSessionId);
      if (!guestInquiry) return bad(res, 403, 'Not allowed for this guest inquiry', 'forbidden');
      helperId = guestInquiry.helper_id;
      businessId = businessId || guestInquiry.business_id;
    }

    // Idempotent replay for provider request. The message is repaired below if
    // the original request committed its payment row before the chat insert.
    let payReq = null;
    let replayed = false;
    if (normalized.idempotencyKey) {
      const { rows: existing } = await pool.query(
        `SELECT * FROM chat_payment_requests
          WHERE requested_by = $1 AND idempotency_key = $2
          LIMIT 1`,
        [userId, normalized.idempotencyKey],
      );
      if (existing[0]) {
        payReq = existing[0];
        replayed = true;
      }
    }

    if (!payReq) {
      const { rows } = await pool.query(
        `INSERT INTO chat_payment_requests (
           conversation_id, guest_session_id, business_id, helper_id,
           quote_kind, quote_id, amount_cents, currency, memo,
           requested_by, idempotency_key, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open')
         ON CONFLICT (requested_by, idempotency_key)
         WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING *`,
        [
          normalized.conversationId,
          normalized.guestSessionId,
          businessId,
          helperId,
          normalized.quoteKind,
          normalized.quoteId,
          normalized.amountCents,
          normalized.currency,
          normalized.memo,
          userId,
          normalized.idempotencyKey,
        ],
      );
      payReq = rows[0] || null;
      if (!payReq && normalized.idempotencyKey) {
        const { rows: replay } = await pool.query(
          `SELECT * FROM chat_payment_requests
            WHERE requested_by = $1 AND idempotency_key = $2
            LIMIT 1`,
          [userId, normalized.idempotencyKey],
        );
        payReq = replay[0] || null;
        replayed = Boolean(payReq);
      }
    }
    if (!payReq) throw new Error('Failed to create chat payment request');

    const marker = buildPaymentRequestMarker({
      id: payReq.id,
      amountCents: payReq.amount_cents,
      currency: payReq.currency,
      status: payReq.status,
      memo: payReq.memo,
      quoteKind: payReq.quote_kind,
      quoteId: payReq.quote_id,
    });
    const content = buildPaymentRequestShareContent({
      marker,
      amountCents: payReq.amount_cents,
      currency: payReq.currency,
      memo: payReq.memo,
      preface: normalized.preface,
    });

    let message = null;
    const messageClientId = normalized.idempotencyKey
      ? deriveMessageClientId(
        normalized.conversationId || `guest:${normalized.guestSessionId}`,
        normalized.idempotencyKey,
      )
      : null;
    if (payReq.message_id) {
      message = { id: payReq.message_id };
    } else if (normalized.conversationId) {
      message = await postConversationMessage(null, {
        conversationId: normalized.conversationId,
        senderId: userId,
        content,
        senderName,
        businessId,
        clientMessageId: messageClientId,
        recipientIds: conversationParticipants,
      });
      await pool.query(
        'UPDATE chat_payment_requests SET message_id = $1, updated_at = NOW() WHERE id = $2 AND message_id IS NULL',
        [String(message.id), payReq.id],
      );
    } else if (normalized.guestSessionId) {
      message = await postGuestMessage({
        guestSessionId: normalized.guestSessionId,
        senderName,
        content,
        helperId,
        senderType: 'helper',
        clientMessageId: messageClientId,
      });
      await pool.query(
        'UPDATE chat_payment_requests SET message_id = $1, updated_at = NOW() WHERE id = $2 AND message_id IS NULL',
        [String(message.id), payReq.id],
      );
    }

    return res.status(replayed ? 200 : 201).json({
      paymentRequest: toPublicPaymentRequestCard({ ...payReq, message_id: message?.id || payReq.message_id }),
      message,
      marker,
      replayed,
    });
  } catch (err) {
    next(err);
  }
};

exports.getPaymentRequest = async (req, res, next) => {
  try {
    const payReq = await loadPaymentRequest(req.params.id);
    if (!payReq) return bad(res, 404, 'Payment request not found', 'not_found');

    const userId = req.user?.id;
    let allowed = false;
    if (userId && payReq.conversation_id) {
      const conv = await assertConversationParticipant(userId, payReq.conversation_id);
      if (conv) allowed = true;
    }
    if (userId && payReq.guest_session_id) {
      const g = await assertGuestInquiryAccess(userId, payReq.guest_session_id);
      if (g) allowed = true;
    }
    if (userId && payReq.requested_by && String(payReq.requested_by) === String(userId)) {
      allowed = true;
    }
    if (!allowed) return bad(res, 403, 'Not allowed to view this payment request', 'forbidden');

    return res.json(toPublicPaymentRequestCard(payReq));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/chat/payments/credit-hint — balance + partner eligibility for the thread.
 */
exports.getCreditPayHint = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return bad(res, 401, 'Sign in to see OxSteed Credit balance', 'auth_required_for_credit', {
        signInRequired: true,
      });
    }
    const conversationId = req.query.conversationId || req.query.conversation_id;
    if (!conversationId) return bad(res, 400, 'conversationId required', 'validation_failed');

    const conv = await assertConversationParticipant(userId, conversationId, { writable: true });
    if (!conv) return bad(res, 403, 'Not a conversation participant', 'forbidden');

    const businessId = req.query.businessId || req.query.business_id || conv.business_id || null;
    const helperId = req.query.helperId || req.query.helper_id || conv.helper_id || null;
    let partnerEligible = false;
    let partnerError = null;
    let partnerCode = null;
    try {
      await resolveChatParticipant({ businessId, helperId });
      partnerEligible = true;
    } catch (e) {
      partnerError = e.message;
      partnerCode = e.code || 'credit_provider_not_eligible';
    }
    let account = null;
    try {
      account = await creditService.getCustomerCreditAccount(userId);
    } catch {
      account = null;
    }

    return res.json({
      canPay: Boolean(partnerEligible && isCustomerOnConversation(userId, conv)),
      isCustomer: isCustomerOnConversation(userId, conv),
      partnerEligible,
      partnerError,
      partnerCode,
      balanceCents: account?.availableBalanceCents ?? account?.balanceCents ?? null,
      currency: account?.currencyCode || creditService.CREDIT_CURRENCY || 'USD',
      method: CREDIT_PAY_METHOD,
    });
  } catch (err) {
    next(err);
  }
};


/**
 * POST /api/chat/payments/:id/refund
 * Provider refunds an in-chat OxSteed Credit payment (full or partial).
 * :id may be a payment_request id; body may also supply popId / creditTxnId.
 */
exports.refundChatCreditPayment = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return bad(res, 401, 'Authentication required', 'auth_required');

    const paymentRequestIdParam = req.params.id || null;
    const normalized = normalizeCreditRefundPayload({
      ...(req.body || {}),
      paymentRequestId: (req.body || {}).paymentRequestId || (req.body || {}).payment_request_id || paymentRequestIdParam,
    });
    if (normalized.error) return bad(res, 400, normalized.error, normalized.code);

    let paymentRequest = null;
    if (normalized.paymentRequestId) {
      paymentRequest = await loadPaymentRequest(normalized.paymentRequestId);
    }

    let pop = null;
    if (normalized.popId) {
      const { rows } = await pool.query('SELECT * FROM chat_proof_of_payments WHERE id = $1', [normalized.popId]);
      pop = rows[0] || null;
    } else if (paymentRequest?.paid_pop_id) {
      const { rows } = await pool.query('SELECT * FROM chat_proof_of_payments WHERE id = $1', [paymentRequest.paid_pop_id]);
      pop = rows[0] || null;
    } else if (paymentRequest?.id) {
      const { rows } = await pool.query(
        `SELECT * FROM chat_proof_of_payments
          WHERE payment_request_id = $1 AND payment_method = $2
          ORDER BY created_at DESC LIMIT 1`,
        [paymentRequest.id, CREDIT_PAY_METHOD],
      );
      pop = rows[0] || null;
    }

    if (!pop && !paymentRequest && !normalized.creditTxnId) {
      return bad(res, 404, 'Payment not found to refund', 'not_found');
    }

    const conversationId =
      pop?.conversation_id || paymentRequest?.conversation_id || req.body?.conversationId || null;
    if (!conversationId) {
      return bad(res, 400, 'conversationId required for refund', 'validation_failed');
    }

    // A body-supplied pop/paymentRequest must belong to the requested
    // conversation; otherwise one provider could refund a payment from a
    // conversation they were never part of.
    const requestedConversationId = req.body?.conversationId || req.body?.conversation_id || null;
    for (const [label, record] of [['payment', pop], ['paymentRequest', paymentRequest]]) {
      if (record && requestedConversationId && record.conversation_id && String(record.conversation_id) !== String(requestedConversationId)) {
        return bad(res, 403, `This ${label} does not belong to the requested conversation`, 'forbidden');
      }
    }

    const conv = await assertConversationParticipant(userId, conversationId);
    if (!conv) return bad(res, 403, 'Not a conversation participant', 'forbidden');

    const isProvider =
      isProviderOnConversation(userId, conv) ||
      (conv.business_id && (await assertBusinessAccess(userId, conv.business_id)));
    if (!isProvider) {
      return bad(res, 403, 'Only the provider can refund chat credit payments', 'provider_only');
    }

    // Bind the refund to this payment's own purchase transaction. A
    // body-supplied creditTxnId must equal the pop/payment-request's recorded
    // transaction; a colluding provider could otherwise refund another
    // customer's purchase through this conversation.
    const boundPurchaseTxnId =
      pop?.credit_txn_id ||
      pop?.transaction_id ||
      paymentRequest?.credit_txn_id ||
      null;
    if (normalized.creditTxnId && boundPurchaseTxnId && String(normalized.creditTxnId) !== String(boundPurchaseTxnId)) {
      return bad(res, 409, 'The supplied credit transaction does not belong to this payment', 'credit_txn_mismatch');
    }
    let purchaseTxnId = boundPurchaseTxnId || normalized.creditTxnId || null;
    if (purchaseTxnId && !boundPurchaseTxnId) {
      // No pop or payment request binds this transaction to the payment, so
      // verify it is a chat payment for this conversation before refunding.
      const { rows: txnRows } = await pool.query(
        `SELECT id, reference_type, reference_id, metadata
           FROM oxsteed_credit_transactions
          WHERE id = $1`,
        [purchaseTxnId]
      );
      const txn = txnRows[0];
      const txnConversationId = txn?.metadata?.conversationId || txn?.metadata?.conversation_id || null;
      if (!txn || txn.reference_type !== 'chat_payment'
        || (String(txn.reference_id) !== String(conversationId) && String(txnConversationId) !== String(conversationId))) {
        return bad(res, 409, 'The supplied credit transaction does not belong to this conversation', 'credit_txn_mismatch');
      }
    }
    if (!purchaseTxnId) {
      return bad(res, 409, 'No OxSteed Credit transaction found for this payment', 'no_credit_txn');
    }

    const maxRefundable = Number(pop?.amount_cents || paymentRequest?.amount_cents || 0);
    const alreadyRefunded = Number(pop?.refunded_amount_cents || paymentRequest?.refunded_amount_cents || 0);
    const remaining = Math.max(0, maxRefundable - alreadyRefunded);
    if (remaining <= 0) {
      return bad(res, 409, 'Payment is already fully refunded', 'already_refunded');
    }
    const refundAmount = normalized.amountCents != null ? normalized.amountCents : remaining;
    if (refundAmount <= 0 || refundAmount > remaining) {
      return bad(res, 400, 'Refund amount exceeds remaining refundable balance', 'invalid_amount');
    }

    const correlationId = `chat-credit-refund-${normalized.idempotencyKey}`.slice(0, 160);
    const senderName =
      `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Provider';

    let result;
    try {
      result = await withTransaction(pool, async (client) => {
        // Idempotent replay
        const existing = await client.query(
          `SELECT * FROM chat_credit_refunds
            WHERE requested_by = $1 AND idempotency_key = $2
            LIMIT 1`,
          [userId, normalized.idempotencyKey],
        );
        if (existing.rows[0]) {
          return { refundRow: existing.rows[0], replay: true, message: null, pop, paymentRequest };
        }

        let refundTxn;
        try {
          refundTxn = await creditService.refundCreditInTransaction(client, {
            purchaseTransactionId: purchaseTxnId,
            amountCents: refundAmount,
            idempotencyKey: normalized.idempotencyKey,
            actorUserId: userId,
            actorType: 'provider',
            reason: normalized.reason,
            correlationId,
            requestIp: requestIp(req),
            metadata: {
              conversationId,
              paymentRequestId: paymentRequest?.id || null,
              popId: pop?.id || null,
              channel: 'live_messenger',
            },
          });
        } catch (e) {
          // Fallback: by reference when purchase id lookup fails
          if (paymentRequest?.id || conversationId) {
            refundTxn = await creditService.refundCreditForReferenceInTransaction(client, {
              referenceType: 'chat_payment',
              referenceId: String(paymentRequest?.id || conversationId),
              amountCents: refundAmount,
              idempotencyKey: normalized.idempotencyKey,
              actorUserId: userId,
              actorType: 'provider',
              reason: normalized.reason,
              correlationId,
              requestIp: requestIp(req),
              metadata: {
                conversationId,
                paymentRequestId: paymentRequest?.id || null,
                popId: pop?.id || null,
                channel: 'live_messenger',
              },
            });
          } else {
            throw e;
          }
        }

        const refundTxnId =
          refundTxn?.transaction?.id != null
            ? String(refundTxn.transaction.id)
            : refundTxn?.id != null
              ? String(refundTxn.id)
              : null;

        const newRefundedTotal = alreadyRefunded + refundAmount;
        const fullyRefunded = newRefundedTotal >= maxRefundable;
        const popStatus = fullyRefunded ? 'refunded' : 'partially_refunded';

        let updatedPop = pop;
        if (pop?.id) {
          const { rows } = await client.query(
            `UPDATE chat_proof_of_payments
                SET status = $2,
                    refunded_amount_cents = $3,
                    refund_credit_txn_id = $4,
                    refunded_at = NOW(),
                    refund_reason = $5,
                    updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [pop.id, popStatus, newRefundedTotal, refundTxnId, normalized.reason],
          );
          updatedPop = rows[0] || pop;
        }

        let updatedPayReq = paymentRequest;
        if (paymentRequest?.id) {
          const { rows } = await client.query(
            `UPDATE chat_payment_requests
                SET status = CASE WHEN $2 THEN 'refunded' ELSE status END,
                    refunded_amount_cents = $3,
                    refund_credit_txn_id = $4,
                    refunded_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [paymentRequest.id, fullyRefunded, newRefundedTotal, refundTxnId],
          );
          updatedPayReq = rows[0] || paymentRequest;
        }

        const { rows: refundRows } = await client.query(
          `INSERT INTO chat_credit_refunds (
             conversation_id, payment_request_id, pop_id,
             purchase_txn_id, refund_txn_id, amount_cents, currency,
             reason, status, requested_by, idempotency_key, metadata
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'posted',$9,$10,$11::jsonb)
           RETURNING *`,
          [
            conversationId,
            updatedPayReq?.id || null,
            updatedPop?.id || null,
            String(purchaseTxnId),
            refundTxnId,
            refundAmount,
            updatedPop?.currency || updatedPayReq?.currency || 'USD',
            normalized.reason,
            userId,
            normalized.idempotencyKey,
            JSON.stringify({
              fullyRefunded,
              channel: 'live_messenger',
            }),
          ],
        );
        const refundRow = refundRows[0];

        const marker = buildCreditRefundMarker({
          id: refundRow.id,
          amountCents: refundAmount,
          currency: refundRow.currency,
          status: 'posted',
          popId: updatedPop?.id,
          refundTxnId,
        });
        const content = buildCreditRefundShareContent({
          marker,
          amountCents: refundAmount,
          currency: refundRow.currency,
          reason: normalized.reason,
        });
        const message = await postConversationMessage(client, {
          conversationId,
          senderId: userId,
          content,
          senderName,
        });
        await client.query(
          `UPDATE chat_credit_refunds SET message_id = $2 WHERE id = $1`,
          [refundRow.id, message?.id != null ? String(message.id) : null],
        );

        return {
          refundRow: { ...refundRow, message_id: message?.id },
          replay: false,
          message,
          pop: updatedPop,
          paymentRequest: updatedPayReq,
          fullyRefunded,
        };
      });
    } catch (err) {
      if (err.code || err.status || err.statusCode) {
        return bad(
          res,
          err.status || err.statusCode || 400,
          err.message,
          err.code || 'credit_refund_failed',
        );
      }
      throw err;
    }

    return res.status(result.replay ? 200 : 201).json({
      refund: toPublicCreditRefundCard(result.refundRow),
      pop: result.pop ? toPublicPopCard(result.pop) : null,
      paymentRequest: result.paymentRequest
        ? toPublicPaymentRequestCard(result.paymentRequest)
        : null,
      message: result.message || null,
      replay: Boolean(result.replay),
    });
  } catch (err) {
    next(err);
  }
};


exports.resolveCreditPartner = resolveCreditPartner;
