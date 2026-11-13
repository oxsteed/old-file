'use strict';

// Money flows W4 (punch-closeout half): closeStalePunches runs on
// the fence's handle, so a lease lost mid-sweep makes the per-entry
// fenced transaction throw LeaseLostError — but the per-entry
// try/catch swallows it as one failed entry and the sweep keeps
// walking the batch, then returns normally with the loss recorded
// as an entry error. The job therefore never reports { fenced: true }.
//
// Repro-first: a fake fence whose fencedTransaction throws
// LeaseLostError. Before the fix closeStalePunches returns normally
// with errors:[...]; after the fix it rejects with LeaseLostError.
// A second test covers the missing-punch check the same way: a
// lease lost there must abort the sweep, not land in errors.

const { closeStalePunches } = require('../services/restaurantPunchCloseout');
const { LeaseLostError } = require('../jobs/jobLockingService');

function staleEntry(now) {
  const clockIn = new Date(now.getTime() - 13 * 3600 * 1000);
  return {
    id: 11,
    business_id: 7,
    user_id: 'w4-employee',
    clock_in_at: clockIn.toISOString(),
    entry_date: clockIn.toISOString().slice(0, 10),
    location_id: null,
    containing_close_at: null,
    fallback_close_at: null,
    employee_name: 'W4 Employee',
    business_name: 'W4 Business',
  };
}

function makeFence({ openRows, missingThrows = false }) {
  return {
    assertActive: jest.fn(),
    db: {
      query: jest.fn(async (sql) => {
        const text = String(sql);
        // Match on the SELECT list, not the FROM: both selects
        // mention the other table inside subqueries (the open
        // select's shift subqueries, the missing select's
        // NOT EXISTS on time entries).
        if (text.includes('SELECT te.*,')) {
          return { rows: openRows };
        }
        if (text.includes('SELECT sh.*,')) {
          if (missingThrows) throw new LeaseLostError('restaurant-punch-closeout');
          return { rows: [] };
        }
        return { rows: [] };
      }),
    },
    fencedTransaction: jest.fn(async () => {
      throw new LeaseLostError('restaurant-punch-closeout');
    }),
  };
}

const unusedDb = {
  query: jest.fn(async () => { throw new Error('raw pool must not be used when a fence is present'); }),
  connect: jest.fn(async () => { throw new Error('raw pool must not be used when a fence is present'); }),
};

describe('Money flows W4: punch closeout aborts on lease loss', () => {
  test('a lease lost closing an entry rejects instead of returning errors', async () => {
    const now = new Date();
    const fence = makeFence({ openRows: [staleEntry(now)] });
    await expect(
      closeStalePunches({ db: unusedDb, fence, now, notify: false })
    ).rejects.toThrow('lease lost');
    expect(fence.fencedTransaction).toHaveBeenCalledTimes(1);
  });

  test('a lease lost during the missing-punch check rejects instead of returning errors', async () => {
    const now = new Date();
    const fence = makeFence({ openRows: [], missingThrows: true });
    await expect(
      closeStalePunches({ db: unusedDb, fence, now, notify: false })
    ).rejects.toThrow('lease lost');
  });
});
