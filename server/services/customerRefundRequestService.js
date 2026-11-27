'use strict';

// G1-B8: customer-initiated refund requests.
//
// A plain customer (a job's owner with no managed business, or one who
// does not want the business path) can ask for a refund on one of their
// own jobs. The request ALWAYS queues in the dual-approval queue
// (forceQueue) as a `job_refund` movement — the same record, approval,
// and executor the business-initiated path (G-20,
// businessRefundRequestService.js) uses. The requester can never execute
// the refund: a platform admin decides it in the existing Money Approvals
// queue (the `refunds.approve` step: financial grant + fresh step-up +
// maker-checker, the approver is always a different person than the
// requester), and the existing `job_refund` executor runs
// processPaymentRefund on approval. No money moves at request time.
//
// One open request per job (D-30 pattern): a second request while one is
// pending is a 409. A rejected request may be re-filed with a fresh
// idempotency key; an executed refund for the same amount is a 409.

const crypto = require('node:crypto');
const db = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { requestMoneyMovementApproval } = require('./dualApprovalService');

async function findOpenCustomerRefundRequest(jobId) {
  const { rows } = await db.query(
    `SELECT id, status, amount_cents, requested_by
       FROM money_movement_approvals
      WHERE movement_type = 'job_refund'
        AND status = 'pending'
        AND payload ->> 'jobId' = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [String(jobId)]);
  return rows[0] || null;
}

async function requestCustomerRefund({ userId, jobId, amountCents, fullRefund, reason, idempotencyKey }) {
  const { rows: [job] } = await db.query(
    `SELECT id, client_id, status FROM jobs WHERE id = $1`, [jobId]);
  if (!job) throw new AppError('Job not found.', 404, 'customer_job_not_found');
  if (String(job.client_id) !== String(userId)) {
    throw new AppError('Only the job owner can request a refund for this job.', 403, 'customer_refund_not_owner');
  }
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new AppError('Refund reason required.', 400, 'refund_reason_required');
  if (cleanReason.length > 500) throw new AppError('Refund reason is too long.', 400, 'refund_reason_too_long');
  const explicitAmount = amountCents == null ? null : Number(amountCents);
  if (explicitAmount != null && (!Number.isInteger(explicitAmount) || explicitAmount <= 0)) {
    throw new AppError('Refund amount must be a positive integer number of cents.', 400, 'refund_amount_invalid');
  }
  if (fullRefund !== true && explicitAmount == null) {
    throw new AppError('Send an explicit amount_cents or fullRefund: true.', 400, 'refund_amount_required');
  }
  const { rows } = await db.query(
    `SELECT id, amount, currency, stripe_payment_intent_id
       FROM payments
      WHERE job_id = $1
        AND stripe_payment_intent_id IS NOT NULL
        AND status IN ('authorized', 'captured')
      ORDER BY created_at DESC
      LIMIT 1`,
    [job.id]);
  if (!rows.length) throw new AppError('Refundable payment not found for this job.', 404, 'refundable_payment_not_found');
  const payment = rows[0];
  const capturedCents = Math.round(Number(payment.amount) * 100);
  if (!Number.isInteger(capturedCents) || capturedCents <= 0) {
    throw new AppError('Payment has no captured amount to refund against.', 409, 'refund_no_captured_amount');
  }
  const refundCents = explicitAmount != null ? explicitAmount : capturedCents;
  if (refundCents > capturedCents) {
    throw new AppError('Refund amount cannot exceed the captured amount.', 400, 'refund_amount_exceeds_captured');
  }
  // D-30: one open request per job. This also covers a business-filed
  // request for the same job: two pending job_refund movements for one
  // job could otherwise refund the same payment twice.
  if (await findOpenCustomerRefundRequest(job.id)) {
    throw new AppError('A refund request is already open for this job.', 409, 'customer_refund_already_open');
  }
  const requestId = `customer-job-refund-${job.id}-${payment.id}-${explicitAmount == null ? 'full' : explicitAmount}`;
  const baseKey = idempotencyKey || requestId;
  const queueOnce = (key) => requestMoneyMovementApproval({
    movementType: 'job_refund',
    referenceKey: `job:${job.id}`,
    amountCents: refundCents,
    currencyCode: payment.currency || 'USD',
    requestedBy: userId,
    idempotencyKey: key,
    payload: {
      jobId: job.id,
      paymentId: payment.id,
      amountCents: explicitAmount,
      fullRefund: fullRefund === true,
      reason: cleanReason,
      requestId,
      makerAdminId: userId,
      customerRefund: true,
    },
    // G1-B8: the requester must never execute. Always queue for admin approval.
    forceQueue: true,
  });
  let gate = await queueOnce(baseKey);
  if (gate.replay) {
    const prior = gate.approval;
    if (prior.status === 'pending') {
      // Lost race with an identical in-flight request: the open request
      // exists now, so this is a duplicate, not a new filing.
      throw new AppError('A refund request is already open for this job.', 409, 'customer_refund_already_open');
    }
    if (prior.status === 'executed') {
      throw new AppError('This refund was already issued for this job.', 409, 'customer_refund_already_executed');
    }
    // Rejected/failed is terminal for that row, but the customer may
    // re-file: retry once under a fresh key so the new request is a new
    // approval row instead of a replay of the terminal one.
    gate = await queueOnce(`${baseKey}:${crypto.randomUUID()}`);
    if (gate.replay) {
      throw new AppError('Refund request could not be queued for approval.', 500, 'refund_request_not_queued');
    }
  }
  if (!gate.queued) {
    // forceQueue guarantees a queued approval; reaching here is a fail-closed bug.
    throw new AppError('Refund request could not be queued for approval.', 500, 'refund_request_not_queued');
  }
  return { approval: gate.approval, replay: Boolean(gate.replay), requestId };
}

async function listCustomerRefundRequests({ userId, jobId, limit = 20, offset = 0 }) {
  const { rows: [job] } = await db.query(
    `SELECT id, client_id FROM jobs WHERE id = $1`, [jobId]);
  if (!job) throw new AppError('Job not found.', 404, 'customer_job_not_found');
  if (String(job.client_id) !== String(userId)) {
    throw new AppError('Only the job owner can view refund requests for this job.', 403, 'customer_refund_not_owner');
  }
  // The owner sees every job_refund movement for the job, including one
  // a business manager filed for it: it is their job's refund status.
  const { rows } = await db.query(
    `SELECT id, movement_type, reference_key, amount_cents, currency_code,
            requested_by, status, created_at, decided_at, decided_by,
            payload ->> 'reason' AS reason, payload ->> 'requestId' AS request_id
       FROM money_movement_approvals
      WHERE movement_type = 'job_refund'
        AND payload ->> 'jobId' = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [String(jobId), Math.min(Math.max(Number(limit) || 20, 1), 100), Math.max(Number(offset) || 0, 0)]);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    amountCents: Number(row.amount_cents),
    currencyCode: row.currency_code,
    requestedBy: row.requested_by,
    reason: row.reason,
    requestId: row.request_id,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
  }));
}

module.exports = { requestCustomerRefund, listCustomerRefundRequests };
