'use strict';

// Admin-ops audit item 7: the ops driver-payout list must page through the
// full filtered list instead of silently capping at 200 newest-first rows.
// Covers limit/offset forwarding, the 200 cap, the COUNT(*) total, and the
// status filter applying to both the page query and the count query.

const { mockQuery, resetMocks } = require('./setup');
const { listAllDriverPayouts } = require('../controllers/localDeliveryController');

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
