'use strict';
const { mockQuery, resetMocks } = require('./setup');
const { collect } = require('../services/attention/adapters/setupVerification');
const controller = require('../controllers/businessController');

const business = { id: 7, user_id: 'owner', role: 'owner', business_name: 'Repair shop', business_kind: 'service',
  business_type: 'Handyman', industry_category: 'home_services', address_city: 'Springfield', description: 'Repairs',
  service_count: 1, setup_status: 'active', is_active: true, is_listed: true };
function context(row = business, progress = null) {
  return { pool: { query: jest.fn().mockResolvedValueOnce({ rows: row ? [row] : [] }).mockResolvedValueOnce({ rows: progress ? [progress] : [] }) },
    tableExists: jest.fn().mockResolvedValue(true), now: new Date() };
}
beforeEach(resetMocks);

test.each([null, { current_step: 'complete', completed_steps: ['kind', 'category', 'identity', 'publish'] },
  { current_step: 'identity', completed_steps: [] }])('live, ready business has no setup alert despite stale progress: %j', async progress => {
  expect((await collect(business, context(business, progress))).items).toEqual([]);
});
test('saved complete marker cannot conceal an actually incomplete business', async () => {
  const result = await collect(business, context({ ...business, service_count: 0 }, { current_step: 'complete', completed_steps: ['complete'] }));
  expect(result.items[0].reasonParams.currentStep).toBe('service');
  expect(result.items[0].taskDestination).toMatchObject({ type: 'component', component: 'BusinessOnboarding', route: '/business/7/onboarding' });
});
test('ready draft still needs the owner to publish', async () => {
  const result = await collect(business, context({ ...business, setup_status: 'in_progress' }));
  expect(result.items[0].reasonParams.currentStep).toBe('publish');
});
test('missing readiness is a source failure, never a reassuring zero', async () => {
  await expect(collect(business, context(null))).rejects.toThrow('readiness unavailable');
});
test.each(['employee', 'representative', 'support_agent'])('setup tasks respect profile permissions for %s', async role => {
  const ctx = context();
  expect((await collect({ ...business, role }, ctx)).items).toEqual([]);
  expect(ctx.pool.query).not.toHaveBeenCalled();
});
test.each(['owner', 'manager'])('onboarding read exposes the existing publish permission for %s', async role => {
  const userId = role === 'owner' ? 'owner' : 'manager';
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, owner_id: 'owner' }] })
    .mockResolvedValueOnce({ rows: [business] }).mockResolvedValueOnce({ rows: [] });
  const res = { json: jest.fn() }; const next = jest.fn();
  await controller.getBusinessOnboarding({ user: { id: userId }, params: { id: '7' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.json.mock.calls[0][0].permissions).toEqual({ canEdit: true, canPublish: role === 'owner' });
});
test('unrelated users cannot read business setup', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const next = jest.fn(); const res = { json: jest.fn() };
  await controller.getBusinessOnboarding({ user: { id: 'stranger' }, params: { id: '7' } }, res, next);
  expect(res.json).not.toHaveBeenCalled(); expect(next.mock.calls[0][0].statusCode).toBe(404);
});
test('manager cannot publish even by directly calling the API', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, owner_id: 'owner' }] });
  const next = jest.fn();
  await controller.completeBusinessOnboarding({ user: { id: 'manager' }, params: { id: '7' } }, {}, next);
  expect(next.mock.calls[0][0].statusCode).toBe(403);
  expect(mockQuery).toHaveBeenCalledTimes(1);
});
test('owner cannot publish when actual requirements are missing', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, owner_id: 'owner' }] })
    .mockResolvedValueOnce({ rows: [{ ...business, service_count: 0 }] });
  const next = jest.fn();
  await controller.completeBusinessOnboarding({ user: { id: 'owner' }, params: { id: '7' } }, {}, next);
  expect(next.mock.calls[0][0].code).toBe('business_setup_incomplete');
  expect(mockQuery).toHaveBeenCalledTimes(2);
});
