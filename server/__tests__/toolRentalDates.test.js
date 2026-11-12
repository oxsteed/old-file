'use strict';

const { parseDateOnlyUTC } = require('../utils/dateOnly');

describe('tool rental date-only parsing', () => {
  test('accepts a real ISO calendar date', () => {
    expect(parseDateOnlyUTC('2026-02-28')?.toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  test.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', '2026-01-01T00:00:00Z'])(
    'rejects malformed or impossible date %s',
    (value) => expect(parseDateOnlyUTC(value)).toBeNull(),
  );
});
