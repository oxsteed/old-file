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
  const { rows: insertedRows } = await client.query(
    `INSERT INTO restaurant_pos_payments
       (restaurant_id, food_order_id, shift_id, payment_type, amount_cents, status,
        provider, idempotency_key, reference, note, metadata, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'food_wallet',$7,$8,$9,$10::jsonb,$11)
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
    `UPDATE food_orders
        SET payment_status = $1,
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
  return { order: updatedOrder, totals: { ...totals, net_paid_cents: netPaidCents } };
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

async function applyStripePaymentIntent(client, intent) {
  if (!intent?.id) return null;
  const status = intent.status === 'succeeded'
    ? 'captured'
    : intent.status === 'canceled' || (intent.status === 'requires_payment_method' && intent.last_payment_error)
      ? 'failed'
      : 'pending';
  const { rows: [payment] } = await client.query(
    `UPDATE restaurant_pos_payments
        SET status = CASE WHEN status = 'captured' THEN status ELSE $1 END,
            provider_charge_id = COALESCE($2, provider_charge_id),
            note = CASE WHEN $1 = 'failed' THEN COALESCE($3, note) ELSE note END,
            metadata = metadata || $4::jsonb,
            updated_at = NOW()
      WHERE provider = 'stripe_terminal'
        AND provider_payment_intent_id = $5
        AND payment_type = 'card'
      RETURNING *`,
    [
      status,
      typeof intent.latest_charge === 'string' ? intent.latest_charge : null,
      intent.last_payment_error?.message || intent.cancellation_reason || null,
      JSON.stringify({ stripeStatus: intent.status }),
      intent.id,
    ]
  );
  if (!payment) return null;
  const reconciliation = await reconcilePosOrderPayment(client, payment.food_order_id);
  return { payment, ...reconciliation };
}

async function applyStripeRefund(client, refund) {
  if (!refund?.id) return null;
  const refundPaymentId = Number.parseInt(refund.metadata?.pos_refund_payment_id, 10) || null;
  const status = refund.status === 'succeeded'
    ? 'refunded'
    : ['failed', 'canceled'].includes(refund.status)
      ? 'failed'
      : 'pending';
  const { rows: [payment] } = await client.query(
    `UPDATE restaurant_pos_payments
        SET status = $1,
            provider_refund_id = $2,
            reference = $2,
            metadata = metadata || $3::jsonb,
            updated_at = NOW()
      WHERE payment_type = 'refund'
        AND provider = 'stripe_terminal'
        AND (provider_refund_id = $2 OR ($4::bigint IS NOT NULL AND id = $4))
      RETURNING *`,
    [status, refund.id, JSON.stringify({ stripeStatus: refund.status }), refundPaymentId]
  );
  if (!payment) return null;
  const originalPaymentId = Number(payment.metadata?.originalPaymentId || refund.metadata?.pos_payment_id) || null;
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

async function applyStripeChargeRefund(client, charge) {
  if (!charge?.payment_intent || !Number.isFinite(Number(charge.amount_refunded))) return null;
  const { rows: [original] } = await client.query(
    `SELECT * FROM restaurant_pos_payments
      WHERE provider = 'stripe_terminal'
        AND provider_payment_intent_id = $1
        AND payment_type = 'card'
      FOR UPDATE`,
    [charge.payment_intent]
  );
  if (!original) return null;
  const { rows: [totals] } = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS recorded_refund_cents
       FROM restaurant_pos_payments
      WHERE payment_type = 'refund'
        AND status = 'refunded'
        AND metadata->>'originalPaymentId' = $1::text`,
    [original.id]
  );
  const missingCents = Math.max(0, Number(charge.amount_refunded) - Number(totals.recorded_refund_cents || 0));
  if (missingCents > 0) {
    await client.query(
      `INSERT INTO restaurant_pos_payments
         (restaurant_id, food_order_id, shift_id, payment_type, amount_cents, status,
          provider, provider_payment_intent_id, provider_charge_id, idempotency_key,
          reference, note, metadata)
       VALUES ($1,$2,$3,'refund',$4,'refunded','stripe_terminal',$5,$6,$7,$6,
               'Refund reconciled from Stripe webhook',$8)
       ON CONFLICT (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        original.restaurant_id,
        original.food_order_id,
        original.shift_id,
        missingCents,
        charge.payment_intent,
        charge.id,
        `stripe-charge-refund:${charge.id}:${charge.amount_refunded}`,
        JSON.stringify({ originalPaymentId: original.id, reconciledFromWebhook: true }),
      ]
    );
  }
  await client.query(
    `UPDATE restaurant_pos_payments
        SET refunded_amount_cents = LEAST(amount_cents, $1), updated_at = NOW()
      WHERE id = $2`,
    [Number(charge.amount_refunded), original.id]
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
