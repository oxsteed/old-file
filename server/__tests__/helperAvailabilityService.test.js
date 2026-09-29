// server/__tests__/helperAvailabilityService.test.js
//
// Unit tests for the pure availability computation (no DB).

const {
  toMinutes,
  formatTime,
  mergeRanges,
  subtractRanges,
  blockRangesPerDate,
  computeDay,
  buildSummary,
} = require('../services/helperAvailabilityService');

describe('toMinutes', () => {
  test('parses HH:MM', () => {
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('17:00')).toBe(1020);
  });
  test('parses HH:MM:SS (postgres TIME)', () => {
    expect(toMinutes('09:30:00')).toBe(570);
  });
  test('passes numbers through', () => {
    expect(toMinutes(90)).toBe(90);
  });
  test('returns null for junk', () => {
    expect(toMinutes('nope')).toBeNull();
    expect(toMinutes(null)).toBeNull();
  });
});

describe('formatTime', () => {
  test('formats 12h clock', () => {
    expect(formatTime(540)).toBe('9:00 AM');
    expect(formatTime(1020)).toBe('5:00 PM');
    expect(formatTime(720)).toBe('12:00 PM');
    expect(formatTime(0)).toBe('12:00 AM');
  });
});

describe('mergeRanges', () => {
  test('merges overlapping ranges', () => {
    expect(mergeRanges([{ start: 0, end: 60 }, { start: 30, end: 90 }])).toEqual([
      { start: 0, end: 90 },
    ]);
  });
  test('keeps disjoint ranges', () => {
    expect(mergeRanges([{ start: 0, end: 60 }, { start: 120, end: 180 }])).toEqual([
      { start: 0, end: 60 },
      { start: 120, end: 180 },
    ]);
  });
  test('drops invalid ranges', () => {
    expect(mergeRanges([{ start: 60, end: 60 }, { start: 90, end: 30 }])).toEqual([]);
  });
});

describe('subtractRanges', () => {
  test('cuts a hole in the middle', () => {
    expect(subtractRanges([{ start: 0, end: 480 }], [{ start: 120, end: 180 }])).toEqual([
      { start: 0, end: 120 },
      { start: 180, end: 480 },
    ]);
  });
  test('full cover leaves nothing', () => {
    expect(subtractRanges([{ start: 60, end: 120 }], [{ start: 0, end: 1440 }])).toEqual([]);
  });
  test('no overlap keeps windows', () => {
    expect(subtractRanges([{ start: 0, end: 60 }], [{ start: 120, end: 180 }])).toEqual([
      { start: 0, end: 60 },
    ]);
  });
});

describe('blockRangesPerDate', () => {
  test('single-day block (local wall-clock)', () => {
    const out = blockRangesPerDate({
      start_time: '2026-10-05T09:00:00',
      end_time: '2026-10-05T12:00:00',
      type: 'unavailable',
    });
    expect(out['2026-10-05']).toEqual([{ start: 540, end: 720, type: 'unavailable', title: undefined }]);
  });
  test('multi-day block splits per date (local wall-clock)', () => {
    const out = blockRangesPerDate({
      start_time: '2026-10-05T22:00:00',
      end_time: '2026-10-06T02:00:00',
      type: 'busy',
    });
    expect(out['2026-10-05']).toEqual([{ start: 1320, end: 1440, type: 'busy', title: undefined }]);
    expect(out['2026-10-06']).toEqual([{ start: 0, end: 120, type: 'busy', title: undefined }]);
  });
});

describe('computeDay slot grid', () => {
  test('exposes template grid base and busy ranges for pickers', () => {
    const day = computeDay(
      '2026-10-05',
      [{ start: 540, end: 780 }], // template 9:00-13:00
      [{ start: 600, end: 660, type: 'unavailable' }], // 10:00-11:00 block
      [{ start: 720, end: 780 }], // 12:00-13:00 appointment (no buffer here)
      1,
      true
    );
    expect(day.slotGrid).toEqual([{ startMin: 540, endMin: 780 }]);
    expect(day.busy).toEqual([
      { startMin: 600, endMin: 660 },
      { startMin: 720, endMin: 780 },
    ]);
    // Free windows: 9-10 and 11-12
    expect(day.windows.map((w) => [w.startMin, w.endMin])).toEqual([[540, 600], [660, 720]]);
    expect(day.status).toBe('available');
  });
});

describe('computeDay', () => {
  const template = [{ start: 540, end: 1020 }]; // 9-5

  test('open day with no blocks → available', () => {
    const d = computeDay('2026-10-05', template, [], [], 0, true);
    expect(d.status).toBe('available');
    expect(d.windows).toHaveLength(1);
  });

  test('no template windows → closed', () => {
    const d = computeDay('2026-10-05', [], [], [], 0, true);
    expect(d.status).toBe('closed');
    expect(d.windows).toHaveLength(0);
  });

  test('no template configured → unset', () => {
    const d = computeDay('2026-10-05', [], [], [], 0, false);
    expect(d.status).toBe('unset');
  });

  test('full-day unavailable block → blocked', () => {
    const d = computeDay(
      '2026-10-05',
      template,
      [{ start: 0, end: 1440, type: 'unavailable' }],
      [],
      0,
      true
    );
    expect(d.status).toBe('blocked');
    expect(d.windows).toHaveLength(0);
  });

  test('partial block shrinks free windows', () => {
    const d = computeDay(
      '2026-10-05',
      template,
      [{ start: 540, end: 720, type: 'busy' }],
      [],
      0,
      true
    );
    expect(d.status).toBe('available');
    expect(d.windows).toEqual([
      { start: '12:00 PM', end: '5:00 PM', startMin: 720, endMin: 1020 },
    ]);
  });

  test('appointments covering everything → booked', () => {
    const d = computeDay('2026-10-05', template, [], [{ start: 540, end: 1020 }], 0, true);
    expect(d.status).toBe('booked');
  });

  test('available block adds a special opening on a closed day', () => {
    const d = computeDay(
      '2026-10-05',
      [],
      [{ start: 600, end: 840, type: 'available' }],
      [],
      0,
      true
    );
    expect(d.status).toBe('available');
    expect(d.windows).toHaveLength(1);
  });

  test('tiny free remainder → limited', () => {
    const d = computeDay(
      '2026-10-05',
      template,
      [{ start: 540, end: 960, type: 'unavailable' }],
      [],
      0,
      true
    );
    expect(d.status).toBe('limited');
    expect(d.freeMinutes).toBe(60);
  });
});

describe('buildSummary', () => {
  test('unset when no template', () => {
    expect(buildSummary([], false)).toEqual({ state: 'unset' });
  });
  test('none when nothing free in range', () => {
    const days = [
      { date: '2026-10-05', dayOfWeek: 1, status: 'closed', windows: [] },
      { date: '2026-10-06', dayOfWeek: 2, status: 'blocked', windows: [] },
    ];
    expect(buildSummary(days, true).state).toBe('none');
  });
});

describe('templateWindowsFromJson', () => {
  const { templateWindowsFromJson } = require('../services/helperAvailabilityService');
  test('parses weekly JSON into windows', () => {
    const out = templateWindowsFromJson({
      monday: { start: '09:00', end: '17:00' },
      tuesday: { closed: true },
      Wednesday: { open: '9:00 AM', close: '1:00 PM' },
    });
    expect(out).toEqual([
      { dayOfWeek: 1, startMin: 540, endMin: 1020 },
      { dayOfWeek: 3, startMin: 540, endMin: 780 },
    ]);
  });
  test('rejects garbage', () => {
    expect(templateWindowsFromJson(null)).toEqual([]);
    expect(templateWindowsFromJson({ monday: { start: 'nope', end: '17:00' } })).toEqual([]);
    expect(templateWindowsFromJson({ monday: { start: '17:00', end: '09:00' } })).toEqual([]);
  });
});
