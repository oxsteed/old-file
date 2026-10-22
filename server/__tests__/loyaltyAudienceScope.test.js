'use strict';

/**
 * Loyalty CRM audience store-scoping (auth-audit finding 33).
 *
 * The audience aggregates counted customers across all stores. A
 * location-scoped viewer now only aggregates customers with orders at
 * their stores; naming a store outside the scope is a 403.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(async () => ({
    id: 42, business_id: 7, effective_role: 'manager', currency_code: 'USD',
  })),
}));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn(async () => true),
}));
jest.mock('../services/restaurantLocationAccessService', () => ({
  getLocationScope: jest.fn(),
}));
jest.mock('../services/businessAuditLog', () => ({
  logBusinessAction: jest.fn(async () => {}),
}));

const { getLocationScope } = require('../services/restaurantLocationAccessService');
const ctrl = require('../controllers/restaurantLoyaltyController');
const { scopedAudience, audienceWhere } = ctrl._normalize;
const { errorHandler } = require('../middleware/errorHandler');
const express = require('express');
const request = require('supertest');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'manager-1' }; next(); });
  app.get('/r/:restaurantId/segments', ctrl.listSegments);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => errorHandler(err, _req, res, _req));
  return app;
}

const RESTAURANT = { id: 42, locationScope: { mode: 'assigned', location_ids: [7], assignments: [] } };
const UNSCOPED = { id: 42, locationScope: { mode: 'all', location_ids: null, assignments: [] } };

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('finding 33: scopedAudience', () => {
  test('unscoped viewers pass through untouched', () => {
    expect(scopedAudience(UNSCOPED, {})).toEqual({ criteria: {}, scopeLocationIds: null });
  });

  test('scoped viewer without an explicit store gets the scope filter', () => {
    expect(scopedAudience(RESTAURANT, {})).toEqual({ criteria: {}, scopeLocationIds: [7] });
  });

  test('scoped viewer naming their own store keeps the explicit filter', () => {
    const out = scopedAudience(RESTAURANT, { location_id: 7 });
    expect(out).toEqual({ criteria: { location_id: 7 }, scopeLocationIds: null });
  });

  test('scoped viewer naming another store gets a 403', () => {
    expect(() => scopedAudience(RESTAURANT, { location_id: 99 })).toThrow(
      expect.objectContaining({ code: 'location_scope_forbidden' })
    );
  });
});

describe('finding 33: audienceWhere + audience SQL', () => {
  test('scope ids become an ANY filter on has_location_order', () => {
    const { clauses, params } = audienceWhere({}, [7, 9]);
    expect(params).toEqual([[7, 9]]);
    expect(clauses).toEqual(['has_location_order = TRUE']);
  });

  test('an explicit store keeps the scalar filter', () => {
    const { clauses, params } = audienceWhere({ location_id: 7 }, [7, 9]);
    expect(params).toEqual([7]);
    expect(clauses).toEqual(['has_location_order = TRUE']);
  });

  test('listSegments threads the scope into the audience CTE', async () => {
    getLocationScope.mockResolvedValue({ mode: 'assigned', location_ids: [7], assignments: [] });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, restaurant_id: 42, name: 'VIP', criteria: {}, is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ total_customers: 10, matching_customers: 4 }] });
    const res = await request(buildApp()).get('/r/42/segments');
    expect(res.status).toBe(200);
    const audienceSql = mockQuery.mock.calls[1][0];
    const audienceParams = mockQuery.mock.calls[1][1];
    expect(audienceSql).toContain('= ANY(');
    expect(audienceParams[audienceParams.length - 1]).toEqual([7]);
  });

  test('listSegments without a scope has no store filter (back-compat)', async () => {
    getLocationScope.mockResolvedValue({ mode: 'all', location_ids: null, assignments: [] });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, restaurant_id: 42, name: 'VIP', criteria: {}, is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ total_customers: 10, matching_customers: 4 }] });
    const res = await request(buildApp()).get('/r/42/segments');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][0]).not.toContain('= ANY(');
  });
});
