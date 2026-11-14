'use strict';

/**
 * Domain 7 #30 — direct-calendar catch-up loop has no total cap.
 *
 * completeFinishedDirectVisits looped `for (;;)` in 200-row batches,
 * breaking only on a short batch, while the starter held one fenced lock
 * across the whole run. After an outage a single 5-minute tick consumed
 * the entire backlog. The fix caps total visits per tick at 1,000 and
 * lets the next tick continue.
 *
 * Repro: a 1,200-visit backlog. Before the fix one call completes all
 * 1,200; after the fix it completes at most 1,000 and stops.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../services/franchiseRoyaltyService', () => ({
  accrueTerritoryRoyalty: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../db');
const {
  completeFinishedDirectVisits,
  COMPLETED_VISITS_BATCH_LIMIT,
  COMPLETED_VISITS_TOTAL_LIMIT,
} = require('../jobs/directCalendarReminders');

function installBacklogMock(totalVisits) {
  let remaining = totalVisits;
  let nextId = 1;
  let batchCalls = 0;
  db.query.mockImplementation(async (sql, params) => {
    const text = String(sql);
    if (text.includes('UPDATE quote_requests')) {
      batchCalls++;
      const n = Math.min(COMPLETED_VISITS_BATCH_LIMIT, remaining);
      remaining -= n;
      return {
        rows: Array.from({ length: n }, () => ({ quote_request_id: nextId++ })),
      };
    }
    if (text.includes('id = ANY')) {
      return {
        rows: (params?.[0] || []).map((id) => ({
          id,
          quote_amount_cents: 5000,
          service_city: 'Springfield',
        })),
      };
    }
    return { rows: [] };
  });
  return { batchCalls: () => batchCalls, remaining: () => remaining };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('a 1,200-visit backlog completes at most 1,000 visits in one tick', async () => {
  expect(COMPLETED_VISITS_TOTAL_LIMIT).toBe(1000);
  const backlog = installBacklogMock(1200);

  const total = await completeFinishedDirectVisits();

  expect(total).toBe(1000);
  expect(backlog.batchCalls()).toBe(5);
  expect(backlog.remaining()).toBe(200);
});

test('a backlog under the cap still completes fully in one tick', async () => {
  const backlog = installBacklogMock(250);

  const total = await completeFinishedDirectVisits();

  expect(total).toBe(250);
  expect(backlog.batchCalls()).toBe(2);
  expect(backlog.remaining()).toBe(0);
});
