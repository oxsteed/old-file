'use strict';

/**
 * Fleet fence delivery.
 *
 * runScheduledWorkerOnce used to call the fleet worker as
 * `() => workerFn(options)`, dropping the fence that withFencedJobLock
 * hands to its handler. No fleet worker could therefore route a write
 * through fence.db, so a stale fleet worker kept writing after lease loss.
 *
 * The contract: the worker receives the fence in its options
 * (`options.fence`), alongside its existing options, and a write through
 * fence.db.query after lease loss is refused with LeaseLostError; the run
 * reports { fenced: true } instead of crashing or committing.
 */

const { mockQuery } = require('./setup');
const { runScheduledWorkerOnce } = require('../workers/scheduledWorkerSchedule');

beforeEach(() => {
  mockQuery.mockReset();
});

describe('fleet fence delivery', () => {
  test('a fleet worker write routes through fence.db and is refused after lease loss', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('INSERT INTO cron_job_locks')) {
        return { rows: [{ lock_id: 'job_lock:scheduled-worker:fleet-demo' }] };
      }
      if (sql.includes('DELETE FROM cron_job_locks')) return { rows: [] };
      if (sql.includes('UPDATE cron_job_locks')) return { rows: [{ lock_id: 'x' }] };
      if (sql.includes('INSERT INTO fleet_probe')) return { rows: [{ id: 1 }] };
      return { rows: [] };
    });

    const seen = {};
    const workerFn = async (options) => {
      seen.options = options;
      await options.fence.db.query('INSERT INTO fleet_probe (note) VALUES ($1)', ['first']);
      // The renewal loop observes the lost lease mid-run.
      options.fence._onLeaseLost();
      await options.fence.db.query('INSERT INTO fleet_probe (note) VALUES ($1)', ['second']);
      return { ok: true };
    };

    const log = { info: jest.fn(), error: jest.fn() };
    const outcome = await runScheduledWorkerOnce(
      ['fleet-demo', workerFn, 60 * 1000, { limit: 5 }],
      { log },
    );

    expect(outcome).toEqual(expect.objectContaining({ fenced: true }));
    // Existing options survive alongside the delivered fence.
    expect(seen.options.limit).toBe(5);
    expect(seen.options.fence).toBeDefined();
    // Only the pre-loss write reached the database.
    const probes = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO fleet_probe'));
    expect(probes).toHaveLength(1);
    expect(probes[0][1]).toEqual(['first']);
  });
});
