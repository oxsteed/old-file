const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const { recalculateBadges } = require('./verificationController');

// Stripe webhook handler for subscription events
exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription') {
          const subscriptionId = session.subscription;
          const userId = parseInt(session.metadata.userId);
          const planId = parseInt(session.metadata.planId);

          const sub = await stripe.subscriptions.retrieve(subscriptionId);

          await db.query(
            `INSERT INTO subscriptions (user_id, plan_id, stripe_subscription_id, stripe_customer_id, status, current_period_start, current_period_end)
             VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7))
             ON CONFLICT (stripe_subscription_id) DO UPDATE SET status = $5`,
            [userId, planId, subscriptionId, session.customer, sub.status,
             sub.current_period_start, sub.current_period_end]
          );

          // Get plan tier
          const { rows: plans } = await db.query(
            'SELECT tier FROM plans WHERE id = $1', [planId]
          );

          await db.query(
            `UPDATE users SET tier = $1, subscription_status = 'active', subscription_id = $2 WHERE id = $3`,
            [plans[0]?.tier || 'tier2_basic', subscriptionId, userId]
          );

          await recalculateBadges(userId);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await db.query(
          `UPDATE subscriptions SET status = $1, current_period_start = to_timestamp($2),
           current_period_end = to_timestamp($3), cancel_at_period_end = $4, updated_at = NOW()
           WHERE stripe_subscription_id = $5`,
          [sub.status, sub.current_period_start, sub.current_period_end,
           sub.cancel_at_period_end, sub.id]
        );

        const { rows } = await db.query(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1', [sub.id]
        );
        if (rows.length) {
          await db.query(
            'UPDATE users SET subscription_status = $1 WHERE id = $2',
            [sub.status, rows[0].user_id]
          );
          await recalculateBadges(rows[0].user_id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await db.query(
          `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [sub.id]
        );

        const { rows } = await db.query(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1', [sub.id]
        );
        if (rows.length) {
          await db.query(
            `UPDATE users SET tier = 'tier1', subscription_status = 'cancelled', subscription_id = NULL WHERE id = $1`,
            [rows[0].user_id]
          );
          // Deactivate subscription-dependent badges
          await db.query(
            `UPDATE badges SET active = FALSE WHERE user_id = $1 AND type IN ('verified', 'pro')`,
            [rows[0].user_id]
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        await db.query(
          `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subId]
        );

        const { rows } = await db.query(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1', [subId]
        );
        if (rows.length) {
          await db.query(
            `UPDATE users SET subscription_status = 'past_due' WHERE id = $1`,
            [rows[0].user_id]
          );
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};
