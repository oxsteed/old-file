'use strict';

/**
 * OxSteed Credit dispute automation (Phase 7, gap 10).
 *
 * Compensated resolutions and the SLA breach sweep. The customer-facing
 * open/list paths and the legacy resolveCreditDispute stay in
 * oxsteedCreditService.js; this module owns the admin path that can move
 * money.
 *
 * Resolution rules:
 * - Strict transition map: open -> in_review -> terminal. Terminal states
 *   (resolved, rejected, resolved_customer, resolved_merchant) never
 *   reopen. 'resolved' is legacy and never produced by this service.
 * - A resolution note is required for every decision.
 * - Compensation posts ONLY when the decision is resolved_customer and
 *   compensationCents > 0, and it is append-only: the original ledger
 *   entries are never edited. The compensation amount cannot exceed the
 *   disputed amount. When the disputed transaction is a purchase and the
 *   refund cap allows it, compensation posts as a refund; otherwise it
 *   posts as an adjustment credit (platform_treasury -> customer_wallet)
 *   with reference_type 'oxsteed_credit_dispute'. The deterministic
 *   idempotency key 'credit-dispute-compensation:<disputeId>' makes
 *   retries safe.
 * - Disputes are never auto-resolved in the customer's favor: the SLA
 *   sweep raises a critical incident per breached dispute and changes
 *   nothing else.
 */

const pool = require('../db');
const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const {
  normalizeString,
  formatDispute,
  assertCreditRailEnabled,
  refundCreditInTransaction,
  adjustCustomerCreditInTransaction,
} = require('./oxsteedCreditService');
const { recordIncident } = require('./incidentStore');

const DISPUTE_SLA_HOURS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_DISPUTE_SLA_HOURS || '72', 10) || 72
);

const DISPUTE_TYPES = Object.freeze([
  'unauthorized_topup',
  'failed_payout',
  'duplicate_charge',
  'incorrect_amount',
  'chargeback',
]);

const DISPUTE_DECISIONS = Object.freeze(['in_review', 'resolved_customer', 'resolved_merchant', 'rejected']);
const DISPUTE_TERMINAL_STATUSES = Object.freeze(['resolved', 'rejected', 'resolved_customer', 'resolved_merchant']);

function compensationIdempotencyKey(disputeId) {
  return `credit-dispute-compensation:${String(disputeId)}`;
}

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

async function resolveDisputeWithCompensation({
  disputeId,
  adminId,
  decision,
  reason,
  compensationCents = 0,
  requestIp,
  correlationId,
  // Phase 8: Stripe chargeback ingestion resolves as a system actor (no
  // admin identity). Money still moves only through the same append-only
  // compensation legs; the audit trail records the system actor.
  actorType = 'admin',
}) {
  // Fail closed when the credit rail is frozen: resolutions (and their
  // compensation legs) are money movement.
  await assertCreditRailEnabled(pool);
  const normalizedDecision = normalizeString(decision, 20);
  const normalizedReason = normalizeString(reason, 4000);
  const normalizedActorType = normalizeString(actorType, 20) || 'admin';
  if (!['admin', 'system'].includes(normalizedActorType)) {
    throw new AppError('Invalid credit dispute resolution actor', 400, 'credit_dispute_actor_invalid');
  }
  if (!DISPUTE_DECISIONS.includes(normalizedDecision)) {
    throw new AppError('Invalid dispute resolution decision', 400, 'credit_dispute_decision_invalid');
  }
  if (!normalizedReason) throw new AppError('A resolution note is required', 400, 'credit_dispute_resolution_required');
  if (normalizedActorType === 'admin' && !adminId) throw new AppError('An administrator identity is required to resolve a credit dispute', 403, 'credit_dispute_actor_required');
  const compensation = parsePositiveInt(compensationCents);
  if (compensationCents !== 0 && compensationCents !== null && compensationCents !== undefined && compensation === 0 && Number(compensationCents) !== 0) {
    throw new AppError('Compensation must be a positive integer number of cents', 400, 'credit_dispute_compensation_invalid');
  }
  if (compensation > 0 && normalizedDecision !== 'resolved_customer') {
    throw new AppError('Compensation is only allowed when resolving in the customer\'s favor', 400, 'credit_dispute_compensation_invalid');
  }

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT d.*, fr.display_name AS restaurant_name
         FROM oxsteed_credit_disputes d
         LEFT JOIN oxsteed_credit_partners p ON p.id = d.partner_id
         LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE d.id = $1
        FOR UPDATE`,
      [disputeId]
    );
    const dispute = rows[0];
    if (!dispute) throw new AppError('Credit dispute not found', 404, 'credit_dispute_not_found');

    if (DISPUTE_TERMINAL_STATUSES.includes(dispute.status)) {
      if (dispute.status === normalizedDecision) {
        return { dispute: formatDispute(dispute), compensation: null, replayed: true };
      }
      throw new AppError('A closed credit dispute cannot be reopened', 409, 'credit_dispute_state_invalid');
    }
    // Strict map: open -> in_review -> terminal. The DB trigger is a
    // backstop; this service never takes the legacy open -> terminal path.
    if (dispute.status === 'open' && normalizedDecision !== 'in_review') {
      throw new AppError('An open dispute must be moved to in_review before resolution', 400, 'credit_dispute_transition_invalid');
    }
    if (dispute.status === 'in_review' && normalizedDecision === 'in_review') {
      return { dispute: formatDispute(dispute), compensation: null, replayed: true };
    }

    const { rows: transactionRows } = await client.query(
      `SELECT id, amount_cents, currency_code, transaction_type
         FROM oxsteed_credit_transactions
        WHERE id = $1`,
      [dispute.transaction_id]
    );
    const transaction = transactionRows[0];
    if (!transaction) throw new AppError('Disputed credit transaction not found', 404, 'credit_transaction_not_found');

    let compensationEntry = null;
    if (compensation > 0) {
      const disputedAmount = Number(transaction.amount_cents || 0);
      const provisionalIssued = Number(dispute.provisional_credit_cents || 0);
      if (compensation + provisionalIssued > disputedAmount) {
        throw new AppError('Compensation cannot exceed the disputed amount', 400, 'credit_dispute_compensation_exceeds');
      }
      const idempotencyKey = compensationIdempotencyKey(dispute.id);
      const metadata = { disputeId: String(dispute.id), compensation: true, source: 'super_admin_dispute_resolution' };
      if (transaction.transaction_type === 'purchase') {
        // Refund path, but only when the refund cap allows it; otherwise
        // fall through to the adjustment path below.
        const { rows: refundRows } = await client.query(
          `SELECT COALESCE(SUM(amount_cents), 0) AS refunded_cents
             FROM oxsteed_credit_transactions
            WHERE transaction_type = 'refund' AND status = 'posted'
              AND reference_type = 'oxsteed_credit_purchase' AND reference_id = $1`,
          [String(transaction.id)]
        );
        const refunded = Number(refundRows[0]?.refunded_cents || 0);
        if (refunded + compensation + provisionalIssued <= disputedAmount) {
          const refundResult = await refundCreditInTransaction(client, {
            purchaseTransactionId: transaction.id,
            amountCents: compensation,
            idempotencyKey,
            actorUserId: adminId,
            actorType: normalizedActorType,
            reason: normalizedReason,
            correlationId: correlationId || null,
            requestIp: requestIp || null,
            metadata,
          });
          compensationEntry = {
            kind: 'refund',
            transactionId: refundResult?.transaction?.id || null,
            amountCents: compensation,
          };
        }
      }
      if (!compensationEntry) {
        const adjustmentResult = await adjustCustomerCreditInTransaction(client, {
          customerId: dispute.customer_id,
          amountCents: compensation,
          currencyCode: transaction.currency_code,
          direction: 'credit',
          idempotencyKey,
          actorUserId: adminId,
          actorType: normalizedActorType,
          reason: normalizedReason,
          referenceType: 'oxsteed_credit_dispute',
          referenceId: String(dispute.id),
          correlationId: correlationId || null,
          requestIp: requestIp || null,
          metadata,
        });
        compensationEntry = {
          kind: 'adjustment',
          transactionId: adjustmentResult?.transaction?.id || null,
          amountCents: compensation,
        };
      }
    }

    const isTerminal = DISPUTE_TERMINAL_STATUSES.includes(normalizedDecision);
    const decidedBy = normalizedActorType === 'system' ? 'system:stripe_chargeback' : adminId;
    const resolutionEntries = {
      ...(dispute.resolution_entries || {}),
      ...(compensationEntry ? { compensation: { ...compensationEntry, decidedBy, decidedAt: new Date().toISOString() } } : {}),
    };
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_disputes
          SET status = $1,
              resolution = COALESCE($2, resolution),
              resolved_by = CASE WHEN $6 THEN $3 ELSE resolved_by END,
              resolved_at = CASE WHEN $6 THEN NOW() ELSE resolved_at END,
              resolution_entries = $4::jsonb,
              updated_at = NOW()
        WHERE id = $5
        RETURNING *`,
      [normalizedDecision, normalizedReason, adminId, JSON.stringify(resolutionEntries), dispute.id, isTerminal]
    );
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason, request_ip, before_state, after_state)
       VALUES ('credit.dispute.status_changed', $1, $2, $3, 'credit_dispute', $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        adminId,
        dispute.customer_id,
        dispute.partner_id || null,
        String(dispute.id),
        normalizedReason,
        requestIp || null,
        JSON.stringify({ status: dispute.status }),
        JSON.stringify({ status: normalizedDecision, compensation: compensationEntry }),
      ]
    );
    return {
      dispute: formatDispute({ ...updatedRows[0], restaurant_name: dispute.restaurant_name }),
      compensation: compensationEntry,
      replayed: false,
    };
  }, 'credit_resolve_dispute_compensated');
}

/**
 * SLA breach sweep: every open/in_review dispute past its sla_due_at
 * raises a critical incident (deduped per dispute). The sweep never
 * resolves or auto-clears disputes; outcomes stay human-decided.
 */
async function checkDisputeSla({ now = new Date(), client: providedClient = null } = {}) {
  const run = async (client) => {
    const { rows } = await client.query(
      `SELECT id, customer_id, partner_id, transaction_id, status, dispute_type, sla_due_at, reason_code
         FROM oxsteed_credit_disputes
        WHERE status IN ('open', 'in_review')
          AND sla_due_at IS NOT NULL
          AND sla_due_at < $1`,
      [now]
    );
    const incidents = [];
    for (const dispute of rows) {
      const incident = await recordIncident({
        type: 'oxsteed_credit_dispute_sla_breach',
        severity: 'critical',
        message: `OxSteed Credit dispute ${dispute.id} (${dispute.status}) breached its resolution SLA`,
        dedupeKey: `credit-dispute-sla:${dispute.id}`,
        details: {
          disputeId: String(dispute.id),
          customerId: dispute.customer_id,
          partnerId: dispute.partner_id,
          transactionId: String(dispute.transaction_id),
          status: dispute.status,
          disputeType: dispute.dispute_type,
          slaDueAt: dispute.sla_due_at,
          reasonCode: dispute.reason_code,
        },
      });
      if (incident) incidents.push(incident);
    }
    return { breachedCount: rows.length, incidents };
  };
  if (providedClient) return run(providedClient);
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

module.exports = {
  DISPUTE_SLA_HOURS,
  DISPUTE_TYPES,
  DISPUTE_DECISIONS,
  DISPUTE_TERMINAL_STATUSES,
  resolveDisputeWithCompensation,
  issueProvisionalCredit,
  checkDisputeSla,
};

/**
 * Provisional credit for a dispute under review.
 *
 * The published error-resolution policy promises provisional credit while an
 * investigation runs past the internal SLA. Unlike final compensation, this
 * keeps the dispute open (in_review): the money moves as an append-only
 * adjustment from platform_treasury to the customer wallet, and the dispute
 * records the cumulative provisional amount so the final resolution
 * compensation cap accounts for it.
 *
 * Guards:
 * - Dispute must be in_review (never terminal, never still open).
 * - Cumulative provisional credit can never exceed the disputed amount.
 * - Deterministic idempotency key over (dispute, amount, reason): a retry
 *   or double-click replays instead of double-crediting.
 * - Fails closed when the credit rail is frozen (money movement).
 */
async function issueProvisionalCredit({
  disputeId,
  adminId,
  amountCents,
  reason,
  requestIp,
  correlationId,
}) {
  await assertCreditRailEnabled(pool);
  const amount = parsePositiveInt(amountCents);
  if (!amount) throw new AppError('Provisional credit must be a positive integer number of cents', 400, 'credit_provisional_credit_invalid');
  const normalizedReason = normalizeString(reason, 4000);
  if (!normalizedReason) throw new AppError('A reason is required for provisional credit', 400, 'credit_provisional_credit_reason_required');
  if (!adminId) throw new AppError('An administrator identity is required to issue provisional credit', 403, 'credit_dispute_actor_required');

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT d.*, t.amount_cents AS transaction_amount_cents, t.currency_code AS transaction_currency_code
         FROM oxsteed_credit_disputes d
         JOIN oxsteed_credit_transactions t ON t.id = d.transaction_id
        WHERE d.id = $1
        FOR UPDATE`,
      [disputeId]
    );
    const dispute = rows[0];
    if (!dispute) throw new AppError('Credit dispute not found', 404, 'credit_dispute_not_found');
    if (dispute.status !== 'in_review') {
      throw new AppError('Provisional credit is only available while a dispute is under review', 409, 'credit_dispute_state_invalid');
    }
    const disputedAmount = Number(dispute.transaction_amount_cents || 0);
    const alreadyIssued = Number(dispute.provisional_credit_cents || 0);
    if (amount + alreadyIssued > disputedAmount) {
      throw new AppError('Provisional credit cannot exceed the disputed amount', 400, 'credit_provisional_credit_exceeds');
    }

    const reasonHash = crypto.createHash('sha256').update(normalizedReason).digest('hex').slice(0, 32);
    const idempotencyKey = `credit-dispute-provisional:${String(disputeId)}:${amount}:${reasonHash}`;
    const existing = await client.query(
      `SELECT id FROM oxsteed_credit_transactions WHERE idempotency_key = $1 LIMIT 1`,
      [idempotencyKey]
    );
    if (existing.rows.length) {
      return {
        dispute: formatDispute(dispute),
        provisionalCredit: { amountCents: amount, transactionId: String(existing.rows[0].id) },
        replayed: true,
      };
    }

    const adjustmentResult = await adjustCustomerCreditInTransaction(client, {
      customerId: dispute.customer_id,
      amountCents: amount,
      currencyCode: dispute.transaction_currency_code,
      direction: 'credit',
      idempotencyKey,
      actorUserId: adminId,
      actorType: 'admin',
      reason: `Provisional credit for dispute ${String(dispute.id)}: ${normalizedReason}`,
      referenceType: 'oxsteed_credit_dispute',
      referenceId: String(dispute.id),
      correlationId: correlationId || null,
      requestIp: requestIp || null,
      metadata: { disputeId: String(dispute.id), provisional: true, source: 'super_admin_provisional_credit' },
    });

    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_disputes
          SET provisional_credit_cents = provisional_credit_cents + $1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [amount, dispute.id]
    );
    await client.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason, request_ip, before_state, after_state)
       VALUES ('credit.dispute.provisional_credit', $1, $2, $3, 'credit_dispute', $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        adminId,
        dispute.customer_id,
        dispute.partner_id || null,
        String(dispute.id),
        normalizedReason,
        requestIp || null,
        JSON.stringify({ provisionalCreditCents: alreadyIssued }),
        JSON.stringify({ provisionalCreditCents: alreadyIssued + amount, transactionId: adjustmentResult?.transaction?.id || null }),
      ]
    );
    return {
      dispute: formatDispute({ ...updatedRows[0] }),
      provisionalCredit: { amountCents: amount, transactionId: adjustmentResult?.transaction?.id || null },
      replayed: false,
    };
  }, 'credit_dispute_provisional_credit');
}
