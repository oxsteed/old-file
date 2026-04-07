/**
 * __tests__/validate.test.js
 *
 * Pure unit tests for server/utils/validate.js — no DB or HTTP needed.
 */

'use strict';

const { validate, rules } = require('../utils/validate');

describe('validate utility', () => {
  test('returns null when all rules pass', () => {
    const result = validate(
      { email: 'user@example.com', name: 'Alice' },
      { email: [rules.required, rules.email], name: [rules.required] }
    );
    expect(result).toBeNull();
  });

  test('returns errors for failing rules', () => {
    const result = validate(
      { email: 'not-an-email', name: '' },
      { email: [rules.required, rules.email], name: [rules.required] }
    );
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('email');
    expect(result).toHaveProperty('name');
  });

  test('rules.minLen catches short strings', () => {
    const result = validate({ pw: 'ab' }, { pw: [rules.minLen(8)] });
    expect(result).toHaveProperty('pw');
  });

  test('rules.maxLen catches long strings', () => {
    const result = validate({ name: 'a'.repeat(300) }, { name: [rules.maxLen(100)] });
    expect(result).toHaveProperty('name');
  });

  test('rules.noScript rejects script injection', () => {
    const result = validate(
      { bio: '<script>alert("xss")</script>' },
      { bio: [rules.noScript] }
    );
    expect(result).toHaveProperty('bio');
  });

  test('rules.email accepts valid addresses', () => {
    const result = validate({ email: 'foo+bar@sub.domain.com' }, { email: [rules.email] });
    expect(result).toBeNull();
  });

  test('rules.positiveNumber rejects zero and negatives', () => {
    expect(validate({ n: 0 }, { n: [rules.positiveNumber] })).toHaveProperty('n');
    expect(validate({ n: -5 }, { n: [rules.positiveNumber] })).toHaveProperty('n');
    expect(validate({ n: 0.01 }, { n: [rules.positiveNumber] })).toBeNull();
  });

  test('rules.oneOf rejects values not in the list', () => {
    const schema = { role: [rules.oneOf(['admin', 'user', 'helper'])] };
    expect(validate({ role: 'superadmin' }, schema)).toHaveProperty('role');
    expect(validate({ role: 'helper' }, schema)).toBeNull();
  });

  test('rules.phone accepts US formats', () => {
    const schema = { phone: [rules.phone] };
    expect(validate({ phone: '555-867-5309' }, schema)).toBeNull();
    expect(validate({ phone: '(555) 867-5309' }, schema)).toBeNull();
    expect(validate({ phone: '123' }, schema)).toHaveProperty('phone');
  });

  test('optional field with no value skips further rules', () => {
    // phone is optional — empty string should not trigger phone format error
    const schema = { phone: [rules.phone] };
    const result = validate({ phone: '' }, schema);
    expect(result).toBeNull();
  });
});
