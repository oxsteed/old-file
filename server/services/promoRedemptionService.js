'use strict';

/**
 * Platform promo code redemption (analytics decision 2).
 *
 * Codes live in discount_codes (created by platform admins). Funding follows
 * each surface's existing promo model (see migration 905): jobs and bookings
 * are platform-funded, food is restaurant-funded (the food checkout already
 * applied these codes as an order discount). Callers pass `fundableCents`:
 * jobs, the platform fee left for discounts (helper net unchanged); bookings,
 * the charge above the Stripe minimum (the platform collects booking
 * payments itself); food, the subtotal. A discount that cannot be funded is
 * refused (promo_not_fundable), never shifted onto another party.
 *
 * Money is integer minor units. Fixed codes have a currency (legacy rows
 * without one are USD); percentage codes apply in any currency unless one is
 * set. Redemption runs inside the caller's checkout transaction: the code row
 * is locked FOR UPDATE, global and per-user limits are counted from
 * promo_redemptions, and the reservation is idempotent per checkout key.
 * Reversal (payment failed/cancelled, refund, booking ended) is idempotent
 * and releases the usage slot.
 */

const { AppError } = require('../middleware/errorHandler');

const SURFACES = Object.freeze(['job', 'booking', 'food']);
const FUNDED_BY = Object.freeze({ job: 'platform', booking: 'platform', food: 'restaurant' });
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,49}$/;

function normalizeCode(code) {
  const value = String(code || '').trim().toUpperCase();
  return CODE_RE.test(value) ? value : null;
}

function promoError(code, message, status = 409, details = undefined) {
  return new AppError(message, status, code, details);
}

function computeDiscount(promo, grossCents) {
  if (promo.discount_type === 'percentage') {
    const pct = Number(promo.discount_amount);
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    // Integer math: floor(gross * pct / 100), never more than the gross.
    let discount = Number((BigInt(grossCents) * BigInt(Math.min(100, Math.round(pct)))) / 100n);
    if (promo.max_discount_cents != null) discount = Math.min(discount, Number(promo.max_discount_cents));
    return Math.max(0, Math.min(discount, grossCents));
  }
  if (promo.discount_type === 'fixed_cents') return Math.max(0, Math.min(Number(promo.discount_amount), grossCents));
  return 0;
}

/**
 * Validate a code for a checkout. Read-only unless `lock` is true (then the
 * code row is locked FOR UPDATE on `db`, which must be a transaction client).
 * Returns { promo, discountCents, computedCents } or throws a promo_* error.
 */
async function evaluatePromo(db, { code, userId, surface, currency, grossCents, fundableCents, lock = false }) {
  const normalized = normalizeCode(code);
  if (!normalized) throw promoError('promo_invalid', 'This promo code is not valid', 404);
  if (!userId) throw promoError('promo_sign_in_required', 'Sign in to use a promo code', 401);
  if (!SURFACES.includes(surface)) throw new Error('Unknown promo surface');
  const ccy = String(currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(ccy)) throw new Error('Currency is required');
  const gross = Math.round(Number(grossCents));
  if (!Number.isSafeInteger(gross) || gross <= 0) throw new Error('Gross amount must be positive integer cents');
  const { rows: [promo] } = await db.query(
    `SELECT id, code, description, discount_type, discount_amount::TEXT AS discount_amount,
            max_discount_cents::TEXT AS max_discount_cents, usage_limit, COALESCE(usage_count, 0) AS usage_count,
            min_order_cents::TEXT AS min_order_cents, max_order_cents::TEXT AS max_order_cents,
            status, start_date, end_date, per_user_limit, currency_code, applicable_surfaces,
            (start_date IS NULL OR start_date <= NOW()) AS started,
            (end_date IS NULL OR end_date >= NOW()) AS not_expired
       FROM discount_codes WHERE UPPER(code) = $1
       ${lock ? 'FOR UPDATE' : ''}`,
    [normalized]);
  if (!promo || promo.status !== 'active') throw promoError('promo_invalid', 'This promo code is not valid', 404);
  if (!promo.started) throw promoError('promo_not_started', 'This promo code is not active yet');
  if (!promo.not_expired) throw promoError('promo_expired', 'This promo code has expired');
  if (promo.applicable_surfaces && !promo.applicable_surfaces.includes(surface)) {
    throw promoError('promo_surface_not_supported', 'This promo code cannot be used for this checkout');
  }
  const codeCurrency = promo.currency_code || (promo.discount_type === 'fixed_cents' ? 'USD' : null);
  if (codeCurrency && codeCurrency !== ccy) {
    throw promoError('promo_currency_mismatch', 'This promo code is for a different currency', 409, { currency: codeCurrency });
  }
  if (promo.min_order_cents != null && gross < Number(promo.min_order_cents)) {
    throw promoError('promo_min_order_not_met', 'The order is below this promo code\'s minimum', 409,
      { minOrderCents: Number(promo.min_order_cents), currency: ccy });
  }
  if (promo.max_order_cents != null && gross > Number(promo.max_order_cents)) {
    throw promoError('promo_max_order_exceeded', 'The order is above this promo code\'s maximum', 409,
      { maxOrderCents: Number(promo.max_order_cents), currency: ccy });
  }
  const { rows: [counts] } = await db.query(
    `SELECT COUNT(*)::INT AS total, COUNT(*) FILTER (WHERE user_id = $2)::INT AS mine
       FROM promo_redemptions WHERE discount_code_id = $1 AND status <> 'reversed'`, [promo.id, userId]);
  if (promo.usage_limit != null && counts.total >= Number(promo.usage_limit)) {
    throw promoError('promo_usage_limit_reached', 'This promo code has been fully used');
  }
  if (promo.per_user_limit != null && counts.mine >= Number(promo.per_user_limit)) {
    throw promoError('promo_user_limit_reached', 'You have already used this promo code');
  }
  const computedCents = computeDiscount(promo, gross);
  const cap = Math.max(0, Math.floor(Number(fundableCents) || 0));
  const discountCents = Math.min(computedCents, cap);
  if (discountCents <= 0) {
    throw promoError('promo_not_fundable', 'This promo code cannot reduce this checkout', 409, { computedCents, currency: ccy });
  }
  return { promo, discountCents, computedCents, limited: discountCents < computedCents, currency: ccy, code: promo.code,
    fundedBy: FUNDED_BY[surface], label: promo.description || promo.code };
}

/**
 * Reserve a redemption inside the caller's transaction. Idempotent per
 * idempotencyKey: a replay returns the existing live reservation.
 */
async function reservePromo(client, args) {
  const { userId, surface, referenceId, idempotencyKey, providerReference = null } = args;
  const key = String(idempotencyKey || '').slice(0, 200);
  if (!key) throw new Error('Promo idempotency key is required');
  const existing = await client.query(
    `SELECT * FROM promo_redemptions WHERE idempotency_key = $1`, [key]);
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.status === 'reversed') throw promoError('promo_reservation_reversed', 'This promo reservation was released; start checkout again');
    return { redemption: row, replayed: true, discountCents: Number(row.discount_cents) };
  }
  const evaluation = await evaluatePromo(client, { ...args, lock: true });
  const { rows: [redemption] } = await client.query(
    `INSERT INTO promo_redemptions (discount_code_id, code, user_id, surface, reference_id, idempotency_key,
        currency_code, gross_cents, discount_cents, provider_reference, funded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [evaluation.promo.id, evaluation.code, userId, surface, String(referenceId), key, evaluation.currency,
      Math.round(Number(args.grossCents)), evaluation.discountCents, providerReference, FUNDED_BY[surface]]);
  await client.query(`UPDATE discount_codes SET usage_count = COALESCE(usage_count, 0) + 1, updated_at = NOW() WHERE id = $1`,
    [evaluation.promo.id]);
  return { redemption, replayed: false, discountCents: evaluation.discountCents, limited: evaluation.limited };
}

async function attachProviderReference(db, redemptionId, providerReference) {
  await db.query(`UPDATE promo_redemptions SET provider_reference = $2 WHERE id = $1 AND status = 'reserved'`,
    [redemptionId, providerReference]);
}

/** Mark the live redemption for a reference as redeemed (payment succeeded).
 *  Returns the number of redemptions transitioned. When `out` is given,
 *  out.transitioned receives the transitioned rows (id, user_id,
 *  discount_cents, currency_code) so callers can react per redemption
 *  without a second query. */
async function markRedeemed(db, { surface, referenceId = null, providerReference = null }, out = null) {
  const { rows } = await db.query(
    `UPDATE promo_redemptions SET status = 'redeemed', redeemed_at = COALESCE(redeemed_at, NOW())
      WHERE status = 'reserved' AND surface = $1
        AND (($2::TEXT IS NOT NULL AND reference_id = $2) OR ($3::TEXT IS NOT NULL AND provider_reference = $3))
      RETURNING id, user_id, discount_cents, currency_code`, [surface, referenceId == null ? null : String(referenceId), providerReference]);
  if (out) out.transitioned = rows;
  return rows.length;
}

/** Reverse the live redemption (idempotent); releases the usage slot. */
async function reversePromo(db, { surface, referenceId = null, providerReference = null, reason }) {
  const { rows } = await db.query(
    `WITH reversed AS (
       UPDATE promo_redemptions SET status = 'reversed', reversed_at = NOW(), reversal_reason = LEFT($4, 120)
        WHERE status <> 'reversed' AND surface = $1
          AND (($2::TEXT IS NOT NULL AND reference_id = $2) OR ($3::TEXT IS NOT NULL AND provider_reference = $3))
        RETURNING id, discount_code_id)
     UPDATE discount_codes d SET usage_count = GREATEST(0, COALESCE(d.usage_count, 0) - r.n), updated_at = NOW()
       FROM (SELECT discount_code_id, COUNT(*)::INT AS n FROM reversed GROUP BY 1) r
      WHERE d.id = r.discount_code_id
      RETURNING d.id`,
    [surface, referenceId == null ? null : String(referenceId), providerReference, String(reason || 'reversed')]);
  return rows.length;
}

/** Map a promo AppError to a client-safe response body. */
function promoErrorBody(err) {
  return { code: err.code, message: err.message, details: err.fields && Object.keys(err.fields).length ? err.fields : undefined };
}

module.exports = {
  SURFACES, FUNDED_BY, normalizeCode, computeDiscount, evaluatePromo, reservePromo, attachProviderReference,
  markRedeemed, reversePromo, promoErrorBody,
};
