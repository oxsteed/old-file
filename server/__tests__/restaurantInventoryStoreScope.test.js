'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
jest.mock('../services/scopeModel', () => ({ resolveRestaurantAccess: jest.fn() }));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn(async () => true),
  getEffectivePermissions: jest.fn(async () => ({ permissions: new Set(['inventory.manage']) })),
  hasAny: (grants, codes) => codes.some((code) => grants.has(code)),
}));
jest.mock('../services/restaurantLocationAccessService', () => ({
  getLocationScope: jest.fn(), assertLocationAccess: jest.fn(),
}));
jest.mock('../services/restaurantInventoryAvailabilityService', () => ({
  syncMappedMenuAvailability: jest.fn(async () => ({ changes: [], applied: true })),
}));
jest.mock('../services/restaurantInventoryAuditService', () => ({ logInventoryAudit: jest.fn() }));
const { resolveRestaurantAccess } = require('../services/scopeModel');
const locations = require('../services/restaurantLocationAccessService');
const { AppError } = require('../middleware/errorHandler');
const { syncMappedMenuAvailability } = require('../services/restaurantInventoryAvailabilityService');
const inventory = require('../controllers/restaurantInventoryController');
const flow = require('../controllers/restaurantAppFlowController');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use((req, res, next) => { req.user = { id: 'staff' }; next(); });
  instance.post('/:restaurantId/sync', flow.syncMenuAvailability);
  instance.post('/:restaurantId/mappings', inventory.upsertMapping);
  instance.delete('/:restaurantId/mappings/:mappingId', inventory.deleteMapping);
  instance.get('/:restaurantId/mappings', inventory.listMappings);
  instance.use(errorHandler);
  return instance;
}

beforeEach(() => {
  resetMocks(); jest.clearAllMocks();
  resolveRestaurantAccess.mockResolvedValue({ id: 3, business_id: 42, effective_role: 'manager', effective_membership_id: 8 });
  locations.getLocationScope.mockResolvedValue({ mode: 'assigned', location_ids: [101] });
  locations.assertLocationAccess.mockImplementation(async (_restaurant, _user, locationId) => {
    if (locationId !== 101) throw new AppError('Store denied', 403, 'location_scope_forbidden');
  });
});

test('manual sync rejects an inaccessible store before any write', async () => {
  const res = await request(app()).post('/3/sync').send({ locationId: 202, apply: true });
  expect(res.status).toBe(403);
  expect(syncMappedMenuAvailability).not.toHaveBeenCalled();
  expect(mockQuery).not.toHaveBeenCalled();
});

test('manual sync without a selection only syncs assigned stores', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 101 }] });
  expect((await request(app()).post('/3/sync').send({ apply: true })).status).toBe(200);
  expect(mockQuery.mock.calls[0][0]).toContain('id = ANY($3::bigint[])');
  expect(mockQuery.mock.calls[0][1]).toEqual([3, null, [101]]);
  expect(syncMappedMenuAvailability).toHaveBeenCalledTimes(1);
  expect(syncMappedMenuAvailability).toHaveBeenCalledWith(expect.anything(), 3,
    { locationId: 101, apply: true, createdBy: 'staff' });
});

test.each(['create', 'delete'])('mapping %s cannot mutate stock in a sibling store', async (action) => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, location_id: 202, inventory_exists: true, menu_exists: true }] });
  const res = action === 'create'
    ? await request(app()).post('/3/mappings').send({ inventoryItemId: 17, menuItemId: 41, usageLabel: '1 bun' })
    : await request(app()).delete('/3/mappings/7');
  expect(res.status).toBe(403);
  expect(mockQuery.mock.calls.some(([sql]) => /\b(INSERT|DELETE|UPDATE)\b/.test(sql.replace('FOR UPDATE OF rim', '')))).toBe(false);
  expect(syncMappedMenuAvailability).not.toHaveBeenCalled();
});

test('mapping creation refreshes only the inventory item store', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ location_id: 101, inventory_exists: true, menu_exists: true }] })
    .mockResolvedValueOnce({ rows: [{ id: 7, inventory_item_id: 17, menu_item_id: 41 }] });
  expect((await request(app()).post('/3/mappings').send({ inventoryItemId: 17, menuItemId: 41, usageLabel: '1 bun' })).status).toBe(201);
  expect(syncMappedMenuAvailability).toHaveBeenCalledWith(expect.anything(), 3,
    { menuItemId: 41, locationId: 101, apply: true, createdBy: 'staff' });
});

test('mapping deletion refreshes only its inventory item store', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, location_id: 101 }] })
    .mockResolvedValueOnce({ rows: [{ id: 7, inventory_item_id: 17, menu_item_id: 41 }] });
  expect((await request(app()).delete('/3/mappings/7')).status).toBe(200);
  expect(syncMappedMenuAvailability).toHaveBeenCalledWith(expect.anything(), 3,
    { menuItemId: 41, locationId: 101, apply: true, createdBy: 'staff' });
});

test('mapping listing uses the assigned-store filter', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  expect((await request(app()).get('/3/mappings')).status).toBe(200);
  expect(mockQuery.mock.calls[0][0]).toContain('rii.location_id = ANY($2::bigint[])');
  expect(mockQuery.mock.calls[0][1]).toEqual([3, [101]]);
});
