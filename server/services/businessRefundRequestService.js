'use strict';

// PR804 Track C — G-20: business-initiated refund requests.
//
// A business owner or team member holding `refunds.request` (managers hold
// it by default per migration 245; representatives only by explicit
// override) can ask for a refund on one of the business's jobs. The request
// ALWAYS queues in the dual-approval queue (forceQueue) as a `job_refund`
// movement: the requester can never execute the refund. A platform admin
// decides it in the existing Money Approvals queue (the `refunds.approve`
// step: financial grant + fresh step-up + maker-checker, the approver is
// always a different person than the business requester), and the existing
// `job_refund` executor runs processPaymentRefund on approval.
//
// The business is resolved from the job's client: jobs carry no
// business_id, so the job must have been posted by the business's owner
// (businesses.user_id = jobs.client_id).

const db = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { canReadBusinessFinance, canWriteBusinessFinance } = require('../utils/businessOwnership');
const { requestMoneyMovementApproval } = require('./dualApprovalService');

const REFUND_REQUEST_CODE = 'refunds.request';

async function resolveBusinessJob({ businessId, userId, jobId, forList = false }) {
  const { rows: [business] } = await db.query(
    `SELECT id, user_id FROM businesses WHERE id = $1`, [businessId]);
  if (!business) throw new AppError('Business not found.', 404, 'business_not_found');
  // Write path needs refunds.request; the list path needs any finance read code.
  const access = forList
    ? await canReadBusinessFinance(userId, businessId)
    : await canWriteBusinessFinance(userId, businessId, REFUND_REQUEST_CODE);
  if (!access) throw new AppError(forList ? 'Finance read access is required.' : 'Refund request access is required.', 403, forList ? 'business_finance_read_required' : 'business_refund_request_required');
  const { rows: [job] } = await db.query(
    `SELECT id, client_id, status FROM jobs WHERE id = $1`, [jobId]);
  if (!job || String(job.client_id) !== String(business.user_id)) {
    throw new AppError('Job not found for this business.', 404, 'business_job_not_found');
  }
  return { business, job };
}

async function requestBusinessRefund({ businessId, userId, jobId, amountCents, fullRefund, reason, idempotencyKey }) {
  const { business, job } = await resolveBusinessJob({ businessId, userId, jobId });
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
  const requestId = `business-job-refund-${job.id}-${payment.id}-${explicitAmount == null ? 'full' : explicitAmount}`;
  const gate = await requestMoneyMovementApproval({
    movementType: 'job_refund',
    referenceKey: `job:${job.id}`,
    amountCents: refundCents,
    currencyCode: payment.currency || 'USD',
    requestedBy: userId,
    idempotencyKey: idempotencyKey || requestId,
    payload: {
      jobId: job.id,
      businessId: business.id,
      paymentId: payment.id,
      amountCents: explicitAmount,
      fullRefund: fullRefund === true,
      reason: cleanReason,
      requestId,
      makerAdminId: userId,
    },
    // G-20: the requester must never execute. Always queue for admin approval.
    forceQueue: true,
  });
  if (!gate.queued) {
    // forceQueue guarantees a queued approval; reaching here is a fail-closed bug.
    throw new AppError('Refund request could not be queued for approval.', 500, 'refund_request_not_queued');
  }
  return { approval: gate.approval, replay: Boolean(gate.replay), requestId };
}

async function listBusinessRefundRequests({ businessId, userId, jobId, limit = 20, offset = 0 }) {
  await resolveBusinessJob({ businessId, userId, jobId, forList: true });
  const { rows } = await db.query(
    `SELECT id, movement_type, reference_key, amount_cents, currency_code,
            requested_by, status, created_at, decided_at, decided_by,
            payload ->> 'reason' AS reason, payload ->> 'requestId' AS request_id
       FROM money_movement_approvals
      WHERE movement_type = 'job_refund'
        AND payload ->> 'jobId' = $1
        AND payload ->> 'businessId' = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [String(jobId), String(businessId), Math.min(Math.max(Number(limit) || 20, 1), 100), Math.max(Number(offset) || 0, 0)]);
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

module.exports = { requestBusinessRefund, listBusinessRefundRequests, REFUND_REQUEST_CODE };
