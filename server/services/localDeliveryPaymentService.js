'use strict';

const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');

const SOURCE = 'local_delivery_v1';
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const objectId = value => typeof value === 'string' ? value : value?.id || null;
const fail = (message, code = 'delivery_payment_conflict', status = 409) => {
  throw new AppError(message, status, code);
};
const cents = value => {
  if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0 || Number(value) > 99999999) {
    fail('Invalid approved payment amount', 'delivery_payment_amount_invalid');
  }
  return Number(value);
};

/**
 * Controller contract (pass authenticated identities, never request-body roles):
 * createBaseCheckout({ deliveryJobId, customerUserId })
 * createExtraCheckout({ extraId, customerUserId })
 * syncPayment({ paymentId, customerUserId })
 * refundPayment({ paymentId, actor: req.user, targetRefundedAmountCents, reason })
 *   Target is cumulative refunded cents, NOT a new refund increment; omit for full.
 * All return { payment, checkoutUrl }; refunds also return refundId/refundStatus.
 * Do not wrap these calls in a controller transaction: reservations must COMMIT
 * before Stripe calls. Caller amounts, URLs and idempotency keys are not accepted.
 * handleStripeEvent({ type, data: { object }, account }) is for verified webhooks
 * and the trusted payment worker only. It returns { handled: false } for others.
 *
 * Rail: platform Stripe Checkout + existing stripeService.issueRefund + existing
 * immutable platform_ledger. This is collection, not marketplace job escrow or
 * helper payout: those services require jobs UUIDs, not delivery BIGINT IDs.
 * USD only until delivery pricing supports other currency minor-unit rules.
 */
function createService({ db = pool, getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) fail('Payment processing is unavailable', 'stripe_not_configured', 503);
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}, issueRefund = (...args) => require('./stripeService').issueRefund(...args),
now = () => Date.now(), appUrl = () => process.env.APP_URL || process.env.CLIENT_URL,
paymentsEnabled = () => /^(true|1)$/i.test(process.env.FEATURE_PAYMENTS_ENABLED || '') } = {}) {
  const tx = operation => withTransaction(db, operation, 'local_delivery_payment');

  function metadata(payment, generation) {
    return {
      source: SOURCE, deliveryPaymentId: String(payment.id),
      deliveryJobId: String(payment.delivery_job_id),
      deliveryExtraId: payment.delivery_extra_id == null ? '' : String(payment.delivery_extra_id),
      customerUserId: String(payment.customer_user_id),
      amountCents: String(payment.amount_cents), currency: payment.currency.toLowerCase(),
      generation: String(generation),
    };
  }

  function verifyMetadata(actual, expected) {
    if (Object.entries(expected).some(([key, value]) => actual?.[key] !== value)) {
      fail('Payment metadata does not match the reserved obligation', 'delivery_payment_verification_failed');
    }
  }

  function retrySafe(createdAt) {
    const age = now() - new Date(createdAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age >= RETRY_WINDOW_MS) {
      fail('Uncertain provider result requires reconciliation before retry', 'delivery_payment_reconciliation_required');
    }
  }

  function publicResult(payment, session = null) {
    return { payment: {
      id: payment.id, delivery_job_id: payment.delivery_job_id,
      delivery_extra_id: payment.delivery_extra_id, amount_cents: payment.amount_cents,
      currency: payment.currency, status: payment.status,
      refunded_amount_cents: payment.refunded_amount_cents,
      receipt_url: payment.receipt_url || null,
      created_at: payment.created_at, updated_at: payment.updated_at,
    }, checkoutUrl: session?.status === 'open' && !payment.captured_at ? session.url || null : null };
  }

  async function lockedPayment(client, paymentId, customerUserId) {
    const { rows: [found] } = await client.query('SELECT * FROM delivery_payments WHERE id = $1', [paymentId]);
    if (!found || (customerUserId !== undefined && String(found.customer_user_id) !== String(customerUserId))) {
      fail('Delivery payment not found', 'delivery_payment_not_found', 404);
    }
    // Consistent lock order across checkout, sync, refunds and webhooks.
    await client.query('SELECT id FROM delivery_jobs WHERE id = $1 FOR UPDATE', [found.delivery_job_id]);
    const { rows: [payment] } = await client.query('SELECT * FROM delivery_payments WHERE id = $1 FOR UPDATE', [paymentId]);
    if (payment?.service_version !== 1) fail('Legacy payment requires reconciliation', 'delivery_payment_reconciliation_required');
    return payment;
  }

  async function latestAttempt(client, paymentId) {
    const { rows: [attempt] } = await client.query(
      'SELECT * FROM delivery_payment_attempts WHERE payment_id = $1 ORDER BY generation DESC LIMIT 1', [paymentId]);
    return attempt;
  }

  async function ledger(client, payment, key, amount, sourceType, chargeId) {
    await client.query(
      `INSERT INTO platform_ledger
       (source_type, amount_cents, currency, user_id, stripe_payment_intent_id, stripe_charge_id, description, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [sourceType, amount, payment.currency.toLowerCase(), payment.customer_user_id,
        payment.payment_intent_id, chargeId, `Delivery ${payment.delivery_job_id} ${sourceType}`,
        JSON.stringify({ deliveryLedgerKey: key, deliveryPaymentId: String(payment.id),
          deliveryJobId: String(payment.delivery_job_id), deliveryExtraId: payment.delivery_extra_id,
          currency: payment.currency, grossCollection: true })]);
  }

  async function reconcile(client, payment, attempt, session) {
    const expected = metadata(payment, attempt.generation);
    verifyMetadata(session.metadata, expected);
    if (!session.id || (attempt.checkout_session_id && session.id !== attempt.checkout_session_id)
      || session.mode !== 'payment' || session.client_reference_id !== String(payment.id)
      || session.amount_total !== Number(payment.amount_cents)
      || session.currency !== payment.currency.toLowerCase()
      || !['open', 'complete', 'expired'].includes(session.status)) {
      fail('Checkout identity, amount or currency mismatch', 'delivery_payment_verification_failed');
    }
    let intent = session.payment_intent;
    if (typeof intent === 'string') intent = await getStripe().paymentIntents.retrieve(intent, { expand: ['latest_charge'] });
    const intentId = objectId(intent);
    if ((payment.payment_intent_id && intentId !== payment.payment_intent_id)
      || (attempt.payment_intent_id && intentId !== attempt.payment_intent_id)) {
      fail('Payment intent identity mismatch', 'delivery_payment_verification_failed');
    }
    if (intentId) {
      verifyMetadata(intent.metadata, expected);
      if (intent.amount !== Number(payment.amount_cents) || intent.currency !== session.currency) {
        fail('Payment intent amount or currency mismatch', 'delivery_payment_verification_failed');
      }
    }
    let charge = intent?.latest_charge;
    if (typeof charge === 'string') charge = await getStripe().charges.retrieve(charge);
    const paid = session.status === 'complete' && session.payment_status === 'paid' && intent?.status === 'succeeded';
    let refunded = Number(payment.refunded_amount_cents || 0);
    if (paid) {
      if (intent.amount_received !== Number(payment.amount_cents) || !charge?.id
        || objectId(charge.payment_intent) !== intentId || charge.amount !== Number(payment.amount_cents)
        || charge.currency !== session.currency || charge.paid !== true || charge.captured !== true
        || (payment.charge_id && payment.charge_id !== charge.id)
        || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0
        || charge.amount_refunded > Number(payment.amount_cents)) {
        fail('Captured charge verification failed', 'delivery_payment_verification_failed');
      }
      payment.payment_intent_id = intentId;
      if (!payment.captured_at) {
        await ledger(client, payment, `delivery:${payment.id}:capture`, Number(payment.amount_cents), 'delivery_payment', charge.id);
      }
      const nextRefunded = Math.max(refunded, charge.amount_refunded);
      if (nextRefunded > refunded) {
        await ledger(client, payment, `delivery:${payment.id}:refund:${nextRefunded}`, refunded - nextRefunded, 'refund', charge.id);
      }
      refunded = nextRefunded;
    } else if (session.payment_status === 'paid' || intent?.status === 'succeeded') {
      // A partial provider snapshot is not sufficient evidence of settlement.
      fail('Checkout settlement is not yet consistent', 'delivery_payment_verification_failed');
    }
    const status = refunded === Number(payment.amount_cents) ? 'refunded'
      : paid || payment.captured_at ? 'paid'
        : session.status === 'expired' ? 'cancelled'
          : intent?.last_payment_error ? 'failed' : 'pending';
    await client.query(
      `UPDATE delivery_payment_attempts SET checkout_session_id = $2,
       payment_intent_id = COALESCE($3, payment_intent_id), status = $4 WHERE id = $1`,
      [attempt.id, session.id, intentId, session.status]);
    const { rows: [updated] } = await client.query(
      `UPDATE delivery_payments SET status = $2, checkout_session_id = $3,
       payment_intent_id = COALESCE($4, payment_intent_id), charge_id = COALESCE($5, charge_id),
       captured_at = CASE WHEN $6 THEN COALESCE(captured_at, NOW()) ELSE captured_at END,
       receipt_url = COALESCE($7, receipt_url), refunded_amount_cents = $8, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [payment.id, status, session.id, intentId, paid ? charge.id : null, paid,
        paid ? charge.receipt_url || null : null, refunded]);
    if (payment.delivery_extra_id != null) {
      await client.query(
        `UPDATE delivery_extras SET payment_status = $2, payment_intent_id = COALESCE($3, payment_intent_id)
         WHERE id = $1`,
        [payment.delivery_extra_id, status === 'refunded' ? 'refunded' : status === 'paid' ? 'captured'
          : status === 'failed' ? 'failed' : 'requires_action', intentId]);
    }
    return publicResult(updated, session);
  }

  async function retrieveAndReconcile(client, payment, attempt) {
    if (!attempt?.checkout_session_id) fail('Checkout creation needs recovery', 'delivery_payment_reconciliation_required');
    const session = await getStripe().checkout.sessions.retrieve(attempt.checkout_session_id,
      { expand: ['payment_intent.latest_charge'] });
    const result = await reconcile(client, payment, attempt, session);
    return { ...result, expired: session.status === 'expired' && !payment.captured_at };
  }

  async function reserveCheckout({ deliveryJobId, extraId = null, customerUserId }) {
    if (!customerUserId) fail('Authentication required', 'unauthorized', 401);
    if (!paymentsEnabled()) fail('Payments are disabled', 'feature_disabled', 503);
    return tx(async client => {
      const { rows: [job] } = await client.query('SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE', [deliveryJobId]);
      if (!job || String(job.customer_user_id) !== String(customerUserId)) fail('Delivery not found', 'delivery_not_found', 404);
      const { rows: payments } = await client.query(
        `SELECT * FROM delivery_payments WHERE delivery_job_id = $1
         AND delivery_extra_id IS NOT DISTINCT FROM $2::bigint ORDER BY id FOR UPDATE`, [job.id, extraId]);
      if (payments.some(p => p.service_version !== 1) || payments.length > 1) {
        fail('Existing payment requires reconciliation', 'delivery_payment_reconciliation_required');
      }
      let payment = payments[0];
      if (payment?.captured_at) return payment.id;
      if (['cancelled', 'failed', 'returned'].includes(job.status)) fail('Delivery is not payable');
      const { rows: [quote] } = await client.query('SELECT * FROM delivery_quotes WHERE id = $1', [job.quote_id]);
      if (!quote || String(quote.delivery_job_id) !== String(job.id) || !quote.accepted_at
        || String(quote.accepted_by_user_id) !== String(customerUserId)
        || Number(quote.customer_total_cents) !== Number(job.customer_total_cents)) {
        fail('An accepted delivery quote is required', 'delivery_payment_quote_required');
      }
      const currency = String(quote.currency || '').toUpperCase();
      if (currency !== 'USD') fail('Unsupported delivery currency', 'delivery_payment_currency_unsupported');
      let amount = cents(job.customer_total_cents);
      if (extraId != null) {
        const { rows: [extra] } = await client.query('SELECT * FROM delivery_extras WHERE id = $1 FOR UPDATE', [extraId]);
        if (!extra || String(extra.delivery_job_id) !== String(job.id) || extra.status !== 'approved'
          || String(extra.reviewed_by_user_id) !== String(customerUserId) || !extra.reviewed_at) {
          fail('Customer approval is required for this extra', 'delivery_extra_not_approved');
        }
        amount = cents(extra.approved_amount_cents);
        if (!payment && !['requires_action', 'failed'].includes(extra.payment_status)) fail('Extra is not payable');
      }
      if (payment && (Number(payment.amount_cents) !== amount || payment.currency !== currency)) {
        fail('Approved amount changed after checkout reservation', 'delivery_payment_amount_conflict');
      }
      if (!payment) {
        const key = `delivery:${job.id}:${extraId == null ? 'base' : `extra:${extraId}`}:v1`;
        const { rows } = await client.query(
          `INSERT INTO delivery_payments
           (delivery_job_id, delivery_extra_id, customer_user_id, amount_cents, currency, idempotency_key, service_version)
           VALUES ($1,$2,$3,$4,$5,$6,1) RETURNING *`, [job.id, extraId, customerUserId, amount, currency, key]);
        [payment] = rows;
      }
      const attempt = await latestAttempt(client, payment.id);
      if (attempt && attempt.status !== 'expired') return payment.id;
      const generation = Number(attempt?.generation || 0) + 1;
      const origin = new URL(appUrl()).origin;
      if (!/^https:\/\//.test(origin) && !(process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin))) {
        fail('Trusted application URL is required', 'delivery_payment_configuration_error', 503);
      }
      const meta = metadata(payment, generation);
      const request = {
        mode: 'payment', payment_method_types: ['card'], client_reference_id: String(payment.id),
        line_items: [{ price_data: { currency: currency.toLowerCase(),
          product_data: { name: extraId == null ? 'Local delivery' : 'Approved delivery extra' },
          unit_amount: amount }, quantity: 1 }],
        metadata: meta, payment_intent_data: { metadata: meta },
        success_url: `${origin}/delivery/jobs/${job.id}?payment=success`,
        cancel_url: `${origin}/delivery/jobs/${job.id}?payment=cancelled`,
      };
      await client.query(
        `INSERT INTO delivery_payment_attempts (payment_id, generation, idempotency_key, request_snapshot)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [payment.id, generation, `${payment.idempotency_key}:checkout:${generation}`, JSON.stringify(request)]);
      // A replacement is allowed only after retrieving a definitively expired,
      // unpaid session; historical session/intent IDs remain in the attempts table.
      if (attempt) await client.query(
        `UPDATE delivery_payments SET checkout_session_id = NULL, payment_intent_id = NULL,
         status = 'pending', updated_at = NOW() WHERE id = $1`, [payment.id]);
      return payment.id;
    });
  }

  async function executeCheckout(paymentId, customerUserId) {
    return tx(async client => {
      const payment = await lockedPayment(client, paymentId, customerUserId);
      const attempt = await latestAttempt(client, payment.id);
      if (attempt?.checkout_session_id) return retrieveAndReconcile(client, payment, attempt);
      if (!attempt || payment.captured_at) fail('Payment requires reconciliation', 'delivery_payment_reconciliation_required');
      // The reservation committed in an earlier transaction. Recheck approval
      // under the same job lock before any possible provider creation/replay.
      const { rows: [job] } = await client.query('SELECT * FROM delivery_jobs WHERE id = $1', [payment.delivery_job_id]);
      if (!job || ['cancelled', 'failed', 'returned'].includes(job.status)) fail('Delivery is not payable');
      if (payment.delivery_extra_id != null) {
        const { rows: [extra] } = await client.query('SELECT * FROM delivery_extras WHERE id = $1 FOR UPDATE', [payment.delivery_extra_id]);
        if (!extra || extra.status !== 'approved' || !extra.reviewed_at
          || String(extra.reviewed_by_user_id) !== String(payment.customer_user_id)
          || cents(extra.approved_amount_cents) !== Number(payment.amount_cents)) {
          fail('Extra approval changed before checkout', 'delivery_extra_not_approved');
        }
      } else if (Number(job.customer_total_cents) !== Number(payment.amount_cents)) {
        fail('Delivery amount changed before checkout', 'delivery_payment_amount_conflict');
      }
      retrySafe(attempt.created_at);
      const session = await getStripe().checkout.sessions.create(attempt.request_snapshot, { idempotencyKey: attempt.idempotency_key });
      return reconcile(client, payment, attempt, session);
    });
  }

  async function createCheckout(args) {
    const paymentId = await reserveCheckout(args);
    const result = await executeCheckout(paymentId, args.customerUserId);
    if (!result.expired) return result;
    return executeCheckout(await reserveCheckout(args), args.customerUserId);
  }

  async function createExtraCheckout({ extraId, customerUserId }) {
    const { rows: [extra] } = await db.query('SELECT delivery_job_id FROM delivery_extras WHERE id = $1', [extraId]);
    if (!extra) fail('Extra not found', 'delivery_extra_not_found', 404);
    return createCheckout({ deliveryJobId: extra.delivery_job_id, extraId, customerUserId });
  }

  async function syncPayment({ paymentId, customerUserId }) {
    if (!customerUserId) fail('Authentication required', 'unauthorized', 401);
    return tx(async client => {
      const payment = await lockedPayment(client, paymentId, customerUserId);
      return retrieveAndReconcile(client, payment, await latestAttempt(client, paymentId));
    });
  }

  async function refundPayment({ paymentId, actor, targetRefundedAmountCents, reason }) {
    if (!actor?.id || !['admin', 'super_admin'].includes(actor.role)) fail('Admin access required', 'forbidden', 403);
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) fail('Refund reason is required', 'invalid_refund_reason', 400);
    const reservation = await tx(async client => {
      const payment = await lockedPayment(client, paymentId);
      await retrieveAndReconcile(client, payment, await latestAttempt(client, paymentId));
      const { rows: [fresh] } = await client.query('SELECT * FROM delivery_payments WHERE id = $1', [paymentId]);
      const target = cents(targetRefundedAmountCents ?? fresh.amount_cents);
      if (!fresh.captured_at || target > Number(fresh.amount_cents)) fail('Invalid refund amount or payment state');
      if (target <= Number(fresh.refunded_amount_cents)) return { done: publicResult(fresh) };
      const { rows: requests } = await client.query(
        `SELECT * FROM delivery_payment_refunds WHERE payment_id = $1
         AND (target_refunded_cents = $2 OR status = 'pending') ORDER BY id FOR UPDATE`, [paymentId, target]);
      if (requests.some(r => Number(r.target_refunded_cents) !== target)) fail('Another refund is pending', 'delivery_refund_pending');
      if (requests[0]) return { refund: requests[0] };
      const { rows: [refund] } = await client.query(
        `INSERT INTO delivery_payment_refunds
         (payment_id, target_refunded_cents, amount_cents, idempotency_key, actor_user_id, reason)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [paymentId, target, target - Number(fresh.refunded_amount_cents),
          `delivery:${paymentId}:refund-total:${target}:v1`, actor.id, reason.trim()]);
      return { refund };
    });
    if (reservation.done) return reservation.done;
    return tx(async client => {
      const payment = await lockedPayment(client, paymentId);
      const { rows: [request] } = await client.query('SELECT * FROM delivery_payment_refunds WHERE id = $1 FOR UPDATE', [reservation.refund.id]);
      let refund;
      if (request.provider_refund_id) refund = await getStripe().refunds.retrieve(request.provider_refund_id);
      else {
        retrySafe(request.created_at);
        refund = await issueRefund(payment.payment_intent_id, Number(request.amount_cents), request.idempotency_key);
      }
      await applyRefundResponse(client, payment, request, refund);
      const result = await retrieveAndReconcile(client, payment, await latestAttempt(client, paymentId));
      return { ...result, refundId: refund.id, refundStatus: refund.status };
    });
  }

  async function applyRefundResponse(client, payment, request, refund) {
    if (!refund.id || objectId(refund.payment_intent) !== payment.payment_intent_id
      || refund.amount !== Number(request.amount_cents) || refund.currency !== payment.currency.toLowerCase()
      || (request.provider_refund_id && request.provider_refund_id !== refund.id)
      || !['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(refund.status)) {
      fail('Refund verification failed', 'delivery_payment_verification_failed');
    }
    await client.query(
      `UPDATE delivery_payment_refunds SET provider_refund_id = $2, status = $3 WHERE id = $1`,
      [request.id, refund.id, refund.status === 'requires_action' ? 'pending' : refund.status]);
  }

  async function handleStripeEvent(event) {
    const object = event?.data?.object;
    const relevant = /^(checkout\.session\.(completed|async_payment_succeeded|async_payment_failed|expired)|payment_intent\.(succeeded|payment_failed|canceled)|charge\.refunded|refund\.(created|updated|failed))$/.test(event?.type || '');
    if (!relevant || !object?.id) return { handled: false };
    let routeMetadata = object.metadata;
    let tagged = routeMetadata?.source === SOURCE;
    // Tagged objects can recover a session whose creation response was lost.
    // Untagged refunds are resolved only through a stored, unique provider ID.
    const sessionId = event.type.startsWith('checkout.') ? object.id : null;
    const intentId = event.type.startsWith('payment_intent.') ? object.id : objectId(object.payment_intent);
    if (!tagged && !intentId && !sessionId) return { handled: false };
    let { rows: [found] } = await db.query(
      `SELECT dp.id FROM delivery_payments dp
       LEFT JOIN delivery_payment_attempts a ON a.payment_id = dp.id
       WHERE dp.service_version = 1 AND (
         ($1::text IS NOT NULL AND a.checkout_session_id = $1) OR
         ($2::text IS NOT NULL AND (a.payment_intent_id = $2 OR dp.payment_intent_id = $2)) OR
         ($3::text IS NOT NULL AND dp.id::text = $3)) LIMIT 1`,
      [sessionId, intentId, tagged ? String(object.metadata.deliveryPaymentId || '') : null]);
    // Refund objects need not carry the PaymentIntent metadata, and refunds may
    // arrive before the checkout-completed event has bound the local intent ID.
    if (!found && !tagged && !event.account && intentId && /^(charge|refund)\./.test(event.type)) {
      const intent = await getStripe().paymentIntents.retrieve(intentId);
      if (intent.id !== intentId) fail('Unexpected intent identity', 'delivery_payment_verification_failed');
      routeMetadata = intent.metadata;
      tagged = routeMetadata?.source === SOURCE;
      if (tagged) {
        ({ rows: [found] } = await db.query(
          'SELECT id FROM delivery_payments WHERE service_version = 1 AND id::text = $1',
          [String(routeMetadata.deliveryPaymentId || '')]));
      }
    }
    if (!found) {
      if (tagged) fail('Delivery payment reservation not found', 'delivery_payment_reconciliation_required');
      return { handled: false };
    }
    if (event.account) fail('Delivery payment must belong to the platform account', 'delivery_payment_verification_failed');
    return tx(async client => {
      const payment = await lockedPayment(client, found.id);
      const attempt = await latestAttempt(client, found.id);
      if (!attempt) fail('Delivery payment attempt missing', 'delivery_payment_reconciliation_required');
      if (tagged) verifyMetadata(routeMetadata, metadata(payment, Number(routeMetadata.generation)));
      if (sessionId && attempt.checkout_session_id && sessionId !== attempt.checkout_session_id) {
        // Only a known, retired expired attempt may be ignored.
        const { rows: [old] } = await client.query(
          `SELECT id FROM delivery_payment_attempts WHERE payment_id = $1
           AND checkout_session_id = $2 AND status = 'expired'`, [payment.id, sessionId]);
        if (old && event.type === 'checkout.session.expired') return { handled: true };
        fail('Unexpected checkout identity', 'delivery_payment_verification_failed');
      }
      if (!attempt.checkout_session_id) {
        if (!tagged || !sessionId || String(attempt.generation) !== routeMetadata.generation) {
          fail('Checkout identity needs recovery', 'delivery_payment_reconciliation_required');
        }
        attempt.checkout_session_id = sessionId;
      }
      const result = await retrieveAndReconcile(client, payment, attempt);
      const { rows: [settled] } = await client.query('SELECT payment_intent_id, charge_id FROM delivery_payments WHERE id = $1', [payment.id]);
      if ((intentId && intentId !== settled.payment_intent_id)
        || (event.type === 'charge.refunded' && object.id !== settled.charge_id)) {
        fail('Webhook provider identity mismatch', 'delivery_payment_verification_failed');
      }
      if (event.type.startsWith('refund.')) {
        const { rows: [request] } = await client.query(
          'SELECT * FROM delivery_payment_refunds WHERE payment_id = $1 AND provider_refund_id = $2 FOR UPDATE',
          [payment.id, object.id]);
        if (request) {
          const refund = await getStripe().refunds.retrieve(object.id);
          await applyRefundResponse(client, payment, request, refund);
        }
      }
      return { handled: true, ...result };
    });
  }

  return { createBaseCheckout: args => createCheckout({ deliveryJobId: args.deliveryJobId, customerUserId: args.customerUserId }),
    createExtraCheckout, syncPayment, refundPayment, handleStripeEvent };
}

module.exports = { ...createService(), createService };
