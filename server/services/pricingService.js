// server/services/pricingService.js
/**
 * Dynamic pricing service for location-based premium tier pricing
 * Handles price lookups, caching, and currency conversion
 */

const pool = require('../db');
const logger = require('../utils/logger');

// Cache pricing data to avoid DB hits
const priceCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
let cacheTimestamp = 0;

const DEFAULT_PRICE_CENTS = 2900; // $29 USD
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_COUNTRY = 'US';

/**
 * Get premium price for a user based on their location
 * Falls back to US pricing if country not found
 * @param {string} countryCode - ISO 3166-1 alpha-2 country code (e.g., 'US', 'GB')
 * @returns {Promise<{price_cents: number, currency_code: string, country_code: string}>}
 */
async function getPremiumPrice(countryCode) {
  if (!countryCode) {
    countryCode = DEFAULT_COUNTRY;
  }

  // Check cache first
  if (isCacheValid() && priceCache.has(countryCode)) {
    return priceCache.get(countryCode);
  }

  try {
    const { rows } = await pool.query(
      `SELECT price_cents, currency_code, country_code, stripe_price_id
       FROM pricing_overrides
       WHERE country_code = $1 AND is_active = TRUE`,
      [countryCode.toUpperCase()]
    );

    if (rows.length > 0) {
      const pricing = rows[0];
      setCacheEntry(countryCode, pricing);
      return pricing;
    }

    // Fallback to US pricing if country not found
    logger.warn('Country pricing not found, using default', { countryCode });
    const defaultPricing = await getDefaultPrice();
    return defaultPricing;
  } catch (err) {
    logger.error('Error fetching pricing', { err: err.message, countryCode });
    return getDefaultPricing();
  }
}

/**
 * Get pricing for multiple countries (batch lookup)
 * @param {string[]} countryCodes - Array of ISO country codes
 * @returns {Promise<Map<string, Object>>}
 */
async function getPremiumPricesBatch(countryCodes) {
  if (!countryCodes || countryCodes.length === 0) {
    return new Map();
  }

  const results = new Map();

  try {
    const { rows } = await pool.query(
      `SELECT price_cents, currency_code, country_code, stripe_price_id
       FROM pricing_overrides
       WHERE country_code = ANY($1) AND is_active = TRUE`,
      [countryCodes.map(c => c.toUpperCase())]
    );

    rows.forEach(row => {
      results.set(row.country_code, row);
      setCacheEntry(row.country_code, row);
    });

    return results;
  } catch (err) {
    logger.error('Error batch fetching pricing', { err: err.message });
    return results;
  }
}

/**
 * Update pricing for a country
 * Logs all changes for audit trail
 * @param {string} countryCode
 * @param {number} priceCents
 * @param {string} currencyCode
 * @param {string} reason - Change reason for audit log
 * @param {UUID} updatedById - User ID making the change
 * @returns {Promise<Object>}
 */
async function updatePremiumPrice(
  countryCode,
  priceCents,
  currencyCode,
  reason,
  updatedById,
  ipHash
) {
  const normalizedCode = (countryCode || '').toUpperCase();

  if (!normalizedCode || normalizedCode.length !== 2) {
    throw new Error('Invalid country code');
  }

  if (!priceCents || priceCents < 0) {
    throw new Error('Invalid price');
  }

  if (!currencyCode || currencyCode.length !== 3) {
    throw new Error('Invalid currency code');
  }

  try {
    // Get old price for audit log
    const { rows: oldRows } = await pool.query(
      `SELECT price_cents FROM pricing_overrides WHERE country_code = $1`,
      [normalizedCode]
    );

    const oldPrice = oldRows.length > 0 ? oldRows[0].price_cents : null;

    // Log the change
    await pool.query(
      `INSERT INTO pricing_override_log
        (country_code, old_price_cents, new_price_cents, currency_code, changed_by, reason, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [normalizedCode, oldPrice, priceCents, currencyCode, updatedById, reason || null, ipHash || null]
    );

    // Update or insert pricing
    const { rows } = await pool.query(
      `INSERT INTO pricing_overrides
        (country_code, price_cents, currency_code, updated_by, updated_at, is_active)
       VALUES ($1, $2, $3, $4, NOW(), TRUE)
       ON CONFLICT (country_code)
       DO UPDATE SET
         price_cents = $2,
         currency_code = $3,
         updated_by = $4,
         updated_at = NOW(),
         is_active = TRUE
       RETURNING *`,
      [normalizedCode, priceCents, currencyCode, updatedById]
    );

    // Invalidate cache
    invalidateCache();

    logger.info('Premium price updated', {
      countryCode: normalizedCode,
      oldPrice,
      newPrice: priceCents,
      currency: currencyCode,
      updatedBy: updatedById
    });

    return rows[0];
  } catch (err) {
    logger.error('Error updating premium price', { err: err.message });
    throw err;
  }
}

/**
 * Get all active pricing overrides
 * Used by admin dashboard
 * @returns {Promise<Array>}
 */
async function getAllPricingOverrides() {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pricing_overrides
       WHERE is_active = TRUE
       ORDER BY country_code`
    );
    return rows;
  } catch (err) {
    logger.error('Error fetching all pricing overrides', { err: err.message });
    return [];
  }
}

/**
 * Get pricing history for a country
 * @param {string} countryCode
 * @returns {Promise<Array>}
 */
async function getPricingHistory(countryCode, limit = 50) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pricing_override_log
       WHERE country_code = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [countryCode.toUpperCase(), limit]
    );
    return rows;
  } catch (err) {
    logger.error('Error fetching pricing history', { err: err.message });
    return [];
  }
}

/**
 * Sync active regional prices to Stripe recurring Price objects.
 * Existing stripe_price_id values are treated as already synced to avoid
 * creating duplicate Stripe prices for the same regional subscription.
 *
 * @param {Object} deps
 * @param {Object} deps.stripeClient - Initialized Stripe SDK client.
 * @param {string} deps.productId - Stripe Product ID for OxSteed Premium.
 * @returns {Promise<{synced:number, skipped:number, results:Array}>}
 */
async function syncRegionalPricesToStripe({ stripeClient, productId }) {
  if (!stripeClient || !stripeClient.prices || typeof stripeClient.prices.create !== 'function') {
    throw new Error('Stripe client is not configured');
  }
  if (!productId || typeof productId !== 'string' || !productId.trim()) {
    throw new Error('STRIPE_PREMIUM_PRODUCT_ID is required to sync regional prices');
  }

  const overrides = await getAllPricingOverrides();
  const results = [];

  for (const override of overrides) {
    const countryCode = String(override.country_code || '').toUpperCase();
    const currency = String(override.currency_code || '').toLowerCase();
    const amount = Number(override.price_cents);

    if (override.stripe_price_id) {
      results.push({
        country_code: countryCode,
        status: 'skipped',
        reason: 'already_synced',
        stripe_price_id: override.stripe_price_id,
      });
      continue;
    }

    if (!countryCode || !currency || !Number.isFinite(amount) || amount <= 0) {
      results.push({
        country_code: countryCode,
        status: 'failed',
        reason: 'invalid_pricing',
      });
      continue;
    }

    const price = await stripeClient.prices.create({
      product: productId,
      unit_amount: Math.round(amount),
      currency,
      recurring: { interval: 'month' },
      nickname: `OxSteed Premium ${countryCode}`,
      metadata: {
        country_code: countryCode,
        pricing_override_id: String(override.id),
      },
    });

    await pool.query(
      `UPDATE pricing_overrides
          SET stripe_price_id = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [price.id, override.id]
    );

    results.push({
      country_code: countryCode,
      status: 'synced',
      stripe_price_id: price.id,
    });
  }

  invalidateCache();

  return {
    synced: results.filter(r => r.status === 'synced').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    failed: results.filter(r => r.status === 'failed').length,
    results,
  };
}

/**
 * Get default US pricing (fallback)
 * @returns {Object}
 */
function getDefaultPricing() {
  return {
    country_code: DEFAULT_COUNTRY,
    price_cents: DEFAULT_PRICE_CENTS,
    currency_code: DEFAULT_CURRENCY,
    stripe_price_id: null
  };
}

/**
 * Get default price from DB or fallback
 * @returns {Promise<Object>}
 */
async function getDefaultPrice() {
  try {
    const { rows } = await pool.query(
      `SELECT price_cents, currency_code, country_code
       FROM pricing_overrides
       WHERE country_code = 'US' AND is_active = TRUE`
    );
    return rows[0] || getDefaultPricing();
  } catch (err) {
    return getDefaultPricing();
  }
}

/**
 * Cache management functions
 */
function isCacheValid() {
  return Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

function setCacheEntry(countryCode, data) {
  priceCache.set(countryCode.toUpperCase(), data);
  cacheTimestamp = Date.now();
}

function invalidateCache() {
  priceCache.clear();
  cacheTimestamp = 0;
}

/**
 * Get pricing for user object
 * @param {Object} user - User object with country property
 * @returns {Promise<Object>}
 */
async function getPricingForUser(user) {
  if (!user || !user.country) {
    return getDefaultPricing();
  }
  return getPremiumPrice(user.country);
}

module.exports = {
  getPremiumPrice,
  getPremiumPricesBatch,
  updatePremiumPrice,
  getAllPricingOverrides,
  getPricingHistory,
  syncRegionalPricesToStripe,
  getPricingForUser,
  getDefaultPricing,
  invalidateCache,
  DEFAULT_PRICE_CENTS,
  DEFAULT_CURRENCY,
  DEFAULT_COUNTRY
};
