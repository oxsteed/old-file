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
  instance.post('/:restaurantId/bootstrap', inventory.bootstrapMappings);
  instance.post('/:restaurantId/items/:itemId/adjust', inventory.adjustItem);
  instance.get('/:restaurantId/hooks', flow.getInventoryHookStatus);
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

test('an adjustment replay cannot reveal a sibling store item', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ item_id: 17, location_id: 202 }] });
  const res = await request(app()).post('/3/items/17/adjust').send({ type: 'count', quantity: 1,
    clientOperationId: '9a1ef8e4-832f-4c34-8aa1-b5f7f65b7e09' });
  expect(res.status).toBe(403);
  expect(syncMappedMenuAvailability).not.toHaveBeenCalled();
});

test('hook summary, impacted menu items, and history are limited to assigned stores', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  expect((await request(app()).get('/3/hooks')).status).toBe(200);
  expect(mockQuery).toHaveBeenCalledTimes(3);
  for (const [sql, params] of mockQuery.mock.calls) {
    expect(sql).toContain('location_id = ANY($2::bigint[])');
    expect(params).toEqual([3, [101]]);
  }
  expect(mockQuery.mock.calls[0][0]).toContain('sm.inventory_available');
  expect(mockQuery.mock.calls[1][0]).toContain('i.location_id');
});

test('bootstrap fills a second store with duplicate ingredient names and preserves existing mappings on retries', async () => {
  resolveRestaurantAccess.mockResolvedValue({ id: 3, business_id: 42, effective_role: 'owner' });
  locations.getLocationScope.mockResolvedValue({ mode: 'all', location_ids: null });
  const mappings = new Set(['17:41']);
  mockQuery.mockImplementation(async (sql, params) => {
    if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: 1 }] };
    if (sql.includes('SELECT DISTINCT i.location_id')) return { rows: [{ location_id: 101 }, { location_id: 202 }] };
    if (sql.includes('FROM restaurant_inventory_items')) return { rows: [
      { id: 17, location_id: 101, name: 'burger buns' },
      { id: 18, location_id: 202, name: 'burger buns' },
    ] };
    if (sql.includes('FROM food_menu_items')) return { rows: [{ id: 41, name: 'classic ox burger' }] };
    if (sql.includes('INSERT INTO restaurant_inventory_item_mappings')) {
      const key = `${params[1]}:${params[2]}`;
      if (mappings.has(key)) return { rows: [] };
      mappings.add(key);
      return { rows: [{ id: 8 }] };
    }
    return { rows: [] };
  });
  expect((await request(app()).post('/3/bootstrap')).status).toBe(200);
  expect([...mappings]).toEqual(['17:41', '18:41']);
  expect((await request(app()).post('/3/bootstrap')).status).toBe(200);
  expect(mappings.size).toBe(2);
  expect(syncMappedMenuAvailability.mock.calls.map(([, , options]) => options.locationId)).toEqual([101, 202, 101, 202]);
});
