'use strict';

// Phase 4 Track B (goal goal_a0fc7c0f0394): scheduled-cost forecast.
// Projected cost math against hand-computed fixtures, and the
// projected-overtime flag. Read-only: the service runs one SELECT and
// never writes.

const { computeScheduleForecast } = require('../services/scheduleForecast');

function fakeDb(shifts) {
  return {
    query: jest.fn(async (sql) => {
      if (String(sql).includes('FROM business_staff_shifts')) return { rows: shifts };
      return { rows: [] };
    }),
  };
}

// 2026-11-02 is a Monday. Person A works Mon-Fri 09:00-17:00 (8h x 5)
// plus Saturday 09:00-14:00 (5h): 45h in the week at $20.00/h.
// Person B works two 8h shifts with no wage on record.
// Person C works one overnight shift 22:00-06:00 (8h) at $30.00/h.
function fixtureShifts() {
  const shifts = [];
  const add = (userId, name, date, start, end, wage) => shifts.push({
    id: shifts.length + 1, user_id: userId, user_name: name,
    shift_date: date, start_time: start, end_time: end,
    role_label: 'Server', hourly_wage_cents: wage,
  });
  for (let day = 2; day <= 6; day += 1) {
    add('user-a', 'Ana', `2026-11-0${day}`, '09:00:00', '17:00:00', 2000);
  }
  add('user-a', 'Ana', '2026-11-07', '09:00:00', '14:00:00', 2000);
  add('user-b', 'Ben', '2026-11-03', '09:00:00', '17:00:00', null);
  add('user-b', 'Ben', '2026-11-04', '09:00:00', '17:00:00', null);
  add('user-c', 'Cy', '2026-11-05', '22:00:00', '06:00:00', 3000);
  return shifts;
}

describe('computeScheduleForecast', () => {
  test('projects cost from draft shifts with weekly overtime at 1.5x', async () => {
    const db = fakeDb(fixtureShifts());
    const forecast = await computeScheduleForecast(db, {
      businessId: 2, from: '2026-11-02', to: '2026-11-08',
      overtimeThresholdHours: 40, overtimeMultiplierBps: 15000,
    });
    // Hand-computed: Ana 45h = 40 regular + 5 OT:
    //   40 x 2000 + 5 x 2000 x 1.5 = 80000 + 15000 = 95000.
    // Cy 8h overnight at 3000 = 24000. Ben has no wage: hours count,
    // cost stays null. Total hours 45 + 16 + 8 = 69.
    expect(forecast.draft_shift_count).toBe(9);
    expect(forecast.total_hours).toBe(69);
    expect(forecast.total_regular_hours).toBe(64);
    expect(forecast.total_overtime_hours).toBe(5);
    expect(forecast.total_doubletime_hours).toBe(0);
    expect(forecast.total_meal_break_premium_hours).toBe(0);
    expect(forecast.total_cost_cents).toBe(95000 + 24000);
    expect(forecast.missing_wage_user_ids).toEqual(['user-b']);

    const ana = forecast.per_person.find((p) => p.user_id === 'user-a');
    expect(ana.hours).toBe(45);
    expect(ana.regular_hours).toBe(40);
    expect(ana.overtime_hours).toBe(5);
    expect(ana.cost_cents).toBe(95000);
    expect(ana.projected_overtime).toBe(true);

    const ben = forecast.per_person.find((p) => p.user_id === 'user-b');
    expect(ben.hours).toBe(16);
    expect(ben.overtime_hours).toBe(0);
    expect(ben.cost_cents).toBeNull();
    expect(ben.projected_overtime).toBe(false);

    const cy = forecast.per_person.find((p) => p.user_id === 'user-c');
    expect(cy.hours).toBe(8);
    expect(cy.cost_cents).toBe(24000);

    expect(forecast.per_week).toEqual([
      // The workweek starts Sunday by default: the Mon-Sat shifts sit
      // in the week starting Sunday 2026-11-01.
      { week_start: '2026-11-01', hours: 69, overtime_hours: 5, doubletime_hours: 0, meal_break_premium_hours: 0, cost_cents: 119000 },
    ]);
  });

  test('overtime is per week, not per range: two 45-hour weeks owe 10 overtime hours', async () => {
    const shifts = [];
    for (const weekStart of ['2026-11-02', '2026-11-09']) {
      const base = new Date(`${weekStart}T12:00:00Z`);
      for (let i = 0; i < 5; i += 1) {
        const d = new Date(base);
        d.setUTCDate(d.getUTCDate() + i);
        shifts.push({
          id: shifts.length + 1, user_id: 'user-a', user_name: 'Ana',
          shift_date: d.toISOString().slice(0, 10),
          start_time: '09:00:00', end_time: '17:00:00',
          role_label: 'Server', hourly_wage_cents: 2000,
        });
      }
      const sat = new Date(base);
      sat.setUTCDate(sat.getUTCDate() + 5);
      shifts.push({
        id: shifts.length + 1, user_id: 'user-a', user_name: 'Ana',
        shift_date: sat.toISOString().slice(0, 10),
        start_time: '09:00:00', end_time: '14:00:00',
        role_label: 'Server', hourly_wage_cents: 2000,
      });
    }
    const db = fakeDb(shifts);
    const forecast = await computeScheduleForecast(db, {
      businessId: 2, from: '2026-11-02', to: '2026-11-15',
      overtimeThresholdHours: 40, overtimeMultiplierBps: 15000,
    });
    expect(forecast.total_hours).toBe(90);
    expect(forecast.total_overtime_hours).toBe(10);
    expect(forecast.total_cost_cents).toBe(2 * 95000);
    expect(forecast.per_week).toHaveLength(2);
    // Sunday-start weeks: 2026-11-01 and 2026-11-08.
    expect(forecast.per_week.map((w) => w.week_start)).toEqual(['2026-11-01', '2026-11-08']);
  });

  test('a Monday-start jurisdiction groups the same shifts into Monday weeks', async () => {
    const db = fakeDb(fixtureShifts());
    const forecast = await computeScheduleForecast(db, {
      businessId: 2, from: '2026-11-02', to: '2026-11-08',
      overtimeThresholdHours: 40, overtimeMultiplierBps: 15000,
      workweekStartDay: 1,
    });
    expect(forecast.workweek_start_day).toBe(1);
    expect(forecast.per_week).toEqual([
      { week_start: '2026-11-02', hours: 69, overtime_hours: 5, doubletime_hours: 0, meal_break_premium_hours: 0, cost_cents: 119000 },
    ]);
  });

  test('prices daily overtime, double time, and the missed-meal premium at a CA store (finding 36)', async () => {
    const shifts = [
      { id: 1, user_id: 'user-d', user_name: 'Dana', shift_date: '2026-11-02', start_time: '09:00:00', end_time: '19:00:00', role_label: 'Server', location_id: 1, restaurant_id: 5, hourly_wage_cents: 2000 },
      { id: 2, user_id: 'user-d', user_name: 'Dana', shift_date: '2026-11-03', start_time: '09:00:00', end_time: '22:00:00', role_label: 'Server', location_id: 1, restaurant_id: 5, hourly_wage_cents: 2000 },
    ];
    const db = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes('FROM business_staff_shifts')) return { rows: shifts };
        if (String(sql).includes('FROM restaurant_locations')) {
          return { rows: [{ id: 1, timezone: 'America/Los_Angeles' }] };
        }
        if (String(sql).includes('FROM restaurant_labor_jurisdictions')) {
          return { rows: [{ restaurant_id: 5, location_id: 1, jurisdiction_code: 'US-CA' }] };
        }
        return { rows: [] };
      }),
    };
    const forecast = await computeScheduleForecast(db, {
      businessId: 2, from: '2026-11-02', to: '2026-11-08', restaurantId: 5,
      policy: {
        overtime_threshold_hours: 40, overtime_threshold_explicit: true,
        overtime_multiplier_bps: 15000, doubletime_multiplier_bps: 20000,
        break_after_minutes: 360, break_duration_minutes: 30,
      },
      workweekStartDay: 0,
    });
    // Hand-computed at $20/h under US-CA (daily OT after 8h, double
    // time after 12h, 1h missed-meal premium after 6h with no break):
    // Mon 10h = 8 regular + 2 OT + 1h meal premium:
    //   8 x 2000 + 2 x 2000 x 1.5 + 1 x 2000 = 24000.
    // Tue 13h = 8 regular + 4 OT + 1 DT + 1h meal premium:
    //   8 x 2000 + 4 x 2000 x 1.5 + 1 x 2000 x 2 + 1 x 2000 = 34000.
    // Weekly total is 16 regular hours, so no weekly overtime converts.
    expect(forecast.draft_shift_count).toBe(2);
    expect(forecast.total_hours).toBe(23);
    expect(forecast.total_regular_hours).toBe(16);
    expect(forecast.total_overtime_hours).toBe(6);
    expect(forecast.total_doubletime_hours).toBe(1);
    expect(forecast.total_meal_break_premium_hours).toBe(2);
    expect(forecast.total_cost_cents).toBe(24000 + 34000);
    const [dana] = forecast.per_person;
    expect(dana).toMatchObject({
      user_id: 'user-d', hours: 23, regular_hours: 16, overtime_hours: 6,
      doubletime_hours: 1, meal_break_premium_hours: 2, missed_meal_breaks: 2,
      cost_cents: 58000, projected_overtime: true,
    });
    expect(forecast.per_week).toEqual([
      { week_start: '2026-11-01', hours: 23, overtime_hours: 6, doubletime_hours: 1, meal_break_premium_hours: 2, cost_cents: 58000 },
    ]);
  });

  test('no draft shifts means a zero forecast, and the query only reads drafts', async () => {
    const db = fakeDb([]);
    const forecast = await computeScheduleForecast(db, {
      businessId: 2, from: '2026-11-02', to: '2026-11-08',
      overtimeThresholdHours: 40, overtimeMultiplierBps: 15000,
    });
    expect(forecast.total_hours).toBe(0);
    expect(forecast.total_cost_cents).toBe(0);
    expect(forecast.per_person).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(String(db.query.mock.calls[0][0])).toContain('published_at IS NULL');
  });
});
