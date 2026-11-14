'use strict';

// Money flows W4 (retention half): the sweep never re-checks the
// lease fence mid-run. The job passes fence.db into sweep(), so every
// query asserts — but the per-person try/catch swallows the
// LeaseLostError as one failed person and the sweep returns normally
// with the loss recorded as a per-person error. The job therefore
// never reports { fenced: true }, the remaining persons are never
// processed, and no incident is recorded.
//
// Repro-first: a fake db throws LeaseLostError for every query after
// the part-2 due select. Before the fix sweep() returns normally
// with the loss in result.errors; after the fix it rejects with
// LeaseLostError (which withFencedJobLock converts to { fenced: true })
// and no erasure row is inserted.

const { sweep } = require('../jobs/restaurantRetentionJob');
const { LeaseLostError } = require('../jobs/jobLockingService');

function makeFencedDb() {
  const queries = [];
  let armed = false;
  const db = {
    queries,
    query: jest.fn(async (sql) => {
      const text = String(sql);
      queries.push(text);
      // Check the staff select first: its NOT EXISTS subquery also
      // mentions restaurant_erasure_requests, so the request check
      // below would swallow it.
      if (text.includes('FROM staff_offboarding_records o')) {
        armed = true;
        return {
          rows: [{ business_id: 1, user_id: 'w4-staff', retain_until: '2020-01-01' }],
        };
      }
      if (text.includes('FROM restaurant_erasure_requests er')) {
        return { rows: [] };
      }
      if (armed) throw new LeaseLostError('restaurant-retention-sweep');
      return { rows: [], rowCount: 0 };
    }),
  };
  return db;
}

describe('Money flows W4: retention sweep aborts on lease loss', () => {
  test('a lease lost during the auto-anonymize pass rejects instead of returning errors', async () => {
    const db = makeFencedDb();
    await expect(sweep(db)).rejects.toThrow('lease lost');
    // Nothing was written after the loss: no completed erasure row.
    const inserts = db.queries.filter((sql) =>
      sql.includes('INSERT INTO restaurant_erasure_requests'));
    expect(inserts).toHaveLength(0);
  });
});
