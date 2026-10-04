'use strict';

/**
 * Tests for open-now restaurant inclusion in the helpers directory
 * (?include=restaurants): only visible, in-radius, currently-open
 * restaurants are mapped to the directory row shape with type 'restaurant'.
 *
 * DB access is mocked via __tests__/setup.js (mockQuery).
 */

const { mockQuery, resetMocks } = require('./setup');
const { fetchOpenRestaurantsNear } = require('../controllers/helpersController');

beforeEach(() => {
  resetMocks();
});

function restRow(overrides = {}) {
  return {
    id: 101,
    display_name: 'Testaurant',
    cuisine_tags: ['Italian', 'Pizza'],
    logo_url: 'https://example.com/logo.png',
    cover_photo_url: null,
    address_city: 'Columbus',
    address_state: 'OH',
    avg_rating: '4.7',
    rating_count: 132,
    operating_hours: null, // empty hours => treated as open
    timezone: 'America/New_York',
    temporarily_closed_until: null,
    is_accepting_orders_now: true,
    ...overrides,
  };
}

describe('fetchOpenRestaurantsNear', () => {
  test('maps an open restaurant to the directory row shape', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [restRow()] });

    const rows = await fetchOpenRestaurantsNear(39.96, -83.0, 60);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'rest_101',
      restaurantId: 101,
      type: 'restaurant',
      profileUrl: '/food/restaurants/101',
      businessName: 'Testaurant',
      avatar: 'https://example.com/logo.png',
      rating: 4.7,
      reviewCount: 132,
      categories: ['Italian', 'Pizza'],
      startingPrice: 0,
      availableToday: true,
    });
    // geo filter uses the caller's point and radius
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("fr.discovery_status = 'visible'");
    expect(sql).toContain('COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE');
    expect(params).toEqual([39.96, -83.0, 60]);
  });

  test('excludes temporarily closed and not-accepting restaurants', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        restRow({ id: 1 }),
        restRow({ id: 2, temporarily_closed_until: new Date(Date.now() + 3600e3).toISOString() }),
        restRow({ id: 3, is_accepting_orders_now: false }),
      ],
    });

    const rows = await fetchOpenRestaurantsNear(39.96, -83.0, 60);

    expect(rows.map((r) => r.restaurantId)).toEqual([1]);
  });

  test('excludes restaurants closed by operating hours', async () => {
    // Monday 03:00 local: outside the 09:00-17:00 Monday window.
    const monday3am = new Date('2026-10-05T03:00:00-04:00');
    mockQuery.mockResolvedValueOnce({
      rows: [
        restRow({
          id: 4,
          operating_hours: { weekly: { mon: { open: '09:00', close: '17:00' } } },
        }),
      ],
    });

    const rows = await fetchOpenRestaurantsNear(39.96, -83.0, 60, monday3am);

    expect(rows).toHaveLength(0);
  });

  test('returns empty when no rows match', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const rows = await fetchOpenRestaurantsNear(39.96, -83.0, 60);

    expect(rows).toEqual([]);
  });
});
