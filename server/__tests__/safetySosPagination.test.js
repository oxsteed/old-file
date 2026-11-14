'use strict';

/**
 * Domain 7 #29 — admin SOS list truncates at 100 with no total or pager.
 *
 * listSOS used to run a bare `LIMIT 100` and return `{ events }` only, so
 * on an ops queue the oldest (most overdue) events past 100 were hidden
 * with no way to reach them. The fix mirrors the money-approval queues:
 * bounded limit/offset params plus a COUNT(*) total.
 *
 * Repro: a list call with limit/offset. Before the fix the response has
 * no total and the query has no OFFSET; after the fix it returns
 * { events, total, limit, offset } and pages.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const { listSOS } = require('../controllers/safetyController');

function resMock() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

beforeEach(() => {
  resetMocks();
});

test('SOS list returns a total and honours limit/offset', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: '5' }] })
    .mockResolvedValueOnce({ rows: [{ id: 3 }, { id: 4 }] });
  const req = { query: { limit: '2', offset: '2' } };
  const res = resMock();

  await listSOS(req, res, jest.fn());

  expect(res.json).toHaveBeenCalledWith({
    events: [{ id: 3 }, { id: 4 }],
    total: 5,
    limit: 2,
    offset: 2,
  });
  const pageCall = mockQuery.mock.calls.find(([sql]) => sql.includes('FROM safety_sos_events s'));
  expect(pageCall[0]).toMatch(/LIMIT \$1 OFFSET \$2/);
  expect(pageCall[1]).toEqual([2, 2]);
});

test('SOS list defaults to limit 100 offset 0 and still reports the total', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: '250' }] })
    .mockResolvedValueOnce({ rows: [{ id: 1 }] });
  const req = { query: {} };
  const res = resMock();

  await listSOS(req, res, jest.fn());

  expect(res.json).toHaveBeenCalledWith({
    events: [{ id: 1 }],
    total: 250,
    limit: 100,
    offset: 0,
  });
});

test('SOS list clamps an oversized limit to the 500 max', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: '0' }] })
    .mockResolvedValueOnce({ rows: [] });
  const req = { query: { limit: '9999' } };
  const res = resMock();

  await listSOS(req, res, jest.fn());

  expect(res.json).toHaveBeenCalledWith({ events: [], total: 0, limit: 500, offset: 0 });
});
