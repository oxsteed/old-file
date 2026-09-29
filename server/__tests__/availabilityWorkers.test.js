'use strict';

/**
 * Focused tests for server/workers/availabilityWorkers.js.
 * Uses the shared pg mock from ./setup (no real database).
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { clearStaleAvailableNow, AVAILABLE_NOW_TTL_MS } = require('../workers/availabilityWorkers');

describe('clearStaleAvailableNow', () => {
  beforeEach(() => resetMocks());

  test('clears flags older than the TTL and reports the count', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 3, rows: [] });
    const result = await clearStaleAvailableNow({ limit: 500 });
    expect(result).toEqual({ cleared: 3 });

    const [sql, params] = mockQuery.mock.calls[0];
    // Only touches rows whose flag is stale (older than TTL or never stamped).
    expect(sql).toMatch(/is_available_now_updated_at < NOW\(\) - make_interval/);
    expect(sql).toMatch(/is_available_now_updated_at IS NULL/);
    expect(params[0]).toBe(Math.floor(AVAILABLE_NOW_TTL_MS / 1000)); // 12h in seconds
    expect(params[1]).toBe(500);
    // Never touches rows whose flag is off.
    expect(sql).toMatch(/is_available_now = TRUE/);
  });

  test('is a no-op when nothing is stale', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const result = await clearStaleAvailableNow();
    expect(result).toEqual({ cleared: 0 });
  });

  test('TTL is 12 hours', () => {
    expect(AVAILABLE_NOW_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });
});
