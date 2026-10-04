// server/controllers/pricingOverrideController.js
/**
 * Admin controller for managing location-based pricing overrides
 */

const pricingService = require('../services/pricingService');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const crypto = require('crypto');
const Stripe = require('stripe');

/**
 * Build the Stripe options for pricing updates when the server is configured
 * for Stripe. updatePremiumPrice then creates a replacement Stripe Price
 * immediately; without this the changed override is cleared and the sync job
 * recreates it on the next run.
 */
function buildStripeOptions() {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PREMIUM_PRODUCT_ID) {
    return {};
  }
  return {
    stripeClient: new Stripe(process.env.STRIPE_SECRET_KEY),
    productId: process.env.STRIPE_PREMIUM_PRODUCT_ID,
  };
}

/**
 * GET /api/admin/pricing-overrides
 * Get all pricing overrides
 */
exports.getAllPricingOverrides = async (req, res, next) => {
  try {
    const overrides = await pricingService.getAllPricingOverrides();
    res.json({ overrides, count: overrides.length });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/pricing-overrides/:countryCode
 * Get pricing for a specific country
 */
exports.getPricingOverride = async (req, res, next) => {
  try {
    const { countryCode } = req.params;
    const pricing = await pricingService.getPremiumPrice(countryCode);
    res.json({ pricing });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/pricing-overrides/:countryCode
 * Update pricing for a country
 */
exports.updatePricingOverride = async (req, res, next) => {
  try {
    const { countryCode } = req.params;
    const { price_cents, currency_code, reason } = req.body;

    // Validation
    const errors = {};
    if (!price_cents || price_cents < 0) {
      errors.price_cents = 'Price must be a positive number';
    }
    if (!currency_code || currency_code.length !== 3) {
      errors.currency_code = 'Currency code must be 3 characters (e.g., USD)';
    }
    if (Object.keys(errors).length > 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', errors);
    }

    const ipHash = req.ip
      ? crypto.createHash('sha256').update(req.ip).digest('hex').slice(0, 16)
      : null;

    const updated = await pricingService.updatePremiumPrice(
      countryCode,
      Math.floor(price_cents),
      currency_code.toUpperCase(),
      reason,
      req.user.id,
      ipHash,
      buildStripeOptions()
    );

    logger.info('Pricing override updated', {
      countryCode,
      price_cents,
      currency_code,
      adminId: req.user.id
    });

    res.json({
      success: true,
      pricing: updated,
      message: `Updated pricing for ${countryCode.toUpperCase()}`
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/pricing-overrides/:countryCode/history
 * Get pricing change history for a country
 */
exports.getPricingHistory = async (req, res, next) => {
  try {
    const { countryCode } = req.params;
    const { limit } = req.query;
    const history = await pricingService.getPricingHistory(
      countryCode,
      parseInt(limit) || 50
    );
    res.json({ history, count: history.length });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/pricing-overrides/batch
 * Update multiple countries at once
 */
exports.batchUpdatePricing = async (req, res, next) => {
  try {
    const { updates, reason } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      throw new AppError('updates must be a non-empty array', 400, 'validation_failed');
    }

    const results = [];
    const errors = [];

    for (const update of updates) {
      try {
        const { country_code, price_cents, currency_code } = update;

        if (!country_code || !price_cents || !currency_code) {
          errors.push({
            country_code,
            error: 'Missing required fields (country_code, price_cents, currency_code)'
          });
          continue;
        }

        const ipHash = req.ip
          ? crypto.createHash('sha256').update(req.ip).digest('hex').slice(0, 16)
          : null;

        const updated = await pricingService.updatePremiumPrice(
          country_code,
          Math.floor(price_cents),
          currency_code.toUpperCase(),
          reason,
          req.user.id,
          ipHash,
          buildStripeOptions()
        );

        results.push({ country_code, success: true, pricing: updated });
      } catch (err) {
        errors.push({
          country_code: update.country_code,
          error: err.message
        });
      }
    }

    logger.info('Batch pricing update completed', {
      successful: results.length,
      failed: errors.length,
      adminId: req.user.id
    });

    res.json({
      success: true,
      results,
      errors: errors.length > 0 ? errors : null,
      message: `Updated ${results.length} countries${errors.length > 0 ? `, ${errors.length} failed` : ''}`
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/pricing-overrides/sync-stripe
 * Sync pricing overrides with Stripe prices
 * Creates new Stripe prices if needed
 */
exports.syncPricesToStripe = async (req, res, next) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new AppError('Stripe secret key is not configured', 503, 'configuration_error');
    }
    if (!process.env.STRIPE_PREMIUM_PRODUCT_ID) {
      throw new AppError('STRIPE_PREMIUM_PRODUCT_ID is required to sync regional prices', 503, 'configuration_error');
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const result = await pricingService.syncRegionalPricesToStripe({
      stripeClient: stripe,
      productId: process.env.STRIPE_PREMIUM_PRODUCT_ID,
    });

    logger.info('Regional pricing synced to Stripe', {
      adminId: req.user.id,
      synced: result.synced,
      skipped: result.skipped,
      failed: result.failed,
    });

    res.json({
      success: true,
      message: `Stripe sync completed: ${result.synced} created, ${result.skipped} already synced, ${result.failed} failed.`,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/pricing-overrides/comparison
 * Compare pricing across regions
 */
exports.getPricingComparison = async (req, res, next) => {
  try {
    const overrides = await pricingService.getAllPricingOverrides();

    // Group by currency
    const byCurrency = {};
    overrides.forEach(o => {
      if (!byCurrency[o.currency_code]) {
        byCurrency[o.currency_code] = [];
      }
      byCurrency[o.currency_code].push({
        country: o.country_code,
        price: o.price_cents,
        stripe_price_id: o.stripe_price_id
      });
    });

    // Find min/max prices per currency
    const stats = {};
    Object.entries(byCurrency).forEach(([currency, prices]) => {
      const priceValues = prices.map(p => p.price);
      stats[currency] = {
        count: prices.length,
        min_price: Math.min(...priceValues),
        max_price: Math.max(...priceValues),
        avg_price: Math.round(priceValues.reduce((a, b) => a + b, 0) / priceValues.length),
        countries: prices
      };
    });

    res.json({
      total_countries: overrides.length,
      by_currency: stats
    });
  } catch (err) {
    next(err);
  }
};
