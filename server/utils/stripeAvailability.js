'use strict';

/**
 * Stripe availability for restaurant credit reserve funding.
 *
 * Not every country has Stripe. This utility checks the established
 * payment_country_policies table (stripe_rail_enabled) to decide whether
 * a restaurant funds its credit reserve via Stripe checkout or via
 * OxSteed's manual funding instructions.
 *
 * Fail-closed: unknown countries, missing rows, and DB errors all report
 * Stripe as unavailable, routing the restaurant to the manual path (which
 * requires admin verification before any reserve is credited).
 */

const pool = require('../db');
const logger = require('./logger');

function normalizeCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/**
 * @param {string} countryCode - ISO 3166-1 alpha-2
 * @returns {Promise<boolean>} true when Stripe checkout is available
 */
async function isStripeAvailableFor(countryCode) {
  const code = normalizeCountryCode(countryCode);
  if (!code) return false;
  try {
    const { rows } = await pool.query(
      `SELECT stripe_rail_enabled FROM payment_country_policies WHERE country_code = $1 LIMIT 1`,
      [code]
    );
    return rows[0]?.stripe_rail_enabled === true;
  } catch (err) {
    logger.warn('stripeAvailability lookup failed, treating Stripe as unavailable', {
      countryCode: code,
      error: err.message,
    });
    return false;
  }
}

module.exports = { isStripeAvailableFor, normalizeCountryCode };
