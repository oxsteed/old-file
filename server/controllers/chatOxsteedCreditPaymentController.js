'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');
const creditService = require('../services/oxsteedCreditService');
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
} = require('../services/chatOxsteedCreditPayment');

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

async function postConversationMessage(client, { conversationId, senderId, content, senderName }) {
  const db = client || pool;
  const { rows } = await db.query(
    `INSERT INTO messages (conversation_id, sender_id, content, message_type)
     VALUES ($1, $2, $3, 'text') RETURNING *`,
    [conversationId, senderId, content],
  );
  await db.query(
    'UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
    [conversationId],
  );
  const message = { ...rows[0], sender_name: senderName };
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
    logger.warn('[chatCreditPay] guest socket emit failed', { error: e.message });
  }
  return msg;
}

/**
 * Resolve an active OxSteed Credit partner for a chat payee.
 * Partners are restaurant-backed; businesses may be linked via partners.business_id.
 * Helpers without an eligible business partner cannot receive credit.
 */
async function resolveCreditPartner({ businessId, client = pool } = {}) {
  if (!businessId) {
    return {
      ok: false,
      code: 'credit_provider_not_eligible',
      error:
        'This provider cannot receive OxSteed Credit. Credit payments require an eligible partner business.',
    };
  }
  const { rows } = await client.query(
    `SELECT p.id, p.restaurant_id, p.business_id, p.status, p.settlement_currency_code
       FROM oxsteed_credit_partners p
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
      WHERE p.business_id = $1
        AND p.status = 'active'
        AND fr.status = 'active'
      ORDER BY p.updated_at DESC NULLS LAST
      LIMIT 1`,
    [businessId],
  );
  if (!rows[0]) {
    return {
      ok: false,
      code: 'credit_provider_not_eligible',
      error:
        'This business is not enrolled to receive OxSteed Credit. Ask them to complete partner eligibility, or use another payment method / upload proof of payment.',
    };
  }
  return { ok: true, partner: rows[0] };
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

    const conv = await assertConversationParticipant(userId, normalized.conversationId);
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

    const partnerResult = await resolveCreditPartner({ businessId });
    if (!partnerResult.ok) {
      return bad(res, 403, partnerResult.error, partnerResult.code);
    }
    const partner = partnerResult.partner;

    const senderName =
      `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Customer';
    const correlationId = `chat-credit-${normalized.idempotencyKey}`.slice(0, 160);
    const paidOn = new Date().toISOString().slice(0, 10);

    let result;
    try {
      result = await withTransaction(
        pool,
        async (client) => {
          const purchase = await creditService.purchaseWithCreditInTransaction(client, {
            customerId: userId,
            partnerId: partner.id,
            amountCents: normalized.amountCents,
            currencyCode: normalized.currency,
            idempotencyKey: normalized.idempotencyKey,
            actorUserId: userId,
            actorType: 'customer',
            orderType: 'service',
            category: 'chat_payment',
            referenceType: 'chat_payment',
            referenceId: paymentRequest?.id || normalized.conversationId,
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
            },
          });

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
    const senderName =
      `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Provider';

    if (normalized.conversationId) {
      const conv = await assertConversationParticipant(userId, normalized.conversationId);
      if (!conv) return bad(res, 403, 'Not a conversation participant', 'forbidden');
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

    // Idempotent replay for provider request
    if (normalized.idempotencyKey) {
      const { rows: existing } = await pool.query(
        `SELECT * FROM chat_payment_requests
          WHERE requested_by = $1 AND idempotency_key = $2
          LIMIT 1`,
        [userId, normalized.idempotencyKey],
      );
      if (existing[0]) {
        return res.status(200).json({
          paymentRequest: toPublicPaymentRequestCard(existing[0]),
          replayed: true,
        });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO chat_payment_requests (
         conversation_id, guest_session_id, business_id, helper_id,
         quote_kind, quote_id, amount_cents, currency, memo,
         requested_by, idempotency_key, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open')
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
    const payReq = rows[0];
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
    if (normalized.conversationId) {
      message = await postConversationMessage(null, {
        conversationId: normalized.conversationId,
        senderId: userId,
        content,
        senderName,
      });
      await pool.query(
        'UPDATE chat_payment_requests SET message_id = $1, updated_at = NOW() WHERE id = $2',
        [String(message.id), payReq.id],
      );
    } else if (normalized.guestSessionId) {
      message = await postGuestMessage({
        guestSessionId: normalized.guestSessionId,
        senderName,
        content,
        helperId,
        senderType: 'helper',
      });
      await pool.query(
        'UPDATE chat_payment_requests SET message_id = $1, updated_at = NOW() WHERE id = $2',
        [String(message.id), payReq.id],
      );
    }

    return res.status(201).json({
      paymentRequest: toPublicPaymentRequestCard({ ...payReq, message_id: message?.id }),
      message,
      marker,
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

    const conv = await assertConversationParticipant(userId, conversationId);
    if (!conv) return bad(res, 403, 'Not a conversation participant', 'forbidden');

    const businessId = req.query.businessId || req.query.business_id || conv.business_id || null;
    const partnerResult = await resolveCreditPartner({ businessId });
    let account = null;
    try {
      account = await creditService.getCustomerCreditAccount(userId);
    } catch {
      account = null;
    }

    return res.json({
      canPay: Boolean(partnerResult.ok && isCustomerOnConversation(userId, conv)),
      isCustomer: isCustomerOnConversation(userId, conv),
      partnerEligible: Boolean(partnerResult.ok),
      partnerError: partnerResult.ok ? null : partnerResult.error,
      partnerCode: partnerResult.ok ? null : partnerResult.code,
      balanceCents: account?.availableBalanceCents ?? account?.balanceCents ?? null,
      currency: account?.currencyCode || creditService.CREDIT_CURRENCY || 'USD',
      method: CREDIT_PAY_METHOD,
    });
  } catch (err) {
    next(err);
  }
};

exports.resolveCreditPartner = resolveCreditPartner;
