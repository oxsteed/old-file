'use strict';

const { AppError } = require('../middleware/errorHandler');
const cardService = require('../services/oxsteedCreditCardService');
const { requireDeviceCredential, assertDeviceApp } = require('./restaurantAppFlowController');

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function parsePositiveInt(value, fieldName = 'id') {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
  return parsed;
}

function parseUuid(value, fieldName) {
  const normalized = normalizeString(value, 80);
  if (!normalized || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
  }
  return normalized;
}

function getIdempotencyKey(req) {
  return normalizeString(req.get('Idempotency-Key') || req.body?.idempotencyKey || req.body?.idempotency_key, 160);
}

function getRequestContext(req) {
  return {
    actorUserId: req.user?.id || null,
    correlationId: req.correlationId || req.get('X-Request-ID') || null,
    requestIp: req.ip || null,
  };
}

// ---------------------------------------------------------------------------
// Customer-facing: /api/oxsteed-credit/cards/*
// (mounted under the existing authenticate + requireRole('customer') pipeline)
// ---------------------------------------------------------------------------

async function listMyCards(req, res, next) {
  try {
    const cards = await cardService.listCustomerCards(req.user.id);
    res.json({ cards });
  } catch (error) {
    next(error);
  }
}

async function issueMyVirtualCard(req, res, next) {
  try {
    const result = await cardService.issueVirtualCard({
      customerId: req.user.id,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      nickname: req.body?.nickname,
      idempotencyKey: getIdempotencyKey(req),
      ...getRequestContext(req),
      metadata: { source: 'api' },
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function requestMyPhysicalCard(req, res, next) {
  try {
    const result = await cardService.requestPhysicalCard({
      customerId: req.user.id,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      nickname: req.body?.nickname,
      shippingAddress: req.body?.shippingAddress || req.body?.shipping_address,
      idempotencyKey: getIdempotencyKey(req),
      ...getRequestContext(req),
      metadata: { source: 'api' },
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function activateMyCard(req, res, next) {
  try {
    const cardId = parseUuid(req.params.cardId, 'cardId');
    const result = await cardService.activatePhysicalCard({
      cardId,
      customerId: req.user.id,
      activationCode: req.body?.activationCode || req.body?.activation_code,
      ...getRequestContext(req),
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function freezeMyCard(req, res, next) {
  try {
    const cardId = parseUuid(req.params.cardId, 'cardId');
    const result = await cardService.freezeCard({ cardId, customerId: req.user.id, reason: req.body?.reason, ...getRequestContext(req) });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function unfreezeMyCard(req, res, next) {
  try {
    const cardId = parseUuid(req.params.cardId, 'cardId');
    const result = await cardService.unfreezeCard({ cardId, customerId: req.user.id, reason: req.body?.reason, ...getRequestContext(req) });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function reportMyCardLost(req, res, next) {
  try {
    const cardId = parseUuid(req.params.cardId, 'cardId');
    const status = normalizeString(req.body?.status, 10) === 'stolen' ? 'stolen' : 'lost';
    const result = await cardService.reportCardLostOrStolen({
      cardId,
      customerId: req.user.id,
      status,
      reason: req.body?.reason,
      issueReplacement: req.body?.issueReplacement !== false,
      ...getRequestContext(req),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function setMyCardPin(req, res, next) {
  try {
    const cardId = parseUuid(req.params.cardId, 'cardId');
    const result = await cardService.setCardPin({ cardId, customerId: req.user.id, pin: req.body?.pin, ...getRequestContext(req) });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Admin-facing: /api/admin/super/oxsteed-credit/cards/*
// (mounted under requireSuperAdmin in routes/admin.js)
// ---------------------------------------------------------------------------

async function adminIssueVirtualCard(req, res, next) {
  try {
    const customerId = parseUuid(req.body?.customerId || req.body?.customer_id, 'customerId');
    const result = await cardService.adminIssueVirtualCard({
      customerId,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      nickname: req.body?.nickname,
      idempotencyKey: getIdempotencyKey(req),
      reason: req.body?.reason,
      ...getRequestContext(req),
      metadata: { source: 'api', issuedByAdmin: true },
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function adminIssuePhysicalCard(req, res, next) {
  try {
    const customerId = parseUuid(req.body?.customerId || req.body?.customer_id, 'customerId');
    const result = await cardService.adminIssuePhysicalCard({
      customerId,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      nickname: req.body?.nickname,
      shippingAddress: req.body?.shippingAddress || req.body?.shipping_address,
      idempotencyKey: getIdempotencyKey(req),
      reason: req.body?.reason,
      ...getRequestContext(req),
      metadata: { source: 'api', issuedByAdmin: true },
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function listAdminCards(req, res, next) {
  try {
    const cards = await cardService.adminListCards({
      customerId: req.query.customerId,
      status: req.query.status,
      cardType: req.query.cardType,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ cards });
  } catch (error) {
    next(error);
  }
}

async function updateAdminCardFulfillment(req, res, next) {
  try {
    const cardId = parseUuid(req.params.cardId, 'cardId');
    const result = await cardService.markCardFulfillment({
      cardId,
      fulfillmentStatus: req.body?.fulfillmentStatus || req.body?.fulfillment_status,
      reason: req.body?.reason,
      ...getRequestContext(req),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function revokeAdminCard(req, res, next) {
  try {
    const cardId = parseUuid(req.params.cardId, 'cardId');
    const result = await cardService.revokeCard({ cardId, reason: req.body?.reason, ...getRequestContext(req) });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Kiosk-facing: /api/restaurants/:restaurantId/credit-kiosks/:deviceId/*
// Device-authenticated the same way POS/Kitchen/Display already are, via the
// existing restaurant_app_devices pairing/token model (app_key='credit_kiosk').
// ---------------------------------------------------------------------------

async function authenticateCreditKiosk(req, res, next) {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId, 'restaurantId');
    const deviceId = parsePositiveInt(req.params.deviceId, 'deviceId');
    const device = await requireDeviceCredential(req, restaurantId, deviceId);
    assertDeviceApp(device, 'credit_kiosk');
    req.creditKioskDevice = device;
    req.creditKioskRestaurantId = restaurantId;
    next();
  } catch (error) {
    next(error);
  }
}

// Resolves the OxSteed Credit partner tied to this restaurant, so a kiosk
// redemption debits the same partner ledger a QR-code purchase would.
async function requireCreditPartnerForRestaurant(restaurantId) {
  const pool = require('../db');
  const { rows } = await pool.query(
    `SELECT id FROM oxsteed_credit_partners WHERE restaurant_id = $1 AND status = 'active'`,
    [restaurantId]
  );
  if (!rows[0]) {
    throw new AppError('This restaurant is not an active OxSteed Credit partner', 409, 'credit_partner_not_active');
  }
  return rows[0].id;
}

async function kioskRedeemCard(req, res, next) {
  try {
    const partnerId = await requireCreditPartnerForRestaurant(req.creditKioskRestaurantId);
    const idempotencyKey = getIdempotencyKey(req) || `kiosk:${req.creditKioskDevice.id}:${req.body?.clientRequestId || ''}`;
    const result = await cardService.redeemCardAtPartner({
      credential: req.body?.credential,
      partnerId,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      idempotencyKey,
      orderType: req.body?.orderType || req.body?.order_type,
      referenceType: 'credit_kiosk_redemption',
      referenceId: String(req.creditKioskDevice.id),
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
      description: req.body?.description,
      actorType: 'kiosk',
      metadata: { kioskDeviceId: req.creditKioskDevice.id, restaurantId: req.creditKioskRestaurantId },
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function kioskCashOut(req, res, next) {
  try {
    const idempotencyKey = getIdempotencyKey(req) || `kiosk-cashout:${req.creditKioskDevice.id}:${req.body?.clientRequestId || ''}`;
    const result = await cardService.cashOutWithCard({
      credential: req.body?.credential,
      pin: req.body?.pin,
      kioskDeviceId: req.creditKioskDevice.id,
      partnerId: null,
      amountCents: req.body?.amountCents ?? req.body?.amount_cents,
      currencyCode: req.body?.currencyCode || req.body?.currency_code,
      idempotencyKey,
      correlationId: req.correlationId || req.get('X-Request-ID') || null,
      requestIp: req.ip || null,
      metadata: { restaurantId: req.creditKioskRestaurantId },
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listMyCards,
  issueMyVirtualCard,
  requestMyPhysicalCard,
  activateMyCard,
  freezeMyCard,
  unfreezeMyCard,
  reportMyCardLost,
  setMyCardPin,
  adminIssueVirtualCard,
  adminIssuePhysicalCard,
  listAdminCards,
  updateAdminCardFulfillment,
  revokeAdminCard,
  authenticateCreditKiosk,
  kioskRedeemCard,
  kioskCashOut,
};
