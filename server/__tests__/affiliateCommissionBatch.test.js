'use strict';

// Money-flows audit item 44: commission math must be exact integer-cent
// math, not float math. The old formula
// Math.round(sale_amount * (commission_rate / 100)) mis-rounds real
// cases: 5000 cents at 99.99% is exactly 4999.5 (half-up 5000), but
// float64 computes 4999.499999999999 and rounds down to 4999.
const { commissionCentsForSale } = require('../jobs/affiliateCommissionBatch');

describe('commissionCentsForSale (item 44)', () => {
  test('float trap: 5000 cents at 99.99% rounds half-up to 5000, not 4999', () => {
    expect(Math.round(5000 * (99.99 / 100))).toBe(4999);
    expect(commissionCentsForSale(5000, 99.99)).toBe(5000);
  });

  test('ordinary cases agree with the old formula', () => {
    expect(commissionCentsForSale(1005, 10)).toBe(101);
    expect(commissionCentsForSale(10000, 7.5)).toBe(750);
    expect(commissionCentsForSale(999, 33.33)).toBe(333);
  });

  test('accepts pg string inputs (BIGINT sale cents, NUMERIC rate)', () => {
    expect(commissionCentsForSale('5000', '99.99')).toBe(5000);
    expect(commissionCentsForSale('10000', '7.50')).toBe(750);
  });

  test('boundary rates', () => {
    expect(commissionCentsForSale(12345, 0)).toBe(0);
    expect(commissionCentsForSale(12345, 100)).toBe(12345);
  });

  test('fails closed on inputs the DECIMAL(5,2) column cannot produce', () => {
    expect(() => commissionCentsForSale(1000, 7.555)).toThrow();
    expect(() => commissionCentsForSale('10.5', 10)).toThrow();
    expect(() => commissionCentsForSale(-5, 10)).toThrow();
    expect(() => commissionCentsForSale(1000, -1)).toThrow();
    expect(() => commissionCentsForSale(1000, 'abc')).toThrow();
  });
});
