'use strict';

// Finding 26 feed: the Business 360 restaurant tab needs an admin read of
// pay-runs for a business's restaurants (pay-runs are otherwise
// merchant-only). Covers the paginated { payRuns, total, limit, offset }
// shape, the business scoping join, and limit clamping.

const { mockQuery, resetMocks } = require('./setup');

const businessModeration = require('../controllers/businessModerationController');

const res = () => {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
};

beforeEach(() => resetMocks());

test('returns pay-runs for the business restaurants with a total', async () => {
  mockQuery.mockImplementation(async (sql, params) => {
    // Route by the display_name select: the list query itself contains a
    // COUNT subquery for line_count, so /COUNT/ cannot tell them apart.
    if (/display_name AS restaurant_name/.test(sql)) {
      expect(params[0]).toBe('42');
      return {
        rows: [{
          id: 5, restaurant_id: 9, restaurant_name: 'Test Kitchen',
          period_from: '2026-10-01', period_to: '2026-10-15', status: 'finalized',
          totals: { total_pay_cents: 120000, currency: 'USD' },
          finalized_at: '2026-10-16', created_at: '2026-10-15', line_count: 3,
        }],
      };
    }
    if (/COUNT/.test(sql)) return { rows: [{ total: 1 }] };
    return { rows: [] };
  });

  const r = res();
  await businessModeration.listBusinessRestaurantPayRuns(
    { params: { id: '42' }, query: { limit: '20', offset: '0' } },
    r,
  );

  expect(r.json).toHaveBeenCalledWith(expect.objectContaining({
    total: 1, limit: 20, offset: 0,
  }));
  const body = r.json.mock.calls[0][0];
  expect(body.payRuns).toHaveLength(1);
  expect(body.payRuns[0].restaurant_name).toBe('Test Kitchen');
  expect(body.payRuns[0].line_count).toBe(3);
});

test('clamps an uncapped limit to 100 and forwards offset', async () => {
  mockQuery.mockImplementation(async (sql, params) => {
    if (/display_name AS restaurant_name/.test(sql)) {
      expect(params[1]).toBe(100);
      expect(params[2]).toBe(40);
      return { rows: [] };
    }
    if (/COUNT/.test(sql)) return { rows: [{ total: 0 }] };
    return { rows: [] };
  });

  const r = res();
  await businessModeration.listBusinessRestaurantPayRuns(
    { params: { id: '42' }, query: { limit: '1000000', offset: '40' } },
    r,
  );

  expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 40 }));
});

test('business detail includes the business restaurants for the 360 tab', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM businesses b/.test(sql)) {
      return {
        rows: [{
          id: '42', business_name: 'Test Biz', business_type: 'restaurant',
          is_active: true, is_primary: true, user_id: 'u1', owner_id: 'u1',
          owner_name: 'Owner', owner_email: 'o@example.com', owner_phone: null,
          member_count: 1, job_count: 0,
        }],
      };
    }
    if (/FROM jobs/.test(sql)) return { rows: [] };
    if (/FROM food_restaurants/.test(sql)) {
      return {
        rows: [{
          id: 9, display_name: 'Test Kitchen', status: 'active', is_verified: true,
          accepts_online_orders: true, accepts_in_store_orders: false, created_at: '2026-01-01',
        }],
      };
    }
    return { rows: [] };
  });

  const r = res();
  await businessModeration.getBusinessDetail({ params: { id: '42' } }, r);

  expect(r.json).toHaveBeenCalled();
  const body = r.json.mock.calls[0][0];
  expect(body.business.restaurants).toHaveLength(1);
  expect(body.business.restaurants[0].display_name).toBe('Test Kitchen');
  expect(body.business.restaurants[0].is_verified).toBe(true);
});

test('scopes pay-runs to the business via the restaurant join', async () => {
  const seen = [];
  mockQuery.mockImplementation(async (sql) => {
    seen.push(sql);
    if (/COUNT/.test(sql)) return { rows: [{ total: 0 }] };
    return { rows: [] };
  });

  const r = res();
  await businessModeration.listBusinessRestaurantPayRuns(
    { params: { id: '42' }, query: {} },
    r,
  );

  expect(r.json).toHaveBeenCalled();
  expect(seen.some((sql) => /JOIN food_restaurants fr ON fr\.id = pr\.restaurant_id/.test(sql))).toBe(true);
  expect(seen.some((sql) => /fr\.business_id = \$1/.test(sql))).toBe(true);
});
