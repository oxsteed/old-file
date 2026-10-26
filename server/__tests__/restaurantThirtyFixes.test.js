'use strict';
jest.unmock('../utils/transaction');
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/scopeModel', () => ({ resolveRestaurantAccess: jest.fn() }));
jest.mock('../services/permissionsService', () => ({ hasRestaurantPermission: jest.fn(), getEffectivePermissions: jest.fn(), hasAny: (grants, codes) => codes.some((code) => grants.has(code)) }));
jest.mock('../services/restaurantLocationAccessService', () => ({ getLocationScope: jest.fn(), assertLocationAccess: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn() }));
const scopeModel = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const locations = require('../services/restaurantLocationAccessService');
const giftCards = require('../controllers/restaurantGiftCardController');
const loyalty = require('../controllers/restaurantLoyaltyController');
const marketplace = require('../controllers/restaurantDeliveryMarketplaceController');
const inventory = require('../controllers/restaurantInventoryOperationsController');
const payroll = require('../controllers/restaurantPayrollController');
const giftService = require('../services/restaurantGiftCardService');
const campaignService = require('../services/restaurantLoyaltyCampaignService');
const marketplaceService = require('../services/restaurantDeliveryMarketplaceService');
const notifications = require('../services/notificationService');
const { hostingMessage } = require('../services/restaurantHostingMessages');
const restaurant = { id: 3, business_id: 42, effective_role: 'employee', effective_membership_id: 8, timezone: 'America/New_York' };
function req(body = {}, params = {}) { return { params: { restaurantId: '3', ...params }, body, query: {}, user: { id: 'staff' }, headers: {}, get: () => 'retry' }; }
async function invoke(handler, request = req()) {
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), end: jest.fn(), send: jest.fn(), setHeader: jest.fn() };
  const next = jest.fn(); await handler(request, res, next); return { res, error: next.mock.calls[0]?.[0] };
}
beforeEach(() => {
  resetMocks(); jest.restoreAllMocks(); jest.clearAllMocks();
  scopeModel.resolveRestaurantAccess.mockResolvedValue({ ...restaurant });
  permissions.hasRestaurantPermission.mockResolvedValue(true);
  permissions.getEffectivePermissions.mockResolvedValue({ permissions: new Set(['payroll.view', 'payroll.manage', 'audit.view', 'inventory.view']) });
  locations.getLocationScope.mockResolvedValue({ mode: 'all', location_ids: null });
  locations.assertLocationAccess.mockResolvedValue({ mode: 'all', location_ids: null });
  mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  delete process.env.RESTAURANT_LOYALTY_DELIVERY_ENABLED;
});
afterEach(() => { delete process.env.RESTAURANT_LOYALTY_DELIVERY_ENABLED; });

test.each([true, false, [], {}, '17junk', '1e2', Number.MAX_SAFE_INTEGER + 1])('strict numeric inputs reject %p', (value) => {
  expect(() => giftCards._normalize.normalizeAmount(value)).toThrow();
  expect(() => giftCards._valueNormalize.issueProductId(value)).toThrow();
  expect(() => loyalty._normalize.positiveInt(value, 'id', { allowZero: false })).toThrow();
  expect(() => marketplace._normalize.positiveId(value, 'id')).toThrow();
});
test.each([giftCards.listProducts, loyalty.listSegments, marketplace.listIntegrations])('route IDs reject partial values before access resolution', async (handler) => {
  expect((await invoke(handler, req({}, { restaurantId: '3junk' }))).error.statusCode).toBe(404);
  expect(scopeModel.resolveRestaurantAccess).not.toHaveBeenCalled();
});
test('catalog capabilities describe the available internal ledger', async () => {
  const { res, error } = await invoke(giftCards.listProducts);
  expect(error).toBeUndefined(); expect(res.json).toHaveBeenCalledWith({ products: [], valueIssuanceEnabled: true });
});
test('all CRM endpoints report the same default-off delivery capability', async () => {
  for (const handler of [loyalty.listSegments, loyalty.listCampaigns]) {
    const { res } = await invoke(handler); expect(res.json.mock.calls[0][0].campaignDeliveryEnabled).toBe(false);
  }
});
test.each(['listAreas', 'listSuppliers'])('inventory %s scopes joined statistics', async (name) => {
  locations.getLocationScope.mockResolvedValue({ mode: 'assigned', location_ids: [7] });
  expect((await invoke(inventory[name])).error).toBeUndefined();
  const [sql, params] = mockQuery.mock.calls.find(([sql]) => sql.includes(name === 'listAreas' ? 'COUNT(i.id)' : 'COUNT(DISTINCT i.id)'));
  expect(sql).toContain('i.location_id = ANY($2::bigint[])'); expect(params).toEqual([3, [7]]);
  if (name === 'listSuppliers') expect(sql).toContain('si.location_id = ANY($2::bigint[])');
});
test.each(['2026-02-30', '0000-01-01', '2026-13-01'])('cash tips reject invalid calendar date %s', async (date) => {
  const { error } = await invoke(payroll.declareCashTip, req({ staffUserId: 'staff', date, amountCents: 20 }));
  expect(error.code).toBe('validation_failed'); expect(mockQuery).not.toHaveBeenCalled();
});
test.each([payroll.updateLaborPolicy, payroll.updateTipPoolSettings, payroll.declareCashTip])('payroll view-only grants cannot mutate payroll', async (handler) => {
  permissions.getEffectivePermissions.mockResolvedValue({ permissions: new Set(['payroll.view']) });
  expect((await invoke(handler)).error.statusCode).toBe(403); expect(mockQuery).not.toHaveBeenCalled();
});
test('exception reports require audit.view even for a manager', async () => {
  scopeModel.resolveRestaurantAccess.mockResolvedValue({ ...restaurant, effective_role: 'manager' });
  permissions.getEffectivePermissions.mockResolvedValue({ permissions: new Set() });
  expect((await invoke(payroll.exceptionsReport)).error.statusCode).toBe(403);
});
test('custom roles can use explicitly granted payroll and audit views', async () => {
  for (const handler of [payroll.getLaborPolicy, payroll.teamActivity]) expect((await invoke(handler)).error).toBeUndefined();
});
test('activity events and actor lists share assigned-store and local-day boundaries', async () => {
  locations.getLocationScope.mockResolvedValue({ mode: 'assigned', location_ids: [7] });
  const request = req(); request.query = { from: '2026-03-08', to: '2026-03-08' };
  expect((await invoke(payroll.teamActivity, request)).error).toBeUndefined();
  const event = mockQuery.mock.calls.find(([sql]) => sql.includes('ORDER BY created_at DESC'));
  const actors = mockQuery.mock.calls.find(([sql]) => sql.includes('GROUP BY bal.actor_user_id'));
  expect(event[0]).toContain('AT TIME ZONE'); expect(event[1]).toContain('America/New_York');
  expect(event[1]).toContainEqual([7]); expect(actors[1]).toContainEqual([7]);
  expect(actors[0]).toContain('audit_location.restaurant_id = 3');
});
test('assigned staff cannot read brand-wide CRM or lifetime-point segments', async () => {
  locations.getLocationScope.mockResolvedValue({ mode: 'assigned', location_ids: [7] });
  mockQuery.mockResolvedValue({ rows: [{ id: 1, criteria: {} }, { id: 2, criteria: { location_id: 9 } }, { id: 3, criteria: { location_id: 7, min_lifetime_points: 10 } }] });
  const { res, error } = await invoke(loyalty.listSegments);
  expect(error).toBeUndefined(); expect(res.json.mock.calls[0][0].segments).toEqual([]);
  expect((await invoke(loyalty.createCampaign)).error.statusCode).toBe(403);
});

// Real transaction wrapper, with audit failure injected after a successful write.
test.each([
  ['gift catalog', giftCards.createProduct, { sku: 'GC-25', name: 'Card', amountCents: 2500, deliveryType: 'physical' }, 'restaurant_gift_card_products'],
  ['CRM segment', loyalty.createSegment, { name: 'Guests', criteria: {} }, 'restaurant_loyalty_segments'],
])('%s rolls back when auditing fails', async (_label, handler, body, table) => {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes(`INSERT INTO ${table}`)) return { rows: [{ id: 10, restaurant_id: 3, name: 'Guests', criteria: {} }] };
    if (sql.includes('INSERT INTO business_audit_log')) throw new Error('audit unavailable');
    return { rows: [], rowCount: 1 };
  });
  const { res, error } = await invoke(handler, req(body));
  expect(error.message).toBe('audit unavailable'); expect(res.json).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
  expect(mockQuery.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
});
test.each([
  ['issue', 'issueValue', 'issueGiftCard'], ['redeem', 'redeemValue', 'redeemGiftCard'], ['refund', 'refundValue', 'redeemGiftCard'],
])('gift-card %s ledger mutation rolls back on audit failure', async (_label, handler, method) => {
  jest.spyOn(giftService, method).mockResolvedValue({ card: { id: 1, code: 'PRIVATE' }, ledger: { id: 2, balance_before_cents: 100 }, replayed: false });
  mockQuery.mockImplementation(async (sql) => { if (sql.includes('INSERT INTO business_audit_log')) throw new Error('audit unavailable'); return { rows: [], rowCount: 1 }; });
  const { error } = await invoke(giftCards[handler], req({ productId: 2, amountCents: 10 }));
  expect(error.message).toBe('audit unavailable'); expect(mockQuery.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
});
test.each([
  ['createCampaign', 'createCampaign', { id: 1, status: 'draft' }, { segmentId: 2 }],
  ['approveCampaign', 'approveCampaign', { id: 1, status: 'approved' }, {}],
  ['queueCampaign', 'queueCampaign', { campaign: { id: 1, status: 'queued' }, queuedRecipients: 2 }, {}],
])('CRM %s audits inside its transaction', async (handler, method, result, body) => {
  jest.spyOn(campaignService, method).mockResolvedValue(result);
  mockQuery.mockImplementation(async (sql) => { if (sql.includes('INSERT INTO business_audit_log')) throw new Error('audit unavailable'); return { rows: [], rowCount: 1 }; });
  expect((await invoke(loyalty[handler], req(body, { campaignId: '1' }))).error.message).toBe('audit unavailable');
  expect(mockQuery.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
});
test('marketplace transition locks its before-state and rolls back on audit failure', async () => {
  jest.spyOn(marketplaceService, 'transitionOrder').mockResolvedValue({ id: 1, status: 'accepted' });
  mockQuery.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT id, status')) return { rows: [{ id: 1, status: 'received' }] };
    if (sql.includes('INSERT INTO business_audit_log')) throw new Error('audit unavailable');
    return { rows: [], rowCount: 1 };
  });
  expect((await invoke(marketplace.transitionOrder, req({ status: 'accepted' }, { orderId: '1' }))).error.message).toBe('audit unavailable');
  const sql = mockQuery.mock.calls.map(([sql]) => sql); expect(sql.find((sql) => sql.startsWith('SELECT id, status'))).toContain('FOR UPDATE');
  expect(sql.indexOf('BEGIN')).toBeLessThan(sql.findIndex((sql) => sql.startsWith('SELECT id, status'))); expect(sql).toContain('ROLLBACK');
});
test('campaign dispatch stays off without explicit activation', async () => {
  expect(await campaignService.deliverBatch()).toMatchObject({ disabled: true, claimed: 0 }); expect(mockQuery).not.toHaveBeenCalled();
});
test.each([1, 5])('provider-declared failure at attempt %i respects the retry bound', async (attempts) => {
  process.env.RESTAURANT_LOYALTY_DELIVERY_ENABLED = 'true';
  notifications.sendNotification.mockResolvedValue({ success: false, error: 'temporary' });
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('WITH claim AS')) return { rows: [{ id: 10, campaign_id: 1, customer_id: 'customer', channel: 'email', attempts }] };
    if (sql.startsWith('SELECT * FROM restaurant_loyalty_campaigns')) return { rows: [{ id: 1, subject: 'Hello', body: 'Offer' }] };
    return { rows: [], rowCount: 1 };
  });
  expect(await campaignService.deliverBatch()).toMatchObject({ claimed: 1, sent: 0 });
  const save = mockQuery.mock.calls.find(([sql]) => sql.includes('SET status = $2'));
  expect(save[1][1]).toBe(attempts < 5 ? 'pending' : 'failed'); expect(save[0]).toContain("INTERVAL '15 minutes'");
  expect(save[0]).toContain('lease_token = $5');
  const claim = mockQuery.mock.calls.find(([sql]) => sql.includes('WITH claim AS'))[0];
  expect(claim).toContain('d.lease_expires_at < NOW()'); expect(claim).toContain('d.attempts < 5');
});
test.each(['en', 'es', 'fr', 'ht', 'ar'])('host-stand SMS supports %s with a safe unknown-locale fallback', (locale) => {
  const text = hostingMessage('waitlist', locale, { restaurant: 'Ox', wait: 20 }); expect(text).toContain('Ox'); expect(text).toContain('20');
  expect(hostingMessage('reservation', locale, { restaurant: 'Ox', confirmed: true, startsAt: '2026-10-21T18:00:00Z' })).toContain('Ox');
  expect(hostingMessage('waitlist', 'unknown', { restaurant: 'Ox' })).toContain('Your table');
});
test.each([
  ['upsertIntegration', 'upsertIntegration', { id: 1, provider: 'uber_eats', status: 'disabled' }],
  ['ingestOrder', 'ingestOrder', { order: { id: 1, status: 'received' }, replayed: false }],
])('marketplace %s rolls back if its audit cannot be persisted', async (handler, method, result) => {
  jest.spyOn(marketplaceService, method).mockResolvedValue(result);
  mockQuery.mockImplementation(async (sql) => { if (sql.includes('INSERT INTO business_audit_log')) throw new Error('audit unavailable'); if (sql.includes('SELECT id FROM restaurant_locations')) return { rows: [{ id: 7 }] }; return { rows: [], rowCount: 1 }; });
  expect((await invoke(marketplace[handler], req({ provider: 'uber_eats', locationId: 7 }))).error.message).toBe('audit unavailable');
  expect(mockQuery.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
});
