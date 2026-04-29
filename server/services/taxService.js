const logger = require('../utils/logger');

// State sales tax rates (US) - can be loaded from database
const US_STATE_TAX_RATES = {
  'AL': 0.04,  'AK': 0.00,  'AZ': 0.056, 'AR': 0.065, 'CA': 0.0725,
  'CO': 0.029, 'CT': 0.065, 'DE': 0.00,  'FL': 0.06,  'GA': 0.04,
  'HI': 0.04,  'ID': 0.06,  'IL': 0.0625,'IN': 0.07,  'IA': 0.06,
  'KS': 0.065, 'KY': 0.06,  'LA': 0.045, 'ME': 0.055, 'MD': 0.06,
  'MA': 0.0625,'MI': 0.06,  'MN': 0.0685,'MS': 0.07,  'MO': 0.0725,
  'MT': 0.00,  'NE': 0.055, 'NV': 0.0685,'NH': 0.00,  'NJ': 0.0625,
  'NM': 0.0525,'NY': 0.04,  'NC': 0.045, 'ND': 0.05,  'OH': 0.0575,
  'OK': 0.045, 'OR': 0.00,  'PA': 0.06,  'RI': 0.07,  'SC': 0.06,
  'SD': 0.045, 'TN': 0.0925,'TX': 0.0625,'UT': 0.0595,'VT': 0.06,
  'VA': 0.0525,'WA': 0.065, 'WV': 0.06,  'WI': 0.05,  'WY': 0.04,
  'DC': 0.0575
};

// International VAT/GST rates - simplified
const INTERNATIONAL_TAX_RATES = {
  'CA': 0.05,  // Canada GST
  'GB': 0.20,  // UK VAT
  'DE': 0.19,  // Germany VAT
  'FR': 0.20,  // France VAT
  'AU': 0.10,  // Australia GST
  'NZ': 0.15,  // New Zealand GST
  'IN': 0.18,  // India GST
  'MX': 0.16,  // Mexico VAT
};

/**
 * Calculate tax based on shipping address location
 * @param {number} subtotalCents - Order subtotal in cents
 * @param {object} shippingAddress - { street, city, state, zip, country }
 * @returns {number} Tax amount in cents
 */
function calculateTax(subtotalCents, shippingAddress = {}) {
  if (!subtotalCents || subtotalCents < 0) return 0;

  let taxRate = 0;
  const country = (shippingAddress.country || 'US').toUpperCase();
  const state = (shippingAddress.state || '').toUpperCase();

  try {
    if (country === 'US') {
      // Use state tax rate
      taxRate = US_STATE_TAX_RATES[state] || 0.08; // Default 8% if state not found
    } else if (country === 'CA' && state) {
      // Canada has provincial rates - simplify to federal GST
      taxRate = INTERNATIONAL_TAX_RATES['CA'] || 0.05;
    } else {
      // Use country tax rate
      taxRate = INTERNATIONAL_TAX_RATES[country] || 0.08; // Default 8% for unknown
    }

    const taxCents = Math.round(subtotalCents * taxRate);
    logger.debug('Tax calculated', { subtotalCents, taxRate, taxCents, country, state });
    return taxCents;
  } catch (error) {
    logger.warn('Error calculating tax, using default rate', { error, shippingAddress });
    return Math.round(subtotalCents * 0.08); // Fallback to 8%
  }
}

/**
 * Get tax rate for a location
 * @param {string} country - ISO country code
 * @param {string} state - State/province code
 * @returns {number} Tax rate as decimal (e.g., 0.08 for 8%)
 */
function getTaxRate(country = 'US', state = '') {
  const countryCode = (country || 'US').toUpperCase();
  const stateCode = (state || '').toUpperCase();

  if (countryCode === 'US') {
    return US_STATE_TAX_RATES[stateCode] || 0.08;
  }
  return INTERNATIONAL_TAX_RATES[countryCode] || 0.08;
}

module.exports = {
  calculateTax,
  getTaxRate,
  US_STATE_TAX_RATES,
  INTERNATIONAL_TAX_RATES
};
