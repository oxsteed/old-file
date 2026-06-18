'use strict';

const { evaluateOperatingHours, normalizeBrandAccentHex } = require('../utils/foodOperatingHours');

describe('foodOperatingHours', () => {
  test('treats empty hours as always open', () => {
    const status = evaluateOperatingHours({}, 'UTC', new Date('2026-06-18T15:00:00.000Z'));
    expect(status.isOpen).toBe(true);
  });

  test('normalizes brand accent hex', () => {
    expect(normalizeBrandAccentHex('#ff8800')).toBe('#FF8800');
    expect(normalizeBrandAccentHex('bad')).toBeNull();
  });
});
