'use strict';

/**
 * Tests for the featured placement lifecycle (migration 677):
 * admin review endpoints + effective-featured discovery.
 *
 * DB access is mocked via __tests__/setup.js (mockQuery), following the
 * pattern of the other admin controller tests.
 */

const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/adminFeaturedPlacementController');
const { listRestaurants } = require('../controllers/foodController');

beforeEach(() => {
  resetMocks();
});

function mockRes() {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { json, status };
}

const ADMIN_REQ = { user: { id: 'admin-uuid-1' } };

describe('listRequests', () => {
  test('returns requests joined with business, restaurants, and requester email', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            business_id: 41,
            business_name: 'Testaurant',
            requested_by_id: 'user-uuid-9',
            requester_email: 'owner@example.com',
            category: 'restaurant',
            zip: '43215',
            note: 'please feature us',
            source: 'promote_page',
            status: 'requested',
            created_at: '2026-10-04T10:00:00Z',
            updated_at: '2026-10-04T10:00:00Z',
            decided_by_id: null,
            decided_at: null,
            decision_note: null,
            featured_restaurant_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 101,
            business_id: 41,
            display_name: 'Testaurant Main',
            is_featured: false,
            featured_rank: 1000,
            featured_until: null,
          },
        ],
      });

    const res = mockRes();
    await ctrl.listRequests({ ...ADMIN_REQ, query: {} }, res);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const listSql = mockQuery.mock.calls[0][0];
    expect(listSql).toContain('business_featured_placement_requests');
    expect(listSql).toContain('ORDER BY r.created_at DESC');
    const [reqBody] = res.json.mock.calls[0];
    expect(reqBody.items).toHaveLength(1);
    expect(reqBody.items[0]).toMatchObject({
      id: 7,
      business_id: 41,
      business_name: 'Testaurant',
      requested_by_email: 'owner@example.com',
      status: 'requested',
    });
    expect(reqBody.items[0].restaurants).toHaveLength(1);
    expect(reqBody.items[0].restaurants[0]).toMatchObject({
      id: 101,
      name: 'Testaurant Main',
      is_featured: false,
    });
  });

  test('filters by status and rejects unknown statuses', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await ctrl.listRequests({ ...ADMIN_REQ, query: { status: 'approved' } }, res);
    const listSql = mockQuery.mock.calls[0][0];
    expect(listSql).toContain("($1 = 'all' OR r.status = $1)");
    expect(mockQuery.mock.calls[0][1][0]).toBe('approved');

    await expect(
      ctrl.listRequests({ ...ADMIN_REQ, query: { status: 'bogus' } }, mockRes())
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('contactRequest / declineRequest', () => {
  test('contact marks the request contacted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, status: 'contacted' }] });
    const res = mockRes();
    await ctrl.contactRequest({ ...ADMIN_REQ, params: { id: '7' } }, res);
    expect(mockQuery.mock.calls[0][0]).toContain("SET status = 'contacted'");
    expect(res.json).toHaveBeenCalledWith({ id: 7, status: 'contacted' });
  });

  test('contact 404s on unknown request', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      ctrl.contactRequest({ ...ADMIN_REQ, params: { id: '999' } }, mockRes())
    ).rejects.toMatchObject({ status: 404 });
  });

  test('decline records status and decision audit fields', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, status: 'declined' }] });
    const res = mockRes();
    await ctrl.declineRequest({ ...ADMIN_REQ, params: { id: '7' }, body: { note: 'not eligible' } }, res);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("SET status = 'declined'");
    expect(sql).toContain('decided_by_id');
    expect(params).toEqual(expect.arrayContaining(['admin-uuid-1', 'not eligible']));
    expect(res.json).toHaveBeenCalledWith({ id: 7, status: 'declined' });
  });

  test('decline rejects overlong notes', async () => {
    await expect(
      ctrl.declineRequest({ ...ADMIN_REQ, params: { id: '7' }, body: { note: 'x'.repeat(1001) } }, mockRes())
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('approveRequest', () => {
  function mockApproveSetup({ requestStatus = 'requested', featured_restaurant_id = null, restaurantBusinessId = 41, is_featured = false, featured_until = null } = {}) {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 7, business_id: 41, status: requestStatus, featured_restaurant_id }],
      }) // request FOR UPDATE
      .mockResolvedValueOnce({
        rows: [{ id: 101, business_id: restaurantBusinessId, is_featured, featured_until }],
      }) // restaurant FOR UPDATE
      .mockResolvedValueOnce({
        rows: [{ id: 101, is_featured: true, featured_rank: 10, featured_until: '2026-11-03T00:00:00Z' }],
      }) // UPDATE food_restaurants
      .mockResolvedValueOnce({ rows: [] }) // UPDATE request
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
  }

  test('happy path features the restaurant and approves the request in one transaction', async () => {
    mockApproveSetup();
    const res = mockRes();
    await ctrl.approveRequest(
      { ...ADMIN_REQ, params: { id: '7' }, body: { restaurantId: 101, rank: 10, days: 30 } },
      res
    );

    const calls = mockQuery.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');

    const featureSql = calls.find((s) => s.includes('UPDATE food_restaurants'));
    expect(featureSql).toContain('is_featured = TRUE');
    expect(featureSql).toContain('make_interval(days => $3)');
    const featureParams = mockQuery.mock.calls.find((c) => c[0].includes('UPDATE food_restaurants'))[1];
    expect(featureParams).toEqual([101, 10, 30]);

    const approveSql = calls.find((s) => s.includes('UPDATE business_featured_placement_requests'));
    expect(approveSql).toContain("status = 'approved'");
    expect(approveSql).toContain('featured_restaurant_id');

    expect(res.status).toHaveBeenCalledWith(200);
    const [body] = res.json.mock.calls[0];
    expect(body.status).toBe('approved');
    expect(body.restaurant).toMatchObject({ id: 101, is_featured: true });
  });

  test('validation errors: bad rank, bad days, missing restaurantId', async () => {
    await expect(
      ctrl.approveRequest({ ...ADMIN_REQ, params: { id: '7' }, body: { restaurantId: 101, rank: 5000 } }, mockRes())
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      ctrl.approveRequest({ ...ADMIN_REQ, params: { id: '7' }, body: { restaurantId: 101, days: 0 } }, mockRes())
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      ctrl.approveRequest({ ...ADMIN_REQ, params: { id: '7' }, body: {} }, mockRes())
    ).rejects.toMatchObject({ status: 400 });
    // No transaction started on validation failure.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('400 when the restaurant does not belong to the requesting business', async () => {
    mockApproveSetup({ restaurantBusinessId: 999 });
    await expect(
      ctrl.approveRequest({ ...ADMIN_REQ, params: { id: '7' }, body: { restaurantId: 101 } }, mockRes())
    ).rejects.toMatchObject({ status: 400 });
  });

  test('409 when the restaurant is already effectively featured by someone else', async () => {
    mockApproveSetup({ is_featured: true, featured_until: '2099-01-01T00:00:00Z' });
    await expect(
      ctrl.approveRequest({ ...ADMIN_REQ, params: { id: '7' }, body: { restaurantId: 101 } }, mockRes())
    ).rejects.toMatchObject({ status: 409 });
  });

  test('same request may re-approve to update rank and duration', async () => {
    mockApproveSetup({
      requestStatus: 'approved',
      featured_restaurant_id: 101,
      is_featured: true,
      featured_until: '2099-01-01T00:00:00Z',
    });
    const res = mockRes();
    await ctrl.approveRequest(
      { ...ADMIN_REQ, params: { id: '7' }, body: { restaurantId: 101, rank: 3, days: 60 } },
      res
    );
    expect(res.json).toHaveBeenCalled();
    const [body] = res.json.mock.calls[0];
    expect(body.status).toBe('approved');
  });

  test('404 on unknown request rolls back', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await expect(
      ctrl.approveRequest({ ...ADMIN_REQ, params: { id: '999' }, body: { restaurantId: 101 } }, mockRes())
    ).rejects.toMatchObject({ status: 404 });
    const calls = mockQuery.mock.calls.map((c) => c[0]);
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });
});

describe('revokeRequest', () => {
  test('happy path clears the feature and closes the request', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7, featured_restaurant_id: 101 }] }) // request FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 101 }] }) // effectively-featured check
      .mockResolvedValueOnce({ rows: [] }) // UPDATE food_restaurants
      .mockResolvedValueOnce({ rows: [] }) // UPDATE request
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = mockRes();
    await ctrl.revokeRequest({ ...ADMIN_REQ, params: { id: '7' } }, res);

    const calls = mockQuery.mock.calls.map((c) => c[0]);
    const clearSql = calls.find((s) => s.includes('UPDATE food_restaurants'));
    expect(clearSql).toContain('is_featured = FALSE');
    expect(clearSql).toContain('featured_until = NULL');
    const closeSql = calls.find((s) => s.includes('UPDATE business_featured_placement_requests'));
    expect(closeSql).toContain("status = 'closed'");
    expect(res.json).toHaveBeenCalledWith({ id: 7, status: 'closed', restaurantId: 101 });
  });

  test('404 when nothing is currently featured under the request', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7, featured_restaurant_id: 101 }] }) // request FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // effectively-featured check: none
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(
      ctrl.revokeRequest({ ...ADMIN_REQ, params: { id: '7' } }, mockRes())
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('listFeatured', () => {
  test('returns only effectively-featured restaurants', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 101, business_id: 41, display_name: 'A', is_featured: true, featured_rank: 5, featured_until: null, business_name: 'Biz A' },
      ],
    });
    const res = mockRes();
    await ctrl.listFeatured({ ...ADMIN_REQ, query: {} }, res);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('fr.is_featured AND (fr.featured_until IS NULL OR fr.featured_until > NOW())');
    expect(sql).toContain('ORDER BY fr.featured_rank ASC');
    const [body] = res.json.mock.calls[0];
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: 101, is_featured: true, business_name: 'Biz A' });
  });
});

describe('directory discovery (foodController.listRestaurants)', () => {
  function mockDirectory() {
    mockQuery.mockResolvedValueOnce({ rows: [] });
  }

  test('featured_only returns only effectively-featured, ordered by rank then rating', async () => {
    mockDirectory();
    const res = mockRes();
    await listRestaurants({ query: { featured_only: 'true' } }, res, (e) => { throw e; });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('(fr.is_featured AND (fr.featured_until IS NULL OR fr.featured_until > NOW()))');
    expect(sql).toContain('ORDER BY fr.featured_rank ASC, fr.avg_rating DESC');
  });

  test('expired features are excluded by the effective-featured predicate', async () => {
    mockDirectory();
    const res = mockRes();
    await listRestaurants({ query: { featured_only: 'true' } }, res, (e) => { throw e; });
    const [sql] = mockQuery.mock.calls[0];
    // The predicate itself excludes expired rows: featured_until must be NULL or in the future.
    expect(sql).toMatch(/featured_until IS NULL OR fr\.featured_until > NOW\(\)/);
  });

  test('default ordering uses the effective-featured expression and honors the hold guard', async () => {
    mockDirectory();
    const res = mockRes();
    await listRestaurants({ query: {} }, res, (e) => { throw e; });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('(fr.is_featured AND (fr.featured_until IS NULL OR fr.featured_until > NOW())) DESC');
    expect(sql).toContain("fr.discovery_status = 'visible'");
    expect(sql).toContain('COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE');
    // No featured filter in the default path.
    expect(sql).not.toContain('ORDER BY fr.featured_rank ASC, fr.avg_rating DESC');
  });
});
