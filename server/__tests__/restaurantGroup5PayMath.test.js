'use strict';

// Group 5 design-review fixes (goal goal_a0fc7c0f0394), pay math:
// finding 47 (double-time multiplier is a policy parameter),
// finding 17 (overnight hours split across local dates),
// finding 16 (one meal-break premium per person per day, one
// continuous break).
//
// The tiering tests are pure (calculatePolicyHours / tierRows); the
// doubletime pricing itself is proved end to end in
// restaurantPayrollPhase1.db.test.js, where computeLabor runs against
// the migrated database.

jest.mock('../db', () => ({ query: jest.fn() }));

const db = require('../db');
const payroll = require('../services/restaurantPayrollService');
const L = require('../services/laborJurisdictionRules');

const POLICY_40 = {
  overtime_threshold_hours: 40,
  overtime_multiplier_bps: 15000,
  break_after_minutes: 360,
  break_duration_minutes: 30,
};
const CA = L.resolveRules({ jurisdiction_code: 'US-CA' });
const noBreaks = [];
const halfHourBreak = [{ started_at: '2026-11-02T12:00:00Z', ended_at: '2026-11-02T12:30:00Z' }];
const entry = (userId, date, hours, breaks = noBreaks, locationId = 1) => ({
  user_id: userId, entry_date: date, hours_worked: hours, breaks, location_id: locationId,
  clock_in_at: `${date}T09:00:00Z`, clock_out_at: `${date}T20:00:00Z`,
});

describe('Finding 17: overnight hours split across local dates at midnight', () => {
  const ny = () => 'America/New_York';
  // 2026-11-02 is a Monday; EST (-05:00) applies after the Nov 1
  // DST change. The overnight entries below are single punches whose
  // clock-out is the next local morning.
  const overnight = (userId, date, clockIn, clockOut, hours, breaks = noBreaks, locationId = 1) => ({
    user_id: userId, entry_date: date, hours_worked: hours, breaks, location_id: locationId,
    clock_in_at: clockIn, clock_out_at: clockOut,
  });

  test('a 12-hour overnight CA shift tiers as two 6-hour days, not 8 regular + 4 OT', () => {
    const rows = [overnight('u1', '2026-11-02', '2026-11-02T18:00:00-05:00', '2026-11-03T06:00:00-05:00', 12)];
    const { byUser, allocations } = payroll.tierRows(rows, POLICY_40, CA, { timezoneFor: ny });
    const result = byUser.get('u1');
    expect(result.totalHours).toBe(12);
    expect(result.regularHours).toBe(12);
    expect(result.overtimeHours).toBe(0);
    expect(result.doubletimeHours).toBe(0);
    // Old code bucketed all 12h on the clock-in date: 8 + 4 OT.
    expect(allocations).toHaveLength(2);
    expect(allocations[0]).toMatchObject({ entry_date: '2026-11-02', regular: 6, overtime: 0 });
    expect(allocations[1]).toMatchObject({ entry_date: '2026-11-03', regular: 6, overtime: 0 });
  });

  test('a 13-hour overnight CA shift tiers as 6 + 7 regular hours, with no double time', () => {
    const rows = [overnight('u1', '2026-11-02', '2026-11-02T18:00:00-05:00', '2026-11-03T07:00:00-05:00', 13)];
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA, { timezoneFor: ny }).get('u1');
    expect(result.totalHours).toBe(13);
    expect(result.regularHours).toBe(13);
    expect(result.overtimeHours).toBe(0);
    expect(result.doubletimeHours).toBe(0);
  });

  test('spring-forward night: 22:00 EST to 06:00 EDT is 7 elapsed hours, 2 + 5 across midnight', () => {
    // 2026-03-07 22:00 EST (-05:00) to 2026-03-08 06:00 EDT (-04:00):
    // 7 elapsed hours, not 8. The split follows the local dates.
    const rows = [overnight('u1', '2026-03-07', '2026-03-07T22:00:00-05:00', '2026-03-08T06:00:00-04:00', 7)];
    const { byUser, allocations } = payroll.tierRows(rows, POLICY_40, L.resolveRules(null), { timezoneFor: ny });
    expect(byUser.get('u1').totalHours).toBe(7);
    expect(allocations).toHaveLength(2);
    expect(allocations[0]).toMatchObject({ entry_date: '2026-03-07', regular: 2 });
    expect(allocations[1]).toMatchObject({ entry_date: '2026-03-08', regular: 5 });
  });

  test('a break spanning midnight is subtracted where it falls', () => {
    // 22:00-06:00 (8h gross) with a 30-minute break 23:30-00:00:
    // 1.5 net hours on the first date, 6 on the second.
    const breaks = [{ started_at: '2026-11-02T23:30:00-05:00', ended_at: '2026-11-03T00:00:00-05:00' }];
    const rows = [overnight('u1', '2026-11-02', '2026-11-02T22:00:00-05:00', '2026-11-03T06:00:00-05:00', 7.5, breaks)];
    const { byUser, allocations } = payroll.tierRows(rows, POLICY_40, L.resolveRules(null), { timezoneFor: ny });
    expect(byUser.get('u1').totalHours).toBe(7.5);
    expect(allocations).toHaveLength(2);
    expect(allocations[0]).toMatchObject({ entry_date: '2026-11-02', regular: 1.5 });
    expect(allocations[1]).toMatchObject({ entry_date: '2026-11-03', regular: 6 });
  });

  test('a row without clock times stays whole on its entry date', () => {
    const rows = [{ user_id: 'u1', entry_date: '2026-11-02', hours_worked: 12, breaks: noBreaks, location_id: 1 }];
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA, { timezoneFor: ny }).get('u1');
    expect(result.totalHours).toBe(12);
    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(4);
  });

  test('the split follows the location timezone, not UTC', () => {
    // 22:00-06:00 UTC is one local date in Los Angeles (14:00-22:00)
    // but two in UTC: the same punch tiers differently by zone.
    const rows = [overnight('u1', '2026-11-02', '2026-11-02T22:00:00Z', '2026-11-03T06:00:00Z', 8)];
    const la = payroll.tierRows(rows, POLICY_40, CA, { timezoneFor: () => 'America/Los_Angeles' });
    expect(la.allocations).toHaveLength(1);
    expect(la.allocations[0]).toMatchObject({ entry_date: '2026-11-02', regular: 8 });
    const utc = payroll.tierRows(rows, POLICY_40, CA, { timezoneFor: () => 'UTC' });
    expect(utc.allocations).toHaveLength(2);
    expect(utc.allocations[0]).toMatchObject({ entry_date: '2026-11-02', regular: 2 });
    expect(utc.allocations[1]).toMatchObject({ entry_date: '2026-11-03', regular: 6 });
  });
});

describe('Finding 16: one meal-break premium per person per day, one continuous break', () => {
  const fifteen = (day, hour) => ({ started_at: `2026-11-02T${hour}:00:00Z`, ended_at: `2026-11-02T${hour}:15:00Z` });

  test('a split shift earns one premium for the day, not zero and not two', () => {
    // Two 3-hour CA entries, no breaks: neither entry alone passes
    // the 5-hour meal point, but the day totals 6 hours with no meal
    // break. One premium, not the old zero (per-row hours) and not
    // two (one per row).
    const rows = [entry('u1', '2026-11-02', 3), entry('u1', '2026-11-02', 3)];
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA).get('u1');
    expect(result.missedMealBreaks).toBe(1);
    expect(result.mealBreakPremiumHours).toBe(1);
  });

  test('two 15-minute breaks do not add up to a 30-minute meal period', () => {
    const breaks = [fifteen('2026-11-02', '12'), fifteen('2026-11-02', '15')];
    const result = payroll.calculatePolicyHours(
      [entry('u1', '2026-11-02', 6, breaks)], POLICY_40, CA
    ).get('u1');
    expect(result.missedMealBreaks).toBe(1);
    expect(result.mealBreakPremiumHours).toBe(1);
  });

  test('two long entries on one day earn one premium, not two', () => {
    const rows = [entry('u1', '2026-11-02', 6), entry('u1', '2026-11-02', 6)];
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA).get('u1');
    expect(result.missedMealBreaks).toBe(1);
    expect(result.mealBreakPremiumHours).toBe(1);
  });

  test('two days earn one premium each', () => {
    const rows = [entry('u1', '2026-11-02', 6), entry('u1', '2026-11-03', 6)];
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA).get('u1');
    expect(result.missedMealBreaks).toBe(2);
    expect(result.mealBreakPremiumHours).toBe(2);
  });

  test('a split day across two locations still earns one premium, under the strictest rule', () => {
    // 3h at a CA store + 3h at a GB-UK store, no breaks: one 6-hour
    // day, the CA 30-minute meal rule governs, premium 1 hour.
    const rows = [entry('u1', '2026-11-02', 3, noBreaks, 1), entry('u1', '2026-11-02', 3, noBreaks, 2)];
    const resolver = (locationId) => (locationId === 1 ? CA : L.resolveRules({ jurisdiction_code: 'GB-UK' }));
    const result = payroll.calculatePolicyHours(rows, POLICY_40, resolver).get('u1');
    expect(result.missedMealBreaks).toBe(1);
    expect(result.mealBreakPremiumHours).toBe(1);
  });

  test('a 30-minute break split across two entries still satisfies the meal period', () => {
    // The break is one continuous 30 minutes even though the punch
    // was split into two entries around it.
    const breaks = [{ started_at: '2026-11-02T12:00:00Z', ended_at: '2026-11-02T12:30:00Z' }];
    const rows = [entry('u1', '2026-11-02', 3, breaks), entry('u1', '2026-11-02', 3)];
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA).get('u1');
    expect(result.missedMealBreaks).toBe(0);
    expect(result.mealBreakPremiumHours).toBe(0);
  });

  test('the policy break exception stays per punch when a row splits overnight', () => {
    // One 12-hour overnight punch with no break: one break exception,
    // not one per split piece.
    const rows = [{
      user_id: 'u1', entry_date: '2026-11-02', hours_worked: 12, breaks: noBreaks, location_id: 1,
      clock_in_at: '2026-11-02T18:00:00-05:00', clock_out_at: '2026-11-03T06:00:00-05:00',
    }];
    const result = payroll.calculatePolicyHours(rows, POLICY_40, CA, { timezoneFor: () => 'America/New_York' }).get('u1');
    expect(result.breakExceptions).toBe(1);
  });
});

describe('Finding 47: the double-time multiplier is a policy parameter', () => {
  test('normalizeLaborPolicy defaults double time to 2x', () => {
    const policy = payroll.normalizeLaborPolicy(null);
    expect(policy.doubletime_multiplier_bps).toBe(20000);
    expect(policy.overtime_multiplier_bps).toBe(15000);
  });

  test('normalizeLaborPolicy keeps a stored multiplier', () => {
    const policy = payroll.normalizeLaborPolicy({ doubletime_multiplier_bps: 25000 });
    expect(policy.doubletime_multiplier_bps).toBe(25000);
  });

  test('saving a policy stores the doubletime multiplier', async () => {
    db.query.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM restaurant_locations')) {
        return { rows: [{ address_country: 'US', address_state: 'CA' }] };
      }
      if (String(sql).includes('INSERT INTO restaurant_location_labor_policies')) {
        return { rows: [{ restaurant_id: 7, location_id: 11, country_code: 'US', region_code: 'CA', overtime_threshold_hours: 40, overtime_multiplier_bps: 15000, doubletime_multiplier_bps: 25000, break_after_minutes: 300, break_duration_minutes: 30, updated_by: null, updated_at: null }] };
      }
      return { rows: [] };
    });
    const saved = await payroll.saveLaborPolicy(7, { doubletime_multiplier_bps: 25000, break_after_minutes: 300 }, 'user-1', 11);
    expect(saved.doubletime_multiplier_bps).toBe(25000);
    const insertCall = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO restaurant_location_labor_policies'));
    expect(insertCall).toBeDefined();
    expect(insertCall[0]).toContain('doubletime_multiplier_bps');
    expect(insertCall[1]).toContain(25000);
  });

  test('a doubletime multiplier outside 1x-5x is rejected', async () => {
    db.query.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM restaurant_locations')) {
        return { rows: [{ address_country: 'US', address_state: 'CA' }] };
      }
      return { rows: [] };
    });
    await expect(payroll.saveLaborPolicy(7, { doubletime_multiplier_bps: 5000 }, 'user-1', 11))
      .rejects.toMatchObject({ code: 'validation_failed' });
    await expect(payroll.saveLaborPolicy(7, { doubletime_multiplier_bps: 60000 }, 'user-1', 11))
      .rejects.toMatchObject({ code: 'validation_failed' });
  });
});
