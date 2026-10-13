const diditEntityLink = require('../services/diditEntityLink');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { sendNotification } = require('../services/notificationService');

if (!process.env.STRIPE_SECRET_KEY) {
  logger.error('[FATAL] STRIPE_SECRET_KEY is not set - Stripe webhooks will fail.');
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const chargebackEvidence = require('../services/chargebackEvidenceService');
const bookingDeposits = require('../services/bookingDepositService');
const { recalculateBadges } = require('./verificationController');
const { withTransaction } = require('../utils/transaction');
const {
  applyStripePaymentIntent,
  applyStripeRefund,
  applyStripeChargeRefund,
} = require('../services/restaurantPosPaymentLedgerService');
const { releaseInventoryForOrder } = require('../services/restaurantInventoryOrderService');
const socketService = require('../services/socketService');
const localDeliveryPayments = require('../services/localDeliveryPaymentService');
const topupService = require('../services/oxsteedCreditTopupService');
const restaurantTopupService = require('../services/restaurantTopupService');
const restaurantPayoutService = require('../services/restaurantPayoutService');
const { ingestStripeChargeback } = require('../services/oxsteedCreditChargebackService');
const { createFraudCase } = require('../services/fraudCaseService');
const { recordException } = require('../services/reconciliationExceptions');
const { stripeObjectId, invoiceSubscriptionId, subscriptionPeriod } = require('../utils/stripePayload');
const { applyChargeRefund, verifiedChargeRefundTotal } = require('../services/paymentRefundStateService');
const stripeWebhookContract = require('../config/stripeWebhookContract');
const businessInvoiceStripeConnectService = require('../services/businessInvoiceStripeConnectService');
const creditLedger = require('../services/referralCreditLedger');
const { toLocalSubscriptionStatus } = require('../utils/subscriptionStatus');
const jobPaymentReauth = require('../services/jobPaymentReauthorizationService');
const paymentRailWebhooks = require('../services/paymentRails/webhooks');
const { captureCents } = require('../services/paymentCaptureService');

function extractFoodOrderId(metadata) {
  const raw = metadata?.food_order_id
    || metadata?.foodOrderId
    || metadata?.foodOrderID
    || metadata?.restaurant_order_id
    || metadata?.restaurantOrderId;
  const parsed = Number.parseInt(String(raw || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// ── Charge dispute -> fraud case helpers ──────────────────────────────

// Pull a user/business subject directly out of Stripe metadata.
// For job payments the payer is the client; helper_id only identifies the
// payout recipient, so it stays last in precedence.
function extractSubjectFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const userId = metadata.user_id
    || metadata.userId
    || metadata.payer_id
    || metadata.client_id
    || metadata.customer_id
    || metadata.customer_user_id
    || metadata.helper_id;
  if (userId) return { subjectType: 'user', subjectId: String(userId) };
  const businessId = metadata.business_id || metadata.businessId;
  if (businessId) return { subjectType: 'business', subjectId: String(businessId) };
  return null;
}

// Map a Stripe dispute to the local user/business the charge belongs to.
// Returns { subjectType, subjectId } or null when nothing maps; callers must
// skip case creation in that case (never invent an 'unknown' subject).
async function resolveDisputeSubject(dispute, accountId) {
  const chargeRef = dispute?.charge;
  const metadataSources = [dispute?.metadata];

  if (chargeRef && typeof chargeRef === 'object') {
    metadataSources.push(chargeRef.metadata);
  } else if (typeof chargeRef === 'string' && chargeRef
      && stripe.charges && typeof stripe.charges.retrieve === 'function') {
    // Dispute events carry the charge id, not its metadata; fetch it so the
    // metadata-based resolution below (job_id, order ids) can run.
    try {
      const charge = await stripe.charges.retrieve(chargeRef, accountId ? { stripeAccount: accountId } : {});
      metadataSources.push(charge?.metadata);
    } catch (err) {
      logger.warn('[Stripe] Failed to retrieve charge for dispute subject resolution', {
        chargeId: chargeRef,
        error: err.message,
      });
    }
  }

  for (const metadata of metadataSources) {
    const subject = extractSubjectFromMetadata(metadata);
    if (subject) return subject;
  }

  // Job escrow payments: payments row maps PI id / charge id to the payer.
  const piId = typeof dispute?.payment_intent === 'string'
    ? dispute.payment_intent
    : dispute?.payment_intent?.id;
  const chargeId = typeof chargeRef === 'string' ? chargeRef : chargeRef?.id;
  if (piId || chargeId) {
    const { rows } = await db.query(
      `SELECT payer_id FROM payments
        WHERE stripe_payment_intent_id = $1 OR stripe_charge_id = $2
        LIMIT 1`,
      [piId || null, chargeId || null]
    );
    if (rows[0]?.payer_id) {
      return { subjectType: 'user', subjectId: String(rows[0].payer_id) };
    }
  }

  // Order-id metadata carried on the charge: food, marketplace, then jobs.
  const metadata = Object.assign({}, ...metadataSources.filter(Boolean));
  const foodOrderId = extractFoodOrderId(metadata);
  if (foodOrderId) {
    const { rows } = await db.query(
      'SELECT customer_id FROM food_orders WHERE id = $1::bigint',
      [foodOrderId]
    );
    if (rows[0]?.customer_id) {
      return { subjectType: 'user', subjectId: String(rows[0].customer_id) };
    }
  }
  const marketplaceOrderId = metadata.orderId || metadata.order_id;
  if (marketplaceOrderId) {
    const { rows } = await db.query(
      'SELECT customer_id FROM marketplace_orders WHERE id = $1',
      [marketplaceOrderId]
    );
    if (rows[0]?.customer_id) {
      return { subjectType: 'user', subjectId: String(rows[0].customer_id) };
    }
  }
  const jobId = metadata.job_id;
  if (jobId) {
    const { rows } = await db.query(
      'SELECT client_id FROM jobs WHERE id = $1',
      [jobId]
    );
    if (rows[0]?.client_id) {
      return { subjectType: 'user', subjectId: String(rows[0].client_id) };
    }
  }

  return null;
}

function buildDisputeEvidence(dispute) {
  const evidence = {
    dispute_id: dispute.id,
    amount_cents: dispute.amount,
    currency: dispute.currency,
    reason: dispute.reason || null,
    status: dispute.status,
    charge_id: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id || null,
    payment_intent_id: typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id || null,
  };
  if (dispute.status === 'lost') {
    evidence.escalation_note = 'Dispute lost: funds withdrawn. Recommend escalating case severity to critical.';
  }
  return evidence;
}

// Open (or return the existing) fraud case for a charge dispute, then merge
// the latest dispute evidence into the row so out-of-order events stay fresh.
async function recordChargeDisputeCase(dispute, accountId) {
  const subject = await resolveDisputeSubject(dispute, accountId);
  if (!subject) {
    logger.warn('[Stripe] charge.dispute without a resolvable user/business subject; skipping fraud case', {
      disputeId: dispute?.id,
    });
    return null;
  }
  const amount = dispute.amount != null && dispute.currency
    ? `${(dispute.amount / 100).toFixed(2)} ${String(dispute.currency).toUpperCase()}`
    : 'unknown amount';
  const caseRow = await createFraudCase({
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    category: 'chargeback',
    severity: 'high',
    source: 'stripe_webhook',
    sourceRef: dispute.id,
    summary: `Stripe dispute ${dispute.id} (${amount}${dispute.reason ? `, reason: ${dispute.reason}` : ''})`,
    evidence: buildDisputeEvidence(dispute),
  });
  if (caseRow) {
    await db.query(
      `UPDATE fraud_cases
          SET evidence = COALESCE(evidence, '{}'::jsonb) || $1::jsonb,
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(buildDisputeEvidence(dispute)), caseRow.id]
    );
  }
  return caseRow;
}

// C8: a lost chargeback is a real money movement, not just a fraud-case note.
// Mark the payment disputed (which blocks escrow release — the release path
// only proceeds while funds are held), stamp the Stripe dispute id, and post
// the loss to the platform ledger so the P&L reflects it.
async function recordLostDisputeFinancials(dispute, accountId) {
  if (dispute?.status !== 'lost') return null;
  const chargeId = typeof dispute?.charge === 'string' ? dispute.charge : dispute?.charge?.id || null;
  const piId = typeof dispute?.payment_intent === 'string'
    ? dispute.payment_intent
    : dispute?.payment_intent?.id || null;
  if (!chargeId && !piId) {
    logger.warn('[Stripe] lost dispute without charge/payment_intent reference; skipping financials', {
      disputeId: dispute?.id,
    });
    return null;
  }
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM payments
        WHERE ($1::text IS NOT NULL AND stripe_charge_id = $1)
           OR ($2::text IS NOT NULL AND stripe_payment_intent_id = $2)
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE`,
      [chargeId, piId]
    );
    const payment = rows[0];
    if (!payment) {
      await recordException({
        domain: 'payment_refund',
        referenceId: `stripe-dispute:${dispute.id}`,
        severity: 'warning',
        summary: 'Lost Stripe dispute has no matching payments row',
        details: { disputeId: dispute.id, chargeId, paymentIntentId: piId, stripeAccountId: accountId },
      });
      logger.warn('[Stripe] lost dispute with no matching payment; reconciliation exception recorded', {
        disputeId: dispute?.id,
      });
      return null;
    }
    if (payment.dispute_status === 'lost') {
      return { payment, replayed: true };
    }
    const { rows: updatedRows } = await client.query(
      `UPDATE payments
          SET status = 'disputed',
              payment_hold_status = 'disputed',
              escrow_status = CASE WHEN escrow_status = 'released' THEN escrow_status ELSE 'disputed' END,
              stripe_dispute_id = $2,
              dispute_status = 'lost',
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [payment.id, dispute.id]
    );
    // Post the loss once, deduped on the dispute id in metadata.
    const { rows: existingLoss } = await client.query(
      `SELECT id FROM platform_ledger
        WHERE type = 'dispute_lost'
          AND metadata->>'stripeDisputeId' = $1
        LIMIT 1`,
      [dispute.id]
    );
    if (!existingLoss[0]) {
      // P3-1-F20: the chargeback debit lands on the helper's connected
      // Stripe account, not on platform funds. Record it as a memorandum
      // entry attributed to the payee (the connected-account owner) so the
      // platform P&L is not overstated with a loss it did not absorb.
      await client.query(
        `INSERT INTO platform_ledger (user_id, type, amount_cents, description, metadata, idempotency_key)
         VALUES ($1, 'dispute_lost', $2, $3, $4::jsonb, $5)`,
        [
          payment.payee_id,
          -Math.abs(Number(dispute.amount || 0)),
          `Memo: lost dispute ${dispute.id} debited helper connected account (charge ${chargeId || piId})`,
          JSON.stringify({
            stripeDisputeId: dispute.id,
            paymentId: payment.id,
            chargeId,
            paymentIntentId: piId,
            stripeAccountId: accountId,
            reason: dispute.reason || null,
            memo: true,
            debit_location: 'connected_account',
          }),
          `dispute-lost:${dispute.id}`,
        ]
      );
    }
    logger.info('[Stripe] recorded lost-dispute financials', {
      disputeId: dispute.id,
      paymentId: payment.id,
      amountCents: dispute.amount,
    });
    return { payment: updatedRows[0], replayed: false };
  }, 'stripe_dispute_lost');
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
        -- P3-890: a late/out-of-order unpaid session never undoes a payment.
        AND NOT ($1 IN ('requires_payment', 'unpaid') AND payment_status IN ('paid', 'refunded'))
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

  await withTransaction(db, async client => {
  const { rows: businesses } = await client.query(
    `SELECT b.id FROM businesses b
       LEFT JOIN business_integrations bi ON bi.business_id = b.id AND bi.integration_type = 'stripe'
      WHERE b.stripe_account_id = $1
         OR (b.stripe_account_id IS NULL AND bi.is_connected = TRUE
             AND bi.config_json->>'account_id' = $1::text)
      FOR UPDATE OF b`,
    [accountId]
  );
  const { syncBusinessOAuthToRestaurantConnect } = require('../services/stripeConnectSoTService');
  for (const { id: businessId } of businesses) {

  await client.query(
    `UPDATE businesses
        SET stripe_account_id = COALESCE(stripe_account_id, $1),
            stripe_charges_enabled = $2,
            stripe_payouts_enabled = $3,
            stripe_account_status = $4,
            updated_at = NOW()
      WHERE id = $5 AND (stripe_account_id IS NULL OR stripe_account_id = $1)`,
    [accountId, !!account.charges_enabled, !!account.payouts_enabled, accountStatus, businessId]
  );

  await client.query(
    `UPDATE business_integrations
        SET is_connected = TRUE,
            config_json = COALESCE(config_json, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
      WHERE business_id = $3
        AND integration_type = 'stripe'
        AND (config_json->>'account_id' IS NULL OR config_json->>'account_id' = $1::text)`,
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
  );
  await syncBusinessOAuthToRestaurantConnect(client, businessId);
  }
  }, 'sync_business_stripe_account');
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
  // Connect account.updated is the processor-owned verification event. Keep
  // payout methods fail-closed when payouts are disabled or requirements
  // regress, and never accept a user-supplied verified status.
  await db.query(
    `UPDATE payout_methods
        SET status = CASE WHEN $2::boolean THEN 'verified' ELSE 'pending' END,
            verified_at = CASE WHEN $2::boolean THEN COALESCE(verified_at, NOW()) ELSE NULL END,
            updated_at = NOW()
      WHERE stripe_account_id = $1
        AND helper_id = $3
        AND status IN ('pending', 'verified', 'active')`,
    [accountId, !!account.payouts_enabled, userId]
  );

  await db.query(
    `UPDATE connect_accounts
        SET charges_enabled = $2,
            payouts_enabled = $3,
            onboarding_complete = $4,
            updated_at = NOW()
      WHERE stripe_account_id = $1 AND user_id = $5`,
    [accountId, !!account.charges_enabled, !!account.payouts_enabled, onboardingComplete, userId]
  );

  const { syncHelperProfileStripeFromConnect } = require('../services/stripeConnectSoTService');
  await syncHelperProfileStripeFromConnect(db, userId, {
    stripeAccountId: accountId,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    onboardingComplete,
  });

  logger.info('[Stripe] Connect account synced', {
    userId,
    accountId,
    charges_enabled: !!account.charges_enabled,
    payouts_enabled: !!account.payouts_enabled,
    onboarding_complete: onboardingComplete,
    accountStatus,
  });
}

// Review P3-888: when a claim is refused, distinguish a finished receipt
// (true duplicate -> 200) from one still 'processing' (in flight, or left
// behind by a crash). For the latter answer non-2xx so the provider keeps
// retrying; the 15-minute reclaim then reprocesses it instead of the event
// being acknowledged and silently dropped.
async function receiptInFlight(provider, eventId) {
  const { rows } = await db.query(
    'SELECT status FROM webhook_event_receipts WHERE provider = $1 AND event_id = $2',
    [provider, String(eventId)]
  );
  return rows[0]?.status === 'processing';
}

function respondInFlight(res) {
  res.set('Retry-After', '60');
  return res.status(409).json({ received: false, code: 'webhook_in_flight' });
}

async function beginWebhookEvent(provider, event) {
  if (!event?.id) return { shouldProcess: true };

  const object = event.data?.object || {};
  const eventType = String(event.type || 'unknown');
  const objectType = eventType.startsWith('charge.dispute.') ? 'dispute'
    : eventType.split('.', 1)[0] || 'unknown';
  const objectId = (() => {
    // Each refund/dispute/session has an independent lifecycle. Sharing the PI
    // watermark loses a valid older refund when another refund arrives first.
    return object.id ? String(object.id) : null;
  })();
  const eventCreated = Number.isSafeInteger(Number(event.created)) ? Number(event.created) : null;

  const { rows } = await db.query(
    `INSERT INTO webhook_event_receipts
       (provider, event_id, event_type, object_type, object_id, event_created, status, account_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'processing', $7)
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
    [provider, event.id, eventType, objectType, objectId, eventCreated, event.account || null]
  );

  const receiptId = rows[0]?.id;
  if (rows.length === 0) {
    return { shouldProcess: false, receiptId: null, inFlight: await receiptInFlight(provider, event.id) };
  }
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
  const destination = req.stripeWebhookDestination === 'connect' ? 'connect' : 'platform';
  const contract = stripeWebhookContract[destination];
  const signingSecret = process.env[contract.secretEnv];
  if (!signingSecret) {
    return next(new AppError('Webhook destination is not configured', 503, 'webhook_not_configured'));
  }

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      signingSecret
    );
  } catch (err) {
    logger.error('Webhook signature verification failed', { error: err.message });
    return next(new AppError('Invalid signature', 400, 'invalid_webhook_signature'));
  }

  return handleVerifiedStripeEvent(event, destination, res, next);
};

/**
 * Process a signature-verified Stripe event. Shared by the webhook endpoint
 * and the operator replay of failed receipts (review P3-891), which
 * re-fetches the event from the Stripe API instead of trusting stored data.
 */
async function handleVerifiedStripeEvent(event, destination, res, next) {
  const contract = stripeWebhookContract[destination];
  let receiptId;
  // A platform secret must not authenticate connected-account events, or vice
  // versa. Missing Connect configuration fails closed without breaking startup.
  if ((destination === 'connect') !== !!event.account) {
    return next(new AppError('Webhook account source mismatch', 400, 'webhook_account_mismatch'));
  }
  if (destination === 'connect' && !contract.events.includes(event.type)) {
    return next(new AppError('Unsupported connected-account event', 400, 'webhook_event_not_supported'));
  }

  try {
    const receipt = await beginWebhookEvent('stripe', event);
    receiptId = receipt.receiptId;
    if (!receipt.shouldProcess && receipt.inFlight) {
      logger.warn('Stripe webhook still in flight; asking the provider to retry', { eventId: event.id, eventType: event.type });
      return respondInFlight(res);
    }
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

    // Review P1-297: connected-account checkout events are QR scan-to-pay
    // sessions. Anything else on this destination is acknowledged and ignored.
    if (destination === 'connect' && String(event.type).startsWith('checkout.session.')) {
      await handleConnectedCheckoutEvent(event);
      await markWebhookEventProcessed(receiptId);
      return res.json({ received: true });
    }

    switch (event.type) {
      // Review P3-890: delayed-notification methods (ACH, bank debits) send
      // async_payment_succeeded instead of a paid completed session; the
      // completed handler keys everything off session.payment_status.
      case 'checkout.session.async_payment_succeeded':
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
          const subscriptionId = stripeObjectId(session.subscription);
          const userId = session.metadata.userId;
          const planId = parseInt(session.metadata.planId);
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const period = subscriptionPeriod(sub);
          const newStatus = toLocalSubscriptionStatus(sub.status);
          // P3-11-F08: the subscription row, the tier grant, and the audit
          // row commit together; a missing audit row fails the whole event.
          // P2-6-F07: two checkouts racing (or a dashboard-created duplicate)
          // must not leave two active rows for one user. Serialize per user
          // with an advisory lock, refuse the second active row, and cancel
          // the duplicate at Stripe so the customer is not double-billed.
          // The partial unique index (migration 826) backstops this check.
          await withTransaction(db, async (client) => {
            await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`subscription-user:${userId}`]);
            const { rows: dupRows } = await client.query(
              `SELECT id, stripe_subscription_id FROM subscriptions
                WHERE user_id = $1 AND status IN ('active', 'trialing') FOR UPDATE`,
              [userId]
            );
            const duplicate = dupRows.find((row) => row.stripe_subscription_id !== subscriptionId);
            if (duplicate && ['active', 'trialing'].includes(newStatus)) {
              logger.warn('[webhook] duplicate active subscription refused; cancelling duplicate at Stripe', {
                userId, keptSubscriptionId: duplicate.stripe_subscription_id, duplicateSubscriptionId: subscriptionId,
              });
              try {
                await stripe.subscriptions.cancel(subscriptionId);
              } catch (cancelErr) {
                logger.error('[webhook] failed to cancel duplicate Stripe subscription', {
                  subscriptionId, error: cancelErr?.message,
                });
              }
              return;
            }
            const { rows: inserted } = await client.query(
              `INSERT INTO subscriptions (user_id, plan_id, stripe_subscription_id, stripe_customer_id, status, current_period_start, current_period_end)
               VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7))
               ON CONFLICT (stripe_subscription_id) DO UPDATE SET status = $5
               RETURNING id`,
              [userId, planId, subscriptionId, stripeObjectId(session.customer), newStatus,
               period.start, period.end]
            );
            // Get plan tier
            const { rows: plans } = await client.query(
              'SELECT COALESCE(tier, slug) AS tier_slug, slug FROM plans WHERE id = $1', [planId]
            );
            const planSlug = plans[0]?.slug || plans[0]?.tier_slug || 'pro';
            const userTier = planSlug === 'basic' ? 'basic' : planSlug === 'broker' ? 'broker' : 'pro';
            await client.query(
              `UPDATE users
               SET tier = $1,
                   subscription_status = 'active',
                   tier_selected = TRUE
               WHERE id = $2`,
              [userTier, userId]
            );
            if (inserted[0]) {
              const { logAdminAction } = require('../services/auditService');
              await logAdminAction({
                client,
                adminId: userId,
                action: 'subscription.created',
                targetType: 'subscription',
                targetId: String(inserted[0].id),
                description: `Subscription created via Stripe Checkout (plan ${planSlug})`,
                after: { status: newStatus, plan_id: planId },
                throwOnError: true,
              });
            }
          }, 'webhook_subscription_created');
          await recalculateBadges(userId);
        }
        break;
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        // Review P3-890: close out unpaid sessions; never downgrade money
        // that already landed.
        const session = event.data.object;
        const failed = event.type === 'checkout.session.async_payment_failed';
        await applyCheckoutSessionNotPaid(session, failed ? 'failed' : 'expired');
        break;
      }

      case 'customer.subscription.created': {
        // Subscriptions created through Checkout are already handled by
        // checkout.session.completed (which fires first and creates the row).
        // This case exists for subscriptions created via the Stripe dashboard
        // or API - without it, those subscriptions are invisible to the app.
        const sub = event.data.object;
        const period = subscriptionPeriod(sub);
        const { rows: existing } = await db.query(
          'SELECT id FROM subscriptions WHERE stripe_subscription_id = $1', [sub.id]
        );
        if (existing.length > 0) break; // Already handled by checkout.session.completed

        // Look up the user via their Stripe customer ID
        // Review P2-572: users has no stripe_customer_id column; resolve the
        // owner from subscription metadata, then from an earlier subscription
        // row for the same Stripe customer.
        const { rows: userRows } = await db.query(
          `SELECT id FROM users WHERE id::text = $1
           UNION ALL
           SELECT user_id AS id FROM subscriptions WHERE stripe_customer_id = $2
           LIMIT 1`,
          [String(sub.metadata?.user_id || sub.metadata?.userId || ''), stripeObjectId(sub.customer)]
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

        await withTransaction(db, async (client) => {
          // P2-6-F07: a dashboard/API-created subscription must not become a
          // second active row for the user. Serialize per user; refuse the
          // duplicate and cancel it at Stripe so the customer is not
          // double-billed. Migration 826 backstops this check.
          const newStatus = toLocalSubscriptionStatus(sub.status);
          await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`subscription-user:${userRows[0].id}`]);
          const { rows: dupRows } = await client.query(
            `SELECT id, stripe_subscription_id FROM subscriptions
              WHERE user_id = $1 AND status IN ('active', 'trialing') FOR UPDATE`,
            [userRows[0].id]
          );
          if (dupRows.some((row) => row.stripe_subscription_id !== sub.id) && ['active', 'trialing'].includes(newStatus)) {
            logger.warn('[webhook] duplicate dashboard subscription refused; cancelling duplicate at Stripe', {
              userId: userRows[0].id, duplicateSubscriptionId: sub.id,
            });
            try {
              await stripe.subscriptions.cancel(sub.id);
            } catch (cancelErr) {
              logger.error('[webhook] failed to cancel duplicate Stripe subscription', {
                subscriptionId: sub.id, error: cancelErr?.message,
              });
            }
            return;
          }
          const { rows: inserted } = await client.query(
            `INSERT INTO subscriptions
               (user_id, plan_id, stripe_subscription_id, stripe_customer_id,
                status, current_period_start, current_period_end)
             VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7))
             ON CONFLICT (stripe_subscription_id) DO NOTHING
             RETURNING id`,
            [userRows[0].id, planId, sub.id, stripeObjectId(sub.customer), newStatus,
             period.start, period.end]
          );

          if (inserted[0]) {
            // P3-11-F08: audit the dashboard/API-created subscription in the
            // same transaction as the row itself.
            const { logAdminAction } = require('../services/auditService');
            await logAdminAction({
              client,
              adminId: userRows[0].id,
              action: 'subscription.created',
              targetType: 'subscription',
              targetId: String(inserted[0].id),
              description: 'Subscription created outside Checkout (Stripe dashboard or API)',
              after: { status: toLocalSubscriptionStatus(sub.status), plan_id: planId },
              throwOnError: true,
            });
          }
        }, 'webhook_subscription_created_dashboard');

        // Only a paying/trialing subscription grants the tier; incomplete
        // ones wait for customer.subscription.updated.
        if (planId && ['active', 'trialing'].includes(toLocalSubscriptionStatus(sub.status))) {
          const { rows: planMeta } = await db.query(
            'SELECT COALESCE(tier, slug) AS tier_slug, slug FROM plans WHERE id = $1', [planId]
          );
          const planSlug = planMeta[0]?.slug || planMeta[0]?.tier_slug || 'pro';
          const userTier = planSlug === 'basic' ? 'basic' : planSlug === 'broker' ? 'broker' : 'pro';
          await db.query(
            `UPDATE users SET tier = $1, subscription_status = $3, tier_selected = TRUE
             WHERE id = $2`,
            [userTier, userRows[0].id, toLocalSubscriptionStatus(sub.status)]
          );
          await recalculateBadges(userRows[0].id);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const period = subscriptionPeriod(sub);
        await db.query(
          `UPDATE subscriptions SET status = $1, current_period_start = to_timestamp($2),
           current_period_end = to_timestamp($3), cancel_at_period_end = $4, updated_at = NOW()
           WHERE stripe_subscription_id = $5`,
          [toLocalSubscriptionStatus(sub.status), period.start, period.end,
           sub.cancel_at_period_end, sub.id]
        );
        const { rows } = await db.query(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1', [sub.id]
        );
        if (rows.length) {
          await db.query(
            'UPDATE users SET subscription_status = $1 WHERE id = $2',
            [toLocalSubscriptionStatus(sub.status), rows[0].user_id]
          );
          await recalculateBadges(rows[0].user_id);
          if (toLocalSubscriptionStatus(sub.status) === 'past_due') {
            await sendNotification({
              userId: rows[0].user_id,
              type: 'subscription_past_due',
              data: { subscription_id: sub.id },
              action_url: '/settings',
              idempotencyKey: `stripe:subscription_past_due:${event.id || sub.id}:${rows[0].user_id}`,
            }).catch((e) => logger.warn('Failed to send subscription past due notification', { error: e.message }));
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await withTransaction(db, async (client) => {
          const { rows: existing } = await client.query(
            `SELECT id, user_id, status FROM subscriptions
              WHERE stripe_subscription_id = $1 FOR UPDATE`,
            [sub.id]
          );
          const current = existing[0];
          if (current && current.status !== 'cancelled') {
            await client.query(
              `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
               WHERE id = $1`,
              [current.id]
            );
            // P3-11-F08: audit the provider-side cancellation in the same
            // transaction as the status change.
            const { logAdminAction } = require('../services/auditService');
            await logAdminAction({
              client,
              adminId: current.user_id,
              action: 'subscription.cancelled',
              targetType: 'subscription',
              targetId: String(current.id),
              description: 'Subscription cancelled at the payment processor (Stripe webhook)',
              before: { status: current.status },
              after: { status: 'cancelled' },
              throwOnError: true,
            });
          }
        }, 'webhook_subscription_deleted');
        const { rows } = await db.query(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1', [sub.id]
        );
        if (rows.length) {
          const uid = rows[0].user_id;
          await db.query(
            `UPDATE users SET tier = 'free', subscription_status = 'cancelled' WHERE id = $1`,
            [uid]
          );
          // Deactivate subscription-dependent badges
          await db.query(
            `UPDATE badges SET active = FALSE WHERE user_id = $1 AND type IN ('verified', 'pro')`,
            [uid]
          );
          await sendNotification({
            userId: uid,
            type: 'subscription_cancelled',
            data: { subscription_id: sub.id },
            action_url: '/settings',
            idempotencyKey: `stripe:subscription_cancelled:${sub.id}:${uid}`,
          }).catch((e) => logger.warn('Failed to send subscription cancellation notification', { error: e.message }));
        }
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        // Fires on every successful charge — initial subscription AND all renewals.
        // `customer.subscription.updated` also fires on renewal, but that event
        // can sometimes precede the actual payment confirmation. This handler
        // ensures the subscription row and user tier are authoritative after each
        // billing cycle regardless of event ordering.
        const invoice = event.data.object;
        const subId = invoiceSubscriptionId(invoice);
        if (!subId) break; // one-off invoice, not a subscription charge

        // Retrieve the live subscription object to get fresh period dates
        // A temporary provider failure must cause a retry, not acknowledge a
        // renewal without updating the customer's entitlement.
        const sub = await stripe.subscriptions.retrieve(subId);
        const period = subscriptionPeriod(sub);

        // P3-11-F08: the renewal write and its audit row commit together;
        // a missing audit row fails the renewal rather than going unaudited.
        await withTransaction(db, async (client) => {
          const { rows: previous } = await client.query(
            `SELECT id, user_id, status FROM subscriptions
              WHERE stripe_subscription_id = $1 FOR UPDATE`,
            [subId]
          );
          await client.query(
            `UPDATE subscriptions
             SET status                = $1,
                 current_period_start  = to_timestamp($2),
                 current_period_end    = to_timestamp($3),
                 cancel_at_period_end  = $4,
                 updated_at            = NOW()
             WHERE stripe_subscription_id = $5`,
            [toLocalSubscriptionStatus(sub.status), period.start, period.end,
             sub.cancel_at_period_end, subId]
          );
          if (previous[0]) {
            const { logAdminAction } = require('../services/auditService');
            await logAdminAction({
              client,
              adminId: previous[0].user_id,
              action: 'subscription.renewed',
              targetType: 'subscription',
              targetId: String(previous[0].id),
              description: 'Subscription renewed (Stripe invoice paid)',
              before: { status: previous[0].status },
              after: {
                status: toLocalSubscriptionStatus(sub.status),
                current_period_end: new Date(period.end * 1000).toISOString(),
              },
              throwOnError: true,
            });
          }
        }, 'webhook_subscription_renewed');

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
          await sendNotification({
            userId: user_id,
            type: 'subscription_renewed',
            data: { subscription_id: subId, period_end: period.end },
            action_url: '/settings',
            idempotencyKey: `stripe:subscription_renewed:${invoice.id || subId}:${user_id}`,
          }).catch((e) => logger.warn('Failed to send subscription renewal notification', { error: e.message }));
          logger.info('[webhook] invoice.payment_succeeded — subscription renewed', {
            subscriptionId: subId, userId: user_id, periodEnd: period.end,
          });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subId = invoiceSubscriptionId(invoice);
        if (!subId) break;
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
          await sendNotification({
            userId: uid,
            type: 'subscription_past_due',
            data: { subscription_id: subId },
            action_url: '/settings',
            idempotencyKey: `stripe:subscription_past_due:${invoice.id || subId}:${uid}`,
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
        // Change-order re-authorization: swap the job payment onto this intent.
        if (await jobPaymentReauth.applyReauthorizationWebhook(event.type, pi)) break;
        const jobId = pi.metadata?.job_id;
        // Review P3-789 / P3-889: the authorized status, the referral-credit
        // deduction and the intent application commit together, and the
        // deduction is keyed per payment so a retry cannot post it twice.
        await withTransaction(db, async (client) => {
          if (jobId) {
            const { rows: payRows } = await client.query(
              `UPDATE payments p SET status = 'authorized', payment_hold_status = 'held',
                 authorized_at = COALESCE(p.authorized_at, NOW()),
                 authorization_expires_at = NOW() + make_interval(days => COALESCE(
                   (SELECT card_auth_window_days FROM payment_country_policies WHERE country_code = p.fee_country), 7)),
                 updated_at = NOW()
               WHERE stripe_payment_intent_id = $1 AND status != 'captured'
               RETURNING id, payer_id, metadata`,
              [pi.id]
            );
            const pay = payRows[0];
            const appliedCents = Number(pay?.metadata?.applied_credit_cents ?? pay?.metadata?.appliedCreditCents ?? 0);
            if (pay && appliedCents > 0) {
              // No-op when the reservation was made at intent creation.
              await creditLedger.applyCreditToPayment(client, {
                userId: pay.payer_id,
                paymentId: pay.id,
                amountCents: appliedCents,
                jobId,
                paymentIntentId: pi.id,
              });
            }
            logger.info(`[Stripe] PaymentIntent ${pi.id} authorized - job ${jobId} funds held`);
          }
          await applyStripePaymentIntent(client, pi);
        });
        break;
      }

      case 'payment_intent.succeeded': {
        // Booking-request deposits (P3-962): settle even if the native
        // client never confirms.
        if (await bookingDeposits.applyBookingIntentWebhook(event.type, event.data.object)) break;
        // OxSteed Credit top-up (fiat money IN). Handled and acknowledged
        // here; PaymentIntents that are not ours fall through to the
        // flows below.
        if (await topupService.applyCreditTopupWebhookEvent({ type: event.type, object: event.data.object })) {
          break;
        }
        // Restaurant customer top-up (fiat money IN, migration 663). Same
        // contract: handled here, everything else falls through.
        if (await restaurantTopupService.applyRestaurantTopupWebhookEvent({ type: event.type, object: event.data.object })) {
          break;
        }
        // Review P3-1067: consulting session payments.
        if (await require('../services/consultingPaymentService')
          .applyConsultingPaymentWebhookEvent({ type: event.type, object: event.data.object })) {
          break;
        }
        const pi = event.data.object;
        // Change-order re-authorization on a platform-held (charge-now) payment.
        if (await jobPaymentReauth.applyReauthorizationWebhook(event.type, pi)) break;
        // Charge-now + platform hold (local methods, jobs > 5 days out): the
        // money is held for the job, not released to the helper yet.
        if (await paymentRailWebhooks.applyPlatformHoldSucceeded(pi)) break;
        // Tips: processing cost only (decision #9).
        if (await paymentRailWebhooks.applyTipIntent(event.type, pi)) break;
        if (pi?.metadata?.business_invoice_payment === 'true') {
          await withTransaction(db, (client) => businessInvoiceStripeConnectService
            .applyBusinessInvoicePaymentFromWebhook(client, pi));
          break;
        }
        // Capture completed - money is on its way to the helper or order is complete.
        const jobId = pi.metadata?.job_id;
        const orderId = pi.metadata?.orderId;
        let foodOrderId = extractFoodOrderId(pi.metadata);
        if (!foodOrderId && !jobId && !orderId && pi?.id) {
          // Card-payment intents are stamped with food_order_id when the order
          // is created, but the succeeded event can arrive first (or the stamp
          // can fail). Fall back to the intent id recorded on the order.
          const { rows: orderRows } = await db.query(
            `SELECT id FROM food_orders WHERE stripe_payment_intent_id = $1 LIMIT 1`,
            [pi.id]
          );
          foodOrderId = orderRows[0]?.id || null;
        }

        if (foodOrderId) {
          await withTransaction(db, async (client) => {
            await applyFoodOrderPaymentState(client, {
              orderId: foodOrderId,
              paymentStatus: 'paid',
              stripePaymentIntentId: pi.id,
            });
          });
        } else if (jobId) {
          // Tier-3 capture (P3-1-F09). Verify the money before the ledger
          // moves: the row must exist and be pre-capture, and Stripe's
          // captured amount must equal what we authorized (partial captures
          // are capped by capture_amount_cents, which the expectation
          // accounts for). Anything else fails closed: a reconciliation
          // exception is recorded and neither the payment nor the escrow
          // changes state.
          const capturedPayment = await withTransaction(db, async (client) => {
            const { rows } = await client.query(
              `SELECT id, payer_id, amount, currency, capture_amount_cents, status, metadata
                 FROM payments WHERE stripe_payment_intent_id = $1 FOR UPDATE`,
              [pi.id]
            );
            const payment = rows[0];
            if (!payment) {
              logger.error('[Stripe] payment_intent.succeeded for job with no payments row; escrow NOT released',
                { intentId: pi.id, jobId });
              await recordException({
                domain: 'payment_capture',
                referenceId: `stripe-pi:${pi.id}`,
                severity: 'critical',
                summary: 'Succeeded job PaymentIntent has no payments row; escrow not released',
                details: { intentId: pi.id, jobId: String(jobId) },
              });
              return null;
            }
            if (!['pending', 'authorized'].includes(payment.status)) {
              // Replay or late event for a terminal row (captured, refunded,
              // failed, canceled): never flip it back to captured.
              logger.warn('[Stripe] payment_intent.succeeded for non-capturable payment; ignored',
                { intentId: pi.id, paymentId: payment.id, status: payment.status });
              return null;
            }
            const expectedMinor = captureCents(payment.amount, payment.capture_amount_cents, payment.currency);
            const receivedMinor = Number(pi.amount_received ?? pi.amount);
            const currencyOk = String(pi.currency || '').toLowerCase() === String(payment.currency || '').toLowerCase();
            if (!currencyOk || !Number.isSafeInteger(receivedMinor) || receivedMinor !== expectedMinor) {
              logger.error('[Stripe] capture amount mismatch; payment NOT marked captured, escrow NOT released', {
                intentId: pi.id, paymentId: payment.id, jobId,
                expectedMinor, receivedMinor,
                paymentCurrency: payment.currency, piCurrency: pi.currency,
              });
              await recordException({
                domain: 'payment_capture',
                referenceId: `payment:${payment.id}`,
                severity: 'critical',
                summary: 'Stripe captured amount does not match the payments row; escrow not released',
                details: {
                  intentId: pi.id, paymentId: payment.id, jobId: String(jobId),
                  expectedMinor, receivedMinor,
                  paymentCurrency: payment.currency, piCurrency: pi.currency,
                },
              });
              return null;
            }
            // Credit backstop (mirrors amount_capturable_updated,
            // P3-789/P3-889): the referral-credit deduction is idempotent
            // per payment, so this is a no-op when intent creation already
            // posted it, and closes the gap when it did not.
            const meta = typeof payment.metadata === 'string'
              ? JSON.parse(payment.metadata || '{}')
              : (payment.metadata || {});
            const appliedCents = Number(meta?.applied_credit_cents ?? meta?.appliedCreditCents ?? 0);
            if (appliedCents > 0) {
              await creditLedger.applyCreditToPayment(client, {
                userId: payment.payer_id,
                paymentId: payment.id,
                amountCents: appliedCents,
                jobId,
                paymentIntentId: pi.id,
              });
            }
            await client.query(
              `UPDATE payments SET status = 'captured', payment_hold_status = 'released',
                captured_at = NOW(), released_at = NOW(), updated_at = NOW()
               WHERE id = $1`,
              [payment.id]
            );
            // Mark job escrow released in the same transaction: the capture
            // mark and the escrow release commit or roll back together.
            await client.query(
              `UPDATE jobs SET escrow_status = 'released', updated_at = NOW() WHERE id = $1`,
              [jobId]
            );
            logger.info(`[Stripe] PaymentIntent ${pi.id} captured - funds released for job ${jobId}`);
            return payment;
          }, 'tier3_capture_webhook');
          // Notify helper that payment has been released
          const helperId = pi.metadata?.helper_id;
          if (helperId && capturedPayment) {
            const amountDollars = ((pi.amount_received || pi.amount) / 100).toFixed(2);
            sendNotification({
              userId: helperId,
              type: 'payment_released',
              data: { job_id: jobId, amount: amountDollars },
              action_url: `/jobs/${jobId}`,
              idempotencyKey: `payment-released:${pi.id}:${jobId}:${helperId}`,
            }).catch(e => logger.warn('Failed to send payment released notification', { error: e.message }));
          }
          const payerId = pi.metadata?.client_id || pi.metadata?.payer_id;
          const receiptUserId = capturedPayment?.payer_id || payerId;
          if (receiptUserId && capturedPayment) {
            sendNotification({
              userId: receiptUserId,
              type: 'payment_receipt',
              data: {
                job_id: jobId,
                payment_intent_id: pi.id,
                amount: ((pi.amount_received || pi.amount || 0) / 100).toFixed(2),
                currency: String(pi.currency || 'usd').toUpperCase(),
              },
              action_url: `/jobs/${jobId}`,
              idempotencyKey: `payment-receipt:${pi.id}`,
            }).catch(e => logger.warn('Failed to send payment receipt notification', { error: e.message }));
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
        // Booking-request deposits (P3-962): settle even if the native
        // client never confirms.
        if (await bookingDeposits.applyBookingIntentWebhook(event.type, event.data.object)) break;
        // OxSteed Credit top-up (fiat money IN) that did not go through.
        if (await topupService.applyCreditTopupWebhookEvent({ type: event.type, object: event.data.object })) {
          break;
        }
        // Restaurant customer top-up (fiat money IN, migration 663) that did
        // not go through.
        if (await restaurantTopupService.applyRestaurantTopupWebhookEvent({ type: event.type, object: event.data.object })) {
          break;
        }
        // Authorization or capture failed.
        const pi = event.data.object;
        // A declined change-order re-authorization leaves the original
        // authorization untouched; the customer can retry.
        if (await jobPaymentReauth.applyReauthorizationWebhook(event.type, pi)) break;
        if (await paymentRailWebhooks.applyTipIntent(event.type, pi)) break;
        const jobId = pi.metadata?.job_id;
        const failureMsg = pi.last_payment_error?.message || 'Payment failed';
        let foodOrderId = extractFoodOrderId(pi.metadata);
        if (!foodOrderId && !jobId && pi?.id) {
          // Same fallback as payment_intent.succeeded: reconcile via the
          // intent id recorded on the order when metadata lacks the order id.
          const { rows: orderRows } = await db.query(
            `SELECT id FROM food_orders WHERE stripe_payment_intent_id = $1 LIMIT 1`,
            [pi.id]
          );
          foodOrderId = orderRows[0]?.id || null;
        }
        if (foodOrderId) {
          let failedFoodOrder = null;
          await withTransaction(db, async (client) => {
            const updated = await applyFoodOrderPaymentState(client, {
              orderId: foodOrderId,
              paymentStatus: 'failed',
              stripePaymentIntentId: pi.id,
            });
            // Release the inventory reservation so a failed card payment does
            // not hold stock. Best-effort: never fail the webhook on it.
            if (updated) {
              failedFoodOrder = updated;
              try {
                await releaseInventoryForOrder(client, {
                  restaurantId: updated.restaurant_id,
                  orderId: updated.id,
                });
              } catch (releaseErr) {
                logger.warn('[Stripe] failed to release inventory after failed food payment', {
                  orderId: updated.id,
                  error: releaseErr.message,
                });
              }
            }
          });
          if (failedFoodOrder?.customer_id) {
            await sendNotification({
              userId: failedFoodOrder.customer_id,
              type: 'payment_failed',
              data: { food_order_id: String(failedFoodOrder.id), payment_intent_id: pi.id },
              action_url: `/food/orders/${failedFoodOrder.id}`,
              idempotencyKey: `stripe:food-order-payment-failed:${pi.id}:${failedFoodOrder.id}`,
            }).catch((e) => logger.warn('Failed to send food order payment failed notification', { error: e.message }));
          }
        } else if (jobId) {
          const endedPayments = await withTransaction(db, async (client) => {
            const { rows: endedPayments } = await client.query(
              `UPDATE payments SET status = 'failed', payment_hold_status = 'none',
               updated_at = NOW() WHERE stripe_payment_intent_id = $1 AND status <> 'captured'
               RETURNING id`,
              [pi.id]
            );
            // Return any referral credit reserved for this intent (P2-571).
            for (const row of endedPayments) {
              await creditLedger.releaseCreditForPayment(client, { paymentId: row.id, reason: 'payment_intent_failed' });
            }
            return endedPayments;
          });
          // Re-open escrow on the job so client can retry (unless this intent
          // no longer backs the job's payment).
          if (endedPayments.length !== 0) await db.query(
            `UPDATE jobs SET escrow_status = 'none', updated_at = NOW() WHERE id = $1`,
            [jobId]
          );
          logger.warn(`[Stripe] PaymentIntent ${pi.id} failed for job ${jobId}: ${failureMsg}`);
          // Notify customer to retry
          const clientId = pi.metadata?.client_id;
          if (clientId) {
            await sendNotification({
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
        // Booking-request deposits (P3-962): settle even if the native
        // client never confirms.
        if (await bookingDeposits.applyBookingIntentWebhook(event.type, event.data.object)) break;
        // OxSteed Credit top-up (fiat money IN) that was canceled.
        if (await topupService.applyCreditTopupWebhookEvent({ type: event.type, object: event.data.object })) {
          break;
        }
        // Restaurant customer top-up (fiat money IN, migration 663) that was
        // canceled.
        if (await restaurantTopupService.applyRestaurantTopupWebhookEvent({ type: event.type, object: event.data.object })) {
          break;
        }
        if (await require('../services/consultingPaymentService')
          .applyConsultingPaymentWebhookEvent({ type: event.type, object: event.data.object })) {
          break;
        }
        const pi = event.data.object;
        if (await jobPaymentReauth.applyReauthorizationWebhook(event.type, pi)) break;
        if (await paymentRailWebhooks.applyTipIntent(event.type, pi)) break;
        await withTransaction(db, (client) => applyStripePaymentIntent(client, pi));
        // Audit fix: clear job escrow on cancel, same as payment_failed.
        // Otherwise the job stays in escrow with no payment behind it.
        const jobId = pi.metadata?.job_id;
        if (jobId) {
          const endedPayments = await withTransaction(db, async (client) => {
            const { rows: endedPayments } = await client.query(
              `UPDATE payments SET status = 'canceled', payment_hold_status = 'none',
               updated_at = NOW() WHERE stripe_payment_intent_id = $1 AND status <> 'captured'
               RETURNING id`,
              [pi.id]
            );
            // Return any referral credit reserved for this intent (P2-571).
            for (const row of endedPayments) {
              await creditLedger.releaseCreditForPayment(client, { paymentId: row.id, reason: 'payment_intent_canceled' });
            }
            return endedPayments;
          });
          // An intent superseded by a change-order re-authorization no longer
          // backs any payment row: the job's escrow is still funded.
          if (endedPayments.length !== 0) {
            await db.query(
              `UPDATE jobs SET escrow_status = 'none', updated_at = NOW() WHERE id = $1`,
              [jobId]
            );
          }
        }
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
        const piId = stripeObjectId(charge.payment_intent);
        const refundedCents = verifiedChargeRefundTotal(charge);
        const foodOrderId = extractFoodOrderId(charge.metadata);
        if (piId) {
          await withTransaction(db, client => applyChargeRefund(client, charge));
          logger.info(`[Stripe] Charge refunded for PaymentIntent ${piId}`);
        }
        if (foodOrderId && refundedCents === Number(charge.amount)) {
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

      case 'charge.dispute.created': {
        // Cardholder opened a dispute: open a fraud case for investigation.
        // Fraud-case bookkeeping must not fail the webhook itself.
        const dispute = event.data.object;
        try {
          await recordChargeDisputeCase(dispute, event.account);
        } catch (err) {
          logger.error('[Stripe] Failed to record charge dispute fraud case', {
            disputeId: dispute?.id,
            error: err.message,
          });
        }
        // Phase 8: OxSteed Credit chargeback ingestion. Runs after the
        // legacy fraud-case bookkeeping and never disturbs it: it only
        // touches disputes whose PaymentIntent backs a credit top-up, and a
        // throw here marks the webhook failed so Stripe retries (the
        // ingestion is idempotent on the Stripe dispute id).
        await ingestStripeChargeback({ eventType: event.type, dispute });
        // P3-814: track the evidence deadline and stage evidence at Stripe.
        // A throw marks the webhook failed so Stripe retries (idempotent on
        // the dispute id).
        await chargebackEvidence.handleDisputeWebhook(dispute, event.account || null);
        break;
      }

      case 'charge.dispute.closed':
      case 'charge.dispute.updated': {
        // Dispute status changed (e.g. evidence submitted, won/lost).
        // recordChargeDisputeCase dedupes on the dispute id and merges the
        // latest evidence into the existing case instead of duplicating it.
        const dispute = event.data.object;
        try {
          await recordChargeDisputeCase(dispute, event.account);
        } catch (err) {
          logger.error('[Stripe] Failed to update charge dispute fraud case', {
            disputeId: dispute?.id,
            error: err.message,
          });
        }
        // C8: a lost dispute moves real money. Record the financial impact
        // (payment marked disputed, loss posted to the ledger) on closed.
        if (event.type === 'charge.dispute.closed' && dispute?.status === 'lost') {
          try {
            await recordLostDisputeFinancials(dispute, event.account);
          } catch (err) {
            logger.error('[Stripe] Failed to record lost-dispute financials', {
              disputeId: dispute?.id,
              error: err.message,
            });
          }
        }
        // Phase 8: OxSteed Credit chargeback ingestion (see
        // charge.dispute.created above for the contract).
        await ingestStripeChargeback({ eventType: event.type, dispute });
        await chargebackEvidence.upsertFromStripe(dispute, event.account || null);
        break;
      }

      case 'transfer.created':
      case 'transfer.updated':
      case 'transfer.reversed': {
        const restaurantPayout = await restaurantPayoutService.applyTransferWebhookEvent({
          eventType: event.type,
          transfer: event.data.object,
        });
        if (restaurantPayout?.status) break;
        // OxSteed Credit settlement payouts (fiat money OUT). Builder B's
        // confirm/fail functions in oxsteedCreditAdminService reconcile
        // payout_status against the Stripe transfer. Events without our
        // settlement metadata are not ours.
        const handled = await topupService.applyCreditTopupWebhookEvent({ type: event.type, object: event.data.object });
        if (!handled) {
          logger.info(`Unhandled Stripe event: ${event.type}`);
        }
        break;
      }

      // Review P3-1-F16: instant payouts are created on the connected account;
      // these events reconcile the local instant_payouts row as Stripe settles.
      case 'payout.created':
      case 'payout.updated':
      case 'payout.paid':
      case 'payout.failed':
      case 'payout.canceled': {
        await applyInstantPayoutWebhookEvent(event);
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
}
exports.handleVerifiedStripeEvent = handleVerifiedStripeEvent;

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

function diditTimestampMatchesPayload(body, timestamp) {
  const headerSeconds = parseDiditEventCreated({ timestamp });
  const payloadSeconds = parseDiditEventCreated(body);
  return headerSeconds !== null && payloadSeconds !== null
    && Math.abs(headerSeconds - payloadSeconds) <= 1;
}

async function beginDiditWebhookEvent(body) {
  const eventId = body.event_id || body.id;
  if (!eventId) return { shouldProcess: true, receiptId: null };

  const eventType = String(body.webhook_type || body.type || 'didit.verification');
  const eventCreated = parseDiditEventCreated(body);
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

  if (rows.length === 0) {
    return { shouldProcess: false, receiptId: null, inFlight: await receiptInFlight('didit', eventId) };
  }
  const receiptId = rows[0].id;

  // Review P3-892: a delayed/retried older verdict must not overwrite a newer
  // one for the same session. Same watermark rule as Stripe events.
  const sessionId = body.session_id ? String(body.session_id) : null;
  if (!sessionId || eventCreated === null) return { shouldProcess: true, receiptId };
  const { rows: watermarkRows } = await db.query(
    `INSERT INTO webhook_event_watermarks
       (provider, object_type, object_id, event_created, event_id)
     VALUES ('didit', 'session', $1, $2, $3)
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
    [sessionId, eventCreated, String(eventId)]
  );
  if (watermarkRows.length > 0) return { shouldProcess: true, receiptId };
  await db.query(
    `UPDATE webhook_event_receipts
        SET status = 'processed', processed_at = NOW(), last_seen_at = NOW(),
            last_error = 'stale_event_skipped'
      WHERE id = $1`,
    [receiptId]
  );
  logger.info('Skipping stale Didit verdict', { eventId: String(eventId), sessionId });
  return { shouldProcess: false, stale: true, receiptId };
}

function parseDiditEventCreated(body) {
  for (const raw of [body?.created_at, body?.timestamp]) {
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      // Accept seconds or milliseconds; normalise to seconds.
      return Math.floor(n > 1e12 ? n / 1000 : n);
    }
    const ms = Date.parse(String(raw));
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return null;
}
exports._parseDiditEventCreated = parseDiditEventCreated;
exports._diditTimestampMatchesPayload = diditTimestampMatchesPayload;
exports._beginDiditWebhookEvent = (body) => beginDiditWebhookEvent(body);

// Didit identity webhook handler (v3 API)
// P1-331: the live webhook now anchors approvals to the entity ID with a
// provider='didit', status='verified' identity_verifications row, which is
// what the credit rail's Didit auto-pass looks for. Best-effort; the users
// row stays the source of truth.
async function anchorDiditVerified(userId, sessionId, identityHash) {
  const personPublicId = await diditEntityLink.linkVerificationToEntity(userId, {
    sessionId, identityHash, status: 'verified',
  });
  if (personPublicId) await diditEntityLink.markHelperIdentityVerified(userId);
}

exports.diditWebhook = async (req, res, next) => {
  let receiptId = null;
  // Hoisted so the catch block can log the inner error with webhook context
  // (event type, event id, verification session reference) instead of only
  // the generic wrapper message.
  let body = null;
  try {
    const secret = process.env.DIDIT_WEBHOOK_SECRET;
    if (!secret) {
      logger.error('[Didit] DIDIT_WEBHOOK_SECRET not set');
      return res.status(500).json({ error: 'Webhook not configured', code: 'webhook_not_configured' });
    }

    // Parse body from raw Buffer
    let rawBody;
    try {
      rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      body = typeof req.body === 'object' && !(req.body instanceof Buffer) ? req.body : JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON', code: 'invalid_json' });
    }
    // A JSON literal (null, string, number) parses fine but is not a webhook
    // payload: reject it as malformed instead of throwing a TypeError later.
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON', code: 'invalid_json' });
    }

  // Get signature headers (Express lowercases them)
  const signatureV2 = req.headers['x-signature-v2'];
  const signatureSimple = req.headers['x-signature-simple'];
  const signatureOriginal = req.headers['x-signature'];
  const timestamp = diditTimestamp(req, body);

  // The freshness value must be covered by the signed payload. A fresh
  // header paired with a separately signed stale body is a replay vector.
  if (!diditTimestampMatchesPayload(body, timestamp)) {
    logger.warn('[Didit] Webhook timestamp is not bound to the signed payload');
    return res.status(401).json({ error: 'Invalid signature', code: 'invalid_webhook_signature' });
  }

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
    if (!event.shouldProcess && event.inFlight) {
      logger.warn('[Didit] Webhook still in flight; asking the provider to retry', { eventId: body.event_id || body.id });
      return respondInFlight(res);
    }
    if (!event.shouldProcess) {
      logger.info('[Didit] Duplicate webhook ignored', { eventId: body.event_id || body.id });
      return res.json({ received: true, duplicate: !event.stale, stale: Boolean(event.stale) });
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
        // P1-333: write values allowed by chk_iv_status (migration 671).
        `UPDATE identity_verifications
         SET status = 'verified',
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
          await anchorDiditVerified(userId, session_id, null);
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
            // P1-332: record the duplicate_of link on the entity graph.
            await diditEntityLink.linkDuplicateIdentity({
              userId, canonicalUserId: existing[0].id, sessionId: session_id, identityHash,
            });
          } else {
            // The duplicate check above is not atomic: a concurrent approval
            // for the same identity can win the race and trip the unique index
            // on users.didit_identity_hash. Treat a unique violation as a
            // duplicate instead of letting it surface as a 500.
            let verified = false;
            try {
              await db.query(
                `UPDATE users
                 SET identity_verified = TRUE,
                     didit_identity_hash = $1,
                     didit_verified_at = NOW(),
                     didit_status = 'verified'
                 WHERE id = $2`,
                [identityHash, userId]
              );
              verified = true;
            } catch (updateErr) {
              if (updateErr && updateErr.code === '23505') {
                await db.query(
                  `UPDATE users SET didit_status = 'duplicate' WHERE id = $1`,
                  [userId]
                );
                logger.warn('[Didit] Duplicate identity detected (concurrent approval)', { userId });
                const { rows: canon } = await db.query(
                  `SELECT id FROM users WHERE didit_identity_hash = $1 AND id != $2 LIMIT 1`,
                  [identityHash, userId]
                );
                await diditEntityLink.linkDuplicateIdentity({
                  userId, canonicalUserId: canon[0]?.id || null, sessionId: session_id, identityHash,
                });
              } else {
                throw updateErr;
              }
            }
            if (verified) {
              await anchorDiditVerified(userId, session_id, identityHash);
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
          await anchorDiditVerified(userId, session_id, null);
          logger.info('[Didit] Identity approved (via didit_session_id fallback)', { userId });
        } else {
          logger.warn('[Didit] No user found for session', { session_id });
        }
      }
    } else if (normalizedStatus === 'declined') {
      // Didit documents warnings as an array of strings, but guard anyway:
      // calling .join on a non-array value would throw a TypeError into the
      // 500 path and hide behind the generic wrapper error.
      const warnings = Array.isArray(idVerification.warnings)
        ? idVerification.warnings.join(', ')
        : '';
      const reason = warnings
        || body.reason
        || 'Verification declined';
      await db.query(
        `UPDATE identity_verifications
         SET status = 'failed', last_error = $1, updated_at = NOW()
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
        await diditEntityLink.linkVerificationToEntity(rows[0].user_id, { sessionId: session_id, status: 'failed' });
      } else {
        // Fallback: check users table directly
        const { rows: failedUsers } = await db.query(
          `UPDATE users SET didit_status = 'failed' WHERE didit_session_id = $1 RETURNING id`,
          [session_id]
        );
        for (const u of failedUsers || []) {
          await diditEntityLink.linkVerificationToEntity(u.id, { sessionId: session_id, status: 'failed' });
        }
      }
    } else {
      // Unknown statuses (including future Didit event types) are logged and
      // acknowledged, never thrown: a throw here would fail every new event
      // type Didit starts sending.
      logger.info('[Didit] Unhandled status', {
        status,
        eventType: body.webhook_type || body.type,
        providerRefId: session_id,
      });
    }

    await markWebhookEventProcessed(receiptId);
    res.json({ received: true });
  } catch (err) {
    await markWebhookEventFailed(receiptId, err).catch(() => {});
    // Log the inner error with its stack and the webhook context (not just the
    // generic wrapper message) so the next Sentry occurrence is diagnosable.
    // providerRefId is the Didit verification session reference; the key name
    // avoids the logger's substring redaction rule for 'session'.
    logger.error('[Didit] Webhook handler failed', {
      error: err?.message || String(err),
      stack: err?.stack,
      eventType: body?.webhook_type || body?.type || undefined,
      eventId: body?.event_id || body?.id || undefined,
      providerRefId: body?.session_id,
      receiptId,
    });
    if (typeof next === 'function') {
      return next(new AppError('Webhook processing failed', 500, 'webhook_processing_error'));
    }
    return res.status(500).json({ error: 'Webhook processing failed', code: 'webhook_processing_error' });
  }
};

exports.canonicalizeDiditPayload = (body) => stableStringify(shortenFloats(body));
exports.verifyDiditSignatureV2 = (body, signature, timestamp, secret) =>
  verifySignatureV2(body, signature, timestamp, secret);

// Review P3-890: an unpaid/expired Checkout session marks its food order
// failed and its QR payment failed/expired, but only while still unpaid.
async function applyCheckoutSessionNotPaid(session, outcome) {
  if (!session?.id) return { food: 0, qr: 0 };
  let food = 0;
  const foodOrderId = extractFoodOrderId(session.metadata);
  if (foodOrderId) {
    await withTransaction(db, async (client) => {
      const { rows } = await client.query(
        `UPDATE food_orders
            SET payment_status = 'failed', updated_at = NOW()
          WHERE id = $1::bigint AND payment_status IN ('unpaid', 'requires_payment')
          RETURNING *`,
        [foodOrderId]
      );
      food = rows.length;
      if (rows[0]) emitFoodOrderUpdate(rows[0]);
    });
  }
  const { rowCount: qr } = await db.query(
    `UPDATE qr_payments SET status = $2
      WHERE stripe_checkout_session_id = $1 AND status = 'pending'`,
    [session.id, outcome === 'failed' ? 'failed' : 'expired']
  );
  return { food, qr };
}
exports.applyCheckoutSessionNotPaid = applyCheckoutSessionNotPaid;

// Marks a QR scan-to-pay checkout as succeeded.
// Idempotent: only flips rows that have not already succeeded, so duplicate
// webhook deliveries and replays are safe.
async function applyQrPaymentSucceeded(session) {
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || null;
  // H14 completion: a QR payment is marked succeeded only when the Stripe
  // session is actually paid AND the paid amount matches what we recorded.
  // Unpaid or amount-mismatched sessions are never marked succeeded.
  if (session.payment_status !== 'paid') {
    logger.warn('[webhook] QR payment session not paid; not marking succeeded', {
      sessionId: session.id, paymentStatus: session.payment_status,
    });
    return 0;
  }
  const { rows: updatedQr = [], rowCount } = await db.query(
    `UPDATE qr_payments
        SET status = 'succeeded',
            succeeded_at = NOW(),
            stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id)
      WHERE stripe_checkout_session_id = $1
        AND status <> 'succeeded'
        AND amount_cents = $3
      RETURNING id, qr_code_id, amount_cents`,
    [session.id, paymentIntentId, session.amount_total]
  );
  if (rowCount === 0) {
    logger.warn('[webhook] QR payment amount mismatch or already succeeded; not marking succeeded', {
      sessionId: session.id, amountTotal: session.amount_total,
    });
  }
  // P1-301: tell the payee. Only the transition that flipped the row
  // notifies, and the idempotency key makes replays a no-op.
  for (const row of updatedQr) {
    await require('../services/qrPaymentNotifications').notifyQrPayee(row).catch((err) => {
      logger.warn('[webhook] QR payee notification failed', { qrPaymentId: row.id, error: err.message });
    });
  }
  return rowCount;
}
exports.applyQrPaymentSucceeded = applyQrPaymentSucceeded;

// Closes a pending QR payment whose Checkout Session expired or whose async
// payment failed. Never touches a row that already succeeded.
async function applyQrPaymentClosed(session, status) {
  const { rowCount } = await db.query(
    `UPDATE qr_payments SET status = $2
      WHERE stripe_checkout_session_id = $1 AND status = 'pending'`,
    [session.id, status]
  );
  return rowCount;
}
exports.applyQrPaymentClosed = applyQrPaymentClosed;

// Review P3-1-F16: reconcile the local instant_payouts row against the
// payout.* lifecycle events from the connected account. Never resurrect a
// terminal row (paid/failed/canceled); a failed payout records Stripe's
// failure message for support.
async function applyInstantPayoutWebhookEvent(event) {
  const payout = event.data?.object || {};
  const stripePayoutId = payout.id;
  if (!stripePayoutId) {
    logger.warn('[webhook] payout event without payout id; ignoring', { eventId: event.id, eventType: event.type });
    return 0;
  }
  const status = String(payout.status || '').toLowerCase();
  const localStatus = ['paid', 'failed', 'canceled', 'in_transit'].includes(status) ? status : 'pending';
  const { rowCount } = await db.query(
    `UPDATE instant_payouts
        SET status = $2,
            failure_message = CASE WHEN $2 = 'failed' THEN COALESCE($3, failure_message) ELSE failure_message END,
            updated_at = NOW()
      WHERE stripe_payout_id = $1
        AND status NOT IN ('paid', 'failed', 'canceled')
      RETURNING id`,
    [stripePayoutId, localStatus, payout.failure_message ? String(payout.failure_message).slice(0, 500) : null]
  );
  if (rowCount === 0) {
    logger.info('[webhook] payout event for unknown or terminal instant payout; ignoring', {
      eventId: event.id, eventType: event.type, stripePayoutId, account: event.account || null,
    });
  }
  return rowCount;
}
exports.applyInstantPayoutWebhookEvent = applyInstantPayoutWebhookEvent;

async function handleConnectedCheckoutEvent(event) {
  const session = event.data?.object || {};
  if (session.metadata?.qr_payment !== 'true') {
    logger.info('[webhook] Ignoring non-QR connected-account checkout event', { eventId: event.id, eventType: event.type });
    return 'ignored';
  }
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await applyQrPaymentSucceeded(session);
      return 'succeeded';
    case 'checkout.session.async_payment_failed':
      await applyQrPaymentClosed(session, 'failed');
      return 'failed';
    case 'checkout.session.expired':
      await applyQrPaymentClosed(session, 'expired');
      return 'expired';
    default:
      return 'ignored';
  }
}
exports.handleConnectedCheckoutEvent = handleConnectedCheckoutEvent;
// Test seam: exported so the lost-dispute financial path can be unit-tested.
exports.recordLostDisputeFinancials = recordLostDisputeFinancials;
