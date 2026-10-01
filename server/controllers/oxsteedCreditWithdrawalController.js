'use strict';

/**
 * OxSteed Credit customer money-out endpoints (Phase 6):
 * withdrawals to a bank account, restaurant credit conversions, and fee quotes.
 */

const { AppError } = require('../middleware/errorHandler');
const withdrawalService = require('../services/oxsteedCreditWithdrawalService');
const conversionService = require('../services/oxsteedCreditRestaurantConversionService');
const { quoteFee } = require('../services/oxsteedCreditFeeScheduleService');
const { listConversionEnabledRestaurantIds } = require('../services/oxsteedCreditRestaurantConversionPolicyService');
const { verifyStepupChallenge, amountRequiresStepup, issueStepupChallenge } = require('../services/stepupChallengeService');

function getIdempotencyKey(req, what) {
  const raw = req.get('Idempotency-Key') || req.body?.idempotencyKey || req.body?.idempotency_key;
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) {
    throw new AppError(`Idempotency-Key is required for credit ${what}`, 400, `credit_${what}_idempotency_key_required`);
  }
  return key;
}

function getRequestContext(req) {
  return {
    requestIp: req.ip || null,
    correlationId: req.correlationId || req.get('X-Request-ID') || null,
  };
}

function parseAmountCents(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError('amountCents must be a positive integer number of cents', 400, 'credit_amount_invalid');
  }
  return amount;
}

async function requestWithdrawal(req, res, next) {
  try {
    if (req.user.role !== 'customer') {
      throw new AppError('Only customer accounts can withdraw OxSteed Credit', 403, 'credit_withdrawal_customer_only');
    }
    const amountCents = parseAmountCents(req.body?.amountCents ?? req.body?.amount_cents);
    // Large withdrawals need a fresh step-up challenge before any money
    // moves (same bar as large top-ups).
    if (amountRequiresStepup(amountCents)) {
      await verifyStepupChallenge({
        challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
        actorUserId: req.user.id,
        actionType: 'withdrawal',
        code: req.body?.stepupCode || req.body?.stepup_code,
      });
    }
    const result = await withdrawalService.requestWithdrawal({
      customerId: req.user.id,
      amountCents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code || 'USD',
      idempotencyKey: getIdempotencyKey(req, 'withdrawal'),
      actorUserId: req.user.id,
      ...getRequestContext(req),
    });
    res.status(result.replayed ? 200 : 201).json({ withdrawal: result.withdrawal, replayed: result.replayed });
  } catch (error) {
    next(error);
  }
}

async function listMyWithdrawals(req, res, next) {
  try {
    if (req.user.role !== 'customer') {
      throw new AppError('Only customer accounts can withdraw OxSteed Credit', 403, 'credit_withdrawal_customer_only');
    }
    const withdrawals = await withdrawalService.listWithdrawals({
      customerId: req.user.id,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ withdrawals });
  } catch (error) {
    next(error);
  }
}

async function cancelMyWithdrawal(req, res, next) {
  try {
    if (req.user.role !== 'customer') {
      throw new AppError('Only customer accounts can withdraw OxSteed Credit', 403, 'credit_withdrawal_customer_only');
    }
    const withdrawal = await withdrawalService.cancelWithdrawal({
      withdrawalId: req.params.id,
      customerId: req.user.id,
      actorUserId: req.user.id,
      ...getRequestContext(req),
    });
    res.json({ withdrawal });
  } catch (error) {
    next(error);
  }
}

async function createRestaurantConversion(req, res, next) {
  try {
    if (req.user.role !== 'customer') {
      throw new AppError('Only customer accounts can convert restaurant credit', 403, 'credit_conversion_customer_only');
    }
    const direction = String(req.body?.direction || '').trim();
    if (direction !== 'to_restaurant' && direction !== 'from_restaurant') {
      throw new AppError("direction must be 'to_restaurant' or 'from_restaurant'", 400, 'credit_conversion_direction_invalid');
    }
    const amountCents = parseAmountCents(req.body?.amountCents ?? req.body?.amount_cents);
    if (amountRequiresStepup(amountCents)) {
      await verifyStepupChallenge({
        challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
        actorUserId: req.user.id,
        actionType: 'restaurant_conversion',
        code: req.body?.stepupCode || req.body?.stepup_code,
      });
    }
    const params = {
      customerId: req.user.id,
      restaurantId: req.body?.restaurantId ?? req.body?.restaurant_id,
      amountCents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code || 'USD',
      idempotencyKey: getIdempotencyKey(req, 'conversion'),
      actorUserId: req.user.id,
      ...getRequestContext(req),
    };
    const result = direction === 'to_restaurant'
      ? await conversionService.convertOxsteedToRestaurant(params)
      : await conversionService.convertRestaurantToOxsteed(params);
    res.status(result.replayed ? 200 : 201).json({ conversion: result.conversion, replayed: result.replayed });
  } catch (error) {
    next(error);
  }
}

async function listMyRestaurantConversions(req, res, next) {
  try {
    if (req.user.role !== 'customer') {
      throw new AppError('Only customer accounts can convert restaurant credit', 403, 'credit_conversion_customer_only');
    }
    const conversions = await conversionService.listRestaurantConversions({
      customerId: req.user.id,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ conversions });
  } catch (error) {
    next(error);
  }
}

/**
 * The set of restaurant ids with the from_restaurant direction currently
 * enabled by OxSteed. The customer page filters the conversion dropdown to
 * this set; the service still enforces the gate server-side.
 */
async function getRestaurantConversionEligibility(req, res, next) {
  try {
    if (req.user.role !== 'customer') {
      throw new AppError('Only customer accounts can convert restaurant credit', 403, 'credit_conversion_customer_only');
    }
    const enabledRestaurantIds = await listConversionEnabledRestaurantIds();
    res.json({ enabledRestaurantIds, count: enabledRestaurantIds.length });
  } catch (error) {
    next(error);
  }
}

async function getFeeQuote(req, res, next) {
  try {
    const operationType = String(req.query.operation || req.query.operationType || '').trim();
    const amountCents = parseAmountCents(req.query.amountCents ?? req.query.amount_cents);
    const quote = await quoteFee({
      operationType,
      currencyCode: req.query.currencyCode || req.query.currency_code || 'USD',
      amountCents,
    });
    res.json({ quote });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requestWithdrawal,
  listMyWithdrawals,
  cancelMyWithdrawal,
  createRestaurantConversion,
  listMyRestaurantConversions,
  getRestaurantConversionEligibility,
  getFeeQuote,
  issueMoneyOutStepupChallenge,
};

/**
 * Issue a step-up challenge for customer money-out actions (withdrawal,
 * customer_transfer, restaurant_conversion). The code is emailed; the
 * response carries only the challenge id and expiry. The client then
 * submits the money-out request with { stepupChallengeId, stepupCode }.
 */
async function issueMoneyOutStepupChallenge(req, res, next) {
  try {
    if (req.user.role !== 'customer') {
      throw new AppError('Only customer accounts can use money-out step-up', 403, 'credit_stepup_customer_only');
    }
    const actionType = String(req.body?.actionType || req.body?.action_type || '').trim();
    if (!['withdrawal', 'customer_transfer', 'restaurant_conversion'].includes(actionType)) {
      throw new AppError('Unsupported money-out step-up action', 400, 'credit_stepup_action_invalid');
    }
    const amountCents = parseAmountCents(req.body?.amountCents ?? req.body?.amount_cents);
    if (!amountRequiresStepup(amountCents)) {
      throw new AppError('A step-up challenge is not required for this amount', 400, 'credit_stepup_not_required');
    }
    const { challenge, delivery } = await issueStepupChallenge({
      actorUserId: req.user.id,
      actorEmail: req.user?.email,
      actionType,
      amountCents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code || 'USD',
    });
    res.status(201).json({
      challenge: {
        id: challenge.id,
        actionType: challenge.actionType,
        amountCents: challenge.amountCents,
        currencyCode: challenge.currencyCode,
        expiresAt: challenge.expiresAt,
      },
      delivery,
    });
  } catch (error) {
    next(error);
  }
}
