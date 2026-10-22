'use strict';

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
    externalLocationId: row.external_location_id, status: row.status,
    credentialsConfigured: Boolean(row.credential_secret_ref),
    webhookConfigured: Boolean(row.webhook_secret_ref),
    lastMenuSyncAt: row.last_menu_sync_at || null, lastError: row.last_error || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function upsertIntegration(client, { restaurantId, provider, externalLocationId, status, credentialSecretRef, webhookSecretRef, metadata = {}, actorUserId }) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedStatus = normalizeStatus(status);
  const { rows: [row] } = await client.query(
    `INSERT INTO restaurant_delivery_marketplace_integrations
       (restaurant_id, provider, external_location_id, status, credential_secret_ref,
        webhook_secret_ref, metadata, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT (restaurant_id, provider) DO UPDATE SET
       external_location_id = EXCLUDED.external_location_id,
       status = EXCLUDED.status,
       credential_secret_ref = EXCLUDED.credential_secret_ref,
       webhook_secret_ref = EXCLUDED.webhook_secret_ref,
       metadata = EXCLUDED.metadata,
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [restaurantId, normalizedProvider, normalizeExternalLocation(externalLocationId), normalizedStatus,
      normalizeSecretRef(credentialSecretRef, 'credentialSecretRef'), normalizeSecretRef(webhookSecretRef, 'webhookSecretRef'), metadata || {}, actorUserId]
  );
  return shapeIntegration(row);
}

async function listIntegrations(client, restaurantId) {
  const { rows } = await client.query(
    `SELECT * FROM restaurant_delivery_marketplace_integrations
      WHERE restaurant_id = $1 ORDER BY provider ASC`,
    [restaurantId]
  );
  return rows.map(shapeIntegration);
}

async function menuSnapshot(client, restaurantId) {
  const { rows } = await client.query(
    `SELECT c.id AS category_id, c.name AS category_name, c.sort_order AS category_sort,
            i.id AS item_id, i.name AS item_name, i.description, i.price_cents,
            i.currency_code, i.is_available, i.sort_order AS item_sort, i.tags
       FROM food_menu_categories c
       LEFT JOIN food_menu_items i ON i.category_id = c.id AND i.restaurant_id = c.restaurant_id
         AND i.publication_status = 'published' AND i.archived_at IS NULL
      WHERE c.restaurant_id = $1 AND c.is_active = TRUE
      ORDER BY c.sort_order, c.id, i.sort_order, i.id`,
    [restaurantId]
  );
  return rows.reduce((categories, row) => {
    let category = categories.find((entry) => entry.id === Number(row.category_id));
    if (!category) {
      category = { id: Number(row.category_id), name: row.category_name, items: [] };
      categories.push(category);
    }
    if (row.item_id != null && row.is_available) {
      category.items.push({ id: Number(row.item_id), name: row.item_name, description: row.description || null, priceCents: Number(row.price_cents), currencyCode: row.currency_code, tags: row.tags || [] });
    }
    return categories;
  }, []);
}

async function ingestOrder(client, { restaurantId, provider, externalOrderId, currencyCode, totalCents, payload = {} }) {
  const normalizedProvider = normalizeProvider(provider);
  const externalId = String(externalOrderId || '').trim();
  if (!externalId || externalId.length > 180) throw new AppError('External order ID is required', 400, 'delivery_order_id_invalid');
  const { rows: [integration] } = await client.query(
    `SELECT * FROM restaurant_delivery_marketplace_integrations
      WHERE restaurant_id = $1 AND provider = $2 AND status = 'enabled'
      FOR SHARE`,
    [restaurantId, normalizedProvider]
  );
  if (!integration) throw new AppError('Delivery marketplace is not enabled', 409, 'delivery_provider_disabled');
  const { rows: [existing] } = await client.query(
    `SELECT * FROM restaurant_delivery_marketplace_orders
      WHERE integration_id = $1 AND external_order_id = $2`,
    [integration.id, externalId]
  );
  if (existing) return { order: existing, replayed: true };
  const { rows: [order] } = await client.query(
    `INSERT INTO restaurant_delivery_marketplace_orders
       (integration_id, restaurant_id, external_order_id, currency_code, total_cents, payload)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [integration.id, restaurantId, externalId, normalizeCurrency(currencyCode), normalizeAmount(totalCents), payload || {}]
  );
  return { order, replayed: false };
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
