'use strict';

// Group 5 design-review fix, finding 32: one configurable workweek
// start per jurisdiction (Sunday by default), used by pay, the shift
// validator, the forecast, copy-week, and the punch-time minor check.
// The forecast and copy-week halves live in scheduleForecast.test.js
// and scheduleCopyWeek.test.js; this file covers the validator and
// the pay range widening.

jest.mock('../db', () => ({ query: jest.fn() }));

const db = require('../db');
const { validateShift } = require('../services/shiftConflictValidation');
const payroll = require('../services/restaurantPayrollService');

const STAFF = '00000000-0000-4000-8000-0000000000aa';

function fakeValidationDb(jurisdictionRows) {
  // Existing shifts: Sun 2026-11-01 + Mon-Thu 2026-11-02..05, 8h each.
  const otherShifts = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']
    .map((date, i) => ({ id: 10 + i, shift_date: date, start_time: '09:00:00', end_time: '17:00:00' }));
  return {
    query: jest.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('FROM business_staff_shifts')) return { rows: otherShifts };
      if (s.includes('FROM business_time_off_requests')) return { rows: [] };
      if (s.includes('FROM business_staff_availability')) return { rows: [] };
      if (s.includes('FROM business_staff_labor_profiles')) {
        return { rows: [{ minor_band: 'age_16_17', minor_until: '2027-06-01' }] };
      }
      if (s.includes('FROM restaurant_labor_jurisdictions')) return { rows: jurisdictionRows };
      return { rows: [] };
    }),
  };
}

describe('Finding 32: the validator measures minor weekly hours inside the jurisdiction workweek', () => {
  // The candidate is Fri 2026-11-06, 8h. The minor's weekly cap is
  // 40h. Under the Sunday default the Sunday shift belongs to the
  // same week (40h already worked + 8h = 48h): a violation. Under a
  // Monday-start jurisdiction the Sunday shift belongs to the previous
  // week (32h + 8h = 40h): no violation.
  const candidate = {
    businessId: 2, userId: STAFF, shiftDate: '2026-11-06',
    startTime: '09:00', endTime: '17:00',
  };

  test('Sunday default: the Sunday shift counts toward the same week', async () => {
    const result = await validateShift(fakeValidationDb([]), candidate);
    const weekly = result.violations.find((v) => v.code === 'minor_weekly_hours');
    expect(weekly).toBeDefined();
    expect(weekly.params.weekStart).toBe('2026-11-01');
    expect(weekly.params.hours).toBe('48.0');
  });

  test('a Monday-start jurisdiction puts the Sunday shift in the previous week', async () => {
    const mondayRow = [{ jurisdiction_code: 'US-FED', workweek_start_day: 1, minor_max_weekly_hours: 40 }];
    const result = await validateShift(fakeValidationDb(mondayRow), { ...candidate, restaurantId: 7, locationId: 11 });
    expect(result.violations.map((v) => v.code)).not.toContain('minor_weekly_hours');
  });
});

describe('Finding 32: pay fetches whole workweeks for the locations in scope', () => {
  beforeEach(() => { db.query.mockReset(); });

  test('a Monday-start jurisdiction widens the range to Monday-Sunday weeks', async () => {
    db.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('FROM restaurant_location_labor_policies')) return { rows: [] };
      if (s.includes('FROM restaurant_labor_jurisdictions')) {
        return { rows: [{ restaurant_id: 7, location_id: 11, jurisdiction_code: 'US-FED', workweek_start_day: 1 }] };
      }
      if (s.includes('FROM restaurant_locations')) return { rows: [] };
      if (s.includes('FROM food_restaurants')) return { rows: [{ timezone: 'UTC' }] };
      if (s.includes('FROM business_time_entries')) return { rows: [] };
      return { rows: [] };
    });
    await payroll.getPolicyHoursByUser(2, '2026-11-03', '2026-11-06', {
      overtime_threshold_hours: 40, overtime_multiplier_bps: 15000,
      break_after_minutes: 360, break_duration_minutes: 30,
    }, [11], await payroll.getLocationPayContext(7, [11]));
    const entriesCall = db.query.mock.calls.find(([sql]) => String(sql).includes('FROM business_time_entries'));
    expect(entriesCall).toBeDefined();
    // Tue Nov 3 sits in the Monday week starting Nov 2; Fri Nov 6 in
    // the same week, ending Sun Nov 8.
    expect(entriesCall[1][1]).toBe('2026-11-02');
    expect(entriesCall[1][2]).toBe('2026-11-08');
  });

  test('the Sunday default widens to Sunday-Saturday weeks', async () => {
    db.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('FROM restaurant_location_labor_policies')) return { rows: [] };
      if (s.includes('FROM restaurant_labor_jurisdictions')) return { rows: [] };
      if (s.includes('FROM restaurant_locations')) return { rows: [] };
      if (s.includes('FROM food_restaurants')) return { rows: [{ timezone: 'UTC' }] };
      if (s.includes('FROM business_time_entries')) return { rows: [] };
      return { rows: [] };
    });
    await payroll.getPolicyHoursByUser(2, '2026-11-03', '2026-11-06', {
      overtime_threshold_hours: 40, overtime_multiplier_bps: 15000,
      break_after_minutes: 360, break_duration_minutes: 30,
    }, [11], await payroll.getLocationPayContext(7, [11]));
    const entriesCall = db.query.mock.calls.find(([sql]) => String(sql).includes('FROM business_time_entries'));
    expect(entriesCall).toBeDefined();
    expect(entriesCall[1][1]).toBe('2026-11-01');
    expect(entriesCall[1][2]).toBe('2026-11-07');
  });
});
