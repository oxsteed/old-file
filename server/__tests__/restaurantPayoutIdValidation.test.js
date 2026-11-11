'use strict';

const { _parseRestaurantId: parseRestaurantId } = require('../controllers/restaurantPayoutController');

test('accepts only positive integer restaurant ids at the payout boundary', () => {
  expect(parseRestaurantId('12')).toBe(12);
  expect(parseRestaurantId(' 12 ')).toBe(12);
  expect(parseRestaurantId('12.5')).toBeNull();
  expect(parseRestaurantId('12junk')).toBeNull();
  expect(parseRestaurantId('0')).toBeNull();
  expect(parseRestaurantId('-1')).toBeNull();
});
