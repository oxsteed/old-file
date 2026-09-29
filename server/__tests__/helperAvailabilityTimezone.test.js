// server/__tests__/helperAvailabilityTimezone.test.js
//
// Unit tests for timezone-anchored availability (no DB). The weekly template
// stores plain TIME values, so every interpretation of "9:00" must happen in
// the helper's IANA zone, not the server's.

const {
  resolveTimeZone,
  zonedParts,
  zonedDateStr,
  zonedNowMinutes,
  zonedLocalToUTC,
  zonedDayLengthMinutes,
  blockRangesPerDate,
  buildSummary,
} = require('../services/helperAvailabilityService');

describe('resolveTimeZone', () => {
  test('accepts valid IANA names', () => {
    expect(resolveTimeZone('America/New_York')).toBe('America/New_York');
    expect(resolveTimeZone('Pacific/Kiritimati')).toBe('Pacific/Kiritimati');
  });
  test('rejects junk, null, and non-strings', () => {
    expect(resolveTimeZone('Mars/Olympus')).toBeNull();
    expect(resolveTimeZone(null)).toBeNull();
    expect(resolveTimeZone('')).toBeNull();
    expect(resolveTimeZone(42)).toBeNull();
  });
});

describe('zonedDateStr', () => {
  test('shifts the date west of UTC (helper behind UTC)', () => {
    // 2026-09-29T02:00Z is still Sep 28 in New York (UTC-4).
    expect(zonedDateStr(new Date('2026-09-29T02:00:00Z'), 'America/New_York')).toBe('2026-09-28');
  });
  test('shifts the date east of UTC (helper ahead of UTC)', () => {
    // 2026-09-29T12:00Z is already Sep 30 in Kiritimati (UTC+14).
    expect(zonedDateStr(new Date('2026-09-29T12:00:00Z'), 'Pacific/Kiritimati')).toBe('2026-09-30');
  });
  test('null timezone falls back to server-local', () => {
    const d = new Date(2026, 8, 29, 15, 30); // local time, no zone shift
    expect(zonedDateStr(d, null)).toBe('2026-09-29');
  });
});

describe('zonedNowMinutes', () => {
  test('reports wall-clock minutes in the zone', () => {
    // 2026-09-29T14:30Z = 10:30 in New York (UTC-4).
    expect(zonedNowMinutes(new Date('2026-09-29T14:30:00Z'), 'America/New_York')).toBe(630);
  });
});

describe('zonedLocalToUTC', () => {
  test('converts wall time on a normal day', () => {
    // 9:00 AM in New York (EDT, UTC-4) = 13:00Z.
    expect(new Date(zonedLocalToUTC('2026-09-29', 540, 'America/New_York')).toISOString())
      .toBe('2026-09-29T13:00:00.000Z');
  });
  test('uses the offset in effect on a spring-forward day', () => {
    // 2026-03-08: clocks jump 2:00 -> 3:00 AM. 9:00 AM wall is EDT (UTC-4).
    expect(new Date(zonedLocalToUTC('2026-03-08', 540, 'America/New_York')).toISOString())
      .toBe('2026-03-08T13:00:00.000Z');
    // Day before is still EST (UTC-5).
    expect(new Date(zonedLocalToUTC('2026-03-07', 540, 'America/New_York')).toISOString())
      .toBe('2026-03-07T14:00:00.000Z');
  });
  test('uses the offset in effect on a fall-back day', () => {
    // 2026-11-01: clocks fall back 2:00 -> 1:00 AM. 9:00 AM wall is EST (UTC-5).
    expect(new Date(zonedLocalToUTC('2026-11-01', 540, 'America/New_York')).toISOString())
      .toBe('2026-11-01T14:00:00.000Z');
  });
  test('null timezone uses server-local', () => {
    const ms = zonedLocalToUTC('2026-09-29', 540, null);
    expect(new Date(ms)).toEqual(new Date(2026, 8, 29, 9, 0));
  });
});

describe('zonedDayLengthMinutes', () => {
  test('23h on spring-forward, 25h on fall-back, 24h otherwise', () => {
    expect(zonedDayLengthMinutes('2026-03-08', 'America/New_York')).toBe(1380);
    expect(zonedDayLengthMinutes('2026-11-01', 'America/New_York')).toBe(1500);
    expect(zonedDayLengthMinutes('2026-09-29', 'America/New_York')).toBe(1440);
  });
});

describe('blockRangesPerDate with timezone', () => {
  test('assigns the block to the helper-zoned date, not the UTC date', () => {
    // 2026-09-29T02:00-03:00Z is Sep 28, 22:00-23:00 in New York.
    const out = blockRangesPerDate(
      { start_time: '2026-09-29T02:00:00Z', end_time: '2026-09-29T03:00:00Z', type: 'unavailable' },
      'America/New_York'
    );
    expect(Object.keys(out)).toEqual(['2026-09-28']);
    expect(out['2026-09-28'][0].start).toBe(1320); // 22:00 wall
    expect(out['2026-09-28'][0].end).toBe(1380);   // 23:00 wall
  });
  test('aligns to wall-clock minutes on a spring-forward day', () => {
    // 13:00-14:00Z on 2026-03-08 is 9:00-10:00 AM wall (EDT). Elapsed-minutes
    // math would have said 8:00-9:00 and missed the template window.
    const out = blockRangesPerDate(
      { start_time: '2026-03-08T13:00:00Z', end_time: '2026-03-08T14:00:00Z', type: 'unavailable' },
      'America/New_York'
    );
    expect(out['2026-03-08'][0].start).toBe(540);
    expect(out['2026-03-08'][0].end).toBe(600);
  });
  test('a block ending exactly at zoned midnight belongs to that date', () => {
    // Ends 2026-09-30T04:00Z = midnight starting Sep 30 in New York.
    const out = blockRangesPerDate(
      { start_time: '2026-09-29T22:00:00Z', end_time: '2026-09-30T04:00:00Z', type: 'unavailable' },
      'America/New_York'
    );
    expect(out['2026-09-29'][0].end).toBe(1440);
    expect(out['2026-09-30']).toBeUndefined();
  });
});

describe('buildSummary with timezone', () => {
  const daysFor = (dateISO) => ([
    {
      date: dateISO,
      dayOfWeek: 2,
      status: 'available',
      windows: [{ startMin: 540, endMin: 1020, start: '9:00 AM', end: '5:00 PM' }],
    },
  ]);

  test('anchors "today" in the helper zone', () => {
    // At 2026-09-29T02:00Z it is still Sep 28 in New York: the Sep-29
    // windows are "opens-on", not "opens-today".
    jest.useFakeTimers({ now: Date.parse('2026-09-29T02:00:00Z') });
    try {
      const summary = buildSummary(daysFor('2026-09-29'), true, 'America/New_York');
      expect(summary.state).toBe('opens-on');
      expect(summary.date).toBe('2026-09-29');
    } finally {
      jest.useRealTimers();
    }
  });

  test('detects open-now in the helper zone', () => {
    // 2026-09-29T14:30Z = 10:30 AM New York, inside 9:00-17:00.
    jest.useFakeTimers({ now: Date.parse('2026-09-29T14:30:00Z') });
    try {
      const summary = buildSummary(daysFor('2026-09-29'), true, 'America/New_York');
      expect(summary.state).toBe('open-now');
    } finally {
      jest.useRealTimers();
    }
  });
});
