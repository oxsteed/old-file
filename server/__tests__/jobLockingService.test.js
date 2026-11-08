'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { acquireJobLock, refreshJobLock, refreshJobLockState, withJobLock } = require('../jobs/jobLockingService');

beforeEach(() => resetMocks());

test('reclaims an expired distributed job lease atomically', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ lock_id: 'job_lock:oxsteed-credit-hold-expiry' }] });

  const lockValue = await acquireJobLock('oxsteed-credit-hold-expiry', 120);

  expect(lockValue).toEqual(expect.stringContaining(`${process.pid}`));
  expect(mockQuery.mock.calls[0][0]).toMatch(/ON CONFLICT \(lock_id\) DO UPDATE/);
  expect(mockQuery.mock.calls[0][0]).toMatch(/cron_job_locks\.expires_at <= NOW\(\)/);
});

test('runs a scheduled handler only while its lock is held and releases the lease', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ lock_id: 'job_lock:test-job' }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });
  const handler = jest.fn().mockResolvedValue(undefined);

  await withJobLock('test-job', handler, 60);

  expect(handler).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[1][0]).toMatch(/DELETE FROM cron_job_locks/);
});

test('renews only the lease owned by the current worker', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ lock_id: 'job_lock:test-job' }] });

  const refreshed = await refreshJobLock('test-job', 'host-123-456-789', 120);

  expect(refreshed).toBe(true);
  expect(mockQuery.mock.calls[0][0]).toContain('lock_value = $2');
  expect(mockQuery.mock.calls[0][0]).toContain('expires_at > NOW()');
  expect(mockQuery.mock.calls[0][1]).toEqual(['job_lock:test-job', 'host-123-456-789', 120]);
});

test('skips the handler when another non-expired lease is active', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const handler = jest.fn();

  await withJobLock('test-job', handler, 60);

  expect(handler).not.toHaveBeenCalled();
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('can surface lock-store failures to critical workers', async () => {
  mockQuery.mockRejectedValueOnce(new Error('database unavailable'));

  await expect(withJobLock('credit-job', jest.fn(), 60, { throwOnLockError: true }))
    .rejects.toThrow('database unavailable');
});

test('releases the lease and surfaces handler failures to the worker caller', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ lock_id: 'job_lock:test-job' }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });
  const handler = jest.fn().mockRejectedValue(new Error('database unavailable'));

  await expect(withJobLock('test-job', handler, 60)).rejects.toThrow('database unavailable');

  expect(mockQuery.mock.calls[1][0]).toMatch(/DELETE FROM cron_job_locks/);
});

describe('Oct 30 item 6: a renewal error is not lease loss', () => {
  test('refreshJobLockState distinguishes refreshed, expired, and error', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ lock_id: 'job_lock:test-job' }] });
    await expect(refreshJobLockState('test-job', 'v', 120)).resolves.toBe('refreshed');
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(refreshJobLockState('test-job', 'v', 120)).resolves.toBe('expired');
    mockQuery.mockRejectedValueOnce(new Error('db blip'));
    await expect(refreshJobLockState('test-job', 'v', 120)).resolves.toBe('error');
    // The boolean wrapper keeps its old contract: only 'refreshed' is true.
    mockQuery.mockRejectedValueOnce(new Error('db blip'));
    await expect(refreshJobLock('test-job', 'v', 120)).resolves.toBe(false);
  });

  test('a renewal error keeps the lease and does not fence; a later expiry does', async () => {
    jest.useFakeTimers();
    try {
      let renewals = 0;
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes('INSERT INTO cron_job_locks')) return { rows: [{ lock_id: 'job_lock:test-job' }] };
        if (sql.includes('UPDATE cron_job_locks')) {
          renewals += 1;
          if (renewals === 1) throw new Error('transient db blip');
          return { rows: [] }; // second renewal: the lease is genuinely gone
        }
        if (sql.includes('DELETE FROM cron_job_locks')) return { rows: [] };
        return { rows: [] };
      });
      let fenceRef = null;
      let resolveHandler;
      const handlerDone = new Promise((resolve) => { resolveHandler = resolve; });
      const handler = jest.fn((fence) => {
        fenceRef = fence;
        return handlerDone;
      });
      // TTL 3s: the renewal loop ticks every 1000ms.
      const run = withJobLock('test-job', handler, 3);
      await jest.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledTimes(1);
      const deletes = () => mockQuery.mock.calls.filter(([sql]) =>
        String(sql).includes('DELETE FROM cron_job_locks'));

      // First renewal tick: the DB throws. The lease is kept, the fence
      // stays active, and no lock row is deleted.
      await jest.advanceTimersByTimeAsync(1000);
      expect(fenceRef.isActive()).toBe(true);
      expect(deletes()).toHaveLength(0);

      // Second renewal tick: the lease is genuinely expired. Now it
      // fences and the stale row is released.
      await jest.advanceTimersByTimeAsync(1000);
      expect(fenceRef.isActive()).toBe(false);
      expect(deletes().length).toBeGreaterThanOrEqual(1);

      resolveHandler({ done: true });
      await expect(run).resolves.toEqual({ done: true });
    } finally {
      jest.useRealTimers();
    }
  });
});
