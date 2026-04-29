const logger = require('../utils/logger');
if (!process.env.STRIPE_SECRET_KEY) {
  logger.error('[FATAL] STRIPE_SECRET_KEY is not set — subscription features will fail.');
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const { withTransaction } = require('../utils/transaction');

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

    // Atomic check for existing subscription (prevents race conditions)
    try {
      await withTransaction(db, async (client) => {
        const { rows: existing } = await client.query(
          'SELECT id FROM subscriptions WHERE user_id = $1 AND status IN ($2, $3) FOR UPDATE',
          [userId, 'active', 'trialing']
        );
        if (existing.length) {
          const err = new Error('You already have an active subscription.');
          err.status = 400;
          throw err;
        }
      }, 'check_subscription');
    } catch (checkErr) {
      if (checkErr.status === 400) {
        return res.status(400).json({ error: checkErr.message });
      }
      throw checkErr;
    }

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
        const err = new Error('No active subscription found');
        err.status = 404;
        throw err;
      }

      const subscription = subRows[0];

      // Verify still not being cancelled (atomic check after lock)
      if (subscription.cancel_at_period_end === true) {
        const err = new Error('Subscription cancellation already in progress');
        err.status = 409;
        throw err;
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
        const err = new Error(`Cannot cancel subscription while ${escrowRows[0].count} job(s) have pending escrow`);
        err.status = 409;
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
      logger.error('Stripe subscription cancellation failed', { userId, subscriptionId: subscription.id, error: stripeErr.message });
      return res.status(402).json({ error: 'Failed to cancel subscription with payment processor' });
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
        [stripeSub.current_period_end, subscription.id]
      );

      if (!updateRows.length) {
        throw new Error('Subscription state changed during update');
      }

      return updateRows[0];
    }, 'update_subscription_cancellation');

    res.json({
      message: 'Subscription cancellation scheduled successfully.',
      cancel_at: new Date(stripeSub.current_period_end * 1000).toISOString()
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.message });
    }
    if (err.status === 409) {
      const resp = { error: err.message };
      if (err.escrow_count !== undefined) {
        resp.escrow_count = err.escrow_count;
      }
      return res.status(409).json(resp);
    }
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
