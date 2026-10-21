'use strict';

const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
const marketplace = require('../services/restaurantDeliveryMarketplaceService');

async function access(req) {
  const restaurantId = Number.parseInt(req.params.restaurantId, 10);
  if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['settings.manage', 'pos.manage']))) {
    throw new AppError('You do not have permission to manage delivery marketplaces', 403, 'forbidden');
  }
  return restaurant;
}

function positiveId(value, field) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(`${field} is invalid`, 400, 'validation_failed');
  return id;
}

exports.listIntegrations = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    res.json({ integrations: await marketplace.listIntegrations(pool, restaurant.id), providerOrderQueueEnabled: true });
  } catch (err) { next(err); }
};

exports.upsertIntegration = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const integration = await withTransaction(pool, (client) => marketplace.upsertIntegration(client, {
      restaurantId: restaurant.id,
      provider: req.body?.provider,
      externalLocationId: req.body?.externalLocationId ?? req.body?.external_location_id,
      status: req.body?.status,
      credentialSecretRef: req.body?.credentialSecretRef ?? req.body?.credential_secret_ref,
      webhookSecretRef: req.body?.webhookSecretRef ?? req.body?.webhook_secret_ref,
      metadata: req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata) ? req.body.metadata : {},
      actorUserId: req.user.id,
    }), 'restaurant_delivery_marketplace_upsert');
    await logBusinessAction(req, {
      business_id: restaurant.business_id, actor_role: restaurant.effective_role,
      action: 'restaurant.delivery_marketplace.updated', target_type: 'restaurant_delivery_marketplace_integration',
      target_id: integration.id, before_state: {}, after_state: integration, metadata: {}, throwOnError: true,
    });
    res.json({ integration, providerOrderQueueEnabled: true });
  } catch (err) { next(err); }
};

exports.menu = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const provider = marketplace.normalizeProvider(req.params.provider);
    const { rows: [integration] } = await pool.query(
      'SELECT * FROM restaurant_delivery_marketplace_integrations WHERE restaurant_id = $1 AND provider = $2',
      [restaurant.id, provider]
    );
    if (!integration || integration.status !== 'enabled') throw new AppError('Delivery marketplace is not enabled', 409, 'delivery_provider_disabled');
    const categories = await marketplace.menuSnapshot(pool, restaurant.id);
    res.json({ provider, externalLocationId: integration.external_location_id, currencyCode: restaurant.currency_code, categories, version: new Date().toISOString() });
  } catch (err) { next(err); }
};

exports.ingestOrder = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const result = await withTransaction(pool, (client) => marketplace.ingestOrder(client, {
      restaurantId: restaurant.id,
      provider: req.params.provider,
      externalOrderId: req.body?.externalOrderId ?? req.body?.external_order_id,
      currencyCode: req.body?.currencyCode ?? req.body?.currency_code,
      totalCents: req.body?.totalCents ?? req.body?.total_cents,
      payload: req.body?.payload && typeof req.body.payload === 'object' && !Array.isArray(req.body.payload) ? req.body.payload : {},
    }), 'restaurant_delivery_marketplace_order');
    res.status(result.replayed ? 200 : 202).json({ order: { id: Number(result.order.id), status: result.order.status, externalOrderId: result.order.external_order_id, totalCents: Number(result.order.total_cents), currencyCode: result.order.currency_code }, replayed: result.replayed });
  } catch (err) { next(err); }
};

exports.transitionOrder = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const order = await withTransaction(pool, (client) => marketplace.transitionOrder(client, {
      restaurantId: restaurant.id, orderId: positiveId(req.params.orderId, 'orderId'), status: req.body?.status,
    }), 'restaurant_delivery_marketplace_transition');
    res.json({ order: { id: Number(order.id), status: order.status, externalOrderId: order.external_order_id } });
  } catch (err) { next(err); }
};

exports._normalize = { positiveId };
