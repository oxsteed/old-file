'use strict';

/**
 * E03 — Worker lease-loss fencing.
 *
 * Failing reproduction: today `withJobLock` renews its lease in the
 * background and only *logs* when the lease is lost. The handler keeps
 * running and keeps writing, so a stale worker can corrupt state after
 * another worker took over the job.
 *
 * The contract we need:
 *   1. `withFencedJobLock(jobName, handler)` hands the handler a `fence`.
 *   2. `fence.db.query(...)` refuses (throws LeaseLostError) once the lease
 *      is lost, so no further writes go out from the stale worker.
 *   3. `fence.fencedTransaction(work)` re-verifies the lease *inside* the
 *      write transaction and rolls back when the lease is gone (no TOCTOU).
 *   4. `withJobLock` keeps its old signature (backward compatible) and now
 *      detects lease loss for every job via the shared fenced core.
 */

const { mockQuery, resetMocks } = require('./setup');
const {
  LeaseLostError,
  withFencedJobLock,
  withJobLock,
  acquireJobLock,
} = require('../jobs/jobLockingService');

const LEASE_VERIFY_SQL = 'SELECT 1 FROM cron_job_locks';

function lockSqlResponder({ acquired = true, refreshOk = true, leaseHeld = true } = {}) {
  return async (sql) => {
    if (sql.includes('INSERT INTO cron_job_locks')) {
      return acquired ? { rows: [{ lock_id: 'job_lock:test-job' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes('UPDATE cron_job_locks')) {
      return refreshOk ? { rows: [{ lock_id: 'job_lock:test-job' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes(LEASE_VERIFY_SQL)) {
      return leaseHeld ? { rows: [{ '1': 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes('DELETE FROM cron_job_locks')) return { rows: [], rowCount: 0 };
    return { rows: [{ ok: 1 }], rowCount: 1 };
  };
}

beforeEach(() => {
  resetMocks();
});

describe('E03 lease-loss fencing', () => {
  test('fence.db.query refuses writes after the lease is lost', async () => {
    mockQuery.mockImplementation(lockSqlResponder({}));
    let fence;
    await withFencedJobLock('test-job', async (f) => {
      fence = f;
      await f.db.query('INSERT INTO t (a) VALUES ($1)', [1]); // healthy write works
    }, 300);

    // Simulate the renewal loop observing a lost lease.
    fence._onLeaseLost();

    expect(fence.isActive()).toBe(false);
    await expect(fence.db.query('INSERT INTO t (a) VALUES ($1)', [2]))
      .rejects.toThrow(LeaseLostError);
    expect(() => fence.assertActive()).toThrow(LeaseLostError);

    // The refused write must never reach the database.
    const writeCalls = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO t'));
    expect(writeCalls).toHaveLength(1);
  });

  test('fencedTransaction rolls back when the lease is gone mid-write', async () => {
    // Lease is held at acquire time, but gone when the transaction verifies.
    let verifyCalls = 0;
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO cron_job_locks')) return { rows: [{ lock_id: 'x' }], rowCount: 1 };
      if (sql.includes(LEASE_VERIFY_SQL)) {
        verifyCalls += 1;
        return { rows: [], rowCount: 0 }; // lease lost
      }
      if (sql.includes('DELETE FROM cron_job_locks')) return { rows: [], rowCount: 0 };
      return { rows: [{ ok: 1 }], rowCount: 1 };
    });

    const work = jest.fn();
    let caught = null;
    await withFencedJobLock('test-job', async (fence) => {
      try {
        await fence.fencedTransaction(work);
      } catch (err) {
        caught = err;
      }
    }, 300);

    expect(caught).toBeInstanceOf(LeaseLostError);
    expect(work).not.toHaveBeenCalled();
    expect(verifyCalls).toBeGreaterThan(0);
    const statements = mockQuery.mock.calls.map(([sql]) => sql);
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });

  test('fencedTransaction commits when the lease is held', async () => {
    mockQuery.mockImplementation(lockSqlResponder({ leaseHeld: true }));
    const work = jest.fn(async () => {});
    await withFencedJobLock('test-job', async (fence) => {
      await fence.fencedTransaction(work);
    }, 300);
    expect(work).toHaveBeenCalledTimes(1);
    const statements = mockQuery.mock.calls.map(([sql]) => sql);
    expect(statements).toContain('BEGIN');
    expect(statements).toContain('COMMIT');
  });

  test('a fenced handler aborting with LeaseLostError is reported, not crashed', async () => {
    mockQuery.mockImplementation(lockSqlResponder({}));
    const result = await withFencedJobLock('test-job', async (fence) => {
      fence._onLeaseLost();
      fence.assertActive(); // eslint-disable-line no-unused-expressions
    }, 300);
    expect(result && result.fenced).toBe(true);
  });

  test('withJobLock keeps its old signature and still runs the handler', async () => {
    mockQuery.mockImplementation(lockSqlResponder({}));
    const handler = jest.fn(async () => 'done');
    await withJobLock('legacy-job', handler, 300);
    expect(handler).toHaveBeenCalledTimes(1);
    // Lock released afterwards.
    const deletes = mockQuery.mock.calls.filter(([sql]) => sql.includes('DELETE FROM cron_job_locks'));
    expect(deletes.length).toBeGreaterThan(0);
  });

  test('acquireJobLock refuses a second holder while the lease is live', async () => {
    mockQuery.mockImplementation(lockSqlResponder({ acquired: false }));
    const lockValue = await acquireJobLock('busy-job', 300);
    expect(lockValue).toBeNull();
  });
});
