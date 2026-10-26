'use strict';
// F-20: baseline audit for every successful restaurant write.
jest.mock('../db', () => ({ query: jest.fn() }));
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const { restaurantRequestAudit, entryFor, _cache } = require('../middleware/restaurantRequestAudit');
const { logBusinessAction } = require('../services/businessAuditLog');

const flush = () => new Promise((r) => setTimeout(r, 20));
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: 'u-1' }; next(); });
  const router = express.Router();
  router.use(restaurantRequestAudit);
  router.put('/:restaurantId/menu/items/:itemId', (req, res) => res.json({ ok: true }));
  router.post('/:restaurantId/settings', async (req, res) => {
    await logBusinessAction(req, { business_id: 9, action: 'restaurant.settings.updated', after_state: { a: 1 } });
    res.json({ ok: true });
  });
  router.post('/:restaurantId/devices/:deviceId/heartbeat', (req, res) => res.sendStatus(204));
  router.delete('/:restaurantId/tax/:taxId', (req, res) => res.status(409).json({}));
  router.get('/:restaurantId/menu', (req, res) => res.json({}));
  a.use('/api/restaurants', router);
  return a;
}
const inserts = () => pool.query.mock.calls.filter(([sql]) => /INSERT INTO business_audit_log/.test(sql));

beforeEach(() => {
  process.env.RESTAURANT_REQUEST_AUDIT_IN_TESTS = 'true';
  _cache.clear();
  pool.query.mockReset();
  pool.query.mockImplementation(async (sql) => (/FROM food_restaurants/.test(sql) ? { rows: [{ business_id: 9 }] } : { rows: [] }));
});
afterAll(() => { delete process.env.RESTAURANT_REQUEST_AUDIT_IN_TESTS; });

test('an unaudited successful write gets a baseline entry without the body', async () => {
  await request(app()).put('/api/restaurants/5/menu/items/77').send({ price_cents: 999, note: 'call 555-0100', locationId: 3 });
  await flush();
  const [call] = inserts();
  expect(call).toBeDefined();
  const [, values] = call;
  expect(values[0]).toBe(9);
  expect(values[3]).toBe('restaurant.menu.put');
  expect(values[5]).toBe('PUT /:restaurantId/menu/items/:itemId');
  const metadata = JSON.parse(values[8]);
  expect(metadata).toMatchObject({ params: { restaurantId: '5', itemId: '77' }, status: 200, location_id: '3', source: 'request_audit' });
  expect(JSON.stringify(values)).not.toContain('555-0100');
  expect(JSON.stringify(values)).not.toContain('999');
});

test('a handler that wrote its own entry is not double-logged', async () => {
  await request(app()).post('/api/restaurants/5/settings').send({});
  await flush();
  expect(inserts()).toHaveLength(1);
  expect(inserts()[0][1][3]).toBe('restaurant.settings.updated');
});

test('reads, failures and heartbeats are skipped', async () => {
  const a = app();
  await request(a).get('/api/restaurants/5/menu');
  await request(a).delete('/api/restaurants/5/tax/2');
  await request(a).post('/api/restaurants/5/devices/1/heartbeat');
  await flush();
  expect(inserts()).toHaveLength(0);
});

test('entryFor ignores odd ids and non-restaurant urls', () => {
  expect(entryFor({ method: 'POST', route: { path: '/x' }, params: {}, originalUrl: '/api/other', body: {} }, 200)).toBeNull();
  const e = entryFor({ method: 'POST', route: { path: '/:restaurantId/notes' }, params: { restaurantId: '4', bad: 'a b;c' }, originalUrl: '/api/restaurants/4/notes', body: {} }, 201);
  expect(e.metadata.params).toEqual({ restaurantId: '4' });
  expect(e.metadata.actor).toBe('device');
});

test('every restaurant write route is covered by the router-level audit', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../routes/restaurants.js'), 'utf8');
  const auditAt = src.indexOf('restaurantRequestAudit');
  const firstWrite = src.search(/router\.(post|put|patch|delete)\(/);
  expect(auditAt).toBeGreaterThan(-1);
  expect(auditAt).toBeLessThan(firstWrite);
});

test('food router audits merchant restaurant writes only', () => {
  const { createRestaurantRequestAudit, entryFor: ef } = require('../middleware/restaurantRequestAudit');
  expect(typeof createRestaurantRequestAudit).toBe('function');
  const opts = { include: /^\/restaurants\/:restaurantId(\/|$)/, exclude: [/\/campaign-click$/, /\/orders\/quote$/, /\/messages$/, /\/reports$/] };
  const req = (path, url) => ({ method: 'PATCH', route: { path }, params: { restaurantId: '5' }, originalUrl: url, body: {}, user: { id: 'u' } });
  expect(ef(req('/restaurants/:restaurantId/tax-rules/:ruleId', '/api/food/restaurants/5/tax-rules/2'), 200, opts).action).toBe('restaurant.tax-rules.patch');
  expect(ef(req('/restaurants/:restaurantId', '/api/food/restaurants/5'), 200, opts).action).toBe('restaurant.restaurant.patch');
  expect(ef(req('/restaurants/:restaurantId/messages', '/api/food/restaurants/5/messages'), 200, opts)).toBeNull();
  expect(ef(req('/customer/profile', '/api/food/customer/profile'), 200, opts)).toBeNull();
  const src = require('fs').readFileSync(require('path').join(__dirname, '../routes/food.js'), 'utf8');
  expect(src.indexOf('foodMerchantRequestAudit')).toBeLessThan(src.search(/router\.(post|put|patch|delete)\(/));
});
