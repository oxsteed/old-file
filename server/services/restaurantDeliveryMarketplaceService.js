'use strict';

const storeMenu=require('./restaurantStoreMenuService');
const AppError = require('../utils/appError');
const { strictInteger } = require('../utils/strictInteger');

const PROVIDERS = new Set(['doordash', 'uber_eats', 'grubhub']);
const STATUSES = new Set(['enabled', 'disabled', 'error']);
const ORDER_TRANSITIONS = {
  received: new Set(['accepted', 'rejected', 'failed']),
  accepted: new Set(['preparing', 'cancelled', 'failed']),
  preparing: new Set(['ready', 'cancelled', 'failed']),
  ready: new Set(['picked_up', 'cancelled', 'failed']),
  picked_up: new Set(), rejected: new Set(), cancelled: new Set(), failed: new Set(),
};

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!PROVIDERS.has(provider)) throw new AppError('Unsupported delivery marketplace', 400, 'delivery_provider_invalid');
  return provider;
}

function normalizeStatus(value) {
  const status = String(value || 'disabled').trim().toLowerCase();
  if (!STATUSES.has(status)) throw new AppError('Delivery marketplace status is invalid', 400, 'delivery_status_invalid');
  return status;
}

function normalizeSecretRef(value, field) {
  if (value == null || value === '') return null;
  const ref = String(value).trim();
  if (!/^\{\{resolve:secretsmanager:[^{}]+:SecretString(?::[^{}]+)?\}\}$/.test(ref)) {
    throw new AppError(`${field} must be a Secrets Manager dynamic reference`, 400, 'delivery_secret_ref_invalid');
  }
  return ref;
}

function normalizeExternalLocation(value) {
  const location = String(value || '').trim();
  if (!location || location.length > 180) throw new AppError('External location ID is required', 400, 'delivery_location_invalid');
  return location;
}

function normalizeCurrency(value) {
  const currency = String(value || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new AppError('Currency must be a three-letter ISO code', 400, 'delivery_currency_invalid');
  return currency;
}

function normalizeAmount(value) {
  const amount = strictInteger(value, { min: 0 });
  if (!Number.isSafeInteger(amount) || amount < 0) throw new AppError('Order total is invalid', 400, 'delivery_amount_invalid');
  return amount;
}

function shapeIntegration(row) {
  return {
    id: Number(row.id), restaurantId: Number(row.restaurant_id), provider: row.provider,
    locationId: row.location_id == null ? null : Number(row.location_id),
    externalLocationId: row.external_location_id, status: row.status,
    credentialsConfigured: Boolean(row.credential_secret_ref),
    webhookConfigured: Boolean(row.webhook_secret_ref),
    lastMenuSyncAt: row.last_menu_sync_at || null, lastError: row.last_error || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function upsertIntegration(client, { restaurantId, provider, externalLocationId, status, credentialSecretRef, webhookSecretRef, metadata = {}, actorUserId, locationId = null }) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedStatus = normalizeStatus(status);
  const { rows: [row] } = await client.query(
    `INSERT INTO restaurant_delivery_marketplace_integrations
       (restaurant_id, provider, external_location_id, status, credential_secret_ref,
        webhook_secret_ref, metadata, created_by, updated_by, location_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,COALESCE($9,(SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary=TRUE)))
     ON CONFLICT (restaurant_id, provider, location_id) DO UPDATE SET
       external_location_id = EXCLUDED.external_location_id,
       status = EXCLUDED.status,
       credential_secret_ref = EXCLUDED.credential_secret_ref,
       webhook_secret_ref = EXCLUDED.webhook_secret_ref,
       metadata = EXCLUDED.metadata,
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [restaurantId, normalizedProvider, normalizeExternalLocation(externalLocationId), normalizedStatus,
      normalizeSecretRef(credentialSecretRef, 'credentialSecretRef'), normalizeSecretRef(webhookSecretRef, 'webhookSecretRef'), metadata || {}, actorUserId,locationId]
  );
  return shapeIntegration(row);
}

async function listIntegrations(client, restaurantId, allowedLocationIds = null) {
  const { rows } = await client.query(
    `SELECT * FROM restaurant_delivery_marketplace_integrations
      WHERE restaurant_id = $1 AND ($2::bigint[] IS NULL OR location_id=ANY($2::bigint[])) ORDER BY provider ASC`,
    [restaurantId,allowedLocationIds]
  );
  return rows.map(shapeIntegration);
}

async function menuSnapshot(client, restaurantId, locationId = null) {
  const { rows } = await client.query(
    `SELECT c.id AS category_id, c.name AS category_name, c.sort_order AS category_sort,
            i.id AS item_id, i.name AS item_name, i.description, i.price_cents,
            i.currency_code,i.is_available,i.manual_available,i.inventory_available,
            jsonb_build_object('is_available',sm.is_available,'available_again_at',sm.available_again_at,'price_cents',sm.price_cents,'inventory_available',sm.inventory_available) AS store_override,
            COALESCE(sm.price_cents,i.price_cents) AS store_price_cents,i.sort_order AS item_sort, i.tags
       FROM food_menu_categories c
       LEFT JOIN food_menu_items i ON i.category_id = c.id AND i.restaurant_id = c.restaurant_id
         AND i.publication_status = 'published' AND i.archived_at IS NULL
       LEFT JOIN restaurant_store_menu_overrides sm ON sm.restaurant_id=i.restaurant_id AND sm.menu_item_id=i.id
         AND sm.location_id=COALESCE($2,(SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary=TRUE))
      WHERE c.restaurant_id = $1 AND c.is_active = TRUE
      ORDER BY c.sort_order, c.id, i.sort_order, i.id`,
    [restaurantId,locationId]
  );
  return rows.reduce((categories, row) => {
    let category = categories.find((entry) => entry.id === Number(row.category_id));
    if (!category) {
      category = { id: Number(row.category_id), name: row.category_name, items: [] };
      categories.push(category);
    }
    row=storeMenu.applyOverride(row);
    if (row.item_id != null && row.is_available) {
      category.items.push({ id: Number(row.item_id), name: row.item_name, description: row.description || null, priceCents: Number(row.price_cents), currencyCode: row.currency_code, tags: row.tags || [] });
    }
    return categories;
  }, []);
}

async function ingestOrder(client, { restaurantId, provider, externalOrderId, currencyCode, totalCents, payload = {},locationId=null }) {
  const normalizedProvider = normalizeProvider(provider);
  const externalId = String(externalOrderId || '').trim();
  if (!externalId || externalId.length > 180) throw new AppError('External order ID is required', 400, 'delivery_order_id_invalid');
  const { rows: [integration] } = await client.query(
    `SELECT * FROM restaurant_delivery_marketplace_integrations
      WHERE restaurant_id = $1 AND provider = $2 AND status = 'enabled'
        AND location_id=COALESCE($3,(SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND is_primary=TRUE))
      FOR SHARE`,
    [restaurantId, normalizedProvider,locationId]
  );
  if (!integration) throw new AppError('Delivery marketplace is not enabled', 409, 'delivery_provider_disabled');
  const currency=normalizeCurrency(currencyCode),amount=normalizeAmount(totalCents);
  const {rows:[inserted]}=await client.query(`INSERT INTO restaurant_delivery_marketplace_orders
    (integration_id,restaurant_id,external_order_id,currency_code,total_cents,payload,location_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(integration_id,external_order_id) DO NOTHING RETURNING *`,
    [integration.id,restaurantId,externalId,currency,amount,payload||{},integration.location_id]);
  if(inserted)return {order:inserted,replayed:false};
  const {rows:[existing]}=await client.query('SELECT * FROM restaurant_delivery_marketplace_orders WHERE integration_id=$1 AND external_order_id=$2',[integration.id,externalId]);
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
  if(!existing||existing.currency_code!==currency||Number(existing.total_cents)!==amount||JSON.stringify(stable(existing.payload))!==JSON.stringify(stable(payload||{})))
    throw new AppError('Provider order replay changed',409,'delivery_order_replay_conflict');
  return {order:existing,replayed:true};
}

async function transitionOrder(client, { restaurantId, orderId, status }) {
  const next = String(status || '').trim().toLowerCase();
  const { rows: [current] } = await client.query(
    `SELECT * FROM restaurant_delivery_marketplace_orders
      WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
    [orderId, restaurantId]
  );
  if (!current) throw new AppError('Delivery marketplace order not found', 404, 'delivery_order_not_found');
  if (!ORDER_TRANSITIONS[current.status]?.has(next)) throw new AppError('Invalid delivery order transition', 409, 'delivery_order_transition_invalid');
  const { rows: [updated] } = await client.query(
    `UPDATE restaurant_delivery_marketplace_orders SET status = $3, updated_at = NOW()
      WHERE id = $1 AND restaurant_id = $2 RETURNING *`,
    [orderId, restaurantId, next]
  );
  return updated;
}

module.exports = { normalizeProvider, normalizeStatus, normalizeSecretRef, normalizeExternalLocation, normalizeCurrency, normalizeAmount, shapeIntegration, upsertIntegration, listIntegrations, menuSnapshot, ingestOrder, transitionOrder };
