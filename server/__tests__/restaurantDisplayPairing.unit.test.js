'use strict';

// Unit tests for the display-pairing crypto helpers. No database involved;
// the jest setup mocks `pg`, and these helpers never touch it.

const {
  generatePairingCode,
  hashSecret,
  timingSafeEqualHex,
  normalizeCode,
  isValidCodeShape,
  normalizeLabel,
  parsePositiveInt,
  bearerToken,
  PAIRING_CODE_TTL_MS,
  ONLINE_THRESHOLD_MS,
  CODE_ALPHABET,
  CODE_LENGTH,
} = require('../controllers/restaurantDisplayController')._test;

describe('display pairing helpers', () => {
  test('code alphabet is unambiguous (no 0/O, 1/I, L)', () => {
    expect(CODE_LENGTH).toBe(6);
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(CODE_ALPHABET.length).toBe(31);
    expect(new Set(CODE_ALPHABET.split('')).size).toBe(CODE_ALPHABET.length);
  });

  test('generatePairingCode returns 6 chars from the alphabet', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generatePairingCode();
      expect(code).toHaveLength(6);
      expect(isValidCodeShape(code)).toBe(true);
    }
  });

  test('generatePairingCode is unique across a batch', () => {
    const codes = new Set();
    for (let i = 0; i < 2000; i += 1) codes.add(generatePairingCode());
    expect(codes.size).toBe(2000);
  });

  test('generatePairingCode uses rejection sampling (no modulo bias)', () => {
    // Alphabet length 32 divides 256 evenly for the first 224 byte values;
    // bytes 224..255 must be skipped, not wrapped with modulo.
    let calls = 0;
    const code = generatePairingCode((n) => {
      calls += 1;
      // First call: only out-of-range bytes (would loop forever without
      // rejection handling on a second call).
      if (calls === 1) return Buffer.from(Array(n).fill(255));
      return Buffer.from(Array(n).fill(0));
    });
    expect(code).toBe('AAAAAA');
  });

  test('generatePairingCode accepts injected randomness deterministically', () => {
    const code = generatePairingCode((n) => Buffer.from(Array(n).fill(0)));
    expect(code).toBe('AAAAAA');
  });

  test('hashSecret is a stable sha256 hex digest', () => {
    const h1 = hashSecret('ABCDEF');
    const h2 = hashSecret('ABCDEF');
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(hashSecret('ABCDEG')).not.toBe(h1);
    // Case sensitivity: codes are normalized before hashing, but the hash
    // itself must not collide across cases.
    expect(hashSecret('abcdef')).not.toBe(h1);
  });

  test('timingSafeEqualHex compares in constant time', () => {
    const a = hashSecret('ABCDEF');
    const b = hashSecret('ABCDEF');
    const c = hashSecret('ABCDEG');
    expect(timingSafeEqualHex(a, b)).toBe(true);
    expect(timingSafeEqualHex(a, c)).toBe(false);
    expect(timingSafeEqualHex(a, 'deadbeef')).toBe(false);
    expect(timingSafeEqualHex(a, '')).toBe(false);
    expect(timingSafeEqualHex(a, null)).toBe(false);
  });

  test('normalizeCode uppercases and strips spaces/dashes', () => {
    expect(normalizeCode('ab-cd ef')).toBe('ABCDEF');
    expect(normalizeCode(' abc123 ')).toBe('ABC123');
    expect(normalizeCode(null)).toBe('');
    expect(normalizeCode(undefined)).toBe('');
  });

  test('isValidCodeShape rejects ambiguous and malformed codes', () => {
    expect(isValidCodeShape('ABCDEF')).toBe(true);
    expect(isValidCodeShape('234567')).toBe(true);
    expect(isValidCodeShape('ABCDE')).toBe(false);
    expect(isValidCodeShape('ABCDEFG')).toBe(false);
    expect(isValidCodeShape('ABCDE0')).toBe(false); // zero not in alphabet
    expect(isValidCodeShape('ABCDEO')).toBe(false); // O not in alphabet
    expect(isValidCodeShape('ABCDE1')).toBe(false); // 1 not in alphabet
    expect(isValidCodeShape('ABCDEL')).toBe(false); // L not in alphabet
    expect(isValidCodeShape('abcdef')).toBe(false); // must be normalized first
  });

  test('normalizeLabel trims, truncates and nulls blanks', () => {
    expect(normalizeLabel('  Dining room TV  ')).toBe('Dining room TV');
    expect(normalizeLabel('')).toBe(null);
    expect(normalizeLabel('   ')).toBe(null);
    expect(normalizeLabel(null)).toBe(null);
    expect(normalizeLabel('x'.repeat(100))).toHaveLength(60);
  });

  test('parsePositiveInt accepts only positive integers', () => {
    expect(parsePositiveInt('12')).toBe(12);
    expect(parsePositiveInt(7)).toBe(7);
    expect(parsePositiveInt('0')).toBe(null);
    expect(parsePositiveInt('-3')).toBe(null);
    expect(parsePositiveInt('abc')).toBe(null);
    expect(parsePositiveInt('')).toBe(null);
  });

  test('bearerToken extracts the Authorization bearer credential', () => {
    expect(bearerToken({ headers: { authorization: 'Bearer abc123' } })).toBe('abc123');
    expect(bearerToken({ headers: { authorization: 'bearer ABC' } })).toBe('ABC');
    expect(bearerToken({ headers: {} })).toBe(null);
    expect(bearerToken({ headers: { authorization: 'Basic abc' } })).toBe(null);
    expect(bearerToken({})).toBe(null);
  });

  test('timing constants match the spec', () => {
    expect(PAIRING_CODE_TTL_MS).toBe(10 * 60 * 1000);
    expect(ONLINE_THRESHOLD_MS).toBe(90 * 1000);
  });
});
