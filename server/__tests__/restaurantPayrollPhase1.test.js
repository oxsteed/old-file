'use strict';

// Phase 1 pay correctness (goal_a0fc7c0f0394): jurisdiction-driven pay
// calc, per-location policy, predictability + meal-break premiums,
// per-currency precision.
//
// The pay calc is driven by the jurisdiction rule table, never by a
// hardcoded country branch. California is ONE fixture here: every
// scenario below is stated with its jurisdiction's rule values, and
// the GB-UK / HT fixtures prove the same code pays differently under
// a different row of the table.
//
// Hand-checked numbers use a wage of 2000 minor units/hour for the
// US-CA fixture (the location's currency is USD in the fixture data,
// because a California restaurant pays in USD) and 1800 minor
// units/hour for the GB-UK fixture (currency GBP in the fixture
// data). No code path in the calc assumes either currency: the
// currency always arrives with the fixture/location data.
//
// Old behavior for reference: the weekly-only calc paid an 11-hour
// California shift as 11 regular hours (22,000 at 2000/hr) with no
// premium. The new calc pays 8 regular + 3 daily overtime + 1 hour
// meal premium (27,000).

jest.mock('../db', () => ({ query: jest.fn() }));

const db = require('../db');
const payroll = require('../services/restaurantPayrollService');
const L = require('../services/laborJurisdictionRules');
const { minorUnitDecimals, formatMinorUnits } = require('../utils/currencyPrecision');

const POLICY_40 = {
  overtime_threshold_hours: 40,
  overtime_multiplier_bps: 15000,
  break_after_minutes: 360,
  break_duration_minutes: 30,
};
const POLICY_48 = { ...POLICY_40, overtime_threshold_hours: 48 };
const POLICY_44 = { ...POLICY_40, overtime_threshold_hours: 44 };

const CA = L.resolveRules({ jurisdiction_code: 'US-CA' });
const GB = L.resolveRules({ jurisdiction_code: 'GB-UK' });
const HT = L.resolveRules({ jurisdiction_code: 'HT' });
const FED = L.resolveRules({ jurisdiction_code: 'US-FED' });

const noBreaks = [];
const halfHourBreak = [{ started_at: '2026-11-02T12:00:00Z', ended_at: '2026-11-02T12:30:00Z' }];
const entry = (userId, date, hours, breaks = noBreaks, locationId = 1) => ({
  user_id: userId, entry_date: date, hours_worked: hours, breaks, location_id: locationId,
  clock_in_at: `${date}T09:00:00Z`, clock_out_at: `${date}T20:00:00Z`,
});

describe('Phase 1: California daily overtime, double time, 7th day (US-CA row)', () => {
  test('an 11-hour shift pays 8 regular + 3 daily overtime, not 11 straight', () => {
    const result = payroll.calculatePolicyHours(
      [entry('u1', '2026-11-02', 11)], POLICY_40, CA
    ).get('u1');
    expect(result.totalHours).toBe(11);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(3);
    expect(result.doubletimeHours).toBe(0);
    // Wages at 2000/hr: 8 x 2000 + 3 x 3000 = 25,000 (old code: 22,000).
    expect(result.regularHours * 2000 + result.overtimeHours * 3000).toBe(25000);
  });

  test('a 13-hour shift pays 8 regular + 4 overtime + 1 double time', () => {
    const result = payroll.calculatePolicyHours(
      [entry('u1', '2026-11-02', 13)], POLICY_40, CA
    ).get('u1');
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(4);
    expect(result.doubletimeHours).toBe(1);
    expect(result.regularHours * 2000 + result.overtimeHours * 3000 + result.doubletimeHours * 4000)
      .toBe(32000);
  });

  test('a 7th consecutive day pays time-and-a-half for the first 8, double after', () => {
    // Sun 2026-11-01 .. Sat 2026-11-07, 8h each with a 30-min break
    // (so no meal premium interferes). Week total 56h.
    // Days 1-6: 48 regular hours, weekly threshold 40 -> 8 weekly OT.
    // Day 7 (Sat): 8h at 1.5x. Regular 40, overtime 16, double 0.
    const rows = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']
      .map((d) => entry('u1', d, 8, halfHourBreak));
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA).get('u1');
    expect(result.totalHours).toBe(56);
    expect(result.regularHours).toBe(40);
    expect(result.overtimeHours).toBe(16);
    expect(result.doubletimeHours).toBe(0);
    expect(result.missedMealBreaks).toBe(0);
    // 40 x 2000 + 16 x 3000 = 128,000.
    expect(result.regularHours * 2000 + result.overtimeHours * 3000).toBe(128000);
  });

  test('a 10-hour 7th consecutive day pays 8 at 1.5x and 2 at double time', () => {
    const rows = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
      .map((d) => entry('u1', d, 8, halfHourBreak));
    rows.push(entry('u1', '2026-11-07', 10, halfHourBreak));
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA).get('u1');
    expect(result.totalHours).toBe(58);
    expect(result.regularHours).toBe(40);
    expect(result.overtimeHours).toBe(16);
    expect(result.doubletimeHours).toBe(2);
    // 40 x 2000 + 16 x 3000 + 2 x 4000 = 136,000.
    expect(result.regularHours * 2000 + result.overtimeHours * 3000 + result.doubletimeHours * 4000)
      .toBe(136000);
  });

  test('six consecutive days do not trigger the 7th-day rule', () => {
    const rows = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']
      .map((d) => entry('u1', d, 8, halfHourBreak));
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA).get('u1');
    // 48h in the week: 40 regular + 8 weekly OT, no 7th-day premium.
    expect(result.regularHours).toBe(40);
    expect(result.overtimeHours).toBe(8);
    expect(result.doubletimeHours).toBe(0);
  });

  test('a day off resets the consecutive-day streak', () => {
    // Work Sun-Tue, off Wed, work Thu-Sun: longest streak is 4 days.
    const rows = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
      .map((d) => entry('u1', d, 8, halfHourBreak));
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA).get('u1');
    // Week of Nov 1 (Sun-Sat): 48h -> 40 regular + 8 weekly OT.
    // Nov 8 starts a new week: 8 regular. No 7th-day premium anywhere.
    expect(result.regularHours).toBe(48);
    expect(result.overtimeHours).toBe(8);
    expect(result.doubletimeHours).toBe(0);
  });
});

describe('Phase 1: the same code under a different jurisdiction row', () => {
  test('GB-UK: an 11-hour shift is straight time (no daily overtime rule)', () => {
    const result = payroll.calculatePolicyHours(
      [entry('u1', '2026-11-02', 11)], POLICY_48, GB
    ).get('u1');
    expect(result.regularHours).toBe(11);
    expect(result.overtimeHours).toBe(0);
    expect(result.doubletimeHours).toBe(0);
  });

  test('GB-UK: a 50-hour week pays 48 regular + 2 weekly overtime at the 48h threshold', () => {
    const rows = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
      .map((d) => entry('u1', d, 10, halfHourBreak));
    const result = payroll.calculatePolicyHours(rows, POLICY_48, GB).get('u1');
    expect(result.totalHours).toBe(50);
    expect(result.regularHours).toBe(48);
    expect(result.overtimeHours).toBe(2);
    expect(result.doubletimeHours).toBe(0);
    // Wages at 1800/hr (GBP fixture): 48 x 1800 + 2 x 2700 = 91,800.
    expect(result.regularHours * 1800 + result.overtimeHours * 2700).toBe(91800);
  });

  test('HT: a 9-hour day pays 8 regular + 1 daily overtime, no double-time tier', () => {
    const result = payroll.calculatePolicyHours(
      [entry('u1', '2026-11-02', 9)], POLICY_48, HT
    ).get('u1');
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(1);
    expect(result.doubletimeHours).toBe(0);
  });

  test('HT: a 13-hour day still has no double time (no double-time rule)', () => {
    const result = payroll.calculatePolicyHours(
      [entry('u1', '2026-11-02', 13)], POLICY_48, HT
    ).get('u1');
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(5);
    expect(result.doubletimeHours).toBe(0);
  });

  test('US-FED default (no rules given): weekly-only, as before', () => {
    const rows = [
      entry('u1', '2026-11-02', 11),
      entry('u1', '2026-11-03', 11),
      entry('u1', '2026-11-04', 11),
      entry('u1', '2026-11-05', 11),
    ];
    const result = payroll.calculatePolicyHours(rows, POLICY_40).get('u1');
    expect(result.totalHours).toBe(44);
    expect(result.regularHours).toBe(40);
    expect(result.overtimeHours).toBe(4);
    expect(result.doubletimeHours).toBe(0);
  });
});

describe('Phase 1: the jurisdiction weekly threshold reaches pay (finding 2)', () => {
  // A location with no explicit labor-policy row falls back to the
  // 40h default — a US-FED assumption, not an operator choice. The
  // jurisdiction row must govern instead: GB-UK pays OT above 48h,
  // CA-ON above 44h.
  const DEFAULT_POLICY = payroll.normalizeLaborPolicy(null);
  const ON = L.resolveRules({ jurisdiction_code: 'CA-ON' });

  test('normalizeLaborPolicy marks a missing row as a non-explicit default', () => {
    expect(DEFAULT_POLICY.overtime_threshold_hours).toBe(40);
    expect(DEFAULT_POLICY.overtime_threshold_explicit).toBe(false);
    expect(payroll.normalizeLaborPolicy({ overtime_threshold_hours: 40 }).overtime_threshold_explicit).toBe(true);
  });

  test('GB-UK: a 50-hour week under the default policy pays 48 regular + 2 weekly overtime', () => {
    const rows = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
      .map((d) => entry('u1', d, 10, halfHourBreak));
    const result = payroll.calculatePolicyHours(rows, DEFAULT_POLICY, GB).get('u1');
    expect(result.totalHours).toBe(50);
    expect(result.regularHours).toBe(48);
    expect(result.overtimeHours).toBe(2);
    expect(result.doubletimeHours).toBe(0);
  });

  test('CA-ON: a 46-hour week under the default policy pays 44 regular + 2 weekly overtime', () => {
    const rows = [
      entry('u1', '2026-11-02', 10, halfHourBreak),
      entry('u1', '2026-11-03', 10, halfHourBreak),
      entry('u1', '2026-11-04', 10, halfHourBreak),
      entry('u1', '2026-11-05', 10, halfHourBreak),
      entry('u1', '2026-11-06', 6, halfHourBreak),
    ];
    const result = payroll.calculatePolicyHours(rows, DEFAULT_POLICY, ON).get('u1');
    expect(result.totalHours).toBe(46);
    expect(result.regularHours).toBe(44);
    expect(result.overtimeHours).toBe(2);
    expect(result.doubletimeHours).toBe(0);
  });

  test('an explicit lower policy still pays OT earlier than the jurisdiction threshold', () => {
    // An operator who configured 40h in GB-UK pays OT from 40h:
    // the explicit threshold is more generous than the statute.
    const rows = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
      .map((d) => entry('u1', d, 10, halfHourBreak));
    const result = payroll.calculatePolicyHours(rows, POLICY_40, GB).get('u1');
    expect(result.regularHours).toBe(40);
    expect(result.overtimeHours).toBe(10);
  });

  test('an explicit higher policy is capped by the jurisdiction threshold', () => {
    // An operator who configured 48h in CA-ON cannot pay OT later
    // than the statutory 44h.
    const rows = [
      entry('u1', '2026-11-02', 10, halfHourBreak),
      entry('u1', '2026-11-03', 10, halfHourBreak),
      entry('u1', '2026-11-04', 10, halfHourBreak),
      entry('u1', '2026-11-05', 10, halfHourBreak),
      entry('u1', '2026-11-06', 6, halfHourBreak),
    ];
    const result = payroll.calculatePolicyHours(rows, POLICY_48, ON).get('u1');
    expect(result.totalHours).toBe(46);
    expect(result.regularHours).toBe(44);
    expect(result.overtimeHours).toBe(2);
  });
});

describe('Phase 1: meal-break premium follows the jurisdiction', () => {
  test('CA: a 6-hour shift with no break earns one hour at the regular rate', () => {
    const result = payroll.calculatePolicyHours(
      [entry('u1', '2026-11-02', 6)], POLICY_40, CA
    ).get('u1');
    expect(result.missedMealBreaks).toBe(1);
    expect(result.mealBreakPremiumHours).toBe(1);
    // 6h regular (12,000) + 1h premium (2,000) = 14,000.
    expect(result.regularHours * 2000 + result.mealBreakPremiumHours * 2000).toBe(14000);
  });

  test('CA: a 6-hour shift with a 30-minute break earns no premium', () => {
    const result = payroll.calculatePolicyHours(
      [entry('u1', '2026-11-02', 6, halfHourBreak)], POLICY_40, CA
    ).get('u1');
    expect(result.missedMealBreaks).toBe(0);
    expect(result.mealBreakPremiumHours).toBe(0);
  });

  test('GB-UK: a missed meal break is counted but earns no premium (no premium rule)', () => {
    const result = payroll.calculatePolicyHours(
      [entry('u1', '2026-11-02', 6)], POLICY_48, GB
    ).get('u1');
    expect(result.missedMealBreaks).toBe(1);
    expect(result.mealBreakPremiumHours).toBe(0);
  });

  test('CA: a short shift under the meal-break point earns no premium', () => {
    const result = payroll.calculatePolicyHours(
      [entry('u1', '2026-11-02', 4)], POLICY_40, CA
    ).get('u1');
    expect(result.missedMealBreaks).toBe(0);
    expect(result.mealBreakPremiumHours).toBe(0);
  });
});

describe('Phase 1: predictability premium is jurisdiction-driven', () => {
  const now = new Date('2026-10-26T12:00:00');
  const before = { shift_date: '2026-10-30', start_time: '09:00', end_time: '17:00' };
  const after = { shift_date: '2026-10-30', start_time: '12:00', end_time: '17:00' };

  test('US-NYC inside the 14-day window owes one hour at the regular rate', () => {
    const nyc = L.resolveRules({ jurisdiction_code: 'US-NYC' });
    const verdict = L.evaluateChange({ before, after, rules: nyc, now });
    expect(verdict.premium_due).toBe(true);
    expect(verdict.premium_hours).toBe(1);
    // At 2000/hr the premium line is 2,000 minor units.
    expect(verdict.premium_hours * 2000).toBe(2000);
  });

  test('US-FED has no notice rule, so no premium is owed', () => {
    const verdict = L.evaluateChange({ before, after, rules: FED, now });
    expect(verdict.premium_due).toBe(false);
    expect(verdict.premium_hours).toBe(null);
  });

  test('an employee-requested change owes no premium', () => {
    const nyc = L.resolveRules({ jurisdiction_code: 'US-NYC' });
    const verdict = L.evaluateChange({ before, after, rules: nyc, now, employeeRequested: true });
    expect(verdict.premium_due).toBe(false);
    expect(verdict.premium_hours).toBe(null);
  });

  test('a CUSTOM jurisdiction can set its own premium hours', () => {
    const custom = L.resolveRules({
      jurisdiction_code: 'CUSTOM',
      schedule_notice_hours: 168,
      predictability_premium_hours: 2,
    });
    const verdict = L.evaluateChange({ before, after, rules: custom, now });
    expect(verdict.premium_due).toBe(true);
    expect(verdict.premium_hours).toBe(2);
  });

  test('a jurisdiction with a notice rule but no premium amount defaults to one hour', () => {
    const custom = L.resolveRules({
      jurisdiction_code: 'CUSTOM',
      schedule_notice_hours: 168,
      predictability_premium_hours: null,
    });
    expect(L.predictabilityPremiumHours(custom)).toBe(1);
    expect(L.mealBreakPremiumHours(custom)).toBe(null);
  });
});

describe('Phase 1: cross-store weekly overtime attribution still works', () => {
  test('weekly OT is attributed to the store where the threshold is crossed', () => {
    // Mon-Thu 8h at location 1 (32h), Fri 8h + Sat 4h at location 2.
    // Week total 44h, threshold 40: the 4 OT hours fall on Saturday,
    // at location 2.
    const rows = [
      entry('u1', '2026-11-02', 8, halfHourBreak, 1),
      entry('u1', '2026-11-03', 8, halfHourBreak, 1),
      entry('u1', '2026-11-04', 8, halfHourBreak, 1),
      entry('u1', '2026-11-05', 8, halfHourBreak, 1),
      entry('u1', '2026-11-06', 8, halfHourBreak, 2),
      entry('u1', '2026-11-07', 4, halfHourBreak, 2),
    ];
    const loc1 = payroll.scopedPolicyHours(rows, POLICY_40, [1], '2026-11-02', '2026-11-07', FED).get('u1');
    expect(loc1.totalHours).toBe(32);
    expect(loc1.overtimeHours).toBe(0);
    const loc2 = payroll.scopedPolicyHours(rows, POLICY_40, [2], '2026-11-02', '2026-11-07', FED).get('u1');
    expect(loc2.totalHours).toBe(12);
    expect(loc2.regularHours).toBe(8);
    expect(loc2.overtimeHours).toBe(4);
  });

  test('daily overtime buckets per person per day across locations', () => {
    // Same day, two locations: 6h in CA (location 1) + 6h in GB-UK
    // (location 2). One person, one 12-hour day: the strictest
    // daily threshold in the day (CA, 8h) governs, so 8 regular +
    // 4 daily overtime — not 12 straight hours.
    const rows = [
      entry('u1', '2026-11-02', 6, noBreaks, 1),
      entry('u1', '2026-11-02', 6, noBreaks, 2),
    ];
    const resolver = (locationId) => (locationId === 1 ? CA : GB);
    const result = payroll.calculatePolicyHours(rows, POLICY_40, resolver).get('u1');
    expect(result.totalHours).toBe(12);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(4);
  });

  test('daily overtime across two CA stores pays OT above 8h, attributed to the second store', () => {
    // Same person, same day, 6h at one CA location + 6h at another:
    // one 12-hour day, 8 regular + 4 daily overtime. The tiers hand
    // out in chronological order, so the overtime lands on the
    // second store's rows.
    const rows = [
      entry('u1', '2026-11-02', 6, halfHourBreak, 1),
      entry('u1', '2026-11-02', 6, halfHourBreak, 2),
    ];
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA).get('u1');
    expect(result.totalHours).toBe(12);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(4);
    const loc1 = payroll.scopedPolicyHours(rows, POLICY_40, [1], '2026-11-02', '2026-11-02', CA).get('u1');
    expect(loc1.totalHours).toBe(6);
    expect(loc1.regularHours).toBe(6);
    expect(loc1.overtimeHours).toBe(0);
    const loc2 = payroll.scopedPolicyHours(rows, POLICY_40, [2], '2026-11-02', '2026-11-02', CA).get('u1');
    expect(loc2.totalHours).toBe(6);
    expect(loc2.regularHours).toBe(2);
    expect(loc2.overtimeHours).toBe(4);
  });
});

describe('Phase 1: per-location labor policy (mocked DB)', () => {
  beforeEach(() => { db.query.mockReset(); });

  test('a location row wins over the restaurant fallback; fallback applies without one', async () => {
    db.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('restaurant_location_labor_policies')) {
        if (params[1] === 11) {
          return { rows: [{ restaurant_id: 7, location_id: 11, country_code: 'US', region_code: 'CA', overtime_threshold_hours: 44, overtime_multiplier_bps: 15000, break_after_minutes: 300, break_duration_minutes: 30, updated_by: null, updated_at: null }] };
        }
        return { rows: [] };
      }
      if (String(sql).includes('FROM restaurant_labor_policies')) {
        return { rows: [{ restaurant_id: 7, overtime_threshold_hours: 40, overtime_multiplier_bps: 15000, break_after_minutes: 360, break_duration_minutes: 30, updated_by: null, updated_at: null }] };
      }
      return { rows: [] };
    });
    const perLocation = await payroll.getLaborPolicy(7, 11);
    expect(perLocation.location_id).toBe(11);
    expect(perLocation.country_code).toBe('US');
    expect(perLocation.region_code).toBe('CA');
    expect(perLocation.overtime_threshold_hours).toBe(44);
    expect(perLocation.break_after_minutes).toBe(300);
    const fallback = await payroll.getLaborPolicy(7, 12);
    expect(fallback.location_id).toBe(null);
    expect(fallback.overtime_threshold_hours).toBe(40);
    const restaurantLevel = await payroll.getLaborPolicy(7);
    expect(restaurantLevel.overtime_threshold_hours).toBe(40);
  });

  test('saving a per-location policy defaults country/region from the location address', async () => {
    db.query.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM restaurant_locations')) {
        return { rows: [{ address_country: 'GB', address_state: 'London' }] };
      }
      if (String(sql).includes('restaurant_location_labor_policies')) {
        return { rows: [{ restaurant_id: 7, location_id: 21, country_code: 'GB', region_code: 'London', overtime_threshold_hours: 48, overtime_multiplier_bps: 15000, break_after_minutes: 360, break_duration_minutes: 20, updated_by: null, updated_at: null }] };
      }
      return { rows: [] };
    });
    const saved = await payroll.saveLaborPolicy(7, { overtime_threshold_hours: 48, break_duration_minutes: 20 }, 'user-1', 21);
    expect(saved.location_id).toBe(21);
    expect(saved.country_code).toBe('GB');
    expect(saved.region_code).toBe('London');
    expect(saved.overtime_threshold_hours).toBe(48);
    const insertCall = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO restaurant_location_labor_policies'));
    expect(insertCall).toBeDefined();
  });

  test('saving a restaurant-level policy still targets the restaurant table', async () => {
    db.query.mockImplementation(async () => ({
      rows: [{ restaurant_id: 7, overtime_threshold_hours: 40, overtime_multiplier_bps: 15000, break_after_minutes: 360, break_duration_minutes: 30, updated_by: null, updated_at: null }],
    }));
    const saved = await payroll.saveLaborPolicy(7, { overtime_threshold_hours: 40 }, 'user-1');
    expect(saved.location_id).toBe(null);
    const insertCall = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO restaurant_labor_policies'));
    expect(insertCall).toBeDefined();
  });
});

describe('Phase 1: per-currency minor-unit precision', () => {
  test('JPY has 0 decimals, BHD has 3, most currencies have 2', () => {
    expect(minorUnitDecimals('JPY')).toBe(0);
    expect(minorUnitDecimals('KRW')).toBe(0);
    expect(minorUnitDecimals('BHD')).toBe(3);
    expect(minorUnitDecimals('KWD')).toBe(3);
    expect(minorUnitDecimals('USD')).toBe(2);
    expect(minorUnitDecimals('GBP')).toBe(2);
    expect(minorUnitDecimals('HTG')).toBe(2);
    expect(minorUnitDecimals(null)).toBe(2);
    expect(minorUnitDecimals('not-a-code')).toBe(2);
  });

  test('formatting uses the currency own precision', () => {
    expect(formatMinorUnits(100500, 'JPY')).toBe('¥100,500');
    expect(formatMinorUnits(123456, 'BHD')).toContain('123.456');
    expect(formatMinorUnits(123456, 'USD')).toContain('1,234.56');
    expect(formatMinorUnits(123456, 'GBP')).toContain('1,234.56');
  });
});

describe('Phase 1: predictability premiums are filtered by their recorded currency (finding 6)', () => {
  beforeEach(() => { db.query.mockReset(); });

  // One user with four premium rows: USD stored, EUR stored, EUR
  // unpriced, and a stored amount with no recorded currency. A
  // second user has a USD premium with no stored amount, priced now
  // from the wage of record.
  const premiumRows = [
    { user_id: 'u1', location_id: 1, premium_currency_code: 'USD', change_count: 1, premium_hours: 1, stored_cents: 2000, unpriced_rows: 0, unpriced_hours: 0 },
    { user_id: 'u1', location_id: 2, premium_currency_code: 'EUR', change_count: 1, premium_hours: 2, stored_cents: 3000, unpriced_rows: 0, unpriced_hours: 0 },
    { user_id: 'u1', location_id: 2, premium_currency_code: 'EUR', change_count: 1, premium_hours: 1, stored_cents: 0, unpriced_rows: 1, unpriced_hours: 1 },
    { user_id: 'u1', location_id: 1, premium_currency_code: null, change_count: 1, premium_hours: 1, stored_cents: 500, unpriced_rows: 0, unpriced_hours: 0 },
    { user_id: 'u2', location_id: 1, premium_currency_code: 'USD', change_count: 1, premium_hours: 1, stored_cents: 0, unpriced_rows: 1, unpriced_hours: 1 },
  ];
  const wages = new Map([['u1', 2000], ['u2', 2000]]);
  const args = {
    businessId: 7, fromDate: '2026-11-02', toDate: '2026-11-07',
    timezone: 'America/New_York', wagesByUser: wages,
  };

  test('a USD run pays only the USD premium; the rest is excluded and reported', async () => {
    db.query.mockResolvedValue({ rows: premiumRows });
    const byUser = await payroll.getPredictabilityPremiums({ ...args, currency: 'USD' });
    const u1 = byUser.get('u1');
    expect(u1.premium_cents).toBe(2000);
    expect(u1.premium_hours).toBe(5);
    expect(u1.change_count).toBe(4);
    // EUR stored 3000 + 500 with no recorded currency: excluded,
    // never converted into the USD run.
    expect(u1.excluded_premium_cents).toBe(3500);
    expect(u1.excluded_premium_currencies).toEqual(['EUR']);
    // The unpriced EUR hour stays unpriced instead of being priced
    // at the USD wage: finalization fails closed on it.
    expect(u1.unpriced_premium_hours).toBe(1);
    // The USD premium with no stored amount is priced now at the wage.
    const u2 = byUser.get('u2');
    expect(u2.premium_cents).toBe(2000);
    expect(u2.unpriced_premium_hours).toBe(0);
  });

  test('a EUR run pays the EUR premium and excludes the USD one', async () => {
    db.query.mockResolvedValue({ rows: premiumRows });
    const byUser = await payroll.getPredictabilityPremiums({ ...args, currency: 'EUR' });
    const u1 = byUser.get('u1');
    // EUR stored 3000, plus the unpriced EUR hour priced now at the
    // wage of record (1h x 2000).
    expect(u1.premium_cents).toBe(3000 + 2000);
    expect(u1.unpriced_premium_hours).toBe(0);
    expect(u1.excluded_premium_cents).toBe(2500);
    expect(u1.excluded_premium_currencies).toEqual(['USD']);
  });
});

describe('Phase 1: payroll CSV carries the new pay lines', () => {
  test('header and rows include doubletime, meal and predictability columns', () => {
    const labor = {
      currency: 'USD', from_date: '2026-11-02', to_date: '2026-11-07',
      employees: [{
        name: 'Ana', user_id: 'u1', job_role: 'Cook', hours: 11, regular_hours: 8,
        overtime_hours: 3, doubletime_hours: 0, scheduled_hours: 11,
        hourly_wage_cents: 2000, regular_wages_cents: 16000, overtime_wages_cents: 9000,
        doubletime_wages_cents: 0, wages_cents: 25000, break_exceptions: 1,
        missed_meal_breaks: 1, meal_break_premium_hours: 1, meal_break_premium_cents: 2000,
        predictability_premium_hours: 1, predictability_premium_cents: 2000,
        unpriced_premium_hours: 0,
        gross_tips_cents: 0, tip_out_cents: 0, tip_in_cents: 0, net_tips_cents: 0,
        total_pay_cents: 29000,
      }],
    };
    const csv = payroll.buildPayrollCsv(labor);
    const [header, row] = csv.trim().split('\n');
    expect(header).toContain('doubletime_hours');
    expect(header).toContain('meal_break_premium_cents');
    expect(header).toContain('predictability_premium_cents');
    expect(header).toContain('unpriced_premium_hours');
    // Existing columns keep their positions: employee is still first.
    expect(header.split(',')[0]).toBe('employee');
    expect(row).toContain('Ana');
    expect(row.split(',').length).toBe(header.split(',').length);
  });
});
