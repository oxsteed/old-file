'use strict';

const { parseTipCents } = require('../controllers/foodController');
const { AppError } = require('../middleware/errorHandler');

describe('parseTipCents', () => {
  test('caps tip at subtotal in cents (not dollars)', () => {
    expect(parseTipCents(5000, 5000)).toBe(5000);
    expect(parseTipCents(50, 5000)).toBe(50);
  });

  test('absolute cap of 50000 cents even when subtotal is higher', () => {
    expect(parseTipCents(50000, 1_000_000)).toBe(50000);
    expect(() => parseTipCents(50001, 1_000_000)).toThrow(AppError);
  });

  test('rejects tips above the computed max', () => {
    expect(() => parseTipCents(100, 50)).toThrow(AppError);
  });
});
