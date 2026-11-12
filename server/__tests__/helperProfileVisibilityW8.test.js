'use strict';
const { mockQuery, resetMocks } = require('./setup');
const router = require('../routes/helpers');
const bookingController = require('../controllers/bookingController');

beforeEach(() => resetMocks());

describe('helper slugs resolve on every /:id route (P1-202)', () => {
  const param = router.params.id[0];
  test('a slug becomes the helper user id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: '11111111-1111-4111-8111-111111111111' }] });
    const req = { params: { id: 'mike-plumber' } };
    const next = jest.fn();
    await param(req, {}, next, 'mike-plumber');
    expect(req.params.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(next).toHaveBeenCalledWith();
  });
  test('an unknown slug is a 404, a UUID passes untouched', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = { status: jest.fn(() => res), json: jest.fn() };
    await param({ params: { id: 'nope' } }, res, jest.fn(), 'nope');
    expect(res.status).toHaveBeenCalledWith(404);
    const next = jest.fn();
    await param({ params: {} }, {}, next, '11111111-1111-4111-8111-111111111111');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalled();
  });
});

describe('allow_booking is enforced (P1-204)', () => {
  test('booking a helper who switched booking off is refused', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/allow_booking/.test(sql)) return { rows: [{ id: 'h1', role: 'helper', is_active: true, deleted_at: null, is_hidden_by_admin: false, allow_booking: false }] };
      return { rows: [] };
    });
    const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await bookingController.createBookingRequest({
      user: { id: 'c1' },
      body: { helperId: 'h1', serviceName: 'Fix sink', requestedDate: date, requestedStartTime: '10:00', requestedEndTime: '11:00', availabilityMode: 'request_only' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(JSON.stringify(res.json.mock.calls)).toMatch(/BOOKING_DISABLED/);
  });

  test('direct booking rejects an active customer account as a helper', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM users/.test(sql)) {
        return { rows: [{ id: 'customer-target', role: 'customer', is_active: true, deleted_at: null, is_hidden_by_admin: false, allow_booking: true }] };
      }
      return { rows: [] };
    });
    const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await bookingController.createBookingRequest({
      user: { id: 'c1' },
      body: { helperId: 'customer-target', serviceName: 'Fix sink', requestedDate: date, requestedStartTime: '10:00', requestedEndTime: '11:00', availabilityMode: 'request_only' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(JSON.stringify(res.json.mock.calls)).toMatch(/INVALID_HELPER/);
  });

  test('direct booking does not resolve a soft-deleted helper', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM users/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await bookingController.createBookingRequest({
      user: { id: 'c1' },
      body: { helperId: 'deleted-helper', serviceName: 'Fix sink', requestedDate: date, requestedStartTime: '10:00', requestedEndTime: '11:00', availabilityMode: 'request_only' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(JSON.stringify(res.json.mock.calls)).toMatch(/HELPER_NOT_FOUND/);
  });
});

describe('directory and profile visibility SQL (P1-203, P1-205, P1-206)', () => {
  const src = require('fs').readFileSync(require.resolve('../controllers/helpersController'), 'utf8');
  test('directory lists all helper roles and skips admin-hidden businesses', () => {
    expect(src).toMatch(/u\.role = ANY\(\$1::user_role\[\]\)/);
    expect(src).toMatch(/\['helper', 'helper_pro', 'broker'\]/);
    expect(src).toMatch(/u\.onboarding_completed = TRUE/);
    expect(src).toMatch(/COALESCE\(b\.is_hidden_by_admin, FALSE\) = FALSE/);
  });
  test('hidden helper sections are withheld by the API', () => {
    expect(src).toMatch(/services: \(adminPreview \|\| h\.show_services\) \? services : \[\]/);
    expect(src).toMatch(/faqs:\s+\(adminPreview \|\| h\.show_faqs\) \? faqs : \[\]/);
  });
  test('dynamic public helper endpoints share the owner lifecycle gate', () => {
    expect((src.match(/u\.is_active = TRUE/g) || []).length).toBeGreaterThanOrEqual(6);
    expect((src.match(/u\.onboarding_completed = TRUE/g) || []).length).toBeGreaterThanOrEqual(7);
    const availabilitySrc = require('fs').readFileSync(require.resolve('../controllers/helperAvailabilityController'), 'utf8');
    expect(availabilitySrc).toMatch(/u\.is_active = TRUE/);
    expect(availabilitySrc).toMatch(/u\.email_verified = TRUE/);
    expect(availabilitySrc).toMatch(/u\.onboarding_completed = TRUE/);
    expect(availabilitySrc).toMatch(/hp\.is_listed IS TRUE/);
  });
});

describe('recurring booking account lifecycle guards', () => {
  const src = require('fs').readFileSync(require.resolve('../controllers/bookingController'), 'utf8');

  test('does not list subscriptions for soft-deleted helpers', () => {
    expect(src).toMatch(/JOIN users u ON u\.id = r\.helper_id AND u\.deleted_at IS NULL/);
  });

  test('does not create subscriptions for soft-deleted helpers', () => {
    expect(src).toMatch(/SELECT id, is_active, (?:deleted_at, )?role FROM users WHERE id = \$1 AND deleted_at IS NULL/);
  });
});
