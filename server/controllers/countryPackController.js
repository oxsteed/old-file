// server/controllers/countryPackController.js
//
// Public country picker + country config endpoints, plus the super-admin
// "flip the flag" update. See docs/oxsteed-pack-architecture.md §5.

const AppError = require('../utils/appError');
const countryPackService = require('../services/countryPackService');
const logger = require('../utils/logger');

/**
 * GET /api/country-config/countries  (public)
 * → { success, data: { available: [...], coming_soon: [...] } }
 */
exports.listCountries = async (req, res, next) => {
  try {
    const list = await countryPackService.listCountries();
    res.json({ success: true, data: list });
  } catch (err) {
    next(new AppError('Failed to load countries', 500, 'countries_load_failed'));
  }
};

/**
 * GET /api/country-config?country=US  (public)
 * Active   → 200 { success, data: { ...pack } }
 * Coming   → 200 { success: false, code: 'country_coming_soon', country }
 * Unknown  → 404
 */
exports.getCountryConfig = async (req, res, next) => {
  try {
    const code = req.query.country || req.headers['x-oxsteed-country'] || 'US';
    const result = await countryPackService.getCountryConfig(code);

    if (result.ok) {
      return res.json({ success: true, data: result.country });
    }
    if (result.reason === 'coming_soon') {
      return res.status(200).json({
        success: false,
        code: 'country_coming_soon',
        country: result.country,
      });
    }
    return next(new AppError('Country not available', 404, 'country_not_found'));
  } catch (err) {
    next(new AppError('Failed to load country config', 500, 'country_config_failed'));
  }
};

/**
 * GET /api/country-config/admin  (super-admin)
 * Every pack, including disabled, with full config.
 */
exports.adminListCountryPacks = async (req, res, next) => {
  try {
    const packs = await countryPackService.listAllCountryPacks();
    res.json({ success: true, data: { packs } });
  } catch (err) {
    next(new AppError('Failed to load country packs', 500, 'country_packs_load_failed'));
  }
};

/**
 * PATCH /api/country-config/admin/:code  (super-admin)
 * Body: { status?, name?, flag_emoji?, sort_order?, default_locale?, currency_code?, config? }
 * Activating a country is this endpoint with { "status": "active" }.
 */
exports.adminUpdateCountryPack = async (req, res, next) => {
  try {
    const updated = await countryPackService.updateCountryPack(req.params.code, req.body || {});
    if (!updated) return next(new AppError('Country not found', 404, 'country_not_found'));
    logger.info('country pack updated', {
      code: updated.code,
      status: updated.status,
      by: req.user?.id,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.code === 'validation_failed') {
      return next(new AppError(err.message, 400, 'validation_failed'));
    }
    next(new AppError('Failed to update country pack', 500, 'country_update_failed'));
  }
};
