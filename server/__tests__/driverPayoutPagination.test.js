'use strict';

// Admin-ops audit item 7: the ops driver-payout list must page through the
// full filtered list instead of silently capping at 200 newest-first rows.
// Covers limit/offset forwarding, the 200 cap, the COUNT(*) total, and the
// status filter applying to both the page query and the count query.
//
// G9-B1 (item 492, D-524): the driver-facing list pages the same way
// (default 100, cap 200) with a COUNT(*) total, and returns server-side
// lifetime totals over the full set so the earnings header stops
// understating once a driver passes 100 payouts. The admission gate is
// mocked: these tests pin the pagination/totals SQL, not admission.

jest.mock('../services/deliveryDriverAdmission', () => ({
  isAdmittedDriver: jest.fn(async () => true),
  hasApprovedActiveDriverProfile: jest.fn(async () => true),
  canDriveMarketplace: jest.fn(async () => true),
}));

const { mockQuery, resetMocks } = require('./setup');
const { listAllDriverPayouts, listDriverPayouts } = require('../controllers/localDeliveryController');

function mockRes() {
  const res = {};
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const next = jest.fn();

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

async function call(query) {
  const res = mockRes();
  await listAllDriverPayouts({ query }, res, next);
  expect(next).not.toHaveBeenCalled();
  return res.json.mock.calls[0][0];
}

test('defaults to limit 200 offset 0 and returns the count total', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] })
    .mockResolvedValueOnce({ rows: [{ total: 250 }] });
  const body = await call({});
  expect(body.payouts).toHaveLength(2);
  expect(body.total).toBe(250);
  expect(body.limit).toBe(200);
  expect(body.offset).toBe(0);
  expect(mockQuery.mock.calls[0][0]).toMatch(/LIMIT \$1 OFFSET \$2/);
  expect(mockQuery.mock.calls[0][1]).toEqual([200, 0]);
  expect(mockQuery.mock.calls[1][0]).toMatch(/COUNT\(\*\)/);
});

test('forwards limit and offset for later pages', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 3 }] })
    .mockResolvedValueOnce({ rows: [{ total: 120 }] });
  const body = await call({ limit: '50', offset: '50' });
  expect(body.limit).toBe(50);
  expect(body.offset).toBe(50);
  expect(mockQuery.mock.calls[0][1]).toEqual([50, 50]);
  expect(mockQuery.mock.calls[1][1]).toEqual([]);
});

test('caps limit at 200 and clamps negative offset to 0', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ total: 0 }] });
  const body = await call({ limit: '9999', offset: '-5' });
  expect(body.limit).toBe(200);
  expect(body.offset).toBe(0);
});

test('applies the status filter to both the page and the count query', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 9 }] })
    .mockResolvedValueOnce({ rows: [{ total: 7 }] });
  const body = await call({ status: 'accrued', limit: '50', offset: '0' });
  expect(body.total).toBe(7);
  expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE p\.status = \$1/);
  expect(mockQuery.mock.calls[0][1]).toEqual(['accrued', 50, 0]);
  expect(mockQuery.mock.calls[1][0]).toMatch(/WHERE p\.status = \$1/);
  expect(mockQuery.mock.calls[1][1]).toEqual(['accrued']);
});

// G9-B1 (item 492): the driver list pages with a count total and
// server-side lifetime totals. Query order: page, COUNT(*), totals,
// then the adjustments lookup (default empty rows).

async function callDriver(query) {
  const res = mockRes();
  await listDriverPayouts({ query, user: { id: 'driver-1', role: 'helper', default_mode: 'helper' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  return res.json.mock.calls[0][0];
}

test('driver list defaults to limit 100 offset 0 and returns the count total plus server totals', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 1, payout_cents: 1800, status: 'accrued' }] })
    .mockResolvedValueOnce({ rows: [{ total: 250 }] })
    .mockResolvedValueOnce({ rows: [{ paid_cents: 9000, pending_cents: 1800 }] });
  const body = await callDriver({});
  expect(body.payouts).toHaveLength(1);
  expect(body.total).toBe(250);
  expect(body.limit).toBe(100);
  expect(body.offset).toBe(0);
  expect(body.totals).toEqual({ paidCents: 9000, pendingCents: 1800 });
  expect(mockQuery.mock.calls[0][0]).toMatch(/LIMIT \$2 OFFSET \$3/);
  expect(mockQuery.mock.calls[0][1]).toEqual(['driver-1', 100, 0]);
  expect(mockQuery.mock.calls[1][0]).toMatch(/COUNT\(\*\)/);
  expect(mockQuery.mock.calls[1][1]).toEqual(['driver-1']);
  expect(mockQuery.mock.calls[2][0]).toMatch(/FILTER \(WHERE status = 'paid'\)/);
  expect(mockQuery.mock.calls[2][0]).toMatch(/FILTER \(WHERE status IN \('accrued', 'approved'\)\)/);
  expect(mockQuery.mock.calls[2][1]).toEqual(['driver-1']);
});

test('driver list forwards limit and offset for later pages', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 3, payout_cents: 1800, status: 'paid' }] })
    .mockResolvedValueOnce({ rows: [{ total: 120 }] })
    .mockResolvedValueOnce({ rows: [{ paid_cents: 1800, pending_cents: 0 }] });
  const body = await callDriver({ limit: '50', offset: '50' });
  expect(body.limit).toBe(50);
  expect(body.offset).toBe(50);
  expect(body.total).toBe(120);
  expect(mockQuery.mock.calls[0][1]).toEqual(['driver-1', 50, 50]);
  expect(mockQuery.mock.calls[1][1]).toEqual(['driver-1']);
});

test('driver list caps limit at 200 and clamps negative offset to 0', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ total: 0 }] })
    .mockResolvedValueOnce({ rows: [{ paid_cents: 0, pending_cents: 0 }] });
  const body = await callDriver({ limit: '9999', offset: '-5' });
  expect(body.limit).toBe(200);
  expect(body.offset).toBe(0);
});

test('driver list applies the status filter to page and count but not to the lifetime totals', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 9, payout_cents: 1800, status: 'paid' }] })
    .mockResolvedValueOnce({ rows: [{ total: 7 }] })
    .mockResolvedValueOnce({ rows: [{ paid_cents: 12600, pending_cents: 3600 }] });
  const body = await callDriver({ status: 'paid', limit: '50', offset: '0' });
  expect(body.total).toBe(7);
  expect(body.totals).toEqual({ paidCents: 12600, pendingCents: 3600 });
  expect(mockQuery.mock.calls[0][0]).toMatch(/AND p\.status = \$2/);
  expect(mockQuery.mock.calls[0][1]).toEqual(['driver-1', 'paid', 50, 0]);
  expect(mockQuery.mock.calls[1][0]).toMatch(/WHERE p\.driver_user_id = \$1 AND p\.status = \$2/);
  expect(mockQuery.mock.calls[1][1]).toEqual(['driver-1', 'paid']);
  // The totals query reads the driver's full set with no status
  // filter: the header is the lifetime summary, not the filter.
  expect(mockQuery.mock.calls[2][1]).toEqual(['driver-1']);
});
