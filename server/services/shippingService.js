const logger = require('../utils/logger');

// Shipping rates by region (base rates in cents per item or flat rate)
const SHIPPING_RATES = {
  // US zones based on state
  'continental_us': {
    baseRate: 500, // $5.00 base
    perItem: 50,   // $0.50 per additional item
    maxItems: 10
  },
  'alaska': {
    baseRate: 1500,
    perItem: 200,
    maxItems: 10
  },
  'hawaii': {
    baseRate: 1500,
    perItem: 200,
    maxItems: 10
  },
  // International (simplified)
  'canada': {
    baseRate: 800,
    perItem: 100,
    maxItems: 10
  },
  'mexico': {
    baseRate: 1200,
    perItem: 150,
    maxItems: 10
  },
  'europe': {
    baseRate: 2000,
    perItem: 200,
    maxItems: 10
  },
  'other': {
    baseRate: 2500,
    perItem: 300,
    maxItems: 10
  }
};

const US_REMOTE_STATES = ['AK', 'HI'];

/**
 * Calculate shipping cost based on destination and item count
 * @param {object} shippingAddress - { street, city, state, zip, country }
 * @param {number} itemCount - Number of items being shipped
 * @param {number} weightOunces - Total weight in ounces (optional)
 * @returns {number} Shipping cost in cents
 */
function calculateShipping(shippingAddress = {}, itemCount = 1, weightOunces = 0) {
  try {
    const country = (shippingAddress.country || 'US').toUpperCase();
    const state = (shippingAddress.state || '').toUpperCase();

    let zone = 'continental_us';

    if (country === 'US') {
      if (US_REMOTE_STATES.includes(state)) {
        zone = state === 'AK' ? 'alaska' : 'hawaii';
      }
    } else if (country === 'CA') {
      zone = 'canada';
    } else if (country === 'MX') {
      zone = 'mexico';
    } else if (['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'PL'].includes(country)) {
      zone = 'europe';
    } else {
      zone = 'other';
    }

    const rate = SHIPPING_RATES[zone];
    if (!rate) {
      logger.warn('Unknown shipping zone', { country, state });
      return SHIPPING_RATES['other'].baseRate;
    }

    // Calculate shipping: base + (items * per-item rate), capped at maxItems
    const itemsToCharge = Math.min(itemCount, rate.maxItems);
    const shippingCost = rate.baseRate + (Math.max(0, itemsToCharge - 1) * rate.perItem);

    // Consider weight surcharge for heavy items (over 5 lbs per item)
    let weightSurcharge = 0;
    if (weightOunces > 0) {
      const heavyItemThreshold = itemCount * 80; // 5 lbs * 16 oz
      if (weightOunces > heavyItemThreshold) {
        const excessOunces = weightOunces - heavyItemThreshold;
        weightSurcharge = Math.round(excessOunces * 5); // $0.05 per ounce over limit
      }
    }

    const total = shippingCost + weightSurcharge;

    logger.debug('Shipping calculated', {
      zone,
      itemCount,
      baseRate: rate.baseRate,
      itemRate: rate.perItem,
      shippingCost,
      weightSurcharge,
      total
    });

    return total;
  } catch (error) {
    logger.error('Error calculating shipping', { error, shippingAddress, itemCount });
    return SHIPPING_RATES['other'].baseRate; // Default to $25 if error
  }
}

/**
 * Get shipping rate for a zone
 */
function getShippingRate(country = 'US', state = '') {
  const countryCode = (country || 'US').toUpperCase();
  const stateCode = (state || '').toUpperCase();

  let zone = 'continental_us';

  if (countryCode === 'US') {
    zone = US_REMOTE_STATES.includes(stateCode)
      ? stateCode === 'AK' ? 'alaska' : 'hawaii'
      : 'continental_us';
  } else if (countryCode === 'CA') {
    zone = 'canada';
  } else if (countryCode === 'MX') {
    zone = 'mexico';
  } else if (['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'PL'].includes(countryCode)) {
    zone = 'europe';
  } else {
    zone = 'other';
  }

  return SHIPPING_RATES[zone] || SHIPPING_RATES['other'];
}

/**
 * Format shipping cost for display
 */
function formatShippingCost(shippingCents) {
  return `$${(shippingCents / 100).toFixed(2)}`;
}

/**
 * Check if an address is valid for shipping
 */
function isValidShippingAddress(address) {
  if (!address) return false;
  if (!address.street || address.street.trim().length === 0) return false;
  if (!address.city || address.city.trim().length === 0) return false;
  if (!address.zip || address.zip.trim().length === 0) return false;
  if (!address.country || address.country.trim().length === 0) return false;

  // US requires state
  if (address.country === 'US' && (!address.state || address.state.trim().length === 0)) {
    return false;
  }

  return true;
}

module.exports = {
  calculateShipping,
  getShippingRate,
  formatShippingCost,
  isValidShippingAddress,
  SHIPPING_RATES,
  US_REMOTE_STATES
};
