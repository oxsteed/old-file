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
 * @param {string} [ipHash]
 * @param {Object} [options]
 * @param {Object} [options.stripeClient] - Initialized Stripe SDK client.
 *   When provided and the price/currency actually changed, a new Stripe Price
 *   is created immediately so customers are never charged a stale amount.
 * @param {string} [options.productId] - Stripe Product ID for OxSteed Premium.
 * @returns {Promise<Object>}
 */
async function updatePremiumPrice(
  countryCode,
  priceCents,
  currencyCode,
  reason,
  updatedById,
  ipHash,
  options = {}
) {
  const normalizedCode = (countryCode || '').toUpperCase();
  const normalizedCurrency = (currencyCode || '').toUpperCase();

  if (!normalizedCode || normalizedCode.length !== 2) {
    throw new Error('Invalid country code');
  }

  if (!priceCents || priceCents < 0) {
    throw new Error('Invalid price');
  }

  if (!normalizedCurrency || normalizedCurrency.length !== 3) {
    throw new Error('Invalid currency code');
  }

  const { stripeClient = null, productId = process.env.STRIPE_PREMIUM_PRODUCT_ID || null } = options;

  try {
    // Get old price for audit log
    const { rows: oldRows } = await pool.query(
      `SELECT id, price_cents, currency_code, stripe_price_id
         FROM pricing_overrides
        WHERE country_code = $1`,
      [normalizedCode]
    );

    const oldRow = oldRows.length > 0 ? oldRows[0] : null;
    const oldPrice = oldRow ? oldRow.price_cents : null;

    // Log the change
    await pool.query(
      `INSERT INTO pricing_override_log
        (country_code, old_price_cents, new_price_cents, currency_code, changed_by, reason, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [normalizedCode, oldPrice, priceCents, normalizedCurrency, updatedById, reason || null, ipHash || null]
    );

    // If the charged amount or currency changed, the previously synced Stripe
    // Price is stale: charging with it would bill customers the old price while
    // the admin dashboard shows the new one. Create a replacement immediately
    // when a Stripe client is available, otherwise clear the id so the sync
    // job recreates it on the next run.
    const priceChanged = Boolean(
      oldRow &&
      (Number(oldRow.price_cents) !== Number(priceCents) ||
        String(oldRow.currency_code).toUpperCase() !== normalizedCurrency)
    );

    let stripePriceId = oldRow ? oldRow.stripe_price_id : null;
    let refreshStripePriceId = false;

    if (priceChanged && oldRow.stripe_price_id) {
      refreshStripePriceId = true;
      if (stripeClient && productId) {
        try {
          const price = await createRegionalStripePrice({
            stripeClient,
            productId,
            countryCode: normalizedCode,
            amountCents: priceCents,
            currencyCode: normalizedCurrency,
            overrideId: oldRow.id,
          });
          stripePriceId = price.id;
          logger.info('Stripe price recreated after pricing override change', {
            countryCode: normalizedCode,
            stripePriceId,
          });
        } catch (err) {
          // Fail open toward the sync job: clear the stale id rather than
          // leaving a price id that no longer matches the displayed price.
          logger.error('Failed to recreate Stripe price; clearing id for re-sync', {
            err: err.message,
            countryCode: normalizedCode,
          });
          stripePriceId = null;
        }
      } else {
        stripePriceId = null;
        logger.warn('Pricing override changed without Stripe client; cleared stripe_price_id for re-sync', {
          countryCode: normalizedCode,
        });
      }
    }

    // Update or insert pricing
    const { rows } = await pool.query(
      `INSERT INTO pricing_overrides
        (country_code, price_cents, currency_code, updated_by, updated_at, is_active, stripe_price_id)
       VALUES ($1, $2, $3, $4, NOW(), TRUE, $5)
       ON CONFLICT (country_code)
       DO UPDATE SET
         price_cents = $2,
         currency_code = $3,
         updated_by = $4,
         updated_at = NOW(),
         is_active = TRUE,
         stripe_price_id = CASE WHEN $6 THEN $5 ELSE pricing_overrides.stripe_price_id END
       RETURNING *`,
      [normalizedCode, priceCents, normalizedCurrency, updatedById, stripePriceId, refreshStripePriceId]
    );

    // Invalidate cache
    invalidateCache();

    logger.info('Premium price updated', {
      countryCode: normalizedCode,
      oldPrice,
      newPrice: priceCents,
      currency: normalizedCurrency,
      updatedBy: updatedById,
      stripePriceIdRefreshed: refreshStripePriceId
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
 * Create a Stripe recurring Price for one regional override.
 * Shared by the sync job and by pricing updates that change the charged amount.
 *
 * @param {Object} params
 * @param {Object} params.stripeClient - Initialized Stripe SDK client.
 * @param {string} params.productId - Stripe Product ID for OxSteed Premium.
 * @param {string} params.countryCode - ISO 3166-1 alpha-2 country code.
 * @param {number} params.amountCents
 * @param {string} params.currencyCode - ISO 4217 currency code.
 * @param {string|number} [params.overrideId] - pricing_overrides.id for metadata.
 * @returns {Promise<Object>} The created Stripe Price.
 */
async function createRegionalStripePrice({ stripeClient, productId, countryCode, amountCents, currencyCode, overrideId }) {
  if (!stripeClient || !stripeClient.prices || typeof stripeClient.prices.create !== 'function') {
    throw new Error('Stripe client is not configured');
  }
  if (!productId || typeof productId !== 'string' || !productId.trim()) {
    throw new Error('STRIPE_PREMIUM_PRODUCT_ID is required to create regional prices');
  }

  return stripeClient.prices.create({
    product: productId,
    unit_amount: Math.round(Number(amountCents)),
    currency: String(currencyCode).toLowerCase(),
    recurring: { interval: 'month' },
    nickname: `OxSteed Premium ${String(countryCode).toUpperCase()}`,
    metadata: {
      country_code: String(countryCode).toUpperCase(),
      pricing_override_id: String(overrideId),
    },
  });
}

/**
 * Sync active regional prices to Stripe recurring Price objects.
 * Existing stripe_price_id values are treated as already synced to avoid
 * creating duplicate Stripe prices for the same regional subscription.
 *
 * NOTE: an override whose price/currency changed has its stripe_price_id
 * cleared by updatePremiumPrice (or replaced with a fresh price), so the
 * "already synced" skip only ever applies to prices that still match.
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

    const price = await createRegionalStripePrice({
      stripeClient,
      productId,
      countryCode,
      amountCents: amount,
      currencyCode: currency,
      overrideId: override.id,
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
