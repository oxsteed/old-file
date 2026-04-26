const logger = require('../utils/logger');
if (!process.env.STRIPE_SECRET_KEY) {
  logger.error('[FATAL] STRIPE_SECRET_KEY is not set — subscription features will fail.');
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');

async function getPlansActiveColumn() {
  const { rows } = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'plans'
       AND column_name IN ('active', 'is_active')`
  );
  const names = rows.map((r) => r.column_name);
  if (names.includes('active')) return 'active';
  if (names.includes('is_active')) return 'is_active';
  return null;
}

// Get available plans
exports.getPlans = async (req, res) => {
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
    res.json({
      plans: rows.map((p) => ({
        ...p,
        // Backward compatible field expected by some frontend consumers.
        price: p.amount_cents,
      }))
    });
  } catch (err) {
    logger.error('Get plans error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch plans.' });
  }
};

// Create checkout session for subscription
exports.createCheckout = async (req, res) => {
  try {
    const { planSlug, priceId } = req.body;
    const userId = req.user.id;
    const effectivePlanSlug = planSlug || priceId;
    if (!effectivePlanSlug) {
      return res.status(400).json({ error: 'planSlug is required.' });
    }

    const activeCol = await getPlansActiveColumn();
    const whereClause = activeCol ? `AND ${activeCol} = TRUE` : '';
    // Get plan
    const { rows: plans } = await db.query(
      `SELECT * FROM plans WHERE slug = $1 ${whereClause}`,
      [effectivePlanSlug]
    );
    if (!plans.length) return res.status(404).json({ error: 'Plan not found.' });
    const plan = plans[0];

    // Check if user already has active subscription
    const { rows: existing } = await db.query(
      'SELECT id FROM subscriptions WHERE user_id = $1 AND status IN ($2, $3)',
      [userId, 'active', 'trialing']
    );
    if (existing.length) return res.status(400).json({ error: 'You already have an active subscription.' });

    // Get or create Stripe customer
    let stripeCustomerId;
    const { rows: users } = await db.query(
      'SELECT email, first_name, last_name FROM users WHERE id = $1',
      [userId]
    );
    const user = users[0];

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

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${process.env.APP_URL}/helper-dashboard?subscribed=true`,
      cancel_url: `${process.env.APP_URL}/upgrade?cancelled=true`,
      metadata: { userId: userId.toString(), planId: plan.id.toString() },
      subscription_data: {
        metadata: { userId: userId.toString(), planId: plan.id.toString() },
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    logger.error('Create checkout error', { userId: req.user?.id, planSlug: req.body?.planSlug, error: err.message });
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
};

// Get current subscription status
exports.getSubscription = async (req, res) => {
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
    logger.error('Get subscription error', { userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to fetch subscription.' });
  }
};

// Cancel subscription
exports.cancelSubscription = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT stripe_subscription_id FROM subscriptions
       WHERE user_id = $1 AND status IN ('active', 'trialing')`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No active subscription found.' });

    // ── CHECK FOR OPEN ESCROW FUNDS ──────────────────────────────────────
    // Helpers cannot cancel Tier 3 subscription while they have escrow funds held
    const { rows: escrowRows } = await db.query(`
      SELECT COUNT(*) as count FROM payments
      WHERE payee_id = $1
        AND escrow_status IN ('authorized', 'disputed', 'held')
        AND status IN ('authorized', 'captured')
    `, [req.user.id]);

    if (escrowRows[0] && parseInt(escrowRows[0].count) > 0) {
      return res.status(409).json({
        error: 'Cannot cancel subscription while escrow funds are held',
        message: 'You have ' + escrowRows[0].count + ' job(s) with pending escrow. Complete or cancel these jobs before downgrading your subscription.',
        escrow_count: parseInt(escrowRows[0].count)
      });
    }

    const stripeSub = await stripe.subscriptions.update(rows[0].stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    // Status stays 'active' — access continues until period_end.
    // The webhook customer.subscription.deleted will flip it to 'cancelled' when Stripe actually ends it.
    // Safeguard: ensure subscription is still active and not already being cancelled
    const updateResult = await db.query(
      `UPDATE subscriptions
       SET cancel_at_period_end = TRUE,
           current_period_end   = TO_TIMESTAMP($2),
           updated_at           = NOW()
       WHERE stripe_subscription_id = $1 AND cancel_at_period_end = FALSE RETURNING id`,
      [rows[0].stripe_subscription_id, stripeSub.current_period_end]
    );

    if (!updateResult.rows.length) {
      return res.status(409).json({ error: 'Subscription cancellation already in progress. Please try again.' });
    }

    res.json({ message: 'Subscription cancellation scheduled successfully.', cancel_at: new Date(stripeSub.current_period_end * 1000).toISOString() });
  } catch (err) {
    logger.error('Cancel subscription error', { userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to cancel subscription.' });
  }
};

// Create portal session (manage billing)
exports.createPortalSession = async (req, res) => {
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
      return res.status(400).json({ error: 'No billing account found.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${process.env.APP_URL}/settings`,
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error('Portal session error', { userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to create portal session.' });
  }
};
