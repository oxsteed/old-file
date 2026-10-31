'use strict';

// P2-4-F04: parcel-delivery driver payouts. Drivers could claim and complete
// paid deliveries with no payout lifecycle at all. Payouts accrue from the
// job's quoted driver_payout_cents (never request input) when a job reaches
// 'delivered'. Money never moves automatically: accrued -> approved ->
// paid requires explicit ops actions, and 'paid' requires a recorded payment
// reference (enforced both here and by the DB constraint).

const pool = require('../db');
const AppError = require('../utils/appError');

const PAYOUT_STATUSES = new Set(['accrued', 'approved', 'paid', 'voided']);
const PAYOUT_TRANSITIONS = {
  accrued: new Set(['accrued', 'approved', 'voided']),
  approved: new Set(['approved', 'paid', 'voided']),
  paid: new Set(['paid']),
  voided: new Set(['voided']),
};

function fail(message, code = 'driver_payout_conflict', status = 409) {
  throw new AppError(message, status, code);
}

function driverOf(job) {
  return job.helper_user_id || job.internal_driver_user_id || null;
}

// Idempotent accrual inside the delivery-status transaction. The caller must
// hold a row lock on the job (FOR UPDATE) and be in 'delivered' transition.
async function accrueDriverPayout(client, job) {
  const driverUserId = driverOf(job);
  const payoutCents = Number(job.driver_payout_cents || 0);
  if (!driverUserId || !Number.isInteger(payoutCents) || payoutCents <= 0) return null;
  const { rows: [payout] } = await client.query(
    `INSERT INTO delivery_driver_payouts (delivery_job_id, driver_user_id, payout_cents, status)
     VALUES ($1, $2, $3, 'accrued')
     ON CONFLICT (delivery_job_id) DO NOTHING
     RETURNING *`,
    [job.id, driverUserId, payoutCents]
  );
  return payout || null;
}

async function getPayout(client, payoutId, { lock = false } = {}) {
  const { rows: [payout] } = await client.query(
    `SELECT * FROM delivery_driver_payouts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [payoutId]
  );
  if (!payout) fail('Driver payout not found', 'driver_payout_not_found', 404);
  return payout;
}

function assertTransition(payout, nextStatus) {
  if (!PAYOUT_STATUSES.has(nextStatus)) fail('Unsupported payout status', 'driver_payout_status_invalid', 400);
  if (!PAYOUT_TRANSITIONS[payout.status]?.has(nextStatus)) {
    fail('Payout status transition is not allowed', 'driver_payout_transition_invalid');
  }
}

async function approvePayout(client, payoutId, approverUserId, note) {
  const payout = await getPayout(client, payoutId, { lock: true });
  assertTransition(payout, 'approved');
  if (payout.status === 'approved') return payout;
  const { rows: [updated] } = await client.query(
    `UPDATE delivery_driver_payouts
        SET status = 'approved',
            approved_by_user_id = $2,
            approved_at = NOW(),
            note = COALESCE($3, note),
            updated_at = NOW()
      WHERE id = $1 AND status = 'accrued'
      RETURNING *`,
    [payoutId, approverUserId, note ? String(note).slice(0, 1000) : null]
  );
  if (!updated) fail('Payout status changed concurrently');
  return updated;
}

// Fails closed: marking paid requires a payment reference that proves the
// money actually moved through the provider rail. No reference, no payout.
async function markPayoutPaid(client, payoutId, payerUserId, paymentReference, note) {
  const payout = await getPayout(client, payoutId, { lock: true });
  assertTransition(payout, 'paid');
  const reference = String(paymentReference || '').trim().slice(0, 200);
  if (!reference) fail('A payment reference is required to mark a payout paid', 'driver_payout_reference_required', 400);
  if (payout.status === 'paid') {
    if (payout.payment_reference !== reference) fail('Payout already recorded with a different reference');
    return payout;
  }
  // Pentest fix (separation of duties): the operator who approved a
  // payout must not be the one who marks it paid. Approved status is only
  // reachable through approvePayout, which always records the approver, so
  // a null approver (legacy rows only) cannot be checked and is allowed.
  if (payout.approved_by_user_id != null
    && String(payout.approved_by_user_id) === String(payerUserId)) {
    fail('The approving operator cannot also mark this payout paid', 'driver_payout_self_mark_paid', 403);
  }
  const { rows: [updated] } = await client.query(
    `UPDATE delivery_driver_payouts
        SET status = 'paid',
            paid_at = NOW(),
            paid_by_user_id = $2,
            payment_reference = $3,
            note = COALESCE($4, note),
            updated_at = NOW()
      WHERE id = $1 AND status = 'approved'
      RETURNING *`,
    [payoutId, payerUserId, reference, note ? String(note).slice(0, 1000) : null]
  );
  if (!updated) fail('Payout status changed concurrently');
  return updated;
}

async function voidPayout(client, payoutId, actorUserId, note) {
  const payout = await getPayout(client, payoutId, { lock: true });
  assertTransition(payout, 'voided');
  if (payout.status === 'voided') return payout;
  const { rows: [updated] } = await client.query(
    `UPDATE delivery_driver_payouts
        SET status = 'voided',
            note = COALESCE($2, note),
            updated_at = NOW()
      WHERE id = $1 AND status IN ('accrued','approved')
      RETURNING *`,
    [payoutId, note ? String(note).slice(0, 1000) : null]
  );
  if (!updated) fail('Payout status changed concurrently');
  return updated;
}

module.exports = {
  PAYOUT_STATUSES,
  PAYOUT_TRANSITIONS,
  driverOf,
  accrueDriverPayout,
  getPayout,
  approvePayout,
  markPayoutPaid,
  voidPayout,
  fail,
};
