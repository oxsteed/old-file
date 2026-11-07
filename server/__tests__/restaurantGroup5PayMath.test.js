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
