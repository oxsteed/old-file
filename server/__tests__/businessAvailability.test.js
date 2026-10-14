'use strict';
const { mockQuery, resetMocks } = require('./setup');
const { isStaffBlocked, staffBlockedWindows } = require('../services/businessAvailability');

beforeEach(() => resetMocks());

describe('shared staff availability predicate (P2-3-F08)', () => {
  test('returns the overlapping blocks for a staff member', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'b1' }] });
    const rows = await staffBlockedWindows('staff-1', '2026-11-01T14:00:00Z', '2026-11-01T15:00:00Z');
    expect(rows).toEqual([{ id: 'b1' }]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM availability_blocks/);
    expect(sql).toMatch(/type IN \('unavailable', 'busy'\)/);
    expect(params).toEqual(['staff-1', '2026-11-01T14:00:00Z', '2026-11-01T15:00:00Z']);
  });

  test('isStaffBlocked is true when a block overlaps', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'b1' }] });
    await expect(isStaffBlocked('staff-1', 's', 'e')).resolves.toBe(true);
  });

  test('isStaffBlocked is false when nothing overlaps', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(isStaffBlocked('staff-1', 's', 'e')).resolves.toBe(false);
  });

  test('no query without a staff id', async () => {
    await expect(isStaffBlocked(null, 's', 'e')).resolves.toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
