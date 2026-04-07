// server/utils/validate.js
// Lightweight schema validation — no extra deps needed.
// Usage:
//   const { validate, rules } = require('../utils/validate');
//   const errs = validate(req.body, { email: [rules.required, rules.email], password: [rules.required, rules.minLen(8)] });
//   if (errs) return res.status(400).json({ error: 'validation_failed', fields: errs });

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

  phone: (v) => {
    if (!v) return null;
    return /^\+?[\d\s\-().]{7,20}$/.test(String(v).trim())
      ? null : 'Must be a valid phone number';
  },

  zip: (v) => {
    if (!v) return null;
    return /^\d{5}(-\d{4})?$/.test(String(v).trim())
      ? null : 'Must be a valid US ZIP code';
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
