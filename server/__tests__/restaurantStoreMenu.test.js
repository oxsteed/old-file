'use strict';
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const menu = require('../services/restaurantStoreMenuService');
jest.mock('../services/scopeModel', () => ({ resolveRestaurantAccess: jest.fn(async () => ({ id: 3, business_id: 42, effective_role: 'manager' })) }));
jest.mock('../services/permissionsService', () => ({ hasRestaurantPermission: jest.fn(async () => true) }));
jest.mock('../services/restaurantStaffIdentityService', () => ({ resolveActingStaff: jest.fn(async () => null) }));
jest.mock('../services/businessAuditLog', () => ({ logBusinessAction: jest.fn(async () => {}) }));
jest.mock('../services/restaurantLocationAccessService', () => ({ getLocationRole: jest.fn(async () => null) }));
const ctrl = require('../controllers/restaurantStoreMenuController');
const { logBusinessAction } = require('../services/businessAuditLog');
const { hasRestaurantPermission } = require('../services/permissionsService');
const { getLocationRole } = require('../services/restaurantLocationAccessService');
function app() {
  const instance = express(); instance.use(express.json());
  instance.use((req, _res, next) => { req.user = { id: '00000000-0000-4000-8000-000000000123' }; next(); });
  instance.get('/:restaurantId/locations/:locationId/menu', ctrl.list);
  instance.patch('/:restaurantId/locations/:locationId/menu-items/:itemId', ctrl.update);
  instance.use(errorHandler); return instance;
}
beforeEach(() => { resetMocks(); jest.clearAllMocks(); hasRestaurantPermission.mockResolvedValue(true); getLocationRole.mockResolvedValue(null); logBusinessAction.mockResolvedValue(undefined); });

test('store pricing inherits independently from temporary availability and cannot override brand stock', () => {
  const base = { price_cents: 1000, is_available: true, store_override: { price_cents: 1250, is_available: false, available_again_at: '2026-01-02T00:00:00Z' } };
  expect(menu.applyOverride(base, new Date('2026-01-01'))).toMatchObject({ price_cents: 1250, is_available: false });
  expect(menu.applyOverride(base, new Date('2026-01-03'))).toMatchObject({ price_cents: 1250, is_available: true });
  expect(menu.applyOverride({ ...base, is_available: false }, new Date('2026-01-03')).is_available).toBe(false);
  expect(menu.applyOverride({ ...base, store_override: { price_cents: 0 } }).price_cents).toBe(0);
});

test('store inventory can recover from legacy global stock state while a brand manual block still wins', () => {
  const item = { is_available: false, manual_available: true, inventory_available: false,
    store_override: { inventory_available: true } };
  expect(menu.applyOverride(item).is_available).toBe(true);
  expect(menu.applyOverride({ ...item, manual_available: false }).is_available).toBe(false);
});

test('store menu reads select the availability fields used by public menu pricing', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT id FROM restaurant_locations')) return { rows: [{ id: 7 }] };
    if (sql.startsWith('SELECT * FROM restaurant_locations')) return { rows: [{ id: 7, restaurant_id: 3 }] };
    if (sql.includes('FROM food_menu_items fmi')) {
      expect(sql).toContain('fmi.manual_available');
      expect(sql).toContain('fmi.inventory_available');
      return { rows: [{ id: 11, price_cents: 1000, is_available: false, manual_available: true,
        inventory_available: false, store_override: { inventory_available: true } }] };
    }
    return { rows: [] };
  });
  const response = await request(app()).get('/3/locations/7/menu');
  expect(response.status).toBe(200);
  expect(response.body.items[0].is_available).toBe(true);
});

test.each([0, -1, '2x', '1.5', [], '9007199254740992'])('invalid store id %j fails rather than selecting the primary store', (value) => {
  expect(() => menu.locationId(value)).toThrow('Invalid store');
});
test.each([{ priceCents: -1 }, { priceCents: 1.5 }, { priceCents: '100' }, { isAvailable: 'false' }, { anySql: 'x' }, {}])('invalid menu patch %j rejects', (value) => {
  expect(() => menu.validatePatch(value)).toThrow();
});
test('restocking requires an explicitly zoned future time and a sold-out item', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  expect(() => menu.validatePatch({ isAvailable: false, availableAgainAt: '2026-01-02T12:00' }, {}, now)).toThrow();
  expect(() => menu.validatePatch({ isAvailable: true, availableAgainAt: '2026-01-02T12:00Z' }, {}, now)).toThrow();
  expect(menu.validatePatch({ availableAgainAt: '2026-01-02T12:00Z' }, { is_available: false }, now).available_again_at).toBe('2026-01-02T12:00:00.000Z');
  expect(menu.validatePatch({ isAvailable: null }, { is_available: false, available_again_at: '2026-01-02T12:00Z' }, now)).toMatchObject({ is_available: null, available_again_at: null });
});

function mockStoreQueries({ foreign = false } = {}) {
  mockQuery.mockImplementation(async (sql, params) => {
    if (sql.startsWith('SELECT id FROM restaurant_locations')) return { rows: foreign ? [] : [{ id: 7 }] };
    if (sql.startsWith('SELECT * FROM restaurant_locations')) return { rows: [{ id: 7, restaurant_id: 3, status: 'active' }] };
    if (sql.includes('FROM food_menu_items WHERE')) return { rows: [{ id: 11, name: 'Soup', price_cents: 1000, is_available: true }] };
    if (sql.startsWith('SELECT * FROM restaurant_store_menu_overrides')) return { rows: [{ price_cents: 1200, is_available: true }] };
    if (sql.startsWith('INSERT INTO restaurant_store_menu_overrides')) return { rows: [{ restaurant_id: params[0], location_id: params[1], menu_item_id: params[2], price_cents: params[3], is_available: params[4], available_again_at: params[5] }] };
    return { rows: [] };
  });
}
test('a store availability change preserves that store price and writes an atomic audit entry', async () => {
  mockStoreQueries();
  const response = await request(app()).patch('/3/locations/7/menu-items/11').send({ isAvailable: false });
  expect(response.status).toBe(200);
  expect(response.body.item).toMatchObject({ id: 11, price_cents: 1200, is_available: false });
  expect(logBusinessAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ client: expect.anything(), throwOnError: true, metadata: { location_id: 7 } }));
  expect(mockQuery.mock.calls.some(([sql]) => /^UPDATE food_menu_items/.test(sql))).toBe(false);
});
test('foreign-restaurant stores cannot receive overrides', async () => {
  mockStoreQueries({ foreign: true });
  expect((await request(app()).patch('/3/locations/777/menu-items/11').send({ isAvailable: false })).status).toBe(400);
  expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
});
test('price changes require menu.manage and a denied grant never writes', async () => {
  hasRestaurantPermission.mockResolvedValue(false);
  expect((await request(app()).patch('/3/locations/7/menu-items/11').send({ priceCents: 1200 })).status).toBe(403);
  expect(hasRestaurantPermission).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['menu.manage']);
  expect(mockQuery.mock.calls.some(([sql]) => /\b(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
});
test('audit failure rejects the transaction rather than returning a successful unaudited change', async () => {
  mockStoreQueries(); logBusinessAction.mockRejectedValue(new Error('audit offline'));
  expect((await request(app()).patch('/3/locations/7/menu-items/11').send({ isAvailable: false })).status).toBe(500);
});
test('location role overrides use the same required permission set without crashing', async () => {
  mockStoreQueries();
  getLocationRole.mockResolvedValue('employee');
  const response = await request(app()).patch('/3/locations/7/menu-items/11').send({ isAvailable: false });
  expect(response.status).toBe(200);
  expect(hasRestaurantPermission).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    ['menu.manage', 'pos.use', 'kitchen.update'],
    { roleOverride: 'employee' },
  );
});

test.each([true, false])('a real quote uses the selected store price and availability (%s)', async (available) => {
  const food = require('../controllers/foodController');
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('FROM food_restaurants fr')) return { rows: [{
      id: 3, currency_code: 'USD', accepts_online_orders: true, fulfillment_modes: ['pickup'], settings: {},
      store_location: { id: 7, status: 'active', timezone: 'America/New_York' },
    }] };
    if (sql.includes('FROM food_menu_items fmi')) return { rows: [{ id: 11, name: 'Soup', price_cents: 1000,
      currency_code: 'USD', is_available: true, modifier_groups: [], store_override: { price_cents: 1250, is_available: available } }] };
    return { rows: [] };
  });
  const instance = app(); instance.post('/quote', food.quoteOrder); instance.use(errorHandler);
  const response = await request(instance).post('/quote').send({ restaurantId: 3, locationId: 7,
    orderSource: 'web', paymentMode: 'pay_at_restaurant', items: [{ menuItemId: 11, quantity: 2 }] });
  expect(response.status).toBe(available ? 200 : 400);
  if (available) expect(response.body.quote).toMatchObject({ locationId: 7, subtotalCents: 2500, totalCents: 2500 });
  const menuRead = mockQuery.mock.calls.find(([sql]) => sql.includes('FROM food_menu_items fmi'));
  expect(menuRead[1][2]).toBe(7);
});

test('a retry key cannot be silently reused for another requested store', () => {
  const { buildFoodOrderIdempotencyFingerprint: fingerprint } = require('../controllers/foodController');
  const request = { items: [{ menuItemId: 11, quantity: 1 }], locationId: 7 };
  expect(fingerprint({ restaurantId: 3, paymentMode: 'pay_at_restaurant', request })).not.toBe(
    fingerprint({ restaurantId: 3, paymentMode: 'pay_at_restaurant', request: { ...request, locationId: 8 } }));
});


test('paired terminals and cash drawers cannot price or replay a sibling store', () => {
  expect(menu.pinnedLocation(7, 7)).toBe(7);
  expect(menu.pinnedLocation(undefined, 7)).toBe(7);
  expect(menu.pinnedLocation(7, null)).toBe(7);
  expect(() => menu.pinnedLocation(8, 7)).toThrow('Store differs');
});

test('selected store pricing policy overrides the brand policy without mutating the source row', () => {
  const restaurant = { tax_rate_bps: 725, service_fee_bps: 0, timezone: 'UTC' };
  const store = { tax_rate_bps: 887, service_fee_bps: 150, tax_inclusive: true, tax_jurisdiction: 'Local' };
  menu.useStoreDetails(restaurant, store);
  expect(restaurant).toMatchObject({ tax_rate_bps: 887, service_fee_bps: 150, tax_inclusive: true, tax_jurisdiction: 'Local' });
  expect(store.tax_rate_bps).toBe(887);
});
