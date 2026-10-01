'use strict';

/**
 * OxSteed Credit Stripe chargeback ingestion (Phase 8).
 *
 * Stripe dispute webhooks (charge.dispute.created/updated/closed) whose
 * charge was a credit top-up PaymentIntent are mapped to a credit dispute
 * on the linked journal transaction:
 *
 *   dispute.payment_intent
 *     -> oxsteed_credit_topups.stripe_payment_intent_id
 *     -> journal_transaction_id
 *     -> oxsteed_credit_disputes (system-opened, dispute_type 'chargeback',
 *        idempotency key 'credit-dispute-chargeback:<stripeDisputeId>')
 *
 * Stripe dispute status mapping:
 *   needs_response / warning_needs_response -> open the dispute
 *   under_review / warning_under_review     -> move open -> in_review
 *   closed + lost -> resolve in the customer's favor with compensation =
 *     the disputed amount (capped at the transaction amount), posted as new
 *     compensating entries; the original journal entries are never edited
 *   closed + won  -> resolve in the merchant's favor (no money movement)
 *   anything else -> logged and skipped
 *
 * The legacy fraud-case path (recordChargeDisputeCase) is untouched: this
 * runs after it in the webhook controller and only touches rows whose
 * PaymentIntent backs a credit top-up. Non-credit disputes return
 * { outcome: 'ignored' } without failing the webhook.
 *
 * Fail-closed: the rail kill switch is asserted before any state change.
 * The lookup that decides "is this ours" is a read and runs first, so a
 * frozen rail does not fail unrelated dispute webhooks.
 *
 * A human decision always wins: if the dispute is already terminal with a
 * different outcome when the webhook arrives, ingestion records a critical
 * incident and changes nothing instead of fighting the human from a
 * webhook (Stripe will redeliver, and the redelivery stays a no-op).
 */

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const {
  assertCreditRailEnabled,
  openSystemCreditDispute,
} = require('./oxsteedCreditService');
const {
  DISPUTE_TERMINAL_STATUSES,
  resolveDisputeWithCompensation,
} = require('./oxsteedCreditDisputeService');
const { recordIncident } = require('./incidentStore');

const CHARGEBACK_DISPUTE_IDEMPOTENCY_PREFIX = 'credit-dispute-chargeback:';
const CHARGEBACK_DISPUTE_TYPE = 'chargeback';
const CHARGEBACK_REASON_CODE = 'chargeback';

const REVIEW_STATUSES = new Set(['under_review', 'warning_under_review']);

function chargebackIdempotencyKey(stripeDisputeId) {
  return `${CHARGEBACK_DISPUTE_IDEMPOTENCY_PREFIX}${String(stripeDisputeId)}`;
}

function describeDispute(dispute) {
  const amount = Number(dispute.amount || 0);
  const reason = dispute.reason || 'unknown reason';
  return `Stripe chargeback ${dispute.id} (${reason}) for ${amount} cents`;
}

async function findLinkedTopup(paymentIntentId) {
  if (!paymentIntentId) return null;
  const { rows } = await pool.query(
    `SELECT id, customer_id, journal_transaction_id, stripe_payment_intent_id,
            amount_cents, currency_code, status
       FROM oxsteed_credit_topups
      WHERE stripe_payment_intent_id = $1`,
    [paymentIntentId]
  );
  return rows[0] || null;
}

async function recordTerminalConflict({ dispute, creditDispute, expectedDecision }) {
  try {
    await recordIncident({
      type: 'oxsteed_credit_chargeback_terminal_conflict',
      severity: 'critical',
      message: 'Stripe chargeback closed but the credit dispute was already resolved differently by a human',
      dedupeKey: `credit-chargeback-conflict:${dispute.id}`,
      details: {
        stripeDisputeId: dispute.id,
        disputeId: String(creditDispute.id),
        creditDisputeStatus: creditDispute.status,
        expectedDecision,
        stripeStatus: dispute.status,
      },
    });
  } catch (incidentErr) {
    logger.error('[oxsteed-credit] Failed to record chargeback terminal-conflict incident', {
      stripeDisputeId: dispute.id,
      error: incidentErr.message,
    });
  }
}

// Open (or find) the system dispute for this chargeback. Returns the
// resolver-shaped { dispute, replayed } or { outcome: 'unlinked' } when the
// top-up never completed and therefore has no journal transaction to
// dispute.
async function openChargebackDispute({ topup, dispute, requestIp }) {
  if (!topup.journal_transaction_id) {
    try {
      await recordIncident({
        type: 'oxsteed_credit_chargeback_unlinked',
        severity: 'warning',
        message: 'Stripe chargeback arrived for a credit top-up with no journal transaction',
        dedupeKey: `credit-chargeback-unlinked:${dispute.id}`,
        details: {
          stripeDisputeId: dispute.id,
          topupId: String(topup.id),
          topupStatus: topup.status,
        },
      });
    } catch (incidentErr) {
      logger.error('[oxsteed-credit] Failed to record unlinked chargeback incident', {
        stripeDisputeId: dispute.id,
        error: incidentErr.message,
      });
    }
    return { outcome: 'unlinked' };
  }
  return openSystemCreditDispute({
    customerId: topup.customer_id,
    transactionId: topup.journal_transaction_id,
    reasonCode: CHARGEBACK_REASON_CODE,
    description: describeDispute(dispute),
    idempotencyKey: chargebackIdempotencyKey(dispute.id),
    requestIp: requestIp || null,
    disputeType: CHARGEBACK_DISPUTE_TYPE,
  });
}

// Strict transition map: the resolver only moves open -> in_review ->
// terminal, so a closed webhook on an open dispute steps through in_review
// first.
async function moveToInReviewIfOpen({ creditDispute, dispute, requestIp }) {
  if (creditDispute.status !== 'open') return creditDispute;
  const moved = await resolveDisputeWithCompensation({
    disputeId: creditDispute.id,
    decision: 'in_review',
    reason: `Stripe chargeback ${dispute.id} is under review`,
    actorType: 'system',
    requestIp: requestIp || null,
  });
  return moved.dispute;
}

async function resolveLostChargeback({ topup, dispute, creditDispute, requestIp }) {
  const inReview = await moveToInReviewIfOpen({ creditDispute, dispute, requestIp });
  if (inReview.status === 'resolved_customer') {
    return { outcome: 'duplicate', dispute: inReview };
  }
  if (DISPUTE_TERMINAL_STATUSES.includes(inReview.status)) {
    await recordTerminalConflict({ dispute, creditDispute: inReview, expectedDecision: 'resolved_customer' });
    return { outcome: 'conflict', dispute: inReview };
  }
  // Cap the compensation at the top-up amount; the resolver enforces the
  // transaction-amount cap again as a backstop.
  const compensationCents = Math.max(0, Math.min(Number(dispute.amount || 0), Number(topup.amount_cents || 0)));
  const resolved = await resolveDisputeWithCompensation({
    disputeId: inReview.id,
    decision: 'resolved_customer',
    reason: `Stripe chargeback ${dispute.id} lost; compensating the customer for the disputed amount`,
    compensationCents,
    actorType: 'system',
    requestIp: requestIp || null,
  });
  return {
    outcome: resolved.replayed ? 'duplicate' : 'resolved_customer',
    dispute: resolved.dispute,
    compensation: resolved.compensation,
  };
}

async function resolveWonChargeback({ dispute, creditDispute, requestIp }) {
  const inReview = await moveToInReviewIfOpen({ creditDispute, dispute, requestIp });
  if (inReview.status === 'resolved_merchant') {
    return { outcome: 'duplicate', dispute: inReview };
  }
  if (DISPUTE_TERMINAL_STATUSES.includes(inReview.status)) {
    await recordTerminalConflict({ dispute, creditDispute: inReview, expectedDecision: 'resolved_merchant' });
    return { outcome: 'conflict', dispute: inReview };
  }
  const resolved = await resolveDisputeWithCompensation({
    disputeId: inReview.id,
    decision: 'resolved_merchant',
    reason: `Stripe chargeback ${dispute.id} won; no compensation is owed`,
    compensationCents: 0,
    actorType: 'system',
    requestIp: requestIp || null,
  });
  return { outcome: resolved.replayed ? 'duplicate' : 'resolved_merchant', dispute: resolved.dispute };
}

async function ingestStripeChargeback({ eventType, dispute, requestIp = null } = {}) {
  if (!dispute || !dispute.id) {
    throw new AppError('A Stripe dispute object is required', 400, 'credit_chargeback_dispute_required');
  }
  const stripeStatus = String(dispute.status || '');

  // Read-only lookup first: non-credit disputes are ignored without
  // touching the rail gate, so a frozen rail cannot fail unrelated
  // dispute webhooks.
  const topup = await findLinkedTopup(dispute.payment_intent || null);
  if (!topup) {
    return { outcome: 'ignored', reason: 'not_a_credit_topup' };
  }

  // Fail closed when the rail is disabled or frozen: from here on the
  // ingestion changes ledger-adjacent state.
  await assertCreditRailEnabled(pool);

  if (eventType === 'charge.dispute.closed') {
    if (stripeStatus === 'lost') {
      const opened = await openChargebackDispute({ topup, dispute, requestIp });
      if (opened.outcome === 'unlinked') return opened;
      return resolveLostChargeback({ topup, dispute, creditDispute: opened.dispute, requestIp });
    }
    if (stripeStatus === 'won') {
      const opened = await openChargebackDispute({ topup, dispute, requestIp });
      if (opened.outcome === 'unlinked') return opened;
      return resolveWonChargeback({ dispute, creditDispute: opened.dispute, requestIp });
    }
    logger.warn('[oxsteed-credit] Skipping chargeback with unknown closed status', {
      stripeDisputeId: dispute.id,
      stripeStatus,
    });
    return { outcome: 'skipped', reason: `unknown_closed_status_${stripeStatus || 'empty'}` };
  }

  // created / updated: open the dispute; move open -> in_review when Stripe
  // says the dispute is under review.
  const opened = await openChargebackDispute({ topup, dispute, requestIp });
  if (opened.outcome === 'unlinked') return opened;
  if (REVIEW_STATUSES.has(stripeStatus) && opened.dispute.status === 'open') {
    const moved = await moveToInReviewIfOpen({ creditDispute: opened.dispute, dispute, requestIp });
    return { outcome: opened.replayed ? 'duplicate' : 'in_review', dispute: moved };
  }
  return { outcome: opened.replayed ? 'duplicate' : 'opened', dispute: opened.dispute };
}

module.exports = {
  CHARGEBACK_DISPUTE_IDEMPOTENCY_PREFIX,
  ingestStripeChargeback,
};
