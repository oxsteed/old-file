'use strict';

/**
 * OxSteed Logistics — OxSteed Credit payments (Phase 3).
 *
 * Owns the Credit rail integration for logistics buyer installments:
 *   - payLogisticsInstallmentWithCredit(): immediate debit per confirmed
 *     installment, recorded on the shared logistics_payment_attempts table
 *     (method='credit') through the same idempotent path the Stripe
 *     workstream uses. No parallel attempt system.
 *   - reverseLogisticsCreditPayment(): committed ledger reversal for the
 *     refunds workstream, registered via logisticsRefundPorts'
 *     setCreditReversalAdapter contract:
 *       ({ refundCaseId, amountCents, currency, idempotencyKey }) => { ledgerEntryId }
 *   - getLogisticsCreditPayAvailability(): read-only availability probe so
 *     the checkout UI can distinguish "rail disabled" from "insufficient
 *     funds" from "no logistics participant configured".
 *
 * Money rules (fail closed):
 *   - Integer minor units everywhere; USD only.
 *   - Launch flag LOGISTICS_CREDIT_PAY_ENABLED gates everything: payments
 *     stay disabled until merchant (participant) configuration is done.
 *   - Participant resolution: exactly one active, Didit-verified logistics
 *     participant with the 'logistics' surface allowed. Zero -> fail closed
 *     (not configured); more than one -> fail closed (ambiguous). Restaurant
 *     Credit accounts are never used and no default merchant is invented.
 *   - The installment amount is computed server-side from the accepted
 *     buyer quote; the caller-supplied amountCents must match exactly.
 *   - The subject row is locked (FOR UPDATE) so concurrent attempts for the
 *     same installment serialize; a second succeeded attempt (any method)
 *     for an installment fails closed.
 *   - The debit reuses the shared spend adapter (surface matrix 'logistics'
 *     -> debit) with all existing gates: rail, freeze, participant,
 *     agreement, balance, ledger idempotency.
 *   - Reversals use committed ledger reversals (refundCredit*) and are
 *     idempotent by idempotency key; the refund case is only marked
 *     processed after the ledger commit (the refunds workstream does that
 *     marking once this adapter returns).
 */

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const creditService = require('./oxsteedCreditService');
const { spendWithCreditInTransaction } = require('./creditSpendAdapter');
const {
  assertParticipantActive,
  assertSurfaceAllowed,
} = require('./creditParticipantService');
const { setCreditReversalAdapter } = require('./logisticsRefundPorts');

const LOGISTICS_SURFACE = 'logistics';
const LOGISTICS_PARTICIPANT_TYPE = 'logistics';
const LOGISTICS_CURRENCY = 'USD';
const LOGISTICS_REFERENCE_TYPE = 'logistics_payment_attempt';
const LOGISTICS_ORDER_TYPE = 'logistics';
const LOGISTICS_CATEGORY = 'logistics_installment';

const SUBJECT_TABLES = Object.freeze({
  purchase_order: 'purchase_orders',
  pooled_participant: 'pooled_order_participants',
});
const INSTALLMENTS = Object.freeze(['deposit', 'final']);

function logisticsCreditPayEnabled() {
  return process.env.LOGISTICS_CREDIT_PAY_ENABLED === '1';
}

function failClosed(message, status, code, details) {
  throw new AppError(message, status, code, details);
}

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s || null;
}

function parsePositiveInt(value, fieldName, code) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    failClosed(`${fieldName} must be a positive integer`, 400, code || 'validation_failed');
  }
  return n;
}

function requireIdempotencyKey(value) {
  const key = normalizeId(value);
  if (!key || key.length < 8) {
    failClosed('Idempotency-Key is required (min 8 chars)', 400, 'logistics_credit_idempotency_key_required');
  }
  if (key.length > 160) {
    failClosed('Idempotency-Key is too long', 400, 'logistics_credit_idempotency_key_required');
  }
  return key;
}

function creditPurchaseIdempotencyKey(attemptKey) {
  return `logistics-credit-purchase:${attemptKey}`.slice(0, 160);
}

function normalizeSubjectType(value) {
  const s = normalizeId(value);
  if (!s || !SUBJECT_TABLES[s]) {
    failClosed(`Unknown logistics payment subject: ${value}`, 400, 'logistics_subject_invalid');
  }
  return s;
}

function normalizeInstallment(value) {
  const s = normalizeId(value);
  if (!INSTALLMENTS.includes(s)) {
    failClosed(`Unknown installment: ${value}`, 400, 'logistics_installment_invalid');
  }
  return s;
}

// ─── Participant resolution ──────────────────────────────────
// Exactly one active logistics participant may exist: the admin-enrolled
// OxSteed collection entity. Zero -> not configured (fail closed, 503:
// payments stay disabled until merchant config is done). More than one ->
// ambiguous (fail closed, 503: operator must resolve).

async function resolveLogisticsParticipant(client) {
  const { rows } = await client.query(
    `SELECT cp.*,
            p.id AS partner_id,
            p.status AS partner_status,
            p.settlement_currency_code AS partner_settlement_currency
       FROM credit_participants cp
       JOIN oxsteed_credit_partners p ON p.id = cp.partner_id
      WHERE cp.participant_type = $1
        AND cp.status = 'active'
      ORDER BY cp.created_at DESC`,
    [LOGISTICS_PARTICIPANT_TYPE]
  );
  if (rows.length === 0) {
    failClosed(
      'OxSteed Credit is not configured for Logistics yet',
      503,
      'logistics_credit_participant_not_configured'
    );
  }
  if (rows.length > 1) {
    failClosed(
      'Multiple active Logistics Credit participants; operator must resolve',
      503,
      'logistics_credit_participant_ambiguous',
      { count: String(rows.length) }
    );
  }
  const row = rows[0];
  const { partner_id, partner_status, partner_settlement_currency, ...participant } = row;
  const resolved = {
    participant,
    partner: {
      id: partner_id,
      status: partner_status,
      settlement_currency_code: partner_settlement_currency,
    },
  };
  // Existing fail-closed gates: active participant, active partner, Didit.
  assertParticipantActive(resolved);
  // The logistics surface must be explicitly allowed on the participant.
  assertSurfaceAllowed(participant, LOGISTICS_SURFACE);
  return { participant, partnerId: partner_id, businessId: participant.business_id };
}

// ─── Subject + quote helpers ─────────────────────────────────

async function lockSubjectForUpdate(client, subjectType, subjectId) {
  const table = SUBJECT_TABLES[subjectType];
  const { rows } = await client.query(
    `SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`,
    [subjectId]
  );
  const row = rows[0];
  if (!row) {
    failClosed('Logistics payment subject not found', 404, 'logistics_subject_not_found');
  }
  return row;
}

function assertSubjectBelongsToBuyer(subjectType, subjectRow, buyerUserId) {
  const ownerId = subjectType === 'purchase_order' ? subjectRow.buyer_user_id : subjectRow.user_id;
  if (!ownerId || String(ownerId) !== String(buyerUserId)) {
    failClosed('This installment does not belong to the buyer', 403, 'logistics_buyer_mismatch');
  }
}

async function loadAcceptedQuote(client, { subjectType, subjectId, quoteId }) {
  const subjectColumn = subjectType === 'purchase_order' ? 'purchase_order_id' : 'participant_id';
  let rows;
  if (quoteId !== null && quoteId !== undefined) {
    const res = await client.query(
      `SELECT * FROM logistics_buyer_quotes WHERE id = $1 LIMIT 1`,
      [quoteId]
    );
    rows = res.rows;
    const quote = rows[0];
    if (!quote) failClosed('Quote not found', 404, 'logistics_quote_not_found');
    if (quote.subject_type !== subjectType || Number(quote[subjectColumn]) !== Number(subjectId)) {
      failClosed('Quote does not belong to this payment subject', 409, 'logistics_quote_subject_mismatch');
    }
  } else {
    const res = await client.query(
      `SELECT * FROM logistics_buyer_quotes
        WHERE subject_type = $1 AND ${subjectColumn} = $2 AND status = 'accepted'
        ORDER BY version DESC LIMIT 1`,
      [subjectType, subjectId]
    );
    rows = res.rows;
  }
  const quote = rows[0];
  if (!quote || quote.status !== 'accepted') {
    failClosed('No accepted quote for this installment', 409, 'logistics_quote_not_accepted');
  }
  if (quote.currency !== LOGISTICS_CURRENCY) {
    failClosed('Quote currency is not supported for Credit payment', 409, 'logistics_quote_currency_unsupported');
  }
  return quote;
}

function expectedInstallmentCents(quote, installment) {
  const cents = installment === 'deposit' ? quote.deposit_cents : quote.final_cents;
  const n = Number(cents);
  if (!Number.isSafeInteger(n) || n <= 0) {
    failClosed(`Quote has no payable ${installment} amount`, 409, 'logistics_installment_not_payable');
  }
  return n;
}

async function assertInstallmentUnpaid(client, { subjectType, subjectId, installment }) {
  const subjectColumn = subjectType === 'purchase_order' ? 'purchase_order_id' : 'participant_id';
  const { rows } = await client.query(
    `SELECT id, method, status FROM logistics_payment_attempts
      WHERE subject_type = $1 AND ${subjectColumn} = $2 AND installment = $3
        AND status = 'succeeded' LIMIT 1`,
    [subjectType, subjectId, installment]
  );
  if (rows[0]) {
    failClosed(
      'This installment is already paid; each installment uses one payment only',
      409,
      'logistics_installment_already_paid',
      { existingAttemptId: String(rows[0].id), existingMethod: rows[0].method }
    );
  }
}

// ─── Attempt helpers (shared idempotent path) ────────────────

async function findAttemptByKeyForUpdate(client, idempotencyKey) {
  const { rows } = await client.query(
    `SELECT * FROM logistics_payment_attempts WHERE idempotency_key = $1 FOR UPDATE`,
    [idempotencyKey]
  );
  return rows[0] || null;
}

async function findAttemptByIdOrKeyForUpdate(client, attemptId) {
  const { rows } = await client.query(
    `SELECT * FROM logistics_payment_attempts
      WHERE id::text = $1 OR idempotency_key = $1 FOR UPDATE LIMIT 1`,
    [String(attemptId)]
  );
  return rows[0] || null;
}

function assertAttemptMatchesRequest(attempt, { buyerUserId, subjectType, subjectId, installment, amountCents, idempotencyKey }) {
  const mismatches = [];
  if (String(attempt.buyer_user_id) !== String(buyerUserId)) mismatches.push('buyer');
  if (attempt.subject_type !== subjectType) mismatches.push('subject_type');
  const subjectColumn = subjectType === 'purchase_order' ? 'purchase_order_id' : 'participant_id';
  if (Number(attempt[subjectColumn]) !== Number(subjectId)) mismatches.push('subject');
  if (attempt.installment !== installment) mismatches.push('installment');
  if (Number(attempt.amount_cents) !== Number(amountCents)) mismatches.push('amount');
  if (attempt.idempotency_key !== idempotencyKey) mismatches.push('idempotency_key');
  if (attempt.method !== 'credit') mismatches.push('method');
  if (mismatches.length) {
    failClosed(
      'Idempotency key was already used for a different logistics payment',
      409,
      'logistics_credit_idempotency_conflict',
      { mismatches: mismatches.join(',') }
    );
  }
}

function formatAttemptResult(attempt, { replayed, creditTransactionId }) {
  return {
    attemptId: attempt.id,
    status: attempt.status,
    settledAt: attempt.settled_at ? new Date(attempt.settled_at).toISOString() : null,
    amountCents: Number(attempt.amount_cents),
    currency: attempt.currency,
    method: attempt.method,
    installment: attempt.installment,
    replayed: Boolean(replayed),
    creditTransactionId: creditTransactionId != null ? String(creditTransactionId) : null,
  };
}

async function lookupCreditPurchaseId(client, attempt) {
  const txn = await creditService.getExistingTransaction(client, creditPurchaseIdempotencyKey(attempt.idempotency_key));
  return txn ? txn.id : null;
}

// ─── Payment execution ───────────────────────────────────────

async function payLogisticsInstallmentInTransaction(client, args) {
  const {
    buyerUserId,
    subjectType: rawSubjectType,
    subjectId: rawSubjectId,
    installment: rawInstallment,
    quoteId = null,
    amountCents: rawAmountCents,
    idempotencyKey: rawIdempotencyKey,
    attemptId = null,
    actorUserId = null,
    requestIp = null,
    correlationId = null,
  } = args;

  const buyerId = normalizeId(buyerUserId);
  if (!buyerId) failClosed('buyerUserId is required', 400, 'logistics_buyer_required');
  const subjectType = normalizeSubjectType(rawSubjectType);
  const subjectId = parsePositiveInt(rawSubjectId, 'subjectId', 'logistics_subject_invalid');
  const installment = normalizeInstallment(rawInstallment);
  const amountCents = parsePositiveInt(rawAmountCents, 'amountCents', 'credit_amount_invalid');
  const key = requireIdempotencyKey(rawIdempotencyKey);

  // 1. Rail + freeze gates first: fail closed before any write.
  await creditService.assertCreditRailEnabled(client);

  // 2. Lock the subject so concurrent attempts for one installment serialize.
  const subjectRow = await lockSubjectForUpdate(client, subjectType, subjectId);
  assertSubjectBelongsToBuyer(subjectType, subjectRow, buyerId);

  // 3. Server-side amount: the accepted quote decides the installment
  //    amount. Client-supplied amounts are never trusted.
  const quote = await loadAcceptedQuote(client, {
    subjectType,
    subjectId,
    quoteId: quoteId === null || quoteId === undefined ? null : quoteId,
  });
  const expectedCents = expectedInstallmentCents(quote, installment);
  if (amountCents !== expectedCents) {
    failClosed(
      `Installment amount must be ${expectedCents} cents per the accepted quote`,
      409,
      'logistics_credit_amount_mismatch',
      { expectedCents: String(expectedCents), requestedCents: String(amountCents) }
    );
  }

  // 4. Resolve the explicitly approved logistics participant. Zero or
  //    ambiguous -> fail closed; never a restaurant account, never a
  //    default merchant.
  const { businessId } = await resolveLogisticsParticipant(client);

  // 5. Find-or-create the attempt on the shared idempotent path. This runs
  //    BEFORE the installment-paid gate so a retry with the same key
  //    replays the succeeded attempt instead of failing as "already paid".
  let attempt;
  if (attemptId !== null && attemptId !== undefined) {
    attempt = await findAttemptByIdOrKeyForUpdate(client, attemptId);
    if (!attempt) failClosed('Payment attempt not found', 404, 'logistics_attempt_not_found');
  } else {
    const inserted = await client.query(
      `INSERT INTO logistics_payment_attempts
         (idempotency_key, buyer_user_id, subject_type,
          purchase_order_id, participant_id, quote_id,
          installment, amount_cents, currency, method, status)
       VALUES ($1, $2, $3,
               CASE WHEN $3 = 'purchase_order' THEN $4::integer END,
               CASE WHEN $3 = 'pooled_participant' THEN $4::integer END,
               $5, $6, $7, 'USD', 'credit', 'pending')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [key, buyerId, subjectType, subjectId, quote.id, installment, expectedCents]
    );
    attempt = inserted.rows[0] || null;
    if (!attempt) {
      // Lost the insert race: the winner's row is authoritative. FOR UPDATE
      // waits for the winner's transaction to commit before we read it.
      attempt = await findAttemptByKeyForUpdate(client, key);
    }
  }
  if (!attempt) {
    failClosed('Payment attempt could not be established', 500, 'logistics_attempt_unavailable');
  }
  assertAttemptMatchesRequest(attempt, {
    buyerUserId: buyerId, subjectType, subjectId, installment, amountCents: expectedCents, idempotencyKey: key,
  });

  if (attempt.status === 'succeeded') {
    // Idempotent replay: the debit already happened under the derived
    // ledger key; never debit again.
    const creditTransactionId = await lookupCreditPurchaseId(client, attempt);
    logger.info('logistics_credit_pay.replay', {
      attemptId: attempt.id, installment, amountCents: expectedCents,
    });
    return formatAttemptResult(attempt, { replayed: true, creditTransactionId });
  }
  if (attempt.status !== 'pending' && attempt.status !== 'processing') {
    failClosed(
      `Payment attempt is ${attempt.status} and cannot be paid`,
      409,
      'logistics_attempt_not_payable',
      { status: attempt.status }
    );
  }

  // 6. One installment, one payment, one method. A succeeded attempt of any
  //    method blocks a second payment (no mixed funding, no double pay).
  //    The current attempt is still pending/processing, so it never trips
  //    its own gate.
  await assertInstallmentUnpaid(client, { subjectType, subjectId, installment });

  // Mark processing before the debit so a concurrent duplicate with the
  // same key converges instead of double-debiting.
  await client.query(
    `UPDATE logistics_payment_attempts SET status = 'processing', updated_at = NOW() WHERE id = $1`,
    [attempt.id]
  );

  // 7. Debit via the shared spend adapter: surface matrix enforces
  //    logistics -> debit; rail/freeze/participant/agreement/balance/ledger
  //    gates all run inside. The derived ledger key makes retries replay
  //    instead of double-debiting.
  const purchaseKey = creditPurchaseIdempotencyKey(key);
  const spendResult = await spendWithCreditInTransaction(client, {
    participantRef: { type: LOGISTICS_PARTICIPANT_TYPE, subjectId: String(businessId) },
    customerId: buyerId,
    amountCents: expectedCents,
    currency: LOGISTICS_CURRENCY,
    surface: LOGISTICS_SURFACE,
    mode: 'debit',
    referenceType: LOGISTICS_REFERENCE_TYPE,
    referenceId: String(attempt.id),
    idempotencyKey: purchaseKey,
    actorUserId: actorUserId || buyerId,
    orderType: LOGISTICS_ORDER_TYPE,
    category: LOGISTICS_CATEGORY,
    correlationId: correlationId || `logistics-credit-${key}`.slice(0, 160),
    requestIp,
    description: `Logistics ${installment} installment`,
    metadata: {
      logisticsAttemptId: String(attempt.id),
      logisticsQuoteId: String(quote.id),
      logisticsInstallment: installment,
      logisticsSubjectType: subjectType,
      logisticsSubjectId: String(subjectId),
    },
  });
  const purchaseReplayed = Boolean(spendResult?.purchase?.replayed);
  const creditTransactionId = spendResult?.purchase?.transaction?.id ?? null;

  // 8. Settle the attempt and the subject's paid state in the same
  //    transaction as the debit: all commit together or all roll back.
  //    The integer *_paid_cents columns are the money-safe source of truth
  //    (migration 874). Legacy read columns are mirrored exactly:
  //    purchase_orders tracks paid floats; pooled_order_participants tracks
  //    paid timestamps (its *_usd columns are amounts due, not paid).
  const paidColumn = installment === 'deposit' ? 'deposit_paid_cents' : 'final_paid_cents';
  const paidAtColumn = installment === 'deposit' ? 'deposit_paid_at' : 'final_paid_at';
  const subjectTable = SUBJECT_TABLES[subjectType];
  await client.query(
    `UPDATE logistics_payment_attempts
        SET status = 'succeeded', settled_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [attempt.id]
  );
  if (subjectType === 'purchase_order') {
    const legacyFloatColumn = installment === 'deposit' ? 'deposit_paid_usd' : 'final_paid_usd';
    await client.query(
      `UPDATE ${subjectTable}
          SET ${paidColumn} = ${paidColumn} + $2,
              ${legacyFloatColumn} = (${paidColumn} + $2)::numeric / 100,
              ${paidAtColumn} = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [subjectId, expectedCents]
    );
  } else {
    await client.query(
      `UPDATE ${subjectTable}
          SET ${paidColumn} = ${paidColumn} + $2,
              ${paidAtColumn} = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [subjectId, expectedCents]
    );
  }
  const { rows: [settled] } = await client.query(
    `SELECT * FROM logistics_payment_attempts WHERE id = $1`,
    [attempt.id]
  );

  logger.info('logistics_credit_pay.succeeded', {
    attemptId: attempt.id,
    installment,
    amountCents: expectedCents,
    replayed: purchaseReplayed,
    creditTransactionId,
  });
  return formatAttemptResult(settled, { replayed: purchaseReplayed, creditTransactionId });
}

async function payLogisticsInstallmentWithCredit(args) {
  const { isImpersonated = false } = args || {};
  if (!logisticsCreditPayEnabled()) {
    failClosed(
      'OxSteed Credit payments for Logistics are not enabled yet',
      503,
      'logistics_credit_pay_disabled'
    );
  }
  if (isImpersonated) {
    failClosed('Impersonated sessions cannot spend OxSteed Credit', 403, 'impersonation_blocked');
  }
  return withTransaction(pool, (client) => payLogisticsInstallmentInTransaction(client, args), 'logistics_credit_pay');
}

// ─── Availability probe (read-only, for the checkout UI) ────

async function getLogisticsCreditPayAvailability() {
  if (!logisticsCreditPayEnabled()) {
    return { available: false, code: 'logistics_credit_pay_disabled', message: 'OxSteed Credit payments for Logistics are not enabled yet' };
  }
  let railEnabled = false;
  try {
    railEnabled = await creditService.isCreditRailEnabled(pool);
  } catch {
    return { available: false, code: 'credit_rail_status_unavailable', message: 'OxSteed Credit status is temporarily unavailable' };
  }
  if (!railEnabled) {
    return { available: false, code: 'credit_rail_suspended', message: 'OxSteed Credit is temporarily suspended' };
  }
  try {
    if (await creditService.isCreditRailFrozen(pool)) {
      return { available: false, code: 'credit_rail_frozen', message: 'OxSteed Credit is temporarily frozen' };
    }
  } catch {
    return { available: false, code: 'credit_rail_frozen', message: 'OxSteed Credit freeze state is unavailable' };
  }
  try {
    const { partnerId } = await resolveLogisticsParticipant(pool);
    return { available: true, code: 'ok', partnerId };
  } catch (err) {
    if (err && (err.code === 'logistics_credit_participant_not_configured' || err.code === 'logistics_credit_participant_ambiguous')) {
      return { available: false, code: err.code, message: err.message };
    }
    // Participant gates (Didit, surface, partner status) surface as 403s;
    // surface them distinctly from "not configured".
    return { available: false, code: (err && err.code) || 'credit_participant_not_active', message: (err && err.message) || 'Logistics Credit participant is not active' };
  }
}

// ─── Credit reversal (refunds workstream) ────────────────────
// Contract (logisticsRefundPorts): ({ refundCaseId, amountCents, currency,
// idempotencyKey }) => { ledgerEntryId }. The refunds workstream marks the
// case 'processed' only after this returns, i.e. only after the ledger
// commit. Idempotent: the same idempotencyKey replays the committed
// reversal instead of posting a second one. Rail state is intentionally
// NOT gated: returning funds to the original source must keep working
// while the rail is suspended or frozen.

async function reverseLogisticsCreditPayment({ refundCaseId, amountCents, currency, idempotencyKey }) {
  const caseId = parsePositiveInt(refundCaseId, 'refundCaseId', 'refund_case_invalid');
  const cents = parsePositiveInt(amountCents, 'amountCents', 'credit_amount_invalid');
  const key = requireIdempotencyKey(idempotencyKey);
  const currencyCode = String(currency || '').trim().toUpperCase();
  if (currencyCode !== LOGISTICS_CURRENCY) {
    failClosed('Only USD credit reversals are supported', 400, 'logistics_refund_currency_unsupported');
  }

  return withTransaction(pool, async (client) => {
    const { rows: caseRows } = await client.query(
      `SELECT * FROM logistics_refund_cases WHERE id = $1 FOR UPDATE`,
      [caseId]
    );
    const kase = caseRows[0];
    if (!kase) failClosed('Refund case not found', 404, 'refund_case_not_found');
    if (kase.amount_cents != null && Number(kase.amount_cents) !== cents) {
      failClosed('Reversal amount does not match the approved refund amount', 409, 'logistics_refund_amount_mismatch');
    }

    const attemptId = normalizeId(kase.original_payment_attempt_id);
    if (!attemptId) {
      failClosed('Refund case has no linked payment attempt', 409, 'refund_payment_attempt_not_found');
    }
    const { rows: attemptRows } = await client.query(
      `SELECT * FROM logistics_payment_attempts WHERE id::text = $1 LIMIT 1`,
      [attemptId]
    );
    const attempt = attemptRows[0];
    if (!attempt) failClosed('Original payment attempt not found', 404, 'refund_payment_attempt_not_found');
    if (attempt.method !== 'credit') {
      failClosed('Original payment was not made with OxSteed Credit', 409, 'refund_method_mismatch');
    }
    if (attempt.status !== 'succeeded') {
      failClosed('Original credit payment is not in a succeeded state', 409, 'refund_payment_not_refundable');
    }

    // Committed ledger reversal, idempotent by idempotency key. The core
    // caps total refunds at the original purchase amount and replays on
    // key reuse, so retries can never double-refund.
    const result = await creditService.refundCreditForReferenceInTransaction(client, {
      referenceType: LOGISTICS_REFERENCE_TYPE,
      referenceId: String(attempt.id),
      amountCents: cents,
      idempotencyKey: key,
      actorType: 'system',
      reason: `Logistics refund case ${kase.reference || caseId}`,
      correlationId: `logistics-credit-refund-${key}`.slice(0, 160),
      metadata: {
        logisticsRefundCaseId: String(caseId),
        logisticsAttemptId: String(attempt.id),
        logisticsRefund: true,
      },
    });
    const ledgerEntryId = result?.transaction?.id != null ? String(result.transaction.id) : null;
    logger.info('logistics_credit_pay.reversed', {
      refundCaseId: caseId, attemptId: attempt.id, amountCents: cents,
      ledgerEntryId, replayed: Boolean(result?.replayed),
    });
    return { ledgerEntryId, replayed: Boolean(result?.replayed) };
  }, 'logistics_credit_refund');
}

// Register the reversal adapter for the refunds workstream. Until this
// module is loaded, credit refunds fail closed with
// credit_reversal_unavailable (see logisticsRefundPorts).
setCreditReversalAdapter(reverseLogisticsCreditPayment);

module.exports = {
  LOGISTICS_SURFACE,
  LOGISTICS_CURRENCY,
  LOGISTICS_REFERENCE_TYPE,
  logisticsCreditPayEnabled,
  resolveLogisticsParticipant,
  payLogisticsInstallmentWithCredit,
  payLogisticsInstallmentInTransaction,
  getLogisticsCreditPayAvailability,
  reverseLogisticsCreditPayment,
};
