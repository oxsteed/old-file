'use strict';

// F-11: daypart (availability_schedule) evaluation for menu items.
// Dates are pinned in America/New_York (EDT, UTC-4 in October 2026):
// 2026-10-19 is a Monday, 2026-10-23 a Friday, 2026-10-24 a Saturday.

const { isItemAvailableAt } = require('../utils/menuDayparts');

const TZ = 'America/New_York';
const breakfast = {
  availability_schedule: {
    weekly: {
      mon: { open: '07:00', close: '11:30' },
      tue: { open: '07:00', close: '11:30' },
      wed: { open: '07:00', close: '11:30' },
      thu: { open: '07:00', close: '11:30' },
      fri: { open: '07:00', close: '11:30' },
      sat: { closed: true },
      sun: { closed: true },
    },
  },
};

describe('menu dayparts (F-11)', () => {
  test('missing or empty schedule means always available', () => {
    const mondayNoon = new Date('2026-10-19T16:00:00Z');
    expect(isItemAvailableAt(null, mondayNoon, TZ)).toBe(true);
    expect(isItemAvailableAt({}, mondayNoon, TZ)).toBe(true);
    expect(isItemAvailableAt({ availability_schedule: {} }, mondayNoon, TZ)).toBe(true);
    expect(isItemAvailableAt({ availability_schedule: null }, mondayNoon, TZ)).toBe(true);
  });

  test('inside the window is available, outside is not', () => {
    // Monday 08:00 local (12:00Z) is inside 07:00-11:30.
    expect(isItemAvailableAt(breakfast, new Date('2026-10-19T12:00:00Z'), TZ)).toBe(true);
    // Monday 13:00 local (17:00Z) is after the window.
    expect(isItemAvailableAt(breakfast, new Date('2026-10-19T17:00:00Z'), TZ)).toBe(false);
    // Monday 06:30 local (10:30Z) is before the window.
    expect(isItemAvailableAt(breakfast, new Date('2026-10-19T10:30:00Z'), TZ)).toBe(false);
  });

  test('a closed day is unavailable even inside the usual window', () => {
    // Saturday 08:00 local (12:00Z).
    expect(isItemAvailableAt(breakfast, new Date('2026-10-24T12:00:00Z'), TZ)).toBe(false);
  });

  test('a day with no entry is not offered once a schedule exists', () => {
    const weekdaysOnly = {
      availability_schedule: { weekly: { mon: { open: '07:00', close: '11:30' } } },
    };
    // Tuesday 08:00 local has no entry.
    expect(isItemAvailableAt(weekdaysOnly, new Date('2026-10-20T12:00:00Z'), TZ)).toBe(false);
    expect(isItemAvailableAt(weekdaysOnly, new Date('2026-10-19T12:00:00Z'), TZ)).toBe(true);
  });

  test('bare day map (no weekly wrapper) is honored', () => {
    const bare = { availability_schedule: { mon: { open: '07:00', close: '11:30' } } };
    expect(isItemAvailableAt(bare, new Date('2026-10-19T12:00:00Z'), TZ)).toBe(true);
    expect(isItemAvailableAt(bare, new Date('2026-10-19T17:00:00Z'), TZ)).toBe(false);
  });

  test('split ranges cover both service periods only', () => {
    const split = {
      availability_schedule: {
        weekly: {
          mon: [
            { open: '11:00', close: '14:00' },
            { open: '17:00', close: '22:00' },
          ],
        },
      },
    };
    expect(isItemAvailableAt(split, new Date('2026-10-19T16:30:00Z'), TZ)).toBe(true); // 12:30 local
    expect(isItemAvailableAt(split, new Date('2026-10-19T19:00:00Z'), TZ)).toBe(false); // 15:00 local
    expect(isItemAvailableAt(split, new Date('2026-10-19T23:30:00Z'), TZ)).toBe(true); // 19:30 local
  });

  test('overnight range covers the evening and the next-morning spill', () => {
    const lateNight = {
      availability_schedule: { weekly: { fri: { open: '18:00', close: '02:00' } } },
    };
    // Friday 19:00 local (23:00Z).
    expect(isItemAvailableAt(lateNight, new Date('2026-10-23T23:00:00Z'), TZ)).toBe(true);
    // Saturday 01:30 local (05:30Z): Friday's range is still running.
    expect(isItemAvailableAt(lateNight, new Date('2026-10-24T05:30:00Z'), TZ)).toBe(true);
    // Saturday 08:00 local (12:00Z): the range ended at 02:00.
    expect(isItemAvailableAt(lateNight, new Date('2026-10-24T12:00:00Z'), TZ)).toBe(false);
    // Friday 01:30 local belongs to Thursday (no entry), not to Friday's own range.
    expect(isItemAvailableAt(lateNight, new Date('2026-10-23T05:30:00Z'), TZ)).toBe(false);
  });

  test('JSON string schedules are parsed', () => {
    const asString = {
      availability_schedule: JSON.stringify({ weekly: { mon: { open: '07:00', close: '11:30' } } }),
    };
    expect(isItemAvailableAt(asString, new Date('2026-10-19T12:00:00Z'), TZ)).toBe(true);
    expect(isItemAvailableAt(asString, new Date('2026-10-19T17:00:00Z'), TZ)).toBe(false);
  });
});
