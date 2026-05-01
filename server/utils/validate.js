// server/utils/validate.js
// Lightweight schema validation - no extra deps needed.
// Usage:
//   const { validate, rules } = require('../utils/validate');
//   const errs = validate(req.body, { email: [rules.required, rules.email], password: [rules.required, rules.minLen(8)] });
//   if (errs) return res.status(400).json({ error: 'validation_failed', fields: errs });

const { isUsStateCode } = require('./usStates');
const {
  isValidCountry,
  isValidRegion,
  isValidPostal,
  hasPostalCode,
} = require('./countries');

const rules = {
  required: (v, field) =>
    (v === undefined || v === null || String(v).trim() === '') ? `${field} is required` : null,

  email: (v) => {
    if (!v) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim())
      ? null : 'Must be a valid email address';
  },

  minLen: (min) => (v, field) => {
    if (!v) return null;
    return String(v).length >= min ? null : `${field} must be at least ${min} characters`;
  },

  maxLen: (max) => (v, field) => {
    if (!v) return null;
    return String(v).length <= max ? null : `${field} must be at most ${max} characters`;
  },

  numeric: (v, field) => {
    if (v === undefined || v === null || v === '') return null;
    return !isNaN(parseFloat(v)) && isFinite(v) ? null : `${field} must be a number`;
  },

  positiveNumber: (v, field) => {
    if (v === undefined || v === null || v === '') return null;
    const n = parseFloat(v);
    return (!isNaN(n) && n > 0) ? null : `${field} must be a positive number`;
  },

  integer: (v, field) => {
    if (v === undefined || v === null || v === '') return null;
    return Number.isInteger(Number(v)) ? null : `${field} must be an integer`;
  },

  oneOf: (options) => (v, field) => {
    if (!v) return null;
    return options.includes(v) ? null : `${field} must be one of: ${options.join(', ')}`;
  },

  noScript: (v, field) => {
    if (!v) return null;
    return /<script|javascript:|on\w+\s*=/i.test(String(v))
      ? `${field} contains invalid content` : null;
  },

  // Accepts:
  //   E.164:          +19375550101
  //   US local:       9375550101
  //   Formatted US:   (937) 555-0101  /  937-555-0101  /  937.555.0101
  //   Intl with space: +1 937 555 0101
  // Strip all formatting to digits (and leading +) then check digit count 7–15.
  phone: (v) => {
    if (!v) return null;
    const digits = String(v).trim().replace(/[\s\-().]/g, '');
    // Must be digits only (with optional leading +)
    if (!/^\+?\d+$/.test(digits)) return 'Must be a valid phone number';
    const digitCount = digits.replace(/^\+/, '').length;
    return digitCount >= 7 && digitCount <= 15
      ? null : 'Must be a valid phone number';
  },

  zip: (v) => {
    if (!v) return null;
    return /^\d{5}(-\d{4})?$/.test(String(v).trim())
      ? null : 'Must be a valid US ZIP code';
  },

  /** 2-letter US state / DC code */
  usState: (v) => {
    if (!v) return null;
    const s = String(v).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(s)) return 'Must be a 2-letter state code';
    return isUsStateCode(s) ? null : 'Must be a valid US state or territory';
  },

  /** ISO-3166 alpha-2 country code from the supported set. */
  country: (v) => {
    if (!v) return null;
    return isValidCountry(v) ? null : 'Must be a supported country code';
  },

  /**
   * Country-aware region validator. Pass the country code at schema build
   * time: `rules.regionFor('CA')`.
   *  - If the country has a preset region list, the value must be in it.
   *  - Otherwise any non-empty trimmed string passes (free-text region).
   */
  regionFor: (country) => (v, field) => {
    if (!v) return null;
    return isValidRegion(country, v) ? null : `${field} is not valid for the selected country`;
  },

  /**
   * Country-aware postal validator. Pass the country code at schema build
   * time: `rules.postalFor('GB')`.
   *  - If the country has no postal code requirement (HK, HT, unknown), this
   *    is a no-op.
   *  - Otherwise the value must match the country's postal regex.
   */
  postalFor: (country) => (v) => {
    if (!v) return null;
    if (!hasPostalCode(country)) return null;
    return isValidPostal(country, v) ? null : 'Must be a valid postal code for the selected country';
  },
};

/**
 * Validate body against a schema.
 * @param {object} body - req.body
 * @param {object} schema - { fieldName: [rule, rule, ...] }
 * @returns {object|null} - error map or null if valid
 */
function validate(body, schema) {
  const errors = {};
  for (const [field, fieldRules] of Object.entries(schema)) {
    const value = body[field];
    for (const rule of fieldRules) {
      const msg = rule(value, field);
      if (msg) {
        errors[field] = msg;
        break; // First error per field only
      }
    }
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

module.exports = { validate, rules };
