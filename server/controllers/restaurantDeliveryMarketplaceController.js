'use strict';

const pool = require('../db');
const { strictInteger } = require('../utils/strictInteger');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
const marketplace = require('../services/restaurantDeliveryMarketplaceService');
const {getLocationScope}=require('../services/restaurantLocationAccessService');

async function access(req) {
  const restaurantId = strictInteger(req.params.restaurantId);
  if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['settings.manage', 'pos.manage']))) {
    throw new AppError('You do not have permission to manage delivery marketplaces', 403, 'forbidden');
  }
  return {...restaurant,locationScope:await getLocationScope(restaurant,req.user.id)};
}

async function storeId(req,restaurant){
  let locationId=req.body?.locationId??req.query?.locationId;
  if(locationId==null&&restaurant.locationScope.mode==='assigned'){
    if(restaurant.locationScope.location_ids.length!==1)throw new AppError('Choose a store',400,'location_required');
    locationId=restaurant.locationScope.location_ids[0];
  }
  if(locationId==null)locationId=(await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary=TRUE',[restaurant.id])).rows[0]?.id;
  locationId=positiveId(locationId,'locationId');
  if(restaurant.locationScope.mode==='assigned'&&!restaurant.locationScope.location_ids.includes(locationId))throw new AppError('Store access denied',403,'location_scope_forbidden');
  const {rows:[store]}=await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND id=$2',[restaurant.id,locationId]);
  if(!store)throw new AppError('Store not found',404,'location_not_found');return locationId;
}

function positiveId(value, field) {
  const id = strictInteger(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(`${field} is invalid`, 400, 'validation_failed');
  return id;
}

exports.listIntegrations = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    res.json({ integrations: await marketplace.listIntegrations(pool, restaurant.id,restaurant.locationScope.mode==='assigned'?restaurant.locationScope.location_ids:null), providerOrderQueueEnabled: true });
  } catch (err) { next(err); }
};

exports.upsertIntegration = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const locationId=await storeId(req,restaurant);
    const integration = await withTransaction(pool, async (client) => {
      const provider = marketplace.normalizeProvider(req.body?.provider);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`marketplace:${restaurant.id}:${locationId}:${provider}`]);
      const { rows: [before] } = await client.query('SELECT * FROM restaurant_delivery_marketplace_integrations WHERE restaurant_id=$1 AND provider=$2 AND location_id=$3 FOR UPDATE', [restaurant.id, provider,locationId]);
      const integration = await marketplace.upsertIntegration(client, {
        restaurantId: restaurant.id,
        locationId,
        provider: req.body?.provider,
        externalLocationId: req.body?.externalLocationId ?? req.body?.external_location_id,
        status: req.body?.status,
        credentialSecretRef: req.body?.credentialSecretRef ?? req.body?.credential_secret_ref,
        webhookSecretRef: req.body?.webhookSecretRef ?? req.body?.webhook_secret_ref,
        metadata: req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata) ? req.body.metadata : {},
        actorUserId: req.user.id,
      });
      await logBusinessAction(req, {
        client,
        business_id: restaurant.business_id, actor_role: restaurant.effective_role,
        action: 'restaurant.delivery_marketplace.updated', target_type: 'restaurant_delivery_marketplace_integration',
        target_id: integration.id, before_state: before ? { id: before.id, provider: before.provider, status: before.status, externalLocationId: before.external_location_id } : {}, after_state: integration, metadata: {}, throwOnError: true,
      });
      return integration;
    }, 'restaurant_delivery_marketplace_upsert');
    res.json({ integration, providerOrderQueueEnabled: true });
  } catch (err) { next(err); }
};

exports.menu = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const locationId=await storeId(req,restaurant);
    const provider = marketplace.normalizeProvider(req.params.provider);
    const { rows: [integration] } = await pool.query(
      'SELECT * FROM restaurant_delivery_marketplace_integrations WHERE restaurant_id = $1 AND provider = $2 AND location_id=$3',
      [restaurant.id, provider,locationId]
    );
    if (!integration || integration.status !== 'enabled') throw new AppError('Delivery marketplace is not enabled', 409, 'delivery_provider_disabled');
    const categories = await marketplace.menuSnapshot(pool, restaurant.id,locationId);
    res.json({ provider, externalLocationId: integration.external_location_id, currencyCode: restaurant.currency_code, categories, version: new Date().toISOString() });
  } catch (err) { next(err); }
};

exports.ingestOrder = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const locationId=await storeId(req,restaurant);
    const result = await withTransaction(pool, async (client) => {
      const result = await marketplace.ingestOrder(client, {
        restaurantId: restaurant.id,
        locationId,
        provider: req.params.provider,
        externalOrderId: req.body?.externalOrderId ?? req.body?.external_order_id,
        currencyCode: req.body?.currencyCode ?? req.body?.currency_code,
        totalCents: req.body?.totalCents ?? req.body?.total_cents,
        payload: req.body?.payload && typeof req.body.payload === 'object' && !Array.isArray(req.body.payload) ? req.body.payload : {},
      });
      await logBusinessAction(req, {
        client,
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.delivery_marketplace.order_ingested',
        target_type: 'restaurant_delivery_marketplace_order',
        target_id: result.order.id,
        before_state: {},
        after_state: { id: result.order.id, status: result.order.status, total_cents: result.order.total_cents, currency_code: result.order.currency_code },
        metadata: { provider: req.params.provider, external_order_id: result.order.external_order_id, replayed: result.replayed },
        throwOnError: true,
      });
      return result;
    }, 'restaurant_delivery_marketplace_order');
    res.status(result.replayed ? 200 : 202).json({ order: { id: Number(result.order.id), status: result.order.status, externalOrderId: result.order.external_order_id, totalCents: Number(result.order.total_cents), currencyCode: result.order.currency_code }, replayed: result.replayed });
  } catch (err) { next(err); }
};

exports.transitionOrder = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const orderId = positiveId(req.params.orderId, 'orderId');
    const order = await withTransaction(pool, async (client) => {
      const { rows: [before] } = await client.query(
        'SELECT id, status, location_id,total_cents, currency_code, external_order_id FROM restaurant_delivery_marketplace_orders WHERE id = $1 AND restaurant_id = $2 FOR UPDATE',
        [orderId, restaurant.id]
      );
      if (!before) throw new AppError('Delivery marketplace order not found', 404, 'delivery_order_not_found');
      if(restaurant.locationScope.mode==='assigned'&&!restaurant.locationScope.location_ids.includes(Number(before.location_id)))throw new AppError('Store access denied',403,'location_scope_forbidden');
      const order = await marketplace.transitionOrder(client, {
        restaurantId: restaurant.id, orderId, status: req.body?.status,
      });
      await logBusinessAction(req, {
        client,
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.delivery_marketplace.order_transitioned',
        target_type: 'restaurant_delivery_marketplace_order',
        target_id: order.id,
        before_state: before,
        after_state: { id: order.id, status: order.status, total_cents: order.total_cents, currency_code: order.currency_code, external_order_id: order.external_order_id },
        metadata: { requested_status: req.body?.status },
        throwOnError: true,
      });
      return order;
    }, 'restaurant_delivery_marketplace_transition');
    res.json({ order: { id: Number(order.id), status: order.status, externalOrderId: order.external_order_id } });
  } catch (err) { next(err); }
};

exports._normalize = { positiveId };
