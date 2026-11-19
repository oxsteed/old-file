'use strict';

// Restaurant wallet-earnings payout controller (merchant-facing).
// The restaurant owner requests payouts of the wallet/credit earnings that
// accumulated in restaurant_sub_bank; an admin approves and the service
// executes a Stripe Transfer to the restaurant's Connect account.

const db = require('../db');
const { AppError } = require('../middleware/errorHandler');
const payoutService = require('../services/restaurantPayoutService');

function parseRestaurantId(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new AppError('Invalid restaurant id', 400, 'validation_failed');
  }
  return n;
}

exports.getPayoutBalance = async (req, res, next) => {
  try {
    const restaurantId = parseRestaurantId(req.params.restaurantId);
    const currency = (req.query.currency || '').toString().toUpperCase() || null;
    const client = await db.connect();
    try {
      // G-18: managers read the balance too (owner or active manager of
      // the restaurant's business).
      const { rows } = await client.query(
        `SELECT fr.id, fr.display_name, fr.currency_code
           FROM food_restaurants fr
           JOIN businesses b ON b.id = fr.business_id
           LEFT JOIN business_members bm
             ON bm.business_id = b.id AND bm.member_id = $2 AND bm.status = 'active'
          WHERE fr.id = $1
            AND (b.user_id = $2 OR bm.role = 'manager')
            AND fr.status = 'active' AND b.is_active = TRUE AND b.deleted_at IS NULL`,
        [restaurantId, req.user.id]
      );
      const restaurant = rows[0];
      if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
      const balance = await payoutService.getPayoutableBalance(
        client,
        restaurantId,
        currency || restaurant.currency_code
      );
      res.json({
        restaurantId,
        currencyCode: balance.currencyCode,
        balanceCents: balance.balanceCents,
        minPayoutCents: payoutService.MIN_PAYOUT_CENTS,
        processorEnabled: payoutService.processorEnabled(),
      });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.requestPayout = async (req, res, next) => {
  try {
    const restaurantId = parseRestaurantId(req.params.restaurantId);
    // G-18: the gate already admitted owner-or-manager. The service
    // derives the status from the actor: owners request, managers draft.
    // req.restaurant is set by requirePayoutManager / requirePayoutReader.
    const payout = await payoutService.requestPayout({
      restaurantId,
      userId: req.user.id,
      amountCents: req.body.amountCents ?? req.body.amount_cents,
      currencyCode: req.body.currencyCode || req.body.currency_code,
      idempotencyKey:
        req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.idempotency_key,
      initialStatus: req.restaurant?.effective_role === 'owner' ? 'requested' : 'draft',
    });
    res.status(201).json({ payout });
  } catch (err) {
    next(err);
  }
};

// G-18: owner confirmation of a manager-drafted payout (draft -> requested).
exports.confirmDraftPayout = async (req, res, next) => {
  try {
    const restaurantId = parseRestaurantId(req.params.restaurantId);
    const payout = await payoutService.confirmDraftPayout({
      restaurantId,
      userId: req.user.id,
      payoutId: req.params.payoutId,
    });
    res.json({ payout });
  } catch (err) {
    next(err);
  }
};

exports.listPayouts = async (req, res, next) => {
  try {
    const restaurantId = parseRestaurantId(req.params.restaurantId);
    const client = await db.connect();
    try {
      const page = await payoutService.listPayouts(client, {
        restaurantId,
        userId: req.user.id,
        status: (req.query.status || '').toString() || undefined,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      res.json(page);
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};
