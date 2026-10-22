'use strict';

// Wire integers may be numbers or decimal strings, never coercible objects,
// booleans, exponents, fractions, or partially parsed identifiers.
function strictInteger(value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[0-9]+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}
module.exports = { strictInteger };
