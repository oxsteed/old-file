'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(async () => ({ id: 3, business_id: 42, effective_role: 'manager' })),
}));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn(async () => true),
}));
jest.mock('../services/businessAuditLog', () => ({
  logBusinessAction: jest.fn(async () => undefined),
}));

const controller = require('../controllers/restaurantHQController');
const permissions = require('../services/permissionsService');
const { logBusinessAction } = require('../services/businessAuditLog');

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => { req.user = { id: '00000000-0000-4000-8000-000000000123' }; next(); });
  server.post('/:restaurantId/hq/menu/publish', controller.publishMenuOverrides);
  server.use(errorHandler);
  return server;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  permissions.hasRestaurantPermission.mockResolvedValue(true);
  logBusinessAction.mockResolvedValue(undefined);
});

test('publishes a source store policy transactionally and audits each target', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 4, name: 'Source', status: 'active' }, { id: 5, name: 'Target', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [{ location_id: 5, menu_item_id: 22 }] });
  const response = await request(app()).post('/3/hq/menu/publish').send({ sourceLocationId: 4, targetLocationIds: [5] });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ sourceLocationId: 4, targets: [{ locationId: 5, copiedOverrides: 1 }], published: true });
  expect(logBusinessAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    action: 'restaurant.hq_menu.published',
    target_id: 5,
    metadata: { source_location_id: 4, copied_overrides: 1 },
    client: expect.anything(),
    throwOnError: true,
  }));
});

test('denied HQ permission prevents menu writes', async () => {
  permissions.hasRestaurantPermission.mockResolvedValue(false);
  const response = await request(app()).post('/3/hq/menu/publish').send({ sourceLocationId: 4, targetLocationIds: [5] });
  expect(response.status).toBe(403);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('invalid source and target selections fail before opening a transaction', async () => {
  const response = await request(app()).post('/3/hq/menu/publish').send({ sourceLocationId: 4, targetLocationIds: [4] });
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('validation_failed');
  expect(mockQuery).not.toHaveBeenCalled();
});
