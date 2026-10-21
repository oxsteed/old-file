'use strict';

const { _normalize: normalize } = require('../controllers/restaurantLoyaltyController');

describe('restaurant CRM loyalty segment contracts', () => {
  test('normalizes supported aggregate criteria to the stable wire shape', () => {
    expect(normalize.normalizeName('  Lapsed guests  ')).toBe('Lapsed guests');
    expect(normalize.normalizeCriteria({
      minLifetimePoints: 500,
      minOrders: '3',
      daysSinceLastOrder: 45,
      locationId: 9,
    })).toEqual({
      min_lifetime_points: 500,
      min_orders: 3,
      days_since_last_order: 45,
      location_id: 9,
    });
  });

  test('rejects unbounded or customer-identifying criteria', () => {
    expect(() => normalize.normalizeName('')).toThrow(/Segment name/);
    expect(() => normalize.normalizeCriteria({ email: 'a@example.com' })).toThrow(/Unsupported/);
    expect(() => normalize.normalizeCriteria({ minOrders: -1 })).toThrow(/Invalid/);
    expect(() => normalize.normalizeCriteria({ daysSinceLastOrder: 3651 })).toThrow(/Invalid/);
  });

  test('builds parameterized audience predicates without exposing identity', () => {
    const result = normalize.audienceWhere({
      min_lifetime_points: 100,
      min_orders: 2,
      days_since_last_order: 30,
      location_id: 4,
    });
    expect(result.params).toEqual([100, 2, 30, 4]);
    expect(result.clauses.join(' AND ')).toMatch(/lifetime_points >= \$1/);
    expect(result.clauses.join(' AND ')).toMatch(/paid_orders >= \$2/);
    expect(result.clauses.join(' AND ')).toMatch(/last_paid_order_at/);
    expect(result.clauses.join(' AND ')).toContain('has_location_order = TRUE');
  });
});
