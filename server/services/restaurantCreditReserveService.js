'use strict';

/**
 * Phase 4: restaurant credit pre-purchase reserve ("gift card inventory" model).
 *
 * A restaurant pre-purchases OxSteed Credit into a reserve BEFORE it may
 * issue restaurant credit to customers. Issuance is capped at the reserve
 * balance: the money sits with OxSteed before any customer is exposed, which
 * removes the enforcement problem.
 *
 * Money-safety contract (fail closed):
 *  - The reserve is credited ONLY after Stripe confirms the PaymentIntent
 *    succeeded. confirmReservePurchase re-reads the intent from Stripe and
 *    requires status 'succeeded' with matching amount and currency; anything
 *    else leaves the reserve untouched.
 *  - Issuance draws the reserve down atomically inside the SAME database
 *    transaction as the customer wallet credit (debitCreditReserveForIssuance
 *    locks the reserve row FOR UPDATE and throws 409
 *    insufficient_credit_reserve when the balance cannot cover the issuance,
 *    which rolls the wallet credit back with it).
 *  - Opt-in per restaurant: restaurants WITHOUT a reserve row are NOT
 *    capped by this phase. They continue under the trial-tier cap, which
 *    Phase 5 owns. The first confirmed purchase creates the reserve row,
 *    which is what opts a restaurant into enforcement.
 */

const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const pool = require('../db');

// 2.5% platform fee on reserve purchases: the restaurant pays amount_cents,
// the reserve is credited with amount_cents - fee_cents.
const RESERVE_FEE_BPS = 250;
const MIN_PURCHASE_CENTS = 1000; // $10
const MAX_PURCHASE_CENTS = 1000000; // $10,000

function defaultGetStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new AppError('Stripe is not configured for credit reserve purchases', 503, 'credit_reserve_stripe_unavailable');
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

function fail(message, code, status = 400, details) {
  throw new AppError(message, status, code, details);
}

/**
 * Fee math: fee_cents = round(amount_cents * 0.025), issuable = amount - fee.
 * Half-cent fees round up (Math.round), so the restaurant is never credited
 * more than it paid minus the fee.
 */
function computeReserveFee(amountCents) {
  const feeCents = Math.round((amountCents * RESERVE_FEE_BPS) / 10000);
  return { feeCents, issuableCents: amountCents - feeCents };
}

function validatePurchaseAmount(amountCents) {
  const amount = Math.round(Number(amountCents));
  if (!Number.isSafeInteger(amount) || amount < MIN_PURCHASE_CENTS || amount > MAX_PURCHASE_CENTS) {
    fail(
      `Reserve purchase amount must be between $${(MIN_PURCHASE_CENTS / 100).toFixed(2)} and $${(MAX_PURCHASE_CENTS / 100).toFixed(2)}`,
      'credit_reserve_amount_invalid',
      400,
      { minCents: MIN_PURCHASE_CENTS, maxCents: MAX_PURCHASE_CENTS }
    );
  }
  return amount;
}

function normalizeIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim().slice(0, 120) : '';
  if (!key) {
    fail('An idempotency key is required for reserve purchases', 'credit_reserve_idempotency_key_required');
  }
  return key;
}

function normalizeCurrency(value) {
  const currency = String(value || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    fail('Invalid reserve currency', 'credit_reserve_currency_invalid');
  }
  return currency;
}

function parseRestaurantId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parsePurchaseId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function ensurePurchaseStripeIntent({ purchase, amount, currency, getStripe }) {
  const stripe = getStripe();
  if (purchase.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(purchase.stripe_payment_intent_id);
    return existing.client_secret || null;
  }
  let intent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        description: `Credit reserve purchase · restaurant ${purchase.restaurant_id}`,
        metadata: {
          credit_reserve_purchase_id: String(purchase.id),
          restaurant_id: String(purchase.restaurant_id),
        },
      },
      {
        // Deterministic key so a retried purchase replays the same
        // PaymentIntent instead of charging the restaurant twice.
        idempotencyKey: `credit-reserve-purchase:${purchase.id}`,
      }
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error('[credit-reserve] Stripe PaymentIntent creation failed', {
      purchaseId: String(purchase.id),
      error: err.message,
    });
    await pool.query(
      `UPDATE restaurant_credit_reserve_purchases
          SET status = 'failed', updated_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [purchase.id]
    );
    fail('The card payment could not be started', 'credit_reserve_stripe_failed', 502);
  }
  if (!intent?.id || !intent?.client_secret) {
    fail('The card payment could not be started', 'credit_reserve_stripe_failed', 502);
  }
  await pool.query(
    `UPDATE restaurant_credit_reserve_purchases
        SET stripe_payment_intent_id = $2, updated_at = NOW()
      WHERE id = $1 AND stripe_payment_intent_id IS NULL`,
    [purchase.id, intent.id]
  );
  return intent.client_secret || null;
}

/**
 * Create (or replay) a reserve purchase intent. Returns the purchase row,
 * the Stripe client secret for Elements, the fee math, and whether the
 * idempotency key was replayed. The reserve is NOT credited here; that
 * happens only in confirmReservePurchase after Stripe reports success.
 */
async function createReservePurchase({
  restaurantId,
  operatorUserId,
  amountCents,
  currencyCode,
  idempotencyKey,
  getStripe = defaultGetStripe,
}) {
  const parsedRestaurantId = parseRestaurantId(restaurantId);
  if (!parsedRestaurantId) fail('Restaurant not found', 'restaurant_not_found', 404);
  const amount = validatePurchaseAmount(amountCents);
  const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
  const currency = normalizeCurrency(currencyCode);
  const { feeCents, issuableCents } = computeReserveFee(amount);

  const { row: purchase, created } = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO restaurant_credit_reserve_purchases
         (restaurant_id, amount_cents, fee_cents, issuable_cents, currency_code,
          status, idempotency_key, initiated_by)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
       ON CONFLICT (restaurant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [parsedRestaurantId, amount, feeCents, issuableCents, currency, normalizedKey, operatorUserId || null]
    );
    if (rows[0]) return { row: rows[0], created: true };
    const { rows: existingRows } = await client.query(
      `SELECT * FROM restaurant_credit_reserve_purchases
        WHERE restaurant_id = $1 AND idempotency_key = $2
        LIMIT 1`,
      [parsedRestaurantId, normalizedKey]
    );
    return { row: existingRows[0] || null, created: false };
  }, 'credit_reserve_purchase_create');

  if (!purchase) {
    fail('Reserve purchase could not be created', 'credit_reserve_purchase_create_failed', 500);
  }

  // Fingerprint check: a reused idempotency key must carry the same amount.
  // (The restaurant is part of the conflict target, so it always matches.)
  if (Number(purchase.amount_cents) !== amount) {
    fail(
      'Reserve purchase idempotency key was already used with a different amount',
      'credit_reserve_idempotency_conflict',
      409
    );
  }

  if (purchase.status === 'succeeded') {
    return { purchase, clientSecret: null, feeCents, issuableCents, replayed: true };
  }
  if (purchase.status === 'failed' || purchase.status === 'canceled') {
    const { rows: revivedRows } = await pool.query(
      `UPDATE restaurant_credit_reserve_purchases
          SET status = 'pending', updated_at = NOW()
        WHERE id = $1 AND status = ANY($2)
        RETURNING *`,
      [purchase.id, ['failed', 'canceled']]
    );
    if (revivedRows[0]) purchase = revivedRows[0];
  }

  const clientSecret = await ensurePurchaseStripeIntent({ purchase, amount, currency, getStripe });
  const { rows: [canonical] } = await pool.query(
    `SELECT * FROM restaurant_credit_reserve_purchases WHERE id = $1`,
    [purchase.id]
  );
  return { purchase: canonical || purchase, clientSecret, feeCents, issuableCents, replayed: !created };
}

async function markPurchaseFailed(client, purchaseId, fromStatuses = ['pending']) {
  const { rows } = await client.query(
    `UPDATE restaurant_credit_reserve_purchases
        SET status = 'failed', updated_at = NOW()
      WHERE id = $1 AND status = ANY($2)
      RETURNING *`,
    [purchaseId, fromStatuses]
  );
  return rows[0] || null;
}

async function creditReserveForPurchase(client, { purchase }) {
  const issuable = Number(purchase.issuable_cents);
  const { rows: [reserve] } = await client.query(
    `INSERT INTO restaurant_credit_reserves
       (restaurant_id, balance_cents, currency_code, lifetime_purchased_cents, lifetime_issued_cents, updated_at)
     VALUES ($1, $2, $3, $2, 0, NOW())
     ON CONFLICT (restaurant_id) DO UPDATE
       SET balance_cents = restaurant_credit_reserves.balance_cents + EXCLUDED.balance_cents,
           lifetime_purchased_cents = restaurant_credit_reserves.lifetime_purchased_cents + EXCLUDED.lifetime_purchased_cents,
           updated_at = NOW()
     RETURNING *`,
    [purchase.restaurant_id, issuable, purchase.currency_code]
  );
  const { rows: [ledgerEntry] } = await client.query(
    `INSERT INTO restaurant_credit_reserve_ledger
       (restaurant_id, amount_cents, balance_after_cents, reference_type, reference_id, stripe_payment_intent_id)
     VALUES ($1, $2, $3, 'purchase', $4, $5)
     RETURNING *`,
    [purchase.restaurant_id, issuable, reserve.balance_cents, String(purchase.id), purchase.stripe_payment_intent_id]
  );
  const { rows: [updatedPurchase] } = await client.query(
    `UPDATE restaurant_credit_reserve_purchases
        SET status = 'succeeded', confirmed_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [purchase.id]
  );
  return { reserve, ledgerEntry, purchase: updatedPurchase || purchase };
}

/**
 * Confirm a reserve purchase after the card payment. Re-reads the
 * PaymentIntent from Stripe and credits the reserve ONLY when it is
 * 'succeeded' with matching amount and currency. Idempotent: a purchase
 * already marked 'succeeded' returns the current reserve without crediting
 * again. Anything else fails closed and leaves the reserve untouched.
 */
async function confirmReservePurchase({ restaurantId, purchaseId, getStripe = defaultGetStripe }) {
  const parsedRestaurantId = parseRestaurantId(restaurantId);
  const parsedPurchaseId = parsePurchaseId(purchaseId);
  if (!parsedRestaurantId || !parsedPurchaseId) {
    fail('Reserve purchase not found', 'credit_reserve_purchase_not_found', 404);
  }

  const { rows: [purchase] } = await pool.query(
    `SELECT * FROM restaurant_credit_reserve_purchases
      WHERE id = $1 AND restaurant_id = $2`,
    [parsedPurchaseId, parsedRestaurantId]
  );
  if (!purchase) {
    fail('Reserve purchase not found', 'credit_reserve_purchase_not_found', 404);
  }
  if (purchase.status === 'succeeded') {
    const reserve = await getReserveBalance(parsedRestaurantId);
    return { purchase, reserve, ledgerEntry: null, duplicate: true };
  }
  if (purchase.status !== 'pending') {
    fail('Reserve purchase is not pending', 'credit_reserve_purchase_not_pending', 409, { status: purchase.status });
  }
  if (!purchase.stripe_payment_intent_id) {
    fail('Reserve purchase has no Stripe payment to confirm', 'credit_reserve_purchase_not_ready', 409);
  }

  const stripe = getStripe();
  let intent;
  try {
    intent = await stripe.paymentIntents.retrieve(purchase.stripe_payment_intent_id);
  } catch (err) {
    logger.error('[credit-reserve] Stripe PaymentIntent retrieve failed at confirm', {
      purchaseId: String(purchase.id),
      error: err.message,
    });
    fail('Could not verify the card payment', 'credit_reserve_confirm_unavailable', 502);
  }

  const expectedAmount = Number(purchase.amount_cents);
  const expectedCurrency = String(purchase.currency_code || 'USD').toLowerCase();
  if (intent.status !== 'succeeded') {
    // Fail closed: only a Stripe-confirmed success credits the reserve.
    // Terminal failure parks the purchase as failed; anything else stays
    // pending so the client can retry the confirm after the payer finishes.
    if (intent.status === 'canceled') {
      await withTransaction(pool, async (client) => {
        await markPurchaseFailed(client, purchase.id);
      }, 'credit_reserve_purchase_mark_failed');
      fail('The card payment was canceled; the reserve was not credited', 'credit_reserve_payment_failed', 409);
    }
    fail('The card payment has not completed yet', 'credit_reserve_payment_pending', 409, {
      stripeStatus: intent.status,
    });
  }
  if (Number(intent.amount) !== expectedAmount || String(intent.currency || '').toLowerCase() !== expectedCurrency) {
    // The money at Stripe does not match this purchase record. Do NOT
    // credit; park the purchase as failed for human review (money moved
    // with no matching credit is a critical incident).
    await withTransaction(pool, async (client) => {
      await markPurchaseFailed(client, purchase.id);
    }, 'credit_reserve_purchase_amount_mismatch');
    logger.error('[credit-reserve] PaymentIntent amount/currency mismatch at confirm', {
      purchaseId: String(purchase.id),
      paymentIntentId: purchase.stripe_payment_intent_id,
      expectedAmount,
      stripeAmount: intent.amount,
      expectedCurrency,
      stripeCurrency: intent.currency,
    });
    fail('The card payment does not match this purchase', 'credit_reserve_amount_mismatch', 409);
  }

  return withTransaction(pool, async (client) => {
    const { rows: [locked] } = await client.query(
      `SELECT * FROM restaurant_credit_reserve_purchases
        WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
      [parsedPurchaseId, parsedRestaurantId]
    );
    if (!locked) {
      fail('Reserve purchase not found', 'credit_reserve_purchase_not_found', 404);
    }
    if (locked.status === 'succeeded') {
      const reserve = await getReserveBalance(client, parsedRestaurantId);
      return { purchase: locked, reserve, ledgerEntry: null, duplicate: true };
    }
    if (locked.status !== 'pending') {
      fail('Reserve purchase is not pending', 'credit_reserve_purchase_not_pending', 409, { status: locked.status });
    }
    const credited = await creditReserveForPurchase(client, { purchase: locked });
    return { ...credited, duplicate: false };
  }, 'credit_reserve_purchase_confirm');
}

/**
 * Read the reserve balance. Accepts either the pool or a transaction client
 * (first arg) — the confirm path re-reads inside its own transaction.
 */
async function getReserveBalance(dbOrClient, restaurantIdArg) {
  const queryable = restaurantIdArg === undefined ? pool : dbOrClient;
  const restaurantId = restaurantIdArg === undefined ? dbOrClient : restaurantIdArg;
  const parsedRestaurantId = parseRestaurantId(restaurantId);
  if (!parsedRestaurantId) return null;
  const { rows } = await queryable.query(
    `SELECT * FROM restaurant_credit_reserves WHERE restaurant_id = $1`,
    [parsedRestaurantId]
  );
  return rows[0] || null;
}

async function listReserveLedger(restaurantId, { limit = 50, offset = 0 } = {}) {
  const parsedRestaurantId = parseRestaurantId(restaurantId);
  if (!parsedRestaurantId) fail('Restaurant not found', 'restaurant_not_found', 404);
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
  const safeOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const [{ rows }, { rows: [countRow] }] = await Promise.all([
    pool.query(
      `SELECT * FROM restaurant_credit_reserve_ledger
        WHERE restaurant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [parsedRestaurantId, safeLimit, safeOffset]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM restaurant_credit_reserve_ledger WHERE restaurant_id = $1`,
      [parsedRestaurantId]
    ),
  ]);
  return { entries: rows, total: Number(countRow?.total || 0), limit: safeLimit, offset: safeOffset };
}

/**
 * Issuance-cap enforcement for the opt-in reserve system.
 *
 * Called INSIDE the same database transaction as the customer wallet credit
 * (client is the transaction client). Behavior:
 *  - No reserve row for this restaurant -> the restaurant has NOT opted in;
 *    returns { enforced: false } and the caller proceeds under the
 *    trial-tier cap (Phase 5). This is the documented opt-in gate.
 *  - Reserve row exists -> the row is locked FOR UPDATE, the balance must
 *    cover amountCents, and the drawdown + append-only ledger row are
 *    written atomically. A shortfall throws 409 insufficient_credit_reserve,
 *    which rolls the wallet credit back with it (fail closed).
 */
async function debitCreditReserveForIssuance(client, { restaurantId, amountCents, referenceType, referenceId }) {
  const parsedRestaurantId = parseRestaurantId(restaurantId);
  const amount = Math.round(Number(amountCents));
  if (!parsedRestaurantId || !Number.isSafeInteger(amount) || amount <= 0) {
    fail('Invalid issuance amount for credit reserve', 'credit_reserve_issuance_invalid');
  }
  const { rows: [reserve] } = await client.query(
    `SELECT * FROM restaurant_credit_reserves WHERE restaurant_id = $1 FOR UPDATE`,
    [parsedRestaurantId]
  );
  if (!reserve) {
    // Opt-in gate: no reserve row means the restaurant is not in the
    // pre-purchase reserve system; the trial-tier cap applies instead.
    return { enforced: false };
  }
  const balance = Number(reserve.balance_cents || 0);
  if (balance < amount) {
    fail('Restaurant credit reserve is insufficient for this issuance', 'insufficient_credit_reserve', 409, {
      balanceCents: balance,
      requiredCents: amount,
    });
  }
  const { rows: [updated] } = await client.query(
    `UPDATE restaurant_credit_reserves
        SET balance_cents = balance_cents - $2,
            lifetime_issued_cents = lifetime_issued_cents + $2,
            updated_at = NOW()
      WHERE restaurant_id = $1
      RETURNING *`,
    [parsedRestaurantId, amount]
  );
  const { rows: [ledgerEntry] } = await client.query(
    `INSERT INTO restaurant_credit_reserve_ledger
       (restaurant_id, amount_cents, balance_after_cents, reference_type, reference_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [parsedRestaurantId, -amount, updated.balance_cents, referenceType || 'issuance', referenceId ? String(referenceId) : null]
  );
  return { enforced: true, reserve: updated, ledgerEntry };
}

module.exports = {
  RESERVE_FEE_BPS,
  MIN_PURCHASE_CENTS,
  MAX_PURCHASE_CENTS,
  computeReserveFee,
  createReservePurchase,
  confirmReservePurchase,
  getReserveBalance,
  listReserveLedger,
  debitCreditReserveForIssuance,
};
