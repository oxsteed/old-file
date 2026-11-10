import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { totpCode, base32Decode } = require('./e2eTotp.cjs');

// RFC 6238 Appendix B, SHA-1 secret "12345678901234567890"; the 8-digit
// vectors truncated to 6 digits.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('base32 decodes the RFC secret', () => {
  assert.equal(base32Decode(SECRET).toString('ascii'), '12345678901234567890');
});

test('TOTP matches the RFC 6238 SHA-1 vectors', () => {
  assert.equal(totpCode(SECRET, 59 * 1000), '287082');
  assert.equal(totpCode(SECRET, 1111111109 * 1000), '081804');
  assert.equal(totpCode(SECRET, 1234567890 * 1000), '005924');
  assert.equal(totpCode(SECRET, 2000000000 * 1000), '279037');
});
