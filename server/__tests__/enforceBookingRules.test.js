'use strict';

// Review P1-6-F03: the business appointment create path must enforce the
// service-level "allow online booking" switch and the business's own
// listing state (active / listed / not hidden).

const { mockQuery, resetMocks } = require('./setup');
const enforceBookingRules = require('../middleware/enforceBookingRules');

beforeEach(() => resetMocks());

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

function validReq() {
  const start = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    params: { businessId: '2' },
    body: {
      service_id: 9,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    },
  };
}

// Queries in order: service, business, booking rules, [staff], conflict count,
// blocked times. Defaults model a healthy, bookable service + business.
function baseDb({ service = {}, business = {} } = {}) {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM business_services/.test(sql)) {
      return {
        rows: [{
          id: 9,
          business_id: 2,
          duration_minutes: 60,
          max_capacity: 1,
          min_notice_hours: 0,
          is_active: true,
          allow_online_booking: true,
          deleted_at: null,
          ...service,
        }],
      };
    }
    if (/FROM businesses/.test(sql)) {
      return {
        rows: [{
          id: 2, is_active: true, is_listed: true, is_hidden_by_admin: false, ...business,
        }],
      };
    }
    if (/FROM business_booking_rules/.test(sql)) {
      return { rows: [{ min_advance_booking_hours: 0, max_advance_booking_days: 365 }] };
    }
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
    return { rows: [] };
  });
}

describe('enforceBookingRules booking gates (P1-6-F03)', () => {
  test('403s when the service disabled online booking', async () => {
    baseDb({ service: { allow_online_booking: false } });
    const req = validReq();
    const res = mockRes();
    const next = jest.fn();
    await enforceBookingRules(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('booking_disabled');
  });

  test('403s when the business is unlisted', async () => {
    baseDb({ business: { is_listed: false } });
    const req = validReq();
    const res = mockRes();
    const next = jest.fn();
    await enforceBookingRules(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('business_not_bookable');
  });

  test('403s when the business is hidden by admin', async () => {
    baseDb({ business: { is_hidden_by_admin: true } });
    const req = validReq();
    const res = mockRes();
    const next = jest.fn();
    await enforceBookingRules(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('business_not_bookable');
  });

  test('403s when the business is inactive', async () => {
    baseDb({ business: { is_active: false } });
    const req = validReq();
    const res = mockRes();
    const next = jest.fn();
    await enforceBookingRules(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('business_not_bookable');
  });

  test('passes a bookable service and business through', async () => {
    baseDb();
    const req = validReq();
    const res = mockRes();
    const next = jest.fn();
    await enforceBookingRules(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.bookingValidation).toMatchObject({ staffId: null });
  });
});
