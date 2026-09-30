'use strict';

const AppError = require('../utils/appError');
const { stripeObjectId } = require('../utils/stripePayload');

function verifiedChargeRefundTotal(charge, payment) {
  const amount = Number(charge?.amount);
  const refunded = Number(charge?.amount_refunded);
  if (!charge?.id || !Number.isSafeInteger(amount) || amount <= 0
    || !Number.isSafeInteger(refunded) || refunded < 0 || refunded > amount
    || (payment && (stripeObjectId(charge.payment_intent) !== payment.stripe_payment_intent_id
      || amount !== Math.round(Number(payment.amount) * 100)
      || String(charge.currency).toLowerCase() !== String(payment.currency || 'usd').toLowerCase()))) {
    throw new AppError('Refund charge evidence could not be verified', 503, 'payment_refund_reconciliation_required');
  }
  return refunded;
}

async function applyChargeRefund(client, charge) {
  const refunded = verifiedChargeRefundTotal(charge);
  // The provider sends cumulative amounts. GREATEST prevents delayed events
  // lowering the recorded amount; partial refunds retain their original state.
  return client.query(
    `UPDATE payments
        SET refunded_amount = GREATEST(COALESCE(refunded_amount, 0), $1::numeric),
            refund_amount = GREATEST(COALESCE(refund_amount, 0), $1::numeric),
            status = CASE WHEN $1::numeric >= amount THEN 'refunded' ELSE status END,
            payment_hold_status = CASE WHEN $1::numeric >= amount THEN 'refunded' ELSE payment_hold_status END,
            refunded_at = CASE WHEN $1::numeric >= amount THEN COALESCE(refunded_at, NOW()) ELSE refunded_at END,
            updated_at = NOW()
      WHERE (stripe_charge_id = $2 OR stripe_payment_intent_id = $3)
        AND ROUND(amount * 100) = $4
        AND LOWER(COALESCE(currency, 'usd')) = $5
      RETURNING id`,
    [refunded / 100, charge.id, stripeObjectId(charge.payment_intent), Number(charge.amount), String(charge.currency).toLowerCase()]
  );
}

module.exports = { verifiedChargeRefundTotal, applyChargeRefund };
