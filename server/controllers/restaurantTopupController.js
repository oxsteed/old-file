'use strict';

/**
 * Restaurant customer top-up controller (merchant + customer surface).
 *
 * POST /api/restaurants/:restaurantId/topup-eligibility/apply
 *   Merchant application for customer top-up eligibility. Gated on the
 *   restaurant having payouts connected (the service rejects with a clear
 *   error otherwise: money must never enter a wallet the restaurant cannot
 *   withdraw). Owner-only (reuses the payouts manager gate).
 * POST /api/restaurants/:restaurantId/topups
 *   Create a top-up intent. Rejected unless the restaurant is active and
 *   OxSteed's eligibility decision is currently 'approved' (fail closed).
 * GET  /api/restaurants/:restaurantId/topups/:topupId
 *   Read a top-up's status (the topping-up user only).
 * POST /api/restaurants/:restaurantId/topups/stepup-challenges
 *   Issue a step-up challenge for a large top-up (mirrors the OxSteed
 *   Credit pattern).
 *
 * The idempotency key comes from the Idempotency-Key header or the request
 * body and is required.
 */

const { AppError } = require('../middleware/errorHandler');
// Canonical restaurant-owner check (analytics scope model, Phase 1 Item 6).
// Same owner CASE and `!userId -> false` guard as the former local helper.
const { isRestaurantOwner } = require('../services/scopeModel');
const { evaluateFundingCompliance } = require('../services/fiatComplianceService');
const { verifyStepupChallenge, issueStepupChallenge } = require('../services/stepupChallengeService');
const topupService = require('../services/restaurantTopupService');
const pool = require('../db');

function getIdempotencyKey(req) {
  const raw = req.get('Idempotency-Key') || req.body?.idempotencyKey || req.body?.idempotency_key;
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) {
    throw new AppError('Idempotency-Key is required for restaurant top-ups', 400, 'restaurant_topup_idempotency_key_required');
  }
  return key;
}

function formatEligibility(eligibility) {
  if (!eligibility) return null;
  return {
    restaurantId: String(eligibility.restaurant_id),
    status: eligibility.status,
    appliedAt: eligibility.applied_at,
    decidedAt: eligibility.decided_at,
    decidedBy: eligibility.decided_by ? String(eligibility.decided_by) : null,
    decisionReason: eligibility.decision_reason || null,
    updatedAt: eligibility.updated_at,
  };
}

function formatTopup(topup) {
  if (!topup) return null;
  return {
    id: String(topup.id),
    restaurantId: String(topup.restaurant_id),
    amountCents: Number(topup.amount_cents),
    currency: topup.currency,
    status: topup.status,
    stripePaymentIntentId: topup.stripe_payment_intent_id || null,
    expiresAt: topup.expires_at,
    createdAt: topup.created_at,
    updatedAt: topup.updated_at,
  };
}

async function applyForEligibility(req, res, next) {
  try {
    const restaurantId = req.restaurantId;
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    const { restaurant, eligibility } = await topupService.applyForEligibility({
      restaurantId,
      actorUserId: req.user?.id || null,
    });
    res.status(eligibility.status === 'approved' ? 200 : 201).json({
      eligibility: formatEligibility(eligibility),
      restaurant: {
        id: String(restaurant.id),
        name: restaurant.display_name || null,
        status: restaurant.status,
        currency: restaurant.currency_code,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function createTopup(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication is required', 401, 'auth_required');
    }
    const restaurantId = req.restaurantId || req.params.restaurantId;
    const idempotencyKey = getIdempotencyKey(req);
    const { amountCents } = req.body || {};
    // Keep cheap amount failures side-effect free and preserve the service's
    // canonical bounds before loading restaurant state or running compliance.
    topupService.validateTopupAmount(amountCents);

    // Step-up authentication (mirrors the OxSteed Credit pattern): large
    // top-ups require a fresh single-use challenge verified before any
    // persistent side effect.
    if (topupService.restaurantTopupRequiresStepup(amountCents)) {
      await verifyStepupChallenge({
        challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
        actorUserId: userId,
        actionType: 'restaurant_topup',
        code: req.body?.stepupCode || req.body?.stepup_code,
      });
    }

    // Restaurant top-ups are fiat funding too. Resolve and validate the
    // active restaurant before the intent service can insert a pending row,
    // then run the shared identity/sanctions/rail compliance choke point.
    const { rows: restaurantRows } = await pool.query(
      `SELECT id, status, currency_code FROM food_restaurants WHERE id = $1`,
      [restaurantId]
    );
    const restaurant = restaurantRows[0];
    if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    if (restaurant.status !== 'active') {
      throw new AppError(
        'Restaurant top-ups are not available for this restaurant right now.',
        409,
        'restaurant_topup_restaurant_inactive',
        { restaurantStatus: restaurant.status }
      );
    }

    await evaluateFundingCompliance({
      customerId: userId,
      amountCents,
      currencyCode: restaurant.currency_code,
      fundingMethod: 'restaurant_topup',
      actorUserId: userId,
      requestIp: req.ip || null,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
    });

    const { topup, clientSecret, replayed } = await topupService.createTopupIntent({
      userId,
      restaurantId,
      amountCents,
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
    const topup = await topupService.getUserTopup({
      userId: req.user?.id,
      restaurantId: req.params.restaurantId,
      topupId: req.params.topupId,
    });
    if (!topup) {
      throw new AppError('Restaurant top-up not found', 404, 'restaurant_topup_not_found');
    }
    res.json({ topup: formatTopup(topup) });
  } catch (err) {
    next(err);
  }
}

async function issueTopupStepupChallenge(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication is required', 401, 'auth_required');
    }
    const { amountCents } = req.body || {};
    if (!topupService.restaurantTopupRequiresStepup(amountCents)) {
      throw new AppError('A step-up challenge is not required for this amount', 400, 'restaurant_topup_stepup_not_required');
    }
    const restaurantId = req.restaurantId || req.params.restaurantId;
    const currencyCode = await topupService.getRestaurantCurrency(restaurantId);
    const { challenge, delivery } = await issueStepupChallenge({
      actorUserId: userId,
      actorEmail: req.user?.email,
      actionType: 'restaurant_topup',
      amountCents,
      currencyCode,
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
  } catch (err) {
    next(err);
  }
}

// GET /api/restaurants/:restaurantId/topup-eligibility
//
// Minimal read-only status read (additive; no behavior change to the write
// paths). The customer wallet page needs the status to gate the Add-money
// button, and the merchant payouts tab needs it to render the application
// state, so any signed-in user may read the status. The decision reason is
// only exposed to the restaurant owner or an admin.
async function getEligibility(req, res, next) {
  try {
    const restaurantId = Number.parseInt(req.params.restaurantId, 10);
    if (!Number.isInteger(restaurantId) || restaurantId <= 0) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    const { rows } = await pool.query('SELECT id FROM food_restaurants WHERE id = $1', [restaurantId]);
    if (!rows[0]) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    const eligibility = await topupService.getEligibility(pool, restaurantId);
    let decisionReason = null;
    if (eligibility && (req.isAdmin || (await isRestaurantOwner(req.user?.id, restaurantId)))) {
      decisionReason = eligibility.decision_reason || null;
    }
    res.json({
      eligibility: {
        restaurantId: String(restaurantId),
        status: eligibility ? eligibility.status : 'not_applied',
        ...(decisionReason ? { decisionReason } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  applyForEligibility,
  createTopup,
  getTopup,
  getEligibility,
  issueTopupStepupChallenge,
};
