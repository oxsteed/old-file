'use strict';

/**
 * OxSteed funding instructions for restaurant credit reserves.
 *
 * For restaurants in countries without Stripe, OxSteed publishes its own
 * payment instructions (bank details, mobile money numbers, etc.) so the
 * restaurant can fund its credit reserve manually. This mirrors the
 * external_payment_instructions pattern restaurants use for their customers:
 * the platform is now the party publishing "where to send the money."
 *
 * Money-safety: instructions alone move no money. The reserve is credited
 * ONLY after an admin verifies the restaurant's funding proof (see
 * restaurantCreditFundingService.verifyManualFunding).
 */

const { AppError } = require('../middleware/errorHandler');
const pool = require('../db');
const logger = require('../utils/logger');

function normalizeCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new AppError('Invalid country code', 400, 'funding_instructions_country_invalid');
  }
  return code;
}

function normalizeCurrencyCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new AppError('Invalid currency code', 400, 'funding_instructions_currency_invalid');
  }
  return code;
}

function formatInstructions(row) {
  if (!row) return null;
  return {
    id: row.id,
    countryCode: row.country_code,
    currencyCode: row.currency_code,
    instructions: row.instructions,
    qrUrl: row.qr_url || null,
    referenceHint: row.reference_hint || null,
    isActive: row.is_active,
    updatedAt: row.updated_at,
  };
}

/**
 * Get the active funding instructions for a country/currency.
 * Returns null when none are configured (caller falls back to a generic
 * "contact support" message; never fabricates instructions).
 */
async function getFundingInstructions(countryCode, currencyCode) {
  const country = normalizeCountryCode(countryCode);
  const currency = normalizeCurrencyCode(currencyCode);
  const { rows } = await pool.query(
    `SELECT * FROM oxsteed_funding_instructions
      WHERE country_code = $1 AND currency_code = $2 AND is_active = true
      LIMIT 1`,
    [country, currency]
  );
  return formatInstructions(rows[0]);
}

/**
 * Admin: create or update funding instructions for a country/currency.
 */
async function upsertFundingInstructions({
  countryCode,
  currencyCode,
  instructions,
  qrUrl,
  referenceHint,
  isActive = true,
  adminUserId,
}) {
  const country = normalizeCountryCode(countryCode);
  const currency = normalizeCurrencyCode(currencyCode);
  const text = String(instructions || '').trim();
  if (!text) {
    throw new AppError('Instructions text is required', 400, 'funding_instructions_text_required');
  }
  const { rows } = await pool.query(
    `INSERT INTO oxsteed_funding_instructions
       (country_code, currency_code, instructions, qr_url, reference_hint, is_active, created_by_user_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (country_code, currency_code) DO UPDATE SET
       instructions = EXCLUDED.instructions,
       qr_url = EXCLUDED.qr_url,
       reference_hint = EXCLUDED.reference_hint,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()
     RETURNING *`,
    [
      country,
      currency,
      text,
      qrUrl ? String(qrUrl).trim().slice(0, 2000) || null : null,
      referenceHint ? String(referenceHint).trim().slice(0, 500) || null : null,
      Boolean(isActive),
      adminUserId || null,
    ]
  );
  logger.info('oxsteed funding instructions upserted', { country, currency });
  return formatInstructions(rows[0]);
}

/**
 * Admin: list all funding instructions (for the admin UI).
 */
async function listFundingInstructions({ activeOnly = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM oxsteed_funding_instructions
      ${activeOnly ? 'WHERE is_active = true' : ''}
      ORDER BY country_code, currency_code`
  );
  return rows.map(formatInstructions);
}

module.exports = {
  getFundingInstructions,
  upsertFundingInstructions,
  listFundingInstructions,
};
