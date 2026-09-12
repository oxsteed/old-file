'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { acquireJobLock, refreshJobLock, withJobLock } = require('../jobs/jobLockingService');

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
