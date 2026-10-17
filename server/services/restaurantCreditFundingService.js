'use strict';

/**
 * Restaurant credit approval funding orchestration.
 *
 * Approval isn't complete until the reserve is funded. This service wires
 * the funding step into the approval flow:
 *
 *  - determineFundingPath(restaurant): checks Stripe availability for the
 *    restaurant's country. Returns { method: 'stripe' } or
 *    { method: 'manual', instructions }.
 *  - submitManualFundingProof: restaurant uploads proof it paid via
 *    OxSteed's instructions. Creates a pending submission.
 *  - verifyManualFunding (admin): verifies the proof, credits the reserve
 *    directly (no Stripe), flips funding_status to 'funded'.
 *
 * Money-safety contract (fail closed):
 *  - The reserve is credited ONLY via Stripe confirm (existing path) or
 *    admin verifyManualFunding. Nothing else flips funding_status.
 *  - Manual verification is idempotent: a verified submission cannot be
 *    verified twice (status check inside the transaction).
 *  - The fee applies to manual funding too: issuable = amount - 2.5%.
 */

const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const pool = require('../db');
const { isStripeAvailableFor } = require('../utils/stripeAvailability');
const { getFundingInstructions } = require('./oxsteedFundingInstructionsService');
const { computeReserveFee } = require('./restaurantCreditReserveService');

function fail(message, code, status = 400, details) {
  throw new AppError(message, status, code, status === 500 ? undefined : code);
}

function parseRestaurantId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) fail('Restaurant not found', 'restaurant_not_found', 404);
  return id;
}

function normalizeCurrency(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) fail('Invalid currency code', 'credit_funding_currency_invalid', 400);
  return code;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || '').trim().slice(0, 120);
  if (!key) fail('An idempotency key is required', 'credit_funding_idempotency_key_required', 400);
  return key;
}

/**
 * Decide how a restaurant funds its reserve: Stripe checkout where
 * available, manual instructions elsewhere.
 *
 * @returns {Promise<{ method: 'stripe' } | { method: 'manual', instructions }>}
 */
async function determineFundingPath({ restaurantId }) {
  const id = parseRestaurantId(restaurantId);
  const { rows } = await pool.query(
    `SELECT id, address_country, currency_code, display_name
       FROM food_restaurants WHERE id = $1 LIMIT 1`,
    [id]
  );
  const restaurant = rows[0];
  if (!restaurant) fail('Restaurant not found', 'restaurant_not_found', 404);

  const countryCode = String(restaurant.address_country || '').trim().toUpperCase() || null;
  const stripeAvailable = countryCode ? await isStripeAvailableFor(countryCode) : false;

  if (stripeAvailable) {
    return { method: 'stripe', countryCode, currencyCode: restaurant.currency_code };
  }

  const instructions = await getFundingInstructions(
    countryCode || 'US',
    restaurant.currency_code || 'USD'
  );
  return {
    method: 'manual',
    countryCode,
    currencyCode: restaurant.currency_code,
    instructions, // null when OxSteed hasn't published any: UI shows "contact support"
  };
}

/**
 * Restaurant submits proof of manual funding payment.
 */
async function submitManualFundingProof({
  restaurantId,
  operatorUserId,
  amountCents,
  currencyCode,
  proofUrl,
  reference,
  note,
  idempotencyKey,
}) {
  const id = parseRestaurantId(restaurantId);
  const amount = Math.round(Number(amountCents));
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    fail('A positive funding amount is required', 'credit_funding_amount_invalid', 400);
  }
  const currency = normalizeCurrency(currencyCode);
  const key = normalizeIdempotencyKey(idempotencyKey);

  const submission = await withTransaction(pool, async (client) => {
    // The restaurant must have a pending-funding approval to submit proof.
    const { rows: [approval] } = await client.query(
      `SELECT * FROM restaurant_credit_approvals
        WHERE restaurant_id = $1 AND funding_status = 'pending' LIMIT 1`,
      [id]
    );
    if (!approval) {
      fail(
        'No pending funding step for this restaurant',
        'credit_funding_no_pending_approval',
        409
      );
    }

    const { rows } = await client.query(
      `INSERT INTO restaurant_credit_funding_submissions
         (restaurant_id, amount_cents, currency_code, proof_url, reference,
          note, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       ON CONFLICT (restaurant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        id,
        amount,
        currency,
        proofUrl ? String(proofUrl).trim().slice(0, 2000) || null : null,
        reference ? String(reference).trim().slice(0, 160) || null : null,
        note ? String(note).trim().slice(0, 500) || null : null,
        key,
      ]
    );
    if (rows[0]) return rows[0];
    const { rows: existing } = await client.query(
      `SELECT * FROM restaurant_credit_funding_submissions
        WHERE restaurant_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [id, key]
    );
    return existing[0] || null;
  }, 'credit_funding_proof_submit');

  if (!submission) fail('Funding proof could not be recorded', 'credit_funding_proof_failed', 500);

  // Record which method the restaurant is using.
  await pool.query(
    `UPDATE restaurant_credit_approvals
        SET funding_method = 'manual', updated_at = NOW()
      WHERE restaurant_id = $1 AND funding_method IS NULL`,
    [id]
  );

  logger.info('manual funding proof submitted', { restaurantId: id, submissionId: submission.id });
  return formatSubmission(submission);
}

function formatSubmission(row) {
  if (!row) return null;
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    amountCents: Number(row.amount_cents),
    currencyCode: row.currency_code,
    proofUrl: row.proof_url,
    reference: row.reference,
    note: row.note,
    status: row.status,
    verifiedAt: row.verified_at,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}

/**
 * Admin verifies a manual funding submission. Credits the reserve
 * (minus the 2.5% platform fee, same as Stripe purchases) and flips the
 * approval's funding_status to 'funded'. Idempotent.
 */
async function verifyManualFunding({ submissionId, adminUserId, approve }) {
  const sid = Number(submissionId);
  if (!Number.isSafeInteger(sid) || sid <= 0) fail('Submission not found', 'credit_funding_submission_not_found', 404);

  const result = await withTransaction(pool, async (client) => {
    const { rows: [submission] } = await client.query(
      `SELECT * FROM restaurant_credit_funding_submissions WHERE id = $1 FOR UPDATE`,
      [sid]
    );
    if (!submission) fail('Submission not found', 'credit_funding_submission_not_found', 404);
    if (submission.status !== 'pending') {
      // Idempotent replay: already decided.
      return { submission, replayed: true, reserve: null };
    }

    if (!approve) {
      const { rows: [rejected] } = await client.query(
        `UPDATE restaurant_credit_funding_submissions
            SET status = 'rejected', verified_by_user_id = $2,
                verified_at = NOW(), updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [sid, adminUserId || null]
      );
      return { submission: rejected, replayed: false, reserve: null, rejected: true };
    }

    // Credit the reserve: same fee math as Stripe purchases.
    const { feeCents, issuableCents } = computeReserveFee(Number(submission.amount_cents));
    const { rows: [reserve] } = await client.query(
      `INSERT INTO restaurant_credit_reserves
         (restaurant_id, balance_cents, currency_code,
          lifetime_purchased_cents, lifetime_issued_cents, updated_at)
       VALUES ($1, $2, $3, $2, 0, NOW())
       ON CONFLICT (restaurant_id) DO UPDATE SET
         balance_cents = restaurant_credit_reserves.balance_cents + EXCLUDED.balance_cents,
         lifetime_purchased_cents = restaurant_credit_reserves.lifetime_purchased_cents + EXCLUDED.lifetime_purchased_cents,
         updated_at = NOW()
       RETURNING *`,
      [submission.restaurant_id, issuableCents, submission.currency_code]
    );

    await client.query(
      `INSERT INTO restaurant_credit_reserve_ledger
         (restaurant_id, amount_cents, balance_after_cents,
          reference_type, reference_id)
       VALUES ($1, $2, $3, 'purchase', $4)`,
      [submission.restaurant_id, issuableCents, reserve.balance_cents, `manual-funding:${submission.id}`]
    );

    const { rows: [verified] } = await client.query(
      `UPDATE restaurant_credit_funding_submissions
          SET status = 'verified', verified_by_user_id = $2,
              verified_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [sid, adminUserId || null]
    );

    // Funding complete: the restaurant's credit offering goes live.
    await client.query(
      `UPDATE restaurant_credit_approvals
          SET funding_status = 'funded', funded_at = NOW(), updated_at = NOW()
        WHERE restaurant_id = $1`,
      [submission.restaurant_id]
    );

    return { submission: verified, replayed: false, reserve, feeCents, issuableCents };
  }, 'credit_funding_manual_verify');

  logger.info('manual funding verified', {
    submissionId: sid,
    restaurantId: result.submission?.restaurant_id,
    approved: approve,
    replayed: result.replayed,
  });
  return {
    submission: formatSubmission(result.submission),
    replayed: result.replayed,
    rejected: result.rejected || false,
    reserve: result.reserve
      ? {
          restaurantId: result.reserve.restaurant_id,
          balanceCents: Number(result.reserve.balance_cents),
          currencyCode: result.reserve.currency_code,
        }
      : null,
    feeCents: result.feeCents,
    issuableCents: result.issuableCents,
  };
}

/**
 * Mark a Stripe-funded approval as funded (called after the existing
 * confirmReservePurchase succeeds).
 */
async function markStripeFundingComplete({ restaurantId }) {
  const id = parseRestaurantId(restaurantId);
  await pool.query(
    `UPDATE restaurant_credit_approvals
        SET funding_method = 'stripe', funding_status = 'funded',
            funded_at = NOW(), updated_at = NOW()
      WHERE restaurant_id = $1 AND funding_status = 'pending'`,
    [id]
  );
}

/**
 * List pending manual funding submissions (admin review queue).
 */
async function listPendingFundingSubmissions({ limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT s.*, r.display_name AS restaurant_name
       FROM restaurant_credit_funding_submissions s
       JOIN food_restaurants r ON r.id = s.restaurant_id
      WHERE s.status = 'pending'
      ORDER BY s.created_at ASC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return rows.map((row) => ({ ...formatSubmission(row), restaurantName: row.restaurant_name }));
}

module.exports = {
  determineFundingPath,
  submitManualFundingProof,
  verifyManualFunding,
  markStripeFundingComplete,
  listPendingFundingSubmissions,
};
