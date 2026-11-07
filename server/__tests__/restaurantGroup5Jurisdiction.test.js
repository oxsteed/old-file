'use strict';

// Group 5 design-review fixes (goal goal_a0fc7c0f0394), jurisdiction
// engine: finding 29 (unknown code / DB error fail closed), finding 38
// (NYC predictability priced in dollars), finding 48 (CUSTOM NULL
// overtime parameters fail closed), finding 32 (workweek-start
// parameter; engine half — the call-site routing lives in
// restaurantGroup5Workweek.test.js).
//
// Pure engine tests: no DB except the two fake-db getJurisdiction
// cases, which prove a query failure propagates instead of resolving
// to the US-FED preset.

const L = require('../services/laborJurisdictionRules');

describe('Finding 29: unknown jurisdiction codes fail closed', () => {
  test('resolveRules throws naming an unknown code', () => {
    expect(() => L.resolveRules({ jurisdiction_code: 'XX-NOWHERE' }))
      .toThrow('Unknown jurisdiction code: XX-NOWHERE');
  });

  test('a missing row still resolves to the US-FED preset', () => {
    expect(L.resolveRules(null).jurisdiction_code).toBe('US-FED');
    expect(L.resolveRules(null).weekly_overtime_hours).toBe(40);
    expect(L.resolveRules({}).jurisdiction_code).toBe('US-FED');
  });

  test('US-FED as an explicitly requested code still resolves', () => {
    const rules = L.resolveRules({ jurisdiction_code: 'US-FED' });
    expect(rules.jurisdiction_code).toBe('US-FED');
    expect(rules.weekly_overtime_hours).toBe(40);
  });

  test('getJurisdiction propagates a database error instead of returning US-FED', async () => {
    const db = { query: jest.fn(async () => { throw new Error('connection lost'); }) };
    await expect(L.getJurisdiction(db, 7, 11)).rejects.toThrow('connection lost');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('getJurisdiction with no stored row returns the US-FED preset', async () => {
    const db = { query: jest.fn(async () => ({ rows: [] })) };
    const rules = await L.getJurisdiction(db, 7, 11);
    expect(rules.jurisdiction_code).toBe('US-FED');
  });

  test('getJurisdictions propagates a database error instead of resolving every location to US-FED', async () => {
    const db = { query: jest.fn(async () => { throw new Error('connection lost'); }) };
    await expect(L.getJurisdictions(db, 7, [11, 12])).rejects.toThrow('connection lost');
  });

  test('getJurisdictions fills locations with no row from the US-FED preset', async () => {
    const db = { query: jest.fn(async () => ({ rows: [{ location_id: 11, jurisdiction_code: 'US-CA' }] })) };
    const map = await L.getJurisdictions(db, 7, [11, 12]);
    expect(map.get(11).jurisdiction_code).toBe('US-CA');
    expect(map.get(11).daily_overtime_hours).toBe(8);
    expect(map.get(12).jurisdiction_code).toBe('US-FED');
  });
});

describe('Finding 38: NYC predictability is priced in dollars, not hours', () => {
  const nyc = L.resolveRules({ jurisdiction_code: 'US-NYC' });
  // now is Monday 2026-10-26 12:00. The shift starts Friday
  // 2026-10-30 09:00 unless stated otherwise.
  const now = new Date('2026-10-26T12:00:00');
  const shift = (date, start, end) => ({ shift_date: date, start_time: start, end_time: end });

  test('the NYC preset carries the statutory $10-$75 tier table', () => {
    expect(nyc.predictability_premium_tiers).toEqual({
      add_change_7_14_days: 1000,
      add_change_under_7_days: 1500,
      reduce_cancel_7_14_days: 2000,
      reduce_cancel_24h_7_days: 4500,
      reduce_cancel_under_24h: 7500,
    });
    expect(nyc.predictability_premium_hours).toBeUndefined();
  });

  test('added hours with 7-14 days notice owe $10, not one hour at the wage', () => {
    // Shift Oct 30 09:00 is 93h out: under 7 days, so use a shift
    // 10 days out instead (Nov 5 09:00, 237h).
    const verdict = L.evaluateChange({
      before: shift('2026-11-05', '09:00', '17:00'),
      after: shift('2026-11-05', '09:00', '19:00'),
      rules: nyc, now,
    });
    expect(verdict.premium_due).toBe(true);
    expect(verdict.premium_cents).toBe(1000);
    expect(verdict.premium_hours).toBeNull();
  });

  test('added hours with under 7 days notice owe $15', () => {
    const verdict = L.evaluateChange({
      before: shift('2026-10-30', '09:00', '17:00'),
      after: shift('2026-10-30', '09:00', '19:00'),
      rules: nyc, now,
    });
    expect(verdict.premium_due).toBe(true);
    expect(verdict.premium_cents).toBe(1500);
    expect(verdict.premium_hours).toBeNull();
  });

  test('reduced hours with 7-14 days notice owe $20', () => {
    const verdict = L.evaluateChange({
      before: shift('2026-11-05', '09:00', '17:00'),
      after: shift('2026-11-05', '12:00', '17:00'),
      rules: nyc, now,
    });
    expect(verdict.premium_cents).toBe(2000);
  });

  test('reduced hours with 24h-7 days notice owe $45', () => {
    const verdict = L.evaluateChange({
      before: shift('2026-10-30', '09:00', '17:00'),
      after: shift('2026-10-30', '12:00', '17:00'),
      rules: nyc, now,
    });
    expect(verdict.premium_cents).toBe(4500);
  });

  test('a cancellation with under 24 hours notice owes $75', () => {
    const late = new Date('2026-10-29T12:00:00'); // 21h before the shift
    const verdict = L.evaluateChange({
      before: shift('2026-10-30', '09:00', '17:00'),
      after: null,
      rules: nyc, now: late,
    });
    expect(verdict.premium_due).toBe(true);
    expect(verdict.premium_cents).toBe(7500);
    expect(verdict.premium_hours).toBeNull();
  });

  test('a moved shift with no loss of hours prices on the add/change tiers', () => {
    const verdict = L.evaluateChange({
      before: shift('2026-10-30', '09:00', '17:00'),
      after: shift('2026-10-30', '10:00', '18:00'),
      rules: nyc, now,
    });
    expect(verdict.premium_cents).toBe(1500);
  });

  test('an employee-requested NYC change still owes nothing', () => {
    const verdict = L.evaluateChange({
      before: shift('2026-10-30', '09:00', '17:00'),
      after: shift('2026-10-30', '12:00', '17:00'),
      rules: nyc, now, employeeRequested: true,
    });
    expect(verdict.premium_due).toBe(false);
    expect(verdict.premium_cents).toBeNull();
  });

  test('hours-based jurisdictions keep the hours rule: SFO still owes one hour', () => {
    const sfo = L.resolveRules({ jurisdiction_code: 'US-SFO' });
    const verdict = L.evaluateChange({
      before: shift('2026-10-30', '09:00', '17:00'),
      after: shift('2026-10-30', '09:00', '19:00'),
      rules: sfo, now,
    });
    expect(verdict.premium_due).toBe(true);
    expect(verdict.premium_hours).toBe(1);
    expect(verdict.premium_cents).toBeNull();
  });

  test('predictabilityPremiumHours returns null for a dollar jurisdiction', () => {
    expect(L.predictabilityPremiumHours(nyc)).toBeNull();
    expect(L.predictabilityPremiumCents(nyc, { hoursBeforeStart: 93, reducedOrCancelled: true })).toBe(4500);
    expect(L.predictabilityPremiumCents(nyc, { hoursBeforeStart: 200, reducedOrCancelled: false })).toBe(1000);
  });

  test('a jurisdiction with no premium rule still owes nothing', () => {
    const fed = L.resolveRules({ jurisdiction_code: 'US-FED' });
    const verdict = L.evaluateChange({
      before: shift('2026-10-30', '09:00', '17:00'),
      after: shift('2026-10-30', '09:00', '19:00'),
      rules: fed, now,
    });
    expect(verdict.premium_due).toBe(false);
    expect(verdict.premium_cents).toBeNull();
    expect(verdict.premium_hours).toBeNull();
  });
});

describe('Finding 48: a CUSTOM row with NULL overtime parameters fails closed', () => {
  test('an all-NULL CUSTOM row names the missing weekly threshold', () => {
    const rules = L.resolveRules({ jurisdiction_code: 'CUSTOM' });
    expect(L.customRulesErrors(rules)).toEqual(['weekly_overtime_hours']);
    expect(() => L.assertPayableRules(rules)).toThrow('weekly_overtime_hours');
  });

  test('a CUSTOM row with a weekly threshold is payable', () => {
    const rules = L.resolveRules({ jurisdiction_code: 'CUSTOM', weekly_overtime_hours: 40 });
    expect(L.customRulesErrors(rules)).toEqual([]);
    expect(() => L.assertPayableRules(rules)).not.toThrow();
  });

  test('a double-time threshold without a daily threshold is named too', () => {
    const rules = L.resolveRules({
      jurisdiction_code: 'CUSTOM', weekly_overtime_hours: 40, daily_doubletime_hours: 12,
    });
    expect(L.customRulesErrors(rules)).toEqual(['daily_overtime_hours']);
  });

  test('non-CUSTOM jurisdictions never fail the check', () => {
    expect(L.customRulesErrors(L.resolveRules({ jurisdiction_code: 'US-FED' }))).toEqual([]);
    expect(L.customRulesErrors(L.resolveRules({ jurisdiction_code: 'GB-UK' }))).toEqual([]);
  });
});

describe('Finding 32 (engine): one workweek-start parameter, Sunday by default', () => {
  test('every preset defaults the workweek to Sunday', () => {
    for (const code of Object.keys(L.PRESETS)) {
      if (code === 'CUSTOM') continue;
      expect(L.resolveRules({ jurisdiction_code: code }).workweek_start_day).toBe(0);
    }
  });

  test('a stored row can move the start; NULL falls back to the preset', () => {
    expect(L.resolveRules({ jurisdiction_code: 'US-CA', workweek_start_day: 1 }).workweek_start_day).toBe(1);
    expect(L.resolveRules({ jurisdiction_code: 'US-CA', workweek_start_day: null }).workweek_start_day).toBe(0);
    expect(L.resolveRules({ jurisdiction_code: 'CUSTOM', workweek_start_day: 1 }).workweek_start_day).toBe(1);
  });

  test('weekStartOf uses the configured start day', () => {
    // 2026-11-02 is a Monday.
    expect(L.weekStartOf('2026-11-02', 0)).toBe('2026-11-01'); // Sunday start
    expect(L.weekStartOf('2026-11-02', 1)).toBe('2026-11-02'); // Monday start
    expect(L.weekStartOf('2026-11-07', 0)).toBe('2026-11-01'); // Saturday, same Sunday week
    expect(L.weekStartOf('2026-11-07', 1)).toBe('2026-11-02'); // Saturday, same Monday week
    expect(L.weekStartOf('2026-11-08', 1)).toBe('2026-11-02'); // Sunday still in the Monday week
    expect(L.weekStartOf('2026-11-08', 0)).toBe('2026-11-08'); // Sunday starts a new Sunday week
  });

  test('workweekStartDay clamps missing or out-of-range values to Sunday', () => {
    expect(L.workweekStartDay(null)).toBe(0);
    expect(L.workweekStartDay({})).toBe(0);
    expect(L.workweekStartDay({ workweek_start_day: 3 })).toBe(3);
    expect(L.workweekStartDay({ workweek_start_day: 9 })).toBe(0);
    expect(L.workweekStartDay({ workweek_start_day: '1' })).toBe(1);
  });
});
