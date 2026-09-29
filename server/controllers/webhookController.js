const crypto = require('crypto');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { sendNotification } = require('../services/notificationService');

if (!process.env.STRIPE_SECRET_KEY) {
  logger.error('[FATAL] STRIPE_SECRET_KEY is not set - Stripe webhooks will fail.');
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const { recalculateBadges } = require('./verificationController');
const { withTransaction } = require('../utils/transaction');
const {
  applyStripePaymentIntent,
  applyStripeRefund,
  applyStripeChargeRefund,
} = require('../services/restaurantPosPaymentLedgerService');
const socketService = require('../services/socketService');
const localDeliveryPayments = require('../services/localDeliveryPaymentService');

function extractFoodOrderId(metadata) {
  const raw = metadata?.food_order_id
    || metadata?.foodOrderId
    || metadata?.foodOrderID
    || metadata?.restaurant_order_id
    || metadata?.restaurantOrderId;
  const parsed = Number.parseInt(String(raw || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function emitFoodOrderUpdate(order) {
  if (!order) return;
  try {
    socketService.broadcastToBusinessInbox(order.business_id, 'food:order:updated', { order });
    socketService.broadcastToRestaurantDisplay(order.restaurant_id, 'food:display:changed', {
      restaurantId: String(order.restaurant_id),
      queueNumber: order.queue_number != null ? order.queue_number : null,
      status: order.status || null,
    });
  } catch (err) {
    logger.warn('emitFoodOrderUpdate failed', { orderId: order.id, error: err.message });
  }
}

async function applyFoodOrderPaymentState(client, {
  orderId,
  paymentStatus,
  stripePaymentIntentId = null,
}) {
  if (!orderId) return null;
  const { rows } = await client.query(
    `UPDATE food_orders
        SET payment_status = $1,
            stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
            updated_at = NOW()
      WHERE id = $3::bigint
      RETURNING *`,
    [paymentStatus, stripePaymentIntentId, orderId]
  );
  const order = rows[0] || null;
  if (order) emitFoodOrderUpdate(order);
  return order;
}

async function syncBusinessStripeAccountState(account) {
  const accountId = account?.id;
  if (!accountId) return;
  const accountStatus = account.charges_enabled
    ? 'active'
    : (Array.isArray(account.requirements?.currently_due) && account.requirements.currently_due.length
      ? 'restricted'
      : 'pending');

  const { rows: businesses } = await db.query(
    `SELECT id
       FROM businesses
      WHERE stripe_account_id = $1
      UNION
      SELECT business_id AS id
        FROM business_integrations
       WHERE integration_type = 'stripe'
         AND config_json->>'account_id' = $1::text
      LIMIT 1`,
    [accountId]
  );
  const businessId = businesses[0]?.id || null;
  if (!businessId) return;

  await db.query(
    `UPDATE businesses
        SET stripe_account_id = COALESCE(stripe_account_id, $1),
            stripe_charges_enabled = $2,
            stripe_payouts_enabled = $3,
            stripe_account_status = $4,
            updated_at = NOW()
      WHERE id = $5`,
    [accountId, !!account.charges_enabled, !!account.payouts_enabled, accountStatus, businessId]
  );

  await db.query(
    `UPDATE business_integrations
        SET is_connected = TRUE,
            is_enabled = TRUE,
            config_json = COALESCE(config_json, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
      WHERE business_id = $3
        AND integration_type = 'stripe'`,
    [accountId, JSON.stringify({
      account_id: accountId,
      charges_enabled: !!account.charges_enabled,
      payouts_enabled: !!account.payouts_enabled,
      details_submitted: !!account.details_submitted,
      country: account.country || null,
      default_currency: account.default_currency || null,
      account_status: accountStatus,
      requirements: account.requirements || null,
      last_synced_at: new Date().toISOString(),
    }), businessId]
  ).catch(() => {});
}

async function syncConnectAccountState(account) {
  const accountId = account?.id;
  if (!accountId) return;

  const accountStatus = account.charges_enabled
    ? 'active'
    : (Array.isArray(account.requirements?.currently_due) && account.requirements.currently_due.length
      ? 'restricted'
      : 'pending');
  const onboardingComplete = !!account.details_submitted || !!account.charges_enabled || !!account.payouts_enabled;

  const { rows: connectAccounts } = await db.query(
    `SELECT user_id
       FROM connect_accounts
      WHERE stripe_account_id = $1
      LIMIT 1`,
    [accountId]
  );
  const userId = connectAccounts[0]?.user_id || null;
  if (!userId) return;

  await db.query(
    `UPDATE connect_accounts
        SET charges_enabled = $2,
            payouts_enabled = $3,
            onboarding_complete = $4,
            updated_at = NOW()
      WHERE user_id = $5`,
    [!!account.charges_enabled, !!account.payouts_enabled, onboardingComplete, userId]
  );

  logger.info('[Stripe] Connect account synced', {
    userId,
    accountId,
    charges_enabled: !!account.charges_enabled,
    payouts_enabled: !!account.payouts_enabled,
    onboarding_complete: onboardingComplete,
    accountStatus,
  });
}

async function beginWebhookEvent(provider, event) {
  if (!event?.id) return { shouldProcess: true };

  const object = event.data?.object || {};
  const eventType = String(event.type || 'unknown');
  const objectType = eventType.split('.', 1)[0] || 'unknown';
  const objectId = (() => {
    if (['charge', 'refund'].includes(objectType) && typeof object.payment_intent === 'string') {
      return object.payment_intent;
    }
    if (objectType === 'checkout' && typeof object.payment_intent === 'string') {
      return object.payment_intent;
    }
    return object.id ? String(object.id) : null;
  })();
  const eventCreated = Number.isSafeInteger(Number(event.created)) ? Number(event.created) : null;

  const { rows } = await db.query(
    `INSERT INTO webhook_event_receipts
       (provider, event_id, event_type, object_type, object_id, event_created, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'processing')
     ON CONFLICT (provider, event_id) DO UPDATE SET
       attempts = webhook_event_receipts.attempts + 1,
       event_type = EXCLUDED.event_type,
       object_type = EXCLUDED.object_type,
       object_id = EXCLUDED.object_id,
       event_created = EXCLUDED.event_created,
       status = 'processing',
       last_seen_at = NOW(),
       last_error = NULL
     WHERE webhook_event_receipts.status = 'failed'
        OR (
          webhook_event_receipts.status = 'processing'
          AND webhook_event_receipts.last_seen_at < NOW() - INTERVAL '15 minutes'
        )
     RETURNING id`,
    [provider, event.id, eventType, objectType, objectId, eventCreated]
  );

  const receiptId = rows[0]?.id;
  if (!receiptId || !objectId || eventCreated === null) {
    return { shouldProcess: rows.length > 0, receiptId };
  }

  const { rows: watermarkRows } = await db.query(
    `INSERT INTO webhook_event_watermarks
       (provider, object_type, object_id, event_created, event_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider, object_type, object_id) DO UPDATE
       SET event_created = EXCLUDED.event_created,
           event_id = EXCLUDED.event_id,
           updated_at = NOW()
     WHERE webhook_event_watermarks.event_id = EXCLUDED.event_id
        OR webhook_event_watermarks.event_created < EXCLUDED.event_created
        OR (
          webhook_event_watermarks.event_created = EXCLUDED.event_created
          AND webhook_event_watermarks.event_id < EXCLUDED.event_id
        )
     RETURNING event_id`,
    [provider, objectType, objectId, eventCreated, event.id]
  );
  if (watermarkRows.length > 0) {
    return { shouldProcess: true, receiptId };
  }

  await db.query(
    `UPDATE webhook_event_receipts
        SET status = 'processed', processed_at = NOW(), last_seen_at = NOW(), last_error = NULL
      WHERE id = $1`,
    [receiptId]
  );
  return { shouldProcess: false, stale: true, receiptId };
}

async function markWebhookEventProcessed(receiptId) {
  if (!receiptId) return;
  await db.query(
    `UPDATE webhook_event_receipts
     SET status = 'processed', processed_at = NOW(), last_seen_at = NOW(), last_error = NULL
     WHERE id = $1`,
    [receiptId]
  );
}

async function markWebhookEventFailed(receiptId, err) {
  if (!receiptId) return;
  await db.query(
    `UPDATE webhook_event_receipts
     SET status = 'failed', last_seen_at = NOW(), last_error = LEFT($2, 1000)
     WHERE id = $1`,
    [receiptId, err?.message || 'Webhook processing failed']
  );
}

// Stripe webhook handler for subscription events
exports.stripeWebhook = async (req, res, next) => {
  const sig = req.headers['stripe-signature'];
  let event;
  let receiptId;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error('Webhook signature verification failed', { error: err.message });
    return next(new AppError('Invalid signature', 400, 'invalid_webhook_signature'));
  }

  try {
    const receipt = await beginWebhookEvent('stripe', event);
    receiptId = receipt.receiptId;
    if (!receipt.shouldProcess) {
      logger.info('Duplicate Stripe webhook ignored', { eventId: event.id, eventType: event.type });
      return res.json({ received: true, duplicate: true, stale: receipt.stale === true });
    }

    // Delivery collection uses the same verified webhook/retry envelope, but
    // reconciles provider evidence against its own BIGINT financial obligations.
    const deliveryResult = await localDeliveryPayments.handleStripeEvent(event);
    if (deliveryResult.handled) {
      await markWebhookEventProcessed(receiptId);
      return res.json({ received: true });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.metadata?.qr_payment === 'true') {
          await applyQrPaymentSucceeded(session);
          break;
        }
        const foodOrderId = extractFoodOrderId(session.metadata);
        if (foodOrderId) {
          const paymentStatus = session.payment_status === 'paid'
            ? 'paid'
            : session.payment_status === 'unpaid'
              ? 'requires_payment'
              : 'requires_payment';
          await withTransaction(db, async (client) => {
            await applyFoodOrderPaymentState(client, {
              orderId: foodOrderId,
              paymentStatus,
              stripePaymentIntentId: typeof session.payment_intent === 'string'
                ? session.payment_intent
                : session.payment_intent?.id || null,
            });
          });
          break;
        }
        if (session.mode === 'subscription') {
          const subscriptionId = session.subscription;
          const userId = session.metadata.userId;
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
            `UPDATE users
             SET tier = $1,
                 subscription_status = 'active',
                 tier_selected = TRUE
             WHERE id = $2`,
            [userTier, userId]
          );
          await recalculateBadges(userId);
        }
        break;
      }
      case 'customer.subscription.created': {
        // Subscriptions created through Checkout are already handled by
        // checkout.session.completed (which fires first and creates the row).
        // This case exists for subscriptions created via the Stripe dashboard
        // or API - without it, those subscriptions are invisible to the app.
        const sub = event.data.object;
        const { rows: existing } = await db.query(
          'SELECT id FROM subscriptions WHERE stripe_subscription_id = $1', [sub.id]
        );
        if (existing.length > 0) break; // Already handled by checkout.session.completed

        // Look up the user via their Stripe customer ID
        const { rows: userRows } = await db.query(
          'SELECT id FROM users WHERE stripe_customer_id = $1 LIMIT 1',
          [sub.customer]
        );
        if (!userRows.length) {
          logger.warn('[webhook] customer.subscription.created: no user found for Stripe customer', {
            stripeCustomerId: sub.customer, subscriptionId: sub.id,
          });
          break;
        }

        // Resolve plan by matching the Stripe price ID
        const priceId = sub.items?.data?.[0]?.price?.id;
        let planId = null;
        if (priceId) {
          const { rows: planRows } = await db.query(
            'SELECT id FROM plans WHERE stripe_price_id = $1 LIMIT 1', [priceId]
          );
          planId = planRows[0]?.id ?? null;
        }

        await db.query(
          `INSERT INTO subscriptions
             (user_id, plan_id, stripe_subscription_id, stripe_customer_id,
              status, current_period_start, current_period_end)
           VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7))
           ON CONFLICT (stripe_subscription_id) DO NOTHING`,
          [userRows[0].id, planId, sub.id, sub.customer, sub.status,
           sub.current_period_start, sub.current_period_end]
        );

        if (planId) {
          const { rows: planMeta } = await db.query(
            'SELECT COALESCE(tier, slug) AS tier_slug, slug FROM plans WHERE id = $1', [planId]
          );
          const planSlug = planMeta[0]?.slug || planMeta[0]?.tier_slug || 'pro';
          const userTier = planSlug === 'basic' ? 'basic' : planSlug === 'broker' ? 'broker' : 'pro';
          await db.query(
            `UPDATE users SET tier = $1, subscription_status = 'active', tier_selected = TRUE
             WHERE id = $2`,
            [userTier, userRows[0].id]
          );
          await recalculateBadges(userRows[0].id);
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
      case 'invoice.payment_succeeded': {
        // Fires on every successful charge — initial subscription AND all renewals.
        // `customer.subscription.updated` also fires on renewal, but that event
        // can sometimes precede the actual payment confirmation. This handler
        // ensures the subscription row and user tier are authoritative after each
        // billing cycle regardless of event ordering.
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (!subId) break; // one-off invoice, not a subscription charge

        // Retrieve the live subscription object to get fresh period dates
        const sub = await stripe.subscriptions.retrieve(subId).catch(() => null);
        if (!sub) break;

        await db.query(
          `UPDATE subscriptions
           SET status                = $1,
               current_period_start  = to_timestamp($2),
               current_period_end    = to_timestamp($3),
               cancel_at_period_end  = $4,
               updated_at            = NOW()
           WHERE stripe_subscription_id = $5`,
          [sub.status, sub.current_period_start, sub.current_period_end,
           sub.cancel_at_period_end, subId]
        );

        const { rows: subRows } = await db.query(
          'SELECT user_id, plan_id FROM subscriptions WHERE stripe_subscription_id = $1', [subId]
        );
        if (subRows.length) {
          const { user_id, plan_id } = subRows[0];
          // Refresh user tier in case plan changed during renewal
          if (plan_id) {
            const { rows: planRows } = await db.query(
              'SELECT COALESCE(tier, slug) AS tier_slug, slug FROM plans WHERE id = $1', [plan_id]
            );
            const planSlug = planRows[0]?.slug || planRows[0]?.tier_slug || 'pro';
            const userTier = planSlug === 'basic' ? 'basic' : planSlug === 'broker' ? 'broker' : 'pro';
            await db.query(
              `UPDATE users SET tier = $1, subscription_status = 'active', tier_selected = TRUE WHERE id = $2`,
              [userTier, user_id]
            );
          } else {
            await db.query(
              `UPDATE users SET subscription_status = 'active' WHERE id = $1`,
              [user_id]
            );
          }
          await recalculateBadges(user_id);
          logger.info('[webhook] invoice.payment_succeeded — subscription renewed', {
            subscriptionId: subId, userId: user_id, periodEnd: sub.current_period_end,
          });
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
          const uid = rows[0].user_id;
          await db.query(
            `UPDATE users SET subscription_status = 'past_due' WHERE id = $1`,
            [uid]
          );
          sendNotification({
            userId: uid,
            type: 'payment_failed',
            title: '⚠️ Subscription Payment Failed',
            body: 'We couldn\'t charge your card for your OxSteed subscription. Please update your payment method to keep your account active.',
            data: { subscription_id: subId },
            action_url: '/settings/billing',
          }).catch(e => logger.warn('Failed to send subscription payment failed notification', { error: e.message }));
        }
        break;
      }
      // ── Tier 3 direct-charge payment events ───────────────────────────
      // These fire on connected accounts. Register them via a Connect webhook
      // endpoint in the Stripe dashboard (listen for "Events on connected accounts").

      case 'payment_intent.amount_capturable_updated': {
        // Authorization succeeded - PaymentIntent is ready to capture after job completion.
        const pi = event.data.object;
        const jobId = pi.metadata?.job_id;
        if (jobId) {
          await db.query(
            `UPDATE payments SET status = 'authorized', payment_hold_status = 'held',
             updated_at = NOW() WHERE stripe_payment_intent_id = $1 AND status != 'captured'`,
            [pi.id]
          );
          logger.info(`[Stripe] PaymentIntent ${pi.id} authorized - job ${jobId} funds held`);
        }
        await withTransaction(db, (client) => applyStripePaymentIntent(client, pi));
        break;
      }

      case 'payment_intent.succeeded': {
        // Capture completed - money is on its way to the helper or order is complete.
        const pi = event.data.object;
        const foodOrderId = extractFoodOrderId(pi.metadata);
        const jobId = pi.metadata?.job_id;
        const orderId = pi.metadata?.orderId;

        if (foodOrderId) {
          await withTransaction(db, async (client) => {
            await applyFoodOrderPaymentState(client, {
              orderId: foodOrderId,
              paymentStatus: 'paid',
              stripePaymentIntentId: pi.id,
            });
          });
        } else if (jobId) {
          await db.query(
            `UPDATE payments SET status = 'captured', payment_hold_status = 'released',
             captured_at = NOW(), released_at = NOW(), updated_at = NOW()
             WHERE stripe_payment_intent_id = $1 AND status != 'captured'`,
            [pi.id]
          );
          // Mark job escrow released
          await db.query(
            `UPDATE jobs SET escrow_status = 'released', updated_at = NOW() WHERE id = $1`,
            [jobId]
          );
          logger.info(`[Stripe] PaymentIntent ${pi.id} captured - funds released for job ${jobId}`);
          // Notify helper that payment has been released
          const helperId = pi.metadata?.helper_id;
          if (helperId) {
            const amountDollars = ((pi.amount_received || pi.amount) / 100).toFixed(2);
            sendNotification({
              userId: helperId,
              type: 'payment_released',
              data: { job_id: jobId, amount: amountDollars },
              action_url: `/jobs/${jobId}`,
            }).catch(e => logger.warn('Failed to send payment released notification', { error: e.message }));
          }
        } else if (orderId) {
          // Marketplace order payment succeeded
          await db.query(
            `UPDATE marketplace_orders SET status = $1, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            ['paid', orderId]
          );
          await db.query(
            `UPDATE marketplace_transactions SET status = $1, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
             WHERE payment_intent_id = $2`,
            ['succeeded', pi.id]
          );
          logger.info(`[Stripe] PaymentIntent ${pi.id} succeeded - order ${orderId} marked as paid`);
        }
        await withTransaction(db, (client) => applyStripePaymentIntent(client, pi));
        break;
      }

      case 'payment_intent.payment_failed': {
        // Authorization or capture failed.
        const pi = event.data.object;
        const foodOrderId = extractFoodOrderId(pi.metadata);
        const jobId = pi.metadata?.job_id;
        const failureMsg = pi.last_payment_error?.message || 'Payment failed';
        if (foodOrderId) {
          await withTransaction(db, async (client) => {
            await applyFoodOrderPaymentState(client, {
              orderId: foodOrderId,
              paymentStatus: 'failed',
              stripePaymentIntentId: pi.id,
            });
          });
        } else if (jobId) {
          await db.query(
            `UPDATE payments SET status = 'failed', payment_hold_status = 'none',
             updated_at = NOW() WHERE stripe_payment_intent_id = $1`,
            [pi.id]
          );
          // Re-open escrow on the job so client can retry
          await db.query(
            `UPDATE jobs SET escrow_status = 'none', updated_at = NOW() WHERE id = $1`,
            [jobId]
          );
          logger.warn(`[Stripe] PaymentIntent ${pi.id} failed for job ${jobId}: ${failureMsg}`);
          // Notify customer to retry
          const clientId = pi.metadata?.client_id;
          if (clientId) {
            sendNotification({
              userId: clientId,
              type: 'payment_failed',
              title: '⚠️ Payment Failed',
              body: `Your escrow payment for job #${jobId} failed: ${failureMsg}. Please try again.`,
              data: { job_id: jobId },
              action_url: `/jobs/${jobId}`,
            }).catch(e => logger.warn('Failed to send payment failed notification to customer', { error: e.message }));
          }
        }
        await withTransaction(db, (client) => applyStripePaymentIntent(client, pi));
        break;
      }

      case 'account.updated': {
        const account = event.data.object;
        await syncBusinessStripeAccountState(account);
        await syncConnectAccountState(account);
        break;
      }

      case 'payment_intent.canceled': {
        const pi = event.data.object;
        await withTransaction(db, (client) => applyStripePaymentIntent(client, pi));
        break;
      }

      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed': {
        const refund = event.data.object;
        await withTransaction(db, (client) => applyStripeRefund(client, refund));
        break;
      }

      case 'charge.refunded': {
        // Refund processed (full or partial).
        const charge = event.data.object;
        const piId = charge.payment_intent;
        const foodOrderId = extractFoodOrderId(charge.metadata);
        if (piId) {
          await db.query(
            `UPDATE payments SET status = 'refunded', payment_hold_status = 'refunded',
             updated_at = NOW() WHERE stripe_payment_intent_id = $1`,
            [piId]
          );
          logger.info(`[Stripe] Charge refunded for PaymentIntent ${piId}`);
        }
        if (foodOrderId) {
          await withTransaction(db, async (client) => {
            await applyFoodOrderPaymentState(client, {
              orderId: foodOrderId,
              paymentStatus: 'refunded',
              stripePaymentIntentId: piId || null,
            });
          });
        }
        await withTransaction(db, (client) => applyStripeChargeRefund(client, charge));
        break;
      }

      default:
        logger.info(`Unhandled Stripe event: ${event.type}`);
    }
    await markWebhookEventProcessed(receiptId);
    res.json({ received: true });
  } catch (err) {
    await markWebhookEventFailed(receiptId, err);
    logger.error('Stripe webhook handler error', { error: err.message });
    return next(new AppError('Webhook processing failed', 500, 'webhook_processing_error'));
  }
};

// ── Didit v3 Signature Helpers ──────────────────────────────

// Process floats - convert integer floats to integers (matches Python's shorten_floats)
function shortenFloats(data) {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) return data.map(shortenFloats);
  if (typeof data === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = shortenFloats(value);
    }
    return result;
  }
  if (typeof data === 'number' && !Number.isInteger(data) && data === Math.floor(data)) {
    return Math.floor(data);
  }
  return data;
}

// Stringify JSON with sorted keys (matches Python's json.dumps with sort_keys=True)
function stableStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const parts = keys.map(key => JSON.stringify(key) + ':' + stableStringify(obj[key]));
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(obj);
}

function verifySignatureV2(body, receivedSignature, timestamp, secret) {
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - numericTimestamp) > 300) return false;
  const processedData = shortenFloats(body);
  const encodedData = stableStringify(processedData);
  const expectedSig = crypto.createHmac('sha256', secret)
    .update(encodedData, 'utf-8')
    .digest('hex');
  try {
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const providedBuf = Buffer.from(receivedSignature, 'hex');
    return expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch { return false; }
}

function verifySignatureSimple(body, receivedSignature, timestamp, secret) {
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - numericTimestamp) > 300) return false;
  const canonicalString = [
    String(body.timestamp || ''),
    String(body.session_id || ''),
    String(body.status || ''),
    String(body.webhook_type || ''),
  ].join(':');
  const expectedSig = crypto.createHmac('sha256', secret)
    .update(canonicalString, 'utf-8')
    .digest('hex');
  try {
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const providedBuf = Buffer.from(receivedSignature, 'hex');
    return expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch { return false; }
}

function verifySignatureOriginal(rawBody, receivedSignature, timestamp, secret) {
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - numericTimestamp) > 300) return false;
  const expectedSig = crypto.createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const providedBuf = Buffer.from(receivedSignature, 'hex');
    return expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch { return false; }
}

function diditTimestamp(req, body) {
  return req.headers['x-timestamp'] || body.created_at || body.timestamp;
}

async function beginDiditWebhookEvent(body) {
  const eventId = body.event_id || body.id;
  if (!eventId) return { shouldProcess: true, receiptId: null };

  const eventType = String(body.webhook_type || body.type || 'didit.verification');
  const eventCreated = Number.isSafeInteger(Number(body.created_at))
    ? Number(body.created_at)
    : null;
  const { rows } = await db.query(
    `INSERT INTO webhook_event_receipts
       (provider, event_id, event_type, object_type, object_id, event_created, status)
     VALUES ('didit', $1, $2, 'session', $3, $4, 'processing')
     ON CONFLICT (provider, event_id) DO UPDATE SET
       attempts = webhook_event_receipts.attempts + 1,
       event_type = EXCLUDED.event_type,
       object_id = EXCLUDED.object_id,
       event_created = EXCLUDED.event_created,
       status = 'processing',
       last_seen_at = NOW(),
       last_error = NULL
     WHERE webhook_event_receipts.status = 'failed'
        OR (
          webhook_event_receipts.status = 'processing'
          AND webhook_event_receipts.last_seen_at < NOW() - INTERVAL '15 minutes'
        )
     RETURNING id`,
    [String(eventId), eventType, body.session_id ? String(body.session_id) : null, eventCreated]
  );

  return { shouldProcess: rows.length > 0, receiptId: rows[0]?.id || null };
}

// Didit identity webhook handler (v3 API)
exports.diditWebhook = async (req, res, next) => {
  let receiptId = null;
  try {
    const secret = process.env.DIDIT_WEBHOOK_SECRET;
    if (!secret) {
      logger.error('[Didit] DIDIT_WEBHOOK_SECRET not set');
      return res.status(500).json({ error: 'Webhook not configured', code: 'webhook_not_configured' });
    }

    // Parse body from raw Buffer
    let rawBody;
    let body;
    try {
      rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      body = typeof req.body === 'object' && !(req.body instanceof Buffer) ? req.body : JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON', code: 'invalid_json' });
    }

  // Get signature headers (Express lowercases them)
  const signatureV2 = req.headers['x-signature-v2'];
  const signatureSimple = req.headers['x-signature-simple'];
  const signatureOriginal = req.headers['x-signature'];
  const timestamp = diditTimestamp(req, body);

  // Try verification methods in order: V2 -> Simple -> Original
  let isValid = false;
  let method = null;

  if (signatureV2) {
    isValid = verifySignatureV2(body, signatureV2, timestamp, secret);
    if (isValid) method = 'v2';
  }
  if (!isValid && signatureSimple) {
    isValid = verifySignatureSimple(body, signatureSimple, timestamp, secret);
    if (isValid) method = 'simple';
  }
  if (!isValid && signatureOriginal) {
    isValid = verifySignatureOriginal(rawBody, signatureOriginal, timestamp, secret);
    if (isValid) method = 'original';
  }

    if (!isValid) {
      logger.warn('[Didit] Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature', code: 'invalid_webhook_signature' });
    }

    logger.info(`[Didit] Signature verified via ${method}`);

    // Handle test webhooks from Didit console
    const isTestWebhook = req.headers['x-didit-test-webhook'] === 'true';
    if (isTestWebhook || body.metadata?.test_webhook) {
      logger.info('[Didit] Test webhook received - signature valid');
      return res.json({ received: true, test: true });
    }

    const event = await beginDiditWebhookEvent(body);
    if (!event.shouldProcess) {
      logger.info('[Didit] Duplicate webhook ignored', { eventId: body.event_id || body.id });
      return res.json({ received: true, duplicate: true });
    }
    receiptId = event.receiptId;

    // Process verification result
    const { session_id, status, decision } = body;
    if (!session_id) {
      await markWebhookEventFailed(receiptId, new Error('Missing session_id'));
      return res.status(400).json({ error: 'Missing session_id', code: 'missing_session_id' });
    }

    // Didit sends capitalized status: "Approved", "Declined"
    const normalizedStatus = (decision?.status || status || '').toLowerCase();
    const idVerification = decision?.id_verifications?.[0] || {};
    const livenessCheck = decision?.liveness_checks?.[0] || {};
    const faceMatch = decision?.face_matches?.[0] || {};

    if (normalizedStatus === 'approved') {
      // Update identity_verifications record
      const { rows } = await db.query(
        `UPDATE identity_verifications
         SET status = 'approved',
             verified_name = $1,
             document_type = $2,
             updated_at = NOW()
         WHERE didit_session_id = $3
         RETURNING user_id`,
        [
          idVerification.full_name || null,
          idVerification.document_type || null,
          session_id,
        ]
      );

      if (rows.length) {
        const userId = rows[0].user_id;

        // Build identity hash from document number + DOB
        const docNumber = idVerification.document_number || '';
        const dob = idVerification.date_of_birth || '';
        let identityHash = null;
        if (docNumber) {
          identityHash = crypto
            .createHash('sha256')
            .update(`${docNumber}:${dob}`.toLowerCase().trim())
            .digest('hex');
        }

        if (!identityHash) {
          logger.warn('[Didit] No document_number - skipping dedup', { userId });
          await db.query(
            `UPDATE users
             SET identity_verified = TRUE,
                 didit_verified_at = NOW(),
                 didit_status = 'verified'
             WHERE id = $1`,
            [userId]
          );
        } else {
          // Check for duplicate identity
          const { rows: existing } = await db.query(
            `SELECT id, email FROM users
             WHERE didit_identity_hash = $1 AND id != $2`,
            [identityHash, userId]
          );

          if (existing.length > 0) {
            await db.query(
              `UPDATE users SET didit_status = 'duplicate' WHERE id = $1`,
              [userId]
            );
            logger.warn('[Didit] Duplicate identity detected', { userId, existingUserId: existing[0].id });
          } else {
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
            logger.info('[Didit] Identity approved', {
              userId,
              name: idVerification.full_name,
              docType: idVerification.document_type,
              livenessScore: livenessCheck.liveness_score,
              faceMatchScore: faceMatch.face_match_score,
            });
          }
        }
      } else {
        // No identity_verifications row found - try finding user by didit_session_id on users table
        const { rows: userRows } = await db.query(
          `SELECT id FROM users WHERE didit_session_id = $1`,
          [session_id]
        );
        if (userRows.length) {
          const userId = userRows[0].id;
          await db.query(
            `UPDATE users
             SET identity_verified = TRUE,
                 didit_verified_at = NOW(),
                 didit_status = 'verified'
             WHERE id = $1`,
            [userId]
          );
          logger.info('[Didit] Identity approved (via didit_session_id fallback)', { userId });
        } else {
          logger.warn('[Didit] No user found for session', { session_id });
        }
      }
    } else if (normalizedStatus === 'declined') {
      const reason = idVerification.warnings?.join(', ')
        || body.reason
        || 'Verification declined';
      await db.query(
        `UPDATE identity_verifications
         SET status = 'declined', last_error = $1, updated_at = NOW()
         WHERE didit_session_id = $2`,
        [reason, session_id]
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
      } else {
        // Fallback: check users table directly
        await db.query(
          `UPDATE users SET didit_status = 'failed' WHERE didit_session_id = $1`,
          [session_id]
        );
      }
    } else {
      logger.info('[Didit] Unhandled status', { status });
    }

    await markWebhookEventProcessed(receiptId);
    res.json({ received: true });
  } catch (err) {
    await markWebhookEventFailed(receiptId, err).catch(() => {});
    logger.error('Didit webhook handler error', { error: err.message });
    if (typeof next === 'function') {
      return next(new AppError('Webhook processing failed', 500, 'webhook_processing_error'));
    }
    return res.status(500).json({ error: 'Webhook processing failed', code: 'webhook_processing_error' });
  }
};

exports.canonicalizeDiditPayload = (body) => stableStringify(shortenFloats(body));
exports.verifyDiditSignatureV2 = (body, signature, timestamp, secret) =>
  verifySignatureV2(body, signature, timestamp, secret);

// Marks a QR scan-to-pay checkout as succeeded.
// Idempotent: only flips rows that have not already succeeded, so duplicate
// webhook deliveries and replays are safe.
async function applyQrPaymentSucceeded(session) {
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || null;
  const { rowCount } = await db.query(
    `UPDATE qr_payments
        SET status = 'succeeded',
            succeeded_at = NOW(),
            stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id)
      WHERE stripe_checkout_session_id = $1
        AND status <> 'succeeded'`,
    [session.id, paymentIntentId]
  );
  return rowCount;
}
exports.applyQrPaymentSucceeded = applyQrPaymentSucceeded;
