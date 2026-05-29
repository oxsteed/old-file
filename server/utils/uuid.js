const crypto = require('crypto');

/**
 * UUID v4 generator without the `uuid` npm dependency.
 *
 * Why: `uuid@14` is ESM-only and causes Jest to fail when loaded from our
 * CommonJS codebase. Node's built-in `crypto.randomUUID()` is available on
 * modern runtimes; we keep a small fallback for older environments.
 */
function uuidv4() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const b = crypto.randomBytes(16);
  // Per RFC 4122 section 4.4
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10

  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

module.exports = { uuidv4 };

