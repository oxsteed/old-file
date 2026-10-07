const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
if (!process.env.STRIPE_SECRET_KEY) {
  logger.error('[FATAL] STRIPE_SECRET_KEY is not set - subscription features will fail.');
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const { withTransaction } = require('../utils/transaction');
const pricingService = require('../services/pricingService');
const { subscriptionPeriod } = require('../utils/stripePayload');
const { envFlagEnabled } = require('../middleware/featureFlags');

// Phase 5 — Credit Everywhere: subscription Credit payments stay behind this
// flag (locked decision #10: wire behind flags before un-hide). Fail-closed.
function subscriptionsCreditEnabled() {
  return envFlagEnabled('SUBSCRIPTIONS_CREDIT_ENABLED', false);
}

let plansActiveColumn = null;

async function getPlansActiveColumn() {
  // Cache schema detection to avoid repeated catalog queries (~5-10ms each)
  if (plansActiveColumn !== null) {
    return plansActiveColumn;
  }

  const { rows } = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'plans'
       AND column_name IN ('active', 'is_active')`
  );
  const names = rows.map((r) => r.column_name);
  plansActiveColumn = names.includes('active') ? 'active' : names.includes('is_active') ? 'is_active' : null;
  return plansActiveColumn;
}

// Get available plans
exports.getPlans = async (req, res, next) => {
  try {
    const activeCol = await getPlansActiveColumn();
    const whereClause = activeCol ? `WHERE ${activeCol} = TRUE` : '';
    const { rows } = await db.query(`
      SELECT
        id, name, slug, amount_cents, currency, interval, features,
        stripe_price_id,
        slug AS tier
      FROM plans
      ${whereClause}
      ORDER BY amount_cents ASC
    `);

    // If user is authenticated, include location-based pricing
    let locationData = null;
    if (req.user) {
      try {
        const { rows: userRows } = await db.query(
          'SELECT country FROM users WHERE id = $1',
          [req.user.id]
        );
        if (userRows[0]?.country) {
          locationData = await pricingService.getPremiumPrice(userRows[0].country);
        }
      } catch (err) {
        logger.warn('Failed to get location-based pricing for user', {
          userId: req.user?.id,
          error: err.message
        });
      }
    }

    res.json({
      plans: rows.map((p) => ({
        ...p,
        // Backward compatible field expected by some frontend consumers.
        price: p.amount_cents,
        // Include location-based pricing override if available
        locationPrice: locationData && p.slug === 'premium' ? {
          price_cents: locationData.price_cents,
          currency_code: locationData.currency_code,
          country: locationData.country_code,
          stripe_price_id: locationData.stripe_price_id
        } : null
      })),
      userLocation: req.user ? (locationData?.country_code || null) : null
    });
  } catch (err) {
    next(err);
  }
};

// Create checkout session for subscription
exports.createCheckout = async (req, res, next) => {
  try {
    const { planSlug, priceId } = req.body;
    const userId = req.user.id;
    const effectivePlanSlug = planSlug || priceId;
    if (!effectivePlanSlug) {
      throw new AppError('planSlug is required', 400, 'validation_failed', { planSlug: 'planSlug is required' });
    }

    const activeCol = await getPlansActiveColumn();
    const whereClause = activeCol ? `AND ${activeCol} = TRUE` : '';
    // Get plan
    const { rows: plans } = await db.query(
      `SELECT * FROM plans WHERE slug = $1 ${whereClause}`,
      [effectivePlanSlug]
    );
    if (!plans.length) throw new AppError('Plan not found', 404, 'not_found');
    const plan = plans[0];

    // Atomic check for existing subscription (prevents race conditions)
    try {
      await withTransaction(db, async (client) => {
        const { rows: existing } = await client.query(
          'SELECT id FROM subscriptions WHERE user_id = $1 AND status IN ($2, $3) FOR UPDATE',
          [userId, 'active', 'trialing']
        );
        if (existing.length) {
          throw new AppError('You already have an active subscription', 400, 'already_exists');
        }
      }, 'check_subscription');
    } catch (checkErr) {
      if (checkErr instanceof AppError) throw checkErr;
      throw checkErr;
    }

    // Phase 5 — Credit Everywhere: pay for the subscription with OxSteed
    // Credit instead of Stripe. Recurring debit in v1 (locked decision #9).
    if (String(req.body?.paymentMethod || '').toLowerCase() === 'credit') {
      if (!subscriptionsCreditEnabled()) {
        throw new AppError(
          'Paying subscriptions with OxSteed Credit is not available yet.',
          503,
          'feature_disabled'
        );
      }
      return createCreditSubscription(req, res, next, plan, userId);
    }

    // Get or create Stripe customer
    let stripeCustomerId;
    const { rows: users } = await db.query(
      'SELECT email, first_name, last_name, country FROM users WHERE id = $1',
      [userId]
    );
    const user = users[0];

    // Get location-based pricing if available
    let locationPricing = null;
    // Regional premium pricing is a separate product contract, as getPlans
    // already exposes. Never substitute its monthly price for Pro yearly/broker.
    if (user.country && plan.slug === 'premium') {
      try {
        locationPricing = await pricingService.getPremiumPrice(user.country);
        logger.info('Using location-based pricing', {
          userId,
          country: user.country,
          price_cents: locationPricing.price_cents,
          currency: locationPricing.currency_code
        });
      } catch (err) {
        logger.warn('Failed to get location-based pricing, using plan default', {
          userId,
          country: user.country,
          error: err.message
        });
      }
    }

    const { rows: existingSubs } = await db.query(
      `SELECT stripe_customer_id
       FROM subscriptions
       WHERE user_id = $1
         AND stripe_customer_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (existingSubs[0]?.stripe_customer_id) {
      stripeCustomerId = existingSubs[0].stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.first_name} ${user.last_name}`,
        metadata: { userId: userId.toString() },
      });
      stripeCustomerId = customer.id;
    }

    // Use location-based Stripe price if available, otherwise use plan's default price
    const stripePrice = locationPricing?.stripe_price_id || plan.stripe_price_id;

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: stripePrice, quantity: 1 }],
      success_url: `${process.env.APP_URL}/helper-dashboard?subscribed=true`,
      cancel_url: `${process.env.APP_URL}/upgrade?cancelled=true`,
      metadata: {
        userId: userId.toString(),
        planId: plan.id.toString(),
        country: user.country || 'US',
        locationPriced: locationPricing ? 'true' : 'false'
      },
      subscription_data: {
        metadata: {
          userId: userId.toString(),
          planId: plan.id.toString(),
          country: user.country || 'US',
          locationPriced: locationPricing ? 'true' : 'false'
        },
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    next(err);
  }
};

// Get current subscription status
exports.getSubscription = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT s.*, p.name as plan_name, p.slug as plan_slug, p.amount_cents, p.features
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1 AND s.status IN ('active', 'trialing', 'past_due')
       ORDER BY s.created_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({ subscription: rows[0] || null });
  } catch (err) {
    next(err);
  }
};

// Cancel subscription
exports.cancelSubscription = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Check subscription and escrow atomically with locking
    const subscription = await withTransaction(db, async (client) => {
      // Lock user's subscription row to prevent concurrent cancellations
      const { rows: subRows } = await client.query(
        `SELECT stripe_subscription_id, id FROM subscriptions
         WHERE user_id = $1 AND status IN ('active', 'trialing')
         FOR UPDATE`,
        [userId]
      );

      if (!subRows.length) {
        throw new AppError('No active subscription found', 404, 'not_found');
      }

      const subscription = subRows[0];

      // Verify still not being cancelled (atomic check after lock)
      if (subscription.cancel_at_period_end === true) {
        throw new AppError('Subscription cancellation already in progress', 409, 'conflict');
      }

      // ── CHECK FOR OPEN ESCROW FUNDS (atomic within transaction)
      // Helpers cannot cancel Tier 3 subscription while they have escrow funds held
      const { rows: escrowRows } = await client.query(`
        SELECT COUNT(*) as count FROM payments
        WHERE payee_id = $1
          AND escrow_status IN ('authorized', 'disputed', 'held')
          AND status IN ('authorized', 'captured')
      `, [userId]);

      if (escrowRows[0] && parseInt(escrowRows[0].count) > 0) {
        const err = new AppError(
          `Cannot cancel subscription while ${escrowRows[0].count} job(s) have pending escrow`,
          409,
          'conflict'
        );
        err.escrow_count = parseInt(escrowRows[0].count);
        throw err;
      }

      // Return subscription for Stripe call (outside transaction)
      return subscription;
    }, 'cancel_subscription');

    // Call Stripe API OUTSIDE transaction (don't hold DB lock during external API call)
    let stripeSub;
    try {
      stripeSub = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
    } catch (stripeErr) {
      throw new AppError('Failed to cancel subscription with payment processor', 402, 'external_service_error');
    }

    // Update DB with Stripe response (transaction ensures atomicity)
    const updateResult = await withTransaction(db, async (client) => {
      const { rows: updateRows } = await client.query(
        `UPDATE subscriptions
         SET cancel_at_period_end = TRUE,
             current_period_end   = TO_TIMESTAMP($1),
             updated_at           = NOW()
         WHERE id = $2 AND cancel_at_period_end = FALSE
         RETURNING id`,
        [subscriptionPeriod(stripeSub).end, subscription.id]
      );

      if (!updateRows.length) {
        throw new AppError('Subscription state changed during update', 409, 'status_mismatch');
      }

      return updateRows[0];
    }, 'update_subscription_cancellation');

    res.json({
      message: 'Subscription cancellation scheduled successfully.',
      cancel_at: subscriptionPeriod(stripeSub).end == null ? null
        : new Date(subscriptionPeriod(stripeSub).end * 1000).toISOString()
    });
  } catch (err) {
    next(err);
  }
};

// Create portal session (manage billing)
exports.createPortalSession = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT stripe_customer_id
       FROM subscriptions
       WHERE user_id = $1
         AND stripe_customer_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.user.id]
    );
    const stripeCustomerId = rows[0]?.stripe_customer_id || null;
    if (!stripeCustomerId) {
      throw new AppError('No billing account found', 400, 'not_found');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${process.env.APP_URL}/settings`,
    });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
};

/**
 * Phase 5 — Credit Everywhere: create a subscription paid with OxSteed Credit.
 *
 * Locked decision #9: recurring Credit debit in v1. The first period is
 * debited immediately via the shared spend adapter (surface=subscriptions);
 * subsequent periods are charged by the subscription Credit worker.
 *
 * The subscription merchant participant must be enrolled by an admin
 * (type=subscription_merchant). Fail closed when none exists.
 */
async function createCreditSubscription(req, res, next, plan, userId) {
  try {
    const { spendWithCredit } = require('../services/creditSpendAdapter');
    const { withTransaction } = require('../utils/transaction');
    const db = require('../db');

    const amountCents = Number(plan.amount_cents);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new AppError('This plan cannot be paid with Credit', 400, 'credit_amount_invalid');
    }
    const currency = String(plan.currency || 'USD').toUpperCase();
    const interval = String(plan.interval || 'month').toLowerCase();

    // Resolve the platform subscription merchant participant (admin-enrolled).
    const { rows: participantRows } = await db.query(
      `SELECT p.id AS participant_id
         FROM credit_participants p
         JOIN oxsteed_credit_partners pa ON pa.id = p.partner_id
        WHERE p.participant_type = 'subscription_merchant'
          AND p.status = 'active'
          AND p.didit_verified = TRUE
          AND pa.status = 'active'
          AND 'subscriptions' = ANY(p.allowed_surfaces)
        LIMIT 1`
    );
    // Resolve via adapter using the participant's subject. We fetch the
    // subject columns to build the participantRef the adapter expects.
    let participantRef = null;
    if (participantRows[0]) {
      const { rows: subj } = await db.query(
        `SELECT participant_type, business_id, user_id FROM credit_participants WHERE id = $1`,
        [participantRows[0].participant_id]
      );
      const s = subj[0] || {};
      const subjectId = s.business_id || s.user_id;
      if (subjectId) participantRef = { type: s.participant_type, subjectId: String(subjectId) };
    }
    if (!participantRef) {
      throw new AppError(
        'Subscriptions cannot be paid with OxSteed Credit yet',
        409,
        'credit_participant_not_found'
      );
    }

    const now = new Date();
    const periodEnd = new Date(now);
    if (interval === 'year') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    else periodEnd.setMonth(periodEnd.getMonth() + 1);

    const result = await withTransaction(db, async (client) => {
      // Double-check no active subscription (race-safe, mirrors Stripe path).
      const { rows: existing } = await client.query(
        `SELECT id FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'trialing') FOR UPDATE`,
        [userId]
      );
      if (existing.length) {
        throw new AppError('You already have an active subscription', 400, 'already_exists');
      }

      // First period debit via the shared adapter (fail-closed on rail/freeze).
      const spend = await spendWithCredit({
        client,
        participantRef,
        customerId: userId,
        amountCents,
        currency,
        surface: 'subscriptions',
        mode: 'debit',
        referenceType: 'subscription',
        referenceId: `plan:${plan.id}:user:${userId}:${now.toISOString().slice(0, 10)}`,
        isImpersonated: Boolean(req.impersonated),
        metadata: { planSlug: plan.slug, interval },
      });

      const { rows: inserted } = await client.query(
        `INSERT INTO subscriptions
           (user_id, plan_id, status, payment_method,
            current_period_start, current_period_end)
         VALUES ($1, $2, 'active', 'oxsteed_credit', $3, $4)
         RETURNING *`,
        [userId, plan.id, now.toISOString(), periodEnd.toISOString()]
      );
      return { subscription: inserted[0], spend };
    }, 'subscription_credit_checkout');

    return res.json({
      ok: true,
      paymentMethod: 'oxsteed_credit',
      subscription: result.subscription,
      idempotencyKey: result.spend.idempotencyKey,
    });
  } catch (err) {
    return next(err);
  }
}
