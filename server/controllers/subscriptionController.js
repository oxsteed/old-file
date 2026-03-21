const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');

// Get available plans
exports.getPlans = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, slug, amount_cents, currency, interval, tier, features FROM plans WHERE active = TRUE ORDER BY amount_cents ASC'
    );
    res.json({ plans: rows });
  } catch (err) {
    console.error('Get plans error:', err);
    res.status(500).json({ error: 'Failed to fetch plans.' });
  }
};

// Create checkout session for subscription
exports.createCheckout = async (req, res) => {
  try {
    const { planSlug } = req.body;
    const userId = req.user.id;

    // Get plan
    const { rows: plans } = await db.query(
      'SELECT * FROM plans WHERE slug = $1 AND active = TRUE', [planSlug]
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
      'SELECT stripe_customer_id, email, first_name, last_name FROM users WHERE id = $1', [userId]
    );
    const user = users[0];

    if (user.stripe_customer_id) {
      stripeCustomerId = user.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.first_name} ${user.last_name}`,
        metadata: { userId: userId.toString() },
      });
      stripeCustomerId = customer.id;
      await db.query(
        'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
        [stripeCustomerId, userId]
      );
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${process.env.APP_URL}/dashboard/helper?subscribed=true`,
      cancel_url: `${process.env.APP_URL}/upgrade?cancelled=true`,
      metadata: { userId: userId.toString(), planId: plan.id.toString() },
      subscription_data: {
        metadata: { userId: userId.toString(), planId: plan.id.toString() },
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Create checkout error:', err);
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
    console.error('Get subscription error:', err);
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

    await stripe.subscriptions.update(rows[0].stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    await db.query(
      'UPDATE subscriptions SET cancel_at_period_end = TRUE WHERE stripe_subscription_id = $1',
      [rows[0].stripe_subscription_id]
    );

    res.json({ message: 'Subscription will cancel at end of billing period.' });
  } catch (err) {
    console.error('Cancel subscription error:', err);
    res.status(500).json({ error: 'Failed to cancel subscription.' });
  }
};

// Create portal session (manage billing)
exports.createPortalSession = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT stripe_customer_id FROM users WHERE id = $1', [req.user.id]
    );
    if (!rows[0]?.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account found.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: rows[0].stripe_customer_id,
      return_url: `${process.env.APP_URL}/settings`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal session error:', err);
    res.status(500).json({ error: 'Failed to create portal session.' });
  }
};
