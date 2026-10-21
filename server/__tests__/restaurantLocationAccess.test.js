'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(async () => ({
    id: 3, business_id: 42, effective_role: 'manager', display_name: 'Brand',
  })),
}));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn(async () => true),
}));
jest.mock('../services/businessAuditLog', () => ({ logBusinessAction: jest.fn(async () => {}) }));

const ctrl = require('../controllers/restaurantLocationAccessController');
const permissions = require('../services/permissionsService');
const { assertLocationAccess, getLocationScope } = require('../services/restaurantLocationAccessService');

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => { req.user = { id: '00000000-0000-4000-8000-000000000123' }; next(); });
  server.get('/:restaurantId/location-access', ctrl.list);
  server.put('/:restaurantId/location-access/:membershipId', ctrl.replace);
  server.delete('/:restaurantId/location-access/:membershipId', ctrl.clear);
  server.use(errorHandler);
  return server;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  permissions.hasRestaurantPermission.mockResolvedValue(true);
});

test('lists store assignments and active restaurant members in one tenant-scoped response', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 7, name: 'Main', status: 'active', is_primary: true }] })
    .mockResolvedValueOnce({ rows: [{ membership_id: 55, member_id: 'member-1', role: 'manager', status: 'active', email: 'manager@example.com' }] })
    .mockResolvedValueOnce({ rows: [{ id: 91, membership_id: 55, location_id: 7, role_override: 'employee', status: 'active' }] });
  const response = await request(app()).get('/3/location-access');
  expect(response.status).toBe(200);
  expect(response.body.locations).toHaveLength(1);
  expect(response.body.members[0].membership_id).toBe(55);
  expect(response.body.assignments[0]).toMatchObject({ membership_id: 55, location_id: 7, role_override: 'employee' });
  expect(permissions.hasRestaurantPermission).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['settings.view']);
});

test('replaces a member scope only with stores from the same restaurant', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 55, member_id: 'member-1', role: 'manager', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [{ id: 7 }, { id: 8 }] })
    .mockResolvedValueOnce({ rows: [{ assignments: [{ location_id: 7, role_override: null }] }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 101, membership_id: 55, location_id: 7, role_override: 'employee', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [{ id: 102, membership_id: 55, location_id: 8, role_override: 'employee', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [
      { id: 101, membership_id: 55, location_id: 7, role_override: 'employee', status: 'active' },
      { id: 102, membership_id: 55, location_id: 8, role_override: 'employee', status: 'active' },
    ] });
  const response = await request(app())
    .put('/3/location-access/55')
    .send({ locationIds: [7, 8], roleOverride: 'employee' });
  expect(response.status).toBe(200);
  expect(response.body.assignments).toHaveLength(2);
  expect(response.body.assignments[0].location_id).toBe(7);
  expect(mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO restaurant_location_memberships'))).toHaveLength(2);
  expect(permissions.hasRestaurantPermission).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['settings.manage']);
});

test('rejects empty assignment lists instead of accidentally broadening access', async () => {
  const response = await request(app()).put('/3/location-access/55').send({ locationIds: [] });
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('validation_failed');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('clearing a scope is explicit and returns the resulting all-store mode', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 101 }] });
  const response = await request(app()).delete('/3/location-access/55');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ cleared: 1, scope: 'all' });
  expect(mockQuery.mock.calls[0][0]).toContain("SET status = 'revoked'");
});

test('assigned members cannot read a sibling store through a location-scoped surface', async () => {
  const db = { query: jest.fn(async () => ({ rows: [{ location_id: 7, role_override: 'employee' }] })) };
  const restaurant = { id: 3, business_id: 42, effective_role: 'manager' };
  await expect(assertLocationAccess(restaurant, 'member-1', 8, db))
    .rejects.toMatchObject({ code: 'location_scope_forbidden', status: 403 });
  expect((await getLocationScope(restaurant, 'member-1', db)).location_ids).toEqual([7]);
});

