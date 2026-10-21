'use strict';

// Gift-card product catalog only. Issuing, redeeming, refunding, and storing
// value are intentionally outside this controller until a provider and
// reconciliation contract are enabled.
const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const { logBusinessAction } = require('../services/businessAuditLog');

const MAX_AMOUNT_CENTS = 1_000_000;

async function access(req) {
  const restaurantId = Number.parseInt(req.params.restaurantId, 10);
  if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['menu.manage', 'settings.manage']))) {
    throw new AppError('You do not have permission to manage gift-card products', 403, 'forbidden');
  }
  return restaurant;
}

function normalizeSku(value) {
  const sku = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(sku)) {
    throw new AppError('SKU must contain 2-64 letters, numbers, hyphens, or underscores', 400, 'validation_failed', { sku: 'Invalid SKU' });
  }
  return sku;
}

function normalizeName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 160) {
    throw new AppError('Gift-card product name is required', 400, 'validation_failed', { name: 'Required, max 160 characters' });
  }
  return name;
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_AMOUNT_CENTS) {
    throw new AppError('Gift-card amount must be 1-1000000 cents', 400, 'validation_failed', { amountCents: 'Invalid amount' });
  }
  return amount;
}

function normalizeCurrency(value) {
  const currency = String(value || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppError('Currency must be a three-letter ISO code', 400, 'validation_failed', { currencyCode: 'Invalid currency' });
  }
  return currency;
}

function normalizeDeliveryType(value) {
  const type = String(value || '').trim().toLowerCase().replace('-', '_');
  if (!['physical', 'e_gift'].includes(type)) {
    throw new AppError('Delivery type must be physical or e_gift', 400, 'validation_failed', { deliveryType: 'Invalid delivery type' });
  }
  return type;
}

function normalizeActive(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  throw new AppError('isActive must be a boolean', 400, 'validation_failed', { isActive: 'Invalid active flag' });
}

function shape(row) {
  return {
    id: Number(row.id),
    restaurantId: Number(row.restaurant_id),
    sku: row.sku,
    name: row.name,
    amountCents: Number(row.amount_cents),
    currencyCode: row.currency_code,
    deliveryType: row.delivery_type,
    isActive: Boolean(row.is_active),
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

exports.listProducts = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const { rows } = await pool.query(
      `SELECT id, restaurant_id, sku, name, amount_cents, currency_code,
              delivery_type, is_active, metadata, created_at, updated_at
         FROM restaurant_gift_card_products
        WHERE restaurant_id = $1
        ORDER BY is_active DESC, delivery_type ASC, amount_cents ASC, id ASC`,
      [restaurant.id]
    );
    res.json({ products: rows.map(shape), valueIssuanceEnabled: false });
  } catch (err) { next(err); }
};

exports.createProduct = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const body = req.body || {};
    const sku = normalizeSku(body.sku);
    const name = normalizeName(body.name);
    const amountCents = normalizeAmount(body.amountCents ?? body.amount_cents);
    const currencyCode = normalizeCurrency(body.currencyCode ?? body.currency_code);
    const deliveryType = normalizeDeliveryType(body.deliveryType ?? body.delivery_type);
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {};
    const { rows: [product] } = await pool.query(
      `INSERT INTO restaurant_gift_card_products
         (restaurant_id, sku, name, amount_cents, currency_code, delivery_type, metadata, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING id, restaurant_id, sku, name, amount_cents, currency_code,
                 delivery_type, is_active, metadata, created_at, updated_at`,
      [restaurant.id, sku, name, amountCents, currencyCode, deliveryType, JSON.stringify(metadata), req.user.id]
    );
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role,
      action: 'restaurant.gift_card_product.created',
      target_type: 'restaurant_gift_card_product',
      target_id: product.id,
      before_state: {},
      after_state: product,
      metadata: { value_issuance_enabled: false },
      throwOnError: true,
    });
    res.status(201).json({ product: shape(product), valueIssuanceEnabled: false });
  } catch (err) {
    if (err?.code === '23505') return next(new AppError('That gift-card SKU already exists', 409, 'gift_card_sku_exists'));
    next(err);
  }
};

exports.updateProduct = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const productId = Number.parseInt(req.params.productId, 10);
    if (!Number.isSafeInteger(productId) || productId <= 0) throw new AppError('Gift-card product not found', 404, 'gift_card_product_not_found');
    const body = req.body || {};
    const { rows: [before] } = await pool.query(
      'SELECT * FROM restaurant_gift_card_products WHERE id = $1 AND restaurant_id = $2',
      [productId, restaurant.id]
    );
    if (!before) throw new AppError('Gift-card product not found', 404, 'gift_card_product_not_found');
    const sku = body.sku === undefined ? before.sku : normalizeSku(body.sku);
    const name = body.name === undefined ? before.name : normalizeName(body.name);
    const amountCents = body.amountCents === undefined && body.amount_cents === undefined
      ? Number(before.amount_cents) : normalizeAmount(body.amountCents ?? body.amount_cents);
    const currencyCode = body.currencyCode === undefined && body.currency_code === undefined
      ? before.currency_code : normalizeCurrency(body.currencyCode ?? body.currency_code);
    const deliveryType = body.deliveryType === undefined && body.delivery_type === undefined
      ? before.delivery_type : normalizeDeliveryType(body.deliveryType ?? body.delivery_type);
    const isActive = body.isActive === undefined && body.is_active === undefined
      ? Boolean(before.is_active) : normalizeActive(body.isActive ?? body.is_active);
    const metadata = body.metadata === undefined ? (before.metadata || {})
      : (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {});
    const { rows: [after] } = await pool.query(
      `UPDATE restaurant_gift_card_products
          SET sku = $3, name = $4, amount_cents = $5, currency_code = $6,
              delivery_type = $7, is_active = $8, metadata = $9, updated_by = $10
        WHERE id = $1 AND restaurant_id = $2
       RETURNING id, restaurant_id, sku, name, amount_cents, currency_code,
                 delivery_type, is_active, metadata, created_at, updated_at`,
      [productId, restaurant.id, sku, name, amountCents, currencyCode, deliveryType, isActive, JSON.stringify(metadata), req.user.id]
    );
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role,
      action: 'restaurant.gift_card_product.updated',
      target_type: 'restaurant_gift_card_product',
      target_id: productId,
      before_state: before,
      after_state: after,
      metadata: { value_issuance_enabled: false },
      throwOnError: true,
    });
    res.json({ product: shape(after), valueIssuanceEnabled: false });
  } catch (err) {
    if (err?.code === '23505') return next(new AppError('That gift-card SKU already exists', 409, 'gift_card_sku_exists'));
    next(err);
  }
};

exports._normalize = { normalizeSku, normalizeName, normalizeAmount, normalizeCurrency, normalizeDeliveryType, normalizeActive };
