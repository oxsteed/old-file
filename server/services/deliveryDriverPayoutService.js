'use strict';

// P2-4-F04: parcel-delivery driver payouts. Drivers could claim and complete
// paid deliveries with no payout lifecycle at all. Payouts accrue from the
// job's quoted driver_payout_cents (never request input) when a job reaches
// 'delivered'. Money never moves automatically: accrued -> approved ->
// paid requires explicit ops actions, and 'paid' requires a Stripe transfer
// id verified against Stripe (G9-B8, D-745) — enforced here, by the rail
// gate, and by the DB constraint on a non-empty reference.

const pool = require('../db');
const AppError = require('../utils/appError');
const { assertCreditRailEnabled } = require('./oxsteedCreditService');

// G9-B8 (D-745): a Stripe transfer id is the only reference that counts
// as proof a driver was paid. The transfer is retrieved from Stripe and
// matched (amount, currency, not reversed) before the row flips to paid.
// A bank/Venmo confirmation number or any other free text is attestation,
// not verification, and is refused. Limit, stated plainly: no driver
// payout destination is recorded anywhere, so the transfer's destination
// cannot be matched — amount + currency + not-reversed is the binding
// check, and a same-amount transfer to the wrong account would pass it.
// Recording the driver's Stripe destination at onboarding would close
// that hole; it is a sibling gap, not built here.
const TRANSFER_ID_RE = /^tr_[A-Za-z0-9]+$/;

function defaultStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

async function verifyDriverPayoutTransfer({ stripeClient, reference, payout }) {
  if (!TRANSFER_ID_RE.test(reference)) {
    fail('Payment reference must be the Stripe transfer id (tr_...) that paid this driver', 'driver_payout_reference_invalid', 400);
  }
  // An explicitly passed null client means "no Stripe" (the unconfigured
  // case, hermetic in tests); an absent client falls back to the env key.
  const stripe = stripeClient === undefined ? defaultStripeClient() : stripeClient;
  if (!stripe) {
    fail('Stripe is not configured, so the payment reference cannot be verified', 'driver_payout_rail_unavailable', 503);
  }
  let transfer;
  try {
    transfer = await stripe.transfers.retrieve(reference);
  } catch (error) {
    if (error && (error.statusCode === 404 || error.code === 'resource_missing')) {
      fail('No Stripe transfer matches this payment reference', 'driver_payout_reference_not_found', 409);
    }
    throw new AppError('The payment reference could not be verified against Stripe', 503, 'driver_payout_reference_unverifiable');
  }
  if (transfer.reversed === true) {
    fail('The Stripe transfer for this payment reference was reversed', 'driver_payout_reference_reversed', 409);
  }
  if (Number(transfer.amount) !== Number(payout.payout_cents)) {
    fail('The Stripe transfer amount does not match this payout', 'driver_payout_reference_amount_mismatch', 409);
  }
  // Payout rows carry no currency column; delivery pricing is USD.
  if (String(transfer.currency || '').toUpperCase() !== 'USD') {
    fail('The Stripe transfer currency does not match this payout', 'driver_payout_reference_currency_mismatch', 409);
  }
  return transfer;
}

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
  if (payout.status === 'approved') {
    // Audit item 8: legacy rows were approved before approver recording
    // began, so they carry approved_by_user_id NULL and the mark-paid
    // separation check cannot run. Re-approving such a row stamps the
    // approver exactly once; a different operator must then mark it paid.
    // Rows with a recorded approver stay an idempotent no-op.
    if (payout.approved_by_user_id == null) {
      const { rows: [updated] } = await client.query(
        `UPDATE delivery_driver_payouts
            SET approved_by_user_id = $2,
                approved_at = NOW(),
                updated_at = NOW()
          WHERE id = $1 AND status = 'approved' AND approved_by_user_id IS NULL
          RETURNING *`,
        [payoutId, approverUserId]
      );
      if (!updated) fail('Payout status changed concurrently');
      return updated;
    }
    return payout;
  }
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
// money actually moved through the provider rail — a Stripe transfer id
// retrieved from Stripe and matched to this payout (amount, currency, not
// reversed). A free-text reference proves nothing and is refused. The
// credit rail gate runs first (same as the restaurant payout path): no
// mark-paid while the rail is off or frozen. No reference, no payout.
async function markPayoutPaid(client, payoutId, payerUserId, paymentReference, note, deps = {}) {
  const payout = await getPayout(client, payoutId, { lock: true });
  assertTransition(payout, 'paid');
  const reference = String(paymentReference || '').trim().slice(0, 200);
  if (!reference) fail('A payment reference is required to mark a payout paid', 'driver_payout_reference_required', 400);
  if (payout.status === 'paid') {
    if (payout.payment_reference !== reference) fail('Payout already recorded with a different reference');
    return payout;
  }
  // Separation of duties: the operator who approved a payout must not be
  // the one who marks it paid. Audit item 8 closes the legacy null-approver
  // hole: a NULL approver now fails closed here. The row must be
  // re-approved first (approvePayout stamps the approver), after which a
  // different operator must mark it paid. No approver is ever invented:
  // the stamped approver is the operator who actually re-approved.
  if (payout.approved_by_user_id == null) {
    fail('This payout was approved before approver recording began; re-approve it first so the approver is recorded', 'driver_payout_approver_unknown', 403);
  }
  if (String(payout.approved_by_user_id) === String(payerUserId)) {
    fail('The approving operator cannot also mark this payout paid', 'driver_payout_self_mark_paid', 403);
  }
  // G9-B8 (D-745): rail verification, not attestation. The gate and the
  // transfer check run after the separation checks (so those keep their
  // existing codes) and before the UPDATE, inside the same transaction
  // that holds the payout row lock — verify-then-flip is atomic.
  await assertCreditRailEnabled(client);
  await verifyDriverPayoutTransfer({ stripeClient: deps.stripe, reference, payout });
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
