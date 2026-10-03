'use strict';

/**
 * Restaurant customer top-ups with OxSteed approval (fiat money IN).
 *
 * Founder rule: OxSteed approves which restaurants are eligible for customer
 * top-ups, and money must never enter a restaurant food-wallet the restaurant
 * cannot withdraw. The flow mirrors the OxSteed Credit top-up pattern
 * (services/oxsteedCreditTopupService.js):
 *
 *   1. Merchant applies for eligibility; the application is REJECTED unless
 *      the restaurant has a connected Stripe payouts account
 *      (restaurant_connect_accounts, migration 656).
 *   2. An admin approves / rejects / suspends the application
 *      (restaurant_topup_eligibility).
 *   3. A customer creates a top-up intent. The server REJECTS the intent
 *      unless the restaurant is active AND the eligibility status is
 *      currently 'approved' (fail closed). Per-top-up min/max and a daily
 *      cap per user per restaurant are enforced; the idempotency key makes
 *      retries converge on one row and one Stripe PaymentIntent.
 *   4. The verified Stripe webhook (payment_intent.succeeded, metadata
 *      restaurant_topup_id) re-checks eligibility at that moment (covers
 *      approved-then-suspended with an in-flight intent) and then credits
 *      the user's restaurant food-wallet via the existing
 *      creditFoodWallet() path. Duplicate webhooks are idempotent inside
 *      one transaction. Failed/canceled intents never credit.
 *   5. Chargeback clawback: an admin debits the user's restaurant wallet
 *      with reason + audit. The wallet may go negative (explicitly flagged);
 *      it never silently fails.
 *
 * FEE: restaurant top-ups carry NO fee. TOPUP_FEE_BPS = 0 is the one
 * clearly-marked constant; changing the fee is a founder business decision.
 */

const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const {
  assertSupportedCreditCurrency,
} = require('./oxsteedCreditService');
const {
  creditFoodWallet,
  getOrCreateWalletAccount,
  computeWalletEntryHash,
  CURRENT_WALLET_HASH_ALGORITHM,
} = require('./foodWalletService');
const { postFoodWalletDualEntry } = require('./oxsteedCreditSubBankService');
const { recordIncident } = require('./incidentStore');
const { logAdminAction } = require('./auditService');
const { logFoodWalletOperatorAudit } = require('./foodWalletAuditService');

// ── Named constants ─────────────────────────────────────────────────────────
// Per-top-up bounds and the daily cap (per user per restaurant, trailing
// 24 hours). Chosen for a stored-value food wallet: large enough for a
// family dinner budget, small enough to bound fraud and chargeback blast
// radius. Changing these is a product decision, not a code fix.
const RESTAURANT_TOPUP_MIN_CENTS = 500; // $5.00
const RESTAURANT_TOPUP_MAX_CENTS = 50000; // $500.00
const RESTAURANT_TOPUP_DAILY_CAP_CENTS = 100000; // $1,000.00 per user per restaurant per 24h

// Step-up (fresh email challenge) bar, mirroring the OxSteed Credit pattern.
// Top-ups at or above this amount require a verified step-up challenge
// BEFORE any persistent side effect (the controller enforces it).
const RESTAURANT_TOPUP_STEPUP_THRESHOLD_CENTS = 25000; // $250.00

// FEE: default NO fee. This is the ONE clearly-marked fee constant.
// TOPUP_FEE_BPS = 0 means the customer pays amountCents and the restaurant
// wallet is credited amountCents. Changing this number is a FOUNDER BUSINESS
// DECISION (it changes unit economics and must be disclosed to merchants);
// it is not an engineering tuning knob.
const TOPUP_FEE_BPS = 0;

const STRIPE_INTENT_IDEMPOTENCY_PREFIX = 'restaurant-topup-intent:';
const WALLET_IDEMPOTENCY_PREFIX = 'restaurant-topup:';
const CLAWBACK_IDEMPOTENCY_PREFIX = 'restaurant-topup-clawback:';
const TOPUP_INTENT_TTL_MINUTES = 30;

const ELIGIBILITY_STATUSES = ['not_applied', 'pending', 'approved', 'rejected', 'suspended'];
const TOPUP_ACTIVE_FOR_CAP_STATUSES = ['pending', 'succeeded', 'requires_attention'];

function fail(message, code, status = 400, details) {
  throw new AppError(message, status, code, details);
}

function normalizeCurrency(value) {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(raw)) {
    fail('Currency must be a 3-letter ISO code', 'restaurant_topup_currency_invalid');
  }
  return raw;
}

function normalizeIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim().slice(0, 160) : '';
  if (!key) {
    fail('Idempotency-Key is required for restaurant top-ups', 'restaurant_topup_idempotency_key_required');
  }
  return key;
}

function normalizeString(value, max = 255) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function parseRestaurantId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Null-guarded lazy Stripe client: never construct with an undefined key.
function defaultGetStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new AppError('Stripe is not configured for restaurant top-ups', 503, 'restaurant_topup_stripe_unavailable');
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

function restaurantTopupRequiresStepup(amountCents) {
  return Number(amountCents) >= RESTAURANT_TOPUP_STEPUP_THRESHOLD_CENTS;
}

// ── Eligibility ─────────────────────────────────────────────────────────────

async function getRestaurantRow(client, restaurantId) {
  const { rows } = await client.query(
    `SELECT id, business_id, status, currency_code, display_name
       FROM food_restaurants
      WHERE id = $1`,
    [restaurantId]
  );
  return rows[0] || null;
}

async function getEligibility(client, restaurantId) {
  const { rows } = await client.query(
    `SELECT * FROM restaurant_topup_eligibility WHERE restaurant_id = $1`,
    [restaurantId]
  );
  return rows[0] || null;
}

function isEligibilityApproved(eligibility) {
  return !!eligibility && eligibility.status === 'approved';
}

// Founder rule, enforced in code: money must never enter a wallet the
// restaurant cannot withdraw. The merchant application (and the admin
// approval) fail closed unless the restaurant has a connected Stripe
// payouts account with payouts enabled and onboarding complete. Uses the
// locally cached connect row (refreshed from Stripe on every status read
// in the payouts surface); a missing row means "not connected".
async function assertPayoutsConnected(client, restaurantId) {
  const { rows } = await client.query(
    `SELECT restaurant_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete
       FROM restaurant_connect_accounts
      WHERE restaurant_id = $1`,
    [restaurantId]
  );
  const account = rows[0];
  if (!account || !account.stripe_account_id) {
    fail(
      'Connect payouts before enabling customer top-ups: the restaurant has no connected payout account.',
      'restaurant_topup_payouts_not_connected',
      409
    );
  }
  if (!account.payouts_enabled || !account.onboarding_complete) {
    fail(
      'Connect payouts before enabling customer top-ups: the payout account onboarding is not complete.',
      'restaurant_topup_payouts_not_ready',
      409
    );
  }
  return account;
}

async function assertRestaurantActiveForTopups(client, restaurantId) {
  const restaurant = await getRestaurantRow(client, restaurantId);
  if (!restaurant) {
    fail('Restaurant not found', 'restaurant_not_found', 404);
  }
  if (restaurant.status !== 'active') {
    fail(
      'Restaurant top-ups are not available for this restaurant right now.',
      'restaurant_topup_restaurant_inactive',
      409,
      { restaurantStatus: restaurant.status }
    );
  }
  return restaurant;
}

// Merchant application: "Enable customer top-ups". Sets status pending.
// Re-applying from rejected/suspended/not_applied moves back to pending for
// re-review. An already-approved restaurant is returned unchanged
// (idempotent). Always gated on payouts-connected first.
async function applyForEligibility({ restaurantId, actorUserId }) {
  const parsedId = parseRestaurantId(restaurantId);
  if (!parsedId) fail('Restaurant not found', 'restaurant_not_found', 404);
  return withTransaction(pool, async (client) => {
    const restaurant = await assertRestaurantActiveForTopups(client, parsedId);
    await assertPayoutsConnected(client, parsedId);

    const { rows } = await client.query(
      `INSERT INTO restaurant_topup_eligibility
         (restaurant_id, status, applied_at, updated_at)
       VALUES ($1, 'pending', NOW(), NOW())
       ON CONFLICT (restaurant_id) DO UPDATE
          SET status = CASE
                         WHEN restaurant_topup_eligibility.status = 'approved' THEN 'approved'
                         ELSE 'pending'
                       END,
              applied_at = CASE
                             WHEN restaurant_topup_eligibility.status = 'approved' THEN restaurant_topup_eligibility.applied_at
                             ELSE NOW()
                           END,
              decided_at = CASE
                             WHEN restaurant_topup_eligibility.status = 'approved' THEN restaurant_topup_eligibility.decided_at
                             ELSE NULL
                           END,
              decided_by = CASE
                             WHEN restaurant_topup_eligibility.status = 'approved' THEN restaurant_topup_eligibility.decided_by
                             ELSE NULL
                           END,
              decision_reason = CASE
                                  WHEN restaurant_topup_eligibility.status = 'approved' THEN restaurant_topup_eligibility.decision_reason
                                  ELSE NULL
                                END,
              updated_at = NOW()
       RETURNING *`,
      [parsedId]
    );
    const eligibility = rows[0];
    await logAdminAction({
      adminId: actorUserId || null,
      action: 'restaurant_topup.eligibility.apply',
      targetType: 'restaurant',
      targetKey: String(parsedId),
      description: `Merchant applied for customer top-up eligibility (${restaurant.display_name || parsedId})`,
      after: { status: eligibility.status },
      client,
      throwOnError: true,
    });
    return { restaurant, eligibility };
  }, 'restaurant_topup_apply');
}

// Admin decision. Approve re-checks payouts-connected (the merchant may have
// disconnected after applying) and requires an active restaurant; reject and
// suspend require a reason. Records decided_by / decided_at / decision_reason.
async function decideApplication({ restaurantId, adminId, decision, reason }) {
  const parsedId = parseRestaurantId(restaurantId);
  if (!parsedId) fail('Restaurant not found', 'restaurant_not_found', 404);
  if (!['approve', 'reject', 'suspend'].includes(decision)) {
    fail('Unknown eligibility decision', 'restaurant_topup_decision_invalid');
  }
  const normalizedReason = normalizeString(reason, 2000);
  if ((decision === 'reject' || decision === 'suspend') && !normalizedReason) {
    fail('A reason is required to reject or suspend top-up eligibility', 'restaurant_topup_decision_reason_required');
  }
  if (!adminId) fail('Admin identity is required', 'restaurant_topup_admin_required', 500);

  const nextStatus = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'suspended';

  return withTransaction(pool, async (client) => {
    const restaurant = await getRestaurantRow(client, parsedId);
    if (!restaurant) fail('Restaurant not found', 'restaurant_not_found', 404);
    if (decision === 'approve') {
      if (restaurant.status !== 'active') {
        fail('Cannot approve top-up eligibility for an inactive restaurant', 'restaurant_topup_restaurant_inactive', 409);
      }
      await assertPayoutsConnected(client, parsedId);
    }
    const before = await getEligibility(client, parsedId);
    const { rows } = await client.query(
      `INSERT INTO restaurant_topup_eligibility
         (restaurant_id, status, decided_at, decided_by, decision_reason, updated_at)
       VALUES ($1, $2, NOW(), $3, $4, NOW())
       ON CONFLICT (restaurant_id) DO UPDATE
          SET status = EXCLUDED.status,
              decided_at = EXCLUDED.decided_at,
              decided_by = EXCLUDED.decided_by,
              decision_reason = EXCLUDED.decision_reason,
              updated_at = NOW()
       RETURNING *`,
      [parsedId, nextStatus, adminId, normalizedReason]
    );
    const eligibility = rows[0];
    await logAdminAction({
      adminId,
      action: `restaurant_topup.eligibility.${decision}`,
      targetType: 'restaurant',
      targetKey: String(parsedId),
      description: `Top-up eligibility ${nextStatus} for restaurant ${restaurant.display_name || parsedId}${normalizedReason ? `: ${normalizedReason}` : ''}`,
      before: before ? { status: before.status } : null,
      after: { status: eligibility.status, reason: normalizedReason },
      client,
      throwOnError: true,
    });
    return { restaurant, eligibility, previousStatus: before ? before.status : 'not_applied' };
  }, 'restaurant_topup_decide');
}

async function listApplications({ status = 'pending', limit = 50, offset = 0 }) {
  const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : 'pending';
  if (!ELIGIBILITY_STATUSES.includes(normalizedStatus)) {
    fail('Unknown eligibility status filter', 'restaurant_topup_status_invalid');
  }
  const safeLimit = Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 50, 100));
  const safeOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);
  const { rows } = await pool.query(
    `SELECT e.*, fr.display_name AS restaurant_name, fr.status AS restaurant_status,
            fr.currency_code AS restaurant_currency
       FROM restaurant_topup_eligibility e
       JOIN food_restaurants fr ON fr.id = e.restaurant_id
      WHERE e.status = $1
      ORDER BY e.applied_at ASC NULLS LAST, e.restaurant_id ASC
      LIMIT $2 OFFSET $3`,
    [normalizedStatus, safeLimit, safeOffset]
  );
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM restaurant_topup_eligibility WHERE status = $1`,
    [normalizedStatus]
  );
  return { applications: rows, total: countRows[0] ? countRows[0].total : 0, limit: safeLimit, offset: safeOffset };
}

// ── Top-up intents ──────────────────────────────────────────────────────────

function validateTopupAmount(amountCents) {
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    fail('Top-up amount must be a positive integer number of cents', 'restaurant_topup_amount_invalid');
  }
  if (amount < RESTAURANT_TOPUP_MIN_CENTS) {
    fail(`Top-up amount is below the minimum of ${RESTAURANT_TOPUP_MIN_CENTS} cents`, 'restaurant_topup_amount_too_small');
  }
  if (amount > RESTAURANT_TOPUP_MAX_CENTS) {
    fail(`Top-up amount exceeds the maximum of ${RESTAURANT_TOPUP_MAX_CENTS} cents per top-up`, 'restaurant_topup_amount_too_large', 402);
  }
  return amount;
}

async function assertDailyCap(client, { userId, restaurantId, amountCents }) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS spent_cents
       FROM restaurant_topups
      WHERE user_id = $1
        AND restaurant_id = $2
        AND created_at >= NOW() - INTERVAL '24 hours'
        AND status = ANY($3)`,
    [userId, restaurantId, TOPUP_ACTIVE_FOR_CAP_STATUSES]
  );
  const spent = Number(rows[0] ? rows[0].spent_cents : 0);
  if (spent + amountCents > RESTAURANT_TOPUP_DAILY_CAP_CENTS) {
    fail(
      `Daily top-up cap of ${RESTAURANT_TOPUP_DAILY_CAP_CENTS} cents per restaurant exceeded`,
      'restaurant_topup_daily_cap_exceeded',
      402,
      { spentCents: String(spent), capCents: String(RESTAURANT_TOPUP_DAILY_CAP_CENTS) }
    );
  }
  return spent;
}

// Ensure the Stripe PaymentIntent exists for a pending row. Safe for
// concurrent retries: the deterministic Stripe idempotency key converges on
// one Stripe object, and the UPDATE only fills in a missing intent id.
async function ensureRestaurantStripeIntent({ topup, amount, currency, getStripe }) {
  const stripe = getStripe();
  if (topup.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(topup.stripe_payment_intent_id);
    return existing.client_secret || null;
  }
  let intent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        metadata: { restaurant_topup_id: String(topup.id) },
      },
      { idempotencyKey: `${STRIPE_INTENT_IDEMPOTENCY_PREFIX}${topup.id}` }
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error('[restaurant-topup] Stripe PaymentIntent creation failed', {
      topupId: String(topup.id),
      error: err.message,
    });
    await pool.query(
      `UPDATE restaurant_topups
          SET status = 'failed', updated_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [topup.id]
    );
    throw new AppError('Stripe payment initiation failed', 502, 'restaurant_topup_stripe_failed');
  }
  await pool.query(
    `UPDATE restaurant_topups
        SET stripe_payment_intent_id = $2, updated_at = NOW()
      WHERE id = $1 AND stripe_payment_intent_id IS NULL`,
    [topup.id, intent.id]
  );
  return intent.client_secret || null;
}

async function getTopupById(topupId) {
  const { rows } = await pool.query(`SELECT * FROM restaurant_topups WHERE id = $1`, [topupId]);
  return rows[0] || null;
}

async function createTopupIntent({ userId, restaurantId, amountCents, idempotencyKey, getStripe = defaultGetStripe }) {
  if (!userId) fail('Customer is required for a restaurant top-up', 'restaurant_topup_customer_required');
  const parsedRestaurantId = parseRestaurantId(restaurantId);
  if (!parsedRestaurantId) fail('Restaurant not found', 'restaurant_not_found', 404);
  const amount = validateTopupAmount(amountCents);
  const normalizedKey = normalizeIdempotencyKey(idempotencyKey);

  // Fail-closed gating BEFORE any persistent side effect: the restaurant
  // must be active, its currency must be one the wallet rails support, and
  // OxSteed's eligibility decision must currently be 'approved'.
  const { row: insertedOrExisting, created } = await withTransaction(pool, async (client) => {
    const restaurant = await assertRestaurantActiveForTopups(client, parsedRestaurantId);
    const currency = normalizeCurrency(restaurant.currency_code);
    assertSupportedCreditCurrency(currency);
    const eligibility = await getEligibility(client, parsedRestaurantId);
    if (!isEligibilityApproved(eligibility)) {
      fail(
        'Customer top-ups are not enabled for this restaurant.',
        'restaurant_topup_not_eligible',
        409,
        { eligibilityStatus: eligibility ? eligibility.status : 'not_applied' }
      );
    }
    await assertDailyCap(client, { userId, restaurantId: parsedRestaurantId, amountCents: amount });

    const { rows } = await client.query(
      `INSERT INTO restaurant_topups
         (restaurant_id, user_id, amount_cents, currency, status, idempotency_key, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW() + ($6 || ' minutes')::INTERVAL)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [parsedRestaurantId, userId, amount, currency, normalizedKey, String(TOPUP_INTENT_TTL_MINUTES)]
    );
    if (rows[0]) return { row: rows[0], created: true };
    const { rows: existingRows } = await client.query(
      `SELECT * FROM restaurant_topups WHERE idempotency_key = $1`,
      [normalizedKey]
    );
    return { row: existingRows[0] || null, created: false };
  }, 'restaurant_topup_create');

  if (!insertedOrExisting) {
    fail('Restaurant top-up could not be created', 'restaurant_topup_create_failed', 500);
  }
  let topup = insertedOrExisting;

  // Fingerprint check: a reused idempotency key must carry identical
  // semantics, including the same customer, restaurant, and amount. (The
  // currency is resolved from the restaurant, not caller-supplied, so it is
  // not part of the fingerprint.)
  if (
    String(topup.user_id) !== String(userId) ||
    Number(topup.restaurant_id) !== parsedRestaurantId ||
    Number(topup.amount_cents) !== amount
  ) {
    fail(
      'Top-up idempotency key was already used with different parameters',
      'restaurant_topup_idempotency_conflict',
      409
    );
  }

  if (topup.status === 'succeeded') {
    return { topup, clientSecret: null, replayed: true };
  }

  // A failed/canceled top-up is revivable: the customer is explicitly
  // retrying, and the same Stripe object (if any) stays confirmable.
  if (topup.status === 'failed' || topup.status === 'canceled') {
    const { rows: revivedRows } = await pool.query(
      `UPDATE restaurant_topups
          SET status = 'pending',
              expires_at = NOW() + ($2 || ' minutes')::INTERVAL,
              updated_at = NOW()
        WHERE id = $1 AND status = ANY($3)
        RETURNING *`,
      [topup.id, String(TOPUP_INTENT_TTL_MINUTES), ['failed', 'canceled']]
    );
    if (revivedRows[0]) topup = revivedRows[0];
  }

  const currency = normalizeCurrency(topup.currency);
  const clientSecret = await ensureRestaurantStripeIntent({ topup, amount, currency, getStripe });
  const canonical = (await getTopupById(topup.id)) || topup;
  return { topup: canonical, clientSecret, replayed: !created };
}

async function getUserTopup({ userId, restaurantId, topupId }) {
  const parsedRestaurantId = parseRestaurantId(restaurantId);
  if (!userId || !parsedRestaurantId || !topupId) return null;
  const { rows } = await pool.query(
    `SELECT * FROM restaurant_topups
      WHERE id = $1 AND restaurant_id = $2 AND user_id = $3`,
    [topupId, parsedRestaurantId, userId]
  );
  return rows[0] || null;
}

// ── Webhook completion ──────────────────────────────────────────────────────

// Webhook: the PaymentIntent succeeded. FIRST re-checks that the
// eligibility is still 'approved' and the restaurant still active at this
// moment (covers approved-then-suspended with an in-flight intent), then
// credits the user's restaurant food-wallet via the existing
// creditFoodWallet() path. Runs in a single DB transaction; the wallet
// credit's deterministic idempotency key plus the FOR UPDATE row lock make
// duplicate webhooks converge on a single credit. NEVER credits on
// failed/canceled.
async function completeRestaurantTopupFromWebhook({ paymentIntentId }) {
  let creditError = null;
  let topupId = null;
  const result = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM restaurant_topups WHERE stripe_payment_intent_id = $1 FOR UPDATE`,
      [paymentIntentId]
    );
    const topup = rows[0];
    if (!topup) return { outcome: 'ignored' };
    topupId = topup.id;
    if (topup.status === 'succeeded') return { outcome: 'duplicate', topupId };
    if (topup.status !== 'pending' && topup.status !== 'requires_attention') {
      return { outcome: 'ignored', reason: `status_${topup.status}`, topupId };
    }

    // Eligibility re-check at credit time: an admin may have suspended the
    // restaurant after the intent was created. Fail closed: block the
    // credit, park the row as failed, and page ops via a critical incident
    // (money moved at Stripe with no credit issued is a human-review item).
    // No rethrow: Stripe retrying while the restaurant stays suspended
    // would not change the outcome.
    const restaurant = await getRestaurantRow(client, topup.restaurant_id);
    const eligibility = await getEligibility(client, topup.restaurant_id);
    const stillEligible =
      restaurant && restaurant.status === 'active' && isEligibilityApproved(eligibility);
    if (!stillEligible) {
      await client.query(
        `UPDATE restaurant_topups
            SET status = 'failed', updated_at = NOW()
          WHERE id = $1 AND status = ANY($2)`,
        [topup.id, ['pending', 'requires_attention']]
      );
      await logAdminAction({
        adminId: null,
        action: 'restaurant_topup.webhook_blocked_ineligible',
        targetType: 'restaurant_topup',
        targetId: String(topup.id),
        description: `Top-up completion blocked: restaurant ${topup.restaurant_id} eligibility is ${eligibility ? eligibility.status : 'not_applied'} / restaurant status ${restaurant ? restaurant.status : 'missing'}`,
        after: {
          eligibilityStatus: eligibility ? eligibility.status : 'not_applied',
          restaurantStatus: restaurant ? restaurant.status : 'missing',
          paymentIntentId,
        },
        client,
        throwOnError: true,
      });
      return { outcome: 'blocked_ineligible', topupId };
    }

    const currency = normalizeCurrency(topup.currency);
    assertSupportedCreditCurrency(currency);
    const amount = Number(topup.amount_cents);

    // TOPUP_FEE_BPS = 0: no fee is taken. The wallet is credited the full
    // amount the customer paid. If the founder ever sets a fee, the fee
    // computation and its own ledger treatment belong here, with the net
    // credit and fee legs posted atomically.
    const creditAmount = Math.round((amount * (10000 - TOPUP_FEE_BPS)) / 10000);

    try {
      const { entry, replayed } = await creditFoodWallet(client, {
        restaurantId: Number(topup.restaurant_id),
        customerId: topup.user_id,
        currencyCode: currency,
        amountCents: creditAmount,
        description: 'Restaurant top-up via Stripe',
        referenceType: 'restaurant_topup',
        referenceId: String(topup.id),
        idempotencyKey: `${WALLET_IDEMPOTENCY_PREFIX}${topup.id}`,
        createdByUserId: null,
        actorType: 'system',
        metadata: {
          source: 'restaurant_topup',
          stripePaymentIntentId: paymentIntentId,
          feeBps: TOPUP_FEE_BPS,
        },
      });
      await client.query(
        `UPDATE restaurant_topups
            SET status = 'succeeded', wallet_ledger_entry_id = $2, updated_at = NOW()
          WHERE id = $1`,
        [topup.id, entry.id]
      );
      return { outcome: replayed ? 'duplicate' : 'completed', topupId, ledgerEntryId: entry.id };
    } catch (err) {
      await client.query(
        `UPDATE restaurant_topups
            SET status = 'requires_attention', updated_at = NOW()
          WHERE id = $1`,
        [topup.id]
      );
      creditError = err;
      return { outcome: 'requires_attention', topupId };
    }
  }, 'restaurant_topup_complete');

  if (result.outcome === 'requires_attention' && creditError) {
    try {
      await recordIncident({
        type: 'restaurant_topup_uncredited',
        severity: 'critical',
        message: 'Stripe payment received for a restaurant top-up but the wallet credit was not posted',
        dedupeKey: `restaurant-topup-uncredited:${topupId || paymentIntentId}`,
        details: { topupId: String(topupId || ''), paymentIntentId, error: creditError.message },
      });
    } catch (incidentErr) {
      logger.error('[restaurant-topup] Failed to record uncredited top-up incident', {
        error: incidentErr.message,
      });
    }
    throw creditError;
  }
  if (result.outcome === 'blocked_ineligible') {
    try {
      await recordIncident({
        type: 'restaurant_topup_blocked_ineligible',
        severity: 'critical',
        message: 'Restaurant top-up completion blocked: eligibility revoked or restaurant inactive after payment',
        dedupeKey: `restaurant-topup-blocked:${result.topupId}`,
        details: { topupId: String(result.topupId), paymentIntentId },
      });
    } catch (incidentErr) {
      logger.error('[restaurant-topup] Failed to record blocked top-up incident', {
        error: incidentErr.message,
      });
    }
  }
  return result;
}

// Webhook: the PaymentIntent failed or was canceled. Only pending rows are
// marked; succeeded/requires_attention rows keep their state. NEVER credits.
async function failRestaurantTopupFromWebhook({ paymentIntentId }) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT id, status FROM restaurant_topups WHERE stripe_payment_intent_id = $1 FOR UPDATE`,
      [paymentIntentId]
    );
    const topup = rows[0];
    if (!topup) return { outcome: 'ignored' };
    if (topup.status !== 'pending') {
      return { outcome: 'ignored', reason: `status_${topup.status}` };
    }
    await client.query(
      `UPDATE restaurant_topups
          SET status = 'failed', updated_at = NOW()
        WHERE id = $1`,
      [topup.id]
    );
    return { outcome: 'failed' };
  }, 'restaurant_topup_fail');
}

// Central webhook entry point for restaurant top-up Stripe events. Returns
// true when the event is ours and was handled, false when it is not ours
// (the caller falls through to the other Stripe flows). The upstream
// beginWebhookEvent receipt dedupe makes same-event-id replays no-ops before
// this is reached.
async function applyRestaurantTopupWebhookEvent({ type, object }) {
  const metadata = object?.metadata || {};
  switch (type) {
    case 'payment_intent.succeeded': {
      if (!metadata.restaurant_topup_id) return false;
      await completeRestaurantTopupFromWebhook({ paymentIntentId: object.id });
      return true;
    }
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled': {
      if (!metadata.restaurant_topup_id) return false;
      await failRestaurantTopupFromWebhook({ paymentIntentId: object.id });
      return true;
    }
    default:
      return false;
  }
}

// ── Clawback (chargeback recovery) ──────────────────────────────────────────

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof key !== 'string') continue;
    const cleanKey = key.trim().slice(0, 80);
    if (!cleanKey) continue;
    out[cleanKey] = typeof val === 'string' ? val.slice(0, 500) : val;
  }
  return out;
}

// Posts a 'debit' ledger entry that is allowed to take the wallet negative.
// Mirrors applyWalletLedgerEntry()'s hash chain, account update, and central
// dual-posting conventions exactly, minus the non-negative floor. ONLY the
// admin clawback path may call this; every normal debit still fails closed
// in applyWalletLedgerEntry.
async function postNegativeAllowingDebit(client, {
  restaurantId,
  customerId,
  currencyCode,
  amountCents,
  description,
  referenceType,
  referenceId,
  idempotencyKey,
  createdByUserId,
  correlationId = null,
  actorType = 'system',
  metadata = {},
}) {
  const normalizedAmount = Math.round(Number(amountCents || 0));
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    fail('Validation failed', 400, 'validation_failed', {
      amountCents: 'Amount must be a positive number of cents',
    });
  }
  const normalizedCurrency = normalizeCurrency(currencyCode);
  const normalizedDescription = normalizeString(description, 255);
  const normalizedReferenceType = normalizeString(referenceType, 60);
  const normalizedReferenceId = normalizeString(referenceId, 120);
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 120);
  const normalizedCorrelationId = normalizeString(correlationId, 120);
  const normalizedActorType = normalizeString(actorType, 40) || 'system';
  const normalizedMetadata = normalizeMetadata(metadata);

  const { rows: accountRows } = await client.query(
    `SELECT a.* FROM food_customer_wallet_accounts a
      WHERE a.restaurant_id = $1 AND a.customer_id = $2
      FOR UPDATE`,
    [restaurantId, customerId]
  );
  const account = accountRows[0];
  if (!account) {
    fail('Wallet account not found', 'wallet_not_found', 409);
  }
  if (account.status !== 'active') {
    fail('Wallet account is not active', 'wallet_inactive', 409, { status: account.status });
  }
  if (account.currency_code && normalizeCurrency(account.currency_code) !== normalizedCurrency) {
    fail('Wallet currency mismatch', 'wallet_currency_mismatch', 409, {
      expectedCurrencyCode: normalizeCurrency(account.currency_code),
      receivedCurrencyCode: normalizedCurrency,
    });
  }

  // Idempotent replay: an existing clawback entry for this top-up is
  // returned as-is (no second debit).
  if (normalizedIdempotencyKey) {
    const { rows: existingRows } = await client.query(
      `SELECT * FROM food_customer_wallet_ledger
        WHERE account_id = $1 AND idempotency_key = $2
        LIMIT 1`,
      [account.id, normalizedIdempotencyKey]
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      return {
        account,
        entry: existing,
        replayed: true,
        wentNegative: Number(existing.balance_after_cents || 0) < 0,
        balanceBeforeCents: Number(existing.balance_after_cents || 0) + Number(existing.amount_cents || 0),
      };
    }
  }

  const balanceBeforeCents = Number(account.balance_cents || 0);
  const nextBalance = balanceBeforeCents - normalizedAmount;
  const wentNegative = nextBalance < 0;

  const nextSequence = Number(account.ledger_version || 0) + 1;
  const previousEntryHash = normalizeString(account.last_entry_hash, 128);
  const entryHash = computeWalletEntryHash(
    {
      accountId: account.id,
      restaurantId,
      customerId,
      entryType: 'debit',
      amountCents: normalizedAmount,
      balanceAfterCents: nextBalance,
      currencyCode: normalizedCurrency,
      sequence: nextSequence,
      previousEntryHash,
      referenceType: normalizedReferenceType,
      referenceId: normalizedReferenceId,
      correlationId: normalizedCorrelationId,
      createdByUserId,
      actorType: normalizedActorType,
      metadata: normalizedMetadata,
    },
    CURRENT_WALLET_HASH_ALGORITHM
  );

  const { rows: updatedRows } = await client.query(
    `UPDATE food_customer_wallet_accounts
        SET balance_cents = $1,
            currency_code = $2,
            ledger_version = $3,
            last_entry_hash = $4,
            last_posted_at = NOW(),
            updated_at = NOW()
      WHERE id = $5
      RETURNING *`,
    [nextBalance, normalizedCurrency, nextSequence, entryHash, account.id]
  );
  const updatedAccount = updatedRows[0];

  const { rows: ledgerRows } = await client.query(
    `INSERT INTO food_customer_wallet_ledger
       (account_id, restaurant_id, customer_id, entry_type, amount_cents, balance_after_cents,
        currency_code, description, reference_type, reference_id, idempotency_key,
        created_by_user_id, metadata, entry_sequence, previous_entry_hash, entry_hash,
        correlation_id, actor_type, hash_algorithm)
     VALUES
       ($1, $2, $3, 'debit', $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      updatedAccount.id,
      restaurantId,
      customerId,
      normalizedAmount,
      nextBalance,
      normalizedCurrency,
      normalizedDescription,
      normalizedReferenceType,
      normalizedReferenceId,
      normalizedIdempotencyKey,
      createdByUserId,
      JSON.stringify(normalizedMetadata),
      nextSequence,
      previousEntryHash,
      entryHash,
      normalizedCorrelationId,
      normalizedActorType,
      CURRENT_WALLET_HASH_ALGORITHM,
    ]
  );
  const ledgerEntry = ledgerRows[0];

  // Same central-journal dual posting as every other food-wallet movement,
  // in the same transaction (fail-open backfill when the rail is disabled,
  // fail closed when frozen).
  await postFoodWalletDualEntry(client, {
    ledgerEntryId: ledgerEntry.id,
    restaurantId,
    customerId,
    currencyCode: normalizedCurrency,
    amountCents: normalizedAmount,
    entryType: 'debit',
    referenceType: normalizedReferenceType,
    referenceId: normalizedReferenceId,
    actorType: normalizedActorType,
    actorUserId: createdByUserId,
    createdByUserId,
    correlationId: normalizedCorrelationId,
    metadata: normalizedMetadata,
  });

  return {
    account: updatedAccount,
    entry: ledgerEntry,
    replayed: false,
    wentNegative,
    balanceBeforeCents,
  };
}

// Chargeback clawback: debit the user's restaurant wallet by the credited
// top-up amount, with reason + audit. Only succeeded top-ups can be clawed
// back. If the credit was already spent, the wallet goes negative and the
// response + audit explicitly flag it. Never silently fails: wallet or
// audit write errors roll the whole transaction back.
async function clawbackTopup({ topupId, adminId, reason, requestIp = null, correlationId = null }) {
  const normalizedReason = normalizeString(reason, 2000);
  if (!normalizedReason) {
    fail('A reason is required for a top-up clawback', 'restaurant_topup_clawback_reason_required');
  }
  if (!topupId) fail('Top-up id is required', 'restaurant_topup_id_required');
  if (!adminId) fail('Admin identity is required', 'restaurant_topup_admin_required', 500);

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT t.*, fr.business_id, fr.display_name AS restaurant_name
         FROM restaurant_topups t
         JOIN food_restaurants fr ON fr.id = t.restaurant_id
        WHERE t.id = $1
        FOR UPDATE OF t`,
      [topupId]
    );
    const topup = rows[0];
    if (!topup) {
      fail('Restaurant top-up not found', 'restaurant_topup_not_found', 404);
    }
    if (topup.status !== 'succeeded') {
      fail(
        'Only a succeeded top-up can be clawed back',
        'restaurant_topup_clawback_invalid_status',
        409,
        { status: topup.status }
      );
    }

    const amount = Number(topup.amount_cents);
    const currency = normalizeCurrency(topup.currency);

    const { account, entry, replayed, wentNegative, balanceBeforeCents } =
      await postNegativeAllowingDebit(client, {
        restaurantId: Number(topup.restaurant_id),
        customerId: topup.user_id,
        currencyCode: currency,
        amountCents: amount,
        description: `Chargeback clawback for restaurant top-up ${topup.id}`,
        referenceType: 'restaurant_topup_clawback',
        referenceId: String(topup.id),
        idempotencyKey: `${CLAWBACK_IDEMPOTENCY_PREFIX}${topup.id}`,
        createdByUserId: adminId,
        correlationId,
        actorType: 'admin',
        metadata: {
          source: 'restaurant_topup_clawback',
          topupId: String(topup.id),
          stripePaymentIntentId: topup.stripe_payment_intent_id,
          reason: normalizedReason,
        },
      });

    const balanceAfterCents = Number(entry.balance_after_cents || 0);

    // Transactional audits: both commit or both roll back with the debit.
    await logAdminAction({
      adminId,
      action: 'restaurant_topup.clawback',
      targetType: 'restaurant_topup',
      targetId: String(topup.id),
      description: `Clawback of restaurant top-up ${topup.id} (${amount} ${currency})${wentNegative ? ' - WALLET WENT NEGATIVE' : ''}: ${normalizedReason}`,
      before: { balanceCents: balanceBeforeCents, topupStatus: topup.status },
      after: {
        balanceCents: balanceAfterCents,
        wentNegative,
        ledgerEntryId: entry.id,
        replayed,
      },
      req: requestIp ? { ip: requestIp, headers: {} } : null,
      client,
      throwOnError: true,
    });
    await logFoodWalletOperatorAudit(client, {
      restaurantId: Number(topup.restaurant_id),
      businessId: topup.business_id || null,
      walletAccountId: account.id,
      customerId: topup.user_id,
      operatorUserId: adminId,
      actionType: 'restaurant_topup_clawback',
      amountCents: amount,
      currencyCode: currency,
      correlationId,
      requestIp,
      metadata: {
        topupId: String(topup.id),
        reason: normalizedReason,
        wentNegative,
        ledgerEntryId: entry.id,
        balanceBeforeCents,
        balanceAfterCents,
      },
    });

    return {
      topupId: String(topup.id),
      restaurantId: String(topup.restaurant_id),
      userId: String(topup.user_id),
      amountCents: amount,
      currency,
      ledgerEntryId: String(entry.id),
      balanceBeforeCents,
      balanceAfterCents,
      wentNegative,
      replayed,
      reason: normalizedReason,
    };
  }, 'restaurant_topup_clawback');
}

async function getRestaurantCurrency(restaurantId) {
  const parsedId = parseRestaurantId(restaurantId);
  if (!parsedId) return 'USD';
  const { rows } = await pool.query(
    `SELECT currency_code FROM food_restaurants WHERE id = $1`,
    [parsedId]
  );
  const code = rows[0] ? String(rows[0].currency_code || 'USD').toUpperCase() : 'USD';
  return /^[A-Z]{3}$/.test(code) ? code : 'USD';
}

module.exports = {
  // Named constants (reported; the fee is a founder business decision).
  RESTAURANT_TOPUP_MIN_CENTS,
  RESTAURANT_TOPUP_MAX_CENTS,
  RESTAURANT_TOPUP_DAILY_CAP_CENTS,
  RESTAURANT_TOPUP_STEPUP_THRESHOLD_CENTS,
  TOPUP_FEE_BPS,

  restaurantTopupRequiresStepup,
  getEligibility,
  isEligibilityApproved,
  applyForEligibility,
  decideApplication,
  listApplications,
  getRestaurantCurrency,
  createTopupIntent,
  getTopupById,
  getUserTopup,
  completeRestaurantTopupFromWebhook,
  failRestaurantTopupFromWebhook,
  applyRestaurantTopupWebhookEvent,
  clawbackTopup,
};
