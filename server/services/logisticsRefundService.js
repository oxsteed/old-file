'use strict';

/**
 * OxSteed Logistics — dual-admin refund service (Phase 3).
 *
 * Money-safety contract (fail closed):
 *  - No refund without proposal + a DIFFERENT admin's approval + fresh auth.
 *  - Status is marked `processed` ONLY after processor confirmation (Stripe)
 *    or a committed ledger reversal (Credit).
 *  - Partial refunds are capped by the remaining refundable amount, computed
 *    server-side at propose time AND re-checked at approve and execute time.
 *  - Funds are always returned to the ORIGINAL source. Never to a different
 *    destination.
 *  - The legacy ability to establish a processed refund by editing status or
 *    pasting a stripe_refund_id is REMOVED (see logisticsRefundsController;
 *    the old PATCH endpoint no longer exists).
 *
 * Refund lifecycle: proposed -> approved -> executing -> processed | failed
 * Also: rejected, expired (proposals auto-expire after PROPOSAL_TTL_HOURS).
 * Failed refunds are enqueued in logistics_reconciliation_queue.
 *
 * All functions take a `deps` object so tests can inject fakes:
 *   deps.query(sql, params)              -> { rows }
 *   deps.paymentPort.getPaymentAttempt(q, attemptId) -> attempt | null
 *   deps.disputePort.checkDispute(q, attemptId)      -> { known: bool, open: bool }
 *   deps.stripePort.createRefund({ paymentIntentId, chargeId, amountCents,
 *                                  idempotencyKey, metadata }) -> { id, status }
 *   deps.creditPort.reverseCredit({ refundCaseId, amountCents, currency,
 *                                   idempotencyKey }) -> { ledgerEntryId }
 *   deps.userPort.getAdminUser(q, userId) -> { id, role, isBanned } | null
 *   deps.notifyPort.notify(event, buyerUserId, vars) -> Promise (fire-and-forget)
 *
 * Production defaults live in ./logisticsRefundPorts.js.
 */

const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');

const FRESH_AUTH_TTL_MINUTES = 15; // approver step-up must be this fresh
const PROPOSAL_TTL_HOURS = 72;     // unapproved proposals auto-expire
const ACTIVE_REFUND_STATUSES = ['approved', 'executing', 'processed'];
const ADMIN_ROLES = new Set(['admin', 'super_admin']);

function isFreshAuth(event) {
  if (!event || !event.completedAt) return false;
  const ageMs = Date.now() - new Date(event.completedAt).getTime();
  return ageMs >= 0 && ageMs <= FRESH_AUTH_TTL_MINUTES * 60 * 1000;
}

function requirePositiveIntCents(value) {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError('amount_cents must be a positive integer (minor units)', 400, 'validation_failed');
  }
  return n;
}

function makeReference() {
  return `LR-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function executionIdempotencyKey(caseId) {
  return `logistics-refund-${caseId}`;
}

function checkPorts(deps) {
  for (const name of ['paymentPort', 'disputePort', 'stripePort', 'creditPort', 'userPort', 'notifyPort']) {
    if (!deps[name]) throw new Error(`logisticsRefundService: missing port "${name}"`);
  }
}

async function decisionRow(query, { caseId, actorUserId, action, reason = null, freshAuthRef = null, metadata = null }) {
  await query(
    `INSERT INTO logistics_refund_decisions
       (refund_case_id, actor_user_id, action, reason, fresh_auth_ref, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [caseId, actorUserId, action, reason, freshAuthRef, metadata ? JSON.stringify(metadata) : null]
  );
}

async function getCaseForUpdate(query, caseId) {
  const { rows } = await query(`SELECT * FROM logistics_refund_cases WHERE id = $1 FOR UPDATE`, [caseId]);
  return rows[0] || null;
}

/**
 * Remaining refundable amount (cents) on a payment attempt, computed
 * server-side from attempt-linked refund cases in active statuses.
 */
async function remainingRefundableCents(query, attemptId, paidAmountCents) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS used
       FROM logistics_refund_cases
      WHERE original_payment_attempt_id = $1
        AND status = ANY($2)
        AND amount_cents IS NOT NULL`,
    [attemptId, ACTIVE_REFUND_STATUSES]
  );
  return Math.max(0, paidAmountCents - (rows[0]?.used || 0));
}

function assertAttemptRefundable(attempt) {
  if (!attempt) {
    throw new AppError('Payment attempt not found. Refund cannot proceed.', 404, 'refund_payment_attempt_not_found');
  }
  if (attempt.currency !== 'USD') {
    throw new AppError('Only USD payments can be refunded.', 400, 'refund_currency_not_supported');
  }
  if (!['paid', 'captured', 'succeeded'].includes(attempt.status)) {
    throw new AppError(`Payment attempt is not in a refundable state (status: ${attempt.status}).`, 409, 'refund_payment_not_refundable');
  }
}

// ─── Propose ─────────────────────────────────────────────────

async function proposeRefund(deps, { proposerUserId, paymentAttemptId, amountCents, reason, refundMethod }) {
  checkPorts(deps);
  const { query, paymentPort, notifyPort } = deps;
  const cents = requirePositiveIntCents(amountCents);
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new AppError('A refund reason is required.', 400, 'validation_failed');
  if (cleanReason.length > 200) throw new AppError('Refund reason must be 200 characters or fewer.', 400, 'validation_failed');
  if (!['stripe', 'credit'].includes(refundMethod)) {
    throw new AppError('refund_method must be "stripe" or "credit".', 400, 'validation_failed');
  }
  if (!paymentAttemptId) throw new AppError('payment_attempt_id is required.', 400, 'validation_failed');

  const attempt = await paymentPort.getPaymentAttempt(query, String(paymentAttemptId));
  assertAttemptRefundable(attempt);
  if (attempt.method && attempt.method !== refundMethod) {
    throw new AppError(
      `Refund method (${refundMethod}) does not match the original payment method (${attempt.method}). Funds must return to the original source.`,
      400, 'refund_method_mismatch'
    );
  }

  const remaining = await remainingRefundableCents(query, String(paymentAttemptId), attempt.amountCents);
  if (cents > remaining) {
    throw new AppError(
      `Requested amount exceeds the remaining refundable amount of ${remaining} cents.`,
      400, 'refund_amount_exceeds_remaining', { remainingCents: remaining }
    );
  }

  const reference = makeReference();
  const { rows } = await query(
    `INSERT INTO logistics_refund_cases
       (reference, user_id, refund_reason, requested_amount_usd,
        amount_cents, refund_method, original_payment_attempt_id,
        status, proposed_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'proposed', $8, $9)
     RETURNING *`,
    [reference, attempt.buyerUserId, cleanReason, (cents / 100).toFixed(2),
     cents, refundMethod, String(paymentAttemptId), proposerUserId, cleanReason]
  );
  const kase = rows[0];
  await decisionRow(query, { caseId: kase.id, actorUserId: proposerUserId, action: 'propose', reason: cleanReason });

  notifyPort.notify('refund_proposed', attempt.buyerUserId, { reference, amountCents: cents }).catch(() => {});
  return kase;
}

// ─── Approve ─────────────────────────────────────────────────

async function approveRefund(deps, { caseId, approverUserId, freshAuthEvent, reason = null }) {
  checkPorts(deps);
  const { query, paymentPort, notifyPort } = deps;

  // Fresh-auth gate: the approval is worthless without a recent step-up.
  if (!isFreshAuth(freshAuthEvent)) {
    throw new AppError(
      'Fresh authentication required. Complete TOTP step-up within the last 15 minutes before approving.',
      401, 'fresh_auth_required'
    );
  }

  const kase = await getCaseForUpdate(query, caseId);
  if (!kase) throw new AppError('Refund case not found.', 404, 'not_found');
  if (kase.status !== 'proposed') {
    throw new AppError(`Only proposed refunds can be approved (status: ${kase.status}).`, 409, 'refund_invalid_state');
  }
  if (String(kase.proposed_by) === String(approverUserId)) {
    throw new AppError('Self-approval is forbidden. A different admin must approve this refund.', 403, 'refund_self_approval_forbidden');
  }

  // Re-check the gates at approval time: payment, caps.
  const attempt = await paymentPort.getPaymentAttempt(query, String(kase.original_payment_attempt_id));
  assertAttemptRefundable(attempt);
  const remaining = await remainingRefundableCents(query, String(kase.original_payment_attempt_id), attempt.amountCents);
  if (kase.amount_cents > remaining) {
    throw new AppError(
      `Approved amount exceeds the remaining refundable amount of ${remaining} cents.`,
      409, 'refund_amount_exceeds_remaining', { remainingCents: remaining }
    );
  }

  const { rows } = await query(
    `UPDATE logistics_refund_cases
        SET status = 'approved',
            approved_by = $2,
            approved_at = NOW(),
            fresh_auth_at = $3,
            notes = COALESCE(notes, '') || CASE WHEN $4::text IS NOT NULL THEN $4 ELSE '' END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [caseId, approverUserId, freshAuthEvent.completedAt, reason ? `\n[approval] ${reason}` : null]
  );
  await decisionRow(query, {
    caseId, actorUserId: approverUserId, action: 'approve',
    reason, freshAuthRef: freshAuthEvent.authHash || null,
  });

  notifyPort.notify('refund_approved', kase.user_id, { reference: kase.reference, amountCents: kase.amount_cents }).catch(() => {});
  return rows[0];
}

// ─── Reject ──────────────────────────────────────────────────

async function rejectRefund(deps, { caseId, actorUserId, reason }) {
  checkPorts(deps);
  const { query, notifyPort } = deps;
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new AppError('A rejection reason is required.', 400, 'validation_failed');

  const kase = await getCaseForUpdate(query, caseId);
  if (!kase) throw new AppError('Refund case not found.', 404, 'not_found');
  if (kase.status !== 'proposed') {
    throw new AppError(`Only proposed refunds can be rejected (status: ${kase.status}).`, 409, 'refund_invalid_state');
  }
  if (String(kase.proposed_by) === String(actorUserId)) {
    throw new AppError('The proposing admin cannot reject their own proposal. A different admin must review it.', 403, 'refund_self_approval_forbidden');
  }

  const { rows } = await query(
    `UPDATE logistics_refund_cases
        SET status = 'rejected', rejection_reason = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [caseId, cleanReason]
  );
  await decisionRow(query, { caseId, actorUserId, action: 'reject', reason: cleanReason });

  notifyPort.notify('refund_rejected', kase.user_id, { reference: kase.reference, amountCents: kase.amount_cents }).catch(() => {});
  return rows[0];
}

// ─── Execute ─────────────────────────────────────────────────

async function markFailed(query, notifyPort, kase, attempt, code, message, extra = {}) {
  await query(
    `UPDATE logistics_refund_cases
        SET status = 'failed', updated_at = NOW()
      WHERE id = $1`,
    [kase.id]
  );
  await decisionRow(query, {
    caseId: kase.id, actorUserId: kase.executedBy || null, action: 'execute_failed',
    reason: message, metadata: { code, ...extra },
  });
  await query(
    `INSERT INTO logistics_reconciliation_queue (source, entity_id, reason, payload, status)
     VALUES ('logistics_refund', $1, $2, $3, 'pending')`,
    [kase.id, `Refund execution failed: ${code}`,
     JSON.stringify({
       reference: kase.reference,
       paymentAttemptId: kase.original_payment_attempt_id,
       amountCents: kase.amount_cents,
       refundMethod: kase.refund_method,
       errorCode: code,
       errorMessage: message,
     })]
  );
  notifyPort.notify('refund_failed', kase.user_id, { reference: kase.reference, amountCents: kase.amount_cents }).catch(() => {});
  const { rows } = await query(`SELECT * FROM logistics_refund_cases WHERE id = $1`, [kase.id]);
  return rows[0];
}

async function executeRefund(deps, { caseId, actorUserId }) {
  checkPorts(deps);
  const { query, paymentPort, disputePort, stripePort, creditPort, userPort, notifyPort } = deps;

  await query('BEGIN');
  try {
    let kase = await getCaseForUpdate(query, caseId);
    if (!kase) { await query('ROLLBACK'); throw new AppError('Refund case not found.', 404, 'not_found'); }

    // Idempotency: replaying an execution never moves money twice.
    if (kase.status === 'processed') {
      await query('ROLLBACK');
      return { case: kase, replayed: true };
    }
    if (kase.status === 'executing') {
      await query('ROLLBACK');
      return { case: kase, inProgress: true };
    }
    if (kase.status !== 'approved') {
      await query('ROLLBACK');
      throw new AppError(`Only approved refunds can be executed (status: ${kase.status}).`, 409, 'refund_invalid_state');
    }

    await query(`UPDATE logistics_refund_cases SET status = 'executing', updated_at = NOW() WHERE id = $1`, [caseId]);
    kase = { ...kase, status: 'executing', executedBy: actorUserId };

    // ── Execution-time rechecks (all gates, before any money moves) ──
    const attempt = await paymentPort.getPaymentAttempt(query, String(kase.original_payment_attempt_id));
    try { assertAttemptRefundable(attempt); }
    catch (e) { const f = await markFailed(query, notifyPort, kase, attempt, e.code || 'refund_payment_not_refundable', e.message); await query('COMMIT'); return { case: f, failed: true, code: e.code }; }

    const dispute = await disputePort.checkDispute(query, String(kase.original_payment_attempt_id));
    if (!dispute.known) {
      const f = await markFailed(query, notifyPort, kase, attempt, 'refund_dispute_status_unknown',
        'Dispute status could not be determined. Refund blocked pending dispute linkage.');
      await query('COMMIT'); return { case: f, failed: true, code: 'refund_dispute_status_unknown' };
    }
    if (dispute.open) {
      const f = await markFailed(query, notifyPort, kase, attempt, 'refund_dispute_open',
        'An open dispute exists on the original payment. Refund blocked.');
      await query('COMMIT'); return { case: f, failed: true, code: 'refund_dispute_open' };
    }

    const remaining = await remainingRefundableCents(query, String(kase.original_payment_attempt_id), attempt.amountCents);
    if (kase.amount_cents > remaining) {
      const f = await markFailed(query, notifyPort, kase, attempt, 'refund_amount_exceeds_remaining',
        `Amount exceeds remaining refundable amount of ${remaining} cents.`, { remainingCents: remaining });
      await query('COMMIT'); return { case: f, failed: true, code: 'refund_amount_exceeds_remaining' };
    }

    // Approver authorization must still be valid at execution time.
    const approver = await userPort.getAdminUser(query, kase.approved_by);
    if (!approver || !ADMIN_ROLES.has(approver.role) || approver.isBanned) {
      const f = await markFailed(query, notifyPort, kase, attempt, 'refund_approver_no_longer_authorized',
        'The approving admin is no longer authorized. Refund blocked.');
      await query('COMMIT'); return { case: f, failed: true, code: 'refund_approver_no_longer_authorized' };
    }

    // ── Processor call: funds return to the ORIGINAL source only ──
    const idempotencyKey = executionIdempotencyKey(kase.id);
    try {
      if (kase.refund_method === 'stripe') {
        const refund = await stripePort.createRefund({
          paymentIntentId: attempt.paymentIntentId,
          chargeId: attempt.chargeId,
          amountCents: kase.amount_cents,
          idempotencyKey,
          metadata: { refund_case_id: String(kase.id), reference: kase.reference },
        });
        if (refund.status === 'succeeded') {
          const { rows } = await query(
            `UPDATE logistics_refund_cases
                SET status = 'processed', stripe_refund_id = $2,
                    processed_by = $3, processed_at = NOW(), updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [caseId, refund.id, actorUserId]
          );
          await decisionRow(query, { caseId, actorUserId, action: 'execute', metadata: { stripeRefundId: refund.id, idempotencyKey } });
          await query('COMMIT');
          notifyPort.notify('refund_processed', kase.user_id, { reference: kase.reference, amountCents: kase.amount_cents }).catch(() => {});
          return { case: rows[0], replayed: false };
        }
        if (refund.status === 'pending') {
          // Stripe workstream webhook finalizes from the reconciliation queue.
          await decisionRow(query, { caseId, actorUserId, action: 'execute_pending', metadata: { stripeRefundId: refund.id, idempotencyKey } });
          await query(
            `INSERT INTO logistics_reconciliation_queue (source, entity_id, reason, payload, status)
             VALUES ('logistics_refund', $1, $2, $3, 'pending')`,
            [kase.id, 'Stripe refund pending confirmation',
             JSON.stringify({ reference: kase.reference, stripeRefundId: refund.id, idempotencyKey })]
          );
          await query('COMMIT');
          const { rows } = await query(`SELECT * FROM logistics_refund_cases WHERE id = $1`, [caseId]);
          return { case: rows[0], inProgress: true };
        }
        throw new AppError(`Stripe refund returned unexpected status: ${refund.status}`, 502, 'refund_processor_unexpected_status');
      }

      if (kase.refund_method === 'credit') {
        const reversal = await creditPort.reverseCredit({
          refundCaseId: kase.id,
          amountCents: kase.amount_cents,
          currency: 'USD',
          idempotencyKey,
        });
        const { rows } = await query(
          `UPDATE logistics_refund_cases
              SET status = 'processed', processor_ref = $2,
                  processed_by = $3, processed_at = NOW(), updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [caseId, reversal.ledgerEntryId || reversal.id || null, actorUserId]
        );
        await decisionRow(query, { caseId, actorUserId, action: 'execute', metadata: { creditReversal: reversal, idempotencyKey } });
        await query('COMMIT');
        notifyPort.notify('refund_processed', kase.user_id, { reference: kase.reference, amountCents: kase.amount_cents }).catch(() => {});
        return { case: rows[0], replayed: false };
      }

      throw new AppError(`Unsupported refund method: ${kase.refund_method}`, 400, 'validation_failed');
    } catch (procErr) {
      // Processor failure: fail closed -> failed status + reconciliation queue.
      if (procErr instanceof AppError && procErr.code === 'refund_processor_unexpected_status') throw procErr;
      const f = await markFailed(query, notifyPort, kase, attempt,
        procErr.code || 'refund_processor_error', procErr.message || 'Processor call failed.');
      await query('COMMIT');
      return { case: f, failed: true, code: procErr.code || 'refund_processor_error' };
    }
  } catch (err) {
    try { await query('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw err;
  }
}

// ─── Expire stale proposals ──────────────────────────────────

async function expireStaleProposals(deps, { olderThanHours = PROPOSAL_TTL_HOURS } = {}) {
  checkPorts(deps);
  const { query, notifyPort } = deps;
  const { rows } = await query(
    `UPDATE logistics_refund_cases
        SET status = 'expired', updated_at = NOW()
      WHERE status = 'proposed'
        AND created_at < NOW() - ($1 || ' hours')::interval
      RETURNING id, user_id, reference, amount_cents`,
    [String(olderThanHours)]
  );
  for (const kase of rows) {
    await decisionRow(query, { caseId: kase.id, actorUserId: null, action: 'expire', reason: `Proposal expired after ${olderThanHours}h without approval.` });
    notifyPort.notify('refund_expired', kase.user_id, { reference: kase.reference, amountCents: kase.amount_cents }).catch(() => {});
  }
  return { expired: rows.length, ids: rows.map((r) => r.id) };
}

// ─── Reads ───────────────────────────────────────────────────

async function getRefundCase(deps, caseId) {
  checkPorts(deps);
  const { rows } = await deps.query(
    `SELECT rc.*,
            p.first_name || ' ' || p.last_name AS proposer_name,
            a.first_name || ' ' || a.last_name AS approver_name
       FROM logistics_refund_cases rc
       LEFT JOIN users p ON p.id = rc.proposed_by
       LEFT JOIN users a ON a.id = rc.approved_by
      WHERE rc.id = $1`,
    [caseId]
  );
  if (!rows[0]) throw new AppError('Refund case not found.', 404, 'not_found');
  return rows[0];
}

async function listRefundCases(deps, { status, limit = 100 } = {}) {
  checkPorts(deps);
  const params = [];
  const where = [];
  if (status) { where.push(`rc.status = $${params.push(status)}`); }
  const { rows } = await deps.query(
    `SELECT rc.*,
            p.first_name || ' ' || p.last_name AS proposer_name,
            a.first_name || ' ' || a.last_name AS approver_name
       FROM logistics_refund_cases rc
       LEFT JOIN users p ON p.id = rc.proposed_by
       LEFT JOIN users a ON a.id = rc.approved_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY rc.created_at DESC
      LIMIT $${params.push(Math.min(parseInt(limit, 10) || 100, 200))}`,
    params
  );
  return rows;
}

async function listRefundDecisions(deps, caseId) {
  checkPorts(deps);
  const { rows } = await deps.query(
    `SELECT d.*, u.first_name || ' ' || u.last_name AS actor_name
       FROM logistics_refund_decisions d
       LEFT JOIN users u ON u.id = d.actor_user_id
      WHERE d.refund_case_id = $1
      ORDER BY d.decided_at ASC`,
    [caseId]
  );
  return rows;
}

module.exports = {
  FRESH_AUTH_TTL_MINUTES,
  PROPOSAL_TTL_HOURS,
  executionIdempotencyKey,
  proposeRefund,
  approveRefund,
  rejectRefund,
  executeRefund,
  expireStaleProposals,
  getRefundCase,
  listRefundCases,
  listRefundDecisions,
};
