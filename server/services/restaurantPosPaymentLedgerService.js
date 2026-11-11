'use strict';

const { AppError } = require('../middleware/errorHandler');

function normalizeString(value, max = 255) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function assertPosPaymentReplayMatches(existing, {
  orderId,
  amountCents,
  paymentType,
  provider,
  shiftId = null,
  currencyCode = 'USD',
  walletAccountId = null,
  walletLedgerEntryId = null,
  walletRefundLedgerEntryId = null,
  walletOriginalLedgerEntryId = null,
  metadata = {},
}) {
  const existingMetadata = existing.metadata && typeof existing.metadata === 'object'
    ? existing.metadata
    : {};
  const mismatches = {};
  const expectedFields = [
    ['foodOrderId', Number(existing.food_order_id), Number(orderId)],
    ['amountCents', Number(existing.amount_cents || 0), Number(amountCents || 0)],
    ['paymentType', existing.payment_type, paymentType],
    ['provider', existing.provider, provider],
  ];
  if (shiftId !== null && shiftId !== undefined) {
    expectedFields.push(['shiftId', existing.shift_id === null ? null : Number(existing.shift_id), Number(shiftId)]);
  }
  const existingCurrency = normalizeString(existingMetadata.currencyCode, 3)?.toUpperCase() || 'USD';
  const requestedCurrency = normalizeString(currencyCode, 3)?.toUpperCase() || 'USD';
  expectedFields.push(['currencyCode', existingCurrency, requestedCurrency]);

  const walletFields = [
    ['walletAccountId', walletAccountId],
    ['walletLedgerEntryId', walletLedgerEntryId],
    ['walletRefundLedgerEntryId', walletRefundLedgerEntryId],
    ['walletOriginalLedgerEntryId', walletOriginalLedgerEntryId],
    ['customerId', metadata.customerId],
    ['originalPaymentId', metadata.originalPaymentId],
  ];
  for (const [field, requested] of walletFields) {
    if (requested === null || requested === undefined || requested === '') continue;
    const existingValue = existingMetadata[field] === null || existingMetadata[field] === undefined
      ? null
      : String(existingMetadata[field]);
    if (existingValue !== String(requested)) {
      mismatches[field] = { existing: existingValue, requested: String(requested) };
    }
  }
  for (const [field, existingValue, requestedValue] of expectedFields) {
    if (existingValue !== requestedValue) {
      mismatches[field] = { existing: existingValue, requested: requestedValue };
    }
  }
  if (Object.keys(mismatches).length) {
    throw new AppError(
      'POS payment idempotency conflict',
      409,
      'pos_payment_idempotency_conflict',
      { paymentId: existing.id ? String(existing.id) : null, mismatches }
    );
  }
}

async function insertOrReplayWalletPosPayment(client, {
  restaurantId,
  orderId,
  shiftId = null,
  paymentType,
  amountCents,
  idempotencyKey,
  reference,
  note,
  metadata,
  createdByUserId = null,
  replayArgs,
}) {
  // F-02 phase 1: the payment inherits the store of the order it settles.
  const { rows: [orderRow] } = await client.query(
    `SELECT location_id FROM food_orders WHERE id = $1`,
    [orderId]
  );
  const { rows: insertedRows } = await client.query(
    `INSERT INTO restaurant_pos_payments
       (restaurant_id, food_order_id, shift_id, payment_type, amount_cents, status,
        provider, idempotency_key, reference, note, metadata, created_by, location_id)
     VALUES ($1,$2,$3,$4,$5,$6,'food_wallet',$7,$8,$9,$10::jsonb,$11,$12)
     ON CONFLICT (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [
      restaurantId,
      orderId,
      shiftId,
      paymentType,
      amountCents,
      paymentType === 'refund' ? 'refunded' : 'captured',
      idempotencyKey,
      reference,
      note,
      JSON.stringify(metadata),
      createdByUserId,
      orderRow?.location_id ?? null,
    ]
  );
  if (insertedRows[0]) return { payment: insertedRows[0], replayed: false };

  const { rows: existingRows } = await client.query(
    `SELECT *
       FROM restaurant_pos_payments
      WHERE restaurant_id = $1
        AND idempotency_key = $2
      FOR UPDATE`,
    [restaurantId, idempotencyKey]
  );
  const existing = existingRows[0];
  if (!existing) {
    throw new AppError('POS payment replay could not be resolved', 409, 'pos_payment_replay_unavailable');
  }
  assertPosPaymentReplayMatches(existing, replayArgs);
  return { payment: existing, replayed: true };
}

async function reconcilePosOrderPayment(client, orderId) {
  const { rows: [order] } = await client.query(
    `SELECT * FROM food_orders WHERE id = $1 FOR UPDATE`,
    [orderId]
  );
  if (!order) return null;
  const { rows: [totals] } = await client.query(
    `SELECT COALESCE(SUM(amount_cents) FILTER (
                    WHERE payment_type <> 'refund' AND status IN ('recorded','captured')
                  ), 0)::int AS paid_cents,
            COALESCE(SUM(amount_cents) FILTER (
                    WHERE payment_type = 'refund' AND status IN ('recorded','captured','refunded')
                  ), 0)::int AS refunded_cents,
            COUNT(*) FILTER (WHERE payment_type <> 'refund' AND status = 'pending')::int AS pending_payments
       FROM restaurant_pos_payments
      WHERE food_order_id = $1`,
    [orderId]
  );
  const paidCents = Number(totals.paid_cents || 0);
  const refundedCents = Number(totals.refunded_cents || 0);
  const netPaidCents = Math.max(0, paidCents - refundedCents);
  const nextPaymentStatus = paidCents > 0 && refundedCents >= paidCents
    ? 'refunded'
    : netPaidCents >= Number(order.total_cents || 0)
      ? 'paid'
      : Number(totals.pending_payments || 0) > 0
        ? 'requires_payment'
        : netPaidCents > 0
          ? 'requires_payment'
          : 'unpaid';
  const { rows: [updatedOrder] } = await client.query(
    // The $1::text cast is load-bearing: $1 is also a jsonb_build_object
    // value below, and Postgres otherwise deduces it as both varchar
    // (this assignment) and text, failing with 42P08 on a real database.
    `UPDATE food_orders
        SET payment_status = $1::text,
            pos_ticket_state = CASE
              WHEN $1 = 'refunded' THEN 'refunded'
              WHEN $1 = 'paid' AND pos_ticket_state IN ('open','held') THEN 'closed'
              WHEN $1 IN ('unpaid','requires_payment') AND pos_ticket_state = 'closed' THEN 'open'
              ELSE pos_ticket_state
            END,
            refunded_at = CASE WHEN $1 = 'refunded' THEN COALESCE(refunded_at, NOW()) ELSE refunded_at END,
            metadata = metadata || jsonb_build_object(
              'posPaymentSummary',
              jsonb_build_object(
                'paidCents', $3::int,
                'refundedCents', $4::int,
                'netPaidCents', $5::int,
                'pendingPayments', $6::int,
                'paymentStatus', $1,
                'updatedAt', NOW()
              )
            ),
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [
      nextPaymentStatus,
      orderId,
      paidCents,
      refundedCents,
      netPaidCents,
      Number(totals.pending_payments || 0),
    ]
  );
  if (nextPaymentStatus === 'paid') {
    // The order was just marked paid, but a delivery runner task created
    // earlier may still flag cash_collection_required (frozen at task
    // creation). Clear it so the runner is not asked to collect cash the
    // customer already paid.
    await client.query(
      `UPDATE restaurant_runner_tasks
          SET cash_collection_required = FALSE,
              updated_at = NOW()
        WHERE food_order_id = $1
          AND task_type = 'Delivery'
          AND status <> 'Completed'
          AND cash_collection_required = TRUE`,
      [orderId]
    );
  }
  // F-04: fire-on-pay. The POS order was created with an unfired kitchen
  // ticket (kitchen_ticket_fired_at NULL, metadata.kitchenFireMode =
  // 'on_pay'); the first recorded/captured non-refund payment fires it
  // exactly once. Refund-only flows (paidCents = 0) never fire.
  let kitchenTicket = null;
  try {
    const fireMeta = order.metadata && typeof order.metadata === 'object' ? order.metadata : {};
    if (updatedOrder
      && !updatedOrder.kitchen_ticket_fired_at
      && fireMeta.kitchenFireMode === 'on_pay'
      && paidCents > 0) {
      const { fireKitchenTicketForOrder } = require('./restaurantKitchenFireService');
      const fired = await fireKitchenTicketForOrder(client, {
        orderId,
        restaurantId: updatedOrder.restaurant_id,
        createdBy: null,
      });
      const { rows: [refreshed] } = await client.query(
        'SELECT * FROM food_orders WHERE id = $1',
        [orderId]
      );
      kitchenTicket = { fired: fired.fired, jobs: fired.jobs, order: refreshed || updatedOrder };
    }
  } catch (fireErr) {
    // A kitchen-fire failure must never fail the payment itself; the
    // ticket stays unfired (kitchen_ticket_fired_at NULL) and the next
    // payment attempt retries the fire.
    const logger = require('../utils/logger');
    logger.warn('fire-on-pay kitchen ticket failed; will retry on next payment', {
      orderId,
      err: fireErr && fireErr.message,
    });
  }
  if (updatedOrder?.customer_id && order.payment_status !== nextPaymentStatus) {
    const { emitDomainEvent, foodEventProps } = require('../growth/emit');
    if (nextPaymentStatus === 'paid') {
      await emitDomainEvent(client, 'food.order_paid', foodEventProps(updatedOrder), { userId: updatedOrder.customer_id });
    } else if (nextPaymentStatus === 'refunded') {
      await emitDomainEvent(client, 'food.order_refunded', foodEventProps(updatedOrder), { userId: updatedOrder.customer_id });
    }
  }
  return {
    order: kitchenTicket?.order || updatedOrder,
    totals: { ...totals, net_paid_cents: netPaidCents },
    ...(kitchenTicket ? { kitchenTicketFired: kitchenTicket.fired, kitchenTicketJobs: kitchenTicket.jobs } : {}),
  };
}

async function recordWalletCreditPaymentForOrder(client, {
  restaurantId,
  orderId,
  amountCents,
  currencyCode = 'USD',
  walletAccountId = null,
  walletLedgerEntryId = null,
  walletBalanceAfterCents = null,
  idempotencyKey,
  shiftId = null,
  createdByUserId = null,
  metadata = {},
}) {
  const normalizedAmount = Math.round(Number(amountCents || 0));
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return { payment: null, order: null, totals: null, skipped: true };
  }
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 200)
    || `wallet-credit:${restaurantId}:${orderId}`;
  const paymentMetadata = {
    source: 'food_wallet',
    currencyCode,
    walletAccountId: walletAccountId ? String(walletAccountId) : null,
    walletLedgerEntryId: walletLedgerEntryId ? String(walletLedgerEntryId) : null,
    walletBalanceAfterCents: walletBalanceAfterCents === null || walletBalanceAfterCents === undefined
      ? null
      : Number(walletBalanceAfterCents),
    ...metadata,
  };
  const { payment } = await insertOrReplayWalletPosPayment(client, {
    restaurantId,
    orderId,
    shiftId,
    paymentType: 'wallet_credit',
    amountCents: normalizedAmount,
    idempotencyKey: normalizedIdempotencyKey,
    reference: walletLedgerEntryId ? `wallet-ledger:${walletLedgerEntryId}` : `food-order:${orderId}`,
    note: 'Paid with restaurant credit',
    metadata: paymentMetadata,
    createdByUserId,
    replayArgs: {
      orderId,
      amountCents: normalizedAmount,
      paymentType: 'wallet_credit',
      provider: 'food_wallet',
      shiftId,
      currencyCode,
      walletAccountId,
      walletLedgerEntryId,
      metadata: paymentMetadata,
    },
  });
  const reconciliation = await reconcilePosOrderPayment(client, orderId);
  return { payment: payment || null, ...reconciliation, skipped: false };
}

async function recordWalletCreditRefundForOrder(client, {
  restaurantId,
  orderId,
  amountCents,
  currencyCode = 'USD',
  walletAccountId = null,
  walletRefundLedgerEntryId = null,
  walletOriginalLedgerEntryId = null,
  walletBalanceAfterCents = null,
  idempotencyKey,
  createdByUserId = null,
  metadata = {},
}) {
  const normalizedAmount = Math.round(Number(amountCents || 0));
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return { payment: null, order: null, totals: null, skipped: true };
  }
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 200)
    || `wallet-credit-refund:${restaurantId}:${orderId}`;
  const paymentMetadata = {
    source: 'food_wallet',
    currencyCode,
    walletAccountId: walletAccountId ? String(walletAccountId) : null,
    walletRefundLedgerEntryId: walletRefundLedgerEntryId ? String(walletRefundLedgerEntryId) : null,
    walletOriginalLedgerEntryId: walletOriginalLedgerEntryId ? String(walletOriginalLedgerEntryId) : null,
    walletBalanceAfterCents: walletBalanceAfterCents === null || walletBalanceAfterCents === undefined
      ? null
      : Number(walletBalanceAfterCents),
    ...metadata,
  };
  const { payment } = await insertOrReplayWalletPosPayment(client, {
    restaurantId,
    orderId,
    paymentType: 'refund',
    amountCents: normalizedAmount,
    idempotencyKey: normalizedIdempotencyKey,
    reference: walletRefundLedgerEntryId ? `wallet-refund-ledger:${walletRefundLedgerEntryId}` : `food-order-refund:${orderId}`,
    note: 'Refunded to restaurant credit',
    metadata: paymentMetadata,
    createdByUserId,
    replayArgs: {
      orderId,
      amountCents: normalizedAmount,
      paymentType: 'refund',
      provider: 'food_wallet',
      currencyCode,
      walletAccountId,
      walletRefundLedgerEntryId,
      walletOriginalLedgerEntryId,
      metadata: paymentMetadata,
    },
  });
  const reconciliation = await reconcilePosOrderPayment(client, orderId);
  return { payment: payment || null, ...reconciliation, skipped: false };
}

async function applyStripePaymentIntent(client, intent, providerAccountId = null) {
  if (!intent?.id) return null;
  const status = intent.status === 'succeeded'
    ? 'captured'
    : intent.status === 'canceled' || (intent.status === 'requires_payment_method' && intent.last_payment_error)
      ? 'failed'
      : 'pending';
  const { rows: [existingPayment] } = await client.query(
    `SELECT p.*, fo.currency_code AS order_currency
       FROM restaurant_pos_payments p
       JOIN food_orders fo ON fo.id = p.food_order_id
      WHERE p.provider = 'stripe_terminal'
        AND p.provider_payment_intent_id = $1
        AND p.payment_type = 'card'
      FOR UPDATE`,
    [intent.id]
  );
  if (!existingPayment) return null;
  const providerAmount = Number(intent.amount_received ?? intent.amount);
  const providerCurrency = typeof intent.currency === 'string' ? intent.currency.toLowerCase() : '';
  const expectedCurrency = String(existingPayment.order_currency || '').toLowerCase();
  if (!Number.isSafeInteger(providerAmount)
      || providerAmount !== Number(existingPayment.amount_cents)
      || !providerCurrency
      || providerCurrency !== expectedCurrency
      || (existingPayment.provider_account_id && providerAccountId !== existingPayment.provider_account_id)) {
    throw new AppError('Stripe POS payment does not match the local payment record', 409, 'pos_payment_verification_failed');
  }
  const { rows: [payment] } = await client.query(
    `UPDATE restaurant_pos_payments
        SET status = CASE WHEN status = 'captured' THEN status ELSE $1 END,
            provider_charge_id = COALESCE($2, provider_charge_id),
            note = CASE WHEN $1 = 'failed' THEN COALESCE($3, note) ELSE note END,
            metadata = metadata || $4::jsonb,
            updated_at = NOW()
      WHERE id = $5
      RETURNING *`,
    [
      status,
      typeof intent.latest_charge === 'string' ? intent.latest_charge : null,
      intent.last_payment_error?.message || intent.cancellation_reason || null,
      JSON.stringify({ stripeStatus: intent.status }),
      existingPayment.id,
    ]
  );
  if (!payment) return null;
  const reconciliation = await reconcilePosOrderPayment(client, payment.food_order_id);
  return { payment, ...reconciliation };
}

async function applyStripeRefund(client, refund, providerAccountId = null) {
  if (!refund?.id) return null;
  const refundPaymentId = Number.parseInt(refund.metadata?.pos_refund_payment_id, 10) || null;
  const status = refund.status === 'succeeded'
    ? 'refunded'
    : ['failed', 'canceled'].includes(refund.status)
      ? 'failed'
      : 'pending';
  const lookup = refundPaymentId
    ? {
      sql: `SELECT p.*, fo.currency_code AS order_currency
              FROM restaurant_pos_payments p
              JOIN food_orders fo ON fo.id = p.food_order_id
             WHERE p.payment_type = 'refund'
               AND p.provider = 'stripe_terminal'
               AND p.id = $1
             FOR UPDATE`,
      params: [refundPaymentId],
    }
    : {
      sql: `SELECT p.*, fo.currency_code AS order_currency
              FROM restaurant_pos_payments p
              JOIN food_orders fo ON fo.id = p.food_order_id
             WHERE p.payment_type = 'refund'
               AND p.provider = 'stripe_terminal'
               AND p.provider_refund_id = $1
             FOR UPDATE`,
      params: [refund.id],
    };
  const { rows: [existingRefund] } = await client.query(lookup.sql, lookup.params);
  if (!existingRefund) return null;
  const originalPaymentId = Number(existingRefund.metadata?.originalPaymentId || refund.metadata?.pos_payment_id) || null;
  let originalPayment = null;
  if (originalPaymentId) {
    const { rows: [row] } = await client.query(
      `SELECT id, provider_payment_intent_id, provider_account_id
         FROM restaurant_pos_payments
        WHERE id = $1 AND payment_type = 'card'
        FOR UPDATE`,
      [originalPaymentId]
    );
    originalPayment = row || null;
  }
  const providerAmount = Number(refund.amount);
  const providerCurrency = typeof refund.currency === 'string' ? refund.currency.toLowerCase() : '';
  const expectedCurrency = String(existingRefund.order_currency || '').toLowerCase();
  const providerPaymentIntentId = typeof refund.payment_intent === 'string'
    ? refund.payment_intent
    : refund.payment_intent?.id || null;
  if (!Number.isSafeInteger(providerAmount)
      || providerAmount !== Number(existingRefund.amount_cents)
      || !providerCurrency
      || providerCurrency !== expectedCurrency
      || (originalPaymentId && !originalPayment)
      || (existingRefund.provider_payment_intent_id
        && providerPaymentIntentId !== existingRefund.provider_payment_intent_id)
      || (originalPayment && providerPaymentIntentId !== originalPayment.provider_payment_intent_id)
      || (originalPayment?.provider_account_id && providerAccountId !== originalPayment.provider_account_id)) {
    throw new AppError('Stripe POS refund does not match the local refund record', 409, 'pos_refund_verification_failed');
  }
  const { rows: [payment] } = await client.query(
    `UPDATE restaurant_pos_payments
        SET status = $1,
            provider_refund_id = $2,
            reference = $2,
            metadata = metadata || $3::jsonb,
            updated_at = NOW()
      WHERE id = $4
      RETURNING *`,
    [status, refund.id, JSON.stringify({ stripeStatus: refund.status }), existingRefund.id]
  );
  if (!payment) return null;
  if (originalPaymentId) {
    await client.query(
      `UPDATE restaurant_pos_payments original
          SET refunded_amount_cents = LEAST(
                original.amount_cents,
                COALESCE((
                  SELECT SUM(r.amount_cents)
                    FROM restaurant_pos_payments r
                   WHERE r.payment_type = 'refund'
                     AND r.status = 'refunded'
                     AND r.metadata->>'originalPaymentId' = original.id::text
                ), 0)
              ),
              updated_at = NOW()
        WHERE original.id = $1`,
      [originalPaymentId]
    );
  }
  const reconciliation = await reconcilePosOrderPayment(client, payment.food_order_id);
  return { payment, ...reconciliation };
}

async function applyStripeChargeRefund(client, charge, providerAccountId = null) {
  const paymentIntentId = typeof charge?.payment_intent === 'string'
    ? charge.payment_intent
    : charge?.payment_intent?.id || null;
  if (!paymentIntentId || !Number.isFinite(Number(charge.amount_refunded))) return null;
  const { rows: [original] } = await client.query(
    `SELECT p.*, fo.currency_code AS order_currency
       FROM restaurant_pos_payments p
       JOIN food_orders fo ON fo.id = p.food_order_id
      WHERE p.provider = 'stripe_terminal'
        AND p.provider_payment_intent_id = $1
        AND p.payment_type = 'card'
      FOR UPDATE`,
    [paymentIntentId]
  );
  if (!original) return null;
  const refundedAmount = Number(charge.amount_refunded);
  const providerCurrency = typeof charge.currency === 'string' ? charge.currency.toLowerCase() : '';
  const expectedCurrency = String(original.order_currency || '').toLowerCase();
  if (!Number.isSafeInteger(refundedAmount)
      || refundedAmount < 0
      || refundedAmount > Number(original.amount_cents)
      || !providerCurrency
      || providerCurrency !== expectedCurrency
      || (original.provider_account_id && providerAccountId !== original.provider_account_id)) {
    throw new AppError('Stripe POS refund does not match the local payment record', 409, 'pos_refund_verification_failed');
  }
  const { rows: [totals] } = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS recorded_refund_cents
       FROM restaurant_pos_payments
      WHERE payment_type = 'refund'
        AND status = 'refunded'
        AND metadata->>'originalPaymentId' = $1::text`,
    [original.id]
  );
  const missingCents = Math.max(0, refundedAmount - Number(totals.recorded_refund_cents || 0));
  if (missingCents > 0) {
    await client.query(
      `INSERT INTO restaurant_pos_payments
         (restaurant_id, food_order_id, shift_id, payment_type, amount_cents, status,
          provider, provider_payment_intent_id, provider_charge_id, idempotency_key,
          reference, note, metadata, location_id)
       VALUES ($1,$2,$3,'refund',$4,'refunded','stripe_terminal',$5,$6,$7,$6,
               'Refund reconciled from Stripe webhook',$8,$9)
       ON CONFLICT (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        original.restaurant_id,
        original.food_order_id,
        original.shift_id,
        missingCents,
        paymentIntentId,
        charge.id,
        `stripe-charge-refund:${charge.id}:${refundedAmount}`,
        JSON.stringify({ originalPaymentId: original.id, reconciledFromWebhook: true }),
        original.location_id ?? null,
      ]
    );
  }
  await client.query(
    `UPDATE restaurant_pos_payments
        SET refunded_amount_cents = LEAST(amount_cents, $1), updated_at = NOW()
      WHERE id = $2`,
    [refundedAmount, original.id]
  );
  const reconciliation = await reconcilePosOrderPayment(client, original.food_order_id);
  return { payment: original, ...reconciliation };
}

module.exports = {
  reconcilePosOrderPayment,
  recordWalletCreditPaymentForOrder,
  recordWalletCreditRefundForOrder,
  applyStripePaymentIntent,
  applyStripeRefund,
  applyStripeChargeRefund,
};
