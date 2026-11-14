'use strict';

// Domain 8 #29: restaurant_daily_rollups rows are written with a
// 15-minute TTL but nothing ever deletes them, so every distinct date
// range queried leaves a permanent row. A nightly prune with a 1-hour
// grace period (in-flight reads stay safe) bounds the table.

const { pruneExpiredRollups } = require('../services/restaurantRollupCache');

test('prune deletes only rows expired beyond the 1-hour grace period, bounded per run', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rowCount: 3 }) };
  const result = await pruneExpiredRollups(db, { limit: 1000 });
  expect(result).toEqual({ pruned: 3 });
  expect(db.query).toHaveBeenCalledTimes(1);
  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toMatch(/DELETE FROM restaurant_daily_rollups/);
  expect(sql).toMatch(/expires_at < NOW\(\) - INTERVAL '1 hour'/);
  expect(sql).toMatch(/LIMIT \$1/);
  expect(params).toEqual([1000]);
});

test('prune defaults to a bounded run when no limit is given', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
  const result = await pruneExpiredRollups(db);
  expect(result).toEqual({ pruned: 0 });
  expect(db.query.mock.calls[0][1]).toEqual([1000]);
});

test('the nightly scheduler runs the prune once a day, fenced and bounded', () => {
  const { SCHEDULED_WORKERS } = require('../workers/scheduledWorkerSchedule');
  const entry = SCHEDULED_WORKERS.find(([name]) => name === 'pruneExpiredRollups');
  expect(entry).toBeDefined();
  const [, workerFn, intervalMs, options] = entry;
  expect(typeof workerFn).toBe('function');
  expect(intervalMs).toBe(24 * 60 * 60 * 1000);
  expect(options).toMatchObject({ limit: 1000 });
});
