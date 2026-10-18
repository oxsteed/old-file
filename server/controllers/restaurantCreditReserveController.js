'use strict';

/**
 * Phase 4: restaurant credit pre-purchase reserve ("gift card inventory" model).
 *
 * POST /api/food/merchant/credit-reserve/purchase
 * POST /api/food/merchant/credit-reserve/purchase/:purchaseId/confirm
 * GET  /api/food/merchant/credit-reserve/balance
 * GET  /api/food/merchant/credit-reserve/ledger
 *
 * Restaurant operator only (requireRestaurantAccess + assertWalletOperator,
 * the same pattern as the merchant wallet surface). The restaurant is
 * resolved from the body (POST) or query (GET) so the route shape stays
 * stable; the controller 404s when the caller has no access to it.
 */

const { AppError } = require('../middleware/errorHandler');
// Canonical restaurant access gate (analytics scope model, Phase 1 Item 6).
// Formerly imported from foodWalletController; the shared gate has the same
// ownership CASE and 404 (no fast-fail guard on either path).
const { resolveRestaurantAccess: requireRestaurantAccess } = require('../services/scopeModel');
const {
  assertWalletOperator,
} = require('./foodWalletController');
const reserveService = require('../services/restaurantCreditReserveService');

function parsePositiveInt(value, fallback = null) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function resolveRestaurantId(req) {
  const fromBody = req.body?.restaurantId ?? req.body?.restaurant_id;
  const fromQuery = req.query?.restaurantId ?? req.query?.restaurant_id;
  return parsePositiveInt(fromBody ?? fromQuery);
}

async function authorizeOperator(req) {
  const restaurantId = resolveRestaurantId(req);
  if (!restaurantId) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
  assertWalletOperator(restaurant);
  return { restaurantId, restaurant };
}

function formatReserve(row) {
  if (!row) return null;
  return {
    restaurantId: String(row.restaurant_id),
    balanceCents: Number(row.balance_cents || 0),
    currencyCode: row.currency_code || 'USD',
    lifetimePurchasedCents: Number(row.lifetime_purchased_cents || 0),
    lifetimeIssuedCents: Number(row.lifetime_issued_cents || 0),
    updatedAt: row.updated_at || null,
  };
}

function formatPurchase(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    restaurantId: String(row.restaurant_id),
    amountCents: Number(row.amount_cents || 0),
    feeCents: Number(row.fee_cents || 0),
    issuableCents: Number(row.issuable_cents || 0),
    currencyCode: row.currency_code || 'USD',
    status: row.status,
    stripePaymentIntentId: row.stripe_payment_intent_id || null,
    confirmedAt: row.confirmed_at || null,
    createdAt: row.created_at || null,
  };
}

function formatLedgerEntry(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    restaurantId: String(row.restaurant_id),
    amountCents: Number(row.amount_cents || 0),
    balanceAfterCents: Number(row.balance_after_cents || 0),
    referenceType: row.reference_type,
    referenceId: row.reference_id || null,
    stripePaymentIntentId: row.stripe_payment_intent_id || null,
    createdAt: row.created_at || null,
  };
}

exports.purchaseCreditReserve = async (req, res, next) => {
  try {
    const { restaurantId, restaurant } = await authorizeOperator(req);
    const rawAmount = req.body?.amountCents ?? req.body?.amount_cents;
    const amountCents = rawAmount === undefined || rawAmount === null
      ? null
      : Math.round(Number(rawAmount));
    if (amountCents === null || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        amountCents: 'Amount is required as a positive number of cents',
      });
    }
    const idempotencyKey = normalizeString(req.body?.idempotencyKey || req.body?.idempotency_key, 120);
    if (!idempotencyKey) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        idempotencyKey: 'An idempotency key is required',
      });
    }
    const result = await reserveService.createReservePurchase({
      restaurantId,
      operatorUserId: req.user.id,
      amountCents,
      currencyCode: restaurant.currency_code,
      idempotencyKey,
    });
    res.json({
      purchase: formatPurchase(result.purchase),
      clientSecret: result.clientSecret,
      feeCents: result.feeCents,
      issuableCents: result.issuableCents,
      replayed: Boolean(result.replayed),
    });
  } catch (err) {
    next(err);
  }
};

exports.confirmCreditReservePurchase = async (req, res, next) => {
  try {
    const { restaurantId } = await authorizeOperator(req);
    const purchaseId = parsePositiveInt(req.params.purchaseId);
    if (!purchaseId) {
      throw new AppError('Reserve purchase not found', 404, 'credit_reserve_purchase_not_found');
    }
    const result = await reserveService.confirmReservePurchase({ restaurantId, purchaseId });
    res.json({
      purchase: formatPurchase(result.purchase),
      reserve: formatReserve(result.reserve),
      ledgerEntry: formatLedgerEntry(result.ledgerEntry),
      duplicate: Boolean(result.duplicate),
    });
  } catch (err) {
    next(err);
  }
};

exports.getCreditReserveBalance = async (req, res, next) => {
  try {
    const { restaurantId, restaurant } = await authorizeOperator(req);
    const reserve = await reserveService.getReserveBalance(restaurantId);
    res.json({
      optedIn: Boolean(reserve),
      balanceCents: Number(reserve?.balance_cents || 0),
      currencyCode: reserve?.currency_code || restaurant.currency_code || 'USD',
      lifetimePurchasedCents: Number(reserve?.lifetime_purchased_cents || 0),
      lifetimeIssuedCents: Number(reserve?.lifetime_issued_cents || 0),
      updatedAt: reserve?.updated_at || null,
    });
  } catch (err) {
    next(err);
  }
};

exports.listCreditReserveLedger = async (req, res, next) => {
  try {
    const { restaurantId } = await authorizeOperator(req);
    const { entries, total, limit, offset } = await reserveService.listReserveLedger(restaurantId, {
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({
      entries: entries.map(formatLedgerEntry),
      total,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
};
