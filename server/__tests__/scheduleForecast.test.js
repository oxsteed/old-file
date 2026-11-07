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
      { week_start: '2026-11-01', hours: 69, overtime_hours: 5, cost_cents: 119000 },
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
      { week_start: '2026-11-02', hours: 69, overtime_hours: 5, cost_cents: 119000 },
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
