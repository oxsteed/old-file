const crypto = require('crypto');

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('[FATAL] STRIPE_SECRET_KEY is not set — Stripe webhooks will fail.');
}
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
            'SELECT COALESCE(tier, slug) AS tier_slug, slug FROM plans WHERE id = $1', [planId]
          );
          const planSlug = plans[0]?.slug || plans[0]?.tier_slug || 'pro';
          const userTier = planSlug === 'basic' ? 'basic' : planSlug === 'broker' ? 'broker' : 'pro';

          await db.query(
            `UPDATE users SET tier = $1, subscription_status = 'active' WHERE id = $2`,
            [userTier, userId]
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
            `UPDATE users SET tier = 'free', subscription_status = 'cancelled' WHERE id = $1`,
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

// Didit identity webhook handler
exports.diditWebhook = async (req, res) => {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Didit] DIDIT_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook not configured.' });
  }

  // ── Verify signature ─────────────────────────────────────
  // Didit sends X-Signature-V2 and X-Signature-Simple.
  // Express lowercases all header names.
  const signatureV2     = req.headers['x-signature-v2'];
  const signatureSimple = req.headers['x-signature-simple'];
  const timestamp       = req.headers['x-timestamp'];
  const isTestWebhook   = req.headers['x-didit-test-webhook'] === 'true';

  if (!timestamp) {
    return res.status(400).json({ error: 'Missing timestamp header.' });
  }

  if (!signatureV2 && !signatureSimple) {
    return res.status(400).json({ error: 'Missing signature headers.' });
  }

  const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));

  // Try V2 first (HMAC of "timestamp.body"), fall back to Simple (HMAC of body)
  let signatureValid = false;

  if (signatureV2) {
    const expectedV2 = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    try {
      const sigBuf = Buffer.from(signatureV2);
      const expectedBuf = Buffer.from(expectedV2);
      signatureValid = sigBuf.length === expectedBuf.length &&
                       crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      signatureValid = false;
    }
  }

  if (!signatureValid && signatureSimple) {
    const expectedSimple = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    try {
      const sigBuf = Buffer.from(signatureSimple);
      const expectedBuf = Buffer.from(expectedSimple);
      signatureValid = sigBuf.length === expectedBuf.length &&
                       crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      signatureValid = false;
    }
  }

  if (!signatureValid) {
    console.warn('[Didit] Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  // ── Parse body ──────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON.' });
  }

  // ── Handle test webhooks from Didit console ─────────────
  if (isTestWebhook || payload.metadata?.test_webhook) {
    console.log('[Didit] Test webhook received — signature valid ✓');
    return res.json({ received: true, test: true });
  }

  // ── Process verification result ─────────────────────────
  try {
    const { session_id, status, decision } = payload;

    if (!session_id) {
      return res.status(400).json({ error: 'Missing session_id.' });
    }

    // Didit sends capitalized status: "Approved", "Declined"
    const normalizedStatus = (decision?.status || status || '').toLowerCase();

    if (normalizedStatus === 'approved') {
      // Update identity_verifications record
      const { rows } = await db.query(
        `UPDATE identity_verifications
         SET status = 'approved', updated_at = NOW()
         WHERE didit_session_id = $1
         RETURNING user_id`,
        [session_id]
      );

      if (rows.length) {
        const userId = rows[0].user_id;

        // ── ONE-PERSON-ONE-ACCOUNT CHECK ────────────────
        // Use workflow_id as the identity fingerprint.
        // Replace with Didit's actual biometric hash from
        // their session details API when available.
        const identityHash = decision?.workflow_id || session_id;

        // Check if this identity already exists on another user
        const { rows: existing } = await db.query(
          `SELECT id, email FROM users
           WHERE didit_identity_hash = $1 AND id != $2`,
          [identityHash, userId]
        );

        if (existing.length > 0) {
          // Duplicate — this person already has an account
          await db.query(
            `UPDATE users SET didit_status = 'duplicate' WHERE id = $1`,
            [userId]
          );
          console.warn(`[Didit] Duplicate identity for user ${userId} — matches user ${existing[0].id}`);
        } else {
          // Unique identity — mark verified
          await db.query(
            `UPDATE users
             SET identity_verified = TRUE,
                 didit_identity_hash = $1,
                 didit_verified_at = NOW(),
                 didit_status = 'verified'
             WHERE id = $2`,
            [identityHash, userId]
          );

          // Award identity badge
          await db.query(
            `INSERT INTO badges (user_id, type, label)
             VALUES ($1, 'identity_verified', 'ID Verified')
             ON CONFLICT DO NOTHING`,
            [userId]
          );

          console.log(`[Didit] Identity approved for user ${userId}`);
        }
      }
    } else if (normalizedStatus === 'declined') {
      await db.query(
        `UPDATE identity_verifications
         SET status = 'declined', last_error = $1, updated_at = NOW()
         WHERE didit_session_id = $2`,
        [payload.reason || 'Verification declined', session_id]
      );

      // Find user and mark failed
      const { rows } = await db.query(
        `SELECT user_id FROM identity_verifications WHERE didit_session_id = $1`,
        [session_id]
      );
      if (rows.length) {
        await db.query(
          `UPDATE users SET didit_status = 'failed' WHERE id = $1`,
          [rows[0].user_id]
        );
      }
    } else {
      console.log(`[Didit] Unhandled status: ${status}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Didit] Webhook handler error:', err);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};
