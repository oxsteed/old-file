/**
 * Tests for the access-gate rate limiter — focuses on pure logic + the
 * SQL contract the service expects.
 *
 * The pg pool is mocked by setup.js so we drive query responses directly.
 */

require('./setup');

const { Pool } = require('pg');
const mockQuery = Pool.mockQuery;
const mockConnect = Pool.mockConnect;
const mockRelease = Pool.mockRelease;

// Import after mocks are in place.
const rateLimit = require('../services/accessGateRateLimitService');

afterEach(() => {
  jest.clearAllMocks();
});

describe('accessGateRateLimitService.normalizeName / normalizeIp', () => {
  it('lowercases and trims names', () => {
    expect(rateLimit.normalizeName('  Emile  ')).toBe('emile');
    expect(rateLimit.normalizeName('EMILE')).toBe('emile');
    expect(rateLimit.normalizeName('')).toBe('');
    expect(rateLimit.normalizeName(null)).toBe('');
  });

  it('extracts the left-most XFF entry and strips IPv6 brackets', () => {
    expect(rateLimit.normalizeIp('1.2.3.4')).toBe('1.2.3.4');
    expect(rateLimit.normalizeIp('1.2.3.4, 5.6.7.8')).toBe('1.2.3.4');
    expect(rateLimit.normalizeIp('[::1]')).toBe('::1');
    expect(rateLimit.normalizeIp('')).toBe('unknown');
    expect(rateLimit.normalizeIp(undefined)).toBe('unknown');
  });
});

describe('accessGateRateLimitService.checkLockout', () => {
  it('returns not-locked when no row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await rateLimit.checkLockout({ ip: '1.2.3.4', claimedName: 'emile' });
    expect(result.locked).toBe(false);
    expect(result.attemptsLeft).toBe(rateLimit.MAX_FAILS);
    expect(result.lockoutId).toBeNull();
  });

  it('returns locked when an active lockout has not yet expired', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, fail_count: 3, locked_until: future, last_fail_at: new Date(), first_fail_at: new Date() }],
    });
    const result = await rateLimit.checkLockout({ ip: '1.2.3.4', claimedName: 'EMILE' });
    expect(result.locked).toBe(true);
    expect(result.lockedUntil).toEqual(future);
    expect(result.attemptsLeft).toBe(0);
    expect(result.lockoutId).toBe(7);
  });

  it('auto-lifts a lockout whose window has fully expired', async () => {
    const past = new Date(Date.now() - 60 * 1000);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 9, fail_count: 3, locked_until: past, last_fail_at: past, first_fail_at: past }],
      })
      .mockResolvedValueOnce({}); // the UPDATE that lifts it

    const result = await rateLimit.checkLockout({ ip: '1.2.3.4', claimedName: 'emile' });
    expect(result.locked).toBe(false);
    expect(result.attemptsLeft).toBe(rateLimit.MAX_FAILS);
    // The auto-lift UPDATE must have been issued.
    expect(mockQuery.mock.calls[1][0]).toMatch(/lift_source = 'auto_window_expired'/);
  });

  it('returns immediately for empty name without querying', async () => {
    const result = await rateLimit.checkLockout({ ip: '1.2.3.4', claimedName: '' });
    expect(result.locked).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('accessGateRateLimitService.recordFailure', () => {
  it('records an attempt and creates a lockout once threshold is hit', async () => {
    // Sequence of pool.query calls:
    //   1. INSERT INTO access_gate_attempts (logAttempt)
    //   2. SELECT COUNT(*) FROM access_gate_attempts (recentFailureCount)
    mockQuery
      .mockResolvedValueOnce({}) // logAttempt
      .mockResolvedValueOnce({ rows: [{ n: rateLimit.MAX_FAILS }] }); // recentFailureCount

    // Then the transaction inside recordFailure: BEGIN, SELECT FOR UPDATE,
    // INSERT lockouts (no existing row), COMMIT.
    mockConnect.mockResolvedValueOnce({
      query: jest
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT FOR UPDATE — no existing
        .mockResolvedValueOnce({}) // INSERT lockouts
        .mockResolvedValueOnce({}), // COMMIT
      release: mockRelease,
    });

    const result = await rateLimit.recordFailure({
      ip: '1.2.3.4',
      claimedName: 'emile',
      scope: 'admin_portal',
      errorCode: 'bad_key',
    });

    expect(result.lockedUntil).toBeInstanceOf(Date);
    expect(result.attemptsLeft).toBe(0);
    expect(result.justLocked).toBe(true);
  });

  it('does NOT lock until threshold is reached', async () => {
    mockQuery
      .mockResolvedValueOnce({}) // logAttempt
      .mockResolvedValueOnce({ rows: [{ n: rateLimit.MAX_FAILS - 1 }] }); // below threshold

    mockConnect.mockResolvedValueOnce({
      query: jest
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({}) // INSERT (no lock)
        .mockResolvedValueOnce({}), // COMMIT
      release: mockRelease,
    });

    const result = await rateLimit.recordFailure({
      ip: '1.2.3.4',
      claimedName: 'emile',
      scope: 'admin_portal',
      errorCode: 'bad_key',
    });

    expect(result.lockedUntil).toBeNull();
    expect(result.attemptsLeft).toBe(1);
    expect(result.justLocked).toBe(false);
  });
});

describe('accessGateRateLimitService.recordSuccess', () => {
  it('writes an audit row and lifts any active lockout', async () => {
    mockQuery
      .mockResolvedValueOnce({}) // logAttempt INSERT
      .mockResolvedValueOnce({}); // UPDATE access_gate_lockouts SET lifted_at = ...

    await rateLimit.recordSuccess({
      ip: '1.2.3.4',
      claimedName: 'emile',
      scope: 'admin_portal',
      matchedUserId: 42,
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO access_gate_attempts/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE access_gate_lockouts/);
  });

  it('skips the lift query when name is blank', async () => {
    mockQuery.mockResolvedValueOnce({}); // only the audit row
    await rateLimit.recordSuccess({ ip: '1.2.3.4', claimedName: '', scope: 'admin_portal' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('accessGateRateLimitService.liftLockout', () => {
  it('returns the row on a successful lift', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 11, ip: '1.2.3.4', normalizedName: 'emile', displayName: 'Emile' }],
    });
    const lifted = await rateLimit.liftLockout({ lockoutId: 11, byUserId: 1, reason: 'mistake' });
    expect(lifted).toEqual({ id: 11, ip: '1.2.3.4', normalizedName: 'emile', displayName: 'Emile' });
  });

  it('returns null when the row is missing or already lifted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const lifted = await rateLimit.liftLockout({ lockoutId: 99, byUserId: 1 });
    expect(lifted).toBeNull();
  });
});

describe('accessGateRateLimitService.listActiveLockouts', () => {
  it('returns mapped rows from the SELECT', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          ip: '1.2.3.4',
          normalizedName: 'emile',
          displayName: 'Emile',
          failCount: 3,
          firstFailAt: new Date(),
          lastFailAt: new Date(),
          lockedUntil: new Date(Date.now() + 3600_000),
          createdAt: new Date(),
        },
      ],
    });
    const items = await rateLimit.listActiveLockouts({ limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0].displayName).toBe('Emile');
  });

  it('clamps the limit to the configured ceiling', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await rateLimit.listActiveLockouts({ limit: 10_000 });
    expect(mockQuery.mock.calls[0][1][0]).toBeLessThanOrEqual(500);
  });
});
