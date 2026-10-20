'use strict';

const {
  evaluateOperatingHours,
  isValidIanaTimezone,
  normalizeBrandAccentHex,
} = require('../utils/foodOperatingHours');

// Weekday anchors (UTC): 2026-06-15 Mon, 06-16 Tue, 06-17 Wed, 06-19 Fri,
// 06-20 Sat, 2026-12-24 Thu, 12-25 Fri, 12-31 Thu, 2027-01-01 Fri.
describe('foodOperatingHours', () => {
  test('treats empty hours as always open', () => {
    const status = evaluateOperatingHours({}, 'UTC', new Date('2026-06-18T15:00:00.000Z'));
    expect(status.isOpen).toBe(true);
  });

  test('normalizes brand accent hex', () => {
    expect(normalizeBrandAccentHex('#ff8800')).toBe('#FF8800');
    expect(normalizeBrandAccentHex('bad')).toBeNull();
  });

  test('same-day range opens and closes on its own day', () => {
    const hours = { weekly: { tue: { open: '11:00', close: '22:00' } } };
    expect(evaluateOperatingHours(hours, 'UTC', new Date('2026-06-16T12:00:00Z')).isOpen).toBe(true);
    expect(evaluateOperatingHours(hours, 'UTC', new Date('2026-06-16T23:00:00Z')).isOpen).toBe(false);
  });

  test('F-01 reproduction: the stored timezone decides open/closed', () => {
    const hours = { weekly: { tue: { open: '11:00', close: '22:00' } } };
    const instant = new Date('2026-06-16T14:30:00Z'); // Tue 10:30 in New York
    expect(evaluateOperatingHours(hours, 'UTC', instant).isOpen).toBe(true);
    expect(evaluateOperatingHours(hours, 'America/New_York', instant).isOpen).toBe(false);
  });

  describe('F-10 overnight spill', () => {
    test('previous day range closing after midnight keeps the next morning open', () => {
      const hours = { weekly: { tue: { open: '18:00', close: '02:00' }, wed: { closed: true } } };
      const status = evaluateOperatingHours(hours, 'UTC', new Date('2026-06-17T01:00:00Z'));
      expect(status.isOpen).toBe(true);
      expect(status.closesAt).toBe('2:00 AM');
    });

    test('spill ends at the overnight close', () => {
      const hours = { weekly: { tue: { open: '18:00', close: '02:00' }, wed: { closed: true } } };
      expect(evaluateOperatingHours(hours, 'UTC', new Date('2026-06-17T03:00:00Z')).isOpen).toBe(false);
    });

    test('no spill when the previous day was closed', () => {
      const hours = { weekly: { mon: { open: '18:00', close: '02:00' }, sun: { closed: true } } };
      expect(evaluateOperatingHours(hours, 'UTC', new Date('2026-06-15T01:00:00Z')).isOpen).toBe(false);
    });

    test('overnight range is open on its own evening', () => {
      const hours = { weekly: { tue: { open: '18:00', close: '02:00' } } };
      expect(evaluateOperatingHours(hours, 'UTC', new Date('2026-06-16T19:00:00Z')).isOpen).toBe(true);
      const before = evaluateOperatingHours(hours, 'UTC', new Date('2026-06-16T17:00:00Z'));
      expect(before.isOpen).toBe(false);
      expect(before.opensAt).toBe('6:00 PM');
    });
  });

  describe('F-10 multiple ranges per day (split shifts)', () => {
    const hours = {
      weekly: {
        wed: [
          { open: '11:00', close: '14:00' },
          { open: '17:00', close: '22:00' },
        ],
      },
    };

    test('open during the lunch range and the dinner range', () => {
      expect(evaluateOperatingHours(hours, 'UTC', new Date('2026-06-17T12:00:00Z')).isOpen).toBe(true);
      expect(evaluateOperatingHours(hours, 'UTC', new Date('2026-06-17T18:00:00Z')).isOpen).toBe(true);
    });

    test('closed between ranges and points at the next range', () => {
      const status = evaluateOperatingHours(hours, 'UTC', new Date('2026-06-17T15:00:00Z'));
      expect(status.isOpen).toBe(false);
      expect(status.opensAt).toBe('5:00 PM');
    });

    test('an overnight second range spills into the next day', () => {
      const split = {
        weekly: {
          fri: [
            { open: '11:00', close: '14:00' },
            { open: '18:00', close: '02:00' },
          ],
          sat: { closed: true },
        },
      };
      expect(evaluateOperatingHours(split, 'UTC', new Date('2026-06-20T01:00:00Z')).isOpen).toBe(true);
    });

    test('legacy single-object shape keeps working', () => {
      const legacy = { tue: { open: '09:00', close: '17:00' } };
      expect(evaluateOperatingHours(legacy, 'UTC', new Date('2026-06-16T10:00:00Z')).isOpen).toBe(true);
      expect(evaluateOperatingHours(legacy, 'UTC', new Date('2026-06-16T18:00:00Z')).isOpen).toBe(false);
    });
  });

  describe('F-10 special-date overrides', () => {
    const hours = {
      weekly: {
        mon: { open: '09:00', close: '17:00' },
        tue: { open: '09:00', close: '17:00' },
        wed: { open: '09:00', close: '17:00' },
        thu: { open: '09:00', close: '17:00' },
        fri: { open: '09:00', close: '17:00' },
      },
      special_dates: {
        '2026-12-25': 'closed',
        '2026-12-24': { open: '09:00', close: '12:00' },
      },
    };

    test('a special date marked closed overrides the weekly schedule', () => {
      // Friday 2026-12-25 would normally be open at noon.
      expect(evaluateOperatingHours(hours, 'UTC', new Date('2026-12-25T12:00:00Z')).isOpen).toBe(false);
    });

    test('special-date hours replace the weekly hours for that date', () => {
      expect(evaluateOperatingHours(hours, 'UTC', new Date('2026-12-24T10:00:00Z')).isOpen).toBe(true);
      expect(evaluateOperatingHours(hours, 'UTC', new Date('2026-12-24T13:00:00Z')).isOpen).toBe(false);
    });

    test('an overnight special date spills into the next date', () => {
      const newYear = {
        weekly: {},
        special_dates: { '2026-12-31': { open: '18:00', close: '02:00' } },
      };
      expect(evaluateOperatingHours(newYear, 'UTC', new Date('2027-01-01T01:00:00Z')).isOpen).toBe(true);
      expect(evaluateOperatingHours(newYear, 'UTC', new Date('2026-12-31T12:00:00Z')).isOpen).toBe(false);
    });

    test('special_dates also work inside the bare weekly shape', () => {
      const bare = {
        fri: { open: '09:00', close: '17:00' },
        special_dates: { '2026-12-25': 'closed' },
      };
      expect(evaluateOperatingHours(bare, 'UTC', new Date('2026-12-25T12:00:00Z')).isOpen).toBe(false);
    });

    test('a malformed special-date entry does not close the restaurant', () => {
      const malformed = {
        weekly: { fri: { open: '09:00', close: '17:00' } },
        special_dates: { '2026-12-25': 42 },
      };
      expect(evaluateOperatingHours(malformed, 'UTC', new Date('2026-12-25T12:00:00Z')).isOpen).toBe(true);
    });
  });

  describe('F-10 invalid timezone safety', () => {
    test('isValidIanaTimezone accepts real zones and rejects labels', () => {
      expect(isValidIanaTimezone('America/New_York')).toBe(true);
      expect(isValidIanaTimezone('UTC')).toBe(true);
      expect(isValidIanaTimezone('Eastern')).toBe(false);
      expect(isValidIanaTimezone('')).toBe(false);
      expect(isValidIanaTimezone(null)).toBe(false);
      expect(isValidIanaTimezone(undefined)).toBe(false);
    });

    test('evaluation falls back to UTC instead of throwing RangeError', () => {
      const hours = { weekly: { tue: { open: '11:00', close: '22:00' } } };
      let status;
      expect(() => {
        status = evaluateOperatingHours(hours, 'Eastern', new Date('2026-06-16T12:00:00Z'));
      }).not.toThrow();
      expect(status.isOpen).toBe(true); // noon UTC inside 11:00-22:00
    });

    test('midnight evaluates without a 24:00 wrap', () => {
      const hours = { weekly: { tue: { open: '00:00', close: '06:00' } } };
      expect(evaluateOperatingHours(hours, 'UTC', new Date('2026-06-16T00:30:00Z')).isOpen).toBe(true);
    });
  });
});
