'use strict';

/**
 * OxSteed Credit Stripe top-up controller (fiat money IN).
 *
 * POST /api/oxsteed-credit/topups      create a top-up intent (customer)
 * GET  /api/oxsteed-credit/topups/:id  read a top-up's status (owner only)
 *
 * The compliance gate (evaluateFundingCompliance, fundingMethod
 * 'stripe_topup') runs BEFORE any persistent side effect, per the fiat
 * funding contract. The idempotency key comes from the Idempotency-Key
 * header or the request body and is required.
 */

const { AppError } = require('../middleware/errorHandler');
const { evaluateFundingCompliance } = require('../services/fiatComplianceService');
const topupService = require('../services/oxsteedCreditTopupService');

function getIdempotencyKey(req) {
  const raw = req.get('Idempotency-Key') || req.body?.idempotencyKey || req.body?.idempotency_key;
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) {
    throw new AppError('Idempotency-Key is required for credit top-ups', 400, 'credit_topup_idempotency_key_required');
  }
  return key;
}

function getRequestContext(req) {
  return {
    requestIp: req.ip || null,
    correlationId: req.correlationId || req.get('X-Request-ID') || null,
  };
}

function formatTopup(topup) {
  if (!topup) return null;
  return {
    id: String(topup.id),
    amountCents: Number(topup.amount_cents),
    currencyCode: topup.currency_code,
    status: topup.status,
    stripePaymentIntentId: topup.stripe_payment_intent_id || null,
    expiresAt: topup.expires_at,
    createdAt: topup.created_at,
    updatedAt: topup.updated_at,
  };
}

async function createTopup(req, res, next) {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication is required', 401, 'auth_required');
    }
    const idempotencyKey = getIdempotencyKey(req);
    const { amountCents, currencyCode } = req.body || {};
    const { requestIp, correlationId } = getRequestContext(req);

    // Compliance gate first: no persistent side effect happens before this.
    await evaluateFundingCompliance({
      customerId,
      amountCents,
      currencyCode,
      fundingMethod: 'stripe_topup',
      actorUserId: customerId,
      requestIp,
      correlationId,
    });

    const { topup, clientSecret, replayed } = await topupService.createTopup({
      customerId,
      amountCents,
      currencyCode,
      idempotencyKey,
    });

    res.status(replayed ? 200 : 201).json({
      topup: formatTopup(topup),
      clientSecret,
      replayed,
    });
  } catch (err) {
    next(err);
  }
}

async function getTopup(req, res, next) {
  try {
    const topup = await topupService.getCustomerTopup({
      customerId: req.user?.id,
      topupId: req.params.id,
    });
    if (!topup) {
      throw new AppError('Credit top-up not found', 404, 'credit_topup_not_found');
    }
    res.json({ topup: formatTopup(topup) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createTopup,
  getTopup,
};
